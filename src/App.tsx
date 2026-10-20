import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useGame, type SheetView } from './game/store';
import { GameCanvas } from './ui/GameCanvas';
import { Sheet } from './ui/Sheet';
import { QuestsPanel } from './ui/panels/QuestsPanel';
import { SeasonPanel } from './ui/panels/SeasonPanel';
import { PopPanel } from './ui/panels/PopPanel';
import { WinterModal } from './ui/WinterModal';
import { OfflineModal } from './ui/OfflineModal';
import { LegacyModal } from './ui/LegacyModal';
import { PaceModal } from './ui/PaceModal';
import { TutorialOverlay } from './ui/TutorialOverlay';
import { WorldMap } from './ui/map/WorldMap';
import { StartScreen, StartVeil } from './ui/StartScreen';
import { SyncModal } from './ui/SyncModal';
import { Frozen } from './ui/parts/Frozen';
import { useBugReport } from './ui/parts/bugOpen';
import { ReportPanel } from './ui/panels/ReportPanel';
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

/**
 * Интерфейс — свой кусок (`ui/next/index.ts`): едет, пока стоит стартовый экран. Прежний интерфейс, что ехал в первой
 * загрузке запасным видом, удалён (docs/ui_audit.md, 16). Четыре части — один кусок: `import` один и тот же.
 */
const nextUi = () => import('./ui/next');
const Hud = lazy(() => nextUi().then((m) => ({ default: m.Hud })));
const Alerts = lazy(() => nextUi().then((m) => ({ default: m.Alerts })));
const WarSigns = lazy(() => nextUi().then((m) => ({ default: m.WarSigns })));
const Nav = lazy(() => nextUi().then((m) => ({ default: m.Nav })));
const TipLayer = lazy(() => nextUi().then((m) => ({ default: m.TipLayer })));
const Hints = lazy(() => nextUi().then((m) => ({ default: m.Hints })));
/** Шаг «Как назовёшь город?» стартового экрана — тем же куском: сам экран ничего не грузит (`start.test.ts`). */
const CityNaming = lazy(() => nextUi().then((m) => ({ default: m.CityNaming })));
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

/**
 * Промыслы — мини-игры от первого лица — свой кусок, как предыстория: качается по кнопке входа, и пока игра идёт,
 * города нет вовсе — контекст WebGL один (docs/minigames.md, 7).
 */
const Minigame = lazy(() => import('./minigames/Minigame').then((m) => ({ default: m.Minigame })));
/** «Сообщить об ошибке» — своим куском: открывают его редко (docs/admin.md). */
const BugReport = lazy(() => import('./ui/parts/BugReport').then((m) => ({ default: m.BugReport })));

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
  if (view.kind === 'report') return <ReportPanel id={view.id} />;
  switch (view.tab) {
    case 'people':
      return (
        <Suspense fallback={null}>
          <PeoplePanel />
        </Suspense>
      );
    case 'quests':
      return <QuestsPanel />;
    case 'season':
      return <SeasonPanel />;
    case 'pop':
      return <PopPanel />;
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
  }
}

export function App() {
  const ready = useGame((g) => g.ready);
  const sheet = useGame((g) => g.sheet);
  const closeSheet = useGame((g) => g.closeSheet);
  const toast = useGame((g) => g.toast);
  const init = useGame((g) => g.init);
  const cheat = useGame((g) => g.cheat);
  const cheated = useGame((g) => g.s.cheated);
  const mapOpen = useGame((g) => g.mapOpen);
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
      {!prologue && !playing && <GameCanvas />}
      {mapOpen && (
        <Crash where="карта" onClose={closeMap}>
          <WorldMap />
        </Crash>
      )}
      {!mapOpen && <Suspense fallback={null}><Hud /></Suspense>}
      <Suspense fallback={null}><Alerts /></Suspense>
      {/* Тревоги войны — осада, набеги, свой лагерь — значками справа внизу, над нижней панелью (П-7): её не
          разбирают, из-под неё выходят. На карте столбец стоит внутри её слоя (`WorldMap`), под меню приказов.
          Письма и события ждут в почте державы («Решения» за гербом). */}
      {/* Кнопка кодов — раньше значков нарочно: по этому порядку стиль и отодвигает
          столбец вверх (`.cheat ~ .nx-signs`), а выключенные коды не рисуют
          ничего, и столбец возвращается на своё место сам. */}
      {!mapOpen && <CheatPanel where="village" marked={cheated} onApply={cheat} />}
      {!mapOpen && <Suspense fallback={null}><WarSigns where="city" /></Suspense>}
      <Sheet open={sheet !== null} onClose={closeSheet}>
        {shown && (
          <Crash key={JSON.stringify(shown)} where={`шторка ${shown.kind}`} onClose={closeSheet} inline>
            <SheetContent view={shown} />
          </Crash>
        )}
      </Sheet>
      <Sheet open={tradesOpen && !mapOpen} onClose={hideTrades}>
        {/* Содержимое переживает закрытие, пока шторка уезжает (как у шторки построек выше). */}
        <Leave open={tradesOpen} ms={320}>
          <Crash where="промыслы" onClose={hideTrades} inline>
            <Suspense fallback={null}>
              <Trades />
            </Suspense>
          </Crash>
        </Leave>
      </Sheet>
      {/* Сокровищница (docs/gems.md) — тем же приёмом, что промыслы: своё окно, встаёт вместо шторки. */}
      <Sheet open={treasuryOpen && !mapOpen} onClose={hideTreasury}>
        <Leave open={treasuryOpen} ms={320}>
          <Crash where="сокровищница" onClose={hideTreasury} inline>
            <Suspense fallback={null}>
              <Treasury />
            </Suspense>
          </Crash>
        </Leave>
      </Sheet>
      {!mapOpen && <Suspense fallback={null}><Nav /></Suspense>}
      {/* Меню державы появляется и уходит плавно (`leave.tsx`): закрытое ещё тает, касаний не беря. */}
      <Leave open={!mapOpen && realmOpen}>
        <Crash where="держава" onClose={hideRealm}>
          <Suspense fallback={null}>
            <RealmMenu />
          </Suspense>
        </Crash>
      </Leave>
      <WinterModal />
      <OfflineModal />
      <LegacyModal />
      <PaceModal />
      <TutorialOverlay />
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
          naming={(done) => (
            <Suspense fallback={null}>
              <CityNaming onDone={done} />
            </Suspense>
          )}
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
