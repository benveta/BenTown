export interface OshuCustomization {
  shirtColor: string;
  hairColor: string;
  pantsColor: string;
  shoesColor: string;
}

export type AnimationState = 
  | 'idle' 
  | 'walk' 
  | 'run' 
  | 'jump' 
  | 'cheer' 
  | 'slide' 
  | 'drive';

export type InteractiveType = 
  | 'animal' 
  | 'vehicle' 
  | 'letter' 
  | 'balloon' 
  | 'bear' 
  | 'mirror' 
  | 'trampoline' 
  | 'slide' 
  | 'stepping_stone' 
  | 'pedestrian'
  | 'shop'
  | 'none';

export interface InteractiveTarget {
  id: string;
  type: InteractiveType;
  name: string;
  actionLabel: string;
  actionIcon: string;
  position: [number, number, number];
  distance: number;
  metadata?: any;
}

export interface SpeechMessage {
  id: number;
  title: string;
  subtitle?: string;
  emoji?: string;
  letter?: string;
  number?: number;
  color?: string;
  soundType?: string;
}

export interface AlphabetItem {
  letter: string;
  word: string;
  phonics: string;
  emoji: string;
  color: string;
}

export const ALPHABET_DATA: AlphabetItem[] = [
  { letter: 'A', word: 'Apple', phonics: 'Ah, ah, Apple', emoji: '🍎', color: '#FF4D4D' },
  { letter: 'B', word: 'Ball', phonics: 'Buh, buh, Ball', emoji: '⚽', color: '#4D96FF' },
  { letter: 'C', word: 'Cat', phonics: 'Kuh, kuh, Cat', emoji: '🐱', color: '#FFD93D' },
  { letter: 'D', word: 'Duck', phonics: 'Duh, duh, Duck', emoji: '🦆', color: '#6BCB77' },
  { letter: 'E', word: 'Elephant', phonics: 'Eh, eh, Elephant', emoji: '🐘', color: '#A06EE1' },
  { letter: 'F', word: 'Fish', phonics: 'Fuh, fuh, Fish', emoji: '🐟', color: '#00C4FF' },
  { letter: 'G', word: 'Guitar', phonics: 'Guh, guh, Guitar', emoji: '🎸', color: '#FF7675' },
  { letter: 'H', word: 'Hat', phonics: 'Huh, huh, Hat', emoji: '🎩', color: '#F39C12' },
  { letter: 'I', word: 'Ice Cream', phonics: 'Ih, ih, Ice Cream', emoji: '🍦', color: '#FF85A1' },
  { letter: 'J', word: 'Juice', phonics: 'Juh, juh, Juice', emoji: '🧃', color: '#FFA502' },
  { letter: 'K', word: 'Kite', phonics: 'Kuh, kuh, Kite', emoji: '🪁', color: '#3742FA' },
  { letter: 'L', word: 'Lion', phonics: 'Luh, luh, Lion', emoji: '🦁', color: '#ECCC68' },
  { letter: 'M', word: 'Monkey', phonics: 'Muh, muh, Monkey', emoji: '🐵', color: '#795548' },
  { letter: 'N', word: 'Nest', phonics: 'Nuh, nuh, Nest', emoji: '🪺', color: '#8D6E63' },
  { letter: 'O', word: 'Orange', phonics: 'Ah, ah, Orange', emoji: '🍊', color: '#FF793F' },
  { letter: 'P', word: 'Puppy', phonics: 'Puh, puh, Puppy', emoji: '🐶', color: '#E17055' },
  { letter: 'Q', word: 'Queen', phonics: 'Kwuh, kwuh, Queen', emoji: '👑', color: '#9B59B6' },
  { letter: 'R', word: 'Rainbow', phonics: 'Ruh, ruh, Rainbow', emoji: '🌈', color: '#2ED573' },
  { letter: 'S', word: 'Star', phonics: 'Sss, sss, Star', emoji: '⭐', color: '#F1C40F' },
  { letter: 'T', word: 'Train', phonics: 'Tuh, tuh, Train', emoji: '🚂', color: '#1E90FF' },
  { letter: 'U', word: 'Umbrella', phonics: 'Uh, uh, Umbrella', emoji: '☂️', color: '#A55EEA' },
  { letter: 'V', word: 'Van', phonics: 'Vuh, vuh, Van', emoji: '🚐', color: '#26DE81' },
  { letter: 'W', word: 'Whale', phonics: 'Wuh, wuh, Whale', emoji: '🐳', color: '#45AAF2' },
  { letter: 'X', word: 'Xylophone', phonics: 'Zylophone', emoji: '🎵', color: '#FD9644' },
  { letter: 'Y', word: 'Yoyo', phonics: 'Yuh, yuh, Yoyo', emoji: '🪀', color: '#FC5C65' },
  { letter: 'Z', word: 'Zebra', phonics: 'Zzz, zzz, Zebra', emoji: '🦓', color: '#2C3E50' },
];

