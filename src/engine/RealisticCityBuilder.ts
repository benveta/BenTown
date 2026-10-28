import * as THREE from 'three';
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
}

interface TrafficCar {
  group: THREE.Group;
  vehicle: DriveableVehicle;
  axis: 'x' | 'z';
  direction: number;
  speed: number;
  wheels: THREE.Group[];
}

export interface CityShop {
  id: string;
  name: string;
  category: string;
  position: THREE.Vector3;
}

const PHOTO_CITY_TEXTURE_SIZE = 512;
const SHADOW_MAP_SIZE = 2048;
const FACADE_TILE_METERS = 7;
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
    return { collisionBoxes: this.collisions, vehicles: this.vehicles };
  }

  public async buildVehicles() {
    await VehicleModelLoader.preloadAll();
    const addDriveable = (id: string, name: string, key: VehicleModelKey, color: number, position: [number, number, number]) => {
      const model = VehicleModelLoader.create(key, color);
      model.group.position.set(...position);
      this.scene.add(model.group);
      this.vehicles.push({ id, name, group: model.group, wheels: model.wheels, type: 'roadster', seatOffset: new THREE.Vector3(0, 0.95, 0), active: false, speed: 0, steerAngle: 0 });
    };
    addDriveable('city-sedan', 'City Sedan', 'sedan', 0x273b49, [4, 0, 2.5]);
    addDriveable('fuel-stop-suv', 'Utility SUV', 'suv', 0x8d473a, [35, 0, 14.5]);
    const motorcycle = this.createMotorcycle();
    motorcycle.position.set(16, 0, 31);
    this.scene.add(motorcycle);
    this.vehicles.push({ id: 'night-district-motorcycle', name: 'Street Motorcycle', group: motorcycle, type: 'roadster', seatOffset: new THREE.Vector3(0, 0.9, 0), active: false, speed: 0, steerAngle: 0 });

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
      vehicle.group.position.set(x, 0, z);
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
      };
      this.vehicles.push(trafficVehicle);
      this.traffic.push({ group: vehicle.group, vehicle: trafficVehicle, axis, direction, speed, wheels: vehicle.wheels });
    });
  }

  public getDriveableVehicles() {
    return this.vehicles;
  }

  public async buildPedestrians() {
    await CityPedestrianLoader.preloadAll();
    const models: PedestrianModelKey[] = ['femaleA', 'femaleD', 'maleA', 'maleD'];
    const firstNames = ['Mira', 'Arjun', 'Nila', 'Kabir', 'Anaya', 'Dev', 'Tara', 'Ishaan', 'Asha', 'Ravi', 'Riya', 'Aarav'];
    const roads = [-84, -60, -36, -12, 12, 36, 60, 84];
    const routes: { axis: 'x' | 'z'; fixed: number }[] = [];
    roads.forEach((road) => {
      [-1, 1].forEach((side) => {
        routes.push({ axis: 'z', fixed: road + side * 6.2 });
        routes.push({ axis: 'x', fixed: road + side * 6.2 });
      });
    });

    // Two walkers on each of the 32 sidewalks around the avenue grid. Their
    // paths stay beside the curb and spread across the full playable town.
    // Add a second staggered wave around the central shopping streets.
    const pedestrianCount = 72;
    for (let index = 0; index < pedestrianCount; index++) {
      const routeIndex = index % routes.length;
      const route = routes[routeIndex];
      const wave = Math.floor(index / routes.length);
      const name = `${firstNames[index % firstNames.length]} ${String(index + 1).padStart(2, '0')}`;
      const pedestrian = CityPedestrianLoader.create(models[index % models.length], `ped-${index + 1}`, name);
      const progress = -84 + ((routeIndex * 47 + wave * 31) % 168);
      if (route.axis === 'z') pedestrian.group.position.set(route.fixed, 0, progress);
      else pedestrian.group.position.set(progress, 0, route.fixed);
      pedestrian.axis = route.axis;
      pedestrian.minCoordinate = -90;
      pedestrian.maxCoordinate = 90;
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
    this.traffic.forEach(({ group, vehicle, axis, direction, speed, wheels }) => {
      if (vehicle.active || group.userData.playerDriven) return;
      group.position[axis] += direction * speed * delta;
      if (group.position[axis] > 96) group.position[axis] = -96;
      if (group.position[axis] < -96) group.position[axis] = 96;
      wheels.forEach((wheel) => { wheel.rotation.x -= direction * speed * delta / 0.35; });
    });
    this.pedestrians.forEach((pedestrian) => {
      // Keep animations smooth near the player while avoiding dozens of
      // off-screen skeleton updates on mobile devices.
      const nearPlayer = !playerPos || pedestrian.group.position.distanceToSquared(playerPos) < 78 * 78;
      if (nearPlayer) pedestrian.mixer.update(delta);
      if (pedestrian.greetingTimer > 0) {
        pedestrian.greetingTimer = Math.max(0, pedestrian.greetingTimer - delta);
        if (pedestrian.greetingTimer === 0) {
          pedestrian.greetAction?.stop();
          pedestrian.walkAction.reset().play();
        }
        return;
      }
      pedestrian.group.position[pedestrian.axis] += pedestrian.direction * pedestrian.speed * delta;
      const coordinate = pedestrian.group.position[pedestrian.axis];
      if (coordinate > pedestrian.maxCoordinate || coordinate < pedestrian.minCoordinate) {
        pedestrian.direction = pedestrian.direction === 1 ? -1 : 1;
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

  private material(color: number, roughness = 0.85, metalness = 0) {
    return new THREE.MeshStandardMaterial({ color, roughness, metalness });
  }

  private addMesh<T extends THREE.BufferGeometry>(geometry: T, material: THREE.Material | THREE.Material[], position: THREE.Vector3) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    return mesh;
  }

  private buildAtmosphere() {
    // Draw the authored panorama as real scene geometry. This is more reliable
    // than Scene.background's equirectangular shader path on Expo GL and makes
    // the generated images visibly present while the player explores.
    this.scene.background = new THREE.Color(0x899bb2);
    this.skyDome = new THREE.Mesh(
      new THREE.SphereGeometry(150, 48, 32),
      new THREE.MeshBasicMaterial({ map: this.environments.city, side: THREE.BackSide, depthWrite: false, fog: false })
    );
    this.skyDome.name = 'Generated city panorama sky dome';
    // SphereGeometry places its longitude seam on +Z; rotate it so the
    // panorama's center boulevard faces the player's default forward view.
    this.skyDome.rotation.y = Math.PI;
    this.skyDome.renderOrder = -1000;
    this.scene.add(this.skyDome);
    this.scene.environment = this.environments.city;
    this.scene.environmentIntensity = 0.55;
    this.scene.fog = new THREE.Fog(0x7e8292, 86, 188);

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
    this.skyDome.material.map = environment;
    this.skyDome.material.needsUpdate = true;
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
    const outerOffsets = [-56, -28, 0, 28, 56];
    outerOffsets.forEach((offset, index) => {
      this.addBuilding(-84, offset, 8, 8, 20 + (index % 3) * 5, index % 2 ? 'concrete' : 'glass', index % 2 === 0);
      this.addBuilding(84, offset, 8, 8, 24 + ((index + 1) % 3) * 5, index % 2 ? 'glass' : 'concrete', index % 2 === 1);
      if (offset !== 28) {
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
      [-33, -32, 0], [-33, -16, 1], [-33, -3, 2],
      [-15, -32, 1], [-15, -16, 2], [-15, -3, 0],
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
