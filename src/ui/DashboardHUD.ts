import * as THREE from 'three';
import { Difficulty, StorageManager, TrainingModeId } from '../core/StorageManager';
import { DisplayMode } from '../core/XRManager';
import { TrainingHUDState, TrainingResult } from '../trainings/ITrainingMode';
import { SpatialButton, SpatialTextPanel } from './SpatialPanel';

export interface DashboardCallbacks {
  onSelectMode: (modeId: TrainingModeId) => void;
  onStopTraining: () => void;
  onToggleXRDisplay: () => void;
  onToggleGaze: () => void;
  onChangeDifficulty: (diff: Difficulty) => void;
  onToggleMute: () => void;
  onRecenter: () => void;
  onAdjustViewpoint: (right: number, up: number, forward: number) => void;
  onResetViewpoint: () => void;
}

const MODE_META: { id: TrainingModeId; title: string; color: string; bgColor?: string }[] = [
  { id: 'focus-stretch', title: '1. 遠近調節ストレッチ', color: '#0ea5e9' },
  { id: 'peripheral', title: '2. 動体視力・周辺視野', color: '#10b981' },
  { id: 'gabor-patch', title: '3. 3Dガボールパッチ', color: '#f59e0b' },
  { id: 'binocular', title: '4. 両眼視・立体視', color: '#a855f7' },
  {
    id: 'aquatic-relax',
    title: '5. 水中リラクゼーション (深海・水槽)',
    color: '#2dd4bf',
    bgColor: '#042f2e'
  }
];

export class DashboardHUD {
  public readonly group = new THREE.Group();
  private readonly menuGroup = new THREE.Group();
  private readonly trainingHudGroup = new THREE.Group();

  private readonly storage: StorageManager;
  private readonly callbacks: DashboardCallbacks;

  private readonly headerPanel: SpatialTextPanel;
  private readonly statusBanner: SpatialTextPanel;

  private readonly modeButtons: { id: TrainingModeId; title: string; btn: SpatialButton }[] = [];
  private readonly diffButtons: { diff: Difficulty; btn: SpatialButton }[] = [];
  private readonly btnDisplayMode: SpatialButton;
  private readonly btnGaze: SpatialButton;
  private readonly btnMute: SpatialButton;
  private readonly btnStopTraining: SpatialButton;

  private readonly menuInteractives: THREE.Object3D[] = [];
  private readonly trainingInteractives: THREE.Object3D[] = [];

  private lastResult: TrainingResult | null = null;
  private currentDifficulty: Difficulty = 'normal';
  private isTrainingActive = false;

