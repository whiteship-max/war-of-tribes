/**
 * Предыстория: что она стоит и проходится ли она пальцем.
 *
 * Отчёт отвечает на четыре вопроса, и все четыре — измерением, а не мнением:
 *
 *   кадр     сколько миллисекунд стоит кадр поляны на телефонном экране
 *            (375×812 @2) и на широком (1280×800 @1), сколько в нём вызовов
 *            отрисовки и треугольников;
 *   память   сколько занимает поляна и остаётся ли она после выхода;
 *   палец    проходится ли цепочка «дойти до топора → свалить дерево →
 *            положить дрова» **настоящим касанием**, а не вызовом метода;
 *   сцена    остаётся ли в игре ровно одна живая сцена — и возвращается ли
 *            диорама деревни после выхода из режима.
 *
 * ЗДЕСЬ НАСТОЯЩИЙ WEBGL, и это условие, а не подробность. `tap:report` мерит
 * поведение при подделанном контексте — ему хватает, кадра там нет вовсе. Здесь
 * весь вопрос как раз в кадре: сколько он стоит и рисуется ли он. Поэтому
 * Chrome поднимается с ANGLE, как у `scene:report` и `revive:report`.
 *
 * ПАЛЕЦ ТОЖЕ НАСТОЯЩИЙ: `Input.dispatchTouchEvent` при включённой тач-эмуляции —
 * тот же путь, что у живого касания (настоящие `pointerId`, настоящий захват,
 * настоящая склейка движений кадрами). Часы не подменены. Иначе стенд проверял
 * бы собственные вызовы, а не управление: ровно этим прежний стенд следа пальца
 * и обманывал, показывая 21 из 21 при потерянном каждом втором тапе.
 *
 * ЧЕГО НЕ МЕРЯЕТ:
 *   вид        картинку отсюда не показать; за внешним видом — глазами;
 *   вебвью     это Chrome, а не клиент Телеграма: перехват жеста клиентом здесь
 *              не воспроизвести, и на такой случай в игре стоит журнал касаний;
 *   удобство   стенд говорит «дошёл» и «сколько раз», а не «приятно ли». На это
 *              отвечает человек с телефоном в руках, и заменить его нечем.
 *
 * Запуск: npm run prologue:report
 * Переменные: SECONDS=6, PORT / CDP_PORT, CHROME=путь\\к\\chrome.exe, HEAD=1.
 */
import { createServer as createVite } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { launchChrome, sleep, Tab } from './lib/chrome';
import { BURN_FULL_MS, HEARTH_CAP, LOG_HOURS } from '../src/prologue/fire';
import { CHOPS_TO_FELL, GLADE_R, REACH, TREES, TREE_LOGS, WALK_SPEED, WARM_R } from '../src/prologue/glade';
import { CHILL_H, MEAT_FED_H, RAW_SHARE, STARVE_H, WARM_MIN } from '../src/prologue/body';
import { ARROWS_START, CARCASS_H, DEER_ALERT, DEER_FLEE, DEER_GAP_H, DEER_MEAT } from '../src/prologue/hunt';
import { ROAST_COST } from '../src/prologue/act';
import { LOOK_PER_PX, STICK_DEAD, STICK_FULL } from '../src/prologue/controls';
import { TAP_MS, TAP_SLIP } from '../src/gestures';

const PORT = Number(process.env.PORT ?? 4195);
const DEBUG_PORT = Number(process.env.CDP_PORT ?? 9338);
/** Сколько секунд кадров снимать на каждый экран. */
const SECONDS = Number(process.env.SECONDS ?? 6);

/** Сколько ждать после тапа по туше: движение длится, и торопить его нельзя. */
const BUTCHER_WAIT = 1000;

/** Два экрана: телефон в портрете и обычный монитор. */
const SCREENS = [
  { name: 'телефон 375×812 @2', w: 375, h: 812, dpr: 2, mobile: true },
  { name: 'ПК 1280×800 @1', w: 1280, h: 800, dpr: 1, mobile: false },
];

interface Frames {
  frames: number;
  seconds: number;
  fps: number;
  median: number;
  p95: number;
  worst: number;
  calls: number;
  triangles: number;
}

