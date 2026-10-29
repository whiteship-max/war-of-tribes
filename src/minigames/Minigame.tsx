// Промысел: оболочка вокруг сцены — общий образец (docs/minigames.md, раздел 4). Начало — карточка цели, время, «до N»
// и цена; игра — отсчёт, счёт, подпись прицела; итог — что легло на склад и сколько энергии осталось.
//
// КАНВУ ЗАВОДИТ ЭФФЕКТ, А НЕ РАЗМЕТКА, и первой в обёртке (`prepend`) — по тем же причинам, что у предыстории
// (`prologue/Prologue.tsx`): отданный контекст WebGL элемент не отпускает, а холст, положенный последним, закрыл бы
// надстройку. Города под этим экраном нет вовсе: `App` не рисует `GameCanvas`, пока идёт промысел.
//
// В ПАРТИЮ ИДУТ ДВА ВЫЗОВА ОДНОЙ ДВЕРИ: «Начать» списывает энергию и пишет партию на диск сразу
// (`sim/minigames.beginMinigame`), итог кладёт добычу по выданному походу (`harvest`). Ушёл посреди игры — энергия
// потеряна, добычи нет, а следующий заход — уже в новую раскладку (решение владельца 04.10.2026). Числа на карточках —
// той же дверью (`minigameHaul`, `energyShown`), а не своей арифметикой (правило 18).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import './minigames.css';
import { probe } from '@/debug';
import { dec } from '@/game/num';
import { useGame } from '@/game/store';
import { RESOURCE_IDS, RESOURCE_META } from '@/game/constants';
import { dayPartAt, seasonOf } from '@/game/derived';
import { ENERGY_MAX, MINIGAME_BY_ID, MINIGAME_COST, type MinigameId } from '@/game/data/minigames';
import { beginMinigame, canPlay, energyReadyIn, harvest, minigameHaul, minigameSeed, type Harvest, type Haul, type Outing } from '@/game/sim/minigames';
import { overflowOf } from '@/game/sim/stockview';
import { askRoom } from '@/ui/room';
import { Icon } from '@/ui/icons/Icon';
import { DAY_PARTS } from '@/ui/icons/registry';
import { realSpanText } from '@/ui/parts/wait';
import { energyNow, useTrades } from '@/ui/trades';
import { BerriesPlay } from './berriesPlay';
import { HerdPlay } from './herdPlay';
import { BEASTS } from './herd';
import { PIN_DISTS } from './hunt';
import { GAME_SECONDS, HOUR_PART, HOUR_WORDS, LATE_SECONDS, hourOf, shareOf, type Hour, type Tally } from './rules';
import { LAST_TICKS, Stage, type Play, type StageView } from './stage';
import { LAYOUT_OF, ZONES, buttonSide } from './pad';
import { coverNow, homeWater, weatherNow } from '@/ui/parts/weather';
import type { Season } from '@/game/types';
import { watchContext } from '@/render/context';
import { freeTurn } from '@/orientation';
import { iconName } from '@/ui/icons/registry';

/** Что игре нужно знать о городе: сезон, погода, берег и пояс — на входе, один раз. */
interface Place {
  season: Season;
  /** Дождь погоды города, 0..1 (`weather.weatherNow`): рыбалке — круги на воде и шум. Вся погода — сцене (`Stage`). */
  rain: number;
  /** У воды: море в дне пути или река у города, и климатический пояс региона (`weather.homeWater`). */
  shore: 'river' | 'sea';
  zone: ReturnType<typeof homeWater>['zone'];
  /** Час города (`derived.dayPartAt` → `rules.hourOf`): свет промысла, клёв и чуткость оленя. */
  hour: Hour;
}

/**
 * Чем играть: «Ягоды» и «Скот» лежат в куске промыслов, «Охота» и «Рыбалка» — своими кусками (лук и олени; удочка,
 * вода и рыбы): их качает только «На охоту» и «К воде», а тот, кто ходит за ягодами, за них не платит
 * (docs/minigames.md, 13 и 17).
 */
