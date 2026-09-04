// Балансные прогоны боя: таблица «кто кому проигрывает», кольцо контрров,
// разрыв быстрой атаки и длительность. Запуск: npm run battle:report.
// Те же числа держат тесты в src/battle/battle.test.ts; здесь они видны глазами.
import { simulateBattle, quickSetup, describeEvent, type ArmySetup, type BattleResult, type Stack } from '../src/battle';
import { COMPOSITIONS, TUNED_VS_QUICK, RING, lossRatio, mirrored } from '../src/battle/bench';

const SEEDS = Number(process.env.SEEDS ?? 40);

function pad(s: string | number, w: number, right = false): string {
  const t = String(s);
  return right ? t.padStart(w) : t.padEnd(w);
}

/** Победы первой стороны в серии боёв с обеих сторон поля. */
function series(a: ArmySetup, b: ArmySetup, seeds: number): { wins: number; losses: number; draws: number; ratio: number; ticks: number[] } {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let ratio = 0;
  const ticks: number[] = [];
  for (let seed = 1; seed <= seeds; seed += 1) {
    const r = mirrored(a, b, seed);
    if (r.winner === 'a') wins += 1;
    else if (r.winner === 'b') losses += 1;
    else draws += 1;
    ratio += r.lossRatio;
    ticks.push(r.ticks);
  }
  return { wins, losses, draws, ratio: ratio / seeds, ticks };
}

console.log(`\n=== Составы (${COMPOSITIONS.length}) по ${SEEDS} боёв на пару, каждая пара с обеих сторон поля ===`);
const names = COMPOSITIONS.map((c) => c.name);
const W = 12;
console.log(pad('', W) + names.map((n) => pad(n, W)).join(''));
const beats: Record<string, string[]> = {};
const losesTo: Record<string, string[]> = {};
const allTicks: number[] = [];
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
    allTicks.push(...s.ticks);
    const share = s.wins / (s.wins + s.losses + s.draws);
    if (s.wins > s.losses) beats[a.name].push(b.name);
    else if (s.losses > s.wins) losesTo[a.name].push(b.name);
    row += pad(`${Math.round(share * 100)}% ${s.ratio.toFixed(2)}`, W);
  }
  console.log(row);
}
console.log('\nячейка: доля побед состава из строки и его соотношение потерь (чужие/свои)');
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

console.log('\n=== Длительность ===');
{
  const sorted = [...allTicks].sort((x, y) => x - y);
  const q = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  console.log(`боёв ${sorted.length}: мин ${sorted[0]}, медиана ${q(0.5)}, 90% ${q(0.9)}, макс ${sorted[sorted.length - 1]} тиков`);
}

if (process.env.SHOW) {
  const [an, bn] = process.env.SHOW.split(':');
  const a = COMPOSITIONS.find((c) => c.name === an)?.setup ?? TUNED_VS_QUICK.tuned;
  const b = COMPOSITIONS.find((c) => c.name === bn)?.setup ?? TUNED_VS_QUICK.quick;
  const r: BattleResult = simulateBattle({ seed: Number(process.env.SEED ?? 1), attacker: a, defender: b });
  const line = (s: Stack): string => `копья ${s.spear} пехота ${s.infantry} лучники ${s.archer} конница ${s.cavalry}`;
  console.log(`\n=== ${an} против ${bn}: ${r.winner} (${r.reason}), ${r.ticks} тиков, потери чужие/свои ${lossRatio(r, 'attacker').toFixed(2)} ===`);
  console.log(`нападающие ${r.sides.attacker.total.initial} → ${r.sides.attacker.total.final} (${line(r.sides.attacker.losses)}), мораль ${r.sides.attacker.morale}`);
  console.log(`обороняющиеся ${r.sides.defender.total.initial} → ${r.sides.defender.total.final} (${line(r.sides.defender.losses)}), мораль ${r.sides.defender.morale}`);
  for (const e of r.log) console.log(`${String(e.tick).padStart(3)} ${describeEvent(e)}`);
}

void quickSetup;
