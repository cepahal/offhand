/**
 * Surgical extraction planning for FDI tooth 48.
 * The jaw, tooth 48, tooth 47, and the right inferior alveolar canal are the
 * segmented surfaces. The section and the lift are an illustrative sequence.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { CaseNote } from './annotations.js';
import { ModelCallouts } from './ModelCallouts.js';
import { TrackingNotes, type NotePin } from './TrackingNotes.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { ViewerCommand } from '@hoverscan/contracts';
import { RAS_TO_THREE } from '../viewer/logic.js';
import type { StageControl } from './CBCTWorkspace.js';
import {
  EXTRACTION_STAGES,
  closestApproach,
  coverageBelow,
  extractionDirection,
  extractionFactors,
  extractionNotes,
  longAxis,
  pathwayClearance,
  poseAt,
  progressForStage,
  rootCurvatureDeg,
  sampleStride,
  stageIndex,
  type ExtractionMeasures,
  type Vec3,
} from './extraction-plan.js';

const RAS = new THREE.Matrix4().set(
  RAS_TO_THREE[0]!, RAS_TO_THREE[1]!, RAS_TO_THREE[2]!, RAS_TO_THREE[3]!,
  RAS_TO_THREE[4]!, RAS_TO_THREE[5]!, RAS_TO_THREE[6]!, RAS_TO_THREE[7]!,
  RAS_TO_THREE[8]!, RAS_TO_THREE[9]!, RAS_TO_THREE[10]!, RAS_TO_THREE[11]!,
  RAS_TO_THREE[12]!, RAS_TO_THREE[13]!, RAS_TO_THREE[14]!, RAS_TO_THREE[15]!,
);

function keepLayer(id: string): boolean {
  return id === 'lower-jawbone' || id === 'upper-jawbone' || id === 'right-ia-canal' || id.startsWith('tooth-');
}

function bake(root: THREE.Object3D): THREE.BufferGeometry | null {
  root.updateMatrixWorld(true);
  const parts: number[] = [];
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
    const baked = geometry.getAttribute('position');
    for (let i = 0; i < baked.count; i++) parts.push(baked.getX(i), baked.getY(i), baked.getZ(i));
    geometry.dispose();
  });
  if (parts.length < 9) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(parts, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function cloud(geometry: THREE.BufferGeometry, target = 700): Vec3[] {
  const position = geometry.getAttribute('position');
  const stride = sampleStride(position.count, target);
  const points: Vec3[] = [];
  for (let i = 0; i < position.count; i += stride) points.push({ x: position.getX(i), y: position.getY(i), z: position.getZ(i) });
  return points;
}

function round1(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

function splitGeometry(geometry: THREE.BufferGeometry, origin: THREE.Vector3, axis: THREE.Vector3): { crown: THREE.BufferGeometry; root: THREE.BufferGeometry } {
  const position = geometry.getAttribute('position');
  const crown: number[] = [];
  const root: number[] = [];
  for (let i = 0; i + 2 < position.count; i += 3) {
    let side = 0;
    const triangle: number[] = [];
    for (let corner = 0; corner < 3; corner++) {
      const x = position.getX(i + corner);
      const y = position.getY(i + corner);
      const z = position.getZ(i + corner);
      triangle.push(x, y, z);
      side += (x - origin.x) * axis.x + (y - origin.y) * axis.y + (z - origin.z) * axis.z;
    }
    (side >= 0 ? crown : root).push(...triangle);
  }
  const make = (values: number[]) => {
    const next = new THREE.BufferGeometry();
    next.setAttribute('position', new THREE.Float32BufferAttribute(values, 3));
    next.computeVertexNormals();
    return next;
  };
  return { crown: make(crown), root: make(root) };
}

export function ExtractionPlan({
  candidateId,
  bind,
  scanNotes = [],
}: {
  candidateId: string;
  bind: (viewer: StageControl | null) => void;
  scanNotes?: CaseNote[];
}) {
  const mainRef = useRef<HTMLDivElement>(null);
  const sagittalRef = useRef<HTMLDivElement>(null);
  const coronalRef = useRef<HTMLDivElement>(null);
  const axialRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const pinRef = useRef<NotePin | null>(null);
  const scanNotesRef = useRef(scanNotes);
  scanNotesRef.current = scanNotes;
  const progressRef = useRef(progressForStage(0));
  const playingRef = useRef(false);
  const [progress, setProgress] = useState(progressForStage(0));
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState('Loading tooth 48 from this candidate…');
  const [measures, setMeasures] = useState<ExtractionMeasures | null>(null);
  const [labels, setLabels] = useState<Array<{ id: string; text: string; x: number; y: number; behind?: boolean }>>([]);
  playingRef.current = playing;
  const factors = measures ? extractionFactors(measures) : [];
  const notes = measures ? extractionNotes(measures) : [];

  useEffect(() => {
    const mainHost = mainRef.current;
    const sagittalHost = sagittalRef.current;
    const coronalHost = coronalRef.current;
    const axialHost = axialRef.current;
    if (!mainHost || !sagittalHost || !coronalHost || !axialHost) return;
    const hosts = [mainHost, sagittalHost, coronalHost, axialHost];
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
    const sagittalRenderer = makeRenderer(sagittalHost);
    const coronalRenderer = makeRenderer(coronalHost);
    const axialRenderer = makeRenderer(axialHost);
    const mainCamera = new THREE.PerspectiveCamera(32, 1, 0.1, 2000);
    const sagittalCamera = new THREE.PerspectiveCamera(28, 1, 0.1, 2000);
    const coronalCamera = new THREE.PerspectiveCamera(28, 1, 0.1, 2000);
    const axialCamera = new THREE.PerspectiveCamera(28, 1, 0.1, 2000);
    const controls = new OrbitControls(mainCamera, mainRenderer.domElement);
    controls.enablePan = false;
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xfff8ee, 0x2a2620, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.35);
    key.position.set(30, 70, 40);
    scene.add(key);
    const context = new THREE.Group();
    const boneMaterials: THREE.MeshStandardMaterial[] = [];
    const canalMaterial = new THREE.MeshStandardMaterial({
      color: '#f2c230',
      emissive: '#8a6410',
      emissiveIntensity: 0.35,
      roughness: 0.42,
      metalness: 0.02,
      transparent: true,
      opacity: 0,
    });
    const toothMaterial = new THREE.MeshStandardMaterial({
      color: '#f4ead8',
      emissive: '#8a6a32',
      emissiveIntensity: 0.18,
      roughness: 0.42,
      metalness: 0.04,
      side: THREE.DoubleSide,
    });
    const crownMaterial = toothMaterial.clone();
    crownMaterial.color.set('#f7e7c4');
    crownMaterial.emissive.set('#c4923a');
    const rootMaterial = toothMaterial.clone();
    rootMaterial.color.set('#f0c8b4');
    rootMaterial.emissive.set('#a85a3a');
    const intact = new THREE.Mesh(new THREE.BufferGeometry(), toothMaterial);
    const crownPart = new THREE.Mesh(new THREE.BufferGeometry(), crownMaterial);
    const rootPart = new THREE.Mesh(new THREE.BufferGeometry(), rootMaterial);
    crownPart.visible = false;
    rootPart.visible = false;
    const access = new THREE.Mesh(
      new THREE.SphereGeometry(1, 22, 16),
      new THREE.MeshStandardMaterial({ color: '#e08a45', emissive: '#a85a22', emissiveIntensity: 0.3, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }),
    );
    access.visible = false;
    const guides = new THREE.Group();
    const guideMaterial = new THREE.LineBasicMaterial({ color: '#e2c48a' });
    const nerveLine = new THREE.Line(new THREE.BufferGeometry(), guideMaterial);
    const neighborLine = new THREE.Line(new THREE.BufferGeometry(), guideMaterial.clone());
    const axisLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#8fb7d6' }));
    const pathLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#e07a4a' }));
    guides.add(nerveLine, neighborLine, axisLine, pathLine);
    scene.add(context, intact, crownPart, rootPart, access, guides);
    const home = { position: new THREE.Vector3(), target: new THREE.Vector3() };
    const anchors = {
      nerve: new THREE.Vector3(),
      neighbor: new THREE.Vector3(),
      axis: new THREE.Vector3(),
      path: new THREE.Vector3(),
      access: new THREE.Vector3(),
    };
    let direction = new THREE.Vector3(0, 1, 0);
    let ready = false;
    let shown: ExtractionMeasures | null = null;

    const fitHost = (renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, host: HTMLDivElement) => {
      const width = Math.max(host.clientWidth, 40);
      const height = Math.max(host.clientHeight, 40);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const fitAll = () => {
      fitHost(mainRenderer, mainCamera, mainHost);
      fitHost(sagittalRenderer, sagittalCamera, sagittalHost);
      fitHost(coronalRenderer, coronalCamera, coronalHost);
      fitHost(axialRenderer, axialCamera, axialHost);
    };
    const resize = new ResizeObserver(fitAll);
    for (const host of hosts) resize.observe(host);
    fitAll();

    const applyPose = (pose: ReturnType<typeof poseAt>) => {
      if (!ready) return;
      for (const material of boneMaterials) {
        material.opacity = pose.boneOpacity;
        material.transparent = pose.boneOpacity < 0.98;
        material.depthWrite = pose.boneOpacity > 0.85;
      }
      canalMaterial.opacity = pose.canal;
      access.visible = pose.access > 0.04;
      (access.material as THREE.MeshStandardMaterial).opacity = 0.18 + pose.access * 0.28;
      const split = pose.section > 0.04;
      intact.visible = !split;
      crownPart.visible = split;
      rootPart.visible = split;
      const crownTravel = pose.section * 1.2 + pose.lift * 24;
      const rootTravel = pose.section * 0.35 + Math.max(0, (pose.lift - 0.22) / 0.78) * 22;
      crownPart.position.copy(direction).multiplyScalar(crownTravel);
      rootPart.position.copy(direction).multiplyScalar(rootTravel);
      guides.visible = pose.canal > 0.45;
    };

    const outside = (center: THREE.Vector3, direction: THREE.Vector3, jaw: THREE.Box3, start: number) => {
      const outward = direction.clone().normalize();
      let distance = start;
      for (let step = 0; step < 8; step++) {
        const probe = center.clone().add(outward.clone().multiplyScalar(distance));
        if (!jaw.containsPoint(probe)) return probe;
        distance *= 1.35;
      }
      return center.clone().add(outward.multiplyScalar(distance));
    };
    const frameTooth = (box: THREE.Box3) => {
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const radius = Math.max(size.x, size.y, size.z, 8);
      const jaw = new THREE.Box3().setFromObject(context);
      jaw.expandByScalar(2);
      const jawCenter = jaw.getCenter(new THREE.Vector3());
      const jawSize = jaw.getSize(new THREE.Vector3());
      const jawRadius = Math.max(jawSize.x, jawSize.y, jawSize.z, radius);
      home.target.copy(jawCenter);
      home.position.copy(jawCenter.clone().add(new THREE.Vector3(0.2, 0.55, 1).normalize().multiplyScalar(jawRadius * 1.35)));
      mainCamera.position.copy(home.position);
      controls.target.copy(jawCenter);
      controls.update();
      sagittalCamera.position.copy(outside(center, new THREE.Vector3(1, 0.12, 0), jaw, radius * 4));
      sagittalCamera.up.set(0, 1, 0);
      sagittalCamera.lookAt(center);
      coronalCamera.position.copy(outside(center, new THREE.Vector3(0, 0.16, 1), jaw, radius * 4));
      coronalCamera.up.set(0, 1, 0);
      coronalCamera.lookAt(center);
      axialCamera.position.copy(outside(center, new THREE.Vector3(0.08, 1, 0.05), jaw, radius * 4));
      axialCamera.up.set(0, 0, -1);
      axialCamera.lookAt(center);
      for (const camera of [mainCamera, sagittalCamera, coronalCamera, axialCamera]) {
        camera.near = Math.max(0.05, radius / 80);
        camera.far = Math.max(jawRadius, radius) * 40;
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
    bind({
      apply(cmd: ViewerCommand) {
        if (cmd.type === 'rotate') orbit(cmd.yawDeg ?? 0, cmd.pitchDeg ?? 0);
        if (cmd.type === 'zoom') dolly(cmd.factor);
        if (cmd.type === 'reset_view') resetCamera();
      },
      peel(dir) {
        const next = stageIndex(progressRef.current) + (dir === 'out' ? 1 : -1);
        progressRef.current = progressForStage(Math.min(EXTRACTION_STAGES.length - 1, Math.max(0, next)));
        setProgress(progressRef.current);
        setPlaying(false);
      },
      reset: resetCamera,
      goTo() {},
    });

    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const base = `/casepacks/dental/${encodeURIComponent(candidateId)}/`;
    void (async () => {
      const response = await fetch(`${base}manifest.json`);
      if (!response.ok) throw new Error(`Candidate ${candidateId} has no manifest.`);
      const manifest = await response.json() as { layers?: Array<{ id?: string; file?: string }> };
      const layers = (manifest.layers ?? []).filter((layer) => layer.file && keepLayer(layer.id ?? ''));
      const loaded = await Promise.all(layers.map(async (layer) => {
        try {
          const gltf = await loader.loadAsync(base + layer.file);
          return { id: layer.id ?? '', geometry: bake(gltf.scene) };
        } catch {
          return { id: layer.id ?? '', geometry: null };
        }
      }));
      if (stopped) return;
      const focus = loaded.find((layer) => layer.id === 'tooth-48')?.geometry;
      if (!focus) throw new Error('This candidate has no tooth 48 surface.');
      const canalGeometry = loaded.find((layer) => layer.id === 'right-ia-canal')?.geometry ?? null;
      const neighborGeometry = loaded.find((layer) => layer.id === 'tooth-47')?.geometry ?? null;
      for (const layer of loaded) {
        if (!layer.geometry || layer.id === 'tooth-48' || layer.id === 'right-ia-canal') continue;
        const jaw = layer.id.endsWith('jawbone');
        const material = new THREE.MeshStandardMaterial({
          color: jaw ? '#e7d7c2' : '#f4efe6',
          roughness: jaw ? 0.72 : 0.42,
          metalness: 0.02,
          transparent: jaw,
          opacity: layer.id === 'upper-jawbone' ? 0.38 : 1,
          side: THREE.DoubleSide,
          depthWrite: !jaw,
        });
        if (layer.id === 'lower-jawbone') boneMaterials.push(material);
        context.add(new THREE.Mesh(layer.geometry, material));
      }
      if (canalGeometry) context.add(new THREE.Mesh(canalGeometry, canalMaterial));
      intact.geometry = focus;
      crownPart.geometry = focus;
      rootPart.geometry = focus;
      focus.computeBoundingBox();
      const box = focus.boundingBox!;
      const center = box.getCenter(new THREE.Vector3());
      const toothPoints = cloud(focus, 2200);
      const canalPoints = canalGeometry ? cloud(canalGeometry, 2200) : [];
      const neighborPoints = neighborGeometry ? cloud(neighborGeometry, 1200) : [];
      const nerve = closestApproach(toothPoints, canalPoints);
      const neighbor = closestApproach(toothPoints, neighborPoints);
      const axis = longAxis(toothPoints);
      const neighborTop = neighborPoints.length === 0 ? box.max.y : neighborPoints.reduce((top, item) => Math.max(top, item.y), -Infinity);
      const away = nerve ? { x: nerve.from.x - nerve.to.x, y: nerve.from.y - nerve.to.y, z: nerve.from.z - nerve.to.z } : null;
      const path = extractionDirection(axis.direction, away);
      direction.set(path.x, path.y, path.z);
      const parts = splitGeometry(focus, center, direction);
      crownPart.geometry = parts.crown;
      rootPart.geometry = parts.root;
      const pathwayMm = pathwayClearance(center, path, canalPoints);
      shown = {
        canalSegmented: canalPoints.length > 0,
        nerve,
        neighbor,
        angleDeg: axis.angleFromVerticalDeg,
        axis: axis.direction,
        depthMm: neighborTop - box.max.y,
        curvatureDeg: rootCurvatureDeg(toothPoints),
        boneCoveragePct: coverageBelow(toothPoints, neighborTop),
        pathwayMm,
        pathwayDir: path,
      };
      const span = Math.max(box.max.y - box.min.y, 8);
      if (nerve) {
        nerveLine.geometry.setFromPoints([new THREE.Vector3(nerve.from.x, nerve.from.y, nerve.from.z), new THREE.Vector3(nerve.to.x, nerve.to.y, nerve.to.z)]);
        anchors.nerve.set(nerve.from.x, nerve.from.y, nerve.from.z);
      }
      if (neighbor) {
        neighborLine.geometry.setFromPoints([new THREE.Vector3(neighbor.from.x, neighbor.from.y, neighbor.from.z), new THREE.Vector3(neighbor.to.x, neighbor.to.y, neighbor.to.z)]);
        anchors.neighbor.set(neighbor.from.x, neighbor.from.y, neighbor.from.z);
      }
      const axisEnd = center.clone().add(direction.clone().multiplyScalar(span * 0.7));
      const axisStart = center.clone().add(direction.clone().multiplyScalar(-span * 0.45));
      axisLine.geometry.setFromPoints([axisStart, axisEnd]);
      anchors.axis.copy(axisEnd);
      const pathEnd = center.clone().add(direction.clone().multiplyScalar(14));
      pathLine.geometry.setFromPoints([new THREE.Vector3(center.x, box.max.y, center.z), pathEnd]);
      anchors.path.copy(pathEnd);
      access.position.set(center.x, box.max.y + span * 0.04, center.z);
      access.scale.set(span * 0.22, span * 0.08, span * 0.22);
      anchors.access.copy(access.position);
      frameTooth(box);
      ready = true;
      applyPose(poseAt(progressRef.current));
      setMeasures(shown);
      setStatus('');
    })().catch((error: unknown) => {
      if (!stopped) setStatus(error instanceof Error ? error.message : 'Tooth 48 could not be loaded.');
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
        const next = progressRef.current + dt / 1600;
        progressRef.current = next >= 1 ? 1 : next;
        if (next >= 1) setPlaying(false);
        setProgress(progressRef.current);
      }
      applyPose(poseAt(progressRef.current));
      controls.update();
      mainRenderer.render(scene, mainCamera);
      if (scanNotesRef.current.length > 0) pinRef.current?.project(mainCamera, anchors.axis);
      sagittalRenderer.render(scene, sagittalCamera);
      coronalRenderer.render(scene, coronalCamera);
      axialRenderer.render(scene, axialCamera);
      if (now - lastLabels < 140 || !shown) return;
      lastLabels = now;
      const pose = poseAt(progressRef.current);
      if (pose.canal < 0.45) {
        setLabels([]);
        return;
      }
      const rect = mainHost.getBoundingClientRect();
      const project = (point: THREE.Vector3) => {
        const view = point.clone().project(mainCamera);
        return { x: (view.x * 0.5 + 0.5) * rect.width, y: (-view.y * 0.5 + 0.5) * rect.height, behind: view.z > 1 };
      };
      const nextLabels = [
        { id: 'axis', text: `Axis ${round1(shown.angleDeg)}°`, ...project(anchors.axis) },
        { id: 'depth', text: shown.depthMm >= 0 ? `Depth ${round1(shown.depthMm)} mm below` : `${round1(-shown.depthMm)} mm above 47`, ...project(anchors.access) },
        { id: 'path', text: 'Illustrative path', ...project(anchors.path) },
      ];
      if (shown.nerve) nextLabels.push({ id: 'nerve', text: `Canal ${round1(shown.nerve.distance)} mm`, ...project(anchors.nerve) });
      if (shown.neighbor) nextLabels.push({ id: 'molar', text: `Tooth 47 ${round1(shown.neighbor.distance)} mm`, ...project(anchors.neighbor) });
      setLabels(nextLabels);
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
        mesh.geometry?.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material?.dispose();
      });
      for (const renderer of [mainRenderer, sagittalRenderer, coronalRenderer, axialRenderer]) {
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
  return (
    <>
      <section class="cf" ref={stageRef} aria-label="Extraction planning for tooth 48">
        <header class="cf-head">
          <div>
            <p class="dv-overline">{candidateId.toUpperCase()} · TOOTH 48 · ANALYSIS DATA</p>
            <h2>Extraction planning · tooth 48</h2>
          </div>
          <span class="cf-pill">FDI 48</span>
          <span class="cf-pill">Illustrative</span>
          <div class="cf-transport">
            <button type="button" onClick={() => { if (stageIndex(progressRef.current) >= EXTRACTION_STAGES.length - 1) { progressRef.current = 0; setProgress(0); } setPlaying(true); }}>Play</button>
            <button type="button" onClick={() => setPlaying(false)}>Pause</button>
            <button type="button" onClick={() => { jump(0); setPlaying(true); }}>Replay</button>
            <button type="button" onClick={() => jump(0)}>Reset</button>
          </div>
        </header>
        <div class="cf-stages" role="tablist" aria-label="Extraction sequence">
          {EXTRACTION_STAGES.map((item, index) => (
            <button key={item.id} type="button" role="tab" aria-selected={index === stage} class={index === stage ? 'on' : ''} onClick={() => jump(index)}>{item.label}</button>
          ))}
        </div>
        <div class="cf-grid">
          <div class="cf-main" data-orbit>
            <div class="cf-view" ref={mainRef} />
            <ModelCallouts labels={labels} />
            <TrackingNotes notes={scanNotes} pin={pinRef} />
            <div class="cf-tools">
              <button type="button" aria-label="Zoom in" onClick={() => stageRef.current?.dispatchEvent(new CustomEvent('cf-zoom', { detail: 1.12 }))}>+</button>
              <button type="button" aria-label="Zoom out" onClick={() => stageRef.current?.dispatchEvent(new CustomEvent('cf-zoom', { detail: 1 / 1.12 }))}>−</button>
              <button type="button" aria-label="Reset view" onClick={() => stageRef.current?.dispatchEvent(new Event('cf-reset'))}>Reset</button>
              <button type="button" aria-label="Toggle full screen" onClick={() => { const node = stageRef.current; if (!node) return; if (document.fullscreenElement) void document.exitFullscreen(); else void node.requestFullscreen(); }}>Full</button>
            </div>
            {status ? <p class="cf-status">{status}</p> : null}
          </div>
          <aside class="cf-side">
            <figure><figcaption>Sagittal</figcaption><div ref={sagittalRef} /></figure>
            <figure><figcaption>Coronal</figcaption><div ref={coronalRef} /></figure>
            <figure><figcaption>Axial</figcaption><div ref={axialRef} /></figure>
            <div class="cf-readout">
              <p>Focus region</p>
              <strong>Tooth 48</strong>
              <small>Lower-right third molar. Impacted-tooth training case only.</small>
              <dl>
                <div><dt>Canal</dt><dd>{measures?.canalSegmented ? 'Segmented right IAN' : 'Not in this scan'}</dd></div>
                <div><dt>Nerve gap</dt><dd>{measures?.nerve ? `${round1(measures.nerve.distance)} mm` : '—'}</dd></div>
                <div><dt>Axis</dt><dd>{measures ? `${round1(measures.angleDeg)}°` : '—'}</dd></div>
                <div><dt>Depth</dt><dd>{measures ? `${round1(measures.depthMm)} mm` : '—'}</dd></div>
                <div><dt>Root curve</dt><dd>{measures ? `${round1(measures.curvatureDeg)}°` : '—'}</dd></div>
                <div><dt>Tooth 47</dt><dd>{measures?.neighbor ? `${round1(measures.neighbor.distance)} mm` : '—'}</dd></div>
              </dl>
              <p class="cf-legend"><i class="mid" /> Canal <i class="hi" /> Access <i class="lo" /> Axis</p>
              <small>{EXTRACTION_STAGES[stage]?.label}. The canal is not moved. Bone is only made transparent.</small>
            </div>
          </aside>
        </div>
        <footer class="cf-metrics">
          <div><span>Nerve proximity</span><strong>{measures?.nerve ? `${round1(measures.nerve.distance)} mm` : '—'}</strong><b style={{ width: factors[0] ? `${factors[0].bar}%` : '0%' }} /></div>
          <div><span>Impaction angle</span><strong>{measures ? `${round1(measures.angleDeg)}°` : '—'}</strong><b style={{ width: factors[1] ? `${factors[1].bar}%` : '0%' }} /></div>
          <div><span>Bone coverage</span><strong>{measures ? `${round1(measures.boneCoveragePct)}%` : '—'}</strong><b style={{ width: factors[4] ? `${factors[4].bar}%` : '0%' }} /></div>
          <div><span>Pathway clearance</span><strong>{measures?.pathwayMm === null || measures?.pathwayMm === undefined ? '—' : `${round1(measures.pathwayMm)} mm`}</strong><b style={{ width: factors[6] ? `${factors[6].bar}%` : '0%' }} /></div>
        </footer>
        <p class="cf-note">Illustrative extraction sequence on the segmented tooth 48. Distances are between scan surfaces. The section, access window, and removal path are not a surgical plan.</p>
      </section>
      <section class="oc-block" aria-label="Wisdom tooth surgical factors">
        <header>
          <p class="dv-overline">DEMONSTRATION MARKS, NOT CLINICAL REFERENCE RANGES</p>
          <h2>Surgical analysis · tooth 48</h2>
        </header>
        <ol class="oc-factors">
          {factors.map((item) => (
            <li key={item.name}>
              <div><b>{item.name}</b><span class={`oc-status is-${item.status.toLowerCase()}`}>{item.status}</span></div>
              <strong>{item.value}</strong>
              <i style={{ width: `${item.bar}%` }} />
              <small>{item.explanation}</small>
            </li>
          ))}
        </ol>
      </section>
      <section class="oc-block" aria-label="Surgical planning observations">
        <header>
          <p class="dv-overline">TRACEABLE TO THE SEGMENTED SURFACES</p>
          <h2>Surgical planning observations</h2>
        </header>
        <div class="oc-notes">
          {notes.map((note) => <article key={note.title}><h3>{note.title}</h3><p>{note.detail}</p></article>)}
        </div>
        <p class="oc-note">These notes do not prescribe an extraction technique and do not decide surgical risk.</p>
      </section>
    </>
  );
}
