// Заранее испечённый регион (docs/map_tw.md, раздел 13.4) — служба страницы.
//
// Регион игрока ограничен, и его землю печётся заранее: куски обзора и тайлы среднего слоя — на весь регион с
// каймой, листы старой карты — на всё, куда пускают камеру; тайлы ближнего масштаба (на весь регион им не
// хватило бы памяти) — вокруг камеры. Печёт **рабочий поток** (`bake.worker.ts`, `OffscreenCanvas`); кадр
// страницы только копирует готовое и в движении не печёт ничего. Нет потока, который умеет рисовать (Safari до
// 16.4), — печёт страница сама, теми же шагами (`jobs.ts`), по нескольку миллисекунд за кадр и только стоя.
//
// Пока выпечка не готова — грубый растр региона (клетка в пиксель, из того же снимка земли), над ним готовое по
// мере приезда: дыр нет. Порядок работ — нужда кадра: тайлы ближнего масштаба на экране, потом видимое, потом
// весь регион от камеры наружу.
import type { Rect } from '@/world/types';
import { cachedChunk, chunkKeysIn } from '@/world/cache';
import { useWorld } from '@/world/store';
import { CHUNK, WORLD_ORIGIN } from '@/world/data/tuning';
import { bakeCost, probe } from '@/debug';
import { TERRAIN_ORDER } from '@/world/data/terrain';
import { TILE_CELLS } from '../const';
import { type Camera, type Viewport, cacheFor, detailAlpha, frameQueue, tileOrigin, viewRect } from '../grid';
import { BAKE_REACH, MID_CELLS, type Steps, type TwLook, setTwLook, twLook } from './bake';
import { type Canvas, type Picture, ctxOf, freePicture, makeCanvas, pictureBytes } from './canvas';
import { setLand } from './land';
import { type LandGrid, gridLand } from './landgrid';
import { FEATURE_BITS, extractLand } from './landcache';
import { type Knowledge, signOf } from './knowledge';
import { type Job, type JobKind, chunkCells, jobKey, jobSteps, setKnowledge } from './jobs';
import { C } from './palette';
import { TW_SPEC } from './spec';
import type { FromWorker, ToWorker } from './bake.worker';
import { type Theatre, setActiveTheatre, theatreAt } from './theatre/theatre';
import { type TheatrePlan, theatrePlan, visibleTo } from './theatre/plan';

const PROBE = probe();

// ---------- Движение ----------

/** Сколько камера стоит, прежде чем страница начнёт печь сама, мс: пауза пальца — не остановка. */
export const STILL_MS = 160;
/** Сколько страница печёт за кадр стоя, мс (запасной путь): кадр в 60 Гц — 16.7 мс, и в нём не только выпечка. */
export const PAGE_SLICE_MS = 6;

let lastCam: Camera | null = null;
let movedAt = -Infinity;
let clock = 0;

/** Камера двигалась только что: в движении страница не печёт ничего. */
export const moving = (): boolean => clock - movedAt < STILL_MS;

function trackMotion(cam: Camera, now: number): void {
  clock = now;
  if (!lastCam || lastCam.cx !== cam.cx || lastCam.cy !== cam.cy || lastCam.scale !== cam.scale) movedAt = now;
  lastCam = { ...cam };
}

// ---------- Исполнители ----------

type Deliver = (job: Job, pic: Picture | null, ms: number, where: 'worker' | 'page') => void;

interface Executor {
  readonly kind: 'worker' | 'page';
  /** Сколько работ можно отдать сейчас. */
  free(): number;
  give(job: Job): void;
  land(grid: LandGrid, seed: number, look: TwLook): void;
  look(look: TwLook): void;
  knowledge(k: Knowledge): void;
  /** Шаги в странице за кадр — только у запасного пути. */
  step(budgetMs: number): void;
  stop(): void;
}

/** Работ в потоке разом: одна печётся, одна ждёт — поток не простаивает между ответами. */
const WORKER_SLOTS = 2;

class WorkerExecutor implements Executor {
  readonly kind = 'worker' as const;
  private ready = false;
  private busy = 0;
  private readonly w: Worker;

