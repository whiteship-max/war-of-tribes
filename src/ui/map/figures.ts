// Фигуры игрока на полотне. Рисуются последними — после тумана и походов:
// фигура не может оказаться под дымкой, которую сама же и разгоняет.
//
// **Каждый агент узнаётся силуэтом** (`agent.ts`), а не цветом и не значком в
// одинаковом кружке: разведчик низкий и в широкой шляпе, дипломат — колокол
// подола, лазутчик — узкий шип капюшона, полководец — плечи и гребень. Кружки с
// эмодзи, стоявшие здесь раньше, различались только глифом, а глиф на двадцати
// пикселях — пятно.
//
// Спрайт **испечён** и стоит один `drawImage`; подпись под фигурой — тоже
// спрайт. Раскладка текста в браузере дороже копирования картинки, и платить за
// неё шестьдесят раз в секунду не за что: имён четыре, и они не меняются.
//
// Полководец с войском рисуется **колонной** (`party.ts`), а сам он встаёт в
// хвосте её (или сбоку от лагеря) — не поверх и не над. Это не украшение: армия
// ходит только с полководцем, и до сих пор сотня бойцов на карте выглядела так
// же, как дипломат с письмом.
import { RELATION_META } from '@/world/data/meta';
import { formatLeft, secondsLeft } from '@/world/geo';
import { figurePosition } from '@/world/store';
import type { FigureView } from '@/world/types';
import { type Camera, type Viewport, toScreen } from './grid';
import { LABEL_H, agentUnit, drawAgent, dropAgents, fanOffsets, labelSprite } from './agent';
import { drawHeading, drawParty, lookOf as partyLook, partyMen } from './party';

/** Цвет фигуры — тот же, что у своего поселения: это всё «своё». */
const OWN = RELATION_META.self.color;
const INK = 'rgba(10, 8, 6, 0.85)';

/**
 * Круг обзора выбранной фигуры. Показывается только у той, что в руке: четыре
 * кольца разом превратили бы карту в мишень.
 */
