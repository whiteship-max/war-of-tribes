/**
 * Сборка музыки игры из паков WAV.
 *
 *     npm run music:build
 *
 * Читает assets-src/ (боевой пак, в репозиторий не едет — см.
 * assets-src/MUSIC.md) и кладёт в public/assets/music/ один mp3 — боевую дорожку
 * под ролик. Мирных дорожек деревни больше нет: в городе с 06.10.2026 звучит
 * музыка эпохи — синтез без файлов (`src/sound/epoch/`, docs/audio.md); файлы
 * и их сборка удалены 07.10.2026 решением владельца.
 *
 * Почему именно так:
 *
 * - **mp3, а не ogg и не opus.** Их не играет Safari на iPhone, а вебвью
 *   Telegram на iOS — это он и есть. Второй формат означал бы либо запасной
 *   путь в коде, либо 404 на каждой загрузке.
 * - **Моно 72 кбит/с.** Телефонный динамик моно, а 72 кбит/с моно по качеству
 *   на канал — это примерно 144 стерео. Потолок всей музыки — 4.5 МБ
 *   (`WEIGHT_CAP`), и скрипт валится, если сборка в него не влезла: вся игра
 *   по сети 339 КБ, и музыка — первое, что способно добавить мегабайты.
 * - **Громкость выравнивается по EBU R128 линейным усилением**, а не
 *   динамическим `loudnorm`: дорожки идут в перемешанном порядке и не должны
 *   прыгать по громкости, но и дышать от компрессии музыке нельзя. Отсюда два
 *   прохода: первый меряет, второй множит на постоянное число.
 * - **Тишину в хвосте режем** (`trim`), если она есть: в петле это была бы дыра.
 *
 * Скрипту нужен ffmpeg — он приезжает пакетом `ffmpeg-static` в
 * devDependencies. Бинарник живёт в node_modules: ни в репозиторий, ни в
 * сборку игры он не попадает.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ffmpeg from 'ffmpeg-static'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const COMBAT_SRC = path.join(ROOT, 'assets-src/Combat Pack - vol 1')
const OUT = path.join(ROOT, 'public/assets/music')

/** Моно, 44.1 кГц, 72 кбит/с. Меняешь — пересчитай потолок и README. */
const BITRATE = '72k'
const RATE = '44100'

/** Потолок всей музыки в public/. Сборка сверх него — ошибка, а не предупреждение. */
const WEIGHT_CAP = 4.5 * 1024 * 1024

/** К этой громкости приводятся все дорожки (EBU R128, LUFS). */
const TARGET_LUFS = -16
/** Выше этого пика не поднимаем: перегруз на телефонном динамике слышен хрипом. */
const TARGET_PEAK = -1.5

/**
 * Что из паков взято. `trim` — до какой секунды резать, если в хвосте цифровая тишина.
 */
const TRACKS = [
  {
    out: 'battle.mp3',
    src: path.join(COMBAT_SRC, '2. One Last Day on Earth - 110bpm - LOOP 52s.wav'),
    note: 'Combat 2, 110 BPM — петля 52 с под ролик о бое',
  },
]

const ff = (args) => execFileSync(ffmpeg, args, { encoding: 'buffer' })

/** Первый проход: чем дорожка громка на самом деле. */
function measure(src, trim) {
  const args = ['-hide_banner', '-nostdin']
  if (trim) args.push('-t', String(trim))
  args.push('-i', src, '-af', `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_PEAK}:print_format=json`, '-f', 'null', '-')
  // Замер ffmpeg печатает в stderr, а не в stdout, — отсюда spawnSync.
  const out = spawnSync(ffmpeg, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stderr ?? ''
  const json = JSON.parse(out.slice(out.lastIndexOf('{'), out.lastIndexOf('}') + 1))
  return { loudness: Number(json.input_i), peak: Number(json.input_tp) }
}

/** Насколько поднять: до цели, но не выше допустимого пика. */
function gainFor({ loudness, peak }) {
  const wanted = TARGET_LUFS - loudness
  const room = TARGET_PEAK - peak
  return Math.round(Math.min(wanted, room) * 100) / 100
}

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} КБ`

/** Длина готового файла — из самого файла, а не из расчёта. */
function durationOf(file) {
  const out = spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr ?? ''
  const m = out.match(/Duration: (\d+):(\d+):([\d.]+)/)
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0
}

mkdirSync(OUT, { recursive: true })
// Старые mp3 убираем: иначе переименованная дорожка останется лежать мёртвым
// весом, и потолок будет считаться не по тому, что игра действительно грузит.
for (const name of readdirSync(OUT)) {
  if (name.endsWith('.mp3')) unlinkSync(path.join(OUT, name))
}

let total = 0
const rows = []
for (const track of TRACKS) {
  const dst = path.join(OUT, track.out)
  const gain = gainFor(measure(track.src, track.trim))
  const args = ['-y', '-loglevel', 'error', '-nostdin']
  if (track.trim) args.push('-t', String(track.trim))
  args.push(
    '-i', track.src,
    '-af', `volume=${gain}dB`,
    '-ac', '1',
    '-ar', RATE,
    '-b:a', BITRATE,
    // Метаданные и обложки из пака в игру не едут — это чистый вес.
    '-map_metadata', '-1',
    '-vn',
    dst,
  )
  ff(args)
  const size = statSync(dst).size
  total += size
  const seconds = durationOf(dst)
  rows.push({ out: track.out, seconds, size, gain, note: track.note })
}

const width = Math.max(...rows.map((r) => r.out.length))
console.log('дорожка'.padEnd(width) + '   длина     вес   поправка   что это')
for (const r of rows) {
  console.log(
    `${r.out.padEnd(width)}  ${r.seconds.toFixed(0).padStart(4)} с  ${kb(r.size).padStart(7)}  ` +
      `${(r.gain > 0 ? '+' : '') + r.gain.toFixed(1)} дБ`.padStart(9) + `   ${r.note}`,
  )
}
console.log(
  `\nвсего ${(total / 1024 / 1024).toFixed(2)} МБ из ${(WEIGHT_CAP / 1024 / 1024).toFixed(1)} МБ потолка ` +
    `(${((total / WEIGHT_CAP) * 100).toFixed(0)}%)`,
)
if (total > WEIGHT_CAP) {
  console.error(`\nсборка не влезла в потолок: ${(total / 1024 / 1024).toFixed(2)} МБ`)
  process.exit(1)
}
