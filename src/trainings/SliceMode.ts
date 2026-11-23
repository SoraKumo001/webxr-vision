import * as THREE from 'three';
import { AudioManager } from '../core/AudioManager';
import { BladeTip, InputManager } from '../core/InputManager';
import { Difficulty } from '../core/StorageManager';
import { GroupFade } from '../ui/GroupFade';
import { SpatialTextPanel } from '../ui/SpatialPanel';
import { canvasFont, theme, themeHex } from '../ui/theme';
import { ITrainingMode, TrainingHUDState, TrainingResult } from './ITrainingMode';
import { ModeUiChrome } from './ModeUiChrome';

const DISC_RADIUS = 0.16;
const HIT_RADIUS = 0.21;
const MIN_SLICE_SPEED = 1.35;
const MAX_SLICE_SEGMENT = 0.85;
const FLYER_POOL = 8;
const SHARD_POOL = 16;
const RIBBON_POINTS = 14;
const WAVE_POOL = 8;
const SPARK_BURST_POOL = 6;
const SPARKS_PER_BURST = 24;
const GOLD_COLOR = 0xffd166;

const DISC_COLORS = [themeHex.amber, themeHex.seafoam, themeHex.modeFocus] as const;

const RIBBON_VERT = /* glsl */ `
  attribute float aProgress;
  varying float vProgress;
  varying vec2 vUv;

  void main() {
    vProgress = aProgress;
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const RIBBON_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying float vProgress;
  varying vec2 vUv;

  void main() {
    float edge = 1.0 - abs(vUv.y * 2.0 - 1.0);
    float core = pow(edge, 2.2);
    float tail = pow(clamp(1.0 - vProgress, 0.0, 1.0), 1.45);
    vec3 col = mix(uColor, vec3(0.95, 1.0, 1.0), core * 0.65);
    float alpha = (edge * 0.55 + core * 0.55) * tail * uIntensity;
    gl_FragColor = vec4(col, alpha);
  }
`;

const SPARK_VERT = /* glsl */ `
  uniform float uSize;
  void main() {
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPos;
    float dist = max(0.35, -mvPos.z);
    gl_PointSize = clamp(uSize * (280.0 / dist), 2.0, 48.0);
  }
`;

const SPARK_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float glow = pow(1.0 - d * 2.0, 1.9);
    vec3 col = mix(uColor, vec3(1.0), glow * 0.6);
    gl_FragColor = vec4(col, glow * uAlpha);
  }
