import * as THREE from 'three';
import { AudioManager } from '../core/AudioManager';
import { Difficulty } from '../core/StorageManager';
import { SpatialButton, SpatialTextPanel } from '../ui/SpatialPanel';
import { ITrainingMode, TrainingHUDState, TrainingResult } from './ITrainingMode';
import { ModeUiChrome } from './ModeUiChrome';

type GazePath = 'horizontal' | 'vertical' | 'figure8' | 'circle';

function durationForDifficulty(difficulty: Difficulty): number {
  return difficulty === 'easy' ? 90 : difficulty === 'normal' ? 75 : 60;
}

function speedForDifficulty(difficulty: Difficulty): number {
  return difficulty === 'easy' ? 0.35 : difficulty === 'normal' ? 0.55 : 0.8;
}

function amplitudeForDifficulty(difficulty: Difficulty): number {
  return difficulty === 'easy' ? 0.85 : difficulty === 'normal' ? 1.15 : 1.45;
}

export class PeripheralMode implements ITrainingMode {
  public readonly id = 'peripheral' as const;
  public readonly name = '2. 眼球運動ストレッチ';
  public readonly description =
    '左右・上下・8の字・円の誘導ターゲットをゆっくり追い、眼球まわりの筋肉をほぐします';
  public readonly group = new THREE.Group();

  private readonly arena = new THREE.Group();
  private readonly targetGroup = new THREE.Group();
  private readonly guideOrb: THREE.Mesh;
  private readonly trailRing: THREE.Mesh;
  private readonly infoPanel: SpatialTextPanel;
  private readonly pathButtons: { id: GazePath; btn: SpatialButton }[] = [];
  private readonly interactiveObjects: THREE.Object3D[] = [];
  private readonly uiChrome: ModeUiChrome;
  private readonly audio: AudioManager;
  public onUiHiddenChange?: (hidden: boolean) => void;

  private difficulty: Difficulty = 'normal';
  private path: GazePath = 'horizontal';
  private autoCycle = true;
  private durationTotal = 75;
  private remaining = 75;
  private elapsedInMode = 0;
  private lastBreathCue = 0;

