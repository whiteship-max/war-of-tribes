// Герб: набор частей и правила геральдики — одни на игру и на сервер (docs/polish.md, П-2).
//
// Герб держав игроков видят соседи (реестр замков, рейтинг, ролики войны), поэтому сервер проверяет его тем же кодом, что
// рисует игра: части только из набора, металл на цвет, запись одна — строка `armsCode`. Клиенту не верим (docs/security.md,
// ЗЩ-1): подделанная строка в заявке реестра — отказ (`contract.readClaim`), в сохранении — герб по умолчанию.
//
// Модуль без `@/` и без зависимостей: его импортирует сервер (`netlify/lib/contract.ts`). Рисунок частей — `art.ts`,
// краски на холсте — `paint.ts`, SVG — `ui/parts/Arms.tsx`.

/** Формы щита. */
export const SHIELDS = ['heater', 'french', 'iberian', 'kite', 'swiss'] as const;
export type Shield = (typeof SHIELDS)[number];

/** Деления поля: простое поле и семь делений на две краски. */
export const DIVISIONS = ['plain', 'pale', 'fess', 'quarterly', 'bend', 'bendSinister', 'saltire', 'chevron'] as const;
export type Division = (typeof DIVISIONS)[number];

/** Финифти: два металла и пять цветов. */
export const TINCTURES = ['or', 'argent', 'gules', 'azure', 'vert', 'sable', 'purpure'] as const;
export type Tincture = (typeof TINCTURES)[number];
export const METALS: readonly Tincture[] = ['or', 'argent'];
export const isMetal = (t: Tincture): boolean => METALS.includes(t);

/** Главные фигуры, которые может взять игрок. */
export const CHARGES = ['lion', 'eagle', 'bear', 'stag', 'tower', 'cross', 'sword', 'keys', 'lily', 'crown', 'star', 'horseshoe'] as const;
/** Фигуры вольницы: только у логов и разбойников, игроку их не дают (сервер отказывает). */
export const WILD_CHARGES = ['axes', 'skull', 'wolf'] as const;
export type Charge = (typeof CHARGES)[number] | (typeof WILD_CHARGES)[number];

export interface Arms {
  shield: Shield;
  division: Division;
  /** Краски поля: у простого поля обе одинаковы. Первая — в главе и правой (от щита) части, вторая — в делении. */
  field: readonly [Tincture, Tincture];
  charge: Charge;
  /** Краска фигуры. */
  tint: Tincture;
}

export const SHIELD_NAMES: Record<Shield, string> = {
  heater: 'Треугольный',
  french: 'Французский',
  iberian: 'Испанский',
  kite: 'Норманнский',
  swiss: 'Швейцарский',
};

export const DIVISION_NAMES: Record<Division, string> = {
  plain: 'Простое поле',
  pale: 'Рассечённый',
  fess: 'Пересечённый',
  quarterly: 'Четверочастный',
  bend: 'Скошенный справа',
  bendSinister: 'Скошенный слева',
  saltire: 'Косвенно четверочастный',
  chevron: 'Стропилообразный',
};

export const TINCTURE_NAMES: Record<Tincture, string> = {
  or: 'Золото',
  argent: 'Серебро',
  gules: 'Червлень',
  azure: 'Лазурь',
  vert: 'Зелень',
  sable: 'Чернь',
  purpure: 'Пурпур',
};

export const CHARGE_NAMES: Record<Charge, string> = {
  lion: 'Лев',
  eagle: 'Орёл',
  bear: 'Медведь',
  stag: 'Олень',
  tower: 'Башня',
  cross: 'Крест',
  sword: 'Меч',
  keys: 'Ключи',
  lily: 'Лилия',
  crown: 'Корона',
  star: 'Звезда',
  horseshoe: 'Подкова',
  axes: 'Топоры',
  skull: 'Череп',
  wolf: 'Волк',
};

/**
 * Герб по умолчанию — прежний герб державы: щит, золотое поле, чёрная башня (`ui/realm/Coat.tsx` до П-2). Его видят
 * старые игроки, не выбиравшие своего, и соседи, чья строка реестра легла до гербов.
 */
export const DEFAULT_ARMS: Arms = { shield: 'heater', division: 'plain', field: ['or', 'or'], charge: 'tower', tint: 'sable' };

/** Потолок строки герба: шесть слов набора через дефис короче сорока знаков, сверх — не наша строка. */
export const ARMS_MAX = 64;

/** Строка герба — одна запись на сохранение, реестр и рейтинг: `щит-деление-краска-краска-фигура-краска`. */
export const armsCode = (a: Arms): string => [a.shield, a.division, a.field[0], a.field[1], a.charge, a.tint].join('-');

/**
 * Что нарушает правило финифти, словами для игрока; `null` — герб правильный. Правило одно — металл на цвет, цвет на
 * металл: у простого поля фигура другого рода, чем поле; у делённого поле — металл и цвет, а фигура не повторяет ни одной
 * его краски (иначе пропала бы на своей половине).
 */
