/**
 * Предыстория: что она стоит и проходится ли она пальцем.
 *
 * Отчёт отвечает на шесть вопросов, и все шесть — измерением, а не мнением:
 *
 *   кадр     сколько миллисекунд стоит кадр поляны на телефонном экране
 *            (375×812 @2) и на широком (1280×800 @1), сколько в нём вызовов
 *            отрисовки и треугольников — днём, ночью со стаей, в дождь и в снег;
 *   память   сколько занимает поляна и остаётся ли она после выхода;
 *   палец    проходится ли цепочка «дойти до топора → свалить дерево →
 *            положить дрова → подстрелить → пожарить» **настоящим касанием**, а
 *            не вызовом метода;
 *   волки    выходят ли они ночью, кружат ли на виду и отбиваются ли топором —
 *            тем же настоящим касанием;
 *   ремесло  снимается ли шкура, шьётся ли одежда, строгаются ли стрелы и
 *            ложатся ли брёвна в дом — тем же касанием; и чего ремесло стоит
 *            беготни и что даёт взамен — числом из тех же формул, что у игры;
 *   сцена    остаётся ли в игре ровно одна живая сцена — и возвращается ли
 *            диорама деревни после выхода из режима;
 *   род      выходит ли к достроенному дому женщина, не тупик ли отказ,
 *            засчитываются ли мясо, дрова, объятие и ночь дома, уходит ли
 *            камера под крышу и возвращается ли, принимается ли имя сына с
 *            поднятой клавиатурой и показывает ли родословная ровно то, что есть.
 *
 * ЗДЕСЬ НАСТОЯЩИЙ WEBGL, и это условие, а не подробность. `tap:report` мерит
 * поведение при подделанном контексте — ему хватает, кадра там нет вовсе. Здесь
 * весь вопрос как раз в кадре: сколько он стоит и рисуется ли он. Поэтому
 * Chrome поднимается с ANGLE, как у `scene:report` и `revive:report`.
 *
 * ПАЛЕЦ ТОЖЕ НАСТОЯЩИЙ: `Input.dispatchTouchEvent` при включённой тач-эмуляции —
 * тот же путь, что у живого касания (настоящие `pointerId`, настоящий захват,
 * настоящая склейка движений кадрами). Иначе стенд проверял бы собственные
 * вызовы, а не управление: ровно этим прежний стенд следа пальца и обманывал,
 * показывая 21 из 21 при потерянном каждом втором тапе.
 *
 * ЧАСЫ СТРАНИЦЫ СДВИНУТЫ, А НЕ ПОДМЕНЕНЫ, И ЭТО ТОЖЕ УСЛОВИЕ. С появлением
 * суток, погоды и волков то, что видит стенд, зависит от того, в какую минуту
 * его запустили: ночью со стаей прогулка к дереву кончилась бы укусом, и
 * «цепочка сорвалась» было бы фактом о часах, а не об игре. Поэтому до загрузки
 * страницы `Date.now` получает **постоянную** прибавку (`clock`): время идёт с
 * настоящей скоростью, выбирается только минута. Это законно ровно потому, что
 * весь режим — чистая функция от `serverNow()`: сдвиг переносит небо, погоду и
 * стаю в нужную минуту и не трогает больше ничего. Нужная минута ищется теми же
 * функциями, которыми считает игра (`sky.ts`, `wolves.ts`), а не угадывается.
 *
 * ЧЕГО НЕ МЕРЯЕТ:
 *   вид        картинку отсюда не оценить; но снять её можно — `SHOTS=папка`
 *              кладёт снимки 375 и 360 px в каждом состоянии, смотреть глазами;
 *   звук       вой синтезируется, а слышен он только ухом; стенд проверяет, что
 *              молчит, пока звук выключен, — это тест, а не отчёт;
 *   вебвью     это Chrome, а не клиент Телеграма: перехват жеста клиентом здесь
 *              не воспроизвести, и на такой случай в игре стоит журнал касаний;
 *   удобство   стенд говорит «дошёл» и «сколько раз», а не «приятно ли». На это
 *              отвечает человек с телефоном в руках, и заменить его нечем.
 *
 * Запуск: npm run prologue:report
 * Переменные: SECONDS=6, SHOTS=папка, PORT / CDP_PORT, CHROME=путь\\к\\chrome.exe, HEAD=1.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer as createVite } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { launchChrome, sleep, Tab } from './lib/chrome';
import { BURN_FULL_MS, HEARTH_CAP, KEEP_BURN, LOG_HOURS, LOG_MS, burnLeftMs } from '../src/prologue/fire';
import {
  AXE_STUMP,
  CHOPS_TO_FELL,
  GLADE_R,
  GUEST_FROM,
  HOUSE,
  MATE_SPOT,
  REACH,
  REGROW_MS,
  TENT,
  TREES,
  TREE_LOGS,
  WALK_SPEED,
  WARM_R,
} from '../src/prologue/glade';
import {
  ARRIVAL_COLD,
  COAT_CHILL,
  COLD_H,
  HEALTH_H,
  HEAL_H,
  MEAT_FED_H,
  MEAT_HEAL,
  RAW_SHARE,
  STARVE_H,
  WARM_MIN,
  WOLF_BITES,
  coldEmptyAt,
  deadAt,
  newBody,
  type Body,
} from '../src/prologue/body';
import { ARROWS_PER_LOG, HOUSE_LOGS, HOUSE_PER_STAGE, HOUSE_STAGES, QUIVER_MAX } from '../src/prologue/craft';
import {
  BOND_KINDS,
  GUESTS,
  GUEST_FIRST_MS,
  GUEST_GAP_MS,
  HEIR_MAX,
  HEIR_MIN,
  LOVE_DAYS,
  LOVE_FULL,
  LOVE_STEP,
  dayOf,
} from '../src/prologue/kin';
import { newHearth } from '../src/prologue/fire';
import { ARROWS_START, CARCASS_H, DEER_ALERT, DEER_BODY_R, DEER_FLEE, DEER_GAP_H, DEER_MEAT, DEER_SLEEP_FLEE } from '../src/prologue/hunt';
import { ROAST_COST } from '../src/prologue/act';
import { LOOK_PER_PX, STICK_DEAD, STICK_FULL } from '../src/prologue/controls';
import {
  BURN_MEAN,
  CHILL_MEAN,
  DAY_SHARE,
  NIGHT_CHILL,
  OMEN_MS,
  RAIN_BURN,
  RING,
  RING_MS,
  SKY_MS,
  SNOW_CHILL,
  SPELL_MS,
  isNight,
  weatherAt,
} from '../src/prologue/sky';
import {
  EARLIEST_BITE_MS,
  EARLIEST_DEATH_MS,
  HOWL_LEAD_MS,
  WOLF_BITE_GAP,
  WOLF_DAYS,
  WOLF_DAY_PACK,
  WOLF_FIRE_R,
  WOLF_NIGHTS,
  WOLF_NIGHT_PACK,
  WOLF_STALK_MS,
  packAt,
} from '../src/prologue/wolves';
import { TAP_MS, TAP_SLIP } from '../src/gestures';

const PORT = Number(process.env.PORT ?? 4195);
const DEBUG_PORT = Number(process.env.CDP_PORT ?? 9338);
/** Сколько секунд кадров снимать на каждый экран. */
const SECONDS = Number(process.env.SECONDS ?? 6);
/** Куда класть снимки. Пусто — не снимать: снимки нужны глазам, а не приёмке. */
const SHOTS = process.env.SHOTS ?? '';

/** Сколько ждать после тапа по туше: движение длится, и торопить его нельзя. */
const BUTCHER_WAIT = 1000;

/** Два экрана: телефон в портрете и обычный монитор. */
const SCREENS = [
  { name: 'телефон 375×812 @2', w: 375, h: 812, dpr: 2, mobile: true },
  { name: 'ПК 1280×800 @1', w: 1280, h: 800, dpr: 1, mobile: false },
];

