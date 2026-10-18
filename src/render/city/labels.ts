// Подписи построек и спокойные метки над ними (ОР-1, docs/ui_v2.md, 5.9; отзыв тестера: «сложновато ориентироваться в своём
// городе»). Разметкой поверх холста, как надписи добычи (`pops.ts`) и ярлыки у лесов (`tags.ts`): имя — на теле постройки,
// метка — над крышей, на месте значка беды (`Scene.ROOF_NEW`), которого у этой постройки нет.
//
// Что видно. Рычаг «Подписи» (`render/sitetags.labelsOn`) — имена над всеми; без него — только у ближних, когда камера
// подошла (`LABEL_NEAR`), и у той, что показывают («Показать в городе», `lit`). Подписи не налезают друг на друга: раскладка
// жадная — показанная первой, ближние раньше дальних, остальные молчат (`layLabels`). Касаний слой не берёт вовсе
// (`pointer-events: none` у всего слоя): палец доходит до постройки под подписью, как без неё.
//
// Метка — того, что ждёт игрока и не беда: свободные места работы и «можно улучшить» (`derived.buildingAttention`). Беда —
// никого на работе, кузнецы без заказа — по-прежнему бляхой над крышей (решение владельца 03.10.2026): метка тише бляхи —
// точка 12 px, а не значок, и над десятком крыш с первой минуты города не закрывает.
import type * as THREE from 'three';
import type { BuildingTypeId } from '@/game/types';

/** Что ждёт игрока у постройки: можно улучшить или есть свободные места. Беда — бляхой над крышей, не здесь. */
export type Mark = 'upgrade' | 'slot';

/** Подпись и метка постройки на этот кадр: имя, метка и две точки мира — тело (подпись) и над крышей (метка). */
export interface LabelSpot {
  type: BuildingTypeId;
  name: string;
  mark: Mark | null;
  body: { x: number; y: number; z: number };
  roof: { x: number; y: number; z: number };
}

/** Камера ближе этого к телу постройки, м, — её подпись видна и без рычага. Стартовый кадр — 520 м: там ни одной. */
export const LABEL_NEAR = 230;

/**
 * Полосы верха и низа интерфейса, px CSS (`--hud-h` 80 и нижняя панель на 390×844, снимки ОР-1): подпись под ними не
 * читается — её место отдаётся той, что видна. Сцена про интерфейс не знает больше этих двух чисел.
 */
export const LABEL_INSET = { top: 84, bottom: 60 } as const;

/** Зазор между подписями, px: впритык они читаются одной строкой. */
export const LABEL_GAP = 4;

/** Кандидат раскладки: середина подписи на экране, её размер, дальность от камеры и признаки. */
export interface LabelCand {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Расстояние от камеры до тела постройки, м. */
  d: number;
  /** Постройку показывают: её подпись — первой и всегда. */
  lit: boolean;
  /** У постройки есть метка: её подпись раньше прочих. */
  mark: boolean;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Пересекаются ли два прямоугольника с зазором `gap`. */
export const overlaps = (a: Rect, b: Rect, gap = 0): boolean =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/**
 * Какие подписи показать: номера кандидатов. Видна подпись показанной постройки, все — с рычагом, ближние — без него; за
 * краем кадра и под полосами интерфейса (`LABEL_INSET`) — нет. Порядок — показанная, с меткой, ближе к камере; подпись, что легла бы на уже показанную, молчит.
 */
export function layLabels(cands: readonly LabelCand[], view: { w: number; h: number }, all: boolean): number[] {
  const order = cands
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => Number.isFinite(c.x) && Number.isFinite(c.y) && (c.lit || all || c.d <= LABEL_NEAR))
    .sort((a, b) => Number(b.c.lit) - Number(a.c.lit) || Number(b.c.mark) - Number(a.c.mark) || a.c.d - b.c.d);
  const placed: Rect[] = [];
  const out: number[] = [];
  for (const { c, i } of order) {
    const r = rectOf(c);
    if (r.x < 0 || r.y < LABEL_INSET.top || r.x + r.w > view.w || r.y + r.h > view.h - LABEL_INSET.bottom) continue;
    if (placed.some((p) => overlaps(p, r, LABEL_GAP))) continue;
    placed.push(r);
    out.push(i);
  }
  return out;
}

/** Прямоугольник подписи: середина — точка тела постройки на экране. */
export const rectOf = (c: { x: number; y: number; w: number; h: number }): Rect => ({ x: c.x - c.w / 2, y: c.y - c.h / 2, w: c.w, h: c.h });

/** Размер метки над крышей, px CSS (`deeds.css`, `.city-pip`). */
const PIP = 12;

interface Entry {
  spot: LabelSpot;
  label: HTMLDivElement;
  text: HTMLSpanElement;
  pip: HTMLDivElement;
  /** Размер подписи, px CSS: меряется, когда сменились имя или метка. */
  w: number;
  h: number;
  /** Что стоит в разметке: не трогать то, что не сменилось. */
  shown: string;
  pipShown: string;
}

