/**
 * Драйвер SQLite — встроенный в Node (`node:sqlite`), без зависимостей.
 *
 * Берётся через `require`, а не `import`, по одной причине: `node:sqlite` существует только с
 * приставкой `node:`, а vitest 2 приставку срезает и ищет модуль `sqlite`, которого нет. Обычный
 * импорт работал бы в собранном сервере и падал бы в тестах — то есть проверять пришлось бы не
 * тот код, что работает. Сборка (`build.mjs`) оставляет этот `require` как есть, и в образе он
 * находит модуль Node.
 */
import { createRequire } from 'node:module';
import type * as Sqlite from 'node:sqlite';

export const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof Sqlite;
export type DatabaseSync = Sqlite.DatabaseSync;
