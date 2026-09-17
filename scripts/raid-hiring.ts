// Найм — раздел `raid:report`.
//
// Все прежние замеры роста логова (`raid-lair-growth.ts`, docs/lair_growth.md) держали войско мерки
// полным даром: убитые возвращались между пульсами, казна и склад не платили ничего, а посёлок
// не жил вовсе — ни выработки, ни жалованья, ни еды. Раздел меряет то же самое с игроком, который
// **нанимает**: платит ресурсами найма, снаряжением из кузницы, свободными руками, временем казарм,
// жалованьем из казны и едой — шагом самой игры (`tick`), при игроке. Прогон тот же — `play` из
// раздела роста логова, — поэтому столбцы сравниваются с его таблицами напрямую.
//
// Поведения (у каждого — свои числа, усреднять их нельзя, это разные игроки):
//
//  - **по средствам** — войско не дороже, чем тянет казна: жалованье после найма не больше дохода
//    казны; казна пуста, а жалованье больше дохода — распускает лишних;
//  - **по средствам, высокий налог** — то же при высоком налоге: так держит войско тот, кто воюет;
//  - **всё, что прокормит** — нанимает, пока еды приходит не меньше, чем уходит (сезон нынешний),
//    о казне не думает; не распускает;
//  - **строит** — не пополняет войско, на лагерь нанимает дубинщиков (`play.hire`, как новичок
//    «нанимает на осаду»); в партии с первой секунды — ещё и строит.
//
// Состав найма — мерка `MIX`, снаряжение — из кузницы: у нанимающих кузница укомплектована
// целиком, заказ — на недостачу, но не дальше `FORGE_AHEAD` работы вперёд (кузница берёт плату
// при заказе, и заказ на тысячу мечей молча опустошил бы склад). Лимиты — **замером**: число
// бойцов проверяется настоящими `wagesPerDay`, `taxIncomePerDay`, `productionPerDay` и
// `foodConsumptionPerDay` на том же посёлке с этими бойцами, а не своей арифметикой.
//
// События: автопилот раздела роста логова на события не отвечал, и первое же висело на столе до
// конца прогона. Мятеж поднимается только на пустой стол, поэтому здесь на событие отвечают
// первым бесплатным вариантом (он есть у каждого — тест `data/events.test.ts`), а на мятеж не
// отвечают: окно ждёт `MUTINY_ANSWER`, и стража выходит сама.
//
// Разделы:
//  А. Лестница мерки — посёлок уровня L живёт 4 ч, логова дозрели. Уровни построек стоят: мерка —
//     посёлок уровня L; строит игрок в разделе Б.
//  Б. Партия с первой секунды, 6 ч, строит каждый.
//  В. Уведённые люди: полководец с половиной войска берёт логова голодом на ступени «увести людей»,
//     дома нанимают по средствам; что это делает с руками, порядком и мятежом за 6 ч.
import type { EquipmentId, GameState, ResourceId, TroopId } from '@/game/types';
import type { FigureView, HomeEffect } from '@/world/types';
import { HOME_ID, type LocalWorld } from '@/world/local/LocalWorld';
import { awayOf, homeOf } from '@/world/muster';
import { lairArmsBase, lairPop, lairPower, lairShield } from '@/world/lairs';
import { LAIR_ANCHOR_MID, LAIR_POWER_BASE, LAIR_POWER_PER_LEVEL, LAIR_RIPE, LAIR_STEP, SIEGE_IMMUNE } from '@/world/data/tuning';
import { troopTotal, type TroopStack } from '@/game/battle/kinds';
import { startRecruit, recruitCost } from '@/game/sim/army';
import { forgeCost, startForge } from '@/game/sim/smithy';
import { dismissSoldiers } from '@/game/sim/upkeep';
import { assignBonded, assignWorker } from '@/game/sim/workers';
import { releaseBonded } from '@/game/sim/mutiny';
import { resolveEvent } from '@/game/sim/actions';
import { EVENT_BY_ID } from '@/game/data/events';
import { MUTINY_EVENT } from '@/game/data/order';
import { TROOP_BY_ID, TROOP_IDS } from '@/game/data/troops';
import { EQUIPMENT_IDS, EQUIPMENT_BY_ID } from '@/game/data/equipment';
import { createInitialState } from '@/game/state';
import { seeded, setRandom } from '@/game/sim/random';
import { ORDER_UNREST, ORDER_WARN, RESOURCE_IDS } from '@/game/constants';
import {
  armySize,
  bondedIdle,
  bondedTotal,
  buildingOfType,
  buildingSlots,
  defense,
  foodConsumptionPerDay,
  forgeRate,
  handsCount,
  idleCount,
  orderBreakdown,
  payGraceDays,
  productionPerDay,
  takesBonded,
  taxIncomePerDay,
  upkeepInfo,
  wageOf,
  wagesPerDay,
} from '@/game/derived';
import { build, staff } from './autopilot';
import {
  GAME,
  MIN,
  MIX,
  NEW_SEEDS,
  SEEDS,
  START,
  hm,
  mean,
  pad,
  pct,
  play,
  q,
  sum,
  tally,
  townAt,
  type Inside,
  type Run,
  type Step,
} from './raid-lair-growth';