export class CityLabels {
  private root: HTMLDivElement | null = null;
  private list: Entry[] = [];
  private lit: BuildingTypeId | null = null;

  /** `v` — вектор для проекции (без three в рантайме, как у `CityPops`). */
  constructor(
    host: HTMLElement | null,
    private v: THREE.Vector3,
  ) {
    if (!host || typeof document === 'undefined') return;
    const root = document.createElement('div');
    root.className = 'city-labels';
    host.appendChild(root);
    this.root = root;
  }

  /** Постройки сейчас: имена, метки и точки. Сменилось только место — разметка не трогается. */
  set(spots: readonly LabelSpot[]): void {
    const root = this.root;
    if (!root) return;
    const keep = new Map(this.list.map((e) => [e.spot.type, e]));
    const next: Entry[] = [];
    for (const spot of spots) {
      let e = keep.get(spot.type);
      keep.delete(spot.type);
      if (!e) {
        const label = document.createElement('div');
        label.className = 'city-label';
        const text = document.createElement('span');
        label.appendChild(text);
        const pip = document.createElement('div');
        pip.className = 'city-pip';
        label.style.visibility = 'hidden';
        pip.style.visibility = 'hidden';
        root.append(label, pip);
        e = { spot, label, text, pip, w: 0, h: 0, shown: '', pipShown: '' };
      }
      if (e.spot.name !== spot.name || e.spot.mark !== spot.mark || e.w === 0) {
        e.text.textContent = spot.name;
        e.label.dataset.mark = spot.mark ?? '';
        e.pip.dataset.mark = spot.mark ?? '';
        e.w = e.label.offsetWidth;
        e.h = e.label.offsetHeight;
      }
      e.spot = spot;
      next.push(e);
    }
    for (const e of keep.values()) {
      e.label.remove();
      e.pip.remove();
    }
    this.list = next;
  }

  /** Подсветить подпись показанной постройки («Показать в городе»); `null` — снять. */
  light(type: BuildingTypeId | null): void {
    this.lit = type;
    for (const e of this.list) e.label.classList.toggle('lit', e.spot.type === type);
  }

  /** Подписи и метки — над своими точками на этот кадр. `w`, `h` — размер холста в точках CSS; `all` — рычаг «Подписи». */
  update(camera: THREE.Camera, w: number, h: number, all: boolean): void {
    if (this.list.length === 0) return;
    const pos = (camera as THREE.Camera & { position: THREE.Vector3 }).position;
    const cands: LabelCand[] = [];
    const pips: ({ x: number; y: number } | null)[] = [];
    for (const e of this.list) {
      const b = e.spot.body;
      const p = this.v.set(b.x, b.y, b.z).project(camera);
      const front = p.z <= 1;
      cands.push({
        x: front ? ((p.x + 1) / 2) * w : NaN,
        y: front ? ((1 - p.y) / 2) * h : NaN,
        w: e.w,
        h: e.h,
        d: Math.hypot(b.x - pos.x, b.y - pos.y, b.z - pos.z),
        lit: e.spot.type === this.lit,
        mark: e.spot.mark !== null,
      });
      const r = e.spot.roof;
      const q = this.v.set(r.x, r.y, r.z).project(camera);
      const qx = ((q.x + 1) / 2) * w;
      const qy = ((1 - q.y) / 2) * h;
      const inside = qx >= 0 && qx <= w && qy >= LABEL_INSET.top && qy <= h - LABEL_INSET.bottom;
      pips.push(e.spot.mark && q.z <= 1 && inside ? { x: qx, y: qy } : null);
    }
    const on = new Set(layLabels(cands, { w, h }, all));
    const rects = [...on].map((i) => rectOf(cands[i]));
    this.list.forEach((e, i) => {
      const c = cands[i];
      const shown = on.has(i) ? `${Math.round(c.x)},${Math.round(c.y)}` : '';
      if (shown !== e.shown) {
        e.shown = shown;
        if (shown) e.label.style.transform = `translate3d(${Math.round(c.x)}px, ${Math.round(c.y)}px, 0)`;
        e.label.style.visibility = shown ? '' : 'hidden';
      }
      // Метка над крышей — когда подпись её не несёт и не легла бы на чужую подпись.
      const p = pips[i];
      const pr = p ? { x: p.x - PIP / 2, y: p.y - PIP / 2, w: PIP, h: PIP } : null;
      const pipShown = pr && !on.has(i) && !rects.some((r) => overlaps(r, pr)) ? `${Math.round(p!.x)},${Math.round(p!.y)}` : '';
      if (pipShown !== e.pipShown) {
        e.pipShown = pipShown;
        if (pipShown) e.pip.style.transform = `translate3d(${Math.round(p!.x)}px, ${Math.round(p!.y)}px, 0)`;
        e.pip.style.visibility = pipShown ? '' : 'hidden';
      }
    });
  }

  dispose(): void {
    this.root?.remove();
    this.root = null;
    this.list = [];
  }
}
