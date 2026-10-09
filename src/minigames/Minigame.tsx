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
import { seasonOf } from '@/game/derived';
import { ENERGY_MAX, MINIGAME_BY_ID, MINIGAME_COST, type MinigameId } from '@/game/data/minigames';
import { beginMinigame, canPlay, energyReadyIn, harvest, minigameHaul, minigameSeed, type Harvest, type Haul, type Outing } from '@/game/sim/minigames';
import { Icon } from '@/ui/icons/Icon';
import { realSpanText } from '@/ui/parts/wait';
import { energyNow } from '@/ui/trades';
import { BerriesPlay } from './berriesPlay';
import { HerdPlay } from './herdPlay';
import { GAME_SECONDS, LATE_SECONDS, shareOf, type Tally } from './rules';
import { LAST_TICKS, Stage, type Play, type StageView } from './stage';
import { homeWater, weatherNow } from '@/ui/parts/weather';
import type { Season } from '@/game/types';
import { watchContext } from '@/render/context';
import { freeTurn } from '@/orientation';

/** Что игре нужно знать о городе: сезон, погода, берег и пояс — на входе, один раз. */
interface Place {
  season: Season;
  /** Сила ветра и дождь погоды города, 0..1 (`weather.weatherNow`). */
  wind: number;
  rain: number;
  /** У воды: море в дне пути или река у города, и климатический пояс региона (`weather.homeWater`). */
  shore: 'river' | 'sea';
  zone: ReturnType<typeof homeWater>['zone'];
}

/**
 * Чем играть: «Ягоды» и «Скот» лежат в куске промыслов, «Охота» и «Рыбалка» — своими кусками (лук и олени; удочка,
 * вода и рыбы): их качает только «На охоту» и «К воде», а тот, кто ходит за ягодами, за них не платит
 * (docs/minigames.md, 13 и 17).
 */
const PLAYS: Record<MinigameId, (seed: number, place: Place) => Promise<Play>> = {
  berries: async (seed) => new BerriesPlay(seed),
  herd: async (seed) => new HerdPlay(seed),
  hunt: async (seed) => new (await import('./huntPlay')).HuntPlay(seed),
  fish: async (seed, p) => new (await import('./fishPlay')).FishPlay(seed, { shore: p.shore, zone: p.zone, season: p.season, rain: p.rain }),
};

/** Килограммы с запятой и одной цифрой после неё: «2,4» — дробь одной дверью (`game/num.dec`). */
const kg = (grams: number): string => dec(grams / 1000, 1);

/** Сколько «Уйти» ждёт второго касания: столько же, сколько «Точно?» окна постройки (`next/Confirm`). */
const LEAVE_MS = 3000;

/** Что считает игра — подписью счёта и итога. */
const TALLY_WORDS: Record<MinigameId, { short: (t: Tally) => string; done: (t: Tally) => string }> = {
  berries: { short: (t) => `Ягод ${t.got}`, done: (t) => `Собрано ${t.got} из ${t.total}` },
  herd: { short: (t) => `Охапок ${t.got} из ${t.total}`, done: (t) => `Отдано охапок ${t.got} из ${t.total}` },
  hunt: { short: (t) => `Оленей ${t.got} из ${t.total}`, done: (t) => `Добыто оленей ${t.got} из ${t.total}` },
  // Счёт рыбалки — граммы улова до цели (`fishing.Fishing.tally`): словами — килограммы.
  fish: { short: (t) => `Улов ${kg(t.got)} из ${kg(t.total)} кг`, done: (t) => `Улов ${kg(t.got)} из ${kg(t.total)} кг` },
};

/** Подсказка на первые секунды: как ходить и как держать лук. */
const HINT: Record<MinigameId, string> = {
  berries: 'Слева шаг, справа взгляд',
  herd: 'Слева шаг, справа взгляд',
  hunt: 'Справа прижми, веди и отпусти',
  fish: 'Тяни вниз и отпусти — заброс',
};

/**
 * Как играть — три строки на игру: управление, цель, хитрость. Карточка начала показывает их при первом входе в игру
 * сама, дальше — по кнопке «Как играть» (решение по правилу 19: подсказка на первые секунды, `HINT`, читается уже на
 * ходу, а правило игры — порядок ягод, охапки коровы, поправка дуги — должно быть прочитано до «Начать»).
 */
