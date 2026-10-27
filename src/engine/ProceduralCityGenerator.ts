import * as THREE from 'three';
import { CityModelLoader } from './CityModelLoader';

export enum CellType {
  EMPTY = 0,
  ROAD = 1,
  BUILDING = 2,
  SIDEWALK = 3,
  PARK = 4,
  PLAZA = 5,
  WATER = 6,
  GRASS_CELL = 7,
}

export enum DistrictType {
  WATER = 0,
  DOWNTOWN = 1,
  COMMERCIAL = 2,
  RESIDENTIAL = 3,
  INDUSTRIAL = 4,
  PARK = 5,
  PLAZA = 6,
  WATERFRONT = 7,
}

export interface CityPedestrian {
  group: THREE.Group;
  currentWaypoint: THREE.Vector3;
  targetWaypoint: THREE.Vector3;
  waypoints: THREE.Vector3[];
  waypointIndex: number;
  speed: number;
  walkTimer: number;
  isWaving: boolean;
  waveTimer: number;
  name: string;
}

export class ProceduralCityGenerator {
  public gridSize: number = 36;
  public roadSpacing: number = 6;
  public tileSize: number = 2.0; // 2.0 Three.js units per grid cell

  public plan: Map<string, CellType> = new Map();
  public districtMap: Map<string, DistrictType> = new Map();
  public sidewalkCells: { x: number; z: number; worldPos: THREE.Vector3 }[] = [];
  public buildingCells: { x: number; z: number; worldPos: THREE.Vector3; type: string }[] = [];
  public pedestrians: CityPedestrian[] = [];

  private cityGroup: THREE.Group = new THREE.Group();
  private collisionBoxes: THREE.Box3[] = [];

  constructor(gridSize: number = 36, roadSpacing: number = 6, tileSize: number = 2.0) {
    this.gridSize = gridSize;
    this.roadSpacing = roadSpacing;
    this.tileSize = tileSize;
  }

  public generate(scene: THREE.Scene): {
    cityGroup: THREE.Group;
    pedestrians: CityPedestrian[];
    collisionBoxes: THREE.Box3[];
  } {
    this.cityGroup = new THREE.Group();
    this.cityGroup.name = 'BenTown_ProceduralCity';
    this.plan.clear();
    this.districtMap.clear();
    this.sidewalkCells = [];
    this.buildingCells = [];
    this.pedestrians = [];
    this.collisionBoxes = [];

    // 1. Generate district zoning
    this.generateDistricts();

    // 2. Plan street grid
    this.planRoads();

    // 3. Trim dead-end road segments to sidewalks
    this.trimDeadEnds();

    // 4. Plan sidewalk perimeter
    this.planSidewalks();

    // 5. Plan building blocks & zoning allocation
    this.planBlocks();

    // 6. Build 3D mesh representations using Kenney models
    this.resolveTiles();

    // 7. Build eastern bay water plane
    this.buildBayWater();

    // 8. Spawn animated pedestrian NPCs on sidewalks
    this.spawnPedestrians();

    scene.add(this.cityGroup);

    return {
      cityGroup: this.cityGroup,
      pedestrians: this.pedestrians,
      collisionBoxes: this.collisionBoxes,
    };
  }

