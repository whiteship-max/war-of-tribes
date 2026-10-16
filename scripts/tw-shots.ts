// Снимки ролика боя в стиле Total War: стенд `?replay=tw` (src/render/tw/stand.ts) на экране телефона, кадр на
// заданном моменте и ракурсе (docs/battle_tw.md, раздел 9).
//
// Это **стенд, а не отчёт**, как `replay:shots`: он ничем не падает и ничего не утверждает — вид судят глазами по
// снимкам, а бюджет кадра печатается рядом (вызовы, треугольники, текстуры против потолка уровня). Кадр стоит
// (`&at=` останавливает ролик): стенд рисует его по разу на открытие и подгонку размера.
//
// Снимок — .battle-shots/<TAG>-<ракурс>-<уровень>.png (не в репозиторий). В облачном контейнере (root, без видеокарты)
// браузер идёт с программной отрисовкой (SwiftShader), как `city:shots`.
//
// Бюджет железа (CLAUDE.md, раздел ⛔): один заход не дольше `BROWSER_MAX_MS`, рядом с чужой тяжёлой работой не
// запускается, перед заходом видеокарта остывает минуту от конца прошлого захода стенда (`gpuCoolDown`).
//
// BENCH=1 — цена кадра вместо снимков: ролик идёт сам с момента `FROM` (по умолчанию — разбег перед сшибкой) `SECONDS`
// секунд, и на каждый кадр меряется его время на процессоре (режиссура и вызовы отрисовки) и до конца отрисовки (чтение
// пикселя после кадра), медиана и p95, доля кадров дольше 25 мс; ракурсы — бои из `BENCH_SHOTS` (поле и штурм), уровни —
// `QUALITY`. Один проход: уровни подряд одним заходом, без повтора (повтор уровня — второй проход без паузы). Числа —
// одного прогона одной машины: в облаке без видеокарты кадр рисует программная отрисовка, и миллисекунды там — цена
// процессора, а не телефона (docs/battle_tw.md, раздел 10).
//
// Запуск: npm run tw:shots
// Переменные: SHOTS=deploy,clash,…  QUALITY=low,medium,high  TAG=probe  PORT=4198  CDP_PORT=9341  HEAD=1  WAIT=ms
//             BENCH=1  BENCH_SHOTS=field,wall  FROM=charge  SECONDS=8
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { createServer as createVite } from 'vite';
import { launchChrome, sleep, Tab } from './lib/chrome';
import { BROWSER_MAX_MS, REPORT_FPS, gpuCoolDown, gpuStamp, refuseIfBusy } from './lib/budget';

/**
 * Куда снимки: по умолчанию `.battle-shots/` (не в репозиторий); `OUT=docs/gfx` — ключевые кадры ролика в документ
 * (docs/gfx.md, «Кадры»). `FORMAT=jpeg` — сжатый кадр (качество `QUALITY_JPEG`, 85): документу не нужны мегабайты PNG.
 */
const OUT = process.env.OUT ? fileURLToPath(new URL(`../${process.env.OUT}`, import.meta.url)) : fileURLToPath(new URL('../.battle-shots', import.meta.url));
const FORMAT = process.env.FORMAT === 'jpeg' ? 'jpeg' : 'png';
const QUALITY_JPEG = 85;
const PORT = Number(process.env.PORT ?? 4198);
const DEBUG_PORT = Number(process.env.CDP_PORT ?? 9341);
const TAG = process.env.TAG ?? 'probe';
const list = (v: string | undefined, all: string[]): string[] => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : all);

/**
 * Экран телефона: портрет 390×844, плотность 2 — тот же, что у снимков города и прежнего ролика. `SIZE=ШxВ` — свой
 * экран, `EXTRA=hour=21&…` — поверх адреса снимка (кадр «осада у стен» для заставки, assets-src/splash/README.md).
 */
const SIZE = /^(\d+)x(\d+)$/.exec(process.env.SIZE ?? '');
const SCREEN = { width: SIZE ? Number(SIZE[1]) : 390, height: SIZE ? Number(SIZE[2]) : 844, deviceScaleFactor: 2, mobile: true };
const withExtra = (query: string): string => {
  const p = new URLSearchParams(query);
  for (const [k, v] of new URLSearchParams(process.env.EXTRA ?? '')) p.set(k, v);
  return p.toString();
};

