// Балансные прогоны боя: таблица «кто кому проигрывает», кольцо контрров,
// разрыв быстрой атаки и длительность. Запуск: npm run battle:report.
// Те же числа держат тесты в src/battle/battle.test.ts; здесь они видны глазами.
import { simulateBattle, quickSetup, describeEvent, PHASE_TICKS, type ArmySetup, type BattleResult, type Stack } from '../src/battle';
import { COMPOSITIONS, TUNED_VS_QUICK, RING, lossRatio, mirrored } from '../src/battle/bench';

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
function series(a: ArmySetup, b: ArmySetup, seeds: number): { wins: number; losses: number; draws: number; ratio: number } {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let ratio = 0;
  for (let seed = 1; seed <= seeds; seed += 1) {
    const r = mirrored(a, b, seed);
    if (r.winner === 'a') wins += 1;
    else if (r.winner === 'b') losses += 1;
    else draws += 1;
    ratio += r.lossRatio;
    allResults.push(...r.results);
  }
  return { wins, losses, draws, ratio: ratio / seeds };
}

console.log(`\n=== Составы (${COMPOSITIONS.length}) по ${SEEDS} боёв на пару, каждая пара с обеих сторон поля ===`);
const names = COMPOSITIONS.map((c) => c.name);
const W = 14;
console.log(pad('', W) + names.map((n) => pad(n, W)).join(''));
const beats: Record<string, string[]> = {};
const losesTo: Record<string, string[]> = {};
for (const a of COMPOSITIONS) {
  beats[a.name] = [];
  losesTo[a.name] = [];
  let row = pad(a.name, W);
  for (const b of COMPOSITIONS) {
    if (a === b) {
      row += pad('—', W);
      continue;
    }
    const s = series(a.setup, b.setup, SEEDS);
    if (s.wins > s.losses) beats[a.name].push(b.name);
    else if (s.losses > s.wins) losesTo[a.name].push(b.name);
    row += pad(`${s.wins}/${s.draws}/${s.losses} ${s.ratio.toFixed(2)}`, W);
  }
  console.log(row);
}
console.log('\nячейка: победы/ничьи/поражения состава из строки и его соотношение потерь (чужие/свои)');
for (const c of COMPOSITIONS) {
  console.log(`${pad(c.name, W)} проигрывает: ${losesTo[c.name].join(', ') || '— НИКОМУ'}`);
}

console.log('\n=== Кольцо контрров при правильных приказах ===');
for (const pair of RING) {
  const s = series(pair.a, pair.b, SEEDS);
  console.log(`${pad(pair.name, 44)} побед ${s.wins}/${SEEDS}, потери чужие/свои ${s.ratio.toFixed(2)}`);
}

console.log('\n=== Разрыв быстрой атаки: настроенная против шаблона, 100 боёв ===');
{
  let quickLoss = 0;
  let tunedLoss = 0;
  let tunedWins = 0;
  for (let seed = 1; seed <= 100; seed += 1) {
    const tunedAttacks = seed % 2 === 1;
    const r = simulateBattle({
      seed,
      attacker: tunedAttacks ? TUNED_VS_QUICK.tuned : TUNED_VS_QUICK.quick,
      defender: tunedAttacks ? TUNED_VS_QUICK.quick : TUNED_VS_QUICK.tuned,
    });
    const tunedSide = tunedAttacks ? 'attacker' : 'defender';
    const quickSide = tunedAttacks ? 'defender' : 'attacker';
    tunedLoss += r.sides[tunedSide].total.losses;
    quickLoss += r.sides[quickSide].total.losses;
    if (r.winner === tunedSide) tunedWins += 1;
  }
  console.log(`потери шаблона ${quickLoss}, настроенной ${tunedLoss}: разрыв ${((quickLoss / tunedLoss - 1) * 100).toFixed(1)}% (коридор 10–25%, цель 15%), побед настроенной ${tunedWins}/100`);
}

console.log('\n=== Длительность и чем кончается бой ===');
{
  const sorted = allResults.map((r) => r.ticks).sort((x, y) => x - y);
  const q = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  console.log(`боёв ${sorted.length}: мин ${sorted[0]}, медиана ${q(0.5)}, 90% ${q(0.9)}, макс ${sorted[sorted.length - 1]} тиков`);
  const early = allResults.filter(endedEarly);
  const reasons: Record<string, number> = {};
  for (const r of allResults) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
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
  const line = !(c.army.infantry ?? 0) && !(c.army.spear ?? 0) ? ' (без пешей линии — вне теста)' : '';
  console.log(`${pad(c.name, W)} размен ${(smallLoss / Math.max(1, bigLoss)).toFixed(2)}, побед ${wins}/${N}${line}`);
}

if (process.env.SHOW) {
  const [an, bn] = process.env.SHOW.split(':');
  const scale = Number(process.env.SCALE ?? 1);
  const ca = COMPOSITIONS.find((c) => c.name === an);
  const a = ca ? quickSetup(Object.fromEntries(Object.entries(ca.army).map(([k, n]) => [k, Math.round((n ?? 0) * scale)]))) : TUNED_VS_QUICK.tuned;
  const b = COMPOSITIONS.find((c) => c.name === bn)?.setup ?? TUNED_VS_QUICK.quick;
  const r: BattleResult = simulateBattle({ seed: Number(process.env.SEED ?? 1), attacker: a, defender: b });
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
