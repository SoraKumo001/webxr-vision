import * as THREE from 'three';
import { AudioManager } from '../core/AudioManager';
import { Difficulty } from '../core/StorageManager';
import { InteractiveCallbacks } from '../core/InputManager';
import { SpatialButton, SpatialTextPanel } from '../ui/SpatialPanel';
import { ITrainingMode, TrainingHUDState, TrainingResult } from './ITrainingMode';
import { ModeUiChrome } from './ModeUiChrome';

type StretchPattern = 'push-pull' | 'figure8' | 'spiral';

function durationForDifficulty(difficulty: Difficulty): number {
  return difficulty === 'easy' ? 90 : difficulty === 'normal' ? 75 : 60;
}

function speedForDifficulty(difficulty: Difficulty): number {
  return difficulty === 'easy' ? 0.45 : difficulty === 'normal' ? 0.7 : 1.0;
}

export class FocusStretchMode implements ITrainingMode {
  public readonly id = 'focus-stretch' as const;
  public readonly name = '1. 遠近ピントストレッチ';
  public readonly description =
    '近距離と遠距離をゆっくり往復し、毛様体筋をほぐすガイドストレッチです';
  public readonly group = new THREE.Group();

  private readonly arena = new THREE.Group();
  private readonly targetGroup = new THREE.Group();
  private readonly outerWire: THREE.Mesh;
  private readonly breathRing: THREE.Mesh;
  private readonly distancePanel: SpatialTextPanel;

  private readonly patternButtons: { id: StretchPattern; btn: SpatialButton }[] = [];
  private readonly interactiveObjects: THREE.Object3D[] = [];
  private readonly uiChrome: ModeUiChrome;

  private readonly audio: AudioManager;
  public onUiHiddenChange?: (hidden: boolean) => void;

  private difficulty: Difficulty = 'normal';
  private pattern: StretchPattern = 'push-pull';
  private autoCyclePattern = true;

  private durationTotal = 75;
  private remaining = 75;
  private elapsedInMode = 0;
  private lastMovingOut = false;
  private currentDistMeters = 2.0;

