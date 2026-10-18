// Камера вида «город» в игре (docs/city.md, раздел 6): ракурс, приближение, поводок панорамы и дымка.
// Чистый модуль без three: числа берут сцена города (`scene.ts`), стенд и тест касания по раскладке.
//
// Ракурс тот же, что у стенда (`stand.CITY_VIEWS.game`): ворота внизу портретного экрана, площадь в
// середине, замок вверху. Поворота нет, как и в посёлке, — азимут один на вид; жест водит и приближает.

const DEG = Math.PI / 180;

/** Азимут камеры: от юга к востоку. Камера стоит на юге, у ворот, и смотрит на север, к замку. */
export const CITY_AZIMUTH = 14 * DEG;

/** Ключевой свет — спереди-слева от камеры, как у посёлка (`lighting.KEY_AZIMUTH`). */
export const CITY_KEY = CITY_AZIMUTH - 55 * DEG;

export interface CityFraming {
  fov: number;
  /** Угол от вертикали (у `Spherical` — полярный): 90° − высота камеры над горизонтом. */
  polar: number;
  dist: number;
  target: { x: number; y: number; z: number };
  zoom: { min: number; max: number };
}

/**
 * Стартовый кадр. Портретный телефон — главный случай: от ворот до донжона по высоте экрана между
 * шапкой и нижней панелью игры (390×844: ворота над панелью, шатёр донжона под шапкой — стенд стоял
 * на 420 м без интерфейса, игре нужно 520). Шире — поле зрения уже, а расстояние то же: город целиком
 * по вертикали, по бокам — предместья и поля.
 */
export function cityFraming(aspect: number): CityFraming {
  const fov = aspect > 1 ? 32 : 36;
  return {
    fov,
    polar: (90 - 52) * DEG,
    dist: 520,
    target: { x: 0, y: 6, z: -16 },
    // Пол — один дом во весь экран, потолок — город с предместьями и лесом в дымке.
    zoom: { min: 45, max: 640 },
  };
}

/**
 * Поводок панорамы: цель не уходит за угодья. Прямоугольник — река на западе, поля на востоке, лес
 * за замком на севере и дорога в долину на юге.
 */
export const CITY_LEASH = { x0: -230, x1: 260, z0: -270, z1: 250 } as const;

export function cityLeash(x: number, z: number): { x: number; z: number } {
  return {
    x: Math.min(Math.max(x, CITY_LEASH.x0), CITY_LEASH.x1),
    z: Math.min(Math.max(z, CITY_LEASH.z0), CITY_LEASH.z1),
  };
}

/** Шаг панорамы за одно событие пальца, дальше которого — вырождение у горизонта (метры). */
export const CITY_STEP_MAX = 160;

/** Дымка за целью: середина кадра чистая, даль уходит в воздух (стенд, круг 7 самопроверки). */
export function cityFog(dist: number): { near: number; far: number } {
  return { near: dist * 0.8, far: dist * 2.1 + 150 };
}

/**
 * Середина коробки теней изнутри покоев, м вперёд от донжона по взгляду (Г-9): коробка (±`cityShadowHalf` вида изнутри)
 * берёт город от стены донжона до точки взгляда, а не вокруг точки в 130 м, и стоит на сетке своих текселей
 * (`shadowSnap`): качание головы её не двигает, и тень под окном не перескакивает при каждом теневом проходе.
 */
export const INSIDE_SHADOW_AHEAD = 72;

/** Коробка теней вокруг цели: чем ближе камера, тем меньше коробка и чётче тень. */
export const cityShadowHalf = (dist: number): number => Math.min(190, Math.max(55, dist * 0.42));

/**
 * Где стоит лампа солнца (луны): над целью камеры, по направлению светила, далеко — коробка теней идёт за
 * кадром. Направление берётся из позиции, которую ставит общий риг (`lighting.applyDayNight`), и не
 * зависит от того, куда смотрит камера.
 */
