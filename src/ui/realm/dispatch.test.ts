import { describe, expect, it } from 'vitest';
import { createInitialState } from '@/game/state';
import { EVENT_BY_ID } from '@/game/data/events';
import { EVENT_TTL } from '@/game/sim/mail';
import type { LetterView } from '@/world/types';
import { dispatches, eventDispatch, leftWords } from './dispatch';

const NOW = 1_900_000_000_000;

const raid = (until: number): LetterView =>
  ({
    id: 'L1',
    kind: 'raid',
    at: NOW,
    until,
    fromId: 'x',
    fromName: 'Логово разбойников',
    cost: {},
    title: 'На нас идут',
    icon: '🔥',
    body: 'Отряд вышел.',
    from: null,
    choices: [],
    seconds: 999,
    silence: 'Отряд дойдёт и ударит.',
  }) as LetterView;

describe('донесение — один вид для события и письма', () => {
  it('молчание события называет его собственный вариант молчания', () => {
    const s = createInitialState();
    for (const id of ['refugees', 'fire', 'sickness']) {
      const def = EVENT_BY_ID[id];
      s.activeEvent = { defId: id, at: 1, until: NOW + EVENT_TTL };
      const d = eventDispatch(s, NOW)!;
      expect(d.silence, id).toContain(def.options[def.silence].label);
      expect(d.choices.map((c) => c.label)).toEqual(def.options.map((o) => o.label));
    }
  });

  it('молчание письма — слова мира, без перевода', () => {
    const s = createInitialState();
    const [d] = dispatches(s, [raid(NOW + 60_000)], { tribe: NOW, world: NOW });
    expect(d.silence).toBe('Отряд дойдёт и ударит.');
    expect(d.warning).toBe(true);
    // Срок — от `until` по часам мира, а не снятое в минуту чтения `seconds`.
    expect(d.left).toBe(60);
  });

  it('первым лежит то, что раньше разрешится само, — у кого срок ближе', () => {
    const s = createInitialState();
    s.activeEvent = { defId: 'storm', at: 1, until: NOW + EVENT_TTL };
    const list = dispatches(s, [raid(NOW + 5 * 60_000)], { tribe: NOW, world: NOW });
    expect(list.map((d) => d.source)).toEqual(['letter', 'event']);
    const later = dispatches(s, [raid(NOW + 2 * EVENT_TTL)], { tribe: NOW, world: NOW });
    expect(later.map((d) => d.source)).toEqual(['event', 'letter']);
  });

  it('срок словами: часы с минутами, потом минуты с секундами', () => {
    expect(leftWords(EVENT_TTL / 1000)).toBe('24 ч 00 мин');
    expect(leftWords(45)).toBe('0:45');
  });
});
