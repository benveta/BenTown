const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const root = path.join(__dirname, '..');
const maps = [
  ['DIFFUSE', 'asphalt-01-diffuse.png'],
  ['NORMAL', 'asphalt-01-normal-gl.png'],
  ['ROUGHNESS', 'asphalt-01-roughness.png'],
];
const width = 512;
const height = 512;
const outputLines = [];

for (const [name, filename] of maps) {
  const source = PNG.sync.read(fs.readFileSync(path.join(root, 'assets', 'realistic', 'materials', filename)));
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = ((y + 0.5) * source.height) / height - 0.5;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(source.height - 1, y0 + 1);
    const fy = Math.max(0, sy - y0);
    for (let x = 0; x < width; x++) {
      const sx = ((x + 0.5) * source.width) / width - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(source.width - 1, x0 + 1);
      const fx = Math.max(0, sx - x0);
      const out = (y * width + x) * 4;
      const p00 = (y0 * source.width + x0) * 4;
      const p10 = (y0 * source.width + x1) * 4;
      const p01 = (y1 * source.width + x0) * 4;
      const p11 = (y1 * source.width + x1) * 4;
      for (let channel = 0; channel < 4; channel++) {
        const top = source.data[p00 + channel] * (1 - fx) + source.data[p10 + channel] * fx;
        const bottom = source.data[p01 + channel] * (1 - fx) + source.data[p11 + channel] * fx;
        pixels[out + channel] = Math.round(top * (1 - fy) + bottom * fy);
      }
    }
  }
  outputLines.push(`export const CITY_ASPHALT_${name}_RGBA_BASE64 = '${pixels.toString('base64')}';`);
}

fs.writeFileSync(
  path.join(root, 'src', 'assets', 'cityAsphaltTextures.ts'),
  `export const CITY_ASPHALT_TEXTURE_WIDTH = ${width};\nexport const CITY_ASPHALT_TEXTURE_HEIGHT = ${height};\n${outputLines.join('\n')}\n`
);
console.log(`Wrote ${maps.length} ${width}x${height} asphalt maps.`);
