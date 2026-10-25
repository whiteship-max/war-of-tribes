import { describe, expect, it } from 'vitest';
import { createInitialState } from '@/game/state';
import { RESOURCE_IDS } from '@/game/constants';
import { currentSite, maxLevelFor, storageCap, upgradeCost, upgradeInfo } from '@/game/derived';
import { BUILDING_BY_ID } from '@/game/data/buildings';
import { cancelUpgrade, startUpgrade } from '@/game/sim/actions';
import { cancelRecruit, recruitCheck, startRecruit } from '@/game/sim/army';
import { cancelForge, forgeCheck, startForge } from '@/game/sim/smithy';
import { cancelSurvey, startSurvey } from '@/game/sim/survey';
import { bondedSaleLeft, sellGoods } from '@/game/sim/market';
import { addBonded } from '@/game/sim/population';
import { tick } from '@/game/sim/tick';
import { creditTech } from '@/game/sim/tech';
import { EQUIPMENT_IDS } from '@/game/data/equipment';
import { TROOP_IDS } from '@/game/data/troops';
import type { GameState } from '@/game/types';
import { DAY_LENGTH, gameSeconds, realMs } from '@/game/pace';
import { LocalWorld } from '@/world/local/LocalWorld';
import type { WorldSave } from '@/world/local/state';
import { DEAL_PAYOUT } from '@/world/data/tuning';
import { applyEffects, playerProfile, syncAway } from '@/world/bridge';
import { awayOf } from '@/world/muster';
import type { FigureView, HomeEffect, MarchView } from '@/world/types';
import { STOCK_KEYS, type WatchCard } from '../../netlify/lib/contract';
import { flagsBetween, startedCost } from '../../netlify/lib/watch';
import { watchOf } from './snapshot';

/** Минута дневного привоза — рынок РН-1 считает привоз по настоящим часам. */
const NOW = Date.UTC(2026, 9, 23, 10);

/**
 * Правило «цена списана» таблицы города сервера (`watch.CITY_RULES`, docs/security.md) на настоящей партии игры: опись —
 * та, что шлёт игра (`watchOf`), стройка — `sim/actions.startUpgrade`, время — `sim/tick`. Честный посёлок, который
 * строится без передышки, флага «стройка без платы» не получает ни разу, а подделка той же партии — получает.
 */
const quiet = (a: WatchCard, b: WatchCard): boolean =>
  a.deeds === b.deeds && a.seen === b.seen && a.games === b.games && a.away === b.away && a.caravans === b.caravans;

describe('стройка без платы: честная партия против подделки', () => {
  it('четыре часа стройки без передышки: правило спрошено много раз, флага нет; склад, не убывший на цену, — флаг', () => {
    const s = createInitialState(5);
    for (const r of RESOURCE_IDS) s.resources[r] = storageCap(s);
    s.morale = 100;
    let a = watchOf(s);
    let asked = 0;
    let caught = 0;
    for (let m = 1; m <= 240; m++) {
      if (!currentSite(s)) {
        const next = s.buildings
          .filter((b) => b.level < maxLevelFor(b.type) && !upgradeInfo(s, b).blocked)
          .sort((x, y) => upgradeInfo(s, x).work - upgradeInfo(s, y).work)[0];
        if (next) startUpgrade(s, next.id);
      }
      tick(s, gameSeconds(60));
      const b = watchOf(s);
      const flags = flagsBetween(a, (m - 1) * 60_000, b, m * 60_000).map((f) => f.kind);
      expect(flags, `минута ${m}`).not.toContain('unpaid');
      // Точка внутри правила: на первой описи стройки не было, между описями её начали, разовых дел не было.
      if (!a.site && startedCost(a, b).levels > 0 && quiet(a, b)) {
        asked++;
        // Подделка той же минуты: уровень заложен, а склад остался прежним — цена не ушла.
        const forged = { ...b, stock: { ...a.stock } };
        if (flagsBetween(a, (m - 1) * 60_000, forged, m * 60_000).some((f) => f.kind === 'unpaid')) caught++;
      }
      a = b;
    }
    expect(asked, 'правило спрошено').toBeGreaterThanOrEqual(5);
    expect(caught).toBe(asked);
  });
});

