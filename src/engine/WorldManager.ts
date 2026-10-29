import * as THREE from 'three';
import { 
  ALPHABET_DATA, 
  COLOR_PATH_DATA, 
  NUMBER_BALLOONS_DATA, 
  InteractiveTarget, 
  AlphabetItem 
} from '../types/game';
import { audio } from '../services/AudioService';
import { haptics } from '../services/HapticsService';
import { CityModelLoader } from './CityModelLoader';
import { ProceduralCityGenerator } from './ProceduralCityGenerator';
import { RealisticCityBuilder } from './RealisticCityBuilder';
import { buildLearningPark } from './LearningPark';

export class WorldManager {
  public scene: THREE.Scene;
  public cityGen!: ProceduralCityGenerator;

  // Interactive objects registry
  public alphabetBlocks: { mesh: THREE.Mesh; data: AlphabetItem; originalY: number }[] = [];
  public numberBalloons: { group: THREE.Group; mesh: THREE.Mesh; num: number; popped: boolean; color: string }[] = [];
  public steppingStones: { mesh: THREE.Mesh; data: typeof COLOR_PATH_DATA[0]; light: THREE.PointLight; activeTimer: number }[] = [];
  
  // Animals
  public animals: {
    id: string;
    name: string;
    type: string;
    group: THREE.Group;
    animTimer: number;
    actionState: string;
  }[] = [];

  // Vehicles
  public vehicles: {
    id: string;
    name: string;
    group: THREE.Group;
    type: 'firetruck' | 'icecream' | 'roadster';
    seatOffset: THREE.Vector3;
    active: boolean;
    speed: number;
    steerAngle: number;
    wheels?: THREE.Group[];
  }[] = [];

  // Special structures
  public trampolineGroup!: THREE.Group;
  public slideGroup!: THREE.Group;
  public mirrorGroup!: THREE.Group;
  public bearGroup!: THREE.Group;
  private bearApplesEaten: number = 0;

  // Subtle floor rings identify places the player can interact with.
  private interactiveMarkers: THREE.Mesh[] = [];
  private fixedCollisionBoxes: THREE.Box3[] = [];
  // Tree trunks bucketed in 8 m cells so collision checks stay cheap.
  private treeCells = new Map<string, { x: number; z: number; s: number }[]>();
  private realisticBuilder!: RealisticCityBuilder;

