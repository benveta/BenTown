import { Asset } from 'expo-asset';
import { Platform } from 'react-native';

const ATTEMPT_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out (${label})`)), ATTEMPT_TIMEOUT_MS);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

/** Decodes a base64 string into bytes without relying on `atob` being present. */
function base64ToBuffer(base64: string): ArrayBuffer {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(128);
  for (let i = 0; i < table.length; i++) lookup[table.charCodeAt(i)] = i;
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let out = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = lookup[clean.charCodeAt(i)];
    const b = lookup[clean.charCodeAt(i + 1)];
    const c = lookup[clean.charCodeAt(i + 2)];
    const d = lookup[clean.charCodeAt(i + 3)];
    bytes[out++] = (a << 2) | (b >> 4);
    if (i + 2 < clean.length) bytes[out++] = ((b & 15) << 4) | (c >> 2);
    if (i + 3 < clean.length) bytes[out++] = ((c & 3) << 6) | d;
  }
  return bytes.buffer.slice(0, out) as ArrayBuffer;
}

const strategies: { name: string; read: (uri: string) => Promise<ArrayBuffer> }[] = [
  { name: 'fetch-arraybuffer', read: (uri) => fetch(uri).then((response) => response.arrayBuffer()) },
  {
    name: 'xhr-arraybuffer',
    read: (uri) => new Promise<ArrayBuffer>((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.responseType = 'arraybuffer';
      request.onload = () => (request.response ? resolve(request.response as ArrayBuffer) : reject(new Error('empty response')));
      request.onerror = () => reject(new Error('xhr error'));
      request.open('GET', uri);
      request.send();
    }),
  },
  {
    name: 'fetch-blob-dataurl',
    read: (uri) => fetch(uri).then((response) => response.blob()).then((blob) => new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(base64ToBuffer(String(reader.result).split(',')[1] ?? ''));
      reader.onerror = () => reject(new Error('FileReader error'));
      reader.readAsDataURL(blob);
    })),
  },
];

// Once a strategy works on this device, every later read starts with it.
let preferred = 0;

/**
 * Reads a bundled binary asset (GLB model, raw RGBA texture) as an ArrayBuffer.
 *
 * Assets are separate files in the app bundle (not base64 inside the JS bundle). React Native's
 * support for reading local files differs between versions, so several strategies are tried, each
 * with a timeout; if all fail the error lists what each one reported, so a stall becomes a readable
 * message instead of an endless spinner. This module imports no extra native modules.
 */
export async function loadBinaryAsset(module: number): Promise<ArrayBuffer> {
  const asset = Asset.fromModule(module);
  const label = asset.name || String(module);
  if (!asset.localUri) await withTimeout(asset.downloadAsync(), `${label} download`);
  const uri = asset.localUri ?? asset.uri;

  const order = Platform.OS === 'web' ? [0] : strategies.map((_, i) => (i + preferred) % strategies.length);
  const failures: string[] = [];
  for (const index of order) {
    try {
      const buffer = await withTimeout(strategies[index].read(uri), strategies[index].name);
      if (buffer && buffer.byteLength > 0) {
        preferred = index;
        return buffer;
      }
      failures.push(`${strategies[index].name}: empty`);
    } catch (error) {
      failures.push(`${strategies[index].name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Could not read ${label} — ${failures.join('; ')}`);
}
