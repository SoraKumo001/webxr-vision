import * as THREE from 'three';

/** Soft glowing orb used as a calm training target. */
export function createSoftOrb(
  color: number,
  radius = 0.12
): { group: THREE.Group; core: THREE.Mesh; glow: THREE.Mesh; shell: THREE.Mesh } {
  const group = new THREE.Group();

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 0.55, 24, 24),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95
    })
  );
  group.add(core);

  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 28, 28),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.22,
      depthWrite: false
    })
  );
  group.add(shell);

  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.45, 24, 24),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  group.add(glow);

  return { group, core, glow, shell };
}

export function createMotionTrail(
  color: number,
  count = 8
): { points: THREE.Points; positions: Float32Array; push: (x: number, y: number, z: number) => void } {
  const positions = new Float32Array(count * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color,
    size: 0.045,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;

  let write = 0;
  const push = (x: number, y: number, z: number) => {
    positions[write * 3] = x;
    positions[write * 3 + 1] = y;
    positions[write * 3 + 2] = z;
    write = (write + 1) % count;
    geo.attributes.position.needsUpdate = true;
  };

  return { points, positions, push };
}
