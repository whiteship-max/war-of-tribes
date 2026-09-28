// Бой события у своих ворот — волки и разбойники (docs/battle_eu4.md, 14.28; слово владельца: считает мир той же дверью,
// что бой у стены, исход — отчётом в «Походы»). Канал такой: событие кладёт вызов в партию (`sim/gate.callGate`), слепок
// везёт его миру (`PlayerProfile.gate`), мир бьётся на пульсе (`LocalWorld.gateFights`) и возвращает последствие с
// отметкой вызова (`HomeEffect.gate`) и список посчитанных (`WorldPulse.gateDone`); племя вызов снимает
// (`sim/gate.settleGate`, `dropGates`).
//
// Проверка на настоящем мире и настоящем пульсе племени (`bridge.tribePulse`): вызов кладётся той же дверью, что у
// события, а не рукой в сохранение.
import { describe, expect, it } from 'vitest';
import { createInitialState } from '@/game/state';
import { deserialize, serialize } from '@/game/save';
import { callGate } from '@/game/sim/gate';
import { defense } from '@/game/derived';
import type { GameState } from '@/game/types';
import { LocalWorld } from './local/LocalWorld';
import type { WorldSave } from './local/state';
import { playerProfile, tribePulse, type PulseTribe } from './bridge';
import type { FigureView, MarchView, WorldPulse } from './types';

const START = 1_700_000_000_000;

function memory(data: string | null = null) {
  return {
    read: (): string | null => data,
    write: (json: string): void => {
      data = json;
    },
  };
}

/** Племя и мир, связанные тем же пульсом, что в игре. */
function pair(storage: ReturnType<typeof memory> | null = null) {
  let now = START;
  const s: GameState = createInitialState();
  const world = new LocalWorld({ seed: 7, now: () => now, storage });
  const tribe: PulseTribe = { get: () => s, apply: (change) => change(s) };
  let last: { marches: MarchView[]; figures: FigureView[] } = { marches: [], figures: [] };
  const pulse = async (): Promise<WorldPulse> => {
    const p = await tribePulse(world, tribe, last);
    last = { marches: p.marches, figures: p.figures };
    return p;
  };
  return { s, world, pulse, tick: (ms: number) => (now += ms) };
}

describe('вызов к воротам — канал между племенем и миром', () => {
  it('вызов бьётся один раз: слепок пришёл дважды — второго боя нет; снятый вызов мир забывает', async () => {
    const t = pair();
    await t.pulse();
    const call = callGate(t.s, 'wolves', defense(t.s) * 0.55, { hides: 10 });
    const profile = playerProfile(t.s);
    expect(profile.gate?.map((c) => c.id), 'вызов едет в слепке').toEqual([call.id]);
    expect(profile.gate?.[0], 'трофеи в слепок не едут').not.toHaveProperty('spoils');

    const first = await t.world.sync(profile);
    const fought = first.effects.filter((e) => e.gate === call.id);
    expect(fought, 'первый пульс — один бой').toHaveLength(1);
    expect(first.reports.filter((r) => r.id === `${call.id}-gate`), 'и один отчёт').toHaveLength(1);
    expect(first.gateDone, 'мир называет вызов посчитанным').toEqual([call.id]);
    const saved = (t.world as unknown as { save: WorldSave }).save;
    expect(saved.profile?.gate, 'вызовы в сохранении мира не лежат').toBeUndefined();

    // Партия не успела записаться после пульса и прислала тот же вызов снова.
    const again = await t.world.sync(profile);
    expect(again.effects.filter((e) => e.gate === call.id), 'второго боя за вызов нет').toHaveLength(0);
    expect(again.reports.filter((r) => r.id === `${call.id}-gate`), 'второго отчёта нет').toHaveLength(0);
    expect(again.gateDone, 'мир по-прежнему называет его посчитанным').toEqual([call.id]);

    // Племя сняло вызов — мир забывает его: срока у памяти нет.
    const done = await t.world.sync(playerProfile({ ...t.s, gate: [] }));
    expect(done.gateDone, 'нечего называть').toBeUndefined();
    expect(saved.gateDone, 'память о вызове ушла вместе с ним').toBeUndefined();
  });

  it('пульс племени снимает вызов по списку мира — и посчитанный сейчас, и посчитанный раньше', async () => {
    const t = pair();
    await t.pulse();
    callGate(t.s, 'wolves', defense(t.s) * 0.55, { hides: 10 });
    const battles = t.s.stats.battlesWon + t.s.stats.battlesLost;
    await t.pulse();
    expect(t.s.gate, 'вызов снят после боя').toEqual([]);
    expect(t.s.stats.battlesWon + t.s.stats.battlesLost, 'бой засчитан ровно один').toBe(battles + 1);

    // Последствие потерялось: вызов остался в партии, а мир его уже посчитал — снимается по списку мира, без боя.
    const lost = callGate(t.s, 'raiders', defense(t.s) * 0.85, {});
    await t.world.sync(playerProfile(t.s));
    const before = t.s.stats.battlesWon + t.s.stats.battlesLost;
    const p = await t.pulse();
    expect(p.effects.some((e) => e.gate === lost.id), 'второго боя нет').toBe(false);
    expect(t.s.gate, 'вызов снят по списку мира').toEqual([]);
    expect(t.s.stats.battlesWon + t.s.stats.battlesLost, 'боя в партии не прибавилось').toBe(before);
  });
});

describe('старые сохранения читаются без вызовов', () => {
  it('партия, записанная до поставки 3, приезжает с пустым списком вызовов', () => {
    const saved = JSON.parse(serialize(createInitialState())) as Record<string, unknown>;
    expect(saved, 'новая партия пишет поле').toHaveProperty('gate');
    delete saved.gate;
    const back = deserialize(JSON.stringify(saved));
    expect(back, 'партия читается').not.toBeNull();
    expect(back!.gate, 'вызовов нет').toEqual([]);
  });

  it('мир, записанный до поставки 3, читается и бьётся по первому вызову', async () => {
    const store = memory();
    const old = pair(store);
    await old.pulse();
    const json = store.read();
    expect(json, 'мир записан').toBeTruthy();
    expect(JSON.parse(json!), 'в мире без вызовов памяти о них нет').not.toHaveProperty('gateDone');

    const t = pair(memory(json));
    await t.pulse();
    const call = callGate(t.s, 'wolves', defense(t.s) * 0.55, {});
    const p = await t.pulse();
    expect(p.effects.filter((e) => e.gate === call.id), 'бой по первому вызову').toHaveLength(1);
  });
});
