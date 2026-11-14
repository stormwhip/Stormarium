(function () {
  'use strict';

  const find = (name) => document.getElementById('orbital-' + name);
  const app = document.querySelector('.orbital-app');
  const stage = find('stage');
  const canvas = find('scene');
  const plot = find('plot');
  const axes = find('axes');
  const status = find('status');
  const BOHR_PM = 52.91772109;
  const letters = ['s', 'p', 'd', 'f', 'g', 'h'];
  const basisNames = [
    [''],
    ['y', 'z', 'x'],
    ['xy', 'yz', 'z^2', 'xz', 'x^2-y^2'],
    ['y(3x^2-y^2)', 'xyz', 'yz^2', 'z^3', 'xz^2', 'z(x^2-y^2)', 'x(x^2-3y^2)'],
  ];
  const elements = ['H', 'He', 'Li', 'Be', 'B', 'C'];
  const presets = [1, 2, 3, 4];
  const coverages = [70, 80, 90, 95];
  const state = { n: 2, l: 1, basis: 0, z: 1, mode: 'cloud', coverage: 90 };
  const initialCamera = { yaw: -0.65, pitch: 0.15, zoom: 1 };
  const camera = { ...initialCamera };
  const modelKey = () => [state.n, state.l, state.basis].join('/');
  const math = (element, tex) => window.katex.render(tex, element);
  const mathHtml = (tex) => window.katex.renderToString(tex);
  const range = (size, offset = 0) => Array.from({ length: size }, (_, i) => i + offset);
  let current = { key: modelKey() };
  let displayedGeometry;
  let renderer;
  let graphicsError = '';
  let workerError = '';
  let renderId = 0;
  let requestId = 0;
  let requestTimer;
  let basisKey;

  const workerSource = document.querySelector('[data-tool-worker]').textContent;
  const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
  const worker = new Worker(workerUrl);
  URL.revokeObjectURL(workerUrl);
  worker.onmessage = ({ data }) => {
    if (data.key !== modelKey()) return;
    if (data.error && data.id === requestId) {
      workerError = '轨道计算失败';
    } else if (data.points) {
      current.points = data.points;
      current.stats = data.stats;
      updateStatistics();
    } else if (data.mesh && data.coverage === state.coverage) {
      current.mesh = data.mesh;
      current.coverage = data.coverage;
    }
    requestDraw();
  };
  worker.onerror = () => {
    workerError = '轨道计算失败';
    requestDraw();
  };

  function orbitalName(n, l, basis, renderMath = true) {
    const type = renderMath ? '\\mathrm{' + letters[l] + '}' : letters[l];
    if (l === 0) return n + type;
    const subscript = basisNames[l]?.[basis + l] ?? String(basis);
    return n + type + (renderMath ? '_{' + subscript + '}' : ' ' + subscript);
  }

  function ionName(z) {
    const charge = z === 2 ? '+' : (z - 1) + '+';
    return '\\mathrm{' + elements[z - 1] + '}' + (z === 1 ? '' : '^{' + charge + '}');
  }

  function makeButtons(name, values, label, select, accessibleLabel = label) {
    const group = find(name);
    group.replaceChildren(...values.map((value) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.value = value;
      button.setAttribute('aria-label', accessibleLabel(value));
      math(button, label(value));
      button.addEventListener('click', () => change(select(value)));
      return button;
    }));
  }

  function press(name, active) {
    for (const button of find(name).children) {
      button.setAttribute('aria-pressed', Number(button.dataset.value) === active);
    }
  }

  function updateControls() {
    const { n, l, basis, z, mode, coverage } = state;
    const buttonKey = n + '/' + l;
    if (basisKey !== buttonKey) {
      makeButtons('basis', range(2 * l + 1, -l), (m) => orbitalName(n, l, m),
        (m) => ({ basis: m }), (m) => orbitalName(n, l, m, false));
      basisKey = buttonKey;
    }
    press('presets', n === l + 1 && basis === 0 ? n : 0);
    press('n', n);
    press('l', l);
    press('basis', basis);
    press('z', z);
    press('cover', coverage);
    for (const button of find('l').children) button.disabled = Number(button.dataset.value) >= n;
    for (const button of app.querySelectorAll('[data-mode]')) {
      button.setAttribute('aria-pressed', button.dataset.mode === mode);
    }
    find('cover-controls').hidden = mode !== 'surface';
    find('current').innerHTML = mathHtml(orbitalName(n, l, basis)) + '<small>' + mathHtml(ionName(z)) + '</small>';
    math(find('quantum'), 'n=' + n + '\\quad \\ell=' + l + '\\quad \\mu=' + basis);
  }

  function change(next) {
    Object.assign(state, next);
    state.l = Math.min(state.l, state.n - 1);
    if (Math.abs(state.basis) > state.l) state.basis = 0;
    if (current.key !== modelKey()) current = { key: modelKey() };
    workerError = '';
    updateControls();
    updateStatistics();
    requestModel();
    requestDraw();
  }

  function requestModel() {
    clearTimeout(requestTimer);
    const needsPoints = !current.points;
    const needsSurface = state.mode === 'surface' && current.coverage !== state.coverage;
    if (!needsPoints && !needsSurface) return;
    const request = { ...state, id: ++requestId, needsPoints };
    requestTimer = setTimeout(() => worker.postMessage(request), 35);
  }

  function updateStatistics() {
    const stats = current.stats;
    for (const name of ['mode', 'mean', 'r90', 'r99']) {
      const node = find('stat-' + name);
      if (!stats) {
        node.textContent = '—';
        continue;
      }
      const value = stats[name] / state.z;
      node.innerHTML = mathHtml(value.toFixed(2) + '\\,a_0')
        + '<small>' + mathHtml((value * BOHR_PM).toFixed(1) + '\\,\\mathrm{pm}') + '</small>';
    }
    math(find('stat-nodes'), (state.n - state.l - 1) + '\\,/\\,' + state.l);
    drawChart();
  }

  function drawChart() {
    const stats = current.stats;
    const width = plot.clientWidth;
    const height = plot.clientHeight;
    if (!stats || !width || !height) {
      plot.replaceChildren();
      return;
    }
    const { z } = state;
    const x0 = 40;
    const y0 = height - 22;
    const w = width - x0 - 10;
    const h = y0 - 8;
    const extent = stats.extent / z;
    const dy = chartStep(stats.peak * z / 4);
    const dx = chartStep(extent / 5);
    const rows = Math.ceil(stats.peak * z * 1.08 / dy);
    const y = (density) => y0 - h * density / (rows * dy);
    const x = (r) => x0 + w * r / extent;
    const text = (value) => +value.toPrecision(4);
    const grid = range(rows + 1).map((i) => {
      const yy = y(i * dy);
      return '<path d="M' + x0 + ' ' + yy + 'H' + (x0 + w) + '" stroke="var(--line)"/>'
        + '<text x="' + (x0 - 7) + '" y="' + (yy + 4) + '" text-anchor="end">' + text(i * dy) + '</text>';
    }).join('');
    const ticks = range(Math.floor(extent / dx) + 1).map((i) => {
      return '<text x="' + x(i * dx) + '" y="' + (y0 + 16) + '" text-anchor="middle">' + text(i * dx) + '</text>';
    }).join('');
    const curve = stats.curve.map((value, i) => {
      return (x0 + w * i / (stats.curve.length - 1)).toFixed(2) + ',' + y(value * z).toFixed(2);
    }).join(' L');
    plot.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    plot.innerHTML = '<g font-size="10" fill="var(--text-soft)">' + grid + ticks + '</g>'
      + '<path d="M' + curve + ' L' + (x0 + w) + ',' + y0 + ' H' + x0 + 'Z" fill="var(--brand-soft)"/>'
      + '<path d="M' + x0 + ' 8V' + y0 + 'H' + (x0 + w) + '" fill="none" stroke="var(--line-strong)"/>'
      + ['mode', 'mean'].map((name) => '<path d="M' + x(stats[name] / z) + ' 8V' + y0
        + '" stroke="var(--orb-' + name + '-line)" stroke-dasharray="4 4"/>').join('')
      + '<path d="M' + curve + '" fill="none" stroke="var(--brand)" stroke-width="2" stroke-linejoin="round"/>';
  }

  function chartStep(ideal) {
    const power = 10 ** Math.floor(Math.log10(ideal));
    return [1, 2, 2.5, 5, 10].find((tick) => tick * power >= ideal) * power;
  }

  function createRenderer() {
    const gl = canvas.getContext('webgl', { alpha: true, antialias: true });
    if (!gl) throw new Error('WebGL');
    const vertexSource = [
      'attribute vec3 position, normal;',
      'attribute float phase;',
      'uniform mat3 rotation;',
      'uniform vec2 scale;',
      'uniform float pointSize;',
      'varying float signValue;',
      'varying vec3 worldNormal;',
      'void main() {',
      '  vec3 p = rotation * position;',
      '  gl_Position = vec4(p.xy * scale, -0.08 * p.z, 1.0);',
      '  gl_PointSize = pointSize;',
      '  signValue = phase;',
      '  worldNormal = rotation * normal;',
      '}',
    ].join('\n');
    const fragmentSource = [
      'precision mediump float;',
      'uniform vec3 positive, negative;',
      'uniform bool surface;',
      'varying float signValue;',
      'varying vec3 worldNormal;',
      'void main() {',
      '  vec3 tint = signValue > 0.0 ? positive : negative;',
      '  if (surface) {',
      '    vec3 n = normalize(worldNormal);',
      '    vec3 light = normalize(vec3(-0.35, 0.52, 0.78));',
      '    float diffuse = max(dot(n, light), 0.0);',
      '    float specular = pow(max(dot(n, normalize(light + vec3(0., 0., 1.))), 0.0), 34.0);',
      '    gl_FragColor = vec4(tint * (0.40 + 0.64 * diffuse) + vec3(0.19 * specular), 1.0);',
      '  } else {',
      '    float alpha = 0.22 * (1.0 - smoothstep(0.16, 0.72, length(gl_PointCoord - 0.5)));',
      '    gl_FragColor = vec4(tint, alpha);',
      '  }',
      '}',
    ].join('\n');
    function compile(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    }
    const program = gl.createProgram();
    const vertex = compile(gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const uniform = (name) => gl.getUniformLocation(program, name);
    const uniforms = Object.fromEntries(['rotation', 'scale', 'pointSize', 'positive', 'negative', 'surface']
      .map((name) => [name, uniform(name)]));
    const position = gl.getAttribLocation(program, 'position');
    const phase = gl.getAttribLocation(program, 'phase');
    const normal = gl.getAttribLocation(program, 'normal');
    const buffer = gl.createBuffer();
    const indexBuffer = gl.createBuffer();
    const indexedSurfaces = gl.getExtension('OES_element_index_uint');
    let elementCount = 0;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.enableVertexAttribArray(position);
    gl.enableVertexAttribArray(phase);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    return {
      upload(geometry, surface) {
        const stride = surface ? 28 : 16;
        let vertices = geometry;
        if (surface) {
          vertices = geometry.vertices;
          elementCount = geometry.indices.length;
          if (indexedSurfaces) {
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.indices, gl.STATIC_DRAW);
          } else {
            vertices = new Float32Array(elementCount * 7);
            for (let i = 0; i < elementCount; i++) {
              const offset = geometry.indices[i] * 7;
              for (let j = 0; j < 7; j++) vertices[i * 7 + j] = geometry.vertices[offset + j];
            }
          }
        } else {
          elementCount = geometry.length / 4;
        }
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
        gl.vertexAttribPointer(position, 3, gl.FLOAT, false, stride, 0);
        gl.vertexAttribPointer(phase, 1, gl.FLOAT, false, stride, 12);
        if (surface) {
          gl.enableVertexAttribArray(normal);
          gl.vertexAttribPointer(normal, 3, gl.FLOAT, false, stride, 16);
        } else {
          gl.disableVertexAttribArray(normal);
          gl.vertexAttrib3f(normal, 0, 0, 1);
        }
      },
      paint(view, geometry, surface, colors) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        if (!geometry) return;
        gl.uniformMatrix3fv(uniforms.rotation, false, view.matrix);
        gl.uniform2f(uniforms.scale, 2 * view.unit / view.width, 2 * view.unit / view.height);
        gl.uniform1f(uniforms.pointSize, view.ratio * 1.55);
        gl.uniform3fv(uniforms.positive, colors.positive);
        gl.uniform3fv(uniforms.negative, colors.negative);
        gl.uniform1i(uniforms.surface, surface);
        if (surface) {
          gl.enable(gl.DEPTH_TEST);
          gl.disable(gl.BLEND);
        } else {
          gl.disable(gl.DEPTH_TEST);
          gl.enable(gl.BLEND);
        }
        if (surface && indexedSurfaces) gl.drawElements(gl.TRIANGLES, elementCount, gl.UNSIGNED_INT, 0);
        else gl.drawArrays(surface ? gl.TRIANGLES : gl.POINTS, 0, elementCount);
      },
    };
  }

  function resetRenderer() {
    displayedGeometry = null;
    try {
      renderer = createRenderer();
      graphicsError = '';
    } catch (error) {
      renderer = null;
      graphicsError = '三维视图无法启动';
      console.error(error);
    }
    requestDraw();
  }
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    renderer = null;
    graphicsError = '三维视图正在恢复';
    requestDraw();
  });
  canvas.addEventListener('webglcontextrestored', resetRenderer);

  function viewTransform() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const c = Math.cos(camera.yaw);
    const s = Math.sin(camera.yaw);
    const p = Math.cos(camera.pitch);
    const q = Math.sin(camera.pitch);
    return {
      width, height, ratio,
      unit: Math.min(height * 0.43, width * 0.41) * camera.zoom,
      matrix: [c, q * s, -p * s, -s, q * c, -p * c, 0, p, q],
    };
  }

  function drawAxes(view) {
    const { width, height, matrix, unit } = view;
    const project = ([x, y, z]) => [
      (width / 2 + unit * (matrix[0] * x + matrix[3] * y + matrix[6] * z)).toFixed(2),
      (height / 2 - unit * (matrix[1] * x + matrix[4] * y + matrix[7] * z)).toFixed(2),
    ];
    const colors = ['var(--orb-mode-line)', 'var(--orb-mean-line)', 'var(--orb-negative)'];
    const lines = ['x', 'y', 'z'].map((label, axis) => {
      const a = [0, 0, 0];
      const b = [0, 0, 0];
      a[axis] = -0.98;
      b[axis] = 0.98;
      const start = project(a);
      const end = project(b);
      return '<path d="M' + start.join(',') + 'L' + end.join(',') + '" stroke="' + colors[axis]
        + '" stroke-opacity=".35"/><text x="' + (Number(end[0]) + 5) + '" y="' + (Number(end[1]) - 4)
        + '" fill="' + colors[axis] + '" font-size="12" font-family="serif" font-style="italic">' + label + '</text>';
    }).join('');
    const rings = [0.32, 0.63].map((radius) => {
      const path = range(64).map((i) => {
        const t = i * Math.PI / 32;
        return project([radius * Math.cos(t), radius * Math.sin(t), 0]).join(',');
      }).join('L');
      return '<path d="M' + path + 'Z" stroke="var(--line-strong)" opacity=".75" fill="none"/>';
    }).join('');
    axes.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    axes.innerHTML = rings + lines;
  }

  function updateScale(view) {
    const scale = find('scale');
    scale.hidden = !current.stats;
    if (!current.stats) return;
    const pixelsPerBohr = view.unit * state.z / current.stats.r99;
    const ideal = 98 / pixelsPerBohr;
    const power = 10 ** Math.floor(Math.log10(ideal));
    const tick = [10, 5, 2, 1].find((value) => value * power <= ideal) * power;
    const label = String(+tick.toPrecision(2)) + '\\,a_0\\;\\cdot\\;' + (tick * BOHR_PM).toFixed(tick < 0.2 ? 1 : 0) + '\\,\\mathrm{pm}';
    const node = find('scale-label');
    if (node.dataset.value !== label) {
      math(node, label);
      node.dataset.value = label;
    }
    scale.lastElementChild.style.width = (tick * pixelsPerBohr) + 'px';
  }

  function rgb(hex) {
    return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  }
  function requestDraw() {
    if (renderId) return;
    renderId = requestAnimationFrame(() => {
      renderId = 0;
      const view = viewTransform();
      if (!view.width || !view.height) return;
      const width = Math.round(view.width * view.ratio);
      const height = Math.round(view.height * view.ratio);
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const surface = state.mode === 'surface';
      const geometry = surface ? (current.coverage === state.coverage && current.mesh) : current.points;
      drawAxes(view);
      updateScale(view);
      const message = graphicsError || workerError || (geometry ? '' : '正在计算轨道');
      if (status.textContent !== message) status.textContent = message;
      status.hidden = !message;
      if (renderer) {
        if (geometry && displayedGeometry !== geometry) {
          renderer.upload(geometry, surface);
          displayedGeometry = geometry;
        }
        const style = getComputedStyle(app);
        renderer.paint(view, geometry, surface, {
          positive: rgb(style.getPropertyValue('--orb-positive').trim()),
          negative: rgb(style.getPropertyValue('--orb-negative').trim()),
        });
      }
    });
  }

  function rotate(dx, dy) {
    camera.yaw += dx;
    camera.pitch = Math.max(-1.55, Math.min(1.55, camera.pitch + dy));
    requestDraw();
  }
  function zoom(factor) {
    camera.zoom = Math.max(0.42, Math.min(3.8, camera.zoom * factor));
    requestDraw();
  }
  function resetCamera() {
    Object.assign(camera, initialCamera);
    requestDraw();
  }

  const pointers = new Map();
  function pinchDistance() {
    const [a, b] = pointers.values();
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || pointers.size >= 2) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const before = pointers.size === 2 ? pinchDistance() : 0;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const after = pinchDistance();
      if (before && after) zoom(after / before);
    } else {
      rotate((event.clientX - previous.x) * 0.012, (event.clientY - previous.y) * 0.012);
    }
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(type, (event) => pointers.delete(event.pointerId));
  }
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    zoom(Math.exp(-Math.sign(event.deltaY) * 0.12));
  }, { passive: false });
  canvas.addEventListener('dblclick', resetCamera);
  const cameraActions = {
    reset: resetCamera, out: () => zoom(0.84), in: () => zoom(1.19),
    ArrowLeft: () => rotate(-0.14, 0), ArrowRight: () => rotate(0.14, 0),
    ArrowUp: () => rotate(0, -0.14), ArrowDown: () => rotate(0, 0.14),
  };
  canvas.addEventListener('keydown', (event) => {
    const shortcuts = { '+': 'in', '=': 'in', '-': 'out', Home: 'reset' };
    const key = shortcuts[event.key] || event.key;
    if (!Object.hasOwn(cameraActions, key)) return;
    event.preventDefault();
    cameraActions[key]();
  });
  for (const button of app.querySelectorAll('[data-camera]')) {
    button.addEventListener('click', cameraActions[button.dataset.camera]);
  }
  for (const button of app.querySelectorAll('[data-mode]')) {
    button.addEventListener('click', () => change({ mode: button.dataset.mode }));
  }

  for (const element of app.querySelectorAll('[data-math]')) math(element, element.dataset.math);
  makeButtons('presets', presets, (n) => orbitalName(n, n - 1, 0),
    (n) => ({ n, l: n - 1, basis: 0 }), (n) => orbitalName(n, n - 1, 0, false));
  makeButtons('n', range(6, 1), String, (n) => ({ n }));
  makeButtons('l', range(6), (l) => '\\mathrm{' + letters[l] + '}', (l) => ({ l }), (l) => letters[l]);
  makeButtons('z', range(6, 1), ionName, (z) => ({ z }),
    (z) => z === 1 ? '氢原子' : elements[z - 1] + ' ' + (z - 1) + ' 价正离子');
  makeButtons('cover', coverages, (value) => value + '\\%', (coverage) => ({ coverage }), (value) => value + '%');
  new MutationObserver(requestDraw).observe(document.documentElement, { attributeFilter: ['data-theme'] });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', requestDraw);
  const resize = new ResizeObserver(() => {
    requestDraw();
    drawChart();
  });
  resize.observe(stage);
  resize.observe(plot);
  resetRenderer();
  change({});
})();
