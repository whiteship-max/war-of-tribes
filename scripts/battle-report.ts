// Балансные прогоны боя: таблица «кто кому проигрывает», кольцо контрров,
// разрыв быстрой атаки и длительность. Запуск: npm run battle:report.
// Те же числа держат тесты в src/battle/battle.test.ts; здесь они видны глазами.
import { simulateBattle, quickSetup, quickAttack, describeEvent, PHASE_TICKS, PLANS, QUICK_PRESETS, QUICK_PRESET_IDS, stackOf, type ArmySetup, type BattleResult, type Plan, type Stack } from '../src/battle';
import { BALANCED_ARMY, COMPOSITIONS, KNOWN_COUNTER, OVERSIZE_CAP, RATIO_EVEN, RING, TUNED, gapAgainst, hasLine, lossRatio, mirrored, quickOf } from '../src/battle/bench';

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
  console.log(`настроенная: разрыв ${(t.gap * 100).toFixed(1)}% (коридор 10–25%, цель 15%), побед ${t.won}/100, поражений ${t.lost}/100`);
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

if (process.env.SHOW) {
  const [an, bn] = process.env.SHOW.split(':');
  const scale = Number(process.env.SCALE ?? 1);
  const ca = COMPOSITIONS.find((c) => c.name === an);
  const seed = Number(process.env.SEED ?? 1);
  const a = ca ? quickSetup(Object.fromEntries(Object.entries(ca.army).map(([k, n]) => [k, Math.round((n ?? 0) * scale)]))) : TUNED;
  const b = COMPOSITIONS.find((c) => c.name === bn)?.setup ?? quickOf(seed);
  const r: BattleResult = simulateBattle({ seed, attacker: a, defender: b });
  const line = (s: Stack): string => `копья ${s.spear} пехота ${s.infantry} лучники ${s.archer} конница ${s.cavalry}`;
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
