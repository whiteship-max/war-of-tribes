// Честная партия с разовыми делами: шесть часов записей раз в минуту — ни одного ложного флага (AC-1 аудита, обязательный
// тест решения владельца, docs/audit/OWNER-DECISIONS.md, п. 2). Опись — та, что шлёт игра (`watchOf`), дела — двери игры:
// вести и вести державы, ежедневка, промысел, бой у ворот, логово с добычей, отмена ковки, дань без боя, покупка с караваном,
// дело лавки, указ, поражение с убылью. Сервер сверяет каждую минуту: рост склада и войска (`watch.flagsBetween`) и книгу
// запасов (`goods.goodsStep`). Подделка той же минуты — склад сверх допуска — поймана.
import { describe, expect, it } from 'vitest';
import { createInitialState } from '@/game/state';
import { RESOURCE_IDS } from '@/game/constants';
import { maxLevelFor, storageCap } from '@/game/derived';
import type { GameState } from '@/game/types';
import { EQUIPMENT_IDS } from '@/game/data/equipment';
import { EVENTS, eventBlock } from '@/game/data/events';
import { FAITHS } from '@/game/data/faiths';
import { GOODS } from '@/game/data/market';
import { MINIGAMES } from '@/game/data/minigames';
import { SHOP_LOT } from '@/game/gemrules';
import { gameSeconds } from '@/game/pace';
import { creditTech } from '@/game/sim/tech';
import { tick } from '@/game/sim/tick';
import { eventId, raiseEvent, resolveEvent } from '@/game/sim/mail';
import { finishDaily, startDaily } from '@/game/sim/daily';
import { beginMinigame, canPlay, harvest } from '@/game/sim/minigames';
import { dropGates, settleGate } from '@/game/sim/gate';
import { applyExpedition, type ExpeditionOutcome } from '@/game/sim/expedition';
import { cancelForge, forgeCheck, startForge } from '@/game/sim/smithy';
import { buyGoods, marketCheck } from '@/game/sim/market';
import { applyGemDeeds } from '@/game/sim/gems';
import { applyGrants } from '@/game/sim/admin';
import { addBonded } from '@/game/sim/population';
import type { HomeEffect } from '@/world/types';
import type { AdminGrant, WatchCard } from '../../netlify/lib/contract';
import { flagsBetween } from '../../netlify/lib/watch';
import { goodsStep, holdsBetween, type GoodsBook, type GoodsCtx } from '../../netlify/lib/goods';
import { deedGain } from '../../netlify/lib/deeds';
import { watchOf } from './snapshot';

/** Минута дневного привоза — рынок РН-1 считает привоз по настоящим часам. */
const NOW = Date.UTC(2026, 9, 23, 10);
const MIN = 60_000;

/** Флаги, которые решает допуск дел (AC-1): рост склада, возврат, плата за стройку, войско, счёт дел. */
const AC1 = new Set(['stock', 'refund', 'unpaid', 'army', 'deeds']);

/** Посёлок, которому есть чем платить и куда принять: склад наполовину, казна, снаряжение, ступени, войско и невольники. */
function town(): GameState {
  const s = createInitialState(9);
  for (const b of s.buildings) b.level = Math.min(maxLevelFor(b.type), 5);
  for (const r of RESOURCE_IDS) s.resources[r] = Math.floor(storageCap(s) / 2);
  for (const id of EQUIPMENT_IDS) s.equipment[id] = 100;
  s.gold = 5000;
  s.faith.id = FAITHS[0].id;
  creditTech(s);
  s.morale = 100;
  s.army.spearman = 60;
  s.army.rider = 20;
  addBonded(s, 30);
  return s;
}

const ctxOf = (c: WatchCard, grants: readonly AdminGrant[]): GoodsCtx => ({
  grants,
  levels: c.buildings,
  pop: c.pop,
  soldiers: Object.values(c.troops).reduce((t, n) => t + n, 0) + c.wounded + c.queued,
});

/** Последствие похода: только заданное. */
const outcome = (o: Partial<ExpeditionOutcome>): ExpeditionOutcome => ({ warriorsLost: 0, scoutsLost: 0, morale: 0, resources: {}, ...o }) as ExpeditionOutcome;

