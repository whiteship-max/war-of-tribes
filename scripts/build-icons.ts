/**
 * Сборка двумерного арта: проверка, накладная, лист символов.
 *
 *     npm run icons:build          собрать и напечатать отчёт
 *     npm run icons:build -- --check   только проверить, ничего не писать
 *
 * Читает assets-src/icons/*.svg — отдельные файлы, как их сдал художник, — и делает
 * три вещи, ни одна из которых не решается глазами:
 *
 *   1. проверяет формат каждого файла по разделам 3.2 и 3.3 техзадания
 *      (docs/ART_HANDOFF.md): сетка, размеры на корне, только заливки, палитра,
 *      поле в один пиксель, бюджет заливок и веса;
 *   2. сверяет имена файлов с накладной (src/ui/icons/registry.ts), которая
 *      собрана из данных игры, и падает на недостающем и на лишнем;
 *   3. склеивает прошедшие файлы в один лист public/assets/icons/sprite.svg
 *      (<symbol> на значок) и пишет список имён в src/ui/icons/generated.ts.
 *
 * Брак не правится здесь и не правится руками нигде — это правило техзадания
 * (5.3): файл возвращается автору с названием нарушенного пункта. Пока он в
 * работе, его имя лежит в assets-src/icons/RETURNED.md, сборка остаётся зелёной,
 * а на месте значка игра показывает эмодзи. Вернут исправленный файл — строка из
 * RETURNED.md убирается, и значок встаёт сам.
 *
 * Очередями скрипт не управляет и знать о них не должен: группа считается сданной,
 * как только в папке лежит хоть один её файл, и с этой секунды обязана быть полной.
 * Поэтому вторая и третья очереди подключаются без единой правки кода.
 */
import { gzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import { ICON_GROUPS, ICON_MANIFEST } from '@/ui/icons/registry';
import { FOLK_TINT, HERO_TINT, JOB_TINT, PALETTE, SEASON_OVERRIDES, TROOP_TINT } from '@/render/palette';
import { RELATION_META } from '@/world/data/meta';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SRC = path.join(ROOT, 'assets-src', 'icons');
const RETURNED = path.join(SRC, 'RETURNED.md');
const OBJECTS = path.join(SRC, 'OBJECTS.md');
const OUT_DIR = path.join(ROOT, 'public', 'assets', 'icons');
const OUT_SPRITE = path.join(OUT_DIR, 'sprite.svg');
const OUT_DATA = path.join(ROOT, 'src', 'ui', 'icons', 'generated.ts');

// ---------- пределы из техзадания ----------

/** 3.3: вес одного значка после оптимизации. */
const MAX_BYTES = 1000;
/** 3.3: заливок (элементов) на значок. */
const MAX_FILLS = 24;
/** 3.3: весь лист значков в сжатом виде. */
const SHEET_CAP_GZIP = 60 * 1024;
/** 3.3: весь двумерный слой — лист плюс экран загрузки плюс запас. */
const ART_CAP_GZIP = 95 * 1024;
/** Доля потолка, после которой сборка начинает ругаться. */
const WARN_AT = 0.8;
/** 3.2: поле по одному пикселю с каждой стороны сетки 32×32. */
const MARGIN = 1;
/**
 * 3.4: «значок, который занимает половину своей сетки, в ряду выглядит меньше
 * соседей». Требовать ровно 30 по обеим сторонам нельзя — копьё узкое, а монета
 * круглая, — поэтому меряется длинная сторона рисунка.
 */
const MIN_SPAN = 26;

/**
 * 4: два запрета по краям тонального коридора. Значок обязан читаться и на тёмной
 * панели Telegram (`#1c1611`), и на светлой (`#f0efee`), а держится это на том, что
 * основная масса лежит в средних тонах.
 */
const TONE_LIGHT_CAP = 0.25;
const TONE_DARK_CAP = 0.15;
/**
 * Целиком в светлом — это уже не «край коридора», а «весь силуэт», и техзадание
 * запрещает такое прямо. Здесь и проходит граница между браком и предупреждением:
 * доля площади — мерка приблизительная (белёная стена дома держится цоколем), а
 * значок, у которого светлого почти всё, не держится ничем.
 */
const TONE_LIGHT_FATAL = 0.9;

/** 3.2: что вообще разрешено рисовать. */
const ELEMENTS = new Set(['svg', 'g', 'path', 'polygon', 'rect', 'circle']);
/** Атрибуты, которые не красят и не запрещены: геометрия и корень. */
const GEOMETRY = new Set([
  'd', 'points', 'x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry',
  'viewBox', 'xmlns', 'fill-rule',
]);

// ---------- палитра ----------
//
// Список цветов не переписывается сюда руками: он собирается из самой палитры
// проекта (render/palette.ts), из переменных стиля (ui/styles.css) и из цветов
// племён на карте. Перекрасят палитру — проверка узнает об этом сама.

function hex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}

