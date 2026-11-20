import * as THREE from 'three';
import { AudioManager } from '../core/AudioManager';
import { Difficulty } from '../core/StorageManager';
import { InteractiveCallbacks } from '../core/InputManager';
import { SpatialButton, SpatialTextPanel } from '../ui/SpatialPanel';
import { ITrainingMode, TrainingHUDState, TrainingResult } from './ITrainingMode';

type BinocularSubMode = 'fusion' | 'stereopsis';

export class BinocularMode implements ITrainingMode {
  public readonly id = 'binocular' as const;
  public readonly name = '4. 両眼視・立体視';
  public readonly description = '左右眼レイヤー分離による融像トレーニングと微細奥行き判定を行います';
  public readonly group = new THREE.Group();

  private readonly arena = new THREE.Group();
  private readonly fusionGroup = new THREE.Group();
  private readonly stereoGroup = new THREE.Group();

  private readonly leftEyeGroup = new THREE.Group();
  private readonly rightEyeGroup = new THREE.Group();
  private readonly infoPanel: SpatialTextPanel;

  private readonly modeButtons: { sub: BinocularSubMode; btn: SpatialButton }[] = [];
  private readonly fusionControls: SpatialButton[] = [];
  private readonly stereoRings: { index: number; group: THREE.Group; ring: THREE.Mesh }[] = [];
  private readonly interactiveObjects: THREE.Object3D[] = [];
  private readonly audio: AudioManager;

  private subMode: BinocularSubMode = 'fusion';
  private difficulty: Difficulty = 'normal';
  private score = 0;
  private hits = 0;
  private attempts = 0;
  private streak = 0;
  private durationTotal = 75;
  private remaining = 75;

  // Fusion state (horizontal disparity offset in meters)
  private currentOffset = 0.16;
  private targetOffset = 0.0;

  // Stereopsis state
  private stereoPopIndex = 0;
  private stereoDeltaZ = 0.14;

  constructor(audio: AudioManager) {
    this.audio = audio;
    this.group.add(this.arena);

    this.infoPanel = new SpatialTextPanel(1.35, 0.24, 960, 176);
    this.infoPanel.mesh.position.set(0, 0.62, -2.2);
    this.arena.add(this.infoPanel.mesh);

    // Sub-mode switcher buttons
    const subDefs: { sub: BinocularSubMode; label: string; x: number }[] = [
      { sub: 'fusion', label: '1. 両眼融像 (Fusion)', x: -0.34 },
      { sub: 'stereopsis', label: '2. 立体視奥行き (Depth)', x: 0.34 }
    ];
    for (const def of subDefs) {
      const btn = new SpatialButton({
        width: 0.62,
        height: 0.15,
        label: def.label,
        fontSize: 30,
        onSelect: () => {
          this.subMode = def.sub;
          this.audio.playSelect();
          this.applySubModeVisibility();
        }
      });
      btn.mesh.position.set(def.x, -0.64, -1.75);
      this.arena.add(btn.mesh);
      this.modeButtons.push({ sub: def.sub, btn });
    }

    this.setupFusionArena();
    this.setupStereopsisArena();
  }

