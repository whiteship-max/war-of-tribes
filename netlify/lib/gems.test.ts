import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gems } from './routes/gems.js';
import { save } from './routes/save.js';
import { botWith } from './routes/bot.js';
import { STORES, type Kv, type Stores } from './kv.js';
import type { Telegram } from './telegram.js';
import { FROZEN_KEY } from './admin.js';
import { RUSH_REPEAT_MS, applyGemOrder, creditGems, gemNoteOf, openLedger, readLedger, shopToday, type GemLedger } from './gems.js';
import type { GemOrder, GemsResponse, WatchCard } from './contract.js';
import {
  GEM_REF_RATE,
  RUSH_FREE_SECONDS,
  SHOP_DAILY,
  SHOP_GOODS,
  SHOP_LOT,
  START_GEMS,
  fullWork,
  gemsForWait,
  rushPriceOfWork,
  rushSeconds,
  shopDay,
  shopPrice,
  shopResetAt,
} from '../../src/game/gemrules.js';
import { gameSeconds } from '../../src/game/pace.js';
import { DAY_MS } from '../../src/game/time.js';

/**
 * Книга алмазов на сервере (docs/gems.md). Тесты там, где без них можно начислить из ничего, списать дважды, обойти лимит
 * лавки или уйти в минус: стартовые — ровно один раз и при гонке; повтор ключа не списывает; два приказа разом не
 * списывают из одного баланса дважды; лавка — десять покупок в сутки по серверным часам; ускорение не дороже показанного
 * и не дешевле полного труда уровня; заморозка закрывает приказы; админ только читает.
 */
const TOKEN = '123456:AA-test-token-not-a-real-one';
const SECRET = 'test-secret_0123';
const ADMIN = 4242;
// Полдень: до полуночи UTC далеко, лавка не сменит сутки посреди теста.
const NOW = shopDay(1_900_000_000_000) * DAY_MS + DAY_MS / 2;

function memoryStores() {
  const data = new Map<string, Map<string, { value: string; etag: string }>>();
  let n = 0;
  const kv = (name: string): Kv => {
    const m = data.get(name) ?? new Map();
    data.set(name, m);
    return {
      async getWithMetadata(key) {
        const v = m.get(key);
        // Отдаём управление: так два запроса разом читают одно и то же, как на настоящем хранилище.
        await Promise.resolve();
        return v ? { data: v.value, etag: v.etag } : null;
      },
      async setJSON(key, value, opts) {
        const had = m.get(key);
        if (opts?.onlyIfNew && had) return { modified: false };
        if (opts?.onlyIfMatch && had?.etag !== opts.onlyIfMatch) return { modified: false };
        const etag = `e${++n}`;
        m.set(key, { value: JSON.stringify(value), etag });
        return { modified: true, etag };
      },
      async set(key, value) {
        m.set(key, { value, etag: `e${++n}` });
      },
      async list(opts) {
        return { blobs: [...m.keys()].filter((k) => k.startsWith(opts.prefix ?? '')).map((key) => ({ key })), directories: [] };
      },
      async delete(key) {
        m.delete(key);
      },
    };
  };
  const stores: Stores = (name) => kv(name);
  const ledger = (player: number): GemLedger | null => {
    const v = data.get(STORES.gems)?.get(`tg-${player}`);
    return v ? readLedger(JSON.parse(v.value)) : null;
  };
  return { stores, data, ledger };
}

function signInit(id: number): string {
  const fields: Record<string, string> = { auth_date: String(Math.floor(NOW / 1000) - 60), user: JSON.stringify({ id, username: `p${id}` }) };
  const check = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const p = new URLSearchParams(fields);
  p.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return p.toString();
}

async function call(s: ReturnType<typeof memoryStores>, player: number, order?: unknown, now = NOW) {
  const req = new Request('https://x/api/gems', {
    method: order ? 'POST' : 'GET',
    headers: { 'x-telegram-init-data': signInit(player), ...(order ? { 'content-type': 'application/json' } : {}) },
    ...(order ? { body: JSON.stringify(order) } : {}),
  });
  const res = await gems(req, { stores: s.stores, now, ip: null });
  return { status: res.status, body: (await res.json()) as GemsResponse };
}

