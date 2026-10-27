// Карточка человека на месте: уровень, навык, опыт, скорость, риск, черты и родословная. Новый вид — шапка 56, числа справками,
// объяснения в подсказке по касанию (docs/ui_audit.md, 3.7, 3.10; 18).
//
// Ни одного своего числа здесь нет — это правило, а не пожелание. Что даёт
// кружок, говорит **замер тем же кодом, которым считает игра**: что даёт отметка
// полководца — функция ядра боя (`world/agents.pipRows` → `phaseLuck`), радиус
// земли — та же `revealSight`, что у тумана, долю тихих провалов — то же
// `slipped`, что решает исход.
//
// Карточка одна на два места: страница в «Походах» и лист поверх Ратуши, раздел «Агенты» (ДР-7, docs/city_v3.md, «Решения
// ДР-7»). Статуя Героя с ДР-7 с полководцем не связана: всё о нём — отметки, риск у ворот и в поле, мораль отряда, где он и его
// отряд, режим марша в пути и родословная — здесь. Вещей у агентов нет: их надевают только на правителя (Держава).
import { useEffect, useRef } from 'react';
import { useGame } from '@/game/store';
import { DEED_GAP, DEED_XP, LEVEL_XP, MAX_AGENT_LEVEL, SKILL_OF, levelOf, nextLevelXp } from '@/game/data/agents';
import { ageOf, agentLevel, generalCircles, personName, retireAgeAt, pipsAt, pipsOf, traitsHeld, yearsOf } from '@/game/sim/agents';
import { deedsOf } from '@/game/data/traits';
import { hireWhere } from '@/game/sim/hire';
import { RETIRE_AGE, RETIRE_WARN } from '@/game/data/agents';
import { FIGURE_BY_ID } from '@/world/data/figures';
import { distance, terrainFactor, travelTime } from '@/world/geo';
import { realSpanText, waitLeft } from '@/ui/parts/wait';
import { tipAt } from '@/ui/next/tip';
import { Icon } from '@/ui/icons/Icon';
import { figurePosition, useWorld, worldNow } from '@/world/store';
import type { FigureId } from '@/world/types';
import { deathLine, pipLines, sightLine, stealthLine } from './agentLines';
import { REST_WHY, restLine } from './restWords';
import { GaitDesk } from './GaitDesk';
import { GAIT_META, gaitSpeed, readGait } from '@/world/gait';
import { MusterLink } from './MusterLink';
import { Lineage } from './Lineage';
import { EnergyBar } from './Energy';
import { count } from './plural';
import { traitLines } from './traitLines';
import { num } from '@/game/num';
import { iconName } from '@/ui/icons/registry';

/** Подсказка по касанию справки (docs/ui_audit.md, 3.7). */
const tip =
  (title: string, body: string) =>
  (e: { currentTarget: Element }): void =>
    tipAt(e.currentTarget, { title, body });

/** Отметки полководца: какие есть, что дают замером и куда ляжет следующая. */
function GeneralPips({ level }: { level: number }) {
  const s = useGame((g) => g.s);
  const g = s.agents.general;
  // Отметки считаются с уровня, в который входит врождённое (АГ-1, `generalCircles`).
  const at = generalCircles(s, level);
  const lines = pipLines(at, pipsOf(s), at < MAX_AGENT_LEVEL ? pipsAt(s.seed, g.person, generalCircles(s, level + 1), g.cand?.n ?? null) : null);
  return (
    <>
      <p className="nx-tnote">{lines.now}</p>
      {lines.rows.map((r) => (
        <p key={r} className="nx-tnote">
          {r}
        </p>
      ))}
      {lines.next && <p className="nx-tnote">{lines.next}</p>}
    </>
  );
}

/**
 * Черты человека: только те, что он держит, — каталога возможных нет. Строка — имя и слава; что черта даёт и за что
 * держится сейчас, — в подсказке по касанию: черта на долях может и уйти.
 */
