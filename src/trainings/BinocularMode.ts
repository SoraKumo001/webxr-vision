import * as THREE from 'three';
import { AudioManager } from '../core/AudioManager';
import { Difficulty } from '../core/StorageManager';
import { GroupFade } from '../ui/GroupFade';
import { SpatialTextPanel } from '../ui/SpatialPanel';
import { canvasFont, theme, themeHex } from '../ui/theme';
import { ITrainingMode, TrainingHUDState, TrainingResult } from './ITrainingMode';
import { ModeUiChrome } from './ModeUiChrome';

function durationForDifficulty(difficulty: Difficulty): number {
  return difficulty === 'easy' ? 90 : difficulty === 'normal' ? 75 : 60;
}

function cyclePeriodForDifficulty(difficulty: Difficulty): number {
  return difficulty === 'easy' ? 12 : difficulty === 'normal' ? 9 : 6.5;
}

function maxOffsetForDifficulty(difficulty: Difficulty): number {
  return difficulty === 'easy' ? 0.1 : difficulty === 'normal' ? 0.14 : 0.18;
}

export class BinocularMode implements ITrainingMode {
  public readonly id = 'binocular' as const;
  public readonly name = '4. 輻輳・開散ストレッチ';
  public readonly description =
    '左右のターゲットが寄り→離れをゆっくり繰り返し、輻輳と開散をやさしくほぐします';
  public readonly group = new THREE.Group();

  private readonly arena = new THREE.Group();
  private readonly leftTarget = new THREE.Group();
  private readonly rightTarget = new THREE.Group();
  private readonly centerGuide: THREE.Mesh;
  private readonly infoPanel: SpatialTextPanel;
  private readonly uiChrome: ModeUiChrome;
  private readonly groupFade: GroupFade;
  private readonly interactiveObjects: THREE.Object3D[] = [];
  private readonly audio: AudioManager;
  public onUiHiddenChange?: (hidden: boolean) => void;

  private durationTotal = 75;
  private remaining = 75;
  private elapsedInMode = 0;
  private cyclePeriod = 9;
  private maxOffset = 0.14;
  private currentOffset = 0;
  private lastPhase: 'converge' | 'diverge' = 'converge';