// Сито частоты (`http.allow`) общее на процесс: у каждого теста свой игрок.
let next = 9000;
const player = (): number => ++next;

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'ADMIN_IDS']) saved[k] = process.env[k];
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
  process.env.ADMIN_IDS = String(ADMIN);
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const buy = (key: string, res: GemOrder & { op: 'buy' } extends { res: infer R } ? R : never = 'stone'): GemOrder => ({ op: 'buy', key, res });

// Работа стройки на столько настоящих секунд нормативного ожидания.
const workFor = (seconds: number): number => gameSeconds(seconds) * GEM_REF_RATE;

describe('начисление: стартовые один раз, больше ниоткуда', () => {
  it('новая книга — стартовые одной записью; тот же ключ второй раз ничего не начисляет', () => {
    const l = openLedger(NOW);
    expect(l.balance).toBe(START_GEMS);
    expect(l.list.map((e) => [e.kind, e.delta])).toEqual([['start', START_GEMS]]);
    const again = creditGems(l, { source: 'start', amount: START_GEMS, key: 'start', at: NOW + 1 });
    expect(typeof again === 'string' ? again : again.ledger.balance).toBe(START_GEMS);
  });

  it('начисление без источника, пустое или дробное — отказ', () => {
    const l = openLedger(NOW);
    // @ts-expect-error — источника «приказ игрока» нет, и подставить его нельзя.
    expect(creditGems(l, { source: 'buy', amount: 10, key: 'k1', at: NOW })).toBe('Алмазы начисляют только стартовые и покупка.');
    expect(creditGems(l, { source: 'purchase', amount: 0, key: 'k2', at: NOW })).toBe('Пустое начисление.');
    expect(creditGems(l, { source: 'purchase', amount: 2.5, key: 'k3', at: NOW })).toBe('Пустое начисление.');
  });

  /**
   * Свойство: ни один приказ игрока не прибавляет к балансу — на решётке приказов всех видов, в том числе кривых (цена
   * ноль, отрицательная работа, чужая постройка, повтор ключа). Точки внутри области: баланс хватает на каждую трату.
   */
  it('ни один приказ не прибавляет алмазов', () => {
    let l: GemLedger = { ...openLedger(NOW), balance: 100_000 };
    const orders: GemOrder[] = [
      ...SHOP_GOODS.map((res, i) => ({ op: 'buy' as const, key: `b-${i}-xx`, res })),
      { op: 'rush', key: 'r-1-xxxx', building: 'houses', level: 2, work: workFor(3600), price: 1000 },
      { op: 'rush', key: 'r-2-xxxx', building: 'houses', level: 2, work: 0, price: 0 },
      { op: 'rush', key: 'r-3-xxxx', building: 'nowhere', level: 2, work: 1e9, price: 1e9 },
      { op: 'rush', key: 'r-4-xxxx', building: 'palisade', level: 99, work: 1e9, price: 1e9 },
      { op: 'rush', key: 'r-1-xxxx', building: 'market', level: 3, work: workFor(7200), price: 1000 },
    ];
    for (const o of orders) {
      const before = l.balance;
      const step = applyGemOrder(l, o, NOW);
      if (step.ledger) l = step.ledger;
      expect(l.balance, o.key).toBeLessThanOrEqual(before);
    }
    expect(l.balance).toBeLessThan(100_000);
  });

  it('первый вход открывает книгу со стартовыми; второй — нет', async () => {
    const s = memoryStores();
    const p = player();
    const first = await call(s, p);
    expect(first.status).toBe(200);
    expect(first.body.balance).toBe(START_GEMS);
    const second = await call(s, p);
    expect(second.body.balance).toBe(START_GEMS);
    expect(s.ledger(p)!.list.filter((e) => e.kind === 'start')).toHaveLength(1);
  });

  it('пять первых входов разом — стартовые один раз', async () => {
    const s = memoryStores();
    const p = player();
    const all = await Promise.all([1, 2, 3, 4, 5].map(() => call(s, p)));
    for (const r of all) expect(r.body.balance).toBe(START_GEMS);
    expect(s.ledger(p)!.balance).toBe(START_GEMS);
    expect(s.ledger(p)!.list).toHaveLength(1);
  });

  /**
   * В журнале игрока запись «стартовые» одна, что бы ни шло дальше: входы через `/api/gems` и через сохранение
   * вперемешку с тратами, в разные минуты и сутки. Точки внутри области: книга уже открыта (вторых стартовых взяться
   * неоткуда, кроме ошибки открытия), и приказы проходят — журнал растёт.
   */
  it('стартовые в журнале одной строкой при любом ходе входов и трат', async () => {
    const s = memoryStores();
    const p = player();
    const savePull = async (now: number): Promise<void> => {
      const req = new Request('https://x/api/save', { method: 'GET', headers: { 'x-telegram-init-data': signInit(p) } });
      await save(req, { stores: s.stores, now, ip: null });
    };
    for (let i = 0; i < 12; i++) {
      // Полтора часа на шаг: восемнадцать часов, через полночь UTC, — внутри срока подписи.
      const now = NOW + i * 5_400_000;
      if (i % 3 === 0) await savePull(now);
      const r = await call(s, p, i % 2 === 0 ? undefined : buy(`k-run-${i}`, 'food'), now);
      expect(r.status, `шаг ${i}`).toBe(200);
    }
    const l = s.ledger(p)!;
    expect(l.list.filter((e) => e.kind === 'buy').length, 'точка внутри области: траты шли').toBeGreaterThan(3);
    expect(l.list.filter((e) => e.kind === 'start')).toHaveLength(1);
    expect(l.list.filter((e) => e.delta > 0)).toHaveLength(1);
  });

  it('сохранение открывает книгу тем же входом и везёт записку', async () => {
    const s = memoryStores();
    const p = player();
    const req = new Request('https://x/api/save', { method: 'GET', headers: { 'x-telegram-init-data': signInit(p) } });
    const res = await save(req, { stores: s.stores, now: NOW, ip: null });
    const body = (await res.json()) as { gems?: { balance: number } };
    expect(body.gems?.balance).toBe(START_GEMS);
    expect((await call(s, p)).body.balance).toBe(START_GEMS);
  });
});

