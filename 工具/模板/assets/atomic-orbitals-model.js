'use strict';

// Distances are in Bohr radii for Z = 1. The page applies the Coulomb scaling.
const SAMPLE_COUNT = 100000;
const RADIAL_STEPS = 8192;
const GRID_STEPS = 84;
const factorial = [1];
for (let i = 1; i <= 12; i++) factorial.push(factorial[i - 1] * i);

function laguerre(order, alpha, x) {
  let previous = 0;
  let current = 1;
  for (let k = 1; k <= order; k++) {
    const next = ((2 * k - 1 + alpha - x) * current - (k - 1 + alpha) * previous) / k;
    previous = current;
    current = next;
  }
  return current;
}

function radialFunction(n, l) {
  const scale = 2 / n;
  const order = n - l - 1;
  const norm = Math.sqrt(scale ** 3 * factorial[order] / (2 * n * factorial[n + l]));
  return (r) => {
    const x = r * scale;
    return norm * Math.exp(-x / 2) * x ** l * laguerre(order, 2 * l + 1, x);
  };
}

function legendre(l, m, z) {
  let diagonal = 1;
  if (m > 0) {
    const sin = Math.sqrt(Math.max(0, 1 - z * z));
    for (let i = 1; i <= m; i++) diagonal *= (2 * i - 1) * sin;
  }
  if (l === m) return diagonal;
  let previous = diagonal;
  let current = z * (2 * m + 1) * diagonal;
  for (let degree = m + 2; degree <= l; degree++) {
    const next = ((2 * degree - 1) * z * current - (degree + m - 1) * previous) / (degree - m);
    previous = current;
    current = next;
  }
  return current;
}

function angularFunction(l, basis) {
  const m = Math.abs(basis);
  const norm = Math.sqrt((2 * l + 1) * factorial[l - m] / (4 * Math.PI * factorial[l + m]));
  if (m === 0) return (z) => norm * legendre(l, 0, z);
  const azimuth = basis < 0 ? Math.sin : Math.cos;
  return (z, phi) => Math.SQRT2 * norm * legendre(l, m, z) * azimuth(m * phi);
}

function radialProfile(n, l) {
  const radial = radialFunction(n, l);
  const limit = 2 * n * n + 17 * n;
  const step = limit / RADIAL_STEPS;
  const cdf = new Float64Array(RADIAL_STEPS + 1);
  let peak = 0;
  let modeIndex = 1;
  let previous = 0;
  for (let i = 1; i <= RADIAL_STEPS; i++) {
    const r = step * i;
    const density = (r * radial(r)) ** 2;
    cdf[i] = cdf[i - 1] + step * (previous + density) / 2;
    previous = density;
    if (density > peak) {
      peak = density;
      modeIndex = i;
    }
  }
  function quantile(probability) {
    const target = probability * cdf[RADIAL_STEPS];
    let low = 0;
    let high = RADIAL_STEPS;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (cdf[middle] < target) low = middle;
      else high = middle;
    }
    return step * (low + (target - cdf[low]) / (cdf[high] - cdf[low]));
  }
  const left = ((modeIndex - 1) * step * radial((modeIndex - 1) * step)) ** 2;
  const right = ((modeIndex + 1) * step * radial((modeIndex + 1) * step)) ** 2;
  const mode = step * (modeIndex + (left - right) / (2 * (left - 2 * peak + right)));
  const r90 = quantile(0.9);
  const r99 = quantile(0.99);
  const extent = quantile(0.999) * 1.08;
  const curve = Array.from({ length: 420 }, (_, i) => {
    const r = extent * i / 419;
    return (r * radial(r)) ** 2;
  });
  return {
    radial, quantile, step, limit,
    stats: { mode, mean: (3 * n * n - l * (l + 1)) / 2, r90, r99, extent, peak, curve },
  };
}

function createOrbital(n, l, basis) {
  const profile = radialProfile(n, l);
  return { ...profile, angular: angularFunction(l, basis), l, basis, strengths: null };
}

function sampleOrbital(model) {
  const { angular, radial, quantile, stats, l } = model;
  const points = new Float32Array(SAMPLE_COUNT * 4);
  const strengths = new Float32Array(SAMPLE_COUNT);
  const angularBound = (2 * l + 1) / (4 * Math.PI);
  let seed = 0x7ae32811;
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed + 0.5) / 4294967296;
  }
  for (let index = 0; index < SAMPLE_COUNT;) {
    const z = 2 * random() - 1;
    const phi = 2 * Math.PI * random();
    const y = angular(z, phi);
    if (angularBound * random() >= y * y) continue;
    const r = quantile(random());
    const normalized = r / stats.r99;
    const equator = normalized * Math.sqrt(1 - z * z);
    const wave = radial(r) * y;
    const offset = index * 4;
    points[offset] = equator * Math.cos(phi);
    points[offset + 1] = equator * Math.sin(phi);
    points[offset + 2] = normalized * z;
    points[offset + 3] = Math.sign(wave);
    strengths[index++] = Math.abs(wave);
  }
  model.strengths = strengths.sort();
  return points;
}

// Each cube uses the same diagonal and the same triangulation on shared faces.
const tetrahedra = [
  [0, 1, 3, 7], [0, 3, 2, 7], [0, 2, 6, 7],
  [0, 6, 4, 7], [0, 4, 5, 7], [0, 5, 1, 7],
];

