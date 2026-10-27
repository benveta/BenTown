const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function decodePngToRgba(filePath) {
  const buf = fs.readFileSync(filePath);
  let offset = 8;
  let idatBuffers = [];
  let width, height;

  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    if (type === 'IHDR') {
      width = buf.readUInt32BE(offset + 8);
      height = buf.readUInt32BE(offset + 12);
    } else if (type === 'IDAT') {
      idatBuffers.push(buf.subarray(offset + 8, offset + 8 + len));
    }
    offset += 12 + len;
  }

  const raw = zlib.inflateSync(Buffer.concat(idatBuffers));
  const bpp = 4;
  const stride = width * bpp;
  const rgba = Buffer.alloc(width * height * 4);

  let rawOff = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rawOff++];
    const lineStart = y * stride;
    const prevLineStart = (y - 1) * stride;

    for (let x = 0; x < stride; x++) {
      const val = raw[rawOff++];
      const a = x >= bpp ? rgba[lineStart + x - bpp] : 0;
      const b = y > 0 ? rgba[prevLineStart + x] : 0;
      const c = (x >= bpp && y > 0) ? rgba[prevLineStart + x - bpp] : 0;

      let unfiltered = val;
      if (filter === 0) {
        unfiltered = val;
      } else if (filter === 1) {
        unfiltered = (val + a) & 0xff;
      } else if (filter === 2) {
        unfiltered = (val + b) & 0xff;
      } else if (filter === 3) {
        unfiltered = (val + Math.floor((a + b) / 2)) & 0xff;
      } else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        let pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
        unfiltered = (val + pr) & 0xff;
      }
      rgba[lineStart + x] = unfiltered;
    }
  }

  return rgba;
}

const inputPath = path.join(__dirname, '..', 'openworld-main', 'city', 'models', 'Textures', 'colormap.png');
const outputPath = path.join(__dirname, '..', 'src', 'assets', 'colormapRgbaBase64.ts');

const rgba = decodePngToRgba(inputPath);
const b64 = rgba.toString('base64');
fs.writeFileSync(outputPath, `export const COLORMAP_RGBA_BASE64 = "${b64}";\n`);
console.log('Successfully written colormapRgbaBase64.ts, size:', b64.length);
