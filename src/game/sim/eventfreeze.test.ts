import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../state';
import { DAY_LENGTH, MAX_BUILDING_LEVEL, RESOURCE_IDS } from '../constants';
import { BUILDING_BY_ID } from '../data/buildings';
import { EVENTS, EVENT_BY_ID, eventCost, optionHint } from '../data/events';
import { currentSite, population } from '../derived';
import { deserialize, serialize } from '../save';
import type { GameState } from '../types';
import { holdRite } from './faith';
import { eventId, mailArrive, raiseEvent, resolveEvent } from './mail';
import { startUpgrade } from './actions';
import { eventDispatch } from '@/ui/realm/dispatch';

/**
 * ECO-3: у вести условия проверяются при приходе, а ответить можно сутки спустя. Цена и награда считаются от посёлка в
 * минуту прихода (`ActiveEvent.size`, `ActiveEvent.cost`), а вариант, чьё условие с тех пор пропало, гаснет своим `block`.
 */

function rich(seed = 7): GameState {
  const s = createInitialState(seed);
  s.tutorialDone = true;
  for (const b of s.buildings) b.level = Math.min(BUILDING_BY_ID[b.type].maxLevel ?? MAX_BUILDING_LEVEL, MAX_BUILDING_LEVEL);
  for (const r of RESOURCE_IDS) s.resources[r] = 100_000;
  s.gold = 100_000;
  s.pop = 200;
  s.time = 10 * DAY_LENGTH;
  s.faith.id = 'orthodox';
  return s;
}

/** Положить весть на стол её дверью и вернуть её имя. */
function raise(s: GameState, defId: string): string {
  expect(raiseEvent(s, defId)).toBe(true);
  return eventId(s.inbox[s.inbox.length - 1]);
}

const T0 = 1_900_000_000_000;

const wealth = (s: GameState): number[] => [...RESOURCE_IDS.map((r) => s.resources[r]), s.gold];

afterEach(() => vi.restoreAllMocks());

describe('ECO-3: вариант, чьё условие пропало, гаснет, и добро не уходит', () => {
  it('праздник прихода: второй обряд за сезон не справить (архив prove-4-1)', () => {
    const s = rich();
    const id = raise(s, 'festival');
    expect(holdRite(s)).toBeNull();
    const before = wealth(s);
    const until = s.faith.riteUntil;
    s.time += 10;
    const r = resolveEvent(s, 0, id);
    expect(r.error).not.toBeNull();
    expect(wealth(s)).toEqual(before);
    expect(s.faith.riteUntil).toBe(until);
  });

  it('странник со святыней: святыня уже стоит — платить не за что', () => {
    const s = rich();
    const id = raise(s, 'relic_offer');
    s.faith.relic = 'orthodox';
    const before = wealth(s);
    expect(resolveEvent(s, 0, id).error).not.toBeNull();
    expect(wealth(s)).toEqual(before);
  });

  it('бродячая артель: «Нанять на день» без стройки гаснет', () => {
    const s = rich();
    expect(currentSite(s)).toBeNull();
    const id = raise(s, 'wanderers');
    const before = wealth(s);
    expect(resolveEvent(s, 1, id).error).not.toBeNull();
    expect(wealth(s)).toEqual(before);
  });

  it('буря: стройка кончилась — лесов ставить не на чем', () => {
    const s = rich();
    const b = s.buildings.find((x) => (BUILDING_BY_ID[x.type].maxLevel ?? MAX_BUILDING_LEVEL) > 1 && x.type === 'houses')!;
    b.level = 1;
    expect(startUpgrade(s, b.id)).toBeNull();
    const site = currentSite(s)!;
    expect(site).not.toBeNull();
    const id = raise(s, 'storm');
    site.level += 1;
    site.work = 0;
    site.workRequired = 0;
    s.buildQueue = [];
    expect(currentSite(s)).toBeNull();
    const before = wealth(s);
    expect(resolveEvent(s, 0, id).error).not.toBeNull();
    expect(wealth(s)).toEqual(before);
  });

  it('условие на месте — вариант нажимается', () => {
    const s = rich();
    const id = raise(s, 'relic_offer');
    expect(resolveEvent(s, 0, id).error).toBeNull();
    expect(s.faith.relic).toBe('orthodox');
  });

  it('молчание не гаснет ни у одной вести: у каждой остаётся выход', () => {
    const s = rich();
    s.faith.relic = 'orthodox';
    s.faith.riteUntil = s.time + 100;
    for (const e of EVENTS) expect(e.options[e.silence].block?.(s) ?? null, e.id).toBeNull();
  });
});

