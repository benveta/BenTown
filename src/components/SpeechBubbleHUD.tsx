import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { SpeechMessage } from '../types/game';

interface SpeechBubbleHUDProps {
  message: SpeechMessage | null;
  onDismiss: () => void;
}

export const SpeechBubbleHUD: React.FC<SpeechBubbleHUDProps> = ({ message, onDismiss }) => {
  const [scaleAnim] = useState(() => new Animated.Value(0));
  const [opacityAnim] = useState(() => new Animated.Value(0));
  const messageId = message?.id;

  const handleDismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(scaleAnim, {
        toValue: 0.8,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => onDismiss());
  }, [onDismiss, opacityAnim, scaleAnim]);

  useEffect(() => {
    if (messageId === undefined) return;

    // Spring pop in
    scaleAnim.setValue(0.5);
    opacityAnim.setValue(0);

    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 4,
        tension: 50,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();

    // Auto dismiss after 3.8s
    const timer = setTimeout(handleDismiss, 3800);

    return () => clearTimeout(timer);
  }, [handleDismiss, messageId, opacityAnim, scaleAnim]);

  if (!message) return null;

  return (
    <View style={styles.container} pointerEvents="box-none">
      <Animated.View
        style={[
          styles.bubbleCard,
          {
            transform: [{ scale: scaleAnim }],
            opacity: opacityAnim,
          },
        ]}
      >
        <TouchableOpacity activeOpacity={0.9} onPress={handleDismiss} style={styles.cardContent}>
          {/* Large Visual Emoji or Number / Letter Badge */}
          {message.emoji && <Text style={styles.bigEmoji}>{message.emoji}</Text>}
          {message.number !== undefined && (
            <View style={[styles.badgeCircle, { backgroundColor: message.color || '#3B82F6' }]}>
              <Text style={styles.badgeText}>{message.number}</Text>
            </View>
          )}
          {message.letter && (
            <View style={[styles.badgeCircle, { backgroundColor: message.color || '#EF4444' }]}>
              <Text style={styles.badgeText}>{message.letter}</Text>
            </View>
          )}

          <View style={styles.textColumn}>
            <Text style={styles.titleText}>{message.title}</Text>
            {message.subtitle && <Text style={styles.subtitleText}>{message.subtitle}</Text>}
          </View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 154,
    left: 12,
    right: 12,
    zIndex: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleCard: {
    backgroundColor: 'rgba(16, 35, 33, 0.94)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(241,232,205,0.45)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 7,
    maxWidth: 320,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bigEmoji: {
    fontSize: 24,
    marginRight: 11,
  },
  badgeCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 9,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  textColumn: {
    flexShrink: 1,
    justifyContent: 'center',
  },
  titleText: {
    color: '#f7f4e9',
    fontSize: 12,
    fontWeight: '900',
  },
  subtitleText: {
    color: 'rgba(235,239,227,0.72)',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 3,
  },
});
