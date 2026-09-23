// Автопилот партии — один игрок на все отчёты.
//
// **Дверь одна, и держит это тест по исходникам** (`autopilot.test.ts`): в `scripts/` время племени
// идёт (`tick`, `catchUp`), пульс мира ложится в племя (`tribePulse`, `syncAway`, `syncSiege`,
// `syncFaith`) и последствие прикладывается (`applyEffects`) только здесь. Отчёт, которому нужен
// игрок, зовёт `pilot`, и всё, что игрок делает в живой игре, делает этот игрок: отвечает на
// события, берёт веру, которую называет мир, расставляет людей, строит, нанимает, распускает,
// выходит на вылазку. Особенность отчёта — параметр (`Player`, `Sky`, `Flight`), а не своя копия.
//
// Откуда правило. Своих циклов, гонявших племя во времени, у отчётов было десять (и два стенда правила),
// и расходились они молча, каждый своим:
// - `raid:report` («Рост логова», «Найм») не брал веру, которую мир называет пульсом (docs/defense_mix.md,
//   раздел 6), а новичок «Роста логова» не отвечал на события вовсе — первое же повисало и затыкало
//   следующие;
// - `sack:report` (лазарет) гонял мир при посёлке, который не жил: ни тика, ни веры;
// - `pop:report`, содержание войска и лестница `sack:report` играли офлайн-догоном — событий не
//   бывает, войско не уходит, мятежа нет, — и без мира, то есть без веры;
// - `log:report` держал свою копию расстановки и стройки, отличную от этой, и отвечал на события
//   первым вариантом, а не первым бесплатным;
// - «час хозяйства» `lair:report` и `sack:report` мерил посёлок, который два часа догонялся офлайн и не
//   построил ничего, — выработка через два часа выходила в восемь раз ниже, чем у играющего.
// Каждое расхождение нашлось после того, как на его числах уже решали.
//
// Устройство:
// - **у игрока всегда есть мир** (`pilot` требует `Sky`): вера деревни приходит только пульсом, от клетки
//   замка. Мир без набегов — параметр `raids: false`, и он печатается в шапке отчёта;
// - **стенд правила — не игрок** (`stand`): время идёт на подготовленном посёлке, никто ничего не решает,
//   мира нет; так меряют сроки мятежа и ухода войска;
// - **офлайн — это игрок, которого нет** (`away`), а не способ играть быстрее;
// - **последствие без мира** (`land`) — участь, приложенная к копии посёлка.
import type { BuildingTypeId, EquipmentId, GameState, JobId, ResourceId, TroopId } from '@/game/types';
import type { TaxId } from '@/game/data/policy';
import type { FigureView, HomeEffect, MarchView, PlayerProfile, WorldPulse } from '@/world/types';
import { LocalWorld, HOME_ID } from '@/world/local/LocalWorld';
import { applyEffects, tribePulse } from '@/world/bridge';
import { awayOf, homeOf, type Away } from '@/world/muster';
import { lairShield, shieldVillagers } from '@/world/lairs';
import { starvesAt } from '@/world/siege';
import type { GenSettlement } from '@/world/gen';
import { LAIR_RIPE, LAIR_STEP } from '@/world/data/tuning';
import { createInitialState } from '@/game/state';
import { creditTech, study, troopOpen } from '@/game/sim/tech';
import { BRANCH_BUILT, REALM_BRANCHES } from '@/game/data/realm';
import { FIGURE_IDS } from '@/world/data/figures';
import { absence, catchUp, tick } from '@/game/sim/tick';
import { DAY_LENGTH, gameSeconds, realMs, realSeconds, timeScale } from '@/game/pace';
import { resolveEvent, startUpgrade } from '@/game/sim/actions';
import { eventId, mailArrive, mailStep } from '@/game/sim/mail';
import { assignWorker, autoAssign, changeFreeJob, unassignWorker } from '@/game/sim/workers';
import { recruitCost, startRecruit } from '@/game/sim/army';
import { forgeCost, startForge } from '@/game/sim/smithy';
import { dismissSoldiers } from '@/game/sim/upkeep';
import {
  armySize,
  buildingOfType,
  buildingSlots,
  foodConsumptionPerDay,
  forgeRate,
  handsCount,
  housingCapacity,
  idleCount,
  isSite,
  jobCounts,
  productionPerDay,
  storageCap,
  taxIncomePerDay,
  wageOf,
  wagesPerDay,
  workerCount,
} from '@/game/derived';
import { RESOURCE_IDS } from '@/game/constants';
import { BUILDING_BY_ID } from '@/game/data/buildings';
import { EVENT_BY_ID } from '@/game/data/events';
import { MUTINY_EVENT } from '@/game/data/order';
import { TROOP_BY_ID, TROOP_IDS } from '@/game/data/troops';
import { EQUIPMENT_BY_ID, EQUIPMENT_IDS } from '@/game/data/equipment';
import { troopTotal, type TroopStack } from '@/game/battle/kinds';

/**
 * Единицы отчётов на часах мира — **игровой день и шестьдесят игровых дней**, мс. Имена прежние (`MIN`,
 * `HOUR`): при шкале времени 1 это настоящая минута и настоящий час, и все выводы отчётов до поворота
 * шкалы сняты в них. После поворота сравнивать выводы можно только в игровом времени — ритм угрозы,
 * хозяйство, лечение и осада идут им, — поэтому «мин» и «ч» в таблицах отчётов значат игровой день и
 * шестьдесят игровых дней, о чём каждый прогон говорит строкой (`unitsNote`). Настоящее время мира
 * (поход, сбор дружины, занятость агента) в этих единицах печатается мельче, чем было.
 */
export const MIN = realMs(DAY_LENGTH);
export const HOUR = 60 * MIN;
export const START = 1_700_000_000_000;

