// Разговоры покоев (docs/city_v3.md, Г-7): «Сцены для взрослых» выключены — варианта ночи нет ни у служанки, ни у
// супруги, ни в каком часу, настроении и нраве; просьбы слуге ведут к своим сценам; память меняет реплики; у каждой
// реплики три-пять ответов; имена дома — одни на правителя и из его веры; память устройства переживает выход из покоев.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { agreeChance, canNight, daypartOf, freshMemory, household, opening, reply, type Daypart, type OptionId, type TalkCtx, type Temper } from './talk';
import { loadMemory, saveMemory } from './memory';
import type { FaithId } from '@/game/types';

const DAYS: Daypart[] = ['morning', 'day', 'evening', 'night'];
const TEMPERS: Temper[] = ['meek', 'merry', 'stern', 'pious', 'proud'];
const FAITHS: FaithId[] = ['catholic', 'orthodox', 'islam', 'pagan'];

function ctx(over: Partial<TalkCtx> = {}): TalkCtx {
  const h = household('Бертран', 3, 'catholic');
  return {
    who: 'servant',
    why: 'arrive',
    daypart: 'day',
    morale: 60,
    besieged: false,
    campaign: false,
    cat: false,
    wine: 0,
    adult: true,
    ruler: 'Бертран',
    faith: 'catholic',
    wife: h.wife,
    maid: h.maid,
    servant: h.servant,
    heir: 'Гуго',
    mem: freshMemory(h.house),
    roll: 0.3,
    ...over,
  };
}

/** Все ответы разговора, до какого можно дойти за два хода от начала. */
function reachable(c: TalkCtx): OptionId[] {
  const out = new Set<OptionId>();
  const first = opening(c);
  for (const o of first.options) {
    out.add(o.id);
    const r = reply({ ...c, mem: first.mem }, o.id);
    for (const p of r.options) out.add(p.id);
  }
  return [...out];
}

describe('покои: разговоры (Г-7)', () => {
  it('«Сцены для взрослых» выключены — варианта ночи нет: ни у служанки, ни у супруги, ни в каком часу и нраве', () => {
    // Граница области — все часы, мораль низкая и высокая, мир и война, пять нравов, доля хода по всей шкале.
    let checked = 0;
    for (const who of ['maid', 'wife'] as const)
      for (const daypart of DAYS)
        for (const morale of [20, 60, 90])
          for (const besieged of [false, true])
            for (const temper of TEMPERS)
              for (const roll of [0, 0.5, 0.99]) {
                const base = ctx({ who, daypart, morale, besieged, roll, wife: { name: 'Матильда', temper } });
                expect(reachable({ ...base, adult: false }), `${who} ${daypart} ${morale} ${besieged} ${temper}: без ночи`).not.toContain('night');
                // Включены — ночь предлагается (дошли бы и до неё: проверка не пустая).
                expect(reachable({ ...base, adult: true }), `${who}: с ночью`).toContain('night');
                checked++;
              }
    expect(checked).toBe(2 * 4 * 3 * 2 * 5 * 3);
  });

  it('просьбы слуге ведут к своим сценам: кот, унести кота, служанка с вином, супруга, «ступай»', () => {
    const want: Partial<Record<OptionId, string>> = { cat: 'cat', uncat: 'uncat', wine: 'wine', wife: 'wife', dismiss: 'dismiss' };
    for (const cat of [false, true]) {
      const c = ctx({ cat });
      const o = opening(c).options.map((x) => x.id);
      expect(o, 'кот здесь — «унеси», нет — «приведи»').toContain(cat ? 'uncat' : 'cat');
      expect(o).not.toContain(cat ? 'cat' : 'uncat');
      for (const id of o) {
        const r = reply(c, id);
        if (want[id]) {
          expect(r.order, `${id} → сцена`).toBe(want[id]);
          expect(r.end, `${id}: слуга идёт исполнять`).toBe(true);
        } else expect(r.order, `${id}: разговор, а не сцена`).toBeUndefined();
      }
    }
  });

  it('у каждой реплики — три-пять ответов, у конца разговора — ни одного', () => {
    for (const who of ['servant', 'maid', 'wife'] as const)
      for (const daypart of DAYS)
        for (const roll of [0, 0.4, 0.9]) {
          const c = ctx({ who, daypart, roll, why: who === 'maid' ? 'poured' : 'arrive' });
          const first = opening(c);
          expect(first.options.length, `${who} ${daypart}: начало`).toBeGreaterThanOrEqual(3);
          expect(first.options.length).toBeLessThanOrEqual(5);
          for (const o of first.options) {
            const r = reply({ ...c, mem: first.mem }, o.id);
            if (r.end) expect(r.options).toEqual([]);
            else {
              expect(r.options.length, `${who} ${o.id}`).toBeGreaterThanOrEqual(2);
              expect(r.options.length).toBeLessThanOrEqual(5);
            }
            expect(r.line.length, `${who} ${o.id}: реплика коротка`).toBeLessThan(140);
          }
        }
  });

  it('слуга помнит, что уже приносил: второй и третий раз — другие слова', () => {
    let c = ctx();
    const lines: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = reply(c, 'cat');
      lines.push(r.line);
      c = { ...c, mem: r.mem };
    }
    expect(c.mem.servant.cat).toBe(3);
    expect(new Set(lines).size, lines.join(' | ')).toBe(3);
    // Вернулся с котом второй раз — ворчит про кухню.
    expect(opening({ ...c, why: 'cat' }).line).toMatch(/кухне/);
  });

  it('супруга помнит, о чём говорили; реплики — по часу, морали и войне', () => {
    let c = ctx({ who: 'wife' });
    const a = reply(c, 'town');
    c = { ...c, mem: a.mem };
    const b = reply(c, 'town');
    expect(a.mem.wife.town).toBe(1);
    expect(b.line).toMatch(/говорили/);
    // Мораль: низкая — ропщут, высокая — хвалят.
    const low = reply(ctx({ who: 'wife', morale: 20, roll: 0 }), 'town').line;
    const high = reply(ctx({ who: 'wife', morale: 90, roll: 0 }), 'town').line;
    expect(low).not.toBe(high);
    // Война: под стенами — о враге.
    expect(reply(ctx({ who: 'wife', besieged: true }), 'war').line).toMatch(/стен/);
    // Час: ночью слуга говорит иначе, чем утром.
    expect(opening(ctx({ daypart: 'night' })).line).not.toBe(opening(ctx({ daypart: 'morning' })).line);
  });

  it('отказ — мягко, и в этот приход второй раз не спрашивают; согласие — сцена «ночь»', () => {
    const c = ctx({ who: 'wife', wife: { name: 'Ида', temper: 'stern' } });
    const p = agreeChance(c, 'wife');
    const no = reply({ ...c, roll: Math.min(0.999, p + 0.01) }, 'night');
    expect(no.order).toBeUndefined();
    expect(no.options.map((o) => o.id)).not.toContain('night');
    expect(canNight({ ...c, mem: no.mem }, 'wife')).toBe(false);
    const yes = reply({ ...c, roll: Math.max(0, p - 0.01) }, 'night');
    expect(yes.order).toBe('night');
    expect(yes.end).toBe(true);
  });

  it('имена дома — одни на правителя, из его веры; нрав — из пяти', () => {
    for (const f of FAITHS) {
      const a = household('Всеволод', 2, f);
      const b = household('Всеволод', 2, f);
      expect(a).toEqual(b);
      expect(a.wife.name.length).toBeGreaterThan(1);
      expect(a.maid.length).toBeGreaterThan(1);
      expect(TEMPERS).toContain(a.wife.temper);
    }
    expect(household('Всеволод', 2, 'orthodox').house).not.toBe(household('Всеволод', 3, 'orthodox').house);
  });

  it('час по свету города: ночь — по глубине ночи, утро — солнце низко на востоке, вечер — на западе', () => {
    expect(daypartOf(0.9, -0.2, 0)).toBe('night');
    expect(daypartOf(0, 0.15, 0.8)).toBe('morning');
    expect(daypartOf(0, 0.15, -0.8)).toBe('evening');
    expect(daypartOf(0, 0.7, 0.2)).toBe('day');
  });
});

