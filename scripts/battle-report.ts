// Балансные прогоны боя: таблица «кто кому проигрывает», решётка составов, кольцо контрров,
// ограничитель, кость и длительность. Запуск: npm run battle:report.
// Те же числа держат тесты в src/battle/battle.test.ts; здесь они видны глазами.
//
// Бои считаются веером (`lib/fan.ts`): задачи — в `battle-jobs.ts`, здесь — какие задачи
// раздать, в каком порядке собрать и что напечатать. Отбор поиска составов в два этапа идёт двумя
// волнами (всё независимое, потом перемер лучших), и между волнами — точка сбора.
//
// Все стороны встают по правилу развёртывания: плана, приказов, пресетов, быстрой атаки и
// раскладки у удара нет (docs/battle_eu4.md, 14.5). Разделы о них — «Планы», «Планы на всей сетке»,
// «Пресеты быстрой атаки», «Разрыв быстрой атаки», «Перебор расстановок», «Случайный поиск
// расстановок», «Заслон: линия по силе» — ушли вместе с предметом; поиск наведён на составы.
import { DICE, PHASES, PHASE_PIP, UNIT_KINDS, UNIT_STATS, COUNTER, simulateBattle, deploySetup, describeEvent, type ArmySetup, type BattleResult, type Stack } from '../src/battle';
import { ARMY_SIZE, BALANCED_ARMY, COMPOSITIONS, EDGE_STEPS, LATTICE_STEP, OVERSIZE_SIZES, holdSize, answerlessOwnKind, compositionLattice, compositionName, latticeRows, searchPool, searchShortlist, searchFinish, OVERSIZE_CAP, OVERSIZE_SEEDS, RATIO_EVEN, RING, SEARCH, hasLine, lossRatio, type LatticeRow } from '../src/battle/bench';
import { FRONT_WIDTH, circleLength, roundsCap } from '../src/battle/config';
import { VARIANT_NAMES, runJobs, type Brief, type Edge, type Job, type Out, type Pair, type Reach } from './battle-jobs';

const SEEDS = Number(process.env.SEEDS ?? 40);

function pad(s: string | number, w: number, right = false): string {
  const t = String(s);
  return right ? t.padStart(w) : t.padEnd(w);
}

/**
 * Волна задач: задача ставится с тем, что вернёт, и одна и та же задача дважды не считается —
 * одинаковый довод даёт тот же итог. Итоги читаются после `run`.
 */
class Wave {
  private jobs: Job[] = [];
  private at = new Map<string, number>();
  private outs: Out[] | null = null;
  add<K extends Job['kind']>(job: Extract<Job, { kind: K }>): () => Extract<Out, { kind: K }> {
    const key = JSON.stringify(job);
    let i = this.at.get(key);
    if (i === undefined) this.at.set(key, (i = this.jobs.push(job) - 1));
    const n = i;
    return () => {
      if (!this.outs) throw new Error('волна ещё не посчитана');
      return this.outs[n] as Extract<Out, { kind: K }>;
    };
  }
  async run(): Promise<void> {
    this.outs = await runJobs(this.jobs);
  }
}

/** Куски строк решётки примерно поровну по числу пар: строка i играет с каждым j > i. */
function latticeChunks(n: number, parts: number): Array<[number, number]> {
  const total = (n * (n - 1)) / 2;
  const out: Array<[number, number]> = [];
  let from = 0;
  let acc = 0;
  for (let i = 0; i < n; i += 1) {
    acc += n - 1 - i;
    if (acc >= total / parts || i === n - 1) {
      out.push([from, i + 1]);
      from = i + 1;
      acc = 0;
    }
  }
  return out;
}

/** Отрезки `0..n` по `size`. */
const slices = (n: number, size: number): Array<[number, number]> => Array.from({ length: Math.ceil(n / size) }, (_, k) => [k * size, Math.min(n, (k + 1) * size)]);

// ---------- Волна 1: всё, что не ждёт ничьих итогов ----------

const w1 = new Wave();
const lattice = compositionLattice();
const pool = searchPool();

