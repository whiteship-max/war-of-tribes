// Стадия поселения — единственная шкала прогресса, которую видит игрок.
//
// Раньше их было две: эпоха и стадия. Осталась одна, и она про то, что видно
// в кадре: сколько народу, сколько построек и насколько они выросли, есть ли
// вокруг стена. Эпоха ушла в технический слой — она двигается технологиями,
// задаёт потолок уровней и материалы построек, а показывают её в Доме вождя.
import type { StageId } from '../types';

export interface StageDef {
  id: StageId;
  name: string;
  /** Короткое имя для строки состояния. */
  short: string;
  icon: string;
  description: string;
  /** Жителей в племени. */
  pop: number;
  /** Достроенных зданий. */
  buildings: number;
  /** Сумма уровней всех достроенных зданий. */
  levels: number;
  /** Уровень стены. 0 — укрепления не нужны. */
  wall: number;
  /**
   * Сколько золота приносит один человек за игровой день при полном налоге.
   * Это и есть новая ценность населения: город собирает с души вшестеро больше
   * лагеря, поэтому казна растёт не от указа вождя, а от того, что посёлок вырос.
   * Множитель самого налога — в data/policy.ts.
   */
  tax: number;
}

/** От младшей к старшей: `settlementStage` берёт последнюю подходящую. */
export const STAGES: StageDef[] = [
  {
    id: 'camp',
    name: 'Лагерь',
    short: 'Лагерь',
    icon: '⛺',
    description: 'Костёр, навесы и пятеро у огня.',
    pop: 0,
    buildings: 0,
    levels: 0,
    wall: 0,
    tax: 0.12,
  },
  {
    id: 'tribal',
    name: 'Племенное поселение',
    short: 'Поселение',
    icon: '🛖',
    description: 'Появились постоянные постройки и работа для всех.',
    pop: 8,
    buildings: 5,
    levels: 8,
    wall: 0,
    tax: 0.2,
  },
  {
    id: 'village',
    name: 'Деревня',
    short: 'Деревня',
    icon: '🏘️',
    description: 'Дворы вокруг площади, дороги и своё хозяйство.',
    pop: 16,
    buildings: 8,
    levels: 20,
    wall: 0,
    tax: 0.32,
  },
  {
    id: 'fortified',
    name: 'Укреплённая деревня',
    short: 'Укрепление',
    icon: '🏯',
    description: 'Деревня встала за стену: у неё есть что защищать.',
    pop: 26,
    buildings: 10,
    levels: 36,
    wall: 1,
    tax: 0.5,
  },
  {
    id: 'town',
    name: 'Город',
    short: 'Город',
    icon: '🏰',
    description: 'Каменная стена с башнями, площадь и мастерские.',
    pop: 40,
    buildings: 13,
    levels: 60,
    wall: 4,
    tax: 0.7,
  },
];

export const STAGE_BY_ID: Record<StageId, StageDef> = Object.fromEntries(
  STAGES.map((s) => [s.id, s]),
) as Record<StageId, StageDef>;

export const STAGE_ORDER: StageId[] = STAGES.map((s) => s.id);

export const stageIndex = (id: StageId): number => STAGE_ORDER.indexOf(id);