/**
 * Часы описи — целые игровые секунды (`watchOf`, `contract.readWatch`), а при шкале ×30 игровая секунда — полминуты
 * настоящего времени. Две записи внутри одной секунды (быстрая запись после смены раскладки, перезапуск) показывают одно
 * время, хотя выработка шла: 16.10.2026 так легло «Древесина +29 за 21 с … не больше 1» (docs/security.md, раздел 8).
 */
describe('рост склада: часы описи — целые игровые секунды', () => {
  it('записи через 21 с внутри одной игровой секунды: выработка этой секунды флага не даёт, тройная — даёт', () => {
    const REAL_MS = 21_000;
    // Граница области: промежуток короче игровой секунды — только в нём две описи могут показать одно время.
    expect(REAL_MS).toBeLessThan(realMs(1));
    const s = createInitialState(5);
    for (const r of RESOURCE_IDS) s.resources[r] = 0;
    s.morale = 100;
    let asked = 0;
    let caught = 0;
    for (let i = 0; i < 300; i++) {
      const a = watchOf(s);
      tick(s, gameSeconds(REAL_MS / 1000));
      const b = watchOf(s);
      const at = i * 60_000;
      expect(flagsBetween(a, at, b, at + REAL_MS).map((f) => f.kind), `запись ${i}`).not.toContain('stock');
      // Точка внутри правила: разовых дел не было, часы описи не сдвинулись, а припас вырос больше единицы — без поправки
      // на точность часов правило разрешило бы ровно единицу.
      const k = STOCK_KEYS.reduce((x, y) => ((b.stock[y] ?? 0) - (a.stock[y] ?? 0) > (b.stock[x] ?? 0) - (a.stock[x] ?? 0) ? y : x));
      if (quiet(a, b) && b.time === a.time && (b.stock[k] ?? 0) - (a.stock[k] ?? 0) > 1) {
        asked++;
        // Подделка той же записи: втрое больше выработки игровой секунды.
        const tick1 = Math.ceil(Math.max(a.prod[k] ?? 0, b.prod[k] ?? 0) / DAY_LENGTH);
        const forged = { ...b, stock: { ...b.stock, [k]: (a.stock[k] ?? 0) + 3 * tick1 + 2 } };
        if (flagsBetween(a, at, forged, at + REAL_MS).some((f) => f.kind === 'stock')) caught++;
      }
    }
    expect(asked, 'правило спрошено').toBeGreaterThanOrEqual(20);
    expect(caught).toBe(asked);
  });
});

/**
 * Добро без дела (docs/security.md, раздел 8; docs/bughunt.md, «Сервер», п. 2): отмена заказа возвращает цену на склад
 * разом (`sim/pay.refund`), продажа невольников — золото (`sim/market.sellBonded`), договор — дань и торговлю
 * последствием мира без боя (`sim/expedition.applyExpedition`). Прежде ни одно не входило в разовые дела описи, и честная
 * отмена через минуту давала админу «Древесина +128 за 1 мин без разовых дел». Теперь это дело (`stats.windfalls`):
 * флага нет, а та же запись без дела — флаг. Кроме отмены стройки (СТ-1): её возврат сервер сверяет очередью, и делом он
 * не считается — свой тест ниже.
 */
