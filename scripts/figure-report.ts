// Отчёт по силуэтам: совпадение пятен по всем парам видов и со всех сторон,
// плюс признаки, которыми разведены ближайшие пары. Тем же кодом, что и тест
// (units.test.ts), — здесь он просто печатает числа, а не бьёт тревогу.
//
//   npx vite-node scripts/figure-report.ts
import { TROOP_IDS } from '@/game/data/troops';
import type { TroopId } from '@/game/types';
import * as THREE from 'three';
import { Figure, FigurePool, figureBox } from '@/render/figures';
import { poseFigure } from '@/render/poses';
import { FOLK_KINDS, MAN_HEIGHT, dressMount, dressSoldier, dressVillager, gearTier, humanRig, mountRig } from '@/render/units';
import { TURNS, above, area, overlap, projY, silhouette, widthAt } from '@/render/silhouette';

const soldier = (troop: TroopId): Figure => {
  const f = new Figure();
  dressSoldier(f, troop);
  f.phase = 0;
  poseFigure(f, 'stand', 0);
  return f;
};

const folk = (kind: number): Figure => {
  const f = new Figure();
  dressVillager(f, kind);
  f.phase = 0;
  poseFigure(f, 'stand', 0);
  return f;
};

const rows: { a: string; b: string; turn: number; k: number }[] = [];
for (const turn of TURNS) {
  const masks = new Map(TROOP_IDS.map((id) => [id, silhouette(soldier(id), turn)]));
  for (let i = 0; i < TROOP_IDS.length; i++) {
    for (let j = i + 1; j < TROOP_IDS.length; j++) {
      rows.push({
        a: TROOP_IDS[i],
        b: TROOP_IDS[j],
        turn,
        k: overlap(masks.get(TROOP_IDS[i])!, masks.get(TROOP_IDS[j])!),
      });
    }
  }
}
rows.sort((x, y) => y.k - x.k);
console.log('--- все 28 пар × 6 ракурсов; IoU, меньше — различимее ---');
console.log('a,b,turn,iou');
for (const r of [...rows].sort((a, b) => a.a.localeCompare(b.a) || a.b.localeCompare(b.b) || a.turn - b.turn)) {
  console.log(`${r.a},${r.b},${Math.round(r.turn * 180 / Math.PI)},${r.k.toFixed(3)}`);
}
console.log('--- худшие пары по совпадению пятна ---');
for (const r of rows.slice(0, 12)) {
  console.log(`${(r.turn * 180 / Math.PI).toFixed(0).padStart(4)}°  ${r.a.padEnd(11)} ${r.b.padEnd(11)} ${r.k.toFixed(3)}`);
}

console.log('\n--- горожане ---');
for (let i = 0; i < FOLK_KINDS; i++) {
  for (let j = i + 1; j < FOLK_KINDS; j++) {
    console.log(`покрой ${i} и ${j}: ${overlap(silhouette(folk(i)), silhouette(folk(j))).toFixed(3)}`);
  }
}

console.log('\n--- копейщик против мечника: клеток выше 1.1 роста ---');
for (const turn of TURNS) {
  const y = projY(MAN_HEIGHT * 1.1);
  console.log(
    `${(turn * 180 / Math.PI).toFixed(0).padStart(4)}°  копьё ${String(above(silhouette(soldier('spearman'), turn), y)).padStart(4)}` +
    `  меч ${String(above(silhouette(soldier('swordsman'), turn), y)).padStart(4)}`,
  );
}

console.log('\n--- щитоносец против латника ---');
for (const turn of TURNS) {
  const a = silhouette(soldier('shieldman'), turn);
  const b = silhouette(soldier('legionary'), turn);
  console.log(
    `${(turn * 180 / Math.PI).toFixed(0).padStart(4)}°  голень ${widthAt(a, projY(MAN_HEIGHT * 0.2)).toFixed(2)} / ${widthAt(b, projY(MAN_HEIGHT * 0.2)).toFixed(2)}` +
    `  площадь ${area(a)} / ${area(b)} = ${(area(b) / area(a)).toFixed(2)}`,
  );
}

console.log('\n--- рост, ступень снаряжения, деталей ---');
for (const id of TROOP_IDS) {
  const f = soldier(id);
  const box = figureBox(f);
  console.log(
    `${id.padEnd(11)} ступень ${gearTier(id)}  верх ${box.max.y.toFixed(2)}` +
    `  ширина ${(box.max.x - box.min.x).toFixed(2)}  деталей ${f.slots.length}`,
  );
}

console.log('\n--- скелет взрослой фигуры (доли роста) ---');
const rig = humanRig();
for (const [name, v] of [
  ['макушка', MAN_HEIGHT],
  ['основание шеи', rig.neckY],
  ['плечевой сустав', rig.shoulderY],
  ['кисть', rig.shoulderY - rig.armLen],
  ['тазобедренный сустав', rig.hipY],
  ['полуразмах плеч', rig.shoulderX],
  ['разнос ног', rig.hipX],
  ['длина руки', rig.armLen],
] as [string, number][]) {
  console.log(`${name.padEnd(22)} ${v.toFixed(3)}  (${(v / MAN_HEIGHT).toFixed(3)} роста)`);
}

console.log('\n--- конь (доли роста человека) ---');
const m = mountRig();
for (const [name, v] of Object.entries(m)) {
  console.log(`${name.padEnd(12)} ${v.toFixed(3)}  (${(v / MAN_HEIGHT).toFixed(3)})`);
}

const horse = new Figure();
dressMount(horse);
const pool = new FigurePool();
console.log('\n--- стоимость одной фигуры: детали / треугольники с теневым проходом ---');
for (const [id, f] of [...TROOP_IDS.map((id) => [id, soldier(id)] as const),
  ...[0, 1, 2].map((k) => [`folk${k}`, folk(k)] as const), ['horse', horse] as const]) {
  let tris = 0;
  for (const obj of pool.group.children) {
    const mesh = obj as THREE.InstancedMesh;
    const g = mesh.geometry;
    const n = (g.index?.count ?? g.getAttribute('position').count) / 3;
    tris += n * f.counts[mesh.name as keyof typeof f.counts] * (mesh.castShadow ? 2 : 1);
  }
  console.log(`${id}: ${f.slots.length} / ${tris}`);
}
