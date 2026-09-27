// Расстановка глазами игрока: свои виды бойцов по шести секторам и резерву. Ядро боя
// считает в родах и в бойцах строя — перевод делает `toArmySetup`, и только он.
//
// Живёт она теперь только у обороны, и то до поставки 2 (docs/battle_eu4.md, 14.5, «Оборона до
// поставки 2»): у удара раскладки, плана, приказов и резерва с условием нет — все, кто входит в бой,
// встают по правилу развёртывания (`battle/setup.deploy`). Им же раскладка обороны и начинается.
//
// Почему интерфейс работает не в родах: игрок нанимает дубинщиков и латников, а
// не «пехоту». Если бы сектор хранил род, панель показывала бы числа, которых
// игрок нигде больше не видит.
import { TROOP_IDS } from '../data/troops';
import {
  FRONT_WIDTH,
  SECTORS,
  UNIT_KINDS,
  deploy,
  emptyStack,
  type ArmySetup,
  type Sector,
  type Stack,
} from '@/battle';
import { TROOPS_OF_KIND, gearOf, kindsOf, menOf, troopTotal, weightOf, type TroopStack } from './kinds';

export interface Formation {
  sectors: Record<Sector, TroopStack>;
}

export const emptySectors = (): Record<Sector, TroopStack> =>
  Object.fromEntries(SECTORS.map((id) => [id, {}])) as Record<Sector, TroopStack>;

export const emptyFormation = (): Formation => ({ sectors: emptySectors() });

/**
 * Глубокая копия: расстановку правят на месте, а стор сравнивает ссылки. Копируются только сектора:
 * раскладка, сохранённая до поставки 1 боя, привозит ещё план, приказы и резерв, и копия их не несёт.
 */
export const cloneFormation = (f: Formation): Formation => ({
  sectors: Object.fromEntries(SECTORS.map((id) => [id, { ...f.sectors[id] }])) as Record<Sector, TroopStack>,
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
 * Расстановка по правилу развёртывания (`battle/setup.deploy`): правило раскладывает роды, бойцы
 * племени этого рода раскладываются в той же пропорции — так оборона открывается не пустой схемой, а
 * тем, как отряд встал бы сам. Своих долей по секторам у раскладки нет, как нет их у правила.
 */
export function deployFormation(troops: TroopStack): Formation {
  const layout = { sectors: deploy(kindsOf(troops), FRONT_WIDTH) };
  const f = emptyFormation();

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
  // Округление по видам может оставить бойца вне секторов — он не должен пропасть: остаток идёт в резерв.
  const rest = unplacedTroops(troops, f);
  return troopTotal(rest) > 0 ? stashUnplaced(f, rest) : f;
}

/**
 * Расстановка в том виде, в каком её понимает ядро боя. Округление одно на весь
 * род: если бы каждый сектор округлялся сам, отряд из пяти лучников то прибывал,
 * то убывал на человека при перекладывании между секторами.
 */
export function toArmySetup(
  f: Formation,
  militia = 0,
  militiaArchers = 0,
  resolve = 0,
): ArmySetup {
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
  // `resolve` — то, с чем войско вышло в поле помимо снаряжения: у нас это
  // обряд перед боем. Ядро про источник не знает, а поля веры у `BattleInput`
  // нет вовсе — потому «моя вера бьёт твою» и не может случиться.
  return { sectors, gear, resolve };
}

/** Сколько бойцов строя стоит в секторе — число, которым считает ядро. */
export function sectorMen(f: Formation, id: Sector): number {
  let men = 0;
  for (const t of TROOP_IDS) men += menOf(t, f.sectors[id][t] ?? 0);
  return men;
}
