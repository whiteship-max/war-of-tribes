// Найм — раздел отчёта `raid-hiring:report` (прежде — раздел `raid:report`).
//
// Все прежние замеры роста логова (`raid-lair-growth.ts`, docs/lair_growth.md) держали войско мерки
// полным даром: убитые возвращались между пульсами, казна и склад не платили ничего, а посёлок
// не жил вовсе — ни выработки, ни жалованья, ни еды. Раздел меряет то же самое с игроком, который
// **нанимает**: платит ресурсами найма, снаряжением из кузницы, свободными руками, временем казарм,
// жалованьем из казны и едой — шагом самой игры (`tick`), при игроке. Прогон — общий автопилот
// (`scripts/autopilot.ts`), тот же, что у раздела роста логова, — поэтому столбцы сравниваются с его
// таблицами напрямую.
//
// Поведения (у каждого — свои числа, усреднять их нельзя, это разные игроки):
//
//  - **по средствам** — войско не дороже, чем тянет казна: жалованье после найма не больше дохода
//    казны; казна пуста, а жалованье больше дохода — распускает лишних;
//  - **по средствам, высокий налог** — то же при высоком налоге: так держит войско тот, кто воюет;
//    с решения владельца по этому замеру это и налог новой партии (docs/hiring.md, раздел 9);
//  - **всё, что прокормит** — нанимает, пока еды приходит не меньше, чем уходит (сезон нынешний),
//    о казне не думает; не распускает;
//  - **строит** — не пополняет войско, на лагерь нанимает дубинщиков (`Player.siegeLevy`, как новичок
//    «нанимает на осаду»); в партии с первой секунды — ещё и строит.
//
// Кто строит (раздел Б), нанимает при любом поведении только из свободных рук сверх запаса на стройку
// того племени, каким оно станет после найма (`autopilot.hands`), и новорождённых первым встречает найм,
// а не расстановка: иначе прибор мерил свою петлю, а не игрока, и исход задавала частота его решений
// (docs/hiring.md, разделы 14–16; решение владельца — запас берегут все, кто строит).
//
// Налог у поведений закреплён, а не взят у новой партии: высокий — у «высокого налога»,
// умеренный — у остальных. Иначе смена налога по умолчанию молча сменила бы игроков замера.
//
// Состав найма — мерка `MIX`, снаряжение — из кузницы: у нанимающих кузница укомплектована
// целиком, заказ — на недостачу, но не дальше `FORGE_AHEAD` работы вперёд (кузница берёт плату
// при заказе, и заказ на тысячу мечей молча опустошил бы склад). Лимиты — **замером**: число
// бойцов проверяется настоящими `wagesPerDay`, `taxIncomePerDay`, `productionPerDay` и
// `foodConsumptionPerDay` на том же посёлке с этими бойцами, а не своей арифметикой.
//
// События: на событие игрок отвечает первым бесплатным вариантом (он есть у каждого — тест
// `data/events.test.ts`) — это делает общий автопилот у всех отчётов; прежде автопилот роста логова
// не отвечал, и первое же событие висело до конца прогона, а мятеж поднимается только на пустой стол.
// На мятеж не отвечают: он ждёт срока донесения (настоящие сутки), и стража выходит сама.
//
// Разделы:
//  А. Лестница мерки — посёлок уровня L живёт 4 ч, логова дозрели. Уровни построек стоят: мерка —
//     посёлок уровня L; строит игрок в разделе Б.
//  Б. Партия с первой секунды, 6 ч, строит каждый.
//  В. Уведённые люди: полководец с половиной войска берёт логова голодом на ступени «увести людей»
//     (покупной: пока не куплена — «ограбить»), дома нанимают по средствам; что это делает с руками,
//     порядком и мятежом за 6 ч.
import type { ResourceId } from '@/game/types';
import { HOME_ID } from '@/world/local/LocalWorld';
import { awayOf, homeOf } from '@/world/muster';
import { lairArmsBase, lairPop, lairPower, lairShield } from '@/world/lairs';
import { LAIR_ANCHOR_MID, LAIR_POWER_BASE, LAIR_POWER_PER_LEVEL, LAIR_RIPE, LAIR_STEP, SIEGE_IMMUNE } from '@/world/data/tuning';
import { troopTotal, type TroopStack } from '@/game/battle/kinds';
import { troopPower } from '@/game/battle/price';
import { assignBonded } from '@/game/sim/workers';
import { releaseBonded } from '@/game/sim/mutiny';
import { fateOpen, studyInfo } from '@/game/sim/tech';
import { DAY_LENGTH, realMs } from '@/game/pace';
import { TROOP_IDS } from '@/game/data/troops';
import { createInitialState } from '@/game/state';
import { seeded, setRandom } from '@/game/sim/random';
import { ORDER_UNREST, ORDER_WARN, RESOURCE_IDS } from '@/game/constants';
import {
  armyPower,
  armySize,
  bondedBusy,
  bondedIdle,
  bondedTotal,
  buildingSlots,
  defense,
  handsCount,
  orderBreakdown,
  payGraceDays,
  productionPerDay,
  takesBonded,
  taxIncomePerDay,
  upkeepInfo,
  mastersCount,
  wagesPerDay,
} from '@/game/derived';
import {
  FORGE_AHEAD,
  MIN,
  START,
  townAt,
  unitsNote,
  type Inside,
  type Ledger,
  type Step,
  type Stop,
} from './autopilot';
import { NEW_SEEDS, SEEDS, hm, mean, pad, pct, q, sum, tally } from './raid-common';

