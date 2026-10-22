// Совет Ратуши — числами (РТ-1, docs/city_v3.md, «Решения РТ-1»): раздел `pop:report`.
//
// Своих чисел у совета два ряда — польза ступени (`GIFT_STEP`) и жалованье уровня (`ADVISOR_WAGE`), — и оба выводятся из
// целей владельца («+5 %, +10 %» за уровень — ориентир), а не выбираются. Цели записаны исходом игры, а не самим множителем:
//
//  Ц1. Староста: ровная игра со Старостой доходит до середины пути — среднего уровня построек `MID_LEVEL` — короче на
//      `STEP_PCT` % на каждую ступень его пользы (средней за путь: просители растут с ратушей).
//  Ц2. Казначей: за срок `SPAN_DAYS` ровной игры Казначей кладёт в казну за вычетом своего жалованья `STEP_PCT` % всего золота
//      казны на каждую ступень пользы (среднюю за срок, взвешенную золотом дня).
//  Ц3. Воевода: ступень стойкости — `STEP_PCT` % стартовой морали дружины мерки (`autopilot.MIX`) — та же мера, что «мораль
//      дружины +5 %» у советника EU4.
//  Ц4. Жалованье уровня L — половина валовой пользы Казначея этого уровня в ту минуту, когда ратуша ровной игры (без совета)
//      впервые даёт просителя уровня L: цена одна на уровень, польза у должности своя; Казначей платит за себя вдвое.
//
// Ровная игра — автопилот отчётов: высокий налог, найм по средствам, учит ветви, мир тихий; совет держит лучшим просителем по
// средствам (`autopilot.keepCouncil`). Набор — `COUNCIL_SEEDS` сидов партии (по умолчанию 7, 11, 13), числа — средние по нему.
//
// Польза входит в свою выборку (Старостой ратуша растёт быстрее — и просители лучше; жалованье выведено из пользы Казначея, а
// чистая польза Казначея — за вычетом жалованья), поэтому вывод — неподвижной точкой (правило 16): `COUNCIL_DERIVE=1`
// повторяет замер с записанными числами, пока выведенное не сойдётся с записанным; качается между двумя — полусумма.
//
//   npm run pop:report                             — раздел с записанными числами: цели и что вышло
//   COUNCIL_DERIVE=1 npm run pop:report            — вывод `GIFT_STEP` и `ADVISOR_WAGE` (пишет в src/game/councilrules.ts)
//   COUNCIL_SEEDS=7,11,13,17 npm run pop:report    — свой набор сидов
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AdvisorPost, GameState } from '@/game/types';
import { createInitialState } from '@/game/state';
import { seeded, setRandom } from '@/game/sim/random';
import { DAY_LENGTH } from '@/game/constants';
import { TAX_PER_POP } from '@/game/data/policy';
import { UNIT_STATS } from '@/battle/config';
import { KIND_OF } from '@/game/battle/kinds';
import { ADVISOR_WAGE, GIFT_STEP, MAX_ADVISOR_LEVEL, councilTier, giftSteps } from '@/game/councilrules';
import { councilSeat, hallLevel, population, taxIncomePerDay, taxOf } from '@/game/derived';
import { councilOf } from '@/game/sim/council';
import { MIX, pilot, player } from './autopilot';
import { GOLD_WORLD } from './pop-gold';

/** Ориентир владельца: +5 % за уровень — здесь исходом игры за ступень пользы. */
const STEP_PCT = 5;
/** Середина пути посёлка: средний уровень построек (потолок — 10). */
const MID_LEVEL = 6;
/** Срок Ц2, игровых дней: сутки отлучки (`MAX_OFFLINE_DAYS`) — пять раз, как у вестей державы считают «настоящие сутки». */
const SPAN_DAYS = 240;
/** Потолок прогона Ц1, игровых дней: середины пути ровная игра достигает раньше. */
const RUN_DAYS = 600;

const SEEDS = (process.env.COUNCIL_SEEDS ?? '7,11,13').split(',').map(Number).filter((n) => n > 0);
const DERIVE = process.env.COUNCIL_DERIVE === '1';

