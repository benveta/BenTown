import AsyncStorage from '@react-native-async-storage/async-storage';
import { OshuCustomization } from '../types/game';

const OSHU_CUSTOMIZATION_KEY = '@bentown_oshu_customization';
const PARENT_SETTINGS_KEY = '@bentown_parent_settings';

export const DEFAULT_CUSTOMIZATION: OshuCustomization = {
  shirtColor: '#168FBE', // Match Oshu's blue T-shirt
  hairColor: '#171719',
  pantsColor: '#344B60',
  shoesColor: '#FFFFFF', // Clean white sneakers
};

export interface ParentSettings {
  soundEnabled: boolean;
  speechEnabled: boolean;
  musicEnabled: boolean;
}

export const DEFAULT_PARENT_SETTINGS: ParentSettings = {
  soundEnabled: true,
  speechEnabled: true,
  musicEnabled: true,
};

class StorageService {
  public async loadCustomization(): Promise<OshuCustomization> {
    try {
      const data = await AsyncStorage.getItem(OSHU_CUSTOMIZATION_KEY);
      if (data) {
        const saved = JSON.parse(data) as Partial<OshuCustomization> & { hatColor?: string };
        return {
          shirtColor: saved.shirtColor || DEFAULT_CUSTOMIZATION.shirtColor,
          hairColor: saved.hairColor || (saved.hatColor === '#FF4757' ? undefined : saved.hatColor) || DEFAULT_CUSTOMIZATION.hairColor,
          pantsColor: saved.pantsColor || DEFAULT_CUSTOMIZATION.pantsColor,
          shoesColor: saved.shoesColor || DEFAULT_CUSTOMIZATION.shoesColor,
        };
      }
    } catch (e) {
      console.warn('Failed to load customization', e);
    }
    return DEFAULT_CUSTOMIZATION;
  }

  public async saveCustomization(customization: OshuCustomization): Promise<void> {
    try {
      await AsyncStorage.setItem(OSHU_CUSTOMIZATION_KEY, JSON.stringify(customization));
    } catch (e) {
      console.warn('Failed to save customization', e);
    }
  }

  public async loadParentSettings(): Promise<ParentSettings> {
    try {
      const data = await AsyncStorage.getItem(PARENT_SETTINGS_KEY);
      if (data) {
        return JSON.parse(data);
      }
    } catch (e) {
      console.warn('Failed to load parent settings', e);
    }
    return DEFAULT_PARENT_SETTINGS;
  }

  public async saveParentSettings(settings: ParentSettings): Promise<void> {
    try {
      await AsyncStorage.setItem(PARENT_SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      console.warn('Failed to save parent settings', e);
    }
  }
}

export const storage = new StorageService();