export const COLOR_PATH_DATA = [
  { note: 'C4', freq: 261.63, name: 'Red', color: '#FF4757', emoji: '🔴' },
  { note: 'D4', freq: 293.66, name: 'Orange', color: '#FFA502', emoji: '🟠' },
  { note: 'E4', freq: 329.63, name: 'Yellow', color: '#FFDA79', emoji: '🟡' },
  { note: 'F4', freq: 349.23, name: 'Green', color: '#2ED573', emoji: '🟢' },
  { note: 'G4', freq: 392.00, name: 'Cyan', color: '#1E90FF', emoji: '🔵' },
  { note: 'A4', freq: 440.00, name: 'Blue', color: '#3742FA', emoji: '🟣' },
  { note: 'B4', freq: 493.88, name: 'Purple', color: '#9B59B6', emoji: '🟪' },
];

export const NUMBER_BALLOONS_DATA = [
  { num: 1, word: 'One', color: '#FF6B6B' },
  { num: 2, word: 'Two', color: '#4ECDC4' },
  { num: 3, word: 'Three', color: '#FFE66D' },
  { num: 4, word: 'Four', color: '#1A535C' },
  { num: 5, word: 'Five', color: '#FF9F1C' },
  { num: 6, word: 'Six', color: '#2EC4B6' },
  { num: 7, word: 'Seven', color: '#E71D36' },
  { num: 8, word: 'Eight', color: '#7209B7' },
  { num: 9, word: 'Nine', color: '#3A0CA3' },
  { num: 10, word: 'Ten', color: '#4361EE' },
];

export const WARDROBE_SHIRTS = [
  { name: 'Sunny Yellow', hex: '#FFD93D' },
  { name: 'Sky Blue', hex: '#4D96FF' },
  { name: 'Berry Red', hex: '#FF6B6B' },
  { name: 'Leaf Green', hex: '#6BCB77' },
  { name: 'Sweet Pink', hex: '#FF85A1' },
  { name: 'Tangerine', hex: '#FFA502' },
  { name: 'Grape Purple', hex: '#A55EEA' },
  { name: 'Clean White', hex: '#F1F2F6' },
];

export const WARDROBE_HAIR = [
  { name: 'Natural Black', hex: '#171719' },
  { name: 'Soft Black', hex: '#282321' },
  { name: 'Dark Brown', hex: '#38251E' },
  { name: 'Chestnut Brown', hex: '#583B2B' },
  { name: 'Warm Brown', hex: '#76503A' },
  { name: 'Light Brown', hex: '#9A704F' },
];

export const WARDROBE_SHOES = [
  { name: 'White Kicks', hex: '#FFFFFF' },
  { name: 'Red Sneakers', hex: '#FF4757' },
  { name: 'Blue Runners', hex: '#1E90FF' },
  { name: 'Bright Yellow', hex: '#FFD93D' },
];
