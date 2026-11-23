import * as THREE from 'three';

export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];

export type AquaticCategory =
  | 'tropical_fish'
  | 'koi'
  | 'turtle'
  | 'manta'
  | 'jellyfish'
  | 'seahorse'
  | 'squid'
  | 'vallisneria'
  | 'stem_plant'
  | 'broadleaf_coral';

export interface GeneratedAquaticMesh {
  geometry: THREE.BufferGeometry;
  triCount: number;
  name: string;
  category: AquaticCategory;
  animMode: number;
  sss: number;
  accent: Vec3;
}

export const SANCTUARY_RADIUS = 9.0;
export const SANCTUARY_WATER_Y = 2.4;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hslToRgb(h: number, s: number, l: number): Vec3 {
  const hh = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => {
    const k = (n + hh * 12) % 12;
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return [f(0), f(8), f(4)];
}

const v3 = {
  add: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ],
  norm: (a: Vec3): Vec3 => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  lerp: (a: Vec3, b: Vec3, t: number): Vec3 => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  ]
};

export function sandHeight(x: number, z: number): number {
  const radial = Math.hypot(x, z);
  const bowlSlope = 0.04 * Math.max(0, radial - 3.5);
  const mound = 0.18 * Math.sin(x * 0.42 + 0.5) * Math.cos(z * 0.55);
  const ripple = 0.045 * Math.sin(x * 1.45 - z * 1.15);
  return -1.65 + bowlSlope + mound + ripple;
}

const FLOATS_PER_VERT = 13;

export class MeshBuilder {
  private verts: number[] = [];

  private pushVert(p: Vec3, n: Vec3, c: Vec3, m: Vec4): void {
    this.verts.push(
      p[0], p[1], p[2],
      n[0], n[1], n[2],
      c[0], c[1], c[2],
      m[0], m[1], m[2], m[3]
    );
  }

  public addTri(
    p1: Vec3, p2: Vec3, p3: Vec3,
    c1: Vec3, c2: Vec3, c3: Vec3,
    m1: Vec4, m2: Vec4, m3: Vec4,
    flip = false
  ): void {
    const e1 = v3.sub(p2, p1);
    const e2 = v3.sub(p3, p1);
    let n = v3.norm(v3.cross(e1, e2));
    if (flip) n = v3.mul(n, -1);
    if (flip) {
      this.pushVert(p1, n, c1, m1);
      this.pushVert(p3, n, c3, m3);
      this.pushVert(p2, n, c2, m2);
    } else {
      this.pushVert(p1, n, c1, m1);
      this.pushVert(p2, n, c2, m2);
      this.pushVert(p3, n, c3, m3);
    }
  }

  public addQuad(
    p1: Vec3, p2: Vec3, p3: Vec3, p4: Vec3,
    c1: Vec3, c2: Vec3, c3: Vec3, c4: Vec3,
    m1: Vec4, m2: Vec4, m3: Vec4, m4: Vec4
  ): void {
    this.addTri(p1, p2, p3, c1, c2, c3, m1, m2, m3);
    this.addTri(p1, p3, p4, c1, c3, c4, m1, m3, m4);
  }

  public addLoft(
    rings: Vec3[][],
    colorFn: (t: number, u: number) => Vec3,
    metaFn: (t: number, u: number) => Vec4,
    closeStart = false,
    closeEnd = false
  ): void {
    const nRings = rings.length;
    const segs = rings[0].length;
    for (let i = 0; i < nRings - 1; i++) {
      const t0 = i / (nRings - 1);
      const t1 = (i + 1) / (nRings - 1);
      for (let j = 0; j < segs; j++) {
        const jn = (j + 1) % segs;
        const u0 = j / segs;
        const u1 = (j + 1) / segs;
        this.addQuad(
          rings[i][j], rings[i][jn], rings[i + 1][jn], rings[i + 1][j],
          colorFn(t0, u0), colorFn(t0, u1), colorFn(t1, u1), colorFn(t1, u0),
          metaFn(t0, u0), metaFn(t0, u1), metaFn(t1, u1), metaFn(t1, u0)
        );
      }
    }
    if (closeStart) {
      let center: Vec3 = [0, 0, 0];
      for (const p of rings[0]) center = v3.add(center, p);
      center = v3.mul(center, 1 / segs);
      for (let j = 0; j < segs; j++) {
        const jn = (j + 1) % segs;
        this.addTri(
          center, rings[0][jn], rings[0][j],
          colorFn(0, 0.5), colorFn(0, (j + 1) / segs), colorFn(0, j / segs),
          metaFn(0, 0.5), metaFn(0, (j + 1) / segs), metaFn(0, j / segs)
        );
      }
    }
    if (closeEnd) {
      const last = rings[nRings - 1];
      let center: Vec3 = [0, 0, 0];
      for (const p of last) center = v3.add(center, p);
      center = v3.mul(center, 1 / segs);
      for (let j = 0; j < segs; j++) {
        const jn = (j + 1) % segs;
        this.addTri(
          center, last[j], last[jn],
          colorFn(1, 0.5), colorFn(1, j / segs), colorFn(1, (j + 1) / segs),
          metaFn(1, 0.5), metaFn(1, j / segs), metaFn(1, (j + 1) / segs)
        );
      }
    }
  }

