// Сила противников НПС бродяги (ПН-5, docs/gdd/path_of_sword.md, 3.6.2 и «Решения ПН-5»):
//
//   сила_противника = таблица_ступени[ступень_престижа] × доля_вида_цели × спелость
//
// **От престижа, а не от мощи отряда** (решение П6, эксплойт Е2): распустить людей перед боем не делает врага слабее — в формуле нет
// ни одного числа отряда. Таблица — как `gatePower` у ворот: ровный бой эталонного отряда ступени / 1.1, неподвижной точкой (правило 16)
// — раздел `npm run roam:report` «Сила НПС — неподвижная точка» начинает с записанной и печатает, сошлась ли. Пока автопилот стоит
// на заглушках (происхождения, договоры), таблица — заглушка игры `foeTable` тем же числом, что напечатал раздел; пороги ступеней —
// `stages`, доли видов и спелость — `foeShare`, `foeRipe` (`game/roamstubs`, за выключателем).
//
// Одна дверь на игру (мир бродяги: окно хода, засады, бой у логова и ватаги) и на прибор (автопилот пути). Модуль чистый и без `@/`.
import { prestigeStage } from '../game/sim/prestige';
import { roamStub } from '../game/roamstubs';
import { hash2 } from './geography';

/** Вид цели (ГДД 3.6.1): логово, ватага НПС, ополчение села. */
export type FoeKind = 'lair' | 'band' | 'militia';
export const FOE_KINDS: readonly FoeKind[] = ['lair', 'band', 'militia'];

/** Вид цели словами — для окна хода и летописи. */
export const FOE_WORDS: Readonly<Record<FoeKind, string>> = { lair: 'логово', band: 'ватага', militia: 'ополчение села' };

/** Ступень престижа для силы НПС — дверью ступеней (`sim/prestige.prestigeStage`) по порогам `stages`. */
export const foeStage = (prestige: number): number => prestigeStage(Math.max(0, prestige), roamStub('stages'));

/** Спелость противника `key` (точка или дорога) мира `seed`: доля силы ступени между `foeRipe` — хешем, без кости партии. */
export function foeRipe(seed: number, key: string): number {
  const [lo, hi] = roamStub('foeRipe');
  let h = seed | 0;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  return lo + (hi - lo) * hash2(0x6f3e, h, key.length);
}

/**
 * Сила противника вида `kind` при престиже героя `prestige` и спелости `ripe` — мощи (`price.troopPower`). Таблица и доли могут прийти
 * доводом — так их пробует вывод прибора; игра зовёт без них.
 */
export function foePower(
  prestige: number,
  kind: FoeKind,
  ripe: number,
  table: readonly number[] = roamStub('foeTable'),
  share: Readonly<Record<FoeKind, number>> = roamStub('foeShare'),
): number {
  const stage = Math.min(table.length - 1, foeStage(prestige));
  return Math.max(1, Math.round(table[stage] * share[kind] * ripe));
}