/** Настоящее состояние мира: отчёт — прибор, ему положено видеть больше панели. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Inside = any;

// ---------- Посёлок мерки ----------

/** Состав и мерка войска — те же, что у осады и лазарета. */
export const MIX: TroopStack = { spearman: 4, archer: 3, legionary: 2, rider: 1 };
/** Мерка войска посёлка уровня L — две прежние вместимости Статуи. */
export const armyAt = (level: number): number => 2 * (20 + 10 * (level - 1));

/** `n` бойцов по составу `mix`; остаток округления — последнему виду. */
export function stackOf(n: number, mix: TroopStack = MIX): TroopStack {
  const out: TroopStack = {};
  const ids = Object.keys(mix) as TroopId[];
  const whole = ids.reduce((s, id) => s + (mix[id] ?? 0), 0);
  let left = n;
  ids.forEach((id, i) => {
    const k = i === ids.length - 1 ? left : Math.round((n * (mix[id] ?? 0)) / whole);
    out[id] = k;
    left -= k;
  });
  return out;
}

/**
 * Посёлок уровня L: жильё на 90 %, склад полон, войско — `armyAt` по составу. Мерка `siege:report`.
 * `over` — уровни отдельных построек поверх L (жители дорастают до новых крыш).
 */
export function townAt(level: number, over: Record<string, number> = {}): GameState {
  const g = createInitialState(7);
  g.tutorialDone = true;
  for (const b of g.buildings) b.level = over[b.type] ?? level;
  g.pop = Math.round(housingCapacity(g) * 0.9);
  for (const [id, n] of Object.entries(stackOf(armyAt(level)))) g.army[id as TroopId] = n ?? 0;
  autoAssign(g);
  for (const r of RESOURCE_IDS) g.resources[r] = storageCap(g);
  played(g);
  return g;
}

/**
 * Сделать посёлок **сыгранной партией**, а не новой: люди на местах и ступени технологий
 * засчитаны.
 *
 * Зачем это нужно. Мерочному посёлку жильё, войско и склад ставят прямо, минуя стройку и
 * найм, — а с гейтом такая партия перестала бы быть той, какой она бывает у игрока: новая
 * партия начинается без места лазутчика, и мерка, собранная из новой, мерила бы деревню,
 * которой в игре не бывает (решение владельца 12, docs/dynasty.md, разделы 6.2 и 10.1).
 * Засчитывает ступень та же дверь, что и ступень сохранения (`sim/tech.creditTech`):
 * второго правила засчитывания в проекте нет и быть не должно.
 *
 * Свежую партию, которую отчёт играет с первого дня, этим трогать нельзя — она и есть
 * новая партия, и гейт для неё настоящий.
 */
export function played(g: GameState): GameState {
  for (const id of FIGURE_IDS) g.agents[id].vacant = false;
  creditTech(g);
  return g;
}

export function memory(data: string | null = null) {
  return {
    read: (): string | null => data,
    write: (json: string): void => {
      data = json;
    },
  };
}

// ---------- Решения игрока ----------

/** Доли населения по работам: хозяйство большого посёлка. */
export const SHARE: [JobId, number][] = [
  ['woodcutter', 0.22],
  ['gatherer', 0.14],
  ['farmer', 0.14],
  ['hunter', 0.12],
  ['stonecutter', 0.12],
  ['miner', 0.08],
  ['herder', 0.05],
  ['crafter', 0.05],
  ['smith', 0.02],
  ['priest', 0.01],
];

const jobBuilding = (s: GameState, job: JobId) =>
  s.buildings.find((b) => BUILDING_BY_ID[b.type].job === job) ?? null;

/**
 * Сколько рук игрок держит свободными: пятую часть племени, не меньше двух, — стройка идёт их
 * руками. Одно число на расстановку (`staff`) и на найм у того, кто строит (`hands`).
 */
export const spareHands = (s: GameState): number => Math.max(2, Math.round(s.pop * 0.2));

/** Держит на каждой работе примерно свою долю племени. */
export function staff(s: GameState): void {
  const counts = jobCounts(s);
  const spare = spareHands(s);
  for (const [job, share] of SHARE) {
    const want = Math.max(0, Math.round((s.pop - spare) * share));
    const have = counts[job];
    const b = jobBuilding(s, job);
    if (have > want) {
      const over = have - want;
      if (b && workerCount(s, b.id) > 0) unassignWorker(s, b.id, over);
      else changeFreeJob(s, job, -over);
    } else if (have < want) {
      const need = Math.min(want - have, idleCount(s) - spare);
      if (need > 0 && b) assignWorker(s, b.id, need);
    }
  }
}

/**
 * Что улучшать дальше: жильё, склад, потом самое отстающее. `skip` — постройки, которых этот
 * игрок не поднимает никогда (`raid-growth:report` меряет им, во что обходится не поднимать ратушу);
 * они выпадают из каждой ветки, а не обрывают её.
 */
export function build(s: GameState, skip: readonly BuildingTypeId[] = []): void {
  if (s.buildings.some(isSite)) return;
  const cap = housingCapacity(s);
  // Жильё — узкое место: пока селить некуда, племя стоит.
  if (s.pop >= cap - 20) {
    for (const t of (['houses', 'town_hall'] as BuildingTypeId[]).filter((x) => !skip.includes(x))) {
      const b = buildingOfType(s, t)!;
      if (startUpgrade(s, b.id) === null) return;
    }
  }
  // Что-то упёрлось в склад — поднимаем вместимость.
  const room = storageCap(s);
  if (RESOURCE_IDS.some((r) => s.resources[r] >= room - 1)) {
    if (startUpgrade(s, buildingOfType(s, 'storage')!.id) === null) return;
  }
  // Мест работы должно хватать на людей.
  const slots = s.buildings.reduce((n, b) => n + buildingSlots(b), 0);
  if (slots < s.pop) {
    const byJob = [...s.buildings]
      .filter((b) => BUILDING_BY_ID[b.type].job && !skip.includes(b.type))
      .sort((a, b) => a.level - b.level);
    for (const b of byJob) if (startUpgrade(s, b.id) === null) return;
  }
  for (const b of s.buildings.filter((x) => !skip.includes(x.type)).sort((a, b) => a.level - b.level)) {
    if (startUpgrade(s, b.id) === null) return;
  }
}

