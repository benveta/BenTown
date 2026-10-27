const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const root = path.join(__dirname, '..');
const size = 512;

function resize(sourcePath) {
  const source = PNG.sync.read(fs.readFileSync(sourcePath));
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const sy = ((y + 0.5) * source.height) / size - 0.5;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(source.height - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < size; x++) {
      const sx = ((x + 0.5) * source.width) / size - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(source.width - 1, x0 + 1);
      const fx = sx - x0;
      const dst = (y * size + x) * 4;
      const a = (y0 * source.width + x0) * 4;
      const b = (y0 * source.width + x1) * 4;
      const c = (y1 * source.width + x0) * 4;
      const d = (y1 * source.width + x1) * 4;
      for (let channel = 0; channel < 4; channel++) {
        const top = source.data[a + channel] * (1 - fx) + source.data[b + channel] * fx;
        const bottom = source.data[c + channel] * (1 - fx) + source.data[d + channel] * fx;
        out[dst + channel] = Math.round(top * (1 - fy) + bottom * fy);
      }
    }
  }
  return out;
}

function normalMap(albedo, strength) {
  const out = Buffer.alloc(albedo.length);
  const heightAt = (x, y) => {
    const i = ((y + size) % size * size + (x + size) % size) * 4;
    return (albedo[i] * 0.299 + albedo[i + 1] * 0.587 + albedo[i + 2] * 0.114) / 255;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (heightAt(x + 1, y) - heightAt(x - 1, y)) * strength;
      const dy = (heightAt(x, y + 1) - heightAt(x, y - 1)) * strength;
      const nx = -dx;
      const ny = -dy;
      const invLength = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const i = (y * size + x) * 4;
      out[i] = Math.round((nx * invLength * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round((ny * invLength * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round((invLength * 0.5 + 0.5) * 255);
      out[i + 3] = 255;
    }
  }
  return out;
}

function roughnessMap(albedo, base) {
  const out = Buffer.alloc(albedo.length);
  for (let i = 0; i < albedo.length; i += 4) {
    const luminance = albedo[i] * 0.299 + albedo[i + 1] * 0.587 + albedo[i + 2] * 0.114;
    const roughness = Math.max(0, Math.min(255, base + (luminance - 96) * 0.08));
    out[i] = out[i + 1] = out[i + 2] = roughness;
    out[i + 3] = 255;
  }
  return out;
}

const sources = [
  ['BRICK', 'nyc-brownstone-brick-albedo-v2.png', 3.2, 224],
  ['ASPHALT', 'nyc-asphalt-albedo-v2.png', 1.5, 205],
];
const lines = [`export const PHOTO_CITY_TEXTURE_SIZE = ${size};`];
for (const [name, filename, normalStrength, roughness] of sources) {
  const albedo = resize(path.join(root, 'assets', 'realistic', 'materials', filename));
  lines.push(`export const PHOTO_${name}_ALBEDO_RGBA_BASE64 = '${albedo.toString('base64')}';`);
  lines.push(`export const PHOTO_${name}_NORMAL_RGBA_BASE64 = '${normalMap(albedo, normalStrength).toString('base64')}';`);
  lines.push(`export const PHOTO_${name}_ROUGHNESS_RGBA_BASE64 = '${roughnessMap(albedo, roughness).toString('base64')}';`);
}
const output = path.join(root, 'src', 'assets', 'photoCityTextures.ts');
fs.writeFileSync(output, `${lines.join('\n')}\n`);
console.log(`Packed ${sources.length} photoreal 512px albedo, normal, and roughness maps into ${output}`);
