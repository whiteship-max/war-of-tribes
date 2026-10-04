/**
 * «Ягоды»: раскладка поляны и правило сбора (docs/minigames.md, раздел 5).
 *
 * РАСКЛАДКА — ЧИСТАЯ ФУНКЦИЯ ОТ ЗЕРНА. Где кусты, какого вида, сколько на каждом ягод, где они сидят и когда
 * созреют — всё выводится из одного числа (`sim/minigames.minigameSeed`) генератором игры (`sim/random.seeded`).
 * `Math.random` здесь нет, и тест это держит по всему `src`.
 *
 * ЗРЕЮТ ЯГОДЫ НА ГЛАЗАХ, И ЭТО ВРЕМЯ СЦЕНЫ. Спела ли ягода — `t ≥ ripeAt`, где `t` — секунды с «Начать». Тап по
 * кусту рядом обирает его целиком: спелые — в корзину, зелёные — пропали. Куст обирается один раз. Значит, умение —
 * порядок: сначала спелые, поздние под конец, и не опоздать.
 */
import { seeded } from './rules';

export type BushKind = 'bilberry' | 'cowberry' | 'raspberry';

export interface BushLook {
  /** Имя в подписи прицела — винительным: «собрать малину». */
  name: string;
  /** Толщина куста — досягаемость меряется от его края. */
  r: number;
  /** Высота. */
  h: number;
  /** Сколько ягод — от и до. */
  min: number;
  max: number;
}

/** Три вида: низкие черника и брусника, высокая малина — разный силуэт, разный цвет спелой ягоды. */
export const BUSH_KINDS: Record<BushKind, BushLook> = {
  bilberry: { name: 'чернику', r: 0.5, h: 0.42, min: 7, max: 11 },
  cowberry: { name: 'бруснику', r: 0.45, h: 0.34, min: 6, max: 10 },
  raspberry: { name: 'малину', r: 0.55, h: 1.3, min: 9, max: 12 },
};

const KINDS: readonly BushKind[] = ['bilberry', 'cowberry', 'raspberry'];

/** Сколько кустов на поляне. */
export const BUSHES = 10;
/** Докуда от середины стоят кусты: поляна предыстории — 13 м, кусты не вплотную к лесу. */
export const FIELD_R = 11;
/** Сколько чисто вокруг места, где стоит игрок на «Начать». */
export const START_CLEAR = 2.8;
/** Не ближе этого куст к кусту: между ними проходят. */
export const BUSH_GAP = 2.6;

/**
 * Когда кусты начинают зреть, секунды сцены: от «уже спел» до «под самый конец». Начала разложены ровно — по
 * одному на десятую долю отрезка, место внутри доли от зерна: на каждой поляне есть и ранние, и поздние кусты, и
 * порядок всегда что-то решает. Последняя ягода самого позднего куста спевает не позже `RIPE_TO + RIPEN_SPREAD` —
 * за четыре секунды до конца минуты: успеть можно, если идти к нему заранее.
 */
export const RIPE_FROM = -26;
export const RIPE_TO = 48;
/** Насколько внутри куста ягоды зреют вразнобой. */
export const RIPEN_SPREAD = 8;
/** Сколько секунд ягода меняет цвет перед тем, как стать спелой: видно, что вот-вот. */
export const BLUSH = 2.5;

export interface Berry {
  /** Когда спеет, секунды сцены. */
  ripeAt: number;
  /** Где сидит — от середины куста, метры. */
  x: number;
  y: number;
  z: number;
}

export interface Bush {
  id: number;
  kind: BushKind;
  x: number;
  z: number;
  /** Поворот куста — только вид. */
  yaw: number;
  berries: Berry[];
}

export interface Field {
  bushes: Bush[];
  /** Сколько ягод на поляне всего: знаменатель счёта. */
  total: number;
}