/** Полевой бой двух армий: сбалансированные составы стенда, поле с опушкой и трактом. */
const FIELD = 'replay=tw&men=600&foe=560&seed=7&place=woods,road&hour=10';
/** Переправа: нападающий переходит реку у берега обороны — штраф переправы ядра. */
const FORD = 'replay=tw&men=500&foe=500&seed=5&place=river,ford&hour=16';
const HILLS = 'replay=tw&men=500&foe=420&seed=3&place=hills,woods&hour=8';
const PACK = 'replay=tw&beasts=1&men=60&foe=45&seed=7';
const BIG = 'replay=tw&men=3000&foe=2600&seed=9&place=road&hour=13';
/** Неровный бой: меньший ломается, конница большего гонит бегущих (правило погони ядра). */
const CHASE = 'replay=tw&men=900&foe=400&seed=4&hour=11';
/** Место боя (docs/battle_tw.md, раздел 13): штурм нашей стены — берут (ворота выбиты) и отбит. */
const WALL = 'replay=tw&site=wall&men=420&foe=560&seed=3&hour=11';
const WALL_HELD = 'replay=tw&site=wall&men=500&foe=400&seed=1&hour=15';
/** У ворот: разбойники и стая; вылазка из ворот на лагерь; удар по лагерю под стенами; совместный; логово в лесу. */
const GATE = 'replay=tw&site=gate&men=220&foe=260&seed=4&place=woods,road&hour=9';
const WOLVES = 'replay=tw&site=gate&beasts=1&men=60&foe=50&seed=7&place=woods&hour=18';
const SORTIE = 'replay=tw&site=sortie&men=300&foe=360&seed=5&hour=7';
const CAMP = 'replay=tw&site=camp&men=500&foe=420&seed=6&hour=12';
const JOINT = 'replay=tw&site=joint&men=600&foe=420&seed=6&hour=12';
const LAIR = 'replay=tw&site=lair&men=300&foe=220&seed=8&place=woods&hour=17';

interface Shot {
  name: string;
  query: string;
  why: string;
}

