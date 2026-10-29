// Места появления новых игроков для теста с игроками (docs/test_world.md): двадцать пять клеток на Сицилии, за ними —
// цепочка на материке, от Калабрии вдоль западного берега Италии до Флоренции.
//
// Режим включает сервер настройкой `TRIBE_SPAWN=sicily` (`netlify/lib/http.spawnMode`); без неё расселение обычное
// (`settle.placeCastle`). Место выдаёт реестр замков (`netlify/lib/roster.upsert`) — первое свободное из `SPAWNS` (остров,
// потом материк), а когда свободных нет, — по обычным правилам, но в регионе острова (`SICILY_THEATRE`), чтобы новичок
// мог воевать с теми, кто уже стоит.
//
// Места — данные, а не расчёт на запросе: `SICILY` и `MAINLAND` запечены и сверяются тестом с выводом `deriveSicily()` и
// `deriveMainland()` (`spawn.test.ts`), как регионы с `theatre/derive.ts`. Поправил вывод — пересобери список, иначе
// красный тест, а не другие места.
//
// Модуль читают и сервер, и игра, поэтому правило `land.ts` и `settle.ts` действует и здесь: ни одного `@/`-импорта, ни
// DOM — только земля, проекция атласа и регионы.
import { cellOf } from './atlas/project';
import { isDesertAt, isWaterAt, landShare, settleable, type Spot } from './land';
import { HOME_LAND_SHARE, WORLD_ORIGIN } from './data/tuning';
import { theatreAt } from './theatre/theatre';

/** Режимы появления. Один — Сицилия; нет режима — обычное расселение. */
export type SpawnMode = 'sicily';

/** Режим по значению настройки сервера. Всё, кроме `sicily`, — обычное расселение. */
export const spawnModeOf = (raw: string | undefined): SpawnMode | null => ((raw ?? '').trim().toLowerCase() === 'sicily' ? 'sicily' : null);

/** Сколько мест на острове (слово владельца: тест до 25 человек, ветка `game/prelaunch`; было 12). */
export const SICILY_COUNT = 25;

/** Сердце острова — Энна: от него остров размечается разливом по суше. */
export const SICILY_HEART = { lon: 14.28, lat: 37.57 } as const;

/** Регион острова — весь остров лежит в нём (`spawn.test.ts`). */
export const SICILY_THEATRE = 'italy';

/**
 * Шаг между местами, клеток (4 × 6,1 км ≈ 24 км): места стоят узлами шестиугольной решётки, соседи в ряду — через
 * шаг, через ряд — по диагонали √13 ≈ 3,6 клетки (ряды на целых клетках идут через 3, а не через 4·√3/2 = 3,5).
 *
 * Шаг выведен, а не выбран: **наибольший, при котором двадцать пять встают одной кучкой на годную сушу острова.** При
 * шаге 5 кучка не помещается нигде (тест): поперёк остров для неё узок. Реже — значит
 * разносить места по всему острову и терять «из любого города видно всех»; плотнее — отнимать у города место вокруг
 * без нужды. (С двенадцатью местами шаг был 6 — порог дома `LAIR_HOME_GAP`; двадцать пять при нём не встают.)
 *
 * Обычная ближняя граница расселения — `SETTLE_GAP` (24); кто ставится по обычным правилам, держит её.
 */
export const SICILY_STEP = 4;

/**
 * Кольцо живого обзора у города на месте острова, клеток (≈ 116 км), — вместо обычного `HOME_SIGHT` (17). Поперечник
 * двадцати пяти мест, округлённый вверх: из любого из них видно остальные двадцать четыре вживую, имя, мощь и население.
 * Меньше нельзя — пара крайних мест друг друга не увидит; больше незачем (тест держит оба края). Только у города на
 * месте острова (`world/lookout.homeSight`), то есть только при `TRIBE_SPAWN=sicily`: обычная игра его не видит.
 */
export const SICILY_SIGHT = 19;

