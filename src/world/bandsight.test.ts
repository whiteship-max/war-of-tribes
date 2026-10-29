// Чужие отряды глазами игрока (ПН-4у, docs/gdd/path_of_sword.md, 3.5.4 и «Решения ПН-4у»): обнаруженный — живьём, потерянный — следом
// с давностью (правило снимка `Sighting`), давний след уходит; весть «Нас видели» — без спама; строка шапки «скрыт / виден»; без
// сервера отряд считает «кто видит» сам — той же дверью, что сервер.
//
// Граница области — утверждениями (правило 11): след ровно на сроке ещё живёт, за сроком — нет; весть второй раз — внутри тишины,
// третий — за ней.
import { describe, expect, it, vi } from 'vitest';
import type { BandView, CastleView, RosterFile, SeenView } from '../../netlify/lib/contract';

const CASTLES: CastleView[] = [];
vi.mock('@/net/roster', () => ({ castles: () => CASTLES, provideSightSink: () => undefined }));

const { NOTE_GAP_MS, NOTE_SAME_MS, TRAIL_MAX, TRAIL_MS, mergeMarks, noteSeen, ownSight, seenWords } = await import('./bandsight');
const { createInitialState } = await import('@/game/state');
const { roamSeat } = await import('./roam');
const { bandLook, conspicuity, detectRange, CASTLE_EYE } = await import('./sight');
const { seenOf } = await import('../../netlify/lib/bandsight');

const T = 1_900_000_000_000;
const view = (id: string, over: Partial<BandView> = {}): BandView => ({ id, name: `Герой ${id}`, prestige: 1, men: 12, at: { x: 10, y: 20 }, ...over });

describe('живые и следы — правилом снимка', () => {
  it('обнаруженный — живьём; пропал из обзора — след с последним местом и давностью', () => {
    const a = mergeMarks([], { bands: [view('a')], at: T });
    expect(a).toEqual([{ ...view('a'), visible: true, seenAt: T, stale: false }]);
    const b = mergeMarks(a, { bands: [], at: T + 60_000 });
    expect(b).toEqual([{ ...view('a'), visible: false, seenAt: T, stale: true }]);
    // Снова в обзоре — снова живой, на новом месте.
    const c = mergeMarks(b, { bands: [view('a', { at: { x: 11, y: 20 } })], at: T + 120_000 });
    expect(c).toEqual([{ ...view('a', { at: { x: 11, y: 20 } }), visible: true, seenAt: T + 120_000, stale: false }]);
  });

  it('след живёт до срока: ровно на сроке — есть, за сроком — нет', () => {
    const trail = mergeMarks(mergeMarks([], { bands: [view('a')], at: T }), { bands: [], at: T + 1 });
    expect(mergeMarks(trail, { bands: [], at: T + TRAIL_MS })).toHaveLength(1);
    expect(mergeMarks(trail, { bands: [], at: T + TRAIL_MS + 1 })).toHaveLength(0);
  });

  it('следов не больше потолка: свежие вытесняют давние', () => {
    let marks = mergeMarks([], { bands: [], at: T });
    for (let i = 0; i < TRAIL_MAX + 5; i++) {
      marks = mergeMarks(marks, { bands: [view(`b${i}`)], at: T + i * 1000 });
      marks = mergeMarks(marks, { bands: [], at: T + i * 1000 + 500 });
    }
    expect(marks).toHaveLength(TRAIL_MAX);
    expect(marks[0].id).toBe(`b${TRAIL_MAX + 4}`);
    expect(marks.some((m) => m.id === 'b0')).toBe(false);
  });
});

describe('строка шапки «скрыт / виден»', () => {
  it('никто не видит — «Скрыт»; видят — кем, если мы их видим, и сколько ещё без имени', () => {
    expect(seenWords({ count: 0, by: [] })).toBe('Скрыт');
    expect(seenWords({ count: 1, by: [{ kind: 'castle', id: 'c1', name: 'Андрей', city: 'Катания' }] })).toBe('Виден: город Катания (вождь Андрей)');
    expect(seenWords({ count: 3, by: [{ kind: 'band', id: 'b1', name: 'Ратко' }] })).toBe('Виден: отряд героя Ратко и ещё 2');
    expect(seenWords({ count: 1, by: [] })).toBe('Виден: кто — не разглядеть');
  });
});

