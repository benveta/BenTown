import * as THREE from 'three';
import { AnimationState, OshuCustomization } from '../types/game';
import { ChildHeadLoader } from './ChildHeadLoader';

export class CharacterController {
  public group: THREE.Group;
  public state: AnimationState = 'idle';

  // Movement properties
  public position: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  public velocity: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  public rotationY: number = 0;
  public targetRotationY: number = 0;
  public moveSpeed: number = 5.2; // Smooth toddler waddle speed

  // Tap-to-walk navigation
  public targetDestination: THREE.Vector3 | null = null;

  // Jump physics
  public isGrounded: boolean = true;
  public verticalVelocity: number = 0;
  public gravity: number = -22;
  public groundY: number = 0;

  // Hierarchy meshes & pivots
  private rootGroup: THREE.Group;
  private childModelGroup: THREE.Group;
  private torsoGroup: THREE.Group;
  private headGroup: THREE.Group;
  private leftArmGroup: THREE.Group;
  private rightArmGroup: THREE.Group;
  private leftLegGroup: THREE.Group;
  private rightLegGroup: THREE.Group;
  private shadowMesh: THREE.Mesh;

  // Materials for dynamic customization
  private shirtMaterial: THREE.MeshStandardMaterial;
  private hairMaterial: THREE.MeshStandardMaterial;
  private shoesMaterial: THREE.MeshStandardMaterial;
  private skinMaterial: THREE.MeshStandardMaterial;
  private pantsMaterial: THREE.MeshStandardMaterial;

  // Animation timing
  private animTimer: number = 0;

  constructor(customization: OshuCustomization) {
    this.group = new THREE.Group();

    // Create materials
    this.shirtMaterial = new THREE.MeshStandardMaterial({
      color: customization.shirtColor,
      roughness: 0.6,
    });
    this.hairMaterial = new THREE.MeshStandardMaterial({
      color: customization.hairColor,
      roughness: 0.5,
    });
    this.shoesMaterial = new THREE.MeshStandardMaterial({
      color: customization.shoesColor,
      roughness: 0.4,
    });
    this.skinMaterial = new THREE.MeshStandardMaterial({
      color: 0xb7775c, // Warm brown skin tone from the reference
      roughness: 0.7,
    });
    this.pantsMaterial = new THREE.MeshStandardMaterial({
      color: customization.pantsColor,
      roughness: 0.6,
    });

    // Create Hierarchy
    this.rootGroup = new THREE.Group();
    this.torsoGroup = new THREE.Group();
    this.headGroup = new THREE.Group();
    this.leftArmGroup = new THREE.Group();
    this.rightArmGroup = new THREE.Group();
    this.leftLegGroup = new THREE.Group();
    this.rightLegGroup = new THREE.Group();

    // Shadow
    const shadowGeo = new THREE.CircleGeometry(0.55, 24);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x223322,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    this.shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    this.shadowMesh.rotation.x = -Math.PI / 2;
    this.shadowMesh.position.y = 0.02;
    this.group.add(this.shadowMesh);

    this.buildOshuModel();
    this.group.add(this.rootGroup);
    this.childModelGroup = ChildHeadLoader.createChildCharacter(customization, () => {
      this.rootGroup.visible = false;
    });
    this.group.add(this.childModelGroup);
  }

