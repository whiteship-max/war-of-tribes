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
import { WorldMap } from './ui/map/WorldMap';
import { WorldPanel } from './ui/panels/WorldPanel';
import { MarchesPanel } from './ui/panels/MarchesPanel';
import { BattlePanel } from './ui/panels/BattlePanel';
import { ReportPanel } from './ui/panels/ReportPanel';
import { useWorld } from './world/store';

function SheetContent({ view }: { view: SheetView }) {
  if (view.kind === 'building') return <BuildingPanel id={view.id} />;
  if (view.kind === 'world') return <WorldPanel x={view.x} y={view.y} />;
  if (view.kind === 'marches') return <MarchesPanel />;
  if (view.kind === 'battle') return <BattlePanel targetId={view.target} />;
  if (view.kind === 'defense') return <BattlePanel />;
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

  if (!ready) {
    return (
      <div className="loading">
        <div className="loading-fire">🔥</div>
        <div>Племя собирается у костра…</div>
      </div>
    );
  }

  return (
    <div className="app" ref={appRef}>
      {/* Сцена остаётся в DOM и под картой: её рендер-луп встаёт, но геометрия жива. */}
      <GameCanvas />
      {mapOpen && <WorldMap />}
      {!mapOpen && <TopBar />}
      <AlertBar />
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
    </div>
  );
}
