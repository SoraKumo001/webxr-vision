import * as THREE from 'three';
import { AudioManager } from '../core/AudioManager';
import { Difficulty } from '../core/StorageManager';
import { GroupFade } from '../ui/GroupFade';
import { createMotionTrail, createSoftOrb } from '../ui/SoftOrb';
import { SpatialButton, SpatialTextPanel } from '../ui/SpatialPanel';
import { canvasFont, theme, themeHex } from '../ui/theme';
import { ITrainingMode, TrainingHUDState, TrainingResult } from './ITrainingMode';
import { ModeUiChrome } from './ModeUiChrome';

type OrbitDirection = 'cw' | 'ccw';

function durationForDifficulty(difficulty: Difficulty): number {
  return difficulty === 'easy' ? 90 : difficulty === 'normal' ? 75 : 60;
}

function periodForDifficulty(difficulty: Difficulty): number {
  return difficulty === 'easy' ? 10 : difficulty === 'normal' ? 7.5 : 5.5;
}

function radiusForDifficulty(difficulty: Difficulty): number {
  return difficulty === 'easy' ? 0.48 : difficulty === 'normal' ? 0.62 : 0.72;
}

/** Smooth-pursuit orbit training (mode id kept as gabor-patch for storage compatibility). */
export class GaborPatchMode implements ITrainingMode {
  public readonly id = 'gabor-patch' as const;
  public readonly name = '3. 回旋・スムーズパーシュート';
  public readonly description =
    '頭部正面の大きな円軌道を時計回り／反時計回りでゆっくり追い、滑らかな眼球運動を促します';
  public readonly group = new THREE.Group();

  private readonly arena = new THREE.Group();
  private readonly orbitPath: THREE.Line;
  private readonly targetGroup = new THREE.Group();
  private readonly softOrb: ReturnType<typeof createSoftOrb>;
  private readonly trail: ReturnType<typeof createMotionTrail>;
  private readonly infoPanel: SpatialTextPanel;
  private readonly dirButtons: { id: OrbitDirection; btn: SpatialButton }[] = [];
  private readonly interactiveObjects: THREE.Object3D[] = [];
  private readonly uiChrome: ModeUiChrome;
  private readonly groupFade: GroupFade;
  private readonly audio: AudioManager;
  public onUiHiddenChange?: (hidden: boolean) => void;

  private direction: OrbitDirection = 'cw';
  private autoFlip = true;
  private durationTotal = 75;
  private remaining = 75;
  private elapsedInMode = 0;
  private angle = 0;
  private lastFlipAt = 0;
  private orbitRadius = 0.95;
  private period = 7.5;

