// Стенд промыслов (docs/minigames.md): снимки и счётчики кадра — не отчёт, в приёмку не входит.
//
//   npm run mini:shots                  — вход из города и обе игры: верх, подсказка энергии, «Промыслы»,
//                                         начало, середина игры у цели, итог; по каждому снимку — ступень,
//                                         вызовы отрисовки и треугольники прошлого кадра
//   GAMES=herd npm run mini:shots       — одна игра (`berries`, `herd`, `hunt`, `fish`); GAMES=none — только город,
//                                         верхняя строка и окно двора
//   EXTRA='&shore=sea&weather=rain'     — добавка к адресу страницы: берег рыбалки и погода (`ui/parts/weather`)
//   SEASON=winter npm run mini:shots    — сезон города (снег на ветках)
//   LOOK=lite npm run mini:shots        — ступень вида приколота (`full`, `lite`, `base`)
//   WIDTH=375 npm run mini:shots        — ширина экрана, px (по умолчанию 390)
//   BONDED=12 npm run mini:shots        — невольники в городе: в верхней строке встаёт ячейка порядка
//   FIT=1 npm run mini:shots            — верхняя строка на 375 и 390 px одним заходом: обычные и четырёхзначные числа,
//                                         с ячейкой порядка и без; влезает ли строка, не переполнена ли ячейка, и снимок
//                                         строки на каждый случай
//   RARE=1 npm run mini:shots           — сид партии, у которой редкое есть во всех трёх полях: земляника, ягнёнок,
//                                         белый олень (`minigameSeed` новой партии, энергия полна)
//   SLIDE=1 GAMES=hunt npm run mini:shots — «Охота»: палец увели с «Натянуть» — тетива ослаблена без выстрела (ОТ-1)
//   HOUR=night npm run mini:shots       — час города (`dawn`, `day`, `dusk`, `night`): свет промысла и строка часа на
//                                         карточке начала (docs/minigames.md, 18)
//   BUDGET=1 npm run mini:shots         — бюджет кадра счётом по графу сцены, без браузера (`world.frameCost`), дуга
//                                         стрелы «Охоты»: метки прицела, полёт и падение на их далях, рыбалка: цели по
//                                         берегу, поясу и сезону, секунды вываживания средней рыбы каждого вида, и щуп
//                                         добычи за выход: прежние правила против этапа 6 у трёх рук на 200 зёрнах
//                                         (`SEEDS=` — другой набор)
//
// Снимки — в `.mini-shots/` (в репозиторий не входит). Бюджет железа (CLAUDE.md, раздел ⛔): один прогон, браузер с
// потолком кадров отчёта, не дольше двух минут на заход, минута остывания видеокарты перед заходом; рядом с чужой
// тяжёлой работой стенд не запускается.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { createServer as createVite } from 'vite';
import { ENTER_GAME, launchChrome, reportPage, sleep, Tab } from './lib/chrome';
import { BROWSER_MAX_MS, gpuCoolDown, gpuStamp, refuseIfBusy } from './lib/budget';

const OUT = fileURLToPath(new URL('../.mini-shots', import.meta.url));
const PORT = Number(process.env.PORT ?? 4198);
const DEBUG_PORT = Number(process.env.CDP_PORT ?? 9343);
const SCREEN = { width: Number(process.env.WIDTH ?? 390), height: 844, deviceScaleFactor: 2, mobile: true };
/** Какие игры снимать; `GAMES=none` — только город и окно двора. */
const GAMES = (process.env.GAMES ?? 'berries,herd,hunt')
  .split(',')
  .map((x) => x.trim())
  .filter((x) => x === 'berries' || x === 'herd' || x === 'hunt' || x === 'fish');
/** Кнопка входа в игру — та же строка, что в таблице игр (`data/minigames.ts`, `go`). */
const GO: Record<string, string> = { berries: 'В лес', herd: 'В загон', hunt: 'На охоту', fish: 'К воде' };
/** Добавка к адресу страницы: `&shore=sea`, `&weather=rain`. */
const EXTRA = process.env.EXTRA ?? '';
const SEASON = process.env.SEASON ?? '';
const TAG = process.env.TAG ?? 'probe';
/** Ступень вида из адреса (`?look=full|lite|base`) — приколота, сторож её не трогает. */
const LOOK = process.env.LOOK ?? '';

/** Сезон города — сдвигом игрового времени партии: у сезона своего поля нет, он выводится из `s.time`. */
const SEASON_AT: Record<string, number> = { spring: 0, summer: 1, autumn: 2, winter: 3 };
/** Час города (`rules.Hour`): время партии ставится в середину этой части суток — той же функцией, что у игры. */
const HOUR = process.env.HOUR ?? '';

/** Сид партии, у которой первый выход в «Ягоды», «Скот» и «Охоту» — с редким (`minigameSeed` при полной энергии). */
async function rareSeed(): Promise<number> {
  const { minigameSeed } = await import('../src/game/sim/minigames');
  const { layBerries } = await import('../src/minigames/berries');
  const { herdOf } = await import('../src/minigames/herd');
  const { layHunt } = await import('../src/minigames/hunt');
  type S = Parameters<typeof minigameSeed>[0];
  for (let seed = 1; seed < 100000; seed++) {
    const s = { seed } as S;
    if (!layBerries(minigameSeed(s, 'berries'), { rare: true }).bushes.some((b) => b.kind === 'strawberry')) continue;
    if (!herdOf(minigameSeed(s, 'herd'), { rare: true }).beasts.some((b) => b.kind === 'lamb')) continue;
    if (!layHunt(minigameSeed(s, 'hunt'), true).deer.some((d) => d.white)) continue;
    return seed;
  }
  throw new Error('RARE=1: сида с редким во всех трёх полях не нашлось');
}

