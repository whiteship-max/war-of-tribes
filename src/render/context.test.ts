// Сторож потерянного контекста: вернулся в срок — молчит, не вернулся — говорит владельцу один раз,
// а пока аппку не видно, срок стоит.
//
// Проверяется настоящий код на поддельном рендерере: холст — EventTarget node, контекст — флажок,
// часы — поддельные vitest. WebGL в node нет, и это единственный способ проверить правила здесь.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESTORE_WAIT, watchContext, type Revivable } from './context';
import { setAppAsleep } from './loop';

class FakeRenderer implements Revivable {
  domElement = new EventTarget() as unknown as HTMLCanvasElement;
  dead = false;
  asked = 0;
  forceContextRestore = (): void => {
    this.asked++;
  };
  getContext = (): WebGLRenderingContext => ({ isContextLost: () => this.dead }) as unknown as WebGLRenderingContext;

  /** Потерять контекст так, как теряет его браузер: событием, которое можно отменить. */
  lose(): Event {
    this.dead = true;
    const e = new Event('webglcontextlost', { cancelable: true });
    this.domElement.dispatchEvent(e);
    return e;
  }

  restore(): void {
    this.dead = false;
    this.domElement.dispatchEvent(new Event('webglcontextrestored'));
  }
}

describe('сторож контекста', () => {
  let gl: FakeRenderer;
  let dead: number;
  let stop: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    gl = new FakeRenderer();
    dead = 0;
    stop = watchContext(gl, () => dead++);
  });

  afterEach(() => {
    stop();
    setAppAsleep(false);
    vi.useRealTimers();
  });

  it('умолчание потери отменено — иначе браузер контекст не вернёт', () => {
    expect(gl.lose().defaultPrevented).toBe(true);
  });

  it('контекст просят обратно следующим тактом, а не в разгар рассылки потери', () => {
    gl.lose();
    expect(gl.asked).toBe(0);
    vi.advanceTimersByTime(0);
    expect(gl.asked).toBe(1);
  });

  it('вернулся в срок — владелец ничего не слышит', () => {
    gl.lose();
    vi.advanceTimersByTime(RESTORE_WAIT - 1);
    gl.restore();
    vi.advanceTimersByTime(RESTORE_WAIT * 3);
    expect(dead).toBe(0);
  });

  it('не вернулся — владелец слышит ровно один раз и ровно в срок', () => {
    gl.lose();
    vi.advanceTimersByTime(RESTORE_WAIT - 1);
    expect(dead).toBe(0);
    vi.advanceTimersByTime(1);
    expect(dead).toBe(1);
    gl.lose();
    vi.advanceTimersByTime(RESTORE_WAIT * 3);
    expect(dead).toBe(1);
  });

  it('пока аппку не видно, срок стоит; вернулись — идёт заново', () => {
    gl.lose();
    vi.advanceTimersByTime(RESTORE_WAIT / 2);
    setAppAsleep(true);
    vi.advanceTimersByTime(RESTORE_WAIT * 3);
    expect(dead).toBe(0);
    setAppAsleep(false);
    vi.advanceTimersByTime(RESTORE_WAIT - 1);
    expect(dead).toBe(0);
    vi.advanceTimersByTime(1);
    expect(dead).toBe(1);
  });

  it('одолженный холст сторож обратно не просит: это дело хозяина', () => {
    const lent = new FakeRenderer();
    const off = watchContext(lent, () => undefined, { ask: false });
    lent.lose();
    vi.advanceTimersByTime(RESTORE_WAIT);
    expect(lent.asked).toBe(0);
    off();
  });

  it('после уборки холст никому ничего не говорит', () => {
    stop();
    gl.lose();
    vi.advanceTimersByTime(RESTORE_WAIT * 3);
    expect(dead).toBe(0);
  });
});
