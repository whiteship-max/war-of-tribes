// Стоящая карта рисует только по изменению (docs/perf.md, решение 9). Прежде полотно перерисовывалось целиком каждый
// кадр — и когда на нём не менялось ничего: на ×6 стоящая карта занимала треть главного потока слабого телефона. Теперь
// кадр говорит, что в нём движется само (`FrameMotion`), а карта засыпает до срока следующего изменения
// (`FrameLoop.rest`) — или до толчка: камера, касание, данные мира, ночь и погода партии, шрифт, размер окна.
//
// Здесь — чистые правила, их держит тест (`still.test.ts`): сколько спать после кадра, что считать переменой стора и
// какой сдвиг камеры — ведением. Проводка — у полотна (`WorldMap.tsx`).
import type { Camera } from './grid';

/** Что в кадре движется само — по нему карта решает, когда рисовать следующий. */
export interface FrameMotion {
  /** Выпечка не готова: земля, берег прибоя, растр владений ещё приедут — рисовать каждый кадр, пока не приедут. */
  busy: boolean;
  /** Смысловое движение: отряды и агенты в пути, мигающие метки, пульс лупы. */
  live: boolean;
  /** Убранство: прибой, облака и их тени, дым, огни лагеря, шаг колонны. На «Низком» оно стоит само. */
  decor: boolean;
  /** Сроки и знаки по часам (пилюли сроков, рогатки осады, знак участи): меняются раз в секунду, не чаще. */
  clock: boolean;
}

/** Кадр без движения — так рисует запасной лист, пока кусок вида не приехал, не бывает: он `busy`. */
export const STILL_FRAME: FrameMotion = { busy: false, live: false, decor: false, clock: false };

/**
 * Сколько карту считают ведомой после последнего сдвига камеры, мс: шестьдесят кадров, пока палец водит, и полсекунды
 * после — щипок и перетаскивание дёргаются паузами пальца, а выпечка стоя (`prebake.STILL_MS`) начинается внутри окна.
 */
export const MOVE_MS = 500;
/** Шаг сроков и знаков по часам, мс: пилюля срока пишет секунды. */
export const CLOCK_MS = 1000;
/**
 * Сколько стоящая карта без движения спит без толчка, мс. Толчки покрывают всё, что меняет картинку (данные, касание,
 * ночь, погода, выпечка); этот срок — страховка на изменение по часам, которое никто не назвал: оно встанет не позже.
 */
export const IDLE_MS = 5000;
/**
 * Будильник звонит между кадрами экрана, а кадр рисуется на ближайшем кадре после него — до шестнадцати мс позже.
 * Сон короче шага на половину кадра экрана: шаг 15 в секунду и выходит пятнадцатью, а не двенадцатью.
 */
const VSYNC_SLACK_MS = 8;

/**
 * Сколько спать после кадра, мс; 0 — рисовать следующий кадр сразу (по потолку двери кадра).
 *
 * @param m         что движется в нарисованном кадре;
 * @param sinceMove сколько мс назад камеру сдвинули игрок или игра (не поводок — см. `cameraBox`);
 * @param stepFps   шаг живого по уровню (`QUALITY.mapStepFps`).
 */
export function restAfter(m: FrameMotion, sinceMove: number, stepFps: number): number {
  if (m.busy || sinceMove < MOVE_MS) return 0;
  if (m.live || m.decor) return Math.max(0, 1000 / stepFps - VSYNC_SLACK_MS);
  if (m.clock) return CLOCK_MS;
  return IDLE_MS;
}

/**
 * Камера карты. Присвоение `current` — сдвиг камеры игроком или игрой (жест, колесо, кнопка, лупа письма, стенд):
 * он отмечает `movedAt` и будит полотно (`onMove`). Поводок кадра — фигура идёт, камера за ней — двигает камеру мимо
 * этого (`follow`): идущая фигура и так шагает живым шагом, и шестьдесят кадров ради поводка не нужны.
 * Присвоение той же камеры сдвигом не считается.
 */
export interface CameraBox {
  current: Camera;
  follow(c: Camera): void;
  /** Когда камеру сдвинули последний раз, мс часов `now`. */
  readonly movedAt: number;
  onMove: () => void;
}

const sameCamera = (a: Camera, b: Camera): boolean => a.cx === b.cx && a.cy === b.cy && a.scale === b.scale;

export function cameraBox(init: Camera, now: () => number): CameraBox {
  let value = init;
  let movedAt = -Infinity;
  const box: CameraBox = {
    get current(): Camera {
      return value;
    },
    set current(c: Camera) {
      const moved = !sameCamera(c, value);
      value = c;
      if (!moved) return;
      movedAt = now();
      box.onMove();
    },
    follow(c: Camera): void {
      value = c;
    },
    get movedAt(): number {
      return movedAt;
    },
    onMove: () => undefined,
  };
  return box;
}

/** Строка значения для сравнения по содержанию; не пишется (круг, `BigInt`) — значит, «другое». */
function text(v: unknown): string | null {
  try {
    return JSON.stringify(v) ?? null;
  } catch {
    return null;
  }
}

/**
 * Изменилось ли в сторе что-нибудь, кроме `skip`, — по содержанию, а не по ссылке. Пульс мира (`world/store`, раз в
 * две секунды) кладёт свежие массивы походов и фигур, даже когда в них ничего не изменилось, и сравнение ссылок будило
 * бы стоящую карту каждые две секунды. Значения сравниваются строкой только у полей с новой ссылкой; функции —
 * ссылкой. Карта будится переменой любого поля, а не списка «что рисует кадр»: список разошёлся бы с кадром молча.
 */
export function changedBesides(prev: object, next: object, skip: readonly string[]): boolean {
  const a = prev as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (skip.includes(k)) continue;
    const x = a[k];
    const y = b[k];
    if (x === y) continue;
    if (typeof x !== 'object' || typeof y !== 'object' || x === null || y === null) return true;
    const tx = text(x);
    if (tx === null || tx !== text(y)) return true;
  }
  return false;
}
