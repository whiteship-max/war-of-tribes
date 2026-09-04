// Фиксированный план поселения: у каждого типа здания своё именованное место.
//
// Автоподбора свободного слота больше нет. Причина простая: свободная расстановка
// никогда не даёт аккуратной композиции — посёлок расползается, а на поздних уровнях
// крыши лезут друг на друга. Здесь же место известно заранее и рассчитано под самую
// крупную, третью визуальную ступень здания, поэтому картинка остаётся собранной
// на любой стадии.
//
// Файл нарочно не знает про three.js: это чистые числа, и тест проверяет их
// напрямую — все постройки максимального уровня помещаются внутри стены,
// не пересекаются и не стоят на дорогах.
import type { BuildingTypeId } from '@/game/types';
import { MAX_BUILDING_LEVEL, VISUAL_TIERS } from '@/game/constants';

/**
 * Общий масштаб построек в плане. Модели рисовались под прежнюю вольную
 * расстановку и для кольцевого посёлка велики: под стеной должно помещаться
 * два десятка дворов, как на укреплённом поселении в Tribal Wars.
 */
export const PLAN_SCALE = 0.62;

/**
 * Радиус стены. Задан раз и навсегда: места под здания режутся под него, а камера
 * кадрируется от него же — поэтому кадр не дёргается при каждой новой постройке.
 */
export const WALL_RADIUS = 15.6;

/** Открытая площадь в центре: костёр, колодец и место, где собираются жители. */
export const PLAZA_RADIUS = 2.5;

/** Полуширина дороги. По ней же считается зазор между дорогой и площадкой. */
export const ROAD_HALF = 0.5;

/**
 * Ворота. Угол выбран так, чтобы они смотрели в камеру при стартовом ракурсе
 * (азимут камеры — Math.atan2(9, 12)), и больше не меняется никогда.
 */
export const GATE_ANGLE = Math.atan2(0.8, 0.6);

/** Радиусы колец, от центра наружу. Индекс — номер кольца. */
export const RING_RADIUS: [number, number, number, number] = [0, 5, 8, 11.9];

/** Насколько подрастает постройка к десятому уровню (levelScale в buildings.ts). */
const TOP_LEVEL_SCALE = 1 + 0.045 * (MAX_BUILDING_LEVEL - VISUAL_TIERS[1]);

/**
 * Радиус модели третьей ступени в её собственных единицах — снят с настоящих
 * bounding box готовых моделей. Меняешь модель — правь число и прогоняй тест
 * `план поселения`: он сверяет эту таблицу с геометрией.
 */
export const MODEL_RADIUS: Record<BuildingTypeId, number> = {
  campfire: 1.05,
  shelter: 2.3,
  chief_house: 2.6,
  hut: 2.95,
  knowledge: 2.47,
  storage: 3.2,
  gathering: 2.27,
  sawmill: 2.47,
  quarry: 2.48,
  hunter_hut: 2.21,
  mine: 2.82,
  workshop: 3.15,
  farm: 2.95,
  pen: 2.96,
  totem: 2.0,
  smithy: 3.48,
  barracks: 3.3,
  market: 3.55,
  tower: 1.58,
  // Стена — это само кольцо, площадки под неё нет.
  palisade: 0,
};

/** Запас между площадками: чтобы соседние крыши не касались. */
const PLOT_MARGIN = 0.22;

/**
 * Радиус площадки под здание. Считается по самой крупной ступени и по
 * десятому уровню — иначе к концу партии постройки вылезут за отведённое место.
 * Стартовые здания уровней не набирают, им хватает своей ступени.
 */
export function plotRadius(type: BuildingTypeId): number {
  const flat = type === 'campfire' || type === 'shelter';
  return MODEL_RADIUS[type] * PLAN_SCALE * (flat ? 1 : TOP_LEVEL_SCALE) + PLOT_MARGIN;
}

