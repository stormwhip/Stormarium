"use strict";

const $ = id => document.getElementById(id);
const icon = id => '<svg class="icon" aria-hidden="true"><use href="#' + id + '"/></svg>';
const TAU = 2 * Math.PI;
const clamp = (x, min, max) => Math.min(max, Math.max(min, x));
const wavelength = ['lambda', '光波长 λ', 'nm', 400, 700, 1, 532];
const index = ['n', '薄膜折射率 n₂', '', 1.10, 1.80, .01, 1.33, 2];
const modes = {
  young: {
    title:'杨氏干涉', short:'双缝叠加', plane:'接收屏', half:6, scale:2,
    params:[wavelength,['d','双缝间距 d','mm',.15,.95,.01,.40,2],['D','缝屏距离 D','m',.5,2,.01,1,2]],
    reason:'两条窄缝同相、等强。采用笔记中的近轴条件 x、d ≪ D，中央为零级亮纹。',
    formula:'<math><mi>δ</mi><mo>≈</mo><mfrac><mrow><mi>x</mi><mi>d</mi></mrow><mi>D</mi></mfrac></math><math><mi>Δ</mi><mi>x</mi><mo>=</mo><mfrac><mrow><mi>λ</mi><mi>D</mi></mrow><mi>d</mi></mfrac></math>',
    metric:p => ['近轴条纹间距',(p.lambda * p.D / p.d / 1000).toFixed(2),'mm']
  },
  angle: {
    title:'等倾干涉', short:'平行薄膜', plane:'透镜后焦平面', half:26, scale:10,
    params:[wavelength,['t','薄膜厚度 e','μm',40,240,1,120],['n','薄膜折射率 n₂','',1.10,1.80,.01,1.50,2],['f','透镜焦距 f','mm',75,210,1,120]],
    reason:'均匀薄膜由面光源照明。两组光的入射角相同，经透镜在后焦平面形成同一级亮环。',
    formula:'<math><mi>δ</mi><mo>=</mo><mn>2</mn><msub><mi>n</mi><mn>2</mn></msub><mi>e</mi><mi>cos</mi><mo>⁡</mo><mi>γ</mi><mo>+</mo><mfrac><mi>λ</mi><mn>2</mn></mfrac></math><math><mi>tan</mi><mo>⁡</mo><mi>i</mi><mo>=</mo><mfrac><mi>r</mi><mi>f</mi></mfrac></math>',
    metric:p => ['视场半宽对应倾角',(Math.atan(fieldHalf('angle',p) / p.f) * 180 / Math.PI).toFixed(1),'°']
  },
  thick: {
    title:'等厚干涉', short:'弯曲薄膜', plane:'薄膜像面', half:6, scale:2,
    params:[wavelength,index,['g','横向厚度梯度 g','μm/mm',.04,.23,.01,.11,2],['b','纵向弯曲量 b','μm',0,1.2,.01,.65,2]],
    reason:'平行光以相同角度近正入射。膜厚不均匀，反射条纹沿薄膜的等厚线排列。',
    formula:'<math><mi>δ</mi><mo>≈</mo><mn>2</mn><msub><mi>n</mi><mn>2</mn></msub><mi>d</mi><mo>+</mo><mfrac><mi>λ</mi><mn>2</mn></mfrac></math><math><mi>Δ</mi><mi>d</mi><mo>=</mo><mfrac><mi>λ</mi><mrow><mn>2</mn><msub><mi>n</mi><mn>2</mn></msub></mrow></mfrac></math>',
    metric:p => ['相邻亮纹的膜厚差',(p.lambda / (2000 * p.n)).toFixed(3),'μm']
  },
  wedge: {
    title:'劈尖干涉', short:'空气劈尖', plane:'劈尖像面', half:6, scale:2,
    params:[wavelength,['alpha','劈尖夹角 θ','mrad',.045,.35,.005,.145,3]],
    reason:'单色平行光近正入射。距离 x 从接触棱边起算，空气膜线性增厚，接触处为暗纹。',
    formula:'<math><mi>δ</mi><mo>≈</mo><mn>2</mn><mi>x</mi><mi>θ</mi><mo>+</mo><mfrac><mi>λ</mi><mn>2</mn></mfrac></math><math><mi>Δ</mi><mi>x</mi><mo>≈</mo><mfrac><mi>λ</mi><mrow><mn>2</mn><mi>θ</mi></mrow></mfrac></math>',
    metric:p => ['条纹间距',(p.lambda / (2000 * p.alpha)).toFixed(2),'mm']
  },
  newton: {
    title:'牛顿环', short:'球面空气层', plane:'空气层像面', half:2.5, scale:1,
    params:[wavelength,['R','透镜曲率半径 R','m',.45,3,.01,1.2,2]],
    reason:'单色光近正入射。平凸透镜与平玻璃理想接触，反射环纹内疏外密，中心为零级暗斑。',
    formula:'<math><mi>δ</mi><mo>≈</mo><mfrac><msup><mi>r</mi><mn>2</mn></msup><mi>R</mi></mfrac><mo>+</mo><mfrac><mi>λ</mi><mn>2</mn></mfrac></math><math><msub><mi>r</mi><mi>k</mi></msub><mo>≈</mo><msqrt><mrow><mo>(</mo><mi>k</mi><mo>−</mo><mfrac><mn>1</mn><mn>2</mn></mfrac><mo>)</mo><mi>R</mi><mi>λ</mi></mrow></msqrt></math>',
    metric:p => ['中心归一化光强',(100 * intensity('newton',p,0,0)).toFixed(1),'%']
  }
};
function intensity(key,p,x,y) {
  if (key === 'young') {
    const phase = Math.PI * x * p.d * 1000 / (p.D * p.lambda);
    return Math.cos(phase) ** 2;
  }
  // One relative π phase shift for the pair of reflected rays.
  return Math.sin(Math.PI * filmPath(key,p,x,y) * 1000 / p.lambda) ** 2;
}
function filmPath(key,p,x,y) {
  if (key === 'angle') {
    const r2 = x*x + y*y;
    const sin2 = r2 / (r2 + p.f*p.f);
    return 2 * p.n * p.t * Math.sqrt(1 - sin2 / (p.n*p.n));
  }
  if (key === 'thick') return 2 * p.n * (.30 + p.g * (x + 6) + p.b * (y / 6)**2);
  if (key === 'wedge') return 2 * (x + 6) * p.alpha;
  return (x*x + y*y) / p.R;
}
const sampleColors = {A:'#cfb1ff', B:'#ffb579'};
const fieldHalf = (key,p) => key === 'angle' ? Math.max(26,p.f*Math.tan(.222)) : modes[key].half;
function sameOrderSamples(key,p) {
  if (key === 'young') return null;
  const half = fieldHalf(key,p);
  const lambda = p.lambda / 1000;
  const orderAt = path => path/lambda + .5;
  const chooseOrder = (target,edge1,edge2) => clamp(Math.round(orderAt(target)),
    Math.max(1,Math.ceil(orderAt(Math.min(edge1,edge2)))),
    Math.floor(orderAt(Math.max(edge1,edge2))));
  const path = (x,y=0) => filmPath(key,p,x,y);
  let k, points, detail;
  if (key === 'angle' || key === 'newton') {
    k = chooseOrder(path(half*.60),path(0),path(half*.87));
    const delta = (k-.5)*lambda;
    let radius;
    if (key === 'angle') {
      const sin2 = clamp(p.n*p.n*(1-(delta/(2*p.n*p.t))**2),0,1);
      radius = p.f*Math.sqrt(sin2/(1-sin2));
      detail = '两组光的入射角相同 · ' + (Math.atan(radius/p.f)*180/Math.PI).toFixed(2) + '°';
    } else {
      radius = Math.sqrt(delta*p.R);
      detail = '两点到接触点距离相同 · ' + radius.toFixed(2) + ' mm';
    }
    points = [[-radius*.91,-radius*Math.sqrt(1-.91**2)],[radius*.91,radius*Math.sqrt(1-.91**2)]];
  } else {
    const y = half*.50;
    k = chooseOrder(path(1.2,y),path(-half*.88,y),path(half*.88,y));
    const delta = (k-.5)*lambda;
    const n = key === 'thick' ? p.n : 1;
    const thickness = delta/(2*n);
    const x = key === 'thick' ? (thickness-.30-p.b*(y/6)**2)/p.g-6 : thickness/p.alpha-6;
    points = [[x,-y],[x,y]];
    detail = '两点的膜厚相同 · ' + thickness.toFixed(3) + ' μm';
  }
  return {k,points,detail};
}
function spectrum(nm) {
  const stops = [[400,[144,87,255]],[450,[89,121,255]],[485,[72,199,255]],
    [505,[65,243,202]],[532,[107,253,139]],[560,[180,255,111]],[585,[255,230,97]],
    [610,[255,161,99]],[645,[255,104,114]],[700,[232,71,110]]];
  const next = stops.findIndex(([wave]) => wave >= nm);
  if (next <= 0) return stops[0][1];
  const [a, rgb] = stops[next - 1], [b, end] = stops[next];
  return rgb.map((v,i) => Math.round(v + (end[i]-v) * (nm-a)/(b-a)));
}
const values = Object.fromEntries(Object.entries(modes).map(([key,m]) => [
  key,Object.fromEntries(m.params.map(([id,,,,,,initial]) => [id,initial]))
]));
const canvas = $('scene'), fringes = $('fringes');
const ctx = canvas.getContext('2d'), fringeCtx = fringes.getContext('2d');
const bitmap = document.createElement('canvas'), bitmapCtx = bitmap.getContext('2d');
const initialCamera = {yaw:.55,pitch:.44,zoom:1};
const camera = {...initialCamera};
let current = 'young', gray = false, pointer = null, dirtyFringe = true, frame = 0;
let samples = null, focus = 'all';
const tablist = document.querySelector('.tabs');
const modeKeys = Object.keys(modes);
tablist.innerHTML = modeKeys.map((key,i) => '<button class="tab" id="tab-' + key +
  '" role="tab" aria-controls="experiment" data-key="' + key +
  '"><span class="shape">' + icon(key) + '</span><span><strong>' + modes[key].title +
  '</strong><small>' + String(i+1).padStart(2,'0') + ' · ' + modes[key].short + '</small></span></button>').join('');
