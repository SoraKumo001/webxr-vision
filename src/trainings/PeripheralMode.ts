import * as THREE from 'three';
import { AudioManager } from '../core/AudioManager';
import { Difficulty } from '../core/StorageManager';
import { InteractiveCallbacks } from '../core/InputManager';
import { ITrainingMode, TrainingHUDState, TrainingResult } from './ITrainingMode';

interface ActiveOrb {
  mesh: THREE.Mesh;
  ring: THREE.Mesh;
  isTarget: boolean;
  velocity: THREE.Vector3;
  baseRadius: number;
  spawnTime: number;
}

export class PeripheralMode implements ITrainingMode {
  public readonly id = 'peripheral' as const;
  public readonly name = '2. 動体視力・周辺視野';
  public readonly description = '立体音響と周辺視野を頼りに移動するターゲットを素早く捉えます';
  public readonly group = new THREE.Group();

  private readonly arena = new THREE.Group();
  private readonly centerAnchor: THREE.Group;
  private readonly orbsGroup = new THREE.Group();
  private readonly interactiveObjects: THREE.Object3D[] = [];
  private readonly audio: AudioManager;

  private orbs: ActiveOrb[] = [];
  private difficulty: Difficulty = 'normal';
  private score = 0;
  private hits = 0;
  private attempts = 0;
  private combo = 0;
  private lastReactionMs = 0;
  private bestReactionMs = 0;
  private reactionSumMs = 0;

  private durationTotal = 60;
  private remaining = 60;
  private roundTimer = 0;
  private roundTimeout = 4.0;
  private headPosRef = new THREE.Vector3(0, 1.5, 0);
  private headQuatRef = new THREE.Quaternion();

