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

  // Inputs
  public joystickVector: { x: number; y: number } | null = null;
  private pendingVehicleTurns: number[] = [];

  // UI Callbacks
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
    this.renderer = new THREE.WebGLRenderer({
      context: this.gl,
      // Phone screens are ~460 ppi: MSAA at full native resolution costs a lot
      // of fill rate for almost no visible gain, so only enable it on
      // lower-density / desktop surfaces.
      antialias: Math.max(width, height) < 1900,
      powerPreference: 'high-performance',
    });
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
    await this.world.init();
    await this.world.loadVehicleModels();
    this.renderer.shadowMap.needsUpdate = true;
    console.log('[GameEngine] World initialized with city models.');
  }

  public start() {
    this.isRunning = true;
    this.lastTime = performance.now();
    this.loop(this.lastTime);
  }

  public stop() {
    this.isRunning = false;
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

  // --- Vehicle Enter / Exit / Drive ---
  public enterVehicle(vehicle: any) {
    this.activeVehicle = vehicle;
    vehicle.active = true;
    vehicle.group.userData.playerDriven = true;
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
      this.character.setVehicleRiderMode(false);
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

    const exitPos = this.activeVehicle.group.position.clone();
    exitPos.x += 1.8;
    if (this.character.group.parent !== this.scene) this.scene.attach(this.character.group);
    this.character.group.scale.setScalar(1);
    this.character.group.rotation.set(0, 0, 0);
    this.character.position.copy(exitPos);
    this.character.group.position.copy(exitPos);
    this.character.setVehicleRiderMode(false);
    this.character.setWalkMode();

    this.activeVehicle.active = false;
    this.isDriving = false;
    this.autoDrive = false;
    this.pendingVehicleTurns.length = 0;
    this.activeVehicle = null;

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

    const delta = Math.min((currentTime - this.lastTime) / 1000, 0.1);
    this.lastTime = currentTime;

    // 1. Update Movement
    if (this.isDriving && this.activeVehicle) {
      this.updateVehiclePhysics(delta);
    } else if (this.isSliding) {
      this.updateSlide(delta);
    } else {
      this.character.update(delta, this.joystickVector, (x, z) => this.world.isPositionBlocked(x, z));
    }

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
      if ((this.frameCount++ & 1) === 0) this.renderer.shadowMap.needsUpdate = true;
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
    this.renderer.render(this.scene, this.camera);
    this.gl.endFrameEXP();

    this.animationFrameId = requestAnimationFrame(this.loop);
  };

  private updateVehiclePhysics(delta: number) {
    const vh = this.activeVehicle;
    const manualThrottle = this.joystickVector?.y ?? 0;
    const throttle = Math.abs(manualThrottle) > 0.05 ? manualThrottle : this.autoDrive ? 0.65 : 0;
    const targetSpeed = throttle >= 0 ? throttle * 8.5 : throttle * 4.5;
    vh.speed = THREE.MathUtils.lerp(vh.speed, targetSpeed, delta * (Math.abs(throttle) > 0.05 ? 4 : 5));

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
    const halfLength = vh.id === 'night-district-motorcycle' ? 1.1 : 1.7;
    const halfWidth = vh.id === 'night-district-motorcycle' ? 0.42 : 0.74;
    const rightX = forwardZ;
    const rightZ = -forwardX;
    const blocked = [-1, 1].some((lengthSide) => [-1, 1].some((widthSide) =>
      this.world.isPositionBlocked(
        nextX + forwardX * halfLength * lengthSide + rightX * halfWidth * widthSide,
        nextZ + forwardZ * halfLength * lengthSide + rightZ * halfWidth * widthSide,
        0.18
      )
    ));

    if (blocked) {
      vh.speed = THREE.MathUtils.lerp(vh.speed, 0, delta * 8);
    } else {
      vh.group.position.x = nextX;
      vh.group.position.z = nextZ;
    }
    vh.group.rotation.y = vh.steerAngle;

    vh.group.position.x = Math.max(-100, Math.min(100, vh.group.position.x));
    vh.group.position.z = Math.max(-100, Math.min(100, vh.group.position.z));
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
