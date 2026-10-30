import { Suspense, lazy, useEffect, useRef, useState, type ComponentProps } from 'react';
import { useGame, type SheetView } from './game/store';
import { GameCanvas } from './ui/GameCanvas';
import { WinterModal, winterUi } from './ui/WinterModal';
import { StartScreen, StartVeil } from './ui/StartScreen';
import { SyncModal } from './ui/SyncModal';
import { Frozen } from './ui/parts/Frozen';
import { useBugReport } from './ui/parts/bugOpen';
import { useWorld } from './world/store';
import { cityAudio } from './sound/city';
import { probe } from './debug';
import { CheatPanel } from './ui/CheatPanel';
import { useRealm } from './ui/realm/open';
import { useTrades } from './ui/trades';
import { useTreasury } from './ui/treasury';
import { tutorialActive } from './game/data/tutorial';
import { Leave } from './ui/parts/leave';
import { openFromLink } from '@/ui/realm/golink';
import { Crash } from './ui/Crash';
import type { Sheet as SheetBody } from './ui/Sheet';
import { warmAfter } from './boot/warm';
import { MAP_CHUNKS, mapUi } from './ui/map/chunks';
import { roamOn } from './game/roamflag';

/**
 * Предыстория — отдельный чанк, и качается он по нажатию кнопки.
 *
 * Первая загрузка игры про неё не знает ничего: `lazy` разрывает граф модулей,
 * и rollup уносит и сцену, и её модели в свой файл — ровно так же, как уносит
 * стенд-витрину и ролик о бое. Правило простое и проверяется описью сборки:
 * **режим, в который игрок может не зайти ни разу, не имеет права стоить ему
 * ни байта на старте.**
 *
 * `three` при этом уже загружен — он общий чанк, на котором стоит диорама, — и
 * повторно не едет. Поэтому нажатие стоит только своего чанка.
 */
const Prologue = lazy(() => import('./prologue/Prologue').then((m) => ({ default: m.Prologue })));

/**
 * Меню державы — тоже свой кусок, по нажатию герба. Разделы в нём — те же
 * компоненты, что у зданий, и в первой загрузке они уже есть; своим куском едет
 * только сам дом меню, и платит за него тот, кто его открыл.
 */
const RealmMenu = lazy(() => import('./ui/realm/RealmMenu').then((m) => ({ default: m.RealmMenu })));
// Донесение о бое, справки «Жители», «Задания» и «Сезон» — своими кусками (СБ-2): первая загрузка не платит за окна, которые открывают по касанию.
const ReportPanel = lazy(() => import('./ui/panels/ReportPanel').then((m) => ({ default: m.ReportPanel })));
const PopPanel = lazy(() => import('./ui/panels/PopPanel').then((m) => ({ default: m.PopPanel })));
const QuestsPanel = lazy(() => import('./ui/panels/QuestsPanel').then((m) => ({ default: m.QuestsPanel })));
const SeasonPanel = lazy(() => import('./ui/panels/SeasonPanel').then((m) => ({ default: m.SeasonPanel })));

/**
 * Интерфейс — свой кусок (`ui/next/index.ts`): едет, пока стоит стартовый экран. Прежний интерфейс, что ехал в первой
 * загрузке запасным видом, удалён (docs/ui_audit.md, 16). Четыре части — один кусок: `import` один и тот же.
 */
const nextUi = () => import('./ui/next');
/**
 * Карта мира — своим куском (РТ-2: первая загрузка не растёт от сословий): открывается по кнопке, а её код вместе с
 * «Рейтингом» и «Молвой края» подтягивается в фоне, когда замок встал и браузер простаивает (`boot/warm`, РТ-2б).
 */
