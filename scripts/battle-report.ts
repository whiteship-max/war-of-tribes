// Балансные прогоны боя: таблица «кто кому проигрывает», кольцо контрров,
// разрыв быстрой атаки и длительность. Запуск: npm run battle:report.
// Те же числа держат тесты в src/battle/battle.test.ts; здесь они видны глазами.
//
// Бои считаются веером (`lib/fan.ts`): задачи — в `battle-jobs.ts`, здесь — какие задачи
// раздать, в каком порядке собрать и что напечатать. Разделы от этого не зависят друг от друга
// больше, чем зависели: отбор расстановок в два этапа идёт тремя волнами (всё независимое, потом
// перемер лучших, потом лучшая против перебора), и между волнами — точка сбора.
import { COUNTER, COVER, DICE, PHASES, PHASE_PIP, UNIT_KINDS, UNIT_STATS, simulateBattle, quickAttack, quickSetup, describeEvent, PLANS, QUICK_PRESET_IDS, type ArmySetup, type BattleResult, type Plan, type Stack } from '../src/battle';
import { ARCHER_PLACES, ARMY_SIZE, BALANCED_ARMY, CAVALRY_PLACES, COMPOSITIONS, COVER_K_GRID, LATTICE_STEP, SCREEN_KINDS, nonDecreasing, screenPoints, answerlessOwnKind, compositionLattice, compositionName, latticeRows, COUNTER_TERMS, counterOf, searchPool, searchShortlist, searchFinish, KNOWN_COUNTER_INDEX, LINE_SHAPES, OVERSIZE_CAP, OVERSIZE_SEEDS, RATIO_EVEN, RESERVE_KINDS, RING, SEARCH, TUNED, TUNED_SPEC, hasLine, homogeneous, layoutGrid, layoutName, layoutOf, lossRatio, quickOf, type LatticeRow } from '../src/battle/bench';
import { VARIANT_NAMES, runJobs, type Brief, type Job, type Out, type Pair } from './battle-jobs';

const SEEDS = Number(process.env.SEEDS ?? 40);

function pad(s: string | number, w: number, right = false): string {
  const t = String(s);
  return right ? t.padStart(w) : t.padEnd(w);
}

