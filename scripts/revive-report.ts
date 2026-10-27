/**
 * Возвращается ли диорама сама: потеря контекста, скрытая страница, чужой размер.
 *
 * Заведён по жалобе с телефона: свернул мини-аппку в Телеграме, развернул — на
 * месте деревни чёрный прямоугольник. Воспроизводится не каждый раз, а
 * «нестабильно» — это ровно тот случай, когда любая правка кажется помогшей.
 * Поэтому здесь настоящий Chrome с настоящим WebGL, и болезни устраиваются
 * нарочно, а не ожидаются.
 *
 * ЧЕМ ОТЛИЧАЕТСЯ ОТ `tap:report`. У того контекст канвы подделан заглушкой —
 * WebGL там нет вовсе, а значит нет и расширения `WEBGL_lose_context`, которым
 * потеря устраивается. Здесь наоборот: браузер поднят с настоящим ANGLE
 * (`--use-gl=angle`, как у `scene:report`), кадры настоящие, и потеря контекста
 * настоящая — та же самая, что случается на телефоне.
 *
 * ЧТО ПРОВЕРЯЕТСЯ — всё на достроенном городе (docs/scene-revive.md, раздел 10): у игрока контекст теряет город
 * целиком, а не дымка, которая стоит на его месте первые секунды, и кадр после возврата иначе собирал бы стройку:
 *   1) потеря и возврат — контекст теряется, кадры встают, контекст возвращается,
 *      кадры идут снова, и диорама при этом та же самая;
 *   2) потеря без возврата — расширение обезврежено (так ведёт себя настоящая
 *      потеря: вернуть её `restoreContext` не может), и сцена обязана пересобрать
 *      себя целиком, не требуя перезахода в игру; кадры меряются у пересобранного и достроенного города;
 *   3) скрытая страница — кадров нет, при возвращении идут снова;
 *   4) чужой размер — холст, поменявшийся, пока страница была скрыта, догоняется
 *      к первому же кадру после возвращения.
 *
 * И вторая вкладка — **Телеграм: свернули и развернули** (docs/scene-revive.md, раздел 9).
 * Жалоба с телефона: после разворачивания нижняя панель карты вверху, ниже пустота. Здесь
 * SDK Телеграма заменён макетом (настоящий заблокирован: стенд не зависит от сети), и
 * макет держит устоявшуюся высоту ровно так, как SDK (telegram-web-app.js,
 * `setViewportHeight`): она меняется только с `is_state_stable`. Клиент «сворачивает»
 * аппку — полоска как устоявшаяся высота, окно сжимается — и «разворачивает» — окно
 * вернулось, но приходят только промежуточные высоты. На каждом экране — предыстория,
 * город, окно постройки, держава, карта, промысел — приложение обязано снова встать во всё
 * окно, нижняя панель — внизу, холст — размером окна. Там же: поток выпечки карты,
 * «потерянный» посреди работ (дыр после паузы быть не должно), предыстория и промысел с
 * невернувшимся контекстом и холст ролика о бое.
 *
 * Что из второй вкладки НЕ проверено: настоящий клиент Телеграма. Что именно шлёт Android
 * при сворачивании, не измерено; макет устраивает худшую из последовательностей, которые
 * дают картину жалобы, остальные держит `src/viewport.test.ts`. Ролик о бое целиком не
 * открывается — для него нужна запись боя; проверяется его холст через ту же функцию, что у
 * ролика (`ui/battle/canvas.ts`).
 *
 * ЧЕГО НЕ ПРОВЕРЯЕТ. Третий случай устраивается подменой `document.visibilityState`
 * и рассылкой события: проверяется **наш обработчик**, а не то, как душит кадры
 * настоящий вебвью Телеграма. Настоящее сворачивание из headless Chrome не
 * устроить, и делать вид, что устроено, нельзя.
 *
 * Это не юнит-тест: правила лупа держит `render/loop.test.ts`, а приговор —
 * `scenelog.test.ts`. Здесь проверяется то, чего из правил не выведешь: живой
 * драйвер, живой three, живая пересборка. Поэтому стенд отвечает «да/нет» по
 * каждому случаю и возвращает ненулевой код, если хоть один сорвался.
 *
 * Кадры за окно и журнал с отметками секунд стоят в выводе в `‹…›` (`lib/measured.ts`): они
 * плавают от прогона к прогону и при сверке не сравниваются. Приговор «да/НЕТ» по каждому
 * случаю, номера сцен и размеры холста — свойства кода и обязаны совпасть. Буфер — нет: у
 * достроенного города ступень опускает сторож плавности (`render/steady`, правило высокого уровня —
 * средний кадр не дольше 1000/48 мс, а потолок отчёта — 30 кадров), и в какую минуту стенда он
 * успеет — гонка. Как у второй вкладки, сравнивается правило (буфер — холст на плотность сцены,
 * плотность в [1, 2]), а число — в `‹…›`.
 *
 * Запуск: npm run revive:report
 * Переменные: PORT / CDP_PORT, CHROME=путь\к\chrome.exe, HEAD=1 (видимое окно).
 */
import { createServer as createVite } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { ENTER_GAME, launchChrome, reportPage, sleep, Tab } from './lib/chrome';
import { measure as live } from './lib/measured';
import { realSeconds } from '../src/game/pace';
import { RESTORE_WAIT } from '../src/render/Scene';
import { SETTLE } from '../src/viewport';
import { JOB_STALL_MS } from '../src/ui/map/tw/prebake';
import { STALL_MS, type Note, type Vitals } from '../src/scenelog';

const PORT = Number(process.env.PORT ?? 4193);
const DEBUG_PORT = Number(process.env.CDP_PORT ?? 9336);
const WIDTH = 390;
const HEIGHT = 844;
/**
 * Сколько ждать, пока сцена достроится, мс. Не порог проверки, а срок: город встаёт за секунды, и полминуты — это уже
 * «не достроилась», то есть находка, а не медленный прогон.
 */
const BUILD_WAIT = 30_000;
/** «Кадры идут» — больше стольких кадров, и ждать их не дольше `FLOWING_MS`: тоже срок, а не порог частоты (`flowing`). */
const FLOWING = 5;
const FLOWING_MS = 5000;

