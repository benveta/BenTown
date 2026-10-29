import React, { useRef, useState } from 'react';
import { GestureResponderEvent, HostInstance, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface ToddlerDPadProps {
  onMove: (vector: { x: number; y: number }) => void;
  onRelease: () => void;
}

const DIRECTIONS = {
  forward: { x: 0, y: 1, icon: 'chevron-up' as const, label: 'Forward' },
  backward: { x: 0, y: -1, icon: 'chevron-down' as const, label: 'Backward' },
  // The follow camera looks toward +Z, so its screen-right axis is world -X.
  // Map the screen controls to that camera basis instead of raw world X.
  left: { x: 1, y: 0, icon: 'chevron-back' as const, label: 'Left' },
  right: { x: -1, y: 0, icon: 'chevron-forward' as const, label: 'Right' },
};

type Direction = keyof typeof DIRECTIONS;

export const ToddlerDPad: React.FC<ToddlerDPadProps> = ({ onMove, onRelease }) => {
  const heldDirections = useRef(new Set<Direction>());
  const { width } = useWindowDimensions();
  const buttonSize = width < 390 ? 56 : width < 900 ? 64 : 72;

  const publishMovement = () => {
    let x = 0;
    let y = 0;
    heldDirections.current.forEach((direction) => {
      x += DIRECTIONS[direction].x;
      y += DIRECTIONS[direction].y;
    });

    if (x === 0 && y === 0) {
      onRelease();
      return;
    }

    const magnitude = Math.hypot(x, y);
    onMove({ x: x / Math.max(1, magnitude), y: y / Math.max(1, magnitude) });
  };

  const setDirectionHeld = (direction: Direction, held: boolean) => {
    if (held) heldDirections.current.add(direction);
    else heldDirections.current.delete(direction);
    publishMovement();
  };

  // --- Multi-touch (phones) ---------------------------------------------------------------
  // React Native's Pressable uses the single "responder" system: only ONE button can be pressed at a
  // time, so Forward + Left never worked together. On phones the buttons are plain views and the raw
  // touch events (which report every finger) are hit-tested against each button instead.
  const [pressedDirections, setPressedDirections] = useState<Set<Direction>>(new Set());
  const buttonRefs = useRef<Partial<Record<Direction, HostInstance | null>>>({});
  const rects = useRef<Partial<Record<Direction, { x: number; y: number; w: number; h: number }>>>({});
  const lastKey = useRef('');

  const measureButtons = () => {
    (Object.keys(DIRECTIONS) as Direction[]).forEach((direction) => {
      buttonRefs.current[direction]?.measureInWindow((x, y, w, h) => {
        rects.current[direction] = { x, y, w, h };
      });
    });
  };

  const handleTouches = (event: GestureResponderEvent) => {
    const slop = 10; // a little forgiveness around each button for small fingers
    const held = new Set<Direction>();
    for (const touch of event.nativeEvent.touches) {
      (Object.keys(DIRECTIONS) as Direction[]).forEach((direction) => {
        const rect = rects.current[direction];
        if (!rect) return;
        if (touch.pageX >= rect.x - slop && touch.pageX <= rect.x + rect.w + slop
          && touch.pageY >= rect.y - slop && touch.pageY <= rect.y + rect.h + slop) {
          held.add(direction);
        }
      });
    }
    const key = [...held].sort().join(',');
    if (key === lastKey.current) return;
    lastKey.current = key;
    heldDirections.current = held;
    setPressedDirections(held);
    publishMovement();
  };

  // Phones always use raw touches; `?rawtouch` lets the web build exercise the same code path for testing.
  const useRawTouch = Platform.OS !== 'web' || (typeof window !== 'undefined' && /rawtouch/.test(window.location?.search ?? ''));
  const touchHandlers = !useRawTouch ? {} : {
    onTouchStart: handleTouches,
    onTouchMove: handleTouches,
    onTouchEnd: handleTouches,
    onTouchCancel: handleTouches,
  };

  const renderButton = (direction: Direction) => {
    if (useRawTouch) {
      const control = DIRECTIONS[direction];
      return (
        <View
          key={direction}
          ref={(node) => { buttonRefs.current[direction] = node; }}
          onLayout={measureButtons}
          accessibilityRole="button"
          accessibilityLabel={control.label}
          style={[
            styles.button,
            { width: buttonSize, height: buttonSize },
            pressedDirections.has(direction) && styles.buttonPressed,
          ]}
        >
          <Ionicons name={control.icon} size={32} color="#f7f3e8" />
          <Text style={styles.buttonLabel}>{control.label}</Text>
        </View>
      );
    }

    const control = DIRECTIONS[direction];
    return (
      <Pressable
        key={direction}
        accessibilityRole="button"
        accessibilityLabel={control.label}
        onPressIn={() => setDirectionHeld(direction, true)}
        onPressOut={() => setDirectionHeld(direction, false)}
        style={({ pressed }) => [
          styles.button,
          { width: buttonSize, height: buttonSize },
          pressed && styles.buttonPressed,
        ]}
      >
        <Ionicons name={control.icon} size={32} color="#f7f3e8" />
        <Text style={styles.buttonLabel}>{control.label}</Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <View style={[styles.leftControls, { left: width < 500 ? 132 : width < 900 ? 144 : 156 }]} pointerEvents="box-none" {...touchHandlers}>
        {renderButton('left')}
        {renderButton('right')}
      </View>
      <View style={[styles.rightControls, { right: width < 500 ? 24 : width < 900 ? 128 : 160, bottom: width < 500 ? 108 : 20 }]} pointerEvents="box-none" {...touchHandlers}>
        {renderButton('forward')}
        {renderButton('backward')}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
  },
  leftControls: {
    position: 'absolute',
    bottom: 20,
    flexDirection: 'row',
    gap: 14,
  },
  rightControls: {
    position: 'absolute',
    alignItems: 'center',
    gap: 12,
  },
  button: {
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(241,232,205,0.72)',
    backgroundColor: 'rgba(12, 31, 37, 0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.34,
    shadowRadius: 7,
    elevation: 7,
  },
  buttonPressed: {
    backgroundColor: '#0e7490',
    borderColor: '#f3d58d',
    transform: [{ scale: 0.94 }],
  },
  buttonLabel: {
    position: 'absolute',
    bottom: 3,
    color: '#e4e5df',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
});
