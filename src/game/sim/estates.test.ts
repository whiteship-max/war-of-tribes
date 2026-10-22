// Сословия (РТ-2, docs/stability.md, «РТ-2»): дверь `sim/estates` и мерка `derived.estatesNow` — влияние и лояльность, цели
// Т1–Т3, привилегии, дар, указ сословия, специализация, перевес, ропот у податных СБ-1, рычаги игры, вести сословий, старое
// сохранение и одна дверь. Каждая точка свойства сначала утверждает, что она внутри области правила (правило 11): влияние выше
// ровной доли, лояльность по ту сторону порога, указ открыт или закрыт.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EstateId, GameState } from '../types';
import { createInitialState } from '../state';
import { DAY_LENGTH } from '../constants';
import { QUESTS } from '../data/quests';
import { SEASON_DAYS } from '../data/seasons';
import { ESTATE_DECREE, TAX_BY_ID, TAX_PER_POP } from '../data/policy';
import { estateBoon } from '../data/boons';
import { CROWN_BY_ID, estateCrownId } from '../data/crown';
import {
  DECREE_STRENGTH,
  DISLOYAL,
  ENVY,
  ESTATES,
  ESTATE_DOMINANT,
  ESTATE_EVEN,
  ESTATE_HALLS,
  ESTATE_MINUS,
  ESTATE_PLUS,
  ESTATE_SPECIAL,
  FERVOUR_SCALE,
  LOYAL,
  LOYALTY_BASE,
  PIETY_SCALE,
  PRIV_LOYALTY,
  PRIV_MAX,
  PRIV_SHARE,
  hallEstate,
  influenceOf,
  loyaltyFrom,
  loyaltyParts,
  murmurOf,
  specialOf,
} from '../estaterules';
import { BUILDINGS } from '../data/buildings';
import {
  armyResolve,
  buildRate,
  clergyPiety,
  decreeBlock,
  estateFoodMult,
  estateGrowthMult,
  estateWageMult,
  estatesNow,
  levelsOf,
  peasantsMult,
  population,
  taxIncomePerDay,
  townFoodPerDay,
  wageOf,
} from '../derived';
import { estatesOf, estatesStep, giftEstate, giftPrice, grantPrivilege, mergeEstates, revokePrivilege } from './estates';
import { folkParts, targetOf } from './stability';
import { setDecree } from './actions';
import { applyCrown, crownRate } from './crown';
import { deserialize, serialize } from '../save';
import { SAVE_VERSION } from '../state';

/** Город без случайностей: вести не идут, задания закрыты, золота и хлеба вдоволь. */
function town(over: (s: GameState) => void = () => {}, seed = 4242): GameState {
  const s = createInitialState(seed);
  s.tutorialDone = true;
  s.nextEventAt = Infinity;
  s.completedQuests = QUESTS.map((q) => q.id);
  s.faith.id = 'catholic';
  s.gold = 100_000;
  s.resources.food = 50_000;
  over(s);
  return s;
}

/** Поднять постройки сословия до уровня `level`. */
const raise = (s: GameState, e: EstateId, level: number): void => {
  for (const b of s.buildings) if (ESTATE_HALLS[e].includes(b.type)) b.level = level;
};

/** Даровать сословию `n` привилегий дверью. */
const grant = (s: GameState, e: EstateId, n: number): void => {
  for (let i = 0; i < n; i++) expect(grantPrivilege(s, e), `${e}: дарование ${i + 1}`).toBeNull();
};