/** Время партии: сезон `season` (по умолчанию — лето), середина части суток, где час промысла — `hour`. */
async function timeAt(season: string, hour: string): Promise<number> {
  const { dayPartAt } = await import('../src/game/derived');
  const { hourOf } = await import('../src/minigames/rules');
  const { DAY_LENGTH } = await import('../src/game/pace');
  const { SEASON_DAYS } = await import('../src/game/data/seasons');
  const base = ((SEASON_AT[season] ?? 1) * SEASON_DAYS + 1) * DAY_LENGTH;
  const hits: number[] = [];
  for (let k = 0; k < 200; k++) {
    const t = base + ((k + 0.5) / 200) * DAY_LENGTH;
    if (hourOf(dayPartAt(t)) === hour) hits.push(t);
  }
  if (!hits.length) throw new Error(`HOUR=${hour}: такого часа нет (dawn, day, dusk, night)`);
  return hits[Math.floor(hits.length / 2)];
}

async function snap(tab: Tab, name: string, began: number): Promise<void> {
  if (Date.now() - began > BROWSER_MAX_MS) throw new Error(`срок стенда (${BROWSER_MAX_MS / 1000} с) вышел — остальное отдельным заходом`);
  const info = await tab
    .eval<{ calls: number; triangles: number; tier: string } | null>('JSON.stringify(window.__mini ? window.__mini.info() : null)')
    .catch(() => null);
  const png = await tab.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
  const file = `${TAG}-${name}.png`;
  await writeFile(join(OUT, file), Buffer.from(png.data, 'base64'));
  console.log(`  ${name.padEnd(18)} ${info ? `${info.tier}, вызовов ${info.calls}, треугольников ${info.triangles}` : 'город'} → .mini-shots/${file}`);
}

const click = (selector: string): string =>
  `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return JSON.stringify('нет ' + ${JSON.stringify(selector)}); e.click(); return JSON.stringify('ok'); })()`;

/** Нажать кнопку по её тексту. */
const press = (text: string): string =>
  `(() => { const e = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled); if (!e) return JSON.stringify('нет кнопки ' + ${JSON.stringify(text)}); e.click(); return JSON.stringify('ok'); })()`;

/**
 * Войти в партию. Страница посреди входа может перезагрузиться сама — dev-сервер дособрал зависимости и перезагрузил
 * её, — и Chrome отвечает на вычисление «Promise was collected»: так стенд обрывался сразу после паузы остывания
 * (docs/minigames.md, 18.6; причина найдена в П-4). Тогда — дождаться игры заново и войти ещё раз.
 */
async function enter(tab: Tab): Promise<string> {
  for (let i = 0; ; i++) {
    try {
      return await tab.eval<string>(ENTER_GAME);
    } catch (e) {
      if (i >= 3 || !/collected/i.test((e as Error).message)) throw e;
      console.log('  страница перезагрузилась посреди входа — вхожу заново');
      await sleep(1500);
      await waitFor(tab, 'window.__game', 60000);
    }
  }
}

async function waitFor(tab: Tab, expr: string, ms: number): Promise<boolean> {
  for (let t = 0; t < ms; t += 250) {
    if (await tab.eval<boolean>(`JSON.stringify(!!(${expr}))`).catch(() => false)) return true;
    await sleep(250);
  }
  return false;
}

/** Ячейки верхней строки: подпись, текст, ширина и переполнение — одной строкой на случай. */
const TOP_CELLS = `JSON.stringify((() => {
  const squeezed = (e) => [...e.querySelectorAll('svg, .nx-stat > span:first-child')].some((i) => i.getBoundingClientRect().width < 15.5);
  const top = document.querySelector('.nx-top');
  const cells = [...document.querySelectorAll('.nx-top > *')].filter((e) => e.getBoundingClientRect().width > 0);
  return {
    scroll: top ? top.scrollWidth : -1,
    client: top ? top.clientWidth : -1,
    cells: cells.map((e) => (e.getAttribute('aria-label') || e.className) + ' «' + e.textContent.trim() + '» ' + Math.round(e.getBoundingClientRect().width) + (e.scrollWidth > e.clientWidth + 1 ? ' ПЕРЕПОЛНЕНА ' + e.scrollWidth : '') + (squeezed(e) ? ' ЗНАЧОК СЖАТ' : '')),
  };
})())`;

/**
 * Верхняя строка на 375 и 390 px (решение владельца 04.10.2026: числа за тысячу — сокращённо): числа новой партии и
 * поздней (золото «9,9к», жители и жильё 755, дружина 747), с ячейкой порядка и без. Не влезает — строка шире экрана,
 * ячейка шире себя или значок сжат. Один заход вместо восьми — бюджет железа; снимок строки на каждый случай — в
 * `.mini-shots/`.
 */
