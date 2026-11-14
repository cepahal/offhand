/**
 * The 3D viewport. Owns the three.js scene and applies ViewerCommands to it.
 *
 * - Case packs are RAS mm; everything patient-related lives under `patient`, which carries the
 *   fixed RAS -> three.js transform from logic.ts.
 * - Camera moves (rotate/zoom/focus/reset) animate towards a goal pose, so quick repeated
 *   gestures accumulate instead of cancelling each other.
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
} from '@offhand/contracts';
import type { AppConfig } from './appConfig.js';
import {
  RAS_TO_THREE,
  clamp,
  clipHeight,
  cycleFinding,
  nextPeel,
  peelGroups,
  rasAxisToThree,
  scrubToIndex,
  type Vec3,
} from './logic.js';

const MOVE_MS = 380;
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
  private goalTarget = new THREE.Vector3();
  private goalSph = new THREE.Spherical(300, Math.PI / 2, 0);
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

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(0.5, 1, 1);
    this.camera.add(key); // light follows the camera, so the side you look at is always lit
    this.scene.add(this.camera);

    this.clipQuad = this.makeClipQuad();
    this.scene.add(this.clipQuad);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.addEventListener('start', () => this.cancel('camera'));
    this.controls.addEventListener('change', () => this.changed());
    this.controls.addEventListener('end', () => this.syncGoal());

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.snapCamera(this.homeTarget, this.homeSph);
    this.frame();
  }

  dispose(): void {
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
    this.snapCamera(this.homeTarget, this.homeSph);
    this.updateClip();
    this.updateMarkers();
    this.changed();
    return errors;
  }

  private adoptLayer(def: CaseLayer, root: THREE.Object3D, maxPeel: number): LayerRt {
    const materials: THREE.MeshStandardMaterial[] = [];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geom = mesh.geometry as THREE.BufferGeometry;
      if (!geom.getAttribute('normal')) geom.computeVertexNormals();
      const hasColors = !!geom.getAttribute('color');
      const old = mesh.material as THREE.Material | THREE.Material[];
      (Array.isArray(old) ? old : [old]).forEach((m) => m.dispose());
      const m = new THREE.MeshStandardMaterial({
        color: hasColors ? 0xffffff : new THREE.Color(def.color),
        vertexColors: hasColors,
        roughness: 0.55,
        metalness: 0.05,
        side: THREE.DoubleSide,
        clippingPlanes: [this.clipPlane],
        emissive: new THREE.Color(def.color),
        emissiveIntensity: 0,
      });
      mesh.material = m;
      // Transparent layers: draw inner (higher peelOrder) first, outer last.
      mesh.renderOrder = maxPeel - def.peelOrder;
      materials.push(m);
    });
    const rt: LayerRt = {
      def,
      root,
      materials,
      opacity: def.defaultOpacity,
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
        if (mesh.isMesh) mesh.geometry.dispose();
      });
      l.materials.forEach((m) => m.dispose());
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
        const i = cmd.index ?? this.view.timepoint + (cmd.delta ?? 0);
        this.setTimepoint(clamp(Math.round(i), 0, Math.max(0, n - 1)));
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
    if (!this.tweening('camera')) this.syncGoal();
    // yaw > 0 turns the model to the viewer's right = camera orbits the other way.
    this.goalSph.theta -= THREE.MathUtils.degToRad(yawDeg);
    this.goalSph.phi = clamp(this.goalSph.phi + THREE.MathUtils.degToRad(pitchDeg), 0.05, Math.PI - 0.05);
    this.fly();
  }

  private zoom(factor: number): void {
    if (!(factor > 0)) return;
    if (!this.tweening('camera')) this.syncGoal();
    this.goalSph.radius = clamp(this.goalSph.radius / factor, this.controls.minDistance, this.controls.maxDistance);
    this.fly();
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
    const o = l.opacity * l.shown;
    const transparent = o < 0.999;
    for (const m of l.materials) {
      if (m.transparent !== transparent) {
        m.transparent = transparent;
        m.needsUpdate = true;
      }
      m.opacity = o;
      m.depthWrite = !transparent;
      m.emissiveIntensity = l.highlight ? 0.45 : 0;
    }
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
    this.updateMarkers();
    this.changed();
  }

  private focus(findingId: string): void {
    const m = this.loaded?.manifest;
    if (!m) return;
    const tp = m.timepoints?.slice().sort((a, b) => a.order - b.order)[this.view.timepoint]?.id;
    const id =
      findingId === 'next' || findingId === 'prev'
        ? cycleFinding(m.findings, this.view.focusedFindingId, findingId, tp)
        : findingId;
    const f = m.findings.find((x) => x.id === id);
    if (!f) return this.onInfo(m.findings.length ? `No finding "${findingId}".` : 'This case has no findings.');
    this.view.focusedFindingId = f.id;
    this.goalTarget.copy(this.patient.localToWorld(new THREE.Vector3(...f.center)));
    if (!this.tweening('camera')) this.goalSph.setFromVector3(this.camera.position.clone().sub(this.controls.target));
    const want = Math.max(f.radiusMm * 9, this.homeSph.radius * 0.35);
    this.goalSph.radius = clamp(want, this.controls.minDistance, this.controls.maxDistance);
    this.fly(MOVE_MS * 1.6);
    this.updateMarkers();
    this.changed();
  }

  private reset(): void {
    this.peeled = [];
    for (const l of this.layers) {
      const from = l.opacity;
      const to = l.def.defaultOpacity;
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
    this.goalTarget.copy(this.homeTarget);
    this.goalSph.copy(this.homeSph);
    this.fly(MOVE_MS * 1.4);
    this.updateClip();
    this.updateMarkers();
    this.changed();
  }

  /** Restore a saved view (bookmark). */
  restore(s: ViewSnapshot): void {
    this.goalTarget.fromArray(s.camera.target);
    this.goalSph.setFromVector3(new THREE.Vector3(...s.camera.position).sub(this.goalTarget));
    this.fly(MOVE_MS * 1.6);
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
    const dist = (radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.02;
    this.box.getCenter(this.homeTarget);
    this.homeSph.set(dist, THREE.MathUtils.degToRad(78), 0); // in front (+z = anterior), a bit above
    this.camera.near = Math.max(0.1, dist / 200);
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = radius * 0.08;
    this.controls.maxDistance = dist * 4;
  }

  private snapCamera(target: THREE.Vector3, sph: THREE.Spherical): void {
    this.controls.target.copy(target);
    this.camera.position.setFromSpherical(sph).add(target);
    this.camera.lookAt(target);
    this.goalTarget.copy(target);
    this.goalSph.copy(sph);
    this.changed();
  }

  private syncGoal(): void {
    this.goalTarget.copy(this.controls.target);
    this.goalSph.setFromVector3(this.camera.position.clone().sub(this.controls.target));
    this.changed();
  }

  private fly(dur = MOVE_MS): void {
    const fromT = this.controls.target.clone();
    const fromS = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(fromT));
    const toT = this.goalTarget.clone();
    const toS = this.goalSph.clone();
    while (toS.theta - fromS.theta > Math.PI) fromS.theta += 2 * Math.PI;
    while (toS.theta - fromS.theta < -Math.PI) fromS.theta -= 2 * Math.PI;
    const s = new THREE.Spherical();
    const t = new THREE.Vector3();
    this.animate('camera', dur, (e) => {
      t.lerpVectors(fromT, toT, e);
      s.set(
        fromS.radius * Math.pow(toS.radius / Math.max(fromS.radius, 1e-6), e),
        lerp(fromS.phi, toS.phi, e),
        lerp(fromS.theta, toS.theta, e),
      );
      this.controls.target.copy(t);
      this.camera.position.setFromSpherical(s).add(t);
      this.camera.lookAt(t);
      this.changed();
    });
  }

  // ------------------------------------------------------------------------------------------
  // Clip plane (scrub target "clip") + finding markers
  // ------------------------------------------------------------------------------------------
  private makeClipQuad(): THREE.Group {
    const g = new THREE.Group();
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0.1,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
      new THREE.LineBasicMaterial({ color: 0x00ffff }),
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
          color: 0xffff00,
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

  private updateMarkers(): void {
    const tps = this.loaded?.manifest.timepoints?.slice().sort((a, b) => a.order - b.order);
    const tp = tps?.[this.view.timepoint]?.id;
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

  private cancel(key: string): void {
    this.tweens = this.tweens.filter((t) => t.key !== key);
  }

  private tweening(key: string): boolean {
    return this.tweens.some((t) => t.key === key);
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