describe('влияние: средний уровень построек сословия и привилегии', () => {
  it('каждая постройка — у одного сословия или общая; новый город ровный — по ровной доле', () => {
    for (const b of BUILDINGS) {
      const owners = ESTATES.filter((e) => ESTATE_HALLS[e].includes(b.id));
      expect(owners.length, b.id).toBeLessThanOrEqual(1);
      expect(hallEstate(b.id)).toBe(owners[0] ?? null);
    }
    const n = estatesNow(town());
    for (const e of ESTATES) expect(n[e].infl, e).toBeCloseTo(ESTATE_EVEN, 9);
  });

  it('сумма — сто при любых уровнях и привилегиях; привилегия отдаёт сословию десятую долю, остальное — по весу построек', () => {
    for (let k = 0; k < 200; k++) {
      const levels: Record<string, number> = {};
      for (const b of BUILDINGS) levels[b.id] = 1 + ((k * 7 + b.id.length * 3) % 10);
      const priv = Object.fromEntries(ESTATES.map((e, i) => [e, (k + i) % (PRIV_MAX + 1)])) as Record<EstateId, number>;
      const infl = influenceOf(levels, priv);
      expect(ESTATES.reduce((t, e) => t + infl[e], 0)).toBeCloseTo(100, 9);
      // Привилегии — их доля: всё прочее делится весом.
      const bare = influenceOf(levels, {});
      const n = ESTATES.reduce((t, e) => t + priv[e], 0);
      for (const e of ESTATES) expect(infl[e]).toBeCloseTo(bare[e] * (1 - n * (PRIV_SHARE / 100)) + PRIV_SHARE * priv[e], 9);
    }
  });

  it('подъём построек сословия поднимает его влияние; все десять привилегий — ровные доли при любом городе', () => {
    const s = town();
    raise(s, 'merchants', 6);
    const n = estatesNow(s);
    expect(n.merchants.infl).toBeGreaterThan(ESTATE_EVEN);
    for (const e of ESTATES) if (e !== 'merchants') expect(n[e].infl).toBeLessThan(ESTATE_EVEN);
    for (const e of ESTATES) grant(s, e, PRIV_MAX);
    for (const e of ESTATES) expect(estatesNow(s)[e].infl, e).toBeCloseTo(ESTATE_EVEN, 9);
  });
});

describe('лояльность: привилегии, зависть, перевес — цели Т1–Т3', () => {
  const at = (e: EstateId, priv: Partial<Record<EstateId, number>>): number => loyaltyFrom(loyaltyParts(e, priv, ESTATE_EVEN, 0));

  it('ровная — 50; своя привилегия +P, чужая −J', () => {
    expect(at('merchants', {})).toBe(LOYALTY_BASE);
    expect(at('merchants', { merchants: 1 })).toBeCloseTo(LOYALTY_BASE + PRIV_LOYALTY, 9);
    expect(at('guilds', { merchants: 1 })).toBeCloseTo(LOYALTY_BASE - ENVY, 9);
  });

  it('Т1: по привилегии двум опорам — обе верны, прочие не ропщут; Т2: по одной всем — никто не рад; Т3: по две двум — пренебрежённые ропщут', () => {
    const two = { merchants: 1, knights: 1 };
    expect(at('merchants', two)).toBeGreaterThanOrEqual(LOYAL);
    expect(at('guilds', two)).toBeGreaterThanOrEqual(DISLOYAL);
    const all = Object.fromEntries(ESTATES.map((e) => [e, 1]));
    for (const e of ESTATES) expect(at(e, all), e).toBeLessThan(LOYALTY_BASE);
    const pillars = { merchants: 2, knights: 2 };
    for (const e of ['guilds', 'peasants', 'clergy'] as EstateId[]) expect(at(e, pillars), e).toBeLessThan(DISLOYAL);
  });

  it('числа — середина допустимого: J между (50−30)/4 и (50−30)/2, P между 10+J и 4J, ни одна граница не на равенстве', () => {
    expect(ENVY).toBeGreaterThan((LOYALTY_BASE - DISLOYAL) / 4);
    expect(ENVY).toBeLessThan((LOYALTY_BASE - DISLOYAL) / 2);
    expect(PRIV_LOYALTY).toBeGreaterThan(LOYAL - LOYALTY_BASE + ENVY);
    expect(PRIV_LOYALTY).toBeLessThan(4 * ENVY);
  });

  it('перевес требует больше: каждый процент влияния выше половины — процент лояльности', () => {
    const s = town((g) => raise(g, 'merchants', 9));
    grant(s, 'merchants', 2);
    const n = estatesNow(s).merchants;
    expect(n.infl, 'точка внутри: перевес').toBeGreaterThan(ESTATE_DOMINANT);
    expect(n.parts.greed).toBeCloseTo(-(n.infl - ESTATE_DOMINANT), 9);
    expect(n.loyalty).toBeCloseTo(LOYALTY_BASE + 2 * PRIV_LOYALTY - (n.infl - ESTATE_DOMINANT), 9);
  });
});