  constructor(audio: AudioManager) {
    this.audio = audio;
    this.group.add(this.arena);

    const outerGeo = new THREE.IcosahedronGeometry(0.22, 1);
    const outerMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.75
    });
    this.outerWire = new THREE.Mesh(outerGeo, outerMat);
    this.targetGroup.add(this.outerWire);

    const coreGeo = new THREE.SphereGeometry(0.14, 24, 24);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0x0f172a,
      transparent: true,
      opacity: 0.82,
      depthWrite: false
    });
    this.targetGroup.add(new THREE.Mesh(coreGeo, coreMat));

    const innerGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.88 })
    );
    innerGlow.renderOrder = 1;
    this.targetGroup.add(innerGlow);

    const ringGeo = new THREE.RingGeometry(0.26, 0.29, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x34d399,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide
    });
    this.breathRing = new THREE.Mesh(ringGeo, ringMat);
    this.targetGroup.add(this.breathRing);

    this.distancePanel = new SpatialTextPanel(0.7, 0.24, 512, 176);
    this.distancePanel.mesh.position.set(0, 0.33, 0);
    this.targetGroup.add(this.distancePanel.mesh);

    const targetCallbacks: InteractiveCallbacks = {
      gazeEnabled: false,
      onHover: () => {
        (this.outerWire.material as THREE.MeshBasicMaterial).color.setHex(0x6ee7b7);
      },
      onBlur: () => {
        (this.outerWire.material as THREE.MeshBasicMaterial).color.setHex(0x38bdf8);
      }
    };
    this.targetGroup.userData = targetCallbacks;
    this.arena.add(this.targetGroup);

    const patternDefs: { id: StretchPattern; label: string; x: number }[] = [
      { id: 'push-pull', label: '遠近往復', x: -0.44 },
      { id: 'figure8', label: '3D 8の字', x: 0 },
      { id: 'spiral', label: '螺旋追従', x: 0.44 }
    ];
    for (const def of patternDefs) {
      const btn = new SpatialButton({
        width: 0.38,
        height: 0.14,
        label: def.label,
        fontSize: 34,
        onSelect: () => {
          this.pattern = def.id;
          this.autoCyclePattern = false;
          this.audio.playSelect();
          this.refreshButtonStates();
        }
      });
      btn.mesh.position.set(def.x, -0.52, -1.7);
      this.arena.add(btn.mesh);
      this.patternButtons.push({ id: def.id, btn });
    }

    this.uiChrome = new ModeUiChrome(this.arena, audio, {
      showButtonPosition: new THREE.Vector3(0, -0.85, -1.7)
    });
    this.uiChrome.setChrome([
      this.distancePanel.mesh,
      ...this.patternButtons.map((p) => p.btn.mesh)
    ]);
    this.uiChrome.onChange = (hidden) => {
      this.rebuildInteractives();
      this.onUiHiddenChange?.(hidden);
    };
    this.rebuildInteractives();
  }

  private rebuildInteractives(): void {
    this.interactiveObjects.length = 0;
    this.interactiveObjects.push(this.targetGroup);
    if (!this.uiChrome.isHidden()) {
      for (const item of this.patternButtons) {
        this.interactiveObjects.push(item.btn.mesh);
      }
    }
    this.uiChrome.appendInteractives(this.interactiveObjects);
  }

  private refreshButtonStates(): void {
    for (const item of this.patternButtons) {
      item.btn.setActive(item.id === this.pattern);
    }
  }

  public isUiHidden(): boolean {
    return this.uiChrome.isHidden();
  }

  public setUiHidden(hidden: boolean): void {
    this.uiChrome.setHidden(hidden);
  }

  public start(difficulty: Difficulty, headPos: THREE.Vector3, headQuat: THREE.Quaternion): void {
    this.difficulty = difficulty;
    this.durationTotal = durationForDifficulty(difficulty);
    this.remaining = this.durationTotal;
    this.elapsedInMode = 0;
    this.pattern = 'push-pull';
    this.autoCyclePattern = true;
    this.lastMovingOut = false;

    const euler = new THREE.Euler().setFromQuaternion(headQuat, 'YXZ');
    this.arena.position.copy(headPos);
    this.arena.rotation.set(0, euler.y, 0);

    this.uiChrome.setHidden(false);
    this.refreshButtonStates();
    this.group.visible = true;
  }

  public recenter(headPos: THREE.Vector3, headQuat: THREE.Quaternion): void {
    const euler = new THREE.Euler().setFromQuaternion(headQuat, 'YXZ');
    this.arena.position.copy(headPos);
    this.arena.rotation.set(0, euler.y, 0);
  }

  public stop(): TrainingResult {
    this.uiChrome.setHidden(false);
    this.group.visible = false;
    const duration = Math.max(1, Math.round(this.durationTotal - this.remaining));
    return {
      modeId: this.id,
      durationSec: duration,
      summary: `遠近ピントストレッチ ${duration}秒`
    };
  }

  public update(dt: number): boolean {
    this.remaining -= dt;
    this.elapsedInMode += dt;

    if (this.autoCyclePattern) {
      const phaseIdx = Math.floor(this.elapsedInMode / 25) % 3;
      const autoPatterns: StretchPattern[] = ['push-pull', 'figure8', 'spiral'];
      if (this.pattern !== autoPatterns[phaseIdx]) {
        this.pattern = autoPatterns[phaseIdx];
        this.refreshButtonStates();
      }
    }

    const speed = speedForDifficulty(this.difficulty);
    const t = this.elapsedInMode * speed;

    let x = 0;
    let y = 0.05;
    let z = -2.0;

    if (this.pattern === 'push-pull') {
      const norm = (1 - Math.cos(t * 0.85)) * 0.5;
      const dist = 0.38 + norm * 11.62;
      z = -dist;
      y = 0.04 + Math.sin(t * 0.4) * 0.05;
    } else if (this.pattern === 'figure8') {
      z = -(2.9 + Math.cos(t * 0.65) * 1.1);
      x = Math.sin(t) * 1.1;
      y = 0.04 + Math.sin(t * 2) * 0.32;
    } else {
      const norm = (1 - Math.cos(t * 0.7)) * 0.5;
      z = -(0.6 + norm * 9.4);
      const distRatio = Math.min(1, (-z) / 2.8);
      const r = (0.38 + 0.28 * Math.sin(t * 0.55)) * distRatio;
      x = Math.cos(t * 1.2) * r;
      y = 0.04 + Math.sin(t * 1.2) * r * 0.8;
    }

    const prevZ = this.targetGroup.position.z;
    this.targetGroup.position.set(x, y, z);
    this.currentDistMeters = Math.sqrt(x * x + y * y + z * z);

    const scale = Math.max(0.75, 0.65 + this.currentDistMeters * 0.14);
    this.targetGroup.scale.setScalar(scale);
    this.targetGroup.lookAt(this.arena.position);
    this.outerWire.rotation.y += dt * 0.8;
    this.outerWire.rotation.x += dt * 0.45;

    const movingOut = z < prevZ;
    if (movingOut !== this.lastMovingOut && this.elapsedInMode > 0.5) {
      this.lastMovingOut = movingOut;
      this.audio.playBreathCue(!movingOut);
    }
    const breathScale = 0.92 + Math.sin(this.elapsedInMode * 2.0) * 0.14;
    this.breathRing.scale.setScalar(breathScale);

    this.distancePanel.draw((ctx, w, h) => {
      this.distancePanel.drawRoundedBg('rgba(15, 23, 42, 0.86)', '#38bdf8', 22);
      ctx.fillStyle = '#e2e8f0';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 54px "Segoe UI", sans-serif';
      ctx.fillText(`${this.currentDistMeters.toFixed(1)} m`, w / 2, h * 0.42);
      ctx.fillStyle = movingOut ? '#6ee7b7' : '#93c5fd';
      ctx.font = 'bold 34px "Segoe UI", "Hiragino Sans", sans-serif';
      ctx.fillText(movingOut ? '遠くへ (息を吐く)' : '手前へ (ピント集中)', w / 2, h * 0.76);
    });

    return this.remaining > 0;
  }

  public getInteractiveObjects(): THREE.Object3D[] {
    return this.interactiveObjects;
  }

  public onObjectSelected(_obj: THREE.Object3D): void {
    // Handled via SpatialButton callbacks
  }

  public getHUDState(): TrainingHUDState {
    const patternLabel =
      this.pattern === 'push-pull' ? '遠近往復' : this.pattern === 'figure8' ? '8の字' : '螺旋';
    return {
      title: this.name,
      instruction: 'ターゲットをゆっくり追い、近遠のピント変化に合わせて呼吸を整えましょう',
      remainingSeconds: Math.max(0, Math.ceil(this.remaining)),
      metricLabel: `${patternLabel} | ${this.currentDistMeters.toFixed(1)}m`
    };
  }
}