function drawSight(ctx: CanvasRenderingContext2D, sx: number, sy: number, r: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = 'rgba(232, 164, 60, 0.55)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

/**
 * Кольцо под ногами у той фигуры, что в руке. Выделение — не опознание, поэтому
 * ему цвет и позволен: силуэт при этом остаётся тем же самым, и «кто это»
 * по-прежнему читается формой, а не подсветкой.
 */
function drawPicked(ctx: CanvasRenderingContext2D, sx: number, sy: number, unit: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(sx, sy, unit * 0.3, unit * 0.3 * 0.55, 0, 0, Math.PI * 2);
  ctx.strokeStyle = OWN;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

/** Пунктир до цели и таймер прибытия — то же, что у похода: правило одно. */
function drawRoute(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vp: Viewport,
  f: FigureView,
  px: number,
  py: number,
  now: number,
): void {
  const [tx, ty] = toScreen(cam, vp, f.to.x + 0.5, f.to.y + 0.5);
  ctx.save();
  ctx.setLineDash([3, 5]);
  // Пунктир бежит к цели: у своих фигур направление и есть главный вопрос к
  // карте, а бег отвечает на него, не занимая ни пикселя разметки.
  ctx.lineDashOffset = -((now / 60) % 8);
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = OWN;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(tx, ty);
  ctx.stroke();
  ctx.restore();

  const left = formatLeft(secondsLeft(f.arriveAt, now));
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineWidth = 3;
  ctx.strokeStyle = INK;
  ctx.strokeText(left, tx, ty - 10);
  ctx.fillStyle = OWN;
  ctx.fillText(left, tx, ty - 10);
}

// ---------- Где кто стоит ----------

interface Spot {
  f: FigureView;
  /** Экранная точка, на которой стоит отряд — он же середина клетки. */
  px: number;
  py: number;
  /**
   * Где стоит **сам агент**. Отличается от `px` только у полководца с войском:
   * он отходит от колонны, и подпись обязана уехать за ним — иначе имя окажется
   * под шатрами, а не под тем, кого называет.
   */
  ax: number;
  /** Точка её цели: из неё выводится и направление, и наконечник хода. */
  tx: number;
  ty: number;
  unit: number;
  west: boolean;
  /** Сколько людей при нём и стоит ли он лагерем: колонну рисуют по ним. */
  men: number;
  standing: boolean;
}

/**
 * Точки всех живых фигур разом — и для силуэтов, и для подписей. Считается один
 * раз на кадр и одним кодом: две правды о том, где стоит фигура, разъехались бы
 * ровно на разведение по клетке, и подпись уехала бы к соседу.
 *
 * Павшая не попадает сюда вовсе: её нет на карте, она возвращается домой, и это
 * видно в её карточке, а не пустым кружком в поле.
 */
function spotsOf(cam: Camera, vp: Viewport, figures: FigureView[], now: number): Spot[] {
  const live = figures.filter((f) => f.phase !== 'down');
  const unit = agentUnit(cam.scale);
  // Разводятся стоящие на одной клетке: четверо дома иначе рисуются друг в
  // друге, и видно одного.
  const fan = fanOffsets(
    live.map((f) => {
      const at = figurePosition(f, now);
      return `${Math.round(at.x)}|${Math.round(at.y)}`;
    }),
  );
  return live.map((f, i) => {
    const at = figurePosition(f, now);
    const [raw, py] = toScreen(cam, vp, at.x + 0.5, at.y + 0.5);
    const px = raw + fan[i] * unit;
    const [tx, ty] = toScreen(cam, vp, f.to.x + 0.5, f.to.y + 0.5);
    const west = tx < px;
    // Полководец при войске отходит от колонны: в хвосте у идущей, сбоку от
    // лагеря. Ставить его поверх колонны нельзя — силуэт, ради которого всё и
    // затевалось, потерялся бы среди своих же; а поднимать над ней, как прежний
    // кружок, значит подвесить человека в воздух.
    const men = partyMen(f.troops);
    const standing = f.phase === 'field';
    const aside = men === 0 ? 0 : standing ? unit * 0.66 : (west ? 1 : -1) * unit * 0.6;
    return { f, px, ax: px + aside, py, tx, ty, unit, west, men, standing };
  });
}

const onScreen = (s: Spot, vp: Viewport): boolean =>
  s.px > -60 && s.py > -60 && s.px < vp.w + 60 && s.py < vp.h + 60;

/** Все четыре фигуры: обзор в руке, дорога, войско при полководце и силуэт. */
export function drawFigures(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vp: Viewport,
  figures: FigureView[],
  picked: string | null,
  now: number,
  dpr: number,
): void {
  for (const spot of spotsOf(cam, vp, figures, now)) {
    if (!onScreen(spot, vp)) continue;
    const { f, px, ax, py, tx, ty, unit, west, men, standing } = spot;
    const chosen = picked === f.id;
    if (chosen) drawSight(ctx, px, py, f.sight * cam.scale);
    if (f.phase === 'moving') drawRoute(ctx, cam, vp, f, px, py, now);

    // Войско при полководце — та же колонна, что у похода, и тем же кодом: две
    // правды о том, как выглядит своя армия, разошлись бы при первой же правке.
    if (men > 0) {
      // Лагерь ставят в чистом поле — там же, где садятся в осаду. Дома войско
      // стоит колонной у ворот: шатры посреди своей деревни читались бы осадой
      // собственного двора.
      drawParty(
        ctx,
        partyLook({ own: true, units: f.troops, standing, seen: true, west }),
        cam.scale,
        dpr,
        px,
        py,
      );
      if (f.phase === 'moving') {
        const angle = Math.atan2(ty - py, tx - px);
        const lead = cam.scale * 0.62;
        drawHeading(ctx, 'own', dpr, px + Math.cos(angle) * lead, py + Math.sin(angle) * lead, angle, unit * 0.26);
      }
    }
    if (chosen) drawPicked(ctx, ax, py, unit);
    drawAgent(ctx, { kind: f.id, west }, unit, dpr, ax, py);
  }
}

// ---------- Подписи ----------

/** Занятое подписью место. Тот же прямоугольник, каким меряются имена дворов. */
export interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Насколько подпись опускается, наткнувшись на занятое место, и сколько раз. */
const STACK_STEP = LABEL_H;
const STACK_TRIES = 4;

const hits = (box: Slot, taken: Slot[]): boolean =>
  taken.some((b) => box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y);

/**
 * Подпись под фигурой — **кто это**, а не где он. «Дома» и «в поле» игрок и так
 * видит: фигура нарисована ровно там, где стоит. А вот который из четырёх это —
 * силуэт говорит быстро, но не безошибочно, и имя закрывает остаток.
 *
 * Наезжать подписям нельзя, и обрезать их на полуслове — тоже (это мы уже
 * чинили в письмах). Поэтому подпись, наткнувшаяся на занятое место, **опускается
 * строкой ниже** и пробует снова: четверо дома дают четыре строки лесенкой, а
 * не кашу. Не нашла места и после четырёх попыток — не рисуется вовсе, тем же
 * правилом, каким молчат имена тесно стоящих дворов.
 *
 * Место она делит с именами поселений (общий `taken`), и зовут её **после** них:
 * своя деревня называется первой, агенты пристраиваются под ней.
 */
export function drawFigureLabels(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vp: Viewport,
  figures: FigureView[],
  now: number,
  dpr: number,
  taken: Slot[],
): void {
  for (const spot of spotsOf(cam, vp, figures, now)) {
    if (spot.ax < 0 || spot.py < 0 || spot.ax > vp.w || spot.py > vp.h) continue;
    const sprite = labelSprite(spot.f.name, dpr);
    let top = spot.py + Math.max(5, spot.unit * 0.17);
    let box: Slot = { x: spot.ax - sprite.w / 2, y: top, w: sprite.w, h: sprite.h };
    let tries = 0;
    while (hits(box, taken) && tries < STACK_TRIES) {
      top += STACK_STEP;
      box = { ...box, y: top };
      tries++;
    }
    if (hits(box, taken)) continue;
    taken.push(box);
    ctx.drawImage(sprite.canvas, box.x, top, sprite.w, sprite.h);
  }
}

export function dropFigures(): void {
  dropAgents();
}