  constructor(audio: AudioManager) {
    this.audio = audio;
    this.group.add(this.arena);

    this.guideOrb = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0x34d399 })
    );
    this.targetGroup.add(this.guideOrb);

    const wire = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.18, 0),
      new THREE.MeshBasicMaterial({
        color: 0x6ee7b7,
        wireframe: true,
        transparent: true,
        opacity: 0.7
      })
    );
    this.targetGroup.add(wire);

    this.trailRing = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.26, 48),
      new THREE.MeshBasicMaterial({
        color: 0xa7f3d0,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide
      })
    );
    this.targetGroup.add(this.trailRing);
    this.arena.add(this.targetGroup);

    this.infoPanel = new SpatialTextPanel(1.35, 0.22, 960, 160);
    this.infoPanel.mesh.position.set(0, 0.62, -2.1);
    this.arena.add(this.infoPanel.mesh);

    const pathDefs: { id: GazePath; label: string; x: number }[] = [
      { id: 'horizontal', label: '左右', x: -0.54 },
      { id: 'vertical', label: '上下', x: -0.18 },
      { id: 'figure8', label: '8の字', x: 0.18 },
      { id: 'circle', label: '円', x: 0.54 }
    ];
    for (const def of pathDefs) {
      const btn = new SpatialButton({
        width: 0.3,
        height: 0.13,
        label: def.label,
        fontSize: 32,
        onSelect: () => {
          this.path = def.id;
          this.autoCycle = false;
          this.audio.playSelect();
          this.refreshButtonStates();
        }
      });
      btn.mesh.position.set(def.x, -0.54, -1.7);
      this.arena.add(btn.mesh);
      this.pathButtons.push({ id: def.id, btn });
    }

    this.uiChrome = new ModeUiChrome(this.arena, audio, {
      showButtonPosition: new THREE.Vector3(0, -0.85, -1.7)
    });
    this.uiChrome.setChrome([
      this.infoPanel.mesh,
      ...this.pathButtons.map((p) => p.btn.mesh)
    ]);
    this.uiChrome.onChange = (hidden) => {
      this.rebuildInteractives();
      this.onUiHiddenChange?.(hidden);
    };
    this.rebuildInteractives();
  }

  private rebuildInteractives(): void {
    this.interactiveObjects.length = 0;
    if (!this.uiChrome.isHidden()) {
      for (const item of this.pathButtons) {
        this.interactiveObjects.push(item.btn.mesh);
      }
    }
    this.uiChrome.appendInteractives(this.interactiveObjects);
  }

  private refreshButtonStates(): void {
    for (const item of this.pathButtons) {
      item.btn.setActive(item.id === this.path);
    }
  }

  public isUiHidden(): boolean {
    return this.uiChrome.isHidden();
  }

  public setUiHidden(hidden: boolean): void {
    this.uiChrome.setHidden(hidden);
  }

  private pathLabel(path: GazePath): string {
    switch (path) {
      case 'horizontal':
        return '左右';
      case 'vertical':
        return '上下';
      case 'figure8':
        return '8の字';
      case 'circle':
        return '円';
    }
  }

  public start(difficulty: Difficulty, headPos: THREE.Vector3, headQuat: THREE.Quaternion): void {
    this.difficulty = difficulty;
    this.durationTotal = durationForDifficulty(difficulty);
    this.remaining = this.durationTotal;
    this.elapsedInMode = 0;
    this.path = 'horizontal';
    this.autoCycle = true;
    this.lastBreathCue = 0;

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
      summary: `眼球運動ストレッチ ${duration}秒`
    };
  }

  public update(dt: number): boolean {
    this.remaining -= dt;
    this.elapsedInMode += dt;

    if (this.autoCycle) {
      const paths: GazePath[] = ['horizontal', 'vertical', 'figure8', 'circle'];
      const phaseIdx = Math.floor(this.elapsedInMode / 20) % paths.length;
      if (this.path !== paths[phaseIdx]) {
        this.path = paths[phaseIdx];
        this.refreshButtonStates();
        this.audio.playBreathCue(true);
      }
    }

    const speed = speedForDifficulty(this.difficulty);
    const amp = amplitudeForDifficulty(this.difficulty);
    const t = this.elapsedInMode * speed;
    const depth = -2.4;

    let x = 0;
    let y = -0.02;

    if (this.path === 'horizontal') {
      x = Math.sin(t) * amp;
      y = -0.02;
    } else if (this.path === 'vertical') {
      x = 0;
      y = -0.02 + Math.sin(t) * (amp * 0.34);
    } else if (this.path === 'figure8') {
      x = Math.sin(t) * amp;
      y = -0.02 + Math.sin(t * 2) * (amp * 0.32);
    } else {
      x = Math.cos(t) * amp * 0.85;
      y = -0.02 + Math.sin(t) * amp * 0.34;
    }

    this.targetGroup.position.set(x, y, depth);
    this.targetGroup.lookAt(this.arena.position);
    this.trailRing.scale.setScalar(0.95 + Math.sin(this.elapsedInMode * 2.4) * 0.12);
    (this.guideOrb.material as THREE.MeshBasicMaterial).color.setHex(
      Math.sin(t) > 0 ? 0x34d399 : 0x2dd4bf
    );

    if (this.elapsedInMode - this.lastBreathCue > 8) {
      this.lastBreathCue = this.elapsedInMode;
      this.audio.playBreathCue(false);
    }

    this.infoPanel.draw((ctx, w, h) => {
      this.infoPanel.drawRoundedBg('rgba(15, 23, 42, 0.88)', '#10b981', 20);
      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 42px "Segoe UI", "Hiragino Sans", sans-serif';
      ctx.fillText(`軌道: ${this.pathLabel(this.path)}`, w / 2, h * 0.36);
      ctx.fillStyle = '#a7f3d0';
      ctx.font = 'bold 30px "Segoe UI", "Hiragino Sans", sans-serif';
      ctx.fillText('頭は動かさず、目だけでゆっくり追ってください', w / 2, h * 0.7);
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
    return {
      title: this.name,
      instruction: '緑色のターゲットをゆっくり視線で追い、眼球まわりをやさしく動かしましょう',
      remainingSeconds: Math.max(0, Math.ceil(this.remaining)),
      metricLabel: `軌道: ${this.pathLabel(this.path)}`
    };
  }
}