describe('привилегии и дар — дверь `sim/estates`', () => {
  it('даровать — до двух, третья — отказ; счёт дарований; отнять — обида на сезон, потом проходит', () => {
    const s = town();
    grant(s, 'guilds', 2);
    expect(grantPrivilege(s, 'guilds')).toMatch(/обе привилегии/);
    expect(estatesOf(s).grants).toBe(2);
    const before = estatesNow(s).guilds.loyalty;
    expect(revokePrivilege(s, 'guilds')).toBeNull();
    expect(estatesOf(s).revokes).toBe(1);
    // Отняли одну: своя привилегия −P и обида −P.
    expect(estatesNow(s).guilds.loyalty).toBeCloseTo(before - 2 * PRIV_LOYALTY, 9);
    s.time += SEASON_DAYS * DAY_LENGTH + 1;
    expect(estatesNow(s).guilds.loyalty).toBeCloseTo(before - PRIV_LOYALTY, 9);
    expect(revokePrivilege(s, 'guilds')).toBeNull();
    expect(revokePrivilege(s, 'guilds')).toMatch(/привилегий нет/);
  });

  it('дар: цена — день полного налога (крестьянам — день хлеба), лояльность +P на сезон, повтор продлевает, не складывает', () => {
    const s = town();
    expect(giftPrice(s, 'merchants')).toEqual({ gold: Math.ceil(population(s) * TAX_PER_POP * TAX_BY_ID.high.perPop) });
    expect(giftPrice(s, 'peasants')).toEqual({ food: Math.ceil(townFoodPerDay(s)) });
    const gold = s.gold;
    const outlays = s.stats.outlays ?? 0;
    expect(giftEstate(s, 'merchants')).toBeNull();
    expect(s.gold).toBe(gold - (giftPrice(s, 'merchants') as { gold: number }).gold);
    expect(s.stats.outlays).toBe(outlays + 1);
    expect(estatesNow(s).merchants.loyalty).toBeCloseTo(LOYALTY_BASE + PRIV_LOYALTY, 9);
    s.time += DAY_LENGTH;
    expect(giftEstate(s, 'merchants')).toBeNull();
    expect(estatesNow(s).merchants.loyalty, 'не складывается').toBeCloseTo(LOYALTY_BASE + PRIV_LOYALTY, 9);
    s.time += SEASON_DAYS * DAY_LENGTH - DAY_LENGTH / 2;
    expect(estatesNow(s).merchants.loyalty, 'продлён: держится сезон от второго дара').toBeCloseTo(LOYALTY_BASE + PRIV_LOYALTY, 9);
    expect(estatesOf(s).gifts).toBe(2);
  });

  it('дар без золота — отказ, ничего не списано', () => {
    const s = town((g) => (g.gold = 0));
    expect(giftEstate(s, 'knights')).toMatch(/золота/);
    expect(estatesOf(s).gifts).toBe(0);
    expect(estatesNow(s).knights.loyalty).toBe(LOYALTY_BASE);
  });
});

