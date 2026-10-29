// Черты правителя (ПН-2, docs/gdd/path_of_sword.md, 3.2.3 и «Решения ПН-2»): черты по перебору счёта, пары на оси, потеря черты,
// одна дверь на каждое число черты, писатели счёта и «без черт — байт в байт».
//
// Области (правило 11): условие черты проверяется перебором точек по обе стороны порога — и что точки по обе стороны правда
// есть, сказано утверждением; число черты проверяется не нулём (при нуле любая забытая дверь дала бы то же), и рядом всегда
// стоит партия без черт, которая обязана дать прежние числа ровно.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createInitialState } from './state';
import { DAY_LENGTH, MUTINY_SUPPRESS_MORALE } from './constants';
import { BUILDINGS } from './data/buildings';
import { TRAIT_BY_ID } from './data/traits';
import { COMMONER_SLIGHT, LORD_FAVOR } from './commandrules';
import { GENERAL_DRILL, GLORY_LOSS, GLORY_WIN } from './spiritrules';
import { giftCeil } from './councilrules';
import { RULER_AXES, RULER_BUILD, RULER_TRAITS, rulerDeedsOf, rulerNumbersOf, rulerTraitsNow, rulerTraitsOf, type RulerDeeds, type RulerTraitId } from './rulertraits';
import { rulerTraitNumbers } from './rulernow';
import { noteRulerDeed, succeed } from './sim/dynasty';
import { setWageMode } from './sim/upkeep';
import { rebelsSettled } from './sim/stability';
import { spiritView } from './sim/spirit';
import { marketBoost } from './sim/market';
import { beginRite } from './sim/faith';
import { throwFeast } from './sim/actions';
import { finish } from './sim/gems';
import { buildBoost, estatesNow, guildsMult, stewardMult } from './derived';
import { applyEffects } from '@/world/bridge';
import type { GameState, RulerTally } from './types';
import type { HomeEffect } from '@/world/types';

const zero = (): RulerDeeds => ({ won: 0, lost: 0, fled: 0, built: 0, feasts: 0, mercy: 0, cruel: 0, days: 0, minDays: 0 });

/** Партия лорда со счётом дел правителя — через дверь записи. */
function lord(tally: RulerTally = {}, seed = 7): GameState {
  const s = createInitialState(seed);
  s.time = 40 * DAY_LENGTH;
  s.realm.ruler.bornAt = 0;
  for (const [k, n] of Object.entries(tally) as [keyof RulerTally, number][]) noteRulerDeed(s, k, n);
  return s;
}

