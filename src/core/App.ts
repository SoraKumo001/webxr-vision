import * as THREE from 'three';
import { AudioManager } from './AudioManager';
import { ActiveInputKind, InputManager } from './InputManager';
import { Difficulty, StorageManager, TrainingModeId } from './StorageManager';
import { DisplayMode, XRManager } from './XRManager';
import { SpaceGridEnv } from '../environments/SpaceGridEnv';
import { AquaticRelaxMode } from '../trainings/AquaticRelaxMode';
import { BinocularMode } from '../trainings/BinocularMode';
import { FocusStretchMode } from '../trainings/FocusStretchMode';
import { GaborPatchMode } from '../trainings/GaborPatchMode';
import { ITrainingMode } from '../trainings/ITrainingMode';
import { PeripheralMode } from '../trainings/PeripheralMode';
import { DashboardHUD } from '../ui/DashboardHUD';
import { GazeReticle } from '../ui/GazeReticle';

export class App {
  private readonly xrManager: XRManager;
  private readonly storage = new StorageManager();
  private readonly audio = new AudioManager();
  private readonly reticle = new GazeReticle();
  private readonly input: InputManager;
  private readonly env = new SpaceGridEnv();
  private readonly dashboard: DashboardHUD;

  private readonly modes: Map<TrainingModeId, ITrainingMode>;
  private activeMode: ITrainingMode | null = null;
  private difficulty: Difficulty = 'normal';

  private readonly headPos = new THREE.Vector3(0, 1.5, 0);
  private readonly headQuat = new THREE.Quaternion();
  private prevTime = performance.now();
  private startTime = performance.now();
  private hudRefreshTimer = 0;

  // 2D Overlay Elements
  private readonly badgeXR = document.getElementById('badge-xr');
  private readonly badgeMode = document.getElementById('badge-mode');
  private readonly badgeInput = document.getElementById('badge-input');
  private readonly footerText = document.getElementById('footer-status-text');
  private readonly launchCard = document.getElementById('launch-card');
  private readonly btnEnterMR = document.getElementById('btn-enter-mr') as HTMLButtonElement | null;
  private readonly btnEnterVR = document.getElementById('btn-enter-vr') as HTMLButtonElement | null;
  private readonly btnPreview = document.getElementById('btn-desktop-preview') as HTMLButtonElement | null;
  private readonly btnToggleOverlay = document.getElementById('btn-toggle-overlay');
  private readonly btnRecenter = document.getElementById('btn-recenter');

  constructor(canvas: HTMLCanvasElement) {
    this.xrManager = new XRManager(canvas);
    this.input = new InputManager(this.xrManager, this.reticle);

    this.xrManager.scene.add(this.env.group);
    this.xrManager.scene.add(this.reticle.group);

    const focusMode = new FocusStretchMode(this.audio);
    const peripheralMode = new PeripheralMode(this.audio);
    const gaborMode = new GaborPatchMode(this.audio);
    const binocularMode = new BinocularMode(this.audio);
    const aquaticMode = new AquaticRelaxMode(this.audio, () => this.xrManager.getDisplayMode());

    this.modes = new Map<TrainingModeId, ITrainingMode>([
      [focusMode.id, focusMode],
      [peripheralMode.id, peripheralMode],
      [gaborMode.id, gaborMode],
      [binocularMode.id, binocularMode],
      [aquaticMode.id, aquaticMode]
    ]);

    for (const mode of this.modes.values()) {
      mode.group.visible = false;
      this.xrManager.scene.add(mode.group);
      mode.onUiHiddenChange = (hidden) => {
        this.dashboard.setMinimalHUD(hidden);
        const overlay = document.getElementById('overlay');
        if (overlay) {
          overlay.classList.toggle('ui-hidden', hidden);
        }
        this.syncInteractiveTargets();
      };
    }

    this.dashboard = new DashboardHUD(this.storage, {
      onSelectMode: (id) => this.startTraining(id),
      onStopTraining: () => this.stopTraining(),
      onHideTrainingUi: () => {
        if (!this.activeMode) return;
        this.activeMode.setUiHidden(true);
        this.audio.playSelect();
      },
      onToggleXRDisplay: () => void this.toggleXRDisplay(),
      onToggleGaze: () => {
        this.input.setGazeEnabled(!this.input.isGazeEnabled());
        this.audio.playSelect();
        this.syncDashboardStatus();
      },
      onChangeDifficulty: (diff) => {
        this.difficulty = diff;
        this.audio.playSelect();
        this.syncDashboardStatus();
      },
      onToggleMute: () => {
        this.audio.setMuted(!this.audio.isMuted());
        this.audio.playSelect();
        this.syncDashboardStatus();
      },
      onRecenter: () => {
        this.recenterAll();
        this.audio.playSelect();
      },
      onAdjustGazePointer: (deltaYawDeg, deltaPitchDeg) => {
        this.input.nudgeGazeOffset(deltaYawDeg, deltaPitchDeg);
        this.audio.playHover();
      },
      onResetGazePointer: () => {
        this.input.resetGazeOffset();
        this.audio.playSelect();
      }
    });

    this.xrManager.scene.add(this.dashboard.group);
    this.xrManager.getHeadPose(this.headPos, this.headQuat);
    this.dashboard.recenter(this.headPos, this.headQuat);

    this.bindCallbacks();
    this.bindOverlayControls();
    this.syncInteractiveTargets();
    this.syncDashboardStatus();
    void this.detectXRSupport();

    this.xrManager.renderer.setAnimationLoop(() => this.tick());
  }

