// Свет покоев (docs/city_v3.md, Г-4): свой шейдер, без огней three — в комнате их нет вовсе, а свет считается здесь.
//
//   · огонь камина и свечи — точками с мягким ядром; огонь тенит мебель коробками (`build.OCCLUDERS`), свечи — нет;
//   · небо из окон — каждое окно светит в комнату своей площадью по нормали внутрь (цвет — небо города этого кадра);
//   · солнце (ночью — луна) — пятном: луч от точки к светилу проходит в проём окна или гаснет о его край и о мебель;
//   · углы, пол под мебелью и стык со стропилами темнее — прижатость считается по плоскостям комнаты, а не запечена;
//   · металл блестит от огня, свечей и солнца; выбранный пальцем предмет светлеет пульсом и ободом.
//
// Координаты — в осях комнаты (мир минус начало `uOrigin`): числа малые, и точности хватает на любом телефоне. Глубина —
// в первой доле буфера (`city/inside.INSIDE_DEPTH`): город рисуется следом и встаёт только в проёмах.
import * as THREE from 'three';
import { INSIDE_DEPTH_GLSL } from '../city/inside';
import { HALF, WALL_H, OPENINGS, WALL_AXES, wallPoint, alongOf } from './plan';
import { OCCLUDERS, ROOM_LIGHTS } from './build';
import type { Box } from './plan';

/** Сколько ламп у уровня: огонь и свечи по важности (`build.ROOM_LIGHTS`). */
export const LIGHTS_AT = { low: 3, medium: 7, high: 10 } as const;

/** Ручки шейдера покоев — одни на все материалы комнаты; кадр правит их сам (`room.ts`). */
export interface RoomUniforms {
  [k: string]: THREE.IUniform;
  cityTex: { value: THREE.Texture | null };
  atlas: { value: THREE.Texture | null };
  /** Свой камень покоев (`stone.ts`): бут стен и тёсаный — цвет и рельеф. */
  masonry: { value: THREE.Texture | null };
  dressed: { value: THREE.Texture | null };
  uOrigin: { value: THREE.Vector3 };
  uLight: { value: THREE.Vector4[] };
  uLightCol: { value: THREE.Color[] };
  uWin: { value: THREE.Vector4[] };
  uWinN: { value: THREE.Vector4[] };
  uSky: { value: THREE.Color };
  uSunDir: { value: THREE.Vector3 };
  uSun: { value: THREE.Color };
  uAmb: { value: THREE.Color };
  uOcc0: { value: THREE.Vector3[] };
  uOcc1: { value: THREE.Vector3[] };
  uSel: { value: number };
  uSelGlow: { value: number };
  uTime: { value: number };
  uEmber: { value: THREE.Color };
}

const MAX_LIGHTS = ROOM_LIGHTS.length;

/** Окна для шейдера: середина низа проёма (подоконник), полуширина; нормаль внутрь, высота пяты, парное ли. */
function windows(): { win: THREE.Vector4[]; nor: THREE.Vector4[] } {
  const win: THREE.Vector4[] = [];
  const nor: THREE.Vector4[] = [];
  for (const o of OPENINGS) {
    const p = wallPoint(o.wall, alongOf(o), o.sill, o.plate);
    const n = WALL_AXES[o.wall].n;
    win.push(new THREE.Vector4(p[0], p[1], p[2], o.outW / 2));
    nor.push(new THREE.Vector4(-n[0], o.spring - o.sill, -n[2], o.twin ? 1 : 0));
  }
  return { win, nor };
}

export function roomUniforms(): RoomUniforms {
  const { win, nor } = windows();
  const occ = [...OCCLUDERS];
  while (occ.length < 4) occ.push({ x0: 0, y0: -9, z0: 0, x1: 0, y1: -9, z1: 0 } as Box);
  return {
    cityTex: { value: null },
    atlas: { value: null },
    masonry: { value: null },
    dressed: { value: null },
    uOrigin: { value: new THREE.Vector3() },
    uLight: { value: ROOM_LIGHTS.map((l) => new THREE.Vector4(l.x, l.y, l.z, l.power)) },
    uLightCol: { value: ROOM_LIGHTS.map(() => new THREE.Color(0, 0, 0)) },
    uWin: { value: win },
    uWinN: { value: nor },
    uSky: { value: new THREE.Color(0.5, 0.6, 0.7) },
    uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.5) },
    uSun: { value: new THREE.Color(0, 0, 0) },
    uAmb: { value: new THREE.Color(0.02, 0.018, 0.016) },
    uOcc0: { value: occ.slice(0, 4).map((b) => new THREE.Vector3(b.x0, b.y0, b.z0)) },
    uOcc1: { value: occ.slice(0, 4).map((b) => new THREE.Vector3(b.x1, b.y1, b.z1)) },
    uSel: { value: 0 },
    uSelGlow: { value: 0 },
    uTime: { value: 0 },
    uEmber: { value: new THREE.Color(1.0, 0.36, 0.08) },
  };
}

