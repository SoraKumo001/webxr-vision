import * as THREE from 'three';

export class SpaceGridEnv {
  public readonly group: THREE.Group;
  private readonly stars: THREE.Points;

  constructor() {
    this.group = new THREE.Group();

    // Distant relaxing starfield (40m to 85m radius)
    const starCount = 1400;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      const r = 40 + Math.random() * 45;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);

      const tint = 0.75 + Math.random() * 0.25;
      colors[i * 3] = tint * (0.8 + Math.random() * 0.2);
      colors[i * 3 + 1] = tint * (0.85 + Math.random() * 0.15);
      colors[i * 3 + 2] = 1.0;
    }

    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const starMat = new THREE.PointsMaterial({
      size: 0.22,
      vertexColors: true,
      transparent: true,
      opacity: 0.8
    });

    this.stars = new THREE.Points(starGeo, starMat);
    this.group.add(this.stars);

    // Subtle concentric distance marker rings on floor (y = 0.02)
    const distances = [1, 3, 5, 10, 15];
    distances.forEach((d, idx) => {
      const ringGeo = new THREE.RingGeometry(d - 0.02, d + 0.02, 72);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: idx % 2 === 0 ? 0x1e40af : 0x0e7490,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = 0.02;
      this.group.add(ring);
    });

    // Subtle horizon ring at eye level
    const horizonGeo = new THREE.RingGeometry(19.95, 20.02, 96);
    horizonGeo.rotateX(-Math.PI / 2);
    const horizonMat = new THREE.MeshBasicMaterial({
      color: 0x334155,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide
    });
    const horizon = new THREE.Mesh(horizonGeo, horizonMat);
    horizon.position.y = 1.4;
    this.group.add(horizon);
  }

  public setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  public update(dt: number): void {
    if (!this.group.visible) return;
    this.stars.rotation.y += dt * 0.008;
  }
}