describe('черты по перебору счёта', () => {
  // Формы черт агентов — то, из чего выведены пороги (правило 2 `rulertraits`): сменится форма — тест скажет, что вывод сдвинулся.
  it('пороги — формы «Победоносного» и «Битого», уровень на здание', () => {
    expect([TRAIT_BY_ID.victor.min, TRAIT_BY_ID.victor.share.num, TRAIT_BY_ID.victor.at]).toEqual([5, 0, 'most']);
    expect([TRAIT_BY_ID.beaten.min, TRAIT_BY_ID.beaten.share.num / TRAIT_BY_ID.beaten.share.den, TRAIT_BY_ID.beaten.at]).toEqual([3, 0.5, 'least']);
    expect(BUILDINGS.length, 'уровень на здание посёлка').toBe(21);
  });

  it('бои: Воитель — пять и больше без поражений и бегства; Трус — три и больше, бегства не меньше половины', () => {
    let warrior = 0;
    let coward = 0;
    let near = 0;
    for (let w = 0; w <= 7; w++) {
      for (let l = 0; l <= 4; l++) {
        for (let f = 0; f <= 5; f++) {
          const n = w + l + f;
          const got = rulerTraitsOf({ ...zero(), won: w, lost: l, fled: f });
          const wantW = n >= 5 && l + f === 0;
          const wantC = n >= 3 && 2 * f >= n;
          expect(got.includes('warrior'), `Воитель при ${w}/${l}/${f}`).toBe(wantW);
          expect(got.includes('coward'), `Трус при ${w}/${l}/${f}`).toBe(wantC);
          if (wantW) warrior++;
          if (wantC) coward++;
          if ((n === 4 && l + f === 0) || (n >= 5 && l + f === 1)) near++;
        }
      }
    }
    expect(warrior, 'граница: Воитель есть').toBeGreaterThan(0);
    expect(coward, 'граница: Трус есть').toBeGreaterThan(0);
    expect(near, 'граница: точки у самого порога есть').toBeGreaterThan(0);
  });

  it('участь: Милостивый — пять и больше без жестокости; Жестокий — три и больше, жестокости не меньше половины', () => {
    let both = 0;
    for (let m = 0; m <= 7; m++) {
      for (let c = 0; c <= 6; c++) {
        const got = rulerTraitsOf({ ...zero(), mercy: m, cruel: c });
        const n = m + c;
        expect(got.includes('merciful'), `Милостивый при ${m}/${c}`).toBe(n >= 5 && c === 0);
        expect(got.includes('cruel'), `Жестокий при ${m}/${c}`).toBe(n >= 3 && 2 * c >= n);
        if (n >= 5 && c === 0) both++;
      }
    }
    expect(both).toBeGreaterThan(0);
  });

  it('жалованье и пиры: Щедрый — пять пиров и ни часа минимального; Скупой — минимальное не меньше половины', () => {
    for (const days of [0, 2.9, 3, 4.9, 5, 30]) {
      for (const share of [0, 0.01, 0.49, 0.5, 1]) {
        for (const feasts of [0, 4, 5, 9]) {
          const minDays = days * share;
          const got = rulerTraitsOf({ ...zero(), days, minDays, feasts });
          expect(got.includes('generous'), `Щедрый ${days}/${share}/${feasts}`).toBe(days >= 5 && minDays === 0 && feasts >= 5);
          expect(got.includes('miser'), `Скупой ${days}/${share}/${feasts}`).toBe(days >= 3 && 2 * minDays >= days);
        }
      }
    }
  });

  it('Строитель — уровень на каждое здание посёлка; Торгаш, Узурпатор и Лесной по крови делами не приходят', () => {
    expect(rulerTraitsOf({ ...zero(), built: BUILDINGS.length - 1 })).not.toContain('builder');
    expect(rulerTraitsOf({ ...zero(), built: BUILDINGS.length })).toContain('builder');
    const big: RulerDeeds = { won: 99, lost: 99, fled: 99, built: 999, feasts: 99, mercy: 99, cruel: 99, days: 999, minDays: 999 };
    for (const id of ['trader', 'usurper', 'forest'] as RulerTraitId[]) expect(rulerTraitsOf(big), id).not.toContain(id);
  });
});

describe('правила черт — докачкой: до первого дела черт не бывает', () => {
  // Дверь чтения (`rulernow`) отдаёт нули, пока нет ни счёта, ни минимального жалованья, ни происхождения, — и правила при этом
  // не нужны. Это верно только если черт так правда не бывает: перебор по дням правления.
  it('без дел, минимального и происхождения — ни одной черты ни при каком сроке правления', () => {
    for (const days of [0, 0.5, 3, 5, 40, 400, 4000]) expect(rulerTraitsOf({ ...zero(), days }), `${days} дн.`).toEqual([]);
  });
  it('первое дело подгружает правила, а самая скорая черта ждёт ещё двух дел', () => {
    const keys = ['won', 'lost', 'fled', 'built', 'feasts', 'mercy', 'cruel'] as const;
    for (const k of keys) {
      for (const k2 of keys) {
        const got = rulerTraitsOf({ ...zero(), [k]: 1, [k2]: (k === k2 ? 2 : 1), days: 40 });
        expect(got, `два дела (${k}, ${k2}) черты не дают`).toEqual([]);
      }
    }
    // Минимальное жалованье: черта — не раньше трёх игровых дней правления, из них полутора на минимальном.
    expect(rulerTraitsOf({ ...zero(), days: 2.99, minDays: 2.99 })).toEqual([]);
    expect(rulerTraitsOf({ ...zero(), days: 3, minDays: 1.5 }), 'граница: черта приходит').toEqual(['miser']);
  });
});

describe('пары на одной оси не держатся разом', () => {
  it('ни при каком счёте перебора — обе черты пары', () => {
    let pts = 0;
    for (const w of [0, 3, 6]) for (const l of [0, 2]) for (const f of [0, 3, 6]) for (const m of [0, 5]) for (const c of [0, 3, 6]) {
      for (const share of [0, 0.5, 1]) {
        const got = rulerTraitsOf({ ...zero(), won: w, lost: l, fled: f, mercy: m, cruel: c, feasts: 5, days: 10, minDays: 10 * share });
        for (const [a, b] of RULER_AXES) expect(got.includes(a) && got.includes(b), `${a} и ${b}`).toBe(false);
        pts++;
      }
    }
    expect(pts).toBeGreaterThan(100);
  });

  it('черта рождения уступает паре, заработанной делами', () => {
    const coward = { ...zero(), won: 1, fled: 3 };
    expect(rulerTraitsOf(zero(), 'warrior'), 'Воин — Воитель от рождения').toEqual(['warrior']);
    expect(rulerTraitsOf(coward), 'граница: Трус делами').toContain('coward');
    expect(rulerTraitsOf(coward, 'warrior'), 'бегство снимает Воителя рождения').toEqual(['coward']);
    expect(rulerTraitsOf(zero(), 'merchant')).toEqual(['trader']);
    expect(rulerTraitsOf(zero(), 'taken')).toEqual(['forest']);
    expect(rulerTraitsOf(zero(), 'craftsman')).toEqual(['builder']);
  });
});

