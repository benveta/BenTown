import * as THREE from 'three';
import { CharacterController } from './CharacterController';
import { WorldManager } from './WorldManager';
import { 
  InteractiveTarget, 
  OshuCustomization, 
  SpeechMessage 
} from '../types/game';
import { audio } from '../services/AudioService';
import { haptics } from '../services/HapticsService';

export class GameEngine {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private gl: any;

  public character!: CharacterController;
  public world!: WorldManager;

  // Camera settings
  private cameraFollowDistance = 10.4;
  private cameraFollowHeight = 4.0;
  private cameraLookAhead = 3.6;
  private cameraLookTarget = new THREE.Vector3(0, 1.1, 0);

  // Vehicle driving state
  public activeVehicle: any = null;
  public isDriving: boolean = false;
  public autoDrive = false;

  // Slide animation state
  private isSliding: boolean = false;
  private slideProgress: number = 0;

  // Animation loop
  private animationFrameId: number | null = null;
  private lastTime: number = 0;
  private isRunning: boolean = false;
  private frameCount = 0;
  private lastShadowUpdate = 0;
  // Automatic quality governor (see adaptQuality): never raises quality again once lowered.
  private shadowIntervalMs = 110;
  private frameTimeMs = 16;
  private qualityLevel = 0;
  private startedAt = 0;
  private lastQualityCheck = 0;

  // Inputs
  public joystickVector: { x: number; y: number } | null = null;
  private pendingVehicleTurns: number[] = [];

  // UI Callbacks
  /** Startup progress text for the loading card. */
  public onLoadStage?: (stage: string) => void;
  public onTargetChange?: (target: InteractiveTarget | null) => void;
  public onSpeechMessage?: (message: SpeechMessage) => void;
  public onOpenWardrobe?: () => void;
  public onVehicleChange?: (driving: boolean, vehicleName?: string) => void;

  private currentTarget: InteractiveTarget | null = null;
  private messageCounter: number = 0;

  // Raycaster for Tap-to-walk and Tap-to-interact
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private tapMarkerMesh!: THREE.Mesh;

  constructor(gl: any, customization: OshuCustomization) {
    this.gl = gl;
    this.initThree(customization);
  }

