// Исполнитель разделов `roam:report`: раздел получает входы только тем, что объявил, и статус ему выводится из родов
// объявленного, а не пишется руками (ПН-0ч, docs/gdd/path_of_sword.md, раздел 11).
//
// Три замка, и все — от одной беды: число на заглушке, напечатанное как выведенное.
//   1. Вход читается только через `Ctx.use`, и только объявленный в `Section.uses`; необъявленный — исключение. Модуль входов
//      читает только этот файл (тест по исходникам): разделу больше неоткуда взять заглушку.
//   2. Статус раздела — `statusOf(uses)`: хоть одна заглушка — «НЕ ИЗМЕРЕНО», и шапка называет каждую с пачкой, которая её
//      заменит. Слова «выведено» у такого раздела быть не может.
//   3. Выведенное одним разделом для другого (`Ctx.share` / `Ctx.take`) несёт входы, на которых оно выведено: взявший обязан
//      объявить их все, иначе исключение — заглушка не проходит через чужой раздел очищенной.
// С ПН-3 у заглушки есть второй путь в раздел — дверь пути, которая сама читает заглушку игры (`game/roamstubs.roamStub`: фураж
// лагеря, место выхода). Его держит сторож чтений (`watchStubs`): раздел, через дверь прочитавший заглушку, которой не объявил, —
// то же исключение, что и у `Ctx.use`.
import { watchStubs } from '../../src/game/roamstubs';
import { INPUTS, TARGETS, type InputId, type InputValue, type TargetId } from './inputs';

/** Размер прогона: малый — облако и дом, полный — ночь на сервере (`ROAM_SIZE=full`, deploy/ci/night-inner.sh). */
export interface Size {
  name: 'малый' | 'полный';
  /** Партий автопилота на стиль и происхождение. */
  seeds: number;
  /** Шагов вывода силы НПС неподвижной точкой, не больше. */
  steps: number;
  /** Боёв на точку ровного боя. */
  even: number;
  /** Расселений на строку пула. */
  pool: number;
  /** Партий НФТ-старта под паритет. */
  nft: number;
  /** Проб на строку доли обнаружений. */
  sight: number;
}

export const SIZES: Record<'small' | 'full', Size> = {
  small: {
    name: 'малый',
    seeds: 4,
    steps: 6,
    even: 12,
    pool: 2,
    nft: 1,
    sight: 2000,
  },
  full: {
    name: 'полный',
    seeds: 24,
    steps: 8,
    even: 24,
    pool: 6,
    nft: 3,
    sight: 20000,
  },
};

export function sizeOf(raw: string | undefined): Size {
  const v = (raw ?? '').trim();
  if (v === '' || v === 'small') return SIZES.small;
  if (v === 'full') return SIZES.full;
  throw new Error(`ROAM_SIZE=${v}: бывает small (по умолчанию) или full`);
}

export type Status = 'выведено' | 'формула ГДД' | 'НЕ ИЗМЕРЕНО';

/** Статус раздела по родам объявленных входов: заглушка сильнее правила, правило сильнее двери. */
export function statusOf(uses: readonly InputId[]): Status {
  const kinds = uses.map((k) => INPUTS[k].kind);
  if (kinds.includes('stub')) return 'НЕ ИЗМЕРЕНО';
  if (kinds.includes('rule')) return 'формула ГДД';
  return 'выведено';
}

const markOf = (k: InputId): string => {
  const i: { kind: string; orient?: boolean } = INPUTS[k];
  return i.kind === 'stub' ? (i.orient === false ? 'число прибора' : 'ориентир') : 'правило';
};

/** Легенда входов — одна на отчёт: имя, род, раздел ГДД, пачка, что это. Разделы называют входы именами. */
export function inputLines(): string[] {
  return (Object.keys(INPUTS) as InputId[]).map((k) => {
    const i = INPUTS[k];
    return `  ${k.padEnd(13)} ${markOf(k).padEnd(13)} ГДД ${i.gdd.padEnd(7)} → ${i.batch.padEnd(6)} ${i.what}`;
  });
}

/** Строки шапки: статус и что его дало — заглушки и правила именами (легенда — в начале отчёта), двери кода, пачки. */
export function statusLines(s: Pick<Section, 'uses' | 'doors'>): string[] {
  const status = statusOf(s.uses);
  const stubs = s.uses.filter((k) => INPUTS[k].kind === 'stub');
  const rules = s.uses.filter((k) => INPUTS[k].kind === 'rule');
  const out = [`статус: ${status}`];
  if (stubs.length > 0) out.push(`  на заглушках (${stubs.length}): ${stubs.join(', ')}`);
  if (rules.length > 0) out.push(`  по правилам ГДД, кода нет (${rules.length}): ${rules.join(', ')}`);
  if (s.doors.length > 0) out.push(`  двери кода: ${s.doors.join(', ')}`);
  const batches = [...new Set([...stubs, ...rules].map((k) => INPUTS[k].batch))].sort();
  if (status !== 'выведено') out.push(`  выведено станет с пачками: ${batches.join(', ')}`);
  return out;
}

/** Выведенное разделом для других — со входами, на которых выведено. */
interface Shared {
  value: unknown;
  uses: readonly InputId[];
  by: string;
}

export interface Ctx {
  readonly size: Size;
  /** Вход, объявленный разделом; необъявленный — исключение. */
  use<K extends InputId>(k: K): InputValue<K>;
  /** Сравнение с целью ГДД — строкой: само число цели разделу не отдаётся. */
  target(id: TargetId, x: number, fmt?: (x: number) => string): string;
  line(text?: string): void;
  /** Отдать выведенное другим разделам: оно несёт все входы этого раздела. */
  share(key: string, value: unknown): void;
  /** Взять выведенное другим разделом: его входы должны быть объявлены и здесь. */
  take<T>(key: string): T;
}