const PLAYS: Record<MinigameId, (seed: number, place: Place) => Promise<Play>> = {
  berries: async (seed) => new BerriesPlay(seed),
  herd: async (seed) => new HerdPlay(seed),
  hunt: async (seed, p) => new (await import('./huntPlay')).HuntPlay(seed, p.hour),
  fish: async (seed, p) => new (await import('./fishPlay')).FishPlay(seed, { shore: p.shore, zone: p.zone, season: p.season, rain: p.rain, hour: p.hour }),
};

/** Килограммы с запятой и одной цифрой после неё: «2,4» — дробь одной дверью (`game/num.dec`). */
const kg = (grams: number): string => dec(grams / 1000, 1);

/** Сколько «Уйти» ждёт второго касания: столько же, сколько «Точно?» окна постройки (`next/Confirm`). */
const LEAVE_MS = 3000;

/**
 * Что считает игра — подписью счёта и итога; `bonus` — прибавка (серия и редкая добыча, `rules.Tally`), строкой итога,
 * если на поле её было можно взять.
 */
const TALLY_WORDS: Record<MinigameId, { short: (t: Tally) => string; done: (t: Tally) => string; bonus: (t: Tally) => string }> = {
  berries: { short: (t) => `Ягод ${t.got}`, done: (t) => `Собрано ${t.got} из ${t.total}`, bonus: (t) => `Сверху ягод ${t.bonus ?? 0} из ${t.bonusMax ?? 0}` },
  herd: {
    short: (t) => `Охапок ${t.got} из ${t.total}`,
    done: (t) => `Отдано охапок ${t.got} из ${t.total}`,
    bonus: (t) => ((t.bonus ?? 0) > 0 ? `Ягнёнок сыт, сверху ${t.bonus}` : 'Ягнёнок остался голодным'),
  },
  hunt: {
    short: (t) => `Оленей ${t.got} из ${t.total}`,
    done: (t) => `Добыто оленей ${t.got} из ${t.total}`,
    bonus: (t) => ((t.bonus ?? 0) > 0 ? `Белый олень добыт, сверху ${t.bonus}` : 'Белый олень ушёл'),
  },
  // Счёт рыбалки — граммы улова до цели (`fishing.Fishing.tally`): словами — килограммы.
  fish: {
    short: (t) => `Улов ${kg(t.got)} из ${kg(t.total)} кг`,
    done: (t) => `Улов ${kg(t.got)} из ${kg(t.total)} кг`,
    bonus: (t) => `Серия сверху ${kg(t.bonus ?? 0)} из ${kg(t.bonusMax ?? 0)} кг`,
  },
};

/**
 * Час на карточке начала: что он значит для этой игры. У «Рыбалки» и «Охоты» час — дело (клёв, чуткость оленя:
 * `fishing.HOUR_BITE`, `hunt.HOUR_EAR`), у «Ягод» и «Скота» — только свет.
 */
const HOUR_NOTE: Record<MinigameId, Record<Hour, string>> = {
  berries: { dawn: 'роса на кустах', day: 'солнце высоко', dusk: 'низкое солнце', night: 'светит луна' },
  herd: { dawn: 'стадо бодрое', day: 'солнце высоко', dusk: 'стадо ждёт корма', night: 'светит луна' },
  hunt: { dawn: 'олени смелы', day: 'олени чутки', dusk: 'олени смелы', night: 'темно, олени смелы' },
  fish: { dawn: 'клюёт бойко', day: 'клюёт лениво', dusk: 'клюёт бойко', night: 'клюёт вяло' },
};

/**
 * Подписи-указатели первого входа (слово владельца, этап 6): у пальца движения и у кнопки действия — что они делают.
 * Гаснут по делу — когда палец повели и кнопку нажали (`StageView.used`), — или по сроку (`COACH_MS`).
 */
export const COACH: Record<MinigameId, { pad: string; act: string }> = {
  berries: { pad: 'Веди пальцем — шаг и поворот', act: 'У куста жми — собрать' },
  herd: { pad: 'Веди пальцем — шаг и поворот', act: 'Жми у стога и у голодного' },
  hunt: { pad: 'Веди — поворот и шаг, с луком — прицел', act: 'Держи — тетива, отпусти — выстрел, уведи палец — отмена' },
  fish: { pad: 'Пальцем вбок — куда и удилище', act: 'Держи — замах, отпусти — заброс' },
};

/** Сколько подписи-указатели стоят, если игрок не тронул ни палец, ни кнопку. */
const COACH_MS = 12000;

