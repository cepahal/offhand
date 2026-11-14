/**
 * Pressure analysis for the root-canal case: the scanned tooth 36, an illustrative
 * canal filling, and a crown built from that tooth's own occlusal surface.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { ViewerCommand } from '@hoverscan/contracts';
import { RAS_TO_THREE } from '../viewer/logic.js';
import type { StageControl } from './DentalStage.js';
import {
  CROWN_FIT_FIGURES,
  CROWN_STAGES,
  buildCrownGeometry,
  canalPolylines,
  contourLoops,
  highSurfaceSplit,
  paintContacts,
  poseAt,
  progressForStage,
  sliceCenters,
  stageIndex,
  type FitPose,
} from './crown-fit.js';

const RAS = new THREE.Matrix4().set(
  RAS_TO_THREE[0]!, RAS_TO_THREE[1]!, RAS_TO_THREE[2]!, RAS_TO_THREE[3]!,
  RAS_TO_THREE[4]!, RAS_TO_THREE[5]!, RAS_TO_THREE[6]!, RAS_TO_THREE[7]!,
  RAS_TO_THREE[8]!, RAS_TO_THREE[9]!, RAS_TO_THREE[10]!, RAS_TO_THREE[11]!,
  RAS_TO_THREE[12]!, RAS_TO_THREE[13]!, RAS_TO_THREE[14]!, RAS_TO_THREE[15]!,
);

const CLEARANCE_MM = CROWN_FIT_FIGURES.occlusalClearanceMm;

function bake(root: THREE.Object3D): THREE.BufferGeometry | null {
  root.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const source = mesh.geometry.getIndex() ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const position = source.getAttribute('position');
    if (!position) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', position.clone());
    geometry.applyMatrix4(mesh.matrixWorld);
    geometry.applyMatrix4(RAS);
    parts.push(geometry);
  });
  if (parts.length === 0) return null;
  if (parts.length === 1) {
    parts[0]!.computeVertexNormals();
    return parts[0]!;
  }
  const count = parts.reduce((sum, geometry) => sum + geometry.getAttribute('position').count, 0);
  const merged = new Float32Array(count * 3);
  let offset = 0;
  for (const geometry of parts) {
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      merged[offset++] = position.getX(i);
      merged[offset++] = position.getY(i);
      merged[offset++] = position.getZ(i);
    }
    geometry.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(merged, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function boneMaterial(opacity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: opacity < 1 ? '#f3ecdf' : '#e4d5c0',
    roughness: 0.62,
    metalness: 0.02,
    side: THREE.DoubleSide,
    transparent: opacity < 1,
    opacity,
  });
}

export function CrownFit({
  candidateId,
  bind,
}: {
  candidateId: string;
  bind: (viewer: StageControl | null) => void;
}) {
  const mainRef = useRef<HTMLDivElement>(null);
  const occlusalRef = useRef<HTMLDivElement>(null);
  const mesialRef = useRef<HTMLDivElement>(null);
  const distalRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const progressRef = useRef(progressForStage(5));
  const playingRef = useRef(false);
  const [progress, setProgress] = useState(progressForStage(5));
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState('Loading tooth 36 from this candidate…');
  const [split, setSplit] = useState({ mesial: 50, distal: 50 });
  const [labels, setLabels] = useState<Array<{ id: string; text: string; x: number; y: number }>>([]);
  playingRef.current = playing;

  useEffect(() => {
    const mainHost = mainRef.current;
    const occlusalHost = occlusalRef.current;
    const mesialHost = mesialRef.current;
    const distalHost = distalRef.current;
    if (!mainHost || !occlusalHost || !mesialHost || !distalHost) return;
    const hosts = [mainHost, occlusalHost, mesialHost, distalHost];
    let stopped = false;
    const scene = new THREE.Scene();
    const makeRenderer = (host: HTMLDivElement) => {
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.setClearColor(0x070807, 1);
      renderer.localClippingEnabled = true;
      host.appendChild(renderer.domElement);
      return renderer;
    };
    const mainRenderer = makeRenderer(mainHost);
    const occlusalRenderer = makeRenderer(occlusalHost);
    const mesialRenderer = makeRenderer(mesialHost);
    const distalRenderer = makeRenderer(distalHost);
    const mainCamera = new THREE.PerspectiveCamera(32, 1, 0.1, 2000);
    const occlusalCamera = new THREE.PerspectiveCamera(28, 1, 0.1, 2000);
    const mesialCamera = new THREE.PerspectiveCamera(28, 1, 0.1, 2000);
    const distalCamera = new THREE.PerspectiveCamera(28, 1, 0.1, 2000);
    const controls = new OrbitControls(mainCamera, mainRenderer.domElement);
    controls.enablePan = false;
    controls.enableDamping = true;
    const hemi = new THREE.HemisphereLight(0xfff8ee, 0x2a2620, 1.15);
    const key = new THREE.DirectionalLight(0xffffff, 1.45);
    key.position.set(40, 80, 50);
    scene.add(hemi, key);
    const context = new THREE.Group();
    const tooth = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({
      color: '#f6f1e8',
      roughness: 0.46,
      metalness: 0.03,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1,
    }));
    const sectionPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
    const prepPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    tooth.material.clippingPlanes = [sectionPlane, prepPlane];
    const canals = new THREE.Group();
    const canalMaterial = new THREE.MeshStandardMaterial({
      color: '#e08a45',
      emissive: '#a85a22',
      emissiveIntensity: 0.28,
      roughness: 0.42,
      metalness: 0.04,
      clippingPlanes: [sectionPlane],
    });
    const crownClip = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const crown = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({
      color: '#ffffff',
      vertexColors: true,
      roughness: 0.38,
      metalness: 0.06,
      side: THREE.DoubleSide,
      clippingPlanes: [crownClip],
    }));
    const contours = new THREE.Group();
    const axis = new THREE.Group();
    crown.add(contours);
    scene.add(context, tooth, canals, crown, axis);
    const home = { position: new THREE.Vector3(), target: new THREE.Vector3() };
    const anchors = {
      axis: new THREE.Vector3(),
      cusp: new THREE.Vector3(),
      margin: new THREE.Vector3(),
      clearance: new THREE.Vector3(),
    };
    let prepY = 0;
    let travel = 12;
    let ready = false;

    const fitHost = (renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, host: HTMLDivElement) => {
      const width = Math.max(host.clientWidth, 40);
      const height = Math.max(host.clientHeight, 40);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const fitAll = () => {
      fitHost(mainRenderer, mainCamera, mainHost);
      fitHost(occlusalRenderer, occlusalCamera, occlusalHost);
      fitHost(mesialRenderer, mesialCamera, mesialHost);
      fitHost(distalRenderer, distalCamera, distalHost);
    };
    const resize = new ResizeObserver(fitAll);
    for (const host of hosts) resize.observe(host!);
    fitAll();

    const applyPose = (pose: FitPose) => {
      if (!ready) return;
      const box = tooth.geometry.boundingBox;
      if (!box) return;
      const cutX = THREE.MathUtils.lerp(box.min.x - 2, (box.min.x + box.max.x) / 2, pose.section);
      sectionPlane.normal.set(1, 0, 0);
      sectionPlane.constant = -cutX;
      const cutY = THREE.MathUtils.lerp(box.max.y + 2, prepY, pose.prep);
      prepPlane.normal.set(0, -1, 0);
      prepPlane.constant = cutY;
      tooth.material.opacity = pose.section > 0.4 ? 0.4 : 1;
      tooth.material.transparent = true;
      canals.visible = pose.canals > 0.04;
      canalMaterial.opacity = pose.canals;
      canalMaterial.transparent = pose.canals < 0.98;
      crown.visible = pose.crown > 0.04;
      crown.position.y = CLEARANCE_MM + pose.lift * travel;
      crownClip.set(new THREE.Vector3(0, 1, 0), -(prepY + crown.position.y));
      crown.material.opacity = pose.crown;
      crown.material.transparent = pose.crown < 0.98;
      const tint = pose.contacts;
      crown.material.color.setRGB(1, 1 - tint * 0.08, 1 - tint * 0.12);
      contours.visible = pose.contacts > 0.2;
      axis.visible = pose.crown > 0.2;
      axis.position.copy(anchors.axis);
    };

    const frameTooth = (box: THREE.Box3) => {
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const radius = Math.max(size.x, size.y, size.z);
      home.target.copy(center);
      home.position.set(center.x + radius * 0.85, center.y + radius * 0.95, center.z + radius * 1.85);
      mainCamera.position.copy(home.position);
      controls.target.copy(center);
      controls.update();
      occlusalCamera.position.set(center.x, center.y + radius * 2.6, center.z);
      occlusalCamera.up.set(0, 0, -1);
      occlusalCamera.lookAt(center);
      mesialCamera.position.set(center.x - radius * 2.5, center.y + radius * 0.15, center.z + radius * 0.35);
      mesialCamera.lookAt(center);
      distalCamera.position.set(center.x + radius * 2.5, center.y + radius * 0.15, center.z + radius * 0.35);
      distalCamera.lookAt(center);
      for (const camera of [mainCamera, occlusalCamera, mesialCamera, distalCamera]) {
        camera.near = Math.max(0.05, radius / 80);
        camera.far = radius * 40;
        camera.updateProjectionMatrix();
      }
    };

    const resetCamera = () => {
      mainCamera.position.copy(home.position);
      controls.target.copy(home.target);
      controls.update();
    };
    const orbit = (yawDeg: number, pitchDeg: number) => {
      const offset = mainCamera.position.clone().sub(controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.theta -= THREE.MathUtils.degToRad(yawDeg);
      spherical.phi = THREE.MathUtils.clamp(spherical.phi - THREE.MathUtils.degToRad(pitchDeg), 0.25, Math.PI - 0.25);
      offset.setFromSpherical(spherical);
      mainCamera.position.copy(controls.target).add(offset);
    };
    const dolly = (factor: number) => {
      const offset = mainCamera.position.clone().sub(controls.target);
      const next = THREE.MathUtils.clamp(offset.length() / factor, 8, 280);
      offset.setLength(next);
      mainCamera.position.copy(controls.target).add(offset);
    };
    const control: StageControl = {
      apply(cmd: ViewerCommand) {
        if (cmd.type === 'rotate') orbit(cmd.yawDeg ?? 0, cmd.pitchDeg ?? 0);
        if (cmd.type === 'zoom') dolly(cmd.factor);
        if (cmd.type === 'reset_view') resetCamera();
      },
      peel(dir) {
        const next = stageIndex(progressRef.current) + (dir === 'out' ? 1 : -1);
        progressRef.current = progressForStage(Math.min(CROWN_STAGES.length - 1, Math.max(0, next)));
        setProgress(progressRef.current);
        setPlaying(false);
      },
      reset: resetCamera,
    };
    bind(control);

    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const base = `/casepacks/dental/${encodeURIComponent(candidateId)}/`;
    void (async () => {
      const manifestResponse = await fetch(`${base}manifest.json`);
      if (!manifestResponse.ok) throw new Error(`Candidate ${candidateId} has no manifest.`);
      const manifest = await manifestResponse.json() as { layers?: Array<{ id?: string; file?: string }> };
      const layers = (manifest.layers ?? []).filter((layer) => layer.file && (layer.id === 'lower-jawbone' || layer.id?.startsWith('tooth-')));
      const loaded = await Promise.all(layers.map(async (layer) => {
        try {
          const gltf = await loader.loadAsync(base + layer.file);
          return { id: layer.id ?? '', geometry: bake(gltf.scene) };
        } catch {
          return { id: layer.id ?? '', geometry: null };
        }
      }));
      if (stopped) return;
      const focus = loaded.find((layer) => layer.id === 'tooth-36')?.geometry;
      if (!focus) throw new Error('This candidate has no tooth 36 surface.');
      for (const layer of loaded) {
        if (!layer.geometry || layer.id === 'tooth-36') continue;
        const mesh = new THREE.Mesh(layer.geometry, boneMaterial(layer.id === 'lower-jawbone' ? 0.78 : 1));
        context.add(mesh);
      }
      tooth.geometry = focus;
      focus.computeBoundingBox();
      const box = focus.boundingBox!;
      const height = box.max.y - box.min.y;
      prepY = box.min.y + height * 0.66;
      travel = Math.max(6, height * 0.42);
      const crownGeometry = buildCrownGeometry(focus);
      const painted = focus.clone();
      paintContacts(painted, prepY);
      crown.geometry = painted;
      crown.position.set(0, 0, 0);
      setSplit(highSurfaceSplit(crownGeometry.getAttribute('position') ? crownGeometry : painted));
      for (const loop of contourLoops(crownGeometry)) {
        const line = new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints(loop),
          new THREE.LineBasicMaterial({ color: '#e7c98a', transparent: true, opacity: 0.7 }),
        );
        contours.add(line);
      }
      const slices = sliceCenters(focus);
      const paths = canalPolylines(slices);
      for (const path of paths) {
        if (path.length < 2) continue;
        const curve = new THREE.CatmullRomCurve3(path.map((point) => new THREE.Vector3(...point)));
        const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, Math.max(0.28, height * 0.02), 8, false), canalMaterial);
        canals.add(tube);
      }
      if (slices.length > 0) {
        const chamber = slices[slices.length - 1]!;
        const pulp = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.45, chamber.radius * 0.28), 18, 12), canalMaterial);
        pulp.scale.set(1.05, 0.32, 0.72);
        pulp.position.set(chamber.x, chamber.y, chamber.z);
        canals.add(pulp);
      }
      const axisLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -height * 0.35, 0), new THREE.Vector3(0, height * 0.95, 0)]),
        new THREE.LineBasicMaterial({ color: '#e2c48a' }),
      );
      axis.add(axisLine);
      const center = box.getCenter(new THREE.Vector3());
      anchors.axis.set(center.x, prepY, center.z);
      anchors.cusp.set(center.x + (box.max.x - center.x) * 0.35, box.max.y, center.z);
      anchors.margin.set(box.max.x, prepY, center.z);
      anchors.clearance.set(center.x, prepY, box.max.z);
      axis.position.copy(anchors.axis);
      frameTooth(box);
      ready = true;
      applyPose(poseAt(progressRef.current));
      setStatus('');
    })().catch((error: unknown) => {
      if (!stopped) setStatus(error instanceof Error ? error.message : 'Tooth 36 could not be loaded.');
    });

    let frame = 0;
    let last = performance.now();
    let lastLabels = 0;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (stopped) return;
      const dt = now - last;
      last = now;
      if (playingRef.current) {
        const next = progressRef.current + dt / 14000;
        progressRef.current = next >= 1 ? 1 : next;
        if (next >= 1) setPlaying(false);
        setProgress(progressRef.current);
      }
      applyPose(poseAt(progressRef.current));
      controls.update();
      mainRenderer.render(scene, mainCamera);
      occlusalRenderer.render(scene, occlusalCamera);
      mesialRenderer.render(scene, mesialCamera);
      distalRenderer.render(scene, distalCamera);
      if (now - lastLabels < 120) return;
      lastLabels = now;
      const rect = mainHost.getBoundingClientRect();
      const project = (point: THREE.Vector3) => {
        const v = point.clone().project(mainCamera);
        return { x: (v.x * 0.5 + 0.5) * rect.width, y: (-v.y * 0.5 + 0.5) * rect.height };
      };
      if (ready && crown.visible) {
        const raised = anchors.clearance.clone();
        raised.y = crown.position.y;
        const lift = crown.position.y;
        const cusp = anchors.cusp.clone();
        cusp.y += lift;
        setLabels([
          { id: 'axis', text: 'Fit axis', ...project(anchors.axis.clone().setY(prepY + lift + travel * 0.45)) },
          { id: 'cusp', text: `Cusp angle ${CROWN_FIT_FIGURES.cuspAngleDeg}°`, ...project(cusp) },
          { id: 'margin', text: `Margin ${CROWN_FIT_FIGURES.marginalGapMm.toFixed(2)} mm`, ...project(anchors.margin.clone().setY(prepY + lift)) },
          { id: 'clearance', text: `Occlusal clearance ${CLEARANCE_MM.toFixed(1)} mm`, ...project(raised) },
        ]);
      } else if (ready) {
        setLabels([{ id: 'section', text: canals.visible ? 'Illustrative canal filling' : 'Tooth 36', ...project(anchors.axis) }]);
      }
    };
    frame = requestAnimationFrame(draw);

    const api = stageRef.current;
    const onZoom = (event: Event) => {
      const factor = Number((event as CustomEvent<number>).detail);
      if (Number.isFinite(factor)) dolly(factor);
    };
    const onReset = () => resetCamera();
    api?.addEventListener('cf-zoom', onZoom);
    api?.addEventListener('cf-reset', onReset);

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      api?.removeEventListener('cf-zoom', onZoom);
      api?.removeEventListener('cf-reset', onReset);
      bind(null);
      resize.disconnect();
      controls.dispose();
      scene.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material?.dispose();
      });
      for (const renderer of [mainRenderer, occlusalRenderer, mesialRenderer, distalRenderer]) {
        renderer.dispose();
        renderer.domElement.remove();
      }
    };
  }, [candidateId]);

  function jump(index: number): void {
    progressRef.current = progressForStage(index);
    setProgress(progressRef.current);
    setPlaying(false);
  }

  const stage = stageIndex(progress);
  const figures = CROWN_FIT_FIGURES;
  return (
    <section class="cf" ref={stageRef} aria-label="Crown fit analysis for tooth 36">
      <header class="cf-head">
        <div>
          <p class="dv-overline">{candidateId.toUpperCase()} · TOOTH 36 · ANALYSIS DATA</p>
          <h2>Crown fit analysis · tooth 36</h2>
        </div>
        <span class="cf-pill">FDI 36</span>
        <span class="cf-pill">Illustrative</span>
        <div class="cf-transport">
          <button type="button" onClick={() => { if (progressRef.current >= 1) jump(0); setPlaying(true); }}>Play</button>
          <button type="button" onClick={() => setPlaying(false)}>Pause</button>
          <button type="button" onClick={() => { jump(0); setPlaying(true); }}>Replay</button>
          <button type="button" onClick={() => jump(0)}>Reset</button>
        </div>
      </header>
      <div class="cf-stages" role="tablist" aria-label="Treatment sequence">
        {CROWN_STAGES.map((item, index) => (
          <button key={item.id} type="button" role="tab" aria-selected={index === stage} class={index === stage ? 'on' : ''} onClick={() => jump(index)}>{item.label}</button>
        ))}
      </div>
      <div class="cf-grid">
        <div class="cf-main" data-orbit>
          <div class="cf-view" ref={mainRef} />
          {labels.map((label) => <span key={label.id} class="cf-callout" style={{ left: `${label.x}px`, top: `${label.y}px` }}>{label.text}</span>)}
          <div class="cf-tools">
            <button type="button" aria-label="Zoom in" onClick={() => stageRef.current?.dispatchEvent(new CustomEvent('cf-zoom', { detail: 1.12 }))}>+</button>
            <button type="button" aria-label="Zoom out" onClick={() => stageRef.current?.dispatchEvent(new CustomEvent('cf-zoom', { detail: 1 / 1.12 }))}>−</button>
            <button type="button" aria-label="Reset view" onClick={() => stageRef.current?.dispatchEvent(new Event('cf-reset'))}>Reset</button>
            <button type="button" aria-label="Toggle full screen" onClick={() => { const node = stageRef.current; if (!node) return; if (document.fullscreenElement) void document.exitFullscreen(); else void node.requestFullscreen(); }}>Full</button>
          </div>
          {status ? <p class="cf-status">{status}</p> : null}
        </div>
        <aside class="cf-side">
          <figure><figcaption>Occlusal</figcaption><div ref={occlusalRef} /></figure>
          <figure><figcaption>Mesial section</figcaption><div ref={mesialRef} /></figure>
          <figure><figcaption>Distal section</figcaption><div ref={distalRef} /></figure>
          <div class="cf-readout">
            <p>Focus region</p>
            <strong>Tooth 36</strong>
            <small>Lower-left first molar. Root-canal training case only.</small>
            <dl>
              <div><dt>Crown height</dt><dd>{figures.crownHeightMm.toFixed(1)} mm</dd></div>
              <div><dt>Occlusal contact</dt><dd>{figures.occlusalContactPct}%</dd></div>
              <div><dt>Marginal gap</dt><dd>{figures.marginalGapMm.toFixed(2)} mm</dd></div>
              <div><dt>Occlusal clearance</dt><dd>{figures.occlusalClearanceMm.toFixed(1)} mm</dd></div>
              <div><dt>Contact area</dt><dd>{figures.contactAreaPct}%</dd></div>
              <div><dt>Canals</dt><dd>Illustrative paths</dd></div>
              <div><dt>Filling</dt><dd>Gutta-percha, illustrative</dd></div>
            </dl>
            <p class="cf-legend"><i class="lo" /> Low <i class="mid" /> Mid <i class="hi" /> High spot</p>
            <small>These figures are a planning overlay. They are not a measured or approved crown.</small>
          </div>
        </aside>
      </div>
      <footer class="cf-metrics">
        <div><span>Seating axis</span><strong>{figures.seatingAxisDeg.toFixed(1)}°</strong><b style={{ width: '28%' }} /></div>
        <div><span>Margin continuity</span><strong>{figures.marginContinuityPct}%</strong><b style={{ width: '98%' }} /></div>
        <div><span>Clearance, average</span><strong>{figures.clearanceAvgMm.toFixed(1)} mm</strong><b style={{ width: '46%' }} /></div>
        <div><span>High-surface share</span><strong>M {split.mesial}% · D {split.distal}%</strong><b style={{ width: `${split.mesial}%` }} /></div>
      </footer>
      <p class="cf-note">Illustrative planning visualization. The canal filling is drawn inside the scanned tooth and is not segmented from this CBCT. Not a clinical measurement.</p>
    </section>
  );
}
