// Покои правителя (docs/city_v3.md, Г-4): план комнаты на верхнем ярусе донжона — размеры, точки интереса, предметы стола
// и безделушки. Чистый модуль без three: его читают сборка модели, управление и тесты.
//
// Оси комнаты — оси мира (донжон стоит по ним, `layout.ts`, `keep`): +z — юг, к городу и камере игры, +x — восток, y —
// вверх от пола. Начало — середина пола. Мир = (x донжона + x, пол + y, z донжона + z).
//
// Что где стоит (вид сверху, юг внизу):
//
//     север:  кровать под пологом · камин с колпаком · дверь к лестнице
//     запад:  гобелен, окно на реку          восток: оружие и сундук с короной, окно на мыс
//     середина: люстра-обруч, шахматы у огня
//     юг:     стол с документами, за ним кресло лицом к большому окну — на город

/** Внутренняя полуширина комнаты, м: донжон 13 м, стены по 1.3. */
export const HALF = 5.2;
/** Высота стен до стропил, м; конёк шатра изнутри — `APEX`. */
export const WALL_H = 4.7;
export const APEX = 9.4;
/** Пол покоев — ниже верха башни (`Tower.base + height`) на столько: верхний ярус с окнами (`forts.ts`, `stoneWin`). */
export const FLOOR_BELOW_TOP = 3.9;

/** Пол комнаты в мире: верх донжона минус ярус. */
export const floorOf = (keep: { base: number; height: number }): number => keep.base + keep.height - FLOOR_BELOW_TOP;

/** Коробка в осях комнаты. */
export interface Box {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
}
export const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box => ({ x0, y0, z0, x1, y1, z1 });

/**
 * Где стоит глаз: место, взгляд (`yaw` 0 — на юг, к окну и городу; плюс — к востоку; `pitch` плюс — вверх), поле зрения
 * по вертикали, градусы.
 */
export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  fov: number;
}

export type PoiId = 'hall' | 'desk' | 'window' | 'hearth' | 'bed' | 'arms';

/** Точка интереса: куда переходит глаз касанием (свободной ходьбы нет), насколько можно повернуть голову. */
export interface Poi {
  id: PoiId;
  /** Подпись кнопки — одно слово; `verb` — что делает игрок. */
  name: string;
  verb: string;
  pose: Pose;
  /** Повороты головы от взгляда точки: влево-вправо и вниз-вверх, радианы. `null` — кругом. */
  yaw: readonly [number, number] | null;
  pitch: readonly [number, number];
  /** Приближение взглядом вдаль — пределы поля зрения, градусы (только у окна). */
  zoom?: readonly [number, number];
  /** Что в комнате ведёт сюда касанием. */
  hits: readonly Box[];
}

const DEG = Math.PI / 180;

/** Толщина стены донжона (от комнаты до наружной грани башни), м; проём кончается чуть за ней. */
export const WALL_T = 1.3;

/**
 * Окно — ниша в толще стены: у комнаты широкая (`inW`) с низом `inSill`, к наружной грани сужается до `midW` на глубине
 * `plate` — там стоит каменная доска с проёмом (или двумя, у парного окна) от подоконника `sill` до пяты `spring` и
 * полукруглой арки. Юг — большое окно на город, ниша от пола и сиденья по бокам; запад и восток — парные, на реку и мыс.
 */
export interface Opening {
  wall: 'south' | 'west' | 'east';
  /** Середина проёма: x у южной стены, z у боковых. */
  at: number;
  inW: number;
  inSill: number;
  inSpring: number;
  midW: number;
  plate: number;
  outW: number;
  sill: number;
  spring: number;
  twin: boolean;
  /** Каменные сиденья по бокам ниши. */
  seats: boolean;
}

export const OPENINGS: readonly Opening[] = [
  { wall: 'south', at: 0, inW: 2.6, inSill: 0, inSpring: 3.0, midW: 2.15, plate: 0.95, outW: 1.7, sill: 0.95, spring: 2.65, twin: false, seats: true },
  { wall: 'west', at: 2.3, inW: 1.9, inSill: 0.62, inSpring: 2.75, midW: 1.5, plate: 0.95, outW: 1.15, sill: 1.05, spring: 2.45, twin: true, seats: false },
  { wall: 'east', at: 2.3, inW: 1.9, inSill: 0.62, inSpring: 2.75, midW: 1.5, plate: 0.95, outW: 1.15, sill: 1.05, spring: 2.45, twin: true, seats: false },
];