  public addTube(
    points: Vec3[],
    radii: number[],
    segs: number,
    colorFn: (t: number, u: number) => Vec3,
    metaFn: (t: number, u: number) => Vec4,
    capStart = true,
    capEnd = true
  ): void {
    const rings: Vec3[][] = [];
    let prevUp: Vec3 = [0, 1, 0];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const tan = i === 0
        ? v3.norm(v3.sub(points[1], points[0]))
        : i === points.length - 1
          ? v3.norm(v3.sub(points[i], points[i - 1]))
          : v3.norm(v3.sub(points[i + 1], points[i - 1]));

      if (Math.abs(v3.dot(tan, prevUp)) > 0.96) {
        prevUp = Math.abs(tan[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
      }
      const right = v3.norm(v3.cross(prevUp, tan));
      const up = v3.norm(v3.cross(tan, right));
      prevUp = up;

      const r = radii[i];
      const ring: Vec3[] = [];
      for (let j = 0; j < segs; j++) {
        const ang = (j / segs) * Math.PI * 2;
        const ca = Math.cos(ang) * r;
        const sa = Math.sin(ang) * r;
        ring.push([
          p[0] + right[0] * ca + up[0] * sa,
          p[1] + right[1] * ca + up[1] * sa,
          p[2] + right[2] * ca + up[2] * sa
        ]);
      }
      rings.push(ring);
    }
    this.addLoft(rings, colorFn, metaFn, capStart, capEnd);
  }

  public addLeafBlade(
    points: Vec3[],
    widths: number[],
    normalHint: Vec3 | null,
    colorFn: (t: number, u: number) => Vec3,
    metaFn: (t: number, u: number) => Vec4,
    crease = 0.08
  ): void {
    const rows: Vec3[][] = [];
    let prevHint: Vec3 = normalHint ?? [0, 0, 1];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const tan = i === 0
        ? v3.norm(v3.sub(points[1], points[0]))
        : i === points.length - 1
          ? v3.norm(v3.sub(points[i], points[i - 1]))
          : v3.norm(v3.sub(points[i + 1], points[i - 1]));
      let hint = prevHint;
      if (Math.abs(v3.dot(tan, hint)) > 0.95) {
        hint = Math.abs(tan[0]) < 0.85 ? [1, 0, 0] : [0, 1, 0];
      }
      const side = v3.norm(v3.cross(hint, tan));
      const up = v3.norm(v3.cross(tan, side));
      prevHint = up;
      const w = widths[i];
      rows.push([
        v3.sub(p, v3.mul(side, w)),
        v3.add(p, v3.mul(up, w * crease)),
        v3.add(p, v3.mul(side, w))
      ]);
    }
    for (let i = 0; i < rows.length - 1; i++) {
      const t0 = i / (rows.length - 1);
      const t1 = (i + 1) / (rows.length - 1);
      this.addQuad(
        rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0],
        colorFn(t0, 0), colorFn(t0, 0.5), colorFn(t1, 0.5), colorFn(t1, 0),
        metaFn(t0, 0), metaFn(t0, 0.5), metaFn(t1, 0.5), metaFn(t1, 0)
      );
      this.addQuad(
        rows[i][1], rows[i][2], rows[i + 1][2], rows[i + 1][1],
        colorFn(t0, 0.5), colorFn(t0, 1), colorFn(t1, 1), colorFn(t1, 0.5),
        metaFn(t0, 0.5), metaFn(t0, 1), metaFn(t1, 1), metaFn(t1, 0.5)
      );
    }
  }

  public addEllipsoid(
    center: Vec3,
    rx: number,
    ry: number,
    rz: number,
    segsU: number,
    segsV: number,
    colorFn: (v: number, u: number) => Vec3,
    metaFn: (v: number, u: number) => Vec4,
    displaceFn: ((nx: number, ny: number, nz: number) => number) | null = null
  ): void {
    const rings: Vec3[][] = [];
    for (let iv = 0; iv <= segsV; iv++) {
      const v = iv / segsV;
      const phi = v * Math.PI;
      const sp = Math.sin(phi);
      const cp = Math.cos(phi);
      const ring: Vec3[] = [];
      for (let iu = 0; iu < segsU; iu++) {
        const u = iu / segsU;
        const theta = u * Math.PI * 2;
        const nx = sp * Math.cos(theta);
        const ny = cp;
        const nz = sp * Math.sin(theta);
        const disp = displaceFn ? displaceFn(nx, ny, nz) : 1.0;
        ring.push([
          center[0] + nx * rx * disp,
          center[1] + ny * ry * disp,
          center[2] + nz * rz * disp
        ]);
      }
      rings.push(ring);
    }
    this.addLoft(rings, colorFn, metaFn, false, false);
  }

  public addPrism(
    base: Vec3,
    dir: Vec3,
    len: number,
    rBot: number,
    rTop: number,
    sides: number,
    tipH: number,
    colorBot: Vec3,
    colorTop: Vec3,
    metaBot: Vec4,
    metaTop: Vec4
  ): void {
    const d = v3.norm(dir);
    const ref: Vec3 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const right = v3.norm(v3.cross(ref, d));
    const up = v3.norm(v3.cross(d, right));
    const topCenter = v3.add(base, v3.mul(d, len));
    const tip = v3.add(topCenter, v3.mul(d, tipH));

    const ringB: Vec3[] = [];
    const ringT: Vec3[] = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const off: Vec3 = [
        right[0] * ca + up[0] * sa,
        right[1] * ca + up[1] * sa,
        right[2] * ca + up[2] * sa
      ];
      ringB.push(v3.add(base, v3.mul(off, rBot)));
      ringT.push(v3.add(topCenter, v3.mul(off, rTop)));
    }
    for (let i = 0; i < sides; i++) {
      const inx = (i + 1) % sides;
      this.addQuad(
        ringB[i], ringB[inx], ringT[inx], ringT[i],
        colorBot, colorBot, colorTop, colorTop,
        metaBot, metaBot, metaTop, metaTop
      );
      if (tipH > 0.001) {
        this.addTri(
          ringT[i], ringT[inx], tip,
          colorTop, colorTop, colorTop,
          metaTop, metaTop, metaTop
        );
      } else {
        this.addTri(
          ringT[i], ringT[inx], topCenter,
          colorTop, colorTop, colorTop,
          metaTop, metaTop, metaTop
        );
      }
      this.addTri(
        ringB[inx], ringB[i], base,
        colorBot, colorBot, colorBot,
        metaBot, metaBot, metaBot
      );
    }
  }

  public toBufferGeometry(
    smoothNormals = true,
    anchorBottom = false,
    normalizeScale = true
  ): { geometry: THREE.BufferGeometry; triCount: number } {
    const arr = new Float32Array(this.verts);
    const vertCount = arr.length / FLOATS_PER_VERT;

    if (normalizeScale && vertCount > 0) {
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (let i = 0; i < arr.length; i += FLOATS_PER_VERT) {
        const x = arr[i], y = arr[i + 1], z = arr[i + 2];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
      const cx = (minX + maxX) * 0.5;
      const cy = (minY + maxY) * 0.5;
      const cz = (minZ + maxZ) * 0.5;
      const yOff = anchorBottom ? minY : cy;
      const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 0.001);
      const scale = 2.85 / span;
      for (let i = 0; i < arr.length; i += FLOATS_PER_VERT) {
        arr[i] = (arr[i] - cx) * scale;
        arr[i + 1] = (arr[i + 1] - yOff) * scale;
        arr[i + 2] = (arr[i + 2] - cz) * scale;
      }
    }

    if (smoothNormals && vertCount > 0) {
      const accum = new Map<string, Vec3>();
      for (let i = 0; i < arr.length; i += FLOATS_PER_VERT) {
        const key = `${Math.round(arr[i] * 400)}_${Math.round(arr[i + 1] * 400)}_${Math.round(arr[i + 2] * 400)}`;
        let n = accum.get(key);
        if (!n) {
          n = [0, 0, 0];
          accum.set(key, n);
        }
        n[0] += arr[i + 3];
        n[1] += arr[i + 4];
        n[2] += arr[i + 5];
      }
      for (const n of accum.values()) {
        const l = Math.hypot(n[0], n[1], n[2]) || 1;
        n[0] /= l;
        n[1] /= l;
        n[2] /= l;
      }
      for (let i = 0; i < arr.length; i += FLOATS_PER_VERT) {
        const key = `${Math.round(arr[i] * 400)}_${Math.round(arr[i + 1] * 400)}_${Math.round(arr[i + 2] * 400)}`;
        const n = accum.get(key);
        if (n) {
          arr[i + 3] = n[0];
          arr[i + 4] = n[1];
          arr[i + 5] = n[2];
        }
      }
    }

    const pos = new Float32Array(vertCount * 3);
    const norm = new Float32Array(vertCount * 3);
    const col = new Float32Array(vertCount * 3);
    const attrs = new Float32Array(vertCount * 4);

    for (let i = 0; i < vertCount; i++) {
      const base = i * FLOATS_PER_VERT;
      const i3 = i * 3;
      const i4 = i * 4;
      pos[i3] = arr[base];
      pos[i3 + 1] = arr[base + 1];
      pos[i3 + 2] = arr[base + 2];

      norm[i3] = arr[base + 3];
      norm[i3 + 1] = arr[base + 4];
      norm[i3 + 2] = arr[base + 5];

      col[i3] = arr[base + 6];
      col[i3 + 1] = arr[base + 7];
      col[i3 + 2] = arr[base + 8];

      attrs[i4] = arr[base + 9];
      attrs[i4 + 1] = arr[base + 10];
      attrs[i4 + 2] = arr[base + 11];
      attrs[i4 + 3] = arr[base + 12];
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geometry.setAttribute('aAttrs', new THREE.BufferAttribute(attrs, 4));
    geometry.computeBoundingSphere();

    return { geometry, triCount: Math.floor(vertCount / 3) };
  }
}

const NAME_PREFIX = [
  'Coral', 'Azure', 'Emerald', 'Pearl', 'Golden', 'Jade',
  'Silver', 'Reef', 'Lagoon', 'Sakura', 'Cobalt', 'Amber'
];

export const GROUNDED_CATEGORIES = new Set<AquaticCategory>([
  'vallisneria',
  'stem_plant',
  'broadleaf_coral'
]);

export const DIRECTIONAL_CATEGORIES = new Set<AquaticCategory>([
  'tropical_fish',
  'koi',
  'turtle',
  'manta'
]);

export const SWIMMING_CATEGORIES: AquaticCategory[] = [
  'tropical_fish',
  'koi',
  'turtle',
  'manta',
  'jellyfish',
  'seahorse',
  'squid'
];

export const PLANT_CATEGORIES: AquaticCategory[] = [
  'vallisneria',
  'stem_plant',
  'broadleaf_coral'
];

type GeneratorFn = (rng: () => number) => GeneratedAquaticMesh;

