// Встречи отряда бродяги с НПС (ПН-5, docs/gdd/path_of_sword.md, 3.6.1–3.6.3 и «Решения ПН-5»): засада на дороге и удар по цели.
//
// ЗАСАДА (3.6.3) — `pursuit` + бой в минуту встречи (как перехват полководца, `LocalWorld.resolveChase`):
//   — шанс — от заметности колонны на этой дороге (дверь видимости `world/sight`: местность клеток пути, режим марша, люди, ночь и
//     сезон часов партии) и длины дороги: `ambushBase` на 10 клеток при заметности 1, не выше `ambushCap` (заглушки игры). Тише идёшь —
//     реже засада: своей формулы заметности здесь нет;
//   — кость — из сида пути и минуты прихода (`ambushRoll`): та же дорога — та же кость. **Заморожено при отправке** (`tripOf` →
//     `RoamState.trip`): что показано в окне хода («засада N % · если засада — бой с ~M»), то и сыграет;
//   — где и когда — ватага ждёт у дороги, встреча — уравнением перехвата (`pursuit.intercept`) в минуту приказа;
//   — сила засады — ватага НПС по ступени престижа (`world/roamfoes`), не по отряду.
// УДАР по цели (логово, ватага; ополчение села — дверь готова, разбоя в Срезе 1 нет, Р10) — в минуту прихода, сила заморожена при
// отправке. Бой — ядром мира `world/battle.resolveField` → `simulateBattle`; отряд НПС — тем же генератором, что набег логова
// (`garrison.raidingParty`), как в выводе силы НПС прибора. Место боя — штраф кости нападающему (`place.groundAt`) по общей земле.
//
// Встречи с НПС считает клиент: точки НПС свои (как логова и набеги у лорда), сервер о них не знает (Срез 1). Модуль чистый:
// часов не читает, время приходит доводом.
import type { Coord } from './types';
import type { TroopStack } from '../game/battle/kinds';
import { kindsOf, troopLosses } from '../game/battle/price';
import { roamStub } from '../game/roamstubs';
import { resolveField, type FieldOutcome } from './battle';
import { raidingParty, menOfPower } from './garrison';
import { groundAt } from './place';
import { intercept } from './pursuit';
import { WAR_GROUND_SEED } from './pvp';
import { hash2 } from './geography';
import { bandLook, conspicuity, partyTimeAt } from './sight';
import { roamCell, roamWhere } from './roam';
import { foePower, foeRipe, type FoeKind } from './roamfoes';
import type { RoamTrip, RoamWay } from './roammove';

/** Соль кости засады. */
export const AMBUSH_SALT = 0x4a5b;
/** Сколько точек дороги меряет заметность колонны. */
const SAMPLES = 8;

const roadCells = (w: Pick<RoamWay, 'from' | 'to'>): number => Math.hypot(w.to.x - w.from.x, w.to.y - w.from.y);

/**
 * Шанс засады на ход `way` (ГДД 3.6.3): заметность колонны — средняя по дороге дверью `world/sight` (местность клеток пути, режим
 * марша, `men` человек, ночь и сезон часов партии — `partyTime` в минуту мира `now`), на длину дороги; не выше потолка.
 */
export function ambushChance(way: RoamWay, men: number, partyTime: number, now: number): number {
  const cells = roadCells(way);
  if (cells < 1 || way.until <= way.at) return 0;
  const clock = { time: partyTime, at: now };
  let sum = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const t = way.at + ((way.until - way.at) * (i + 0.5)) / SAMPLES;
    sum += conspicuity(bandLook({ way, camp: null }, men, partyTimeAt(clock, t), t));
  }
  return Math.min(roamStub('ambushCap'), roamStub('ambushBase') * (sum / SAMPLES) * (cells / 10));
}

/** Дорога — ключ спелости засады: цель и минута прихода. */
const roadKey = (w: Pick<RoamWay, 'to' | 'until'>): string => `road:${w.to.x}:${w.to.y}:${Math.floor(w.until / 60_000)}`;

/** Что показать до приказа: шанс засады, её сила и сколько в ней бойцов строя. */
export interface AmbushOdds {
  p: number;
  power: number;
  men: number;
}

/** Засада на ход `way`: шанс (видимостью) и сила (престижем) — числа окна хода, те же, что заморозит приказ. */
export function ambushOdds(way: RoamWay, men: number, partyTime: number, now: number, prestige: number, seed: number): AmbushOdds {
  const power = foePower(prestige, 'band', foeRipe(seed, roadKey(way)));
  return { p: ambushChance(way, men, partyTime, now), power, men: menOfPower(power) };
}

