// Луп кадров: в скрытой странице кадров нет, при возврате они снова идут.
//
// Проверяется настоящий код, а не его описание: часы у лупа внешние, и здесь
// им подставлены поддельные. Заодно это единственный способ вообще проверить
// это в node, где requestAnimationFrame не существует.
import { beforeEach, describe, expect, it } from 'vitest';
import { FrameLoop } from './loop';

/** Поддельные часы: кадр случается только тогда, когда его позовут. */
class FakeClock {
  private next = 1;
  private queue = new Map<number, () => void>();
  /** Сколько заявок сняли — по нему видно, что цепочка не раздвоилась. */
  cancelled = 0;

  raf = (cb: () => void): number => {
    const id = this.next++;
    this.queue.set(id, cb);
    return id;
  };

  caf = (id: number): void => {
    if (this.queue.delete(id)) this.cancelled++;
  };

  /** Сколько заявок ждёт кадра. Больше одной — цепочка раздвоилась. */
  get waiting(): number {
    return this.queue.size;
  }

  /** Прогнать n кадров. */
  run(n = 1): void {
    for (let i = 0; i < n; i++) {
      const [id, cb] = [...this.queue.entries()][0] ?? [];
      if (id === undefined || !cb) return;
      this.queue.delete(id);
      cb();
    }
  }

  /**
   * Страница ушла в фон: браузер кадров не даёт. Заявка при этом остаётся
   * висеть — ровно так же, как в настоящем свёрнутом вебвью.
   */
  freeze(): void {
    /* ничего не делаем: run() просто никто не зовёт */
  }

  /** Заявка не пережила фон — вебвью её выбросил. Так и теряется цепочка. */
  drop(): void {
    this.queue.clear();
  }
}

type Block = 'map' | 'hidden' | 'lost';

describe('луп кадров', () => {
  let clock: FakeClock;
  let ticks: number;
  let starts: number;
  let loop: FrameLoop<Block>;

  beforeEach(() => {
    clock = new FakeClock();
    ticks = 0;
    starts = 0;
    loop = new FrameLoop<Block>(
      () => void ticks++,
      () => void starts++,
      { raf: clock.raf, caf: clock.caf },
    );
  });

  it('сам по себе стоит: цепочку заводит первое снятие причин', () => {
    expect(loop.running).toBe(false);
    loop.block('hidden', false); // причины и не было — заводить нечего
    expect(loop.running).toBe(false);
    loop.block('hidden', true);
    loop.block('hidden', false);
    expect(loop.running).toBe(true);
    clock.run(5);
    expect(ticks).toBe(5);
  });

  it('в скрытой странице кадров не бывает', () => {
    loop.restart();
    clock.run(3);
    expect(ticks).toBe(3);

    loop.block('hidden', true);
    expect(loop.running).toBe(false);
    expect(clock.waiting).toBe(0);
    clock.freeze();
    clock.run(10);
    expect(ticks).toBe(3);
  });

  it('при возврате видимости кадры возобновляются', () => {
    loop.restart();
    clock.run(2);
    loop.block('hidden', true);
    clock.run(10);
    expect(ticks).toBe(2);

    loop.block('hidden', false);
    clock.run(4);
    expect(ticks).toBe(6);
  });

  it('заявка, не пережившая фон, не оставляет луп мёртвым', () => {
    // Ровно та болезнь, из-за которой заведён restart: цепочка «жива» по
    // счётчику, а кадра ей никто уже не даст.
    loop.restart();
    clock.drop();
    clock.run(5);
    expect(ticks).toBe(0);

    loop.restart();
    clock.run(3);
    expect(ticks).toBe(3);
  });

  it('снятие одной причины не отменяет другую', () => {
    loop.block('map', true);
    loop.block('hidden', true);
    loop.block('hidden', false);
    expect(loop.running).toBe(false);
    expect(loop.stopped()).toEqual(['map']);
    loop.block('map', false);
    expect(loop.running).toBe(true);
  });

  it('цепочка одна, сколько бы раз её ни будили', () => {
    loop.restart();
    loop.restart();
    loop.block('hidden', false);
    loop.restart();
    expect(clock.waiting).toBe(1);
    clock.run(3);
    expect(clock.waiting).toBe(1);
    expect(ticks).toBe(3);
  });

  it('перед новой цепочкой сцену предупреждают: часы стояли', () => {
    loop.restart();
    clock.run(2);
    expect(starts).toBe(1);
    loop.block('hidden', true);
    loop.block('hidden', false);
    expect(starts).toBe(2);
    // Внутри цепочки о старте не сообщают: часы идут своим ходом.
    clock.run(5);
    expect(starts).toBe(2);
  });

  it('причина, поставленная между заявкой и кадром, кадр отменяет', () => {
    loop.restart();
    loop.block('lost', true);
    clock.run(3);
    expect(ticks).toBe(0);
  });

  it('выгруженная сцена не оживает от снятия причин', () => {
    loop.restart();
    loop.stop();
    clock.run(3);
    expect(ticks).toBe(0);
    expect(loop.running).toBe(false);
  });
});
