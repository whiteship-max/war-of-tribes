/**
 * Нарезка листов аватаров на файлы для игры.
 *
 *     node scripts/slice-avatars.mjs
 *
 * Читает assets-src/avatars/sheet{1,2,3}.png — три листа по восемь персонажей,
 * сетка 4×2, порядок чтения слева направо и сверху вниз. Кладёт в
 * public/assets/avatars/ по два файла на персонажа:
 *
 *   <id>_card.webp — карточка целиком, как на листе, 384 px по длинной стороне;
 *   <id>_face.webp — квадрат по голове и плечам, 128 px.
 *
 * Заодно перезаписывает src/data/avatars.ts.
 *
 * Апскейла нет нигде. Ячейка листа ≈ 336×493, голова в ней около сотни
 * пикселей по высоте — поэтому 128 у лица это потолок, а не пожелание.
 * Заменят листы на более мелкие — кроп выйдет меньше 128 и таким и останется:
 * мелкий и резкий лучше крупного и мыльного (см. OUT_FACE ниже).
 *
 * Дизайн персонажей скрипт не трогает: он только режет рамку кадра и
 * уменьшает. Ни поворотов, ни растяжений, ни подгонки под каждого — правило
 * кроя одно на все 24 карточки.
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'assets-src', 'avatars')
const OUT = path.join(ROOT, 'public', 'assets', 'avatars')
const DATA = path.join(ROOT, 'src', 'data', 'avatars.ts')

// --- геометрия листа -------------------------------------------------------
//
// Все три листа сделаны одним генератором и имеют одну раскладку: 1448×1086,
// восемь карточек с полями и просветами между ними. Наивное деление на 4×2
// резало бы по рамкам, поэтому границы карточек измерены по листам, а не
// вычислены делением.
//
// Измерялось так: проекция горизонтального градиента по столбцам и
// вертикального по строкам — рамка карточки даёт линию во всю её высоту или
// ширину. Совпало на всех трёх листах с точностью до пикселя-двух.
//
// Заменят листы — сверить эти числа заново (см. SHEET_W/SHEET_H: на другом
// размере листа скрипт откажется работать, а не нарежет молча мимо).

const SHEET_W = 1448
const SHEET_H = 1086

const COLS = [[27, 362], [382, 713], [732, 1064], [1083, 1419]] // левый и правый край карточки
const ROWS = [[52, 543], [556, 1048]]                           // верхний и нижний край

// Карточки на листе отличаются на пару пикселей (336, 332, 333, 337 по
// ширине). Режем всех одной рамкой по центру карточки: тогда у всех 24
// одинаковый масштаб персонажа и одинаковый размер файла. Рамка чуть больше
// самой широкой карточки, чтобы ни у кого не срезало обводку; узким достаётся
// пара пикселей просвета того же цвета, что и фон карточки.
const CARD_W = 338
const CARD_H = 494

// --- правило кроя лица -----------------------------------------------------
//
// Одно на все 24: квадрат фиксированной доли от высоты ячейки, отсчёт сверху,
// по горизонтали — по центру карточки. Персонажи нарисованы по одному
// шаблону, головы стоят в одном месте, поэтому подгонка под каждого не нужна
// и запрещена: она бы дала 24 разных кадрирования.
const FACE_TOP = 0.02  // отступ верха квадрата от верха ячейки
const FACE_SIDE = 0.325 // сторона квадрата в долях высоты ячейки

// --- размеры на выходе -----------------------------------------------------
const OUT_CARD = 384 // по длинной стороне
const OUT_FACE = 128 // потолок, а не цель: кроп меньше 128 не растягиваем
const QUALITY = 88   // webp, вилка заказчика 80–90

// --- персонажи, в порядке чтения листов ------------------------------------
const CHARACTERS = [
  // sheet1
  { id: '01_swordsman', name: 'Мечник' },
  { id: '02_spearman', name: 'Копейщик' },
  { id: '03_archer', name: 'Лучник' },
  { id: '04_cavalry_knight', name: 'Конный рыцарь' },
  { id: '05_female_archer', name: 'Лучница' },
  { id: '06_female_swordswoman', name: 'Мечница' },
  { id: '07_blacksmith', name: 'Кузнец' },
  { id: '08_healer', name: 'Травница' },
  // sheet2
  { id: '09_crossbowman', name: 'Арбалетчик' },
  { id: '10_heavy_knight', name: 'Латник' },
  { id: '11_halberdier', name: 'Алебардист' },
  { id: '12_king', name: 'Король' },
  { id: '13_queen', name: 'Королева' },
  { id: '14_female_cavalry', name: 'Всадница' },
  { id: '15_female_crossbow', name: 'Арбалетчица' },
  { id: '16_monk', name: 'Монах' },
  // sheet3
  { id: '17_duke', name: 'Герцог' },
  { id: '18_duchess', name: 'Герцогиня' },
  { id: '19_axeman', name: 'Топорник' },
  { id: '20_guard_captain', name: 'Капитан стражи' },
  { id: '21_female_spearman', name: 'Копейщица' },
  { id: '22_noblewoman', name: 'Знатная дама' },
  { id: '23_merchant', name: 'Торговец' },
  { id: '24_innkeeper', name: 'Трактирщица' },
]

const PER_SHEET = COLS.length * ROWS.length

/** Рамка ячейки: одна и та же ширина и высота, посаженная по центру карточки. */
function cellBox(row, col) {
  const [x0, x1] = COLS[col]
  const [y0, y1] = ROWS[row]
  return {
    left: Math.round((x0 + x1) / 2 - CARD_W / 2),
    top: Math.round((y0 + y1) / 2 - CARD_H / 2),
    width: CARD_W,
    height: CARD_H,
  }
}