  private setupFusionArena(): void {
    this.arena.add(this.fusionGroup);

    // Shared reference frame (Layer 0: both eyes)
    const frameGeo = new THREE.RingGeometry(0.46, 0.485, 4);
    frameGeo.rotateZ(Math.PI / 4);
    const frameMat = new THREE.MeshBasicMaterial({
      color: 0xe2e8f0,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide
    });
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.set(0, 0.06, -2.2);
    frame.layers.set(0);
    this.fusionGroup.add(frame);

    // Left eye stimulus (Layer 1): Cyan Cross + Top Marker
    const leftMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
    const crossH = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.032), leftMat);
    const crossV = new THREE.Mesh(new THREE.PlaneGeometry(0.032, 0.24), leftMat);
    const topBar = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.025), leftMat);
    topBar.position.y = 0.22;
    this.setLayerRecursive(crossH, 1);
    this.setLayerRecursive(crossV, 1);
    this.setLayerRecursive(topBar, 1);
    this.leftEyeGroup.add(crossH, crossV, topBar);
    this.leftEyeGroup.position.set(0, 0.06, -2.2);
    this.fusionGroup.add(this.leftEyeGroup);

    // Right eye stimulus (Layer 2): Magenta Ring + Bottom Marker
    const rightMat = new THREE.MeshBasicMaterial({
      color: 0xe879f9,
      side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.11, 0.145, 48), rightMat);
    const bottomBar = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.025), rightMat);
    bottomBar.position.y = -0.22;
    this.setLayerRecursive(ring, 2);
    this.setLayerRecursive(bottomBar, 2);
    this.rightEyeGroup.add(ring, bottomBar);
    this.rightEyeGroup.position.set(0, 0.06, -2.2);
    this.fusionGroup.add(this.rightEyeGroup);

    // Fusion adjustment buttons
    const btnIn = new SpatialButton({
      width: 0.36,
      height: 0.16,
      label: '◀ 寄せる',
      fontSize: 34,
      borderColor: '#22d3ee',
      accentColor: '#22d3ee',
      gazeDwellSeconds: 0.45,
      onSelect: () => {
        this.currentOffset -= 0.04;
        this.audio.playHover();
        this.updateFusionPositions();
      }
    });
    btnIn.mesh.position.set(-0.44, -0.38, -1.75);

    const btnLock = new SpatialButton({
      width: 0.44,
      height: 0.18,
      label: '融像ロック！',
      subLabel: '重なったら決定',
      fontSize: 34,
      bgColor: '#064e3b',
      borderColor: '#34d399',
      accentColor: '#34d399',
      gazeDwellSeconds: 0.65,
      onSelect: () => this.checkFusionLock()
    });
    btnLock.mesh.position.set(0, -0.38, -1.75);

    const btnOut = new SpatialButton({
      width: 0.36,
      height: 0.16,
      label: '離す ▶',
      fontSize: 34,
      borderColor: '#e879f9',
      accentColor: '#e879f9',
      gazeDwellSeconds: 0.45,
      onSelect: () => {
        this.currentOffset += 0.04;
        this.audio.playHover();
        this.updateFusionPositions();
      }
    });
    btnOut.mesh.position.set(0.44, -0.38, -1.75);

    this.fusionGroup.add(btnIn.mesh, btnLock.mesh, btnOut.mesh);
    this.fusionControls.push(btnIn, btnLock, btnOut);
  }

  private setupStereopsisArena(): void {
    this.arena.add(this.stereoGroup);

    // Reference depth plane frame (Layer 0)
    const refMat = new THREE.LineBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.7 });
    const pts = [
      new THREE.Vector3(-1.05, -0.32, -2.35),
      new THREE.Vector3(1.05, -0.32, -2.35),
      new THREE.Vector3(1.05, 0.38, -2.35),
      new THREE.Vector3(-1.05, 0.38, -2.35),
      new THREE.Vector3(-1.05, -0.32, -2.35)
    ];
    const refFrame = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), refMat);
    this.stereoGroup.add(refFrame);

    for (let i = 0; i < 4; i++) {
      const container = new THREE.Group();
      const x = (i - 1.5) * 0.48;
      container.position.set(x, 0.03, -2.35);

      const ringGeo = new THREE.TorusGeometry(0.14, 0.024, 16, 48);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      container.add(ring);

      // Subtle inner stereo dots on Layer 1 & Layer 2 to reinforce binocular cue
      const dotL = new THREE.Mesh(
        new THREE.CircleGeometry(0.03, 16),
        new THREE.MeshBasicMaterial({ color: 0x22d3ee })
      );
      dotL.layers.set(1);
      dotL.position.z = 0.01;
      container.add(dotL);

      const dotR = new THREE.Mesh(
        new THREE.CircleGeometry(0.03, 16),
        new THREE.MeshBasicMaterial({ color: 0xe879f9 })
      );
      dotR.layers.set(2);
      dotR.position.z = 0.01;
      container.add(dotR);

      // Invisible hit plane so center of ring is easy to raycast
      const hitPlane = new THREE.Mesh(
        new THREE.CircleGeometry(0.18, 24),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.01, depthWrite: false })
      );
      container.add(hitPlane);

      const callbacks: InteractiveCallbacks = {
        gazeEnabled: true,
        gazeDwellSeconds: 0.72,
        onHover: () => {
          ringMat.color.setHex(0x6ee7b7);
          container.scale.setScalar(1.12);
        },
        onBlur: () => {
          ringMat.color.setHex(0x38bdf8);
          container.scale.setScalar(1.0);
        },
        onSelect: () => this.handleStereoRingPick(i)
      };
      container.userData = callbacks;

      this.stereoGroup.add(container);
      this.stereoRings.push({ index: i, group: container, ring });
    }
  }

  private setLayerRecursive(obj: THREE.Object3D, layer: number): void {
    obj.layers.set(layer);
    obj.traverse((child) => child.layers.set(layer));
  }

  private applySubModeVisibility(): void {
    this.fusionGroup.visible = this.subMode === 'fusion';
    this.stereoGroup.visible = this.subMode === 'stereopsis';

    for (const item of this.modeButtons) {
      item.btn.setActive(item.sub === this.subMode);
    }

    this.interactiveObjects.length = 0;
    for (const item of this.modeButtons) {
      this.interactiveObjects.push(item.btn.mesh);
    }
    if (this.subMode === 'fusion') {
      for (const b of this.fusionControls) {
        this.interactiveObjects.push(b.mesh);
      }
      this.spawnFusionTrial();
    } else {
      for (const r of this.stereoRings) {
        this.interactiveObjects.push(r.group);
      }
      this.spawnStereoTrial();
    }
  }

  private spawnFusionTrial(): void {
    const spread = this.difficulty === 'easy' ? 0.12 : this.difficulty === 'normal' ? 0.16 : 0.24;
    const dir = Math.random() > 0.5 ? 1 : -1;
    // Steps of 0.04m so exact lock at 0 is reachable
    const steps = Math.max(2, Math.round(spread / 0.04));
    this.currentOffset = dir * steps * 0.04;
    this.targetOffset = 0;
    this.updateFusionPositions();
  }

  private updateFusionPositions(): void {
    this.leftEyeGroup.position.x = -this.currentOffset;
    this.rightEyeGroup.position.x = this.currentOffset;
  }

  private checkFusionLock(): void {
    this.attempts += 1;
    const tolerance = this.difficulty === 'easy' ? 0.045 : 0.025;
    if (Math.abs(this.currentOffset - this.targetOffset) <= tolerance) {
      this.hits += 1;
      this.streak += 1;
      this.score += 150 + this.streak * 30;
      this.audio.playSuccess();
      this.spawnFusionTrial();
    } else {
      this.streak = 0;
      this.audio.playMiss();
    }
  }

  private spawnStereoTrial(): void {
    this.stereoPopIndex = Math.floor(Math.random() * 4);
    this.stereoRings.forEach((item, idx) => {
      const z = idx === this.stereoPopIndex ? -2.35 + this.stereoDeltaZ : -2.35;
      item.group.position.z = z;
    });
  }

  private handleStereoRingPick(idx: number): void {
    this.attempts += 1;
    if (idx === this.stereoPopIndex) {
      this.hits += 1;
      this.streak += 1;
      this.score += 120 + this.streak * 25;
      this.stereoDeltaZ = Math.max(0.015, this.stereoDeltaZ * 0.82);
      this.audio.playSuccess();
      this.spawnStereoTrial();
    } else {
      this.streak = 0;
      this.stereoDeltaZ = Math.min(0.18, this.stereoDeltaZ * 1.15);
      this.audio.playMiss();
    }
  }

  public start(difficulty: Difficulty, headPos: THREE.Vector3, headQuat: THREE.Quaternion): void {
    this.difficulty = difficulty;
    this.score = 0;
    this.hits = 0;
    this.attempts = 0;
    this.streak = 0;
    this.durationTotal = 75;
    this.remaining = this.durationTotal;
    this.stereoDeltaZ = difficulty === 'easy' ? 0.16 : difficulty === 'normal' ? 0.10 : 0.06;

    const euler = new THREE.Euler().setFromQuaternion(headQuat, 'YXZ');
    this.arena.position.copy(headPos);
    this.arena.rotation.set(0, euler.y, 0);

    this.subMode = 'fusion';
    this.group.visible = true;
    this.applySubModeVisibility();
  }

  public stop(): TrainingResult {
    this.group.visible = false;
    const accuracy = this.attempts > 0 ? (this.hits / this.attempts) * 100 : 100;
    const duration = Math.max(1, Math.round(this.durationTotal - this.remaining));
    const deltaCm = (this.stereoDeltaZ * 100).toFixed(1);
    return {
      modeId: this.id,
      score: Math.round(this.score),
      accuracy: Math.round(accuracy),
      durationSec: duration,
      summary: `成功 ${this.hits}/${this.attempts}回 | 立体視分解能 ${deltaCm}cm`
    };
  }

  public update(dt: number): boolean {
    this.remaining -= dt;

    this.infoPanel.draw((ctx, w, h) => {
      this.infoPanel.drawRoundedBg('rgba(15, 23, 42, 0.88)', '#a855f7', 22);
      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 40px "Segoe UI", "Hiragino Sans", sans-serif';
      if (this.subMode === 'fusion') {
        ctx.fillText('左眼の「＋」と右眼の「◯」が中央で重なるよう調整しロック', w / 2, h * 0.36);
        ctx.fillStyle = '#7dd3fc';
        ctx.font = 'bold 30px "Segoe UI", sans-serif';
        ctx.fillText(
          `現在の視差オフセット: ${(this.currentOffset * 100).toFixed(1)} cm  |  (VR時は左右別表示)`,
          w / 2,
          h * 0.72
        );
      } else {
        ctx.fillText('4つのリングのうち「一番手前に浮き出て見える1つ」を選択', w / 2, h * 0.36);
        ctx.fillStyle = '#6ee7b7';
        ctx.font = 'bold 30px "Segoe UI", sans-serif';
        ctx.fillText(
          `現在の奥行き差 Δz: ${(this.stereoDeltaZ * 100).toFixed(1)} cm  |  連続正解: ${this.streak}`,
          w / 2,
          h * 0.72
        );
      }
    });

    return this.remaining > 0;
  }

  public getInteractiveObjects(): THREE.Object3D[] {
    return this.interactiveObjects;
  }

  public onObjectSelected(_obj: THREE.Object3D): void {
    // Handled via callbacks
  }

  public getHUDState(): TrainingHUDState {
    const accuracy = this.attempts > 0 ? Math.round((this.hits / this.attempts) * 100) : 100;
    return {
      title: this.name,
      instruction:
        this.subMode === 'fusion'
          ? 'シアン(＋)とマゼンタ(◯)を重ねて「融像ロック！」を押してください'
          : '4つのリングから少し手前に浮いて見えるリングを選んでください',
      score: Math.round(this.score),
      accuracy,
      remainingSeconds: Math.max(0, Math.ceil(this.remaining)),
      metricLabel:
        this.subMode === 'fusion'
          ? `視差: ${(this.currentOffset * 100).toFixed(1)}cm`
          : `奥行き差: ${(this.stereoDeltaZ * 100).toFixed(1)}cm`
    };
  }
}