/**
 * Что подкладывается в страницу.
 *
 * Ничего своего про состояние сцены здесь нет: показания спрашиваются у самой
 * сцены (`vitals`), журнал — у самого журнала. Стенд только устраивает
 * происшествия и смотрит, что сцена о них сказала.
 */
const PROBE = `
(() => {
  const scene = () => window.__scene;
  if (!scene() || !window.__scenelog) throw new Error('нет window.__scene — страница открыта без ?probe=1?');

  /** Метка сцены: пересборка даёт новый объект, а значит и новый номер. */
  let tags = 0;
  const tagOf = () => {
    const s = scene();
    if (!s.__tag) s.__tag = ++tags;
    return s.__tag;
  };

  /**
   * Расширение потери контекста, взятое **заранее**.
   *
   * У потерянного контекста getExtension отдаёт null — то есть после потери
   * вернуть его через расширение уже нечем, если объект не сохранён. Это не
   * особенность стенда: так же приходится делать и в игре, и потому в сцене
   * возвращением занимается three, у которого расширения закэшированы.
   */
  let saved = null;
  let savedFor = null;
  const ext = () => {
    const s = scene();
    if (savedFor !== s) {
      savedFor = s;
      saved = s.renderer.getContext().getExtension('WEBGL_lose_context');
    }
    if (!saved) throw new Error('нет WEBGL_lose_context — браузер поднят без настоящего WebGL');
    return saved;
  };

  /** Длинные задачи страницы (дольше 50 мс): по ним видно, чем занята страница, когда кадров мало. */
  const longs = [];
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) longs.push({ at: e.startTime, ms: e.duration });
    }).observe({ entryTypes: ['longtask'] });
  } catch (e) {}

  window.__revive = {
    /**
     * Показания сцены плюс её номер (по номеру видно пересборку), плотность её буфера и сколько программ собрал three —
     * возвращённый контекст three поднимает с нуля (\`initGLContext\`), и программы собираются заново.
     */
    state: () => {
      const s = scene();
      return JSON.stringify({ ...s.vitals(), tag: tagOf(), dpr: window.devicePixelRatio, pr: s.renderer.getPixelRatio(), programs: s.renderer.info.programs?.length ?? 0 });
    },
    log: () => JSON.stringify(window.__scenelog.list()),
    lose: () => { ext().loseContext(); return JSON.stringify('ok'); },

    /**
     * Забыть сохранённое расширение. Оно держит **сцену**, которой принадлежало,
     * и без этого стенд считал бы собственную ссылку за утечку игры: после
     * пересборки живых диорам выходило две, и вторая была наша.
     */
    forget: () => { saved = null; savedFor = null; return JSON.stringify('ok'); },
    /** Ответ — минута страницы, когда вернули: от неё \`longest\` ищет, чем страница была занята после. */
    restore: () => { ext().restoreContext(); return JSON.stringify(performance.now()); },

    /**
     * Обезвредить расширение у нынешней сцены. Так ведёт себя настоящая потеря:
     * контекст забрала система, и \`restoreContext\` вернуть его не может —
     * возвращает его только сам браузер, когда сможет, или никогда.
     */
    deaf: () => {
      scene().renderer.forceContextRestore = () => { throw new Error('система забрала контекст'); };
      return JSON.stringify('ok');
    },

    /**
     * Скрыть или показать страницу. Подменой свойства, а не по-настоящему:
     * настоящее сворачивание из headless Chrome не устроить. Проверяется поэтому
     * наш обработчик, и стенд об этом говорит прямо.
     */
    hide: (on) => {
      Object.defineProperty(document, 'visibilityState', { get: () => (on ? 'hidden' : 'visible'), configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      return JSON.stringify(performance.now());
    },

    /** Самая долгая задача страницы, кончившаяся после минуты страницы from, мс; 0 — таких не было. */
    longest: (from) => JSON.stringify(Math.round(longs.filter((x) => x.at + x.ms >= from).reduce((m, x) => Math.max(m, x.ms), 0))),

    /**
     * Дождаться, пока сцена достроится: город встал и полные слои пришли (ready сцены), и полсекунды идущих кадров
     * программ не прибавлялось — всё, что легло докачкой после первого кадра города, уже собрано. Ответ — сколько
     * ждали, мс, или -1: не достроилась за ms.
     */
    settle: async (ms) => {
      const s = scene();
      const t0 = performance.now();
      const nap = (t) => new Promise((ok) => setTimeout(ok, t));
      const ready = await Promise.race([s.ready.then(() => true, () => false), nap(ms).then(() => false)]);
      if (!ready) return JSON.stringify(-1);
      let was = -1;
      let frames = s.vitals().frames;
      while (performance.now() - t0 < ms) {
        const n = s.renderer.info.programs.length;
        const f = s.vitals().frames;
        if (n === was && f > frames) return JSON.stringify(Math.round(performance.now() - t0));
        was = n;
        frames = f;
        await nap(500);
      }
      return JSON.stringify(-1);
    },

    /** Согнать холст в ноль и вернуть обратно — так он ведёт себя, возвращаясь из фона. */
    squash: (on) => {
      const wrap = document.querySelector('.canvas-wrap');
      wrap.style.display = on ? 'none' : '';
      scene().resize();
      return JSON.stringify('ok');
    },
  };
  return JSON.stringify('ok');
})()
`;

interface State extends Vitals {
  tag: number;
  dpr: number;
  /** Плотность буфера сцены (`renderer.getPixelRatio`): буфер — холст на неё. */
  pr: number;
  /** Сколько программ собрал three (`renderer.info.programs`). */
  programs: number;
}

const pad = (s: string, n: number): string => s + ' '.repeat(Math.max(0, n - [...s].length));
const yes = (ok: boolean): string => (ok ? 'да' : 'НЕТ');

interface Case {
  name: string;
  ok: boolean;
  said: string;
}

const cases: Case[] = [];
const check = (name: string, ok: boolean, said: string): void => {
  cases.push({ name, ok, said });
  console.log(`  ${pad(name, 46)} ${pad(yes(ok), 5)} ${said}`);
};

