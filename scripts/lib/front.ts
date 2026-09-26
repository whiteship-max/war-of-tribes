/**
 * Ширина поля — прибор пачки 2 боя по образцу EU4 (docs/battle_eu4.md, раздел 8).
 *
 * Решение владельца (26.09.2026): ширина фронта — одно число W, медиана фронта меньшей стороны в
 * боях, которые игра играет. Число выводится из записей боя, а не пишется рукой: у каждого боя
 * берётся сторона, у которой в бою меньше людей (фронт, тыл и резерв вместе), и её первая линия —
 * сектора A, B, C — делится на три полосы. Медиана таких чисел по боям и есть W: ширина заполнена
 * у меньшей стороны в половине настоящих боёв, а мелкий бой её не заполняет вовсе.
 *
 * Меряется в бойцах строя — тех единицах, в которых считает ядро (латник весит восьмерых). Рогаток
 * прибор не знает и знать не должен: в запись боя у лагеря попадают только прошедшие (`world/works`).
 */
import { FRONT, stackTotal, type BattleResult, type Side } from '@/battle';

/** Один бой глазами прибора: фронт полосы у меньшей и у большей стороны, бойцов строя. */
export interface Front {
  small: number;
  big: number;
  /** Вид отчёта мира (`Report.kind`), к которому приложен бой. */
  kind: string;
}

/** Первая линия стороны на одну полосу: сумма секторов A, B, C на их число. */
const laneFront = (r: BattleResult, side: Side): number =>
  FRONT.reduce((n, s) => n + stackTotal(r.sides[side].sectors[s].initial), 0) / FRONT.length;

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

/** Ширина W — медиана фронта полосы меньшей стороны по боям, целых бойцов строя. */
export function widthOf(fronts: readonly Front[]): number {
  return Math.round(median(fronts.map((f) => f.small)));
}
