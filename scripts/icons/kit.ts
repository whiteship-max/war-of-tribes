// Набор значков ЗН-1 (docs/icons.md): чем рисуется каждый значок. Стиль один на весь набор и держится не глазом, а этим
// файлом: контур одной толщины (`OUTLINE`) не масштабируется вместе с рисунком, свет всегда сверху-слева (тень — грань
// снизу-справа, `facet`), цвета — только тинктуры геральдики (`TINCT`), сетка одна — 32×32.
//
// Рисунок — список фигур. Фигура — путь в сетке 32×32 и одна из трёх ролей:
//   • `fill` — заливка тинктурой с контуром чернилами (контур под заливкой, `paint-order: stroke`);
//   • `facet` — заливка без контура: тень или блик внутри уже обведённой фигуры;
//   • `line` — линия гравюры без заливки: чернилами или бликом.
// Путь пишется только абсолютными командами `M L H V C Q Z` — их можно повернуть и сдвинуть (`place`), не теряя веса линии.

/** Сетка значка. */
export const GRID = 32;
/** Толщина контура в единицах сетки: снаружи фигуры видна половина — 0,75 px на 16 px и 0,94 px на 20 px. */
export const OUTLINE = 3;
/** Линия гравюры (чернила). */
export const ENGRAVE = 1.6;
/** Линия блика. */
export const GLINT = 1.4;
/** Чернила контура и гравюры — тёплый почти чёрный, как железистые чернила. */
export const INK = '#1e140b';

/**
 * Тинктуры: светлая сторона (`x`) и тень (`x2`). Металлы геральдики — золото и серебро; цвета — червлень, лазурь, зелень,
 * чернь и пурпур; к ним — природные: дерево, пергамент, камень, медь, мясо, кожа, плоть, уголь, огонь.
 */
export const TINCT = {
  or: '#f0bd52',
  or2: '#b57c2a',
  orhi: '#fff0b8',
  ar: '#e9ece8',
  ar2: '#9ea8aa',
  gu: '#d4523b',
  gu2: '#952b1e',
  az: '#5a8fcc',
  az2: '#2e5a8c',
  ve: '#79a94a',
  ve2: '#41702a',
  sa: '#6a5e54',
  sa2: '#3a312a',
  pu: '#9a68b4',
  pu2: '#613d78',
  wd: '#c08347',
  wd2: '#80522a',
  pa: '#f1dfb2',
  pa2: '#c7a66a',
  st: '#cbc3b3',
  st2: '#8d8576',
  cu: '#e48b4f',
  cu2: '#a5521f',
  me: '#d0673f',
  me2: '#8c3a20',
  hd: '#d39a5c',
  hd2: '#94622f',
  fl: '#efc39a',
  fl2: '#bf8a5f',
  ch: '#8a7f75',
  ch2: '#544b44',
  fi: '#ffb43c',
  dk: '#2b2019',
} as const;

export type Tint = keyof typeof TINCT;

export type Role = 'fill' | 'facet' | 'line';

export interface Shape {
  role: Role;
  d: Seg[];
  tint: Tint | 'ink';
  /** Только у линии: толщина. */
  w?: number;
}

export type Seg = ['M' | 'L', number, number] | ['C', number, number, number, number, number, number] | ['Q', number, number, number, number] | ['Z'];

// ---------- путь ----------

/** Разбор пути из строки: только абсолютные `M L H V C Q Z`. */
export function path(src: string): Seg[] {
  const tok = src.match(/[MLHVCQZ]|-?\d*\.?\d+/g) ?? [];
  const out: Seg[] = [];
  let i = 0;
  let cmd = '';
  let x = 0;
  let y = 0;
  const n = (): number => {
    const v = Number(tok[i++]);
    if (!Number.isFinite(v)) throw new Error(`путь «${src}»: ждали число`);
    return v;
  };
  while (i < tok.length) {
    if (/[A-Z]/.test(tok[i])) cmd = tok[i++];
    switch (cmd) {
      case 'M':
      case 'L':
        x = n();
        y = n();
        out.push([cmd, x, y]);
        if (cmd === 'M') cmd = 'L';
        break;
      case 'H':
        x = n();
        out.push(['L', x, y]);
        break;
      case 'V':
        y = n();
        out.push(['L', x, y]);
        break;
      case 'C': {
        const a = n(), b = n(), c = n(), d = n();
        x = n();
        y = n();
        out.push(['C', a, b, c, d, x, y]);
        break;
      }
      case 'Q': {
        const a = n(), b = n();
        x = n();
        y = n();
        out.push(['Q', a, b, x, y]);
        break;
      }
      case 'Z':
        out.push(['Z']);
        break;
      default:
        throw new Error(`путь «${src}»: команда ${cmd}`);
    }
  }
  return out;
}

