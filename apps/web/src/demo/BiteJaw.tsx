/**
 * Separate three.js view of the same reference mouth.
 * The upper and lower halves are copies, so the Neuroview viewer is left alone.
 * Contact markers are illustrative points, not a measured stress field.
 */
import { useEffect, useRef } from 'preact/hooks';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BiteScenario } from './bite-scenarios.js';
import { BAND_COLOR, contactLayout, toothAnchor } from './bite-view.js';

function jawMaterial(keepUpper: boolean): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: keepUpper ? '#f4efe4' : '#e4d3bc',
    roughness: 0.55,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSplit = { value: 0 };
    shader.uniforms.uKeep = { value: keepUpper ? 1 : -1 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vBiteY;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvBiteY = position.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vBiteY;\nuniform float uSplit;\nuniform float uKeep;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n if (uKeep * (vBiteY - uSplit) < 0.0) discard;');
  };
  mat.customProgramCacheKey = () => (keepUpper ? 'bite-jaw-upper' : 'bite-jaw-lower');
  return mat;
}

export function BiteJaw({ scenario, progress }: { scenario: BiteScenario; progress: number }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<{ upper: THREE.Mesh; lower: THREE.Mesh; contacts: THREE.Group; tooth: THREE.Mesh; size: THREE.Vector3 } | null>(null);
  const propsRef = useRef({ scenario, progress });
  propsRef.current = { scenario, progress };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setClearColor(0x10131a, 1);
    renderer.setPixelRatio(1);
    const fit = () => {
      const width = Math.max(el.clientWidth, 320);
      const height = Math.max(el.clientHeight, 420);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 10);
    fit();
    const resize = new ResizeObserver(() => fit());
    resize.observe(el);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.target.set(0, 0, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const key = new THREE.DirectionalLight(0xfff6e8, 1.3);
    key.position.set(0.2, 0.4, 0.3);
    scene.add(key);
    const contacts = new THREE.Group();
    scene.add(contacts);
    const tooth = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), new THREE.MeshStandardMaterial({ color: '#f5d33b', emissive: '#f5d33b', emissiveIntensity: 0.35 }));
    scene.add(tooth);
    let stopped = false;
    const upper = new THREE.Mesh(new THREE.BufferGeometry(), jawMaterial(true));
    const lower = new THREE.Mesh(new THREE.BufferGeometry(), jawMaterial(false));
    scene.add(upper, lower);
    new STLLoader().load('/dental/ref/mouth.stl', (geom) => {
      if (stopped) {
        geom.dispose();
        return;
      }
      const smooth = mergeVertices(geom, 1e-4);
      geom.dispose();
      smooth.computeVertexNormals();
      smooth.center();
      smooth.rotateX(-Math.PI / 2);
      upper.geometry = smooth;
      lower.geometry = smooth;
      const size = new THREE.Vector3();
      smooth.computeBoundingBox();
      smooth.boundingBox!.getSize(size);
      const distance = Math.max(size.x, size.y, size.z) * 1.7;
      camera.position.set(size.x * 0.15, size.y * 0.35, distance);
      controls.target.set(0, 0, 0);
      controls.update();
      view.current = { upper, lower, contacts, tooth, size };
      place(view.current, propsRef.current.scenario, propsRef.current.progress);
    });
    const draw = () => {
      if (stopped) return;
      controls.update();
      renderer.render(scene, camera);
      requestAnimationFrame(draw);
    };
    draw();
    return () => {
      stopped = true;
      resize.disconnect();
      controls.dispose();
      for (const child of contacts.children) {
        const mesh = child as THREE.Mesh;
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
      renderer.dispose();
      upper.geometry.dispose();
      (upper.material as THREE.Material).dispose();
      (lower.material as THREE.Material).dispose();
      (tooth.material as THREE.Material).dispose();
      tooth.geometry.dispose();
      el.replaceChildren();
      view.current = null;
    };
  }, []);

  useEffect(() => {
    if (view.current) place(view.current, scenario, progress);
  }, [scenario, progress]);

  return <div class="dv-bite-stage" ref={host} data-progress={progress.toFixed(2)} />;
}

function place(current: { upper: THREE.Mesh; lower: THREE.Mesh; contacts: THREE.Group; tooth: THREE.Mesh; size: THREE.Vector3 }, next: BiteScenario, amount: number): void {
  const gap = (1 - amount) * current.size.y * 0.42;
  current.upper.position.y = gap;
  current.lower.position.y = -gap;
  const anchor = toothAnchor(next.fdi);
  const half = current.size.clone().multiplyScalar(0.5);
  current.tooth.position.set(anchor.x * half.x, 0, anchor.z * half.z);
  current.tooth.scale.setScalar(current.size.y * 0.045);
  const points = contactLayout(next);
  while (current.contacts.children.length > points.length) {
    const old = current.contacts.children.pop() as THREE.Mesh;
    old.geometry.dispose();
    (old.material as THREE.Material).dispose();
  }
  points.forEach((point, index) => {
    let marker = current.contacts.children[index] as THREE.Mesh | undefined;
    if (!marker) {
      marker = new THREE.Mesh(
        new THREE.SphereGeometry(current.size.y * 0.035, 16, 12),
        new THREE.MeshStandardMaterial({ transparent: true }),
      );
      current.contacts.add(marker);
    }
    const material = marker.material as THREE.MeshStandardMaterial;
    material.color.set(BAND_COLOR[point.band]);
    material.emissive.set(BAND_COLOR[point.band]);
    material.emissiveIntensity = 0.15 + amount * 0.9;
    material.opacity = 0.25 + amount * 0.75;
    marker.position.set(point.x * half.x, 0, point.z * half.z);
  });
}
