import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loadBinaryAsset } from './BinaryAsset';
import { VEHICLE_MODEL_FILES } from './binAssets';

export type VehicleModelKey = 'sedan' | 'suv' | 'delivery-van' | 'pickup' | 'city-bus';

export interface VehicleModelInstance {
  group: THREE.Group;
  wheels: THREE.Group[];
}

type GeometryBucket = {
  material: THREE.Material;
  tintable: boolean;
  geometries: THREE.BufferGeometry[];
};

const BODY_PART = /coachwork|cab and roof|bus body|lower livery stripe/i;
const WHEEL_PART = /(?:front|rear)_(?:tire|hub|rim|spoke|brake)|wheel[_ ](?:tire|hub|rim|spoke|brake)/i;
const PAINT_MATERIALS = new Set(['blue', 'green', 'red', 'white']);

export class VehicleModelLoader {
  private static readonly templates = new Map<VehicleModelKey, THREE.Group>();
  private static readonly pending = new Map<VehicleModelKey, Promise<THREE.Group>>();

  public static async preloadAll() {
    const keys = Object.keys(VEHICLE_MODEL_FILES) as VehicleModelKey[];
    await Promise.all(keys.map((key) => this.loadTemplate(key)));
  }

  public static create(key: VehicleModelKey, paintColor: number): VehicleModelInstance {
    const template = this.templates.get(key);
    if (!template) throw new Error(`Vehicle model ${key} was not preloaded.`);

    const group = template.clone(true);
    const materialClones = new Map<THREE.Material, THREE.Material>();
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;

      const cloneMaterial = (material: THREE.Material) => {
        let clone = materialClones.get(material);
        if (!clone) {
          const original = material as THREE.MeshStandardMaterial;
          const makePhysicalMaterial = () => new THREE.MeshPhysicalMaterial({
            color: original.color?.clone() ?? new THREE.Color(0xffffff),
            map: original.map ?? null,
            normalMap: original.normalMap ?? null,
            normalScale: original.normalScale?.clone() ?? new THREE.Vector2(1, 1),
            roughnessMap: original.roughnessMap ?? null,
            roughness: original.roughness ?? 0.7,
            metalnessMap: original.metalnessMap ?? null,
            metalness: original.metalness ?? 0,
            emissive: original.emissive?.clone() ?? new THREE.Color(0x000000),
            emissiveMap: original.emissiveMap ?? null,
            emissiveIntensity: original.emissiveIntensity ?? 1,
            transparent: material.transparent,
            opacity: material.opacity,
            side: material.side,
          });
          const name = material.name.toLowerCase();
          if (PAINT_MATERIALS.has(name)) {
            const paint = makePhysicalMaterial();
            paint.roughness = Math.min(paint.roughness, 0.32);
            paint.metalness = Math.max(paint.metalness, 0.42);
            paint.clearcoat = 0.82;
            paint.clearcoatRoughness = 0.18;
            clone = paint;
          } else if (name === 'glass') {
            const glass = makePhysicalMaterial();
            glass.color.multiplyScalar(0.82);
            glass.roughness = 0.16;
            glass.metalness = 0.32;
            glass.clearcoat = 0.92;
            glass.clearcoatRoughness = 0.12;
            clone = glass;
          } else if (name === 'chrome' || name === 'steel') {
            // Some source GLBs omit optional material vectors such as
            // normalScale. MeshStandardMaterial.copy assumes they exist and
            // was throwing during world startup for these meshes.
            const metal = makePhysicalMaterial();
            metal.metalness = 0.88;
            metal.roughness = name === 'chrome' ? 0.2 : 0.34;
            clone = metal;
          } else {
            clone = material.clone();
          }
          materialClones.set(material, clone);
        }
        if (object.userData.tintableBody && PAINT_MATERIALS.has(material.name.toLowerCase())) {
          const colorMaterial = clone as THREE.MeshStandardMaterial;
          if (colorMaterial.color) colorMaterial.color.setHex(paintColor);
        }
        return clone;
      };

      object.material = Array.isArray(object.material)
        ? object.material.map(cloneMaterial)
        : cloneMaterial(object.material);
      object.castShadow = true;
      object.receiveShadow = true;
    });

    const wheels: THREE.Group[] = [];
    group.traverse((object) => {
      if (object instanceof THREE.Group && object.name.startsWith('wheel-pivot-')) wheels.push(object);
    });
    group.userData.vehicleWheels = wheels;
    return { group, wheels };
  }

  private static loadTemplate(key: VehicleModelKey): Promise<THREE.Group> {
    const loaded = this.templates.get(key);
    if (loaded) return Promise.resolve(loaded);

    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;

    const task = loadBinaryAsset(VEHICLE_MODEL_FILES[key]).then((buffer) =>
      new Promise<THREE.Group>((resolve, reject) => {
        new GLTFLoader().parse(
          buffer,
          '',
          (gltf) => {
            try {
              const template = this.buildOptimizedTemplate(gltf.scene);
              this.templates.set(key, template);
              resolve(template);
            } catch (error) {
              reject(error);
            }
          },
          reject
        );
      })
    );
    this.pending.set(key, task);
    task.finally(() => this.pending.delete(key));
    return task;
  }

  private static buildOptimizedTemplate(source: THREE.Group): THREE.Group {
    source.updateMatrixWorld(true);
    const template = new THREE.Group();
    const meshes: THREE.Mesh[] = [];
    source.traverse((object) => {
      if (object instanceof THREE.Mesh) meshes.push(object);
    });

    const tireMeshes = meshes.filter((mesh) => /tire/i.test(mesh.name));
    const wheelCenters = tireMeshes
      .map((mesh) => this.worldBounds(mesh).getCenter(new THREE.Vector3()))
      .filter((center, index, all) => all.findIndex((other) => other.distanceTo(center) < 0.12) === index);
    const wheelGeometry = new Map<THREE.Vector3, GeometryBucket[]>();
    wheelCenters.forEach((center) => wheelGeometry.set(center, []));
    const staticGeometry = new Map<string, GeometryBucket>();

    meshes.forEach((mesh) => {
      const bodyPart = BODY_PART.test(mesh.name);
      const wheelPart = WHEEL_PART.test(mesh.name) || /tire/i.test(mesh.name);
      const bounds = this.worldBounds(mesh);
      const center = bounds.getCenter(new THREE.Vector3());
      const wheelCenter = wheelPart
        ? wheelCenters.reduce<THREE.Vector3 | null>((nearest, candidate) =>
            !nearest || candidate.distanceToSquared(center) < nearest.distanceToSquared(center) ? candidate : nearest,
          null)
        : null;
      const belongsToWheel = Boolean(wheelCenter && wheelCenter.distanceTo(center) < 0.8);

      if (belongsToWheel && wheelCenter) {
        this.addMeshGeometry(wheelGeometry.get(wheelCenter)!, mesh, wheelCenter, false, true);
        return;
      }

      if (Array.isArray(mesh.material)) {
        const geometry = mesh.geometry.clone();
        geometry.applyMatrix4(mesh.matrixWorld);
        const baked = new THREE.Mesh(geometry, mesh.material);
        baked.name = mesh.name;
        baked.userData.tintableBody = bodyPart;
        baked.castShadow = true;
        baked.receiveShadow = true;
        template.add(baked);
        return;
      }

      this.addMeshGeometry(staticGeometry, mesh, null, bodyPart, false);
    });

    staticGeometry.forEach((bucket) => this.addMergedBucket(template, bucket, 'static'));
    wheelGeometry.forEach((buckets, center) => {
      const pivot = new THREE.Group();
      pivot.name = `wheel-pivot-${center.x.toFixed(2)}-${center.z.toFixed(2)}`;
      pivot.position.copy(center);
      buckets.forEach((bucket) => this.addMergedBucket(pivot, bucket, 'wheel'));
      template.add(pivot);
    });

    return template;
  }

  private static addMeshGeometry(
    target: Map<string, GeometryBucket> | GeometryBucket[],
    mesh: THREE.Mesh,
    pivot: THREE.Vector3 | null,
    tintable: boolean,
    wheel: boolean
  ) {
    if (Array.isArray(mesh.material)) {
      const geometry = mesh.geometry.clone();
      geometry.applyMatrix4(mesh.matrixWorld);
      if (pivot) geometry.translate(-pivot.x, -pivot.y, -pivot.z);
      const material = mesh.material[0];
      const bucket: GeometryBucket = { material, tintable, geometries: [geometry] };
      if (Array.isArray(target)) target.push(bucket);
      return;
    }

    const material = mesh.material as THREE.Material;

    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    if (pivot) geometry.translate(-pivot.x, -pivot.y, -pivot.z);
    const attributes = Object.keys(geometry.attributes).sort().join(',');
    const indexed = geometry.index ? 'indexed' : 'unindexed';
    const key = `${material.uuid}|${tintable ? 1 : 0}|${wheel ? 1 : 0}|${attributes}|${indexed}`;
    let bucket: GeometryBucket | undefined;

    if (Array.isArray(target)) {
      bucket = target.find((entry) => entry.material.uuid === material.uuid);
      if (!bucket) {
        bucket = { material, tintable, geometries: [] };
        target.push(bucket);
      }
    } else {
      bucket = target.get(key);
      if (!bucket) {
        bucket = { material, tintable, geometries: [] };
        target.set(key, bucket);
      }
    }
    bucket.geometries.push(geometry);
  }

  private static addMergedBucket(parent: THREE.Group, bucket: GeometryBucket, name: string) {
    if (!bucket.geometries.length) return;
    const geometry = bucket.geometries.length === 1
      ? bucket.geometries[0]
      : mergeGeometries(bucket.geometries, false);

    if (!geometry) {
      bucket.geometries.forEach((part, index) => {
        const mesh = new THREE.Mesh(part, bucket.material);
        mesh.name = `${name}-${bucket.material.name}-${index}`;
        mesh.userData.tintableBody = bucket.tintable;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        parent.add(mesh);
      });
      return;
    }

    const mesh = new THREE.Mesh(geometry, bucket.material);
    mesh.name = `${name}-${bucket.material.name}`;
    mesh.userData.tintableBody = bucket.tintable;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
  }

  private static worldBounds(mesh: THREE.Mesh) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    return (mesh.geometry.boundingBox || new THREE.Box3()).clone().applyMatrix4(mesh.matrixWorld);
  }
}
