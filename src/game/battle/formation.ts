// Расстановка глазами игрока: свои виды бойцов по шести секторам и резерву плюс
// план, приказы и условие ввода резерва. Ядро боя считает в родах и в бойцах
// строя — перевод делает `toArmySetup`, и только он.
//
// Почему интерфейс работает не в родах: игрок нанимает дубинщиков и латников, а
// не «пехоту». Если бы сектор хранил род, панель показывала бы числа, которых
// игрок нигде больше не видит.
import { TROOP_IDS } from '../data/troops';
import {
  DEFAULT_ORDERS,
  QUICK_PRESETS,
  SECTORS,
  UNIT_KINDS,
  emptyStack,
  type ArmySetup,
  type Orders,
  type Plan,
  type QuickPresetId,
  type ReserveTrigger,
  type Sector,
  type Stack,
  type UnitKind,
} from '@/battle';
import { TROOPS_OF_KIND, gearOf, kindsOf, menOf, troopTotal, weightOf, type TroopStack } from './kinds';

export interface Formation {
  sectors: Record<Sector, TroopStack>;
  plan: Plan;
  orders: Orders;
  reserve: ReserveTrigger;
}

export const emptySectors = (): Record<Sector, TroopStack> =>
  Object.fromEntries(SECTORS.map((id) => [id, {}])) as Record<Sector, TroopStack>;

export const emptyFormation = (): Formation => ({
  sectors: emptySectors(),
  plan: 'envelop',
  orders: { ...DEFAULT_ORDERS },
  reserve: { kind: 'weakest' },
});

/** Глубокая копия: расстановку правят на месте, а стор сравнивает ссылки. */
export const cloneFormation = (f: Formation): Formation => ({
  sectors: Object.fromEntries(SECTORS.map((id) => [id, { ...f.sectors[id] }])) as Record<Sector, TroopStack>,
  plan: f.plan,
  orders: { ...f.orders },
  reserve: { ...f.reserve },
});

/** Кто и сколько расставлен — сумма по всем семи секторам. */
export function placedTroops(f: Formation): TroopStack {
  const out: TroopStack = {};
  for (const id of SECTORS) {
    for (const t of TROOP_IDS) {
      const n = f.sectors[id][t] ?? 0;
      if (n > 0) out[t] = (out[t] ?? 0) + n;
    }
  }
  return out;
}

export const sectorSize = (f: Formation, id: Sector): number => troopTotal(f.sectors[id]);

/** Разница «взято минус расставлено»: те, кого игрок ещё не разложил. */
export function unplacedTroops(picked: TroopStack, f: Formation): TroopStack {
  const placed = placedTroops(f);
  const out: TroopStack = {};
  for (const t of TROOP_IDS) {
    const n = Math.max(0, (picked[t] ?? 0) - (placed[t] ?? 0));
    if (n > 0) out[t] = n;
  }
  return out;
}

/** Кладёт нерасставленных в резерв: отряд не уходит с забытой половиной армии. */
export function stashUnplaced(f: Formation, rest: TroopStack): Formation {
  const out = cloneFormation(f);
  for (const t of TROOP_IDS) {
    const n = rest[t] ?? 0;
    if (n > 0) out.sectors.R[t] = (out.sectors.R[t] ?? 0) + n;
  }
  return out;
}

/**
 * Убирает из расстановки тех, кого в наличии больше нет: шаблон и оборона
 * переживают и потери, и найм. Возвращает подрезанную расстановку и то, что
 * осталось лишним в наличии (его можно доложить в резерв).
 */
export function clampFormation(f: Formation, have: TroopStack): { formation: Formation; extra: TroopStack } {
  const out = cloneFormation(f);
  for (const t of TROOP_IDS) {
    let left = Math.max(0, have[t] ?? 0);
    for (const id of SECTORS) {
      const n = out.sectors[id][t] ?? 0;
      if (n <= 0) continue;
      const keep = Math.min(n, left);
      left -= keep;
      if (keep > 0) out.sectors[id][t] = keep;
      else delete out.sectors[id][t];
    }
  }
  const extra: TroopStack = {};
  const placed = placedTroops(out);
  for (const t of TROOP_IDS) {
    const n = Math.max(0, (have[t] ?? 0) - (placed[t] ?? 0));
    if (n > 0) extra[t] = n;
  }
  return { formation: out, extra };
}

/** Делит `n` по долям целыми числами; остаток уходит наибольшей доле. */
function share(n: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (n <= 0 || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (n * w) / total);
  const out = raw.map((v) => Math.floor(v));
  let rest = n - out.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - out[i], i] as [number, number]).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (rest <= 0) break;
    out[i]++;
    rest--;
  }
  return out;
}

/**
 * Расстановка по одному из пресетов быстрой атаки. Пресет раскладывает роды;
 * бойцы племени этого рода раскладываются в той же пропорции — так «настроить
 * тактику» открывается не пустой схемой, а разумным шаблоном, который правят.
 */
