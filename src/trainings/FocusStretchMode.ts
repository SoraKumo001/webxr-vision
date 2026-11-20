import * as THREE from 'three';
import { AudioManager } from '../core/AudioManager';
import { Difficulty } from '../core/StorageManager';
import { InteractiveCallbacks } from '../core/InputManager';
import { SpatialButton, SpatialTextPanel } from '../ui/SpatialPanel';
import { ITrainingMode, TrainingHUDState, TrainingResult } from './ITrainingMode';

type StretchPattern = 'push-pull' | 'figure8' | 'spiral';

const SYMBOLS = ['▲', '●', '★', '◆'] as const;
type FixSymbol = (typeof SYMBOLS)[number];

export class FocusStretchMode implements ITrainingMode {
  public readonly id = 'focus-stretch' as const;
  public readonly name = '1. 遠近調節・ストレッチ';
  public readonly description = '0.35m〜12mの遠近往復と3D軌道追従で毛様体筋をほぐします';
  public readonly group = new THREE.Group();

  private readonly arena = new THREE.Group();
  private readonly targetGroup = new THREE.Group();
  private readonly outerWire: THREE.Mesh;
  private readonly breathRing: THREE.Mesh;
  private readonly symbolPlane: THREE.Mesh;
  private readonly symbolCanvas: HTMLCanvasElement;
  private readonly symbolCtx: CanvasRenderingContext2D;
  private readonly symbolTex: THREE.CanvasTexture;
  private readonly distancePanel: SpatialTextPanel;

  private readonly patternButtons: { id: StretchPattern; btn: SpatialButton }[] = [];
  private readonly symbolButtons: { sym: FixSymbol; btn: SpatialButton }[] = [];
  private readonly interactiveObjects: THREE.Object3D[] = [];

  private readonly audio: AudioManager;

  private difficulty: Difficulty = 'normal';
  private pattern: StretchPattern = 'push-pull';
  private autoCyclePattern = true;
  private currentSymbol: FixSymbol = '★';

  private score = 0;
  private attempts = 0;
  private hits = 0;
  private durationTotal = 60;
  private remaining = 60;
  private elapsedInMode = 0;
  private symbolTimer = 0;
  private lastMovingOut = false;
  private targetHovered = false;
  private hoverPointTimer = 0;
  private currentDistMeters = 2.0;

