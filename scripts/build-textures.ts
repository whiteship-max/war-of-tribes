/**
 * Текстуры предыстории: исходники Poly Haven → WebP в `public/assets/prologue/`.
 *
 * Опись — одна на игру и на сборку (`src/prologue/textures.ts`, `SETS`): откуда набор,
 * чей он и сколько метров на образец. Лицензия у всего — CC0; источник и автор каждого
 * файла записаны там же и в docs/prologue.md, раздел 21.
 *
 * ИСХОДНИКИ В РЕПОЗИТОРИЙ НЕ ЕДУТ, как паки музыки и земля мира: они лежат в
 * `assets-src/prologue/cache/` (в `.gitignore`) и качаются этим же скриптом с ключом
 * `--fetch` — по адресам, которые отдаёт API Poly Haven, с проверкой md5 из того же
 * ответа. В репозиторий уезжает результат — он и есть то, что едет игроку.
 *
 * ЧТО ДЕЛАЕТСЯ С КАРТАМИ. Берутся три карты 1k: цвет (`diff`), нормаль OpenGL
 * (`nor_gl`) и ARM (затенение складок, шероховатость, металл). Из них два файла без
 * альфы (почему без альфы — в описи):
 *   `<набор>-c-<px>.webp` — цвет, затенение складок запечено в него (`AO_BAKE`);
 *   `<набор>-d-<px>.webp` — нормаль по X и Y и шероховатость.
 * Размеров два (`SIZES`): 1024 — полной ступени, 512 — телефону и полу.
 *
 * Запуск: npm run textures:build            — собрать из того, что в кэше;
 *         npm run textures:build -- --fetch — докачать недостающие исходники и собрать.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { budgetCores } from './lib/budget';
import { SETS, SIZES, fileOf, type TexSet } from '../src/prologue/textures';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CACHE = join(ROOT, 'assets-src', 'prologue', 'cache');
const OUT = join(ROOT, 'public', 'assets', 'prologue');
const FETCH = process.argv.includes('--fetch');

/** Карты Poly Haven, которые берутся: имя в API и суффикс файла в кэше. */
const MAPS = [
  { api: 'Diffuse', key: 'diff' },
  { api: 'nor_gl', key: 'nor_gl' },
  { api: 'arm', key: 'arm' },
] as const;

/**
 * Насколько затенение складок ложится в цвет. Не целиком: складки у нас затеняет ещё
 * и свет (нормаль), и полное затенение в цвете дало бы их дважды — снег в чёрных
 * порах, а не в синих.
 */
const AO_BAKE = 0.75;

/**
 * Качество WebP. Цвет терпит сжатие, нормаль — хуже: на квадратах сжатия свет
 * ломается ступеньками. Числа подобраны так, чтобы ступенек не было видно на
 * кадре-мериле вблизи (колода, камни очага), и записаны вместе с весом в
 * docs/prologue.md, раздел 21.
 */
const Q_COLOR = 82;
const Q_DATA = 84;

/**
 * Потолок веса всех текстур в папке, КБ, — обоих размеров вместе. Игроку едет один
 * размер: телефону 512, настольному 1024. Загрузка предыстории до десяти секунд
 * допустима (решение владельца), но потолок нужен, чтобы вес не рос молча: скрипт
 * падает, если сборка в него не влезла, как у музыки. Тяжелее всего данные хвои и
 * подстилки: мелкий рисунок сжимается хуже ровного снега.
 */
const WEIGHT_CAP_KB = 6000;

/** Килобайт — тысяча байт, как у описи `npm run build` и у vite: числа обязаны сходиться. */
const KB = 1000;

const file = (set: TexSet, key: string): string => join(CACHE, `${set.source.id}_${key}_1k.jpg`);

async function fetchSet(set: TexSet): Promise<void> {
  const res = await fetch(`https://api.polyhaven.com/files/${set.source.id}`);
  if (!res.ok) throw new Error(`Poly Haven: ${set.source.id} — ${res.status}`);
  const files = (await res.json()) as Record<string, Record<string, Record<string, { url: string; md5: string; size: number }>>>;
  for (const m of MAPS) {
    const out = file(set, m.key);
    if (existsSync(out)) continue;
    const f = files[m.api]?.['1k']?.jpg;
    if (!f) throw new Error(`Poly Haven: у ${set.source.id} нет карты ${m.api} 1k jpg`);
    const bin = Buffer.from(await (await fetch(f.url)).arrayBuffer());
    const md5 = createHash('md5').update(bin).digest('hex');
    if (md5 !== f.md5) throw new Error(`Poly Haven: ${f.url} — md5 ${md5}, а в описи ${f.md5}`);
    writeFileSync(out, bin);
    console.log(`  скачан ${set.source.id}_${m.key}_1k.jpg  ${(bin.length / KB).toFixed(0)} КБ`);
  }
}

