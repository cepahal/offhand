/**
 * The 3D viewport. Owns the three.js scene and applies ViewerCommands to it.
 *
 * - Case packs are RAS mm; everything patient-related lives under `patient`, which carries the
 *   fixed RAS -> three.js transform from logic.ts.
 * - Camera moves (rotate/zoom/focus/reset) drive a spring rig (camera-rig.ts): velocity carries
 *   through new commands and repeated commands glide instead of stopping between steps.
 * - Peel: layers are grouped by peelOrder (0 = outermost). Peel out fades the outermost remaining
 *   group; peel in brings back the most recently peeled group. The innermost group stays.
 * - Renders on demand (only when something changed), which matters on a Pi-class board.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type {
  CaseLayer,
  CasePackManifest,
  ViewerCommand,
  ViewerState,
  ViewSnapshot,
} from '@hoverscan/contracts';
import type { AppConfig } from './appConfig.js';
import { CameraRig, type RigPose } from './camera-rig.js';
import { PALETTE, SURROUND_OPACITY, layerRole, roleColor } from './palette.js';
import {
  RAS_TO_THREE,
  clamp,
  clipHeight,
  cycleFinding,
  indexToScrub,
  layerAtTimepoint,
  nextPeel,
  orderedTimepoints,
  peelGroups,
  rasAxisToThree,
  scrubToIndex,
  type Vec3,
} from './logic.js';

const FADE_MS = 320;
const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const r2 = (n: number): number => Math.round(n * 100) / 100;
const vec = (v: THREE.Vector3): Vec3 => [r2(v.x), r2(v.y), r2(v.z)];

export interface LoadedCase {
  manifest: CasePackManifest;
  /** URL prefix for layer files, e.g. "/casepacks/test-pattern/tp-001/". */
  baseUrl: string;
  app: AppConfig;
  /** Optional in-memory layer objects (frontend mocks). Keyed by layer id; skips the GLB fetch. */
  objects?: Record<string, THREE.Object3D>;
  /** Scrub target "motion": called with the scrub value 0..1 whenever it changes. */
  onScrub?: (value: number) => void;
  /** Short note shown under the banner (frontend mocks). */
  note?: string;
}

interface LayerRt {
  def: CaseLayer;
  root: THREE.Object3D;
  materials: THREE.MeshStandardMaterial[];
  outlines: THREE.LineBasicMaterial[];
  /** Opacity restored by reset. Skull uses the palette, not the case file. */
  baseOpacity: number;
  /** User opacity (set_layer). */
  opacity: number;
  /** User visibility (set_layer / peel). */
  visible: boolean;
  /** Display fade 0..1, tweened towards visible ? 1 : 0. */
  shown: number;
  highlight: boolean;
}

interface Tween {
  key: string;
  start: number;
  dur: number;
  step: (e: number) => void;
  done?: () => void;
}