const SHOTS: Shot[] = [
  // Такты смысла — камера режиссёра (docs/gfx.md, «Камера»): что видит игрок, не трогая экрана.
  { name: 'beat-overview', query: `${FIELD}&at=overview`, why: 'общий план: обе армии строем из-за наших, залпы, знамёна с гербами' },
  { name: 'beat-clash', query: `${FIELD}&at=clash`, why: 'сшибка: камера наискось к полосе, где в первой сшибке выбили больше всех' },
  { name: 'beat-turn', query: `${FIELD}&at=turn`, why: 'перелом: сектор побеждённого дрогнул и бежит, камера сбоку от его фланга' },
  { name: 'beat-outcome', query: `${FIELD}&at=outcome`, why: 'развязка: бегство и погоня, камера выше и шире' },
  { name: 'beat-coda', query: `${FIELD}&at=coda`, why: 'после боя: поле с павшими, победитель ликует, камера низко, лицом к нему' },
  { name: 'chase-outcome', query: `${CHASE}&at=outcome`, why: 'развязка неровного боя: меньший бежит, конница гонит' },
  { name: 'deploy', query: `${FIELD}&at=deploy`, why: 'построение: общий вид, отряды строем, знамёна, конница на краях' },
  { name: 'volley', query: `${FIELD}&at=volley`, why: 'залп: туча стрел по дуге от лучников' },
  { name: 'advance', query: `${FIELD}&at=advance&cam=low`, why: 'сближение шагом, ниже общего вида' },
  { name: 'charge', query: `${FIELD}&at=charge&cam=low`, why: 'бег на сшибку' },
  { name: 'clash', query: `${FIELD}&at=clash`, why: 'сшибка: линии сошлись на линии соприкосновения' },
  { name: 'clash-near', query: `${FIELD}&at=clash&cam=near`, why: 'сшибка вблизи: видны люди, щиты в цвете стороны' },
  { name: 'clash-side', query: `${FIELD}&at=clash&cam=side`, why: 'сшибка сбоку: камера повёрнута' },
  { name: 'melee', query: `${FIELD}&at=melee`, why: 'сеча: павшие лежат, передние рубятся' },
  { name: 'rout', query: `${FIELD}&at=rout`, why: 'бегство: сектор развернулся и бежит, знамя кренится' },
  { name: 'waver', query: `${FIELD}&at=waver&cam=low`, why: 'дрогнул: строй рыхлеет и пятится, задние оглядываются' },
  { name: 'reserve', query: `${FIELD}&at=reserve`, why: 'резерв струйкой уходит в дыру своей полосы' },
  { name: 'flank', query: `${FIELD}&at=flank`, why: 'обход по ходам ядра: часть сектора по дуге во фланг соседней полосы' },
  { name: 'melee-near', query: `${FIELD}&at=melee&cam=near`, why: 'свалка вблизи: передние шеренги ходят, линия пятится к проигрывающему' },
  { name: 'flank-low', query: `${FIELD}&at=flank&cam=low`, why: 'обход ниже общего вида: дуга во фланг' },
  { name: 'pursuit', query: `${CHASE}&at=pursuit&cam=low`, why: 'погоня: быстрые гонят бегущих, медленные встают' },
  { name: 'ford-advance', query: `${FORD}&at=advance&cam=low`, why: 'переправа: нападающий входит в воду, строй рыхлеет' },
  { name: 'ford-clash', query: `${FORD}&at=clash&cam=low`, why: 'переправа: бьются у берега обороны, нападающий в воде' },
  { name: 'hills', query: `${HILLS}&at=advance`, why: 'холмы: оборона на гребне, лес по флангам' },
  { name: 'pack', query: `${PACK}&at=clash&cam=low`, why: 'стая у ворот: волки в цвете стороны, без знамён' },
  { name: 'last', query: `${FIELD}&at=last`, why: 'итог: поле с павшими, знамёна победителя стоят' },
  { name: 'big', query: `${BIG}&at=deploy`, why: 'большое войско: k > 1, потолок фигур уровня' },
  { name: 'top', query: `${FIELD}&at=deploy&cam=top`, why: 'сверху: строй по полосам' },
  { name: 'wall-deploy', query: `${WALL}&at=deploy`, why: 'штурм: стена, башни, надвратная, город за стеной; защитники на ходу' },
  { name: 'wall-ladders', query: `${WALL}&at=ladders`, why: 'штурм: лестницы у стены, лезут очередью, на ходу рубят' },
  { name: 'wall-outside', query: `${WALL}&at=ladders&cam=outside`, why: 'штурм снаружи: лестницы, таран у ворот, защитники над зубцами' },
  { name: 'wall-ram', query: `${WALL}&at=ram&cam=gate`, why: 'таран бьёт в ворота, створки дрожат' },
  { name: 'wall-breach', query: `${WALL}&at=breach&cam=gate`, why: 'ворота выбиты: поток через проезд' },
  { name: 'wall-streets', query: `${WALL}&at=streets`, why: 'бой в воротах и на улице к площади' },
  { name: 'wall-over', query: `${WALL}&at=over&cam=outside`, why: 'через стену: по лестницам в город' },
  { name: 'wall-held', query: `${WALL_HELD}&at=last`, why: 'штурм отбит: ворота целы, лестницы брошены, павшие под стеной' },
  { name: 'gate', query: `${GATE}&at=clash`, why: 'разбойники у ворот: стрелки на стене, гарнизон перед воротами' },
  { name: 'wolves', query: `${WOLVES}&at=clash&cam=foe`, why: 'стая у ворот: бегут низом, бросаются; павшие на боку' },
  { name: 'wolves-last', query: `${WOLVES}&at=last&cam=foe`, why: 'стая: павшие волки лежат на боку' },
  { name: 'sortie', query: `${SORTIE}&at=advance`, why: 'вылазка: из ворот на лагерь осаждающих, рогатки, шатры' },
  { name: 'camp', query: `${CAMP}&at=clash`, why: 'удар по лагерю под стенами: лагерь, за ним город' },
  { name: 'joint', query: `${JOINT}&at=deploy`, why: 'совместный удар: гарнизон идёт из открытых ворот, дружина — с поля' },
  { name: 'joint-sally', query: `${JOINT}&at=sally&cam=gate`, why: 'совместный удар у ворот: поток гарнизона через проезд и лагерь' },
  { name: 'joint-clash', query: `${JOINT}&at=clash`, why: 'совместный удар: дружина бьёт лагерь с поля, гарнизон — со стороны города' },
  { name: 'joint-melee', query: `${JOINT}&at=melee&cam=top`, why: 'совместный удар сверху: лагерь зажат между дружиной и гарнизоном' },
  { name: 'lair', query: `${LAIR}&at=deploy`, why: 'логово: лагерь в лесу, частокол, шалаши, костры' },
  { name: 'lair-clash', query: `${LAIR}&at=clash&cam=low`, why: 'набег на логово: сшибка у частокола' },
  // Обстрел перед штурмом (docs/battle_tw.md, раздел 15): пролог со своими часами, камера — своя, пролога.
  { name: 'bombard', query: `${WALL}&shots=3&at=bombard`, why: 'обстрел: общий план — машины у лагеря, стена, расчёты у ворота' },
  { name: 'bombard-loose', query: `${WALL}&shots=3&at=loose`, why: 'обстрел: камень в полёте дугой, рычаг требушета вскинут' },
  { name: 'bombard-impact', query: `${WALL}&shots=3&at=impact`, why: 'обстрел: удар в кладку — пыль, обломки, трещины' },
  { name: 'bombard-collapse', query: `${WALL}&shots=3&at=collapse`, why: 'обстрел: обвал куска стены, облако до земли' },
  { name: 'bombard-fall', query: `${WALL}&shots=3&at=fall`, why: 'обстрел: сбитые со стены падают наружу' },
  { name: 'bombard-breach', query: `${WALL}&shots=3&at=smoke`, why: 'обстрел: пролом во всю величину, дым над городом' },
  { name: 'bombard-wall', query: `${WALL}&shots=3&at=deploy&cam=breach`, why: 'штурм после обстрела: пролом в стене, обрушенные куски у подножия' },
  { name: 'bombard-engine', query: `${WALL}&shots=3&at=loose&cam=engine`, why: 'требушет вблизи: рычаг вскинут, расчёт у ворота' },
  { name: 'bombard-lair', query: `${LAIR}&shots=2&at=impact`, why: 'обстрел логова: камни в шалаши, дым' },
  { name: 'bombard-lair-top', query: `${LAIR}&shots=2&at=smoke&cam=top`, why: 'обстрел логова сверху: куда легли камни, дым над шалашами' },
];