  constructor(audio: AudioManager) {
    this.audio = audio;
    this.group.add(this.arena);
    this.arena.add(this.orbsGroup);

    // Central fixation anchor at z = -2.5m
    this.centerAnchor = new THREE.Group();
    this.centerAnchor.position.set(0, 0, -2.5);

    const crossH = new THREE.Mesh(
      new THREE.PlaneGeometry(0.14, 0.015),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.75 })
    );
    const crossV = new THREE.Mesh(
      new THREE.PlaneGeometry(0.015, 0.14),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.75 })
    );
    const centerRing = new THREE.Mesh(
      new THREE.RingGeometry(0.09, 0.105, 32),
      new THREE.MeshBasicMaterial({
        color: 0x7dd3fc,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide
      })
    );
    this.centerAnchor.add(crossH, crossV, centerRing);
    this.arena.add(this.centerAnchor);
  }

  public start(difficulty: Difficulty, headPos: THREE.Vector3, headQuat: THREE.Quaternion): void {
    this.difficulty = difficulty;
    this.score = 0;
    this.hits = 0;
    this.attempts = 0;
    this.combo = 0;
    this.lastReactionMs = 0;
    this.bestReactionMs = 0;
    this.reactionSumMs = 0;
    this.durationTotal = 60;
    this.remaining = this.durationTotal;

    this.roundTimeout = difficulty === 'easy' ? 5.0 : difficulty === 'normal' ? 3.8 : 2.9;

    const euler = new THREE.Euler().setFromQuaternion(headQuat, 'YXZ');
    this.arena.position.copy(headPos);
    this.arena.rotation.set(0, euler.y, 0);
    this.headPosRef.copy(headPos);
    this.headQuatRef.copy(headQuat);

    this.group.visible = true;
    this.spawnRound();
  }

  private clearOrbs(): void {
    for (const orb of this.orbs) {
      this.orbsGroup.remove(orb.mesh);
      orb.mesh.geometry.dispose();
      (orb.mesh.material as THREE.Material).dispose();
      orb.ring.geometry.dispose();
      (orb.ring.material as THREE.Material).dispose();
    }
    this.orbs = [];
    this.interactiveObjects.length = 0;
  }

  private spawnRound(): void {
    this.clearOrbs();
    this.roundTimer = 0;

    const decoyCount = this.difficulty === 'easy' ? 0 : this.difficulty === 'normal' ? 1 : 2;
    const totalOrbs = 1 + decoyCount;

    const minDeg = this.difficulty === 'easy' ? 18 : this.difficulty === 'normal' ? 24 : 30;
    const maxDeg = this.difficulty === 'easy' ? 38 : this.difficulty === 'normal' ? 48 : 58;

    for (let i = 0; i < totalOrbs; i++) {
      const isTarget = i === 0;
      const azDeg = (Math.random() > 0.5 ? 1 : -1) * (minDeg + Math.random() * (maxDeg - minDeg));
      const elDeg = (Math.random() - 0.5) * 34;
      const dist = 2.0 + Math.random() * 2.0;

      const az = THREE.MathUtils.degToRad(azDeg);
      const el = THREE.MathUtils.degToRad(elDeg);

      const x = Math.sin(az) * Math.cos(el) * dist;
      const y = Math.sin(el) * dist;
      const z = -Math.cos(az) * Math.cos(el) * dist;

      const radius = isTarget
        ? this.difficulty === 'hard'
          ? 0.14
          : 0.17
        : 0.15;

      const geo = isTarget
        ? new THREE.OctahedronGeometry(radius, 1)
        : new THREE.BoxGeometry(radius * 1.5, radius * 1.5, radius * 1.5);
      const mat = new THREE.MeshBasicMaterial({
        color: isTarget ? 0x10b981 : 0xf43f5e,
        wireframe: !isTarget
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);

      const ringGeo = new THREE.RingGeometry(radius * 1.35, radius * 1.55, 32);
      const ringMat = new THREE.MeshBasicMaterial({
        color: isTarget ? 0x6ee7b7 : 0xfda4af,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      mesh.add(ring);

      const speedScale =
        this.difficulty === 'easy' ? 0.35 : this.difficulty === 'normal' ? 0.75 : 1.25;
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * speedScale,
        (Math.random() - 0.5) * speedScale * 0.7,
        (Math.random() - 0.5) * speedScale * 0.4
      );

      const orb: ActiveOrb = {
        mesh,
        ring,
        isTarget,
        velocity,
        baseRadius: radius,
        spawnTime: performance.now()
      };

      const callbacks: InteractiveCallbacks = {
        gazeEnabled: true,
        gazeDwellSeconds: 0.48,
        onHover: () => {
          mesh.scale.setScalar(1.22);
        },
        onBlur: () => {
          mesh.scale.setScalar(1.0);
        },
        onSelect: () => {
          this.handleOrbSelected(orb);
        }
      };
      mesh.userData = callbacks;

      this.orbsGroup.add(mesh);
      this.orbs.push(orb);
      this.interactiveObjects.push(mesh);

      if (isTarget) {
        const worldPos = mesh.position.clone().applyMatrix4(this.arena.matrixWorld);
        this.audio.playSpatialPing(worldPos, this.headPosRef, this.headQuatRef);
      }
    }
  }

  private handleOrbSelected(orb: ActiveOrb): void {
    this.attempts += 1;
    if (orb.isTarget) {
      const rt = Math.max(120, Math.round(performance.now() - orb.spawnTime));
      this.lastReactionMs = rt;
      this.reactionSumMs += rt;
      this.bestReactionMs = this.bestReactionMs === 0 ? rt : Math.min(this.bestReactionMs, rt);

      this.hits += 1;
      this.combo += 1;
      const speedBonus = Math.max(40, Math.round((3000 - Math.min(2600, rt)) / 10));
      this.score += 100 + speedBonus + this.combo * 15;
      this.audio.playSuccess();
      this.spawnRound();
    } else {
      this.combo = 0;
      this.audio.playMiss();
    }
  }

  public stop(): TrainingResult {
    this.clearOrbs();
    this.group.visible = false;
    const accuracy = this.attempts > 0 ? (this.hits / this.attempts) * 100 : 0;
    const avgRt = this.hits > 0 ? Math.round(this.reactionSumMs / this.hits) : 0;
    const duration = Math.max(1, Math.round(this.durationTotal - this.remaining));
    return {
      modeId: this.id,
      score: Math.round(this.score),
      accuracy: Math.round(accuracy),
      durationSec: duration,
      summary: `ヒット ${this.hits}回 | 平均反応 ${avgRt}ms`
    };
  }

  public update(
    dt: number,
    _elapsed: number,
    headPos: THREE.Vector3,
    headQuat: THREE.Quaternion
  ): boolean {
    this.headPosRef.copy(headPos);
    this.headQuatRef.copy(headQuat);

    this.remaining -= dt;
    this.roundTimer += dt;

    if (this.roundTimer >= this.roundTimeout) {
      this.attempts += 1;
      this.combo = 0;
      this.audio.playMiss();
      this.spawnRound();
    }

    for (const orb of this.orbs) {
      orb.mesh.position.addScaledVector(orb.velocity, dt);
      orb.mesh.rotation.y += dt * 2.2;
      orb.mesh.rotation.x += dt * 1.4;
      orb.ring.lookAt(headPos);

      // Soft bounce bounds in arena coordinates
      if (Math.abs(orb.mesh.position.x) > 2.6) orb.velocity.x *= -1;
      if (Math.abs(orb.mesh.position.y) > 1.35) orb.velocity.y *= -1;
      if (orb.mesh.position.z > -1.3 || orb.mesh.position.z < -4.2) orb.velocity.z *= -1;
    }

    return this.remaining > 0;
  }

  public getInteractiveObjects(): THREE.Object3D[] {
    return this.interactiveObjects;
  }

  public onObjectSelected(_obj: THREE.Object3D): void {
    // Handled via orb callbacks
  }

  public getHUDState(): TrainingHUDState {
    const accuracy = this.attempts > 0 ? Math.round((this.hits / this.attempts) * 100) : 100;
    return {
      title: this.name,
      instruction: '中央の十字を意識しつつ、周辺に現れる緑の多面体を素早く狙ってください',
      score: Math.round(this.score),
      accuracy,
      remainingSeconds: Math.max(0, Math.ceil(this.remaining)),
      metricLabel: `連続: ${this.combo} | 直近反応: ${this.lastReactionMs || '-'}ms`
    };
  }
}
