// Небо и свет боя. Земля — рядом, в `ground.ts`; здесь то, что стоит вокруг неё
// и на неё светит.
//
// **Свет — самый сильный рычаг, какой у нас есть.** Текстур нет, скиннинга нет,
// постобработки нет, значит объём делают угол солнца и теплохолодность. Отвесное
// солнце даёт короткие пятна под ногами и вид на игрушки на столе; низкое даёт
// длинные тени через всё поле, и та же самая сцена читается картиной. Стоит эта
// разница одной настройкой источника — поэтому она и стоит первой.
//
// Время суток берётся из раскадровки (`Cast.ground.solar`), то есть из записи
// боя. Не из настоящих часов и не из случайного числа: повтор ролика через
// неделю обязан дать тот же свет, иначе правило «тот же журнал — тот же ролик»
// перестаёт быть правилом.
import * as THREE from 'three';
import type { Ground } from '@/battle/replay';
import { PALETTE, seasonColor } from '../palette';
import { RIG, applyDayNight, configureSky, createLightRig, fitShadow, type LightRig } from '../lighting';

/**
 * Куда стоит солнце боя. У деревни ключевой азимут выведен из её стартовой
 * камеры; сцена боя смотрит в другую сторону, и тот азимут поставил бы войско
 * против света — обе стороны стали бы одного тёмного цвета, а цвет здесь и есть
 * сторона. Солнце стоит слева от камеры и чуть за ней: обе линии освещены
 * одинаково, а тени уходят вправо и вдаль через всё поле.
 */
export const SUN_AZIMUTH = (112 * Math.PI) / 180;

/**
 * Высота солнечной дуги. Половина деревенской: полдень выходит заметно ниже
 * деревенского (высоту считает `applyDayNight`), и даже полуденная тень человека
 * длиннее его самого. Ниже
 * ставить нельзя — на десяти градусах тень фигуры уезжает за соседний сектор и
 * поле превращается в полосатый ковёр.
 */
export const SUN_ARC = 0.5;

/**
 * Докуда бьёт коробка теней. Считается по опушке, а не по строю: на низком
 * солнце дерево кладёт тень на пол-поля, и она — половина всей красоты. Карта
 * подробнее деревенской (`SHADOW_MAP` в lighting.ts), потому что и накрывает больше.
 */
const SHADOW_HALF = 34;
const SHADOW_MAP = 2048;

/** Дымка: в неё уходит дальняя гряда. Отодвинута — на 45 метрах стоит вторая армия. */
const FOG = { near: 52, far: 92 };

/** Небо: купол с градиентом по высоте. */
const SKY_R = 150;
/** Зенит темнее горизонта — так небо и устроено, и так силуэт читается на нём. */
const ZENITH_MUL = 0.72;
/** У горизонта светлее дымки: там и садится полоска, по которой видно, что это поле. */
const HORIZON_MUL = 1.05;
/** Тёплое пятно у горизонта в стороне солнца. */
const GLOW = 0.55;

/**
 * Поправка на низкое солнце. Физически на нижнем краю дуги (`applyDayNight`)
 * горизонтальная грань получает в разы меньше полуденной, и «золотой час» выходит пасмурным
 * вечером: тёмная зелень, серое небо, разница между рассветом и полднем только
 * в направлении теней. Глазу нужен не люкс, а цвет — поэтому на краях дуги
 * лампа светит сильнее и теплее, а холод остаётся в тени, где его и держит
 * полусфера.
 *
 * Числа подобраны по кадрам: `sun` больше — и грани, повёрнутые к солнцу,
 * выбеливаются (на низком солнце они ловят почти всё), `tint` меньше — и
 * рассвет с полднем снова неразличимы.
 */
const LOW = { sun: 0.6, hemi: 0.35, tint: 0.75, hemiTint: 0.5, sky: 0.4, fog: 0.6 };

/**
 * Ниже этого солнце в бою не опускается. На нижнем краю деревенской дуги (`applyDayNight`)
 * горизонтальная грань ловит меньше, чем даёт холодная полусфера, — и поле
 * остаётся зелёным под оранжевым небом, то есть закат виден только в небе.
 * Девятнадцать градусов возвращают земле тёплый свет и всё ещё кладут тень
 * втрое длиннее человека.
 */
const MIN_ELEVATION = (19 * Math.PI) / 180;

/**
 * Утро холоднее вечера. Это не вкусовщина, а единственное, чем они вообще
 * отличаются: угол солнца у них зеркальный, и без разницы в цвете рассвет и
 * закат — один и тот же кадр, отражённый по горизонтали.
 */
const MORNING_COOL = 0.4;

const C = new THREE.Color();
const C2 = new THREE.Color();

