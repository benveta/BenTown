const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const models = {
  femaleA: 'character-female-a.glb',
  femaleD: 'character-female-d.glb',
  maleA: 'character-male-a.glb',
  maleD: 'character-male-d.glb',
};

function embedCharacterTexture(glbPath) {
  const glb = fs.readFileSync(glbPath);
  const texturePath = path.join(root, 'assets', 'models', 'city', 'characters', 'Textures', 'colormap.png');
  const textureData = `data:image/png;base64,${fs.readFileSync(texturePath).toString('base64')}`;
  const jsonLength = glb.readUInt32LE(12);
  const jsonChunkType = glb.readUInt32LE(16);
  if (jsonChunkType !== 0x4e4f534a) throw new Error(`Expected a GLB JSON chunk: ${glbPath}`);
  const json = JSON.parse(glb.toString('utf8', 20, 20 + jsonLength));
  json.images?.forEach((image) => {
    if (image.uri?.endsWith('Textures/colormap.png')) image.uri = textureData;
  });

  const jsonBytes = Buffer.from(JSON.stringify(json));
  const paddedJsonLength = (jsonBytes.length + 3) & ~3;
  const paddedJson = Buffer.alloc(paddedJsonLength, 0x20);
  jsonBytes.copy(paddedJson);
  const rest = glb.subarray(20 + jsonLength);
  const output = Buffer.alloc(12 + 8 + paddedJson.length + rest.length);
  output.writeUInt32LE(0x46546c67, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(paddedJson.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  paddedJson.copy(output, 20);
  rest.copy(output, 20 + paddedJson.length);
  return output;
}

const lines = Object.entries(models).map(([key, filename]) => {
  const source = path.join(root, 'assets', 'models', 'city', 'characters', filename);
  return `  ${key}: '${embedCharacterTexture(source).toString('base64')}',`;
});

const output = path.join(root, 'src', 'assets', 'cityNpcModelsBase64.ts');
fs.writeFileSync(output, `export const CITY_NPC_MODELS_BASE64 = {\n${lines.join('\n')}\n} as const;\n`);
console.log(`Packed ${Object.keys(models).length} animated pedestrian GLBs into ${output}`);