  // Visual effects
  private driftingClouds: THREE.Group[] = [];
  public particles: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number; maxLife: number }[] = [];

  constructor(scene: THREE.Scene, anisotropy = 1) {
    this.scene = scene;
    this.realisticBuilder = new RealisticCityBuilder(scene, anisotropy);
  }

  /** Loads textures from the bundle, then builds the city. */
  public async init() {
    await this.stage('Loading textures…');
    await this.realisticBuilder.loadTextures();
    await this.stage('Building streets and buildings…');
    this.buildWorld();
  }

  /** Reports startup progress and yields to the UI so the loading card can repaint between heavy steps. */
  public onStage?: (stage: string) => void;
  private stage(text: string) {
    this.onStage?.(text);
    return new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  private buildWorld() {
    const world = this.realisticBuilder.build();
    this.fixedCollisionBoxes = world.collisionBoxes;
    this.vehicles = world.vehicles;
    const trees = buildLearningPark(this);
    trees.forEach((tree) => {
      const key = `${Math.floor(tree.x / 8)},${Math.floor(tree.z / 8)}`;
      const cell = this.treeCells.get(key) ?? [];
      cell.push(tree);
      this.treeCells.set(key, cell);
    });

    // Legacy interaction groups stay off-map so only the new city and vehicles
    // participate in gameplay and proximity targeting.
    this.trampolineGroup = this.createOffMapGroup();
    this.slideGroup = this.createOffMapGroup();
    this.mirrorGroup = this.createOffMapGroup();
    this.bearGroup = this.createOffMapGroup();
  }

  public isPersonAt(x: number, z: number, radius: number) {
    return this.realisticBuilder.isBlockedByPedestrian(x, z, radius);
  }

  public roadInfoAt(x: number, z: number, preferAxis?: 'x' | 'z') {
    return this.realisticBuilder.roadInfoAt(x, z, preferAxis);
  }

  public nearestRoadPoint(x: number, z: number) {
    return this.realisticBuilder.nearestRoadPoint(x, z);
  }

  /** Distance from (x, z) to the nearest edge of the vehicle's footprint (0 when inside it). */
  public distanceToVehicleBody(vehicle: { group: THREE.Group; halfExtents?: { x: number; z: number } }, x: number, z: number) {
    const half = vehicle.halfExtents ?? { x: 1, z: 2 };
    const dx = x - vehicle.group.position.x;
    const dz = z - vehicle.group.position.z;
    const cos = Math.cos(vehicle.group.rotation.y);
    const sin = Math.sin(vehicle.group.rotation.y);
    const lx = Math.abs(dx * cos - dz * sin);
    const lz = Math.abs(dx * sin + dz * cos);
    return Math.hypot(Math.max(lx - half.x, 0), Math.max(lz - half.z, 0));
  }

  public releaseTrafficVehicle(vehicle: unknown) {
    this.realisticBuilder.releaseTrafficVehicle(vehicle as Parameters<RealisticCityBuilder['releaseTrafficVehicle']>[0]);
  }

  public async loadVehicleModels() {
    this.realisticBuilder.trunkBlocked = (x, z, r) => this.isTrunkBlocked(x, z, r);
    await this.stage('Loading cars, trucks and buses…');
    await this.realisticBuilder.buildVehicles();
    await this.stage('Loading people…');
    await this.realisticBuilder.buildPedestrians();
    this.vehicles = this.realisticBuilder.getDriveableVehicles();
  }

  private createOffMapGroup() {
    const group = new THREE.Group();
    group.position.y = -1000;
    this.scene.add(group);
    return group;
  }

  /** `ignore` is the vehicle currently being driven (it must not block itself). */
  /** Buildings and fixed props only (no vehicles) — used to keep scenery clear of structures. */
  public isStaticBlocked(x: number, z: number, radius: number): boolean {
    return this.fixedCollisionBoxes.some((box) =>
      x + radius > box.min.x && x - radius < box.max.x && z + radius > box.min.z && z - radius < box.max.z);
  }

  /** Buildings, tree trunks and other vehicles - but not people: a person only makes a vehicle wait, not back up. */
  public isSolidBlocked(x: number, z: number, radius: number, ignore?: THREE.Object3D | null): boolean {
    const overlaps = (box: THREE.Box3) =>
      x + radius > box.min.x && x - radius < box.max.x && z + radius > box.min.z && z - radius < box.max.z;
    return this.fixedCollisionBoxes.some(overlaps)
      || this.isTrunkBlocked(x, z, radius)
      || this.realisticBuilder.isBlockedByVehicle(x, z, radius, ignore);
  }

  private isTrunkBlocked(x: number, z: number, radius: number) {
    const cx = Math.floor(x / 8);
    const cz = Math.floor(z / 8);
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cz - 1; j <= cz + 1; j++) {
        const cell = this.treeCells.get(`${i},${j}`);
        if (!cell) continue;
        for (const tree of cell) {
          const reach = radius + 0.25 * tree.s;
          if ((tree.x - x) ** 2 + (tree.z - z) ** 2 < reach * reach) return true;
        }
      }
    }
    return false;
  }

  public isPositionBlocked(x: number, z: number, radius: number = 0.34, ignore?: THREE.Object3D | null): boolean {
    const overlaps = (box: THREE.Box3) =>
      x + radius > box.min.x && x - radius < box.max.x &&
      z + radius > box.min.z && z - radius < box.max.z;
    return (this.cityGen?.isPositionBlocked(x, z, radius) ?? false)
      || this.fixedCollisionBoxes.some(overlaps)
      || this.isTrunkBlocked(x, z, radius)
      || this.realisticBuilder.isBlockedByVehicle(x, z, radius, ignore);
  }

  public findNearestWalkablePosition(position: THREE.Vector3, searchRadius: number = 6): THREE.Vector3 {
    if (!this.isPositionBlocked(position.x, position.z)) return position.clone();

    const step = 0.5;
    for (let radius = step; radius <= searchRadius; radius += step) {
      const samples = Math.max(8, Math.ceil((Math.PI * 2 * radius) / step));
      for (let i = 0; i < samples; i++) {
        const angle = (i / samples) * Math.PI * 2;
        const x = position.x + Math.cos(angle) * radius;
        const z = position.z + Math.sin(angle) * radius;
        if (!this.isPositionBlocked(x, z)) return new THREE.Vector3(x, position.y, z);
      }
    }

    return new THREE.Vector3(0, position.y, 0);
  }

  // --- 1. Daylight & Atmosphere ---
  private setupLighting() {
    const ambientLight = new THREE.AmbientLight(0xf1f0e9, 0.62);
    this.scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xfff5e8, 1.6);
    sunLight.position.set(30, 50, 25);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 1024;
    sunLight.shadow.mapSize.height = 1024;
    this.scene.add(sunLight);

    const hemiLight = new THREE.HemisphereLight(0xb5cad6, 0x71815f, 0.38);
    this.scene.add(hemiLight);

    this.scene.background = new THREE.Color(0xa9c1cc);
  }

  // --- 2. Ground & Terrain ---
  private buildTerrain() {
    // City foundation terrain covering the full 72m+ procedural city
    const groundGeo = new THREE.CylinderGeometry(58, 62, 1.2, 48);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x718b61,
      roughness: 0.9,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.y = -0.6;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Surrounding gentle rolling hill perimeter
    const hillMat = new THREE.MeshStandardMaterial({ color: 0x637d56, roughness: 0.95 });
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2;
      const radius = 54 + Math.sin(i * 3) * 3;
      const hillGeo = new THREE.SphereGeometry(10 + (i % 3) * 2, 16, 12);
      hillGeo.scale(2.0, 0.7, 1.4);
      const hill = new THREE.Mesh(hillGeo, hillMat);
      hill.position.set(Math.cos(angle) * radius, -0.5, Math.sin(angle) * radius);
      this.scene.add(hill);
    }
  }

  // --- 3. Authentic Procedural City from Kenney City Kit ---
  private buildProceduralCity() {
    this.cityGen = new ProceduralCityGenerator(36, 6, 2.0);
    this.cityGen.generate(this.scene);
  }

  // --- 6. Zone 1: Oshu's House & Garden ---
  private buildZone1HouseAndGarden() {
    const houseGroup = new THREE.Group();
    houseGroup.position.set(0, 0, -18);

    // Oshu's House from Kenney Models
    const kenneyHouse = CityModelLoader.getModel('building_type_a');
    kenneyHouse.scale.set(1.6, 1.6, 1.6);
    kenneyHouse.position.set(0, 0, -2);
    houseGroup.add(kenneyHouse);

    // Front yard fences
    [-3.5, 3.5].forEach((fx) => {
      const kenneyFence = CityModelLoader.getModel('fence');
      kenneyFence.position.set(fx, 0, 2);
      kenneyFence.scale.set(1.2, 1.2, 1.2);
      houseGroup.add(kenneyFence);
    });

    this.scene.add(houseGroup);
    this.fixedCollisionBoxes.push(new THREE.Box3(
      new THREE.Vector3(-2.2, 0, -22.2),
      new THREE.Vector3(2.2, 10, -17.8)
    ));

    // Doghouse with Buster the Dog
    const doghouseGroup = new THREE.Group();
    doghouseGroup.position.set(5.5, 0, -16);

    const doghouseGeo = new THREE.BoxGeometry(1.8, 1.5, 1.8);
    const doghouseMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.7 });
    const dhBody = new THREE.Mesh(doghouseGeo, doghouseMat);
    dhBody.position.y = 0.75;
    doghouseGroup.add(dhBody);

    const dhRoofGeo = new THREE.ConeGeometry(1.6, 1.0, 4);
    const dhRoof = new THREE.Mesh(dhRoofGeo, new THREE.MeshStandardMaterial({ color: 0xb91c1c }));
    dhRoof.position.y = 1.8;
    dhRoof.rotation.y = Math.PI / 4;
    doghouseGroup.add(dhRoof);

    this.scene.add(doghouseGroup);

    // Buster the Dog
    const dog = this.createAnimalModel('dog', 0xc27803);
    dog.position.set(5.5, 0, -14.2);
    dog.rotation.y = Math.PI;
    this.scene.add(dog);
    this.animals.push({
      id: 'buster_dog',
      name: 'Buster the Dog',
      type: 'dog',
      group: dog,
      animTimer: 0,
      actionState: 'idle',
    });

    // Wardrobe Mirror
    this.mirrorGroup = new THREE.Group();
    this.mirrorGroup.position.set(-4.5, 0, -14);

    const frameGeo = new THREE.BoxGeometry(1.4, 2.4, 0.15);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.6, roughness: 0.3 });
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.y = 1.2;
    this.mirrorGroup.add(frame);

    const glassGeo = new THREE.PlaneGeometry(1.1, 2.1);
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xbfdbfe, metalness: 0.9, roughness: 0.1 });
    const glass = new THREE.Mesh(glassGeo, glassMat);
    glass.position.set(0, 1.2, 0.08);
    this.mirrorGroup.add(glass);

    const starGeo = new THREE.OctahedronGeometry(0.18);
    const star = new THREE.Mesh(starGeo, new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
    star.position.set(0, 2.6, 0.1);
    this.mirrorGroup.add(star);

    this.scene.add(this.mirrorGroup);
  }

  // --- 7. Zone 2: Alphabet Playground ---
  private buildZone2Playground() {
    // 1. 3D Slide
    this.slideGroup = new THREE.Group();
    this.slideGroup.position.set(-19, 0, -6);

    const platGeo = new THREE.BoxGeometry(2.0, 0.2, 2.0);
    const platMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6 });
    const plat = new THREE.Mesh(platGeo, platMat);
    plat.position.y = 3.0;
    this.slideGroup.add(plat);

    const poleGeo = new THREE.CylinderGeometry(0.08, 0.08, 3.0, 8);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.4 });
    [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]].forEach(([px, pz]) => {
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(px, 1.5, pz);
      this.slideGroup.add(pole);
    });

    const chuteGeo = new THREE.BoxGeometry(1.4, 0.1, 5.5);
    const chuteMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.3 });
    const chute = new THREE.Mesh(chuteGeo, chuteMat);
    chute.position.set(0, 1.4, 2.8);
    chute.rotation.x = 0.55;
    this.slideGroup.add(chute);

    this.scene.add(this.slideGroup);

    // 2. Trampoline
    this.trampolineGroup = new THREE.Group();
    this.trampolineGroup.position.set(-14, 0, -2);

    const trampRimGeo = new THREE.TorusGeometry(1.6, 0.18, 12, 24);
    const trampRimMat = new THREE.MeshStandardMaterial({ color: 0x8b5cf6, roughness: 0.5 });
    const trampRim = new THREE.Mesh(trampRimGeo, trampRimMat);
    trampRim.rotation.x = Math.PI / 2;
    trampRim.position.y = 0.7;
    this.trampolineGroup.add(trampRim);

    const trampMatGeo = new THREE.CircleGeometry(1.5, 24);
    const trampMesh = new THREE.Mesh(trampMatGeo, new THREE.MeshStandardMaterial({ color: 0x1e1e2e, roughness: 0.8 }));
    trampMesh.rotation.x = -Math.PI / 2;
    trampMesh.position.y = 0.7;
    this.trampolineGroup.add(trampMesh);

    this.scene.add(this.trampolineGroup);

    // 3. Alphabet Blocks (A to Z Horseshoe)
    const radius = 10;
    const center = new THREE.Vector3(-16, 0, -8);

    ALPHABET_DATA.forEach((item, idx) => {
      const angle = (idx / (ALPHABET_DATA.length - 1)) * (Math.PI * 1.3) - Math.PI * 0.65;
      const x = center.x + Math.sin(angle) * radius;
      const z = center.z + Math.cos(angle) * radius;

      const blockGroup = new THREE.Group();
      blockGroup.position.set(x, 0, z);

      const bGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
      const bMat = new THREE.MeshStandardMaterial({ color: item.color, roughness: 0.3 });
      const bMesh = new THREE.Mesh(bGeo, bMat);
      bMesh.position.y = 0.45;
      bMesh.name = `block_${item.letter}`;
      blockGroup.add(bMesh);

      const emblemGeo = new THREE.BoxGeometry(0.6, 0.6, 0.05);
      const emblem = new THREE.Mesh(emblemGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      emblem.position.set(0, 0.45, 0.48);
      blockGroup.add(emblem);

      this.scene.add(blockGroup);
      this.alphabetBlocks.push({
        mesh: bMesh,
        data: item,
        originalY: 0.45,
      });
    });
  }

  // --- 8. Zone 3: Number & Fruit Market ---
  private buildZone3Market() {
    const marketGroup = new THREE.Group();
    marketGroup.position.set(17, 0, -5);

    const stallCounterGeo = new THREE.BoxGeometry(4.2, 1.1, 2.0);
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.8 });
    const stallCounter = new THREE.Mesh(stallCounterGeo, woodMat);
    stallCounter.position.y = 0.55;
    marketGroup.add(stallCounter);

    const awningGeo = new THREE.BoxGeometry(4.5, 0.15, 2.4);
    const awning = new THREE.Mesh(awningGeo, new THREE.MeshStandardMaterial({ color: 0xef4444 }));
    awning.position.set(0, 2.8, 0);
    awning.rotation.x = 0.15;
    marketGroup.add(awning);

    this.scene.add(marketGroup);

    // Friendly Bear
    this.bearGroup = this.createBearModel();
    this.bearGroup.position.set(21.5, 0, -3.5);
    this.bearGroup.rotation.y = -Math.PI / 4;
    this.scene.add(this.bearGroup);

    // 10 Number Balloons
    NUMBER_BALLOONS_DATA.forEach((bData, idx) => {
      const balloonGroup = new THREE.Group();
      const angle = (idx / 10) * Math.PI * 1.4 - Math.PI * 0.7;
      const bx = 17 + Math.sin(angle) * 7.0;
      const bz = -5 + Math.cos(angle) * 7.0;
      balloonGroup.position.set(bx, 0, bz);

      const bGeo = new THREE.SphereGeometry(0.5, 18, 18);
      bGeo.scale(1, 1.25, 1);
      const bMat = new THREE.MeshStandardMaterial({ color: bData.color, roughness: 0.2, metalness: 0.1 });
      const bMesh = new THREE.Mesh(bGeo, bMat);
      bMesh.position.y = 1.9;
      bMesh.name = `balloon_${bData.num}`;
      balloonGroup.add(bMesh);

      const stringGeo = new THREE.CylinderGeometry(0.015, 0.015, 1.2, 4);
      const stringMesh = new THREE.Mesh(stringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      stringMesh.position.y = 0.65;
      balloonGroup.add(stringMesh);

      this.scene.add(balloonGroup);
      this.numberBalloons.push({
        group: balloonGroup,
        mesh: bMesh,
        num: bData.num,
        popped: false,
        color: bData.color,
      });
    });
  }

  // --- 9. Zone 4: Animal Meadow & Farm ---
  private buildZone4AnimalMeadow() {
    const meadowGroup = new THREE.Group();
    meadowGroup.position.set(-16, 0, 16);

    // Barn
    const barnBodyGeo = new THREE.BoxGeometry(6.5, 4.0, 5.0);
    const barn = new THREE.Mesh(barnBodyGeo, new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.7 }));
    barn.position.set(0, 2.0, -4.0);
    meadowGroup.add(barn);

    const bRoof = new THREE.Mesh(new THREE.ConeGeometry(5.2, 2.6, 4), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    bRoof.position.set(0, 5.0, -4.0);
    bRoof.rotation.y = Math.PI / 4;
    meadowGroup.add(bRoof);

    // Pond
    const pondGeo = new THREE.CircleGeometry(4.2, 32);
    const pond = new THREE.Mesh(pondGeo, new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.1, metalness: 0.6 }));
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(1.5, 0.02, 2.5);
    meadowGroup.add(pond);

    this.scene.add(meadowGroup);

    // Animals
    const cow = this.createCowModel();
    cow.position.set(-14, 0, 15);
    this.scene.add(cow);
    this.animals.push({ id: 'cow_daisy', name: 'Daisy the Cow', type: 'cow', group: cow, animTimer: 0, actionState: 'idle' });

    const duck = this.createDuckModel();
    duck.position.set(-15, 0.05, 18.5);
    this.scene.add(duck);
    this.animals.push({ id: 'duck_dottie', name: 'Dottie the Duck', type: 'duck', group: duck, animTimer: 0, actionState: 'swim' });

    const sheep = this.createSheepModel();
    sheep.position.set(-19, 0, 18);
    this.scene.add(sheep);
    this.animals.push({ id: 'sheep_fluffy', name: 'Fluffy the Sheep', type: 'sheep', group: sheep, animTimer: 0, actionState: 'idle' });

    const cat = this.createCatModel();
    cat.position.set(-17, 0, 12);
    this.scene.add(cat);
    this.animals.push({ id: 'cat_whiskers', name: 'Whiskers the Cat', type: 'cat', group: cat, animTimer: 0, actionState: 'idle' });
  }

  // --- 10. Zone 5: BenTown Garage & Transport Hub ---
  private buildZone5GarageAndVehicles() {
    const garageGroup = new THREE.Group();
    garageGroup.position.set(18, 0, 16);

    // Real Kenney Garage Model
    const kenneyGarage = CityModelLoader.getModel('building_garage');
    kenneyGarage.scale.set(1.5, 1.5, 1.5);
    kenneyGarage.position.set(0, 0, 0);
    garageGroup.add(kenneyGarage);

    this.scene.add(garageGroup);

    // Driveable Fire Truck
    const firetruck = this.createFireTruckModel();
    firetruck.position.set(15, 0, 14.5);
    this.scene.add(firetruck);
    this.vehicles.push({
      id: 'firetruck',
      name: 'Little Fire Truck',
      type: 'firetruck',
      group: firetruck,
      seatOffset: new THREE.Vector3(0, 0.75, 0.3),
      active: false,
      speed: 0,
      steerAngle: 0,
    });

    // Driveable Roadster
    const roadster = this.createRoadsterModel();
    roadster.position.set(19.5, 0, 16.5);
    this.scene.add(roadster);
    this.vehicles.push({
      id: 'roadster',
      name: 'Sunny Roadster',
      type: 'roadster',
      group: roadster,
      seatOffset: new THREE.Vector3(0, 0.6, 0.2),
      active: false,
      speed: 0,
      steerAngle: 0,
    });
  }

  // --- 11. Zone 6: Musical Color Path ---
  private buildZone6ColorMusicTrail() {
    const trailGroup = new THREE.Group();
    trailGroup.position.set(0, 0, 5);

    COLOR_PATH_DATA.forEach((col, idx) => {
      const x = (idx - 3) * 2.2;
      const stoneGeo = new THREE.CylinderGeometry(0.9, 0.95, 0.18, 24);
      const stoneMat = new THREE.MeshStandardMaterial({
        color: col.color,
        roughness: 0.3,
        emissive: col.color,
        emissiveIntensity: 0.15,
      });
      const stone = new THREE.Mesh(stoneGeo, stoneMat);
      stone.position.set(x, 0.09, 0);
      stone.name = `stone_${col.name}`;

      const pLight = new THREE.PointLight(col.color, 0, 4);
      pLight.position.set(x, 0.6, 0);
      trailGroup.add(pLight);

      trailGroup.add(stone);
      this.steppingStones.push({
        mesh: stone,
        data: col,
        light: pLight,
        activeTimer: 0,
      });
    });

    this.scene.add(trailGroup);
  }

  // --- 12. City Park & Scenery Decorations ---
  private buildCityParkAndScenery() {
    const treePositions = [
      [-10, -14], [10, -14], [-6, -22], [6, -22],
      [-24, 4], [-22, 12], [-10, 24], [10, 24],
      [24, 4], [22, 10], [24, -12], [-24, -12],
      [-28, -8], [-28, 8], [28, -8], [28, 8]
    ];

    treePositions.forEach(([tx, tz], i) => {
      const key = i % 2 === 0 ? 'tree_large' : 'tree_small';
      const tree = CityModelLoader.getModel(key);
      tree.position.set(tx, 0, tz);
      tree.scale.set(1.5, 1.5, 1.5);
      this.scene.add(tree);
    });

    // Lush grass & tree clumps in park
    [[-20, 6], [-8, 22], [8, 22], [22, -18]].forEach(([gx, gz]) => {
      const grassTrees = CityModelLoader.getModel('grass_trees');
      grassTrees.position.set(gx, 0, gz);
      grassTrees.scale.set(1.4, 1.4, 1.4);
      this.scene.add(grassTrees);
    });
  }

  // --- Ground markers for interactive places ---
  private buildFloatingInteractiveBadges() {
    const badgeTargets = [
      { pos: new THREE.Vector3(5.5, 0.035, -14.2), col: 0xd9b879 }, // Buster
      { pos: new THREE.Vector3(-14, 0.035, 15), col: 0xd9b879 },   // Cow
      { pos: new THREE.Vector3(-15, 0.035, 18.5), col: 0x8db8c8 }, // Duck
      { pos: new THREE.Vector3(-19, 0.035, 18), col: 0xb9c6a1 },  // Sheep
      { pos: new THREE.Vector3(15, 0.035, 14.5), col: 0xd88978 }, // Firetruck
      { pos: new THREE.Vector3(21.5, 0.035, -3.5), col: 0xd9b879 },// Bear
      { pos: new THREE.Vector3(-14, 0.035, -2), col: 0xa697c3 },  // Trampoline
      { pos: new THREE.Vector3(-19, 0.035, -6), col: 0xd88978 },  // Slide
    ];

    badgeTargets.forEach((bt) => {
      const marker = new THREE.Mesh(
        new THREE.RingGeometry(0.58, 0.64, 32),
        new THREE.MeshBasicMaterial({
          color: bt.col,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.52,
          depthWrite: false,
        })
      );
      marker.rotation.x = -Math.PI / 2;
      marker.position.copy(bt.pos);
      marker.renderOrder = 1;
      this.interactiveMarkers.push(marker);
      this.scene.add(marker);
    });
  }

  // --- Raycast Interactivity for Direct Touch ---
  public getInteractiveObjectAtRay(raycaster: THREE.Raycaster): InteractiveTarget | null {
    // 1. Animals
    for (const an of this.animals) {
      const hits = raycaster.intersectObjects(an.group.children, true);
      if (hits.length > 0) {
        return {
          id: an.id,
          type: 'animal',
          name: an.name,
          actionLabel: `Pet ${an.name.split(' ')[0]}! 🐾`,
          actionIcon: 'heart',
          position: [an.group.position.x, an.group.position.y, an.group.position.z],
          distance: 0,
          metadata: an,
        };
      }
    }

    // 2. Vehicles
    for (const vh of this.vehicles) {
      const hits = raycaster.intersectObjects(vh.group.children, true);
      if (hits.length > 0) {
        return {
          id: vh.id,
          type: 'vehicle',
          name: vh.name,
          actionLabel: `Enter ${vh.name} and drive`,
          actionIcon: 'car-sport',
          position: [vh.group.position.x, vh.group.position.y, vh.group.position.z],
          distance: 0,
          metadata: vh,
        };
      }
    }

    // 3. Alphabet Blocks
    for (const b of this.alphabetBlocks) {
      const hits = raycaster.intersectObject(b.mesh);
      if (hits.length > 0) {
        return {
          id: `letter_${b.data.letter}`,
          type: 'letter',
          name: `Letter ${b.data.letter}`,
          actionLabel: `${b.data.letter} is for ${b.data.word}! ${b.data.emoji}`,
          actionIcon: 'sparkles',
          position: [b.mesh.parent!.position.x, b.mesh.parent!.position.y, b.mesh.parent!.position.z],
          distance: 0,
          metadata: b.data,
        };
      }
    }

    // 4. Number Balloons
    for (const bal of this.numberBalloons) {
      if (bal.popped) continue;
      const hits = raycaster.intersectObject(bal.mesh);
      if (hits.length > 0) {
        return {
          id: `balloon_${bal.num}`,
          type: 'balloon',
          name: `Balloon ${bal.num}`,
          actionLabel: `Pop Balloon ${bal.num}! 🎈`,
          actionIcon: 'radio-button-on',
          position: [bal.group.position.x, bal.group.position.y, bal.group.position.z],
          distance: 0,
          metadata: bal,
        };
      }
    }

    // 5. Slide
    if (raycaster.intersectObjects(this.slideGroup.children, true).length > 0) {
      return {
        id: 'slide',
        type: 'slide',
        name: 'Super Slide',
        actionLabel: 'Slide Down! 🛝',
        actionIcon: 'caret-down-circle',
        position: [this.slideGroup.position.x, this.slideGroup.position.y, this.slideGroup.position.z],
        distance: 0,
      };
    }

    // 6. Trampoline
    if (raycaster.intersectObjects(this.trampolineGroup.children, true).length > 0) {
      return {
        id: 'trampoline',
        type: 'trampoline',
        name: 'Bouncy Trampoline',
        actionLabel: 'Bounce! 🤸',
        actionIcon: 'arrow-up-circle',
        position: [this.trampolineGroup.position.x, this.trampolineGroup.position.y, this.trampolineGroup.position.z],
        distance: 0,
      };
    }

    // 7. Bear
    if (raycaster.intersectObjects(this.bearGroup.children, true).length > 0) {
      return {
        id: 'bear',
        type: 'bear',
        name: 'Friendly Bear',
        actionLabel: 'Feed Apple! 🍎',
        actionIcon: 'nutrition',
        position: [this.bearGroup.position.x, this.bearGroup.position.y, this.bearGroup.position.z],
        distance: 0,
      };
    }

    // 8. Mirror
    if (raycaster.intersectObjects(this.mirrorGroup.children, true).length > 0) {
      return {
        id: 'wardrobe_mirror',
        type: 'mirror',
        name: 'Dressing Mirror',
        actionLabel: 'Dress Up! 👕',
        actionIcon: 'shirt',
        position: [this.mirrorGroup.position.x, this.mirrorGroup.position.y, this.mirrorGroup.position.z],
        distance: 0,
      };
    }

    // 9. Pedestrian NPCs
    for (const ped of this.realisticBuilder.getPedestrians()) {
        if (raycaster.intersectObjects(ped.group.children, true).length > 0) {
          return {
            id: `pedestrian_${ped.name}`,
            type: 'pedestrian',
            name: ped.name,
            actionLabel: `Say Hi to ${ped.name}! 👋`,
            actionIcon: 'hand-left',
            position: [ped.group.position.x, ped.group.position.y, ped.group.position.z],
            distance: 0,
            metadata: ped,
          };
        }
    }

    return null;
  }

  // --- Proximity Detection ---
  public getClosestInteractiveTarget(playerPos: THREE.Vector3): InteractiveTarget | null {
    let closestTarget: InteractiveTarget | null = null;
    let minDistance = 5.2;

    this.animals.forEach((an) => {
      const dist = playerPos.distanceTo(an.group.position);
      if (dist < minDistance) {
        minDistance = dist;
        closestTarget = {
          id: an.id,
          type: 'animal',
          name: an.name,
          actionLabel: `Pet ${an.name.split(' ')[0]}! 🐾`,
          actionIcon: 'heart',
          position: [an.group.position.x, an.group.position.y, an.group.position.z],
          distance: dist,
          metadata: an,
        };
      }
    });

    this.vehicles.forEach((vh) => {
      // Distance to the vehicle's body (not its centre) so long vehicles like the bus work too.
      const dist = this.distanceToVehicleBody(vh, playerPos.x, playerPos.z);
      if (dist < 3.2 && dist < minDistance) {
        minDistance = dist;
        closestTarget = {
          id: vh.id,
          type: 'vehicle',
          name: vh.name,
          actionLabel: `Enter ${vh.name} and drive`,
          actionIcon: 'car-sport',
          position: [vh.group.position.x, vh.group.position.y, vh.group.position.z],
          distance: dist,
          metadata: vh,
        };
      }
    });

    const trampDist = playerPos.distanceTo(this.trampolineGroup.position);
    if (trampDist < 4.5 && trampDist < minDistance) {
      minDistance = trampDist;
      closestTarget = {
        id: 'trampoline',
        type: 'trampoline',
        name: 'Bouncy Trampoline',
        actionLabel: 'Bounce! 🤸',
        actionIcon: 'arrow-up-circle',
        position: [this.trampolineGroup.position.x, this.trampolineGroup.position.y, this.trampolineGroup.position.z],
        distance: trampDist,
      };
    }

    const slideDist = playerPos.distanceTo(this.slideGroup.position);
    if (slideDist < 4.8 && slideDist < minDistance) {
      minDistance = slideDist;
      closestTarget = {
        id: 'slide',
        type: 'slide',
        name: 'Super Slide',
        actionLabel: 'Slide Down! 🛝',
        actionIcon: 'caret-down-circle',
        position: [this.slideGroup.position.x, this.slideGroup.position.y, this.slideGroup.position.z],
        distance: slideDist,
      };
    }

    const bearDist = playerPos.distanceTo(this.bearGroup.position);
    if (bearDist < 4.5 && bearDist < minDistance) {
      minDistance = bearDist;
      closestTarget = {
        id: 'bear',
        type: 'bear',
        name: 'Friendly Bear',
        actionLabel: 'Feed Apple! 🍎',
        actionIcon: 'nutrition',
        position: [this.bearGroup.position.x, this.bearGroup.position.y, this.bearGroup.position.z],
        distance: bearDist,
      };
    }

    const mirrorDist = playerPos.distanceTo(this.mirrorGroup.position);
    if (mirrorDist < 4.0 && mirrorDist < minDistance) {
      minDistance = mirrorDist;
      closestTarget = {
        id: 'wardrobe_mirror',
        type: 'mirror',
        name: 'Dressing Mirror',
        actionLabel: 'Dress Up! 👕',
        actionIcon: 'shirt',
        position: [this.mirrorGroup.position.x, this.mirrorGroup.position.y, this.mirrorGroup.position.z],
        distance: mirrorDist,
      };
    }

    this.alphabetBlocks.forEach((ab) => {
      const blockPos = ab.mesh.parent?.position || ab.mesh.position;
      const dist = playerPos.distanceTo(blockPos);
      if (dist < 3.2 && dist < minDistance) {
        minDistance = dist;
        closestTarget = {
          id: `letter_${ab.data.letter}`,
          type: 'letter',
          name: `Letter ${ab.data.letter}`,
          actionLabel: `${ab.data.letter} is for ${ab.data.word}! ${ab.data.emoji}`,
          actionIcon: 'sparkles',
          position: [blockPos.x, blockPos.y, blockPos.z],
          distance: dist,
          metadata: ab.data,
        };
      }
    });

    this.numberBalloons.forEach((bal) => {
      if (bal.popped) return;
      const dist = playerPos.distanceTo(bal.group.position);
      if (dist < 3.5 && dist < minDistance) {
        minDistance = dist;
        closestTarget = {
          id: `balloon_${bal.num}`,
          type: 'balloon',
          name: `Balloon ${bal.num}`,
          actionLabel: `Pop Balloon ${bal.num}! 🎈`,
          actionIcon: 'radio-button-on',
          position: [bal.group.position.x, bal.group.position.y, bal.group.position.z],
          distance: dist,
          metadata: bal,
        };
      }
    });

    this.realisticBuilder.getPedestrians().forEach((ped) => {
        const dist = playerPos.distanceTo(ped.group.position);
        if (dist < 3.2 && dist < minDistance) {
          minDistance = dist;
          closestTarget = {
            id: `pedestrian_${ped.name}`,
            type: 'pedestrian',
            name: ped.name,
            actionLabel: `Say Hi to ${ped.name}! 👋`,
            actionIcon: 'hand-left',
            position: [ped.group.position.x, ped.group.position.y, ped.group.position.z],
            distance: dist,
            metadata: ped,
          };
        }
    });

    this.realisticBuilder.getShops().forEach((shop) => {
      const dist = playerPos.distanceTo(shop.position);
      if (dist < 5.2 && dist < minDistance) {
        minDistance = dist;
        closestTarget = {
          id: shop.id,
          type: 'shop',
          name: shop.name,
          actionLabel: `Visit ${shop.name}`,
          actionIcon: 'cart',
          position: [shop.position.x, shop.position.y, shop.position.z],
          distance: dist,
          metadata: shop,
        };
      }
    });

    return closestTarget;
  }

  // --- Interaction Actions ---
  public triggerLetterBlock(letter: string): AlphabetItem | null {
    const block = this.alphabetBlocks.find((b) => b.data.letter === letter);
    if (!block) return null;

    block.mesh.position.y = 1.4;
    block.mesh.rotation.y += Math.PI * 2;
    this.spawnStarParticles(block.mesh.parent!.position, parseInt(block.data.color.replace('#', '0x'), 16), 18);

    audio.playPop();
    audio.speak(`${block.data.letter}! ${block.data.phonics}!`);
    haptics.light();

    return block.data;
  }

  public triggerBalloon(num: number): boolean {
    const balloon = this.numberBalloons.find((b) => b.num === num);
    if (!balloon || balloon.popped) return false;

    balloon.popped = true;
    balloon.group.visible = false;

    this.spawnStarParticles(balloon.group.position, parseInt(balloon.color.replace('#', '0x'), 16), 26);
    audio.playPop();
    const word = NUMBER_BALLOONS_DATA.find((n) => n.num === num)?.word || `${num}`;
    audio.speak(`${num}! ${word}! POP! Great job!`);
    haptics.medium();

    setTimeout(() => {
      balloon.popped = false;
      balloon.group.visible = true;
    }, 7000);

    return true;
  }

  public triggerFeedBear(): string {
    this.bearApplesEaten++;
    this.spawnStarParticles(this.bearGroup.position, 0xef4444, 16);
    audio.playFeed();
    haptics.success();
    const msg = `Crunch crunch! Bear ate ${this.bearApplesEaten} ${this.bearApplesEaten === 1 ? 'apple' : 'apples'}!`;
    audio.speak(msg);
    return msg;
  }

  public triggerPedestrian(pedName: string): string {
    if (this.realisticBuilder.greetPedestrian(pedName)) {
      const ped = this.realisticBuilder.getPedestrians().find((person) => person.name === pedName);
      if (!ped) return '';
      this.spawnStarParticles(ped.group.position, 0x38bdf8, 16);
      audio.playCheer();
      const msg = `Hello Oshu! My name is ${ped.name}! Welcome to BenTown!`;
      audio.speak(msg);
      haptics.selection();
      return msg;
    }
    return '';
  }

  public triggerShop(shopId: string): string {
    const shop = this.realisticBuilder.getShops().find((entry) => entry.id === shopId);
    if (!shop) return '';
    const message = `Welcome to ${shop.name}, Oshu! Let's look around the ${shop.category.toLowerCase()} shop.`;
    this.spawnStarParticles(shop.position, 0xf0c86d, 10);
    audio.speak(message);
    haptics.selection();
    return message;
  }

  public triggerAnimal(animalId: string): string {
    const an = this.animals.find((a) => a.id === animalId);
    if (!an) return '';

    an.actionState = 'excited';
    an.animTimer = 0;
    this.spawnStarParticles(an.group.position, 0xff85a1, 16);
    haptics.light();

    let phrase = '';
    switch (an.type) {
      case 'dog':
        audio.playHonk();
        phrase = 'Woof woof! Buster is wagging his tail for Oshu!';
        break;
      case 'cow':
        phrase = 'Moooo-oo! Daisy says hello Oshu!';
        break;
      case 'duck':
        phrase = 'Quack quack! Dottie loves swimming in the pond!';
        break;
      case 'sheep':
        phrase = 'Baa baa! Fluffy did a big backflip!';
        break;
      case 'cat':
        phrase = 'Meow! Purr purr, Whiskers loves you!';
        break;
    }
    audio.speak(phrase);
    return phrase;
  }

  public checkSteppingStones(playerPos: THREE.Vector3, onNoteTriggered: (col: typeof COLOR_PATH_DATA[0]) => void) {
    this.steppingStones.forEach((st) => {
      const worldPos = new THREE.Vector3();
      st.mesh.getWorldPosition(worldPos);
      const dist = playerPos.distanceTo(worldPos);

      if (dist < 1.2 && st.activeTimer <= 0) {
        st.activeTimer = 0.8;
        st.light.intensity = 2.5;
        (st.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.9;
        this.spawnStarParticles(worldPos, parseInt(st.data.color.replace('#', '0x'), 16), 12);

        audio.playXylophone(st.data.freq);
        audio.speak(`${st.data.name}!`);
        haptics.light();
        onNoteTriggered(st.data);
      }
    });
  }

  public spawnStarParticles(pos: THREE.Vector3, colorHex: number = 0xfacc15, count: number = 16) {
    const starGeo = new THREE.OctahedronGeometry(0.18);
    const starMat = new THREE.MeshBasicMaterial({ color: colorHex });

    for (let i = 0; i < count; i++) {
      const pMesh = new THREE.Mesh(starGeo, starMat);
      pMesh.position.copy(pos);
      this.scene.add(pMesh);

      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 6,
        Math.random() * 5 + 3,
        (Math.random() - 0.5) * 6
      );

      this.particles.push({
        mesh: pMesh,
        vel,
        life: 0,
        maxLife: 1.2 + Math.random() * 0.4,
      });
    }
  }

  // --- Procedural Animal Models ---
  public createAnimalModel(type: string, color: number): THREE.Group {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.9), bodyMat);
    torso.position.y = 0.55;
    group.add(torso);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), bodyMat);
    head.position.set(0, 0.85, 0.45);
    group.add(head);

    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.2, 0.25), new THREE.MeshStandardMaterial({ color: 0x332211 }));
    snout.position.set(0, 0.75, 0.72);
    group.add(snout);

    const earGeo = new THREE.BoxGeometry(0.1, 0.35, 0.18);
    const leftEar = new THREE.Mesh(earGeo, bodyMat);
    leftEar.position.set(-0.25, 0.85, 0.4);
    group.add(leftEar);
    const rightEar = new THREE.Mesh(earGeo, bodyMat);
    rightEar.position.set(0.25, 0.85, 0.4);
    group.add(rightEar);

    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.4), bodyMat);
    tail.position.set(0, 0.75, -0.5);
    tail.rotation.x = 0.6;
    group.add(tail);

    const legGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.35, 8);
    [[-0.2, -0.3], [0.2, -0.3], [-0.2, 0.3], [0.2, 0.3]].forEach(([lx, lz]) => {
      const leg = new THREE.Mesh(legGeo, bodyMat);
      leg.position.set(lx, 0.18, lz);
      group.add(leg);
    });

    return group;
  }

  public createCowModel(): THREE.Group {
    const group = new THREE.Group();
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x1e293b });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 1.8), whiteMat);
    torso.position.y = 1.0;
    group.add(torso);

    const spot = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.02), blackMat);
    spot.position.set(0.61, 1.1, 0.2);
    group.add(spot);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), whiteMat);
    head.position.set(0, 1.4, 1.1);
    group.add(head);

    const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.35), new THREE.MeshStandardMaterial({ color: 0xfda4af }));
    muzzle.position.set(0, 1.25, 1.45);
    group.add(muzzle);

    const hornGeo = new THREE.ConeGeometry(0.06, 0.25, 8);
    const leftHorn = new THREE.Mesh(hornGeo, new THREE.MeshStandardMaterial({ color: 0xfef08a }));
    leftHorn.position.set(-0.25, 1.8, 1.05);
    group.add(leftHorn);
    const rightHorn = new THREE.Mesh(hornGeo, new THREE.MeshStandardMaterial({ color: 0xfef08a }));
    rightHorn.position.set(0.25, 1.8, 1.05);
    group.add(rightHorn);

    const legGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.6, 8);
    [[-0.4, -0.6], [0.4, -0.6], [-0.4, 0.6], [0.4, 0.6]].forEach(([lx, lz]) => {
      const leg = new THREE.Mesh(legGeo, whiteMat);
      leg.position.set(lx, 0.3, lz);
      group.add(leg);
    });

    return group;
  }

  public createDuckModel(): THREE.Group {
    const group = new THREE.Group();
    const yellowMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.5 });
    const orangeMat = new THREE.MeshStandardMaterial({ color: 0xf97316 });

    const bodyGeo = new THREE.SphereGeometry(0.35, 14, 14);
    bodyGeo.scale(1, 0.8, 1.3);
    const body = new THREE.Mesh(bodyGeo, yellowMat);
    body.position.y = 0.3;
    group.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), yellowMat);
    head.position.set(0, 0.55, 0.3);
    group.add(head);

    const bill = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.25), orangeMat);
    bill.position.set(0, 0.5, 0.52);
    group.add(bill);

    return group;
  }

  public createSheepModel(): THREE.Group {
    const group = new THREE.Group();
    const woolMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.9 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0x334155 });

    const bodyGeo = new THREE.SphereGeometry(0.65, 16, 16);
    bodyGeo.scale(1.1, 0.9, 1.3);
    const body = new THREE.Mesh(bodyGeo, woolMat);
    body.position.y = 0.7;
    group.add(body);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.4, 0.4), skinMat);
    head.position.set(0, 0.8, 0.7);
    group.add(head);

    const legGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.4, 8);
    [[-0.25, -0.35], [0.25, -0.35], [-0.25, 0.35], [0.25, 0.35]].forEach(([lx, lz]) => {
      const leg = new THREE.Mesh(legGeo, skinMat);
      leg.position.set(lx, 0.2, lz);
      group.add(leg);
    });

    return group;
  }

  public createCatModel(): THREE.Group {
    const group = new THREE.Group();
    const catMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.6 });

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), catMat);
    body.position.y = 0.35;
    group.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), catMat);
    head.position.set(0, 0.55, 0.3);
    group.add(head);

    const earGeo = new THREE.ConeGeometry(0.08, 0.15, 4);
    const leftEar = new THREE.Mesh(earGeo, catMat);
    leftEar.position.set(-0.12, 0.75, 0.3);
    group.add(leftEar);
    const rightEar = new THREE.Mesh(earGeo, catMat);
    rightEar.position.set(0.12, 0.75, 0.3);
    group.add(rightEar);

    return group;
  }

  private createBearModel(): THREE.Group {
    const group = new THREE.Group();
    const bearMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.8 });
    const snoutMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.7 });

    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.75, 16, 16), bearMat);
    belly.position.y = 0.85;
    group.add(belly);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 16), bearMat);
    head.position.set(0, 1.85, 0.15);
    group.add(head);

    const earGeo = new THREE.SphereGeometry(0.18, 12, 12);
    const leftEar = new THREE.Mesh(earGeo, bearMat);
    leftEar.position.set(-0.45, 2.3, 0.1);
    group.add(leftEar);
    const rightEar = new THREE.Mesh(earGeo, bearMat);
    rightEar.position.set(0.45, 2.3, 0.1);
    group.add(rightEar);

    const snout = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 12), snoutMat);
    snout.position.set(0, 1.75, 0.55);
    group.add(snout);

    return group;
  }

  private createFireTruckModel(): THREE.Group {
    const group = new THREE.Group();
    const redMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.4 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 3.2), redMat);
    body.position.y = 0.8;
    group.add(body);

    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.8, 1.2), redMat);
    cab.position.set(0, 1.45, 0.7);
    group.add(cab);

    const siren = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.2, 12), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
    siren.position.set(0, 1.95, 0.7);
    group.add(siren);

    const wGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.24, 16);
    wGeo.rotateZ(Math.PI / 2);
    [[-0.85, -0.9], [0.85, -0.9], [-0.85, 0.9], [0.85, 0.9]].forEach(([wx, wz]) => {
      const wheel = new THREE.Mesh(wGeo, wheelMat);
      wheel.position.set(wx, 0.32, wz);
      group.add(wheel);
    });

    return group;
  }

  private createRoadsterModel(): THREE.Group {
    const group = new THREE.Group();
    const blueMat = new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.3 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.6, 2.6), blueMat);
    body.position.y = 0.55;
    group.add(body);

    const ws = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.45), new THREE.MeshStandardMaterial({ color: 0xa5f3fc, transparent: true, opacity: 0.8 }));
    ws.position.set(0, 1.0, 0.45);
    ws.rotation.x = -0.3;
    group.add(ws);

    const wGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.2, 16);
    wGeo.rotateZ(Math.PI / 2);
    [[-0.75, -0.8], [0.75, -0.8], [-0.75, 0.8], [0.75, 0.8]].forEach(([wx, wz]) => {
      const wheel = new THREE.Mesh(wGeo, wheelMat);
      wheel.position.set(wx, 0.28, wz);
      group.add(wheel);
    });

    return group;
  }

  // --- Update Loop ---
  public update(delta: number, playerPos?: THREE.Vector3) {
    const t = Date.now() * 0.0015;
    this.realisticBuilder.update(delta, playerPos);
    if (playerPos) audio.updateTrafficSound(playerPos, this.realisticBuilder.getTrafficSnapshot());

    // Stepping stones decay
    this.steppingStones.forEach((st) => {
      if (st.activeTimer > 0) {
        st.activeTimer -= delta;
        st.light.intensity = Math.max(0, st.activeTimer * 3.0);
        (st.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.15 + st.activeTimer * 0.8;
      }
    });

    // Alphabet block gentle hover return
    this.alphabetBlocks.forEach((b) => {
      if (b.mesh.position.y > b.originalY) {
        b.mesh.position.y = THREE.MathUtils.lerp(b.mesh.position.y, b.originalY, delta * 3);
      }
    });

    // Number balloons bobbing
    this.numberBalloons.forEach((bal, idx) => {
      if (!bal.popped) {
        bal.group.position.y = Math.sin(t * 1.5 + idx) * 0.14;
      }
    });

    // Animals excitement
    this.animals.forEach((an) => {
      an.animTimer += delta;
      if (an.actionState === 'excited') {
        an.group.position.y = Math.abs(Math.sin(an.animTimer * 12)) * 0.4;
        an.group.rotation.y += delta * 4;
        if (an.animTimer > 1.8) {
          an.actionState = 'idle';
          an.group.position.y = 0;
        }
      } else {
        an.group.rotation.y += Math.sin(an.animTimer * 1.5) * 0.003;
      }
    });

    // Particles update
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += delta;
      if (p.life >= p.maxLife) {
        this.scene.remove(p.mesh);
        this.particles.splice(i, 1);
      } else {
        p.mesh.position.addScaledVector(p.vel, delta);
        p.vel.y -= 9.8 * delta;
        const scale = 1 - p.life / p.maxLife;
        p.mesh.scale.set(scale, scale, scale);
      }
    }
  }
}