export function armsRule(a: Arms): string | null {
  const [f1, f2] = a.field;
  if (a.division === 'plain') {
    if (f1 !== f2) return 'У простого поля одна краска.';
    if (isMetal(f1) === isMetal(a.tint))
      return isMetal(f1) ? 'Металл на металл не кладут: фигуре нужен цвет.' : 'Цвет на цвет не кладут: фигуре нужен металл.';
    return null;
  }
  if (isMetal(f1) === isMetal(f2)) return 'Деление — металл с цветом: две краски одного рода сливаются.';
  if (a.tint === f1 || a.tint === f2) return 'Фигура пропадёт на своей половине: возьми краску не из поля.';
  return null;
}

const SHIELD_SET = new Set<string>(SHIELDS);
const DIVISION_SET = new Set<string>(DIVISIONS);
const TINCTURE_SET = new Set<string>(TINCTURES);
const CHARGE_SET = new Set<string>(CHARGES);
const WILD_SET = new Set<string>([...CHARGES, ...WILD_CHARGES]);

/** Разбор строки без проверки правила; `wild` — пускать фигуры вольницы (только для показа логов). */
function parse(raw: unknown, wild: boolean): Arms | null {
  if (typeof raw !== 'string' || raw.length > ARMS_MAX) return null;
  const p = raw.split('-');
  if (p.length !== 6) return null;
  const [shield, division, f1, f2, charge, tint] = p;
  if (!SHIELD_SET.has(shield) || !DIVISION_SET.has(division) || !TINCTURE_SET.has(f1) || !TINCTURE_SET.has(f2)) return null;
  if (!(wild ? WILD_SET : CHARGE_SET).has(charge) || !TINCTURE_SET.has(tint)) return null;
  return {
    shield: shield as Shield,
    division: division as Division,
    field: [f1 as Tincture, f2 as Tincture],
    charge: charge as Charge,
    tint: tint as Tincture,
  };
}

/**
 * Герб игрока из строки или `null`: части только из набора игрока, правило финифти соблюдено. Одна дверь на всё: выбор в
 * профиле, сохранение, заявка реестра на сервере, строки реестра и рейтинга на клиенте.
 */
export function readArms(raw: unknown): Arms | null {
  const a = parse(raw, false);
  return a && armsRule(a) === null ? a : null;
}

/** Герб игрока для показа: правильный из строки или герб по умолчанию. */
export const armsOr = (raw: unknown): Arms => readArms(raw) ?? DEFAULT_ARMS;

/** Любой герб для показа — и игрока, и логова (`lairArms`); неразборчивое — герб по умолчанию. */
export const anyArms = (raw: unknown): Arms => parse(raw, true) ?? DEFAULT_ARMS;

const pick = <T>(list: readonly T[], r: () => number): T => list[Math.min(list.length - 1, Math.floor(r() * list.length))];

/**
 * Случайный правильный герб («Случайный» в профиле). `r` — кость в [0, 1): случайности устройства здесь нет (правило
 * проекта, `sim/random.test.ts`), зовущий даёт сеяную — `armsBone`.
 */
export function randomArms(r: () => number): Arms {
  const shield = pick(SHIELDS, r);
  const charge = pick(CHARGES, r);
  // Простое поле — чаще: в настоящих гербах его больше, и оно лучше всего читается мелко.
  const division: Division = r() < 0.4 ? 'plain' : pick(DIVISIONS.slice(1), r);
  const metals = METALS;
  const colours = TINCTURES.filter((t) => !isMetal(t));
  if (division === 'plain') {
    const metalField = r() < 0.4;
    const f = pick(metalField ? metals : colours, r);
    return { shield, division, field: [f, f], charge, tint: pick(metalField ? colours : metals, r) };
  }
  const m = pick(metals, r);
  const c = pick(colours, r);
  const field: [Tincture, Tincture] = r() < 0.5 ? [m, c] : [c, m];
  const tint = pick(
    TINCTURES.filter((t) => t !== m && t !== c),
    r,
  );
  return { shield, division, field, charge, tint };
}

