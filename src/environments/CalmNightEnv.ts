import * as THREE from 'three';
import { themeHex } from '../ui/theme';

/** Soft night sanctuary backdrop for VR / desktop preview (hidden in MR & aquatic). */
export class CalmNightEnv {
  public readonly group: THREE.Group;
  private readonly stars: THREE.Points;
  private readonly dome: THREE.Mesh;

  constructor() {
    this.group = new THREE.Group();

    // Soft gradient dome (inside-facing)
    const domeGeo = new THREE.SphereGeometry(90, 48, 32, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x0a2430) },
        uHorizon: { value: new THREE.Color(themeHex.ink) },
        uGlow: { value: new THREE.Color(0x123a42) }
      },
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        uniform vec3 uGlow;
        varying vec3 vPos;
        void main() {
          float h = clamp((normalize(vPos).y + 0.15) / 1.05, 0.0, 1.0);
          vec3 col = mix(uHorizon, uTop, pow(h, 1.15));
          float rim = smoothstep(0.02, 0.28, 1.0 - abs(normalize(vPos).y));
          col = mix(col, uGlow, rim * 0.35);
          gl_FragColor = vec4(col, 1.0);
        }
      `
    });
    this.dome = new THREE.Mesh(domeGeo, domeMat);
    this.dome.position.y = -2;
    this.group.add(this.dome);

    const starCount = 1200;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      const r = 42 + Math.random() * 40;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);

      const warm = Math.random();
      const tint = 0.7 + Math.random() * 0.3;
      colors[i * 3] = tint * (0.85 + warm * 0.15);
      colors[i * 3 + 1] = tint * (0.88 + (1 - warm) * 0.08);
      colors[i * 3 + 2] = tint * (0.78 + (1 - warm) * 0.2);
    }

    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const starMat = new THREE.PointsMaterial({
      size: 0.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      depthWrite: false
    });

    this.stars = new THREE.Points(starGeo, starMat);
    this.group.add(this.stars);

    const distances = [1, 3, 5, 10, 15];
    distances.forEach((d, idx) => {
      const ringGeo = new THREE.RingGeometry(d - 0.018, d + 0.018, 80);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: idx % 2 === 0 ? themeHex.seafoam : themeHex.teal,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = 0.02;
      this.group.add(ring);
    });

    const horizonGeo = new THREE.RingGeometry(22.9, 23.05, 96);
    horizonGeo.rotateX(-Math.PI / 2);
    const horizonMat = new THREE.MeshBasicMaterial({
      color: themeHex.seafoam,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const horizon = new THREE.Mesh(horizonGeo, horizonMat);
    horizon.position.y = 1.35;
    this.group.add(horizon);
  }

  public setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  public update(dt: number): void {
    if (!this.group.visible) return;
    this.stars.rotation.y += dt * 0.006;
    this.dome.rotation.y += dt * 0.002;
  }
}