async function main(): Promise<void> {
  const vite = await createVite({
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    server: { port: PORT, strictPort: true, host: '127.0.0.1' },
    logLevel: 'warn',
  });
  await vite.listen();
  // Настоящий WebGL: без него терять нечего, а расширения потери и вовсе нет.
  const chrome = await launchChrome(DEBUG_PORT, ['--use-gl=angle', `--window-size=${WIDTH},${HEIGHT}`]);
  try {
    await report();
    await telegram();
  } finally {
    chrome.kill();
    await vite.close();
    await sleep(300);
  }
  const bad = cases.filter((c) => !c.ok);
  if (bad.length) {
    console.log(`\nСорвалось: ${bad.map((c) => c.name).join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('\nВсё, что можно устроить в браузере, диорама пережила сама.');
  }
}

async function report(): Promise<void> {
  const tab = await Tab.open(DEBUG_PORT, reportPage(PORT));
  await tab.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 2,
    mobile: true,
  });
  // Партия начинается заново: чужой посёлок из localStorage тут ни при чём.
  await tab.eval<string>('(() => { try { localStorage.clear(); } catch (e) {} return JSON.stringify("ok"); })()');
  await tab.send('Page.reload');

  for (let i = 0; ; i++) {
    await sleep(300);
    if (await tab.eval<boolean>('JSON.stringify(!!(window.__scene && window.__scenelog))')) break;
    if (i > 100) throw new Error('сцена не поднялась за 30 с — смотри вывод «в странице:» выше');
  }
  await tab.eval<string>(PROBE);
  await sleep(600);

  const state = (): Promise<State> => tab.eval<State>('window.__revive.state()');
  const go = (what: string): Promise<string> => tab.eval<string>(`window.__revive.${what}`);

  /** Сколько кадров за окно: два замера с паузой — единственный честный ответ на «кадров нет». */
  const drawing = async (ms: number): Promise<number> => {
    const before = await state();
    await sleep(ms);
    const after = await state();
    return after.frames - before.frames;
  };

  /**
   * Пошли ли кадры: ждём больше `FLOWING` кадров, но не дольше `FLOWING_MS`. Спрашивается свойство «идут», а не частота:
   * на машине без видеокарты (приёмка на сервере, программный WebGL — docs/handbook/acceptance.md, «Ночная приёмка на
   * сервере (УС-2)») город рисует несколько кадров в секунду, и окно в 400 мс там давало два кадра при живой сцене
   * (27.10.2026). Мёртвая сцена не даст их и за пять секунд; сколько ждали — замер.
   */
  const flowing = async (): Promise<{ n: number; ms: number }> => {
    const before = await state();
    const t0 = performance.now();
    let n = 0;
    while (n <= FLOWING && performance.now() - t0 < FLOWING_MS) {
      await sleep(100);
      n = (await state()).frames - before.frames;
    }
    return { n, ms: Math.round(performance.now() - t0) };
  };

  const first = await state();
  console.log(`\nБраузер: настоящий WebGL, экран ${WIDTH}×${HEIGHT} @2, кадров на старте ${live(first.frames)}`);
  console.log(`Срок ожидания контекста — ${RESTORE_WAIT} мс, порог остановки — ${STALL_MS} мс.\n`);

  /**
   * Дождаться, пока сцена достроится (`__revive.settle`), и сказать это проверкой: не достроилась за `BUILD_WAIT` —
   * находка, а не медленный прогон.
   */
  const settled = async (name: string): Promise<void> => {
    const built = await tab.eval<number>(`window.__revive.settle(${BUILD_WAIT})`);
    check(
      name,
      built >= 0,
      built >= 0 ? `город встал, программ не прибавлялось — ждали ${live((built / 1000).toFixed(1))} с` : `не достроилась за ${BUILD_WAIT / 1000} с`,
    );
  };

  // ---------- 1. Потеря и возврат ----------
  console.log('1. Потеря контекста и возвращение');
  // Контекст теряет город, а не дымка: первые секунды на месте города стоит она, город приходит из потока мира, суета,
  // стража, отклик и погода — докачкой после его первого кадра, полные слои — следом (docs/scene-revive.md, раздел 10).
  // На пустой сцене возврату нечего было бы собирать заново.
  await settled('город достроен к потере');
  const whole = await state();
  await go('lose()');
  await sleep(300);
  const lost = await state();
  const lostFrames = await drawing(300);
  check('контекст потерян и сцена это видит', lost.lost, `приборы: lost=${lost.lost}, луп: ${lost.blocks.join(',') || 'идёт'}`);
  check('кадры в мёртвый контекст не рисуются', lostFrames === 0, `кадров за 300 мс: ${live(lostFrames)}`);

  const restoredAt = await tab.eval<number>('window.__revive.restore()');
  await sleep(700);
  const back = await state();
  const backFrames = await flowing();
  const rebusy = await tab.eval<number>(`window.__revive.longest(${restoredAt})`);
  check('контекст вернулся', !back.lost, `lost=${back.lost}`);
  // Возвращённый контекст three поднимает с нуля, и первый кадр после возврата собирает все программы и заливает все
  // слои — одна длинная задача. Строка называет её и программы до потери и после: так видно, что возвращался город.
  // Числа программ расходятся в обе стороны: до потери у живых материалов лежат и прежние варианты (three отпускает их
  // только с уборкой материала), после — только нужные кадру да варианты глубины первого теневого прохода, собранные на
  // свежем состоянии света (docs/scene-revive.md, раздел 10.5).
  check(
    'кадры пошли снова',
    backFrames.n > FLOWING,
    `кадров: ${live(backFrames.n)} за ${live(backFrames.ms)} мс, программ у города до потери ${live(whole.programs)}, после возврата ${live(back.programs)}, самая долгая задача страницы после возврата — ${live(rebusy)} мс`,
  );
  check('диорама та же, пересборки не потребовалось', back.tag === first.tag, `сцена №${back.tag}`);
  // Плотность буфера у достроенного города может опустить сторож плавности (см. шапку файла) — сравнивается правило:
  // холст тот же, буфер — холст на плотность сцены. Сброшенный или нулевой буфер правилу не отвечает.
  check(
    'буфер на месте',
    back.css.w === whole.css.w &&
      back.css.h === whole.css.h &&
      back.buffer.w === Math.floor(back.css.w * back.pr) &&
      back.buffer.h === Math.floor(back.css.h * back.pr) &&
      back.pr >= 1 &&
      back.pr <= 2,
    `холст ${back.css.w}×${back.css.h}, буфер ${live(`${back.buffer.w}×${back.buffer.h}`)} — холст ×${live(back.pr.toFixed(2))}`,
  );

  // ---------- 2. Потеря, которую не отменить ----------
  console.log('\n2. Потеря без возврата — так ведёт себя настоящая');
  await go('deaf()');
  await go('lose()');
  // Срок ожидания плюс сборка новой сцены.
  await sleep(RESTORE_WAIT + 2500);
  const rebuilt = await state();
  check('сцена пересобрана заново', rebuilt.tag !== back.tag, `была №${back.tag}, стала №${rebuilt.tag}`);
  // Кадры меряются у пересобранного города, а не у дымки новой сцены: город приходит заново тем же путём, что на старте.
  await settled('новый город достроен');
  const fresh = await state();
  const rebuiltFrames = await flowing();
  check('у новой сцены живой контекст', !fresh.lost, `lost=${fresh.lost}`);
  check('кадры идут', rebuiltFrames.n > FLOWING, `кадров: ${live(rebuiltFrames.n)} за ${live(rebuiltFrames.ms)} мс`);
  // Свою ссылку стенд роняет до подсчёта: считаем утечки игры, а не свои.
  await go('forget()');
  const alive = await tab.alive('window.__scene');
  check('живая диорама ровно одна', alive === 1, `живых сцен: ${alive}`);

  // ---------- 3. Скрытая страница ----------
  console.log('\n3. Скрытая страница (подменой visibilityState — см. шапку файла)');
  // Мерится возврат, а не стройка. Сцену №2 раздел 2 уже дождался, и ожидание здесь — сторож, а не срок: прежде раздел
  // шёл на недостроенной, пришедшее, пока страница скрыта, собиралось первым кадром после возврата, и раздел мерил первый
  // кадр нового города — с 08.10.2026 (докачки «живого города») кадров после возврата стало меньше, 17.10 — три
  // (docs/scene-revive.md, раздел 10).
  await settled('сцена достроена к проверке');
  await go('hide(true)');
  await sleep(200);
  const hidden = await state();
  const hiddenFrames = await drawing(500);
  check('кадров в скрытой странице нет', hiddenFrames === 0, `кадров за 500 мс: ${live(hiddenFrames)}`);
  check('причина названа', hidden.blocks.includes('hidden'), `луп: ${hidden.blocks.join(',') || 'идёт'}`);

  const backAt = await tab.eval<number>('window.__revive.hide(false)');
  await sleep(300);
  const shown = await flowing();
  const busy = await tab.eval<number>(`window.__revive.longest(${backAt})`);
  check(
    'при возвращении кадры идут снова',
    shown.n > FLOWING,
    `кадров: ${live(shown.n)} за ${live(shown.ms)} мс, самая долгая задача страницы после возврата — ${live(busy)} мс`,
  );

  // ---------- 4. Размер, поменявшийся в фоне ----------
  console.log('\n4. Холст поменялся, пока страница была скрыта');
  await go('hide(true)');
  await tab.send('Emulation.setDeviceMetricsOverride', {
    width: 360,
    height: 760,
    deviceScaleFactor: 3,
    mobile: true,
  });
  await sleep(300);
  await go('hide(false)');
  await sleep(600);
  const sized = await state();
  const ratio = sized.buffer.w / sized.css.w;
  check(
    'холст стал тем, каким его сделали в фоне',
    sized.css.w === 360 && sized.css.h === 760,
    `холст ${sized.css.w}×${sized.css.h} (экран стал 360×760 @3)`,
  );
  // Своего правила о плотности у стенда нет: сцена зажимает её в [1, 2]
  // (`Scene.dpr`), и повторять здесь это число значило бы завести вторую правду.
  check(
    'буфер пересчитан под новый холст',
    sized.buffer.w !== back.buffer.w && ratio >= 1 && ratio <= 2,
    // Ступень (а с ней плотность) опускает сторож плавности по цене кадра — число плавает, см. шапку файла.
    `буфер ${live(`${sized.buffer.w}×${sized.buffer.h}`)} — это холст ×${live(ratio.toFixed(2))} при экранных ×${sized.dpr}`,
  );

  // ---------- 5. Нулевой холст ----------
  console.log('\n5. Нулевой холст: пропуск замечен, а не проглочен');
  await go('squash(true)');
  await sleep(200);
  const zeroed = await tab.eval<Note[]>('window.__revive.log()');
  check(
    'пропуск записан в журнал',
    zeroed.some((n) => n.kind === 'zero'),
    'ищем запись «zero» — раньше пересчёт молча выходил и второй попытки не было',
  );
  await go('squash(false)');
  await sleep(600);
  const restored = await state();
  check(
    'размер вернулся',
    restored.css.w > 1 && restored.buffer.w > 1,
    `холст ${restored.css.w}×${restored.css.h}, буфер ${live(`${restored.buffer.w}×${restored.buffer.h}`)}`,
  );

  // ---------- 6. Часы племени в спавшей странице ----------
  // Время племени обязано быть функцией часов, а не счётом срабатываний таймера: страница, у
  // которой браузер остановил таймеры (свёрнутое вебвью, вкладка в фоне), проснувшись, догоняет
  // прошедшее теми же правилами, что при входе в игру (`sim/tick.liveStep`, docs/time.md).
  console.log('');
  console.log('6. Часы племени: страница спала, не закрываясь');
  const clock = (): Promise<{ game: number; wall: number }> =>
    tab.eval<{ game: number; wall: number }>('JSON.stringify({ game: window.__game.getState().s.time, wall: Date.now() })');
  const c0 = await clock();
  await sleep(2000);
  const c1 = await clock();
  // Прожитое племенем переводится в настоящие секунды дверью времени (`game/pace`): вровень с часами —
  // это одна настоящая секунда прожитого на настоящую секунду часов при любой шкале. Прежде стенд
  // сравнивал игровые секунды с настоящими как есть и после поворота шкалы упал — на здоровой игре.
  const awake = realSeconds(c1.game - c0.game) / ((c1.wall - c0.wall) / 1000);
  check('наяву время племени идёт вровень с часами', Math.abs(awake - 1) < 0.35, `прожито настоящих секунд на настоящую секунду часов: ${live(awake.toFixed(2))}`);
  // Страница уходит в фон по-настоящему: вперёд выходит другая вкладка, и браузер придерживает
  // таймеры скрытой страницы (в Chrome — не чаще раза в секунду при шаге стора в полсекунды).
  const front = await Tab.open(DEBUG_PORT, 'about:blank');
  await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/activate/${front.target}`);
  await sleep(1500);
  const behind = await tab.eval<boolean>('JSON.stringify(document.hidden)');
  const h0 = await clock();
  await sleep(10_000);
  const h1 = await clock();
  await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/activate/${tab.target}`);
  const wall = (h1.wall - h0.wall) / 1000;
  const game = realSeconds(h1.game - h0.game);
  check('страница в фоне (иначе замер ниже ни о чём)', behind, `document.hidden = ${behind}`);
  check(
    'в фоне время племени не отстаёт от часов',
    wall - game < 2.5,
    `в фоне прошло настоящих ${live(wall.toFixed(1))} с, племя прожило (настоящими) ${live(game.toFixed(1))} с, отстало на ${live((wall - game).toFixed(1))} с`,
  );

  // ---------- Журнал ----------
  console.log('\nЖурнал, как его прочтёт владелец с телефона:');
  const notes = await tab.eval<Note[]>('window.__revive.log()');
  const t0 = notes[0]?.at ?? 0;
  for (const n of notes) {
    // Журнал — живая лента: сколько в нём записей и в какую секунду, решает гонка событий
    // (строка «tg вьюпорт» то приходит, то нет). Сравнивается приговор по случаям выше.
    console.log(`  ${live(`+${((n.at - t0) / 1000).toFixed(1)}s ${pad(n.kind, 9)} ${n.note ?? ''}`)}`);
  }

  // Страница закрывается до второй вкладки, а не только сокет (`Tab.close`): игра на том же адресе в двух вкладках делит
  // одно localStorage, и живая первая подновляла бы отметку ведущей вкладки (`net/sync.startBeat`, раз в 3 с). Вторая,
  // очистив хранилище, застала бы её — и встала с окном «Игра открыта дважды» (`syncBoot`); под окном у подсказок нет
  // ссылок (`next/TipLayer`, `modalUp`), и раздел 11 не находил «Промыслы» (docs/scene-revive.md, раздел 10.6).
  await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${tab.target}`);
  tab.close();
}