export const AQUATIC_GENERATORS: Record<AquaticCategory, GeneratorFn> = {
  tropical_fish(rng) {
    const mb = new MeshBuilder();
    const speciesIdx = Math.floor(rng() * 4);
    const speciesNames = ['Clownfish', 'Regal Tang', 'Sunburst Butterfly', 'Cardinal Tetra'];
    const bodyLen = 1.85 + rng() * 0.4;
    const bodyH = speciesIdx === 2 ? 0.85 : speciesIdx === 3 ? 0.42 : 0.62;
    const bodyW = 0.22 + rng() * 0.06;

    const rings: Vec3[][] = [];
    const nSegs = 26, rSegs = 20;
    for (let i = 0; i < nSegs; i++) {
      const t = i / (nSegs - 1);
      const z = (0.5 - t) * bodyLen;
      const hEnv = Math.pow(Math.sin(Math.pow(t, 0.6) * Math.PI), 0.78);
      const wEnv = Math.sin(Math.pow(t, 0.52) * Math.PI);
      const peduncle = t > 0.78 ? 0.18 + 0.08 * (1 - (t - 0.78) / 0.22) : 1.0;
      const hh = 0.04 + bodyH * 0.5 * hEnv * (t > 0.78 ? 0.28 : 1.0);
      const hw = 0.025 + bodyW * wEnv * peduncle;
      const ring: Vec3[] = [];
      for (let j = 0; j < rSegs; j++) {
        const a = (j / rSegs) * Math.PI * 2;
        ring.push([Math.cos(a) * hw, Math.sin(a) * hh, z]);
      }
      rings.push(ring);
    }

    const fishCol = (t: number, u: number): Vec3 => {
      const belly = Math.sin(u * Math.PI * 2) < -0.25;
      if (speciesIdx === 0) {
        const d = Math.min(Math.abs(t - 0.28), Math.abs(t - 0.58), Math.abs(t - 0.84));
        if (d < 0.055) return [0.96, 0.96, 0.95];
        if (d < 0.075) return [0.06, 0.05, 0.05];
        return [0.95, 0.34, 0.07];
      }
      if (speciesIdx === 1) {
        if (t > 0.82) return [0.96, 0.82, 0.12];
        if (Math.sin(u * Math.PI * 2) > 0.35 && t > 0.22 && t < 0.78) return [0.06, 0.09, 0.16];
        return [0.08, 0.32, 0.86];
      }
      if (speciesIdx === 2) {
        if (Math.abs(t - 0.18) < 0.055) return [0.08, 0.08, 0.1];
        if (t > 0.76) return [0.96, 0.65, 0.1];
        return belly ? [0.95, 0.92, 0.82] : [0.95, 0.76, 0.18];
      }
      if (Math.sin(u * Math.PI * 2) > 0.15) return [0.08, 0.78, 0.92];
      return t > 0.32 ? [0.88, 0.14, 0.18] : [0.85, 0.9, 0.94];
    };

    mb.addLoft(
      rings,
      fishCol,
      (t) => [0.0, Math.pow(t, 1.35), 0.0, speciesIdx === 3 ? 0.65 : 0.38],
      true,
      true
    );

    for (const side of [-1, 1]) {
      mb.addEllipsoid(
        [side * bodyW * 0.56, bodyH * 0.1, bodyLen * 0.33],
        0.045, 0.055, 0.055, 10, 8,
        (v) => (v < 0.38 ? [0.03, 0.03, 0.04] : [0.88, 0.84, 0.68]),
        () => [0, 0.05, 0, 0.95]
      );
    }

    const dPts: Vec3[] = [];
    const dW: number[] = [];
    for (let i = 0; i < 10; i++) {
      const st = i / 9;
      dPts.push([0, bodyH * 0.42 * (1 - st * 0.35), bodyLen * (0.12 - st * 0.54)]);
      dW.push(0.14 + 0.16 * Math.sin(st * Math.PI));
    }
    mb.addLeafBlade(
      dPts, dW, [1, 0, 0],
      () => (speciesIdx === 1 ? [0.08, 0.25, 0.75] : [0.95, 0.58, 0.18]),
      (t) => [0, 0.35 + t * 0.4, 0, 0.2], 0.04
    );

    const cPts: Vec3[] = [];
    const cW: number[] = [];
    for (let i = 0; i < 8; i++) {
      const st = i / 7;
      cPts.push([0, 0, -bodyLen * 0.46 - st * 0.44]);
      cW.push(0.08 + st * 0.32);
    }
    mb.addLeafBlade(
      cPts, cW, [1, 0, 0],
      () => (speciesIdx === 1 ? [0.96, 0.84, 0.15] : [0.95, 0.72, 0.35]),
      (t) => [0, 0.85 + t * 0.35, 0, 0.2], 0.02
    );

    for (const side of [-1, 1]) {
      mb.addLeafBlade(
        [
          [side * bodyW * 0.7, -0.05, bodyLen * 0.16],
          [side * (bodyW + 0.22), -0.1, bodyLen * 0.04],
          [side * (bodyW + 0.34), -0.14, -bodyLen * 0.08]
        ],
        [0.05, 0.11, 0.07],
        [0, 1, 0],
        () => [0.92, 0.78, 0.48],
        (t) => [0, 0.2 + t * 0.35, side, 0.15], 0.03
      );
    }

    const built = mb.toBufferGeometry(true, false, true);
    return {
      geometry: built.geometry,
      triCount: built.triCount,
      name: `${NAME_PREFIX[Math.floor(rng() * NAME_PREFIX.length)]} ${speciesNames[speciesIdx]}`,
      category: 'tropical_fish',
      animMode: 4,
      sss: 0.38,
      accent: [0.3, 0.85, 0.9]
    };
  },

  koi(rng) {
    const mb = new MeshBuilder();
    const bodyLen = 2.25 + rng() * 0.45;
    const bodyH = 0.54;
    const bodyW = 0.34;
    const seedOff = rng() * 20.0;
    const hasSumi = rng() > 0.35;

    const rings: Vec3[][] = [];
    const nSegs = 30, rSegs = 22;
    for (let i = 0; i < nSegs; i++) {
      const t = i / (nSegs - 1);
      const z = (0.5 - t) * bodyLen;
      const env = Math.sin(Math.pow(t, 0.56) * Math.PI);
      const hh = 0.04 + bodyH * 0.5 * env * (t > 0.8 ? 0.35 : 1.0);
      const hw = 0.03 + bodyW * 0.55 * env * (t > 0.8 ? 0.3 : 1.0);
      const ring: Vec3[] = [];
      for (let j = 0; j < rSegs; j++) {
        const a = (j / rSegs) * Math.PI * 2;
        ring.push([Math.cos(a) * hw, Math.sin(a) * hh, z]);
      }
      rings.push(ring);
    }

    const koiColor = (t: number, u: number): Vec3 => {
      const ang = u * Math.PI * 2;
      if (Math.sin(ang) < -0.45) return [0.95, 0.94, 0.91];
      const patch =
        Math.sin(t * 7.5 + seedOff) * Math.cos(ang * 2.0 + seedOff * 0.7) +
        0.45 * Math.sin(t * 14.0 - ang * 3.0);
      if (hasSumi && patch < -0.58) return [0.09, 0.09, 0.11];
      if (patch > 0.12) return [0.92, 0.26, 0.08];
      return [0.96, 0.94, 0.9];
    };

    mb.addLoft(rings, koiColor, (t) => [0.0, Math.pow(t, 1.3), 0.0, 0.32], true, true);

    for (const side of [-1, 1]) {
      mb.addEllipsoid(
        [side * bodyW * 0.42, bodyH * 0.1, bodyLen * 0.36],
        0.045, 0.05, 0.05, 10, 8,
        (v) => (v < 0.4 ? [0.03, 0.03, 0.04] : [0.85, 0.65, 0.25]),
        () => [0, 0.04, 0, 0.92]
      );
      mb.addTube(
        [
          [side * 0.08, -0.05, bodyLen * 0.46],
          [side * 0.16, -0.1, bodyLen * 0.42],
          [side * 0.2, -0.15, bodyLen * 0.36]
        ],
        [0.018, 0.012, 0.005], 5,
        () => [0.92, 0.62, 0.42],
        (t) => [0, 0.2 * t, side, 0.1]
      );
    }

    const tailPts: Vec3[] = [];
    const tailW: number[] = [];
    for (let i = 0; i < 10; i++) {
      const st = i / 9;
      tailPts.push([0, -st * 0.06, -bodyLen * 0.48 - st * 0.62]);
      tailW.push(0.08 + st * 0.42);
    }
    mb.addLeafBlade(
      tailPts, tailW, [1, 0, 0],
      (t) => [0.96, 0.65 - t * 0.2, 0.45 - t * 0.15],
      (t) => [0, 0.85 + t * 0.45, 0, 0.15], 0.03
    );

    for (const side of [-1, 1]) {
      mb.addLeafBlade(
        [
          [side * bodyW * 0.5, -0.07, bodyLen * 0.18],
          [side * (bodyW + 0.24), -0.12, bodyLen * 0.04],
          [side * (bodyW + 0.38), -0.16, -bodyLen * 0.12]
        ],
        [0.07, 0.15, 0.09],
        [0, 1, 0],
        () => [0.95, 0.88, 0.8],
        (t) => [0, 0.25 + t * 0.35, side, 0.15], 0.04
      );
    }

    const built = mb.toBufferGeometry(true, false, true);
    return {
      geometry: built.geometry,
      triCount: built.triCount,
      name: `${NAME_PREFIX[Math.floor(rng() * NAME_PREFIX.length)]} Nishikigoi`,
      category: 'koi',
      animMode: 4,
      sss: 0.42,
      accent: [0.95, 0.55, 0.25]
    };
  },

  turtle(rng) {
    const mb = new MeshBuilder();
    const hue = 0.22 + rng() * 0.12;
    const shellCol = hslToRgb(hue, 0.45, 0.28);
    const scuteRim = hslToRgb(hue - 0.08, 0.5, 0.44);
    const bellyCol: Vec3 = [0.84, 0.8, 0.65];
    const skinCol = hslToRgb(hue, 0.38, 0.34);

    mb.addEllipsoid(
      [0, 0.04, -0.05], 0.68, 0.34, 0.88, 28, 18,
      (v, u) => {
        if (v > 0.54) return bellyCol;
        const scute = Math.abs(Math.sin(v * Math.PI * 5) * Math.cos(u * Math.PI * 6));
        return scute < 0.16 ? scuteRim : shellCol;
      },
      () => [0, 0.05, 0, 0.28],
      (nx, ny, nz) => (ny < 0 ? 0.55 : 1.0 + 0.03 * Math.sin(nx * 10) * Math.cos(nz * 10))
    );

    mb.addTube(
      [[0, 0.02, 0.72], [0, 0.08, 0.98], [0, 0.09, 1.22]],
      [0.16, 0.15, 0.12], 12,
      () => skinCol,
      () => [0, 0.08, 0, 0.2]
    );
    for (const side of [-1, 1]) {
      mb.addEllipsoid(
        [side * 0.11, 0.13, 1.15], 0.038, 0.038, 0.038, 8, 6,
        () => [0.04, 0.04, 0.05],
        () => [0, 0.08, 0, 0.9]
      );
    }

    for (const side of [-1, 1]) {
      mb.addLeafBlade(
        [
          [side * 0.34, -0.02, 0.42],
          [side * 0.72, -0.04, 0.32],
          [side * 1.18, -0.06, 0.16],
          [side * 1.65, -0.08, -0.18]
        ],
        [0.18, 0.22, 0.19, 0.08],
        [0, 1, 0],
        (t) => v3.lerp(skinCol, scuteRim, t * 0.4),
        (t) => [0, Math.max(0, t - 0.18), 0, 0.22], 0.08
      );
      mb.addLeafBlade(
        [
          [side * 0.2, -0.04, -0.66],
          [side * 0.44, -0.06, -0.92],
          [side * 0.68, -0.08, -1.24]
        ],
        [0.12, 0.14, 0.06],
        [0, 1, 0],
        () => skinCol,
        (t) => [0, Math.max(0, t - 0.15) * 0.4, 0, 0.2], 0.06
      );
    }

    const built = mb.toBufferGeometry(true, false, true);
    return {
      geometry: built.geometry,
      triCount: built.triCount,
      name: `${NAME_PREFIX[Math.floor(rng() * NAME_PREFIX.length)]} Sea Turtle`,
      category: 'turtle',
      animMode: 2,
      sss: 0.25,
      accent: [0.35, 0.85, 0.72]
    };
  },

  manta(rng) {
    const mb = new MeshBuilder();
    const hue = 0.55 + rng() * 0.08;
    const bodyLen = 2.4 + rng() * 0.7;
    const wingSpan = 2.0 + rng() * 0.9;
    const segs = 32, ringSegs = 28;

    const rings: Vec3[][] = [];
    for (let i = 0; i < segs; i++) {
      const t = i / (segs - 1);
      const z = (0.5 - t) * bodyLen;
      const wingEnv = Math.sin(Math.pow(t, 0.72) * Math.PI);
      const halfW = 0.18 + wingSpan * Math.pow(wingEnv, 1.38);
      const halfH = 0.05 + 0.22 * Math.sin(t * Math.PI) * (1 - t * 0.4);
      const ring: Vec3[] = [];
      for (let j = 0; j < ringSegs; j++) {
        const ang = (j / ringSegs) * Math.PI * 2;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const wingCurve = Math.pow(Math.abs(ca), 1.6) * 0.16 * wingEnv;
        ring.push([
          ca * halfW,
          sa * halfH - wingCurve + Math.sin(t * Math.PI * 2) * 0.03,
          z - Math.abs(ca) * 0.45 * wingEnv
        ]);
      }
      rings.push(ring);
    }

    mb.addLoft(
      rings,
      (t, u) => {
        if (Math.sin(u * Math.PI * 2) < -0.05) return [0.88, 0.91, 0.93];
        const spot = Math.sin(t * 16 + u * 22) > 0.78 ? 0.14 : 0.0;
        return hslToRgb(hue, 0.42, 0.16 + spot + 0.08 * (1 - t));
      },
      (t) => [0.0, 0.75, t * 3.0, 0.35],
      true,
      true
    );

    for (const side of [-1, 1]) {
      mb.addTube(
        [
          [side * 0.22, -0.02, bodyLen * 0.44],
          [side * 0.26, -0.04, bodyLen * 0.62],
          [side * 0.2, -0.06, bodyLen * 0.74]
        ],
        [0.065, 0.05, 0.025], 8,
        () => hslToRgb(hue, 0.35, 0.22),
        () => [0, 0.15, 0, 0.3]
      );
    }

    const tailPts: Vec3[] = [];
    const tailRad: number[] = [];
    for (let i = 0; i < 16; i++) {
      const st = i / 15;
      tailPts.push([
        Math.sin(st * 3.2) * 0.06 * st,
        Math.cos(st * 2.5) * 0.04 * st,
        -bodyLen * 0.48 - st * 1.4
      ]);
      tailRad.push(0.045 * (1 - st * 0.88));
    }
    mb.addTube(
      tailPts, tailRad, 7,
      () => hslToRgb(hue, 0.38, 0.18),
      (t) => [0, 0.85, t * 4.0, 0.25]
    );

    const built = mb.toBufferGeometry(true, false, true);
    return {
      geometry: built.geometry,
      triCount: built.triCount,
      name: `${NAME_PREFIX[Math.floor(rng() * NAME_PREFIX.length)]} Manta Ray`,
      category: 'manta',
      animMode: 2,
      sss: 0.3,
      accent: [0.32, 0.78, 0.92]
    };
  },

  jellyfish(rng) {
    const mb = new MeshBuilder();
    const palettes: { bell: Vec3; glow: Vec3 }[] = [
      { bell: [0.58, 0.85, 0.96], glow: [0.45, 0.82, 0.98] },
      { bell: [0.94, 0.68, 0.82], glow: [0.95, 0.58, 0.78] },
      { bell: [0.96, 0.78, 0.52], glow: [0.98, 0.65, 0.38] }
    ];
    const pal = palettes[Math.floor(rng() * palettes.length)];
    const bellSegs = 40, bellRings = 20;
    const ribs = 8 + Math.floor(rng() * 8);
    const bellHeight = 0.85 + rng() * 0.35;
    const bellRadius = 0.95 + rng() * 0.35;

    const rings: Vec3[][] = [];
    for (let i = 0; i < bellRings; i++) {
      const t = i / (bellRings - 1);
      const phi = t * Math.PI * 0.58;
      const rBase = Math.sin(phi) * bellRadius;
      const yBase = Math.cos(phi) * bellHeight;
      const ring: Vec3[] = [];
      for (let j = 0; j < bellSegs; j++) {
        const ang = (j / bellSegs) * Math.PI * 2;
        const ribWave = 1 + 0.05 * Math.sin(ang * ribs) * Math.sin(t * Math.PI);
        ring.push([Math.cos(ang) * rBase * ribWave, yBase, Math.sin(ang) * rBase * ribWave]);
      }
      rings.push(ring);
    }
    mb.addLoft(
      rings,
      (t) => v3.lerp(pal.bell, pal.glow, t * 0.5),
      (t) => [0.28 + 0.52 * Math.pow(t, 2), 0.25 + 0.65 * t, t * 1.5, 0.12],
      true,
      false
    );

    for (let a = 0; a < 4; a++) {
      const baseAng = (a / 4) * Math.PI * 2;
      const pts: Vec3[] = [];
      const radii: number[] = [];
      for (let s = 0; s < 16; s++) {
        const st = s / 15;
        const ang = baseAng + st * 2.0;
        const r = 0.16 * Math.sin(st * Math.PI) + 0.05;
        pts.push([Math.cos(ang) * r, 0.1 - st * 1.45, Math.sin(ang) * r]);
        radii.push(0.058 * (1 - st * 0.7) * (1 + 0.3 * Math.sin(st * 16)));
      }
      mb.addTube(
        pts, radii, 7,
        () => pal.glow,
        (t) => [0.45 + t * 0.5, 0.35 + t * 0.75, a + t * 2.5, 0.1]
      );
    }

    const nTentacles = 12 + Math.floor(rng() * 6);
    for (let k = 0; k < nTentacles; k++) {
      const ang = (k / nTentacles) * Math.PI * 2 + (rng() - 0.5) * 0.15;
      const rad = bellRadius * (0.48 + 0.44 * rng());
      const len = 1.65 + rng() * 1.25;
      const pts: Vec3[] = [];
      const radii: number[] = [];
      for (let s = 0; s < 15; s++) {
        const st = s / 14;
        const r = rad * (1 - st * 0.18) + Math.sin(st * 5.5 + k) * 0.06;
        pts.push([Math.cos(ang) * r, 0.1 - st * len, Math.sin(ang) * r]);
        radii.push((1 - st * 0.85) * 0.024);
      }
      mb.addTube(
        pts, radii, 5,
        () => pal.bell,
        (t) => [0.35 + t * 0.45, 0.3 + t * 0.9, k * 0.7 + t * 2.5, 0.08]
      );
    }

    const built = mb.toBufferGeometry(true, false, true);
    return {
      geometry: built.geometry,
      triCount: built.triCount,
      name: `${NAME_PREFIX[Math.floor(rng() * NAME_PREFIX.length)]} Moon Jelly`,
      category: 'jellyfish',
      animMode: 6,
      sss: 0.9,
      accent: pal.glow
    };
  },

  seahorse(rng) {
    const mb = new MeshBuilder();
    const hue = 0.07 + rng() * 0.09;
    const bodyCol = hslToRgb(hue, 0.72, 0.5);
    const ridgeCol = hslToRgb(hue + 0.04, 0.6, 0.65);

    const pts: Vec3[] = [];
    const rads: number[] = [];
    const steps = 40;
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      if (t < 0.62) {
        const u = t / 0.62;
        const z = Math.sin(u * Math.PI * 1.45) * 0.24;
        const y = 0.95 - u * 1.55;
        const belly = u > 0.28 ? Math.sin(((u - 0.28) / 0.72) * Math.PI) * 0.24 : 0.12;
        const ridge = 1 + 0.12 * Math.sin(u * Math.PI * 22);
        pts.push([0, y, z]);
        rads.push((0.08 + belly) * ridge);
      } else {
        const u = (t - 0.62) / 0.38;
        const spiralAng = u * Math.PI * 2.4;
        const spiralR = 0.26 * (1 - u * 0.68);
        pts.push([
          0,
          -0.6 - Math.sin(spiralAng) * spiralR - u * 0.35,
          -0.15 + Math.cos(spiralAng) * spiralR
        ]);
        rads.push(0.085 * (1 - u * 0.78));
      }
    }
    mb.addTube(
      pts, rads, 12,
      (t) => (Math.sin(t * Math.PI * 36) > 0.4 ? ridgeCol : bodyCol),
      (t) => [0.0, 0.15 + 0.45 * t, t * 2.0, 0.22]
    );

    mb.addTube(
      [[0, 0.95, 0.08], [0, 0.92, 0.34], [0, 0.9, 0.56]],
      [0.14, 0.065, 0.045], 10,
      () => bodyCol,
      () => [0, 0.1, 0, 0.2]
    );
    mb.addPrism(
      [0, 1.05, 0.02], [0, 0.9, -0.4], 0.16, 0.1, 0.05, 6, 0.06,
      bodyCol, ridgeCol, [0, 0.1, 0, 0.2], [0, 0.1, 0, 0.2]
    );
    for (const side of [-1, 1]) {
      mb.addEllipsoid(
        [side * 0.11, 0.98, 0.14], 0.036, 0.036, 0.036, 8, 6,
        () => [0.03, 0.03, 0.04],
        () => [0, 0.1, 0, 0.95]
      );
    }

    mb.addLeafBlade(
      [[0, 0.35, -0.22], [0, 0.12, -0.3], [0, -0.12, -0.25]],
      [0.05, 0.15, 0.05], [1, 0, 0],
      () => [0.95, 0.85, 0.58],
      (t) => [0.1, 0.55, t * 4.0, 0.1], 0.02
    );

    const built = mb.toBufferGeometry(true, false, true);
    return {
      geometry: built.geometry,
      triCount: built.triCount,
      name: `${NAME_PREFIX[Math.floor(rng() * NAME_PREFIX.length)]} Seahorse`,
      category: 'seahorse',
      animMode: 1,
      sss: 0.45,
      accent: ridgeCol
    };
  },

  squid(rng) {
    const mb = new MeshBuilder();
    const hue = rng() > 0.5 ? 0.94 : 0.54;
    const baseCol = hslToRgb(hue, 0.45, 0.65);
    const finCol = hslToRgb(hue, 0.62, 0.52);

    const mRings: Vec3[][] = [];
    const mSegs = 24, rSegs = 24;
    for (let i = 0; i < mSegs; i++) {
      const t = i / (mSegs - 1);
      const y = 1.2 - t * 1.55;
      const r = 0.04 + 0.38 * Math.sin(Math.pow(t, 0.65) * Math.PI);
      const ring: Vec3[] = [];
      for (let j = 0; j < rSegs; j++) {
        const a = (j / rSegs) * Math.PI * 2;
        const fin = t < 0.42
          ? 1 + 0.72 * Math.sin((t / 0.42) * Math.PI) * Math.pow(Math.abs(Math.cos(a)), 6)
          : 1;
        ring.push([Math.cos(a) * r * fin, y, Math.sin(a) * r]);
      }
      mRings.push(ring);
    }
    mb.addLoft(
      mRings,
      (t) => v3.lerp(finCol, baseCol, 0.3 + 0.5 * t),
      (t) => [0.12, 0.25 * (1 - t), t * 2.0, 0.25],
      true,
      false
    );

    for (const side of [-1, 1]) {
      mb.addEllipsoid(
        [side * 0.26, -0.32, 0.12], 0.075, 0.085, 0.075, 10, 8,
        () => [0.04, 0.04, 0.06],
        () => [0, 0.1, 0, 0.95]
      );
    }

    const nArms = 10;
    for (let k = 0; k < nArms; k++) {
      const isLong = k === 0 || k === 5;
      const ang = (k / nArms) * Math.PI * 2;
      const rad = 0.22;
      const armLen = isLong ? 1.85 : 1.2 + rng() * 0.3;
      const pts: Vec3[] = [];
      const rads: number[] = [];
      for (let s = 0; s < 16; s++) {
        const st = s / 15;
        const r = rad * (1 + st * 0.45) + Math.sin(st * 4.5 + k) * 0.07;
        pts.push([Math.cos(ang + st * 0.3) * r, -0.35 - st * armLen, Math.sin(ang + st * 0.3) * r]);
        rads.push((isLong ? 0.042 : 0.032) * (1 - st * 0.85));
      }
      mb.addTube(
        pts, rads, 6,
        () => finCol,
        (t) => [0.15, 0.3 + t * 0.85, k * 0.6 + t * 2.5, 0.15]
      );
    }

    const built = mb.toBufferGeometry(true, false, true);
    return {
      geometry: built.geometry,
      triCount: built.triCount,
      name: `${NAME_PREFIX[Math.floor(rng() * NAME_PREFIX.length)]} Reef Squid`,
      category: 'squid',
      animMode: 1,
      sss: 0.65,
      accent: baseCol
    };
  },

  vallisneria(rng) {
    const mb = new MeshBuilder();
    const hue = 0.27 + rng() * 0.09;
    const nBlades = 13 + Math.floor(rng() * 7);

    for (let b = 0; b < nBlades; b++) {
      const ang = (b / nBlades) * Math.PI * 2 + (rng() - 0.5) * 0.3;
      const spreadR = 0.06 + rng() * 0.18;
      const h = 1.65 + rng() * 1.25;
      const lean = 0.32 + rng() * 0.45;
      const wBase = 0.065 + rng() * 0.03;
      const steps = 12;
      const pts: Vec3[] = [];
      const widths: number[] = [];
      for (let s = 0; s < steps; s++) {
        const st = s / (steps - 1);
        const curve = Math.pow(st, 1.5) * lean;
        const twist = Math.sin(st * Math.PI * 2 + b) * 0.06;
        pts.push([
          Math.cos(ang) * (spreadR + curve) + Math.sin(ang) * twist,
          st * h,
          Math.sin(ang) * (spreadR + curve) - Math.cos(ang) * twist
        ]);
        widths.push(wBase * Math.sin(Math.pow(st, 0.35) * Math.PI * 0.92 + 0.12));
      }
      mb.addLeafBlade(
        pts, widths, [Math.cos(ang), 0, Math.sin(ang)],
        (t) => hslToRgb(hue + t * 0.04, 0.62 + t * 0.12, 0.22 + t * 0.24),
        (t) => [0.0, t, b * 0.65, 0.08], 0.1
      );
    }

    const built = mb.toBufferGeometry(true, true, true);
    return {
      geometry: built.geometry,
      triCount: built.triCount,
      name: `${NAME_PREFIX[Math.floor(rng() * NAME_PREFIX.length)]} Vallisneria`,
      category: 'vallisneria',
      animMode: 7,
      sss: 0.78,
      accent: [0.25, 0.78, 0.42]
    };
  },

  stem_plant(rng) {
    const mb = new MeshBuilder();
    const isReddish = rng() > 0.58;
    const stemHue = isReddish ? 0.12 : 0.28;
    const leafHue = isReddish ? 0.04 : 0.31;
    const nStems = 3 + Math.floor(rng() * 4);

    for (let s = 0; s < nStems; s++) {
      const ang = (s / nStems) * Math.PI * 2 + rng() * 0.5;
      const baseR = 0.12 + rng() * 0.22;
      const height = 1.6 + rng() * 1.1;
      const leanX = Math.cos(ang) * (0.25 + rng() * 0.35);
      const leanZ = Math.sin(ang) * (0.25 + rng() * 0.35);
      const pts: Vec3[] = [];
      const rads: number[] = [];
      const nodes = 10;
      for (let i = 0; i < nodes; i++) {
        const st = i / (nodes - 1);
        pts.push([
          Math.cos(ang) * baseR + leanX * Math.pow(st, 1.3),
          st * height,
          Math.sin(ang) * baseR + leanZ * Math.pow(st, 1.3)
        ]);
        rads.push(0.032 * (1 - st * 0.45));
      }
      mb.addTube(
        pts, rads, 6,
        (t) => hslToRgb(stemHue, 0.5, 0.25 + t * 0.12),
        (t) => [0, t, s * 0.9, 0.05]
      );

      for (let i = 2; i < nodes; i++) {
        const st = i / (nodes - 1);
        const p = pts[i];
        const nLeaves = 4 + (i % 2);
        const leafSize = 0.28 + 0.14 * Math.sin(st * Math.PI);
        for (let l = 0; l < nLeaves; l++) {
          const la = (l / nLeaves) * Math.PI * 2 + i * 0.6;
          const lPts: Vec3[] = [
            p,
            [p[0] + Math.cos(la) * leafSize * 0.55, p[1] + 0.05, p[2] + Math.sin(la) * leafSize * 0.55],
            [p[0] + Math.cos(la) * leafSize, p[1] + 0.02, p[2] + Math.sin(la) * leafSize]
          ];
          mb.addLeafBlade(
            lPts, [0.025, 0.08, 0.015], [0, 1, 0],
            (lt) => {
              const h = isReddish ? leafHue - st * 0.03 : leafHue + lt * 0.03;
              return hslToRgb(h, 0.62 + st * 0.15, 0.26 + st * 0.18 + lt * 0.08);
            },
            () => [0, st, s * 0.9, 0.08], 0.12
          );
        }
      }
    }

    const built = mb.toBufferGeometry(true, true, true);
    return {
      geometry: built.geometry,
      triCount: built.triCount,
      name: isReddish
        ? `${NAME_PREFIX[Math.floor(rng() * NAME_PREFIX.length)]} Ludwigia`
        : `${NAME_PREFIX[Math.floor(rng() * NAME_PREFIX.length)]} Rotala`,
      category: 'stem_plant',
      animMode: 7,
      sss: 0.72,
      accent: isReddish ? [0.85, 0.42, 0.28] : [0.3, 0.82, 0.45]
    };
  },

  broadleaf_coral(rng) {
    const mb = new MeshBuilder();
    const isAnubias = rng() > 0.5;
    if (isAnubias) {
      const hue = 0.32 + rng() * 0.07;
      const nLeaves = 9 + Math.floor(rng() * 5);
      for (let l = 0; l < nLeaves; l++) {
        const ang = (l / nLeaves) * Math.PI * 2 + (rng() - 0.5) * 0.35;
        const len = 0.75 + rng() * 0.55;
        const elev = 0.45 + rng() * 0.55;
        const lPts: Vec3[] = [
          [0, 0.05, 0],
          [Math.cos(ang) * len * 0.35, elev * 0.65, Math.sin(ang) * len * 0.35],
          [Math.cos(ang) * len * 0.75, elev * 0.95, Math.sin(ang) * len * 0.75],
          [Math.cos(ang) * len * 1.1, elev * 0.72, Math.sin(ang) * len * 1.1]
        ];
        mb.addLeafBlade(
          lPts, [0.03, 0.18, 0.24, 0.03], [0, 1, 0],
          (t) => hslToRgb(hue, 0.65, 0.18 + t * 0.18),
          (t) => [0, t * 0.6, l * 0.5, 0.25], 0.12
        );
      }
      const built = mb.toBufferGeometry(true, true, true);
      return {
        geometry: built.geometry,
        triCount: built.triCount,
        name: `${NAME_PREFIX[Math.floor(rng() * NAME_PREFIX.length)]} Anubias`,
        category: 'broadleaf_coral',
        animMode: 7,
        sss: 0.65,
        accent: [0.22, 0.75, 0.45]
      };
    }

    const coralHue = [0.02, 0.07, 0.95, 0.46][Math.floor(rng() * 4)];
    const coralPhase = rng() * Math.PI * 2;
    const maxDepth = 3;

    const growCoral = (pos: Vec3, dir: Vec3, len: number, rad: number, depth: number): void => {
      const steps = 6;
      const pts: Vec3[] = [];
      const rads: number[] = [];
      let cur = pos;
      let curDir = v3.norm(dir);
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        pts.push(cur);
        rads.push(rad * (1 - t * 0.35));
        curDir = v3.norm(v3.add(curDir, [(rng() - 0.5) * 0.18, 0.18, (rng() - 0.5) * 0.18]));
        cur = v3.add(cur, v3.mul(curDir, len / (steps - 1)));
      }
      mb.addTube(
        pts, rads, 8,
        (t) => hslToRgb(coralHue + t * 0.03, 0.62, 0.38 + depth * 0.08 + t * 0.08),
        (t) => [depth === maxDepth ? 0.22 : 0.0, 0.18 * (depth + t), coralPhase, 0.1]
      );
      if (depth < maxDepth) {
        const tipPos = pts[pts.length - 1];
        const branches = depth === 0 ? 4 : 2 + Math.floor(rng() * 2);
        for (let b = 0; b < branches; b++) {
          const a = (b / branches) * Math.PI * 2 + rng() * 0.5;
          const newDir = v3.norm([
            curDir[0] + Math.cos(a) * 0.55,
            curDir[1] + 0.5,
            curDir[2] + Math.sin(a) * 0.55
          ]);
          growCoral(tipPos, newDir, len * 0.7, rad * 0.66, depth + 1);
        }
      }
    };
    growCoral([0, 0, 0], [0, 1, 0], 0.75, 0.16, 0);

    const built = mb.toBufferGeometry(true, true, true);
    return {
      geometry: built.geometry,
      triCount: built.triCount,
      name: `${NAME_PREFIX[Math.floor(rng() * NAME_PREFIX.length)]} Reef Coral`,
      category: 'broadleaf_coral',
      animMode: 7,
      sss: 0.58,
      accent: hslToRgb(coralHue, 0.75, 0.58)
    };
  }
};