function requestPaint(rebuildFringe = false) {
  dirtyFringe ||= rebuildFringe;
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    if (dirtyFringe) renderFringes();
    drawScene();
    dirtyFringe = false;
  });
}
function renderFringes() {
  const m = modes[current], p = values[current];
  const w = fringes.clientWidth, h = fringes.clientHeight;
  if (!w || !h) return;
  const aspect = h / w, half = fieldHalf(current,p);
  const bw = Math.round(clamp(w * 1.35, 320, 700)), bh = Math.round(bw * aspect);
  bitmap.width = bw; bitmap.height = bh;
  const rgb = gray ? [244,245,252] : spectrum(p.lambda);
  const image = bitmapCtx.createImageData(bw,bh);
  const data = image.data;
  for (let row=0; row<bh; row++) {
    const y = (1 - (row + .5) * 2 / bh) * half * aspect;
    for (let col=0; col<bw; col++) {
      const x = ((col + .5) * 2 / bw - 1) * half;
      const light = intensity(current,p,x,y) ** .78;
      const i = (row*bw+col)*4;
      data[i] = 6 + (rgb[0]-6)*light;
      data[i+1] = 8 + (rgb[1]-8)*light;
      data[i+2] = 16 + (rgb[2]-16)*light;
      data[i+3] = 255;
    }
  }
  bitmapCtx.putImageData(image,0,0);
  const resolution = Math.min(devicePixelRatio || 1,2);
  fringes.width = Math.round(w*resolution); fringes.height = Math.round(h*resolution);
  fringeCtx.drawImage(bitmap,0,0,fringes.width,fringes.height);
  $('scale-line').style.width = m.scale * w / (2*half) + 'px';
  if (samples) {
    fringeCtx.save();
    fringeCtx.scale(resolution,resolution);
    for (const [i,[x,y]] of samples.points.entries()) {
      const name = i ? 'B' : 'A';
      paintSample(fringeCtx,w/2+x*w/(2*half),h/2-y*w/(2*half),name,i ? 15 : -15,focus === 'all' || focus === name);
    }
    fringeCtx.restore();
  }
}
function paintSample(context,x,y,name,offset,active=true) {
  const color = sampleColors[name];
  context.save();
  context.globalAlpha = active ? 1 : .35;
  context.lineWidth = 2.5;
  context.strokeStyle = '#111426';
  context.fillStyle = color;
  context.beginPath(); context.arc(x,y,4,0,TAU); context.fill(); context.stroke();
  context.beginPath(); context.roundRect(x-9,y+offset-7.5,18,15,4);
  context.fillStyle = '#14182f'; context.fill();
  context.strokeStyle = color; context.lineWidth = 1; context.stroke();
  context.fillStyle = color;
  context.font = '700 10px ui-monospace,Consolas,monospace';
  context.textAlign = 'center'; context.textBaseline = 'middle';
  context.fillText(name,x,y+offset+.5);
  context.restore();
}
function showParameters() {
  const m = modes[current];
  $('params').innerHTML = m.params.map(([key,label,unit,min,max,step,,digits=0]) =>
    '<div class="param"><label for="param-' + key + '">' + label +
    '<output id="value-' + key + '" for="param-' + key + '"></output></label>' +
    '<input id="param-' + key + '" data-key="' + key + '" type="range" min="' + min +
    '" max="' + max + '" step="' + step + '"><div class="bounds" aria-hidden="true"><span>' +
    min.toFixed(digits) + '</span><span>' + max.toFixed(digits) +
    (unit ? ' ' + unit : '') + '</span></div></div>').join('');
}
function updateReadout() {
  const m = modes[current], p = values[current];
  for (const [key,,unit,,,,,digits=0] of m.params) {
    const slider = $('param-' + key);
    const reading = p[key].toFixed(digits) + (unit ? ' ' + unit : '');
    slider.value = p[key];
    slider.setAttribute('aria-valuetext',reading);
    $('value-' + key).textContent = reading;
  }
  const [label,value,unit] = m.metric(p);
  $('measure').innerHTML = label + '　<b>' + value + (unit === 'mm' || unit === 'μm' ? ' ' : '') + unit + '</b>';
  $('spectral-dot').style.background = 'rgb(' + spectrum(p.lambda).join(',') + ')';
  $('wavelength').textContent = 'λ ' + p.lambda + ' nm';
  $('probe').textContent = '归一化光强';
  samples = sameOrderSamples(current,p);
  $('sample-info').hidden = !samples;
  if (samples) {
    $('sample-heading').textContent = 'A、B 同属第 ' + samples.k + ' 级亮纹';
    $('sample-detail').textContent = samples.detail;
  }
  requestPaint(true);
}
function select(key) {
  current = key;
  const m = modes[key];
  for (const button of tablist.children) {
    const selected = button.dataset.key === key;
    button.setAttribute('aria-selected',selected);
    button.tabIndex = selected ? 0 : -1;
  }
  $('experiment').setAttribute('aria-labelledby','tab-' + key);
  $('hud').innerHTML = '<i></i>' + String(modeKeys.indexOf(key)+1).padStart(2,'0') + ' / ' + m.short;
  $('legend').innerHTML = key === 'young'
    ? '<span><i class="raykey in"></i>入射光</span><span><i class="raykey"></i>经 S₁</span><span><i class="raykey second"></i>经 S₂</span>'
    : '<span><b class="color-a">A</b> 第 1 组</span><span><b class="color-b">B</b> 第 2 组</span><span><i class="raykey solid"></i>上表面反射</span><span><i class="raykey dashed"></i>下表面反射</span>';
  $('sample-controls').hidden = key === 'young';
  setFocus('all');
  $('plane').textContent = m.plane;
  $('scale-text').textContent = m.scale + ' mm';
  fringes.setAttribute('aria-label',m.title + '在' + m.plane + '上的归一化光强分布');
  $('reason').textContent = m.reason;
  $('formula').innerHTML = m.formula;
  showParameters();
  updateReadout();
}
tablist.addEventListener('click', e => {
  const tab = e.target.closest('[data-key]');
  if (tab) select(tab.dataset.key);
});
tablist.addEventListener('keydown', e => {
  let index = modeKeys.indexOf(current);
  if (e.key === 'ArrowRight') index = (index+1) % modeKeys.length;
  else if (e.key === 'ArrowLeft') index = (index+modeKeys.length-1) % modeKeys.length;
  else if (e.key === 'Home') index = 0;
  else if (e.key === 'End') index = modeKeys.length-1;
  else return;
  e.preventDefault();
  select(modeKeys[index]);
  $('tab-' + current).focus();
});
function setFocus(group) {
  focus = group;
  for (const button of $('sample-controls').children) {
    button.setAttribute('aria-pressed',button.dataset.focus === focus);
  }
}
$('sample-controls').addEventListener('click', e => {
  const button = e.target.closest('button[data-focus]');
  if (!button) return;
  setFocus(button.dataset.focus);
  requestPaint(true);
});
$('params').addEventListener('input', e => {
  const key = e.target.dataset.key;
  if (!key) return;
  values[current][key] = e.target.valueAsNumber;
  updateReadout();
});
$('reset-params').addEventListener('click', () => {
  for (const [key,,,,,,initial] of modes[current].params) values[current][key] = initial;
  updateReadout();
});
$('gray').addEventListener('click', () => {
  gray = !gray;
  $('gray').setAttribute('aria-pressed',gray);
  requestPaint(true);
});
fringes.addEventListener('pointermove', e => {
  const rect = fringes.getBoundingClientRect(), half = fieldHalf(current,values[current]);
  const x = (2*(e.clientX-rect.left)/rect.width-1)*half;
  const y = (rect.height-2*(e.clientY-rect.top))/rect.width*half;
  $('probe').textContent = 'I / Iₘₐₓ  ' + intensity(current,values[current],x,y).toFixed(3);
});
fringes.addEventListener('pointerleave', () => $('probe').textContent = '归一化光强');


