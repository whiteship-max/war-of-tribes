/**
 * Ширина поля — прибор пачки 2 боя по образцу EU4 (docs/battle_eu4.md, раздел 8).
 *
 * Решение владельца (26.09.2026): ширина фронта — одно число W, медиана фронта меньшей стороны в
 * боях, которые игра играет. Число выводится из записей боя, а не пишется рукой: у каждого боя
 * берётся сторона, у которой в бою меньше людей (фронт, тыл и резерв вместе), и фронт, который правило
 * развёртывания поставило бы ей **без ширины**, — вся первая линия, пешие и конные, на три полосы
 * (`bench.openFront`, одна формула на прибор и на размер W). Медиана таких чисел по боям и есть W: ширина
 * заполнена у меньшей стороны в половине настоящих боёв, а мелкий бой её не заполняет вовсе.
 *
 * Без ширины — потому что с ней правило развёртывания кладёт в ряд не больше W, а лишних уводит в резерв
 * (docs/battle_eu4.md, 14.5, «Перемер»): мерка по расставленным секторам упиралась бы в W сама, и неподвижная
 * точка проверялась бы собой. До поставки 1 прибор мерил сектора A, B, C записи боя — тогда расстановка
 * ширины не знала.
 *
 * Меряется в бойцах строя — тех единицах, в которых считает ядро (вес вида — по цене, `price.battleWeight`). Рогаток
 * прибор не знает и знать не должен: в запись боя у лагеря попадают только прошедшие (`world/works`).
 *
 * **Бои у ворот по событиям — волки и разбойники — в выборку W не входят** (слово владельца, docs/battle_eu4.md,
 * 14.29). Сила пришедших к воротам — доля нашей обороны, число руками до пересмотра баланса (14.24), и прибор не должен
 * зависеть от нерешённого входа. Прибор их видит и помечает (`gate`), но медиану берёт без них (`widthSample`).
 */
import { stackTotal, type BattleResult, type Side } from '@/battle';
import { openFront } from '@/battle/bench';
import { gateReportId } from '@/world/data/gate';
import type { WorldPulse } from '@/world/types';

/** Один бой глазами прибора: фронт полосы у меньшей и у большей стороны, бойцов строя. */
export interface Front {
  small: number;
  big: number;
  /** Вид отчёта мира (`Report.kind`), к которому приложен бой. */
  kind: string;
  /** Бой у ворот по событию (волки, разбойники): в выборку W не входит. */
  gate: boolean;
}

/** Фронт полосы стороны без ширины: вся её первая линия — пешие и конные, где бы ни встали, — на три полосы. */
const laneFront = (r: BattleResult, side: Side): number => openFront(r.sides[side].initial);

/**
 * Фронт полосы у меньшей и у большей стороны боя. Меньшая — по всем, кто вышел в бой, а не по
 * фронту: большая армия, поставившая половину в резерв, остаётся большей. Поровну — меньшей
 * считается та, у кого фронт уже.
 */
export function frontOf(r: BattleResult): { small: number; big: number } {
  const a = stackTotal(r.sides.attacker.initial);
  const d = stackTotal(r.sides.defender.initial);
  const fa = laneFront(r, 'attacker');
  const fd = laneFront(r, 'defender');
  return a < d || (a === d && fa <= fd) ? { small: fa, big: fd } : { small: fd, big: fa };
}

/** Медиана: при чётном числе — среднее двух средних. Пустой ряд — ноль. */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Бои пульса мира глазами прибора — каждая запись боя в его отчётах. Бой у ворот по событию узнаётся по последствию с
 * отметкой вызова (`HomeEffect.gate`): отчёт и последствие одного вызова мир кладёт под одно имя (`gateReportId`).
 */
export function pulseFronts(pulse: Pick<WorldPulse, 'reports' | 'effects'>): Front[] {
  const gates = new Set(pulse.effects.flatMap((e) => (e.gate ? [gateReportId(e.gate)] : [])));
  return pulse.reports.flatMap((r) => (r.battle ? [{ ...frontOf(r.battle.result), kind: r.kind, gate: gates.has(r.id) }] : []));
}

/** Выборка W — бои с отрядами мира, без боёв у ворот по событиям. */
export const widthSample = (fronts: readonly Front[]): Front[] => fronts.filter((f) => !f.gate);

/** Ширина W — медиана фронта полосы меньшей стороны по боям выборки, целых бойцов строя. */
export function widthOf(fronts: readonly Front[]): number {
  return Math.round(median(widthSample(fronts).map((f) => f.small)));
}