async function fitTop(tab: Tab, began: number): Promise<void> {
  // Большие числа поздней партии: золото за тысячу, жители и жильё у потолка (`pop:report`: 755 при всех зданиях на
  // потолке, средний уровень около десяти), дружина — все жители.
  const BIG = `s.gold = 9949; s.pop = 755; for (const b of s.buildings) b.level = Math.max(b.level, 10); const ids = Object.keys(s.army); for (const t of ids) s.army[t] = Math.floor(755 / ids.length);`;
  let bad = 0;
  for (const big of [false, true]) {
    for (const bonded of [0, 12]) {
      await tab.eval<string>(`(() => { const g = window.__game.getState(); const s = g.s; s.bonded = ${bonded}; ${big ? BIG : ''} window.__game.setState({ s: { ...s } }); return JSON.stringify('ok'); })()`);
      for (const width of [375, 390]) {
        if (Date.now() - began > BROWSER_MAX_MS) throw new Error(`срок стенда (${BROWSER_MAX_MS / 1000} с) вышел`);
        await tab.send('Emulation.setDeviceMetricsOverride', { ...SCREEN, width });
        await sleep(700);
        const r = await tab.eval<{ scroll: number; client: number; cells: string[] }>(TOP_CELLS);
        const tag = `top-${width}-${big ? 'big' : 'new'}${bonded ? '-order' : ''}`;
        const over = r.scroll > r.client || r.cells.some((c) => c.includes('ПЕРЕПОЛНЕНА') || c.includes('ЗНАЧОК СЖАТ'));
        if (over) bad++;
        console.log(`  ${tag.padEnd(22)} ${r.scroll} из ${r.client} px${over ? ' — НЕ ВЛЕЗАЕТ' : ''}`);
        console.log(`    ${r.cells.join(' · ')}`);
        const png = await tab.send<{ data: string }>('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height: 52, scale: 1 } });
        await writeFile(join(OUT, `${TAG}-${tag}.png`), Buffer.from(png.data, 'base64'));
      }
    }
  }
  console.log(bad ? `  переполнено случаев: ${bad} из 8` : '  все восемь случаев влезают');
}

/**
 * `SLIDE=1` — отмена натянутого выстрела (ОТ-1, docs/feedback.md): подписи первого входа, тетива натянута мышью CDP на
 * кнопке «Натянуть», палец уведён вверх дальше кнопки (`pad.SLIDE_OFF`), отпущен. Печатает, ушла ли стрела и сколько их
 * в колчане до и после: у кода до ОТ-1 стрела уходит, после — нет.
 */
async function slide(tab: Tab, began: number): Promise<void> {
  await sleep(800);
  await snap(tab, 'hunt-4-coach', began);
  const quiver = 'JSON.stringify(window.__mini.play.hunt.quiver)';
  const q0 = await tab.eval<number>(quiver);
  const x = SCREEN.width * 0.2;
  const y = SCREEN.height * 0.82;
  await mouse(tab, 'mouseMoved', x, y);
  await mouse(tab, 'mousePressed', x, y);
  await waitFor(tab, 'window.__mini.play.drawn() >= 0.6', 15000);
  await snap(tab, 'hunt-4-held', began);
  for (let k = 1; k <= 7; k++) {
    await mouse(tab, 'mouseMoved', x, y - k * 20);
    await sleep(60);
  }
  await sleep(700);
  await snap(tab, 'hunt-4-slid', began);
  await mouse(tab, 'mouseReleased', x, y - 140);
  await sleep(1500);
  await snap(tab, 'hunt-4-up', began);
  const arrows = await tab.eval<number>('JSON.stringify(window.__mini.play.hunt.arrows.length)');
  console.log(`  палец увели с «Натянуть» и отпустили: стрел в полёте и на земле ${arrows}, в колчане ${q0} → ${await tab.eval<number>(quiver)}`);
}

/**
 * «Охота»: обзор поля со старта, руки (кнопка «Натянуть» слева, палец движения справа, подписи-указатели первого
 * входа), настоящий поворот пальцем справа, лук натянут на ближнего видимого оленя с поправкой дуги, настоящий выстрел
 * мышью CDP по левой половине холста — кнопке «Натянуть» (прижал — держит — отпустил: тот же путь, что у пальца,
 * `Stage.onDown/onUp`), олень крупно.
 */
async function hunt(tab: Tab, began: number): Promise<void> {
  if (process.env.SLIDE) return slide(tab, began);
  await tab.eval<string>(`(() => { window.__mini.seek(2); return JSON.stringify('ok'); })()`);
  await sleep(1500);
  await snap(tab, 'hunt-3-field', began);
  // Белый олень (`RARE=1`) — крупно, в двенадцати шагах; потом обратно на старт.
  const white = await tab.eval<string>(`(() => {
    const st = window.__mini;
    const h = st.play.hunt;
    const i = h.field.deer.findIndex((d) => d.white);
    if (i < 0) return JSON.stringify('');
    const p = h.pose(i, h.now);
    const x = p.x + Math.cos(p.yaw) * 12, z = p.z - Math.sin(p.yaw) * 12;
    st.place(x, z, Math.atan2(-(p.x - x), -(p.z - z)), -0.06);
    return JSON.stringify('белый олень ' + i);
  })()`);
  if (white) {
    await sleep(1500);
    console.log(`  редкое: ${white}`);
    await snap(tab, 'hunt-3d-rare', began);
    await tab.eval<string>(`(() => { const st = window.__mini; st.place(st.play.start.x, st.play.start.z, st.play.start.yaw, -0.05); return JSON.stringify('ok'); })()`);
  }
  // Палец движения справа: повести вбок — плавный поворот (`pad.turnRate`), рыскание до и после.
  const yawOf = 'JSON.stringify(window.__mini.yaw)';
  const y0 = await tab.eval<number>(yawOf);
  const px = SCREEN.width * 0.78;
  const py = SCREEN.height * 0.8;
  await mouse(tab, 'mouseMoved', px, py);
  await mouse(tab, 'mousePressed', px, py);
  for (let k = 1; k <= 6; k++) {
    await mouse(tab, 'mouseMoved', px + k * 8, py);
    await sleep(60);
  }
  await sleep(500);
  await snap(tab, 'hunt-3-pad', began);
  await mouse(tab, 'mouseReleased', px + 48, py);
  console.log(`  палец справа вбок: рыскание ${y0.toFixed(3)} → ${(await tab.eval<number>(yawOf)).toFixed(3)}`);
  const aim = await tab.eval<string>(`(() => {
    const st = window.__mini;
    const h = st.play.hunt;
    const t = h.now;
    const eye = { x: st.play.start.x, y: 1.62, z: st.play.start.z };
    // Ближний пасущийся олень, до которого дуга свободна: место со старта, поправка — той же дугой, что у стрелы.
    let best = -1, bestD = 1e9;
    h.field.deer.forEach((d, i) => {
      const p = h.pose(i, t);
      const dist = Math.hypot(p.x - eye.x, p.z - eye.z);
      if (p.kind === 'graze' && dist < bestD) { best = i; bestD = dist; }
    });
    if (best < 0) return JSON.stringify('оленей нет');
    const p = h.pose(best, t);
    const g = 9.8, v = 50, dy = 0.95 - 1.62, d = bestD - 0.6;
    const el = Math.atan((v * v - Math.sqrt(v ** 4 - g * (g * d * d + 2 * dy * v * v))) / (g * d));
    st.place(eye.x, eye.z, Math.atan2(-(p.x - eye.x), -(p.z - eye.z)), el);
    return JSON.stringify('олень ' + best + ' на ' + bestD.toFixed(1) + ' м, подъём ' + (el * 180 / Math.PI).toFixed(2) + '°');
  })()`);
  console.log(`  прицел: ${aim}`);
  const before = await tab.eval<{ got: number }>('JSON.stringify(window.__mini.play.tally())');
  // Кнопка «Натянуть» — левая половина холста.
  const pt = { x: Math.round(SCREEN.width * 0.2), y: Math.round(SCREEN.height * 0.82), button: 'left', clickCount: 1 };
  await tab.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...pt });
  await tab.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...pt });
  // Держать, пока тетива не натянута до конца: время сцены идёт кадрами, а программная отрисовка даёт их мало.
  await waitFor(tab, 'window.__mini.play.drawn() >= 1', 15000);
  await sleep(500);
  await snap(tab, 'hunt-3a-drawn', began);
  await tab.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...pt });
  // Наложение: правая несёт новую стрелу от колчана к тетиве (`archer.ts`, состояние руки `return`).
  if (await waitFor(tab, "window.__mini.play.archer && window.__mini.play.archer.state.hand === 'return'", 8000)) {
    await snap(tab, 'hunt-3a3-reload', began);
  }
  // Ждать, пока стрела ляжет: в оленя, в землю или в дерево.
  await waitFor(tab, 'window.__mini.play.hunt.arrows.length > 0 && window.__mini.play.hunt.arrows[0].end !== null', 20000);
  await sleep(600);
  const after = await tab.eval<{ got: number; total: number }>('JSON.stringify(window.__mini.play.tally())');
  const arrow = await tab.eval<string>(`JSON.stringify((() => { const a = window.__mini.play.hunt.arrows[0]; return a ? a.struck + ' ' + a.what : 'стрелы нет'; })())`);
  console.log(`  выстрел мышью: стрела — ${arrow}; оленей ${before.got} → ${after.got} из ${after.total}`);
  await snap(tab, 'hunt-3b-shot', began);
  // Олень крупно: в девяти шагах — дальше, чем он подпускает (`hunt.SEE_R`), сбоку.
  const close = await tab.eval<string>(`(() => {
    const st = window.__mini;
    const h = st.play.hunt;
    const i = h.field.deer.findIndex((_, k) => h.pose(k, h.now).kind === 'graze' || h.pose(k, h.now).kind === 'alert');
    if (i < 0) return JSON.stringify('стоящих нет');
    const p = h.pose(i, h.now);
    const x = p.x + Math.cos(p.yaw) * 9, z = p.z - Math.sin(p.yaw) * 9;
    st.place(x, z, Math.atan2(-(p.x - x), -(p.z - z)), -0.08);
    return JSON.stringify('олень ' + i + ': ' + p.kind);
  })()`);
  await sleep(1500);
  console.log(`  крупно: ${close}`);
  await snap(tab, 'hunt-3c-deer', began);
}

