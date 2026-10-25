// АУ-8, п. 1 (OWNER-DECISIONS п. 11, решение владельца 26.10.2026): пакт между двумя игроками на сервере войны рвётся не
// сразу, а через `PACT_BREAK_NOTICE` (12 настоящих часов), как у соседей-ботов в мире. Пока идёт отсчёт, пакт действует —
// выручка в силе, походом не пойти, — и обе стороны видят отсчёт; приказ войны по пакту в отсчёте — отказ.
import { describe, expect, it } from 'vitest';
import { type CastleClaim, type RosterFile, type WarArmy, type WarSheet } from './contract.js';
import { castleIdOf, emptyRoster, upsert } from './roster.js';
import { advance, applyOrder, emptyWars, newsDiff, newsMap, pacted, pactsOf, proposalsOf, readWars, type SheetAt, type WarFile } from './war.js';
import { noticeText } from './words.js';
import { PACT_BREAK_NOTICE } from '../../src/world/data/tuning.js';
import { endWords, pactWarBlock } from '../../src/world/proposals.js';
import { realSpan } from '../../src/game/span.js';

const A = 'tg-2001';
const B = 'tg-2002';
const T0 = 1_900_000_000_000;

const claim = (name: string): CastleClaim => ({ name, city: name, power: 5000, pop: 400 });

const sheet = (): WarSheet => ({
  army: { spearman: 60, archer: 30, swordsman: 30 },
  home: { spearman: 40, archer: 20 },
  militia: 20,
  archers: 6,
  resolve: 0,
  pips: {},
  rest: 1,
  food: 2000,
  townPerHour: 20,
  perManPerHour: 1,
  stock: { food: 2000, wood: 3000, stone: 1000 },
  stash: 100,
  gold: 400,
  pop: 400,
  bonded: 20,
  levels: { farm: 4, palisade: 1 },
  power: 5000,
  locks: {},
  seen: [],
});

function pactedPair() {
  let roster: RosterFile = emptyRoster();
  roster = upsert(roster, A, claim('Альфа'), T0);
  roster = upsert(roster, B, claim('Бета'), T0);
  const sheets = new Map<string, SheetAt>([
    [A, { sheet: sheet(), at: T0 }],
    [B, { sheet: sheet(), at: T0 }],
  ]);
  const ctx = { roster, sheet: (k: string) => sheets.get(k) ?? null };
  const file = emptyWars() as WarFile;
  expect(applyOrder(file, A, { op: 'pact', target: castleIdOf(B) }, T0, ctx)).toBeNull();
  expect(applyOrder(file, B, { op: 'pact', target: castleIdOf(A) }, T0 + 1, ctx)).toBeNull();
  expect(pacted(file, A, B)).toBe(true);
  return { file, ctx, sheets };
}

const army: WarArmy = { troops: { spearman: 10 }, resolve: 0, pips: {} };
const marchOn = (target: string) => ({ op: 'march' as const, target: castleIdOf(target), mode: 'siege' as const, fate: 'plunder' as const, army });

