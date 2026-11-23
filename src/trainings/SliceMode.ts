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
const HIT_RADIUS = 0.2;
const MIN_SLICE_SPEED = 1.35;
const MAX_SLICE_SEGMENT = 0.85;
const FLYER_POOL = 6;
const SHARD_POOL = 10;

const DISC_COLORS = [themeHex.amber, themeHex.seafoam, themeHex.modeFocus] as const;

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
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
}

interface Shard {
  root: THREE.Group;
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
  line: THREE.Line;
}

function makeBladeLine(): THREE.Line {
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(),
    new THREE.Vector3()
  ]);
  const mat = new THREE.LineBasicMaterial({
    color: themeHex.seafoam,
    transparent: true,
    opacity: 0.95
  });
  const line = new THREE.Line(geo, mat);
  line.visible = false;
  line.frustumCulled = false;
  return line;
}

function setLineEnds(line: THREE.Line, a: THREE.Vector3, b: THREE.Vector3): void {
  const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
  attr.setXYZ(0, a.x, a.y, a.z);
  attr.setXYZ(1, b.x, b.y, b.z);
  attr.needsUpdate = true;
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
    velocity: new THREE.Vector3(),
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
  const root = new THREE.Group();
  root.add(mesh);
  root.visible = false;
  return {
    root,
    mat,
    active: false,
    velocity: new THREE.Vector3(),
    spin: new THREE.Vector3(),
    life: 0
  };
}

