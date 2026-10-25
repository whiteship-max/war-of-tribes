// Обстрел, требушет на стене и блокада между игроками (Р-5, docs/siege_v2.md, 21): сервер войны судит приказы теми же
// дверями, что мир (`world/shelling`, `world/blockade`), выстрелы бросает кость фазы в его очереди (`war.advance`), а
// поддельный приказ — не той стороны, не той цели, без порога — отклоняется строкой. Кость фаз подменяется (`setPhaseDie`),
// чтобы фаза была спокойной; кость выстрелов — своя, из сида осады: утверждения читают её след, а не угадывают.
import { afterEach, describe, expect, it } from 'vitest';
import { NOTICE_KINDS, readNotices, readWarOrder, type CastleClaim, type RosterFile, type WarArmy, type WarSheet } from './contract.js';
import { noticeText } from './words.js';
import { tierOf } from './notify.js';
import { castleIdOf, emptyRoster, upsert } from './roster.js';
import { advance, applyOrder, emptyWars, newsOf, type SheetAt, type WarFile, type WarRow } from './war.js';
import { phaseAt, setPhaseDie } from '../../src/world/siegeroll.js';
import { siegeSince, type SiegeWindow } from '../../src/world/siege.js';
import { machinesAt } from '../../src/world/machines.js';
import { artilleryAt, gunsAt } from '../../src/world/shelling.js';
import { blockadeAt, blockadeDeeds } from '../../src/world/blockade.js';
import { ENERGY_MAX } from '../../src/world/data/energy.js';
import { SIEGE_PHASE } from '../../src/world/data/siegeroll.js';
import { MOD_BLOCKADE } from '../../src/world/data/blockade.js';

afterEach(() => setPhaseDie(null));

const A = 'tg-2001';
const B = 'tg-2002';
const T0 = 1_900_000_000_000;

const claim = (name: string): CastleClaim => ({ name, city: name, power: 5000, pop: 400 });

const sheet = (over: Partial<WarSheet> = {}): WarSheet => ({
  army: { spearman: 60, archer: 30, swordsman: 30 },
  home: { spearman: 40, archer: 20 },
  militia: 20,
  archers: 0,
  resolve: 0,
  pips: {},
  rest: 1,
  food: 4000,
  townPerHour: 20,
  perManPerHour: 1,
  stock: { food: 4000, wood: 800, stone: 300 },
  stash: 100,
  gold: 400,
  pop: 400,
  bonded: 20,
  levels: { farm: 4, smithy: 2, palisade: 3 },
  power: 5000,
  locks: {},
  seen: [],
  ...over,
});

/** Поход A на город B; `def` — слепок B, `blockade` — поход «Блокада», `t0` — минута приказа (от неё номер войны и сид боёв). */
function camped(def: Partial<WarSheet> = {}, blockade = false, t0 = T0) {
  let roster: RosterFile = emptyRoster();
  roster = upsert(roster, A, claim('Альфа'), T0);
  roster = upsert(roster, B, claim('Бета'), T0);
  const sheets = new Map<string, SheetAt>([
    [A, { sheet: sheet(), at: T0 }],
    [B, { sheet: sheet(def), at: T0 }],
  ]);
  const ctx = { roster, sheet: (k: string) => sheets.get(k) ?? null };
  const file = emptyWars() as WarFile;
  const army: WarArmy = { troops: { spearman: 60, archer: 30 }, resolve: 0, pips: {} };
  const order = { op: 'march' as const, target: castleIdOf(B), mode: 'siege' as const, fate: 'captives' as const, army, ...(blockade ? { blockade: true as const } : {}) };
  expect(applyOrder(file, A, order, t0, ctx)).toBeNull();
  const w = file.wars[0] as WarRow;
  advance(file, w.arriveAt + 1, sheets);
  expect(w.phase, 'точка внутри области: лагерь встал').toBe('camp');
  w.army = { ...w.army, energy: { value: ENERGY_MAX, at: w.arriveAt, mode: 'camp' } };
  const since = siegeSince(w.camp as SiegeWindow);
  return { file, sheets, ctx, w, since };
}

const camp = (w: WarRow): SiegeWindow => w.camp as SiegeWindow;

/** Первая фаза, в минуту которой готово то, что встаёт в минуту `readyAt`. */
const phaseReady = (since: number, readyAt: number): number => Math.ceil((readyAt - since) / SIEGE_PHASE);

