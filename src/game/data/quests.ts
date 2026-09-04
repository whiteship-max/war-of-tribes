// Задания: дорога от холодного горна к первому походу и дальше к замку.
// Посёлок стоит с первого дня, поэтому «построй» здесь нет — только армия,
// снаряжение, разведка, походы и то, что их кормит: уровни, золото, люди.
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

const upTo = (have: (s: GameState) => number, n: number) => (s: GameState): [number, number] => [
  Math.min(Math.floor(have(s)), n),
  n,
];

const levelOf = (s: GameState, type: Parameters<typeof buildingOfType>[1]): number =>
  buildingOfType(s, type)?.level ?? 0;

export const QUESTS: QuestDef[] = [
  {
    id: 'smith_at_work',
    title: 'Кузнец у горна',
    description: 'Поставь человека в кузницу — без неё дружину не одеть.',
    check: (s) => jobCounts(s).smith >= 1,
    reward: { stone: 15 },
  },
  {
    id: 'first_gear',
    title: 'Первое снаряжение',
    description: 'Скуй что-нибудь: копьё, лук или щит.',
    check: (s) => Object.values(s.equipment ?? {}).some((n) => n > 0),
    reward: { wood: 15 },
  },
  {
    id: 'first_troops',
    title: 'Первая дружина',
    description: 'Найми троих бойцов. Каждый стоит снаряжения, припаса и свободного человека.',
    check: (s) => armySize(s) >= 3,
    progress: upTo(armySize, 3),
    reward: { food: 30 },
  },
  {
    id: 'first_scout',
    title: 'Глаза на карте',
    description: 'Отправь разведку к соседу: чужая мощь видна только после неё.',
    check: (s) => (s.stats.scouted ?? 0) >= 1,
    reward: { food: 20 },
  },
  {
    id: 'shields',
    title: 'Пять щитов',
    description: 'Скуй пять щитов: с ними строй держится.',
    check: (s) => (s.equipment.shield ?? 0) >= 5,
    progress: upTo((s) => s.equipment.shield ?? 0, 5),
    reward: { hides: 10 },
  },
  {
    id: 'first_raid',
    title: 'Первый поход',
    description: 'Отправь отряд в набег. Пока он в пути, деревню он не защищает.',
    check: (s) => (s.stats.raids ?? 0) >= 1,
    reward: { wood: 30, stone: 20 },
  },
  {
    id: 'first_win',
    title: 'Первая победа',
    description: 'Выиграй бой — в походе или у своих ворот.',
    check: (s) => s.stats.battlesWon >= 1,
    reward: { food: 40 },
  },
  {
    id: 'army_10',
    title: 'Десять бойцов',
    description: 'Доведи дружину до десяти человек.',
    check: (s) => armySize(s) >= 10,
    progress: upTo(armySize, 10),
    reward: { iron: 10, copper: 10 },
  },
  {
    id: 'barracks_3',
    title: 'Казармы третьего уровня',
    description: 'Подними казармы до 3 уровня: учения пойдут быстрее.',
    check: (s) => levelOf(s, 'barracks') >= 3,
    progress: upTo((s) => levelOf(s, 'barracks'), 3),
    reward: { food: 40 },
  },
  {
    id: 'market_buy',
    title: 'Первая покупка',
    description: 'Купи что-нибудь на рынке. Дорого, зато сразу.',
    check: (s) => (s.stats.purchases ?? 0) >= 1,
    reward: { stone: 30 },
  },
  {
    id: 'heavy',
    title: 'Тяжёлая пехота',
    description: 'Найми двух латников: меч, щит и доспех на каждого.',
    check: (s) => (s.army.legionary ?? 0) >= 2,
    progress: upTo((s) => s.army.legionary ?? 0, 2),
    reward: { iron: 20 },
  },
  {
    id: 'gold_150',
    title: 'Полная казна',
    description: 'Собери 150 золота — налогом или из чужих замков.',
    check: (s) => s.gold >= 150,
    progress: upTo((s) => s.gold, 150),
    reward: { food: 50 },
  },
  {
    id: 'wall_4',
    title: 'Каменная стена',
    description: 'Подними стену до 4 уровня: с этого уровня она каменная.',
    check: (s) => levelOf(s, 'palisade') >= 4,
    progress: upTo((s) => levelOf(s, 'palisade'), 4),
    reward: { stone: 60 },
  },
  {
    id: 'pop_20',
    title: 'Двадцать душ',
    description: 'Доведи население до 20: людей на дружину берут с площади.',
    check: (s) => s.villagers.length >= 20,
    progress: upTo((s) => s.villagers.length, 20),
    reward: { food: 60, wood: 30 },
  },
  {
    id: 'castle',
    title: 'Взятый замок',
    description: 'Возьми замок и привези золото из его казны.',
    check: (s) => (s.stats.castles ?? 0) >= 1,
    reward: { wood: 80, stone: 80, food: 80 },
  },
  {
    id: 'army_25',
    title: 'Большая дружина',
    description: 'Доведи дружину до двадцати пяти бойцов.',
    check: (s) => armySize(s) >= 25,
    progress: upTo(armySize, 25),
    reward: { iron: 30, copper: 30 },
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
  { id: 'first_gear', icon: '⚒️', title: 'Первое снаряжение', check: (s) => Object.values(s.equipment ?? {}).some((n) => n > 0) },
  { id: 'first_scout', icon: '👣', title: 'Первая разведка', check: (s) => (s.stats.scouted ?? 0) >= 1 },
  { id: 'first_raid', icon: '⚔️', title: 'Первый поход', check: (s) => (s.stats.raids ?? 0) >= 1 },
  { id: 'first_win', icon: '🏆', title: 'Первая победа', check: (s) => s.stats.battlesWon >= 1 },
  { id: 'first_hunt', icon: '🏹', title: 'Первая охота', check: (s) => s.stats.hunts >= 1 },
  { id: 'survivor', icon: '🌙', title: 'Пережили 10 дней', check: (s) => s.time >= 10 * 60 },
  { id: 'twenty_people', icon: '🏘️', title: '20 жителей', check: (s) => s.villagers.length >= 20 },
  { id: 'castle', icon: '🏰', title: 'Взятый замок', check: (s) => (s.stats.castles ?? 0) >= 1 },
];
