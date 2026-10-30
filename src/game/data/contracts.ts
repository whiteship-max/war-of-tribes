// Договоры НПС бродяги (ПН-7, docs/gdd/path_of_sword.md, 3.8 и «Решения ПН-7»): виды договоров Среза 1, эталонные отряды тиров и два
// числа вида — множитель содержания K и доля риска R в плате (3.8.3).
//
// K и R **выведены, а не взяты на глаз**: `npm run roam:report`, раздел «Договоры: K и R видов», по целям ГДД 20.2 — эталон тира,
// живущий договорами вида, покрывает своё содержание с запасом (K); доля риска возмещает людей, которых эталон теряет в боях договора
// (R). Руками их не правят: тест прибора «записано = выведено» сверяет их с выводом. Эталоны — правило ГДД 4.3 (тир III — состав мерки
// автопилота `autopilot.MIX`, 70 человек; тест прибора).
//
// Без импортов значений: модуль читают игра, прибор и вывод таблицы наград дел сервера (`scripts/deeds`).
import type { TroopStack } from '../battle/kinds';

/** Вид договора Среза 1 (3.8.2). «Сопроводить караван» — Срез 3 (караванов НПС точкой мира нет), «Карательный поход» — разбой (Р10). */
export type DealKind = 'lair' | 'vataga' | 'defend' | 'cargo' | 'head' | 'garrison' | 'scout';
export const DEAL_KINDS: readonly DealKind[] = ['lair', 'vataga', 'defend', 'cargo', 'head', 'garrison', 'scout'];

/** Договоров разом — до трёх (3.8.4; четвёртый — Капитану, ступени статуса — Срез 3). Число правила, одно на игру и сервер. */
export const CONTRACTS_MAX = 3;

/** Заказчик (3.8.1): вольный город — доска, кастелян — у замка, село — староста при угрозе. */
export type DealFrom = 'town' | 'castellan' | 'village';

/** Тир договора — I, II, III (3.8.2, 3.9.1). */
export type DealTier = 1 | 2 | 3;

export interface DealKindDef {
  name: string;
  /** С какого тира вид даётся (3.8.2, столбец «Тир»). */
  tier: DealTier;
  /**
   * Чем решается: `strike` — удар отряда по цели (логово, ватага), `defend` — бой у ворот села (ватага нападает), `null` — без боя
   * с целью (груз, служба, разведка; засады в пути — как у всякого хода).
   */
  fight: 'strike' | 'defend' | null;
}

export const DEAL_DEFS: Readonly<Record<DealKind, DealKindDef>> = {
  lair: { name: 'Сжечь логово', tier: 1, fight: 'strike' },
  vataga: { name: 'Перехватить ватагу', tier: 1, fight: 'strike' },
  defend: { name: 'Защитить село', tier: 1, fight: 'defend' },
  cargo: { name: 'Доставить груз', tier: 1, fight: null },
  head: { name: 'Охота за головой', tier: 2, fight: 'strike' },
  garrison: { name: 'Гарнизонная служба', tier: 2, fight: null },
  scout: { name: 'Разведать замок', tier: 1, fight: null },
};

/** Какие виды даёт заказчик (3.8.1–3.8.2): город — бой и груз, кастелян — служба и разведка, село — защита и ватага у села. */
export const FROM_KINDS: Readonly<Record<DealFrom, readonly DealKind[]>> = {
  town: ['lair', 'vataga', 'cargo', 'head'],
  castellan: ['garrison', 'scout'],
  village: ['defend', 'vataga'],
};

/** Эталонные отряды тира (ГДД 4.3): I — 12 человек, II — 30, III — 70 составом мерки автопилота. Плата — от них, не от отряда игрока. */
export const ETALONS: readonly TroopStack[] = [
  { spearman: 8, clubman: 4 },
  { spearman: 12, archer: 8, axeman: 6, swordsman: 4 },
  { spearman: 28, archer: 21, legionary: 14, rider: 7 },
];

/** Множитель содержания вида K — вывод `roam:report` («Договоры: K и R видов»). */
export const DEAL_K: Readonly<Record<DealKind, number>> = {
  lair: 2.56,
  vataga: 3.34,
  defend: 3.61,
  cargo: 3.57,
  head: 2.4,
  garrison: 2.39,
  scout: 2,
};

/** Доля риска вида R — вывод `roam:report` («Договоры: K и R видов»). */
export const DEAL_R: Readonly<Record<DealKind, number>> = {
  lair: 53.87,
  vataga: 50.91,
  defend: 42.78,
  cargo: 6.26,
  head: 55.75,
  garrison: 0,
  scout: 8.24,
};
