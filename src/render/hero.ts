// Герой на площади. Единственная фигурка в игре, за которой стоит конкретный
// человек: население — число, дружина — счётчики, а герой один и у него есть имя.
//
// Мешей у агента нет, как и у остальных: он правит позу своей `Figure`, а рисует
// всех разом пул инстансов (figures.ts). Никаких новых вызовов отрисовки герой
// не добавляет — он такая же фигурка, просто одна и на своём месте.
//
// Одевается он тем же `dressHero` → `dressSoldier`, что и дружина, и по виду
// бойца того рода, которого в войске больше всего: второго набора правил о том,
// как выглядит боец, в игре быть не должно. Своего рода у героя больше нет — род
// за золото и люди в бой из ниоткуда ушли с поставкой 1 боя (docs/battle_eu4.md,
// 14.19.6), — и одежду ему даёт войско. Дружины в сохранении племени нет (её
// держит мир), поэтому род берётся по всему войску. Своего у героя только рост и плащ.
import type { GameState } from '@/game/types';
import { UNIT_KINDS, type UnitKind } from '@/battle';
import { seated } from '@/game/sim/agents';
import { TROOPS_OF_KIND } from '@/game/battle/kinds';
import { kindsOf } from '@/game/battle/price';
import { RING_RADIUS, PLAN, facingCenter } from './plan';
import { Figure } from './figures';
import { poseFigure } from './poses';
import { dressHero } from './units';

/**
 * Виден ли герой в сцене. Места некому занять (он и есть полководец, и смертен так же) —
 * площадь пуста, и это самый честный способ показать игроку, что его сейчас нет: считать
 * дни в панели он не станет, а пустое место у статуи заметит.
 */
export const heroShown = (s: GameState): boolean => seated(s, 'general');

/** Род, в который одет герой: тот, которого в войске больше всего бойцов строя; войска нет — пехота. */
export function heroKind(s: GameState): UnitKind {
  const men = kindsOf(s.army);
  let best: UnitKind = 'infantry';
  for (const k of UNIT_KINDS) if (TROOPS_OF_KIND[k].length > 0 && men[k] > men[best]) best = k;
  return best;
}

/** Где стоит: перед своей статуей, лицом к костру. */
export function heroSpot(): { x: number; z: number; rot: number } {
  const place = PLAN.statue;
  const angle = place ? place.angle : 0;
  // Чуть ближе к площади, чем сама статуя: герой стоит перед ней, а не в ней.
  const r = (place ? RING_RADIUS[place.ring] : 5) - 1.9;
  return { x: Math.cos(angle) * r, z: Math.sin(angle) * r, rot: facingCenter(angle) };
}

/** Насколько герой крупнее рядового: заметно, но не вдвое — он человек. */
export const HERO_SCALE = 1.12;

export class HeroAgent {
  readonly figure = new Figure();

  constructor(s: GameState) {
    const f = this.figure;
    // Лучший вид своего рода: герой ведёт род, а выглядит как его вершина.
    const own = TROOPS_OF_KIND[heroKind(s)];
    dressHero(f, own[own.length - 1]);
    f.scale = HERO_SCALE;
    const spot = heroSpot();
    f.position.set(spot.x, 0, spot.z);
    f.rotationY = spot.rot;
  }

  /** Герой не гуляет: он стоит у статуи в изготовке, как стража у ворот. */
  update(t: number): void {
    poseFigure(this.figure, 'guard', t);
  }
}