// Самые дорогие — первыми: решётка × «Тяжёлая» и отбор поиска.
const latticeOf = VARIANT_NAMES.map((_, variant) => latticeChunks(lattice.length, 8).map(([from, to]) => ({ from, to, out: w1.add({ kind: 'lattice', variant, from, to }) })));
const poolScreen = slices(pool.length, 50).map(([from, to]) => w1.add({ kind: 'pool', from, to }));

/** Матрица «каждый против каждого»: пара i–j одной задачей, строка j–i — те же бои с другой стороны. */
function matrix(set: 'compositions' | 'pure', n: number, seeds: number): (i: number, j: number) => Pair[] {
  const got = new Map<number, () => Extract<Out, { kind: 'pair' }>>();
  for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) got.set(i * n + j, w1.add({ kind: 'pair', set, i, j, seeds }));
  return (i, j) => (i < j ? got.get(i * n + j)!().ab : got.get(j * n + i)!().ba);
}
const compositionPairs = matrix('compositions', COMPOSITIONS.length, SEEDS);
// «Ограничитель» и кость меряются там, где выведен шаг кости: на размере W, с шириной и кругами (`bench.holdSize`).
const HOLD = holdSize();
const oversizeAt = (total: number, bare = false): Array<() => Extract<Out, { kind: 'oversize' }>> =>
  COMPOSITIONS.map((_, composition) => w1.add({ kind: 'oversize', composition, total, ...(bare ? { bare } : {}) }));
const oversize = oversizeAt(HOLD);
// Круги сечи и ширина по размерам: «Ограничитель» на ½W, W и 2W с шириной и на ARMY_SIZE без неё.
const bySize = [...OVERSIZE_SIZES.map((total) => ({ total, bare: false })), { total: ARMY_SIZE, bare: true }].map((s) => ({
  ...s,
  rows: !s.bare && s.total === HOLD ? oversize : oversizeAt(s.total, s.bare),
}));
const dice = w1.add({ kind: 'dice' });
const ringPairs = RING.map((_, ring) => w1.add({ kind: 'ring', ring, seeds: SEEDS }));
// Круги по размерам: сколько боёв до них доходит — матрица составов.
const reachAt = [...OVERSIZE_SIZES, ARMY_SIZE].map((total) => ({ total, got: w1.add({ kind: 'reach', total }) }));
const pureDuels = matrix('pure', UNIT_KINDS.length, 6);
// «Лезвие» (разбор, слово владельца 27.09.2026): решётка составов против себя больших, кусками по десять составов.
const EDGE_CHUNK = 10;
const latticeSize = compositionLattice().length;
const edgeAt = (step: number, dice: 'bare' | 'config', pace: number): Array<() => Extract<Out, { kind: 'edge' }>> => {
  const out: Array<() => Extract<Out, { kind: 'edge' }>> = [];
  for (let from = 0; from < latticeSize; from += EDGE_CHUNK) out.push(w1.add({ kind: 'edge', step, dice, pace, from, to: Math.min(latticeSize, from + EDGE_CHUNK) }));
  return out;
};
const EDGE_RUNS = [
  { name: 'без кости, темп морали ×1', dice: 'bare' as const, pace: 1 },
  { name: `кость ${DICE.step}, темп морали ×1`, dice: 'config' as const, pace: 1 },
  { name: 'без кости, темп морали ×2', dice: 'bare' as const, pace: 2 },
  { name: `кость ${DICE.step}, темп морали ×2`, dice: 'config' as const, pace: 2 },
].map((run) => ({ ...run, steps: EDGE_STEPS.map((_, step) => edgeAt(step, run.dice, run.pace)) }));

await w1.run();

// ---------- Печать разделов, которым хватило первой волны ----------

/** Бои «Длительности»: матрица составов и кольцо, каждый бой один раз, в порядке, в каком их играл отчёт. */
const compositionResults: Brief[] = [];

