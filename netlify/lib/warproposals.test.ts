// Предложения между игроками на сервере войны (ДП-1, docs/AGENTS.md, раздел 17): кто, кому, что, срок, ответ. Держит то,
// что ломалось молча: предложение видно адресату и ему есть чем ответить; отклонённое и просроченное уходит из ждущих и
// остаётся итогом у обеих сторон; весть ведёт к предложению; чужой и запоздалый ответ — отказ.
import { describe, expect, it } from 'vitest';
import { NOTICE_KINDS, readNotices, readWarOrder, type CastleClaim, type NoticeItem, type RosterFile } from './contract.js';
import { castleIdOf, emptyRoster, upsert } from './roster.js';
import { advance, applyOrder, emptyWars, newsDiff, newsMap, pacted, proposalsOf, readWars, type OrderCtx, type WarFile } from './war.js';
import { appAt, keyboard } from './telegram.js';
import { letterGo } from './deliver.js';
import { noticeText } from './words.js';
import { PROPOSALS, answerBlock, endWords } from '../../src/world/proposals.js';
import { PACT_BREAK_NOTICE } from '../../src/world/data/tuning.js';

const A = 'tg-2001';
const B = 'tg-2002';
const C = 'tg-2003';
const T0 = 1_900_000_000_000;
const TTL = PROPOSALS.pact.ttlMs;

const claim = (name: string): CastleClaim => ({ name, city: name, power: 5000, pop: 400 });

function setup(): { file: WarFile; ctx: OrderCtx & { flags: string[] } } {
  let roster: RosterFile = emptyRoster();
  roster = upsert(roster, A, claim('Альфа'), T0);
  roster = upsert(roster, B, claim('Бета'), T0);
  roster = upsert(roster, C, claim('Гамма'), T0);
  const flags: string[] = [];
  return { file: emptyWars(), ctx: { roster, sheet: () => null, forged: (text) => flags.push(text), flags } };
}

/** Альфа зовёт Бету в союз в минуту `T0`; номер предложения — из ответа сервера Бете. */
function offered() {
  const s = setup();
  expect(applyOrder(s.file, A, { op: 'pact', target: castleIdOf(B) }, T0, s.ctx)).toBeNull();
  const id = proposalsOf(s.file, B)[0].id;
  return { ...s, id };
}

const news = (before: ReturnType<typeof newsMap>, file: WarFile) => newsDiff(before, newsMap(file));

