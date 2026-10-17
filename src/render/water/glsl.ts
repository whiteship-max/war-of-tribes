// Вода — одна на игру (docs/polish.md, П-8): функции шейдера, общие у реки города, реки ролика боя и осады и воды
// рыбалки. Своих униформ у куска нет — каждое место подаёт свои числа (час, погоду, течение, глубину), а вид воды —
// рябь, круги дождя, пена, отражение неба, блик солнца, лунная дорожка и отблески огней — считается здесь, одним
// кодом. Числа формы — `shape.ts` (их же считает двойник на процессоре, `model.ts`).
//
// Хеш — без синуса: `fract(sin(x) · 43758)` на видеокартах телефонов при больших x вырождается в ступени, и узор,
// зависящий от него, ложится квадратами.
import { FOAM_DEPTH, GLINT_KNEE, LIGHT, RAIN_CELL, RAIN_PX, RAIN_RATE, RAIN_RING, RIPPLE, RIPPLE_FADE, RIPPLE_OCTAVES, RIPPLE_WARP } from './shape';

const f = (x: number): string => (Number.isInteger(x) ? `${x}.0` : String(x));
const v2 = (a: readonly number[]): string => `vec2(${a.map(f).join(', ')})`;

export const WATER_GLSL = /* glsl */ `
// ---- вода (render/water) ----
const vec4 W_OCT[${RIPPLE.length}] = vec4[${RIPPLE.length}](
${RIPPLE.map((o) => `  vec4(${o.map(f).join(', ')})`).join(',\n')}
);

float wHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float wNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 u = fract(p);
  u = u * u * (3.0 - 2.0 * u);
  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), u.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// Мягкий предел отблеска: ни один пиксель воды не уходит в белое.
vec3 wKnee(vec3 c) { return c / (1.0 + c / ${f(GLINT_KNEE)}); }

// Шум с наклоном: значение и производные по x, y — рябь берёт наклон прямо из шума, без соседних выборок.
vec3 wNoiseD(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  float a = wHash(i);
  float b = wHash(i + vec2(1.0, 0.0));
  float c = wHash(i + vec2(0.0, 1.0));
  float d = wHash(i + vec2(1.0, 1.0));
  float k = a - b - c + d;
  return vec3(a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y, du * (vec2(b - a, c - a) + k * u.yx));
}

// Рябь: наклон поверхности в рамке течения (x — вдоль, y — поперёк). fq — точка в этой рамке, м; flow — скорость
// течения, м/с; lod — уровень (0..2). Октавы шума, каждая повёрнута и снесена течением со своей скоростью — узор живёт
// и не повторяется. В rough копится то, чего рябь не нарисовала (погасшие и несчитанные октавы): отражение мутнеет,
// блик ширится — вдали вода матовая, а не зеркальная сетка.
vec2 wRipple(vec2 fq, float t, float flow, float lod, inout float rough) {
  float px = max(max(fwidth(fq.x), fwidth(fq.y)), 1e-4);
  vec2 q = fq;
  if (lod > 0.5) q += (vec2(wNoise(fq * ${f(RIPPLE_WARP[0])}), wNoise(fq * ${f(RIPPLE_WARP[0])} + vec2(17.3, 5.1))) - 0.5) * ${f(RIPPLE_WARP[1])};
  // Течение вытягивает рябь вдоль себя; пятна силы — ветер рябит воду местами, и пятна ползут.
  q *= vec2(0.62, 1.0);
  float gust = 0.45 + 1.1 * wNoise(fq * 0.029 + vec2(-t * 0.05, t * 0.013));
  float n = lod < 0.5 ? ${f(RIPPLE_OCTAVES[0])} : (lod < 1.5 ? ${f(RIPPLE_OCTAVES[1])} : ${f(RIPPLE_OCTAVES[2])});
  // Стоячая вода тоже рябит: ветер гонит рябь поперёк.
  float drift = max(flow, 0.25);
  vec2 g = vec2(0.0);
  for (int i = 0; i < ${RIPPLE.length}; i++) {
    vec4 o = W_OCT[i];
    float a = o.y * gust;
    float fade = 1.0 - smoothstep(${f(RIPPLE_FADE[0])}, ${f(RIPPLE_FADE[1])}, px * o.x);
    if (float(i) >= n || fade < 0.01) {
      rough += a * a;
      continue;
    }
    vec2 cs = vec2(cos(o.z), sin(o.z));
    mat2 rot = mat2(cs.x, cs.y, -cs.y, cs.x);
    vec2 s = rot * q * o.x - vec2(t * drift * o.w * o.x, t * 0.07 * o.w);
    // Наклон октавы в рамке течения: производные шума, повёрнутые назад; нормирован так, что o.y — средний наклон.
    g += (transpose(rot) * wNoiseD(s + float(i) * 13.7).yz) * vec2(0.62, 1.0) * (a * fade * 0.9);
    rough += a * a * (1.0 - fade);
  }
  return g;
}

// Круги дождя: наклон в плане мира. В клетке ${f(RAIN_CELL)} м — одна капля за цикл, место и миг каждый цикл новые.
// Круг не больше половины клетки — перебор 2 × 2 ближних клеток видит его целиком, и край клетки его не режет.
vec2 wRain(vec2 p, float t, float rain, float lod, inout float rough) {
  if (rain < 0.01) return vec2(0.0);
  rough += rain * 0.0018;
  if (lod < 0.5) return vec2(0.0);
  float px = max(max(fwidth(p.x), fwidth(p.y)), 1e-4);
  float vis = smoothstep(${f(RAIN_PX[0])}, ${f(RAIN_PX[1])}, ${f(RAIN_RING[1] * RAIN_CELL)} / px);
  if (vis < 0.01) return vec2(0.0);
  vec2 c = p / ${f(RAIN_CELL)};
  vec2 base = floor(c - 0.5);
  float rate = mix(${f(RAIN_RATE[0])}, ${f(RAIN_RATE[1])}, rain);
  vec2 g = vec2(0.0);
  for (int j = 0; j < 4; j++) {
    vec2 cell = base + vec2(float(j % 2), float(j / 2));
    float cyc = t * rate + wHash(cell) * 7.31;
    float ci = floor(cyc);
    float ph = cyc - ci;
    vec2 seed = cell + ci * vec2(0.618, 1.414);
    if (wHash(seed + 11.7) > rain * 0.85 + 0.1) continue;
    vec2 d = c - (cell + vec2(wHash(seed + 3.1), wHash(seed + 5.9)));
    float r = length(d);
    float e = 1.0 - ph;
    float x = (r - ${f(RAIN_RING[0])} * (1.0 - e * e)) / ${f(RAIN_RING[1])};
    // Вал и ложбина кольца — синус под колоколом, за полушириной ровно ноль.
    float s = abs(x) < 1.0 ? sin(x * 3.1416) * (1.0 - x * x) * (1.0 - x * x) : 0.0;
    g += d / max(r, 1e-4) * (s * e * sqrt(e) * 0.5);
  }
  return g * vis;
}

// Пена у берега и на бродах: только на мелком, рваная, плывёт по течению. Цвет ей даёт свет сцены — ночью она серая,
// а не белая.
float wFoam(vec2 fq, float depth, float t, float flow) {
  float band = 1.0 - smoothstep(${f(FOAM_DEPTH[1])}, ${f(FOAM_DEPTH[0])}, depth);
  if (band < 0.01) return 0.0;
  vec2 m = fq * vec2(0.55, 1.7) - vec2(t * (0.2 + flow * 0.9), 0.0);
  float n = wNoise(m) * 0.62 + wNoise(m * 2.7 + 3.3) * 0.38;
  return band * smoothstep(0.66 - band * 0.42, 0.9 - band * 0.28, n);
}

// Толща: мелко — светлее (сквозь воду дно), глубоко — темнее.
vec3 wBody(float depth, vec3 shallow, vec3 deep) { return mix(shallow, deep, smoothstep(0.05, 1.6, depth)); }

// Небо в воде: у горизонта — дымка, к зениту — синее; по небу — облака (cloud — облачность, 0..1, и у ясного неба
// чуть-чуть; night — доля ночи). Рябь гнёт отражённые облака — так она и видна сверху: зеркало неба, а не ровная заливка.
vec3 wSkyOf(vec3 R, vec3 zen, vec3 hor, float cloud, float night, float t) {
  vec3 sky = mix(hor, zen, smoothstep(0.02, 0.75, R.y));
  vec2 at = R.xz / max(R.y, 0.12) * 1.6 + vec2(t * 0.01, t * 0.004);
  float c = wNoise(at) * 0.6 + wNoise(at * 2.3 + 7.1) * 0.4;
  float k = smoothstep(0.42, 0.85, c) * (0.18 + 0.62 * cloud);
  // Днём облако светлее неба, ночью — темнее (его никто не подсвечивает): белых пятен в ночной воде нет.
  return mix(sky, hor * mix(1.15, 0.6, night), k);
}

// Наклон к камере: склоны ряби, обращённые к зрителю, ловят небо у горизонта, обращённые прочь — небо у зенита. Сверху
// Френель почти не меняется, и рябь читается только этим множителем отражения.
float wTilt(vec2 gw, vec3 V) {
  vec2 fwd = -V.xz / max(length(V.xz), 1e-3);
  return clamp(1.0 + 7.0 * dot(gw, fwd), 0.4, 1.9);
}

// Доля отражения: Френель с полом — и сверху вода зеркалит небо, иначе с ракурса игры читалась бы дорогой.
float wFres(vec3 n, vec3 V) {
  float m = 1.0 - max(dot(n, V), 0.0);
  return ${f(LIGHT.reflectFloor)} + ${f(1 - LIGHT.reflectFloor)} * m * m * m * m * m;
}

// Блик светила по отражённому лучу: острое ядро и широкий отсвет; рябь, которой не нарисовали (rough), ширит его.
vec3 wGlint(vec3 R, vec3 L, vec3 col, vec2 core, vec2 sheen, float rough) {
  float k = clamp(sqrt(rough) / 0.06, 0.0, 1.0);
  float c = max(dot(R, L), 0.0);
  float v = pow(c, core.x * mix(1.0, 0.12, k)) * core.y * mix(1.0, 0.3, k) + pow(c, sheen.x * mix(1.0, 0.45, k)) * sheen.y;
  return col * v;
}
vec3 wSun(vec3 R, vec3 L, vec3 col, float rough) {
  return wGlint(R, L, col, ${v2(LIGHT.sunCore)}, ${v2(LIGHT.sunSheen)}, rough);
}
// Луна: дорожка по ряби и искры в ней — холодно и тихо.
vec3 wMoon(vec3 R, vec3 M, vec3 col, float rough) {
  return wGlint(R, M, col, ${v2(LIGHT.moonCore)}, ${v2(LIGHT.moonPath)}, rough);
}
// Огонь у воды: отблеск дрожит там, куда смотрит отражённый луч, и чуть тёплого света на воде рядом. l.w — радиус²,
// за которым огня в воде почти нет.
vec3 wTorch(vec3 R, vec3 p, vec4 l, vec3 col, float rough) {
  vec3 d = l.xyz - p;
  float dd = max(dot(d, d), 1e-3);
  float fall = 1.0 / (1.0 + dd / l.w);
  fall *= fall;
  float k = clamp(sqrt(rough) / 0.06, 0.0, 1.0);
  float c = max(dot(R, d * inversesqrt(dd)), 0.0);
  return col * fall * (pow(c, ${f(LIGHT.torch[0])} * mix(1.0, 0.45, k)) * ${f(LIGHT.torch[1])} + 0.05);
}
// ---- /вода ----
`;
