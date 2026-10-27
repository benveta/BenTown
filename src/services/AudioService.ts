import * as Speech from 'expo-speech';
import { createAudioPlayer } from 'expo-audio';
import { Platform } from 'react-native';

const indieVoiceBaseUrl = process.env.EXPO_PUBLIC_INDIE_VOICE_URL?.replace(/\/+$/, '');
const indieVoiceStyle = 'A warm, friendly Indian English woman speaking clearly and slowly to a young child named Oshu. Gentle, cheerful, natural conversational delivery with soft expressive intonation.';
const vehicleEngineAssets = {
  car: require('../../assets/sounds/engines/car-engine-loop.wav'),
  motorcycle: require('../../assets/sounds/engines/motorcycle-engine.mp3'),
  truck: require('../../assets/sounds/engines/diesel-heavy-engine.mp3'),
  bus: require('../../assets/sounds/engines/diesel-heavy-engine.mp3'),
} as const;
type VehicleEngineType = keyof typeof vehicleEngineAssets;

class AudioService {
  private soundEnabled: boolean = true;
  private speechEnabled: boolean = true;
  private musicEnabled: boolean = true;
  private audioCtx: any = null;
  private bgmInterval: any = null;
  private idleVoiceTimer: ReturnType<typeof setInterval> | null = null;
  private lastSpeechAt = 0;
  private speechVoiceIdentifier: string | undefined;
  private speechLanguage = 'en-IN';
  private voiceReady!: Promise<void>;
  private speechIsActive = false;
  private pendingSpeech: { text: string; onDone?: () => void } | null = null;
  private generatedVoicePlayer: ReturnType<typeof createAudioPlayer> | null = null;
  private generatedVoiceSubscription: { remove: () => void } | null = null;
  private currentDistrict = 'the town square';
  private isDriving = false;
  private vehicleEnginePlayer: ReturnType<typeof createAudioPlayer> | null = null;
  private vehicleEngineType: VehicleEngineType | null = null;
  private vehicleEngineRate = 0;

  constructor() {
    this.initWebAudio();
    this.voiceReady = this.loadPreferredVoice();
    this.startIdleCheerTimer();
  }

