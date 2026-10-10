import { describe, expect, it } from 'vitest';
import { FEED_KINDS, type FeedItem } from '../../../netlify/lib/contract';
import { realSpan } from '@/game/span';
import { agoText, feedWords } from './feedWords';

/** Вести края словами (docs/feed.md): у каждого вида — заголовок, строка и значок; срок — функцией сроков. */
const H = 3600_000;
const item = (over: Partial<FeedItem>): FeedItem => ({
  id: 'x',
  kind: 'fell',
  at: 0,
  x: 1,
  y: 1,
  city: 'Энна',
  byCity: 'Катания',
  byRuler: 'Андрей',
  ...over,
});

describe('вести края словами', () => {
  it('каждый вид говорит заголовком и строкой, строка — не длиннее текста вести (160)', () => {
    for (const kind of FEED_KINDS) {
      const w = feedWords(item({ kind, how: kind === 'spy' ? 'theft' : undefined, ruler: 'Олег' }));
      expect(w.title.length, kind).toBeGreaterThan(0);
      expect(w.line.length, kind).toBeGreaterThan(0);
      expect(w.line.length, kind).toBeLessThanOrEqual(160);
      expect(w.icon.name, kind).toMatch(/^[a-z]+-[a-z_]+$/);
    }
  });

  it('срок осады и «давно ли» — функцией сроков', () => {
    const w = feedWords(item({ how: 'hunger', siegeMs: 3 * 24 * H + 5 * H }));
    expect(w.line).toContain(`после ${realSpan(3 * 86_400)} осады`);
    expect(agoText(30_000)).toBe('только что');
    expect(agoText(90 * 60_000)).toBe(`${realSpan(3600)} назад`);
    expect(agoText(12 * 60_000 + 5_000)).toBe(`${realSpan(12 * 60)} назад`);
  });

  it('удавшееся тайное дело не называет нападающего, пойманный лазутчик — называет', () => {
    const secret = feedWords(item({ kind: 'spy', how: 'fire', byCity: undefined, byRuler: undefined }));
    expect(`${secret.title} ${secret.line}`).not.toMatch(/Катания|Андрей/);
    const caught = feedWords(item({ kind: 'caught', how: 'held' }));
    expect(caught.line).toBe('Его послали из города Катания, правитель Андрей.');
  });
});