/**
 * Серия зеркальных боёв. `wins/draws/losses` — кто удержал поле (результат),
 * `ratio` — средний размен (цена), `pyrrhic` — сколько боёв из 2×seeds выиграны
 * с непомерными потерями. Выводы «кто кому проигрывает» делаются по размену.
 *
 * `into` — куда лечь боям серии. У матрицы составов — только со строки, где пара встречается
 * впервые (i < j): строка j–i — те же бои. Прежде они ложились с обеих строк, и «Длительность»
 * считала каждый бой матрицы дважды, а бои кольца — один раз (docs/acceptance.md).
 */
function series(ms: readonly Pair[], into?: Brief[]): { wins: number; losses: number; draws: number; ratio: number; pyrrhic: number } {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let ratio = 0;
  let pyrrhic = 0;
  for (const r of ms) {
    if (r.field.a > r.field.b) wins += 1;
    else if (r.field.b > r.field.a) losses += 1;
    else draws += 1;
    ratio += r.lossRatio;
    pyrrhic += r.pyrrhic;
    into?.push(...r.results);
  }
  return { wins, losses, draws, ratio: ratio / ms.length, pyrrhic };
}
const beatsByRatio = (ratio: number): 'a' | 'b' | 'draw' => (ratio >= RATIO_EVEN ? 'a' : ratio <= 1 / RATIO_EVEN ? 'b' : 'draw');

console.log(`\n=== Составы (${COMPOSITIONS.length}) по ${SEEDS} боёв на пару, каждая пара с обеих сторон поля ===`);
const names = COMPOSITIONS.map((c) => c.name);
const W = 14;
console.log(pad('', W) + names.map((n) => pad(n, W)).join(''));
const beats: Record<string, string[]> = {};
const losesTo: Record<string, string[]> = {};
const costly: Record<string, string[]> = {};
for (const [ai, a] of COMPOSITIONS.entries()) {
  beats[a.name] = [];
  losesTo[a.name] = [];
  costly[a.name] = [];
  let row = pad(a.name, W);
  for (const [bi, b] of COMPOSITIONS.entries()) {
    if (a === b) {
      row += pad('—', W);
      continue;
    }
    const s = series(compositionPairs(ai, bi), ai < bi ? compositionResults : undefined);
    const verdict = beatsByRatio(s.ratio);
    if (verdict === 'a') beats[a.name].push(b.name);
    else if (verdict === 'b') losesTo[a.name].push(b.name);
    if (s.wins > s.losses && verdict !== 'a') costly[a.name].push(b.name);
    row += pad(`${s.wins}/${s.draws}/${s.losses} ${s.ratio.toFixed(2)}`, W);
  }
  console.log(row);
}
console.log('\nячейка: удержали поле / ничьих / отдали поле (результат) и размен чужие/свои (цена)');
console.log('выводы — по размену: проигрывает, если размен ≤ 1/1.05; удерживает поле дороже, чем противник, — победа с непомерными потерями');
for (const c of COMPOSITIONS) {
  console.log(`${pad(c.name, W)} проигрывает размен: ${losesTo[c.name].join(', ') || '— НИКОМУ'}${costly[c.name].length ? `; держит поле с непомерными потерями против: ${costly[c.name].join(', ')}` : ''}`);
}

/** Решётка при варианте «Тяжёлой» из кусков задач — тем же `latticeRows`, что и `latticeDuels`. */
const latticeAt = (variant: number): LatticeRow[] => {
  const n = lattice.length;
  const ratio = new Float64Array(n * n);
  for (const c of latticeOf[variant]) {
    const { ratios } = c.out();
    let k = 0;
    for (let i = c.from; i < c.to; i += 1) for (let j = i + 1; j < n; j += 1) ratio[i * n + j] = ratios[k++];
  }
  return latticeRows(lattice, (i, j) => ratio[i * n + j]);
};

