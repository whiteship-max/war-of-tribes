// Балансные прогоны боя: таблица «кто кому проигрывает», кольцо контрров,
// разрыв быстрой атаки и длительность. Запуск: npm run battle:report.
// Те же числа держат тесты в src/battle/battle.test.ts; здесь они видны глазами.
import { COUNTER, COVER, TEMPER, UNIT_KINDS, UNIT_STATS, armyTotal, simulateBattle, quickSetup, quickAttack, describeEvent, PHASE_TICKS, PLANS, QUICK_PRESETS, QUICK_PRESET_IDS, stackOf, type ArmySetup, type BattleResult, type Plan, type Stack } from '../src/battle';
import { stackPower } from '../src/battle/sim';
import { mirrorOf, type Mirrored } from '../src/battle/bench';
import { ARCHER_PLACES, ARMY_SIZE, BALANCED_ARMY, CAVALRY_PLACES, COMPOSITIONS, COVER_K_GRID, LATTICE_STEP, SCREEN_KINDS, latticeWorth, nonDecreasing, screenArmy, screenCurve, screenPoints, withCoverK, answerlessOwnKind, compositionLattice, compositionName, latticeDuels, COUNTER_TERMS, KNOWN_COUNTER, standardOf, counterSearch, searchFinal, LINE_SHAPES, OVERSIZE_CAP, RATIO_EVEN, RESERVE_KINDS, RING, SEARCH, TUNED, TUNED_SPEC, gapAgainst, hasLine, holdPoint, homogeneous, layoutGrid, layoutName, layoutOf, lossRatio, mirrored, quickOf } from '../src/battle/bench';

const SEEDS = Number(process.env.SEEDS ?? 40);

/** Бой кончился раньше потолка: сторона отступила, а не дождалась гонга. */
const fullLength = (r: BattleResult): number => r.phases.find((p) => p.phase === 'ranged')!.to + (Object.keys(PHASE_TICKS) as Array<keyof typeof PHASE_TICKS>).filter((p) => p !== 'ranged').reduce((n, p) => n + PHASE_TICKS[p], 0);
const endedEarly = (r: BattleResult): boolean => r.ticks < fullLength(r);
const allResults: BattleResult[] = [];

function pad(s: string | number, w: number, right = false): string {
  const t = String(s);
  return right ? t.padStart(w) : t.padEnd(w);
}

/** Зеркальные пары сидов 1..seeds. */
const pairsOf = (a: ArmySetup, b: ArmySetup, seeds: number): Mirrored[] => Array.from({ length: seeds }, (_, i) => mirrored(a, b, i + 1));

/**
 * Пары матрицы «каждый против каждого»: пара i–j играется один раз, а строка j–i читает те же
 * два боя с другой стороны (`mirrorOf` в обратном порядке) — это не второй бой, а тот же.
 */
function matrixPairs(setups: readonly ArmySetup[], seeds: number): (i: number, j: number) => Mirrored[] {
  const played = new Map<number, Mirrored[]>();
  const at = (i: number, j: number): Mirrored[] => {
    if (i > j) return at(j, i).map((m) => mirrorOf(m.results[1], m.results[0]));
    const key = i * setups.length + j;
    let ms = played.get(key);
    if (!ms) played.set(key, (ms = pairsOf(setups[i], setups[j], seeds)));
    return ms;
  };
  return at;
}

/**
 * Серия зеркальных боёв. `wins/draws/losses` — кто удержал поле (результат),
 * `ratio` — средний размен (цена), `pyrrhic` — сколько боёв из 2×seeds выиграны
 * с непомерными потерями. Выводы «кто кому проигрывает» делаются по размену.
 *
 * Бои серии ложатся в `allResults`; у матрицы — с обеих строк пары, то есть каждый бой дважды.
 * Так было, пока матрица играла пару дважды, и так осталось: раздел «Длительность» считает по
 * ним, и вывод отчёта не должен сдвинуться от того, что бой больше не играется второй раз.
 */
