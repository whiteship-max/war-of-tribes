// Вывод K и R видов договоров (ПН-7, docs/gdd/path_of_sword.md, «Решения ПН-7» и 20.2): раздел `roam:report` «Договоры: K и R видов» и
// тест прибора «записано = выведено» (`data/contracts.DEAL_K`, `DEAL_R`).
//
// ЦЕЛИ (записаны в ГДД, 20.2):
//   Д1 (K) — эталон тира, живущий договорами вида, **покрывает своё содержание с запасом 25 %**: плата содержанием за срок договора —
//      не меньше содержания за всё время, что договор занимает отряд, — от взятия до захода, на котором можно взять следующий
//      (дорога обычным маршем, стоянка, ожидание захода: 3–5 заходов в сутки в часы 8–23, правило 2.4). K = 1.25 × Σцикл / Σсрок.
//   Д2 (R) — доля риска **возмещает людей, которых эталон теряет в боях договора**: бой с целью (удар или набег на село) и засады на
//      дорогах договора по шансу двери встреч, павшие — по цене найма по основе рынка (`townrules.hireBase`). R = Σпотерь / Σ(мощь ×
//      LAIR_GOLD_PER_POWER). Без боя с целью и без дороги (служба) — R = 0.
//
// ВЫБОРКА — двери игры: доски (`world/dealboard.boardsAt`) у ближайшего к каждому из мест Сицилии (`world/spawn.SICILY`) вольного города
// (и его кастеляна), у ближайшего села при угрозе — на `SHIFTS` привозах; логова — мира места (`world/gen`, сид — номер места); тиры
// I, II, III — престижем порога первой ступени тира (`contractrules.stageTier` по заглушке `stages`). Бои — ядром мира (`encounter`).
// Всё — функция выборки: та же выборка — те же числа.
import type { TroopId } from '../../src/game/types';
import type { TroopStack } from '../../src/game/battle/kinds';
import { troopTotal } from '../../src/game/battle/kinds';
import { DEAL_KINDS, type DealKind, type DealTier } from '../../src/game/data/contracts';
import { dealDays, etalonOf, stageTier } from '../../src/game/contractrules';
import { hireBase } from '../../src/game/townrules';
import { gameDaysPerHour } from '../../src/game/pace';
import { DAY_LENGTH } from '../../src/game/constants';
import { SEASONS, SEASON_SECONDS } from '../../src/game/data/seasons';
import { mixSeed, seeded } from '../../src/game/sim/random';
import { roamStub } from '../../src/game/roamstubs';
import { boardsAt, type DealOffer, type DealPlace } from '../../src/world/dealboard';
import { pointsIn } from '../../src/world/roampoints';
import { generateWorld, isLair } from '../../src/world/gen';
import { SICILY } from '../../src/world/spawn';
import { ambushChance, ambushFight, strikeFight } from '../../src/world/encounter';
import { foePower } from '../../src/world/roamfoes';
import { LAIR_GOLD_PER_POWER } from '../../src/world/data/tuning';

/** Запас Д1: эталон покрывает содержание с запасом 25 %. */
export const KEEP_MARGIN = 0.25;
/** Привозов на заказчика в выборке и боёв на вид и тир (не больше). */
export const SHIFTS = 8;
export const FIGHTS_PER = 24;
/** Боёв засады на тир — средняя цена засады эталона. */
const AMBUSH_FIGHTS = 12;
/** Первая привозная минута выборки: 08:00 UTC 01.10.2026 (сетка привоза — `game/shift`). */
export const T0 = Date.UTC(2026, 9, 1, 8);
/** Часы партии для заметности колонны на дороге: лето, утро второго года — ни ночи, ни зимы (как у раздела «Точки мира»). */
const SUMMER = SEASON_SECONDS * (SEASONS.length + SEASONS.indexOf('summer')) + DAY_LENGTH * 1.25;

/** Предложение выборки и его тир. */
export interface DealSample {
  offers: DealOffer[];
}

