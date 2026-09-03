// Карта мира. Это не десктопная сетка с подписями по обеим осям: на 390 px читается
// только то, что нарисовано крупно. Поэтому здесь перетаскивание, щипковый зум,
// два масштаба и координаты в шапке — а не координатная сетка вокруг поля.
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
import { CASTLE_ICON, RELATION_META, RELATION_ORDER, STAGE_BY_ID } from '@/world/data/meta';
import { TERRAIN_META, TERRAIN_ORDER } from '@/world/data/terrain';
import { WORLD_ORIGIN, WORLD_SIZE } from '@/world/data/tuning';
import type { Coord, MarchView, Rect, SettlementView } from '@/world/types';
import { chunkBitmap } from './tiles';

/** Пикселей на клетку. Два рабочих масштаба: обзор области и близкий с деталями. */
const SCALE_MIN = 3.5;
const SCALE_MAX = 36;
const SCALE_OVERVIEW = 7;
const SCALE_DETAIL = 20;
/** С этого масштаба появляются сетка и таймеры походов. */
const DETAIL_FROM = 13;
/** Имена поселений — только вблизи: на обзоре они превращаются в кашу. */
const LABEL_FROM = 17;

const TAP_MOVE = 12;
const TAP_MS = 500;

const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

interface Camera {
  cx: number;
  cy: number;
  scale: number;
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

export function WorldMap() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coordRef = useRef<HTMLElement>(null);
  const cam = useRef<Camera>({ cx: WORLD_ORIGIN.x + WORLD_SIZE / 2, cy: WORLD_ORIGIN.y + WORLD_SIZE / 2, scale: SCALE_DETAIL });
  const placed = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; mx: number; my: number } | null>(null);
  const tap = useRef<{ x: number; y: number; t: number } | null>(null);
  const size = useRef({ w: 1, h: 1, dpr: 1 });
  /** Прямоугольники уже нарисованных подписей текущего кадра. */
  const labels = useRef<{ x: number; y: number; w: number; h: number }[]>([]);

  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpText, setJumpText] = useState('');
  const [legendOpen, setLegendOpen] = useState(false);
  const [zoomedIn, setZoomedIn] = useState(true);

  const info = useWorld((g) => g.info);
  const marchCount = useWorld((g) => g.marches.filter((m) => m.own).length);
  const unread = useWorld((g) => g.unread);
  const closeMap = useGame((g) => g.closeMap);
  const openMarches = useGame((g) => g.openMarches);
  const showToast = useGame((g) => g.showToast);

  // ---------- Камера ----------

  const viewRect = (): Rect => {
    const { cx, cy, scale } = cam.current;
    const { w, h } = size.current;
    return { x: cx - w / (2 * scale), y: cy - h / (2 * scale), w: w / scale, h: h / scale };
  };

  const toScreen = (wx: number, wy: number): [number, number] => {
    const { cx, cy, scale } = cam.current;
    const { w, h } = size.current;
    return [(wx - cx) * scale + w / 2, (wy - cy) * scale + h / 2];
  };

  const toWorld = (sx: number, sy: number): Coord => {
    const { cx, cy, scale } = cam.current;
    const { w, h } = size.current;
    return { x: (sx - w / 2) / scale + cx, y: (sy - h / 2) / scale + cy };
  };

  const clampCam = (): void => {
    const pad = 6;
    cam.current.cx = clamp(cam.current.cx, WORLD_ORIGIN.x - pad, WORLD_ORIGIN.x + WORLD_SIZE + pad);
    cam.current.cy = clamp(cam.current.cy, WORLD_ORIGIN.y - pad, WORLD_ORIGIN.y + WORLD_SIZE + pad);
  };

  const panBy = (dx: number, dy: number): void => {
    cam.current.cx -= dx / cam.current.scale;
    cam.current.cy -= dy / cam.current.scale;
    clampCam();
  };

  const zoomAt = (sx: number, sy: number, k: number): void => {
    const before = toWorld(sx, sy);
    cam.current.scale = clamp(cam.current.scale * k, SCALE_MIN, SCALE_MAX);
    const after = toWorld(sx, sy);
    cam.current.cx += before.x - after.x;
    cam.current.cy += before.y - after.y;
    clampCam();
    setZoomedIn(cam.current.scale >= DETAIL_FROM);
  };

  /**
   * Ставит клетку в верхнюю четверть экрана: снизу выезжает шторка с карточкой,
   * и выбранная клетка не должна оказаться под ней.
   */
  const focusOn = (c: Coord): void => {
    cam.current.cx = c.x + 0.5;
    cam.current.cy = c.y + 0.5 + (size.current.h * 0.28) / cam.current.scale;
    clampCam();
  };

  const centerOn = (c: Coord): void => {
    cam.current.cx = c.x + 0.5;
    cam.current.cy = c.y + 0.5;
    clampCam();
  };

  // Первый кадр — над своей деревней: карта открывается там, где живёт игрок.
  useEffect(() => {
    if (!info || placed.current) return;
    placed.current = true;
    cam.current.scale = SCALE_DETAIL;
    centerOn(info.home);
  }, [info]);

  // ---------- Отрисовка ----------

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = (): void => {
      const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
      const w = wrap.clientWidth || 1;
      const h = wrap.clientHeight || 1;
      size.current = { w, h, dpr };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    let raf = 0;
    const frame = (): void => {
      raf = requestAnimationFrame(frame);
      const { w, h, dpr } = size.current;
      const rect = viewRect();
      useWorld.getState().ensureRegion(rect);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      draw(ctx, w, h, rect);

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
    };
    // Полотно живёт весь показ карты: данные оно берёт из стора само.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function draw(ctx: CanvasRenderingContext2D, w: number, h: number, rect: Rect): void {
    const { scale } = cam.current;
    const detail = scale >= DETAIL_FROM;
    // Занятые подписями места: две соседние деревни не должны писать имена друг на друга.
    labels.current.length = 0;
    const state = useWorld.getState();
    const now = worldNow();

    // Пустота за краем мира.
    ctx.fillStyle = '#120e0b';
    ctx.fillRect(0, 0, w, h);

    // Ландшафт — по кускам, одной картинкой на кусок.
    for (const chunk of loadedIn(rect)) {
      const [sx, sy] = toScreen(chunk.rect.x, chunk.rect.y);
      ctx.drawImage(
        chunkBitmap(chunk),
        Math.round(sx),
        Math.round(sy),
        Math.ceil(chunk.rect.w * scale),
        Math.ceil(chunk.rect.h * scale),
      );
    }

    if (detail) {
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const x0 = Math.floor(rect.x);
      const y0 = Math.floor(rect.y);
      for (let x = x0; x <= rect.x + rect.w; x++) {
        const [sx] = toScreen(x, 0);
        ctx.moveTo(Math.round(sx) + 0.5, 0);
        ctx.lineTo(Math.round(sx) + 0.5, h);
      }
      for (let y = y0; y <= rect.y + rect.h; y++) {
        const [, sy] = toScreen(0, y);
        ctx.moveTo(0, Math.round(sy) + 0.5);
        ctx.lineTo(w, Math.round(sy) + 0.5);
      }
      ctx.stroke();
    }

    // Походы под значками поселений: линия пути, отряд, таймер.
    for (const m of state.marches) drawMarch(ctx, m, now, detail);

    // Поселения: сначала все значки, потом подписи — имя не должно лечь под соседний значок.
    const inView: SettlementView[] = [];
    for (const chunk of loadedIn(rect)) {
      for (const s of chunk.settlements) {
        drawSettlement(ctx, s, scale);
        inView.push(s);
      }
    }
    if (scale >= LABEL_FROM) {
      // Своя деревня подписывается первой: её имя важнее чужих.
      for (const s of inView.sort((a, b) => Number(b.mine) - Number(a.mine))) drawLabel(ctx, s, scale);
    }

    // Выбранная клетка.
    const sel = state.selected;
    if (sel) {
      const [sx, sy] = toScreen(sel.x, sel.y);
      ctx.strokeStyle = '#f3e9d8';
      ctx.lineWidth = 2;
      ctx.strokeRect(Math.round(sx) - 1, Math.round(sy) - 1, Math.round(scale) + 2, Math.round(scale) + 2);
    }
  }

  function drawSettlement(ctx: CanvasRenderingContext2D, s: SettlementView, scale: number): void {
    const [sx, sy] = toScreen(s.x, s.y);
    if (sx < -scale * 2 || sy < -scale * 2 || sx > size.current.w + scale || sy > size.current.h + scale) return;
    const cx = sx + scale / 2;
    const cy = sy + scale / 2;
    const r = Math.max(4, scale * 0.46);

    // На обзорном масштабе иконку всё равно не разглядеть: остаётся цветная точка,
    // и карта читается как расстановка сил, а не как список имён.
    if (scale < 8) {
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(2, r * (s.mine ? 1.1 : 0.85)), 0, Math.PI * 2);
      ctx.fillStyle = s.color;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(10, 8, 6, 0.75)';
      ctx.stroke();
      return;
    }

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(20, 15, 11, 0.72)';
    ctx.fill();
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.mine ? 2.5 : 1.6;
    ctx.stroke();

    ctx.font = `${Math.round(r * 1.25)}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s.castle ? CASTLE_ICON : STAGE_BY_ID[s.stage].icon, cx, cy + r * 0.08);
  }

  /** Подпись под значком. Если место занято соседом, имя не рисуется вовсе. */
  function drawLabel(ctx: CanvasRenderingContext2D, s: SettlementView, scale: number): void {
    const [sx, sy] = toScreen(s.x, s.y);
    if (sx < -scale || sy < -scale || sx > size.current.w || sy > size.current.h) return;
    const cx = sx + scale / 2;
    const top = sy + scale / 2 + Math.max(4, scale * 0.46) + 3;
    ctx.font = '11px system-ui, sans-serif';
    const width = ctx.measureText(s.name).width;
    const box = { x: cx - width / 2 - 2, y: top, w: width + 4, h: 13 };
    for (const b of labels.current) {
      if (box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y) return;
    }
    labels.current.push(box);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(10, 8, 6, 0.85)';
    ctx.strokeText(s.name, cx, top);
    ctx.fillStyle = s.mine ? s.color : '#e7dcc9';
    ctx.fillText(s.name, cx, top);
  }

  function drawMarch(ctx: CanvasRenderingContext2D, m: MarchView, now: number, detail: boolean): void {
    const color = m.hostile ? RELATION_META.enemy.color : RELATION_META.self.color;
    const pos = m.phase === 'stay' ? m.to : marchPosition(m, now);
    const [fx, fy] = toScreen(m.from.x + 0.5, m.from.y + 0.5);
    const [tx, ty] = toScreen(m.to.x + 0.5, m.to.y + 0.5);
    const [px, py] = toScreen(pos.x + 0.5, pos.y + 0.5);

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
    const r = Math.max(5, Math.min(11, cam.current.scale * 0.4));
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
        panBy(mx - g.mx, my - g.my);
        if (g.dist > 0) zoomAt(mx, my, dist / g.dist);
      }
      gesture.current = { dist, mx, my };
      tap.current = null;
      return;
    }

    panBy(p.x - prev.x, p.y - prev.y);
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
    const w = toWorld(p.x, p.y);
    const c = { x: Math.floor(w.x), y: Math.floor(w.y) };
    if (c.x < WORLD_ORIGIN.x || c.y < WORLD_ORIGIN.y) return;
    if (c.x >= WORLD_ORIGIN.x + WORLD_SIZE || c.y >= WORLD_ORIGIN.y + WORLD_SIZE) return;
    void useWorld.getState().select(c);
    focusOn(c);
  };

  const onWheel = (e: ReactWheelEvent<HTMLCanvasElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  };

  // ---------- Кнопки ----------

  const toggleZoom = (): void => {
    const { w, h } = size.current;
    zoomAt(w / 2, h / 2, (zoomedIn ? SCALE_OVERVIEW : SCALE_DETAIL) / cam.current.scale);
  };

  const goHome = (): void => {
    const home = useWorld.getState().info?.home;
    if (!home) return;
    cam.current.scale = SCALE_DETAIL;
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
              <b>{s.icon}</b>
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
