import * as THREE from 'three';
import { AudioManager } from '../core/AudioManager';
import { InteractiveCallbacks } from '../core/InputManager';
import { Difficulty } from '../core/StorageManager';
import { DisplayMode } from '../core/XRManager';
import { SpatialButton } from '../ui/SpatialPanel';
import { theme } from '../ui/theme';
import { ITrainingMode, TrainingHUDState, TrainingResult } from './ITrainingMode';
import { ModeUiChrome } from './ModeUiChrome';

type FireLevel = 'low' | 'medium' | 'high';

interface Spark {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  maxAge: number;
  drag: number;
  gravity: number;
  swirlPhase: number;
  swirlStrength: number;
}

const MAX_SPARKS = 160;

const FIRE_LEVEL_CONFIG: Record<
  FireLevel,
  { label: string; intensity: number; crackleRate: number }
> = {
  low: { label: '弱火', intensity: 0.58, crackleRate: 0.45 },
  medium: { label: '標準', intensity: 1.0, crackleRate: 1.0 },
  high: { label: '強火', intensity: 1.42, crackleRate: 1.65 }
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class CampfireMode implements ITrainingMode {
  public readonly id = 'campfire' as const;
  public readonly name = '7. たき火';
  public readonly description = '揺らめく炎とパチパチという音に包まれ、ただ静かにたき火を眺めます';
  public readonly group = new THREE.Group();

  private readonly arena = new THREE.Group();
  private readonly envGroup = new THREE.Group();
  private readonly fireRoot = new THREE.Group();
  private readonly controlsGroup = new THREE.Group();
  private readonly uiChrome: ModeUiChrome;

  private readonly audio: AudioManager;
  private readonly getDisplayMode: () => DisplayMode;
  public onUiHiddenChange?: (hidden: boolean) => void;

  private readonly fireLight: THREE.PointLight;
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly starMat: THREE.ShaderMaterial;
  private readonly groundMat: THREE.ShaderMaterial;
  private readonly logMat: THREE.ShaderMaterial;
  private readonly emberBedMat: THREE.ShaderMaterial;
  private readonly flameMaterials: THREE.ShaderMaterial[] = [];
  private readonly embersMat: THREE.ShaderMaterial;
  private readonly smokeMat: THREE.ShaderMaterial;
  private readonly sparkPosAttr: THREE.BufferAttribute;
  private readonly sparkColorAttr: THREE.BufferAttribute;
  private readonly sparks: Spark[] = [];
  private readonly popFlashMesh: THREE.Mesh;
  private readonly popFlashMat: THREE.ShaderMaterial;

  private readonly btnStoke: SpatialButton;
  private readonly btnLevel: SpatialButton;
  private readonly btnEnv: SpatialButton;

  private fireLevel: FireLevel = 'medium';
  private showEnvironment = true;
  private stokeBoost = 0;
  private stokedCount = 0;
  private elapsedInMode = 0;
  private crackleTimer = 0.6;
  private popBurstTimer = 1.6;
  private popFlash = 0;
  private audioIntensityTimer = 0;
  private currentIntensity = 1.0;

  constructor(audio: AudioManager, getDisplayMode: () => DisplayMode) {
    this.audio = audio;
    this.getDisplayMode = getDisplayMode;

    this.group.add(this.arena);
    this.arena.add(this.envGroup);
    this.fireRoot.position.set(0, -1.12, -2.05);
    this.arena.add(this.fireRoot);

    // 1. VR Night Environment (Sky dome, stars, lit ground, tree silhouettes)
    const skyGeo = new THREE.SphereGeometry(32, 32, 20);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 1.0 }
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        uniform float uTime;
        uniform float uIntensity;
        void main() {
          float h = clamp(vDir.y, -0.1, 1.0);
          vec3 zenith = vec3(0.015, 0.031, 0.071);   // #040812
          vec3 midSky = vec3(0.032, 0.045, 0.095);
          vec3 horizonGlow = mix(vec3(0.06, 0.04, 0.05), vec3(0.14, 0.065, 0.035), clamp(uIntensity * 0.55, 0.2, 1.0));
          vec3 col = mix(horizonGlow, midSky, smoothstep(-0.05, 0.24, h));
          col = mix(col, zenith, smoothstep(0.22, 0.85, h));
          gl_FragColor = vec4(col, 1.0);
        }
      `
    });
    this.envGroup.add(new THREE.Mesh(skyGeo, this.skyMat));

    this.starMat = this.createStars();
    this.groundMat = this.createGround();
    this.createTreeSilhouettes();

    // 2. Campfire Pit (Stones, Logs, Ember bed) - visible in both VR and MR
    this.createStoneRing();
    this.logMat = this.createLogs();
    this.emberBedMat = this.createEmberBed();

    // 3. Multi-layered Volumetric-style Flame Plumes
    this.buildFlameMeshes();

    // 4. Embers, Burst Streak Sparks, Pop Flash & Subtle Smoke
    this.embersMat = this.createEmbers();
    this.smokeMat = this.createSmoke();

    for (let i = 0; i < MAX_SPARKS; i++) {
      this.sparks.push({
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        age: 0,
        maxAge: 0.4,
        drag: 2.5,
        gravity: 2.5,
        swirlPhase: 0,
        swirlStrength: 0
      });
    }
    const sparkPositions = new Float32Array(MAX_SPARKS * 2 * 3);
    const sparkColors = new Float32Array(MAX_SPARKS * 2 * 3);
    this.sparkPosAttr = new THREE.BufferAttribute(sparkPositions, 3);
    this.sparkPosAttr.setUsage(THREE.DynamicDrawUsage);
    this.sparkColorAttr = new THREE.BufferAttribute(sparkColors, 3);
    this.sparkColorAttr.setUsage(THREE.DynamicDrawUsage);

    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', this.sparkPosAttr);
    sparkGeo.setAttribute('color', this.sparkColorAttr);
    const sparkMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const sparkLines = new THREE.LineSegments(sparkGeo, sparkMat);
    sparkLines.frustumCulled = false;
    this.fireRoot.add(sparkLines);

    this.popFlashMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uFlash: { value: 0 }
      },
      vertexShader: /* glsl */ `
        varying vec3 vNormalView;
        varying vec3 vViewDir;
        void main() {
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vNormalView = normalize(normalMatrix * normal);
          vViewDir = normalize(-mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vNormalView;
        varying vec3 vViewDir;
        uniform float uFlash;
        void main() {
          float ndv = max(0.0, dot(normalize(vNormalView), normalize(vViewDir)));
          float glow = pow(ndv, 2.4) * uFlash;
          vec3 col = mix(vec3(1.0, 0.52, 0.12), vec3(1.0, 0.94, 0.72), ndv);
          gl_FragColor = vec4(col * glow, glow);
        }
      `
    });
    this.popFlashMesh = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), this.popFlashMat);
    this.popFlashMesh.visible = false;
    this.fireRoot.add(this.popFlashMesh);

    // 5. Dynamic Flickering Fire Light
    this.fireLight = new THREE.PointLight(0xff7b29, 2.8, 12, 1.5);
    this.fireLight.position.set(0, 0.28, 0);
    this.fireRoot.add(this.fireLight);

    // 6. Minimal Spatial Controls (docked to the left of the campfire so fire view stays clear)
    this.uiChrome = new ModeUiChrome(this.arena, this.audio, {
      showButtonPosition: new THREE.Vector3(0.95, -0.92, -1.6)
    });
    this.uiChrome.showBtn.mesh.lookAt(0, -0.25, 0);
    const showBtnMat = this.uiChrome.showBtn.mesh.material as THREE.MeshBasicMaterial;
    showBtnMat.transparent = true;
    showBtnMat.opacity = 0.22;
    const baseShowCallbacks = this.uiChrome.showBtn.mesh.userData as InteractiveCallbacks;
    const origOnHover = baseShowCallbacks.onHover;
    const origOnBlur = baseShowCallbacks.onBlur;
    baseShowCallbacks.onHover = (obj) => {
      showBtnMat.opacity = 0.92;
      origOnHover?.(obj);
    };
    baseShowCallbacks.onBlur = (obj) => {
      showBtnMat.opacity = 0.22;
      origOnBlur?.(obj);
    };
    this.uiChrome.onChange = (hidden) => this.onUiHiddenChange?.(hidden);

    this.controlsGroup.position.set(-1.02, -0.56, -1.62);
    this.controlsGroup.rotation.set(0, 0.48, 0);
    this.arena.add(this.controlsGroup);

    this.btnStoke = new SpatialButton({
      width: 0.40,
      height: 0.13,
      label: '薪をくべる',
      fontSize: 27,
      bgColor: theme.modeCampfireBg,
      borderColor: theme.modeCampfire,
      accentColor: theme.modeCampfire,
      gazeDwellSeconds: 0.7,
      onSelect: () => this.stokeFire()
    });
    this.btnStoke.mesh.position.set(0, 0.16, 0);
    this.controlsGroup.add(this.btnStoke.mesh);

    this.btnLevel = new SpatialButton({
      width: 0.40,
      height: 0.13,
      label: '火加減: 標準',
      fontSize: 25,
      bgColor: theme.modeCampfireBg,
      borderColor: theme.amber,
      accentColor: theme.amber,
      gazeDwellSeconds: 0.75,
      onSelect: () => this.cycleFireLevel()
    });
    this.btnLevel.mesh.position.set(0, 0, 0);
    this.controlsGroup.add(this.btnLevel.mesh);

    this.btnEnv = new SpatialButton({
      width: 0.40,
      height: 0.13,
      label: '背景: ON',
      fontSize: 25,
      bgColor: theme.modeCampfireBg,
      borderColor: theme.amber,
      accentColor: theme.amber,
      gazeDwellSeconds: 0.75,
      onSelect: () => {
        this.showEnvironment = !this.showEnvironment;
        this.audio.playSelect();
        this.applyEnvironmentVisibility();
      }
    });
    this.btnEnv.mesh.position.set(0, -0.16, 0);
    this.controlsGroup.add(this.btnEnv.mesh);

    this.uiChrome.setChrome([this.controlsGroup]);
  }

  private createStars(): THREE.ShaderMaterial {
    const rng = mulberry32(4207);
    const starCount = 600;
    const pos = new Float32Array(starCount * 3);
    const phases = new Float32Array(starCount);
    const sizes = new Float32Array(starCount);

    for (let i = 0; i < starCount; i++) {
      const r = 27 + rng() * 3.5;
      const theta = rng() * Math.PI * 2;
      const cosPhi = 0.06 + rng() * 0.94;
      const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
      pos[i * 3] = r * sinPhi * Math.cos(theta);
      pos[i * 3 + 1] = r * cosPhi;
      pos[i * 3 + 2] = r * sinPhi * Math.sin(theta);
      phases[i] = rng();
      sizes[i] = 0.55 + rng() * 0.85;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }
      },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        attribute float aSize;
        uniform float uTime;
        varying float vTwinkle;
        void main() {
          vTwinkle = 0.52 + 0.48 * sin(uTime * (0.7 + mod(aPhase, 0.8)) + aPhase * 6.2831);
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPos;
          float dist = max(6.0, -mvPos.z);
          gl_PointSize = clamp(aSize * (160.0 / dist), 1.4, 6.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vTwinkle;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float alpha = pow(1.0 - d * 2.0, 2.0) * vTwinkle * 0.85;
          gl_FragColor = vec4(vec3(0.92, 0.94, 1.0), alpha);
        }
      `
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.envGroup.add(points);
    return mat;
  }

  private createGround(): THREE.ShaderMaterial {
    const geo = new THREE.CircleGeometry(22, 48);
    geo.rotateX(-Math.PI / 2);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 1.0 },
        uFlicker: { value: 1.0 },
        uFireXZ: { value: new THREE.Vector2(0, -2.05) }
      },
      vertexShader: /* glsl */ `
        varying vec3 vArenaPos;
        void main() {
          vArenaPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vArenaPos;
        uniform float uTime;
        uniform float uIntensity;
        uniform float uFlicker;
        uniform vec2 uFireXZ;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        void main() {
          vec2 rel = vArenaPos.xz - uFireXZ;
          float dist = length(rel);
          float grain = noise(vArenaPos.xz * 3.2) * 0.55 + noise(vArenaPos.xz * 9.5) * 0.45;
          vec3 soilBase = mix(vec3(0.025, 0.028, 0.032), vec3(0.055, 0.045, 0.038), grain);

          float lightRadius = 3.2 + uIntensity * 1.4;
          float warmFalloff = exp(-dist * dist / (lightRadius * 1.35));
          float closeGlow = exp(-dist * dist / 0.65);

          vec3 warmCol = vec3(0.88, 0.36, 0.11) * warmFalloff * (0.55 + 0.45 * uFlicker) * (0.65 + 0.35 * uIntensity);
          vec3 emberRim = vec3(1.0, 0.48, 0.14) * closeGlow * 0.42 * uFlicker;

          float outerFade = smoothstep(22.0, 12.0, length(vArenaPos.xz));
          vec3 col = (soilBase + warmCol * (0.75 + 0.35 * grain) + emberRim) * outerFade;
          gl_FragColor = vec4(col, 1.0);
        }
      `
    });

    const ground = new THREE.Mesh(geo, mat);
    ground.position.y = -1.16;
    this.envGroup.add(ground);
    return mat;
  }

  private createTreeSilhouettes(): void {
    const rng = mulberry32(9183);
    const foliageMat = new THREE.MeshStandardMaterial({
      color: 0x0b1318,
      roughness: 0.96,
      metalness: 0.0
    });
    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x120d0a,
      roughness: 0.98
    });

    const treeCount = 20;
    for (let i = 0; i < treeCount; i++) {
      const ang = (i / treeCount) * Math.PI * 2 + (rng() - 0.5) * 0.22;
      const dist = 8.2 + rng() * 6.8;
      const tx = Math.cos(ang) * dist;
      const tz = -2.05 + Math.sin(ang) * dist;
      const scale = 0.85 + rng() * 0.75;

      const tree = new THREE.Group();
      tree.position.set(tx, -1.16, tz);

      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11 * scale, 0.17 * scale, 1.3 * scale, 7),
        trunkMat
      );
      trunk.position.y = 0.65 * scale;
      tree.add(trunk);

      const tierSpecs = [
        { r: 1.05, h: 1.9, y: 1.75 },
        { r: 0.82, h: 1.75, y: 2.8 },
        { r: 0.55, h: 1.5, y: 3.75 }
      ];
      for (const t of tierSpecs) {
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(t.r * scale, t.h * scale, 7),
          foliageMat
        );
        cone.position.y = t.y * scale;
        cone.rotation.y = rng() * Math.PI;
        tree.add(cone);
      }

      this.envGroup.add(tree);
    }
  }

  private createStoneRing(): void {
    const rng = mulberry32(1337);
    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0x3b3836,
      roughness: 0.92,
      metalness: 0.05
    });

    const stoneCount = 13;
    const ringRadius = 0.42;
    for (let i = 0; i < stoneCount; i++) {
      const ang = (i / stoneCount) * Math.PI * 2 + (rng() - 0.5) * 0.14;
      const r = ringRadius + (rng() - 0.5) * 0.04;
      const geo = new THREE.IcosahedronGeometry(0.105, 1);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const seedOffset = rng() * 100;

      for (let v = 0; v < pos.count; v++) {
        const vx = pos.getX(v);
        const vy = pos.getY(v);
        const vz = pos.getZ(v);
        const n =
          0.84 +
          0.32 *
            Math.sin(vx * 18.0 + seedOffset) *
            Math.cos(vy * 15.0 - seedOffset) *
            Math.sin(vz * 21.0 + seedOffset * 0.5);
        pos.setXYZ(v, vx * n, vy * n * 0.66, vz * n);
      }
      geo.computeVertexNormals();

      const stone = new THREE.Mesh(geo, stoneMat);
      stone.position.set(Math.cos(ang) * r, -0.005, Math.sin(ang) * r);
      stone.rotation.set((rng() - 0.5) * 0.3, rng() * Math.PI * 2, (rng() - 0.5) * 0.3);
      stone.scale.set(0.95 + rng() * 0.32, 0.8 + rng() * 0.25, 0.85 + rng() * 0.3);
      this.fireRoot.add(stone);
    }
  }

  private createSplitLogGeometry(
    radius: number,
    length: number,
    radialSegs: number,
    seed: number
  ): THREE.BufferGeometry {
    const rng = mulberry32(seed);
    const geo = new THREE.CylinderGeometry(radius * 0.88, radius * 1.06, length, radialSegs, 8);
    const pos = geo.attributes.position as THREE.BufferAttribute;

    // Slight natural bend and split-wood asymmetry per vertex
    const bendX = (rng() - 0.5) * 0.035;
    const bendZ = (rng() - 0.5) * 0.035;
    const wedgeFlatten = 0.74 + rng() * 0.22;

    for (let i = 0; i < pos.count; i++) {
      let vx = pos.getX(i);
      const vy = pos.getY(i);
      let vz = pos.getZ(i);

      const t = vy / length + 0.5; // 0..1 along log
      const ang = Math.atan2(vz, vx);
      const ridge =
        0.86 +
        0.22 * Math.sin(ang * 3.0 + seed) * Math.cos(t * 7.0 + seed * 0.3) +
        0.08 * Math.sin(ang * 6.0 - t * 11.0);

      vx = vx * ridge + bendX * (t * t - 0.25);
      vz = vz * ridge * wedgeFlatten + bendZ * (t * t - 0.25);
      pos.setXYZ(i, vx, vy, vz);
    }

    geo.computeVertexNormals();
    return geo;
  }

  private createLogs(): THREE.ShaderMaterial {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 1.0 },
        uFlicker: { value: 1.0 }
      },
      vertexShader: /* glsl */ `
        varying vec3 vFirePos;
        varying vec3 vFireNormal;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          // Log transforms are baked into geometry so position & normal are in fireRoot space
          vFirePos = position;
          vFireNormal = normalize(normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vFirePos;
        varying vec3 vFireNormal;
        varying vec2 vUv;
        uniform float uTime;
        uniform float uIntensity;
        uniform float uFlicker;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
            mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }

        void main() {
          vec3 coreCenter = vec3(0.0, 0.13, 0.0);
          vec3 toCore = coreCenter - vFirePos;
          float distToCore = length(toCore);
          vec3 dirToCore = normalize(toCore + vec3(0.0001));
          vec3 nrm = normalize(vFireNormal);

          // Underside & inner faces closest to the fire char deeply
          float underBias = clamp(-nrm.y * 0.5 + 0.5, 0.0, 1.0);
          float heatExposure = distToCore - underBias * 0.055;
          float charFactor = smoothstep(0.32, 0.11, heatExposure);

          // Wood grain & split bark texture
          float grain = noise(vec2(vUv.x * 16.0, vUv.y * 5.0));
          float stripe = 0.5 + 0.5 * sin(vUv.x * 38.0 + grain * 3.5);
          vec3 woodHeart = vec3(0.34, 0.21, 0.11);
          vec3 woodBark = vec3(0.12, 0.075, 0.045);
          vec3 rawWood = mix(woodBark, woodHeart, 0.35 + 0.45 * stripe);
          vec3 charred = vec3(0.025, 0.022, 0.024);
          vec3 baseCol = mix(rawWood, charred, charFactor);

          // Direct warm bounce light from the fire center
          float faceFire = max(0.0, dot(nrm, dirToCore));
          float bounce = (0.14 + 0.86 * faceFire) * exp(-distToCore * 2.4);
          vec3 fireLit = baseCol + vec3(0.95, 0.36, 0.07) * bounce * (0.45 + 0.4 * uFlicker) * (0.65 + 0.35 * uIntensity) * (1.0 - charFactor * 0.4);

          // Subtle cool moonlight/ambient fill on outer faces so logs stay readable
          float upRim = max(0.0, nrm.y) * 0.06;
          fireLit += vec3(0.04, 0.045, 0.06) * upRim;

          // Glowing ember cracks on the charred surfaces facing the coals
          float crackNoise = noise(vFirePos.xz * 26.0 + vec2(vFirePos.y * 14.0, 0.0));
          float crack = smoothstep(0.58, 0.86, crackNoise);
          float pulse = 0.65 + 0.35 * sin(uTime * 2.1 + vFirePos.x * 18.0 + vFirePos.z * 16.0);
          float emberZone = charFactor * (0.4 + 0.6 * max(faceFire, underBias));
          vec3 emberGlow = vec3(1.0, 0.34, 0.04) * emberZone * crack * pulse * (0.55 + 0.55 * uIntensity);

          gl_FragColor = vec4(fireLit + emberGlow, 1.0);
        }
      `
    });

    interface LogPlacement {
      x: number;
      y: number;
      z: number;
      rx: number;
      ry: number;
      rz: number;
      radius: number;
      length: number;
      sides: number;
    }

    const placements: LogPlacement[] = [
      // Layer 1: Base logs framing the ember bed
      { x: -0.17, y: 0.038, z: 0.02, rx: 1.54, ry: 0.28, rz: 0.05, radius: 0.048, length: 0.54, sides: 7 },
      { x: 0.16, y: 0.036, z: -0.03, rx: 1.52, ry: -0.34, rz: -0.06, radius: 0.046, length: 0.52, sides: 6 },
      { x: 0.0, y: 0.04, z: -0.17, rx: 0.08, ry: 0.12, rz: 1.53, radius: 0.05, length: 0.56, sides: 7 },

      // Layer 2: Crisscross middle crib resting atop the base logs
      { x: -0.02, y: 0.105, z: 0.13, rx: -0.16, ry: 0.22, rz: 1.48, radius: 0.041, length: 0.5, sides: 6 },
      { x: -0.11, y: 0.118, z: -0.04, rx: 1.32, ry: 0.72, rz: -0.18, radius: 0.038, length: 0.48, sides: 5 },
      { x: 0.11, y: 0.12, z: 0.05, rx: 1.28, ry: -0.68, rz: 0.22, radius: 0.039, length: 0.48, sides: 6 },
      { x: 0.03, y: 0.132, z: -0.1, rx: 0.24, ry: -0.28, rz: 1.42, radius: 0.036, length: 0.46, sides: 6 },

      // Layer 3: Leaning split wood stacked upward around the flame core
      { x: -0.13, y: 0.175, z: 0.11, rx: -0.92, ry: 0.65, rz: 0.42, radius: 0.034, length: 0.46, sides: 5 },
      { x: 0.14, y: 0.17, z: 0.09, rx: -0.88, ry: -0.72, rz: -0.38, radius: 0.032, length: 0.45, sides: 6 },
      { x: 0.01, y: 0.185, z: -0.13, rx: 0.94, ry: 0.15, rz: 0.18, radius: 0.034, length: 0.46, sides: 5 },
      { x: -0.09, y: 0.195, z: -0.1, rx: 0.82, ry: -0.58, rz: -0.32, radius: 0.028, length: 0.42, sides: 5 },
      { x: 0.07, y: 0.205, z: 0.13, rx: -0.76, ry: 0.35, rz: -0.24, radius: 0.027, length: 0.41, sides: 5 }
    ];

    const pos = new THREE.Vector3();
    const euler = new THREE.Euler();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    const matrix = new THREE.Matrix4();

    placements.forEach((p, idx) => {
      const geo = this.createSplitLogGeometry(p.radius, p.length, p.sides, 2100 + idx * 97);
      pos.set(p.x, p.y, p.z);
      euler.set(p.rx, p.ry, p.rz, 'YXZ');
      quat.setFromEuler(euler);
      matrix.compose(pos, quat, scale);
      geo.applyMatrix4(matrix);

      const mesh = new THREE.Mesh(geo, mat);
      this.fireRoot.add(mesh);
    });

    return mat;
  }

  private createEmberBed(): THREE.ShaderMaterial {
    const geo = new THREE.SphereGeometry(0.28, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5);
    geo.scale(1, 0.28, 1);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 1.0 },
        uFlicker: { value: 1.0 }
      },
      vertexShader: /* glsl */ `
        varying vec3 vLocal;
        void main() {
          vLocal = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vLocal;
        uniform float uTime;
        uniform float uIntensity;
        uniform float uFlicker;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
            mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }

        void main() {
          float r = length(vLocal.xz) / 0.28;
          float n1 = noise(vLocal.xz * 18.0 + vec2(uTime * 0.12, -uTime * 0.08));
          float n2 = noise(vLocal.xz * 34.0 - vec2(uTime * 0.16, uTime * 0.1));
          float heat = smoothstep(0.32, 0.85, n1 * 0.65 + n2 * 0.35) * (1.0 - smoothstep(0.55, 1.05, r));
          float breathe = 0.72 + 0.28 * sin(uTime * 1.4 + n1 * 6.28);

          vec3 coal = vec3(0.04, 0.03, 0.03);
          vec3 redEmber = vec3(0.85, 0.16, 0.02);
          vec3 brightEmber = vec3(1.0, 0.56, 0.12);

          vec3 glow = mix(redEmber, brightEmber, smoothstep(0.45, 0.9, heat));
          vec3 col = mix(coal, glow, clamp(heat * breathe * (0.65 + 0.45 * uIntensity) * (0.8 + 0.2 * uFlicker), 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
        }
      `
    });

    const bed = new THREE.Mesh(geo, mat);
    bed.position.y = -0.02;
    this.fireRoot.add(bed);
    return mat;
  }

  private createFlameMaterial(
    heatBias: number,
    alphaScale: number,
    seed: number
  ): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 1.0 },
        uWind: { value: new THREE.Vector2(0, 0) },
        uPop: { value: 0 },
        uHeatBias: { value: heatBias },
        uAlphaScale: { value: alphaScale },
        uSeed: { value: seed }
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        uniform float uTime;
        uniform float uIntensity;
        uniform vec2 uWind;
        uniform float uPop;
        uniform float uSeed;
        void main() {
          vUv = uv;
          vec3 p = position;
          float h = clamp(uv.y, 0.0, 1.0);
          float hPow = pow(h, 1.45);
          // Organic wind bend + high-frequency flutter near flame tips
          float gustX = sin(uTime * 3.7 + h * 5.2 + uSeed * 2.1) * 0.045
                      + sin(uTime * 7.1 - h * 8.4 + uSeed * 4.7) * 0.022;
          float gustZ = cos(uTime * 3.1 + h * 4.6 + uSeed * 3.3) * 0.038
                      + cos(uTime * 6.3 - h * 7.2 + uSeed * 1.9) * 0.018;
          p.x += (uWind.x * 0.16 + gustX) * hPow;
          p.z += (uWind.y * 0.16 + gustZ) * hPow;
          p.y *= 0.84 + 0.24 * uIntensity + uPop * 0.09;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform float uTime;
        uniform float uIntensity;
        uniform vec2 uWind;
        uniform float uHeatBias;
        uniform float uAlphaScale;
        uniform float uSeed;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        float fbm(vec2 p) {
          float v = 0.0;
          float amp = 0.5;
          for (int i = 0; i < 4; i++) {
            v += amp * noise(p);
            p = p * 2.04 + vec2(13.1, 7.7);
            amp *= 0.5;
          }
          return v;
        }

        void main() {
          float y = vUv.y;
          float xCentered = (vUv.x - 0.5) * 2.0;
          float t = uTime * (0.9 + 0.18 * uIntensity);

          // Domain-warped FBM for realistic curling & licking flame tongues
          vec2 q = vec2(
            fbm(vec2(vUv.x * 3.1 + uSeed, y * 2.4 - t * 1.65)),
            fbm(vec2(vUv.x * 3.1 + uSeed + 5.2, y * 2.8 - t * 2.05))
          );
          float turb = fbm(vec2(vUv.x * 3.8 + uSeed * 1.7, y * 3.2 - t * 2.25) + (q - 0.5) * 1.5);
          float fine = fbm(vec2(vUv.x * 8.2 - uSeed, y * 6.8 - t * 3.5) + q * 0.85);

          // Asymmetric wind-blown spine & curling width
          float windLean = (uWind.x + uWind.y) * 0.12 * y * y;
          float spineOffset = (q.x - 0.5) * 0.68 * pow(y, 0.72) + (fine - 0.5) * 0.22 * y + windLean;
          float halfWidth = mix(0.86, 0.08, pow(y, 0.72)) * (0.72 + 0.52 * fine);
          float dist = abs(xCentered - spineOffset);
          float shape = 1.0 - smoothstep(halfWidth * 0.2, max(0.04, halfWidth), dist);

          // Base & jagged upper tongue breakup + detached flame wisps near tip
          float baseFade = smoothstep(0.0, 0.13, y);
          float topBreak = smoothstep(1.0, 0.26 + (turb - 0.45) * 0.58, y);
          float wispBand = smoothstep(0.32, 0.62, y) * (1.0 - smoothstep(0.68, 0.98, y));
          float wisps = smoothstep(0.58, 0.85, fine) * wispBand * (1.0 - smoothstep(halfWidth * 0.6, halfWidth * 1.45, dist));

          float filament = smoothstep(0.24, 0.88, turb * 0.7 + fine * 0.3);
          float density = (shape * baseFade * topBreak * (0.48 + 0.72 * filament) + wisps * 0.42);
          density *= clamp(0.68 + 0.36 * uIntensity, 0.45, 1.45);
          if (density < 0.025) discard;

          // Rich temperature gradient avoiding flat white washout
          float heat = clamp(density * (1.05 - y * 0.52) + (fine - 0.5) * 0.18 + uHeatBias * 0.28, 0.0, 1.0);
          vec3 colCrimson = vec3(0.88, 0.14, 0.02);
          vec3 colOrange = vec3(1.0, 0.46, 0.06);
          vec3 colGold = vec3(1.0, 0.78, 0.22);
          vec3 colCore = vec3(1.0, 0.96, 0.78);

          vec3 col = mix(colCrimson, colOrange, smoothstep(0.14, 0.46, heat));
          col = mix(col, colGold, smoothstep(0.46, 0.76, heat));
          col = mix(col, colCore, smoothstep(0.76, 0.98, heat));

          float alpha = clamp(density * uAlphaScale, 0.0, 0.78);
          gl_FragColor = vec4(col * alpha, alpha);
        }
      `
    });
  }

  private buildFlameMeshes(): void {
    interface PlumeSpec {
      x: number;
      y: number;
      z: number;
      w: number;
      h: number;
      rotY: number;
      tiltX: number;
      heatBias: number;
      alphaScale: number;
      seed: number;
    }

    const plumes: PlumeSpec[] = [
      // Central tall primary tongues (3 intersecting angles for 360-deg VR volume)
      { x: 0.0, y: 0.05, z: 0.0, w: 0.44, h: 0.84, rotY: 0.1, tiltX: 0.04, heatBias: 0.65, alphaScale: 0.68, seed: 1.3 },
      { x: 0.01, y: 0.05, z: -0.01, w: 0.42, h: 0.8, rotY: 1.15, tiltX: -0.05, heatBias: 0.58, alphaScale: 0.65, seed: 4.7 },
      { x: -0.01, y: 0.05, z: 0.01, w: 0.46, h: 0.76, rotY: 2.18, tiltX: 0.03, heatBias: 0.48, alphaScale: 0.6, seed: 8.2 },

      // Secondary flame tongues emerging between stacked logs
      { x: -0.11, y: 0.08, z: 0.06, w: 0.34, h: 0.58, rotY: 0.42, tiltX: 0.08, heatBias: 0.38, alphaScale: 0.56, seed: 12.6 },
      { x: 0.12, y: 0.07, z: 0.04, w: 0.36, h: 0.62, rotY: -0.55, tiltX: -0.07, heatBias: 0.42, alphaScale: 0.56, seed: 17.4 },
      { x: 0.02, y: 0.09, z: -0.1, w: 0.38, h: 0.64, rotY: 1.52, tiltX: 0.06, heatBias: 0.35, alphaScale: 0.54, seed: 22.9 },
      { x: -0.08, y: 0.1, z: -0.08, w: 0.32, h: 0.52, rotY: 2.55, tiltX: -0.08, heatBias: 0.32, alphaScale: 0.52, seed: 28.1 },
      { x: 0.09, y: 0.1, z: -0.07, w: 0.33, h: 0.54, rotY: -1.35, tiltX: 0.07, heatBias: 0.32, alphaScale: 0.52, seed: 33.8 },

      // Low wide base flames wrapping around the lower logs
      { x: 0.0, y: 0.02, z: 0.02, w: 0.56, h: 0.42, rotY: 0.0, tiltX: 0.0, heatBias: 0.22, alphaScale: 0.5, seed: 41.2 },
      { x: 0.0, y: 0.02, z: 0.0, w: 0.54, h: 0.4, rotY: 1.05, tiltX: 0.0, heatBias: 0.2, alphaScale: 0.48, seed: 47.5 },
      { x: 0.0, y: 0.02, z: -0.02, w: 0.54, h: 0.4, rotY: 2.1, tiltX: 0.0, heatBias: 0.2, alphaScale: 0.48, seed: 53.9 }
    ];

    for (const spec of plumes) {
      const geo = new THREE.PlaneGeometry(spec.w, spec.h, 8, 18);
      geo.translate(0, spec.h * 0.5, 0);
      const mat = this.createFlameMaterial(spec.heatBias, spec.alphaScale, spec.seed);
      this.flameMaterials.push(mat);

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(spec.x, spec.y, spec.z);
      mesh.rotation.set(spec.tiltX, spec.rotY, 0, 'YXZ');
      this.fireRoot.add(mesh);
    }
  }

  private createEmbers(): THREE.ShaderMaterial {
    const rng = mulberry32(7731);
    const count = 110;
    const pos = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);
    const radii = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const ang = rng() * Math.PI * 2;
      const r = 0.03 + rng() * 0.22;
      pos[i * 3] = Math.cos(ang) * r;
      pos[i * 3 + 1] = 0.06 + rng() * 0.15;
      pos[i * 3 + 2] = Math.sin(ang) * r;
      phases[i] = rng();
      speeds[i] = 0.14 + rng() * 0.22;
      radii[i] = 0.05 + rng() * 0.22;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
    geo.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 1.0 }
      },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        attribute float aSpeed;
        attribute float aRadius;
        uniform float uTime;
        uniform float uIntensity;
        varying float vLife;
        varying float vFlicker;
        void main() {
          float life = fract(uTime * aSpeed * (0.75 + 0.35 * uIntensity) + aPhase);
          vLife = life;
          vFlicker = 0.55 + 0.45 * sin(uTime * 11.0 + aPhase * 37.0);

          vec3 p = position;
          float angle = aPhase * 6.2831 + life * 4.5 + uTime * 0.8;
          float drift = aRadius * (0.4 + life * 1.6);
          p.x += cos(angle) * drift;
          p.z += sin(angle) * drift;
          p.y += life * (1.45 + 0.85 * uIntensity);

          vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPos;
          float dist = max(0.5, -mvPos.z);
          float fadeSize = sin(life * 3.14159);
          gl_PointSize = clamp((10.0 + 7.0 * uIntensity) * fadeSize / dist, 1.5, 11.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vLife;
        varying float vFlicker;
        uniform float uIntensity;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float core = pow(1.0 - d * 2.0, 2.2);
          float fade = smoothstep(0.0, 0.12, vLife) * (1.0 - smoothstep(0.65, 1.0, vLife));
          vec3 col = mix(vec3(1.0, 0.82, 0.32), vec3(1.0, 0.32, 0.05), vLife);
          float alpha = core * fade * vFlicker * clamp(0.6 + 0.45 * uIntensity, 0.4, 1.2);
          gl_FragColor = vec4(col, alpha);
        }
      `
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.fireRoot.add(points);
    return mat;
  }

  private createSmoke(): THREE.ShaderMaterial {
    const rng = mulberry32(5519);
    const count = 28;
    const pos = new Float32Array(count * 3);
    const phases = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const ang = rng() * Math.PI * 2;
      const r = rng() * 0.14;
      pos[i * 3] = Math.cos(ang) * r;
      pos[i * 3 + 1] = 0.48 + rng() * 0.12;
      pos[i * 3 + 2] = Math.sin(ang) * r;
      phases[i] = rng();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 1.0 }
      },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        uniform float uTime;
        varying float vLife;
        void main() {
          float life = fract(uTime * 0.11 + aPhase);
          vLife = life;
          vec3 p = position;
          p.x += sin(uTime * 0.45 + aPhase * 12.0 + life * 3.0) * (0.06 + life * 0.22);
          p.z += cos(uTime * 0.38 + aPhase * 9.0 + life * 2.5) * (0.06 + life * 0.22);
          p.y += life * 2.05;

          vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPos;
          float dist = max(0.8, -mvPos.z);
          gl_PointSize = clamp((68.0 + life * 130.0) / dist, 10.0, 96.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vLife;
        uniform float uIntensity;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float soft = pow(1.0 - d * 2.0, 2.4);
          float env = smoothstep(0.0, 0.2, vLife) * (1.0 - smoothstep(0.45, 1.0, vLife));
          float alpha = soft * env * 0.11 * clamp(0.75 + 0.25 * uIntensity, 0.5, 1.15);
          gl_FragColor = vec4(vec3(0.48, 0.44, 0.42), alpha);
        }
      `
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.fireRoot.add(points);
    return mat;
  }

  private resetSparks(): void {
    for (const s of this.sparks) {
      s.active = false;
    }
    (this.sparkPosAttr.array as Float32Array).fill(0);
    (this.sparkColorAttr.array as Float32Array).fill(0);
    this.sparkPosAttr.needsUpdate = true;
    this.sparkColorAttr.needsUpdate = true;
    this.popFlash = 0;
    this.popFlashMesh.visible = false;
  }

  private spawnPopBurst(power = 1.0): void {
    const ang = Math.random() * Math.PI * 2;
    const rad = 0.04 + Math.random() * 0.2;
    const originX = Math.cos(ang) * rad;
    const originY = 0.05 + Math.random() * 0.15;
    const originZ = Math.sin(ang) * rad;

    // Dominant upward-angled jet direction for this wood pop
    const jetAzimuth = Math.random() * Math.PI * 2;
    const jetTilt = 0.18 + Math.random() * 0.55;
    const jetDirX = Math.sin(jetTilt) * Math.cos(jetAzimuth);
    const jetDirY = Math.cos(jetTilt);
    const jetDirZ = Math.sin(jetTilt) * Math.sin(jetAzimuth);

    const count = Math.round((10 + Math.random() * 14) * power);
    let spawned = 0;

    for (let i = 0; i < this.sparks.length && spawned < count; i++) {
      const s = this.sparks[i];
      if (s.active) continue;

      s.active = true;
      s.pos.set(
        originX + (Math.random() - 0.5) * 0.04,
        originY + (Math.random() - 0.5) * 0.03,
        originZ + (Math.random() - 0.5) * 0.04
      );

      // Mix directional cone spray (~75%) with wide radial scatter (~25%)
      const isWide = Math.random() < 0.25;
      const spread = isWide ? 1.25 : 0.48;
      let vx = (isWide ? (Math.random() - 0.5) * 2.0 : jetDirX) + (Math.random() - 0.5) * spread;
      let vy = (isWide ? 0.35 + Math.random() * 0.9 : jetDirY) + (Math.random() - 0.5) * spread * 0.6;
      let vz = (isWide ? (Math.random() - 0.5) * 2.0 : jetDirZ) + (Math.random() - 0.5) * spread;
      const len = Math.hypot(vx, vy, vz) || 1;
      const speed = (1.2 + Math.random() * 2.2) * (0.8 + 0.25 * power);
      vx = (vx / len) * speed;
      vy = (vy / len) * speed;
      vz = (vz / len) * speed;

      s.vel.set(vx, vy, vz);
      s.age = 0;
      s.maxAge = 0.28 + Math.random() * 0.37;
      s.drag = 2.0 + Math.random() * 1.6;
      s.gravity = 2.2 + Math.random() * 1.0;
      s.swirlPhase = Math.random() * Math.PI * 2;
      s.swirlStrength = 0.8 + Math.random() * 1.8;

      spawned += 1;
    }

    this.popFlash = Math.min(1.3, this.popFlash + 0.85 * Math.min(1.25, power));
    this.popFlashMesh.position.set(originX, originY, originZ);
    this.popFlashMesh.scale.setScalar(0.65 + 0.35 * power);
    this.popFlashMesh.visible = true;

    const pan = Math.max(-0.85, Math.min(0.85, originX * 2.2));
    this.audio.playCampfireCrackle(this.currentIntensity * power, pan, true);
  }

  private updateSparks(dt: number, elapsed: number): void {
    const posArr = this.sparkPosAttr.array as Float32Array;
    const colArr = this.sparkColorAttr.array as Float32Array;
    let anyChanged = false;

    for (let i = 0; i < this.sparks.length; i++) {
      const s = this.sparks[i];
      const baseIdx = i * 6;

      if (!s.active) {
        if (posArr[baseIdx] !== 0 || posArr[baseIdx + 1] !== 0 || posArr[baseIdx + 3] !== 0) {
          posArr[baseIdx] = 0;
          posArr[baseIdx + 1] = 0;
          posArr[baseIdx + 2] = 0;
          posArr[baseIdx + 3] = 0;
          posArr[baseIdx + 4] = 0;
          posArr[baseIdx + 5] = 0;
          colArr[baseIdx] = 0;
          colArr[baseIdx + 1] = 0;
          colArr[baseIdx + 2] = 0;
          colArr[baseIdx + 3] = 0;
          colArr[baseIdx + 4] = 0;
          colArr[baseIdx + 5] = 0;
          anyChanged = true;
        }
        continue;
      }

      anyChanged = true;
      s.age += dt;
      if (s.age >= s.maxAge) {
        s.active = false;
        posArr[baseIdx] = 0;
        posArr[baseIdx + 1] = 0;
        posArr[baseIdx + 2] = 0;
        posArr[baseIdx + 3] = 0;
        posArr[baseIdx + 4] = 0;
        posArr[baseIdx + 5] = 0;
        colArr[baseIdx] = 0;
        colArr[baseIdx + 1] = 0;
        colArr[baseIdx + 2] = 0;
        colArr[baseIdx + 3] = 0;
        colArr[baseIdx + 4] = 0;
        colArr[baseIdx + 5] = 0;
        continue;
      }

      const damp = Math.exp(-s.drag * dt);
      s.vel.multiplyScalar(damp);
      s.vel.y += (-s.gravity + 0.65 * this.currentIntensity) * dt;
      s.vel.x += Math.sin(elapsed * 9.5 + s.swirlPhase) * s.swirlStrength * dt;
      s.vel.z += Math.cos(elapsed * 8.4 + s.swirlPhase * 1.3) * s.swirlStrength * dt;

      s.pos.addScaledVector(s.vel, dt);
      if (s.pos.y < -0.02) {
        s.pos.y = -0.02;
        s.vel.y = Math.abs(s.vel.y) * 0.25;
        s.vel.x *= 0.65;
        s.vel.z *= 0.65;
      }

      const speed = s.vel.length();
      const streakLen = Math.min(0.055, 0.022 + speed * 0.011);
      const invSpeed = speed > 0.001 ? 1 / speed : 0;

      // Head vertex
      posArr[baseIdx] = s.pos.x;
      posArr[baseIdx + 1] = s.pos.y;
      posArr[baseIdx + 2] = s.pos.z;
      // Tail vertex trailing behind velocity
      posArr[baseIdx + 3] = s.pos.x - s.vel.x * invSpeed * streakLen;
      posArr[baseIdx + 4] = s.pos.y - s.vel.y * invSpeed * streakLen;
      posArr[baseIdx + 5] = s.pos.z - s.vel.z * invSpeed * streakLen;

      const t = s.age / s.maxAge;
      const fade = Math.pow(1.0 - t, 1.35) * Math.min(1.0, s.age * 35.0);

      // Color cools from white-yellow -> bright orange -> deep red
      let hr: number;
      let hg: number;
      let hb: number;
      if (t < 0.35) {
        const k = t / 0.35;
        hr = 1.0;
        hg = 0.95 - k * 0.42;
        hb = 0.72 - k * 0.6;
      } else {
        const k = (t - 0.35) / 0.65;
        hr = 1.0 - k * 0.18;
        hg = 0.53 - k * 0.4;
        hb = 0.12 - k * 0.1;
      }

      colArr[baseIdx] = hr * fade;
      colArr[baseIdx + 1] = hg * fade;
      colArr[baseIdx + 2] = hb * fade;

      colArr[baseIdx + 3] = hr * fade * 0.48;
      colArr[baseIdx + 4] = hg * fade * 0.32;
      colArr[baseIdx + 5] = hb * fade * 0.2;
    }

    if (anyChanged) {
      this.sparkPosAttr.needsUpdate = true;
      this.sparkColorAttr.needsUpdate = true;
    }
  }

  private stokeFire(): void {
    this.stokeBoost = Math.min(1.0, this.stokeBoost + 0.65);
    this.stokedCount += 1;
    this.audio.playSelect();
    this.spawnPopBurst(1.35);
    window.setTimeout(() => {
      if (this.group.visible) {
        this.spawnPopBurst(1.1);
      }
    }, 200);
    window.setTimeout(() => {
      if (this.group.visible) {
        this.spawnPopBurst(0.95);
      }
    }, 480);
  }

  private cycleFireLevel(): void {
    const order: FireLevel[] = ['low', 'medium', 'high'];
    const idx = order.indexOf(this.fireLevel);
    this.fireLevel = order[(idx + 1) % order.length];
    this.btnLevel.setLabel(`火加減: ${FIRE_LEVEL_CONFIG[this.fireLevel].label}`);
    this.audio.playSelect();
  }

  private applyEnvironmentVisibility(): void {
    this.envGroup.visible = this.showEnvironment;
    this.btnEnv.setLabel(`背景: ${this.showEnvironment ? 'ON' : 'OFF'}`);
    this.btnEnv.setActive(this.showEnvironment);
  }

  public start(_difficulty: Difficulty, headPos: THREE.Vector3, headQuat: THREE.Quaternion): void {
    this.elapsedInMode = 0;
    this.stokeBoost = 0;
    this.stokedCount = 0;
    this.crackleTimer = 0.5;
    this.popBurstTimer = 1.1;
    this.audioIntensityTimer = 0;
    this.fireLevel = 'medium';
    this.btnLevel.setLabel(`火加減: ${FIRE_LEVEL_CONFIG[this.fireLevel].label}`);
    this.resetSparks();

    this.recenter(headPos, headQuat);

    const isMR = this.getDisplayMode() === 'mr';
    this.showEnvironment = !isMR;
    this.applyEnvironmentVisibility();
    this.setUiHidden(false);

    this.currentIntensity = FIRE_LEVEL_CONFIG[this.fireLevel].intensity;
    this.audio.startCampfireAmbient(this.currentIntensity);
    this.group.visible = true;
  }

  public recenter(headPos: THREE.Vector3, headQuat: THREE.Quaternion): void {
    const euler = new THREE.Euler().setFromQuaternion(headQuat, 'YXZ');
    this.arena.position.copy(headPos);
    this.arena.rotation.set(0, euler.y, 0);
  }

  public stop(): TrainingResult {
    this.audio.stopCampfireAmbient();
    this.resetSparks();
    this.setUiHidden(false);
    this.group.visible = false;

    const durationSec = Math.max(1, Math.round(this.elapsedInMode));
    const mins = Math.floor(durationSec / 60);
    const secs = durationSec % 60;
    return {
      modeId: this.id,
      durationSec,
      summary: `たき火を鑑賞 (${mins}分${secs}秒 | 薪くべ ${this.stokedCount}回)`
    };
  }

  public update(dt: number, elapsed: number): boolean {
    this.elapsedInMode += dt;

    if (this.stokeBoost > 0) {
      // Gently fade stoke boost over ~12 seconds
      this.stokeBoost = Math.max(0, this.stokeBoost - dt / 12.0);
    }

    const levelCfg = FIRE_LEVEL_CONFIG[this.fireLevel];
    const targetIntensity = levelCfg.intensity + this.stokeBoost * 0.6;
    this.currentIntensity += (targetIntensity - this.currentIntensity) * Math.min(1, dt * 3.0);

    if (this.popFlash > 0) {
      this.popFlash = Math.max(0, this.popFlash - dt * 11.0);
      this.popFlashMat.uniforms.uFlash.value = this.popFlash;
      if (this.popFlash <= 0.001) {
        this.popFlash = 0;
        this.popFlashMesh.visible = false;
      }
    }

    // 1/f-like organic flicker from multiple non-harmonic frequencies
    const flicker =
      0.86 +
      0.11 * Math.sin(elapsed * 7.3) +
      0.07 * Math.sin(elapsed * 13.7 + 1.2) +
      0.05 * Math.cos(elapsed * 23.1 + 0.4);

    this.fireLight.intensity = (2.1 + this.currentIntensity * 1.15) * flicker + this.popFlash * 1.4;
    this.fireLight.position.set(
      Math.sin(elapsed * 5.1) * 0.025,
      0.26 + Math.sin(elapsed * 8.3) * 0.02 + this.currentIntensity * 0.04,
      Math.cos(elapsed * 4.4) * 0.025
    );

    // Shifting organic breeze affecting flame sway
    const windX =
      Math.sin(elapsed * 0.75) * 0.28 +
      Math.sin(elapsed * 1.9 + 0.8) * 0.16 +
      Math.cos(elapsed * 3.4) * 0.08;
    const windZ =
      Math.cos(elapsed * 0.63 + 0.4) * 0.24 +
      Math.sin(elapsed * 1.55 + 2.1) * 0.14;

    // Update shader uniforms
    this.skyMat.uniforms.uTime.value = elapsed;
    this.skyMat.uniforms.uIntensity.value = this.currentIntensity;
    this.starMat.uniforms.uTime.value = elapsed;
    this.groundMat.uniforms.uTime.value = elapsed;
    this.groundMat.uniforms.uIntensity.value = this.currentIntensity;
    this.groundMat.uniforms.uFlicker.value = flicker;
    this.logMat.uniforms.uTime.value = elapsed;
    this.logMat.uniforms.uIntensity.value = this.currentIntensity;
    this.logMat.uniforms.uFlicker.value = flicker;
    this.emberBedMat.uniforms.uTime.value = elapsed;
    this.emberBedMat.uniforms.uIntensity.value = this.currentIntensity;
    this.emberBedMat.uniforms.uFlicker.value = flicker;
    for (const fMat of this.flameMaterials) {
      fMat.uniforms.uTime.value = elapsed;
      fMat.uniforms.uIntensity.value = this.currentIntensity;
      (fMat.uniforms.uWind.value as THREE.Vector2).set(windX, windZ);
      fMat.uniforms.uPop.value = this.popFlash;
    }
    this.embersMat.uniforms.uTime.value = elapsed;
    this.embersMat.uniforms.uIntensity.value = this.currentIntensity;
    this.smokeMat.uniforms.uTime.value = elapsed;
    this.smokeMat.uniforms.uIntensity.value = this.currentIntensity;

    // Periodic ambient audio intensity update
    this.audioIntensityTimer += dt;
    if (this.audioIntensityTimer >= 0.25) {
      this.audioIntensityTimer = 0;
      this.audio.setCampfireIntensity(this.currentIntensity);
    }

    // Procedural crackling sparks (ambient light pops + larger streak bursts)
    this.crackleTimer -= dt * (levelCfg.crackleRate + this.stokeBoost * 1.4);
    if (this.crackleTimer <= 0) {
      this.audio.playCampfireCrackle(this.currentIntensity, (Math.random() - 0.5) * 0.35);
      this.crackleTimer = 0.28 + Math.random() * 1.15;
    }

    this.popBurstTimer -= dt * (levelCfg.crackleRate + this.stokeBoost * 1.8);
    if (this.popBurstTimer <= 0) {
      this.spawnPopBurst(0.85 + Math.random() * 0.45);
      this.popBurstTimer = 1.4 + Math.random() * 2.2;
    }

    this.updateSparks(dt, elapsed);

    return true;
  }

  public getInteractiveObjects(): THREE.Object3D[] {
    if (this.uiChrome.isHidden()) {
      return [this.uiChrome.showBtn.mesh];
    }
    return [this.btnStoke.mesh, this.btnLevel.mesh, this.btnEnv.mesh];
  }

  public onObjectSelected(_obj: THREE.Object3D): void {
    // Button callbacks handle interaction directly via InputManager
  }

  public getHUDState(): TrainingHUDState {
    const mins = Math.floor(this.elapsedInMode / 60);
    const secs = Math.floor(this.elapsedInMode % 60);
    return {
      title: this.name,
      instruction: '揺らめく炎と音に身を委ねてリラックスしましょう（UIを隠すと炎だけを楽しめます）',
      remainingSeconds: -1,
      metricLabel: `火加減: ${FIRE_LEVEL_CONFIG[this.fireLevel].label} · ${mins}分${secs}秒`
    };
  }

  public isUiHidden(): boolean {
    return this.uiChrome.isHidden();
  }

  public setUiHidden(hidden: boolean): void {
    this.uiChrome.setHidden(hidden);
    if (hidden) {
      const showBtnMat = this.uiChrome.showBtn.mesh.material as THREE.MeshBasicMaterial;
      showBtnMat.opacity = 0.22;
    }
  }
}
