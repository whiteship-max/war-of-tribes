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
import { useWorld, worldNow } from '@/world/store';
import { loadedIn, settlementAt } from '@/world/cache';
import { formatCoord, formatLeft, marchPosition, parseCoord, secondsLeft } from '@/world/geo';
import { RELATION_META, RELATION_ORDER, STAGE_BY_ID } from '@/world/data/meta';
import { TERRAIN_META, TERRAIN_ORDER } from '@/world/data/terrain';
import { WORLD_ORIGIN, WORLD_SIZE } from '@/world/data/tuning';
import type { Coord, MarchView, Rect, SettlementView } from '@/world/types';
import { chunkBitmap } from './tiles';
import {
  LABEL_FROM,
  SCALE_DETAIL,
  SCALE_OVERVIEW,
  SCALE_START,
  TILE_CELLS,
  TILE_MARGIN,
} from './const';
import {
  type Camera,
  type Viewport,
  clampCamera,
  detailAlpha,
  modeFor,
  panBy,
  scaleTo,
  toScreen,
  toWorld,
  viewRect,
  zoomAt,
} from './grid';
import { GRID } from './palette';
import { drawGrid, drawGround, drawVillages, markersOf, settlementsIn } from './detail';
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
  /** Прямоугольники уже нарисованных подписей текущего кадра. */
  const labels = useRef<{ x: number; y: number; w: number; h: number }[]>([]);

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
      draw(ctx, w, h, dpr, rect);

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

  function draw(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, rect: Rect): void {
    const camera = cam.current;
    const view: Viewport = { w, h };
    const scale = camera.scale;
    const near = detailAlpha(scale);
    const far = 1 - near;
    const frame = ++frameNo.current;
    labels.current.length = 0;
    const state = useWorld.getState();
    const now = worldNow();

    // Пустота за краем мира.
    ctx.fillStyle = '#120e0b';
    ctx.fillRect(0, 0, w, h);

    // Дальний слой — пиксельный растр, по куску на картинку. Он лежит основой
    // всегда: сквозь непропечённый тайл ближнего слоя виден именно он.
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (const chunk of loadedIn(rect)) {
      const [sx, sy] = toScreen(camera, view, chunk.rect.x, chunk.rect.y);
      ctx.drawImage(
        chunkBitmap(chunk),
        Math.round(sx),
        Math.round(sy),
        Math.ceil(chunk.rect.w * scale),
        Math.ceil(chunk.rect.h * scale),
      );
    }
    ctx.restore();

    // Ближний слой поверх него.
    if (near > 0 && seed) drawGround(ctx, camera, view, seed, frame, near);

    drawGrid(ctx, camera, view, near, 52);

    const inView = settlementsIn(rect);

    // Поселения: на обзоре — цветные точки (карта читается как расстановка сил),
    // вблизи — нарисованные значки. В полосе перехода оба, встречной прозрачностью.
    if (far > 0) {
      ctx.save();
      ctx.globalAlpha = far;
      for (const s of inView) drawDot(ctx, camera, view, s, scale);
      ctx.restore();
    }
    if (near > 0) drawVillages(ctx, camera, view, inView, dpr, near, markersOf(state.marches), now);

    // Походы поверх земли и поселений: их таймер важнее любой крыши.
    for (const m of state.marches) drawMarch(ctx, camera, view, m, now, scale >= LABEL_FROM);

    if (scale >= LABEL_FROM) {
      // Своя деревня подписывается первой: её имя важнее чужих.
      for (const s of [...inView].sort((a, b) => Number(b.mine) - Number(a.mine))) {
        drawLabel(ctx, camera, view, s, scale, near);
      }
    }

    // Выбранная клетка.
    const sel = state.selected;
    if (sel) {
      const [sx, sy] = toScreen(camera, view, sel.x, sel.y);
      const [bx, by] = toScreen(camera, view, sel.x + 1, sel.y + 1);
      ctx.fillStyle = GRID.selectFill;
      ctx.fillRect(Math.round(sx), Math.round(sy), Math.round(bx - sx), Math.round(by - sy));
      ctx.strokeStyle = GRID.select;
      ctx.lineWidth = 2;
      ctx.strokeRect(Math.round(sx) - 1, Math.round(sy) - 1, Math.round(bx - sx) + 2, Math.round(by - sy) + 2);
    }
  }

  /** Обзорный значок: цветная точка отношения. Вблизи её сменяет нарисованный. */
  function drawDot(ctx: CanvasRenderingContext2D, camera: Camera, view: Viewport, s: SettlementView, scale: number): void {
    const [sx, sy] = toScreen(camera, view, s.x + 0.5, s.y + 0.5);
    if (sx < -scale * 2 || sy < -scale * 2 || sx > view.w + scale || sy > view.h + scale) return;
    const r = Math.max(2.5, Math.min(9, scale * 0.42) * (s.mine ? 1.15 : 0.85));
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle = s.color;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(10, 8, 6, 0.75)';
    ctx.stroke();
  }

  /** Подпись под значком. Если место занято соседом, имя не рисуется вовсе. */
  function drawLabel(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    view: Viewport,
    s: SettlementView,
    scale: number,
    near: number,
  ): void {
    const [sx, sy] = toScreen(camera, view, s.x + 0.5, s.y + 0.5);
    if (sx < 0 || sy < 0 || sx > view.w || sy > view.h) return;
    // Вблизи имя отходит вниз: под ним двор поселения, а не пустая трава.
    const top = sy + Math.max(6, scale * (0.5 + near * 0.7));
    ctx.font = '11px system-ui, sans-serif';
    const width = ctx.measureText(s.name).width;
    const box = { x: sx - width / 2 - 2, y: top, w: width + 4, h: 13 };
    for (const b of labels.current) {
      if (box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y) return;
    }
    labels.current.push(box);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(10, 8, 6, 0.85)';
    ctx.strokeText(s.name, sx, top);
    ctx.fillStyle = s.mine ? s.color : '#e7dcc9';
    ctx.fillText(s.name, sx, top);
  }

  function drawMarch(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    view: Viewport,
    m: MarchView,
    now: number,
    detail: boolean,
  ): void {
    const color = m.hostile ? RELATION_META.enemy.color : RELATION_META.self.color;
    const pos = m.phase === 'stay' ? m.to : marchPosition(m, now);
    const [fx, fy] = toScreen(camera, view, m.from.x + 0.5, m.from.y + 0.5);
    const [tx, ty] = toScreen(camera, view, m.to.x + 0.5, m.to.y + 0.5);
    const [px, py] = toScreen(camera, view, pos.x + 0.5, pos.y + 0.5);

    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.restore();

    // Стрелка смотрит туда, куда идёт отряд.
    const angle = Math.atan2(ty - py, tx - px);
    const r = Math.max(5, Math.min(13, camera.scale * 0.28));
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(-r * 0.7, r * 0.7);
    ctx.lineTo(-r * 0.35, 0);
    ctx.lineTo(-r * 0.7, -r * 0.7);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(10, 8, 6, 0.8)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    if (detail || m.hostile) {
      const left = formatLeft(secondsLeft(m.arriveAt, now));
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(10, 8, 6, 0.85)';
      ctx.strokeText(left, px, py - r - 2);
      ctx.fillStyle = color;
      ctx.fillText(left, px, py - r - 2);
    }
  }

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