describe('договор: приказы Р-5 читаются только своими полями', () => {
  it('цель, кольцо, вылазка на пост; кольцо похода — только у осады', () => {
    expect(readWarOrder({ op: 'aim', id: 'x', aim: 'town' })).toEqual({ op: 'aim', id: 'x', aim: 'town' });
    expect(readWarOrder({ op: 'aim', id: 'x', aim: 'machines' })).toEqual({ op: 'aim', id: 'x', aim: 'machines' });
    expect(readWarOrder({ op: 'aim', id: 'x', aim: 'king' })).toBeNull();
    expect(readWarOrder({ op: 'blockade', id: 'x', on: true })).toEqual({ op: 'blockade', id: 'x', on: true });
    expect(readWarOrder({ op: 'blockade', id: 'x', on: 'yes' })).toBeNull();
    expect(readWarOrder({ op: 'breakout', id: 'x', troops: { spearman: 3 } })).toEqual({ op: 'breakout', id: 'x', troops: { spearman: 3 } });
    const army = { troops: { spearman: 1 }, resolve: 0, pips: {} };
    expect(readWarOrder({ op: 'march', target: 'c', mode: 'siege', fate: 'captives', army, blockade: true })).toMatchObject({ blockade: true });
    expect(readWarOrder({ op: 'march', target: 'c', mode: 'storm', fate: 'captives', army, blockade: true })).not.toHaveProperty('blockade');
  });
});

describe('артиллерия лагеря между игроками', () => {
  it('цель — только у осаждающего и только из его списка; по городу — выстрелы по подтверждённым постройкам', () => {
    setPhaseDie(() => 7);
    const { file, sheets, ctx, w, since } = camped();
    expect(camp(w).targets, 'постройки — из подтверждённых уровней, без стены').toEqual(['farm', 'smithy']);
    expect(applyOrder(file, B, { op: 'aim', id: w.id, aim: 'town' }, since + 1, ctx), 'осаждённый целит только требушет').toBe('Такой цели нет.');
    expect(applyOrder(file, A, { op: 'aim', id: w.id, aim: 'camp' }, since + 1, ctx)).toBe('Такой цели нет.');
    expect(applyOrder(file, A, { op: 'aim', id: w.id, aim: 'wall' }, since + 1, ctx)).toMatch(/и так/);
    expect(applyOrder(file, 'tg-2003', { op: 'aim', id: w.id, aim: 'town' }, since + 1, ctx), 'чужой войне — отказ').not.toBeNull();
    expect(applyOrder(file, A, { op: 'wood', id: w.id, machines: 1 }, since + 1, ctx)).toBeNull();
    expect(applyOrder(file, A, { op: 'machine', id: w.id, machine: 'trebuchet' }, since + 2, ctx)).toBeNull();
    expect(applyOrder(file, A, { op: 'aim', id: w.id, aim: 'town' }, since + 3, ctx)).toBeNull();
    const readyAt = machinesAt(camp(w), since + 3)[0].readyAt;
    const k = phaseReady(since, readyAt);
    advance(file, phaseAt(since, k) + 1, sheets);
    expect(artilleryAt(camp(w), phaseAt(since, k)), 'точка внутри области: требушет стоит в минуту фазы').toEqual(['trebuchet']);
    const row = camp(w).phases![k - 1];
    expect(row.mods.machine, 'по городу — к кости ничего').toBeUndefined();
    expect(row.shots, 'требушет — два выстрела').toHaveLength(2);
    for (const s of row.shots ?? []) expect(['farm', 'smithy']).toContain(s.building);
  });
});

