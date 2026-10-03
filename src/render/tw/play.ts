// Дверь ролика TW из игры (docs/battle_tw.md): запись боя → план → проигрыватель на одолженном рендерере. Своим куском
// (`vite.config.ts`, `LAZY_DOORS`, «ролик TW»): на старте игра его не грузит вовсе — только по «Смотреть бой» и только
// при новом ролике (по умолчанию; прежний — в настройках, `ui/battle/look.ts`).
import type * as THREE from 'three';
import type { BattleResult, Side } from '@/battle/types';
import type { BattlePlace } from '@/game/battle/ground';
import type { TroopStack } from '@/game/battle/kinds';
import type { Quality } from '../quality';
import { TW_SPEC } from './spec';
import { twPlanOfRecord } from './record';
import { TwPlayer, type TwPlayerOptions } from './player';

export { hudAt, type TwHud } from './hud';
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
}

/**
 * Поставить ролик на рендерер. Ввод камеры вешается на `touch` — свой слой поверх холста, а не сам холст: на холсте
 * сидит ввод сцены, и ведение пальцем в ролике двигало бы спрятанную камеру города.
 */
export function playTw(renderer: THREE.WebGLRenderer, rec: TwRecord, quality: Quality, touch: HTMLElement, opts: TwPlayerOptions): TwPlayer {
  const plan = twPlanOfRecord(rec.result, rec.us, rec.troops, quality, rec.militia, rec.place, rec.beasts, rec.site);
  const player = new TwPlayer(renderer, plan, TW_SPEC[quality], opts);
  player.cam.attach(touch);
  return player;
}
