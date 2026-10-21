// Скелет набора персонажа (ЛЦ-3, docs/characters.md; вынесено из супруги ЛЦ-2): мало костей и два веса, как у моделей
// классического Warcraft III. Общая часть — корпус в три кости (таз, поясница, грудь), шея и голова с челюстью и веками, по
// руке — плечо, предплечье, кисть и большой палец. Своё у фигуры — то, что над головой (волосы), и то, что ниже пояса: у
// супруги — юбка в три кости без ног, у гонца — ноги ниже туники, плащ и сума.
import type { V3 } from '../../city/geom';
import { Skeleton } from '../rig';

/** Суставы общей части (оси фигуры): корпус, шея, голова, челюсть, веки; рука — левая (+x), правая — зеркалом. */
export interface UpperJoints {
  hips: V3;
  spine: V3;
  chest: V3;
  neck: V3;
  head: V3;
  jaw: V3;
  lids: V3;
  /** Кости головы сверх общих (волосы) — по порядку, у каждой родитель — голова. */
  crown: readonly (readonly [string, V3])[];
  shoulder: V3;
  elbow: V3;
  wrist: V3;
  thumb: V3;
  /** Перевод сустава руки стороны `sx` в оси фигуры (у супруги — зеркало и рост). */
  arm: (p: V3, sx: 1 | -1) => V3;
}

/** Общая часть скелета по порядку (родитель раньше ребёнка): корпус, голова, руки. */
export function upperSkeleton(j: UpperJoints): Skeleton {
  const sk = new Skeleton();
  sk.add('hips', null, j.hips);
  sk.add('spine', 'hips', j.spine);
  sk.add('chest', 'spine', j.chest);
  sk.add('neck', 'chest', j.neck);
  sk.add('head', 'neck', j.head);
  sk.add('jaw', 'head', j.jaw);
  sk.add('lids', 'head', j.lids);
  for (const [name, at] of j.crown) sk.add(name, 'head', at);
  for (const [side, sx] of [
    ['L', 1],
    ['R', -1],
  ] as const) {
    sk.add(`arm${side}`, 'chest', j.arm(j.shoulder, sx));
    sk.add(`fore${side}`, `arm${side}`, j.arm(j.elbow, sx));
    sk.add(`hand${side}`, `fore${side}`, j.arm(j.wrist, sx));
    sk.add(`thumb${side}`, `hand${side}`, j.arm(j.thumb, sx));
  }
  return sk;
}