export function buildUnderwaterSanctuaryEnv(): {
  substrateGeometry: THREE.BufferGeometry;
  waterSurfaceGeometry: THREE.BufferGeometry;
  bubblesGeometry: THREE.BufferGeometry;
} {
  // 1. Seabed terrain + smooth river/reef stones + sunken driftwood
  const subMb = new MeshBuilder();
  const nx = 44;
  const nz = 44;
  const span = SANCTUARY_RADIUS;

  const grid: Vec3[][] = [];
  for (let iz = 0; iz <= nz; iz++) {
    const row: Vec3[] = [];
    const z = -span + (iz / nz) * (2 * span);
    for (let ix = 0; ix <= nx; ix++) {
      const x = -span + (ix / nx) * (2 * span);
      row.push([x, sandHeight(x, z), z]);
    }
    grid.push(row);
  }

  const sandColor = (x: number, z: number): Vec3 => {
    const v = Math.sin(x * 3.1 + z * 2.4) * 0.04 + Math.cos(x * 7.2 - z * 5.1) * 0.02;
    return [0.56 + v, 0.52 + v * 0.9, 0.41 + v * 0.7];
  };
  const sandMeta: Vec4 = [0.0, 0.0, 0.0, 0.05];

  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const p1 = grid[iz][ix];
      const p2 = grid[iz][ix + 1];
      const p3 = grid[iz + 1][ix + 1];
      const p4 = grid[iz + 1][ix];
      subMb.addQuad(
        p1, p4, p3, p2,
        sandColor(p1[0], p1[2]),
        sandColor(p4[0], p4[2]),
        sandColor(p3[0], p3[2]),
        sandColor(p2[0], p2[2]),
        sandMeta, sandMeta, sandMeta, sandMeta
      );
    }
  }

  const rocks = [
    { x: -4.2, z: -3.5, rx: 1.15, ry: 0.72, rz: 0.92, seed: 1.1 },
    { x: -2.8, z: -4.6, rx: 0.78, ry: 0.55, rz: 0.68, seed: 2.4 },
    { x: 3.9, z: -3.9, rx: 1.2, ry: 0.82, rz: 0.88, seed: 4.5 },
    { x: 5.1, z: 2.1, rx: 0.95, ry: 0.6, rz: 0.8, seed: 5.9 },
    { x: -4.8, z: 2.6, rx: 1.05, ry: 0.65, rz: 0.85, seed: 6.3 },
    { x: 1.2, z: 4.8, rx: 0.85, ry: 0.52, rz: 0.7, seed: 7.2 }
  ];
  for (const rk of rocks) {
    const baseY = sandHeight(rk.x, rk.z) + rk.ry * 0.25;
    subMb.addEllipsoid(
      [rk.x, baseY, rk.z], rk.rx, rk.ry, rk.rz, 16, 10,
      (v, u) => {
        const moss = v < 0.42 ? 1.0 - v / 0.42 : 0.0;
        const shade = 0.20 + 0.08 * Math.sin(u * Math.PI * 6 + rk.seed);
        return [
          shade * (1 - moss * 0.28) + moss * 0.08,
          shade + moss * 0.14,
          shade * 1.08 - moss * 0.04
        ];
      },
      () => [0, 0, 0, 0.15],
      (nx2, ny2, nz2) => 1.0 + 0.12 * Math.sin(nx2 * 4.2 + rk.seed) * Math.cos(nz2 * 3.8 - ny2 * 2.5)
    );
  }

  // Sunken driftwood arch in front-left reef
  const woodCol = (t: number): Vec3 => [0.24 - t * 0.06, 0.15 - t * 0.03, 0.09 - t * 0.02];
  const woodMeta = (): Vec4 => [0, 0, 0, 0.1];
  const dwBaseY = sandHeight(-3.8, -3.1) - 0.08;
  subMb.addTube(
    [
      [-4.1, dwBaseY, -3.4],
      [-3.1, dwBaseY + 0.65, -3.1],
      [-1.9, dwBaseY + 1.15, -2.85],
      [-0.7, dwBaseY + 1.38, -2.75],
      [0.35, dwBaseY + 1.52, -2.9]
    ],
    [0.24, 0.18, 0.14, 0.09, 0.03], 10, woodCol, woodMeta
  );

  // 2. Overhead Rippling Water Surface
  const surfMb = new MeshBuilder();
  const wx = 34;
  const wz = 34;
  const watCol: Vec3 = [0.32, 0.78, 0.88];
  const watMeta: Vec4 = [0.0, 0.0, 0.0, 1.0];
  for (let iz = 0; iz < wz; iz++) {
    const z0 = -span + (iz / wz) * (2 * span);
    const z1 = -span + ((iz + 1) / wz) * (2 * span);
    for (let ix = 0; ix < wx; ix++) {
      const x0 = -span + (ix / wx) * (2 * span);
      const x1 = -span + ((ix + 1) / wx) * (2 * span);
      surfMb.addQuad(
        [x0, SANCTUARY_WATER_Y, z0],
        [x0, SANCTUARY_WATER_Y, z1],
        [x1, SANCTUARY_WATER_Y, z1],
        [x1, SANCTUARY_WATER_Y, z0],
        watCol, watCol, watCol, watCol,
        watMeta, watMeta, watMeta, watMeta
      );
    }
  }

  // 3. Rising Air Bubbles distributed around the sanctuary
  const bubMb = new MeshBuilder();
  const bRng = mulberry32(90210);
  const nBubbles = 84;
  for (let b = 0; b < nBubbles; b++) {
    const angle = bRng() * Math.PI * 2;
    const dist = 1.4 + bRng() * 6.5;
    const bx = Math.cos(angle) * dist;
    const bz = Math.sin(angle) * dist;
    const startY = sandHeight(bx, bz) + 0.08;
    const u = bRng();
    const r = u < 0.78
      ? 0.014 + bRng() * 0.02
      : u < 0.94
        ? 0.03 + bRng() * 0.024
        : 0.05 + bRng() * 0.03;
    const speed = (0.045 + bRng() * 0.05) * (0.04 / Math.max(r, 0.014));
    const phase = bRng();
    const bMeta: Vec4 = [startY, speed, phase, 2.0];
    const bCol: Vec3 = [0.85, 0.96, 1.0];
    bubMb.addEllipsoid([bx, 0, bz], r, r * 0.92, r, 8, 5, () => bCol, () => bMeta);
  }

  return {
    substrateGeometry: subMb.toBufferGeometry(false, false, false).geometry,
    waterSurfaceGeometry: surfMb.toBufferGeometry(false, false, false).geometry,
    bubblesGeometry: bubMb.toBufferGeometry(true, false, false).geometry
  };
}

