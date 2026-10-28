import { Asset } from 'expo-asset';

/**
 * Reads a bundled binary asset (GLB model, raw RGBA texture) as an
 * ArrayBuffer. Assets live as separate files in the app bundle instead of
 * base64 strings inside the JS bundle, so startup no longer has to parse and
 * decode tens of megabytes of text.
 */
export async function loadBinaryAsset(module: number): Promise<ArrayBuffer> {
  const asset = Asset.fromModule(module);
  if (!asset.localUri) await asset.downloadAsync();
  const response = await fetch(asset.localUri ?? asset.uri);
  return response.arrayBuffer();
}