export interface Section {
  id: string;
  title: string;
  /** Разделы ГДД. */
  gdd: string;
  /** Двери кода, которые раздел зовёт (для шапки; входами они не бывают). */
  doors: readonly string[];
  /** Входы — правила и заглушки, — которые раздел читает. */
  uses: readonly InputId[];
  run(ctx: Ctx): void | Promise<void>;
}

const fmtDefault = (x: number): string => (Math.abs(x) >= 100 ? String(Math.round(x)) : x.toFixed(2));

/** Где выведенное лежит у цели: «в цели», «ниже цели (от 4)», «выше цели (до 6)». */
export function against(id: TargetId, x: number, fmt: (x: number) => string = fmtDefault): string {
  const t: {
    lo?: number;
    hi?: number;
    unit: string;
    gdd: string;
    what: string;
  } = TARGETS[id];
  const range =
    t.lo !== undefined && t.hi !== undefined
      ? t.lo === t.hi
        ? fmt(t.lo)
        : `${fmt(t.lo)}…${fmt(t.hi)}`
      : t.lo !== undefined
        ? `от ${fmt(t.lo)}`
        : `до ${fmt(t.hi ?? 0)}`;
  const where = Number.isNaN(x) ? 'нечем сравнить' : t.lo !== undefined && x < t.lo ? 'ниже цели' : t.hi !== undefined && x > t.hi ? 'выше цели' : 'в цели';
  return `${where} (${t.what} ${range}${t.unit}, ГДД ${t.gdd})`;
}

export class Undeclared extends Error {}

/**
 * Прогон разделов по порядку. Строки идут в `out` по мере счёта — смотреть на прибор по ходу можно; итог — сводка статусов.
 * `only` — ид разделов, которые гнать (для тестов); выведенное пропущенным разделом брать нельзя — исключение.
 */
export async function render(sections: readonly Section[], size: Size, out: (line: string) => void, only?: ReadonlySet<string>): Promise<Map<string, Status>> {
  const shared = new Map<string, Shared>();
  const done = new Map<string, Status>();
  for (const [i, s] of sections.entries()) {
    if (only && !only.has(s.id)) continue;
    const declared = new Set<InputId>(s.uses);
    out('');
    out(`━━ ${i + 1}. ${s.title} (ГДД ${s.gdd}) ━━`);
    for (const l of statusLines(s)) out(l);
    const ctx: Ctx = {
      size,
      use: (k) => {
        if (!declared.has(k)) throw new Undeclared(`раздел «${s.title}» читает вход ${k}, не объявив его в uses`);
        return INPUTS[k].value as InputValue<typeof k>;
      },
      target: (id, x, fmt) => against(id, x, fmt),
      line: (text = '') => out(text === '' ? '' : `  ${text}`),
      share: (key, value) => shared.set(key, { value, uses: s.uses, by: s.title }),
      take: <T>(key: string): T => {
        const got = shared.get(key);
        if (!got) throw new Undeclared(`раздел «${s.title}» берёт «${key}», которого никто до него не вывел`);
        const missing = got.uses.filter((k) => !declared.has(k));
        if (missing.length > 0) throw new Undeclared(`раздел «${s.title}» берёт «${key}» из «${got.by}», не объявив его входы: ${missing.join(', ')}`);
        return got.value as T;
      },
    };
    let stray: string | null = null;
    watchStubs((id) => {
      if (!declared.has(id)) stray ??= `раздел «${s.title}» читает заглушку игры ${id} дверью, не объявив её в uses`;
    });
    try {
      await s.run(ctx);
    } finally {
      watchStubs(null);
    }
    if (stray !== null) throw new Undeclared(stray);
    done.set(s.id, statusOf(s.uses));
  }
  const count = (st: Status): number => [...done.values()].filter((v) => v === st).length;
  const batches = [...new Set(sections.filter((s) => done.has(s.id)).flatMap((s) => s.uses.map((k) => INPUTS[k].batch)))].sort();
  out('');
  out(`━━ Итог: выведено ${count('выведено')}, по формуле ГДД ${count('формула ГДД')}, не измерено ${count('НЕ ИЗМЕРЕНО')} из ${done.size} ━━`);
  if (batches.length > 0) out(`  входы заменят дверями кода пачки: ${batches.join(', ')}`);
  return done;
}

/** Реестр ориентиров ГДД строками: где ориентир — вход или цель прибора, а где его меряют не здесь. */
export function orientLines(
  orients: readonly {
    gdd: string;
    what: string;
    in?: readonly string[];
    not?: string;
  }[],
  titles: ReadonlyMap<string, string>,
): string[] {
  const stubs = new Map<string, InputId[]>();
  for (const [id, i] of Object.entries(INPUTS) as [InputId, (typeof INPUTS)[InputId]][]) {
    if (i.kind === 'stub') stubs.set(i.gdd, [...(stubs.get(i.gdd) ?? []), id]);
  }
  const out: string[] = [];
  for (const o of orients) {
    const where = (o.in ?? []).map((s) => `«${titles.get(s) ?? s}»`).join(', ');
    const as = stubs.has(o.gdd) ? 'заглушка' : (Object.values(TARGETS) as { gdd: string }[]).some((t) => t.gdd === o.gdd) ? 'цель' : 'вход';
    const parts = [where ? `${as} в ${where}` : '', o.not ? `не здесь: ${o.not}` : ''].filter(Boolean);
    out.push(`  ${o.gdd.padEnd(7)} ${o.what} — ${parts.join('; ')}`);
  }
  return out;
}
