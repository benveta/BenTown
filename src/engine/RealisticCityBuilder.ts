import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Platform } from 'react-native';
import { loadBinaryAsset } from './BinaryAsset';
import { FACADE_FILES, TEXTURE_FILES } from './binAssets';
import { VehicleModelLoader, VehicleModelKey } from './VehicleModelLoader';
import { CityPedestrianLoader, CityPedestrianNpc, PedestrianModelKey } from './CityPedestrianLoader';

export interface DriveableVehicle {
  id: string;
  name: string;
  group: THREE.Group;
  type: 'roadster';
  seatOffset: THREE.Vector3;
  active: boolean;
  speed: number;
  steerAngle: number;
  wheels?: THREE.Group[];
  /** Half size of the body footprint in the vehicle's local x/z (used for collisions). */
  halfExtents?: { x: number; z: number };
}

interface TrafficCar {
  group: THREE.Group;
  vehicle: DriveableVehicle;
  axis: 'x' | 'z';
  direction: number;
  speed: number;
  wheels: THREE.Group[];
  index: number;
  kind: 'car' | 'truck' | 'bus';
  currentSpeed: number;
  blockedTime: number;
}

export interface CityShop {
  id: string;
  name: string;
  category: string;
  position: THREE.Vector3;
}

const PHOTO_CITY_TEXTURE_SIZE = 512;
// A smaller shadow map on phones: sharper than needed for a 92 m wide shadow area on a small screen.
const SHADOW_MAP_SIZE = Platform.OS === 'web' ? 2048 : 1536;
const SKY_TINTS: Record<CityBackdropZone, number> = { city: 0xffffff, dusk: 0xb99cc4, mountain: 0xe6f1ff, fuelStop: 0xffd2b0 };
const FACADE_TILE_METERS = 7;
const LANE_OFFSET = 2.2;
const SHADOW_EXTENT = 46;
const SUN_OFFSET = new THREE.Vector3(-34, 50, 22);
const STUCCO_SIZE = 256;
const BODEGA_WIDTH = 512;
const BODEGA_HEIGHT = 216;
const FACADE_TEXTURE_SIZE = 400;
const CITY_ENV_WIDTH = 1024;
const CITY_ENV_HEIGHT = 512;

type CityBackdropZone = 'city' | 'dusk' | 'mountain' | 'fuelStop';

export class RealisticCityBuilder {
  private readonly scene: THREE.Scene;
  private readonly collisions: THREE.Box3[] = [];
  private readonly traffic: TrafficCar[] = [];
  private readonly vehicles: DriveableVehicle[] = [];
  private readonly pedestrians: CityPedestrianNpc[] = [];
  private readonly shops: CityShop[] = [];
  private asphalt!: THREE.DataTexture;
  private asphaltNormal!: THREE.DataTexture;
  private asphaltRoughness!: THREE.DataTexture;
  private groundTexture!: THREE.DataTexture;
  private facade!: THREE.DataTexture;
  private stucco!: THREE.DataTexture;
  private environments!: Record<CityBackdropZone, THREE.DataTexture>;
  private brownstone!: THREE.DataTexture;
  private brownstoneNormal!: THREE.DataTexture;
  private brownstoneRoughness!: THREE.DataTexture;
  private bodega!: THREE.DataTexture;
  private facadeTextures!: THREE.DataTexture[];
  private skyDome!: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private facadeVariant = 0;
  private activeBackdrop: CityBackdropZone = 'city';
  private sunLight!: THREE.DirectionalLight;
  private ambientLight!: THREE.AmbientLight;
  private hemisphereLight!: THREE.HemisphereLight;
  private readonly windowGlass = new THREE.MeshPhysicalMaterial({ color: 0x63808b, roughness: 0.2, metalness: 0.48, clearcoat: 0.9, envMapIntensity: 1.15 });
  private readonly windowFrame = new THREE.MeshStandardMaterial({ color: 0x20282a, roughness: 0.38, metalness: 0.72 });
  private readonly limestone = new THREE.MeshStandardMaterial({ color: 0xc9bba4, roughness: 0.84 });
  private readonly entryDoor = new THREE.MeshStandardMaterial({ color: 0x24343b, roughness: 0.55, metalness: 0.18 });
  private readonly ironwork = new THREE.MeshStandardMaterial({ color: 0x202528, roughness: 0.46, metalness: 0.66 });

  private anisotropy = 1;
  /** Set by the WorldManager so parked vehicles can avoid tree trunks. */
  public trunkBlocked?: (x: number, z: number, radius: number) => boolean;

  constructor(scene: THREE.Scene, anisotropy = 1) {
    this.scene = scene;
    this.anisotropy = anisotropy;
  }

  /** Reads every texture from the bundle in parallel; must finish before build(). */
  public async loadTextures() {
    const read = (file: number) => loadBinaryAsset(file);
    const [
      asphalt, asphaltNormal, asphaltRoughness, brick, brickNormal, brickRoughness,
      office, stucco, bodega, envCity, envDusk, envMountain, envFuelStop, ...facades
    ] = await Promise.all([
      read(TEXTURE_FILES.asphaltAlbedo), read(TEXTURE_FILES.asphaltNormal), read(TEXTURE_FILES.asphaltRoughness),
      read(TEXTURE_FILES.brickAlbedo), read(TEXTURE_FILES.brickNormal), read(TEXTURE_FILES.brickRoughness),
      read(TEXTURE_FILES.officeFacade), read(TEXTURE_FILES.stucco), read(TEXTURE_FILES.bodega),
      read(TEXTURE_FILES.envCity), read(TEXTURE_FILES.envDusk), read(TEXTURE_FILES.envMountain), read(TEXTURE_FILES.envFuelStop),
      ...FACADE_FILES.map(read),
    ]);
    const size = PHOTO_CITY_TEXTURE_SIZE;
    this.asphalt = this.makeTexture(asphalt, size, size);
    this.asphaltNormal = this.makeTexture(asphaltNormal, size, size, THREE.NoColorSpace);
    this.asphaltRoughness = this.makeTexture(asphaltRoughness, size, size, THREE.NoColorSpace);
    this.groundTexture = this.makeGroundTexture();
    this.facade = this.makeTexture(office, 512, 512);
    this.stucco = this.makeTexture(stucco, STUCCO_SIZE, STUCCO_SIZE);
    this.environments = {
      city: this.makeEnvironment(envCity),
      dusk: this.makeEnvironment(envDusk),
      mountain: this.makeEnvironment(envMountain),
      fuelStop: this.makeEnvironment(envFuelStop),
    };
    this.brownstone = this.makeTexture(brick, size, size);
    this.brownstoneNormal = this.makeTexture(brickNormal, size, size, THREE.NoColorSpace);
    this.brownstoneRoughness = this.makeTexture(brickRoughness, size, size, THREE.NoColorSpace);
    this.bodega = this.makeTexture(bodega, BODEGA_WIDTH, BODEGA_HEIGHT);
    this.facadeTextures = facades.map((data) => this.makeTexture(data, FACADE_TEXTURE_SIZE, FACADE_TEXTURE_SIZE));
  }

  private makeEnvironment(data: ArrayBuffer) {
    const texture = this.makeTexture(data, CITY_ENV_WIDTH, CITY_ENV_HEIGHT);
    // These source images are already full 2:1 equirectangular panoramas.
    // Keep one copy across the sphere; repeating them made the skyline appear
    // duplicated and much smaller when used as a background.
    texture.repeat.set(1, 1);
    texture.offset.set(0, 0);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.mapping = THREE.EquirectangularReflectionMapping;
    return texture;
  }

  public build() {
    const preexisting = new Set<THREE.Object3D>(this.scene.children);
    this.buildAtmosphere();
    this.buildGround();
    this.buildRoadNetwork();
    this.buildDowntown();
    this.buildSuburbs();
    this.buildShops();
    this.buildMall();
    this.buildFuelStop();
    this.buildMountainPass();
    this.buildNightDistrict();
    this.buildStreetFurniture();
    this.mergeStaticMeshes(preexisting);
    return { collisionBoxes: this.collisions, vehicles: this.vehicles };
  }

