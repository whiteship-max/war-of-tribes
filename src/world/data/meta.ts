// Стадии поселений, отношения и миссии: подписи, иконки и цвета в одном месте.
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
  { id: 'camp', name: 'Лагерь', icon: '⛺', minPower: 0, minPop: 0 },
  { id: 'village', name: 'Деревня', icon: '🏘️', minPower: 30, minPop: 12 },
  { id: 'stronghold', name: 'Укреплённое поселение', icon: '🏯', minPower: 90, minPop: 30 },
  { id: 'town', name: 'Город', icon: '🏙️', minPower: 200, minPop: 65 },
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
  self: { id: 'self', name: 'Своё', color: '#e8a43c' },
  ally: { id: 'ally', name: 'Союзники', color: '#6bb6e8' },
  neutral: { id: 'neutral', name: 'Нейтралы', color: '#cbbca6' },
  enemy: { id: 'enemy', name: 'Враги', color: '#e06b5a' },
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
    name: 'Атаковать',
    icon: '⚔️',
    description: 'Разбить гарнизон и унести добычу. Племя цели затаит обиду.',
  },
  {
    id: 'scout',
    name: 'Разведать',
    icon: '👣',
    description: 'Узнать, сколько там войска. Данные стареют — разведку повторяют.',
  },
  {
    id: 'support',
    name: 'Поддержать',
    icon: '🤝',
    description: 'Постоять в союзном поселении и укрепить дружбу.',
  },
];

export const MISSION_BY_ID: Record<Mission, MissionDef> = Object.fromEntries(
  MISSIONS.map((m) => [m.id, m]),
) as Record<Mission, MissionDef>;

/** Имена племён. Берутся по кругу — их всегда больше, чем племён в мире. */
export const TRIBE_NAMES: string[] = [
  'Дети Реки',
  'Волки Пепла',
  'Люди Кремня',
  'Сыны Тумана',
  'Хранители Соли',
  'Оленьи Тропы',
  'Люди Чёрной Воды',
  'Совиный Холм',
  'Гончие Ветра',
  'Каменные Рога',
];

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

/** Названия чужих поселений: собираются как «Ольховый брод». */
export const PLACE_FIRST: string[] = [
  'Ольховый',
  'Медвежий',
  'Волчий',
  'Тихий',
  'Дальний',
  'Кремнёвый',
  'Соляной',
  'Туманный',
  'Оленный',
  'Вороний',
  'Быстрый',
  'Старый',
];

export const PLACE_SECOND: string[] = [
  'брод',
  'холм',
  'лог',
  'стан',
  'ручей',
  'яр',
  'мыс',
  'дол',
  'бор',
  'камень',
  'плёс',
  'клин',
];

export const BARBARIAN_NAMES: string[] = [
  'Лагерь чужаков',
  'Стан бродяг',
  'Костры кочевников',
  'Логово разбойников',
  'Стоянка пришлых',
];
