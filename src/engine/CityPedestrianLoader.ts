import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinnedModel } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadBinaryAsset } from './BinaryAsset';
import { MIXAMO_ANIMATION_FILE, NPC_MODEL_FILES, NPC_TEXTURE_FILES, NPC_TEXTURE_MANIFESTS } from './npcAssets';

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

type PedestrianTemplate = { scene: THREE.Group; walk: THREE.AnimationClip; scale: number };
type TextureRef = { file: string; w: number; h: number };
type TextureSlots = Partial<Record<'map' | 'normalMap' | 'roughnessMap' | 'emissiveMap' | 'aoMap', TextureRef>>;

/**
 * Pedestrians are real-proportioned, textured, skinned characters (a Ready Player Me avatar). React Native cannot decode images
 * embedded in a GLB, so the asset bake step strips them into raw RGBA files;
 * this loader re-attaches them as DataTextures after parsing.
 */
export class CityPedestrianLoader {
  private static readonly templates = new Map<PedestrianModelKey, PedestrianTemplate>();
  private static readonly pending = new Map<PedestrianModelKey, Promise<PedestrianTemplate>>();
  private static mixamoWalk: Promise<{ clip: THREE.AnimationClip; scene: THREE.Group }> | null = null;

  public static async preloadAll() {
    const keys = Object.keys(NPC_MODEL_FILES) as PedestrianModelKey[];
    await Promise.all(keys.map((key) => this.load(key)));
  }