export interface Place {
  /** Кольцо: 1 — власть и жильё, 2 — хозяйство, 3 — производство. */
  ring: 1 | 2 | 3;
  /** Угол на кольце, радианы. */
  angle: number;
}

const D = Math.PI / 180;

/**
 * Кольца рассчитаны так, чтобы соседние кольца шли «в шахматном порядке»:
 * второе смещено на полшага от первого, третье — на полшага от второго.
 * Ворота приходятся ровно на просвет первого кольца и на пустое место второго —
 * поэтому главная улица от ворот до площади ни во что не упирается.
 *
 * Углы записаны числами, а не формулой: место здания — это факт, который должно
 * быть видно глазом в таблице, а не результат вычисления в трёх местах.
 */
export const PLAN: Partial<Record<BuildingTypeId, Place>> = {
  // Первое кольцо: власть, жильё, знание и святилище. Дом вождя — прямо напротив
  // ворот через площадь: его видно, едва войдёшь.
  shelter: { ring: 1, angle: 17.13 * D },
  totem: { ring: 1, angle: 89.13 * D },
  knowledge: { ring: 1, angle: 161.13 * D },
  chief_house: { ring: 1, angle: 233.13 * D },
  hut: { ring: 1, angle: 305.13 * D },

  // Второе кольцо: хозяйство. Рынок стоит ровно на воротах: главная улица идёт
  // сквозь его ряды, как через привратную площадь настоящего города. Отвода
  // к нему нет — улица от ворот и есть его подъезд (см. spurFor и ROAD_THROUGH).
  market: { ring: 2, angle: GATE_ANGLE },
  smithy: { ring: 2, angle: 125.13 * D },
  workshop: { ring: 2, angle: 197.13 * D },
  barracks: { ring: 2, angle: 269.13 * D },
  storage: { ring: 2, angle: 341.13 * D },

  // Третье кольцо: производство. Каждое здание смотрит в сторону своей зоны
  // за стеной — лесопилка к лесу, каменоломня к скалам, ферма к полям.
  gathering: { ring: 3, angle: 35.13 * D },
  farm: { ring: 3, angle: 143.13 * D },
  pen: { ring: 3, angle: 179.13 * D },
  quarry: { ring: 3, angle: 215.13 * D },
  mine: { ring: 3, angle: 251.13 * D },
  hunter_hut: { ring: 3, angle: 287.13 * D },
  sawmill: { ring: 3, angle: 323.13 * D },
};

/**
 * Башня стоит сбоку от ворот, внутри окружной дороги: дозорная вышка над въездом,
 * а не отдельная постройка в поле. Сами надвратные башенки рисует стена.
 */
export const TOWER_PLACE = { r: 12.8, angle: 73.13 * D };

/**
 * Свободные места плана. Пока на них ничего не построено — это размеченные
 * площадки, которые по мере роста посёлка обрастают декором: поленницами,
 * бочками, телегами. Пустой кружок земли читается как «здесь ещё будет дом».
 */
export const SPARE_PLOTS: Place[] = [
  { ring: 3, angle: 107.13 * D },
  { ring: 3, angle: 359.13 * D },
];

/**
 * Здания, сквозь которые главная улица проходит нарочно. Пока такое одно —
 * рынок: торговые ряды стоят по обе стороны проезда, а между ними идёт дорога
 * из ворот. Модель обязана держать этот проезд свободным, и это проверяет тест.
 */
export const ROAD_THROUGH: BuildingTypeId[] = ['market'];

/** Половина ширины проезда, который такое здание обязано оставить свободным. */
export const THROUGH_HALF = 1.15;

export interface Spot {
  x: number;
  z: number;
  /** Поворот вокруг Y: фасадом к центру. */
  rot: number;
  /** Расстояние от центра. */
  r: number;
  angle: number;
}

/** Поворот, при котором перёд модели (её +z) смотрит в центр посёлка. */
export const facingCenter = (angle: number): number =>
  Math.atan2(-Math.cos(angle), -Math.sin(angle));

