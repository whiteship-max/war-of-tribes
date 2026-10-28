// Слова и перечни прибора `roam:report`, общие для входов, модели и разделов. Чисел здесь нет: числа — входы (`inputs.ts`)
// или двери кода.
import type { TroopStack } from '../../src/game/battle/kinds';

/** Лагерь бродяги (ГДД 3.5.3). */
export type Camp = 'open' | 'hidden' | 'ruin';
export const CAMPS: readonly Camp[] = ['open', 'hidden', 'ruin'];
export const CAMP_NAME: Record<Camp, string> = {
  open: 'открытый',
  hidden: 'скрытый',
  ruin: 'в руинах',
};

/** Цель дела бродяги против НПС (ГДД 3.6.1, 3.8.2): логово, ватага, ополчение села. */
export type Mark = 'lair' | 'band' | 'militia';
export const MARKS: readonly Mark[] = ['lair', 'band', 'militia'];

/** Происхождение героя (ГДД 3.1) — числами входа `origins`. */
export interface Origin {
  id: 'warrior' | 'merchant' | 'craftsman' | 'taken';
  name: string;
  band: TroopStack;
  gold: number;
  /** Провиант на старте, игровых дней пайка отряда. */
  foodDays: number;
  /** Множитель цены найма в городе. */
  hire: number;
  /** Множитель добычи боя. */
  loot: number;
  /** Множитель цены повышения (снаряжение). */
  gear: number;
  /** Множитель цены еды на рынке города. */
  food: number;
}