/**
 * Небо, туман и свет боевой сцены. Всё выведено из `ground`: тот же бой — тот же
 * свет, всегда. Числа света — `lighting.RIG.next`, те же, что у города: тёплая полусфера и
 * золотой час (docs/graphics_world.md, 11.5).
 */
export function setupFieldScene(scene: THREE.Scene, ground: Ground): LightRig {
  configureSky(scene);
  scene.fog = new THREE.Fog(PALETTE.fog, FOG.near, FOG.far);
  const rig = createLightRig(scene, SHADOW_MAP);
  fitShadow(rig, SHADOW_HALF);
  const season = ground.winter ? 'winter' : 'spring';
  applyDayNight(
    rig,
    scene,
    ground.solar,
    {
      sky: new THREE.Color(seasonColor(season, 'sky')),
      fog: new THREE.Color(seasonColor(season, 'fog')),
      sun: new THREE.Color(seasonColor(season, 'sunDay')),
      // Зимой солнце и так ниже — обе поправки перемножаются, а не спорят.
      sunArc: SUN_ARC * (ground.winter ? 0.8 : 1),
    },
    SUN_AZIMUTH,
    RIG.next,
  );
  lowSun(rig, scene, ground);
  return rig;
}

/**
 * Свет сцены на новый час (ролик осады, docs/gfx.md, ГФ-2: сутки идут между эпизодами — ночь и рассвет). Тот же расчёт, что у
 * `setupFieldScene`, на уже собранном риге; ночью — луна рига (`applyDayNight`), тёплой поправки края дуги нет: она для
 * солнца. Ролик боя света не меняет — у него один час на бой.
 */
export function relight(rig: LightRig, scene: THREE.Scene, ground: Ground): void {
  const season = ground.winter ? 'winter' : 'spring';
  applyDayNight(
    rig,
    scene,
    ground.solar,
    {
      sky: new THREE.Color(seasonColor(season, 'sky')),
      fog: new THREE.Color(seasonColor(season, 'fog')),
      sun: new THREE.Color(seasonColor(season, 'sunDay')),
      sunArc: SUN_ARC * (ground.winter ? 0.8 : 1),
    },
    SUN_AZIMUTH,
    RIG.next,
  );
  // Тёплая поправка — на светлой дуге и в предрассветной четверти; глубокой ночью её нет.
  if (ground.solar <= 0.5 || ground.solar >= 0.94) lowSun(rig, scene, ground);
}

const SKY_VERT = /* glsl */ `
varying vec3 vTwDir;
`;
const SKY_FRAG = /* glsl */ `
varying vec3 vTwDir;
uniform vec3 uTwZenith;
uniform vec3 uTwHorizon;
uniform vec3 uTwWarm;
uniform vec2 uTwSun;
uniform float uTwGlow;
uniform float uTwStars;
float twStar(vec3 d) {
  vec3 p = floor(d * 160.0);
  float h = fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  return step(0.9975, h);
}
`;
const SKY_COLOR = /* glsl */ `
vec3 twD = normalize(vTwDir);
float twT = clamp(twD.y, 0.0, 1.0);
vec3 twC = mix(uTwHorizon, uTwZenith, twT * twT * (3.0 - 2.0 * twT));
float twFlat = max(1e-4, length(twD.xz));
float twToward = max(0.0, dot(twD.xz / twFlat, uTwSun));
twC = mix(twC, uTwWarm, min(1.0, uTwGlow * twToward * twToward * (1.0 - twT) * (1.0 - twT)));
twC += vec3(0.85, 0.88, 1.0) * twStar(twD) * uTwStars * smoothstep(0.08, 0.35, twD.y);
diffuseColor = vec4(twC, 1.0);
`;

/**
 * Купол неба, который меняет час на ходу (ролик осады): тот же градиент, что у `buildSky` — зенит от фона сцены, горизонт
 * от дымки, тёплое пятно в стороне солнца, — но цвета в униформах, а не в вершинах; ночью — звёзды. `update` берёт цвета у
 * сцены после `relight`.
 */
