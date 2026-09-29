// Карточка агента: уровень, кружки навыка, опыт, скорость и места под вещи.
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
import { ageOf, agentLevel, circlesText, personName, pipsAt, pipsOf, regear, regearBlock, retireAt, traitsHeld, yearsOf } from '@/game/sim/agents';
import { deedsOf } from '@/game/data/traits';
import { hireWhere } from '@/game/sim/hire';
import { RETIRE_AGE, RETIRE_WARN } from '@/game/data/agents';
import { ownedItems } from '@/net/owned';
import { FIGURE_BY_ID } from '@/world/data/figures';
import { distance, terrainFactor, travelTime } from '@/world/geo';
import { realLeft, waitLeft } from '@/ui/parts/wait';
import { figurePosition, useWorld, worldNow } from '@/world/store';
import type { FigureId } from '@/world/types';
import { deathLine, pipLines, sightLine, stealthLine } from './agentLines';
import { REST_WHY, restLine } from './restWords';
import { count } from './plural';
import { traitLines } from './traitLines';
import { waitDaysBoth } from './wait';

const ORDINAL = ['', 'первый', 'второй', 'третий', 'четвёртый', 'пятый'];

/** Отметки полководца: какие есть, что дают замером и куда ляжет следующий кружок. */
function GeneralPips({ level }: { level: number }) {
  const s = useGame((g) => g.s);
  const person = s.agents.general.person;
  const lines = pipLines(level, pipsOf(s), level < MAX_AGENT_LEVEL ? pipsAt(s.seed, person, level + 1) : null);
  return (
    <>
      <div className="note">{lines.now}</div>
      {lines.rows.map((r) => (
        <div key={r} className="note">
          {r}
        </div>
      ))}
      {lines.next && <div className="note">{lines.next}</div>}
    </>
  );
}