/** Кузница заказывает недостачу, но не дальше стольких минут своей работы вперёд. */
const FORGE_AHEAD = 10 * MIN;

type Style = 'means' | 'meansHigh' | 'feed' | 'builder';
const STYLES: Style[] = ['means', 'meansHigh', 'feed', 'builder'];
const NAME: Record<Style, string> = {
  means: 'по средствам',
  meansHigh: 'по средствам, высокий налог',
  feed: 'всё, что прокормит',
  builder: 'строит',
};

/** Что остановило найм на этом пульсе. */
type Stop = 'цель' | 'казна' | 'еда' | 'руки' | 'снаряжение' | 'ресурсы';

const queued = (g: GameState, id: TroopId): number =>
  g.recruits.filter((r) => r.troop === id).reduce((n, r) => n + r.count - r.done, 0);

/**
 * Держит ли посёлок ещё `n` бойцов вида `id` сверх нынешних и стоящих в очереди. Проверяется
 * замером: бойцы кладутся в состояние, читаются функции игры, состояние возвращается.
 */
function affords(g: GameState, style: Style, id: TroopId, n: number): Stop | null {
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

interface Ledger {
  hired: number;
  dismissed: number;
  deserted: number;
  /** Причины ухода по пульсам, где войско уходило. */
  whyPay: number;
  whyFood: number;
  spent: number;
  /** Ресурсы найма и ковки по видам. */
  spentBy: Partial<Record<ResourceId, number>>;
  stops: Partial<Record<Stop, number>>;
  wages: number[];
  income: number[];
  debt: number;
  armyHome: number[];
  /** Жители и оборона посёлка по пульсам. */
  pops: number[];
  defs: number[];
  /** Восстановление после удержанного боя: сколько мс до прежнего числа дома; null — не успели. */
  restore: { at: number; target: number; lost: number; done: number | null; cost: number }[];
  mutinies: number;
  mutinyHeld: number;
  seenLog: WeakMap<object, number>;
  lastMutiny: number;
}

const ledger = (): Ledger => ({
  hired: 0,
  dismissed: 0,
  deserted: 0,
  whyPay: 0,
  whyFood: 0,
  spent: 0,
  spentBy: {},
  stops: {},
  wages: [],
  income: [],
  debt: 0,
  armyHome: [],
  pops: [],
  defs: [],
  restore: [],
  mutinies: 0,
  mutinyHeld: 0,
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

/** Сколько добра стоит один боец вида целиком: припас найма и снаряжение по цене ковки. */
const unitCost = (id: TroopId): number => {
  let n = sum(Object.values(recruitCost(id, 1)).map((v) => v ?? 0));
  for (const [item, per] of Object.entries(TROOP_BY_ID[id].gear)) {
    n += (per ?? 0) * sum(Object.values(forgeCost(item as EquipmentId, 1)).map((v) => v ?? 0));
  }
  return n;
};

/** Сколько бойцов каждого вида хочет мерка при общем числе `n`: та же раскладка, что у `townAt`. */
function wantOf(n: number): TroopStack {
  const out: TroopStack = {};
  const ids = Object.keys(MIX) as TroopId[];
  const whole = sum(ids.map((id) => MIX[id] ?? 0));
  let left = n;
  ids.forEach((id, i) => {
    const k = i === ids.length - 1 ? left : Math.round((n * (MIX[id] ?? 0)) / whole);
    out[id] = k;
    left -= k;
  });
  return out;
}

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

/** Нанять по поведению; что остановило найм, ложится в `l.stops`. */
function hire(g: GameState, style: Style, l: Ledger): void {
  if (style === 'builder') return;
  // Цель — всё, что пустит лимит: сперва недостача мерки по видам, потом ещё круг.
  const total = armySize(g) + TROOP_IDS.reduce((n, id) => n + queued(g, id), 0);
  const want = wantOf(total + Math.max(10, Math.round(total * 0.25)));
  let stop: Stop = 'цель';
  for (const id of Object.keys(MIX) as TroopId[]) {
    const deficit = Math.max(0, (want[id] ?? 0) - g.army[id] - queued(g, id));
    if (deficit <= 0) continue;
    const def = TROOP_BY_ID[id];
    let n = Math.min(deficit, idleCount(g));
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
    for (const id of Object.keys(MIX) as TroopId[]) {
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
function trim(g: GameState, style: Style, l: Ledger): void {
  if (style !== 'means' && style !== 'meansHigh') return;
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

/** Ответить на событие первым бесплатным вариантом; мятеж ждёт своего срока. */
function answer(g: GameState, l: Ledger): void {
  const ev = g.activeEvent;
  if (!ev) return;
  if (ev.defId === MUTINY_EVENT) {
    if (l.lastMutiny !== ev.at) {
      l.lastMutiny = ev.at;
      l.mutinies++;
    }
    return;
  }
  const def = EVENT_BY_ID[ev.defId];
  const i = def ? def.options.findIndex((o) => !o.cost) : -1;
  resolveEvent(g, Math.max(0, i));
}

/** Сколько ушло голодом и неуплатой с прошлого раза — по строкам летописи со склейкой. */
function countDeserted(g: GameState, l: Ledger): void {
  for (const e of g.log) {
    if (!e.group?.startsWith('desert:')) continue;
    const n = e.n ?? 1;
    const seen = l.seenLog.get(e) ?? 0;
    if (n > seen) l.deserted += n - seen;
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

interface Out {
  run: Run;
  l: Ledger;
  g: GameState;
}

interface Opts {
  g: GameState;
  seed: number;
  style: Style;
  step?: Step;
  hours: number;
  ripe: boolean;
  ref?: number;
  grow?: (g: GameState) => void;
  hourly?: (h: number, g: GameState) => void;
  effect?: (e: HomeEffect, now: number) => void;
  after?: (x: { g: GameState; world: LocalWorld; now: number; figures: FigureView[] }) => Promise<void>;
}

async function live(o: Opts): Promise<Out> {
  const { g, style } = o;
  const l = ledger();
  if (style === 'meansHigh') g.tax = 'high';
  const run = await play({
    g,
    seed: o.seed,
    step: o.step ?? GAME,
    hours: o.hours,
    ref: o.ref,
    ripe: o.ripe,
    hire: style === 'builder',
    grow: (x) => {
      countDeserted(x, l);
      countMutinyEnd(x, l);
      answer(x, l);
      staff(x);
      o.grow?.(x);
      if (style !== 'builder') staffSmithy(x);
      trim(x, style, l);
      hire(x, style, l);
      const u = upkeepInfo(x);
      if (u.leavingPerDay > 0) {
        if (u.why === 'food') l.whyFood++;
        else l.whyPay++;
      }
      l.wages.push(u.wages);
      l.pops.push(x.pop);
      l.defs.push(defense(x));
      l.income.push(u.income);
    },
    hourly: o.hourly,
    effect: (e, now) => {
      o.effect?.(e, now);
      if (e.id.endsWith('-defense') && e.battle === 'won') {
        const lost = e.lostTroops ?? {};
        const n = troopTotal(lost);
        if (n > 0) {
          const cost = sum((Object.entries(lost) as [TroopId, number][]).map(([id, k]) => k * unitCost(id)));
          l.restore.push({ at: now, target: -n, lost: n, done: null, cost });
        }
      }
    },
    after: async ({ g: x, world, now, marches, figures }) => {
      const home = troopTotal(homeOf(x.army, awayOf(marches, figures)));
      l.armyHome.push(home);
      for (const r of l.restore) {
        // Цель — сколько было дома до боя: потерянные плюс оставшиеся в минуту, когда бой лёг.
        if (r.target < 0 && r.at <= now) r.target = home + r.lost;
        else if (r.done === null && r.target > 0 && home >= r.target) r.done = now - r.at;
      }
      await o.after?.({ g: x, world, now, figures });
    },
  });
  countDeserted(g, l);
  countMutinyEnd(g, l);
  l.debt = g.pay.debt;
  return { run, l, g };
}

// ---------- Печать ----------

const fmtStops = (l: Ledger[]): string => {
  const all: Partial<Record<Stop, number>> = {};
  for (const x of l) for (const [k, v] of Object.entries(x.stops)) all[k as Stop] = (all[k as Stop] ?? 0) + (v ?? 0);
  const whole = sum(Object.values(all).map((v) => v ?? 0));
  if (whole <= 0) return '—';
  return (Object.entries(all) as [Stop, number][])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k} ${pct(v / whole)}`)
    .join(', ');
};

const minutes = (xs: number[]): string =>
  xs.length ? `${Math.round(q(xs, 0.1) / MIN)}…${Math.round(q(xs, 0.5) / MIN)}…${Math.round(q(xs, 0.9) / MIN)} мин` : '—';

function restoreLine(outs: Out[]): { n: number; done: string; late: number; gap: string; before: string; cost: string } {
  const rows: { done: number | null; gap: number | null; cost: number; lost: number }[] = [];
  for (const o of outs) {
    const times = [...o.run.walls.map((w) => w.at)].sort((a, b) => a - b);
    for (const r of o.l.restore) {
      const next = times.find((t) => t > r.at) ?? null;
      rows.push({ done: r.done, gap: next === null ? null : next - r.at, cost: r.cost, lost: r.lost });
    }
  }
  const done = rows.filter((r) => r.done !== null).map((r) => r.done as number);
  const withGap = rows.filter((r) => r.gap !== null);
  const before = withGap.filter((r) => r.done !== null && (r.done as number) <= (r.gap as number)).length;
  return {
    n: rows.length,
    done: minutes(done),
    late: rows.length - done.length,
    gap: minutes(withGap.map((r) => r.gap as number)),
    before: withGap.length ? `${before} из ${withGap.length}` : '—',
    cost: rows.length ? `${Math.round(q(rows.map((r) => r.cost), 0.5))} (${Math.round(q(rows.map((r) => r.lost), 0.5))} бойцов)` : '—',
  };
}

export async function hiringSection(): Promise<void> {
  console.log('');
  console.log('=== Найм: игрок, который платит за войско ===');
  console.log('Прогон — play раздела «Рост логова», мир как есть. Посёлок живёт шагом игры (tick) при игроке: выработка, еда, налог, жалованье, уход войска.');
  console.log('Поведения: «по средствам» — жалованье после найма не больше дохода казны, казна пуста и жалованье больше дохода — распускает;');
  console.log('«по средствам, высокий налог» — то же при высоком налоге; «всё, что прокормит» — нанимает, пока еды приходит не меньше, чем уходит (сезон нынешний),');
  console.log('о казне не думает и не распускает; «строит» — не пополняет войско, на лагерь нанимает дубинщиков (как новичок «нанимает на осаду»).');
  console.log(`Состав найма — MIX мерки, снаряжение — из кузницы (у нанимающих укомплектована целиком, заказ на недостачу не дальше ${FORGE_AHEAD / MIN} мин работы вперёд).`);
  console.log('Лимиты — замером: бойцы кладутся в состояние, читаются wagesPerDay, taxIncomePerDay, productionPerDay, foodConsumptionPerDay, состояние возвращается.');
  console.log('На события отвечают первым бесплатным вариантом; на мятеж не отвечают — стража выходит сама по сроку.');

  // А. Лестница.
  const HOURS = 4;
  const LEVELS = [7, 8, 10];
  console.log('');
  console.log(`--- А. Лестница мерки: ${HOURS} ч на каждом из ${SEEDS.length} миров, посёлок уровня L живёт, уровни построек стоят, логова дозрели ---`);
  console.log('Цена мерки: войско мерки против казны посёлка мерки в первую минуту (умеренный налог, как у новой партии):');
  console.log(' ур  жителей  войско  жалованье/день  доход казны/день  жалованье к доходу  терпение Статуи, дн.');
  for (const level of LEVELS) {
    const g = townAt(level);
    console.log(
      ` ${pad(level, 2)}  ${pad(g.pop, 7)}  ${pad(armySize(g), 6)}  ${pad(Math.round(wagesPerDay(g)), 14)}  ${pad(Math.round(taxIncomePerDay(g)), 16)}  ${pad(pct(wagesPerDay(g) / taxIncomePerDay(g)), 18)}  ${pad(payGraceDays(g), 20)}`,
    );
  }
  console.log('Столбцы — как в разделе 2 выше; «даром» — строка «игра» оттуда же (войско держат полным даром, посёлок не живёт).');
  console.log('«нанято» — ушло в казармы (у «строит» — дубинщики на лагерь); «ушло» — ушло голодом или неуплатой (дверь содержания); «распущено» — по средствам; «жалованье к доходу» — среднее по пульсам.');
  console.log(' поведение                    ур  жителей в конце  набегов  набег / оборона  у стены  прорвали  лагерей  доля осад  вылазки   падений осадой  падений/ч  потери, удержали  < половины  войско дома: медиана  в конце  нанято  ушло  распущено  жалованье к доходу  долг в конце  найм встал на');
  const ladder: Record<string, Out[]> = {};
  for (const level of LEVELS) {
    const ref = defense(townAt(level));
    for (const style of STYLES) {
      const outs: Out[] = [];
      for (const seed of SEEDS) outs.push(await live({ g: townAt(level), seed, style, hours: HOURS, ripe: true, ref }));
      ladder[`${style}:${level}`] = outs;
      const t = tally(
        outs.map((o) => o.run),
        HOURS,
      );
      const l = outs.map((o) => o.l);
      console.log(
        ` ${NAME[style].padEnd(27)} ${pad(level, 2)}  ${pad(Math.round(mean(outs.map((o) => o.g.pop))), 15)}  ${pad(t.raids, 7)}  ${pad(t.ratio, 15)}  ${pad(t.walls, 7)}  ${pad(t.broke, 8)}  ${pad(t.sieges, 7)}  ${pad(t.siegeShare, 9)}  ${pad(t.sorties, 8)}  ${pad(t.falls, 14)}  ${pad(t.perHour, 9)}  ${pad(t.held, 16)}  ${pad(t.half, 10)}  ${pad(Math.round(q(l.flatMap((x) => x.armyHome), 0.5)), 20)}  ${pad(t.armyEnd, 7)}  ${pad(sum(l.map((x) => x.hired)) + t.hired, 6)}  ${pad(sum(l.map((x) => x.deserted)), 4)}  ${pad(sum(l.map((x) => x.dismissed)), 9)}  ${pad(pct(mean(l.map((x) => mean(x.wages) / Math.max(1, mean(x.income))))), 18)}  ${pad(Math.round(mean(l.map((x) => x.debt))), 12)}  ${fmtStops(l)}`,
      );
    }
  }

  console.log('');
  console.log('Успевает ли найм за потерями: удержанный бой с потерями → сколько до прежнего числа бойцов дома; «промежуток» — до следующего боя у стены;');
  console.log('«цена боя» — медиана добра на павших (припас найма и снаряжение по цене ковки) и число павших.');
  console.log(' поведение                    ур  боёв с потерями  восстановление, 10-я…медиана…90-я  не успели к концу  промежуток до следующего  успели до следующего  цена боя, добра');
  for (const level of LEVELS) {
    for (const style of STYLES) {
      const r = restoreLine(ladder[`${style}:${level}`]);
      console.log(
        ` ${NAME[style].padEnd(27)} ${pad(level, 2)}  ${pad(r.n, 15)}  ${pad(r.done, 33)}  ${pad(r.late, 17)}  ${pad(r.gap, 24)}  ${pad(r.before, 20)}  ${r.cost}`,
      );
    }
  }
  console.log('');
  console.log('Во что обходится войско за час на мир: добро на найм и ковку, по видам (медиана миров не берётся — сумма, делённая на миры и часы).');
  console.log(' поведение                    ур  добра/ч  из них: еда  дерево  камень  железо  медь  шкуры  кости  уход войска по поводу: неуплата / голод (пульсов)');
  for (const level of LEVELS) {
    for (const style of STYLES) {
      const l = ladder[`${style}:${level}`].map((o) => o.l);
      const per = (r: ResourceId): number => Math.round(sum(l.map((x) => x.spentBy[r] ?? 0)) / (l.length * HOURS));
      console.log(
        ` ${NAME[style].padEnd(27)} ${pad(level, 2)}  ${pad(Math.round(sum(l.map((x) => x.spent)) / (l.length * HOURS)), 7)}  ${pad(per('food'), 11)}  ${pad(per('wood'), 6)}  ${pad(per('stone'), 6)}  ${pad(per('iron'), 6)}  ${pad(per('copper'), 4)}  ${pad(per('hides'), 5)}  ${pad(per('bones'), 5)}  ${sum(l.map((x) => x.whyPay))} / ${sum(l.map((x) => x.whyFood))}`,
      );
    }
  }

  // Ступень под наймом.
  const STEP_LEVELS = [8, 10];
  const STEP_STYLES: Style[] = ['means', 'meansHigh'];
  console.log('');
  console.log('Ступень под наймом: та же подстановка, что в разделе 2 (сила вышедшего набега пересчитана в минуту выхода), защита новичка оставлена.');
  console.log(`Строка ${LAIR_STEP.toFixed(2)} — игра, взята из таблицы выше.`);
  console.log(' поведение                    ступень  ур  набегов  набег / оборона  у стены  прорвали  лагерей  доля осад  падений осадой  падений/ч  потери, удержали  войско дома: медиана  ушло');
  for (const level of STEP_LEVELS) {
    const ref = defense(townAt(level));
    for (const style of STEP_STYLES) {
      for (const rho of [0.8, LAIR_STEP, 1]) {
        let outs = ladder[`${style}:${level}`];
        if (rho !== LAIR_STEP) {
          outs = [];
          const step: Step = { name: rho.toFixed(2), rho, shield: true };
          for (const seed of SEEDS) outs.push(await live({ g: townAt(level), seed, style, step, hours: HOURS, ripe: true, ref }));
        }
        const t = tally(
          outs.map((o) => o.run),
          HOURS,
        );
        const l = outs.map((o) => o.l);
        console.log(
          ` ${NAME[style].padEnd(27)} ${pad(rho.toFixed(2), 7)}  ${pad(level, 2)}  ${pad(t.raids, 7)}  ${pad(t.ratio, 15)}  ${pad(t.walls, 7)}  ${pad(t.broke, 8)}  ${pad(t.sieges, 7)}  ${pad(t.siegeShare, 9)}  ${pad(t.falls, 14)}  ${pad(t.perHour, 9)}  ${pad(t.held, 16)}  ${pad(Math.round(q(l.flatMap((x) => x.armyHome), 0.5)), 20)}  ${pad(sum(l.map((x) => x.deserted)), 4)}`,
        );
      }
    }
  }

  // Мерка «жители» против лестницы под наймом.
  console.log('');
  console.log('Мерка «жители» против лестницы под наймом: жители — медиана по пульсам; набег по жителям — lairPower дозревшего логова медианной опоры');
  console.log(`(× lairShield); по уровню — ступень × (${LAIR_POWER_PER_LEVEL} × L + ${LAIR_POWER_BASE}), как в разделе 1; оборона — медиана по пульсам, мерка — defense посёлка мерки.`);
  console.log(' поведение                    ур  жителей: мерка  медиана  набег по жителям  по уровню  жители к уровню  оборона: мерка  медиана');
  for (const level of LEVELS) {
    const ref = townAt(level);
    const byLevel = LAIR_STEP * (LAIR_POWER_PER_LEVEL * level + LAIR_POWER_BASE);
    for (const style of STYLES) {
      const l = ladder[`${style}:${level}`].map((o) => o.l);
      const pop = q(l.flatMap((x) => x.pops), 0.5);
      const raid = lairPower(LAIR_ANCHOR_MID, { bornAt: 0, burnedAt: 0 }, LAIR_RIPE, pop) * lairShield(pop);
      console.log(
        ` ${NAME[style].padEnd(27)} ${pad(level, 2)}  ${pad(ref.pop, 14)}  ${pad(pop, 7)}  ${pad(Math.round(raid), 16)}  ${pad(Math.round(byLevel), 9)}  ${pad(pct(raid / byLevel), 15)}  ${pad(Math.round(defense(ref)), 14)}  ${pad(Math.round(q(l.flatMap((x) => x.defs), 0.5)), 7)}`,
      );
    }
  }

  // Б. Партия с первой секунды.
  const NEW_HOURS = 6;
  const HOURS_AT = [1, 2, 4, 6];
  console.log('');
  console.log(`--- Б. Партия с первой секунды: ${NEW_HOURS} ч, миры ${NEW_SEEDS.join(', ')}, мир как есть, автопилот строит у всех ---`);
  console.log(' поведение                    набегов  набег / оборона  первое падение  прорвали  лагерей  падений осадой  падений/ч  нанято  ушло  распущено  бойцов потеряно  войско к 1/2/4/6 ч    люди к 1/2/4/6 ч      ср. уровень к 1/2/4/6 ч  найм встал на');
  for (const style of STYLES) {
    const outs: Out[] = [];
    const army: number[][] = [[], [], [], []];
    const pop: number[][] = [[], [], [], []];
    const lvl: number[][] = [[], [], [], []];
    for (const seed of NEW_SEEDS) {
      setRandom(seeded(seed));
      const g = createInitialState(seed);
      g.tutorialDone = true;
      outs.push(
        await live({
          g,
          seed,
          style,
          hours: NEW_HOURS,
          ripe: false,
          grow: (x) => build(x),
          hourly: (h, x) => {
            const i = HOURS_AT.indexOf(h);
            if (i < 0) return;
            army[i].push(armySize(x));
            pop[i].push(x.pop);
            lvl[i].push(sum(x.buildings.map((b) => b.level)) / x.buildings.length);
          },
        }),
      );
      setRandom(null);
    }
    const t = tally(
      outs.map((o) => o.run),
      NEW_HOURS,
    );
    const l = outs.map((o) => o.l);
    const first = t.first.length ? `${hm(Math.min(...t.first))}…${hm(Math.max(...t.first))}${t.first.length < outs.length ? ` (${t.first.length} из ${outs.length})` : ''}` : 'нет';
    const row = (xs: number[][], f: (v: number) => string): string => xs.map((v) => pad(f(mean(v)), 4)).join(' ');
    console.log(
      ` ${NAME[style].padEnd(27)} ${pad(t.raids, 7)}  ${pad(t.ratio, 15)}  ${pad(first, 14)}  ${pad(t.broke, 8)}  ${pad(t.sieges, 7)}  ${pad(t.falls, 14)}  ${pad(t.perHour, 9)}  ${pad(sum(l.map((x) => x.hired)) + t.hired, 6)}  ${pad(sum(l.map((x) => x.deserted)), 4)}  ${pad(sum(l.map((x) => x.dismissed)), 9)}  ${pad(t.lost, 15)}  ${row(army, (v) => String(Math.round(v))).padEnd(19)}  ${row(pop, (v) => String(Math.round(v))).padEnd(20)}  ${row(lvl, (v) => v.toFixed(1)).padEnd(23)}  ${fmtStops(l)}`,
    );
  }

  // В. Уведённые люди.
  await captivesPart();
}

// ---------- В. Уведённые люди ----------

interface Led {
  name: string;
  style: Style;
  fate: 'plunder' | 'captives';
  /** Доля уведённых, доходящая до дома: подстановка в последствие мира. 1 — игра. */
  share: number;
  /** Люди логова — от силы без жителей города (`lairArmsBase`): подстановка в экземпляр мира. */
  arms: boolean;
  /** Отпускает невольников, пока порядок ниже `ORDER_WARN`. */
  release: boolean;
}
const LEDS: Led[] = [
  { name: 'по средствам: увести людей — игра', style: 'means', fate: 'captives', share: 1, arms: false, release: false },
  { name: 'высокий налог: ограбить (без увода)', style: 'meansHigh', fate: 'plunder', share: 1, arms: false, release: false },
  { name: 'высокий налог: увести людей — игра', style: 'meansHigh', fate: 'captives', share: 1, arms: false, release: false },
  { name: 'высокий налог: увести людей, отпускает до порядка 50', style: 'meansHigh', fate: 'captives', share: 1, arms: false, release: true },
  { name: 'высокий налог: доходит половина уведённых', style: 'meansHigh', fate: 'captives', share: 0.5, arms: false, release: false },
  { name: 'высокий налог: доходит четверть уведённых', style: 'meansHigh', fate: 'captives', share: 0.25, arms: false, release: false },
  { name: 'высокий налог: доходит десятая часть уведённых', style: 'meansHigh', fate: 'captives', share: 0.1, arms: false, release: false },
  { name: 'высокий налог: люди логова без жителей', style: 'meansHigh', fate: 'captives', share: 1, arms: true, release: false },
];

interface Hourly {
  bonded: number[];
  work: number[];
  idle: number[];
  order: number[];
  pop: number[];
  prod: number[];
  army: number[];
}

async function captivesPart(): Promise<void> {
  const HOURS = 6;
  const LEVEL = 10;
  const SEEDS_C = NEW_SEEDS;
  console.log('');
  console.log(`--- В. Уведённые люди: посёлок мерки уровня ${LEVEL}, ${HOURS} ч, миры ${SEEDS_C.join(', ')}, логова молоды (мир начинается с прогоном, как в order:report) ---`);
  console.log('Полководец забирает половину войска дома и берёт голодом ближайшие логова одно за другим (как order:report, «война против хозяйства»);');
  console.log('дома нанимают по средствам; уведённых автопилот ставит на работы, где есть место для невольников. Набеги на дом идут как в игре.');
  console.log('«ограбить» — та же война без увода. Подстановки: «доходит доля» — в последствии мира уведённых столько-то от игры (осада и бой те же);');
  console.log('«люди логова без жителей» — люди логова от силы без жителей города (lairArmsBase — дверь оружия): меняет и амбар логова, то есть срок осады;');
  console.log('«отпускает» — игрок отпускает невольников, пока порядок ниже ORDER_WARN.');
  console.log(`Порядок: ропот ниже ${ORDER_UNREST}, тревога ниже ${ORDER_WARN}.`);
  const HOURS_AT = [1, 2, 4, 6];
  const summary: string[] = [];
  for (const variant of LEDS) {
    const hourly: Hourly[] = HOURS_AT.map(() => ({ bonded: [], work: [], idle: [], order: [], pop: [], prod: [], army: [] }));
    let led = 0;
    let released = 0;
    let unrestPulses = 0;
    let pulses = 0;
    let falls = 0;
    let sieges = 0;
    const outs: Out[] = [];
    for (const seed of SEEDS_C) {
      // Логово, у которого стояли, вычёркивается на окно SIEGE_IMMUNE, а не навсегда: игрок видит только разведанные логова
      // (их три-четыре), и вычеркнув их насовсем, полководец вставал бы после первого часа.
      const immune = new Map<string, number>();
      let target: string | null = null;
      let mustered = false;
      const g = townAt(LEVEL);
      outs.push(
        await live({
          g,
          seed,
          style: variant.style,
          hours: HOURS,
          ripe: false,
          grow: (x) => {
            // Уведённых — на работы, где есть место для невольников.
            for (const b of x.buildings) {
              if (bondedIdle(x) <= 0) break;
              if (!takesBonded(b)) continue;
              const room = buildingSlots(b) - handsCount(x, b.id);
              if (room > 0) assignBonded(x, b.id, room);
            }
            if (variant.release) {
              const o = orderBreakdown(x);
              if (o.bonded > 0 && o.value < ORDER_WARN) {
                // Сколько отпустить, чтобы порядок встал на порог: hold / (hold + b) = WARN / 100.
                const keep = Math.floor((o.hold * (100 - ORDER_WARN)) / ORDER_WARN);
                const n = Math.max(0, o.bonded - keep);
                if (n > 0 && releaseBonded(x, n) === null) released += n;
              }
            }
            pulses++;
            if (orderBreakdown(x).value < ORDER_UNREST && bondedTotal(x) > 0) unrestPulses++;
          },
          hourly: (h, x) => {
            const i = HOURS_AT.indexOf(h);
            if (i < 0) return;
            const busy = x.buildings.reduce((n, b) => n + (x.bondedWork[b.id] ?? 0), 0);
            hourly[i].bonded.push(bondedTotal(x));
            hourly[i].work.push(busy);
            hourly[i].idle.push(bondedIdle(x));
            hourly[i].order.push(orderBreakdown(x).value);
            hourly[i].pop.push(x.pop);
            hourly[i].prod.push(sum(RESOURCE_IDS.map((r) => productionPerDay(x)[r] ?? 0)));
            hourly[i].army.push(armySize(x));
          },
          effect: (e) => {
            if ((e.bonded ?? 0) > 0 && variant.share < 1) e.bonded = Math.round((e.bonded ?? 0) * variant.share);
            if ((e.bonded ?? 0) > 0) led += e.bonded ?? 0;
            if (e.id.startsWith('siege-')) falls++;
          },
          after: async ({ g: x, world, now }) => {
            const w: Inside = world;
            if (variant.arms && !w.armsPop) {
              w.armsPop = true;
              const was = w.popNow;
              w.popNow = (s: Inside, at: number): number =>
                s.tribeId === null
                  ? lairPop(lairArmsBase(w.anchorOf(s), w.lairRec(s.id), w.liveAt(s.id, at)) * (1 - w.damageOf(s.id, at)))
                  : was(s, at);
            }
            const figs = await world.figures();
            const gen = figs.find((f) => f.id === 'general');
            if (!gen || gen.gone || gen.downUntil > START + now) return;
            if (gen.readyAt > START + now || gen.besieging) return;
            if (gen.arriveAt > START + now) return;
            if (!mustered) {
              if (!gen.atHome) return;
              const home = homeOf(x.army, awayOf([], figs));
              const half: TroopStack = {};
              for (const id of TROOP_IDS) if ((home[id] ?? 0) > 1) half[id] = Math.floor((home[id] ?? 0) / 2);
              if (troopTotal(half) > 0 && (await world.setGarrison(half)) === null) mustered = true;
              return;
            }
            if (troopTotal(gen.troops) <= 0) return;
            if (target && gen.atId === target) {
              if ((await world.besiege(variant.fate)) === null) sieges++;
              immune.set(target, now + SIEGE_IMMUNE);
              target = null;
              return;
            }
            if (target && gen.atId !== target) {
              // Не дошёл: цель сменилась или путь прерван — ищем заново.
              immune.set(target, now + SIEGE_IMMUNE);
              target = null;
            }
            const info = await world.info();
            const chunk = await world.region({ x: info.home.x - 26, y: info.home.y - 26, w: 53, h: 53 });
            const list = chunk.settlements.filter((s) => !s.mine && !s.ruin && (immune.get(s.id) ?? 0) <= now && s.id !== HOME_ID);
            list.sort((a, b) => Math.hypot(a.x - info.home.x, a.y - info.home.y) - Math.hypot(b.x - info.home.x, b.y - info.home.y));
            const next = list[0];
            if (!next) return;
            if ((await world.moveFigure('general', { x: next.x, y: next.y })) === null) target = next.id;
            else immune.set(next.id, now + SIEGE_IMMUNE);
          },
        }),
      );
    }
    const t = tally(
      outs.map((o) => o.run),
      HOURS,
    );
    const l = outs.map((o) => o.l);
    console.log('');
    console.log(`«${variant.name}»: осад ${sieges}, городов взято голодом ${falls}; уведено ${led} за ${HOURS} ч на ${SEEDS_C.length} мирах — ${(led / (HOURS * SEEDS_C.length)).toFixed(1)} в час; отпущено ${released}.`);
    console.log(`  ропот (порядок ниже ${ORDER_UNREST} при невольниках) — ${pct(unrestPulses / Math.max(1, pulses))} пульсов; мятежей ${sum(l.map((x) => x.mutinies))}, стража удержала ${sum(l.map((x) => x.mutinyHeld))}; ушло войска ${sum(l.map((x) => x.deserted))}.`);
    console.log(`  дома: набегов ${t.raids}, прорвали ${t.broke}, падений/ч ${t.perHour}, потери, удержали ${t.held}.`);
    console.log('   ч  невольников  на работе  без места  порядок  жителей  войско  выработка/день');
    HOURS_AT.forEach((h, i) => {
      const x = hourly[i];
      console.log(
        `  ${pad(h, 2)}  ${pad(Math.round(mean(x.bonded)), 11)}  ${pad(Math.round(mean(x.work)), 9)}  ${pad(Math.round(mean(x.idle)), 9)}  ${pad(Math.round(mean(x.order)), 7)}  ${pad(Math.round(mean(x.pop)), 7)}  ${pad(Math.round(mean(x.army)), 6)}  ${pad(Math.round(mean(x.prod)), 14)}`,
      );
    });
    summary.push(`${variant.name}: ${(led / (HOURS * SEEDS_C.length)).toFixed(1)} в час`);
  }
  console.log('');
  console.log(`Уведено в час: ${summary.join('; ')}.`);
}
