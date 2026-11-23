import * as THREE from 'three';
import { XRManager } from './XRManager';
import { GazeReticle } from '../ui/GazeReticle';

export type ActiveInputKind = 'Mouse' | 'Gaze' | 'Controller' | 'Hand Pinch';

export interface InteractiveCallbacks {
  onHover?: (obj: THREE.Object3D) => void;
  onBlur?: (obj: THREE.Object3D) => void;
  onSelect?: (obj: THREE.Object3D, hitPoint?: THREE.Vector3) => void;
  onGazeProgress?: (obj: THREE.Object3D, progress: number) => void;
  gazeEnabled?: boolean;
  gazeDwellSeconds?: number;
}

interface ControllerSlot {
  controller: THREE.XRTargetRaySpace;
  line: THREE.Line;
  hitDot: THREE.Mesh;
  connected: boolean;
  isHand: boolean;
  hovered: THREE.Object3D | null;
}

export class InputManager {
  private readonly xrManager: XRManager;
  private readonly reticle: GazeReticle;
  private readonly raycaster = new THREE.Raycaster();
  private readonly tempMatrix = new THREE.Matrix4();
  private readonly tempPos = new THREE.Vector3();
  private readonly tempQuat = new THREE.Quaternion();
  private readonly tempDir = new THREE.Vector3();
  private readonly gazeOffsetEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly gazeOffsetQuat = new THREE.Quaternion();
  private readonly combinedGazeQuat = new THREE.Quaternion();

  private gazeOffsetYaw = 0;
  private gazeOffsetPitch = 0;
  private static readonly GAZE_OFFSET_STORAGE_KEY = 'webxr_vision_gaze_offset_v1';

  private targets: THREE.Object3D[] = [];
  private controllers: ControllerSlot[] = [];

  private mouseNDC = new THREE.Vector2(99, 99);
  private mouseActive = false;
  private mouseMovedAt = 0;
  private mouseHovered: THREE.Object3D | null = null;

  private gazeEnabled = true;
  private gazeDwellDuration = 0.85;
  private gazeHovered: THREE.Object3D | null = null;
  private gazeTimer = 0;
  private gazeTriggeredForCurrentHover = false;

  private activeInputKind: ActiveInputKind = 'Mouse';
  public onInputKindChange?: (kind: ActiveInputKind) => void;
  public onTargetSelected?: (obj: THREE.Object3D, hitPoint?: THREE.Vector3) => void;
  public onTargetHovered?: (obj: THREE.Object3D) => void;

  constructor(xrManager: XRManager, reticle: GazeReticle) {
    this.xrManager = xrManager;
    this.reticle = reticle;

    this.setupXRControllers();
    this.setupDesktopPointer();
    this.loadGazeOffset();
  }

