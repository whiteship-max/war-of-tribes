// Балансные прогоны боя: таблица «кто кому проигрывает», кольцо контрров,
// разрыв быстрой атаки и длительность. Запуск: npm run battle:report.
// Те же числа держат тесты в src/battle/battle.test.ts; здесь они видны глазами.
import { COVER, simulateBattle, quickSetup, quickAttack, describeEvent, PHASE_TICKS, PLANS, QUICK_PRESETS, QUICK_PRESET_IDS, stackOf, type ArmySetup, type BattleResult, type Plan, type Stack } from '../src/battle';
import { ARCHER_PLACES, ARMY_SIZE, BALANCED_ARMY, CAVALRY_PLACES, COMPOSITIONS, COVER_K_GRID, LATTICE_STEP, SCREEN_KINDS, latticeWorth, nonDecreasing, screenArmy, screenCurve, screenPoints, withCoverK, answerlessOwnKind, compositionLattice, compositionName, latticeDuels, KNOWN_COUNTER, LINE_SHAPES, OVERSIZE_CAP, RATIO_EVEN, RESERVE_KINDS, RING, SEARCH, TUNED, TUNED_SPEC, gapAgainst, searchLayouts, hasLine, holdPoint, homogeneous, layoutGrid, layoutName, layoutOf, lossRatio, mirrored, quickOf } from '../src/battle/bench';

const SEEDS = Number(process.env.SEEDS ?? 40);

/** Бой кончился раньше потолка: сторона отступила, а не дождалась гонга. */
const fullLength = (r: BattleResult): number => r.phases.find((p) => p.phase === 'ranged')!.to + (Object.keys(PHASE_TICKS) as Array<keyof typeof PHASE_TICKS>).filter((p) => p !== 'ranged').reduce((n, p) => n + PHASE_TICKS[p], 0);
const endedEarly = (r: BattleResult): boolean => r.ticks < fullLength(r);
const allResults: BattleResult[] = [];

function pad(s: string | number, w: number, right = false): string {
  const t = String(s);
  return right ? t.padStart(w) : t.padEnd(w);
}

/** Победы первой стороны в серии боёв с обеих сторон поля. */
/**
 * Серия зеркальных боёв. `wins/draws/losses` — кто удержал поле (результат),
 * `ratio` — средний размен (цена), `pyrrhic` — сколько боёв из 2×seeds выиграны
 * с непомерными потерями. Выводы «кто кому проигрывает» делаются по размену.
 */
function series(a: ArmySetup, b: ArmySetup, seeds: number): { wins: number; losses: number; draws: number; ratio: number; pyrrhic: number } {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let ratio = 0;
  let pyrrhic = 0;
  for (let seed = 1; seed <= seeds; seed += 1) {
    const r = mirrored(a, b, seed);
    if (r.field.a > r.field.b) wins += 1;
    else if (r.field.b > r.field.a) losses += 1;
    else draws += 1;
    ratio += r.lossRatio;
    pyrrhic += r.pyrrhic;
    allResults.push(...r.results);
  }
  return { wins, losses, draws, ratio: ratio / seeds, pyrrhic };
}
const beatsByRatio = (ratio: number): 'a' | 'b' | 'draw' => (ratio >= RATIO_EVEN ? 'a' : ratio <= 1 / RATIO_EVEN ? 'b' : 'draw');