function series(ms: readonly Mirrored[]): { wins: number; losses: number; draws: number; ratio: number; pyrrhic: number } {
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
    allResults.push(...r.results);
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
const compositionPairs = matrixPairs(COMPOSITIONS.map((c) => c.setup), SEEDS);
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
    const s = series(compositionPairs(ai, bi));
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
// Та же решётка, что держит тест «нет доминирующего состава» (`bench.latticeDuels`), стандартный
// пресет. Её же строкой «как есть» читает раздел «Тяжёлая»: числа там те же, и второй раз она не играется.
const latticeRows = latticeDuels(compositionLattice());
{
  // Утверждение теста — «каждый кому-то проигрывает» — видит только строгое превосходство;
  // строка «ответа без своего рода нет» видит обязательный род: всё, что бьёт состав, построено
  // на его же главном роде.
  const rows = latticeRows;
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
  const pure = UNIT_KINDS.map((k) => ({ k, setup: quickSetup({ [k]: ARMY_SIZE }) }));
  const pureDuels = matrixPairs(pure.map((p) => p.setup), 6);
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
  console.log(`род против рода, ${ARMY_SIZE} на ${ARMY_SIZE}, быстрая атака, 6 сидов × обе стороны (размен строки): ${pure.map((p) => pad(p.k, 9, true)).join('')}`);
  for (const [ai, a] of pure.entries()) console.log(`  ${pad(a.k, 9)}${pure.map((b, bi) => pad(a === b ? '—' : duel(ai, bi).toFixed(2), 9, true)).join('')}`);

  const H = UNIT_STATS.heavy;
  const HC = COUNTER.heavy as { infantry: number };
  const HT = TEMPER.heavy;
  const heavyFront = (army: Partial<Stack>): ArmySetup => {
    const s = quickSetup(army);
    const r = s.sectors.R.heavy;
    if (r > 0) {
      s.sectors.R.heavy = 0;
      const l = Math.floor(r * 0.3);
      const c = Math.floor(r * 0.3);
      s.sectors.A.heavy += l;
      s.sectors.B.heavy += r - l - c;
      s.sectors.C.heavy += c;
    }
    return s;
  };
  // Резерв по той же мерке, что заслон: пресет держит в резерве не больше, чем прикрывает линия
  // (`линия / COVER.K` силы, `stackPower`), остальное — во фронт. Это не правило боя, а расстановка
  // перед ним: в бою резерв по-прежнему недосягаем, пока не введён, сколько бы его ни было.
  const reserveCovered = (army: Partial<Stack>): ArmySetup => {
    const s = quickSetup(army);
    const line = stackPower(armyTotal({ ...s, sectors: { ...s.sectors, R: stackOf({}) } }));
    const held = stackPower(s.sectors.R);
    if (held <= 0 || held <= line / COVER.K) return s;
    const share = 1 - line / COVER.K / held;
    for (const k of UNIT_KINDS) {
      const out = Math.round(s.sectors.R[k] * share);
      if (out <= 0) continue;
      s.sectors.R[k] -= out;
      const l = Math.floor(out * 0.3);
      const c = Math.floor(out * 0.3);
      s.sectors.A[k] += l;
      s.sectors.B[k] += out - l - c;
      s.sectors.C[k] += c;
    }
    return s;
  };
  // «Как есть» — решётка раздела выше: те же числа, та же раскладка, те же бои.
  const variants: Array<{ name: string; set: () => () => void; layout?: (a: Partial<Stack>) => ArmySetup; rows?: typeof latticeRows }> = [
    { name: 'как есть', set: () => () => {}, rows: latticeRows },
    { name: 'рукопашная 1.3 → 1.0 (лёгкая)', set: () => ((H.melee = 1.0), () => (H.melee = 1.3)) },
    { name: 'по пехоте ×1.3 → ×1.0 (лёгкая)', set: () => ((HC.infantry = 1.0), () => (HC.infantry = 1.3)) },
    { name: 'рукопашная и по пехоте → 1.0', set: () => ((H.melee = 1.0), (HC.infantry = 1.0), () => ((H.melee = 1.3), (HC.infantry = 1.3))) },
    { name: 'мораль 65 → 56 (пехота)', set: () => ((H.morale = 56), () => (H.morale = 65)) },
    { name: 'стойкость 1.1 → 0.8 (лёгкая)', set: () => ((H.toughness = 0.8), () => (H.toughness = 1.1)) },
    { name: 'остановленная 1.0 → 1.3 (лёгкая)', set: () => ((HT.stalled = 1.3), () => (HT.stalled = 1.0)) },
    { name: 'на разгоне 0.6 → 1.0 (пехота)', set: () => ((HT.charging = 1.0), () => (HT.charging = 0.6)) },
    { name: 'скорость 2 → 1 (копья)', set: () => ((H.speed = 1), () => (H.speed = 2)) },
    { name: 'числа те же, пресет ставит её во фронт', set: () => () => {}, layout: heavyFront },
    { name: 'числа те же, резерв не больше прикрытого', set: () => () => {}, layout: reserveCovered },
    { name: 'рукопашная 1.0 и резерв не больше прикрытого', set: () => ((H.melee = 1.0), () => (H.melee = 1.3)), layout: reserveCovered },
  ];
  const lattice = compositionLattice();
  const iOf = (army: Partial<Stack>): number => lattice.findIndex((a) => UNIT_KINDS.every((k) => (a[k] ?? 0) === (army[k] ?? 0)));
  const watched = [{ infantry: 150, heavy: 450 }, { heavy: 600 }, { infantry: 300, heavy: 300 }].map(iOf);
  console.log('что меняется (решётка целиком на каждую строку): лучший состав и сколько бьёт; с тяжёлой в первой десятке; ответа без своего рода нет у; ' + watched.map((i) => compositionName(lattice[i])).join(' / '));
  for (const v of variants) {
    const undo = v.set();
    try {
      const rows = v.rows ?? latticeDuels(lattice, v.layout);
      const n = rows.length;
      const pct = (i: number): string => `${Math.round((100 * rows[i].beats.length) / (n - 1))}%`;
      const order = [...rows.keys()].sort((a, b) => rows[b].beats.length - rows[a].beats.length);
      const top10 = order.slice(0, 10).filter((i) => (rows[i].army.heavy ?? 0) > 0).length;
      const answerless = order.filter((i) => answerlessOwnKind(rows, i));
      console.log(`  ${pad(v.name, 40)} ${pad(compositionName(rows[order[0]].army), 50)} ${pad(pct(order[0]), 4, true)}  ${pad(top10, 2, true)}/10  ${pad(answerless.length, 2, true)}  ${watched.map((i) => pad(pct(i), 4, true)).join(' /')}`);
    } finally {
      undo();
    }
  }
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
  const s = series(pairsOf(pair.a, pair.b, SEEDS));
  console.log(`${pad(pair.name, 44)} размен ${s.ratio.toFixed(2)} (поле удержано ${s.wins}/${SEEDS})`);
}

/** Длительность считается по боям разных составов: зеркала планов и пресетов — бои одной и той же армии, там ничья закономерна. */
const compositionResults = allResults.slice();

console.log('\n=== Планы: одна и та же армия на стандартной раскладке, план против плана ===');
{
  const plans = Object.keys(PLANS) as Plan[];
  const planPairs = matrixPairs(plans.map((p) => quickSetup(BALANCED_ARMY, { plan: p })), Math.min(SEEDS, 12));
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
  const presetPairs = matrixPairs(QUICK_PRESET_IDS.map((id) => QUICK_PRESETS[id].layout(stackOf(BALANCED_ARMY))), Math.min(SEEDS, 12));
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
  const t = gapAgainst(TUNED, quickOf, 100);
  console.log(`настроенная (${layoutName(TUNED_SPEC)}): разрыв ${(t.gap * 100).toFixed(1)}% (коридор 10–25%, цель 15%), побед ${t.won}/100, поражений ${t.lost}/100`);
  for (const id of QUICK_PRESET_IDS) {
    const g = gapAgainst(TUNED, () => QUICK_PRESETS[id].layout(stackOf(BALANCED_ARMY)), 40);
    console.log(`   против ${pad(id, 13)} ${(g.gap * 100).toFixed(1).padStart(6)}% (побед ${g.won}/40)`);
  }
  const known = gapAgainst(KNOWN_COUNTER, standardOf, 100);
  const random = gapAgainst(KNOWN_COUNTER, quickOf, 100);
  console.log(`известный контрер стандарта (KNOWN_COUNTER, пример щупа): против стандарта ${(known.gap * 100).toFixed(1)}%, против случайного пресета ${(random.gap * 100).toFixed(1)}% (цель ≈15%)`);
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
  const ceiling = searchFinal(quickOf);
  for (const f of ceiling) console.log(` ${pad(f.index, 4, true)} ${pc(f.screen)} ${pc(f.final.gap)}  ${pad(f.final.won, 4, true)} ${pad(f.final.lost, 5, true)}   ${brief(f.setup)}`);
  const tuned = gapAgainst(TUNED, quickOf, SEARCH.final, SEARCH.finalFrom);
  const bestScreen = [...ceiling].sort((x, y) => y.screen - x.screen)[0];
  console.log(`потолок: ${pc(ceiling[0].final.gap).trim()} (№ ${ceiling[0].index}); лучший на отборе (№ ${bestScreen.index}) ${pc(bestScreen.screen).trim()} → на перемере ${pc(bestScreen.final.gap).trim()}; TUNED на тех же сидах ${pc(tuned.gap).trim()}`);

  console.log('\nконтрер стандартного пресета: отбор и перемер против стандарта, против случайного пресета — те же новые сиды;');
  console.log(`условия (bench.counterHolds): против стандарта больше ${COUNTER_TERMS.known * 100}%, против случайного от ${COUNTER_TERMS.randomLow * 100}% до ${COUNTER_TERMS.randomHigh * 100}% и меньше половины первого`);
  console.log('   №  отбор  стандарт  случайный  случ/станд  условия   расстановка');
  const counters = counterSearch();
  for (const f of counters) console.log(` ${pad(f.index, 4, true)} ${pc(f.screen)} ${pc(f.final.gap)}  ${pc(f.random)}   ${(f.random / f.final.gap).toFixed(2).padStart(9)}   ${f.holds ? 'да ' : 'нет'}      ${brief(f.setup)}`);
  const first = counters.find((f) => f.holds);
  if (first) console.log(`контрер стандарта по условиям теста — № ${first.index} поиска: первый по перемеру, кто их выполняет`);
  else {
    console.log(`контрера стандарта по условиям теста среди ${counters.length} финалистов нет; KNOWN_COUNTER теста — пример щупа, этим поиском не выводится`);
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
