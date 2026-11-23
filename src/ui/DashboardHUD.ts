import * as THREE from 'three';
import { Difficulty, StorageManager, TrainingModeId } from '../core/StorageManager';
import { DisplayMode } from '../core/XRManager';
import { TrainingHUDState, TrainingResult } from '../trainings/ITrainingMode';
import { GroupFade } from './GroupFade';
import { SpatialButton, SpatialTextPanel, wrapCanvasText } from './SpatialPanel';
import { canvasFont, theme } from './theme';

export interface DashboardCallbacks {
  onSelectMode: (modeId: TrainingModeId) => void;
  onStartAutoMode: () => void;
  onStopTraining: () => void;
  onHideTrainingUi: () => void;
  onToggleXRDisplay: () => void;
  onToggleGaze: () => void;
  onChangeDifficulty: (diff: Difficulty) => void;
  onToggleMute: () => void;
  onRecenter: () => void;
  onAdjustGazePointer: (deltaYawDeg: number, deltaPitchDeg: number) => void;
  onResetGazePointer: () => void;
  onLayoutChange?: () => void;
}

const MODE_META: { id: TrainingModeId; title: string; color: string; bgColor?: string }[] = [
  { id: 'focus-stretch', title: '1. 遠近ピントストレッチ', color: theme.modeFocus },
  { id: 'peripheral', title: '2. 眼球運動ストレッチ', color: theme.modePeripheral },
  { id: 'gabor-patch', title: '3. 回旋・スムーズパーシュート', color: theme.modePursuit },
  { id: 'binocular', title: '4. 輻輳・開散ストレッチ', color: theme.modeBinocular },
  {
    id: 'aquatic-relax',
    title: '5. 水中リラクゼーション',
    color: theme.modeAquatic,
    bgColor: theme.modeAquaticBg
  }
];

export class DashboardHUD {
  public readonly group = new THREE.Group();
  private readonly menuGroup = new THREE.Group();
  private readonly trainingHudGroup = new THREE.Group();
  private readonly settingsGroup = new THREE.Group();
  private readonly menuFade: GroupFade;
  private readonly trainingFade: GroupFade;

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
  private readonly btnSettings: SpatialButton;

  private readonly menuInteractives: THREE.Object3D[] = [];
  private readonly settingsInteractives: THREE.Object3D[] = [];
  private readonly trainingInteractives: THREE.Object3D[] = [];

  private lastResult: TrainingResult | null = null;
  private currentDifficulty: Difficulty = 'normal';
  private isTrainingActive = false;
  private settingsOpen = false;

