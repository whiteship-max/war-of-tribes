/**
 * Что стоит на поляне промыслов и сколько это стоит кадру (docs/minigames.md, разделы 7–8).
 *
 * Обставляет поляну одна функция (`furnish`) — и сцена, и тест бюджета: счёт треугольников и вызовов отрисовки
 * снимается с того самого графа, который рисуется, а не с его описания. Видеокарта для счёта не нужна: геометрия и
 * материалы `three` — просто объекты.
 */
import * as THREE from 'three';
import type { Dome } from '@/prologue/dome';
import type { Surfaces } from '@/prologue/surface';
import { Shade, forest, gladeGround } from '@/prologue/models';
import type { Season } from '@/game/types';
import { tufts } from './models';
import type { Play } from './stage';

/** Обставить поляну: небо, земля, стена леса, трава по сезону, своё у игры и пятна тени. */
export function furnish(scene: THREE.Scene, surfaces: Surfaces, play: Play, camera: THREE.Camera, dome: Dome, season: Season): void {
  scene.add(dome.root);
  const shade = new Shade();
  // Трава не растёт там, где стоит своё у игры: в кустах и под стогом.
  const keep = play.blockers(0).map((b) => ({ x: b.x, z: b.z, r: b.r + 0.25 }));
  scene.add(surfaces.adopt(gladeGround()), surfaces.adopt(forest(shade), 'crown'), surfaces.adopt(tufts(season, keep), 'tuft'));
  play.build(scene, surfaces, shade, camera);
  scene.add(shade.mesh());
  scene.add(camera);
}

/** Цена кадра по графу: вызовы отрисовки и треугольники сцены, отдельно — теневой проход. */
export interface FrameCost {
  calls: number;
  triangles: number;
  shadowCalls: number;
  shadowTriangles: number;
}

const trisOf = (g: THREE.BufferGeometry, start = 0, count = Infinity): number => {
  const all = g.index ? g.index.count : (g.attributes.position?.count ?? 0);
  return Math.max(0, Math.min(all, start + count) - start) / 3;
};

/**
 * Сколько стоит кадр: каждый видимый меш — вызов на группу материалов (одна, если групп нет), инстансы — один вызов
 * на все, точки и спрайты — по вызову. Теневой проход — то же по тем, кто отбрасывает тень, если тени есть.
 * Отсечение по взгляду не учитывается: счёт — верхняя граница, а не среднее.
 */
export function frameCost(scene: THREE.Scene, shadows: boolean): FrameCost {
  const out: FrameCost = { calls: 0, triangles: 0, shadowCalls: 0, shadowTriangles: 0 };
  scene.traverseVisible((o) => {
    const mesh = o as THREE.Mesh;
    if ((o as THREE.Points).isPoints) {
      out.calls += 1;
      return;
    }
    if ((o as THREE.Sprite).isSprite) {
      out.calls += 1;
      out.triangles += 2;
      return;
    }
    if (!mesh.isMesh) return;
    const g = mesh.geometry;
    const copies = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1;
    const groups = Array.isArray(mesh.material) && g.groups.length > 0 ? g.groups : [{ start: 0, count: Infinity }];
    for (const grp of groups) {
      const tris = trisOf(g, grp.start, grp.count) * copies;
      out.calls += 1;
      out.triangles += tris;
      if (shadows && mesh.castShadow) {
        out.shadowCalls += 1;
        out.shadowTriangles += tris;
      }
    }
  });
  return out;
}
