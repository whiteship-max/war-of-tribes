// Места появления новых игроков для теста с игроками (docs/test_world.md): двенадцать клеток на Сицилии.
//
// Режим включает сервер настройкой `TRIBE_SPAWN=sicily` (`netlify/lib/http.spawnMode`); без неё расселение обычное
// (`settle.placeCastle`). Место выдаёт реестр замков (`netlify/lib/roster.upsert`) — свободное из этого списка, а когда
// свободных нет, — по обычным правилам, но в регионе острова (`SICILY_THEATRE`), чтобы новичок мог воевать с теми, кто
// уже на острове.
//
// Места — данные, а не расчёт на запросе: `SICILY` запечён и сверяется тестом с выводом `deriveSicily()` (`spawn.test.ts`),
// как регионы с `theatre/derive.ts`. Поправил вывод — пересобери список, иначе красный тест, а не другие места.
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

/** Сколько мест на острове (слово владельца). */
export const SICILY_COUNT = 12;

/** Сердце острова — Энна: от него остров размечается разливом по суше. */
export const SICILY_HEART = { lon: 14.28, lat: 37.57 } as const;

/** Регион острова — весь остров лежит в нём (`spawn.test.ts`). */
export const SICILY_THEATRE = 'italy';

/**
 * Шаг между местами, клеток (6 × 6,1 км ≈ 37 км): места стоят узлами шестиугольной решётки, соседи в ряду — через
 * шаг, через ряд — по диагонали √34 ≈ 5,8 клетки (ряды на целых клетках идут через 5, а не через 6·√3/2 = 5,2).
 *
 * Шаг выведен, а не выбран: **наибольший, при котором двенадцать встают одной кучкой на годную сушу острова.** При
 * шаге 7 кучка не помещается нигде (тест): поперёк остров для неё узок. Реже — значит
 * разносить места по всему острову (прежние 8–10 клеток) и терять «из любого города видно всех»; плотнее — отнимать у
 * города место вокруг без нужды. Шаг совпадает с порогом дома `LAIR_HOME_GAP`: сосед стоит там, ближе чего к одиночке
 * не подходит даже логово.
 *
 * Обычная ближняя граница расселения — `SETTLE_GAP` (24); кто ставится по обычным правилам, держит её.
 */
export const SICILY_STEP = 6;

/**
 * Кольцо живого обзора у города на месте острова, клеток (≈ 110 км), — вместо обычного `HOME_SIGHT` (17). Поперечник
 * двенадцати мест, округлённый вверх: из любого из них видно остальные одиннадцать вживую, имя, мощь и население.
 * Меньше нельзя — пара крайних мест друг друга не увидит; больше незачем (тест держит оба края). Только у города на
 * месте острова (`world/sight.homeSight`), то есть только при `TRIBE_SPAWN=sicily`: обычная игра его не видит.
 */
export const SICILY_SIGHT = 18;

/**
 * Круг доли суши у места, клеток. Обычная мерка расселения — круг `HOME_LAND_RADIUS` (10 клеток, 61 км): на острове
 * шириной 30 клеток её проходит только середина (379 клеток из 664), и кучке мест почти не из чего было бы выбирать
 * часть острова. Узкий круг отсекает то же, ради чего есть широкий, — кончик мыса, — и пускает остальное побережье.
 * Доля та же — `HOME_LAND_SHARE`.
 */
export const SICILY_LAND_RADIUS = 4;

/**
 * Двенадцать мест на Сицилии, с запада на восток: кучка в середине и на юго-востоке острова, соседи — в шаге решётки
 * (6 клеток) или по диагонали ряда (5,8). Порядок — порядок выдачи: первый вошедший получает первое свободное.
 * Запечено из `deriveSicily()`; тест сверяет.
 */
export const SICILY: readonly Spot[] = [
  { x: 759, y: 1337 },
  { x: 759, y: 1343 },
  { x: 764, y: 1334 },
  { x: 764, y: 1340 },
  { x: 764, y: 1346 },
  { x: 769, y: 1331 },
  { x: 769, y: 1337 },
  { x: 769, y: 1343 },
  { x: 769, y: 1349 },
  { x: 774, y: 1334 },
  { x: 774, y: 1340 },
  { x: 774, y: 1346 },
];

/** Номер места (1..12), на котором стоит клетка, или 0 — не место острова. */
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
 * Кучки из двенадцати узлов шестиугольной решётки с шагом `step` — в клетках решётки; на остров их сдвигает `sicilyAt`.
 *
 * Решётка на целых клетках: узлы в ряду — через шаг, ряды — через целую клетку, ближнюю к `step·√3/2`, каждый ряд
 * сдвинут на полшага (вниз до целой). Кучка — двенадцать узлов, ближних к середине одного треугольника решётки: три в
 * первом кругу, три во втором и шесть в третьем. Она почти круглая — поперечник три шага, — поэтому кольцо обзора,
 * в котором видно всех, выходит самым малым. Видов четыре: ряды вдоль острова или поперёк и треугольник вершиной вверх
 * или вниз.
 *
 * Расстояния — в целых: середина треугольника считается утроенной, ничьих на границе двенадцати нет (иначе ошибка, а
 * не тихий выбор).
 */
export function sicilyPatches(step: number): Spot[][] {
  const half = Math.floor(step / 2);
  const row = Math.round((step * Math.sqrt(3)) / 2);
  const nodes: Spot[] = [];
  for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) nodes.push({ x: i * step + j * half, y: j * row });
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
 * Двенадцать мест с шагом `step` или null — кучка с таким шагом на годную сушу острова не встаёт.
 *
 * Кучка (`sicilyPatches`) пробуется во всех положениях, где все двенадцать узлов — годные клетки острова
 * (`sicilyFit`). Из них берётся то, где у городов больше всего суши вокруг: сумма суши в круге шага у каждого места —
 * так выбирается часть острова, «по суше». Ничья — первое по порядку: вид кучки, затем клетка первого узла по строкам.
 * Сравнения в целых: вывод один на любом движке.
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
  return best ? best.sort((a, b) => a.x - b.x || a.y - b.y) : null;
}

/**
 * Вывод мест: двенадцать узлов шестиугольной решётки с шагом `SICILY_STEP` одной кучкой в той части острова, где у
 * городов больше всего суши вокруг (`sicilyAt`). Равномерно по устройству: у каждого соседи — в шаге или по диагонали
 * ряда, и ни у кого ближе.
 */
export function deriveSicily(): Spot[] {
  const spots = sicilyAt(SICILY_STEP);
  if (!spots) throw new Error(`Сицилия: двенадцать мест с шагом ${SICILY_STEP} на острове не встают.`);
  return spots;
}

/**
 * Чужие места острова — соседи города, стоящего на одном из них. Под их стенами логова своего мира не встают
 * (`LAIR_SETTLE_GAP`), даже пока место пустует: соседа поставит туда сервер, а логово, однажды заведённое, уже не
 * переедет. Город не на месте острова — пусто: обычная игра.
 */
export const islandNeighbours = (home: Spot): Spot[] =>
  sicilySlot(home) > 0 ? SICILY.filter((s) => s.x !== home.x || s.y !== home.y) : [];

/** Регион острова — для правила «свободное место в том же регионе», когда места на острове кончились. */
export const inSicilyTheatre = (at: Spot): boolean => theatreAt(at.x, at.y)?.id === SICILY_THEATRE;