import { NAME, STYLES, live, portable, type Out, type Style } from './raid-live';
import { fan, serveFan } from './lib/fan';

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

/** Прогоны «Найма», которые читает раздел «Лазарет»: гонять их второй раз незачем. */
export interface Hired {
  /** Лестница мерки: ключ — `поведение:уровень`. */
  ladder: Record<string, Out[]>;
  /** Партия с первой секунды по поведениям. */
  fresh: Record<Style, Out[]>;
  /** Все прогоны раздела «Уведённые люди», по вариантам подряд. */
  captives: Out[];
}

// ---------- Партия с первой секунды: одна строка прогона ----------

const FRESH_HOURS = 6;
const FRESH_AT = [1, 2, 4, 6];
const FRESH_HEADER =
  ' поведение                                набегов  набег / оборона  первое падение  прорвали  лагерей  падений осадой  падений/ч  нанято  ушло  жителями  распущено  бойцов потеряно  войско к 1/2/4/6 ч    люди к 1/2/4/6 ч      ср. уровень к 1/2/4/6 ч  найм встал на';

interface FreshSpec {
  label: string;
  style: Style;
  /** Изучает ли игрок ветви; нет — изучает. */
  study?: boolean;
  /** Как часто игрок решает, игровых секунд; нет — как у приёмки, раз в полдня. */
  decide?: number;
  /** Вложился в административную ветвь: берёт наёмных мастеров первым, до войска. */
  masters?: boolean;
}

/** Прогон партии с первой секунды на одном мире и что прибор снял с неё к 1/2/4/6 ч. */
interface FreshRun {
  out: Out;
  army: (number | undefined)[];
  pop: (number | undefined)[];
  lvl: (number | undefined)[];
  /** Спор за золото на тех же отметках: мастера, мощь войска, жалованье войску и мастерам, доход казны. */
  gold: ({ masters: number; power: number; armyWages: number; mastersWages: number; income: number } | undefined)[];
}

/** Задача веера (`lib/fan.ts`): партия с первой секунды одним поведением на одном мире. */
export async function freshRun(a: { spec: FreshSpec; seed: number }): Promise<FreshRun> {
  const { spec, seed } = a;
  const army: (number | undefined)[] = [];
  const pop: (number | undefined)[] = [];
  const lvl: (number | undefined)[] = [];
  const gold: FreshRun['gold'] = [];
  setRandom(seeded(seed));
  const g = createInitialState(seed);
  g.tutorialDone = true;
  const out = await live({
    g,
    seed,
    style: spec.style,
    study: spec.study,
    masters: spec.masters,
    decide: spec.decide,
    hours: FRESH_HOURS,
    ripe: false,
    build: true,
    hourly: (h, x) => {
      const i = FRESH_AT.indexOf(h);
      if (i < 0) return;
      army[i] = armySize(x);
      pop[i] = x.pop;
      lvl[i] = sum(x.buildings.map((b) => b.level)) / x.buildings.length;
      const up = upkeepInfo(x);
      gold[i] = { masters: mastersCount(x), power: armyPower(x), armyWages: up.armyWages, mastersWages: up.mastersWages, income: up.income };
    },
  });
  setRandom(null);
  return { out: portable(out), army, pop, lvl, gold };
}

/**
 * Партии с первой секунды по строкам на мирах `NEW_SEEDS` — строки раздела Б. Одни на раздел Б и
 * на перемер частоты решений (`cadenceSection`): у сравнения не должно быть двух копий прогона.
 * Прогоны всех строк идут одним веером, печать — по строке, в прежнем порядке.
 */
async function freshRows(specs: FreshSpec[]): Promise<Out[][]> {
  unitsNote();
  const runs = await fan(freshRun, import.meta.url, specs.flatMap((spec) => NEW_SEEDS.map((seed) => ({ spec, seed }))));
  return specs.map((spec, k) => freshRow(spec, runs.slice(k * NEW_SEEDS.length, (k + 1) * NEW_SEEDS.length)));
}