describe('указ сословия: открывает лояльность, снимается сам', () => {
  it('закрыт ниже 60 (отказ словами с числом), открыт с 60; даёт силу перевеса — плюс и минус', () => {
    const s = town();
    const id = ESTATE_DECREE.merchants;
    expect(estatesNow(s).merchants.loyalty, 'точка внутри: ниже порога').toBeLessThan(LOYAL);
    expect(setDecree(s, id)).toMatch(/лояльность 50 из 60/);
    expect(s.decree).toBe('none');
    grant(s, 'merchants', 1);
    expect(estatesNow(s).merchants.loyalty, 'точка внутри: верно').toBeGreaterThanOrEqual(LOYAL);
    expect(decreeBlock(s, id)).toBeNull();
    const without = estatesNow(s).merchants;
    expect(setDecree(s, id)).toBeNull();
    const n = estatesNow(s).merchants;
    expect(n.strength).toBeCloseTo(Math.min(1, without.strength + DECREE_STRENGTH), 9);
    expect(n.plus).toBeGreaterThan(without.plus);
    expect(n.minus).toBeGreaterThan(without.minus);
  });

  it('лояльность упала ниже порога — указ снят шагом, строка летописи', () => {
    const s = town();
    grant(s, 'clergy', 1);
    expect(setDecree(s, ESTATE_DECREE.clergy)).toBeNull();
    // Соперникам — по две: зависть четырёх привилегий роняет духовенство ниже 60, и дверь дарования снимает указ сама.
    grant(s, 'knights', 2);
    expect(estatesNow(s).clergy.loyalty, 'точка внутри: ниже порога').toBeLessThan(LOYAL);
    expect(s.decree).toBe('none');
    expect(s.log[0].text).toMatch(/указ «Божий мир» снят/);
    // И шаг партии — тем же правилом (дар кончился).
    const t = town();
    expect(giftEstate(t, 'knights')).toBeNull();
    expect(setDecree(t, ESTATE_DECREE.knights)).toBeNull();
    t.time += SEASON_DAYS * DAY_LENGTH + 1;
    estatesStep(t);
    expect(t.decree).toBe('none');
  });
});

describe('специализация и перевес', () => {
  it('ведущее сословие с 35 % — специализация, ниже — ровный город', () => {
    const infl = (m: number): Record<EstateId, number> => ({ merchants: m, guilds: (100 - m) / 4, peasants: (100 - m) / 4, knights: (100 - m) / 4, clergy: (100 - m) / 4 });
    expect(specialOf(infl(ESTATE_SPECIAL))).toBe('merchants');
    expect(specialOf(infl(ESTATE_SPECIAL - 0.01))).toBeNull();
    const s = town();
    grant(s, 'peasants', 2);
    raise(s, 'peasants', 3);
    const n = estatesNow(s);
    expect(n.peasants.infl, 'точка внутри').toBeGreaterThanOrEqual(ESTATE_SPECIAL);
    expect(specialOf(Object.fromEntries(ESTATES.map((e) => [e, n[e].infl])) as Record<EstateId, number>)).toBe('peasants');
  });

  it('весть «требует власти» — только в перевесе, неверное требует втрое чаще; дар — только верное, жалоба — ропщущее', () => {
    const plain = town();
    for (const e of ESTATES) {
      for (const kind of ['gift', 'plea', 'power'] as const) expect(CROWN_BY_ID[estateCrownId(kind, e)].weight(plain), `${kind} ${e}: ровная игра`).toBe(0);
    }
    const s = town((g) => raise(g, 'knights', 9));
    const n = estatesNow(s).knights;
    expect(n.infl, 'точка внутри: перевес').toBeGreaterThanOrEqual(ESTATE_DOMINANT);
    expect(n.loyalty, 'точка внутри: не верно').toBeLessThan(LOYAL);
    expect(CROWN_BY_ID[estateCrownId('power', 'knights')].weight(s)).toBe(3);
    grant(s, 'knights', 2);
    expect(estatesNow(s).knights.loyalty, 'точка внутри: верно').toBeGreaterThanOrEqual(LOYAL);
    expect(CROWN_BY_ID[estateCrownId('power', 'knights')].weight(s)).toBe(1);
    expect(CROWN_BY_ID[estateCrownId('gift', 'knights')].weight(s)).toBe(1);
    // Две опоры по две привилегии — пренебрежённые ропщут (Т3), и жалоба приходит тем чаще, чем сословие влиятельнее.
    grant(s, 'merchants', 2);
    expect(estatesNow(s).guilds.loyalty, 'точка внутри: ропщут').toBeLessThan(DISLOYAL);
    expect(CROWN_BY_ID[estateCrownId('plea', 'guilds')].weight(s)).toBeGreaterThanOrEqual(1);
    expect(crownRate(s, CROWN_BY_ID[estateCrownId('plea', 'guilds')])).toBeGreaterThan(0);
  });

  it('ответ «Даровать привилегию» — той же дверью и в счёте дарований', () => {
    const s = town((g) => raise(g, 'clergy', 9));
    applyCrown(s, estateCrownId('power', 'clergy'), 0);
    expect(estatesOf(s).priv.clergy).toBe(1);
    expect(estatesOf(s).grants).toBe(1);
  });
});