describe('AC-1: честная партия с делами — без ложных флагов', () => {
  it('шесть часов записей раз в минуту: вести, ежедневка, промысел, бои, логово, возврат, дань, караван, лавка, указ, поражение', () => {
    const s = town();
    const grants: AdminGrant[] = [];
    let a = watchOf(s);
    let book: GoodsBook = goodsStep(null, undefined, 0, a, 0, ctxOf(a, grants)).book;
    let ev = 0;
    let gem = 0;
    let forge: number | null = null;
    const done = new Map<string, number>();
    const did = (what: string): void => void done.set(what, (done.get(what) ?? 0) + 1);
    let asked = 0;
    let caught = 0;
    let held = 0;

    for (let m = 1; m <= 360; m++) {
      const now = NOW + m * MIN;
      // Весть — каждые три минуты, по кругу всех вестей, первым ответом, который не погашен ценой.
      if (m % 3 === 1) {
        const def = EVENTS[ev++ % EVENTS.length];
        raiseEvent(s, def.id);
        const on = s.inbox.find((e) => e.defId === def.id);
        const i = on ? def.options.findIndex((o) => !eventBlock(o, s)) : -1;
        if (on && i >= 0 && !resolveEvent(s, i, eventId(on)).error) did('весть');
        // Весть позвала к воротам (волки, разбойники) — мир бьётся и побеждает: трофеи вести и победа.
        for (const call of [...(s.gate ?? [])]) {
          if (call.foe === 'rebels') continue;
          applyExpedition(s, outcome({ battle: 'won' }));
          settleGate(s, { gate: call.id, battle: 'won' } as HomeEffect);
          dropGates(s, [call.id]);
          did('бой у ворот');
        }
      }
      if (m % 30 === 2 && !startDaily(s, m) && !finishDaily(s, m, true)) did('ежедневка');
      if (m % 10 === 3 && canPlay(s, now)) {
        const out = beginMinigame(s, MINIGAMES[m % MINIGAMES.length].id, now);
        if (typeof out !== 'string' && typeof harvest(s, out, now, 1) !== 'string') did('промысел');
      }
      // Логово сожжено: добыча — меньше груза дружины (80 бойцов по 750).
      if (m % 40 === 5) {
        applyExpedition(s, outcome({ battle: 'won', lair: true, resources: { wood: 4000, iron: 1500, food: 2000 }, gold: 600 }));
        did('логово');
      }
      // Заказ ковки и его отмена через минуту — возврат цены (добро без дела).
      if (m % 25 === 6) {
        const item = EQUIPMENT_IDS.find((id) => !forgeCheck(s, id, 30).blocked);
        if (item && !startForge(s, item, 30)) forge = s.forge[s.forge.length - 1].id;
      }
      if (m % 25 === 7 && forge !== null) {
        if (!cancelForge(s, forge)) did('отмена ковки');
        forge = null;
      }
      // Дань по договору — последствие мира без боя (добро без дела).
      if (m % 45 === 8) {
        applyExpedition(s, outcome({ resources: { food: 600, hides: 200 }, gold: 300 }));
        did('дань');
      }
      if (m % 33 === 9) {
        const g = GOODS.find((x) => x.resource && !marketCheck(s, x.id, 20, now).blocked);
        if (g && !buyGoods(s, g.id, 20, now)) did('покупка');
      }
      if (m % 50 === 10) {
        applyGemDeeds(s, [{ n: ++gem, at: now, delta: -20, kind: 'buy', res: 'stone', amount: SHOP_LOT }]);
        did('лавка');
      }
      if (m % 60 === 11) {
        grants.push({ n: grants.length + 1, at: now, stock: { iron: 400, gold: 200 }, troops: { spearman: 5 } });
        applyGrants(s, grants);
        did('указ');
      }
      // Поражение: набег унёс со склада.
      if (m % 90 === 12) {
        applyExpedition(s, outcome({ battle: 'lost', resources: { food: -900, wood: -700 } }));
        did('поражение');
      }

      tick(s, gameSeconds(60));
      const b = watchOf(s);
      const aAt = (m - 1) * MIN;
      const bAt = m * MIN;
      const flags = flagsBetween(a, aAt, b, bAt, { grants }).filter((f) => AC1.has(f.kind));
      expect(flags, `минута ${m}: ${flags.map((f) => f.text).join(' | ')}`).toEqual([]);
      const step = goodsStep(book, a, aAt, b, bAt, ctxOf(b, grants));
      expect(step.hidden, `минута ${m}: книга запасов`).toEqual([]);
      if (holdsBetween(a, b, MIN, { grants })) held++;

      // Точки внутри правила: были дела, а допуск по каждому виду склада конечен — правило спрошено. Подделка той же минуты —
      // древесина сверх допуска — флаг «рост склада».
      const gain = deedGain(a, b, MIN, b.prod, { grants });
      if (b.deeds > a.deeds && Number.isFinite(gain.wood ?? Infinity)) {
        asked++;
        const forged = { ...b, stock: { ...b.stock, wood: (a.stock.wood ?? 0) + (gain.wood ?? 0) + 10 * storageCap(s) } };
        if (flagsBetween(a, aAt, forged, bAt, { grants }).some((f) => f.kind === 'stock')) caught++;
      }
      book = step.book;
      a = b;
    }

    // Все виды дел правда случились.
    for (const what of ['весть', 'ежедневка', 'промысел', 'бой у ворот', 'логово', 'отмена ковки', 'дань', 'покупка', 'лавка', 'указ', 'поражение']) {
      expect(done.get(what) ?? 0, what).toBeGreaterThan(0);
    }
    expect(asked, 'минуты с делами, где допуск спрошен').toBeGreaterThanOrEqual(100);
    expect(caught).toBe(asked);
    expect(held, 'минуты, где книга держит границу').toBeGreaterThanOrEqual(100);
  });
});