const AQUATIC_SCENE_VERT = /* glsl */ `
attribute vec3 aColor;
attribute vec4 aAttrs;

uniform float uTime;
uniform float uAnimMode;

varying vec3 vWorldPos;
varying vec3 vWorldNorm;
varying vec3 vColor;
varying vec4 vAttrs;
varying vec3 vLocalPos;

void main() {
  vec3 p = position;
  float t = uTime;
  float mode = uAnimMode;
  float w = aAttrs.y;
  float phase = aAttrs.z;

  if (mode > 0.5 && mode < 1.5) {
    float wave = sin(t * 1.35 + phase + p.y * 2.0) * 0.07 * w;
    p.x += wave;
    p.z += cos(t * 1.15 + phase + p.y * 1.8) * 0.06 * w;
  } else if (mode >= 1.5 && mode < 2.5) {
    float wingDist = abs(p.x);
    p.y += sin(t * 1.55 - p.z * 1.0) * 0.28 * wingDist * w;
  } else if (mode >= 3.5 && mode < 4.5) {
    p.x += sin(t * 3.4 - p.z * 2.8 + phase) * 0.11 * w;
  } else if (mode >= 5.5 && mode < 6.5) {
    float raw = sin(t * 1.15 + phase);
    float pulse = raw * mix(0.55, 1.0, step(0.0, raw));
    float bellMask = clamp(p.y + 0.5, 0.0, 1.0);
    p.x *= 1.0 + pulse * 0.12 * bellMask * w;
    p.z *= 1.0 + pulse * 0.12 * bellMask * w;
    p.y += pulse * 0.055 * w;
    p.x += sin(t * 0.85 + phase + p.y * 2.2) * 0.055 * (1.0 - bellMask) * w;
  } else if (mode >= 6.5) {
    float h = max(position.y, 0.0);
    float sway = pow(h, 1.35);
    p.x += sin(t * 0.95 + phase + h * 1.5) * 0.10 * sway;
    p.z += cos(t * 0.75 + phase * 1.3 + h * 1.2) * 0.065 * sway;
  }

  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;
  vWorldNorm = normalize(mat3(modelMatrix) * normal);
  vColor = aColor;
  vAttrs = aAttrs;
  vLocalPos = position;

  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const AQUATIC_SCENE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uSss;
uniform float uSurfaceFlag;
uniform float uFogAmount;
uniform float uHoverGlow;

varying vec3 vWorldPos;
varying vec3 vWorldNorm;
varying vec3 vColor;
varying vec4 vAttrs;
varying vec3 vLocalPos;

float hash3(vec3 p) {
  vec3 q = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  q *= 17.0;
  return fract(q.x * q.y * q.z * (q.x + q.y + q.z));
}

float noise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  vec3 u2 = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(
      mix(hash3(i + vec3(0.0, 0.0, 0.0)), hash3(i + vec3(1.0, 0.0, 0.0)), u2.x),
      mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), u2.x),
      u2.y
    ),
    mix(
      mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), u2.x),
      mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), u2.x),
      u2.y
    ),
    u2.z
  );
}

float fbm(vec3 p) {
  return 0.55 * noise3(p) + 0.30 * noise3(p * 2.13) + 0.15 * noise3(p * 4.41);
}

float caustics(vec2 xz, float t) {
  vec2 p1 = xz * 1.45 + vec2(t * 0.18, -t * 0.14);
  vec2 p2 = xz * 1.85 + vec2(-t * 0.15, t * 0.20);
  float w1 = sin(p1.x * 2.2 + sin(p1.y * 2.6 + t * 0.55));
  float w2 = cos(p2.y * 2.4 + sin(p2.x * 2.1 - t * 0.48));
  float ridge = 1.0 - abs(w1 + w2) * 0.5;
  return pow(clamp(ridge, 0.0, 1.0), 3.6);
}

float distGGX(vec3 N, vec3 H, float rough) {
  float a = rough * rough;
  float a2 = a * a;
  float NdotH = max(dot(N, H), 0.0);
  float denom = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / max(3.14159265 * denom * denom, 0.0001);
}

float geomSchlick(float NdotV, float rough) {
  float r = rough + 1.0;
  float k = (r * r) / 8.0;
  return NdotV / (NdotV * (1.0 - k) + k);
}

float geomSmith(vec3 N, vec3 V, vec3 L, float rough) {
  return geomSchlick(max(dot(N, V), 0.0), rough) * geomSchlick(max(dot(N, L), 0.0), rough);
}

vec3 fresnelSchlick(float cosTheta, vec3 F0) {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

vec3 evalLight(vec3 L, vec3 lightCol, vec3 N, vec3 V, vec3 albedo, float metal, float rough, vec3 F0) {
  vec3 H = normalize(V + L);
  float NDF = distGGX(N, H, rough);
  float G = geomSmith(N, V, L, rough);
  vec3 F = fresnelSchlick(max(dot(H, V), 0.0), F0);
  float NdotL = max(dot(N, L), 0.0);
  float NdotV = max(dot(N, V), 0.001);
  vec3 spec = (NDF * G * F) / max(4.0 * NdotV * NdotL, 0.001);
  vec3 kD = (vec3(1.0) - F) * (1.0 - metal);
  return (kD * albedo / 3.14159265 + spec) * lightCol * NdotL;
}

void main() {
  float t = uTime;
  float nFreq = uSurfaceFlag > 0.5 ? 11.0 : 8.0;
  float eps = 0.025;
  float f0 = fbm(vLocalPos * nFreq);
  float fx = fbm((vLocalPos + vec3(eps, 0.0, 0.0)) * nFreq);
  float fy = fbm((vLocalPos + vec3(0.0, eps, 0.0)) * nFreq);
  float fz = fbm((vLocalPos + vec3(0.0, 0.0, eps)) * nFreq);
  vec3 grad = vec3(fx - f0, fy - f0, fz - f0) / eps;

  float bumpStrength = uSurfaceFlag > 0.5 ? 0.04 : mix(0.05, 0.015, vAttrs.w);
  vec3 N = normalize(vWorldNorm - grad * bumpStrength);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorldPos);

  vec3 albedo = vColor * (0.88 + 0.24 * f0);
  float metal = clamp(vAttrs.w, 0.0, 1.0);
  float rough = clamp(mix(0.46, 0.16, metal) + (f0 - 0.5) * 0.16, 0.08, 0.92);
  vec3 F0 = mix(vec3(0.04), albedo, metal);

  vec3 L1 = normalize(vec3(0.14, 0.96, 0.22));
  vec3 L2 = normalize(vec3(-0.65, 0.35, 0.65));
  vec3 L3 = normalize(vec3(0.45, -0.5, -0.55));

  float depthBelow = clamp((3.9 - vWorldPos.y) * 0.28, 0.0, 1.0);
  float cVal = caustics(vWorldPos.xz + vWorldPos.y * 0.18, t);
  float cStrength = uSurfaceFlag > 0.5 ? 1.15 : 0.55;
  float causticBoost = cVal * max(N.y, 0.14) * depthBelow * cStrength;

  vec3 Lo = vec3(0.0);
  Lo += evalLight(L1, vec3(2.15, 2.30, 2.25) * (1.0 + causticBoost), N, V, albedo, metal, rough, F0);
  Lo += evalLight(L2, vec3(0.42, 0.68, 0.80), N, V, albedo, metal, rough, F0);
  Lo += evalLight(L3, vec3(0.20, 0.40, 0.50), N, V, albedo, metal, rough, F0);

  float sssWrap = max(0.0, (dot(-N, L1) + 0.55) / 1.55);
  vec3 sss = albedo * uSss * pow(sssWrap, 1.8) * 0.68;

  vec3 hemi = mix(vec3(0.07, 0.16, 0.22), vec3(0.24, 0.38, 0.46), N.y * 0.5 + 0.5);
  float fresnelRim = pow(1.0 - max(dot(N, V), 0.0), 3.2);
  vec3 rim = fresnelRim * (vec3(0.18, 0.44, 0.56) + vec3(0.28, 0.85, 0.82) * uHoverGlow);
  vec3 emissive = vColor * (vAttrs.x + uHoverGlow * 0.28);

  vec3 col = hemi * albedo + Lo + sss + rim + emissive;

  if (uFogAmount > 0.01) {
    float dist = length(cameraPosition - vWorldPos);
    vec3 waterTint = vec3(0.02, 0.15, 0.24);
    float waterFog = clamp((dist - 3.6) / 11.5, 0.0, 0.72) * uFogAmount;
    col = mix(col, waterTint, waterFog);
  }

  // Soft ACES-like tone mapping for sRGB canvas output
  col = col / (col + vec3(0.75));
  col = pow(max(col, vec3(0.0)), vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, 1.0);
}
`;

