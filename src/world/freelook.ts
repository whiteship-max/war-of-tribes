// Лёгкая часть окна вольного замка (ПН-Э2б, docs/gdd/path_of_sword.md, 23.9): какой замок и что о его гарнизоне видит отряд. Её читает мир
// бродяги (`RoamWorld.roamFree`) прямо, а счёт шанса (`world/freeodds`, сервер войны в памяти) — в своём потоке: так код сервера войны
// не тянется в кусок пути, и первая загрузка не платит за его имена.
//
// Гарнизон ступени — правило, видное всем (3.11.1), выше него гарнизона не бывает; ниже — бывает, если замок потрепали чужие осады
// (`war.npcSheet` вычитает их потери). Стоящий отряд, в чьём круге обзора замок (`world/sight`, наблюдатель «отряд»), видит стены и людей
// на них — гарнизон точкой; иначе — вилкой вниз на долю `INTEL_ROUGH_SPREAD` (ступень «примерно» разведданных, `world/intel`).
import { freeCellOf, freePrestige, freeTroopPower, freeTroops, type FreeTier } from './freecastle';
import { sees } from './sight';
import { INTEL_ROUGH_SPREAD } from './data/tuning';
import { troopTotal } from '@/game/battle/kinds';
import type { Coord } from './types';

/** Вольный замок для окна: ключ (`free:x:y` — от него строй гарнизона), клетка и ступень. */
export interface FreeAt {
  id: string;
  x: number;
  y: number;
  tier: FreeTier;
}

/** Замок по ключу и ступени — клетка из ключа. */
export function freeAt(id: string, tier: FreeTier): FreeAt {
  const c = freeCellOf(id);
  if (!c) throw new Error(`не ключ вольного замка: ${id}`);
  return { id, x: c.x, y: c.y, tier };
}

/** Что отряд знает о гарнизоне: видит ли стены (`watching`) и на какую долю гарнизон может быть ниже правила ступени (`spread`). */
export interface FreeLook {
  watching: boolean;
  spread: number;
}

/**
 * Что видит отряд в `at` (стоит или в пути) о замке в `castle` (ГДД 3.5.4: наблюдатель «отряд» — только стоящий; радиус — `sight`,
 * со следопытом шире). Замок не прячется: заметность стен — 1. Видит — гарнизон точкой; не видит — вилкой вниз (`INTEL_ROUGH_SPREAD`):
 * выше правила ступени гарнизона не бывает, а потрепали ли его чужие осады, издали не видно.
 */
export function freeLook(at: Coord | null, moving: boolean, castle: Coord, tracker = false): FreeLook {
  const watching = !!at && !moving && sees({ kind: 'band', at, tracker }, castle, 1);
  return { watching, spread: watching ? 0 : INTEL_ROUGH_SPREAD };
}

/** Гарнизон, каким его видит отряд: людей и мощь — точкой или вилкой `lo…hi` (верх — правило ступени). */
export function freeSeen(at: FreeAt, look: FreeLook): { lo: number; hi: number; power: { lo: number; hi: number } } {
  const men = troopTotal(freeTroops(at.id, at.tier));
  const power = freeTroopPower(at.id, at.tier);
  const k = 1 - look.spread;
  return { lo: Math.floor(men * k), hi: men, power: { lo: Math.round(power * k), hi: Math.round(power) } };
}

// ---------- голова и хвост строк окна (ПН-Э2г) ----------
//
// Строки «Что нужно, чтобы взять», которые не считают шанса: престиж, «у стен» и связь. Их окно рисует сразу, не дожидаясь шанса, а
// сервер (`netlify/lib/oddsdesk`) кладёт их к строкам пути из своего кэша свежими — та же функция, что у двери окна (`freeodds.freeNeeds`).

export type FreeNeedId = 'prestige' | 'near' | 'storm' | 'siege' | 'online';

/** Строка окна без чисел пути. */
export interface FreePlainRow {
  id: FreeNeedId;
  text: string;
  ok: boolean;
}

/** Престиж доступа и «у стен» — первые строки окна. */
export function freeHeadRows(prestige: number, tier: FreeTier, near: boolean): FreePlainRow[] {
  const need = freePrestige(tier);
  return [
    { id: 'prestige', text: `Престиж ${need} — у отряда ${Math.floor(prestige)}`, ok: prestige >= need },
    { id: 'near', text: 'Отряд у стен — в клетке замка или рядом', ok: near },
  ];
}

/** Связь с сервером войны — последняя строка окна. */
export const freeOnlineRow = (online: boolean): FreePlainRow => ({ id: 'online', text: 'Связь с сервером войны: бой у стен считает он', ok: online });
