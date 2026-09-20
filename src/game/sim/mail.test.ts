import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state';
import { MAX_BUILDING_LEVEL, RESOURCE_IDS } from '../constants';
import { BUILDING_BY_ID } from '../data/buildings';
import { EVENTS, EVENT_BY_ID, eventCost } from '../data/events';
import { MUTINY_EVENT } from '../data/order';
import type { GameState } from '../types';
import {
  AWAY_JITTER,
  AWAY_STEP,
  EVENT_TTL,
  SILENCE_PREFIX,
  awayArrival,
  eventId,
  eventLeft,
  lapseEvent,
  mailArrive,
  mailStep,
  raiseEvent,
  resolveEvent,
} from './mail';
import { catchUp, tick } from './tick';
import { setRandom, seeded } from './random';
import { LETTER_DECISIONS } from '@/world/letters';
import { LETTER_PAUSE_MAX, LETTER_PAUSE_MIN, LETTER_SLOTS } from '@/world/data/tuning';

/**
 * Событие в почте державы: ждёт ответа настоящие сутки и без ответа разрешается
 * вариантом, который назвало само (docs/realm.md, разделы 2.5 и 8). Ждать могут
 * несколько сразу — стол тот же, что у писем мира.
 *
 * Срок у всей почты один, и у мятежа тот же (решение владельца, docs/time.md, раздел 16).
 * Каждый тест срока берёт точки строго по обе стороны от срока, а не «где-нибудь потом».
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

const ordinary = EVENTS.filter((e) => e.id !== MUTINY_EVENT);

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
      expect(mailStep(s, T0), 'первый взгляд только ставит срок').toBe(false);
      const ev = s.inbox[0];
      expect(ev.until, e.id).toBe(T0 + EVENT_TTL);
      expect(eventLeft(ev, T0)).toBe(EVENT_TTL / 1000);

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

  it('у мятежа срок тот же, что у всей почты', () => {
    const s = rich();
    s.inbox = [{ defId: MUTINY_EVENT, at: s.time }];
    expect(mailStep(s, T0), 'первый взгляд только ставит срок').toBe(false);
    expect(s.inbox[0].until).toBe(T0 + EVENT_TTL);
    expect(mailStep(s, T0 + EVENT_TTL - 1)).toBe(false);
    expect(s.inbox.map((x) => x.defId)).toEqual([MUTINY_EVENT]);
    expect(mailStep(s, T0 + EVENT_TTL)).toBe(true);
    expect(s.inbox).toEqual([]);
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
    // Внутри области: обучения нет, ропота нет — вести приходят.
    expect(s.unrest).toBe(0);
    // Двое суток настоящего времени при игроке: по сетке это пять-шесть приходов.
    mailArrive(s, T0, T0 + 2 * EVENT_TTL);
    expect(s.inbox.length, 'второе событие не пришло, пока ждёт первое').toBeGreaterThanOrEqual(2);
  });

  // Область правила: окно длиннее шага сетки (иначе приходов может не быть вовсе) и без ропота.
  it('вести зреют по времени, а не по присутствию: шаг симуляции их не поднимает, сколько бы ни шёл', () => {
    const s = rich();
    expect(s.unrest).toBe(0);
    for (let i = 0; i < 4000; i++) tick(s, 0.5);
    expect(s.inbox, 'шаг при игроке вестей не рождает').toEqual([]);
    catchUp(s, 4 * 3600, 2);
    expect(s.inbox, 'и догон отлучки тоже').toEqual([]);
  });

  it('при игроке и в отлучке вести одни и те же: живые шаги по секунде дают тот же стол, что отлучка', () => {
    const present = rich();
    const absent = rich();
    present.seed = absent.seed = 424242;
    const span = AWAY_STEP * 2.5;
    expect(span, 'точка внутри области: окно длиннее шага сетки').toBeGreaterThan(AWAY_STEP + AWAY_JITTER);
    expect(span, 'и короче срока вести — ни одна не истекла').toBeLessThan(EVENT_TTL);
    // Игрок при игре: окно шага за окном. Время племени здесь стоит у обоих — сравнивается сетка.
    const STEP = 60_000;
    for (let t = T0; t < T0 + span; t += STEP) mailArrive(present, t, t + STEP);
    mailArrive(absent, T0, T0 + span);
    expect(present.inbox.length, 'точка внутри области: вести пришли').toBeGreaterThan(0);
    expect(present.inbox.map((e) => [e.defId, e.until])).toEqual(absent.inbox.map((e) => [e.defId, e.until]));
  });
});

/**
 * Вести в отлучке выводятся из времени: приход k стоит в абсолютной минуте, и стол
 * при входе зависит только от того, сколько прошло, и от сида партии. Область правила
 * — окно (последняя запись, вход], не глубже срока в сутки; при обучении и ропоте
 * вестей нет. Точки выборки стоят по обе стороны настоящих приходов сетки, а не на
 * произвольных минутах: иначе «ничего не пришло» проходило бы даром.
 */