/** Кузница заказывает недостачу, но не дальше стольких минут своей работы вперёд. */
export const FORGE_AHEAD = 10 * MIN;

/**
 * Как игрок нанимает: `means` — жалованье после найма не больше дохода казны, казна пуста и жалованье
 * больше дохода — распускает лишних, дорогих первыми; `feed` — пока еды приходит не меньше, чем
 * уходит, о казне не думает и не распускает.
 */
export type HireStyle = 'means' | 'feed';

/** Что остановило найм на этом решении. */
export type Stop = 'цель' | 'казна' | 'еда' | 'руки' | 'снаряжение' | 'ресурсы' | 'технология';

/** Что игрок успел сделать и что с ним случилось — счёт, который читают отчёты. */
export interface Ledger {
  hired: number;
  dismissed: number;
  deserted: number;
  /** Из ушедших — остались в посёлке жителями (ушли неуплатой, а крыша нашлась). */
  returned: number;
  spent: number;
  /** Ресурсы найма и ковки по видам. */
  spentBy: Partial<Record<ResourceId, number>>;
  stops: Partial<Record<Stop, number>>;
  mutinies: number;
  mutinyHeld: number;
  /** Событий разобрано ответом игрока. */
  answered: number;
  seenLog: WeakMap<object, number>;
  lastMutiny: number;
}

export const ledger = (): Ledger => ({
  hired: 0,
  dismissed: 0,
  deserted: 0,
  returned: 0,
  spent: 0,
  spentBy: {},
  stops: {},
  mutinies: 0,
  mutinyHeld: 0,
  answered: 0,
  seenLog: new WeakMap(),
  lastMutiny: -1,
});

const spend = (l: Ledger, cost: Partial<Record<ResourceId, number>>): void => {
  for (const r of RESOURCE_IDS) {
    const v = cost[r] ?? 0;
    if (v <= 0) continue;
    l.spent += v;
    l.spentBy[r] = (l.spentBy[r] ?? 0) + v;
  }
};

const queued = (g: GameState, id: TroopId): number =>
  g.recruits.filter((r) => r.troop === id).reduce((n, r) => n + r.count - r.done, 0);

/**
 * Держит ли посёлок ещё `n` бойцов вида `id` сверх нынешних и стоящих в очереди. Проверяется
 * замером: бойцы кладутся в состояние, читаются функции игры, состояние возвращается.
 */
function affords(g: GameState, style: HireStyle, id: TroopId, n: number): Stop | null {
  const extra: Partial<Record<TroopId, number>> = {};
  for (const t of TROOP_IDS) extra[t] = queued(g, t) + (t === id ? n : 0);
  const was = { ...g.army };
  const pop = g.pop;
  for (const t of TROOP_IDS) g.army[t] += extra[t] ?? 0;
  g.pop -= n;
  let stop: Stop | null = null;
  if (style === 'feed') {
    if (productionPerDay(g).food < foodConsumptionPerDay(g)) stop = 'еда';
  } else if (wagesPerDay(g) > taxIncomePerDay(g)) stop = 'казна';
  Object.assign(g.army, was);
  g.pop = pop;
  return stop;
}

/** Сколько добра стоит один боец вида целиком: припас найма и снаряжение по цене ковки. */
export const unitCost = (id: TroopId): number => {
  let n = Object.values(recruitCost(id, 1)).reduce((a, v) => a + (v ?? 0), 0);
  for (const [item, per] of Object.entries(TROOP_BY_ID[id].gear)) {
    n += (per ?? 0) * Object.values(forgeCost(item as EquipmentId, 1)).reduce((a, v) => a + (v ?? 0), 0);
  }
  return n;
};

/** Укомплектовать кузницу: у нанимающего горн не стоит на двух процентах племени. */
function staffSmithy(g: GameState): void {
  const b = buildingOfType(g, 'smithy');
  if (!b) return;
  const room = Math.min(buildingSlots(b) - handsCount(g, b.id), idleCount(g));
  if (room > 0) assignWorker(g, b.id, room);
}

