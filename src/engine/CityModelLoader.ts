import * as THREE from 'three';

/**
 * Compatibility fallback for the unused legacy city generator. The active
 * open-world scene is assembled by RealisticCityBuilder and loads no Kenney GLBs.
 */
export class CityModelLoader {
  private static sharedMaterial: THREE.MeshStandardMaterial | null = null;

  public static async preloadAll(): Promise<void> {
    // Kept for older callers; the realistic scene uses generated PBR textures.
  }

  public static getSharedMaterial(): THREE.MeshStandardMaterial {
    if (!this.sharedMaterial) {
      this.sharedMaterial = new THREE.MeshStandardMaterial({ color: 0x777c7c, roughness: 0.82 });
    }
    return this.sharedMaterial;
  }

  public static getModel(name: string): THREE.Group {
    const group = new THREE.Group();
    group.name = `legacy-fallback-${name}`;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.getSharedMaterial());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return group;
  }
}
