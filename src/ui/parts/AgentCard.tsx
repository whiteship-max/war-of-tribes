// Карточка человека на месте: уровень, навык, опыт, скорость и места под вещи. Новый вид — шапка 56, числа справками,
// объяснения в подсказке по касанию (docs/ui_audit.md, 3.7, 3.10; 18).
//
// Ни одного своего числа здесь нет — это правило, а не пожелание. Что даёт
// кружок, говорит **замер тем же кодом, которым считает игра**: что даёт отметка
// полководца — функция ядра боя (`world/agents.pipRows` → `phaseLuck`), радиус
// земли — та же `revealSight`, что у тумана, долю тихих провалов — то же
// `slipped`, что решает исход.
//
// Полководец и герой Статуи — один человек. Сколько он уводит и за скольких
// стоит сам, решает Статуя, и это стоит здесь с подписью «откуда»; уровень даёт
// отметки — и это тоже подписано. Вопроса «кто главный» у игрока быть не должно.
//
// Карточка одна на два места: страница в «Походах» и раздел в Статуе. Во втором
// (`embedded`) нет кнопки возврата и раздела «Что даёт Статуя» — то же число
// стоит в самой Статуе строкой выше, и дважды на одном экране оно не нужно.
import { useEffect, useRef } from 'react';
import { useGame } from '@/game/store';
import { buildingOfType, payGraceDays, warningSeconds } from '@/game/derived';
import {
  DEED_GAP,
  DEED_XP,
  LEVEL_XP,
  MAX_AGENT_LEVEL,
  SKILL_OF,
  SLOT_COUNT,
  THIRD_SLOT_LEVEL,
  levelOf,
  nextLevelXp,
  slotsOpen,
} from '@/game/data/agents';
import { itemIn } from '@/game/data/items';
import { ageOf, agentLevel, personName, pipLevel, pipsAt, pipsOf, regear, regearBlock, traitsHeld, yearsOf } from '@/game/sim/agents';
import { deedsOf } from '@/game/data/traits';
import { hireWhere } from '@/game/sim/hire';
import { RETIRE_AGE, RETIRE_WARN } from '@/game/data/agents';
import { ownedItems } from '@/net/owned';
import { FIGURE_BY_ID } from '@/world/data/figures';
import { distance, terrainFactor, travelTime } from '@/world/geo';
import { realSpanText, waitDays, waitLeft } from '@/ui/parts/wait';
import { tipAt } from '@/ui/next/tip';
import { Icon } from '@/ui/icons/Icon';
import { figurePosition, useWorld, worldNow } from '@/world/store';
import type { FigureId } from '@/world/types';
import { deathLine, pipLines, sightLine, stealthLine } from './agentLines';
import { REST_WHY, restLine } from './restWords';
import { count } from './plural';
import { traitLines } from './traitLines';
import { num } from '@/game/num';

/** Отметки полководца: какие есть, что дают замером и куда ляжет следующий кружок. */
/** Подсказка по касанию справки (docs/ui_audit.md, 3.7). */
const tip =
  (title: string, body: string) =>
  (e: { currentTarget: Element }): void =>
    tipAt(e.currentTarget, { title, body });