/** Где на стене: внутренняя грань, ось вдоль стены (`U`, правило для откосов) и наружу (`N`). */
export interface WallAxes {
  n: readonly [number, number, number];
  u: readonly [number, number, number];
}
export const WALL_AXES: Record<'south' | 'north' | 'west' | 'east', WallAxes> = {
  south: { n: [0, 0, 1], u: [1, 0, 0] },
  north: { n: [0, 0, -1], u: [-1, 0, 0] },
  west: { n: [-1, 0, 0], u: [0, 0, 1] },
  east: { n: [1, 0, 0], u: [0, 0, -1] },
};

/** Точка стены: вдоль (по `U`), высота, глубина в толщу (0 — грань комнаты). */
export function wallPoint(w: keyof typeof WALL_AXES, along: number, y: number, depth: number): [number, number, number] {
  const { n, u } = WALL_AXES[w];
  return [n[0] * (HALF + depth) + u[0] * along, y, n[2] * (HALF + depth) + u[2] * along];
}

/** Координата середины проёма (x у южной, z у боковых) — «вдоль» стены по её оси `U`. */
export const alongOf = (o: Opening): number => {
  const u = WALL_AXES[o.wall].u;
  return o.at * (u[0] + u[2]);
};

/** Камин у северной стены: устье, колпак, очаг. Огонь светит отсюда. */
export const HEARTH = { x: 0, mouthW: 1.9, mouthH: 1.25, depth: 0.62, hoodW: 3.0, hoodFront: -4.35, hoodLow: 1.55, hoodTop: 3.9, fire: { x: 0, y: 0.42, z: -5.42 } };

/** Дверь к лестнице в северо-восточном углу. */
export const DOOR = { x: 3.85, w: 1.15, h: 2.35 };

/** Стол: трапезный стол на козлах, лицом к окну; кресло за ним. */
export const DESK = { x: 0, z: 3.05, w: 2.3, d: 1.0, top: 0.78 };
export const CHAIR = { x: 0, z: 2.12 };

/** Кровать под пологом в северо-западном углу, изголовьем к северу. */
export const BED = { x0: -5.0, x1: -3.15, z0: -5.05, z1: -2.85, top: 0.62, canopy: 2.55 };

/** Стена оружия на востоке и сундук под ней. */
export const ARMS = { z: -2.35, y: 2.15 };

/** Столик с шахматами у огня. */
export const CHESS = { x: 2.15, z: -2.75, top: 0.68, board: 0.5 };

export const POIS: readonly Poi[] = [
  {
    id: 'hall',
    name: 'Покои',
    verb: 'Встать посреди покоев',
    // Из глубины покоев к югу и западу: стол, большое окно и гобелен — кресло не заслоняет стол.
    pose: { x: 1.55, y: 1.64, z: -1.9, yaw: -0.24, pitch: -0.16, fov: 70 },
    yaw: null,
    pitch: [-0.95, 0.95],
    hits: [box(-3.4, -0.05, -2.2, 3.4, 0.05, 1.0)],
  },
  {
    id: 'desk',
    name: 'Кресло',
    verb: 'Сесть за стол',
    pose: { x: 0, y: 1.38, z: 2.08, yaw: 0, pitch: -0.5, fov: 62 },
    yaw: [-1.25, 1.25],
    pitch: [-1.15, 0.4],
    hits: [box(-0.45, 0, 1.75, 0.45, 1.5, 2.45), box(-1.2, 0, 2.5, 1.2, 0.8, 3.6)],
  },
  {
    id: 'window',
    name: 'Окно',
    verb: 'Подойти к окну',
    pose: { x: 0, y: 1.6, z: 5.55, yaw: 0, pitch: -0.2, fov: 62 },
    yaw: [-0.95, 0.95],
    pitch: [-0.9, 0.45],
    zoom: [16, 62],
    hits: [box(-1.35, 0.4, 5.1, 1.35, 3.9, 6.5)],
  },
  {
    id: 'hearth',
    name: 'Камин',
    verb: 'Встать у огня',
    pose: { x: 0.55, y: 1.6, z: -1.85, yaw: Math.PI + 0.14, pitch: -0.2, fov: 64 },
    yaw: [-1.7, 1.7],
    pitch: [-1.05, 0.65],
    hits: [box(-1.6, 0, -5.2, 1.6, 3.9, -4.2), box(1.6, 0, -3.3, 2.7, 0.75, -2.2)],
  },
  {
    id: 'bed',
    name: 'Кровать',
    verb: 'Лечь в кровать',
    // Лёжа, голова на подушке: в ногах — покрывало, за ним покои и огонь камина; вверху — подбой полога.
    pose: { x: -4.08, y: 1.08, z: -4.5, yaw: 0.95, pitch: 0.1, fov: 70 },
    yaw: [-1.35, 1.35],
    pitch: [-0.35, 1.35],
    hits: [box(BED.x0, 0, BED.z0, BED.x1, BED.canopy, BED.z1)],
  },
  {
    id: 'arms',
    name: 'Оружие',
    verb: 'Подойти к оружию',
    pose: { x: 3.25, y: 1.62, z: -2.25, yaw: Math.PI / 2, pitch: -0.12, fov: 64 },
    yaw: [-1.45, 1.45],
    pitch: [-0.95, 0.6],
    hits: [box(4.6, 0, -3.9, 5.2, 3.4, -0.8)],
  },
];

