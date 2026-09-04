import type { GameState, ResourceId } from '../types';
import { armySize, buildingOfType, jobCounts } from '../derived';

export interface QuestDef {
  id: string;
  title: string;
  description: string;
  check: (s: GameState) => boolean;
  /** Текущий прогресс для отображения: [сделано, нужно]. */
  progress?: (s: GameState) => [number, number];
  reward: Partial<Record<ResourceId, number>>;
}

const pop = (n: number) => (s: GameState): [number, number] => [Math.min(s.villagers.length, n), n];

const hutLevel = (s: GameState): number => buildingOfType(s, 'hut')?.level ?? 0;

export const QUESTS: QuestDef[] = [
  {
    id: 'assign_workers',
    title: 'Распредели людей',
    description: 'Назначь хотя бы 3 жителей на работу.',
    check: (s) => s.villagers.length - jobCounts(s).idle >= 3,
    progress: (s) => [Math.min(3, s.villagers.length - jobCounts(s).idle), 3],
    reward: { food: 10 },
  },
  {
    id: 'first_upgrade',
    title: 'Второй уровень',
    description: 'Подними любое здание до 2 уровня: +1 рабочее место и +10% выработки.',
    check: (s) => s.buildings.some((b) => b.level >= 2),
    reward: { food: 15, wood: 10 },
  },
  {
    id: 'pop_8',
    title: 'Растущее племя',
    description: 'Достигни населения 8.',
    check: (s) => s.villagers.length >= 8,
    progress: pop(8),
    reward: { food: 20 },
  },
  {
    // Хижина в посёлке одна: «деревня» — это её третий уровень, а не третий сруб.
    id: 'three_huts',
    title: 'Деревня',
    description: 'Подними хижину до 3 уровня.',
    check: (s) => hutLevel(s) >= 3,
    progress: (s) => [Math.min(3, hutLevel(s)), 3],
    reward: { wood: 20, stone: 10 },
  },
  {
    id: 'warriors',
    title: 'Первые бойцы',
    description: 'Построй казармы и найми двух бойцов. Роли «воин» больше нет — бойцов учат.',
    check: (s) => armySize(s) >= 2,
    progress: (s) => [Math.min(2, armySize(s)), 2],
    reward: { food: 15 },
  },
  {
    id: 'smith_gear',
    title: 'Первое снаряжение',
    description: 'Скуй что-нибудь в кузнице — без снаряжения бойцов не набрать.',
    check: (s) => Object.values(s.equipment ?? {}).some((n) => n > 0),
    reward: { stone: 20 },
  },
  {
    id: 'pop_15',
    title: 'Большое племя',
    description: 'Достигни населения 15.',
    check: (s) => s.villagers.length >= 15,
    progress: pop(15),
    reward: { food: 40, wood: 20 },
  },
  {
    id: 'pop_25',
    title: 'На пути к государству',
    description: 'Достигни населения 25.',
    check: (s) => s.villagers.length >= 25,
    progress: pop(25),
    reward: { food: 80, wood: 40, stone: 40 },
  },
];

export const QUEST_BY_ID = Object.fromEntries(QUESTS.map((q) => [q.id, q])) as Record<string, QuestDef>;

export interface AchievementDef {
  id: string;
  icon: string;
  title: string;
  check: (s: GameState) => boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_hunt', icon: '🏹', title: 'Первая охота', check: (s) => s.stats.hunts >= 1 },
  { id: 'ten_people', icon: '👥', title: 'Первые 10 жителей', check: (s) => s.villagers.length >= 10 },
  { id: 'first_win', icon: '🏆', title: 'Первая победа', check: (s) => s.stats.battlesWon >= 1 },
  { id: 'survivor', icon: '🌙', title: 'Пережили 10 дней', check: (s) => s.time >= 10 * 60 },
  { id: 'first_gear', icon: '⚒️', title: 'Первое снаряжение', check: (s) => Object.values(s.equipment ?? {}).some((n) => n > 0) },
  { id: 'twenty_people', icon: '🏘️', title: '20 жителей', check: (s) => s.villagers.length >= 20 },
];