const K = 0.5523;

/** Эллипс четырьмя дугами Безье. */
export function ellipse(cx: number, cy: number, rx: number, ry: number): Seg[] {
  const kx = rx * K;
  const ky = ry * K;
  return [
    ['M', cx, cy - ry],
    ['C', cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy],
    ['C', cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry],
    ['C', cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy],
    ['C', cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry],
    ['Z'],
  ];
}

export const circle = (cx: number, cy: number, r: number): Seg[] => ellipse(cx, cy, r, r);

/** Прямоугольник; `r` — скругление углов. */
export function rect(x: number, y: number, w: number, h: number, r = 0): Seg[] {
  if (r <= 0) return path(`M${x} ${y}H${x + w}V${y + h}H${x}Z`);
  const q = Math.min(r, w / 2, h / 2);
  const k = q * (1 - K);
  return [
    ['M', x + q, y],
    ['L', x + w - q, y],
    ['C', x + w - k, y, x + w, y + k, x + w, y + q],
    ['L', x + w, y + h - q],
    ['C', x + w, y + h - k, x + w - k, y + h, x + w - q, y + h],
    ['L', x + q, y + h],
    ['C', x + k, y + h, x, y + h - k, x, y + h - q],
    ['L', x, y + q],
    ['C', x, y + k, x + k, y, x + q, y],
    ['Z'],
  ];
}

/** Многоугольник по парам чисел. */
export function poly(...p: number[]): Seg[] {
  const out: Seg[] = [['M', p[0], p[1]]];
  for (let i = 2; i < p.length; i += 2) out.push(['L', p[i], p[i + 1]]);
  out.push(['Z']);
  return out;
}

/** Ломаная без замыкания — для линий. */
export function polyline(...p: number[]): Seg[] {
  const out: Seg[] = [['M', p[0], p[1]]];
  for (let i = 2; i < p.length; i += 2) out.push(['L', p[i], p[i + 1]]);
  return out;
}

const segs = (d: string | Seg[]): Seg[] => (typeof d === 'string' ? path(d) : d);

// ---------- фигуры ----------

/** Обведённая заливка. */
export const fill = (d: string | Seg[], tint: Tint): Shape => ({ role: 'fill', d: segs(d), tint });
/** Грань без контура: тень или блик внутри обведённой фигуры. */
export const facet = (d: string | Seg[], tint: Tint): Shape => ({ role: 'facet', d: segs(d), tint });
/** Линия гравюры чернилами. */
export const ink = (d: string | Seg[], w = ENGRAVE): Shape => ({ role: 'line', d: segs(d), tint: 'ink', w });
/** Линия блика или цветная линия (струна, огонь). */
export const glint = (d: string | Seg[], tint: Tint = 'orhi', w = GLINT): Shape => ({ role: 'line', d: segs(d), tint, w });

/** Рисунок: фигуры по порядку слоёв. Вложенные списки разворачиваются. */
export type Art = Shape[];
export const art = (...parts: (Shape | Art)[]): Art => parts.flat();

// ---------- перенос ----------

export interface Place {
  /** Сдвиг после поворота и масштаба. */
  x?: number;
  y?: number;
  /** Масштаб вокруг центра рисунка (16, 16) — или вокруг `o`. */
  s?: number;
  /** Поворот в градусах по часовой стрелке. */
  r?: number;
  /** Зеркально по горизонтали. */
  fx?: boolean;
  /** Центр масштаба и поворота. */
  o?: [number, number];
}

/**
 * Переносит рисунок: зеркало, масштаб, поворот вокруг центра, потом сдвиг. Толщина контура и линий **не** меняется —
 * в этом весь смысл: мотив, уменьшенный в угол значка, обведён той же линией, что и большой.
 */
