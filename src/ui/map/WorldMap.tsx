// Карта мира. Это не десктопная сетка с подписями по обеим осям: на 390 px
// читается только то, что нарисовано крупно. Поэтому здесь перетаскивание,
// щипковый зум, два масштаба и координаты в шапке.
//
// Масштаба именно два, и они разные по природе. Дальний — пиксельный растр,
// клетка в пиксель: он отвечает на вопрос «где чьи земли». Ближний — нарисованный
// мир с непрерывной травой, кляксами воды и ёлками поштучно: он отвечает на
// вопрос «что это за место». Между ними не подмена, а перелив: пиксельный слой
// лежит основой всегда, нарисованный проявляется поверх него по мере приближения.
// Поэтому непропечённый тайл не оставляет дырки — сквозь него виден обзор.
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { useGame } from '@/game/store';
import { useWorld } from '@/world/store';
import { settlementAt } from '@/world/cache';
import { formatCoord, parseCoord } from '@/world/geo';
import { CASTLE_ICON, RELATION_META, RELATION_ORDER, STAGE_BY_ID } from '@/world/data/meta';
import { TERRAIN_META, TERRAIN_ORDER } from '@/world/data/terrain';
import { WORLD_ORIGIN, WORLD_SIZE } from '@/world/data/tuning';
import type { Coord } from '@/world/types';
import { SCALE_DETAIL, SCALE_OVERVIEW, SCALE_START, TILE_CELLS, TILE_MARGIN } from './const';
import {
  type Camera,
  type Viewport,
  clampCamera,
  modeFor,
  panBy,
  scaleTo,
  toWorld,
  viewRect,
  zoomAt,
} from './grid';
import { drawFrame } from './frame';
import { dropTiles } from './ground';
import { dropSprites } from './village';
import { dropPaint } from './paint';

const TAP_MOVE = 12;
const TAP_MS = 500;

const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