/** Квадрат по голове и плечам внутри ячейки — правило одно на всех. */
function faceBox(cell) {
  const side = Math.round(CARD_H * FACE_SIDE)
  return {
    left: cell.left + Math.round((CARD_W - side) / 2),
    top: cell.top + Math.round(CARD_H * FACE_TOP),
    width: side,
    height: side,
  }
}

async function main() {
  if (CHARACTERS.length !== PER_SHEET * 3) {
    throw new Error(`ожидалось ${PER_SHEET * 3} персонажей, в списке ${CHARACTERS.length}`)
  }

  // Каталог пересобирается с нуля: переименовали персонажа — старый файл
  // не должен остаться лежать и уехать в сборку.
  await rm(OUT, { recursive: true, force: true })
  await mkdir(OUT, { recursive: true })
  await mkdir(path.dirname(DATA), { recursive: true })

  const faceSide = Math.round(CARD_H * FACE_SIDE)
  const faceOut = Math.min(OUT_FACE, faceSide)
  const cardOut = OUT_CARD
  if (faceOut < OUT_FACE) {
    console.log(`лицо: кроп ${faceSide} px, оставляю ${faceOut} px — апскейла не делаю`)
  }
  if (cardOut > Math.max(CARD_W, CARD_H)) {
    throw new Error('карточка: OUT_CARD больше исходной ячейки, это апскейл')
  }

  const rows = []
  let total = 0

  for (let sheet = 1; sheet <= 3; sheet++) {
    const file = path.join(SRC, `sheet${sheet}.png`)
    // Листы лежат в репозитории, так что пропасть они могут только если их
    // подвинули руками. Скажем об этом словами, а не упадём на ENOENT.
    if (!existsSync(file)) {
      throw new Error(
        `нет ${path.relative(ROOT, file)}. Листы лежат в репозитории — верни файл ` +
        `на место (git checkout ${path.relative(ROOT, SRC).replace(/\\/g, '/')}) и запусти снова. ` +
        `Готовая нарезка при этом уже лежит в ${path.relative(ROOT, OUT)}.`,
      )
    }
    const image = sharp(file)
    const meta = await image.metadata()
    if (meta.width !== SHEET_W || meta.height !== SHEET_H) {
      throw new Error(
        `sheet${sheet}.png — ${meta.width}×${meta.height}, а раскладка в скрипте ` +
        `размечена под ${SHEET_W}×${SHEET_H}. Пересними границы карточек (COLS/ROWS) ` +
        `и поправь SHEET_W/SHEET_H — молча резать мимо нельзя.`,
      )
    }
    const png = await readFile(file)

    for (let cell = 0; cell < PER_SHEET; cell++) {
      const row = Math.floor(cell / COLS.length)
      const col = cell % COLS.length
      const who = CHARACTERS[(sheet - 1) * PER_SHEET + cell]
      const box = cellBox(row, col)

      const card = `${who.id}_card.webp`
      const face = `${who.id}_face.webp`

      const cardBuf = await sharp(png)
        .extract(box)
        .resize({ height: cardOut, kernel: 'lanczos3', withoutEnlargement: true })
        .webp({ quality: QUALITY, effort: 6 })
        .toBuffer()

      const faceBuf = await sharp(png)
        .extract(faceBox(box))
        .resize({ width: faceOut, height: faceOut, kernel: 'lanczos3', withoutEnlargement: true })
        .webp({ quality: QUALITY, effort: 6 })
        .toBuffer()

      await writeFile(path.join(OUT, card), cardBuf)
      await writeFile(path.join(OUT, face), faceBuf)

      const cardMeta = await sharp(cardBuf).metadata()
      const faceMeta = await sharp(faceBuf).metadata()
      total += cardBuf.length + faceBuf.length
      rows.push({ ...who, card, face, cardBuf, faceBuf, cardMeta, faceMeta })

      console.log(
        `${who.id.padEnd(22)} лист ${sheet} ячейка ${cell + 1}  ` +
        `card ${cardMeta.width}×${cardMeta.height} ${kb(cardBuf.length)}  ` +
        `face ${faceMeta.width}×${faceMeta.height} ${kb(faceBuf.length)}`,
      )
    }
  }

  await writeFile(DATA, renderData(rows), 'utf8')

  console.log(`\n${rows.length} персонажей, ${rows.length * 2} файлов, всего ${kb(total)}`)
  console.log(`картинки: ${path.relative(ROOT, OUT)}`)
  console.log(`массив:   ${path.relative(ROOT, DATA)}`)
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} КБ`
}

function renderData(rows) {
  const union = rows.map((r) => `  | '${r.id}'`).join('\n')
  const items = rows
    .map(
      (r) =>
        `  {\n` +
        `    id: '${r.id}',\n` +
        `    name: '${r.name}',\n` +
        `    card: '/assets/avatars/${r.card}',\n` +
        `    face: '/assets/avatars/${r.face}',\n` +
        `  },`,
    )
    .join('\n')

  return `// Файл сгенерирован scripts/slice-avatars.mjs — руками не править.
// Перегенерировать: node scripts/slice-avatars.mjs
//
// Исходные листы лежат в assets-src/avatars/ и в клиент не уходят: в сборку
// попадает только public/assets/avatars/.
//
//   card — карточка целиком, ${rows[0].cardMeta.width}×${rows[0].cardMeta.height}, для экрана выбора;
//   face — голова и плечи, ${rows[0].faceMeta.width}×${rows[0].faceMeta.height}, туда, где аватар меньше ~64 px.

export type AvatarId =
${union}

export interface Avatar {
  id: AvatarId
  /** Имя для интерфейса. */
  name: string
  /** Карточка целиком. */
  card: string
  /** Квадрат по голове и плечам. */
  face: string
}

export const AVATARS: readonly Avatar[] = [
${items}
]
`
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
