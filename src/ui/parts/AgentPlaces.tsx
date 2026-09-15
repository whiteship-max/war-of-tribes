// Места агентов в профильном здании: кто на месте, идёт ли найм, и кнопка «нанять».
//
// Одна часть на три здания — Дозор (разведчик и лазутчик), храм (дипломат) и Статую
// (полководец). Ни одного своего числа: цена, срок, возраст новичка и причина отказа —
// из `sim/hire.hireInfo`, возраст и уровень — из `sim/agents`. Кнопка, которая не
// сработает, гаснет и говорит причину.
import { useGame } from '@/game/store';
import { DAY_LENGTH } from '@/game/constants';
import { RETIRE_AGE, RETIRE_WARN } from '@/game/data/agents';
import { agentLevel, ageOf, personName, yearsOf } from '@/game/sim/agents';
import { hireAgent, hireInfo } from '@/game/sim/hire';
import { FIGURE_BY_ID } from '@/world/data/figures';
import { formatLeft } from '@/world/geo';
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

  if (!p.vacant) {
    const years = yearsOf(s, id);
    const left = Math.max(0, RETIRE_AGE - ageOf(s, id));
    return (
      <div className="mod">
        <span className="ico">
          <Icon name={`fig-${id}`} glyph={def.icon} />
        </span>
        <span className="name">
          {def.name} — {personName(s, id)}
          <em className="sub">
            {count(years, 'год', 'года', 'лет')}, уровень {agentLevel(s, id)}
            {years >= RETIRE_WARN
              ? left > 0
                ? ` · до покоя ${count(Math.ceil(left), 'год', 'года', 'лет')}`
                : ' · дожил до покоя: уйдёт, как вернётся домой'
              : ''}
          </em>
        </span>
        <span className="val">на месте</span>
      </div>
    );
  }

  if (p.hiring) {
    return (
      <div className="mod">
        <span className="ico">⏳</span>
        <span className="name">
          {def.name}: идёт найм
          <em className="sub">
            придёт {p.hiring.name ?? 'новичок'}, {count(Math.floor(p.hiring.age0), 'год', 'года', 'лет')}
          </em>
        </span>
        <span className="val">{formatLeft(info.left)}</span>
      </div>
    );
  }

  return (
    <>
      <div className="mod warn">
        <span className="ico">
          <Icon name={`fig-${id}`} glyph={def.icon} />
        </span>
        <span className="name">
          {def.name}: место пустует
          <em className="sub">
            придёт за {formatLeft(info.seconds)} ({count(Math.round(info.seconds / DAY_LENGTH), 'игровой день', 'игровых дня', 'игровых дней')}),{' '}
            {count(Math.floor(info.age0), 'год', 'года', 'лет')}, с первого уровня
          </em>
        </span>
      </div>
      <Cost cost={{ gold: info.gold }} />
      <button className="btn wide" disabled={info.blocked !== null} onClick={() => act((g) => hireAgent(g, id))}>
        Нанять {def.one}
      </button>
      {info.blocked && <div className="hint">{info.blocked}</div>}
    </>
  );
}

/**
 * Раздел «Люди» здания. Под ним — что даёт уровень здания новичку: срок и возраст, и
 * только их. Опыта здание не даёт — новичок начинает с нуля.
 */
export function AgentPlaces({ ids }: { ids: FigureId[] }) {
  const s = useGame((g) => g.s);
  const info = hireInfo(s, ids[0]);
  return (
    <>
      <h3>Люди</h3>
      {ids.map((id) => (
        <Place key={id} id={id} />
      ))}
      <div className="note">
        Погибший или ушедший на покой не возвращается — место нанимают заново, и новичок
        начинает с первого уровня. {info.building} {info.level} ур.: найм идёт{' '}
        {formatLeft(info.seconds)}, новичку {count(Math.floor(info.age0), 'год', 'года', 'лет')}; выше уровень — быстрее
        и моложе.
      </div>
    </>
  );
}