describe('ECO-3: цена и награда — от посёлка в минуту прихода', () => {
  it('цена в ответе равна цене при приходе — у каждого платного варианта каждой вести', () => {
    let checked = 0;
    for (const e of EVENTS) {
      e.options.forEach((o, i) => {
        if (!o.cost) return;
        const s = rich();
        const at = eventCost(o, s);
        if (!Object.values(at).some((n) => (n ?? 0) > 0)) return;
        const id = raise(s, e.id);
        // Посёлок вырос втрое — ответ всё равно берёт цену прихода, и окно её же показывает.
        s.pop *= 3;
        expect(population(s)).toBeGreaterThan(400);
        const shown = eventDispatch(s, s.inbox.find((x) => eventId(x) === id)!, 0)!.choices[i].cost;
        expect(shown, `${e.id}[${i}]: окно`).toEqual(at);
        // Меряем только списанное: исход не исполняем, условие варианта (стройка, вера) пробный посёлок не держит.
        vi.spyOn(o, 'apply').mockReturnValue('');
        const block = o.block;
        o.block = undefined;
        const back = deserialize(serialize(s))!;
        const before = wealth(back);
        try {
          expect(resolveEvent(back, i, id).error, `${e.id}[${i}]`).toBeNull();
        } finally {
          o.block = block;
        }
        const paid = Object.fromEntries(
          [...RESOURCE_IDS, 'gold' as const]
            .map((r, k) => [r, Math.round(before[k] - (r === 'gold' ? back.gold : back.resources[r]))] as const)
            .filter(([, n]) => n !== 0),
        );
        const want = Object.fromEntries(Object.entries(at).filter(([, n]) => (n ?? 0) > 0));
        expect(paid, `${e.id}[${i}]: списано`).toEqual(want);
        vi.restoreAllMocks();
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(30);
  });

  it('награда — от посёлка в минуту прихода: ягоды втрое большему посёлку не втрое', () => {
    const s = rich();
    s.resources.food = 0;
    const id = raise(s, 'berries');
    const promised = Number(/\d+/.exec(optionHint(EVENT_BY_ID.berries.options[0], s)!)![0]);
    s.pop *= 3;
    expect(resolveEvent(s, 0, id).error).toBeNull();
    expect(Math.round(s.resources.food)).toBe(promised);
  });

  it('перебежчики: побег уводит тех, кого приняли, а не долю нынешнего посёлка (ECO-3, п. 4)', () => {
    let tried = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const s = rich(seed);
      const id = raise(s, 'deserters');
      const before = s.pop;
      expect(resolveEvent(s, 0, id).error).toBeNull();
      if (!s.chains.some((c) => c.defId === 'deserters_flee')) continue;
      tried++;
      const n = s.pop - before;
      expect(n).toBeGreaterThan(0);
      const back = deserialize(serialize(s))!;
      back.pop *= 3;
      back.time = back.chains[0].at;
      back.unrest = 0;
      mailArrive(back, T0 - 1000, T0);
      const flee = back.inbox.find((e) => e.defId === 'deserters_flee')!;
      const pop = back.pop;
      expect(resolveEvent(back, 1, eventId(flee)).error).toBeNull();
      expect(pop - back.pop, `сид ${seed}`).toBe(n);
      if (tried >= 3) break;
    }
    expect(tried).toBeGreaterThan(0);
  });
});