/** Число из строки (FNV-1a): герб логова один и тот же у всех и всегда. */
function hashOf(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Кость из числа (mulberry32): для герба, не для игры. */
function boneOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Сеяная кость герба по строке: «Случайный» в профиле зовёт её от сида партии и номера нажатия. */
export const armsBone = (key: string): (() => number) => boneOf(hashOf(key));

/**
 * Герб разбойников без знания о логове: ворота (`sim/gate`, разбойники события), набег без номера логова. Чёрный
 * норманнский щит, серебряные топоры накрест — прежний знак разбойников в ролике боя.
 */
export const BANDIT_ARMS: Arms = { shield: 'kite', division: 'plain', field: ['sable', 'sable'], charge: 'axes', tint: 'argent' };

/**
 * Герб логова по его номеру — у всех один: тёмное поле, фигура вольницы. Игроку такой не выбрать (`readArms` фигур
 * вольницы не пускает), и герб логова никогда не спутать с гербом соседа.
 */
export function lairArms(id: string): Arms {
  const r = boneOf(hashOf(`lair:${id}`));
  const shield: Shield = r() < 0.6 ? 'kite' : 'heater';
  const charge = pick(WILD_CHARGES, r);
  const dark = pick(['sable', 'gules', 'vert'] as const, r);
  const metal = pick(METALS, r);
  const division: Division = r() < 0.5 ? 'plain' : pick(['bend', 'bendSinister', 'saltire', 'chevron'] as const, r);
  if (division === 'plain') return { shield, division, field: [dark, dark], charge, tint: metal };
  const tint = pick(
    TINCTURES.filter((t) => t !== dark && t !== metal),
    r,
  );
  return { shield, division, field: [dark, metal], charge, tint };
}

/**
 * Привести герб к правилу после правки одной части — правка игрока не теряется, подстраивается остальное: у простого
 * поля — краска фигуры (металл к цвету, цвет к металлу), у делённого — вторая краска поля, потом краска фигуры. Ответ —
 * правильный герб и что сменилось словами (`null` — ничего).
 */
export function fitArms(a: Arms, keep: 'field0' | 'field1' | 'tint' | 'other' = 'other'): { arms: Arms; note: string | null } {
  if (armsRule(a) === null) return { arms: a, note: null };
  const why = armsRule(a);
  const other = (t: Tincture): Tincture => (isMetal(t) ? (t === 'or' ? 'sable' : 'gules') : t === 'sable' ? 'or' : 'argent');
  let [f1, f2] = a.field;
  let tint = a.tint;
  if (a.division === 'plain') {
    if (keep === 'tint') f1 = other(tint);
    f2 = f1;
    if (isMetal(f1) === isMetal(tint)) tint = other(f1);
  } else {
    if (isMetal(f1) === isMetal(f2)) {
      if (keep === 'field1') f1 = other(f2);
      else f2 = other(f1);
    }
    if (tint === f1 || tint === f2) {
      if (keep === 'tint') {
        // Игрок взял краску фигуры из поля — поле уступает: та половина берёт другую краску того же рода.
        const same = TINCTURES.filter((t) => isMetal(t) === isMetal(tint) && t !== tint);
        if (tint === f1) f1 = same[0];
        else f2 = same[0];
      } else tint = TINCTURES.find((t) => t !== f1 && t !== f2) as Tincture;
    }
  }
  const arms: Arms = { ...a, field: [f1, f2], tint };
  const changed: string[] = [];
  if (f1 !== a.field[0] || f2 !== a.field[1]) changed.push('краска поля');
  if (tint !== a.tint) changed.push('краска фигуры');
  return { arms, note: changed.length ? `${why} Сменилась ${changed.join(' и ')}.` : why };
}

type Gender = 'm' | 'f' | 'pl';
const CHARGE_GENDER: Record<Charge, Gender> = {
  lion: 'm',
  eagle: 'm',
  bear: 'm',
  stag: 'm',
  tower: 'f',
  cross: 'm',
  sword: 'm',
  keys: 'pl',
  lily: 'f',
  crown: 'f',
  star: 'f',
  horseshoe: 'f',
  axes: 'pl',
  skull: 'm',
  wolf: 'm',
};

/** Основа прилагательного краски: + «ый/ая/ые/ом». */
const TINCT_STEM: Record<Tincture, [string, string]> = {
  or: ['золот', 'ой'],
  argent: ['серебрян', 'ый'],
  gules: ['червлён', 'ый'],
  azure: ['лазорев', 'ый'],
  vert: ['зелён', 'ый'],
  sable: ['чёрн', 'ый'],
  purpure: ['пурпурн', 'ый'],
};
const adj = (t: Tincture, form: Gender | 'prep'): string => {
  const [stem, m] = TINCT_STEM[t];
  if (form === 'm') return stem + m;
  if (form === 'f') return stem + 'ая';
  if (form === 'pl') return stem + 'ые';
  return stem + 'ом';
};

const DIVISION_PREP: Record<Exclude<Division, 'plain'>, string> = {
  pale: 'рассечённом',
  fess: 'пересечённом',
  quarterly: 'четверочастном',
  bend: 'скошенном справа',
  bendSinister: 'скошенном слева',
  saltire: 'косвенно четверочастном',
  chevron: 'стропилообразно разделённом',
};

/** Блазон — описание герба словами гербовника: «В червлёном поле серебряный лев». */
export function blazon(a: Arms): string {
  const charge = `${adj(a.tint, CHARGE_GENDER[a.charge])} ${CHARGE_NAMES[a.charge].toLowerCase()}`;
  if (a.division === 'plain') return `В ${adj(a.field[0], 'prep')} поле ${charge}.`;
  return `В ${DIVISION_PREP[a.division]} ${adj(a.field[0], 'prep')} и ${adj(a.field[1], 'prep')} щите ${charge}.`;
}
