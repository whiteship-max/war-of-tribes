import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state';
import { MAX_BUILDING_LEVEL, RESOURCE_IDS } from '../constants';
import { BUILDING_BY_ID } from './buildings';
import { EVENTS, EVENT_MORALE, eventBlock, eventCost, eventFrom, eventText, optionHint, type EventOption } from './events';
import { BANNED } from '@/ui/next/voice.test';
import { resolveEvent } from '../sim/actions';
import type { GameState } from '../types';

/**
 * Цена события — одна на показ, на запрет и на списание.
 *
 * Так было не всегда: цена жила строкой внутри `apply`, а игрок читал её из
 * подписи, написанной руками. Узнать при этом, **хватает ли**, было неоткуда —
 * окно события закрывает и склад, и всю игру, отложить его нельзя, — и «отдать
 * припасы» нажималось наугад. Не хватило — молча платили тем, что было, и
 * получали полную награду.
 *
 * Эти тесты держат новое правило с трёх сторон: цена объявлена полем, по ней
 * гаснет кнопка, и она же списывается. Плюс четвёртое, без чего первые три
 * опасны: у каждого события остаётся выбор, который ничего не стоит, — иначе
 * гаснущие кнопки заперли бы игрока в окне, которое не закрывается.
 */

/** Посёлок с большим складом и полными закромами. */
function rich(): GameState {
  const s = createInitialState();
  s.tutorialDone = true;
  for (const b of s.buildings) b.level = Math.min(BUILDING_BY_ID[b.type].maxLevel ?? MAX_BUILDING_LEVEL, MAX_BUILDING_LEVEL);
  for (const r of RESOURCE_IDS) s.resources[r] = 5000;
  s.gold = 5000;
  s.pop = 200;
  return s;
}

/** Пусто и на складе, и в казне. */
function broke(): GameState {
  const s = rich();
  for (const r of RESOURCE_IDS) s.resources[r] = 0;
  s.gold = 0;
  return s;
}

const paid = (o: EventOption, s: GameState): boolean =>
  Object.values(eventCost(o, s)).some((n) => (n ?? 0) > 0);

