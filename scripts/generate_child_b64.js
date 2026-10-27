const fs = require('fs');
const path = require('path');

const srcGlb = path.join(__dirname, '..', 'assets', 'models', 'child_3d_model.glb');
const targetTs = path.join(__dirname, '..', 'src', 'assets', 'childModelBase64.ts');

const buf = fs.readFileSync(srcGlb);
const b64 = buf.toString('base64');

fs.mkdirSync(path.dirname(targetTs), { recursive: true });
fs.writeFileSync(targetTs, `export const CHILD_MODEL_BASE64 = "${b64}";\n`);
console.log('Successfully generated childModelBase64.ts, size:', b64.length);