  constructor(audio: AudioManager) {
    this.audio = audio;
    this.group.add(this.arena);
    this.groupFade = new GroupFade(this.group);

    const pathPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      pathPts.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0));
    }
    this.orbitPath = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pathPts),
      new THREE.LineBasicMaterial({
        color: themeHex.modePursuit,
        transparent: true,
        opacity: 0.28
      })
    );
    this.orbitPath.position.set(0, -0.02, -2.3);
    this.arena.add(this.orbitPath);

    this.softOrb = createSoftOrb(themeHex.modePursuit, 0.11);
    this.targetGroup.add(this.softOrb.group);
    this.arena.add(this.targetGroup);

    this.trail = createMotionTrail(themeHex.amberSoft, 12);
    this.arena.add(this.trail.points);

    this.infoPanel = new SpatialTextPanel(1.35, 0.22, 960, 160);
    this.infoPanel.mesh.position.set(0, 0.62, -2.1);
    this.arena.add(this.infoPanel.mesh);

    const dirDefs: { id: OrbitDirection; label: string; x: number }[] = [
      { id: 'cw', label: '時計回り', x: -0.32 },
      { id: 'ccw', label: '反時計回り', x: 0.32 }
    ];
    for (const def of dirDefs) {
      const btn = new SpatialButton({
        width: 0.5,
        height: 0.13,
        label: def.label,
        fontSize: 32,
        borderColor: theme.modePursuit,
        accentColor: theme.modePursuit,
        onSelect: () => {
          this.direction = def.id;
          this.autoFlip = false;
          this.audio.playSelect();
          this.refreshButtonStates();
        }
      });
      btn.mesh.position.set(def.x, -0.54, -1.7);
      this.arena.add(btn.mesh);
      this.dirButtons.push({ id: def.id, btn });
    }

    this.uiChrome = new ModeUiChrome(this.arena, audio, {
      showButtonPosition: new THREE.Vector3(0, -0.85, -1.7)
    });
    this.uiChrome.setChrome([
      this.infoPanel.mesh,
      ...this.dirButtons.map((d) => d.btn.mesh)
    ]);
    this.uiChrome.onChange = (hidden) => {
      this.rebuildInteractives();
      this.onUiHiddenChange?.(hidden);
    };
    this.rebuildInteractives();
    this.groupFade.setImmediate(false);
  }

  private rebuildInteractives(): void {
    this.interactiveObjects.length = 0;
    if (!this.uiChrome.isHidden()) {
      for (const item of this.dirButtons) {
        this.interactiveObjects.push(item.btn.mesh);
      }
    }
    this.uiChrome.appendInteractives(this.interactiveObjects);
  }

  private refreshButtonStates(): void {
    for (const item of this.dirButtons) {
      item.btn.setActive(item.id === this.direction);
    }
  }

  public isUiHidden(): boolean {
    return this.uiChrome.isHidden();
  }

  public setUiHidden(hidden: boolean): void {
    this.uiChrome.setHidden(hidden);
  }

  public start(difficulty: Difficulty, headPos: THREE.Vector3, headQuat: THREE.Quaternion): void {
    this.durationTotal = durationForDifficulty(difficulty);
    this.remaining = this.durationTotal;
    this.elapsedInMode = 0;
    this.angle = 0;
    this.direction = 'cw';
    this.autoFlip = true;
    this.lastFlipAt = 0;
    this.orbitRadius = radiusForDifficulty(difficulty);
    this.period = periodForDifficulty(difficulty);

    this.orbitPath.scale.set(this.orbitRadius, this.orbitRadius * 0.72, 1);

    const euler = new THREE.Euler().setFromQuaternion(headQuat, 'YXZ');
    this.arena.position.copy(headPos);
    this.arena.rotation.set(0, euler.y, 0);

    this.uiChrome.setHidden(false);
    this.refreshButtonStates();
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
      summary: `回旋ストレッチ ${duration}秒`
    };
  }

  public update(dt: number): boolean {
    this.groupFade.update(dt);
    this.remaining -= dt;
    this.elapsedInMode += dt;

    if (this.autoFlip && this.elapsedInMode - this.lastFlipAt >= 30) {
      this.lastFlipAt = this.elapsedInMode;
      this.direction = this.direction === 'cw' ? 'ccw' : 'cw';
      this.refreshButtonStates();
      this.audio.playBreathCue(true);
    }

    const omega = (Math.PI * 2) / this.period;
    const signed = this.direction === 'cw' ? -1 : 1;
    this.angle += dt * omega * signed;

    const x = Math.cos(this.angle) * this.orbitRadius;
    const y = -0.02 + Math.sin(this.angle) * this.orbitRadius * 0.72;
    this.targetGroup.position.set(x, y, -2.3);
    this.targetGroup.lookAt(this.arena.position);
    this.trail.push(x, y, -2.3);

    const pulse = 0.95 + Math.sin(this.elapsedInMode * 2.2) * 0.1;
    this.softOrb.group.scale.setScalar(pulse);

    this.infoPanel.draw((ctx, w, h) => {
      this.infoPanel.drawRoundedBg(theme.inkPanel, theme.modePursuit, 20);
      ctx.fillStyle = theme.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const dirLabel = this.direction === 'cw' ? '時計回り' : '反時計回り';
      ctx.font = `700 42px ${canvasFont}`;
      ctx.fillText(`${dirLabel}  |  周期 ${this.period.toFixed(1)}秒`, w / 2, h * 0.36);
      ctx.fillStyle = theme.amberSoft;
      ctx.font = `600 30px ${canvasFont}`;
      ctx.fillText('頭を固定して、円をゆっくり追ってください', w / 2, h * 0.7);
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
    const dirLabel = this.direction === 'cw' ? '時計回り' : '反時計回り';
    return {
      title: this.name,
      instruction: '砂金色の光が描く円を、視線だけで滑らかに追い続けましょう',
      remainingSeconds: Math.max(0, Math.ceil(this.remaining)),
      metricLabel: `${dirLabel} | 半径 ${(this.orbitRadius * 100).toFixed(0)}cm`
    };
  }
}