/**
 * Круг доли суши у места, клеток. Обычная мерка расселения — круг `HOME_LAND_RADIUS` (10 клеток, 61 км): на острове
 * шириной 30 клеток её проходит только середина (379 клеток из 664), и кучке мест почти не из чего было бы выбирать
 * часть острова. Узкий круг отсекает то же, ради чего есть широкий, — кончик мыса, — и пускает остальное побережье.
 * Доля та же — `HOME_LAND_SHARE`.
 */
export const SICILY_LAND_RADIUS = 4;

/**
 * Двадцать пять мест на Сицилии, **от середины кучки к краю**: соседи — в шаге решётки (4 клетки) или по диагонали ряда
 * (3,6). Порядок — порядок выдачи: первый вошедший получает первое свободное, и первые пришедшие стоят ближе всех друг
 * к другу. Запечено из `deriveSicily()`; тест сверяет.
 */
export const SICILY: readonly Spot[] = [
  { x: 765, y: 1340 },
  { x: 768, y: 1338 },
  { x: 768, y: 1342 },
  { x: 771, y: 1340 },
  { x: 765, y: 1336 },
  { x: 765, y: 1344 },
  { x: 762, y: 1338 },
  { x: 762, y: 1342 },
  { x: 771, y: 1336 },
  { x: 771, y: 1344 },
  { x: 768, y: 1334 },
  { x: 768, y: 1346 },
  { x: 774, y: 1338 },
  { x: 774, y: 1342 },
  { x: 762, y: 1334 },
  { x: 762, y: 1346 },
  { x: 759, y: 1340 },
  { x: 765, y: 1332 },
  { x: 765, y: 1348 },
  { x: 759, y: 1336 },
  { x: 759, y: 1344 },
  { x: 771, y: 1332 },
  { x: 771, y: 1348 },
  { x: 774, y: 1334 },
  { x: 774, y: 1346 },
];

/** Номер места (1..25), на котором стоит клетка, или 0 — не место острова. */
export const sicilySlot = (at: Spot): number => SICILY.findIndex((s) => s.x === at.x && s.y === at.y) + 1;

/** Годится ли клетка острова под место: та же пригодность, что у любого двора, и не кончик мыса. */
export const sicilyFit = (at: Spot): boolean =>
  settleable(at.x, at.y) && !isDesertAt(at.x, at.y) && landShare(at.x, at.y, SICILY_LAND_RADIUS) >= HOME_LAND_SHARE;

/** Клетка мира под точкой долготы и широты. */
const cellAt = (lon: number, lat: number): Spot => {
  const c = cellOf(lon, lat);
  return { x: Math.floor(c.col) + WORLD_ORIGIN.x, y: Math.floor(c.row) + WORLD_ORIGIN.y };
};

/**
 * Суша острова: разлив от сердца по четырём соседям. По диагонали остров касается Калабрии у Мессинского пролива
 * (клетки 783|1326 и 784|1327), и разлив по восьми соседям ушёл бы на материк; по четырём — нет (тест: все клетки
 * острова западнее пролива). Порядок — по строкам, слева направо.
 */
export function sicilyLand(): Spot[] {
  const start = cellAt(SICILY_HEART.lon, SICILY_HEART.lat);
  const seen = new Set<string>();
  const out: Spot[] = [];
  const stack: Spot[] = [start];
  while (stack.length > 0) {
    const p = stack.pop() as Spot;
    const key = `${p.x}|${p.y}`;
    if (seen.has(key) || isWaterAt(p.x, p.y)) continue;
    seen.add(key);
    out.push(p);
    // Потолок — страховка от ошибки разметки: Сицилия — сотни клеток, материк — сотни тысяч.
    if (out.length > 5000) throw new Error('Сицилия: разлив ушёл на материк.');
    stack.push({ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 });
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Сколько суши в круге радиусом `r` вокруг клетки — целым числом клеток, чтобы сравнения были точными. */
function landAround(at: Spot, r: number): number {
  let n = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r && !isWaterAt(at.x + dx, at.y + dy)) n++;
    }
  }
  return n;
}

