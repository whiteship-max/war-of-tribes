// Места агентов в профильном здании: кто на месте, идёт ли найм, и кнопка «нанять».
//
// Одна часть на три здания — Дозор (разведчик и лазутчик), храм (дипломат) и Статую
// (полководец). Ни одного своего числа: цена, срок, возраст новичка и причина отказа —
// из `sim/hire.hireInfo`, возраст и уровень — из `sim/agents`. Кнопка, которая не
// сработает, гаснет и говорит причину.
import { useGame } from '@/game/store';
import { RETIRE_AGE, RETIRE_WARN } from '@/game/data/agents';
import { agentLevel, ageOf, personName, seated, yearsOf } from '@/game/sim/agents';
import { hireAgent, hireInfo } from '@/game/sim/hire';
import { placeBlock } from '@/game/sim/tech';
import { FIGURE_BY_ID } from '@/world/data/figures';
import { realLeft, waitLeft } from '@/ui/parts/wait';
import { tipAt } from '@/ui/next/tip';
import type { FigureId } from '@/world/types';
import { Icon } from '@/ui/icons/Icon';
import { Cost } from './Cost';
import { count } from './plural';

function Place({ id }: { id: FigureId }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const def = FIGURE_BY_ID[id];
  const p = s.agents[id];
  const info = hireInfo(s, id);
  // Почему место пустое и что решает найм — подсказкой по строке места (ui_audit.md, 3.7).
  const why = (e: { currentTarget: Element }) =>
    tipAt(e.currentTarget, {
      title: def.name,
      body: `Ушедшего не вернуть, место нанимают заново. Чем выше уровень здания, тем быстрее найм и моложе новичок.`,
    });

  if (!p.vacant) {
    const years = yearsOf(s, id);
    const left = Math.max(0, RETIRE_AGE - ageOf(s, id));
    return (
      <div className="mod">
        <span className="ico">
          <Icon name={`fig-${id}`} glyph={def.icon} />
        </span>
        <span className="name">
          {def.name} · {personName(s, id)}
          <em className="sub">
            {count(years, 'год', 'года', 'лет')}, ур. {agentLevel(s, id)}
            {years >= RETIRE_WARN
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
          <Icon name={`fig-${id}`} glyph={def.icon} />
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
        <span className="ico">⏳</span>
        <span className="name">
          {def.name}
          <em className="sub">
            найм, придёт {p.hiring.name ?? 'новичок'}, {count(Math.floor(p.hiring.age0), 'год', 'года', 'лет')}
          </em>
        </span>
        <span className="val">{realLeft(info.left)}</span>
      </div>
    );
  }

  return (
    <>
      <div className="mod warn" role="button" tabIndex={0} onClick={why}>
        <span className="ico">
          <Icon name={`fig-${id}`} glyph={def.icon} />
        </span>
        <span className="name">
          {def.name}
          <em className="sub">
            найм {waitLeft(info.seconds)}, новичку {count(Math.floor(info.age0), 'год', 'года', 'лет')}
          </em>
        </span>
        <span className="val">пустует</span>
      </div>
      <Cost cost={{ gold: info.gold }} />
      <button className="btn wide" disabled={info.blocked !== null} onClick={() => act((g) => hireAgent(g, id))}>
        Нанять
      </button>
      {info.blocked && <div className="hint">{info.blocked}</div>}
    </>
  );
}

/**
 * Раздел «Люди» здания. Что даёт уровень здания новичку — срок и возраст — стоит в строке
 * пустого места, почему — в её подсказке. Опыта здание не даёт — новичок начинает с нуля.
 */
export function AgentPlaces({ ids, vacantOnly = false }: { ids: FigureId[]; vacantOnly?: boolean }) {
  const s = useGame((g) => g.s);
  // `vacantOnly` — у здания, где человек на месте показан своей карточкой целиком (Статуя, Д7): строка места нужна, только
  // пока места нет, оно пустует или идёт найм.
  const shown = vacantOnly ? ids.filter((id) => !seated(s, id)) : ids;
  if (shown.length === 0) return null;
  return (
    <>
      <h3>Люди</h3>
      {shown.map((id) => (
        <Place key={id} id={id} />
      ))}
    </>
  );
}
