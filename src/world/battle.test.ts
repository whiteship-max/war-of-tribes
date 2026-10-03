// Совместный удар (docs/battle_tw.md, раздел 13; решение владельца 03.10.2026, вариант А): мир отдаёт ядру, какая часть
// нападающего — гарнизон, вышедший из ворот (`FieldSide.garrison`), и ядро раскладывает её по секторам в итог — для ролика,
// который выводит гарнизон из ворот, а дружину с поля. Это наблюдение, а не вход боя: исход до бита тот же.
import { describe, expect, it } from 'vitest';
import { SECTORS, UNIT_KINDS, stackOf, stackTotal, type BattleResult, type Stack } from '@/battle';
import { compositionLattice, compositionName, scaleArmy } from '@/battle/bench';
import { resolveField, type FieldInput } from './battle';

/** Итог боя без поля «кто из ворот»: то, что осталось бы, не будь наблюдения. */
const strip = (r: BattleResult): string =>
  JSON.stringify({
    ...r,
    sides: Object.fromEntries(
      Object.entries(r.sides).map(([side, res]) => [
        side,
        { ...res, sectors: Object.fromEntries(Object.entries(res.sectors).map(([id, { garrison: _g, ...cell }]) => [id, cell])) },
      ]),
    ),
  });

const plus = (a: Partial<Stack>, b: Partial<Stack>): Stack => {
  const out = stackOf(a);
  for (const k of UNIT_KINDS) out[k] += b[k] ?? 0;
  return out;
};

describe('совместный удар: кто из ворот', () => {
  it('происхождение бойцов не меняет исход: набор совместных ударов совпадает до бита', () => {
    // Набор — совместные удары, собранные так, как их собирает мир (`LocalWorld.campBattle`): нападающий — дружина из поля
    // и гарнизон из ворот одной стороной, `garrison` — гарнизон по родам; против — лагерь. Составы всех троих — из решётки
    // составов (`bench.compositionLattice`, 70 составов), разведённые шагами, разных размеров; место боя и мораль между
    // боями — через раз, по два сида. Граница области — бой, где гарнизон есть у нападающего и ему есть куда встать: у каждой
    // точки гарнизон и дружина непусты и бой посчитан (счётчики ниже).
    const armies = compositionLattice();
    let compared = 0;
    let mixed = 0;
    for (let i = 0; i < armies.length; i++) {
      const druzhina = scaleArmy(armies[i], 180 + (i % 5) * 60);
      const garrison = scaleArmy(armies[(i * 11 + 2) % armies.length], 120 + (i % 3) * 90);
      const camp = scaleArmy(armies[(i * 7 + 3) % armies.length], 360 + (i % 4) * 80);
      expect(stackTotal(stackOf(druzhina)), 'дружина есть').toBeGreaterThan(0);
      expect(stackTotal(stackOf(garrison)), 'гарнизон есть').toBeGreaterThan(0);
      for (const seed of [31, 32]) {
        const input: FieldInput = {
          seed: seed * 1000 + i,
          ground: i % 2 === 0 ? { land: 1 } : undefined,
          attacker: { kinds: plus(druzhina, garrison), resolve: 4, pips: { shock: 1 }, rest: i % 3 === 0 ? 0.8 : undefined },
          defender: { kinds: stackOf(camp), resolve: 0 },
        };
        const label = `${compositionName(druzhina)} + гарнизон ${compositionName(garrison)} против ${compositionName(camp)}, сид ${input.seed}`;
        const blind = resolveField(input);
        const seen = resolveField({ ...input, attacker: { ...input.attacker, garrison } });
        expect(seen.result && blind.result, label).toBeTruthy();
        // Исход до бита: тот же итог боя, кроме самого поля, и те же доли, победитель и мораль после боя у мира.
        expect(strip(seen.result!), label).toBe(JSON.stringify(blind.result));
        expect({ ...seen, result: null }, label).toEqual({ ...blind, result: null });
        // Поле есть и честное: у нападающего в каждом секторе, гарнизон — не больше, чем там стоит, и весь гарнизон
        // разложен; у обороны поля нет — из ворот вышли только наши.
        const att = seen.result!.sides.attacker;
        for (const id of SECTORS) {
          const g = att.sectors[id].garrison;
          expect(g, `${label}: сектор ${id}`).toBeDefined();
          for (const k of UNIT_KINDS) expect(g![k], `${label}: ${id} ${k}`).toBeLessThanOrEqual(att.sectors[id].initial[k]);
          expect(seen.result!.sides.defender.sectors[id].garrison, `${label}: у обороны`).toBeUndefined();
          expect(blind.result!.sides.attacker.sectors[id].garrison, `${label}: без гарнизона на входе`).toBeUndefined();
        }
        for (const k of UNIT_KINDS) {
          const laid = SECTORS.reduce((n, id) => n + att.sectors[id].garrison![k], 0);
          expect(laid, `${label}: ${k} разложен весь`).toBe(garrison[k] ?? 0);
        }
        // Сектор, где стоят и гарнизон, и дружина, — то, ради чего поле: ролик делит отряд надвое.
        if (SECTORS.some((id) => stackTotal(att.sectors[id].garrison!) > 0 && stackTotal(att.sectors[id].garrison!) < stackTotal(att.sectors[id].initial))) mixed++;
        compared++;
      }
    }
    expect(compared).toBe(2 * armies.length);
    expect(mixed, 'боёв, где отряд — и гарнизон, и дружина').toBeGreaterThan(compared / 2);
  }, 120_000);
});
