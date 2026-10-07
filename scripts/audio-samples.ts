// Стенд звука: офлайн-отрисовка образцов и уровней (docs/audio.md, раздел 6). Не отчёт приёмки — стенд, как
// `map:shots`: гоняет его тот, кто трогает звук.
//
//   npm run audio:samples            образцы в docs/audio-samples/*.mp3 и таблица уровней
//   ONLY=city-day,map npm run audio:samples
//
// Что меряется, на каждый образец: пик с ограничителем (что слышит игрок) и **без** него (запас до перегруза — сколько
// отсчётов за ±1, если бы страховки не было), средняя громкость (RMS, дБ полной шкалы), самая громкая и самая тихая
// секунда, самый большой скачок громкости между соседними секундами (ровность перехода слоёв) и щелчки — соседние
// отсчёты, разошедшиеся больше чем на пятую часть шкалы.
//
// Браузер — тот же стендовый Chrome (`lib/chrome.ts`: замок машины, потолок кадров), одна вкладка, ничего не рисует;
// весь прогон держится в двух минутах (`BROWSER_MAX_MS`).
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Tab, launchChrome } from './lib/chrome';
import { BROWSER_MAX_MS } from './lib/budget';

const ROOT = resolve(__dirname, '..');
const OUT = join(ROOT, 'docs', 'audio-samples');
const PORT = 9341;

interface Rendered {
  sr: number;
  channels: number;
  peak: number;
  over: number;
  data: string;
}

async function bundle(): Promise<string> {
  const r = await build({
    entryPoints: [join(ROOT, 'scripts/audio/offline.ts')],
    bundle: true,
    format: 'iife',
    write: false,
    target: 'es2020',
    logLevel: 'silent',
    plugins: [
      {
        name: 'tribe-audio',
        setup(b) {
          b.onResolve({ filter: /^@\// }, (a) => ({ path: resolve(ROOT, 'src', a.path.slice(2)) + '.ts' }));
          // Звуки боя берут выход и настройку у стенда: движка игры с его контекстом в офлайн-отрисовке нет.
          b.onResolve({ filter: /^\.\/(web|settings)$/ }, (a) =>
            a.importer.endsWith('battlefx.ts') ? { path: join(ROOT, `scripts/audio/shim-${a.path.slice(2)}.ts`) } : undefined,
          );
        },
      },
    ],
  });
  return r.outputFiles[0].text;
}

const db = (v: number): string => (v <= 1e-9 ? '−∞' : (20 * Math.log10(v)).toFixed(1));

function measure(r: Rendered): Record<string, string | number> {
  const raw = Buffer.from(r.data, 'base64');
  const pcm = new Int16Array(raw.buffer, raw.byteOffset, raw.length / 2);
  const n = pcm.length / 2;
  let sum = 0;
  let clicks = 0;
  const where: string[] = [];
  const sec: number[] = [];
  let acc = 0;
  let cnt = 0;
  for (let i = 0; i < n; i++) {
    const m = (pcm[i * 2] + pcm[i * 2 + 1]) / 2 / 32768;
    sum += m * m;
    acc += m * m;
    cnt++;
    if (cnt === r.sr) {
      sec.push(Math.sqrt(acc / cnt));
      acc = 0;
      cnt = 0;
    }
    if (i > 0)
      for (const ch of [0, 1])
        if (Math.abs(pcm[i * 2 + ch] - pcm[(i - 1) * 2 + ch]) / 32768 > 0.2) {
          clicks++;
          const t = (i / r.sr).toFixed(1);
          if (where.length < 6 && !where.includes(t)) where.push(t);
        }
  }
  let top = 0;
  let topAt = 0;
  for (let i = 0; i < pcm.length; i++)
    if (Math.abs(pcm[i]) > top) {
      top = Math.abs(pcm[i]);
      topAt = Math.floor(i / 2) / r.sr;
    }
  let jump = 0;
  for (let i = 1; i < sec.length; i++) {
    if (sec[i] < 1e-5 || sec[i - 1] < 1e-5) continue;
    jump = Math.max(jump, Math.abs(20 * Math.log10(sec[i] / sec[i - 1])));
  }
  return {
    topAt: topAt.toFixed(1),
    rms: db(Math.sqrt(sum / n)),
    loud: db(Math.max(...sec)),
    quiet: db(Math.min(...sec)),
    jump: jump.toFixed(1),
    clicks: clicks > 0 ? `${clicks} (${where.join(', ')} с)` : 0,
  };
}

function wav(r: Rendered, file: string): void {
  const raw = Buffer.from(r.data, 'base64');
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + raw.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(r.channels, 22);
  head.writeUInt32LE(r.sr, 24);
  head.writeUInt32LE(r.sr * r.channels * 2, 28);
  head.writeUInt16LE(r.channels * 2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(raw.length, 40);
  writeFileSync(file, Buffer.concat([head, raw]));
}

async function main(): Promise<void> {
  const code = await bundle();
  const deadline = setTimeout(() => {
    console.error(`стенд звука дольше ${BROWSER_MAX_MS / 1000} с — бросаю (бюджет железа)`);
    process.exit(2);
  }, BROWSER_MAX_MS);
  // Облако гоняет браузер от root — без песочницы он там не поднимается (как у прочих стендов, `city-shots.ts`).
  const chrome = await launchChrome(PORT, process.getuid?.() === 0 ? ['--no-sandbox'] : []);
  const tmp = join(tmpdir(), `tribe-audio-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  try {
    const tab = await Tab.open(PORT, 'about:blank');
    await tab.eval(`${code};"null"`);
    const names = await tab.eval<{ name: string; title: string; probe: boolean }[]>('JSON.stringify(__audio.names)');
    const only = process.env.ONLY?.split(',');
    const rows: string[] = [];
    rows.push('образец        пик   где        пик-без-огр  за ±1  RMS    громкая  тихая  скачок  щелчки  файл');
    for (const s of names) {
      if (only && !only.includes(s.name)) continue;
      const limited = await tab.eval<Rendered>(`__audio.render(${JSON.stringify(s.name)}, true)`);
      const raw = await tab.eval<Rendered>(`__audio.render(${JSON.stringify(s.name)}, false)`);
      const m = measure(limited);
      let file = '—';
      if (!s.probe) {
        const w = join(tmp, `${s.name}.wav`);
        wav(limited, w);
        const mp3 = join(OUT, `${s.name}.mp3`);
        // Моно 48 кбит/с: послушать замысел хватает, в репозитории — по сотне килобайт.
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', w, '-ac', '1', '-b:a', '48k', mp3]);
        file = `${s.name}.mp3 ${(statSync(mp3).size / 1024).toFixed(0)} КБ`;
      }
      rows.push(
        `${s.name.padEnd(14)} ${db(limited.peak).padStart(5)} @${String(m.topAt).padStart(4)} с ${db(raw.peak).padStart(8)} ${String(raw.over).padStart(9)}  ${String(m.rms).padStart(5)} ${String(m.loud).padStart(7)} ${String(m.quiet).padStart(6)} ${String(m.jump).padStart(6)} ${String(m.clicks).padStart(7)}  ${file}`,
      );
      console.log(rows[rows.length - 1]);
    }
    console.log('\n' + rows.join('\n'));
    console.log('\nдБ — полной шкалы; «за ±1» — отсчётов за пределом без ограничителя; «скачок» — наибольшая разница громкости соседних секунд, дБ.');
    tab.close();
  } finally {
    chrome.kill();
    clearTimeout(deadline);
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
