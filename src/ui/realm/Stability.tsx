// Раздел «Стабильность» меню державы (СБ-1, docs/stability.md, раздел 1) — в духе Europa Universalis IV, под телефон 390×844:
// шкала −3…+3 с гербом державы вместо указателя, «Что влияет» строками с числом, недовольство по группам с причинами и сроком
// мятежа, «Укрепить стабильность» ценой тремя видами очков, летопись — график ступени и строки событий.
//
// Едет куском меню державы (`lazy` в `App`): первая загрузка за него не платит. Своих чисел здесь нет ни одного: ступень,
// давление, полосы, цена, прогноз — `sim/stability`; сроки словами — `ui/parts/wait`; слова строк — `stabWords.ts`.
import './stability.css';
import { useState } from 'react';
import { useGame } from '@/game/store';
import { DAY_LENGTH } from '@/game/constants';
import { asGame, realSeconds } from '@/game/pace';
import { realSpan } from '@/game/span';
import { GROUP_META, stabName, stabSigned } from '@/game/data/stability';
import { REALM_BRANCHES } from '@/game/data/realm';
import { groupsOf, pressureOf, stabLevel, stabOf, steady, steadyInfo, type GroupView, type StabLine } from '@/game/sim/stability';
import { REVOLT_NEAR, STAB_DRIFT, STAB_MAX, STAB_MIN, STAB_SELF_MAX, stabOutputMult } from '@/game/stabrules';
import { rulerRate } from '@/game/sim/points';
import { hintSeen, hintsOff, markHint } from '@/game/sim/hints';
import { moraleBreakdown } from '@/game/derived';
import type { GameState } from '@/game/types';
import { Bar, Row, goTo } from '@/ui/kit';
import { Icon } from '@/ui/icons/Icon';
import { waitLeft } from '@/ui/parts/wait';
import { signed } from '@/ui/parts/signed';
import { CoatArt } from './Coat';
import { BRANCH_ICON, BRANCH_WORD } from './branches';
import { FIRST_HINT, GO_SOURCE, GO_WORD, LEVEL_WORDS, LINE_HELP } from './stabWords';

/** Сколько игровых дней видно на графике летописи: трое настоящих суток. */
export const CHART_DAYS = 144;

const levels = (): number[] => Array.from({ length: STAB_MAX - STAB_MIN + 1 }, (_, i) => STAB_MIN + i);

/** Тон ступени: ниже нуля — беда, выше — благо. */
const toneOf = (level: number): string => (level < 0 ? 'bad' : level > 0 ? 'good' : 'mid');

/** Срок до соседней ступени при нынешнем давлении — словами настоящего времени; null — не сдвинется. */
export function driftWords(s: GameState, total: number): string {
  const level = stabLevel(s);
  const drift = stabOf(s).drift;
  if (total > 0 && level < STAB_SELF_MAX) {
    return `Клонится к «${stabName(level + 1)}» — через ~${waitLeft(asGame(((STAB_DRIFT - drift) / total) * DAY_LENGTH))}`;
  }
  if (total < 0 && level > STAB_MIN) {
    return `Клонится к «${stabName(level - 1)}» — через ~${waitLeft(asGame(((STAB_DRIFT + drift) / -total) * DAY_LENGTH))}`;
  }
  if (total < 0) return 'Ниже некуда: подними её очками или сними причины';
  return level >= STAB_SELF_MAX && level < STAB_MAX ? 'Держится. Выше — только укреплением' : 'Держится';
}

export function StabilityTab() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const level = stabLevel(s);
  const st = stabOf(s);
  const groups = groupsOf(s, moraleBreakdown(s));
  const pressure = pressureOf(s, groups);
  const fresh = !hintSeen(s, 'stability') && !hintsOff(s);

  return (
    <div className="nx-tab sb">
      {fresh && (
        <div className="sb-hint" role="note">
          <b>{FIRST_HINT.title}</b>
          <p>{FIRST_HINT.body}</p>
          <button
            className="btn small"
            onClick={() =>
              act((g) => {
                markHint(g, 'stability');
                return null;
              })
            }
          >
            {FIRST_HINT.ok}
          </button>
        </div>
      )}
      <Scale level={level} drift={st.drift} />
      <p className={`sb-drift ${pressure.total < 0 ? 'bad' : ''}`}>{driftWords(s, pressure.total)}</p>
      <p className="sb-gain">
        {LEVEL_WORDS[String(level)]} Добыча {signed((stabOutputMult(level) - 1) * 100, 1)} %.
      </p>

      <h3>
        Что влияет <span className="muted">в день, доля ступени</span>
      </h3>
      <div className="sb-lines">
        {pressure.lines.map((l) => (
          <LineRow key={l.id} line={l} unit="%" />
        ))}
        <Row icon="ui-scales" label="Итого" value={`${signed(pressure.total, 1)} %`} tone={pressure.total < 0 ? 'bad' : 'good'} />
      </div>

      <h3>Недовольство</h3>
      <div className="sb-groups">
        {groups.map((g) => (
          <Group key={g.id} g={g} />
        ))}
      </div>

      <Steady />

      <h3>Летопись</h3>
      <Chart s={s} />
      <Annals s={s} />
    </div>
  );
}