export function place(a: Art, p: Place): Art {
  const [ox, oy] = p.o ?? [GRID / 2, GRID / 2];
  const s = p.s ?? 1;
  const r = ((p.r ?? 0) * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const f = p.fx ? -1 : 1;
  const tx = p.x ?? 0;
  const ty = p.y ?? 0;
  const pt = (x: number, y: number): [number, number] => {
    const dx = (x - ox) * f * s;
    const dy = (y - oy) * s;
    return [ox + dx * cos - dy * sin + tx, oy + dx * sin + dy * cos + ty];
  };
  return a.map((sh) => ({
    ...sh,
    d: sh.d.map((sg): Seg => {
      switch (sg[0]) {
        case 'M':
        case 'L':
          return [sg[0], ...pt(sg[1], sg[2])];
        case 'C':
          return ['C', ...pt(sg[1], sg[2]), ...pt(sg[3], sg[4]), ...pt(sg[5], sg[6])];
        case 'Q':
          return ['Q', ...pt(sg[1], sg[2]), ...pt(sg[3], sg[4])];
        default:
          return sg;
      }
    }),
  }));
}

/** Перекрасить тинктуру в рисунке: тот же мотив другим металлом или цветом. */
export function tint(a: Art, map: Partial<Record<Tint, Tint>>): Art {
  return a.map((sh) => (sh.tint !== 'ink' && map[sh.tint] ? { ...sh, tint: map[sh.tint]! } : sh));
}

// ---------- вывод ----------

const num = (v: number): string => {
  const r = Math.round(v * 10) / 10;
  if (r === 0) return '0';
  return String(r).replace(/^(-?)0\./, '$1.');
};

/**
 * Путь строкой — относительными командами и без лишних пробелов: числа короче, и первый экран (`FIRST_SHEET`) едет
 * меньшим грузом. Отрезок вдоль оси пишется `h` или `v`.
 */
export function dOf(d: Seg[]): string {
  let out = '';
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  const nums = (vs: number[]): string => {
    let t = '';
    for (const v of vs) {
      const n = num(v);
      t += t === '' || n.startsWith('-') ? n : ` ${n}`;
    }
    return t;
  };
  const r = (v: number): number => Math.round(v * 10) / 10;
  for (const sg of d) {
    switch (sg[0]) {
      case 'M':
        out += `M${nums([sg[1], sg[2]])}`;
        x = sx = r(sg[1]);
        y = sy = r(sg[2]);
        break;
      case 'L': {
        const nx = r(sg[1]);
        const ny = r(sg[2]);
        if (ny === y) out += `h${nums([nx - x])}`;
        else if (nx === x) out += `v${nums([ny - y])}`;
        else out += `l${nums([nx - x, ny - y])}`;
        x = nx;
        y = ny;
        break;
      }
      case 'C': {
        const p = [sg[1], sg[2], sg[3], sg[4], sg[5], sg[6]].map(r);
        out += `c${nums([p[0] - x, p[1] - y, p[2] - x, p[3] - y, p[4] - x, p[5] - y])}`;
        x = p[4];
        y = p[5];
        break;
      }
      case 'Q': {
        const p = [sg[1], sg[2], sg[3], sg[4]].map(r);
        out += `q${nums([p[0] - x, p[1] - y, p[2] - x, p[3] - y])}`;
        x = p[2];
        y = p[3];
        break;
      }
      case 'Z':
        out += 'z';
        x = sx;
        y = sy;
        break;
    }
  }
  return out;
}

const colorOf = (t: Tint | 'ink'): string => (t === 'ink' ? INK : TINCT[t]);

/**
 * Одна фигура разметкой SVG. Атрибуты — на каждом элементе, без классов и `<defs>`: символ листа читают ещё двое — холст
 * карты (`ui/map/tw/glyph.ts`) и значок над крышей в сцене (`ui/GameCanvas`), — и обоим он нужен самодостаточным.
 */
export function shapeSvg(sh: Shape): string {
  const d = dOf(sh.d);
  if (sh.role === 'line') {
    return `<path d="${d}" fill="none" stroke="${colorOf(sh.tint)}" stroke-width="${num(sh.w ?? ENGRAVE)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  if (sh.role === 'facet') return `<path d="${d}" fill="${colorOf(sh.tint)}"/>`;
  return `<path d="${d}" fill="${colorOf(sh.tint)}" stroke="${INK}" stroke-width="${OUTLINE}" stroke-linejoin="round" paint-order="stroke"/>`;
}

export const symbolSvg = (name: string, a: Art): string =>
  `<symbol id="i-${name}" viewBox="0 0 ${GRID} ${GRID}">${a.map(shapeSvg).join('')}</symbol>`;

/** Отдельный файл SVG одного значка — для листа-снимка и проверок. */
export const standaloneSvg = (a: Art, px: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${GRID} ${GRID}">${a.map(shapeSvg).join('')}</svg>`;

/** Все точки рисунка — для проверки поля и размеров. */
export function pointsOf(d: Seg[]): [number, number][] {
  const out: [number, number][] = [];
  for (const sg of d) {
    if (sg[0] === 'M' || sg[0] === 'L') out.push([sg[1], sg[2]]);
    else if (sg[0] === 'C') out.push([sg[1], sg[2]], [sg[3], sg[4]], [sg[5], sg[6]]);
    else if (sg[0] === 'Q') out.push([sg[1], sg[2]], [sg[3], sg[4]]);
  }
  return out;
}
