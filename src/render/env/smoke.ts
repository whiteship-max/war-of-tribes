// Клубы дыма вида `next` — круглые и мягкие (docs/graphics_world.md, 11.6). Точки three без текстуры рисуются
// квадратами, и вблизи дым очагов, работы и костра читался полупрозрачными плитками. Правка шейдера, а не текстура:
// прозрачность растёт от середины точки к краю (`gl_PointCoord`), и клуб чуть крупнее, чтобы мягкий край не съел его
// массу. Вызовов, буферов и текстур не прибавляется.
//
// Прежний вид правки не получает: модуль едет ленивым куском окружения, и сцена накладывает её на свои системы дыма,
// когда кусок приехал (`Scene.envArrived`).
import type * as THREE from 'three';

/** Во сколько раз круглый клуб крупнее квадратного: мягкий край забирает у него край площади. */
export const PUFF_GROW = 1.3;

/** Мягкий край клуба: полная плотность до этой доли радиуса, дальше — на нет к краю точки. */
export const PUFF_CORE = 0.24;

const PUFF_VERT = /* glsl */ `gl_PointSize *= ${PUFF_GROW.toFixed(2)};
#include <logdepthbuf_vertex>`;

const PUFF_FRAG = /* glsl */ `#include <color_fragment>
diffuseColor.a *= smoothstep( 0.5, ${(PUFF_CORE / 2).toFixed(2)}, length( gl_PointCoord - 0.5 ) );`;

/** Круглый мягкий клуб вместо квадрата: правка программы материала точек дыма (`weather.Smoke`). */
export function roundSmoke(mat: THREE.PointsMaterial): void {
  mat.onBeforeCompile = (shader): void => {
    shader.vertexShader = shader.vertexShader.replace('#include <logdepthbuf_vertex>', PUFF_VERT);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', PUFF_FRAG);
  };
  // Своя программа: у прежнего вида тот же материал без правки, и делить с ним программу нельзя.
  mat.customProgramCacheKey = (): string => 'smoke-puff';
  mat.needsUpdate = true;
}