export const POI_BY_ID = Object.fromEntries(POIS.map((p) => [p.id, p])) as Record<PoiId, Poi>;

/**
 * Окна игры, в которые ведут предметы стола (`ui/chambers/doors.ts` открывает их той же дверью, что кнопки игры):
 * Вести, Карта, Держава (указы), Жители, Дружина, Ратуша (стройка), Сокровищница, герб державы (профиль).
 */
export type Door = 'news' | 'map' | 'decrees' | 'people' | 'army' | 'build' | 'treasury' | 'arms';

export type DeskId = 'letters' | 'map' | 'decrees' | 'people' | 'army' | 'plans' | 'purse' | 'seal';
export type TrinketId = 'goblet' | 'chess' | 'sword' | 'crown' | 'candle';
export type ThingId = DeskId | TrinketId;

/** Предмет, который можно тронуть: подпись, строка о нём, где лежит и откуда до него дотянуться. */
export interface Thing {
  id: ThingId;
  name: string;
  hint: string;
  /** Коробка касания в осях комнаты (с запасом на палец — `pick.ts` раздувает мелкое до пальца). */
  box: Box;
  /** С какой точки предмет берут; издали касание ведёт туда. */
  poi: PoiId;
  /** Номер в шейдере — подсветка предмета (`cfg.w` вершин), 1…; 0 — ничьё. */
  code: number;
}

export interface DeskThing extends Thing {
  id: DeskId;
  door: Door;
}

export interface Trinket extends Thing {
  id: TrinketId;
  /** Размер предмета, м — коробка касания у глаза. */
  size: number;
  /** Как держать: расстояние от глаза, м, и наклон к глазу (радианы; меч — наискось плоскостью к глазу). */
  hold: number;
  tilt: number;
}

const top = DESK.top;
/** Предметы стола: из кресла лицом на юг восток — слева; здесь — с запада на восток. */
export const DESK_THINGS: readonly DeskThing[] = [
  // Сзади: книга людей, планы, перечень войска; посередине — карта, по бокам печать и кошель; спереди — письма и свиток.
  // Ближний ряд уже дальнего: из кресла на экране телефона стоймя (по горизонтали около 42°, `fitFov`) у края стола видно
  // ±0.34 м, у дальнего — ±0.5 (тест «из кресла видны все предметы стола»).
  { id: 'people', name: 'Список людей', hint: 'Кто чем занят в городе — «Жители»', door: 'people', poi: 'desk', code: 1, box: box(0.08, top, 3.22, 0.46, top + 0.06, 3.5) },
  { id: 'plans', name: 'Планы построек', hint: 'Что строить и улучшать — Ратуша', door: 'build', poi: 'desk', code: 4, box: box(-0.17, top, 3.24, 0.16, top + 0.05, 3.52) },
  { id: 'army', name: 'Перечень войска', hint: 'Гарнизон и полководец — Дружина', door: 'army', poi: 'desk', code: 6, box: box(-0.48, top, 3.14, -0.21, top + 0.04, 3.54) },
  { id: 'map', name: 'Карта', hint: 'Земли державы и соседей', door: 'map', poi: 'desk', code: 3, box: box(-0.22, top, 2.86, 0.22, top + 0.04, 3.2) },
  { id: 'letters', name: 'Письма', hint: 'Вести и донесения — на стол правителю', door: 'news', poi: 'desk', code: 2, box: box(0.05, top, 2.6, 0.33, top + 0.04, 2.8) },
  { id: 'seal', name: 'Печать', hint: 'Герб державы на печати — свой герб', door: 'arms', poi: 'desk', code: 8, box: box(0.27, top, 2.94, 0.37, top + 0.13, 3.06) },
  { id: 'purse', name: 'Кошель', hint: 'Алмазы и лавка — Сокровищница', door: 'treasury', poi: 'desk', code: 7, box: box(-0.38, top, 2.92, -0.25, top + 0.13, 3.08) },
  { id: 'decrees', name: 'Свиток указов', hint: 'Указы, паёк и налог — Держава', door: 'decrees', poi: 'desk', code: 5, box: box(-0.34, top, 2.58, -0.06, top + 0.08, 2.84) },
];