/** Какие игры уже показывали подписи-указатели. Удобство одного устройства, как «как играть». */
const COACH_KEY = 'tribe.minigames.coach';

/** «15, 25 и 35» — числа списка словами, последнее через «и». */
const listWords = (xs: readonly number[]): string =>
  xs.length > 1 ? `${xs.slice(0, -1).join(', ')} и ${xs[xs.length - 1]}` : String(xs[0] ?? '');

/**
 * Итог игры строкой вкуса (docs/voice.md, 3 и 11): чем кончился выход — образом, под заголовком с числом. Ступень —
 * доля от предела той же функцией, что ушла в начисление (`shareOf`); пороги — середина и верх полосы итога.
 */
const VERDICT: Record<MinigameId, readonly [string, string, string, string]> = {
  berries: ['Корзины полны до краёв.', 'Корзины тяжелы, хоть и не доверху.', 'Ягоды больше в рот, чем в корзину.', 'Кусты до нас обобрали птицы.'],
  herd: ['Загон сыт и лёг в тени.', 'Сытые жуют, голодные ещё блеют.', 'В загоне блеют и мычат с голоду.', 'Стог цел, а скот голоден.'],
  hunt: ['Туши везут на волокушах. Ловчий доволен.', 'Мясо к столу есть.', 'Стрелы ушли в лес, олени — тоже.', 'Олени ушли целыми.'],
  fish: ['Садок полон, рыба бьётся в траве.', 'Хватит на уху и на засолку.', 'Клевало вяло, но на уху хватит.', 'Ни поклёвки. Вода сегодня пустая.'],
};

/** Ступень итога по доле от предела: верх, середина, малость, ничего. */
export const verdictOf = (game: MinigameId, share: number): string => {
  const v = VERDICT[game];
  if (share >= 0.8) return v[0];
  if (share >= 0.4) return v[1];
  if (share > 0) return v[2];
  return v[3];
};

/** Подсказка на первые секунды: где палец движения и где кнопка. */
const HINT: Record<MinigameId, string> = {
  berries: 'Слева шаг и поворот, справа кнопка',
  herd: 'Слева шаг и поворот, справа кнопка',
  hunt: 'Слева тетива, справа поворот и прицел',
  fish: 'Справа заброс, слева куда',
};

/**
 * Как играть — три строки на игру: управление, цель, хитрость. Карточка начала показывает их при первом входе в игру
 * сама, дальше — по кнопке «Как играть» (решение по правилу 19: подсказка на первые секунды, `HINT`, читается уже на
 * ходу, а правило игры — порядок ягод, охапки коровы, поправка дуги — должно быть прочитано до «Начать»).
 */
export const HOW: Record<MinigameId, readonly string[]> = {
  berries: [
    'Левый палец — шаг и поворот. У куста жми кнопку справа — он обобран целиком',
    'Сначала спелые кусты. Зелёная ягода пропадёт, а чистые кусты подряд дают ягоду сверху',
    'Ягоды зреют на глазах. Земляника редка, и каждая её ягода идёт вдвойне',
  ],
  herd: [
    'Левый палец — шаг и поворот, кнопка справа — взять и отдать охапку',
    'Жми у стога — возьмёшь охапку. Жми у голодного — он поест',
    `Овце и козе хватит охапки, корове надо ${BEASTS.cow.need}. Ягнёнок — вдвойне`,
  ],
  hunt: [
    'Левой держи «Натянуть», отпусти — выстрел. Пока олень щиплет траву, подкрадись',
    'Правый палец — поворот и шаг. С натянутым луком он ведёт прицел вверх и вниз',
    `Метки ${listWords(PIN_DISTS)} шагов — поправка на дальность. Белый олень — вдвойне`,
  ],
  fish: [
    'Держи «Заброс» справа — сила, отпусти — бросок. Левый палец вбок — куда. Мимо травы и коряг',
    'Поплавок дрожит — жди. Ушёл под воду — сразу «Подсечь»',
    'Держи «Тянуть», отпускай на рывке, пальцем вбок — удилище. Рыбы подряд — улов сверху',
  ],
};

/** Какие игры игрок уже открывал: подсказка «как играть» сама — только в первый раз. Удобство одного устройства. */
const HOW_KEY = 'tribe.minigames.how';

