import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { PetCharacterPalette } from '../petTheme';
import type { PetEmotion } from '../pet-states';
import type { PetSkin } from '../skins';
import { sampleThreePetPose } from './threePetMotion';

const DISPLAY_WIDTH = 96;
const DISPLAY_HEIGHT = 110;
const MAX_PIXEL_RATIO = 1.5;

interface ThreePetCharacterProps {
  emotion: PetEmotion;
  skin: PetSkin;
  palette: PetCharacterPalette;
  dragging: boolean;
  hovered: boolean;
  walkDir: number;
  dragDx: number;
  dragDy: number;
  /** False while the transparent Tauri webview is hidden. */
  active: boolean;
  /** Called after a WebGL initialization/context failure so the caller can use SVG. */
  onUnavailable: () => void;
}

interface PetRig {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftFoot: THREE.Group;
  rightFoot: THREE.Group;
  antenna: THREE.Group;
  leftPupil: THREE.Group;
  rightPupil: THREE.Group;
  shadow: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  sparkles: THREE.Group;
  sparkleMaterials: THREE.MeshBasicMaterial[];
  bodyMaterial: THREE.MeshPhysicalMaterial;
  bellyMaterial: THREE.MeshStandardMaterial;
  accentMaterial: THREE.MeshStandardMaterial;
  eyeMaterial: THREE.MeshStandardMaterial;
  inkMaterial: THREE.MeshStandardMaterial;
  variants: Record<PetSkin, THREE.Group>;
}

interface RenderController {
  start: () => void;
  stop: () => void;
}

function makePhysicalMaterial(color: string): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.28,
    metalness: 0.04,
    clearcoat: 0.42,
    clearcoatRoughness: 0.18,
  });
}

function makeStandardMaterial(color: string, roughness = 0.42): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 });
}

function addMesh<TGeometry extends THREE.BufferGeometry, TMaterial extends THREE.Material>(
  parent: THREE.Object3D,
  geometry: TGeometry,
  material: TMaterial,
): THREE.Mesh<TGeometry, TMaterial> {
  const mesh = new THREE.Mesh(geometry, material);
  parent.add(mesh);
  return mesh;
}

function lighter(color: string, amount: number): THREE.Color {
  return new THREE.Color(color).lerp(new THREE.Color('#ffffff'), amount);
}

function darker(color: string, amount: number): THREE.Color {
  return new THREE.Color(color).lerp(new THREE.Color('#0f172a'), amount);
}