/**
 * Кучки из `SICILY_COUNT` узлов шестиугольной решётки с шагом `step` — в клетках решётки; на остров их сдвигает `sicilyAt`.
 *
 * Решётка на целых клетках: узлы в ряду — через шаг, ряды — через целую клетку, ближнюю к `step·√3/2`, каждый ряд
 * сдвинут на полшага (вниз до целой). Кучка — узлы, ближние к середине одного треугольника решётки (с двенадцатью — три
 * в первом кругу, три во втором и шесть в третьем). Она почти круглая, поэтому кольцо обзора,
 * в котором видно всех, выходит самым малым. Видов четыре: ряды вдоль острова или поперёк и треугольник вершиной вверх
 * или вниз.
 *
 * Расстояния — в целых: середина треугольника считается утроенной, ничьих на границе кучки нет (иначе ошибка, а
 * не тихий выбор).
 */
export function sicilyPatches(step: number): Spot[][] {
  const half = Math.floor(step / 2);
  const row = Math.round((step * Math.sqrt(3)) / 2);
  const nodes: Spot[] = [];
  for (let j = -6; j <= 6; j++) for (let i = -6; i <= 6; i++) nodes.push({ x: i * step + j * half, y: j * row });
  // Утроенные середины треугольников: (0,0), (step,0) и узел над ними или под ними.
  const holes: Spot[] = [
    { x: step + half, y: row },
    { x: 2 * step - half, y: -row },
  ];
  const out: Spot[][] = [];
  for (const hole of holes) {
    const far = (p: Spot): number => (3 * p.x - hole.x) ** 2 + (3 * p.y - hole.y) ** 2;
    const sorted = [...nodes].sort((a, b) => far(a) - far(b) || a.y - b.y || a.x - b.x);
    if (far(sorted[SICILY_COUNT - 1]) === far(sorted[SICILY_COUNT])) throw new Error('Сицилия: кучка решётки неоднозначна.');
    const patch = sorted.slice(0, SICILY_COUNT);
    out.push(patch, patch.map((p) => ({ x: p.y, y: p.x })));
  }
  return out;
}

/**
 * Места с шагом `step` или null — кучка с таким шагом на годную сушу острова не встаёт.
 *
 * Кучка (`sicilyPatches`) пробуется во всех положениях, где все её узлы — годные клетки острова
 * (`sicilyFit`). Из них берётся то, где у городов больше всего суши вокруг: сумма суши в круге шага у каждого места —
 * так выбирается часть острова, «по суше». Ничья — первое по порядку: вид кучки, затем клетка первого узла по строкам.
 * Сравнения в целых: вывод один на любом движке.
 *
 * Порядок — порядок выдачи, **от середины кучки к краю**: по расстоянию до её середины (среднего мест, в целых —
 * умноженного на число мест), ничья — по строкам, слева направо. Первые пришедшие стоят ближе всех друг к другу.
 */
export function sicilyAt(step: number): Spot[] | null {
  const fit = sicilyLand().filter(sicilyFit);
  const fitKeys = new Set(fit.map((p) => `${p.x}|${p.y}`));
  let best: Spot[] | null = null;
  let bestLand = -1;
  for (const patch of sicilyPatches(step)) {
    for (const anchor of fit) {
      const spots = patch.map((p) => ({ x: anchor.x + p.x - patch[0].x, y: anchor.y + p.y - patch[0].y }));
      if (!spots.every((s) => fitKeys.has(`${s.x}|${s.y}`))) continue;
      const land = spots.reduce((sum, s) => sum + landAround(s, step), 0);
      if (land > bestLand) {
        bestLand = land;
        best = spots;
      }
    }
  }
  return best ? centreOut(best) : null;
}

/** Места от середины кучки к краю (см. `sicilyAt`). */
function centreOut(spots: Spot[]): Spot[] {
  const n = spots.length;
  const sx = spots.reduce((v, s) => v + s.x, 0);
  const sy = spots.reduce((v, s) => v + s.y, 0);
  const far = (s: Spot): number => (n * s.x - sx) ** 2 + (n * s.y - sy) ** 2;
  return [...spots].sort((a, b) => far(a) - far(b) || a.y - b.y || a.x - b.x);
}

