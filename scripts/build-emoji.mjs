// Белый список эмодзи: кодовые точки со свойством Emoji=Yes в Emoji 12.0.
//
// Эмодзи Emoji 13.0 и новее на части телефонов рисуется пустым квадратом, и ловили это
// дважды подряд глазами в браузере (монета, потом камень). Правило держит тест по
// исходникам (`src/ui/icons/emoji.test.ts`), а этот скрипт собирает то, по чему он
// сверяет, — `src/ui/icons/emoji12.ts`. Руками тот файл не правят.
//
// Источник — таблица Unicode к UTS #51 версии 12.0, свойство `Emoji`:
//   https://www.unicode.org/Public/emoji/12.0/emoji-data.txt
// Лицензия — Unicode License (данные Unicode свободно копируются с указанием источника).
//
// Запуск: `npm run emoji:build` — качает таблицу. Без сети можно подать файл:
// `npm run emoji:build -- путь/к/emoji-data.txt`.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { join } from 'node:path';

const VERSION = '12.0';
const SOURCE = `https://www.unicode.org/Public/emoji/${VERSION}/emoji-data.txt`;
const root = fileURLToPath(new NodeURL('..', import.meta.url));
const outFile = join(root, 'src', 'ui', 'icons', 'emoji12.ts');

const local = process.argv[2];
const text = local ? readFileSync(local, 'utf8') : await (await fetch(SOURCE)).text();

const version = /^# Version: (\S+)/m.exec(text)?.[1];
const date = /^# Date: (.+?)\s*$/m.exec(text)?.[1];
if (version !== VERSION) throw new Error(`ждали таблицу версии ${VERSION}, пришла ${version ?? 'без версии'}`);

// Строка свойства: «1F9FF ; Emoji # 11.0 [1] (…) nazar amulet» или диапазон «2194..2199».
// Прочие свойства файла (Emoji_Presentation, Emoji_Modifier…) — подмножества или не про
// то, есть ли символ вообще, и в список не идут.
const ranges = [];
for (const line of text.split('\n')) {
  const m = /^([0-9A-F]{4,6})(?:\.\.([0-9A-F]{4,6}))?\s*;\s*Emoji\s*#\s*([\d.]+)/.exec(line);
  if (m) ranges.push({ from: m[1], to: m[2] ?? m[1], since: m[3] });
}
if (ranges.length < 100) throw new Error(`в таблице нашлось всего ${ranges.length} диапазонов — формат сменился?`);

const hex = (h) => `0x${h}`;
const body = ranges.map((r) => `  [${hex(r.from)}, ${hex(r.to)}], // ${r.since}`).join('\n');
const out = `// Сгенерирован \`npm run emoji:build\` (scripts/build-emoji.mjs). Руками не править.
//
// Кодовые точки со свойством Emoji=Yes в Emoji ${VERSION} — всё, что тест
// \`emoji.test.ts\` пускает в исходники. Источник:
//   ${SOURCE}
//   (Date: ${date})
// Число в конце строки — из той же таблицы: версия Unicode, в которой появилась кодовая
// точка (не версия эмодзи: ©, например, 1.1).

export const EMOJI_VERSION = '${VERSION}';

export const EMOJI_SOURCE = '${SOURCE}';

/** Включительные диапазоны кодовых точек, в порядке таблицы. */
export const EMOJI_RANGES: readonly (readonly [number, number])[] = [
${body}
];
`;
writeFileSync(outFile, out);
console.log(`emoji: ${ranges.length} диапазонов Emoji ${VERSION} → ${outFile}`);