/**
 * Волна задач: задача ставится с тем, что вернёт, и одна и та же задача дважды не считается —
 * одинаковый довод даёт тот же итог (прежде отчёт дважды считал, например, TUNED против быстрой
 * атаки на тех же ста сидах). Итоги читаются после `run`.
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
const grid = layoutGrid().map((spec) => ({ spec, setup: layoutOf(BALANCED_ARMY, spec) }));
const pool = searchPool();

// Самые дорогие — первыми: решётка × «Тяжёлая», поиск, перебор, заслон.
const latticeOf = VARIANT_NAMES.map((_, variant) => latticeChunks(lattice.length, 8).map(([from, to]) => ({ from, to, out: w1.add({ kind: 'lattice', variant, from, to }) })));
const poolScreen = (['quick', 'standard'] as const).map((opp) => slices(pool.length, 50).map(([from, to]) => w1.add({ kind: 'pool', opp, from, to })));
const gridScreen = slices(grid.length, 40).map(([from, to]) => w1.add({ kind: 'grid', from, to }));
const screens = SCREEN_KINDS.map((screen) => {
  const points = screenPoints(screen);
  return {
    screen,
    points,
    charge: points.map((men) => w1.add({ kind: 'worth', screen, men, order: 'charge', k: null })),
    old: points.map((men) => w1.add({ kind: 'worth', screen, men, order: 'attack-archers', k: 1e-9 })),
  };
});
const coverK = COVER_K_GRID.map((k) => ({ k, curves: screens.map((s) => s.points.map((men) => ({ men, worth: w1.add({ kind: 'worth', screen: s.screen, men, order: 'attack-archers', k }) }))) }));
const holdTuned = w1.add({ kind: 'hold', who: 'TUNED' });
const holdQuick = w1.add({ kind: 'hold', who: 'quick' });

/** Матрица «каждый против каждого»: пара i–j одной задачей, строка j–i — те же бои с другой стороны. */
function matrix(set: 'compositions' | 'plans' | 'presets' | 'pure', n: number, seeds: number): (i: number, j: number) => Pair[] {
  const got = new Map<number, () => Extract<Out, { kind: 'pair' }>>();
  for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) got.set(i * n + j, w1.add({ kind: 'pair', set, i, j, seeds }));
  return (i, j) => (i < j ? got.get(i * n + j)!().ab : got.get(j * n + i)!().ba);
}
const compositionPairs = matrix('compositions', COMPOSITIONS.length, SEEDS);
const oversize = COMPOSITIONS.map((_, composition) => w1.add({ kind: 'oversize', composition }));
const dice = w1.add({ kind: 'dice' });
const tunedGap = w1.add({ kind: 'gap', who: 'TUNED', opp: 'quick', n: 100, from: 1 });
const tunedByPreset = QUICK_PRESET_IDS.map((preset) => w1.add({ kind: 'gap', who: 'TUNED', opp: { preset }, n: 40, from: 1 }));
const knownStandard = w1.add({ kind: 'gap', who: 'KNOWN_COUNTER', opp: 'standard', n: SEARCH.final, from: SEARCH.finalFrom });
const knownQuick = w1.add({ kind: 'gap', who: 'KNOWN_COUNTER', opp: 'quick', n: SEARCH.final, from: SEARCH.finalFrom });
const tunedSearch = w1.add({ kind: 'gap', who: 'TUNED', opp: 'quick', n: SEARCH.final, from: SEARCH.finalFrom });
const ringPairs = RING.map((_, ring) => w1.add({ kind: 'ring', ring, seeds: SEEDS }));
const plans = Object.keys(PLANS) as Plan[];
const planPairs = matrix('plans', plans.length, Math.min(SEEDS, 12));
const presetPairs = matrix('presets', QUICK_PRESET_IDS.length, Math.min(SEEDS, 12));
const pureDuels = matrix('pure', UNIT_KINDS.length, 6);

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
// Та же решётка, что держит тест «нет доминирующего состава» (`bench.latticeDuels`), стандартный
// пресет. Её же строкой «как есть» читает раздел «Тяжёлая»: числа там те же, и второй раз она не играется.
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

