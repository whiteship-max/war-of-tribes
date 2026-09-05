import type { BuildingTypeId, JobId, ResourceId } from '../types';

export interface JobDef {
  id: JobId;
  name: string;
  icon: string;
  description: string;
  /** Производство за игровой день на одного работника в здании 1 уровня. */
  yield: Partial<Record<ResourceId, number>>;
  /** Профильное здание: рабочие места берутся из его уровня. */
  building?: BuildingTypeId;
  /** Профессия доступна и без здания — «вольным сбором» вполсилы. */
  freeRange?: boolean;
  /** Множитель потребления еды. */
  foodMultiplier?: number;
}

export const JOBS: JobDef[] = [
  { id: 'idle', name: 'Свободен', icon: '🔨', description: 'Свободные жители улучшают здания и отдыхают у костра.', yield: {} },
  {
    id: 'gatherer',
    name: 'Собиратель',
    icon: '🍇',
    description: 'Собирает ягоды и коренья рядом с лагерем.',
    yield: { food: 10 },
    building: 'gathering',
    freeRange: true,
  },
  {
    id: 'hunter',
    name: 'Охотник',
    icon: '🏹',
    description: 'Приносит мясо, шкуры и кости — с копьём и луком, как положено.',
    yield: { food: 14, hides: 2.4, bones: 2 },
    building: 'hunter_hut',
    freeRange: true,
  },
  {
    id: 'woodcutter',
    name: 'Лесоруб',
    icon: '🪓',
    description: 'Рубит лес на краю поселения.',
    yield: { wood: 9 },
    building: 'sawmill',
    freeRange: true,
  },
  {
    id: 'stonecutter',
    name: 'Каменотёс',
    icon: '⛏️',
    description: 'Добывает камень у скал.',
    yield: { stone: 5 },
    building: 'quarry',
    freeRange: true,
  },
  {
    id: 'miner',
    name: 'Рудокоп',
    icon: '💎',
    description: 'Достаёт медную и железную руду. Нужен рудник.',
    yield: { copper: 2, iron: 0.8 },
    building: 'mine',
  },
  {
    id: 'farmer',
    name: 'Фермер',
    icon: '🌾',
    description: 'Выращивает урожай. Нужна ферма.',
    yield: { food: 13 },
    building: 'farm',
  },
  {
    id: 'herder',
    name: 'Пастух',
    icon: '🐐',
    description: 'Держит скот. Зима стаду почти не мешает — оно зимует в загоне.',
    yield: { food: 6, hides: 1.4 },
    building: 'pen',
  },
  {
    id: 'crafter',
    name: 'Ремесленник',
    icon: '🛠️',
    description: 'Работает в мастерской и ускоряет улучшения зданий: один мастер стоит полутора строителей.',
    yield: {},
    building: 'workshop',
  },
  {
    id: 'smith',
    name: 'Кузнец',
    icon: '⚒️',
    description: 'Кует снаряжение: копья, луки, топоры, щиты, мечи и доспех.',
    yield: {},
    building: 'smithy',
  },
  {
    id: 'priest',
    name: 'Жрец',
    icon: '🕯️',
    description: 'Служит в церкви и поддерживает дух племени.',
    yield: {},
    building: 'church',
  },
];

export const JOB_BY_ID: Record<JobId, JobDef> = Object.fromEntries(JOBS.map((j) => [j.id, j])) as Record<JobId, JobDef>;

/** Профессии «вольного сбора» — их раздают у костра, когда профильного здания ещё нет. */
export const FREE_JOBS: JobId[] = JOBS.filter((j) => j.freeRange).map((j) => j.id);