/** Шкала −3…+3: семь клеток от «Смуты» до «Благоденствия», над ними — герб державы на ступени, сдвинутый долей сдвига. */
function Scale({ level, drift }: { level: number; drift: number }) {
  const span = STAB_MAX - STAB_MIN;
  const pos = Math.max(STAB_MIN, Math.min(STAB_MAX, level + drift / STAB_DRIFT));
  const left = ((pos - STAB_MIN) / span) * 100;
  return (
    <div className="sb-scale" aria-label={`Стабильность ${stabSigned(level)}, ${stabName(level)}`}>
      <div className="sb-name">
        <b className={toneOf(level)}>{stabSigned(level)}</b>
        <span>{stabName(level)}</span>
      </div>
      <div className="sb-track">
        <i className="sb-pointer" style={{ left: `${left}%` }}>
          <CoatArt size={34} />
        </i>
        <div className="sb-cells">
          {levels().map((l) => (
            <span key={l} className={`sb-cell ${toneOf(l)}${l === level ? ' on' : ''}`} />
          ))}
        </div>
        <div className="sb-ticks">
          {levels().map((l) => (
            <span key={l} className={l === level ? 'on' : ''}>
              {stabSigned(l)}
            </span>
          ))}
        </div>
      </div>
      <div className="sb-ends">
        <span>{stabName(STAB_MIN)}</span>
        <span>{stabName(STAB_MAX)}</span>
      </div>
    </div>
  );
}

/** Строка разбора: касание — пояснение; дверь «›» — где это изменить. */
function LineRow({ line, unit }: { line: StabLine; unit: string }) {
  const help = LINE_HELP[line.id] ?? line.hint;
  return (
    <Row
      icon={line.icon}
      label={line.name}
      sub={line.hint}
      value={`${signed(line.value, 1)} ${unit}`}
      tone={line.value < 0 ? 'bad' : 'good'}
      tip={() => ({ title: line.name, body: line.go ? `${help} Где изменить: ${GO_WORD[line.go]}.` : help })}
      {...(line.go ? { go: () => goTo(GO_SOURCE[line.go!]), goLabel: `Где изменить: ${GO_WORD[line.go]}` } : {})}
    />
  );
}

/** Полоса группы: имя, полоса с порогом «близок», куда идёт и когда мятеж; касание — причины. */
function Group({ g }: { g: GroupView }) {
  const meta = GROUP_META[g.id];
  const hot = g.value >= REVOLT_NEAR || g.eta !== null;
  const [open, setOpen] = useState(hot);
  const tone = g.value >= REVOLT_NEAR ? 'bad' : g.value >= 50 ? 'warn' : 'good';
  const word = g.id === 'army' ? 'уход' : 'мятеж';
  return (
    <div className={`sb-group${hot ? ' hot' : ''}`}>
      <button className="sb-ghead" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name={meta.icon} />
        <span className="sb-gname">{meta.name}</span>
        <span className="sb-gbar">
          <Bar value={g.value} max={100} tone={tone} marks={[{ at: REVOLT_NEAR, label: 'близок', side: 'end' }]} />
        </span>
        <b className={tone}>{Math.round(g.value)} %</b>
      </button>
      {g.eta !== null && (
        <p className="sb-eta">
          {word === 'мятеж' ? 'Мятеж' : 'Бойцы начнут уходить'} через ~{waitLeft(g.eta)}
        </p>
      )}
      {open && (
        <div className="sb-causes">
          {g.target !== null && g.target !== g.value && (
            <p className="sb-target">
              {g.target > g.value ? 'Растёт' : 'Спадает'} к {Math.round(Math.min(100, g.target))} %
            </p>
          )}
          {g.lines.length === 0 ? (
            <p className="sb-quiet">Причин нет — полоса спадает</p>
          ) : (
            g.lines.map((l) => <LineRow key={l.id} line={l} unit="%" />)
          )}
        </div>
      )}
    </div>
  );
}