/** Мышь CDP по холсту — тот же путь, что у пальца (`Stage.onDown/onMove/onUp`). */
async function mouse(tab: Tab, type: 'mouseMoved' | 'mousePressed' | 'mouseReleased', x: number, y: number): Promise<void> {
  await tab.send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, buttons: type === 'mouseReleased' ? 0 : 1 });
}

const fishState = `JSON.stringify((() => { const p = window.__mini.play; const g = p.game; const L = g.line;
  return { phase: g.phase, age: (p.ruleT || 0) - g.since, bite: g.plan ? g.plan.bite : -1, window: g.plan ? g.plan.window : 0,
    tension: L ? L.tension : 0, dist: L ? L.dist : 0, reeling: L ? L.reeling : false, fish: g.fish ? g.fish.def.name + ' ' + g.fish.grams : '',
    caught: g.catches.length, power: p.power() }; })())`;

interface FishState {
  phase: string;
  age: number;
  bite: number;
  window: number;
  tension: number;
  dist: number;
  reeling: boolean;
  fish: string;
  caught: number;
  power: number;
}

/**
 * «Рыбалка»: берег со старта (руки и подписи-указатели первого входа), настоящий заброс мышью CDP — держит кнопку
 * «Заброс» справа, пока сила не дойдёт до двух третей, и отпускает; поплавок на воде, подсечка той же кнопкой в окне
 * поклёвки, вываживание «держи, пока натяжение ниже трёх четвертей» и вытащенная рыба в руке.
 */
