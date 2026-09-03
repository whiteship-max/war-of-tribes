import type { EraId, ResourceId, TechBranch, TechId } from '../types';

export interface TechDef {
  id: TechId;
  name: string;
  icon: string;
  branch: TechBranch;
  description: string;
  cost: Partial<Record<ResourceId, number>>;
  /** Очки исследования. Базовая скорость 0.5/сек + 1/сек за ремесленника. */
  work: number;
  requires: TechId[];
}

export const BRANCH_META: Record<TechBranch, { name: string; icon: string }> = {
  settlement: { name: 'Поселение', icon: '🏘️' },
  craft: { name: 'Ремесло', icon: '🔧' },
  war: { name: 'Война', icon: '⚔️' },
  society: { name: 'Общество', icon: '👑' },
};

export const TECHS: TechDef[] = [
  // Ремесло
  { id: 'stone_tools', name: 'Каменные орудия', icon: '⛰️', branch: 'craft', description: 'Добыча всех ресурсов +20%. Каменный век.', cost: { stone: 10 }, work: 30, requires: [] },
  { id: 'woodworking', name: 'Обработка дерева', icon: '🌲', branch: 'craft', description: 'Лесорубы +30%, стройка на 20% быстрее.', cost: { wood: 20, stone: 10 }, work: 60, requires: ['stone_tools'] },
  { id: 'bone_tools', name: 'Костяные орудия', icon: '🦴', branch: 'craft', description: 'Собиратели и охотники +20%.', cost: { bones: 15 }, work: 60, requires: ['stone_tools'] },
  { id: 'leatherworking', name: 'Выделка кож', icon: '🧥', branch: 'craft', description: 'Тёплая одежда: мораль +8.', cost: { hides: 15, bones: 5 }, work: 90, requires: ['bone_tools'] },
  { id: 'metallurgy', name: 'Металлургия', icon: '⚒️', branch: 'craft', description: 'Бронзовый век: открывает рудник и кузницу.', cost: { stone: 80, wood: 60 }, work: 240, requires: ['woodworking', 'bone_tools'] },
  { id: 'iron_working', name: 'Обработка железа', icon: '⚙️', branch: 'craft', description: 'Железный век: постройки поднимаются выше, открывается ковка мечей.', cost: { iron: 30, stone: 60 }, work: 300, requires: ['metallurgy'] },
  // Поселение
  { id: 'housing', name: 'Строительство жилья', icon: '🏠', branch: 'settlement', description: 'Хижина вмещает на четверть больше народу.', cost: { wood: 25 }, work: 50, requires: ['woodworking'] },
  { id: 'farming', name: 'Земледелие', icon: '🌾', branch: 'settlement', description: 'Открывает фермы и фермеров.', cost: { wood: 30, food: 20 }, work: 100, requires: ['stone_tools'] },
  { id: 'animal_husbandry', name: 'Скотоводство', icon: '🐐', branch: 'settlement', description: 'Открывает загоны.', cost: { food: 40, hides: 10 }, work: 120, requires: ['farming'] },
  { id: 'palisade', name: 'Частокол', icon: '🧱', branch: 'settlement', description: 'Открывает стену вокруг поселения — без неё поселение не станет укреплённым.', cost: { wood: 40 }, work: 120, requires: ['woodworking', 'spears'] },
  { id: 'towers', name: 'Дозорные башни', icon: '🗼', branch: 'settlement', description: 'Открывает башни.', cost: { wood: 40, stone: 30 }, work: 160, requires: ['palisade'] },
  // Война
  { id: 'spears', name: 'Копья', icon: '🔱', branch: 'war', description: 'Охотники +30%. Кузница может ковать копья.', cost: { wood: 15, stone: 10 }, work: 45, requires: ['stone_tools'] },
  { id: 'warband', name: 'Дружина', icon: '🏛️', branch: 'war', description: 'Открывает казармы: за бойцов теперь платят снаряжением и людьми.', cost: { food: 30, wood: 20 }, work: 80, requires: ['spears'] },
  { id: 'bows', name: 'Луки', icon: '🏹', branch: 'war', description: 'Охотники +30%. Кузница может делать луки.', cost: { wood: 30, bones: 10 }, work: 100, requires: ['spears', 'bone_tools'] },
  { id: 'shields', name: 'Щиты', icon: '🛡️', branch: 'war', description: 'Защита поселения +3. Кузница может делать щиты.', cost: { wood: 40, hides: 10 }, work: 130, requires: ['bows'] },
  { id: 'axes', name: 'Боевые топоры', icon: '🪓', branch: 'war', description: 'Кузница может ковать топоры — тяжёлую руку набега.', cost: { copper: 15, wood: 30 }, work: 180, requires: ['bows', 'metallurgy'] },
  { id: 'bronze_weapons', name: 'Бронзовое оружие', icon: '⚔️', branch: 'war', description: 'Защита поселения +4. Дорога к кованому клинку.', cost: { copper: 20, wood: 40 }, work: 220, requires: ['metallurgy', 'shields'] },
  { id: 'swords', name: 'Мечи', icon: '🗡️', branch: 'war', description: 'Кузница кует мечи: мечники, щитоносцы и латники.', cost: { iron: 25, copper: 20 }, work: 280, requires: ['bronze_weapons', 'iron_working'] },
  { id: 'armor', name: 'Доспех', icon: '🦺', branch: 'war', description: 'Кузница кует доспехи. Латник — лучший боец племени.', cost: { iron: 40, hides: 25 }, work: 340, requires: ['swords', 'leatherworking'] },
  // Общество
  { id: 'chiefdom', name: 'Вождь', icon: '👑', branch: 'society', description: 'Племя выбирает вождя. Открывает Дом вождя: указы и рацион.', cost: { food: 25 }, work: 40, requires: [] },
  { id: 'totem', name: 'Тотем', icon: '🗿', branch: 'society', description: 'Открывает святилище и выбор символа племени.', cost: { bones: 10 }, work: 70, requires: ['chiefdom'] },
  { id: 'shamanism', name: 'Шаманизм', icon: '🔮', branch: 'society', description: 'Открывает шамана и ритуалы.', cost: { hides: 10, bones: 10 }, work: 110, requires: ['totem'] },
  { id: 'traditions', name: 'Традиции', icon: '🏺', branch: 'society', description: 'Мораль +8, новые люди приходят быстрее.', cost: { food: 60 }, work: 160, requires: ['shamanism'] },
  { id: 'statehood', name: 'Установления', icon: '📜', branch: 'society', description: 'Раннее государство: счёт, суд и порядок. Постройки поднимаются до предела.', cost: { food: 120, stone: 80 }, work: 400, requires: ['traditions', 'iron_working'] },
  { id: 'trade', name: 'Мера и торг', icon: '⚖️', branch: 'society', description: 'Общая мера ценности: появляется золото, налог в Доме вождя и рынок у ворот.', cost: { food: 150, copper: 60, iron: 40 }, work: 520, requires: ['statehood'] },
];

export const TECH_BY_ID: Record<TechId, TechDef> = Object.fromEntries(TECHS.map((t) => [t.id, t])) as Record<TechId, TechDef>;

/**
 * Что нужно изучить, чтобы наступила эпоха. Эпоха — технический уровень: она
 * зависит только от знаний, а не от того, сколько народу и построек в посёлке
 * (это теперь дело стадии поселения — см. data/stages.ts).
 *
 * Порядок в массиве — от младшей эпохи к старшей: `era()` берёт последнюю,
 * все требования которой выполнены.
 */
export const ERA_TECHS: [EraId, TechId[]][] = [
  ['camp', []],
  ['stone', ['stone_tools']],
  ['tribe', ['woodworking', 'bone_tools']],
  ['bronze', ['metallurgy']],
  ['iron', ['iron_working']],
  ['state', ['statehood']],
];