const VERT = /* glsl */ `
attribute vec2 cuv;
attribute vec4 cfg;
uniform vec3 uOrigin;
varying vec2 vUv;
varying vec3 vCol;
varying vec3 vL;
varying vec3 vN;
varying float vLayer;
varying float vGlow;
varying float vShine;
varying float vCode;
void main() {
  vUv = cuv;
  vCol = color;
  vLayer = cfg.x;
  vGlow = cfg.y / 255.0;
  vShine = cfg.z / 255.0;
  vCode = cfg.w;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vL = wp.xyz - uOrigin;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
  ${INSIDE_DEPTH_GLSL}
}
`;

/** Общее у покоев: луч к солнцу через проём окна — и шейдеру поверхностей, и пылинкам в луче (`fire.ts`). */
export const SUN_GLSL = /* glsl */ `
uniform vec4 uWin[3];
uniform vec4 uWinN[3];
uniform vec3 uSunDir;
uniform vec3 uOcc0[4];
uniform vec3 uOcc1[4];
// Луч из p по d: задевает ли коробку (метод плит).
float boxHit(vec3 p, vec3 d, vec3 b0, vec3 b1) {
  vec3 inv = 1.0 / (d + vec3(1e-5));
  vec3 t0 = (b0 - p) * inv;
  vec3 t1 = (b1 - p) * inv;
  vec3 lo = min(t0, t1);
  vec3 hi = max(t0, t1);
  float a = max(max(lo.x, lo.y), lo.z);
  float b = min(min(hi.x, hi.y), hi.z);
  return step(max(a, 0.0), b) * step(0.02, b);
}
float occluded(vec3 p, vec3 d) {
  float o = 0.0;
  for (int i = 0; i < 4; i++) o = max(o, boxHit(p, d, uOcc0[i], uOcc1[i]));
  return o;
}
// Доля солнца, что проходит в окна до точки p (0..1): проём — прямоугольник до пяты и полукруг над ней, край мягкий.
float sunThrough(vec3 p) {
  float lit = 0.0;
  for (int i = 0; i < 3; i++) {
    vec3 n = vec3(uWinN[i].x, 0.0, uWinN[i].z);
    float dn = dot(uSunDir, n);
    if (dn > -0.02) continue;
    vec3 c = uWin[i].xyz;
    float t = dot(c - p, n) / dn;
    if (t <= 0.0) continue;
    vec3 h = p + uSunDir * t;
    vec3 tg = vec3(-n.z, 0.0, n.x);
    float u = dot(h - c, tg);
    float v = h.y - c.y;
    float hw = uWin[i].w;
    float soft = 0.015 + 0.02 * t;
    float au = abs(u);
    float top = uWinN[i].y + sqrt(max(hw * hw - au * au, 0.0));
    float inside = (1.0 - smoothstep(hw - soft, hw + soft, au)) * smoothstep(-soft, soft, v) * (1.0 - smoothstep(top - soft, top + soft, v));
    // Парное окно — столбик посередине.
    inside *= 1.0 - uWinN[i].w * (1.0 - smoothstep(0.07, 0.07 + soft, au));
    lit = max(lit, inside);
  }
  return lit;
}
`;

const FRAG = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray cityTex;
uniform sampler2D atlas;
uniform sampler2D masonry;
uniform sampler2D dressed;
uniform vec3 uOrigin;
uniform vec4 uLight[${MAX_LIGHTS}];
uniform vec3 uLightCol[${MAX_LIGHTS}];
uniform vec3 uSky;
uniform vec3 uSun;
uniform vec3 uAmb;
uniform float uSel;
uniform float uSelGlow;
uniform float uTime;
uniform vec3 uEmber;
varying vec2 vUv;
varying vec3 vCol;
varying vec3 vL;
varying vec3 vN;
varying float vLayer;
varying float vGlow;
varying float vShine;
varying float vCode;
${SUN_GLSL}

