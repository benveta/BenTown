import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

const READ_TIMEOUT_MS = 20000;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out reading ${label}`)), READ_TIMEOUT_MS);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

/**
 * Reads a bundled binary asset (GLB model, raw RGBA texture) as an ArrayBuffer.
 *
 * Assets live as separate files in the app bundle instead of base64 strings inside the JS bundle.
 * On iOS/Android the bytes are read natively with expo-file-system (React Native's
 * `fetch(...).arrayBuffer()` is not reliable for local files); the web uses fetch.
 * Every read has a timeout so a stall surfaces as an error message instead of an endless spinner.
 */
export async function loadBinaryAsset(module: number): Promise<ArrayBuffer> {
  const asset = Asset.fromModule(module);
  const label = asset.name || String(module);
  if (!asset.localUri) await withTimeout(asset.downloadAsync(), `${label} (download)`);
  const uri = asset.localUri ?? asset.uri;

  if (Platform.OS !== 'web' && uri.startsWith('file:')) {
    const bytes = await withTimeout(new File(uri).bytes(), label);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }
  const response = await withTimeout(fetch(uri), `${label} (fetch)`);
  return withTimeout(response.arrayBuffer(), `${label} (bytes)`);
}
