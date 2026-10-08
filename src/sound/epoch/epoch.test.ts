// Звук города и музыка эпохи: обещания, которые держатся без уха (docs/audio.md, раздел 8).
//
// Как звучит — слышно только ухом и видно в уровнях офлайн-отрисовки (`npm run audio:samples`). Здесь — то, что
// проверяется числом: музыка в ладу, фразы кончаются каденцией, вариации узнаются, но не повторяются, пауза между
// пьесами есть; слои фона подчиняются времени суток, сезону, камере и карте; колокол бьёт на своих часах и не звонит
// задним числом.
import { describe, expect, it } from 'vitest';
import { MODES, PAUSE_MAX, PAUSE_MIN, compose, midiOf, pauseAfter, type Piece } from './compose';
import { BELL_HOURS, LAYERS, bellBetween, mixOf, morning, muffleOf, night, workday, type Hearing } from './ambience';
import { seeded } from './rng';

const SEEDS = Array.from({ length: 60 }, (_, i) => i * 7919 + 13);
const pieces: Piece[] = SEEDS.map((s) => compose(seeded(s)));

describe('музыка эпохи: пьеса из зерна', () => {
  it('одно зерно — одна пьеса', () => {
    expect(compose(seeded(42))).toEqual(compose(seeded(42)));
  });

  it('каждая нота — в ладу пьесы', () => {
    for (const p of pieces) {
      const scale = new Set<number>(MODES[p.mode]);
      for (const n of p.notes) {
        const pc = (((n.midi - p.tonic) % 12) + 12) % 12;
        expect(scale.has(pc), `${p.mode} от ${p.tonic}: ${n.midi}`).toBe(true);
        expect(n.midi).toBe(midiOf(p.mode, p.tonic, n.degree) + (n.voice === 'flute' && p.tonic <= 60 ? 12 : 0));
      }
    }
  });

  it('форма A A′ B A″: A и B — на квинте, A′ и A″ — на финалисе, и последняя нота мелодии — финалис', () => {
    for (const p of pieces) {
      expect(p.phrases.map((f) => f.name)).toEqual(['A', 'A′', 'B', 'A″']);
      expect(p.phrases.map((f) => f.end)).toEqual([4, 0, 4, 0]);
      const lead = p.notes.filter((n) => n.lead);
      expect(((lead[lead.length - 1].degree % 7) + 7) % 7).toBe(0);
    }
  });

  it('каденция подходит к опоре поступенно, сверху', () => {
    for (const p of pieces) {
      const lead = p.notes.filter((n) => n.lead);
      for (let k = 0; k < p.phrases.length; k++) {
        const end = (k + 1 < p.phrases.length ? p.phrases[k + 1].at : Infinity) - 1e-6;
        const inPhrase = lead.filter((n) => n.at >= p.phrases[k].at && n.at < end);
        const [penult, last] = inPhrase.slice(-2);
        expect(last.degree).toBe(p.phrases[k].end);
        expect(penult.degree - last.degree).toBe(1);
      }
    }
  });

  it('A′ — вариация A: каденция другая, но ритм и мелодия узнаются, и это не копия', () => {
    for (const p of pieces) {
      const lead = p.notes.filter((n) => n.lead);
      const of = (k: number): number[] => lead.filter((n) => n.at >= p.phrases[k].at && n.at < (p.phrases[k + 1]?.at ?? Infinity)).map((n) => n.degree);
      const a = of(0);
      const a2 = of(3);
      expect(a2.join()).not.toBe(a.join());
      // Узнаётся: начало темы — в пределах соседней ступени.
      expect(Math.abs(a2[0] - a[0])).toBeLessThanOrEqual(1);
    }
  });

  it('скачки мелодии внутри фразы не больше октавы, регистр — в пределах', () => {
    for (const p of pieces) {
      const lead = p.notes.filter((n) => n.lead);
      const phraseOf = (t: number): number => p.phrases.filter((f) => f.at <= t + 1e-6).length;
      for (let i = 1; i < lead.length; i++) {
        if (phraseOf(lead[i].at) !== phraseOf(lead[i - 1].at)) continue;
        expect(Math.abs(lead[i].midi - lead[i - 1].midi)).toBeLessThanOrEqual(12);
      }
      for (const n of p.notes) expect(n.midi).toBeGreaterThanOrEqual(40), expect(n.midi).toBeLessThanOrEqual(90);
    }
  });

  it('длина пьесы — от сорока секунд до полутора минут, ноты внутри неё и по порядку', () => {
    for (const p of pieces) {
      expect(p.length).toBeGreaterThanOrEqual(40);
      expect(p.length).toBeLessThanOrEqual(90);
      for (let i = 0; i < p.notes.length; i++) {
        const n = p.notes[i];
        expect(n.at).toBeGreaterThan(0);
        expect(n.at + n.dur).toBeLessThanOrEqual(p.length);
        if (i > 0) expect(n.at).toBeGreaterThanOrEqual(p.notes[i - 1].at);
      }
    }
  });

  it('пьесы не надоедают: лады, финалисы и голоса разные, мелодии не повторяются', () => {
    const kinds = new Set(pieces.map((p) => `${p.mode}|${p.tonic}`));
    expect(kinds.size).toBeGreaterThanOrEqual(10);
    const tunes = new Set(pieces.map((p) => p.notes.filter((n) => n.lead).map((n) => n.midi).join()));
    expect(tunes.size).toBe(pieces.length);
    expect(new Set(pieces.map((p) => p.meter)).size).toBe(2);
    expect(pieces.some((p) => p.notes.some((n) => n.voice === 'flute'))).toBe(true);
  });

  it('пауза между пьесами — в своих границах', () => {
    const r = seeded(5);
    for (let i = 0; i < 200; i++) {
      const v = pauseAfter(r);
      expect(v).toBeGreaterThanOrEqual(PAUSE_MIN);
      expect(v).toBeLessThan(PAUSE_MAX);
    }
  });

  it('слабый телефон: бурдон в одну ноту и без лишних щипков', () => {
    for (const s of SEEDS.slice(0, 10)) {
      const full = compose(seeded(s));
      const lite = compose(seeded(s), { lite: true });
      expect(lite.drone.length).toBe(1);
      expect(full.drone.length).toBe(2);
      expect(lite.notes.filter((n) => !n.lead).length).toBe(16);
    }
  });
});