// ---------- Телеграм: свернули и развернули ----------

/** Высота полоски свёрнутой аппки — столько клиент называет устоявшейся высотой. */
const BAR = 64;

/**
 * Макет SDK Телеграма. Ставится до скриптов страницы; настоящий SDK заблокирован. Правило высоты —
 * как у SDK (telegram-web-app.js, `setViewportHeight`): `viewportStableHeight` меняется только с
 * `is_state_stable`, до первого события обе высоты — окно. Пользователя нет: синхронизации с
 * сервером в стенде нет и не нужно.
 */
const TG_MOCK = `
(() => {
  const handlers = {};
  let height = false, stable = false, expanded = true;
  const posted = [];
  const fire = (name, arg) => (handlers[name] || []).slice().forEach((cb) => cb.call(app, arg));
  const app = {
    platform: 'android', version: '8.0', initData: '', initDataUnsafe: {}, colorScheme: 'dark', themeParams: {},
    get viewportHeight() { return height === false ? window.innerHeight : height; },
    get viewportStableHeight() { return stable === false ? window.innerHeight : stable; },
    get isExpanded() { return expanded; },
    ready() {}, expand() { posted.push('web_app_expand'); }, disableVerticalSwipes() {},
    setHeaderColor() {}, setBackgroundColor() {}, isVersionAtLeast() { return true; },
    onEvent(n, cb) { (handlers[n] = handlers[n] || []).push(cb); },
    offEvent(n, cb) { handlers[n] = (handlers[n] || []).filter((x) => x !== cb); },
  };
  const receive = (type, data) => {
    if (type === 'viewport_changed' && data.height) {
      expanded = !!data.is_expanded;
      height = data.height;
      if (data.is_state_stable) stable = data.height;
      fire('viewportChanged', { isStateStable: !!data.is_state_stable });
    }
    if (type === 'visibility_changed') fire(data.is_visible ? 'activated' : 'deactivated');
  };
  window.Telegram = { WebApp: app, WebView: { postEvent: (t) => posted.push(t), receiveEvent: receive } };
  window.__tg = { receive: (t, d) => { receive(t, d); return JSON.stringify('ok'); }, posted: () => JSON.stringify(posted) };
})();
`;

