/**
 * Пояс границы: чужая строка — ключ таблицы — и чужое число проверяются здесь (аудит, SETUP-3 и SETUP-4,
 * docs/audit/WORKPLAN.md). Ключ из описи, приказа или сохранения — чужая строка, и `key in TABLE` пускает ключи
 * прототипа: «constructor» и «toString» таблицей не являются, а `TABLE[key]` отдаёт за них функцию. Одна дверь на игру и
 * сервер; чистый модуль без `@/` — его читает и сервер.
 */

/** Своё ли это поле таблицы, а не прототипа. */
export const has = <T extends object>(table: T, key: PropertyKey): key is keyof T => Object.prototype.hasOwnProperty.call(table, key);

/** Значение своего поля таблицы; ключ прототипа и чужой — `undefined`. */
export const own = <T>(table: Readonly<Record<string, T>>, key: string): T | undefined => (has(table, key) ? table[key] : undefined);

/**
 * Число из приказа или описи — чужое число (SETUP-4): целое, конечное, не меньше нуля и не больше `max`. NaN проходил
 * мимо проверок сам: `Math.max(0, Math.floor(NaN))` — NaN, и все сравнения с ним ложны.
 */
export const wholeNonNeg = (v: unknown, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