function Traits({ id }: { id: FigureId }) {
  const s = useGame((g) => g.s);
  const tally = s.agents[id].tally;
  const lines = traitLines(traitsHeld(s, id), tally);
  const n = deedsOf(tally);
  return (
    <>
      <h3>Черты</h3>
      {lines.length === 0 ? (
        <button className="nx-crow" onClick={tip('Черты', 'Черты приходят делами, добрые и дурные, и уходят, если дела меняются.')}>
          <span className="nx-crow-t">{n === 0 ? 'Дел ещё не было.' : `${count(n, 'дело', 'дела', 'дел')}, черт ещё нет.`}</span>
        </button>
      ) : (
        lines.map((l) => (
          <button key={l.id} className="nx-crow" onClick={tip(l.name, `${l.what} ${l.why}`)}>
            <span className="nx-lico">
              <Icon name="ui-star" state={l.good ? undefined : 'off'} />
            </span>
            <span className="nx-crow-t">{l.name}</span>
            <b className={l.good ? 'good' : 'bad'}>{l.good ? 'добрая слава' : 'дурная слава'}</b>
          </button>
        ))
      )}
    </>
  );
}

export function AgentCard({ id, onBack }: { id: FigureId; onBack?: () => void }) {
  const s = useGame((g) => g.s);
  const f = useWorld((g) => g.figures.find((x) => x.id === id));
  const info = useWorld((g) => g.info);
  const def = FIGURE_BY_ID[id];
  const progress = s.agents[id];
  const level = agentLevel(s, id);
  const skill = SKILL_OF[id];
  const next = nextLevelXp(progress.xp);
  const floor = LEVEL_XP[levelOf(progress.xp) - 1];
  // Карточка открывается из середины списка: без этого шторка осталась бы прокручена к
  // тому месту, где стояла строка человека, и шапка карточки уехала бы за край.
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => {
    top.current?.scrollIntoView({ block: 'start' });
  }, [id]);

  const vacant = progress.vacant;
  const years = yearsOf(s, id);
  const restAge = retireAgeAt(s, id);
  const toRest = Math.max(0, restAge - ageOf(s, id));

  // Скорость полководца — в его режиме марша (ДР-2, `world/gait`): та же мерка, что у мира.
  const speed = id === 'general' ? def.speed * gaitSpeed(f?.march?.gait) : def.speed;
  let road: string | null = null;
  if (f && info && f.place === 'map' && !f.atHome) {
    const at = figurePosition(f, worldNow());
    const seconds = travelTime(distance(at, info.home), terrainFactor(info.seed, at, info.home), speed);
    road = `До дома ${waitLeft(seconds)}.`;
  }

  const who = !vacant && progress.name ? personName(s, id) : null;

  return (
    <div className="panel nx-bpanel nx-acard" ref={top}>
      {/* Шапка нового вида (3.10): значок роли (касание — что он умеет), имя, «ур. · возраст»; справа — возврат к списку
          «Походов» или к Ратуше. */}
      <div className="nx-bhead">
        <button className="nx-bico" onClick={tip(def.name, `${def.description} ${def.ability}`)} aria-label={`${def.name}: что умеет`}>
          <Icon name={iconName('fig', id)} />
        </button>
        <div className="nx-btitle">
          <b className="one-line">
            {def.name}
            {who ? ` · ${who}` : ''}
          </b>
          {!vacant && (
            <span className="nx-blvl">
              ур. {level} · {count(years, 'год', 'года', 'лет')}
            </span>
          )}
        </div>
        {onBack && (
          <button className="nx-bclose" onClick={onBack} aria-label="Закрыть карточку">
            <Icon name="ui-close" />
          </button>
        )}
      </div>

      {vacant ? (
        <p className="nx-bwarn">
          Место пустует. Нанимают {hireWhere(s, id)}.
          {progress.hiring ? ` Идёт найм, придёт ${progress.hiring.name ?? 'новичок'}.` : ''}
        </p>
      ) : (
        <>
          {/* Числа человека — справками (3.7): касание объясняет число. */}
          <div className="nx-facts">
            <button
              className="nx-fact"
              onClick={tip('Возраст', `В ${count(Math.floor(restAge), 'год', 'года', 'лет')} уйдёт на покой, как вернётся домой. Стареет, только пока идут часы города.`)}
            >
              <small>До покоя</small>
              <b className={toRest <= RETIRE_AGE - RETIRE_WARN ? 'bad' : ''}>{toRest > 0 ? count(Math.ceil(toRest), 'год', 'года', 'лет') : 'пора'}</b>
            </button>
            {skill && (
              <button className="nx-fact" onClick={tip(skill.name, `Растёт с уровнем, до ${MAX_AGENT_LEVEL}.`)}>
                <small>{skill.name}</small>
                <b>навык {level}</b>
              </button>
            )}
            <button
              className="nx-fact"
              onClick={tip(
                'Опыт',
                `Удачное дело даёт ${DEED_XP.ok} опыта, неудачное ${DEED_XP.fail}, не чаще раза в ${realSpanText(DEED_GAP / 1000)}. Опыт уходит вместе с человеком.`,
              )}
            >
              <small>{next === null ? 'Высший уровень' : `До ур. ${level + 1}`}</small>
              <b>{next === null ? progress.xp : `${progress.xp}/${next}`}</b>
            </button>
            <button className="nx-fact" onClick={tip(
                'Скорость',
                id === 'general'
                  ? 'Клеток по равнине в день. От уровня не растёт; время пути решают дорога, местность и режим марша.'
                  : 'Клеток по равнине в день. От уровня не растёт, время пути решают дорога и местность.',
              )}>
              <small>Скорость</small>
              <b>{num(speed, 1)}</b>
            </button>
          </div>
          {next !== null && (
            <div className="progress good">
              <div style={{ width: `${Math.floor(((progress.xp - floor) / (next - floor)) * 100)}%` }} />
            </div>
          )}
          {/* Энергия человека (docs/agent_energy.md): шкала, сколько и что с ней — от мира. */}
          {f?.energy && <EnergyBar energy={f.energy} spent={f.spent} />}
          {toRest <= 0 && <p className="nx-bwarn">Дел не берёт, идёт домой на покой.</p>}
          <p className="nx-tnote">{deathLine(id, level)}</p>
          {road && <p className="nx-tnote">{road}</p>}
        </>
      )}

      {skill && !vacant && (
        <>
          <h3>{skill.name}</h3>
          {id === 'general' && <GeneralPips level={level} />}
          {id === 'scout' && <p className="nx-tnote">{sightLine(level)}</p>}
          {id === 'spy' && <p className="nx-tnote">{stealthLine(level)}</p>}
        </>
      )}

      {/* Где полководец и его отряд — строка-вход в «Дружину» (ДР-7: прежде она стояла в Статуе). */}
      {id === 'general' && !vacant && <MusterLink />}

      {/* Режим марша (ДР-2, ДР-7): дома его выбирают в окне дела, перед выходом; в пути и в поле — здесь, в окне отряда. */}
      {id === 'general' && f?.march && !vacant &&
        (f.march.change.free ? (
          <p className="nx-tnote">Режим марша — {GAIT_META[readGait(f.march.gait)].name.toLowerCase()}. Дома его выбирают в окне дела, перед выходом.</p>
        ) : (
          <GaitDesk f={f} />
        ))}

      {id === 'general' && f?.rest && (
        // Мораль дружины между боями (docs/battle_eu4.md, 14.31): доля и срок — от мира, слова — одной частью.
        <p className="nx-bwarn">
          {restLine(f.rest, 'Отряд дрался', worldNow())} {REST_WHY}
        </p>
      )}

      {!vacant && <Traits id={id} />}

      <Lineage id={id} />
    </div>
  );
}