describe('трата: атомарно, с ключом повтора', () => {
  it('повтор того же ключа не списывает второй раз и отвечает той же записью', async () => {
    const s = memoryStores();
    const p = player();
    const a = await call(s, p, buy('k-once-1'));
    const b = await call(s, p, buy('k-once-1'));
    expect(a.body.error).toBeUndefined();
    expect(b.body.entry).toEqual(a.body.entry);
    expect(b.body.balance).toBe(START_GEMS - shopPrice('stone'));
    expect(s.ledger(p)!.list.filter((e) => e.kind === 'buy')).toHaveLength(1);
  });

  it('тот же ключ разом — одно списание', async () => {
    const s = memoryStores();
    const p = player();
    await call(s, p);
    const both = await Promise.all([call(s, p, buy('k-race-1')), call(s, p, buy('k-race-1'))]);
    expect(both[0].body.entry?.n).toBe(both[1].body.entry?.n);
    expect(s.ledger(p)!.balance).toBe(START_GEMS - shopPrice('stone'));
  });

  /** Точка внутри области: баланса хватает ровно на одну покупку — вторая обязана упереться в него, а не в лимит. */
  it('два приказа разом не списывают из одного баланса дважды и не уводят в минус', async () => {
    const s = memoryStores();
    const p = player();
    await call(s, p);
    const price = shopPrice('iron');
    // Стартовых хватает ровно на одну покупку железа: утверждения ниже держат точку внутри области.
    const l0 = s.ledger(p)!;
    expect(l0.balance, 'хватает на одну').toBeGreaterThanOrEqual(price);
    expect(l0.balance, 'не хватает на две').toBeLessThan(2 * price);
    expect(l0.shop.used + 2, 'в лимите лавки').toBeLessThanOrEqual(SHOP_DAILY);
    const both = await Promise.all([call(s, p, buy('k-two-1', 'iron')), call(s, p, buy('k-two-2', 'iron'))]);
    const ok = both.filter((r) => !r.body.error);
    expect(ok).toHaveLength(1);
    expect(both.find((r) => r.body.error)?.body.error).toMatch(/^Не хватает алмазов/);
    expect(s.ledger(p)!.balance).toBe(l0.balance - price);
    expect(s.ledger(p)!.balance).toBeGreaterThanOrEqual(0);
  });

  it('не хватает — отказ, книга не тронута', () => {
    const l = { ...openLedger(NOW), balance: shopPrice('iron') - 1 };
    const step = applyGemOrder(l, buy('k-poor-1', 'iron'), NOW);
    expect(step.ledger).toBeNull();
    expect(step.error).toMatch(/^Не хватает алмазов/);
  });

  it('замороженному приказ — отказ, алмазы целы; книгу он видит', async () => {
    const s = memoryStores();
    const p = player();
    await call(s, p);
    await s.stores(STORES.admin).setJSON(FROZEN_KEY, { v: 1, keys: { [`tg-${p}`]: { at: NOW, by: ADMIN, why: 'тест' } } });
    const r = await call(s, p, buy('k-ice-1'));
    expect(r.body.error).toBe('Счёт заморожен. Приказы не принимаются.');
    expect(r.body.balance).toBe(START_GEMS);
    expect(s.ledger(p)!.balance).toBe(START_GEMS);
  });

  it('кривой приказ — 400 и ничего не списано', async () => {
    const s = memoryStores();
    const p = player();
    for (const bad of [{ op: 'gift', key: 'k-bad-111' }, { op: 'buy', key: 'x', res: 'stone' }, { op: 'buy', key: 'k-bad-222', res: 'gold' }, { op: 'buy', key: 'k-bad-333', res: 'gems' }]) {
      expect((await call(s, p, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(s.ledger(p)).toBeNull();
  });
});

describe('лавка: десять покупок в сутки по 100, по серверным часам', () => {
  it('десять проходят, одиннадцатая — отказ, и баланс за неё не тронут', () => {
    let l: GemLedger = { ...openLedger(NOW), balance: 100_000 };
    for (let i = 0; i < SHOP_DAILY; i++) {
      const step = applyGemOrder(l, buy(`k-day-${i}`, SHOP_GOODS[i % SHOP_GOODS.length]), NOW);
      expect(step.error, `покупка ${i + 1}`).toBeUndefined();
      expect(step.entry?.amount).toBe(SHOP_LOT);
      l = step.ledger!;
    }
    const before = l.balance;
    const extra = applyGemOrder(l, buy('k-day-x'), NOW);
    expect(extra.error).toBe(`На сегодня лавка закрыта: ${SHOP_DAILY} покупок из ${SHOP_DAILY}.`);
    expect(extra.ledger).toBeNull();
    expect(l.balance).toBe(before);
  });

  /**
   * Граница области — полночь UTC (`shopResetAt`). Последняя миллисекунда суток ещё в лимите, первая следующих — уже нет.
   * Обе точки проверяются утверждением: иначе тест «сбрасывается» был бы зелёным при любом счёте суток.
   */
  it('сброс — ровно в полночь по серверным часам', () => {
    const edge = shopResetAt(NOW);
    expect(shopDay(edge - 1), 'последняя миллисекунда — те же сутки').toBe(shopDay(NOW));
    expect(shopDay(edge), 'полночь — новые сутки').toBe(shopDay(NOW) + 1);
    let l: GemLedger = { ...openLedger(NOW), balance: 100_000 };
    for (let i = 0; i < SHOP_DAILY; i++) l = applyGemOrder(l, buy(`k-edge-${i}`), NOW).ledger!;
    expect(applyGemOrder(l, buy('k-edge-a'), edge - 1).error).toMatch(/^На сегодня лавка закрыта/);
    const fresh = applyGemOrder(l, buy('k-edge-b'), edge);
    expect(fresh.error).toBeUndefined();
    expect(fresh.ledger!.shop).toEqual({ day: shopDay(edge), used: 1 });
    expect(shopToday(l, edge)).toEqual({ day: shopDay(edge), used: 0 });
  });

  it('счёт лавки идёт по часам сервера, а не по присланному', async () => {
    const s = memoryStores();
    const p = player();
    for (let i = 0; i < 4; i++) await call(s, p, buy(`k-srv-${i}`, 'food'));
    const r = await call(s, p);
    expect(r.body.shop).toEqual({ day: shopDay(NOW), used: 4 });
  });

  it('золота и войска лавка не продаёт', () => {
    expect(SHOP_GOODS).not.toContain('gold');
    expect(SHOP_GOODS.length).toBe(7);
  });
});

describe('ускорение: цена от остатка, проверка тем, что сервер знает', () => {
  const rush = (key: string, building: string, level: number, work: number, price = 1e6): GemOrder => ({ op: 'rush', key, building, level, work, price });

  it('остаток больше полного труда уровня — платит за полный труд, не больше', () => {
    const l = { ...openLedger(NOW), balance: 100_000 };
    const full = fullWork('market', 4);
    const step = applyGemOrder(l, rush('k-full-1', 'market', 4, full * 50), NOW);
    expect(-step.entry!.delta).toBe(rushPriceOfWork(full));
  });

  it('цена выше показанной — отказ; ниже или равна — списывается своя', () => {
    const l = { ...openLedger(NOW), balance: 100_000 };
    const work = workFor(3 * 3600);
    const price = rushPriceOfWork(work);
    expect(price).toBeGreaterThan(1);
    expect(applyGemOrder(l, rush('k-shown-1', 'market', 5, work, price - 1), NOW).error).toMatch(/^Ускорение стоит/);
    expect(-applyGemOrder(l, rush('k-shown-2', 'market', 5, work, price), NOW).entry!.delta).toBe(price);
  });

  it('последние пять минут — даром и приказом не идут', () => {
    const l = openLedger(NOW);
    const step = applyGemOrder(l, rush('k-free-1', 'houses', 2, workFor(RUSH_FREE_SECONDS)), NOW);
    expect(step.error).toBe('Последние пять минут стройка ускоряется даром.');
    expect(step.ledger).toBeNull();
  });

  it('чужая постройка или уровень вне лестницы — отказ', () => {
    const l = openLedger(NOW);
    expect(applyGemOrder(l, rush('k-lvl-1', 'houses', 1, workFor(3600)), NOW).error).toBe('Такой стройки нет.');
    expect(applyGemOrder(l, rush('k-lvl-2', 'houses', 11, workFor(3600)), NOW).error).toBe('Такой стройки нет.');
    expect(applyGemOrder(l, rush('k-lvl-3', 'castle', 2, workFor(3600)), NOW).error).toBe('Такой стройки нет.');
  });

  it('та же стройка вторым приказом в срок повтора — отказ; позже — можно', () => {
    let l: GemLedger = { ...openLedger(NOW), balance: 100_000 };
    l = applyGemOrder(l, rush('k-twin-1', 'palisade', 3, workFor(3600)), NOW).ledger!;
    expect(applyGemOrder(l, rush('k-twin-2', 'palisade', 3, workFor(3600)), NOW + RUSH_REPEAT_MS - 1).error).toBe('Эта стройка уже ускорена.');
    expect(applyGemOrder(l, rush('k-twin-3', 'palisade', 3, workFor(3600)), NOW + RUSH_REPEAT_MS).error).toBeUndefined();
  });

  it('снятое ожидание копится по постройке — его читает книга войска', () => {
    let l: GemLedger = { ...openLedger(NOW), balance: 100_000 };
    // Остатки меньше полного труда уровня — точки внутри области, где сервер верит присланному.
    const a = Math.min(workFor(1800), fullWork('barracks', 4));
    const b = Math.min(workFor(900), fullWork('barracks', 5));
    expect(a, 'остаток внутри уровня').toBeLessThan(fullWork('barracks', 4));
    expect(b, 'остаток внутри уровня').toBeLessThan(fullWork('barracks', 5));
    l = applyGemOrder(l, rush('k-sum-1', 'barracks', 4, a), NOW).ledger!;
    l = applyGemOrder(l, rush('k-sum-2', 'barracks', 5, b), NOW).ledger!;
    expect(l.rushed.barracks).toBe(Math.round(rushSeconds(a) * 1000) + Math.round(rushSeconds(b) * 1000));
  });

  it('кривая цены: чем меньше осталось, тем дешевле; час — 20, сутки — 260', () => {
    expect(gemsForWait(3600)).toBe(20);
    expect(gemsForWait(86_400)).toBe(260);
    expect(gemsForWait(1)).toBe(1);
    expect(gemsForWait(0)).toBe(0);
    let last = 0;
    for (let t = 60; t <= 14 * 86_400; t += 977) {
      const g = gemsForWait(t);
      expect(g, `t=${t}`).toBeGreaterThanOrEqual(last);
      last = g;
    }
  });
});

describe('книги стройки и войска засчитывают ускорение за алмазы', () => {
  /**
   * Уровни, ускоренные за алмазы, книга стройки подтверждает без работы (`town.buildStep`, `paid`): сервер сам списал за
   * них. Казармы учат по подтверждённому уровню — честный игрок, поднявший их алмазами, ложного отказа не получает. Точка
   * внутри области: без ускорения за десять минут книга не подтверждает заявленного шестого уровня.
   */
  it('запись партии подтверждает ускоренные уровни по книге алмазов', async () => {
    const confirmed = async (rushed: boolean): Promise<{ spear: number; level: number }> => {
      const s = memoryStores();
      const p = player();
      await call(s, p);
      if (rushed) {
        const l = s.ledger(p)!;
        let n = l.seq;
        const list = [...l.list];
        for (let lv = 2; lv <= 6; lv++) list.push({ n: ++n, at: NOW, delta: -1, kind: 'rush', key: `rush-key-${lv}`, building: 'barracks', level: lv });
        await s.stores(STORES.gems).setJSON(`tg-${p}`, { ...l, list, seq: n });
      }
      const put = async (now: number, w: WatchCard, base: string | null): Promise<string> => {
        const req = new Request('https://x/api/save', {
          method: 'PUT',
          headers: { 'x-telegram-init-data': signInit(p), 'content-type': 'application/json' },
          body: JSON.stringify({ baseEtag: base, record: { v: 1, rev: 0, updatedAt: 0, device: 'd', game: '{}', world: null, card: { name: 'В', day: 1, pop: 30, power: 1, army: 1 }, watch: w } }),
        });
        const res = await save(req, { stores: s.stores, now, ip: null });
        return ((await res.json()) as { etag: string }).etag;
      };
      const etag = await put(NOW, card({ buildings: { barracks: 6 } }), null);
      // Десять минут спустя заявлено войско, которое казармы первого уровня за это время не выучили бы.
      await put(NOW + 10 * 60_000, card({ buildings: { barracks: 6 }, troops: { spearman: 400 } }), etag);
      const rec = JSON.parse(s.data.get(STORES.watch)!.get(`tg-${p}`)!.value) as { book: { bodies: Record<string, number> }; town: { levels: Record<string, number> } };
      return { spear: rec.book.bodies.spearman ?? 0, level: rec.town.levels.barracks ?? 0 };
    };
    const plain = await confirmed(false);
    const rushed = await confirmed(true);
    expect(plain.level, 'без ускорения шестой уровень за десять минут не подтверждён — точка внутри области').toBeLessThan(6);
    expect(rushed.level, 'ускоренные уровни подтверждены').toBe(6);
    expect(rushed.spear, 'ускоренные казармы учат быстрее — подтверждено больше').toBeGreaterThan(plain.spear);
    expect(rushed.spear).toBeLessThan(400);
  });
});

describe('админ: /gems только читает', () => {
  function fakeTg() {
    const said: string[] = [];
    const tg: Telegram = {
      letter: async () => ({ result: 'ok' }),
      edit: async () => ({ result: 'ok' }),
      panel: async () => 'ok',
      repanel: async () => 'ok',
      answer: async () => 'ok',
      button: async () => 'ok',
      async say(_chat, text) {
        said.push(text);
        return 'ok';
      },
      file: async () => 'ok',
      greet: async () => 'ok',
      checkout: async () => 'ok',
    };
    return { tg, said };
  }
  async function command(s: ReturnType<typeof memoryStores>, text: string): Promise<string> {
    const t = fakeTg();
    const req = new Request('https://x/api/bot', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
      body: JSON.stringify({ update_id: 1, message: { message_id: 9, from: { id: ADMIN }, chat: { id: ADMIN, type: 'private' }, text } }),
    });
    const res = await botWith(() => t.tg)(req, { stores: s.stores, now: NOW, ip: null });
    expect(res.status).toBe(200);
    return t.said[t.said.length - 1] ?? '';
  }

  it('баланс и журнал словами; книги нет — не открывает её', async () => {
    const s = memoryStores();
    const p = player();
    // Игрок есть (наблюдение), а книги алмазов нет: команда её не открывает.
    const req = new Request('https://x/api/save', { method: 'GET', headers: { 'x-telegram-init-data': signInit(p) } });
    await save(req, { stores: s.stores, now: NOW, ip: null });
    s.data.get(STORES.gems)!.delete(`tg-${p}`);
    expect(await command(s, `/gems ${p}`)).toMatch(/Книги алмазов нет/);
    expect(s.ledger(p)).toBeNull();

    await call(s, p, buy('k-adm-1', 'stone'));
    const said = await command(s, `/gems ${p}`);
    expect(said).toContain(`Алмазов: ${START_GEMS - shopPrice('stone')}`);
    expect(said).toContain(`+${START_GEMS} стартовые`);
    expect(said).toContain(`−${shopPrice('stone')} лавка: ${SHOP_LOT} камня`);
    expect(said).toContain(`Лавка сегодня: 1 из ${SHOP_DAILY}`);
  });

  it('начислить командой нельзя: ни /give, ни /gems не меняют баланс', async () => {
    const s = memoryStores();
    const p = player();
    await call(s, p);
    await command(s, `/give ${p} алмазы 1000`);
    await command(s, `/gems ${p} 1000`);
    await command(s, `/give ${p} gems 1000`);
    expect(s.ledger(p)!.balance).toBe(START_GEMS);
  });
});

describe('записка партии', () => {
  it('дела старше применённого номера — только лавка и ускорение', () => {
    let l: GemLedger = { ...openLedger(NOW), balance: 100_000 };
    l = applyGemOrder(l, buy('k-note-1', 'wood'), NOW).ledger!;
    l = applyGemOrder(l, { op: 'rush', key: 'k-note-2', building: 'houses', level: 2, work: workFor(3600), price: 1000 }, NOW).ledger!;
    expect(gemNoteOf(l, 0, NOW).deeds.map((e) => e.kind)).toEqual(['buy', 'rush']);
    expect(gemNoteOf(l, 2, NOW).deeds.map((e) => e.n)).toEqual([3]);
    expect(gemNoteOf(l, 3, NOW).deeds).toEqual([]);
    // Ключи повтора наружу не уходят.
    expect(JSON.stringify(gemNoteOf(l, 0, NOW))).not.toContain('k-note');
  });
});

function card(over: Partial<WatchCard> = {}): WatchCard {
  return {
    build: 'v1',
    city: 'Город',
    clock: NOW,
    time: 1000,
    level: 2,
    buildings: {},
    pop: 50,
    stock: {},
    prod: {},
    cap: 1000,
    troops: {},
    queued: 0,
    away: 0,
    caravans: 0,
    wounded: 0,
    train: 6,
    deeds: 0,
    won: 0,
    lost: 0,
    lairs: 0,
    raids: 0,
    games: 0,
    haul: 0,
    haulCap: 0,
    cheated: false,
    lead: 0,
    seen: 0,
    ...over,
  };
}
