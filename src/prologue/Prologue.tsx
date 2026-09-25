import { useCallback, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { probe } from '@/debug';
// Свой файл стилей, а не строки в общем: он уезжает вместе с чанком режима и
// в первую загрузку игры не входит (почему — в самом файле).
import './prologue.css';
import { deathWords } from './body';
import { OVER_NOTE, OVER_SAYS, PASSED, RAID_ANSWER } from './end';
import { CheatPanel } from '@/ui/CheatPanel';
import { CHEAT_MARK_GLADE } from '@/cheats';
import { IconArrows, IconAxe, IconBow, IconCoat, IconFrost, IconHeart, IconHide, IconLogs, IconMeat, IconPack, IconRaw } from './icons';
import { HEIR_MAX, LOVE_DAYS, heirName } from './kin';
import type { ItemId } from './pack';
import { loadPrologue } from './save';
import { PrologueScene, type PrologueView } from './scene';

/**
 * Предыстория: оболочка вокруг сцены.
 *
 * КАНВУ ЗАВОДИТ ЭФФЕКТ, А НЕ РАЗМЕТКА, и уборка идёт в `useLayoutEffect` — обе
 * причины те же, что у диорамы (`ui/GameCanvas.tsx`), и обе стоили дорого,
 * чтобы их выяснить: отданный контекст WebGL элемент не отпускает, а уборка
 * обычного эффекта идёт уже после удаления канвы из разметки.
 *
 * ДИОРАМЫ ПОД ЭТИМ ЭКРАНОМ НЕТ ВОВСЕ. `App` не рисует `GameCanvas`, пока открыта
 * предыстория, — то есть деревня не приостановлена, а разобрана, и контекст
 * WebGL в игре по-прежнему один. Приостановки тут было бы мало: две живые сцены
 * на телефоне кончаются тем, что браузер молча отбирает контекст у старшей, и
 * игрок возвращается из предыстории к чёрному прямоугольнику вместо деревни.
 *
 * Возврат стоит пересборки диорамы — четверть секунды, и она проходит за
 * стартовым экраном, на который игрок и возвращается. Это тот самый размен,
 * который для карты мира был признан невыгодным (docs/loading.md, раздел 3), а
 * здесь выгоден: на карту ходят десятки раз за партию, в предысторию — один.
 *
 * Надстройка над сценой перерисовывается не каждый кадр: сцена присылает
 * `PrologueView` только когда в нём что-то изменилось (`scene.refresh`). Стик
 * ходьбы, затемнение объятия и иней по краям — исключения: они живут кадрами, и
 * их сцена двигает сама, минуя React.
 *
 * ТЕСНО ЛИ НА ЭКРАНЕ — вопрос, который решается тем, как стоит то, что есть.
 * Полос три, и видны они всегда, но **полная полоса молчит**: тонкая, тусклая и
 * без слова. Говорит полоса, когда есть о чём — тепло уходит, живот пустеет,
 * здоровье тает или заживает, — и тогда она ярче, толще и называет срок. Всё, что
 * в руках, живёт в окне вещей, а не россыпью счётчиков. Внизу три кнопки —
 * действие, лук и вещи, — и ни одна из них не переезжает.
 */
export function Prologue({ onExit }: { onExit: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef<HTMLDivElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const hugRef = useRef<HTMLDivElement>(null);
  const frostRef = useRef<HTMLDivElement>(null);
  const blindRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<PrologueScene | null>(null);
  const [view, setView] = useState<PrologueView | null>(null);
  /** Показывать ли подсказку об управлении. Уходит с первого касания сцены. */
  const [hint, setHint] = useState(true);
  /** Имя сына, пока его печатают. Это поле ввода, а не игра: в запись оно не идёт. */
  const [draft, setDraft] = useState('');

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'pro-canvas';
    /*
     * ПЕРВЫМ УЗЛОМ, А НЕ ПОСЛЕДНИМ, И ЭТО НЕ МЕЛОЧЬ.
     *
     * Канву заводит эффект, а не разметка (причина — выше), и эффект приходит
     * после первого рисования: `appendChild` клал её **последней**. А
     * позиционированные соседи без своего слоя рисуются в порядке разметки —
     * то есть непрозрачный холст закрывал собой всю надстройку целиком: полосы и
     * кнопки. Поймано глазами на 375 px: на экране была одна поляна и ни одной
     * кнопки.
     *
     * Лечится это одним словом, а не слоями: холст — пол, надстройка над ним,
     * и порядок разметки говорит это сам. Слои пришлось бы помнить каждому
     * новому элементу, а `prepend` не надо помнить никому.
     */
    wrap.prepend(canvas);
    const scene = new PrologueScene(canvas, loadPrologue());
    sceneRef.current = scene;
    scene.onView = setView;
    scene.stickEl = stickRef.current;
    scene.meterEl = meterRef.current;
    scene.hugEl = hugRef.current;
    scene.frostEl = frostRef.current;
    scene.blindEl = blindRef.current;
    // Первую надпись берём сразу, не дожидаясь кадра: в скрытом вебвью кадра не
    // будет вовсе, и игрок увидел бы многоточие вместо костра.
    setView(scene.snapshot());
    // Замер: сцену надо достать из консоли — в собранном бандле её неоткуда
    // взять. Только по флагу `?probe=1`, как и диораму (см. `src/debug.ts`).
    if (probe()) (window as unknown as { __pro?: PrologueScene }).__pro = scene;
    const drop = (): void => setHint(false);
    canvas.addEventListener('pointerdown', drop, { once: true });
    const onResize = (): void => scene.resize();
    const ro = new ResizeObserver(onResize);
    ro.observe(wrap);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      canvas.removeEventListener('pointerdown', drop);
      scene.onView = null;
      scene.stickEl = null;
      scene.meterEl = null;
      scene.hugEl = null;
      scene.frostEl = null;
      scene.blindEl = null;
      // Порядок тот же, что у диорамы: сцена прибирается при канве, ещё лежащей
      // в разметке, и только потом канва уходит.
      scene.dispose();
      canvas.remove();
      sceneRef.current = null;
    };
  }, []);

  const act = useCallback(() => sceneRef.current?.doAct(), []);
  const shoot = useCallback(() => sceneRef.current?.doBow(), []);
  const eatCooked = useCallback(() => sceneRef.current?.eatMeal(false), []);
  const eatRaw = useCallback(() => sceneRef.current?.eatMeal(true), []);
  const again = useCallback(() => sceneRef.current?.reviveNow(), []);
  const accept = useCallback(() => sceneRef.current?.acceptGuest(), []);
  const refuse = useCallback(() => sceneRef.current?.refuseGuest(), []);
  const giveMeat = useCallback(() => sceneRef.current?.shareMeat(), []);
  const hug = useCallback(() => sceneRef.current?.hug(), []);
  const closePanel = useCallback(() => sceneRef.current?.closePanel(), []);
  const togglePack = useCallback(() => sceneRef.current?.togglePack(), []);
  const feedSon = useCallback(() => sceneRef.current?.feedSonMeat(), []);
  const passOn = useCallback(() => sceneRef.current?.passOn(), []);
  const answerRaid = useCallback(() => sceneRef.current?.answerRaid(), []);
  const applyCode = useCallback((code: string) => sceneRef.current?.cheat(code) ?? '', []);

  /**
   * Имя — одним правилом на кнопку, на Enter и на запись: `kin.heirName`.
   * Причина стоит под полем всегда, а не всплывает после нажатия: кнопка, которая
   * не сработает, гаснет и говорит почему.
   */
  const named = heirName(draft);
  const nameSon = (e: FormEvent): void => {
    e.preventDefault();
    if (named.why) return;
    // Клавиатуру убираем до того, как поле уйдёт из разметки: на iOS фокус,
    // оставшийся на вынутом узле, держит клавиатуру над пустым местом.
    (document.activeElement as HTMLElement | null)?.blur?.();
    if (sceneRef.current?.nameHeir(draft) === '') setDraft('');
  };

  /**
   * Какая карточка на экране. Мёртвому, посреди объятия и посреди последней
   * сцены — никакой: там игрок уже ничего не решает.
   */
  const card = view && !view.dead && !view.hugging && (!view.watching || view.panel === 'raid') ? view.panel : '';
  /** Почему мясо в вещах не съесть — одна строка на оба куска: причина у них одна. */
  const eatWhy =
    view && card === 'pack' && !view.eatCooked.can && !view.eatRaw.can && view.items.some((i) => i.id === 'cooked' || i.id === 'raw')
      ? view.items.some((i) => i.id === 'cooked')
        ? view.eatCooked.why
        : view.eatRaw.why
      : '';

  return (
    <div className="pro" ref={wrapRef}>
      {/* Замерник кадров — по адресу `?fps=1`, владельцу на телефоне: ступень и кадры. */}
      {METER && <div className="pro-meter" ref={meterRef} aria-hidden="true" />}
      {/* Стик ходьбы. Сидит в разметке всегда и прячется прозрачностью: заводить
          и убирать узел на каждое касание дороже, чем подвинуть готовый. */}
      <div className="pro-stick" ref={stickRef} aria-hidden="true">
        <i />
      </div>

      {/* Иней по краям кадра — первым слоем над холстом и под всей надстройкой:
          полосы и кнопки обязаны читаться поверх него. Прозрачность ставит сцена. */}
      <div className="pro-frost" ref={frostRef} aria-hidden="true" />

      {/* Три полосы слева сверху, на тёмной подложке: на светлом снегу белое по
          белому не читается, а подложка держит их на любом кадре.

          Пока идёт последняя сцена, их нет: человек умирает не от голода и не от
          холода (`act.death`), и полоса «заживает» над уходящим сыном была бы не
          сведением, а помехой. */}
      {/* `hidden` тут не годится: у полос свой `display: flex`, и он сильнее
          браузерного правила для скрытого узла. Убираем из разметки целиком. */}
      {view?.watching !== true && (
      <div className="pro-vitals">
        <Vital
          kind="health"
          label="Здоровье"
          icon={<IconHeart />}
          fill={view?.healthFill ?? 1}
          words={view?.healthWords ?? ''}
          mood={view ? healthMood(view) : 'calm'}
        />
        <Vital
          kind="warmth"
          label="Тепло"
          icon={<IconFrost />}
          fill={view?.warmthFill ?? 1}
          words={view?.warmthWords ?? ''}
          mood={view ? warmthMood(view) : 'calm'}
        />
        <Vital
          kind="fed"
          label="Сытость"
          icon={<IconMeat />}
          fill={view?.fedFill ?? 1}
          words={view?.fedWords ?? ''}
          mood={view ? fedMood(view) : 'calm'}
        />
        {/*
            Костёр и что вокруг: огонь, ночь, непогода, волки. Костёр — строкой, а не
            полосой: у него один вопрос, «на сколько хватит», и ответ на него — срок
            (у полосы очага шаг в полено, `fire.LOG_HOURS`, за заход она не двигается).

            Ночь названа словом нарочно, хотя её и видно глазом: видно **темноту**,
            а не то, что от неё стынут быстрее и что зверь спит. А про волков молчать
            нельзя вовсе — их и заводили затем, чтобы игрок успел решить.
        */}
        {view && (
          <div className="pro-sky">
            <span className={view.fireFill > 0 ? 'fire' : 'fire out'}>🔥 {view.fireWords}</span>
            {view.night && <span>🌙 ночь</span>}
            {view.weather !== '' && (
              <span className={view.weather === 'хмурится' ? 'soon' : 'wet'}>
                {view.weather === 'дождь' ? '☔' : view.weather === 'снег' ? '❄' : '⛅'} {view.weather}
              </span>
            )}
            {view.wolves > 0 && <span className="wolf">🐺 волки</span>}
          </div>
        )}
      </div>
      )}

      <button className="pro-out" onClick={onExit}>
        Выход →
      </button>

      {view && view.busy !== '' && (
        <div className="pro-chops">
          {view.busy}
          {view.busyLeft > 0 && `: ${view.busyLeft}`}
        </div>
      )}

      {/* Строка поверх сцены: встреча после отлучки, ответ гостьи, новость о
          роде. Ничего не нажимает и уходит сама — время её держит сцена. */}
      {view && !view.dead && view.note !== '' && <div className="pro-note">{view.note}</div>}

      {/* Перекрестье появляется только с натянутым луком — и это единственное
          место в игре, где оно честно: тап не целится, а стрела летит ровно
          сюда. Стояло бы всегда — обещало бы прицел там, где его нет. */}
      {view?.drawn && <div className="pro-cross" aria-hidden="true" />}

      {/* Что просят сделать сейчас (`end.ts`). Строка, а не окно: задание не
          закрывает поляну и не требует нажатия. */}
      {view && view.task !== '' && !view.watching && <div className="pro-task">{view.task}</div>}

      {!view?.hugging && !view?.watching && (
        <div className="pro-act">
          {/* Правило то же, что у стройки и писем: кнопка, которая не сработает,
              гаснет и говорит причину. Проваливающихся нажатий не бывает. */}
          <button className="pro-do" onClick={act} disabled={!view?.offer.can}>
            {view?.offer.label ?? 'Осмотрись'}
          </button>
          {/* Лук — своя кнопка, и стоит она под большим пальцем той руки, которая
              смотрит: целиться и пускать одной рукой. */}
          <button
            className={`pro-bow${view?.drawn ? ' drawn' : ''}`}
            onClick={shoot}
            disabled={!view?.shot.can}
            title={view?.shot.why}
          >
            {view?.drawn ? '➹' : '🏹'}
          </button>
          {/* Вещи — справа снизу, последней: окно, а не действие, и нажимают его
              реже двух других. Мёртвому вещей нет — поверх стоит экран смерти. */}
          <button
            className={`pro-pack${card === 'pack' ? ' open' : ''}`}
            onClick={togglePack}
            aria-label="Вещи"
            aria-expanded={card === 'pack'}
            disabled={!view || !!view.dead}
          >
            <IconPack />
          </button>
        </div>
      )}
      {view && !view.offer.can && !view.hugging && !view.watching && card === '' && <div className="pro-why">{view.offer.why}</div>}

      {/* Подсказка об управлении — только на обычной поляне: финал не то место,
          где учат ходить, а чёрный экран она перечеркнула бы собой. */}
      {hint && !view?.dead && card === '' && view?.end === 'none' && (
        <div className="pro-hint">
          <b>Слева — идти, справа — смотреть.</b>
          <span>Тап — действие над тем, к чему подошёл: топор на колоде, пожитки у палатки, дрова в костёр.</span>
          <span>Лук — своей кнопкой: натянуть, навести взглядом, пустить. Оленя тапом не достать.</span>
          <span>Зима: вдали от огня уходит тепло, а за ним здоровье. Костёр греет и держит волков в стороне.</span>
          <span>Вещи и еда — кнопкой справа внизу. Мясо возвращает здоровье.</span>
          <span className="pro-dim">На ПК: WASD или стрелки, мышью тянуть, пробел — действие, F — лук.</span>
        </div>
      )}

      {/* Вещи: ровно то, что есть (`pack.ts`). Из окна не применяется ничего,
          кроме еды: дверь еды жила на счётчике мяса и переехала вместе с ним. */}
      {view && card === 'pack' && (
        <div className="pro-card pro-inv" role="dialog" aria-label="Вещи">
          <button className="pro-x" onClick={closePanel} aria-label="Закрыть">
            ✕
          </button>
          <b className="pro-who">Вещи</b>
          {view.items.length === 0 ? (
            <p className="pro-say">Пусто. Топор — на колоде у костра, лук и запас еды — у палатки.</p>
          ) : (
            <ul>
              {view.items.map((it) => {
                const food = it.id === 'cooked' ? view.eatCooked : it.id === 'raw' ? view.eatRaw : null;
                return (
                  <li key={it.id} className={it.worn ? 'worn' : ''}>
                    <i className={`pro-inv-ico ${it.id}`}>{ITEM_ICON[it.id]}</i>
                    <span className="pro-inv-name">
                      {it.name}
                      {it.note !== '' && <small>{it.note}</small>}
                    </span>
                    {it.worn && <em className="pro-inv-worn">надета</em>}
                    {it.counted && <b className="pro-inv-n">×{it.count}</b>}
                    {food && (
                      <button className="pro-eat" onClick={it.id === 'raw' ? eatRaw : eatCooked} disabled={!food.can}>
                        Съесть
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {eatWhy !== '' && <span className="pro-card-why">{eatWhy}</span>}
        </div>
      )}

      {/* Гостья у огня: кто она и откуда — её словами, и два ответа. Отказ не
          тупик и не наказание: следующая придёт через сутки поляны. */}
      {view && card === 'guest' && (
        <div className="pro-card" role="dialog" aria-label="Гостья у огня">
          <button className="pro-x" onClick={closePanel} aria-label="Отойти">
            ✕
          </button>
          <b className="pro-who">{view.mateName}</b>
          <p className="pro-say">«{view.mateSays}»</p>
          <div className="pro-row">
            <button className="pro-btn main" onClick={accept}>
              Принять
            </button>
            <button className="pro-btn" onClick={refuse}>
              Отказать
            </button>
          </div>
        </div>
      )}

      {/* Жена. Любовь — полосой и из чего она растёт: четыре дела, каждое раз в
          сутки поляны, и засчитанное сегодня подсвечено. Число без объяснения
          игрок читал бы шкалой кормёжки, а она про общую жизнь. */}
      {view && card === 'wife' && (
        <div className="pro-card" role="dialog" aria-label="Жена">
          <button className="pro-x" onClick={closePanel} aria-label="Отойти">
            ✕
          </button>
          <b className="pro-who">
            {view.mateName} <em>жена</em>
          </b>
          <p className="pro-say">«{view.mateSays}»</p>
          <div className="pro-love">
            <span>любовь</span>
            <div className="pro-bar">
              <i style={{ width: `${Math.round(Math.max(0, Math.min(100, view.love)))}%` }} />
            </div>
            <em>{view.love}</em>
          </div>
          <div className="pro-tally">
            <span className={view.mealToday ? 'on' : ''} title="разделённая еда">
              🍗 {view.meals}/{LOVE_DAYS}
            </span>
            <span className={view.hugToday ? 'on' : ''} title="объятия">
              🤗 {view.hugs}/{LOVE_DAYS}
            </span>
            <span className={view.nightToday ? 'on' : ''} title="ночи дома">
              🌙 {view.nights}/{LOVE_DAYS}
            </span>
            <span className={view.woodToday ? 'on' : ''} title="дрова в общий очаг">
              🔥 {view.woods}/{LOVE_DAYS}
            </span>
          </div>
          <span className="pro-card-note">раз в сутки: еда, объятие, ночь дома, дрова</span>
          <div className="pro-row">
            <button className="pro-btn" onClick={giveMeat} disabled={!view.give.can}>
              {view.give.label}
            </button>
            <button className="pro-btn main" onClick={hug}>
              Обнять
            </button>
          </div>
          {!view.give.can && <span className="pro-card-why">{view.give.why}</span>}
        </div>
      )}

      {/*
          Имя сына. КАРТОЧКА НАВЕРХУ, А НЕ ВНИЗУ, И ЭТО ПРО КЛАВИАТУРУ. Вебвью
          поднимает её по-разному: Android сжимает окно, iOS кладёт клавиатуру
          поверх и двигает страницу к полю. Поле, стоящее у верхнего края, не
          уезжает под клавиатуру ни в том, ни в другом случае, и страницу двигать
          к нему незачем. Под карточкой — затемнение: пока печатают, сцена не
          берёт касаний, а её прыжки вслед за сжатым окном не видны.
      */}
      {view && card === 'name' && (
        <>
          <div className="pro-veil" />
          <form className="pro-card top pro-name" onSubmit={nameSon} role="dialog" aria-label="Имя сына">
            <button type="button" className="pro-x" onClick={closePanel} aria-label="Позже">
              ✕
            </button>
            <b className="pro-who">{view.mateName}</b>
            <p className="pro-say">«{view.mateSays}»</p>
            <label className="pro-ask" htmlFor="pro-heir">
              Как назвать сына?
            </label>
            <input
              id="pro-heir"
              name="heir"
              type="text"
              value={draft}
              maxLength={HEIR_MAX}
              placeholder="Имя"
              inputMode="text"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="words"
              spellCheck={false}
              enterKeyHint="done"
              onChange={(e) => setDraft(e.target.value)}
            />
            <span className="pro-card-why">{named.why}</span>
            <div className="pro-row">
              <button type="submit" className="pro-btn main" disabled={named.why !== ''}>
                Назвать
              </button>
              <button type="button" className="pro-btn" onClick={closePanel}>
                Позже
              </button>
            </div>
          </form>
        </>
      )}

      {/* Родословная: ровно те строки, что есть. Пустых мест «на вырост» нет —
          они обещали бы то, чего игрок ещё не сделал. */}
      {view && card === 'kin' && (
        <div className="pro-card pro-kin" role="dialog" aria-label="Родословная">
          <button className="pro-x" onClick={closePanel} aria-label="Закрыть">
            ✕
          </button>
          <b className="pro-who">Род</b>
          {/* Метка поляны, где применяли коды. Родословная — единственное место
              поляны, где записано, что было: летописи здесь нет. */}
          {view.cheated && <span className="pro-card-why">{CHEAT_MARK_GLADE}</span>}
          <ol>
            {view.lineage.map((line) => (
              <li key={line.who}>
                <b>{line.name}</b>
                <span>{line.note}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Сын. Карточка та же, что у матери, но короче: шкалы у него нет и не
          будет, дел одно — поел или нет (`docs/prologue.md`, чего нет). */}
      {view && card === 'son' && (
        <div className="pro-card" role="dialog" aria-label="Сын">
          <button className="pro-x" onClick={closePanel} aria-label="Отойти">
            ✕
          </button>
          <b className="pro-who">
            {view.mateName} <em>сын</em>
          </b>
          <p className="pro-say">«{view.mateSays}»</p>
          <div className="pro-row">
            <button className="pro-btn main" onClick={feedSon} disabled={!view.give.can}>
              {view.give.label}
            </button>
          </div>
          {!view.give.can && <span className="pro-card-why">{view.give.why}</span>}
        </div>
      )}

      {/* Те, кто пришёл из леса. Ответ один: это его дом, его жена и его сын. */}
      {view && card === 'raid' && (
        <div className="pro-card pro-raid" role="dialog" aria-label="Разбойники">
          <b className="pro-who">Пятеро из леса</b>
          <p className="pro-say">«{view.mateSays}»</p>
          <div className="pro-row">
            <button className="pro-btn main" onClick={answerRaid}>
              {RAID_ANSWER}
            </button>
          </div>
        </div>
      )}

      {/* Объятие: затемнение и знак. Прозрачность им ставит сцена по долям
          объятия — теми же числами, по которым уходит под крышу камера. */}
      <div className="pro-hug" ref={hugRef} aria-hidden="true">
        <i className="pro-hug-veil" />
        <i className="pro-heart" />
      </div>

      {/*
          Меркнущее зрение последней сцены: дымка по краям, два века и чернота.
          Все четыре двигает сцена, минуя React (`scene.blindShow`), — по той же
          причине, что стик и объятие: доли у век и у камеры обязаны быть одним
          числом, а не двумя таблицами.
      */}
      <div className="pro-blind" ref={blindRef} aria-hidden="true">
        <i className="pro-haze" />
        <i className="pro-lid top" />
        <i className="pro-lid bot" />
        <i className="pro-black" />
      </div>

      {/* «Прошло много дней…». Ждёт человека, а не часов: он переводит дух. */}
      {view?.end === 'passed' && (
        <div className="pro-passed" onClick={passOn} role="button" tabIndex={0}>
          <b>{PASSED}</b>
          <span className="pro-dim">коснись экрана</span>
        </div>
      )}

      {/* Конец. Что будет с сыном, не сказано, и говорить это здесь нечем. */}
      {view?.end === 'over' && (
        <div className="pro-passed over">
          <b>{OVER_SAYS}</b>
          <span>{OVER_NOTE}</span>
          {/* Имя сына — последнее, что стоит на чёрном экране, и стоит оно одно:
              ради него весь род и писался (`docs/prologue.md`, раздел 19). */}
          {view.sonName !== '' && <em className="pro-heir">{view.sonName}</em>}
          <button className="pro-do" onClick={onExit}>
            В меню
          </button>
        </div>
      )}

      {/* Кнопка кодов — тот же компонент, что в деревне (`ui/CheatPanel.tsx`).
          Пока идёт последняя сцена, её нет: там ничего не набирают. */}
      {!view?.watching && view?.end !== 'over' && (
        <CheatPanel where="prologue" marked={view?.cheated === true} onApply={applyCode} />
      )}

      {/* Смерть — экран поверх всего, и он называет причину. Молча начатое
          заново утро игрок прочитал бы как сбой, а не как свою ошибку. */}
      {view?.dead && (
        <div className="pro-dead">
          <b>{deathWords(view.dead)}</b>
          <span>
            {view.dead === 'cold'
              ? 'Тепло ушло, а за ним и здоровье. Костёр возвращает тепло за двадцать минут — уходя, оставляй в очаге дров: в дождь он горит втрое быстрее.'
              : view.dead === 'wolf'
                ? 'Стая догнала. У горящего костра волки не подходят, а с топором в руках от одного можно отбиться.'
                : 'Запас кончился раньше, чем ты вернулся, и голод доел здоровье. Мясо жарится на костре и втрое сытнее сырого.'}
          </span>
          <span className="pro-dim">
            Новое утро: очаг разожжён, топор и лук при тебе. Запас мяса пропал — его придётся добыть.
          </span>
          <button className="pro-do" onClick={again}>
            Снова
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Показывать ли замерник кадров. Только по адресу (`?fps=1`): игроку он ни к чему, а
 * владельцу на телефоне — единственный способ увидеть, какая ступень встала и держит ли
 * она тридцать (docs/prologue.md, раздел 20).
 */
const METER = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('fps') === '1';

/** Значок у каждой вещи. Таблица, а не ветвление: новая вещь без значка не соберётся. */
const ITEM_ICON: Record<ItemId, ReactNode> = {
  axe: <IconAxe />,
  bow: <IconBow />,
  arrows: <IconArrows />,
  cooked: <IconMeat />,
  raw: <IconRaw />,
  logs: <IconLogs />,
  hides: <IconHide />,
  coat: <IconCoat />,
};

/**
 * Как стоит полоса.
 *
 *   calm  полная — молчит: тонкая, тусклая, без слова. Видно, что она есть, и
 *         только;
 *   ok    не полная и ничего не делает — ярче, со сроком;
 *   good  возвращается: греется у огня, заживает;
 *   low   меньше четверти — срок тревожным цветом;
 *   bad   пуста или тает здоровье — тревога.
 */
type Mood = 'calm' | 'ok' | 'good' | 'low' | 'bad';

/** Ниже четверти полоса тревожится. */
const LOW = 0.25;

/**
 * С какой полноты полоса считается полной и молчит.
 *
 * Мерка у всех одна — «час до полного», и потому числа разные: сытость уходит за
 * двое суток (час — две сотых), тепло вдали от огня — за сутки (четыре сотых),
 * здоровье заживает за двое (две сотых). Полоса, на которой не хватает меньше
 * часа, игроку ничего не говорит.
 */
const FED_FULL = 1 - 1 / 48;
const WARMTH_FULL = 1 - 1 / 24;
const HEALTH_FULL = 1 - 1 / 48;

const healthMood = (v: PrologueView): Mood =>
  v.draining ? 'bad' : v.healing ? 'good' : v.healthFill >= HEALTH_FULL ? 'calm' : v.healthFill < LOW ? 'low' : 'ok';

const warmthMood = (v: PrologueView): Mood =>
  v.warmthFill <= 0
    ? 'bad'
    : v.warmthFill >= WARMTH_FULL
      ? 'calm'
      : v.warming
        ? 'good'
        : v.warmthFill < LOW
          ? 'low'
          : 'ok';

const fedMood = (v: PrologueView): Mood =>
  v.fedFill <= 0 ? 'bad' : v.fedFill >= FED_FULL ? 'calm' : v.fedFill < LOW ? 'low' : 'ok';

/** Одна полоса: значок, полоса, срок словами. Три штуки одинаковые. */
function Vital({
  kind,
  label,
  icon,
  fill,
  words,
  mood,
}: {
  kind: string;
  label: string;
  icon: ReactNode;
  fill: number;
  words: string;
  mood: Mood;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, fill)) * 100);
  return (
    <div className={`pro-vital ${kind} ${mood}`} role="img" aria-label={`${label}: ${pct}%${words ? `, ${words}` : ''}`}>
      <i className="pro-vital-ico">{icon}</i>
      <div className="pro-bar">
        <i style={{ width: `${pct}%` }} />
      </div>
      <em>{mood === 'calm' ? '' : words}</em>
    </div>
  );
}