describe('требушет на стене у осаждённого', () => {
  it('ставит только осаждённый, только требушет и один; без дерева и камня — отказ', () => {
    setPhaseDie(() => 7);
    const poor = camped({ stock: { food: 4000, wood: 0, stone: 0 } });
    expect(applyOrder(poor.file, B, { op: 'machine', id: poor.w.id, machine: 'trebuchet' }, poor.since + 1, poor.ctx)).toBe('На требушет не хватает дерева и камня.');
    const { file, ctx, w, since } = camped();
    expect(applyOrder(file, B, { op: 'machine', id: w.id, machine: 'ram' }, since + 1, ctx)).toBe('На стену ставят только требушет.');
    expect(applyOrder(file, B, { op: 'machine', id: w.id, machine: 'trebuchet' }, since + 1, ctx)).toBeNull();
    expect(camp(w).guns, 'требушет на стене — в окне осады').toHaveLength(1);
    expect(camp(w).machines ?? [], 'машин лагеря не прибавилось').toHaveLength(0);
    expect(applyOrder(file, B, { op: 'machine', id: w.id, machine: 'trebuchet' }, since + 2, ctx)).toBe('Требушет на стене уже строят.');
    expect(applyOrder(file, B, { op: 'aim', id: w.id, aim: 'wall' }, since + 2, ctx), 'осаждённому — цели требушета').toBe('Такой цели нет.');
    expect(applyOrder(file, B, { op: 'aim', id: w.id, aim: 'machines' }, since + 2, ctx)).toBeNull();
  });

  it('по машинам: попадание разбивает машину лагеря — след выстрелов совпадает с очередью', () => {
    setPhaseDie(() => 7);
    const { file, sheets, ctx, w, since } = camped();
    expect(applyOrder(file, A, { op: 'wood', id: w.id, machines: 1 }, since + 1, ctx)).toBeNull();
    expect(applyOrder(file, A, { op: 'machine', id: w.id, machine: 'ram' }, since + 1, ctx)).toBeNull();
    expect(applyOrder(file, A, { op: 'machine', id: w.id, machine: 'ladders' }, since + 1, ctx)).toBeNull();
    expect(applyOrder(file, B, { op: 'machine', id: w.id, machine: 'trebuchet' }, since + 1, ctx)).toBeNull();
    expect(applyOrder(file, B, { op: 'aim', id: w.id, aim: 'machines' }, since + 2, ctx)).toBeNull();
    const k0 = phaseReady(since, gunsAt(camp(w), since + 2)[0].readyAt);
    advance(file, phaseAt(since, k0 + 3) + 1, sheets);
    expect(w.phase, 'точка внутри области: лагерь стоит все четыре фазы').toBe('camp');
    const hits = (camp(w).phases ?? []).flatMap((r) => r.gun ?? []).filter((s) => s.hit && s.machine).length;
    expect(hits, 'точка внутри области: требушет со стены попал хоть раз').toBeGreaterThan(0);
    expect((camp(w).phases ?? []).slice(0, k0 - 1).every((r) => !r.gun?.length), 'до готовности требушет не стреляет').toBe(true);
    const broke = (camp(w).machines ?? []).filter((m) => m.broke).length;
    expect(broke, 'каждое попадание разбило по машине').toBe(Math.min(hits, 2));
  });
});