  public static create(key: PedestrianModelKey, id: string, name: string): CityPedestrianNpc {
    const template = this.templates.get(key);
    if (!template) throw new Error(`Pedestrian model ${String(key)} was not preloaded.`);

    const model = cloneSkinnedModel(template.scene);
    model.scale.setScalar(template.scale);
    model.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        object.frustumCulled = false; // skinned bounds are rest-pose; avoid pop-out
      }
    });

    // Crowd variety from one rig: height, hat on/off and a clothing tint.
    const seed = Array.from(id).reduce((sum, ch) => sum * 31 + ch.charCodeAt(0), 7) >>> 0;
    model.scale.multiplyScalar(0.94 + (seed % 13) * 0.01);
    const tints = [0xffffff, 0xaebfd6, 0xd1bfa0, 0x9db39a, 0xc79a9a, 0x8f9fb8];
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object.name === 'Mesh' && seed % 2 === 0) object.visible = false; // headwear
      if (object.name === 'Wolf3D_Outfit_Top') {
        const material = (object.material as THREE.MeshStandardMaterial).clone();
        material.color.setHex(tints[seed % tints.length]);
        object.material = material;
      }
    });

    const group = new THREE.Group();
    group.name = `City pedestrian ${name}`;
    group.add(model);
    const mixer = new THREE.AnimationMixer(model);
    const walkAction = mixer.clipAction(template.walk);
    walkAction.setLoop(THREE.LoopRepeat, Infinity);
    // Offset the cycle per walker so a crowd does not step in lockstep.
    walkAction.time = (id.length * 0.137 + name.charCodeAt(0) * 0.011) % template.walk.duration;
    // Match stride rate to ground speed (the Mixamo walk covers ~1.35 m/s) to avoid foot sliding.
    const speed = 0.92 + (id.length % 5) * 0.075;
    walkAction.timeScale = speed / 1.35;
    walkAction.play();

    // Stand the posed model on y = 0.
    mixer.update(0);
    group.updateMatrixWorld(true);
    const posed = new THREE.Box3().setFromObject(group, true);
    if (Number.isFinite(posed.min.y)) model.position.y -= posed.min.y;

    return {
      id,
      name,
      group,
      mixer,
      walkAction,
      greetAction: null,
      speed,
      direction: id.length % 2 === 0 ? 1 : -1,
      axis: 'z',
      minCoordinate: -90,
      maxCoordinate: 90,
      greetingTimer: 0,
    };
  }

  private static parse(buffer: ArrayBuffer): Promise<GLTF> {
    return new Promise((resolve, reject) => new GLTFLoader().parse(buffer, '', resolve, reject));
  }

  /** The Mixamo Walk clip and its rest-pose skeleton, shared by every retargeted character. */
  private static loadMixamoWalk(): Promise<{ clip: THREE.AnimationClip; scene: THREE.Group }> {
    if (!this.mixamoWalk) {
      this.mixamoWalk = loadBinaryAsset(MIXAMO_ANIMATION_FILE).then((buffer) => this.parse(buffer)).then((gltf) => {
        const clip = gltf.animations.find((c) => c.name === 'Walk');
        if (!clip) throw new Error('Mixamo Walk clip missing.');
        // The file's node rest pose is not Mixamo's bind pose; pose the skeleton
        // with the TPose clip so rest orientations match what Walk was authored against.
        const tPose = gltf.animations.find((c) => c.name === 'TPose');
        if (tPose) {
          const mixer = new THREE.AnimationMixer(gltf.scene);
          mixer.clipAction(tPose).play();
          mixer.update(0);
        }
        gltf.scene.updateMatrixWorld(true);
        return { clip, scene: gltf.scene };
      });
    }
    return this.mixamoWalk;
  }

  /**
   * Retargets rotation tracks from the Mixamo skeleton onto another humanoid
   * rig. Each rotation is converted through both rigs' rest-pose world
   * orientations, so rigs whose bones are oriented differently still bend the
   * right way. Root translation is dropped; the game moves the group itself.
   */
  private static retarget(
    source: { clip: THREE.AnimationClip; scene: THREE.Group },
    target: THREE.Object3D,
    stripPrefix: boolean
  ): THREE.AnimationClip {
    target.updateMatrixWorld(true);
    const worldQuat = (object: THREE.Object3D) => object.getWorldQuaternion(new THREE.Quaternion());
    const tracks: THREE.KeyframeTrack[] = [];
    source.clip.tracks.forEach((track) => {
      // Hips bob: keep only the movement around the mean (the walk is in place), converted
      // to world metres, scaled by relative hip height, then into the target's local frame.
      if (/Hips\.position$/.test(track.name)) {
        const targetName = stripPrefix ? track.name.replace(/^mixamorig:?/, '') : track.name;
        const hips = target.getObjectByName(targetName.replace('.position', ''));
        const sourceHips = source.scene.getObjectByName(track.name.replace('.position', ''));
        if (!hips?.parent || !sourceHips?.parent) return;
        const sourceHeight = sourceHips.getWorldPosition(new THREE.Vector3()).y;
        const targetHeight = hips.getWorldPosition(new THREE.Vector3()).y;
        const ratio = sourceHeight > 0.01 ? targetHeight / sourceHeight : 1;
        const toWorld = new THREE.Matrix3().setFromMatrix4(sourceHips.parent.matrixWorld);
        const fromWorld = new THREE.Matrix3().setFromMatrix4(hips.parent.matrixWorld).invert();
        const mean = new THREE.Vector3();
        const count = track.values.length / 3;
        for (let i = 0; i < track.values.length; i += 3) mean.add(new THREE.Vector3().fromArray(track.values, i));
        mean.divideScalar(count);
        const rest = hips.position.clone();
        const values = new Float32Array(track.values.length);
        const delta = new THREE.Vector3();
        for (let i = 0; i < track.values.length; i += 3) {
          delta.fromArray(track.values, i).sub(mean).applyMatrix3(toWorld).multiplyScalar(ratio).applyMatrix3(fromWorld);
          rest.clone().add(delta).toArray(values, i);
        }
        tracks.push(new THREE.VectorKeyframeTrack(`${hips.name}.position`, Array.from(track.times), Array.from(values)));
        return;
      }
      if (!track.name.endsWith('.quaternion')) return;
      const sourceName = track.name.slice(0, -'.quaternion'.length);
      const targetName = stripPrefix ? sourceName.replace(/^mixamorig:?/, '') : sourceName;
      if (/Shoulder|Arm|Hand/.test(targetName)) return; // arms are lowered statically (see lowerArms)
      const sourceBone = source.scene.getObjectByName(sourceName);
      const targetBone = target.getObjectByName(targetName);
      if (!sourceBone || !targetBone || !sourceBone.parent || !targetBone.parent) return;

      // target_local = Pt^-1 * Ps * q_source * Rs^-1 * Rt   (P = parent rest world, R = bone rest world)
      const before = worldQuat(targetBone.parent).invert().multiply(worldQuat(sourceBone.parent));
      const after = worldQuat(sourceBone).invert().multiply(worldQuat(targetBone));
      const values = new Float32Array(track.values.length);
      const q = new THREE.Quaternion();
      for (let i = 0; i < values.length; i += 4) {
        q.fromArray(track.values, i);
        q.premultiply(before).multiply(after).toArray(values, i);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${targetName}.quaternion`, Array.from(track.times), Array.from(values)));
    });
    return new THREE.AnimationClip('walk', source.clip.duration, tracks);
  }

  /**
   * Rotates the upper arms from the rig's T-pose down beside the body (leaving
   * a natural gap), so walkers do not hold their arms out sideways.
   */
  private static lowerArms(root: THREE.Object3D) {
    root.updateMatrixWorld(true);
    const down = new THREE.Vector3(0, -1, 0);
    ['LeftArm', 'RightArm'].forEach((name) => {
      const arm = root.getObjectByName(name);
      const forearm = arm?.children.find((child) => /ForeArm/.test(child.name));
      if (!arm || !forearm || !arm.parent) return;
      const from = arm.getWorldPosition(new THREE.Vector3());
      const direction = forearm.getWorldPosition(new THREE.Vector3()).sub(from).normalize();
      // Aim ~85% of the way to straight down.
      const delta = new THREE.Quaternion().setFromUnitVectors(direction, down);
      delta.slerp(new THREE.Quaternion(), 0.15);
      const parentWorld = arm.parent.getWorldQuaternion(new THREE.Quaternion());
      // local' = Pw^-1 * delta * Pw * local
      arm.quaternion.premultiply(parentWorld).premultiply(delta).premultiply(parentWorld.clone().invert());
      arm.updateMatrixWorld(true);
    });
  }

  private static async attachTextures(gltf: GLTF, key: PedestrianModelKey) {
    const manifest = NPC_TEXTURE_MANIFESTS[key] as Record<string, TextureSlots>;
    const cache = new Map<string, THREE.DataTexture>();
    const read = async (ref: TextureRef, srgb: boolean) => {
      const id = `${ref.file}|${srgb}`;
      let texture = cache.get(id);
      if (!texture) {
        const data = new Uint8Array(await loadBinaryAsset(NPC_TEXTURE_FILES[ref.file]));
        texture = new THREE.DataTexture(data, ref.w, ref.h, THREE.RGBAFormat);
        texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.flipY = false; // glTF UV convention
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.anisotropy = 4;
        texture.needsUpdate = true;
        cache.set(id, texture);
      }
      return texture;
    };
    const jobs: Promise<void>[] = [];
    gltf.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material: THREE.MeshStandardMaterial) => {
        const index = gltf.parser.associations.get(material)?.materials;
        const slots = index === undefined ? undefined : manifest[String(index)];
        if (!slots) return;
        jobs.push((async () => {
          if (slots.map) { material.map = await read(slots.map, true); material.color.set(0xffffff); }
          if (slots.normalMap) material.normalMap = await read(slots.normalMap, false);
          if (slots.roughnessMap) {
            material.roughnessMap = await read(slots.roughnessMap, false);
            material.metalnessMap = material.roughnessMap;
          }
          if (slots.emissiveMap) material.emissiveMap = await read(slots.emissiveMap, true);
          material.needsUpdate = true;
        })());
      });
    });
    await Promise.all(jobs);
  }

  private static load(key: PedestrianModelKey): Promise<PedestrianTemplate> {
    const cached = this.templates.get(key);
    if (cached) return Promise.resolve(cached);
    const existing = this.pending.get(key);
    if (existing) return existing;

    const task = (async () => {
      const gltf = await this.parse(await loadBinaryAsset(NPC_MODEL_FILES[key]));
      await this.attachTextures(gltf, key);
      const scene = gltf.scene;
      this.lowerArms(scene);
      scene.updateMatrixWorld(true);
      const walk = this.retarget(await this.loadMixamoWalk(), scene, true);
      // Normalise to adult height from the skinned rest pose.
      const bounds = new THREE.Box3().setFromObject(scene, true);
      const height = Math.max(0.01, bounds.max.y - bounds.min.y);
      const template = { scene, walk, scale: PEDESTRIAN_HEIGHT / height };
      this.templates.set(key, template);
      return template;
    })();
    this.pending.set(key, task);
    task.finally(() => this.pending.delete(key));
    return task;
  }
}