export function allowedColors(): Map<string, string> {
  const out = new Map<string, string>();
  const put = (value: string, why: string) => {
    if (!out.has(value)) out.set(value, why);
  };
  for (const [key, value] of Object.entries(PALETTE)) put(hex(value as number), `палитра ${key}`);
  for (const [season, over] of Object.entries(SEASON_OVERRIDES)) {
    for (const [key, value] of Object.entries(over as Record<string, number>)) {
      put(hex(value), `палитра ${key} (${season})`);
    }
  }
  for (const [job, value] of Object.entries(JOB_TINT)) put(hex(value), `одежда профессии ${job}`);
  for (const [troop, value] of Object.entries(TROOP_TINT)) put(hex(value), `рубаха вида ${troop}`);
  for (const [part, value] of Object.entries(HERO_TINT)) put(hex(value), `герой ${part}`);
  FOLK_TINT.forEach((value, i) => put(hex(value), `покрой горожанина ${i + 1}`));
  for (const rel of Object.values(RELATION_META)) put(rel.color.toLowerCase(), `цвет отношений «${rel.name}»`);

  // Переменные стиля: значок стоит в интерфейсе и вправе брать его цвета.
  const css = readFileSync(path.join(ROOT, 'src', 'ui', 'styles.css'), 'utf8');
  const root = css.slice(0, css.indexOf('}'));
  for (const m of root.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6})/g)) put(m[2], `переменная стиля ${m[1]}`);
  return out;
}

// ---------- разбор файла ----------

interface Element {
  tag: string;
  attrs: Record<string, string>;
}

/**
 * Разбор нарочно грубый и строгий: значки — это плоские заливки без вложенности,
 * а всё, что этот разбор не понимает, и есть повод вернуть файл.
 */
