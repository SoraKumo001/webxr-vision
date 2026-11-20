import * as THREE from 'three';
import { AudioManager } from '../core/AudioManager';
import { Difficulty } from '../core/StorageManager';
import { InteractiveCallbacks } from '../core/InputManager';
import { SpatialTextPanel } from '../ui/SpatialPanel';
import { ITrainingMode, TrainingHUDState, TrainingResult } from './ITrainingMode';

const GABOR_VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GABOR_FRAGMENT_SHADER = `
uniform float uTheta;
uniform float uFreq;
uniform float uContrast;
uniform float uPhase;
uniform float uHovered;
uniform float uMatched;
varying vec2 vUv;

void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;

  float sigma = 0.36;
  float c = cos(uTheta);
  float s = sin(uTheta);
  float xr = p.x * c + p.y * s;
  float yr = -p.x * s + p.y * c;

  float env = exp(-(xr * xr + yr * yr) / (2.0 * sigma * sigma));
  float wave = cos(6.2831853 * uFreq * xr + uPhase);
  float lum = 0.5 + 0.5 * uContrast * env * wave;
  vec3 col = vec3(lum);

  float dist = sqrt(r2);
  if (uMatched > 0.5 && dist > 0.87) {
    col = vec3(0.18, 0.88, 0.55);
  } else if (uHovered > 0.5 && dist > 0.90) {
    col = vec3(0.22, 0.74, 0.97);
  }

  float alpha = smoothstep(1.0, 0.86, dist);
  gl_FragColor = vec4(col, alpha);
}
`;

interface GaborCandidate {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  isMatch: boolean;
  found: boolean;
}

export class GaborPatchMode implements ITrainingMode {
  public readonly id = 'gabor-patch' as const;
  public readonly name = '3. 3Dガボールパッチ';
  public readonly description = 'GLSL数式生成の高精細縞模様で視覚野とコントラスト感度を鍛えます';
  public readonly group = new THREE.Group();

  private readonly arena = new THREE.Group();
  private readonly candidatesGroup = new THREE.Group();
  private readonly referenceMesh: THREE.Mesh;
  private readonly referenceMat: THREE.ShaderMaterial;
  private readonly refLabel: SpatialTextPanel;
  private readonly interactiveObjects: THREE.Object3D[] = [];
  private readonly audio: AudioManager;

  private candidates: GaborCandidate[] = [];
  private difficulty: Difficulty = 'normal';
  private score = 0;
  private hits = 0;
  private attempts = 0;
  private streak = 0;
  private level = 1;
  private durationTotal = 75;
  private remaining = 75;
  private matchesRemaining = 0;
  private currentContrast = 0.95;

