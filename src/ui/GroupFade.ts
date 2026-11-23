import * as THREE from 'three';

/** Soft opacity fade for UI / mode groups (MeshBasic / Line / Points materials). */
export class GroupFade {
  private readonly root: THREE.Object3D;
  private current = 1;
  private target = 1;
  private readonly speed: number;

  constructor(root: THREE.Object3D, speed = 5.5) {
    this.root = root;
    this.speed = speed;
  }

  public show(): void {
    this.target = 1;
    this.root.visible = true;
  }

  public hide(): void {
    this.target = 0;
  }

  public setImmediate(visible: boolean): void {
    this.target = visible ? 1 : 0;
    this.current = this.target;
    this.applyOpacity(this.current);
    this.root.visible = visible;
  }

  public update(dt: number): void {
    if (Math.abs(this.current - this.target) < 0.01) {
      this.current = this.target;
      this.applyOpacity(this.current);
      if (this.target === 0) this.root.visible = false;
      return;
    }
    this.root.visible = true;
    const step = Math.min(1, dt * this.speed);
    this.current += (this.target - this.current) * step;
    this.applyOpacity(this.current);
  }

  private applyOpacity(alpha: number): void {
    this.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh | THREE.Line | THREE.Points;
      const mat = mesh.material;
      if (!mat) return;
      const mats = Array.isArray(mat) ? mat : [mat];
      for (const m of mats) {
        const anyMat = m as THREE.Material & { opacity?: number; transparent?: boolean };
        if (typeof anyMat.opacity !== 'number') continue;
        if (!anyMat.userData._fadeBaseOpacity) {
          anyMat.userData._fadeBaseOpacity = anyMat.opacity;
        }
        anyMat.transparent = true;
        anyMat.opacity = anyMat.userData._fadeBaseOpacity * alpha;
        anyMat.needsUpdate = true;
      }
    });
  }
}
