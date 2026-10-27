const fs = require('fs');
const path = require('path');

const cityDir = path.join(__dirname, '..', 'openworld-main', 'city', 'models');
const targetTs = path.join(__dirname, '..', 'src', 'assets', 'cityModelsBase64.ts');
const colormapPath = path.join(cityDir, 'Textures', 'colormap.png');

function findGlbFiles(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(prefix, entry.name);
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findGlbFiles(fullPath, relativePath);
    return entry.isFile() && entry.name.toLowerCase().endsWith('.glb') ? [relativePath] : [];
  });
}

const files = findGlbFiles(cityDir).sort();
const obj = {};
for (const relativePath of files) {
  const filePath = path.join(cityDir, relativePath);
  const key = relativePath.replace(/\.glb$/i, '').replace(/[\\/]/g, '_').replace(/-/g, '_');
  obj[key] = fs.readFileSync(filePath).toString('base64');
  console.log(`Loaded ${relativePath} (${obj[key].length} chars)`);
}

// Preserve the names used by the original BenTown scene code while reading
// all source geometry from openworld-main/city/models.
const aliases = {
  building_skyscraper_a: 'commercial_building_skyscraper_a',
  building_skyscraper_b: 'commercial_building_skyscraper_b',
  building_skyscraper_c: 'commercial_building_skyscraper_c',
  building_skyscraper_d: 'commercial_building_skyscraper_d',
  building_skyscraper_e: 'commercial_building_skyscraper_e',
  building_type_a: 'suburban_building_type_a',
  suburban_type_a: 'suburban_building_type_a',
  suburban_type_b: 'suburban_building_type_b',
  suburban_type_c: 'suburban_building_type_c',
  suburban_type_d: 'suburban_building_type_d',
  suburban_type_e: 'suburban_building_type_e',
  suburban_type_f: 'suburban_building_type_f',
  suburban_type_g: 'suburban_building_type_g',
  suburban_type_h: 'suburban_building_type_h',
  character_female_a: 'characters_character_female_a',
  character_female_b: 'characters_character_female_b',
  character_male_a: 'characters_character_male_a',
  character_male_c: 'characters_character_male_c',
  detail_awning: 'commercial_detail_awning',
  detail_awning_wide: 'commercial_detail_awning_wide',
  detail_tank: 'industrial_detail_tank',
  fence: 'suburban_fence',
  fence_low: 'suburban_fence_low',
  path_stones_long: 'suburban_path_stones_long',
  planter: 'suburban_planter',
  tree_large: 'suburban_tree_large',
  tree_small: 'suburban_tree_small',
};
for (const [alias, sourceKey] of Object.entries(aliases)) {
  if (!obj[sourceKey]) throw new Error(`Alias ${alias} points to missing model ${sourceKey}`);
}

let colormapB64 = '';
if (fs.existsSync(colormapPath)) {
  colormapB64 = fs.readFileSync(colormapPath).toString('base64');
  console.log('Loaded colormap.png, length:', colormapB64.length);
}

const content = `export const CITY_MODELS_BASE64: Record<string, string> = ${JSON.stringify(obj, null, 2)};\nexport const CITY_MODEL_ALIASES: Record<string, string> = ${JSON.stringify(aliases, null, 2)};\nexport const COLORMAP_BASE64: string = "${colormapB64}";\n`;
fs.writeFileSync(targetTs, content);
console.log(`Successfully generated cityModelsBase64.ts with ${files.length} GLBs and ${Object.keys(aliases).length} aliases.`);
