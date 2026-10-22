// Окно «Жители» (UI-5, docs/ui_v2.md, 5.4): что здесь нужно игроку — сводка одной таблицей (люди, жильё, прирост,
// мораль, оборона: число, его разбор подсказкой и дверь к источнику) и места работы — куда поставить свободные руки.
// Дружина и невольники — не жители: у них свои окна, здесь от них строка-ссылка (`PeoplePanel`).
//
// Чистые функции от партии: числа — функциями игры (правило 18), разборы — те же, что у подсказок верха (`hudTips`:
// жители, жильё, мораль, оборона), двери — набором (`kit/sources`). Своей арифметики у строк нет; тест сверяет каждую
// строку с функцией игры и каждый разбор — с итогом (`people.test.ts`).
import type { Building, BuildingTypeId, GameState, JobId } from '@/game/types';
import { MORALE_GROWTH_ZERO } from '@/game/constants';
import { jobsOf } from '@/game/data/buildings';
import { YARD_BY_JOB } from '@/game/data/yards';
import { FREE_JOBS, JOB_BY_ID } from '@/game/data/jobs';
import {
  bondedCount,
  buildingOfType,
  buildingSlots,
  buildingStat,
  buildingTitle,
  defense,
  freeJobCount,
  homeArmy,
  housingCapacity,
  idleCount,
  mastersOn,
  moraleBreakdown,
  workerCount,
  deedWorkers,
} from '@/game/derived';
import { popGrowth } from '@/game/sim/population';
import { dec } from '@/game/num';
import { breakdown } from '@/ui/kit/breakdown';
import { WINDOW, makersOf, sourceWord, toBuilding, type Source } from '@/ui/kit/sources';
import type { Tone } from '@/ui/kit/Num';
import { moodOf } from '@/ui/icons/registry';
import { defenseTip, fmtInt, housingTip, moraleTip, popRate, popTip, type TipGo } from './hudTips';
import type { TipContent } from './tip';
import type { IconName } from '@/ui/icons/alias';

export type SummaryKey = 'people' | 'housing' | 'growth' | 'morale' | 'defense';

/** Строка сводки: число, строка пояснения 11 px, разбор подсказкой и дверь к источнику. */
export interface SummaryLine {
  key: SummaryKey;
  label: string;
  icon: IconName;
  value: string;
  sub: string;
  tone?: Tone;
  tip: () => TipContent;
  /** Куда ведёт дверь «›»: окно числа (`WINDOW`) или постройка, которая его делает. */
  to: Source;
}

/** Сколько жителей на местах в постройках и на вольном сборе (`derived.busyCount` — по частям, для разбора). */
function busyParts(s: GameState): { inside: number; wild: number } {
  let inside = 0;
  for (const b of s.buildings) inside += workerCount(s, b.id);
  let wild = 0;
  for (const job of FREE_JOBS) wild += freeJobCount(s, job);
  return { inside, wild };
}

/**
 * Кто такие жители: на местах в постройках, на вольном сборе, свободные руки и ушедшие разведчиками (они — те же
 * свободные руки, которых нет в городе: `derived.buildRate`, `defense`). Итог — `s.pop`. Бойцы и невольники в жителях
 * не считаются — у них свои окна. Дверь — «Прирост», где число делается («Кого считаем»).
 */
export function peopleTip(s: GameState, go: TipGo): TipContent {
  const { inside, wild } = busyParts(s);
  const idle = idleCount(s);
  const scouts = Math.min(idle, Math.max(0, s.scoutsAway));
  return breakdown({
    title: `Жители · ${fmtInt(s.pop)}`,
    body: 'Бойцы и невольники — не жители: их считают «Дружина» и «Порядок».',
    total: s.pop,
    parts: [
      { label: 'На местах в постройках', value: inside },
      { label: 'Вольный сбор', value: wild },
      { label: 'Свободные руки', value: idle - scouts },
      { label: 'Разведчики в пути', value: scouts },
    ],
    fmt: fmtInt,
    eps: 0.5,
    sumLabel: 'Всего',
    link: { label: sourceWord(WINDOW.pop), go: () => go.tab('pop') },
  });
}

/**
 * Свободные руки (`idleCount`): жители минус те, кто на местах в постройках и на вольном сборе. Строят, пока идёт стройка,
 * а без неё отдыхают на площади; ушедшие разведчиками — среди них, но не в городе.
 */
