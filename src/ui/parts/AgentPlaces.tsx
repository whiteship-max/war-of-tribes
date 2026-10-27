// Места агентов в профильном здании: кто на месте, идёт ли прежний найм, и кнопка «Нанять в Ратуше».
//
// Одна часть на два здания — Дозор (разведчик и лазутчик) и храм (дипломат); у Статуи с ДР-7 мест нет — полководец только в
// Ратуше (docs/city_v3.md, «Решения ДР-7»). С АГ-1 найм, смена и
// увольнение — только в Ратуше, в разделе «Агенты» (docs/city_v3.md, «Решения АГ-1»): здесь строка места и дверь туда. Ни
// одного своего числа: возраст и уровень — из `sim/agents`, закрытое державой место — `sim/tech.placeBlock`.
import { useGame } from '@/game/store';
import { RETIRE_AGE, RETIRE_WARN } from '@/game/data/agents';
import { agentLevel, ageOf, personName, retireAgeAt, yearsOf } from '@/game/sim/agents';
import { placeBlock } from '@/game/sim/tech';
import { FIGURE_BY_ID } from '@/world/data/figures';
import { realLeft } from '@/ui/parts/wait';
import { tipAt } from '@/ui/next/tip';
import type { FigureId } from '@/world/types';
import { Icon } from '@/ui/icons/Icon';
import { count } from './plural';
import { iconName } from '@/ui/icons/registry';

function Place({ id }: { id: FigureId }) {
  const s = useGame((g) => g.s);
  const def = FIGURE_BY_ID[id];
  const p = s.agents[id];
  const openHall = useGame((g) => g.openTownHall);
  // Почему место пустое и где нанимают — подсказкой по строке места (ui_audit.md, 3.7).
  const why = (e: { currentTarget: Element }) =>
    tipAt(e.currentTarget, {
      title: def.name,
      body: 'Ушедшего не вернуть, место нанимают заново — в Ратуше: там кандидаты, их умения, черты и цена.',
    });

  if (!p.vacant) {
    const years = yearsOf(s, id);
    const left = Math.max(0, retireAgeAt(s, id) - ageOf(s, id));
    return (
      <div className="mod">
        <span className="ico">
          <Icon name={iconName('fig', id)} />
        </span>
        <span className="name">
          {def.name} · {personName(s, id)}
          <em className="sub">
            {count(years, 'год', 'года', 'лет')}, ур. {agentLevel(s, id)}
            {left <= RETIRE_AGE - RETIRE_WARN
              ? left > 0
                ? ` · до покоя ${count(Math.ceil(left), 'год', 'года', 'лет')}`
                : ' · уйдёт на покой, как вернётся'
              : ''}
          </em>
        </span>
        <span className="val">на месте</span>
      </div>
    );
  }

  // Места, которого держава ещё не открыла, у племени нет вовсе — и показано это
  // закрытым, а не пустым: нанимать не на что, и причина здесь та же строка, по которой
  // гаснет кнопка найма (`sim/tech`, одна дверь на показ и на запрет).
  const closed = placeBlock(s, id);
  if (closed) {
    return (
      <div className="mod">
        <span className="ico">
          <Icon name={iconName('fig', id)} />
        </span>
        <span className="name">
          {def.name}
          <em className="sub">{closed}</em>
        </span>
        <span className="val">закрыто</span>
      </div>
    );
  }

  if (p.hiring) {
    return (
      <div className="mod" role="button" tabIndex={0} onClick={why}>
        <span className="ico"><Icon name="ui-time" /></span>
        <span className="name">
          {def.name}
          <em className="sub">
            найм, придёт {p.hiring.name ?? 'новичок'}, {count(Math.floor(p.hiring.age0), 'год', 'года', 'лет')}
          </em>
        </span>
        <span className="val">{realLeft(Math.max(0, p.hiring.until - s.time))}</span>
      </div>
    );
  }

  return (
    <>
      <div className="mod warn" role="button" tabIndex={0} onClick={why}>
        <span className="ico">
          <Icon name={iconName('fig', id)} />
        </span>
        <span className="name">
          {def.name}
          <em className="sub">нанимают в Ратуше</em>
        </span>
        <span className="val">пустует</span>
      </div>
      <button className="btn wide" onClick={() => openHall('agents')}>
        Нанять в Ратуше
      </button>
    </>
  );
}

/**
 * Раздел «Люди» здания: кто служит при нём. Нанимают, меняют и увольняют в Ратуше (АГ-1) — пустое место ведёт туда кнопкой.
 */
export function AgentPlaces({ ids }: { ids: FigureId[] }) {
  if (ids.length === 0) return null;
  return (
    <>
      <h3>Люди</h3>
      {ids.map((id) => (
        <Place key={id} id={id} />
      ))}
    </>
  );
}
