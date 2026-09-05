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
import { cameraAnchor, figurePosition, useWorld, worldNow } from '@/world/store';
import { WORLD_VIEW, freeCamera } from '@/debug';
import { settlementAt } from '@/world/cache';
import { formatCoord, parseCoord } from '@/world/geo';
import { RELATION_META, RELATION_ORDER, STAGE_BY_ID } from '@/world/data/meta';
import { FIGURE_BY_ID } from '@/world/data/figures';
import { TERRAIN_META, TERRAIN_ORDER } from '@/world/data/terrain';
import {
  COST_BRIDGE,
  COST_FORD,
  COST_PASS,
  COST_RIDGE,
  COST_RIVER,
  COST_ROAD,
  WORLD_ORIGIN,
  WORLD_SIZE,
} from '@/world/data/tuning';
import type { Coord, FigureView } from '@/world/types';
import { formatLeft, secondsLeft } from '@/world/geo';
import { PALETTE, SCALE_DETAIL, SCALE_OVERVIEW, SCALE_START, TILE_CELLS, TILE_MARGIN } from './const';
import {
  type Camera,
  type Viewport,
  clampCamera,
  leashCamera,
  modeFor,
  panBy,
  scaleTo,
  toWorld,
  viewRect,
  zoomAt,
} from './grid';
import { drawFrame } from './frame';
import { dropTiles } from './ground';
import { dropBitmaps } from './tiles';
import { type Look, dropSprites, silhouetteUrl } from './village';
import { dropPaint } from './paint';
import { dropFog } from './fog';
import { dropZones } from './zones';

const TAP_MOVE = 12;
const TAP_MS = 500;

/** Отладочный обзор читается один раз: адрес по ходу партии не меняется. */
const FREE_CAMERA = freeCamera();

/**
 * Легенда показывает те же силуэты, что и полотно, а не эмодзи: значки стадий с
 * карты ушли, когда поселения стали рисоваться, и картинка в легенде обязана
 * совпадать с картинкой на земле. Замок стоит на стадии деревни нарочно — он
 * бывает при любой, и именно этим опасен: кучка хижин в каменной стене.
 */
const LEGEND_ROWS: { look: Look; name: string; note?: string }[] = [
  ...Object.values(STAGE_BY_ID).map((s) => ({
    look: { stage: s.id, relation: 'neutral', mine: false, variant: 0, castle: false } as Look,
    name: s.name,
  })),
  {
    look: { stage: 'village', relation: 'neutral', mine: false, variant: 0, castle: true },
    name: 'Замок',
    note: 'крепость с казной, бывает при любой стадии',
  },
  {
    look: { stage: 'stronghold', relation: 'barbarian', mine: false, variant: 0, castle: false },
    name: 'Стоянка варваров',
    note: 'шатры и терновая дуга вместо стены',
  },
];

/**
 * Местность поверх ландшафта. Числа берутся из тех же констант, что и расчёт
 * пути: легенда, в которой множитель написан руками, врёт со следующей правки
 * баланса, и игрок учится неправде.
 */
const TERRAIN_ROWS: { color: string; name: string; note: string }[] = [
  { color: PALETTE.river, name: 'Река', note: `вплавь ×${COST_RIVER} — преграда, а не дорогая клетка` },
  { color: PALETTE.bridge, name: 'Мост', note: `×${COST_BRIDGE}, и таких мест немного` },
  { color: PALETTE.ford, name: 'Брод', note: `×${COST_FORD}: ноги мокрые, зато не крюк` },
  { color: PALETTE.ridge, name: 'Хребет', note: `×${COST_RIDGE} — в холмах через него не лезут` },
  { color: PALETTE.pass, name: 'Перевал', note: `×${COST_PASS}: единственный проход через хребет` },
  { color: PALETTE.road, name: 'Тракт', note: `×${COST_ROAD} — дорога между станами племён` },
];