  constructor(
    private readonly deliver: Deliver,
    private readonly fallback: () => void,
  ) {
    this.w = new Worker(new URL('./bake.worker.ts', import.meta.url), { type: 'module' });
    this.w.onmessage = (e: MessageEvent<FromWorker>): void => {
      const m = e.data;
      if (m.type === 'ready') {
        if (m.canvas) this.ready = true;
        else this.fallback();
        return;
      }
      this.busy = Math.max(0, this.busy - 1);
      if (m.type === 'done') this.deliver(m.job, m.pic, m.ms, 'worker');
      else this.deliver(m.job, null, 0, 'worker');
    };
    this.w.onerror = (): void => {
      if (!this.ready) this.fallback();
    };
  }

  private send(m: ToWorker): void {
    this.w.postMessage(m);
  }

  free(): number {
    return this.ready ? WORKER_SLOTS - this.busy : 0;
  }

  give(job: Job): void {
    this.busy++;
    this.send({ type: 'job', job });
  }

  land(grid: LandGrid, seed: number, look: TwLook): void {
    this.send({ type: 'land', seed, grid, bits: FEATURE_BITS, look });
  }

  look(look: TwLook): void {
    this.send({ type: 'look', look });
  }

  knowledge(k: Knowledge): void {
    this.send({ type: 'knowledge', k });
  }

  step(): void {}

  stop(): void {
    this.w.terminate();
  }
}

/** Сколько шагов выпечки страница сделала сама (запасной путь) — тест «в движении выпечки нет». */
let pageSteps = 0;

/** Запасной путь: страница печёт сама — шагами, `budgetMs` за кадр, и только стоя (зовёт кадр). */
class PageExecutor implements Executor {
  readonly kind = 'page' as const;
  private current: { job: Job; steps: Steps<Canvas | null>; ms: number } | null = null;
  private seed = 0;

  constructor(private readonly deliver: Deliver) {}

  free(): number {
    return this.current ? 0 : 1;
  }

  give(job: Job): void {
    this.current = { job, steps: jobSteps(job, this.seed), ms: 0 };
  }

  land(grid: LandGrid, seed: number, look: TwLook): void {
    this.seed = seed;
    setLand(gridLand(grid, FEATURE_BITS));
    setTwLook(look);
  }

  look(look: TwLook): void {
    setTwLook(look);
  }

  knowledge(k: Knowledge): void {
    setKnowledge(k);
  }

  step(budgetMs: number): void {
    const t0 = performance.now();
    while (this.current && performance.now() - t0 < budgetMs) {
      const cur = this.current;
      const s0 = performance.now();
      let r: IteratorResult<void, Canvas | null>;
      try {
        pageSteps++;
        r = cur.steps.next();
      } catch {
        this.current = null;
        this.deliver(cur.job, null, cur.ms, 'page');
        continue;
      }
      cur.ms += performance.now() - s0;
      if (!r.done) continue;
      this.current = null;
      this.deliver(cur.job, r.value, cur.ms, 'page');
    }
  }

  stop(): void {
    this.current = null;
  }
}

/** Есть ли у страницы рабочий поток: в vitest (среда node) его нет — там всегда запасной путь. */
const workersOk = (): boolean => typeof Worker !== 'undefined' && typeof document !== 'undefined' && !NO_WORKER;

/** `?prebake=page` — запасной путь на машине, где поток есть: так меряют и проверяют его (стенд, отчёт). */
const NO_WORKER = typeof location !== 'undefined' && new URLSearchParams(location.search).get('prebake') === 'page';

// ---------- Регион ----------

interface Entry {
  pic: Picture;
  gen: number;
}

interface SheetEntry {
  pic: Picture;
  sign: number;
}

interface NearEntry {
  pic: Picture;
  gen: number;
  used: number;
}