const WorldMap = lazy(() => mapUi().then((m) => ({ default: m.WorldMap })));
const Hud = lazy(() => nextUi().then((m) => ({ default: m.Hud })));
const Alerts = lazy(() => nextUi().then((m) => ({ default: m.Alerts })));
const WarSigns = lazy(() => nextUi().then((m) => ({ default: m.WarSigns })));
const Nav = lazy(() => nextUi().then((m) => ({ default: m.Nav })));
const TipLayer = lazy(() => nextUi().then((m) => ({ default: m.TipLayer })));
const Hints = lazy(() => nextUi().then((m) => ({ default: m.Hints })));
/** Шаг «Как назовёшь город?» стартового экрана — тем же куском: сам экран ничего не грузит (`start.test.ts`). */
const CityNaming = lazy(() => nextUi().then((m) => ({ default: m.CityNaming })));
/** Окно «Настройки» стартового экрана — тем же куском, тот же компонент, что в профиле (`parts/Settings`; ОС-1). */
const Settings = lazy(() => nextUi().then((m) => ({ default: m.Settings })));
/** Подсказка обучения — тем же куском (ОС-1): она стоит поверх города рядом с верхом и низом, что едут им же. */
const TutorialOverlay = lazy(() => nextUi().then((m) => ({ default: m.TutorialOverlay })));
/**
 * Окна «С возвращением», «Новая партия» и «Время пошло медленнее» — тем же куском (ОС-1в): до входа их, как и подсказку
 * обучения, закрывает стартовый экран, а кусок едет, пока он стоит.
 */
const OfflineModal = lazy(() => nextUi().then((m) => ({ default: m.OfflineModal })));
const LegacyModal = lazy(() => nextUi().then((m) => ({ default: m.LegacyModal })));
const PaceModal = lazy(() => nextUi().then((m) => ({ default: m.PaceModal })));
const RoomModal = lazy(() => nextUi().then((m) => ({ default: m.RoomModal })));
/** Шторка окон — тем же куском (ОС-1): всё, что в ней показывают, едет им же, и без него шторке показать нечего. */
const Sheet = lazy(() => nextUi().then((m) => ({ default: m.Sheet })));
/** Карточка клетки и «Походы» нового вида — тем же куском (docs/ui_audit.md, 13). */
const WorldNew = lazy(() => nextUi().then((m) => ({ default: m.WorldNew })));
const MarchesNew = lazy(() => nextUi().then((m) => ({ default: m.MarchesNew })));
/** Окно «Промыслы» — тем же куском (docs/minigames.md, 3). */
const Trades = lazy(() => nextUi().then((m) => ({ default: m.Trades })));
const Treasury = lazy(() => nextUi().then((m) => ({ default: m.Treasury })));
/** «Дружина» с передачей полководец ↔ гарнизон — тем же куском (docs/ui_v2.md, 5.3): она стоит на наборе `kit`. */
const ArmyPanel = lazy(() => nextUi().then((m) => ({ default: m.ArmyPanel })));
/** «Жители» (UI-5, docs/ui_v2.md, 5.4) — тем же куском: сводка и места работы стоят на наборе `kit` и подсказках верха. */
const PeoplePanel = lazy(() => nextUi().then((m) => ({ default: m.PeoplePanel })));
// Окна осады, вылазки и лагеря (UI-7, docs/ui_v2.md, 5.6) — тем же куском: вкладки, таблицы и переключатели набора `kit`.
const SiegePanel = lazy(() => nextUi().then((m) => ({ default: m.SiegePanel })));
const SortiePanel = lazy(() => nextUi().then((m) => ({ default: m.SortiePanel })));
const CampPanel = lazy(() => nextUi().then((m) => ({ default: m.CampPanel })));
// «Мораль» и «Порядок» (UI-8, docs/ui_v2.md, 5.7) — тем же куском: таблицы разбора, полоса с порогами и вкладки набора `kit`.
// Окно постройки — тоже: «Что даёт городу» и выход — таблицами с разбором и дверью (5.7).
const BuildingPanel = lazy(() => nextUi().then((m) => ({ default: m.BuildingPanel })));
const MoralePanel = lazy(() => nextUi().then((m) => ({ default: m.MoralePanel })));
const OrderPanel = lazy(() => nextUi().then((m) => ({ default: m.OrderPanel })));
/** «Здания» низа (РТ-1): сетка всех построек и очередь стройки — тем же куском, рядом с окном постройки. */
const BuildingsPanel = lazy(() => nextUi().then((m) => ({ default: m.BuildingsPanel })));

/**
 * Промыслы — мини-игры от первого лица — свой кусок, как предыстория: качается по кнопке входа, и пока игра идёт,
 * города нет вовсе — контекст WebGL один (docs/minigames.md, 7).
 */
const Minigame = lazy(() => import('./minigames/Minigame').then((m) => ({ default: m.Minigame })));
// Лагерь бродяги (ПН-12л) — главный экран отряда вместо диорамы города; своим куском, только за `roamOn` и в фазе бродяги.
const CampScreen = lazy(() => import('./ui/camp/CampScreen'));
/** «Сообщить об ошибке» — своим куском: открывают его редко (docs/admin.md). */
const BugReport = lazy(() => import('./ui/parts/BugReport').then((m) => ({ default: m.BugReport })));