export function presetFormation(troops: TroopStack, preset: QuickPresetId): Formation {
  const layout = QUICK_PRESETS[preset].layout(kindsOf(troops));
  const f = emptyFormation();
  f.plan = layout.plan;
  f.orders = { ...layout.orders };
  f.reserve = { ...layout.reserve };

  for (const k of UNIT_KINDS) {
    const weights = SECTORS.map((id) => layout.sectors[id][k]);
    if (weights.reduce((a, b) => a + b, 0) <= 0) continue;
    for (const t of TROOPS_OF_KIND[k]) {
      const n = Math.max(0, troops[t] ?? 0);
      if (n <= 0) continue;
      const parts = share(n, weights);
      SECTORS.forEach((id, i) => {
        if (parts[i] > 0) f.sectors[id][t] = (f.sectors[id][t] ?? 0) + parts[i];
      });
    }
  }
  // Род, которого пресет никуда не поставил (у племени нет пехоты для фронта и т.п.),
  // не должен пропасть: остаток идёт в резерв.
  const rest = unplacedTroops(troops, f);
  return troopTotal(rest) > 0 ? stashUnplaced(f, rest) : f;
}

/**
 * Расстановка в том виде, в каком её понимает ядро боя. Округление одно на весь
 * род: если бы каждый сектор округлялся сам, отряд из пяти лучников то прибывал,
 * то убывал на человека при перекладывании между секторами.
 */
export function toArmySetup(f: Formation, militia = 0, militiaArchers = 0): ArmySetup {
  const sectors = Object.fromEntries(SECTORS.map((id) => [id, emptyStack()])) as Record<Sector, Stack>;
  for (const k of UNIT_KINDS) {
    const raw = SECTORS.map((id) =>
      TROOPS_OF_KIND[k].reduce((n, t) => n + (f.sectors[id][t] ?? 0) * weightOf(t), 0),
    );
    const total = raw.reduce((a, b) => a + b, 0);
    if (total <= 0) continue;
    const parts = share(Math.max(1, Math.round(total)), raw);
    SECTORS.forEach((id, i) => {
      sectors[id][k] = parts[i];
    });
  }
  if (militia > 0) {
    // Ополчение растекается по фронту поровну: остаток — в центр.
    const parts = share(Math.round(militia), [1, 1, 1]);
    sectors.A.infantry += parts[0];
    sectors.B.infantry += parts[1];
    sectors.C.infantry += parts[2];
  }
  if (militiaArchers > 0) {
    // Стрелки с башни стоят во второй линии: оттуда и бьют, пока держится фронт.
    const parts = share(Math.round(militiaArchers), [1, 1, 1]);
    sectors.D.archer += parts[0];
    sectors.E.archer += parts[1];
    sectors.F.archer += parts[2];
  }
  const gear = gearOf(placedTroops(f));
  return { sectors, plan: f.plan, orders: { ...f.orders }, reserve: { ...f.reserve }, gear };
}

/** Сколько бойцов строя стоит в секторе — число, которым считает ядро. */
export function sectorMen(f: Formation, id: Sector): number {
  let men = 0;
  for (const t of TROOP_IDS) men += menOf(t, f.sectors[id][t] ?? 0);
  return men;
}

/** Какие роды в расстановке вообще есть: только им имеет смысл давать приказы. */
export function kindsPresent(t: TroopStack): UnitKind[] {
  return UNIT_KINDS.filter((k) => TROOPS_OF_KIND[k].some((id) => (t[id] ?? 0) > 0));
}

/** Сохранённая схема похода: состав, расстановка, план, приказы, резерв. */
export interface BattlePlanTemplate {
  id: number;
  name: string;
  /** Сколько кого брать. Больше, чем есть дома, шаблон не возьмёт. */
  troops: TroopStack;
  formation: Formation;
}

/** Сколько схем помещается в списке. Больше пяти игрок не помнит. */
export const TEMPLATES_MAX = 5;

/**
 * Применяет шаблон к тому, что сейчас дома: чего не хватает — берётся сколько
 * есть, лишнее в наличии не добирается. Расстановка подрезается тем же числом,
 * поэтому «отправить сохранённую схему» — это два нажатия и без сюрпризов.
 */
export function applyTemplate(
  tpl: BattlePlanTemplate,
  home: TroopStack,
): { troops: TroopStack; formation: Formation; short: boolean } {
  const troops: TroopStack = {};
  let short = false;
  for (const t of TROOP_IDS) {
    const want = Math.max(0, tpl.troops[t] ?? 0);
    if (want <= 0) continue;
    const take = Math.min(want, Math.max(0, home[t] ?? 0));
    if (take < want) short = true;
    if (take > 0) troops[t] = take;
  }
  const { formation, extra } = clampFormation(tpl.formation, troops);
  return { troops, formation: troopTotal(extra) > 0 ? stashUnplaced(formation, extra) : formation, short };
}