describe('ДП-1: предложение союза на сервере', () => {
  it('видно адресату: кто, что, срок; у предложившего — «ждём ответа»; весть адресату несёт номер', () => {
    const s = setup();
    const before = newsMap(s.file);
    expect(applyOrder(s.file, A, { op: 'pact', target: castleIdOf(B) }, T0, s.ctx)).toBeNull();
    const [inB] = proposalsOf(s.file, B);
    expect(inB).toMatchObject({ kind: 'pact', side: 'in', castle: castleIdOf(A), city: 'Альфа', at: T0, until: T0 + TTL });
    expect(inB.end).toBeUndefined();
    expect(proposalsOf(s.file, A)).toMatchObject([{ id: inB.id, side: 'out', castle: castleIdOf(B), city: 'Бета' }]);
    expect(proposalsOf(s.file, C), 'третьему — ничего').toEqual([]);
    const add = news(before, s.file).get(B)?.add ?? [];
    expect(add).toMatchObject([{ kind: 'war-pact', p: { pact: 'offer', from: 'Альфа', deal: inB.id } }]);
    expect(news(before, s.file).get(A), 'предложившему вести нет').toBeUndefined();
  });

  it('принять: адресат отвечает «да» до срока — союз заключён, предложение — итогом у обеих сторон', () => {
    const { file, ctx, id } = offered();
    const at = T0 + TTL / 2;
    expect(at, 'точка внутри срока ответа').toBeLessThan(proposalsOf(file, B)[0].until);
    const before = newsMap(file);
    expect(applyOrder(file, B, { op: 'deal', id, act: 'yes' }, at, ctx)).toBeNull();
    expect(pacted(file, A, B)).toBe(true);
    expect(proposalsOf(file, B)[0]).toMatchObject({ id, end: 'yes', endAt: at, endBy: 'us' });
    expect(proposalsOf(file, A)[0]).toMatchObject({ id, end: 'yes', endBy: 'them' });
    expect(news(before, file).get(A)?.add).toMatchObject([{ kind: 'war-pact', p: { pact: 'made', from: 'Бета' } }]);
  });

  it('отклонить: из ждущих уходит у обеих сторон, итог «отклонено» — обеим, весть — предложившему', () => {
    const { file, ctx, id } = offered();
    const at = T0 + 60_000;
    const before = newsMap(file);
    expect(applyOrder(file, B, { op: 'deal', id, act: 'no' }, at, ctx)).toBeNull();
    expect(pacted(file, A, B)).toBe(false);
    for (const k of [A, B]) {
      expect(proposalsOf(file, k).filter((p) => !p.end), `${k}: ждущих нет`).toEqual([]);
      expect(proposalsOf(file, k)[0]).toMatchObject({ id, end: 'no', endAt: at });
    }
    const told = news(before, file);
    expect(told.get(A)?.add).toMatchObject([{ kind: 'war-pact', p: { pact: 'no', from: 'Бета' } }]);
    expect(told.get(B)?.add ?? [], 'отклонившему — без вести: он сам ответил').toEqual([]);
    expect(told.get(B)?.drop, 'весть о предложении снята, если не ушла').toContain(`war-pact:${castleIdOf(A)}:${T0}`);
  });

  it('срок вышел: ход записи закрывает предложение — обеим итог «срок вышел» и весть обеим', () => {
    const { file, id } = offered();
    const until = proposalsOf(file, B)[0].until;
    expect(advance(file, until - 1, new Map()), 'до срока ничего').toBe(false);
    expect(proposalsOf(file, B)[0].end).toBeUndefined();
    const before = newsMap(file);
    expect(until + 1, 'точка за сроком').toBeGreaterThan(until);
    expect(advance(file, until + 1, new Map())).toBe(true);
    for (const k of [A, B]) {
      expect(proposalsOf(file, k).filter((p) => !p.end), `${k}: ждущих нет`).toEqual([]);
      expect(proposalsOf(file, k)[0]).toMatchObject({ id, end: 'expired', endAt: until });
      expect(proposalsOf(file, k)[0].endBy).toBeUndefined();
    }
    const told = news(before, file);
    expect(told.get(A)?.add).toMatchObject([{ p: { pact: 'expired', from: 'Бета', role: 'atk' } }]);
    expect(told.get(B)?.add).toMatchObject([{ p: { pact: 'expired', from: 'Альфа', role: 'def' } }]);
  });

  it('чужой ответ — отказ и флаг; предложивший не принимает своё; запоздалый и повторный — отказ словами', () => {
    const { file, ctx, id } = offered();
    expect(applyOrder(file, C, { op: 'deal', id, act: 'yes' }, T0 + 1, ctx)).toBe('Это предложение не вам.');
    expect(ctx.flags, 'чужой ответ — в журнал города').toHaveLength(1);
    expect(applyOrder(file, A, { op: 'deal', id, act: 'yes' }, T0 + 1, ctx)).toBe('Ответить может только тот, кому предложили.');
    expect(applyOrder(file, B, { op: 'deal', id, act: 'withdraw' }, T0 + 1, ctx)).toBe('Отозвать можно только своё предложение.');
    expect(applyOrder(file, B, { op: 'deal', id: 'нет.такого', act: 'yes' }, T0 + 1, ctx)).toBe('Такого предложения нет.');
    expect(pacted(file, A, B) || pacted(file, C, A), 'союза нет').toBe(false);
    expect(proposalsOf(file, B)[0].end, 'предложение ждёт').toBeUndefined();
    // Срок вышел — отказ, даже если ход записи ещё не закрыл предложение.
    const late = T0 + TTL;
    expect(applyOrder(file, B, { op: 'deal', id, act: 'yes' }, late, ctx)).toBe('Срок ответа вышел.');
    advance(file, late, new Map());
    expect(applyOrder(file, B, { op: 'deal', id, act: 'yes' }, late + 1, ctx)).toBe('Срок ответа вышел.');
    expect(pacted(file, A, B)).toBe(false);
  });

  it('отозвать своё — адресату итог и весть; ответить после — «уже ответили»', () => {
    const { file, ctx, id } = offered();
    const before = newsMap(file);
    expect(applyOrder(file, A, { op: 'deal', id, act: 'withdraw' }, T0 + 5, ctx)).toBeNull();
    expect(proposalsOf(file, B)[0]).toMatchObject({ id, end: 'withdrawn', endBy: 'them' });
    expect(news(before, file).get(B)?.add).toMatchObject([{ p: { pact: 'withdrawn', from: 'Альфа' } }]);
    expect(applyOrder(file, B, { op: 'deal', id, act: 'yes' }, T0 + 6, ctx)).toBe('На это предложение уже ответили.');
  });

  it('разрыв союза — итог обеим и весть той стороне, что не рвала', () => {
    const { file, ctx, id } = offered();
    expect(applyOrder(file, B, { op: 'deal', id, act: 'yes' }, T0 + 1, ctx)).toBeNull();
    const before = newsMap(file);
    expect(applyOrder(file, A, { op: 'unpact', target: castleIdOf(B) }, T0 + 2, ctx)).toBeNull();
    // Разрыв — с отсрочкой (АУ-8, п. 1, pactnotice.test.ts): пакт держится до `PACT_BREAK_NOTICE`.
    expect(pacted(file, A, B, T0 + 2)).toBe(true);
    expect(pacted(file, A, B, T0 + 2 + PACT_BREAK_NOTICE)).toBe(false);
    expect(proposalsOf(file, A)[0]).toMatchObject({ end: 'broken', endBy: 'us', city: 'Бета' });
    expect(proposalsOf(file, B)[0]).toMatchObject({ end: 'broken', endBy: 'them', city: 'Альфа' });
    expect(news(before, file).get(B)?.add).toMatchObject([{ p: { pact: 'broken', from: 'Альфа' } }]);
    expect(news(before, file).get(A)?.add ?? [], 'разорвавшему — без вести').toEqual([]);
  });

  it('запись старше ДП-1 читается: номер и срок выводятся, ответ по номеру работает', () => {
    const s = setup();
    const file = readWars({ v: 1, seq: 0, wars: [], offers: [{ from: A, to: B, at: T0, cities: { [A]: 'Альфа', [B]: 'Бета' } }] });
    const [p] = proposalsOf(file, B);
    expect(p).toMatchObject({ kind: 'pact', until: T0 + TTL, side: 'in' });
    expect(applyOrder(file, B, { op: 'deal', id: p.id, act: 'yes' }, T0 + 1, s.ctx)).toBeNull();
    expect(pacted(file, A, B)).toBe(true);
    // Перечитанная запись — те же предложения и итоги.
    expect(proposalsOf(readWars(JSON.parse(JSON.stringify(file))), B)).toEqual(proposalsOf(file, B));
  });

  it('приказ `deal` разбирается договором; лишнее действие — нет', () => {
    expect(readWarOrder({ op: 'deal', id: 'c1.x', act: 'no' })).toEqual({ op: 'deal', id: 'c1.x', act: 'no' });
    expect(readWarOrder({ op: 'deal', id: 'c1.x', act: 'maybe' })).toBeNull();
    expect(readWarOrder({ op: 'deal', act: 'yes' })).toBeNull();
  });

  it('кнопка «Открыть игру» под вестью о предложении ведёт к нему; номер переживает своё хранилище', () => {
    const { file } = offered();
    const [item] = news(new Map(), file).get(B)?.add ?? [];
    const kept = readNotices([item], T0, NOTICE_KINDS)?.[0] as NoticeItem;
    expect(kept.p.deal, 'номер — в записи исходящих').toBe(item.p.deal);
    const go = letterGo({ items: [kept] });
    expect(go).toBe(`deal-${item.p.deal}`);
    const url = (keyboard(appAt('https://game.example', go)).inline_keyboard[0][0] as { web_app: { url: string } }).web_app.url;
    expect(url).toBe(`https://game.example?go=${encodeURIComponent(`deal-${item.p.deal}`)}`);
    expect(letterGo({ items: [{ ...kept, p: { ...kept.p, pact: 'made' } }] }), 'итог ведёт в игру как обычно').toBeUndefined();
  });

  it('слова вестей: что даёт союз и срок — из таблицы видов, у каждого итога свои', () => {
    const base: NoticeItem = { key: 'war-pact:c:1', kind: 'war-pact', fireAt: T0, until: T0 + 1, p: { from: 'Альфа', fate: 'plunder', about: T0, pact: 'offer' } };
    const text = (over: Partial<NoticeItem['p']>) => noticeText({ ...base, p: { ...base.p, ...over } }, 'Europe/Moscow');
    expect(text({})).toContain(PROPOSALS.pact.gives);
    expect(text({})).toContain('сутки');
    expect(text({ pact: 'no' })).toBe('«Альфа» отклонил наше предложение союза.');
    expect(text({ pact: 'expired', role: 'atk' })).toContain('не ответил');
    expect(text({ pact: 'expired', role: 'def' })).toContain('осталось без ответа');
    expect(text({ pact: 'broken' })).toContain('разорвал союз');
    expect(text({ pact: 'withdrawn' })).toContain('отозвал');
  });

  it('проверка ответа одна: кнопка гаснет тем же словом, что откажет сервер', () => {
    const p = { side: 'in' as const, until: T0 + TTL };
    expect(answerBlock(p, 'yes', T0)).toBeNull();
    expect(answerBlock(p, 'yes', T0 + TTL)).toBe('Срок ответа вышел.');
    expect(answerBlock({ ...p, end: 'no' as const }, 'yes', T0)).toBe('На это предложение уже ответили.');
    expect(endWords({ kind: 'pact', side: 'out', city: 'Бета', end: 'no', endBy: 'them' })).toBe('«Бета» отклонил наше предложение союза.');
  });
});
