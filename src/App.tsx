import { useEffect, useRef, useState } from 'react';
import { useGame, type SheetView } from './game/store';
import { GameCanvas } from './ui/GameCanvas';
import { TopBar } from './ui/TopBar';
import { AlertBar } from './ui/AlertBar';
import { BottomNav } from './ui/BottomNav';
import { Sheet } from './ui/Sheet';
import { EventModal } from './ui/EventModal';
import { PeoplePanel } from './ui/panels/PeoplePanel';
import { BuildingPanel } from './ui/panels/BuildingPanel';
import { QuestsPanel } from './ui/panels/QuestsPanel';
import { SeasonPanel } from './ui/panels/SeasonPanel';
import { PopPanel } from './ui/panels/PopPanel';
import { MoralePanel } from './ui/panels/MoralePanel';
import { ArmyPanel } from './ui/panels/ArmyPanel';
import { ProfilePanel } from './ui/panels/ProfilePanel';
import { WinterModal } from './ui/WinterModal';
import { OfflineModal } from './ui/OfflineModal';
import { LegacyModal } from './ui/LegacyModal';
import { TutorialOverlay } from './ui/TutorialOverlay';
import { Letters } from './ui/Letters';
import { SiegeBanner } from './ui/SiegeBanner';
import { WorldMap } from './ui/map/WorldMap';
import { SceneCurtain } from './ui/SceneCurtain';
import { SyncModal } from './ui/SyncModal';
import { WorldPanel } from './ui/panels/WorldPanel';
import { MarchesPanel } from './ui/panels/MarchesPanel';
import { BattlePanel } from './ui/panels/BattlePanel';
import { SortiePanel } from './ui/panels/SortiePanel';
import { ReportPanel } from './ui/panels/ReportPanel';
import { useWorld } from './world/store';
import { villageMusic } from './sound/web';
import { probe } from './debug';

function SheetContent({ view }: { view: SheetView }) {
  if (view.kind === 'building') return <BuildingPanel id={view.id} />;
  if (view.kind === 'world') return <WorldPanel x={view.x} y={view.y} />;
  if (view.kind === 'marches') return <MarchesPanel />;
  if (view.kind === 'battle') return <BattlePanel targetId={view.target} />;
  if (view.kind === 'defense') return <BattlePanel />;
  if (view.kind === 'sortie') return <SortiePanel />;
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
    case 'army':
      return <ArmyPanel />;
    case 'profile':
      return <ProfilePanel />;
  }
}

export function App() {
  const ready = useGame((g) => g.ready);
  const sheet = useGame((g) => g.sheet);
  const closeSheet = useGame((g) => g.closeSheet);
  const toast = useGame((g) => g.toast);
  const init = useGame((g) => g.init);
  const mapOpen = useGame((g) => g.mapOpen);
  const bootWorld = useWorld((g) => g.boot);
  // Содержимое шторки переживает закрытие, чтобы она не уезжала пустой.
  const [shown, setShown] = useState<SheetView | null>(null);
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
    <div className="app" ref={appRef}>
      {/* Сцена остаётся в DOM и под картой: её рендер-луп встаёт, но геометрия
          жива, и переход в обе стороны мгновенный. Выгружать её на время карты
          пробовали и откатили — размен памяти на задержку оказался невыгодным,
          числа в docs/loading.md. */}
      <GameCanvas />
      {mapOpen && <WorldMap />}
      {!mapOpen && <TopBar />}
      <AlertBar />
      {/* Столбик писем живёт в деревне: на карте левый низ занят якорями и
          кнопками, а письмо о набеге ведёт как раз на карту. */}
      {/* Осада — в правом низу: слева письма, а осаду не разбирают, из-под неё
          выходят. Обе панели живут в деревне и по одним правилам видимости.
          Порядок здесь нужен стилям: пока осада на экране, столбик писем
          уступает ей ширину селектором `.siege ~ .letters`. */}
      {!mapOpen && <SiegeBanner />}
      {!mapOpen && <Letters />}
      <Sheet open={sheet !== null} onClose={closeSheet}>
        {shown && <SheetContent view={shown} />}
      </Sheet>
      {!mapOpen && <BottomNav />}
      <EventModal />
      <WinterModal />
      <OfflineModal />
      <LegacyModal />
      <TutorialOverlay />
      {toast && <div className="toast">{toast}</div>}
      <SceneCurtain />
      {/* Последним нарочно: до ответа игрока партия не сохраняется никуда, и
          этот вопрос обязан стоять поверх остальных окон. Своего слоя у него
          нет — он просто идёт после них. */}
      <SyncModal />
    </div>
  );
}
