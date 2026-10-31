// Доска договоров НПС (ПН-7, docs/gdd/path_of_sword.md, 3.8.1–3.8.2 и «Решения ПН-7»): кто у отряда даёт договоры и какие.
//
// ЗАКАЗЧИКИ (3.8.1):
//   — **вольный город** — доска, новая каждый привоз: сетка 3 ч по UTC (`game/shift.ts`, та же, что у рынка); договоров на доске —
//     заглушка `boardSize`; виды — бой с логовом и ватагой, груз в другой город, голова атамана (II+);
//   — **кастелян вольного замка** — раз в сутки по UTC: гарнизонная служба у себя (II+) и разведка чужого замка. Замков пула ещё нет
//     (ПН-10) — до них кастелян сидит в вольном городе II–III (заглушка точки: его замок — клетка города);
//   — **село** — только когда рядом угроза (живая ватага не дальше `dealReach.threat`): защитить село и перехватить эту ватагу.
// ЦЕЛИ — точки мира бродяги: логова — мира (их даёт мир, `near.lairs`), ватаги и сёла — свои по сиду мира, города — общие
// (`world/roampoints`); не дальше `dealReach.target` клеток от заказчика; побитых нет.
//
// Доска — функция заказчика, привоза, сида мира и престижа: та же минута — та же доска. Тир — по ступени престижа
// (`contractrules.stageTier`), сила противника — сила НПС по престижу (`world/roamfoes`, тем же ключом спелости, что удар по цели), дорога
// — путь отряда обычным маршем (`world/roam.roamWalkMs`). **Ни одного числа отряда игрока на доске нет** (E1). Условия (плата, аванс,
// срок) считает `contractrules.contractTerms` из предложения. Модуль чистый: часов не читает, минута приходит доводом.
import type { ResourceId } from '../game/types';
import type { DealFrom, DealKind, DealTier } from '../game/data/contracts';
import { DEAL_DEFS, FROM_KINDS } from '../game/data/contracts';
import { cargoGoods, stageTier } from '../game/contractrules';
import { roamStub } from '../game/roamstubs';
import { shiftOf, shiftStart } from '../game/shift';
import { realTime } from '../game/pace';
import { hash2 } from './geography';
import { pointsIn, townAt, villageAt, type RoamPoint } from './roampoints';
import { foePower, foeRipe, foeStage } from './roamfoes';
import { roamWalkMs } from './roam';

/** Соль доски. */
export const DEAL_SALT = 0x0d3a;
/** Доска кастеляна — раз в сутки по UTC. */
export const CASTELLAN_PERIOD = realTime(24 * 3600_000);
/** Груз — припас, который не ест отряд (хлеб и уголь не возят). */
export const CARGO_GOODS: readonly ResourceId[] = ['wood', 'stone', 'hides', 'copper', 'iron'];

/** Точка мира в договоре: заказчик или цель. */
export interface DealPlace {
  id: string;
  x: number;
  y: number;
  name: string;
}

/** Заказчик договора. */
export interface DealCustomer extends DealPlace {
  who: DealFrom;
}

/** Предложение доски: всё, из чего `contractTerms` назовёт условия, и что заморозит взятие. */
export interface DealOffer {
  /** `deal:<заказчик>:<привоз>:<место>` — та же минута, тот же номер. */
  id: string;
  kind: DealKind;
  tier: DealTier;
  from: DealCustomer;
  target: DealPlace;
  /** Мощь противника (сила НПС по престижу); служба — 0. */
  power: number;
  /** Дорога от заказчика к цели обычным маршем, мс мира. */
  roadMs: number;
  /** Стоянка, игр. дн.: защита села — до набега, служба — срок службы; прочим — 0. */
  stand: number;
  /** Доставка: что и сколько. */
  goods?: { id: ResourceId; n: number };
}

/** Доска одного заказчика: предложения и минута, когда она сменится. */
export interface DealBoard {
  from: DealCustomer;
  offers: DealOffer[];
  /** Минута мира, когда доска сменится. */
  next: number;
}

/** Что даёт мир доске: живые логова (мира бродяги) и побита ли точка. */
export interface DealNear {
  lairs: readonly DealPlace[];
  beaten: (id: string) => boolean;
}

const mix = (seed: number, period: number, who: number): number =>
  (DEAL_SALT ^ Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(period | 0, 0x85ebca6b) ^ Math.imul(who, 0xc2b2ae35)) >>> 0;
const WHO: Record<DealFrom, number> = { town: 1, castellan: 2, village: 3 };
const dist = (a: DealPlace, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);
const place = (p: RoamPoint): DealPlace => ({ id: p.id, x: p.x, y: p.y, name: p.name });
/** Сила НПС по ступеням престижа — строка таблицы (`foePower`). */
type FoeTable = readonly number[];

