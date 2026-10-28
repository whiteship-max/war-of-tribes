// Строки режима марша окна дела (ДР-7, docs/city_v3.md, «Решения ДР-7») — докачкой из меню дел полководца (`LocalWorld.errands`):
// окно дела и так едет лениво, и первой загрузке сборка строк не нужна. Дорогу в каждом режиме называют мерки мира — те же, что
// у плана и приказа (`GaitRoads`: по земле, домой, поход на город игрока, встреча погони, удар по лагерю и выручка); здесь только
// какая мерка у какого дела и отказ лагеря налегке. Своих чисел нет.
import { realMs } from '@/game/pace';
import { GAITS, siegeBlockOf, type Gait } from '../gait';
import { warMeet } from '../pvpmeet';
import type { Coord, ErrandOption, GaitRow } from '../types';
import type { ErrandSpot, LocalWorld } from './LocalWorld';

/** Мерки дорог мира, которыми считает и приказ. */
export type GaitRoads = Pick<LocalWorld, 'walkMsTo' | 'backMsFrom' | 'warWalkOf' | 'chaseMeet' | 'strikeSeconds' | 'warPaceOf'>;

/** Отказ строки перехвата: в этом режиме не догнать. */
const CHASE_MISS = 'Не догнать: дойдут раньше.';

/**
 * Строки трёх режимов: дорога туда и назад (`roadOf`; null — в этом режиме дороги нет, и отказ — `miss`); у дела с лагерем
 * (`camp`) налегке — отказ лагеря. Стоит у цели — дороги нет, и строк нет: режим не выбирают.
 */
function rowsOf(roadOf: (g: Gait) => { walkMs: number; backMs: number } | null, camp = false, miss = ''): GaitRow[] | undefined {
  const rows = GAITS.map((g) => {
    const road = roadOf(g);
    return { gait: g, walkMs: road?.walkMs ?? 0, backMs: road?.backMs ?? 0, block: road ? (camp ? siegeBlockOf(g) : null) : miss };
  });
  return rows.some((r) => r.walkMs > 0) ? rows : undefined;
}

/** Строки режима — каждому делу полководца с дорогой, мерой его дела. `from` — где полководец сейчас. */
export function withGaits(w: GaitRoads, spot: ErrandSpot, list: ErrandOption[], from: Coord, now: number): void {
  for (const o of list) {
    let rows: GaitRow[] | undefined;
    if ((o.id === 'storm' || o.id === 'siege' || o.id === 'blockade') && (spot.kind === 'place' || spot.kind === 'rival')) {
      // Поход на город игрока — туда и назад дорогой сервера войны; двор мира — по земле и домой.
      const c = spot.kind === 'rival' ? spot.c : null;
      rows = rowsOf((g) => {
        const walk = c ? w.warWalkOf(c, g) : o.walkMs > 0 ? w.walkMsTo('general', spot.at, now, g) : 0;
        return { walkMs: walk, backMs: c ? walk : w.backMsFrom('general', spot.at, g) };
      }, o.id !== 'storm');
    } else if (o.id === 'intercept' && spot.kind === 'march') {
      rows = rowsOf(
        (g) => {
          // Поход игрока (ПЛ-1) — встречей сервера войны (`pvpmeet.warMeet`), той же, что посчитает приказ.
          const m = spot.war ? warMeet(from, g, spot.war, now, w.warPaceOf()) : w.chaseMeet(spot.m, now, g);
          return m ? { walkMs: Math.max(0, Math.round(m.time - now)), backMs: w.backMsFrom('general', m.at, g) } : null;
        },
        false,
        CHASE_MISS,
      );
    } else if ((o.id === 'strike' && spot.kind === 'place') || (o.id === 'relief' && spot.kind === 'rival')) {
      // Удар по лагерю и выручка — дорогой сервера войны (`pvp.fieldWalkSeconds`).
      const to = spot.at;
      rows = rowsOf((g) => ({ walkMs: Math.round(realMs(w.strikeSeconds(from, to, g))), backMs: w.backMsFrom('general', to, g) }));
    }
    if (rows) o.gaits = rows;
  }
}
