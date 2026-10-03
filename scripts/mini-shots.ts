// Стенд промыслов (docs/minigames.md): снимки и счётчики кадра — не отчёт, в приёмку не входит.
//
//   npm run mini:shots                  — вход из города и обе игры: верх, подсказка энергии, «Промыслы»,
//                                         начало, середина игры у цели, итог; по каждому снимку — ступень,
//                                         вызовы отрисовки и треугольники прошлого кадра
//   GAMES=herd npm run mini:shots       — одна игра; GAMES=none — только город, верхняя строка и окно двора
//   SEASON=winter npm run mini:shots    — сезон города (снег на ветках)
//   LOOK=lite npm run mini:shots        — ступень вида приколота (`full`, `lite`, `base`)
//   WIDTH=375 npm run mini:shots        — ширина экрана, px (по умолчанию 390)
//   BONDED=12 npm run mini:shots        — невольники в городе: в верхней строке встаёт ячейка порядка
//   BUDGET=1 npm run mini:shots         — бюджет кадра счётом по графу сцены, без браузера (`world.frameCost`)
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
const GAMES = (process.env.GAMES ?? 'berries,herd')
  .split(',')
  .map((x) => x.trim())
  .filter((x) => x === 'berries' || x === 'herd');
const SEASON = process.env.SEASON ?? '';
const TAG = process.env.TAG ?? 'probe';
/** Ступень вида из адреса (`?look=full|lite|base`) — приколота, сторож её не трогает. */
const LOOK = process.env.LOOK ?? '';

/** Сезон города — сдвигом игрового времени партии: у сезона своего поля нет, он выводится из `s.time`. */
const SEASON_AT: Record<string, number> = { spring: 0, summer: 1, autumn: 2, winter: 3 };

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

async function waitFor(tab: Tab, expr: string, ms: number): Promise<boolean> {
  for (let t = 0; t < ms; t += 250) {
    if (await tab.eval<boolean>(`JSON.stringify(!!(${expr}))`).catch(() => false)) return true;
    await sleep(250);
  }
  return false;
}

async function game(tab: Tab, id: string, began: number): Promise<void> {
  const go = id === 'berries' ? 'В лес' : 'В загон';
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
  // Итог: время выходит — трата энергии и добыча одним вызовом двери.
  await tab.eval<string>(`(() => { window.__mini.seek(1e6); return JSON.stringify('ok'); })()`);
  await sleep(1500);
  await snap(tab, `${id}-4-done`, began);
  console.log(`  ${await tab.eval<string>(press('В город'))} — «В город»`);
  await waitFor(tab, '!window.__mini || !document.querySelector(".mg")', 5000);
  await tab.eval<string>(`(() => { window.__mini = undefined; return JSON.stringify('ok'); })()`);
  await sleep(1500);
}

async function budget(): Promise<void> {
  // Счёт без браузера — той же обстановкой, что у сцены (`world.furnish`), и тем же счётчиком, что у теста бюджета.
  const { budgetOf, MINI_BUDGET } = await import('../src/minigames/budget');
  console.log('\n=== промыслы: бюджет кадра (счёт по графу сцены, без браузера) ===\n');
  for (const id of ['berries', 'herd'] as const) {
    for (const shadows of [true, false]) {
      const c = budgetOf(id, shadows);
      const lim = MINI_BUDGET;
      console.log(
        `  ${id.padEnd(7)} тени ${shadows ? 'да ' : 'нет'}: вызовов ${c.calls + c.shadowCalls} (сцена ${c.calls}, тени ${c.shadowCalls}; ≤ ${lim.calls}), ` +
          `треугольников ${Math.round(c.triangles + c.shadowTriangles)} (сцена ${Math.round(c.triangles)}, тени ${Math.round(c.shadowTriangles)}; ≤ ${lim.triangles})`,
      );
    }
  }
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  if (process.env.BUDGET === '1') {
    await budget();
    return;
  }
  refuseIfBusy('Снимки промыслов');
  const vite = await createVite({
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    server: { port: PORT, strictPort: true, host: '127.0.0.1' },
    logLevel: 'warn',
  });
  await vite.listen();
  try {
    console.log(`\n=== промыслы: снимки (${GAMES.join(', ')}${SEASON ? `; ${SEASON}` : ''}) ===\n`);
    await gpuCoolDown('стендом промыслов');
    // В облачном контейнере браузер идёт от root без видеокарты: песочница Chrome там не поднимается,
    // а WebGL даёт только программная отрисовка (SwiftShader).
    const root = process.getuid?.() === 0 ? ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [];
    const chrome = await launchChrome(DEBUG_PORT, ['--use-gl=angle', '--window-size=500,900', '--force-device-scale-factor=1', ...root]);
    const began = Date.now();
    try {
      const tab = await Tab.open(DEBUG_PORT, reportPage(PORT, LOOK ? `&look=${LOOK}` : ''));
      try {
        await tab.send('Emulation.setDeviceMetricsOverride', SCREEN);
        await tab.eval<string>('(() => { try { localStorage.clear(); } catch (e) {} return JSON.stringify("ok"); })()');
        await tab.send('Page.reload');
        if (!(await waitFor(tab, 'window.__game', 60000))) {
          console.log('  игра не поднялась за 60 с');
          return;
        }
        console.log(`  ${await tab.eval<string>(ENTER_GAME)}`);
        // Обучение и вести сняты: их строка и окна — не вид промыслов. Сезон — сдвигом времени партии.
        await tab.eval<string>(`(() => {
          const g = window.__game.getState();
          const s = g.s;
          s.tutorialDone = true;
          s.inbox = [];
          s.winterWarning = false;
          s.nextEventAt = s.time + 1e9;
          ${SEASON in SEASON_AT ? `s.time = ${SEASON_AT[SEASON]} * 300 + 30;` : ''}
          ${process.env.BONDED ? `s.bonded = ${Number(process.env.BONDED)};` : ''}
          window.__game.setState({ s: { ...s } });
          return JSON.stringify('ok');
        })()`);
        await sleep(3000);
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
        // Окно двора: строка промысла стоит у своего двора (навес собирателей — «Ягоды»).
        await tab.eval<string>(`(() => { const g = window.__game.getState(); const b = g.s.buildings.find((x) => x.type === 'gathering'); g.openBuilding(b.id); return JSON.stringify('ok'); })()`);
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