interface Chain {
  step: string;
  ok: boolean;
  said: string;
}

/**
 * Что подкладывается в страницу.
 *
 * Своих сведений о сцене здесь нет: положение игрока, дрова и топор
 * спрашиваются у самой сцены через `window.__pro`. Стенд только считает кадры и
 * водит пальцем.
 */
const PROBE = `
(() => {
  const pro = () => window.__pro;
  if (!pro()) throw new Error('нет window.__pro — предыстория не открыта или страница без ?probe=1');
  let stamps = [];
  let watching = false;
  const tick = () => {
    if (!watching) return;
    stamps.push(performance.now());
    requestAnimationFrame(tick);
  };
  window.__probe = {
    start() {
      stamps = [];
      watching = true;
      requestAnimationFrame(tick);
      return JSON.stringify('ok');
    },
    stop() {
      watching = false;
      const gaps = [];
      for (let i = 1; i < stamps.length; i++) gaps.push(stamps[i] - stamps[i - 1]);
      gaps.sort((a, b) => a - b);
      const at = (q) => (gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * q))] : 0);
      const seconds = stamps.length > 1 ? (stamps[stamps.length - 1] - stamps[0]) / 1000 : 0;
      const st = pro().stats();
      return JSON.stringify({
        frames: stamps.length,
        seconds,
        fps: seconds > 0 ? (stamps.length - 1) / seconds : 0,
        median: at(0.5),
        p95: at(0.95),
        worst: gaps.length ? gaps[gaps.length - 1] : 0,
        calls: st.calls,
        triangles: st.triangles,
      });
    },
    /** Где игрок, что у него в руках и что предлагает поляна. */
    state() {
      const p = pro();
      const v = p.snapshot();
      return JSON.stringify({
        x: p.where().x,
        z: p.where().z,
        yaw: p.where().yaw,
        logs: v.logs,
        axe: v.axe,
        bow: v.bow,
        quiver: v.quiver,
        cooked: v.cooked,
        raw: v.raw,
        fill: v.fireFill,
        words: v.fireWords,
        fed: v.fedWords,
        cold: v.coldWords,
        label: v.offer.label,
        can: v.offer.can,
        why: v.offer.why,
        shot: v.shot.label,
        shotCan: v.shot.can,
        drawn: v.drawn,
        dead: v.dead,
        arrows: p.arrowCount(),
        chops: v.busyLeft,
      });
    },
    /** Занята ли точка касания разметкой: под пальцем обязана быть канва. */
    free(x, y) {
      const el = document.elementFromPoint(x, y);
      return JSON.stringify(!!el && el.tagName === 'CANVAS');
    },
    /** Где сейчас зверь. Спрашиваем у сцены: второго источника у этого нет. */
    deer() {
      return JSON.stringify(pro().deerAt());
    },
    /** Где лежит туша. Тоже у сцены: она одна знает, где упал зверь. */
    carcass() {
      return JSON.stringify(pro().carcassAt());
    },
    /**
     * Холст обязан быть ПЕРВЫМ узлом надстройки.
     *
     * Проверка завелась не от хорошей жизни: канву заводит эффект, и она
     * дописывалась последней — непрозрачный холст закрывал собой все полосы и
     * обе кнопки разом. Тесты этого не видят вовсе. Спрашивать про точку тут
     * нельзя: половина надстройки нарочно не берёт нажатий, и «под холстом» от
     * «не нажимается» так не отличить. А порядок узлов — ровно то, из чего
     * берётся порядок рисования.
     */
    floor() {
      const box = document.querySelector('.pro');
      const first = box && box.firstElementChild;
      return JSON.stringify(first ? first.tagName.toLowerCase() : 'пусто');
    },
    /**
     * Видна ли надстройка, а не закрыта ли она холстом.
     *
     * Проверка завелась не от хорошей жизни: холст заводит эффект, поэтому в
     * разметке он оказывался ПОСЛЕДНИМ и закрывал собой все кнопки разом.
     * Тесты этого не видят вовсе, а стенд, который жмёт кнопки вызовом, не
     * увидел бы тоже. Спрашиваем то же, что видит палец.
     */
    onTop(sel) {
      const el = document.querySelector(sel);
      if (!el) return JSON.stringify('нет в разметке');
      const r = el.getBoundingClientRect();
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return JSON.stringify(el.contains(at) || at === el ? '' : 'под ' + (at ? at.tagName.toLowerCase() : 'ничем'));
    },
    /** Сколько живых сцен в игре — единственный честный ответ про утечку. */
    canvases() {
      return JSON.stringify(document.querySelectorAll('canvas').length);
    },
    heap() {
      return JSON.stringify(performance.memory ? performance.memory.usedJSHeapSize : 0);
    },
  };
  return JSON.stringify('ok');
})()
`;

