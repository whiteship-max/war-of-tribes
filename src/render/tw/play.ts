// Дверь ролика TW из игры (docs/battle_tw.md): запись боя → план → проигрыватель на одолженном рендерере. Своим куском
// (`vite.config.ts`, `LAZY_DOORS`, «ролик TW»): на старте игра его не грузит вовсе — только по «Смотреть бой» и только
// при новом ролике (по умолчанию; прежний — в настройках, `ui/battle/look.ts`).
import type * as THREE from 'three';
import type { BattleResult, Side } from '@/battle/types';
import type { BattlePlace } from '@/game/battle/ground';
import type { TroopStack } from '@/game/battle/kinds';
import type { Quality } from '../quality';
import { TW_SPEC } from '../reel/spec';
import { twPlanOfRecord } from './record';
import { TwPlayer, type TwPlayerOptions } from './player';
import type { TwOpening } from './site';
import type { SideCoats } from '../reel/heraldry';
import type { TwPlan } from './plan';
import { loadTown } from './townload';
import type { CityShare } from '../city/index';
import type { TownBackdrop } from '../city/backdrop';

export { hudAt, type TwHud } from '../reel/hud';
export { CueClock, ambienceAt, cuesOf } from './cues';

export interface TwRecord {
  result: BattleResult;
  us: Side;
  troops: Record<Side, TroopStack>;
  militia?: Record<Side, { men: number; archers: number }>;
  place?: BattlePlace;
  beasts?: Side;
  /** Место боя — `BattleRecord.site` (стена, ворота, вылазка, лагерь, логово); нет — поле. */
  site?: string;
  /**
   * Обстрел перед штурмом (`BattleRecord.shots`): доля пробитой стены после каждого залпа — дверью ядра
   * (`siegecraft.breachOf`), её считает зовущий (`barrageShares`). Есть — ролик начинается с обстрела.
   */
  breach?: readonly number[];
  /** Проёмы штурма (`BattleRecord.openings`): ролик рисует выбранный способ. Нет — лестницы по всему фронту и таран. */
  openings?: readonly TwOpening[];
  /** Гербы сторон на знамёнах (`reel/heraldry`): решает зовущий по записи и донесению (`ui/battle/coats.ts`). */
  coats?: SideCoats;
}

/**
 * Поставить ролик на рендерер. Ввод камеры вешается на `touch` — свой слой поверх холста, а не сам холст: на холсте
 * сидит ввод сцены, и ведение пальцем в ролике двигало бы спрятанную камеру города.
 */
export async function playTw(renderer: THREE.WebGLRenderer, rec: TwRecord, quality: Quality, touch: HTMLElement, opts: TwPlayerOptions & { share?: CityShare | null }): Promise<TwPlayer> {
  const plan = twPlanOfRecord(rec.result, rec.us, rec.troops, quality, rec.militia, rec.place, rec.beasts, rec.site, rec.breach, rec.openings, rec.coats);
  // За стеной — настоящий город (П-6): тот же, что в окне города; ролик ждёт его сборки.
  const town = await twTown(plan, quality, opts.share ?? null);
  const player = new TwPlayer(renderer, plan, TW_SPEC[quality], { ...opts, town });
  player.cam.attach(touch);
  return player;
}

/** Город за стеной места боя (стена, ворота, вылазка, лагерь); поле и логово — ничего. */
export async function twTown(plan: TwPlan, quality: Quality, share: CityShare | null): Promise<TownBackdrop | null> {
  const site = plan.site;
  if (!site?.wall || !site.town) return null;
  return loadTown(site.wall, site.town, quality, share, plan.field.winter);
}
