// Добыча над постройкой (docs/city.md, 14.3): всплывающие «+N» над тем двором, который её дал. Счёт — выработка двора
// функциями игры (`derived.buildingProduction`, вольный сбор — площадь у костра), умноженная на прожитое партией время:
// мир считается при чтении, поэтому при входе добыча отлучки приходит одной волной, а дальше — по мере прихода.
//
// Две части: счётчик (`YieldTally`, без three и без страницы — его судит тест) и слой на странице (`CityPops`): надписи
// поверх холста, касаний не берут (`pointer-events: none`), подъём и таяние — анимацией CSS; кадр только ставит их над
// постройкой, пока камера едет.
import type * as THREE from 'three';
import type { BuildingTypeId, GameState, ResourceId, Resources } from '@/game/types';
import { DAY_LENGTH, RESOURCE_IDS, RESOURCE_META } from '@/game/constants';
import { gameSeconds } from '@/game/pace';
import type { Quality } from '../quality';

/** Двор игры с его выработкой за игровой день. */
export interface Yard {
  type: BuildingTypeId;
  perDay: Resources;
}

/** Всплывающая надпись: чья постройка и что пришло (не больше двух запасов, крупнейшие). */
export interface Pop {
  type: BuildingTypeId;
  items: { r: ResourceId; n: number }[];
}

/**
 * Дольше этого между двумя чтениями партии, настоящих секунд, — уже не шаг, а отлучка: добыча приходит волной. Вдвое
 * больше порога отлучки партии (`sim/tick.AWAY_AFTER`, пять секунд); в игровые — дверью времени (`waveAfter`).
 */
export const WAVE_REAL = 10;
export const waveAfter = (): number => gameSeconds(WAVE_REAL);
/** Над одной постройкой — не чаще раза в столько настоящих секунд: двор с быстрой выработкой не сыплет надписями. */
export const POP_GAP = 6;

/**
 * Счётчик добычи по дворам. Копит дробную выработку двора и отдаёт её целыми: «+1» не чаще `POP_GAP`, а волна отлучки —
 * сразу всем дворам. Запас, упёршийся в потолок склада, не всплывает: лишнее пропадает (`hudTips.isFull`), и «+N»
 * над двором было бы неправдой.
 */
export class YieldTally {
  private acc = new Map<BuildingTypeId, Resources>();
  private last = new Map<BuildingTypeId, number>();

  /**
   * Прожито `dt` игровых секунд; `now` — настоящие секунды сцены; `full` — запасы у потолка склада; `wave` — добыча
   * отлучки: всем дворам сразу, мимо `POP_GAP`.
   */
  feed(yards: readonly Yard[], dt: number, now: number, full: ReadonlySet<ResourceId>, wave = false): Pop[] {
    if (!(dt > 0)) return [];
    const pops: Pop[] = [];
    for (const y of yards) {
      let a = this.acc.get(y.type);
      if (!a) {
        a = Object.fromEntries(RESOURCE_IDS.map((r) => [r, 0])) as Resources;
        this.acc.set(y.type, a);
      }
      for (const r of RESOURCE_IDS) {
        const v = y.perDay[r];
        if (full.has(r) || !(v > 0)) a[r] = 0;
        else a[r] += (v * dt) / DAY_LENGTH;
      }
      if (!wave && now - (this.last.get(y.type) ?? -Infinity) < POP_GAP) continue;
      const items = RESOURCE_IDS.filter((r) => a[r] >= 1)
        .sort((p, q) => a[q] - a[p])
        .slice(0, 2)
        .map((r) => ({ r, n: Math.floor(a[r]) }));
      if (items.length === 0) continue;
      for (const it of items) a[it.r] -= it.n;
      this.last.set(y.type, now);
      pops.push({ type: y.type, items });
    }
    return pops;
  }
}

/**
 * Что отклик города помнит о прошлом чтении партии: уровни построек, заказы найма (заказано и обучено) и время партии.
 * Разница двух таких снимков — новости для города (`newsOf`).
 */
export interface Seen {
  levels: Map<number, number>;
  orders: Map<number, { count: number; done: number }>;
  time: number;
}

export const seenOf = (s: GameState): Seen => ({
  levels: new Map(s.buildings.map((b) => [b.id, b.level])),
  orders: new Map(s.recruits.map((r) => [r.id, { count: r.count, done: r.done }])),
  time: s.time,
});

/**
 * Новости между двумя чтениями: чья стройка кончилась (уровень вырос, улучшение больше не идёт), сколько бойцов обучено
 * (прибавка `done` у живых заказов и остаток ушедших — заказ снимается, когда обучен последний) и сколько игровых
 * секунд прожито.
 */