describe('АУ-8 п. 1: разрыв пакта между игроками — с отсрочкой', () => {
  it('разрыв объявлен — пакт держится PACT_BREAK_NOTICE, обе стороны видят отсчёт, поход в отсчёте — отказ', () => {
    const { file, ctx, sheets } = pactedPair();
    const t1 = T0 + 60_000;
    const breakAt = t1 + PACT_BREAK_NOTICE;
    expect(PACT_BREAK_NOTICE, 'отсрочка — 12 настоящих часов').toBe(12 * 3600_000);
    const before = newsMap(file);
    expect(applyOrder(file, A, { op: 'unpact', target: castleIdOf(B) }, t1, ctx)).toBeNull();
    // Точка внутри области правила: отсчёт идёт.
    const mid = t1 + PACT_BREAK_NOTICE / 2;
    expect(mid, 'точка внутри отсчёта').toBeLessThan(breakAt);
    advance(file, mid, sheets);
    expect(pacted(file, A, B), 'пакт действует, пока идёт отсчёт').toBe(true);
    expect(pactsOf(file, A)).toEqual([expect.objectContaining({ castle: castleIdOf(B), state: 'pact', breakAt })]);
    expect(pactsOf(file, B)).toEqual([expect.objectContaining({ castle: castleIdOf(A), state: 'pact', breakAt })]);
    const block = pactWarBlock({ state: 'pact', breakAt }, mid);
    expect(block).toBe(`Разрыв пакта объявлен: походом можно будет через ${realSpan((breakAt - mid) / 1000)}.`);
    expect(applyOrder(file, B, marchOn(A), mid, ctx), 'тот, с кем рвут, походом не идёт').toBe(block);
    expect(applyOrder(file, A, marchOn(B), mid, ctx), 'и тот, кто рвёт').toBe(block);
    expect(applyOrder(file, A, { op: 'unpact', target: castleIdOf(B) }, mid, ctx)).toBe(
      `Разрыв уже объявлен: пакт кончится через ${realSpan((breakAt - mid) / 1000)}.`,
    );
    // Весть — сразу, со сроком; «Вести» обеих сторон — итог «разрыв» с минутой конца пакта.
    const told = newsDiff(before, newsMap(file));
    const [item] = told.get(B)?.add ?? [];
    expect(item).toMatchObject({ kind: 'war-pact', fireAt: t1, p: { pact: 'broken', from: 'Альфа', about: breakAt } });
    expect(told.get(A)?.add ?? [], 'разорвавшему — без вести').toEqual([]);
    expect(noticeText(item, 'UTC')).toContain('до ');
    expect(noticeText(item, 'UTC')).toContain('объявил разрыв');
    const [pa] = proposalsOf(file, A);
    const [pb] = proposalsOf(file, B);
    expect(pa).toMatchObject({ end: 'broken', endBy: 'us', endAt: t1, until: breakAt });
    expect(pb).toMatchObject({ end: 'broken', endBy: 'them', endAt: t1, until: breakAt });
    expect(endWords(pb)).toBe(`«Альфа» объявил разрыв союза с нами. Союз держится ещё ${realSpan(PACT_BREAK_NOTICE / 1000)}: потом он сможет пойти на нас походом, а на выручку не придёт.`);
    expect(endWords(pa)).toBe(`Мы объявили разрыв союза с «Бета». Союз держится ещё ${realSpan(PACT_BREAK_NOTICE / 1000)}: потом ни выручки, ни запрета на поход.`);
    // Отсчёт кончился — пакта нет, поход по пакту больше не отказ.
    advance(file, breakAt, sheets);
    expect(pacted(file, A, B), 'отсчёт кончился — пакта нет').toBe(false);
    expect(pactsOf(file, A)).toEqual([]);
    expect(applyOrder(file, B, marchOn(A), breakAt + 1, ctx)).toBeNull();
  });

  it('запись старше отсрочки: пакт без breakAt — пакт, как был; отсрочка переживает перечитывание записи', () => {
    const { file, ctx } = pactedPair();
    const old = readWars(JSON.parse(JSON.stringify(file)));
    expect(old.pacts?.[0].breakAt).toBeUndefined();
    expect(pacted(old, A, B)).toBe(true);
    expect(pactsOf(old, A)[0].breakAt).toBeUndefined();
    expect(pactWarBlock(pactsOf(old, A)[0], T0 + 2)).toBe('С этим городом у нас пакт. Сначала разорви его.');
    expect(applyOrder(old, B, { op: 'unpact', target: castleIdOf(A) }, T0 + 5, ctx)).toBeNull();
    const back = readWars(JSON.parse(JSON.stringify(old)));
    expect(back.pacts?.[0]).toMatchObject({ breakAt: T0 + 5 + PACT_BREAK_NOTICE, breakBy: B });
    expect(pactsOf(back, A)[0].breakAt).toBe(T0 + 5 + PACT_BREAK_NOTICE);
    // Итог «разорван» старой записи (until = endAt) — прежние слова.
    expect(endWords({ kind: 'pact', side: 'in', city: 'Альфа', end: 'broken', endBy: 'them', until: T0, endAt: T0 })).toBe('«Альфа» разорвал союз с нами.');
  });
});