function howSeen(game: MinigameId): boolean {
  try {
    return (localStorage.getItem(HOW_KEY) ?? '').split(',').includes(game);
  } catch {
    return false;
  }
}

function coachSeen(game: MinigameId): boolean {
  try {
    return (localStorage.getItem(COACH_KEY) ?? '').split(',').includes(game);
  } catch {
    return false;
  }
}

function markCoach(game: MinigameId): void {
  try {
    const seen = new Set((localStorage.getItem(COACH_KEY) ?? '').split(',').filter(Boolean));
    seen.add(game);
    localStorage.setItem(COACH_KEY, [...seen].join(','));
  } catch {
    // Приватное окно без хранилища: подписи покажутся снова — не беда.
  }
}

function markHow(game: MinigameId): void {
  try {
    const seen = new Set((localStorage.getItem(HOW_KEY) ?? '').split(',').filter(Boolean));
    seen.add(game);
    localStorage.setItem(HOW_KEY, [...seen].join(','));
  } catch {
    // Приватное окно без хранилища: подсказка покажется снова — не беда.
  }
}

/** Подпись кнопки действия: глагол — первым словом крупно, что тронет — строкой ниже («Накормить» · «овцу»). */
export const actWords = (label: string): [string, string] => {
  const i = label.indexOf(' ');
  return i < 0 ? [label, ''] : [label.slice(0, i), label.slice(i + 1)];
};

