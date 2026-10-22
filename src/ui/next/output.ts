// Выработка двора с разбором (docs/ui_v2.md, раздел 2, «Каждая цифра объяснима»; находка Ч7): откуда «+143 еды в день».
//
// Выход двора — произведение: руки × выработка профессии × уровень × сезон × вести × мораль × вера × указ × осада
// (`derived.yardYield`, `workerMultiplier`, `jobMultiplier`, `cutBySiege`). Произведение строками не складывается, поэтому
// разбор пишет каждый множитель тем, что он прибавил к уже набранному: «Лето ×1,25 → +24,0». Строки складываются в выход
// на глазах игрока, и порядок множителей решает только, кому записать долю, а не сумму.
//
// Своей арифметики выхода здесь нет (правило 18): каждый множитель — функция игры, итог — `deedProduction`, тот же, что
// кладёт добро на склад. Разошлись — разбор пишет остаток строкой `REST_LABEL` («Прочее»), а тест (`output.test.ts`) её
// запрещает: новый множитель выработки, не названный здесь, падает тестом, а не прячется.
import type { Building, GameState, JobId, ResourceId } from '@/game/types';
import { RESOURCE_IDS } from '@/game/constants';
import { jobsOf } from '@/game/data/buildings';
import { JOB_BY_ID } from '@/game/data/jobs';
import { SEASON_META } from '@/game/data/seasons';
import {
  activeBoons,
  bondedShare,
  councilSeat,
  deedBonded,
  deedProduction,
  deedWorkers,
  decreeOf,
  faithDef,
  faithTilt,
  levelOutputMult,
  moraleOutputMult,
  seasonModsFor,
  seasonOf,
  siegeYield,
  stewardMult,
  peasantsMult,
  hallLevel,
  yearOf,
} from '@/game/derived';
import { REST_LABEL } from '@/ui/kit/breakdown';
import { YARD_BY_JOB } from '@/game/data/yards';
import { councilTier } from '@/game/councilrules';
import { postTitle } from '@/game/data/council';
import { ESTATE_META } from '@/game/data/estates';

export type OutputStepId = 'hands' | 'bonded' | 'level' | 'season' | 'boon' | 'morale' | 'faith' | 'decree' | 'council' | 'estate' | 'siege' | 'rest';

/** Строка разбора: что прибавило к выходу, со множителем или числом рук. `add` — по каждому ресурсу двора. */
export interface OutputStep {
  id: OutputStepId;
  label: string;
  /** Множитель строкой («×1,25»); у рук — `null`: их вклад — само число. */
  factor: number | null;
  add: Partial<Record<ResourceId, number>>;
}

export interface YardOutput {
  job: JobId;
  /** Ресурсы двора порядком таблицы ресурсов. */
  res: ResourceId[];
  steps: OutputStep[];
  /** Выход за игровой день — `deedProduction`, а не сумма строк. */
  total: Partial<Record<ResourceId, number>>;
}

/** Меньше этого — запись, а не дыра в разборе и не строка. */
export const OUTPUT_EPS = 0.05;

/** Множитель, который ничего не меняет, строки не получает. */
const idle = (f: number): boolean => Math.abs(f - 1) < 1e-9;

/**
 * Разбор выхода дела постройки за игровой день (ЗД-1: у двора с двумя делами — каждого врозь); не названо — первое дело.
 * `null` — постройка не двор (у профессии нет выработки ресурсов). Нет рук — строк нет, выход ноль.
 */