  public isPositionBlocked(x: number, z: number, radius: number = 0.34): boolean {
    return this.collisionBoxes.some((box) =>
      x + radius > box.min.x &&
      x - radius < box.max.x &&
      z + radius > box.min.z &&
      z - radius < box.max.z
    );
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

  // --- 1. District Zoning ---
  private generateDistricts() {
    const bayStart = Math.floor(this.gridSize * 0.82);

    for (let x = 0; x < this.gridSize; x++) {
      for (let z = 0; z < this.gridSize; z++) {
        const key = `${x},${z}`;

        // Eastern edge is the ocean bay
        if (x >= bayStart) {
          this.districtMap.set(key, DistrictType.WATER);
        }
        // Central-West lush educational park
        else if (
          x >= Math.floor(this.gridSize * 0.08) &&
          x < Math.floor(this.gridSize * 0.42) &&
          z >= Math.floor(this.gridSize * 0.32) &&
          z < Math.floor(this.gridSize * 0.62)
        ) {
          this.districtMap.set(key, DistrictType.PARK);
        }
        // Town Plazas
        else if (this.isPlaza(x, z)) {
          this.districtMap.set(key, DistrictType.PLAZA);
        }
        // Waterfront promenade
        else if (x >= bayStart - 4) {
          this.districtMap.set(key, DistrictType.WATERFRONT);
        }
        else {
          // Downtown cluster distance check
          const dtCenterX = bayStart * 0.62;
          const dtCenterZ = this.gridSize * 0.35;
          const distToDt = Math.sqrt(Math.pow(x - dtCenterX, 2) + Math.pow(z - dtCenterZ, 2));

          if (distToDt < this.gridSize * 0.22) {
            this.districtMap.set(key, DistrictType.DOWNTOWN);
          } else if (distToDt < this.gridSize * 0.36) {
            this.districtMap.set(key, DistrictType.COMMERCIAL);
          } else if (z > this.gridSize * 0.74) {
            this.districtMap.set(key, DistrictType.INDUSTRIAL);
          } else {
            this.districtMap.set(key, DistrictType.RESIDENTIAL);
          }
        }
      }
    }
  }

  private isPlaza(x: number, z: number): boolean {
    if (x % this.roadSpacing === 0 || z % this.roadSpacing === 0) return false;
    const center = Math.floor(this.gridSize / 2);
    // Central Town Plaza (3x3 block)
    if (Math.abs(x - center) <= 2 && Math.abs(z - center) <= 2) {
      return true;
    }
    return false;
  }

  // --- 2. Road Network Planning ---
  private planRoads() {
    for (let x = 0; x < this.gridSize; x++) {
      for (let z = 0; z < this.gridSize; z++) {
        const key = `${x},${z}`;
        const district = this.districtMap.get(key) ?? DistrictType.RESIDENTIAL;
        const onGrid = x % this.roadSpacing === 0 || z % this.roadSpacing === 0;

        if (district === DistrictType.WATER) {
          this.plan.set(key, CellType.WATER);
        } else if (district === DistrictType.PLAZA) {
          this.plan.set(key, CellType.PLAZA);
        } else if (onGrid) {
          this.plan.set(key, CellType.ROAD);
        } else if (district === DistrictType.PARK) {
          this.plan.set(key, CellType.PARK);
        } else {
          this.plan.set(key, CellType.EMPTY);
        }
      }
    }
  }

  // --- 3. Trim Dead Ends ---
  private trimDeadEnds() {
    let changed = true;
    let iterations = 0;
    while (changed && iterations < 8) {
      changed = false;
      iterations++;
      for (let x = 0; x < this.gridSize; x++) {
        for (let z = 0; z < this.gridSize; z++) {
          const key = `${x},${z}`;
          if (this.plan.get(key) !== CellType.ROAD) continue;

          let roadNeighbors = 0;
          const neighbors = [
            [x + 1, z],
            [x - 1, z],
            [x, z + 1],
            [x, z - 1],
          ];
          for (const [nx, nz] of neighbors) {
            if (this.plan.get(`${nx},${nz}`) === CellType.ROAD) {
              roadNeighbors++;
            }
          }

          if (roadNeighbors <= 1) {
            this.plan.set(key, CellType.SIDEWALK);
            changed = true;
          }
        }
      }
    }
  }

  // --- 4. Sidewalks ---
  private planSidewalks() {
    const roadCells: [number, number][] = [];
    for (let x = 0; x < this.gridSize; x++) {
      for (let z = 0; z < this.gridSize; z++) {
        if (this.plan.get(`${x},${z}`) === CellType.ROAD) {
          roadCells.push([x, z]);
        }
      }
    }

    for (const [rx, rz] of roadCells) {
      const neighbors = [
        [rx + 1, rz],
        [rx - 1, rz],
        [rx, rz + 1],
        [rx, rz - 1],
      ];
      for (const [nx, nz] of neighbors) {
        const key = `${nx},${nz}`;
        if (this.plan.get(key) === CellType.EMPTY) {
          this.plan.set(key, CellType.SIDEWALK);
        }
      }
    }
  }

  // --- 5. Building & Block Allocation ---
  private planBlocks() {
    for (let x = 0; x < this.gridSize; x++) {
      for (let z = 0; z < this.gridSize; z++) {
        const key = `${x},${z}`;
        if (this.plan.get(key) === CellType.EMPTY) {
          const district = this.districtMap.get(key) ?? DistrictType.RESIDENTIAL;
          const roll = Math.random();

          switch (district) {
            case DistrictType.DOWNTOWN:
              this.plan.set(key, roll < 0.78 ? CellType.BUILDING : CellType.PLAZA);
              break;
            case DistrictType.COMMERCIAL:
              this.plan.set(key, roll < 0.62 ? CellType.BUILDING : CellType.PLAZA);
              break;
            case DistrictType.RESIDENTIAL:
              this.plan.set(key, roll < 0.42 ? CellType.BUILDING : CellType.GRASS_CELL);
              break;
            case DistrictType.INDUSTRIAL:
              this.plan.set(key, roll < 0.48 ? CellType.BUILDING : CellType.SIDEWALK);
              break;
            case DistrictType.WATERFRONT:
              this.plan.set(key, roll < 0.22 ? CellType.BUILDING : CellType.PLAZA);
              break;
            default:
              this.plan.set(key, CellType.GRASS_CELL);
              break;
          }
        }
      }
    }
  }

  // --- 6. Resolve 3D Tiles ---
  private resolveTiles() {
    const halfGrid = this.gridSize / 2;

    for (let x = 0; x < this.gridSize; x++) {
      for (let z = 0; z < this.gridSize; z++) {
        const key = `${x},${z}`;
        const cell = this.plan.get(key) ?? CellType.WATER;
        const worldX = (x - halfGrid) * this.tileSize;
        const worldZ = (z - halfGrid) * this.tileSize;
        const worldPos = new THREE.Vector3(worldX, 0, worldZ);

        switch (cell) {
          case CellType.ROAD:
            this.buildRoadCell(x, z, worldPos);
            break;
          case CellType.SIDEWALK:
            this.buildSidewalkCell(x, z, worldPos);
            break;
          case CellType.BUILDING:
            this.buildBuildingCell(x, z, worldPos);
            break;
          case CellType.PARK:
            this.buildParkCell(x, z, worldPos);
            break;
          case CellType.PLAZA:
            this.buildPlazaCell(x, z, worldPos);
            break;
          case CellType.GRASS_CELL:
            this.buildGrassCell(x, z, worldPos);
            break;
          case CellType.WATER:
            // Handled as single bay plane
            break;
        }
      }
    }
  }

  // --- Road Solving ---
  private isRoad(x: number, z: number): boolean {
    return this.plan.get(`${x},${z}`) === CellType.ROAD;
  }

  private buildRoadCell(x: number, z: number, pos: THREE.Vector3) {
    const n = this.isRoad(x, z - 1);
    const s = this.isRoad(x, z + 1);
    const w = this.isRoad(x - 1, z);
    const e = this.isRoad(x + 1, z);
    const count = (n ? 1 : 0) + (s ? 1 : 0) + (w ? 1 : 0) + (e ? 1 : 0);

    let modelName = 'road_straight';
    let rotY = 0;

    // 4-way intersection
    if (count >= 4) {
      modelName = 'road_intersection';
    }
    // 3-way T-junction
    else if (count === 3) {
      modelName = 'road_split';
      if (!n) rotY = 0;                   // has S, W, E
      else if (!w) rotY = Math.PI / 2;    // has N, S, E
      else if (!s) rotY = Math.PI;        // has N, W, E
      else if (!e) rotY = (3 * Math.PI) / 2; // has N, S, W
    }
    // 2-way: Straight or Corner
    else if (count === 2) {
      if (n && s) {
        modelName = Math.random() < 0.25 ? 'road_straight_lightposts' : 'road_straight';
        rotY = 0;
      } else if (w && e) {
        modelName = Math.random() < 0.25 ? 'road_straight_lightposts' : 'road_straight';
        rotY = Math.PI / 2;
      } else {
        modelName = 'road_corner';
        if (s && w) rotY = 0;
        else if (s && e) rotY = Math.PI / 2;
        else if (n && e) rotY = Math.PI;
        else if (n && w) rotY = (3 * Math.PI) / 2;
      }
    }
    // Dead-end / cul-de-sac
    else {
      modelName = 'pavement';
    }

    const tile = CityModelLoader.getModel(modelName);
    tile.position.copy(pos);
    tile.rotation.y = rotY;
    tile.scale.set(this.tileSize, this.tileSize, this.tileSize);
    this.cityGroup.add(tile);
  }

  // --- Sidewalks with street props & awnings ---
  private buildSidewalkCell(x: number, z: number, pos: THREE.Vector3) {
    const district = this.districtMap.get(`${x},${z}`) ?? DistrictType.RESIDENTIAL;

    // Base pavement tile
    const pavement = CityModelLoader.getModel('pavement');
    pavement.position.copy(pos);
    pavement.scale.set(this.tileSize, this.tileSize, this.tileSize);
    this.cityGroup.add(pavement);

    const rotY = this.getFacingRoadRotation(x, z);

    // Downtown / Commercial awnings
    if (district === DistrictType.COMMERCIAL || district === DistrictType.DOWNTOWN) {
      if (Math.random() < 0.16) {
        const awningModel = Math.random() < 0.5 ? 'detail_awning' : 'detail_awning_wide';
        const awning = CityModelLoader.getModel(awningModel);
        awning.position.set(pos.x, 1.8, pos.z);
        awning.rotation.y = rotY;
        awning.scale.set(this.tileSize * 0.9, this.tileSize * 0.9, this.tileSize * 0.9);
        this.cityGroup.add(awning);
      }
    }
    // Residential picket fences
    else if (district === DistrictType.RESIDENTIAL) {
      if (Math.random() < 0.22) {
        const fenceModel = Math.random() < 0.6 ? 'fence' : 'fence_low';
        const fence = CityModelLoader.getModel(fenceModel);
        fence.position.copy(pos);
        fence.rotation.y = rotY;
        fence.scale.set(this.tileSize * 0.8, this.tileSize * 0.8, this.tileSize * 0.8);
        this.cityGroup.add(fence);
      }
    }

    this.sidewalkCells.push({ x, z, worldPos: pos.clone() });
  }

  // --- District-Appropriate 3D Buildings ---
  private buildBuildingCell(x: number, z: number, pos: THREE.Vector3) {
    const district = this.districtMap.get(`${x},${z}`) ?? DistrictType.RESIDENTIAL;
    const rotY = this.getFacingRoadRotation(x, z);

    let modelName = 'building_small_a';
    let heightScale = this.tileSize;

    switch (district) {
      case DistrictType.DOWNTOWN: {
        // High-rise Skyscrapers and commercial towers
        const skyscrapers = [
          'building_skyscraper_a',
          'building_skyscraper_b',
          'building_skyscraper_c',
          'building_skyscraper_d',
          'building_skyscraper_e',
        ];
        const commercialTowers = [
          'commercial_building_a',
          'commercial_building_b',
          'commercial_building_c',
          'commercial_building_d',
          'commercial_building_e',
          'commercial_building_f',
        ];
        if (Math.random() < 0.65) {
          modelName = skyscrapers[Math.floor(Math.random() * skyscrapers.length)];
          heightScale = this.tileSize * (1.2 + Math.random() * 0.5); // Majestic towering scale
        } else {
          modelName = commercialTowers[Math.floor(Math.random() * commercialTowers.length)];
          heightScale = this.tileSize * 1.1;
        }
        break;
      }

      case DistrictType.COMMERCIAL:
      case DistrictType.WATERFRONT: {
        const stores = [
          'commercial_building_a',
          'commercial_building_b',
          'commercial_building_c',
          'commercial_building_d',
          'building_small_a',
          'building_small_b',
          'building_small_c',
          'building_small_d',
        ];
        modelName = stores[Math.floor(Math.random() * stores.length)];
        heightScale = this.tileSize;
        break;
      }

      case DistrictType.RESIDENTIAL: {
        const houses = [
          'suburban_type_a',
          'suburban_type_b',
          'suburban_type_c',
          'suburban_type_d',
          'suburban_type_e',
          'suburban_type_f',
          'suburban_type_g',
          'suburban_type_h',
        ];
        modelName = houses[Math.floor(Math.random() * houses.length)];
        heightScale = this.tileSize;
        break;
      }

      case DistrictType.INDUSTRIAL: {
        const industrial = [
          'industrial_building_a',
          'industrial_building_b',
          'building_garage',
          'detail_tank',
        ];
        modelName = industrial[Math.floor(Math.random() * industrial.length)];
        heightScale = this.tileSize;
        break;
      }
    }

    const bldg = CityModelLoader.getModel(modelName);
    bldg.position.copy(pos);
    bldg.rotation.y = rotY;
    bldg.scale.set(this.tileSize, heightScale, this.tileSize);
    this.cityGroup.add(bldg);

    // Save collision bounding box
    const halfWidth = this.tileSize * 0.45;
    this.collisionBoxes.push(
      new THREE.Box3(
        new THREE.Vector3(pos.x - halfWidth, 0, pos.z - halfWidth),
        new THREE.Vector3(pos.x + halfWidth, 12, pos.z + halfWidth)
      )
    );

    this.buildingCells.push({ x, z, worldPos: pos.clone(), type: modelName });
  }

  // --- Parks, Trees & Greenery ---
  private buildParkCell(x: number, z: number, pos: THREE.Vector3) {
    const roll = Math.random();
    let modelName = 'grass';

    if (roll < 0.28) {
      modelName = 'tree_large';
    } else if (roll < 0.48) {
      modelName = 'tree_small';
    } else if (roll < 0.68) {
      modelName = 'grass_trees';
    } else if (roll < 0.82) {
      modelName = 'grass_trees_tall';
    } else if (roll < 0.90) {
      modelName = 'path_stones_long';
    }

    const parkMesh = CityModelLoader.getModel(modelName);
    parkMesh.position.copy(pos);
    parkMesh.scale.set(this.tileSize, this.tileSize, this.tileSize);
    this.cityGroup.add(parkMesh);
  }

  // --- Town Plazas & Fountains ---
  private buildPlazaCell(x: number, z: number, pos: THREE.Vector3) {
    const roll = Math.random();
    let modelName = 'pavement';

    if (roll < 0.12) {
      modelName = 'pavement_fountain';
    } else if (roll < 0.24) {
      modelName = 'planter';
    } else if (roll < 0.35) {
      modelName = 'tree_small';
    }

    const plazaMesh = CityModelLoader.getModel(modelName);
    plazaMesh.position.copy(pos);
    plazaMesh.scale.set(this.tileSize, this.tileSize, this.tileSize);
    this.cityGroup.add(plazaMesh);
  }

  // --- Residential Gardens & Green Yards ---
  private buildGrassCell(x: number, z: number, pos: THREE.Vector3) {
    const roll = Math.random();
    let modelName = 'grass';

    if (roll < 0.20) {
      modelName = 'tree_large';
    } else if (roll < 0.35) {
      modelName = 'planter';
    } else if (roll < 0.50) {
      modelName = 'path_stones_long';
    } else if (roll < 0.65) {
      modelName = 'grass_trees';
    }

    const grassMesh = CityModelLoader.getModel(modelName);
    grassMesh.position.copy(pos);
    grassMesh.scale.set(this.tileSize, this.tileSize, this.tileSize);
    this.cityGroup.add(grassMesh);
  }

  // --- Orientation solver: Building faces nearest street ---
  private getFacingRoadRotation(x: number, z: number): number {
    for (let dist = 1; dist < this.roadSpacing; dist++) {
      if (this.isRoad(x, z - dist)) return 0;
      if (this.isRoad(x + dist, z)) return Math.PI / 2;
      if (this.isRoad(x, z + dist)) return Math.PI;
      if (this.isRoad(x - dist, z)) return (3 * Math.PI) / 2;
    }
    return Math.floor(Math.random() * 4) * (Math.PI / 2);
  }

  // --- 7. Eastern Bay Water Ocean ---
  private buildBayWater() {
    const halfGrid = this.gridSize / 2;
    const bayStartX = (Math.floor(this.gridSize * 0.82) - halfGrid) * this.tileSize;
    const waterWidth = this.gridSize * 0.45 * this.tileSize;
    const waterLength = (this.gridSize + 10) * this.tileSize;

    const waterGeo = new THREE.PlaneGeometry(waterWidth, waterLength);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x1e88e5,
      roughness: 0.2,
      metalness: 0.4,
      transparent: true,
      opacity: 0.88,
    });
    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.rotation.x = -Math.PI / 2;
    waterMesh.position.set(bayStartX + waterWidth / 2, -0.05, 0);
    this.cityGroup.add(waterMesh);
  }

  // --- 8. Animated Pedestrians / NPCs ---
  private spawnPedestrians() {
    if (this.sidewalkCells.length === 0) return;

    const characterModels = [
      'character_male_a',
      'character_male_c',
      'character_female_a',
      'character_female_b',
    ];
    const names = ['Leo', 'Maya', 'Sam', 'Ella', 'Noah', 'Ruby', 'Oliver', 'Chloe'];

    const pedestrianCount = Math.min(10, Math.floor(this.sidewalkCells.length / 10));

    for (let i = 0; i < pedestrianCount; i++) {
      const startCell = this.sidewalkCells[Math.floor(Math.random() * this.sidewalkCells.length)];
      const modelKey = characterModels[i % characterModels.length];
      const modelGroup = CityModelLoader.getModel(modelKey);
      modelGroup.scale.set(1.1, 1.1, 1.1);

      // Create a 4-point patrol circuit along nearby sidewalks
      const waypoints: THREE.Vector3[] = [startCell.worldPos.clone()];
      for (let w = 1; w < 4; w++) {
        const nextCell = this.sidewalkCells[Math.floor(Math.random() * this.sidewalkCells.length)];
        waypoints.push(nextCell.worldPos.clone());
      }

      const pGroup = new THREE.Group();
      pGroup.position.copy(startCell.worldPos);
      pGroup.add(modelGroup);

      this.cityGroup.add(pGroup);

      this.pedestrians.push({
        group: pGroup,
        currentWaypoint: startCell.worldPos.clone(),
        targetWaypoint: waypoints[1],
        waypoints,
        waypointIndex: 1,
        speed: 1.6 + Math.random() * 0.8,
        walkTimer: Math.random() * 10,
        isWaving: false,
        waveTimer: 0,
        name: names[i % names.length],
      });
    }
  }

  // --- Update loop for pedestrians ---
  public updatePedestrians(delta: number, playerPos: THREE.Vector3) {
    for (const ped of this.pedestrians) {
      ped.walkTimer += delta;

      const toPlayer = new THREE.Vector3().subVectors(playerPos, ped.group.position);
      const distToPlayer = toPlayer.length();

      // If Oshu is close (under 3.5 units), wave happily!
      if (distToPlayer < 3.5) {
        ped.isWaving = true;
        ped.waveTimer += delta;
        // Turn to look at Oshu
        const lookAngle = Math.atan2(toPlayer.x, toPlayer.z);
        ped.group.rotation.y = lookAngle;
        // Cute playful wave bobbing
        ped.group.position.y = Math.abs(Math.sin(ped.waveTimer * 6)) * 0.15;
        continue;
      }

      ped.isWaving = false;

      // Patrol between waypoints
      const toTarget = new THREE.Vector3().subVectors(ped.targetWaypoint, ped.group.position);
      toTarget.y = 0;
      const distToTarget = toTarget.length();

      if (distToTarget < 0.3) {
        ped.waypointIndex = (ped.waypointIndex + 1) % ped.waypoints.length;
        ped.targetWaypoint = ped.waypoints[ped.waypointIndex];
      } else {
        toTarget.normalize();
        ped.group.position.x += toTarget.x * ped.speed * delta;
        ped.group.position.z += toTarget.z * ped.speed * delta;

        // Smooth rotation along movement direction
        const targetRot = Math.atan2(toTarget.x, toTarget.z);
        ped.group.rotation.y = targetRot;

        // Gentle walking bob
        ped.group.position.y = Math.abs(Math.sin(ped.walkTimer * 7)) * 0.08;
      }
    }
  }
}
