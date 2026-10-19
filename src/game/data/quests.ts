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
import { DAY_LENGTH } from '../pace';

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

/**
 * Пороги заданий — одно число на проверку, ход и подпись (правило 18): написанное словами, оно
 * разошлось бы с проверкой при первой же правке порога.
 */
const GOAL = {
  troops: 3,
  shields: 40,
  army: 50,
  barracks: 3,
  heavy: 20,
  riders: 25,
  gold: 1200,
  wall: 4,
  pop: 200,
  bigArmy: 200,
} as const;

/**
 * ИДЕНТИФИКАТОР ЗАДАНИЯ — КЛЮЧ В СОХРАНЕНИИ, А НЕ ПОДПИСЬ. Он лежит в `s.completedQuests` и
 * переименованию не подлежит без ступени сохранения: партия, выполнившая задание под старым
 * именем, получила бы награду второй раз. Поэтому четыре имени расходятся с тем, что задание
 * на самом деле проверяет, — они остались от прежних порогов, а пороги выросли вместе с
 * масштабом посёлка. Правда о задании — в `title`, `description` и `check`; рядом с каждым
 * таким именем это сказано комментарием.
 */
export const QUESTS: QuestDef[] = [
  {
    id: 'smith_at_work',
    title: 'Кузнец у горна',
    description: 'Поставь человека в кузницу. Без неё дружину не одеть.',
    check: (s) => jobCounts(s).smith >= 1,
    reward: { stone: 120 },
  },
  {
    id: 'first_gear',
    title: 'Первое снаряжение',
    description: 'Скуй копьё, лук или щит.',
    check: (s) => Object.values(s.equipment ?? {}).some((n) => n > 0),
    reward: { wood: 120 },
  },
  {
    id: 'first_troops',
    title: 'Первая дружина',
    description: `Собери дружину из ${GOAL.troops} бойцов. Каждый стоит снаряжения, запасов и свободных рук.`,
    check: (s) => armySize(s) >= GOAL.troops,
    progress: upTo(armySize, GOAL.troops),
    reward: { food: 240 },
  },
  {
    id: 'first_scout',
    title: 'Глаза на карте',
    description: 'Отправь разведку к соседу. Чужую мощь видно только после неё.',
    check: (s) => (s.stats.scouted ?? 0) >= 1,
    reward: { food: 160 },
  },
  {
    id: 'shields',
    title: `${GOAL.shields} щитов`,
    description: `Скуй ${GOAL.shields} щитов. С ними строй держится.`,
    check: (s) => (s.equipment.shield ?? 0) >= GOAL.shields,
    progress: upTo((s) => s.equipment.shield ?? 0, GOAL.shields),
    reward: { hides: 80 },
  },
  {
    id: 'first_raid',
    title: 'Первый поход',
    description: 'Отправь отряд в поход. Пока он в пути, стены стоят без него.',
    check: (s) => (s.stats.raids ?? 0) >= 1,
    reward: { wood: 240, stone: 160 },
  },
  {
    id: 'first_win',
    title: 'Первая победа',
    description: 'Выиграй бой в походе или у своих ворот.',
    check: (s) => s.stats.battlesWon >= 1,
    reward: { food: 320 },
  },
  {
    // Имя от прежнего порога: проверяет `GOAL.army` бойцов.
    id: 'army_10',
    title: `${GOAL.army} бойцов`,
    description: `Доведи дружину до ${GOAL.army} бойцов.`,
    check: (s) => armySize(s) >= GOAL.army,
    progress: upTo(armySize, GOAL.army),
    reward: { iron: 80, copper: 80 },
  },
  {
    id: 'barracks_3',
    title: `Казармы ур. ${GOAL.barracks}`,
    description: `Подними казармы до ур. ${GOAL.barracks}. Найм пойдёт быстрее.`,
    check: (s) => levelOf(s, 'barracks') >= GOAL.barracks,
    progress: upTo((s) => levelOf(s, 'barracks'), GOAL.barracks),
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
    description: `Найми ${GOAL.heavy} латников. Каждому нужны меч, щит и доспех.`,
    check: (s) => (s.army.legionary ?? 0) >= GOAL.heavy,
    progress: upTo((s) => s.army.legionary ?? 0, GOAL.heavy),
    reward: { iron: 160 },
  },
  {
    id: 'riders',
    title: 'Конный разъезд',
    description: `Найми ${GOAL.riders} всадников. Конница режет лучников.`,
    check: (s) => (s.army.rider ?? 0) >= GOAL.riders,
    progress: upTo((s) => s.army.rider ?? 0, GOAL.riders),
    reward: { hides: 320 },
  },
  {
    // Имя от прежнего порога: проверяет `GOAL.gold` золота.
    id: 'gold_150',
    title: 'Золото в сундуках',
    description: `Собери ${GOAL.gold} золота. Его дают налог, десятина и рынок.`,
    check: (s) => s.gold >= GOAL.gold,
    progress: upTo((s) => s.gold, GOAL.gold),
    reward: { food: 400 },
  },
  {
    id: 'wall_4',
    title: 'Крепкие стены',
    description: `Подними стены до ур. ${GOAL.wall}. Пусть набег разбивается о камень.`,
    check: (s) => levelOf(s, 'palisade') >= GOAL.wall,
    progress: upTo((s) => levelOf(s, 'palisade'), GOAL.wall),
    reward: { stone: 480 },
  },
  {
    // Имя от прежнего порога: проверяет `GOAL.pop` жителей.
    id: 'pop_20',
    title: `${GOAL.pop} жителей`,
    description: `Доведи число жителей до ${GOAL.pop}. Бойцов берут из них.`,
    check: (s) => s.pop >= GOAL.pop,
    progress: upTo((s) => s.pop, GOAL.pop),
    reward: { food: 600, wood: 300 },
  },
  {
    // Имя от прежнего порога: проверяет `GOAL.bigArmy` бойцов.
    id: 'army_25',
    title: 'Большая дружина',
    description: `Доведи дружину до ${GOAL.bigArmy} бойцов.`,
    check: (s) => armySize(s) >= GOAL.bigArmy,
    progress: upTo(armySize, GOAL.bigArmy),
    reward: { iron: 240, copper: 240 },
  },
];

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
  title: string;
  check: (s: GameState) => boolean;
}

/**
 * У достижений идентификатор — только ключ разметки и имя значка (`ach-<id>`): в сохранении их
 * нет, они считаются `check` при чтении. Поэтому врущее имя здесь можно было поправить
 * (`twenty_people` проверяло двести жителей — теперь `pop_200`), а у заданий — нельзя.
 */
/** Пороги достижений — одно число на проверку и подпись (правило 18), как `GOAL` у заданий. */
const ACH = { days: 10, pop: 200 } as const;

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_gear', title: 'Первое снаряжение', check: (s) => Object.values(s.equipment ?? {}).some((n) => n > 0) },
  { id: 'first_scout', title: 'Первая разведка', check: (s) => (s.stats.scouted ?? 0) >= 1 },
  { id: 'first_raid', title: 'Первый поход', check: (s) => (s.stats.raids ?? 0) >= 1 },
  { id: 'first_win', title: 'Первая победа', check: (s) => s.stats.battlesWon >= 1 },
  { id: 'first_hunt', title: 'Первая охота', check: (s) => s.stats.hunts >= 1 },
  { id: 'survivor', title: `Город выстоял ${ACH.days} игровых дней`, check: (s) => s.time >= ACH.days * DAY_LENGTH },
  { id: 'pop_200', title: `${ACH.pop} жителей`, check: (s) => s.pop >= ACH.pop },
];
