// Переговоры у стен — дверь `world/parley` (docs/siege_v2.md, раздел 7; этап 2е) и отметка полководца «осада» (2.3). Свойства:
// доля пути — большее из хода к сдаче и прошедшего к голоду, к концу текущей фазы; справедливая дань — добыча × доля; дань
// не создаётся из ничего (не больше открытого склада, тайник цел, сумма — ровно цена); условия — только мягче объявленной;
// одно предложение на сторону в фазу, стоит до конца следующей; отметка «осада» — кружки лестницы опыта по осадам, до трёх,
// грань кости фазы, замороженная в окне. Границы области названы и проверены утверждениями (правило 11).
import { describe, expect, it } from 'vitest';
import { openSiege, starvesAt, type SiegeWindow } from './siege';
import { leadFaces, modsOf, phaseAt, rowsOf, type PhaseRow } from './siegeroll';
import {
  answerAfter,
  botTakesTerms,
  botTakesTribute,
  bountyOf,
  fairTribute,
  lairRansoms,
  liveOffer,
  offerAfter,
  offerBlock,
  offerUntil,
  siegeShare,
  softerThan,
  termsBlock,
  termsChoices,
  tributeGoods,
} from './parley';
import { fate } from './spoils';
import { GATES_SURE, LAIR_RANSOM_SHARE } from './data/parley';
import { SIEGE_PIPS_MAX } from './data/siegeroll';
import { pipsOf, recordSiege, siegePipsAt } from '@/game/sim/agents';
import { createInitialState } from '@/game/state';

const T0 = 1_700_000_000_000;

/** Окно осады: хлеба на ~20 игр. дн. при обычном расходе. */
const win = (over: Partial<SiegeWindow> = {}): SiegeWindow => ({
  ...openSiege({ byId: 'lair-1', campId: 'm1', now: T0, food: 4800, garrison: 40, townPerHour: 4, perManPerHour: 0.1 }),
  log: [],
  ...over,
});

const row = (at: number, out: PhaseRow['out']): PhaseRow => ({ at, die: 7, mods: {}, out, waste: 0 });

describe('доля пути осады', () => {
  it('прошедшее к голоду — к концу текущей фазы: в первую минуту осады уже доля первой фазы, не ноль', () => {
    const w = win();
    const end = starvesAt(w);
    const first = phaseAt(T0, 1);
    expect(first < end, 'точка внутри области: фаза кончается раньше голода').toBe(true);
    const at0 = siegeShare(w, T0);
    expect(at0).toBeCloseTo((first - T0) / (end - T0), 6);
    expect(at0).toBeGreaterThan(0);
    // Внутри фазы доля не растёт: начатая фаза уже засчитана.
    expect(siegeShare(w, first - 1)).toBeCloseTo(at0, 9);
    expect(siegeShare(w, first + 1)).toBeGreaterThan(at0);
  });

  it('ход к сдаче — проломы и ступени хода против хода, при котором ворота открываются и на единице кости', () => {
    // Три пролома и одна нехватка — ход 4 ступени + 3 пролома = 7 граней из 15.
    const rows = [row(phaseAt(T0, 1), 'breach'), row(phaseAt(T0, 2), 'breach'), row(phaseAt(T0, 3), 'breach'), row(phaseAt(T0, 4), 'short')];
    const w = win({ phases: rows, foodAtStart: 1e9 });
    const at = phaseAt(T0, 4) + 1;
    expect(at < starvesAt(w), 'точка внутри области: хлеба много, ход — больше голода').toBe(true);
    expect(siegeShare(w, at)).toBeCloseTo((3 + 4) / GATES_SURE, 9);
  });

  it('не больше единицы', () => {
    const w = win();
    expect(siegeShare(w, starvesAt(w) + 1e9)).toBe(1);
  });
});

describe('справедливая дань', () => {
  const stock = { food: 900, wood: 500, stone: 300 };
  const r = fate({ fate: 'captives', stock, gold: 200, stash: 100, pop: 200, bonded: 30, carry: 1e6, escort: 1e6, levels: {}, seed: 1 });

  it('добыча — потерянное добром плюс уведённые курсом обоза; дань — добыча × доля, вверх до целого', () => {
    expect(r.ledBonded.taken + r.ledPop.taken, 'точка внутри области: людей уводят').toBeGreaterThan(0);
    const b = bountyOf(r);
    expect(b).toBeGreaterThan(r.lostTotal);
    expect(fairTribute(b, 0.5)).toBe(Math.ceil(b * 0.5));
    expect(fairTribute(b, 0)).toBe(0);
    expect(fairTribute(b, 2)).toBe(Math.ceil(b));
  });

  it('у сожжения добыча — сгоревшее: дань не ноль, хотя победитель не берёт ничего', () => {
    const burn = fate({ fate: 'burn', stock, gold: 200, stash: 100, pop: 200, bonded: 30, carry: 0, escort: 0, levels: {}, seed: 1 });
    expect(burn.takenTotal).toBe(0);
    expect(bountyOf(burn)).toBe(burn.lostTotal);
    expect(bountyOf(burn)).toBeGreaterThan(0);
  });

  it('дань не создаётся из ничего: сумма — ровно цена, каждого не больше лежащего сверх тайника', () => {
    for (const price of [1, 250, 900, 5000]) {
      const g = tributeGoods(stock, 200, 100, price);
      const open = Object.values(stock).reduce((n, v) => n + v - 100, 0) + (200 - 100);
      expect(g.takenTotal).toBe(Math.min(price, open));
      for (const [k, v] of Object.entries(g.taken)) {
        const had = k === 'gold' ? 200 : stock[k as keyof typeof stock];
        expect(v, `${k} при цене ${price}`).toBeLessThanOrEqual(had - 100);
      }
    }
  });
});

