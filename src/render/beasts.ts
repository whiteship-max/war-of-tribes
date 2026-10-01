/**
 * Звери из деталей фигур: собака у костра (вид `next`, этап 2, пункт 3) и волк ролика боя (пункт 4) —
 * docs/graphics_world.md, 11.3–11.4. Скелет — конский (`figures.MountRig`: спина, бочка, четыре ноги со
 * сгибами, шея с наклоном, хвост), детали — те же семь примитивов пула: ни меша, ни материала, ни вызова
 * на зверя не прибавляется (docs/figures.md, «Чего делать нельзя»). Цвет — из палитры.
 *
 * Модуль берут только ленивые куски — окружение посёлка и ролик боя: в первую загрузку он не входит.
 */
import { addSlot, type Figure, type MountRig } from './figures';
import { humanRig } from './units';
import { PALETTE } from './palette';

/** Какой зверь: высота в холке, масть, хвост. */
export interface CanineLook {
  /** Высота в холке, в метрах сцены (человек — 1.05). */
  size: number;
  coat: number;
  dark: number;
  /** Пушистый хвост волка толще собачьего. */
  bushy: boolean;
}

/** Собака у костра — по колено человеку. */
export const DOG: CanineLook = { size: 0.42, coat: PALETTE.dogCoat, dark: PALETTE.dogDark, bushy: false };
/** Волк ролика — крупнее собаки, серый, хвост поленом. */
export const WOLF: CanineLook = { size: 0.56, coat: PALETTE.wolfCoat, dark: PALETTE.wolfDark, bushy: true };

/** Скелет псового: длинное низкое тело, шея вперёд, ноги до земли. */
export function canineRig(s: number): MountRig {
  return {
    backY: s,
    barrelH: s * 0.42,
    bodyLen: s * 1.25,
    bodyW: s * 0.34,
    legY: s * 0.64,
    legX: s * 0.11,
    legZ: s * 0.4,
    legLen: s * 0.66,
    neckY: s * 0.86,
    neckZ: s * 0.5,
    neckLen: s * 0.32,
    neckPitch: CANINE_NECK,
    tailY: s * 0.92,
    tailZ: -s * 0.62,
  };
}

/** Наклон шеи в стойке: вперёд и вверх. Нюх и бросок правят его от этого числа. */
export const CANINE_NECK = 1.0;

/** Своя фаза зверя: позы сдвигают по ней время, а `Figure.phase` машет хвостом (`figures.poseJoints`). */
const PHASE = new WeakMap<Figure, number>();

/**
 * Одеть псового: бочка с тёмной спиной, шея, голова с мордой и ушами, четыре ноги в два звена, хвост.
 * Голова, морда и уши висят на суставе шеи; их места заданы смещением от сустава в осях мира (вверх,
 * вперёд) и переведены в оси шеи — в стойке голова смотрит вперёд, морда чуть вниз, уши вверх, а на
 * нюхе голова опускается вместе с шеей.
 */