// Прижатость: к плоскостям комнаты (пол, стены, пояс стропил) и пол под мебелью.
float roomAo(vec3 p, vec3 n) {
  float ao = 1.0;
  ao *= 1.0 - 0.42 * (1.0 - abs(n.y)) * (1.0 - smoothstep(0.0, 0.8, p.y));
  ao *= 1.0 - 0.3 * (1.0 - abs(n.y)) * (1.0 - smoothstep(0.0, 0.7, ${WALL_H.toFixed(2)} - p.y)) * step(p.y, ${WALL_H.toFixed(2)});
  ao *= 1.0 - 0.38 * (1.0 - abs(n.x)) * (1.0 - smoothstep(0.0, 0.9, ${HALF.toFixed(2)} - abs(p.x)));
  ao *= 1.0 - 0.38 * (1.0 - abs(n.z)) * (1.0 - smoothstep(0.0, 0.9, ${HALF.toFixed(2)} - abs(p.z)));
  if (n.y > 0.5 && p.y < 0.08) {
    for (int i = 0; i < 4; i++) {
      vec2 q = max(uOcc0[i].xz - p.xz, p.xz - uOcc1[i].xz);
      float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
      ao *= 1.0 - 0.5 * (1.0 - smoothstep(-0.15, 0.4, sd)) * step(uOcc0[i].y, 0.5);
    }
  }
  return ao;
}

// Рельеф камня: нормаль гнётся по высоте из альфы плитки (производные по экрану, без касательных; Микельсен).
vec3 bumped(vec3 n, vec3 p, float h, float depth) {
  vec3 dpx = dFdx(p);
  vec3 dpy = dFdy(p);
  vec3 r1 = cross(dpy, n);
  vec3 r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  vec3 g = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2) * depth;
  return normalize(abs(det) * n - g);
}