const city = (o: Partial<Hearing> = {}): Hearing => ({ view: 'city', solar: 0.25, season: 'summer', near: 0.5, sea: 0, ...o });

describe('фон города: слои от того, что видит игрок', () => {
  it('днём слышны рынок и кузница, ночью — нет; ночью — сверчки', () => {
    const day = mixOf(city({ solar: 0.25 }));
    const nite = mixOf(city({ solar: 0.75 }));
    expect(day.market).toBeGreaterThan(0.3);
    expect(day.forge).toBeGreaterThan(0.3);
    expect(nite.market).toBe(0);
    expect(nite.forge).toBe(0);
    expect(nite.crickets).toBeGreaterThan(0.5);
    expect(day.crickets).toBe(0);
    expect(nite.bells).toBe(0);
  });

  it('границы суток в своих окнах: утро — до полдня, ночь — после сумерек', () => {
    expect(morning(0.03)).toBeGreaterThan(0.9);
    expect(morning(0.25)).toBe(0);
    expect(workday(0.25)).toBe(1);
    expect(workday(0.75)).toBe(0);
    expect(night(0.75)).toBe(1);
    expect(night(0.25)).toBe(0);
  });

  it('камера: приблизил к улицам — рынок и кузница громче, ветер и гул тише', () => {
    const near = mixOf(city({ near: 1 }));
    const far = mixOf(city({ near: 0 }));
    expect(near.market).toBeGreaterThan(far.market * 3);
    expect(near.forge).toBeGreaterThan(far.forge * 2);
    expect(far.wind).toBeGreaterThan(near.wind);
    expect(far.hum).toBeGreaterThan(near.hum);
  });

  it('сезон: весной птиц больше всего, зимой птиц и сверчков нет, ветер сильнее и снег глушит город', () => {
    const at = (season: Hearing['season'], solar: number) => mixOf(city({ season, solar }));
    expect(at('spring', 0.04).birds).toBeGreaterThan(at('summer', 0.04).birds);
    expect(at('summer', 0.04).birds).toBeGreaterThan(at('autumn', 0.04).birds);
    expect(at('winter', 0.04).birds).toBe(0);
    expect(at('winter', 0.75).crickets).toBe(0);
    expect(at('winter', 0.25).wind).toBeGreaterThan(at('summer', 0.25).wind);
    expect(muffleOf(city({ season: 'winter' }))).toBeLessThan(muffleOf(city({ season: 'summer' })));
  });

  it('птицы поют утром громче, чем днём', () => {
    expect(mixOf(city({ solar: 0.04 })).birds).toBeGreaterThan(mixOf(city({ solar: 0.3 })).birds * 2);
  });

  it('карта: только ветер и море у дома — ни рынка, ни кузницы, ни колокола', () => {
    const sea = mixOf({ view: 'map', solar: 0.25, season: 'summer', near: 1, sea: 0.6 });
    const inland = mixOf({ view: 'map', solar: 0.25, season: 'summer', near: 1, sea: 0 });
    for (const l of ['market', 'forge', 'birds', 'crickets', 'bells', 'hum'] as const) expect(sea[l]).toBe(0);
    expect(sea.wind).toBeGreaterThan(0.3);
    expect(sea.sea).toBeGreaterThan(0.5);
    expect(inland.sea).toBe(0);
  });

  it('погода: дождь шуршит, ветер громче в бурю, рынок и птицы в дождь тише; без погоды — как прежде', () => {
    const calm = mixOf(city({ near: 0.5 }));
    expect(mixOf(city({ wx: { rain: 0, snow: 0, storm: 0, wind: 0.4 } }))).toEqual(calm);
    expect(calm.rain).toBe(0);
    const wet = mixOf(city({ wx: { rain: 0.8, snow: 0, storm: 0, wind: 0.4 } }));
    expect(wet.rain).toBeGreaterThan(0.5);
    expect(wet.market).toBeLessThan(calm.market * 0.7);
    expect(wet.birds).toBeLessThan(calm.birds * 0.7);
    const gale = mixOf(city({ near: 0, wx: { rain: 0, snow: 0, storm: 0, wind: 1 } }));
    const still = mixOf(city({ near: 0, wx: { rain: 0, snow: 0, storm: 0, wind: 0 } }));
    expect(gale.wind).toBeGreaterThan(still.wind * 2);
    expect(mixOf({ view: 'map', solar: 0.25, season: 'summer', near: 1, sea: 0, wx: { rain: 1, snow: 0, storm: 0, wind: 0.4 } }).rain).toBeGreaterThan(0.3);
  });

  it('снег глушит город, пока лежит: зимой без снега на земле — не глушит', () => {
    const wx = { rain: 0, snow: 0, storm: 0, wind: 0.4 };
    expect(muffleOf(city({ season: 'winter' }))).toBe(1800);
    expect(muffleOf(city({ season: 'winter', wx: { ...wx, cover: 1 } }))).toBe(1800);
    expect(muffleOf(city({ season: 'winter', wx: { ...wx, cover: 0 } }))).toBe(9000);
    expect(muffleOf(city({ season: 'summer', wx: { ...wx, cover: 1 } }))).toBe(9000);
  });

  it('все слои в пределах 0..1 на всей решётке', () => {
    for (const view of ['city', 'map'] as const)
      for (const season of ['spring', 'summer', 'autumn', 'winter'] as const)
        for (let solar = 0; solar < 1; solar += 0.01)
          for (const near of [0, 0.5, 1]) {
            const m = mixOf({ view, season, solar, near, sea: 1, wx: { rain: 1, snow: 1, storm: 1, wind: (near + solar) % 1 } });
            for (const l of LAYERS) {
              expect(m[l], `${view} ${season} ${solar} ${near} ${l}`).toBeGreaterThanOrEqual(0);
              expect(m[l], `${view} ${season} ${solar} ${near} ${l}`).toBeLessThanOrEqual(1);
            }
          }
  });
});

describe('колокол собора — по часам игры', () => {
  it('бьёт, когда фаза солнца прошла его час, и столько раз, сколько записано', () => {
    for (const [mark, strikes] of BELL_HOURS) {
      // Граница области: шаг меньше четверти суток — иначе это скачок, а не ход времени.
      const from = (mark - 0.004 + 1) % 1;
      const to = (mark + 0.004) % 1;
      expect((to - from + 1) % 1).toBeLessThan(0.25);
      expect(bellBetween(from, to)).toBe(strikes);
    }
  });

  it('между часами молчит', () => {
    expect(bellBetween(0.2, 0.24)).toBe(0);
    expect(bellBetween(0.6, 0.9)).toBe(0);
  });

  it('не звонит задним числом: вход в игру и догон отлучки — скачок, а не ход', () => {
    expect(bellBetween(0.9, 0.3)).toBe(0);
    expect(bellBetween(0.3, 0.2)).toBe(0);
    expect(bellBetween(0.25, 0.25)).toBe(0);
  });

  it('через полночь ход времени тоже ход: утреня после ночи', () => {
    expect(bellBetween(0.99, 0.03)).toBe(3);
  });
});