  private initWebAudio() {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtxClass) {
          this.audioCtx = new AudioCtxClass();
        }
      } catch (e) {
        console.warn('AudioContext init failed', e);
      }
    }
  }

  private ensureAudioContext() {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  public setSoundEnabled(val: boolean) {
    this.soundEnabled = val;
    if (!val) this.stopVehicleEngine();
    else if (this.isDriving && this.vehicleEngineType) this.startVehicleEngine(this.vehicleEngineType);
  }

  public setSpeechEnabled(val: boolean) {
    this.speechEnabled = val;
    if (!val) {
      this.pendingSpeech = null;
      this.speechIsActive = false;
      Speech.stop();
      this.generatedVoiceSubscription?.remove();
      this.generatedVoiceSubscription = null;
      this.generatedVoicePlayer?.remove();
      this.generatedVoicePlayer = null;
    }
  }

  public setMusicEnabled(val: boolean) {
    this.musicEnabled = val;
    if (!val) {
      this.stopBGM();
    } else {
      this.startBGM();
    }
  }

  public isSoundOn(): boolean {
    return this.soundEnabled;
  }

  public isSpeechOn(): boolean {
    return this.speechEnabled;
  }

  public getSpeechVoiceDescription() {
    if (indieVoiceBaseUrl) return 'Indie-VOICE · warm Indian English woman · slow';
    return this.speechLanguage.toLowerCase().startsWith('en-in')
      ? 'Indian English · device voice · slow'
      : 'Device English voice · Indian voice not installed';
  }

  public isMusicOn(): boolean {
    return this.musicEnabled;
  }

  // --- Toddler Speech Voiceover ---
  public speak(text: string, onDone?: () => void) {
    if (!this.speechEnabled) {
      if (onDone) onDone();
      return;
    }

    if (this.speechIsActive) {
      // Keep only the newest line so rapid taps never build an awkward backlog.
      this.pendingSpeech = { text: this.addressOshu(text), onDone };
      return;
    }

    this.startSpeech(this.addressOshu(text), onDone);
  }

  private addressOshu(text: string) {
    return /\boshu\b/i.test(text) ? text : `Oshu, ${text}`;
  }

  private startSpeech(text: string, onDone?: () => void) {
    this.speechIsActive = true;
    this.lastSpeechAt = Date.now();
    const finish = () => {
      if (!this.speechIsActive) return;
      this.generatedVoiceSubscription?.remove();
      this.generatedVoiceSubscription = null;
      this.generatedVoicePlayer?.remove();
      this.generatedVoicePlayer = null;
      this.speechIsActive = false;
      onDone?.();
      const next = this.pendingSpeech;
      this.pendingSpeech = null;
      if (next && this.speechEnabled) this.startSpeech(next.text, next.onDone);
    };

    void this.speakWithPreferredVoice(text, finish);
  }

  private async speakWithPreferredVoice(text: string, finish: () => void) {
    if (!this.speechEnabled || !this.speechIsActive) return;
    if (indieVoiceBaseUrl) {
      try {
        const response = await fetch(`${indieVoiceBaseUrl}/synthesize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voice_style: indieVoiceStyle }),
        });
        if (!response.ok) throw new Error(`Indie-VOICE server returned ${response.status}`);
        const result = await response.json() as { audio_url?: string };
        if (!result.audio_url) throw new Error('Indie-VOICE response did not include audio_url');
        if (!this.speechEnabled || !this.speechIsActive) return;

        const audioUrl = new URL(result.audio_url, `${indieVoiceBaseUrl}/`).toString();
        const player = createAudioPlayer({ uri: audioUrl }, { updateInterval: 250 });
        this.generatedVoicePlayer = player;
        this.generatedVoiceSubscription = player.addListener('playbackStatusUpdate', (status) => {
          if (status.didJustFinish || status.error) finish();
        });
        player.play();
        return;
      } catch (error) {
        console.warn('Indie-VOICE unavailable; using the installed device voice:', error);
      }
    }

    try {
      await this.voiceReady;
      if (!this.speechEnabled || !this.speechIsActive) return;
      Speech.speak(text, {
        language: this.speechLanguage,
        ...(this.speechVoiceIdentifier ? { voice: this.speechVoiceIdentifier } : {}),
        pitch: 1.12,
        rate: 0.72,
        onDone: finish,
        onStopped: finish,
        onError: finish,
      });
    } catch (e) {
      console.warn('Speech error:', e);
      finish();
    }
  }

  public setWorldContext(x: number, z: number, isDriving: boolean, vehicleName?: string, vehicleSpeed = 0) {
    this.isDriving = isDriving;
    if (!isDriving || !vehicleName) {
      this.stopVehicleEngine();
    } else {
      const name = vehicleName.toLowerCase();
      const type: VehicleEngineType = name.includes('motorcycle') || name.includes('bike')
        ? 'motorcycle'
        : name.includes('bus')
          ? 'bus'
          : name.includes('truck') || name.includes('van')
            ? 'truck'
            : 'car';
      if (this.vehicleEngineType !== type || !this.vehicleEnginePlayer) this.startVehicleEngine(type);
      const idleRate = type === 'motorcycle' ? 0.78 : type === 'bus' || type === 'truck' ? 0.72 : 0.82;
      const targetRate = Math.min(1.35, Math.max(idleRate, idleRate + Math.abs(vehicleSpeed) * 0.035));
      if (Math.abs(targetRate - this.vehicleEngineRate) > 0.035) {
        this.vehicleEngineRate = targetRate;
        if (this.vehicleEnginePlayer) this.vehicleEnginePlayer.playbackRate = targetRate;
      }
    }
    if (x < -24 && z > 0) this.currentDistrict = 'the mountain pass';
    else if (x > 28 && z > 8) this.currentDistrict = 'the fuel stop';
    else if (x > 28 && z < -16) this.currentDistrict = 'Ben Town Mall';
    else if (z > 28 && Math.abs(x) < 20) this.currentDistrict = 'the Night District';
    else if (x < -20 && z < -10) this.currentDistrict = 'the suburbs';
    else this.currentDistrict = 'the city center';
  }

  private startVehicleEngine(type: VehicleEngineType) {
    this.stopVehicleEngine();
    this.vehicleEngineType = type;
    if (!this.soundEnabled) return;
    try {
      const player = createAudioPlayer(vehicleEngineAssets[type], { updateInterval: 1000 });
      player.loop = true;
      player.volume = type === 'motorcycle' ? 0.34 : 0.28;
      player.playbackRate = type === 'motorcycle' ? 0.78 : type === 'bus' || type === 'truck' ? 0.72 : 0.82;
      this.vehicleEngineRate = player.playbackRate;
      this.vehicleEnginePlayer = player;
      player.play();
    } catch (error) {
      console.warn(`Could not start ${type} engine sound:`, error);
      this.vehicleEnginePlayer = null;
    }
  }

  private stopVehicleEngine() {
    if (this.vehicleEnginePlayer) {
      this.vehicleEnginePlayer.pause();
      this.vehicleEnginePlayer.remove();
      this.vehicleEnginePlayer = null;
    }
    this.vehicleEngineType = null;
    this.vehicleEngineRate = 0;
  }

  private async loadPreferredVoice() {
    try {
      const voices = await Speech.getAvailableVoicesAsync();
      const isIndianEnglish = (language: string) => language.toLowerCase().replace('_', '-').startsWith('en-in');
      const indianVoices = voices.filter((voice) => isIndianEnglish(voice.language));
      const feminineName = /female|woman|aashi|aarti|ananya|kavya|neerja|lavanya|raveena|veena|priya|meera|diya|nisha/i;
      const preferredIndian = indianVoices.find((voice) => feminineName.test(`${voice.name} ${voice.identifier}`));
      const preferredFemale = voices.find((voice) => feminineName.test(`${voice.name} ${voice.identifier}`));
      const selected = preferredIndian ?? preferredFemale ?? indianVoices[0] ?? voices.find((voice) => voice.language.toLowerCase().startsWith('en-'));
      if (selected) {
        this.speechVoiceIdentifier = selected.identifier;
        this.speechLanguage = selected.language;
      }
    } catch (error) {
      console.warn('Could not load available speech voices:', error);
    }
  }

  // Keep the character present with short, location-aware prompts while play is quiet.
  private startIdleCheerTimer() {
    if (this.idleVoiceTimer) clearInterval(this.idleVoiceTimer);
    this.idleVoiceTimer = setInterval(() => {
      void this.speakIdlePrompt();
    }, 32000);
  }

  private async speakIdlePrompt() {
    if (!this.speechEnabled || Date.now() - this.lastSpeechAt < 27000) return;
    try {
      if (await Speech.isSpeakingAsync()) return;
    } catch {
      return;
    }

    const lines = this.isDriving
      ? [
          'Hold steady, Oshu. Let\'s follow the road together.',
          'You\'re doing great, Oshu! Where should we drive next?',
          'Look ahead, Oshu. What do you see on the street?',
          'Shall we take the next turn, Oshu, or keep going straight?',
        ]
      : this.currentDistrict === 'the mountain pass'
        ? [
            'Oshu, look at those big mountains! Which one is your favorite?',
            'The road is winding through the hills, Oshu. Shall we keep exploring?',
            'Oshu, can you spot a truck on the mountain road?',
          ]
        : this.currentDistrict === 'the fuel stop'
          ? [
              'Oshu, we made it to the fuel stop. Shall we take a closer look?',
              'Which car should we drive next, Oshu?',
              'Oshu, can you spot the yellow cab on the street?',
            ]
          : this.currentDistrict === 'Ben Town Mall'
            ? [
                'Oshu, we are at the mall! What would you like to look at?',
                'There are lots of shops here, Oshu. Shall we explore the plaza?',
                'Oshu, do you see the cars passing by the mall?',
              ]
            : this.currentDistrict === 'the suburbs'
              ? [
                  'Oshu, this neighborhood feels peaceful. Shall we explore another street?',
                  'Look at the houses and trees, Oshu. Which house do you like?',
                  'Oshu, should we drive back toward the city?',
                ]
              : this.currentDistrict === 'the Night District'
                ? [
                    'Oshu, the city lights are glowing! Shall we take a little ride?',
                    'Look at those bright signs, Oshu. Which color can you see?',
                    'Oshu, should we follow the lights down the boulevard?',
                  ]
                : [
                    'What would you like to explore next, Oshu?',
                    'Oshu, can you spot a taxi driving through the city?',
                    'The city center is busy today, Oshu. What do you notice?',
                    'Oshu, tap a place on the map and we can visit it together.',
                  ];
    const line = lines[Math.floor(Math.random() * lines.length)];
    this.speak(line);
  }

  // --- Synthesized Sound Effects ---
  public playXylophone(freq: number) {
    if (!this.soundEnabled || !this.audioCtx) return;
    this.ensureAudioContext();

    try {
      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + 1.2);
    } catch {}
  }

  public playPop() {
    if (!this.soundEnabled || !this.audioCtx) return;
    this.ensureAudioContext();

    try {
      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(450, now);
      osc.frequency.exponentialRampToValueAtTime(1200, now + 0.08);

      gain.gain.setValueAtTime(0.45, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.14);
    } catch {}
  }

  public playBoing() {
    if (!this.soundEnabled || !this.audioCtx) return;
    this.ensureAudioContext();

    try {
      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(200, now);
      osc.frequency.exponentialRampToValueAtTime(600, now + 0.22);
      osc.frequency.exponentialRampToValueAtTime(320, now + 0.42);

      gain.gain.setValueAtTime(0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.45);
    } catch {}
  }

  public playSlide() {
    if (!this.soundEnabled || !this.audioCtx) return;
    this.ensureAudioContext();

    try {
      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(900, now);
      osc.frequency.exponentialRampToValueAtTime(260, now + 0.65);

      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.7);
    } catch {}
  }

  public playHonk() {
    if (!this.soundEnabled || !this.audioCtx) return;
    this.ensureAudioContext();

    try {
      const now = this.audioCtx.currentTime;
      [349.23, 440.00].forEach((freq) => {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now);

        gain.gain.setValueAtTime(0.22, now);
        gain.gain.setValueAtTime(0.22, now + 0.18);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.start(now);
        osc.stop(now + 0.28);
      });
    } catch {}
  }

  public playChime() {
    if (!this.soundEnabled || !this.audioCtx) return;
    this.ensureAudioContext();

    try {
      const now = this.audioCtx.currentTime;
      const chord = [523.25, 659.25, 783.99, 1046.50];
      chord.forEach((freq, idx) => {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.08);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.setValueAtTime(0.28, now + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.8);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.start(now + idx * 0.08);
        osc.stop(now + idx * 0.08 + 0.8);
      });
    } catch {}
  }

  public playCheer() {
    this.playChime();
    this.speak('Yay Oshu! Awesome!');
  }

  public playFeed() {
    if (!this.soundEnabled || !this.audioCtx) return;
    this.ensureAudioContext();

    try {
      const now = this.audioCtx.currentTime;
      for (let i = 0; i < 3; i++) {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(320 + i * 50, now + i * 0.1);

        gain.gain.setValueAtTime(0.18, now + i * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.08);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.start(now + i * 0.1);
        osc.stop(now + i * 0.1 + 0.08);
      }
    } catch {}
  }

  // --- Background Nursery Melody ---
  public startBGM() {
    if (!this.musicEnabled || !this.audioCtx || this.bgmInterval) return;
    this.ensureAudioContext();

    const notes = [
      261.63, 261.63, 392.00, 392.00, 440.00, 440.00, 392.00,
      349.23, 349.23, 329.63, 329.63, 293.66, 293.66, 261.63
    ];
    let noteIdx = 0;

    this.bgmInterval = setInterval(() => {
      if (!this.musicEnabled || !this.audioCtx) return;
      try {
        const freq = notes[noteIdx % notes.length];
        noteIdx++;

        const now = this.audioCtx.currentTime;
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now);

        gain.gain.setValueAtTime(0.045, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.start(now);
        osc.stop(now + 0.6);
      } catch {}
    }, 750);
  }

  public stopBGM() {
    if (this.bgmInterval) {
      clearInterval(this.bgmInterval);
      this.bgmInterval = null;
    }
  }
}

export const audio = new AudioService();
