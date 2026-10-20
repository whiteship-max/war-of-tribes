// «Вести» (UI-7, docs/ui_v2.md, 5.6): фильтры по источнику — все, город, соседи — со счётчиком новых; внутри группы «Беда» и
// «Ждут ответа» таблицами; беда — признак самого донесения (`dispatch.urgent`), а не экрана; весть набега ведёт в
// «Дружину», где с UI-4 гарнизон и отряд полководца. Лента края на карте больше не зовётся «вестями» (Д9).
//
// Области (правило 11): стол с вестями города и письмами мира разом, среди них беда каждого источника (набег — письмо,
// мятеж — событие) и простая весть каждого.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { GameState } from '@/game/types';
import type { LetterView } from '@/world/types';
import { createInitialState } from '@/game/state';
import { raiseEvent } from '@/game/sim/mail';
import { EVENT_BY_ID } from '@/game/data/events';
import { dispatches, filterMail, mailGroups, type Dispatch } from './dispatch';

const NOW = 1_900_000_000_000;

const { stores, fake } = vi.hoisted(() => ({
  stores: { game: {} as Record<string, unknown>, world: {} as Record<string, unknown> },
  fake: <T extends object>(real: T, view: () => Record<string, unknown>): T => Object.assign((sel: (g: unknown) => unknown) => sel(view()), real),
}));
vi.mock('@/game/store', async (orig) => {
  const real = await orig<{ useGame: object }>();
  return { ...real, useGame: fake(real.useGame, () => stores.game) };
});
vi.mock('@/world/store', async (orig) => {
  const real = await orig<{ useWorld: object }>();
  return { ...real, useWorld: fake(real.useWorld, () => stores.world), worldNow: () => 1_900_000_000_000 };
});

import { Mail } from './Mail';

const letter = (id: string, kind: LetterView['kind'], choices: LetterView['choices'], mins: number): LetterView => ({
  id,
  kind,
  at: NOW,
  until: NOW + mins * 60_000,
  fromId: `l-${id}`,
  fromName: 'Волчья падь',
  cost: {},
  title: kind === 'raid' ? 'Набег' : 'Дань',
  body: '…',
  from: null,
  choices,
  seconds: mins * 60,
  silence: 'Без ответа: так.',
});
const YES_NO: LetterView['choices'] = [
  { id: 'yes', label: 'Да', hint: 'да', can: true, reason: null },
  { id: 'no', label: 'Нет', hint: 'нет', can: true, reason: null },
];

/** Стол: беженцы и мятеж — вести города; дань и набег — письма мира. */
function table(): { s: GameState; letters: LetterView[]; list: Dispatch[] } {
  const s = createInitialState(7);
  for (const id of ['refugees', 'mutiny']) raiseEvent(s, id);
  const letters = [letter('t1', 'tribute', YES_NO, 90), letter('r1', 'raid', [], 25)];
  return { s, letters, list: dispatches(s, letters, { tribe: s.time, world: NOW }) };
}

describe('беда — признак донесения', () => {
  it('набег и предупреждение без выбора — беда, дань — нет; у вестей города беда — событие со своим словом о сроке (мятеж)', () => {
    const { list } = table();
    const by = new Map(list.map((d) => [d.title, d]));
    // Область: на столе беда и не беда у каждого источника.
    expect(EVENT_BY_ID.mutiny?.waits, 'мятеж говорит о сроке своим словом').toBeTruthy();
    expect(EVENT_BY_ID.refugees?.waits).toBeUndefined();
    expect(list.map((d) => d.source).sort()).toEqual(['event', 'event', 'letter', 'letter']);
    expect(by.get('Набег')!.urgent).toBe(true);
    expect(by.get('Дань')!.urgent).toBe(false);
    expect(list.find((d) => d.eventId?.startsWith('mutiny'))!.urgent).toBe(true);
    expect(list.find((d) => d.eventId?.startsWith('refugees'))!.urgent).toBe(false);
  });
});

describe('фильтры и группы', () => {
  it('фильтр — по источнику; группы — «Беда», потом «Ждут ответа»; пустой группы нет', () => {
    const { list } = table();
    expect(filterMail(list, 'all')).toHaveLength(4);
    expect(filterMail(list, 'event').every((d) => d.source === 'event')).toBe(true);
    expect(filterMail(list, 'letter').every((d) => d.source === 'letter')).toBe(true);
    const groups = mailGroups(list);
    expect(groups.map((g) => g.title)).toEqual(['Беда', 'Ждут ответа']);
    expect(groups[0].items.every((d) => d.urgent) && groups[1].items.every((d) => !d.urgent)).toBe(true);
    expect(mailGroups(list.filter((d) => !d.urgent)).map((g) => g.title)).toEqual(['Ждут ответа']);
  });

  it('окно: три вкладки почты со счётчиком новых и «Летопись», вести — строками таблиц с дверью; прежней ленты нет', () => {
    const { s, letters } = table();
    stores.game = { s, resolve: () => null, openMap: () => {} };
    stores.world = { letters, rivals: { proposals: [], marching: [] }, marches: [], info: null, answerLetter: async () => null, spotLetter: () => {} };
    const html = renderToStaticMarkup(h(Mail));
    const tabs = [...html.matchAll(/role="tab"[^>]*>(?:<[^>]+>)*([^<]+)<\/span>(?:<em class="kit-badge">(\d+)<\/em>)?/g)].map((m) => [m[1], m[2] ?? '0']);
    expect(tabs).toEqual([
      ['Все', '4'],
      ['Город', '2'],
      ['Соседи', '2'],
      ['Летопись', '0'],
    ]);
    expect(html.match(/class="kit-go"/g)?.length, 'у каждой вести — дверь').toBe(4);
    // ВС-2: строка вести целиком — кнопка: заголовок и срок внутри той же кнопки, что и «›» (отзыв тестера).
    const rows = html.match(/<button type="button" class="kit-tgo"[\s\S]*?<\/button>/g) ?? [];
    expect(rows, 'вести — строками-кнопками').toHaveLength(4);
    for (const title of ['Набег', 'Дань']) expect(rows.some((r) => r.includes(title) && r.includes('class="kit-go"')), title).toBe(true);
    expect(html.indexOf('Беда')).toBeLessThan(html.indexOf('Ждут ответа'));
    expect(html).not.toContain('mail-row');
  });
});

describe('весть набега и слово «вести»', () => {
  const read = (rel: string): string => readFileSync(join(__dirname, '..', '..', rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('«Дружина» ведёт в окно дружины — там гарнизон и отряд полководца; Статуи в вести нет', () => {
    const mail = read('ui/realm/Mail.tsx');
    expect(mail).toContain('goTo(WINDOW.army)');
    expect(mail).not.toMatch(/statue/);
  });

  it('лента края на карте — «Молва края», не «вести»: слово отдано почте державы (Д9)', () => {
    for (const f of ['ui/map/Feed.tsx', 'ui/map/WorldMap.tsx', 'net/feed.ts']) {
      expect(read(f), f).not.toContain('Вести края');
    }
    expect(read('ui/map/Feed.tsx')).toContain('Молва края');
  });
});