describe('черту можно потерять', () => {
  it('Воитель: пятая победа даёт, первое поражение снимает', () => {
    const s = lord({ won: 4 });
    expect(rulerTraitsNow(s)).toEqual([]);
    noteRulerDeed(s, 'won');
    expect(rulerTraitsNow(s)).toEqual(['warrior']);
    noteRulerDeed(s, 'lost');
    expect(rulerTraitsNow(s)).toEqual([]);
  });

  it('Скупой: минимальное полправления даёт, полное потом — снимает; смена правителя — счёт с нуля', () => {
    const s = lord();
    s.time = 0;
    expect(setWageMode(s, 'min')).toBeNull();
    s.time = 4 * DAY_LENGTH;
    expect(rulerDeedsOf(s).minDays, 'идущий отрезок досчитан при чтении').toBeCloseTo(4, 9);
    expect(rulerTraitsNow(s)).toEqual(['miser']);
    expect(setWageMode(s, 'full')).toBeNull();
    expect(s.realm.ruler.deeds?.wageMin, 'отрезок закрыт в счёт').toBeCloseTo(4 * DAY_LENGTH, 6);
    s.time = 9 * DAY_LENGTH;
    expect(rulerDeedsOf(s).minDays / rulerDeedsOf(s).days, 'граница: доля ниже половины').toBeLessThan(0.5);
    expect(rulerTraitsNow(s)).toEqual([]);
    noteRulerDeed(s, 'won', 5);
    expect(rulerTraitsNow(s)).toEqual(['warrior']);
    succeed(s);
    expect(s.realm.ruler.deeds, 'новый правитель приходит без дел').toBeUndefined();
    expect(rulerTraitsNow(s)).toEqual([]);
  });
});

describe('писатели счёта — дела партии', () => {
  const eff = (over: Partial<HomeEffect>): HomeEffect => ({ id: `e${Math.random()}`, lost: {}, resources: {}, prestige: 0, morale: 0, battle: null, text: '', good: true, ...over });

  it('бой, участь взятого города, пир и достроенный уровень ложатся в счёт; праздник прихода — не пир', () => {
    const s = lord();
    applyEffects(s, [eff({ id: 'b1', battle: 'won' }), eff({ id: 'b2', battle: 'lost', good: false })]);
    applyEffects(s, [eff({ id: 'f1', fate: 'burn' }), eff({ id: 'f2', fate: 'captives' }), eff({ id: 'f3', fate: 'plunder', terms: true }), eff({ id: 'f4', fate: 'plunder' })]);
    beginRite(s);
    s.gold = 10_000;
    expect(throwFeast(s)).toBeNull();
    const b = s.buildings[0];
    b.workRequired = 10;
    finish(s, b);
    expect(s.realm.ruler.deeds).toEqual({ won: 1, lost: 1, cruel: 2, mercy: 1, feasts: 1, built: 1 });
  });

  it('бой, который черту приносит, прибавки к памяти ещё не даёт; следующий — даёт', () => {
    const s = lord({ won: 4 });
    applyEffects(s, [eff({ id: 'w5', battle: 'won' })]);
    expect(s.spirit?.glory, 'пятая победа — без прибавки').toBeCloseTo(GLORY_WIN, 9);
    expect(rulerTraitsNow(s)).toContain('warrior');
    s.spirit = { glory: 0, at: s.time };
    applyEffects(s, [eff({ id: 'w6', battle: 'won' })]);
    expect(s.spirit?.glory, 'шестая — с прибавкой Воителя').toBeCloseTo(GLORY_WIN + TRAIT_BY_ID.victor.effect.won!, 9);
  });
});

