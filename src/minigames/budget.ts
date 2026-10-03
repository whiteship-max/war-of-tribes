/**
 * Бюджет кадра промыслов — счётом по графу сцены, без видеокарты (docs/minigames.md, 8). Граф тот же, что рисуется:
 * обставляет его `world.furnish`, игры — те же классы, что в сцене; зерно — любое: число кустов, ягод и животных от
 * зерна не зависит.
 */
import * as THREE from 'three';
import { Dome } from '@/prologue/dome';
import { Surfaces } from '@/prologue/surface';
import type { MinigameId } from '@/game/data/minigames';
import { BerriesPlay } from './berriesPlay';
import { HerdPlay } from './herdPlay';
import { aimRing } from './models';
import { frameCost, furnish, type FrameCost } from './world';

/**
 * Потолок кадра на обе игры. Мерка — кадр поляны предыстории на телефонной ступени (`lite`): таблица цены в
 * docs/prologue.md, раздел 20 (`npm run prologue:stand`, `LOOK=`). Промыслам нужно шестьдесят кадров, а не тридцать,
 * поэтому потолок не выше поляны: вызовов — 80, треугольников — 30 тысяч, тень включена.
 */
export const MINI_BUDGET = { calls: 80, triangles: 30_000 };

/** Цена кадра игры: сцена и тень. */
export function budgetOf(id: MinigameId, shadows: boolean): FrameCost {
  const scene = new THREE.Scene();
  const surfaces = new Surfaces();
  const dome = new Dome();
  const camera = new THREE.PerspectiveCamera(72, 390 / 844, 0.05, 90);
  const play = id === 'berries' ? new BerriesPlay(12345) : new HerdPlay(12345);
  furnish(scene, surfaces, play, camera, dome, 'summer');
  const aim = aimRing();
  aim.visible = true;
  scene.add(aim);
  return frameCost(scene, shadows);
}
