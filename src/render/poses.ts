// Движение фигур. Скелета и скиннинга нет: анимация — это углы в суставах (`JOINTS`),
// которые пул раз в кадр превращает в матрицы (figures.ts). Поэтому позу можно
// считать хоть на сотне фигур, и ни одного лишнего вызова отрисовки она не стоит.
//
// Каждая поза — чистая функция времени: ничего не копится между кадрами, любая
// фигура в любой момент может начать делать другое. Своё смещение по времени
// (`Figure.phase`) прибавляется здесь и только здесь — без него толпа машет
// ногами в такт, и это первое, что бросается в глаза.
import type { Figure } from './figures';

export type Action = 'stand' | 'walk' | 'guard' | 'strike' | 'hit' | 'fall';

export const ACTIONS: Action[] = ['stand', 'walk', 'guard', 'strike', 'hit', 'fall'];

/** Длительности циклов в секундах: шаг, удар, приём удара. */
export const BEAT = { walk: 0.74, strike: 1.7, hit: 0.6 } as const;

const TAU = Math.PI * 2;

/** Пила 0..1 по циклу заданной длины. */
const cycle = (t: number, period: number): number => {
  const p = (t / period) % 1;
  return p < 0 ? p + 1 : p;
};

/** Сглаживание 0→1: без него замах включается рывком. */
const ease = (x: number): number => {
  const k = x < 0 ? 0 : x > 1 ? 1 : x;
  return k * k * (3 - 2 * k);
};

/** Сбрасывает позу в ноль: каждая поза задаёт всё, а не добавляет к прошлой. */
function rest(f: Figure): void {
  f.pitch = 0;
  f.roll = 0;
  f.bob = 0;
  f.torsoTilt = 0;
  f.torsoTwist = 0;
  f.headNod = 0;
  f.headTurn = 0;
  f.legSwing = 0;
  f.gait = 0;
  f.hoofMode = 0;
  f.hoofPhase = 0;
  f.armMain = 0;
  f.armOff = 0;
  f.armSpread = 0.06;
  f.elbowMain = 0.08;
  f.elbowOff = 0.08;
  f.wristMain = 0;
  f.kneeL = 0;
  f.kneeR = 0;
}

/**
 * Ставит фигуре позу действия на момент `t` (секунды сцены). Падение берёт свою
 * долю из `f.down`: у него нет своего темпа — его задаёт тот, кто роняет.
 */
export function poseFigure(f: Figure, action: Action, t: number): void {
  const u = t + f.phase;
  rest(f);
  switch (action) {
    case 'stand': {
      // Стоит, а не вкопан: дыхание и переступ. Всё мелкое, но глаз это ловит.
      const breath = Math.sin(u * 1.7);
      f.bob = breath * 0.005;
      f.torsoTilt = 0.03 + breath * 0.014;
      f.headNod = breath * 0.03;
      f.armMain = 0.06 + breath * 0.03;
      f.armOff = 0.06 - breath * 0.03;
      f.gait = Math.sin(u * 0.8) * 0.04;
      break;
    }
    case 'walk': {
      const w = cycle(u, BEAT.walk) * TAU;
      const s = Math.sin(w);
      f.legSwing = s * 0.55;
      // Руки в противофазе ногам, но неглубоко: в занятой руке оружие.
      f.armMain = -s * 0.2;
      f.armOff = s * 0.32;
      f.bob = Math.abs(Math.sin(w * 2)) * 0.022 - 0.011;
      f.torsoTilt = 0.09;
      f.torsoTwist = -s * 0.1;
      f.headNod = -0.03;
      // Конь идёт рысью: диагонали в противофазе — это делают суставы ног.
      f.gait = s * 0.5;
      f.kneeL = Math.max(0, s) * 0.65;
      f.kneeR = Math.max(0, -s) * 0.65;
      f.elbowMain = 0.2 + Math.max(0, -s) * 0.2;
      f.elbowOff = 0.2 + Math.max(0, s) * 0.2;
      break;
    }
    case 'guard': {
      // Изготовка: щит вперёд, оружие отведено. Отсюда и начинается замах.
      const breath = Math.sin(u * 2.1);
      f.torsoTilt = 0.14;
      f.torsoTwist = 0.16;
      f.armOff = -0.6 + breath * 0.04;
      f.armMain = -0.42 + breath * 0.05;
      f.armSpread = 0.2;
      f.legSwing = 0.12;
      f.elbowMain = 0.55;
      f.elbowOff = 0.65;
      f.kneeL = 0.12;
      f.kneeR = 0.12;
      break;
    }
    case 'strike': {
      // Замах — удар — возврат. Удар в разы короче замаха: иначе он не удар.
      const p = cycle(u, BEAT.strike);
      const back = 2.05;
      const through = 0.95;
      let arm: number;
      let twist: number;
      let tilt: number;
      if (p < 0.42) {
        const e = ease(p / 0.42);
        arm = -back * e;
        twist = -0.4 * e;
        tilt = -0.07 * e;
      } else if (p < 0.55) {
        const e = ease((p - 0.42) / 0.13);
        arm = -back + (back + through) * e;
        twist = -0.4 + 0.72 * e;
        tilt = -0.07 + 0.3 * e;
      } else {
        const e = ease((p - 0.55) / 0.45);
        arm = through * (1 - e);
        twist = 0.32 * (1 - e);
        tilt = 0.23 * (1 - e);
      }
      f.armMain = arm;
      f.torsoTwist = twist;
      f.torsoTilt = tilt;
      f.armOff = -0.35 - twist * 0.4;
      f.armSpread = 0.16;
      // Шаг под удар: вес переносится вперёд и обратно.
      f.legSwing = Math.sin(p * TAU) * 0.22;
      f.bob = -Math.max(0, tilt) * 0.1;
      f.gait = Math.sin(u * 0.9) * 0.05;
      f.elbowMain = 0.08 + Math.max(0, -arm) * 0.35;
      f.elbowOff = 0.45;
      f.kneeL = Math.max(0, f.legSwing) * 0.6;
      f.kneeR = Math.max(0, -f.legSwing) * 0.6;
      break;
    }
    case 'hit': {
      // Приём удара: короткая отдача назад, гаснет к концу цикла.
      const e = (1 - cycle(u, BEAT.hit)) ** 2;
      f.pitch = -0.22 * e;
      f.torsoTilt = -0.4 * e;
      f.headNod = -0.5 * e;
      f.armMain = -0.55 * e;
      f.armOff = -0.7 * e;
      f.armSpread = 0.06 + 0.4 * e;
      f.bob = -0.05 * e;
      f.legSwing = -0.2 * e;
      break;
    }
    case 'fall': {
      // Падение: доля берётся снаружи, чтобы упавший так и остался лежать.
      const e = ease(f.down);
      f.pitch = e * 1.45;
      f.roll = e * 0.32;
      f.bob = -f.rig.hipY * e * 0.82;
      f.legSwing = e * 0.85;
      f.armMain = -e * 1.15;
      f.armOff = e * 0.95;
      f.armSpread = 0.06 + e * 0.55;
      f.headNod = e * 0.45;
      f.gait = -e * 0.4;
      break;
    }
  }
  if (f.rig.mount) {
    f.kneeL = 0.7;
    f.kneeR = 0.7;
  }
}