describe('цена события объявлена, а не спрятана в apply', () => {
  it('у каждого события есть выбор, который ничего не стоит', () => {
    const s = rich();
    for (const e of EVENTS) {
      const free = e.options.filter((o) => !paid(o, s));
      // Без этого запрет по нехватке запер бы игрока: окно события не
      // закрывается, отложить его нельзя, и все выходы оказались бы гашены.
      expect(free.length, `${e.id}: все варианты просят добро`).toBeGreaterThan(0);
    }
  });

  it('списывается ровно объявленное — ни больше, ни меньше', () => {
    for (const e of EVENTS) {
      for (const [i, o] of e.options.entries()) {
        const s = rich();
        const cost = eventCost(o, s);
        if (!paid(o, s)) continue;
        const before = { ...s.resources, gold: s.gold };
        s.inbox = [{ defId: e.id, at: s.time }];
        const r = resolveEvent(s, i);
        expect(r.error, `${e.id}/${i}`).toBeNull();
        for (const res of RESOURCE_IDS) {
          const need = cost[res] ?? 0;
          if (need <= 0) continue;
          expect(Math.round(before[res] - s.resources[res]), `${e.id}/${i}: ${res}`).toBe(need);
        }
        const gold = cost.gold ?? 0;
        if (gold > 0) expect(Math.round(before.gold - s.gold)).toBe(gold);
      }
    }
  });

  it('не хватило — вариант не нажимается, и склад не трогают', () => {
    for (const e of EVENTS) {
      for (const [i, o] of e.options.entries()) {
        const s = broke();
        if (!paid(o, rich())) continue;
        // Цена считается от размера посёлка, а он тот же: на пустом складе
        // проситься она будет ровно так же, только платить нечем.
        if (!paid(o, s)) continue;
        expect(eventBlock(o, s), `${e.id}/${i}`).not.toBeNull();
        s.inbox = [{ defId: e.id, at: s.time }];
        const r = resolveEvent(s, i);
        expect(r.error, `${e.id}/${i}`).not.toBeNull();
        // Событие осталось на экране, ничего не случилось и не списалось.
        expect(s.inbox).not.toEqual([]);
        for (const res of RESOURCE_IDS) expect(s.resources[res]).toBe(0);
        expect(s.gold).toBe(0);
      }
    }
  });

  it('подпись варианта не переписывает цену словами', () => {
    const s = rich();
    // Слова, какими в подписях назывались списываемые ресурсы. Мораль и
    // престиж сюда не входят — их не платят со склада, и минус у них свой.
    const words = /−\s*\d+\s*(ед|древес|камн|шкур|кост|мед|желез|золот)/i;
    for (const e of EVENTS) {
      for (const o of e.options) {
        const hint = optionHint(o, s) ?? '';
        // Цену показывает `Cost` — значком и вместе с запасом. Написанная
        // второй раз словами, она разойдётся с числом при первой же правке.
        expect(hint, `${e.id}: «${hint}»`).not.toMatch(words);
      }
    }
  });

  it('цена растёт вместе с посёлком, как и всё остальное в событии', () => {
    const small = rich();
    small.pop = 30;
    const big = rich();
    big.pop = 600;
    let seen = 0;
    for (const e of EVENTS) {
      for (const o of e.options) {
        if (!paid(o, small)) continue;
        const a = Object.values(eventCost(o, small)).reduce<number>((n, v) => n + (v ?? 0), 0);
        const b = Object.values(eventCost(o, big)).reduce<number>((n, v) => n + (v ?? 0), 0);
        expect(b, e.id).toBeGreaterThan(a);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(5);
  });
});

/**
 * Числа морали событий — одним числом на подпись и на исход (`EVENT_MORALE`, правило 18; docs/ui_audit.md, 14.4, вопрос 4).
 * Область, где правило спрашивается: мораль не у края шкалы — при 50 ни один сдвиг не упирается в 0 или 100, и сдвиг
 * читается целиком; это утверждается в самом тесте.
 */
describe('мораль событий: подпись называет то же число, что сдвигает исход', () => {
  const option = (event: string, label: string): EventOption => {
    const o = EVENTS.find((e) => e.id === event)?.options.find((x) => x.label === label);
    if (!o) throw new Error(`${event}: нет ответа «${label}»`);
    return o;
  };
  const word = (d: number): string => `${d > 0 ? '+' : '−'}${Math.abs(d)}`;
  const shift = (s: GameState, o: EventOption): number => {
    s.morale = 50;
    o.apply(s);
    return s.morale - 50;
  };
  const inside = (d: number): void => expect(50 + d > 0 && 50 + d < 100, 'точка внутри шкалы').toBe(true);

  it('беженцы, раскол и мор при служителях — сдвиг ровно на число подписи', async () => {
    const { assignWorker } = await import('../sim/workers');
    const { housingCapacity, jobCounts } = await import('../derived');
    const cases: [string, string, number, (s: GameState) => void][] = [
      ['refugees', 'Затворить ворота', EVENT_MORALE.refugeesTurnedAway, () => {}],
      ['refugees', 'Впустить, сколько вместим', EVENT_MORALE.refugeesNoRoom, (s) => (s.pop = housingCapacity(s))],
      ['heresy_split', 'Разогнать силой', EVENT_MORALE.preacherForce, () => {}],
      ['heresy_split', 'Пусть говорят', EVENT_MORALE.preacherTalk, () => {}],
      [
        'sickness',
        'Позвать служителей',
        EVENT_MORALE.sicknessPriests,
        (s) => {
          const church = s.buildings.find((b) => b.type === 'church')!;
          assignWorker(s, church.id, 1);
          expect(jobCounts(s).priest, 'точка внутри области: служитель есть').toBeGreaterThan(0);
        },
      ],
    ];
    for (const [event, label, d, setup] of cases) {
      inside(d);
      const s = createInitialState(3);
      setup(s);
      const o = option(event, label);
      expect(optionHint(o, s), `${event} · ${label}`).toContain(word(d));
      expect(shift(s, o), `${event} · ${label}`).toBe(d);
    }
  });

  it('мор без присмотра: подпись называет число, и унёс он людей — мораль сдвинута на него же', () => {
    const o = option('sickness', 'Переждать');
    const d = EVENT_MORALE.sicknessNeglect;
    inside(d);
    let struck = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = createInitialState(seed);
      s.pop = 60;
      expect(optionHint(o, s)).toContain(word(d));
      const pop = s.pop;
      const got = shift(s, o);
      if (s.pop < pop) {
        struck++;
        expect(got, `сид ${seed}`).toBe(d);
      } else expect(got, `сид ${seed}: обошлось — мораль на месте`).toBe(0);
    }
    // Область: мор хоть раз прошёл — иначе сдвиг проверялся бы даром.
    expect(struck).toBeGreaterThan(0);
  });
});

/**
 * Весть — письмо от человека эпохи (docs/voice.md, 11): у каждой есть кто пишет, текст укладывается в меру словаря при
 * любой вере и на малом и большом городе, ответ — глагол в меру кнопки, и ни в тексте, ни в ответе, ни в исходе нет
 * запретных слов голоса. Исход читается на большом городе с полными закромами: там каждый ответ доступен.
 */
describe('вести голосом эпохи: кто пишет, мера и словарь', () => {
  const faiths = [null, 'catholic', 'orthodox', 'islam', 'pagan'] as const;
  const at = (faith: (typeof faiths)[number], pop: number): GameState => {
    const s = rich();
    s.faith.id = faith;
    s.pop = pop;
    return s;
  };

  it('у каждой вести есть кто пишет, и это человек, а не «город»', () => {
    for (const e of EVENTS)
      for (const f of faiths) {
        const who = eventFrom(e, at(f, 200));
        expect(who.length, e.id).toBeGreaterThan(2);
        expect(who.length, e.id).toBeLessThanOrEqual(22);
        expect(who, e.id).not.toMatch(/^(Город|Дозор)$/);
      }
  });

  it('текст ≤ 160 при любой вере и размере города, ответ ≤ 28 и без запретных слов', () => {
    let seen = 0;
    for (const e of EVENTS) {
      for (const f of faiths)
        for (const pop of [30, 600]) {
          const t = eventText(e, at(f, pop));
          expect(t.length, `${e.id}: «${t}»`).toBeLessThanOrEqual(160);
          for (const bad of BANNED) expect(t, `${e.id}: «${t}»`).not.toMatch(bad);
          seen++;
        }
      for (const o of e.options) {
        expect(o.label.length, `${e.id}: «${o.label}»`).toBeLessThanOrEqual(28);
        for (const bad of BANNED) expect(o.label, `${e.id}: «${o.label}»`).not.toMatch(bad);
      }
    }
    expect(seen).toBeGreaterThan(EVENTS.length * 5);
  });

  it('исход ответа — без запретных слов голоса', () => {
    let seen = 0;
    for (const e of EVENTS)
      for (let i = 0; i < e.options.length; i++) {
        const s = at('catholic', 200);
        const t = e.options[i].apply(s);
        for (const bad of BANNED) expect(t, `${e.id}/${i}: «${t}»`).not.toMatch(bad);
        seen++;
      }
    expect(seen).toBeGreaterThan(40);
  });
});