/**
 * Окно «Настройки» стартового экрана — то, что `App` отдаёт экрану (ОС-1): касание до того, как кусок доехал, ставит окно с
 * «Готово» и пустой границей ожидания — не ошибку и не пустой экран, — кусок доехал — настройки. Ловушка над куском: не доехал
 * вовсе — «Игра обновилась». Держит `ui/lazydoors.test.ts`.
 */
export function StartSettings() {
  return (
    <Crash where="настройки" inline>
      <Suspense fallback={null}>
        <Settings />
      </Suspense>
    </Crash>
  );
}

/**
 * Шторка окон своей границей ожидания (ОС-1): касание до того, как кусок доехал, ждёт его, не роняя город и соседние окна, —
 * кусок доехал — шторка встаёт открытой с окном внутри. Держит `ui/lazydoors.test.ts`.
 */
export function SheetDoor(props: ComponentProps<typeof SheetBody>) {
  return (
    <Suspense fallback={null}>
      <Sheet {...props} />
    </Suspense>
  );
}

/** Пока едет кусок промысла — тот же тёмный фон, что у игры: мигать другим цветом незачем. */
const MINI_WAIT = { position: 'fixed', inset: 0, zIndex: 80, background: 'var(--bg)' } as const;

function SheetContent({ view }: { view: SheetView }) {
  if (view.kind === 'building')
    return (
      <Suspense fallback={null}>
        <BuildingPanel id={view.id} />
      </Suspense>
    );
  if (view.kind === 'world')
    return (
      <Suspense fallback={null}>
        <WorldNew x={view.x} y={view.y} />
      </Suspense>
    );
  if (view.kind === 'marches')
    return (
      <Suspense fallback={null}>
        <MarchesNew />
      </Suspense>
    );
  if (view.kind === 'sortie')
    return (
      <Suspense fallback={null}>
        <SortiePanel machine={view.machine} ring={view.ring} />
      </Suspense>
    );
  if (view.kind === 'siege')
    return (
      <Suspense fallback={null}>
        <SiegePanel />
      </Suspense>
    );
  if (view.kind === 'camp')
    return (
      <Suspense fallback={null}>
        <CampPanel />
      </Suspense>
    );
  if (view.kind === 'report')
    return (
      <Suspense fallback={null}>
        <ReportPanel id={view.id} />
      </Suspense>
    );
  switch (view.tab) {
    case 'people':
      return (
        <Suspense fallback={null}>
          <PeoplePanel />
        </Suspense>
      );
    case 'quests':
      return (
        <Suspense fallback={null}>
          <QuestsPanel />
        </Suspense>
      );
    case 'season':
      return (
        <Suspense fallback={null}>
          <SeasonPanel />
        </Suspense>
      );
    case 'pop':
      return (
        <Suspense fallback={null}>
          <PopPanel />
        </Suspense>
      );
    case 'morale':
      return (
        <Suspense fallback={null}>
          <MoralePanel />
        </Suspense>
      );
    case 'order':
      return (
        <Suspense fallback={null}>
          <OrderPanel />
        </Suspense>
      );
    case 'army':
      return (
        <Suspense fallback={null}>
          <ArmyPanel />
        </Suspense>
      );
    case 'buildings':
      return (
        <Suspense fallback={null}>
          <BuildingsPanel />
        </Suspense>
      );
  }
}