`;

function roundSeconds(difficulty: Difficulty): number {
  if (difficulty === 'easy') return 90;
  if (difficulty === 'hard') return 60;
  return 75;
}

function flySpeed(difficulty: Difficulty): number {
  if (difficulty === 'easy') return 0.75;
  if (difficulty === 'hard') return 1.5;
  return 1.1;
}

function spawnInterval(difficulty: Difficulty): number {
  if (difficulty === 'easy') return 1.35;
  if (difficulty === 'hard') return 0.58;
  return 0.9;
}

function maxAlive(difficulty: Difficulty): number {
  if (difficulty === 'easy') return 2;
  if (difficulty === 'hard') return 4;
  return 3;
}

interface Flyer {
  root: THREE.Group;
  body: THREE.MeshStandardMaterial;
  rim: THREE.MeshStandardMaterial;
  glow: THREE.MeshBasicMaterial;
  active: boolean;
  isGold: boolean;
  baseColor: number;
  velocity: THREE.Vector3;
  curveAccel: THREE.Vector3;
  spin: THREE.Vector3;
}

interface Shard {
  root: THREE.Group;
  halfPivot: THREE.Group;
  mat: THREE.MeshStandardMaterial;
  active: boolean;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

interface BladeTrack {
  prev: THREE.Vector3;
  curr: THREE.Vector3;
  hasPrev: boolean;
  history: THREE.Vector3[];
  historyCount: number;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  positions: Float32Array;
}

interface ShockWave {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  active: boolean;
  life: number;
  maxLife: number;
}

interface SparkBurst {
  points: THREE.Points;
  mat: THREE.ShaderMaterial;
  positions: Float32Array;
  velocities: Float32Array;
  active: boolean;
  life: number;
  maxLife: number;
}

function makeBladeRibbon(): BladeTrack {
  const positions = new Float32Array(RIBBON_POINTS * 2 * 3);
  const progress = new Float32Array(RIBBON_POINTS * 2);
  const uvs = new Float32Array(RIBBON_POINTS * 2 * 2);
  const indices: number[] = [];

  for (let i = 0; i < RIBBON_POINTS; i++) {
    const t = i / (RIBBON_POINTS - 1);
    progress[i * 2] = t;
    progress[i * 2 + 1] = t;
    uvs[i * 4] = t;
    uvs[i * 4 + 1] = 0;
    uvs[i * 4 + 2] = t;
    uvs[i * 4 + 3] = 1;
    if (i < RIBBON_POINTS - 1) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aProgress', new THREE.BufferAttribute(progress, 1));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);

  const mat = new THREE.ShaderMaterial({
    vertexShader: RIBBON_VERT,
    fragmentShader: RIBBON_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(themeHex.seafoam) },
      uIntensity: { value: 0.92 }
    }
  });
  mat.userData.skipGroupFade = true;

  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.userData.skipGroupFade = true;

  const history: THREE.Vector3[] = [];
  for (let i = 0; i < RIBBON_POINTS; i++) {
    history.push(new THREE.Vector3());
  }

  return {
    prev: new THREE.Vector3(),
    curr: new THREE.Vector3(),
    hasPrev: false,
    history,
    historyCount: 0,
    mesh,
    mat,
    positions
  };
}

function createShockWave(): ShockWave {
  const mat = new THREE.MeshBasicMaterial({
    color: themeHex.amberSoft,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  mat.userData.skipGroupFade = true;
  const mesh = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.19, 36), mat);
  mesh.visible = false;
  mesh.userData.skipGroupFade = true;
  return { mesh, mat, active: false, life: 0, maxLife: 0.36 };
}

function createSparkBurst(): SparkBurst {
  const positions = new Float32Array(SPARKS_PER_BURST * 3);
  const velocities = new Float32Array(SPARKS_PER_BURST * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.ShaderMaterial({
    vertexShader: SPARK_VERT,
    fragmentShader: SPARK_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(themeHex.amberSoft) },
      uSize: { value: 0.07 },
      uAlpha: { value: 0 }
    }
  });
  mat.userData.skipGroupFade = true;
  const points = new THREE.Points(geo, mat);
  points.visible = false;
  points.frustumCulled = false;
  points.userData.skipGroupFade = true;
  return { points, mat, positions, velocities, active: false, life: 0, maxLife: 0.45 };
}

function createPuck(radius: number, thickness: number, color: number): Flyer {
  const root = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.38,
    metalness: 0.18,
    emissive: color,
    emissiveIntensity: 0.42
  });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.92, thickness, 32), body);
  disc.rotation.x = Math.PI / 2;
  root.add(disc);

  const rim = new THREE.MeshStandardMaterial({
    color: 0xf7f1e4,
    roughness: 0.22,
    metalness: 0.62,
    emissive: color,
    emissiveIntensity: 0.7
  });
  root.add(new THREE.Mesh(new THREE.TorusGeometry(radius, thickness * 0.62, 10, 32), rim));

  const glow = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
  const halo = new THREE.Mesh(new THREE.CircleGeometry(radius * 1.28, 28), glow);
  halo.position.z = -0.03;
  root.add(halo);

  root.visible = false;
  return {
    root,
    body,
    rim,
    glow,
    active: false,
    isGold: false,
    baseColor: color,
    velocity: new THREE.Vector3(),
    curveAccel: new THREE.Vector3(),
    spin: new THREE.Vector3()
  };
}

function createChunk(radius: number): Shard {
  const mat = new THREE.MeshStandardMaterial({
    color: themeHex.amberSoft,
    roughness: 0.4,
    metalness: 0.22,
    emissive: themeHex.amber,
    emissiveIntensity: 0.45,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 0.8, 0.05, 18, 1, false, 0, Math.PI),
    mat
  );
  mesh.rotation.x = Math.PI / 2;
  const halfPivot = new THREE.Group();
  halfPivot.add(mesh);
  const root = new THREE.Group();
  root.add(halfPivot);
  root.visible = false;
  return {
    root,
    halfPivot,
    mat,
    active: false,
    velocity: new THREE.Vector3(),
    spin: new THREE.Vector3(),
    life: 0
  };
}

function paintFlyer(flyer: Flyer, color: number, isGold = false): void {
  flyer.baseColor = color;
  flyer.isGold = isGold;
  flyer.body.color.setHex(color);
  flyer.body.emissive.setHex(color);
  flyer.body.emissiveIntensity = isGold ? 0.72 : 0.42;
  flyer.rim.emissive.setHex(color);
  flyer.rim.emissiveIntensity = isGold ? 1.0 : 0.7;
  flyer.glow.color.setHex(color);
  flyer.glow.opacity = isGold ? 0.34 : 0.2;
  flyer.root.scale.setScalar(isGold ? 0.8 : 1.0);
}

function segmentHitsSphere(
  a: THREE.Vector3,
  b: THREE.Vector3,
  center: THREE.Vector3,
  radius: number,
  ab: THREE.Vector3,
  closest: THREE.Vector3
): boolean {
  ab.subVectors(b, a);
  const lenSq = ab.lengthSq();
  if (lenSq < 1e-8) {
    return a.distanceToSquared(center) <= radius * radius;
  }
  const t = THREE.MathUtils.clamp(closest.copy(center).sub(a).dot(ab) / lenSq, 0, 1);
  closest.copy(a).addScaledVector(ab, t);
  return closest.distanceToSquared(center) <= radius * radius;
}

export class SliceMode implements ITrainingMode {
  public readonly id = 'slice' as const;
  public readonly name = '6. スライス';
  public readonly description = '飛んでくる光の円盤を、コントローラーを振って切ります';
  public readonly group = new THREE.Group();
  public onUiHiddenChange?: (hidden: boolean) => void;

  private readonly arena = new THREE.Group();
  private readonly fx = new THREE.Group();
  private readonly infoPanel: SpatialTextPanel;
  private readonly uiChrome: ModeUiChrome;
  private readonly groupFade: GroupFade;
  private readonly audio: AudioManager;
  private readonly input: InputManager;
  private readonly interactiveObjects: THREE.Object3D[] = [];

  private readonly flyers: Flyer[] = [];
  private readonly shards: Shard[] = [];
  private readonly blades: BladeTrack[] = [];
  private readonly waves: ShockWave[] = [];
  private readonly sparkBursts: SparkBurst[] = [];

  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly spawnPos = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();
  private readonly swing = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly closest = new THREE.Vector3();
  private readonly ribbonTan = new THREE.Vector3();
  private readonly ribbonSide = new THREE.Vector3();
  private readonly bladeBase = new THREE.Vector3();
  private readonly bladeTipExt = new THREE.Vector3();
  private readonly rayEnd = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  private difficulty: Difficulty = 'normal';
  private durationTotal = 75;
  private remaining = 75;
  private score = 0;
  private misses = 0;
  private combo = 0;
  private maxCombo = 0;
  private infoDirty = true;
  private spawnIn = 0.35;
  private running = false;

  constructor(audio: AudioManager, input: InputManager) {
    this.audio = audio;
    this.input = input;
    this.group.add(this.arena);
    this.group.add(this.fx);
    this.groupFade = new GroupFade(this.group);

    for (let i = 0; i < FLYER_POOL; i++) {
      const flyer = createPuck(DISC_RADIUS, 0.05, DISC_COLORS[i % DISC_COLORS.length]);
      this.fx.add(flyer.root);
      this.flyers.push(flyer);
    }

    for (let i = 0; i < SHARD_POOL; i++) {
      const shard = createChunk(DISC_RADIUS * 0.72);
      this.fx.add(shard.root);
      this.shards.push(shard);
    }

    for (let i = 0; i < 3; i++) {
      const track = makeBladeRibbon();
      this.fx.add(track.mesh);
      this.blades.push(track);
    }

    for (let i = 0; i < WAVE_POOL; i++) {
      const wave = createShockWave();
      this.fx.add(wave.mesh);
      this.waves.push(wave);
    }

    for (let i = 0; i < SPARK_BURST_POOL; i++) {
      const burst = createSparkBurst();
      this.fx.add(burst.points);
      this.sparkBursts.push(burst);
    }

    this.infoPanel = new SpatialTextPanel(1.35, 0.22, 960, 160);
    this.infoPanel.mesh.position.set(0, 0.46, -2.05);
    this.arena.add(this.infoPanel.mesh);

    this.uiChrome = new ModeUiChrome(this.arena, audio, {
      showButtonPosition: new THREE.Vector3(0, -0.72, -1.7)
    });
    this.uiChrome.setChrome([this.infoPanel.mesh]);
    this.uiChrome.onChange = (hidden) => {
      this.rebuildInteractives();
      this.onUiHiddenChange?.(hidden);
    };
    this.rebuildInteractives();
    this.groupFade.setImmediate(false);
    this.drawInfo();
  }

  private rebuildInteractives(): void {
    this.interactiveObjects.length = 0;
    this.uiChrome.appendInteractives(this.interactiveObjects);
  }

  public isUiHidden(): boolean {
    return this.uiChrome.isHidden();
  }

  public setUiHidden(hidden: boolean): void {
    this.uiChrome.setHidden(hidden);
  }

  public start(difficulty: Difficulty, headPos: THREE.Vector3, headQuat: THREE.Quaternion): void {
    this.difficulty = difficulty;
    this.durationTotal = roundSeconds(difficulty);
    this.remaining = this.durationTotal;
    this.score = 0;
    this.misses = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.infoDirty = true;
    this.spawnIn = 0.35;
    this.running = true;
    this.clearActors();
    this.placeArena(headPos, headQuat);
    this.uiChrome.setHidden(false);
    this.drawInfo();
    this.groupFade.show();
  }

  public recenter(headPos: THREE.Vector3, headQuat: THREE.Quaternion): void {
    this.placeArena(headPos, headQuat);
    for (const blade of this.blades) {
      blade.hasPrev = false;
    }
  }

  public stop(): TrainingResult {
    this.running = false;
    this.uiChrome.setHidden(false);
    this.clearActors();
    this.groupFade.setImmediate(false);
    const duration = Math.max(1, Math.round(this.durationTotal - this.remaining));
    const comboNote = this.maxCombo >= 3 ? ` 最大${this.maxCombo}コンボ` : '';
    return {
      modeId: this.id,
      durationSec: duration,
      summary: `スライス スコア ${this.score}（ミス ${this.misses}${comboNote}） ${duration}秒`
    };
  }

  public update(
    dt: number,
    _elapsed: number,
    headPos: THREE.Vector3,
    headQuat: THREE.Quaternion
  ): boolean {
    this.groupFade.update(dt);
    if (!this.running) return false;

    this.remaining -= dt;
    this.placeArena(headPos, headQuat);
    this.orientLook(headQuat);

    this.spawnIn -= dt;
    if (this.spawnIn <= 0) {
      this.spawnIn = spawnInterval(this.difficulty);
      this.trySpawn(headPos);
    }

    for (const flyer of this.flyers) {
      if (!flyer.active) continue;
      flyer.velocity.addScaledVector(flyer.curveAccel, dt);
      flyer.root.position.addScaledVector(flyer.velocity, dt);
      flyer.root.rotateX(flyer.spin.x * dt);
      flyer.root.rotateY(flyer.spin.y * dt);
      flyer.root.rotateZ(flyer.spin.z * dt);
      const distSq = flyer.root.position.distanceToSquared(headPos);
      const ahead = this.spawnPos.copy(flyer.root.position).sub(headPos).dot(this.forward);

      // Sweet-spot highlight when the disc enters easy slicing range (0.38m - 1.15m)
      const inSweetSpot = ahead > 0.1 && distSq >= 0.38 * 0.38 && distSq <= 1.15 * 1.15;
      if (inSweetSpot) {
        const pulse = 0.5 + 0.5 * Math.sin(this.remaining * 18);
        flyer.rim.emissive.setHex(0xffffff);
        flyer.rim.emissiveIntensity = 1.15 + pulse * 0.45;
        flyer.glow.opacity = 0.36 + pulse * 0.12;
      } else {
        flyer.rim.emissive.setHex(flyer.baseColor);
        flyer.rim.emissiveIntensity = flyer.isGold ? 1.0 : 0.7;
        flyer.glow.opacity = flyer.isGold ? 0.34 : 0.2;
      }

      // Drop targets once they reach the face so they never clip the near plane.
      if (ahead < 0.02 || distSq < 0.22 * 0.22) {
        this.deactivateFlyer(flyer);
        this.misses += 1;
        this.combo = 0;
        this.infoDirty = true;
        this.audio.playMiss();
      } else if (distSq > 36) {
        this.deactivateFlyer(flyer);
      }
    }

    const tips = this.input.getControllerTips();
    this.applyBlade(this.blades[0], tips[0], dt, 0, headPos);
    this.applyBlade(this.blades[1], tips[1], dt, 1, headPos);
    this.applyBlade(this.blades[2], this.input.getDesktopBlade(), dt, 2, headPos);

    for (const shard of this.shards) {
      if (!shard.active) continue;
      shard.life -= dt;
      shard.velocity.y -= 2.4 * dt;
      shard.root.position.addScaledVector(shard.velocity, dt);
      shard.root.rotateX(shard.spin.x * dt);
      shard.root.rotateY(shard.spin.y * dt);
      shard.root.rotateZ(shard.spin.z * dt);
      if (shard.life <= 0 || shard.root.position.distanceToSquared(headPos) < 0.3 * 0.3) {
        shard.active = false;
        shard.root.visible = false;
      }
    }

    for (const wave of this.waves) {
      if (!wave.active) continue;
      wave.life += dt;
      const p = wave.life / wave.maxLife;
      if (p >= 1) {
        wave.active = false;
        wave.mesh.visible = false;
        continue;
      }
      const ease = 1 - Math.pow(1 - p, 2);
      wave.mesh.scale.setScalar(0.65 + ease * 2.85);
      wave.mat.opacity = (1 - p) * 0.78;
    }

    for (const burst of this.sparkBursts) {
      if (!burst.active) continue;
      burst.life += dt;
      const p = burst.life / burst.maxLife;
      if (p >= 1) {
        burst.active = false;
        burst.points.visible = false;
        continue;
      }
      for (let i = 0; i < SPARKS_PER_BURST; i++) {
        const idx = i * 3;
        burst.velocities[idx + 1] -= 2.8 * dt;
        burst.positions[idx] += burst.velocities[idx] * dt;
        burst.positions[idx + 1] += burst.velocities[idx + 1] * dt;
        burst.positions[idx + 2] += burst.velocities[idx + 2] * dt;
      }
      burst.points.geometry.attributes.position.needsUpdate = true;
      burst.mat.uniforms.uAlpha.value = Math.pow(1 - p, 1.4) * 0.95;
    }

    if (this.infoDirty) {
      this.infoDirty = false;
      this.drawInfo();
    }
    return this.remaining > 0;
  }

  public getInteractiveObjects(): THREE.Object3D[] {
    return this.interactiveObjects;
  }

  public onObjectSelected(_obj: THREE.Object3D): void {
    // Chrome buttons select themselves.
  }

  public getHUDState(): TrainingHUDState {
    const mult = this.getMultiplier();
    const comboText = this.combo >= 2 ? `  |  ${this.combo} COMBO (x${mult})` : '';
    return {
      title: this.name,
      instruction: 'コントローラーを振るか、マウスをドラッグして飛んでくる光を切ってください',
      remainingSeconds: Math.max(0, Math.ceil(this.remaining)),
      metricLabel: `スコア ${this.score}  ミス ${this.misses}${comboText}`
    };
  }

  private getMultiplier(): number {
    return Math.min(3, 1 + Math.floor(this.combo / 5));
  }

  private placeArena(headPos: THREE.Vector3, headQuat: THREE.Quaternion): void {
    const euler = new THREE.Euler().setFromQuaternion(headQuat, 'YXZ');
    this.arena.position.copy(headPos);
    this.arena.rotation.set(0, euler.y, 0);
  }

  private orientLook(headQuat: THREE.Quaternion): void {
    this.forward.set(0, 0, -1).applyQuaternion(headQuat);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, -1);
    this.forward.normalize();
    this.right.set(1, 0, 0).applyQuaternion(headQuat);
    this.right.y = 0;
    if (this.right.lengthSq() < 1e-6) this.right.set(1, 0, 0);
    this.right.normalize();
  }

  private aliveCount(): number {
    let n = 0;
    for (const flyer of this.flyers) {
      if (flyer.active) n += 1;
    }
    return n;
  }

  private trySpawn(headPos: THREE.Vector3): void {
    const max = maxAlive(this.difficulty);
    const alive = this.aliveCount();
    if (alive >= max) return;

    const doWave = this.difficulty !== 'easy' && alive + 2 <= max && Math.random() < 0.28;
    if (doWave) {
      const lateral = 0.42 + Math.random() * 0.28;
      this.spawnOne(headPos, -lateral, false);
      this.spawnOne(headPos, lateral, false);
    } else {
      const lateral = (Math.random() * 2 - 1) * 0.72;
      const isGold = Math.random() < 0.16;
      this.spawnOne(headPos, lateral, isGold);
    }
  }

  private spawnOne(headPos: THREE.Vector3, lateral: number, isGold: boolean): void {
    const flyer = this.flyers.find((item) => !item.active);
    if (!flyer) return;

    const dist = 3.1 + Math.random() * 1.4;
    const height = headPos.y + (Math.random() * 0.45 - 0.18);
    this.spawnPos.copy(headPos).addScaledVector(this.forward, dist).addScaledVector(this.right, lateral);
    this.spawnPos.y = height;

    this.aim.copy(headPos);
    this.aim.y = headPos.y + (Math.random() * 0.2 - 0.05);
    this.aim.addScaledVector(this.forward, -0.35);
    const speed = flySpeed(this.difficulty) * (isGold ? 1.26 : 1.0);
    flyer.velocity.copy(this.aim).sub(this.spawnPos).normalize().multiplyScalar(speed);

    // Subtle lateral curve on normal/hard for dynamic vision challenge
    if (this.difficulty !== 'easy' && Math.random() < 0.45) {
      const curveSign = lateral > 0 ? -1 : 1;
      flyer.curveAccel.copy(this.right).multiplyScalar(curveSign * (this.difficulty === 'hard' ? 0.26 : 0.16));
    } else {
      flyer.curveAccel.set(0, 0, 0);
    }

    flyer.root.position.copy(this.spawnPos);
    flyer.root.lookAt(headPos);
    flyer.root.rotateX(THREE.MathUtils.degToRad(-32 + Math.random() * 64));
    flyer.root.rotateY(THREE.MathUtils.degToRad(-24 + Math.random() * 48));
    flyer.spin.set(
      0.35 + Math.random() * 0.9,
      (Math.random() < 0.5 ? -1 : 1) * (0.9 + Math.random() * 1.2),
      (Math.random() - 0.5) * 0.8
    );
    flyer.root.visible = true;
    flyer.active = true;
    const color = isGold ? GOLD_COLOR : DISC_COLORS[Math.floor(Math.random() * DISC_COLORS.length)];
    paintFlyer(flyer, color, isGold);
  }

  private applyBlade(
    track: BladeTrack,
    tip: BladeTip | undefined,
    dt: number,
    slotIndex: number,
    headPos: THREE.Vector3
  ): void {
    if (!tip?.active) {
      track.hasPrev = false;
      track.historyCount = 0;
      track.mesh.visible = false;
      return;
    }
    track.curr.copy(tip.position);
    if (!track.hasPrev) {
      track.prev.copy(track.curr);
      track.hasPrev = true;
      for (let i = 0; i < RIBBON_POINTS; i++) {
        track.history[i].copy(track.curr);
      }
      track.historyCount = 1;
      this.showRestingBlade(track, tip);
      return;
    }

    const dist = track.curr.distanceTo(track.prev);
    const speed = dist / Math.max(dt, 1e-4);
    if (dist > 0.004 && dist < MAX_SLICE_SEGMENT && speed >= MIN_SLICE_SPEED) {
      this.trySlice(track.prev, track.curr, tip, slotIndex, headPos);
    }

    if (dist > 0.004 && dist < MAX_SLICE_SEGMENT) {
      for (let i = RIBBON_POINTS - 1; i > 0; i--) {
        track.history[i].copy(track.history[i - 1]);
      }
      track.history[0].copy(track.curr);
      track.historyCount = Math.min(RIBBON_POINTS, track.historyCount + 1);
      this.updateRibbonGeometry(track, speed);
    } else {
      // Decay tail toward head when stationary
      for (let i = RIBBON_POINTS - 1; i > 0; i--) {
        track.history[i].lerp(track.history[i - 1], Math.min(1, dt * 18));
      }
      track.history[0].copy(track.curr);
      if (track.curr.distanceToSquared(track.history[RIBBON_POINTS - 1]) < 0.002) {
        this.showRestingBlade(track, tip);
      } else {
        this.updateRibbonGeometry(track, speed);
      }
    }

    track.mesh.visible = true;
    track.prev.copy(track.curr);
  }

  private updateRibbonGeometry(track: BladeTrack, speed: number): void {
    const pos = track.positions;
    const isFast = speed >= MIN_SLICE_SPEED;
    track.mat.uniforms.uIntensity.value = isFast ? 1.0 : 0.7;
    track.mat.uniforms.uColor.value.setHex(isFast ? themeHex.laserHit : themeHex.seafoam);

    for (let i = 0; i < RIBBON_POINTS; i++) {
      const p = track.history[i];
      if (i < RIBBON_POINTS - 1) {
        this.ribbonTan.subVectors(p, track.history[i + 1]);
      } else {
        this.ribbonTan.subVectors(track.history[i - 1], p);
      }
      if (this.ribbonTan.lengthSq() < 1e-7) {
        this.ribbonTan.copy(this.forward);
      } else {
        this.ribbonTan.normalize();
      }
      this.ribbonSide.crossVectors(this.ribbonTan, this.up);
      if (this.ribbonSide.lengthSq() < 1e-5) {
        this.ribbonSide.crossVectors(this.ribbonTan, this.right);
      }
      this.ribbonSide.normalize();

      const t = i / (RIBBON_POINTS - 1);
      const halfWidth = (1 - t * 0.85) * (isFast ? 0.032 : 0.018);

      const idx = i * 6;
      pos[idx] = p.x + this.ribbonSide.x * halfWidth;
      pos[idx + 1] = p.y + this.ribbonSide.y * halfWidth;
      pos[idx + 2] = p.z + this.ribbonSide.z * halfWidth;
      pos[idx + 3] = p.x - this.ribbonSide.x * halfWidth;
      pos[idx + 4] = p.y - this.ribbonSide.y * halfWidth;
      pos[idx + 5] = p.z - this.ribbonSide.z * halfWidth;
    }
    track.mesh.geometry.attributes.position.needsUpdate = true;
  }

  private showRestingBlade(track: BladeTrack, tip: BladeTip): void {
    this.swing.copy(tip.position).addScaledVector(tip.direction, -0.22);
    for (let i = 0; i < RIBBON_POINTS; i++) {
      const t = i / (RIBBON_POINTS - 1);
      track.history[i].lerpVectors(tip.position, this.swing, t);
    }
    track.mat.uniforms.uIntensity.value = 0.65;
    track.mat.uniforms.uColor.value.setHex(themeHex.seafoam);
    this.updateRibbonGeometry(track, 0);
    track.mesh.visible = true;
  }

  private trySlice(
    a: THREE.Vector3,
    b: THREE.Vector3,
    tip: BladeTip,
    slotIndex: number,
    headPos: THREE.Vector3
  ): void {
    const isDesktop = slotIndex === 2;
    if (!isDesktop) {
      this.bladeBase.copy(tip.position).addScaledVector(tip.direction, -0.12);
      this.bladeTipExt.copy(tip.position).addScaledVector(tip.direction, 0.28);
    } else {
      // Cast ray from head through mouse blade into strike zone (0.3m - 1.75m)
      this.rayEnd.copy(b).sub(headPos).normalize().multiplyScalar(1.85).add(headPos);
    }

    for (const flyer of this.flyers) {
      if (!flyer.active) continue;
      let hit = segmentHitsSphere(a, b, flyer.root.position, HIT_RADIUS, this.swing, this.closest);
      if (!hit && !isDesktop) {
        hit = segmentHitsSphere(
          this.bladeBase,
          this.bladeTipExt,
          flyer.root.position,
          HIT_RADIUS,
          this.swing,
          this.closest
        );
      } else if (!hit && isDesktop) {
        const ahead = this.spawnPos.copy(flyer.root.position).sub(headPos).dot(this.forward);
        if (ahead >= 0.3 && ahead <= 1.75) {
          hit = segmentHitsSphere(
            headPos,
            this.rayEnd,
            flyer.root.position,
            HIT_RADIUS * 1.15,
            this.swing,
            this.closest
          );
        }
      }
      if (!hit) continue;
      this.cutFlyer(flyer, a, b, slotIndex);
    }
  }

  private cutFlyer(flyer: Flyer, a: THREE.Vector3, b: THREE.Vector3, slotIndex: number): void {
    this.swing.subVectors(b, a);
    if (this.swing.lengthSq() < 1e-6) this.swing.set(1, 0, 0);
    this.side.crossVectors(this.swing, this.up);
    if (this.side.lengthSq() < 1e-4) this.side.set(1, 0, 0);
    this.side.normalize();

    const cutAngle = Math.atan2(this.swing.y, this.swing.dot(this.right));
    const color = flyer.baseColor;
    this.launchShard(flyer.root.position, flyer.velocity, this.side, 1, color, cutAngle);
    this.launchShard(flyer.root.position, flyer.velocity, this.side, -1, color, cutAngle);
    this.launchShockWave(flyer.root.position, color);
    this.launchSparkBurst(flyer.root.position, color);
    this.deactivateFlyer(flyer);

    this.combo += 1;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    const mult = this.getMultiplier();
    this.score += (flyer.isGold ? 3 : 1) * mult;
    this.infoDirty = true;

    this.audio.playSliceHit(this.combo, flyer.isGold);
    if (slotIndex < 2) {
      this.input.pulseHaptic(slotIndex, flyer.isGold ? 0.9 : 0.65, flyer.isGold ? 65 : 45);
    }
  }

  private launchShard(
    origin: THREE.Vector3,
    incoming: THREE.Vector3,
    side: THREE.Vector3,
    sign: number,
    color: number,
    cutAngle: number
  ): void {
    const shard = this.shards.find((item) => !item.active);
    if (!shard) return;
    shard.active = true;
    shard.life = 0.7;
    shard.root.visible = true;
    shard.root.position.copy(origin).addScaledVector(side, 0.07 * sign);
    shard.root.lookAt(this.aim.copy(origin).add(incoming));
    shard.halfPivot.rotation.z = cutAngle + (sign < 0 ? Math.PI : 0);
    shard.spin.set(
      (Math.random() - 0.5) * 6,
      sign * (3 + Math.random() * 3),
      (Math.random() - 0.5) * 4
    );
    shard.velocity.copy(incoming).multiplyScalar(0.2);
    shard.velocity.addScaledVector(side, 0.85 * sign);
    shard.velocity.y += 0.55;
    shard.mat.color.setHex(color);
    shard.mat.emissive.setHex(color);
  }

  private launchShockWave(origin: THREE.Vector3, color: number): void {
    const wave = this.waves.find((w) => !w.active);
    if (!wave) return;
    wave.active = true;
    wave.life = 0;
    wave.mesh.position.copy(origin);
    wave.mesh.lookAt(this.arena.position);
    wave.mesh.scale.setScalar(0.65);
    wave.mat.color.setHex(color);
    wave.mat.opacity = 0.8;
    wave.mesh.visible = true;
  }

  private launchSparkBurst(origin: THREE.Vector3, color: number): void {
    const burst = this.sparkBursts.find((b) => !b.active);
    if (!burst) return;
    burst.active = true;
    burst.life = 0;
    burst.mat.uniforms.uColor.value.setHex(color);
    burst.mat.uniforms.uAlpha.value = 0.95;

    for (let i = 0; i < SPARKS_PER_BURST; i++) {
      const idx = i * 3;
      burst.positions[idx] = origin.x;
      burst.positions[idx + 1] = origin.y;
      burst.positions[idx + 2] = origin.z;

      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 1.2 + Math.random() * 2.4;
      burst.velocities[idx] = Math.sin(phi) * Math.cos(theta) * speed;
      burst.velocities[idx + 1] = Math.cos(phi) * speed + 0.45;
      burst.velocities[idx + 2] = Math.sin(phi) * Math.sin(theta) * speed;
    }
    burst.points.geometry.attributes.position.needsUpdate = true;
    burst.points.visible = true;
  }

  private deactivateFlyer(flyer: Flyer): void {
    flyer.active = false;
    flyer.root.visible = false;
  }

  private clearActors(): void {
    for (const flyer of this.flyers) this.deactivateFlyer(flyer);
    for (const shard of this.shards) {
      shard.active = false;
      shard.root.visible = false;
    }
    for (const wave of this.waves) {
      wave.active = false;
      wave.mesh.visible = false;
    }
    for (const burst of this.sparkBursts) {
      burst.active = false;
      burst.points.visible = false;
    }
    for (const blade of this.blades) {
      blade.hasPrev = false;
      blade.historyCount = 0;
      blade.mesh.visible = false;
    }
  }

  private drawInfo(): void {
    const mult = this.getMultiplier();
    this.infoPanel.draw((ctx, w, h) => {
      this.infoPanel.drawRoundedBg(theme.inkPanel, mult > 1 ? theme.seafoam : theme.amber, 20);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = theme.amberSoft;
      ctx.font = `700 40px ${canvasFont}`;
      ctx.fillText(`スコア ${this.score}    ミス ${this.misses}`, w / 2, h * 0.36);
      if (this.combo >= 2) {
        ctx.fillStyle = theme.seafoam;
        ctx.font = `700 28px ${canvasFont}`;
        ctx.fillText(`${this.combo} COMBO!  (倍率 x${mult})`, w / 2, h * 0.74);
      } else {
        ctx.fillStyle = theme.textMuted;
        ctx.font = `500 26px ${canvasFont}`;
        ctx.fillText('振ったときだけ切れます（金色は3倍）', w / 2, h * 0.74);
      }
    });
  }
}