/** Два узких телефона для снимков: 375 — самый частый, 360 — самый тесный. */
const SHOT_SIZES = [
  { w: 375, h: 812 },
  { w: 360, h: 780 },
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

/** Поле имени глазами страницы: где стоит, в фокусе ли, что в нём и не уехала ли страница. */
interface Field {
  here: boolean;
  focused: boolean;
  value: string;
  top: number;
  bottom: number;
  cardTop: number;
  disabled: boolean;
  why: string;
  inner: number;
  scroll: number;
  vvTop: number;
}

/**
 * Какую долю экрана в портрете занимает клавиатура вместе со строкой подсказок.
 *
 * 336 из 812 — клавиатура iPhone с полосой подсказок; у Gboard на Android того же
 * порядка. Мерка нужна одна: поле имени обязано стоять выше неё на любом экране.
 */
const KEYBOARD_SHARE = 336 / 812;

/**
 * Что подкладывается в страницу.
 *
 * Своих сведений о сцене здесь нет: положение игрока, дрова, топор, волки и
 * небо спрашиваются у самой сцены через `window.__pro`. Стенд только считает
 * кадры и водит пальцем.
 */
const PROBE = `
(() => {
  const pro = () => window.__pro;
  if (!pro()) throw new Error('нет window.__pro — предыстория не открыта или страница без ?probe=1');
  let stamps = [];
  let watching = false;
  // Щелчки по луку считаются у окна на погружении и раньше всех: тогда видно,
  // дошло ли касание до кнопки, даже если щелчок потом кто-то перехватит.
  let bowClicks = 0;
  window.addEventListener('click', (e) => {
    if (e.target && e.target.closest && e.target.closest('.pro-bow')) bowClicks++;
  }, true);
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
    /** Где игрок, что у него в руках, что предлагает поляна и что вокруг. */
    state() {
      const p = pro();
      const v = p.snapshot();
      return JSON.stringify({
        x: p.where().x,
        z: p.where().z,
        yaw: p.where().yaw,
        logs: p.hands().logs,
        axe: p.hands().axe,
        bow: p.hands().bow,
        quiver: p.hands().quiver,
        cooked: p.hands().cooked,
        raw: p.hands().raw,
        fill: v.fireFill,
        words: v.fireWords,
        fed: v.fedWords,
        fedFill: v.fedFill,
        warmth: v.warmthFill,
        warmthWords: v.warmthWords,
        health: v.healthFill,
        healthWords: v.healthWords,
        harm: p.hands().harm,
        items: v.items.map((i) => i.id).join(','),
        worn: v.items.filter((i) => i.worn).map((i) => i.id).join(','),
        night: v.night,
        weather: v.weather,
        wolves: v.wolves,
        label: v.offer.label,
        can: v.offer.can,
        why: v.offer.why,
        shot: v.shot.label,
        shotCan: v.shot.can,
        drawn: v.drawn,
        dead: v.dead,
        hides: p.hands().hides,
        coat: p.hands().coat,
        house: p.craft().house,
        roof: p.craft().roof,
        arrows: p.arrowCount(),
        chops: v.busyLeft,
        mate: v.mate,
        mateName: v.mateName,
        mateSays: v.mateSays,
        panel: v.panel,
        love: v.love,
        nights: v.nights,
        note: v.note,
        hugging: v.hugging,
        give: v.give.label,
        giveCan: v.give.can,
        giveWhy: v.give.why,
        lineage: v.lineage.length,
        refused: p.kin().refused,
        wife: p.kin().wife,
        heir: p.kin().heir,
        kept: p.kin().kept,
        camY: p.kin().camY,
        camPitch: p.kin().camPitch,
      });
    },
    /** Где женщина у огня. У сцены: её место живёт в кадрах. */
    mate() {
      return JSON.stringify(pro().mateAt());
    },
    /** Середина узла надстройки — туда кладётся палец. */
    box(sel) {
      const el = document.querySelector(sel);
      if (!el) return JSON.stringify(null);
      const r = el.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
    },
    /** Поле имени и страница вокруг него: не уехало ли поле и не прыгнула ли страница. */
    field() {
      const input = document.querySelector('.pro-name input');
      const card = document.querySelector('.pro-name');
      const btn = document.querySelector('.pro-name button[type=submit]');
      const why = document.querySelector('.pro-name .pro-card-why');
      const box = document.querySelector('.pro');
      const r = input ? input.getBoundingClientRect() : null;
      const c = card ? card.getBoundingClientRect() : null;
      const vv = window.visualViewport;
      return JSON.stringify({
        here: !!input,
        focused: !!input && document.activeElement === input,
        value: input ? input.value : '',
        top: r ? r.top : -1,
        bottom: r ? r.bottom : -1,
        cardTop: c ? c.top : -1,
        disabled: !!btn && btn.disabled,
        why: why ? why.textContent : '',
        inner: window.innerHeight,
        scroll: (document.scrollingElement ? document.scrollingElement.scrollTop : 0) + window.scrollY + (box ? box.scrollTop : 0),
        vvTop: vv ? vv.offsetTop : 0,
      });
    },
    /** Затемнение и знак объятия: что сейчас на экране поверх сцены. */
    veil() {
      const el = document.querySelector('.pro-hug');
      if (!el) return JSON.stringify(null);
      return JSON.stringify({
        veil: Number(el.children[0].style.opacity || 0),
        heart: Number(el.children[1].style.opacity || 0),
      });
    },
    /** Запись как она лежит на диске — тем же ключом, каким её возьмёт основная игра. */
    saved() {
      try {
        return JSON.stringify(JSON.parse(localStorage.getItem('tribe.prologue.v1') || '{}'));
      } catch (e) {
        return JSON.stringify({});
      }
    },
    /** Занята ли точка касания разметкой: под пальцем обязана быть канва. */
    free(x, y) {
      const el = document.elementFromPoint(x, y);
      return JSON.stringify(!!el && el.tagName === 'CANVAS');
    },
    /** Сколько щелчков дошло до кнопки лука с тех пор, как щуп подложен. */
    bowClicks() {
      return JSON.stringify(bowClicks);
    },
    /** Где сейчас зверь. Спрашиваем у сцены: второго источника у этого нет. */
    deer() {
      return JSON.stringify(pro().deerAt());
    },
    /** Где стоят волки. Тоже у сцены: их положение живёт только в кадрах. */
    wolves() {
      return JSON.stringify(pro().wolvesAt());
    },
    /** Где лежит туша. Тоже у сцены: она одна знает, где упал зверь. */
    carcass() {
      return JSON.stringify(pro().carcassAt());
    },
    /** Стоит ли на экране строка о небе и что в ней написано. */
    sky() {
      const el = document.querySelector('.pro-sky');
      return JSON.stringify(el ? el.textContent : '');
    },
    /**
     * Полосы, выход и нижний ряд глазами разметки: где стоят, не наезжают ли друг на
     * друга и держит ли подложка цвет. Белое по белому на снегу тест не увидит —
     * а прозрачность подложки увидит.
     */
    layout() {
      const r = (s) => {
        const e = document.querySelector(s);
        if (!e) return null;
        const b = e.getBoundingClientRect();
        return { l: b.left, t: b.top, r: b.right, b: b.bottom };
      };
      const plate = document.querySelector('.pro-vitals');
      return JSON.stringify({
        vitals: r('.pro-vitals'),
        out: r('.pro-out'),
        act: r('.pro-act'),
        pack: r('.pro-pack'),
        card: r('.pro-card'),
        bg: plate ? getComputedStyle(plate).backgroundColor : '',
        rows: Array.from(document.querySelectorAll('.pro-vital')).map((e) => e.className.replace('pro-vital ', '')),
        vw: innerWidth,
        vh: innerHeight,
      });
    },
    /** Насколько кадр подёрнут инеем: то же число, что на полосе тепла. */
    frost() {
      const el = document.querySelector('.pro-frost');
      return JSON.stringify(el ? Number(el.style.opacity || 0) : -1);
    },
    /** Окно вещей глазами разметки: строки, числа, отметки «надета» и кнопки еды. */
    inv() {
      const card = document.querySelector('.pro-inv');
      if (!card) return JSON.stringify(null);
      const rows = Array.from(card.querySelectorAll('li')).map((li) => {
        const name = li.querySelector('.pro-inv-name');
        const n = li.querySelector('.pro-inv-n');
        const eat = li.querySelector('.pro-eat');
        return {
          name: name && name.firstChild ? String(name.firstChild.textContent).trim() : '',
          n: n ? n.textContent : '',
          worn: !!li.querySelector('.pro-inv-worn'),
          eat: eat ? (eat.disabled ? 'погашена' : 'можно') : '',
        };
      });
      const why = card.querySelector('.pro-card-why');
      return JSON.stringify({ rows, empty: !!card.querySelector('.pro-say'), why: why ? why.textContent : '' });
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
     * Спрашиваем то же, что видит палец: какой узел лежит в середине кнопки.
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
const H = 3_600_000;
const clockWords = (ms: number): string => `${Math.floor(ms / 60_000)} мин ${Math.round((ms % 60_000) / 1000)} с`;

const chain: Chain[] = [];
const step = (name: string, ok: boolean, said: string): void => {
  chain.push({ step: name, ok, said });
  console.log(`  ${pad(name, 40)} ${pad(yes(ok), 4)} ${said}`);
};

/**
 * Первая минута не раньше `from`, начиная с которой `ok` держится `span` подряд.
 *
 * Ищется теми же функциями, которыми считает игра, а не угадывается: небо,
 * погода и стая — чистые функции от времени, и значит нужную минуту можно
 * назвать заранее. Шагом в секунду: у неба границы в сотни секунд.
 */
function moment(from: number, span: number, ok: (t: number, into: number) => boolean): number {
  let t = Math.ceil(from / 1000) * 1000;
  const give = from + 30 * 24 * H;
  while (t < give) {
    let bad = -1;
    for (let u = t; u <= t + span; u += 1000) {
      if (!ok(u, u - t)) {
        bad = u;
        break;
      }
    }
    if (bad < 0) return t;
    t = bad + 1000;
  }
  throw new Error('за месяц не нашлось такой минуты — кольцо погод или стаю поменяли?');
}

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
    console.log('\nЦепочка проходится настоящим касанием, вещи открываются кнопкой, стая отбивается топором, род проходится пальцем, живая сцена в игре одна.');
  }
}

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
  const screen = async (s: { w: number; h: number; dpr: number; mobile: boolean }): Promise<void> => {
    await tab.send('Emulation.setDeviceMetricsOverride', {
      width: s.w,
      height: s.h,
      deviceScaleFactor: s.dpr,
      mobile: s.mobile,
    });
  };
  await screen(SCREENS[0]);
  await tab.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  /*
   * Часы страницы. Прибавка постоянная и ставится до первой строки кода
   * страницы — иначе игра успела бы прочесть настоящее время и сохранить его.
   * Каждое новое состояние — новая прибавка и перезагрузка с чистого листа.
   */
  let clockId = '';
  let shift = 0;
  /** Сколько сейчас на часах страницы: настоящее время плюс прибавка. */
  const pageNow = (): number => Date.now() + shift;
  const clock = async (pageAt: number): Promise<void> => {
    if (clockId) await tab.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: clockId });
    shift = Math.round(pageAt - Date.now());
    const added = await tab.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => { const real = Date.now.bind(Date); const shift = ${shift}; Date.now = () => real() + shift; })();`,
    });
    clockId = added.identifier;
  };

  /** Перезагрузить с чистого листа и дождаться стартового экрана. */
  const fresh = async (): Promise<void> => {
    await tab.eval<string>('(() => { try { localStorage.clear(); } catch (e) {} return JSON.stringify("ok"); })()');
    await tab.send('Page.reload');
    for (let i = 0; ; i++) {
      await sleep(300);
      if (await tab.eval<boolean>("JSON.stringify(!!document.querySelector('.start-alt'))")) break;
      if (i > 100) throw new Error('стартовый экран не поднялся за 30 с — смотри вывод «в странице:» выше');
    }
  };

  /** Открыть предысторию кнопкой и подложить щуп. */
  const enter = async (): Promise<void> => {
    await tab.eval<string>("(() => { document.querySelector('.start-alt').click(); return JSON.stringify('ok'); })()");
    for (let i = 0; ; i++) {
      await sleep(200);
      if (await tab.eval<boolean>('JSON.stringify(!!window.__pro)')) break;
      if (i > 100) throw new Error('предыстория не открылась за 20 с');
    }
    await tab.eval<string>(PROBE);
    await sleep(800);
  };

  /** Снимок экрана в двух узких размерах. Только если попросили. */
  const shoot = async (name: string): Promise<void> => {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    for (const s of SHOT_SIZES) {
      await screen({ w: s.w, h: s.h, dpr: 2, mobile: true });
      // Холст меняет размер по ResizeObserver — кадр-другой ему на это.
      await sleep(900);
      const shot = await tab.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(SHOTS, `${name}-${s.w}.png`), Buffer.from(shot.data, 'base64'));
    }
    await screen(SCREENS[0]);
    await sleep(500);
  };

  /*
   * Минута для цепочки: погожий день без единого волка, а следом за ним и ночь
   * без стаи. Цепочка с замером кадров занимает около полутора минут; день —
   * две с половиной. Стая, вышедшая на опушку посреди прогулки к дереву,
   * сорвала бы цепочку фактом о часах, а не об игре.
   */
  const now0 = Date.now() + 10_000;
  const dawn = moment(now0, SKY_MS - 5000, (t, into) =>
    packAt(t, 0) === 0 && (into > 110_000 || (!isNight(t) && weatherAt(t) === 'clear')),
  );
  await clock(dawn + 1500);
  await fresh();
  const before = await tab.eval<number>("JSON.stringify(document.querySelectorAll('canvas').length)");
  const heapVillage = await tab.eval<number>(
    'JSON.stringify(performance.memory ? performance.memory.usedJSHeapSize : 0)',
  );
  await enter();

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
  // Считаются из самих констант и тех же функций, которыми считает игра, а не
  // переписываются в отчёт руками: число, которому никто не верит, хуже
  // отсутствующего.
  console.log('0. Сколько чего хватает\n');
  const row = (a: string, b: string, c = ''): void => console.log(`  ${pad(a, 30)} ${pad(b, 22)} ${c}`);
  row('полено', `${LOG_HOURS} ч погожих`, `дерево даёт ${TREE_LOGS} полена = ${TREE_LOGS * LOG_HOURS} ч огня`);
  row('полный очаг', `${BURN_FULL_MS / H} ч погожих`, `${HEARTH_CAP} полен; по погоде в среднем ${num(BURN_FULL_MS / H / BURN_MEAN)} ч`);
  row('сытость', `${STARVE_H} ч`, `потом здоровье — ${HEALTH_H} ч; погода голода не трогает`);
  row('тепло без огня', `${COLD_H} ч в среднем`, `потом здоровье — ${HEALTH_H} ч ровно; отогрев ${WARM_MIN} мин; круг у костра ${WARM_R.toFixed(2)} м`);
  row('здоровье', `${WOLF_BITES} укусов`, `кусок жареного — ${MEAT_HEAL} укус обратно, сырого — треть; само — за ${HEAL_H} ч у огня и под крышей`);
  row('кусок жареного мяса', `${MEAT_FED_H} ч`, `сырой втрое хуже: ${num(MEAT_FED_H * RAW_SHARE * 60, 0)} мин`);
  row('олень', `${DEER_MEAT} кусков = ${DEER_MEAT * MEAT_FED_H} ч`, 'ровно полный живот');
  row('жарка оленя целиком', `${DEER_MEAT * ROAST_COST} полена`, 'то есть ровно одно дерево');
  row('следующий олень', `${DEER_GAP_H} ч`, `туша лежит ${CARCASS_H} ч`);
  row('стрел в колчане', String(ARROWS_START), 'подбираются, поэтому не кончаются насовсем');
  row('замечает / срывается', `${DEER_ALERT} / ${DEER_FLEE} м`, `спящий — с ${DEER_SLEEP_FLEE} м; тап достаёт на ${REACH} м`);
  console.log('');
  // Самая ранняя смерть на новой поляне — прогоном по всем фазам кольца, а не
  // на бумаге: погода входит в оба слагаемых.
  let earliest = Infinity;
  let careless = 0;
  let carelessN = 0;
  for (let t0 = 0; t0 < RING_MS; t0 += 10_000) {
    earliest = Math.min(earliest, deadAt(newBody(t0, ARRIVAL_COLD), newHearth(t0)) - t0);
    careless += deadAt({ ...newBody(t0), warm: false }, { fuel: 0, at: t0 }) - t0;
    carelessN++;
  }
  row('от беспечности до смерти', `${num(careless / carelessN / H, 2)} ч`, `без огня, раздетым под небом: ${COLD_H} ч тепла и ${HEALTH_H} ч здоровья (было 5.65 ч)`);
  row('самая ранняя смерть', `${num(earliest / H)} ч`, 'новая поляна, от холода (было 14 ч)');
  row('пришёл к огню', `тепла ${num((1 - ARRIVAL_COLD) * 100, 0)}%`, `зима с первого кадра; у огня тепло возвращается за ${num(ARRIVAL_COLD * WARM_MIN, 0)} мин`);
  const meatPerDay = 24 / MEAT_FED_H;
  row('сутки отлучки', 'дров не нужно', `тепла хватает на ${COLD_H} ч; дрова нужны отлучке дольше полутора суток (было 5.7 полена)`);
  row('и еды на сутки', `${meatPerDay} куска`, `${num(meatPerDay / DEER_MEAT, 2)} оленя`);
  console.log('');
  console.log('0б. Небо и волки\n');
  row('круг суток', clockWords(SKY_MS), `день ${clockWords(DAY_SHARE * SKY_MS)}, ночь ${clockWords((1 - DAY_SHARE) * SKY_MS)}`);
  // Застаёт ли трёхминутный заход и день, и ночь — с любой секунды круга.
  let both = true;
  for (let t0 = 0; t0 < SKY_MS && both; t0 += 1000) {
    let d = false;
    let n = false;
    for (let t = t0; t <= t0 + 180_000; t += 1000) {
      if (isNight(t)) n = true;
      else d = true;
    }
    both = d && n;
  }
  row('заход 3 мин застаёт', both ? 'и день, и ночь' : 'НЕ ОБА', 'проверено с каждой секунды круга');
  const share = (k: string): string => `${num((RING.filter((w) => w === k).length / RING.length) * 100, 0)}%`;
  row('кольцо погод', `${RING.length} × ${clockWords(SPELL_MS)}`, `= ${clockWords(RING_MS)}; ясно ${share('clear')}, дождь ${share('rain')}, снег ${share('snow')}`);
  row('дождь', `очаг горит ×${RAIN_BURN}`, `небо хмурится за ${OMEN_MS / 1000} с; средняя ставка горения ${num(BURN_MEAN, 3)}`);
  row('ночь / снег', `стынут ×${NIGHT_CHILL} / ×${SNOW_CHILL}`, `вместе ×${num(NIGHT_CHILL * SNOW_CHILL, 2)}; средняя ставка холода ${num(CHILL_MEAN, 3)}`);
  row('волки днём / ночью', `${WOLF_DAY_PACK} / ${WOLF_NIGHT_PACK}`, `в ${num(WOLF_DAYS * 100, 0)}% дней и ${num(WOLF_NIGHTS * 100, 0)}% ночей`);
  row('у горящего огня', `не ближе ${WOLF_FIRE_R} м`, 'все деревья за этим кругом');
  row('от выхода из круга', `кружат ${WOLF_STALK_MS / 1000} с`, `вой через ${HOWL_LEAD_MS / 1000} с; укус раз в ${WOLF_BITE_GAP / 1000} с`);
  row('смерть от волков', `не раньше ${EARLIEST_DEATH_MS / 1000} с`, `${WOLF_BITES} укусов целому; первый — не раньше ${EARLIEST_BITE_MS / 1000} с`);
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

  /**
   * Тянуть взглядом: палец в правой половине, поворот на столько-то градусов.
   *
   * КОРОТКАЯ ТЯГА — НЕ ТАП, И ДЕРЖИТСЯ ЭТО ЗДЕСЬ, А НЕ У КАЖДОГО, КТО ЗОВЁТ ВЗГЛЯД.
   * Разбор жеста честно засчитывает тапом касание, сошедшее меньше `TAP_SLIP`, а тап
   * делает дело над тем, к чему подошли: доворот на десяток градусов у костра с
   * дровами в руках клал их в огонь, у колоды — строгал из них стрелы. Нашёл это
   * прогон рода: два полена, которые стенд нёс в общий очаг, ушли раньше, чем
   * гостья стала женой, и день дров не засчитался. Поэтому короткая тяга сперва
   * уводит палец вниз за порог тапа и возвращает обратно: наклон взгляда приходит
   * к прежнему, а жест остаётся ведением. Длинной тяге это не нужно, и её путь
   * не тронут.
   */
  const look = async (deg: number): Promise<void> => {
    const px = Math.round(-deg / LOOK_PER_PX);
    const ox = 280;
    const oy = 400;
    const dip = Math.abs(px) <= TAP_SLIP + 4 ? TAP_SLIP + 12 : 0;
    await send('touchStart', [{ id: 3, x: ox, y: oy }]);
    for (let i = 1; dip > 0 && i <= 3; i++) {
      await send('touchMove', [{ id: 3, x: ox, y: oy + (dip * i) / 3 }]);
      await sleep(16);
    }
    const steps = Math.max(4, Math.min(20, Math.abs(px) / 8));
    for (let i = 1; i <= steps; i++) {
      await send('touchMove', [{ id: 3, x: ox + (px * i) / steps, y: oy + dip }]);
      await sleep(16);
    }
    for (let i = 2; dip > 0 && i >= 0; i--) {
      await send('touchMove', [{ id: 3, x: ox + px, y: oy + (dip * i) / 3 }]);
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
  step('часы страницы на погожем дне', !start.night && start.weather === '' && start.wolves === 0, `ночь: ${start.night ? 'да' : 'нет'}, погода: «${start.weather}», волков: ${start.wolves}`);

  // Зима с первого кадра: пришедший к огню замёрз — полоса тепла неполная и
  // растёт у огня, а края кадра подёрнуты инеем. Видно это обязано быть сразу.
  const frostAt = await tab.eval<number>('window.__probe.frost()');
  const warmth0 = start.warmth as unknown as number;
  step(
    'холод давит с первого кадра',
    warmth0 < 1 - ARRIVAL_COLD + 0.05 && frostAt > 0.2 && start.warmthWords === 'греется',
    `тепла ${num(warmth0 * 100, 0)}% («${start.warmthWords}»), иней ${num(frostAt, 2)}`,
  );

  /** Пересекаются ли два прямоугольника разметки. */
  type Box = { l: number; t: number; r: number; b: number } | null;
  const overlaps = (a: Box, b: Box): boolean => !!a && !!b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  type Layout = { vitals: Box; out: Box; act: Box; pack: Box; card: Box; bg: string; rows: string[]; vw: number; vh: number };
  for (const s of SHOT_SIZES) {
    await screen({ w: s.w, h: s.h, dpr: 2, mobile: true });
    await sleep(700);
    const L = await tab.eval<Layout>('window.__probe.layout()');
    const alpha = Number((L.bg.match(/rgba\([^)]*,\s*([\d.]+)\)/) ?? [])[1] ?? 1);
    const inside = !!L.vitals && !!L.act && !!L.pack && L.vitals.l >= 0 && L.act.l >= 0 && L.act.r <= L.vw && L.pack.r <= L.vw;
    step(
      `${s.w} px: три полосы слева сверху, ни на что не наезжают`,
      L.rows.length === 3 && !overlaps(L.vitals, L.out) && !overlaps(L.vitals, L.act) && inside && alpha >= 0.5,
      `полосы ${Math.round(L.vitals?.l ?? -1)}–${Math.round(L.vitals?.r ?? -1)} px, выход с ${Math.round(L.out?.l ?? -1)} px; подложка ${L.bg}; нижний ряд ${Math.round(L.act?.l ?? -1)}–${Math.round(L.act?.r ?? -1)} из ${L.vw}`,
    );
  }
  await screen(SCREENS[0]);
  await sleep(500);
  // Три полосы на снегу — глазами, пока подсказка ещё стоит: первый кадр захода.
  await shoot('1а-вход-полосы');

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
  // Первый снимок — днём, с топором в руке: подсказка ушла с первым касанием.
  await shoot('1-день');

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

  /**
   * Навести взгляд на зверя перед выстрелом — точнее половины его ширины.
   *
   * Доворота с допуском в шесть градусов для лука мало, и нашлось это прогоном:
   * олень в девяти метрах шириной в метр — это шесть градусов целиком, и доворот,
   * остановившийся у края допуска, пускал стрелу мимо. Цепочка срывалась четырьмя
   * промахами подряд или проходила с первого выстрела в зависимости от того, где
   * остановился последний доворот, — то есть от тайминга стенда, а не от игры.
   * Стрела летит ровно туда, куда смотрят, поэтому и смотреть стенд обязан точно,
   * а где зверь, перечитывать на каждом довороте: он пасётся.
   */
  const aimAtDeer = async (): Promise<boolean> => {
    for (let i = 0; i < 8; i++) {
      const beast = await tab.eval<{ x: number; z: number } | null>('window.__probe.deer()');
      if (!beast) return false;
      const now = await state();
      const dx = beast.x - (now.x as unknown as number);
      const dz = beast.z - (now.z as unknown as number);
      const tol = Math.max(0.75, ((Math.atan2(DEER_BODY_R, Math.hypot(dx, dz)) * 180) / Math.PI) * 0.5);
      const wantDeg = (Math.atan2(-dx, -dz) * 180) / Math.PI;
      const haveDeg = ((now.yaw as unknown as number) * 180) / Math.PI;
      const turn = ((wantDeg - haveDeg + 540) % 360) - 180;
      if (Math.abs(turn) <= tol) return true;
      await look(Math.max(-100, Math.min(100, turn)));
    }
    return true;
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

  /**
   * Нажать лук и дождаться, что сцена это услышала: лук натянулся или стрела ушла.
   *
   * НАЖАТИЕ ЗАСЧИТЫВАЕТСЯ ПО СЦЕНЕ, А НЕ ПО ПАЛЬЦУ, — И НАШЁЛ ЭТО ПРОГОН. Стенд
   * считал выстрелом своё нажатие, а прогон показал «один выстрел, в колчане 3,
   * на земле 0»: стрела ещё летела, когда колчан пересчитывали. Так бывает ровно в
   * одном случае — одно нажатие до сцены не дошло, лук остался натянутым, и
   * следующее «натянуть» пустило стрелу: на щелчок по натянутому луку сцена
   * стреляет всегда (`doBow`). Теперь нажатие ждёт ответа сцены, не дождалось —
   * повторяется один раз, а потеря называется строкой отчёта вместе с тем, дошёл
   * ли щелчок до кнопки (счётчик щупа), — молча её не спрятать.
   */
  const lostBow: string[] = [];
  const bowPress = async (want: 'draw' | 'shoot', aim?: () => Promise<boolean>): Promise<boolean> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (aim && !(await aim())) return false;
      const before = await state();
      const clicks = await tab.eval<number>('window.__probe.bowClicks()');
      await bowTap();
      for (let t = 0; t < 12; t++) {
        const now = await state();
        const heard =
          want === 'draw' ? now.drawn === true : (now.quiver as unknown as number) < (before.quiver as unknown as number);
        if (heard) return true;
        await sleep(50);
      }
      const came = (await tab.eval<number>('window.__probe.bowClicks()')) > clicks;
      lostBow.push(
        `«${want === 'draw' ? 'натянуть' : 'пустить'}» — ${came ? 'щелчок до кнопки дошёл, сцена не ответила' : 'щелчка по кнопке не было'}`,
      );
      await sleep(300);
    }
    return false;
  };

  /**
   * Дождаться, что стрела больше не в воздухе.
   *
   * Попал или нет, решает долетевшая стрела, а не пауза после нажатия: пока она
   * летит, в колчане её уже нет, а на земле ещё нет. Промах втыкает её в землю,
   * попадание кладёт рядом с тушей (`hitBeast`), и в обоих случаях колчан с землёй
   * снова дают полный счёт. Не дали за две секунды — стрела пропала, и это поймает
   * шаг «стрела не размножилась».
   */
  const landed = async (): Promise<void> => {
    for (let t = 0; t < 40; t++) {
      const now = await state();
      if ((now.quiver as unknown as number) + (now.arrows as unknown as number) === ARROWS_START) return;
      await sleep(50);
    }
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
    if (!(await bowPress('draw'))) break;
    // Целимся ещё раз и точно: пока натягивали, зверь мог шагнуть.
    if (!(await bowPress('shoot', aimAtDeer))) break;
    shots++;
    await landed();
    // Попадание засчитывает туша на поляне, а не то, что оленя больше не видно.
    hit = (await tab.eval<{ x: number; z: number } | null>('window.__probe.carcass()')) !== null;
  }
  await landed();
  const shotState = await state();
  const shotQuiver = shotState.quiver as unknown as number;
  const shotGround = shotState.arrows as unknown as number;
  step(
    'лук: натянул и пустил стрелу',
    shots > 0 && shotQuiver < ARROWS_START,
    `выстрелов ${shots}, в колчане ${shotQuiver}, на земле ${shotGround}`,
  );
  step('стрела не размножилась', shotQuiver + shotGround === ARROWS_START, `${shotQuiver} + ${shotGround} = ${shotQuiver + shotGround} из ${ARROWS_START}`);
  step('олень свален', hit, hit ? `с ${shots} выстрела` : `${shots} выстрелов мимо — зверь ушёл`);
  if (lostBow.length) console.log(`  касание лука не дошло до сцены ${lostBow.length} раз: ${lostBow.join('; ')}`);

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

  // ---------- 1в. Вещи ----------
  //
  // Окно открывается кнопкой справа внизу — касанием, как всё остальное, — и
  // показывает ровно то, что у человека есть. Сытому и целому есть незачем:
  // кнопка еды гаснет и говорит причину.
  console.log('');
  type Inv = { rows: { name: string; n: string; worn: boolean; eat: string }[]; empty: boolean; why: string } | null;
  const pressSel = async (sel: string): Promise<boolean> => {
    const box = await tab.eval<{ x: number; y: number } | null>(`window.__probe.box(${JSON.stringify(sel)})`);
    if (!box) return false;
    await send('touchStart', [{ id: 7, x: box.x, y: box.y }]);
    await sleep(80);
    await send('touchEnd', []);
    await sleep(260);
    return true;
  };
  await pressSel('.pro-pack');
  const inv = await tab.eval<Inv>('window.__probe.inv()');
  const had = await state();
  const expectedRows = [
    had.axe && 'Топор',
    had.bow && 'Лук',
    (had.quiver as unknown as number) > 0 && 'Стрелы',
    (had.cooked as unknown as number) > 0 && 'Жареное мясо',
    (had.raw as unknown as number) > 0 && 'Сырое мясо',
    (had.logs as unknown as number) > 0 && 'Дрова',
    (had.hides as unknown as number) > 0 && 'Шкура',
    had.coat && 'Одежда из шкуры',
  ].filter(Boolean);
  step(
    'вещи открылись кнопкой: ровно то, что есть',
    !!inv && inv.rows.map((r) => r.name).join('|') === expectedRows.join('|') && had.panel === 'pack',
    `строк ${inv?.rows.length ?? 0}: ${inv?.rows.map((r) => `${r.name}${r.n ? ` ${r.n}` : ''}`).join(', ') ?? 'окна нет'}`,
  );
  const meatRow = inv?.rows.find((r) => r.eat !== '');
  step(
    'сытому и целому есть незачем — кнопка гаснет и говорит',
    !!meatRow && meatRow.eat === 'погашена' && inv?.why === 'Ты сыт и цел',
    meatRow ? `«Съесть» ${meatRow.eat}; «${inv?.why}»` : 'мяса в вещах нет',
  );
  await pressSel('.pro-pack');
  step('вещи закрываются той же кнопкой', (await state()).panel === '', `карточка: ${(await state()).panel || 'нет'}`);

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
    budget.push([`день, ${s.name}`, await tab.eval<Frames>('window.__probe.stop()')]);
  }
  const heapGlade = await tab.eval<number>('window.__probe.heap()');
  const afterDay = await state();
  step('день не кончился посреди замера', !afterDay.night && afterDay.wolves === 0, `ночь: ${afterDay.night ? 'да' : 'нет'}, волков: ${afterDay.wolves}`);

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

  // ---------- 4. Ночь, непогода, волки ----------
  //
  // Каждое состояние — своя минута и перезагрузка с чистого листа. Запись
  // подкладывается: топор и лук уже в руках — иначе мерили бы не ту поляну, что
  // видит игрок после первого захода, и отбиваться от стаи было бы нечем.
  console.log('\n4. Ночь, непогода, волки (телефон 375×812)\n');
  /**
   * Запись с топором и луком — и тем, что сверху подложит раздел (`over`).
   * Туша, подложенная записью, свежая: срок у неё считается от минуты загрузки.
   */
  const kitSave = (over: Record<string, unknown> = {}): string => `(() => {
    const now = Date.now();
    const save = Object.assign({
      v: 1, hearth: { fuel: 6, at: now }, body: { hunger: 0.2, cold: 0, harm: 0, at: now },
      hunt: { killedAt: 0, carcass: null }, logs: 0, axe: true, kit: true, quiver: ${ARROWS_START},
      arrows: [], meat: { cooked: 2, raw: 0 }, felled: [${TREES.map(() => 0).join(',')}], wolvesBeatenAt: 0,
    }, ${JSON.stringify(over)});
    if (save.fuel !== undefined) { save.hearth = { fuel: save.fuel, at: now }; delete save.fuel; }
    if (save.hunt.carcass) save.hunt.killedAt = now;
    // Минута достроенного дома — от минуты загрузки: гостья придёт тогда, когда
    // разделу нужно, а не когда повезёт. Отрицательное — дом «достроят» позже.
    if (typeof save.builtAgo === 'number') { save.builtAt = now - save.builtAgo; delete save.builtAgo; }
    if (save.kept) { save.hearth = Object.assign({}, save.hearth, { kept: true }); delete save.kept; }
    localStorage.setItem('tribe.prologue.v1', JSON.stringify(save));
    return JSON.stringify('ok');
  })()`;

  /**
   * Перейти в минуту `at` и открыть поляну с топором и луком в руках.
   *
   * `hint` — снять подсказку тапом у костра. С пустыми руками тап там ничего не
   * делает, а с дровами положил бы их в очаг — поэтому разделы, которые несут
   * дрова, снимают подсказку первым шагом или взглядом.
   */
  const into = async (at: number, over: Record<string, unknown> = {}, hint = true): Promise<void> => {
    await clock(at + 1500);
    await fresh();
    await tab.eval<string>(kitSave(over));
    await enter();
    await screen(SCREENS[0]);
    await sleep(700);
    if (hint) await tap(190, 300);
  };

  const measure = async (name: string): Promise<void> => {
    await tab.eval<string>('window.__probe.start()');
    await sleep(SECONDS * 1000);
    budget.push([name, await tab.eval<Frames>('window.__probe.stop()')]);
  };

  // Ночь со стаей и ясным небом: восемьдесят секунд подряд, чтобы хватило и на
  // замер, и на драку.
  const night = moment(Date.now() + 10_000, 80_000, (t) => isNight(t) && packAt(t, 0) === WOLF_NIGHT_PACK && weatherAt(t) === 'clear');
  await into(night);
  const atNight = await state();
  step('ночь: стая вышла на опушку', atNight.night === true && atNight.wolves === WOLF_NIGHT_PACK, `ночь: ${atNight.night ? 'да' : 'нет'}, волков ${atNight.wolves}`);
  const skyLine = await tab.eval<string>('window.__probe.sky()');
  step('о ночи и волках сказано на экране', skyLine.includes('ночь') && skyLine.includes('волки'), `строка: «${skyLine}»`);
  // Сперва — лицом к стае: мерить ночь со стаей за спиной значило бы мерить не
  // то, что в кадре. Так и было в первой версии отчёта, и числа выходили ночью
  // дешевле, чем днём.
  const pack = await tab.eval<{ x: number; z: number }[]>('window.__probe.wolves()');
  if (pack.length) await turnTo(pack[0].x, pack[0].z);
  await measure('ночь, стая в кадре');
  const safe = await state();
  const packNow = await tab.eval<{ x: number; z: number }[]>('window.__probe.wolves()');
  const nearestWolf = Math.min(...packNow.map((w) => Math.hypot(w.x, w.z)));
  step('у горящего костра волки не подходят', nearestWolf >= WOLF_FIRE_R && safe.harm === 0, `ближайший в ${num(nearestWolf)} м от огня, урона: ${safe.harm}`);
  await shoot('2-ночь-стая');
  // И лицом к огню: ночью костёр обязан быть единственным светом, а это видно
  // только глазами. Замер здесь же: огонь с отсветом, искрами и дымом, звёзды и
  // луна над опушкой — самый тяжёлый по прозрачным слоям кадр поляны.
  await turnTo(0, 0);
  await measure('ночь, огонь и искры в кадре');
  await shoot('2б-ночь-костёр');

  // Выходим из круга у огня — стая начинает кружить. Идём на открытое место,
  // где нет ни дерева, ни костра в досягаемости: там тап достанется волку.
  const outFrom = Date.now();
  for (let i = 0; i < 10; i++) {
    const now = await state();
    if (Math.hypot(now.x as unknown as number, now.z as unknown as number) > WOLF_FIRE_R + 1.2) break;
    const dx = -1.2 - (now.x as unknown as number);
    const dz = 9.6 - (now.z as unknown as number);
    const wantDeg = (Math.atan2(-dx, -dz) * 180) / Math.PI;
    const haveDeg = ((now.yaw as unknown as number) * 180) / Math.PI;
    const turn = ((wantDeg - haveDeg + 540) % 360) - 180;
    if (Math.abs(turn) > 10) await look(Math.max(-100, Math.min(100, turn)));
    await walk(500);
  }
  const outside = await state();
  step('вышел из круга у огня', Math.hypot(outside.x as unknown as number, outside.z as unknown as number) > WOLF_FIRE_R, `${num(Math.hypot(outside.x as unknown as number, outside.z as unknown as number))} м от огня`);
  // Снимок посреди кружения: стая на виду, но ещё не бросилась.
  await sleep(1500);
  const circling = await tab.eval<{ x: number; z: number }[]>('window.__probe.wolves()');
  if (circling.length) await turnTo(circling[0].x, circling[0].z);
  await shoot('3-волки-кружат');

  // Драка. Ждём, пока предложение не станет «Отбиться», и бьём — тапом, как
  // игрок. Время на ответ стенду то же, что человеку: ни мгновения форы.
  let slain = 0;
  let firstBite = -1;
  let hurtMax = 0;
  const fightTill = Date.now() + 25_000;
  while (Date.now() < fightTill) {
    const now = await state();
    const hurt = now.harm as unknown as number;
    if (hurt > 0 && firstBite < 0) firstBite = Date.now() - outFrom;
    hurtMax = Math.max(hurtMax, hurt);
    if (now.dead) break;
    if ((now.wolves as unknown as number) === 0) break;
    if (String(now.label).startsWith('Отбиться') && now.can === true) {
      const had = now.wolves as unknown as number;
      await tap(190, 400);
      const was = await state();
      if ((was.wolves as unknown as number) < had) slain++;
      continue;
    }
    await sleep(60);
  }
  const fought = await state();
  step('топором отбился от стаи', slain > 0 && !fought.dead, `положено ${slain} из ${WOLF_NIGHT_PACK}, урон ${num(hurtMax, 2)} из ${WOLF_BITES}, ${fought.dead ? 'ЗАГРЫЗЛИ' : 'жив'}`);
  step('первый укус — не раньше срока', firstBite < 0 || firstBite >= EARLIEST_BITE_MS, firstBite < 0 ? 'не укусили ни разу' : `первый укус через ${num(firstBite / 1000)} с после выхода`);
  const quiet = await state();
  step('отбитая стая ушла', (quiet.wolves as unknown as number) === 0, `волков на поляне: ${quiet.wolves}`);

  /*
   * Укус и лечение — настоящим кадром и настоящим касанием. В драке выше стенд
   * отбивается раньше, чем стая кусает, и проверка лечения на укушенном после
   * драки проходила вхолостую: «не укусили — лечить нечего». Поэтому укус здесь
   * устроен нарочно: погасший очаг ночью, стая подходит к самой стоянке, стенд
   * смотрит на ближайшего волка, пока тот не укусит. Здоровье обязано упасть ровно
   * на укус, а не на «почти укус» (шесть шестых в плавающей точке — не единица), и
   * жареный кусок из вещей обязан вернуть его ровно обратно. Со снимками — на 375
   * и 360 px; проверки — на первом.
   */
  for (const size of SHOTS ? SHOT_SIZES : SHOT_SIZES.slice(0, 1)) {
    const biteNight = moment(Date.now() + 10_000, 40_000, (t) => isNight(t) && packAt(t, 0) === WOLF_NIGHT_PACK && weatherAt(t) === 'clear');
    await into(biteNight, { fuel: 0 }, false);
    await screen({ w: size.w, h: size.h, dpr: 2, mobile: true });
    await sleep(700);
    // Подсказку снимает взгляд: тап у погасшего очага с мясом в руках делал бы дело.
    await look(40);
    const biteFrom = Date.now();
    let me = await state();
    while (Date.now() < biteFrom + 30_000 && (me.harm as unknown as number) === 0) {
      // Лицом к ближайшему всё время, а не только когда он в шаге: бросок идёт по
      // прямой и быстрее доворота, и повернувшийся поздно стенд снимал укус без волка.
      const wolves = await tab.eval<{ x: number; z: number }[]>('window.__probe.wolves()');
      const near = wolves.sort(
        (a, b) =>
          Math.hypot(a.x - (me.x as unknown as number), a.z - (me.z as unknown as number)) -
          Math.hypot(b.x - (me.x as unknown as number), b.z - (me.z as unknown as number)),
      )[0];
      if (near) await turnTo(near.x, near.z);
      await sleep(40);
      me = await state();
    }
    const harm = me.harm as unknown as number;
    if (SHOTS && harm > 0) {
      mkdirSync(SHOTS, { recursive: true });
      const shot = await tab.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(SHOTS, `3б-укус-${size.w}.png`), Buffer.from(shot.data, 'base64'));
    }
    if (size !== SHOT_SIZES[0]) continue;
    step('волк укусил — здоровье упало ровно на укус', harm === 1, harm > 0 ? `урон ${harm} из ${WOLF_BITES} через ${num((Date.now() - biteFrom) / 1000)} с` : 'за 30 с не укусили');
    // После укуса стая отскакивает на `WOLF_BITE_GAP`: двух касаний это не ждёт.
    await pressSel('.pro-pack');
    const before = await state();
    await pressSel('.pro-inv li .pro-eat');
    const after = await state();
    step(
      'мясо из вещей вернуло здоровье — ровно укус',
      harm > 0 &&
        Math.abs((before.harm as unknown as number) - (after.harm as unknown as number) - MEAT_HEAL) < 0.01 &&
        (after.cooked as unknown as number) === (before.cooked as unknown as number) - 1,
      `урон ${num(before.harm as unknown as number, 2)} → ${num(after.harm as unknown as number, 2)}, жареного ${before.cooked} → ${after.cooked}`,
    );
    await pressSel('.pro-pack');
  }
  await screen(SCREENS[0]);
  await sleep(500);

  /*
   * Дождь: сперва небо хмурится, потом льёт. Минута — начало дождливого спелла,
   * перед которым день, и без волков; заходим за двадцать секунд до первой
   * капли. «Видеть, что портится, а не узнавать постфактум» проверяется только
   * так — глазами на снимке и словом в строке.
   */
  const noWolves = (a: number, b: number): boolean => {
    for (let u = a; u <= b; u += 1000) if (packAt(u, 0) !== 0) return false;
    return true;
  };
  let rainStart = Math.ceil((Date.now() + 60_000) / SPELL_MS) * SPELL_MS;
  for (let guard = 0; ; guard++) {
    if (guard > 40_000) throw new Error('не нашлось дождя после погожего дня — кольцо погод поменяли?');
    const fits =
      weatherAt(rainStart + 1) === 'rain' &&
      weatherAt(rainStart - 1) !== 'rain' &&
      !isNight(rainStart - OMEN_MS) &&
      !isNight(rainStart + 20_000) &&
      noWolves(rainStart - OMEN_MS, rainStart + 25_000);
    if (fits) break;
    rainStart += SPELL_MS;
  }
  await into(rainStart - 22_000);
  const omen = await state();
  step('перед дождём небо хмурится', omen.weather === 'хмурится', `за ${num((rainStart - pageNow()) / 1000)} с до дождя: «${omen.weather}»`);
  await shoot('4а-хмурится');
  while (pageNow() < rainStart + 3000) await sleep(250);
  const wet = await state();
  step('дождь: льёт и сказано словом', wet.weather === 'дождь', `погода: «${wet.weather}», костёр ${wet.words}`);
  await measure('дождь');
  await shoot('4-дождь');

  const snow = moment(Date.now() + 10_000, 35_000, (t) => weatherAt(t) === 'snow' && !isNight(t) && packAt(t, 0) === 0);
  await into(snow);
  await sleep(2600);
  const cold = await state();
  step('снег: идёт и сказано словом', cold.weather === 'снег', `погода: «${cold.weather}»`);
  await measure('снег');
  await shoot('5-снег');

  // ---------- 5. Ремесло ----------
  //
  // Числа — из тех же формул, что у игры: сколько дров уходит на сутки отлучки
  // раздетым под небом и одетым в доме, и через сколько дней дом окупает свои
  // брёвна. Потом тем же настоящим касанием: шкура, одежда, стрелы, стройка.
  console.log('\n5. Ремесло: дом, одежда, стрелы\n');
  const perVisit = TREES.length * TREE_LOGS;
  const hearthDay = Math.ceil((24 * H * BURN_MEAN) / LOG_MS);
  const roastLogs = DEER_MEAT * ROAST_COST;
  const toHouse = perVisit - hearthDay - roastLogs;
  /** «бревно», «бревна», «брёвен» — по числу. */
  const logWord = (n: number): string => {
    const d = n % 10;
    const h = n % 100;
    if (d === 1 && h !== 11) return 'бревно';
    if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return 'бревна';
    return 'брёвен';
  };
  row('дом', `${HOUSE_LOGS} ${logWord(HOUSE_LOGS)}`, `${HOUSE_STAGES} ступеней по ${HOUSE_PER_STAGE}; укрывает только достроенный`);
  row('в дом за заход', `${toHouse} ${logWord(toHouse)}`, `${perVisit} с поляны − ${hearthDay} на очаг на сутки − ${roastLogs} на жарку оленя`);
  row('заходов на дом', num(HOUSE_LOGS / toHouse, 1), `быстрее двух не выйдет: на поляне ${perVisit} ${logWord(perVisit)}, лес отрастает за ${REGROW_MS / H} ч`);
  row('одежда', `тепло уходит ×${COAT_CHILL}`, 'одна шкура: снимают с разделанной туши, шьют у палатки');
  row('стрелы', `${ARROWS_PER_LOG} из полена`, `колчан до ${QUIVER_MAX}; строгают у колоды`);
  const kinds: [string, Partial<Body>][] = [
    ['под небом раздетым', {}],
    ['под небом одетым', { coat: true }],
    ['в доме раздетым', { roof: true }],
    ['в доме одетым', { roof: true, coat: true }],
  ];
  /** Без огня до смерти и до пустой полосы тепла — в среднем по кольцу. */
  const noFire = (over: Partial<Body>): { dead: number; warmth: number } => {
    let dead = 0;
    let warmth = 0;
    let n = 0;
    for (let t0 = 0; t0 < RING_MS; t0 += 20_000, n++) {
      const b = { ...newBody(t0), warm: false, ...over };
      dead += deadAt(b, { fuel: 0, at: t0 }) - t0;
      warmth += coldEmptyAt(b, { fuel: 0, at: t0 }) - t0;
    }
    return { dead: dead / n, warmth: warmth / n };
  };
  /**
   * Сколько дров оставить в очаге, чтобы отлучка в `hours` не убила: среднее и худшее по кольцу.
   *
   * Мерка — двое суток, а не сутки, и не по вкусу: сутки теперь переживаются вовсе без
   * огня (тепла на сутки), и «дров на сутки» стало нулём у всех. Двое суток — полный
   * живот; дольше отлучка упирается уже в голод, а не в дрова.
   */
  const AWAY_H = 48;
  const awayLogs = (hours: number, over: Partial<Body>, kept = false): { mean: number; worst: number } => {
    let sum = 0;
    let worst = 0;
    let n = 0;
    for (let t0 = 0; t0 < RING_MS; t0 += 20_000, n++) {
      const lives = (f: number): boolean =>
        deadAt({ ...newBody(t0), ...over }, { fuel: f, at: t0, ...(kept ? { kept: true } : {}) }) - t0 >= hours * H;
      if (lives(0)) continue;
      let lo = 0;
      let hi = HEARTH_CAP;
      for (let i = 0; i < 32; i++) {
        const mid = (lo + hi) / 2;
        if (lives(mid)) hi = mid;
        else lo = mid;
      }
      sum += hi;
      worst = Math.max(worst, hi);
    }
    return { mean: sum / n, worst };
  };
  console.log('');
  const days: number[] = [];
  for (const [name, over] of kinds) {
    const logs = awayLogs(AWAY_H, over);
    const bare = noFire(over);
    days.push(logs.mean);
    row(name, `без огня ${num(bare.dead / H)} ч`, `тепла ${num(bare.warmth / H)} ч; дров на двое суток отлучки ${num(logs.mean, 2)} в среднем, ${num(logs.worst, 2)} в худший час`);
  }
  const saved = days[0] - days[3];
  row(
    'сбережение дома с одеждой',
    `${num(saved, 2)} полена на двое суток`,
    saved > 0 ? `дом окупает свои ${HOUSE_LOGS} ${logWord(HOUSE_LOGS)} за ${num(HOUSE_LOGS / saved, 0)} отлучек на двое суток` : 'дровами дом не окупается вовсе',
  );
  console.log('');

  const dayWindow = (span: number): number =>
    moment(Date.now() + 10_000, span, (t) => !isNight(t) && weatherAt(t) === 'clear' && packAt(t, 0) === 0);
  const HIDE_AT = { x: 2.0, z: -3.4 };
  await into(dayWindow(75_000), { logs: 13, fuel: HEARTH_CAP, hunt: { carcass: { ...HIDE_AT, taken: DEER_MEAT, skinned: false } } }, false);
  const craftFrom = Date.now();
  if (await walkTo(HIDE_AT.x, HIDE_AT.z, 'Снять шкуру')) {
    await tap(190, 400);
    await sleep(BUTCHER_WAIT);
  }
  const skinned = await state();
  const carcassLeft = await tab.eval<{ x: number; z: number } | null>('window.__probe.carcass()');
  step('с разделанной туши снята шкура', skinned.hides === 1, `шкур в руках ${skinned.hides}, туша ${carcassLeft ? 'лежит' : 'ушла'}`);
  if (await walkTo(TENT.x, TENT.z, 'Сшить одежду')) await tap(190, 400);
  const sewn = await state();
  step('у палатки сшита одежда', sewn.coat === true && sewn.hides === 0, `одет: ${sewn.coat ? 'да' : 'нет'}, шкур ${sewn.hides}`);
  const logsBefore = sewn.logs as unknown as number;
  if (await walkTo(AXE_STUMP.x, AXE_STUMP.z, 'Строгать стрелы')) await tap(190, 400);
  const carved = await state();
  step(
    'у колоды выстроганы стрелы',
    carved.quiver === ARROWS_START + ARROWS_PER_LOG && carved.logs === logsBefore - 1,
    `стрел ${carved.quiver} (было ${ARROWS_START}), дров ${carved.logs} (было ${logsBefore})`,
  );
  if (await walkTo(HOUSE.x, HOUSE.z, 'Ставить дом')) await tap(190, 400);
  const built = await state();
  step('брёвна легли в дом ровно по счёту', built.house === carved.logs && built.logs === 0, `в доме ${built.house}, в руках ${built.logs}`);
  console.log(`\n  Шкура, одежда, стрелы и первая стройка заняли ${num((Date.now() - craftFrom) / 1000, 0)} с настоящими часами.\n`);
  await turnTo(HOUSE.x, HOUSE.z);
  await shoot(`6-стройка-${built.house}`);

  /** Дойти до точки, не глядя на надписи: снимку нужен вид, а не дело. */
  const goTo = async (tx: number, tz: number): Promise<void> => {
    for (let i = 0; i < 12; i++) {
      const now = await state();
      const d = Math.hypot(tx - (now.x as unknown as number), tz - (now.z as unknown as number));
      if (d < 0.7) return;
      await turnTo(tx, tz);
      await walk(Math.min(640, d * 260));
    }
  };

  // Ступени стройки — глазами, с шести метров лицом к дому: с места входа сруб
  // стоит в двух шагах и закрывает собой весь кадр — так вышло с первого
  // снимка. Замер кадра — у достроенного: это самая тяжёлая поляна ремесла.
  const VIEW = { x: 1.4, z: 5.2 };
  for (const logs of SHOTS ? [0, HOUSE_PER_STAGE * 2, HOUSE_PER_STAGE * 4, HOUSE_LOGS] : [HOUSE_LOGS]) {
    // Дом «достроен» через полчаса: гостья этого раздела не касается, и замер
    // дома в кадре обязан остаться сравнимым с прошлыми — без женщины у огня.
    await into(dayWindow(45_000), { house: logs, builtAgo: -30 * 60_000 }, false);
    await goTo(VIEW.x, VIEW.z);
    await turnTo(HOUSE.x, HOUSE.z);
    if (logs === HOUSE_LOGS) await measure('день, дом в кадре');
    await shoot(`6-дом-${logs}`);
  }
  let under = false;
  for (let i = 0; i < 14 && !under; i++) {
    const now = await state();
    if (now.roof === true) {
      under = true;
      break;
    }
    await turnTo(HOUSE.x, HOUSE.z);
    await walk(300);
  }
  step('в достроенном доме — под крышей', under, under ? 'дошёл до сруба, крыша над головой' : 'до крыши не дошёл');

  if (SHOTS) {
    // Вещи полные: всё, что бывает разом, одежда надета, человек ранен — мясо в
    // окне съедобно. Потом вещи пустые — у поляны, где ещё ничего не взято.
    await into(
      dayWindow(40_000),
      {
        logs: 12,
        hides: 1,
        quiver: 5,
        arrows: [{ x: 3, z: 3 }, { x: -2, z: 5 }],
        meat: { cooked: 3, raw: 6 },
        body: { hunger: 0.35, cold: 0.1, harm: 2, coat: true },
      },
      false,
    );
    // Подсказку снимает взгляд, а не тап: короткий сдвиг пальца засчитался бы
    // тапом и пожарил бы мясо у костра — так и вышло с первого снимка.
    await look(40);
    await pressSel('.pro-pack');
    await shoot('7-вещи-полно');
    await into(dayWindow(40_000), { axe: false, kit: false, quiver: 0, meat: { cooked: 0, raw: 0 } }, false);
    await look(40);
    await pressSel('.pro-pack');
    await shoot('7б-вещи-пусто');
    // Три нужды в беде разом, на снегу: тепла нет, здоровье тает, живот почти пуст.
    await into(dayWindow(40_000), { fuel: 0, body: { hunger: 0.9, cold: 1, harm: 2 } }, false);
    await look(40);
    await shoot('7в-полосы-беда');
  }
  // Смерть от холода: запись замёрзшего — экран называет причину словами.
  await into(dayWindow(20_000), { fuel: 0, body: { hunger: 0.3, cold: 1, harm: WOLF_BITES } }, false);
  const frozen = await state();
  step('смерть от холода: экран называет причину', frozen.dead === 'cold', `причина: ${frozen.dead || 'жив'}`);
  await shoot('8-смерть-холод');

  // ---------- 6. Род ----------
  //
  // Числа — из тех же констант и формул, что у игры. Потом тем же настоящим
  // касанием: гостья выходит к достроенному дому, отказ, другая через сутки
  // поляны, согласие, мясо, дрова в общий очаг, объятие, ночь дома, имя сына с
  // поднятой клавиатурой и родословная на каждой из трёх ступеней.
  console.log('\n6. Род: гостья, жена, любовь, имя сына\n');
  let keptSum = 0;
  let plainSum = 0;
  let ringN = 0;
  for (let t0 = 0; t0 < RING_MS; t0 += 20_000, ringN++) {
    keptSum += burnLeftMs({ fuel: HEARTH_CAP, at: t0, kept: true }, t0);
    plainSum += burnLeftMs({ fuel: HEARTH_CAP, at: t0 }, t0);
  }
  row('первая гостья', `через ${GUEST_FIRST_MS / 1000} с`, 'после последнего бревна; ждёт у огня, пока не ответят');
  row('после отказа', `через ${clockWords(GUEST_GAP_MS)}`, `сутки поляны; гостий по кругу ${GUESTS.length}`);
  row('хозяйка бережёт огонь', `горит ×${num(KEEP_BURN, 3)}`, `= 1 / ${num(BURN_MEAN, 3)}; полный очаг в среднем ${num(keptSum / ringN / H)} ч вместо ${num(plainSum / ringN / H)}`);
  const homeOwn = awayLogs(AWAY_H, { roof: true });
  const homeKept = awayLogs(AWAY_H, { roof: true }, true);
  const skyOwn = awayLogs(AWAY_H, {});
  const skyKept = awayLogs(AWAY_H, {}, true);
  row('дров на двое суток: под небом раздетым', `${num(skyKept.mean, 2)} с хозяйкой`, `без неё ${num(skyOwn.mean, 2)}`);
  row('дров на двое суток: в доме раздетым', `${num(homeKept.mean, 2)} с хозяйкой`, `без неё ${num(homeOwn.mean, 2)}`);
  // Путь до ста — тем же прогоном, что держит тест: заход в четыре минуты с каждой
  // секунды суток поляны, в котором сделано всё, что можно засчитать.
  const loveDays = Math.ceil(LOVE_FULL / LOVE_STEP);
  let bestSession = 0;
  for (let s0 = 0; s0 < SKY_MS; s0 += 1_000) {
    const span = 4 * 60_000;
    const touched = dayOf(s0 + span - 1) - dayOf(s0) + 1;
    let nights = 0;
    for (let c = dayOf(s0) - 1; c <= dayOf(s0 + span) + 1; c++) {
      if (c * SKY_MS + DAY_SHARE * SKY_MS < s0 + span && (c + 1) * SKY_MS > s0) nights++;
    }
    bestSession = Math.max(bestSession, touched * 3 + nights);
  }
  row('любовь', `${LOVE_STEP} за день дела`, `до ${LOVE_FULL} — ${loveDays} дней; дело идёт в счёт не больше ${LOVE_DAYS} дней`);
  row('заходов до ста', `от ${Math.ceil(loveDays / bestSession)}, обычно ${loveDays / BOND_KINDS.length}`, `заход в 4 мин даёт до ${bestSession} дней, обычно ${BOND_KINDS.length}`);
  row('имя сына', `${HEIR_MIN}–${HEIR_MAX} букв`, 'лежит в tribe.prologue.v1 → heir.name');
  console.log('');

  const mateAt = (): Promise<{ x: number; z: number } | null> => tab.eval('window.__probe.mate()');
  const field = (): Promise<Field> => tab.eval('window.__probe.field()');
  const onDisk = (): Promise<{ refusedAt?: number; heir?: { name?: string } }> => tab.eval('window.__probe.saved()');
  const veil = async (): Promise<{ veil: number; heart: number }> =>
    (await tab.eval<{ veil: number; heart: number } | null>('window.__probe.veil()')) ?? { veil: 0, heart: 0 };

  /** Нажать узел надстройки пальцем — касанием в его середину, а не вызовом. */
  const tapBox = async (sel: string, id = 5): Promise<boolean> => {
    const box = await tab.eval<{ x: number; y: number } | null>(`window.__probe.box(${JSON.stringify(sel)})`);
    if (!box) return false;
    await send('touchStart', [{ id, x: box.x, y: box.y }]);
    await sleep(80);
    await send('touchEnd', []);
    await sleep(180);
    return true;
  };

  /** Ждать, пока условие не станет правдой, но не дольше срока. */
  const waitFor = async (ok: () => Promise<boolean>, ms: number): Promise<boolean> => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (await ok()) return true;
      await sleep(40);
    }
    return ok();
  };

  /** Снимок как есть, без смены экрана: объятие и клавиатура не ждут пересборки холста. */
  const capture = async (name: string): Promise<void> => {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    const shot = await tab.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(shot.data, 'base64'));
  };

  /** Перезагрузить, не стирая записи, — вернуться на ту же поляну в новую минуту. */
  const reopen = async (): Promise<void> => {
    await tab.send('Page.reload');
    for (let i = 0; ; i++) {
      await sleep(300);
      if (await tab.eval<boolean>("JSON.stringify(!!document.querySelector('.start-alt'))")) break;
      if (i > 100) throw new Error('стартовый экран не поднялся за 30 с');
    }
    await enter();
    await screen(SCREENS[0]);
    await sleep(700);
  };

  /** Подойти к жене и заговорить. */
  const openTalk = async (want: string): Promise<boolean> => {
    const m = await mateAt();
    if (!m || !(await walkTo(m.x, m.z, 'Говорить'))) return false;
    await tap(190, 400);
    return (await state()).panel === want;
  };

  /** Буква с клавиатуры — настоящим событием клавиши, как палец по кнопке ПК. */
  const typeKey = async (ch: string): Promise<void> => {
    const code = ch === ' ' ? 'Space' : `Key${ch.toUpperCase()}`;
    const vk = ch === ' ' ? 32 : ch.toUpperCase().charCodeAt(0);
    await tab.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, code, text: ch, unmodifiedText: ch, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await tab.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await sleep(40);
  };

  /** Заменить всё, что в поле: выделить и напечатать поверх (пусто — стереть). */
  const setField = async (text: string): Promise<void> => {
    await tab.eval<string>("(() => { const i = document.querySelector('.pro-name input'); if (i) { i.focus(); i.select(); } return JSON.stringify('ok'); })()");
    if (text) {
      await tab.send('Input.insertText', { text });
    } else {
      await tab.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
      await tab.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
    }
    await sleep(150);
  };

  const clearDay = (t: number): boolean => !isNight(t) && weatherAt(t) === 'clear' && packAt(t, 0) === 0;

  // Приход: дом достроен за четыре секунды до положенного — гостья выходит при человеке.
  await into(dayWindow(80_000), { house: HOUSE_LOGS, builtAgo: GUEST_FIRST_MS - 4_000, fuel: 6, logs: 2 }, false);
  const came = await waitFor(async () => (await state()).mate === 'guest', 9_000);
  const arrival = await state();
  step('к достроенному дому вышла женщина', came && String(arrival.note).includes('вышла'), `у огня: ${arrival.mate || 'никого'}; строка: «${arrival.note}»`);
  if (SHOTS) {
    await turnTo(GUEST_FROM.x, GUEST_FROM.z);
    await shoot('8а-приход');
  }
  const reachedFire = await waitFor(async () => {
    const m = await mateAt();
    return !!m && Math.hypot(m.x - MATE_SPOT.x, m.z - MATE_SPOT.z) < 0.1;
  }, 16_000);
  const walked = await mateAt();
  step('дошла от опушки до огня', reachedFire, walked ? `стоит в ${num(Math.hypot(walked.x - MATE_SPOT.x, walked.z - MATE_SPOT.z), 2)} м от своего места у очага` : 'пропала');

  // Родословная до жены.
  if (await walkTo(HOUSE.x, HOUSE.z, 'Родословная')) await tap(190, 400);
  const kin1 = await state();
  step('родословная до жены: один человек', kin1.panel === 'kin' && kin1.lineage === 1, `карточка: ${kin1.panel || 'нет'}, строк ${kin1.lineage}`);
  await shoot('12-род-1');
  await tapBox('.pro-card .pro-x');

  // Разговор с гостьей и отказ.
  const asked = (await openTalk('guest')) ? await state() : await state();
  const guestCard = await tab.eval<string>("JSON.stringify(document.querySelector('.pro-card') ? document.querySelector('.pro-card').textContent : '')");
  step(
    'тап по гостье открыл разговор, и беда сказана словами',
    asked.panel === 'guest' && guestCard.includes(GUESTS[0].name) && guestCard.includes('Пустишь'),
    `карточка: ${asked.panel || 'нет'}; «${String(asked.mateSays).slice(0, 44)}…»`,
  );
  await shoot('9-гостья');
  await tapBox('.pro-card .pro-row .pro-btn:not(.main)');
  const refusedNow = await state();
  step(
    'отказ: ушла, и сказано её словами',
    refusedNow.refused === 1 && refusedNow.mate === '' && refusedNow.panel === '' && String(refusedNow.note).includes('пойду дальше'),
    `отказов ${refusedNow.refused}, у огня ${refusedNow.mate || 'никого'}; «${refusedNow.note}»`,
  );

  // Отказ — не тупик: та же запись, минута через сутки поляны.
  const rec = await onDisk();
  await clock(moment((rec.refusedAt ?? 0) + GUEST_GAP_MS + 2_000, 70_000, clearDay) + 1_500);
  await reopen();
  const other = await state();
  step(
    'отказ не тупик: через сутки поляны пришла другая',
    other.mate === 'guest' && other.mateName === GUESTS[1].name,
    `у огня ${other.mateName || 'никого'}, ушла ${GUESTS[0].name}`,
  );

  // Согласие.
  if (await openTalk('guest')) await tapBox('.pro-card .pro-row .pro-btn.main');
  const wedNow = await state();
  step(
    'согласие: жена в доме, и очаг бережёт она',
    wedNow.wife === GUESTS[1].name && wedNow.kept === true && wedNow.panel === 'wife',
    `жена ${wedNow.wife || 'нет'}, очаг ${wedNow.kept ? 'бережёт' : 'НЕ бережёт'}; «${wedNow.mateSays}»`,
  );
  await shoot('10-жена');

  // Мясо, потом дрова в общий очаг.
  await tapBox('.pro-card .pro-row .pro-btn:not(.main)');
  const shared = await state();
  step(
    'дать мясо: разделённая еда засчитана один раз за сутки',
    shared.love === LOVE_STEP && shared.giveCan === false && shared.giveWhy === 'Сегодня уже ели вместе',
    `любовь ${shared.love}; «${shared.give}» — ${shared.giveWhy || 'можно'}`,
  );
  await tapBox('.pro-card .pro-x');
  if (await walkTo(0, 0, 'Подложить')) await tap(190, 300);
  const woodNow = await state();
  step('дрова в общий очаг засчитаны', woodNow.love === LOVE_STEP * 2 && woodNow.logs === 0, `любовь ${woodNow.love}, дров в руках ${woodNow.logs}`);

  // Объятие: взгляд под крышу и вверх, знак, обычный вид — там же, где стоял.
  let pitchTop = 0;
  let heartTop = 0;
  let inside = 0;
  const hugFrom = (await openTalk('wife')) ? await state() : null;
  if (hugFrom) {
    await tapBox('.pro-card .pro-row .pro-btn.main');
    const t0 = Date.now();
    while (Date.now() - t0 < 5_000) {
      const k = await state();
      const v = await veil();
      pitchTop = Math.max(pitchTop, k.camPitch as unknown as number);
      heartTop = Math.max(heartTop, v.heart);
      if (Math.abs((k.camY as unknown as number) - 1.2) < 0.01) inside++;
      if (!k.hugging && Date.now() - t0 > 600) break;
      await sleep(30);
    }
  }
  const hugAfter = await state();
  step('объятие: камера ушла под крышу и вверх, знак встал', !!hugFrom && pitchTop > 0.7 && heartTop > 0.9 && inside > 0, `взгляд до ${num((pitchTop * 180) / Math.PI, 0)}°, знак ${num(heartTop, 2)}, кадров под крышей в выборке ${inside}`);
  step(
    'после объятия — обычный вид там же, где стоял',
    !!hugFrom && !hugAfter.hugging && hugAfter.x === hugFrom.x && hugAfter.z === hugFrom.z && hugAfter.yaw === hugFrom.yaw && Math.abs((hugAfter.camY as unknown as number) - 1.62) < 0.05,
    `глаза на ${num(hugAfter.camY as unknown as number, 2)} м, человек ${hugFrom && hugAfter.x === hugFrom.x && hugAfter.z === hugFrom.z ? 'не сдвинулся' : 'СДВИНУЛСЯ'}`,
  );
  step('объятие засчитано', hugAfter.love === LOVE_STEP * 3, `любовь ${hugAfter.love}`);
  for (const s of SHOTS ? SHOT_SIZES : []) {
    await screen({ w: s.w, h: s.h, dpr: 2, mobile: true });
    await sleep(900);
    if (!(await openTalk('wife'))) continue;
    await tapBox('.pro-card .pro-row .pro-btn.main');
    if (await waitFor(async () => (await veil()).heart > 0.95, 3_000)) await capture(`11-объятие-${s.w}`);
    await waitFor(async () => !(await state()).hugging, 4_000);
  }
  await screen(SCREENS[0]);
  await sleep(500);

  // Родословная после согласия.
  if (await walkTo(HOUSE.x, HOUSE.z, 'Родословная')) await tap(190, 400);
  const kin2 = await state();
  step('родословная после согласия: ты и жена', kin2.panel === 'kin' && kin2.lineage === 2, `карточка: ${kin2.panel || 'нет'}, строк ${kin2.lineage}`);
  await shoot('12-род-2');
  await tapBox('.pro-card .pro-x');

  // Ночь застала дома: вход ночью на ту же поляну — у огня, где встаёт человек.
  const wedSave = { house: HOUSE_LOGS, builtAgo: H, wife: { name: GUESTS[1].name, at: 1 }, kept: true };
  await into(moment(Date.now() + 10_000, 20_000, (t) => isNight(t)), wedSave, false);
  const nightKept = await waitFor(async () => (await state()).nights === 1, 3_000);
  const nightNow = await state();
  step('ночь застала дома — засчитана', nightKept && nightNow.love === LOVE_STEP, `ночей ${nightNow.nights}, любовь ${nightNow.love}`);

  // Имя сына: любовь уже на ста — жена спрашивает сама.
  const fullBond = { meal: { n: LOVE_DAYS, day: 0 }, hug: { n: LOVE_DAYS, day: 0 }, night: { n: 6, day: 0 }, wood: { n: 0, day: -1 } };
  await into(dayWindow(100_000), { ...wedSave, bond: fullBond }, false);
  const ask = (await openTalk('name')) ? await state() : await state();
  step('любовь дошла до ста — спрашивает, как назвать сына', ask.panel === 'name' && ask.love === LOVE_FULL, `карточка ${ask.panel || 'нет'}, любовь ${ask.love}; «${ask.mateSays}»`);
  await shoot('13-имя');
  await tapBox('.pro-name input', 6);
  const focus = await field();
  step('поле имени берёт фокус касанием', focus.focused, `в фокусе: ${focus.focused ? 'поле' : 'НЕ поле'}`);

  const still = await state();
  for (const ch of ['w', 'a', 's', 'd', ' ', 'e', 'f']) await typeKey(ch);
  await sleep(300);
  const moved = await state();
  const typed = await field();
  step(
    'W, A, S, D, пробел, E и F — буквы, а не шаг, действие и лук',
    typed.value === 'wasd ef' && moved.x === still.x && moved.z === still.z && moved.yaw === still.yaw && !moved.drawn,
    `в поле «${typed.value}», человек ${moved.x === still.x && moved.z === still.z ? 'на месте' : 'СДВИНУЛСЯ'}, лук ${moved.drawn ? 'НАТЯНУТ' : 'опущен'}`,
  );
  await setField('123');
  const junk = await field();
  await setField('');
  const blank = await field();
  step(
    'пустое и мусор не принимаются, и сказано почему',
    junk.disabled && junk.why === 'Только буквы' && blank.disabled && blank.why === 'Впиши имя',
    `«123» — ${junk.why || 'ПРИНЯТО'}; пусто — ${blank.why || 'ПРИНЯТО'}`,
  );
  await setField('ратибор');

  // Клавиатура, сжимающая окно (Android): вьюпорт едет двумя десятками кадров и по
  // дороге проскакивает высоту 66 px — так его и отдавал Телеграм.
  const kb = (h: number): number => Math.round(h * KEYBOARD_SHARE);
  const frames: number[] = [];
  for (let i = 1; i <= 20; i++) frames.push(Math.round(812 - (kb(812) * i) / 20));
  frames.splice(2, 0, 66);
  let jumps = 0;
  for (const h of frames) {
    await tab.send('Emulation.setDeviceMetricsOverride', { width: 375, height: h, deviceScaleFactor: 2, mobile: true });
    await sleep(24);
    const f = await field();
    if (f.scroll !== 0 || f.vvTop !== 0) jumps++;
  }
  await sleep(400);
  const squeezed = await field();
  step(
    'окно сжалось под клавиатуру — поле видно, страница на месте',
    squeezed.focused && squeezed.cardTop >= 0 && squeezed.bottom <= 812 - kb(812) - 8 && squeezed.scroll === 0 && jumps === 0 && squeezed.value === 'ратибор',
    `поле ${num(squeezed.top, 0)}–${num(squeezed.bottom, 0)} px в окне ${squeezed.inner}; сдвигов страницы ${jumps} за ${frames.length} кадров вьюпорта`,
  );
  await capture('13-имя-клавиатура-сжато-375');
  if (SHOTS) {
    await tab.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780 - kb(780), deviceScaleFactor: 2, mobile: true });
    await sleep(600);
    await capture('13-имя-клавиатура-сжато-360');
  }

  // Клавиатура поверх страницы (iOS): окно прежнее, нижние сорок процентов закрыты.
  const overlaid: string[] = [];
  let underKeyboard = false;
  for (const s of SHOT_SIZES) {
    await tab.send('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: 2, mobile: true });
    await sleep(600);
    await tab.eval<string>(
      `(() => { const k = document.createElement('div'); k.id = 'fake-kb'; k.textContent = 'клавиатура'; k.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:${kb(s.h)}px;background:#c9ccd1;color:#4a4d52;font:15px sans-serif;display:flex;align-items:center;justify-content:center;z-index:9999'; document.body.appendChild(k); return JSON.stringify('ok'); })()`,
    );
    const f = await field();
    if (!f.focused || f.bottom > s.h - kb(s.h) - 8 || f.scroll !== 0) underKeyboard = true;
    overlaid.push(`${s.w} px: низ поля ${num(f.bottom, 0)} при верхе клавиатуры ${s.h - kb(s.h)}`);
    await capture(`13б-имя-клавиатура-поверх-${s.w}`);
    await tab.eval<string>("(() => { const k = document.getElementById('fake-kb'); if (k) k.remove(); return JSON.stringify('ok'); })()");
  }
  step('клавиатура поверх — поле выше неё на 375 и на 360 px', !underKeyboard, overlaid.join('; '));
  await screen(SCREENS[0]);
  await sleep(500);

  await tapBox('.pro-name button[type=submit]');
  const named = await state();
  const record = await onDisk();
  const fieldGone = await field();
  step(
    'имя принято и лежит в записи: tribe.prologue.v1 → heir.name',
    named.heir === 'Ратибор' && record.heir?.name === 'Ратибор' && named.panel === '' && !fieldGone.here,
    `сын: ${named.heir || 'нет'}; в записи: ${record.heir?.name ?? 'нет'}; «${named.note}»`,
  );

  // Родословная после рождения.
  if (await walkTo(HOUSE.x, HOUSE.z, 'Родословная')) await tap(190, 400);
  const kin3 = await state();
  step('родословная после рождения: ты, жена и сын', kin3.panel === 'kin' && kin3.lineage === 3, `карточка: ${kin3.panel || 'нет'}, строк ${kin3.lineage}`);
  await shoot('14-род-3');
  await tapBox('.pro-card .pro-x');

  // Кадр: жена у очага в кадре — и объятие целиком, пока камера под крышей.
  await goTo(0.6, 2.6);
  await turnTo(MATE_SPOT.x, MATE_SPOT.z);
  await measure('день, жена у очага в кадре');
  if (await openTalk('wife')) {
    await tab.eval<string>('window.__probe.start()');
    await tapBox('.pro-card .pro-row .pro-btn.main');
    await waitFor(async () => !(await state()).hugging, 5_000);
    budget.push(['объятие, под крышей', await tab.eval<Frames>('window.__probe.stop()')]);
  }

  console.log('\n7. Бюджет кадра (настоящий WebGL, ANGLE)\n');
  console.log(
    `  ${pad('состояние', 28)} ${pad('кадров', 7)} ${pad('в секунду', 10)} ${pad('медиана', 8)} ${pad('p95', 7)} ${pad('худший', 7)} ${pad('вызовов', 8)} треугольников`,
  );
  for (const [name, f] of budget) {
    console.log(
      `  ${pad(name, 28)} ${pad(String(f.frames), 7)} ${pad(num(f.fps), 10)} ${pad(num(f.median, 2), 8)} ${pad(num(f.p95, 2), 7)} ${pad(num(f.worst, 2), 7)} ${pad(String(f.calls), 8)} ${f.triangles}`,
    );
  }
  console.log(
    `\n  Потолок самой машины (пустая страница): ${num(roof.fps)} в секунду, медиана ${num(roof.median, 2)} мс.`,
  );
  console.log('  Бюджет кадра при шестидесяти — 16.7 мс; поляна обязана держаться потолка, а не числа 60.');
  console.log(
    `  Память: деревня ${(heapVillage / 1048576).toFixed(1)} МБ, поляна ${(heapGlade / 1048576).toFixed(1)} МБ.`,
  );
  if (SHOTS) console.log(`  Снимки 375 и 360 px: ${SHOTS}`);

  if (clockId) await tab.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: clockId });
  tab.close();
}

void main();
