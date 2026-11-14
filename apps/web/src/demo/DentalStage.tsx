/**
 * Reference mouth mesh plus three synthetic cross-sections of that same mesh.
 * The sections are not a CBCT volume. They are slabs cut from the mesh at the yellow finding.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ViewerCommand } from '@hoverscan/contracts';
import type { CaseNote } from './annotations.js';
import { TREATMENT_ANCHORS } from './annotations.js';
import type { DentalTraining } from './dental-anatomy.js';

export type StageControl = { apply: (cmd: ViewerCommand) => void; peel: (dir: 'out' | 'in') => void; reset: () => void };
export type SlicePlane = 'axial' | 'coronal' | 'sagittal';
type StageStatus = 'loading' | 'ready' | 'empty' | 'error';

const PLANES: SlicePlane[] = ['axial', 'coronal', 'sagittal'];

let shared: Promise<THREE.BufferGeometry> | null = null;

function mouthGeometry(): Promise<THREE.BufferGeometry> {
  if (!shared) {
    shared = new Promise((resolve, reject) => {
      new STLLoader().load(
        '/dental/ref/mouth.stl',
        (geom) => {
          if (geom.getAttribute('position').count === 0) {
            reject(new Error('empty'));
            return;
          }
          const smooth = mergeVertices(geom, 1e-4);
          geom.dispose();
          smooth.computeVertexNormals();
          smooth.center();
          smooth.rotateX(-Math.PI / 2);
          resolve(smooth);
        },
        undefined,
        () => reject(new Error('load')),
      );
    });
  }
  return shared;
}

function sliceMaterial(axis: number, center: THREE.Vector3, half: { value: number }): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.45,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCenter = { value: center };
    shader.uniforms.uHalf = half;
    shader.uniforms.uAxis = { value: axis };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDentalWorld;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvDentalWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDentalWorld;\nuniform vec3 uCenter;\nuniform float uHalf;\nuniform float uAxis;')
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        float dentalDelta = uAxis < 0.5 ? vDentalWorld.x - uCenter.x : uAxis < 1.5 ? vDentalWorld.y - uCenter.y : vDentalWorld.z - uCenter.z;
        if (abs(dentalDelta) > uHalf) discard;`,
      );
  };
  mat.customProgramCacheKey = () => 'dental-slice';
  return mat;
}

export function DentalStage({
  index,
  notes,
  bind,
}: {
  index: DentalTraining['n'];
  notes: CaseNote[];
  bind: (viewer: StageControl | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const calloutRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<SVGLineElement>(null);
  const dotRef = useRef<HTMLElement>(null);
  const hasNotesRef = useRef(false);
  const axialRef = useRef<HTMLCanvasElement>(null);
  const coronalRef = useRef<HTMLCanvasElement>(null);
  const sagittalRef = useRef<HTMLCanvasElement>(null);
  hasNotesRef.current = notes.length > 0;
  const bindRef = useRef(bind);
  const controlRef = useRef<StageControl | null>(null);
  const placeRef = useRef<(n: DentalTraining['n']) => void>(() => {});
  const indexRef = useRef(index);
  const [status, setStatus] = useState<StageStatus>('loading');
  const [plane, setPlane] = useState<SlicePlane>('axial');
  bindRef.current = bind;
  indexRef.current = index;

  useEffect(() => {
    const el = host.current;
    const axialCanvas = axialRef.current;
    const coronalCanvas = coronalRef.current;
    const sagittalCanvas = sagittalRef.current;
    if (!el || !axialCanvas || !coronalCanvas || !sagittalCanvas) return;
    const canvases = { axial: axialCanvas, coronal: coronalCanvas, sagittal: sagittalCanvas };

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 5000);
    const controls = new OrbitControls(camera, renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xfff6ee, 0x2a241c, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.35);
    key.position.set(0.4, 1, 1);
    camera.add(key);
    scene.add(camera);

    const homePos = new THREE.Vector3();
    const homeTarget = new THREE.Vector3();
    const goal = new THREE.Vector3();
    let glide = false;
    let peel = 0;
    let peelGoal = 0;
    let shell: THREE.Mesh | null = null;
    const anchor = new THREE.Vector3();
    const scratch = new THREE.Vector3();
    const ivory = new THREE.Color(0xf4efe4);
    const yellow = new THREE.Color(0xf5d33b);
    let mouth: THREE.Mesh | null = null;
    let alive = true;

    const sliceRenderers: Record<SlicePlane, THREE.WebGLRenderer> = {
      axial: new THREE.WebGLRenderer({ canvas: canvases.axial, antialias: true }),
      coronal: new THREE.WebGLRenderer({ canvas: canvases.coronal, antialias: true }),
      sagittal: new THREE.WebGLRenderer({ canvas: canvases.sagittal, antialias: true }),
    };
    const sliceScenes: Record<SlicePlane, THREE.Scene> = { axial: new THREE.Scene(), coronal: new THREE.Scene(), sagittal: new THREE.Scene() };
    const sliceCams: Record<SlicePlane, THREE.OrthographicCamera> = {
      axial: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10),
      coronal: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10),
      sagittal: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10),
    };
    const cut: Record<SlicePlane, { center: THREE.Vector3; half: { value: number } }> = {
      axial: { center: new THREE.Vector3(), half: { value: 1 } },
      coronal: { center: new THREE.Vector3(), half: { value: 1 } },
      sagittal: { center: new THREE.Vector3(), half: { value: 1 } },
    };
    const axisIndex: Record<SlicePlane, number> = { sagittal: 0, axial: 1, coronal: 2 };
    for (const name of PLANES) {
      sliceRenderers[name].setClearColor(0x10141c);
      sliceScenes[name].add(new THREE.HemisphereLight(0xffffff, 0x222222, 1.3));
    }

    const place = (n: DentalTraining['n']) => {
      if (!mouth) return;
      if (!mouth.geometry.boundingBox) mouth.geometry.computeBoundingBox();
      const box = mouth.geometry.boundingBox!.clone();
      const size = box.getSize(new THREE.Vector3());
      const [nx, ny, nz] = TREATMENT_ANCHORS[n].spot;
      const target = new THREE.Vector3(box.min.x + size.x * nx, box.min.y + size.y * ny, box.min.z + size.z * nz);
      anchor.copy(target);
      const radius = Math.max(size.x, size.y, size.z) * 0.075;
      const pos = mouth.geometry.getAttribute('position');
      const colors = mouth.geometry.getAttribute('color');
      const vertex = new THREE.Vector3();
      for (let i = 0; i < pos.count; i += 1) {
        vertex.fromBufferAttribute(pos as THREE.BufferAttribute, i);
        const color = vertex.distanceTo(target) < radius ? yellow : ivory;
        (colors as THREE.BufferAttribute).setXYZ(i, color.r, color.g, color.b);
      }
      (colors as THREE.BufferAttribute).needsUpdate = true;
      const half = {
        axial: size.y * 0.07,
        coronal: size.z * 0.07,
        sagittal: size.x * 0.07,
      };
      for (const name of PLANES) {
        cut[name].center.copy(target);
        cut[name].half.value = half[name];
      }
    };
    placeRef.current = place;

    const frameSlices = (box: THREE.Box3) => {
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const fit = (cam: THREE.OrthographicCamera, width: number, height: number, eye: THREE.Vector3, up: THREE.Vector3) => {
        const aspect = 1;
        const halfW = width * 0.55;
        const halfH = height * 0.55;
        cam.left = -halfW * aspect;
        cam.right = halfW * aspect;
        cam.top = halfH;
        cam.bottom = -halfH;
        cam.position.copy(eye);
        cam.up.copy(up);
        cam.lookAt(center);
        cam.near = 0.01;
        cam.far = size.length() * 4;
        cam.updateProjectionMatrix();
      };
      fit(sliceCams.axial, size.x, size.z, new THREE.Vector3(center.x, box.max.y + size.y, center.z), new THREE.Vector3(0, 0, 1));
      fit(sliceCams.coronal, size.x, size.y, new THREE.Vector3(center.x, center.y, box.max.z + size.z), new THREE.Vector3(0, 1, 0));
      fit(sliceCams.sagittal, size.z, size.y, new THREE.Vector3(box.max.x + size.x, center.y, center.z), new THREE.Vector3(0, 1, 0));
    };

    setStatus('loading');
    void mouthGeometry()
      .then((geom) => {
        if (!alive) return;
        if (geom.getAttribute('position').count === 0) {
          setStatus('empty');
          return;
        }
        const geomCopy = geom.clone();
        const count = geomCopy.getAttribute('position').count;
        geomCopy.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        mouth = new THREE.Mesh(geomCopy, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.02 }));
        scene.add(mouth);
        shell = new THREE.Mesh(
          geomCopy,
          new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.02, transparent: true, opacity: 0.38, depthWrite: false }),
        );
        shell.scale.setScalar(1.03);
        scene.add(shell);
        for (const name of PLANES) {
          const mat = sliceMaterial(axisIndex[name], cut[name].center, cut[name].half);
          sliceScenes[name].add(new THREE.Mesh(geomCopy, mat));
        }
        const box = new THREE.Box3().setFromObject(mouth);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const dist = (size.length() / 2) / Math.sin(THREE.MathUtils.degToRad(16));
        controls.target.copy(center);
        camera.position.set(center.x, center.y + size.y * 0.08, center.z + dist * 0.72);
        camera.near = Math.max(0.01, dist / 200);
        camera.far = dist * 20;
        camera.lookAt(center);
        camera.updateProjectionMatrix();
        homePos.copy(camera.position);
        homeTarget.copy(controls.target);
        goal.copy(camera.position);
        frameSlices(box);
        place(indexRef.current);
        setStatus('ready');
      })
      .catch((err: Error) => {
        if (!alive) return;
        setStatus(err.message === 'empty' ? 'empty' : 'error');
      });

    const control: StageControl = {
      apply(cmd) {
        if (cmd.type === 'zoom' && cmd.factor > 0) {
          const offset = goal.clone().sub(controls.target).multiplyScalar(1 / cmd.factor);
          goal.copy(controls.target).add(offset);
          glide = true;
        } else if (cmd.type === 'rotate') {
          const sph = new THREE.Spherical().setFromVector3(goal.clone().sub(controls.target));
          sph.theta -= THREE.MathUtils.degToRad(cmd.yawDeg ?? 0);
          sph.phi = Math.min(Math.PI - 0.08, Math.max(0.08, sph.phi + THREE.MathUtils.degToRad(cmd.pitchDeg ?? 0)));
          goal.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sph));
          glide = true;
        } else if (cmd.type === 'peel') {
          control.peel(cmd.dir);
        }
      },
      peel(dir) {
        peelGoal = Math.max(0, Math.min(3, peelGoal + (dir === 'out' ? 1 : -1)));
      },
      reset() {
        goal.copy(homePos);
        controls.target.copy(homeTarget);
        glide = true;
        peelGoal = 0;
      },
    };
    controls.addEventListener('start', () => { glide = false; });
    controls.addEventListener('end', () => { goal.copy(camera.position); });
    controlRef.current = control;
    bindRef.current(control);

    const resize = () => {
      const w = el.clientWidth;
      const h = Math.max(el.clientHeight, 1);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      for (const name of PLANES) {
        const canvas = canvases[name];
        const width = Math.max(canvas.clientWidth, 1);
        const height = Math.max(canvas.clientHeight, 1);
        sliceRenderers[name].setSize(width, height, false);
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    for (const name of PLANES) ro.observe(canvases[name]);
    resize();
    const projectNotes = () => {
      const callout = calloutRef.current;
      const stack = stackRef.current;
      const line = lineRef.current;
      const dot = dotRef.current;
      if (!callout || !stack || !line || !dot) return;
      const stage = el.closest('.dv-stage');
      if (!stage || !hasNotesRef.current || !mouth) {
        callout.style.visibility = 'hidden';
        return;
      }
      const stageRect = stage.getBoundingClientRect();
      const jawRect = el.getBoundingClientRect();
      scratch.copy(anchor).project(camera);
      if (scratch.z > 1) {
        callout.style.visibility = 'hidden';
        return;
      }
      const x = jawRect.left - stageRect.left + (scratch.x * 0.5 + 0.5) * jawRect.width;
      const y = jawRect.top - stageRect.top + (-scratch.y * 0.5 + 0.5) * jawRect.height;
      const jawX = jawRect.left - stageRect.left;
      const jawY = jawRect.top - stageRect.top;
      const margin = 12;
      const cardW = 210;
      const cardH = Math.max(stack.offsetHeight, 36);
      // Keep the card inside the viewer, on the right edge, off the mesh.
      const cardX = Math.max(jawX + margin, jawX + jawRect.width - cardW - margin);
      let cardY = jawY + 40;
      const jawBottom = jawY + jawRect.height - margin;
      if (cardY + cardH > jawBottom) cardY = Math.max(jawY + margin, jawBottom - cardH);
      stack.style.left = `${cardX}px`;
      stack.style.top = `${cardY}px`;
      dot.style.left = `${x}px`;
      dot.style.top = `${y}px`;
      line.setAttribute('x1', String(x));
      line.setAttribute('y1', String(y));
      line.setAttribute('x2', String(cardX));
      line.setAttribute('y2', String(cardY + Math.min(18, cardH / 2)));
      callout.style.visibility = 'visible';
    };
    let raf = 0;
    const loop = () => {
      controls.update();
      if (glide) {
        camera.position.lerp(goal, 0.16);
        camera.lookAt(controls.target);
        if (camera.position.distanceTo(goal) < 1e-5) glide = false;
      }
      peel += (peelGoal - peel) * 0.14;
      if (mouth) mouth.position.y = -peel * 0.006;
      if (shell) shell.position.y = peel * 0.01;
      renderer.render(scene, camera);
      for (const name of PLANES) sliceRenderers[name].render(sliceScenes[name], sliceCams[name]);
      projectNotes();
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      for (const name of PLANES) sliceRenderers[name].dispose();
      bindRef.current(null);
    };
  }, []);

  useEffect(() => {
    placeRef.current(index);
  }, [index]);

  const message = status === 'loading'
    ? 'Loading the reference mouth…'
    : status === 'error'
      ? 'The mouth mesh did not load.'
      : status === 'empty'
        ? 'The mouth mesh has no surface.'
        : '';

  return (
    <>
      <div class="dv-jaw" ref={host} data-training={index} data-status={status}>
        <p class="dv-finding">{TREATMENT_ANCHORS[index].label}</p>
        {message && <p class="dv-state">{message}</p>}
        <p class="dv-synth">Reference mouth mesh, CC BY 4.0. Not this chart.</p>
      </div>
      <div class="dv-callout" ref={calloutRef} data-notes={notes.length}>
        <svg class="dv-note-line" aria-hidden="true">
          <line ref={lineRef} stroke="#f5d33b" stroke-width="1.5" />
        </svg>
        <i class="dv-anchor-dot" ref={dotRef} />
        <div class="dv-note-stack" ref={stackRef}>
          {notes.map((note) => (
            <article class="dv-note" key={note.id}>{note.text}</article>
          ))}
        </div>
      </div>
      <div class="dv-slicebar">
        {PLANES.map((name) => (
          <button key={name} type="button" class={plane === name ? 'on' : ''} onClick={() => setPlane(name)}>
            {name[0]!.toUpperCase() + name.slice(1)}
          </button>
        ))}
        <button class="dv-reset" type="button" onClick={() => controlRef.current?.reset()}>Reset</button>
      </div>
      <div class="dv-slices">
        {PLANES.map((name) => (
          <figure class={`dv-plane ${plane === name ? 'on' : ''}`} key={name}>
            <canvas ref={name === 'axial' ? axialRef : name === 'coronal' ? coronalRef : sagittalRef} />
            {status !== 'ready' && <p class="dv-state">{message}</p>}
          </figure>
        ))}
      </div>
      <p class="dv-section-note">Synthetic sections of this mesh. Not a CBCT volume.</p>
    </>
  );
}
