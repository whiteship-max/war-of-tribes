import { useGame } from '@/game/store';
import { alerts, buildingOfType } from '@/game/derived';
import { eventLeft } from '@/game/sim/mail';
import { MUTINY_EVENT, ORDER_TEXT } from '@/game/data/order';
import { tutorialActive } from '@/game/data/tutorial';
import { useWorld, worldNow } from '@/world/store';
import { realDue, realLeft } from '@/ui/parts/wait';
import { FIGURE_BY_ID, FIGURE_IDS } from '@/world/data/figures';
import { HIRE_AT } from '@/game/data/hire';
import { hireWhere } from '@/game/sim/hire';
import { bareGeneral } from '@/game/sim/agents';
import { placeOpen } from '@/game/sim/tech';
import type { BuildingTypeId } from '@/game/types';
import { Icon } from '@/ui/icons/Icon';
import { iconName } from '@/ui/icons/registry';
import { useRaidWords } from '@/ui/parts/raidWords';
import { openRaid, useRealm } from '@/ui/realm/open';
import { eventKey } from '@/ui/realm/unread';

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
  const mapOpen = useGame((g) => g.mapOpen);
  const general = useWorld((g) => g.figures.find((f) => f.id === 'general'));
  // Письмо о набеге ждёт в почте державы, за гербом, а не на экране: строка
  // тревоги остаётся предупреждением на виду — и в деревне, и на карте. Отсчёт
  // каждой строки идёт сам, пока кто-то идёт на нас (`useRaidWords`).
  const raids = useRaidWords();
  // Мятеж ждёт ответа в почте сутки, как любое донесение, — но невольники всё это время стоят,
  // и молчание его — самая жёсткая потеря в игре: строка на виду ведёт прямо к нему.
  const openMail = useRealm((r) => r.openMail);
  const mutiny = s.inbox.find((e) => e.defId === MUTINY_EVENT) ?? null;
  const mutinyLeft = mutiny ? eventLeft(mutiny, worldNow()) : null;
  const list = alerts(s);
  // Пустые места агентов, на которые не идёт найм: строка на здание, где нанимают.
  // Своего поля тревоги у них нет — `derived` про людей на местах не знает нарочно
  // (`agents.owners.test.ts`), — поэтому строка собирается здесь, из `s.agents`.
  const empty = new Map<BuildingTypeId, string[]>();
  for (const id of FIGURE_IDS) {
    const p = s.agents[id];
    if (!p.vacant || p.hiring) continue;
    // Место, которого держава ещё не открыла, — не пустое место, а отсутствующее:
    // звать нанимать туда, куда нанять нельзя, значит тревожить впустую.
    if (!placeOpen(s, id)) continue;
    const at = HIRE_AT[id];
    empty.set(at, [...(empty.get(at) ?? []), FIGURE_BY_ID[id].name.toLowerCase()]);
  }
  // Новый полководец без дружины: дружина прежнего осталась городу или пала с ним, и
  // преемник сидит дома, пока её не соберут. Строка держится, пока не соберут или пока
  // он не сходит в первый бой. Решает одно правило (`sim/agents.bareGeneral`).
  const bare = bareGeneral(s, general);
  const statue = buildingOfType(s, 'statue');
  if (list.length === 0 && raids.length === 0 && empty.size === 0 && !bare && !mutiny) return null;

  return (
    // На карте строка встаёт вплотную под её шапку, а не туда, где стоит в
    // деревне: там над ней две строки HUD и полоска ресурсов, а здесь — только
    // координаты и кнопка возврата. Посреди пустой земли она читалась меткой на
    // местности, то есть чем-то, что стоит **там**; прижатая к шапке — тем, чем
    // и является: продолжением шапки.
    <div className={`alerts${mapOpen ? ' on-map' : ''}${tutorialActive(s) ? ' with-tut' : ''}`}>
      {mutiny && (
        <button key="mutiny" className="alert raid" onClick={() => openMail(eventKey(mutiny))}>
          <span className="ic">{ORDER_TEXT.mutiny.icon}</span>
          <span className="txt">
            {ORDER_TEXT.mutiny.alert}{mutinyLeft !== null ? ` · ${realDue(mutinyLeft)}` : ''}
          </span>
        </button>
      )}
      {raids.map(({ win, short }) => {
        // Тап ведёт туда, где это решают: в донесение о набеге — перехват на карте и
        // сбор дружины. Сколько ещё успевает полный сбор — словами общего окна; не
        // успевает — у строки значок времени: запертого тут ничего нет (замка обороны
        // больше нет, поставка 2 боя), вышло время полного сбора.
        const m = win.march;
        return (
          <button key={m.id} className="alert raid" onClick={() => openRaid(m.id)}>
            <span className="ic">
              <Icon name={win.late ? 'ui-time' : 'alert-raid'} glyph={win.late ? '⏳' : '⚔️'} />
            </span>
            <span className="txt">
              Набег: {m.fromName} · {realLeft(win.seconds)}
              {short ? ` · ${short}` : ''}
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
      {bare && (
        <button key="bare-general" className="alert" onClick={() => statue && openBuilding(statue.id)} disabled={!statue}>
          <span className="ic">🎖️</span>
          <span className="txt">Новый полководец без дружины — собрать в Статуе</span>
        </button>
      )}
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
