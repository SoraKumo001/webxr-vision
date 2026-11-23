import * as THREE from 'three';
import { AudioManager } from '../core/AudioManager';
import { InteractiveCallbacks } from '../core/InputManager';
import { Difficulty } from '../core/StorageManager';
import { DisplayMode } from '../core/XRManager';
import { SpatialButton, SpatialTextPanel } from '../ui/SpatialPanel';
import { ITrainingMode, TrainingHUDState, TrainingResult } from './ITrainingMode';
import {
  AQUATIC_GENERATORS,
  AquaticCategory,
  buildUnderwaterSanctuaryEnv,
  createAquaticSceneMaterial,
  createAquaticWaterMaterial,
  DIRECTIONAL_CATEGORIES,
  GROUNDED_CATEGORIES,
  mulberry32,
  SANCTUARY_RADIUS,
  SANCTUARY_WATER_Y,
  sandHeight,
  SWIMMING_CATEGORIES
} from './ProceduralAquariumBuilder';

type SanctuaryTheme = 'reef' | 'deep-jelly';

interface AquaticEntity {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  category: AquaticCategory;
  name: string;
  grounded: boolean;
  directional: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  swimSpeed: number;
  yaw: number;
  pitch: number;
  prevYaw: number;
  baseRot: number;
  rotSpeed: number;
  targetScale: number;
  transitionT: number;
  phase: number;
  wanderFreq: number;
  hovered: boolean;
}

export class AquaticRelaxMode implements ITrainingMode {
  public readonly id = 'aquatic-relax' as const;
  public readonly name = '5. 水中リラクゼーション';
  public readonly description = 'プロシージャルな海の生き物や水草に囲まれ、深呼吸と遠方注視で目を癒やします';
  public readonly group = new THREE.Group();

  private readonly arena = new THREE.Group();
  private readonly entitiesGroup = new THREE.Group();
  private readonly envGroup = new THREE.Group();
  private readonly interactiveObjects: THREE.Object3D[] = [];

  private readonly audio: AudioManager;
  private readonly getDisplayMode: () => DisplayMode;

  private readonly substrateMesh: THREE.Mesh;
  private readonly substrateMat: THREE.ShaderMaterial;
  private readonly waterSurfaceMesh: THREE.Mesh;
  private readonly bubblesMesh: THREE.Mesh;
  private readonly waterMat: THREE.ShaderMaterial;
  private readonly godRaysMat: THREE.ShaderMaterial;
  private readonly planktonMat: THREE.ShaderMaterial;

  private readonly domeBackdrop: THREE.Mesh;
  private readonly relaxPanel: SpatialTextPanel;
  private readonly breathRing: THREE.Mesh;
  private readonly btnSpawn: SpatialButton;
  private readonly btnTheme: SpatialButton;
  private readonly btnEnvToggle: SpatialButton;
  private readonly btnShowUi: SpatialButton;

  private entities: AquaticEntity[] = [];
  private theme: SanctuaryTheme = 'reef';
  private showEnvironment = true;
  private uiHidden = false;
  public onUiHiddenChange?: (hidden: boolean) => void;

  private durationTotal = 180;
  private remaining = 180;
  private elapsedInMode = 0;
  private watchedCount = 0;
  private breathCycles = 0;
  private lastBreathInhale = true;
  private chimeIndex = 0;
  private hoveredEntity: AquaticEntity | null = null;
  private hoveredDistMeters = 0;
  private spawnCounter = 0;

  private readonly maxSwimmers = 20;
  private readonly maxPlants = 12;
  private readonly tempVel = new THREE.Vector3();