  constructor(storage: StorageManager, callbacks: DashboardCallbacks) {
    this.storage = storage;
    this.callbacks = callbacks;

    this.group.add(this.menuGroup);
    this.group.add(this.trainingHudGroup);
    this.trainingHudGroup.visible = false;

    // Header Panel
    this.headerPanel = new SpatialTextPanel(1.9, 0.40, 1280, 272);
    this.headerPanel.mesh.position.set(0, 0.58, -1.85);
    this.menuGroup.add(this.headerPanel.mesh);

    // 2x2 Grid of Training Mode Cards + Featured Relaxation Banner
    MODE_META.forEach((meta, idx) => {
      const isFeatured = idx === 4;
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const x = isFeatured ? 0 : col === 0 ? -0.49 : 0.49;
      const y = isFeatured ? -0.36 : row === 0 ? 0.21 : -0.09;

      const btn = new SpatialButton({
        width: isFeatured ? 1.9 : 0.92,
        height: isFeatured ? 0.21 : 0.27,
        label: meta.title,
        subLabel: 'ハイスコア: 0 | プレイ: 0回',
        fontSize: isFeatured ? 34 : 36,
        bgColor: meta.bgColor,
        borderColor: meta.color,
        accentColor: meta.color,
        onSelect: () => this.callbacks.onSelectMode(meta.id)
      });
      btn.mesh.position.set(x, y, -1.85);
      this.menuGroup.add(btn.mesh);
      this.modeButtons.push({ id: meta.id, title: meta.title, btn });
      this.menuInteractives.push(btn.mesh);
    });

    // Difficulty buttons
    const diffs: { diff: Difficulty; label: string; x: number }[] = [
      { diff: 'easy', label: 'Easy', x: -0.66 },
      { diff: 'normal', label: 'Normal', x: -0.34 },
      { diff: 'hard', label: 'Hard', x: -0.02 }
    ];
    for (const d of diffs) {
      const btn = new SpatialButton({
        width: 0.29,
        height: 0.14,
        label: d.label,
        fontSize: 32,
        borderColor: '#64748b',
        accentColor: '#38bdf8',
        onSelect: () => {
          this.currentDifficulty = d.diff;
          this.callbacks.onChangeDifficulty(d.diff);
          this.refreshControls();
        }
      });
      btn.mesh.position.set(d.x, -0.57, -1.85);
      this.menuGroup.add(btn.mesh);
      this.diffButtons.push({ diff: d.diff, btn });
      this.menuInteractives.push(btn.mesh);
    }

    // Settings row buttons
    this.btnGaze = new SpatialButton({
      width: 0.42,
      height: 0.14,
      label: '視線操作: ON',
      fontSize: 30,
      borderColor: '#34d399',
      accentColor: '#34d399',
      onSelect: () => this.callbacks.onToggleGaze()
    });
    this.btnGaze.mesh.position.set(0.39, -0.57, -1.85);
    this.menuGroup.add(this.btnGaze.mesh);
    this.menuInteractives.push(this.btnGaze.mesh);

    this.btnMute = new SpatialButton({
      width: 0.28,
      height: 0.14,
      label: '音: ON',
      fontSize: 30,
      borderColor: '#94a3b8',
      accentColor: '#38bdf8',
      onSelect: () => this.callbacks.onToggleMute()
    });
    this.btnMute.mesh.position.set(0.78, -0.57, -1.85);
    this.menuGroup.add(this.btnMute.mesh);
    this.menuInteractives.push(this.btnMute.mesh);

    this.btnDisplayMode = new SpatialButton({
      width: 0.54,
      height: 0.14,
      label: '表示: Preview (MR/VR切替)',
      fontSize: 24,
      borderColor: '#38bdf8',
      accentColor: '#38bdf8',
      onSelect: () => this.callbacks.onToggleXRDisplay()
    });
    this.btnDisplayMode.mesh.position.set(-0.56, -0.75, -1.85);
    this.menuGroup.add(this.btnDisplayMode.mesh);
    this.menuInteractives.push(this.btnDisplayMode.mesh);

    const btnRecenter = new SpatialButton({
      width: 0.38,
      height: 0.14,
      label: 'UI位置リセット',
      fontSize: 26,
      borderColor: '#64748b',
      accentColor: '#38bdf8',
      onSelect: () => this.callbacks.onRecenter()
    });
    btnRecenter.mesh.position.set(-0.06, -0.75, -1.85);
    this.menuGroup.add(btnRecenter.mesh);
    this.menuInteractives.push(btnRecenter.mesh);

    const btnMenuViewDown = new SpatialButton({
      width: 0.22,
      height: 0.14,
      label: '視点 -高',
      fontSize: 25,
      borderColor: '#64748b',
      accentColor: '#38bdf8',
      gazeDwellSeconds: 0.45,
      onSelect: () => this.callbacks.onAdjustViewpoint(0, -0.05, 0)
    });
    btnMenuViewDown.mesh.position.set(0.27, -0.75, -1.85);
    this.menuGroup.add(btnMenuViewDown.mesh);
    this.menuInteractives.push(btnMenuViewDown.mesh);

    const btnMenuViewUp = new SpatialButton({
      width: 0.22,
      height: 0.14,
      label: '視点 +高',
      fontSize: 25,
      borderColor: '#64748b',
      accentColor: '#38bdf8',
      gazeDwellSeconds: 0.45,
      onSelect: () => this.callbacks.onAdjustViewpoint(0, 0.05, 0)
    });
    btnMenuViewUp.mesh.position.set(0.51, -0.75, -1.85);
    this.menuGroup.add(btnMenuViewUp.mesh);
    this.menuInteractives.push(btnMenuViewUp.mesh);

    const btnMenuViewReset = new SpatialButton({
      width: 0.26,
      height: 0.14,
      label: '視点リセット',
      fontSize: 24,
      borderColor: '#64748b',
      accentColor: '#38bdf8',
      onSelect: () => this.callbacks.onResetViewpoint()
    });
    btnMenuViewReset.mesh.position.set(0.77, -0.75, -1.85);
    this.menuGroup.add(btnMenuViewReset.mesh);
    this.menuInteractives.push(btnMenuViewReset.mesh);

    // Training HUD (shown during active training)
    this.statusBanner = new SpatialTextPanel(1.75, 0.26, 1280, 192);
    this.statusBanner.mesh.position.set(0, 0.92, -2.05);
    this.trainingHudGroup.add(this.statusBanner.mesh);

    this.btnStopTraining = new SpatialButton({
      width: 0.40,
      height: 0.14,
      label: 'メニューへ戻る',
      fontSize: 30,
      bgColor: '#3b0764',
      borderColor: '#f43f5e',
      accentColor: '#fb7185',
      gazeDwellSeconds: 1.0,
      onSelect: () => this.callbacks.onStopTraining()
    });
    this.btnStopTraining.mesh.position.set(0, -0.84, -1.7);
    this.trainingHudGroup.add(this.btnStopTraining.mesh);
    this.trainingInteractives.push(this.btnStopTraining.mesh);

    const trainingViewButtons: { label: string; x: number; dx: number; dy: number; dz: number }[] = [
      { label: '◀ 左', x: -0.84, dx: -0.10, dy: 0, dz: 0 },
      { label: '-高', x: -0.66, dx: 0, dy: -0.05, dz: 0 },
      { label: '+高', x: -0.48, dx: 0, dy: 0.05, dz: 0 },
      { label: '右 ▶', x: -0.30, dx: 0.10, dy: 0, dz: 0 },
      { label: '前へ', x: 0.30, dx: 0, dy: 0, dz: 0.10 },
      { label: '後へ', x: 0.48, dx: 0, dy: 0, dz: -0.10 }
    ];
    for (const tv of trainingViewButtons) {
      const btn = new SpatialButton({
        width: 0.165,
        height: 0.13,
        label: tv.label,
        fontSize: 25,
        borderColor: '#475569',
        accentColor: '#38bdf8',
        gazeDwellSeconds: 0.4,
        onSelect: () => this.callbacks.onAdjustViewpoint(tv.dx, tv.dy, tv.dz)
      });
      btn.mesh.position.set(tv.x, -0.84, -1.7);
      this.trainingHudGroup.add(btn.mesh);
      this.trainingInteractives.push(btn.mesh);
    }

    const btnTrainingReset = new SpatialButton({
      width: 0.22,
      height: 0.13,
      label: '視点戻す',
      fontSize: 23,
      borderColor: '#475569',
      accentColor: '#38bdf8',
      gazeDwellSeconds: 0.65,
      onSelect: () => this.callbacks.onResetViewpoint()
    });
    btnTrainingReset.mesh.position.set(0.69, -0.84, -1.7);
    this.trainingHudGroup.add(btnTrainingReset.mesh);
    this.trainingInteractives.push(btnTrainingReset.mesh);

    this.refreshMenuStats();
    this.refreshControls();
  }