export function spotAt(r: number, angle: number): Spot {
  return { x: Math.cos(angle) * r, z: Math.sin(angle) * r, rot: facingCenter(angle), r, angle };
}

/** Место здания по плану. Стена и костёр стоят в центре — у них своё правило. */
export function placeOf(type: BuildingTypeId): Spot {
  if (type === 'campfire' || type === 'palisade') return { x: 0, z: 0, rot: 0, r: 0, angle: 0 };
  if (type === 'tower') return spotAt(TOWER_PLACE.r, TOWER_PLACE.angle);
  const p = PLAN[type];
  // Новый тип без места в плане не должен ронять сцену: ставим его на пустое место.
  if (!p) return spotAt(RING_RADIUS[3], SPARE_PLOTS[0].angle);
  return spotAt(RING_RADIUS[p.ring], p.angle);
}

/** Все занятые планом места — для теста и для расстановки декора. */
export const plannedTypes = (): BuildingTypeId[] => Object.keys(PLAN) as BuildingTypeId[];

/**
 * Где встанет здание — словами. Со сцены разметка пустых мест убрана (её кольца
 * обещали дом там, где игрок ничего не начинал), поэтому место непостроенного
 * называет панель «Здания». Здесь только числа и типы: имена зданий подставляет
 * интерфейс, а падежей в тексте нет нарочно — их пришлось бы склонять по-русски.
 *
 * Сторона считается от ворот: игрок смотрит на посёлок ровно от них (GATE_ANGLE
 * выведен из азимута стартовой камеры), поэтому «справа от ворот» — это правая
 * половина экрана, а не абстрактное направление.
 */
export type PlaceSide = 'gate' | 'right' | 'left' | 'opposite';

export interface PlaceHint {
  /** 0 — центр площади, 4 — само кольцо стены. */
  ring: 0 | 1 | 2 | 3 | 4;
  side: PlaceSide;
  /** Соседи по кольцу — ближайшие занятые планом места слева и справа. */
  neighbours: BuildingTypeId[];
}