function parse(text: string): { elements: Element[]; error: string | null } {
  const elements: Element[] = [];
  for (const m of text.matchAll(/<([a-zA-Z][\w:-]*)((?:\s+[a-zA-Z][\w:-]*\s*=\s*"[^"]*")*)\s*\/?>/g)) {
    const attrs: Record<string, string> = {};
    for (const a of m[2].matchAll(/([a-zA-Z][\w:-]*)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2];
    elements.push({ tag: m[1], attrs });
  }
  // Всё, что похоже на тег, но не разобралось, — либо запрещённый элемент,
  // либо синтаксис, которого в наборе быть не должно.
  const tags = [...text.matchAll(/<\/?([a-zA-Z][\w:-]*)/g)].map((m) => m[1]);
  const known = new Set(elements.map((e) => e.tag));
  const stray = tags.find((t) => !known.has(t));
  return { elements, error: stray ? `непонятный элемент <${stray}>` : null };
}

/** Все числовые координаты элемента в системе viewBox. */
function bounds(el: Element): { x0: number; y0: number; x1: number; y1: number } | null {
  const xs: number[] = [];
  const ys: number[] = [];
  const num = (v: string | undefined): number => Number(v ?? 0);

  if (el.tag === 'polygon' && el.attrs.points) {
    const raw = el.attrs.points.trim().split(/[\s,]+/).map(Number);
    for (let i = 0; i + 1 < raw.length; i += 2) {
      xs.push(raw[i]);
      ys.push(raw[i + 1]);
    }
  } else if (el.tag === 'rect') {
    xs.push(num(el.attrs.x), num(el.attrs.x) + num(el.attrs.width));
    ys.push(num(el.attrs.y), num(el.attrs.y) + num(el.attrs.height));
  } else if (el.tag === 'circle') {
    xs.push(num(el.attrs.cx) - num(el.attrs.r), num(el.attrs.cx) + num(el.attrs.r));
    ys.push(num(el.attrs.cy) - num(el.attrs.r), num(el.attrs.cy) + num(el.attrs.r));
  } else if (el.tag === 'path' && el.attrs.d) {
    // Габарит по опорным точкам, включая управляющие: он всегда накрывает саму
    // кривую, поэтому «не вылезает за поле» этим проверяется честно.
    const pts = pathPoints(el.attrs.d);
    if (pts === null) return null;
    for (const [x, y] of pts) {
      xs.push(x);
      ys.push(y);
    }
  } else {
    return null;
  }
  if (xs.length === 0) return null;
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Опорные точки контура. `null` — команда, которой в наборе быть не должно. */
function pathPoints(d: string): [number, number][] | null {
  const out: [number, number][] = [];
  let cx = 0;
  let cy = 0;
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+/g) ?? [];
  let i = 0;
  let cmd = '';
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const take = (n: number): number[] => tokens.slice(i, (i += n)).map(Number);
    const put = (x: number, y: number) => out.push([x, y]);
    switch (cmd.toUpperCase()) {
      case 'M':
      case 'L':
      case 'T': {
        const [x, y] = take(2);
        cx = rel ? cx + x : x;
        cy = rel ? cy + y : y;
        put(cx, cy);
        break;
      }
      case 'H': {
        const [x] = take(1);
        cx = rel ? cx + x : x;
        put(cx, cy);
        break;
      }
      case 'V': {
        const [y] = take(1);
        cy = rel ? cy + y : y;
        put(cx, cy);
        break;
      }
      case 'C': {
        const v = take(6);
        for (let k = 0; k < 6; k += 2) put(rel ? cx + v[k] : v[k], rel ? cy + v[k + 1] : v[k + 1]);
        cx = rel ? cx + v[4] : v[4];
        cy = rel ? cy + v[5] : v[5];
        break;
      }
      case 'S':
      case 'Q': {
        const v = take(4);
        for (let k = 0; k < 4; k += 2) put(rel ? cx + v[k] : v[k], rel ? cy + v[k + 1] : v[k + 1]);
        cx = rel ? cx + v[2] : v[2];
        cy = rel ? cy + v[3] : v[3];
        break;
      }
      case 'Z':
        break;
      default:
        // Дуга (A) в наборе плоских заливок не нужна, а её габарит без разбора
        // эллипса не посчитать — молча пропускать такое нельзя.
        return null;
    }
  }
  return out.length > 0 ? out : null;
}

// ---------- проверка одного файла ----------

export interface Fault {
  file: string;
  rule: string;
  detail: string;
}

export function check(file: string, text: string, colors: Map<string, string>): Fault[] {
  const faults: Fault[] = [];
  const bad = (rule: string, detail: string) => faults.push({ file, rule, detail });
  const bytes = Buffer.byteLength(text, 'utf8');

  if (bytes > MAX_BYTES) bad('3.3 вес', `${bytes} байт, предел ${MAX_BYTES}`);
  if (/<!--/.test(text)) bad('3.2 оптимизация', 'в файле остался комментарий');
  if (/\bid\s*=\s*"/.test(text)) bad('3.2 оптимизация', 'в файле остался id');
  if (/<(animate|animateTransform|set)\b/.test(text)) bad('3.2 анимация', 'анимация внутри файла');
  if (/\bstyle\s*=\s*"/.test(text)) bad('3.2 только fill', 'атрибут style');

  const { elements, error } = parse(text);
  if (error) {
    bad('3.2 разбор', error);
    return faults;
  }

  const root = elements[0];
  if (!root || root.tag !== 'svg') {
    bad('3.2 корень', 'файл не начинается с <svg>');
    return faults;
  }
  if (root.attrs.viewBox !== '0 0 32 32') bad('3.2 сетка', `viewBox="${root.attrs.viewBox ?? ''}", нужен "0 0 32 32"`);
  if (root.attrs.width !== '32' || root.attrs.height !== '32') {
    bad('3.2 размеры', `width="${root.attrs.width ?? ''}" height="${root.attrs.height ?? ''}", нужны 32 и 32`);
  }

  const shapes = elements.slice(1);
  for (const el of shapes) {
    if (!ELEMENTS.has(el.tag)) {
      bad('3.2 состав', `запрещённый элемент <${el.tag}>`);
      continue;
    }
    for (const [name, value] of Object.entries(el.attrs)) {
      if (name === 'fill') {
        if (!/^#[0-9a-f]{6}$/.test(value)) {
          bad('3.2 заливка', `fill="${value}" — нужен hex строчными, шесть знаков`);
        } else if (!colors.has(value)) {
          bad('2.2 палитра', `цвет ${value} не из палитры проекта`);
        }
        continue;
      }
      if (name.startsWith('stroke')) {
        bad('3.2 только fill', `обводка ${name}="${value}"`);
        continue;
      }
      if (!GEOMETRY.has(name)) bad('3.2 только fill', `посторонний атрибут ${name}="${value}"`);
    }
    // Координаты: целые или с одним знаком после запятой.
    const coords = `${el.attrs.points ?? ''} ${el.attrs.d ?? ''} ${el.attrs.x ?? ''} ${el.attrs.y ?? ''} ${el.attrs.cx ?? ''} ${el.attrs.cy ?? ''} ${el.attrs.r ?? ''}`;
    const longs = coords.match(/\d+\.\d{2,}/g);
    if (longs) bad('3.2 координаты', `больше одного знака после запятой: ${longs.slice(0, 3).join(', ')}`);
  }

  const drawn = shapes.filter((el) => el.tag !== 'g');
  if (drawn.length === 0) bad('3.2 состав', 'в файле нечего рисовать');
  if (drawn.length > MAX_FILLS) bad('3.3 заливки', `${drawn.length} заливок, предел ${MAX_FILLS}`);

  // Поле в один пиксель: рисунок целиком внутри квадрата и этот квадрат заполняет.
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let unmeasured = false;
  for (const el of drawn) {
    const b = bounds(el);
    if (!b) {
      unmeasured = true;
      continue;
    }
    x0 = Math.min(x0, b.x0);
    y0 = Math.min(y0, b.y0);
    x1 = Math.max(x1, b.x1);
    y1 = Math.max(y1, b.y1);
  }
  if (unmeasured) bad('3.2 разбор', 'есть контур, габарит которого не посчитать (дуга A?)');
  if (Number.isFinite(x0)) {
    const out: string[] = [];
    if (x0 < MARGIN) out.push(`слева ${x0}`);
    if (y0 < MARGIN) out.push(`сверху ${y0}`);
    if (x1 > 32 - MARGIN) out.push(`справа ${x1}`);
    if (y1 > 32 - MARGIN) out.push(`снизу ${y1}`);
    if (out.length > 0) bad('3.2 поле', `рисунок выходит за поле в 1 пиксель: ${out.join(', ')}`);
    const span = Math.max(x1 - x0, y1 - y0);
    if (span < MIN_SPAN) {
      bad('3.4 поля', `рисунок ${(x1 - x0).toFixed(1)}×${(y1 - y0).toFixed(1)} — не дотягивает до сетки 30×30`);
    }
  }
  return faults;
}

// ---------- тон ----------
//
// Проверка из раздела 4 техзадания: значок кладут на тёмную панель и на светлую и
// смотрят, не потерял ли он силуэт. Мерка — доля площади, занятая цветами у краёв
// коридора, и считается она растеризацией: у плоских заливок пиксель либо ровно
// того цвета, либо чужой, поэтому перекрытия учитываются сами собой.

const lum = (n: number): number =>
  (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;

/** Светлый край коридора: штукатурка, кость, снег — и зимние переопределения. */
function toneColors(): { light: Set<string>; dark: Set<string> } {
  const light = new Set((['plaster', 'bone', 'fieldSnow', 'snowflake'] as const).map((k) => hex(PALETTE[k])));
  // Зима переопределяет часть палитры снегом — он тот же светлый край коридора.
  for (const value of Object.values(SEASON_OVERRIDES.winter as Record<string, number>)) {
    if (value !== undefined && lum(value) > 0.8) light.add(hex(value));
  }
  return { light, dark: new Set([hex(PALETTE.dark)]) };
}

export interface Tone {
  light: number;
  dark: number;
}

/**
 * Доли площади. `null` — растеризатор недоступен: тогда проверка тона молча
 * пропускается, а не роняет сборку на машине без librsvg.
 */
export async function measureTone(text: string, tone = toneColors()): Promise<Tone | null> {
  // Растеризуем в родные 32x32 и без пересчёта размера: пересчёт мешает соседние
  // цвета, и доли поплывут на границах заливок, которых у плоского значка много.
  let raw: Buffer;
  let channels: number;
  let pixels: number;
  try {
    const out = await sharp(Buffer.from(text)).raw().toBuffer({ resolveWithObject: true });
    raw = out.data;
    channels = out.info.channels;
    pixels = out.info.width * out.info.height;
  } catch {
    return null;
  }
  let total = 0;
  let light = 0;
  let dark = 0;
  for (let i = 0; i < pixels; i++) {
    const o = i * channels;
    if (channels === 4 && raw[o + 3] < 128) continue;
    total++;
    const value = `#${(((raw[o] << 16) | (raw[o + 1] << 8) | raw[o + 2]) >>> 0).toString(16).padStart(6, '0')}`;
    if (tone.light.has(value)) light++;
    if (tone.dark.has(value)) dark++;
  }
  if (total === 0) return null;
  return { light: light / total, dark: dark / total };
}

/** Брак или предупреждение — граница объяснена у TONE_LIGHT_FATAL. */
export function toneFaults(file: string, tone: Tone): { faults: Fault[]; warnings: Fault[] } {
  const faults: Fault[] = [];
  const warnings: Fault[] = [];
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  if (tone.light > TONE_LIGHT_CAP) {
    const row = {
      file,
      rule: '4 тон',
      detail: `светлого ${pct(tone.light)} площади, предел ${pct(TONE_LIGHT_CAP)} — на светлой теме теряет силуэт`,
    };
    (tone.light >= TONE_LIGHT_FATAL ? faults : warnings).push(row);
  }
  if (tone.dark > TONE_DARK_CAP) {
    warnings.push({
      file,
      rule: '4 тон',
      detail: `тёмного ${pct(tone.dark)} площади, предел ${pct(TONE_DARK_CAP)} — на тёмной теме обгрызается край`,
    });
  }
  return { faults, warnings };
}

// ---------- один предмет — два значка ----------
//
// Побайтового совпадения мало: подкова, нарисованная дважды разными числами, — это
// всё равно одна подкова, и на экране игрок прочитает два таких значка как один.
// Поэтому сравниваются не байты, а силуэт: файл растеризуется, берётся маска
// непрозрачных пикселей, и две маски сверяются по доле общего (IoU). Заодно
// сверяется набор красок: один предмет обычно и красят одинаково.
//
// Внутри группы похожесть — замысел, а не беда: пять вымпелов отношений, восемь
// фигур бойцов и три рога морали обязаны быть роднёй. Поэтому сравниваются только
// значки из разных групп.
//
// Приговора здесь нет и быть не может: «это один предмет» — суждение, а не число.
// Сборка печатает пары и не падает; разобранные пары кладутся в OBJECTS.md,
// и о них больше не напоминают.

/** Выше этого доля общего силуэта означает «стоит посмотреть глазами». */
const TWIN_IOU = 0.82;
/** И при этом краски должны совпадать хотя бы наполовину. */
const TWIN_PAINT = 0.6;

/** Маска непрозрачных пикселей. `null` — растеризатор недоступен. */
export async function maskOf(text: string): Promise<Uint8Array | null> {
  try {
    const out = await sharp(Buffer.from(text)).raw().toBuffer({ resolveWithObject: true });
    const { data, info } = out;
    const mask = new Uint8Array(info.width * info.height);
    for (let i = 0; i < mask.length; i++) {
      mask[i] = info.channels === 4 ? (data[i * info.channels + 3] > 128 ? 1 : 0) : 1;
    }
    return mask;
  } catch {
    return null;
  }
}

/** Доля общего: пересечение к объединению. */
export function iou(a: Uint8Array, b: Uint8Array): number {
  let both = 0;
  let either = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] || b[i]) either++;
    if (a[i] && b[i]) both++;
  }
  return either === 0 ? 0 : both / either;
}

/** Доля общих красок. */
export function paintShare(a: Set<string>, b: Set<string>): number {
  let both = 0;
  for (const c of a) if (b.has(c)) both++;
  return Math.max(a.size, b.size) === 0 ? 0 : both / Math.max(a.size, b.size);
}

export interface Twin {
  a: string;
  b: string;
  iou: number;
  paint: number;
}

/**
 * Пары из разных групп, у которых силуэт и краски почти совпали. Порядок —
 * от самых похожих: первые в списке и есть повод переделать.
 */
export function findTwins(
  icons: { name: string; mask: Uint8Array; paint: Set<string> }[],
  allowed: Set<string>,
): Twin[] {
  const out: Twin[] = [];
  for (let i = 0; i < icons.length; i++) {
    for (let j = i + 1; j < icons.length; j++) {
      const a = icons[i];
      const b = icons[j];
      if (a.name.split('-')[0] === b.name.split('-')[0]) continue;
      if (allowed.has(pairKey(a.name, b.name))) continue;
      const overlap = iou(a.mask, b.mask);
      if (overlap < TWIN_IOU) continue;
      const paint = paintShare(a.paint, b.paint);
      if (paint < TWIN_PAINT) continue;
      out.push({ a: a.name, b: b.name, iou: overlap, paint });
    }
  }
  return out.sort((x, y) => y.iou - x.iou);
}

/** Ключ пары, не зависящий от порядка. */
export const pairKey = (a: string, b: string): string => [a, b].sort().join(' = ');

/** Разобранные пары: `- \`имя\` = \`имя\`` в OBJECTS.md. */
export function allowedPairs(): Set<string> {
  if (!existsSync(OBJECTS)) return new Set();
  const out = new Set<string>();
  for (const m of readFileSync(OBJECTS, 'utf8').matchAll(/^-\s+`([a-z0-9_-]+)`\s*=\s*`([a-z0-9_-]+)`/gm)) {
    out.add(pairKey(m[1], m[2]));
  }
  return out;
}

// ---------- накладная ----------

export interface Audit {
  /** Файл есть, а идентификатора в игре нет: почти всегда опечатка в имени. */
  extra: string[];
  /** Идентификатор есть, файла нет — и группа уже начата. */
  missing: { name: string; group: string }[];
  /** Группы, к которым ещё не приступали: спрашивать с них нечего. */
  openGroups: string[];
}

/**
 * Сверка папки с накладной. Группа считается сданной, как только пришёл хоть
 * один её файл, — и с этой секунды обязана быть полной. Так очереди подключаются
 * без единой правки кода: пришла вторая — с неё и спросили.
 */
export function auditNames(present: Set<string>, returned: Set<string>): Audit {
  const known = new Set(ICON_MANIFEST);
  const extra = [...present].filter((n) => !known.has(n)).sort();
  const missing: { name: string; group: string }[] = [];
  const openGroups: string[] = [];
  for (const g of ICON_GROUPS) {
    const names = g.ids.map((id) => `${g.prefix}-${id}`);
    if (!names.some((n) => present.has(n) || returned.has(n))) {
      openGroups.push(g.prefix);
      continue;
    }
    for (const n of names) if (!present.has(n) && !returned.has(n)) missing.push({ name: n, group: g.prefix });
  }
  return { extra, missing, openGroups };
}

// ---------- сборка ----------

export function returnedNames(): Set<string> {
  if (!existsSync(RETURNED)) return new Set();
  const out = new Set<string>();
  for (const m of readFileSync(RETURNED, 'utf8').matchAll(/^-\s+`([a-z0-9_-]+)`/gm)) out.add(m[1]);
  return out;
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} КБ`;
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const colors = allowedColors();

  if (!existsSync(SRC)) {
    console.error(`нет папки ${path.relative(ROOT, SRC)} — значки лежат в ней, одним плоским списком`);
    process.exit(1);
  }
  const files = readdirSync(SRC).filter((f) => f.endsWith('.svg')).sort();
  const returned = returnedNames();

  // 1. Формат. Файл, уже отданный на переделку (RETURNED.md), проверяется и
  // печатается, но сборку не роняет: заказ художнику виден, деплой идёт.
  const faults: Fault[] = [];
  const waiting: Fault[] = [];
  const good: { name: string; body: string; bytes: number }[] = [];
  for (const file of files) {
    const text = readFileSync(path.join(SRC, file), 'utf8').trim();
    const name = file.slice(0, -4);
    const own = check(file, text, colors);
    if (own.length > 0) {
      (returned.has(name) ? waiting : faults).push(...own);
      continue;
    }
    good.push({ name, body: text, bytes: Buffer.byteLength(text, 'utf8') });
  }

  // Тон: читается ли значок на светлой панели и на тёмной (техзадание, 4).
  const tone = toneColors();
  const toneWarn: Fault[] = [];
  let toneMeasured = 0;
  for (let i = good.length - 1; i >= 0; i--) {
    const g = good[i];
    const measured = await measureTone(g.body, tone);
    if (measured === null) continue;
    toneMeasured++;
    const { faults: bad, warnings } = toneFaults(`${g.name}.svg`, measured);
    toneWarn.push(...warnings);
    if (bad.length > 0) {
      (returned.has(g.name) ? waiting : faults).push(...bad);
      good.splice(i, 1);
    }
  }


  // Один предмет — два значка. Побайтового совпадения мало: подкова, нарисованная
  // дважды разными числами, — всё равно одна подкова.
  const allowed = allowedPairs();
  const shots: { name: string; mask: Uint8Array; paint: Set<string> }[] = [];
  for (const g of good) {
    const mask = await maskOf(g.body);
    if (mask === null) continue;
    shots.push({
      name: g.name,
      mask,
      paint: new Set([...g.body.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1])),
    });
  }
  const twins = shots.length > 0 ? findTwins(shots, allowed) : [];

  // 2. Накладная.
  const { extra, missing, openGroups } = auditNames(new Set(files.map((f) => f.slice(0, -4))), returned);

  // 3. Лист.
  const symbols = good
    .map((g) => {
      const inner = g.body.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
      return `<symbol id="i-${g.name}" viewBox="0 0 32 32">${inner}</symbol>`;
    })
    .join('');
  const sheet = `<svg xmlns="http://www.w3.org/2000/svg">${symbols}</svg>`;
  const raw = Buffer.byteLength(sheet, 'utf8');
  const gz = gzipSync(Buffer.from(sheet, 'utf8'), { level: 9 }).length;

  // ---------- отчёт ----------
  console.log(`значков в ${path.relative(ROOT, SRC)}: ${files.length}, прошли проверку ${good.length}`);
  console.log(`накладная игры: ${ICON_MANIFEST.length} значков; групп ещё не начато: ${openGroups.length}` +
    (openGroups.length > 0 ? ` (${openGroups.join(', ')})` : ''));

  if (faults.length > 0) {
    console.log(`\nбрак — вернуть художнику (${faults.length}):`);
    for (const f of faults) console.log(`  ${f.file.padEnd(22)} ${f.rule.padEnd(18)} ${f.detail}`);
  }
  if (extra.length > 0) {
    console.log(`\nлишние файлы — такого идентификатора в игре нет (${extra.length}):`);
    for (const n of extra) console.log(`  ${n}.svg`);
  }
  if (missing.length > 0) {
    console.log(`\nнедостающие — группа начата, но не полна (${missing.length}):`);
    for (const m of missing) console.log(`  ${m.name}.svg  (группа ${m.group})`);
  }
  if (waiting.length > 0) {
    console.log(`\nждут переделки (RETURNED.md), сборку не роняют (${waiting.length}):`);
    for (const f of waiting) console.log(`  ${f.file.padEnd(22)} ${f.rule.padEnd(18)} ${f.detail}`);
  }
  const healed = good.filter((g) => returned.has(g.name)).map((g) => g.name);
  if (healed.length > 0) {
    console.log(`\nисправлены и приняты — убрать строки из RETURNED.md: ${healed.join(', ')}`);
  }
  if (toneWarn.length > 0) {
    console.log(`\nтон на грани — читаемость на одной из тем под вопросом (${toneWarn.length}):`);
    for (const f of toneWarn) console.log(`  ${f.file.padEnd(22)} ${f.rule.padEnd(18)} ${f.detail}`);
  }
  if (toneMeasured === 0) {
    console.log('\n! тон не мерялся: растеризатор недоступен');
  }
  if (twins.length > 0) {
    console.log(`\nодин предмет на два значка? — посмотреть глазами (${twins.length}):`);
    for (const pair of twins) {
      const how = `силуэт ${Math.round(pair.iou * 100)}%, краски ${Math.round(pair.paint * 100)}%`;
      console.log(`  ${pairKey(pair.a, pair.b).padEnd(42)} ${how}`);
    }
    console.log(`  разобрал — впиши пару в ${path.relative(ROOT, OBJECTS)}, и о ней больше не напомнят`);
  }

  console.log(`\nлист: ${good.length} символов, ${kb(raw)} на диске, ${kb(gz)} по сети`);
  console.log(`потолок листа ${kb(SHEET_CAP_GZIP)}, занято ${((gz / SHEET_CAP_GZIP) * 100).toFixed(0)}%, ` +
    `остаётся ${kb(SHEET_CAP_GZIP - gz)} на очереди 2 и 3`);
  console.log(`потолок всего двумерного слоя ${kb(ART_CAP_GZIP)} (лист + экран загрузки + запас)`);

  const heavy = [...good].sort((a, b) => b.bytes - a.bytes).slice(0, 3);
  console.log(`самые тяжёлые: ${heavy.map((h) => `${h.name} ${h.bytes} Б`).join(', ')}`);

  // ---------- приговор ----------
  const errors: string[] = [];
  if (faults.length > 0) errors.push(`${faults.length} файлов не прошли проверку формата`);
  if (extra.length > 0) errors.push(`${extra.length} лишних файлов`);
  if (missing.length > 0) errors.push(`${missing.length} значков не хватает в начатых группах`);
  if (gz > SHEET_CAP_GZIP) errors.push(`лист весит ${kb(gz)} при потолке ${kb(SHEET_CAP_GZIP)}`);
  else if (gz > SHEET_CAP_GZIP * WARN_AT) {
    console.log(`\n! лист занял ${((gz / SHEET_CAP_GZIP) * 100).toFixed(0)}% потолка — пора считать байты`);
  }

  if (errors.length > 0) {
    console.error(`\nсборка значков не сошлась: ${errors.join('; ')}`);
    console.error('Брак не правится у себя (техзадание, 5.3): вернуть файлы автору, а их имена');
    console.error(`положить в ${path.relative(ROOT, RETURNED)} — тогда на их месте останется эмодзи.`);
    process.exit(1);
  }

  if (checkOnly) {
    console.log('\n--check: файлы не переписаны');
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_SPRITE, sheet, 'utf8');
  writeFileSync(OUT_DATA, renderData(good.map((g) => g.name), raw, gz), 'utf8');
  console.log(`\nлист:   ${path.relative(ROOT, OUT_SPRITE)}`);
  console.log(`список: ${path.relative(ROOT, OUT_DATA)}`);
}

function renderData(names: string[], raw: number, gz: number): string {
  return `// Файл сгенерирован scripts/build-icons.ts — руками не править.
// Пересобрать: npm run icons:build
//
// Здесь только имена нарисованных значков: по ним интерфейс решает, показать
// картинку или оставить эмодзи. Накладная — то, что игра ждёт, — лежит рядом,
// в registry.ts, и собирается из данных игры.
//
// Лист: ${names.length} символов, ${(raw / 1024).toFixed(1)} КБ на диске, ${(gz / 1024).toFixed(1)} КБ по сети.

export const ICON_SHEET = '/assets/icons/sprite.svg';

export const DRAWN_ICONS: readonly string[] = [
${names.map((n) => `  '${n}',`).join('\n')}
];
`;
}

// Запускается как скрипт, но не под тестом: icons.test.ts импортирует отсюда сами
// проверки и гоняет их на живой папке, и пересобирать лист при этом не должен.
// Путь скрипта в argv не годится: vite-node его оттуда вычищает, — а вот про свой
// прогон vitest сообщает переменной окружения.
if (!process.env.VITEST) {
  main().catch((err) => {
    console.error(err?.message ?? err);
    process.exit(1);
  });
}