describe('условия сдачи', () => {
  it('только мягче объявленной; у грабежа мягче нет', () => {
    expect(termsChoices('burn')).toEqual(['plunder', 'captives']);
    expect(termsChoices('captives')).toEqual(['plunder']);
    expect(termsChoices('plunder')).toEqual([]);
    expect(termsBlock('captives', 'plunder')).toBeNull();
    expect(termsBlock('captives', 'captives')).toBe('Условия сдачи — участь мягче объявленной.');
    expect(termsBlock('captives', 'burn')).toBe('Условия сдачи — участь мягче объявленной.');
    expect(termsBlock('plunder', 'plunder')).toMatch(/Мягче грабежа участи нет/);
    expect(softerThan('plunder', 'burn')).toBe(true);
    expect(softerThan('burn', 'plunder')).toBe(false);
  });
});

describe('предложения', () => {
  it('стоит до конца следующей фазы; одно на сторону в фазу — и принятое, и отклонённое', () => {
    const w = win();
    const at = phaseAt(T0, 1) + 1000;
    expect(offerUntil(w, at)).toBe(phaseAt(T0, 3));
    const a = { ...w, ...offerAfter(w, { kind: 'tribute', at, price: 10 }) };
    expect(liveOffer(a, 'tribute', at + 1)?.price).toBe(10);
    expect(liveOffer(a, 'tribute', phaseAt(T0, 3))).toBeNull();
    expect(offerBlock(a, 'tribute', at + 1)).toBe('В эту фазу уже предлагали. Следующее — в новой фазе.');
    // Другая сторона в ту же фазу предложить может.
    expect(offerBlock(a, 'terms', at + 1)).toBeNull();
    // В новой фазе — снова можно, даже если прежнее не отвечено.
    expect(offerBlock(a, 'tribute', phaseAt(T0, 2) + 1)).toBeNull();
    const no = { ...a, ...answerAfter(a, 'tribute', 'no', at + 2) };
    expect(liveOffer(no, 'tribute', at + 3)).toBeNull();
    expect(no.offers[0].answer).toBe('no');
  });
});

describe('ответы логова — та же формула', () => {
  it('дань — не меньше справедливой; условия — не дороже справедливой дани; выкуп — с половины пути', () => {
    expect(botTakesTribute(100, 100)).toBe(true);
    expect(botTakesTribute(99, 100)).toBe(false);
    expect(botTakesTerms(100, 100)).toBe(true);
    expect(botTakesTerms(101, 100)).toBe(false);
    expect(lairRansoms(LAIR_RANSOM_SHARE)).toBe(true);
    expect(lairRansoms(LAIR_RANSOM_SHARE - 0.01)).toBe(false);
  });
});

describe('отметка полководца «осада»', () => {
  it('кружки лестницы опыта по осадам: первая — с третьей, вторая — с девятой, третья — с восемнадцатой', () => {
    expect([0, 2, 3, 8, 9, 17, 18, 100].map(siegePipsAt)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(siegePipsAt(1e9)).toBe(SIEGE_PIPS_MAX);
  });

  it('счёт осад — у человека на месте: третья доведённая осада даёт отметку, и она едет в мир с отметками полководца', () => {
    const s = createInitialState();
    const g = s.agents?.general;
    expect(g && !g.vacant, 'точка внутри области: полководец на месте').toBe(true);
    expect(pipsOf(s).siege).toBeUndefined();
    recordSiege(s);
    recordSiege(s);
    expect(pipsOf(s).siege).toBeUndefined();
    recordSiege(s);
    expect(g!.tally.sieges).toBe(3);
    expect(pipsOf(s).siege).toBe(1);
    // Пустое место осад не засчитывает: опыт — свойство человека.
    g!.vacant = true;
    recordSiege(s);
    expect(g!.tally.sieges).toBe(3);
  });

  it('грань кости фазы за каждую, до трёх; заморожена в окне при постановке', () => {
    expect([0, 1, 2, 3, 7].map(leadFaces)).toEqual([0, 1, 2, 3, 3]);
    const w = win({ lead: 2 });
    expect(rowsOf(w)).toEqual([]);
    expect(modsOf(w, 1).general).toBe(2);
    expect(modsOf(win(), 1).general, 'нет полководца — поправки нет').toBeUndefined();
    // Пересчёт часов голода той же осады отметку переносит.
    const again = openSiege({ byId: 'lair-1', campId: 'm1', now: T0 + 1000, food: 100, garrison: 40, townPerHour: 4, perManPerHour: 0.1, since: T0, lead: w.lead });
    expect(again.lead).toBe(2);
  });
});