  constructor(storage: StorageManager, callbacks: DashboardCallbacks) {
    this.storage = storage;
    this.callbacks = callbacks;

    this.group.add(this.menuGroup);
    this.group.add(this.trainingHudGroup);
    this.menuGroup.add(this.settingsGroup);
    this.settingsGroup.visible = false;
    this.trainingHudGroup.visible = false;

    this.menuFade = new GroupFade(this.menuGroup);
    this.trainingFade = new GroupFade(this.trainingHudGroup);
    this.trainingFade.setImmediate(false);

    // Menu layout (world meters). Centers leave ≥0.06 gap between button edges,
    // including hover scale (1.04), so transparent panels never stack.
    const MENU_Z = -1.85;
    const COL_L = -0.49;
    const COL_R = 0.49;
    const MODE_H = 0.26;
    const ROW2_H = 0.2;
    const Y_HEADER = 0.62;
    const Y_ROW0 = 0.22; // modes 1–2
    const Y_ROW1 = -0.1; // modes 3–4
    const Y_ROW2 = -0.4; // auto + aquatic
    const Y_SETTINGS = -0.62;
    const Y_SETTINGS_ROW1 = -0.78;
    const Y_SETTINGS_ROW2 = -0.94;

    this.headerPanel = new SpatialTextPanel(1.9, 0.4, 1280, 272);
    this.headerPanel.mesh.position.set(0, Y_HEADER, MENU_Z);
    this.menuGroup.add(this.headerPanel.mesh);

    MODE_META.forEach((meta, idx) => {
      const isAquatic = idx === 4;
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const x = isAquatic ? COL_R : col === 0 ? COL_L : COL_R;
      const y = isAquatic ? Y_ROW2 : row === 0 ? Y_ROW0 : Y_ROW1;
      const height = isAquatic ? ROW2_H : MODE_H;

      const btn = new SpatialButton({
        width: 0.92,
        height,
        label: meta.title,
        subLabel: '0回  |  累計 0分0秒',
        fontSize: isAquatic ? 30 : 34,
        bgColor: meta.bgColor ?? theme.inkPanelSolid,
        borderColor: meta.color,
        accentColor: meta.color,
        onSelect: () => this.callbacks.onSelectMode(meta.id)
      });
      btn.mesh.position.set(x, y, MENU_Z);
      this.menuGroup.add(btn.mesh);
      this.modeButtons.push({ id: meta.id, title: meta.title, btn });
      this.menuInteractives.push(btn.mesh);
    });

    const btnAutoMode = new SpatialButton({
      width: 0.92,
      height: ROW2_H,
      label: 'オートモード (1〜4連続)',
      subLabel: '遠近・眼球・回旋・輻輳を順番に',
      fontSize: 28,
      bgColor: theme.inkPanelSolid,
      borderColor: theme.autoAccent,
      accentColor: theme.autoAccent,
      onSelect: () => this.callbacks.onStartAutoMode()
    });
    btnAutoMode.mesh.position.set(COL_L, Y_ROW2, MENU_Z);
    this.menuGroup.add(btnAutoMode.mesh);
    this.menuInteractives.push(btnAutoMode.mesh);

    this.btnSettings = new SpatialButton({
      width: 0.92,
      height: 0.14,
      label: '設定を開く',
      fontSize: 28,
      borderColor: theme.borderSubtle,
      accentColor: theme.seafoam,
      onSelect: () => this.toggleSettings()
    });
    this.btnSettings.mesh.position.set(0, Y_SETTINGS, MENU_Z);
    this.menuGroup.add(this.btnSettings.mesh);
    this.menuInteractives.push(this.btnSettings.mesh);

    const diffs: { diff: Difficulty; label: string; x: number }[] = [
      { diff: 'easy', label: 'Easy', x: -0.62 },
      { diff: 'normal', label: 'Normal', x: -0.28 },
      { diff: 'hard', label: 'Hard', x: 0.06 }
    ];
    for (const d of diffs) {
      const btn = new SpatialButton({
        width: 0.3,
        height: 0.13,
        label: d.label,
        fontSize: 30,
        borderColor: theme.textMuted,
        accentColor: theme.seafoam,
        onSelect: () => {
          this.currentDifficulty = d.diff;
          this.callbacks.onChangeDifficulty(d.diff);
          this.refreshControls();
        }
      });
      btn.mesh.position.set(d.x, Y_SETTINGS_ROW1, MENU_Z);
      this.settingsGroup.add(btn.mesh);
      this.diffButtons.push({ diff: d.diff, btn });
      this.settingsInteractives.push(btn.mesh);
    }

    this.btnGaze = new SpatialButton({
      width: 0.4,
      height: 0.13,
      label: '視線: ON',
      fontSize: 28,
      borderColor: theme.seafoamSoft,
      accentColor: theme.seafoamSoft,
      onSelect: () => this.callbacks.onToggleGaze()
    });
    this.btnGaze.mesh.position.set(0.48, Y_SETTINGS_ROW1, MENU_Z);
    this.settingsGroup.add(this.btnGaze.mesh);
    this.settingsInteractives.push(this.btnGaze.mesh);

    this.btnMute = new SpatialButton({
      width: 0.3,
      height: 0.13,
      label: '音: ON',
      fontSize: 28,
      borderColor: theme.textMuted,
      accentColor: theme.seafoam,
      onSelect: () => this.callbacks.onToggleMute()
    });
    this.btnMute.mesh.position.set(0.8, Y_SETTINGS_ROW1, MENU_Z);
    this.settingsGroup.add(this.btnMute.mesh);
    this.settingsInteractives.push(this.btnMute.mesh);

    this.btnDisplayMode = new SpatialButton({
      width: 0.72,
      height: 0.13,
      label: '表示: Preview',
      fontSize: 24,
      borderColor: theme.seafoam,
      accentColor: theme.seafoam,
      onSelect: () => this.callbacks.onToggleXRDisplay()
    });
    this.btnDisplayMode.mesh.position.set(-0.41, Y_SETTINGS_ROW2, MENU_Z);
    this.settingsGroup.add(this.btnDisplayMode.mesh);
    this.settingsInteractives.push(this.btnDisplayMode.mesh);

    const btnRecenter = new SpatialButton({
      width: 0.36,
      height: 0.13,
      label: 'UIリセット',
      fontSize: 26,
      borderColor: theme.textMuted,
      accentColor: theme.seafoam,
      onSelect: () => this.callbacks.onRecenter()
    });
    btnRecenter.mesh.position.set(0.2, Y_SETTINGS_ROW2, MENU_Z);
    this.settingsGroup.add(btnRecenter.mesh);
    this.settingsInteractives.push(btnRecenter.mesh);

    const pointerDefs: { label: string; x: number; yaw: number; pitch: number; reset?: boolean }[] = [
      { label: '◀', x: 0.48, yaw: 1.2, pitch: 0 },
      { label: '▼', x: 0.62, yaw: 0, pitch: -1 },
      { label: '▲', x: 0.76, yaw: 0, pitch: 1 },
      { label: '中央', x: 0.96, yaw: 0, pitch: 0, reset: true }
    ];
    for (const p of pointerDefs) {
      const btn = new SpatialButton({
        width: p.reset ? 0.28 : 0.12,
        height: 0.13,
        label: p.label,
        fontSize: p.reset ? 22 : 28,
        borderColor: theme.textMuted,
        accentColor: theme.seafoam,
        gazeDwellSeconds: p.reset ? 0.65 : 0.4,
        onSelect: () => {
          if (p.reset) this.callbacks.onResetGazePointer();
          else this.callbacks.onAdjustGazePointer(p.yaw, p.pitch);
        }
      });
      btn.mesh.position.set(p.x, Y_SETTINGS_ROW2, MENU_Z);
      this.settingsGroup.add(btn.mesh);
      this.settingsInteractives.push(btn.mesh);
    }

    this.statusBanner = new SpatialTextPanel(1.9, 0.3, 1408, 220);
    this.statusBanner.mesh.position.set(0, 0.9, -2.05);
    this.trainingHudGroup.add(this.statusBanner.mesh);

    const chromeZ = -1.7;
    const actionY = -0.76;
    const pointerY = -0.92;
    const gap = 0.04;
    const stopW = 0.5;
    const hideW = 0.4;
    const actionTotal = stopW + gap + hideW;

    this.btnStopTraining = new SpatialButton({
      width: stopW,
      height: 0.13,
      label: 'メニューへ戻る',
      fontSize: 30,
      bgColor: theme.inkActive,
      borderColor: theme.danger,
      accentColor: theme.dangerSoft,
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
      borderColor: theme.textMuted,
      accentColor: theme.seafoam,
      gazeDwellSeconds: 0.75,
      onSelect: () => this.callbacks.onHideTrainingUi()
    });
    this.btnHideUi.mesh.position.set(actionTotal / 2 - hideW / 2, actionY, chromeZ);
    this.trainingHudGroup.add(this.btnHideUi.mesh);
    this.trainingInteractives.push(this.btnHideUi.mesh);

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
        borderColor: theme.textMuted,
        accentColor: theme.seafoam,
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

  private toggleSettings(): void {
    this.settingsOpen = !this.settingsOpen;
    this.settingsGroup.visible = this.settingsOpen;
    this.btnSettings.setLabel(this.settingsOpen ? '設定を閉じる' : '設定を開く');
    this.callbacks.onLayoutChange?.();
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
    if (active) {
      this.menuFade.hide();
      this.trainingFade.show();
      this.settingsOpen = false;
      this.settingsGroup.visible = false;
      this.btnSettings.setLabel('設定を開く');
    } else {
      this.trainingFade.hide();
      this.menuFade.show();
      this.refreshMenuStats();
    }
  }

  public setMinimalHUD(hidden: boolean): void {
    if (!this.isTrainingActive) return;
    if (hidden) this.trainingFade.hide();
    else this.trainingFade.show();
  }

  public isTraining(): boolean {
    return this.isTrainingActive;
  }

  public update(dt: number): void {
    this.menuFade.update(dt);
    this.trainingFade.update(dt);
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
        ? 'MRパススルー (切替)'
        : displayMode === 'vr'
          ? 'VRナイト (切替)'
          : 'Desktop 3D';
    this.btnDisplayMode.setLabel(modeLabel);
    this.btnGaze.setLabel(`視線: ${gazeEnabled ? 'ON' : 'OFF'}`);
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
      item.btn.setLabel(item.title, `${m.playCount}回  |  累計 ${mins}分${secs}秒`);
    }

    const totalMin = Math.floor(stats.totalSeconds / 60);
    const totalSec = stats.totalSeconds % 60;

    this.headerPanel.draw((ctx, w, h) => {
      this.headerPanel.drawRoundedBg(theme.inkPanel, theme.seafoam, 28);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      ctx.fillStyle = theme.seafoam;
      ctx.font = `700 52px ${canvasFont}`;
      ctx.fillText('WebXR Vision', w / 2, h * 0.28);

      ctx.fillStyle = theme.text;
      ctx.font = `500 30px ${canvasFont}`;
      ctx.fillText(
        `累計 ${totalMin}分${totalSec}秒  ·  モードを選んで開始`,
        w / 2,
        h * 0.56
      );

      if (this.lastResult) {
        ctx.fillStyle = theme.success;
        ctx.font = `600 32px ${canvasFont}`;
        ctx.fillText(`前回: ${this.lastResult.summary}`, w / 2, h * 0.82);
      } else {
        ctx.fillStyle = theme.textMuted;
        ctx.font = `500 26px ${canvasFont}`;
        ctx.fillText('コントローラー / ピンチ / 視線で操作できます', w / 2, h * 0.82);
      }
    });
  }