const DEFAULT_SHOTS = ['deploy', 'volley', 'clash', 'clash-near', 'ford-clash'];

/** Бои замера цены кадра (`BENCH=1`): полевой и штурм стены — без момента: ролик идёт сам. */
const BENCH_BATTLES: Record<string, { query: string; why: string }> = {
  field: { query: FIELD, why: 'полевой бой 600 на 560, опушка и тракт' },
  wall: { query: WALL, why: 'штурм стены 420 на 560: лестницы, таран, город' },
  joint: { query: JOINT, why: 'совместный удар 600 на 420: гарнизон из ворот' },
};
const BENCH = process.env.BENCH === '1';
const BENCH_SECONDS = Number(process.env.SECONDS ?? 8);
const FROM = process.env.FROM ?? 'charge';

interface Bench {
  frames: number;
  /** Секунды ролика, которые прошёл замер. */
  from: number;
  to: number;
  cpu: [number, number];
  sync: [number, number];
  /** Доля кадров дольше 25 мс до конца отрисовки. */
  long: number;
  calls: number;
  triangles: number;
  figures: number;
  gpuName: string;
}

/**
 * Замер на странице: ролик с момента `from` идёт сам; кадр проигрывателя (`TwPlayer.draw`) обёрнут — время режиссуры и
 * вызовов отрисовки, и время до конца отрисовки (`readPixels` одного пикселя ждёт видеокарту или программную отрисовку).
 */
const PROBE = (from: string, ms: number): string => `
(async () => {
  const s = window.twStand;
  const p = s.player;
  const gl = p.renderer.getContext();
  const px = new Uint8Array(4);
  const cpu = [];
  const sync = [];
  let calls = 0;
  let tris = 0;
  const draw = p.draw;
  p.stop();
  p.seek(${from});
  const t0 = p.time;
  p.draw = function (dt) {
    const a = performance.now();
    draw.call(p, dt);
    cpu.push(performance.now() - a);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    sync.push(performance.now() - a);
    const st = p.stats();
    calls = Math.max(calls, st.calls);
    tris = Math.max(tris, st.triangles);
  };
  p.start();
  await new Promise((r) => setTimeout(r, ${ms}));
  p.stop();
  p.draw = draw;
  const at = (a, k) => { const v = a.slice().sort((x, y) => x - y); return v.length ? v[Math.min(v.length - 1, Math.floor(v.length * k))] : null; };
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return JSON.stringify({
    frames: cpu.length,
    from: t0,
    to: p.time,
    cpu: [at(cpu, 0.5), at(cpu, 0.95)],
    sync: [at(sync, 0.5), at(sync, 0.95)],
    long: sync.length ? sync.filter((x) => x > 25).length / sync.length : 0,
    calls,
    triangles: tris,
    figures: s.plan.figures,
    gpuName: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
  });
})()
`;