console.log(`\n=== Решётка составов: все составы из 600 бойцов строя шагом ${LATTICE_STEP} по всем родам, каждый против каждого одним зеркальным боем ===`);
// Та же решётка, что держит тест «нет доминирующего состава» (`bench.latticeDuels`), правило
// развёртывания. Её же строкой «как есть» читает раздел «Тяжёлая»: числа там те же, и второй раз она не играется.
const latticeRowsAsIs = latticeAt(0);
{
  // Утверждение теста — «каждый кому-то проигрывает» — видит только строгое превосходство;
  // строка «ответа без своего рода нет» видит обязательный род: всё, что бьёт состав, построено
  // на его же главном роде.
  const rows = latticeRowsAsIs;
  const n = rows.length;
  const pct = (i: number): string => `${Math.round((100 * rows[i].beats.length) / (n - 1))}%`;
  const order = [...rows.keys()].sort((a, b) => rows[b].beats.length - rows[a].beats.length);
  console.log(`составов ${n}; десять, что бьют больше всех (бьёт, из ${n - 1}; кому проигрывает — и сколько бьёт он сам):`);
  for (const i of order.slice(0, 10)) {
    console.log(`  ${pad(compositionName(rows[i].army), 60)} ${pad(rows[i].beats.length, 3, true)} ${pad(pct(i), 4, true)}  проигрывает ${rows[i].lostTo.length}: ${rows[i].lostTo.map((j) => `${compositionName(rows[j].army)} (${pct(j)})`).join('; ')}`);
  }
  const undefeated = order.filter((i) => rows[i].lostTo.length === 0);
  console.log(`никому не проигрывает: ${undefeated.map((i) => `${compositionName(rows[i].army)} (${pct(i)})`).join('; ') || '— (тест «нет доминирующего состава» зелёный)'}`);
  const answerless = order.filter((i) => answerlessOwnKind(rows, i));
  console.log(`ответа без своего главного рода нет: ${answerless.map((i) => `${compositionName(rows[i].army)} (${pct(i)})`).join('; ') || '—'}`);
}

console.log('\n=== Тяжёлая: откуда сила (решётка составов, правило развёртывания) ===');
{
  // Каждое число тяжёлой по очереди ставится на то, что стоит на той же оси у пехоты или у
  // лёгкой (правило классов: своих чисел у тяжёлой нет, каждое взято у другого рода), и решётка
  // перемеряется целиком. Где она стоит, решает правило развёртывания: с краёв первой линии. Удар с
  // разбега (`CLASH_CAVALRY_IMPACT`) — константа ядра, отсюда не подменяется и здесь не измерен.
  // Подмены ставит задача в своём процессе (`battle-jobs.ts`, `VARIANTS`); здесь — только имена.
  const duel = (i: number, j: number): number => {
    let r = 0;
    for (const m of pureDuels(i, j)) r += m.lossRatio;
    return r / 6;
  };
  const statLine = (k: 'heavy' | 'infantry' | 'cavalry'): string => {
    const u = UNIT_STATS[k];
    const c = k === 'infantry' ? COUNTER.infantry.all : COUNTER[k].infantry;
    return `рукопашная ${u.melee}, стойкость ${u.toughness}, скорость ${u.speed}, мораль ${u.morale}, по пехоте ×${c}`;
  };
  console.log(`числа: тяжёлая — ${statLine('heavy')}; пехота — ${statLine('infantry')}; лёгкая — ${statLine('cavalry')}`);
  console.log(`род против рода, ${ARMY_SIZE} на ${ARMY_SIZE}, правило развёртывания, 6 сидов × обе стороны (размен строки): ${UNIT_KINDS.map((k) => pad(k, 9, true)).join('')}`);
  for (const [ai, a] of UNIT_KINDS.entries()) console.log(`  ${pad(a, 9)}${UNIT_KINDS.map((b, bi) => pad(a === b ? '—' : duel(ai, bi).toFixed(2), 9, true)).join('')}`);

  const iOf = (army: Partial<Stack>): number => lattice.findIndex((a) => UNIT_KINDS.every((k) => (a[k] ?? 0) === (army[k] ?? 0)));
  const watched = [{ infantry: 150, heavy: 450 }, { heavy: 600 }, { infantry: 300, heavy: 300 }].map(iOf);
  console.log('что меняется (решётка целиком на каждую строку): лучший состав и сколько бьёт; с тяжёлой в первой десятке; ответа без своего рода нет у; ' + watched.map((i) => compositionName(lattice[i])).join(' / '));
  for (const [variant, name] of VARIANT_NAMES.entries()) {
    const rows = variant === 0 ? latticeRowsAsIs : latticeAt(variant);
    const n = rows.length;
    const pct = (i: number): string => `${Math.round((100 * rows[i].beats.length) / (n - 1))}%`;
    const order = [...rows.keys()].sort((a, b) => rows[b].beats.length - rows[a].beats.length);
    const top10 = order.slice(0, 10).filter((i) => (rows[i].army.heavy ?? 0) > 0).length;
    const answerless = order.filter((i) => answerlessOwnKind(rows, i));
    console.log(`  ${pad(name, 40)} ${pad(compositionName(rows[order[0]].army), 50)} ${pad(pct(order[0]), 4, true)}  ${pad(top10, 2, true)}/10  ${pad(answerless.length, 2, true)}  ${watched.map((i) => pad(pct(i), 4, true)).join(' /')}`);
  }
}

