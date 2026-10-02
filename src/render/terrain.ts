// Модели окружения поляны предыстории (`prologue/models.ts`): ель ближняя и дальняя, камень, поваленный
// ствол и шум рельефа. Прежде здесь жил ландшафт посёлка — земля, лес, скалы и граница расчистки; посёлок
// убран вместе с видами `now` и `next` (docs/city.md, «Город — единственный вид»), и осталось то, что берёт
// поляна. Расстановка детерминирована по сиду: позиции и повороты — хеш, а не `Math.random`.
import * as THREE from 'three';
import { LEGACY } from './materials';

/** Материалы окружения — из общего набора; цвета в palette.ts. */
const MAT = LEGACY;

/** Детерминированный шум для расстановки деревьев. */
function hash(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const smooth = (t: number): number => {
  const k = THREE.MathUtils.clamp(t, 0, 1);
  return k * k * (3 - 2 * k);
};

/** Хеш по позиции, а не по индексу вершины: рельеф не зависит от сетки. */
function vhash(ix: number, iz: number): number {
  const x = Math.sin(ix * 127.1 + iz * 311.7 + 74.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Value-noise на целочисленной решётке, −1..1, сглаженная интерполяция. */
export function vnoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  const a = vhash(ix, iz);
  const b = vhash(ix + 1, iz);
  const c = vhash(ix, iz + 1);
  const d = vhash(ix + 1, iz + 1);
  const v = a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  return v * 2 - 1;
}

export function makeTree(scale = 1, variant = 0): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * scale, 0.18 * scale, 0.8 * scale, 5), MAT.trunk);
  trunk.position.y = 0.4 * scale;
  trunk.castShadow = true;
  g.add(trunk);
  const mat = variant % 2 === 0 ? MAT.leaves : MAT.leaves2;
  const c1 = new THREE.Mesh(new THREE.ConeGeometry(0.75 * scale, 1.3 * scale, 6), mat);
  c1.position.y = 1.3 * scale;
  c1.castShadow = true;
  g.add(c1);
  const c2 = new THREE.Mesh(new THREE.ConeGeometry(0.55 * scale, 1.0 * scale, 6), mat);
  c2.position.y = 2.0 * scale;
  c2.castShadow = true;
  g.add(c2);
  return g;
}

/**
 * Дальнее дерево: один конус без ствола и без донца. Донце лежит на земле и не
 * видно никогда, а openEnded снимает с него весь веер. Один веер боковых граней
 * против ствола и двух крон с донцами у ближнего дерева (`makeTree`) — и в кадре
 * разницы нет: на таком удалении
 * ель и была конусом. Крона выше и шире ближней, чтобы силуэт не осел без ствола.
 */
export function makeFarTree(scale = 1, variant = 0): THREE.Mesh {
  const mat = variant % 2 === 0 ? MAT.leaves : MAT.leaves2;
  const h = 2.9 * scale;
  // Подъём запечён в геометрию, а не в position: put() ставит объект на рельеф и
  // position.y перезаписывает — конус ушёл бы в землю по середину.
  const geo = new THREE.ConeGeometry(0.86 * scale, h, 5, 1, true).translate(0, h / 2, 0);
  return new THREE.Mesh(geo, mat);
}

export function makeRock(scale = 1): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5 * scale, 0), MAT.rock);
  m.position.y = 0.3 * scale;
  m.rotation.set(hash(scale * 10) * 3, hash(scale * 20) * 3, 0);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Поваленный ствол: лежит там, где его свалили, со срезанной верхушкой. */
export function makeLog(len = 1.6, seed = 0): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, len, 6), MAT.trunk);
  trunk.rotation.z = Math.PI / 2;
  trunk.position.y = 0.17;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  g.add(trunk);
  const cut = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 6), MAT.cut);
  cut.rotation.z = Math.PI / 2;
  cut.position.set(len / 2, 0.17, 0);
  g.add(cut);
  g.rotation.y = hash(seed) * Math.PI * 2;
  return g;
}
