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
import { layoutOf } from './layout';
import { frameOf, houseOfTown } from '../tw/town';
import { loadTown } from '../tw/townload';
import type { TwHouse } from '../tw/site';
import type { CityShare } from '../city/index';
import type { TownBackdrop } from '../city/backdrop';

export { CLIPPED, FINALES, breachesAt, episodeAt, machinesUp } from './reel';
export type { Episode, SiegeReel } from './reel';

/**
 * Настоящий город за стеной (docs/polish.md, П-6): тот же, что в окне города (`share` — город игры: план, текстуры, земля;
 * нет — свой). Логово, сбой или долгая сборка — ничего: ролик идёт с домами ролика, как прежде.
 */
export async function siegeTown(show: SiegeShow, quality: Quality, share: CityShare | null): Promise<{ backdrop: TownBackdrop; houses: TwHouse[] } | null> {
  if (show.wall <= 0) return null;
  const lay = layoutOf(show, quality);
  if (!lay.wall || !lay.town) return null;
  const b = await loadTown(lay.wall, lay.town, quality, share, show.ground.winter);
  if (!b) return null;
  const frame = frameOf(lay.wall);
  return { backdrop: b, houses: b.houses.map((h) => houseOfTown(frame, h)) };
}

/**
 * Поставить ролик осады на рендерер. `clip` — короткий ролик эпизода (пролом, вылазка, сдача): кусок того же ролика, всё
 * бывшее до него уже в кадре. Ввод камеры — на слое ролика `touch`, а не на холсте сцены города. `share` — город игры: за
 * стеной встанет он (П-6); ждём его сборки, потом ставим ролик.
 */
export async function playSiege(
  renderer: THREE.WebGLRenderer,
  show: SiegeShow,
  quality: Quality,
  touch: HTMLElement,
  opts: SiegePlayerOptions & { clip?: (reel: SiegeReel) => Episode | null; share?: CityShare | null } = {},
): Promise<SiegePlayer> {
  const town = await siegeTown(show, quality, opts.share ?? null);
  const reel = siegeReel(show, quality, town?.houses ?? null);
  const ep = opts.clip ? opts.clip(reel) : null;
  const player = new SiegePlayer(renderer, reel, TW_SPEC[quality], { ...opts, town: town?.backdrop ?? null, ...(ep ? { range: clipOf(reel, ep) } : {}) });
  player.cam.attach(touch);
  return player;
}