export function idleTip(s: GameState): TipContent {
  const { inside, wild } = busyParts(s);
  const scouts = Math.max(0, s.scoutsAway);
  return breakdown({
    title: `Свободные руки · ${fmtInt(idleCount(s))}`,
    body: `Строят, пока идёт стройка, без неё отдыхают на площади.${scouts > 0 ? ` Из них в разведке ${fmtInt(scouts)}.` : ''}`,
    total: idleCount(s),
    parts: [
      { label: 'Жители', value: s.pop },
      { label: 'На местах в постройках', value: -inside },
      { label: 'Вольный сбор', value: -wild },
    ],
    fmt: (n) => (n < 0 ? `−${fmtInt(-n)}` : fmtInt(n)),
    eps: 0.5,
    sumLabel: 'Свободны',
  });
}

/** Как множитель прироста называется в строке «тормозит» — как в окне «Прирост». */
const FACTOR_WORD = { morale: 'мораль', housing: 'жильё', food: 'еда' } as const;

/** Что тормозит прирост: самый малый из трёх множителей, если он не на полном ходу. Пусто — ничто. */
export function growthBrake(s: GameState): string {
  const g = popGrowth(s);
  const ks = [
    ['morale', g.morale],
    ['housing', g.housing],
    ['food', g.food],
  ] as const;
  const low = Math.min(...ks.map(([, k]) => k));
  if (low >= 0.999) return '';
  return ks
    .filter(([, k]) => k <= low + 1e-6)
    .map(([id]) => FACTOR_WORD[id])
    .join(', ');
}

/**
 * Дверь строки «Жильё» — постройка с жильём, у которой больше всего мест сейчас (та же, что первая главная кнопка её
 * разбора, `hudTips.housingTip`; при равенстве — порядок `makersOf`). Своего окна у жилья нет.
 */
export function housingDoor(s: GameState): Source {
  let best: BuildingTypeId | null = null;
  let most = -Infinity;
  for (const type of makersOf('pop')) {
    const b = buildingOfType(s, type);
    if (!b) continue;
    const n = buildingStat(b, 'housing');
    if (n > most) {
      most = n;
      best = type;
    }
  }
  return best ? toBuilding(best) : { kind: 'build' };
}

/**
 * Сводка: пять строк — люди, жильё, прирост, мораль, оборона. Число — тем же, чем его пишет игра на других экранах
 * (жители и жильё — целыми, прирост — с сотыми `popRate`, мораль — целым, оборона — `dec(…, 0)`, как в «Дружине»).
 * Разбор — подсказки верха; дверь — окно числа, у жилья — постройка с жильём (своего окна у жилья нет).
 */
export function summaryLines(s: GameState, go: TipGo): SummaryLine[] {
  const housing = housingCapacity(s);
  const room = Math.max(0, housing - s.pop);
  const g = popGrowth(s);
  const m = moraleBreakdown(s);
  const idle = idleCount(s);
  const brake = growthBrake(s);
  const mood = moodOf(s.morale);
  return [
    {
      key: 'people',
      label: 'Люди',
      icon: 'nav-people',
      value: fmtInt(s.pop),
      sub: `работают ${fmtInt(s.pop - idle)} · свободны ${fmtInt(idle)}`,
      tip: () => peopleTip(s, go),
      to: WINDOW.pop,
    },
    {
      key: 'housing',
      label: 'Жильё',
      icon: 'bld-houses',
      value: fmtInt(housing),
      sub: room > 0 ? `занято ${fmtInt(s.pop)} · свободно ${fmtInt(room)}` : `занято ${fmtInt(s.pop)} · мест нет`,
      tone: room > 0 ? undefined : 'bad',
      tip: () => housingTip(s, go),
      to: housingDoor(s),
    },
    {
      key: 'growth',
      label: 'Прирост',
      icon: 'hud-pop',
      value: popRate(g.perDay),
      sub: g.blocked ?? (brake ? `в день · тормозит ${brake}` : 'в день · на полном ходу'),
      tone: g.perDay > 0 ? 'good' : g.perDay < 0 ? 'bad' : 'muted',
      // Своё имя у подсказки: в сводке жильё — своей строкой, второй разбор здесь лишний.
      tip: () => ({ ...popTip(s, go), title: `Прирост · ${popRate(g.perDay)} в день`, more: undefined }),
      to: WINDOW.pop,
    },
    {
      key: 'morale',
      label: 'Мораль',
      icon: mood.name,
      value: String(Math.round(s.morale)),
      sub: s.morale < MORALE_GROWTH_ZERO ? `ниже ${MORALE_GROWTH_ZERO} — жители уходят` : `идёт к ${Math.round(m.target)}`,
      tone: s.morale < MORALE_GROWTH_ZERO ? 'bad' : undefined,
      tip: () => moraleTip(s, go),
      to: WINDOW.morale,
    },
    {
      key: 'defense',
      label: 'Оборона',
      icon: 'bld-palisade',
      value: dec(defense(s), 0),
      sub: `дружина дома ${fmtInt(homeArmy(s))}`,
      tip: () => defenseTip(s, go),
      to: WINDOW.defense,
    },
  ];
}