console.log('\n=== Кольцо контрров: пары встают по правилу развёртывания ===');
for (const [i, pair] of RING.entries()) {
  const s = series(ringPairs[i]().pairs, compositionResults);
  // Разброс по сидам: тест кольца требует порога с каждого сида, а не в среднем (`battle.test.ts`, «кольцо контрров»).
  const bySeed = ringPairs[i]().pairs.map((p) => p.lossRatio);
  console.log(`${pad(pair.name, 44)} размен ${s.ratio.toFixed(2)} (поле удержано ${s.wins}/${SEEDS}; по сидам ${Math.min(...bySeed).toFixed(2)}–${Math.max(...bySeed).toFixed(2)})`);
}

console.log('\n=== Длительность и чем кончается бой (матрица составов) ===');
{
  const sorted = compositionResults.map((r) => r.ticks).sort((x, y) => x - y);
  const q = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  console.log(`боёв ${sorted.length}: мин ${sorted[0]}, медиана ${q(0.5)}, 90% ${q(0.9)}, макс ${sorted[sorted.length - 1]} тиков`);
  const early = compositionResults.filter((r) => r.early);
  const reasons: Record<string, number> = {};
  for (const r of compositionResults) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  console.log(
    `досрочно (отступление до гонга) ${early.length} (${((100 * early.length) / sorted.length).toFixed(1)}%), по таймауту ${sorted.length - early.length}; исходы: ${Object.entries(reasons)
      .map(([k, n]) => `${k} ${n}`)
      .join(', ')}`,
  );
  const et = early.map((r) => r.ticks).sort((x, y) => x - y);
  const eq = (p: number): number => et[Math.min(et.length - 1, Math.floor(et.length * p))];
  if (et.length) console.log(`длительность досрочных: мин ${et[0]}, 25% ${eq(0.25)}, медиана ${eq(0.5)}, 75% ${eq(0.75)}, макс ${et[et.length - 1]}`);
}

console.log(`\n=== Ограничитель: перевес 10% при прочих равных, ${HOLD} бойцов строя — размер, на котором выведен шаг кости; размен большей стороны (цель ≈1.5) ===`);
for (const [i, c] of COMPOSITIONS.entries()) {
  const { bigLoss, smallLoss, wins } = oversize[i]();
  const cap = hasLine(c.army) ? `потолок ${OVERSIZE_CAP.line}` : `без пешей линии, потолок ${OVERSIZE_CAP.noLine}`;
  console.log(`${pad(c.name, W)} размен ${(smallLoss / Math.max(1, bigLoss)).toFixed(2)} (${cap}), поле удержано ${wins}/${OVERSIZE_SEEDS}`);
}

