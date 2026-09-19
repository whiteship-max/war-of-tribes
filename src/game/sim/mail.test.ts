import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state';
import { MAX_BUILDING_LEVEL, RESOURCE_IDS } from '../constants';
import { BUILDING_BY_ID } from '../data/buildings';
import { EVENTS, EVENT_BY_ID, eventCost } from '../data/events';
import { MUTINY_EVENT } from '../data/order';
import type { GameState } from '../types';
import { EVENT_TTL, SILENCE_PREFIX, eventId, eventLeft, lapseEvent, mailStep, raiseEvent, resolveEvent } from './mail';
import { tick } from './tick';
import { setRandom, seeded } from './random';
import { LETTER_DECISIONS } from '@/world/letters';
import { LETTER_SLOTS } from '@/world/data/tuning';

/**
 * Событие в почте державы: ждёт ответа настоящие сутки и без ответа разрешается
 * вариантом, который назвало само (docs/realm.md, разделы 2.5 и 8). Ждать могут
 * несколько сразу — стол тот же, что у писем мира.
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
        s.inbox = [{ defId: e.id, at: s.time }];
        if (silent) lapseEvent(s);
        else resolveEvent(s, e.silence);
        setRandom(null);
        return s;
      };
      const a = run(true);
      const b = run(false);
      expect(a.inbox, e.id).toEqual([]);
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
      s.inbox = [{ defId: e.id, at: s.time }];
      // Внутри области: у события нет своего срока.
      expect(EVENT_BY_ID[e.id].deadline, e.id).toBeUndefined();

      expect(mailStep(s, T0), 'первый взгляд только ставит срок').toBe(false);
      const ev = s.inbox[0];
      expect(ev.until, e.id).toBe(T0 + EVENT_TTL);
      expect(eventLeft(s, ev, T0)).toBe(EVENT_TTL / 1000);

      // Миг до срока — ещё ждёт; повторный взгляд срок не двигает.
      const before = T0 + EVENT_TTL - 1;
      expect(before).toBeGreaterThan(T0);
      expect(mailStep(s, before), `${e.id}: разрешилось раньше срока`).toBe(false);
      expect(s.inbox.map((x) => x.defId), e.id).toEqual([e.id]);
      expect(s.inbox[0].until).toBe(T0 + EVENT_TTL);

      // Срок — разрешилось молчанием, и летопись это говорит.
      expect(mailStep(s, T0 + EVENT_TTL), `${e.id}: срок вышел, а событие ждёт`).toBe(true);
      expect(s.inbox, e.id).toEqual([]);
      expect(s.log[0].text).toContain(SILENCE_PREFIX);
      expect(s.log[0].text).toContain(e.options[e.silence].label);
    }
  });

  it('у мятежа свой срок, и настоящие часы его не трогают', () => {
    const s = rich();
    s.inbox = [{ defId: MUTINY_EVENT, at: s.time }];
    expect(EVENT_BY_ID[MUTINY_EVENT].deadline).toBeDefined();
    expect(mailStep(s, T0)).toBe(false);
    expect(mailStep(s, T0 + 10 * EVENT_TTL)).toBe(false);
    expect(s.inbox.map((x) => x.defId)).toEqual([MUTINY_EVENT]);
    expect(s.inbox[0].until).toBeUndefined();
  });
});

/**
 * Стол событий — тот же, что у писем мира: `LETTER_DECISIONS` обычных и своя
 * ячейка мятежу (`LETTER_SLOTS`). Область правила вытеснения — полный стол:
 * пока на нём меньше `LETTER_DECISIONS`, сгонять некого, и каждый тест ниже
 * сначала утверждает, по какую сторону границы он стоит.
 */
describe('стол: несколько донесений сразу, лишнее сгоняется правилом писем', () => {
  const kinds = ordinary.map((e) => e.id);
  /** Стол из n обычных событий с разными сроками: i-е истекает через (n − i) часов. */
  const table = (n: number): GameState => {
    const s = rich();
    for (let i = 0; i < n; i++) {
      s.time = i;
      raiseEvent(s, kinds[i]);
      s.inbox[i].until = T0 + (n - i) * HOUR;
    }
    return s;
  };

  it('до полного стола события копятся и никого не сгоняют', () => {
    expect(kinds.length).toBeGreaterThan(LETTER_DECISIONS);
    const s = table(LETTER_DECISIONS);
    expect(s.inbox.length, 'стол не наполнился').toBe(LETTER_DECISIONS);
    expect(
      s.log.some((l) => l.text.includes(SILENCE_PREFIX)),
      'сгонял, не наполнив стола',
    ).toBe(false);
  });

  it('лишнее сгоняет то, у кого срок ближе всех, — его молчанием', () => {
    const s = table(LETTER_DECISIONS);
    // Внутри области: стол полон.
    expect(s.inbox.length).toBe(LETTER_DECISIONS);
    // Ближе всех срок у последнего пришедшего, а не у первого: мерится срок, а не возраст.
    const nearest = s.inbox[LETTER_DECISIONS - 1];
    const def = EVENT_BY_ID[nearest.defId];
    s.time = 100;
    expect(raiseEvent(s, kinds[LETTER_DECISIONS])).toBe(true);
    expect(s.inbox.length, 'стол вырос сверх писем').toBe(LETTER_DECISIONS);
    expect(s.inbox.map(eventId), 'согнали не того').not.toContain(eventId(nearest));
    expect(s.inbox.map((x) => x.defId)).toContain(kinds[LETTER_DECISIONS]);
    expect(s.log[0].text).toContain(SILENCE_PREFIX);
    expect(s.log[0].text).toContain(def.options[def.silence].label);
  });

  it('мятеж встаёт в свою ячейку: не сгоняет вестей и сам не сгоняется', () => {
    const s = table(LETTER_DECISIONS);
    expect(raiseEvent(s, MUTINY_EVENT)).toBe(true);
    expect(s.inbox.length, 'мятеж согнал весть').toBe(LETTER_SLOTS);
    // Новая весть при мятеже на столе сгоняет весть, а не мятеж — хотя срока у него нет.
    s.time = 100;
    raiseEvent(s, kinds[LETTER_DECISIONS]);
    expect(s.inbox.length).toBe(LETTER_SLOTS);
    expect(
      s.inbox.map((x) => x.defId),
      'мятеж согнан вестью',
    ).toContain(MUTINY_EVENT);
  });

  it('того же вида второй раз на стол не кладут', () => {
    const s = table(1);
    expect(raiseEvent(s, kinds[0])).toBe(false);
    expect(s.inbox.length).toBe(1);
  });

  it('пока прежние ждут, приходят новые: игра не ждёт ответа, чтобы поднять следующее', () => {
    const s = rich();
    s.nextEventAt = 0;
    // Внутри области: обучения нет, ропота нет — случайные события поднимаются.
    expect(s.unrest).toBe(0);
    for (let i = 0; i < 2000 && s.inbox.length < 2; i++) tick(s, 0.5);
    expect(s.inbox.length, 'второе событие не пришло, пока ждёт первое').toBeGreaterThanOrEqual(2);
  });
});
