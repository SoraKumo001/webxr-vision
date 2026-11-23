import * as THREE from 'three';
import { themeHex } from '../ui/theme';

const DOME_VERT = /* glsl */ `
  varying vec3 vPos;
  void main() {
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const DOME_FRAG = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uGlow;
  uniform vec3 uAurora;
  uniform float uTime;
  varying vec3 vPos;

  void main() {
    vec3 dir = normalize(vPos);
    float h = clamp((dir.y + 0.15) / 1.05, 0.0, 1.0);
    vec3 col = mix(uHorizon, uTop, pow(h, 1.15));
    float rim = smoothstep(0.02, 0.28, 1.0 - abs(dir.y));
    col = mix(col, uGlow, rim * 0.35);

    // Subtle slow-flowing aurora curtain in the mid-upper sky.
    float azimuth = atan(dir.z, dir.x);
    float wave1 = sin(azimuth * 2.0 + uTime * 0.09 + dir.y * 3.0);
    float wave2 = cos(azimuth * 3.0 - uTime * 0.06 + dir.x * 2.5);
    float auroraBand = smoothstep(0.08, 0.42, dir.y) * (1.0 - smoothstep(0.45, 0.85, dir.y));
    float auroraIntensity = clamp(0.5 + 0.5 * (wave1 * 0.6 + wave2 * 0.4), 0.0, 1.0);
    col += uAurora * auroraBand * pow(auroraIntensity, 1.8) * 0.16;

    gl_FragColor = vec4(col, 1.0);
  }
`;

const STAR_VERT = /* glsl */ `
  attribute float aPhase;
  attribute float aSize;
  uniform float uTime;
  varying vec3 vColor;
  varying float vTwinkle;

  void main() {
    vColor = color;
    vTwinkle = 0.58 + 0.42 * sin(uTime * (0.9 + mod(aPhase, 0.7)) + aPhase * 6.2831);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPos;
    float dist = max(10.0, -mvPos.z);
    gl_PointSize = clamp(aSize * (0.85 + 0.3 * vTwinkle) * (240.0 / dist), 1.5, 14.0);
  }
`;

const STAR_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vTwinkle;

  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float alpha = pow(1.0 - d * 2.0, 1.8) * vTwinkle * 0.88;
    gl_FragColor = vec4(vColor, alpha);
  }
`;

const DUST_VERT = /* glsl */ `
  attribute float aPhase;
  uniform float uTime;
  varying float vAlpha;

  void main() {
    vec3 p = position;
    p.y += sin(uTime * 0.25 + aPhase * 6.2831) * 0.35;
    p.x += cos(uTime * 0.18 + aPhase * 4.1) * 0.28;
    p.z += sin(uTime * 0.21 + aPhase * 5.3) * 0.28;
    vAlpha = 0.35 + 0.35 * sin(uTime * 0.65 + aPhase * 9.0);
    vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPos;
    float dist = max(1.0, -mvPos.z);
    gl_PointSize = clamp(0.11 * (260.0 / dist), 2.0, 22.0);
  }
`;

const DUST_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float glow = pow(1.0 - d * 2.0, 2.2);
    gl_FragColor = vec4(uColor, glow * vAlpha * 0.45);
  }
`;

/** Soft night sanctuary backdrop for VR / desktop preview (hidden in MR & aquatic). */
export class CalmNightEnv {
  public readonly group: THREE.Group;
  private readonly stars: THREE.Points;
  private readonly starMat: THREE.ShaderMaterial;
  private readonly dust: THREE.Points;
  private readonly dustMat: THREE.ShaderMaterial;
  private readonly dome: THREE.Mesh;
  private readonly domeMat: THREE.ShaderMaterial;
  private readonly rings: { mesh: THREE.Mesh; baseOpacity: number; phase: number }[] = [];
  private time = 0;

  constructor() {
    this.group = new THREE.Group();

    // Soft gradient dome (inside-facing) with gentle aurora wisps
    const domeGeo = new THREE.SphereGeometry(90, 48, 32, 0, Math.PI * 2, 0, Math.PI * 0.55);
    this.domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x0a2430) },
        uHorizon: { value: new THREE.Color(themeHex.ink) },
        uGlow: { value: new THREE.Color(0x123a42) },
        uAurora: { value: new THREE.Color(themeHex.seafoam) },
        uTime: { value: 0 }
      },
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG
    });
    this.dome = new THREE.Mesh(domeGeo, this.domeMat);
    this.dome.position.y = -2;
    this.group.add(this.dome);

    const starCount = 1200;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);
    const phases = new Float32Array(starCount);
    const sizes = new Float32Array(starCount);

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

      phases[i] = Math.random();
      sizes[i] = 0.45 + Math.random() * 0.85;
    }

    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    starGeo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    starGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    this.starMat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }
      }
    });

    this.stars = new THREE.Points(starGeo, this.starMat);
    this.group.add(this.stars);

    // Subtle floating ambient dust for depth parallax
    const dustCount = 140;
    const dustPos = new Float32Array(dustCount * 3);
    const dustPhase = new Float32Array(dustCount);
    for (let i = 0; i < dustCount; i++) {
      const r = 2.8 + Math.random() * 13.0;
      const angle = Math.random() * Math.PI * 2;
      dustPos[i * 3] = Math.cos(angle) * r;
      dustPos[i * 3 + 1] = 0.3 + Math.random() * 3.8;
      dustPos[i * 3 + 2] = Math.sin(angle) * r;
      dustPhase[i] = Math.random();
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    dustGeo.setAttribute('aPhase', new THREE.BufferAttribute(dustPhase, 1));

    this.dustMat = new THREE.ShaderMaterial({
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(themeHex.seafoamSoft) }
      }
    });
    this.dust = new THREE.Points(dustGeo, this.dustMat);
    this.group.add(this.dust);

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
      this.rings.push({ mesh: ring, baseOpacity: 0.16, phase: idx * 0.75 });
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
    this.time += dt;
    this.domeMat.uniforms.uTime.value = this.time;
    this.starMat.uniforms.uTime.value = this.time;
    this.dustMat.uniforms.uTime.value = this.time;
    this.stars.rotation.y += dt * 0.006;
    this.dome.rotation.y += dt * 0.002;

    for (const r of this.rings) {
      const pulse = 0.75 + 0.25 * Math.sin(this.time * 0.9 - r.phase);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = r.baseOpacity * pulse;
    }
  }
}