/** Разница углов, приведённая к (−180°, 180°]. Плюс — против часовой. */
const angleDelta = (a: number, from: number): number => {
  let d = (a - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
};

function sideOf(angle: number): PlaceSide {
  const d = angleDelta(angle, GATE_ANGLE);
  const abs = Math.abs(d);
  if (abs < 25 * D) return 'gate';
  if (abs > 155 * D) return 'opposite';
  // Мир поворачивается на экран зеркально: против часовой стрелки — это влево.
  return d > 0 ? 'left' : 'right';
}

export function placeHint(type: BuildingTypeId): PlaceHint {
  if (type === 'campfire') return { ring: 0, side: 'gate', neighbours: [] };
  if (type === 'palisade') return { ring: 4, side: 'gate', neighbours: [] };
  const angle = type === 'tower' ? TOWER_PLACE.angle : (PLAN[type]?.angle ?? SPARE_PLOTS[0].angle);
  const ring: 1 | 2 | 3 = type === 'tower' ? 3 : (PLAN[type]?.ring ?? 3);
  // Соседи — ближайшие по углу места того же кольца: по одному в каждую сторону.
  let left: [BuildingTypeId, number] | null = null;
  let right: [BuildingTypeId, number] | null = null;
  for (const [other, place] of Object.entries(PLAN) as [BuildingTypeId, Place][]) {
    if (other === type || place.ring !== ring) continue;
    const d = angleDelta(place.angle, angle);
    if (d > 0 && (left === null || d < left[1])) left = [other, d];
    if (d < 0 && (right === null || -d < -right[1])) right = [other, d];
  }
  return { ring, side: sideOf(angle), neighbours: [right?.[0], left?.[0]].filter(Boolean) as BuildingTypeId[] };
}

// ---------- Дороги ----------

/**
 * Дорожная сеть посёлка. Три вида дорог, и все три родом из плана, а не из
 * положения построек: они не меняются, когда посёлок растёт, — меняется только
 * покрытие (тропинка → утоптанная земля → мощёный камень).
 */
export interface RoadRing {
  r: number;
}

/**
 * Кольцевая дорога вокруг костра. Идёт чуть внутри края площади: между площадью
 * и первым кольцом просвета на полосу нет — дома стоят к огню вплотную.
 */
export const PLAZA_ROAD = 2.2;

/**
 * Окружная дорога под стеной. Единственное место, где полное кольцо помещается:
 * между кольцами застройки просветов нет, зато между третьим кольцом и стеной есть.
 */
export const OUTER_ROAD = 14.7;

export interface RoadSpur {
  angle: number;
  from: number;
  to: number;
}

/**
 * Отвод к зданию: отрезок вдоль его же радиуса. Первое и второе кольцо выходят
 * внутрь, к площади (второе проходит ровно в просвет между домами первого),
 * третье — наружу, к окружной дороге. С той стороны, куда идёт отвод, всегда пусто,
 * поэтому дорога не режет соседей — это проверяет тест.
 */
export function spurFor(type: BuildingTypeId): RoadSpur | null {
  // Рынку отвод не нужен: к нему ведёт сама главная улица, она идёт через него.
  if (ROAD_THROUGH.includes(type)) return null;
  const p = PLAN[type];
  if (!p) return null;
  const r = RING_RADIUS[p.ring];
  const edge = plotRadius(type);
  if (p.ring === 3) return { angle: p.angle, from: r + edge * 0.7, to: OUTER_ROAD };
  return { angle: p.angle, from: PLAZA_ROAD, to: r - edge * 0.7 };
}

/** Главная улица: от ворот в стене до кольцевой дороги площади. */
export const GATE_ROAD: RoadSpur = { angle: GATE_ANGLE, from: PLAZA_ROAD, to: WALL_RADIUS };

// ---------- Зона расчистки ----------

/**
 * Запас между стеной и лесом. Племя, ставя посёлок, валит вокруг него лес:
 * иначе частокол некуда замкнуть, а деревья лезут прямо на кладку. Больше не
 * надо: с запасом в 4.6 посёлок терялся посреди пустого зелёного круга.
 */
export const CLEAR_MARGIN = 3.2;

/**
 * Радиус расчистки. Внутри него нет ничего, кроме самого поселения, дорог и
 * стены: ни деревьев, ни камней, ни кустов. Внешний декор расставляется той же
 * детерминированной сыпью, что и раньше, — просто позиции внутри этого круга
 * отбрасываются (см. render/terrain.ts).
 */
export const CLEAR_RADIUS = WALL_RADIUS + CLEAR_MARGIN;

/**
 * Полоса за границей расчистки, где стоят следы работы: пни, поваленные стволы,
 * срезанный подлесок. Без неё край читался бы дырой в лесу, а не расчищенным местом.
 */
export const CLEAR_EDGE = 3.2;

/**
 * Половина ширины свободного коридора перед воротами. Выезд не должен упираться
 * в лес: телега каравана выходит из ворот и едет по чистому.
 */
export const GATE_CLEAR_HALF = 3.4;

/**
 * Объект попадает в зону расчистки — ставить его туда нельзя. `radius` — габарит
 * самого объекта: проверяется не точка, а крона дерева и длина бревна, иначе
 * ствол стоял бы снаружи, а ветки нависали над стеной.
 */
export function inCleared(x: number, z: number, radius = 0): boolean {
  if (Math.hypot(x, z) < CLEAR_RADIUS + radius) return true;
  // Коридор перед воротами: считаем расстояние до луча, а не до прямой, —
  // позади посёлка лес стоит спокойно.
  const along = x * Math.cos(GATE_ANGLE) + z * Math.sin(GATE_ANGLE);
  if (along <= -radius) return false;
  const across = Math.abs(-x * Math.sin(GATE_ANGLE) + z * Math.cos(GATE_ANGLE));
  return across < GATE_CLEAR_HALF + radius;
}