/** Место работы: постройка с местами или площадь (вольный сбор). */
export interface Workplace {
  key: string;
  /** Постройка — её номер; площадь — номер площади (вольный сбор идёт у неё). */
  id: number | null;
  type: BuildingTypeId;
  name: string;
  /** Строка пояснения: профессия, кто ещё на местах; у площади — кто на вольном сборе. */
  sub: string;
  /** Жители на местах (вольные; невольники и мастера — в строке пояснения). */
  people: number;
  /** Свободных мест: места минус все руки (`handsCount`: жители, невольники, мастера); `null` — без предела. */
  free: number | null;
  /** Порядок: 0 — стоит без рук, 1 — есть места, 2 — полна, 3 — площадь. */
  rank: number;
}

const jobName = (job: JobId | undefined): string => (job ? JOB_BY_ID[job].name : '');

/** Чем заняты люди постройки: у одного дела — имя профессии, у двора с двумя делами — дела с людьми (ЗД-1). */
function deedsLine(s: GameState, b: Building): string {
  const jobs = jobsOf(b.type);
  if (jobs.length <= 1) return jobName(jobs[0]);
  return jobs.map((job) => `${(YARD_BY_JOB.get(job)?.deed ?? jobName(job)).toLowerCase()} ${fmtInt(deedWorkers(s, job))}`).join(' · ');
}

/**
 * Места работы — куда поставить свободные руки. Каждая постройка с местами (`buildingSlots` > 0): жители на местах,
 * свободные места (`buildingSlots − handsCount` — места у вольных, невольников и мастеров общие). Сначала те, где рук нет
 * вовсе (метка «стоит без рабочих» над крышей), потом с местами, потом полные; при равенстве — порядок построек в городе.
 * Последней — площадь: вольный сбор без предела, вполсилы (`sim/workers.changeFreeJob`). Ставят людей в окне постройки —
 * дверь строки ведёт туда.
 */
export function workplaces(s: GameState): Workplace[] {
  const out: Workplace[] = [];
  s.buildings.forEach((b: Building) => {
    const slots = buildingSlots(b);
    if (slots <= 0) return;
    const people = workerCount(s, b.id);
    const bonded = bondedCount(s, b.id);
    const masters = mastersOn(s, b.id);
    const hands = people + bonded + masters;
    const free = Math.max(0, slots - hands);
    const extra = [bonded > 0 ? `невольников ${fmtInt(bonded)}` : '', masters > 0 ? `мастеров ${fmtInt(masters)}` : ''];
    out.push({
      key: `b${b.id}`,
      id: b.id,
      type: b.type,
      name: buildingTitle(s, b.type),
      sub: [deedsLine(s, b), ...extra].filter(Boolean).join(' · '),
      people,
      free,
      rank: hands === 0 ? 0 : free > 0 ? 1 : 2,
    });
  });
  out.sort((a, b) => a.rank - b.rank);
  const square = buildingOfType(s, 'campfire');
  if (square) {
    const wild = FREE_JOBS.filter((job) => freeJobCount(s, job) > 0);
    out.push({
      key: 'square',
      id: square.id,
      type: 'campfire',
      name: buildingTitle(s, 'campfire'),
      sub: wild.length ? wild.map((job) => `${jobName(job)} ${fmtInt(freeJobCount(s, job))}`).join(' · ') : 'вольный сбор вполсилы',
      people: wild.reduce((n, job) => n + freeJobCount(s, job), 0),
      free: null,
      rank: 3,
    });
  }
  return out;
}