describe('весть «Нас видели» — без спама', () => {
  const lord: SeenView = { count: 1, by: [{ kind: 'castle', id: 'c1', name: 'Андрей', city: 'Катания' }] };
  const both: SeenView = { count: 2, by: [...lord.by, { kind: 'band', id: 'b1', name: 'Ратко' }] };

  it('новые глаза — весть; тот же ответ — тишина; новый глаз внутри тишины — тишина, за ней — весть', () => {
    const mem = { last: 0, by: {} as Record<string, number> };
    expect(noteSeen(lord, null, T, mem)).toBe('Нас видели: город Катания (вождь Андрей).');
    expect(noteSeen(lord, lord, T + 60_000, mem)).toBeNull();
    // Новый глаз, но минута внутри общей тишины — весть не идёт (граница: правда внутри).
    expect(60_000).toBeLessThan(NOTE_GAP_MS);
    expect(noteSeen(both, lord, T + 60_000, mem)).toBeNull();
    expect(noteSeen(both, lord, T + NOTE_GAP_MS, mem)).toBe('Нас видели: отряд героя Ратко.');
  });

  it('тот же глаз после перезагрузки (прежнего ответа нет) — тишина до своего срока, потом снова весть', () => {
    const mem = { last: 0, by: {} as Record<string, number> };
    expect(noteSeen(lord, null, T, mem)).not.toBeNull();
    expect(NOTE_SAME_MS).toBeGreaterThan(NOTE_GAP_MS);
    expect(noteSeen(lord, null, T + NOTE_GAP_MS, mem), 'внутри срока того же глаза').toBeNull();
    expect(noteSeen(lord, null, T + NOTE_SAME_MS, mem)).toBe('Нас видели: город Катания (вождь Андрей).');
  });

  it('глаз без имени — «кто, не разглядели»; никто не видит — тишина', () => {
    const mem = { last: 0, by: {} as Record<string, number> };
    expect(noteSeen({ count: 0, by: [] }, null, T, mem)).toBeNull();
    expect(noteSeen({ count: 1, by: [] }, { count: 0, by: [] }, T, mem)).toBe('Нас видели — кто, не разглядели.');
  });
});

describe('свой отряд без сервера — той же дверью, что сервер', () => {
  it('замок реестра видит отряд — ровно тот же ответ, что дал бы сервер; за дальностью — скрыт', () => {
    const s = createInitialState(20261029);
    const at = { x: 400, y: 600 };
    s.roam = {
      origin: 'warrior',
      hero: { name: 'Ратко', war: 2 },
      band: { spearman: 12 },
      wounded: [],
      purse: 0,
      cargo: {},
      gear: {},
      way: roamSeat(at, T).way,
      camp: { kind: 'hidden', since: T, builders: 12 },
    };
    const mine = ownSight(s, T, null);
    expect(mine).not.toBeNull();
    const range = (mine as { range: number }).range;
    // Мерка шапки — круг замка дверью по виду отряда: местность, скрытый лагерь, 12 человек, часы партии.
    expect(range).toBeCloseTo(detectRange(CASTLE_EYE, conspicuity(bandLook({ way: s.roam.way, camp: s.roam.camp }, 12, s.time, T))), 10);
    for (const d of [Math.floor(range) - 1, Math.ceil(range) + 1]) {
      CASTLES.length = 0;
      CASTLES.push({ id: 'c1', x: at.x + d, y: at.y, name: 'Андрей', city: 'Катания', power: 1, pop: 1, seenAt: T });
      const local = ownSight(s, T, null)!.seen;
      const file: RosterFile = {
        v: 1,
        epoch: 0,
        rows: { k1: { x: at.x + d, y: at.y, name: 'Андрей', city: 'Катания', power: 1, pop: 1, seenAt: T } },
        bands: { me: { way: s.roam.way, camp: s.roam.camp ?? undefined, born: T, name: 'Ратко', prestige: 0, men: 12, seenAt: T, clock: { time: s.time, at: T } } },
      };
      const server = seenOf(file, 'me', T) as SeenView;
      expect(local.count, `замок в ${d} кл. при дальности ${range.toFixed(2)}`).toBe(server.count);
      expect(local.count).toBe(d <= range ? 1 : 0);
    }
    // Сервер сказал — его слово, своё не считается.
    const told: SeenView = { count: 2, by: [] };
    expect(ownSight(s, T, told)?.seen).toBe(told);
  });
});