const AQUATIC_WATER_VERT = /* glsl */ `
attribute vec3 aColor;
attribute vec4 aAttrs;

uniform float uTime;
uniform float uWaterMaxY;

varying vec3 vWorldPos;
varying vec3 vWorldNorm;
varying vec3 vColor;
varying vec4 vAttrs;

void main() {
  vec3 p = position;
  vec3 n = normal;
  float t = uTime;
  float kind = aAttrs.w;

  if (kind > 0.5 && kind < 1.5) {
    float w1 = sin(p.x * 0.95 + t * 0.85) * cos(p.z * 1.05 - t * 0.72) * 0.045;
    float w2 = sin(p.x * 1.9 + p.z * 1.4 - t * 1.45) * 0.02;
    float w3 = sin((p.x - p.z) * 3.6 + t * 2.1) * cos(p.x * 2.8 - t * 1.8) * 0.008;
    p.y += w1 + w2 + w3;
    float dx = 0.95 * cos(p.x * 0.95 + t * 0.85) * cos(p.z * 1.05 - t * 0.72) * 0.045
             + 1.9 * cos(p.x * 1.9 + p.z * 1.4 - t * 1.45) * 0.02;
    float dz = -1.05 * sin(p.x * 0.95 + t * 0.85) * sin(p.z * 1.05 - t * 0.72) * 0.045
             + 1.4 * cos(p.x * 1.9 + p.z * 1.4 - t * 1.45) * 0.02;
    n = normalize(vec3(-dx, 1.0, -dz));
  } else if (kind >= 1.5) {
    float startY = aAttrs.x;
    float speed = aAttrs.y;
    float phase = aAttrs.z;
    float prog = fract(phase + t * speed);
    float ease = prog * prog * (3.0 - 2.0 * prog);
    float nearTop = smoothstep(0.72, 1.0, prog);
    float travel = max(uWaterMaxY - startY, 0.4);
    float rise = mix(prog, ease, 0.65) * (1.0 - nearTop * 0.18);
    float inflate = 1.0 + prog * 0.26;
    float flatten = mix(1.0, 0.45, nearTop);

    p.y = position.y * inflate * flatten + startY + rise * travel;
    float wob1 = sin(t * 1.15 + phase * 18.0 + prog * 5.5) * 0.055;
    float wob2 = sin(t * 0.62 + phase * 11.0 + prog * 3.2) * 0.035;
    p.x = position.x + wob1 + wob2 + n.x * prog * 0.018;
    p.z = position.z
        + cos(t * 0.98 + phase * 14.0 + prog * 4.8) * 0.048
        + cos(t * 0.55 + phase * 9.0 + prog * 2.6) * 0.028
        + n.z * prog * 0.018;
  }

  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;
  vWorldNorm = normalize(mat3(modelMatrix) * n);
  vColor = aColor;
  vAttrs = aAttrs;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const AQUATIC_WATER_FRAG = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vWorldNorm;
varying vec3 vColor;
varying vec4 vAttrs;

void main() {
  vec3 N = normalize(vWorldNorm);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(vec3(0.14, 0.96, 0.22));
  float ndv = abs(dot(N, V));
  float fresnel = pow(1.0 - clamp(ndv, 0.0, 1.0), 3.4);
  vec3 H = normalize(L + V);
  float spec = pow(max(abs(dot(N, H)), 0.0), 140.0);

  float kind = vAttrs.w;
  if (kind >= 1.5) {
    float rim = pow(1.0 - clamp(ndv, 0.0, 1.0), 2.2);
    vec3 core = mix(vec3(0.35, 0.55, 0.62), vColor, 0.55);
    vec3 bCol = core * (0.45 + rim * 1.1) + vec3(0.72, 0.92, 1.0) * fresnel * 0.85 + vec3(spec * 2.2);
    float alpha = mix(0.12, 0.78, rim * 0.85 + fresnel * 0.35);
    gl_FragColor = vec4(bCol, alpha);
    return;
  }

  float fSurf = pow(1.0 - clamp(ndv, 0.0, 1.0), 3.8);
  vec3 surfCol = mix(vColor * 0.62, vec3(0.68, 0.94, 1.0), fSurf * 0.82)
               + vec3(0.15, 0.42, 0.48) * (1.0 - fSurf) * 0.14
               + vec3(spec * 1.8);
  float alpha = mix(0.18, 0.56, fSurf);
  gl_FragColor = vec4(surfCol, alpha);
}
`;

export function createAquaticSceneMaterial(
  animMode: number,
  sss: number,
  surfaceFlag: number
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: AQUATIC_SCENE_VERT,
    fragmentShader: AQUATIC_SCENE_FRAG,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uAnimMode: { value: animMode },
      uSss: { value: sss },
      uSurfaceFlag: { value: surfaceFlag },
      uFogAmount: { value: 1.0 },
      uHoverGlow: { value: 0.0 }
    }
  });
}

export function createAquaticWaterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: AQUATIC_WATER_VERT,
    fragmentShader: AQUATIC_WATER_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uWaterMaxY: { value: SANCTUARY_WATER_Y - 0.06 }
    }
  });
}
