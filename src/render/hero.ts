// Герой на площади. Единственная фигурка в игре, за которой стоит конкретный
// человек: население — число, дружина — счётчики, а герой один и у него есть имя.
//
// Мешей у агента нет, как и у остальных: он правит позу своей `Figure`, а рисует
// всех разом пул инстансов (figures.ts). Никаких новых вызовов отрисовки герой
// не добавляет — он такая же фигурка, просто одна и на своём месте.
import type { GameState } from '@/game/types';
import { heroReady } from '@/game/derived';
import { RING_RADIUS, PLAN, facingCenter } from './plan';
import { Figure, STICK_RADIUS } from './figures';
import { HERO_TINT, PALETTE } from './palette';

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

export class HeroAgent {
  readonly figure = new Figure();
  private phase = Math.random() * 10;

  constructor() {
    const f = this.figure;
    // Одет не как свободные руки у костра: герой должен читаться с одного взгляда.
    f.colors.torso.setHex(HERO_TINT.cloak);
    f.colors.cap.setHex(HERO_TINT.helm);
    f.colors.shield.setHex(HERO_TINT.shield);
    f.colors.stick.setHex(PALETTE.metal);
    // Копьё длиннее любого дружинного: силуэт героя должен быть выше всех.
    f.stick = { length: 1.35, radius: STICK_RADIUS * 1.3, tilt: 0.1 };
    f.shield = true;
    f.torsoWidth = 1.15;
    const spot = heroSpot();
    f.position.set(spot.x, 0, spot.z);
    f.rotationY = spot.rot;
  }

  /** Герой не гуляет: он стоит у статуи. Живёт только дыхание — им и обходимся. */
  update(t: number): void {
    this.figure.torsoTilt = Math.sin(t * 1.1 + this.phase) * 0.03;
    this.figure.legSwing = 0;
  }
}