interface Size2 {
  w: number;
  h: number;
}

interface Layout {
  win: Size2;
  app: number;
  /** Низ нижней панели; null — панели на экране нет. */
  nav: number | null;
  /** Холст экрана: размер в разметке и буфер; null — холста нет. */
  canvas: { css: Size2; buffer: Size2 } | null;
}

/** Раскладка экрана: окно, приложение, нижняя панель и холст по селектору. */
const layoutOf = (canvas: string, nav: string): string => `JSON.stringify((() => {
  const app = document.querySelector('.app');
  const n = document.querySelector(${JSON.stringify(nav)});
  const c = document.querySelector(${JSON.stringify(canvas)});
  return {
    win: { w: window.innerWidth, h: window.innerHeight },
    app: app ? Math.round(app.getBoundingClientRect().height) : 0,
    nav: n ? Math.round(n.getBoundingClientRect().bottom) : null,
    canvas: c ? { css: { w: c.clientWidth, h: c.clientHeight }, buffer: { w: c.width, h: c.height } } : null,
  };
})())`;

async function waitFor(tab: Tab, expr: string, ms: number): Promise<boolean> {
  for (let t = 0; t < ms; t += 250) {
    if (await tab.eval<boolean>(`JSON.stringify(!!(${expr}))`).catch(() => false)) return true;
    await sleep(250);
  }
  return false;
}

