/**
 * Потерянный контекст WebGL у холстов без своей пересборки: предыстория, промыслы, ролики о бое.
 *
 * Диорама города лечит потерю сама (`Scene.ts`, docs/scene-revive.md, раздел 5). У остальных
 * рендереров лечения не было вовсе. three отменяет умолчание потери и сам поднимает своё, когда
 * контекст вернётся (`WebGLRenderer`, `onContextLost` / `onContextRestore`), — но вернётся ли он,
 * three не решает. Настоящую потерю браузер может не вернуть никогда, и тогда холст чёрный до
 * перезапуска — та же картина, на которую жалоба.
 *
 * Здесь — недостающее: попросить контекст обратно и сказать владельцу, если он не вернулся в
 * срок (`RESTORE_WAIT`). Что делать тогда, решает владелец холста: предыстория собирается заново
 * на новой канве, промысел — тоже, а начатый заканчивается итогом по набранному, ролик о бое —
 * отчётом.
 *
 * Пока кадров нет (страница скрыта, аппка свёрнута), срок не идёт: возвращать контекст туда, где
 * его не рисуют, незачем, — он пойдёт заново с возвращением.
 */
import { awayNow, watchAway } from './loop';

/**
 * Сколько ждём возвращения контекста WebGL, прежде чем пересобирать сцену.
 *
 * Браузер возвращает контекст сам — но только если ему не помешали (умолчание потери
 * отменено), и не мгновенно: на Android между потерей и возвращением проходит от десятков
 * миллисекунд до секунды с лишним, пока система отдаёт обратно графическую память. Три
 * секунды заведомо больше этого и заведомо меньше того, что игрок готов смотреть на чёрный
 * прямоугольник.
 *
 * Ждать бесконечно нельзя: вебвью, у которого забрали поверхность совсем, события
 * возвращения не пришлёт никогда, и без срока холст не вернулся бы до перезахода — то есть
 * ровно то, на что жалоба. Срок один на все холсты игры — у диорамы тот же (`Scene.ts`).
 */
export const RESTORE_WAIT = 3000;

/** Что сторож спрашивает у рендерера three — ровно столько, сколько ему нужно. */
export interface Revivable {
  domElement: HTMLCanvasElement;
  forceContextRestore(): void;
  getContext(): WebGLRenderingContext | WebGL2RenderingContext;
}

export interface WatchOptions {
  /**
   * Просить ли контекст обратно. Нет — у одолженной канвы: её контекст просит вернуть хозяин
   * (диорама), и вторая просьба была бы лишней.
   */
  ask?: boolean;
  /** Срок, мс; без него — `RESTORE_WAIT`. */
  wait?: number;
}

/**
 * Сторожить контекст рендерера. `onDead` зовётся один раз — когда контекст потерян и не
 * вернулся в срок. Возвращает уборку.
 */
export function watchContext(renderer: Revivable, onDead: () => void, opts: WatchOptions = {}): () => void {
  const canvas = renderer.domElement;
  const wait = opts.wait ?? RESTORE_WAIT;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let over = false;
  /** Живой ответ драйвера, а не память о событии: контекст мог вернуться сам. */
  const lost = (): boolean => {
    try {
      return renderer.getContext().isContextLost();
    } catch {
      return true;
    }
  };
  const clear = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const expire = (): void => {
    timer = null;
    if (over || !lost()) return;
    over = true;
    onDead();
  };
  const arm = (): void => {
    clear();
    if (!awayNow()) timer = setTimeout(expire, wait);
  };
  const onLost = (e: Event): void => {
    // Без этого браузер даже не пытается вернуть контекст (docs/scene-revive.md, раздел 5).
    e.preventDefault();
    if (opts.ask !== false) {
      // Следующим тактом: в разгар рассылки потери браузер просьбу не принимает.
      setTimeout(() => {
        if (over || !lost()) return;
        try {
          renderer.forceContextRestore();
        } catch {
          // Настоящую потерю так не отменить — остаётся ждать браузера и срока.
        }
      }, 0);
    }
    arm();
  };
  const onRestored = (): void => clear();
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  // Вернулись: если контекст всё ещё мёртв, срок пошёл заново; ушли — срок стоит.
  const offAway = watchAway((away) => {
    if (away) clear();
    else if (!over && lost()) arm();
  });
  return () => {
    over = true;
    clear();
    offAway();
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
  };
}