  public async buildVehicles() {
    await VehicleModelLoader.preloadAll();
    const addDriveable = (id: string, name: string, key: VehicleModelKey, color: number, position: [number, number, number]) => {
      const model = VehicleModelLoader.create(key, color);
      model.group.position.set(...position);
      this.scene.add(model.group);
      this.vehicles.push({ id, name, group: model.group, wheels: model.wheels, type: 'roadster', seatOffset: new THREE.Vector3(0, 0.95, 0), active: false, speed: 0, steerAngle: 0, halfExtents: this.measure(model.group) });
    };
    addDriveable('city-sedan', 'City Sedan', 'sedan', 0x273b49, [4, 0, 2.5]);
    addDriveable('fuel-stop-suv', 'Utility SUV', 'suv', 0x8d473a, [40, 0, 13]);
    // Extra parked vehicles at the kerb along the main avenues and the park road,
    // so there is always something to hop into.
    const parked: [string, string, VehicleModelKey, number, [number, number, number], number][] = [
      ['parked-taxi', 'City Taxi', 'sedan', 0xf2c230, [4.8, 0, -42], 0],
      ['parked-van', 'Delivery Van', 'delivery-van', 0xe0e0dc, [-4.8, 0, -64], Math.PI],
      ['parked-pickup', 'Pickup Truck', 'pickup', 0x2f6b9a, [4.8, 0, 54], 0],
      ['parked-bus', 'School Bus', 'city-bus', 0xf0b323, [-4.8, 0, 78], Math.PI],
      ['parked-suv', 'Family SUV', 'suv', 0x6c8f5a, [4.8, 0, -18], 0],
      ['park-cruiser', 'Park Cruiser', 'sedan', 0xc0392b, [126, 0, -3.6], Math.PI / 2],
      ['park-wagon', 'Park Wagon', 'suv', 0x3a6ea5, [140, 0, 3.6], -Math.PI / 2],
    ];
    parked.forEach(([id, name, key, color, position, rotation]) => {
      const model = VehicleModelLoader.create(key, color);
      const halfExtents = this.measure(model.group);
      position = this.findClearSpot(position, rotation, halfExtents);
      model.group.position.set(...position);
      model.group.rotation.y = rotation;
      this.scene.add(model.group);
      this.vehicles.push({ id, name, group: model.group, wheels: model.wheels, type: 'roadster', seatOffset: new THREE.Vector3(0, 0.95, 0), active: false, speed: 0, steerAngle: rotation, halfExtents });
    });
    const motorcycle = this.createMotorcycle();
    const motorcycleSpot = this.findClearSpot([16, 0, 31], 0, { x: 0.45, z: 1.0 });
    motorcycle.position.set(...motorcycleSpot);
    this.scene.add(motorcycle);
    this.vehicles.push({ id: 'night-district-motorcycle', name: 'Street Motorcycle', group: motorcycle, type: 'roadster', seatOffset: new THREE.Vector3(0, 0.9, 0), active: false, speed: 0, steerAngle: 0, halfExtents: { x: 0.45, z: 1.0 } });

    // Leave the spawn junction open and distribute mixed traffic across the
    // longer avenues. The city bus, delivery vehicles, and private cars now
    // have room to circulate instead of forming a pile-up at the player.
    const traffic: { x: number; z: number; axis: 'x' | 'z'; direction: number; speed: number; model: VehicleModelKey; color: number; boxTruck?: boolean }[] = [
      { x: -88, z: -3.1, axis: 'x', direction: 1, speed: 3.1, model: 'sedan', color: 0x73808a },
      { x: 74, z: 3.1, axis: 'z', direction: -1, speed: 3.5, model: 'suv', color: 0xa5a49b },
      { x: -21, z: 72, axis: 'x', direction: -1, speed: 3.2, model: 'sedan', color: 0xe2b82f },
      { x: 72, z: -48, axis: 'z', direction: 1, speed: 2.7, model: 'city-bus', color: 0xc92d36 },
      { x: -72, z: 19, axis: 'z', direction: -1, speed: 3.0, model: 'delivery-van', color: 0xdedbd2 },
      { x: 18, z: -72, axis: 'x', direction: 1, speed: 3.4, model: 'pickup', color: 0x65777e },
      { x: 89, z: -3.1, axis: 'x', direction: -1, speed: 2.9, model: 'suv', color: 0x356378 },
      { x: -49, z: 61, axis: 'z', direction: 1, speed: 2.8, model: 'sedan', color: 0x296543 },
      { x: -86, z: -72, axis: 'x', direction: 1, speed: 2.5, model: 'pickup', color: 0xb9b9b3, boxTruck: true },
      { x: 54, z: 96, axis: 'x', direction: -1, speed: 2.3, model: 'pickup', color: 0x536b78, boxTruck: true },
    ];
    traffic.forEach(({ x, z, axis, direction, speed, model, color, boxTruck }, index) => {
      const vehicle = VehicleModelLoader.create(model, color);
      if (boxTruck) this.addPickupBoxTruckCargo(vehicle.group);
      const halfExtents = this.measure(vehicle.group);
      // Drive on the right: each direction gets its own lane so opposing
      // vehicles pass side by side instead of through each other.
      const laneZ = axis === 'x' ? Math.round(z / 24) * 24 + direction * LANE_OFFSET : z;
      const laneX = axis === 'z' ? Math.round(x / 24) * 24 - direction * LANE_OFFSET : x;
      vehicle.group.position.set(laneX, 0, laneZ);
      vehicle.group.rotation.y = axis === 'z' ? (direction > 0 ? 0 : Math.PI) : (direction > 0 ? Math.PI / 2 : -Math.PI / 2);
      this.scene.add(vehicle.group);
      const name = boxTruck ? 'Box Truck' : model === 'city-bus' ? 'City Bus' : model === 'delivery-van' ? 'Delivery Van' : model === 'pickup' ? 'Pickup Truck' : model === 'suv' ? 'City SUV' : 'City Car';
      const trafficVehicle: DriveableVehicle = {
        id: `traffic-vehicle-${index + 1}`,
        name,
        group: vehicle.group,
        wheels: vehicle.wheels,
        type: 'roadster',
        seatOffset: new THREE.Vector3(0, 0.95, 0),
        active: false,
        speed: 0,
        steerAngle: vehicle.group.rotation.y,
        halfExtents,
      };
      this.vehicles.push(trafficVehicle);
      this.traffic.push({ group: vehicle.group, vehicle: trafficVehicle, axis, direction, speed, wheels: vehicle.wheels, index, kind: model === 'city-bus' ? 'bus' : boxTruck || model === 'delivery-van' || model === 'pickup' ? 'truck' : 'car', currentSpeed: speed, blockedTime: 0 });
    });
  }

  /**
   * Drives one traffic car along its lane and brakes for anything in front:
   * buildings/props, other vehicles, and the player on foot. Crossing traffic
   * yields by index; after a long mutual stand-off the lower index goes first.
   */
  private updateTrafficCar(car: TrafficCar, delta: number, playerPos?: THREE.Vector3) {
    const { group, vehicle, axis, direction, speed, wheels } = car;
    if (vehicle.active || group.userData.playerDriven) return;
    const half = vehicle.halfExtents ?? { x: 1, z: 2 };
    // Axis-x cars face +/-x, so their body length lies along world x.
    const length = half.z;
    const width = half.x;
    const dirX = axis === 'x' ? direction : 0;
    const dirZ = axis === 'z' ? direction : 0;
    let blocked = false;
    let trafficBlocker: TrafficCar | null = null;
    const lookAhead = [length + 1.0, length + 2.6, length + 4.6 + car.currentSpeed];
    for (const distance of lookAhead) {
      for (const lateral of [-width * 0.85, 0, width * 0.85]) {
        const x = group.position.x + dirX * distance + dirZ * lateral;
        const z = group.position.z + dirZ * distance + dirX * lateral;
        if (this.isStaticBlocked(x, z, 0.15)) { blocked = true; break; }
        const other = this.vehicleAt(x, z, 0.1, null, vehicle);
        if (other) {
          const otherTraffic = this.traffic.find((t) => t.vehicle === other) ?? null;
          // After a stand-off, the lower index proceeds against another traffic car.
          if (otherTraffic && car.blockedTime > 3 && car.index < otherTraffic.index) continue;
          blocked = true;
          trafficBlocker = otherTraffic;
          break;
        }
        if (playerPos && Math.hypot(x - playerPos.x, z - playerPos.z) < 1.1) { blocked = true; break; }
      }
      if (blocked) break;
    }
    car.blockedTime = blocked ? car.blockedTime + delta : 0;
    void trafficBlocker;
    const target = blocked ? 0 : speed;
    car.currentSpeed = THREE.MathUtils.lerp(car.currentSpeed, target, Math.min(1, delta * (blocked ? 6 : 1.4)));
    if (car.currentSpeed < 0.02) car.currentSpeed = 0;
    group.position[axis] += direction * car.currentSpeed * delta;
    if (group.position[axis] > 96) group.position[axis] = -96;
    if (group.position[axis] < -96) group.position[axis] = 96;
    wheels.forEach((wheel) => { wheel.rotation.x -= direction * car.currentSpeed * delta / 0.35; });
  }

  /** Slides a parked vehicle along its axis until its whole footprint is clear of trees and buildings. */
  private findClearSpot(position: [number, number, number], rotation: number, half: { x: number; z: number }): [number, number, number] {
    const alongZ = Math.abs(Math.cos(rotation)) > 0.5;
    const clear = (px: number, pz: number) => {
      for (let a = -1; a <= 1; a += 0.5) {
        for (let b = -1; b <= 1; b += 0.25) {
          const lx = a * (half.x + 0.6);
          const lz = b * (half.z + 0.6);
          const x = px + lx * Math.cos(rotation) + lz * Math.sin(rotation);
          const z = pz - lx * Math.sin(rotation) + lz * Math.cos(rotation);
          if (this.isStaticBlocked(x, z, 0.1) || this.trunkBlocked?.(x, z, 0.2)) return false;
        }
      }
      return true;
    };
    for (const shift of [0, 3, -3, 6, -6, 9, -9, 12, -12, 16, -16]) {
      const px = alongZ ? position[0] : position[0] + shift;
      const pz = alongZ ? position[2] + shift : position[2];
      if (clear(px, pz)) return [px, position[1], pz];
    }
    return position;
  }


