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
  { id: 'idle', name: 'Свободен', icon: '🔨', description: 'Свободные жители строят здания и отдыхают у костра.', yield: {} },
  {
    id: 'gatherer',
    name: 'Собиратель',
    icon: '🍇',
    description: 'Собирает ягоды и коренья рядом с лагерем.',
    yield: { food: 7 },
    building: 'gathering',
    freeRange: true,
  },
  {
    id: 'hunter',
    name: 'Охотник',
    icon: '🏹',
    description: 'Приносит мясо, шкуры и кости. Лучше с копьём и луком.',
    yield: { food: 6, hides: 1.2, bones: 1 },
    building: 'hunter_hut',
    freeRange: true,
  },
  {
    id: 'woodcutter',
    name: 'Лесоруб',
    icon: '🪓',
    description: 'Рубит лес на краю поселения.',
    yield: { wood: 6 },
    building: 'sawmill',
    freeRange: true,
  },
  {
    id: 'stonecutter',
    name: 'Каменотёс',
    icon: '⛏️',
    description: 'Добывает камень у скал.',
    yield: { stone: 4 },
    building: 'quarry',
    freeRange: true,
  },
  {
    id: 'miner',
    name: 'Рудокоп',
    icon: '💎',
    description: 'Достаёт медную и железную руду. Нужен рудник.',
    yield: { copper: 1.6, iron: 0.7 },
    building: 'mine',
  },
  {
    id: 'farmer',
    name: 'Фермер',
    icon: '🌾',
    description: 'Выращивает урожай. Нужна ферма.',
    yield: { food: 11 },
    building: 'farm',
  },
  {
    id: 'herder',
    name: 'Пастух',
    icon: '🐐',
    description: 'Держит скот. Зима стаду почти не мешает — оно зимует в загоне.',
    yield: { food: 5, hides: 1.2 },
    building: 'pen',
  },
  {
    id: 'crafter',
    name: 'Ремесленник',
    icon: '🛠️',
    description: 'Работает в мастерской и ускоряет исследования.',
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
    id: 'scholar',
    name: 'Хранитель',
    icon: '📚',
    description: 'Помнит и передаёт знания. Ускоряет исследования.',
    yield: {},
    building: 'knowledge',
  },
  {
    id: 'shaman',
    name: 'Шаман',
    icon: '🔮',
    description: 'Проводит ритуалы у тотема и поддерживает мораль.',
    yield: {},
    building: 'totem',
  },
];

export const JOB_BY_ID: Record<JobId, JobDef> = Object.fromEntries(JOBS.map((j) => [j.id, j])) as Record<JobId, JobDef>;

/** Профессии «вольного сбора» — их раздают у костра, когда профильного здания ещё нет. */
export const FREE_JOBS: JobId[] = JOBS.filter((j) => j.freeRange).map((j) => j.id);