/**
 * Вывод мест: `SICILY_COUNT` узлов шестиугольной решётки с шагом `SICILY_STEP` одной кучкой в той части острова, где у
 * городов больше всего суши вокруг (`sicilyAt`). Равномерно по устройству: у каждого соседи — в шаге или по диагонали
 * ряда, и ни у кого ближе.
 */
export function deriveSicily(): Spot[] {
  const spots = sicilyAt(SICILY_STEP);
  if (!spots) throw new Error(`Сицилия: ${SICILY_COUNT} мест с шагом ${SICILY_STEP} на острове не встают.`);
  return spots;
}

/**
 * Чужие места — соседи города, стоящего на одном из мест. Под их стенами логова своего мира не встают
 * (`LAIR_SETTLE_GAP`), даже пока место пустует: соседа поставит туда сервер, а логово, однажды заведённое, уже не
 * переедет. Город не на месте — пусто: обычная игра.
 *
 * У города на острове — только места острова, как до материка: мир пересобирается из сида на каждой загрузке, и места
 * материка в его списке могли бы сдвинуть логова у порога в уже идущих партиях острова (их ищут броском, и обойдённая
 * клетка сдвигает следующие броски). Город на материке — все чужие места, и острова, и материка.
 */
export const islandNeighbours = (home: Spot): Spot[] => {
  const other = (s: Spot): boolean => s.x !== home.x || s.y !== home.y;
  if (sicilySlot(home) > 0) return SICILY.filter(other);
  return spawnSlot(home) > 0 ? SPAWNS.filter(other) : [];
};

/** Регион острова — для правила «свободное место в том же регионе», когда места кончились, и для мест материка. */
export const inSicilyTheatre = (at: Spot): boolean => theatreAt(at.x, at.y)?.id === SICILY_THEATRE;

// ------------------------------------------------------------------------------- материк: места после острова ---

/**
 * Западный берег «сапога», с юга на север: настоящие города, по которым идёт цепочка мест после острова (слово владельца
 * 11.10.2026: с двадцать шестого игрока — от Калабрии вдоль Тирренского моря к Неаполю, Риму и до Флоренции). Последний
 * отрезок — от Пизы вверх по Арно. Долгота и широта; клетки под ними даёт атлас.
 */
export const COAST: readonly (readonly [name: string, lon: number, lat: number])[] = [
  ['Реджо', 15.65, 38.11],
  ['Пальми', 15.85, 38.36],
  ['Тропея', 15.9, 38.68],
  ['Ламеция', 16.22, 38.96],
  ['Паола', 16.04, 39.36],
  ['Скалея', 15.79, 39.81],
  ['Сапри', 15.63, 40.07],
  ['Агрополи', 15.0, 40.35],
  ['Салерно', 14.77, 40.68],
  ['Неаполь', 14.25, 40.85],
  ['Гаэта', 13.57, 41.21],
  ['Террачина', 13.25, 41.29],
  ['Анцио', 12.63, 41.45],
  ['Рим', 12.5, 41.9],
  ['Чивитавеккья', 11.8, 42.09],
  ['Орбетелло', 11.21, 42.44],
  ['Гроссето', 11.11, 42.76],
  ['Пьомбино', 10.53, 42.93],
  ['Ливорно', 10.31, 43.55],
  ['Пиза', 10.4, 43.72],
  ['Флоренция', 11.25, 43.77],
];

/** Как далеко от пути вдоль берега ищется годная клетка, клеток: у самой воды доли суши мало, место встаёт вглубь. */
export const COAST_REACH = 3;

/**
 * Места на материке, **с юга на север** — порядок выдачи после острова: двадцать шестой встаёт у Мессинского пролива,
 * последний — во Флоренции. Соседи по цепочке — в 4…5,4 клетки (≈ 24…33 км; на острове — 3,6…4). Запечено из
 * `deriveMainland()`; тест сверяет.
 */
