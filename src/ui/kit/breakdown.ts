// Разбор числа для подсказки (docs/ui_v2.md, раздел 2, правило «каждая цифра объяснима»): «откуда +152 в день» —
// строками слагаемых и итогом. Чистая функция без React: числа приносит вызывающий из функций игры (`derived`,
// `sim/*`), здесь только запись, порядок и проверка, что строки складываются в итог (правило 18: своей арифметики у
// строки нет — разбор не считает слагаемые, а сверяет их с итогом, который показан на экране).
import type { TipContent, TipLink, TipRow } from '@/ui/next/tip';
import { TIP_ROWS_MAX } from '@/ui/next/tip';
import { rate } from '@/ui/next/hudTips';
import type { IconName } from '@/ui/icons/alias';

/** Слагаемое числа: имя, вклад со знаком, значок и дверь к источнику (`kit/sources`). */
export interface Part {
  label: string;
  value: number;
  icon?: IconName;
  go?: () => void;
}

export interface BreakdownSpec {
  title: string;
  /** Итог — то самое число игры, что стоит на экране. Разбор его не считает, а объясняет. */
  total: number;
  parts: readonly Part[];
  /** Запись слагаемого и итога; по умолчанию — ставка со знаком (`hudTips.rate`: «+43,4», запись одна на игру). */
  fmt?: (n: number) => string;
  /** Запись итога, если она не та, что у слагаемых: цель морали — «72», а не «+72,0». По умолчанию — `fmt`. */
  sumFmt?: (n: number) => string;
  /** Подпись итога. */
  sumLabel?: string;
  /** Одна строка над разбором — правило, а не числа. */
  body?: string;
  /** Дверь «к источнику» внизу плашки — окно, где число видно целиком и где его меняют. */
  link?: TipLink;
  /** Расхождение меньше этого — запись, а не дыра в разборе. */
  eps?: number;
}

/** Подпись строки, которой разбор называет необъяснённый остаток. Её не должно быть: тест сверяет каждый разбор. */
export const REST_LABEL = 'Прочее';

/** Слагаемые, которые пишутся строками: нулевые — нет (как в EU4: строка без вклада — шум). */
const liveParts = (spec: Pick<BreakdownSpec, 'parts' | 'eps'>): Part[] => spec.parts.filter((p) => Math.abs(p.value) > (spec.eps ?? 0.05));

/**
 * Сколько итога не покрыто строками разбора — тем, что игрок увидит. Считается по показанным слагаемым, а не по всем
 * поданным: слагаемое, выпавшее из строк, — тоже дыра в разборе, и она обязана стать видна. Ноль — разбор полный.
 */
export function restOf(spec: Pick<BreakdownSpec, 'total' | 'parts' | 'eps'>): number {
  const sum = liveParts(spec).reduce((a, p) => a + p.value, 0);
  const rest = spec.total - sum;
  return Math.abs(rest) <= (spec.eps ?? 0.05) ? 0 : rest;
}

const toneOf = (n: number): TipRow['tone'] => (n > 0 ? 'good' : n < 0 ? 'bad' : 'muted');

/**
 * Подсказка с разбором. Нулевые слагаемые не пишутся (`liveParts`). Слагаемых больше, чем влезает в подсказку, — мелкие
 * складываются в одну строку «Ещё N»; непокрытый остаток пишется строкой `REST_LABEL`, чтобы строки всегда складывались
 * в итог на глазах игрока, а дыра в разборе была видна, а не спрятана.
 */
export function breakdown(spec: BreakdownSpec): TipContent {
  const fmt = spec.fmt ?? rate;
  const live = liveParts(spec);
  const rest = restOf(spec);
  const room = TIP_ROWS_MAX - (rest !== 0 ? 1 : 0);
  let shown: Part[] = live;
  if (live.length > room) {
    // Крупные — поимённо, мелкие — одной строкой: по модулю вклада, порядок крупных — как у вызывающего.
    const big = new Set([...live].sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, room - 1));
    const small = live.filter((p) => !big.has(p));
    shown = [...live.filter((p) => big.has(p)), { label: `Ещё ${small.length}`, value: small.reduce((a, p) => a + p.value, 0) }];
  }
  const rows: TipRow[] = shown.map((p) => ({ label: p.label, value: fmt(p.value), tone: toneOf(p.value), icon: p.icon, go: p.go }));
  if (rest !== 0) rows.push({ label: REST_LABEL, value: fmt(rest), tone: 'muted' });
  return {
    title: spec.title,
    body: spec.body,
    rows,
    sum: { label: spec.sumLabel ?? 'Итого', value: (spec.sumFmt ?? fmt)(spec.total), tone: toneOf(spec.total) },
    link: spec.link,
  };
}