/** «Укрепить стабильность»: цена тремя видами очков; погашенная — с причиной. */
function Steady() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const info = steadyInfo(s);
  const top = info.blocked === 'top';
  const why = top
    ? `Выше «${stabName(STAB_MAX)}» некуда`
    : info.short.length > 0
      ? `Не хватает: ${info.short
          .map((b) => {
            const rate = rulerRate(s, b);
            const left = info.price - info.have[b];
            const wait = rate > 0 ? ` — накопится через ~${waitLeft(asGame((left / rate) * DAY_LENGTH))}` : '';
            return `${BRANCH_WORD[b].toLowerCase()} ${Math.floor(info.have[b])} из ${info.price}${wait}`;
          })
          .join('; ')}`
      : null;
  return (
    <div className="sb-steady">
      <div className="sb-shead">
        <b>Укрепить стабильность</b>
        {!top && <small>до «{stabName(info.to)}»</small>}
      </div>
      {!top && (
        <div className="sb-price">
          {REALM_BRANCHES.map((b) => (
            <span key={b} className={info.have[b] < info.price ? 'no' : ''} aria-label={`${BRANCH_WORD[b]}: ${info.price}`}>
              <Icon name={BRANCH_ICON[b]} />
              <b>{info.price}</b>
              <i>из {Math.floor(info.have[b])}</i>
            </span>
          ))}
        </div>
      )}
      {why && <p className="sb-why">{why}</p>}
      <button className="nx-go wide" disabled={info.blocked !== null} onClick={() => act((g) => (steady(g) ? 'Не вышло' : null))}>
        Укрепить
      </button>
    </div>
  );
}

/** График ступени за последние дни: ступенчатая линия по сменам (`StabilityState.past`), справа — сейчас. */
function Chart({ s }: { s: GameState }) {
  const W = 340;
  const H = 96;
  const pad = { l: 22, r: 6, t: 8, b: 16 };
  const from = s.time - CHART_DAYS * DAY_LENGTH;
  const past = stabOf(s).past;
  const before = [...past].reverse().find(([t]) => t <= from);
  // Ступень на левом краю: последняя смена до окна; смен не было — та, с которой началась первая смена окна, иначе нынешняя.
  const firstIn = past.find(([t]) => t > from);
  const start = before ? before[1] : firstIn ? past[past.indexOf(firstIn) - 1]?.[1] ?? 0 : stabLevel(s);
  const x = (t: number): number => pad.l + ((t - from) / (s.time - from)) * (W - pad.l - pad.r);
  const y = (l: number): number => pad.t + ((STAB_MAX - l) / (STAB_MAX - STAB_MIN)) * (H - pad.t - pad.b);
  let d = `M${x(from).toFixed(1)} ${y(start).toFixed(1)}`;
  let cur = start;
  for (const [t, l] of past) {
    if (t <= from) continue;
    d += ` H${x(t).toFixed(1)} V${y(l).toFixed(1)}`;
    cur = l;
  }
  d += ` H${x(s.time).toFixed(1)}`;
  return (
    <svg className="sb-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Стабильность за ${realSpan(realSeconds(CHART_DAYS * DAY_LENGTH))}`}>
      {levels().map((l) => (
        <g key={l}>
          <line x1={pad.l} x2={W - pad.r} y1={y(l)} y2={y(l)} className={l === 0 ? 'zero' : 'grid'} />
          {l % 3 === 0 && (
            <text x={pad.l - 4} y={y(l) + 4} textAnchor="end">
              {stabSigned(l)}
            </text>
          )}
        </g>
      ))}
      <path d={d} className={`line ${toneOf(cur)}`} />
      <text x={pad.l} y={H - 3}>
        {realSpan(realSeconds(CHART_DAYS * DAY_LENGTH))} назад
      </text>
      <text x={W - pad.r} y={H - 3} textAnchor="end">
        сейчас
      </text>
    </svg>
  );
}

/** Строки летописи стабильности (род `stab`) — последние пять. */
function Annals({ s }: { s: GameState }) {
  const rows = s.log.filter((e) => e.topic === 'stab').slice(0, 5);
  if (rows.length === 0) return <p className="sb-quiet">Событий стабильности ещё не было.</p>;
  return (
    <ul className="sb-annals">
      {rows.map((e, i) => (
        <li key={`${e.at}-${i}`} className={e.kind}>
          {e.text}
        </li>
      ))}
    </ul>
  );
}