function freshRow(spec: FreshSpec, runs: FreshRun[]): Out[] {
  const outs = runs.map((r) => r.out);
  const army: number[][] = [[], [], [], []];
  const pop: number[][] = [[], [], [], []];
  const lvl: number[][] = [[], [], [], []];
  for (const r of runs) {
    for (let i = 0; i < FRESH_AT.length; i++) {
      if (r.army[i] !== undefined) army[i].push(r.army[i] as number);
      if (r.pop[i] !== undefined) pop[i].push(r.pop[i] as number);
      if (r.lvl[i] !== undefined) lvl[i].push(r.lvl[i] as number);
    }
  }
  const t = tally(
    outs.map((o) => o.run),
    FRESH_HOURS,
  );
  const l = outs.map((o) => o.l);
  const first = t.first.length ? `${hm(Math.min(...t.first))}…${hm(Math.max(...t.first))}${t.first.length < outs.length ? ` (${t.first.length} из ${outs.length})` : ''}` : 'нет';
  const row = (xs: number[][], f: (v: number) => string): string => xs.map((v) => pad(f(mean(v)), 4)).join(' ');
  console.log(
    ` ${spec.label.padEnd(39)} ${pad(t.raids, 7)}  ${pad(t.ratio, 15)}  ${pad(first, 14)}  ${pad(t.broke, 8)}  ${pad(t.sieges, 7)}  ${pad(t.falls, 14)}  ${pad(t.perHour, 9)}  ${pad(sum(l.map((x) => x.hired)) + t.hired, 6)}  ${pad(sum(l.map((x) => x.deserted)), 4)}  ${pad(sum(l.map((x) => x.returned)), 8)}  ${pad(sum(l.map((x) => x.dismissed)), 9)}  ${pad(t.lost, 15)}  ${row(army, (v) => String(Math.round(v))).padEnd(19)}  ${row(pop, (v) => String(Math.round(v))).padEnd(20)}  ${row(lvl, (v) => v.toFixed(1)).padEnd(23)}  ${fmtStops(l)}`,
  );
  return outs;
}

/**
 * Зависит ли исход партии с первой секунды от того, как часто прибор решает (docs/hiring.md, раздел 16).
 * Игровой ответ от частоты решений не зависит: как часто игрок заглядывает в казармы — его дело, а
 * сколько людей стоит дубинщик и сколько их держит казна — дело игры. Зависит — значит, исход задаёт
 * прибор: что он успевает сделать с новорождёнными между двумя решениями.
 *
 * Строки — пол ветви («без технологий»: высокий налог, ни разу не открыл «Технологии») и игрок по
 * умолчанию («высокий налог», изучает), каждая — раз в полдня (как приёмка), раз в полтора дня и раз в
 * пять игровых дней. В приёмку раздел не входит — `DECIDE_SWEEP=1 npm run raid-hiring:report`.
 */
export async function cadenceSection(): Promise<void> {
  console.log('');
  console.log('=== Частота решений: зависит ли исход от того, как часто прибор решает ===');
  console.log(`Партия с первой секунды, как раздел Б «Найма»: ${FRESH_HOURS} ч, миры ${NEW_SEEDS.join(', ')}, мир как есть, автопилот строит.`);
  console.log('Приёмка решает раз в полдня (30 игровых секунд); здесь те же строки ещё и раз в полтора дня и раз в пять дней.');
  console.log('Исход игры от частоты решений зависеть не должен; зависит — исход задаёт прибор, а не игра.');
  console.log(FRESH_HEADER);
  const specs: { label: string; spec: Omit<FreshSpec, 'label' | 'decide'> }[] = [
    { label: 'без технологий', spec: { style: 'meansHigh', study: false } },
    { label: 'высокий налог', spec: { style: 'meansHigh' } },
  ];
  await freshRows(specs.flatMap(({ label, spec }) => [30, 90, 300].map((decide) => ({ ...spec, label: `${label} · раз в ${String(decide / DAY_LENGTH).replace('.', ',')} игр. дн.`, decide }))));
}

/**
 * Спор за золото с набегами (docs/admin_branch.md, раздел 4.1): отнимает ли игрок, вложившийся в
 * административную ветвь, у собственного войска. В тихом мире казна у игрока по умолчанию не
 * упирается, и спора там не увидеть по определению (`pop:report`, «Спор за золото»); здесь мир как
 * есть, с набегами, — тот, где у раздела Б найм встаёт на казне.
 *
 * Строки — игрок по умолчанию раздела Б («высокий налог», изучает) и тот же игрок, который берёт
 * наёмных мастеров первым, до войска, тем же правилом «по средствам» (`autopilot.hireMastersByMeans`).
 * Прибор тот же, что у раздела Б, — `freshRun`, те же миры и срок. В приёмку раздел не входит —
 * `MASTERS_SWEEP=1 npm run raid-hiring:report`.
 */
