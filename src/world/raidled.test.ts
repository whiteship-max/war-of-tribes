// АУ-8, п. 5 (OWNER-DECISIONS п. 18, решение владельца 26.10.2026): прорвавшийся набег уводит наших — поведение АУ-6
// остаётся, и его видно. Люди уходят из города в минуту прорыва; у пострадавшего — отряд на карте (виден вне обзора) и
// строка «уводят N пленных, дойдут через X» с кнопкой погони. Три исхода: отбили — свои возвращаются домой (невольники —
// невольниками, горожане и пленные — людьми); дошли — пленные в плену у их двора и письмо о выкупе. Ни потери, ни двойного
// счёта людей.
import { afterEach, describe, expect, it } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import type { StoredMarch, WorldSave } from './local/state';
import type { GenSettlement } from './gen';
import type { Coord, HomeEffect, PlayerProfile } from './types';
import { distance } from './geo';
import { takingLine } from './raidwords';
import { pickLetter, type LetterCandidate } from './letters';
import { inSight, type SightDisc } from './fog';
import { marchPosition } from './geo';
import { realLeft } from '@/ui/parts/wait';
import { plural } from '@/ui/parts/plural';
import { secondsLeft } from './geo';

const START = 1_700_000_000_000;

type Inner = {
  save: WorldSave;
  gen: { settlements: GenSettlement[] };
  alive(s: GenSettlement, now: number): boolean;
  resolveIncoming(m: StoredMarch, at: number): void;
  arriveHome(m: StoredMarch, at: number): void;
  letterCandidates(at: number): LetterCandidate[];
  sightDiscs(now: number): SightDisc[];
  effects: HomeEffect[];
};

// Город слабый: заслон не держит, у ворот — горожане и невольники. Участь «увести людей».
const profile = (o: Partial<PlayerProfile> = {}): PlayerProfile => ({
  name: 'Т',
  pop: 200,
  defense: 1,
  militia: 0,
  units: { scout: 0 },
  army: { spearman: 6 },
  stock: { food: 600, wood: 400 },
  stash: 0,
  bonded: 40,
  storeCap: 100_000,
  ...o,
});

/** Сильный набег ближнего логова дошёл до стен — прорыв участью «увести людей». */
function raid(w: Inner, now: number, far = false): StoredMarch {
  const home = w.save.home;
  // Ближнее логово — набеги идут из своего края, и письмо о выкупе пишет оно. Дальнее — для «виден вне обзора»: путь домой
  // выходит за обзор города, и точка проверки — за ним.
  const lairs = w.gen.settlements.filter((s) => w.alive(s, now)).sort((a, b) => distance(home, a) - distance(home, b));
  const lair = far ? lairs[lairs.length - 1] : lairs[0];
  const m: StoredMarch = {
    id: 'm-raid',
    seed: 5,
    mission: 'raid',
    units: { warrior: 60 },
    own: false,
    fromId: lair.id,
    targetId: 'home',
    from: { x: lair.x, y: lair.y },
    to: { ...home },
    fromName: lair.name,
    toName: 'Наш город',
    departAt: now - 3_600_000,
    arriveAt: now,
    phase: 'out',
    power: 600,
    fate: 'captives',
    loot: null,
  } as StoredMarch;
  w.save.marches.push(m);
  return m;
}

const sumOf = (xs: HomeEffect[], f: (e: HomeEffect) => number): number => xs.reduce((t, e) => t + f(e), 0);

