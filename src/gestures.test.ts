// Разбор жеста: тап, ведение, щипок. Числа и правила общие у деревни и карты,
// поэтому и проверяются один раз здесь.
//
// Проверяются **последовательности событий**, а не «функция вызвалась»: жест —
// это путь пальца во времени, и все три поломки, из-за которых тап по зданию не
// открывал панель, были именно в пути, а не в отдельном пороге.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  GHOST_CLICK_MS,
  Gesture,
  Press,
  TAP_MOVE,
  TAP_MS,
  TAP_SLIP,
  TAP_TARGET,
  WHEEL_STEP,
  swallowGhostClick,
} from './gestures';

/** Одно касание: список шагов `[время, x, y]`, последний — отпускание. */
type Step = [t: number, x: number, y: number];

/** Прогоняет одно касание через разбор и говорит, вышел ли тап. */
function press(steps: Step[], id = 1): boolean {
  const g = new Gesture();
  const [t0, x0, y0] = steps[0];
  g.down(id, x0, y0, t0);
  for (let i = 1; i < steps.length - 1; i++) g.move(id, steps[i][1], steps[i][2], steps[i][0]);
  const last = steps[steps.length - 1];
  if (steps.length > 1) g.move(id, last[1], last[2], last[0]);
  return g.up(id, last[0]);
}

describe('короткое касание — выбор', () => {
  it('палец лёг и снялся на месте', () => {
    expect(press([[0, 200, 400], [90, 200, 400]])).toBe(true);
  });

  it('дрожь внутри порога не мешает', () => {
    expect(press([[0, 200, 400], [60, 203, 402], [120, 204, 401]])).toBe(true);
  });

  it('прицелиться не спеша можно: треть секунды — не предел', () => {
    // Прежние 350 мс были второй причиной, по которой тап терялся: на живой
    // сцене 340 мс давали 21 попадание из 21, а 420 мс — ноль из 21.
    expect(press([[0, 200, 400], [420, 200, 400]])).toBe(true);
    expect(press([[0, 200, 400], [TAP_MS, 200, 400]])).toBe(true);
  });

  it('палец, забытый на экране, тапом не был', () => {
    expect(press([[0, 200, 400], [TAP_MS + 1, 200, 400]])).toBe(false);
  });

  it('скачок на сходе пальца тап не отменяет — ни точкой отпускания, ни ходом', () => {
    // Пятно контакта на сходе схлопывается несимметрично, и центр прыгает на
    // два десятка пикселей. Приезжает этот прыжок и обычным `pointermove` за
    // миг до `pointerup` — прежнее правило ловило его и выбрасывало тап молча.
    for (const jump of [12, 20, 28, TAP_SLIP]) {
      expect(`${jump}: ${press([[0, 200, 400], [180, 200, 400], [195, 200 + jump, 400]])}`).toBe(`${jump}: true`);
    }
  });
});

describe('палец сел и повозился — это всё ещё тап', () => {
  // Та самая жалоба: «тап срабатывает иногда». Замер настоящим касанием
  // (`npm run tap:report`) показал, что палец, ложась на экран, проезжает
  // 14–20 px в первые 60–80 мс, а потом лежит неподвижно, пока игрок целится.
  // Прежняя выдержка в 90 мс к моменту снятия истекала, и такой тап молча
  // выбрасывался. Выдержки больше нет: между `TAP_MOVE` и `TAP_SLIP` тап живёт
  // сколько угодно.
  it('уплыл на 14 px в первые 80 мс и замер до 380-й', () => {
    expect(press([[0, 200, 400], [40, 207, 405], [80, 211, 409], [380, 211, 409]])).toBe(true);
  });

  it('уплыл на 20 px в первые 60 мс и замер до 250-й', () => {
    expect(press([[0, 200, 400], [30, 209, 406], [60, 215, 413], [250, 215, 413]])).toBe(true);
  });

  it('часов между порогами нет: сколько бы ни лежал, до предела тапа — тап', () => {
    const g = new Gesture();
    g.down(1, 200, 400, 0);
    g.move(1, 200 + TAP_MOVE + 1, 400, 10);
    expect(g.up(1, TAP_MS)).toBe(true);
  });
});