  /**
   * Performance: the city is built from thousands of small meshes. Every mesh costs JavaScript time
   * on every frame (matrix updates, culling, state changes, shadow pass), which is what makes a phone
   * lag. Static, opaque, single-material meshes are merged per material and 40 m map cell into a few
   * hundred larger meshes; tiny ones stop casting shadows. Looks identical, far less per-frame work.
   */
  private mergeStaticMeshes(preexisting: Set<THREE.Object3D>) {
    const CELL = 40;
    this.scene.updateMatrixWorld(true);
    // Everything the builder added to the scene (including meshes inside prop groups) is static scenery,
    // except the sky dome which follows the player.
    const candidates: THREE.Mesh[] = [];
    const roots = this.scene.children.filter((child) => !preexisting.has(child) && child !== this.skyDome);
    roots.forEach((rootObject) => rootObject.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh && !(mesh as THREE.InstancedMesh).isInstancedMesh && !(mesh as THREE.SkinnedMesh).isSkinnedMesh) candidates.push(mesh);
    }));
    type Group = { material: THREE.Material; cast: boolean; receive: boolean; geometries: THREE.BufferGeometry[]; meshes: THREE.Mesh[] };
    const groups = new Map<string, Group>();
    const position = new THREE.Vector3();
    for (const mesh of candidates) {
      const material = mesh.material;
      if (!mesh.parent || Array.isArray(material) || material.transparent || !mesh.visible || mesh.renderOrder !== 0) continue;
      const geometry = mesh.geometry;
      if (!geometry.attributes.position || !geometry.attributes.normal || !geometry.attributes.uv) continue;
      geometry.computeBoundingSphere();
      const scale = Math.max(mesh.scale.x, mesh.scale.y, mesh.scale.z);
      const cast = mesh.castShadow && (geometry.boundingSphere?.radius ?? 0) * scale > 0.6;
      mesh.getWorldPosition(position);
      const key = [material.uuid, cast, mesh.receiveShadow, Math.floor(position.x / CELL), Math.floor(position.z / CELL), geometry.index ? 'i' : 'n'].join('|');
      let group = groups.get(key);
      if (!group) {
        group = { material, cast, receive: mesh.receiveShadow, geometries: [], meshes: [] };
        groups.set(key, group);
      }
      const copy = geometry.clone();
      for (const name of Object.keys(copy.attributes)) {
        if (name !== 'position' && name !== 'normal' && name !== 'uv') copy.deleteAttribute(name);
      }
      copy.applyMatrix4(mesh.matrixWorld);
      group.geometries.push(copy);
      group.meshes.push(mesh);
    }
    let before = 0;
    let after = 0;
    groups.forEach((group) => {
      before += group.meshes.length;
      if (group.geometries.length < 2) { after += group.meshes.length; group.geometries.forEach((g) => g.dispose()); return; }
      const merged = mergeGeometries(group.geometries, false);
      group.geometries.forEach((g) => g.dispose());
      if (!merged) { after += group.meshes.length; return; }
      const mesh = new THREE.Mesh(merged, group.material);
      mesh.castShadow = group.cast;
      mesh.receiveShadow = group.receive;
      mesh.matrixAutoUpdate = false; // never moves
      mesh.name = 'merged-static';
      this.scene.add(mesh);
      group.meshes.forEach((original) => { original.parent?.remove(original); original.geometry.dispose(); });
      after += 1;
    });
    // Drop prop groups that are now empty.
    roots.forEach((rootObject) => { if (rootObject.children.length === 0 && !(rootObject as THREE.Mesh).isMesh && !(rootObject as THREE.Light).isLight && rootObject !== this.sunLight.target) this.scene.remove(rootObject); });
    this.staticMeshes.length = 0;
    console.log(`[perf] merged ${before} static meshes into ${after}`);
  }

  private measure(group: THREE.Group) {
    group.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
    return { x: Math.max(0.4, size.x / 2), z: Math.max(0.6, size.z / 2) };
  }

  /** True when (x, z) with the given radius lies inside any vehicle's body footprint. */
  public isBlockedByVehicle(x: number, z: number, radius: number, ignore?: THREE.Object3D | null) {
    return this.vehicleAt(x, z, radius, ignore) !== null;
  }

  private vehicleAt(x: number, z: number, radius: number, ignore?: THREE.Object3D | null, skip?: DriveableVehicle) {
    for (const vehicle of this.vehicles) {
      if (vehicle === skip || vehicle.group === ignore || !vehicle.halfExtents) continue;
      const { position, rotation } = vehicle.group;
      const dx = x - position.x;
      const dz = z - position.z;
      const cos = Math.cos(rotation.y);
      const sin = Math.sin(rotation.y);
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      if (Math.abs(lx) < vehicle.halfExtents.x + radius && Math.abs(lz) < vehicle.halfExtents.z + radius) return vehicle;
    }
    return null;
  }

  private isStaticBlocked(x: number, z: number, radius: number) {
    return this.collisions.some((box) => x + radius > box.min.x && x - radius < box.max.x && z + radius > box.min.z && z - radius < box.max.z);
  }

  /** A traffic car the player takes over (or leaves) stops following its lane and becomes a parked vehicle. */
  public releaseTrafficVehicle(vehicle: DriveableVehicle) {
    const index = this.traffic.findIndex((car) => car.vehicle === vehicle);
    if (index >= 0) this.traffic.splice(index, 1);
  }

  /** True when a pedestrian stands within `radius` of the point (used so driven vehicles stop for people). */
  public isBlockedByPedestrian(x: number, z: number, radius: number) {
    return this.pedestrians.some((p) => (p.group.position.x - x) ** 2 + (p.group.position.z - z) ** 2 < (radius + 0.45) ** 2);
  }

  /**
   * The paved road under (x, z), if any. When `preferAxis` is given and the point is
   * at a junction, the road running along that axis wins ('x' = runs along world x).
   */
  public roadInfoAt(x: number, z: number, preferAxis?: 'x' | 'z'): { axis: 'x' | 'z'; center: number } | null {
    let best: { axis: 'x' | 'z'; center: number } | null = null;
    let bestScore = Infinity;
    const consider = (axis: 'x' | 'z', center: number, offset: number, half: number) => {
      if (offset >= half) return;
      const score = offset / half + (preferAxis && preferAxis !== axis ? 2 : 0);
      if (score < bestScore) { bestScore = score; best = { axis, center }; }
    };
    for (let c = -96; c <= 96; c += 24) {
      const half = c === 0 ? 6 : 4;
      if (Math.abs(z) <= 108) consider('z', c, Math.abs(x - c), half);
      if (Math.abs(x) <= 108) consider('x', c, Math.abs(z - c), half);
    }
    if (x >= 108 && x <= 208) consider('x', 0, Math.abs(z), 6);
    return best;
  }

  /** Closest point on any road centre line, with the heading that follows it. */
  public nearestRoadPoint(x: number, z: number) {
    const snap = (value: number) => Math.max(-96, Math.min(96, Math.round(value / 24) * 24));
    const onZ = { x: snap(x), z: Math.max(-104, Math.min(104, z)), heading: 0 };
    const onX = { x: Math.max(-104, Math.min(104, x)), z: snap(z), heading: Math.PI / 2 };
    return (onZ.x - x) ** 2 < (onX.z - z) ** 2 ? onZ : onX;
  }

  /** Positions/speeds of moving traffic for the ambient engine-sound mixer. */
  public getTrafficSnapshot() {
    return this.traffic.map((car) => ({ x: car.group.position.x, z: car.group.position.z, speed: car.currentSpeed, kind: car.kind }));
  }

  public getDriveableVehicles() {
    return this.vehicles;
  }

  public async buildPedestrians() {
    await CityPedestrianLoader.preloadAll();
    const models: PedestrianModelKey[] = ['rpm'];
    const firstNames = ['Mira', 'Arjun', 'Nila', 'Kabir', 'Anaya', 'Dev', 'Tara', 'Ishaan', 'Asha', 'Ravi', 'Riya', 'Aarav'];
    // Sidewalks run beside the real avenue grid (every 24 m; the centre avenues
    // are wider). The old list used block centres, so walkers cut through buildings.
    const roads = [-96, -72, -48, -24, 0, 24, 48, 72, 96];
    const routes: { axis: 'x' | 'z'; fixed: number }[] = [];
    roads.forEach((road) => {
      const sidewalk = road === 0 ? 7.4 : 5.4;
      [-1, 1].forEach((side) => {
        routes.push({ axis: 'z', fixed: road + side * sidewalk });
        routes.push({ axis: 'x', fixed: road + side * sidewalk });
      });
    });

    // Two walkers on each of the 32 sidewalks around the avenue grid. Their
    // paths stay beside the curb and spread across the full playable town.
    // Add a second staggered wave around the central shopping streets.
    const pedestrianCount = 28;
    // Up to 3x as many candidates as walkers: routes that are blocked by buildings are skipped.
    for (let index = 0; index < pedestrianCount * 3 && this.pedestrians.length < pedestrianCount; index++) {
      const routeIndex = index % routes.length;
      const route = routes[routeIndex];
      const wave = Math.floor(index / routes.length);
      const name = `${firstNames[index % firstNames.length]} ${String(index + 1).padStart(2, '0')}`;
      // Each walker patrols only the stretch of sidewalk that is free of buildings, so it never
      // walks into (or jitters against) a wall.
      const blockedAt = (c: number) => route.axis === 'z' ? this.isStaticBlocked(route.fixed, c, 0.45) : this.isStaticBlocked(c, route.fixed, 0.45);
      let progress = -84 + ((routeIndex * 47 + wave * 31) % 168);
      if (blockedAt(progress)) {
        let found: number | null = null;
        for (let d = 1; d < 70 && found === null; d++) {
          if (!blockedAt(progress + d)) found = progress + d;
          else if (!blockedAt(progress - d)) found = progress - d;
        }
        if (found === null) continue;
        progress = found;
      }
      let low = progress;
      let high = progress;
      while (high < 100 && !blockedAt(high + 0.5)) high += 0.5;
      while (low > -100 && !blockedAt(low - 0.5)) low -= 0.5;
      if (high - low < 8) continue; // too short a stretch to be worth a walker
      const pedestrian = CityPedestrianLoader.create(models[index % models.length], `ped-${index + 1}`, name);
      if (route.axis === 'z') pedestrian.group.position.set(route.fixed, 0, progress);
      else pedestrian.group.position.set(progress, 0, route.fixed);
      pedestrian.axis = route.axis;
      pedestrian.minCoordinate = low + 0.6;
      pedestrian.maxCoordinate = high - 0.6;
      pedestrian.direction = (index + routeIndex) % 2 === 0 ? 1 : -1;
      pedestrian.group.rotation.y = route.axis === 'z'
        ? (pedestrian.direction > 0 ? 0 : Math.PI)
        : (pedestrian.direction > 0 ? Math.PI / 2 : -Math.PI / 2);
      this.scene.add(pedestrian.group);
      this.pedestrians.push(pedestrian);
    }
  }

  public getPedestrians() {
    return this.pedestrians;
  }

  public getShops() {
    return this.shops;
  }

  public greetPedestrian(name: string) {
    const pedestrian = this.pedestrians.find((person) => person.name === name);
    if (!pedestrian) return false;
    pedestrian.greetingTimer = 2.2;
    pedestrian.walkAction.stop();
    if (pedestrian.greetAction) {
      pedestrian.greetAction.reset();
      pedestrian.greetAction.setLoop(THREE.LoopOnce, 1);
      pedestrian.greetAction.clampWhenFinished = true;
      pedestrian.greetAction.play();
    }
    return true;
  }

  public update(delta: number, playerPos?: THREE.Vector3) {
    if (playerPos) {
      this.updateBackdrop(playerPos);
      this.skyDome.position.set(playerPos.x, 0, playerPos.z);
      // Snap to shadow-map texels so shadow edges do not shimmer while walking.
      const texel = (SHADOW_EXTENT * 2) / SHADOW_MAP_SIZE;
      const sx = Math.round(playerPos.x / texel) * texel;
      const sz = Math.round(playerPos.z / texel) * texel;
      this.sunLight.target.position.set(sx, 0, sz);
      this.sunLight.position.set(sx + SUN_OFFSET.x, SUN_OFFSET.y, sz + SUN_OFFSET.z);
    }
    this.traffic.forEach((car) => this.updateTrafficCar(car, delta, playerPos));
    // Vehicles far from the player are detached from the scene (they keep their position and still move).
    if (playerPos) {
      for (const vehicle of this.vehicles) {
        if (vehicle.active || vehicle.group.userData.playerDriven) continue;
        const far = vehicle.group.position.distanceToSquared(playerPos) > 120 * 120;
        if (far && vehicle.group.parent) this.scene.remove(vehicle.group);
        else if (!far && !vehicle.group.parent) this.scene.add(vehicle.group);
      }
    }
    this.pedestrians.forEach((pedestrian) => {
      // Keep animations smooth near the player while avoiding dozens of
      // off-screen skeleton updates on mobile devices.
      const distanceSquared = playerPos ? pedestrian.group.position.distanceToSquared(playerPos) : 0;
      // Walkers beyond ~65 m are taken out of the scene and not animated. Each carries ~70 bones, and
      // even hidden objects cost matrix updates every frame, so detaching them saves real CPU time.
      const nearPlayer = distanceSquared < 65 * 65;
      if (nearPlayer && !pedestrian.group.parent) this.scene.add(pedestrian.group);
      else if (!nearPlayer && pedestrian.group.parent) this.scene.remove(pedestrian.group);
      if (nearPlayer) pedestrian.mixer.update(delta);
      if (pedestrian.greetingTimer > 0) {
        pedestrian.greetingTimer = Math.max(0, pedestrian.greetingTimer - delta);
        if (pedestrian.greetingTimer === 0) {
          pedestrian.greetAction?.stop();
          pedestrian.walkAction.reset().play();
          pedestrian.walkAction.paused = false;
        }
        return;
      }
      // Pause for vehicles (at crossings) or the player right in front.
      const ahead = pedestrian.group.position.clone();
      ahead[pedestrian.axis] += pedestrian.direction * 1.4;
      const insideVehicle = this.isBlockedByVehicle(pedestrian.group.position.x, pedestrian.group.position.z, 0.1);
      const vehicleAhead = !insideVehicle && this.isBlockedByVehicle(ahead.x, ahead.z, 0.5);
      const personAhead = !!playerPos && Math.hypot(ahead.x - playerPos.x, ahead.z - playerPos.z) < 0.9;
      const waiting = vehicleAhead || personAhead;
      pedestrian.walkAction.paused = waiting;
      if (waiting) {
        // A walker never waits for ever: if a vehicle stays in the way (a parked car on its route, a
        // vehicle waiting for it) it turns around - otherwise the pair would block each other.
        const waited = (this.pedestrianWait.get(pedestrian.id) ?? 0) + delta;
        if (vehicleAhead && waited > 1.2) {
          this.pedestrianWait.set(pedestrian.id, 0);
          pedestrian.direction = pedestrian.direction === 1 ? -1 : 1;
          pedestrian.group.rotation.y += Math.PI;
          pedestrian.walkAction.paused = false;
        } else {
          this.pedestrianWait.set(pedestrian.id, waited);
        }
        return;
      }
      this.pedestrianWait.set(pedestrian.id, 0);
      pedestrian.group.position[pedestrian.axis] += pedestrian.direction * pedestrian.speed * delta;
      // Turn around at either end of the patrol. The position is clamped so a walker can never
      // stay out of range and flip direction every frame.
      const coordinate = pedestrian.group.position[pedestrian.axis];
      const atMax = coordinate >= pedestrian.maxCoordinate;
      const atMin = coordinate <= pedestrian.minCoordinate;
      if (atMax || atMin) {
        pedestrian.group.position[pedestrian.axis] = atMax ? pedestrian.maxCoordinate : pedestrian.minCoordinate;
        pedestrian.direction = atMax ? -1 : 1;
        pedestrian.group.rotation.y = pedestrian.axis === 'z'
          ? (pedestrian.direction > 0 ? 0 : Math.PI)
          : (pedestrian.direction > 0 ? Math.PI / 2 : -Math.PI / 2);
      }
    });
  }

  /** Pixels are pre-flipped by the asset pipeline, so this only wraps the buffer. */
  private makeTexture(data: ArrayBuffer, width: number, height: number, colorSpace: THREE.ColorSpace = THREE.SRGBColorSpace) {
    const pixels = new Uint8Array(data);
    const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
    texture.colorSpace = colorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    // Sharper roads, brick and facades at grazing angles; cheap on A-series GPUs.
    texture.anisotropy = this.anisotropy;
    texture.needsUpdate = true;
    return texture;
  }

  private makeSkyGradient() {
    const height = 128;
    const pixels = new Uint8Array(height * 4);
    const zenith = new THREE.Color(0x3f78c8);
    const horizon = new THREE.Color(0xd4e2ee);
    const color = new THREE.Color();
    for (let y = 0; y < height; y++) {
      // y = 0 is the bottom of the sphere (texture v = 0): haze at the horizon,
      // deepening to blue overhead; below the horizon stays haze-coloured.
      const v = y / (height - 1);
      const t = Math.pow(Math.max(0, (v - 0.5) / 0.5), 0.7);
      color.copy(horizon).lerp(zenith, t);
      pixels[y * 4] = Math.round(color.r * 255);
      pixels[y * 4 + 1] = Math.round(color.g * 255);
      pixels[y * 4 + 2] = Math.round(color.b * 255);
      pixels[y * 4 + 3] = 255;
    }
    const texture = new THREE.DataTexture(pixels, 1, height, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }

  private makeGroundTexture() {
    const size = 256;
    const pixels = new Uint8Array(size * size * 4);
    const tau = Math.PI * 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const coarse = Math.sin(x * tau / 64 + Math.cos(y * tau / 128)) * Math.cos(y * tau / 64 + Math.sin(x * tau / 128));
        const fine = Math.sin(x * tau / 8 + y * tau / 16) * Math.cos(y * tau / 12 - x * tau / 32);
        const grain = Math.sin((x * 53 + y * 97) * tau / size) * Math.cos((y * 73 - x * 31) * tau / size);
        const shade = coarse * 8 + fine * 3.4 + grain * 12;
        const i = (y * size + x) * 4;
        pixels[i] = 76 + shade;
        pixels[i + 1] = 91 + shade;
        pixels[i + 2] = 68 + shade * 0.82;
        pixels[i + 3] = 255;
      }
    }
    const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(12, 12);
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }

  // Identical materials are shared (fewer uniform uploads and state changes, and meshes can be merged).
  private readonly materialCache = new Map<string, THREE.MeshStandardMaterial>();
  private readonly staticMeshes: THREE.Mesh[] = [];
  private readonly pedestrianWait = new Map<string, number>();

  private material(color: number, roughness = 0.85, metalness = 0) {
    const key = `${color}|${roughness}|${metalness}`;
    let material = this.materialCache.get(key);
    if (!material) {
      material = new THREE.MeshStandardMaterial({ color, roughness, metalness });
      this.materialCache.set(key, material);
    }
    return material;
  }

  private addMesh<T extends THREE.BufferGeometry>(geometry: T, material: THREE.Material | THREE.Material[], position: THREE.Vector3) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.staticMeshes.push(mesh);
    return mesh;
  }

  private buildAtmosphere() {
    // Draw the authored panorama as real scene geometry. This is more reliable
    // than Scene.background's equirectangular shader path on Expo GL and makes
    // the generated images visibly present while the player explores.
    this.scene.background = new THREE.Color(0x899bb2);
    this.skyDome = new THREE.Mesh(
      new THREE.SphereGeometry(150, 48, 32),
      // A clean procedural gradient replaces the low-resolution panorama on the
      // dome: stretching a 1024x512 image over a 150 m sphere looked blurry.
      // The panoramas still drive reflections through scene.environment.
      new THREE.MeshBasicMaterial({ map: this.makeSkyGradient(), side: THREE.BackSide, depthWrite: false, fog: false })
    );
    this.skyDome.name = 'Generated city panorama sky dome';
    // SphereGeometry places its longitude seam on +Z; rotate it so the
    // panorama's center boulevard faces the player's default forward view.
    this.skyDome.rotation.y = Math.PI;
    this.skyDome.renderOrder = -1000;
    this.scene.add(this.skyDome);
    this.scene.environment = this.environments.city;
    this.scene.environmentIntensity = 0.55;
    this.scene.fog = new THREE.Fog(0xb4c3d2, 96, 190);

    this.hemisphereLight = new THREE.HemisphereLight(0x8599c4, 0x48382f, 0.92);
    this.ambientLight = new THREE.AmbientLight(0xc9ada0, 0.38);
    this.scene.add(this.hemisphereLight, this.ambientLight);
    this.sunLight = new THREE.DirectionalLight(0xffefcf, 1.85);
    this.sunLight.position.set(-34, 50, 22);
    this.sunLight.castShadow = true;
    // The shadow frustum follows the player (see update()), so a small area
    // gets a dense shadow map: crisp contact shadows near the child and
    // vehicles instead of one blurry map stretched over the whole city.
    this.sunLight.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    this.sunLight.shadow.camera.left = -SHADOW_EXTENT;
    this.sunLight.shadow.camera.right = SHADOW_EXTENT;
    this.sunLight.shadow.camera.top = SHADOW_EXTENT;
    this.sunLight.shadow.camera.bottom = -SHADOW_EXTENT;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 140;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.04;
    this.scene.add(this.sunLight, this.sunLight.target);
  }

  private updateBackdrop(position: THREE.Vector3) {
    let zone: CityBackdropZone = 'city';
    if (position.x < -18 && position.z >= -2 && position.z < 44) zone = 'mountain';
    else if (position.x > 25 && position.z >= 7 && position.z < 34) zone = 'fuelStop';
    else if (Math.abs(position.x) < 16 && position.z >= 27) zone = 'dusk';
    if (zone === this.activeBackdrop) return;

    this.activeBackdrop = zone;
    const environment = this.environments[zone];
    this.skyDome.material.color.setHex(SKY_TINTS[zone]);
    this.scene.environment = environment;
    const lighting = {
      city: { sky: 0x8599c4, ground: 0x48382f, hemi: 0.92, ambient: 0xc9ada0, ambientIntensity: 0.38, sun: 0xffefcf, sunIntensity: 1.85 },
      dusk: { sky: 0x766f9d, ground: 0x332c35, hemi: 0.55, ambient: 0x92758c, ambientIntensity: 0.4, sun: 0xffa56c, sunIntensity: 0.75 },
      mountain: { sky: 0xaac5e8, ground: 0x3d4a42, hemi: 1.05, ambient: 0xa8b7ca, ambientIntensity: 0.4, sun: 0xfff1db, sunIntensity: 2.05 },
      fuelStop: { sky: 0xb399a8, ground: 0x4b3933, hemi: 0.78, ambient: 0xd0a08c, ambientIntensity: 0.44, sun: 0xffb775, sunIntensity: 1.3 },
    }[zone];
    this.hemisphereLight.color.setHex(lighting.sky);
    this.hemisphereLight.groundColor.setHex(lighting.ground);
    this.hemisphereLight.intensity = lighting.hemi;
    this.ambientLight.color.setHex(lighting.ambient);
    this.ambientLight.intensity = lighting.ambientIntensity;
    this.sunLight.color.setHex(lighting.sun);
    this.sunLight.intensity = lighting.sunIntensity;
  }

  private buildGround() {
    // A much larger lawn under and beyond the city so the world feels open and
    // green all the way to the fog line (UVs scaled to keep the grass grain).
    const lawnGeometry = new THREE.PlaneGeometry(560, 560);
    const lawnUv = lawnGeometry.getAttribute('uv');
    for (let i = 0; i < lawnUv.count; i++) lawnUv.setXY(i, lawnUv.getX(i) * 2.4, lawnUv.getY(i) * 2.4);
    const lawn = this.addMesh(lawnGeometry, new THREE.MeshStandardMaterial({ map: this.groundTexture, roughness: 1 }), new THREE.Vector3(0, -0.2, 0));
    lawn.rotation.x = -Math.PI / 2;
    lawn.receiveShadow = true;
    // The main avenue continues east into the Learning Park.
    const extensionGeometry = new THREE.PlaneGeometry(100, 12);
    const extensionUv = extensionGeometry.getAttribute('uv');
    for (let i = 0; i < extensionUv.count; i++) extensionUv.setXY(i, extensionUv.getX(i) * 100 / 5, extensionUv.getY(i) * 12 / 5);
    const extension = this.addMesh(extensionGeometry, this.roadMaterial(), new THREE.Vector3(158, 0.015, 0));
    extension.castShadow = false;
    lawn.castShadow = false;
    extension.rotation.x = -Math.PI / 2;
    const ground = this.addMesh(
      new THREE.PlaneGeometry(240, 240),
      new THREE.MeshStandardMaterial({ map: this.groundTexture, roughness: 1 }),
      new THREE.Vector3(0, -0.16, 0)
    );
    ground.rotation.x = -Math.PI / 2;

    // Waterfront and river edge from the reference's coastal city scenes.
    const water = this.addMesh(
      new THREE.PlaneGeometry(24, 220),
      new THREE.MeshStandardMaterial({ color: 0x557783, roughness: 0.24, metalness: 0.32 }),
      new THREE.Vector3(118, -0.06, 0)
    );
    water.rotation.x = -Math.PI / 2;
    this.addMesh(new THREE.BoxGeometry(0.45, 0.7, 220), this.material(0x969890, 0.92), new THREE.Vector3(105, 0.15, 0));
  }

  private roadMaterial() {
    return new THREE.MeshStandardMaterial({
      map: this.asphalt,
      normalMap: this.asphaltNormal,
      normalScale: new THREE.Vector2(0.42, 0.42),
      roughnessMap: this.asphaltRoughness,
      roughness: 0.5,
      metalness: 0.025,
    });
  }

  private brickMaterial(color: number, repeatX: number, repeatY: number) {
    const map = this.brownstone.clone();
    const normalMap = this.brownstoneNormal.clone();
    const roughnessMap = this.brownstoneRoughness.clone();
    [map, normalMap, roughnessMap].forEach((texture) => texture.repeat.set(repeatX, repeatY));
    return new THREE.MeshStandardMaterial({
      map,
      normalMap,
      normalScale: new THREE.Vector2(0.32, 0.32),
      roughnessMap,
      color,
      roughness: 0.9,
      metalness: 0,
    });
  }

  private buildRoadNetwork() {
    const roads = [-96, -72, -48, -24, 0, 24, 48, 72, 96].flatMap((offset) => [
      { x: offset, z: 0, width: offset === 0 ? 12 : 8, length: 216 },
      { x: 0, z: offset, width: 216, length: offset === 0 ? 12 : 8 },
    ]);
    roads.forEach(({ x, z, width, length }) => {
      const geometry = new THREE.PlaneGeometry(width, length);
      const uv = geometry.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, uv.getX(i) * width / 5, uv.getY(i) * length / 5);
      }
      uv.needsUpdate = true;
      const road = this.addMesh(geometry, this.roadMaterial(), new THREE.Vector3(x, 0.015, z));
      road.rotation.x = -Math.PI / 2;

      const runsAlongZ = length > width;
      const runLength = runsAlongZ ? length : width;
      const dashCount = Math.floor(runLength / 5);
      const dashGeometry = new THREE.BoxGeometry(runsAlongZ ? 0.12 : 2.4, 0.018, runsAlongZ ? 2.4 : 0.12);
      const dashMaterial = this.material(0xe5dfc9, 0.8);
      const dashInstances = new THREE.InstancedMesh(dashGeometry, dashMaterial, dashCount);
      const dashTransform = new THREE.Object3D();
      for (let i = 0; i < dashCount; i++) {
        const offset = -runLength / 2 + i * 5 + 1.1;
        dashTransform.position.set(runsAlongZ ? x : x + offset, 0.032, runsAlongZ ? z + offset : z);
        dashTransform.updateMatrix();
        dashInstances.setMatrixAt(i, dashTransform.matrix);
      }
      dashInstances.instanceMatrix.needsUpdate = true;
      dashInstances.castShadow = false;
      dashInstances.receiveShadow = true;
      this.scene.add(dashInstances);

      // Concrete curbs and sidewalks make the street edge legible and walkable.
      const edgeMaterial = this.material(0xa0a09a, 0.95);
      [-1, 1].forEach((side) => {
        const edge = width / 2 + 0.2;
        const curb = this.addMesh(
          new THREE.BoxGeometry(runsAlongZ ? 0.32 : runLength, 0.18, runsAlongZ ? runLength : 0.32),
          edgeMaterial,
          new THREE.Vector3(runsAlongZ ? x + side * edge : x, 0.03, runsAlongZ ? z : z + side * edge)
        );
        curb.castShadow = false;
      });
    });

    // Crosswalk stripes at the main junction.
    for (let i = 0; i < 8; i++) {
      const offset = -4.2 + i * 1.2;
      this.addMesh(new THREE.BoxGeometry(0.72, 0.016, 4.4), this.material(0xdeddd6, 0.85), new THREE.Vector3(offset, 0.035, -7.5));
      this.addMesh(new THREE.BoxGeometry(4.4, 0.016, 0.72), this.material(0xdeddd6, 0.85), new THREE.Vector3(7.5, 0.035, offset));
    }
  }

  private addBuilding(x: number, z: number, width: number, depth: number, height: number, style: 'glass' | 'concrete' = 'glass', night = false) {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const source = this.facadeTextures[this.facadeVariant++ % this.facadeTextures.length];
    // Each photo covers one FACADE_TILE_METERS square of wall. The old code used
    // a single repeat for all four walls, so the narrower/wider side stretched
    // the windows. Give every wall its own whole-number repeat from its real
    // size (rounded, so the photo never cuts mid-window at a corner).
    const facadeMaterial = (wallWidth: number) => {
      const texture = source.clone();
      texture.needsUpdate = true;
      texture.repeat.set(Math.max(1, Math.round(wallWidth / FACADE_TILE_METERS)), Math.max(1, Math.round(height / FACADE_TILE_METERS)));
      return new THREE.MeshStandardMaterial({
        map: texture,
        color: 0xffffff,
        roughness: style === 'glass' ? 0.42 : 0.9,
        metalness: style === 'glass' ? 0.16 : 0.02,
        emissive: night ? 0x192133 : 0x000000,
        emissiveIntensity: night ? 0.52 : 0,
      });
    };
    const frontMaterial = facadeMaterial(width);
    const sideMaterial = facadeMaterial(depth);
    const roofMaterial = this.material(style === 'glass' ? 0x354047 : 0x554b43, 0.88);
    // Keep the photo facade on the four vertical walls and give the roof a
    // solid finish so aerial angles never show stretched windows overhead.
    const body = this.addMesh(
      geometry,
      [sideMaterial, sideMaterial, roofMaterial, roofMaterial, frontMaterial, frontMaterial],
      new THREE.Vector3(x, height / 2, z)
    );
    this.addMesh(new THREE.BoxGeometry(width + 0.5, 0.3, depth + 0.5), this.material(0x3a4145, 0.58, 0.24), new THREE.Vector3(x, 0.15, z));

    if (height > 12) this.addCommercialEntrance(x, z, width, depth);

    // Roof parapet and rooftop plant equipment add depth at street level.
    this.addMesh(new THREE.BoxGeometry(width + 0.16, 0.32, depth + 0.16), this.material(0x555d61, 0.74), new THREE.Vector3(x, height + 0.1, z));
    if (height > 12) {
      this.addMesh(new THREE.BoxGeometry(width * 0.32, 1.1, depth * 0.28), this.material(0x727a7c, 0.84), new THREE.Vector3(x + width * 0.18, height + 0.78, z - depth * 0.12));
    }
    body.userData.collision = true;
    this.collisions.push(new THREE.Box3(
      new THREE.Vector3(x - width / 2 - 0.35, 0, z - depth / 2 - 0.35),
      new THREE.Vector3(x + width / 2 + 0.35, height + 1.5, z + depth / 2 + 0.35)
    ));
  }

  private addCommercialEntrance(x: number, z: number, width: number, depth: number) {
    const front = z + depth / 2 + 0.09;
    const displayWidth = Math.max(1.35, (width - 1.35) / 2);
    const displayHeight = 2.95;
    [-1, 1].forEach((side) => {
      const displayX = x + side * (0.675 + displayWidth / 2);
      this.addMesh(new THREE.BoxGeometry(displayWidth, displayHeight, 0.07), this.windowGlass, new THREE.Vector3(displayX, 1.78, front));
      [-displayWidth / 2, 0, displayWidth / 2].forEach((offset) => {
        this.addMesh(new THREE.BoxGeometry(0.07, displayHeight + 0.12, 0.14), this.windowFrame, new THREE.Vector3(displayX + offset, 1.78, front + 0.05));
      });
      this.addMesh(new THREE.BoxGeometry(displayWidth + 0.12, 0.12, 0.15), this.windowFrame, new THREE.Vector3(displayX, 3.28, front + 0.05));
    });

    this.addMesh(new THREE.BoxGeometry(1.22, 2.58, 0.08), this.entryDoor, new THREE.Vector3(x, 1.55, front + 0.015));
    this.addMesh(new THREE.BoxGeometry(1.32, 0.14, 0.16), this.limestone, new THREE.Vector3(x, 2.89, front + 0.055));
    this.addMesh(new THREE.BoxGeometry(width + 0.16, 0.22, 0.78), this.material(0x343b3e, 0.5, 0.42), new THREE.Vector3(x, 3.38, front + 0.34));
    this.addMesh(new THREE.BoxGeometry(width + 0.3, 0.18, 0.22), this.material(0xb8a786, 0.72, 0.06), new THREE.Vector3(x, 3.16, front + 0.05));
  }

  private buildDowntown() {
    const towers: [number, number, number, number, number][] = [
      [-13, -15, 7.5, 7, 27], [13, -15, 8, 7, 34],
      [-13, 15, 8, 7, 23], [13, 15, 7, 8, 30],
      [-34, -14, 7, 7, 18], [34, -14, 8, 7, 21],
      [-34, 14, 8, 7, 22], [34, 14, 7, 8, 18],
      [-13, -34, 7, 7, 20], [13, -34, 8, 7, 24],
      [-58, -32, 8, 8, 24], [-58, -12, 8, 8, 30], [-58, 12, 8, 8, 27], [-58, 32, 8, 8, 22],
      [58, -32, 8, 8, 28], [58, -12, 8, 8, 34], [58, 12, 8, 8, 25], [58, 32, 8, 8, 21],
      [-32, -58, 8, 8, 26], [-12, -58, 8, 8, 33], [12, -58, 8, 8, 29], [32, -58, 8, 8, 22],
      [-32, 58, 8, 8, 20], [-12, 58, 8, 8, 28], [12, 58, 8, 8, 32], [32, 58, 8, 8, 24],
    ];
    towers.forEach(([x, z, width, depth, height], index) => {
      this.addBuilding(x, z, width, depth, height, 'glass', index > 7);
    });
    // A second ring of towers and offices makes the city continue beyond the
    // original downtown blocks instead of ending at the first avenue loop.
    // Blocks sit between avenues every 24 m, so their centres are at +/-12, 36, 60.
    const outerOffsets = [-60, -36, -12, 12, 36, 60];
    outerOffsets.forEach((offset, index) => {
      this.addBuilding(-84, offset, 8, 8, 20 + (index % 3) * 5, index % 2 ? 'concrete' : 'glass', index % 2 === 0);
      this.addBuilding(84, offset, 8, 8, 24 + ((index + 1) % 3) * 5, index % 2 ? 'glass' : 'concrete', index % 2 === 1);
      {
        this.addBuilding(offset, -84, 8, 8, 18 + ((index + 2) % 4) * 4, index % 2 ? 'concrete' : 'glass', index % 2 === 0);
        this.addBuilding(offset, 84, 8, 8, 21 + (index % 4) * 4, index % 2 ? 'glass' : 'concrete', index % 2 === 1);
      }
    });
    this.addMesh(new THREE.PlaneGeometry(26, 26), this.material(0x777b78, 0.94), new THREE.Vector3(0, 0.004, 0)).rotation.x = -Math.PI / 2;
    this.addPlanter(-8, -8);
    this.addPlanter(8, 8);
  }

  private buildSuburbs() {
    const lots: [number, number, number][] = [
      // One row per city block (blocks are 16 m wide between avenues every 24 m).
      [-33, -60, 0], [-33, -36, 1], [-33, -13, 2],
      [-15, -60, 1], [-15, -36, 2], [-15, -13, 0],
    ];
    lots.forEach(([x, z, variant]) => {
      const width = 7.8;
      const depth = 6.8;
      const height = 8.1;
      const frontZ = z + depth / 2;
      const brickTint = [0xffffff, 0xe7ded2, 0xf1e4d7][variant];
      const brickMap = this.brownstone.clone();
      const brickNormal = this.brownstoneNormal.clone();
      const brickRoughness = this.brownstoneRoughness.clone();
      const repeatX = width / 1.6;
      const repeatY = height / 1.0;
      [brickMap, brickNormal, brickRoughness].forEach((texture) => texture.repeat.set(repeatX, repeatY));
      const walls = new THREE.MeshStandardMaterial({ map: brickMap, normalMap: brickNormal, normalScale: new THREE.Vector2(0.32, 0.32), roughnessMap: brickRoughness, color: brickTint, roughness: 0.9 });

      this.addMesh(new THREE.BoxGeometry(width, height, depth), walls, new THREE.Vector3(x, height / 2, z));
      this.addMesh(new THREE.BoxGeometry(width + 0.35, 0.38, depth + 0.35), this.material(0x433d37, 0.92), new THREE.Vector3(x, 0.18, z));
      this.addMesh(new THREE.BoxGeometry(width + 0.48, 0.34, depth + 0.48), this.limestone, new THREE.Vector3(x, height - 0.18, z));
      this.addMesh(new THREE.BoxGeometry(width + 0.7, 0.2, depth + 0.7), this.material(0x464039, 0.8), new THREE.Vector3(x, height + 0.04, z));

      // Two residential floors with deeply framed, reflective sash windows.
      [-2.05, 0.1].forEach((windowX) => {
        [3.0, 6.0].forEach((windowY) => this.addBrownstoneWindow(x + windowX, windowY, frontZ + 0.045));
      });
      [-2.25, 0].forEach((windowZ) => {
        [3.0, 6.0].forEach((windowY) => this.addBrownstoneWindow(x - width / 2 - 0.045, windowY, z + windowZ, 'left'));
      });

      // Recessed entry, limestone surround, stoop, and iron handrails.
      const doorX = x + 2.55;
      const doorZ = frontZ + 0.09;
      this.addMesh(new THREE.BoxGeometry(1.42, 2.82, 0.22), this.limestone, new THREE.Vector3(doorX, 1.96, doorZ));
      this.addMesh(new THREE.BoxGeometry(1.08, 2.45, 0.17), this.entryDoor, new THREE.Vector3(doorX, 1.88, doorZ + 0.12));
      [1.34, 2.35].forEach((panelY) => this.addMesh(new THREE.BoxGeometry(0.72, 0.68, 0.035), this.material(0x354a50, 0.56, 0.16), new THREE.Vector3(doorX, panelY, doorZ + 0.22)));
      this.addMesh(new THREE.SphereGeometry(0.055, 10, 8), this.material(0xc0a665, 0.35, 0.72), new THREE.Vector3(doorX - 0.38, 1.75, doorZ + 0.27));
      [0, 1, 2].forEach((step) => this.addMesh(
        new THREE.BoxGeometry(1.8, 0.2, 0.46),
        this.material(0xb9ac96, 0.9),
        new THREE.Vector3(doorX, 0.1 + step * 0.22, frontZ + 0.38 + step * 0.43)
      ));
      [-0.84, 0.84].forEach((side) => {
        const railX = doorX + side;
        this.addMesh(new THREE.CylinderGeometry(0.045, 0.055, 0.94, 8), this.ironwork, new THREE.Vector3(railX, 0.76, frontZ + 0.8));
        this.addMesh(new THREE.CylinderGeometry(0.035, 0.035, 0.78, 6), this.ironwork, new THREE.Vector3(railX, 0.62, frontZ + 1.12));
        this.addMesh(new THREE.CylinderGeometry(0.035, 0.035, 0.78, 6), this.ironwork, new THREE.Vector3(railX, 0.62, frontZ + 1.48));
        this.addMesh(new THREE.CylinderGeometry(0.045, 0.045, 1.55, 8), this.ironwork, new THREE.Vector3(railX, 1.03, frontZ + 1.3)).rotation.x = Math.PI / 2;
      });
      this.addMesh(new THREE.BoxGeometry(width + 0.7, 0.16, depth + 0.7), this.material(0x8d8d84, 0.95), new THREE.Vector3(x, 0.08, z));
      this.collisions.push(new THREE.Box3(new THREE.Vector3(x - width / 2 - 0.35, 0, z - depth / 2 - 0.35), new THREE.Vector3(x + width / 2 + 0.35, height + 0.8, z + depth / 2 + 0.35)));
      this.addTree(x - 5.3, z + 1.5, 1.1);
      this.addTree(x + 5.2, z - 1.2, 0.9);
    });
  }

  private buildShops() {
    const catalog = [
      ['Corner Market', 'GROCER', 0x9f563f],
      ['Little Bean Café', 'COFFEE', 0x587a67],
      ['BenTown Pharmacy', 'PHARMACY', 0x6b8f9b],
      ['Sunrise Bakery', 'BAKERY', 0xb87343],
      ['Maple Bookshop', 'BOOKS', 0x76668d],
      ['Bright Toys', 'TOYS', 0xb35757],
      ['Green Basket', 'FRESH FOOD', 0x62834f],
      ['Petal & Stem', 'FLOWERS', 0x9a5f70],
      ['City Threads', 'CLOTHING', 0x506f91],
      ['Family Diner', 'DINER', 0xa7743c],
    ] as const;
    const locations: { x: number; z: number; face: 'north' | 'south' | 'east' }[] = [
      { x: 31, z: -82, face: 'north' }, { x: 36, z: -82, face: 'north' }, { x: 41, z: -82, face: 'north' },
      { x: 31, z: 82, face: 'south' }, { x: 36, z: 82, face: 'south' }, { x: 41, z: 82, face: 'south' },
      { x: -40.5, z: -62, face: 'east' }, { x: -40.5, z: -56, face: 'east' },
      { x: -40.5, z: 56, face: 'east' }, { x: -40.5, z: 62, face: 'east' },
    ];
    locations.forEach((location, index) => {
      const [name, category, awningColor] = catalog[index];
      this.addShop(name, category, awningColor, location.x, location.z, location.face, `shop-${index + 1}`);
    });
  }

  private addShop(name: string, category: string, awningColor: number, x: number, z: number, face: 'north' | 'south' | 'east', id: string) {
    const width = 4.7;
    const depth = 5.1;
    const height = 4.2;
    const shell = new THREE.MeshStandardMaterial({ map: this.stucco, color: 0xd8d0c2, roughness: 0.9 });
    const rearZ = z + (face === 'north' ? -1 : 1) * (depth / 2 - 0.12);
    const rearX = x - width / 2 + 0.12;
    if (face === 'east') {
      this.addMesh(new THREE.BoxGeometry(0.24, height, depth), shell, new THREE.Vector3(rearX, height / 2, z));
      [-1, 1].forEach((side) => this.addMesh(new THREE.BoxGeometry(width, height, 0.24), shell, new THREE.Vector3(x, height / 2, z + side * (depth / 2 - 0.12))));
    } else {
      this.addMesh(new THREE.BoxGeometry(width, height, 0.24), shell, new THREE.Vector3(x, height / 2, rearZ));
      [-1, 1].forEach((side) => this.addMesh(new THREE.BoxGeometry(0.24, height, depth), shell, new THREE.Vector3(x + side * (width / 2 - 0.12), height / 2, z)));
    }
    this.addMesh(new THREE.BoxGeometry(width + 0.36, 0.28, depth + 0.34), this.material(0x3f4140, 0.86), new THREE.Vector3(x, 0.14, z));
    this.addMesh(new THREE.BoxGeometry(width + 0.28, 0.22, depth + 0.28), this.material(0x403c38, 0.76), new THREE.Vector3(x, height + 0.08, z));

    const front = new THREE.Vector3(x, 0, z);
    if (face === 'north') front.z += depth / 2 + 0.08;
    else if (face === 'south') front.z -= depth / 2 + 0.08;
    else front.x += width / 2 + 0.08;
    const facingSide = face === 'north' ? 1 : -1;
    const horizontalFront = face === 'east';
    const glassMaterial = new THREE.MeshPhysicalMaterial({ color: 0x9db7bd, roughness: 0.18, metalness: 0.26, transparent: true, opacity: 0.68, clearcoat: 0.8 });
    const addFrontMesh = (geometry: THREE.BufferGeometry, material: THREE.Material, offset: number, y: number, push: number) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(front.x + (horizontalFront ? push : offset), y, front.z + (horizontalFront ? offset : push));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      return mesh;
    };
    const windowWidth = horizontalFront ? depth - 1.5 : width - 1.55;
    const windowGeo = new THREE.BoxGeometry(horizontalFront ? 0.08 : windowWidth / 2, 2.05, horizontalFront ? windowWidth / 2 : 0.08);
    [-1, 1].forEach((side) => {
      const glass = addFrontMesh(windowGeo, glassMaterial, side * (windowWidth / 4 + 0.38), 1.82, 0.035 * (horizontalFront ? 1 : facingSide));
      if (horizontalFront) glass.rotation.y = Math.PI / 2;
    });
    const door = addFrontMesh(new THREE.BoxGeometry(horizontalFront ? 0.1 : 0.84, 2.3, horizontalFront ? 0.84 : 0.1), this.entryDoor, 0, 1.35, 0.06 * (horizontalFront ? 1 : facingSide));
    if (horizontalFront) door.rotation.y = Math.PI / 2;
    // Window mullions, lintel, sign board, and striped fabric canopy give each
    // shop a readable street-level silhouette from the driving camera.
    const sign = new THREE.MeshStandardMaterial({ color: awningColor, roughness: 0.54, metalness: 0.08 });
    const signMesh = addFrontMesh(new THREE.BoxGeometry(horizontalFront ? 0.22 : width, 0.54, horizontalFront ? depth : 0.22), sign, 0, 3.62, 0.12 * (horizontalFront ? 1 : facingSide));
    if (horizontalFront) signMesh.rotation.y = Math.PI / 2;
    const canopy = addFrontMesh(new THREE.BoxGeometry(horizontalFront ? 0.92 : width + 0.26, 0.16, horizontalFront ? depth - 0.8 : 0.92), sign, 0, 2.95, 0.43 * (horizontalFront ? 1 : facingSide));
    if (horizontalFront) canopy.rotation.y = Math.PI / 2;
    for (let stripe = -2; stripe <= 2; stripe++) {
      const stripeMesh = addFrontMesh(new THREE.BoxGeometry(horizontalFront ? 0.95 : 0.08, 0.035, horizontalFront ? 0.08 : 0.95), this.limestone, stripe * 0.88, 3.02, 0.53 * (horizontalFront ? 1 : facingSide));
      if (horizontalFront) stripeMesh.rotation.y = Math.PI / 2;
    }
    // Small warm-lit shelving/products behind the glazing make the stores read
    // as occupied interiors rather than painted, blank building fronts.
    const shelfMaterial = this.material(0x544c40, 0.7);
    const productColors = [0xc37847, 0x748b62, 0xb9a269, 0x7895a2];
    [-1, 1].forEach((side) => {
      const shelfX = x + side * 1.55;
      this.addMesh(new THREE.BoxGeometry(0.11, 1.4, 0.58), shelfMaterial, new THREE.Vector3(shelfX, 1.25, z));
      for (let row = 0; row < 3; row++) {
        this.addMesh(new THREE.BoxGeometry(0.13, 0.2, 0.16), this.material(productColors[(row + side + 4) % productColors.length], 0.7), new THREE.Vector3(shelfX + side * 0.08, 0.82 + row * 0.36, z + (row % 2 ? 0.16 : -0.16)));
      }
    });

    const box = new THREE.Box3(new THREE.Vector3(x - width / 2 - 0.18, 0, z - depth / 2 - 0.18), new THREE.Vector3(x + width / 2 + 0.18, height + 0.4, z + depth / 2 + 0.18));
    this.collisions.push(box);
    const target = front.clone();
    target.y = 0;
    target.add(new THREE.Vector3(horizontalFront ? 1.1 : 0, 0, horizontalFront ? 0 : facingSide * 1.25));
    this.shops.push({ id, name, category, position: target });
  }

  private addBrownstoneWindow(x: number, y: number, z: number, orientation: 'front' | 'left' = 'front') {
    const width = 1.22;
    const height = 1.62;
    const group = new THREE.Group();
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, px: number, py: number, pz: number) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(px, py, pz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    };

    add(new THREE.BoxGeometry(width, height, 0.065), this.windowGlass, 0, 0, 0.025);
    [-width / 2, width / 2].forEach((frameX) => add(new THREE.BoxGeometry(0.09, height + 0.12, 0.12), this.windowFrame, frameX, 0, 0.075));
    [-height / 2, height / 2].forEach((frameY) => add(new THREE.BoxGeometry(width + 0.1, 0.09, 0.12), this.windowFrame, 0, frameY, 0.075));
    add(new THREE.BoxGeometry(0.055, height, 0.075), this.windowFrame, 0, 0, 0.09);
    add(new THREE.BoxGeometry(width, 0.055, 0.075), this.windowFrame, 0, 0.08, 0.09);
    add(new THREE.BoxGeometry(width + 0.28, 0.15, 0.34), this.limestone, 0, -height / 2 - 0.12, 0.12);
    add(new THREE.BoxGeometry(width + 0.2, 0.13, 0.23), this.limestone, 0, height / 2 + 0.11, 0.08);
    group.position.set(x, y, z);
    group.rotation.y = orientation === 'front' ? 0 : -Math.PI / 2;
    this.scene.add(group);
  }

  private buildMall() {
    const x = 36;
    const z = -38;
    this.addMesh(new THREE.BoxGeometry(15, 8.2, 10), this.material(0x42494b, 0.4, 0.36), new THREE.Vector3(x, 4.1, z));
    const glass = new THREE.MeshStandardMaterial({ map: this.facade, color: 0x9aaeb4, metalness: 0.42, roughness: 0.35 });
    const front = this.addMesh(new THREE.PlaneGeometry(13.5, 6), glass, new THREE.Vector3(x, 4, z + 5.04));
    this.addMesh(new THREE.BoxGeometry(15.8, 0.65, 10.8), this.material(0x6f7575, 0.52, 0.24), new THREE.Vector3(x, 8.35, z));
    this.addMesh(new THREE.BoxGeometry(14.5, 0.18, 1.25), this.material(0xb2a37f, 0.48, 0.1), new THREE.Vector3(x, 2.2, z + 5.22));
    this.addMesh(new THREE.BoxGeometry(3.8, 0.7, 0.12), new THREE.MeshStandardMaterial({ color: 0xe8e2cf, emissive: 0x8b7351, emissiveIntensity: 0.6 }), new THREE.Vector3(x, 6.8, z + 5.18));
    front.castShadow = false;
    this.collisions.push(new THREE.Box3(new THREE.Vector3(x - 7.8, 0, z - 5.3), new THREE.Vector3(x + 7.8, 9, z + 5.1)));
    this.shops.push({ id: 'bentown-mall', name: 'BenTown Mall', category: 'shopping mall', position: new THREE.Vector3(x, 0, z + 6.25) });
  }

  private buildFuelStop() {
    const x = 36;
    const z = 20;
    // Convenience store
    this.addMesh(new THREE.BoxGeometry(10, 4.2, 7), new THREE.MeshStandardMaterial({ map: this.stucco, color: 0xc4c1b7, roughness: 0.83 }), new THREE.Vector3(x, 2.1, z + 9));
    const storefront = this.addMesh(new THREE.PlaneGeometry(10, 4.2), new THREE.MeshStandardMaterial({ map: this.bodega, roughness: 0.52, metalness: 0.12 }), new THREE.Vector3(x, 2.1, z + 5.52));
    storefront.rotation.y = Math.PI;

    // Canopy slab, red fascia and structural columns.
    this.addMesh(new THREE.BoxGeometry(15, 0.4, 11), this.material(0xe6e2d9, 0.4, 0.16), new THREE.Vector3(x, 5.1, z));
    this.addMesh(new THREE.BoxGeometry(15.1, 0.68, 0.42), this.material(0x9d3f35, 0.48, 0.14), new THREE.Vector3(x, 4.65, z + 5.35));
    this.addMesh(new THREE.BoxGeometry(15.1, 0.68, 0.42), this.material(0x9d3f35, 0.48, 0.14), new THREE.Vector3(x, 4.65, z - 5.35));
    [-6.2, 6.2].forEach((columnX) => {
      [-4, 4].forEach((columnZ) => {
        this.addMesh(new THREE.BoxGeometry(0.36, 4.4, 0.36), this.material(0xd0cfc7, 0.43, 0.22), new THREE.Vector3(x + columnX, 2.2, z + columnZ));
        this.collisions.push(new THREE.Box3(
          new THREE.Vector3(x + columnX - 0.24, 0, z + columnZ - 0.24),
          new THREE.Vector3(x + columnX + 0.24, 4.6, z + columnZ + 0.24)
        ));
      });
    });

    // Four detailed fuel pumps.
    [-4.2, 0, 4.2].forEach((pumpX) => {
      const pump = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.45, 0.68), this.material(0xe7e6df, 0.4, 0.16));
      base.position.y = 1.0;
      pump.add(base);
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.35, 0.72), this.material(0x8e4035, 0.38, 0.15));
      top.position.y = 1.82;
      pump.add(top);
      const display = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.28, 0.04), new THREE.MeshBasicMaterial({ color: 0x9cc0b0 }));
      display.position.set(0, 1.22, 0.36);
      pump.add(display);
      pump.position.set(x + pumpX, 0, z);
      pump.traverse((obj) => { if (obj instanceof THREE.Mesh) { obj.castShadow = true; obj.receiveShadow = true; } });
      this.scene.add(pump);
      this.collisions.push(new THREE.Box3(
        new THREE.Vector3(x + pumpX - 0.56, 0, z - 0.46),
        new THREE.Vector3(x + pumpX + 0.56, 2.2, z + 0.46)
      ));
    });
    this.addMesh(new THREE.PlaneGeometry(18, 19), this.material(0x777a76, 0.94), new THREE.Vector3(x, 0.008, z + 1)).rotation.x = -Math.PI / 2;
    this.collisions.push(new THREE.Box3(new THREE.Vector3(x - 5.3, 0, z + 5.2), new THREE.Vector3(x + 5.3, 5, z + 12.7)));
  }

  private buildMountainPass() {
    const peaks: [number, number, number, number][] = [
      [-42, 24, 22, 31], [-34, 31, 18, 25], [-43, 4, 15, 20], [-29, 37, 12, 18],
    ];
    peaks.forEach(([x, z, radius, height], index) => {
      const geometry = new THREE.ConeGeometry(radius, height, 48, 28);
      const position = geometry.getAttribute('position');
      const colors: number[] = [];
      const green = new THREE.Color(index % 2 ? 0x48564b : 0x556052);
      const rock = new THREE.Color(0x696b65);
      const snow = new THREE.Color(0xd9ddda);
      for (let i = 0; i < position.count; i++) {
        const y = position.getY(i);
        const jitter = Math.sin(i * 12.73 + index) * 0.1;
        position.setX(i, position.getX(i) * (1 + jitter));
        position.setZ(i, position.getZ(i) * (1 + jitter));
        const normalizedHeight = y / height + 0.5;
        const color = normalizedHeight > 0.79 ? snow : normalizedHeight > 0.45 ? rock : green;
        colors.push(color.r, color.g, color.b);
      }
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      position.needsUpdate = true;
      geometry.computeVertexNormals();
      this.addMesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94 }), new THREE.Vector3(x, height / 2 - 0.4, z));
    });

    // A winding two-lane pass through the foothills.
    const path = [new THREE.Vector3(-19, 0.06, 40), new THREE.Vector3(-25, 0.06, 33), new THREE.Vector3(-18, 0.06, 25), new THREE.Vector3(-26, 0.06, 17), new THREE.Vector3(-20, 0.06, 9), new THREE.Vector3(-24, 0.06, 1)];
    const curve = new THREE.CatmullRomCurve3(path);
    const roadPoints = curve.getPoints(72);
    const vertices: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    roadPoints.forEach((point, i) => {
      const tangent = curve.getTangentAt(i / (roadPoints.length - 1));
      const side = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize().multiplyScalar(5.5);
      vertices.push(point.x - side.x, point.y, point.z - side.z, point.x + side.x, point.y, point.z + side.z);
      uvs.push(0, i / 8, 1, i / 8);
      if (i < roadPoints.length - 1) {
        const n = i * 2;
    indices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
      }
    });
    const roadGeometry = new THREE.BufferGeometry();
    roadGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    roadGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    roadGeometry.setIndex(indices);
    roadGeometry.computeVertexNormals();
    this.addMesh(roadGeometry, this.roadMaterial(), new THREE.Vector3(0, 0, 0));

    path.forEach((point, i) => {
      if (i === 0) return;
      const previous = path[i - 1];
      const direction = Math.atan2(point.x - previous.x, point.z - previous.z);
      const length = previous.distanceTo(point) * 0.68;
      const stripe = this.addMesh(new THREE.BoxGeometry(0.13, 0.02, length), this.material(0xe2d6ad, 0.8), new THREE.Vector3((point.x + previous.x) / 2, 0.095, (point.z + previous.z) / 2));
      stripe.rotation.y = direction;
    });
    for (let i = 0; i < 24; i++) {
      const t = (i + 0.5) / 24;
      const point = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t);
      const side = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
      const rail = this.addMesh(new THREE.BoxGeometry(0.16, 0.22, 2.7), this.material(0x8a918f, 0.42, 0.6), point.clone().addScaledVector(side, 6.2).add(new THREE.Vector3(0, 0.55, 0)));
      rail.rotation.y = Math.atan2(tangent.x, tangent.z);
    }
    [-35, -30, -39, -24, -33].forEach((x, index) => this.addTree(x, 1 + index * 7, 1.5 + (index % 2) * 0.4));
  }

  private addPickupBoxTruckCargo(group: THREE.Group) {
    // The project includes a detailed pickup but no dedicated truck model.
    // Add a scaled, panelled cargo body to that GLB so the avenue has a
    // recognizable box truck while retaining the authored cab and wheels.
    group.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(group);
    const size = bounds.getSize(new THREE.Vector3());
    const cargoWidth = Math.max(1.25, size.x * 0.76);
    const cargoLength = Math.max(1.5, size.z * 0.43);
    const cargoHeight = Math.max(0.82, size.y * 0.43);
    const cargoZ = bounds.min.z + cargoLength / 2 + size.z * 0.055;
    const cargoY = bounds.min.y + size.y * 0.64;
    const cargoMaterial = new THREE.MeshPhysicalMaterial({ color: 0xd8d8d2, roughness: 0.54, metalness: 0.12, clearcoat: 0.25 });
    const cargo = new THREE.Mesh(new THREE.BoxGeometry(cargoWidth, cargoHeight, cargoLength), cargoMaterial);
    cargo.name = 'Box truck cargo body';
    cargo.position.set(bounds.getCenter(new THREE.Vector3()).x, cargoY, cargoZ);
    cargo.castShadow = true;
    cargo.receiveShadow = true;
    group.add(cargo);

    const stripeMaterial = new THREE.MeshStandardMaterial({ color: 0xc74735, roughness: 0.48, metalness: 0.12 });
    [-1, 1].forEach((side) => {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.11, cargoLength * 0.82), stripeMaterial);
      stripe.position.set(cargo.position.x + side * (cargoWidth / 2 + 0.014), cargoY - cargoHeight * 0.24, cargoZ);
      stripe.castShadow = true;
      group.add(stripe);
    });
    const rearDoor = new THREE.Mesh(new THREE.BoxGeometry(cargoWidth * 0.92, cargoHeight * 0.92, 0.035), new THREE.MeshStandardMaterial({ color: 0xc7c9c5, roughness: 0.63 }));
    rearDoor.position.set(cargo.position.x, cargoY, bounds.min.z + size.z * 0.04);
    group.add(rearDoor);
  }

  private buildNightDistrict() {
    const neonColors = [0x56b7c9, 0xd280aa, 0xe5bd75, 0x7d91df];
    for (let i = 0; i < 5; i++) {
      const x = -12 + i * 6;
      const z = 34;
      this.addBuilding(x, z, 5, 5.5, 12 + (i % 3) * 3, 'glass', true);
      const sign = new THREE.MeshStandardMaterial({ color: neonColors[i % neonColors.length], emissive: neonColors[i % neonColors.length], emissiveIntensity: 1.4, roughness: 0.35 });
      this.addMesh(new THREE.BoxGeometry(1.8, 0.26, 0.1), sign, new THREE.Vector3(x, 4.1, z - 2.82));
      this.addMesh(new THREE.BoxGeometry(0.1, 3.6, 0.1), new THREE.MeshStandardMaterial({ color: 0xa5c9db, emissive: 0x43738e, emissiveIntensity: 0.65 }), new THREE.Vector3(x - 2.58, 2.3, z));
    }
    this.addMesh(new THREE.BoxGeometry(18, 0.12, 2), this.material(0x555c5e, 0.85), new THREE.Vector3(0, 0.06, 30));
  }

  private addTree(x: number, z: number, scale: number) {
    const trunkMaterial = this.material(0x4e4338, 0.95);
    const leafMaterial = this.material(0x435648, 0.94);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * scale, 0.22 * scale, 2.1 * scale, 8), trunkMaterial);
    trunk.position.set(x, 1.05 * scale, z);
    trunk.castShadow = true;
    this.scene.add(trunk);
    [[0, 2.4, 0, 1.2], [-0.45, 2.05, 0.22, 0.85], [0.42, 2.1, -0.18, 0.9]].forEach(([ox, oy, oz, r]) => {
      const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(r * scale, 2), leafMaterial);
      leaves.position.set(x + ox * scale, oy * scale, z + oz * scale);
      leaves.scale.set(1, 1.15, 0.92);
      leaves.castShadow = true;
      this.scene.add(leaves);
    });
  }

  private addPlanter(x: number, z: number) {
    this.addMesh(new THREE.BoxGeometry(2.4, 0.65, 1.5), this.material(0x777b75, 0.92), new THREE.Vector3(x, 0.32, z));
    this.addTree(x, z, 0.72);
  }

  private buildStreetFurniture() {
    for (let z = -90; z <= 90; z += 24) {
      [-7.8, 7.8].forEach((x) => {
        this.addMesh(new THREE.CylinderGeometry(0.07, 0.09, 5.4, 8), this.material(0x454c4d, 0.48, 0.58), new THREE.Vector3(x, 2.7, z));
        this.addMesh(new THREE.BoxGeometry(0.55, 0.1, 0.3), new THREE.MeshStandardMaterial({ color: 0xeed9aa, emissive: 0xc59757, emissiveIntensity: 0.55 }), new THREE.Vector3(x + 0.2, 5.3, z));
      });
    }
    [-18, 18].forEach((x) => {
      for (let z = -78; z <= 78; z += 24) this.addTree(x, z, 1.05);
    });
    [-60, 60].forEach((x) => {
      for (let z = -76; z <= 76; z += 38) this.addTree(x, z, 1.1);
    });
  }

  private createMotorcycle() {
    const bike = new THREE.Group();
    const frame = this.material(0x343b3d, 0.32, 0.68);
    const paint = new THREE.MeshPhysicalMaterial({ color: 0x263b49, roughness: 0.24, metalness: 0.55, clearcoat: 0.9 });
    const rubber = this.material(0x141617, 0.94);
    const metal = this.material(0x969e9f, 0.24, 0.78);
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, position: [number, number, number]) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...position);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      bike.add(mesh);
      return mesh;
    };

    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.105, 12, 28), rubber);
    wheel.rotation.y = Math.PI / 2;
    wheel.position.set(0, 0.46, -0.94);
    bike.add(wheel);
    const frontWheel = wheel.clone();
    frontWheel.position.z = 1.02;
    bike.add(frontWheel);
    add(new THREE.CylinderGeometry(0.07, 0.07, 0.3, 12), metal, [0, 0.46, -0.94]);
    add(new THREE.CylinderGeometry(0.07, 0.07, 0.3, 12), metal, [0, 0.46, 1.02]);
    add(new THREE.CylinderGeometry(0.065, 0.065, 1.05, 10), frame, [0, 0.88, 0.04]);
    add(new THREE.SphereGeometry(0.36, 16, 12), paint, [0, 1.02, 0.1]).scale.set(0.5, 0.68, 0.88);
    add(new THREE.BoxGeometry(0.46, 0.14, 0.7), rubber, [0, 1.28, -0.55]);
    add(new THREE.BoxGeometry(0.38, 0.16, 0.52), paint, [0, 1.21, 0.77]);
    add(new THREE.CylinderGeometry(0.045, 0.045, 0.88, 8), metal, [0, 1.45, 1.0]).rotation.z = Math.PI / 2;
    add(new THREE.BoxGeometry(0.16, 0.11, 0.12), new THREE.MeshStandardMaterial({ color: 0xfff0cd, emissive: 0xffe8b0, emissiveIntensity: 1.2 }), [0, 1.35, 1.19]);
    add(new THREE.BoxGeometry(0.16, 0.1, 0.1), new THREE.MeshStandardMaterial({ color: 0x8d2420, emissive: 0x70120e, emissiveIntensity: 0.8 }), [0, 1.18, -0.98]);
    add(new THREE.CylinderGeometry(0.11, 0.11, 0.42, 12), frame, [0, 0.75, -0.36]);
    [-1, 1].forEach((side) => {
      const mirrorStem = add(new THREE.CylinderGeometry(0.018, 0.018, 0.38, 6), metal, [side * 0.34, 1.63, 0.93]);
      mirrorStem.rotation.z = side * 0.42;
      add(new THREE.SphereGeometry(0.085, 10, 8), metal, [side * 0.46, 1.79, 0.93]).scale.set(1.2, 0.75, 0.35);
    });
    return bike;
  }
}