describe('АУ-8 п. 5: набег уводит наших — видно и без потерь счёта', () => {
  let now = START;
  afterEach(() => {
    now = START;
  });

  async function breached(far = false) {
    const world = new LocalWorld({ seed: 7, now: () => now, storage: null });
    const w = world as unknown as Inner;
    await world.sync(profile());
    const m = raid(w, now, far);
    w.resolveIncoming(m, now);
    const out = await world.sync(profile());
    const hit = out.effects.find((e) => e.id === `${m.id}-defense`)!;
    return { world, w, m, out, hit };
  }

  it('прорыв: люди уходят сразу; отряд виден на карте вне обзора; строка «уводят N, дойдут через X»', async () => {
    const { world, w, m, hit, out } = await breached(true);
    expect(hit.battle, 'точка внутри области: прорвались').toBe('lost');
    const led = m.led ?? 0;
    const bonded = m.ledBonded ?? 0;
    expect(led, 'увели людей').toBeGreaterThan(0);
    expect(bonded, 'и невольников').toBeGreaterThan(0);
    // Из города — в минуту прорыва: невольники и горожане, как их считает дверь участи.
    expect(-(hit.bonded ?? 0)).toBeGreaterThanOrEqual(bonded);
    expect(hit.popLost ?? 0).toBeGreaterThanOrEqual(led - bonded);
    expect(m.phase).toBe('back');
    // Отряд на карте у пострадавшего — где бы он ни шёл: он уводит наших.
    now = m.departAt + (m.arriveAt - m.departAt) * 0.95;
    const pos = marchPosition(m, now);
    expect(inSight(w.sightDiscs(now), pos.x, pos.y), 'точка внутри области: отряд вне обзора').toBe(false);
    const view = (await world.marches()).find((x) => x.id === m.id);
    expect(view, 'виден и далеко от города').toBeDefined();
    expect(view?.taking).toBe((m.held ?? 0) + led);
    const n = (m.held ?? 0) + led;
    expect(takingLine(view!, now)).toBe(`Уводят ${n} ${plural(n, 'пленного', 'пленных', 'пленных')}, дойдут через ${realLeft(secondsLeft(m.arriveAt, now))}`);
    // Донесение о прорыве называет то же.
    const rep = out.reports.find((r) => r.id === `${m.id}-defense`);
    expect(rep?.text).toContain(`Уводят ${(m.held ?? 0) + led}`);
  }, 60_000);

  it('отбили: свои возвращаются домой — невольники невольниками, люди людьми; ни потери, ни двойного счёта', async () => {
    const { world, w, m, hit } = await breached();
    const held = m.held ?? 0;
    const led = m.led ?? 0;
    const ledBonded = m.ledBonded ?? 0;
    // Полководец с сильным отрядом в поле на пути отряда.
    const at: Coord = { x: m.from.x + (m.to.x - m.from.x) * 0.3, y: m.from.y + (m.to.y - m.from.y) * 0.3 };
    Object.assign(w.save.figures.general, {
      phase: 'field', from: { ...at }, to: { ...at }, departAt: now, arriveAt: now, downUntil: 0, busyUntil: 0, held: false,
      watching: false, energy: undefined, spent: undefined, troops: { spearman: 2000 }, handover: undefined, chase: undefined,
    });
    expect(await world.intercept(m.id)).toBeNull();
    now = w.save.figures.general.arriveAt + 1;
    const out = await world.sync(profile({ army: { spearman: 2006 } }));
    const back = out.effects.find((e) => e.id.startsWith('chase') && e.id.endsWith('-eff'));
    expect(back?.battle, 'точка внутри области: отбили').toBe('won');
    expect(back?.pop, 'люди — домой людьми: пленные и горожане').toBe(held + led - ledBonded);
    expect(back?.bonded ?? 0, 'невольники — невольниками').toBe(ledBonded);
    // Ни потери, ни двойного счёта: вернулось ровно столько, сколько увели (без разошедшихся при прорыве).
    expect((back?.pop ?? 0) + (back?.bonded ?? 0)).toBe(held + led);
    expect(w.save.captives[m.fromId] ?? 0, 'у их двора — никого').toBe(0);
    expect(-(hit.bonded ?? 0) - ledBonded, 'разбежавшиеся невольники не возвращаются').toBeGreaterThanOrEqual(0);
  }, 60_000);

  it('дошли: пленные в плену у их двора, письмо о выкупе возможно; уведённые не возвращаются', async () => {
    const { world, w, m } = await breached();
    const held = m.held ?? 0;
    expect(held, 'точка внутри области: пленные есть').toBeGreaterThan(0);
    const before = w.save.captives[m.fromId] ?? 0;
    now = m.arriveAt + 1;
    const out = await world.sync(profile());
    expect(w.save.marches.some((x) => x.id === m.id)).toBe(false);
    // Двор назначения — логово, откуда пришли (у идущего домой «куда» — их двор).
    const lair = w.save.captives[m.fromId];
    expect(lair, 'пленные — у их двора').toBe(before + held);
    // Письмо о выкупе: логово, держащее наших, — отправитель, и выкуп из его письма возвращает их людьми.
    const cand = w.letterCandidates(now).find((c) => c.id === m.fromId);
    expect(cand?.captives).toBe(held);
    const draft = pickLetter(1, 1, cand ? [cand] : [], { wood: 10_000, food: 10_000, gold: 10_000 });
    expect(draft?.kind, 'логово пишет только о выкупе').toBe('ransom');
    expect(draft?.men).toBe(held);
    expect(sumOf(out.effects, (e) => e.pop ?? 0), 'дома никто не появился').toBe(0);
  }, 60_000);
});