describe('каждое число черты доходит до своей двери', () => {
  const coward = lord({ won: 1, fled: 3 });
  const plain = lord({ won: 1 });

  it('без черт — двери дают прежнее ровно', () => {
    const base = createInitialState(7);
    base.time = plain.time;
    base.realm.ruler.bornAt = 0;
    expect(rulerTraitsNow(plain), 'граница: дела есть, черт нет').toEqual([]);
    expect(plain.realm.ruler.deeds).toBeDefined();
    expect(estatesNow(plain)).toEqual(estatesNow(base));
    expect(spiritView(plain)).toEqual(spiritView(base));
    expect(marketBoost(plain)).toBe(marketBoost(base));
    expect(buildBoost(plain)).toBe(buildBoost(base));
  });

  it('Трус: рыцарство — обида на одного безродного, поражение горше на «Битого»', () => {
    expect(rulerTraitsNow(coward)).toEqual(['coward']);
    expect(estatesNow(coward).knights.parts.ruler).toBe(-COMMONER_SLIGHT);
    expect(estatesNow(coward).knights.loyalty).toBeCloseTo(estatesNow(plain).knights.loyalty - COMMONER_SLIGHT, 9);
    expect(estatesNow(coward).peasants.parts.ruler).toBe(0);
    coward.spirit = { glory: 0, at: coward.time };
    applyEffects(coward, [{ id: 'l', lost: {}, resources: {}, prestige: 0, morale: 0, battle: 'lost', text: '', good: false }]);
    expect(coward.spirit?.glory).toBeCloseTo(-GLORY_LOSS + TRAIT_BY_ID.beaten.effect.lost!, 9);
  });

  it('Милостивый, Жестокий, Скупой — слагаемое ruler своих сословий; Жестокий подавляет мятеж без платы моралью', () => {
    const mercy = lord({ mercy: 5 });
    expect(rulerTraitsNow(mercy)).toEqual(['merciful']);
    expect([estatesNow(mercy).peasants.parts.ruler, estatesNow(mercy).clergy.parts.ruler, estatesNow(mercy).knights.parts.ruler]).toEqual([LORD_FAVOR, LORD_FAVOR, 0]);
    const cruel = lord({ cruel: 3 });
    expect(rulerTraitsNow(cruel)).toEqual(['cruel']);
    expect(estatesNow(cruel).peasants.parts.ruler).toBe(-COMMONER_SLIGHT);
    for (const [s, paid] of [[cruel, 0], [plain, MUTINY_SUPPRESS_MORALE]] as const) {
      s.morale = 50;
      s.stab = { ...(s.stab ?? { level: 0, at: 0, folk: 0, hungry: 0, bought: 0, spent: 0, revolts: 0, held: 0 }), revolt: { group: 'folk', rebels: 4 } } as GameState['stab'];
      rebelsSettled(s, true);
      expect(s.morale, paid ? 'без черты — плата' : 'Жестокий — без платы').toBe(50 - paid);
    }
  });

  it('Щедрый и Скупой — строка «Правитель» в дисциплине', () => {
    const generous = lord({ feasts: 5 });
    expect(rulerTraitsNow(generous)).toEqual(['generous']);
    const line = (s: GameState): number => spiritView(s).discipline.lines.find((l) => l.id === 'ruler')?.value ?? 0;
    expect(line(generous)).toBe(GENERAL_DRILL);
    expect(line(plain), 'без черты строки нет').toBe(0);
    const miser = lord();
    miser.time = 0;
    setWageMode(miser, 'min');
    miser.time = 10 * DAY_LENGTH;
    expect(rulerTraitsNow(miser)).toEqual(['miser']);
    expect(line(miser)).toBe(-GENERAL_DRILL);
    expect(estatesNow(miser).merchants.parts.ruler).toBe(LORD_FAVOR);
  });

  it('Строитель — стройка под потолком Старосты, дворы не трогает', () => {
    const builder = lord({ built: BUILDINGS.length });
    expect(rulerTraitsNow(builder)).toEqual(['builder']);
    expect(buildBoost(builder)).toBeCloseTo(Math.max(1, Math.min(1 + giftCeil('steward'), stewardMult(builder) + RULER_BUILD) * guildsMult(builder)), 12);
    expect(buildBoost(builder), 'стройка быстрее').toBeGreaterThan(buildBoost(plain));
    expect(stewardMult(builder), 'множитель дворов — без черты').toBe(stewardMult(plain));
  });

  it('Торгаш и Лесной по крови — от происхождения героя пути (путь включён подменой выключателя)', async () => {
    vi.resetModules();
    vi.doMock('./roamflag', () => ({ ROAM_ON: true }));
    try {
      const flag = await import('./roamflag');
      expect(flag.ROAM_ON, 'граница: путь включён').toBe(true);
      const st = await import('./state');
      const roam = await import('./sim/roam');
      const traits = await import('./rulertraits');
      const now = await import('./rulernow');
      const market = await import('./sim/market');
      const merchant = st.createInitialState(7);
      const base = market.marketBoost(merchant);
      expect(roam.beginRoam(merchant, { origin: 'merchant', hero: { name: 'Ян', war: 1 }, band: { clubman: 4 }, purse: 50, food: 10 })).toBeNull();
      expect(traits.rulerTraitsNow(merchant)).toEqual(['trader']);
      expect(now.rulerSeat(merchant).n, 'счёт героя — не правителя').toBe(-1);
      expect(market.marketBoost(merchant)).toBeCloseTo(Math.min(base * (1 + traits.RULER_TRADE), 99), 12);
      const taken = st.createInitialState(8);
      roam.beginRoam(taken, { origin: 'taken', hero: { name: 'Олег', war: 2 }, band: { clubman: 4 }, purse: 50, food: 10 });
      expect(now.rulerTraitNumbers(taken).loyalty).toMatchObject({ peasants: LORD_FAVOR, knights: -COMMONER_SLIGHT });
    } finally {
      vi.doUnmock('./roamflag');
      vi.resetModules();
    }
  });

  it('сумма чисел — по таблице: каждая черта даёт только своё', () => {
    for (const t of RULER_TRAITS) {
      const n = rulerNumbersOf([t.id]);
      const e = t.effect;
      expect([n.won, n.lost, n.drill, n.trade, n.build, n.calm], t.id).toEqual([e.won ?? 0, e.lost ?? 0, e.drill ?? 0, e.trade ?? 0, e.build ?? 0, e.calm === true]);
    }
    expect(rulerTraitNumbers(plain)).toEqual(rulerNumbersOf([]));
  });
});