export function App() {
  const ready = useGame((g) => g.ready);
  const sheet = useGame((g) => g.sheet);
  // Окна-списки во всю высоту шторки (РТ-1): «Здания» — сетка всех построек, Ратуша — совет тремя карточками; рынок (РН-1) —
  // плитки товаров и панель сделки в одном поле зрения.
  const hallId = useGame((g) => g.s.buildings.find((b) => b.type === 'town_hall')?.id ?? null);
  const marketId = useGame((g) => g.s.buildings.find((b) => b.type === 'market')?.id ?? null);
  const tallSheet = (sheet?.kind === 'tab' && sheet.tab === 'buildings') || (sheet?.kind === 'building' && (sheet.id === hallId || sheet.id === marketId));
  const closeSheet = useGame((g) => g.closeSheet);
  const toast = useGame((g) => g.toast);
  const init = useGame((g) => g.init);
  const cheat = useGame((g) => g.cheat);
  const cheated = useGame((g) => g.s.cheated);
  const mapOpen = useGame((g) => g.mapOpen);
  const camp = useGame((g) => roamOn() && g.s.phase === 'roam');
  const realmOpen = useRealm((r) => r.open);
  const hideRealm = useRealm((r) => r.hide);
  const hideBug = useBugReport((b) => b.hide);
  const closeMap = useGame((g) => g.closeMap);
  const tradesOpen = useTrades((t) => t.open);
  const treasuryOpen = useTreasury((t) => t.open);
  const hideTreasury = useTreasury((t) => t.hide);
  const hideTrades = useTrades((t) => t.hide);
  const playing = useTrades((t) => t.playing);
  const bugOpen = useBugReport((b) => b.open);
  const stopPlaying = useTrades((t) => t.stop);
  const bootWorld = useWorld((g) => g.boot);
  // Пока идёт обучение, его строка стоит над низом: держава нового вида встаёт выше неё (`next.css`, `tut-on`),
  // иначе строка накрыла бы закреплённую полосу «Изучить», к которой обучение и ведёт.
  const tut = useGame((g) => tutorialActive(g.s));
  // Содержимое шторки переживает закрытие, чтобы она не уезжала пустой.
  const [shown, setShown] = useState<SheetView | null>(null);
  /**
   * Вошёл ли игрок в партию. До этого поверх всего стоит стартовый экран.
   *
   * Состояние местное, а не в сторе, нарочно: снаружи на стартовый экран ничто
   * не ведёт и вернуться на него нельзя — он бывает один раз за запуск. Полю в
   * общем сторе тут делать нечего (сравни с `townTab`: тот в сторе именно
   * потому, что на него ведёт ссылка из справки о морали).
   */
  const [started, setStarted] = useState(false);
  /** Заставка, растворяющаяся в городе после входа (`StartVeil`): полсекунды, потом её нет. */
  const [veil, setVeil] = useState(false);
  /**
   * Открыта ли предыстория. Тоже местное состояние: в неё ведёт одна временная
   * кнопка со стартового экрана, и знать о ней ни сцене, ни симуляции незачем.
   */
  const [prologue, setPrologue] = useState(false);
  const appRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void init();
  }, [init]);

  // Замер разделения сцен: стор нужен из консоли, чтобы гонять переход туда-сюда
  // и снимать кучу между ними. Только по флагу `?probe=1` (см. src/debug.ts).
  useEffect(() => {
    if (probe()) (window as unknown as { __game?: typeof useGame }).__game = useGame;
  }, []);

  // Звук города ждёт первого касания игрока: в вебвью Telegram звук без жеста не заиграет вовсе (docs/audio.md).
  // Годится любое нажатие в интерфейсе — отдельной кнопки «включить звук» у города нет и заводить её не надо.
  //
  // Слушатель не снимается после первого раза нарочно: при выключенном звуке `arm` ничего не делает и не качает, и
  // следующее нажатие после включения обязано сработать; а уснувший в фоне контекст каждое касание будит. Само `arm`
  // идемпотентно — контекст один на все жесты. Нажатая кнопка — тихий щелчок (`cue('tap')`, не чаще, чем раз в 90 мс).
  useEffect(() => {
    const wake = (): void => cityAudio.arm();
    const click = (e: MouseEvent): void => {
      if (e.target instanceof Element && e.target.closest('button:not(:disabled)')) cityAudio.cue('tap');
    };
    document.addEventListener('pointerdown', wake, { passive: true });
    document.addEventListener('click', click, { capture: true, passive: true });
    return () => {
      document.removeEventListener('pointerdown', wake);
      document.removeEventListener('click', click, { capture: true });
    };
  }, []);

  // Свои звуки поверх города — промысел и предыстория — глушат его музыку и фон (ролик боя глушит сам).
  useEffect(() => cityAudio.hush('mini', Boolean(playing)), [playing]);
  useEffect(() => cityAudio.hush('prologue', prologue), [prologue]);

  // Мир запускается после загрузки сохранения: иначе первый же его отклик
  // применил бы последствия походов к состоянию, которое вот-вот заменят.
  useEffect(() => {
    if (ready) void bootWorld();
  }, [ready, bootWorld]);

  // Карта, «Рейтинг», «Молва края» и окно зимы — кодом, без отрисовки: после входа в партию, когда замок встал целиком, в
  // простое и не на медленной сети (`boot/warm`, РТ-2б). На медленной куски едут по касанию (зима — к своему часу).
  useEffect(() => {
    if (ready && started) return warmAfter([...MAP_CHUNKS, winterUi]);
  }, [ready, started]);

  // Весть Telegram о предложении соседа ведёт кнопкой прямо к нему (ДП-1): когда игрок вошёл в партию и мир поднят.
  useEffect(() => {
    if (ready && started) openFromLink();
  }, [ready, started]);

  // Закрытая шторка выходит за нижний край, и браузер иногда прокручивает
  // к ней весь экран — тогда верхний HUD уезжает за границу. Жёстко возвращаем в ноль.
  useEffect(() => {
    const el = appRef.current;
    if (!el) return;
    const reset = () => {
      if (el.scrollTop !== 0) el.scrollTop = 0;
      if (el.scrollLeft !== 0) el.scrollLeft = 0;
    };
    reset();
    el.addEventListener('scroll', reset, { passive: true });
    return () => el.removeEventListener('scroll', reset);
  }, [ready]);

  useEffect(() => {
    if (sheet) {
      setShown(sheet);
      return;
    }
    const t = setTimeout(() => setShown(null), 320);
    return () => clearTimeout(t);
  }, [sheet]);

  // Пока сохранение читается, рисовать нечего: экран загрузки лежит в index.html
  // и уже стоит на экране — свой, из бандла, появился бы только после бандла.
  if (!ready) return null;

  return (
    // Класс `ui-new` — область правил нового интерфейса (`next/next.css`, `realm-new.css`); прежний удалён
    // (docs/ui_audit.md, 16), а класс остался: им держатся эти правила.
    <div className={`app ui-new${tut ? ' tut-on' : ''}`} ref={appRef}>
      {/* Сцена остаётся в DOM и под картой: её рендер-луп встаёт, но геометрия
          жива, и переход в обе стороны мгновенный. Выгружать её на время карты
          пробовали и откатили — размен памяти на задержку оказался невыгодным,
          числа в docs/loading.md. */}
      {/* Пока открыта предыстория, диорамы нет вовсе — не приостановлена, а
          разобрана: контекст WebGL в игре один, и делить его между двумя живыми
          сценами нельзя (подробно — в `prologue/Prologue.tsx`). */}
      {!prologue && !playing && !camp && <GameCanvas />}
      {camp && !prologue && !playing && !mapOpen && (
        <Crash where="лагерь" onClose={useGame.getState().openMap}>
          <Suspense fallback={null}>
            <CampScreen />
          </Suspense>
        </Crash>
      )}
      {mapOpen && (
        <Crash where="карта" onClose={closeMap}>
          <Suspense fallback={null}>
            <WorldMap />
          </Suspense>
        </Crash>
      )}
      {!mapOpen && !camp && <Suspense fallback={null}><Hud /></Suspense>}
      <Suspense fallback={null}><Alerts /></Suspense>
      {/* Тревоги войны — осада, набеги, свой лагерь — значками справа внизу, над нижней панелью (П-7): её не
          разбирают, из-под неё выходят. На карте столбец стоит внутри её слоя (`WorldMap`), под меню приказов.
          Письма и события ждут в почте державы («Решения» за гербом). */}
      {/* Кнопка кодов — раньше значков нарочно: по этому порядку стиль и отодвигает
          столбец вверх (`.cheat ~ .nx-signs`), а выключенные коды не рисуют
          ничего, и столбец возвращается на своё место сам. */}
      {!mapOpen && !camp && <CheatPanel where="village" marked={cheated} onApply={cheat} />}
      {!mapOpen && !camp && <Suspense fallback={null}><WarSigns where="city" /></Suspense>}
      <SheetDoor open={sheet !== null} onClose={closeSheet} tall={tallSheet}>
        {shown && (
          <Crash key={JSON.stringify(shown)} where={`шторка ${shown.kind}`} onClose={closeSheet} inline>
            <SheetContent view={shown} />
          </Crash>
        )}
      </SheetDoor>
      <SheetDoor open={tradesOpen && !mapOpen} onClose={hideTrades}>
        {/* Содержимое переживает закрытие, пока шторка уезжает (как у шторки построек выше). */}
        <Leave open={tradesOpen} ms={320}>
          <Crash where="промыслы" onClose={hideTrades} inline>
            <Suspense fallback={null}>
              <Trades />
            </Suspense>
          </Crash>
        </Leave>
      </SheetDoor>
      {/* Сокровищница (docs/gems.md) — тем же приёмом, что промыслы: своё окно, встаёт вместо шторки. */}
      <SheetDoor open={treasuryOpen && !mapOpen} onClose={hideTreasury}>
        <Leave open={treasuryOpen} ms={320}>
          <Crash where="сокровищница" onClose={hideTreasury} inline>
            <Suspense fallback={null}>
              <Treasury />
            </Suspense>
          </Crash>
        </Leave>
      </SheetDoor>
      {!mapOpen && !camp && <Suspense fallback={null}><Nav /></Suspense>}
      {/* Меню державы появляется и уходит плавно (`leave.tsx`): закрытое ещё тает, касаний не беря. */}
      <Leave open={!mapOpen && realmOpen}>
        <Crash where="держава" onClose={hideRealm}>
          <Suspense fallback={null}>
            <RealmMenu />
          </Suspense>
        </Crash>
      </Leave>
      <WinterModal />
      <Suspense fallback={null}>
        <OfflineModal />
        <LegacyModal />
        <PaceModal />
        <RoomModal />
      </Suspense>
      <Suspense fallback={null}><TutorialOverlay /></Suspense>
      {toast && <div className="toast">{toast}</div>}
      <Suspense fallback={null}>
        <TipLayer />
      </Suspense>
      {/* Подсказки новичку по ходу игры — после входа в партию (docs/rating.md). */}
      {started && (
        <Suspense fallback={null}>
          <Hints />
        </Suspense>
      )}
      {/* Последним нарочно: до ответа игрока партия не сохраняется никуда, и
          этот вопрос обязан стоять поверх остальных окон. Своего слоя у него
          нет — он просто идёт после них. */}
      <SyncModal />
      {/* Заморозка — плашка поверх игры, забирающая касания (docs/admin.md). */}
      <Frozen />
      {/*
        Стартовый экран поверх всего, включая окна: пока игрок не вошёл, ему
        нечего решать про партию, в которую он ещё не зашёл. Вопрос второй
        вкладки, отброшенное старое сохранение, итог офлайна — всё это дождётся
        входа и будет задано по одному, а не стопкой поверх заставки.

        Появляется он вместе с приложением, то есть когда игра уже готова, и
        снимается мгновенно — тем же движением, каким снимается экран загрузки
        под ним; гаснет поверх города уже его кадр (`StartVeil`), касаний не беря.
      */}
      {!started && !prologue && (
        <StartScreen
          onEnter={() => {
            setStarted(true);
            setVeil(true);
          }}
          onPrologue={() => setPrologue(true)}
          onRoam={async () => {
            const why = await useGame.getState().beginRoamParty();
            if (why) return why;
            setStarted(true);
            setVeil(true);
            return null;
          }}
          naming={(done) => (
            <Suspense fallback={null}>
              <CityNaming onDone={done} />
            </Suspense>
          )}
          settings={<StartSettings />}
        />
      )}
      {veil && <StartVeil onDone={() => setVeil(false)} />}
      {/*
        Предыстория поверх всего и вместо всего: пока она открыта, диорама
        разобрана, стартовый экран не рисуется, а выход возвращает ровно туда,
        откуда пришли. Запасной вид у Suspense — тот же фон, что у стартового
        экрана: чанк едет доли секунды, и мигать другим цветом ради них незачем.
      */}
      {prologue && (
        <Crash where="предыстория" onClose={() => setPrologue(false)}>
          <Suspense fallback={<div className="pro pro-wait">Поляна…</div>}>
            <Prologue onExit={() => setPrologue(false)} />
          </Suspense>
        </Crash>
      )}
      {/* Промысел — поверх всего и вместо города, как предыстория: выход возвращает в город. */}
      {playing && (
        <Crash where="промысел" onClose={stopPlaying}>
          <Suspense fallback={<div style={MINI_WAIT} />}>
            <Minigame game={playing} onExit={stopPlaying} />
          </Suspense>
        </Crash>
      )}
      {/* «Сообщить об ошибке» — поверх всего: его открывают из меню, со стартового экрана и с плашки заморозки. */}
      {bugOpen && (
        <Crash where="сообщить об ошибке" onClose={hideBug}>
          <Suspense fallback={null}>
            <BugReport />
          </Suspense>
        </Crash>
      )}
    </div>
  );
}
