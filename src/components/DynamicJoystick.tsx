import React, { useMemo, useState } from 'react';
import { View, StyleSheet, PanResponder, Dimensions } from 'react-native';

interface DynamicJoystickProps {
  onMove: (vector: { x: number; y: number }) => void;
  onRelease: () => void;
}

const JOYSTICK_RADIUS = 60;
const KNOB_RADIUS = 28;

export const DynamicJoystick: React.FC<DynamicJoystickProps> = ({ onMove, onRelease }) => {
  const [active, setActive] = useState(false);
  const [center, setCenter] = useState({ x: 0, y: 0 });
  const [knobPos, setKnobPos] = useState({ x: 0, y: 0 });

  const panResponder = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: (evt) => {
        const { pageX } = evt.nativeEvent;
        const screenWidth = Dimensions.get('window').width;
        // Respond to touch on left/middle area (keep bottom-right free for action button)
        return pageX < screenWidth * 0.72;
      },
      onMoveShouldSetPanResponder: () => true,

      onPanResponderGrant: (evt) => {
        const { pageX, pageY } = evt.nativeEvent;
        setCenter({ x: pageX, y: pageY });
        setKnobPos({ x: 0, y: 0 });
        setActive(true);
      },

      onPanResponderMove: (evt, gestureState) => {
        let dx = gestureState.dx;
        let dy = gestureState.dy;

        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > JOYSTICK_RADIUS) {
          dx = (dx / distance) * JOYSTICK_RADIUS;
          dy = (dy / distance) * JOYSTICK_RADIUS;
        }

        setKnobPos({ x: dx, y: dy });

        // Normalized vector
        const normX = dx / JOYSTICK_RADIUS;
        const normY = dy / JOYSTICK_RADIUS;
        onMove({ x: normX, y: normY });
      },

      onPanResponderRelease: () => {
        setActive(false);
        setKnobPos({ x: 0, y: 0 });
        onRelease();
      },

      onPanResponderTerminate: () => {
        setActive(false);
        setKnobPos({ x: 0, y: 0 });
        onRelease();
      },
    }),
    [onMove, onRelease]
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" {...panResponder.panHandlers}>
      {active && (
        <View
          style={[
            styles.baseRing,
            {
              left: center.x - JOYSTICK_RADIUS,
              top: center.y - JOYSTICK_RADIUS,
            },
          ]}
        >
          <View
            style={[
              styles.knob,
              {
                transform: [
                  { translateX: knobPos.x },
                  { translateY: knobPos.y },
                ],
              },
            ]}
          />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  baseRing: {
    position: 'absolute',
    width: JOYSTICK_RADIUS * 2,
    height: JOYSTICK_RADIUS * 2,
    borderRadius: JOYSTICK_RADIUS,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
    borderWidth: 3.5,
    borderColor: 'rgba(255, 255, 255, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  knob: {
    width: KNOB_RADIUS * 2,
    height: KNOB_RADIUS * 2,
    borderRadius: KNOB_RADIUS,
    backgroundColor: '#38BDF8',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 8,
  },
});