  constructor(audio: AudioManager) {
    this.audio = audio;
    this.group.add(this.arena);
    this.arena.add(this.candidatesGroup);

    this.referenceMat = this.createGaborMaterial(0, 3.0, 0.95);
    this.referenceMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.42, 0.42),
      this.referenceMat
    );
    this.referenceMesh.position.set(0, 0.58, -1.95);
    this.arena.add(this.referenceMesh);

    this.refLabel = new SpatialTextPanel(0.56, 0.14, 512, 128);
    this.refLabel.mesh.position.set(0, 0.86, -1.95);
    this.refLabel.draw((ctx, w, h) => {
      this.refLabel.drawRoundedBg('rgba(15, 23, 42, 0.88)', '#38bdf8', 20);
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 44px "Segoe UI", "Hiragino Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('見本 (同じ模様を全て選択)', w / 2, h / 2);
    });
    this.arena.add(this.refLabel.mesh);
  }

  private createGaborMaterial(theta: number, freq: number, contrast: number): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: GABOR_VERTEX_SHADER,
      fragmentShader: GABOR_FRAGMENT_SHADER,
      transparent: true,
      side: THREE.DoubleSide,
      uniforms: {
        uTheta: { value: theta },
        uFreq: { value: freq },
        uContrast: { value: contrast },
        uPhase: { value: 0 },
        uHovered: { value: 0 },
        uMatched: { value: 0 }
      }
    });
  }

  public start(difficulty: Difficulty, headPos: THREE.Vector3, headQuat: THREE.Quaternion): void {
    this.difficulty = difficulty;
    this.score = 0;
    this.hits = 0;
    this.attempts = 0;
    this.streak = 0;
    this.level = 1;
    this.durationTotal = 75;
    this.remaining = this.durationTotal;

    const euler = new THREE.Euler().setFromQuaternion(headQuat, 'YXZ');
    this.arena.position.copy(headPos);
    this.arena.rotation.set(0, euler.y, 0);

    this.group.visible = true;
    this.buildRound();
  }

  private clearCandidates(): void {
    for (const c of this.candidates) {
      this.candidatesGroup.remove(c.mesh);
      c.mesh.geometry.dispose();
      c.material.dispose();
    }
    this.candidates = [];
    this.interactiveObjects.length = 0;
  }

  private buildRound(): void {
    this.clearCandidates();

    const baseContrast =
      this.difficulty === 'easy' ? 0.96 : this.difficulty === 'normal' ? 0.88 : 0.78;
    this.currentContrast = Math.max(0.24, baseContrast - (this.level - 1) * 0.065);

    const freq =
      this.difficulty === 'easy'
        ? 2.6
        : this.difficulty === 'normal'
          ? 3.2 + (this.level % 2) * 0.5
          : 3.8 + (this.level % 3) * 0.6;
    const targetTheta = Math.random() * Math.PI;

    this.referenceMat.uniforms.uTheta.value = targetTheta;
    this.referenceMat.uniforms.uFreq.value = freq;
    this.referenceMat.uniforms.uContrast.value = Math.max(0.45, this.currentContrast);

    const totalCount = this.difficulty === 'easy' ? 6 : this.difficulty === 'normal' ? 8 : 9;
    const matchCount = this.difficulty === 'easy' ? 2 : 3;
    this.matchesRemaining = matchCount;

    const baseAngleDeltaDeg =
      this.difficulty === 'easy' ? 38 : this.difficulty === 'normal' ? 26 : 16;
    const angleDelta = THREE.MathUtils.degToRad(
      Math.max(9, baseAngleDeltaDeg - (this.level - 1) * 2.2)
    );

    const flags: boolean[] = Array.from({ length: totalCount }, (_, i) => i < matchCount);
    for (let i = flags.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [flags[i], flags[j]] = [flags[j], flags[i]];
    }

    const cols = totalCount === 6 ? 3 : totalCount === 8 ? 4 : 3;
    const rows = Math.ceil(totalCount / cols);

    flags.forEach((isMatch, idx) => {
      const row = Math.floor(idx / cols);
      const col = idx % cols;

      const xOffset = (col - (cols - 1) / 2) * 0.54;
      const yOffset = ((rows - 1) / 2 - row) * 0.44 - 0.14;
      const depth = -2.0 - ((idx % 3) * 0.35 + (isMatch ? 0 : 0.1));

      const sign = Math.random() > 0.5 ? 1 : -1;
      const theta = isMatch
        ? targetTheta
        : targetTheta + sign * (angleDelta + Math.random() * 0.32);

      const mat = this.createGaborMaterial(theta, freq, this.currentContrast);
      const patchSize = 0.36 + (Math.abs(depth) - 2.0) * 0.08;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(patchSize, patchSize), mat);
      mesh.position.set(xOffset, yOffset, depth);
      mesh.lookAt(0, 0, 0);

      const candidate: GaborCandidate = {
        mesh,
        material: mat,
        isMatch,
        found: false
      };

      const callbacks: InteractiveCallbacks = {
        gazeEnabled: true,
        gazeDwellSeconds: 0.72,
        onHover: () => {
          mat.uniforms.uHovered.value = 1;
          mesh.scale.setScalar(1.08);
        },
        onBlur: () => {
          mat.uniforms.uHovered.value = 0;
          mesh.scale.setScalar(1.0);
        },
        onSelect: () => this.handleCandidateSelect(candidate)
      };
      mesh.userData = callbacks;

      this.candidatesGroup.add(mesh);
      this.candidates.push(candidate);
      this.interactiveObjects.push(mesh);
    });
  }

  private handleCandidateSelect(candidate: GaborCandidate): void {
    if (candidate.found) return;
    this.attempts += 1;

    if (candidate.isMatch) {
      candidate.found = true;
      candidate.material.uniforms.uMatched.value = 1;
      this.hits += 1;
      this.matchesRemaining -= 1;
      this.score += 100 + this.level * 25;

      if (this.matchesRemaining <= 0) {
        this.streak += 1;
        this.level += 1;
        this.score += 120;
        this.audio.playSuccess();
        this.buildRound();
      } else {
        this.audio.playSelect();
      }
    } else {
      this.streak = 0;
      this.audio.playMiss();
    }
  }

  public stop(): TrainingResult {
    this.clearCandidates();
    this.group.visible = false;
    const accuracy = this.attempts > 0 ? (this.hits / this.attempts) * 100 : 100;
    const duration = Math.max(1, Math.round(this.durationTotal - this.remaining));
    return {
      modeId: this.id,
      score: Math.round(this.score),
      accuracy: Math.round(accuracy),
      durationSec: duration,
      summary: `到達Lv.${this.level} | 最小コントラスト ${Math.round(this.currentContrast * 100)}%`
    };
  }

  public update(dt: number): boolean {
    this.remaining -= dt;
    return this.remaining > 0;
  }

  public getInteractiveObjects(): THREE.Object3D[] {
    return this.interactiveObjects;
  }

  public onObjectSelected(_obj: THREE.Object3D): void {
    // Handled via candidate callbacks
  }

  public getHUDState(): TrainingHUDState {
    const accuracy = this.attempts > 0 ? Math.round((this.hits / this.attempts) * 100) : 100;
    return {
      title: this.name,
      instruction: `見本と同じ角度・間隔のガボールパッチを残り ${this.matchesRemaining} 枚選んでください`,
      score: Math.round(this.score),
      accuracy,
      remainingSeconds: Math.max(0, Math.ceil(this.remaining)),
      metricLabel: `Lv.${this.level} | コントラスト: ${Math.round(this.currentContrast * 100)}% | 連続: ${this.streak}`
    };
  }
}