  public recenter(headPos: THREE.Vector3, headQuat: THREE.Quaternion): void {
    const euler = new THREE.Euler().setFromQuaternion(headQuat, 'YXZ');
    this.group.position.copy(headPos);
    this.group.rotation.set(0, euler.y, 0);
  }

  public setTrainingActive(active: boolean, lastResult?: TrainingResult): void {
    this.isTrainingActive = active;
    if (lastResult) {
      this.lastResult = lastResult;
    }
    this.menuGroup.visible = !active;
    this.trainingHudGroup.visible = active;
    if (!active) {
      this.refreshMenuStats();
    }
  }

  public setMinimalHUD(hidden: boolean): void {
    if (!this.isTrainingActive) return;
    this.trainingHudGroup.visible = !hidden;
  }

  public isTraining(): boolean {
    return this.isTrainingActive;
  }

  public updateSystemStatus(
    displayMode: DisplayMode,
    gazeEnabled: boolean,
    muted: boolean,
    difficulty: Difficulty
  ): void {
    this.currentDifficulty = difficulty;
    const modeLabel =
      displayMode === 'mr'
        ? 'MRパススルー中 (VRへ切替)'
        : displayMode === 'vr'
          ? 'VR空間中 (MRへ切替)'
          : 'Desktop 3D (VR/MRはQuest実機で起動)';
    this.btnDisplayMode.setLabel(modeLabel);
    this.btnGaze.setLabel(`視線操作: ${gazeEnabled ? 'ON' : 'OFF'}`);
    this.btnGaze.setActive(gazeEnabled);
    this.btnMute.setLabel(`音: ${muted ? 'OFF' : 'ON'}`);
    this.btnMute.setActive(!muted);
    this.refreshControls();
  }

