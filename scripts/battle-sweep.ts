// Перебор параметров боя: одна строка на набор чисел — доля досрочных завершений,
// размен при перевесе 10%, кольцо и кто никому не проигрывает. Разрыва быстрой атаки
// больше нет: быстрой атаки нет, все встают по правилу развёртывания (docs/battle_eu4.md, 14.5).
// Числа подставляются поверх конфига в порядке перечисления (накопительно):
//   GRID='[{},{"MORALE.perLoss":300},{"UNIT.spear":{...}}]' npm run battle:sweep
// Это быстрый прицел; итог всегда сверять полным отчётом и тестами.
import { simulateBattle, deploySetup, MORALE, RETREAT, TEMPER, UNIT_STATS, COUNTER } from '../src/battle';
import { COMPOSITIONS, RING, mirrored } from '../src/battle/bench';
import type { BattleResult } from '../src/battle';

/** Гонг — потолок кругов сечи (`roundsCap`): бой дошёл до него, не сломав никого. */
const atGong = (r: BattleResult): boolean => r.log.some((e) => e.id === 'rounds-out');
const scale = (army: Partial<Record<string, number>>, k: number): Record<string, number> =>
  Object.fromEntries(Object.entries(army).map(([kind, n]) => [kind, Math.round((n ?? 0) * k)]));

function measure(): string {
  let early = 0;
  let total = 0;
  let draws = 0;
  const S = 8;
  for (let i = 0; i < COMPOSITIONS.length; i += 1)
    for (let j = 0; j < COMPOSITIONS.length; j += 1) {
      if (i === j) continue;
      for (let seed = 1; seed <= S; seed += 1) {
        const r = simulateBattle({ seed, attacker: COMPOSITIONS[i].setup, defender: COMPOSITIONS[j].setup });
        total += 1;
        if (!atGong(r)) early += 1;
        if (r.winner === 'draw') draws += 1;
      }
    }
  const ratios: number[] = [];
  let mirrorEarly = 0;
  let mirrorTotal = 0;
  for (const c of COMPOSITIONS) {
    const big = deploySetup(scale(c.army, 1.1) as never);
    let bigLoss = 0;
    let smallLoss = 0;
    for (let seed = 1; seed <= 16; seed += 1) {
      const bigAttacks = seed % 2 === 1;
      const r = simulateBattle({ seed, attacker: bigAttacks ? big : c.setup, defender: bigAttacks ? c.setup : big });
      bigLoss += r.sides[bigAttacks ? 'attacker' : 'defender'].total.losses;
      smallLoss += r.sides[bigAttacks ? 'defender' : 'attacker'].total.losses;
      mirrorTotal += 1;
      if (!atGong(r)) mirrorEarly += 1;
    }
    ratios.push(smallLoss / Math.max(1, bigLoss));
  }
  const ring = RING.map((p) => {
    let w = 0;
    for (let seed = 1; seed <= 6; seed += 1) if (mirrored(p.a, p.b, seed).winner === 'a') w += 1;
    return w;
  });
  const undefeated: string[] = [];
  for (const a of COMPOSITIONS) {
    let loses = 0;
    for (const b of COMPOSITIONS) {
      if (a === b) continue;
      let w = 0; let l = 0;
      for (let seed = 1; seed <= 4; seed += 1) { const m = mirrored(a.setup, b.setup, seed); if (m.winner === 'a') w += 1; else if (m.winner === 'b') l += 1; }
      if (l > w) loses += 1;
    }
    if (loses === 0) undefeated.push(a.name);
  }
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  return `досрочно ${(100 * early / total).toFixed(0)}% (ничьих ${(100 * draws / total).toFixed(0)}%, зеркало 10%: ${(100 * mirrorEarly / mirrorTotal).toFixed(0)}%) | размен 10%: сред ${mean.toFixed(2)} макс ${Math.max(...ratios).toFixed(2)} [${ratios.map((r) => r.toFixed(2)).join(' ')}] | кольцо ${ring.join('/')} | непобедимые: ${undefeated.join(',') || 'нет'}`;
}

const grid = JSON.parse(process.env.GRID ?? '[{}]') as Array<Record<string, number>>;
for (const g of grid) {
  for (const [k, v] of Object.entries(g)) {
    const [obj, key] = k.split('.');
    const target = obj === 'MORALE' ? MORALE : obj === 'RETREAT' ? RETREAT : obj === 'UNIT' ? UNIT_STATS : obj === 'COUNTER' ? COUNTER : TEMPER;
    (target as Record<string, unknown>)[key] = v;
  }
  console.log(JSON.stringify(g).padEnd(60), measure());
}