const rayColors = {in:'#aab8d8',first:'#b093ff',second:'#60e8ee'};
const plateColor = 'rgba(76,97,155,.32)';
const plateEdge = 'rgba(156,176,231,.72)';
const point = (x,y,z) => [x,y,z];
function setupGeometry() {
  const p = values[current];
  const geo = {faces:[], rays:[], marks:[], labels:[], screens:[], details:[], sampleMarks:[]};
  const face = (vertices,fill=plateColor,stroke=plateEdge) => geo.faces.push({vertices,fill,stroke});
  const path = (vertices,kind,main=true,group=null) => geo.rays.push({vertices,kind,main,group});
  const label = (name,at,dx,dy) => geo.labels.push({name,at,dx,dy});
  const mark = (at,color) => geo.marks.push({at,color});
  const acrossX = (x,y1,y2,z1,z2) => [point(x,y1,z2),point(x,y2,z2),point(x,y2,z1),point(x,y1,z1)];
  const horizontal = (x1,x2,y1,y2,z) => [point(x1,y1,z),point(x2,y1,z),point(x2,y2,z),point(x1,y2,z)];
  const curve = (x,y,z,rx,ry) => Array.from({length:40},(_,i) => {
    const a = i*TAU/40;
    return [x+rx*Math.cos(a),y+ry*Math.sin(a),z];
  });
  if (current === 'young') {
    const slitX = -.65, screenX = 2.25 + p.D*.83, sourceX = -3.85;
    const z = 1.35, d = .22 + p.d*.83, bounds = 1.38, slitWidth = .085;
    const source = point(sourceX,0,z), a = point(slitX,-d,z), b = point(slitX,d,z);
    const screen = acrossX(screenX,-1.53,1.53,.20,2.62);
    face(acrossX(sourceX-.17,-.39,.39,z-.41,z+.41),'rgba(73,67,144,.62)');
    face(acrossX(sourceX,-.34,.34,z-.35,z+.35),'rgba(94,84,173,.68)');
    for (const [left,right] of [[-bounds,-d-slitWidth],[-d+slitWidth,d-slitWidth],[d+slitWidth,bounds]]) {
      face(acrossX(slitX,left,right,.20,2.58),'rgba(75,93,146,.48)');
    }
    for (const [hole,color] of [[a,rayColors.first],[b,rayColors.second]]) {
      geo.details.push({vertices:[point(slitX,hole[1],.28),point(slitX,hole[1],2.50)],color});
    }
    face(screen,'#101a2e','rgba(164,182,228,.88)');
    geo.screens.push({corners:[screen[0],screen[1],screen[3]],opacity:.72});
    const target = point(screenX,-.32,z+.21);
    const other = point(screenX,.96,z-.35);
    path([source,a],'in'); path([source,b],'in');
    path([a,other],'first',false); path([b,other],'second',false);
    path([a,target],'first'); path([b,target],'second');
    mark(source,'#efdcff'); mark(a,rayColors.first); mark(b,rayColors.second); mark(target,'#f7edff');
    label('相干光源',point(sourceX,0,z+.43),0,-13);
    label('双缝板',point(slitX,0,2.60),0,-15);
    label('S₁',a,-13,-13); label('S₂',b,12,15);
    label('P',target,13,-12);
    label('接收屏',point(screenX,0,2.63),0,-14);
    return geo;
  }
  const angle = current === 'angle';
  const lensZ = angle ? 3.13 : 3.0;
  const screenZ = angle ? lensZ + 1.12 * p.f / 120 : 4.25;
  const splitterZ = 1.92;
  const halfX = 1.66, halfY = 1.24;
  const topZ = (x,y) => {
    if (angle) return .22 + .0027*p.t;
    if (current === 'thick') return .14 + .40*(.30+p.g*(x/halfX+1)*6+p.b*(y/halfY)**2);
    if (current === 'wedge') return 1.75*p.alpha*(x/halfX+1);
    return .22*(x*x+y*y)/p.R;
  };
  const airGap = current === 'wedge' || current === 'newton';
  const top = (x,y) => point(x,y,topZ(x,y));
  const x1 = -halfX, x2 = halfX, y1 = -halfY, y2 = halfY;
  face(horizontal(x1,x2,y1,y2,-.18),'rgba(60,77,127,.42)');
  face(horizontal(x1,x2,y1,y2,0),'rgba(78,104,163,.54)');
  for (const side of [y1,y2]) {
    face([point(x1,side,-.18),point(x2,side,-.18),point(x2,side,0),point(x1,side,0)],'rgba(53,74,133,.43)');
  }
  if (current === 'newton') {
    const radius = 1.53;
    const bottom = curve(0,0,0,radius,radius).map(([x,y])=>top(x,y));
    const topSurface = curve(0,0,topZ(radius,0)+.28,radius,radius);
    face(topSurface,'rgba(94,122,198,.24)');
    for (let i=0;i<bottom.length;i++) {
      const next = (i+1)%bottom.length;
      face([bottom[i],bottom[next],topSurface[next],topSurface[i]],'rgba(88,110,173,.14)','rgba(130,160,222,.15)');
      face([top(0,0),bottom[i],bottom[next]],'rgba(106,126,191,.15)','rgba(121,150,208,.25)');
    }
    for (const r of [.48,.94,1.41]) {
      const vertices = curve(0,0,0,r,r).map(([x,y])=>top(x,y));
      geo.details.push({vertices:[...vertices,vertices[0]],color:'rgba(152,173,236,.32)'});
    }
  } else {
    const divisions = current === 'thick' ? 10 : 1;
    for (let i=0;i<divisions;i++) {
      const a = y1+(y2-y1)*i/divisions, b = y1+(y2-y1)*(i+1)/divisions;
      face([top(x1,a),top(x2,a),top(x2,b),top(x1,b)],'rgba(103,124,193,.29)','rgba(150,176,233,.4)');
    }
    const left = top(x1,y1), right = top(x2,y1), backLeft = top(x1,y2), backRight = top(x2,y2);
    if (airGap) {
      const raise = v => point(v[0],v[1],v[2]+.19);
      face([raise(left),raise(right),raise(backRight),raise(backLeft)],'rgba(109,126,193,.24)');
      face([left,right,raise(right),raise(left)],'rgba(96,116,180,.25)');
    } else {
      face([point(x1,y1,0),point(x2,y1,0),right,left],'rgba(82,102,169,.23)');
      face([point(x1,y2,0),point(x2,y2,0),backRight,backLeft],'rgba(82,102,169,.23)');
    }
  }
  const sourceX = -3.94, sourceHits = [], splitterHits = [];
  const lensRadius = 1.72;
  face(curve(0,0,lensZ,lensRadius,lensRadius*.81),'rgba(105,139,214,.29)','rgba(157,190,245,.76)');
  const screenHalfX = 1.53, screenHalfY = screenHalfX * bitmap.height / bitmap.width;
  const detector = horizontal(-screenHalfX,screenHalfX,-screenHalfY,screenHalfY,screenZ);
  face(detector,'#162031','rgba(160,180,230,.84)');
  geo.screens.push({corners:angle ? [detector[3],detector[2],detector[0]] : [detector[1],detector[0],detector[2]],opacity:.48});
  const half = fieldHalf(current,values[current]);
  for (const [i,[sampleX,sampleY]] of samples.points.entries()) {
    const group = i ? 'B' : 'A';
    const u = sampleX/half, v = sampleY/half;
    const x = angle ? (i ? .51 : -.51) : u*(current === 'newton' ? 1.48 : halfX);
    const y = angle ? (i ? .38 : -.38) : v*(current === 'newton' ? 1.48 : halfY);
    const qx = angle ? sampleX/p.f : .19, qy = angle ? sampleY/p.f : 0;
    const front = top(x,y);
    // Incoming directions reflect off the splitter plane x + z = splitterZ.
    const dz = (splitterZ-front[2]-x)/(1-qx);
    const split = point(x-qx*dz,y-qy*dz,front[2]+dz);
    const travel = split[0]-sourceX;
    const source = point(sourceX,split[1]-qy*travel,split[2]+qx*travel);
    sourceHits.push(source);
    splitterHits.push(split);
    path([source,split,front],'in',true,group);
    const n = airGap ? 1 : p.n;
    const refraction = Math.sqrt(n*n+(n*n-1)*(qx*qx+qy*qy));
    const tx = qx/refraction, ty = qy/refraction;
    const back = point(x+front[2]*tx,y+front[2]*ty,0);
    const exit = top(back[0]+front[2]*tx,back[1]+front[2]*ty);
    const lensHit = ray => point(ray[0]+qx*(lensZ-ray[2]),ray[1]+qy*(lensZ-ray[2]),lensZ);
    for (const ray of [front,exit]) {
      const height = (splitterZ-ray[0]-ray[2])/(1+qx);
      if (height > 0) splitterHits.push(point(ray[0]+qx*height,ray[1]+qy*height,ray[2]+height));
    }
    const direction = angle ? 1 : -1;
    const target = point(direction*u*screenHalfX,direction*v*screenHalfX,screenZ);
    path([front,lensHit(front),target],'first',true,group);
    path([front,back,exit,lensHit(exit),target],'second',true,group);
    geo.sampleMarks.push({at:target,group,offset:i ? 16 : -16});
    geo.sampleMarks.push({at:front,group,offset:0});
  }
  const syMin = Math.min(-.70,...sourceHits.map(ray=>ray[1]-.25));
  const syMax = Math.max(.70,...sourceHits.map(ray=>ray[1]+.25));
  const szMin = Math.min(...sourceHits.map(ray=>ray[2]))-.42;
  const szMax = Math.max(...sourceHits.map(ray=>ray[2]))+.38;
  face(acrossX(sourceX,syMin,syMax,szMin,szMax),'rgba(103,95,175,.33)');
  const splitLeft = Math.min(-.90,...splitterHits.map(ray=>ray[0]-.16));
  const splitRight = Math.max(.90,...splitterHits.map(ray=>ray[0]+.16));
  const splitWidth = Math.max(1.08,...splitterHits.map(ray=>Math.abs(ray[1])+.16));
  const onSplitter = (x,y) => point(x,y,splitterZ-x);
  face([onSplitter(splitLeft,-splitWidth),onSplitter(splitRight,-splitWidth),
    onSplitter(splitRight,splitWidth),onSplitter(splitLeft,splitWidth)],
    'rgba(104,132,201,.17)','rgba(155,185,238,.61)');
  label(angle ? '面光源' : '平行光照明',point(sourceX,(syMin+syMax)/2,szMax),0,-14);
  label('分光板',onSplitter(-.57,splitWidth),-14,-8);
  label({angle:'平行薄膜',thick:'弯曲薄膜',wedge:'空气劈尖',newton:'平凸透镜 + 平玻璃'}[current],
    point(1.32,.73,topZ(1.32,.73)),25,3);
  label(angle ? '会聚透镜' : '成像透镜',point(1.42,0,lensZ),23,8);
  label(angle ? '后焦平面' : '观察面',point(.40,-.80,screenZ),0,-13);
  return geo;
}
function drawScene() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(devicePixelRatio || 1,2);
  const cw = Math.round(w*dpr), ch = Math.round(h*dpr);
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw; canvas.height = ch;
  }
  ctx.setTransform(dpr,0,0,dpr,0,0);
  const bg = ctx.createRadialGradient(w*.49,h*.38,0,w*.49,h*.45,Math.max(w*.67,h*.68));
  bg.addColorStop(0,'#25264a'); bg.addColorStop(.65,'#15182f'); bg.addColorStop(1,'#0d1022');
  ctx.fillStyle = bg; ctx.fillRect(0,0,w,h);
  const young = current === 'young';
  const unit = Math.min(w/(young ? 9.45 : 8.35),h/(young ? 4.7 : 6.42))*camera.zoom;
  const cx = young ? -.16 : -.76, cz = young ? 1.18 : 2.02;
  const cyaw = Math.cos(camera.yaw), syaw = Math.sin(camera.yaw);
  const cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
  function project([x,y,z]) {
    const u = x-cx, v = z-cz;
    const depth = u*syaw + y*cyaw;
    return [w*.50+unit*(u*cyaw-y*syaw),h*.49-unit*(v*cp-depth*sp),depth*cp+v*sp];
  }
  function trace(positions) {
    ctx.beginPath();
    for (let i=0;i<positions.length;i++) {
      const [x,y] = positions[i];
      if (i === 0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
  }
  function line(vertices,color,width=1) {
    trace(vertices.map(project)); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  }
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (let i=-7;i<=7;i++) {
    const col = i === 0 ? '#9294d748' : '#838fce21';
    line([[i*.80,-3.2,-.28],[i*.80,3.2,-.28]],col);
  }
  for (let j=-4;j<=4;j++) {
    const col = j === 0 ? '#9294d748' : '#838fce21';
    line([[-5.6,j*.80,-.28],[5.6,j*.80,-.28]],col);
  }
  const geo = setupGeometry();
  const faces = geo.faces.map(face => {
    const positions = face.vertices.map(project);
    return {...face,positions,depth:positions.reduce((sum,v)=>sum+v[2],0)/positions.length};
  }).sort((a,b)=>a.depth-b.depth);
  for (const face of faces) {
    trace(face.positions); ctx.closePath();
    ctx.fillStyle = face.fill; ctx.fill();
    ctx.strokeStyle = face.stroke; ctx.lineWidth = 1; ctx.stroke();
  }
  for (const {corners,opacity} of geo.screens) {
    if (!bitmap.width || !bitmap.height) continue;
    const [[ox,oy],[xx,xy],[yx,yy]] = corners.map(project);
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.transform((xx-ox)/bitmap.width,(xy-oy)/bitmap.width,(yx-ox)/bitmap.height,(yy-oy)/bitmap.height,ox,oy);
    ctx.drawImage(bitmap,0,0);
    ctx.restore();
  }
  for (const detail of geo.details) line(detail.vertices,detail.color);
  for (const {vertices,kind,main,group} of geo.rays) {
    const positions = vertices.map(project);
    const color = group ? sampleColors[group] : rayColors[kind];
    const active = !group || focus === 'all' || focus === group;
    ctx.save();
    ctx.globalAlpha = active ? (kind === 'in' && group ? .62 : main ? 1 : .40) : .12;
    if (active && main) {
      ctx.shadowColor = color; ctx.shadowBlur = group ? 4 : 7;
    }
    ctx.setLineDash(kind === 'second' ? [6,4.5] : []);
    trace(positions); ctx.strokeStyle = color;
    ctx.lineWidth = group ? (kind === 'in' ? 1.8 : 2.6) : (main ? 2.15 : 1.20);
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i=1; i<positions.length; i++) {
      const [x0,y0]=positions[i-1], [x1,y1]=positions[i];
      if (Math.hypot(x1-x0,y1-y0)<22) continue;
      const a = Math.atan2(y1-y0,x1-x0), x=x0+(x1-x0)*.64, y=y0+(y1-y0)*.64;
      trace([[x-5*Math.cos(a-.55),y-5*Math.sin(a-.55)],[x,y],[x-5*Math.cos(a+.55),y-5*Math.sin(a+.55)]]);
      ctx.stroke();
    }
    ctx.restore();
  }
  for (const {at,color} of geo.marks) {
    const [x,y] = project(at);
    ctx.beginPath(); ctx.arc(x,y,3.25,0,TAU); ctx.fillStyle = color; ctx.fill();
  }
  ctx.font = (w < 490 ? '10px' : '12px') + ' "Segoe UI","Microsoft YaHei UI",sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const placed = [];
  for (const {name,at,dx,dy} of geo.labels) {
    const [ax,ay] = project(at);
    if (ax < -20 || ax > w+20 || ay < -20 || ay > h+20) continue;
    const tw = ctx.measureText(name).width+12;
    const x = clamp(ax+dx,tw/2+4,w-tw/2-4);
    let y = clamp(ay+dy,12,h-14);
    for (let attempt=0; attempt<5; attempt++) {
      if (!placed.some(p=>Math.abs(p.x-x)<(p.tw+tw)/2+2 && Math.abs(p.y-y)<18)) break;
      y = clamp(y+(dy<0 ? -18 : 18),11,h-14);
    }
    placed.push({x,y,tw});
    ctx.beginPath(); ctx.roundRect(x-tw/2,y-8,tw,16,4);
    ctx.fillStyle = '#14182ee8'; ctx.fill(); ctx.strokeStyle = '#95a1df49'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#edeaff'; ctx.fillText(name,x,y+.25);
  }
  for (const {at,group,offset} of geo.sampleMarks) {
    const [x,y] = project(at);
    const active = focus === 'all' || focus === group;
    if (offset) {
      paintSample(ctx,x,y,group,offset,active);
    } else {
      ctx.save();
      ctx.globalAlpha = active ? 1 : .25;
      ctx.beginPath(); ctx.arc(x,y,3,0,TAU); ctx.fillStyle = sampleColors[group]; ctx.fill();
      ctx.restore();
    }
  }
  const [bx,by] = project([0,0,0]);
  ctx.font = '9px ui-monospace,monospace';
  ctx.textAlign = 'center';
  for (const [at,color,name] of [[[1,0,0],'#f1aabf','X'],[[0,1,0],'#84dacc','Y'],[[0,0,1],'#c0abff','Z']]) {
    const [ex,ey] = project(at);
    const x = 29+(ex-bx)*23/unit, y = h-27+(ey-by)*23/unit;
    if (Math.hypot(x-29,y-(h-27)) < 5) continue;
    trace([[29,h-27],[x,y]]); ctx.strokeStyle = color; ctx.lineWidth = 1.15; ctx.stroke();
    ctx.fillStyle = color; ctx.fillText(name,x+3,y-5);
  }
}
function updateCamera() {
  $('side').setAttribute('aria-pressed',camera.yaw === 0 && camera.pitch === 0);
  requestPaint();
}
$('side').addEventListener('click', () => {
  Object.assign(camera,{yaw:0,pitch:0,zoom:1});
  updateCamera();
});
$('reset-view').addEventListener('click', () => {
  Object.assign(camera,initialCamera);
  updateCamera();
});
canvas.addEventListener('pointerdown', e => {
  if (!e.isPrimary || e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  pointer = {id:e.pointerId,x:e.clientX,y:e.clientY};
});
canvas.addEventListener('pointermove', e => {
  if (!pointer || e.pointerId !== pointer.id) return;
  camera.yaw = (camera.yaw-(e.clientX-pointer.x)*.011) % TAU;
  camera.pitch = clamp(camera.pitch+(e.clientY-pointer.y)*.009,-1.48,1.48);
  pointer.x = e.clientX; pointer.y = e.clientY;
  updateCamera();
});
canvas.addEventListener('lostpointercapture', () => pointer = null);
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1;
  camera.zoom = clamp(camera.zoom*Math.exp(-e.deltaY*unit*.0011),.60,1.80);
  updateCamera();
}, {passive:false});
canvas.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft') camera.yaw += .15;
  else if (e.key === 'ArrowRight') camera.yaw -= .15;
  else if (e.key === 'ArrowUp') camera.pitch = clamp(camera.pitch-.12,-1.48,1.48);
  else if (e.key === 'ArrowDown') camera.pitch = clamp(camera.pitch+.12,-1.48,1.48);
  else if (e.key === '+' || e.key === '=') camera.zoom = clamp(camera.zoom*1.12,.60,1.80);
  else if (e.key === '-') camera.zoom = clamp(camera.zoom/1.12,.60,1.80);
  else return;
  e.preventDefault();
  updateCamera();
});
const resize = new ResizeObserver(() => requestPaint(true));
resize.observe(canvas);
resize.observe(fringes);
select(current);