export async function mastersSection(): Promise<void> {
  unitsNote();
  console.log('');
  console.log('=== Спор за золото с набегами: отнимают ли мастера у войска ===');
  console.log(`Партия с первой секунды, как раздел Б «Найма»: ${FRESH_HOURS} ч, миры ${NEW_SEEDS.join(', ')}, мир как есть (набеги идут), автопилот строит.`);
  console.log('«вложился в админветвь» — тот же игрок, но наёмных мастеров берёт первым, до войска, тем же правилом «по средствам».');
  console.log(FRESH_HEADER);
  const specs: FreshSpec[] = [
    { label: 'высокий налог', style: 'meansHigh' },
    { label: 'высокий налог, вложился в админветвь', style: 'meansHigh', masters: true },
  ];
  const runs = await fan(freshRun, import.meta.url, specs.flatMap((spec) => NEW_SEEDS.map((seed) => ({ spec, seed }))));
  const rows = specs.map((spec, k) => runs.slice(k * NEW_SEEDS.length, (k + 1) * NEW_SEEDS.length));
  specs.forEach((spec, k) => freshRow(spec, rows[k]));
  console.log('');
  console.log(`Спор числом — среднее по мирам на отметках ${FRESH_AT.map((h) => `${h} ч`).join(' / ')}:`);
  console.log(' строка                                   | войско           | мощь войска           | мастера      | жалованье войску       | жалованье мастерам | доход казны');
  const at = (r: FreshRun[], i: number, f: (x: NonNullable<FreshRun['gold'][number]>) => number): number =>
    mean(r.map((x) => x.gold[i]).filter((x) => x !== undefined).map((x) => f(x as NonNullable<FreshRun['gold'][number]>)));
  const col = (r: FreshRun[], f: (i: number) => number, d = 0): string => FRESH_AT.map((_, i) => f(i).toFixed(d)).join(' / ');
  specs.forEach((spec, k) => {
    const r = rows[k];
    console.log(
      ` ${spec.label.padEnd(40)} | ${col(r, (i) => mean(r.map((x) => x.army[i] ?? 0))).padEnd(16)} | ${col(r, (i) => at(r, i, (g) => g.power)).padEnd(21)} | ` +
        `${col(r, (i) => at(r, i, (g) => g.masters)).padEnd(12)} | ${col(r, (i) => at(r, i, (g) => g.armyWages)).padEnd(22)} | ` +
        `${col(r, (i) => at(r, i, (g) => g.mastersWages)).padEnd(18)} | ${col(r, (i) => at(r, i, (g) => g.income))}`,
    );
  });
  const [a, b] = rows;
  const diff = FRESH_AT.map((h, i) => {
    const x = mean(a.map((r) => r.army[i] ?? 0));
    const y = mean(b.map((r) => r.army[i] ?? 0));
    return `${h} ч: ${x.toFixed(0)} → ${y.toFixed(0)} (${y - x >= 0 ? '+' : ''}${(y - x).toFixed(0)})`;
  });
  console.log(`  Войско вложившегося против игрока по умолчанию: ${diff.join('; ')}.`);
}

/** Срок и уровни лестницы мерки (раздел А). */
const LADDER_HOURS = 4;
const LADDER_LEVELS = [7, 8, 10];

/**
 * Задача веера (`lib/fan.ts`): прогон лестницы мерки — посёлок уровня `level` одним поведением на
 * одном мире. `rho` — подстановка ступени под наймом (перебор `STEP_SWEEP`); нет — игра.
 */
export async function ladderRun(a: { level: number; style: Style; seed: number; rho?: number }): Promise<Out> {
  const step: Step | undefined = a.rho === undefined ? undefined : { name: a.rho.toFixed(2), rho: a.rho, shield: true };
  return portable(await live({ g: townAt(a.level), seed: a.seed, style: a.style, step, hours: LADDER_HOURS, ripe: true, ref: defense(townAt(a.level)) }));
}