async function fishing(tab: Tab, began: number): Promise<void> {
  await sleep(1500);
  await snap(tab, 'fish-3-shore', began);
  // Кнопка действия — правая половина холста.
  const x = SCREEN.width * 0.8;
  const y0 = SCREEN.height * 0.82;
  await mouse(tab, 'mouseMoved', x, y0);
  await mouse(tab, 'mousePressed', x, y0);
  await waitFor(tab, 'window.__mini.play.power() >= 0.66', 15000);
  await snap(tab, 'fish-3a-charge', began);
  await mouse(tab, 'mouseReleased', x, y0);
  if (!(await waitFor(tab, "window.__mini.play.game.phase === 'wait'", 20000))) {
    console.log(`  заброс: ${JSON.stringify(await tab.eval<FishState>(fishState))}`);
    return;
  }
  await sleep(800);
  await snap(tab, 'fish-3b-float', began);
  // Подсечка: перемотать к поклёвке (время сцены в программной отрисовке идёт медленно) и нажать в окне.
  await tab.eval<string>(`(() => { const st = window.__mini; const g = st.play.game; st.seek(g.since + g.plan.bite + 0.04); return JSON.stringify('ok'); })()`);
  await sleep(400);
  await snap(tab, 'fish-3b2-bite', began);
  // Подсечка — та же кнопка: нажатие (держать её и значит тянуть).
  await mouse(tab, 'mousePressed', x, y0);
  let s = await tab.eval<FishState>(fishState);
  console.log(`  подсечка: ${s.phase}${s.fish ? ` — ${s.fish} г на ${s.dist.toFixed(1)} м` : ''}`);
  let shot = false;
  let held = true;
  for (let i = 0; i < 1500 && s.phase === 'fight'; i++) {
    if (Date.now() - began > BROWSER_MAX_MS - 40000) break;
    const want = s.tension < 0.72;
    if (want !== held) {
      await mouse(tab, want ? 'mousePressed' : 'mouseReleased', x, y0);
      held = want;
    }
    if (!shot && s.tension > 0.45) {
      await snap(tab, 'fish-3c-fight', began);
      shot = true;
    }
    await sleep(40);
    s = await tab.eval<FishState>(fishState);
  }
  // Прыжок рыбы — снимком: рывок с прыжком у рыбы бывает не каждый, а стенду он нужен в кадре.
  if (s.phase === 'fight') {
    await tab.eval<string>(`(() => { const p = window.__mini.play; p.jumpAt = p.clock; return JSON.stringify('ok'); })()`);
    await sleep(1500);
    await snap(tab, 'fish-3c2-jump', began);
    // Вытащить: подвести рыбу к берегу (стенд меряет вид, а не терпение) — правило само засчитает её на следующем тике.
    await tab.eval<string>(`(() => { const g = window.__mini.play.game; if (g.line) g.line.dist = 1.5; return JSON.stringify('ok'); })()`);
    await waitFor(tab, "window.__mini.play.game.phase === 'show'", 8000);
    s = await tab.eval<FishState>(fishState);
  }
  if (held) await mouse(tab, 'mouseReleased', x, y0);
  if (s.phase === 'show') {
    await sleep(900);
    await snap(tab, 'fish-3d-caught', began);
  }
  console.log(`  вываживание: ${s.phase}, в садке ${s.caught}`);
}

async function game(tab: Tab, id: string, began: number): Promise<void> {
  const go = GO[id];
  console.log(`  ${await tab.eval<string>(click('button[aria-label="Энергия"]'))} — подсказка энергии`);
  await sleep(400);
  await snap(tab, `${id}-0-tip`, began);
  console.log(`  ${await tab.eval<string>(click('.nx-tip-go'))} — «Промыслы»`);
  await waitFor(tab, `document.querySelector('.nx-trade')`, 8000);
  await sleep(600);
  await snap(tab, `${id}-1-trades`, began);
  console.log(`  ${await tab.eval<string>(press(go))} — «${go}»`);
  if (!(await waitFor(tab, 'window.__mini', 30000))) {
    console.log(`  ${id}: сцена промысла не поднялась за 30 с`);
    return;
  }
  await sleep(2500);
  await snap(tab, `${id}-2-brief`, began);
  console.log(`  ${await tab.eval<string>(press('Начать'))} — «Начать»`);
  if (id === 'hunt') await hunt(tab, began);
  else if (id === 'fish') await fishing(tab, began);
  else await near(tab, id, began);
  // Итог: время выходит — трата энергии и добыча одним вызовом двери.
  await tab.eval<string>(`(() => { window.__mini.seek(1e6); return JSON.stringify('ok'); })()`);
  await sleep(1500);
  await snap(tab, `${id}-4-done`, began);
  console.log(`  ${await tab.eval<string>(press('В город'))} — «В город»`);
  await waitFor(tab, '!window.__mini || !document.querySelector(".mg")', 5000);
  await tab.eval<string>(`(() => { window.__mini = undefined; return JSON.stringify('ok'); })()`);
  await sleep(1500);
}

