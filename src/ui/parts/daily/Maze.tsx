import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  MAZE_N,
  MAZE_SECONDS,
  canStep,
  mazeLevel,
  solveFrom,
  type Cell,
} from '@/game/daily/maze';
import { haptic } from '@/telegram/webapp';
import { FrameLoop } from '@/render/loop';
import { count } from '../plural';
import type { ReactNode } from 'react';
import { Icon } from '@/ui/icons/Icon';
import { realShort } from '../wait';

/** Порог свайпа: больше, чем у карты (`TAP_MOVE`), — здесь нет панорамы, и ложный свайп дороже. */
const SWIPE = 24;
/** Сколько клеток проходит одна пробежка свайпом: до стены, развилки или предмета. */
const RUN_MAX = 6;

const same = (a: Cell, b: Cell): boolean => a.x === b.x && a.y === b.y;

/**
 * 🏰 Ключ и сундук. Рыцарь идёт к сундуку, дверь заперта, ключ где-то по дороге.
 * `MAZE_SECONDS` — и это гонка, а не прогулка.
 *
 * Часы идут по стенным, а не по кадрам: в скрытой вкладке requestAnimationFrame
 * стоит, и таймер, живущий в кадре, в фоне не сработал бы вовсе. На время
 * сворачивания приложения часы встают — свернуть на пользу всё равно нельзя,
 * доска в фоне не видна, а проигрыш из-за звонка был бы обидой ни за что.
 */
