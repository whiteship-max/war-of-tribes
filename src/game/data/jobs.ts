import type { BuildingTypeId, JobId, ResourceId } from '../types';
import { YARDS } from './yards';

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
  /**
   * На эту работу ставят невольников — на те же места, что вольных. Только там,
   * где труд тяжёлый и под присмотром: поле, лес, камень, руда, скот. Оружия
   * невольнику не дают (охотник, кузнец), к службе и мастерству не ставят.
   */
  bonded?: boolean;
}

export const JOBS: JobDef[] = [
  { id: 'idle', name: 'Свободен', icon: '🔨', description: 'Свободные жители улучшают здания и отдыхают у костра.', yield: {} },
  // Семь дворов за стеной — одной таблицей (`data/yards.ts`): здание, профессия и сезон
  // двора описаны там одной строкой, а не здесь, в зданиях и в сезонах врозь.
  ...YARDS.map(
    (y): JobDef => ({
      id: y.job,
      name: y.name,
      icon: y.icon,
      description: y.description,
      yield: y.yield,
      building: y.building,
      ...(y.freeRange ? { freeRange: true } : {}),
      ...(y.bonded ? { bonded: true } : {}),
    }),
  ),
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
    // Имя у него одно на все четыре веры — священник, имам или волхв, — а как
    // его зовут в этой деревне, показывает панель храма из `data/faiths.ts`.
    // Четырёх профессий тут заводить нельзя: работа одна, и людей на неё
    // ставят одним и тем же числом.
    name: 'Служитель',
    icon: '🕯️',
    description: 'Служит в храме: держит набожность прихода и настроение деревни.',
    yield: {},
    building: 'church',
  },
];

export const JOB_BY_ID: Record<JobId, JobDef> = Object.fromEntries(JOBS.map((j) => [j.id, j])) as Record<JobId, JobDef>;

/** Профессии «вольного сбора» — их раздают у костра, когда профильного здания ещё нет. */
export const FREE_JOBS: JobId[] = JOBS.filter((j) => j.freeRange).map((j) => j.id);

/**
 * Работы, на которые ставят невольников. Только в здании: вольного сбора у них
 * нет — в поле без присмотра невольник не работник.
 */
export const BONDED_JOBS: JobId[] = JOBS.filter((j) => j.bonded && j.building).map((j) => j.id);