/** «Ягоды» и «Скот»: середина игры у цели, настоящий тап по холсту, у скота — стадо крупно. */
async function near(tab: Tab, id: string, began: number): Promise<void> {
  // Середина игры у цели: секунда и место — те же у любого прогона (раскладка от зерна партии).
  // У скота сначала охапка из стога — тем же тапом, что у игрока, — и цель уже животное.
  const T = id === 'berries' ? 30 : 20;
  const at = await tab.eval<string>(`(() => {
    const st = window.__mini;
    st.seek(${T});
    const play = st.play;
    ${id === 'herd' ? `play.tap(play.targets(${T})[0], ${T});` : ''}
    const t = play.targets(${T})[0];
    if (!t) return JSON.stringify('целей нет');
    // Встать у цели со стороны середины поляны, в шаге от края, лицом к ней.
    const r = Math.hypot(t.x, t.z) || 1;
    const k = (r - t.r - 1.3) / r;
    const x = t.x * k, z = t.z * k;
    st.place(x, z, Math.atan2(-(t.x - x), -(t.z - z)), -0.38);
    return JSON.stringify(t.verb);
  })()`);
  console.log(`  у цели: ${at}`);
  await sleep(1500);
  await snap(tab, `${id}-3-play`, began);
  // Палец движения слева: повести вверх — шаг вперёд, вбок — поворот; где стоял и куда смотрел — до и после.
  const pose = 'JSON.stringify({ x: window.__mini.px, z: window.__mini.pz, yaw: window.__mini.yaw })';
  const p0 = await tab.eval<{ x: number; z: number; yaw: number }>(pose);
  const lx = SCREEN.width * 0.22;
  const ly = SCREEN.height * 0.82;
  await mouse(tab, 'mouseMoved', lx, ly);
  await mouse(tab, 'mousePressed', lx, ly);
  for (let k = 1; k <= 6; k++) {
    await mouse(tab, 'mouseMoved', lx + k * 3, ly - k * 9);
    await sleep(60);
  }
  await sleep(400);
  await snap(tab, `${id}-3a-pad`, began);
  await mouse(tab, 'mouseReleased', lx + 18, ly - 54);
  const p1 = await tab.eval<{ x: number; z: number; yaw: number }>(pose);
  console.log(`  палец слева: шаг ${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(2)} м, поворот ${(p1.yaw - p0.yaw).toFixed(3)} рад`);
  // Назад к цели: тап ниже должен попасть по ней.
  await tab.eval<string>(`(() => { window.__mini.place(${p0.x}, ${p0.z}, ${p0.yaw}); return JSON.stringify('ok'); })()`);
  // Настоящий тап по холсту — мышью CDP: тот же путь, что у пальца (разбор жеста `prologue/controls` → `Stage.act`).
  const before = await tab.eval<{ got: number }>('JSON.stringify(window.__mini.play.tally())');
  const pt = { x: Math.round(SCREEN.width * 0.7), y: Math.round(SCREEN.height * 0.6), button: 'left', clickCount: 1 };
  await tab.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...pt });
  await tab.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...pt });
  await sleep(80);
  await tab.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...pt });
  await sleep(1200);
  const after = await tab.eval<{ got: number; total: number }>('JSON.stringify(window.__mini.play.tally())');
  console.log(`  тап по холсту: счёт ${before.got} → ${after.got} из ${after.total}`);
  await snap(tab, `${id}-3b-tap`, began);
  // Редкое (`RARE=1`): земляника или ягнёнок крупно — в трёх шагах, лицом к нему.
  const rare = await tab.eval<string>(`(() => {
    const st = window.__mini;
    const play = st.play;
    const t = 31;
    st.seek(t);
    let p = null;
    if (play.field) { const b = play.field.bushes.find((x) => x.kind === 'strawberry'); if (b) p = { x: b.x, z: b.z, what: 'земляника' }; }
    if (play.herd) { const i = play.herd.beasts.findIndex((x) => x.kind === 'lamb'); if (i >= 0) { const q = play.feed.at(i, t); p = { x: q.x, z: q.z, what: 'ягнёнок' }; } }
    if (!p) return JSON.stringify('');
    const r = Math.hypot(p.x, p.z) || 1;
    const k = (r - 2.6) / r;
    const x = p.x * k, z = p.z * k;
    st.place(x, z, Math.atan2(-(p.x - x), -(p.z - z)), -0.42);
    return JSON.stringify(p.what);
  })()`);
  if (rare) {
    await sleep(1500);
    console.log(`  редкое: ${rare}`);
    await snap(tab, `${id}-3d-rare`, began);
  }
  if (id === 'herd') {
    // Стадо целиком: овцы накормлены и легли, корова — крупно, козы — как идут.
    const seen = await tab.eval<string>(`(() => {
      const st = window.__mini;
      const play = st.play;
      const feed = play.feed;
      const t = 30;
      st.seek(t);
      play.herd.beasts.forEach((b, i) => { if (b.kind === 'sheep' && !feed.sated(i)) { feed.take(); feed.feed(i, t); } });
      const cow = play.herd.beasts.findIndex((b) => b.kind === 'cow');
      const c = feed.at(cow, t);
      const r = Math.hypot(c.x, c.z) || 1;
      const k = (r - 3.2) / r;
      const x = c.x * k, z = c.z * k;
      st.place(x, z, Math.atan2(-(c.x - x), -(c.z - z)), -0.18);
      return JSON.stringify('сыты: ' + play.tally().got + ' из ' + play.tally().total);
    })()`);
    await sleep(1500);
    console.log(`  стадо: ${seen}`);
    await snap(tab, 'herd-3c-herd', began);
  }
}