/**
 * Черты человека: только те, что он держит, — каталога возможных нет. Каждая с тем,
 * что даёт, и с тем, за что держится сейчас: черта на долях может и уйти.
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
        <div className="note">
          {n === 0
            ? 'Дел за ним пока нет — и слава о нём ещё не сложилась. Черты приходят делами, хорошие и дурные.'
            : `Засчитано ${count(n, 'дело', 'дела', 'дел')}, но ничем особым он пока не прослыл. Черты приходят делами, хорошие и дурные, и уходят, если дела меняются.`}
        </div>
      ) : (
        lines.map((l) => (
          <div key={l.id}>
            <div className="mod">
              <span className="ico">{l.good ? '✦' : '✧'}</span>
              <span className="name">{l.name}</span>
              <span className={`val ${l.good ? 'pos' : 'neg'}`}>{l.good ? 'добрая слава' : 'дурная слава'}</span>
            </div>
            <div className="note">
              {l.what} {l.why}
            </div>
          </div>
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
  // тому месту, где стояла строка агента, и шапка карточки уехала бы за край.
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
    road = `до дома ${waitLeft(seconds)}`;
  }

  const block = f ? regearBlock(id, f) : 'Где агент, мир ещё не сказал.';
  const slotWhy = block ?? (owned.length === 0 ? 'Надеть нечего: предметов у тебя пока нет.' : null);

  return (
    <div className={embedded ? undefined : 'panel'} ref={top}>
      {!embedded && onBack && (
        <button className="btn ghost back" onClick={onBack}>
          ← Походы
        </button>
      )}
      {embedded ? (
        <h3>
          {progress.name ? personName(s, id) : def.name} <span className="muted">уровень {level}</span>
        </h3>
      ) : (
        <h2>
          {def.name}
          {!vacant && progress.name ? ` — ${personName(s, id)}` : ''} {!vacant && <small>уровень {level}</small>}
        </h2>
      )}

      {vacant ? (
        <div className="note warn">
          Место пустует: {def.name.toLowerCase()} погиб или ушёл на покой, а новый не нанят. Нанимают{' '}
          {hireWhere(s, id)}; новичок начинает с первого уровня.
          {progress.hiring ? ` Найм идёт: придёт ${progress.hiring.name ?? 'новичок'}.` : ''}
        </div>
      ) : (
        <>
          <h3>Жизнь</h3>
          <div className="mod">
            <span className="ico">⌛</span>
            <span className="name">Возраст</span>
            <span className={`val${years >= RETIRE_WARN ? ' neg' : ''}`}>
              {count(years, 'год', 'года', 'лет')} · {toRest > 0 ? `до покоя ${count(Math.ceil(toRest), 'год', 'года', 'лет')}` : 'дожил до покоя'}
            </span>
          </div>
          <div className="note">
            {toRest > 0
              ? `В ${RETIRE_AGE} лет бросит дело и уйдёт на покой, как дойдёт до своих ворот. Стареет только пока идут часы деревни: ${realLeft(Math.max(0, retireAt(s, id) - s.time))} игрового времени.`
              : 'Дел больше не берёт: идёт домой, у своих ворот уйдёт на покой.'}{' '}
            {deathLine(id, level)}
          </div>
        </>
      )}

      {skill ? (
        <>
          <div className="mod total">
            <span className="ico">✦</span>
            <span className="name">{skill.name}</span>
            <span className="val pos">
              {circlesText(level)} — {ORDINAL[level]} уровень
            </span>
          </div>
          {id === 'general' && <GeneralPips level={level} />}
          {id === 'scout' && <div className="note">{sightLine(level)}</div>}
          {id === 'spy' && <div className="note">{stealthLine(level)}</div>}
        </>
      ) : (
        <div className="note">
          Навыка у дипломата пока нет: с логовами не разговаривают, и дело у него появится вместе с
          отношениями. Уровень и опыт копятся по тем же правилам.
        </div>
      )}

      {id === 'general' && f?.rest && (
        // Мораль дружины между боями (docs/battle_eu4.md, 14.31): доля и срок — от мира, слова — одной частью.
        <div className="note warn">
          {restLine(f.rest, 'Дружина дралась', worldNow())} {REST_WHY}
        </div>
      )}

      <h3>Опыт</h3>
      <div className="mod">
        <span className="ico">📜</span>
        <span className="name">{next === null ? 'Пятый уровень — выше некуда' : `До уровня ${level + 1}`}</span>
        <span className="val">{next === null ? progress.xp : `${progress.xp} / ${next}`}</span>
      </div>
      {next !== null && (
        <div className="progress good">
          <div style={{ width: `${Math.floor(((progress.xp - floor) / (next - floor)) * 100)}%` }} />
        </div>
      )}
      <div className="note">
        За удачное дело {DEED_XP.ok}, за неудачное {DEED_XP.fail}, и не чаще раза в{' '}
        {count(Math.round(DEED_GAP / 60_000), 'минуту', 'минуты', 'минут')}. Купить опыт нельзя.
        {' Опыт — этого человека: погибнет или уйдёт на покой — уйдёт и опыт, новичок начнёт с нуля. Задержание опыта не отнимает.'}
      </div>

      {!vacant && <Traits id={id} />}

      <h3>Скорость</h3>
      <div className="mod">
        <span className="ico">🥾</span>
        <span className="name">По равнине, в день</span>
        <span className="val">{count(def.speed, 'клетка', 'клетки', 'клеток')}</span>
      </div>
      <div className="note">
        От уровня не растёт: время пути решают дорога и местность{road ? ` — ${road}` : ''}.
      </div>

      {id === 'general' && !embedded && (
        <>
          <h3>Что даёт Статуя</h3>
          <div className="mod">
            <span className="ico">⚔️</span>
            <span className="name">Войско терпит неуплату — Статуя {statue} ур.</span>
            <span className="val pos">{waitDaysBoth(payGraceDays(s))}</span>
          </div>
          <div className="note">
            Полководец и герой Статуи — один человек, и смертен он так же. Сколько терпит его
            войско, решает Статуя; отметки — его {ORDINAL[level]} уровень.
            Уводит он сколько угодно: войско держит цена, а не здание.
          </div>
        </>
      )}

      <h3>Вещи</h3>
      <div className="totem-row">
        {Array.from({ length: SLOT_COUNT }, (_, i) => {
          const open = i < slotsOpen(progress.xp);
          const st = itemIn(progress.slots[i] ?? null, owned);
          const label = !open
            ? `с ${THIRD_SLOT_LEVEL}-го уровня`
            : st.kind === 'empty'
              ? 'пусто'
              : st.kind === 'unknown'
                ? 'неизвестный предмет'
                : st.kind === 'unowned'
                  ? `${st.def.name}: не подтверждён`
                  : st.def.name;
          return (
            <button
              key={i}
              onClick={() => {
                if (!open) return showToast(`Третье место откроется с ${THIRD_SLOT_LEVEL}-го уровня.`);
                if (st.kind !== 'empty') {
                  act((g) => regear(g, id, i, null, f ?? { phase: 'down', departAt: 0 }, owned));
                  return;
                }
                showToast(slotWhy ?? 'Выбери, что надеть.');
              }}
            >
              <span className="ico">{open ? '▢' : '🔒'}</span>
              <span style={{ color: 'var(--muted)' }}>{label}</span>
            </button>
          );
        })}
      </div>
      {slotWhy && <div className="hint">{slotWhy}</div>}
    </div>
  );
}