  private buildOshuModel() {
    // 1. Torso (chunky toddler belly & t-shirt)
    const torsoGeo = new THREE.CylinderGeometry(0.3, 0.34, 0.55, 16);
    const torsoMesh = new THREE.Mesh(torsoGeo, this.shirtMaterial);
    torsoMesh.position.y = 0.28;
    this.torsoGroup.add(torsoMesh);

    // Cute dungarees / pants lower half
    const pantsGeo = new THREE.CylinderGeometry(0.33, 0.35, 0.24, 16);
    const pantsMesh = new THREE.Mesh(pantsGeo, this.pantsMaterial);
    pantsMesh.position.y = 0.12;
    this.torsoGroup.add(pantsMesh);

    // 2. A simple fallback face remains visible if the full GLB cannot load.
    this.headGroup.position.set(0, 0.65, 0);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 18), this.skinMaterial);
    head.position.y = 0.04;
    this.headGroup.add(head);

    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.44, 20, 14), this.hairMaterial);
    hairCap.scale.set(1.03, 0.62, 1.04);
    hairCap.position.set(0, 0.28, -0.03);
    this.headGroup.add(hairCap);

    const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
    const eyeColor = new THREE.MeshStandardMaterial({ color: 0x2a1b15, roughness: 0.35 });
    [-1, 1].forEach((side) => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 10), eyeWhite);
      eye.position.set(side * 0.14, 0.05, 0.365);
      this.headGroup.add(eye);

      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.036, 10, 8), eyeColor);
      pupil.position.set(side * 0.14, 0.05, 0.42);
      this.headGroup.add(pupil);
    });

    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), this.skinMaterial);
    nose.position.set(0, -0.055, 0.41);
    this.headGroup.add(nose);

    this.torsoGroup.add(this.headGroup);

    // 3. Arms (Chubby, cheerful limbs with mitten hands)
    const sleeveGeo = new THREE.CylinderGeometry(0.1, 0.09, 0.16, 12);
    const armGeo = new THREE.CylinderGeometry(0.08, 0.07, 0.26, 12);
    const handGeo = new THREE.SphereGeometry(0.085, 12, 12);

    // Left Arm
    this.leftArmGroup.position.set(-0.38, 0.45, 0);
    const leftSleeve = new THREE.Mesh(sleeveGeo, this.shirtMaterial);
    leftSleeve.position.y = -0.08;
    this.leftArmGroup.add(leftSleeve);

    const leftForearm = new THREE.Mesh(armGeo, this.skinMaterial);
    leftForearm.position.y = -0.22;
    this.leftArmGroup.add(leftForearm);

    const leftHand = new THREE.Mesh(handGeo, this.skinMaterial);
    leftHand.position.y = -0.36;
    this.leftArmGroup.add(leftHand);

    this.torsoGroup.add(this.leftArmGroup);

    // Right Arm
    this.rightArmGroup.position.set(0.38, 0.45, 0);
    const rightSleeve = new THREE.Mesh(sleeveGeo, this.shirtMaterial);
    rightSleeve.position.y = -0.08;
    this.rightArmGroup.add(rightSleeve);

    const rightForearm = new THREE.Mesh(armGeo, this.skinMaterial);
    rightForearm.position.y = -0.22;
    this.rightArmGroup.add(rightForearm);

    const rightHand = new THREE.Mesh(handGeo, this.skinMaterial);
    rightHand.position.y = -0.36;
    this.rightArmGroup.add(rightHand);

    this.torsoGroup.add(this.rightArmGroup);

    // 4. Legs & Shoes (Chubby legs with cute sneakers)
    const legGeo = new THREE.CylinderGeometry(0.1, 0.09, 0.28, 12);
    const shoeGeo = new THREE.BoxGeometry(0.18, 0.12, 0.28);
    const soleGeo = new THREE.BoxGeometry(0.2, 0.04, 0.3);
    const soleMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8 });

    // Left Leg
    this.leftLegGroup.position.set(-0.16, 0.4, 0);
    const leftLegMesh = new THREE.Mesh(legGeo, this.skinMaterial);
    leftLegMesh.position.y = -0.14;
    this.leftLegGroup.add(leftLegMesh);

    const leftShoe = new THREE.Mesh(shoeGeo, this.shoesMaterial);
    leftShoe.position.set(0, -0.3, 0.05);
    this.leftLegGroup.add(leftShoe);

    const leftSole = new THREE.Mesh(soleGeo, soleMat);
    leftSole.position.set(0, -0.36, 0.05);
    this.leftLegGroup.add(leftSole);

    this.rootGroup.add(this.leftLegGroup);

    // Right Leg
    this.rightLegGroup.position.set(0.16, 0.4, 0);
    const rightLegMesh = new THREE.Mesh(legGeo, this.skinMaterial);
    rightLegMesh.position.y = -0.14;
    this.rightLegGroup.add(rightLegMesh);

    const rightShoe = new THREE.Mesh(shoeGeo, this.shoesMaterial);
    rightShoe.position.set(0, -0.3, 0.05);
    this.rightLegGroup.add(rightShoe);

    const rightSole = new THREE.Mesh(soleGeo, soleMat);
    rightSole.position.set(0, -0.36, 0.05);
    this.rightLegGroup.add(rightSole);

    this.rootGroup.add(this.rightLegGroup);

    // Add torso to root
    this.torsoGroup.position.y = 0.4;
    this.rootGroup.add(this.torsoGroup);
  }

  // --- Dynamic Color Customization ---
  public updateCustomization(customization: OshuCustomization) {
    this.shirtMaterial.color.set(customization.shirtColor);
    this.hairMaterial.color.set(customization.hairColor);
    this.shoesMaterial.color.set(customization.shoesColor);
    this.pantsMaterial.color.set(customization.pantsColor);
    ChildHeadLoader.updateCustomization(customization);
  }

  // --- Actions ---
  public jump(power: number = 8.5) {
    if (this.isGrounded) {
      this.verticalVelocity = power;
      this.isGrounded = false;
      this.state = 'jump';
    }
  }

  public cheer() {
    this.state = 'cheer';
    this.animTimer = 0;
  }

  public setSlideMode() {
    this.state = 'slide';
  }

  public setDriveMode() {
    this.state = 'drive';
  }

  public setVehicleRiderMode(isRiding: boolean) {
    // Keep Oshu's actual GLB visible while seated on a motorcycle, and hide
    // the ground shadow that would otherwise float above the pavement.
    this.group.visible = isRiding;
    this.shadowMesh.visible = !isRiding;
    if (isRiding) {
      this.childModelGroup.rotation.y = 0;
      this.childModelGroup.rotation.x = -0.12;
    }
  }

  public setWalkMode() {
    this.state = 'walk';
  }

  public turnByControl(direction: number) {
    if (!direction) return;
    const turnStep = Math.PI / 6;
    const nextHeading = this.targetRotationY + Math.sign(direction) * turnStep;
    this.targetRotationY = THREE.MathUtils.euclideanModulo(nextHeading + Math.PI, Math.PI * 2) - Math.PI;
    this.targetDestination = null;
    this.velocity.set(0, this.velocity.y, 0);
  }

  public setIdleMode() {
    this.state = 'idle';
  }

  // --- Update loop ---
  public update(
    delta: number,
    joystickInput: { x: number; y: number } | null,
    isPositionBlocked?: (x: number, z: number) => boolean
  ) {
    this.animTimer += delta;

    // Movement calculation
    let isMoving = false;

    if (this.state !== 'slide' && this.state !== 'drive') {
      // 1. Process Joystick Input
      if (joystickInput && (Math.abs(joystickInput.x) > 0.05 || Math.abs(joystickInput.y) > 0.05)) {
        this.targetDestination = null; // Joystick cancels tap-to-move
        const moveInput = joystickInput.y;
        isMoving = Math.abs(moveInput) > 0.05;

        // Forward/back follows Oshu's current heading. Left/right are discrete
        // yaw steps delivered by turnByControl(), not world-axis strafing.
        this.velocity.x = Math.sin(this.targetRotationY) * moveInput * this.moveSpeed;
        this.velocity.z = Math.cos(this.targetRotationY) * moveInput * this.moveSpeed;
      } 
      // 2. Process Tap-to-Move Navigation
      else if (this.targetDestination) {
        const dx = this.targetDestination.x - this.position.x;
        const dz = this.targetDestination.z - this.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist > 0.25) {
          isMoving = true;
          const dirX = dx / dist;
          const dirZ = dz / dist;

          this.velocity.x = dirX * this.moveSpeed;
          this.velocity.z = dirZ * this.moveSpeed;
          this.targetRotationY = Math.atan2(dirX, dirZ);
        } else {
          // Reached destination!
          this.targetDestination = null;
          this.velocity.x = 0;
          this.velocity.z = 0;
        }
      } else {
        // Friction / stop
        this.velocity.x = 0;
        this.velocity.z = 0;
      }
    }

    // Resolve movement one axis at a time so the player slides along building walls.
    const nextX = Math.max(-100, Math.min(100, this.position.x + this.velocity.x * delta));
    if (!isPositionBlocked || !isPositionBlocked(nextX, this.position.z)) {
      this.position.x = nextX;
    } else {
      this.velocity.x = 0;
      this.targetDestination = null;
    }

    const nextZ = Math.max(-100, Math.min(100, this.position.z + this.velocity.z * delta));
    if (!isPositionBlocked || !isPositionBlocked(this.position.x, nextZ)) {
      this.position.z = nextZ;
    } else {
      this.velocity.z = 0;
      this.targetDestination = null;
    }

    // Smooth rotation towards target angle
    let diff = this.targetRotationY - this.rotationY;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    this.rotationY += diff * Math.min(1, delta * 12);
    this.rootGroup.rotation.y = this.rotationY;
    this.childModelGroup.rotation.y = this.rotationY;

    // Vertical Physics (Jump / Trampoline / Gravity)
    if (!this.isGrounded) {
      this.verticalVelocity += this.gravity * delta;
      this.position.y += this.verticalVelocity * delta;

      if (this.position.y <= this.groundY) {
        this.position.y = this.groundY;
        this.verticalVelocity = 0;
        this.isGrounded = true;
        if (this.state === 'jump') {
          this.state = isMoving ? 'walk' : 'idle';
        }
      }
    }

    // Update root group and shadow position
    this.group.position.copy(this.position);

    // Shadow scales with height
    const heightAboveGround = this.position.y - this.groundY;
    const shadowScale = Math.max(0.4, 1.0 - heightAboveGround * 0.15);
    this.shadowMesh.scale.set(shadowScale, shadowScale, 1);
    this.shadowMesh.position.y = -this.position.y + 0.02;

    // State update based on movement
    if (this.isGrounded && this.state !== 'cheer' && this.state !== 'slide' && this.state !== 'drive') {
      if (isMoving) {
        this.state = 'walk';
      } else {
        this.state = 'idle';
      }
    }

    // Animate Rig
    this.animateRig(delta, isMoving);
    this.animateChildModel();
  }

  private animateRig(delta: number, isMoving: boolean) {
    const t = this.animTimer;

    switch (this.state) {
      case 'idle': {
        // Toddler breathing and gentle sway
        this.torsoGroup.position.y = 0.4 + Math.sin(t * 2.5) * 0.015;
        this.headGroup.rotation.z = Math.sin(t * 1.5) * 0.08; // Inquisitive head tilt
        this.headGroup.rotation.x = Math.sin(t * 2) * 0.04;
        this.torsoGroup.rotation.z = 0;

        // Reset limbs
        this.leftLegGroup.rotation.x = THREE.MathUtils.lerp(this.leftLegGroup.rotation.x, 0, 0.1);
        this.rightLegGroup.rotation.x = THREE.MathUtils.lerp(this.rightLegGroup.rotation.x, 0, 0.1);
        this.leftArmGroup.rotation.x = THREE.MathUtils.lerp(this.leftArmGroup.rotation.x, 0.1, 0.1);
        this.rightArmGroup.rotation.x = THREE.MathUtils.lerp(this.rightArmGroup.rotation.x, 0.1, 0.1);
        this.leftArmGroup.rotation.z = THREE.MathUtils.lerp(this.leftArmGroup.rotation.z, 0.15, 0.1);
        this.rightArmGroup.rotation.z = THREE.MathUtils.lerp(this.rightArmGroup.rotation.z, -0.15, 0.1);
        break;
      }

      case 'walk':
      case 'run': {
        const freq = 9.5; // energetic toddler waddle frequency
        const legAmp = 0.65;
        const armAmp = 0.75;

        // Signature toddler waddle roll
        this.torsoGroup.rotation.z = Math.sin(t * freq) * 0.09;
        this.torsoGroup.position.y = 0.4 + Math.abs(Math.sin(t * freq)) * 0.05;
        this.headGroup.rotation.z = -Math.sin(t * freq) * 0.06;

        // Alternating legs
        this.leftLegGroup.rotation.x = Math.sin(t * freq) * legAmp;
        this.rightLegGroup.rotation.x = -Math.sin(t * freq) * legAmp;

        // Alternating arms pumping happily
        this.leftArmGroup.rotation.x = -Math.sin(t * freq) * armAmp;
        this.rightArmGroup.rotation.x = Math.sin(t * freq) * armAmp;
        this.leftArmGroup.rotation.z = 0.25;
        this.rightArmGroup.rotation.z = -0.25;
        break;
      }

      case 'jump': {
        // Arms joyfully flung high into the sky!
        this.leftArmGroup.rotation.x = THREE.MathUtils.lerp(this.leftArmGroup.rotation.x, -2.4, 0.15);
        this.rightArmGroup.rotation.x = THREE.MathUtils.lerp(this.rightArmGroup.rotation.x, -2.4, 0.15);
        this.leftArmGroup.rotation.z = THREE.MathUtils.lerp(this.leftArmGroup.rotation.z, 0.4, 0.15);
        this.rightArmGroup.rotation.z = THREE.MathUtils.lerp(this.rightArmGroup.rotation.z, -0.4, 0.15);

        // Legs tucked up slightly
        this.leftLegGroup.rotation.x = THREE.MathUtils.lerp(this.leftLegGroup.rotation.x, 0.45, 0.15);
        this.rightLegGroup.rotation.x = THREE.MathUtils.lerp(this.rightLegGroup.rotation.x, 0.45, 0.15);
        this.headGroup.rotation.x = -0.3; // Looking up
        break;
      }

      case 'cheer': {
        // Happy clapping & bouncing
        const clapFreq = 14;
        this.torsoGroup.position.y = 0.4 + Math.abs(Math.sin(t * 8)) * 0.1;
        this.leftArmGroup.rotation.x = -1.3;
        this.rightArmGroup.rotation.x = -1.3;
        this.leftArmGroup.rotation.z = 0.6 + Math.sin(t * clapFreq) * 0.35;
        this.rightArmGroup.rotation.z = -0.6 - Math.sin(t * clapFreq) * 0.35;
        this.headGroup.rotation.z = Math.sin(t * 6) * 0.12;

        if (this.animTimer > 2.2) {
          this.state = 'idle';
        }
        break;
      }

      case 'slide': {
        // Sitting pose with arms up
        this.leftLegGroup.rotation.x = -1.4;
        this.rightLegGroup.rotation.x = -1.4;
        this.leftArmGroup.rotation.x = -2.2;
        this.rightArmGroup.rotation.x = -2.2;
        this.torsoGroup.position.y = 0.18;
        break;
      }

      case 'drive': {
        // Seated driving pose
        this.leftLegGroup.rotation.x = -1.2;
        this.rightLegGroup.rotation.x = -1.2;
        this.leftArmGroup.rotation.x = -0.9;
        this.rightArmGroup.rotation.x = -0.9;
        this.leftArmGroup.rotation.z = 0.3;
        this.rightArmGroup.rotation.z = -0.3;
        this.torsoGroup.position.y = 0.22;
        break;
      }
    }
  }

  private animateChildModel() {
    if (!this.childModelGroup.visible) return;

    const t = this.animTimer;
    switch (this.state) {
      case 'walk':
      case 'run':
        this.childModelGroup.position.y = Math.abs(Math.sin(t * 9.5)) * 0.035;
        this.childModelGroup.rotation.z = Math.sin(t * 9.5) * 0.025;
        break;
      case 'cheer':
        this.childModelGroup.position.y = Math.abs(Math.sin(t * 8)) * 0.07;
        this.childModelGroup.rotation.z = Math.sin(t * 6) * 0.035;
        break;
      case 'slide':
        this.childModelGroup.position.y = 0;
        this.childModelGroup.rotation.x = -0.18;
        break;
      case 'drive':
        this.childModelGroup.position.y = -0.12;
        this.childModelGroup.rotation.x = -0.12;
        break;
      default:
        this.childModelGroup.position.y = Math.sin(t * 2.5) * 0.012;
        this.childModelGroup.rotation.x = 0;
        this.childModelGroup.rotation.z = Math.sin(t * 1.5) * 0.008;
        break;
    }
  }
}
