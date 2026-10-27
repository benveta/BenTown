import React, { useState } from 'react';
import { 
  TouchableOpacity, 
  Text, 
  StyleSheet, 
  Animated, 
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { InteractiveTarget } from '../types/game';

interface ActionButtonProps {
  target: InteractiveTarget | null;
  isDriving: boolean;
  onPress: () => void;
  onExitVehicle?: () => void;
}

export const ActionButton: React.FC<ActionButtonProps> = ({
  target,
  isDriving,
  onPress,
  onExitVehicle,
}) => {
  const [scaleAnim] = useState(() => new Animated.Value(1));
  const { width, height } = useWindowDimensions();
  const targetHintWidth = Math.min(230, width - 32);

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.88,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 3,
      tension: 40,
      useNativeDriver: true,
    }).start();
  };

  // Determine button label, icon, and colors
  let label = 'LOOK';
  let iconName: any = 'compass';
  const bgColor = isDriving ? '#eac06d' : '#f0c56f';
  const iconColor = '#18302d';
  const borderColor = '#fff4d8';

  if (isDriving) {
    label = 'HONK!';
    iconName = 'volume-high';
  } else if (target) {
    switch (target.type) {
      case 'animal':
        label = 'PET!';
        iconName = 'heart';
        break;
      case 'vehicle':
        label = 'DRIVE!';
        iconName = 'car';
        break;
      case 'pedestrian':
        label = 'SAY HI!';
        iconName = 'hand-left';
        break;
      case 'shop':
        label = 'VISIT!';
        iconName = 'cart';
        break;
      case 'slide':
        label = 'SLIDE!';
        iconName = 'arrow-down';
        break;
      case 'trampoline':
        label = 'BOUNCE!';
        iconName = 'rocket';
        break;
      case 'bear':
        label = 'FEED!';
        iconName = 'nutrition';
        break;
      case 'mirror':
        label = 'DRESS UP!';
        iconName = 'shirt';
        break;
      case 'letter':
      case 'balloon':
        label = 'POP!';
        iconName = 'sparkles';
        break;
    }
  }

  if (!target && !isDriving) return null;

  return (
    <View style={styles.container} pointerEvents="box-none">
      {/* If driving, show Exit Vehicle button */}
      {isDriving && onExitVehicle && (
        <TouchableOpacity
          style={styles.exitBtn}
          activeOpacity={0.8}
          onPress={onExitVehicle}
        >
          <Ionicons name="log-out-outline" size={17} color="#f3d18c" />
          <Text style={styles.exitText}>EXIT VEHICLE</Text>
        </TouchableOpacity>
      )}

      {!isDriving && target && (
        <View style={[styles.targetHint, {
          position: 'absolute',
          top: 228 - height,
          right: (width - targetHintWidth) / 2 - 20,
          width: targetHintWidth,
          marginBottom: 0,
        }]}>
          <Text style={styles.hintEyebrow}>NEARBY</Text>
          <Text style={styles.targetName} numberOfLines={1}>{target.name}</Text>
          <View style={styles.targetActionRow}>
            <Ionicons name="hand-left-outline" size={12} color="#f2cb7b" />
            <Text style={styles.targetAction} numberOfLines={1}>{target.actionLabel}</Text>
          </View>
        </View>
      )}

      {/* Giant Toddler Action Button */}
      <Animated.View style={[{ transform: [{ scale: scaleAnim }] }]}>
        <TouchableOpacity
          style={[styles.bigBtn, { backgroundColor: bgColor, borderColor }]}
          activeOpacity={1}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          onPress={onPress}
        >
          <Ionicons name={iconName} size={24} color={iconColor} />
          <Text style={styles.btnText}>{label}</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 22,
    right: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigBtn: {
    width: 78,
    height: 78,
    borderRadius: 27,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.34,
    shadowRadius: 10,
    elevation: 8,
  },
  btnText: {
    color: '#18302d',
    fontWeight: '900',
    fontSize: 9,
    marginTop: 3,
    letterSpacing: 1.2,
  },
  exitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 42, 38, 0.92)',
    paddingVertical: 9,
    paddingHorizontal: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(241,232,205,0.56)',
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 6,
  },
  exitText: {
    color: '#f3f2e7',
    fontWeight: '800',
    fontSize: 9,
    marginLeft: 7,
    letterSpacing: 0.8,
  },
  targetHint: {
    maxWidth: 230,
    minWidth: 0,
    backgroundColor: 'rgba(16, 35, 33, 0.94)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(241,232,205,0.45)',
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 3,
  },
  targetName: {
    color: '#f7f4e9',
    fontSize: 12,
    fontWeight: '900',
    marginTop: 3,
  },
  targetAction: {
    color: 'rgba(235,239,227,0.74)',
    fontSize: 9,
    fontWeight: '600',
    marginLeft: 5,
    flexShrink: 1,
  },
  targetActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
  },
  hintEyebrow: {
    color: '#e8c57c',
    fontSize: 7,
    fontWeight: '900',
    letterSpacing: 1.3,
  },
});
