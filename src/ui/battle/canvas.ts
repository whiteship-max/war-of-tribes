/**
 * Холст ролика о бое — одолженный у диорамы или свой: его размер, его аспект и его контекст.
 *
 * Общий у обоих роликов (`BattleReplay`, `TwReplay`), потому что болезни у них были общие:
 *
 *  - **свой холст не получал размера вовсе.** Рендерер заводился без `setSize`, и буфер
 *    оставался размером холста по умолчанию — 300×150, растянутый на экран: мыло и аспект 2:1;
 *  - **аспект пересчитывался только по `resize` окна.** Высота приложения меняется и мимо него —
 *    её пишет дверь окна при разворачивании (`src/viewport.ts`), — и ролик, открытый до
 *    сворачивания, после разворачивания рисовал бы по старому аспекту. Теперь холст меряет
 *    ResizeObserver, как у диорамы и карты;
 *  - **мёртвый контекст оставлял ролик чёрным.** Не вернулся в срок (`render/context.ts`) — ролик
 *    кончается отчётом: досмотреть его нечем, а отчёт о бое не нуждается в WebGL.
 */
import type * as THREE from 'three';
import type { TribeScene } from '@/render/Scene';
import { pixelRatio } from '@/render/loop';
import { watchContext } from '@/render/context';
import { onViewport } from '@/viewport';

/**
 * Держать холст ролика: размер (свой холст), аспект (`fit` проигрывателя) и контекст. Зовётся,
 * когда проигрыватель уже есть: первый замер сразу отдаёт ему аспект. Возвращает уборку.
 *
 * @param scene  диорама, у которой холст одолжен; `null` — холст свой;
 * @param fit    пересчитать аспект проигрывателя по размеру рендерера;
 * @param onDead контекст не вернулся в срок — закончить ролик.
 */
export function holdReplayCanvas(renderer: THREE.WebGLRenderer, scene: TribeScene | null, fit: () => void, onDead: () => void): () => void {
  const canvas = renderer.domElement;
  const refit = (): void => {
    if (scene) {
      // Холст диорамы меряет сама диорама; здесь — чтобы её замер был раньше аспекта ролика.
      scene.resize();
    } else {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      // Нулевой холст буфер не получает: кадр по нулевому аспекту хуже прежнего.
      if (w > 0 && h > 0) {
        renderer.setPixelRatio(pixelRatio());
        renderer.setSize(w, h, false);
      }
    }
    fit();
  };
  refit();
  const ro = new ResizeObserver(refit);
  ro.observe(canvas);
  // Плотность пикселей меняется мимо размера элемента — её приносит дверь окна.
  const offViewport = onViewport(refit);
  // Контекст одолженного холста просит вернуть его хозяин — диорама; свой — сторож.
  const offContext = watchContext(renderer, onDead, { ask: scene === null });
  return () => {
    ro.disconnect();
    offViewport();
    offContext();
  };
}