export function WorldMap() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coordRef = useRef<HTMLElement>(null);
  const cam = useRef<Camera>({
    cx: WORLD_ORIGIN.x + WORLD_SIZE / 2,
    cy: WORLD_ORIGIN.y + WORLD_SIZE / 2,
    scale: SCALE_START,
  });
  const placed = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; mx: number; my: number } | null>(null);
  const tap = useRef<{ x: number; y: number; t: number } | null>(null);
  const size = useRef({ w: 1, h: 1, dpr: 1 });
  const frameNo = useRef(0);

  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpText, setJumpText] = useState('');
  const [legendOpen, setLegendOpen] = useState(false);
  const [zoomedIn, setZoomedIn] = useState(modeFor(SCALE_START) === 'detail');

  const info = useWorld((g) => g.info);
  const marchCount = useWorld((g) => g.marches.filter((m) => m.own).length);
  const unread = useWorld((g) => g.unread);
  const closeMap = useGame((g) => g.closeMap);
  const openMarches = useGame((g) => g.openMarches);
  const showToast = useGame((g) => g.showToast);

  // ---------- Камера ----------

  const vp = (): Viewport => ({ w: size.current.w, h: size.current.h });

  /**
   * Ставит клетку в верхнюю четверть экрана: снизу выезжает шторка с карточкой,
   * и выбранная клетка не должна оказаться под ней.
   */
  const focusOn = (c: Coord): void => {
    cam.current = clampCamera({
      ...cam.current,
      cx: c.x + 0.5,
      cy: c.y + 0.5 + (size.current.h * 0.28) / cam.current.scale,
    });
  };

  const centerOn = (c: Coord): void => {
    cam.current = clampCamera({ ...cam.current, cx: c.x + 0.5, cy: c.y + 0.5 });
  };

  // Первый кадр — над своей деревней. Масштаб не самый близкий: сосед стоит в
  // 5–9 клетках, и на семи клетках экрана вокруг деревни была бы пустая трава.
  useEffect(() => {
    if (!info || placed.current) return;
    placed.current = true;
    cam.current = { ...cam.current, scale: SCALE_START };
    setZoomedIn(modeFor(SCALE_START) === 'detail');
    centerOn(info.home);
  }, [info]);

  // Новый мир — новая земля: испечённое держать нельзя, оно от старого сида.
  const seed = info?.seed ?? 0;
  useEffect(() => {
    dropTiles();
    dropSprites();
    dropPaint();
  }, [seed]);

  // ---------- Отрисовка ----------

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = (): void => {
      // Больше двойки не берём: на телефоне это вчетверо больше пикселей ради
      // разницы, которой не видно, и вчетверо больше памяти под тайлы.
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const w = wrap.clientWidth || 1;
      const h = wrap.clientHeight || 1;
      const changed = dpr !== size.current.dpr;
      size.current = { w, h, dpr };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      // Окно уехало на другой монитор — испечённое осталось в прежней плотности.
      if (changed) dropSprites();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    let raf = 0;
    const frame = (): void => {
      raf = requestAnimationFrame(frame);
      const { w, h, dpr } = size.current;
      const rect = viewRect(cam.current, { w, h });
      // Куски запрашиваются с запасом: тайл у края экрана не испечётся, пока не
      // приедут куски под его округой, а без запаса они приезжали бы только
      // тогда, когда край уже видно.
      const pad = TILE_CELLS + TILE_MARGIN;
      useWorld.getState().ensureRegion({ x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 });

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawFrame(ctx, cam.current, { w, h }, dpr, ++frameNo.current);

      // В шапке всегда координата под серединой экрана: она отвечает на вопрос
      // «где я сейчас». Координата выбранной клетки живёт в её карточке.
      if (coordRef.current) {
        const text = formatCoord({ x: Math.floor(cam.current.cx), y: Math.floor(cam.current.cy) });
        if (coordRef.current.textContent !== text) coordRef.current.textContent = text;
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      // Уходим с карты — два десятка холстов в памяти держать незачем.
      dropTiles();
    };
    // Полотно живёт весь показ карты: данные оно берёт из стора само.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Жесты ----------

  const local = (e: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const applyZoom = (sx: number, sy: number, k: number): void => {
    cam.current = zoomAt(cam.current, vp(), sx, sy, k);
    const next = modeFor(cam.current.scale) === 'detail';
    setZoomedIn((prev) => (prev === next ? prev : next));
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* захват не обязателен: жест обработается и без него */
    }
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 1) tap.current = { x: p.x, y: p.y, t: performance.now() };
    else tap.current = null;
    gesture.current = null;
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);

    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const g = gesture.current;
      if (g) {
        cam.current = panBy(cam.current, mx - g.mx, my - g.my);
        if (g.dist > 0) applyZoom(mx, my, dist / g.dist);
      }
      gesture.current = { dist, mx, my };
      tap.current = null;
      return;
    }

    cam.current = panBy(cam.current, p.x - prev.x, p.y - prev.y);
    const t = tap.current;
    if (t && Math.hypot(p.x - t.x, p.y - t.y) > TAP_MOVE) tap.current = null;
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const p = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
    const t = tap.current;
    tap.current = null;
    if (!p || !t || performance.now() - t.t > TAP_MS) return;
    if (Math.hypot(p.x - t.x, p.y - t.y) > TAP_MOVE) return;
    const world = toWorld(cam.current, vp(), p.x, p.y);
    const c = { x: Math.floor(world.x), y: Math.floor(world.y) };
    if (c.x < WORLD_ORIGIN.x || c.y < WORLD_ORIGIN.y) return;
    if (c.x >= WORLD_ORIGIN.x + WORLD_SIZE || c.y >= WORLD_ORIGIN.y + WORLD_SIZE) return;
    void useWorld.getState().select(c);
    focusOn(c);
  };

  const onWheel = (e: ReactWheelEvent<HTMLCanvasElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    applyZoom(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  };

  // ---------- Кнопки ----------

  const toggleZoom = (): void => {
    cam.current = scaleTo(cam.current, vp(), zoomedIn ? SCALE_OVERVIEW : SCALE_DETAIL);
    setZoomedIn(modeFor(cam.current.scale) === 'detail');
  };

  const goHome = (): void => {
    const home = useWorld.getState().info?.home;
    if (!home) return;
    cam.current = { ...cam.current, scale: SCALE_DETAIL };
    setZoomedIn(true);
    centerOn(home);
  };

  const doJump = (): void => {
    const c = parseCoord(jumpText);
    if (!c) {
      showToast('Координаты пишутся как 541|822.');
      return;
    }
    if (c.x < WORLD_ORIGIN.x || c.y < WORLD_ORIGIN.y || c.x >= WORLD_ORIGIN.x + WORLD_SIZE || c.y >= WORLD_ORIGIN.y + WORLD_SIZE) {
      showToast(`Мир идёт от ${WORLD_ORIGIN.x}|${WORLD_ORIGIN.y} до ${WORLD_ORIGIN.x + WORLD_SIZE - 1}|${WORLD_ORIGIN.y + WORLD_SIZE - 1}.`);
      return;
    }
    centerOn(c);
    setJumpOpen(false);
    if (settlementAt(c.x, c.y)) void useWorld.getState().select(c);
  };

  return (
    <div className="worldmap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      />

      <div className="wm-top">
        <button className="wm-btn" onClick={closeMap} aria-label="Закрыть карту">
          ←
        </button>
        <div className="wm-coord">
          <b ref={coordRef}>—</b>
          <i>карта мира</i>
        </div>
        <button className={`wm-btn${jumpOpen ? ' active' : ''}`} onClick={() => setJumpOpen((v) => !v)} aria-label="Перейти к координатам">
          ⌖
        </button>
      </div>

      {jumpOpen && (
        <div className="wm-jump">
          <input
            value={jumpText}
            onChange={(e) => setJumpText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doJump()}
            placeholder={`${WORLD_ORIGIN.x + 41}|${WORLD_ORIGIN.y + 22}`}
            inputMode="numeric"
          />
          <button className="btn" onClick={doJump}>
            Перейти
          </button>
        </div>
      )}

      {legendOpen && (
        <div className="wm-legend">
          <h3>Кто на карте</h3>
          {RELATION_ORDER.map((r) => (
            <div className="wm-leg-row" key={r}>
              <i style={{ background: RELATION_META[r].color }} />
              <span>{RELATION_META[r].name}</span>
            </div>
          ))}
          <h3>Поселения</h3>
          {Object.values(STAGE_BY_ID).map((s) => (
            <div className="wm-leg-row" key={s.id}>
              <b style={{ fontFamily: EMOJI_FONT }}>{s.icon}</b>
              <span>{s.name}</span>
            </div>
          ))}
          <div className="wm-leg-row">
            <b>{CASTLE_ICON}</b>
            <span>Замок — крепкая цель с казной</span>
          </div>
          <h3>Земля</h3>
          {TERRAIN_ORDER.map((t) => (
            <div className="wm-leg-row" key={t}>
              <i style={{ background: TERRAIN_META[t].color }} />
              <span>
                {TERRAIN_META[t].name} <em>×{TERRAIN_META[t].cost}</em>
              </span>
            </div>
          ))}
          <button className="btn ghost wide" onClick={() => setLegendOpen(false)}>
            Понятно
          </button>
        </div>
      )}

      <div className="wm-foot">
        <button className="wm-btn wide" onClick={goHome}>
          🏠 <span>Домой</span>
        </button>
        <button className="wm-btn wide" onClick={openMarches}>
          ⚔️ <span>Походы</span>
          {(marchCount > 0 || unread > 0) && <em>{marchCount > 0 ? marchCount : unread}</em>}
        </button>
        <button className="wm-btn" onClick={toggleZoom} aria-label="Сменить масштаб">
          {zoomedIn ? '🔭' : '🔍'}
        </button>
        <button className={`wm-btn${legendOpen ? ' active' : ''}`} onClick={() => setLegendOpen((v) => !v)} aria-label="Легенда">
          ℹ️
        </button>
      </div>
    </div>
  );
}
