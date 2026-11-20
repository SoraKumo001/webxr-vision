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
  private readonly vrBgColor = new THREE.Color(0x050814);

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

    const ambient = new THREE.AmbientLight(0xffffff, 0.85);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xe0f2fe, 1.1);
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

      this.yaw -= dx * 0.0035;
      this.pitch -= dy * 0.0035;
      const maxPitch = Math.PI * 0.42;
      this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));

      const euler = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
      this.camera.quaternion.setFromEuler(euler);
    });

    window.addEventListener('pointerup', () => {
      this.isDragging = false;
    });

    window.addEventListener('keydown', (e) => {
      if ((e.key === 'r' || e.key === 'R') && !this.renderer.xr.isPresenting) {
        this.resetDesktopCamera();
      }
    });
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