describe('рост склада: добро без дела', () => {
  /** Флаги записи и её подделки: те же числа, а разовых дел (и добра без дела среди них, AC-1) — сколько было на первой описи. */
  const judge = (a: WatchCard, aAt: number, b: WatchCard, bAt: number): { honest: string[]; forged: string[] } => ({
    honest: flagsBetween(a, aAt, b, bAt).map((f) => f.kind),
    forged: flagsBetween(a, aAt, { ...b, deeds: a.deeds, windfalls: a.windfalls }, bAt).map((f) => f.kind),
  });

  /**
   * Посёлок, которому есть чем платить и куда принять возврат: склад наполовину, снаряжение в запасе, и военная ступень
   * засчитана по нему той же дверью, что приведённой партии (`sim/tech.creditTech`), — иначе кузнице нечего ковать.
   */
  const town = (): GameState => {
    const s = createInitialState(5);
    for (const r of RESOURCE_IDS) s.resources[r] = Math.floor(storageCap(s) / 2);
    for (const id of EQUIPMENT_IDS) s.equipment[id] = 100;
    creditTech(s);
    s.morale = 100;
    return s;
  };

  /** Заказ и его отмена: первый вызов ставит заказ, возвращённый — отменяет. */
  const deeds: [string, (s: GameState) => () => string | null][] = [
    [
      'отмена найма',
      (s) => {
        const troop = TROOP_IDS.find((t) => !recruitCheck(s, t, 5).blocked)!;
        expect(startRecruit(s, troop, 5)).toBeNull();
        return () => cancelRecruit(s, s.recruits[s.recruits.length - 1].id);
      },
    ],
    [
      'отмена ковки',
      (s) => {
        const item = EQUIPMENT_IDS.find((id) => !forgeCheck(s, id, 40).blocked)!;
        expect(startForge(s, item, 40)).toBeNull();
        return () => cancelForge(s, s.forge[s.forge.length - 1].id);
      },
    ],
    [
      'отмена разведки округи',
      (s) => {
        expect(startSurvey(s)).toBeNull();
        return () => cancelSurvey(s);
      },
    ],
    [
      'продажа невольников',
      (s) => {
        addBonded(s, 20);
        return () => sellGoods(s, 'bonded', Math.min(5, bondedSaleLeft(s, NOW)), NOW);
      },
    ],
  ];

  it.each(deeds)('%s: флага нет, та же запись без дела — флаг', (name, order) => {
    const s = town();
    const deed = order(s);
    // Заказ постоял, как в живой игре: заложили — через минуту отменили.
    tick(s, gameSeconds(30));
    const a = watchOf(s);
    tick(s, gameSeconds(30));
    expect(deed(), name).toBeNull();
    const b = watchOf(s);
    const { honest, forged } = judge(a, 0, b, 30_000);
    expect(honest, `${name}: честная запись`).not.toContain('stock');
    // Точка внутри правила: без дела склад вырос сильнее, чем позволяла выработка полуминуты, — правило спрошено.
    expect(forged, `${name}: та же запись без дела`).toContain('stock');
    expect(b.deeds - a.deeds, `${name}: одно разовое дело`).toBe(1);
  });

  // СТ-1 (docs/ui_v2.md, 5.13, решение 5): возврат отменённой стройки — не разовое дело. Положенное сервер выводит сам из
  // очередей двух описей (`watch.cancelledRefund`): честная отмена — без флагов, назвавшая больше положенного — «возврат
  // сверх положенного». Область: стройка начата до первой описи (работа есть) — положена половина цены.
  it('отмена стройки: разового дела нет, честный возврат без флагов, сверх положенного — флаг «возврат»', () => {
    const s = town();
    const b = s.buildings.filter((x) => x.level < maxLevelFor(x.type) && !upgradeInfo(s, x).blocked)[0];
    expect(startUpgrade(s, b.id)).toBeNull();
    tick(s, gameSeconds(30));
    expect(b.work, 'точка внутри правила: стройка начата').toBeGreaterThan(0);
    const a = watchOf(s);
    tick(s, gameSeconds(30));
    expect(cancelUpgrade(s, b.id)).toBeNull();
    const after = watchOf(s);
    expect(after.deeds - a.deeds, 'разового дела нет').toBe(0);
    const kinds = (x: WatchCard): string[] => flagsBetween(a, 0, x, 30_000).map((f) => f.kind);
    expect(kinds(after)).toEqual([]);
    const cost = upgradeCost(BUILDING_BY_ID[b.type], b.level + 1);
    const forged = { ...after, stock: Object.fromEntries(Object.entries(after.stock).map(([k, v]) => [k, v + Math.ceil((cost[k as keyof typeof cost] ?? 0) / 2)])) };
    expect(kinds(forged)).toContain('refund');
  });

  it('дань и торговля по договору: последствие мира без боя — флага нет, та же запись без дела — флаг', async () => {
    let now = 1_700_000_000_000;
    const world = new LocalWorld({ seed: 7, now: () => now, storage: null });
    const s = createInitialState(7);
    for (const r of RESOURCE_IDS) s.resources[r] = 0;
    s.gold = 0;
    s.morale = 100;
    const last = { marches: [] as MarchView[], figures: [] as FigureView[] };
    // Пульс мира, как в `world/store`: слепок → мир → последствия → ушедшие.
    const pulse = async (): Promise<void> => {
      const p = await world.sync(playerProfile(s, awayOf(last.marches, last.figures)));
      applyEffects(s, p.effects);
      syncAway(s, p.marches, p.figures);
      last.marches = p.marches;
      last.figures = p.figures;
    };
    await pulse();
    // Договоры с державой, выплата — через полсекунды: подписать их — дело дипломата у чужих стен, здесь меряют выплату.
    // Держав в нынешнем мире нет — генерация ставит одни логова (`gen.makeLair`), — и выплата считает от одного двора.
    const tribeId = 'test';
    const paidAt = now - DEAL_PAYOUT + 500;
    (world as unknown as { save: WorldSave }).save.pacts[tribeId] = { tribute: { until: now + DEAL_PAYOUT * 4, paidAt }, trade: { until: now + DEAL_PAYOUT * 4, paidAt } };
    const a = watchOf(s);
    tick(s, gameSeconds(1));
    now += 1_000;
    await pulse();
    const b = watchOf(s);
    const { honest, forged } = judge(a, 0, b, 1_000);
    expect(s.log.some((e) => /Дань от державы/.test(e.text)), 'дань пришла').toBe(true);
    expect(s.log.some((e) => /Торговля с державой/.test(e.text)), 'торговля принесла золото').toBe(true);
    expect(honest, 'честная запись').not.toContain('stock');
    // Точка внутри правила: без дела добро выросло сильнее выработки секунды — правило спрошено.
    expect(forged, 'та же запись без дела').toContain('stock');
    expect(b.deeds - a.deeds, 'два разовых дела: дань и торговля').toBe(2);
  });

  it('кража лазутчика у соседа: последствие с делом агента, но без счётчика дел — флага нет, та же запись без дела — флаг', () => {
    const s = town();
    // Первый шаг закрывает задания, которые посёлок уже выполнил: их награды — свои разовые дела.
    tick(s, gameSeconds(30));
    const a = watchOf(s);
    tick(s, gameSeconds(30));
    // Последствие той формы, что кладёт мир по итогу сервера войны (`LocalWorld`, «spy-…-eff»): дело агента идёт в его
    // опыт, а не в разовые дела описи. Шкуры — как во флаге боевого сервера 16.10 («Шкуры +204 за 1 мин»).
    const stolen: HomeEffect['resources'] = { hides: 204 };
    applyEffects(s, [
      { id: 'spy-1-eff', lost: {}, resources: stolen, prestige: 2, morale: 1, battle: null, deed: { agent: 'spy', ok: true, at: 1 }, text: 'Кража.', good: true },
    ]);
    const b = watchOf(s);
    const { honest, forged } = judge(a, 0, b, 30_000);
    expect((b.stock.hides ?? 0) - (a.stock.hides ?? 0), 'шкуры легли на склад').toBeGreaterThanOrEqual(204);
    expect(honest, 'честная запись').not.toContain('stock');
    // Точка внутри правила: без дела шкуры выросли сильнее выработки полуминуты — правило спрошено.
    expect(forged, 'та же запись без дела').toContain('stock');
    expect(b.deeds - a.deeds, 'одно разовое дело').toBe(1);
  });

  it('последствие с боем: дело уже засчитано победой, второй раз не считается', () => {
    const s = town();
    tick(s, gameSeconds(30));
    const a = watchOf(s);
    applyEffects(s, [{ id: 'win-1', lost: {}, resources: { hides: 204 }, prestige: 0, morale: 0, battle: 'won', text: 'Победа.', good: true }]);
    const b = watchOf(s);
    expect(b.won - a.won).toBe(1);
    expect(b.deeds - a.deeds, 'одно дело — победа').toBe(1);
  });
});