  constructor(audio: AudioManager) {
    this.audio = audio;
    this.group.add(this.arena);
    this.groupFade = new GroupFade(this.group);

    this.centerGuide = new THREE.Mesh(
      new THREE.RingGeometry(0.07, 0.095, 40),
      new THREE.MeshBasicMaterial({
        color: themeHex.sand,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    this.centerGuide.position.set(0, 0.06, -2.165);
    this.arena.add(this.centerGuide);

    this.buildEyeTarget(this.leftTarget, themeHex.stereoLeft, '+');
    this.buildEyeTarget(this.rightTarget, themeHex.stereoRight, '○');
    this.leftTarget.position.set(0, 0.06, -2.155);
    this.rightTarget.position.set(0, 0.06, -2.14);
    this.arena.add(this.leftTarget, this.rightTarget);

    this.infoPanel = new SpatialTextPanel(1.35, 0.22, 960, 160);
    this.infoPanel.mesh.position.set(0, 0.58, -2.05);
    this.arena.add(this.infoPanel.mesh);

    this.uiChrome = new ModeUiChrome(this.arena, audio, {
      showButtonPosition: new THREE.Vector3(0, -0.85, -1.7)
    });
    this.uiChrome.setChrome([this.infoPanel.mesh]);
    this.uiChrome.onChange = (hidden) => {
      this.rebuildInteractives();
      this.onUiHiddenChange?.(hidden);
    };
    this.rebuildInteractives();
    this.groupFade.setImmediate(false);
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

  private buildEyeTarget(group: THREE.Group, color: number, mark: string): void {
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(0.19, 40),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    glow.position.z = -0.002;
    group.add(glow);

    const core = new THREE.Mesh(
      new THREE.CircleGeometry(0.13, 40),
      new THREE.MeshBasicMaterial({
        color: themeHex.ink,
        transparent: true,
        opacity: 0.78
      })
    );
    group.add(core);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.13, 0.165, 48),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    ring.position.z = 0.002;
    group.add(ring);

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, 128, 128);
      ctx.fillStyle = theme.text;
      ctx.font = 'bold 72px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(mark, 64, 70);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(0.15, 0.15),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide })
    );
    label.position.z = 0.01;
    group.add(label);
  }

  public start(difficulty: Difficulty, headPos: THREE.Vector3, headQuat: THREE.Quaternion): void {
    this.durationTotal = durationForDifficulty(difficulty);
    this.remaining = this.durationTotal;
    this.elapsedInMode = 0;
    this.cyclePeriod = cyclePeriodForDifficulty(difficulty);
    this.maxOffset = maxOffsetForDifficulty(difficulty);
    this.currentOffset = 0;
    this.lastPhase = 'converge';

    const euler = new THREE.Euler().setFromQuaternion(headQuat, 'YXZ');
    this.arena.position.copy(headPos);
    this.arena.rotation.set(0, euler.y, 0);

    this.uiChrome.setHidden(false);
    this.groupFade.show();
  }

  public recenter(headPos: THREE.Vector3, headQuat: THREE.Quaternion): void {
    const euler = new THREE.Euler().setFromQuaternion(headQuat, 'YXZ');
    this.arena.position.copy(headPos);
    this.arena.rotation.set(0, euler.y, 0);
  }

  public stop(): TrainingResult {
    this.uiChrome.setHidden(false);
    this.groupFade.setImmediate(false);
    const duration = Math.max(1, Math.round(this.durationTotal - this.remaining));
    return {
      modeId: this.id,
      durationSec: duration,
      summary: `輻輳・開散ストレッチ ${duration}秒`
    };
  }

  public update(dt: number): boolean {
    this.groupFade.update(dt);
    this.remaining -= dt;
    this.elapsedInMode += dt;

    const phase = (this.elapsedInMode % this.cyclePeriod) / this.cyclePeriod;
    const norm = (1 - Math.cos(phase * Math.PI * 2)) * 0.5;
    this.currentOffset = norm * this.maxOffset;

    const converging = phase < 0.5;
    const phaseLabel: 'converge' | 'diverge' = converging ? 'converge' : 'diverge';
    if (phaseLabel !== this.lastPhase && this.elapsedInMode > 0.4) {
      this.lastPhase = phaseLabel;
      this.audio.playBreathCue(converging);
    }

    this.leftTarget.position.x = -this.currentOffset;
    this.rightTarget.position.x = this.currentOffset;

    const pulse = 0.96 + Math.sin(this.elapsedInMode * 2.0) * 0.08;
    this.leftTarget.scale.setScalar(pulse);
    this.rightTarget.scale.setScalar(pulse);
    this.centerGuide.scale.setScalar(1.05 + (1 - norm) * 0.25);

    this.infoPanel.draw((ctx, w, h) => {
      this.infoPanel.drawRoundedBg(theme.inkPanel, theme.modeBinocular, 22);
      ctx.fillStyle = theme.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `600 34px ${canvasFont}`;
      ctx.fillText(
        converging
          ? '寄り（輻輳）— 左右が近づくのをやさしく見つめる'
          : '離れ（開散）— 左右が離れるのに合わせて力を抜く',
        w / 2,
        h * 0.36
      );
      ctx.fillStyle = theme.modeBinocular;
      ctx.font = `600 28px ${canvasFont}`;
      ctx.fillText(
        `間隔: ${(this.currentOffset * 200).toFixed(1)} cm  |  周期 ${this.cyclePeriod.toFixed(1)}秒`,
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
    // Guided-only mode; no interactive targets
  }

  public getHUDState(): TrainingHUDState {
    const converging = this.lastPhase === 'converge';
    return {
      title: this.name,
      instruction: '力まず中央付近を見つめ、左右ターゲットの寄り離れに目を合わせましょう',
      remainingSeconds: Math.max(0, Math.ceil(this.remaining)),
      metricLabel: converging ? '輻輳（寄り）' : '開散（離れ）'
    };
  }
}