  public updateTrainingHUD(state: TrainingHUDState): void {
    this.statusBanner.draw((ctx, w, h) => {
      this.statusBanner.drawRoundedBg(theme.inkPanel, theme.seafoam, 24);
      ctx.textBaseline = 'middle';

      ctx.textAlign = 'left';
      ctx.fillStyle = theme.seafoam;
      ctx.font = `700 34px ${canvasFont}`;
      ctx.fillText(state.title, 40, h * 0.26);

      ctx.textAlign = 'right';
      ctx.fillStyle = state.remainingSeconds <= 10 ? theme.dangerSoft : theme.text;
      ctx.font = `700 38px ${canvasFont}`;
      ctx.fillText(`残り ${state.remainingSeconds}s`, w - 40, h * 0.26);

      ctx.textAlign = 'left';
      ctx.fillStyle = theme.text;
      ctx.font = `500 26px ${canvasFont}`;
      const lines = wrapCanvasText(ctx, state.instruction, w - 40 - 280, 2);
      lines.forEach((line, i) => {
        ctx.fillText(line, 40, h * (0.58 + i * 0.2));
      });

      ctx.textAlign = 'right';
      ctx.fillStyle = theme.success;
      ctx.font = `600 24px ${canvasFont}`;
      ctx.fillText(state.metricLabel, w - 40, h * 0.72);
    });
  }

  public getMenuInteractiveObjects(): THREE.Object3D[] {
    if (this.settingsOpen) {
      return [...this.menuInteractives, ...this.settingsInteractives];
    }
    return this.menuInteractives;
  }

  public getTrainingInteractiveObjects(): THREE.Object3D[] {
    return this.trainingInteractives;
  }
}
