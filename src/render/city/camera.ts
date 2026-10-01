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

/** Коробка теней вокруг цели: чем ближе камера, тем меньше коробка и чётче тень. */
export const cityShadowHalf = (dist: number): number => Math.min(190, Math.max(55, dist * 0.42));
