/**
 * Дробь в тексте игрока — запятой (docs/ui_audit.md, 4.5; решение владельца, 14.4, вопрос 2). Одна дверь на всю игру:
 * строка игрока не зовёт `toFixed` сама, а берёт число отсюда — замок `num.test.ts` по исходникам. Здесь только запись
 * числа, без знака: знак — `ui/parts/signed`, сокращение тысяч — `ui/parts/shortNum`, сроки — `game/span`.
 */

const trim = (text: string): string => (text.includes(',') ? text.replace(/,?0+$/, '') : text);

/** Ровно `digits` знаков после запятой: «1,05», «0,5», «12,0». */
export const dec = (n: number, digits = 1): string => n.toFixed(digits).replace('.', ',');

/** Не больше `digits` знаков, без лишних нулей: «4,5», «9», «0,25». */
export const num = (n: number, digits = 1): string => trim(dec(n, digits));