console.log('\n=== Кость фазы: сторона на 10% больше удерживает поле (цель — доля владельца, DICE.hold) ===');
{
  const all = COMPOSITIONS.length * OVERSIZE_SEEDS;
  const held = oversize.reduce((n, o) => n + o().wins, 0);
  const { derived, bare } = dice();
  const phases = PHASES.filter((p) => PHASE_PIP[p]).length;
  console.log(`кость: ${DICE.faces} граней на сторону в каждой из ${phases} фаз с костью (у отступления и преследования её нет), шаг ${DICE.step} на грань`);
  console.log(`поле у большей, все составы «Ограничителя» разом, ${HOLD} бойцов строя: ${held}/${all} (${((100 * held) / all).toFixed(1)}%); без кости — ${Math.round(bare * all)}/${all}`);
  // В конфиг шаг записан до четырёх знаков вверх: вниз доля ушла бы выше цели.
  console.log(
    `вывод: наименьший шаг, при котором большая удерживает поле не чаще ${Math.round(DICE.hold * 100)}%, — ${derived.toFixed(5)}, до четырёх знаков вверх — ${(Math.ceil(derived * 1e4) / 1e4).toFixed(4)}; в конфиге DICE.step = ${DICE.step}`,
  );
}

console.log('\n=== Круги сечи и ширина по размерам: «Ограничитель» (перевес 10%) на ½W, W и 2W с шириной и без ширины ===');
{
  console.log(`ширина фронта W = ${FRONT_WIDTH} на полосу; глубина — армия меньшей стороны к трём полосам ширины (без ширины — единица); потолок кругов — config.roundsCap`);
  console.log('мерка владельца: до потолка кругов доходит не больше нескольких процентов боёв, ничья бывает только там');
  console.log(`${pad('размер', 22)} глубина  потолок   поле у большей        ничьих    до потолка  размен большей`);
  const all = COMPOSITIONS.length * OVERSIZE_SEEDS;
  const pct = (n: number): string => `${n}/${all} (${((100 * n) / all).toFixed(1)}%)`;
  for (const { total, bare, rows } of bySize) {
    const got = rows.map((o) => o());
    const sum = (k: 'wins' | 'draws' | 'gong' | 'bigLoss' | 'smallLoss'): number => got.reduce((n, o) => n + o[k], 0);
    const depth = bare ? 0 : total / (3 * FRONT_WIDTH);
    console.log(
      `${pad(`${total}, ${bare ? 'без ширины' : `W ${FRONT_WIDTH}`}`, 22)} ${Math.max(1, depth).toFixed(2).padStart(7)}  ${String(roundsCap(depth)).padStart(7)}  ${pct(sum('wins')).padStart(15)}  ${pct(sum('draws')).padStart(12)}  ${pct(sum('gong')).padStart(12)}  ${(sum('smallLoss') / Math.max(1, sum('bigLoss'))).toFixed(2).padStart(14)}`,
    );
  }
}

console.log('\n=== Круги по размерам: сколько боёв доходит до второго круга (обстрел, сшибка, сеча снова) ===');
{
  // Круги всем боем: фазы по родам живут в каждом круге, и бой, решённый в первом, видит их один раз. Матрица
  // составов — все пары, 2 сида.
  console.log(`круг, тиков: ${[1, 2, 3, 4].map((k) => circleLength(k)).join(' / ')} (дальше — как третий)`);
  console.log(`${pad('размер', 8)}  матрица составов: с кругами, сшибок на бой`);
  const share = (r: Reach): string => `${r.rounds}/${r.n} (${((100 * r.rounds) / r.n).toFixed(1)}%)`;
  for (const { total, got } of reachAt) {
    const { matrix: m } = got();
    console.log(`${pad(total, 8)}  ${share(m).padStart(16)}, ${(m.clashes / m.n).toFixed(2)}`);
  }
  // Длительность — тики боя и секунды его ролика по матрице составов: медиана, 90 % и самый долгий.
  const at = (xs: number[], p: number): number => xs[Math.min(xs.length - 1, Math.floor(xs.length * p))];
  const spread = (xs: number[]): string => `${at(xs, 0.5)} / ${at(xs, 0.9)} / ${xs[xs.length - 1]}`;
  console.log(`${pad('размер', 8)}  тики боя: медиана / 90% / макс     ролик, секунд: медиана / 90% / макс`);
  for (const { total, got } of reachAt) {
    const { matrix: m } = got();
    console.log(`${pad(total, 8)}  ${spread(m.ticks).padStart(22)}           ${spread(m.seconds).padStart(18)}`);
  }
}

