import { useEffect, useState } from 'react';
import { useGame } from '@/game/store';
import { alerts, buildingOfType } from '@/game/derived';
import { tutorialActive } from '@/game/data/tutorial';
import { incomingMarches, useWorld, worldNow } from '@/world/store';
import { formatLeft, secondsLeft } from '@/world/geo';
import { FIGURE_BY_ID, FIGURE_IDS } from '@/world/data/figures';
import { HIRE_AT } from '@/game/data/hire';
import { hireWhere } from '@/game/sim/hire';
import type { BuildingTypeId } from '@/game/types';
import { lettersVisible } from './Letters';
import { Icon } from '@/ui/icons/Icon';
import { iconName } from '@/ui/icons/registry';
import { useLockWords } from '@/ui/parts/defenseLock';

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
  const openTab = useGame((g) => g.openTab);
  const openDefense = useGame((g) => g.openDefense);
  const marches = useWorld((g) => g.marches);
  const eventResult = useGame((g) => g.eventResult);
  const mapOpen = useGame((g) => g.mapOpen);
  const letters = useWorld((g) => g.letters);
  // Про этот набег уже написано в письме, и оно стоит на том же экране: две
  // одинаковые строки — не забота, а шум. На карте письма нет, и строка тревог
  // остаётся единственным предупреждением — там она и показывается.
  const lettered = lettersVisible(s, eventResult, mapOpen)
    ? new Set(letters.filter((l) => l.marchId).map((l) => l.marchId))
    : new Set<string | undefined>();
  const raids = incomingMarches(marches).filter((m) => !lettered.has(m.id));
  // Замок один на всю оборону и считается по всем отрядам, а не по строке: строка
  // второго набега не может сказать «открыто», пока расстановка заперта первым.
  const lock = useLockWords();
  const [, retick] = useState(0);

  // Пока кто-то идёт на нас, счётчик должен тикать каждую секунду сам.
  useEffect(() => {
    if (raids.length === 0) return;
    const t = setInterval(() => retick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [raids.length]);

  const list = alerts(s);
  // Пустые места агентов, на которые не идёт найм: строка на здание, где нанимают.
  // Своего поля тревоги у них нет — `derived` про людей на местах не знает нарочно
  // (`agents.owners.test.ts`), — поэтому строка собирается здесь, из `s.agents`.
  const empty = new Map<BuildingTypeId, string[]>();
  for (const id of FIGURE_IDS) {
    const p = s.agents[id];
    if (!p.vacant || p.hiring) continue;
    const at = HIRE_AT[id];
    empty.set(at, [...(empty.get(at) ?? []), FIGURE_BY_ID[id].name.toLowerCase()]);
  }
  if (list.length === 0 && raids.length === 0 && empty.size === 0) return null;

  return (
    // На карте строка встаёт вплотную под её шапку, а не туда, где стоит в
    // деревне: там над ней две строки HUD и полоска ресурсов, а здесь — только
    // координаты и кнопка возврата. Посреди пустой земли она читалась меткой на
    // местности, то есть чем-то, что стоит **там**; прижатая к шапке — тем, чем
    // и является: продолжением шапки.
    <div className={`alerts${mapOpen ? ' on-map' : ''}${tutorialActive(s) ? ' with-tut' : ''}`}>
      {raids.map((m) => {
        // Тап ведёт туда, где это чинят: к расстановке обороны. После отметки
        // «минус 5 минут» она заперта — и строка говорит об этом словами общего замка.
        return (
          <button key={m.id} className="alert raid" onClick={openDefense}>
            <span className="ic">
              <Icon name={lock.frozen ? 'alert-locked' : 'alert-raid'} glyph={lock.frozen ? '🔒' : '⚔️'} />
            </span>
            <span className="txt">
              Набег: {m.fromName} · {formatLeft(secondsLeft(m.arriveAt, worldNow()))}
              {lock.short ? ` · ${lock.short}` : ''}
            </span>
          </button>
        );
      })}
      {[...empty.entries()].map(([type, who]) => {
        const b = buildingOfType(s, type);
        const general = who.includes(FIGURE_BY_ID.general.name.toLowerCase());
        return (
          <button key={`vacant-${type}`} className="alert" onClick={() => b && openBuilding(b.id)} disabled={!b}>
            <span className="ic">{general ? '🎖️' : '👣'}</span>
            <span className="txt">
              Место пустует: {who.join(', ')} — нанять {hireWhere(s, FIGURE_IDS.find((id) => HIRE_AT[id] === type) ?? 'scout')}
              {general ? ' · армия не выходит' : ''}
            </span>
          </button>
        );
      })}
      {list.map((a) => {
        const target = a.goto ? buildingOfType(s, a.goto) : null;
        // Порядок чинят не в здании: тревога ведёт в справку, где сказано, кто
        // держит невольников и какие рычаги есть.
        const tab = a.open;
        const go = tab ? () => openTab(tab) : target ? () => openBuilding(target.id) : null;
        return (
          <button key={a.id} className="alert" onClick={() => go?.()} disabled={!go}>
            <span className="ic">
              <Icon name={iconName('alert', a.id)} glyph={a.icon} />
            </span>
            <span className="txt">
              {a.text}
              {/* Цена — второй строкой прямо под сроком: так же, как у голода под осадой. */}
              {a.sub && <small className="alert-sub">{a.sub}</small>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