  private bindCallbacks(): void {
    this.xrManager.onDisplayModeChange = (mode: DisplayMode) => {
      this.env.setVisible(mode !== 'mr' && this.activeMode?.id !== 'aquatic-relax');
      if (this.badgeMode) {
        this.badgeMode.textContent =
          mode === 'mr' ? '表示: MR (Passthrough)' : mode === 'vr' ? '表示: VR (Space)' : '表示: Preview';
      }
      this.syncDashboardStatus();

      if (mode !== 'preview') {
        this.launchCard?.classList.add('minimized');
        setTimeout(() => this.recenterAll(), 250);
      }
    };

    this.xrManager.onSessionEnded = () => {
      this.launchCard?.classList.remove('minimized');
      if (this.footerText) {
        this.footerText.textContent = 'XRセッションが終了しました';
      }
    };

    this.input.onInputKindChange = (kind: ActiveInputKind) => {
      if (this.badgeInput) {
        this.badgeInput.textContent = `入力: ${kind}`;
      }
    };

    this.input.onTargetHovered = () => {
      // Subtle feedback handled in SpatialButton/modes; keep audio gentle
    };

    this.input.onTargetSelected = (obj) => {
      this.audio.unlock();
      if (this.activeMode) {
        this.activeMode.onObjectSelected(obj);
        // Re-sync targets in case sub-mode inside training switched (e.g. BinocularMode)
        this.syncInteractiveTargets();
      }
    };
  }