  private refreshControls(): void {
    for (const d of this.diffButtons) {
      d.btn.setActive(d.diff === this.currentDifficulty);
    }
  }

  public refreshMenuStats(): void {
    const stats = this.storage.getStats();

    for (const item of this.modeButtons) {
      const m = stats.modes[item.id];
      item.btn.setLabel(
        item.title,
        `ベスト: ${m.highScore}点 | 精度: ${m.bestAccuracy}% | ${m.playCount}回`
      );
    }

    const totalMin = Math.floor(stats.totalSeconds / 60);
    const totalSec = stats.totalSeconds % 60;

    this.headerPanel.draw((ctx, w, h) => {
      this.headerPanel.drawRoundedBg('rgba(15, 23, 42, 0.90)', '#38bdf8', 28);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 54px "Segoe UI", "Hiragino Sans", sans-serif';
      ctx.fillText('WebXR 視力トレーニング - Quest 3', w / 2, h * 0.27);

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '32px "Segoe UI", "Hiragino Sans", sans-serif';
      ctx.fillText(
        `累計トレーニング時間: ${totalMin}分${totalSec}秒  |  メニューを選択して開始`,
        w / 2,
        h * 0.56
      );

      if (this.lastResult) {
        ctx.fillStyle = '#6ee7b7';
        ctx.font = 'bold 34px "Segoe UI", "Hiragino Sans", sans-serif';
        ctx.fillText(
          `前回結果: ${this.lastResult.score}点 (${this.lastResult.accuracy}%) — ${this.lastResult.summary}`,
          w / 2,
          h * 0.82
        );
      } else {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '28px "Segoe UI", "Hiragino Sans", sans-serif';
        ctx.fillText(
          'コントローラー / ハンドピンチ / 視線（見つめるだけ）の全てで操作できます',
          w / 2,
          h * 0.82
        );
      }
    });
  }

  public updateTrainingHUD(state: TrainingHUDState): void {
    this.statusBanner.draw((ctx, w, h) => {
      this.statusBanner.drawRoundedBg('rgba(15, 23, 42, 0.88)', '#38bdf8', 24);
      ctx.textBaseline = 'middle';

      ctx.textAlign = 'left';
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 38px "Segoe UI", "Hiragino Sans", sans-serif';
      ctx.fillText(state.title, 36, h * 0.30);

      ctx.textAlign = 'right';
      ctx.fillStyle = state.remainingSeconds <= 10 ? '#fb7185' : '#f8fafc';
      ctx.font = 'bold 42px "Segoe UI", sans-serif';
      ctx.fillText(
        `残り ${state.remainingSeconds}s  |  スコア ${state.score}  |  精度 ${state.accuracy}%`,
        w - 36,
        h * 0.30
      );

      ctx.textAlign = 'left';
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '30px "Segoe UI", "Hiragino Sans", sans-serif';
      ctx.fillText(state.instruction, 36, h * 0.72);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#6ee7b7';
      ctx.font = 'bold 28px "Segoe UI", "Hiragino Sans", sans-serif';
      ctx.fillText(state.metricLabel, w - 36, h * 0.72);
    });
  }

  public getMenuInteractiveObjects(): THREE.Object3D[] {
    return this.menuInteractives;
  }

  public getTrainingInteractiveObjects(): THREE.Object3D[] {
    return this.trainingInteractives;
  }
}