function isoSurface(model, coverage) {
  const level = model.strengths[Math.floor((100 - coverage) * SAMPLE_COUNT / 100)];
  const { angular, radial, limit, step, stats, l } = model;
  const angularMax = Math.sqrt((2 * l + 1) / (4 * Math.PI));
  let bound = limit;
  while (Math.abs(radial(bound)) * angularMax < level && bound > step) bound -= step;
  bound = (bound + step) * 1.04;

  const count = GRID_STEPS + 1;
  const plane = count * count;
  const coordinates = Float64Array.from({ length: count }, (_, i) => {
    const t = 2 * i / GRID_STEPS - 1;
    return bound * Math.sinh(2.45 * t) / Math.sinh(2.45);
  });
  const field = new Float32Array(count ** 3);
  const equatorSquared = new Float64Array(plane);
  const azimuth = new Float64Array(plane);
  for (let j = 0; j < count; j++) {
    for (let i = 0; i < count; i++) {
      const index = j * count + i;
      equatorSquared[index] = coordinates[i] ** 2 + coordinates[j] ** 2;
      if (model.basis) azimuth[index] = Math.atan2(coordinates[j], coordinates[i]);
    }
  }
  for (let k = 0; k < count; k++) {
    const z = coordinates[k];
    for (let index = 0; index < plane; index++) {
      const r = Math.sqrt(equatorSquared[index] + z * z);
      field[k * plane + index] = radial(r) * angular(r ? z / r : 1, azimuth[index]);
    }
  }

  const vertices = [];
  const indices = [];
  const edgeVertices = new Map();
  const corners = [0, 1, count, count + 1, plane, plane + 1, plane + count, plane + count + 1];
  const offsets = [1, count, plane];
  const gridIndex = (id, axis) => Math.floor(id / offsets[axis]) % count;
  function derivative(id, axis, index) {
    const before = index > 0 ? 1 : 0;
    const after = index < GRID_STEPS ? 1 : 0;
    return (field[id + after * offsets[axis]] - field[id - before * offsets[axis]])
      / (coordinates[index + after] - coordinates[index - before]);
  }
  function intersection(a, b, base, target, sign) {
    const start = base + corners[a];
    const end = base + corners[b];
    const key = 2 * (Math.min(start, end) * field.length + Math.max(start, end)) + (sign > 0 ? 1 : 0);
    const cached = edgeVertices.get(key);
    if (cached !== undefined) return cached;

    const fraction = (target - field[start]) / (field[end] - field[start]);
    const vertex = [];
    const normal = [];
    for (let axis = 0; axis < 3; axis++) {
      const i = gridIndex(start, axis);
      const j = gridIndex(end, axis);
      const x = coordinates[i];
      vertex.push((x + fraction * (coordinates[j] - x)) / stats.r99);
      const grad = derivative(start, axis, i);
      normal.push(-sign * (grad + fraction * (derivative(end, axis, j) - grad)));
    }
    const norm = Math.hypot(...normal) || 1;
    const index = vertices.length / 7;
    vertices.push(...vertex, sign, ...normal.map((value) => value / norm));
    edgeVertices.set(key, index);
    return index;
  }
  function addTetrahedra(base, target, sign) {
    for (const tetra of tetrahedra) {
      const inside = [];
      const outside = [];
      for (const corner of tetra) {
        const group = sign * (field[base + corners[corner]] - target) > 0 ? inside : outside;
        group.push(corner);
      }
      if (inside.length === 0 || outside.length === 0) continue;
      if (inside.length === 2) {
        const a = intersection(inside[0], outside[0], base, target, sign);
        const b = intersection(inside[0], outside[1], base, target, sign);
        const c = intersection(inside[1], outside[0], base, target, sign);
        const d = intersection(inside[1], outside[1], base, target, sign);
        indices.push(a, b, c, b, d, c);
      } else {
        const [single, others] = inside.length === 1 ? [inside, outside] : [outside, inside];
        for (const other of others) indices.push(intersection(single[0], other, base, target, sign));
      }
    }
  }
  for (let k = 0; k < GRID_STEPS; k++) {
    for (let j = 0; j < GRID_STEPS; j++) {
      for (let i = 0; i < GRID_STEPS; i++) {
        const base = k * plane + j * count + i;
        let low = Infinity;
        let high = -Infinity;
        for (const corner of corners) {
          const value = field[base + corner];
          low = Math.min(low, value);
          high = Math.max(high, value);
        }
        if (low <= level && high > level) addTetrahedra(base, level, 1);
        if (low < -level && high >= -level) addTetrahedra(base, -level, -1);
      }
    }
  }
  return { vertices: Float32Array.from(vertices), indices: Uint32Array.from(indices) };
}

let currentKey;
let currentModel;
self.onmessage = ({ data: { id, n, l, basis, mode, coverage, needsPoints } }) => {
  const key = [n, l, basis].join('/');
  try {
    const changed = key !== currentKey;
    if (changed || needsPoints) {
      const model = changed ? createOrbital(n, l, basis) : currentModel;
      const points = sampleOrbital(model);
      currentModel = model;
      currentKey = key;
      self.postMessage({ id, key, points, stats: model.stats }, [points.buffer]);
    }
    if (mode === 'surface') {
      const mesh = isoSurface(currentModel, coverage);
      self.postMessage({ id, key, coverage, mesh }, [mesh.vertices.buffer, mesh.indices.buffer]);
    }
  } catch (error) {
    self.postMessage({ id, key, error: error.message });
  }
};
