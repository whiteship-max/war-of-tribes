// Стадии поселений, отношения и миссии: подписи, иконки и цвета в одном месте.
import { SIDE_COLOR } from '../../side';
import type { Mission, Relation, Stage } from '../types';

export interface StageDef {
  id: Stage;
  name: string;
  icon: string;
  /** Пороги: чтобы дорасти, нужны и мощь, и население. */
  minPower: number;
  minPop: number;
}

/** От слабого к сильному: stageOf берёт последнюю подходящую. */
export const STAGES: StageDef[] = [
  { id: 'camp', name: 'Стоянка', icon: '⛺', minPower: 0, minPop: 0 },
  { id: 'village', name: 'Деревня', icon: '🏘️', minPower: 30, minPop: 12 },
  { id: 'stronghold', name: 'Острог', icon: '🏯', minPower: 90, minPop: 30 },
  { id: 'town', name: 'Крепость', icon: '🏙️', minPower: 200, minPop: 65 },
];

/**
 * Замок рисуется своим значком поверх стадии: это не ступень развития, а вид
 * цели — крепость с казной. Город поэтому носит городской значок, а не замковый.
 */
export const CASTLE_ICON = '🏰';

export const STAGE_BY_ID: Record<Stage, StageDef> = Object.fromEntries(
  STAGES.map((s) => [s.id, s]),
) as Record<Stage, StageDef>;

/** Стадия по мощи и населению. Иконка на карте меняется вместе с ней. */
export function stageOf(power: number, pop: number): Stage {
  let out: Stage = 'camp';
  for (const s of STAGES) if (power >= s.minPower && pop >= s.minPop) out = s.id;
  return out;
}

export interface RelationDef {
  id: Relation;
  name: string;
  color: string;
}

export const RELATION_META: Record<Relation, RelationDef> = {
  // Свои и враги — цвет стороны, один на игру (`side.ts`): золото и красный, как в бою и в отчёте.
  self: { id: 'self', name: 'Своё', color: SIDE_COLOR.ours },
  ally: { id: 'ally', name: 'Союзники', color: '#6bb6e8' },
  neutral: { id: 'neutral', name: 'Нейтралы', color: '#cbbca6' },
  enemy: { id: 'enemy', name: 'Враги', color: SIDE_COLOR.foe },
  barbarian: { id: 'barbarian', name: 'Варвары', color: '#a2795a' },
};

/** Порядок для легенды. */
export const RELATION_ORDER: Relation[] = ['self', 'ally', 'neutral', 'enemy', 'barbarian'];

export interface MissionDef {
  id: Mission;
  name: string;
  icon: string;
  description: string;
}

export const MISSIONS: MissionDef[] = [
  {
    id: 'raid',
    name: 'Ударить',
    icon: '⚔️',
    description: 'Разбить гарнизон и унести добычу. Племя цели затаит обиду.',
  },
  {
    id: 'scout',
    name: 'Разведать',
    icon: '👣',
    description: 'Узнать, сколько там бойцов. Сведения стареют, разведку повторяют.',
  },
  {
    id: 'support',
    name: 'Поддержать',
    icon: '🤝',
    description: 'Постоять в городе союзника и укрепить дружбу.',
  },
];

export const MISSION_BY_ID: Record<Mission, MissionDef> = Object.fromEntries(
  MISSIONS.map((m) => [m.id, m]),
) as Record<Mission, MissionDef>;

/** Цвет племени на карте — виден в легенде и в карточке. */
export const TRIBE_COLORS: string[] = [
  '#8f7ad6',
  '#4fa88a',
  '#d0894a',
  '#5f92c8',
  '#c26a9b',
  '#9aa84c',
  '#c9705f',
  '#57a5b8',
];

export const BARBARIAN_NAMES: string[] = [
  'Становище лиходеев',
  'Стан бродяг',
  'Костры кочевников',
  'Логово разбойников',
  'Стоянка пришлых',
];
