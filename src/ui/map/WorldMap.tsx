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
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { useRoster } from '@/net/roster';
import { useGame } from '@/game/store';
import { CHEATS_ON } from '@/cheats';
import { SpeedButton } from '../SpeedButton';
import { cameraAnchor, figuresOn, marchOn, useWorld, worldNow } from '@/world/store';
import { WORLD_VIEW, freeCamera, frameCost, probe } from '@/debug';
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
  WORLD_ORIGIN,
  WORLD_SIZE,
} from '@/world/data/tuning';
import type { Coord, Fate } from '@/world/types';
import { PALETTE, SCALE_DETAIL, SCALE_MIN, SCALE_OVERVIEW, SCALE_START, TILE_CELLS, TILE_MARGIN } from './const';
import {
  type Camera,
  type Viewport,
  clampCamera,
  leashCamera,
  modeFor,
  panBy,
  scaleTo,
  toScreen,
  toWorld,
  viewRect,
  zoomAt,
} from './grid';
import { dropPaper, drawFrame } from './frame';
import { dropTiles } from './ground';
import { dropBitmaps } from './tiles';
import { type Look, dropSprites, silhouetteUrl } from './village';
import { dropPaint } from './paint';
import { dropFog } from './fog';
import { dropZones } from './zones';
import { dropParties } from './party';
import { FELL_WORDS, WORKS_STEPS, dropSiegeMarks, fellUrl, worksUrl } from './siegemark';
import { bakeAgent } from './agent';
import { dropFigures } from './figures';
import { ActionMenu } from './ActionMenu';
import { Gesture, WHEEL_STEP, swallowGhostClick, type Press } from '@/gestures';
import { gestLog, type End } from '@/gestlog';
import { FrameLoop, pixelRatio } from '@/render/loop';
import { Icon } from '@/ui/icons/Icon';


/** Отладочный обзор читается один раз: адрес по ходу партии не меняется. */
const FREE_CAMERA = freeCamera();

/**
 * Стенд бюджета кадра (`npm run map:report`) смотрит? Читается один раз, и в
 * кадре от этого остаётся одна проверка булева: часы карта заводит только под
 * стендом. Мерить кадр иначе нечем — снаружи видна только частота, а она упёрта
 * в шестьдесят и запаса не показывает.
 */
const PROBE = probe();

/**
 * Наводка лупы: сколько клеток тумана вокруг двора заказать и сколько раз
 * пробовать навестись, пока они едут. Куски приезжают в первую секунду, дюжины
 * проб хватает с запасом, а больше их быть не должно: недостижимую цель иначе
 * догоняли бы вечно, перебивая игроку его же панораму.
 */
const SPOT_REGION = 24;
const SPOT_TRIES = 12;

/**
 * Легенда показывает те же силуэты, что и полотно, а не эмодзи: значки стадий с
 * карты ушли, когда поселения стали рисоваться, и картинка в легенде обязана
 * совпадать с картинкой на земле. Замок стоит на стадии деревни нарочно — он
 * бывает при любой, и именно этим опасен: кучка хижин в каменной стене.
 */
const LEGEND_ROWS: { look: Look; name: string; note?: string }[] = [
  ...Object.values(STAGE_BY_ID).map((s) => ({
    look: {
      stage: s.id,
      relation: 'neutral',
      mine: false,
      variant: 0,
      castle: false,
      ruin: false,
      sacked: false,
    } as Look,
    name: s.name,
  })),
  {
    look: {
      stage: 'village',
      relation: 'neutral',
      mine: false,
      variant: 0,
      castle: true,
      ruin: false,
      sacked: false,
    },
    name: 'Замок',
    note: 'город живого игрока, бывает при любой стадии',
  },
  {
    look: {
      stage: 'stronghold',
      relation: 'barbarian',
      mine: false,
      variant: 0,
      castle: false,
      ruin: false,
      sacked: false,
    },
    name: 'Стоянка варваров',
    note: 'шатры и терновая дуга вместо стены',
  },
  {
    look: {
      stage: 'camp',
      relation: 'barbarian',
      mine: false,
      variant: 0,
      castle: false,
      ruin: true,
      sacked: false,
    },
    name: 'Пепелище',
    note: 'сожжённое логово; занять нельзя, след сойдёт сам',
  },
];

