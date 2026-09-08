/**
 * Луп кадров: одна цепочка `requestAnimationFrame` и список причин, по которым
 * её сейчас нет.
 *
 * Вынесено из сцены отдельным модулем по двум причинам, и обе — не про красоту.
 *
 * 1. **Причин остановки стало четыре, а флаг был один.** Карта мира, ролик о
 *    бое, скрытая страница, потерянный контекст — и каждая из них умеет
 *    случиться поверх другой. С одним `paused` возврат из фона снимал бы
 *    остановку, поставленную картой, и диорама начинала бы рисоваться под
 *    полотном карты. С набором причин снятие одной ничего не решает: луп идёт
 *    тогда и только тогда, когда не осталось ни одной.
 *
 * 2. **Это надо проверять тестом, а сцену в тест не поднять.** Тесты идут в
 *    node, где нет ни WebGL, ни `requestAnimationFrame`. Здесь часы внешние —
 *    их передают в конструктор, — поэтому «в скрытой вкладке кадров нет, а при
 *    возврате они снова идут» проверяется на настоящем коде, а не на его
 *    описании.
 *
 * Правило, ради которого всё это заведено: **ничего не ждать кадра, пока
 * страница скрыта.** В свёрнутом вебвью `requestAnimationFrame` не вызывается
 * вовсе — не редко, а никогда (это же записано в `boot/paint.ts`). Заявка,
 * поданная перед сворачиванием, может и не дожить до возвращения: тогда
 * цепочка обрывается молча, и на экране остаётся последний кадр или чернота.
 * Поэтому при возврате видимости цепочка заводится заново, а не «продолжается».
 */

type Raf = (cb: () => void) => number;
type Caf = (id: number) => void;

export interface LoopClock {
  raf: Raf;
  caf: Caf;
}

const browserClock = (): LoopClock => ({
  raf: (cb) => requestAnimationFrame(cb),
  caf: (id) => cancelAnimationFrame(id),
});

/**
 * Цепочка кадров с набором причин остановки.
 *
 * `B` — имена причин (у сцены это `Block` из `scenelog`). Модуль про них ничего
 * не знает: ему довольно того, что список пуст или не пуст.
 */
export class FrameLoop<B extends string> {
  private id = 0;
  private blocks = new Set<B>();
  /** Заявка подана и ещё не сработала. Ноль — цепочки нет. */
  private pending = false;

  /**
   * @param tick    один кадр;
   * @param onStart зовётся перед первым кадром новой цепочки — сцене здесь надо
   *                съесть накопленную дельту часов, иначе кадр после возвращения
   *                прыгнет на всё время сна;
   * @param clock   часы; в тестах подменяются, в игре — браузерные.
   */
  constructor(
    private tick: () => void,
    private onStart: () => void = () => undefined,
    private clock: LoopClock = browserClock(),
  ) {}

  /** Причины, по которым луп сейчас стоит. Пусто — значит идёт. */
  stopped(): B[] {
    return [...this.blocks];
  }

  get running(): boolean {
    return this.pending;
  }

  /**
   * Поставить или снять причину. Идемпотентно нарочно: «развернули аппку»
   * приходит и от `visibilitychange`, и от `pageshow`, и от Телеграма — все три
   * зовут одно и то же, и второй раз снимать нечего.
   */
  block(kind: B, on: boolean): void {
    const had = this.blocks.has(kind);
    if (on === had) return;
    if (on) this.blocks.add(kind);
    else this.blocks.delete(kind);
    if (this.blocks.size > 0) this.halt();
    else this.start();
  }

  /**
   * Завести цепочку заново, даже если она считается живой.
   *
   * Это и есть лечение третьей болезни: заявка, поданная до сворачивания, могла
   * не пережить фон, а `pending` про это не знает — он помнит, что заявку
   * подавали. Поэтому при возврате видимости цепочка не «продолжается», а
   * заводится с нуля: старая заявка снимается, новая подаётся.
   */
  restart(): void {
    if (this.blocks.size > 0) return;
    this.halt();
    this.start();
  }

  /** Совсем и навсегда: сцена выгружена. */
  stop(): void {
    this.blocks.clear();
    this.halt();
  }

  private halt(): void {
    if (this.id) this.clock.caf(this.id);
    this.id = 0;
    this.pending = false;
  }

  private start(): void {
    if (this.pending) return;
    this.onStart();
    this.schedule();
  }

  private schedule(): void {
    this.pending = true;
    this.id = this.clock.raf(this.step);
  }

  private step = (): void => {
    this.id = 0;
    this.pending = false;
    // Причину могли поставить между заявкой и кадром — тогда кадра не будет.
    if (this.blocks.size > 0) return;
    this.schedule();
    this.tick();
  };
}
