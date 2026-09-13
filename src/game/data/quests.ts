// Задания: дорога от холодного горна к первому походу и к большой дружине.
// Посёлок стоит с первого дня, поэтому «построй» здесь нет — только армия,
// снаряжение, разведка, походы и то, что их кормит: уровни, золото, люди.
//
// Задания на то, чего в мире нет, здесь быть не должно: недостижимое задание
// занимает одно из трёх мест на экране навсегда, и значок на кнопке «Задания»
// не гаснет никогда. Так было с «Взятым замком» — замков на карте нет (у логова
// `castle: false`), и задание вместе с одноимённым достижением убрано. Вернуть их
// заставит тест (`quests.test.ts`): в тот день, когда мир поставит замок,
// задания на него обязаны появиться.
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
    reward: { stone: 120 },
  },
  {
    id: 'first_gear',
    title: 'Первое снаряжение',
    description: 'Скуй что-нибудь: копьё, лук или щит.',
    check: (s) => Object.values(s.equipment ?? {}).some((n) => n > 0),
    reward: { wood: 120 },
  },
  {
    id: 'first_troops',
    title: 'Первая дружина',
    description: 'Найми троих бойцов. Каждый стоит снаряжения, припаса и свободного человека.',
    check: (s) => armySize(s) >= 3,
    progress: upTo(armySize, 3),
    reward: { food: 240 },
  },
  {
    id: 'first_scout',
    title: 'Глаза на карте',
    description: 'Отправь разведку к соседу: чужая мощь видна только после неё.',
    check: (s) => (s.stats.scouted ?? 0) >= 1,
    reward: { food: 160 },
  },
  {
    id: 'shields',
    title: 'Сорок щитов',
    description: 'Скуй сорок щитов: с ними строй держится.',
    check: (s) => (s.equipment.shield ?? 0) >= 40,
    progress: upTo((s) => s.equipment.shield ?? 0, 40),
    reward: { hides: 80 },
  },
  {
    id: 'first_raid',
    title: 'Первый поход',
    description: 'Отправь отряд в набег. Пока он в пути, деревню он не защищает.',
    check: (s) => (s.stats.raids ?? 0) >= 1,
    reward: { wood: 240, stone: 160 },
  },
  {
    id: 'first_win',
    title: 'Первая победа',
    description: 'Выиграй бой — в походе или у своих ворот.',
    check: (s) => s.stats.battlesWon >= 1,
    reward: { food: 320 },
  },
  {
    id: 'army_10',
    title: 'Полсотни бойцов',
    description: 'Доведи дружину до пятидесяти человек.',
    check: (s) => armySize(s) >= 50,
    progress: upTo(armySize, 50),
    reward: { iron: 80, copper: 80 },
  },
  {
    id: 'barracks_3',
    title: 'Казармы третьего уровня',
    description: 'Подними казармы до 3 уровня: учения пойдут быстрее.',
    check: (s) => levelOf(s, 'barracks') >= 3,
    progress: upTo((s) => levelOf(s, 'barracks'), 3),
    reward: { food: 320 },
  },
  {
    id: 'market_buy',
    title: 'Первая покупка',
    description: 'Купи что-нибудь на рынке. Дорого, зато сразу.',
    check: (s) => (s.stats.purchases ?? 0) >= 1,
    reward: { stone: 240 },
  },
  {
    id: 'heavy',
    title: 'Тяжёлая пехота',
    description: 'Найми двадцать латников: меч, щит и доспех на каждого.',
    check: (s) => (s.army.legionary ?? 0) >= 20,
    progress: upTo((s) => s.army.legionary ?? 0, 20),
    reward: { iron: 160 },
  },
  {
    id: 'riders',
    title: 'Конный разъезд',
    description: 'Найми двадцать пять всадников: конница режет лучников и заходит во фланг.',
    check: (s) => (s.army.rider ?? 0) >= 25,
    progress: upTo((s) => s.army.rider ?? 0, 25),
    reward: { hides: 320 },
  },
  {
    id: 'gold_150',
    title: 'Полная казна',
    description: 'Собери 1200 золота: налог в ратуше, десятина прихода, продажа невольников на рынке.',
    check: (s) => s.gold >= 1200,
    progress: upTo((s) => s.gold, 1200),
    reward: { food: 400 },
  },
  {
    id: 'wall_4',
    title: 'Каменная стена',
    description: 'Подними стену до 4 уровня: с этого уровня она каменная.',
    check: (s) => levelOf(s, 'palisade') >= 4,
    progress: upTo((s) => levelOf(s, 'palisade'), 4),
    reward: { stone: 480 },
  },
  {
    id: 'pop_20',
    title: 'Двести душ',
    description: 'Доведи население до 200: людей на дружину берут с площади.',
    check: (s) => s.pop >= 200,
    progress: upTo((s) => s.pop, 200),
    reward: { food: 600, wood: 300 },
  },
  {
    id: 'army_25',
    title: 'Большая дружина',
    description: 'Доведи дружину до двухсот бойцов.',
    check: (s) => armySize(s) >= 200,
    progress: upTo(armySize, 200),
    reward: { iron: 240, copper: 240 },
  },
];

export const QUEST_BY_ID = Object.fromEntries(QUESTS.map((q) => [q.id, q])) as Record<string, QuestDef>;

/**
 * Сколько заданий из нынешнего списка выполнено. Считается по списку заданий, а не
 * по длине записи о выполненных: в сохранениях остаются идентификаторы заданий,
 * которых больше нет (так останется `castle` у тех, кто брал замок, пока замки
 * были), и счёт выходил бы «17 из 16».
 */
export const questsDone = (s: GameState): number =>
  QUESTS.filter((q) => s.completedQuests.includes(q.id)).length;

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
  { id: 'twenty_people', icon: '🏘️', title: '200 жителей', check: (s) => s.pop >= 200 },
];