async function budget(): Promise<void> {
  // Счёт без браузера — той же обстановкой, что у сцены (`world.furnish`), и тем же счётчиком, что у теста бюджета.
  const { budgetOf, MINI_BUDGET } = await import('../src/minigames/budget');
  console.log('\n=== промыслы: бюджет кадра (счёт по графу сцены, без браузера) ===\n');
  for (const [id, shore] of [
    ['berries', 'river'],
    ['herd', 'river'],
    ['hunt', 'river'],
    ['fish', 'river'],
    ['fish', 'sea'],
  ] as const) {
    // По ступени (docs/polish.md, П-4): лепка и тень — те, с которыми сцена встаёт на этой ступени.
    // Погода — поверх (`stage.loadPrecip`): под дождём и снегом — осадки ступени и без прохода теней (`stage.castsShadow`).
    for (const tier of ['full', 'lite', 'base'] as const) {
      for (const wx of [null, 'rain', 'snow'] as const) {
        const c = budgetOf(id, tier, shore, wx);
        const lim = MINI_BUDGET[tier];
        console.log(
          `  ${(id === 'fish' ? `fish-${shore}` : id).padEnd(10)} ${tier.padEnd(4)} ${(wx ?? 'ясно').padEnd(5)}: вызовов ${c.calls + c.shadowCalls} (сцена ${c.calls}, тени ${c.shadowCalls}; ≤ ${lim.calls}), ` +
            `треугольников ${Math.round(c.triangles + c.shadowTriangles)} (сцена ${Math.round(c.triangles)}, тени ${Math.round(c.shadowTriangles)}; ≤ ${lim.triangles})`,
        );
      }
    }
  }
}

/** «Охота»: дуга полной натяжки — метки прицела, время полёта и падение от прямой на их далях (`hunt.pins`, `aimFor`). */
async function arc(): Promise<void> {
  const { DEER_BODY, EYE_Y, GRAVITY, V_FULL, aimFor, pins, speedOf } = await import('../src/minigames/hunt');
  console.log('\n=== охота: дуга стрелы (правило hunt.ts, без браузера) ===\n');
  for (const p of pins()) {
    const t = p.d / (V_FULL * Math.cos(aimFor(p.d, DEER_BODY.y - EYE_Y, V_FULL) ?? 0));
    console.log(
      `  ${String(p.d).padStart(2)} м: метка ${((p.angle * 180) / Math.PI).toFixed(2)}° ниже середины, полёт ${t.toFixed(2)} с, падение от прямой ${((GRAVITY * t * t) / 2).toFixed(2)} м`,
    );
  }
  console.log(`  скорость: натяжка 0.5 — ${speedOf(0.5).toFixed(1)} м/с, полная — ${speedOf(1).toFixed(1)} м/с`);
}

/**
 * «Рыбалка»: цель по берегу, поясу и сезону (`fishing.goalGrams`) и вываживание стратегией «держи, пока натяжение ниже 0.72,
 * удилище против рывка» — сколько секунд от подсечки на четырнадцати метрах до рыбы в руке, у средней рыбы каждого вида.
 */
async function fishNumbers(): Promise<void> {
  const F = await import('../src/minigames/fishing');
  console.log('\n=== рыбалка: цели и вываживание (правило fishing.ts, без браузера) ===\n');
  for (const shore of ['river', 'sea'] as const) {
    for (const zone of ['med', 'ocean', 'land', 'north'] as const) {
      const row = (['spring', 'summer', 'autumn', 'winter'] as const).map((season) => (F.goalGrams({ shore, zone, season }) / 1000).toFixed(1));
      console.log(`  цель ${shore === 'river' ? 'река' : 'море'} ${zone.padEnd(5)}: весна ${row[0]}, лето ${row[1]}, осень ${row[2]}, зима ${row[3]} кг`);
    }
  }
  for (const def of F.FISH) {
    const g = new F.Fishing(17, { shore: def.shore, zone: 'land', season: 'summer' });
    g.press(0);
    g.release(F.STEP, 1, 0);
    g.land = { x: 0, z: F.BANK_Z - 14, d: 14 };
    g.phase = 'wait';
    g.since = 0;
    g.plan = { fish: F.hookedOf(def, 0.5, 1), nibbles: [], bite: 0, window: 99 };
    g.press(0.05);
    let t = 0.05;
    let end = 'время';
    while (t < 60 && g.line) {
      t += 1 / 60;
      const L = g.line;
      const hold = L.tension < 0.72;
      if (hold !== L.reeling) {
        if (hold) g.press(t);
        else g.release(t, 0, 0);
      }
      const rod = L.surge ? -L.surge.side : 0;
      if (Math.abs(rod - L.rod) > 0.01) g.steer(t, rod);
      g.advance(t);
      const e = g.takeEvents().find((x) => x.kind === 'caught' || x.kind === 'snap' || x.kind === 'slack');
      if (e) end = e.kind === 'caught' ? 'в руке' : e.kind;
    }
    console.log(`  ${def.name.padEnd(9)} ${String(g.catches[0]?.grams ?? '—').padStart(5)} г: ${end} за ${(t - 0.05).toFixed(1)} с`);
  }
}

/**
 * Щуп добычи (docs/minigames.md, 18.4): средняя доля за выход у трёх рук автоматов (`minigames/bots.ts`) — прежние
 * правила против этапа 6, по каждой игре; новые правила — по каждому часу и средним по суткам города.
 */
