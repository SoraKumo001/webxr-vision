import * as THREE from 'three';
import { Difficulty, StorageManager, TrainingModeId } from '../core/StorageManager';
import { DisplayMode } from '../core/XRManager';
import { TrainingHUDState, TrainingResult } from '../trainings/ITrainingMode';
import { SpatialButton, SpatialTextPanel } from './SpatialPanel';

export interface DashboardCallbacks {
  onSelectMode: (modeId: TrainingModeId) => void;
  onStopTraining: () => void;
  onHideTrainingUi: () => void;
  onToggleXRDisplay: () => void;
  onToggleGaze: () => void;
  onChangeDifficulty: (diff: Difficulty) => void;
  onToggleMute: () => void;
  onRecenter: () => void;
  onAdjustGazePointer: (deltaYawDeg: number, deltaPitchDeg: number) => void;
  onResetGazePointer: () => void;
}

const MODE_META: { id: TrainingModeId; title: string; color: string; bgColor?: string }[] = [
  { id: 'focus-stretch', title: '1. 遠近ピントストレッチ', color: '#0ea5e9' },
  { id: 'peripheral', title: '2. 眼球運動ストレッチ', color: '#10b981' },
  { id: 'gabor-patch', title: '3. 回旋・スムーズパーシュート', color: '#f59e0b' },
  { id: 'binocular', title: '4. 輻輳・開散ストレッチ', color: '#a855f7' },
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
  private readonly btnHideUi: SpatialButton;

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
        subLabel: '0回  |  累計 0分0秒',
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

    // Difficulty buttons (Row 1: symmetrically spans [-0.95, +0.95])
    const diffs: { diff: Difficulty; label: string; x: number }[] = [
      { diff: 'easy', label: 'Easy', x: -0.80 },
      { diff: 'normal', label: 'Normal', x: -0.46 },
      { diff: 'hard', label: 'Hard', x: -0.12 }
    ];
    for (const d of diffs) {
      const btn = new SpatialButton({
        width: 0.30,
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
      width: 0.48,
      height: 0.14,
      label: '視線操作: ON',
      fontSize: 30,
      borderColor: '#34d399',
      accentColor: '#34d399',
      onSelect: () => this.callbacks.onToggleGaze()
    });
    this.btnGaze.mesh.position.set(0.31, -0.57, -1.85);
    this.menuGroup.add(this.btnGaze.mesh);
    this.menuInteractives.push(this.btnGaze.mesh);

    this.btnMute = new SpatialButton({
      width: 0.36,
      height: 0.14,
      label: '音: ON',
      fontSize: 30,
      borderColor: '#94a3b8',
      accentColor: '#38bdf8',
      onSelect: () => this.callbacks.onToggleMute()
    });
    this.btnMute.mesh.position.set(0.77, -0.57, -1.85);
    this.menuGroup.add(this.btnMute.mesh);
    this.menuInteractives.push(this.btnMute.mesh);

    // Row 2: symmetrically spans [-0.95, +0.95] with 0.035m gaps
    this.btnDisplayMode = new SpatialButton({
      width: 0.56,
      height: 0.14,
      label: '表示: Preview (MR/VR切替)',
      fontSize: 24,
      borderColor: '#38bdf8',
      accentColor: '#38bdf8',
      onSelect: () => this.callbacks.onToggleXRDisplay()
    });
    this.btnDisplayMode.mesh.position.set(-0.67, -0.75, -1.85);
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
    btnRecenter.mesh.position.set(-0.165, -0.75, -1.85);
    this.menuGroup.add(btnRecenter.mesh);
    this.menuInteractives.push(btnRecenter.mesh);

    const btnMenuViewDown = new SpatialButton({
      width: 0.26,
      height: 0.14,
      label: 'ポインタ ▼',
      fontSize: 23,
      borderColor: '#64748b',
      accentColor: '#38bdf8',
      gazeDwellSeconds: 0.45,
      onSelect: () => this.callbacks.onAdjustGazePointer(0, -1.0)
    });
    btnMenuViewDown.mesh.position.set(0.19, -0.75, -1.85);
    this.menuGroup.add(btnMenuViewDown.mesh);
    this.menuInteractives.push(btnMenuViewDown.mesh);

    const btnMenuViewUp = new SpatialButton({
      width: 0.26,
      height: 0.14,
      label: 'ポインタ ▲',
      fontSize: 23,
      borderColor: '#64748b',
      accentColor: '#38bdf8',
      gazeDwellSeconds: 0.45,
      onSelect: () => this.callbacks.onAdjustGazePointer(0, 1.0)
    });
    btnMenuViewUp.mesh.position.set(0.485, -0.75, -1.85);
    this.menuGroup.add(btnMenuViewUp.mesh);
    this.menuInteractives.push(btnMenuViewUp.mesh);

    const btnMenuViewReset = new SpatialButton({
      width: 0.30,
      height: 0.14,
      label: 'ポインタ中央',
      fontSize: 22,
      borderColor: '#64748b',
      accentColor: '#38bdf8',
      onSelect: () => this.callbacks.onResetGazePointer()
    });
    btnMenuViewReset.mesh.position.set(0.80, -0.75, -1.85);
    this.menuGroup.add(btnMenuViewReset.mesh);
    this.menuInteractives.push(btnMenuViewReset.mesh);

    // Training HUD (shown during active training)
    this.statusBanner = new SpatialTextPanel(1.9, 0.26, 1408, 200);
    this.statusBanner.mesh.position.set(0, 0.90, -2.05);
    this.trainingHudGroup.add(this.statusBanner.mesh);

    // Bottom chrome: two clear rows — session actions, then pointer pad
    const chromeZ = -1.7;
    const actionY = -0.76;
    const pointerY = -0.92;
    const gap = 0.04;

    const stopW = 0.50;
    const hideW = 0.40;
    const actionTotal = stopW + gap + hideW;

    this.btnStopTraining = new SpatialButton({
      width: stopW,
      height: 0.13,
      label: 'メニューへ戻る',
      fontSize: 30,
      bgColor: '#3b0764',
      borderColor: '#f43f5e',
      accentColor: '#fb7185',
      gazeDwellSeconds: 1.0,
      onSelect: () => this.callbacks.onStopTraining()
    });
    this.btnStopTraining.mesh.position.set(-actionTotal / 2 + stopW / 2, actionY, chromeZ);
    this.trainingHudGroup.add(this.btnStopTraining.mesh);
    this.trainingInteractives.push(this.btnStopTraining.mesh);

    this.btnHideUi = new SpatialButton({
      width: hideW,
      height: 0.13,
      label: 'UIを隠す',
      fontSize: 30,
      borderColor: '#94a3b8',
      accentColor: '#38bdf8',
      gazeDwellSeconds: 0.75,
      onSelect: () => this.callbacks.onHideTrainingUi()
    });
    this.btnHideUi.mesh.position.set(actionTotal / 2 - hideW / 2, actionY, chromeZ);
    this.trainingHudGroup.add(this.btnHideUi.mesh);
    this.trainingInteractives.push(this.btnHideUi.mesh);

    // Pointer pad: one compact group [◀][▼][▲][▶][中央]
    const padW = 0.17;
    const padH = 0.12;
    const resetW = 0.34;
    const padItems: { label: string; width: number; dYaw: number; dPitch: number; reset?: boolean }[] =
      [
        { label: '◀', width: padW, dYaw: 1.2, dPitch: 0 },
        { label: '▼', width: padW, dYaw: 0, dPitch: -1.0 },
        { label: '▲', width: padW, dYaw: 0, dPitch: 1.0 },
        { label: '▶', width: padW, dYaw: -1.2, dPitch: 0 },
        { label: '中央', width: resetW, dYaw: 0, dPitch: 0, reset: true }
      ];
    const padTotal =
      padItems.reduce((sum, item) => sum + item.width, 0) + gap * (padItems.length - 1);
    let padX = -padTotal / 2;
    for (const item of padItems) {
      const x = padX + item.width / 2;
      const btn = new SpatialButton({
        width: item.width,
        height: padH,
        label: item.label,
        fontSize: item.reset ? 26 : 32,
        borderColor: '#475569',
        accentColor: '#38bdf8',
        gazeDwellSeconds: item.reset ? 0.65 : 0.4,
        onSelect: () => {
          if (item.reset) this.callbacks.onResetGazePointer();
          else this.callbacks.onAdjustGazePointer(item.dYaw, item.dPitch);
        }
      });
      btn.mesh.position.set(x, pointerY, chromeZ);
      this.trainingHudGroup.add(btn.mesh);
      this.trainingInteractives.push(btn.mesh);
      padX += item.width + gap;
    }

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
      const mins = Math.floor(m.totalSeconds / 60);
      const secs = m.totalSeconds % 60;
      item.btn.setLabel(
        item.title,
        `${m.playCount}回  |  累計 ${mins}分${secs}秒`
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
      ctx.fillText('WebXR 目のストレッチ - Quest 3', w / 2, h * 0.27);

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '32px "Segoe UI", "Hiragino Sans", sans-serif';
      ctx.fillText(
        `累計ストレッチ時間: ${totalMin}分${totalSec}秒  |  メニューを選択して開始`,
        w / 2,
        h * 0.56
      );

      if (this.lastResult) {
        ctx.fillStyle = '#6ee7b7';
        ctx.font = 'bold 34px "Segoe UI", "Hiragino Sans", sans-serif';
        ctx.fillText(
          `前回: ${this.lastResult.summary}`,
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
      ctx.font = 'bold 36px "Segoe UI", "Hiragino Sans", sans-serif';
      ctx.fillText(state.title, 40, h * 0.28);

      ctx.textAlign = 'right';
      ctx.fillStyle = state.remainingSeconds <= 10 ? '#fb7185' : '#f8fafc';
      ctx.font = 'bold 40px "Segoe UI", sans-serif';
      ctx.fillText(`残り ${state.remainingSeconds}s`, w - 40, h * 0.28);

      ctx.textAlign = 'left';
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '28px "Segoe UI", "Hiragino Sans", sans-serif';
      const instructionMaxW = w - 40 - 280;
      let instruction = state.instruction;
      while (instruction.length > 4 && ctx.measureText(instruction).width > instructionMaxW) {
        instruction = instruction.slice(0, -2);
      }
      if (instruction !== state.instruction) instruction = `${instruction}…`;
      ctx.fillText(instruction, 40, h * 0.68);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#6ee7b7';
      ctx.font = 'bold 26px "Segoe UI", "Hiragino Sans", sans-serif';
      ctx.fillText(state.metricLabel, w - 40, h * 0.68);
    });
  }

  public getMenuInteractiveObjects(): THREE.Object3D[] {
    return this.menuInteractives;
  }

  public getTrainingInteractiveObjects(): THREE.Object3D[] {
    return this.trainingInteractives;
  }
}
