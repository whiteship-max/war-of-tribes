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
 * ЧТО ПРОВЕРЯЕТСЯ:
 *   1) потеря и возврат — контекст теряется, кадры встают, контекст возвращается,
 *      кадры идут снова, и диорама при этом та же самая;
 *   2) потеря без возврата — расширение обезврежено (так ведёт себя настоящая
 *      потеря: вернуть её `restoreContext` не может), и сцена обязана пересобрать
 *      себя целиком, не требуя перезахода в игру;
 *   3) скрытая страница — кадров нет, при возвращении идут снова;
 *   4) чужой размер — холст, поменявшийся, пока страница была скрыта, догоняется
 *      к первому же кадру после возвращения.
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
 * случаю, номера сцен, размеры холста и буфера — свойства кода и обязаны совпасть.
 *
 * Запуск: npm run revive:report
 * Переменные: PORT / CDP_PORT, CHROME=путь\к\chrome.exe, HEAD=1 (видимое окно).
 */
import { createServer as createVite } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { launchChrome, sleep, Tab } from './lib/chrome';
import { measure as live } from './lib/measured';
import { RESTORE_WAIT } from '../src/render/Scene';
import { STALL_MS, type Note, type Vitals } from '../src/scenelog';

const PORT = Number(process.env.PORT ?? 4193);
const DEBUG_PORT = Number(process.env.CDP_PORT ?? 9336);
const WIDTH = 390;
const HEIGHT = 844;

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

  window.__revive = {
    /** Показания сцены плюс её номер: по номеру видно пересборку. */
    state: () => JSON.stringify({ ...scene().vitals(), tag: tagOf(), dpr: window.devicePixelRatio }),
    log: () => JSON.stringify(window.__scenelog.list()),
    lose: () => { ext().loseContext(); return JSON.stringify('ok'); },

    /**
     * Забыть сохранённое расширение. Оно держит **сцену**, которой принадлежало,
     * и без этого стенд считал бы собственную ссылку за утечку игры: после
     * пересборки живых диорам выходило две, и вторая была наша.
     */
    forget: () => { saved = null; savedFor = null; return JSON.stringify('ok'); },
    restore: () => { ext().restoreContext(); return JSON.stringify('ok'); },

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
      return JSON.stringify('ok');
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
  const tab = await Tab.open(DEBUG_PORT, `http://127.0.0.1:${PORT}/?probe=1`);
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

  /** Идут ли кадры: два замера с паузой — единственный честный ответ. */
  const drawing = async (ms = 400): Promise<number> => {
    const before = await state();
    await sleep(ms);
    const after = await state();
    return after.frames - before.frames;
  };

  const first = await state();
  console.log(`\nБраузер: настоящий WebGL, экран ${WIDTH}×${HEIGHT} @2, кадров на старте ${live(first.frames)}`);
  console.log(`Срок ожидания контекста — ${RESTORE_WAIT} мс, порог остановки — ${STALL_MS} мс.\n`);

  // ---------- 1. Потеря и возврат ----------
  console.log('1. Потеря контекста и возвращение');
  await go('lose()');
  await sleep(300);
  const lost = await state();
  const lostFrames = await drawing(300);
  check('контекст потерян и сцена это видит', lost.lost, `приборы: lost=${lost.lost}, луп: ${lost.blocks.join(',') || 'идёт'}`);
  check('кадры в мёртвый контекст не рисуются', lostFrames === 0, `кадров за 300 мс: ${live(lostFrames)}`);

  await go('restore()');
  await sleep(700);
  const back = await state();
  const backFrames = await drawing();
  check('контекст вернулся', !back.lost, `lost=${back.lost}`);
  check('кадры пошли снова', backFrames > 5, `кадров за 400 мс: ${live(backFrames)}`);
  check('диорама та же, пересборки не потребовалось', back.tag === first.tag, `сцена №${back.tag}`);
  check(
    'буфер на месте',
    back.buffer.w === first.buffer.w && back.buffer.h === first.buffer.h,
    `${back.buffer.w}×${back.buffer.h}`,
  );

  // ---------- 2. Потеря, которую не отменить ----------
  console.log('\n2. Потеря без возврата — так ведёт себя настоящая');
  await go('deaf()');
  await go('lose()');
  // Срок ожидания плюс сборка новой сцены.
  await sleep(RESTORE_WAIT + 2500);
  const rebuilt = await state();
  const rebuiltFrames = await drawing();
  check('сцена пересобрана заново', rebuilt.tag !== back.tag, `была №${back.tag}, стала №${rebuilt.tag}`);
  check('у новой сцены живой контекст', !rebuilt.lost, `lost=${rebuilt.lost}`);
  check('кадры идут', rebuiltFrames > 5, `кадров за 400 мс: ${live(rebuiltFrames)}`);
  // Свою ссылку стенд роняет до подсчёта: считаем утечки игры, а не свои.
  await go('forget()');
  const alive = await tab.alive('window.__scene');
  check('живая диорама ровно одна', alive === 1, `живых сцен: ${alive}`);

  // ---------- 3. Скрытая страница ----------
  console.log('\n3. Скрытая страница (подменой visibilityState — см. шапку файла)');
  await go('hide(true)');
  await sleep(200);
  const hidden = await state();
  const hiddenFrames = await drawing(500);
  check('кадров в скрытой странице нет', hiddenFrames === 0, `кадров за 500 мс: ${live(hiddenFrames)}`);
  check('причина названа', hidden.blocks.includes('hidden'), `луп: ${hidden.blocks.join(',') || 'идёт'}`);

  await go('hide(false)');
  await sleep(300);
  const shown = await drawing();
  check('при возвращении кадры идут снова', shown > 5, `кадров за 400 мс: ${live(shown)}`);

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
    `буфер ${sized.buffer.w}×${sized.buffer.h} — это холст ×${ratio.toFixed(2)} при экранных ×${sized.dpr}`,
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
    `холст ${restored.css.w}×${restored.css.h}, буфер ${restored.buffer.w}×${restored.buffer.h}`,
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
  const awake = (c1.game - c0.game) / ((c1.wall - c0.wall) / 1000);
  check('наяву время племени идёт вровень с часами', Math.abs(awake - 1) < 0.35, `игровых секунд на настоящую: ${live(awake.toFixed(2))}`);
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
  const game = h1.game - h0.game;
  check('страница в фоне (иначе замер ниже ни о чём)', behind, `document.hidden = ${behind}`);
  check(
    'в фоне время племени не отстаёт от часов',
    wall - game < 2.5,
    `в фоне прошло настоящих ${live(wall.toFixed(1))} с, игровых ${live(game.toFixed(1))} с, отстало на ${live((wall - game).toFixed(1))} с`,
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
}

void main();