interface Session {
  seed: number;
  theatre: Theatre;
  plan: TheatrePlan;
  /** Где лежит снимок земли: всё, куда пускают камеру, с запасом под окно выпечки. */
  dataRect: Rect;
  /** Заказаны ли куски под снимком у мира. */
  asked: boolean;
  land: LandGrid | null;
  /** Грубый растр снимка: клетка в пиксель. Лежит под всем, пока не приехало испечённое. */
  coarse: Canvas | null;
  knowledge: Knowledge | null;
  /** Поколение знания: растёт, когда открылось новое. */
  knowledgeGen: number;
  /** Поколение данных под снимком: растёт, когда куски приехали заново (владения, разведка — что угодно). */
  dataGen: number;
  /** Когда куски под снимком приезжали в последний раз — по ним видно, что знание могло смениться. */
  chunkStamps: Map<string, number>;
  checkedAt: number;
  signs: Map<string, { sign: number; open: boolean }>;
  /** Поколение вида: сменился уровень или сезон — испечённое прежним устарело (но рисуется, пока нет нового). */
  gen: number;
  overview: Map<string, Entry>;
  mid: Map<string, Entry>;
  sheets: Map<string, SheetEntry>;
  near: Map<string, NearEntry>;
  inFlight: Set<string>;
  /**
   * Работы, вернувшиеся ни с чем (земли под окном нет): не повторяются, пока не сменятся знание или вид, — иначе
   * первая в очереди забирала бы поток себе по кругу.
   */
  failed: Set<string>;
  exec: Executor | null;
  /** Чего хочет кадр вблизи: тайлы экрана и запаса, по нужде. */
  wantNear: { tx: number; ty: number }[];
  nearCapacity: number;
  frame: number;
  view: Rect | null;
}

let session: Session | null = null;

/** Цена работ по видам, мс — стенду (`npm run map:report`, `MOTION=1`): в потоке и в странице. */
const spent: Record<'worker' | 'page', Record<JobKind, number[]>> = {
  worker: { chunk: [], mid: [], near: [], sheet: [] },
  page: { chunk: [], mid: [], near: [], sheet: [] },
};

const key2 = (x: number, y: number): string => `${x}:${y}`;