const avgLevel = (g: GameState): number => g.buildings.reduce((n, b) => n + b.level, 0) / g.buildings.length;
/** Налог без Казначея и без десятины — то, что Казначей множит (`derived.taxIncomePerDay`). */
const taxPart = (g: GameState): number => taxOf(g).perPop * population(g) * TAX_PER_POP;

interface Run {
  /** Игровая секунда, когда средний уровень дошёл до `MID_LEVEL`; не дошёл — `null`. */
  mid: number | null;
  /** Золото казны за срок `SPAN_DAYS`: налог (с Казначеем) и десятина. */
  income: number;
  /** Валовая польза Казначея за срок — доля налога сверх налога без него. */
  gift: number;
  /** Жалованье совета за срок — книгой совета (`CouncilState.paid`). */
  wages: number;
  /** Средние ступени пользы должности: по времени пути до середины (Староста), по золоту срока (Казначей). */
  steps: number;
  /** Когда ратуша впервые дала просителя уровня L (индекс — L) и налог в ту минуту. */
  tierAt: (number | null)[];
  taxAt: (number | null)[];
}

/** Одна партия ровной игры: совет из `posts`, сид `seed`; до середины пути и не меньше срока Ц2. */
async function run(seed: number, posts: readonly AdvisorPost[], watchPost: AdvisorPost | null): Promise<Run> {
  // Поток случайности — свой с начала у каждой партии: прогоны не зависят ни от порядка, ни друг от друга.
  setRandom(seeded(seed));
  const g = createInitialState(seed);
  g.tutorialDone = true;
  const out: Run = { mid: null, income: 0, gift: 0, wages: 0, steps: 0, tierAt: [null, 0, null, null], taxAt: [null, null, null, null] };
  out.taxAt[1] = taxPart(g);
  let last = g.time;
  let stepsT = 0;
  let span = 0;
  let paid0 = 0;
  const SPAN = SPAN_DAYS * DAY_LENGTH;
  await pilot({
    g,
    seconds: RUN_DAYS * DAY_LENGTH,
    player: player('means', { tax: 'high', ...(posts.length ? { council: posts } : {}) }),
    world: { seed: GOLD_WORLD, pulse: 30, raids: false },
    economy: 'live',
    tick: 1,
    decide: 30,
    // Партия без совета идёт и до третьей ступени совета — по ней жалованье третьего уровня (Ц4).
    until: (s) => s.time >= SPAN && out.mid !== null && (watchPost !== null || out.tierAt[MAX_ADVISOR_LEVEL] !== null),
    watch: {
      after: ({ g: s }) => {
        const dt = s.time - last;
        last = s.time;
        if (dt <= 0) return;
        const tier = councilTier(hallLevel(s));
        for (let l = 2; l <= MAX_ADVISOR_LEVEL; l++) {
          if (out.tierAt[l] === null && tier >= l) {
            out.tierAt[l] = s.time;
            out.taxAt[l] = taxPart(s);
          }
        }
        const a = watchPost ? councilSeat(s, watchPost) : null;
        const st = a ? giftSteps(a.level, a.trait) : 0;
        if (s.time <= SPAN) {
          const income = (taxIncomePerDay(s) * dt) / DAY_LENGTH;
          out.income += income;
          if (watchPost === 'treasurer' && a) out.gift += (taxPart(s) * GIFT_STEP.treasurer * st * dt) / DAY_LENGTH;
          // Ступени Казначея — средние по золоту, а не по времени: доля в казне взвешена золотом каждого дня.
          if (watchPost === 'treasurer') {
            stepsT += st * income;
            span += income;
          }
          paid0 = councilOf(s).paid;
        }
        if (out.mid === null) {
          if (watchPost === 'steward') {
            stepsT += st * dt;
            span += dt;
          }
          if (avgLevel(s) >= MID_LEVEL) out.mid = s.time;
        }
      },
    },
  });
  out.wages = paid0;
  out.steps = span > 0 ? stepsT / span : 0;
  return out;
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const fin = (xs: (number | null)[]): number[] => xs.filter((x): x is number => x !== null);

interface Measure {
  /** Ц1: укорочение пути со Старостой, доля; средняя польза — ступеней. */
  shorter: number;
  stewardSteps: number;
  t0: number;
  t1: number;
  /** Ц2: чистая доля Казначея в казне; средняя польза — ступеней. */
  net: number;
  treasurerSteps: number;
  /** Ц4: налог без совета в минуту, когда ратуша даёт уровень L (индекс — L). */
  taxAt: number[];
  tierDay: (number | null)[];
}

/** Партии по сидам — по одной, друг за другом. */
async function runs(posts: readonly AdvisorPost[], watchPost: AdvisorPost | null): Promise<Run[]> {
  const out: Run[] = [];
  for (const s of SEEDS) out.push(await run(s, posts, watchPost));
  return out;
}

async function measure(): Promise<Measure> {
  const base = await runs([], null);
  const stew = await runs(['steward'], 'steward');
  const trea = await runs(['treasurer'], 'treasurer');
  const t0 = mean(fin(base.map((r) => r.mid)));
  const t1 = mean(fin(stew.map((r) => r.mid)));
  const net = mean(trea.map((r) => (r.gift - r.wages) / Math.max(1, r.income)));
  const taxAt = [0, 1, 2, 3].map((l) => mean(fin(base.map((r) => r.taxAt[l]))));
  const tierDay = [0, 1, 2, 3].map((l) => {
    const xs = fin(base.map((r) => r.tierAt[l]));
    return xs.length === base.length ? mean(xs) / DAY_LENGTH : null;
  });
  return {
    shorter: t0 > 0 ? (t0 - t1) / t0 : 0,
    stewardSteps: mean(stew.map((r) => r.steps)),
    t0: t0 / DAY_LENGTH,
    t1: t1 / DAY_LENGTH,
    net,
    treasurerSteps: mean(trea.map((r) => r.steps)),
    taxAt,
    tierDay,
  };
}

/** Ц3: стартовая мораль дружины мерки — мораль родов, взвешенная числом бойцов (`battle/sim.startMorale` без стойкости). */
function mixMorale(): number {
  let men = 0;
  let sum = 0;
  for (const [id, n] of Object.entries(MIX)) {
    men += n ?? 0;
    sum += (n ?? 0) * UNIT_STATS[KIND_OF[id as keyof typeof KIND_OF]].morale;
  }
  return sum / Math.max(1, men);
}

/** Ц4: жалованье уровня L из пользы Казначея `gt` и налога в минуту ступени. */
const wagesOf = (gt: number, taxAt: number[]): number[] => [0, ...[1, 2, 3].map((l) => Math.round(10 * 0.5 * gt * l * taxAt[l]) / 10)];

const pct = (x: number): string => `${(x * 100).toFixed(1)} %`;

/** Записать выведенное в `councilrules.ts` — только два ряда чисел, строки вокруг не трогаются. */
function write(gift: Record<AdvisorPost, number>, wage: number[]): void {
  const file = fileURLToPath(new URL('../src/game/councilrules.ts', import.meta.url));
  let src = readFileSync(file, 'utf8');
  src = src.replace(/export const GIFT_STEP: Readonly<Record<AdvisorPost, number>> = \{[^}]*\};/, `export const GIFT_STEP: Readonly<Record<AdvisorPost, number>> = { steward: ${gift.steward}, treasurer: ${gift.treasurer}, marshal: ${gift.marshal} };`);
  src = src.replace(/export const ADVISOR_WAGE: readonly number\[\] = \[[^\]]*\];/, `export const ADVISOR_WAGE: readonly number[] = [${wage.join(', ')}];`);
  writeFileSync(file, src);
}