void main() {
  float relief = 1.0;
  float depth = 0.0;
  #ifdef ATLAS
    vec4 tex = texture2D(atlas, vUv);
    if (tex.a < 0.5) discard;
  #else
    vec4 tex;
    if (vLayer > 250.5) {
      // Свой камень покоев: бут стен (251) и тёсаный (252); рельеф — в альфе (geo.MASONRY_LAYER, DRESSED_LAYER).
      vec4 st = vLayer > 251.5 ? texture2D(dressed, vUv) : texture2D(masonry, vUv);
      tex = vec4(st.rgb, 1.0);
      relief = st.a;
      depth = vLayer > 251.5 ? 0.012 : 0.03;
    } else {
      // Ровный тон (металл, воск, кость) — без рисунка слоя, geo.PLAIN_LAYER.
      tex = vLayer > 249.5 ? vec4(1.0) : texture(cityTex, vec3(vUv, vLayer));
    }
  #endif
  vec3 albedo = tex.rgb * vCol;
  vec3 n = normalize(vN);
  vec3 p = vL;
  vec3 v = normalize(cameraPosition - uOrigin - p);
  // Грань, повёрнутая от зрителя (двусторонняя ткань, ставни), — светом своей лицевой стороны.
  if (dot(n, v) < 0.0) n = -n;
  #ifdef BUMP
    if (depth > 0.0) n = bumped(n, p, relief, depth);
  #endif
  // Швы и впадины темнее: раствор глубже камня.
  float ao = roomAo(p, n) * mix(0.62, 1.0, smoothstep(0.1, 0.75, relief));
  // Материал — по блеску вершины: до 0,6 — дерево, кожа, ткань, кость (блик белый); 0,6…0,96 — металл (блик цветом
  // металла, отражение покоев); выше — воск (свет свечи проходит сквозь).
  float shine = vShine;
  float metal = step(0.6, shine) * (1.0 - step(0.965, shine));
  float wax = step(0.965, shine);
  float gloss = metal > 0.5 ? mix(36.0, 150.0, (shine - 0.6) / 0.36) : mix(14.0, 64.0, shine / 0.6);
  float specK = metal > 0.5 ? 1.6 : wax > 0.5 ? 0.25 : shine * 2.2;
  float wrap = mix(0.15, 0.85, wax);
  // Рассеянный свет: сверху — небо окон и огонь, снизу — пол и стол отдают его потолку и балкам (тёплым).
  vec3 light = uAmb * (0.8 + 0.2 * n.y + 0.35 * max(-n.y, 0.0)) * ao;
  vec3 spec = vec3(0.0);
  for (int i = 0; i < LIGHTS; i++) {
    vec3 L = uLight[i].xyz - p;
    float d2 = dot(L, L);
    vec3 l = L * inversesqrt(d2);
    float ndl = max((dot(n, l) + wrap) / (1.0 + wrap), 0.0);
    // Мягкое ядро и спад по квадрату: у огня ярко, через комнату — тёплый отсвет, а не темень.
    float att = uLight[i].w / (0.6 + 0.5 * d2);
    float sh = 1.0;
    #ifdef FIRE_SHADOW
      if (i == 0) sh = 1.0 - 0.75 * occluded(p + n * 0.02, l);
    #endif
    light += uLightCol[i] * ndl * att * sh;
    vec3 h = normalize(l + v);
    spec += uLightCol[i] * att * sh * pow(max(dot(n, h), 0.0), gloss) * specK;
  }
  // Небо из окон: площадью проёма по нормали внутрь.
  for (int i = 0; i < 3; i++) {
    vec3 wn = vec3(uWinN[i].x, 0.0, uWinN[i].z);
    vec3 c = uWin[i].xyz + vec3(0.0, uWinN[i].y * 0.6, 0.0);
    vec3 D = c - p;
    float d2 = dot(D, D);
    vec3 dir = D * inversesqrt(d2);
    float facing = max(-dot(dir, wn), 0.0);
    float area = uWin[i].w * 2.0 * (uWinN[i].y + uWin[i].w * 0.8);
    float om = area * facing / (d2 + area);
    light += uSky * om * max((dot(n, dir) + 0.25) / 1.25, 0.0) * (0.55 + 0.45 * ao);
    // Ниша у проёма видит полнеба: откосы, сиденья и ставни светлы, хоть и смотрят мимо окна.
    float bay = max(0.0, 1.0 - sqrt(d2) / (1.3 + uWin[i].w));
    light += uSky * bay * bay * 0.55;
  }
  // Солнце пятном: только сквозь проём и мимо мебели.
  float sunNdl = max(dot(n, uSunDir), 0.0);
  if (sunNdl > 0.0) {
    float s = sunThrough(p) * (1.0 - occluded(p + n * 0.02, uSunDir));
    light += uSun * sunNdl * s;
    vec3 h = normalize(uSunDir + v);
    spec += uSun * s * pow(max(dot(n, h), 0.0), gloss) * specK;
  }
  // Металл: свет почти не рассеивает, а отражает — покои (тёплый полумрак, огонь) и небо южного окна.
  vec3 r = reflect(-v, n);
  vec3 env = uAmb * (3.0 + 2.0 * max(r.y, 0.0)) + uSky * 0.22 * smoothstep(0.35, 0.95, r.z) + uLightCol[0] * 0.012 * smoothstep(0.2, 0.9, -r.z);
  vec3 tintSpec = metal > 0.5 ? albedo * 2.4 : vec3(1.0);
  vec3 col = albedo * light * (1.0 - 0.72 * metal) + spec * tintSpec + albedo * env * metal * 1.6;
  // Воск у огня: свет проходит в тело свечи — тёплый, мягкий.
  col += albedo * light * vec3(0.35, 0.18, 0.06) * wax;
  // Тлеющее (угли поленьев): своим светом, дышит.
  float breath = 0.75 + 0.25 * sin(uTime * 2.3 + p.x * 9.0) * sin(uTime * 3.7 + p.z * 7.0);
  col += uEmber * vGlow * breath * (0.4 + 0.6 * smoothstep(0.2, 0.0, abs(n.y + 0.2))) * 1.6;
  // Выбранный пальцем предмет: светлее и ободом.
  float sel = step(0.5, uSel) * (1.0 - step(0.5, abs(vCode - uSel)));
  float rim = pow(1.0 - max(dot(n, v), 0.0), 2.0);
  col += (albedo * 0.35 + vec3(1.0, 0.78, 0.45) * (0.05 + 0.45 * rim)) * sel * uSelGlow;
  // Цвет покоев: чуть глуше насыщенность, тёплые тени — как город (city/material, GRADE_GLSL), без лунной гаммы.
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(lum), col, 0.9) * vec3(1.02, 1.0, 0.97);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Материал покоев: слои текстур города и свой камень (`atlas = false`) или атлас покоев с обрезкой по альфе. */
export function roomMaterial(u: RoomUniforms, lights: number, atlas: boolean, fireShadow: boolean, bump = fireShadow): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: VERT,
    fragmentShader: FRAG,
    vertexColors: true,
    // Рельеф камня (`BUMP`) — со «Среднего»: на «Низком» камень ровный, цвет и швы те же (docs/city_v3.md, Г-5).
    defines: { LIGHTS: lights, ...(atlas ? { ATLAS: 1 } : {}), ...(fireShadow ? { FIRE_SHADOW: 1 } : {}), ...(bump && !atlas ? { BUMP: 1 } : {}) },
  });
  m.name = atlas ? 'chambers-cloth' : 'chambers-stone';
  return m;
}
