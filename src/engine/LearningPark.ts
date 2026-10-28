import * as THREE from 'three';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { ALPHABET_DATA, COLOR_PATH_DATA, NUMBER_BALLOONS_DATA } from '../types/game';
import type { WorldManager } from './WorldManager';
import { buildFlowerBeds, buildGreenery } from './Greenery';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const font = new FontLoader().parse(require('../../assets/fonts/helvetiker_bold.typeface.json'));

/** Centre of the Learning Park, east of the city on the extended main avenue. */
export const LEARNING_PARK_CENTER = new THREE.Vector3(158, 0, 0);

const textCache = new Map<string, THREE.BufferGeometry>();
function textGeometry(text: string, size: number, depth: number) {
  const key = `${text}|${size}|${depth}`;
  let geometry = textCache.get(key);
  if (!geometry) {
    geometry = new TextGeometry(text, { font, size, depth, curveSegments: 4, bevelEnabled: false });
    geometry.center();
    textCache.set(key, geometry);
  }
  return geometry;
}

const material = (color: number | string, roughness = 0.6) => new THREE.MeshStandardMaterial({ color, roughness });

/**
 * Builds the open-air learning area: a letter trail (A-Z), a number garden
 * (1-10 balloons), a rainbow note path, a farm meadow, a pond, benches, and
 * the greenery for the whole world. Interactive pieces register themselves in
 * the WorldManager's existing arrays so tapping/proximity/speech just work.
 */
