// Стенд снимков П-1 (docs/polish.md): шрифт и читаемость при светлой и тёмной теме Telegram, на iOS-подобном и
// Android-подобном виде. Не отчёт, в приёмку не входит — живёт в `docs/`, как стенд UI-1…8 (`docs/ui_v2/shots.ts`).
//
//   THEME=light OS=ios npx vite-node docs/polish/shots.ts      — один заход: тема клиента и вид телефона
//   THEME=dark OS=android npx vite-node docs/polish/shots.ts
//   APP_ROOT=<другая копия> TAG=before THEME=light OS=ios …     — «до»: та же съёмка чужой копии (общий `node_modules`)
//
// Клиент Telegram подменён: SDK с telegram.org не грузится (адрес закрыт), вместо него — объект `Telegram.WebApp` с
// палитрой темы (`themeParams`, `colorScheme`), платформой и вырезами, как их отдаёт настоящий клиент. Подпись запуска
// пустая — партия местная, как у стенда UI. Светлая тема — ещё и `prefers-color-scheme: light` у страницы: так её
// видит браузер телефона с включённой светлой темой.
//
// Снимки — 390×844 @2 (iOS — @3 не нужен: шрифт тот же), JPEG в `docs/polish/`. Бюджет железа (CLAUDE.md, раздел ⛔):
// один заход — один браузер, город раз в секунду, не дольше двух минут, минута остывания между заходами.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { createServer as createVite } from 'vite';
import sharp from 'sharp';
import { ENTER_GAME, launchChrome, sleep, Tab } from '../../scripts/lib/chrome';
import { BROWSER_MAX_MS, gpuCoolDown, gpuStamp, refuseIfBusy } from '../../scripts/lib/budget';

const OUT = fileURLToPath(new URL('.', import.meta.url));
const ROOT = process.env.APP_ROOT ?? fileURLToPath(new URL('../..', import.meta.url));
const PORT = Number(process.env.PORT ?? 4199);
const DEBUG_PORT = Number(process.env.CDP_PORT ?? 9344);
const FPS = 1;
const TAG = process.env.TAG ? `-${process.env.TAG}` : '';

const THEME = process.env.THEME === 'light' ? 'light' : 'dark';
const OS = process.env.OS === 'android' ? 'android' : 'ios';

/** Палитры клиента — как их отдаёт Telegram (iOS 11.x и Android 11.x, стандартные темы). */
const THEMES = {
  light: {
    bg_color: '#ffffff',
    text_color: '#000000',
    hint_color: '#8e8e93',
    link_color: '#007aff',
    button_color: '#007aff',
    button_text_color: '#ffffff',
    secondary_bg_color: '#efeff4',
    section_bg_color: '#ffffff',
    header_bg_color: '#f8f8f8',
  },
  dark: {
    bg_color: '#000000',
    text_color: '#ffffff',
    hint_color: '#98989e',
    link_color: '#3e88f7',
    button_color: '#3e88f7',
    button_text_color: '#ffffff',
    secondary_bg_color: '#1c1c1d',
    section_bg_color: '#2c2c2e',
    header_bg_color: '#1a1a1a',
  },
};

const DEVICES = {
  ios: {
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    // Развёрнутая аппка (не во весь экран): шапка клиента — над страницей, внутри только нижний вырез.
    safe: { top: 0, bottom: 34, left: 0, right: 0 },
    content: { top: 0, bottom: 0, left: 0, right: 0 },
  },
  android: {
    ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 Telegram-Android/11.2.3',
    safe: { top: 0, bottom: 0, left: 0, right: 0 },
    content: { top: 0, bottom: 0, left: 0, right: 0 },
  },
};

const SCREEN = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };

/** Клиент Telegram до первой строки страницы: объект `WebApp` держится, что бы ни присвоил SDK. */
const FAKE_TG = `(() => {
  const calls = (window.__tgCalls = []);
  const note = (name) => (v) => calls.push(name + ' ' + v);
  const app = {
    ready() {}, expand() {}, isExpanded: true,
    viewportHeight: ${SCREEN.height}, viewportStableHeight: ${SCREEN.height},
    colorScheme: '${THEME}',
    themeParams: ${JSON.stringify(THEMES[THEME])},
    safeAreaInset: ${JSON.stringify(DEVICES[OS].safe)},
    contentSafeAreaInset: ${JSON.stringify(DEVICES[OS].content)},
    initData: '', initDataUnsafe: {},
    version: '8.0', platform: '${OS}',
    setHeaderColor: note('шапка'), setBackgroundColor: note('фон'), setBottomBarColor: note('низ'),
    disableVerticalSwipes() {}, lockOrientation() {}, unlockOrientation() {},
    isVersionAtLeast() { return true; },
    HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    onEvent() {}, offEvent() {},
  };
  const tg = {};
  for (const [k, v] of [['WebApp', app], ['WebView', { postEvent() {} }], ['Utils', {}]])
    Object.defineProperty(tg, k, { get: () => v, set() {}, enumerable: true });
  Object.defineProperty(window, 'Telegram', { get: () => tg, set() {}, configurable: false });
})();`;

interface Step {
  name: string;
  run?: string;
  wait?: number;
}

const HELPERS = `(() => {
  const g = () => window.__game.getState();
  const txt = (el) => (el.getAttribute('aria-label') || '') + ' ' + (el.textContent || '');
  window.__ui = {
    click(label, scope) {
      const root = scope ? document.querySelector(scope) : document;
      const all = root ? [...root.querySelectorAll('button, [role=tab], a')] : [];
      const b = all.find((x) => x.getAttribute('aria-label') === label) || all.find((x) => txt(x).trim().startsWith(label)) || all.find((x) => txt(x).includes(label));
      if (!b) return 'нет кнопки «' + label + '»';
      b.click();
      return 'ok';
    },
    clickSel(sel) {
      const b = document.querySelector(sel);
      if (!b) return 'нет ' + sel;
      b.click();
      return 'ok';
    },
    building(type) {
      const b = g().s.buildings.find((x) => x.type === type);
      if (!b) return 'нет постройки ' + type;
      g().openBuilding(b.id);
      return 'ok';
    },
    reset() {
      if (document.querySelector('.nx-tip-catch')) document.querySelector('.nx-tip-catch').click();
      if (g().mapOpen) g().closeMap();
      if (g().sheet) g().closeSheet();
      const x = document.querySelector('.nx-realm .nx-ibtn[aria-label="Закрыть"]');
      if (x) x.click();
      return 'ok';
    },
  };
  return JSON.stringify('ok');
})()`;

const ui = (call: string): string => `JSON.stringify(window.__ui.${call})`;

const STEPS: Step[] = [
  { name: '01-city', run: ui('reset()'), wait: 1500 },
  { name: '02-tip-food', run: ui(`reset(), window.__ui.click('Еда', '.nx-res')`), wait: 500 },
  { name: '03-townhall', run: ui(`reset(), window.__ui.click('Ратуша', '.nx-nav')`), wait: 1000 },
  { name: '04-smithy', run: ui(`reset(), window.__ui.building('smithy')`), wait: 1000 },
  { name: '05-realm', run: ui(`reset(), window.__ui.clickSel('.coat-btn')`), wait: 1500 },
  ...(process.env.MAP === '1'
    ? [{ name: '06-map', run: `(() => { window.__ui.reset(); window.__game.getState().openMap(); return JSON.stringify('ok'); })()`, wait: 7000 }]
    : []),
];

async function snap(tab: Tab, name: string): Promise<void> {
  const png = await tab.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
  const jpg = await sharp(Buffer.from(png.data, 'base64')).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
  await writeFile(join(OUT, `${THEME}-${OS}-${name}${TAG}.jpg`), jpg);
}

