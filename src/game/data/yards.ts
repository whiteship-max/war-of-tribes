import type { BuildingTypeId, JobId, ResourceId, Season } from '../types';

/**
 * Дело ресурсного двора за стеной: здание, профессия дела и всё, чем дела отличаются друг от друга.
 *
 * Семь дел — одна механика: рабочие × таблица × множитель (`derived.yardYield`), место за стеной, до которого
 * дотягивается набег, и сезон. Раньше один двор был описан тремя таблицами — здание называло свою профессию,
 * профессия своё здание (`JobDef.building`), а сезон брал профессии поимённо в четырёх строках `SEASON_MODIFIERS`, — и
 * восьмое дело пришлось бы завести в трёх местах, сверив их глазами. Теперь строка одна, а `BUILDINGS`, `JOBS` и
 * `SEASON_MODIFIERS` берут её отсюда. Завести дело мимо этой таблицы не даёт тест (`yards.test.ts`).
 *
 * **Двор — одно здание, дел у него одно или два** (ЗД-1, docs/city_v3.md, «Решения ЗД-1»): Ферма — поле и загон,
 * Охотничий двор — охота и сбор, Шахта — руда и камень, Лесопилка — лес. Дело — это профессия: на нём свои рабочие
 * (`GameState.workers` по профессии), свои места и своя выработка — как у прежнего здания того же уровня, а уровень у
 * здания общий. Цена дела — цена прежнего здания (`cost`, `work`): улучшение двора стоит сумму цен его дел, и кто качал
 * оба прежних здания вровень, платит бит в бит прежнее (`labour.upgradeCost` считает по делам).
 */
export interface YardDef {
  /** Здание двора. Оно стоит за стеной (`BuildingDef.outside`). */
  building: BuildingTypeId;
  /** Профессия дела: на ней стоят рабочие, ей — места и выработка. */
  job: JobId;
  /** Имя дела в окне двора: «Поле», «Загон». */
  deed: string;
  /**
   * Цена дела — база цены улучшения прежнего здания, из которого дело пришло (ЗД-1): подъём двора до уровня L стоит
   * сумму цен его дел, каждая — своей лестницей `UPGRADE_GROWTH` и своим округлением (`labour.upgradeCost`).
   */
  cost: Partial<Record<ResourceId, number>>;
  /** База труда строителей — того же прежнего здания. */
  work: number;
  /** Имя и описание профессии. */
  name: string;
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
    building: 'hunter_hut',
    job: 'hunter',
    deed: 'Охота',
    name: 'Охотник',
    description: 'Приносит мясо и шкуры.',
    // Цена прежнего Охотничьего домика.
    cost: { wood: 168, charcoal: 49 },
    work: 420,
    yield: { food: 14, hides: 2.4 },
    freeRange: true,
    seasons: { summer: 0.9, autumn: 1.2, winter: 0.75 },
  },
  {
    building: 'hunter_hut',
    job: 'gatherer',
    deed: 'Сбор',
    name: 'Собиратель',
    description: 'Собирает ягоды и коренья у города.',
    // Цена прежнего Навеса собирателей.
    cost: { wood: 119 },
    work: 245,
    yield: { food: 10 },
    freeRange: true,
    bonded: true,
    seasons: { spring: 1.15, summer: 1.25, autumn: 1.1, winter: 0.4 },
  },
  {
    building: 'sawmill',
    job: 'woodcutter',
    deed: 'Лес',
    name: 'Лесоруб',
    description: 'Рубит лес за стеной и жжёт уголь из сучьев.',
    cost: { wood: 140 },
    work: 301,
    // Уголь выжигают в яме из сучьев и вершинника — того, что от бревна и так остаётся в лесу, — поэтому дерево лесопилки
    // не убывает. Число — прежний поток пятого припаса (кости охотника, 2 на работника): лавка, рынок и рецепты стоят на
    // нём, и перенос не сдвигает ни одной их цены (docs/economy.md, «Уголь вместо костей»).
    yield: { wood: 9, charcoal: 2 },
    freeRange: true,
    bonded: true,
    seasons: { summer: 1.1, autumn: 1.15, winter: 0.8 },
  },
  {
    building: 'mine',
    job: 'miner',
    deed: 'Руда',
    name: 'Рудокоп',
    description: 'Добывает медь и железо.',
    // Цена прежнего Рудника.
    cost: { wood: 476, stone: 364 },
    work: 1092,
    yield: { copper: 2, iron: 0.8 },
    bonded: true,
    seasons: { summer: 1.1, winter: 0.7 },
  },
  {
    building: 'mine',
    job: 'stonecutter',
    deed: 'Камень',
    name: 'Каменотёс',
    description: 'Добывает камень у скал.',
    // Цена прежней Каменоломни.
    cost: { wood: 119, stone: 63 },
    work: 364,
    yield: { stone: 5 },
    freeRange: true,
    bonded: true,
    seasons: { summer: 1.1, winter: 0.65 },
  },
  {
    building: 'farm',
    job: 'farmer',
    deed: 'Поле',
    name: 'Фермер',
    description: 'Выращивает ячмень. Зимой поле не родит.',
    // Цена прежней Фермы.
    cost: { wood: 364, stone: 63 },
    work: 728,
    yield: { food: 13 },
    bonded: true,
    seasons: { spring: 1.2, summer: 1.35, autumn: 1.5, winter: 0 },
  },
  {
    building: 'farm',
    job: 'herder',
    deed: 'Загон',
    name: 'Пастух',
    description: 'Держит скот в загоне. Зима стаду почти не мешает.',
    // Цена прежнего Загона.
    cost: { wood: 476, hides: 63 },
    work: 728,
    yield: { food: 6, hides: 1.4 },
    bonded: true,
    // Скот зимует в загоне и почти не проседает: зимняя страховка к полю.
    seasons: { winter: 0.9 },
  },
];

/** Дело по профессии: у каждого дела своя профессия, второй строки с ней нет (`yards.test.ts`). */
export const YARD_BY_JOB: ReadonlyMap<JobId, YardDef> = new Map(YARDS.map((y) => [y.job, y]));

/** Цена улучшения одного дела — то, из чего складывается цена двора. */
export interface YardPrice {
  cost: Partial<Record<ResourceId, number>>;
  work: number;
}

/**
 * То, что двор кладёт в определение своего здания: дела, место за стеной и цену — сумму цен дел, а у двора с двумя
 * делами ещё и сами цены по делам (`parts`): по ним `labour.upgradeCost` считает лестницу и округление каждого дела
 * врозь, как считало бы два прежних здания. Здание без строки в `YARDS` двором не является — и за стеной не стоит.
 */
export function yardBuilding(building: BuildingTypeId): {
  jobs: readonly JobId[];
  outside: true;
  cost: Partial<Record<ResourceId, number>>;
  work: number;
  parts?: readonly YardPrice[];
} {
  const rows = YARDS.filter((y) => y.building === building);
  if (rows.length === 0) throw new Error(`${building}: двора нет в YARDS`);
  const cost: Partial<Record<ResourceId, number>> = {};
  for (const y of rows) for (const [r, v] of Object.entries(y.cost) as [ResourceId, number][]) cost[r] = (cost[r] ?? 0) + v;
  const work = rows.reduce((n, y) => n + y.work, 0);
  const parts = rows.length > 1 ? rows.map((y) => ({ cost: y.cost, work: y.work })) : undefined;
  return { jobs: rows.map((y) => y.job), outside: true, cost, work, ...(parts ? { parts } : {}) };
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
