import React, { useCallback, useEffect, useRef, useState } from 'react';
import { 
  View, 
  StyleSheet, 
  StatusBar, 
  Pressable,
  TouchableOpacity, 
  Dimensions, 
  GestureResponderEvent,
  ActivityIndicator,
  Text,
} from 'react-native';
import { GLView, ExpoWebGLRenderingContext } from 'expo-gl';
import { Ionicons } from '@expo/vector-icons';
import { GameEngine } from '../engine/GameEngine';
import { ToddlerDPad } from './ToddlerDPad';
import { ActionButton } from './ActionButton';
import { ZoneNavBar } from './ZoneNavBar';
import { SpeechBubbleHUD } from './SpeechBubbleHUD';
import { MiniMapHUD } from './MiniMapHUD';
import { WardrobeModal } from './WardrobeModal';
import { ParentGate } from './ParentGate';
import { 
  InteractiveTarget, 
  OshuCustomization, 
  SpeechMessage 
} from '../types/game';
import { 
  storage, 
  DEFAULT_CUSTOMIZATION, 
  DEFAULT_PARENT_SETTINGS, 
  ParentSettings 
} from '../services/StorageService';
import { audio } from '../services/AudioService';

export const GameScreen: React.FC = () => {
  const engineRef = useRef<GameEngine | null>(null);

  // States
  const [customization, setCustomization] = useState<OshuCustomization>(DEFAULT_CUSTOMIZATION);
  const [parentSettings, setParentSettings] = useState<ParentSettings>(DEFAULT_PARENT_SETTINGS);
  const [currentTarget, setCurrentTarget] = useState<InteractiveTarget | null>(null);
  const [speechMsg, setSpeechMsg] = useState<SpeechMessage | null>(null);
  const [isDriving, setIsDriving] = useState<boolean>(false);
  const [isAutoDrive, setIsAutoDrive] = useState(false);
  const [wardrobeVisible, setWardrobeVisible] = useState<boolean>(false);
  const [parentGateVisible, setParentGateVisible] = useState<boolean>(false);
  const [isWorldReady, setIsWorldReady] = useState(false);
  const [worldError, setWorldError] = useState<string | null>(null);
  const [canvasKey, setCanvasKey] = useState(0);
  const [mapPosition, setMapPosition] = useState({ x: 0, z: 0, heading: 0 });

  useEffect(() => {
    (async () => {
      const savedCustom = await storage.loadCustomization();
      const savedSettings = await storage.loadParentSettings();
      setCustomization(savedCustom);
      engineRef.current?.updateCustomization(savedCustom);
      setParentSettings(savedSettings);

      audio.setSoundEnabled(savedSettings.soundEnabled);
      audio.setSpeechEnabled(savedSettings.speechEnabled);
      audio.setMusicEnabled(savedSettings.musicEnabled);
    })();

    return () => {
      if (engineRef.current) {
        engineRef.current.stop();
      }
    };
  }, []);

  useEffect(() => {
    if (!isWorldReady) return;
    const timer = setInterval(() => {
      const character = engineRef.current?.character;
      if (!character) return;
      setMapPosition({
        x: character.position.x,
        z: character.position.z,
        heading: character.rotationY,
      });
    }, 250);
    return () => clearInterval(timer);
  }, [isWorldReady]);

  const onContextCreate = async (gl: ExpoWebGLRenderingContext) => {
    const engine = new GameEngine(gl, customization);
    engineRef.current = engine;
    setIsWorldReady(false);
    setWorldError(null);

    engine.onTargetChange = (target) => {
      setCurrentTarget(target);
    };

    engine.onSpeechMessage = (msg) => {
      setSpeechMsg(msg);
    };

    engine.onOpenWardrobe = () => {
      setWardrobeVisible(true);
    };

    engine.onVehicleChange = (driving) => {
      setIsDriving(driving);
      if (!driving) setIsAutoDrive(false);
    };

    let startupStage = 'building the town';
    try {
      await engine.initWorld();
      startupStage = 'rendering the first frame';
      engine.start();
      setIsWorldReady(true);
    } catch (error) {
      console.error('[GameScreen] Open-world startup failed:', error);
      engine.stop();
      const message = error instanceof Error ? error.message : 'The town could not be loaded.';
      setWorldError(`${startupStage}: ${message}`);
    }
  };

  const retryWorldLoad = () => {
    engineRef.current?.stop();
    engineRef.current = null;
    setWorldError(null);
    setIsWorldReady(false);
    setCanvasKey((key) => key + 1);
  };

  // Movement handlers from Toddler D-Pad
  const handleJoystickMove = useCallback((vector: { x: number; y: number }) => {
    if (engineRef.current) {
      engineRef.current.setJoystickVector(vector);
    }
  }, []);

  const handleJoystickRelease = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.setJoystickVector(null);
    }
  }, []);

  const handleDismissSpeech = useCallback(() => setSpeechMsg(null), []);

  // Screen Tap-to-walk and Direct Tap-to-Interact
  const handleScreenTouch = (evt: GestureResponderEvent) => {
    const { pageX, pageY } = evt.nativeEvent;
    const { width, height } = Dimensions.get('window');

    // Ignore touches within the D-Pad corner (bottom-left)
    if (pageX < 270 && pageY > height - 145) return;

    // Ignore touches within the Action Button corner (bottom-right)
    if (pageX > width - 140 && pageY > height - 140) return;

    // Ignore touches within the Top Navigation Bar or Settings button
    if (pageY < 70) return;

    // Convert to normalized coordinates [-1, 1]
    const normX = (pageX / width) * 2 - 1;
    const normY = -(pageY / height) * 2 + 1;

    if (engineRef.current) {
      engineRef.current.handleTap(normX, normY);
    }
  };

  // Zone Navigation
  const handleSelectZone = (zoneId: string) => {
    if (engineRef.current) {
      engineRef.current.navigateToZone(zoneId);
    }
  };

  // Wardrobe changes
  const handleUpdateCustomization = (updated: OshuCustomization) => {
    setCustomization(updated);
    storage.saveCustomization(updated);
    if (engineRef.current) {
      engineRef.current.updateCustomization(updated);
    }
  };

  // Parent settings
  const handleUpdateParentSettings = (updated: ParentSettings) => {
    setParentSettings(updated);
    storage.saveParentSettings(updated);
  };

  // Reset character
  const handleResetPosition = () => {
    if (engineRef.current) {
      if (engineRef.current.isDriving) {
        engineRef.current.exitVehicle();
      }
      engineRef.current.character.position.set(0, 0, 0);
      engineRef.current.character.velocity.set(0, 0, 0);
      engineRef.current.character.targetDestination = null;
      audio.speak('Welcome back to the Town Square, Oshu!');
    }
  };

  const districtName = mapPosition.x < -24 && mapPosition.z > 0
    ? 'MOUNTAIN PASS'
    : mapPosition.x > 28 && mapPosition.z > 8
      ? 'FUEL STOP'
      : mapPosition.x > 28 && mapPosition.z < -16
        ? 'BEN TOWN MALL'
        : mapPosition.z > 28 && Math.abs(mapPosition.x) < 20
          ? 'NIGHT DISTRICT'
          : mapPosition.x < -20 && mapPosition.z < -10
            ? 'SUBURBS'
            : 'CITY CENTER';

  return (
    <View style={styles.container}>
      <StatusBar hidden />

      {/* 3D WebGL Canvas with Touch Handling */}
      <GLView
        key={canvasKey}
        style={styles.glView}
        onContextCreate={onContextCreate}
        onTouchEnd={handleScreenTouch}
      />

      <View style={styles.worldStatus} pointerEvents="none">
        <View style={styles.statusIcon}>
          <Ionicons name="navigate" size={17} color="#f2cc79" />
        </View>
        <View style={styles.statusCopy}>
          <Text style={styles.brandTitle}>BEN TOWN</Text>
          <View style={styles.statusSubline}>
            <View style={styles.liveDot} />
            <Text style={styles.statusSubtitle}>{districtName}</Text>
          </View>
        </View>
      </View>

      {/* Compact destination control; expands into the road-guide panel on tap. */}
      <ZoneNavBar onSelectZone={handleSelectZone} />

      {isDriving && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isAutoDrive ? 'Turn off auto drive' : 'Turn on auto drive'}
          onPress={() => {
            const enabled = !isAutoDrive;
            setIsAutoDrive(enabled);
            engineRef.current?.setAutoDrive(enabled);
          }}
          style={({ pressed }) => [
            styles.autoDriveButton,
            isAutoDrive && styles.autoDriveButtonActive,
            pressed && styles.autoDriveButtonPressed,
          ]}
        >
          <Ionicons name={isAutoDrive ? 'navigate-circle' : 'navigate-circle-outline'} size={19} color={isAutoDrive ? '#102a26' : '#f2cc79'} />
          <Text style={[styles.autoDriveLabel, isAutoDrive && styles.autoDriveLabelActive]}>{isAutoDrive ? 'AUTO ON' : 'AUTO DRIVE'}</Text>
        </Pressable>
      )}

      <MiniMapHUD x={mapPosition.x} z={mapPosition.z} heading={mapPosition.heading} />

      {/* Toddler Visual Learning HUD Card */}
      <SpeechBubbleHUD
        message={speechMsg}
        onDismiss={handleDismissSpeech}
      />

      {/* On-screen Toddler D-Pad (bottom-left) */}
      <ToddlerDPad
        onMove={handleJoystickMove}
        onRelease={handleJoystickRelease}
      />

      {/* Giant Contextual Action Button (bottom-right) */}
      <ActionButton
        target={currentTarget}
        isDriving={isDriving}
        onPress={() => engineRef.current?.triggerCurrentAction()}
        onExitVehicle={() => engineRef.current?.exitVehicle()}
      />

      {/* Discreet Parent Settings Gear (Top Right) */}
      <TouchableOpacity
        style={styles.settingsBtn}
        activeOpacity={0.7}
        onPress={() => setParentGateVisible(true)}
      >
        <Ionicons name="settings-sharp" size={18} color="#FFFFFF" />
      </TouchableOpacity>

      {/* Wardrobe Modal */}
      <WardrobeModal
        visible={wardrobeVisible}
        customization={customization}
        onUpdate={handleUpdateCustomization}
        onClose={() => setWardrobeVisible(false)}
      />

      {/* Parental Gate Modal */}
      <ParentGate
        visible={parentGateVisible}
        settings={parentSettings}
        onUpdateSettings={handleUpdateParentSettings}
        onResetPosition={handleResetPosition}
        onClose={() => setParentGateVisible(false)}
      />

      {!isWorldReady && (
        <View style={styles.loadingOverlay}>
          {worldError ? (
            <View style={styles.loadingCard}>
              <Text style={styles.loadingTitle}>The town needs another try</Text>
              <Text style={styles.loadingMessage}>{worldError}</Text>
              <TouchableOpacity style={styles.retryButton} onPress={retryWorldLoad} activeOpacity={0.85}>
                <Text style={styles.retryButtonText}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.loadingCard}>
              <ActivityIndicator size="large" color="#0E7490" />
              <Text style={styles.loadingTitle}>Opening BenTown…</Text>
              <Text style={styles.loadingMessage}>Getting the streets and play areas ready</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#9EE5FF',
  },
  glView: {
    flex: 1,
  },
  settingsBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: 'rgba(16, 42, 38, 0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(233,239,225,0.58)',
    shadowColor: '#08110f',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  autoDriveButton: {
    position: 'absolute',
    top: 128,
    right: 14,
    minHeight: 42,
    paddingHorizontal: 13,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: 'rgba(16, 42, 38, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(233,239,225,0.58)',
    shadowColor: '#08110f',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 7,
    elevation: 7,
  },
  autoDriveButtonActive: {
    backgroundColor: '#e8bd68',
    borderColor: '#fff4d8',
  },
  autoDriveButtonPressed: {
    transform: [{ scale: 0.96 }],
  },
  autoDriveLabel: {
    color: '#f3f2e7',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.9,
  },
  autoDriveLabelActive: {
    color: '#102a26',
  },
  worldStatus: {
    position: 'absolute',
    top: 14,
    left: 14,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingRight: 13,
    borderRadius: 13,
    backgroundColor: 'rgba(16, 42, 38, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(233,239,225,0.56)',
    shadowColor: '#08110f',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 5,
  },
  statusIcon: {
    width: 29,
    height: 29,
    borderRadius: 9,
    backgroundColor: 'rgba(232,196,119,0.13)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusCopy: {
    marginLeft: 8,
  },
  brandTitle: {
    color: '#f6f4e9',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.6,
  },
  statusSubline: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#84be8a',
    marginRight: 5,
  },
  statusSubtitle: {
    color: 'rgba(224,233,221,0.72)',
    fontSize: 7,
    fontWeight: '800',
    letterSpacing: 1.05,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 10,
    backgroundColor: 'rgba(8, 26, 45, 0.48)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingCard: {
    minWidth: 260,
    maxWidth: 380,
    alignItems: 'center',
    backgroundColor: '#F8FCFF',
    borderColor: '#BAE6FD',
    borderWidth: 2,
    borderRadius: 24,
    paddingHorizontal: 28,
    paddingVertical: 24,
    shadowColor: '#082F49',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 18,
    elevation: 12,
  },
  loadingTitle: {
    marginTop: 12,
    color: '#0F2F46',
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
  },
  loadingMessage: {
    marginTop: 6,
    color: '#527084',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 18,
    paddingHorizontal: 26,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: '#0E7490',
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 15,
  },
});
