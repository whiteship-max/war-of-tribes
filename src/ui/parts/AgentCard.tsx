// Карточка агента: уровень, кружки навыка, опыт, скорость и места под вещи.
//
// Ни одного своего числа здесь нет — это правило, а не пожелание. Что даёт
// кружок, говорит **замер тем же кодом, которым считает игра**: прибавку натиска
// к морали каждого рода — функция ядра боя (`world/agents.onslaughtRows` →
// `startMorale`), радиус земли — та же `revealSight`, что у тумана, долю тихих
// провалов — то же `slipped`, что решает исход. Поэтому кружок, который съел
// потолок морали, карточка так и называет, а не обещает «+3».
//
// Полководец и герой Статуи — один человек. Сколько он уводит и за скольких
// стоит сам, решает Статуя, и это стоит здесь с подписью «откуда»; уровень даёт
// натиск — и это тоже подписано. Вопроса «кто главный» у игрока быть не должно.
import { useEffect, useRef } from 'react';
import { useGame } from '@/game/store';
import { buildingOfType, commandCap, fervour, heroInfo, heroMen, mountGear } from '@/game/derived';
import {
  DEED_GAP,
  DEED_XP,
  LEVEL_XP,
  SKILL_OF,
  SLOT_COUNT,
  THIRD_SLOT_LEVEL,
  levelOf,
  nextLevelXp,
  slotsOpen,
} from '@/game/data/agents';
import { itemIn } from '@/game/data/items';
import { agentLevel, circlesText, fallLoss, regear, regearBlock } from '@/game/sim/agents';
import { ownedItems } from '@/net/owned';
import { FIGURE_BY_ID } from '@/world/data/figures';
import { distance, formatLeft, terrainFactor, travelTime } from '@/world/geo';
import { figurePosition, useWorld, worldNow } from '@/world/store';
import type { FigureId, FigureView } from '@/world/types';
import { onslaughtLines, sightLine, stealthLine } from './agentLines';
import { count } from './plural';

const ORDINAL = ['', 'первый', 'второй', 'третий', 'четвёртый', 'пятый'];

/** Что натиск делает сейчас и что сделает следующий кружок — замером на нынешней дружине. */
function Onslaught({ level, f }: { level: number; f: FigureView }) {
  const s = useGame((g) => g.s);
  const lines = onslaughtLines(level, f.troops, mountGear(s), fervour(s));
  return (
    <>
      <div className="note">{lines.now}</div>
      {lines.troops && <div className={`note${lines.capped ? ' warn' : ''}`}>{lines.troops}</div>}
      {lines.next && <div className={`note${lines.deadKinds.length > 0 ? ' warn' : ''}`}>{lines.next}</div>}
    </>
  );
}

export function AgentCard({ id, onBack }: { id: FigureId; onBack: () => void }) {
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
    top.current?.scrollIntoView({ block: 'start' });
  }, [id]);

  const statue = buildingOfType(s, 'statue')?.level ?? 0;
  const hero = heroInfo(s);

  let road: string | null = null;
  if (f && info && f.place === 'map' && !f.atHome) {
    const at = figurePosition(f, worldNow());
    const seconds = travelTime(distance(at, info.home), terrainFactor(info.seed, at, info.home), def.speed);
    road = `до дома ${formatLeft(seconds)}`;
  }

  const block = f ? regearBlock(id, f) : 'Где агент, мир ещё не сказал.';
  const slotWhy = block ?? (owned.length === 0 ? 'Надеть нечего: предметов у тебя пока нет.' : null);

  return (
    <div className="panel" ref={top}>
      <button className="btn ghost back" onClick={onBack}>
        ← Походы
      </button>
      <h2>
        {def.name}
        {id === 'general' ? ` — ${hero.name}` : ''} <small>уровень {level}</small>
      </h2>

      {skill ? (
        <>
          <div className="mod total">
            <span className="ico">✦</span>
            <span className="name">{skill.name}</span>
            <span className="val pos">
              {circlesText(level)} — {ORDINAL[level]} уровень
            </span>
          </div>
          {id === 'general' && f && <Onslaught level={level} f={f} />}
          {id === 'scout' && <div className="note">{sightLine(level)}</div>}
          {id === 'spy' && <div className="note">{stealthLine(level)}</div>}
        </>
      ) : (
        <div className="note">
          Навыка у дипломата пока нет: с логовами не разговаривают, и дело у него появится вместе с
          отношениями. Уровень и опыт копятся по тем же правилам.
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
        {id !== 'spy'
          ? ` Если выбудет — потеряет ${fallLoss(progress.xp) > 0 ? `${fallLoss(progress.xp)} опыта` : 'ничего'}: путь к следующему уровню, не больше половины шага; взятый уровень остаётся.`
          : ' Лазутчик не выбывает: его задерживают.'}
      </div>

      <h3>Скорость</h3>
      <div className="mod">
        <span className="ico">🥾</span>
        <span className="name">По равнине, в день</span>
        <span className="val">{count(def.speed, 'клетка', 'клетки', 'клеток')}</span>
      </div>
      <div className="note">
        От уровня не растёт: время пути решают дорога и местность{road ? ` — ${road}` : ''}.
      </div>

      {id === 'general' && (
        <>
          <h3>Что даёт Статуя</h3>
          <div className="mod">
            <span className="ico">⚔️</span>
            <span className="name">Уводит в поле — Статуя {statue} ур.</span>
            <span className="val pos">{count(commandCap(s), 'боец', 'бойца', 'бойцов')}</span>
          </div>
          <div className="mod">
            <span className="ico">🛡️</span>
            <span className="name">Сам в настроенном бою — Статуя {statue} ур.</span>
            <span className="val pos">{heroMen(s)} строя</span>
          </div>
          <div className="note">
            Полководец и герой Статуи — один человек. Сколько он уводит и чего стоит сам, решает
            Статуя; натиск — его {ORDINAL[level]} уровень.
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