type ViewFields = Pick<ViewerState, 'slice' | 'timepoint' | 'scrub' | 'mode' | 'focusedFindingId'>;

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, 1, 0.5, 5000);
  readonly controls: OrbitControls;

  private patient = new THREE.Group();
  private markers = new THREE.Group();
  private clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e9);
  private clipQuad: THREE.Group;
  private layers: LayerRt[] = [];
  private peeled: number[] = [];
  private tweens: Tween[] = [];
  private rig = new CameraRig();
  private raycaster = new THREE.Raycaster();
  private lastFrame = performance.now();
  private homeTarget = new THREE.Vector3();
  private homeSph = new THREE.Spherical(300, Math.PI / 2, 0);
  private box = new THREE.Box3();
  private loaded: LoadedCase | null = null;
  private view: ViewFields = {
    slice: { plane: 'axial', index: 0 },
    timepoint: 0,
    scrub: 1,
    mode: 'orbit',
    focusedFindingId: null,
  };
  private dirty = true;
  private raf = 0;
  private ro: ResizeObserver;
  private loadToken = 0;

  /** Called whenever the published state may have changed. */
  onChange: () => void = () => {};
  /** Short user-facing messages ("Nothing left to peel"). */
  onInfo: (msg: string) => void = () => {};

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
    this.renderer.setClearColor(0x000000);
    host.appendChild(this.renderer.domElement);

    this.patient.matrixAutoUpdate = false;
    this.patient.matrix.set(...(RAS_TO_THREE as [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number]));
    this.patient.add(this.markers);
    this.scene.add(this.patient);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x40403d, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(0.5, 1, 1);
    this.camera.add(key); // light follows the camera, so the side you look at is always lit
    this.scene.add(this.camera);

    this.clipQuad = this.makeClipQuad();
    this.scene.add(this.clipQuad);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.addEventListener('start', () => this.rig.stop());
    this.controls.addEventListener('change', () => this.changed());
    this.controls.addEventListener('end', () => this.syncGoal());

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.snapCamera(this.homeTarget, this.homeSph);
    this.frame();
  }

  dispose(): void {
    this.loadToken += 1; // invalidate any GLTF loads still in flight before releasing the renderer
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.clear();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  get manifest(): CasePackManifest | null {
    return this.loaded?.manifest ?? null;
  }

  // ------------------------------------------------------------------------------------------
  // Loading
  // ------------------------------------------------------------------------------------------
  async load(c: LoadedCase): Promise<string[]> {
    const token = ++this.loadToken;
    this.clear();
    this.loaded = c;
    const errors: string[] = [];
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const maxPeel = Math.max(0, ...c.manifest.layers.map((l) => l.peelOrder));

    const results = await Promise.all(
      c.manifest.layers.map(async (def) => {
        const given = c.objects?.[def.id];
        if (given) return { def, root: given };
        try {
          const gltf = await loader.loadAsync(c.baseUrl + def.file);
          return { def, root: gltf.scene as THREE.Object3D };
        } catch (e) {
          errors.push(`${def.label}: ${(e as Error).message}`);
          return null;
        }
      }),
    );
    if (token !== this.loadToken) return ['superseded by another load'];

    for (const r of results) {
      if (!r) continue;
      const rt = this.adoptLayer(r.def, r.root, maxPeel);
      this.layers.push(rt);
      this.patient.add(rt.root);
    }
    this.buildMarkers();
    this.patient.updateMatrixWorld(true);
    this.box.makeEmpty();
    for (const l of this.layers) this.box.expandByObject(l.root);
    this.fitHome();
    this.view = {
      slice: { plane: 'axial', index: 0 },
      timepoint: 0,
      scrub: c.app.scrub.target === 'clip' ? 1 : 0,
      mode: 'orbit',
      focusedFindingId: null,
    };
    for (const l of this.layers) this.applyLayer(l);
    this.snapCamera(this.homeTarget, this.homeSph);
    this.updateClip();
    this.updateMarkers();
    this.changed();
    return errors;
  }

  private adoptLayer(def: CaseLayer, root: THREE.Object3D, maxPeel: number): LayerRt {
    const role = layerRole(def.label, def.id);
    const color = roleColor(role, def.color);
    const flat = role !== 'other';
    const dentalCase = this.loaded?.manifest.app === 'dental';
    const baseOpacity = role === 'skull' && !dentalCase ? PALETTE.skullOpacity : def.defaultOpacity;
    const materials: THREE.MeshStandardMaterial[] = [];
    const outlines: THREE.LineBasicMaterial[] = [];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geom = mesh.geometry as THREE.BufferGeometry;
      if (!geom.getAttribute('normal')) geom.computeVertexNormals();
      const useVertex = !!geom.getAttribute('color') && !flat && !dentalCase;
      const old = mesh.material as THREE.Material | THREE.Material[];
      (Array.isArray(old) ? old : [old]).forEach((m) => m.dispose());
      const m = new THREE.MeshStandardMaterial({
        color: useVertex ? 0xffffff : new THREE.Color(color),
        vertexColors: useVertex,
        roughness: 0.55,
        metalness: 0.05,
        side: THREE.DoubleSide,
        clippingPlanes: [this.clipPlane],
        emissive: new THREE.Color(color),
        emissiveIntensity: role === 'highlight' ? 0.35 : 0,
      });
      mesh.material = m;
      // Transparent layers: draw inner (higher peelOrder) first, outer last.
      mesh.renderOrder = maxPeel - def.peelOrder;
      materials.push(m);
      if (role === 'highlight') {
        const line = new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.highlight), transparent: true });
        mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geom, 20), line));
        outlines.push(line);
      }
    });
    const rt: LayerRt = {
      def,
      root,
      materials,
      outlines,
      baseOpacity,
      opacity: baseOpacity,
      visible: true,
      shown: 1,
      highlight: false,
    };
    this.applyLayer(rt);
    return rt;
  }

  private clear(): void {
    this.tweens = [];
    for (const l of this.layers) {
      this.patient.remove(l.root);
      l.root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh || (o as THREE.LineSegments).isLineSegments) mesh.geometry.dispose();
      });
      l.materials.forEach((m) => m.dispose());
      l.outlines.forEach((m) => m.dispose());
    }
    this.layers = [];
    this.peeled = [];
    for (const m of [...this.markers.children]) {
      this.markers.remove(m);
      const mesh = m as THREE.Mesh;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.loaded = null;
    this.dirty = true;
  }

  // ------------------------------------------------------------------------------------------
  // Commands
  // ------------------------------------------------------------------------------------------
  /** Apply a command. Returns false if the viewer does not handle this command type. */
  apply(cmd: ViewerCommand): boolean {
    switch (cmd.type) {
      case 'rotate':
        this.rotate(cmd.yawDeg ?? 0, cmd.pitchDeg ?? 0);
        return true;
      case 'zoom':
        this.zoom(cmd.factor);
        return true;
      case 'peel':
        if (cmd.dir === 'out') this.peelOut();
        else this.peelIn();
        return true;
      case 'set_layer':
        this.setLayer(cmd.layerId, cmd.visible, cmd.opacity);
        return true;
      case 'slice': {
        const index = cmd.index ?? Math.max(0, this.view.slice.index + (cmd.delta ?? 0));
        this.view.slice = { plane: cmd.plane, index: Math.max(0, Math.round(index)) };
        this.changed();
        return true;
      }
      case 'scrub':
        this.setScrub(cmd.value);
        return true;
      case 'timepoint': {
        const n = this.loaded?.manifest.timepoints?.length ?? 1;
        const i = clamp(Math.round(cmd.index ?? this.view.timepoint + (cmd.delta ?? 0)), 0, Math.max(0, n - 1));
        // Keep the scrub bar on the same visit, so the gesture and the slider agree.
        if (this.loaded?.app.scrub.target === 'timepoint') this.view.scrub = indexToScrub(i, n);
        this.setTimepoint(i);
        return true;
      }
      case 'focus_finding':
        this.focus(cmd.findingId);
        return true;
      case 'reset_view':
        this.reset();
        return true;
      case 'mode':
        this.view.mode = cmd.mode;
        this.updateClip();
        this.changed();
        return true;
      default:
        return false;
    }
  }

  private rotate(yawDeg: number, pitchDeg: number): void {
    if (!this.rig.active) this.syncGoal();
    const now = performance.now();
    // yaw > 0 turns the model to the viewer's right = camera orbits the other way.
    this.rig.nudge('yaw', -THREE.MathUtils.degToRad(yawDeg), now);
    this.rig.nudge('pitch', THREE.MathUtils.degToRad(pitchDeg), now);
    this.changed();
  }

  private zoom(factor: number): void {
    if (!(factor > 0)) return;
    if (!this.rig.active) this.syncGoal();
    this.rig.nudge('zoom', -Math.log(factor), performance.now());
    this.changed();
  }

  private peelOut(): void {
    const g = nextPeel(peelGroups(this.layers.map((l) => l.def)), this.peeled);
    if (g === null) return this.onInfo('Nothing left to peel.');
    this.peeled.push(g);
    const names = this.layers.filter((l) => l.def.peelOrder === g).map((l) => l.def.label);
    for (const l of this.layers) if (l.def.peelOrder === g) this.fadeLayer(l, false);
    this.onInfo(`Peeled away: ${names.join(', ')}`);
    this.changed();
  }

  private peelIn(): void {
    const g = this.peeled.pop();
    if (g === undefined) return this.onInfo('All layers are already shown.');
    for (const l of this.layers) if (l.def.peelOrder === g) this.fadeLayer(l, true);
    this.changed();
  }

  private setLayer(id: string, visible?: boolean, opacity?: number): void {
    const l = this.layers.find((x) => x.def.id === id);
    if (!l) return this.onInfo(`No layer "${id}" in this case.`);
    if (opacity !== undefined) {
      const from = l.opacity;
      const to = clamp(opacity, 0, 1);
      this.animate(`opacity:${id}`, FADE_MS / 2, (e) => {
        l.opacity = lerp(from, to, e);
        this.applyLayer(l);
      });
    }
    if (visible !== undefined) {
      this.fadeLayer(l, visible);
      if (visible) this.peeled = this.peeled.filter((g) => g !== l.def.peelOrder);
    }
    this.changed();
  }

  private fadeLayer(l: LayerRt, visible: boolean): void {
    l.visible = visible;
    const from = l.shown;
    const to = visible ? 1 : 0;
    this.animate(`fade:${l.def.id}`, FADE_MS, (e) => {
      l.shown = lerp(from, to, e);
      this.applyLayer(l);
    });
  }

  private applyLayer(l: LayerRt): void {
    const o = layerAtTimepoint(l.def, this.timepointId()) ? l.opacity * l.shown : 0;
    const transparent = o < 0.999;
    const role = layerRole(l.def.label, l.def.id);
    const glow = role === 'highlight' ? (l.highlight ? 0.7 : 0.35) : l.highlight ? 0.45 : 0;
    for (const m of l.materials) {
      if (m.transparent !== transparent) {
        m.transparent = transparent;
        m.needsUpdate = true;
      }
      m.opacity = o;
      m.depthWrite = !transparent;
      m.emissiveIntensity = glow;
    }
    for (const line of l.outlines) line.opacity = Math.min(1, o);
    l.root.visible = o > 0.003;
    this.dirty = true;
  }

  /** Mouse-over highlight from the layer list (UI only, not part of the state). */
  highlightLayer(id: string | null): void {
    for (const l of this.layers) {
      const h = l.def.id === id;
      if (h !== l.highlight) {
        l.highlight = h;
        this.applyLayer(l);
      }
    }
  }

  private setScrub(value: number): void {
    const v = clamp(value, 0, 1);
    this.view.scrub = v;
    const target = this.loaded?.app.scrub.target ?? 'clip';
    if (target === 'timepoint') {
      this.setTimepoint(scrubToIndex(v, this.loaded?.manifest.timepoints?.length ?? 1));
    } else if (target === 'slice') {
      // The slice panel owns the slice count; until it is wired, scrub maps to 0..255.
      this.view.slice = { ...this.view.slice, index: scrubToIndex(v, 256) };
    }
    this.updateClip();
    this.changed();
  }

  private setTimepoint(i: number): void {
    this.view.timepoint = i;
    for (const l of this.layers) this.applyLayer(l);
    this.updateMarkers();
    this.changed();
  }

  private timepointId(): string | undefined {
    return this.loaded ? orderedTimepoints(this.loaded.manifest)[this.view.timepoint]?.id : undefined;
  }

  private focus(findingId: string): void {
    const m = this.loaded?.manifest;
    if (!m) return;
    const tp = this.timepointId();
    const id =
      findingId === 'next' || findingId === 'prev'
        ? cycleFinding(m.findings, this.view.focusedFindingId, findingId, tp)
        : findingId;
    const f = m.findings.find((x) => x.id === id);
    if (!f) return this.onInfo(m.findings.length ? `No finding "${findingId}".` : 'This case has no findings.');
    if (f.timepointId && f.timepointId !== tp) {
      const i = orderedTimepoints(m).findIndex((t) => t.id === f.timepointId);
      if (i >= 0) {
        if (this.loaded?.app.scrub.target === 'timepoint') this.view.scrub = indexToScrub(i, m.timepoints?.length ?? 1);
        this.setTimepoint(i);
      }
    }
    this.view.focusedFindingId = f.id;
    const center = this.patient.localToWorld(new THREE.Vector3(...f.center));
    if (!this.rig.active) this.syncGoal();
    const want = Math.max(f.radiusMm * 9, this.homeSph.radius * 0.35);
    this.rig.travelTo({ target: [center.x, center.y, center.z], radius: clamp(want, this.controls.minDistance, this.controls.maxDistance) });
    this.fadeSurrounding();
    this.updateMarkers();
    this.changed();
  }

  private reset(): void {
    this.peeled = [];
    for (const l of this.layers) {
      const from = l.opacity;
      const to = l.baseOpacity;
      this.animate(`opacity:${l.def.id}`, FADE_MS, (e) => {
        l.opacity = lerp(from, to, e);
        this.applyLayer(l);
      });
      this.fadeLayer(l, true);
    }
    this.view.focusedFindingId = null;
    this.view.mode = 'orbit';
    this.view.timepoint = 0;
    this.view.scrub = this.loaded?.app.scrub.target === 'clip' ? 1 : 0;
    if (!this.rig.active) this.syncGoal();
    this.rig.travelTo(this.poseOf(this.homeTarget, this.homeSph));
    this.updateClip();
    this.updateMarkers();
    this.changed();
  }

  /** Restore a saved view (bookmark). */
  restore(s: ViewSnapshot): void {
    const target = new THREE.Vector3().fromArray(s.camera.target);
    if (!this.rig.active) this.syncGoal();
    this.rig.travelTo(this.poseOf(target, new THREE.Spherical().setFromVector3(new THREE.Vector3(...s.camera.position).sub(target))));
    for (const ls of s.layers) {
      const l = this.layers.find((x) => x.def.id === ls.id);
      if (!l) continue;
      l.opacity = ls.opacity;
      this.fadeLayer(l, ls.visible);
    }
    const groups = peelGroups(this.layers.map((l) => l.def));
    this.peeled = groups.filter((g) => this.layers.every((l) => l.def.peelOrder !== g || !l.visible));
    this.view = {
      slice: { ...s.slice },
      timepoint: s.timepoint,
      scrub: s.scrub,
      mode: s.mode,
      focusedFindingId: s.focusedFindingId,
    };
    for (const l of this.layers) this.applyLayer(l);
    this.updateClip();
    this.updateMarkers();
    this.changed();
  }

  // ------------------------------------------------------------------------------------------
  // State + capture
  // ------------------------------------------------------------------------------------------
  snapshot(): ViewSnapshot {
    const m = this.loaded?.manifest;
    return {
      app: m?.app ?? null,
      caseId: m?.caseId ?? null,
      camera: {
        position: vec(this.camera.position),
        target: vec(this.controls.target),
        up: vec(this.camera.up),
      },
      layers: this.layers.map((l) => ({
        id: l.def.id,
        opacity: Math.round(l.opacity * 1000) / 1000,
        visible: l.visible,
      })),
      slice: { ...this.view.slice },
      timepoint: this.view.timepoint,
      scrub: Math.round(this.view.scrub * 1000) / 1000,
      mode: this.view.mode,
      focusedFindingId: this.view.focusedFindingId,
    };
  }

  /** Screen position (CSS px, relative to the viewport) of a RAS-mm point. */
  projectRas(ras: Vec3): { x: number; y: number; visible: boolean } {
    const p = this.patient.localToWorld(new THREE.Vector3(...ras)).project(this.camera);
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h, visible: p.z < 1 && Math.abs(p.x) < 1.2 && Math.abs(p.y) < 1.2 };
  }

  /** Bounding box of a layer in RAS mm, or null when the case has no such layer. */
  layerBoundsRas(id: string): { min: Vec3; max: Vec3 } | null {
    const l = this.layers.find((x) => x.def.id === id);
    if (!l) return null;
    this.patient.updateMatrixWorld(true);
    const world = new THREE.Box3().setFromObject(l.root);
    if (world.isEmpty()) return null;
    const inv = this.patient.matrixWorld.clone().invert();
    const local = new THREE.Box3();
    for (const x of [world.min.x, world.max.x])
      for (const y of [world.min.y, world.max.y])
        for (const z of [world.min.z, world.max.z]) local.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(inv));
    return { min: [local.min.x, local.min.y, local.min.z], max: [local.max.x, local.max.y, local.max.z] };
  }

  /**
   * The segmented structure a RAS-mm point lies in: the smallest layer box that contains it,
   * else the nearest tooth within 6 mm. Teeth win over bone when both contain the point.
   */
  structureAt(ras: Vec3): { id: string; label: string } | null {
    let best: { id: string; label: string; score: number } | null = null;
    // Only teeth and the two jaws: boxes of long curved structures (canals, sinuses) are too loose to name a point.
    for (const l of this.layers) {
      if (!/^tooth-|jawbone$/.test(l.def.id)) continue;
      const b = this.layerBoundsRas(l.def.id);
      if (!b) continue;
      const inside = [0, 1, 2].every((i) => ras[i]! >= b.min[i]! - 0.5 && ras[i]! <= b.max[i]! + 0.5);
      const center = [0, 1, 2].map((i) => (b.min[i]! + b.max[i]!) / 2);
      const dist = Math.hypot(ras[0] - center[0]!, ras[1] - center[1]!, ras[2] - center[2]!);
      const vol = (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]);
      const tooth = l.def.id.startsWith('tooth-');
      const score = inside ? vol * (tooth ? 0.2 : 1) : tooth && dist < 6 ? 1e9 + dist : Infinity;
      if (score < (best?.score ?? Infinity)) best = { id: l.def.id, label: l.def.label, score };
    }
    return best ? { id: best.id, label: best.label } : null;
  }

  /** True when visible geometry sits between the camera and this RAS-mm point. */
  occluded(ras: Vec3): boolean {
    const target = this.patient.localToWorld(new THREE.Vector3(...ras));
    const dir = target.clone().sub(this.camera.position);
    const dist = dir.length();
    this.raycaster.set(this.camera.position, dir.normalize());
    this.raycaster.far = dist - 1.5;
    const meshes: THREE.Object3D[] = [];
    for (const l of this.layers) if (l.root.visible && l.opacity * l.shown > 0.5) meshes.push(l.root);
    return this.raycaster.intersectObjects(meshes, true).length > 0;
  }

  /** Whether a layer is currently drawn (not peeled away or hidden). */
  layerShown(id: string): boolean {
    const l = this.layers.find((x) => x.def.id === id);
    return !!l && l.visible && l.opacity * l.shown > 0.05;
  }

  /** Change the home direction (degrees around the vertical, and from the top) and go there. */
  setHomeView(yawDeg: number, polarDeg: number): void {
    this.homeSph.theta = THREE.MathUtils.degToRad(yawDeg);
    this.homeSph.phi = THREE.MathUtils.degToRad(polarDeg);
    this.snapCamera(this.homeTarget, this.homeSph);
  }

  /** Peel groups, outermost first, with what is in each and whether it is still shown. */
  peelStatus(): { order: number; labels: string[]; shown: boolean; color: string }[] {
    return peelGroups(this.layers.map((l) => l.def)).map((order) => {
      const inGroup = this.layers.filter((l) => l.def.peelOrder === order);
      // The group's most common colour, so one tinted focus tooth does not recolour "Teeth".
      const counts = new Map<string, number>();
      for (const l of inGroup) {
        if (/sinus|airway|pharynx/i.test(l.def.label)) continue;
        const c = roleColor(layerRole(l.def.label, l.def.id), l.def.color);
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
      const color = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '#888888';
      return {
        order,
        labels: inGroup.map((l) => l.def.label),
        shown: !this.peeled.includes(order),
        color,
      };
    });
  }

  /** PNG of the current view (rendered now, so no preserveDrawingBuffer needed). */
  capture(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  // ------------------------------------------------------------------------------------------
  // Camera
  // ------------------------------------------------------------------------------------------
  private fitHome(): void {
    if (this.box.isEmpty()) return;
    const size = this.box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 1);
    // Frame the front view to the box, not its bounding sphere, so the anatomy fills the viewport.
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const aspect = Math.max(this.camera.aspect, 0.2);
    const fitH = size.y / 2 / tanHalf;
    const fitW = size.x / 2 / (tanHalf * aspect);
    const dist = Math.max(fitH, fitW) * 1.12 + size.z / 2;
    this.box.getCenter(this.homeTarget);
    this.homeSph.set(dist, THREE.MathUtils.degToRad(78), 0); // in front (+z = anterior), a bit above
    this.camera.near = Math.max(0.1, dist / 200);
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = radius * 0.08;
    this.controls.maxDistance = dist * 4;
  }

  private poseOf(target: THREE.Vector3, sph: THREE.Spherical): RigPose {
    return { radius: sph.radius, phi: sph.phi, theta: sph.theta, target: [target.x, target.y, target.z] };
  }

  private snapCamera(target: THREE.Vector3, sph: THREE.Spherical): void {
    this.rig.minRadius = this.controls.minDistance;
    this.rig.maxRadius = this.controls.maxDistance;
    this.rig.setPose(this.poseOf(target, sph));
    this.applyRig();
  }

  /** Make the rig start from wherever the camera is now (after a mouse drag, or before a move). */
  private syncGoal(): void {
    this.rig.minRadius = this.controls.minDistance;
    this.rig.maxRadius = this.controls.maxDistance;
    this.rig.setPose(this.poseOf(this.controls.target, new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target))));
    this.changed();
  }

  private applyRig(): void {
    const p = this.rig.pose();
    this.controls.target.set(...p.target);
    this.camera.position.setFromSpherical(new THREE.Spherical(p.radius, p.phi, p.theta)).add(this.controls.target);
    this.camera.lookAt(this.controls.target);
    this.changed();
  }

  // ------------------------------------------------------------------------------------------
  // Clip plane (scrub target "clip") + finding markers
  // ------------------------------------------------------------------------------------------
  private makeClipQuad(): THREE.Group {
    const g = new THREE.Group();
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: 0xc8a96f,
        transparent: true,
        opacity: 0.1,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
      new THREE.LineBasicMaterial({ color: 0xc8a96f }),
    );
    plane.renderOrder = edge.renderOrder = 900;
    g.add(plane, edge);
    g.visible = false;
    return g;
  }

  private updateClip(): void {
    const sc = this.loaded?.app.scrub;
    // Every path that changes view.scrub ends here, so the case-supplied motion is applied here too.
    if (sc?.target === 'motion') this.loaded?.onScrub?.(this.view.scrub);
    const active = sc?.target === 'clip' && (this.view.mode === 'scrub' || this.view.scrub < 0.999);
    if (!sc || !active || this.box.isEmpty()) {
      this.clipPlane.constant = 1e9;
      this.clipQuad.visible = false;
      this.dirty = true;
      return;
    }
    const u = new THREE.Vector3(...rasAxisToThree(sc.axis));
    let lo = Infinity;
    let hi = -Infinity;
    for (const x of [this.box.min.x, this.box.max.x])
      for (const y of [this.box.min.y, this.box.max.y])
        for (const z of [this.box.min.z, this.box.max.z]) {
          const d = u.dot(new THREE.Vector3(x, y, z));
          lo = Math.min(lo, d);
          hi = Math.max(hi, d);
        }
    const h = clipHeight(this.view.scrub, lo, hi);
    // Keep points with u.p <= h  (plane: n.p + c >= 0 with n = -u, c = h).
    this.clipPlane.normal.copy(u).negate();
    this.clipPlane.constant = h;
    const center = this.box.getCenter(new THREE.Vector3());
    const size = this.box.getSize(new THREE.Vector3()).length() * 0.8;
    this.clipQuad.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), u);
    this.clipQuad.position.copy(center).addScaledVector(u, h - u.dot(center));
    this.clipQuad.scale.setScalar(size);
    this.clipQuad.visible = true;
    this.dirty = true;
  }

  private buildMarkers(): void {
    for (const f of this.loaded?.manifest.findings ?? []) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(f.radiusMm, 1), 20, 14),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(PALETTE.highlight),
          wireframe: true,
          transparent: true,
          opacity: 0.35,
          depthTest: false,
        }),
      );
      m.position.set(...f.center);
      m.renderOrder = 1000;
      m.userData.findingId = f.id;
      m.userData.timepointId = f.timepointId;
      this.markers.add(m);
    }
  }

  /** Tissue around a finding drops to 40%. The finding itself stays. */
  private fadeSurrounding(): void {
    for (const l of this.layers) {
      if (layerRole(l.def.label, l.def.id) === 'highlight') continue;
      const from = l.opacity;
      const to = Math.min(from, SURROUND_OPACITY);
      this.animate(`opacity:${l.def.id}`, FADE_MS, (e) => {
        l.opacity = lerp(from, to, e);
        this.applyLayer(l);
      });
    }
  }

  private updateMarkers(): void {
    const tp = this.timepointId();
    for (const o of this.markers.children) {
      const m = o as THREE.Mesh;
      const mat = m.material as THREE.MeshBasicMaterial;
      const focused = m.userData.findingId === this.view.focusedFindingId;
      m.visible = !tp || !m.userData.timepointId || m.userData.timepointId === tp;
      mat.opacity = focused ? 1 : 0.35;
      m.scale.setScalar(focused ? 1.15 : 1);
    }
    this.dirty = true;
  }

  // ------------------------------------------------------------------------------------------
  // Loop
  // ------------------------------------------------------------------------------------------
  private animate(key: string, dur: number, step: (e: number) => void, done?: () => void): void {
    this.tweens = this.tweens.filter((t) => t.key !== key);
    this.tweens.push({ key, start: performance.now(), dur, step, done });
    this.dirty = true;
  }

  private changed(): void {
    this.dirty = true;
    this.onChange();
  }

  private resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  private frame = (): void => {
    this.raf = requestAnimationFrame(this.frame);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.rig.step(dt)) this.applyRig();
    if (this.tweens.length) {
      const now = performance.now();
      const done: (() => void)[] = [];
      this.tweens = this.tweens.filter((t) => {
        const e = Math.min(1, (now - t.start) / t.dur);
        t.step(ease(e));
        if (e >= 1 && t.done) done.push(t.done);
        return e < 1;
      });
      done.forEach((d) => d());
      this.dirty = true;
    }
    if (this.dirty) {
      this.dirty = false;
      this.renderer.render(this.scene, this.camera);
    }
  };
}