console.log('\n=== Лезвие: как кончаются бои и кривая «перевес → поле» (разбор «исхода на лезвии», слово владельца 27.09.2026) ===');
{
  // Решётка составов на размере W против себя же больших на ступень, большая — с обеих сторон поля. Бой без кости
  // от сида не зависит — один на сторону; с костью — сиды 1..4. Темп ×2 — проба (`bench.withMoralePace`: потеря
  // морали от потерь людьми вдвое быстрее), а не число модели.
  const sum = (parts: Array<() => Extract<Out, { kind: 'edge' }>>): Edge =>
    parts.reduce(
      (acc, p) => {
        const e = p().edge;
        acc.n += e.n;
        acc.held += e.held;
        acc.draws += e.draws;
        for (const [k, v] of Object.entries(e.reasons)) acc.reasons[k] = (acc.reasons[k] ?? 0) + v;
        acc.loserLoss.push(...e.loserLoss);
        acc.spearsHeld += e.spearsHeld;
        return acc;
      },
      { n: 0, held: 0, draws: 0, reasons: {} as Record<string, number>, loserLoss: [] as number[], spearsHeld: 0 },
    );
  const pc = (a: number, b: number): string => `${((100 * a) / Math.max(1, b)).toFixed(1)}%`;
  console.log(`решётка — ${latticeSize} составов на ${HOLD} бойцов строя; ступени — ${EDGE_STEPS.map((s) => s.name).join(', ')}`);
  console.log(`${pad('прогон', 30)}${EDGE_STEPS.map((s) => pad(`поле у большей ${s.name}`, 24, true)).join('')}`);
  for (const run of EDGE_RUNS) {
    const cells = run.steps.map((parts) => {
      const e = sum(parts);
      return pad(`${pc(e.held, e.n)} (ничьих ${e.draws})`, 24, true);
    });
    console.log(`${pad(run.name, 30)}${cells.join('')}`);
  }
  console.log('как кончаются бои — все ступени разом; «некому встать» — у проигравшего в строю никого и резерв исчерпан,');
  console.log('«перебиты» — меньше 3 %, «итог по сохранённым» — никто не сломался до потолка кругов; потеря проигравшего — доля армии к концу боя, с погоней;');
  const spearsAndHorse = compositionLattice().filter((a) => (a.spear ?? 0) > 0 && ((a.cavalry ?? 0) > 0 || (a.heavy ?? 0) > 0)).length;
  console.log(`«копья держат» — боёв, в журнале которых есть «копья остановили удар» (в решётке ${spearsAndHorse} составов из ${latticeSize} — с копьями и конницей)`);
  console.log(`${pad('прогон', 30)}${pad('боёв', 7, true)}${pad('некому встать', 16, true)}${pad('перебиты', 12, true)}${pad('итог по сохр.', 15, true)}${pad('ничья', 9, true)}${pad('копья держат', 14, true)}   потеря проигравшего: 25% / медиана / 75%`);
  for (const run of EDGE_RUNS) {
    const e = sum(run.steps.flat());
    const at = (p: number): string => {
      const xs = e.loserLoss.slice().sort((x, y) => x - y);
      return xs.length ? `${Math.round(100 * xs[Math.min(xs.length - 1, Math.floor(xs.length * p))])}%` : '—';
    };
    const r = (k: string): string => pc(e.reasons[k] ?? 0, e.n);
    console.log(`${pad(run.name, 30)}${pad(e.n, 7, true)}${pad(r('morale'), 16, true)}${pad(r('annihilated'), 12, true)}${pad(r('losses'), 15, true)}${pad(r('draw'), 9, true)}${pad(e.spearsHeld, 14, true)}   ${at(0.25)} / ${at(0.5)} / ${at(0.75)}`);
  }
}

// ---------- Волна 2: перемер лучших из отбора ----------

// Поиск: отбор каждого состава на `SEARCH.screen` боях против сбалансированного, лучшие — на новых сидах.
const shortlist = searchShortlist(poolScreen.flatMap((c) => c().gaps), pool);
const w2 = new Wave();
const finals = shortlist.map((f) => w2.add({ kind: 'gap', pool: f.index, n: SEARCH.final, from: SEARCH.finalFrom }));
await w2.run();