/** Счётчик кадров для пустой страницы: тот же приём, что у `PROBE`, но без сцены. */
const ROOF = `
(() => {
  let s = [];
  let on = true;
  const tick = () => { if (!on) return; s.push(performance.now()); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  window.__c = () => {
    on = false;
    const g = [];
    for (let i = 1; i < s.length; i++) g.push(s[i] - s[i - 1]);
    g.sort((a, b) => a - b);
    const sec = s.length > 1 ? (s[s.length - 1] - s[0]) / 1000 : 0;
    return JSON.stringify({ fps: sec > 0 ? (s.length - 1) / sec : 0, median: g[Math.floor(g.length / 2)] || 0 });
  };
  return JSON.stringify('ok');
})()
`;

const pad = (s: string, n: number): string => (s.length >= n ? s : s + ' '.repeat(n - s.length));
const num = (v: number, n = 1): string => v.toFixed(n);
const yes = (ok: boolean): string => (ok ? 'да' : 'НЕТ');

const chain: Chain[] = [];
const step = (name: string, ok: boolean, said: string): void => {
  chain.push({ step: name, ok, said });
  console.log(`  ${pad(name, 40)} ${pad(yes(ok), 4)} ${said}`);
};

async function main(): Promise<void> {
  const vite = await createVite({
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    server: { port: PORT, strictPort: true, host: '127.0.0.1' },
    logLevel: 'warn',
  });
  await vite.listen();
  const chrome = await launchChrome(DEBUG_PORT, [
    '--use-gl=angle',
    '--enable-precise-memory-info',
    '--window-size=1280,900',
  ]);
  try {
    await report();
  } finally {
    chrome.kill();
    await vite.close();
    await sleep(300);
  }
  const bad = chain.filter((c) => !c.ok);
  if (bad.length) {
    console.log(`\nСорвалось: ${bad.map((c) => c.step).join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('\nЦепочка проходится настоящим касанием, живая сцена в игре одна.');
  }
}

/**
 * Сколько кадров в секунду даёт **сама машина** — на пустой странице.
 *
 * Без этого числа замер сцены нечитаем. Кадры отдаёт не игра, а окно: на той же
 * машине пустой about:blank выдавал то 60.0, то 56.5 — и «57.4 у поляны» в
 * первом случае значит просадку, а во втором потолок. Считать разницу
 * регрессией сцены, не спросив у окна, значит чинить не то.
 */
/**
 * Сколько кадров в секунду даёт **сама машина** — на пустой странице.
 *
 * Без этого числа замер сцены нечитаем. Кадры отдаёт не игра, а окно: на одной
 * и той же машине пустой about:blank выдавал то 60.0, то 56.5 — и «57.4 у
 * поляны» в первом случае значит просадку, а во втором потолок. Считать разницу
 * регрессией сцены, не спросив у окна, значит чинить не то.
 */
async function ceiling(): Promise<{ fps: number; median: number }> {
  const blank = await Tab.open(DEBUG_PORT, 'about:blank');
  await blank.send('Emulation.setDeviceMetricsOverride', {
    width: SCREENS[0].w,
    height: SCREENS[0].h,
    deviceScaleFactor: SCREENS[0].dpr,
    mobile: true,
  });
  await blank.eval<string>(ROOF);
  await sleep(3000);
  const out = await blank.eval<{ fps: number; median: number }>('window.__c()');
  blank.close();
  return out;
}

async function report(): Promise<void> {
  const roof = await ceiling();
  const tab = await Tab.open(DEBUG_PORT, `http://127.0.0.1:${PORT}/?probe=1`);
  const screen = async (s: (typeof SCREENS)[number]): Promise<void> => {
    await tab.send('Emulation.setDeviceMetricsOverride', {
      width: s.w,
      height: s.h,
      deviceScaleFactor: s.dpr,
      mobile: s.mobile,
    });
  };
  await screen(SCREENS[0]);
  await tab.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  // Начинаем с чистого листа: и партия, и предыстория. Иначе стенд мерил бы
  // чужой костёр и чужие пни из localStorage.
  await tab.eval<string>('(() => { try { localStorage.clear(); } catch (e) {} return JSON.stringify("ok"); })()');
  await tab.send('Page.reload');

  for (let i = 0; ; i++) {
    await sleep(300);
    if (await tab.eval<boolean>("JSON.stringify(!!document.querySelector('.start-alt'))")) break;
    if (i > 100) throw new Error('стартовый экран не поднялся за 30 с — смотри вывод «в странице:» выше');
  }
  const before = await tab.eval<number>("JSON.stringify(document.querySelectorAll('canvas').length)");
  const heapVillage = await tab.eval<number>(
    'JSON.stringify(performance.memory ? performance.memory.usedJSHeapSize : 0)',
  );

  // Кнопку жмём прямо: стенд мерит не её, а то, что за ней. Не нашлась — это
  // находка, а не помеха: значит, стартовый экран переделали.
  await tab.eval<string>("(() => { document.querySelector('.start-alt').click(); return JSON.stringify('ok'); })()");
  for (let i = 0; ; i++) {
    await sleep(200);
    if (await tab.eval<boolean>('JSON.stringify(!!window.__pro)')) break;
    if (i > 100) throw new Error('предыстория не открылась за 20 с');
  }
  await tab.eval<string>(PROBE);
  await sleep(800);

  const state = (): Promise<Record<string, number & string & boolean>> =>
    tab.eval('window.__probe.state()');

  console.log('=== предыстория ===\n');
  console.log(
    `Поляна: радиус ${GLADE_R} м, ${TREES.length} деревьев, шаг ${WALK_SPEED} м/с, досягаемость ${REACH} м.`,
  );
  console.log(
    `Палец: мёртвая зона ${STICK_DEAD} px, полный ход ${STICK_FULL} px, поворот ${LOOK_PER_PX}°/px; тап живёт до ${TAP_SLIP} px и ${TAP_MS} мс.\n`,
  );

  // ---------- 0. Числа режима ----------
  //
  // Считаются из самих констант, а не переписываются в отчёт руками: число,
  // которому никто не верит, хуже отсутствующего.
  console.log('0. Сколько чего хватает\n');
  const row = (a: string, b: string, c = ''): void => console.log(`  ${pad(a, 30)} ${pad(b, 20)} ${c}`);
  row('полено', `${LOG_HOURS} ч`, `дерево даёт ${TREE_LOGS} полена = ${TREE_LOGS * LOG_HOURS} ч огня`);
  row('полный очаг', `${BURN_FULL_MS / 3_600_000} ч`, `${HEARTH_CAP} полен`);
  row('без еды', `${STARVE_H} ч`, 'ровно столько же, сколько горит полный очаг');
  row('без огня', `${CHILL_H} ч`, `отогревается за ${WARM_MIN} мин; круг у костра ${WARM_R.toFixed(2)} м`);
  row('кусок жареного мяса', `${MEAT_FED_H} ч`, `сырой втрое хуже: ${num(MEAT_FED_H * RAW_SHARE * 60, 0)} мин`);
  row('олень', `${DEER_MEAT} кусков = ${DEER_MEAT * MEAT_FED_H} ч`, 'ровно полный живот');
  row('жарка оленя целиком', `${DEER_MEAT * ROAST_COST} полена`, 'то есть ровно одно дерево');
  row('следующий олень', `${DEER_GAP_H} ч`, `туша лежит ${CARCASS_H} ч`);
  row('стрел в колчане', String(ARROWS_START), 'подбираются, поэтому не кончаются насовсем');
  row('замечает / срывается', `${DEER_ALERT} / ${DEER_FLEE} м`, `тап достаёт на ${REACH} м — вчетверо ближе`);
  console.log('');
  const logsPerDay = 24 / LOG_HOURS;
  const meatPerDay = 24 / MEAT_FED_H;
  row('на сутки нужно дров', `${logsPerDay} полена`, `${num(logsPerDay / TREE_LOGS, 1)} дерева`);
  row('и еды', `${meatPerDay} куска`, `${num(meatPerDay / DEER_MEAT, 2)} оленя`);
  console.log('');
  // ---------- 1. Палец ----------
  await screen(SCREENS[0]);
  await sleep(600);
  console.log('1. Цепочка настоящим касанием (телефон 375×812)\n');

  const send = (type: string, points: { id: number; x: number; y: number }[]): Promise<unknown> =>
    tab.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p) => ({ ...p, radiusX: 12, radiusY: 12, force: 1 })),
    });

  /** Тап: положить палец, подержать по-человечески, снять. */
  const tap = async (x: number, y: number): Promise<void> => {
    const free = await tab.eval<boolean>(`window.__probe.free(${x}, ${y})`);
    if (!free) throw new Error(`точка ${x},${y} занята разметкой — касание достанется не сцене`);
    await send('touchStart', [{ id: 1, x, y }]);
    await sleep(90);
    await send('touchEnd', []);
    await sleep(120);
  };

  /**
   * Держать стик ходьбы столько-то миллисекунд.
   *
   * Палец кладётся в левую половину и уводится вверх на полный ход — ровно так,
   * как это делает большой палец. Движения идут не одним скачком, а шагами:
   * живой палец едет, и склейка событий кадрами — часть настоящего пути.
   */
  const walk = async (ms: number, dx = 0, dy = -STICK_FULL): Promise<void> => {
    const ox = 80;
    const oy = 660;
    await send('touchStart', [{ id: 2, x: ox, y: oy }]);
    for (let i = 1; i <= 6; i++) {
      await send('touchMove', [{ id: 2, x: ox + (dx * i) / 6, y: oy + (dy * i) / 6 }]);
      await sleep(16);
    }
    await sleep(ms);
    await send('touchEnd', []);
    await sleep(120);
  };

  /** Тянуть взглядом: палец в правой половине, поворот на столько-то градусов. */
  const look = async (deg: number): Promise<void> => {
    const px = Math.round(-deg / LOOK_PER_PX);
    const ox = 280;
    const oy = 400;
    await send('touchStart', [{ id: 3, x: ox, y: oy }]);
    const steps = Math.max(4, Math.min(20, Math.abs(px) / 8));
    for (let i = 1; i <= steps; i++) {
      await send('touchMove', [{ id: 3, x: ox + (px * i) / steps, y: oy }]);
      await sleep(16);
    }
    await send('touchEnd', []);
    await sleep(120);
  };

  const start = await state();
  step(
    'вход: игрок у костра, дров нет',
    start.label === 'Подложить дров' && !start.can && start.logs === 0,
    `«${start.label}» — ${start.why || 'можно'}, костёр ${start.words}`,
  );

  // Идём к колоде с топором. Куда смотреть, стенд не подбирает: игрок при входе
  // уже повёрнут к ней (`START.yaw`), и если это перестанет быть так, шаг сорвётся.
  let steps = 0;
  for (; steps < 8; steps++) {
    const now = await state();
    if (now.label === 'Взять топор') break;
    await walk(420);
  }
  const atAxe = await state();
  step(
    'дошёл до топора пешком',
    atAxe.label === 'Взять топор' && atAxe.can === true,
    `${steps} нажатий стика, ${num(Math.hypot(atAxe.x, atAxe.z))} м от костра`,
  );

  await tap(190, 400);
  const took = await state();
  step('тап взял топор', took.axe === true, `в руках: ${took.axe ? 'топор' : 'ничего'}`);

  // Ищем дерево: поворачиваемся и идём, пока поляна не предложит рубку.
  let turns = 0;
  let found = false;
  for (; turns < 14 && !found; turns++) {
    await walk(500);
    const now = await state();
    if (now.label === 'Рубить' && now.can) {
      found = true;
      break;
    }
    // Не упёрлись ни во что — довернём и пойдём снова.
    if (turns % 2 === 1) await look(35);
  }
  const atTree = await state();
  step(
    'дошёл до дерева',
    found,
    found ? `${turns + 1} заходов, стоит в ${num(Math.hypot(atTree.x, atTree.z))} м от костра` : 'не нашёл дерева',
  );

  if (found) {
    for (let i = 0; i < CHOPS_TO_FELL; i++) {
      await tap(190, 400);
      // Замах длится, и следующий удар до его конца не принимается — это правило,
      // а не задержка стенда: ждём столько же, сколько ждёт игрок.
      await sleep(750);
    }
    const felled = await state();
    step(
      `${CHOPS_TO_FELL} тапа свалили дерево`,
      felled.logs === 3,
      `дров в руках: ${felled.logs}, у дерева теперь «${felled.label}»`,
    );
  }

  // Возвращаемся к костру. Он в середине поляны, значит идти надо на неё.
  let back = 0;
  for (; back < 16; back++) {
    const now = await state();
    if (now.label === 'Подложить дров' && now.can) break;
    const r = Math.hypot(now.x, now.z);
    // Курс на костёр: разворачиваемся к середине и идём.
    const want = (Math.atan2(-(0 - now.x), -(0 - now.z)) * 180) / Math.PI;
    const have = (now.yaw * 180) / Math.PI;
    let turn = ((want - have + 540) % 360) - 180;
    if (Math.abs(turn) > 12) {
      if (turn > 90) turn = 90;
      if (turn < -90) turn = -90;
      await look(turn);
    }
    await walk(r > 6 ? 700 : 260);
  }
  const atFire = await state();
  step(
    'вернулся к костру',
    atFire.label === 'Подложить дров' && atFire.can === true,
    `${back} заходов, ${num(Math.hypot(atFire.x, atFire.z))} м от середины`,
  );

  const fillBefore = atFire.fill as unknown as number;
  await tap(190, 300);
  const fed = await state();
  step(
    'тап положил дрова в костёр',
    (fed.fill as unknown as number) > fillBefore && fed.logs === 0,
    `костёр ${num((fed.fill as unknown as number) * 100, 0)}% (было ${num(fillBefore * 100, 0)}%), ${fed.words}`,
  );

  // ---------- 1б. Охота ----------
  //
  // Тем же настоящим касанием: пожитки у палатки, лук своей кнопкой, стрела
  // туда, куда смотрят, туша по куску, жарка на костре и еда. Это и есть
  // «круг», и его длительность здесь меряется часами, а не прикидывается.
  console.log('');
  const loopFrom = Date.now();

  /** Дойти до того, что даёт нужную надпись. Ходим, а не телепортируемся. */
  const walkTo = async (tx: number, tz: number, want: string, tries = 22): Promise<boolean> => {
    for (let i = 0; i < tries; i++) {
      const now = await state();
      if (String(now.label).startsWith(want) && now.can === true) return true;
      const dx = tx - (now.x as unknown as number);
      const dz = tz - (now.z as unknown as number);
      const d = Math.hypot(dx, dz);
      const wantDeg = (Math.atan2(-dx, -dz) * 180) / Math.PI;
      const haveDeg = ((now.yaw as unknown as number) * 180) / Math.PI;
      let turn = ((wantDeg - haveDeg + 540) % 360) - 180;
      if (Math.abs(turn) > 10) {
        turn = Math.max(-100, Math.min(100, turn));
        await look(turn);
      }
      await walk(d > 5 ? 640 : 200);
    }
    const now = await state();
    return String(now.label).startsWith(want) && now.can === true;
  };

  /** Повернуться к точке, не сходя с места. */
  const turnTo = async (tx: number, tz: number): Promise<void> => {
    for (let i = 0; i < 6; i++) {
      const now = await state();
      const wantDeg = (Math.atan2(-(tx - (now.x as unknown as number)), -(tz - (now.z as unknown as number))) * 180) / Math.PI;
      const haveDeg = ((now.yaw as unknown as number) * 180) / Math.PI;
      const turn = ((wantDeg - haveDeg + 540) % 360) - 180;
      if (Math.abs(turn) <= 6) return;
      await look(Math.max(-100, Math.min(100, turn)));
    }
  };

  /** Нажать кнопку лука пальцем, а не вызовом: она такая же кнопка, как все. */
  const bowTap = async (): Promise<void> => {
    const box = await tab.eval<{ x: number; y: number } | null>(
      "(() => { const b = document.querySelector('.pro-bow'); if (!b) return JSON.stringify(null); const r = b.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }); })()",
    );
    if (!box) throw new Error('кнопки лука нет в разметке');
    await send('touchStart', [{ id: 4, x: box.x, y: box.y }]);
    await sleep(80);
    await send('touchEnd', []);
    await sleep(140);
  };

  const gotKit = await walkTo(-3.3, -2.5, 'Взять лук');
  if (gotKit) await tap(190, 400);
  const kit = await state();
  step(
    'у палатки взял лук и запас',
    kit.bow === true && (kit.quiver as unknown as number) > 0 && (kit.cooked as unknown as number) > 0,
    `лук: ${kit.bow ? 'да' : 'нет'}, стрел ${kit.quiver}, жареного ${kit.cooked}`,
  );

  // Надстройка обязана быть видна пальцу, а не лежать под холстом.
  const covered: string[] = [];
  for (const sel of ['.pro-do', '.pro-bow', '.pro-out']) {
    const why = await tab.eval<string>(`window.__probe.onTop(${JSON.stringify(sel)})`);
    if (why) covered.push(`${sel} ${why}`);
  }
  step('кнопки достаются пальцу', covered.length === 0, covered.length ? covered.join(', ') : 'действие, лук и выход');
  const floor = await tab.eval<string>('window.__probe.floor()');
  step('холст — пол, а не потолок', floor === 'canvas', `первый узел надстройки: ${floor}`);

  // Стреляем в зверя. Он не подпускает ближе `DEER_FLEE`, поэтому и лук нужен.
  let hit = false;
  let shots = 0;
  for (let i = 0; i < ARROWS_START && !hit; i++) {
    const beast = await tab.eval<{ x: number; z: number } | null>('window.__probe.deer()');
    if (!beast) break;
    await turnTo(beast.x, beast.z);
    await bowTap();
    const drawn = await state();
    if (drawn.drawn !== true) break;
    // Целимся ещё раз: пока натягивали, зверь мог шагнуть.
    const again = await tab.eval<{ x: number; z: number } | null>('window.__probe.deer()');
    if (again) await turnTo(again.x, again.z);
    await bowTap();
    shots++;
    await sleep(900);
    hit = (await tab.eval<{ x: number; z: number } | null>('window.__probe.deer()')) === null;
  }
  const shotState = await state();
  step(
    'лук: натянул и пустил стрелу',
    shots > 0 && (shotState.quiver as unknown as number) < ARROWS_START,
    `выстрелов ${shots}, в колчане ${shotState.quiver}, на земле ${shotState.arrows}`,
  );
  step('стрела не размножилась', (shotState.quiver as unknown as number) + (shotState.arrows as unknown as number) === ARROWS_START, `${shotState.quiver} + ${shotState.arrows} = ${ARROWS_START}`);
  step('олень свален', hit, hit ? `с ${shots} выстрела` : `${shots} выстрелов мимо — зверь ушёл`);

  // Туша: подходим по надписи, режем до конца.
  let cuts = 0;
  const body = hit ? await tab.eval<{ x: number; z: number } | null>('window.__probe.carcass()') : null;
  if (body && (await walkTo(body.x, body.z, 'Срезать мясо'))) {
    for (let i = 0; i < DEER_MEAT + 2; i++) {
      const now = await state();
      if (!String(now.label).startsWith('Срезать')) break;
      await tap(190, 400);
      await sleep(BUTCHER_WAIT);
      cuts++;
    }
  }
  const butchered = await state();
  step(
    'с туши срезано мясо',
    (butchered.raw as unknown as number) > 0,
    `${cuts} движений, сырого ${butchered.raw}`,
  );

  // Домой: пожарить и поесть.
  const backHome = await walkTo(0, 0, 'Пожарить');
  if (backHome) await tap(190, 300);
  const roasted = await state();
  step(
    'мясо пожарено на костре',
    (roasted.cooked as unknown as number) > (kit.cooked as unknown as number),
    `жареного ${roasted.cooked} (было ${kit.cooked}), сырого ${roasted.raw}, костёр ${roasted.words}`,
  );

  console.log(`\n  Круг «нарубить — подстрелить — пожарить» занял ${num((Date.now() - loopFrom) / 1000, 0)} с настоящими часами.`);

  // ---------- 2. Кадр ----------
  //
  // Меряется ПОСЛЕ цепочки нарочно: к этой минуте по поляне ходит олень (или
  // лежит туша), в траве торчат стрелы, а в руке топор и лук. Мерить пустую
  // поляну значило бы мерить не то, что видит игрок.
  const budget: [string, Frames][] = [];
  for (const s of SCREENS) {
    await screen(s);
    // Холст меняет размер по ResizeObserver — дадим ему кадр-другой улечься.
    await sleep(700);
    await tab.eval<string>('window.__probe.start()');
    await sleep(SECONDS * 1000);
    budget.push([s.name, await tab.eval<Frames>('window.__probe.stop()')]);
  }
  const heapGlade = await tab.eval<number>('window.__probe.heap()');

  console.log('\n2. Бюджет кадра (настоящий WebGL, ANGLE)\n');
  console.log(
    `  ${pad('экран', 20)} ${pad('кадров', 7)} ${pad('в секунду', 10)} ${pad('медиана', 8)} ${pad('p95', 7)} ${pad('худший', 7)} ${pad('вызовов', 8)} треугольников`,
  );
  for (const [name, f] of budget) {
    console.log(
      `  ${pad(name, 20)} ${pad(String(f.frames), 7)} ${pad(num(f.fps), 10)} ${pad(num(f.median, 2), 8)} ${pad(num(f.p95, 2), 7)} ${pad(num(f.worst, 2), 7)} ${pad(String(f.calls), 8)} ${f.triangles}`,
    );
  }
  console.log(
    `\n  Потолок самой машины (пустая страница): ${num(roof.fps)} в секунду, медиана ${num(roof.median, 2)} мс.`,
  );
  console.log('  Бюджет кадра при шестидесяти — 16.7 мс; поляна обязана держаться потолка, а не числа 60.');
  console.log(
    `  Память: деревня ${(heapVillage / 1048576).toFixed(1)} МБ, поляна ${(heapGlade / 1048576).toFixed(1)} МБ.`,
  );

  // ---------- 3. Одна живая сцена ----------
  console.log('\n3. Живая сцена одна, диорама возвращается\n');
  const during = await tab.eval<number>('window.__probe.canvases()');
  step('в предыстории холст один', during === 1, `холстов: ${during} (в деревне было ${before})`);

  await tab.eval<string>("(() => { document.querySelector('.pro-out').click(); return JSON.stringify('ok'); })()");
  await sleep(1200);
  const after = await tab.eval<number>("JSON.stringify(document.querySelectorAll('canvas').length)");
  const gone = await tab.eval<boolean>("JSON.stringify(!document.querySelector('.pro'))");
  step('после выхода поляны нет', gone, `разметка предыстории ${gone ? 'убрана' : 'осталась'}`);
  step('диорама вернулась одна', after === 1, `холстов после выхода: ${after}`);

  // Возвращаемся ещё раз: пересборка не должна плодить сцены.
  await tab.eval<string>("(() => { document.querySelector('.start-alt').click(); return JSON.stringify('ok'); })()");
  await sleep(1500);
  await tab.eval<string>("(() => { document.querySelector('.pro-out').click(); return JSON.stringify('ok'); })()");
  await sleep(1500);
  const twice = await tab.eval<number>("JSON.stringify(document.querySelectorAll('canvas').length)");
  step('второй заход ничего не оставил', twice === 1, `холстов после двух кругов: ${twice}`);

  tab.close();
}

void main();