console.log(`\n=== Составы (${COMPOSITIONS.length}) по ${SEEDS} боёв на пару, каждая пара с обеих сторон поля ===`);
const names = COMPOSITIONS.map((c) => c.name);
const W = 14;
console.log(pad('', W) + names.map((n) => pad(n, W)).join(''));
const beats: Record<string, string[]> = {};
const losesTo: Record<string, string[]> = {};
const costly: Record<string, string[]> = {};
for (const a of COMPOSITIONS) {
  beats[a.name] = [];
  losesTo[a.name] = [];
  costly[a.name] = [];
  let row = pad(a.name, W);
  for (const b of COMPOSITIONS) {
    if (a === b) {
      row += pad('—', W);
      continue;
    }
    const s = series(a.setup, b.setup, SEEDS);
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

console.log(`\n=== Решётка составов: все составы из 600 бойцов строя шагом ${LATTICE_STEP} по всем родам, каждый против каждого одним зеркальным боем ===`);
{
  // Та же решётка, что держит тест «нет доминирующего состава» (`bench.latticeDuels`), стандартный
  // пресет. Утверждение теста — «каждый кому-то проигрывает» — видит только строгое превосходство;
  // строка «ответа без своего рода нет» видит обязательный род: всё, что бьёт состав, построено
  // на его же главном роде.
  const rows = latticeDuels(compositionLattice());
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

console.log('\n=== Заслон: линия по силе (Battle.expose, COVER.K) ===');
{
  // Лёгкие ждут удара по лучникам за заслоном на тех же полосах (`bench.screenArmy`); ячейка —
  // что армия стоит против всей решётки составов (`bench.latticeWorth`: геометрический размен,
  // одним зеркальным боем на состав). Толщины — те, где заслон тоньше ждущих по силе боя
  // (`bench.screenPoints`). `COVER.K` выводится здесь: наименьшее из сетки, при котором обе
  // кривые не падают — тоньше заслон, не больше манёвра.
  const foes = compositionLattice().map((a) => quickSetup(a));
  const cell = (v: number): string => pad(v.toFixed(2), 7, true);
  for (const screen of SCREEN_KINDS) {
    const points = screenPoints(screen);
    console.log(`заслон — ${screen}, лёгких ${points.map((m) => ARMY_SIZE - m).join('/')}; толщина заслона: ${points.map((m) => pad(m, 7, true)).join('')}`);
    console.log(`  ${pad('в лоб (лёгкая «атаковать сразу»)', 38)}${points.map((m) => cell(latticeWorth(screenArmy(screen, m, 'charge'), foes))).join('')}`);
    console.log(`  ${pad('прежнее правило: по наличию (K → 0)', 38)}${withCoverK(1e-9, () => points.map((m) => cell(latticeWorth(screenArmy(screen, m, 'attack-archers'), foes))).join(''))}`);
  }
  const ok: number[] = [];
  for (const k of COVER_K_GRID) {
    const curves = withCoverK(k, () => SCREEN_KINDS.map((screen) => screenCurve(screen, foes)));
    const good = curves.every(nonDecreasing);
    if (good) ok.push(k);
    console.log(`  K ${pad(k.toFixed(2), 5)} ${curves.map((c, i) => `${SCREEN_KINDS[i]}:${c.map((p) => cell(p.worth)).join('')}`).join('   ')}  ${good ? 'не падают' : 'ПАДАЕТ'}`);
  }
  const derived = ok.length ? Math.min(...ok) : null;
  console.log(`вывод: K = ${derived ?? 'НЕТ В СЕТКЕ'}; в конфиге COVER.K = ${COVER.K}${derived === COVER.K ? '' : ' — НЕ СОВПАДАЕТ С ВЫВОДОМ'}`);
}

console.log('\n=== Кольцо контрров при правильных приказах ===');
for (const pair of RING) {
  const s = series(pair.a, pair.b, SEEDS);
  console.log(`${pad(pair.name, 44)} размен ${s.ratio.toFixed(2)} (поле удержано ${s.wins}/${SEEDS})`);
}

/** Длительность считается по боям разных составов: зеркала планов и пресетов — бои одной и той же армии, там ничья закономерна. */
const compositionResults = allResults.slice();

console.log('\n=== Планы: одна и та же армия на стандартной раскладке, план против плана ===');
{
  const plans = Object.keys(PLANS) as Plan[];
  const PW = 16;
  console.log(pad('', PW) + plans.map((p) => pad(p, PW)).join(''));
  const undefeated: string[] = [];
  for (const a of plans) {
    let row = pad(a, PW);
    let loses = 0;
    for (const b of plans) {
      if (a === b) {
        row += pad('—', PW);
        continue;
      }
      const s = series(quickSetup(BALANCED_ARMY, { plan: a }), quickSetup(BALANCED_ARMY, { plan: b }), Math.min(SEEDS, 12));
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
  for (const a of QUICK_PRESET_IDS) {
    let row = pad(a, PW);
    for (const b of QUICK_PRESET_IDS) {
      if (a === b) {
        row += pad('—', PW);
        continue;
      }
      const s = series(QUICK_PRESETS[a].layout(stackOf(BALANCED_ARMY)), QUICK_PRESETS[b].layout(stackOf(BALANCED_ARMY)), Math.min(SEEDS, 12));
      row += pad(`${s.wins}/${s.draws}/${s.losses} ${s.ratio.toFixed(2)}`, PW);
    }
    console.log(row);
  }
}

console.log('\n=== Разрыв быстрой атаки: настроенная против быстрой атаки (случайный пресет), 100 боёв ===');
{
  const t = gapAgainst(TUNED, quickOf, 100);
  console.log(`настроенная (${layoutName(TUNED_SPEC)}): разрыв ${(t.gap * 100).toFixed(1)}% (коридор 10–25%, цель 15%), побед ${t.won}/100, поражений ${t.lost}/100`);
  for (const id of QUICK_PRESET_IDS) {
    const g = gapAgainst(TUNED, () => QUICK_PRESETS[id].layout(stackOf(BALANCED_ARMY)), 40);
    console.log(`   против ${pad(id, 13)} ${(g.gap * 100).toFixed(1).padStart(6)}% (побед ${g.won}/40)`);
  }
  const known = gapAgainst(KNOWN_COUNTER, () => QUICK_PRESETS.standard.layout(stackOf(BALANCED_ARMY)), 100);
  const random = gapAgainst(KNOWN_COUNTER, quickOf, 100);
  console.log(`известный контрер стандарта: против стандарта ${(known.gap * 100).toFixed(1)}%, против случайного пресета ${(random.gap * 100).toFixed(1)}% (цель ≈15%)`);
}

console.log('\n=== Длительность и чем кончается бой (матрица составов) ===');
{
  const sorted = compositionResults.map((r) => r.ticks).sort((x, y) => x - y);
  const q = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  console.log(`боёв ${sorted.length}: мин ${sorted[0]}, медиана ${q(0.5)}, 90% ${q(0.9)}, макс ${sorted[sorted.length - 1]} тиков`);
  const early = compositionResults.filter(endedEarly);
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
for (const c of COMPOSITIONS) {
  const bigger = quickSetup(Object.fromEntries(Object.entries(c.army).map(([k, n]) => [k, Math.round((n ?? 0) * 1.1)])));
  let bigLoss = 0;
  let smallLoss = 0;
  let wins = 0;
  const N = 30;
  for (let seed = 1; seed <= N; seed += 1) {
    const bigAttacks = seed % 2 === 1;
    const r = simulateBattle({ seed, attacker: bigAttacks ? bigger : c.setup, defender: bigAttacks ? c.setup : bigger });
    bigLoss += r.sides[bigAttacks ? 'attacker' : 'defender'].total.losses;
    smallLoss += r.sides[bigAttacks ? 'defender' : 'attacker'].total.losses;
    if (r.winner === (bigAttacks ? 'attacker' : 'defender')) wins += 1;
  }
  const cap = hasLine(c.army) ? `потолок ${OVERSIZE_CAP.line}` : `без пешей линии, потолок ${OVERSIZE_CAP.noLine}`;
  console.log(`${pad(c.name, W)} размен ${(smallLoss / Math.max(1, bigLoss)).toFixed(2)} (${cap}), поле удержано ${wins}/${N}`);
}

console.log('\n=== Перебор расстановок: цена расстановки ===');
{
  // Сетка — `layoutGrid` из bench.ts, та же, что держат тесты. Две стадии: грубый отбор
  // против каждого пресета, потом двадцать лучших — на тех же ста боях против быстрой
  // атаки, что и разрыв настроенной армии выше. Раньше на месте этого раздела стояло
  // «потолок ≈25 %» без кода; число отсюда — единственное, на которое можно ссылаться.
  const grid = layoutGrid().map((spec) => ({ spec, setup: layoutOf(BALANCED_ARMY, spec) }));
  const presets = QUICK_PRESET_IDS.map((id) => QUICK_PRESETS[id].layout(stackOf(BALANCED_ARMY)));
  const homogeneousCount = grid.filter((g) => homogeneous(g.setup)).length;
  console.log(
    `расстановок ${grid.length}: линия ${Object.keys(LINE_SHAPES).length} × лучники ${ARCHER_PLACES.length} × конница ${CAVALRY_PLACES.length} × план ${Object.keys(PLANS).length} × резерв ${RESERVE_KINDS.length}; однородных вкладов в один сектор ${homogeneousCount}`,
  );
  const screened = grid.map((g) => {
    let own = 0;
    let theirs = 0;
    let held = 0;
    presets.forEach((foe, i) => {
      for (const attacks of [true, false]) {
        const seed = i * 2 + (attacks ? 1 : 2);
        const r = simulateBattle({ seed, attacker: attacks ? g.setup : foe, defender: attacks ? foe : g.setup });
        const me = attacks ? 'attacker' : 'defender';
        own += r.sides[me].total.losses;
        theirs += r.sides[attacks ? 'defender' : 'attacker'].total.losses;
        if (r.winner === me) held += 1;
      }
    });
    return { ...g, gap: theirs / Math.max(1, own) - 1, held };
  });
  screened.sort((a, b) => b.gap - a.gap);
  const top = screened.slice(0, 20).map((g) => ({ ...g, full: gapAgainst(g.setup, quickOf, 100) }));
  top.sort((a, b) => b.full.gap - a.full.gap);
  console.log('десять лучших против быстрой атаки, 100 боёв (разрыв, побед, поражений):');
  for (const g of top.slice(0, 10)) {
    console.log(`  ${(g.full.gap * 100).toFixed(1).padStart(6)}%  ${pad(g.full.won, 3, true)} ${pad(g.full.lost, 3, true)}  ${homogeneous(g.setup) ? 'однородная ' : 'разложенная'}  ${layoutName(g.spec)}`);
  }
  const best = top[0];
  const tuned = gapAgainst(TUNED, quickOf, 100);
  console.log(`потолок: ${(best.full.gap * 100).toFixed(1)}% — ${layoutName(best.spec)}; настроенная TUNED: ${(tuned.gap * 100).toFixed(1)}%`);

  // Доминирование — не разрыв против шаблонов, а поле против всего остального. Лучшая
  // играет с каждой расстановкой сетки по бою; до правки рукопашной «всё в центр» держала
  // поле 100 % против каждого разложенного семейства и уступала только однородным.
  console.log('лучшая против всей сетки по формам линии (поле, размен):');
  const byLine: Record<string, { held: number; n: number; own: number; theirs: number }> = {};
  grid.forEach((g, i) => {
    if (g.setup === best.setup) return;
    const attacks = i % 2 === 0;
    const r = simulateBattle({ seed: i + 1, attacker: attacks ? best.setup : g.setup, defender: attacks ? g.setup : best.setup });
    const me = attacks ? 'attacker' : 'defender';
    const f = (byLine[g.spec.line] ??= { held: 0, n: 0, own: 0, theirs: 0 });
    f.n += 1;
    if (r.winner === me) f.held += 1;
    f.own += r.sides[me].total.losses;
    f.theirs += r.sides[attacks ? 'defender' : 'attacker'].total.losses;
  });
  const whole = Object.values(byLine).every((f) => f.held === f.n);
  for (const [line, f] of Object.entries(byLine)) {
    console.log(`  против «${line}»: поле ${((100 * f.held) / f.n).toFixed(0)}%, размен ${(f.theirs / Math.max(1, f.own)).toFixed(2)}`);
  }
  console.log(whole ? 'ДОМИНИРУЕТ: держит поле против всей сетки' : 'поле против всей сетки не держит — доминирующей расстановки в сетке нет');

  // Цена расстановки силой: при каком перевесе врага (быстрая атака армии ×k) расстановка
  // удерживает поле в половине боёв. На этой мерке стоит разброс испытательного стенда.
  const point = (setup: (seed: number) => ArmySetup): string => holdPoint(setup, 40).toFixed(3);
  console.log(`точка поля (перевес врага, при котором удержано полполя, 40 боёв): лучшая ×${point(() => best.setup)}, TUNED ×${point(() => TUNED)}, быстрая атака ×${point((seed) => quickOf(seed * 7 + 3))}`);
}

console.log(`\n=== Случайный поиск расстановок: ${SEARCH.n} расстановок наугад (сид ${SEARCH.seed}), отбор против стандартного пресета по ${SEARCH.screen} боёв ===`);
{
  // Сетка видит только свои оси. Поиск — `bench.randomLayout`: лучники во фронте вперемешку
  // с линией, конница неровно по фронту, приказы всем родам. Двенадцать лучших против
  // стандарта перемериваются: против него на 60 боях, против быстрой атаки на 100 и против
  // каждого пресета на 30. Здесь же ищется известный контрер с условиями теста: эталон
  // (`bench.KNOWN_COUNTER`) найден щупом с другим порядком бросков, и строка ниже говорит, повторяет
  // ли его закоммиченный поиск.
  const std = (): ArmySetup => QUICK_PRESETS.standard.layout(stackOf(BALANCED_ARMY));
  const all = searchLayouts(std);
  const found = all.slice(0, 12);
  const same = (a: ArmySetup, b: ArmySetup): boolean => JSON.stringify([a.sectors, a.plan, a.orders, a.reserve]) === JSON.stringify([b.sectors, b.plan, b.orders, b.reserve]);
  const brief = (x: ArmySetup): string => {
    const cell = (id: keyof ArmySetup['sectors']): string => {
      const v = x.sectors[id];
      return (['spear', 'infantry', 'archer', 'cavalry', 'heavy'] as const).filter((k) => v[k] > 0).map((k) => `${k[0]}${v[k]}`).join('') || '—';
    };
    const o = x.orders;
    return `A ${cell('A')} B ${cell('B')} C ${cell('C')} | D ${cell('D')} E ${cell('E')} F ${cell('F')} | R ${cell('R')} | ${x.plan}, копья ${o.spear}, пехота ${o.infantry}, лучники ${o.archer}, конница ${o.cavalry}, резерв ${x.reserve.kind}`;
  };
  const measured = new Map<ArmySetup, { known: number; random: number; per: string[] }>();
  const measure = (x: ArmySetup): { known: number; random: number; per: string[] } => {
    const hit = measured.get(x);
    if (hit) return hit;
    const m = {
      known: gapAgainst(x, std, 60).gap,
      random: gapAgainst(x, quickOf, 100).gap,
      per: QUICK_PRESET_IDS.map((id) => (gapAgainst(x, () => QUICK_PRESETS[id].layout(stackOf(BALANCED_ARMY)), 30).gap * 100).toFixed(0)),
    };
    measured.set(x, m);
    return m;
  };
  const row = (m: ReturnType<typeof measure>, x: ArmySetup, n: number): string =>
    ` ${pad(n, 4, true)}  ${(m.known * 100).toFixed(1).padStart(7)}%  ${(m.random * 100).toFixed(1).padStart(8)}%   ${m.per.map((v) => v.padStart(4)).join(' /')}   ${brief(x)}${same(x, KNOWN_COUNTER) ? '  ← KNOWN_COUNTER' : ''}`;
  console.log(' место  стандарт  случайный  по пресетам: standard / anti-cavalry / center-punch / defense   расстановка');
  found.forEach((f, i) => console.log(row(measure(f.setup), f.setup, i + 1)));
  // Известный контрер — первый по отбору, у кого условия теста (`battle.test.ts`, «известный контрер»):
  // против стандарта больше 40 %, против случайного пресета больше 5 % и не больше 25 % — и меньше
  // половины того, что против стандарта.
  const LIMIT = 200;
  let counter = -1;
  for (let i = 0; i < Math.min(LIMIT, all.length) && counter < 0; i++) {
    const m = measure(all[i].setup);
    if (m.known > 0.4 && m.random > 0.05 && m.random <= 0.25 && m.random < m.known / 2) {
      counter = i;
      if (i >= found.length) console.log(row(m, all[i].setup, i + 1));
    }
  }
  if (counter < 0) console.log(`контрера стандарта с разрывом против случайного пресета в коридоре настроенной армии среди первых ${LIMIT} нет`);
  else {
    const x = all[counter].setup;
    console.log(`контрер стандарта — место ${counter + 1}: первое, где против стандарта больше 40%, против случайного пресета от 5% до 25% и меньше половины того; ${same(x, KNOWN_COUNTER) ? 'это и есть KNOWN_COUNTER' : 'KNOWN_COUNTER С НИМ НЕ СОВПАЛ'}`);
    console.log(`  ${JSON.stringify({ sectors: x.sectors, plan: x.plan, orders: x.orders, reserve: x.reserve })}`);
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