/** Поляна по зерну. */
export function layBerries(seed: number): Field {
  const rnd = seeded(seed);
  const spots: { x: number; z: number }[] = [];
  // Места: случайные точки кольца с запретом тесноты; запрет слабеет, если на поляне не хватает места (не бывает,
  // но цикл обязан кончиться при любом зерне).
  let gap = BUSH_GAP;
  for (let tries = 0; spots.length < BUSHES; tries++) {
    if (tries > 0 && tries % 300 === 0) gap *= 0.9;
    const a = rnd() * Math.PI * 2;
    const rr = START_CLEAR + 0.8 + Math.sqrt(rnd()) * (FIELD_R - START_CLEAR - 0.8);
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr;
    if (spots.every((p) => Math.hypot(p.x - x, p.z - z) >= gap)) spots.push({ x, z });
  }
  // Виды — поровну: сдвиг по кругу от зерна (3 · 3 · 4), а не бросок на каждый куст.
  const shift = Math.floor(rnd() * KINDS.length);
  // Порядок созревания — перестановка: каждой доле отрезка по кусту.
  const order = Array.from({ length: BUSHES }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const slot = (RIPE_TO - RIPE_FROM) / BUSHES;
  let total = 0;
  const bushes = spots.map((p, i): Bush => {
    const kind = KINDS[(i + shift) % KINDS.length];
    const look = BUSH_KINDS[kind];
    const from = RIPE_FROM + (order[i] + rnd()) * slot;
    const n = look.min + Math.floor(rnd() * (look.max - look.min + 1));
    const berries: Berry[] = [];
    for (let k = 0; k < n; k++) {
      const a = rnd() * Math.PI * 2;
      let x: number;
      let y: number;
      let z: number;
      if (kind === 'raspberry') {
        // Малина — на стеблях: по высоте от колена до плеча, по кругу у края куста.
        const rr = look.r * (0.55 + 0.4 * rnd());
        x = Math.cos(a) * rr;
        z = Math.sin(a) * rr;
        y = 0.45 + 0.75 * rnd();
      } else {
        // Низкий куст — ягоды поверх шапки: эллипсоид чуть больше листвы (`models.bushesMesh`), иначе они в ней тонут.
        const up = 0.15 + 1.0 * rnd();
        x = Math.cos(a) * Math.cos(up) * look.r * 1.08;
        z = Math.sin(a) * Math.cos(up) * look.r * 1.08;
        y = look.h * (0.42 + 0.82 * Math.sin(up));
      }
      berries.push({ ripeAt: from + rnd() * RIPEN_SPREAD, x, y, z });
    }
    total += n;
    return { id: i, kind, x: p.x, z: p.z, yaw: rnd() * Math.PI * 2, berries };
  });
  return { bushes, total };
}

/** Спела ли ягода в эту секунду. */
export const ripe = (b: Berry, t: number): boolean => t >= b.ripeAt;

/** Насколько ягода покраснела (посинела), 0..1: за `BLUSH` секунд до спелости. Только вид. */
export const blush = (b: Berry, t: number): number => Math.max(0, Math.min(1, (t - (b.ripeAt - BLUSH)) / BLUSH));

/** Что даст куст, если обобрать его сейчас. */
export function yieldOf(bush: Bush, t: number): { ripe: number; green: number } {
  let r = 0;
  for (const b of bush.berries) if (ripe(b, t)) r++;
  return { ripe: r, green: bush.berries.length - r };
}

/** Корзина: какие кусты обобраны, когда и что с них легло. Живёт в кадре — в сохранение не идёт ничего. */
export class Basket {
  /** Куст → минута сбора и что дал. */
  readonly picked = new Map<number, { at: number; ripe: number; green: number }>();
  got = 0;
  lost = 0;

  /** Обобрать куст. Второй раз — ничего: куст пуст. */
  pick(bush: Bush, t: number): { ripe: number; green: number } | null {
    if (this.picked.has(bush.id)) return null;
    const y = yieldOf(bush, t);
    this.picked.set(bush.id, { at: t, ...y });
    this.got += y.ripe;
    this.lost += y.green;
    return y;
  }

  isPicked(id: number): boolean {
    return this.picked.has(id);
  }
}