function buildToyPet(): PetRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const head = new THREE.Group();
  root.add(body, head);

  const bodyMaterial = makePhysicalMaterial('#7dd3fc');
  const bellyMaterial = makeStandardMaterial('#d9f7ff', 0.56);
  const accentMaterial = makeStandardMaterial('#c7f0ff', 0.34);
  const eyeMaterial = makeStandardMaterial('#edf8ff', 0.32);
  const inkMaterial = makeStandardMaterial('#162033', 0.26);

  const torso = addMesh(body, new THREE.CapsuleGeometry(0.43, 0.54, 8, 18), bodyMaterial);
  torso.position.y = -0.24;
  torso.scale.set(1, 1.02, 0.88);

  const belly = addMesh(body, new THREE.SphereGeometry(0.305, 16, 12), bellyMaterial);
  belly.position.set(0, -0.2, 0.365);
  belly.scale.set(0.92, 1.24, 0.24);

  const chestLight = addMesh(body, new THREE.SphereGeometry(0.105, 12, 10), accentMaterial);
  chestLight.position.set(0, -0.1, 0.48);
  chestLight.scale.set(1, 1, 0.38);

  head.position.y = 0.48;
  const headShell = addMesh(head, new THREE.SphereGeometry(0.55, 24, 18), bodyMaterial);
  headShell.scale.set(1.04, 0.92, 0.86);

  const leftEye = new THREE.Group();
  const rightEye = new THREE.Group();
  leftEye.position.set(-0.205, 0.025, 0.465);
  rightEye.position.set(0.205, 0.025, 0.465);
  head.add(leftEye, rightEye);
  for (const eye of [leftEye, rightEye]) {
    const sclera = addMesh(eye, new THREE.SphereGeometry(0.148, 14, 12), eyeMaterial);
    sclera.scale.set(0.92, 1.1, 0.5);
    const pupil = new THREE.Group();
    pupil.position.z = 0.08;
    eye.add(pupil);
    const iris = addMesh(pupil, new THREE.SphereGeometry(0.071, 12, 10), inkMaterial);
    iris.scale.z = 0.55;
    const glint = addMesh(pupil, new THREE.SphereGeometry(0.022, 8, 8), eyeMaterial);
    glint.position.set(-0.02, 0.025, 0.052);
  }

  const mouthCurve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-0.12, -0.108, 0.492),
    new THREE.Vector3(0, -0.19, 0.56),
    new THREE.Vector3(0.12, -0.108, 0.492),
  );
  addMesh(head, new THREE.TubeGeometry(mouthCurve, 12, 0.018, 7, false), inkMaterial);

  const leftArm = new THREE.Group();
  const rightArm = new THREE.Group();
  leftArm.position.set(-0.47, -0.08, 0);
  rightArm.position.set(0.47, -0.08, 0);
  body.add(leftArm, rightArm);
  for (const [arm, side] of [[leftArm, -1], [rightArm, 1]] as const) {
    const fin = addMesh(arm, new THREE.CapsuleGeometry(0.11, 0.28, 6, 10), bodyMaterial);
    fin.position.set(side * 0.06, -0.12, 0);
    fin.rotation.z = side * -0.32;
    fin.scale.set(0.8, 1, 0.65);
  }

  const leftFoot = new THREE.Group();
  const rightFoot = new THREE.Group();
  leftFoot.position.set(-0.21, -0.88, 0.04);
  rightFoot.position.set(0.21, -0.88, 0.04);
  body.add(leftFoot, rightFoot);
  for (const foot of [leftFoot, rightFoot]) {
    const mesh = addMesh(foot, new THREE.SphereGeometry(0.16, 14, 10), accentMaterial);
    mesh.scale.set(1.15, 0.58, 0.82);
  }

  const antenna = new THREE.Group();
  // The head's local top is ~0.55. Keep the antenna anchored there instead
  // of stacking it above the whole head group, otherwise it clips in the
  // deliberately compact 96x110 desktop-pet viewport.
  antenna.position.set(0, 0.5, 0);
  head.add(antenna);
  const antennaStem = addMesh(antenna, new THREE.CylinderGeometry(0.028, 0.036, 0.31, 10), accentMaterial);
  antennaStem.position.y = 0.14;
  antennaStem.rotation.z = -0.13;
  const antennaTip = addMesh(antenna, new THREE.SphereGeometry(0.09, 12, 10), accentMaterial);
  antennaTip.position.set(-0.043, 0.3, 0);

  const variants: Record<PetSkin, THREE.Group> = {
    robot: new THREE.Group(),
    lobster: new THREE.Group(),
    cat: new THREE.Group(),
    jellyfish: new THREE.Group(),
    ghost: new THREE.Group(),
    'blue-mascot': new THREE.Group(),
  };
  Object.values(variants).forEach((variant) => root.add(variant));

  const robotLeft = addMesh(variants.robot, new THREE.CylinderGeometry(0.12, 0.12, 0.065, 12), accentMaterial);
  robotLeft.position.set(-0.56, 0.48, 0);
  robotLeft.rotation.z = Math.PI / 2;
  const robotRight = robotLeft.clone();
  robotRight.position.x = 0.56;
  variants.robot.add(robotRight);

  const blueFinLeft = addMesh(variants['blue-mascot'], new THREE.SphereGeometry(0.22, 12, 10), accentMaterial);
  blueFinLeft.position.set(-0.51, 0.15, -0.02);
  blueFinLeft.scale.set(0.42, 1.15, 0.75);
  blueFinLeft.rotation.z = -0.68;
  const blueFinRight = blueFinLeft.clone();
  blueFinRight.position.x = 0.51;
  blueFinRight.rotation.z = 0.68;
  variants['blue-mascot'].add(blueFinRight);

  for (const side of [-1, 1] as const) {
    const ear = addMesh(variants.cat, new THREE.ConeGeometry(0.18, 0.38, 4), bodyMaterial);
    ear.position.set(side * 0.29, 1.02, 0);
    ear.rotation.z = side * -0.22;
    const innerEar = addMesh(variants.cat, new THREE.ConeGeometry(0.095, 0.22, 4), accentMaterial);
    innerEar.position.set(side * 0.29, 1.045, 0.09);
    innerEar.rotation.z = side * -0.22;
  }
  const catTail = addMesh(variants.cat, new THREE.TorusGeometry(0.26, 0.055, 8, 16, Math.PI * 1.3), bodyMaterial);
  catTail.position.set(0.42, -0.42, -0.14);
  catTail.rotation.set(-0.25, -0.65, 0.45);

  for (const x of [-0.22, 0, 0.22]) {
    const tentacle = addMesh(variants.jellyfish, new THREE.CapsuleGeometry(0.057, 0.38, 5, 8), accentMaterial);
    tentacle.position.set(x, -0.92, -0.03);
    tentacle.scale.z = 0.65;
  }
  const jellyDome = addMesh(variants.jellyfish, new THREE.SphereGeometry(0.58, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), bodyMaterial);
  jellyDome.position.y = 0.66;
  jellyDome.scale.z = 0.88;

  for (const x of [-0.3, 0, 0.3]) {
    const hem = addMesh(variants.ghost, new THREE.SphereGeometry(0.17, 12, 8), bodyMaterial);
    hem.position.set(x, -0.83, 0);
    hem.scale.set(1, 0.62, 0.9);
  }
  const ghostHalo = addMesh(variants.ghost, new THREE.TorusGeometry(0.38, 0.025, 8, 20), accentMaterial);
  ghostHalo.position.set(0, 1.13, 0);
  ghostHalo.rotation.x = Math.PI / 2;

  // The old lobster silhouette relied on oversized claws. Keep its optional
  // colourway, but use a small rounded tail fan so it remains companion-like.
  for (const x of [-0.16, 0, 0.16]) {
    const tailLobe = addMesh(variants.lobster, new THREE.SphereGeometry(0.15, 12, 8), accentMaterial);
    tailLobe.position.set(x, -0.53, -0.42);
    tailLobe.scale.set(0.72, 0.95, 0.3);
  }

  const shadowMaterial = new THREE.MeshBasicMaterial({ color: '#020617', transparent: true, opacity: 0.16, depthWrite: false });
  const shadow = addMesh(root, new THREE.CircleGeometry(0.58, 28), shadowMaterial);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -1.04;
  shadow.scale.set(1.2, 0.7, 1);

  const sparkles = new THREE.Group();
  const sparkleMaterials: THREE.MeshBasicMaterial[] = [];
  root.add(sparkles);
  for (let index = 0; index < 5; index += 1) {
    const material = new THREE.MeshBasicMaterial({ color: '#eafcff', transparent: true, opacity: 0, depthWrite: false });
    const sparkle = addMesh(sparkles, new THREE.OctahedronGeometry(0.052, 0), material);
    const angle = index / 5 * Math.PI * 2;
    sparkle.position.set(Math.cos(angle) * 0.75, Math.sin(angle) * 0.52 + 0.05, Math.sin(angle * 1.7) * 0.12);
    sparkleMaterials.push(material);
  }

  return {
    root,
    body,
    head,
    leftArm,
    rightArm,
    leftFoot,
    rightFoot,
    antenna,
    leftPupil: leftEye.children[1] as THREE.Group,
    rightPupil: rightEye.children[1] as THREE.Group,
    shadow,
    sparkles,
    sparkleMaterials,
    bodyMaterial,
    bellyMaterial,
    accentMaterial,
    eyeMaterial,
    inkMaterial,
    variants,
  };
}