describe('касание с ведением — камера, без выбора', () => {
  it('палец уехал далеко', () => {
    expect(press([[0, 200, 400], [16, 220, 400], [32, 250, 400], [48, 280, 400]])).toBe(false);
  });

  it('уехал за предел — назад дороги нет, даже если вернулся и постоял', () => {
    const g = new Gesture();
    g.down(1, 200, 400, 0);
    g.move(1, 200 + TAP_SLIP + 1, 400, 16);
    g.move(1, 200, 400, 32);
    expect(g.up(1, 48)).toBe(false);
  });

  it('порог меряется по диагонали, а не по осям', () => {
    expect(press([[0, 0, 0], [16, TAP_SLIP * 0.8, TAP_SLIP * 0.8], [32, TAP_SLIP * 0.8, TAP_SLIP * 0.8]])).toBe(false);
  });
});

describe('камера трогается по команде разбора, а не сама', () => {
  // Второго судьи у камеры быть не должно. В деревне им был `OrbitControls`:
  // он брал `pointerdown` себе и начинал панораму с первого же пикселя, пока
  // разбор ещё считал жест тапом. Отсюда и «камера не такая, как на карте».
  it('пока палец внутри порога, картинка стоит', () => {
    const g = new Gesture();
    g.down(1, 200, 400, 0);
    expect(g.panning(0)).toBe(false);
    g.move(1, 200 + TAP_MOVE - 1, 400, 20);
    expect(g.panning(20)).toBe(false);
  });

  it('прошёл порог — камера поехала, а тап ещё жив', () => {
    const g = new Gesture();
    g.down(1, 200, 400, 0);
    g.move(1, 200 + TAP_MOVE + 1, 400, 20);
    expect(g.panning(20)).toBe(true);
    expect(g.up(1, 200)).toBe(true);
  });

  it('камера свободна и тогда, когда тапа в жесте уже нет', () => {
    const two = new Gesture();
    two.down(1, 200, 400, 0);
    two.down(2, 300, 400, 10);
    expect(two.panning(20)).toBe(true);
    const slow = new Gesture();
    slow.down(1, 200, 400, 0);
    expect(slow.panning(TAP_MS + 1)).toBe(true);
  });
});

describe('два пальца — щипок, без выбора', () => {
  it('щипок не открывает ничего ни одним из пальцев', () => {
    const g = new Gesture();
    g.down(1, 150, 400, 0);
    g.down(2, 250, 400, 20);
    g.move(1, 130, 400, 40);
    g.move(2, 270, 400, 40);
    expect(g.up(2, 60)).toBe(false);
    expect(g.up(1, 80)).toBe(false);
  });

  it('второй палец, мигнувший посреди ведения, здания не открывает', () => {
    // Так и было в деревне: разбор держал одно нажатие, и второй палец его
    // перебивал — снимался он на месте, и это засчитывалось тапом.
    const g = new Gesture();
    g.down(1, 150, 400, 0);
    g.move(1, 200, 430, 20);
    g.down(2, 300, 600, 30);
    expect(g.up(2, 50)).toBe(false);
    expect(g.up(1, 70)).toBe(false);
  });

  it('снятый второй палец тап не возвращает', () => {
    const g = new Gesture();
    g.down(1, 200, 400, 0);
    g.down(2, 300, 400, 10);
    g.up(2, 20);
    expect(g.fingers).toBe(1);
    expect(g.up(1, 30)).toBe(false);
  });

  it('после щипка следующее касание снова тап', () => {
    const g = new Gesture();
    g.down(1, 200, 400, 0);
    g.down(2, 300, 400, 10);
    g.up(2, 20);
    g.up(1, 30);
    expect(g.fingers).toBe(0);
    g.down(3, 200, 400, 100);
    expect(g.multi).toBe(false);
    expect(g.up(3, 180)).toBe(true);
  });
});

