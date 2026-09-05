// Герой на площади. Единственная фигурка в игре, за которой стоит конкретный
// человек: население — число, дружина — счётчики, а герой один и у него есть имя.
//
// Мешей у агента нет, как и у остальных: он правит позу своей `Figure`, а рисует
// всех разом пул инстансов (figures.ts). Никаких новых вызовов отрисовки герой
// не добавляет — он такая же фигурка, просто одна и на своём месте.
//
// Одевается он тем же `dressHero` → `dressSoldier`, что и дружина, и по виду
// бойца того рода, который сейчас ведёт: второго набора правил о том, как
// выглядит боец, в игре быть не должно. Сменил род в Статуе — сменился и
// силуэт на площади. Своего у героя только рост и плащ.
import type { GameState } from '@/game/types';
import { heroReady } from '@/game/derived';
import { TROOPS_OF_KIND } from '@/game/battle/kinds';
import { RING_RADIUS, PLAN, facingCenter } from './plan';
import { Figure } from './figures';
import { poseFigure } from './poses';
import { dressHero } from './units';

/**
 * Виден ли герой в сцене. Ушёл в поход или лежит после боя — площадь пуста, и
 * это самый честный способ показать игроку, что его сейчас нет: считать дни в
 * панели он не станет, а пустое место у статуи заметит.
 */
export const heroShown = (s: GameState): boolean => heroReady(s);

/** Где стоит: перед своей статуей, лицом к костру. */
export function heroSpot(): { x: number; z: number; rot: number } {
  const place = PLAN.statue;
  const angle = place ? place.angle : 0;
  // Чуть ближе к площади, чем сама статуя: герой стоит перед ней, а не в ней.
  const r = (place ? RING_RADIUS[place.ring] : 5) - 1.9;
  return { x: Math.cos(angle) * r, z: Math.sin(angle) * r, rot: facingCenter(angle) };
}

/** Насколько герой крупнее рядового: заметно, но не вдвое — он человек. */
const HERO_SCALE = 1.12;

export class HeroAgent {
  readonly figure = new Figure();

  constructor(s: GameState) {
    const f = this.figure;
    // Лучший вид своего рода: герой ведёт род, а выглядит как его вершина.
    const own = TROOPS_OF_KIND[s.hero.kind];
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