export async function hiringSection(): Promise<Hired> {
  console.log('');
  console.log('=== Найм: игрок, который платит за войско ===');
  console.log('Прогон — общий автопилот (scripts/autopilot.ts), мир как есть. Посёлок живёт шагом игры (tick) при игроке: выработка, еда, налог, жалованье, уход войска.');
  console.log('Поведения: «по средствам» — жалованье после найма не больше дохода казны, казна пуста и жалованье больше дохода — распускает;');
  console.log('«по средствам, высокий налог» — то же при высоком налоге; «всё, что прокормит» — нанимает, пока еды приходит не меньше, чем уходит (сезон нынешний),');
  console.log('о казне не думает и не распускает; кто строит (раздел Б), при любом поведении нанимает из свободных рук сверх пятой части племени после найма,');
  console.log('которую держит под стройку, и новорождённых первым встречает найм, а не расстановка на работы;');
  console.log('«строит» — не пополняет войско, на лагерь нанимает дубинщиков (как новичок «нанимает на осаду»).');
  console.log(`Состав найма — MIX мерки, снаряжение — из кузницы (у нанимающих укомплектована целиком, заказ на недостачу не дальше ${FORGE_AHEAD / MIN} мин работы вперёд).`);
  console.log('Лимиты — замером: бойцы кладутся в состояние, читаются wagesPerDay, taxIncomePerDay, productionPerDay, foodConsumptionPerDay, состояние возвращается.');
  console.log('На события отвечают первым бесплатным вариантом; на мятеж не отвечают — стража выходит сама по сроку.');

  // А. Лестница.
  const HOURS = LADDER_HOURS;
  const LEVELS = LADDER_LEVELS;
  console.log('');
  console.log(`--- А. Лестница мерки: ${HOURS} ч на каждом из ${SEEDS.length} миров, посёлок уровня L живёт, уровни построек стоят, логова дозрели ---`);
  console.log('Цена мерки: войско мерки против казны посёлка мерки в первую минуту при умеренном налоге:');
  console.log(' ур  жителей  войско  жалованье/день  доход казны/день  жалованье к доходу  терпение Статуи, дн.');
  for (const level of LEVELS) {
    const g = townAt(level);
    g.tax = 'moderate';
    console.log(
      ` ${pad(level, 2)}  ${pad(g.pop, 7)}  ${pad(armySize(g), 6)}  ${pad(Math.round(wagesPerDay(g)), 14)}  ${pad(Math.round(taxIncomePerDay(g)), 16)}  ${pad(pct(wagesPerDay(g) / taxIncomePerDay(g)), 18)}  ${pad(payGraceDays(g), 20)}`,
    );
  }
  console.log('Столбцы — как в разделе 2 выше; «даром» — строка «игра» оттуда же (войско держат полным даром, посёлок не живёт).');
  console.log('«нанято» — ушло в казармы (у «строит» — дубинщики на лагерь); «ушло» — ушло голодом или неуплатой (дверь содержания), «жителями» — из них остались в посёлке; «распущено» — по средствам; «жалованье к доходу» — среднее по пульсам.');
  console.log(' поведение                    ур  жителей в конце  набегов  набег / оборона  у стены  прорвали  лагерей  доля осад  вылазки   падений осадой  падений/ч  потери, удержали  < половины  войско дома: медиана  в конце  нанято  ушло  жителями  распущено  жалованье к доходу  долг в конце  найм встал на');
  const ladder: Record<string, Out[]> = {};
  unitsNote();
  const rungs = LEVELS.flatMap((level) => STYLES.map((style) => ({ level, style })));
  const ran = await fan(ladderRun, import.meta.url, rungs.flatMap(({ level, style }) => SEEDS.map((seed) => ({ level, style, seed }))));
  for (const [k, { level, style }] of rungs.entries()) ladder[`${style}:${level}`] = ran.slice(k * SEEDS.length, (k + 1) * SEEDS.length);
  for (const level of LEVELS) {
    for (const style of STYLES) {
      const outs = ladder[`${style}:${level}`];
      const t = tally(
        outs.map((o) => o.run),
        HOURS,
      );
      const l = outs.map((o) => o.l);
      console.log(
        ` ${NAME[style].padEnd(27)} ${pad(level, 2)}  ${pad(Math.round(mean(outs.map((o) => o.g.pop))), 15)}  ${pad(t.raids, 7)}  ${pad(t.ratio, 15)}  ${pad(t.walls, 7)}  ${pad(t.broke, 8)}  ${pad(t.sieges, 7)}  ${pad(t.siegeShare, 9)}  ${pad(t.sorties, 8)}  ${pad(t.falls, 14)}  ${pad(t.perHour, 9)}  ${pad(t.held, 16)}  ${pad(t.half, 10)}  ${pad(Math.round(q(l.flatMap((x) => x.armyHome), 0.5)), 20)}  ${pad(t.armyEnd, 7)}  ${pad(sum(l.map((x) => x.hired)) + t.hired, 6)}  ${pad(sum(l.map((x) => x.deserted)), 4)}  ${pad(sum(l.map((x) => x.returned)), 8)}  ${pad(sum(l.map((x) => x.dismissed)), 9)}  ${pad(pct(mean(l.map((x) => mean(x.wages) / Math.max(1, mean(x.income))))), 18)}  ${pad(Math.round(mean(l.map((x) => x.debt))), 12)}  ${fmtStops(l)}`,
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
  console.log(' поведение                    ур  добра/ч  из них: еда  дерево  камень  железо  медь  шкуры  уголь  уход войска по поводу: неуплата / голод (пульсов)');
  for (const level of LEVELS) {
    for (const style of STYLES) {
      const l = ladder[`${style}:${level}`].map((o) => o.l);
      const per = (r: ResourceId): number => Math.round(sum(l.map((x) => x.spentBy[r] ?? 0)) / (l.length * HOURS));
      console.log(
        ` ${NAME[style].padEnd(27)} ${pad(level, 2)}  ${pad(Math.round(sum(l.map((x) => x.spent)) / (l.length * HOURS)), 7)}  ${pad(per('food'), 11)}  ${pad(per('wood'), 6)}  ${pad(per('stone'), 6)}  ${pad(per('iron'), 6)}  ${pad(per('copper'), 4)}  ${pad(per('hides'), 5)}  ${pad(per('charcoal'), 5)}  ${sum(l.map((x) => x.whyPay))} / ${sum(l.map((x) => x.whyFood))}`,
      );
    }
  }

  // Ступень под наймом.
  const STEP_LEVELS = [8, 10];
  const STEP_STYLES: Style[] = ['means', 'meansHigh'];
  console.log('');
  console.log('Ступень под наймом: та же подстановка, что в разделе 2 (сила вышедшего набега пересчитана в минуту выхода), защита новичка оставлена.');
  console.log(`Строка ${LAIR_STEP.toFixed(2)} — игра, взята из таблицы выше.`);
  // Строки 0.80 и 1.00 — замер, по которому выбирали LAIR_STEP (решено 17.09, docs/hiring.md, раздел 3): 40 прогонов по
  // 4 ч из 160 в отчёте (лестница 60, ступени 40, партия с нуля 12, уведённые 33, полководец лазарета 15). Приёмка мерит принятую ступень; перебор — по STEP_SWEEP=1, как перебор чисел боя.
  const SWEEP = Boolean(process.env.STEP_SWEEP);
  if (!SWEEP) console.log('Строки 0.80 и 1.00 (замер, по которому выбрана ступень) — STEP_SWEEP=1 npm run raid-hiring:report.');
  console.log(' поведение                    ступень  ур  набегов  набег / оборона  у стены  прорвали  лагерей  доля осад  падений осадой  падений/ч  потери, удержали  войско дома: медиана  ушло');
  const sweep = STEP_LEVELS.flatMap((level) => STEP_STYLES.flatMap((style) => (SWEEP ? [0.8, 1] : []).map((rho) => ({ level, style, rho }))));
  const swept = await fan(ladderRun, import.meta.url, sweep.flatMap((x) => SEEDS.map((seed) => ({ ...x, seed }))));
  const stepOuts = (level: number, style: Style, rho: number): Out[] => {
    const k = sweep.findIndex((x) => x.level === level && x.style === style && x.rho === rho);
    return swept.slice(k * SEEDS.length, (k + 1) * SEEDS.length);
  };
  for (const level of STEP_LEVELS) {
    for (const style of STEP_STYLES) {
      for (const rho of SWEEP ? [0.8, LAIR_STEP, 1] : [LAIR_STEP]) {
        const outs = rho === LAIR_STEP ? ladder[`${style}:${level}`] : stepOuts(level, style, rho);
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
  console.log(`(× lairShield по жителям и войску мерки уровня); по уровню — ступень × (${LAIR_POWER_PER_LEVEL} × L + ${LAIR_POWER_BASE}), как в разделе 1; оборона — медиана по пульсам, мерка — defense посёлка мерки.`);
  console.log(' поведение                    ур  жителей: мерка  медиана  набег по жителям  по уровню  жители к уровню  оборона: мерка  медиана');
  for (const level of LEVELS) {
    const ref = townAt(level);
    const byLevel = LAIR_STEP * (LAIR_POWER_PER_LEVEL * level + LAIR_POWER_BASE);
    for (const style of STYLES) {
      const l = ladder[`${style}:${level}`].map((o) => o.l);
      const pop = q(l.flatMap((x) => x.pops), 0.5);
      const raid = lairPower(LAIR_ANCHOR_MID, { bornAt: 0, burnedAt: 0 }, LAIR_RIPE, pop) * lairShield(pop, troopPower(ref.army));
      console.log(
        ` ${NAME[style].padEnd(27)} ${pad(level, 2)}  ${pad(ref.pop, 14)}  ${pad(pop, 7)}  ${pad(Math.round(raid), 16)}  ${pad(Math.round(byLevel), 9)}  ${pad(pct(raid / byLevel), 15)}  ${pad(Math.round(defense(ref)), 14)}  ${pad(Math.round(q(l.flatMap((x) => x.defs), 0.5)), 7)}`,
      );
    }
  }

  // Б. Партия с первой секунды.
  console.log('');
  console.log(`--- Б. Партия с первой секунды: ${FRESH_HOURS} ч, миры ${NEW_SEEDS.join(', ')}, мир как есть, автопилот строит у всех ---`);
  console.log('Налог новой партии — высокий: её игрок по умолчанию — строка «по средствам, высокий налог».');
  console.log('Последняя строка — тот же игрок с теми же деньгами, который ни разу не открыл «Технологии»: это пол военной ветви.');
  console.log('Состава найма ей не задают — его урезает сам гейт: на первом уровне из мерки MIX не открыт ни один вид, и вся доля мерки уходит');
  console.log('дубинщикам — виду, открытому без ступени (autopilot.openMix, решение владельца: тратит те же деньги на то, что у него есть).');
  console.log(FRESH_HEADER);
  const fresh = {} as Record<Style, Out[]>;
  const freshSpecs: FreshSpec[] = [
    ...STYLES.map((style) => ({ label: NAME[style], style })),
    { label: 'высокий налог, без технологий', style: 'meansHigh' as Style, study: false },
  ];
  const freshOuts = await freshRows(freshSpecs);
  freshSpecs.forEach((spec, k) => {
    if (spec.study === undefined) fresh[spec.style] = freshOuts[k];
  });

  // В. Уведённые люди.
  const captives = await captivesPart();
  return { ladder, fresh, captives };
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
  // Умеренный налог с верой берёт логова голодом (docs/hiring.md, раздел 13): с чем сравнивать его улов —
  // та же война без увода, и что стало бы с уводом ещё вдвое меньше или с отпуском до порядка 50.
  { name: 'по средствам: ограбить (без увода)', style: 'means', fate: 'plunder', share: 1, arms: false, release: false },
  { name: 'по средствам: увести людей, отпускает до порядка 50', style: 'means', fate: 'captives', share: 1, arms: false, release: true },
  { name: 'по средствам: доходит половина уведённых', style: 'means', fate: 'captives', share: 0.5, arms: false, release: false },
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

/** Срок, уровень и часы среза раздела «Уведённые люди». */
const CAPT_HOURS = 6;
const CAPT_LEVEL = 10;
const CAPT_AT = [1, 2, 4, 6];

/** Срез посёлка к часу из `CAPT_AT` — по значению каждого столбца. */
type Snap = { [K in keyof Hourly]: number };

/** Что прибор снял с одного прогона «Уведённых людей»: счётчики строки и срезы по часам. */
interface Captured {
  out: Out;
  hourly: (Snap | undefined)[];
  led: number;
  released: number;
  unrestPulses: number;
  pulses: number;
  falls: number;
  sieges: number;
  /**
   * Сколько осад объявлено «увести людей» и сколько из них взято: под гейтом участь покупная, и
   * без этого счёта «уведено 0» не отличить от поломки.
   */
  siegesLed: number;
  fallsLed: number;
}

/**
 * Задача веера (`lib/fan.ts`): один прогон раздела «Уведённые люди» — вариант `variant` на мире
 * `seed`. Полководец забирает половину войска и берёт голодом ближайшие логова одно за другим.
 */
export async function capturedRun(a: { variant: Led; seed: number }): Promise<Captured> {
  const { variant, seed } = a;
  const hourly: (Snap | undefined)[] = [];
  const c = { led: 0, released: 0, unrestPulses: 0, pulses: 0, falls: 0, sieges: 0, siegesLed: 0, fallsLed: 0 };
  // Логово, у которого стояли, вычёркивается на окно SIEGE_IMMUNE, а не навсегда: игрок видит только разведанные логова
  // (их три-четыре), и вычеркнув их насовсем, полководец вставал бы после первого часа.
  const immune = new Map<string, number>();
  const declared = new Map<string, string>();
  let target: string | null = null;
  let mustered = false;
  const g = townAt(CAPT_LEVEL);
  const out = await live({
    g,
    seed,
    style: variant.style,
    hours: CAPT_HOURS,
    ripe: false,
    also: (x) => {
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
          if (n > 0 && releaseBonded(x, n) === null) c.released += n;
        }
      }
      c.pulses++;
      if (orderBreakdown(x).value < ORDER_UNREST && bondedTotal(x) > 0) c.unrestPulses++;
    },
    hourly: (h, x) => {
      const i = CAPT_AT.indexOf(h);
      if (i < 0) return;
      const busy = bondedBusy(x);
      hourly[i] = {
        bonded: bondedTotal(x),
        work: busy,
        idle: bondedIdle(x),
        order: orderBreakdown(x).value,
        pop: x.pop,
        prod: sum(RESOURCE_IDS.map((r) => productionPerDay(x)[r] ?? 0)),
        army: armySize(x),
      };
    },
    effect: (e) => {
      if ((e.bonded ?? 0) > 0 && variant.share < 1) e.bonded = Math.round((e.bonded ?? 0) * variant.share);
      if ((e.bonded ?? 0) > 0) c.led += e.bonded ?? 0;
      if (e.id.startsWith('siege-')) {
        c.falls++;
        if (declared.get(e.id.slice('siege-'.length, e.id.lastIndexOf('-'))) === 'captives') c.fallsLed++;
      }
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
        // Под гейтом «увести людей» — покупная ступень военной ветви (docs/dynasty.md, раздел
        // 11.2), и посёлку мерки она не засчитана: засчитывают вещи, а не участь. Пока игрок её
        // не купил, он берёт логово тем, что может объявить, — «ограбить», и воевать не
        // перестаёт. Спрашивает он ту же дверь гейта, что и мир (`sim/tech.fateOpen`).
        const fate = fateOpen(x, variant.fate) ? variant.fate : 'plunder';
        if ((await world.besiege(fate)) === null) {
          c.sieges++;
          if (fate === 'captives') c.siegesLed++;
          declared.set(target, fate);
        }
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
  });
  return { out: portable(out), hourly, ...c };
}

async function captivesPart(): Promise<Out[]> {
  const HOURS = CAPT_HOURS;
  const LEVEL = CAPT_LEVEL;
  const SEEDS_C = NEW_SEEDS;
  console.log('');
  console.log(`--- В. Уведённые люди: посёлок мерки уровня ${LEVEL}, ${HOURS} ч, миры ${SEEDS_C.join(', ')}, логова молоды (мир начинается с прогоном, как в order:report) ---`);
  console.log('Полководец забирает половину войска дома и берёт голодом ближайшие логова одно за другим (как order:report, «война против хозяйства»);');
  console.log('дома нанимают по средствам; уведённых автопилот ставит на работы, где есть место для невольников. Набеги на дом идут как в игре.');
  console.log('«ограбить» — та же война без увода. Подстановки: «доходит доля» — в последствии мира уведённых столько-то от игры (осада и бой те же);');
  console.log('«люди логова без жителей» — люди логова от силы без жителей города (lairArmsBase — дверь оружия): меняет и амбар логова, то есть срок осады;');
  console.log('«отпускает» — игрок отпускает невольников, пока порядок ниже ORDER_WARN.');
  // Ступень участи — покупная: посёлку мерки засчитаны вещи, а участь не засчитывается никому.
  // Когда очков на неё хватит, говорит та же дверь, что кнопка «Изучить» (`sim/tech.studyInfo`).
  const gate = studyInfo(townAt(LEVEL), 'war');
  console.log(
    `«Увести людей» — ${gate.next} уровень военной ветви, ${gate.price} очков: посёлку мерки засчитан ${gate.level} (по вещам), участь не засчитывается никому.`,
  );
  console.log(`Пока ступень не куплена, полководец объявляет «ограбить»; очков на неё хватает через ${hm(realMs(gate.wait))} прогона.`);
  console.log(`Порядок: ропот ниже ${ORDER_UNREST}, тревога ниже ${ORDER_WARN}.`);
  const HOURS_AT = CAPT_AT;
  const summary: string[] = [];
  const all = await fan(capturedRun, import.meta.url, LEDS.flatMap((variant) => SEEDS_C.map((seed) => ({ variant, seed }))));
  for (const [v, variant] of LEDS.entries()) {
    const runs = all.slice(v * SEEDS_C.length, (v + 1) * SEEDS_C.length);
    const hourly: Hourly[] = HOURS_AT.map(() => ({ bonded: [], work: [], idle: [], order: [], pop: [], prod: [], army: [] }));
    for (const r of runs) {
      for (let i = 0; i < HOURS_AT.length; i++) {
        const snap = r.hourly[i];
        if (!snap) continue;
        for (const k of Object.keys(hourly[i]) as (keyof Hourly)[]) hourly[i][k].push(snap[k]);
      }
    }
    const total = (k: Exclude<keyof Captured, 'out' | 'hourly'>): number => sum(runs.map((r) => r[k]));
    const led = total('led');
    const released = total('released');
    const unrestPulses = total('unrestPulses');
    const pulses = total('pulses');
    const falls = total('falls');
    const sieges = total('sieges');
    const siegesLed = total('siegesLed');
    const fallsLed = total('fallsLed');
    const outs = runs.map((r) => r.out);
    const t = tally(
      outs.map((o) => o.run),
      HOURS,
    );
    const l = outs.map((o) => o.l);
    console.log('');
    console.log(`«${variant.name}»: осад ${sieges} (с «увести людей» — ${siegesLed}), городов взято голодом ${falls} (из них с «увести людей» — ${fallsLed}); уведено ${led} за ${HOURS} ч на ${SEEDS_C.length} мирах — ${(led / (HOURS * SEEDS_C.length)).toFixed(1)} в час; отпущено ${released}.`);
    console.log(`  ропот (порядок ниже ${ORDER_UNREST} при невольниках) — ${pct(unrestPulses / Math.max(1, pulses))} пульсов; мятежей ${sum(l.map((x) => x.mutinies))}, стража удержала ${sum(l.map((x) => x.mutinyHeld))}; ушло войска ${sum(l.map((x) => x.deserted))}, из них жителями ${sum(l.map((x) => x.returned))}.`);
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
  return all.map((r) => r.out);
}

serveFan(import.meta.url, { ladderRun, freshRun, capturedRun });