function paintFlyer(flyer: Flyer, color: number): void {
  flyer.body.color.setHex(color);
  flyer.body.emissive.setHex(color);
  flyer.rim.emissive.setHex(color);
  flyer.glow.color.setHex(color);
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

  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly spawnPos = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();
  private readonly swing = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly closest = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  private difficulty: Difficulty = 'normal';
  private durationTotal = 75;
  private remaining = 75;
  private score = 0;
  private misses = 0;
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
      const line = makeBladeLine();
      this.fx.add(line);
      this.blades.push({
        prev: new THREE.Vector3(),
        curr: new THREE.Vector3(),
        hasPrev: false,
        line
      });
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
    return {
      modeId: this.id,
      durationSec: duration,
      summary: `スライス スコア ${this.score}（ミス ${this.misses}） ${duration}秒`
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
      flyer.root.position.addScaledVector(flyer.velocity, dt);
      flyer.root.rotateX(flyer.spin.x * dt);
      flyer.root.rotateY(flyer.spin.y * dt);
      flyer.root.rotateZ(flyer.spin.z * dt);
      const distSq = flyer.root.position.distanceToSquared(headPos);
      const ahead = this.spawnPos.copy(flyer.root.position).sub(headPos).dot(this.forward);
      // Drop targets once they reach the face so they never clip the near plane.
      if (ahead < 0.02 || distSq < 0.22 * 0.22) {
        this.deactivateFlyer(flyer);
        this.misses += 1;
      } else if (distSq > 36) {
        this.deactivateFlyer(flyer);
      }
    }

    const tips = this.input.getControllerTips();
    this.applyBlade(this.blades[0], tips[0], dt);
    this.applyBlade(this.blades[1], tips[1], dt);
    this.applyBlade(this.blades[2], this.input.getDesktopBlade(), dt);

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

    this.drawInfo();
    return this.remaining > 0;
  }

  public getInteractiveObjects(): THREE.Object3D[] {
    return this.interactiveObjects;
  }

  public onObjectSelected(_obj: THREE.Object3D): void {
    // Chrome buttons select themselves.
  }

  public getHUDState(): TrainingHUDState {
    return {
      title: this.name,
      instruction: 'コントローラーを振るか、マウスをドラッグして飛んでくる光を切ってください',
      remainingSeconds: Math.max(0, Math.ceil(this.remaining)),
      metricLabel: `スコア ${this.score}  ミス ${this.misses}`
    };
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
    if (this.aliveCount() >= maxAlive(this.difficulty)) return;
    const flyer = this.flyers.find((item) => !item.active);
    if (!flyer) return;

    const dist = 3.1 + Math.random() * 1.5;
    const lateral = (Math.random() * 2 - 1) * 0.7;
    const height = headPos.y + (Math.random() * 0.45 - 0.18);
    this.spawnPos.copy(headPos).addScaledVector(this.forward, dist).addScaledVector(this.right, lateral);
    this.spawnPos.y = height;

    this.aim.copy(headPos);
    this.aim.y = headPos.y + (Math.random() * 0.2 - 0.05);
    this.aim.addScaledVector(this.forward, -0.35);
    flyer.velocity.copy(this.aim).sub(this.spawnPos).normalize().multiplyScalar(flySpeed(this.difficulty));

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
    paintFlyer(flyer, DISC_COLORS[Math.floor(Math.random() * DISC_COLORS.length)]);
  }

  private applyBlade(track: BladeTrack, tip: BladeTip | undefined, dt: number): void {
    if (!tip?.active) {
      track.hasPrev = false;
      track.line.visible = false;
      return;
    }
    track.curr.copy(tip.position);
    if (!track.hasPrev) {
      track.prev.copy(track.curr);
      track.hasPrev = true;
      this.showRestingBlade(track, tip);
      return;
    }

    const dist = track.curr.distanceTo(track.prev);
    const speed = dist / Math.max(dt, 1e-4);
    if (dist > 0.004 && dist < MAX_SLICE_SEGMENT && speed >= MIN_SLICE_SPEED) {
      this.trySlice(track.prev, track.curr);
    }

    if (dist > 0.01) {
      setLineEnds(track.line, track.prev, track.curr);
    } else {
      this.showRestingBlade(track, tip);
    }
    track.line.visible = true;
    track.prev.copy(track.curr);
  }

  private showRestingBlade(track: BladeTrack, tip: BladeTip): void {
    this.swing.copy(tip.position).addScaledVector(tip.direction, -0.2);
    setLineEnds(track.line, this.swing, tip.position);
    track.line.visible = true;
  }

  private trySlice(a: THREE.Vector3, b: THREE.Vector3): void {
    for (const flyer of this.flyers) {
      if (!flyer.active) continue;
      if (!segmentHitsSphere(a, b, flyer.root.position, HIT_RADIUS, this.swing, this.closest)) {
        continue;
      }
      this.cutFlyer(flyer, a, b);
    }
  }

  private cutFlyer(flyer: Flyer, a: THREE.Vector3, b: THREE.Vector3): void {
    this.swing.subVectors(b, a);
    if (this.swing.lengthSq() < 1e-6) this.swing.set(1, 0, 0);
    this.side.crossVectors(this.swing, this.up);
    if (this.side.lengthSq() < 1e-4) this.side.set(1, 0, 0);
    this.side.normalize();

    const color = flyer.body.color.getHex();
    this.launchShard(flyer.root.position, flyer.velocity, this.side, 1, color);
    this.launchShard(flyer.root.position, flyer.velocity, this.side, -1, color);
    this.deactivateFlyer(flyer);
    this.score += 1;
    if (this.score % 5 === 0) this.audio.playSuccess();
    else this.audio.playSelect();
  }

  private launchShard(
    origin: THREE.Vector3,
    incoming: THREE.Vector3,
    side: THREE.Vector3,
    sign: number,
    color: number
  ): void {
    const shard = this.shards.find((item) => !item.active);
    if (!shard) return;
    shard.active = true;
    shard.life = 0.7;
    shard.root.visible = true;
    shard.root.position.copy(origin).addScaledVector(side, 0.07 * sign);
    shard.root.lookAt(this.aim.copy(origin).add(incoming));
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
    for (const blade of this.blades) {
      blade.hasPrev = false;
      blade.line.visible = false;
    }
  }

  private drawInfo(): void {
    this.infoPanel.draw((ctx, w, h) => {
      this.infoPanel.drawRoundedBg(theme.inkPanel, theme.amber, 20);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = theme.amberSoft;
      ctx.font = `700 40px ${canvasFont}`;
      ctx.fillText(`スコア ${this.score}    ミス ${this.misses}`, w / 2, h * 0.38);
      ctx.fillStyle = theme.textMuted;
      ctx.font = `500 26px ${canvasFont}`;
      ctx.fillText('振ったときだけ切れます', w / 2, h * 0.72);
    });
  }
}