const click = (selector: string): string =>
  `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return JSON.stringify('нет ' + ${JSON.stringify(selector)}); e.click(); return JSON.stringify('ok'); })()`;

/** Нажать кнопку по тексту (у кнопок нижней панели текст — подпись под значком, она в конце). */
const press = (text: string): string =>
  `(() => { const e = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().endsWith(${JSON.stringify(text)}) && !b.disabled); if (!e) return JSON.stringify('нет кнопки ' + ${JSON.stringify(text)}); e.click(); return JSON.stringify('ok'); })()`;

/**
 * Перезагрузить страницу с чистой партией и дождаться **нового** документа: без метки проверка
 * «кнопка на месте» успевала увидеть её ещё на старом, до перезагрузки.
 */
async function reloadClean(tab: Tab): Promise<void> {
  await tab.eval<string>('(() => { try { localStorage.clear(); } catch (e) {} window.__old = 1; return JSON.stringify("ok"); })()');
  await tab.send('Page.reload');
  if (!(await waitFor(tab, '!window.__old && document.readyState === "complete"', 60_000))) throw new Error('страница не перезагрузилась за 60 с');
}

const metrics = (height: number): Record<string, unknown> => ({ width: WIDTH, height, deviceScaleFactor: 2, mobile: true });

/**
 * Свернуть и развернуть так, как это даёт картину жалобы: клиент говорит «не видно», называет
 * полоску устоявшейся высотой, окно сжимается; потом окно возвращается, клиент говорит «видно»
 * и шлёт только промежуточные высоты разворачивания — устоявшейся не приходит.
 */
async function fold(tab: Tab): Promise<void> {
  await tab.eval<string>(`window.__tg.receive('visibility_changed', { is_visible: false })`);
  await tab.eval<string>(`window.__tg.receive('viewport_changed', { height: ${BAR}, is_state_stable: true, is_expanded: false })`);
  await tab.send('Emulation.setDeviceMetricsOverride', metrics(BAR));
  await sleep(500);
  await tab.send('Emulation.setDeviceMetricsOverride', metrics(HEIGHT));
  await tab.eval<string>(`window.__tg.receive('visibility_changed', { is_visible: true })`);
  for (const h of [Math.round(HEIGHT * 0.4), Math.round(HEIGHT * 0.8), HEIGHT]) {
    await tab.eval<string>(`window.__tg.receive('viewport_changed', { height: ${h}, is_state_stable: false, is_expanded: true })`);
    await sleep(40);
  }
  // Попытки двери окна идут полторы секунды; запас — на ResizeObserver и кадр.
  await sleep(SETTLE[SETTLE.length - 1] + 700);
}

/** Раскладка экрана после «свернули — развернули»: приложение во всё окно, панель внизу, холст — окно. */
function checkLayout(name: string, l: Layout, opts: { nav: boolean; canvas: boolean }): void {
  check(`${name}: приложение во всё окно`, l.app === l.win.h, `приложение ${l.app} из ${l.win.h} px (полоска — ${BAR})`);
  if (opts.nav) {
    check(`${name}: нижняя панель внизу`, l.nav !== null && l.nav > l.win.h * 0.85, l.nav === null ? 'панели нет' : `низ панели на ${l.nav} px из ${l.win.h}`);
  }
  if (opts.canvas) {
    const c = l.canvas;
    const ratio = c && c.css.w > 0 ? c.buffer.w / c.css.w : 0;
    const even = c !== null && c.css.h > 0 && Math.abs(c.buffer.h / c.css.h - ratio) < 0.02;
    check(
      `${name}: холст — окно, буфер под холст`,
      c !== null && c.css.w === l.win.w && c.css.h === l.win.h && ratio >= 1 && ratio <= 2 && even,
      // Буфер — по ступени качества, а ступень у города и промысла подстраивается под цену кадра (`Steady`):
      // число плавает, сравнивается правило (буфер — холст на плотность в [1, 2]).
      c ? `холст ${c.css.w}×${c.css.h}, буфер ${live(`${c.buffer.w}×${c.buffer.h}`)}` : 'холста нет',
    );
  }
}

/** Обезвредить возврат у рендерера и потерять контекст — так ведёт себя настоящая потеря. */
const loseFor = (renderer: string): string => `(() => {
  const r = ${renderer};
  const ext = r.getContext().getExtension('WEBGL_lose_context');
  if (!ext) return JSON.stringify('нет WEBGL_lose_context');
  r.forceContextRestore = () => { throw new Error('система забрала контекст'); };
  ext.loseContext();
  return JSON.stringify('контекст потерян без возврата');
})()`;

/** Сцена пересобрана (метки на прежней нет) и её контекст жив. */
const rebuiltOf = (who: string): string =>
  `JSON.stringify({ fresh: !!${who} && ${who}.__tag !== 1, lost: !!${who} && ${who}.gl.getContext().isContextLost() })`;

