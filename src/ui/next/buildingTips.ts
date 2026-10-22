// Подсказки окна постройки нового интерфейса — чистые функции (правило 18: числа — из функций игры, тест
// сверяет строку с ними, `building.test.ts`).
import type { Building, GameState, JobId, ResourceId } from '@/game/types';
import { BUILDING_BY_ID, jobsOf } from '@/game/data/buildings';
import { ORDER_TEXT } from '@/game/data/order';
import { JOB_BY_ID } from '@/game/data/jobs';
import { YARD_BY_JOB } from '@/game/data/yards';
import {
  bondedCount,
  buildingHousing,
  buildingSlots,
  buildingStat,
  buildingTitle,
  deedHands,
  deedProduction,
  deedSlots,
  deedWorkers,
  handsCount,
  idleCount,
  isOutsideWall,
  townHallBuildMult,
  workerCount,
} from '@/game/derived';
import { RESOURCE_IDS, RESOURCE_META } from '@/game/constants';
import { breakdown } from '@/ui/kit/breakdown';
import { yardOutput } from './output';
import { dec } from '@/game/num';
import type { UpgradeGain } from '@/ui/parts/upgrade';
import { count } from '@/ui/parts/plural';
import type { TipContent } from './tip';

/**
 * Чем постройка занята сейчас — числами игры. У рабочего здания это люди на местах, у пассивного — то, что оно уже
 * даёт городу. `null` — сказать числом нечего. Строка ратуши (`TownBuild`) и подсказка окна постройки говорят одно.
 */
export function buildingFacts(s: GameState, b: Building): string | null {
  const slots = buildingSlots(b);
  const jobs = jobsOf(b.type);
  // Двор с двумя делами — руки по делам (ЗД-1): «Поле 4/12 · Загон 0/12»; места у каждого дела свои.
  if (slots > 0 && jobs.length > 1) {
    return jobs.map((job) => `${YARD_BY_JOB.get(job)?.deed ?? JOB_BY_ID[job].name} ${deedHands(s, job)}/${deedSlots(b)}`).join(' · ');
  }
  if (slots > 0) {
    // Невольники стоят на тех же местах: занятые места — это все руки, а не одни вольные.
    const bonded = bondedCount(s, b.id);
    return bonded > 0
      ? `Рабочих: ${handsCount(s, b.id)}/${slots} · ${ORDER_TEXT.bondedName.toLowerCase()} ${bonded}`
      : `Рабочих: ${workerCount(s, b.id)}/${slots}`;
  }
  const facts: string[] = [];
  if (b.type === 'town_hall') facts.push(`стройка ×${dec(townHallBuildMult(s), 2)}`);
  const housing = buildingHousing(b);
  if (housing) facts.push(`жильё ${housing}`);
  const storage = buildingStat(b, 'storage');
  if (storage) facts.push(`вместимость +${storage}`);
  const defence = buildingStat(b, 'defense');
  if (defence) facts.push(`оборона +${defence}`);
  const morale = buildingStat(b, 'morale');
  if (morale) facts.push(`мораль +${morale}`);
  return facts.length > 0 ? facts.join(' · ') : null;
}

/**
 * Описание постройки по значку шапки окна — два слоя (docs/voice.md, 3): строка вкуса курсивом и строка дела, а за
 * ней — что постройка даёт сейчас, числами `buildingFacts` (без слова «сейчас»: строка числа — как в ратуше).
 */
export function buildingTip(s: GameState, b: Building): TipContent {
  const def = BUILDING_BY_ID[b.type];
  const now = buildingFacts(s, b);
  const body = now ? `${def.description} ${now[0].toUpperCase()}${now.slice(1)}.` : def.description;
  return {
    title: buildingTitle(s, b.type),
    lore: def.flavor,
    // Двор за стеной — словом здесь, меткой «за стеной» в шапке окна: прорвавшийся набег разгоняет его людей.
    body: isOutsideWall(b.type) ? `${body} ${OUTSIDE_WORDS}` : body,
  };
}

/** Что значит «за стеной» — одна фраза на подсказку постройки. */
export const OUTSIDE_WORDS = 'Двор за стеной: прорвавшийся набег разгонит людей.';

/**
 * Подсказка по значку рабочих: сколько занято из скольких, сколько свободных рук в племени, дадут ли что-то
 * свободные места и сколько мест прибавит следующий уровень — замером `upgradeGains`, а не числом рядом.
 */
export function workerTip(job: string, hands: number, slots: number, free: number, gains: UpgradeGain[] | null, spareHelps: boolean): TipContent {
  const parts = [`Свободных рук в городе: ${free}.`];
  if (hands < slots && !spareHelps) parts.push('Выработка на потолке, новые руки ничего не дадут.');
  const more = gains?.find((g) => g.id === 'slots');
  if (more) parts.push(`Следующий уровень даст ещё ${count(more.after - more.before, 'место', 'места', 'мест')}.`);
  return { title: `${job} · ${hands} из ${slots}`, body: parts.join(' ') };
}

/**
 * Выработка дела в день сейчас и с ещё одним рабочим — под шагом «+1 / +10» (отзыв тестеров 11.10, docs/feedback.md:
 * «непонятно, что добавляется»). Обе — `deedProduction` (правило 18): «с ещё одним» — то же состояние, где на этом
 * деле на одного вольного больше. `more` нет — добавить нельзя (мест или свободных рук нет). Пусто — работа постройки
 * не ложится на склад (стройка, кузня, найм): строки нет. Дело не названо — первое дело постройки.
 */
export function workerYield(s: GameState, b: Building, deed?: JobId): { id: ResourceId; now: number; more: number | null }[] {
  const job = deed ?? jobsOf(b.type)[0];
  if (!job) return [];
  const now = deedProduction(s, b, job);
  const room = deedSlots(b) - deedHands(s, job);
  const more = room > 0 && idleCount(s) > 0 ? deedProduction({ ...s, workers: { ...s.workers, [job]: deedWorkers(s, job) + 1 } }, b, job) : null;
  return RESOURCE_IDS.filter((r) => now[r] > 0.005 || (more?.[r] ?? 0) > 0.005).map((r) => ({ id: r, now: now[r], more: more ? more[r] : null }));
}

/**
 * Разбор выработки дела в день — подсказкой по строке «В день» у двора с двумя делами (ЗД-1): таблицы выхода под каждым
 * делом окну не по росту, и разбор встаёт по касанию. Строки — шаги `yardOutput` (руки, уровень, сезон, вести, мораль,
 * вера, указ, осада), итог — `deedProduction`; второй ресурс дела — вторым разбором. `null` — дело не добывает.
 */
export function deedTip(s: GameState, b: Building, job: JobId): TipContent | null {
  const out = yardOutput(s, b, job);
  if (!out) return null;
  const deed = YARD_BY_JOB.get(job)?.deed ?? JOB_BY_ID[job].name;
  const one = (r: ResourceId): TipContent =>
    breakdown({
      title: `${deed}: ${RESOURCE_META[r].name.toLowerCase()} в день`,
      total: out.total[r] ?? 0,
      parts: out.steps.map((st) => ({ label: st.label, value: st.add[r] ?? 0 })),
      sumLabel: 'Итого',
    });
  const [main, second] = out.res;
  const tip = one(main);
  if (out.steps.length === 0) return { ...tip, body: 'Нет рабочих. Поставь людей на места.' };
  if (second) {
    const more = one(second);
    return { ...tip, more: { title: more.title, rows: more.rows ?? [], sum: more.sum } };
  }
  return tip;
}