/** Отметки полководца: какие есть, что дают замером и куда ляжет следующая. */
function GeneralPips({ level }: { level: number }) {
  const s = useGame((g) => g.s);
  const person = s.agents.general.person;
  // Отметки считаются с уровня, в который входит и воинская традиция Статуи (`pipLevel`).
  const at = pipLevel(s, level);
  // Сколько отметок дала традиция — сверх своих и под потолком: ветерану пятого уровня она уже не прибавляет.
  const lines = pipLines(at, pipsOf(s), at < MAX_AGENT_LEVEL ? pipsAt(s.seed, person, pipLevel(s, level + 1)) : null, at - level);
  return (
    <>
      <p className="nx-tnote">{lines.now}</p>
      {lines.tradition && <p className="nx-tnote">{lines.tradition}</p>}
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
  const lines = traitLines(traitsHeld(s, id), tally, warningSeconds(s));
  const n = deedsOf(tally);
  return (
    <>
      <h3>Черты</h3>
      {lines.length === 0 ? (
        <button className="nx-crow" onClick={tip('Черты', 'Черты приходят делами, добрые и дурные, и уходят, если дела меняются.')}>
          <span className="nx-crow-t">{n === 0 ? 'Дел пока нет.' : `${count(n, 'дело', 'дела', 'дел')}, черт пока нет.`}</span>
        </button>
      ) : (
        lines.map((l) => (
          <button key={l.id} className="nx-crow" onClick={tip(l.name, `${l.what} ${l.why}`)}>
            <span className="nx-lico">{l.good ? '✦' : '✧'}</span>
            <span className="nx-crow-t">{l.name}</span>
            <b className={l.good ? 'good' : 'bad'}>{l.good ? 'добрая слава' : 'дурная слава'}</b>
          </button>
        ))
      )}
    </>
  );
}

export function AgentCard({ id, onBack, embedded = false }: { id: FigureId; onBack?: () => void; embedded?: boolean }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const showToast = useGame((g) => g.showToast);
  const f = useWorld((g) => g.figures.find((x) => x.id === id));
  const info = useWorld((g) => g.info);
  const def = FIGURE_BY_ID[id];
  const progress = s.agents[id];
  const level = agentLevel(s, id);
  const skill = SKILL_OF[id];
  const next = nextLevelXp(progress.xp);
  const floor = LEVEL_XP[levelOf(progress.xp) - 1];
  const owned = ownedItems();
  // Карточка открывается из середины списка: без этого шторка осталась бы прокручена к
  // тому месту, где стояла строка человека, и шапка карточки уехала бы за край.
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!embedded) top.current?.scrollIntoView({ block: 'start' });
  }, [id, embedded]);

  const statue = buildingOfType(s, 'statue')?.level ?? 0;
  const vacant = progress.vacant;
  const years = yearsOf(s, id);
  const toRest = Math.max(0, RETIRE_AGE - ageOf(s, id));

  let road: string | null = null;
  if (f && info && f.place === 'map' && !f.atHome) {
    const at = figurePosition(f, worldNow());
    const seconds = travelTime(distance(at, info.home), terrainFactor(info.seed, at, info.home), def.speed);
    road = `До дома ${waitLeft(seconds)}.`;
  }

  const block = f ? regearBlock(id, f) : 'Где он сейчас, пока неизвестно.';
  const slotWhy = block ?? (owned.length === 0 ? 'Надеть нечего.' : null);
  const who = !vacant && progress.name ? personName(s, id) : null;

  return (
    <div className={embedded ? 'nx-acard' : 'panel nx-bpanel nx-acard'} ref={top}>
      {/* Шапка нового вида (3.10): значок роли (касание — что он умеет), имя, «ур. · возраст»; в «Походах» справа —
          возврат к списку. В Статуе (`embedded`) шапку держит окно постройки, здесь — строка раздела. */}
      {embedded ? (
        <h3>
          {who ?? def.name} <span className="muted">ур. {level}</span>
        </h3>
      ) : (
        <div className="nx-bhead">
          <button className="nx-bico" onClick={tip(def.name, `${def.description} ${def.ability}`)} aria-label={`${def.name}: что умеет`}>
            <Icon name={`fig-${id}`} glyph={def.icon} />
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
            <button className="nx-bclose" onClick={onBack} aria-label="К походам">
              <Icon name="ui-close" glyph="✕" />
            </button>
          )}
        </div>
      )}

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
              onClick={tip('Возраст', `В ${RETIRE_AGE} лет уйдёт на покой, как вернётся домой. Стареет, только пока идут часы города.`)}
            >
              <small>До покоя</small>
              <b className={years >= RETIRE_WARN ? 'bad' : ''}>{toRest > 0 ? count(Math.ceil(toRest), 'год', 'года', 'лет') : 'пора'}</b>
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
            <button className="nx-fact" onClick={tip('Скорость', 'Клеток по равнине в день. От уровня не растёт, время пути решают дорога и местность.')}>
              <small>Скорость</small>
              <b>{num(def.speed)}</b>
            </button>
          </div>
          {next !== null && (
            <div className="progress good">
              <div style={{ width: `${Math.floor(((progress.xp - floor) / (next - floor)) * 100)}%` }} />
            </div>
          )}
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

      {id === 'general' && f?.rest && (
        // Мораль дружины между боями (docs/battle_eu4.md, 14.31): доля и срок — от мира, слова — одной частью.
        <p className="nx-bwarn">
          {restLine(f.rest, 'Отряд дрался', worldNow())} {REST_WHY}
        </p>
      )}

      {!vacant && <Traits id={id} />}

      {id === 'general' && !embedded && (
        <>
          <h3>Что даёт Статуя</h3>
          <button
            className="nx-crow"
            onClick={tip('Терпение дружины', `Сколько дружина ждёт жалованья. Растёт с уровнем Статуи, сейчас ур. ${statue}.`)}
          >
            <span className="nx-lico">
              <Icon name="hud-army" glyph="⚔️" />
            </span>
            <span className="nx-crow-t">Терпение дружины</span>
            <b className="good">{waitDays(payGraceDays(s))}</b>
          </button>
        </>
      )}

      <h3>Вещи</h3>
      <div className="totem-row">
        {Array.from({ length: SLOT_COUNT }, (_, i) => {
          const open = i < slotsOpen(progress.xp);
          const st = itemIn(progress.slots[i] ?? null, owned);
          const label = !open
            ? `с ур. ${THIRD_SLOT_LEVEL}`
            : st.kind === 'empty'
              ? 'пусто'
              : st.kind === 'unknown'
                ? 'неизвестная вещь'
                : st.kind === 'unowned'
                  ? `${st.def.name}, не действует`
                  : st.def.name;
          return (
            <button
              key={i}
              onClick={() => {
                if (!open) return showToast(`Место откроется на ур. ${THIRD_SLOT_LEVEL}.`);
                if (st.kind !== 'empty') {
                  act((g) => regear(g, id, i, null, f ?? { phase: 'down', departAt: 0 }, owned));
                  return;
                }
                showToast(slotWhy ?? 'Выбери, что надеть.');
              }}
            >
              <span className="ico">{open ? '▢' : <Icon name="ui-lock" glyph="🔒" />}</span>
              <span style={{ color: 'var(--muted)' }}>{label}</span>
            </button>
          );
        })}
      </div>
      {slotWhy && <p className="nx-tnote">{slotWhy}</p>}
    </div>
  );
}
