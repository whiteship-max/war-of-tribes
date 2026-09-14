import type { BuildingTypeId, JobId, ResourceId, Season } from '../types';

/**
 * Ресурсный двор за стеной: здание, его профессия и всё, чем дворы отличаются друг
 * от друга.
 *
 * Семь дворов — одна механика: рабочие × таблица × множитель (`derived.yardYield`),
 * место за стеной, до которого дотягивается набег, и сезон. Раньше один двор был
 * описан тремя таблицами — здание называло свою профессию (`BuildingDef.job`),
 * профессия своё здание (`JobDef.building`), а сезон брал профессии поимённо в
 * четырёх строках `SEASON_MODIFIERS`, — и восьмой двор пришлось бы завести в трёх
 * местах, сверив их глазами. Теперь строка одна, а `BUILDINGS`, `JOBS` и
 * `SEASON_MODIFIERS` берут её отсюда. Завести двор мимо этой таблицы не даёт тест
 * (`yards.test.ts`).
 */
export interface YardDef {
  /** Здание двора. Оно стоит за стеной (`BuildingDef.outside`). */
  building: BuildingTypeId;
  /** Профессия, которой двор даёт места. */
  job: JobId;
  /** Имя, значок и описание профессии. */
  name: string;
  icon: string;
  description: string;
  /** Производство за игровой день на одного работника в здании 1 уровня. */
  yield: Partial<Record<ResourceId, number>>;
  /** Работа есть и без места в здании — «вольным сбором» вполсилы. */
  freeRange?: boolean;
  /**
   * На эту работу ставят невольников — на те же места, что вольных. Только там,
   * где труд тяжёлый и под присмотром: поле, лес, камень, руда, скот. Оружия
   * невольнику не дают (охотник), к службе и мастерству не ставят.
   */
  bonded?: boolean;
  /** Множитель выработки по сезонам; нет сезона — без изменений. */
  seasons: Partial<Record<Season, number>>;
}

export const YARDS: YardDef[] = [
  {
    building: 'gathering',
    job: 'gatherer',
    name: 'Собиратель',
    icon: '🍇',
    description: 'Собирает ягоды и коренья рядом с лагерем.',
    yield: { food: 10 },
    freeRange: true,
    bonded: true,
    seasons: { spring: 1.15, summer: 1.25, autumn: 1.1, winter: 0.4 },
  },
  {
    building: 'hunter_hut',
    job: 'hunter',
    name: 'Охотник',
    icon: '🏹',
    description: 'Приносит мясо, шкуры и кости — с копьём и луком, как положено.',
    yield: { food: 14, hides: 2.4, bones: 2 },
    freeRange: true,
    seasons: { summer: 0.9, autumn: 1.2, winter: 0.75 },
  },
  {
    building: 'sawmill',
    job: 'woodcutter',
    name: 'Лесоруб',
    icon: '🪓',
    description: 'Рубит лес на краю поселения.',
    yield: { wood: 9 },
    freeRange: true,
    bonded: true,
    seasons: { summer: 1.1, autumn: 1.15, winter: 0.8 },
  },
  {
    building: 'quarry',
    job: 'stonecutter',
    name: 'Каменотёс',
    icon: '⛏️',
    description: 'Добывает камень у скал.',
    yield: { stone: 5 },
    freeRange: true,
    bonded: true,
    seasons: { summer: 1.1, winter: 0.65 },
  },
  {
    building: 'mine',
    job: 'miner',
    name: 'Рудокоп',
    icon: '💎',
    description: 'Достаёт медную и железную руду. Нужен рудник.',
    yield: { copper: 2, iron: 0.8 },
    bonded: true,
    seasons: { summer: 1.1, winter: 0.7 },
  },
  {
    building: 'farm',
    job: 'farmer',
    name: 'Фермер',
    icon: '🌾',
    description: 'Выращивает урожай. Нужна ферма.',
    yield: { food: 13 },
    bonded: true,
    seasons: { spring: 1.2, summer: 1.35, autumn: 1.5, winter: 0 },
  },
  {
    building: 'pen',
    job: 'herder',
    name: 'Пастух',
    icon: '🐐',
    description: 'Держит скот. Зима стаду почти не мешает — оно зимует в загоне.',
    yield: { food: 6, hides: 1.4 },
    bonded: true,
    // Скот зимует в загоне и почти не проседает: зимняя страховка к ферме.
    seasons: { winter: 0.9 },
  },
];

const YARD_BY_BUILDING = new Map(YARDS.map((y) => [y.building, y]));

/**
 * То, что двор кладёт в определение своего здания: профессию и место за стеной.
 * Здание без строки в `YARDS` двором не является — и за стеной не стоит.
 */
export function yardBuilding(building: BuildingTypeId): { job: JobId; outside: true } {
  const y = YARD_BY_BUILDING.get(building);
  if (!y) throw new Error(`${building}: двора нет в YARDS`);
  return { job: y.job, outside: true };
}

/** Множители профессий дворов в одном сезоне — строка `SEASON_MODIFIERS.jobs`. */
export function yardSeason(season: Season): Partial<Record<JobId, number>> {
  const out: Partial<Record<JobId, number>> = {};
  for (const y of YARDS) {
    const m = y.seasons[season];
    if (m !== undefined) out[y.job] = m;
  }
  return out;
}
