import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useGame, type SheetView } from './game/store';
import { GameCanvas } from './ui/GameCanvas';
import { TopBar } from './ui/TopBar';
import { AlertBar } from './ui/AlertBar';
import { BottomNav } from './ui/BottomNav';
import { Sheet } from './ui/Sheet';
import { PeoplePanel } from './ui/panels/PeoplePanel';
import { BuildingPanel } from './ui/panels/BuildingPanel';
import { QuestsPanel } from './ui/panels/QuestsPanel';
import { SeasonPanel } from './ui/panels/SeasonPanel';
import { PopPanel } from './ui/panels/PopPanel';
import { MoralePanel } from './ui/panels/MoralePanel';
import { OrderPanel } from './ui/panels/OrderPanel';
import { ArmyPanel } from './ui/panels/ArmyPanel';
import { WinterModal } from './ui/WinterModal';
import { OfflineModal } from './ui/OfflineModal';
import { LegacyModal } from './ui/LegacyModal';
import { PaceModal } from './ui/PaceModal';
import { TutorialOverlay } from './ui/TutorialOverlay';
import { SiegeBanner } from './ui/SiegeBanner';
import { WorldMap } from './ui/map/WorldMap';
import { StartScreen } from './ui/StartScreen';
import { SyncModal } from './ui/SyncModal';
import { WorldPanel } from './ui/panels/WorldPanel';
import { MarchesPanel } from './ui/panels/MarchesPanel';
import { SortiePanel } from './ui/panels/SortiePanel';
import { SiegePanel } from './ui/panels/SiegePanel';
import { CampPanel } from './ui/panels/CampPanel';
import { ReportPanel } from './ui/panels/ReportPanel';
import { useWorld } from './world/store';
import { villageMusic } from './sound/web';
import { probe } from './debug';
import { CheatPanel } from './ui/CheatPanel';
import { useRealm } from './ui/realm/open';
import { useUiNew } from './ui/uimode';
import { tutorialActive } from './game/data/tutorial';

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
 * Новый интерфейс — тоже свой кусок (`ui/next/index.ts`). С 03.10.2026 он по умолчанию (`ui/uimode.ts`), и кусок
 * едет, пока стоит стартовый экран; в первой загрузке остаётся прежний — запасной вид из настроек. Четыре части —
 * один кусок: `import` один и тот же.
 */
const nextUi = () => import('./ui/next');
const Hud = lazy(() => nextUi().then((m) => ({ default: m.Hud })));
const Alerts = lazy(() => nextUi().then((m) => ({ default: m.Alerts })));
const Nav = lazy(() => nextUi().then((m) => ({ default: m.Nav })));
const TipLayer = lazy(() => nextUi().then((m) => ({ default: m.TipLayer })));
/** Шаг «Как назовёшь город?» стартового экрана — тем же куском: сам экран ничего не грузит (`start.test.ts`). */
const CityNaming = lazy(() => nextUi().then((m) => ({ default: m.CityNaming })));
/** Карточка клетки и «Походы» нового вида — тем же куском (docs/ui_audit.md, 13). */
const WorldNew = lazy(() => nextUi().then((m) => ({ default: m.WorldNew })));
const MarchesNew = lazy(() => nextUi().then((m) => ({ default: m.MarchesNew })));

