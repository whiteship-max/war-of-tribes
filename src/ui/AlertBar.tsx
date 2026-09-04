import { useEffect, useState } from 'react';
import { useGame } from '@/game/store';
import { alerts, buildingOfType } from '@/game/derived';
import { tutorialActive } from '@/game/data/tutorial';
import { incomingMarches, useWorld, worldNow } from '@/world/store';
import { formatLeft, secondsLeft } from '@/world/geo';

/**
 * Критические состояния всплывают поверх любого экрана: голод, остывший очаг и
 * чужой отряд на подходе. Тап ведёт туда, где это чинят.
 *
 * Набег всегда виден заранее и с таймером: у игрока должно быть время вернуть
 * армию из похода или встретить гостей — внезапных потерь эта игра не делает.
 */
export function AlertBar() {
  const s = useGame((g) => g.s);
  const openBuilding = useGame((g) => g.openBuilding);
  const openMap = useGame((g) => g.openMap);
  const mapOpen = useGame((g) => g.mapOpen);
  const raids = incomingMarches(useWorld((g) => g.marches));
  const [, retick] = useState(0);

  // Пока кто-то идёт на нас, счётчик должен тикать каждую секунду сам.
  useEffect(() => {
    if (raids.length === 0) return;
    const t = setInterval(() => retick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [raids.length]);

  const list = alerts(s);
  if (list.length === 0 && raids.length === 0) return null;

  return (
    <div className={`alerts${tutorialActive(s) ? ' with-tut' : ''}`}>
      {raids.map((m) => (
        <button key={m.id} className="alert raid" onClick={() => !mapOpen && openMap()}>
          <span className="ic">⚔️</span>
          <span className="txt">
            Набег: {m.fromName} · {formatLeft(secondsLeft(m.arriveAt, worldNow()))}
          </span>
        </button>
      ))}
      {list.map((a) => {
        const target = a.goto ? buildingOfType(s, a.goto) : null;
        return (
          <button key={a.id} className="alert" onClick={() => target && openBuilding(target.id)} disabled={!target}>
            <span className="ic">{a.icon}</span>
            <span className="txt">{a.text}</span>
          </button>
        );
      })}
    </div>
  );
}
