// Фигуры игрока на полотне. Рисуются последними — после тумана и походов:
// фигура не может оказаться под дымкой, которую сама же и разгоняет.
//
// Значок фигуры **испечён** (`badge`), а не собирается за кадр. Разница не в
// четырёх кружках: глиф — это `fillText`, а раскладка текста в браузере стоит
// заметно дороже копирования картинки, и платить за неё шестьдесят раз в
// секунду не за что — значок меняется только когда фигуру берут в руку.
//
// Полководец с войском рисуется **колонной** (`party.ts`), а значок садится ей
// на плечи. Это не украшение: армия ходит только с полководцем, и до сих пор
// сотня бойцов на карте выглядела так же, как дипломат с письмом.
import { RELATION_META } from '@/world/data/meta';
import { formatLeft, secondsLeft } from '@/world/geo';
import { figurePosition } from '@/world/store';
import type { FigureView } from '@/world/types';
import { type Camera, type Viewport, toScreen } from './grid';
import { TOKEN } from './palette';
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

// ---------- Значок фигуры ----------

/**
 * Значки печутся по корзинам радиуса — так же, как поселения и отряды. Радиус в
 * кадре плавает вместе с масштабом, и без корзин значок перепекался бы на
 * каждый щипок; растяжение копии на треть на кружке с глифом не видно.
 */
const BADGE_BUCKETS = [10, 13, 16, 18];

const badgeBucket = (r: number): number => BADGE_BUCKETS.find((b) => b >= r) ?? BADGE_BUCKETS[BADGE_BUCKETS.length - 1];

interface Badge {
  canvas: HTMLCanvasElement;
  /** Радиус, под который выпечено: копию растягивают из него. */
  r: number;
}

const badges = new Map<string, Badge>();
/**
 * Фигур четыре, состояния два — на одной корзине это восемь ячеек. Дюжина, а не
 * восемь, чтобы щипок через границу корзины не выбрасывал ещё живые значки.
 */
const BADGE_MAX = 12;

function bakeBadge(icon: string, chosen: boolean, r: number, dpr: number): Badge {
  // Полтора радиуса в каждую сторону: глиф вылезает за кружок на любом шрифте.
  const half = r * 1.5;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.max(1, Math.round(half * 2 * dpr));
  const ctx = canvas.getContext('2d');
  const badge: Badge = { canvas, r };
  if (!ctx) return badge;
  ctx.setTransform(dpr, 0, 0, dpr, half * dpr, half * dpr);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = chosen ? OWN : TOKEN.base;
  ctx.fill();
  ctx.lineWidth = chosen ? 2.5 : 1.5;
  ctx.strokeStyle = chosen ? '#fff2d8' : OWN;
  ctx.stroke();
  ctx.font = `${Math.round(r * 1.15)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(icon, 0, r * 0.05);
  return badge;
}

function badge(icon: string, chosen: boolean, r: number, dpr: number): Badge {
  const bucket = badgeBucket(r);
  const key = `${icon}|${chosen ? 1 : 0}|${bucket}|${dpr}`;
  const have = badges.get(key);
  if (have) {
    badges.delete(key);
    badges.set(key, have);
    return have;
  }
  const made = bakeBadge(icon, chosen, bucket, dpr);
  badges.set(key, made);
  if (badges.size > BADGE_MAX) {
    const oldest = badges.keys().next().value;
    if (oldest !== undefined) badges.delete(oldest);
  }
  return made;
}

export function dropBadges(): void {
  badges.clear();
}

function drawBadge(
  ctx: CanvasRenderingContext2D,
  icon: string,
  chosen: boolean,
  r: number,
  dpr: number,
  cx: number,
  cy: number,
): void {
  // Копия растягивается из корзины в запрошенный радиус: поле у спрайта то же
  // (полтора радиуса), поэтому пересчитывать нечего — берём половину от `r`.
  const half = r * 1.5;
  ctx.drawImage(badge(icon, chosen, r, dpr).canvas, cx - half, cy - half, half * 2, half * 2);
}

/**
 * Все четыре фигуры. Павшая не рисуется вовсе: её нет на карте, она возвращается
 * домой, и это видно в её карточке, а не пустым кружком в поле.
 */
export function drawFigures(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vp: Viewport,
  figures: FigureView[],
  picked: string | null,
  now: number,
  dpr: number,
): void {
  for (const f of figures) {
    if (f.phase === 'down') continue;
    const at = figurePosition(f, now);
    const [px, py] = toScreen(cam, vp, at.x + 0.5, at.y + 0.5);
    if (px < -60 || py < -60 || px > vp.w + 60 || py > vp.h + 60) continue;
    const chosen = picked === f.id;
    if (chosen) drawSight(ctx, px, py, f.sight * cam.scale);
    if (f.phase === 'moving') drawRoute(ctx, cam, vp, f, px, py, now);

    const r = Math.max(9, Math.min(18, cam.scale * 0.34));
    // Войско при полководце — та же колонна, что у похода, и тем же кодом: две
    // правды о том, как выглядит своя армия, разошлись бы при первой же правке.
    const men = partyMen(f.troops);
    if (men > 0) {
      const [tx, ty] = toScreen(cam, vp, f.to.x + 0.5, f.to.y + 0.5);
      const moving = f.phase === 'moving';
      // Лагерь ставят в чистом поле — там же, где садятся в осаду. Дома войско
      // стоит колонной у ворот: шатры посреди своей деревни читались бы осадой
      // собственного двора.
      drawParty(
        ctx,
        partyLook({ own: true, units: f.troops, standing: f.phase === 'field', seen: true, west: tx < px }),
        cam.scale,
        dpr,
        px,
        py,
      );
      if (moving) {
        const angle = Math.atan2(ty - py, tx - px);
        const lead = cam.scale * 0.62;
        drawHeading(ctx, 'own', dpr, px + Math.cos(angle) * lead, py + Math.sin(angle) * lead, angle, r * 0.7);
      }
    }
    // Значок садится **над** колонной, если она есть: он опознаёт вожака, а не
    // заменяет войско, и закрывать собой знамя ему нельзя — знамя выше голов, и
    // на 0.62 клетки значок ложился ровно на него. Без войска он стоит там же,
    // где стоял всегда.
    drawBadge(ctx, f.icon, chosen, r, dpr, px, py - (men > 0 ? cam.scale * 0.88 : r * 0.2));
  }
}