console.log(`\n=== Случайный поиск составов: ${SEARCH.n} наугад (сид ${SEARCH.seed}) против сбалансированного; отбор на ${SEARCH.screen} боях, ${SEARCH.finalists} лучших — на ${SEARCH.final} новых сидах с ${SEARCH.finalFrom} ===`);
{
  // Машинка двухэтапного поиска наведена на составы (`bench.randomArmy`): каждый — `ARMY_SIZE` бойцов строя
  // наугад по родам, встаёт по правилу развёртывания. Решётка видит составы шагом `LATTICE_STEP`; всё, что
  // между её узлами, видит только поиск. Отбор на десяти боях выбирает и удачу, поэтому число берётся
  // с перемера, а не с отбора.
  const brief = (x: ArmySetup): string => {
    const a = UNIT_KINDS.map((k) => (['A', 'B', 'C', 'D', 'E', 'F', 'R'] as const).reduce((n, id) => n + x.sectors[id][k], 0));
    return UNIT_KINDS.map((k, i) => `${k} ${a[i]}`).filter((_, i) => a[i] > 0).join(' + ');
  };
  const pc = (v: number): string => `${(v * 100).toFixed(1)}%`.padStart(7);
  console.log(`противник: ${compositionName(BALANCED_ARMY)}`);
  console.log('   №  отбор  перемер  побед пораж   состав');
  const ranked = searchFinish(shortlist, finals.map((f) => f().gap));
  for (const f of ranked) console.log(` ${pad(f.index, 4, true)} ${pc(f.screen)} ${pc(f.final.gap)}  ${pad(f.final.won, 4, true)} ${pad(f.final.lost, 5, true)}   ${brief(f.setup)}`);
  const bestScreen = [...ranked].sort((x, y) => y.screen - x.screen)[0];
  console.log(`лучший на перемере: ${pc(ranked[0].final.gap).trim()} (№ ${ranked[0].index}); лучший на отборе (№ ${bestScreen.index}) ${pc(bestScreen.screen).trim()} → на перемере ${pc(bestScreen.final.gap).trim()}`);
}

if (process.env.SHOW) {
  const [an, bn] = process.env.SHOW.split(':');
  const scale = Number(process.env.SCALE ?? 1);
  const ca = COMPOSITIONS.find((c) => c.name === an);
  const seed = Number(process.env.SEED ?? 1);
  const a = deploySetup(ca ? Object.fromEntries(Object.entries(ca.army).map(([k, n]) => [k, Math.round((n ?? 0) * scale)])) : BALANCED_ARMY);
  const b = COMPOSITIONS.find((c) => c.name === bn)?.setup ?? deploySetup(BALANCED_ARMY);
  const r: BattleResult = simulateBattle({ seed, attacker: a, defender: b });
  const line = (s: Stack): string => `копья ${s.spear} пехота ${s.infantry} лучники ${s.archer} лёгкая ${s.cavalry} тяжёлая ${s.heavy}`;
  console.log(`\n=== ${an} против ${bn}: ${r.winner} (${r.reason}), ${r.ticks} тиков, потери чужие/свои ${lossRatio(r, 'attacker').toFixed(2)} ===`);
  for (const side of ['attacker', 'defender'] as const) {
    const s = r.sides[side];
    const sectors = Object.entries(s.sectors)
      .filter(([, v]) => Object.values(v.initial).some((n) => n > 0))
      .map(([id, v]) => `${id}=${v.morale}${v.broken ? '†' : ''}`)
      .join(' ');
    console.log(`${side === 'attacker' ? 'нападающие' : 'обороняющиеся'} ${s.total.initial} → ${s.total.final} (${line(s.losses)}), мораль ${s.morale}; сектора: ${sectors}`);
  }
  console.log('потери по фазам (нап/обор): ' + r.phases.map((p) => `${p.phase} ${p.from}–${p.to}: ${p.losses.attacker}/${p.losses.defender}`).join(' | '));
  for (const e of r.log) console.log(`${String(e.tick).padStart(3)} ${describeEvent(e)}`);
}