export const MAINLAND: readonly Spot[] = [
  { x: 784, y: 1329 },
  { x: 787, y: 1326 },
  { x: 788, y: 1322 },
  { x: 790, y: 1318 },
  { x: 792, y: 1314 },
  { x: 791, y: 1310 },
  { x: 789, y: 1305 },
  { x: 787, y: 1300 },
  { x: 785, y: 1296 },
  { x: 782, y: 1293 },
  { x: 778, y: 1290 },
  { x: 775, y: 1287 },
  { x: 772, y: 1283 },
  { x: 768, y: 1281 },
  { x: 764, y: 1279 },
  { x: 761, y: 1276 },
  { x: 758, y: 1273 },
  { x: 754, y: 1272 },
  { x: 750, y: 1271 },
  { x: 746, y: 1269 },
  { x: 743, y: 1266 },
  { x: 743, y: 1262 },
  { x: 739, y: 1259 },
  { x: 735, y: 1257 },
  { x: 732, y: 1254 },
  { x: 728, y: 1251 },
  { x: 725, y: 1247 },
  { x: 722, y: 1244 },
  { x: 719, y: 1240 },
  { x: 718, y: 1235 },
  { x: 716, y: 1231 },
  { x: 719, y: 1228 },
  { x: 723, y: 1227 },
  { x: 727, y: 1227 },
];

/** Все места по порядку выдачи: сперва остров (номера 1..25 не сдвигаются), потом материк. */
export const SPAWNS: readonly Spot[] = [...SICILY, ...MAINLAND];

/** Номер места (1..`SPAWNS.length`), на котором стоит клетка, или 0 — не место. */
export const spawnSlot = (at: Spot): number => SPAWNS.findIndex((s) => s.x === at.x && s.y === at.y) + 1;

/** Клетки пути вдоль берега, с юга на север. */
export const coastPath = (): Spot[] => COAST.map(([, lon, lat]) => cellAt(lon, lat));

/** Годится ли клетка под место на материке: та же мерка, что у мест острова, в регионе острова и не на самом острове. */
export const mainlandFit = (at: Spot, island: ReadonlySet<string>): boolean =>
  !island.has(`${at.x}|${at.y}`) && sicilyFit(at) && inSicilyTheatre(at);

/**
 * Вывод мест материка. Путь вдоль берега (`COAST`) проходится **от Флоренции к проливу** мелким шагом (четверть клетки
 * по длинной оси отрезка); у каждой точки пути берётся ближняя годная клетка в `COAST_REACH` (ничья — по строкам, слева
 * направо), и она становится местом, если ни одно место — ни острова, ни уже поставленное — не стоит к ней ближе шага
 * острова (`SICILY_STEP`). С севера — затем, чтобы последнее место встало на саму Флоренцию; выдаются места обратным
 * порядком, с юга на север. Сравнения в целых: вывод один на любом движке.
 */
export function deriveMainland(): Spot[] {
  const island = new Set(sicilyLand().map((p) => `${p.x}|${p.y}`));
  const near = (p: Spot): Spot | null => {
    let best: Spot | null = null;
    let bestD = Infinity;
    for (let dy = -COAST_REACH; dy <= COAST_REACH; dy++) {
      for (let dx = -COAST_REACH; dx <= COAST_REACH; dx++) {
        const d = dx * dx + dy * dy;
        if (d > COAST_REACH * COAST_REACH || d > bestD) continue;
        const q = { x: p.x + dx, y: p.y + dy };
        if (!mainlandFit(q, island)) continue;
        if (d < bestD || (best !== null && (q.y < best.y || (q.y === best.y && q.x < best.x)))) {
          best = q;
          bestD = d;
        }
      }
    }
    return best;
  };
  const path = coastPath().reverse();
  const placed: Spot[] = [...SICILY];
  const out: Spot[] = [];
  for (let k = 0; k + 1 < path.length; k++) {
    const a = path[k];
    const b = path[k + 1];
    const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) * 4;
    for (let i = 0; i <= n; i++) {
      const c = near({ x: Math.round(a.x + ((b.x - a.x) * i) / n), y: Math.round(a.y + ((b.y - a.y) * i) / n) });
      if (!c || placed.some((s) => (s.x - c.x) ** 2 + (s.y - c.y) ** 2 < SICILY_STEP * SICILY_STEP)) continue;
      placed.push(c);
      out.push(c);
    }
  }
  return out.reverse();
}
