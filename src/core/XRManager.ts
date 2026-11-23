import * as THREE from 'three';

export type DisplayMode = 'preview' | 'vr' | 'mr';

export interface XRSupportInfo {
  webxrAvailable: boolean;
  vrSupported: boolean;
  mrSupported: boolean;
}

export class XRManager {
  public readonly renderer: THREE.WebGLRenderer;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly userRig: THREE.Group;

  private displayMode: DisplayMode = 'preview';
  private activeSession: XRSession | null = null;
  private supportInfo: XRSupportInfo = {
    webxrAvailable: false,
    vrSupported: false,
    mrSupported: false
  };

  private yaw = 0;
  private pitch = 0;
  private isDragging = false;
  private dragMoved = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private readonly pressedKeys = new Set<string>();
  private readonly vrBgColor = new THREE.Color(0x06121c);
  private readonly tempVec = new THREE.Vector3();
  private readonly tempQuat = new THREE.Quaternion();
  private readonly tempEuler = new THREE.Euler();

  public onDisplayModeChange?: (mode: DisplayMode) => void;
  public onSessionEnded?: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local-floor');

    this.scene = new THREE.Scene();
    this.scene.background = this.vrBgColor;

    this.userRig = new THREE.Group();
    this.scene.add(this.userRig);

    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.05,
      150
    );
    this.camera.position.set(0, 1.5, 0);
    this.camera.layers.enable(0);
    this.camera.layers.enable(1);
    this.camera.layers.enable(2);
    this.userRig.add(this.camera);

    const ambient = new THREE.AmbientLight(0xd8f0f2, 0.8);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xb8e8e0, 1.05);
    dirLight.position.set(2, 5, 3);
    this.scene.add(dirLight);

    this.bindWindowAndDesktopEvents(canvas);
  }

  private bindWindowAndDesktopEvents(canvas: HTMLCanvasElement): void {
    window.addEventListener('resize', () => {
      if (!this.renderer.xr.isPresenting) {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
      }
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('pointerdown', (e) => {
      if (this.renderer.xr.isPresenting) return;
      this.isDragging = true;
      this.dragMoved = false;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    });

    window.addEventListener('pointermove', (e) => {
      if (!this.isDragging || this.renderer.xr.isPresenting) return;
      const dx = e.clientX - this.lastPointerX;
      const dy = e.clientY - this.lastPointerY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        this.dragMoved = true;
      }
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;

      const sens = this.isShiftHeld() ? 0.001 : 0.0028;
      this.yaw -= dx * sens;
      this.pitch -= dy * sens;
      const maxPitch = Math.PI * 0.42;
      this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));

      const euler = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
      this.camera.quaternion.setFromEuler(euler);
    });

    window.addEventListener('pointerup', () => {
      this.isDragging = false;
    });

    window.addEventListener('keydown', (e) => {
      if (this.renderer.xr.isPresenting) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      this.pressedKeys.add(e.code);
      if (e.key === 'r' || e.key === 'R') {
        this.resetViewpoint();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.pressedKeys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.pressedKeys.clear();
      this.isDragging = false;
    });

    canvas.addEventListener(
      'wheel',
      (e) => {
        if (this.renderer.xr.isPresenting) return;
        const step = -Math.sign(e.deltaY) * (this.isShiftHeld() ? 0.025 : 0.08);
        this.nudgeViewpoint(0, 0, step);
      },
      { passive: true }
    );
  }

  private isShiftHeld(): boolean {
    return this.pressedKeys.has('ShiftLeft') || this.pressedKeys.has('ShiftRight');
  }

  public wasPointerDragged(): boolean {
    return this.dragMoved;
  }

  public resetDesktopCamera(): void {
    this.yaw = 0;
    this.pitch = 0;
    this.camera.position.set(0, 1.5, 0);
    this.camera.quaternion.identity();
  }

  public resetViewpoint(): void {
    this.userRig.position.set(0, 0, 0);
    this.userRig.rotation.set(0, 0, 0);
    if (!this.renderer.xr.isPresenting) {
      this.resetDesktopCamera();
    }
  }

  public nudgeViewpoint(rightStep: number, upStep: number, forwardStep: number): void {
    this.getHeadPose(this.tempVec, this.tempQuat);
    this.tempEuler.setFromQuaternion(this.tempQuat, 'YXZ');
    const cosY = Math.cos(this.tempEuler.y);
    const sinY = Math.sin(this.tempEuler.y);

    // Forward in Three.js is (-sinY, 0, -cosY), Right is (cosY, 0, -sinY)
    this.userRig.position.x += cosY * rightStep - sinY * forwardStep;
    this.userRig.position.z += -sinY * rightStep - cosY * forwardStep;
    this.userRig.position.y = Math.max(-1.2, Math.min(3.5, this.userRig.position.y + upStep));
  }

  public updateViewpointControls(dt: number): void {
    if (this.renderer.xr.isPresenting) {
      const session = this.activeSession;
      if (!session) return;

      const xrMoveSpeed = 1.0;
      const xrVertSpeed = 0.6;
      const xrTurnSpeed = 0.9;

      for (const source of session.inputSources) {
        const gp = source.gamepad;
        if (!gp || gp.axes.length < 4) continue;
        const rawX = Math.abs(gp.axes[2]) > 0.12 ? gp.axes[2] : 0;
        const rawY = Math.abs(gp.axes[3]) > 0.12 ? gp.axes[3] : 0;
        if (rawX === 0 && rawY === 0) continue;

        // Quadratic curve for fine micro-adjustment at small stick tilts
        const axX = Math.sign(rawX) * rawX * rawX;
        const axY = Math.sign(rawY) * rawY * rawY;

        if (source.handedness === 'left') {
          this.nudgeViewpoint(axX * xrMoveSpeed * dt, 0, -axY * xrMoveSpeed * dt);
        } else if (source.handedness === 'right') {
          this.nudgeViewpoint(0, -axY * xrVertSpeed * dt, 0);
          this.userRig.rotation.y -= axX * xrTurnSpeed * dt;
        }
      }
      return;
    }

    if (this.pressedKeys.size === 0) return;
    const fineScale = this.isShiftHeld() ? 0.25 : 1.0;
    const moveSpeed = 0.85 * fineScale;
    const vertSpeed = 0.55 * fineScale;

    let right = 0;
    let forward = 0;
    let up = 0;

    if (this.pressedKeys.has('KeyW')) forward += 1;
    if (this.pressedKeys.has('KeyS')) forward -= 1;
    if (this.pressedKeys.has('KeyD')) right += 1;
    if (this.pressedKeys.has('KeyA')) right -= 1;
    if (this.pressedKeys.has('KeyE') || this.pressedKeys.has('Space')) up += 1;
    if (this.pressedKeys.has('KeyQ') || this.pressedKeys.has('KeyC')) up -= 1;

    if (right !== 0 || forward !== 0 || up !== 0) {
      this.nudgeViewpoint(right * moveSpeed * dt, up * vertSpeed * dt, forward * moveSpeed * dt);
    }
  }

  public async checkSupport(): Promise<XRSupportInfo> {
    const xr = navigator.xr;
    if (!xr) {
      this.supportInfo = {
        webxrAvailable: false,
        vrSupported: false,
        mrSupported: false
      };
      return this.supportInfo;
    }

    let vrSupported = false;
    let mrSupported = false;
    try {
      vrSupported = await xr.isSessionSupported('immersive-vr');
    } catch {
      vrSupported = false;
    }
    try {
      mrSupported = await xr.isSessionSupported('immersive-ar');
    } catch {
      mrSupported = false;
    }

    this.supportInfo = {
      webxrAvailable: true,
      vrSupported,
      mrSupported
    };
    return this.supportInfo;
  }

  public getSupportInfo(): XRSupportInfo {
    return this.supportInfo;
  }

  public getDisplayMode(): DisplayMode {
    return this.displayMode;
  }

  public isPresenting(): boolean {
    return this.renderer.xr.isPresenting;
  }

  public async enterMode(mode: 'vr' | 'mr'): Promise<void> {
    if (!navigator.xr) {
      throw new Error('このブラウザはWebXRに対応していません。');
    }

    if (this.activeSession) {
      await this.activeSession.end();
      this.activeSession = null;
    }

    const sessionMode: XRSessionMode = mode === 'mr' ? 'immersive-ar' : 'immersive-vr';
    const session = await navigator.xr.requestSession(sessionMode, {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers']
    });

    this.activeSession = session;
    session.addEventListener('end', () => {
      this.activeSession = null;
      this.setDisplayModeInternal('preview');
      this.onSessionEnded?.();
    });

    this.setDisplayModeInternal(mode);
    await this.renderer.xr.setSession(session);
  }

  public async exitXR(): Promise<void> {
    if (this.activeSession) {
      await this.activeSession.end();
      this.activeSession = null;
    }
    this.setDisplayModeInternal('preview');
  }

  private setDisplayModeInternal(mode: DisplayMode): void {
    this.displayMode = mode;
    if (mode === 'mr') {
      this.scene.background = null;
      this.renderer.setClearColor(0x000000, 0);
    } else {
      this.scene.background = this.vrBgColor;
      this.renderer.setClearColor(this.vrBgColor, 1);
    }
    this.onDisplayModeChange?.(mode);
  }

  public updateStereoLayers(): void {
    if (this.renderer.xr.isPresenting) {
      const xrCam = this.renderer.xr.getCamera() as THREE.ArrayCamera;
      if (xrCam && Array.isArray(xrCam.cameras) && xrCam.cameras.length >= 2) {
        const leftCam = xrCam.cameras[0];
        const rightCam = xrCam.cameras[1];

        leftCam.layers.enable(0);
        leftCam.layers.enable(1);
        leftCam.layers.disable(2);

        rightCam.layers.enable(0);
        rightCam.layers.disable(1);
        rightCam.layers.enable(2);
      }
    } else {
      this.camera.layers.enable(0);
      this.camera.layers.enable(1);
      this.camera.layers.enable(2);
    }
  }

  public getHeadPose(outPosition: THREE.Vector3, outQuaternion: THREE.Quaternion): void {
    if (this.renderer.xr.isPresenting) {
      const xrCam = this.renderer.xr.getCamera();
      xrCam.getWorldPosition(outPosition);
      xrCam.getWorldQuaternion(outQuaternion);
    } else {
      this.camera.getWorldPosition(outPosition);
      this.camera.getWorldQuaternion(outQuaternion);
    }
  }

  public getActiveCamera(): THREE.Camera {
    return this.renderer.xr.isPresenting ? this.renderer.xr.getCamera() : this.camera;
  }

  public render(): void {
    this.updateStereoLayers();
    this.renderer.render(this.scene, this.camera);
  }
}
