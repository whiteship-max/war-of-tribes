// Дверь ролика осады из игры (docs/gfx.md, ГФ-2): что посчитала осада → режиссура → проигрыватель на одолженном
// рендерере. Своим куском (`vite.config.ts`, `LAZY_DOORS`, «ролик осады»): на старте игра его не грузит — только по
// «Смотреть осаду» или ролику фазы в донесении. Общее с роликом боя (`render/reel`, кирпичики места `render/tw`) Rollup
// кладёт в общий кусок.
import type * as THREE from 'three';
import type { Quality } from '../quality';
import { TW_SPEC } from '../reel/spec';
import { siegeReel, clipOf, type Episode, type SiegeReel } from './reel';
import { SiegePlayer, type SiegePlayerOptions } from './player';
import type { SiegeShow } from './show';

export { CLIPPED, FINALES, breachesAt, episodeAt, machinesUp } from './reel';
export type { Episode, SiegeReel } from './reel';

/**
 * Поставить ролик осады на рендерер. `clip` — короткий ролик эпизода (пролом, вылазка, сдача): кусок того же ролика, всё
 * бывшее до него уже в кадре. Ввод камеры — на слое ролика `touch`, а не на холсте сцены города.
 */
export function playSiege(
  renderer: THREE.WebGLRenderer,
  show: SiegeShow,
  quality: Quality,
  touch: HTMLElement,
  opts: SiegePlayerOptions & { clip?: (reel: SiegeReel) => Episode | null } = {},
): SiegePlayer {
  const reel = siegeReel(show, quality);
  const ep = opts.clip ? opts.clip(reel) : null;
  const player = new SiegePlayer(renderer, reel, TW_SPEC[quality], { ...opts, ...(ep ? { range: clipOf(reel, ep) } : {}) });
  player.cam.attach(touch);
  return player;
}