export const HOW: Record<MinigameId, readonly string[]> = {
  berries: [
    'Слева — шаг, справа — взгляд, нажатие у куста обирает его целиком',
    'Спелые — в корзину, зелёные пропадут: сначала спелые кусты',
    'Ягоды зреют на глазах — поздние оставь под конец минуты',
  ],
  herd: [
    'Слева — шаг, справа — взгляд',
    'У стога нажми — охапка в руках; у голодного — он ест',
    'Овце и козе — охапка, корове — три. Сытые ложатся',
  ],
  hunt: [
    'Слева — шаг: пока олень щиплет траву, к нему можно подкрасться',
    'Справа прижми — тянешь, веди — целишься, отпусти — выстрел',
    'Метки 15, 25 и 35 — поправка на дальность. Долго держишь — руки дрожат',
  ],
  fish: [
    'Тяни вниз — замах, веди вбок — куда, отпусти — заброс. В траву и корягу не бросай',
    'Дрожит поплавок — жди; утонул — жми сразу: это подсечка',
    'Держи — тянешь, отпусти на рывке — рыба берёт леску. Красная шкала — порвёт',
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

function markHow(game: MinigameId): void {
  try {
    const seen = new Set((localStorage.getItem(HOW_KEY) ?? '').split(',').filter(Boolean));
    seen.add(game);
    localStorage.setItem(HOW_KEY, [...seen].join(','));
  } catch {
    // Приватное окно без хранилища: подсказка покажется снова — не беда.
  }
}

/** Секунды отсчёта: «0:47». */
const clock = (left: number): string => `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;

function HaulRow({ haul }: { haul: Haul }) {
  return (
    <>
      {RESOURCE_IDS.filter((r) => haul[r]).map((r) => (
        <span key={r} className="mg-res" aria-label={RESOURCE_META[r].name}>
          <Icon name={`res-${r}`} glyph={RESOURCE_META[r].icon} />
          {haul[r]}
        </span>
      ))}
    </>
  );
}

export function Minigame({ game, onExit }: { game: MinigameId; onExit: () => void }) {
  const def = MINIGAME_BY_ID[game];
  const wrapRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef<HTMLDivElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const aimRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  // Поход, выданный на «Начать»: по нему итог кладёт добычу. Нет похода — «Начать» ещё не нажимали.
  const outingRef = useRef<Outing | null>(null);
  // Зерно и «до N» — на входе: раскладка не меняется посреди игры, что бы ни случилось с партией.
  const [seed] = useState(() => minigameSeed(useGame.getState().s, game));
  const [top] = useState(() => minigameHaul(useGame.getState().s, game, 1));
  const [view, setView] = useState<StageView | null>(null);
  const [result, setResult] = useState<Harvest | string | null>(null);
  const [hint, setHint] = useState(true);
  const [how, setHow] = useState(() => !howSeen(game));
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
      made.stickEl = stickRef.current;
      made.meterEl = meterRef.current;
      made.aimEl = aimRef.current;
      // Время вышло — итог: добыча по походу, энергия списана ещё на «Начать».
      made.onEnd = (tally) => {
        const outing = outingRef.current;
        let out: Harvest | string = 'Добыча не засчитана';
        const g = useGame.getState();
        const ok = outing !== null && g.act((st) => {
          const r = harvest(st, outing, energyNow(), shareOf(tally));
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
    const place: Place = { season: seasonOf(st0.time), wind: wx.wind, rain: wx.rain, ...homeWater() };
    void PLAYS[game](seed, place).then((play) => {
      if (!alive) {
        play.dispose();
        return;
      }
      // Ветер в траве и кронах — погоды города в эту минуту (`weather.weatherNow`), той же, что слышит фон.
      wire(new Stage(canvas, play, GAME_SECONDS[game], place.season, place.wind));
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
        stage.stickEl = null;
        stage.meterEl = null;
        stage.aimEl = null;
        stage.dispose();
      }
      canvas.remove();
      stageRef.current = null;
    };
  }, [game, seed, gen]);

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
  const start = (): void => {
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
    stage.begin();
  };

  const phase = view?.phase ?? 'brief';
  const words = TALLY_WORDS[game];
  const meter = probe() || new URLSearchParams(window.location.search).has('fps');

  return (
    <div className="mg" ref={wrapRef}>
      <div className="mg-stick" ref={stickRef} aria-hidden="true">
        <i />
      </div>
      {meter && <div className="mg-meter" ref={meterRef} />}
      {game === 'hunt' && (
        // Прицел лука: середина — куда уходит стрела, метки ниже — поправка дуги на дальность (их ставит сцена,
        // `Stage.aimSync`, числами `hunt.pins`). Стоит с первого кадра, чтобы сцена нашла его, — виден в игре.
        <div className={`mg-aim${phase === 'play' ? '' : ' off'}`} ref={aimRef} aria-hidden="true">
          <i className="mg-ring" />
          <i className="mg-dot" />
          {/* Попал — крест вспыхивает на прицеле и гаснет: отклик в том месте, куда смотрит глаз. */}
          {view?.note === 'Попал' && <i className="mg-hit" />}
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
            <span className="mg-chip mg-score" key={`score-${view.tally.got}`}>
              <Icon name={`mini-${game}`} glyph={def.glyph} />
              {words.short(view.tally)}
            </span>
            {view.aside && <span className="mg-chip">{view.aside}</span>}
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
          <div className="mg-bottom">
            {view.verb ? (
              <span className="mg-chip mg-verb">Нажми — {view.verb.toLowerCase()}</span>
            ) : view.cue ? (
              <span className="mg-chip mg-verb">{view.cue}</span>
            ) : (
              hint && <span className="mg-hint">{HINT[game]}</span>
            )}
          </div>
        </>
      )}

      {phase === 'brief' && (
        <div className="mg-card" role="dialog" aria-label={def.name}>
          <div className="mg-head">
            <span className="mg-ico">
              <Icon name={`mini-${game}`} glyph={def.glyph} />
            </span>
            <b>{def.name}</b>
          </div>
          <p>{def.goal}</p>
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
              <Icon name="ui-time" glyph="⏳" />
              {realSpanText(GAME_SECONDS[game])}
            </span>
            <span className="mg-res mg-muted">до</span>
            <HaulRow haul={top} />
            <span className="mg-res mg-muted" aria-label="Энергия">
              <Icon name="ui-energy" glyph="✋" />
              {MINIGAME_COST}
            </span>
          </div>
          {!ready && <small className="mg-why">Энергии хватит через {realSpanText(Math.ceil(energyReadyIn(s, now) / 1000))}</small>}
          <div className="mg-actions">
            <button className="mg-back" onClick={onExit}>
              Назад
            </button>
            <button className="mg-go" disabled={!ready} onClick={start}>
              Начать
            </button>
          </div>
        </div>
      )}

      {phase === 'done' && view && (
        <div className="mg-card" role="dialog" aria-label="Итог">
          <div className="mg-head">
            <span className="mg-ico">
              <Icon name={`mini-${game}`} glyph={def.glyph} />
            </span>
            <b>{words.done(view.tally)}</b>
          </div>
          {result && typeof result !== 'string' && (
            <>
              {/* Доля от предела — та же, что ушла в начисление (`shareOf` → `harvest`): полоса и число одной функцией. */}
              <div className="mg-share" aria-label="Доля от предела">
                <span className="mg-bar">
                  <i style={{ width: `${Math.round(shareOf(view.tally) * 100)}%` }} />
                </span>
                <span>Взято {Math.round(shareOf(view.tally) * 100)} % предела</span>
              </div>
              <div className="mg-facts">
                <span className="mg-res mg-muted">На склад</span>
                {Object.keys(result.stored).length > 0 ? <HaulRow haul={result.stored} /> : <span className="mg-res">ничего</span>}
              </div>
              {RESOURCE_IDS.some((r) => (result.stored[r] ?? 0) < (result.got[r] ?? 0)) && <small className="mg-why">Склад полон, легло не всё</small>}
              <small className="mg-muted">
                Энергия {result.energy} из {ENERGY_MAX}
              </small>
            </>
          )}
          {typeof result === 'string' && <small className="mg-why">{result}</small>}
          <div className="mg-actions">
            <button className="mg-go" onClick={onExit}>
              В город
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