export function buildLiveSky(): { mesh: THREE.Mesh; update(scene: THREE.Scene, ground: Ground): void } {
  const geo = new THREE.SphereGeometry(SKY_R, 32, 14, 0, Math.PI * 2, 0, Math.PI * 0.6);
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  const uni = {
    uTwZenith: { value: new THREE.Color() },
    uTwHorizon: { value: new THREE.Color() },
    uTwWarm: { value: new THREE.Color() },
    uTwSun: { value: new THREE.Vector2(Math.sin(SUN_AZIMUTH), Math.cos(SUN_AZIMUTH)) },
    uTwGlow: { value: 0 },
    uTwStars: { value: 0 },
  };
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide, depthWrite: false, fog: false });
  mat.name = 'battle-sky-live';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = SKY_VERT + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvTwDir = position;');
    sh.fragmentShader = SKY_FRAG + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + SKY_COLOR);
  };
  mat.customProgramCacheKey = () => 'battle-sky-live';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  return {
    mesh,
    update(scene: THREE.Scene, ground: Ground): void {
      uni.uTwZenith.value.copy(scene.background as THREE.Color).multiplyScalar(ZENITH_MUL);
      uni.uTwHorizon.value.copy((scene.fog as THREE.Fog).color).multiplyScalar(HORIZON_MUL);
      const night = ground.solar > 0.5 && ground.solar < 1;
      const low = night ? 0 : Math.min(1, Math.abs(ground.solar - 0.25) / 0.25);
      uni.uTwWarm.value.set(seasonColor(ground.winter ? 'winter' : 'spring', 'sunDay')).lerp(C2.set(PALETTE.sunDusk), low);
      uni.uTwGlow.value = GLOW * low * low;
      // Звёзды — глубокой ночью, гаснут к рассвету и закату.
      uni.uTwStars.value = night ? Math.max(0, Math.sin(((ground.solar - 0.5) / 0.5) * Math.PI)) : 0;
    },
  };
}

/** Тёплое солнце края дуги: см. `LOW`. Правит уже настроенный риг и цвета сцены. */
function lowSun(rig: LightRig, scene: THREE.Scene, ground: Ground): void {
  const low = Math.min(1, Math.abs(ground.solar - 0.25) / 0.25);
  if (low <= 0) return;
  // Солнце приподнимается до порога, азимут при этом не трогаем: направление
  // теней — единственное, чем рассвет отличается от заката по геометрии.
  const p = rig.sun.position;
  const flat = Math.hypot(p.x, p.z) || 1e-6;
  if (Math.atan2(p.y, flat) < MIN_ELEVATION) {
    const d = p.length();
    const k = (Math.cos(MIN_ELEVATION) * d) / flat;
    p.set(p.x * k, Math.sin(MIN_ELEVATION) * d, p.z * k);
  }
  const warm = new THREE.Color(PALETTE.sunDusk);
  if (ground.solar < 0.25) warm.lerp(new THREE.Color(PALETTE.hemiSky), MORNING_COOL);
  rig.sun.color.lerp(warm, low * LOW.tint);
  rig.sun.intensity *= 1 + LOW.sun * low;
  rig.hemi.intensity *= 1 + LOW.hemi * low;
  rig.hemi.color.lerp(warm, LOW.hemiTint * low);
  // Небо и дымка идут за солнцем: иначе тёплое поле стоит под холодным небом.
  (scene.background as THREE.Color).lerp(warm, LOW.sky * low);
  const fog = scene.fog as THREE.Fog | null;
  if (fog) fog.color.lerp(warm, LOW.fog * low);
}

/**
 * Купол неба. Плоская заливка — это фон, а не небо: у неба есть верх и низ, и
 * именно градиент даёт кадру глубину, на фоне которой читаются знамёна и копья.
 *
 * Собирается после света: цвета берутся у самой сцены — зенит от её фона,
 * горизонт от её дымки. Тогда дальняя гряда растворяется в небе ровно там, где
 * кончается, а не упирается в него швом.
 */
export function buildSky(scene: THREE.Scene, ground: Ground): THREE.Mesh {
  // Сегментов вдвое больше деревенского неба: градиент по коротким граням даёт
  // полосы Маха, и на ровной заливке они видны швом.
  const geo = new THREE.SphereGeometry(SKY_R, 32, 14, 0, Math.PI * 2, 0, Math.PI * 0.6);
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  const pos = geo.attributes.position;
  const zenith = new THREE.Color().copy(scene.background as THREE.Color).multiplyScalar(ZENITH_MUL);
  const horizon = new THREE.Color().copy((scene.fog as THREE.Fog).color).multiplyScalar(HORIZON_MUL);
  // Насколько солнце ушло от полудня: 0 — зенит дуги, 1 — рассвет или закат.
  const low = Math.min(1, Math.abs(ground.solar - 0.25) / 0.25);
  // Тёплое пятно стоит там, где солнце, и тем горячее и шире, чем оно ниже.
  // В полдень его почти нет: полуденное небо ровное, и это правильно.
  const warm = new THREE.Color(seasonColor(ground.winter ? 'winter' : 'spring', 'sunDay')).lerp(
    new THREE.Color(PALETTE.sunDusk),
    low,
  );
  const sunX = Math.sin(SUN_AZIMUTH);
  const sunZ = Math.cos(SUN_AZIMUTH);
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const t = Math.min(1, Math.max(0, y / SKY_R));
    C.copy(horizon).lerp(zenith, t * t * (3 - 2 * t));
    const flat = Math.hypot(x, z) || 1e-6;
    const toward = Math.max(0, (x / flat) * sunX + (z / flat) * sunZ);
    const glow = GLOW * low * low * toward * toward * (1 - t) * (1 - t);
    if (glow > 0) C.lerp(C2.copy(warm), Math.min(1, glow));
    col[i * 3] = C.r;
    col[i * 3 + 1] = C.g;
    col[i * 3 + 2] = C.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    // Купол ничего не загораживает и в дымку не уходит: он и есть её дальний конец.
    depthWrite: false,
    fog: false,
  });
  mat.name = 'battle-sky';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Густота тени облаков на земле и кронах, 0..1 (`land.ts`): днём облака кладут на поле плывущие пятна, в сумерки
 * тень облака на длинном низком свете не читается — реже; зимой небо ровнее. Тот же бой — та же густота.
 */
