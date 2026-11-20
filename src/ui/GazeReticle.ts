import * as THREE from 'three';

export class GazeReticle {
  public readonly group: THREE.Group;
  private readonly dotMesh: THREE.Mesh;
  private readonly progressRing: THREE.Mesh;
  private progress = 0;

  constructor() {
    this.group = new THREE.Group();
    this.group.renderOrder = 999;

    const dotGeo = new THREE.RingGeometry(0.004, 0.008, 24);
    const dotMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.75,
      depthTest: false
    });
    this.dotMesh = new THREE.Mesh(dotGeo, dotMat);
    this.group.add(this.dotMesh);

    const ringGeo = new THREE.RingGeometry(0.014, 0.022, 48, 1, Math.PI / 2, 0.001);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthTest: false
    });
    this.progressRing = new THREE.Mesh(ringGeo, ringMat);
    this.progressRing.visible = false;
    this.group.add(this.progressRing);
  }

  public setProgress(progress: number): void {
    const clamped = Math.max(0, Math.min(1, progress));
    if (Math.abs(clamped - this.progress) < 0.005 && clamped !== 0) {
      return;
    }
    this.progress = clamped;

    if (clamped <= 0.01) {
      this.progressRing.visible = false;
      return;
    }

    this.progressRing.visible = true;
    this.progressRing.geometry.dispose();
    const thetaLength = clamped * Math.PI * 2;
    this.progressRing.geometry = new THREE.RingGeometry(
      0.014,
      0.022,
      48,
      1,
      Math.PI / 2,
      -thetaLength
    );
  }

  public updateTransform(
    headPos: THREE.Vector3,
    forwardDir: THREE.Vector3,
    headQuat: THREE.Quaternion,
    distance: number
  ): void {
    this.group.position.copy(headPos).addScaledVector(forwardDir, distance);
    this.group.quaternion.copy(headQuat);
    // Keep apparent angular size consistent across depths
    const scale = Math.max(0.6, distance * 0.5);
    this.group.scale.setScalar(scale);
  }
}
