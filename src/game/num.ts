/**
 * Дробь в тексте игрока — запятой (docs/ui_audit.md, 4.5; решение владельца, 14.4, вопрос 2). Одна дверь на всю игру:
 * строка игрока не зовёт `toFixed` сама, а берёт число отсюда — замок `num.test.ts` по исходникам. Здесь только запись
 * числа, без знака: знак — `ui/parts/signed`, сокращение тысяч — `ui/parts/shortNum`, сроки — `game/span`.
 */

const trim = (text: string): string => (text.includes(',') ? text.replace(/,?0+$/, '') : text);

/**
 * Ровно `digits` знаков после запятой: «1,05», «0,5», «12,0». Округлилось до нуля — без знака (ECO-7): `toFixed` оставляет
 * минус у −0,04, и игрок читал «-0».
 */
export const dec = (n: number, digits = 1): string => {
  const t = n.toFixed(digits);
  return (Number(t) === 0 ? t.replace('-', '') : t).replace('.', ',');
};

/** Не больше `digits` знаков, без лишних нулей: «4,5», «9», «0,25». */
export const num = (n: number, digits = 1): string => trim(dec(n, digits));

/**
 * Целое со знаком для строки игрока: «+4», «−2» (минус длинный), ноль — «0» (ECO-7). Знак берётся у округлённого числа:
 * прежние копии в вестях, указах и вестях державы ставили «−» всему, что не больше нуля, и печатали «−0».
 */
export const signedWhole = (n: number): string => {
  const r = Math.round(n);
  return r === 0 ? '0' : `${r > 0 ? '+' : '−'}${Math.abs(r)}`;
};