/** Строка под значком фигуры: где она и когда освободится. */
function figureNote(f: FigureView): string {
  if (f.phase === 'down') return formatLeft(secondsLeft(f.downUntil, worldNow()));
  if (f.phase === 'moving') return formatLeft(secondsLeft(f.arriveAt, worldNow()));
  if (f.atHome) return 'дома';
  return f.atName ?? 'в поле';
}

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
  const figures = useWorld((g) => g.figures);
  const picked = useWorld((g) => g.picked);
  const anchor = useWorld((g) => g.anchor);
  const setAnchor = useWorld((g) => g.setAnchor);
  const pickFigure = useWorld((g) => g.pick);
  const moveFigure = useWorld((g) => g.moveFigure);
  const closeMap = useGame((g) => g.closeMap);
  const openMarches = useGame((g) => g.openMarches);
  const showToast = useGame((g) => g.showToast);

  // ---------- Камера ----------

  const vp = (): Viewport => ({ w: size.current.w, h: size.current.h });

  /**
   * Поводок и потолок отдаления разом. Зовётся и в кадре, и сразу после каждого
   * жеста: иначе кнопка масштаба успевала бы объявить вид, до которого камеру
   * всё равно не пустят, и подпись расходилась бы с картинкой на кадр.
   */
  const hold = (c: Camera): Camera => {
    if (FREE_CAMERA) return clampCamera(c);
    const at = cameraAnchor(worldNow());
    return at ? leashCamera(c, vp(), at) : clampCamera(c);
  };

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
    dropBitmaps();
    dropSprites();
    dropPaint();
    dropFog();
    dropZones();
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
      // Поводок держится каждый кадр, а не в момент жеста: якорь движется сам —
      // фигура идёт, — и камера обязана идти за ним, а не отставать до первого
      // касания. Отладочный обзор мира (`?worldview=`) поводка не знает.
      cam.current = hold(cam.current);
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
    cam.current = hold(zoomAt(cam.current, vp(), sx, sy, k));
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
    // Фигура в руке — тап ведёт её сюда. Это и есть весь способ отдать приказ:
    // отдельного экрана «куда идти» нет и заводить его незачем.
    const hand = useWorld.getState().picked;
    if (hand) {
      // Из руки фигура не выпадает: разведка — это десяток шагов подряд в одну
      // сторону, и заново брать её после каждого было бы мучением. Отпускают её
      // кнопкой в подсказке или переходом на другой якорь.
      void (async () => {
        const err = await moveFigure(hand, c);
        showToast(err ?? `${FIGURE_BY_ID[hand].name} пошёл к ${formatCoord(c)}.`);
      })();
      return;
    }
    void useWorld.getState().select(c);
    focusOn(c);
  };

  const onWheel = (e: ReactWheelEvent<HTMLCanvasElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    applyZoom(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  };

  // ---------- Кнопки ----------

  const toggleZoom = (): void => {
    const want = zoomedIn ? SCALE_OVERVIEW : SCALE_DETAIL;
    const next = hold(scaleTo(cam.current, vp(), want));
    // Потолок отдаления мог не пустить дальше разведанного. Молча оставить
    // кнопку без действия нельзя — она выглядела бы сломанной.
    if (zoomedIn && modeFor(next.scale) === 'detail') showToast('Дальше разведанного карту не отдалить.');
    cam.current = next;
    setZoomedIn(modeFor(next.scale) === 'detail');
  };

  const goHome = (): void => {
    const home = useWorld.getState().info?.home;
    if (!home) return;
    setAnchor('home');
    cam.current = hold({ ...cam.current, scale: SCALE_DETAIL });
    setZoomedIn(modeFor(cam.current.scale) === 'detail');
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
          <i>{FREE_CAMERA ? `обзор мира (${WORLD_VIEW})` : 'карта мира'}</i>
        </div>
        {/* Переход по координатам — часть свободного обзора: игроку он ни к чему,
            камера всё равно не уйдёт дальше поводка своих. */}
        {FREE_CAMERA ? (
          <button className={`wm-btn${jumpOpen ? ' active' : ''}`} onClick={() => setJumpOpen((v) => !v)} aria-label="Перейти к координатам">
            ⌖
          </button>
        ) : (
          <span className="wm-btn ghost" aria-hidden="true" />
        )}
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
          {LEGEND_ROWS.map((row) => (
            <div className="wm-leg-row wm-leg-shape" key={row.name}>
              <img src={silhouetteUrl(row.look)} alt="" />
              <span>
                {row.name} {row.note && <em>{row.note}</em>}
              </span>
            </div>
          ))}
          <h3>Туман войны</h3>
          <div className="wm-leg-row">
            <i style={{ background: '#120e0b' }} />
            <span>
              Не разведано <em>сюда никто не заходил</em>
            </span>
          </div>
          <div className="wm-leg-row">
            <i style={{ background: '#3a332b' }} />
            <span>
              Вне обзора <em>местность знаем, а что там сейчас — нет</em>
            </span>
          </div>
          <div className="wm-leg-row">
            <i style={{ background: '#6b7a44' }} />
            <span>
              В обзоре <em>видно своими глазами</em>
            </span>
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
          <h3>Местность</h3>
          {TERRAIN_ROWS.map((row) => (
            <div className="wm-leg-row" key={row.name}>
              <i style={{ background: row.color }} />
              <span>
                {row.name} <em>{row.note}</em>
              </span>
            </div>
          ))}

          <h3>Владения</h3>
          <div className="wm-leg-row">
            <i style={{ background: RELATION_META.enemy.color, opacity: 0.45 }} />
            <span>
              Земля племени <em>цветом по разведанному; в тумане не видно ничего</em>
            </span>
          </div>

          <button className="btn ghost wide" onClick={() => setLegendOpen(false)}>
            Понятно
          </button>
        </div>
      )}

      {/* Ряд якорей камеры: деревня и три фигуры. Смотреть игрок может только
          туда, где у него кто-то есть, и этот ряд — весь список таких мест. */}
      <div className="wm-figures">
        <button
          className={`wm-fig${anchor === 'home' ? ' active' : ''}`}
          onClick={() => {
            const home = useWorld.getState().info?.home;
            setAnchor('home');
            if (home) centerOn(home);
          }}
        >
          <span className="ico">🏠</span>
          <em>деревня</em>
        </button>
        {figures.map((f) => (
          <button
            key={f.id}
            className={`wm-fig${anchor === f.id ? ' active' : ''}${picked === f.id ? ' hand' : ''}${f.phase === 'down' ? ' down' : ''}`}
            onClick={() => {
              if (f.phase === 'down') {
                showToast(`${f.name} выбыл: вернётся через ${formatLeft(secondsLeft(f.downUntil, worldNow()))}.`);
                return;
              }
              // Второе нажатие по той же фигуре только отпускает её из руки:
              // камера остаётся на ней, иначе следить за фигурой и разглядывать
              // клетки под ней было бы нельзя одновременно.
              if (anchor === f.id) {
                pickFigure(picked === f.id ? null : f.id);
                return;
              }
              setAnchor(f.id);
              pickFigure(f.id);
              centerOn(figurePosition(f, worldNow()));
            }}
          >
            <span className="ico">{f.icon}</span>
            <em>{figureNote(f)}</em>
          </button>
        ))}
      </div>

      {picked && (
        <div className="wm-hint">
          <span>Тапни по клетке — {FIGURE_BY_ID[picked].name} пойдёт туда.</span>
          <button onClick={() => pickFigure(null)}>Отпустить</button>
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
