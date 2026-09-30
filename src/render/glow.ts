/**
 * Окна ночью — тёплым светом без единой лампы (вид `next`, docs/graphics_world.md, 9.5).
 *
 * Окно — деталь набора с краской `kit.pane`: цвет тот же тёмный, что у двери, а свет едет
 * в атрибуте вершин `glow` (доля свечения окна, 0..1, у каждого своя — `kit.windowLight`).
 * Здесь — копия «тела» набора (`KIT.body`), которая этот атрибут читает: ночью окно
 * прибавляет к себе тёплое свечение, днём — ничего, и кадр дня тот же. Окна и стены —
 * одна группа тела, поэтому **вызовов отрисовки не прибавляется**: у дома их столько же.
 *
 * НЫНЕШНИЙ ВИД НЕ ТРОНУТ НИ НА БИТ: `KIT.body` не правится, а у зданий вида `now` сцена
 * снимает атрибут до первой выгрузки (`dropGlow`) — видеокарта его не видит, и память
 * вершин та же, что до окон.
 */
import * as THREE from 'three';
import { KIT } from './materials';
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

/** Тело набора, которое читает свет окон. Одно на игру, как само тело. */
export const LIT_BODY: THREE.MeshLambertMaterial = KIT.body.clone();
LIT_BODY.name = 'body-lit';
LIT_BODY.onBeforeCompile = (shader): void => {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vWindowGlow;')
    .replace('#include <color_vertex>', '#include <color_vertex>\nvWindowGlow = glow;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uWindowNight;\nuniform vec3 uWindowColor;\nvarying float vWindowGlow;')
    .replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>\ntotalEmissiveRadiance += uWindowColor * ( vWindowGlow * uWindowNight * ${GLOW_POWER.toFixed(2)} );`,
    );
};
LIT_BODY.customProgramCacheKey = (): string => 'body-lit';

/** Зажечь окна здания: тело меша, у которого есть окна, — светящееся. Группы и вызовы те же. */
export function lightWindows(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry.getAttribute('glow')) return;
    if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((m) => (m === KIT.body ? LIT_BODY : m));
    else if (mesh.material === KIT.body) mesh.material = LIT_BODY;
  });
}

/** Снять признак окон — у вида `now`: до первой выгрузки, видеокарта его не увидит. */
export function dropGlow(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry.getAttribute('glow')) mesh.geometry.deleteAttribute('glow');
  });
}
