// Свет покоев на фигуре набора персонажа (ЛЦ-3, docs/characters.md; вынесено из супруги ЛЦ-2): шейдер фигуры почти без
// освещения (`material.ts`), и свет комнаты в точке груди кладётся одним цветом — день у окна, свечи и огонь ночью; контур —
// со стороны окон, цветом неба. Супруга и гонец в одной комнате стоят в одном свете.
import * as THREE from 'three';
import type { V3 } from '../../city/geom';
import type { RoomUniforms } from '../material';
import type { FigureUniforms } from './material';

const C = new THREE.Color();
const D = new THREE.Vector3();

/**
 * Свет покоев на фигуре одним цветом: рассеянный свет комнаты, небо из окон и огонь — в точке груди, как их считает шейдер
 * покоев (`material.ts`), только без направлений; контур — со стороны окон, цветом неба. Возвращает сырую освещённость
 * точки — до выравнивания яркости фигуры (`TINT_GAIN` и пределы): зрачку кота (ЛЦ-4) нужна она, а не цвет фигуры.
 */
export function roomLight(r: RoomUniforms, at: V3, u: FigureUniforms): number {
  C.copy(r.uAmb.value).multiplyScalar(3.2);
  let sky = 0;
  D.set(0, 0, 0);
  const wins = r.uWin.value;
  const nors = r.uWinN.value;
  for (let i = 0; i < wins.length; i++) {
    const w = wins[i];
    const n = nors[i];
    const cy = w.y + n.y * 0.6;
    const dx = w.x - at[0];
    const dy = cy - at[1];
    const dz = w.z - at[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    const facing = Math.max(0, -(dx * n.x + dz * n.z) / Math.sqrt(d2));
    const area = w.w * 2 * (n.y + w.w * 0.8);
    const om = (area * facing) / (d2 + area);
    sky += om;
    D.x += (dx / Math.sqrt(d2)) * om;
    D.z += (dz / Math.sqrt(d2)) * om;
  }
  C.add(new THREE.Color().copy(r.uSky.value).multiplyScalar(sky * 0.85));
  const ls = r.uLight.value;
  const lc = r.uLightCol.value;
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    const d2 = (l.x - at[0]) ** 2 + (l.y - at[1]) ** 2 + (l.z - at[2]) ** 2;
    C.r += lc[i].r * (l.w / (0.6 + 0.5 * d2)) * 0.5;
    C.g += lc[i].g * (l.w / (0.6 + 0.5 * d2)) * 0.5;
    C.b += lc[i].b * (l.w / (0.6 + 0.5 * d2)) * 0.5;
  }
  const lum = 0.2126 * C.r + 0.7152 * C.g + 0.0722 * C.b;
  const k = Math.max(0.3, Math.min(1.06, lum * TINT_GAIN));
  const hue = lum > 1e-4 ? [C.r / lum, C.g / lum, C.b / lum] : [1, 1, 1];
  u.uTint.value.setRGB((1 + (Math.min(1.4, hue[0]) - 1) * 0.35) * k, (1 + (Math.min(1.4, hue[1]) - 1) * 0.35) * k, (1 + (Math.min(1.4, hue[2]) - 1) * 0.35) * k);
  u.uRim.value.copy(r.uSky.value).multiplyScalar(Math.min(0.5, 0.2 + sky * 2));
  D.y = 0.25 * Math.hypot(D.x, D.z) + 0.01;
  if (D.lengthSq() > 1e-8) u.uRimDir.value.copy(D).normalize();
  return lum * TINT_GAIN;
}

/** Во сколько раз свет покоев в точке переводится в яркость фигуры (день у окна — около 1). */
export const TINT_GAIN = 1.6;
