import { describe, expect, it } from 'vitest';
import { summarize } from '@/battle';
import { simulateBattle } from '@/battle/sim';
import { deploySetup } from '@/battle/setup';
import { beastSummary } from '@/game/battle/beasts';
import { num } from '@/game/num';
import { CITY_MAX } from '../../../netlify/lib/contract';
import { STORY_TEXT_MAX } from '@/telegram/webapp';
import type { Report } from '@/world/types';
import type { RatingRow } from '@/net/rating';
import { battleCard, cityCard, isTakenCity, ratingCard, reportCard } from './shareCard';

/**
 * Карточка «Поделиться» (docs/feed.md, раздел 3): числа — из тех же функций, что донесение (правило 18), взятый город
 * узнаётся по донесению войны, текст влезает в подпись истории даже с самыми длинными именами.
 */
const result = simulateBattle({
  seed: 7,
  attacker: deploySetup({ spear: 30, infantry: 30, archer: 10, cavalry: 0 }),
  defender: deploySetup({ spear: 10, infantry: 10, archer: 5, cavalry: 0 }),
});
const A = result.sides.attacker.total;
const D = result.sides.defender.total;

const report = (over: Partial<Report> = {}): Report =>
  ({
    id: 'war-w1.0',
    at: 0,
    kind: 'raid',
    title: 'Штурм удался: Энна',
    target: { id: 'c1', name: 'Энна', x: 1, y: 1 },
    won: true,
    sent: {},
    lost: {},
    enemyPower: null,
    enemyLost: null,
    loot: null,
    intel: null,
    battle: { us: 'attacker', result },
    text: '',
    read: false,
    ...over,
  }) as Report;

describe('карточка «Поделиться»', () => {
  it('итог боя — числа донесения: исход и потери сторон из журнала', () => {
    const r = report();
    const sum = beastSummary(summarize(r.battle!.result, 'attacker'), undefined, 'attacker');
    const c = battleCard(r, 'Катания')!;
    expect(c.head.toUpperCase()).toBe(sum.title);
    expect(c.rows).toEqual([
      { label: 'Наши потери', value: `${num(A.losses)} из ${num(A.initial)}` },
      { label: 'Потери врага', value: `${num(D.losses)} из ${num(D.initial)}` },
    ]);
    expect(c.text).toContain('«Катания» и «Энна»');
  });

  it('без журнала боя — карточки боя нет', () => {
    expect(battleCard(report({ battle: null }), 'Катания')).toBeNull();
  });

  it('взятый город — только донесение о падении в войне, и оно важнее боя', () => {
    const fall = report({ id: 'war-w1-fall', battle: null, led: 12 });
    expect(isTakenCity(fall)).toBe(true);
    expect(isTakenCity(report())).toBe(false);
    expect(isTakenCity({ ...fall, won: false })).toBe(false);
    const c = reportCard(fall, 'Катания', 'Андрей')!;
    expect(c.kind).toBe('city');
    expect(c.rows.map((x) => x.label)).toEqual(['Взял', 'Уведено']);
    expect(cityCard(report(), 'Катания', 'Андрей')).toBeNull();
  });

  it('место в рейтинге — числа строки сервера', () => {
    const row = { place: 2, id: 'c', x: 0, y: 0, city: 'Катания', name: 'Андрей', points: 1240, power: 240, pop: 50, won: 1, taken: 0 } as RatingRow;
    const c = ratingCard(row);
    expect(c.head).toBe('2-е место');
    expect(c.text).toBe(`«Катания» на 2-м месте в рейтинге TRIBE: ${num(1240)} очков.`);
  });

  it('текст влезает в подпись истории с самыми длинными именами', () => {
    const long = 'Щ'.repeat(CITY_MAX);
    const texts = [
      battleCard(report({ target: { id: 'c', name: long, x: 0, y: 0 } }), long)!.text,
      cityCard(report({ id: 'war-x-fall', target: { id: 'c', name: long, x: 0, y: 0 }, led: 999 }), long, 'Ж'.repeat(24))!.text,
      ratingCard({ place: 999, id: 'c', x: 0, y: 0, city: long, name: '', points: 1e7, power: 0, pop: 0, won: 0, taken: 0 }).text,
    ];
    for (const t of texts) expect(t.length).toBeLessThanOrEqual(STORY_TEXT_MAX);
  });
});
