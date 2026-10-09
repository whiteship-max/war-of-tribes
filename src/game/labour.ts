// Труд улучшения — одна формула на игру (`derived.upgradeWork`, стройка) и на сервер (`netlify/lib/gems.ts`: потолок
// цены ускорения — полный труд уровня, docs/gems.md). Две формулы разошлись бы молча: сервер брал бы за ускорение не то,
// что показывает кнопка. Без `@/`-импортов: модуль читает серверная часть.
import { UPGRADE_GROWTH } from './constants';
import type { BuildingDef } from './data/buildings';

/** Работа строителей на улучшение до уровня `toLevel` — растёт так же, как цена. */
export const upgradeWork = (def: Pick<BuildingDef, 'work'>, toLevel: number): number =>
  Math.round(def.work * Math.pow(UPGRADE_GROWTH, toLevel - 1));
