import * as THREE from 'three';

export interface SoftOrbHandle {
  group: THREE.Group;
  core: THREE.Mesh;
  glow: THREE.Mesh;
  shell: THREE.Mesh;
  setColor: (hex: number) => void;
  update: (dt: number) => void;
}

const ORB_VERT = /* glsl */ `
  varying vec3 vNormalView;
  varying vec3 vViewDir;
  varying vec3 vLocalPos;

  void main() {
    vLocalPos = position;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vNormalView = normalize(normalMatrix * normal);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const ORB_CORE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uOpacity;

  varying vec3 vNormalView;
  varying vec3 vViewDir;
  varying vec3 vLocalPos;

  void main() {
    float ndv = clamp(dot(normalize(vNormalView), normalize(vViewDir)), 0.0, 1.0);
    float core = pow(ndv, 1.35);
    float rim = pow(1.0 - ndv, 2.2);
    float wave = 0.5 + 0.5 * sin(vLocalPos.y * 18.0 - uTime * 2.4 + sin(vLocalPos.x * 14.0 + uTime * 1.6));
    vec3 hotCore = mix(uColor, vec3(1.0), 0.42 * core + 0.14 * wave);
    vec3 col = hotCore + uColor * rim * 0.65;
    float alpha = (0.82 + 0.16 * core) * uOpacity;
    gl_FragColor = vec4(col, alpha);
  }
`;

const ORB_FRESNEL_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uPower;
  uniform float uBaseAlpha;

  varying vec3 vNormalView;
  varying vec3 vViewDir;
  varying vec3 vLocalPos;

  void main() {
    float ndv = clamp(abs(dot(normalize(vNormalView), normalize(vViewDir))), 0.0, 1.0);
    float fresnel = pow(1.0 - ndv, uPower);
    float shimmer = 0.9 + 0.1 * sin(uTime * 1.8 + vLocalPos.y * 12.0);
    vec3 col = mix(uColor, vec3(0.95, 1.0, 1.0), fresnel * 0.35);
    float alpha = (uBaseAlpha * 0.35 + fresnel * uBaseAlpha) * shimmer * uOpacity;
    gl_FragColor = vec4(col, alpha);
  }
`;

const TRAIL_VERT = /* glsl */ `
  attribute float aAge;
  uniform float uSize;
  varying float vAge;

  void main() {
    vAge = aAge;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPos;
    float taper = mix(1.0, 0.18, aAge);
    float dist = max(0.35, -mvPos.z);
    gl_PointSize = clamp(uSize * taper * (280.0 / dist), 2.0, 72.0);
  }
`;

const TRAIL_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAge;

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv);
    if (d > 0.5) discard;
    float radial = pow(1.0 - d * 2.0, 2.0);
    float fade = pow(clamp(1.0 - vAge, 0.0, 1.0), 1.65);
    vec3 col = mix(uColor, vec3(1.0), radial * (1.0 - vAge) * 0.45);
    gl_FragColor = vec4(col, radial * fade * 0.72 * uOpacity);
  }
`;

/** Soft glowing orb used as a calm training target. */
export function createSoftOrb(color: number, radius = 0.12): SoftOrbHandle {
  const group = new THREE.Group();
  const sharedColor = new THREE.Color(color);

  const coreMat = new THREE.ShaderMaterial({
    vertexShader: ORB_VERT,
    fragmentShader: ORB_CORE_FRAG,
    transparent: true,
    uniforms: {
      uColor: { value: sharedColor },
      uTime: { value: 0 },
      uOpacity: { value: 1.0 }
    }
  });
  // Expose .color alias for callers that tint core.material.color directly.
  Object.defineProperty(coreMat, 'color', {
    get: () => sharedColor
  });
  const core = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.55, 28, 28), coreMat);
  group.add(core);

  const shellMat = new THREE.ShaderMaterial({
    vertexShader: ORB_VERT,
    fragmentShader: ORB_FRESNEL_FRAG,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: sharedColor },
      uTime: { value: 0 },
      uOpacity: { value: 1.0 },
      uPower: { value: 2.1 },
      uBaseAlpha: { value: 0.36 }
    }
  });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 32), shellMat);
  group.add(shell);

  const glowMat = new THREE.ShaderMaterial({
    vertexShader: ORB_VERT,
    fragmentShader: ORB_FRESNEL_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    uniforms: {
      uColor: { value: sharedColor },
      uTime: { value: 0 },
      uOpacity: { value: 1.0 },
      uPower: { value: 2.8 },
      uBaseAlpha: { value: 0.45 }
    }
  });
  const glow = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.6, 24, 24), glowMat);
  group.add(glow);

  const setColor = (hex: number) => {
    sharedColor.setHex(hex);
  };

  const update = (dt: number) => {
    coreMat.uniforms.uTime.value += dt;
    shellMat.uniforms.uTime.value += dt;
    glowMat.uniforms.uTime.value += dt;
  };

  return { group, core, glow, shell, setColor, update };
}

export interface MotionTrailHandle {
  points: THREE.Points;
  positions: Float32Array;
  push: (x: number, y: number, z: number) => void;
  reset: (x?: number, y?: number, z?: number) => void;
}

export function createMotionTrail(color: number, count = 14): MotionTrailHandle {
  const positions = new Float32Array(count * 3);
  const ages = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    ages[i] = 1.0;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aAge', new THREE.BufferAttribute(ages, 1));

  const mat = new THREE.ShaderMaterial({
    vertexShader: TRAIL_VERT,
    fragmentShader: TRAIL_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uSize: { value: 0.095 },
      uOpacity: { value: 1.0 }
    }
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;

  let initialized = false;
  let lastX = 0;
  let lastY = 0;
  let lastZ = 0;

  const reset = (x = 0, y = 0, z = 0) => {
    for (let i = 0; i < count; i++) {
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      ages[i] = i / Math.max(1, count - 1);
    }
    lastX = x;
    lastY = y;
    lastZ = z;
    initialized = true;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aAge.needsUpdate = true;
  };

  const push = (x: number, y: number, z: number) => {
    const dx = x - lastX;
    const dy = y - lastY;
    const dz = z - lastZ;
    // Reset trail if target teleports (e.g. pattern switch or mode start).
    if (!initialized || dx * dx + dy * dy + dz * dz > 0.35 * 0.35) {
      reset(x, y, z);
      return;
    }

    // Shift older samples back so index 0 is always the newest head.
    for (let i = count - 1; i > 0; i--) {
      positions[i * 3] = positions[(i - 1) * 3];
      positions[i * 3 + 1] = positions[(i - 1) * 3 + 1];
      positions[i * 3 + 2] = positions[(i - 1) * 3 + 2];
      ages[i] = i / Math.max(1, count - 1);
    }
    positions[0] = x;
    positions[1] = y;
    positions[2] = z;
    ages[0] = 0;

    lastX = x;
    lastY = y;
    lastZ = z;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aAge.needsUpdate = true;
  };

  return { points, positions, push, reset };
}