/** Секунда начала замера на странице: по имени момента режиссуры (как `&at=` стенда) — из плана. */
const fromExpr = (name: string): string =>
  name === 'charge' ? 's.plan.clashAt - 1' : name === 'clash' ? 's.plan.clashAt' : name === 'deploy' ? '0' : String(Number(name) || 0);

async function bench(name: string, quality: string): Promise<void> {
  const b = BENCH_BATTLES[name];
  const tab = await Tab.open(DEBUG_PORT, 'about:blank');
  try {
    await tab.send('Emulation.setDeviceMetricsOverride', SCREEN);
    await tab.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?${b.query}&quality=${quality}&clean=1&dpr=${SCREEN.deviceScaleFactor}&fpscap=${REPORT_FPS}` });
    let ready = false;
    for (let i = 0; i < 240 && !ready; i++) {
      await sleep(250);
      ready = (await tab.eval<boolean>(`Boolean(window.twStand && document.body?.dataset.replay)`).catch(() => false)) === true;
    }
    if (!ready) throw new Error(`${name}: стенд не отдал кадр`);
    const r = await tab.eval<Bench>(PROBE(fromExpr(FROM), BENCH_SECONDS * 1000));
    const f = (v: number | null): string => (v === null ? '—' : v.toFixed(1));
    console.log(
      `  ${name.padEnd(6)} ${quality.padEnd(6)} ролик ${r.from.toFixed(1)}–${r.to.toFixed(1)} с · кадров ${String(r.frames).padStart(4)} · ` +
        `ЦП мед ${f(r.cpu[0]).padStart(6)} p95 ${f(r.cpu[1]).padStart(6)} · кадр мед ${f(r.sync[0]).padStart(6)} p95 ${f(r.sync[1]).padStart(6)} мс · ` +
        `длинных ${Math.round(r.long * 100)} % · вызовов ${r.calls} · треугольников ${r.triangles.toLocaleString('ru')} · фигур ${r.figures}`,
    );
    benchGpu = r.gpuName;
  } finally {
    tab.close();
    await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${tab.target}`).catch(() => undefined);
  }
}
let benchGpu = '';

const pageUrl = (shot: Shot, quality: string): string =>
  `http://127.0.0.1:${PORT}/?${withExtra(shot.query)}&quality=${quality}&clean=1&dpr=${SCREEN.deviceScaleFactor}&fpscap=${REPORT_FPS}`;

interface Stats {
  calls: number;
  triangles: number;
  crowdTriangles: number;
  textureMB: number;
  t: number;
  k: number;
  figures: Record<string, number>;
  budget: { calls: number; triangles: number; textureMB: number };
}

