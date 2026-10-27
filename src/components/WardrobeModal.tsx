import React from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  Modal, 
  TouchableOpacity, 
  ScrollView 
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { 
  OshuCustomization, 
  WARDROBE_SHIRTS, 
  WARDROBE_HAIR, 
  WARDROBE_SHOES 
} from '../types/game';
import { audio } from '../services/AudioService';
import { haptics } from '../services/HapticsService';

interface WardrobeModalProps {
  visible: boolean;
  customization: OshuCustomization;
  onUpdate: (updated: OshuCustomization) => void;
  onClose: () => void;
}

export const WardrobeModal: React.FC<WardrobeModalProps> = ({
  visible,
  customization,
  onUpdate,
  onClose,
}) => {
  const handleSelectShirt = (hex: string, name: string) => {
    audio.playPop();
    audio.speak(`${name} shirt! Looking cool Oshu!`);
    haptics.light();
    onUpdate({ ...customization, shirtColor: hex });
  };

  const handleSelectHair = (hex: string, name: string) => {
    audio.playPop();
    audio.speak(`${name} hair! Nice style!`);
    haptics.light();
    onUpdate({ ...customization, hairColor: hex });
  };

  const handleSelectShoes = (hex: string, name: string) => {
    audio.playPop();
    audio.speak(`${name}! Ready to run!`);
    haptics.light();
    onUpdate({ ...customization, shoesColor: hex });
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.overlay}>
        <View style={styles.sheetCard}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>✨ Oshu’s Dress Up! ✨</Text>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Ionicons name="checkmark-circle" size={48} color="#22C55E" />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
            {/* 1. Shirts */}
            <Text style={styles.sectionTitle}>👕 T-Shirt Color</Text>
            <View style={styles.swatchRow}>
              {WARDROBE_SHIRTS.map((item) => {
                const isSelected = customization.shirtColor === item.hex;
                return (
                  <TouchableOpacity
                    key={item.hex}
                    style={[
                      styles.swatchCircle,
                      { backgroundColor: item.hex },
                      isSelected && styles.swatchSelected,
                    ]}
                    activeOpacity={0.8}
                    onPress={() => handleSelectShirt(item.hex, item.name)}
                  >
                    {isSelected && <Ionicons name="checkmark" size={24} color="#000000" />}
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* 2. Hair */}
            <Text style={styles.sectionTitle}>Hair Color</Text>
            <View style={styles.swatchRow}>
              {WARDROBE_HAIR.map((item) => {
                const isSelected = customization.hairColor === item.hex;
                return (
                  <TouchableOpacity
                    key={item.hex}
                    style={[
                      styles.swatchCircle,
                      { backgroundColor: item.hex },
                      isSelected && styles.swatchSelected,
                    ]}
                    activeOpacity={0.8}
                    onPress={() => handleSelectHair(item.hex, item.name)}
                  >
                    {isSelected && <Ionicons name="checkmark" size={24} color="#FFFFFF" />}
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* 3. Shoes */}
            <Text style={styles.sectionTitle}>👟 Sneakers</Text>
            <View style={styles.swatchRow}>
              {WARDROBE_SHOES.map((item) => {
                const isSelected = customization.shoesColor === item.hex;
                return (
                  <TouchableOpacity
                    key={item.hex}
                    style={[
                      styles.swatchCircle,
                      { backgroundColor: item.hex },
                      isSelected && styles.swatchSelected,
                    ]}
                    activeOpacity={0.8}
                    onPress={() => handleSelectShoes(item.hex, item.name)}
                  >
                    {isSelected && <Ionicons name="checkmark" size={24} color="#000000" />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  sheetCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 32,
    maxHeight: '75%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: '#1E293B',
  },
  closeBtn: {
    padding: 4,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#334155',
    marginTop: 16,
    marginBottom: 10,
  },
  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  swatchCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 3,
    borderColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
  },
  swatchSelected: {
    borderColor: '#1E293B',
    borderWidth: 4,
    transform: [{ scale: 1.1 }],
  },
});