export function cloudShade(ground: Ground): number {
  const low = Math.min(1, Math.abs(ground.solar - 0.25) / 0.25);
  return 0.3 * (1 - 0.65 * low) * (ground.winter ? 0.7 : 1);
}

/** Облака: купол чуть меньше неба; кучевые — шумом по проекции на слой над землёй. */
const CLOUD_R = 140;

const CLOUD_FRAG = /* glsl */ `
varying vec3 vTwSky;
uniform float uTwTime;
uniform vec3 uTwLit;
uniform vec3 uTwShade;
float twH(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float twV(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(twH(i), twH(i + vec2(1.0, 0.0)), f.x), mix(twH(i + vec2(0.0, 1.0)), twH(i + vec2(1.0, 1.0)), f.x), f.y);
}
float twFbm(vec2 p) {
  float s = 0.0;
  float a = 0.55;
  for (int i = 0; i < 4; i++) { s += a * twV(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return s;
}
`;

const CLOUD_COLOR = /* glsl */ `
vec3 twDir = normalize(vTwSky);
// Слой облаков над землёй: точка неба — проекция на плоскость; у горизонта облака сжимаются в полосу и тают в дымке.
vec2 twP = twDir.xz / max(0.06, twDir.y + 0.08) * 1.6 + vec2(uTwTime * 0.012, uTwTime * 0.004);
float twD = twFbm(twP);
float twA = smoothstep(0.5, 0.78, twD) * smoothstep(0.0, 0.12, twDir.y) * smoothstep(1.0, 0.55, twDir.y);
// Освещённый верх и тёмное брюхо: чем гуще облако, тем темнее его низ.
vec3 twC = mix(uTwLit, uTwShade, smoothstep(0.62, 0.95, twD));
diffuseColor = vec4(twC, twA * 0.9);
`;

/**
 * Облака над полем: купол, кучевые шумом в шейдере, свет — от солнца сцены (освещённые тёплые края на низком солнце,
 * серое брюхо). Один вызов; текстур нет. Идёт за камерой, как небо (`TwStage.apply`).
 */
export function buildClouds(scene: THREE.Scene, ground: Ground, rig: LightRig): { mesh: THREE.Mesh; update(t: number): void; relight(scene: THREE.Scene, ground: Ground, rig: LightRig): void } {
  const geo = new THREE.SphereGeometry(CLOUD_R, 32, 10, 0, Math.PI * 2, 0, Math.PI * 0.5);
  geo.deleteAttribute('uv');
  const low = Math.min(1, Math.abs(ground.solar - 0.25) / 0.25);
  const lit = new THREE.Color(0xf6f2ea).lerp(rig.sun.color, 0.35 + 0.35 * low);
  const shade = new THREE.Color().copy(scene.background as THREE.Color).multiplyScalar(0.78).lerp(new THREE.Color(0x8c8f99), 0.4);
  const uni = { uTwTime: { value: 0 }, uTwLit: { value: lit }, uTwShade: { value: shade } };
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide, transparent: true, depthWrite: false, fog: false });
  mat.name = 'battle-clouds';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = 'varying vec3 vTwSky;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvTwSky = position;');
    sh.fragmentShader = CLOUD_FRAG + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + CLOUD_COLOR);
  };
  mat.customProgramCacheKey = () => 'battle-clouds';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'clouds';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return {
    mesh,
    update(t: number): void {
      uni.uTwTime.value = t + ground.seed % 97;
    },
    // Час сменился (ролик осады): верх — от солнца или луны рига, брюхо — от фона сцены.
    relight(sc: THREE.Scene, g: Ground, r: LightRig): void {
      const night = g.solar > 0.5 && g.solar < 1;
      const lw = night ? 0 : Math.min(1, Math.abs(g.solar - 0.25) / 0.25);
      lit.set(night ? 0x8a93a8 : 0xf6f2ea).lerp(r.sun.color, 0.35 + 0.35 * lw);
      shade.copy(sc.background as THREE.Color).multiplyScalar(0.78).lerp(C2.set(night ? 0x2a3040 : 0x8c8f99), 0.4);
    },
  };
}