async function telegram(): Promise<void> {
  console.log('\n\nТелеграм: свернули и развернули (макет SDK — см. шапку файла)');
  const tab = await Tab.open(DEBUG_PORT, 'about:blank');
  try {
    await tab.send('Network.enable');
    // Настоящий SDK не грузится: стенд не зависит от сети, а макет не перезаписывается.
    await tab.send('Network.setBlockedURLs', { urls: ['*telegram.org*'] });
    await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: TG_MOCK });
    await tab.send('Emulation.setDeviceMetricsOverride', metrics(HEIGHT));
    await tab.send('Page.navigate', { url: reportPage(PORT) });
    if (!(await waitFor(tab, 'window.__game && window.__tg', 60_000))) throw new Error('игра под макетом Телеграма не поднялась за 60 с');
    await reloadClean(tab);
    if (!(await waitFor(tab, 'window.__game && window.__tg && document.querySelector(".start-alt")', 60_000))) {
      throw new Error('стартовый экран под макетом не поднялся за 60 с');
    }

    // ---------- 7. Предыстория ----------
    console.log('\n7. Предыстория');
    console.log(`  ${await tab.eval<string>(click('.start-alt'))} — «предыстория»`);
    if (await waitFor(tab, 'window.__pro && document.querySelector(".pro canvas")', 30_000)) {
      await sleep(1500);
      await fold(tab);
      checkLayout('предыстория', await tab.eval<Layout>(layoutOf('.pro canvas', '.nx-nav')), { nav: false, canvas: true });
      await tab.eval<number>('JSON.stringify(window.__pro.__tag = 1)');
      console.log(`  ${await tab.eval<string>(loseFor('window.__pro.gl'))}`);
      await sleep(RESTORE_WAIT + 2500);
      const re = await tab.eval<{ fresh: boolean; lost: boolean }>(rebuiltOf('window.__pro'));
      check('предыстория: собрана заново на живом контексте', re.fresh && !re.lost, `новая сцена: ${re.fresh ? 'да' : 'нет'}, контекст потерян: ${re.lost ? 'да' : 'нет'}`);
    } else check('предыстория: поднялась', false, 'нет window.__pro за 30 с');

    // Из предыстории — в игру: страница перезагружается, партия начинается с нуля.
    await reloadClean(tab);
    if (!(await waitFor(tab, 'window.__scene && window.__game && window.__tg && document.querySelector(".start-go")', 60_000))) {
      throw new Error('город под макетом не поднялся за 60 с');
    }
    console.log(`  ${await tab.eval<string>(ENTER_GAME)}`);
    // Обучение и вести сняты: их окна легли бы поверх экранов, которые здесь проверяются.
    await tab.eval<string>(`(() => {
      const g = window.__game.getState();
      const s = g.s;
      s.tutorialDone = true;
      s.inbox = [];
      s.winterWarning = false;
      s.nextEventAt = s.time + 1e9;
      window.__game.setState({ s: { ...s } });
      return JSON.stringify('ok');
    })()`);
    await sleep(1500);

    // ---------- 8. Город, окно постройки, держава ----------
    console.log('\n8. Город, окно постройки, держава');
    await fold(tab);
    checkLayout('город', await tab.eval<Layout>(layoutOf('.canvas-wrap canvas', '.nx-nav')), { nav: true, canvas: true });
    const posted = await tab.eval<string[]>('window.__tg.posted()');
    check(
      'после разворачивания клиента попросили о вьюпорте',
      posted.includes('web_app_request_viewport'),
      `отправлено клиенту: ${[...new Set(posted)].join(', ') || 'ничего'}`,
    );
    await tab.eval<string>(`(() => { const g = window.__game.getState(); const b = g.s.buildings.find((x) => x.type === 'hunter_hut'); g.openBuilding(b.id); return JSON.stringify('ok'); })()`);
    await sleep(800);
    await fold(tab);
    checkLayout('окно постройки', await tab.eval<Layout>(layoutOf('.canvas-wrap canvas', '.nx-nav')), { nav: true, canvas: true });
    const win = await tab.eval<number>('JSON.stringify(window.innerHeight)');
    const sheet = await tab.eval<{ top: number; bottom: number } | null>(
      `JSON.stringify((() => { const e = document.querySelector('.sheet.open'); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) }; })())`,
    );
    check(
      'окно постройки: стоит в окне, а не в полоске',
      sheet !== null && sheet.bottom <= win && sheet.bottom > win * 0.5,
      sheet ? `шторка ${sheet.top}…${sheet.bottom} px из ${win}` : 'шторки нет',
    );
    await tab.eval<string>(`(() => { window.__game.getState().closeSheet(); return JSON.stringify('ok'); })()`);
    await sleep(500);
    console.log(`  ${await tab.eval<string>(press('Вести'))} — «Вести» (меню державы)`);
    await sleep(800);
    await fold(tab);
    checkLayout('держава', await tab.eval<Layout>(layoutOf('.canvas-wrap canvas', '.nx-nav')), { nav: true, canvas: false });
    const realm = await tab.eval<{ bottom: number } | null>(
      `JSON.stringify((() => { const e = document.querySelector('.realm'); if (!e) return null; return { bottom: Math.round(e.getBoundingClientRect().bottom) }; })())`,
    );
    check('держава: меню до низа, а не до полоски', realm !== null && realm.bottom > win * 0.5, realm ? `низ меню на ${realm.bottom} px из ${win}` : 'меню нет');
    console.log(`  ${await tab.eval<string>(press('Вести'))} — закрыть`);
    await sleep(500);

    // ---------- 9. Карта ----------
    console.log('\n9. Карта по регионам — экран из жалобы');
    await tab.eval<string>(`(() => { window.__game.getState().openMap(); return JSON.stringify('ok'); })()`);
    // Поток «теряется», как только поднялся: его работы в полёте остаются без ответа.
    let jammed = false;
    for (let t = 0; t < 20_000 && !jammed; t += 50) {
      jammed = await tab.eval<boolean>('JSON.stringify(!!(window.__twPrebakeJam && window.__twPrebakeJam()))').catch(() => false);
      if (!jammed) await sleep(50);
    }
    check('карта: поток выпечки поднят и «потерян» посреди работ', jammed, jammed ? 'ответы потока больше не доходят' : 'потока нет — проверять нечего');
    await sleep(1000);
    await fold(tab);
    checkLayout('карта', await tab.eval<Layout>(layoutOf('.worldmap canvas', '.nx-mapnav')), { nav: true, canvas: true });
    // Тоже «идут», а не частота (`flowing`): больше трёх кадров карты, ждём не дольше `FLOWING_MS`. `__mapPerf` отдаёт
    // журнал и обнуляет его — кадры складываются.
    await tab.eval<number>('JSON.stringify(window.__mapPerf().length)');
    const mapFrom = performance.now();
    let mapFrames = 0;
    while (mapFrames <= 3 && performance.now() - mapFrom < FLOWING_MS) {
      await sleep(100);
      mapFrames += await tab.eval<number>('JSON.stringify(window.__mapPerf().length)');
    }
    check('карта: кадры идут', mapFrames > 3, `кадров карты: ${live(mapFrames)} за ${live(Math.round(performance.now() - mapFrom))} мс`);
    // Без срока молчания поток держал бы свои места до перезапуска, и регион не допёкся бы никогда.
    interface Bake {
      plan: { chunks: number } | null;
      have: { chunk: number };
    }
    const baked = (b: Bake): boolean => b.plan !== null && b.have.chunk === b.plan.chunks;
    let bake = await tab.eval<Bake>('JSON.stringify(window.__twPrebake())');
    for (let t = 0; t < JOB_STALL_MS + 20_000 && !baked(bake); t += 500) {
      await sleep(500);
      bake = await tab.eval<Bake>('JSON.stringify(window.__twPrebake())');
    }
    check(
      'карта: после паузы регион испечён целиком, без дыр',
      baked(bake),
      // Регион — по городу игрока, а мир новой партии — со своим сидом: число кусков плавает от прогона к прогону.
      `кусков испечено ${live(`${bake.have.chunk} из ${bake.plan?.chunks ?? '?'}`)} — молчащий поток заводится заново через ${JOB_STALL_MS / 1000} с`,
    );
    await tab.eval<string>(`(() => { window.__game.getState().closeMap(); return JSON.stringify('ok'); })()`);
    await sleep(800);

    // ---------- 10. Холст ролика о бое ----------
    console.log('\n10. Холст ролика о бое (свой — когда одолжить не у кого)');
    const made = await tab.eval<{ before: Size2; css: Size2; buffer: Size2; fits: number }>(`(async () => {
      const m = await import('/src/ui/battle/canvas.ts');
      const wrap = document.createElement('div');
      wrap.className = 'canvas-wrap';
      const canvas = document.createElement('canvas');
      wrap.appendChild(canvas);
      document.querySelector('.app').appendChild(wrap);
      const R = window.__scene.renderer.constructor;
      const r = new R({ canvas });
      const before = { w: canvas.width, h: canvas.height };
      window.__replay = { r, wrap, fits: 0, dead: 0 };
      window.__replay.off = m.holdReplayCanvas(r, null, () => window.__replay.fits++, () => window.__replay.dead++);
      return JSON.stringify({ before, css: { w: canvas.clientWidth, h: canvas.clientHeight }, buffer: { w: canvas.width, h: canvas.height }, fits: window.__replay.fits });
    })()`);
    check(
      'ролик: свой холст получил буфер под себя',
      made.buffer.w === made.css.w * 2 && made.buffer.h === made.css.h * 2,
      `холст ${made.css.w}×${made.css.h}, буфер ${made.buffer.w}×${made.buffer.h} (без размера был бы ${made.before.w}×${made.before.h})`,
    );
    await fold(tab);
    const refit = await tab.eval<{ css: Size2; buffer: Size2; fits: number }>(
      `JSON.stringify((() => { const c = window.__replay.r.domElement; return { css: { w: c.clientWidth, h: c.clientHeight }, buffer: { w: c.width, h: c.height }, fits: window.__replay.fits }; })())`,
    );
    check(
      'ролик: после разворачивания аспект пересчитан, буфер — окно',
      refit.fits > made.fits && refit.css.h === HEIGHT && refit.buffer.h === HEIGHT * 2,
      `холст ${refit.css.w}×${refit.css.h}, буфер ${refit.buffer.w}×${refit.buffer.h}`,
    );
    console.log(`  ${await tab.eval<string>(loseFor('window.__replay.r'))}`);
    await sleep(RESTORE_WAIT + 1000);
    const dead = await tab.eval<number>('JSON.stringify(window.__replay.dead)');
    check('ролик: мёртвый контекст кончает ролик отчётом', dead === 1, `ролику сказано «кончай»: ${dead} раз`);
    await tab.eval<string>(`(() => { const p = window.__replay; p.off(); p.r.dispose(); p.wrap.remove(); window.__replay = undefined; return JSON.stringify('ok'); })()`);

    // ---------- 11. Промысел ----------
    console.log('\n11. Промысел «Ягоды»');
    console.log(`  ${await tab.eval<string>(click('button[aria-label="Энергия"]'))} — подсказка энергии`);
    await sleep(400);
    console.log(`  ${await tab.eval<string>(click('.nx-tip-go'))} — «Промыслы»`);
    await waitFor(tab, `document.querySelector('.nx-trade')`, 8000);
    console.log(`  ${await tab.eval<string>(press('В лес'))} — «В лес»`);
    if (await waitFor(tab, 'window.__mini && document.querySelector(".mg canvas")', 30_000)) {
      await sleep(1500);
      await fold(tab);
      checkLayout('промысел', await tab.eval<Layout>(layoutOf('.mg canvas', '.nx-nav')), { nav: false, canvas: true });
      await tab.eval<number>('JSON.stringify(window.__mini.__tag = 1)');
      console.log(`  до «Начать»: ${await tab.eval<string>(loseFor('window.__mini.gl'))}`);
      await sleep(RESTORE_WAIT + 2500);
      const re = await tab.eval<{ fresh: boolean; lost: boolean }>(rebuiltOf('window.__mini'));
      check('промысел: не начатый собран заново на живом контексте', re.fresh && !re.lost, `новая сцена: ${re.fresh ? 'да' : 'нет'}, контекст потерян: ${re.lost ? 'да' : 'нет'}`);
      console.log(`  ${await tab.eval<string>(press('Начать'))} — «Начать»`);
      await sleep(1000);
      console.log(`  посреди игры: ${await tab.eval<string>(loseFor('window.__mini.gl'))}`);
      await sleep(RESTORE_WAIT + 1500);
      const phase = await tab.eval<string>('JSON.stringify(window.__mini.snapshot().phase)');
      check('промысел: начатый кончен итогом по набранному', phase === 'done', `фаза: ${phase}`);
    } else check('промысел: поднялся', false, 'нет window.__mini за 30 с');
  } finally {
    tab.close();
  }
}

void main();
