/* Static require() map for assets/bin (Metro needs literal paths). */
export const TEXTURE_FILES = {
  asphaltAlbedo: require('../../assets/bin/asphalt-albedo.bin'),
  asphaltNormal: require('../../assets/bin/asphalt-normal.bin'),
  asphaltRoughness: require('../../assets/bin/asphalt-roughness.bin'),
  brickAlbedo: require('../../assets/bin/brick-albedo.bin'),
  brickNormal: require('../../assets/bin/brick-normal.bin'),
  brickRoughness: require('../../assets/bin/brick-roughness.bin'),
  officeFacade: require('../../assets/bin/office-facade.bin'),
  stucco: require('../../assets/bin/stucco.bin'),
  bodega: require('../../assets/bin/bodega.bin'),
  envCity: require('../../assets/bin/env-city.bin'),
  envDusk: require('../../assets/bin/env-dusk.bin'),
  envMountain: require('../../assets/bin/env-mountain.bin'),
  envFuelStop: require('../../assets/bin/env-fuel-stop.bin'),
} as const;

export const FACADE_FILES: number[] = [
  require('../../assets/bin/facade-0.bin'),
  require('../../assets/bin/facade-1.bin'),
  require('../../assets/bin/facade-2.bin'),
  require('../../assets/bin/facade-3.bin'),
  require('../../assets/bin/facade-4.bin'),
  require('../../assets/bin/facade-5.bin'),
  require('../../assets/bin/facade-6.bin'),
  require('../../assets/bin/facade-7.bin'),
  require('../../assets/bin/facade-8.bin'),
  require('../../assets/bin/facade-9.bin'),
  require('../../assets/bin/facade-10.bin'),
  require('../../assets/bin/facade-11.bin'),
];

export const CHILD_MODEL_FILE: number = require('../../assets/bin/child.glb');

export const VEHICLE_MODEL_FILES = {
  sedan: require('../../assets/bin/vehicle-sedan.glb'),
  suv: require('../../assets/bin/vehicle-suv.glb'),
  'delivery-van': require('../../assets/bin/vehicle-delivery-van.glb'),
  pickup: require('../../assets/bin/vehicle-pickup.glb'),
  'city-bus': require('../../assets/bin/vehicle-city-bus.glb'),
} as const;

export const NPC_MODEL_FILES = {
  femaleA: require('../../assets/bin/npc-femaleA.glb'),
  femaleD: require('../../assets/bin/npc-femaleD.glb'),
  maleA: require('../../assets/bin/npc-maleA.glb'),
  maleD: require('../../assets/bin/npc-maleD.glb'),
} as const;
