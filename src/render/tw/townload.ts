// Город за стеной ролика (docs/polish.md, П-6) — дверь для обоих роликов, боя у стены и осады: собрать настоящий город
// (`city/backdrop.ts`) под стену ролика и вырез под бой. Сборка — в потоке и своим куском (тот же, что у окна города: в
// игре он уже загружен); долго, сбой — ничего: ролик идёт с домами ролика, как прежде.
import type { Quality } from '../quality';
import type { CityShare } from '../city/index';
import type { TownBackdrop } from '../city/backdrop';
import { frameOf, townCut, type Box2 } from './town';
import type { TwWall } from './site';

/** Сколько ждать город (поток сборки): дольше — ролик идёт без него. */
export const TOWN_WAIT = 10_000;

/** Собрать город под стену `w`: `inside` и `outside` — где ходят люди ролика (`TwSite.town`, `SiegeLayout.town`). */
export async function loadTown(w: TwWall, zones: { inside: Box2[]; outside: Box2 }, quality: Quality, share: CityShare | null, winter: boolean): Promise<TownBackdrop | null> {
  const cut = townCut(w, zones.inside, zones.outside);
  try {
    const { townBackdrop } = await import('../city/backdrop');
    const build = townBackdrop(frameOf(w), cut, quality, share, winter);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), TOWN_WAIT);
    });
    const b = await Promise.race([build, late]);
    clearTimeout(timer);
    if (!b) {
      // Долго — без города; собравшийся позже освобождается.
      void build.then((x) => x.dispose(), () => undefined);
      return null;
    }
    return b;
  } catch (e) {
    console.error('город в ролике:', e);
    return null;
  }
}
