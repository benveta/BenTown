import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type Blocked = (x: number, z: number, radius: number) => boolean;

/** Small deterministic PRNG so the scenery is identical on every launch. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const VEHICLE_SPOTS: [number, number, number][] = [[16, 31, 5], [4, 2.5, 5], [40, 13, 5]];
const GREENS = [0x3f7d3a, 0x4e8f3f, 0x2f6b34, 0x5a9a45, 0x376f3a, 0x6aa84f];
const FLOWERS = [0xff5d73, 0xffd23f, 0xffffff, 0xb57bff, 0xff9f43, 0x4dc9ff];

/**
 * Trees, bushes and flowers drawn as three InstancedMeshes (about 5 draw calls
 * for hundreds of plants). Positions avoid buildings, roads and each other.
 */
export function buildGreenery(scene: THREE.Scene, isBlocked: Blocked) {
  const random = seeded(20241028);
  // True on (or within `margin` of) any paved surface: the 24 m avenue grid
  // (centre avenues are wider) and the avenue that leads into the Learning Park.
  const onRoad = (x: number, z: number, margin: number) => {
    for (let c = -96; c <= 96; c += 24) {
      const half = (c === 0 ? 6 : 4) + margin;
      if (Math.abs(x - c) < half && Math.abs(z) <= 110) return true;
      if (Math.abs(z - c) < half && Math.abs(x) <= 110) return true;
    }
    return x >= 106 && x <= 212 && Math.abs(z) < 6 + margin;
  };
  const inPark = (x: number, z: number) => x > 112 && x < 204 && z > -39 && z < 37;

  const trees: { x: number; z: number; s: number }[] = [];
  const tryTree = (x: number, z: number, s: number, spacing = 3.2) => {
    if (isBlocked(x, z, 1.4) || onRoad(x, z, 1.3)) return;
    // Keep trees and bushes away from fixed vehicle spawn points so they can always be reached.
    if (VEHICLE_SPOTS.some(([sx, sz, r]) => (sx - x) ** 2 + (sz - z) ** 2 < r * r)) return;
    if (trees.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < spacing * spacing)) return;
    trees.push({ x, z, s });
  };

  // 1. Street trees on the verge beside every avenue (kept clear of junctions).
  const avenues = [-96, -72, -48, -24, 0, 24, 48, 72, 96];
  avenues.forEach((road) => {
    const edge = road === 0 ? 8.6 : 6.6;
    for (let t = -104; t <= 104; t += 11) {
      const phase = Math.abs(((t % 24) + 24) % 24 - 12);
      if (phase > 9.2) continue; // too close to a cross street
      [-1, 1].forEach((side) => {
        tryTree(road + side * edge, t + random() * 2, 0.85 + random() * 0.3, 5);
        tryTree(t + random() * 2, road + side * edge, 0.85 + random() * 0.3, 5);
      });
    }
  });

  // 2. Parkland and forest beyond the city edge, thicker towards the horizon.
  for (let i = 0; i < 700 && trees.length < 620; i++) {
    const x = (random() - 0.5) * 420;
    const z = (random() - 0.5) * 420;
    if (Math.abs(x) < 114 && Math.abs(z) < 114) continue; // city
    if (inPark(x, z)) continue; // the park keeps its own layout (below)
    tryTree(x, z, 0.9 + random() * 0.7, 3.6);
  }

  // Park border: a tree line around the learning area and a few shade trees by the benches.
  for (let x = 118; x <= 202; x += 8) {
    tryTree(x, -38.5, 1.1, 4);
    tryTree(x, 36.5, 1.1, 4);
  }
  for (let z = -30; z <= 30; z += 8) tryTree(204, z, 1.1, 4);
  [[144, -2], [168, 2], [136, 30], [190, 12], [152, -30]].forEach(([x, z]) => tryTree(x, z, 1.2, 4));

  // 3. Garden blocks inside the city: groves in the corners of open lots.
  for (let i = 0; i < 120; i++) {
    const x = Math.round((random() - 0.5) * 8) * 24 + 12;
    const z = Math.round((random() - 0.5) * 8) * 24 + 12;
    const gx = x + (random() - 0.5) * 12;
    const gz = z + (random() - 0.5) * 12;
    if (Math.abs(gx) > 108 || Math.abs(gz) > 108 || onRoad(gx, gz, 1.5)) continue;
    tryTree(gx, gz, 0.8 + random() * 0.5, 3.4);
  }

  const trunkGeometry = new THREE.CylinderGeometry(0.12, 0.2, 1.7, 6);
  trunkGeometry.translate(0, 0.85, 0);
  const canopyParts = [
    { r: 1.15, p: [0, 2.35, 0] },
    { r: 0.85, p: [0.55, 1.95, 0.2] },
    { r: 0.9, p: [-0.45, 2.0, -0.3] },
  ].map(({ r, p }) => {
    const geometry = new THREE.IcosahedronGeometry(r, 1);
    geometry.translate(p[0], p[1], p[2]);
    return geometry;
  });
  const canopyGeometry = mergeGeometries(canopyParts, false)!;

  const trunks = new THREE.InstancedMesh(trunkGeometry, new THREE.MeshStandardMaterial({ color: 0x5b4030, roughness: 0.95 }), trees.length);
  const canopies = new THREE.InstancedMesh(canopyGeometry, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, flatShading: true }), trees.length);
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  trees.forEach((tree, i) => {
    matrix.compose(
      new THREE.Vector3(tree.x, 0, tree.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * Math.PI * 2),
      new THREE.Vector3(tree.s, tree.s * (0.9 + random() * 0.3), tree.s)
    );
    trunks.setMatrixAt(i, matrix);
    canopies.setMatrixAt(i, matrix);
    canopies.setColorAt(i, color.setHex(GREENS[Math.floor(random() * GREENS.length)]));
  });
  [trunks, canopies].forEach((mesh) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
  });
  if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;

  // 4. Hedges / bushes along the same verges and around the park.
  const bushes: { x: number; z: number; s: number }[] = [];
  for (const tree of trees) {
    const bx = tree.x + (random() - 0.5) * 2.4;
    const bz = tree.z + (random() - 0.5) * 2.4;
    if (random() < 0.55 && !onRoad(bx, bz, 0.8) && !isBlocked(bx, bz, 0.6)) bushes.push({ x: bx, z: bz, s: 0.5 + random() * 0.5 });
  }
  const bushMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.7, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), bushes.length);
  bushes.forEach((bush, i) => {
    matrix.compose(new THREE.Vector3(bush.x, 0.25 * bush.s, bush.z), new THREE.Quaternion(), new THREE.Vector3(bush.s * 1.2, bush.s, bush.s * 1.2));
    bushMesh.setMatrixAt(i, matrix);
    bushMesh.setColorAt(i, color.setHex(GREENS[Math.floor(random() * GREENS.length)]).multiplyScalar(0.9));
  });
  bushMesh.castShadow = true;
  bushMesh.instanceMatrix.needsUpdate = true;
  if (bushMesh.instanceColor) bushMesh.instanceColor.needsUpdate = true;
  scene.add(bushMesh);

  return { trees, random };
}

/** Flower beds as one InstancedMesh; `centers` are [x, z, radius] patches. */
export function buildFlowerBeds(scene: THREE.Scene, centers: [number, number, number][], random: () => number) {
  const dots: { x: number; z: number; c: number }[] = [];
  centers.forEach(([cx, cz, radius]) => {
    for (let i = 0; i < 48; i++) {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * radius;
      dots.push({ x: cx + Math.cos(angle) * distance, z: cz + Math.sin(angle) * distance, c: FLOWERS[Math.floor(random() * FLOWERS.length)] });
    }
  });
  const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 6, 5), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }), dots.length);
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  dots.forEach((dot, i) => {
    matrix.makeTranslation(dot.x, 0.22, dot.z);
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, color.setHex(dot.c));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);
}
