import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CHILD_MODEL_BASE64 } from '../assets/childModelBase64';
import { OshuCustomization } from '../types/game';

type CharacterMaterials = {
  hair: THREE.MeshStandardMaterial[];
  skin: THREE.MeshStandardMaterial[];
  shirt: THREE.MeshStandardMaterial[];
  pants: THREE.MeshStandardMaterial[];
  shoes: THREE.MeshStandardMaterial[];
};

export class ChildHeadLoader {
  private static materials: CharacterMaterials = {
    hair: [],
    skin: [],
    shirt: [],
    pants: [],
    shoes: [],
  };
  private static customization: OshuCustomization | null = null;

  public static createChildCharacter(
    customization: OshuCustomization,
    onLoaded: () => void
  ): THREE.Group {
    const characterRoot = new THREE.Group();
    characterRoot.visible = false;
    this.customization = customization;

    try {
      const binaryString = atob(CHILD_MODEL_BASE64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const loader = new GLTFLoader();
      loader.parse(
        bytes.buffer,
        '',
        (gltf) => {
          this.materials = { hair: [], skin: [], shirt: [], pants: [], shoes: [] };

          gltf.scene.traverse((object) => {
            if (!(object instanceof THREE.Mesh)) return;

            const name = object.name.toLowerCase();
            const material = this.createMaterialForPart(name);
            if (material) object.material = material;
          });

          // The source GLB is Z-up and its face points toward -Y. A single
          // axis conversion maps that direction to the game's forward +Z.
          const upAxisGroup = new THREE.Group();
          upAxisGroup.rotation.x = -Math.PI / 2;
          upAxisGroup.scale.setScalar(0.58);
          upAxisGroup.add(gltf.scene);
          characterRoot.add(upAxisGroup);

          characterRoot.visible = true;
          this.updateCustomization(this.customization || customization);
          onLoaded();
        },
        (error) => {
          console.warn('Failed to parse child character GLB', error);
        }
      );
    } catch (error) {
      console.warn('Failed to load child character GLB', error);
    }

    return characterRoot;
  }

  public static updateCustomization(customization: OshuCustomization) {
    this.customization = customization;
    this.materials.hair.forEach((material) => material.color.set(customization.hairColor));
    this.materials.shirt.forEach((material) => material.color.set(customization.shirtColor));
    this.materials.pants.forEach((material) => material.color.set(customization.pantsColor));
    this.materials.shoes.forEach((material) => material.color.set(customization.shoesColor));
  }

  private static createMaterialForPart(name: string): THREE.MeshStandardMaterial | null {
    const material = new THREE.MeshStandardMaterial({ roughness: 0.78 });

    if (name.includes('hair') || name.includes('fringe')) {
      this.materials.hair.push(material);
      return material;
    }
    if (name.includes('eye_white') || name.includes('glint')) {
      material.color.set('#FFFFFF');
      material.roughness = 0.3;
      return material;
    }
    if (name.includes('iris') || name.includes('pupil')) {
      material.color.set('#2A1B15');
      material.roughness = 0.32;
      return material;
    }
    if (name.includes('brow')) {
      material.color.set('#241B18');
      return material;
    }
    if (name.includes('smile') || name.includes('lip') || name.includes('nostril')) {
      material.color.set('#70433D');
      material.roughness = 0.85;
      return material;
    }
    if (name.includes('cheek')) {
      material.color.set('#A96858');
      material.roughness = 0.9;
      material.transparent = true;
      material.opacity = 0.38;
      return material;
    }
    if (name.includes('shirt_print')) {
      material.color.set('#F4F7F8');
      material.roughness = 0.6;
      return material;
    }
    if (name.includes('shirt') || name.includes('sleeve')) {
      this.materials.shirt.push(material);
      return material;
    }
    if (name.includes('shoe')) {
      this.materials.shoes.push(material);
      return material;
    }
    if (name.includes('leg')) {
      this.materials.pants.push(material);
      return material;
    }
    if (
      name.includes('head') || name.includes('ear') || name.includes('neck') ||
      name.includes('arm') || name.includes('hand')
    ) {
      material.color.set('#B7775C');
      this.materials.skin.push(material);
      return material;
    }

    return null;
  }
}