async function shoot(shot: Shot, quality: string): Promise<void> {
  const tab = await Tab.open(DEBUG_PORT, 'about:blank');
  try {
    await tab.send('Emulation.setDeviceMetricsOverride', SCREEN);
    await tab.send('Page.navigate', { url: pageUrl(shot, quality) });
    let stats: Stats | null = null;
    for (let i = 0; i < 240 && !stats; i++) {
      await sleep(250);
      // `eval` разбирает возвращённую строку как JSON сам: стенд кладёт в `dataset.replay` ровно JSON.
      const parsed = await tab.eval<Stats | null>(`document.body?.dataset.replay ?? 'null'`).catch(() => null);
      if (parsed && parsed.calls !== undefined) stats = parsed;
    }
    if (!stats) throw new Error(`${shot.name}: стенд не отдал кадр`);
    // Кадр стоит: подгонка размера под экран телефона перерисовывает его; программной отрисовке нужно время.
    await sleep(Number(process.env.WAIT ?? 2500));
    stats = (await tab.eval<Stats | null>(`document.body.dataset.replay ?? 'null'`)) ?? stats;
    const png = await tab.send<{ data: string }>('Page.captureScreenshot', FORMAT === 'jpeg' ? { format: 'jpeg', quality: QUALITY_JPEG } : { format: 'png' });
    const name = `${TAG}-${shot.name}-${quality}.${FORMAT === 'jpeg' ? 'jpg' : 'png'}`;
    await writeFile(join(OUT, name), Buffer.from(png.data, 'base64'));
    const b = stats.budget;
    const mark = (v: number, cap: number): string => (v <= cap ? '' : ' ⚠');
    console.log(
      `  ${shot.name.padEnd(13)} ${quality.padEnd(6)} t=${stats.t.toFixed(1).padStart(5)} · k ${stats.k} · фигур ${Object.values(stats.figures).join('/').padEnd(8)} · ` +
        `вызовов ${String(stats.calls).padStart(3)}/${b.calls}${mark(stats.calls, b.calls)} · ` +
        `треугольников ${stats.triangles.toLocaleString('ru').padStart(9)}/${b.triangles.toLocaleString('ru')}${mark(stats.triangles, b.triangles)} ` +
        `(бойцы ${stats.crowdTriangles.toLocaleString('ru')}) · текстуры ${stats.textureMB}/${b.textureMB} МБ → ${process.env.OUT ?? '.battle-shots'}/${name}`,
    );
  } finally {
    tab.close();
    await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${tab.target}`).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const wanted = BENCH ? list(process.env.BENCH_SHOTS, ['field']) : list(process.env.SHOTS, DEFAULT_SHOTS);
  const qualities = list(process.env.QUALITY, ['medium']);
  if (BENCH && new Set(qualities).size !== qualities.length) {
    console.error('\nУровень повторён в QUALITY — это второй проход без паузы (бюджет железа).');
    process.exit(2);
  }
  const unknown = wanted.filter((w) => (BENCH ? !(w in BENCH_BATTLES) : !SHOTS.some((s) => s.name === w)));
  if (unknown.length) {
    const have = BENCH ? Object.keys(BENCH_BATTLES) : SHOTS.map((s) => s.name);
    console.error(`\nНет таких ракурсов: ${unknown.join(', ')}. Есть: ${have.join(', ')}.`);
    process.exit(2);
  }
  refuseIfBusy('Снимки ролика TW');
  await mkdir(OUT, { recursive: true });
  const vite = await createVite({
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    server: { port: PORT, strictPort: true, host: '127.0.0.1' },
    logLevel: 'warn',
  });
  await vite.listen();
  try {
    console.log(`\n=== ролик TW: ${BENCH ? `цена кадра с «${FROM}», ${BENCH_SECONDS} с` : 'снимки'} (${wanted.join(', ')}; ${qualities.join(', ')}) ===\n`);
    await gpuCoolDown('стендом ролика TW');
    // В облачном контейнере браузер идёт от root без видеокарты: песочница там не поднимается, а WebGL даёт только
    // программная отрисовка (SwiftShader) — как у `city:shots`.
    const root = process.getuid?.() === 0 ? ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [];
    const chrome = await launchChrome(DEBUG_PORT, ['--use-gl=angle', '--window-size=500,900', '--force-device-scale-factor=1', ...root]);
    try {
      const began = Date.now();
      outer: for (const q of qualities) {
        for (const name of BENCH ? wanted : []) {
          if (Date.now() - began > BROWSER_MAX_MS) {
            console.log(`\nСрок стенда (${BROWSER_MAX_MS / 1000} с) вышел — остальное отдельным заходом.`);
            break outer;
          }
          await bench(name, q);
        }
        for (const shot of BENCH ? [] : SHOTS.filter((s) => wanted.includes(s.name))) {
          if (Date.now() - began > BROWSER_MAX_MS) {
            console.log(`\nСрок стенда (${BROWSER_MAX_MS / 1000} с) вышел — остальное отдельным заходом.`);
            break outer;
          }
          await shoot(shot, q);
        }
      }
      if (BENCH) {
        console.log(
          `\nОтрисовка: ${benchGpu}. Экран ${SCREEN.width}×${SCREEN.height} @${SCREEN.deviceScaleFactor}, потолок ${REPORT_FPS} кадров; один проход, ` +
            'миллисекунды сравнимы только внутри этого вывода.',
        );
        return;
      }
    } finally {
      chrome.kill();
      gpuStamp();
    }
    console.log('\nЧто чем отвечает:');
    for (const s of SHOTS.filter((x) => wanted.includes(x.name))) console.log(`  ${s.name.padEnd(13)} ${s.why}`);
  } finally {
    await vite.close();
    await sleep(300);
  }
}

void main();