/**
 * Легенда говорит только о том, что на карте бывает сегодня. На ней логова и замки живых
 * игроков, и больше ничего: союзников и врагов нет (договариваться не с кем), разорённых
 * дворов нет (логово на победе сгорает), владений нет (зоны влияния считаются от станов, а
 * станов нет), сожжённых городов нет («сжечь» миру не предлагается), трактов нет (они
 * соединяли станы). Механики целы и спят (`grep -rn waitsForPlayers src`); строки о них
 * вернутся вместе с живыми соседями. Легенда, обещающая то, чего игрок не встретит, учит его
 * неправде — «Тракт ×0.62» висел в ней, когда трактов в мире не было ни одного.
 */
const SHOWN_RELATIONS = RELATION_ORDER.filter((r) => r !== 'ally' && r !== 'enemy');
const SHOWN_FATES = (Object.keys(FELL_WORDS) as Fate[]).filter((f) => f !== 'burn');

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
];

export function WorldMap() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coordRef = useRef<HTMLElement>(null);
  /**
   * Камера до приезда `info`. Середина сетки на настоящей карте — это Адриатика,
   * и первый кадр показал бы игроку море вместо его двора. Кадров этих один-два
   * (ниже камера встаёт на дом), но пустое море в них читается как сломанная
   * карта, поэтому начинаем с чёрного: туман честнее чужого берега.
   */
  const cam = useRef<Camera>({
    cx: WORLD_ORIGIN.x + WORLD_SIZE / 2,
    cy: WORLD_ORIGIN.y + WORLD_SIZE / 2,
    scale: SCALE_START,
  });
  const placed = useRef(false);
  /**
   * Наводка лупы: куда, сколько раз пробовали и удалось ли.
   *
   * Проб несколько потому, что с первого раза не выходит: потолок отдаления
   * считается по **приехавшему** туману, а на первом кадре не приехало ничего —
   * `reach` нулевой, карту не отпускают никуда, и до соседа в восьми клетках
   * камера не дотягивается. Куски приезжают в первую секунду, и с каждым
   * приездом наводка повторяется, пока двор не ляжет в кадр. Число проб
   * ограничено: недостижимую цель иначе догоняли бы вечно, перебивая игроку
   * его же панораму.
   */
  const spotted = useRef<{ key: string; tries: number; done: boolean } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; mx: number; my: number } | null>(null);
  /**
   * Разбор жеста — тот же класс, что судит тап в деревне (`src/gestures.ts`).
   * Общий он именно потому, что палец один: два разбора одного жеста однажды
   * уже разошлись. Щипок карта считает сама — это её собственная камера, а не
   * общая часть.
   */
  const touch = useRef(new Gesture());
  /**
   * Журнал касаний ведут оба холста, и это не украшение: жалоба звучала как «на
   * карте работает, в деревне нет», и разобрать её можно только по одному
   * журналу на двоих.
   */
  const touchStart = useRef<{ cam: Camera; fingers: number } | null>(null);
  const size = useRef({ w: 1, h: 1, dpr: 1 });
  const frameNo = useRef(0);

  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpText, setJumpText] = useState('');
  const [legendOpen, setLegendOpen] = useState(false);
  const [zoomedIn, setZoomedIn] = useState(modeFor(SCALE_START) === 'detail');

  const info = useWorld((g) => g.info);
  // Свежесть общего реестра — не свойство карты и не свойство поселения: это
  // про то, когда мы в последний раз спрашивали сервер. Отсюда и своя строка.
  const roster = useRoster();
  const rosterOld = roster.state === 'stale' || (roster.state === 'off' && roster.why !== '');
  const marchCount = useWorld((g) => g.marches.filter((m) => m.own).length);
  const unread = useWorld((g) => g.unread);
  const picked = useWorld((g) => g.picked);
  const anchor = useWorld((g) => g.anchor);
  const setAnchor = useWorld((g) => g.setAnchor);
  const spotlight = useWorld((g) => g.spotlight);
  const chunks = useWorld((g) => g.chunks);
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

  // Первый кадр — над своей деревней. Масштаб не самый близкий (`SCALE_START`,
  // почему — там же): на ближнем экран вокруг деревни был бы пустой травой.
  useEffect(() => {
    if (!info || placed.current) return;
    placed.current = true;
    cam.current = { ...cam.current, scale: SCALE_START };
    setZoomedIn(modeFor(SCALE_START) === 'detail');
    centerOn(info.home);
  }, [info]);

  /**
   * Лупа из письма: показать двор, приславший гонца.
   *
   * Новых прав камере это не даёт. Она по-прежнему привязана к своим и заперта
   * поводком (`hold`), поэтому до чужого двора дотягиваются единственным
   * законным способом — отходя: чем он дальше, тем мельче масштаб. Масштаб
   * поэтому подбирается перебором сверху вниз, а не формулой: в формулу
   * пришлось бы вписать и поводок, и потолок отдаления, и высоту выезжающей
   * карточки, и разошлась бы она с ними при первой же правке любого из трёх.
   *
   * Не дотянулись — берётся самый дальний из допустимых видов: двор окажется у
   * кромки, но на экране, и пульс покажет, где именно. Молча оставить камеру на
   * месте нельзя — кнопка выглядела бы сломанной.
   */
  const showSpot = (c: Coord): boolean => {
    const { w, h } = size.current;
    const fits = (cand: Camera): boolean => {
      const [px, py] = toScreen(cand, { w, h }, c.x + 0.5, c.y + 0.5);
      // Снизу выезжает карточка клетки, сверху стоит шапка карты: годным
      // считается только то, что легло между ними и не в самую кромку.
      return px >= 48 && px <= w - 48 && py >= 110 && py <= h * 0.42;
    };
    let best: Camera | null = null;
    let last = cam.current;
    for (let scale = SCALE_DETAIL; scale > SCALE_MIN; scale /= 1.25) {
      // Карточка занимает низ экрана, поэтому клетку ставим в верхнюю четверть —
      // тем же смещением, что и обычный тап по карте (`focusOn`).
      last = hold({ ...cam.current, scale, cx: c.x + 0.5, cy: c.y + 0.5 + (h * 0.24) / scale });
      if (fits(last)) {
        best = last;
        break;
      }
    }
    cam.current = best ?? last;
    setZoomedIn(modeFor(cam.current.scale) === 'detail');
    return best !== null;
  };


  // Новый мир — новая земля: испечённое держать нельзя, оно от старого сида.
  const seed = info?.seed ?? 0;
  useEffect(() => {
    dropTiles();
    dropBitmaps();
    dropSprites();
    dropPaint();
    dropPaper();
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

    /*
     * Цепочка кадров — через дверь кадра (`render/loop.ts`): потолок частоты и
     * остановка в скрытой странице и в свёрнутой аппке там.
     *
     * Своя причина стоять у полотна одна — `covered`: слой карты скрыт. Так
     * бывает под роликом о бое, открытым с карты (`body.replaying` прячет всё,
     * кроме канвы ролика), и прежде карта рисовала весь кадр под ним впустую.
     */
    const loop = new FrameLoop<'covered'>(() => frame());

    const resize = (): void => {
      // Больше двойки не берём (потолок двери кадра, `loop.DPR_CAP`): на телефоне это
      // больше пикселей — квадратом плотности — ради разницы, которой не видно, и во
      // столько же больше памяти под тайлы.
      const dpr = pixelRatio();
      loop.block('covered', wrap.clientWidth < 1 || wrap.clientHeight < 1);
      const w = wrap.clientWidth || 1;
      const h = wrap.clientHeight || 1;
      const changed = dpr !== size.current.dpr;
      size.current = { w, h, dpr };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      // Окно уехало на другой монитор — испечённое осталось в прежней плотности.
      if (changed) {
        dropSprites();
        dropSiegeMarks();
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // Кисть агента наружу — стенду (`npm run map:report`, раздел «агенты»). Он
    // печёт четыре силуэта своими руками и считает, насколько их пятна
    // совпадают: с уходом подписей это единственное, чем держится опознание, а
    // держится оно или нет — вопрос числа, а не мнения. Растеризовать пути
    // без браузера нечем, поэтому мерить это можно только здесь и только под
    // `?probe=1` — в игре от строки остаётся проверка булева.
    if (PROBE) (window as unknown as { __bakeAgent?: typeof bakeAgent }).__bakeAgent = bakeAgent;

    // Камера наружу — стенду снимков (`npm run map:shots`). Он ставит кадр на
    // названную клетку и масштаб и снимает картинку: «до» и «после» сравнивают
    // одним и тем же кадром, а водить пальцем до той же точки нечем. Поводок и
    // потолок отдаления при этом на месте — через тот же `hold`, что и жест:
    // стенд снимает карту, а не другой её режим. Только под `?probe=1`.
    if (PROBE) {
      (window as unknown as { __mapCam?: (x: number, y: number, scale: number) => void }).__mapCam = (x, y, scale) => {
        cam.current = hold({ cx: x + 0.5, cy: y + 0.5, scale });
        setZoomedIn(modeFor(cam.current.scale) === 'detail');
      };
    }

    const frame = (): void => {
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
      const t0 = PROBE ? performance.now() : 0;
      drawFrame(ctx, cam.current, { w, h }, dpr, ++frameNo.current);
      if (PROBE) frameCost(performance.now() - t0);

      // В шапке всегда координата под серединой экрана: она отвечает на вопрос
      // «где я сейчас». Координата выбранной клетки живёт в её карточке.
      if (coordRef.current) {
        const text = formatCoord({ x: Math.floor(cam.current.cx), y: Math.floor(cam.current.cy) });
        if (coordRef.current.textContent !== text) coordRef.current.textContent = text;
      }
    };
    loop.restart();
    return () => {
      loop.stop();
      ro.disconnect();
      // Уходим с карты — холсты кэша земли в памяти держать незачем.
      dropTiles();
      // Отряды и силуэты агентов от сида не зависят, поэтому в уборку по новому
      // миру они не входят; а вот держать их между заходами на карту незачем —
      // печутся они за доли миллисекунды.
      dropParties();
      dropFigures();
      dropSiegeMarks();
    };
    // Полотно живёт весь показ карты: данные оно берёт из стора само.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Лупа из письма наводит камеру. Стоит эффект после кадрового нарочно:
   * размер полотна меряет он, а до него мерить нечего — `size` до первого
   * `resize` это единица на единицу, и подобранный по ней масштаб не значил бы
   * ничего.
   */
  useEffect(() => {
    if (!spotlight || !info || size.current.w <= 1) return;
    const key = formatCoord(spotlight);
    if (spotted.current?.key !== key) {
      spotted.current = { key, tries: 0, done: false };
      // Камера возвращается к деревне: письмо приходит от соседа, а сосед стоит
      // в пределах поводка деревни, а не идущей неизвестно где фигуры.
      placed.current = true;
      setAnchor('home');
      // Куски вокруг двора заказываем сами: кадр просит только то, что видит, а
      // туман вокруг цели нужен раньше, чем камера туда доедет.
      useWorld.getState().ensureRegion({
        x: spotlight.x - SPOT_REGION,
        y: spotlight.y - SPOT_REGION,
        w: SPOT_REGION * 2,
        h: SPOT_REGION * 2,
      });
    }
    const naming = spotted.current;
    if (!naming.done && naming.tries < SPOT_TRIES) {
      naming.tries += 1;
      naming.done = showSpot(spotlight);
    }
    // Карточка двора открывается не сразу, а когда приедет кусок карты с ним:
    // до этого `settlementAt` про поселение не знает, и на месте соседа
    // открылась бы «пустая земля». Кусок заказан кадром, и приезд его считает
    // `chunks` — на нём эффект и просыпается второй раз.
    const g = useWorld.getState();
    if (g.selected && g.selected.x === spotlight.x && g.selected.y === spotlight.y) return;
    if (!settlementAt(spotlight.x, spotlight.y)) return;
    void g.select(spotlight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotlight, info, chunks]);

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
    // Второй палец снимает тап сам: это уже щипок (см. `Gesture`).
    touch.current.down(e.pointerId, p.x, p.y, performance.now());
    gesture.current = null;
    const was = touchStart.current;
    touchStart.current = {
      cam: pointers.current.size === 1 || !was ? cam.current : was.cam,
      fingers: Math.max(pointers.current.size, was?.fingers ?? 0),
    };
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
      return;
    }

    const now = performance.now();
    touch.current.move(e.pointerId, p.x, p.y, now);
    // Порог у камеры и у тапа теперь один — тот же `Gesture`, что в деревне.
    // Мёртвую зону `TAP_MOVE` на глаз не отличить, а вот два разных
    // правила на двух холстах игрок замечает сразу.
    if (touch.current.panning(now)) cam.current = panBy(cam.current, p.x - prev.x, p.y - prev.y);
  };

  const onPointerCancel = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const press = touch.current.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
    note(press?.id === e.pointerId ? press : null, 'отменено браузером', null);
    touch.current.cancel(e.pointerId);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const now = performance.now();
    const p = pointers.current.get(e.pointerId);
    const press = touch.current.current;
    const own = press?.id === e.pointerId ? press : null;
    const multi = touch.current.multi;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
    const tapped = touch.current.up(e.pointerId, now);
    // Жест судится по пути, а не по точке отпускания: на телефоне она прыгает,
    // когда пятно контакта схлопывается (см. `gestures.Press`). А вот клетку
    // выбирает именно последняя точка — панорама карты идёт за пальцем один к
    // одному, и в сдвинутом кадре она означает ровно то же место, что нажатие.
    const world = p && tapped ? toWorld(cam.current, vp(), p.x, p.y) : null;
    const c = world ? { x: Math.floor(world.x), y: Math.floor(world.y) } : null;
    const inside =
      c !== null &&
      c.x >= WORLD_ORIGIN.x &&
      c.y >= WORLD_ORIGIN.y &&
      c.x < WORLD_ORIGIN.x + WORLD_SIZE &&
      c.y < WORLD_ORIGIN.y + WORLD_SIZE;
    note(
      own,
      tapped ? (inside ? 'тап' : 'мимо') : !own || multi ? 'два пальца' : own.moved ? 'ведение' : 'долгое',
      inside && c ? formatCoord(c) : null,
    );
    if (!inside || !c) return;
    // Тот же призрачный щелчок, что и в деревне: карточка клетки поднимает то же
    // затемнение, и закрыть её собственным касанием она не должна.
    swallowGhostClick();
    openAt(c);
  };

  /**
   * Запись в общий журнал касаний. Сдвиг картинки честно считается только там,
   * где масштаб не менялся: после щипка «на сколько уехало» — вопрос без
   * единственного ответа, и вместо числа тут стоит «не знаю».
   */
  const note = (press: Press | null, end: End, hit: string | null): void => {
    const from = touchStart.current;
    const same = from && from.cam.scale === cam.current.scale;
    gestLog.add({
      where: 'карта',
      fingers: from?.fingers ?? 1,
      ms: press ? performance.now() - press.t : 0,
      far: press ? press.far : 0,
      path: press ? press.path : 0,
      end,
      hit,
      drift:
        from && same
          ? Math.hypot(from.cam.cx - cam.current.cx, from.cam.cy - cam.current.cy) * cam.current.scale
          : null,
    });
    if (pointers.current.size === 0) touchStart.current = null;
  };

  /**
   * Куда ведёт одиночный тап. Двойного тапа здесь нет и быть не может — в
   * браузере это масштабирование, — поэтому все три смысла разведены по тому,
   * что под пальцем и есть ли агент в руке:
   *
   * - агент в руке и под пальцем цель (или он сам) — меню приказов;
   * - агент в руке и под пальцем земля — приказ идти (прежнее поведение, и
   *   трогать его нельзя: разведка — это десяток шагов подряд в темноту);
   * - без агента в руке — своя фигура в поле берётся в руку, а поселение
   *   открывает карточку.
   */
  const openAt = (c: Coord): void => {
    const g = useWorld.getState();
    const hand = g.picked;
    const target = settlementAt(c.x, c.y);
    const standing = figuresOn(c.x, c.y, worldNow());
    // Чужой отряд в поле — такая же цель, как поселение: по нему тоже приказ.
    const enemy = marchOn(g.marches, c, worldNow());
    if (hand) {
      if (target || enemy || standing.some((f) => f.id === hand)) {
        void g.openMenu(hand, c);
        return;
      }
      // Из руки фигура не выпадает: заново брать её после каждого шага было бы
      // мучением. Отпускают её кнопкой в подсказке или переходом на другой якорь.
      void (async () => {
        const err = await moveFigure(hand, c);
        showToast(err ?? `${FIGURE_BY_ID[hand].name} пошёл к ${formatCoord(c)}.`);
      })();
      return;
    }
    if (!target && enemy) {
      void g.openChase(enemy);
      return;
    }
    if (!target && standing.length > 0) {
      const f = standing[0];
      setAnchor(f.id);
      pickFigure(f.id);
      showToast(`${f.name} выбран: тапни по клетке — пойдёт туда.`);
      return;
    }
    void useWorld.getState().select(c);
    focusOn(c);
  };

  /**
   * Правая кнопка — то же меню. Это подарок десктопу: всё, что делается ею,
   * делается и одним тапом, иначе на телефоне часть игры была бы недоступна.
   */
  const onContextMenu = (e: ReactMouseEvent<HTMLCanvasElement>): void => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const world = toWorld(cam.current, vp(), e.clientX - rect.left, e.clientY - rect.top);
    const c = { x: Math.floor(world.x), y: Math.floor(world.y) };
    if (c.x < WORLD_ORIGIN.x || c.y < WORLD_ORIGIN.y) return;
    if (c.x >= WORLD_ORIGIN.x + WORLD_SIZE || c.y >= WORLD_ORIGIN.y + WORLD_SIZE) return;
    const g = useWorld.getState();
    const agent = g.picked ?? figuresOn(c.x, c.y, worldNow())[0]?.id ?? (g.anchor === 'home' ? 'diplomat' : g.anchor);
    void g.openMenu(agent, c);
  };

  const onWheel = (e: ReactWheelEvent<HTMLCanvasElement>): void => {
    // Шаг колеса — общий с деревней (`WHEEL_STEP`): холста два, а мышь одна.
    const rect = e.currentTarget.getBoundingClientRect();
    applyZoom(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP);
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
        onPointerCancel={onPointerCancel}
        onContextMenu={onContextMenu}
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
        {FREE_CAMERA && (
          <button className={`wm-btn${jumpOpen ? ' active' : ''}`} onClick={() => setJumpOpen((v) => !v)} aria-label="Перейти к координатам">
            ⌖
          </button>
        )}
        {/* Легенда — в правом верхнем углу, единственном пустом месте карты.
            Пустого места на 360 px не бывает про запас: внизу и так три ряда, а
            справа сверху не стояло ничего, кроме распорки под кнопку отладки.
            Сама легенда при этом осталась внизу — это лист, а не выпадашка, и
            листы в этой игре выезжают снизу (`Sheet`). */}
        {/* Скорость проверки видна и на карте: поход проверяют здесь. Только под выключателем кодов. */}
        {CHEATS_ON && <SpeedButton className="wm-btn" />}
        <button
          className={`wm-btn${legendOpen ? ' active' : ''}`}
          onClick={() => setLegendOpen((v) => !v)}
          aria-label="Легенда"
        >
          ℹ️
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

      <ActionMenu />

      {/* Нижний ярус карты — одна колонка, прижатая ко дну над строкой кнопок:
          строка про устаревший реестр и подсказка про фигуру в руке. Раз они в
          одном потоке, наехать друг на друга им нечем. Своего угла у агентов
          здесь больше нет: список агентов, их сроки и «взять на карту» живут в
          «Походах» — вторая кнопка под то же дело была лишней. Столбик писем и
          панель осады сюда не приходят: обе живут в деревне и на карте не
          рисуются вовсе (см. `App.tsx`). */}
      <div className="wm-bottom">
        {/* Список соседей не приезжал давно — так и сказано. Молчать нельзя:
            замки на карте при этом видны, и без этой строки игрок читал бы
            вчерашнее как сегодняшнее. Одна строка на весь низ, и появляется она
            только когда есть о чём говорить. */}
        {rosterOld && (
          <div className="wm-hint stale">
            <span>{roster.why || 'Список соседей давно не обновлялся: чужие замки показаны по памяти.'}</span>
          </div>
        )}

        {picked && (
          <div className="wm-hint">
            <span>Тапни по земле — {FIGURE_BY_ID[picked].name} пойдёт туда, по поселению — приказы.</span>
            <button onClick={() => pickFigure(null)}>Отпустить</button>
          </div>
        )}
      </div>

      {legendOpen && (
        <div className="wm-legend">
          <h3>Кто на карте</h3>
          {SHOWN_RELATIONS.map((r) => (
            <div className="wm-leg-row" key={r}>
              {/* Форма несёт смысл, цвет её подтверждает: цветной квадратик,
                  который стоял здесь раньше, на цветовую слепоту не рассчитан вовсе. */}
              <Icon name={`rel-${r}`} glyph="▪" className="wm-leg-flag" />
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
          {/* Осада и взятые города — теми же картинками, что на полотне (`siegemark.ts`). */}
          <h3>Осада и взятые города</h3>
          <div className="wm-leg-row wm-leg-shape">
            <img src={worksUrl(WORKS_STEPS, 0)} alt="" />
            <span>
              Рогатки со стороны города <em>ближний ряд, колья к городу: так бьют вылазку</em>
            </span>
          </div>
          <div className="wm-leg-row wm-leg-shape">
            <img src={worksUrl(0, WORKS_STEPS)} alt="" />
            <span>
              Рогатки с тыла <em>дальний ряд, колья в поле: так встречают полководца; редкий ряд — ещё строят</em>
            </span>
          </div>
          {SHOWN_FATES.map((fate) => (
            <div className="wm-leg-row wm-leg-fell" key={fate}>
              <img src={fellUrl(fate)} alt="" />
              <span>
                <em>город взят и {FELL_WORDS[fate]}; знак сходит через сутки</em>
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

          <button className="btn ghost wide" onClick={() => setLegendOpen(false)}>
            Понятно
          </button>
        </div>
      )}

      <div className="wm-foot">
        {/* «Домой» — он же якорь камеры на своей деревне: прежний чип «деревня»
            в ряду фигур делал ровно это, и второй кнопки под одно дело быть не
            должно. Подсветка говорит, на чём камера стоит. */}
        <button className={`wm-btn wide${anchor === 'home' ? ' active' : ''}`} onClick={goHome}>
          🏠 <span>Домой</span>
        </button>
        <button className="wm-btn wide" onClick={openMarches}>
          ⚔️ <span>Походы</span>
          {(marchCount > 0 || unread > 0) && <em>{marchCount > 0 ? marchCount : unread}</em>}
        </button>
        <button className="wm-btn" onClick={toggleZoom} aria-label="Сменить масштаб">
          {zoomedIn ? '🔭' : '🔍'}
        </button>
      </div>
    </div>
  );
}
