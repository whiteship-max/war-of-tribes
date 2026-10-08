/**
 * Бюджет кадра промыслов — счётом по графу сцены, без видеокарты (docs/minigames.md, 8). Граф тот же, что рисуется:
 * обставляет его `world.furnish`, игры — те же классы, что в сцене; зерно — любое: число кустов, ягод, животных,
 * оленей, укрытий и деревьев берега от зерна не зависит.
 */
import * as THREE from 'three';
import { Dome } from '@/prologue/dome';
import { Surfaces } from '@/prologue/surface';
import type { MinigameId } from '@/game/data/minigames';
import { BerriesPlay } from './berriesPlay';
import { HerdPlay } from './herdPlay';
import { HuntPlay } from './huntPlay';
import { FishPlay } from './fishPlay';
import type { Shore } from './fishing';
import type { Play } from './stage';
import { aimRing } from './models';
import { frameCost, furnish, type FrameCost } from './world';

/**
 * Потолок кадра на обе игры. Мерка — кадр поляны предыстории на телефонной ступени (`lite`): таблица цены в
 * docs/prologue.md, раздел 20 (`npm run prologue:stand`, `LOOK=`). Промыслам нужно шестьдесят кадров, а не тридцать,
 * поэтому потолок не выше поляны: вызовов — 80, треугольников — 30 тысяч, тень включена.
 */
export const MINI_BUDGET = { calls: 80, triangles: 30_000 };

/**
 * Цена кадра игры: сцена и тень. «Рыбалка» — у реки или у моря (`shore`): у реки дальний берег с лесом и камышом, у
 * моря — мыс; рыбы в графе — все виды берега, видна одна.
 */
export function budgetOf(id: MinigameId, shadows: boolean, shore: Shore = 'river'): FrameCost {
  const scene = new THREE.Scene();
  const surfaces = new Surfaces();
  const dome = new Dome();
  const camera = new THREE.PerspectiveCamera(72, 390 / 844, 0.05, 90);
  const play: Play =
    id === 'berries'
      ? new BerriesPlay(12345)
      : id === 'herd'
        ? new HerdPlay(12345)
        : id === 'hunt'
          ? new HuntPlay(12345)
          : new FishPlay(12345, { shore, zone: shore === 'sea' ? 'med' : 'land', season: 'summer', rain: 0 });
  furnish(scene, surfaces, play, camera, dome, 'summer');
  const aim = aimRing();
  aim.visible = true;
  scene.add(aim);
  return frameCost(scene, shadows);
}