  private bindOverlayControls(): void {
    this.btnEnterMR?.addEventListener('click', () => {
      this.audio.unlock();
      void this.launchXR('mr');
    });

    this.btnEnterVR?.addEventListener('click', () => {
      this.audio.unlock();
      void this.launchXR('vr');
    });

    this.btnPreview?.addEventListener('click', () => {
      this.audio.unlock();
      this.audio.playSelect();
      this.launchCard?.classList.add('minimized');
      if (this.footerText) {
        this.footerText.textContent =
          '3Dプレビュー中: 左クリック選択 / ドラッグ視点回転 / WASD移動 / Q・E上下 / ホイール前後 / Rリセット';
      }
    });

    this.btnToggleOverlay?.addEventListener('click', () => {
      this.launchCard?.classList.toggle('minimized');
    });

    this.btnRecenter?.addEventListener('click', () => {
      this.recenterAll();
    });

    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'ArrowUp') this.input.nudgeGazeOffset(0, 0.5);
      else if (e.code === 'ArrowDown') this.input.nudgeGazeOffset(0, -0.5);
      else if (e.code === 'ArrowLeft') this.input.nudgeGazeOffset(0.5, 0);
      else if (e.code === 'ArrowRight') this.input.nudgeGazeOffset(-0.5, 0);
      else if (e.code === 'Digit0') this.input.resetGazeOffset();
    });
  }

  private async detectXRSupport(): Promise<void> {
    const info = await this.xrManager.checkSupport();
    if (this.badgeXR) {
      if (!info.webxrAvailable) {
        this.badgeXR.textContent = 'WebXR: 非対応 (PCプレビュー可)';
        this.badgeXR.className = 'badge warn';
      } else if (info.mrSupported && info.vrSupported) {
        this.badgeXR.textContent = 'WebXR: MR & VR 対応';
        this.badgeXR.className = 'badge ok';
      } else if (info.vrSupported) {
        this.badgeXR.textContent = 'WebXR: VR 対応';
        this.badgeXR.className = 'badge ok';
      } else {
        this.badgeXR.textContent = 'WebXR: API有効 (HMD未接続)';
        this.badgeXR.className = 'badge warn';
      }
    }

    if (this.btnEnterMR && !info.mrSupported) {
      this.btnEnterMR.title = 'Quest 3等のimmersive-ar対応ブラウザで利用できます';
    }
    if (this.btnEnterVR && !info.vrSupported) {
      this.btnEnterVR.title = 'WebXR immersive-vr対応ブラウザで利用できます';
    }
  }

  private async launchXR(mode: 'vr' | 'mr'): Promise<void> {
    try {
      await this.xrManager.enterMode(mode);
      if (this.footerText) {
        this.footerText.textContent =
          mode === 'mr' ? 'MRパススルーモードで稼働中' : 'VR空間モードで稼働中';
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (this.footerText) {
        this.footerText.textContent = `XR起動不可: ${msg}（Desktop 3D Previewをご利用ください）`;
      }
    }
  }

  private async toggleXRDisplay(): Promise<void> {
    const current = this.xrManager.getDisplayMode();
    if (current === 'mr') {
      await this.launchXR('vr');
    } else if (current === 'vr') {
      await this.launchXR('mr');
    } else {
      const support = this.xrManager.getSupportInfo();
      if (support.mrSupported) {
        await this.launchXR('mr');
      } else if (support.vrSupported) {
        await this.launchXR('vr');
      } else if (this.footerText) {
        this.footerText.textContent =
          '現在PCブラウザです。Quest 3実機のブラウザで開くとMR/VR切替が有効になります。';
      }
    }
  }

  private recenterAll(): void {
    this.xrManager.getHeadPose(this.headPos, this.headQuat);
    this.dashboard.recenter(this.headPos, this.headQuat);
    this.activeMode?.recenter(this.headPos, this.headQuat);
  }

  private startTraining(modeId: TrainingModeId): void {
    const mode = this.modes.get(modeId);
    if (!mode) return;

    this.audio.unlock();
    this.audio.playSelect();

    if (this.activeMode) {
      this.activeMode.stop();
    }

    this.xrManager.getHeadPose(this.headPos, this.headQuat);
    this.dashboard.recenter(this.headPos, this.headQuat);
    this.dashboard.setTrainingActive(true);

    this.activeMode = mode;
    this.env.setVisible(this.xrManager.getDisplayMode() !== 'mr' && modeId !== 'aquatic-relax');
    this.activeMode.start(this.difficulty, this.headPos, this.headQuat);
    this.dashboard.updateTrainingHUD(this.activeMode.getHUDState());
    this.syncInteractiveTargets();

    if (this.footerText) {
      this.footerText.textContent = `トレーニング実行中: ${mode.name}`;
    }
  }

  private stopTraining(): void {
    if (!this.activeMode) return;
    const result = this.activeMode.stop();
    this.storage.recordSession(result.modeId, result.durationSec, this.difficulty);
    this.activeMode = null;
    this.env.setVisible(this.xrManager.getDisplayMode() !== 'mr');

    this.audio.playSuccess();
    this.dashboard.setTrainingActive(false, result);
    this.syncInteractiveTargets();

    if (this.footerText) {
      this.footerText.textContent = `完了: ${result.summary}`;
    }
  }

  private syncInteractiveTargets(): void {
    if (this.activeMode) {
      if (this.activeMode.isUiHidden()) {
        this.input.setTargets(this.activeMode.getInteractiveObjects());
      } else {
        this.input.setTargets([
          ...this.activeMode.getInteractiveObjects(),
          ...this.dashboard.getTrainingInteractiveObjects()
        ]);
      }
    } else {
      this.input.setTargets(this.dashboard.getMenuInteractiveObjects());
    }
  }

  private syncDashboardStatus(): void {
    this.dashboard.updateSystemStatus(
      this.xrManager.getDisplayMode(),
      this.input.isGazeEnabled(),
      this.audio.isMuted(),
      this.difficulty
    );
  }

  private tick(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.prevTime) / 1000);
    const elapsed = (now - this.startTime) / 1000;
    this.prevTime = now;

    this.xrManager.updateViewpointControls(dt);
    this.xrManager.getHeadPose(this.headPos, this.headQuat);
    this.env.update(dt);
    this.input.update(dt);

    if (this.activeMode) {
      const keepRunning = this.activeMode.update(dt, elapsed, this.headPos, this.headQuat);
      this.hudRefreshTimer += dt;
      if (this.hudRefreshTimer >= 0.15) {
        this.hudRefreshTimer = 0;
        this.dashboard.updateTrainingHUD(this.activeMode.getHUDState());
      }
      if (!keepRunning) {
        this.stopTraining();
      }
    }

    this.xrManager.render();
  }
}