/** Номер заказчика: город — его точка, кастелян — `castle:x:y` (замок — клетка города до ПН-10), село — его точка. */
export const customerId = (who: DealFrom, p: { x: number; y: number }): string =>
  `${who === 'town' ? 'town' : who === 'castellan' ? 'castle' : 'village'}:${p.x}:${p.y}`;

/** Точки вида в круге `r` клеток вокруг `c` — по номеру, без побитых. */
function around(seed: number, c: { x: number; y: number }, r: number, kind: RoamPoint['kind'], near: DealNear): DealPlace[] {
  const box = Math.ceil(r);
  return pointsIn(seed, c.x - box, c.y - box, c.x + box + 1, c.y + box + 1)
    .filter((p) => p.kind === kind && dist(p, c) <= r && !near.beaten(p.id))
    .map(place)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Срок стоянки вида — между краями заглушки `dealStand`, хешем предложения. */
function standOf(kind: 'defend' | 'garrison', h: number): number {
  const s = roamStub('dealStand');
  const [lo, hi] = kind === 'defend' ? [s.defendLo, s.defendHi] : [s.garrisonLo, s.garrisonHi];
  return lo + Math.min(hi - lo, Math.floor(h * (hi - lo + 1)));
}

/**
 * Сила противника предложения: цель боя — её спелостью (та же, что у удара), засада дороги — спелостью номера; служба — 0. Таблица силы
 * НПС по ступеням — доводом, как у `foePower`: игра зовёт без неё (заглушка `foeTable`), вывод прибора пробует свою строку шага.
 */
function powerOf(kind: DealKind, prestige: number, seed: number, foeId: string, table: FoeTable): number {
  if (kind === 'garrison') return 0;
  return foePower(prestige, kind === 'lair' ? 'lair' : 'band', foeRipe(seed, foeId), table);
}

function offer(
  seed: number,
  prestige: number,
  tier: DealTier,
  from: DealCustomer,
  period: number,
  kind: DealKind,
  target: DealPlace,
  h: number,
  table: FoeTable,
  foe?: DealPlace,
): DealOffer {
  const id = `deal:${from.id}:${period}:${kind}:${target.x}:${target.y}`.slice(0, 64);
  const fight = DEAL_DEFS[kind].fight;
  const power = powerOf(kind, prestige, seed, fight === 'strike' ? target.id : fight === 'defend' && foe ? foe.id : id, table);
  const stand = kind === 'defend' || kind === 'garrison' ? standOf(kind, h) : 0;
  const roadMs = target.x === from.x && target.y === from.y ? 0 : roamWalkMs(from, target, 'normal');
  const out: DealOffer = { id, kind, tier, from, target, power, roadMs, stand };
  if (kind === 'cargo') out.goods = { id: CARGO_GOODS[Math.floor(h * CARGO_GOODS.length) % CARGO_GOODS.length], n: cargoGoods(tier) };
  return out;
}

/** Доска вольного города в привоз `period`: `boardSize` мест, вид и цель — хешем; цели без пары вид+цель — пусто. */
function townBoard(seed: number, town: RoamPoint, period: number, prestige: number, near: DealNear, table: FoeTable): DealOffer[] {
  const tier = stageTier(foeStage(prestige));
  const from: DealCustomer = { ...place(town), who: 'town' };
  const kinds = FROM_KINDS.town.filter((k) => DEAL_DEFS[k].tier <= tier);
  const reach = roamStub('dealReach').target;
  const salt = mix(seed, period, WHO.town);
  const pool: Record<string, DealPlace[]> = {
    lair: near.lairs.filter((l) => dist(l, town) <= reach && !near.beaten(l.id)).sort((a, b) => (a.id < b.id ? -1 : 1)),
    vataga: around(seed, town, reach, 'vataga', near),
    cargo: around(seed, town, reach, 'town', near).filter((t) => t.id !== town.id),
  };
  pool.head = pool.vataga;
  const out: DealOffer[] = [];
  const used = new Set<string>();
  for (let i = 0; i < roamStub('boardSize'); i++) {
    const kind = kinds[Math.floor(hash2(salt, town.x * 4099 + town.y, i * 3) * kinds.length) % kinds.length];
    const cands = pool[kind].filter((t) => !used.has(`${kind}:${t.id}`));
    if (cands.length === 0) continue;
    const target = cands[Math.floor(hash2(salt, town.x * 4099 + town.y, i * 3 + 1) * cands.length) % cands.length];
    used.add(`${kind}:${target.id}`);
    out.push(offer(seed, prestige, tier, from, period, kind, target, hash2(salt, town.x * 4099 + town.y, i * 3 + 2), table));
  }
  return out;
}

/** Доска кастеляна (раз в сутки): служба у его замка (II+) и разведка чужого замка — города II–III до ПН-10. */
function castellanBoard(seed: number, town: RoamPoint, period: number, prestige: number, near: DealNear, table: FoeTable): DealOffer[] {
  const tier = stageTier(foeStage(prestige));
  const from: DealCustomer = { id: customerId('castellan', town), x: town.x, y: town.y, name: town.name, who: 'castellan' };
  const salt = mix(seed, period, WHO.castellan);
  const h = (k: number): number => hash2(salt, town.x * 4099 + town.y, k);
  const out: DealOffer[] = [];
  if (DEAL_DEFS.garrison.tier <= tier) out.push(offer(seed, prestige, tier, from, period, 'garrison', { id: from.id, x: town.x, y: town.y, name: town.name }, h(0), table));
  const rivals = around(seed, town, roamStub('dealReach').target, 'town', near).filter((t) => t.id !== town.id && (townAt(t.x, t.y)?.tier ?? 0) >= 2);
  if (rivals.length > 0) {
    const t = rivals[Math.floor(h(1) * rivals.length) % rivals.length];
    out.push(offer(seed, prestige, tier, from, period, 'scout', { id: customerId('castellan', t), x: t.x, y: t.y, name: t.name }, h(2), table));
  }
  return out;
}

/** Угроза селу: ближайшая живая ватага не дальше `dealReach.threat`; нет — `null`. */
export function threatOf(seed: number, village: DealPlace, near: DealNear): DealPlace | null {
  const list = around(seed, village, roamStub('dealReach').threat, 'vataga', near);
  return list.sort((a, b) => dist(a, village) - dist(b, village) || (a.id < b.id ? -1 : 1))[0] ?? null;
}

/** Доска села — только при угрозе (староста просит): защитить село от этой ватаги и перехватить её. */
function villageBoard(seed: number, village: RoamPoint, period: number, prestige: number, near: DealNear, table: FoeTable): DealOffer[] {
  const from: DealCustomer = { ...place(village), who: 'village' };
  const threat = threatOf(seed, from, near);
  if (!threat) return [];
  const tier = stageTier(foeStage(prestige));
  const salt = mix(seed, period, WHO.village);
  const h = hash2(salt, village.x * 4099 + village.y, 0);
  return [
    offer(seed, prestige, tier, from, period, 'defend', { id: village.id, x: village.x, y: village.y, name: village.name }, h, table, threat),
    offer(seed, prestige, tier, from, period, 'vataga', threat, h, table),
  ];
}

/**
 * Доски заказчиков у клетки `c` (сама клетка и соседние — отряд стоит в городе или лагерем у стен) в минуту мира `now`: город — по
 * привозу, кастелян — по суткам, село — по привозу и при угрозе. `table` — сила НПС по ступеням: игра зовёт без неё (заглушка
 * `foeTable`, та же, что у засад и логов мира бродяги); вывод прибора отдаёт свою строку шага — иначе договоры автопилота бились бы с
 * таблицей игры, а не с выводимой, и неподвижная точка садилась бы ложно (ПН-Э2а, docs/gdd/path_of_sword.md, 23.8).
 */
export function boardsAt(
  seed: number,
  c: { x: number; y: number },
  now: number,
  prestige: number,
  near: DealNear,
  table: FoeTable = roamStub('foeTable'),
): DealBoard[] {
  const out: DealBoard[] = [];
  const shift = shiftOf(now);
  const day = Math.floor(now / CASTELLAN_PERIOD);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = c.x + dx;
      const y = c.y + dy;
      const town = townAt(x, y);
      if (town) {
        out.push({ from: { ...place(town), who: 'town' }, offers: townBoard(seed, town, shift, prestige, near, table), next: shiftStart(shift + 1) });
        if (town.tier >= 2) {
          out.push({
            from: { id: customerId('castellan', town), x, y, name: town.name, who: 'castellan' },
            offers: castellanBoard(seed, town, day, prestige, near, table),
            next: (day + 1) * CASTELLAN_PERIOD,
          });
        }
      }
      const village = villageAt(seed, x, y);
      if (village && !near.beaten(village.id)) {
        out.push({ from: { ...place(village), who: 'village' }, offers: villageBoard(seed, village, shift, prestige, near, table), next: shiftStart(shift + 1) });
      }
    }
  }
  return out;
}
