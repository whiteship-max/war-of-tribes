// Покои правителя (docs/city_v3.md, Г-4, Г-5): план комнаты на верхнем ярусе донжона — размеры, мебель, места действий,
// предметы стола и безделушки. Чистый модуль без three: его читают сборка модели, ходьба (`walk.ts`), действия (`acts.ts`)
// и тесты.
//
// Оси комнаты — оси мира (донжон стоит по ним, `layout.ts`, `keep`): +z — юг, к городу и камере игры, +x — восток, y —
// вверх от пола. Начало — середина пола. Мир = (x донжона + x, пол + y, z донжона + z).
//
// Что где стоит (вид сверху, юг внизу):
//
//     север:  кровать под пологом · камин с колпаком · дверь к лестнице
//     запад:  гобелен, окно на реку, полки с книгами   восток: оружие, корона на полочке, сундук короля, окно на мыс, свитки
//     середина: люстра-обруч, шахматы у огня
//     юг:     стол с документами, за ним кресло лицом к большому окну — на город; знамёна по сторонам окна

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

/**
 * Место действия: сесть за стол, лечь, к окну, к огню, к оружию; к окнам на мыс и на реку (Г-9). `hall` — стоя посреди
 * покоев (вход и снимки стенда).
 */
export type SpotId = 'desk' | 'window' | 'windowE' | 'windowW' | 'hearth' | 'bed' | 'arms' | 'door' | ChestId;
/** Сундуки, которые открывают (Г-9): короля под стеной оружия — с доспехом, у южной стены — с платьем. */
export type ChestId = 'chest' | 'chestS';
export const isChestSpot = (id: PoiId | null | undefined): id is ChestId => id === 'chest' || id === 'chestS';
/** Окна, к которым подходят и смотрят вдаль: большое на город и парные на мыс и на реку. */
export const WINDOW_SPOTS = ['window', 'windowE', 'windowW'] as const;
export type WindowSpot = (typeof WINDOW_SPOTS)[number];
export const isWindowSpot = (id: PoiId | null | undefined): id is WindowSpot => id === 'window' || id === 'windowE' || id === 'windowW';
export type PoiId = 'hall' | SpotId;

/** Где тело стоит перед действием: место на полу и куда лицом. */
export interface Stand {
  x: number;
  z: number;
  yaw: number;
}

/**
 * Место действия (Г-5): касание мебели — правитель сам подходит к `approach` и делает дело (`acts.ts`: сесть, лечь,
 * наклониться к окну, греть руки, взять меч). `pose` — глаз в деле; голова поворачивается в своих пределах.
 */