/** Порог престижа первой ступени тира `t` (по заглушке `stages`). */
export function tierPrestige(t: DealTier): number {
  const stages = roamStub('stages');
  const i = stages.findIndex((_, st) => stageTier(st) === t);
  return stages[Math.max(0, i)];
}

const near2 = (seed: number, at: { x: number; y: number }, kind: 'town' | 'village'): DealPlace | null => {
  const r = 30;
  const list = pointsIn(seed, at.x - r, at.y - r, at.x + r + 1, at.y + r + 1).filter((p) => p.kind === kind);
  list.sort((a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y) || (a.id < b.id ? -1 : 1));
  return list[0] ? { id: list[0].id, x: list[0].x, y: list[0].y, name: list[0].name } : null;
};

/** Выборка предложений: доски у мест Сицилии на `SHIFTS` привозах, три тира. */
export function dealSample(shifts = SHIFTS): DealSample {
  const offers: DealOffer[] = [];
  SICILY.forEach((spot, i) => {
    const seed = i + 1;
    const lairs = generateWorld(seed, spot)
      .settlements.filter(isLair)
      .map((st) => ({ id: st.id, x: st.x, y: st.y, name: st.name }));
    const near = { lairs, beaten: (): boolean => false };
    const places = [near2(seed, spot, 'town'), near2(seed, spot, 'village')].filter((p): p is DealPlace => p !== null);
    for (const t of [1, 2, 3] as DealTier[]) {
      for (let w = 0; w < shifts; w++) {
        const now = T0 + w * 3 * 3600_000;
        for (const p of places) for (const b of boardsAt(seed, p, now, tierPrestige(t), near)) if (b.from.x === p.x && b.from.y === p.y) offers.push(...b.offers);
      }
    }
  });
  return { offers };
}

/** Дни, что договор занимает отряд до следующей доски: удар — туда и назад, груз и разведка — до города цели, стоянка — стоянка. */
export function busyDays(o: Pick<DealOffer, 'kind' | 'roadMs' | 'stand'>): number {
  const road = (o.roadMs / 3_600_000) * gameDaysPerHour();
  if (o.kind === 'defend' || o.kind === 'garrison') return o.stand;
  if (o.kind === 'cargo' || o.kind === 'scout') return road;
  return 2 * road;
}

/** Заходы игрока: 3–5 в сутки в часы 8–23 (правило 2.4), часы от начала — та же схема, что у автопилота пути. */
function sessionHours(rng: () => number, days: number, per: readonly [number, number], wake: readonly [number, number]): number[] {
  const out: number[] = [];
  for (let d = 0; d < days; d++) {
    const n = per[0] + Math.floor(rng() * (per[1] - per[0] + 1));
    for (let i = 0; i < n; i++) out.push(d * 24 + wake[0] + (wake[1] - wake[0]) * rng());
  }
  return out.sort((a, b) => a - b);
}

/** Цикл договора, игр. дн.: от захода, на котором взят, до первого захода не раньше его конца. */
export function cycleDays(o: Pick<DealOffer, 'kind' | 'roadMs' | 'stand'>, take: number, hours: readonly number[]): number {
  const end = take + busyDays(o) / gameDaysPerHour();
  const next = hours.find((h) => h >= end) ?? end;
  return (next - take) * gameDaysPerHour();
}

export interface KindRow {
  kind: DealKind;
  n: number;
  /** Средние: срок, занятость, цикл (игр. дн.). */
  term: number;
  busy: number;
  cycle: number;
  K: number;
  /** Средние: мощь противника, потери эталона в золоте найма, боёв. */
  power: number;
  loss: number;
  fights: number;
  R: number;
}

const r2 = (x: number): number => Math.round(x * 100) / 100;

/** Цена павших по найму по основе рынка. */
const lossCost = (lost: TroopStack): number =>
  (Object.entries(lost) as [TroopId, number][]).reduce((t, [id, n]) => t + Math.max(0, n) * hireBase(id), 0);