describe('покои: память устройства (Г-7)', () => {
  it('кот и разговоры переживают выход из покоев; сменился правитель — разговоры с начала, кот остаётся', () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    const m = loadMemory('Бертран#3');
    expect(m.life.cat).toBe(false);
    m.life = { cat: true, catSpot: 'sill' };
    m.talk.servant.cat = 2;
    saveMemory(m);
    const back = loadMemory('Бертран#3');
    expect(back.life).toEqual({ cat: true, catSpot: 'sill' });
    expect(back.talk.servant.cat).toBe(2);
    const heir = loadMemory('Гуго#4');
    expect(heir.life.cat, 'кот — не правителя, а покоев').toBe(true);
    expect(heir.talk.servant.cat, 'разговоры — с начала').toBe(0);
    delete (globalThis as { localStorage?: unknown }).localStorage;
    // Памяти нет (приватное окно) — кота нет, разговоры с начала, без ошибки.
    expect(loadMemory('x').life.cat).toBe(false);
  });

  it('окно разговора: крестик кончает разговор (ноги отпускает режиссёр, `life.endTalk`)', () => {
    const src = readFileSync(join(__dirname, 'Talk.tsx'), 'utf8');
    const close = src.slice(src.indexOf('const close = (): void => {'), src.indexOf('if (!turn) return null;'));
    expect(close).toMatch(/life\.endTalk\(\);/);
    expect(close).toMatch(/onDone\(\);/);
  });
});

describe('покои: имена в речи (Г-7)', () => {
  it('женские имена склоняются: позови Марту, вели Марте, пригласи Иду, Марию; несклоняемые — как есть', async () => {
    const { femCase } = await import('./talk');
    expect(femCase('Марта', 'acc')).toBe('Марту');
    expect(femCase('Марта', 'dat')).toBe('Марте');
    expect(femCase('Ида', 'acc')).toBe('Иду');
    expect(femCase('Мария', 'acc')).toBe('Марию');
    expect(femCase('Мария', 'dat')).toBe('Марии');
    expect(femCase('Агнея', 'dat')).toBe('Агнее');
    expect(femCase('Ольга', 'dat')).toBe('Ольге');
    for (const n of ['Нур', 'Айно', 'Эгле', 'Марьям']) expect(femCase(n, 'acc')).toBe(n);
    const o = opening(ctx()).options.map((x) => x.text).join(' | ');
    expect(o).not.toMatch(/Позови Марта|госпожу Ида\b/);
  });
});