export interface Poi {
  id: PoiId;
  /** Имя — одно слово; `verb` — что делает игрок (подпись касания издали). */
  name: string;
  verb: string;
  pose: Pose;
  /** Откуда начинается дело — стоя, лицом к мебели. У `hall` — нет: это просто место на полу. */
  approach: Stand | null;
  /** Повороты головы от взгляда точки: влево-вправо и вниз-вверх, радианы. `null` — кругом. */
  yaw: readonly [number, number] | null;
  pitch: readonly [number, number];
  /** Приближение взглядом вдаль — пределы поля зрения, градусы (только у окна). */
  zoom?: readonly [number, number];
  /** Что в комнате зовёт это дело касанием. */
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
  // Южное — большое (Г-5): подоконник ниже и арка выше прежних (0,95 и 2,65) — из покоев видно город, а не одно небо, и
  // солнце ложится на пол и на стол.
  { wall: 'south', at: 0, inW: 2.6, inSill: 0, inSpring: 3.15, midW: 2.15, plate: 0.95, outW: 1.8, sill: 0.8, spring: 2.85, twin: false, seats: true },
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

/** Парное окно стены: на мыс — восточное, на реку — западное. */
export const sideOpening = (id: 'windowE' | 'windowW'): Opening => OPENINGS.find((o) => o.wall === (id === 'windowE' ? 'east' : 'west'))!;

/**
 * Проём парного окна, в который глядят (Г-9): правитель наклоняется к южному из двух — столбик между ними не встаёт
 * посреди взгляда, а «Вдаль» смотрит в проём, а не в камень. Вдоль стены (`U`) от середины окна.
 */
export const sideLight = (o: Opening): number => {
  const h = (o.outW - 0.16) / 4;
  const off = h + 0.08;
  // Южный проём: у восточной стены ось `U` смотрит на север (−z), у западной — на юг (+z).
  return alongOf(o) + (o.wall === 'east' ? -off : off);
};

/** Камин у северной стены: устье, колпак, очаг. Огонь светит отсюда. */
export const HEARTH = { x: 0, mouthW: 1.9, mouthH: 1.25, depth: 0.62, hoodW: 3.0, hoodFront: -4.35, hoodLow: 1.55, hoodTop: 3.9, fire: { x: 0, y: 0.42, z: -5.42 } };

/** Дверь к лестнице в северо-восточном углу. */
export const DOOR = { x: 3.85, w: 1.15, h: 2.35 };

/** Стол: трапезный стол на козлах, лицом к окну; кресло за ним. */
export const DESK = { x: 0, z: 3.05, w: 2.3, d: 1.0, top: 0.78 };
export const CHAIR = { x: 0, z: 2.22 };
/** Подлокотники кресла: от середины в стороны, верх и докуда вперёд (концы — навершия под краем стола, Г-6). */
export const ARMREST = { x: 0.24, y: 0.7, end: 2.52 };

/** Кровать под пологом в северо-западном углу, изголовьем к северу. */
export const BED = { x0: -5.0, x1: -3.15, z0: -5.05, z1: -2.85, top: 0.62, canopy: 2.55 };

/**
 * Стена оружия на востоке (Г-9): щит с гербом и копья накрест — выше, под ними меч на колышках, под мечом — полочка с
 * короной на бархатной подушке (кованые кронштейны), под полочкой — сундук короля с доспехом. `y` — середина щита.
 */
export const ARMS = { z: -2.35, y: 2.38 };
/** Колышки меча: высота клинка на стене, м. */
export const SWORD_Y = 1.68;
/** Полочка короны: доска от стены вглубь (`d`), шириной вдоль стены (`w`), верх и толщина; подушка на ней. */
export const CROWN_SHELF = { z: ARMS.z, d: 0.3, w: 0.68, top: 1.22, t: 0.045 };
export const CUSHION = { x: HALF - 0.15, z: ARMS.z, w: 0.25, d: 0.3, h: 0.075 };

/** Столик с шахматами у огня. */
export const CHESS = { x: 2.15, z: -2.75, top: 0.68, board: 0.5 };

/**
 * Сундуки (Г-9: у кровати — убран): короля — под полочкой короны, у южной стены — под знаменем. Оба открываются: крышка
 * на петлях у стены (`hinge` — сторона петель), `h` — верх короба, крышка — `LID_T` над ним.
 */
export const CHESTS = [
  { id: 'chestKing', spot: 'chest', x0: 4.64, z0: ARMS.z - 0.55, x1: 5.14, z1: ARMS.z + 0.55, h: 0.42, hinge: 'x1' },
  { id: 'chestSouth', spot: 'chestS', x0: -4.5, z0: 4.6, x1: -3.45, z1: 5.14, h: 0.44, hinge: 'z1' },
] as const;
export type Chest = (typeof CHESTS)[number];
/** Толщина крышки сундука, м; на сколько открывается (радианы от закрытой): крышка встаёт, не доходя до кронштейнов. */
export const LID_T = 0.08;
export const LID_OPEN = 1.22;
export const chestOf = (id: ChestId): Chest => CHESTS.find((c) => c.spot === id)!;

/** Полки у стен по сторонам южного угла: книги на западе, свитки в гнёздах на востоке. */
export const SHELVES = [
  { id: 'books', x0: -HALF, z0: 3.62, x1: -HALF + 0.38, z1: 4.98, h: 2.3 },
  { id: 'scrolls', x0: HALF - 0.36, z0: 3.62, x1: HALF, z1: 4.98, h: 2.15 },
] as const;

/** Мягкий пол: ковёр посреди покоев, медвежья шкура у огня, овчина у кровати (`build.floorCloths`) — шаг по ним тише. */
export const SOFT_FLOOR = [
  { x0: -1.6, z0: -1.4, x1: 1.6, z1: 1.05 },
  { x0: -1.35, z0: -4.35, x1: 1.35, z1: -2.55 },
  { x0: -3.05, z0: -4.45, x1: -2.15, z1: -3.35 },
] as const;
export const softFloor = (x: number, z: number): boolean => SOFT_FLOOR.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);