function SheetContent({ view }: { view: SheetView }) {
  // Вид выбирается здесь, а не внутри панели: переключение в настройках не меняет порядок хуков у открытой панели.
  const next = useUiNew();
  if (view.kind === 'building') return <BuildingPanel id={view.id} />;
  if (view.kind === 'world')
    return next ? (
      <Suspense fallback={null}>
        <WorldNew x={view.x} y={view.y} />
      </Suspense>
    ) : (
      <WorldPanel x={view.x} y={view.y} />
    );
  if (view.kind === 'marches')
    return next ? (
      <Suspense fallback={null}>
        <MarchesNew />
      </Suspense>
    ) : (
      <MarchesPanel />
    );
  if (view.kind === 'sortie') return <SortiePanel />;
  if (view.kind === 'siege') return <SiegePanel />;
  if (view.kind === 'camp') return <CampPanel />;
  if (view.kind === 'report') return <ReportPanel id={view.id} />;
  switch (view.tab) {
    case 'people':
      return <PeoplePanel />;
    case 'quests':
      return <QuestsPanel />;
    case 'season':
      return <SeasonPanel />;
    case 'pop':
      return <PopPanel />;
    case 'morale':
      return <MoralePanel />;
    case 'order':
      return <OrderPanel />;
    case 'army':
      return <ArmyPanel />;
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
  const bootWorld = useWorld((g) => g.boot);
  // Прежний или новый интерфейс (`ui/uimode.ts`): переключение в настройках перерисовывает сразу.
  const next = useUiNew();
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

  // Музыка деревни ждёт первого нажатия игрока: в вебвью Telegram звук без
  // жеста не заиграет вовсе. Годится любое нажатие в интерфейсе — отдельной
  // кнопки «включить музыку» у деревни нет и заводить её не надо.
  //
  // Слушатель не снимается после первого раза нарочно: при выключенном звуке
  // `arm` ничего не делает и не качает, и следующее нажатие после включения
  // обязано сработать. Само `arm` идемпотентно — контекст один на все жесты.
  useEffect(() => {
    const wake = (): void => villageMusic.arm();
    document.addEventListener('pointerdown', wake, { passive: true });
    return () => document.removeEventListener('pointerdown', wake);
  }, []);

  // Мир запускается после загрузки сохранения: иначе первый же его отклик
  // применил бы последствия походов к состоянию, которое вот-вот заменят.
  useEffect(() => {
    if (ready) void bootWorld();
  }, [ready, bootWorld]);

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
    <div className={`app${next ? ' ui-new' : ''}${next && tut ? ' tut-on' : ''}`} ref={appRef}>
      {/* Сцена остаётся в DOM и под картой: её рендер-луп встаёт, но геометрия
          жива, и переход в обе стороны мгновенный. Выгружать её на время карты
          пробовали и откатили — размен памяти на задержку оказался невыгодным,
          числа в docs/loading.md. */}
      {/* Пока открыта предыстория, диорамы нет вовсе — не приостановлена, а
          разобрана: контекст WebGL в игре один, и делить его между двумя живыми
          сценами нельзя (подробно — в `prologue/Prologue.tsx`). */}
      {!prologue && <GameCanvas />}
      {mapOpen && <WorldMap />}
      {!mapOpen && (next ? <Suspense fallback={null}><Hud /></Suspense> : <TopBar />)}
      {next ? <Suspense fallback={null}><Alerts /></Suspense> : <AlertBar />}
      {/* Осада — в правом низу деревни: её не разбирают, из-под неё выходят.
          Письма и события ждут в почте державы («Решения» за гербом). */}
      {/* Кнопка кодов — раньше осады нарочно: по этому порядку стиль и отодвигает
          осадную панель вверх (`.cheat ~ .siege`), а выключенные коды не рисуют
          ничего, и панель возвращается на своё место сама. */}
      {!mapOpen && <CheatPanel where="village" marked={cheated} onApply={cheat} />}
      {!mapOpen && <SiegeBanner />}
      <Sheet open={sheet !== null} onClose={closeSheet}>
        {shown && <SheetContent view={shown} />}
      </Sheet>
      {!mapOpen && (next ? <Suspense fallback={null}><Nav /></Suspense> : <BottomNav />)}
      {!mapOpen && realmOpen && (
        <Suspense fallback={null}>
          <RealmMenu />
        </Suspense>
      )}
      <WinterModal />
      <OfflineModal />
      <LegacyModal />
      <PaceModal />
      <TutorialOverlay />
      {toast && <div className="toast">{toast}</div>}
      {next && (
        <Suspense fallback={null}>
          <TipLayer />
        </Suspense>
      )}
      {/* Последним нарочно: до ответа игрока партия не сохраняется никуда, и
          этот вопрос обязан стоять поверх остальных окон. Своего слоя у него
          нет — он просто идёт после них. */}
      <SyncModal />
      {/*
        Стартовый экран поверх всего, включая окна: пока игрок не вошёл, ему
        нечего решать про партию, в которую он ещё не зашёл. Вопрос второй
        вкладки, отброшенное старое сохранение, итог офлайна — всё это дождётся
        входа и будет задано по одному, а не стопкой поверх заставки.

        Появляется он вместе с приложением, то есть когда игра уже готова, и
        снимается мгновенно — тем же движением, каким снимается экран загрузки
        под ним.
      */}
      {!started && !prologue && (
        <StartScreen
          onEnter={() => setStarted(true)}
          onPrologue={() => setPrologue(true)}
          naming={
            next
              ? (done) => (
                  <Suspense fallback={null}>
                    <CityNaming onDone={done} />
                  </Suspense>
                )
              : null
          }
        />
      )}
      {/*
        Предыстория поверх всего и вместо всего: пока она открыта, диорама
        разобрана, стартовый экран не рисуется, а выход возвращает ровно туда,
        откуда пришли. Запасной вид у Suspense — тот же фон, что у стартового
        экрана: чанк едет доли секунды, и мигать другим цветом ради них незачем.
      */}
      {prologue && (
        <Suspense fallback={<div className="pro pro-wait">Поляна…</div>}>
          <Prologue onExit={() => setPrologue(false)} />
        </Suspense>
      )}
    </div>
  );
}