describe('ропот — причина у податных СБ-1', () => {
  it('ропщущее сословие — причина своим именем, мерой влияния и лояльности; ровное — нет; цель податных растёт на неё', () => {
    const s = town();
    expect(folkParts(s).some((p) => p.id.startsWith('estate:'))).toBe(false);
    const base = targetOf(folkParts(s));
    grant(s, 'merchants', 2);
    grant(s, 'knights', 2);
    const n = estatesNow(s).guilds;
    expect(n.loyalty, 'точка внутри: ниже ровной').toBeLessThan(LOYALTY_BASE);
    const part = folkParts(s).find((p) => p.id === 'estate:guilds');
    expect(part?.value).toBeCloseTo(murmurOf(n.infl, n.loyalty), 9);
    const sum = ['guilds', 'peasants', 'clergy'].reduce((t, e) => t + murmurOf(estatesNow(s)[e as EstateId].infl, estatesNow(s)[e as EstateId].loyalty), 0);
    expect(targetOf(folkParts(s))).toBeCloseTo(base + sum, 6);
  });

  it('духовенство в силе гасит долю налога у податных — строкой «проповедь»', () => {
    const s = town((g) => (g.tax = 'high'));
    grant(s, 'clergy', 2);
    const n = estatesNow(s).clergy;
    expect(n.plus, 'точка внутри: в силе').toBeGreaterThan(0);
    const tax = folkParts(s).find((p) => p.id === 'tax')!.value;
    expect(folkParts(s).find((p) => p.id === 'clergy')?.value).toBeCloseTo(-tax * n.plus, 9);
  });
});