describe('кольцо блокады между игроками', () => {
  it('замкнуть — только вчетверо; замкнутое даёт +1 к кости; гарнизон вырос — кольцо разомкнуто мощью', () => {
    setPhaseDie(() => 7);
    const strong = camped();
    expect(applyOrder(strong.file, A, { op: 'blockade', id: strong.w.id, on: true }, strong.since + 1, strong.ctx)).toMatch(/вчетверо/);
    const { file, sheets, ctx, w, since } = camped({ home: { spearman: 5 } });
    expect(applyOrder(file, B, { op: 'blockade', id: w.id, on: true }, since + 1, ctx), 'кольцо замыкает только лагерь').not.toBeNull();
    expect(applyOrder(file, A, { op: 'blockade', id: w.id, on: false }, since + 1, ctx)).toBe('Кольцо и так разомкнуто.');
    expect(applyOrder(file, A, { op: 'blockade', id: w.id, on: true }, since + 1, ctx)).toBeNull();
    expect(blockadeAt(camp(w), since + 1)).toBe(true);
    advance(file, phaseAt(since, 1) + 1, sheets);
    expect(camp(w).phases?.[0].mods.blockade, 'кольцо в минуту броска — +1').toBe(MOD_BLOCKADE);
    // Гарнизон вырос вдесятеро — лагерю уже не держать кольцо: в минуту смены гарнизона оно размыкается.
    const at = phaseAt(since, 1) + 5000;
    sheets.set(B, { sheet: sheet({ home: { spearman: 40, archer: 20 } }), at });
    advance(file, at + 1, sheets);
    expect(blockadeAt(camp(w), at + 1), 'кольцо разомкнуто').toBe(false);
    expect(blockadeDeeds(camp(w)).at(-1)?.why).toBe('ratio');
  });

  it('поход «Блокада»: кольцо в минуту постановки, если мощи вчетверо; нет — обычная осада', () => {
    const ring = camped({ home: { spearman: 5 } }, true);
    expect(blockadeAt(camp(ring.w), ring.since), 'вчетверо — кольцо замкнуто при постановке').toBe(true);
    const none = camped({}, true);
    expect(blockadeAt(camp(none.w), none.since), 'мощи нет — осада без кольца').toBe(false);
  });

  it('вылазка на пост: только у осаждённого и только при кольце; пост устоял — кольцо стоит', () => {
    setPhaseDie(() => 7);
    const { file, ctx, w, since } = camped({ home: { spearman: 5 } });
    expect(applyOrder(file, B, { op: 'breakout', id: w.id, troops: { spearman: 5 } }, since + 1, ctx)).toBe('Кольца нет — прорывать нечего.');
    expect(applyOrder(file, A, { op: 'blockade', id: w.id, on: true }, since + 1, ctx)).toBeNull();
    expect(applyOrder(file, A, { op: 'breakout', id: w.id, troops: { spearman: 5 } }, since + 2, ctx), 'лагерь сам себя не прорывает').not.toBeNull();
    expect(applyOrder(file, B, { op: 'breakout', id: w.id, troops: { spearman: 50 } }, since + 2, ctx), 'бойцов больше, чем в гарнизоне').not.toBeNull();
    // Пять копейщиков против четверти лагеря — пост держит, кольцо стоит.
    expect(applyOrder(file, B, { op: 'breakout', id: w.id, troops: { spearman: 5 } }, since + 2, ctx)).toBeNull();
    const lost = w.battles.at(-1)!;
    expect(lost.breakout).toBe(true);
    expect(lost.won).toBe(false);
    expect(blockadeAt(camp(w), since + 2), 'пост устоял — кольцо замкнуто').toBe(true);
  });

  it('вылазка на пост гарнизоном на пороге: исход боя решает кольцо — победа размыкает, поражение нет', () => {
    setPhaseDie(() => 7);
    // Гарнизон — четверть лагеря тем же составом: на пороге кольца пост ему равен (`shelling.test.ts`, честный бой), и исход
    // бывает любым. Набор войн с разными сидами боёв — чтобы в области были обе ветви, победа и поражение (утверждается).
    const seen = { won: 0, lost: 0 };
    const [spearman, archer] = [15, 7];
    for (let i = 0; i < 16; i++) {
      const { file, ctx, w, since } = camped({ home: { spearman, archer } }, false, T0 + i * 1000);
      expect(applyOrder(file, A, { op: 'blockade', id: w.id, on: true }, since + 1, ctx), 'точка внутри области: кольцо замкнуто').toBeNull();
      expect(applyOrder(file, B, { op: 'breakout', id: w.id, troops: { spearman, archer } }, since + 2, ctx)).toBeNull();
      const fight = w.battles.at(-1)!;
      expect(fight.breakout).toBe(true);
      expect(blockadeAt(camp(w), since + 2), 'кольцо — обратное исходу боя').toBe(!fight.won);
      if (fight.won) {
        seen.won += 1;
        expect(blockadeDeeds(camp(w)).at(-1)?.why).toBe('sortie');
        // Прорванное в этой фазе не замкнуть снова.
        expect(applyOrder(file, A, { op: 'blockade', id: w.id, on: true }, since + 5, ctx)).toMatch(/следующей/);
      } else seen.lost += 1;
    }
    expect(seen.won, 'точка внутри области: вылазка брала пост').toBeGreaterThan(0);
    expect(seen.lost, 'точка внутри области: пост устоял').toBeGreaterThan(0);
  });
});