/** Прямоугольник, расширенный до границ кусков карты. */
function alignToChunks(r: Rect): Rect {
  const x0 = WORLD_ORIGIN.x + Math.floor((r.x - WORLD_ORIGIN.x) / CHUNK) * CHUNK;
  const y0 = WORLD_ORIGIN.y + Math.floor((r.y - WORLD_ORIGIN.y) / CHUNK) * CHUNK;
  const x1 = WORLD_ORIGIN.x + Math.ceil((r.x + r.w - WORLD_ORIGIN.x) / CHUNK) * CHUNK;
  const y1 = WORLD_ORIGIN.y + Math.ceil((r.y + r.h - WORLD_ORIGIN.y) / CHUNK) * CHUNK;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Где снимается земля региона: на все работы плана с их окнами — куски и листы лежат по сетке кусков поверх рамки,
 * тайл ближнего масштаба у каймы выходит за неё на свою сторону, и под каждым — запас окна выпечки (`BAKE_REACH`).
 */
export function snapshotRect(theatre: Theatre): Rect {
  const r = alignToChunks(theatrePlan(theatre).reach);
  const pad = BAKE_REACH + TILE_CELLS;
  return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
}

function startSession(seed: number, theatre: Theatre): Session {
  const plan = theatrePlan(theatre);
  const dataRect = snapshotRect(theatre);
  return {
    seed,
    theatre,
    plan,
    dataRect,
    asked: false,
    land: null,
    coarse: null,
    knowledge: null,
    knowledgeGen: 0,
    dataGen: 0,
    chunkStamps: new Map(),
    checkedAt: -Infinity,
    signs: new Map(),
    gen: 1,
    overview: new Map(),
    mid: new Map(),
    sheets: new Map(),
    near: new Map(),
    inFlight: new Set(),
    failed: new Set(),
    exec: null,
    wantNear: [],
    nearCapacity: 0,
    frame: 0,
    view: null,
  };
}

function endSession(s: Session): void {
  s.exec?.stop();
  for (const m of [s.overview, s.mid, s.near]) for (const e of m.values()) freePicture(e.pic);
  for (const e of s.sheets.values()) freePicture(e.pic);
  if (s.coarse) s.coarse.width = 0;
  setLand(null);
  setKnowledge(null);
}

/**
 * Регион игрока — по клетке его города (раздел 13.3); мира нет — нет и рамки. Он же и регион, в котором кадр,
 * палец и меню меряют «своё» (`theatre.withinActive`): ставится здесь, на каждый вопрос, из одного источника.
 */
export function playerTheatre(): Theatre | null {
  const info = useWorld.getState().info;
  const t = info ? theatreAt(info.home.x, info.home.y) : null;
  setActiveTheatre(t);
  return t;
}

/** Регион игрока по его городу: тот же мир и тот же регион — та же служба; иначе — заново. */
function syncSession(): Session | null {
  const seed = useWorld.getState().info?.seed ?? 0;
  const theatre = playerTheatre();
  if (session && (session.seed !== seed || session.theatre !== theatre)) {
    endSession(session);
    session = null;
  }
  if (!session && seed && theatre) session = startSession(seed, theatre);
  return session;
}

// ---------- Снимок земли, грубый растр, знание ----------

/** Цвет клетки грубого растра — средние тона материалов нового вида. */
const COARSE: Record<string, readonly [number, number, number]> = {
  plain: C.plainSouth,
  forest: C.forestSouth,
  hills: C.hills,
  water: C.deep,
  steppe: C.steppe,
  desert: C.desert,
  mountains: C.rock,
};

function bakeCoarse(g: LandGrid): Canvas {
  const c = makeCanvas(g.rect.w, g.rect.h);
  const ctx = ctxOf(c);
  const img = ctx.createImageData(g.rect.w, g.rect.h);
  const d = img.data;
  for (let k = 0; k < g.terrain.length; k++) {
    const col = COARSE[TERRAIN_ORDER[g.terrain[k]] ?? 'water'] ?? C.deep;
    d[k * 4] = col[0];
    d[k * 4 + 1] = col[1];
    d[k * 4 + 2] = col[2];
    d[k * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * Снимок земли под регионом: заказать куски у мира — один раз на регион, — и снять, когда приехали все. Мир живёт
 * в странице, и заказ — синхронный счёт кусков; он идёт при входе на карту, когда камера ещё стоит.
 */
function initLand(s: Session): void {
  if (!s.asked) {
    s.asked = true;
    useWorld.getState().ensureRegion(s.dataRect);
  }
  const grid = extractLand(s.dataRect);
  if (!grid) return;
  s.land = grid;
  s.coarse = bakeCoarse(grid);
  startExec(s);
}

function startExec(s: Session): void {
  const deliver: Deliver = (job, pic, ms, where) => received(s, job, pic, ms, where);
  const page = (): Executor => new PageExecutor(deliver);
  let exec: Executor;
  if (workersOk()) {
    try {
      exec = new WorkerExecutor(deliver, () => {
        // Поток не умеет рисовать или не поднялся: печёт страница, а работы в потоке — забыты.
        if (session !== s) return;
        s.exec?.stop();
        s.inFlight.clear();
        s.exec = page();
        feed(s, s.exec);
      });
    } catch {
      exec = page();
    }
  } else exec = page();
  s.exec = exec;
  feed(s, exec);
}

/** Отдать исполнителю снимок земли, вид и знание. */
function feed(s: Session, exec: Executor): void {
  if (!s.land) return;
  exec.land(s.land, s.seed, { ...twLook() });
  if (s.knowledge) exec.knowledge(s.knowledge);
}

/**
 * Знание: разведано и в регионе. Пересобирается, только когда куски под снимком приехали заново (их отметка
 * сменилась), и только стоя, не чаще раза в четверть секунды; новое знание — новые подписи листов.
 */
const KNOW_MS = 250;

function refreshKnowledge(s: Session, now: number, force: boolean): void {
  if (!s.land) return;
  if (!force && (moving() || now - s.checkedAt < KNOW_MS)) return;
  s.checkedAt = now;
  const r = s.dataRect;
  let fresh = s.knowledge === null;
  const keys = chunkKeysIn(r);
  for (const { key } of keys) {
    const c = cachedChunk(key);
    const stamp = c ? c.fetchedAt : -1;
    if (s.chunkStamps.get(key) !== stamp) {
      s.chunkStamps.set(key, stamp);
      fresh = true;
    }
  }
  if (!fresh) return;
  s.dataGen++;
  const known = new Uint8Array(r.w * r.h);
  const t = s.theatre;
  for (const { key } of keys) {
    const c = cachedChunk(key);
    if (!c) continue;
    const cr = c.rect;
    for (let y = Math.max(cr.y, r.y); y < Math.min(cr.y + cr.h, r.y + r.h); y++) {
      for (let x = Math.max(cr.x, r.x); x < Math.min(cr.x + cr.w, r.x + r.w); x++) {
        if (c.explored[(y - cr.y) * cr.w + (x - cr.x)] && visibleTo(t, x, y)) known[(y - r.y) * r.w + (x - r.x)] = 1;
      }
    }
  }
  const prev = s.knowledge?.known;
  if (prev && prev.length === known.length && prev.every((v, i) => v === known[i])) return;
  s.knowledge = { rect: r, known };
  s.knowledgeGen++;
  s.failed.clear();
  s.signs.clear();
  for (const { cx, cy } of s.plan.sheets) s.signs.set(key2(cx, cy), signOf(s.knowledge, chunkCells(cx, cy)));
  // Лист, под которым теперь знакомо всё, не нужен вовсе.
  for (const [k, e] of s.sheets) {
    if (s.signs.get(k)?.open) {
      freePicture(e.pic);
      s.sheets.delete(k);
    }
  }
  setKnowledge(s.knowledge);
  s.exec?.knowledge(s.knowledge);
}

// ---------- Работы ----------

function received(s: Session, job: Job, pic: Picture | null, ms: number, where: 'worker' | 'page'): void {
  s.inFlight.delete(jobKey(job));
  if (session !== s) {
    if (pic) freePicture(pic);
    return;
  }
  // Поток не ждёт кадра: следующая работа уходит сразу.
  if (where === 'worker') queueMicrotask(() => session === s && pump(s));
  if (!pic) s.failed.add(jobKey(job));
  if (pic) {
    const list = spent[where][job.kind];
    list.push(ms);
    if (list.length > 400) list.shift();
    if (where === 'page' && job.kind === 'near' && PROBE) bakeCost(ms);
  }
  if (!pic) return;
  const k = key2(job.x, job.y);
  if (job.kind === 'sheet') {
    const want = s.signs.get(k);
    if (!want || want.open || want.sign !== job.sign) {
      freePicture(pic);
      return;
    }
    const old = s.sheets.get(k);
    if (old) freePicture(old.pic);
    s.sheets.set(k, { pic, sign: job.sign ?? 0 });
    return;
  }
  if (job.gen !== s.gen) {
    freePicture(pic);
    return;
  }
  if (job.kind === 'near') {
    const old = s.near.get(k);
    if (old) freePicture(old.pic);
    s.near.set(k, { pic, gen: job.gen, used: s.frame });
    return;
  }
  const map = job.kind === 'chunk' ? s.overview : s.mid;
  const old = map.get(k);
  if (old) freePicture(old.pic);
  map.set(k, { pic, gen: job.gen });
}

/** Тайл ближнего масштаба — только у региона с каймой: за ней лист старой карты закрывает землю целиком. */
function nearInFringe(s: Session, tx: number, ty: number): boolean {
  const o = tileOrigin(tx, ty);
  for (let y = o.y; y < o.y + TILE_CELLS; y++) for (let x = o.x; x < o.x + TILE_CELLS; x++) if (s.plan.fringe(x, y)) return true;
  return false;
}

/** Следующая работа по нужде кадра или null. */
function nextJob(s: Session): Job | null {
  for (const t of s.wantNear) {
    const k = key2(t.tx, t.ty);
    const have = s.near.get(k);
    if (have && have.gen === s.gen) continue;
    if (s.inFlight.has(`near:${k}`) || s.failed.has(`near:${k}`)) continue;
    return { kind: 'near', x: t.tx, y: t.ty, gen: s.gen };
  }
  const view = s.view;
  const cx = view ? view.x + view.w / 2 : s.plan.reach.x + s.plan.reach.w / 2;
  const cy = view ? view.y + view.h / 2 : s.plan.reach.y + s.plan.reach.h / 2;
  let best: Job | null = null;
  let bestScore = Infinity;
  const consider = (kind: JobKind, x: number, y: number, rect: Rect, rank: number, sign?: number): void => {
    const visible = view !== null && rect.x < view.x + view.w && rect.x + rect.w > view.x && rect.y < view.y + view.h && rect.y + rect.h > view.y;
    const dx = rect.x + rect.w / 2 - cx;
    const dy = rect.y + rect.h / 2 - cy;
    const score = (visible ? 0 : 1e9) + rank * 1e8 + dx * dx + dy * dy;
    if (score >= bestScore) return;
    if (s.inFlight.has(`${kind}:${x}:${y}`) || s.failed.has(`${kind}:${x}:${y}`)) return;
    bestScore = score;
    best = { kind, x, y, gen: s.gen, sign };
  };
  for (const { cx: x, cy: y } of s.plan.chunks) {
    const have = s.overview.get(key2(x, y));
    if (!have || have.gen !== s.gen) consider('chunk', x, y, chunkCells(x, y), 0);
  }
  if (s.knowledge) {
    for (const { cx: x, cy: y } of s.plan.sheets) {
      const want = s.signs.get(key2(x, y));
      if (!want || want.open) continue;
      const have = s.sheets.get(key2(x, y));
      if (!have || have.sign !== want.sign) consider('sheet', x, y, chunkCells(x, y), 1, want.sign);
    }
  }
  if (TW_SPEC[twLook().quality].mid) {
    for (const { tx: x, ty: y } of s.plan.mids) {
      const have = s.mid.get(key2(x, y));
      if (!have || have.gen !== s.gen) {
        consider('mid', x, y, { x: WORLD_ORIGIN.x + x * MID_CELLS, y: WORLD_ORIGIN.y + y * MID_CELLS, w: MID_CELLS, h: MID_CELLS }, 2);
      }
    }
  }
  return best;
}

function pump(s: Session): void {
  const exec = s.exec;
  if (!exec) return;
  while (exec.free() > 0) {
    const job = nextJob(s);
    if (!job) return;
    s.inFlight.add(jobKey(job));
    exec.give(job);
  }
}

// ---------- Кадр ----------

/**
 * Начало кадра нового вида: регион, движение, знание, чего хочет кадр вблизи, — и работы исполнителю. Ничего не
 * печёт: поток печёт сам, страница — в `prebakeIdle`, после кадра и стоя.
 */
export function prebakeFrame(cam: Camera, vp: Viewport, frame: number, now = performance.now()): void {
  trackMotion(cam, now);
  const s = syncSession();
  if (!s) return;
  s.frame = frame;
  const view = viewRect(cam, vp);
  s.view = { x: view.x - 2, y: view.y - 2, w: view.w + 4, h: view.h + 4 };
  if (!s.land) {
    // Снимок снимается стоя: при входе на карту камера и так стоит, а в движении кусков не заказывают.
    if (moving() && s.asked) return;
    initLand(s);
    if (!s.land) return;
    refreshKnowledge(s, now, true);
  } else refreshKnowledge(s, now, false);

  // Вблизи — тайлы экрана и запаса, по нужде; лишнее сверх ёмкости уходит, старое первым.
  s.wantNear = [];
  if (detailAlpha(cam.scale) > 0) {
    s.nearCapacity = cacheFor(vp);
    const plan = frameQueue(view, s.nearCapacity);
    if (plan) {
      for (const t of plan.queue) {
        const e = s.near.get(key2(t.tx, t.ty));
        if (e) e.used = frame;
        if (nearInFringe(s, t.tx, t.ty)) s.wantNear.push(t);
      }
    }
  }
  evictNear(s);
  pump(s);
}

function evictNear(s: Session): void {
  const cap = Math.max(s.nearCapacity, 1);
  while (s.near.size > cap) {
    let oldKey: string | null = null;
    let old = Infinity;
    for (const [k, e] of s.near) {
      if (e.used === s.frame) continue;
      if (e.used < old) {
        old = e.used;
        oldKey = k;
      }
    }
    if (!oldKey) return;
    const gone = s.near.get(oldKey);
    if (gone) freePicture(gone.pic);
    s.near.delete(oldKey);
  }
}

/** Конец кадра: страница без потока печёт свою долю — только стоя. */
export function prebakeIdle(budgetMs = PAGE_SLICE_MS): void {
  const s = session;
  if (!s?.exec || s.exec.kind !== 'page' || moving()) return;
  s.exec.step(budgetMs);
  pump(s);
}

/** Уровень или сезон сменились: испечённое устарело — рисуется, пока не приехало новое. */
export function prebakeLook(): void {
  const s = session;
  if (!s) return;
  s.gen++;
  s.failed.clear();
  s.exec?.look({ ...twLook() });
  // Без среднего слоя на этом уровне его тайлы не рисуются — и в памяти не нужны.
  if (!TW_SPEC[twLook().quality].mid) {
    for (const e of s.mid.values()) freePicture(e.pic);
    s.mid.clear();
  }
}

// ---------- Что рисовать ----------

export interface Ground {
  theatre: Theatre;
  plan: TheatrePlan;
  /** Грубый растр снимка и где он лежит. */
  coarse: Canvas | null;
  dataRect: Rect;
  overview: (cx: number, cy: number) => Picture | null;
  mid: (tx: number, ty: number) => Picture | null;
  near: (tx: number, ty: number) => Picture | null;
  /** Нужен ли тайл ближнего масштаба: за каймой региона его не печётся вовсе. */
  nearWanted: (tx: number, ty: number) => boolean;
  sheet: (cx: number, cy: number) => Picture | null;
  knowledge: Knowledge | null;
  knowledgeGen: number;
  /** Растёт, когда куски под регионом приехали заново: по нему растр владений знает, что устарел. */
  dataGen: number;
}

/** Испечённое региона для кадра — или null, пока региона нет. */
export function prebaked(): Ground | null {
  const s = session;
  if (!s) return null;
  return {
    theatre: s.theatre,
    plan: s.plan,
    coarse: s.coarse,
    dataRect: s.dataRect,
    overview: (cx, cy) => s.overview.get(key2(cx, cy))?.pic ?? null,
    mid: (tx, ty) => s.mid.get(key2(tx, ty))?.pic ?? null,
    near: (tx, ty) => s.near.get(key2(tx, ty))?.pic ?? null,
    nearWanted: (tx, ty) => nearInFringe(s, tx, ty),
    sheet: (cx, cy) => s.sheets.get(key2(cx, cy))?.pic ?? null,
    knowledge: s.knowledge,
    knowledgeGen: s.knowledgeGen,
    dataGen: s.dataGen,
  };
}

/** Сколько держит заранее испечённое, байт по слоям — бюджету (раздел 13.6) и стенду. */
export function prebakeMemory(): { overview: number; mid: number; sheets: number; near: number; coarse: number } {
  const s = session;
  const sum = (m: Map<string, { pic: Picture }> | undefined): number => {
    let n = 0;
    if (m) for (const e of m.values()) n += pictureBytes(e.pic);
    return n;
  };
  return {
    overview: sum(s?.overview),
    mid: sum(s?.mid),
    sheets: sum(s?.sheets),
    near: sum(s?.near),
    coarse: s?.coarse ? pictureBytes(s.coarse) : 0,
  };
}

/** Уход с карты: тайлы ближнего масштаба — вон (их печёт камера), заранее испечённый регион остаётся. */
export function dropNear(): void {
  const s = session;
  if (!s) return;
  for (const e of s.near.values()) freePicture(e.pic);
  s.near.clear();
  lastCam = null;
}

/** Всё заново — тестам. */
export function resetPrebake(): void {
  if (session) endSession(session);
  session = null;
  setActiveTheatre(null);
  lastCam = null;
  movedAt = -Infinity;
}

/** Состояние службы — стенду (`npm run map:report`, `MOTION=1`) и тестам. */
export function prebakeState(): {
  exec: 'worker' | 'page' | null;
  ready: boolean;
  plan: { chunks: number; mids: number; sheets: number } | null;
  have: { chunk: number; mid: number; sheet: number; near: number };
  inFlight: number;
  pageSteps: number;
  spent: typeof spent;
} {
  const s = session;
  return {
    exec: s?.exec?.kind ?? null,
    ready: !!s?.land,
    plan: s ? { chunks: s.plan.chunks.length, mids: s.plan.mids.length, sheets: s.plan.sheets.length } : null,
    have: { chunk: s?.overview.size ?? 0, mid: s?.mid.size ?? 0, sheet: s?.sheets.size ?? 0, near: s?.near.size ?? 0 },
    inFlight: s?.inFlight.size ?? 0,
    pageSteps,
    spent,
  };
}

if (PROBE && typeof window !== 'undefined') {
  (window as unknown as { __twPrebake?: () => unknown }).__twPrebake = () => ({ ...prebakeState(), memory: prebakeMemory() });
}