// ---------- по исходникам ----------

const SRC = join(process.cwd(), 'src');
function sources(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
    }
  };
  walk(dir);
  return out;
}
const bare = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
const rel = (f: string): string => f.slice(SRC.length + 1).split('\\').join('/');

describe('одна дверь на каждое число черты (таблица 3.2.3)', () => {
  /** Число черты → её единственная дверь. */
  const DOORS: Record<string, string> = {
    won: 'game/sim/spirit.ts',
    lost: 'game/sim/spirit.ts',
    drill: 'game/sim/spirit.ts',
    trade: 'game/sim/market.ts',
    build: 'game/derived.ts',
    calm: 'game/sim/stability.ts',
    loyalty: 'game/derived.ts',
  };

  it('у каждого числа таблицы — дверь, и каждое читает только она', () => {
    const keys = new Set(RULER_TRAITS.flatMap((t) => Object.keys(t.effect)));
    expect([...keys].sort()).toEqual(Object.keys(DOORS).sort());
    const reads: Record<string, Set<string>> = {};
    for (const f of sources(SRC)) {
      for (const m of bare(f).matchAll(/rulerTraitNumbers\(s\)\.(\w+)/g)) (reads[m[1]] ??= new Set()).add(rel(f));
    }
    for (const [k, door] of Object.entries(DOORS)) expect([...(reads[k] ?? [])], k).toEqual([door]);
    expect(Object.keys(reads).sort(), 'читают только числа таблицы').toEqual(Object.keys(DOORS).sort());
  });

  it('числа черт зовут только двери; в derived — только стройка и сословия', () => {
    const callers = sources(SRC).filter((f) => /rulerTraitNumbers\(/.test(bare(f))).map(rel).sort();
    expect(callers).toEqual(['game/derived.ts', 'game/sim/market.ts', 'game/sim/spirit.ts', 'game/sim/stability.ts']);
    const derived = bare(join(SRC, 'game', 'derived.ts'));
    const fns = [...derived.matchAll(/export (?:const|function) (\w+)[\s\S]*?(?=\nexport |$)/g)].filter((m) => /rulerTraitNumbers\(/.test(m[0])).map((m) => m[1]);
    expect(fns.sort()).toEqual(['buildBoost', 'estatesWith']);
  });

  it('бой ядра, очки, выработка, оборона и мир о чертах не знают', () => {
    const closed = [
      ...sources(join(SRC, 'battle')).map(rel),
      'game/battle/kinds.ts',
      'game/sim/points.ts',
      'game/sim/population.ts',
      'game/build.ts',
      'world/bridge.ts',
      'world/fights.ts',
    ];
    expect(closed.length, 'граница: файлы найдены').toBeGreaterThan(10);
    for (const r of closed) expect(bare(join(SRC, r)), r).not.toMatch(/ruler(?:traits|now)|rulerTrait/);
  });
});
