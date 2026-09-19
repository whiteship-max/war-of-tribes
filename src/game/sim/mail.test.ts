import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state';
import { MAX_BUILDING_LEVEL, MUTINY_FUSE, RESOURCE_IDS } from '../constants';
import { BUILDING_BY_ID } from '../data/buildings';
import { EVENTS, EVENT_BY_ID, eventCost } from '../data/events';
import { MUTINY_EVENT } from '../data/order';
import type { GameState } from '../types';
import { EVENT_TTL, SILENCE_PREFIX, eventLeft, lapseEvent, mailStep, resolveEvent } from './mail';
import { tick } from './tick';
import { setRandom, seeded } from './random';

/**
 * Событие в почте державы: ждёт ответа настоящие сутки и без ответа разрешается
 * вариантом, который назвало само (docs/realm.md, раздел 2.5).
 *
 * Область правила срока — события **без своего срока** (`EventDef.deadline`):
 * у мятежа срок игровой и только при игроке, и настоящие часы его не касаются.
 * Каждый тест срока поэтому сначала утверждает, что его событие внутри области,
 * и берёт точки строго по обе стороны от срока, а не «где-нибудь потом».
 */

const HOUR = 60 * 60 * 1000;
const T0 = 1_900_000_000_000;

function rich(): GameState {
  const s = createInitialState();
  s.tutorialDone = true;
  for (const b of s.buildings) b.level = Math.min(BUILDING_BY_ID[b.type].maxLevel ?? MAX_BUILDING_LEVEL, MAX_BUILDING_LEVEL);
  for (const r of RESOURCE_IDS) s.resources[r] = 5000;
  s.gold = 5000;
  s.pop = 200;
  return s;
}

const ordinary = EVENTS.filter((e) => !e.deadline && e.id !== MUTINY_EVENT);

describe('молчание — вариант, который событие назвало само', () => {
  it('у каждого события молчание — настоящий вариант, и он ничего не стоит', () => {
    const s = rich();
    for (const e of EVENTS) {
      const o = e.options[e.silence];
      expect(o, `${e.id}: молчание указывает мимо вариантов`).toBeDefined();
      const cost = Object.values(eventCost(o, s)).some((n) => (n ?? 0) > 0);
      expect(cost, `${e.id}: молчание платит со склада`).toBe(false);
    }
  });

  it('молчание даёт ровно то же, что ответ этим вариантом', () => {
    for (const e of ordinary) {
      const base = rich();
      const run = (silent: boolean): GameState => {
        setRandom(seeded(7));
        const s = structuredClone(base);
        s.activeEvent = { defId: e.id, at: s.time };
        if (silent) lapseEvent(s);
        else resolveEvent(s, e.silence);
        setRandom(null);
        return s;
      };
      const a = run(true);
      const b = run(false);
      expect(a.activeEvent, e.id).toBeNull();
      expect({ ...a, log: [] }, `${e.id}: молчание разошлось с ответом «${e.options[e.silence].label}»`).toEqual({
        ...b,
        log: [],
      });
      expect(a.log[0].text).toContain(SILENCE_PREFIX);
      expect(b.log[0].text).not.toContain(SILENCE_PREFIX);
    }
  });
});

describe('срок донесения — настоящие сутки', () => {
  it('сутки, не меньше: игровой день длится минуту, и мерить им нельзя', () => {
    expect(EVENT_TTL).toBeGreaterThanOrEqual(24 * HOUR);
  });

  it('срок ставится при первом взгляде и разрешает событие ровно в свою минуту', () => {
    for (const e of ordinary) {
      const s = rich();
      s.activeEvent = { defId: e.id, at: s.time };
      // Внутри области: у события нет своего срока.
      expect(EVENT_BY_ID[e.id].deadline, e.id).toBeUndefined();

      expect(mailStep(s, T0), 'первый взгляд только ставит срок').toBeNull();
      expect(s.activeEvent?.until, e.id).toBe(T0 + EVENT_TTL);
      expect(eventLeft(s, T0)).toBe(EVENT_TTL / 1000);

      // Миг до срока — ещё ждёт; повторный взгляд срок не двигает.
      const before = T0 + EVENT_TTL - 1;
      expect(before).toBeGreaterThan(T0);
      expect(mailStep(s, before), `${e.id}: разрешилось раньше срока`).toBeNull();
      expect(s.activeEvent?.defId, e.id).toBe(e.id);
      expect(s.activeEvent?.until).toBe(T0 + EVENT_TTL);

      // Срок — разрешилось молчанием, и летопись это говорит.
      const settled = mailStep(s, T0 + EVENT_TTL);
      expect(settled, `${e.id}: срок вышел, а событие ждёт`).not.toBeNull();
      expect(s.activeEvent, e.id).toBeNull();
      expect(s.log[0].text).toContain(SILENCE_PREFIX);
      expect(s.log[0].text).toContain(e.options[e.silence].label);
    }
  });

  it('у мятежа свой срок, и настоящие часы его не трогают', () => {
    const s = rich();
    s.activeEvent = { defId: MUTINY_EVENT, at: s.time };
    expect(EVENT_BY_ID[MUTINY_EVENT].deadline).toBeDefined();
    expect(mailStep(s, T0)).toBeNull();
    expect(mailStep(s, T0 + 10 * EVENT_TTL)).toBeNull();
    expect(s.activeEvent?.defId).toBe(MUTINY_EVENT);
    expect(s.activeEvent?.until).toBeUndefined();
  });
});

describe('мятеж не ждёт за донесением', () => {
  it('ждущее событие разрешается своим молчанием, и мятеж встаёт на стол', () => {
    const s = rich();
    // Невольников больше, чем удержит надзор, — ропот идёт.
    s.bonded = 2000;
    const e = EVENT_BY_ID.storm;
    s.activeEvent = { defId: e.id, at: s.time, until: T0 + EVENT_TTL };
    s.unrest = MUTINY_FUSE - 0.25;
    tick(s, 0.5);
    expect(s.activeEvent?.defId, 'ропот дошёл до срока, а мятежа нет').toBe(MUTINY_EVENT);
    expect(s.log.some((l) => l.text.includes(SILENCE_PREFIX) && l.text.includes(e.options[e.silence].label))).toBe(true);
  });
});