/** Средняя цена засады эталона тира: ватага ступени тира средней спелости нападает в чистом поле. */
function ambushCost(t: DealTier, at: { x: number; y: number }): number {
  const ripe = roamStub('foeRipe');
  const power = foePower(tierPrestige(t), 'band', (ripe[0] + ripe[1]) / 2);
  let sum = 0;
  for (let i = 0; i < AMBUSH_FIGHTS; i++) sum += lossCost(ambushFight(power, etalonOf(t), at, mixSeed(0x7a3b, i * 7 + t)).lost);
  return sum / AMBUSH_FIGHTS;
}

/**
 * K и R видов (Д1, Д2) по выборке. `sessions` — правило заходов 2.4 (входом прибора). Возвращает по виду и строки для печати.
 */
export function deriveDealKR(
  sample: DealSample,
  sessions: { per: readonly [number, number]; wake: readonly [number, number] },
): { K: Record<DealKind, number>; R: Record<DealKind, number>; rows: KindRow[] } {
  const rng = seeded(0x5e55);
  const hours = sessionHours(rng, 60, sessions.per, sessions.wake);
  const amb = new Map<DealTier, number>();
  const ambushOf = (t: DealTier, at: { x: number; y: number }): number => {
    if (!amb.has(t)) amb.set(t, ambushCost(t, at));
    return amb.get(t) as number;
  };
  const rows: KindRow[] = [];
  const K = {} as Record<DealKind, number>;
  const R = {} as Record<DealKind, number>;
  for (const kind of DEAL_KINDS) {
    const list = sample.offers.filter((o) => o.kind === kind);
    let term = 0;
    let busy = 0;
    let cycle = 0;
    list.forEach((o) => {
      // Заход, на котором взят, — случайный из первых двух третей схемы: следующий заход за ним в схеме есть.
      const take = hours[Math.floor(rng() * Math.floor((hours.length * 2) / 3))];
      term += dealDays(o.kind, o.roadMs, o.stand);
      busy += busyDays(o);
      cycle += cycleDays(o, take, hours);
    });
    // Д2: бои договора — не больше `FIGHTS_PER` на тир; засады — шансом двери встреч на дорогах договора.
    let power = 0;
    let loss = 0;
    let fights = 0;
    for (const t of [1, 2, 3] as DealTier[]) {
      const some = list.filter((o) => o.tier === t).slice(0, FIGHTS_PER);
      const band = etalonOf(t);
      some.forEach((o, i) => {
        const seed = mixSeed(0x0dea1, i * 31 + t * 7 + DEAL_KINDS.indexOf(kind));
        let cost = 0;
        if (kind === 'lair' || kind === 'vataga' || kind === 'head') {
          cost += lossCost(strikeFight(o.power, band, o.target, o.from, seed, o.target.id).lost);
          fights++;
        } else if (kind === 'defend') {
          cost += lossCost(ambushFight(o.power, band, o.target, seed).lost);
          fights++;
        }
        const roads = kind === 'defend' || kind === 'garrison' ? 0 : kind === 'cargo' || kind === 'scout' ? 1 : 2;
        if (roads > 0 && o.roadMs > 0) {
          const way = { from: { x: o.from.x, y: o.from.y }, to: { x: o.target.x, y: o.target.y }, at: 0, until: o.roadMs };
          cost += roads * ambushChance(way, troopTotal(band), SUMMER, 0) * ambushOf(t, o.target);
        }
        power += kind === 'garrison' ? 0 : o.power;
        loss += cost;
      });
    }
    const n = list.length;
    K[kind] = n > 0 && term > 0 ? r2(((1 + KEEP_MARGIN) * cycle) / term) : 0;
    R[kind] = power > 0 ? r2(loss / (power * LAIR_GOLD_PER_POWER)) : 0;
    rows.push({ kind, n, term: term / Math.max(1, n), busy: busy / Math.max(1, n), cycle: cycle / Math.max(1, n), K: K[kind], power, loss, fights, R: R[kind] });
  }
  return { K, R, rows };
}

/** Ватага засады на дорогах выборки — для печати: сила по тирам. */
export const ambushPowerOf = (t: DealTier): number => {
  const ripe = roamStub('foeRipe');
  return foePower(tierPrestige(t), 'band', (ripe[0] + ripe[1]) / 2);
};