describe('вести о кольце и обстреле (ВС-1)', () => {
  it('кольцо замкнули — осаждённому, обычной важностью; разомкнули мощью — обеим сторонам; запись сервера читается без потерь', () => {
    setPhaseDie(() => 7);
    const { file, sheets, ctx, w, since } = camped({ home: { spearman: 5 } });
    expect(applyOrder(file, A, { op: 'blockade', id: w.id, on: true }, since + 1, ctx)).toBeNull();
    let ring = newsOf(w).filter((n) => n.item.p.ring);
    expect(ring.map((n) => n.player), 'замкнули — только осаждённому: приказ осаждающего ему не пишется').toEqual([B]);
    const on = ring[0].item;
    expect(tierOf(on)).toBe('normal');
    expect(noticeText(on, 'Europe/Moscow')).toMatch(/замкнул кольцо/);
    expect(readNotices([on], since, NOTICE_KINDS), 'запись сервера читается тем же договором').toEqual([on]);
    // Гарнизон вырос — разомкнуто мощью: обеим сторонам.
    const at = since + 5000;
    sheets.set(B, { sheet: sheet({ home: { spearman: 40, archer: 20 } }), at });
    advance(file, at + 1, sheets);
    ring = newsOf(w).filter((n) => n.item.p.ring === 'off');
    expect(ring.map((n) => n.player).sort()).toEqual([A, B].sort());
    for (const n of ring) expect(tierOf(n.item)).toBe('normal');
  });

  it('вылазка на пост — весть боя за кольцо, а не «лагерь разбит»; фаза без попаданий — без вести', () => {
    setPhaseDie(() => 7);
    const { file, sheets, ctx, w, since } = camped({ home: { spearman: 5 } });
    expect(applyOrder(file, A, { op: 'blockade', id: w.id, on: true }, since + 1, ctx)).toBeNull();
    expect(applyOrder(file, B, { op: 'breakout', id: w.id, troops: { spearman: 5 } }, since + 2, ctx)).toBeNull();
    const fight = newsOf(w).find((n) => n.item.kind === 'war-fight' && n.player === B)!;
    expect(fight.item.p.ring).toBe('off');
    expect(noticeText(fight.item, 'Europe/Moscow')).toMatch(/пост/);
    expect(noticeText(fight.item, 'Europe/Moscow')).not.toMatch(/Осада снята/);
    advance(file, phaseAt(since, 1) + 1, sheets);
    const phase = newsOf(w).filter((n) => n.item.kind === 'war-phase' && !n.item.p.ring);
    expect(camp(w).phases?.[0].out, 'точка внутри области: фаза спокойная').toBe('calm');
    expect(phase, 'спокойная фаза без выстрелов молчит').toEqual([]);
  });
});


describe('BTL-4: залп фазы, в которой кольцо разомкнулось, ложится в окно лагеря', () => {
  it('кольцо держится до фазы, истощение фазы его размыкает — залп по наказу учтён, второй в ту же фазу отклонён', () => {
    setPhaseDie(() => 7);
    // Гарнизон подбирается так, чтобы кольцо замкнулось при постановке, а истощение первой фазы его разомкнуло (`ringCheck`
    // после броска): прежде шаг фазы писал залп в прежний объект лагеря, который `ringCheck` уже заменил, — энергия
    // списана, залпа нет.
    // Истощение фазы — доля вида, дробь костью сида осады (АУ-8, п. 3): сколько уйдёт в первой фазе, решает сид лагеря, поэтому
    // ищется и минута выхода похода (сид), а не только гарнизон.
    let found: ReturnType<typeof camped> | null = null;
    for (let t = 0; t < 40 && !found; t++) {
      for (let n = 1; n <= 40 && !found; n++) {
        const c = camped({ home: { spearman: n } }, true, T0 + t * 60_000);
        if (!blockadeAt(camp(c.w), c.since)) break;
        expect(applyOrder(c.file, A, { op: 'orders', id: c.w.id, orders: { volley: true } }, c.since + 1, c.ctx)).toBeNull();
        advance(c.file, phaseAt(c.since, 1) + 1, c.sheets);
        const broke = blockadeDeeds(camp(c.w)).at(-1);
        if (c.w.phase === 'camp' && broke?.why === 'ratio' && broke.at === phaseAt(c.since, 1)) found = c;
      }
    }
    expect(found, 'точка внутри области: кольцо разомкнуто истощением в минуту первой фазы').not.toBeNull();
    const { file, ctx, w, since } = found!;
    const row = camp(w).phases![0];
    expect(row.orders, 'наказ залпа исполнен').toEqual(['volley']);
    expect(camp(w).craft?.shots, 'залп в окне лагеря').toBe(1);
    expect(camp(w).log?.filter((d) => d.act === 'volley').map((d) => d.at)).toEqual([phaseAt(since, 1)]);
    expect(applyOrder(file, A, { op: 'craft', id: w.id, act: 'bombard' }, phaseAt(since, 1) + 2, ctx)).toBe('Залп этой фазы уже дан. Следующий — в новой фазе.');
  });
});