console.log('\n=== Тяжёлая: откуда сила (решётка составов, стандартный пресет) ===');
{
  // Каждое число тяжёлой по очереди ставится на то, что стоит на той же оси у пехоты или у
  // лёгкой (правило классов: своих чисел у тяжёлой нет, каждое взято у другого рода), и решётка
  // перемеряется целиком. Отдельно — где пресет её ставит: в резерв или во фронт. Удар с разбега
  // (`CLASH_CAVALRY_IMPACT`) — константа ядра, отсюда не подменяется и здесь не измерен.
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
  console.log(`род против рода, ${ARMY_SIZE} на ${ARMY_SIZE}, быстрая атака, 6 сидов × обе стороны (размен строки): ${UNIT_KINDS.map((k) => pad(k, 9, true)).join('')}`);
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

console.log('\n=== Заслон: линия по силе (Battle.expose, COVER.K) ===');
{
  // Лёгкие ждут удара по лучникам за заслоном на тех же полосах (`bench.screenArmy`); ячейка —
  // что армия стоит против всей решётки составов (`bench.latticeWorth`: геометрический размен,
  // одним зеркальным боем на состав). Толщины — те, где заслон тоньше ждущих по силе боя
  // (`bench.screenPoints`). `COVER.K` выводится здесь: наименьшее из сетки, при котором обе
  // кривые не падают — тоньше заслон, не больше манёвра.
  const cell = (v: number): string => pad(v.toFixed(2), 7, true);
  for (const s of screens) {
    console.log(`заслон — ${s.screen}, лёгких ${s.points.map((m) => ARMY_SIZE - m).join('/')}; толщина заслона: ${s.points.map((m) => pad(m, 7, true)).join('')}`);
    console.log(`  ${pad('в лоб (лёгкая «атаковать сразу»)', 38)}${s.charge.map((w) => cell(w().worth)).join('')}`);
    console.log(`  ${pad('прежнее правило: по наличию (K → 0)', 38)}${s.old.map((w) => cell(w().worth)).join('')}`);
  }
  const ok: number[] = [];
  for (const { k, curves: got } of coverK) {
    const curves = got.map((c) => c.map((p) => ({ men: p.men, worth: p.worth().worth })));
    const good = curves.every(nonDecreasing);
    if (good) ok.push(k);
    console.log(`  K ${pad(k.toFixed(2), 5)} ${curves.map((c, i) => `${SCREEN_KINDS[i]}:${c.map((p) => cell(p.worth)).join('')}`).join('   ')}  ${good ? 'не падают' : 'ПАДАЕТ'}`);
  }
  const derived = ok.length ? Math.min(...ok) : null;
  console.log(`вывод: K = ${derived ?? 'НЕТ В СЕТКЕ'}; в конфиге COVER.K = ${COVER.K}${derived === COVER.K ? '' : ' — НЕ СОВПАДАЕТ С ВЫВОДОМ'}`);
}

console.log('\n=== Кольцо контрров при правильных приказах ===');
for (const [i, pair] of RING.entries()) {
  const s = series(ringPairs[i]().pairs, compositionResults);
  console.log(`${pad(pair.name, 44)} размен ${s.ratio.toFixed(2)} (поле удержано ${s.wins}/${SEEDS})`);
}

console.log('\n=== Планы: одна и та же армия на стандартной раскладке, план против плана ===');
{
  const PW = 16;
  console.log(pad('', PW) + plans.map((p) => pad(p, PW)).join(''));
  const undefeated: string[] = [];
  for (const [ai, a] of plans.entries()) {
    let row = pad(a, PW);
    let loses = 0;
    for (const [bi, b] of plans.entries()) {
      if (a === b) {
        row += pad('—', PW);
        continue;
      }
      const s = series(planPairs(ai, bi));
      if (beatsByRatio(s.ratio) === 'b') loses += 1;
      row += pad(`${s.wins}/${s.draws}/${s.losses} ${s.ratio.toFixed(2)}`, PW);
    }
    if (loses === 0) undefeated.push(a);
    console.log(row);
  }
  console.log(`никому не проигрывает размен: ${undefeated.join(', ') || 'нет'}`);
}

console.log('\n=== Пресеты быстрой атаки ===');
{
  const picks: Record<string, number> = {};
  const withIntel: Record<string, number> = {};
  for (let seed = 1; seed <= 400; seed += 1) {
    const p = quickAttack(BALANCED_ARMY, seed).preset;
    picks[p] = (picks[p] ?? 0) + 1;
    const q = quickAttack(BALANCED_ARMY, seed, { cavalry: 300, infantry: 200 }).preset;
    withIntel[q] = (withIntel[q] ?? 0) + 1;
  }
  console.log(`выбор на 400 сидов без разведки: ${QUICK_PRESET_IDS.map((id) => `${id} ${picks[id] ?? 0}`).join(', ')}`);
  console.log(`   с разведкой «много конницы»: ${QUICK_PRESET_IDS.map((id) => `${id} ${withIntel[id] ?? 0}`).join(', ')}`);
  console.log('пресет против пресета (строка против столбца, победы/ничьи/поражения и размен):');
  const PW = 14;
  console.log(pad('', PW) + QUICK_PRESET_IDS.map((p) => pad(p, PW)).join(''));
  for (const [ai, a] of QUICK_PRESET_IDS.entries()) {
    let row = pad(a, PW);
    for (const [bi, b] of QUICK_PRESET_IDS.entries()) {
      if (a === b) {
        row += pad('—', PW);
        continue;
      }
      const s = series(presetPairs(ai, bi));
      row += pad(`${s.wins}/${s.draws}/${s.losses} ${s.ratio.toFixed(2)}`, PW);
    }
    console.log(row);
  }
}

console.log('\n=== Разрыв быстрой атаки: настроенная против быстрой атаки (случайный пресет), 100 боёв ===');
{
  const t = tunedGap().gap;
  console.log(`настроенная (${layoutName(TUNED_SPEC)}): разрыв ${(t.gap * 100).toFixed(1)}% (коридор 10–25%, цель 15%), побед ${t.won}/100, поражений ${t.lost}/100`);
  for (const [i, id] of QUICK_PRESET_IDS.entries()) {
    const g = tunedByPreset[i]().gap;
    console.log(`   против ${pad(id, 13)} ${(g.gap * 100).toFixed(1).padStart(6)}% (побед ${g.won}/40)`);
  }
  const known = knownStandard().gap;
  const random = knownQuick().gap;
  console.log(`известный контрер стандарта (KNOWN_COUNTER — № ${KNOWN_COUNTER_INDEX} поиска, на его новых сидах): против стандарта ${(known.gap * 100).toFixed(1)}%, против случайного пресета ${(random.gap * 100).toFixed(1)}% (цель ≈15%)`);
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

console.log('\n=== Ограничитель: перевес 10% при прочих равных, размен большей стороны (цель ≈1.5) ===');
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
  console.log(`поле у большей, все составы «Ограничителя» разом: ${held}/${all} (${((100 * held) / all).toFixed(1)}%); без кости — ${Math.round(bare * all)}/${all}`);
  console.log(`вывод: наименьший шаг, при котором большая удерживает поле не чаще ${Math.round(DICE.hold * 100)}%, — ${derived.toFixed(4)}; в конфиге DICE.step = ${DICE.step}`);
}

// ---------- Волна 2: перемер лучших из отбора ----------

// Перебор: грубый отбор против каждого пресета, двадцать лучших — на тех же ста боях против
// быстрой атаки, что и разрыв настроенной армии выше.
const gridTop = grid
  .map((g, i) => ({ ...g, i, ...gridScreen[Math.floor(i / 40)]().rows[i % 40] }))
  .sort((a, b) => b.gap - a.gap)
  .slice(0, 20);
// Поиск: отбор каждой расстановки на `SEARCH.screen` боях, лучшие — на новых сидах.
const shortlist = poolScreen.map((chunks) => searchShortlist(chunks.flatMap((c) => c().gaps), pool));
const [quickList, standardList] = shortlist;

const w2 = new Wave();
const gridFull = gridTop.map((g) => w2.add({ kind: 'gap', who: { grid: g.i }, opp: 'quick', n: 100, from: 1 }));
const quickFinals = quickList.map((f) => w2.add({ kind: 'gap', who: { pool: f.index }, opp: 'quick', n: SEARCH.final, from: SEARCH.finalFrom }));
const standardFinals = standardList.map((f) => w2.add({ kind: 'gap', who: { pool: f.index }, opp: 'standard', n: SEARCH.final, from: SEARCH.finalFrom }));
const counterRandom = standardList.map((f) => w2.add({ kind: 'gap', who: { pool: f.index }, opp: 'quick', n: SEARCH.final, from: SEARCH.finalFrom }));
await w2.run();

// ---------- Волна 3: лучшая расстановка перебора против всего перебора ----------

const top = gridTop.map((g, k) => ({ ...g, full: gridFull[k]().gap }));
top.sort((a, b) => b.full.gap - a.full.gap);
const best = top[0];
const w3 = new Wave();
const vsGrid = slices(grid.length, 40).map(([from, to]) => w3.add({ kind: 'vsGrid', best: best.i, from, to }));
const holdBest = w3.add({ kind: 'hold', who: { grid: best.i } });
await w3.run();

console.log('\n=== Перебор расстановок: цена расстановки ===');
{
  // Сетка — `layoutGrid` из bench.ts, та же, что держат тесты. Две стадии: грубый отбор
  // против каждого пресета, потом двадцать лучших — на тех же ста боях против быстрой
  // атаки, что и разрыв настроенной армии выше. Раньше на месте этого раздела стояло
  // «потолок ≈25 %» без кода; число отсюда — единственное, на которое можно ссылаться.
  const homogeneousCount = grid.filter((g) => homogeneous(g.setup)).length;
  console.log(
    `расстановок ${grid.length}: линия ${Object.keys(LINE_SHAPES).length} × лучники ${ARCHER_PLACES.length} × конница ${CAVALRY_PLACES.length} × план ${Object.keys(PLANS).length} × резерв ${RESERVE_KINDS.length}; однородных вкладов в один сектор ${homogeneousCount}`,
  );
  console.log('десять лучших против быстрой атаки, 100 боёв (разрыв, побед, поражений):');
  for (const g of top.slice(0, 10)) {
    console.log(`  ${(g.full.gap * 100).toFixed(1).padStart(6)}%  ${pad(g.full.won, 3, true)} ${pad(g.full.lost, 3, true)}  ${homogeneous(g.setup) ? 'однородная ' : 'разложенная'}  ${layoutName(g.spec)}`);
  }
  const tuned = tunedGap().gap;
  console.log(`потолок: ${(best.full.gap * 100).toFixed(1)}% — ${layoutName(best.spec)}; настроенная TUNED: ${(tuned.gap * 100).toFixed(1)}%`);

  // Доминирование — не разрыв против шаблонов, а поле против всего остального. Лучшая
  // играет с каждой расстановкой сетки по бою; до правки рукопашной «всё в центр» держала
  // поле 100 % против каждого разложенного семейства и уступала только однородным.
  console.log('лучшая против всей сетки по формам линии (поле, размен):');
  const byLine: Record<string, { held: number; n: number; own: number; theirs: number }> = {};
  const fought = vsGrid.flatMap((c) => c().rows);
  grid.forEach((g, i) => {
    const r = fought[i];
    if (!r) return;
    const f = (byLine[g.spec.line] ??= { held: 0, n: 0, own: 0, theirs: 0 });
    f.n += 1;
    if (r.held) f.held += 1;
    f.own += r.own;
    f.theirs += r.theirs;
  });
  const whole = Object.values(byLine).every((f) => f.held === f.n);
  for (const [line, f] of Object.entries(byLine)) {
    console.log(`  против «${line}»: поле ${((100 * f.held) / f.n).toFixed(0)}%, размен ${(f.theirs / Math.max(1, f.own)).toFixed(2)}`);
  }
  console.log(whole ? 'ДОМИНИРУЕТ: держит поле против всей сетки' : 'поле против всей сетки не держит — доминирующей расстановки в сетке нет');

  // Цена расстановки силой: при каком перевесе врага (быстрая атака армии ×k) расстановка
  // удерживает поле в половине боёв. На этой мерке стоит разброс испытательного стенда.
  const point = (p: number): string => p.toFixed(3);
  console.log(`точка поля (перевес врага, при котором удержано полполя, 40 боёв): лучшая ×${point(holdBest().point)}, TUNED ×${point(holdTuned().point)}, быстрая атака ×${point(holdQuick().point)}`);
}

console.log(`\n=== Случайный поиск расстановок: ${SEARCH.n} наугад (сид ${SEARCH.seed}); отбор на ${SEARCH.screen} боях, ${SEARCH.finalists} лучших — на ${SEARCH.final} новых сидах с ${SEARCH.finalFrom} ===`);
{
  // Сетка видит только свои оси. Поиск — `bench.randomLayout`: лучники во фронте вперемешку
  // с линией, конница неровно по фронту, приказы всем родам. Отбор на десяти боях выбирает и
  // удачу, поэтому число берётся с перемера (`bench.searchFinal`), а не с отбора.
  const brief = (x: ArmySetup): string => {
    const cell = (id: keyof ArmySetup['sectors']): string => {
      const v = x.sectors[id];
      return (['spear', 'infantry', 'archer', 'cavalry', 'heavy'] as const).filter((k) => v[k] > 0).map((k) => `${k[0]}${v[k]}`).join('') || '—';
    };
    const o = x.orders;
    return `A ${cell('A')} B ${cell('B')} C ${cell('C')} | D ${cell('D')} E ${cell('E')} F ${cell('F')} | R ${cell('R')} | ${x.plan}, копья ${o.spear}, пехота ${o.infantry}, лучники ${o.archer}, конница ${o.cavalry}, резерв ${x.reserve.kind}`;
  };
  const pc = (v: number): string => `${(v * 100).toFixed(1)}%`.padStart(7);

  console.log('потолок цены расстановки — против быстрой атаки (случайный пресет по сиду):');
  console.log('   №  отбор  перемер  побед пораж   расстановка');
  const ceiling = searchFinish(quickList, quickFinals.map((f) => f().gap));
  for (const f of ceiling) console.log(` ${pad(f.index, 4, true)} ${pc(f.screen)} ${pc(f.final.gap)}  ${pad(f.final.won, 4, true)} ${pad(f.final.lost, 5, true)}   ${brief(f.setup)}`);
  const tuned = tunedSearch().gap;
  const bestScreen = [...ceiling].sort((x, y) => y.screen - x.screen)[0];
  console.log(`потолок: ${pc(ceiling[0].final.gap).trim()} (№ ${ceiling[0].index}); лучший на отборе (№ ${bestScreen.index}) ${pc(bestScreen.screen).trim()} → на перемере ${pc(bestScreen.final.gap).trim()}; TUNED на тех же сидах ${pc(tuned.gap).trim()}`);

  console.log('\nконтрер стандартного пресета: отбор и перемер против стандарта, против случайного пресета — те же новые сиды;');
  console.log(`условия (bench.counterHolds): против стандарта больше ${COUNTER_TERMS.known * 100}%, против случайного от ${COUNTER_TERMS.randomLow * 100}% до ${COUNTER_TERMS.randomHigh * 100}% и меньше половины первого`);
  console.log('   №  отбор  стандарт  случайный  случ/станд  условия   расстановка');
  const randomOf = new Map(standardList.map((f, k) => [f.index, counterRandom[k]().gap.gap]));
  const counters = counterOf(searchFinish(standardList, standardFinals.map((f) => f().gap)), (f) => randomOf.get(f.index)!);
  for (const f of counters) console.log(` ${pad(f.index, 4, true)} ${pc(f.screen)} ${pc(f.final.gap)}  ${pc(f.random)}   ${(f.random / f.final.gap).toFixed(2).padStart(9)}   ${f.holds ? 'да ' : 'нет'}      ${brief(f.setup)}`);
  const first = counters.find((f) => f.holds);
  if (first) console.log(`контрер стандарта по условиям теста — № ${first.index} поиска: первый по перемеру, кто их выполняет`);
  else {
    console.log(`контрера стандарта по условиям теста среди ${counters.length} финалистов нет; KNOWN_COUNTER теста (№ ${KNOWN_COUNTER_INDEX}) условиям больше не отвечает — эталон переписать`);
    // Что именно не выполнено: знает ли поиск тех, кто бьёт стандарт намного сильнее случайного пресета.
    const specific = counters.filter((f) => f.final.gap > COUNTER_TERMS.known && f.random < f.final.gap / 2);
    console.log(
      `  бьют стандарт больше ${COUNTER_TERMS.known * 100}% и случайный пресет меньше чем вполовину того: ${specific.map((f) => `№ ${f.index} — ${pc(f.final.gap).trim()} / ${pc(f.random).trim()}`).join('; ') || 'никто'}`,
    );
    if (specific.length) console.log(`  у них не выполнено: против случайного ${specific.map((f) => (f.random <= COUNTER_TERMS.randomLow ? `не больше ${COUNTER_TERMS.randomLow * 100}%` : `больше ${COUNTER_TERMS.randomHigh * 100}%`)).join('; ')}`);
    else console.log('  всё, что бьёт стандарт больше 40 %, бьёт и случайный пресет не меньше чем вполовину того');
  }
}

if (process.env.SHOW) {
  const [an, bn] = process.env.SHOW.split(':');
  const scale = Number(process.env.SCALE ?? 1);
  const ca = COMPOSITIONS.find((c) => c.name === an);
  const seed = Number(process.env.SEED ?? 1);
  const a = ca ? quickSetup(Object.fromEntries(Object.entries(ca.army).map(([k, n]) => [k, Math.round((n ?? 0) * scale)]))) : TUNED;
  const b = COMPOSITIONS.find((c) => c.name === bn)?.setup ?? quickOf(seed);
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