export function newsOf(was: Seen, s: GameState): { done: BuildingTypeId[]; trained: number; dt: number } {
  const done = s.buildings.filter((b) => {
    const before = was.levels.get(b.id);
    return before !== undefined && b.level > before && b.workRequired === 0;
  }).map((b) => b.type);
  let trained = 0;
  for (const [id, o] of was.orders) {
    const now = s.recruits.find((r) => r.id === id);
    trained += Math.max(0, (now ? now.done : o.count) - o.done);
  }
  return { done, trained, dt: s.time - was.time };
}

/** Сколько надписей живёт разом: на «Низком» — меньше и без волны лесенкой. */
const LIVE_MAX: Record<Quality, number> = { high: 14, medium: 12, low: 6 };
/** Сколько живёт надпись, настоящих секунд (анимация `city-pop` в `styles.css` — та же длина). */
const POP_LIFE = 1.9;
/** Поля экрана для надписи двора за кадром: доля ширины с боков, доли высоты сверху (под верхом) и снизу (над низом). */
const EDGE_X = 0.12;
const EDGE_TOP = 0.17;
const EDGE_BOTTOM = 0.84;
/** Волна — лесенкой: надпись за надписью через столько секунд. */
const WAVE_STEP = 0.14;

interface Live {
  el: HTMLDivElement;
  x: number;
  y: number;
  z: number;
  at: number;
  shown: boolean;
  res: ResourceId[];
}

/**
 * Слой надписей поверх холста. Свой элемент в обёртке холста, касаний не берёт; надпись встаёт над точкой мира, живёт
 * `POP_LIFE` и уходит. Рисунок запаса — значок листа (`svg`), без листа — эмодзи из таблицы запасов.
 */
export class CityPops {
  private root: HTMLDivElement | null = null;
  private live: Live[] = [];

  /** `v` — вектор для проекции (кусок без three в рантайме: тест судит счётчик в node). */
  constructor(
    host: HTMLElement | null,
    private quality: Quality,
    private svg: (name: string) => string | null,
    private v: THREE.Vector3,
  ) {
    if (!host || typeof document === 'undefined') return;
    const root = document.createElement('div');
    root.className = 'city-pops';
    root.setAttribute('aria-hidden', 'true');
    host.appendChild(root);
    this.root = root;
  }

  /** Новые надписи над точками мира; `wave` — лесенкой, начиная с `now`. */
  add(list: readonly { x: number; y: number; z: number; pop: Pop }[], wave: boolean, now: number): void {
    const root = this.root;
    if (!root) return;
    const room = LIVE_MAX[this.quality] - this.live.length;
    const take = list.slice(0, Math.max(0, room));
    take.forEach((p, k) => {
      const el = document.createElement('div');
      el.className = 'city-pop';
      el.innerHTML = p.pop.items
        .map(({ r, n }) => {
          const art = this.svg(`res-${r}`);
          const ico = art ? `<i>${art}</i>` : `<i>${RESOURCE_META[r].icon}</i>`;
          return `<span>+${n}${ico}</span>`;
        })
        .join('');
      el.style.visibility = 'hidden';
      root.appendChild(el);
      const step = wave && this.quality !== 'low' ? WAVE_STEP : 0;
      this.live.push({ el, x: p.x, y: p.y, z: p.z, at: now + k * step, shown: false, res: p.pop.items.map((i) => i.r) });
    });
  }

  /** Надписи — над своими точками на этот кадр; отжившие уходят. `w`, `h` — размер холста в точках CSS. */
  update(camera: THREE.Camera, w: number, h: number, now: number): void {
    if (this.live.length === 0) return;
    const keep: Live[] = [];
    for (const p of this.live) {
      if (now - p.at > POP_LIFE) {
        p.el.remove();
        continue;
      }
      keep.push(p);
      if (now < p.at) continue;
      const v = this.v.set(p.x, p.y, p.z).project(camera);
      // За кадром двор не теряется: надпись встаёт у края экрана со стороны двора (между верхом и низом интерфейса).
      // За спиной камеры её нет вовсе.
      const off = v.z > 1;
      const sx = ((v.x + 1) / 2) * w;
      const sy = ((1 - v.y) / 2) * h;
      const cx = Math.min(w * (1 - EDGE_X), Math.max(w * EDGE_X, sx));
      const cy = Math.min(h * EDGE_BOTTOM, Math.max(h * EDGE_TOP, sy));
      p.el.classList.toggle('edge', cx !== sx || cy !== sy);
      p.el.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
      if (!p.shown) {
        // Первое появление: анимация подъёма идёт от этой минуты; верхней полосе — знак, какой запас пришёл.
        p.shown = true;
        p.el.style.visibility = off ? 'hidden' : '';
        p.el.classList.add('go');
        if (!off && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('tribe-yield', { detail: p.res }));
      } else p.el.style.visibility = off ? 'hidden' : '';
    }
    this.live = keep;
  }

  dispose(): void {
    this.root?.remove();
    this.root = null;
    this.live = [];
  }
}