describe('почта копится в отлучке — выводом из времени', () => {
  const quiet = (): GameState => {
    const s = rich();
    s.seed = 424242;
    return s;
  };
  // Первый приход сетки после T0 и следующий за ним.
  const first = (seed: number): number => {
    let k = Math.floor(T0 / AWAY_STEP);
    while (awayArrival(seed, k) <= T0) k++;
    return k;
  };

  it('соседние приходы лежат в 6–10 ч друг от друга — паузы писем', () => {
    for (let k = 0; k < 200; k++) {
      const gap = awayArrival(7, k + 1) - awayArrival(7, k);
      expect(gap).toBeGreaterThanOrEqual(LETTER_PAUSE_MIN);
      expect(gap).toBeLessThanOrEqual(LETTER_PAUSE_MAX);
    }
  });

  it('весть приходит ровно в минуту своего прихода: миг до — стол пуст, в саму минуту — лежит', () => {
    const k = first(424242);
    const t = awayArrival(424242, k);
    // Внутри области: приход внутри суток от записи.
    expect(t - T0).toBeLessThan(EVENT_TTL);
    const before = quiet();
    expect(mailArrive(before, T0, t - 1), 'пришло раньше своей минуты').toBe(0);
    expect(before.inbox).toEqual([]);
    const at = quiet();
    expect(mailArrive(at, T0, t), 'в свою минуту не пришло').toBe(1);
    expect(at.inbox.length).toBe(1);
    // Срок — от прихода, а не от входа. Вход нарочно на час позже прихода: в саму
    // минуту прихода обе мерки совпали бы, и проверка прошла бы даром.
    const late = quiet();
    expect(mailArrive(late, T0, t + HOUR)).toBe(1);
    expect(late.inbox[0].until, 'срок — сутки от прихода, а не от входа').toBe(t + EVENT_TTL);
  });

  it('стол не зависит от того, сколько раз заглядывали: одна отлучка = две подряд', () => {
    const k = first(424242);
    const end = awayArrival(424242, k + 2) + HOUR;
    // Внутри области: три прихода, и всё окно — в пределах суток.
    expect(end - T0).toBeLessThan(EVENT_TTL);
    const mid = awayArrival(424242, k + 1) - HOUR;
    const once = quiet();
    mailArrive(once, T0, end);
    const twice = quiet();
    mailArrive(twice, T0, mid);
    mailArrive(twice, mid, end);
    // Внутри области: в окно легли три прихода сетки, и хотя бы один из них — на стол
    // (того же вида второй раз не кладут, поэтому легших может быть меньше).
    const grid = [k, k + 1, k + 2].map((i) => awayArrival(424242, i));
    expect(grid.every((g) => g > T0 && g <= end)).toBe(true);
    expect(once.inbox.length).toBeGreaterThan(0);
    expect(twice.inbox).toEqual(once.inbox);
    expect(twice.rolls, 'кость брошена разное число раз').toBe(once.rolls);
  });

  it('глубже суток окно не заходит: долгая отлучка не решает вести молчанием', () => {
    const s = quiet();
    const now = T0 + 7 * 24 * HOUR;
    const n = mailArrive(s, T0, now);
    // Приходов за неделю — два десятка; на стол попадают только последние сутки.
    expect(n, 'за сутки пришло больше, чем помещает сетка').toBeLessThanOrEqual(Math.ceil(EVENT_TTL / LETTER_PAUSE_MIN));
    expect(n).toBeGreaterThan(0);
    for (const ev of s.inbox) expect(ev.until! - EVENT_TTL, 'весть старше суток').toBeGreaterThan(now - EVENT_TTL);
    expect(s.log.some((l) => l.text.includes(SILENCE_PREFIX)), 'отлучка решила весть молчанием').toBe(false);
  });

  it('при ропоте и при обучении вестей в отлучке нет — как при игроке', () => {
    const k = first(424242);
    const t = awayArrival(424242, k);
    const restless = quiet();
    restless.unrest = 1;
    expect(mailArrive(restless, T0, t)).toBe(0);
    const novice = quiet();
    novice.tutorialDone = false;
    novice.time = 0;
    expect(mailArrive(novice, T0, t)).toBe(0);
  });
});
