// Версия правил боя (BTL-0, docs/audit/OWNER-DECISIONS.md, п. 7): номер лежит во входе боя и в его итоге; старые бои не
// пересчитываются, а журнал боя войны, который клиент пересчитывает из входа сервера, идёт по версии этого входа.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BATTLE_RULES, FIRST_RULES, deploySetup, emptyStack, simulateBattle, type Stack } from '@/battle';
import { machineFight, wallFight } from './fights';
import { recordedField, resolveField, type FieldInput } from './battle';

const stack = (s: Partial<Stack>): Stack => ({ ...emptyStack(), ...s });
const input: FieldInput = { seed: 7, attacker: { kinds: stack({ spear: 60, archer: 20 }) }, defender: { kinds: stack({ infantry: 70 }) } };

describe('версия правил боя', () => {
  it('итог боя называет версию, по которой посчитан: нынешнюю или названную во входе', () => {
    const now = simulateBattle({ seed: 1, attacker: deploySetup({ spear: 40 }), defender: deploySetup({ infantry: 40 }) });
    expect(Number.isInteger(now.rules) && (now.rules ?? 0) >= FIRST_RULES).toBe(true);
    expect(now.rules).toBe(BATTLE_RULES);
    const first = simulateBattle({ seed: 1, rules: FIRST_RULES, attacker: deploySetup({ spear: 40 }), defender: deploySetup({ infantry: 40 }) });
    expect(first.rules).toBe(FIRST_RULES);
    expect(resolveField(input).result?.rules).toBe(BATTLE_RULES);
  });

  it('двери боя мира и сервера пишут нынешнюю версию во вход — он едет записью войны', () => {
    const wall = wallFight({ seed: 3, attacker: { kinds: stack({ spear: 50 }) }, defender: { kinds: stack({ infantry: 30 }), militia: 10, archers: 4 } });
    expect(wall.input.rules).toBe(BATTLE_RULES);
    expect(wall.field.result?.rules).toBe(BATTLE_RULES);
    const machine = machineFight({ seed: 5, guard: { kinds: stack({ spear: 20 }), rest: 1 }, sortie: { kinds: stack({ infantry: 30 }) } });
    expect(machine.input.rules).toBe(BATTLE_RULES);
    // Каждый вход двери боя (у стены, у машины, у лагеря) несёт версию: вход без неё сервер записал бы «старше версий».
    const src = readFileSync('src/world/fights.ts', 'utf8');
    const built = src.match(/const fieldIn: FieldInput = \{\n\s+seed: input\.seed,\n\s+rules: BATTLE_RULES,/g) ?? [];
    expect(built.length).toBe((src.match(/const fieldIn: FieldInput = \{/g) ?? []).length);
    expect(built.length).toBeGreaterThanOrEqual(3);
  });

  it('вход из записи без версии пересчитывается по первой, с версией — по своей', () => {
    expect(recordedField(input).result?.rules).toBe(FIRST_RULES);
    expect(recordedField({ ...input, rules: BATTLE_RULES }).result?.rules).toBe(BATTLE_RULES);
  });
});
