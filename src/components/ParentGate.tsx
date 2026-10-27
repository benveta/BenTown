import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  Modal, 
  TouchableOpacity, 
  Switch, 
  Animated 
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ParentSettings } from '../services/StorageService';
import { audio } from '../services/AudioService';

interface ParentGateProps {
  visible: boolean;
  settings: ParentSettings;
  onUpdateSettings: (settings: ParentSettings) => void;
  onResetPosition: () => void;
  onClose: () => void;
}

export const ParentGate: React.FC<ParentGateProps> = ({
  visible,
  settings,
  onUpdateSettings,
  onResetPosition,
  onClose,
}) => {
  const [unlocked, setUnlocked] = useState(false);
  const [progressAnim] = useState(() => new Animated.Value(0));

  const startHold = () => {
    progressAnim.setValue(0);
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: 3000,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) {
        setUnlocked(true);
      }
    });
  };

  const cancelHold = () => {
    progressAnim.stopAnimation();
    progressAnim.setValue(0);
  };

  const handleClose = () => {
    setUnlocked(false);
    progressAnim.setValue(0);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Parental Controls</Text>
            <TouchableOpacity onPress={handleClose}>
              <Ionicons name="close-circle" size={32} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          {!unlocked ? (
            <View style={styles.lockContainer}>
              <Text style={styles.lockInstruction}>
                Press and hold the button for 3 seconds to unlock parent settings:
              </Text>

              <TouchableOpacity
                style={styles.holdBtn}
                activeOpacity={0.9}
                onPressIn={startHold}
                onPressOut={cancelHold}
              >
                <Animated.View
                  style={[
                    styles.progressBar,
                    {
                      width: progressAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0%', '100%'],
                      }),
                    },
                  ]}
                />
                <Text style={styles.holdBtnText}>Hold to Unlock 🔒</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.settingsContainer}>
              {/* Sound Effects Toggle */}
              <View style={styles.settingRow}>
                <View style={styles.settingTextCol}>
                  <Text style={styles.settingLabel}>Sound Effects (SFX)</Text>
                  <Text style={styles.settingDesc}>Pops, bounces, horns & chimes</Text>
                </View>
                <Switch
                  value={settings.soundEnabled}
                  onValueChange={(val) => {
                    audio.setSoundEnabled(val);
                    onUpdateSettings({ ...settings, soundEnabled: val });
                  }}
                  trackColor={{ false: '#CBD5E1', true: '#38BDF8' }}
                />
              </View>

              {/* Speech Toggle */}
              <View style={styles.settingRow}>
                <View style={styles.settingTextCol}>
                  <Text style={styles.settingLabel}>Oshu’s Guide Voice</Text>
                  <Text style={styles.settingDesc}>{audio.getSpeechVoiceDescription()}</Text>
                </View>
                <Switch
                  value={settings.speechEnabled}
                  onValueChange={(val) => {
                    audio.setSpeechEnabled(val);
                    onUpdateSettings({ ...settings, speechEnabled: val });
                  }}
                  trackColor={{ false: '#CBD5E1', true: '#38BDF8' }}
                />
              </View>

              <TouchableOpacity
                style={[styles.voicePreviewBtn, !settings.speechEnabled && styles.voicePreviewDisabled]}
                activeOpacity={0.8}
                disabled={!settings.speechEnabled}
                onPress={() => audio.speak('Hi Oshu! I’m right here. Shall we explore this part of Ben Town together?')}
              >
                <Ionicons name="volume-high-outline" size={17} color="#173431" />
                <Text style={styles.voicePreviewText}>PREVIEW OSHU’S GUIDE</Text>
              </TouchableOpacity>

              {/* Background Music Toggle */}
              <View style={styles.settingRow}>
                <View style={styles.settingTextCol}>
                  <Text style={styles.settingLabel}>Nursery Melody (BGM)</Text>
                  <Text style={styles.settingDesc}>Gentle soothing background lullaby</Text>
                </View>
                <Switch
                  value={settings.musicEnabled}
                  onValueChange={(val) => {
                    audio.setMusicEnabled(val);
                    onUpdateSettings({ ...settings, musicEnabled: val });
                  }}
                  trackColor={{ false: '#CBD5E1', true: '#38BDF8' }}
                />
              </View>

              {/* Reset Oshu to Central Plaza */}
              <TouchableOpacity
                style={styles.resetBtn}
                activeOpacity={0.8}
                onPress={() => {
                  onResetPosition();
                  handleClose();
                }}
              >
                <Ionicons name="refresh" size={20} color="#FFFFFF" />
                <Text style={styles.resetText}>Return Oshu to Center Plaza</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    width: '100%',
    maxWidth: 440,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
    color: '#0F172A',
  },
  lockContainer: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  lockInstruction: {
    fontSize: 15,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 22,
  },
  holdBtn: {
    width: '100%',
    height: 54,
    backgroundColor: '#F1F5F9',
    borderRadius: 27,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#CBD5E1',
  },
  progressBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#38BDF8',
  },
  holdBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#334155',
  },
  settingsContainer: {
    paddingVertical: 8,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  settingTextCol: {
    flex: 1,
    paddingRight: 12,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E293B',
  },
  settingDesc: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
  },
  voicePreviewBtn: {
    minHeight: 40,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#e9f0e7',
    borderColor: '#d2dfd0',
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 10,
    gap: 8,
  },
  voicePreviewText: {
    color: '#173431',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  voicePreviewDisabled: {
    opacity: 0.45,
  },
  resetBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#3B82F6',
    borderRadius: 16,
    paddingVertical: 14,
    marginTop: 20,
  },
  resetText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
    marginLeft: 8,
  },
});
