/**
 * Closing-mouth contact map, then an illustrative upper and lower force report.
 * Percents come from the tooth 36 dataset. Upper teeth use the opposing lower share.
 * This is not a T-Scan recording.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RAS_TO_THREE } from '../viewer/logic.js';
import {
  DEMO_FACTORS,
  DEMO_NOTES,
  DEMO_REVIEW,
  LOWER_ORDER,
  UPPER_ORDER,
  crownContactT,
  forceSamples,
  rampColor,
  rampHex,
  sideBalance,
  toothForce,
} from './occlusal-dataset.js';

const RAS = new THREE.Matrix4().set(
  RAS_TO_THREE[0]!, RAS_TO_THREE[1]!, RAS_TO_THREE[2]!, RAS_TO_THREE[3]!,
  RAS_TO_THREE[4]!, RAS_TO_THREE[5]!, RAS_TO_THREE[6]!, RAS_TO_THREE[7]!,
  RAS_TO_THREE[8]!, RAS_TO_THREE[9]!, RAS_TO_THREE[10]!, RAS_TO_THREE[11]!,
  RAS_TO_THREE[12]!, RAS_TO_THREE[13]!, RAS_TO_THREE[14]!, RAS_TO_THREE[15]!,
);

const OPEN_MM = 18;
const CLOSE_S = 2.2;
const HOLD_S = 2.6;
const REOPEN_S = 1.8;

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

function contactColors(geometry: THREE.BufferGeometry, fdi: string): Float32Array {
  const position = geometry.getAttribute('position');
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const height = Math.max(0.001, box.max.y - box.min.y);
  const upper = fdi.startsWith('1') || fdi.startsWith('2');
  const share = toothForce(fdi) / Math.max(0.001, toothForce('36'));
  const colors = new Float32Array(position.count * 3);
  const enamel: [number, number, number] = [0.95, 0.92, 0.86];
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const along = (y - box.min.y) / height;
    let rgb = enamel;
    if (upper) {
      if (along <= 0.72 && share > 0) {
        const edge = Math.pow(1 - along / 0.72, 0.4);
        const patch = 0.84 + 0.16 * Math.sin(x * 0.85) * Math.cos(z * 0.7);
        rgb = rampColor(Math.min(1, edge * patch * (fdi === '26' ? 1 : share)));
      }
    } else if (along >= 0.62 && share > 0) {
      rgb = rampColor(crownContactT(x, y, z, box.min.y + height * 0.62, box.max.y) * (fdi === '36' ? 1 : share));
    }
    colors[i * 3] = rgb[0];
    colors[i * 3 + 1] = rgb[1];
    colors[i * 3 + 2] = rgb[2];
  }
  return colors;
}

function enamelColors(count: number): Float32Array {
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = 0.95;
    colors[i * 3 + 1] = 0.92;
    colors[i * 3 + 2] = 0.86;
  }
  return colors;
}

function smooth(u: number): number {
  const t = Math.min(1, Math.max(0, u));
  return t * t * (3 - 2 * t);
}

function archPoint(index: number, count: number, arch: 'upper' | 'lower'): { x: number; y: number } {
  const t = index / (count - 1);
  const nx = (t - 0.5) * 2;
  const bow = 1 - nx * nx;
  const x = 200 + nx * 162;
  const y = arch === 'upper' ? 36 + (1 - bow) * 228 : 36 + bow * 232;
  return { x, y };
}

function ArchChart({ arch }: { arch: 'upper' | 'lower' }) {
  const order = arch === 'upper' ? UPPER_ORDER : LOWER_ORDER;
  const points = order.map((fdi, index) => ({ fdi, ...archPoint(index, order.length, arch), percent: toothForce(fdi) }));
  const balance = sideBalance();
  const focusY = arch === 'upper' ? 176 : 148;
  let cx = 0;
  let cy = 0;
  let weight = 0;
  for (const point of points) {
    cx += point.x * point.percent;
    cy += point.y * point.percent;
    weight += point.percent;
  }
  cx /= weight;
  cy /= weight;
  const shifted = (scale: number) => points.map((point) => {
    const dx = 200 - point.x;
    const dy = focusY - point.y;
    const length = Math.hypot(dx, dy) || 1;
    return [point.x + (dx / length) * scale, point.y + (dy / length) * scale] as const;
  });
  const outer = shifted(-16);
  const inner = shifted(42).reverse();
  const archPath = `M${outer.map((point) => point.join(',')).join(' L')} L${inner.map((point) => point.join(',')).join(' L')} Z`;
  const rightWidth = (balance.right / 100) * 352;
  return (
    <svg viewBox="0 0 400 340" role="img" aria-label={`${arch} force distribution`}>
      <rect width="400" height="340" fill="#e6e6e6" />
      <path d={archPath} fill="#f7f7f7" stroke="#6f9464" strokeWidth="1.3" />
      {points.map((point) => (
        <line key={`ray-${point.fdi}`} x1="200" y1={focusY} x2={point.x} y2={point.y} stroke="#d5d5d5" strokeWidth="0.7" />
      ))}
      <ellipse cx="200" cy={focusY} rx="44" ry="54" fill="#b5b5b5" />
      <line x1="200" y1={focusY - 58} x2="200" y2={focusY + 58} stroke="#f3f3f3" strokeWidth="1.2" />
      <line x1="152" y1={focusY} x2="248" y2={focusY} stroke="#f3f3f3" strokeWidth="1.2" />
      <circle cx={cx} cy={cy} r="5.5" fill="none" stroke="#c0392b" strokeWidth="1.4" />
      <path d={`M${cx - 9},${cy} h18 M${cx},${cy - 9} v18`} stroke="#c0392b" strokeWidth="1.1" />
      {points.map((point) => {
        const inwardX = 200 - point.x;
        const inwardY = focusY - point.y;
        const length = Math.hypot(inwardX, inwardY) || 1;
        const ux = inwardX / length;
        const uy = inwardY / length;
        const mark = 7 + point.percent * 0.28;
        const spots = point.percent < 2 ? 1 : point.percent < 8 ? 2 : 3;
        return (
          <g key={point.fdi}>
            {Array.from({ length: spots }, (_, spot) => (
              <ellipse
                key={spot}
                cx={point.x + ux * (8 + spot * 6)}
                cy={point.y + uy * (8 + spot * 6)}
                rx={Math.max(2.4, mark * (1 - spot * 0.2))}
                ry={Math.max(1.7, mark * 0.58 * (1 - spot * 0.16))}
                fill={rampHex(point.percent / toothForce('36'))}
                opacity="0.95"
              />
            ))}
            <text x={point.x - ux * 20} y={point.y - uy * 18} textAnchor="middle" fill="#1a1a1a" fontSize="11" fontFamily="sans-serif">{point.fdi}</text>
            <text x={point.x + ux * 22} y={point.y + uy * 14} textAnchor="middle" fill="#2a2a2a" fontSize="8" fontFamily="sans-serif">{point.percent}%</text>
          </g>
        );
      })}
      <text x={24 + rightWidth / 2} y="308" textAnchor="middle" fill="#b42323" fontSize="10" fontFamily="sans-serif">{balance.right}%</text>
      <text x={24 + rightWidth + ((balance.left / 100) * 352) / 2} y="308" textAnchor="middle" fill="#1d7a40" fontSize="10" fontFamily="sans-serif">{balance.left}%</text>
      <rect x="24" y="314" width={rightWidth} height="16" fill="#d64545" />
      <rect x={24 + rightWidth} y="314" width={(balance.left / 100) * 352} height="16" fill="#2f9d57" />
      <text x="32" y="326" fill="#fff" fontSize="10" fontFamily="sans-serif">Right</text>
      <text x="350" y="326" textAnchor="end" fill="#fff" fontSize="10" fontFamily="sans-serif">Left</text>
    </svg>
  );
}

function columnPlace(index: number, count: number): { x: number; z: number } {
  const t = index / (count - 1);
  const nx = (t - 0.5) * 2;
  const bow = Math.pow(1 - nx * nx, 0.9);
  const x = nx * 30;
  const z = 8 + bow * 28;
  return { x, z };
}

function columnScene(arch: 'upper' | 'lower'): THREE.Scene {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xc8c8c8, 1.05));
  const key = new THREE.DirectionalLight(0xffffff, 0.7);
  key.position.set(24, 50, 18);
  scene.add(key);
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(78, 0.45, 48),
    new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.92 }),
  );
  plate.position.set(0, 0.22, 20);
  scene.add(plate);
  const order = arch === 'upper' ? UPPER_ORDER : LOWER_ORDER;
  const curve = new THREE.CatmullRomCurve3(order.map((_fdi, index) => {
    const place = columnPlace(index, order.length);
    return new THREE.Vector3(place.x, 0.55, place.z);
  }));
  scene.add(new THREE.Mesh(
    new THREE.TubeGeometry(curve, 80, 0.28, 5, false),
    new THREE.MeshStandardMaterial({ color: '#c5c5c5', roughness: 0.8 }),
  ));
  const peak = toothForce('36');
  order.forEach((fdi, index) => {
    const place = columnPlace(index, order.length);
    const percent = toothForce(fdi);
    const share = percent / peak;
    const height = 2.2 + share * 24;
    const copies = percent >= 14 ? 3 : percent >= 6 ? 2 : 1;
    const offsets = [0, 2.15, -2.05];
    const scales = [1, 0.58, 0.42];
    for (let copy = 0; copy < copies; copy++) {
      const bar = height * scales[copy]!;
      const color = new THREE.Color(...rampColor(Math.min(1, share * scales[copy]! + (copy === 0 ? 0 : 0.08))));
      const column = new THREE.Mesh(
        new THREE.BoxGeometry(1.35, bar, 1.35),
        new THREE.MeshStandardMaterial({ color, roughness: 0.38 }),
      );
      column.position.set(place.x + offsets[copy]!, bar / 2 + 0.5, place.z + (copy === 0 ? 0 : 1.1));
      scene.add(column);
    }
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const pen = canvas.getContext('2d');
    if (!pen) return;
    pen.fillStyle = '#202020';
    pen.font = 'bold 42px sans-serif';
    pen.textAlign = 'center';
    pen.fillText(fdi, 64, 46);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }));
    const out = Math.sign(place.x) || 1;
    sprite.position.set(place.x + out * 5.2, 1.3, place.z);
    sprite.scale.set(5.2, 2.6, 1);
    scene.add(sprite);
  });
  return scene;
}

export function OcclusalReport({ candidateId }: { candidateId: string }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const upperRef = useRef<HTMLDivElement>(null);
  const lowerRef = useRef<HTMLDivElement>(null);
  const runRef = useRef(false);
  const [phase, setPhase] = useState<'ready' | 'closing' | 'holding' | 'opening' | 'colored'>('ready');
  const [mapStatus, setMapStatus] = useState('Loading both jaws…');
  const samples = forceSamples();
  const phaseText = phase === 'ready'
    ? 'Both jaws are open. Run the simulation to close, reopen, then show contacts.'
    : phase === 'closing'
      ? 'Upper jaw closing onto the lower teeth.'
      : phase === 'holding'
        ? 'Teeth in contact.'
        : phase === 'opening'
          ? 'Returning to the open position.'
          : 'Contact colors are on the upper and lower teeth. Not a measured bite.';

  useEffect(() => {
    const host = mapRef.current;
    if (!host) return;
    let stopped = false;
    const scene = new THREE.Scene();
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor(0x070807, 1);
    host.appendChild(renderer.domElement);
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 4000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    scene.add(new THREE.HemisphereLight(0xfff6ec, 0x2a2620, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.25);
    key.position.set(30, 80, 40);
    scene.add(key);
    const upper = new THREE.Group();
    const lower = new THREE.Group();
    scene.add(upper, lower);
    const painted: Array<{ attribute: THREE.BufferAttribute; enamel: Float32Array; contact: Float32Array }> = [];
    const fit = () => {
      const width = Math.max(host.clientWidth, 40);
      const height = Math.max(host.clientHeight, 40);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const resize = new ResizeObserver(fit);
    resize.observe(host);
    fit();
    const showColors = (on: boolean) => {
      for (const item of painted) {
        item.attribute.array.set(on ? item.contact : item.enamel);
        item.attribute.needsUpdate = true;
      }
    };
    let openY = OPEN_MM;
    let closedY = 0;
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const base = `/casepacks/dental/${encodeURIComponent(candidateId)}/`;
    void (async () => {
      const response = await fetch(`${base}manifest.json`);
      if (!response.ok) throw new Error('This candidate has no jaw to show.');
      const manifest = await response.json() as { layers?: Array<{ id?: string; file?: string }> };
      const layers = (manifest.layers ?? []).filter((layer) => layer.file && (layer.id === 'lower-jawbone' || layer.id === 'upper-jawbone' || layer.id?.startsWith('tooth-')));
      const loaded = await Promise.all(layers.map(async (layer) => {
        try {
          const gltf = await loader.loadAsync(base + layer.file);
          return { id: layer.id ?? '', geometry: bake(gltf.scene) };
        } catch {
          return { id: layer.id ?? '', geometry: null };
        }
      }));
      if (stopped) return;
      for (const layer of loaded) {
        if (!layer.geometry) continue;
        const upperJaw = layer.id === 'upper-jawbone' || layer.id.startsWith('tooth-1') || layer.id.startsWith('tooth-2');
        if (layer.id.startsWith('tooth-')) {
          const fdi = layer.id.slice('tooth-'.length);
          const count = layer.geometry.getAttribute('position').count;
          const enamel = enamelColors(count);
          const contact = contactColors(layer.geometry, fdi);
          const attribute = new THREE.BufferAttribute(enamel.slice(), 3);
          layer.geometry.setAttribute('color', attribute);
          painted.push({ attribute, enamel, contact });
          const mesh = new THREE.Mesh(layer.geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0.03, side: THREE.DoubleSide }));
          mesh.userData.fdi = fdi;
          (upperJaw ? upper : lower).add(mesh);
        } else {
          const mesh = new THREE.Mesh(layer.geometry, new THREE.MeshStandardMaterial({ color: upperJaw ? '#eadcc8' : '#e4d5c0', roughness: 0.72, side: THREE.DoubleSide }));
          (upperJaw ? upper : lower).add(mesh);
        }
      }
      if (upper.children.length === 0 || lower.children.length === 0) throw new Error('This candidate is missing an upper or lower jaw.');
      const bitingY = (group: THREE.Group, pick: 'min' | 'max') => {
        const preferred = (fdi: string) => fdi.endsWith('1') || fdi.endsWith('2') || fdi.endsWith('3');
        const boxes = group.children
          .filter((child) => (child as THREE.Mesh).userData.fdi)
          .map((child) => ({ fdi: String((child as THREE.Mesh).userData.fdi), box: new THREE.Box3().setFromObject(child) }));
        const chosen = boxes.filter((item) => preferred(item.fdi));
        const used = chosen.length > 0 ? chosen : boxes;
        if (used.length === 0) return null;
        return used.reduce((edge, item) => pick === 'min' ? Math.min(edge, item.box.min.y) : Math.max(edge, item.box.max.y), pick === 'min' ? Infinity : -Infinity);
      };
      const upperBite = bitingY(upper, 'min');
      const lowerBite = bitingY(lower, 'max');
      closedY = upperBite !== null && lowerBite !== null ? lowerBite - upperBite + 4 : 0;
      openY = closedY + 28;
      upper.position.y = openY;
      const box = new THREE.Box3().setFromObject(scene);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const radius = Math.max(size.x, size.y, size.z);
      camera.position.set(center.x + radius * 0.15, center.y + radius * 0.28, center.z + radius * 0.95);
      controls.target.copy(center);
      controls.update();
      setMapStatus('');
    })().catch((error: unknown) => {
      if (!stopped) setMapStatus(error instanceof Error ? error.message : 'The jaws could not be loaded.');
    });

    let frame = 0;
    let last = performance.now();
    let running = false;
    let elapsed = 0;
    let shown: typeof phase = 'ready';
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (stopped) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      try {
        if (runRef.current && !running && upper.children.length > 0) {
          runRef.current = false;
          running = true;
          elapsed = 0;
          showColors(false);
          upper.position.y = openY;
        }
        if (running) {
          elapsed += dt;
          let next: typeof phase = 'closing';
          if (elapsed < CLOSE_S) upper.position.y = openY + (closedY - openY) * smooth(elapsed / CLOSE_S);
          else if (elapsed < CLOSE_S + HOLD_S) {
            upper.position.y = closedY;
            next = 'holding';
          } else if (elapsed < CLOSE_S + HOLD_S + REOPEN_S) {
            upper.position.y = closedY + (openY - closedY) * smooth((elapsed - CLOSE_S - HOLD_S) / REOPEN_S);
            next = 'opening';
          } else {
            upper.position.y = openY;
            showColors(true);
            running = false;
            next = 'colored';
          }
          if (next !== shown) {
            shown = next;
            setPhase(next);
          }
        }
      } catch (error) {
        running = false;
        runRef.current = false;
        setMapStatus(error instanceof Error ? error.message : 'The jaw simulation stopped.');
      }
      controls.update();
      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      scene.traverse((node) => {
        const mesh = node as THREE.Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material?.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [candidateId]);

  useEffect(() => {
    const upperHost = upperRef.current;
    const lowerHost = lowerRef.current;
    if (!upperHost || !lowerHost) return;
    let stopped = false;
    const upperScene = columnScene('upper');
    const lowerScene = columnScene('lower');
    const make = (host: HTMLDivElement, scene: THREE.Scene) => {
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.setClearColor(0xd5d5d5, 1);
      host.appendChild(renderer.domElement);
      const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 800);
      camera.position.set(34, 40, 66);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 6, 18);
      controls.enablePan = false;
      controls.update();
      const fit = () => {
        renderer.setSize(Math.max(host.clientWidth, 40), Math.max(host.clientHeight, 40), false);
        camera.aspect = Math.max(host.clientWidth, 40) / Math.max(host.clientHeight, 40);
        camera.updateProjectionMatrix();
      };
      return { renderer, camera, controls, fit };
    };
    const upperView = make(upperHost, upperScene);
    const lowerView = make(lowerHost, lowerScene);
    const resize = new ResizeObserver(() => {
      upperView.fit();
      lowerView.fit();
    });
    resize.observe(upperHost);
    resize.observe(lowerHost);
    upperView.fit();
    lowerView.fit();
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      if (stopped) return;
      upperView.controls.update();
      lowerView.controls.update();
      upperView.renderer.render(upperScene, upperView.camera);
      lowerView.renderer.render(lowerScene, lowerView.camera);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      for (const view of [upperView, lowerView]) {
        view.controls.dispose();
        view.renderer.dispose();
        view.renderer.domElement.remove();
      }
      for (const scene of [upperScene, lowerScene]) {
        scene.traverse((node) => {
          const mesh = node as THREE.Mesh;
          mesh.geometry?.dispose();
          const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
          if (Array.isArray(material)) material.forEach((item) => item.dispose());
          else material?.dispose();
        });
      }
    };
  }, []);

  const width = 640;
  const height = 150;
  const line = (key: 'total' | 'tooth36') => samples.map((sample, index) => {
    const x = (sample.second / 10.5) * width;
    const y = height - 16 - (sample[key] / 100) * (height - 28);
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return (
    <div class="oc">
      <section class="oc-block" aria-label="Occlusal contact map">
        <header class="oc-map-head">
          <div>
            <p class="dv-overline">BOTH JAWS · TOOTH 36 AND THE OPPOSING TOOTH</p>
            <h2>Occlusal contact map</h2>
          </div>
          <button type="button" onClick={() => { runRef.current = true; setPhase('closing'); }} disabled={phase === 'closing' || phase === 'holding' || phase === 'opening'}>
            {phase === 'colored' ? 'Replay simulation' : 'Run simulation'}
          </button>
        </header>
        <div class="oc-map" data-orbit ref={mapRef} />
        {mapStatus ? <p class="oc-note">{mapStatus}</p> : <p class="oc-note">{phaseText}</p>}
      </section>
      <section class="oc-block" aria-label="Illustrative occlusal report">
        <header>
          <p class="dv-overline">NOT A T-SCAN RECORDING</p>
          <h2>Illustrative occlusal report</h2>
        </header>
        <div class="oc-sheets">
          <ArchChart arch="upper" />
          <div class="oc-colview" data-orbit ref={upperRef} />
          <ArchChart arch="lower" />
          <div class="oc-colview" data-orbit ref={lowerRef} />
        </div>
        <p class="oc-note">Upper shares match the opposing lower tooth. Tooth 26 carries the same 24% as tooth 36. Left is 71% and right is 29% on both arches.</p>
        <div class="oc-panel oc-time">
          <h3>Force versus time</h3>
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Illustrative force over 10.5 seconds">
            <path d={line('total')} fill="none" stroke="#e2c14a" strokeWidth="2" />
            <path d={line('tooth36')} fill="none" stroke="#d24b4b" strokeWidth="2" />
            {[0, 2, 4, 6, 8, 10].map((second) => (
              <text key={second} x={(second / 10.5) * width} y={height - 2} fill="#999a91" fontSize="10">{second}s</text>
            ))}
            <text x="8" y="14" fill="#e2c14a" fontSize="10">Total</text>
            <text x="52" y="14" fill="#d24b4b" fontSize="10">Tooth 36 · {toothForce('36')}% of total</text>
          </svg>
          <p>Rest, first contact near 3–4 s, peak at 9.2 s, release by 10.3 s, then rest. Tooth 36 follows the same curve at its arch share.</p>
        </div>
      </section>
      <section class="oc-block" aria-label="Biomechanical factors">
        <header>
          <p class="dv-overline">DEMONSTRATION MARKS, NOT CLINICAL REFERENCE RANGES</p>
          <h2>Crown biomechanics · tooth 36</h2>
        </header>
        <ol class="oc-factors">
          {DEMO_FACTORS.map((item) => (
            <li key={item.name}>
              <div><b>{item.name}</b><span class={`oc-status is-${item.status.toLowerCase()}`}>{item.status}</span></div>
              <strong>{item.value}</strong>
              <i style={{ width: `${item.bar}%` }} />
              <small>{item.explanation}</small>
            </li>
          ))}
        </ol>
      </section>
      <section class="oc-block" aria-label="Analysis and suggested review">
        <header>
          <p class="dv-overline">TRACEABLE TO THE FIGURES ABOVE</p>
          <h2>Analysis and suggested review</h2>
        </header>
        <div class="oc-notes">
          {DEMO_NOTES.map((note) => (
            <article key={note.title}><h3>{note.title}</h3><p>{note.detail}</p></article>
          ))}
        </div>
        <ul class="oc-review">
          {DEMO_REVIEW.map((item) => <li key={item}>{item}</li>)}
        </ul>
        <p class="oc-note">These notes do not prescribe a crown adjustment and do not decide a clinical design.</p>
      </section>
    </div>
  );
}