async function yieldNumbers(): Promise<void> {
  const { hourWeights, yieldSeeds, yieldTable } = await import('../src/minigames/bots');
  const { HOURS } = await import('../src/minigames/rules');
  const n = Number(process.env.SEEDS ?? 200);
  const w = hourWeights();
  console.log(`\n=== промыслы: добыча за выход — прежние правила против этапа 6 (${n} зёрен, руки автоматов) ===\n`);
  console.log(`  часы суток города: ${HOURS.map((h) => `${h} ${(w[h] * 100).toFixed(1)} %`).join(', ')}`);
  for (const r of yieldTable(yieldSeeds(n))) {
    const hours = HOURS.map((h) => `${h} ${r.byHour[h].toFixed(3)}`).join(', ');
    console.log(`  ${r.game.padEnd(8)} ${r.hand.padEnd(9)} до ${r.before.toFixed(3)} · после ${r.after.toFixed(3)} (${((r.after / r.before - 1) * 100).toFixed(1)} %) · ${hours}`);
  }
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  if (process.env.BUDGET === '1') {
    await budget();
    await arc();
    await fishNumbers();
    await yieldNumbers();
    return;
  }
  const hourTime = HOUR ? await timeAt(SEASON, HOUR) : null;
  const seed = process.env.RARE === '1' ? await rareSeed() : null;
  refuseIfBusy('Снимки промыслов');
  const vite = await createVite({
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    server: { port: PORT, strictPort: true, host: '127.0.0.1' },
    logLevel: 'warn',
  });
  await vite.listen();
  try {
    console.log(`\n=== промыслы: снимки (${GAMES.join(', ')}${SEASON ? `; ${SEASON}` : ''}${HOUR ? `; ${HOUR}` : ''}) ===\n`);
    await gpuCoolDown('стендом промыслов');
    // В облачном контейнере браузер идёт от root без видеокарты: песочница Chrome там не поднимается,
    // а WebGL даёт только программная отрисовка (SwiftShader).
    const root = process.getuid?.() === 0 ? ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [];
    const chrome = await launchChrome(DEBUG_PORT, ['--use-gl=angle', '--window-size=500,900', '--force-device-scale-factor=1', ...root]);
    const began = Date.now();
    try {
      const tab = await Tab.open(DEBUG_PORT, reportPage(PORT, `${LOOK ? `&look=${LOOK}` : ''}${EXTRA}`));
      try {
        await tab.send('Emulation.setDeviceMetricsOverride', SCREEN);
        await tab.eval<string>('(() => { try { localStorage.clear(); } catch (e) {} return JSON.stringify("ok"); })()');
        await tab.send('Page.reload');
        if (!(await waitFor(tab, 'window.__game', 60000))) {
          console.log('  игра не поднялась за 60 с');
          return;
        }
        console.log(`  ${await enter(tab)}`);
        // Обучение и вести сняты: их строка и окна — не вид промыслов. Сезон — сдвигом времени партии.
        await tab.eval<string>(`(() => {
          const g = window.__game.getState();
          const s = g.s;
          s.tutorialDone = true;
          s.inbox = [];
          s.winterWarning = false;
          s.nextEventAt = s.time + 1e9;
          ${SEASON in SEASON_AT ? `s.time = ${SEASON_AT[SEASON]} * 300 + 30;` : ''}
          ${hourTime !== null ? `s.time = ${hourTime};` : ''}
          ${seed !== null ? `s.seed = ${seed}; delete s.energyFull;` : ''}
          ${process.env.BONDED ? `s.bonded = ${Number(process.env.BONDED)};` : ''}
          window.__game.setState({ s: { ...s } });
          return JSON.stringify('ok');
        })()`);
        await sleep(3000);
        if (process.env.FIT === '1') {
          await fitTop(tab, began);
          return;
        }
        await snap(tab, 'city', began);
        // Верх не шире экрана: ячейка энергии встала в строку, где уже золото, жители, мораль, дружина и сезон.
        const fit = await tab.eval<{ scroll: number; client: number }>(
          `JSON.stringify((() => { const e = document.querySelector('.nx-top'); return e ? { scroll: e.scrollWidth, client: e.clientWidth } : { scroll: -1, client: -1 }; })())`,
        );
        console.log(`  верхняя строка: ${fit.scroll} из ${fit.client} px${fit.scroll > fit.client ? ' — НЕ ВЛЕЗАЕТ' : ''}`);
        const cells = await tab.eval<string[]>(
          `JSON.stringify([...document.querySelectorAll('.nx-top > *')].map((e) => (e.getAttribute('aria-label') || e.className) + ' ' + Math.round(e.getBoundingClientRect().width)))`,
        );
        console.log(`  ячейки: ${cells.join(' · ')}`);
        // Окно двора: строка промысла стоит у своего двора (сбор — «Ягоды» — с ЗД-1 у Охотничьего двора, game/merged.ts).
        await tab.eval<string>(`(() => { const g = window.__game.getState(); const b = g.s.buildings.find((x) => x.type === 'hunter_hut'); g.openBuilding(b.id); return JSON.stringify('ok'); })()`);
        await sleep(1500);
        await snap(tab, 'yard', began);
        await tab.eval<string>(`(() => { window.__game.getState().closeSheet(); return JSON.stringify('ok'); })()`);
        await sleep(600);
        for (const id of GAMES) await game(tab, id, began);
      } finally {
        tab.close();
        await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${tab.target}`).catch(() => undefined);
      }
    } catch (e) {
      console.log(`  ${(e as Error).message}`);
    } finally {
      chrome.kill();
      gpuStamp();
    }
  } finally {
    await vite.close();
    await sleep(300);
  }
}

void main();