  private initThree(customization: OshuCustomization) {
    const width = this.gl.drawingBufferWidth;
    const height = this.gl.drawingBufferHeight;

    // 1. Renderer
    // React Native has no `document`, and three.js creates its own canvas with
    // `document.createElementNS` unless it is given one - which threw before anything rendered
    // and left the loading card spinning forever. Give it a minimal stand-in wrapping the GL
    // context. (Open the web build with ?nodoc to test this path in a browser.)
    const simulateNoDocument = __DEV__ && typeof window !== 'undefined' && /nodoc/.test(window.location?.search ?? '');
    if (simulateNoDocument) {
      // Block only what three.js would do on a device (an XHTML <canvas>); leave the browser's own page building alone.
      const originalCreateElementNS = document.createElementNS.bind(document);
      document.createElementNS = ((namespace: string, name: string) => {
        if (namespace === 'http://www.w3.org/1999/xhtml' && name === 'canvas') throw new Error('document is not available (simulated)');
        return originalCreateElementNS(namespace, name);
      }) as typeof document.createElementNS;
    }
    const canvasStandIn = {
      width,
      height,
      clientWidth: width,
      clientHeight: height,
      style: {},
      addEventListener: () => {},
      removeEventListener: () => {},
      setAttribute: () => {},
      getContext: () => this.gl,
    } as unknown as HTMLCanvasElement;
    const canvas: HTMLCanvasElement = !simulateNoDocument && this.gl.canvas ? this.gl.canvas : canvasStandIn;

    // three.js (r163+) rejects any context that is `instanceof WebGLRenderingContext` as "WebGL 1".
    // expo-gl 58's native contexts match that global even though they are real WebGL 2 contexts
    // (expo/expo#51543; the upstream fix, PR #51572, is merged but not in a release yet). Workaround
    // from that thread: hide the global only while three.js builds the renderer, and only for a context
    // that expo-gl says is WebGL 2 - a WebGL 1 context is still refused. Browsers never need this.
    // `?nodoc` reproduces the device environment in a browser; add `&nofix` to see the original error.
    const globals = globalThis as { WebGLRenderingContext?: unknown };
    const savedWebGLRenderingContext = globals.WebGLRenderingContext;
    const query = typeof window !== 'undefined' ? window.location?.search ?? '' : '';
    if (simulateNoDocument) {
      globals.WebGLRenderingContext = class { static [Symbol.hasInstance]() { return true; } };
    }
    const isWebGL2 = this.gl.supportsWebGL2 === true || simulateNoDocument;
    if (isWebGL2 && !(simulateNoDocument && /nofix/.test(query))) {
      globals.WebGLRenderingContext = undefined;
    }
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        context: this.gl,
        // Phone screens are ~460 ppi: MSAA at full native resolution costs a lot
        // of fill rate for almost no visible gain, so only enable it on
        // lower-density / desktop surfaces.
        antialias: Math.max(width, height) < 1900,
        powerPreference: 'high-performance',
      });
    } finally {
      globals.WebGLRenderingContext = savedWebGLRenderingContext;
    }
    // Expo GL already exposes a device-pixel drawing buffer; scaling it again
    // with devicePixelRatio can render outside the actual framebuffer.
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Moving shadow frustum: refreshed from the loop every other frame.
    this.renderer.shadowMap.autoUpdate = false;

    // 2. Scene
    this.scene = new THREE.Scene();

    // 3. Camera
    this.camera = new THREE.PerspectiveCamera(62, width / height, 0.1, 300);
    this.camera.position.set(0, 4.0, -10.4);
    this.camera.lookAt(0, 1.1, 2.8);

    // 4. World Manager (initialized later via initWorld())
    // this.world is set by initWorld() after the environment builder completes.

    // 5. Character Controller
    this.character = new CharacterController(customization);
    this.character.position.set(0, 0, 0);
    this.scene.add(this.character.group);

    // 6. Tap-to-walk visual pulse marker
    const ringGeo = new THREE.RingGeometry(0.35, 0.55, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
    });
    this.tapMarkerMesh = new THREE.Mesh(ringGeo, ringMat);
    this.tapMarkerMesh.rotation.x = -Math.PI / 2;
    this.tapMarkerMesh.position.y = 0.03;
    this.scene.add(this.tapMarkerMesh);

    // Initial greeting
    setTimeout(() => {
      audio.speak('Hi Oshu! Welcome to BenTown! Tap anywhere to explore!');
    }, 1200);
  }

  public async initWorld(): Promise<void> {
    this.world = new WorldManager(this.scene, Math.min(4, this.renderer.capabilities.getMaxAnisotropy()));
    this.world.onStage = this.onLoadStage;
    await this.world.init();
    await this.world.loadVehicleModels();
    this.renderer.shadowMap.needsUpdate = true;
    console.log('[GameEngine] World initialized with city models.');
  }

  public start() {
    this.isRunning = true;
    this.startedAt = performance.now();
    audio.startBGM();
    this.lastTime = performance.now();
    this.loop(this.lastTime);
  }

  public stop() {
    this.isRunning = false;
    audio.pauseAll();
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  public updateCustomization(customization: OshuCustomization) {
    if (this.character) {
      this.character.updateCustomization(customization);
    }
  }

  // --- Zone Quick Navigation ---
  public navigateToZone(zoneId: string) {
    if (this.isDriving) {
      this.exitVehicle();
    }

    let targetX = 0;
    let targetZ = 0;
    let phrase = '';

    switch (zoneId) {
      case 'home':
        targetX = 0;
        targetZ = 0;
        phrase = 'City Center';
        break;
      case 'playground':
        targetX = -28;
        targetZ = -18;
        phrase = 'Suburban District';
        break;
      case 'market':
        targetX = 35;
        targetZ = -19;
        phrase = 'BenTown Mall';
        break;
      case 'meadow':
        targetX = -20;
        targetZ = 18;
        phrase = 'Mountain Pass';
        break;
      case 'garage':
        targetX = 35;
        targetZ = 14.5;
        phrase = 'Fuel Stop';
        break;
      case 'music':
        targetX = 0;
        targetZ = 29;
        phrase = 'Night District';
        break;
      case 'learn':
        targetX = 122;
        targetZ = 0;
        phrase = 'Learning Park';
        break;
    }

    const safePosition = this.world.findNearestWalkablePosition(new THREE.Vector3(targetX, 0, targetZ));
    this.character.position.copy(safePosition);
    this.character.velocity.set(0, 0, 0);
    this.character.targetDestination = null;
    this.character.rotationY = 0;

    // Star burst and audio
    this.world.spawnStarParticles(new THREE.Vector3(safePosition.x, 1.2, safePosition.z), 0xfacc15, 24);
    audio.playChime();
    audio.speak(phrase);
    haptics.medium();
  }

  // --- Tap to walk and Direct Tap-to-Interact ---
  public handleTap(normalizedX: number, normalizedY: number) {
    if (this.isDriving || this.isSliding) return;

    this.raycaster.setFromCamera(new THREE.Vector2(normalizedX, normalizedY), this.camera);

    // 1. Check if the toddler tapped an interactive object directly!
    const directHit = this.world.getInteractiveObjectAtRay(this.raycaster);
    if (directHit) {
      this.currentTarget = directHit;
      if (this.onTargetChange) {
        this.onTargetChange(directHit);
      }
      this.triggerCurrentAction();
      return;
    }

    // 2. Otherwise: Tap-to-walk ground plane raycasting
    const hitPoint = new THREE.Vector3();
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, hitPoint);

    if (hit) {
      if (this.world.isPositionBlocked(hitPoint.x, hitPoint.z)) return;
      this.character.targetDestination = hitPoint.clone();

      // Show tap ring marker
      this.tapMarkerMesh.position.x = hitPoint.x;
      this.tapMarkerMesh.position.z = hitPoint.z;
      (this.tapMarkerMesh.material as THREE.MeshBasicMaterial).opacity = 0.95;
      this.tapMarkerMesh.scale.set(1, 1, 1);

      this.world.spawnStarParticles(new THREE.Vector3(hitPoint.x, 0.2, hitPoint.z), 0x38bdf8, 8);
      audio.playPop();
      haptics.light();
    }
  }

  // --- Contextual Action Button Trigger ---
  public triggerCurrentAction() {
    if (this.isDriving && this.activeVehicle) {
      this.honkVehicle();
      return;
    }

    if (!this.currentTarget) {
      return;
    }

    switch (this.currentTarget.type) {
      case 'mirror':
        if (this.onOpenWardrobe) {
          this.onOpenWardrobe();
        }
        break;

      case 'trampoline':
        this.character.jump(14.0);
        audio.playBoing();
        this.world.spawnStarParticles(this.world.trampolineGroup.position, 0x8b5cf6, 24);
        audio.speak('Super bounce! High into the sky!');
        haptics.medium();
        break;

      case 'slide':
        this.startSlide();
        break;

      case 'bear':
        const bearMsg = this.world.triggerFeedBear();
        this.showSpeechBubble({
          id: ++this.messageCounter,
          title: 'Crunch! Crunch!',
          subtitle: bearMsg,
          emoji: '🐻',
        });
        break;

      case 'animal':
        const animalMsg = this.world.triggerAnimal(this.currentTarget.id);
        this.showSpeechBubble({
          id: ++this.messageCounter,
          title: this.currentTarget.name,
          subtitle: animalMsg,
          emoji: '🐾',
        });
        break;

      case 'vehicle':
        this.enterVehicle(this.currentTarget.metadata);
        break;

      case 'letter':
        const item = this.world.triggerLetterBlock(this.currentTarget.metadata.letter);
        if (item) {
          this.showSpeechBubble({
            id: ++this.messageCounter,
            title: `Letter ${item.letter}`,
            subtitle: `${item.word}! (${item.phonics})`,
            letter: item.letter,
            emoji: item.emoji,
            color: item.color,
          });
        }
        break;

      case 'balloon':
        const popped = this.world.triggerBalloon(this.currentTarget.metadata.num);
        if (popped) {
          this.showSpeechBubble({
            id: ++this.messageCounter,
            title: `Number ${this.currentTarget.metadata.num}!`,
            subtitle: 'Pop! Pop! Pop!',
            number: this.currentTarget.metadata.num,
            emoji: '🎈',
            color: this.currentTarget.metadata.color,
          });
        }
        break;

      case 'pedestrian':
        const pedMsg = this.world.triggerPedestrian(this.currentTarget.name);
        this.showSpeechBubble({
          id: ++this.messageCounter,
          title: `Hi ${this.currentTarget.name}!`,
          subtitle: pedMsg || `Welcome to BenTown! 👋`,
          emoji: '👋',
        });
        break;

      case 'shop':
        const shopMsg = this.world.triggerShop(this.currentTarget.id);
        this.showSpeechBubble({
          id: ++this.messageCounter,
          title: this.currentTarget.name,
          subtitle: shopMsg || `Let's explore ${this.currentTarget.name}, Oshu!`,
          emoji: '🏬',
        });
        break;

      default:
        this.character.jump(9.0);
        audio.playBoing();
        break;
    }
  }

  public setJoystickVector(vector: { x: number; y: number } | null) {
    const previousX = this.joystickVector?.x ?? 0;
    const nextX = vector?.x ?? 0;
    const wasTurning = Math.abs(previousX) > 0.5;
    const isTurning = Math.abs(nextX) > 0.5;

    // Count the button-down event here so quick taps are never lost between
    // animation frames. One press equals one turn; release arms the next press.
    if (isTurning && !wasTurning) {
      const direction = Math.sign(nextX);
      if (this.isDriving) this.pendingVehicleTurns.push(direction);
      else this.character?.turnByControl(direction);
    }

    this.joystickVector = vector;
  }

  /**
   * Toddler-friendly: walking up to any vehicle and bumping into it gets the child in (the Drive
   * button also works from ~3 m). A short cooldown after getting out prevents hopping straight back in.
   */
  private checkAutoEnterVehicle(delta: number) {
    if (this.isDriving || this.isSliding || !this.world || Date.now() < this.enterCooldownUntil) {
      this.autoEnterTimer = 0;
      return;
    }
    const position = this.character.position;
    const touching = this.world.vehicles.find((vehicle) => this.world.distanceToVehicleBody(vehicle, position.x, position.z) < 0.85);
    // "Trying to move" counts too: collision zeroes the velocity while the child pushes against the body.
    const pushing = Math.hypot(this.joystickVector?.x ?? 0, this.joystickVector?.y ?? 0) > 0.3 || !!this.character.targetDestination;
    const moving = pushing || Math.hypot(this.character.velocity.x, this.character.velocity.z) > 0.3;
    if (touching && moving) {
      this.autoEnterTimer += delta;
      if (this.autoEnterTimer > 0.35) {
        this.autoEnterTimer = 0;
        this.enterVehicle(touching);
      }
    } else {
      this.autoEnterTimer = 0;
    }
  }

  // --- Vehicle Enter / Exit / Drive ---
  public enterVehicle(vehicle: any) {
    // A hijacked traffic car stops following its lane (it would otherwise resume driving off-road after exit).
    this.world.releaseTrafficVehicle(vehicle);
    this.activeVehicle = vehicle;
    vehicle.active = true;
    vehicle.group.userData.playerDriven = true;
    // Forget the previous ride's recovery spots, otherwise a crash could send this vehicle there.
    this.resetDriveAssist(vehicle);
    this.isDriving = true;
    this.autoDrive = false;
    vehicle.steerAngle = vehicle.group.rotation.y;
    this.pendingVehicleTurns.length = 0;
    this.character.setDriveMode();
    const isMotorcycle = vehicle.id === 'night-district-motorcycle';
    if (isMotorcycle) {
      vehicle.group.add(this.character.group);
      // The bike seat is behind the tank. Keep the player model at that seat
      // height so the rider is visible from the chase camera.
      this.character.group.position.set(0, 0.7, -0.42);
      this.character.group.rotation.set(0, 0, 0);
      this.character.group.scale.setScalar(0.92);
      this.character.rotationY = 0;
      this.character.targetRotationY = 0;
      this.character.setVehicleRiderMode(true);
    } else {
      this.character.setVehicleRiderMode(false, true);
    }
    audio.playHonk();
    audio.speak(`Vroom vroom! Driving the ${vehicle.name}! Let's go!`);
    haptics.success();

    if (this.onVehicleChange) {
      this.onVehicleChange(true, vehicle.name);
    }
  }

  public exitVehicle() {
    if (!this.isDriving || !this.activeVehicle) return;

    // Step out on the vehicle's right-hand side, then snap to open ground so the
    // child never lands inside a wall or another vehicle.
    const vehicle = this.activeVehicle;
    const heading = vehicle.steerAngle;
    const side = (vehicle.halfExtents?.x ?? 0.8) + 1.1;
    const exitPos = vehicle.group.position.clone();
    exitPos.x += Math.cos(heading) * side;
    exitPos.z -= Math.sin(heading) * side;
    exitPos.y = 0;
    exitPos.copy(this.world.findNearestWalkablePosition(exitPos, 8));
    if (this.character.group.parent !== this.scene) this.scene.attach(this.character.group);
    this.character.group.scale.setScalar(1);
    this.character.group.rotation.set(0, 0, 0);
    this.character.position.copy(exitPos);
    this.character.group.position.copy(exitPos);
    this.character.setVehicleRiderMode(false);
    this.character.group.visible = true; // never leave the child invisible after getting out
    this.character.setWalkMode();
    this.enterCooldownUntil = Date.now() + 2500; // do not hop straight back in
    this.autoEnterTimer = 0;

    this.activeVehicle.active = false;
    this.isDriving = false;
    this.autoDrive = false;
    this.pendingVehicleTurns.length = 0;
    this.activeVehicle = null;

    audio.stopVehicleEngine();
    audio.speak('Hop out! Great driving Oshu!');
    haptics.light();

    if (this.onVehicleChange) {
      this.onVehicleChange(false);
    }
  }

  public setAutoDrive(enabled: boolean) {
    this.autoDrive = enabled && this.isDriving;
  }

  public honkVehicle() {
    if (!this.isDriving || !this.activeVehicle) return;
    audio.playHonk();
    this.world.spawnStarParticles(this.activeVehicle.group.position, 0xef4444, 18);
    audio.speak('Beep beep! Clear the way for Oshu!');
    haptics.medium();
  }

  // --- Slide Down Animation ---
  private startSlide() {
    this.isSliding = true;
    this.slideProgress = 0;
    this.character.setSlideMode();
    audio.playSlide();
    audio.speak('Wheeeee! Down the big slide!');
    haptics.medium();
  }

  private updateSlide(delta: number) {
    this.slideProgress += delta * 0.95;
    const startY = 3.2;
    const endY = 0.3;
    const startZ = -6.0;
    const endZ = -1.5;

    const t = Math.min(1, this.slideProgress);
    this.character.position.set(
      -20,
      THREE.MathUtils.lerp(startY, endY, t),
      THREE.MathUtils.lerp(startZ, endZ, t)
    );
    this.character.rotationY = 0;

    if (this.slideProgress >= 1) {
      this.isSliding = false;
      this.character.setWalkMode();
      this.character.jump(5.5);
      audio.playCheer();
    }
  }

  private showSpeechBubble(msg: SpeechMessage) {
    if (this.onSpeechMessage) {
      this.onSpeechMessage(msg);
    }
  }

  // --- Main Animation Frame Loop ---
  private loop = (currentTime: number) => {
    if (!this.isRunning) return;

    const rawDelta = (currentTime - this.lastTime) / 1000;
    // Never negative (timestamps can jump backwards after a pause) and never huge (after a stall).
    const delta = Math.max(0, Math.min(rawDelta, 0.1));
    this.lastTime = currentTime;

    // 1. Update Movement
    if (this.isDriving && this.activeVehicle) {
      this.updateVehiclePhysics(delta);
    } else if (this.isSliding) {
      this.updateSlide(delta);
    } else {
      this.character.update(delta, this.joystickVector, (x, z) => this.world.isPositionBlocked(x, z));
    }

    this.checkAutoEnterVehicle(delta);

    const playerPos = this.isDriving && this.activeVehicle 
      ? this.activeVehicle.group.position 
      : this.character.position;
    audio.setWorldContext(
      playerPos.x,
      playerPos.z,
      this.isDriving,
      this.activeVehicle?.name,
      this.activeVehicle?.speed ?? 0
    );

    // 2. Update World
    if (this.world) {
      this.world.update(delta, playerPos);
      // The shadow pass redraws every shadow caster, which is expensive on a phone: refresh about 9x per second.
      const now = performance.now();
      if (now - this.lastShadowUpdate > this.shadowIntervalMs) {
        this.lastShadowUpdate = now;
        this.renderer.shadowMap.needsUpdate = true;
      }
    }

    // 3. Check Musical Stepping Stones
    if (this.world && !this.isDriving && !this.isSliding) {
      this.world.checkSteppingStones(this.character.position, (col) => {
        this.showSpeechBubble({
          id: ++this.messageCounter,
          title: col.name,
          subtitle: `Musical Note ${col.note}`,
          emoji: col.emoji,
          color: col.color,
        });
      });
    }

    // 4. Update Tap Marker fade
    if ((this.tapMarkerMesh.material as THREE.MeshBasicMaterial).opacity > 0) {
      (this.tapMarkerMesh.material as THREE.MeshBasicMaterial).opacity = Math.max(
        0,
        (this.tapMarkerMesh.material as THREE.MeshBasicMaterial).opacity - delta * 2.0
      );
      this.tapMarkerMesh.scale.addScalar(delta * 0.6);
    }

    // 5. Update Interactive Proximity Target
    const target = this.world ? this.world.getClosestInteractiveTarget(playerPos) : null;
    if (target?.id !== this.currentTarget?.id) {
      this.currentTarget = target;
      if (this.onTargetChange) {
        this.onTargetChange(target);
      }
    }

    // 6. Smooth Camera Tracking
    this.updateCamera(playerPos, delta);

    // 7. Render & Present Buffer
    this.adaptQuality(rawDelta);
    this.renderer.render(this.scene, this.camera);
    this.gl.endFrameEXP();

    this.animationFrameId = requestAnimationFrame(this.loop);
  };

  // --- Toddler-friendly driving assists -------------------------------------
  // 1. On a road the car straightens itself along the road and keeps to its lane.
  // 2. Hitting a wall/prop/vehicle backs the car up to the last good spot on the road.
  private driveSamples: { x: number; z: number; heading: number }[] = [];
  private driveSampleTimer = 0;
  private steerIdle = 0;
  private blockedTime = 0;
  private lastOopsAt = 0;
  private throttleLock = false;
  private autoEnterTimer = 0;
  private enterCooldownUntil = 0;
  private recovery: { fromX: number; fromZ: number; toX: number; toZ: number; fromHeading: number; toHeading: number; t: number; duration: number } | null = null;

  private resetDriveAssist(vehicle: any) {
    this.driveSamples = [{ x: vehicle.group.position.x, z: vehicle.group.position.z, heading: vehicle.group.rotation.y }];
    this.driveSampleTimer = 0;
    this.steerIdle = 0;
    this.blockedTime = 0;
    this.recovery = null;
  }

  private startRecovery(vh: any) {
    const here = vh.group.position;
    // Prefer the oldest recent on-road position that is a few metres back; else the newest; else the nearest road.
    // Newest on-road spot that is at least 4 m back (so it reverses only a short way).
    const far = [...this.driveSamples].reverse().find((sample) => Math.hypot(sample.x - here.x, sample.z - here.z) >= 4);
    const target = far ?? this.driveSamples[this.driveSamples.length - 1];
    let toX: number;
    let toZ: number;
    let toHeading: number;
    if (target && Math.hypot(target.x - here.x, target.z - here.z) > 1 && Math.hypot(target.x - here.x, target.z - here.z) < 30) {
      toX = target.x;
      toZ = target.z;
      toHeading = target.heading;
    } else {
      const point = this.world.nearestRoadPoint(here.x, here.z);
      toX = point.x;
      toZ = point.z;
      toHeading = point.heading;
    }
    // Face along the road: snap the heading to the nearest road axis.
    toHeading = Math.round(toHeading / (Math.PI / 2)) * (Math.PI / 2);
    const distance = Math.hypot(toX - here.x, toZ - here.z);
    this.recovery = {
      fromX: here.x, fromZ: here.z, toX, toZ,
      fromHeading: vh.steerAngle, toHeading,
      t: 0, duration: THREE.MathUtils.clamp(distance / 4, 0.9, 2.4),
    };
    const now = Date.now();
    if (now - this.lastOopsAt > 7000) {
      this.lastOopsAt = now;
      audio.playBoing();
      audio.speak("Oops! Bump! Let's back up and try again, Oshu!");
      haptics.light();
    }
  }

  private stepRecovery(vh: any, delta: number) {
    const r = this.recovery!;
    r.t = Math.min(1, r.t + delta / r.duration);
    const e = r.t * r.t * (3 - 2 * r.t);
    vh.group.position.x = THREE.MathUtils.lerp(r.fromX, r.toX, e);
    vh.group.position.z = THREE.MathUtils.lerp(r.fromZ, r.toZ, e);
    let diff = r.toHeading - r.fromHeading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    vh.steerAngle = r.fromHeading + diff * e;
    vh.group.rotation.y = vh.steerAngle;
    vh.speed = -3; // wheels roll backwards while it reverses
    if (r.t >= 1) {
      vh.steerAngle = r.toHeading;
      vh.group.rotation.y = r.toHeading;
      vh.speed = 0;
      this.recovery = null;
      this.blockedTime = 0;
      this.throttleLock = Math.abs(this.joystickVector?.y ?? 0) > 0.05;
    }
  }

  private updateVehiclePhysics(delta: number) {
    const vh = this.activeVehicle;
    if (this.recovery) {
      this.stepRecovery(vh, delta);
      return;
    }
    let manualThrottle = this.joystickVector?.y ?? 0;
    // After a back-up, a button still held down is ignored until it is released, so the car
    // does not bump straight into the same wall again.
    if (this.throttleLock) {
      if (Math.abs(manualThrottle) < 0.05) this.throttleLock = false;
      else manualThrottle = 0;
    }
    const throttle = Math.abs(manualThrottle) > 0.05 ? manualThrottle : this.autoDrive ? 0.65 : 0;
    const targetSpeed = throttle >= 0 ? throttle * 8.5 : throttle * 4.5;
    vh.speed = THREE.MathUtils.lerp(vh.speed, targetSpeed, delta * (Math.abs(throttle) > 0.05 ? 4 : 5));

    if (this.pendingVehicleTurns.length > 0) this.steerIdle = 0;
    else this.steerIdle += delta;
    while (this.pendingVehicleTurns.length > 0) {
      const direction = this.pendingVehicleTurns.shift()!;
      // Three.js uses radians, so each button press adds a 30 degree yaw step.
      const reverseDirection = vh.speed < -0.05 ? -1 : 1;
      vh.steerAngle += direction * reverseDirection * (Math.PI / 6);
    }

    const forwardX = Math.sin(vh.steerAngle);
    const forwardZ = Math.cos(vh.steerAngle);
    const nextX = vh.group.position.x + forwardX * vh.speed * delta;
    const nextZ = vh.group.position.z + forwardZ * vh.speed * delta;
    const halfLength = vh.halfExtents?.z ?? 1.7;
    const halfWidth = vh.halfExtents?.x ?? 0.74;
    const rightX = forwardZ;
    const rightZ = -forwardX;
    // Solid obstacles (buildings, tree trunks, other vehicles) at the vehicle's corners.
    const solid = [-1, 1].some((lengthSide) => [-1, 1].some((widthSide) =>
      this.world.isPositionBlocked(
        nextX + forwardX * halfLength * lengthSide + rightX * halfWidth * widthSide,
        nextZ + forwardZ * halfLength * lengthSide + rightZ * halfWidth * widthSide,
        0.18,
        vh.group
      )
    ));
    // A person only matters when they are in front of the vehicle in the direction it is going
    // (someone standing beside it must not stop it). The vehicle waits; it never backs up for a person.
    const direction = vh.speed !== 0 ? Math.sign(vh.speed) : Math.sign(throttle || 1);
    const personAhead = [-1, 0, 1].some((side) => this.world.isPersonAt(
      nextX + forwardX * direction * (halfLength + 0.8) + rightX * halfWidth * side,
      nextZ + forwardZ * direction * (halfLength + 0.8) + rightZ * halfWidth * side,
      0.25
    ));
    const blocked = solid || personAhead;

    if (blocked) {
      vh.speed = THREE.MathUtils.lerp(vh.speed, 0, delta * 8);
      if (!solid) { this.blockedTime = 0; vh.group.rotation.y = vh.steerAngle; return; }
      // Pushing into something for a moment (or crashing at speed) triggers the automatic back-up.
      if (Math.abs(throttle) > 0.05 || Math.abs(vh.speed) > 1) this.blockedTime += delta;
      if (this.blockedTime > 0.25) {
        this.startRecovery(vh);
        return;
      }
    } else {
      this.blockedTime = 0;
      vh.group.position.x = nextX;
      vh.group.position.z = nextZ;
      // Remember good on-road spots so a crash can return to one.
      this.driveSampleTimer += delta;
      if (this.driveSampleTimer > 0.4) {
        this.driveSampleTimer = 0;
        if (this.world.roadInfoAt(nextX, nextZ)) {
          this.driveSamples.push({ x: nextX, z: nextZ, heading: vh.steerAngle });
          if (this.driveSamples.length > 10) this.driveSamples.shift();
        }
      }
    }
    vh.group.rotation.y = vh.steerAngle;

    vh.group.position.x = Math.max(-200, Math.min(200, vh.group.position.x));
    vh.group.position.z = Math.max(-200, Math.min(200, vh.group.position.z));
  }

  /**
   * Keeps the game smooth on slower phones. If the average frame time stays above ~33 ms (under 30 fps)
   * for a couple of seconds, step down: 1) refresh shadows far less often, 2) turn shadows off.
   * Skipped during the first seconds (shader compilation hitches) and never steps back up.
   */
  private adaptQuality(deltaSeconds: number) {
    // A gap this long is a pause (app in the background, a throttled tab, a one-off hitch), not slowness.
    if (deltaSeconds > 0.5) return;
    this.frameTimeMs += (deltaSeconds * 1000 - this.frameTimeMs) * 0.05;
    const now = performance.now();
    if (now - this.startedAt < 6000 || now - this.lastQualityCheck < 2500 || this.qualityLevel >= 2) return;
    this.lastQualityCheck = now;
    if (this.frameTimeMs <= 33) return;
    this.qualityLevel += 1;
    if (this.qualityLevel === 1) {
      this.shadowIntervalMs = 400;
    } else {
      this.renderer.shadowMap.enabled = false;
      // Materials were compiled with the shadow code; rebuild them without it.
      this.scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((material) => { material.needsUpdate = true; });
      });
    }
    console.log(`[perf] frame time ${this.frameTimeMs.toFixed(1)} ms -> quality level ${this.qualityLevel}`);
  }

  private updateCamera(targetPos: THREE.Vector3, delta: number) {
    const heading = this.isDriving && this.activeVehicle
      ? this.activeVehicle.steerAngle
      : this.character.rotationY;
    const forward = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    const idealCamPos = targetPos.clone()
      .addScaledVector(forward, -this.cameraFollowDistance)
      .add(new THREE.Vector3(0, this.cameraFollowHeight, 0));
    const idealLookTarget = targetPos.clone()
      .addScaledVector(forward, this.cameraLookAhead)
      .add(new THREE.Vector3(0, 1.1, 0));
    const follow = 1 - Math.exp(-5.5 * delta);
    this.camera.position.lerp(idealCamPos, follow);
    this.cameraLookTarget.lerp(idealLookTarget, 1 - Math.exp(-7 * delta));
    this.camera.lookAt(this.cameraLookTarget);
  }
}
