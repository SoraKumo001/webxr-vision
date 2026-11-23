import * as THREE from 'three';
import { AudioManager } from '../core/AudioManager';
import { Difficulty } from '../core/StorageManager';
import { InteractiveCallbacks } from '../core/InputManager';
import { GroupFade } from '../ui/GroupFade';
import { createSoftOrb } from '../ui/SoftOrb';
import { SpatialButton, SpatialTextPanel } from '../ui/SpatialPanel';
import { canvasFont, theme, themeHex } from '../ui/theme';
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
  private readonly softOrb: ReturnType<typeof createSoftOrb>;
  private readonly breathRing: THREE.Mesh;
  private readonly turnRipple: THREE.Mesh;
  private readonly turnRippleMat: THREE.MeshBasicMaterial;
  private turnRippleLife = 1;
  private isTargetHovered = false;
  private readonly nearColor = new THREE.Color(themeHex.amberSoft);
  private readonly farColor = new THREE.Color(themeHex.modeFocus);
  private readonly lerpColor = new THREE.Color();
  private readonly distancePanel: SpatialTextPanel;
  private readonly groupFade: GroupFade;

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
    this.groupFade = new GroupFade(this.group);

    this.softOrb = createSoftOrb(themeHex.modeFocus, 0.16);
    this.targetGroup.add(this.softOrb.group);

    const ringGeo = new THREE.RingGeometry(0.24, 0.275, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color: themeHex.success,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.breathRing = new THREE.Mesh(ringGeo, ringMat);
    this.targetGroup.add(this.breathRing);

    this.turnRippleMat = new THREE.MeshBasicMaterial({
      color: themeHex.seafoam,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.turnRippleMat.userData.skipGroupFade = true;
    this.turnRipple = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.255, 48), this.turnRippleMat);
    this.turnRipple.visible = false;
    this.turnRipple.userData.skipGroupFade = true;
    this.targetGroup.add(this.turnRipple);

    this.distancePanel = new SpatialTextPanel(0.7, 0.24, 512, 176);
    this.distancePanel.mesh.position.set(0, 0.33, 0);
    this.targetGroup.add(this.distancePanel.mesh);

    const targetCallbacks: InteractiveCallbacks = {
      gazeEnabled: false,
      onHover: () => {
        this.isTargetHovered = true;
        this.softOrb.setColor(themeHex.success);
      },
      onBlur: () => {
        this.isTargetHovered = false;
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
        borderColor: theme.modeFocus,
        accentColor: theme.modeFocus,
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
    this.groupFade.setImmediate(false);
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
      summary: `遠近ピントストレッチ ${duration}秒`
    };
  }

  public update(dt: number): boolean {
    this.groupFade.update(dt);
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
      const distRatio = Math.min(1, -z / 2.8);
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
    this.softOrb.update(dt);
    this.softOrb.glow.rotation.y += dt * 0.4;

    if (!this.isTargetHovered) {
      const distT = THREE.MathUtils.clamp((this.currentDistMeters - 0.4) / 11.0, 0, 1);
      this.lerpColor.lerpColors(this.nearColor, this.farColor, distT);
      this.softOrb.setColor(this.lerpColor.getHex());
    }

    const movingOut = z < prevZ;
    if (movingOut !== this.lastMovingOut && this.elapsedInMode > 0.5) {
      this.lastMovingOut = movingOut;
      this.audio.playBreathCue(!movingOut);
      this.turnRippleLife = 0;
      this.turnRipple.visible = true;
      this.turnRippleMat.color.setHex(movingOut ? themeHex.success : themeHex.modeFocus);
    }

    if (this.turnRippleLife < 1) {
      this.turnRippleLife = Math.min(1, this.turnRippleLife + dt * 1.15);
      const ease = 1 - Math.pow(1 - this.turnRippleLife, 2);
      this.turnRipple.scale.setScalar(1 + ease * 1.6);
      this.turnRippleMat.opacity = (1 - this.turnRippleLife) * 0.55;
      if (this.turnRippleLife >= 1) {
        this.turnRipple.visible = false;
      }
    }

    const breathScale = 0.92 + Math.sin(this.elapsedInMode * 2.0) * 0.14;
    this.breathRing.scale.setScalar(breathScale);

    this.distancePanel.draw((ctx, w, h) => {
      this.distancePanel.drawRoundedBg(theme.inkPanel, theme.modeFocus, 22);
      ctx.fillStyle = theme.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 54px ${canvasFont}`;
      ctx.fillText(`${this.currentDistMeters.toFixed(1)} m`, w / 2, h * 0.42);
      ctx.fillStyle = movingOut ? theme.success : theme.modeFocus;
      ctx.font = `600 34px ${canvasFont}`;
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