/** Кость засады — из сида пути и минуты прихода (3.6.3), 0..1: та же дорога — та же кость. */
export function ambushRoll(seed: number, way: Pick<RoamWay, 'to' | 'until'>): number {
  return hash2((AMBUSH_SALT ^ Math.imul(seed | 0, 0x2545f491)) >>> 0, way.to.x * 4099 + way.to.y, Math.floor(way.until / 60_000));
}

/** Удар по цели, замороженный при отправке. */
export interface StrikeAim {
  id: string;
  kind: FoeKind;
  name: string;
  power: number;
}

/**
 * Встреча хода, замороженная в минуту приказа `now` (ГДД 3.6.3): шанс и сила засады — те же функции, что окно хода; кость выпала —
 * ватага ждёт у дороги на доле пути из хеша, и встреча — уравнением перехвата (`pursuit.intercept`). `aim` — удар по цели в минуту
 * прихода (его сила посчитана тем же престижем, что окно).
 */
export function tripOf(way: RoamWay, men: number, partyTime: number, now: number, prestige: number, seed: number, aim?: StrikeAim): RoamTrip {
  const odds = ambushOdds(way, men, partyTime, now, prestige, seed);
  const trip: RoamTrip = { until: way.until, to: { x: way.to.x, y: way.to.y }, odds: { p: odds.p, power: odds.power } };
  if (odds.p > 0 && ambushRoll(seed, way) < odds.p) {
    const span = way.until - way.at;
    const f = 0.2 + 0.6 * hash2(AMBUSH_SALT + 1, way.to.x, Math.floor(way.until / 60_000));
    const lie = roamWhere(way, way.at + span * f);
    // Ватага выходит из засады навстречу колонне — той же скоростью, что идёт колонна.
    const speed = roadCells(way) / Math.max(1, span);
    const meet = intercept(lie, speed, { from: way.from, to: way.to, departAt: way.at, arriveAt: way.until }, way.at);
    const at = meet ? Math.min(way.until, Math.max(way.at, Math.round(meet.time))) : way.at + Math.round(span * f);
    const cell = roamCell(way, at);
    trip.ambush = { at, cell: { x: cell.x, y: cell.y }, seed: (Math.imul(seed | 0, 31) ^ at) >>> 0 };
  }
  if (aim) trip.strike = { id: aim.id, kind: aim.kind, name: aim.name, power: aim.power, seed: (Math.imul(seed | 0, 17) ^ way.until) >>> 0 };
  return trip;
}

/** Итог боя для отряда: взяли ли верх, кого потеряли, какую долю потерял противник. */
export interface Fought {
  won: boolean;
  lost: TroopStack;
  foeLoss: number;
  /** Сколько бойцов строя было у противника. */
  foeMen: number;
  field: FieldOutcome;
}

const ourLosses = (band: TroopStack, field: FieldOutcome, side: 'attacker' | 'defender'): TroopStack =>
  field.result ? troopLosses(band, field.result.sides[side].losses) : {};

/** Засада: ватага НПС силой `power` нападает на отряд `band` в клетке `cell` (штраф места — нападающему). */
export function ambushFight(power: number, band: TroopStack, cell: Coord, seed: number): Fought {
  const foe = raidingParty(seed, `ambush-${seed}`, power);
  const field = resolveField({
    seed,
    attacker: { kinds: foe.kinds },
    defender: { kinds: kindsOf(band) },
    ground: groundAt(WAR_GROUND_SEED, { x: Math.round(cell.x), y: Math.round(cell.y) }),
  });
  return { won: !field.won, lost: ourLosses(band, field, 'defender'), foeLoss: field.attackerLoss, foeMen: menOfPower(power), field };
}

/** Удар отряда `band` по цели силой `power` в клетке `cell`, подходя из `from` (штраф места — нам, нападающим). */
export function strikeFight(power: number, band: TroopStack, cell: Coord, from: Coord, seed: number, id: string): Fought {
  const foe = raidingParty(seed, `strike-${id}`, power);
  const field = resolveField({
    seed,
    attacker: { kinds: kindsOf(band) },
    defender: { kinds: foe.kinds },
    ground: groundAt(WAR_GROUND_SEED, { x: Math.round(cell.x), y: Math.round(cell.y) }, { x: Math.round(from.x), y: Math.round(from.y) }),
  });
  return { won: field.won, lost: ourLosses(band, field, 'attacker'), foeLoss: field.defenderLoss, foeMen: menOfPower(power), field };
}

/** Строка окна хода: «засада N % · если засада — бой с ~M» (ГДД 3.6.3). */
export function ambushWords(o: AmbushOdds): string {
  if (o.p <= 0) return 'Засады не будет: дороги нет.';
  const pct = o.p * 100;
  return `засада ${pct < 1 ? '<1' : Math.round(pct)} % · если засада — бой с ~${o.men}`;
}