describe('отмена жеста браузером', () => {
  it('отменённое касание тапом не становится', () => {
    const g = new Gesture();
    g.down(1, 200, 400, 0);
    g.cancel(1);
    expect(g.fingers).toBe(0);
    expect(g.up(1, 40)).toBe(false);
  });
});

describe('прицел берётся там, где палец лёг', () => {
  it('точка нажатия помнится, точка отпускания не спрашивается', () => {
    const g = new Gesture();
    g.down(1, 200, 400, 0);
    g.move(1, 218, 400, 180);
    expect(g.origin).toEqual({ x: 200, y: 400 });
    expect(g.up(1, 200)).toBe(true);
    expect(g.origin).toBeNull();
  });
});

describe('числа', () => {
  it('минимальная цель под палец — та же, что --tap в стилях', () => {
    expect(TAP_TARGET).toBe(44);
  });

  it('прощаемый сход короче цели: палец не покинул здание, в которое целился', () => {
    // Смысл `TAP_SLIP`, а не запас на глаз: касание, оставшееся внутри своей
    // области попадания, обязано открыть её здание.
    expect(TAP_SLIP).toBeLessThan(TAP_TARGET);
    expect(TAP_SLIP).toBeGreaterThan(TAP_MOVE);
  });

  it('предел тапа дальше системного долгого нажатия (500 мс)', () => {
    expect(TAP_MS).toBeGreaterThan(500);
  });

  it('одиночное нажатие судится тем же классом, что и жест целиком', () => {
    const p = new Press(1, 100, 100, 0);
    expect(p.move(100 + TAP_MOVE - 1, 100, 10)).toBe(true);
    expect(p.leading).toBe(false);
    expect(p.move(100 + TAP_SLIP + 1, 100, 20)).toBe(false);
    expect(p.moved).toBe(true);
    expect(p.leading).toBe(true);
  });

  it('нажатие считает путь и самый дальний сход — этим и живёт журнал касаний', () => {
    // Ведение от дрожи отличается именно этой парой: у дрожи путь длинный, а
    // сход короткий. Без них журнал с телефона был бы списком «что-то было».
    const p = new Press(1, 100, 100, 0);
    p.move(110, 100, 10);
    p.move(100, 100, 20);
    expect(Math.round(p.path)).toBe(20);
    expect(Math.round(p.far)).toBe(10);
  });
});

describe('призрачный щелчок после тапа', () => {
  // Не предосторожность, а починка. Тап открывает панель, панель поднимает
  // затемнение, затемнение закрывается щелчком — и синтезированный браузером
  // щелчок от ТОГО ЖЕ касания её тут же закрывает. Замер настоящим касанием:
  // неподвижный тап — щелчок по затемнению и панель закрылась; тот же тап со
  // сходом в 20 px — щелчка нет и панель осталась. Отсюда и «иногда».
  interface FakeWindow {
    handlers: Array<(e: Event) => void>;
    timers: number;
    cleared: number[];
    addEventListener: (t: string, fn: (e: Event) => void, capture: boolean) => void;
    removeEventListener: (t: string, fn: (e: Event) => void, capture: boolean) => void;
    setTimeout: (fn: () => void, ms: number) => number;
    clearTimeout: (id: number) => void;
  }

  function fakeWindow(): FakeWindow {
    const w: FakeWindow = {
      handlers: [],
      timers: 0,
      cleared: [],
      addEventListener: (t, fn) => {
        expect(t).toBe('click');
        w.handlers.push(fn);
      },
      removeEventListener: (_t, fn) => {
        w.handlers = w.handlers.filter((h) => h !== fn);
      },
      setTimeout: () => ++w.timers,
      clearTimeout: (id) => w.cleared.push(id),
    };
    return w;
  }

  function withWindow<T>(w: FakeWindow, fn: () => T): T {
    const g = globalThis as unknown as { window?: unknown };
    const had = 'window' in g;
    const prev = g.window;
    g.window = w;
    try {
      return fn();
    } finally {
      if (had) g.window = prev;
      else delete g.window;
    }
  }

  it('перехватывает ровно один щелчок и снимается', () => {
    const w = fakeWindow();
    withWindow(w, () => swallowGhostClick());
    expect(w.handlers.length).toBe(1);
    let stopped = 0;
    let prevented = 0;
    const click = { stopPropagation: () => stopped++, preventDefault: () => prevented++ } as unknown as Event;
    withWindow(w, () => w.handlers[0](click));
    expect(stopped).toBe(1);
    expect(prevented).toBe(1);
    // Снялся сам: второй щелчок — уже настоящий, и глотать его нельзя.
    expect(w.handlers.length).toBe(0);
    expect(w.cleared.length).toBe(1);
  });

  it('срок ожидания короткий: щелчок приходит следом за касанием, а не когда-нибудь', () => {
    expect(GHOST_CLICK_MS).toBeLessThanOrEqual(500);
    expect(GHOST_CLICK_MS).toBeGreaterThan(100);
  });

  it('вне браузера не падает — модуль общий, а тесты идут без DOM', () => {
    expect(() => swallowGhostClick()).not.toThrow();
  });
});