/** Самый большой n ≤ max, при котором `ok(n)`; ok монотонна. */
function largest(max: number, ok: (n: number) => boolean): number {
  let lo = 0;
  let hi = Math.max(0, Math.floor(max));
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ok(mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Состав найма под гейтом: закрытый вид из мерки выпадает, а доля его переходит открытым —
 * `stackOf` делит то же целевое число на сумму оставшихся весов. Это игрок, который тратит
 * те же деньги на то, что у него есть.
 *
 * **Дубинщиками закрытую долю не добирают, и это решение прибора, а не недосмотр.** Мерка
 * `MIX` дубинщиков не знала и до гейта: они худшие в игре на единицу еды и стоят по жителю
 * с головы, а предел найма у них один — свободные руки. Замер (`raid-hiring:report`,
 * раздел Б, прогон 22.09.2026) показал, чем это кончается: 371 нанятый, 260 ушедших и
 * деревня в тринадцать человек к шестому часу. Так игрок не играет; так играет цель,
 * растущая без предела.
 *
 * **Перемерено 23.09.2026 на приборе без петли** (`CLOSED_SHARE=1 npm run raid-hiring:report`,
 * docs/hiring.md, раздел 15): те 371 / 260 / 13 — петля найма и запаса рук, а не дубинщики; у
 * изучающих поведений правило почти ничего не решает, у игрока без технологий — всё. Правило
 * оставлено до решения владельца.
 *
 * Когда открыто всё, ключи и их порядок те же, что у входного состава, и `stackOf` даёт
 * **тот же состав до бойца**: иначе посёлок мерки, которому ступень засчитана, поехал бы
 * от одной правки прибора.
 */
export function openMix(g: GameState, mix: TroopStack): TroopStack {
  const out: TroopStack = {};
  for (const [key, weight] of Object.entries(mix)) {
    const id = key as TroopId;
    if (troopOpen(g, id)) out[id] = weight ?? 0;
  }
  return out;
}

/** Куда уходит доля вида, закрытого гейтом: открытым видам мерки (правило прибора) или дубинщикам. */
export type ClosedShare = 'open' | 'clubman';

/**
 * Другой ответ на тот же вопрос: доля закрытого вида уходит дубинщикам — единственному виду,
 * открытому с первой секунды. **Прибор так не нанимает**: вариант заведён ради перемера довода
 * `openMix`, который снят на приборе с петлёй (`CLOSED_SHARE=1 npm run raid-hiring:report`,
 * docs/hiring.md, раздел 15). Когда открыто всё, состав тот же, что у `openMix`, до бойца.
 */
export function clubMix(g: GameState, mix: TroopStack): TroopStack {
  const out = openMix(g, mix);
  let closed = 0;
  for (const [key, weight] of Object.entries(mix)) if (!troopOpen(g, key as TroopId)) closed += weight ?? 0;
  if (closed > 0) out.clubman = (out.clubman ?? 0) + closed;
  return out;
}

/**
 * Изучить всё, что уже по карману. Тратить очки игроку больше некуда, а ступень, до
 * которой он накопил, он покупает в тот же заход: «когда хватило — купил» и есть самое
 * простое правдивое поведение, и своего числа у него нет.
 *
 * Ветви — все построенные (`BRANCH_BUILT`), список руками не пишется. Ступень поднимает
 * та же дверь, что и в игре (`sim/tech.study`): второго способа поднять `realm.tech` в
 * проекте нет.
 */
function learn(g: GameState): void {
  for (const b of REALM_BRANCHES) {
    if (!BRANCH_BUILT[b]) continue;
    // Цена растёт с уровнем, а очки за один заход не удваиваются: круг кончается сам —
    // на первой же ступени, которую не на что купить (или на конце ветви).
    let bought = study(g, b);
    while (bought === null) bought = study(g, b);
  }
}

/**
 * Из скольких рук поведение нанимает. **Кто строит, нанимает только сверх запаса на стройку**
 * (`spareHands`) — при любом поведении. Иначе найм забирал этот запас на каждом решении, расстановка
 * тут же снимала с работ новый пропорционально убывшему племени, и цель, растущая без предела,
 * съедала партию — прибор мерил свою петлю, а не игрока. Так было у «всё, что прокормит»
 * (docs/hiring.md, раздел 14) и у «по средствам» с дешёвыми дубинщиками, которых казна не держит
 * (раздел 15); решение владельца: запас берегут все, кто строит.
 *
 * У того, кто не строит (посёлок мерки, где уровни стоят), запас не держит ничего — и найм берёт все
 * свободные руки. Сам игровой факт — дешёвое войско стоит населения — не снят нигде: пределы
 * поведений (казна, еда) прежние.
 */
function hands(g: GameState, how: HireHow): number {
  const idle = idleCount(g);
  return how.builds ? Math.max(0, idle - spareHands(g)) : idle;
}

/** Как игрок нанимает сверх поведения: строит ли и куда уходит закрытая доля. */
interface HireHow {
  builds: boolean;
  closed: ClosedShare;
}

/** Нанять по поведению; что остановило найм, ложится в `l.stops`. Состав — мерка, урезанная гейтом (`openMix`). */
function hire(g: GameState, style: HireStyle, mix: TroopStack, l: Ledger, how: HireHow): void {
  // Цель — всё, что пустит лимит: сперва недостача мерки по видам, потом ещё круг.
  const total = armySize(g) + TROOP_IDS.reduce((n, id) => n + queued(g, id), 0);
  const open = how.closed === 'clubman' ? clubMix(g, mix) : openMix(g, mix);
  const want = stackOf(total + Math.max(10, Math.round(total * 0.25)), open);
  // Закрытый вид — причина по умолчанию: не дойди дело ни до одного предела, в отчёте
  // должно стоять «технология», а не «цель». Все прочие пределы её перебивают: они
  // случились позже и ближе к делу.
  let stop: Stop = Object.keys(mix).some((id) => !troopOpen(g, id as TroopId)) ? 'технология' : 'цель';
  for (const id of Object.keys(open) as TroopId[]) {
    const deficit = Math.max(0, (want[id] ?? 0) - g.army[id] - queued(g, id));
    if (deficit <= 0) continue;
    const def = TROOP_BY_ID[id];
    let n = Math.min(deficit, hands(g, how));
    if (n < deficit) stop = 'руки';
    for (const [item, per] of Object.entries(def.gear)) {
      const can = Math.floor((g.equipment[item as EquipmentId] ?? 0) / (per ?? 1));
      if (can < n) {
        n = can;
        stop = 'снаряжение';
      }
    }
    const byLimit = largest(n, (k) => affords(g, style, id, k) === null);
    if (byLimit < n) {
      stop = affords(g, style, id, byLimit + 1) ?? stop;
      n = byLimit;
    }
    const byGoods = largest(n, (k) => k === 0 || RESOURCE_IDS.every((r) => (recruitCost(id, k)[r] ?? 0) <= g.resources[r]));
    if (byGoods < n) {
      stop = 'ресурсы';
      n = byGoods;
    }
    if (n <= 0) continue;
    const cost = recruitCost(id, n);
    if (startRecruit(g, id, n) === null) {
      spend(l, cost);
      l.hired += n;
    }
  }
  l.stops[stop] = (l.stops[stop] ?? 0) + 1;

  // Кузница: недостача снаряжения на круг найма, не дальше FORGE_AHEAD работы вперёд.
  const rate = forgeRate(g);
  if (rate <= 0) return;
  let ahead = g.forge.reduce((w, o) => w + EQUIPMENT_BY_ID[o.item].work * (o.count - o.done) - o.work, 0);
  for (const item of EQUIPMENT_IDS) {
    let need = 0;
    // Открытый вид носит только открытые вещи — своей проверки гейта у горна здесь не
    // нужно: недостача по закрытой вещи выходит нулевой сама.
    for (const id of Object.keys(open) as TroopId[]) {
      const deficit = Math.max(0, (want[id] ?? 0) - g.army[id] - queued(g, id));
      need += deficit * (TROOP_BY_ID[id].gear[item] ?? 0);
    }
    need -= (g.equipment[item] ?? 0) + g.forge.filter((o) => o.item === item).reduce((n, o) => n + o.count - o.done, 0);
    const room = Math.floor((rate * (FORGE_AHEAD / 1000) - ahead) / EQUIPMENT_BY_ID[item].work);
    const n = largest(Math.min(need, room), (k) => k === 0 || RESOURCE_IDS.every((r) => (forgeCost(item, k)[r] ?? 0) <= g.resources[r]));
    if (n <= 0) continue;
    const cost = forgeCost(item, n);
    if (startForge(g, item, n) === null) {
      spend(l, cost);
      ahead += EQUIPMENT_BY_ID[item].work * n;
    }
  }
}

/** По средствам: казна пуста, а жалованье больше дохода — распустить лишних, дорогих первыми. */
function trim(g: GameState, l: Ledger): void {
  if (g.gold > 0 || wagesPerDay(g) <= taxIncomePerDay(g)) return;
  for (const id of [...TROOP_IDS].reverse()) {
    while (g.army[id] > 0 && wagesPerDay(g) > taxIncomePerDay(g)) {
      const over = wagesPerDay(g) - taxIncomePerDay(g);
      const n = Math.max(1, Math.min(g.army[id], Math.ceil(over / wageOf(g, id))));
      if (dismissSoldiers(g, id, n) !== null) break;
      l.dismissed += n;
    }
  }
}

/**
 * Ответить на каждое ждущее событие первым бесплатным вариантом. На мятеж не отвечают: он ждёт
 * срока донесения — настоящие сутки (`sim/mail.EVENT_TTL`), — и стража выходит сама; срок ведёт
 * шаг почты в `pilot`, как цикл стора в игре.
 */
function answer(g: GameState, l: Ledger): void {
  for (const ev of [...g.inbox]) {
    if (ev.defId === MUTINY_EVENT) {
      if (l.lastMutiny !== ev.at) {
        l.lastMutiny = ev.at;
        l.mutinies++;
      }
      continue;
    }
    const def = EVENT_BY_ID[ev.defId];
    const i = def ? def.options.findIndex((o) => !o.cost) : -1;
    if (resolveEvent(g, Math.max(0, i), eventId(ev)).error === null) l.answered++;
  }
}

/** Сколько ушло голодом и неуплатой с прошлого раза и сколько из них осталось жителями — по строкам летописи со склейкой. */
function countDeserted(g: GameState, l: Ledger): void {
  for (const e of g.log) {
    if (!e.group?.startsWith('desert:')) continue;
    const n = e.n ?? 1;
    const seen = l.seenLog.get(e) ?? 0;
    if (n > seen) l.deserted += n - seen;
    if (n > seen && e.group.endsWith(':home')) l.returned += n - seen;
    l.seenLog.set(e, n);
  }
}

/** Мятеж кончился: удержала ли стража — по строке летописи, которой его закрыл шаг. */
function countMutinyEnd(g: GameState, l: Ledger): void {
  for (const e of g.log) {
    if (!e.text.startsWith('Мятеж:') || l.seenLog.has(e)) continue;
    l.seenLog.set(e, 1);
    if (/разогнала/.test(e.text)) l.mutinyHeld++;
  }
}

/**
 * Что игрок делает. Всё, чего здесь нет, игрок делает всегда: отвечает на события, берёт веру мира,
 * выходит из-под осады вылазкой (если не сказано `sortie: false`).
 */
export interface Player {
  /** Расставляет людей долями хозяйства (`SHARE`). */
  staff: boolean;
  /** Поднимает уровни; `skip` — чего не поднимает никогда. `false` — уровни стоят (посёлок мерки). */
  build: false | { skip: readonly BuildingTypeId[] };
  /** Как нанимает; `null` — не пополняет войско и не распускает. */
  hire: HireStyle | null;
  /**
   * Изучает ступени ветвей, как только хватает очков. Тратить их больше некуда, поэтому
   * `true` — поведение обычного игрока, а `false` оставлен отчёту, который меряет
   * нижнюю ступень ветви нарочно.
   */
  study: boolean;
  /**
   * Куда уходит доля вида, закрытого гейтом: `open` — открытым видам мерки (`openMix`, правило
   * прибора), `clubman` — дубинщикам (`clubMix`, только для перемера довода правила).
   */
  closed: ClosedShare;
  /** На осаду нанимает дубинщиков числом с мощь лагеря, но не больше свободных рук. */
  siegeLevy: boolean;
  /** Под осадой выходит вылазкой всем гарнизоном, не чаще раза в пять минут. */
  sortie: boolean;
  /** Налог, на который игрок переводит партию в первую минуту. Нет — налог партии как есть. */
  tax?: TaxId;
  /** Своё действие этого отчёта — после расстановки и стройки, до найма: ставит невольников, держит ополчение, торгует. */
  also?: (g: GameState) => void;
}

/** Игрок, который делает всё, кроме найма: как нанимать, отчёт говорит сам. */
export const player = (hire: HireStyle | null, over: Partial<Omit<Player, 'hire'>> = {}): Player => ({
  staff: true,
  build: { skip: [] },
  hire,
  study: true,
  closed: 'open',
  siegeLevy: false,
  sortie: true,
  ...over,
});

function decide(g: GameState, p: Player, l: Ledger): void {
  countDeserted(g, l);
  countMutinyEnd(g, l);
  answer(g, l);
  // Учится раньше, чем нанимает: ступень, купленная в этом же заходе, открывает вид тому
  // же кругу найма — как у игрока, который перед казармами заглянул в «Технологии».
  if (p.study) learn(g);
  if (p.staff) staff(g);
  if (p.build) build(g, p.build.skip);
  p.also?.(g);
  if (p.hire) {
    staffSmithy(g);
    if (p.hire === 'means') trim(g, l);
    hire(g, p.hire, MIX, l, { builds: p.build !== false, closed: p.closed });
  }
}

// ---------- Мир ----------

/**
 * Как считается сила вышедшего набега. `rho` null и `shield` — игра как есть. Иначе ступень
 * `rho` вместо `LAIR_STEP`, а `shield: false` снимает защиту новичка (набег выходит полной силой).
 */
export interface Step {
  name: string;
  rho: number | null;
  shield: boolean;
}
export const GAME: Step = { name: 'игра', rho: null, shield: true };

/** Мир, в котором живёт игрок. */
export interface Sky {
  seed: number;
  /** Секунд мира между пульсами. */
  pulse: number;
  /** `false` — тихий мир: логова набегов на дом не шлют. Вера, логова и всё прочее — как есть. */
  raids: boolean;
  /** Логова дозрели до начала прогона: мир живёт с тех пор `LAIR_RIPE`. */
  ripe?: boolean;
  /** Сила вышедшего набега — подстановка ступени (`raid-growth:report`, «Ступени»). */
  step?: Step;
  /** Оборона, от которой считать долю набега: мерка посёлка. Нет — оборона слепка. */
  ref?: number;
  reveal?: boolean;
  /** Подстановка в экземпляр мира до первого пульса (зеркало логова, дверь оружия). */
  setup?: (w: Inside) => void;
}

export interface Wall {
  held: boolean;
  home: number;
  lost: number;
  /** Когда бой случился, мс от начала прогона. */
  at: number;
}

/** Что случилось с деревней за прогон — счёт, который мир и пульс кладут сами. */
export interface Run {
  raids: number;
  ratio: number[];
  walls: Wall[];
  sieges: number;
  sorties: number;
  sortieWins: number;
  siegeFalls: number;
  lost: number;
  half: number;
  armyEnd: number;
  hired: number;
  losses: number[];
  /** Окно голода каждой осады в минуту, когда лагерь встал, мс. */
  hunger: number[];
}

/** Крючки прибора: отчёт смотрит на прогон, но прогон от этого не меняется. */
export interface Watch {
  /** Слепок перед пульсом: отчёт может подменить в нём число. */
  profile?: (p: PlayerProfile, g: GameState, away: Away) => void;
  /** Последствие до того, как оно легло в племя. `now` — мс от начала прогона. */
  effect?: (e: HomeEffect, now: number) => void;
  /** Последствие после того, как легло. */
  landed?: (e: HomeEffect, g: GameState) => void;
  /** После каждого решения игрока. */
  decided?: (g: GameState, l: Ledger) => void;
  /** После каждого пульса, до ответа на осаду: здесь отчёт ведёт полководца. */
  after?: (x: { g: GameState; world: LocalWorld; now: number; marches: MarchView[]; figures: FigureView[]; pulse: WorldPulse }) => Promise<void> | void;
  /** Перед вылазкой: кто выходит. */
  sortie?: (home: TroopStack) => void;
  hourly?: (h: number, g: GameState) => void;
}

/** Мир с племенем и пульсом — открытый, для отчёта, который ведёт время сам (стенд боя у стены). */
export interface OpenSky {
  world: LocalWorld;
  run: Run;
  now(): number;
  at(t: number): void;
  marches(): MarchView[];
  figures(): FigureView[];
  pulse(): Promise<WorldPulse>;
}

export function openSky(g: GameState, sky: Sky, watch: Watch = {}): OpenSky {
  let now = START;
  const world = new LocalWorld({ seed: sky.seed, now: () => now, storage: memory(), reveal: sky.reveal });
  const w: Inside = world;
  sky.setup?.(w);
  const run: Run = { raids: 0, ratio: [], walls: [], sieges: 0, sorties: 0, sortieWins: 0, siegeFalls: 0, lost: 0, half: 0, armyEnd: 0, hired: 0, losses: [], hunger: [] };
  const step = sky.step ?? GAME;

  const schedule = w.scheduleAi.bind(w);
  w.scheduleAi = (at: number) => {
    if (!sky.raids) return;
    const before = new Set(w.save.marches.map((m: Inside) => m.id));
    const profile: PlayerProfile | undefined = w.save.profile;
    // Без защиты: логово замечает город любой величины. Жители подменяются только на время
    // решения «выходить ли» — сила набега ниже пересчитывается по настоящим.
    const pop = profile?.pop ?? 0;
    if (!step.shield && profile) profile.pop = Math.max(pop, shieldVillagers(1));
    schedule(at);
    if (profile) profile.pop = pop;
    for (const m of w.save.marches) {
      if (before.has(m.id) || m.own || m.targetId !== HOME_ID) continue;
      if (step.rho !== null || !step.shield) {
        const src = w.gen.settlements.find((s: GenSettlement) => s.id === m.fromId);
        const shield = step.shield ? lairShield(pop) : 1;
        m.power = Math.max(2, (w.powerNow(src, at) * (step.rho ?? LAIR_STEP) * shield) / LAIR_STEP);
        m.units = { warrior: Math.max(1, Math.round(m.power / 3)) };
      }
      run.raids++;
      const d = sky.ref ?? profile?.defense ?? 0;
      if (d > 0) run.ratio.push(m.power / d);
    }
  };
  if (sky.ripe) w.save.createdAt = START - LAIR_RIPE;

  let marches: MarchView[] = [];
  let figures: FigureView[] = [];
  let homeBefore = 0;
  const seen = new Set<number>();
  const pulse = async (): Promise<WorldPulse> => {
    const p = await tribePulse(
      world,
      { get: () => g, apply: (change) => change(g) },
      { marches, figures },
      {
        profile: (prof, away) => {
          homeBefore = troopTotal(homeOf(g.army, away));
          watch.profile?.(prof, g, away);
        },
        before: (e, at) => watch.effect?.(e, at - START),
        after: (e, s) => {
          const lost = troopTotal(e.lostTroops ?? {});
          run.lost += lost;
          const at = now - START;
          if (e.id.endsWith('-defense') && e.battle) {
            run.walls.push({ held: e.battle === 'won', home: homeBefore, lost, at });
            if (e.battle === 'lost') run.losses.push(at);
          }
          if (e.id.endsWith('-fell')) {
            run.siegeFalls++;
            run.losses.push(at);
          }
          if (e.id.startsWith('sortie') && e.id.endsWith('-eff')) {
            run.sorties++;
            if (e.battle === 'won') run.sortieWins++;
          }
          watch.landed?.(e, s);
        },
      },
    );
    run.sieges += p.reports.filter((r) => r.kind === 'defense' && !r.battle && r.id.endsWith('-siege')).length;
    const open = w.save.sieges[HOME_ID];
    if (open && (open.sinceAt ?? open.startedAt) === open.startedAt && !seen.has(open.startedAt)) {
      seen.add(open.startedAt);
      run.hunger.push(starvesAt(open) - open.startedAt);
    }
    marches = p.marches;
    figures = p.figures;
    return p;
  };
  return {
    world,
    run,
    now: () => now,
    at: (t) => {
      now = t;
    },
    marches: () => marches,
    figures: () => figures,
    pulse,
  };
}

/** Прогон игрока в мире. */
export interface Flight {
  g: GameState;
  /** Срок прогона — **игровых** секунд: столько проживает племя; мир за это время проживает `realMs(seconds)`. */
  seconds: number;
  player: Player;
  world: Sky;
  /**
   * `live` — посёлок живёт шагом игры при игроке (`tick`), и игрок решает. `frozen` — посёлок мерки
   * стоит: уровни, склад и войско такие, какими их поставил отчёт; мир и пульс идут, игрок только
   * отвечает на осаду.
   */
  economy: 'live' | 'frozen';
  /** Шаг симуляции, с. */
  tick: number;
  /** Как часто игрок решает, с; кратно шагу. */
  decide: number;
  /** Войско держат полным между пульсами — граница «сколько стоит бой», а не найм. */
  refill?: boolean;
  /** Остановить прогон раньше срока: проверяется после каждого пульса. */
  until?: (g: GameState) => boolean;
  watch?: Watch;
}

/**
 * Во что обошёлся прогон машине, мс настоящего времени: шаг племени, решения игрока и пульс мира порознь.
 * Прибор `time:report` («цена живого прогона»): от того, что из трёх держит цену, зависит, во сколько
 * обойдётся перемер после поворота шкалы времени (docs/time.md, раздел 6). На ход прогона не влияет.
 */
export interface Cost {
  tick: number;
  decide: number;
  pulse: number;
  ticks: number;
  pulses: number;
}

export interface Flown {
  run: Run;
  ledger: Ledger;
  world: LocalWorld;
  g: GameState;
  cost: Cost;
}

/** Пол пульса мира в отчётах, настоящих секунд. */
export const PULSE_FLOOR = 60;

let noted = false;
/** Строка о единицах — один раз на процесс, и только когда игровой день не равен настоящей минуте. */
function unitsNote(): void {
  if (noted || timeScale() === 1) return;
  noted = true;
  console.log(`[единицы] шкала времени ×${timeScale()}: «мин» в этом отчёте — игровой день (${realSeconds(DAY_LENGTH) / 60} настоящих минут), «ч» — 60 игровых дней (${realSeconds(DAY_LENGTH)  / 60} настоящих часов); срок прогона задан игровым временем.`);
}

export async function pilot(o: Flight): Promise<Flown> {
  unitsNote();
  const { g, player: p } = o;
  const watch = o.watch ?? {};
  const l = ledger();
  if (p.tax) g.tax = p.tax;
  const sky = openSky(g, o.world, watch);
  const w: Inside = sky.world;
  const full = { ...g.army };
  // Пульс мира в отчётах — не чаще раза в настоящую минуту. После поворота шкалы тот же срок прогона — в
  // тридцать раз больше настоящих секунд мира, и родной пульс отчётов (15–30 с) стоил бы приёмке втрое-
  // вчетверо дороже; замером (`raid-growth` при ×30, пульс 30 против 60 — docs/time.md, раздел 17) выводы те же.
  // В игровом времени минута — две игровые секунды: мельче, чем пульс отчётов был до поворота.
  // PULSE — ручка замера, а не приёмки: ею пульс ставят любым.
  const pulseSec = Number(process.env.PULSE) > 0 ? Number(process.env.PULSE) : Math.max(o.world.pulse, PULSE_FLOOR);
  const pulseMs = pulseSec * 1000;
  const run = sky.run;

  const cost: Cost = { tick: 0, decide: 0, pulse: 0, ticks: 0, pulses: 0 };
  const beat = async (): Promise<WorldPulse> => {
    if (o.refill) Object.assign(g.army, full);
    const t0 = performance.now();
    const p = await sky.pulse();
    cost.pulse += performance.now() - t0;
    cost.pulses++;
    return p;
  };

  await beat();
  if (o.world.ripe) w.save.createdAt = START - LAIR_RIPE;
  const start = armySize(g);
  let lastSortie = 0;
  let hour = 1;
  let clock = 0;
  let owed = 0;
  // Срок прогона — игровое время: столько племя проживает, а настоящих секунд мира на это уходит по двери.
  while (sky.now() < START + realMs(o.seconds)) {
    sky.at(sky.now() + pulseMs);
    if (o.economy === 'live') {
      // Пульс мира — настоящие секунды, шаг племени — игровые: сколько племя должно прожить за
      // пульс, говорит дверь времени (`game/pace`). Остаток меньше шага переходит следующему пульсу.
      for (owed += gameSeconds(pulseSec); owed >= o.tick; owed -= o.tick) {
        if (clock % o.decide === 0) {
          const d0 = performance.now();
          decide(g, p, l);
          cost.decide += performance.now() - d0;
          watch.decided?.(g, l);
        }
        const t0 = performance.now();
        tick(g, o.tick);
        cost.tick += performance.now() - t0;
        cost.ticks++;
        clock += o.tick;
      }
      // Вести приходят по настоящим часам мира — окно этого пульса (`sim/mail.mailArrive`), как в игре.
      mailArrive(g, sky.now() - pulseMs, sky.now());
      // И сроки донесений идут теми же часами: мятеж без ответа разрешается почтой, а не шагом.
      mailStep(g, sky.now());
    }
    const pl = await beat();
    const now = sky.now();
    await watch.after?.({ g, world: sky.world, now: now - START, marches: sky.marches(), figures: sky.figures(), pulse: pl });
    if (start > 0 && armySize(g) < start / 2) run.half += pulseMs;
    if (pl.siege) {
      const home = homeOf(g.army, awayOf(sky.marches(), sky.figures()));
      if (p.siegeLevy) {
        const camp = w.save.marches.find((m: Inside) => m.id === w.save.sieges[HOME_ID]?.campId);
        const want = camp ? Math.ceil(camp.power) : 0;
        const have = troopTotal(home) + g.recruits.reduce((n, r) => n + r.count - r.done, 0);
        const n = Math.min(want - have, idleCount(g));
        if (n > 0 && startRecruit(g, 'clubman', n) === null) run.hired += n;
      }
      if (p.sortie && now - lastSortie > 5 * MIN && troopTotal(home) > 0) {
        watch.sortie?.(home);
        await sky.world.sortie(home);
        lastSortie = now;
      }
    }
    if (watch.hourly && now - START >= hour * HOUR) {
      watch.hourly(hour, g);
      hour++;
    }
    if (o.until?.(g)) break;
  }
  countDeserted(g, l);
  countMutinyEnd(g, l);
  run.armyEnd = armySize(g);
  return { run, ledger: l, world: sky.world, g, cost };
}

// ---------- Без игрока ----------

/**
 * Стенд правила: время идёт на подготовленном посёлке шагом игры при игроке, никто ничего не решает,
 * мира нет. `before` — что отчёт кладёт в посёлок перед шагом (номер шага `i`), `after` — что он
 * читает после; `true` из `after` останавливает стенд.
 */
export function stand(
  g: GameState,
  o: { dt: number; steps: number; before?: (g: GameState, i: number) => void; after?: (g: GameState, i: number) => boolean | void },
): void {
  for (let i = 0; i < o.steps; i++) {
    o.before?.(g, i);
    tick(g, o.dt);
    if (o.after?.(g, i) === true) return;
  }
}

/**
 * Новая партия, сыгранная общим автопилотом `hours` часов в тихом мире (без набегов), и расставленная
 * `autoAssign`: на ней отчёты меряют, что посёлок добывает сам. Одна на `lair:report` и `sack:report` —
 * прежде у каждого была своя копия, и обе играли офлайн-догоном без решений.
 */
export async function playedFor(hours: number): Promise<GameState> {
  // Сид партии закреплён: живая игра поднимает события, а их кость — от `s.seed`. Без сида партия бралась
  // от `freshSeed`, и выработка через два часа плавала от прогона к прогону на десятую долю.
  const s = createInitialState(7);
  autoAssign(s);
  if (hours > 0) {
    await pilot({
      g: s,
      seconds: hours * 3600,
      player: player(null),
      world: { seed: 7, pulse: 15, raids: false },
      economy: 'live',
      tick: 1,
      decide: 15,
    });
  }
  autoAssign(s);
  return s;
}

/** Игрок ушёл на `seconds` **игровых** секунд: офлайн-догон шагом `step`, как при возвращении в игру. */
export function away(g: GameState, seconds: number, step: number): void {
  catchUp(g, seconds, step);
}

/**
 * Игрок ушёл в настоящую минуту `since` и вернулся в `now`: дверь отлучки как в игре (`sim/tick.absence`) —
 * догон под потолком, терпение и уход войска, ропот, вести.
 */
export function gone(g: GameState, since: number, now: number): void {
  absence(g, since, now);
}

/** Последствие без мира: отчёт прикладывает участь к копии посёлка. */
export function land(g: GameState, effects: HomeEffect[]): void {
  applyEffects(g, effects);
}