async function raw(path: string, size: number): Promise<Buffer> {
  return sharp(path).resize(size, size, { fit: 'fill', kernel: 'lanczos3' }).removeAlpha().raw().toBuffer();
}

async function build(set: TexSet, size: number): Promise<{ c: number; d: number }> {
  const diff = await raw(file(set, 'diff'), size);
  const arm = await raw(file(set, 'arm'), size);
  const nor = await raw(file(set, 'nor_gl'), size);
  const n = size * size;
  const color = Buffer.alloc(n * 3);
  const data = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i++) {
    const ao = 1 - AO_BAKE * (1 - arm[i * 3] / 255);
    // Цвет sRGB, затенение линейное: складка темнит свет, а не записанное число.
    for (let c = 0; c < 3; c++) {
      const lin = Math.pow(diff[i * 3 + c] / 255, 2.2) * ao;
      color[i * 3 + c] = Math.round(Math.pow(lin, 1 / 2.2) * 255);
    }
    data[i * 3] = nor[i * 3];
    data[i * 3 + 1] = nor[i * 3 + 1];
    data[i * 3 + 2] = arm[i * 3 + 1];
  }
  const opts = { width: size, height: size, channels: 3 as const };
  const c = await sharp(color, { raw: opts }).webp({ quality: Q_COLOR, effort: 6 }).toBuffer();
  const d = await sharp(data, { raw: opts }).webp({ quality: Q_DATA, effort: 6 }).toBuffer();
  writeFileSync(join(OUT, fileOf(set.name, 'c', size as 1024 | 512)), c);
  writeFileSync(join(OUT, fileOf(set.name, 'd', size as 1024 | 512)), d);
  return { c: c.length, d: d.length };
}

async function main(): Promise<void> {
  // Бюджет железа (CLAUDE.md): sharp по умолчанию берёт потоками все ядра.
  sharp.concurrency(budgetCores());
  mkdirSync(CACHE, { recursive: true });
  const missing = SETS.filter((s) => MAPS.some((m) => !existsSync(file(s, m.key))));
  if (missing.length && !FETCH) {
    console.error(`Нет исходников: ${missing.map((s) => s.source.id).join(', ')}.`);
    console.error('Докачать с Poly Haven: npm run textures:build -- --fetch');
    process.exit(1);
  }
  for (const s of missing) await fetchSet(s);

  // Папка вывода — только этого скрипта: лишнее из неё уходит, иначе файл, выпавший
  // из описи, лежал бы рядом и уезжал игроку.
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  let total = 0;
  const bySize = new Map<number, number>();
  console.log(`\n  ${'набор'.padEnd(9)} ${'ассет Poly Haven'.padEnd(20)} ${SIZES.map((s) => `${s}: цвет + данные`.padEnd(24)).join('')}`);
  for (const set of SETS) {
    const row: string[] = [];
    for (const size of SIZES) {
      const w = await build(set, size);
      total += w.c + w.d;
      bySize.set(size, (bySize.get(size) ?? 0) + w.c + w.d);
      row.push(`${(w.c / KB).toFixed(0)} + ${(w.d / KB).toFixed(0)} КБ`.padEnd(24));
    }
    console.log(`  ${set.name.padEnd(9)} ${set.source.id.padEnd(20)} ${row.join('')}`);
  }
  for (const [size, bytes] of bySize) console.log(`  всего ${size}: ${(bytes / KB).toFixed(0)} КБ`);
  const kb = total / KB;
  console.log(`  всего в public/assets/prologue: ${kb.toFixed(0)} КБ, файлов ${readdirSync(OUT).length}`);
  if (kb > WEIGHT_CAP_KB) {
    console.error(`текстуры не влезли в потолок ${WEIGHT_CAP_KB} КБ`);
    process.exit(1);
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