  constructor(audio: AudioManager) {
    this.audio = audio;
    this.group.add(this.arena);

    // Target 3D crystal
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
      opacity: 0.92
    });
    this.targetGroup.add(new THREE.Mesh(coreGeo, coreMat));

    // Symbol Canvas inside target
    this.symbolCanvas = document.createElement('canvas');
    this.symbolCanvas.width = 256;
    this.symbolCanvas.height = 256;
    const ctx = this.symbolCanvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unsupported');
    this.symbolCtx = ctx;

    this.symbolTex = new THREE.CanvasTexture(this.symbolCanvas);
    this.symbolTex.colorSpace = THREE.SRGBColorSpace;
    const symGeo = new THREE.PlaneGeometry(0.22, 0.22);
    const symMat = new THREE.MeshBasicMaterial({
      map: this.symbolTex,
      transparent: true,
      side: THREE.DoubleSide
    });
    this.symbolPlane = new THREE.Mesh(symGeo, symMat);
    this.symbolPlane.position.z = 0.145;
    this.targetGroup.add(this.symbolPlane);

    // Breathing halo ring
    const ringGeo = new THREE.RingGeometry(0.26, 0.29, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x34d399,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide
    });
    this.breathRing = new THREE.Mesh(ringGeo, ringMat);
    this.targetGroup.add(this.breathRing);

    // Distance label above crystal
    this.distancePanel = new SpatialTextPanel(0.7, 0.24, 512, 176);
    this.distancePanel.mesh.position.set(0, 0.36, 0);
    this.targetGroup.add(this.distancePanel.mesh);

    // Allow hovering/gazing on target itself to score steady tracking
    const targetCallbacks: InteractiveCallbacks = {
      gazeEnabled: false,
      onHover: () => {
        this.targetHovered = true;
        (this.outerWire.material as THREE.MeshBasicMaterial).color.setHex(0x6ee7b7);
      },
      onBlur: () => {
        this.targetHovered = false;
        (this.outerWire.material as THREE.MeshBasicMaterial).color.setHex(0x38bdf8);
      }
    };
    this.targetGroup.userData = targetCallbacks;
    this.arena.add(this.targetGroup);
    this.interactiveObjects.push(this.targetGroup);

    // Pattern selector buttons
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
      btn.mesh.position.set(def.x, -0.58, -1.55);
      this.arena.add(btn.mesh);
      this.patternButtons.push({ id: def.id, btn });
      this.interactiveObjects.push(btn.mesh);
    }

    // Symbol answer buttons for accommodation check
    SYMBOLS.forEach((sym, i) => {
      const btn = new SpatialButton({
        width: 0.24,
        height: 0.17,
        label: sym,
        fontSize: 50,
        borderColor: '#a855f7',
        accentColor: '#c084fc',
        gazeDwellSeconds: 0.65,
        onSelect: () => this.handleSymbolChoice(sym)
      });
      btn.mesh.position.set((i - 1.5) * 0.29, -0.37, -1.55);
      this.arena.add(btn.mesh);
      this.symbolButtons.push({ sym, btn });
      this.interactiveObjects.push(btn.mesh);
    });

    this.drawSymbol();
  }

  private drawSymbol(): void {
    const { symbolCtx: ctx, symbolCanvas: canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.beginPath();
    ctx.arc(128, 128, 112, 0, Math.PI * 2);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#38bdf8';
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 132px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.currentSymbol, 128, 134);

    this.symbolTex.needsUpdate = true;
  }

  private pickNextSymbol(): void {
    const others = SYMBOLS.filter((s) => s !== this.currentSymbol);
    this.currentSymbol = others[Math.floor(Math.random() * others.length)];
    this.symbolTimer = 0;
    this.drawSymbol();
  }

  private handleSymbolChoice(sym: FixSymbol): void {
    this.attempts += 1;
    if (sym === this.currentSymbol) {
      this.hits += 1;
      const distBonus = this.currentDistMeters > 5 ? 50 : 25;
      this.score += 100 + distBonus;
      this.audio.playSuccess();
      this.pickNextSymbol();
    } else {
      this.audio.playMiss();
    }
  }

  private refreshButtonStates(): void {
    for (const item of this.patternButtons) {
      item.btn.setActive(item.id === this.pattern);
    }
  }

  public start(difficulty: Difficulty, headPos: THREE.Vector3, headQuat: THREE.Quaternion): void {
    this.difficulty = difficulty;
    this.score = 0;
    this.attempts = 0;
    this.hits = 0;
    this.durationTotal = 60;
    this.remaining = this.durationTotal;
    this.elapsedInMode = 0;
    this.symbolTimer = 0;
    this.hoverPointTimer = 0;
    this.pattern = 'push-pull';
    this.autoCyclePattern = true;

    // Anchor arena horizontally to user's head position & yaw
    const euler = new THREE.Euler().setFromQuaternion(headQuat, 'YXZ');
    this.arena.position.copy(headPos);
    this.arena.rotation.set(0, euler.y, 0);

    this.pickNextSymbol();
    this.refreshButtonStates();
    this.group.visible = true;
  }

  public stop(): TrainingResult {
    this.group.visible = false;
    const accuracy = this.attempts > 0 ? (this.hits / this.attempts) * 100 : 100;
    const duration = Math.max(1, Math.round(this.durationTotal - this.remaining));
    return {
      modeId: this.id,
      score: Math.round(this.score),
      accuracy: Math.round(accuracy),
      durationSec: duration,
      summary: `遠近ピント正答 ${this.hits}/${this.attempts}回`
    };
  }

  public update(dt: number): boolean {
    this.remaining -= dt;
    this.elapsedInMode += dt;
    this.symbolTimer += dt;

    if (this.symbolTimer > 5.5) {
      this.pickNextSymbol();
    }

    if (this.autoCyclePattern) {
      const phaseIdx = Math.floor(this.elapsedInMode / 20) % 3;
      const autoPatterns: StretchPattern[] = ['push-pull', 'figure8', 'spiral'];
      if (this.pattern !== autoPatterns[phaseIdx]) {
        this.pattern = autoPatterns[phaseIdx];
        this.refreshButtonStates();
      }
    }

    const speed =
      this.difficulty === 'easy' ? 0.55 : this.difficulty === 'normal' ? 0.8 : 1.15;
    const t = this.elapsedInMode * speed;

    let x = 0;
    let y = 0.05;
    let z = -2.0;

    if (this.pattern === 'push-pull') {
      // Smooth oscillation between 0.38m and 12.0m
      const norm = (1 - Math.cos(t * 0.9)) * 0.5;
      const dist = 0.38 + norm * 11.62;
      z = -dist;
      y = 0.05 + Math.sin(t * 0.45) * 0.08;
    } else if (this.pattern === 'figure8') {
      x = Math.sin(t) * 1.45;
      y = 0.08 + Math.sin(t * 2) * 0.52;
      z = -(2.6 + Math.cos(t * 0.7) * 1.8);
    } else {
      const r = 0.45 + 0.35 * Math.sin(t * 0.6);
      x = Math.cos(t * 1.4) * r;
      y = 0.08 + Math.sin(t * 1.4) * r;
      const norm = (1 - Math.cos(t * 0.75)) * 0.5;
      z = -(0.6 + norm * 9.4);
    }

    const prevZ = this.targetGroup.position.z;
    this.targetGroup.position.set(x, y, z);
    this.currentDistMeters = Math.sqrt(x * x + y * y + z * z);

    // Keep apparent visual size reasonable at far distances while still exercising depth
    const scale = Math.max(0.75, 0.65 + this.currentDistMeters * 0.14);
    this.targetGroup.scale.setScalar(scale);
    this.targetGroup.lookAt(this.arena.position);
    this.outerWire.rotation.y += dt * 0.8;
    this.outerWire.rotation.x += dt * 0.45;

    // Breathing cue when distance crosses direction
    const movingOut = z < prevZ;
    if (movingOut !== this.lastMovingOut && this.elapsedInMode > 0.5) {
      this.lastMovingOut = movingOut;
      this.audio.playBreathCue(!movingOut);
    }
    const breathScale = 0.92 + Math.sin(this.elapsedInMode * 2.2) * 0.14;
    this.breathRing.scale.setScalar(breathScale);

    // Continuous gaze tracking bonus
    if (this.targetHovered) {
      this.hoverPointTimer += dt;
      if (this.hoverPointTimer >= 0.4) {
        this.hoverPointTimer = 0;
        this.score += 10;
      }
    }

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
    const accuracy = this.attempts > 0 ? Math.round((this.hits / this.attempts) * 100) : 100;
    return {
      title: this.name,
      instruction: `ターゲットのマーク「${this.currentSymbol}」にピントを合わせて下の同じ記号を選択`,
      score: Math.round(this.score),
      accuracy,
      remainingSeconds: Math.max(0, Math.ceil(this.remaining)),
      metricLabel: `距離: ${this.currentDistMeters.toFixed(1)}m | 正答: ${this.hits}`
    };
  }
}