/** Безделушки: взять в руки и покрутить. Механики у них нет — только вид. */
export const TRINKETS: readonly Trinket[] = [
  { id: 'goblet', name: 'Кубок', hint: 'Серебро с позолотой, вино с юга', poi: 'desk', code: 9, size: 0.2, hold: 0.42, tilt: 0.45, box: box(0.5, top, 2.62, 0.66, top + 0.21, 2.78) },
  { id: 'candle', name: 'Свеча', hint: 'Воск, а не сало, — свеча правителя', poi: 'desk', code: 10, size: 0.3, hold: 0.52, tilt: 0.15, box: box(-0.66, top, 2.62, -0.5, top + 0.36, 2.78) },
  // Белый король — на своей клетке доски (e1, `build.chessTable`): доска 0.5 м, клетка 1/16 м.
  { id: 'chess', name: 'Шахматная фигура', hint: 'Король из моржовой кости', poi: 'hearth', code: 11, size: 0.12, hold: 0.3, tilt: 0.3, box: box(CHESS.x + 0.001, CHESS.top + 0.012, CHESS.z + 0.189, CHESS.x + 0.061, CHESS.top + 0.14, CHESS.z + 0.249) },
  { id: 'sword', name: 'Меч', hint: 'Клинок отца, перекрестье в позолоте', poi: 'arms', code: 12, size: 1.0, hold: 0.8, tilt: 0, box: box(5.0, 1.45, -3.0, 5.2, 1.66, -1.7) },
  { id: 'crown', name: 'Корона', hint: 'Венец державы, на подушке', poi: 'arms', code: 13, size: 0.24, hold: 0.46, tilt: 0.55, box: box(4.4, 0.66, -2.62, 4.84, 0.86, -2.18) },
];

export const THINGS: readonly Thing[] = [...DESK_THINGS, ...TRINKETS];
export const THING_BY_ID = Object.fromEntries(THINGS.map((t) => [t.id, t])) as Record<ThingId, Thing>;
export const isTrinket = (t: Thing): t is Trinket => TRINKETS.some((x) => x.id === t.id);

/**
 * Поле зрения по вертикали под экран: на телефоне стоймя кадр узок, и по горизонтали должно быть видно не меньше
 * `hfov` градусов (стол из кресла, стена из середины), — вертикаль растёт до потолка `max`; на широком экране — как у точки.
 */
export function fitFov(fov: number, aspect: number, hfov = 42, max = 82): number {
  const need = (2 * Math.atan(Math.tan(((hfov / 2) * Math.PI) / 180) / Math.max(0.1, aspect)) * 180) / Math.PI;
  return Math.max(fov, Math.min(max, need));
}

/** Взгляд из точки по повороту головы: единичный вектор в осях комнаты. */
export function lookDir(yaw: number, pitch: number): { x: number; y: number; z: number } {
  const c = Math.cos(pitch);
  return { x: Math.sin(yaw) * c, y: Math.sin(pitch), z: Math.cos(yaw) * c };
}

/** Повернуть голову в пределах точки: пределы — от взгляда точки. */
export function clampLook(p: Poi, yaw: number, pitch: number): { yaw: number; pitch: number } {
  let y = yaw;
  if (p.yaw) {
    const d = wrap(yaw - p.pose.yaw);
    y = p.pose.yaw + Math.min(p.yaw[1], Math.max(p.yaw[0], d));
  }
  return { yaw: y, pitch: Math.min(p.pitch[1], Math.max(p.pitch[0], pitch)) };
}

/** Угол в (−π, π]. */
export const wrap = (a: number): number => {
  let x = a % (2 * Math.PI);
  if (x <= -Math.PI) x += 2 * Math.PI;
  if (x > Math.PI) x -= 2 * Math.PI;
  return x;
};

/** Есть ли точка внутри коробки (с запасом). */
export const inBox = (b: Box, x: number, y: number, z: number, pad = 0): boolean =>
  x >= b.x0 - pad && x <= b.x1 + pad && y >= b.y0 - pad && y <= b.y1 + pad && z >= b.z0 - pad && z <= b.z1 + pad;

/** Переход между точками, с: от расстояния — не мгновенно и не тягуче. */
export const moveSeconds = (a: Pose, b: Pose): number => Math.min(1.6, 0.55 + Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) * 0.16);

export { DEG };
