// Монотонность у ворот (слово владельца по П0 пересмотра баланса, docs/battle_eu4.md, 14.35): больше волков против того
// же гарнизона без кости берут верх не реже. `raid-mix:report`, раздел 4б, нашёл обратное с костью — на 1–3-м уровнях
// доля поражений пересекает половину по силе стаи много раз; без кости это видно боем на каждую голову стаи.
//
// КРАСНЫЙ при записи, честно (29.09.2026): 77 сбоев на 1-м уровне, 69 на 2-м, 16 на 3-м — все при нечётной стае
// (`raid-mix:report`, 4б). Нечётный волк встаёт из резерва в центр, его выбивают, и центр гарнизона, «очищенный в бою»,
// уходит в обход на волков (`sim.relocate`; docs/battle_eu4.md, 14.35). Чинит правило охвата без истории — следующий шаг
// этой работы (слово владельца, 14.35, пункт 1).
//
// Гарнизон — мерка автопилота отчётов (`townAt`, войско `armyAt`), всё дома, без веры: так строит таблицу силы у ворот
// сам отчёт. Бой — дверью мира, как в игре: кто пришёл (`gateParty`, мощь — две на волка, `menOfPower`) и бой у своих
// ворот (`gateField`).
import { describe, expect, it } from 'vitest';
import { withDiceStep } from '@/battle/bench';
import { defense } from '@/game/derived';
import { BATTLE_MAN } from '@/game/battle/kinds';
import { menOfPower } from './garrison';
import type { GateCall } from './types';
import { openSky, townAt, type Inside } from '../../scripts/autopilot';

/** Кривая — до трёх оборон посёлка, как кривая раздела 4б `raid-mix:report`. */
const TOP_DEFENSE = 3;

describe('монотонность у ворот: больше волков против того же гарнизона — не реже их верх', () => {
  it.each([1, 2, 3])('без кости: гарнизон мерки %i-го уровня, стая от одного волка до трёх оборон', async (level) => {
    const g = townAt(level);
    g.faith.id = null;
    const sky = openSky(g, { seed: 7, pulse: 30, raids: true });
    await sky.pulse();
    const w: Inside = sky.world;
    const at = sky.now();
    const top = menOfPower(TOP_DEFENSE * defense(g));
    const won: boolean[] = [];
    withDiceStep(0, () => {
      for (let n = 1; n <= top; n += 1) {
        const call: GateCall = { id: `mono${n}`, foe: 'wolves', power: n * BATTLE_MAN, seed: 7919 };
        const party = w.gateParty(call);
        // Граница области: дверь правда ставит `n` волков — иначе шаг кривой был бы не на голову.
        expect(party.kinds.cavalry, `мощь ${call.power}`).toBe(n);
        won[n] = w.gateField(party, call.seed, w.save.home, at).field.won;
      }
    });
    // Граница области: на кривой есть и поражения волков, и их верх — иначе «не реже» проверялось бы даром.
    expect(won.includes(false), 'волки хоть раз отбиты').toBe(true);
    expect(won.includes(true), 'волки хоть раз взяли верх').toBe(true);
    const drops = won.flatMap((x, n) => (n > 1 && won[n - 1] && !x ? [n] : []));
    expect(drops, `${level}-й уровень: волков больше на одного — и верх уже не их`).toEqual([]);
  }, 120_000);
});