export function buildLearningPark(world: WorldManager) {
  const scene = world.scene;
  const root = new THREE.Group();
  root.name = 'Learning Park';
  scene.add(root);

  // --- Entrance sign ---
  const sign = new THREE.Mesh(textGeometry('LEARNING PARK', 1.0, 0.25), material(0xffd23f, 0.4));
  sign.position.set(118, 4.6, 0);
  sign.rotation.y = Math.PI / 2; // reads correctly for visitors arriving from the city
  root.add(sign);
  [-5.5, 5.5].forEach((z) => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5, 0.4), material(0x6b4a2f, 0.9));
    post.position.set(118, 2.5, z);
    root.add(post);
  });
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 12.5), material(0x6b4a2f, 0.9));
  beam.position.set(118, 5.2, 0);
  root.add(beam);

  // --- Alphabet trail: A-Z along a gentle wave, each letter a coloured 3D block ---
  ALPHABET_DATA.forEach((item, index) => {
    const x = 126 + index * 2.7;
    const z = -16 + Math.sin(index * 0.55) * 5;
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.45, 1.5), material(0xe9e4d8, 0.8));
    base.position.y = 0.22;
    base.castShadow = true;
    group.add(base);
    const letter = new THREE.Mesh(textGeometry(item.letter, 1.25, 0.45), material(item.color, 0.35));
    letter.position.y = 1.25;
    letter.rotation.y = -Math.PI / 2; // faces the road side
    letter.name = `block_${item.letter}`;
    letter.castShadow = true;
    group.add(letter);
    root.add(group);
    world.alphabetBlocks.push({ mesh: letter, data: item, originalY: 1.25 });
  });

  // --- Number garden: balloons 1-10 with the digit printed on each ---
  NUMBER_BALLOONS_DATA.forEach((data, index) => {
    const group = new THREE.Group();
    group.position.set(130 + index * 3.6, 0, 17 + Math.cos(index * 0.7) * 3);
    const balloonGeometry = new THREE.SphereGeometry(0.85, 20, 16);
    balloonGeometry.scale(1, 1.2, 1);
    const balloon = new THREE.Mesh(balloonGeometry, new THREE.MeshStandardMaterial({ color: data.color, roughness: 0.2, metalness: 0.05 }));
    balloon.position.y = 2.7;
    balloon.name = `balloon_${data.num}`;
    balloon.castShadow = true;
    group.add(balloon);
    const digit = new THREE.Mesh(textGeometry(String(data.num), 0.8, 0.12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    digit.position.set(-0.84, 2.7, 0);
    digit.rotation.y = -Math.PI / 2;
    group.add(digit);
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.9, 4), new THREE.MeshBasicMaterial({ color: 0xf5f5f5 }));
    string.position.y = 0.95;
    group.add(string);
    root.add(group);
    world.numberBalloons.push({ group, mesh: balloon, num: data.num, popped: false, color: data.color });
  });

  // --- Rainbow note path (musical stepping stones) ---
  COLOR_PATH_DATA.forEach((col, index) => {
    const stone = new THREE.Mesh(
      new THREE.CylinderGeometry(0.85, 0.95, 0.18, 20),
      new THREE.MeshStandardMaterial({ color: col.color, roughness: 0.3, emissive: col.color, emissiveIntensity: 0.15 })
    );
    stone.position.set(138 + index * 2.4, 0.09, 6);
    stone.name = `stone_${col.name}`;
    stone.receiveShadow = true;
    root.add(stone);
    // The light is only a data field for the pulse animation; it is not added to
    // the scene because a live PointLight per stone would slow every material.
    world.steppingStones.push({ mesh: stone, data: col, light: new THREE.PointLight(col.color, 0, 4), activeTimer: 0 });
  });

  // --- Farm meadow: friendly animals, fenced with simple rails ---
  const animalSpots: [string, string, string, number, number][] = [
    ['cow_daisy_park', 'Daisy the Cow', 'cow', 176, -24],
    ['sheep_fluff_park', 'Fluffy the Sheep', 'sheep', 181, -28],
    ['duck_quack_park', 'Quackers the Duck', 'duck', 186, -22],
    ['cat_mimi_park', 'Mimi the Cat', 'cat', 190, -27],
    ['dog_buster_park', 'Buster the Dog', 'dog', 184, -18],
  ];
  animalSpots.forEach(([id, name, type, x, z]) => {
    const group = type === 'cow' ? world.createCowModel()
      : type === 'sheep' ? world.createSheepModel()
        : type === 'duck' ? world.createDuckModel()
          : type === 'cat' ? world.createCatModel()
            : world.createAnimalModel('dog', 0xc27803);
    group.position.set(x, 0, z);
    group.rotation.y = Math.PI / 2;
    root.add(group);
    world.animals.push({ id, name, type, group, animTimer: 0, actionState: 'idle' });
  });
  const railMaterial = material(0x8a6a45, 0.9);
  for (let i = 0; i <= 8; i++) {
    [-31, -14].forEach((z) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.1, 0.2), railMaterial);
      post.position.set(172 + i * 3, 0.55, z);
      root.add(post);
    });
  }
  [-31, -14].forEach((z) => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(24, 0.12, 0.12), railMaterial);
    rail.position.set(184, 0.9, z);
    root.add(rail);
  });

  // --- Pond ---
  const pond = new THREE.Mesh(new THREE.CircleGeometry(7, 32), new THREE.MeshStandardMaterial({ color: 0x3b9fd8, roughness: 0.1, metalness: 0.5 }));
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(174, 0.03, 24);
  root.add(pond);

  // --- Benches and a paved path ---
  [[140, -9], [160, -9], [150, 12], [170, 12]].forEach(([x, z]) => {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.6), material(0x7a5230, 0.85));
    seat.position.set(x, 0.55, z);
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.55, 0.1), material(0x7a5230, 0.85));
    back.position.set(x, 0.9, z - 0.28);
    root.add(seat, back);
  });
  const path = new THREE.Mesh(new THREE.PlaneGeometry(88, 3), material(0xc9bfa6, 0.95));
  path.rotation.x = -Math.PI / 2;
  path.position.set(158, 0.02, 0);
  root.add(path);

  // --- Greenery for the whole world (trees, bushes) + flower beds in the park ---
  const { random } = buildGreenery(scene, (x, z, r) => world.isStaticBlocked(x, z, r));
  buildFlowerBeds(scene, [[134, -6, 3], [150, 4, 3.5], [166, 6, 3], [180, 4, 4], [142, 24, 4], [160, 26, 3], [128, 10, 3]], random);
}
