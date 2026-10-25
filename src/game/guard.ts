/**
 * Пояс границы: чужая строка — ключ таблицы — проверяется здесь (аудит, SETUP-3, docs/audit/WORKPLAN.md). Ключ из
 * описи, приказа или сохранения — чужая строка, и `key in TABLE` пускает ключи прототипа: «constructor» и «toString»
 * таблицей не являются, а `TABLE[key]` отдаёт за них функцию. Одна дверь на игру и сервер; чистый модуль без `@/` —
 * его читает и сервер.
 */

/** Своё ли это поле таблицы, а не прототипа. */
export const has = <T extends object>(table: T, key: PropertyKey): key is keyof T => Object.prototype.hasOwnProperty.call(table, key);

/** Значение своего поля таблицы; ключ прототипа и чужой — `undefined`. */
export const own = <T>(table: Readonly<Record<string, T>>, key: string): T | undefined => (has(table, key) ? table[key] : undefined);