export function yardOutput(s: GameState, b: Building, deed?: JobId): YardOutput | null {
  const job = deed ?? jobsOf(b.type)[0];
  if (!job || !jobsOf(b.type).includes(job)) return null;
  const per = JOB_BY_ID[job].yield;
  const res = RESOURCE_IDS.filter((r) => (per[r] ?? 0) > 0);
  if (res.length === 0) return null;

  const prod = deedProduction(s, b, job);
  const total: Partial<Record<ResourceId, number>> = {};
  for (const r of res) total[r] = prod[r];

  const steps: OutputStep[] = [];
  const run: Partial<Record<ResourceId, number>> = {};
  for (const r of res) run[r] = 0;

  // Руки: вольные — по выработке профессии, невольники — на свою долю (`bondedShare`), той же строкой таблицы.
  const free = deedWorkers(s, job);
  const bonded = deedBonded(s, job);
  const base = (id: 'hands' | 'bonded', label: string, heads: number, factor: number | null): void => {
    if (heads <= 0) return;
    const add: Partial<Record<ResourceId, number>> = {};
    for (const r of res) {
      add[r] = heads * (per[r] ?? 0) * (factor ?? 1);
      run[r] = (run[r] ?? 0) + add[r]!;
    }
    steps.push({ id, label, factor, add });
  };
  base('hands', `Рабочие ${free}`, free, null);
  base('bonded', `Невольники ${bonded}`, bonded, bondedShare(s));

  // Множители — по одному на строку; каждый пишет то, что прибавил к набранному. По ресурсам множитель бывает разный
  // (осада режет еду иначе, чем прочее) — тогда в строке его нет, а вклад у каждого ресурса свой.
  const times = (id: OutputStepId, label: string, f: (r: ResourceId) => number): void => {
    const fs = res.map(f);
    if (fs.every(idle)) return;
    const add: Partial<Record<ResourceId, number>> = {};
    res.forEach((r, i) => {
      add[r] = (run[r] ?? 0) * (fs[i] - 1);
      run[r] = (run[r] ?? 0) * fs[i];
    });
    steps.push({ id, label, factor: fs.every((x) => Math.abs(x - fs[0]) < 1e-9) ? fs[0] : null, add });
  };

  const season = seasonOf(s.time);
  const seasonJob = seasonModsFor(season, yearOf(s.time)).jobs[job] ?? 1;
  times('level', `Уровень ${b.level}`, () => levelOutputMult(b.level));
  times('season', SEASON_META[season].name, () => seasonJob);
  // Вести множат профессию поверх сезона, каждая своей строкой (`derived.withBoons`).
  for (const { def } of activeBoons(s)) times('boon', def.name, () => def.jobs?.[job] ?? 1);
  times('morale', `Мораль ${Math.round(s.morale)}`, () => moraleOutputMult(s.morale));
  times('faith', faithDef(s)?.name ?? 'Вера', () => faithTilt(s).output);
  times('decree', decreeOf(s).name, () => decreeOf(s).output);
  // Староста (РТ-1) множит добычу дворов — строкой с его именем, тем же множителем, что кладёт добро (`derived.stewardMult`).
  const steward = councilSeat(s, 'steward');
  if (steward && YARD_BY_JOB.has(job)) times('council', `${postTitle('steward', councilTier(hallLevel(s)))} ${steward.name}`, () => stewardMult(s));
  // Крестьянство в силе (РТ-2) множит добычу дворов — строкой сословия, тем же множителем (`derived.peasantsMult`).
  if (YARD_BY_JOB.has(job)) times('estate', ESTATE_META.peasants.name, () => peasantsMult(s));
  times('siege', 'Осада', (r) => siegeYield(s, r));

  // Остаток — дыра в разборе: строка «Прочее», которой быть не должно (тест).
  const rest: Partial<Record<ResourceId, number>> = {};
  let hole = false;
  for (const r of res) {
    rest[r] = (total[r] ?? 0) - (run[r] ?? 0);
    if (Math.abs(rest[r]!) > OUTPUT_EPS) hole = true;
  }
  if (hole) steps.push({ id: 'rest', label: REST_LABEL, factor: null, add: rest });

  return { job, res, steps: steps.filter((st) => res.some((r) => Math.abs(st.add[r] ?? 0) > 1e-9)), total };
}