export function citySunAt(target: { x: number; y: number; z: number }, from: { x: number; y: number; z: number }, dist = 600): { x: number; y: number; z: number } {
  const l = Math.hypot(from.x, from.y, from.z) || 1;
  return { x: target.x + (from.x / l) * dist, y: target.y + (from.y / l) * dist, z: target.z + (from.z / l) * dist };
}

/**
 * Середина коробки теней — на сетке её текселей (Г-9, мерцание у окна): в плоскости поперёк светила (оси камеры тени —
 * `lookAt` вдоль светила, верх — небо) точка встаёт на ближний узел шага `texel`. Сдвиг меньше полутекселя коробку не
 * двигает, больший — на целые тексели, и тени не переливаются с каждым шагом взгляда. Вдоль светила — как была.
 */
export function shadowSnap(at: { x: number; y: number; z: number }, from: { x: number; y: number; z: number }, texel: number): { x: number; y: number; z: number } {
  const l = Math.hypot(from.x, from.y, from.z) || 1;
  const zx = from.x / l;
  const zy = from.y / l;
  const zz = from.z / l;
  // Право = верх × к светилу, верх камеры = к светилу × право (как у `Object3D.lookAt` камеры с верхом +y).
  let rx = zz;
  let rz = -zx;
  const rl = Math.hypot(rx, rz);
  if (rl < 1e-6) {
    rx = 1;
    rz = 0;
  } else {
    rx /= rl;
    rz /= rl;
  }
  const ux = zy * rz;
  const uy = zz * rx - zx * rz;
  const uz = -zy * rx;
  const a = at.x * rx + at.z * rz;
  const b = at.x * ux + at.y * uy + at.z * uz;
  const da = Math.round(a / texel) * texel - a;
  const db = Math.round(b / texel) * texel - b;
  return { x: at.x + rx * da + ux * db, y: at.y + uy * db, z: at.z + rz * da + uz * db };
}

// ---------- Полёт камеры (ОР-1, docs/ui_v2.md, 5.9) ----------

/** Где камера: цель на земле и расстояние до неё (ракурс один — `cityFraming.polar`). */
export interface CamPose {
  x: number;
  z: number;
  dist: number;
}

/** Полёт «Показать в городе» и «Домой», с: заметно, что камера летит, и не ждёшь. */
export const FLY_S = 0.9;

/** Подсветка показанной постройки, с — считая с конца полёта: глаз успевает найти её и прочесть подпись. */
export const SHOW_GLOW_S = 2.6;

/**
 * Расстояние камеры до показанной постройки: по её размеру — постройка крупно, а соседи вокруг видны, чтобы понять, где
 * она. Пол — ближе улица уже не читается кварталом; потолок — дальше постройка теряется среди крыш.
 */
export const SHOW_DIST = { min: 120, max: 230, k: 5 } as const;

export function showDist(site: { hf: number; hr: number; y0: number; y1: number }): number {
  const size = Math.max(site.hf, site.hr, site.y1 - site.y0);
  return Math.min(SHOW_DIST.max, Math.max(SHOW_DIST.min, size * SHOW_DIST.k));
}

/** Плавный шаг полёта: от `a` к `b` на доле `k` (0..1), разгон и торможение — `smoothstep`. */
export function flyAt(a: CamPose, b: CamPose, k: number): CamPose {
  const t = Math.min(1, Math.max(0, k));
  const e = t * t * (3 - 2 * t);
  return { x: a.x + (b.x - a.x) * e, z: a.z + (b.z - a.z) * e, dist: a.dist + (b.dist - a.dist) * e };
}

/** Ушла ли камера с дома — стартового кадра (`cityFraming`): на метры, а не на дрожь дробей. */
export const awayFrom = (p: CamPose, home: CamPose): boolean => Math.hypot(p.x - home.x, p.z - home.z) > 4 || Math.abs(p.dist - home.dist) > 8;