/** Подсвечники на полу: у стола и у кровати (основание — круг). */
export const STANDS = [
  { id: 'standW', x: -1.6, z: 3.45, r: 0.18 },
  { id: 'standE', x: 1.6, z: 3.45, r: 0.18 },
  { id: 'standBed', x: -2.75, z: -4.75, r: 0.14 },
] as const;

/**
 * Чучело для отработки меча (Г-11) у восточной стены, между полочкой короны и окном на мыс: столб на крестовине (`base` —
 * её полуразмах), соломенное тело (`r`, от `y0` до `y1`), голова, руки-перекладина, верх столба `top`.
 */
export const DUMMY = { x: 4.42, z: 0.35, base: 0.32, r: 0.21, y0: 0.74, y1: 1.6, head: { y: 1.73, r: 0.13 }, arms: { y: 1.38, half: 0.46, t: 0.06 }, post: 0.035, top: 1.88 } as const;

/** Знамёна с гербом державы на южной стене по сторонам большого окна: середина вдоль стены, верх и низ. */
export const BANNERS = [
  { x: -3.15, top: 4.25, bottom: 1.55, w: 0.86 },
  { x: 3.15, top: 4.25, bottom: 1.55, w: 0.86 },
] as const;

export const POIS: readonly Poi[] = [
  {
    id: 'hall',
    name: 'Покои',
    verb: 'Встать посреди покоев',
    // Вход в покои: из глубины к югу и западу — стол, большое окно и знамя.
    pose: { x: 1.55, y: 1.62, z: -1.9, yaw: -0.24, pitch: -0.16, fov: 70 },
    approach: null,
    yaw: null,
    pitch: [-1.2, 1.1],
    hits: [],
  },
  {
    id: 'desk',
    name: 'Кресло',
    verb: 'Сесть за стол',
    // Сидя, подавшись к столу (Г-6): глаз над передом сиденья — внизу кадра край стола и руки, а не колени и подушка.
    pose: { x: 0, y: 1.23, z: 2.18, yaw: 0, pitch: -0.37, fov: 62 },
    // Подходят сбоку: кресло придвинуто к столу — правитель встаёт у восточного подлокотника и садится вбок.
    approach: { x: 0.76, z: 2.12, yaw: 0 },
    yaw: [-1.35, 1.35],
    pitch: [-1.2, 0.45],
    // Кресло — до верха спинки с подписью над ней (Г-9: касание подписи «Кресло» шло поверх коробки).
    hits: [box(-0.45, 0, 1.85, 0.45, 1.66, 2.52), box(-1.2, 0, 2.53, 1.2, 0.8, 3.6)],
  },
  {
    id: 'window',
    name: 'Окно',
    verb: 'Подойти к окну',
    // Наклонившись к окну, руки на подоконнике.
    pose: { x: 0, y: 1.44, z: 5.62, yaw: 0, pitch: -0.42, fov: 62 },
    approach: { x: 0, z: 4.72, yaw: 0 },
    yaw: [-0.95, 0.95],
    pitch: [-0.95, 0.45],
    zoom: [16, 62],
    hits: [box(-1.35, 0.4, 5.1, 1.35, 3.9, 6.5)],
  },
  ...(['windowE', 'windowW'] as const).map((id): Poi => {
    const o = sideOpening(id);
    const s = o.wall === 'east' ? 1 : -1;
    const [, , z] = wallPoint(o.wall, sideLight(o), 0, 0);
    return {
      id,
      name: id === 'windowE' ? 'Окно на мыс' : 'Окно на реку',
      verb: id === 'windowE' ? 'Подойти к окну на мыс' : 'Подойти к окну на реку',
      // Наклонившись в нишу парного окна, ладони на подоконнике проёма: глаз — над низом ниши, у южного проёма (Г-9).
      pose: { x: s * (HALF + 0.36), y: 1.47, z, yaw: (s * Math.PI) / 2, pitch: -0.3, fov: 62 },
      approach: { x: s * (HALF - 0.48), z, yaw: (s * Math.PI) / 2 },
      yaw: [-0.75, 0.75],
      pitch: [-0.9, 0.45],
      zoom: [16, 62],
      hits: [box(s < 0 ? -HALF - 1.0 : HALF - 0.05, o.inSill, o.at - o.inW / 2, s < 0 ? -HALF + 0.05 : HALF + 1.0, o.inSpring + o.inW / 2, o.at + o.inW / 2)],
    };
  }),
  {
    id: 'hearth',
    name: 'Камин',
    verb: 'Погреть руки у огня',
    pose: { x: 0, y: 1.5, z: -3.72, yaw: Math.PI, pitch: -0.42, fov: 64 },
    approach: { x: 0, z: -3.45, yaw: Math.PI },
    yaw: [-1.6, 1.6],
    pitch: [-1.0, 0.6],
    hits: [box(-1.6, 0, -5.2, 1.6, 3.9, -4.2)],
  },
  {
    id: 'bed',
    name: 'Кровать',
    verb: 'Лечь в кровать',
    // Лёжа, голова на подушке: взгляд — в открытый бок кровати, между столбами полога, на покои (шахматы, оружие, дверь).
    pose: { x: -4.12, y: 1.0, z: -4.55, yaw: 1.12, pitch: 0.06, fov: 70 },
    approach: { x: -2.62, z: -3.9, yaw: -Math.PI / 2 },
    yaw: [-1.35, 1.35],
    pitch: [-0.4, 1.35],
    hits: [box(BED.x0, 0, BED.z0, BED.x1, BED.canopy, BED.z1)],
  },
  {
    id: 'arms',
    name: 'Оружие',
    verb: 'Взять меч',
    // Меч — в руке: взял со стены и отступил на шаг, лицом к стене оружия (Г-6).
    pose: { x: 3.45, y: 1.62, z: -1.95, yaw: Math.PI / 2, pitch: 0.02, fov: 64 },
    approach: { x: 4.02, z: -1.95, yaw: Math.PI / 2 },
    yaw: null,
    pitch: [-1.2, 1.1],
    // Стена над полочкой короны (щит, копья, меч) и секира у края; полочка и сундук — свои (Г-9).
    hits: [box(4.6, CROWN_SHELF.top + 0.16, -3.9, 5.2, 3.9, -0.8), box(4.6, 0.9, -1.25, 5.2, CROWN_SHELF.top + 0.16, -0.8)],
  },
  ...(['chest', 'chestS'] as const).map((id): Poi => {
    const c = chestOf(id);
    const king = id === 'chest';
    const cx = (c.x0 + c.x1) / 2;
    const cz = (c.z0 + c.z1) / 2;
    // Лицом к сундуку, с середины его передней стенки: у сундука короля — с запада, у южного — с севера.
    const yaw = king ? Math.PI / 2 : 0;
    const at = king ? { x: c.x0 - 0.34, z: cz } : { x: cx, z: c.z0 - 0.38 };
    const lean = king ? { x: c.x0 - 0.2, z: cz } : { x: cx, z: c.z0 - 0.22 };
    return {
      id,
      name: king ? 'Сундук короля' : 'Сундук',
      verb: king ? 'Открыть сундук короля' : 'Открыть сундук',
      // Открыл крышку и склонился над сундуком: внизу кадра — то, что в нём сложено, за ним — откинутая крышка.
      pose: { x: lean.x, y: 1.44, z: lean.z, yaw, pitch: -0.98, fov: 66 },
      approach: { x: at.x, z: at.z, yaw },
      yaw: [-1.1, 1.1],
      pitch: [-1.3, 0.7],
      hits: [box(c.x0 - 0.02, 0, c.z0 - 0.02, c.x1 + 0.02, c.h + LID_T + 0.04, c.z1 + 0.02)],
    };
  }),
  {
    id: 'door',
    name: 'Дверь',
    verb: 'Постучать — позвать слугу',
    // Постучал и отступил на шаг (Г-7): створка открывается внутрь, к восточной стене, — слуга входит.
    pose: { x: DOOR.x - 0.1, y: 1.62, z: -3.62, yaw: Math.PI, pitch: -0.06, fov: 64 },
    approach: { x: DOOR.x - 0.1, z: -3.78, yaw: Math.PI },
    yaw: [-1.5, 1.5],
    pitch: [-1.0, 0.8],
    hits: [box(DOOR.x - DOOR.w / 2 - 0.05, 0, -HALF - 0.4, DOOR.x + DOOR.w / 2 + 0.05, DOOR.h, -HALF + 0.05)],
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
  /**
   * Откуда предмет трогают: предметы стола — сидя за столом (`desk`), безделушки — рукой с места `stand` (дотянуться —
   * `walk.REACH`); издали касание ведёт туда.
   */
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
  /** Где встать, чтобы взять стоя (`null` — только сидя за столом или с места дела). */
  stand: Stand | null;
  /**
   * Как держать (Г-6): `fist` — кулаком вокруг рукояти или ножки (ось `axis` в осях предмета — к указательному пальцу,
   * толщина `gripR`); `palm` — на раскрытой ладони (предмет стоит на ней низом, `axis` — его верх).
   */
  hold: 'fist' | 'palm';
  /** Где рука держит предмет — в его осях (`build.trinket`), м: ножка кубка, рукоять меча, низ короны. */
  grip: readonly [number, number, number];
  axis: readonly [number, number, number];
  gripR: number;
  /**
   * Как предмет встаёт перед глазом: `tilt` — верх к глазу (радианы); у меча — клинок наискось вверх и от глаза
   * (`room.holdBase`). Палец взгляда медленно крутит предмет вокруг `axis` и наклоняет в пределах `tilts`.
   */
  tilt: number;
  tilts: readonly [number, number];
  /** Ближе всего к глазу, м: рука не подносит предмет к самому носу, — и дальше всего (длина руки). */
  near: number;
  far: number;
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
  // Печать лежит на боку, кошель осел мешком: ниже линии взгляда сидя на дальний ряд (тест «касание из кресла»).
  { id: 'seal', name: 'Печать', hint: 'Герб державы на печати — свой герб', door: 'arms', poi: 'desk', code: 8, box: box(0.26, top, 2.95, 0.4, top + 0.05, 3.06) },
  { id: 'purse', name: 'Кошель', hint: 'Алмазы и лавка — Сокровищница', door: 'treasury', poi: 'desk', code: 7, box: box(-0.4, top, 2.93, -0.25, top + 0.075, 3.08) },
  { id: 'decrees', name: 'Свиток указов', hint: 'Указы, паёк и налог — Держава', door: 'decrees', poi: 'desk', code: 5, box: box(-0.34, top, 2.58, -0.06, top + 0.08, 2.84) },
];

/** Безделушки: взять в руки и покрутить. Механики у них нет — только вид. */
export const TRINKETS: readonly Trinket[] = [
  { id: 'goblet', name: 'Кубок', hint: 'Серебро с позолотой, вино с юга', poi: 'desk', code: 9, size: 0.2, stand: { x: 0.76, z: 2.02, yaw: 0 }, hold: 'fist', grip: [0, 0.06, 0], axis: [0, 1, 0], gripR: 0.012, tilt: 0.42, tilts: [-0.35, 0.45], near: 0.36, far: 0.5, box: box(0.5, top, 2.62, 0.66, top + 0.21, 2.78) },
  { id: 'candle', name: 'Свеча', hint: 'Воск, а не сало, — свеча правителя', poi: 'desk', code: 10, size: 0.3, stand: { x: -0.76, z: 2.02, yaw: 0 }, hold: 'fist', grip: [0, 0.06, 0], axis: [0, 1, 0], gripR: 0.013, tilt: 0.12, tilts: [-0.25, 0.35], near: 0.4, far: 0.55, box: box(-0.66, top, 2.62, -0.5, top + 0.36, 2.78) },
  // Белый король — на своей клетке доски (e1, `build.chessTable`): доска 0.5 м, клетка 1/16 м.
  { id: 'chess', name: 'Шахматная фигура', hint: 'Король из моржовой кости', poi: 'hall', code: 11, size: 0.12, stand: { x: 2.2, z: -2.02, yaw: Math.PI }, hold: 'palm', grip: [0, 0, 0], axis: [0, 1, 0], gripR: 0.02, tilt: 0.3, tilts: [-0.3, 0.5], near: 0.32, far: 0.45, box: box(CHESS.x + 0.001, CHESS.top + 0.012, CHESS.z + 0.189, CHESS.x + 0.061, CHESS.top + 0.14, CHESS.z + 0.249) },
  // Меч: 0,86 м целиком (клинок 0,66), рукоять под кулак.
  { id: 'sword', name: 'Меч', hint: 'Клинок отца, перекрестье в позолоте', poi: 'arms', code: 12, size: 0.86, stand: null, hold: 'fist', grip: [0, 0, 0.035], axis: [0, 0, 1], gripR: 0.016, tilt: 0, tilts: [-0.22, 0.22], near: 0.42, far: 0.62, box: box(5.0, SWORD_Y - 0.03, -2.8, 5.2, SWORD_Y + 0.18, -1.86) },
  // Корона — на подушке полочки под мечом (Г-9); взять — подойти к сундуку короля и протянуть руку.
  { id: 'crown', name: 'Корона', hint: 'Венец державы, на бархатной подушке', poi: 'hall', code: 13, size: 0.24, stand: { x: 4.36, z: ARMS.z, yaw: Math.PI / 2 }, hold: 'palm', grip: [0, 0, 0], axis: [0, 1, 0], gripR: 0.03, tilt: 0.5, tilts: [-0.2, 0.55], near: 0.38, far: 0.55, box: box(CUSHION.x - 0.12, CROWN_SHELF.top + CUSHION.h, ARMS.z - 0.12, CUSHION.x + 0.12, CROWN_SHELF.top + CUSHION.h + 0.15, ARMS.z + 0.12) },
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


export { DEG };

/**
 * Подпись вещи покоев (Г-6, слово владельца): видна, только когда правитель подошёл (`near`, м до ближней точки
 * коробки) и смотрит на неё (точка `at` у середины кадра); сидя за столом — подписи предметов стола (`desk`). Не видна
 * сквозь мебель (`OCCLUDERS`): своя коробка `box` подпись не заслоняет.
 */
export interface Label {
  id: string;
  name: string;
  box: Box;
  at: readonly [number, number, number];
  near: number;
  desk: boolean;
  /**
   * Подпись сундука (Г-9): `closed` — видна, пока он закрыт («Сундук короля»), `open` — когда открыт («Доспех короля»: то,
   * что в нём). Своего сундука она не заслоняется.
   */
  chest?: { id: ChestId; when: 'open' | 'closed' };
}

/** Мелочь (предмет стола, безделушка) — её подпись раскладывается раньше подписи мебели под ней. */
export const isSmall = (l: Label): boolean => l.near === NEAR_SMALL;

/** Подходить к мелочи — на шаг, к мебели — на два, к окну — к нише. */
export const NEAR_SMALL = 1.4;
export const NEAR_BIG = 2.1;
export const NEAR_WINDOW = 2.3;

const topOf = (b: Box): [number, number, number] => [(b.x0 + b.x1) / 2, b.y1, (b.z0 + b.z1) / 2];
const deskBox = box(-DESK.w / 2, 0, DESK.z - DESK.d / 2, DESK.w / 2, DESK.top, DESK.z + DESK.d / 2);
const chairBox = box(CHAIR.x - 0.3, 0, CHAIR.z - 0.27, CHAIR.x + 0.3, 1.52, CHAIR.z + 0.27);
const bedBox = box(BED.x0, 0, BED.z0, BED.x1, BED.top + 0.12, BED.z1);
const hearthBox = box(HEARTH.x - HEARTH.hoodW / 2, 0, -HALF, HEARTH.x + HEARTH.hoodW / 2, HEARTH.hoodTop, HEARTH.hoodFront);
const armsBox = box(HALF - 0.3, CROWN_SHELF.top + 0.16, ARMS.z - 1.1, HALF, 3.55, ARMS.z + 1.1);
const sideWindow = (o: Opening): Box => {
  const s = o.wall === 'west' ? -1 : 1;
  return box(s < 0 ? -HALF - 1.0 : HALF, o.inSill, o.at - o.inW / 2, s < 0 ? -HALF : HALF + 1.0, o.inSpring + o.inW / 2, o.at + o.inW / 2);
};
const south = OPENINGS[0];

export const LABELS: readonly Label[] = [
  ...THINGS.map((t) => ({ id: t.id, name: t.name, box: t.box, at: topOf(t.box), near: NEAR_SMALL, desk: t.poi === 'desk' })),
  { id: 'deskTop', name: 'Стол', box: deskBox, at: [0.62, DESK.top + 0.02, DESK.z + 0.32], near: NEAR_BIG, desk: false },
  { id: 'chair', name: 'Кресло', box: chairBox, at: [CHAIR.x, 1.56, CHAIR.z - 0.22], near: NEAR_BIG, desk: false },
  { id: 'bed', name: 'Кровать', box: bedBox, at: [(BED.x0 + BED.x1) / 2, BED.top + 0.16, (BED.z0 + BED.z1) / 2 + 0.3], near: NEAR_BIG, desk: false },
  { id: 'hearth', name: 'Камин', box: hearthBox, at: [HEARTH.x, HEARTH.hoodLow + 0.1, HEARTH.hoodFront - 0.05], near: NEAR_BIG, desk: false },
  { id: 'armsWall', name: 'Щит и копья', box: armsBox, at: [HALF - 0.05, ARMS.y + 0.55, ARMS.z], near: NEAR_BIG, desk: false },
  { id: 'door', name: 'Дверь', box: box(DOOR.x - DOOR.w / 2, 0, -HALF - 0.35, DOOR.x + DOOR.w / 2, DOOR.h, -HALF), at: [DOOR.x, 1.95, -HALF - 0.02], near: NEAR_BIG, desk: false },
  { id: 'windowS', name: 'Окно на город', box: box(-south.inW / 2, 0, HALF, south.inW / 2, south.inSpring + 1, HALF + WALL_T), at: [0, 2.05, HALF + 0.2], near: NEAR_WINDOW, desk: false },
  ...OPENINGS.filter((o) => o.wall !== 'south').map((o) => ({
    id: o.wall === 'west' ? 'windowW' : 'windowE',
    name: o.wall === 'west' ? 'Окно на реку' : 'Окно на мыс',
    box: sideWindow(o),
    at: [(o.wall === 'west' ? -1 : 1) * (HALF + 0.15), (o.sill + o.spring) / 2, o.at] as const,
    near: NEAR_WINDOW,
    desk: false,
  })),
  // Подпись сундука — у переднего края крышки (к середине покоев); открытого — над тем, что в нём лежит (Г-9).
  ...CHESTS.flatMap((c): Label[] => {
    const cx = (c.x0 + c.x1) / 2;
    const cz = (c.z0 + c.z1) / 2;
    const side = c.hinge === 'x1';
    const at = side ? ([c.x0, c.h + LID_T + 0.02, cz] as const) : ([cx, c.h + LID_T + 0.02, c.z0] as const);
    const king = c.spot === 'chest';
    const inner = box(c.x0 + 0.05, 0.06, c.z0 + 0.05, c.x1 - 0.05, c.h - 0.02, c.z1 - 0.05);
    return [
      { id: c.id, name: king ? 'Сундук короля' : 'Сундук', box: box(c.x0, 0, c.z0, c.x1, c.h + LID_T, c.z1), at, near: NEAR_BIG, desk: false, chest: { id: c.spot, when: 'closed' } },
      { id: king ? 'armour' : 'clothes', name: king ? 'Доспех короля' : 'Платье и меха', box: inner, at: [cx, c.h * 0.7, cz], near: NEAR_BIG, desk: false, chest: { id: c.spot, when: 'open' } },
    ];
  }),
];

/**
 * Что заслоняет подпись: мебель телом (столешница, кресло, кровать с пологом, камин, сундуки, полки, шахматный столик).
 * Стены не нужны: комната выпуклая, а точки подписей окон — на внутренней грани стены.
 */
export const OCCLUDERS: readonly { id: string; box: Box }[] = [
  { id: 'deskTop', box: box(-DESK.w / 2, DESK.top - 0.07, DESK.z - DESK.d / 2, DESK.w / 2, DESK.top, DESK.z + DESK.d / 2) },
  { id: 'chair', box: box(CHAIR.x - 0.3, 0.55, CHAIR.z - 0.27, CHAIR.x + 0.3, 1.47, CHAIR.z - 0.18) },
  { id: 'chair', box: box(CHAIR.x - 0.3, 0, CHAIR.z - 0.27, CHAIR.x + 0.3, 0.55, CHAIR.z + 0.25) },
  { id: 'bed', box: bedBox },
  { id: 'bed', box: box(BED.x0, BED.canopy - 0.35, BED.z0, BED.x1, BED.canopy + 0.15, BED.z1) },
  { id: 'hearth', box: box(HEARTH.x - HEARTH.hoodW / 2, HEARTH.hoodLow, -HALF, HEARTH.x + HEARTH.hoodW / 2, HEARTH.hoodTop, HEARTH.hoodFront) },
  ...CHESTS.map((c) => ({ id: c.id, box: box(c.x0, 0, c.z0, c.x1, c.h, c.z1) })),
  ...SHELVES.map((c) => ({ id: c.id, box: box(c.x0, 0, c.z0, c.x1, c.h, c.z1) })),
  { id: 'chessTable', box: box(CHESS.x - 0.3, 0, CHESS.z - 0.3, CHESS.x + 0.3, CHESS.top, CHESS.z + 0.3) },
];
