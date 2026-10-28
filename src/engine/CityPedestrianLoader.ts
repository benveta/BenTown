import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinnedModel } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadBinaryAsset } from './BinaryAsset';
import { NPC_MODEL_FILES } from './binAssets';

export type PedestrianModelKey = keyof typeof NPC_MODEL_FILES;

export interface CityPedestrianNpc {
  id: string;
  name: string;
  group: THREE.Group;
  mixer: THREE.AnimationMixer;
  walkAction: THREE.AnimationAction;
  greetAction: THREE.AnimationAction | null;
  speed: number;
  direction: 1 | -1;
  axis: 'x' | 'z';
  minCoordinate: number;
  maxCoordinate: number;
  greetingTimer: number;
}

const PEDESTRIAN_HEIGHT = 1.72;

type PedestrianTemplate = { scene: THREE.Group; clips: THREE.AnimationClip[]; scale: number; floorOffset: number };

export class CityPedestrianLoader {
  private static readonly templates = new Map<PedestrianModelKey, PedestrianTemplate>();
  private static readonly pending = new Map<PedestrianModelKey, Promise<PedestrianTemplate>>();

  public static async preloadAll() {
    const keys = Object.keys(NPC_MODEL_FILES) as PedestrianModelKey[];
    await Promise.all(keys.map((key) => this.load(key)));
  }

  public static create(key: PedestrianModelKey, id: string, name: string): CityPedestrianNpc {
    const template = this.templates.get(key);
    if (!template) throw new Error(`Pedestrian model ${key} was not preloaded.`);

    const model = cloneSkinnedModel(template.scene);
    model.scale.setScalar(template.scale);
    model.position.y = -template.floorOffset * template.scale;
    model.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });

    const group = new THREE.Group();
    group.name = `City pedestrian ${name}`;
    group.add(model);
    const mixer = new THREE.AnimationMixer(model);
    const walk = template.clips.find((clip) => clip.name.toLowerCase() === 'walk');
    if (!walk) throw new Error(`Pedestrian model ${key} has no walk animation.`);
    const walkAction = mixer.clipAction(walk);
    walkAction.setLoop(THREE.LoopRepeat, Infinity);
    walkAction.play();
    // The source characters are chibi: oversized head, stubby limbs. Reshape
    // the skeleton toward adult proportions (smaller head, longer legs, arms
    // and torso) — the walk clip only animates rotations, so bone scales hold.
    const reshape = (boneName: string, x: number, y: number, z: number) => model.getObjectByName(boneName)?.scale.set(x, y, z);
    reshape('head', 0.72, 0.72, 0.72);
    reshape('torso', 1, 1.22, 1);
    reshape('leg-left', 0.85, 1.55, 0.85);
    reshape('leg-right', 0.85, 1.55, 0.85);
    reshape('arm-left', 0.85, 1.35, 0.85);
    reshape('arm-right', 0.85, 1.35, 0.85);

    // Measure the posed, reshaped skinned mesh: normalise to an adult height
    // and stand it on y = 0 (the rest-pose bounds ignored the clip's root
    // offset and the reshaping, which sank pedestrians into the pavement).
    mixer.update(0);
    group.updateMatrixWorld(true);
    const reshaped = new THREE.Box3().setFromObject(group, true);
    const reshapedHeight = reshaped.max.y - reshaped.min.y;
    if (reshapedHeight > 0.01) model.scale.multiplyScalar(PEDESTRIAN_HEIGHT / reshapedHeight);
    group.updateMatrixWorld(true);
    const posed = new THREE.Box3().setFromObject(group, true);
    if (Number.isFinite(posed.min.y)) model.position.y -= posed.min.y;
    const greet = template.clips.find((clip) => clip.name.toLowerCase() === 'emote-yes');
    const greetAction = greet ? mixer.clipAction(greet) : null;

    return {
      id,
      name,
      group,
      mixer,
      walkAction,
      greetAction,
      speed: 0.92 + (id.length % 5) * 0.075,
      direction: id.length % 2 === 0 ? 1 : -1,
      axis: 'z',
      minCoordinate: -90,
      maxCoordinate: 90,
      greetingTimer: 0,
    };
  }

  private static load(key: PedestrianModelKey): Promise<PedestrianTemplate> {
    const cached = this.templates.get(key);
    if (cached) return Promise.resolve(cached);
    const existing = this.pending.get(key);
    if (existing) return existing;

    const task = loadBinaryAsset(NPC_MODEL_FILES[key]).then((buffer) =>
      new Promise<PedestrianTemplate>((resolve, reject) => {
        new GLTFLoader().parse(buffer, '', (gltf) => {
          const scene = gltf.scene;
          scene.updateMatrixWorld(true);
          const bounds = new THREE.Box3().setFromObject(scene);
          const height = Math.max(0.01, bounds.max.y - bounds.min.y);
          const template = { scene, clips: gltf.animations, scale: 1.68 / height, floorOffset: bounds.min.y };
          this.templates.set(key, template);
          resolve(template);
        }, reject);
      })
    );
    this.pending.set(key, task);
    task.finally(() => this.pending.delete(key));
    return task;
  }
}