function applyAppearance(rig: PetRig, skin: PetSkin, palette: PetCharacterPalette): void {
  rig.bodyMaterial.color.set(palette.body);
  rig.bodyMaterial.emissive.copy(darker(palette.body, 0.88));
  rig.bellyMaterial.color.copy(lighter(palette.body, 0.67));
  rig.accentMaterial.color.copy(lighter(palette.body, 0.38));
  rig.eyeMaterial.color.set(palette.eye);
  rig.inkMaterial.color.set(palette.ink);
  rig.sparkleMaterials.forEach((material) => material.color.set(palette.sparkle));
  for (const [variantSkin, variant] of Object.entries(rig.variants) as [PetSkin, THREE.Group][]) {
    variant.visible = variantSkin === skin;
  }
}

function disposeObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    geometries.add(node.geometry);
    const meshMaterials = Array.isArray(node.material) ? node.material : [node.material];
    meshMaterials.forEach((material) => materials.add(material));
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

/**
 * A real WebGL mesh companion for the floating desktop window. It deliberately
 * stays procedural and low-poly: no external model URLs, no WebGL2 dependency,
 * and no GPU work while the window is hidden. SVG remains the caller's fallback.
 */
export function ThreePetCharacter(props: ThreePetCharacterProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const propsRef = useRef(props);
  const controllerRef = useRef<RenderController | null>(null);
  propsRef.current = props;

  useEffect(() => {
    if (props.active) controllerRef.current?.start();
    else controllerRef.current?.stop();
  }, [props.active]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'low-power',
        preserveDrawingBuffer: false,
      });
    } catch {
      propsRef.current.onUnavailable();
      return;
    }

    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, DISPLAY_WIDTH / DISPLAY_HEIGHT, 0.1, 20);
    camera.position.set(0, 0.05, 4.9);
    camera.lookAt(0, -0.08, 0);
    scene.add(new THREE.HemisphereLight(0xeaf7ff, 0x20324a, 1.8));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(-2.5, 3.2, 4);
    scene.add(keyLight);
    const rimLight = new THREE.PointLight(0x74dfff, 1.55, 5);
    rimLight.position.set(2.2, 1.2, -1.6);
    scene.add(rimLight);

    const rig = buildToyPet();
    scene.add(rig.root);
    let appearanceKey = '';
    let frame = 0;
    let elapsedBeforePause = 0;
    let startedAt = performance.now();
    let disposed = false;
    let lost = false;

    const resize = () => {
      const width = canvas.clientWidth || DISPLAY_WIDTH;
      const height = canvas.clientHeight || DISPLAY_HEIGHT;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(canvas);

    const stop = () => {
      if (!frame) return;
      elapsedBeforePause += performance.now() - startedAt;
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const render = (now: number) => {
      frame = 0;
      if (disposed || lost || !propsRef.current.active || document.hidden) return;

      const current = propsRef.current;
      const key = `${current.skin}:${current.palette.body}:${current.palette.ink}:${current.palette.eye}:${current.palette.sparkle}`;
      if (key !== appearanceKey) {
        applyAppearance(rig, current.skin, current.palette);
        appearanceKey = key;
      }

      const pose = sampleThreePetPose({
        emotion: current.emotion,
        dragging: current.dragging,
        hovered: current.hovered,
        walkDir: current.walkDir,
        dragDx: current.dragDx,
        dragDy: current.dragDy,
      }, elapsedBeforePause + now - startedAt);

      rig.root.position.y = -0.12 + pose.bodyY;
      rig.root.rotation.y = pose.headYaw * 0.24;
      rig.body.scale.set(pose.bodyScaleX, pose.bodyScaleY, 1);
      rig.head.rotation.set(pose.headPitch, pose.headYaw, pose.headRoll);
      rig.leftArm.rotation.z = pose.armLeft;
      rig.rightArm.rotation.z = pose.armRight;
      rig.leftFoot.position.y = -0.88 + pose.footLeft;
      rig.rightFoot.position.y = -0.88 + pose.footRight;
      rig.antenna.rotation.z = pose.antenna;
      rig.leftPupil.position.set(pose.gazeX, pose.gazeY, 0.08);
      rig.rightPupil.position.set(pose.gazeX, pose.gazeY, 0.08);
      rig.leftPupil.scale.y = pose.eyeScaleY;
      rig.rightPupil.scale.y = pose.eyeScaleY;
      rig.shadow.scale.setScalar(pose.shadowScale);
      rig.shadow.scale.z = pose.shadowScale * 0.72;
      rig.sparkles.rotation.y += 0.028;
      rig.sparkles.scale.setScalar(0.55 + pose.sparkle * 0.5);
      rig.sparkleMaterials.forEach((material, index) => {
        material.opacity = pose.sparkle * (0.42 + 0.18 * Math.sin(now / 180 + index));
      });
      camera.position.x = pose.headYaw * 0.22 + pose.gazeX * 0.42;
      camera.position.y = 0.05 + pose.bodyY * 0.12;
      camera.lookAt(0, -0.08 + pose.bodyY * 0.18, 0);

      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };
    const start = () => {
      if (disposed || lost || frame || !propsRef.current.active || document.hidden) return;
      startedAt = performance.now();
      frame = requestAnimationFrame(render);
    };
    const onVisibilityChange = () => {
      if (document.hidden) stop();
      else start();
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      lost = true;
      stop();
      propsRef.current.onUnavailable();
    };

    controllerRef.current = { start, stop };
    canvas.addEventListener('webglcontextlost', onContextLost, false);
    document.addEventListener('visibilitychange', onVisibilityChange);
    start();

    return () => {
      disposed = true;
      canvas.removeEventListener('webglcontextlost', onContextLost, false);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      observer?.disconnect();
      stop();
      if (controllerRef.current?.start === start) controllerRef.current = null;
      disposeObject(rig.root);
      renderer.dispose();
      renderer.forceContextLoss();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        width: DISPLAY_WIDTH,
        height: DISPLAY_HEIGHT,
        display: 'block',
        pointerEvents: 'none',
      }}
    />
  );
}