async function run(): Promise<void> {
  const tab = await Tab.open(DEBUG_PORT, 'about:blank');
  const began = Date.now();
  try {
    await tab.send('Network.enable');
    await tab.send('Network.setBlockedURLs', { urls: ['*telegram.org*'] });
    await tab.send('Emulation.setDeviceMetricsOverride', SCREEN);
    await tab.send('Emulation.setUserAgentOverride', { userAgent: DEVICES[OS].ua, platform: OS === 'ios' ? 'iPhone' : 'Linux armv8l' });
    await tab.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: THEME }] });
    await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_TG });
    await tab.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?probe=1&fpscap=${FPS}&quality=low` });
    await sleep(1500);
    await tab.eval<string>('(() => { try { localStorage.clear(); } catch (e) {} return JSON.stringify("ok"); })()');
    await tab.send('Page.reload');
    let up = false;
    for (let i = 0; i < 150 && !up; i++) {
      await sleep(300);
      up = await tab.eval<boolean>('JSON.stringify(!!(window.__game && document.querySelector(".start-go, .start")))').catch(() => false);
    }
    if (!up) throw new Error('стартовый экран не встал за 45 с');
    await sleep(1500);
    await snap(tab, '00-start');
    console.log('  00-start');
    console.log(`  вход: ${await tab.eval<string>(ENTER_GAME)}`);
    await sleep(2500);
    await tab.eval<string>(`(() => {
      const st = document.createElement('style');
      st.textContent = '.trouble { display: none !important; }';
      document.head.appendChild(st);
      const s = window.__game.getState().s;
      s.tutorialDone = true;
      s.winterWarning = false;
      window.__game.setState({ s: { ...s } });
      return JSON.stringify('ok');
    })()`);
    await tab.eval<string>(HELPERS);
    // Прошлая вкладка того же браузера могла не успеть отдать партию («Игра открыта дважды», `net/session.ts`) —
    // окно не вид экрана, который снимаем.
    await tab.eval<string>(ui(`click('Продолжить здесь')`)).catch(() => '');
    await sleep(400);
    for (const step of STEPS) {
      if (Date.now() - began > BROWSER_MAX_MS - 10_000) {
        console.log(`  срок захода вышел — не сняты: ${STEPS.slice(STEPS.indexOf(step)).map((s) => s.name).join(', ')}`);
        break;
      }
      const said = step.run ? await tab.eval<unknown>(step.run).catch((e: Error) => `ошибка: ${e.message}`) : 'ok';
      await sleep(step.wait ?? 600);
      await snap(tab, step.name);
      console.log(`  ${step.name}${said === 'ok' ? '' : `: ${String(said)}`}`);
    }
    // Что увидел бы игрок: какие гарнитуры правда легли на экран и что игра сказала клиенту о цвете шапки.
    const fonts = await tab.eval<string[]>(
      `JSON.stringify([...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family + ' ' + f.weight + ' ' + f.unicodeRange.slice(0, 12)))`,
    );
    const calls = await tab.eval<string[]>('JSON.stringify(window.__tgCalls || [])');
    const text = await tab.eval<string>(`JSON.stringify(getComputedStyle(document.body).color + ' на ' + getComputedStyle(document.body).backgroundColor)`);
    console.log(`  шрифты: ${fonts.join('; ') || 'ни одного своего'}`);
    console.log(`  клиенту: ${calls.join('; ') || 'ничего'}`);
    console.log(`  текст страницы: ${text}`);
  } finally {
    tab.close();
    await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${tab.target}`).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  refuseIfBusy('Снимки П-1');
  await mkdir(OUT, { recursive: true });
  const vite = await createVite({
    configFile: join(ROOT, 'vite.config.ts'),
    root: ROOT,
    server: { port: PORT, strictPort: true, host: '127.0.0.1' },
    logLevel: 'warn',
  });
  await vite.listen();
  try {
    console.log(`\n=== П-1: тема ${THEME}, ${OS}${TAG} (390×844 @2, потолок ${FPS} кадр/с) ===\n`);
    await gpuCoolDown('снимками П-1');
    const root = process.getuid?.() === 0 ? ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [];
    const chrome = await launchChrome(DEBUG_PORT, ['--use-gl=angle', '--window-size=500,900', ...root]);
    try {
      await run();
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