  private loadGazeOffset(): void {
    try {
      const raw = localStorage.getItem(InputManager.GAZE_OFFSET_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { yaw?: number; pitch?: number };
      if (typeof parsed.yaw === 'number') {
        this.gazeOffsetYaw = Math.max(-0.45, Math.min(0.45, parsed.yaw));
      }
      if (typeof parsed.pitch === 'number') {
        this.gazeOffsetPitch = Math.max(-0.45, Math.min(0.45, parsed.pitch));
      }
    } catch {
      // Ignore storage failures
    }
  }

  private saveGazeOffset(): void {
    try {
      localStorage.setItem(
        InputManager.GAZE_OFFSET_STORAGE_KEY,
        JSON.stringify({ yaw: this.gazeOffsetYaw, pitch: this.gazeOffsetPitch })
      );
    } catch {
      // Ignore storage failures
    }
  }

  public nudgeGazeOffset(deltaYawDeg: number, deltaPitchDeg: number): void {
    const maxRad = THREE.MathUtils.degToRad(25);
    this.gazeOffsetYaw = Math.max(
      -maxRad,
      Math.min(maxRad, this.gazeOffsetYaw + THREE.MathUtils.degToRad(deltaYawDeg))
    );
    this.gazeOffsetPitch = Math.max(
      -maxRad,
      Math.min(maxRad, this.gazeOffsetPitch + THREE.MathUtils.degToRad(deltaPitchDeg))
    );
    this.saveGazeOffset();
  }

  public resetGazeOffset(): void {
    this.gazeOffsetYaw = 0;
    this.gazeOffsetPitch = 0;
    this.saveGazeOffset();
  }

  private setupXRControllers(): void {
    const renderer = this.xrManager.renderer;

    for (let i = 0; i < 2; i++) {
      const controller = renderer.xr.getController(i);
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -5)
      ]);
      const lineMat = new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.75
      });
      const line = new THREE.Line(lineGeo, lineMat);
      line.visible = false;
      controller.add(line);

      const dotGeo = new THREE.SphereGeometry(0.012, 12, 12);
      const dotMat = new THREE.MeshBasicMaterial({ color: 0x7dd3fc });
      const hitDot = new THREE.Mesh(dotGeo, dotMat);
      hitDot.visible = false;
      this.xrManager.scene.add(hitDot);

      const slot: ControllerSlot = {
        controller,
        line,
        hitDot,
        connected: false,
        isHand: false,
        hovered: null
      };

      controller.addEventListener('connected', (event) => {
        const data = (event as unknown as { data?: XRInputSource }).data;
        slot.connected = true;
        slot.isHand = Boolean(data && data.hand);
        line.visible = true;
        this.setActiveInputKind(slot.isHand ? 'Hand Pinch' : 'Controller');
      });

      controller.addEventListener('disconnected', () => {
        slot.connected = false;
        slot.isHand = false;
        line.visible = false;
        hitDot.visible = false;
        if (slot.hovered) {
          this.dispatchBlur(slot.hovered);
          slot.hovered = null;
        }
      });

      controller.addEventListener('selectstart', () => {
        this.setActiveInputKind(slot.isHand ? 'Hand Pinch' : 'Controller');
        const hit = this.raycastFromController(controller);
        if (hit) {
          this.dispatchSelect(hit.target, hit.point);
        }
      });

      this.xrManager.userRig.add(controller);
      this.controllers.push(slot);

      // Initialize hand model space so WebXR hand tracking stays bound cleanly
      const hand = renderer.xr.getHand(i);
      this.xrManager.userRig.add(hand);
    }
  }

  private setupDesktopPointer(): void {
    const canvas = this.xrManager.renderer.domElement;

    canvas.addEventListener('pointermove', (e) => {
      if (this.xrManager.isPresenting()) return;
      const rect = canvas.getBoundingClientRect();
      this.mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.mouseActive = true;
      this.mouseMovedAt = performance.now();
    });

    canvas.addEventListener('pointerleave', () => {
      this.mouseActive = false;
      if (this.mouseHovered) {
        this.dispatchBlur(this.mouseHovered);
        this.mouseHovered = null;
      }
    });

    canvas.addEventListener('pointerup', (e) => {
      if (this.xrManager.isPresenting()) return;
      if (e.button !== 0 || this.xrManager.wasPointerDragged()) return;

      const rect = canvas.getBoundingClientRect();
      this.mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.mouseNDC, this.xrManager.camera);
      const hit = this.findFirstTargetHit();
      if (hit) {
        this.setActiveInputKind('Mouse');
        this.dispatchSelect(hit.target, hit.point);
      }
    });
  }

  public setTargets(targets: THREE.Object3D[]): void {
    this.targets = targets;

    if (this.mouseHovered && !targets.includes(this.mouseHovered)) {
      this.mouseHovered = null;
    }
    if (this.gazeHovered && !targets.includes(this.gazeHovered)) {
      this.gazeHovered = null;
      this.gazeTimer = 0;
      this.gazeTriggeredForCurrentHover = false;
    }
    for (const slot of this.controllers) {
      if (slot.hovered && !targets.includes(slot.hovered)) {
        slot.hovered = null;
      }
    }
  }

  public setGazeEnabled(enabled: boolean): void {
    this.gazeEnabled = enabled;
    this.reticle.group.visible = enabled;
    if (!enabled) {
      this.clearGazeHover();
    }
  }

  public isGazeEnabled(): boolean {
    return this.gazeEnabled;
  }

  public getActiveInputKind(): ActiveInputKind {
    return this.activeInputKind;
  }

  private setActiveInputKind(kind: ActiveInputKind): void {
    if (this.activeInputKind !== kind) {
      this.activeInputKind = kind;
      this.onInputKindChange?.(kind);
    }
  }

  private findRegisteredTarget(object: THREE.Object3D): THREE.Object3D | null {
    let curr: THREE.Object3D | null = object;
    while (curr) {
      if (this.targets.includes(curr)) {
        return curr;
      }
      curr = curr.parent;
    }
    return null;
  }

  private findFirstTargetHit(): { target: THREE.Object3D; point: THREE.Vector3; distance: number } | null {
    if (this.targets.length === 0) return null;
    const intersects = this.raycaster.intersectObjects(this.targets, true);
    for (const hit of intersects) {
      if (!this.isVisibleInHierarchy(hit.object)) continue;
      const target = this.findRegisteredTarget(hit.object);
      if (target) {
        return { target, point: hit.point, distance: hit.distance };
      }
    }
    return null;
  }

  private isVisibleInHierarchy(obj: THREE.Object3D): boolean {
    let curr: THREE.Object3D | null = obj;
    while (curr) {
      if (!curr.visible) return false;
      curr = curr.parent;
    }
    return true;
  }

  private raycastFromController(
    controller: THREE.XRTargetRaySpace
  ): { target: THREE.Object3D; point: THREE.Vector3; distance: number } | null {
    this.tempMatrix.identity().extractRotation(controller.matrixWorld);
    this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix);
    return this.findFirstTargetHit();
  }

  private dispatchHover(target: THREE.Object3D): void {
    const cb = target.userData as InteractiveCallbacks;
    cb.onHover?.(target);
    this.onTargetHovered?.(target);
  }

  private dispatchBlur(target: THREE.Object3D): void {
    const cb = target.userData as InteractiveCallbacks;
    cb.onBlur?.(target);
    cb.onGazeProgress?.(target, 0);
  }

  private dispatchSelect(target: THREE.Object3D, point?: THREE.Vector3): void {
    const cb = target.userData as InteractiveCallbacks;
    cb.onSelect?.(target, point);
    this.onTargetSelected?.(target, point);
  }

  public update(dt: number): void {
    const presenting = this.xrManager.isPresenting();
    let anyControllerHovering = false;

    // 1. Update XR Controllers / Hand rays
    for (const slot of this.controllers) {
      if (!slot.connected || !presenting) {
        slot.line.visible = false;
        slot.hitDot.visible = false;
        continue;
      }

      slot.line.visible = true;
      const hit = this.raycastFromController(slot.controller);
      if (hit) {
        anyControllerHovering = true;
        slot.hitDot.visible = true;
        slot.hitDot.position.copy(hit.point);

        // Adjust laser length to hit point
        const posAttr = slot.line.geometry.getAttribute('position') as THREE.BufferAttribute;
        posAttr.setXYZ(1, 0, 0, -hit.distance);
        posAttr.needsUpdate = true;

        if (slot.hovered !== hit.target) {
          if (slot.hovered) this.dispatchBlur(slot.hovered);
          slot.hovered = hit.target;
          this.dispatchHover(hit.target);
        }
      } else {
        slot.hitDot.visible = false;
        const posAttr = slot.line.geometry.getAttribute('position') as THREE.BufferAttribute;
        posAttr.setXYZ(1, 0, 0, -5);
        posAttr.needsUpdate = true;

        if (slot.hovered) {
          this.dispatchBlur(slot.hovered);
          slot.hovered = null;
        }
      }
    }

    // 2. Desktop mouse hover
    let mouseHoveringTarget = false;
    if (!presenting && this.mouseActive) {
      this.raycaster.setFromCamera(this.mouseNDC, this.xrManager.camera);
      const hit = this.findFirstTargetHit();
      if (hit) {
        mouseHoveringTarget = true;
        if (this.mouseHovered !== hit.target) {
          if (this.mouseHovered) this.dispatchBlur(this.mouseHovered);
          this.mouseHovered = hit.target;
          this.dispatchHover(hit.target);
          if (performance.now() - this.mouseMovedAt < 500) {
            this.setActiveInputKind('Mouse');
          }
        }
      } else if (this.mouseHovered) {
        this.dispatchBlur(this.mouseHovered);
        this.mouseHovered = null;
      }
    }

    // 3. Gaze reticle & dwell selection (with calibrated pointer offset)
    this.reticle.group.visible = this.gazeEnabled;
    if (!this.gazeEnabled) {
      this.clearGazeHover();
      return;
    }

    this.xrManager.getHeadPose(this.tempPos, this.tempQuat);
    this.gazeOffsetEuler.set(this.gazeOffsetPitch, this.gazeOffsetYaw, 0, 'YXZ');
    this.gazeOffsetQuat.setFromEuler(this.gazeOffsetEuler);
    this.combinedGazeQuat.copy(this.tempQuat).multiply(this.gazeOffsetQuat);

    this.tempDir.set(0, 0, -1).applyQuaternion(this.combinedGazeQuat).normalize();
    this.raycaster.set(this.tempPos, this.tempDir);

    const gazeHit = this.findFirstTargetHit();
    const reticleDist = gazeHit ? Math.min(gazeHit.distance - 0.02, 12) : 2.2;
    this.reticle.updateTransform(this.tempPos, this.tempDir, this.combinedGazeQuat, reticleDist);

    const allowGazeTrigger =
      this.gazeEnabled &&
      !anyControllerHovering &&
      (!mouseHoveringTarget || presenting);

    if (allowGazeTrigger && gazeHit) {
      const cb = gazeHit.target.userData as InteractiveCallbacks;
      const targetGazeAllowed = cb.gazeEnabled !== false;

      if (targetGazeAllowed) {
        if (this.gazeHovered !== gazeHit.target) {
          if (this.gazeHovered) this.dispatchBlur(this.gazeHovered);
          this.gazeHovered = gazeHit.target;
          this.gazeTimer = 0;
          this.gazeTriggeredForCurrentHover = false;
          this.dispatchHover(gazeHit.target);
        }

        if (!this.gazeTriggeredForCurrentHover) {
          const dwellReq = cb.gazeDwellSeconds ?? this.gazeDwellDuration;
          this.gazeTimer += dt;
          const progress = Math.min(1, this.gazeTimer / dwellReq);
          this.reticle.setProgress(progress);
          cb.onGazeProgress?.(gazeHit.target, progress);

          if (progress >= 1) {
            this.gazeTriggeredForCurrentHover = true;
            this.reticle.setProgress(0);
            cb.onGazeProgress?.(gazeHit.target, 0);
            this.setActiveInputKind('Gaze');
            this.dispatchSelect(gazeHit.target, gazeHit.point);
          }
        } else {
          this.reticle.setProgress(0);
        }
      } else {
        this.clearGazeHover();
      }
    } else {
      this.clearGazeHover();
    }
  }

  private clearGazeHover(): void {
    if (this.gazeHovered) {
      this.dispatchBlur(this.gazeHovered);
      this.gazeHovered = null;
    }
    this.gazeTimer = 0;
    this.gazeTriggeredForCurrentHover = false;
    this.reticle.setProgress(0);
  }
}
