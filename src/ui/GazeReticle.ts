import * as THREE from 'three';
import { themeHex } from './theme';

const RING_SEGMENTS = 64;

export class GazeReticle {
  public readonly group: THREE.Group;
  private readonly dotMesh: THREE.Mesh;
  private readonly progressRing: THREE.Mesh;
  private progress = 0;
  private pulseT = 0;

  constructor() {
    this.group = new THREE.Group();
    this.group.renderOrder = 999;

    const dotGeo = new THREE.RingGeometry(0.0035, 0.0075, 28);
    const dotMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.7,
      depthTest: false,
      depthWrite: false
    });
    this.dotMesh = new THREE.Mesh(dotGeo, dotMat);
    this.dotMesh.renderOrder = 999;
    this.group.add(this.dotMesh);

    const ringGeo = new THREE.RingGeometry(
      0.013,
      0.021,
      RING_SEGMENTS,
      1,
      Math.PI / 2,
      Math.PI * 2
    );
    const ringMat = new THREE.MeshBasicMaterial({
      color: themeHex.reticle,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false
    });
    this.progressRing = new THREE.Mesh(ringGeo, ringMat);
    this.progressRing.renderOrder = 999;
    this.progressRing.visible = false;
    this.progressRing.geometry.setDrawRange(0, 0);
    this.group.add(this.progressRing);
  }

  public setProgress(progress: number): void {
    const clamped = Math.max(0, Math.min(1, progress));
    if (Math.abs(clamped - this.progress) < 0.008 && clamped !== 0) {
      return;
    }
    this.progress = clamped;

    if (clamped <= 0.01) {
      this.progressRing.visible = false;
      this.progressRing.geometry.setDrawRange(0, 0);
      return;
    }

    this.progressRing.visible = true;
    const segs = Math.max(1, Math.round(clamped * RING_SEGMENTS));
    // RingGeometry: 2 triangles (6 indices) per segment
    this.progressRing.geometry.setDrawRange(0, segs * 6);
    (this.progressRing.material as THREE.MeshBasicMaterial).opacity = 0.55 + clamped * 0.4;
  }

  public update(dt: number): void {
    this.pulseT += dt;
    if (this.progress <= 0.01) {
      const wave = Math.sin(this.pulseT * 2.2);
      this.dotMesh.scale.setScalar(1 + wave * 0.06);
      (this.dotMesh.material as THREE.MeshBasicMaterial).opacity = 0.55 + wave * 0.12;
    } else {
      this.dotMesh.scale.setScalar(1);
      (this.dotMesh.material as THREE.MeshBasicMaterial).opacity = 0.85;
    }
  }

  public updateTransform(
    headPos: THREE.Vector3,
    forwardDir: THREE.Vector3,
    headQuat: THREE.Quaternion,
    distance: number
  ): void {
    this.group.position.copy(headPos).addScaledVector(forwardDir, distance);
    this.group.quaternion.copy(headQuat);
    const scale = Math.max(0.6, distance * 0.5);
    this.group.scale.setScalar(scale);
  }
}