describe('оба холста глотают свой щелчок', () => {
  // Проверка по исходнику: путь «тап → панель → затемнение → щелчок» одинаков в
  // деревне и на карте, и починка обязана стоять в обоих местах. Убрать её из
  // одного — правка одной строки, а увидеть это можно только на телефоне.
  const scene = readFileSync(new URL('./render/Scene.ts', import.meta.url), 'utf8');
  const map = readFileSync(new URL('./ui/map/WorldMap.tsx', import.meta.url), 'utf8');

  it('деревня', () => {
    expect(scene).toMatch(/swallowGhostClick\(\)/);
  });

  it('карта', () => {
    expect(map).toMatch(/swallowGhostClick\(\)/);
  });
});

describe('колесо мыши — одно на оба холста', () => {
  /*
   * Мышь у игры одна, холста два, и это ровно тот случай, на котором мы уже
   * обожглись с разбором жеста. Проверка по исходнику: своё число шага вместо
   * общего — правка одной строки, и заметить её можно только сравнив два
   * холста руками.
   *
   * Отдельно проверяется, что колесо в деревне вообще есть. Его обрабатывал
   * `OrbitControls`, и вместе с ним оно пропало молча: на телефоне щипок
   * работал, а на ПК деревня перестала приближаться совсем.
   */
  const strip = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const scene = strip(readFileSync(new URL('./render/Scene.ts', import.meta.url), 'utf8'));
  const map = strip(readFileSync(new URL('./ui/map/WorldMap.tsx', import.meta.url), 'utf8'));

  it('шаг — заметный, но не прыжок', () => {
    expect(WHEEL_STEP).toBeGreaterThan(1.05);
    expect(WHEEL_STEP).toBeLessThan(1.5);
  });

  it('в деревне колесо слушают и отпускают', () => {
    expect(scene).toMatch(/addEventListener\('wheel', this\.onWheel/);
    expect(scene).toMatch(/removeEventListener\('wheel', this\.onWheel\)/);
  });

  it('оба холста берут шаг отсюда, а не пишут своё число', () => {
    expect(scene).toMatch(/WHEEL_STEP/);
    expect(map).toMatch(/WHEEL_STEP/);
    expect(scene).not.toMatch(/1\.12/);
    expect(map).not.toMatch(/1\.12/);
  });

  it('оба читают знак колеса, а не его величину', () => {
    // `deltaMode` бывает в пикселях, строках и страницах: на одном колесе это
    // даёт наезд, отличающийся в разы.
    expect(scene).toMatch(/deltaY < 0/);
    expect(map).toMatch(/deltaY < 0/);
    expect(scene).not.toMatch(/deltaMode/);
    expect(map).not.toMatch(/deltaMode/);
  });
});