export function dressCanine(f: Figure, look: CanineLook): void {
  const s = look.size;
  f.strip();
  // Человеческие суставы у зверя считаются, но на них ничего не висит.
  f.rig = humanRig();
  const m = canineRig(s);
  f.rig.mount = m;
  PHASE.set(f, f.phase);
  const a = CANINE_NECK;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  /** Смещение от сустава шеи в осях мира (вверх, вперёд) — в оси шеи. */
  const at = (up: number, fwd: number, side = 0): [number, number, number] => [side, up * ca + fwd * sa, -up * sa + fwd * ca];
  const tipUp = m.neckLen * ca;
  const tipFwd = m.neckLen * sa;
  const headUp = tipUp + s * 0.04;
  const headFwd = tipFwd + s * 0.02;
  addSlot(f, 'head', 'root', look.coat, [0, m.backY - m.barrelH / 2, 0], [m.bodyW, m.barrelH, m.bodyLen]);
  // Тёмная спина — седло поверх бочки, чуть выше её верха.
  addSlot(f, 'head', 'root', look.dark, [0, m.backY - m.barrelH * 0.3, -m.bodyLen * 0.06], [m.bodyW * 0.92, m.barrelH * 0.62, m.bodyLen * 0.78]);
  addSlot(f, 'body', 'neck', look.coat, [0, 0, 0], [m.bodyW * 0.62, m.neckLen * 1.1, m.bodyW * 0.66]);
  addSlot(f, 'head', 'neck', look.coat, at(headUp, headFwd), [s * 0.21, s * 0.2, s * 0.24], [-a, 0, 0]);
  // Морда: короб вдоль взгляда — вперёд и чуть вниз; нос — тёмный торец.
  addSlot(f, 'plate', 'neck', look.coat, at(headUp - s * 0.04, headFwd + s * 0.15), [s * 0.1, s * 0.09, s * 0.17], [0.15 - a, 0, 0]);
  addSlot(f, 'plate', 'neck', look.dark, at(headUp - s * 0.05, headFwd + s * 0.24), [s * 0.05, s * 0.045, s * 0.03], [0.15 - a, 0, 0]);
  for (const side of [-1, 1]) {
    addSlot(f, 'cap', 'neck', look.dark, at(headUp + s * 0.08, headFwd - s * 0.03, side * s * 0.065), [s * 0.07, s * 0.12, s * 0.05], [-0.15 - a, 0, -side * 0.22]);
  }
  for (const [upper, lower] of [
    ['legFL', 'hockFL'],
    ['legFR', 'hockFR'],
    ['legBL', 'hockBL'],
    ['legBR', 'hockBR'],
  ] as const) {
    addSlot(f, 'limb', upper, look.coat, [0, 0, 0], [s * 0.085, m.legLen * 0.47, s * 0.1]);
    addSlot(f, 'limb', lower, look.dark, [0, 0, 0], [s * 0.055, m.legLen * 0.56, s * 0.065]);
  }
  const tail = look.bushy ? [s * 0.12, s * 0.46, s * 0.12] : [s * 0.06, s * 0.38, s * 0.06];
  addSlot(f, 'limb', 'tail', look.dark, [0, 0, 0], tail as [number, number, number], [0.9, 0, 0]);
}

/** Что делает псовый. */
export type CanineAction = 'stand' | 'walk' | 'trot' | 'lie' | 'sniff' | 'lunge' | 'fall';

/**
 * Поза псового — чистая функция времени, как позы людей (`poses.ts`): ноги — ходом (`gait`), хвост —
 * фазой, голова — наклоном шеи, лёжка и падение — посадкой корпуса. Высоту над землёй (`position.y`)
 * задаёт тот, кто ставит зверя: поза возвращает, на сколько корпус опущен.
 */
export function poseCanine(f: Figure, action: CanineAction, t: number, down = 0): number {
  const m = f.rig.mount;
  if (!m) return 0;
  const w = PHASE.get(f) ?? f.phase;
  f.pitch = 0;
  f.roll = 0;
  m.neckPitch = CANINE_NECK;
  switch (action) {
    case 'stand':
      f.gait = 0;
      // Хвост ходит неспешно — зверь спокоен.
      f.phase = w + t * 2.5;
      m.neckPitch = CANINE_NECK + 0.08 * Math.sin(t * 0.7 + w);
      return 0;
    case 'walk':
      f.gait = Math.sin(t * 8 + w) * 0.42;
      f.phase = w + t * 6;
      m.neckPitch = CANINE_NECK + 0.05 * Math.sin(t * 16 + w);
      return 0;
    case 'trot':
      f.gait = Math.sin(t * 13 + w) * 0.7;
      f.phase = w + t * 3;
      f.pitch = 0.05 * Math.sin(t * 26 + w);
      m.neckPitch = CANINE_NECK + 0.25;
      return 0;
    case 'sniff':
      f.gait = 0;
      f.phase = w + t * 9;
      m.neckPitch = CANINE_NECK + 0.85 + 0.08 * Math.sin(t * 9 + w);
      return 0;
    case 'lie':
      // Лапы вперёд и назад, корпус на земле.
      f.gait = 1.25;
      f.phase = w + t * 0.8;
      m.neckPitch = CANINE_NECK + 0.35 + 0.05 * Math.sin(t * 0.5 + w);
      return m.legLen * 0.66;
    case 'lunge': {
      // Бросок: передом вверх, задние толкают, шея тянется вперёд.
      const k = Math.max(0, Math.sin(t * 6 + w));
      f.gait = 0.6 * k;
      f.pitch = -0.32 * k;
      m.neckPitch = CANINE_NECK + 0.45 * k;
      return 0;
    }
    case 'fall':
      // Падает набок: доля `down` — у того, кто роняет (как `Figure.down` у людей).
      f.gait = 0.4 * down;
      f.roll = (Math.PI / 2) * down;
      return m.legLen * 0.55 * down;
  }
}
