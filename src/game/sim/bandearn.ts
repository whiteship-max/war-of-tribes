// Заработки бродяги (ПН-6, docs/gdd/path_of_sword.md, 3.7.7, решение Н9; «Решения ПН-6»): отряд сам идёт на дворы вольного города и
// играет промыслы — золото себе. Разрешения не нужно; нельзя у города в осаде (вольные города НПС в Срезе 1 осад не знают — правило
// стоит на месте, пока их нет) и у хозяина-«врага» (города игроков — Срез 2).
//
// Одна формула, своей таблицы нет: добыча игры — `MINIGAME_SHARE` суточной выработки одного работника двора этого дела (`YARD_BY_JOB`,
// `levelOutputMult` — та же мерка места, что у двора лорда) за долю энергии игры, в золото — по цене продажи рынка
// (`SALE_SHARE` × основа, без нажима). Уровень дворов — по ступени города (`townrules.townYardLevel`, заглушка). Хозяина не касается:
// склад, места, выработка и казна города не меняются. Энергия — та же дверь промыслов (`sim/minigames`). Своим модулем — кусок пути.
import type { GameState, ResourceId } from '../types';
import { RESOURCE_IDS } from '../constants';
import { GOOD_BY_ID } from '../data/market';
import { YARD_BY_JOB } from '../data/yards';
import { ENERGY_MAX, ENERGY_REFILL, MINIGAME_BY_ID, MINIGAME_COST, MINIGAME_SHARE, type MinigameId } from '../data/minigames';
import { SALE_SHARE } from '../marketrules';
import { levelOutputMult } from '../selfcost';
import { gameDaysOfMs } from '../pace';
import { townYardLevel, type TownTier } from '../townrules';
import { claimOuting, energyShown, scoreOf, type Haul, type Harvest, type Outing } from './minigames';
import { bandOf } from './bandranks';
import { standsAt, type TownPoint } from './roamtown';
import { log } from './log';

/**
 * Суточная выработка на дворе дела игры `id` в вольном городе ступени `tier` — **одного работника**: бродяга идёт на двор сам, одной
 * парой рук (решение ПН-6), на место двора уровня ступени (`levelOutputMult` — мерка места, как у двора лорда). Сутки — те же, за
 * которые копится энергия промыслов.
 */
export function earnYardDay(tier: TownTier, id: MinigameId): Record<ResourceId, number> {
  const yard = YARD_BY_JOB.get(MINIGAME_BY_ID[id].deed);
  const level = townYardLevel(tier);
  const out = {} as Record<ResourceId, number>;
  for (const r of RESOURCE_IDS) out[r] = (yard?.yield[r] ?? 0) * levelOutputMult(level) * gameDaysOfMs(ENERGY_REFILL);
  return out;
}

/** Добыча игры при счёте `score` (доля предела 0…1) — целыми вниз, как у промысла лорда. */
export function earnHaul(tier: TownTier, id: MinigameId, score: number): Haul {
  const day = earnYardDay(tier, id);
  const k = (MINIGAME_SHARE * MINIGAME_COST) / ENERGY_MAX;
  const q = scoreOf(score);
  const out: Haul = {};
  for (const r of RESOURCE_IDS) {
    const n = Math.floor(k * day[r] * q + 1e-9);
    if (n > 0) out[r] = n;
  }
  return out;
}

/** Золото за добычу — по цене продажи рынка (`SALE_SHARE` × основа), целыми вниз. */
export const earnGold = (haul: Haul): number =>
  Math.floor(RESOURCE_IDS.reduce((t, r) => t + (haul[r] ?? 0) * SALE_SHARE * GOOD_BY_ID[r].price, 0) + 1e-9);

/** Почему нельзя играть на заработках у этого города; `null` — можно. */
export function earnBlock(s: GameState, p: TownPoint, now: number): string | null {
  const r = bandOf(s);
  if (!r) return 'Отряда нет.';
  if (p.kind !== 'town' || p.tier === 0) return 'Заработки — во дворах вольного города.';
  if (!standsAt(r, now, p)) return 'На заработки идут, стоя в городе или у его стен.';
  return null;
}

/** Итог заработков: добыча игры и золото в кошель — один раз на поход (`sim/minigames.claimOuting`). */
export function settleEarn(s: GameState, outing: Outing, p: TownPoint, now: number, score: number): (Harvest & { gold: number }) | string {
  const r = bandOf(s);
  if (!r || p.tier === 0) return 'Отряда нет.';
  if (!claimOuting(outing)) return 'Добыча уже засчитана';
  const got = earnHaul(p.tier as TownTier, outing.id, score);
  const gold = earnGold(got);
  r.purse += gold;
  log(s, `Заработки в ${p.name}: «${MINIGAME_BY_ID[outing.id].name}» — ${gold} золота.`, 'good');
  return { got, stored: {}, energy: energyShown(s, now), gold };
}
