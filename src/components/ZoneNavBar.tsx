import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { haptics } from '../services/HapticsService';

interface ZoneNavBarProps {
  onSelectZone: (zoneId: string) => void;
}

const DESTINATIONS = [
  { id: 'home', label: 'City Center', detail: 'Main streets', icon: 'arrow-up' },
  { id: 'playground', label: 'Suburbs', detail: 'Quiet neighborhood', icon: 'arrow-forward' },
  { id: 'market', label: 'Ben Town Mall', detail: 'Shops & plaza', icon: 'arrow-forward' },
  { id: 'meadow', label: 'Mountain Pass', detail: 'Scenic highway', icon: 'arrow-back' },
  { id: 'garage', label: 'Fuel Stop', detail: 'Vehicles & pumps', icon: 'arrow-down' },
  { id: 'music', label: 'Night District', detail: 'Neon boulevard', icon: 'arrow-back' },
  { id: 'learn', label: 'Learning Park', detail: 'ABC, numbers & animals', icon: 'arrow-forward' },
] as const;

export const ZoneNavBar: React.FC<ZoneNavBarProps> = ({ onSelectZone }) => {
  const [expanded, setExpanded] = useState(false);

  const selectDestination = (zoneId: string) => {
    haptics.light();
    onSelectZone(zoneId);
    setExpanded(false);
  };

  return (
    <View style={styles.anchor} pointerEvents="box-none">
      <Pressable
        style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Close destination list' : 'Open destination list'}
        accessibilityState={{ expanded }}
        onPress={() => {
          haptics.light();
          setExpanded((open) => !open);
        }}
      >
        <View style={styles.triggerIcon}>
          <Ionicons name="map-outline" size={19} color="#f2cc79" />
        </View>
        <View style={styles.triggerCopy}>
          <Text style={styles.triggerTitle}>EXPLORE</Text>
          <Text style={styles.triggerSubtitle}>6 DISTRICTS</Text>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={15} color="#f3f4eb" />
      </Pressable>

      {expanded && (
        <View style={styles.panel}>
          <View style={styles.panelHeader}>
            <View>
              <Text style={styles.panelEyebrow}>BENTOWN ROAD GUIDE</Text>
              <Text style={styles.panelTitle}>Choose a destination</Text>
            </View>
            <Pressable
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="Close destination list"
              onPress={() => setExpanded(false)}
            >
              <Ionicons name="close" size={17} color="#d8e0d8" />
            </Pressable>
          </View>

          {DESTINATIONS.map((destination, index) => (
            <Pressable
              key={destination.id}
              style={({ pressed }) => [
                styles.destination,
                index === DESTINATIONS.length - 1 && styles.lastDestination,
                pressed && styles.destinationPressed,
              ]}
              accessibilityRole="button"
              onPress={() => selectDestination(destination.id)}
            >
              <View style={styles.directionBadge}>
                <Ionicons name={destination.icon} size={15} color="#f5d28b" />
              </View>
              <View style={styles.destinationCopy}>
                <Text style={styles.destinationTitle}>{destination.label}</Text>
                <Text style={styles.destinationDetail}>{destination.detail}</Text>
              </View>
              <Ionicons name="chevron-forward" size={15} color="rgba(234,239,228,0.52)" />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  anchor: {
    position: 'absolute',
    top: 62,
    right: 14,
    zIndex: 5,
    alignItems: 'flex-end',
  },
  trigger: {
    minWidth: 136,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(16, 42, 38, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(233,239,225,0.72)',
    shadowColor: '#08110f',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.32,
    shadowRadius: 9,
    elevation: 7,
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },
  triggerIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: 'rgba(232,196,119,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  triggerCopy: {
    flex: 1,
    paddingLeft: 8,
  },
  triggerTitle: {
    color: '#f5f4ea',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.35,
  },
  triggerSubtitle: {
    color: 'rgba(224,233,221,0.66)',
    fontSize: 7,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 2,
  },
  panel: {
    width: 244,
    marginTop: 9,
    paddingHorizontal: 10,
    paddingTop: 12,
    paddingBottom: 4,
    borderRadius: 15,
    backgroundColor: 'rgba(15, 35, 33, 0.97)',
    borderWidth: 1,
    borderColor: 'rgba(224,231,215,0.6)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.34,
    shadowRadius: 14,
    elevation: 10,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 3,
    paddingBottom: 8,
  },
  panelEyebrow: {
    color: '#d3b46f',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1.45,
  },
  panelTitle: {
    color: '#f5f4ed',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 3,
  },
  closeButton: {
    width: 29,
    height: 29,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  destination: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(224,231,215,0.14)',
    paddingHorizontal: 3,
  },
  lastDestination: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(224,231,215,0.14)',
  },
  destinationPressed: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  directionBadge: {
    width: 27,
    height: 27,
    borderRadius: 8,
    backgroundColor: 'rgba(232,196,119,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  destinationCopy: {
    flex: 1,
    marginLeft: 9,
  },
  destinationTitle: {
    color: '#f0f2e9',
    fontSize: 11,
    fontWeight: '800',
  },
  destinationDetail: {
    color: 'rgba(221,229,218,0.6)',
    fontSize: 9,
    marginTop: 2,
  },
});
