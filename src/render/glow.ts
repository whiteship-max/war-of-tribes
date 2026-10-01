/**
 * Окна ночью — тёплым светом без единой лампы (вид `next`, docs/graphics_world.md, 9.5).
 *
 * Окно — деталь набора с краской `kit.pane`: цвет тот же тёмный, что у двери, а свет едет
 * в атрибуте вершин `glow` (доля свечения окна, 0..1, у каждого своя — `kit.windowLight`).
 * Здесь — вставка в шейдер тела (`windowGlow`): ночью окно прибавляет к себе тёплое свечение,
 * днём — ничего, и кадр дня тот же. Тело вида `next` с этой вставкой — `env/facade.FACADE_BODY`
 * (этап 2: в нём же фактура стен). Окна и стены — одна группа тела, поэтому **вызовов
 * отрисовки не прибавляется**: у дома их столько же.
 *
 * НЫНЕШНИЙ ВИД НЕ ТРОНУТ НИ НА БИТ: `KIT.body` не правится, а у зданий вида `now` сцена
 * снимает атрибут до первой выгрузки (`dropGlow`) — видеокарта его не видит, и память
 * вершин та же, что до окон.
 */
import * as THREE from 'three';
import { PALETTE } from './palette';

/** Насколько светятся окна сейчас: 0 днём, 1 глубокой ночью. Ведёт сцена кадр за кадром. */
export const WINDOW_NIGHT = { value: 0 };

/**
 * Сила свечения окна при полной ночи: окно ярче штукатурки под луной, но не бело —
 * тонирование сжимает излишек, и окно держит цвет, а не выгорает.
 */
const GLOW_POWER = 2.2;

const uniforms = {
  uWindowNight: WINDOW_NIGHT,
  uWindowColor: { value: new THREE.Color(PALETTE.windowGlow) },
};

/**
 * Вставить свет окон в шейдер тела: доля света окна — в свечение ночью. Своего материала у окон нет.
 * `source` — откуда доля: свой атрибут `glow` или четвёртый байт признаков фактуры (`fac.w`,
 * `kit.facadeTags`) — тогда атрибут объявляет фактура.
 */
export function windowGlow(shader: THREE.WebGLProgramParametersWithUniforms, source = 'glow'): void {
  Object.assign(shader.uniforms, uniforms);
  const own = source === 'glow' ? 'attribute float glow;\n' : '';
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${own}varying float vWindowGlow;`)
    .replace('#include <color_vertex>', `#include <color_vertex>\nvWindowGlow = ${source};`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uWindowNight;\nuniform vec3 uWindowColor;\nvarying float vWindowGlow;')
    .replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>\ntotalEmissiveRadiance += uWindowColor * ( vWindowGlow * uWindowNight * ${GLOW_POWER.toFixed(2)} );`,
    );
}

/** Снять признак окон — у вида `now`: до первой выгрузки, видеокарта его не увидит. */
export function dropGlow(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry.getAttribute('glow')) mesh.geometry.deleteAttribute('glow');
  });
}