  constructor(audio: AudioManager, getDisplayMode: () => DisplayMode) {
    this.audio = audio;
    this.getDisplayMode = getDisplayMode;

    this.group.add(this.arena);
    this.arena.add(this.envGroup);
    this.arena.add(this.entitiesGroup);

    // Subtle deep-ocean spherical backdrop for VR / Preview mode (hidden in MR)
    const domeGeo = new THREE.SphereGeometry(28, 32, 20);
    const domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vLocalDir;
        void main() {
          vLocalDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vLocalDir;
        uniform float uDeepMode;
        void main() {
          float h = clamp(vLocalDir.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 abyss = mix(vec3(0.01, 0.04, 0.08), vec3(0.008, 0.022, 0.055), uDeepMode);
          vec3 surface = mix(vec3(0.03, 0.18, 0.26), vec3(0.02, 0.09, 0.19), uDeepMode);
          vec3 col = mix(abyss, surface, smoothstep(0.12, 0.92, h));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      uniforms: {
        uDeepMode: { value: 0.0 }
      }
    });
    this.domeBackdrop = new THREE.Mesh(domeGeo, domeMat);
    this.arena.add(this.domeBackdrop);

    // Static seabed, overhead water surface, and rising air bubbles
    const envGeo = buildUnderwaterSanctuaryEnv();
    this.substrateMat = createAquaticSceneMaterial(0, 0.0, 1.0);
    this.substrateMesh = new THREE.Mesh(envGeo.substrateGeometry, this.substrateMat);
    this.envGroup.add(this.substrateMesh);

    this.waterMat = createAquaticWaterMaterial();
    this.waterSurfaceMesh = new THREE.Mesh(envGeo.waterSurfaceGeometry, this.waterMat);
    this.envGroup.add(this.waterSurfaceMesh);

    this.bubblesMesh = new THREE.Mesh(envGeo.bubblesGeometry, this.waterMat);
    this.arena.add(this.bubblesMesh);

    // Volumetric-style underwater god rays (inside envGroup so MR passthrough stays clean)
    this.godRaysMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uDeepMode: { value: 0 }
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vNormalView;
        varying vec3 vViewDir;
        void main() {
          vUv = uv;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vNormalView = normalize(normalMatrix * normal);
          vViewDir = normalize(-mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uDeepMode;
        varying vec2 vUv;
        varying vec3 vNormalView;
        varying vec3 vViewDir;

        void main() {
          float ndv = abs(dot(normalize(vNormalView), normalize(vViewDir)));
          float edgeFade = pow(ndv, 1.6);
          float vertFade = smoothstep(0.0, 0.35, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
          float shimmer = 0.72 + 0.28 * sin(vUv.x * 18.849 + uTime * 0.45);
          vec3 col = mix(vec3(0.22, 0.72, 0.78), vec3(0.14, 0.42, 0.78), uDeepMode);
          float alpha = edgeFade * vertFade * shimmer * mix(0.085, 0.045, uDeepMode);
          gl_FragColor = vec4(col, alpha);
        }
      `
    });
    const rayGeo = new THREE.CylinderGeometry(0.32, 1.45, 4.3, 18, 1, true);
    const raySpecs = [
      { x: -3.2, z: -4.2, rx: 0.14, rz: -0.18 },
      { x: 2.8, z: -4.8, rx: 0.12, rz: 0.16 },
      { x: 0.2, z: -5.8, rx: 0.18, rz: -0.08 },
      { x: -4.8, z: 0.6, rx: -0.06, rz: -0.2 },
      { x: 4.5, z: 0.9, rx: -0.08, rz: 0.18 },
      { x: -1.8, z: 4.6, rx: -0.16, rz: -0.1 },
      { x: 2.2, z: 4.2, rx: -0.14, rz: 0.12 }
    ];
    for (const s of raySpecs) {
      const ray = new THREE.Mesh(rayGeo, this.godRaysMat);
      ray.position.set(s.x, 0.35, s.z);
      ray.rotation.set(s.rx, 0, s.rz);
      this.envGroup.add(ray);
    }

    // Bioluminescent plankton / marine snow drifting through the sanctuary
    const planktonCount = 220;
    const pPos = new Float32Array(planktonCount * 3);
    const pPhase = new Float32Array(planktonCount);
    for (let i = 0; i < planktonCount; i++) {
      const r = 1.6 + Math.random() * 6.8;
      const ang = Math.random() * Math.PI * 2;
      pPos[i * 3] = Math.cos(ang) * r;
      pPos[i * 3 + 1] = -1.2 + Math.random() * 3.3;
      pPos[i * 3 + 2] = Math.sin(ang) * r;
      pPhase[i] = Math.random();
    }
    const planktonGeo = new THREE.BufferGeometry();
    planktonGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    planktonGeo.setAttribute('aPhase', new THREE.BufferAttribute(pPhase, 1));
    this.planktonMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uDeepMode: { value: 0 }
      },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        uniform float uTime;
        varying float vPhase;
        varying float vPulse;
        void main() {
          vPhase = aPhase;
          vec3 p = position;
          p.x += sin(uTime * 0.28 + aPhase * 12.0) * 0.25;
          p.y += cos(uTime * 0.22 + aPhase * 9.0) * 0.22;
          p.z += sin(uTime * 0.24 + aPhase * 15.0) * 0.25;
          vPulse = 0.45 + 0.55 * sin(uTime * (0.8 + mod(aPhase, 0.6)) + aPhase * 18.0);
          vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPos;
          float dist = max(0.8, -mvPos.z);
          gl_PointSize = clamp(0.08 * (260.0 / dist), 2.0, 18.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uDeepMode;
        varying float vPhase;
        varying float vPulse;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float glow = pow(1.0 - d * 2.0, 2.0);
          vec3 reefCol = mix(vec3(0.45, 0.95, 0.92), vec3(0.95, 0.86, 0.58), step(0.7, vPhase));
          vec3 deepCol = mix(vec3(0.22, 0.92, 1.0), vec3(0.92, 0.42, 0.88), step(0.55, vPhase));
          vec3 col = mix(reefCol, deepCol, uDeepMode);
          float alpha = glow * vPulse * mix(0.45, 0.72, uDeepMode);
          gl_FragColor = vec4(col, alpha);
        }
      `
    });
    const plankton = new THREE.Points(planktonGeo, this.planktonMat);
    plankton.frustumCulled = false;
    this.arena.add(plankton);

    // Breathing & creature inspection guide panel
    this.relaxPanel = new SpatialTextPanel(1.28, 0.22, 960, 168);
    this.relaxPanel.mesh.position.set(0, -0.31, -1.85);
    this.arena.add(this.relaxPanel.mesh);

    // Gentle expanding breathing halo above the panel
    this.breathRing = new THREE.Mesh(
      new THREE.RingGeometry(0.11, 0.128, 48),
      new THREE.MeshBasicMaterial({
        color: 0x38d9c0,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide
      })
    );
    this.breathRing.position.set(0, 0.04, -1.88);
    this.arena.add(this.breathRing);

    // Interactive Controls (centered symmetrically at x = -0.44, 0, +0.44)
    this.btnSpawn = new SpatialButton({
      width: 0.40,
      height: 0.13,
      label: '生き物を呼ぶ',
      fontSize: 27,
      borderColor: '#38d9c0',
      accentColor: '#38d9c0',
      gazeDwellSeconds: 0.7,
      onSelect: () => {
        this.spawnCreatureInFront();
        this.audio.playBubbleSound();
      }
    });
    this.btnSpawn.mesh.position.set(-0.44, -0.54, -1.7);
    this.arena.add(this.btnSpawn.mesh);

    this.btnTheme = new SpatialButton({
      width: 0.40,
      height: 0.13,
      label: 'テーマ: サンゴ礁',
      fontSize: 24,
      borderColor: '#2dd4bf',
      accentColor: '#2dd4bf',
      gazeDwellSeconds: 0.75,
      onSelect: () => {
        this.theme = this.theme === 'reef' ? 'deep-jelly' : 'reef';
        this.audio.playSelect();
        this.btnTheme.setLabel(
          this.theme === 'reef' ? 'テーマ: サンゴ礁' : 'テーマ: 深海クラゲ'
        );
        const isDeep = this.theme === 'deep-jelly' ? 1.0 : 0.0;
        (this.domeBackdrop.material as THREE.ShaderMaterial).uniforms.uDeepMode.value = isDeep;
        this.godRaysMat.uniforms.uDeepMode.value = isDeep;
        this.planktonMat.uniforms.uDeepMode.value = isDeep;
        this.populateSanctuary();
      }
    });
    this.btnTheme.mesh.position.set(0, -0.54, -1.7);
    this.arena.add(this.btnTheme.mesh);

    this.btnEnvToggle = new SpatialButton({
      width: 0.40,
      height: 0.13,
      label: '水底・水面: ON',
      fontSize: 24,
      borderColor: '#2dd4bf',
      accentColor: '#2dd4bf',
      gazeDwellSeconds: 0.75,
      onSelect: () => {
        this.showEnvironment = !this.showEnvironment;
        this.audio.playSelect();
        this.applyEnvironmentVisibility();
      }
    });
    this.btnEnvToggle.mesh.position.set(0.44, -0.54, -1.7);
    this.arena.add(this.btnEnvToggle.mesh);

    this.btnShowUi = new SpatialButton({
      width: 0.28,
      height: 0.10,
      label: 'UI表示',
      fontSize: 25,
      bgColor: '#06121c',
      borderColor: '#38d9c0',
      accentColor: '#38d9c0',
      gazeDwellSeconds: 0.75,
      onSelect: () => {
        this.setUiHidden(false);
        this.audio.playSelect();
      }
    });
    this.btnShowUi.mesh.position.set(0, -0.85, -1.7);
    this.btnShowUi.mesh.visible = false;
    this.arena.add(this.btnShowUi.mesh);
  }

  public start(difficulty: Difficulty, headPos: THREE.Vector3, headQuat: THREE.Quaternion): void {
    this.durationTotal = difficulty === 'easy' ? 120 : difficulty === 'normal' ? 180 : 240;
    this.remaining = this.durationTotal;
    this.elapsedInMode = 0;
    this.watchedCount = 0;
    this.breathCycles = 0;
    this.lastBreathInhale = true;
    this.hoveredEntity = null;
    this.spawnCounter = 0;

    const euler = new THREE.Euler().setFromQuaternion(headQuat, 'YXZ');
    this.arena.position.copy(headPos);
    this.arena.rotation.set(0, euler.y, 0);

    // In MR Passthrough, default seabed/dome off so creatures swim inside the user's real room
    const isMR = this.getDisplayMode() === 'mr';
    this.showEnvironment = !isMR;
    this.setUiHidden(false);
    this.applyEnvironmentVisibility();

    this.group.visible = true;
    this.populateSanctuary();
  }

  public recenter(headPos: THREE.Vector3, headQuat: THREE.Quaternion): void {
    const euler = new THREE.Euler().setFromQuaternion(headQuat, 'YXZ');
    this.arena.position.copy(headPos);
    this.arena.rotation.set(0, euler.y, 0);
  }

  public setUiHidden(hidden: boolean): void {
    this.uiHidden = hidden;
    this.relaxPanel.mesh.visible = !hidden;
    this.breathRing.visible = !hidden;
    this.btnSpawn.mesh.visible = !hidden;
    this.btnTheme.mesh.visible = !hidden;
    this.btnEnvToggle.mesh.visible = !hidden;
    this.btnShowUi.mesh.visible = hidden;
    this.syncInteractiveObjects();
    this.onUiHiddenChange?.(hidden);
  }

  public isUiHidden(): boolean {
    return this.uiHidden;
  }

  private applyEnvironmentVisibility(): void {
    const isMR = this.getDisplayMode() === 'mr';
    this.envGroup.visible = this.showEnvironment;
    this.domeBackdrop.visible = !isMR;
    this.btnEnvToggle.setLabel(`水底・水面: ${this.showEnvironment ? 'ON' : 'OFF'}`);
    this.btnEnvToggle.setActive(this.showEnvironment);

    const fogAmt = isMR ? 0.0 : 0.85;
    this.substrateMat.uniforms.uFogAmount.value = fogAmt;
    for (const ent of this.entities) {
      ent.material.uniforms.uFogAmount.value = fogAmt;
    }
  }

  private clearEntities(): void {
    for (const ent of this.entities) {
      this.entitiesGroup.remove(ent.mesh);
      ent.mesh.geometry.dispose();
      ent.material.dispose();
    }
    this.entities = [];
    this.hoveredEntity = null;
    this.syncInteractiveObjects();
  }

  private syncInteractiveObjects(): void {
    this.interactiveObjects.length = 0;
    if (this.uiHidden) {
      this.interactiveObjects.push(this.btnShowUi.mesh);
    } else {
      this.interactiveObjects.push(
        this.btnSpawn.mesh,
        this.btnTheme.mesh,
        this.btnEnvToggle.mesh
      );
    }
    for (const ent of this.entities) {
      if (!ent.grounded) {
        this.interactiveObjects.push(ent.mesh);
      }
    }
  }

  private populateSanctuary(): void {
    this.clearEntities();

    const plantSeedList: AquaticCategory[] = [
      'vallisneria', 'stem_plant', 'broadleaf_coral', 'vallisneria',
      'stem_plant', 'broadleaf_coral', 'vallisneria', 'broadleaf_coral',
      'stem_plant', 'vallisneria', 'broadleaf_coral', 'stem_plant'
    ];
    for (const pCat of plantSeedList) {
      this.spawnEntity(pCat, true);
    }

    const swimmerList: AquaticCategory[] =
      this.theme === 'deep-jelly'
        ? [
            'jellyfish', 'jellyfish', 'manta', 'jellyfish', 'squid',
            'jellyfish', 'manta', 'jellyfish', 'squid', 'jellyfish',
            'turtle', 'jellyfish', 'manta', 'jellyfish', 'seahorse'
          ]
        : [
            'tropical_fish', 'koi', 'turtle', 'manta', 'jellyfish',
            'tropical_fish', 'seahorse', 'squid', 'tropical_fish', 'koi',
            'jellyfish', 'manta', 'tropical_fish', 'turtle', 'tropical_fish',
            'koi', 'jellyfish', 'seahorse'
          ];

    for (const sCat of swimmerList) {
      this.spawnEntity(sCat, true);
    }
  }

  private spawnCreatureInFront(): void {
    const pool: AquaticCategory[] =
      this.theme === 'deep-jelly'
        ? ['jellyfish', 'manta', 'squid', 'turtle']
        : SWIMMING_CATEGORIES;
    const cat = pool[Math.floor(Math.random() * pool.length)];
    this.spawnEntity(cat, false, true);
  }

  private spawnEntity(
    forcedCat: AquaticCategory | null = null,
    startFull = false,
    inFront = false
  ): void {
    this.spawnCounter += 1;
    const seed = ((Date.now() + this.spawnCounter * 7919) >>> 0) || 1;
    const rng = mulberry32(seed);

    const cat =
      forcedCat ?? SWIMMING_CATEGORIES[Math.floor(rng() * SWIMMING_CATEGORIES.length)];
    const generated = AQUATIC_GENERATORS[cat](rng);
    const grounded = GROUNDED_CATEGORIES.has(cat);
    const directional = DIRECTIONAL_CATEGORIES.has(cat);

    if (grounded) {
      const plantCount = this.entities.filter((e) => e.grounded).length;
      if (plantCount >= this.maxPlants) {
        const idx = this.entities.findIndex((e) => e.grounded);
        if (idx !== -1) {
          const old = this.entities.splice(idx, 1)[0];
          this.entitiesGroup.remove(old.mesh);
          old.mesh.geometry.dispose();
          old.material.dispose();
        }
      }
    } else {
      const swimmerCount = this.entities.filter((e) => !e.grounded).length;
      if (swimmerCount >= this.maxSwimmers) {
        const idx = this.entities.findIndex((e) => !e.grounded);
        if (idx !== -1) {
          const old = this.entities.splice(idx, 1)[0];
          this.entitiesGroup.remove(old.mesh);
          old.mesh.geometry.dispose();
          old.material.dispose();
        }
      }
    }

    const material = createAquaticSceneMaterial(generated.animMode, generated.sss, 0.0);
    const isMR = this.getDisplayMode() === 'mr';
    material.uniforms.uFogAmount.value = isMR ? 0.0 : 0.85;

    const mesh = new THREE.Mesh(generated.geometry, material);

    let px = 0;
    let py = 0;
    let pz = -3.0;

    if (grounded) {
      const ang = rng() * Math.PI * 2;
      const dist = 2.6 + rng() * 5.2;
      px = Math.cos(ang) * dist;
      pz = Math.sin(ang) * dist;
      py = sandHeight(px, pz) - 0.04;
    } else if (inFront) {
      px = (rng() - 0.5) * 2.2;
      pz = -(2.6 + rng() * 1.8);
      py = (rng() - 0.35) * 0.9;
    } else {
      const ang = rng() * Math.PI * 2;
      const dist = 2.2 + rng() * 5.6;
      px = Math.cos(ang) * dist;
      pz = Math.sin(ang) * dist;
      const floorY = sandHeight(px, pz);
      py = floorY + 0.55 + rng() * (SANCTUARY_WATER_Y - 0.65 - (floorY + 0.55));
    }

    const scale = grounded
      ? 0.45 + rng() * 0.32
      : cat === 'tropical_fish' || cat === 'seahorse' || cat === 'squid'
        ? 0.28 + rng() * 0.18
        : 0.40 + rng() * 0.24;

    let swimSpeed = 0;
    if (!grounded) {
      if (cat === 'jellyfish') swimSpeed = 0.09 + rng() * 0.08;
      else if (cat === 'squid' || cat === 'seahorse') swimSpeed = 0.13 + rng() * 0.10;
      else if (directional) swimSpeed = 0.30 + rng() * 0.26;
      else swimSpeed = 0.12 + rng() * 0.14;
    }

    const heading = rng() * Math.PI * 2;
    const elev = (rng() - 0.5) * 0.24;
    const vel = grounded
      ? new THREE.Vector3(0, 0, 0)
      : new THREE.Vector3(
          Math.cos(elev) * Math.sin(heading) * swimSpeed,
          Math.sin(elev) * swimSpeed * 0.32,
          Math.cos(elev) * Math.cos(heading) * swimSpeed
        );

    const entity: AquaticEntity = {
      mesh,
      material,
      category: cat,
      name: generated.name,
      grounded,
      directional,
      pos: new THREE.Vector3(px, py, pz),
      vel,
      swimSpeed,
      yaw: heading,
      pitch: 0,
      prevYaw: heading,
      baseRot: rng() * Math.PI * 2,
      rotSpeed: grounded ? 0 : (rng() - 0.5) * 0.16,
      targetScale: scale,
      transitionT: startFull ? 1 : 0,
      phase: rng() * Math.PI * 2,
      wanderFreq: 0.10 + rng() * 0.15,
      hovered: false
    };

    if (!grounded) {
      const callbacks: InteractiveCallbacks = {
        gazeEnabled: false,
        onHover: () => {
          entity.hovered = true;
          this.hoveredEntity = entity;
          this.watchedCount += 1;
          this.audio.playUnderwaterChime(this.chimeIndex++);
        },
        onBlur: () => {
          entity.hovered = false;
          if (this.hoveredEntity === entity) {
            this.hoveredEntity = null;
          }
        },
        onSelect: () => {
          this.audio.playUnderwaterChime(this.chimeIndex++);
          // Gentle playful swim impulse away/along when tapped
          entity.vel.y += 0.12;
        }
      };
      mesh.userData = callbacks;
    }

    mesh.position.copy(entity.pos);
    mesh.scale.setScalar(startFull ? scale : 0.01);
    this.entitiesGroup.add(mesh);
    this.entities.push(entity);
    this.syncInteractiveObjects();
  }

  public stop(): TrainingResult {
    this.setUiHidden(false);
    this.clearEntities();
    this.group.visible = false;
    const duration = Math.max(1, Math.round(this.durationTotal - this.remaining));
    return {
      modeId: this.id,
      durationSec: duration,
      summary: `深呼吸 ${this.breathCycles}回 | 観察した生き物 ${this.watchedCount}匹`
    };
  }

  public update(dt: number, elapsed: number): boolean {
    this.remaining -= dt;
    this.elapsedInMode += dt;

    this.substrateMat.uniforms.uTime.value = elapsed;
    this.waterMat.uniforms.uTime.value = elapsed;
    this.godRaysMat.uniforms.uTime.value = elapsed;
    this.planktonMat.uniforms.uTime.value = elapsed;

    // 10-second slow deep-breathing cycle: 4s inhale, 6s exhale
    const cyclePos = this.elapsedInMode % 10;
    const inhaling = cyclePos < 4.0;
    if (inhaling !== this.lastBreathInhale) {
      this.lastBreathInhale = inhaling;
      if (inhaling) {
        this.breathCycles += 1;
      }
      this.audio.playBreathCue(inhaling);
    }

    const breathNorm = inhaling
      ? cyclePos / 4.0
      : 1.0 - (cyclePos - 4.0) / 6.0;
    const ringScale = 0.72 + breathNorm * 0.78;
    this.breathRing.scale.setScalar(ringScale);

    if (this.hoveredEntity) {
      this.hoveredDistMeters = this.hoveredEntity.pos.length();
    }

    // Update 3D swimming steering physics
    const maxRadius = SANCTUARY_RADIUS - 1.2;
    const personalBubble = 2.15;
    const yMax = SANCTUARY_WATER_Y - 0.5;

    for (let i = 0; i < this.entities.length; i++) {
      const ent = this.entities[i];
      ent.material.uniforms.uTime.value = elapsed;

      const targetGlow = ent.hovered ? 1.0 : 0.0;
      const prevGlow = ent.material.uniforms.uHoverGlow.value as number;
      ent.material.uniforms.uHoverGlow.value = prevGlow + (targetGlow - prevGlow) * Math.min(1, dt * 8);

      ent.transitionT = Math.min(1, ent.transitionT + dt * 2.2);
      const easeOut = 1 - Math.pow(1 - ent.transitionT, 3);
      const currentScale = ent.targetScale * easeOut;

      if (!ent.grounded) {
        const wf = ent.wanderFreq;
        const ph = ent.phase;

        let ax = Math.sin(elapsed * wf + ph) * 0.32 + Math.cos(elapsed * wf * 0.61 + ph * 1.7) * 0.16;
        let ay = Math.sin(elapsed * wf * 0.55 + ph * 2.3) * 0.14;
        let az = Math.cos(elapsed * wf * 0.91 + ph * 1.1) * 0.32 + Math.sin(elapsed * wf * 0.53 + ph * 2.9) * 0.16;

        // Soft outer boundary containment
        const horizDist = Math.hypot(ent.pos.x, ent.pos.z) || 0.001;
        if (horizDist > maxRadius - 1.2) {
          const pushIn = (horizDist - (maxRadius - 1.2)) * 1.1;
          ax -= (ent.pos.x / horizDist) * pushIn;
          az -= (ent.pos.z / horizDist) * pushIn;
        }

        // Personal clear zone directly around user's head so creatures glide gracefully past
        const distToHead = ent.pos.length() || 0.001;
        if (distToHead < personalBubble) {
          const pushOut = (personalBubble - distToHead) * 1.8;
          ax += (ent.pos.x / distToHead) * pushOut;
          ay += (ent.pos.y / distToHead) * pushOut * 0.4;
          az += (ent.pos.z / distToHead) * pushOut;
        }

        const floorY = sandHeight(ent.pos.x, ent.pos.z) + 0.55;
        if (ent.pos.y < floorY) ay += (floorY - ent.pos.y) * 1.8;
        if (ent.pos.y > yMax) ay -= (ent.pos.y - yMax) * 1.8;

        // Soft separation between swimmers
        for (let j = 0; j < this.entities.length; j++) {
          if (i === j || this.entities[j].grounded) continue;
          const o = this.entities[j];
          const dx = ent.pos.x - o.pos.x;
          const dy = ent.pos.y - o.pos.y;
          const dz = ent.pos.z - o.pos.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > 0.001 && d2 < 2.2) {
            const d = Math.sqrt(d2);
            const push = (1.48 - d) * 0.75;
            ax += (dx / d) * push;
            ay += (dy / d) * push;
            az += (dz / d) * push;
          }
        }

        ent.vel.x += ax * dt;
        ent.vel.y += ay * dt;
        ent.vel.z += az * dt;

        const spd = ent.vel.length() || 0.001;
        const blend = ent.swimSpeed / spd;
        const lerpAmt = Math.min(1, 1.0 * dt);
        this.tempVel.copy(ent.vel).multiplyScalar(blend);
        ent.vel.lerp(this.tempVel, lerpAmt);

        ent.pos.addScaledVector(ent.vel, dt);

        // Hard clamp inside sanctuary
        const clampedHoriz = Math.hypot(ent.pos.x, ent.pos.z);
        if (clampedHoriz > maxRadius) {
          ent.pos.x = (ent.pos.x / clampedHoriz) * maxRadius;
          ent.pos.z = (ent.pos.z / clampedHoriz) * maxRadius;
        }
        const minY = sandHeight(ent.pos.x, ent.pos.z) + 0.35;
        ent.pos.y = Math.max(minY, Math.min(SANCTUARY_WATER_Y - 0.35, ent.pos.y));

        if (ent.directional) {
          const targetYaw = Math.atan2(ent.vel.x, ent.vel.z);
          let diff = targetYaw - ent.yaw;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          ent.yaw += diff * Math.min(1, dt * 1.9);

          const yawRate = (ent.yaw - ent.prevYaw) / Math.max(dt, 0.0001);
          ent.prevYaw = ent.yaw;
          const horiz = Math.hypot(ent.vel.x, ent.vel.z) || 0.001;
          const bank = Math.max(-0.22, Math.min(0.22, yawRate * 0.12));
          const targetPitch = -Math.atan2(ent.vel.y, horiz) * 0.55 + bank;
          ent.pitch += (targetPitch - ent.pitch) * Math.min(1, dt * 1.7);
        } else {
          ent.yaw = ent.baseRot + elapsed * ent.rotSpeed;
          ent.pitch = Math.sin(elapsed * 0.55 + ent.phase) * 0.10;
        }
      }

      ent.mesh.position.copy(ent.pos);
      ent.mesh.rotation.set(ent.pitch, ent.yaw, 0, 'YXZ');
      ent.mesh.scale.setScalar(currentScale);
    }

    this.relaxPanel.draw((ctx, w, h) => {
      this.relaxPanel.drawRoundedBg('rgba(6, 18, 28, 0.84)', '#38d9c0', 22);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (this.hoveredEntity) {
        ctx.fillStyle = '#5ef0d9';
        ctx.font = 'bold 38px "Segoe UI", "Hiragino Sans", sans-serif';
        ctx.fillText(
          `👁 ${this.hoveredEntity.name} を追従中 (距離 ${this.hoveredDistMeters.toFixed(1)}m)`,
          w / 2,
          h * 0.35
        );
      } else {
        ctx.fillStyle = '#e6f6fb';
        ctx.font = 'bold 36px "Segoe UI", "Hiragino Sans", sans-serif';
        ctx.fillText(
          inhaling
            ? `ゆっくり息を吸って… (${(4.0 - cyclePos).toFixed(1)}s)`
            : `遠くの魚やクラゲを眺めながら息を吐く… (${(10.0 - cyclePos).toFixed(1)}s)`,
          w / 2,
          h * 0.35
        );
      }

      ctx.fillStyle = '#84adc0';
      ctx.font = '28px "Segoe UI", "Hiragino Sans", sans-serif';
      ctx.fillText(
        `深呼吸 ${this.breathCycles}回  |  生き物たちに視線を向けると癒やしの音色が響きます`,
        w / 2,
        h * 0.72
      );
    });

    return this.remaining > 0;
  }

  public getInteractiveObjects(): THREE.Object3D[] {
    return this.interactiveObjects;
  }

  public onObjectSelected(_obj: THREE.Object3D): void {
    // Handled via button and entity callbacks
  }

  public getHUDState(): TrainingHUDState {
    return {
      title: this.name,
      instruction: '力まずに遠くを泳ぐ魚やクラゲをぼんやり眺め、呼吸をゆっくり整えましょう',
      remainingSeconds: Math.max(0, Math.ceil(this.remaining)),
      metricLabel: `深呼吸: ${this.breathCycles}回 | 観察: ${this.watchedCount}`
    };
  }
}
