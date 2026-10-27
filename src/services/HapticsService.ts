import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

class HapticsService {
  private enabled: boolean = true;

  public setEnabled(val: boolean) {
    this.enabled = val;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public light() {
    if (!this.enabled || Platform.OS === 'web') return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      // Ignored if device does not support haptics
    }
  }

  public medium() {
    if (!this.enabled || Platform.OS === 'web') return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}
  }

  public heavy() {
    if (!this.enabled || Platform.OS === 'web') return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    } catch {}
  }

  public success() {
    if (!this.enabled || Platform.OS === 'web') return;
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {}
  }

  public selection() {
    if (!this.enabled || Platform.OS === 'web') return;
    try {
      Haptics.selectionAsync();
    } catch {}
  }
}

export const haptics = new HapticsService();