export function Maze({ seed, onDone }: { seed: number; onDone: (won: boolean) => void }) {
  // useMemo обязателен: генерация лабиринта — это Прим плюс поиск в ширину и до
  // `MAZE_TRIES` подсидов отбраковки (`game/daily/maze.ts`). Панель перерисовывается
  // на каждом тике стора (`TICK_MS`), и без памяти всё это считалось бы заново на
  // каждой перерисовке.
  const lv = useMemo(() => mazeLevel(seed), [seed]);
  const [at, setAt] = useState<Cell>(lv.start);
  const [hasKey, setHasKey] = useState(false);
  const [left, setLeft] = useState(MAZE_SECONDS);
  const [lost, setLost] = useState(false);
  const deadline = useRef(performance.now() + MAZE_SECONDS * 1000);
  const finished = useRef(false);
  const board = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const place = useRef<Cell>(lv.start);
  const key = useRef(false);
  // Итог держим в ссылке: панель над нами перерисовывается на каждом тике стора
  // (`TICK_MS`) и каждый раз отдаёт новую функцию. Стой она в зависимостях, часы пересоздавались
  // бы вместе с ней, и отсчёт дёргался бы.
  const finish = useRef(onDone);
  finish.current = onDone;

  useEffect(() => {
    // И кадр, и интервал: кадр рисует часы плавно, интервал доводит дело до
    // конца, когда кадры встали, — иначе возврат из фона разрешался бы не сразу.
    const check = (): void => {
      if (finished.current) return;
      const ms = deadline.current - performance.now();
      setLeft(Math.max(0, ms / 1000));
      if (ms <= 0) {
        finished.current = true;
        setLost(true);
        haptic('error');
        finish.current(false);
      }
    };
    const id = setInterval(check, 200);
    const loop = FrameLoop.run(check);
    return () => {
      clearInterval(id);
      loop.stop();
    };
  }, []);

  useEffect(() => {
    let hiddenAt = 0;
    const onVis = (): void => {
      if (document.visibilityState === 'hidden') hiddenAt = performance.now();
      else if (hiddenAt) {
        deadline.current += performance.now() - hiddenAt;
        hiddenAt = 0;
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  /** Один шаг. Возвращает, случился ли он. */
  const step = (to: Cell): boolean => {
    if (finished.current) return false;
    if (!canStep(lv, place.current, to, key.current)) return false;
    place.current = to;
    setAt(to);
    if (same(to, lv.key) && !key.current) {
      key.current = true;
      setHasKey(true);
      haptic('light');
    }
    if (same(to, lv.chest)) {
      finished.current = true;
      haptic('success');
      finish.current(true);
    }
    return true;
  };

  /** Пробежка свайпом: идём в одну сторону, пока идётся, но не сквозь предметы. */
  const run = (dx: number, dy: number): void => {
    for (let i = 0; i < RUN_MAX; i++) {
      const from = place.current;
      const to = { x: from.x + dx, y: from.y + dy };
      if (!step(to)) return;
      if (finished.current) return;
      // У ключа, двери и сундука пробежка останавливается: игрок должен видеть,
      // что подобрал и куда пришёл.
      if (same(to, lv.key) || same(to, lv.door) || same(to, lv.chest)) return;
    }
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag.current || finished.current) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || d.moved) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) < SWIPE && Math.abs(dy) < SWIPE) return;
    d.moved = true;
    if (Math.abs(dx) > Math.abs(dy)) run(Math.sign(dx), 0);
    else run(0, Math.sign(dy));
  };

  const onUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (d.moved) return;
    // Тап: шагаем только в соседнюю клетку. Автопуть по тапу в сундук решал бы
    // игру за игрока, и `MAZE_SECONDS` перестали бы что-либо значить.
    const rect = e.currentTarget.getBoundingClientRect();
    const cell = rect.width / MAZE_N;
    const to = {
      x: Math.floor((e.clientX - rect.left) / cell),
      y: Math.floor((e.clientY - rect.top) / cell),
    };
    const from = place.current;
    if (Math.abs(to.x - from.x) + Math.abs(to.y - from.y) !== 1) return;
    step(to);
  };

  // Проиграл — показываем остаток кратчайшего пути. Без этого игрок не понимает,
  // где ошибся, и завтра ошибётся так же.
  const trail = lost ? solveFrom(lv, at, hasKey) : [];
  const pip = (c: Cell): ReactNode => {
    if (same(c, lv.chest)) return <Icon name="maze-chest" />;
    // Открытая дверь — та же дверь: второго рисунка ей не заводили, разница
    // видна по тому, что ключ уже подобран и клетка проходима.
    if (same(c, lv.door)) return <Icon name="maze-door" />;
    if (same(c, lv.key) && !hasKey) return <Icon name="maze-key" />;
    return null;
  };

  return (
    <>
      <div className="mg-head">
        <b>{hasKey ? 'Ключ взят, теперь к сундуку' : 'Найди ключ, потом сундук'}</b>
        <span className={`mg-clock${left <= 8 ? ' low' : ''}`}>{realShort(left)}</span>
      </div>

      <div
        className="mg-maze"
        ref={board}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {lv.walls.map((row, y) =>
          row.map((w, x) => (
            <div
              key={`${x},${y}`}
              className={`mg-cell${w.top ? ' w-top' : ''}${w.left ? ' w-left' : ''}`}
            >
              {pip({ x, y })}
            </div>
          )),
        )}
        {trail.map((c, i) => (
          <span
            key={i}
            className="mg-trail"
            style={{ transform: `translate(calc(var(--cell) * ${c.x}), calc(var(--cell) * ${c.y}))` }}
          />
        ))}
        <span
          className="mg-knight"
          style={{ transform: `translate(calc(var(--cell) * ${at.x}), calc(var(--cell) * ${at.y}))` }}
        >
          <Icon name="gear-shield" />
        </span>
      </div>

      {lost ? (
        <div className="mg-result bad">
          {/* Склонение общим правилом: `=== 1 ? 'шаг' : 'шагов'` давало
              «оставалось 2 шагов», а два-четыре хода до сундука — самый частый
              остаток у того, кто проиграл по таймеру. */}
          Время вышло. До сундука оставалось {count(trail.length, 'шаг', 'шага', 'шагов')}. Точки показывают
          короткий путь.
        </div>
      ) : (
        <div className="note">Нажми на соседнюю клетку или веди пальцем.</div>
      )}
    </>
  );
}