describe('рычаги: опора меняет своё дело, ровный город — ничего', () => {
  it('ровный город и старая партия — все множители единица', () => {
    const s = town();
    expect(estateFoodMult(s)).toBe(1);
    expect(estateWageMult(s)).toBe(1);
    expect(estateGrowthMult(s)).toBe(1);
    expect(peasantsMult(s)).toBe(1);
    expect(clergyPiety(s)).toBe(0);
  });

  it('каждая опора — плюсом и минусом в своём рычаге, числами `ESTATE_PLUS` и `ESTATE_MINUS`', () => {
    const pillar = (e: EstateId): { s: GameState; base: GameState; n: ReturnType<typeof estatesNow>[EstateId] } => {
      const base = town((g) => (g.tax = 'high'));
      const s = town((g) => (g.tax = 'high'));
      grant(s, e, 2);
      const n = estatesNow(s)[e];
      expect(n.strength, `${e}: точка внутри — в силе`).toBeGreaterThan(0);
      expect(n.plus).toBeCloseTo(ESTATE_PLUS[e] * n.strength * (n.loyalty / LOYALTY_BASE), 9);
      expect(n.minus).toBeCloseTo(ESTATE_MINUS[e] * n.strength, 9);
      return { s, base, n };
    };
    let p = pillar('merchants');
    expect(taxIncomePerDay(p.s) - p.s.faith.id.length * 0).toBeGreaterThan(taxIncomePerDay(p.base));
    p = pillar('guilds');
    expect(buildRate(p.s) / buildRate(p.base)).toBeCloseTo(1 + p.n.plus, 6);
    expect(estateFoodMult(p.s)).toBeCloseTo(1 + p.n.minus, 9);
    p = pillar('peasants');
    expect(peasantsMult(p.s)).toBeCloseTo(1 + p.n.plus, 9);
    expect(estateGrowthMult(p.s)).toBeCloseTo(1 + p.n.plus, 9);
    expect(taxIncomePerDay(p.s)).toBeLessThan(taxIncomePerDay(p.base));
    p = pillar('knights');
    expect(armyResolve(p.s)).toBeCloseTo(FERVOUR_SCALE * p.n.plus, 9);
    expect(wageOf(p.s, 'spearman') / wageOf(p.base, 'spearman')).toBeCloseTo(1 + p.n.minus, 9);
    expect(estateGrowthMult(p.s)).toBeCloseTo(1 - p.n.minus, 9);
    p = pillar('clergy');
    expect(clergyPiety(p.s)).toBeCloseTo(PIETY_SCALE * p.n.plus, 9);
    expect(taxIncomePerDay(p.s)).toBeLessThan(taxIncomePerDay(p.base));
  });

  it('купечество в силе режет стойкость, что дали обряд, Воевода и рыцари, — долей своего минуса', () => {
    const s = town();
    grant(s, 'knights', 1);
    const kn = armyResolve(s);
    expect(kn, 'точка внутри: стойкость есть').toBeGreaterThan(0);
    grant(s, 'merchants', 2);
    const n = estatesNow(s);
    expect(armyResolve(s)).toBeCloseTo(FERVOUR_SCALE * n.knights.plus * (1 - n.merchants.minus), 9);
  });
});

describe('старое сохранение и одна дверь', () => {
  it('партия без поля — привилегий нет, лояльность ровная, версия та же; привилегии переживают запись; чужое и лишнее не садится', () => {
    const s = town();
    expect(s.estates).toBeUndefined();
    const raw = JSON.parse(serialize(s));
    delete raw.estates;
    const old = deserialize(JSON.stringify(raw));
    expect(old.estates).toBeUndefined();
    for (const e of ESTATES) expect(estatesNow(old)[e].loyalty).toBe(LOYALTY_BASE);
    expect(SAVE_VERSION).toBe(JSON.parse(serialize(old)).version ?? SAVE_VERSION);
    grant(s, 'peasants', 2);
    expect(giftEstate(s, 'clergy')).toBeNull();
    const back = deserialize(serialize(s));
    expect(back.estates).toEqual(s.estates);
    expect(estatesNow(back).peasants.loyalty).toBeCloseTo(estatesNow(s).peasants.loyalty, 9);
    expect(mergeEstates({ priv: { merchants: 7, kings: 2, clergy: -1 }, grants: -3, revokes: 2.7, gifts: 'x' })).toEqual({
      priv: { merchants: PRIV_MAX },
      grants: 0,
      revokes: 2,
      gifts: 0,
    });
    expect(mergeEstates(undefined)).toBeUndefined();
  });

  it('`GameState.estates` пишет только `sim/estates`; уровни постройки — мерка влияния по `levelsOf`', () => {
    const root = join(__dirname, '..', '..');
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) files.push(p);
      }
    };
    walk(root);
    const writers = files
      .filter((f) => /\.estates\s*(=[^=]|\?\?=)|\.(grants|revokes|gifts)\s*(\+\+|\+=|-=|=[^=])|priv\[[^\]]+\]\s*=[^=]/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(root, f).split(sep).join('/'));
    expect(writers).toEqual(['game/sim/estates.ts']);
    const s = town((g) => raise(g, 'guilds', 4));
    expect(estatesNow(s).guilds.infl).toBeCloseTo(influenceOf(levelsOf(s), undefined).guilds, 9);
    expect(estateBoon('gift', 'guilds')).toBe('es_gift_guilds');
  });
});