/** Секунды отсчёта: «0:47». */
const clock = (left: number): string => `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;

function HaulRow({ haul }: { haul: Haul }) {
  return (
    <>
      {RESOURCE_IDS.filter((r) => haul[r]).map((r) => (
        <span key={r} className="mg-res" aria-label={RESOURCE_META[r].name}>
          <Icon name={iconName('res', r)} />
          {haul[r]}
        </span>
      ))}
    </>
  );
}

export function Minigame({ game, onExit }: { game: MinigameId; onExit: () => void }) {
  const def = MINIGAME_BY_ID[game];
  const wrapRef = useRef<HTMLDivElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const aimRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  // Поход, выданный на «Начать»: по нему итог кладёт добычу. Нет похода — «Начать» ещё не нажимали.
  const outingRef = useRef<Outing | null>(null);
  // Зерно и «до N» — на входе: раскладка не меняется посреди игры, что бы ни случилось с партией.
  const [seed] = useState(() => minigameSeed(useGame.getState().s, game));
  const [top] = useState(() => minigameHaul(useGame.getState().s, game, 1));
  // Заработки бродяги (ПН-6): добыча — золотом в кошель отряда, дверью куска пути (`useTrades.wage`).
  const [wage] = useState(() => useTrades.getState().wage);
  const [view, setView] = useState<StageView | null>(null);
  const [result, setResult] = useState<Harvest | string | null>(null);
  const [hint, setHint] = useState(true);
  const [how, setHow] = useState(() => !howSeen(game));
  // Подписи-указатели — при первом входе в игру; дальше — нет (`COACH_KEY`).
  const [coach, setCoach] = useState(() => !coachSeen(game));
  // Час — на входе, как зерно: свет и клёв не меняются посреди игры (`rules.hourOf`).
  const [hour] = useState<Hour>(() => hourOf(dayPartAt(useGame.getState().s.time)));
  const layout = LAYOUT_OF[game];
  const padSide = ZONES[layout].left === 'pad' ? 'left' : 'right';
  const actSide = buttonSide(layout);
  const [leave, setLeave] = useState(false);
  /**
   * Номер сборки сцены. Контекст WebGL умер и не вернулся в срок (`render/context.ts`): не начатая игра собирается
   * заново на новой канве, начатая кончается итогом по набранному (`Stage.abort`) — доиграть её нечем.
   */
  const [gen, setGen] = useState(0);
  const s = useGame((g) => g.s);
  const now = energyNow();
  const ready = canPlay(s, now);

  // Промысел — в любой ориентации (решение владельца 04.10.2026): закрепление вертикали снято, на выходе — снова.
  useEffect(() => freeTurn('промысел'), []);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'mg-canvas';
    wrap.prepend(canvas);
    // Сцена встаёт, когда приехала игра: «Ягоды» и «Скот» — сразу, «Охота» — своим куском. До того карточка начала
    // уже стоит, а «Начать» ждёт сцену (`stageRef`).
    let alive = true;
    let stage: Stage | null = null;
    let offContext: () => void = () => undefined;
    const drop = (): void => setHint(false);
    const onResize = (): void => stage?.resize();
    const ro = new ResizeObserver(onResize);
    const wire = (made: Stage): void => {
      stage = made;
      stageRef.current = made;
      made.onView = setView;
      made.meterEl = meterRef.current;
      made.aimEl = aimRef.current;
      // Время вышло — итог: добыча по походу, энергия списана ещё на «Начать».
      made.onEnd = (tally) => {
        const outing = outingRef.current;
        let out: Harvest | string = 'Добыча не засчитана';
        const g = useGame.getState();
        const ok = outing !== null && g.act((st) => {
          const r = wage ? wage.settle(st, outing, energyNow(), shareOf(tally)) : harvest(st, outing, energyNow(), shareOf(tally));
          if (typeof r === 'string') return r;
          out = r;
          return null;
        });
        if (ok) g.save();
        setResult(out);
      };
      setView(made.snapshot());
      if (probe()) (window as unknown as { __mini?: Stage }).__mini = made;
      offContext = watchContext(made.gl, () => {
        if (!made.abort()) setGen((n) => n + 1);
      });
    };
    const st0 = useGame.getState().s;
    const wx = weatherNow(st0);
    const place: Place = { season: seasonOf(st0.time), rain: wx.rain, ...homeWater(), hour };
    void PLAYS[game](seed, place).then((play) => {
      if (!alive) {
        play.dispose();
        return;
      }
      // Погода — города в эту минуту (`weather.weatherNow`), та же, что слышит фон: ветер в траве и кронах, тучи в свете,
      // дождь и снег осадками города, снег на земле и ветках — тот, что лежит у города (`coverNow`; `stage.gloomOf`,
      // docs/polish.md, П-4). Час города — свет промысла (`stage.solarOf`): сторона солнца та же, меняются высота и цвет.
      const stage = new Stage(canvas, play, GAME_SECONDS[game], place.season, wx, place.hour, coverNow(st0));
      stage.measureAs(game);
      wire(stage);
    });
    canvas.addEventListener('pointerdown', drop, { once: true });
    ro.observe(wrap);
    window.addEventListener('resize', onResize);
    return () => {
      alive = false;
      offContext();
      ro.disconnect();
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('pointerdown', drop);
      if (stage) {
        stage.onView = null;
        stage.onEnd = null;
        stage.attachPad(null);
        stage.meterEl = null;
        stage.aimEl = null;
        stage.dispose();
      }
      canvas.remove();
      stageRef.current = null;
    };
  }, [game, seed, gen, hour]);

  // Подписи-указатели стоят, пока палец и кнопку не тронули, но не дольше `COACH_MS` от «Начать».
  const playing = view?.phase === 'play';
  useEffect(() => {
    if (!playing || !coach) return;
    const t = setTimeout(() => setCoach(false), COACH_MS);
    return () => clearTimeout(t);
  }, [playing, coach]);

  // «Уйти» ждёт второго касания три секунды.
  useEffect(() => {
    if (!leave) return;
    const t = setTimeout(() => setLeave(false), LEAVE_MS);
    return () => clearTimeout(t);
  }, [leave]);

  /**
   * «Начать»: энергия списывается здесь и партия сразу ложится на диск — закрытое посреди игры приложение трату не
   * вернёт. Второе касание до перерисовки второго похода не выдаёт: поход уже есть.
   */
  const start = async (): Promise<void> => {
    if (!stageRef.current || outingRef.current) return;
    // Добыча полного счёта не влезет на склад — спросить до траты энергии (OWNER-DECISIONS, п. 1): добыча ложится сама,
    // когда выйдет время, и «Отмена» после игры сожгла бы энергию. «Отмена» здесь — энергия не тронута.
    if (!wage && !(await askRoom(overflowOf(useGame.getState().s, minigameHaul(useGame.getState().s, game, 1))))) return;
    const stage = stageRef.current;
    if (!stage || outingRef.current) return;
    const g = useGame.getState();
    const ok = g.act((st) => {
      const r = beginMinigame(st, game, energyNow());
      if (typeof r === 'string') return r;
      outingRef.current = r;
      return null;
    });
    if (!ok) return;
    g.save();
    markHow(game);
    markCoach(game);
    stage.begin();
  };

  const phase = view?.phase ?? 'brief';
  // Подписи-указатели ещё стоят: хоть палец, хоть кнопку игрок не трогал.
  const coaching = coach && !!view && (!view.used.pad || !view.used.act);
  const words = TALLY_WORDS[game];
  const meter = probe() || new URLSearchParams(window.location.search).has('fps');

  return (
    <div className="mg" ref={wrapRef}>
      {meter && <div className="mg-meter" ref={meterRef} />}
      {game === 'hunt' && (
        // Прицел лука: середина — куда уходит стрела, метки ниже — поправка дуги на дальность (их ставит сцена,
        // `Stage.aimSync`, числами `hunt.pins`). Стоит с первого кадра, чтобы сцена нашла его, — виден в игре.
        <div className={`mg-aim${phase === 'play' ? '' : ' off'}`} ref={aimRef} aria-hidden="true">
          <i className="mg-ring" />
          <i className="mg-dot" />
          {/* Попал — крест вспыхивает на прицеле и гаснет: отклик в том месте, куда смотрит глаз. */}
          {view?.note.startsWith('Попал') && <i className="mg-hit" />}
        </div>
      )}

      {game === 'fish' && (
        // Шкала удочки: сила заброса в замахе, натяжение лески на вываживании (`Play.gauge`, `Stage.aimSync`). Стоит с
        // первого кадра, чтобы сцена нашла её, — видна, когда есть что показать.
        <div className={`mg-aim mg-gauge${phase === 'play' ? '' : ' off'}`} ref={aimRef} aria-hidden="true" data-mode="none">
          <i className="mg-gauge-bar" />
          <i className="mg-gauge-red" />
        </div>
      )}

      {phase === 'play' && view && (
        <>
          <div className="mg-top">
            <span className={`mg-chip mg-clock${view.left <= LATE_SECONDS ? ' late' : ''}${view.left <= LAST_TICKS ? ' last' : ''}`} key={view.left <= LAST_TICKS ? view.left : 'clock'}>
              {clock(view.left)}
            </span>
            {/* Счёт прыгает на каждое очко: ключ — само число, анимация играет заново. */}
            <span className="mg-chip mg-score" key={`score-${view.tally.got}-${view.tally.bonus ?? 0}`}>
              <Icon name={iconName('mini', game)} />
              {words.short(view.tally)}
            </span>
            {view.aside && <span className="mg-chip">{view.aside}</span>}
            {/* Серия удач — с двух подряд: ключ — длина, ячейка прыгает на каждую удачу. */}
            {view.streak >= 2 && (
              <span className="mg-chip mg-streak" key={`streak-${view.streak}`}>
                Серия {view.streak}
              </span>
            )}
            <span className="mg-grow" />
            <button
              className={`mg-leave${leave ? ' armed' : ''}`}
              onClick={() => {
                if (!leave) return setLeave(true);
                onExit();
              }}
            >
              {leave ? 'Точно?' : 'Уйти'}
            </button>
          </div>
          {view.note && <div className="mg-note">{view.note}</div>}
          {/* Строка «что делать» и подсказка первых секунд — когда подписей-указателей уже нет: те стоят на её месте. */}
          {!coaching && <div className="mg-bottom">{view.cue ? <span className="mg-chip mg-verb">{view.cue}</span> : hint && <span className="mg-hint">{HINT[game]}</span>}</div>}
          {/*
            Руки (docs/minigames.md, 18.1, `pad.ts`): кружок пальца движения в своём углу и кнопка действия в другом.
            Оба — рисунок: касание ловит холст всей половиной (`pad.zoneAt`), а судит — сцена; кнопку под большим
            пальцем не ищут глазами.
          */}
          {/* Палец ведёт ручку этого кружка (`stage.attachPad`): второго кружка под пальцем нет (Г-12). */}
          <div className={`mg-pad ${padSide}`} ref={(el) => stageRef.current?.attachPad(el)} aria-hidden="true">
            <i />
          </div>
          <div className={`mg-act ${actSide}${view.act.ready ? '' : ' off'}${view.act.on ? ' on' : ''}${view.act.hold ? ' hold' : ''}`} aria-hidden="true">
            <b>{actWords(view.act.label)[0]}</b>
            {actWords(view.act.label)[1] && <small>{actWords(view.act.label)[1]}</small>}
          </div>
          {coaching && !view.used.pad && <div className={`mg-coach ${padSide}`}>{COACH[game].pad}</div>}
          {coaching && !view.used.act && <div className={`mg-coach ${actSide} act`}>{COACH[game].act}</div>}
        </>
      )}

      {phase === 'brief' && (
        <div className="mg-card" role="dialog" aria-label={def.name}>
          <div className="mg-head">
            <span className="mg-ico">
              <Icon name={iconName('mini', game)} />
            </span>
            <b>{def.name}</b>
          </div>
          <p>{def.goal}</p>
          <p className="mg-hour">
            <Icon name={DAY_PARTS[HOUR_PART[hour]].name} />
            {HOUR_WORDS[hour]} — {HOUR_NOTE[game][hour]}
          </p>
          {how ? (
            <ol className="mg-how" aria-label="Как играть">
              {HOW[game].map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          ) : (
            <button className="mg-howbtn" onClick={() => setHow(true)}>
              Как играть
            </button>
          )}
          <div className="mg-facts">
            <span className="mg-res" aria-label="Время">
              <Icon name="ui-time" />
              {realSpanText(GAME_SECONDS[game])}
            </span>
            <span className="mg-res mg-muted">до</span>
            {wage ? (
              <span className="mg-res" aria-label="Золото">
                <Icon name="res-gold" />
                {wage.top}
              </span>
            ) : (
              <HaulRow haul={top} />
            )}
            <span className="mg-res mg-muted" aria-label="Энергия">
              <Icon name="ui-energy" />
              {MINIGAME_COST}
            </span>
          </div>
          {!ready && <small className="mg-why">Энергии хватит через {realSpanText(Math.ceil(energyReadyIn(s, now) / 1000))}</small>}
          <div className="mg-actions">
            <button className="mg-back" onClick={onExit}>
              Назад
            </button>
            <button className="mg-go" disabled={!ready} onClick={() => void start()}>
              Начать
            </button>
          </div>
        </div>
      )}

      {phase === 'done' && view && (
        <div className="mg-card" role="dialog" aria-label="Итог">
          <div className="mg-head">
            <span className="mg-ico">
              <Icon name={iconName('mini', game)} />
            </span>
            <b>{words.done(view.tally)}</b>
          </div>
          <i className="mg-verdict">{verdictOf(game, shareOf(view.tally))}</i>
          {(view.tally.bonusMax ?? 0) > 0 && <small className="mg-muted">{words.bonus(view.tally)}</small>}
          {result && typeof result !== 'string' && (
            <>
              {/* Доля от предела — та же, что ушла в начисление (`shareOf` → `harvest`): полоса и число одной функцией. */}
              <div className="mg-share" aria-label="Доля от предела">
                <span className="mg-bar">
                  <i style={{ width: `${Math.round(shareOf(view.tally) * 100)}%` }} />
                </span>
                <span>Взято {Math.round(shareOf(view.tally) * 100)} % предела</span>
              </div>
              {'gold' in result ? (
                <div className="mg-facts">
                  <span className="mg-res mg-muted">В кошель</span>
                  <span className="mg-res" aria-label="Золото">
                    <Icon name="res-gold" />
                    {(result as { gold: number }).gold}
                  </span>
                </div>
              ) : (
                <>
                  <div className="mg-facts">
                    <span className="mg-res mg-muted">На склад</span>
                    {Object.keys(result.stored).length > 0 ? <HaulRow haul={result.stored} /> : <span className="mg-res">ничего</span>}
                  </div>
                  {RESOURCE_IDS.some((r) => (result.stored[r] ?? 0) < (result.got[r] ?? 0)) && <small className="mg-why">Склад полон, легло не всё</small>}
                </>
              )}
              <small className="mg-muted">
                Энергия {result.energy} из {ENERGY_MAX}
              </small>
            </>
          )}
          {typeof result === 'string' && <small className="mg-why">{result}</small>}
          <div className="mg-actions">
            <button className="mg-go" onClick={onExit}>
              {wage ? 'К отряду' : 'В город'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