/** Мутируемая копия записанных чисел: вывод правит её, замер читает модуль правил (`GIFT_STEP`, `ADVISOR_WAGE`). */
function setNumbers(gift: Record<AdvisorPost, number>, wage: number[]): void {
  Object.assign(GIFT_STEP as Record<AdvisorPost, number>, gift);
  (ADVISOR_WAGE as number[]).splice(0, ADVISOR_WAGE.length, ...wage);
}

export async function councilSection(): Promise<void> {
  console.log('\nСовет Ратуши (РТ-1, docs/city_v3.md, «Решения РТ-1»).');
  console.log(`Ровная игра: налог высокий, найм по средствам, учит ветви, мир ${GOLD_WORLD} тихий; совет — лучший проситель по средствам; сиды ${SEEDS.join(', ')}.`);
  const marshal = Math.round(10 * (STEP_PCT / 100) * mixMorale()) / 10;
  let gift = { ...GIFT_STEP } as Record<AdvisorPost, number>;
  let wage = [...ADVISOR_WAGE];
  if (DERIVE) {
    gift.marshal = marshal;
    const seen: string[] = [];
    for (let k = 0; k < 12; k++) {
      setNumbers(gift, wage);
      const m = await measure();
      const wantS = (STEP_PCT / 100) * m.stewardSteps;
      const wantT = (STEP_PCT / 100) * m.treasurerSteps;
      const next = {
        steward: Math.round(1000 * gift.steward * (m.shorter > 0 ? wantS / m.shorter : 1)) / 1000,
        treasurer: Math.round(1000 * gift.treasurer * (m.net > 0 ? wantT / m.net : 1.5)) / 1000,
        marshal,
      };
      const nextWage = wagesOf(next.treasurer, m.taxAt);
      const key = JSON.stringify([next, nextWage]);
      console.log(`  заход ${k + 1}: Староста ${gift.steward} → ${next.steward} (путь короче ${pct(m.shorter)}, цель ${pct(wantS)}); Казначей ${gift.treasurer} → ${next.treasurer} (чисто ${pct(m.net)}, цель ${pct(wantT)}); жалованье ${nextWage.slice(1).join(' / ')}`);
      if (JSON.stringify([gift, wage]) === key) break;
      if (seen.includes(key)) {
        // Качается между двумя — полусумма (правило 16).
        const prev = JSON.parse(seen[seen.length - 1]) as [Record<AdvisorPost, number>, number[]];
        gift = {
          steward: Math.round(500 * (prev[0].steward + next.steward)) / 1000,
          treasurer: Math.round(500 * (prev[0].treasurer + next.treasurer)) / 1000,
          marshal,
        };
        wage = wagesOf(gift.treasurer, m.taxAt);
        console.log('  качается между двумя — полусумма.');
        break;
      }
      seen.push(key);
      gift = next;
      wage = nextWage;
    }
    write(gift, wage);
    console.log(`  записано в src/game/councilrules.ts: GIFT_STEP ${JSON.stringify(gift)}, ADVISOR_WAGE [${wage.join(', ')}].`);
  }
  setNumbers(gift, wage);
  const m = await measure();
  console.log(`  Ц1 Староста: до среднего уровня ${MID_LEVEL} — без совета ${m.t0.toFixed(0)} игр. дн., со Старостой ${m.t1.toFixed(0)}: короче на ${pct(m.shorter)} при пользе ${m.stewardSteps.toFixed(2)} ступ. — цель ${STEP_PCT} % за ступень: ${pct((STEP_PCT / 100) * m.stewardSteps)}.`);
  console.log(`  Ц2 Казначей: за ${SPAN_DAYS} игр. дн. чистая доля в казне ${pct(m.net)} при пользе ${m.treasurerSteps.toFixed(2)} ступ. — цель ${pct((STEP_PCT / 100) * m.treasurerSteps)}.`);
  console.log(`  Ц3 Воевода: стартовая мораль дружины мерки ${mixMorale().toFixed(1)}; ступень — ${STEP_PCT} %: ${marshal} (записано ${GIFT_STEP.marshal}).`);
  const tiers = [1, 2, 3].map((l) => `ур. ${l} — день ${m.tierDay[l] === null ? '—' : m.tierDay[l]!.toFixed(0)}, налог ${m.taxAt[l].toFixed(1)}`).join('; ');
  console.log(`  Ц4 Жалованье: ратуша ровной игры даёт просителя — ${tiers}. Половина пользы Казначея: ${wagesOf(GIFT_STEP.treasurer, m.taxAt).slice(1).join(' / ')} (записано ${ADVISOR_WAGE.slice(1).join(' / ')}).`);
  console.log(`  Записано: польза ступени Старосты ${GIFT_STEP.steward}, Казначея ${GIFT_STEP.treasurer}, Воеводы ${GIFT_STEP.marshal}; жалованье ${ADVISOR_WAGE.slice(1).join(' / ')} в игр. день.`);
}
