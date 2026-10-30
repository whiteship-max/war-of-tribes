// Вольные замки (ПН-10, docs/gdd/path_of_sword.md, 3.11 и 6.4): общие точки пула, хозяина которых держит реестр сервера. Одна дверь
// правил на клиент (карта и окно замка бродяги), сервер (реестр пула, осада на сервере войны — защитник НПС) и прибор (`roam:report`).
//
// Что здесь:
//   — **ступень → гарнизон**: строка таблицы у ворот (`GATE_POWER.raiders`) уровня ступени, строй замка (`garrison.garrisonOf` с флагом
//     `castle` — копейная стена, снаряжение на ступень выше); это и будит спящую механику замка (docs/handbook/world.md);
//   — **казна** — `CASTLE_GOLD_PER_POWER` × мощь гарнизона [код]; **кастелян** — поимённый НПС (имя — хешем клетки);
//   — **доступ** — престиж не ниже порога ступени; **пул** — `max(базовый, ceil(бродяг × доля))`, ступень замка пула — хешем клетки;
//   — **хлеб осады** — кладовая НПС, та же, что у логова (`siege.townLarder`, `townEatPerHour`, `SIEGE_TOWN_EAT_MAN`).
// Числа без вывода — заглушки игры (`game/roamstubs`, за выключателем пути). Замок берут только мечом (решение В6): здесь нет ни
// подкупа, ни сдачи — их нет нигде (сервер войны, `war.ts`).
import { hash2 } from './geography';
import { garrisonOf, type Garrison } from './garrison';
import { CASTLE_GOLD_PER_POWER, SIEGE_TOWN_EAT_MAN } from './data/tuning';
import { townEatPerHour, townLarder } from './siege';
import { CASTELLAN_NAMES, FREE_NAMES } from './data/freecastle';
import { GATE_POWER } from '@/game/data/events';
import { TROOPS_OF_KIND, gearOfTroop, type TroopStack } from '@/game/battle/kinds';
import { troopPower } from '@/game/battle/price';
import { roamStub } from '@/game/roamstubs';
import { UNIT_KINDS } from '@/battle';
import type { TroopId } from '@/game/types';

/** Ступень вольного замка: I — усадьба с башней, II — замок кастеляна, III — баронская крепость (3.11.1). */
export type FreeTier = 1 | 2 | 3;
export const FREE_TIERS: readonly FreeTier[] = [1, 2, 3];

export const FREE_TIER_NAMES: Record<FreeTier, string> = { 1: 'Усадьба с башней', 2: 'Замок кастеляна', 3: 'Баронская крепость' };

/** Приставка ключа вольного замка — в реестре, в записи войн (защитник НПС) и на карте: `free:x:y`. */
export const FREE_PREFIX = 'free:';

export const freeId = (x: number, y: number): string => `${FREE_PREFIX}${Math.round(x)}:${Math.round(y)}`;

/** Ключ — вольный замок (защитник НПС), а не игрок. */
export const isFreeKey = (key: string): boolean => key.startsWith(FREE_PREFIX);

/** Клетка вольного замка по ключу; не ключ замка — `null`. */
export function freeCellOf(id: string): { x: number; y: number } | null {
  if (!isFreeKey(id)) return null;
  const [x, y] = id.slice(FREE_PREFIX.length).split(':').map(Number);
  return Number.isInteger(x) && Number.isInteger(y) ? { x, y } : null;
}

const tierAt = <T>(row: readonly T[], tier: FreeTier): T => row[Math.max(0, Math.min(row.length - 1, tier - 1))];

/** Мощь гарнизона ступени — строка таблицы у ворот уровня ступени (3.11.1). */
export const freePower = (tier: FreeTier): number => {
  const row = GATE_POWER.raiders;
  const level = Math.max(1, Math.min(row.length, Math.round(tierAt(roamStub('castleLevel'), tier))));
  return row[level - 1];
};

/** Порог престижа ступени (доступ, 3.11.1). */
export const freePrestige = (tier: FreeTier): number => tierAt(roamStub('castlePrestige'), tier);

/** Жители замка ступени. */
export const freePop = (tier: FreeTier): number => tierAt(roamStub('castlePop'), tier);

/** Казна замка — `CASTLE_GOLD_PER_POWER` × мощь гарнизона ([код], 3.11.1). */
export const freeGold = (tier: FreeTier): number => Math.round(CASTLE_GOLD_PER_POWER * freePower(tier));

/** Гарнизон замка: строй замка (`castle`) из мощи ступени; сид — ключ замка, у всех один. */
export const freeGarrison = (id: string, tier: FreeTier): Garrison => garrisonOf(0, id, freePower(tier), true);

/**
 * Гарнизон бойцами племени — тем же счётом, что у войск игроков на сервере войны (`kindsOf(troops)`): вид бойца — род строя,
 * снаряжение — ближайшее к ступени снаряжения гарнизона (у копья, лука и тяжёлых — один боец рода).
 */
export function freeTroops(id: string, tier: FreeTier): TroopStack {
  const g = freeGarrison(id, tier);
  const out: TroopStack = {};
  for (const kind of UNIT_KINDS) {
    const n = g.kinds[kind] ?? 0;
    const ids = TROOPS_OF_KIND[kind];
    if (n <= 0 || ids.length === 0) continue;
    const want = g.gear[kind] ?? 0;
    let best: TroopId = ids[0];
    for (const t of ids) if (Math.abs(gearOfTroop(t) - want) < Math.abs(gearOfTroop(best) - want)) best = t;
    out[best] = (out[best] ?? 0) + n;
  }
  return out;
}

/** Мощь гарнизона бойцами — та, что встанет на стену (`troopPower`). */
export const freeTroopPower = (id: string, tier: FreeTier): number => troopPower(freeTroops(id, tier));

/** Уровни построек замка ступени: частокол, башня, Ратуша — по таблице 3.11.1, прочие — 1-го (посёлок целиком — ПН-11). */
export function freeLevels(tier: FreeTier): Record<string, number> {
  return {
    palisade: tierAt(roamStub('castleWall'), tier),
    tower: tierAt(roamStub('castleTower'), tier),
    town_hall: tierAt(roamStub('castleHall'), tier),
  };
}

/** Хлеб осады замка — кладовая НПС, та же, что у логова (`LocalWorld.larderOf`). */
export function freeLarder(tier: FreeTier): { food: number; townPerHour: number; perManPerHour: number } {
  const pop = freePop(tier);
  return { food: townLarder(pop), townPerHour: townEatPerHour(pop), perManPerHour: SIEGE_TOWN_EAT_MAN };
}

/** Можно ли отряду с престижем `prestige` идти на замок ступени `tier`: null — можно, иначе причина словами. */
export function freeAccess(prestige: number, tier: FreeTier): string | null {
  const need = freePrestige(tier);
  return prestige >= need ? null : `Кастелян не примет бой от безвестных: нужен престиж ${need}, у отряда ${Math.floor(prestige)}.`;
}

const FREE_SALT = 0xf3ee;

const nameOf = (list: readonly string[], salt: number, x: number, y: number): string => list[Math.floor(hash2(salt, x, y) * list.length) % list.length];

/** Имя замка — хешем клетки: у всех одно. */
export const freeName = (x: number, y: number): string => nameOf(FREE_NAMES, FREE_SALT, x, y);

/** Кастелян замка — поимённый НПС, имя хешем клетки. */
export const castellanOf = (x: number, y: number): string => nameOf(CASTELLAN_NAMES, FREE_SALT + 7, x, y);

/** Ступень замка пула — хешем клетки по долям `castleShare`. */
export function freeTierOf(x: number, y: number): FreeTier {
  const share = roamStub('castleShare');
  const h = hash2(FREE_SALT + 3, x, y);
  let acc = 0;
  for (let i = 0; i < share.length; i++) {
    acc += share[i];
    if (h < acc) return (i + 1) as FreeTier;
  }
  return 3;
}

/** Размер пула (6.4): `max(базовый, ceil(бродяг × доля))`. */
export function freePoolSize(bands: number): number {
  const p = roamStub('castlePool');
  return Math.max(p.base, Math.ceil(Math.max(0, bands) * p.share));
}

/** Ступень словами для карты и окна. */
export const freeTierWords = (tier: FreeTier): string => `${FREE_TIER_NAMES[tier]} (${['', 'I', 'II', 'III'][tier]})`;
