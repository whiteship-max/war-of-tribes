// Раздел «Агенты» Ратуши (АГ-1, docs/city_v3.md, «Решения АГ-1»): четыре места — полководец, разведчик, лазутчик, дипломат —
// карточками; найм, смена и увольнение всех четверых — только здесь. Едет своим куском (докачкой из окна Ратуши): первой
// загрузке не нужен.
//
// Карточка места: портрет (набор персонажа, `Portrait`), место и кружки уровня, имя, возраст, черты кандидата, жалованье,
// характеристики числами; «Сменить» — у человека на месте (только дома: в поле он дело заканчивает), «Нанять» — у пустого.
// Касание — лист кандидатов поверх: нынешний и «Уволить» над ним, кандидаты с теми же числами и разницей с нынешним, чертами,
// жалованьем и ценой. Четыре карточки по одной кнопке влезают в шторку без прокрутки.
//
// Своих чисел нет (правило 18): кандидаты, найм, увольнение и отказы — `sim/recruits`, характеристики — двери
// дела (`agentStats`), жалованье и плата — `agentrules`.
import './council.css';
import './agents.css';
import { useState } from 'react';
import type { FigureId } from '@/world/types';
import type { GameState } from '@/game/types';
import { useGame } from '@/game/store';
import { AGENT_ROLES, recruitWage, type AgentTrait } from '@/game/agentrules';
import { MAX_AGENT_LEVEL } from '@/game/data/agents';
import { faceAge } from '@/game/data/council';
import { AGENT_TRAIT_WORD, ROLE_DUTY } from '@/game/data/agentWords';
import { ageOf, agentLevel, personName, recruitOfPlace, seated, traitsBorn, yearsWord } from '@/game/sim/agents';
import { dismissAgent, dismissBlock, hireBlock, hireRecruit, nextRecruitsIn, recruitsOf, replaceBlock, type RecruitView } from '@/game/sim/recruits';
import { mixSeed } from '@/game/sim/random';
import { placeBlock } from '@/game/sim/tech';
import { asGame } from '@/game/pace';
import { num } from '@/game/num';
import { FIGURE_BY_ID } from '@/world/data/figures';
import { useWorld } from '@/world/store';
import { Icon } from '@/ui/icons/Icon';
import { iconName } from '@/ui/icons/registry';
import { Btn } from '@/ui/kit/Btn';
import { SheetPage } from '@/ui/kit/SheetPage';
import { Cost } from '@/ui/parts/Cost';
import { waitLeft } from '@/ui/parts/wait';
import { tipAt } from './tip';
import { NoPortrait, Portrait } from './Portrait';
import { statsNow, statsOfRecruit, type StatValue } from './agentStats';

/** Четыре места; касание «Нанять» или «Сменить» — лист кандидатов места. */
export function HallAgents() {
  const [pick, setPick] = useState<FigureId | null>(null);
  return (
    <>
      {AGENT_ROLES.map((r) => (
        <RoleCard key={r} role={r} onPick={() => setPick(r)} />
      ))}
      {pick && <RecruitList role={pick} onClose={() => setPick(null)} />}
    </>
  );
}

/** Кружки уровня агента: ●●○○○. */
const dots = (level: number): string => '●'.repeat(level) + '○'.repeat(Math.max(0, MAX_AGENT_LEVEL - level));

/** Зерно облика человека на месте: у нанятого — кандидата, у своего — из сида партии и номера человека. */
function lookOf(s: GameState, role: FigureId): number {
  const r = recruitOfPlace(s, role);
  return r ? r.look : mixSeed(mixSeed(s.seed >>> 0, AGENT_ROLES.indexOf(role) + 1), s.agents[role].person) & 0x7fffffff;
}

function Trait({ t }: { t: AgentTrait }) {
  const w = AGENT_TRAIT_WORD[t];
  return (
    <button
      type="button"
      className={`cn-trait ${w.good ? 'good' : 'bad'}`}
      onClick={(e) => tipAt(e.currentTarget, { title: w.name, body: `Черта: ${w.does}.` })}
    >
      {w.name}
    </button>
  );
}

/** Характеристики числами; `than` — с чем сравнить (нынешний на месте): разница — зелёным или красным. */
function Stats({ list, than }: { list: StatValue[]; than?: StatValue[] }) {
  return (
    <span className="ag-stats">
      {list.map((x) => {
        const was = than?.find((y) => y.key === x.key)?.value;
        const d = was === undefined ? 0 : x.value - was;
        return (
          <button
            key={x.key}
            type="button"
            className="ag-stat"
            aria-label={`${x.word.name} ${x.value}`}
            onClick={(e) => tipAt(e.currentTarget, { title: `${x.word.name} · ${x.value}`, body: x.word.does(x.value) })}
          >
            <Icon name={x.word.icon} />
            <b>{x.value}</b>
            {d !== 0 && <i className={d > 0 ? 'pos' : 'neg'}>{d > 0 ? `+${d}` : `−${-d}`}</i>}
          </button>
        );
      })}
    </span>
  );
}

/** Жалованье в игровой день: у своего человека — нет. */
function Wage({ wage }: { wage: number }) {
  return wage > 0 ? (
    <span className="ag-wage neg">
      <Icon name="res-gold" />−{num(wage, 1)}
    </span>
  ) : (
    <span className="ag-wage muted">без жалованья</span>
  );
}

function RoleCard({ role, onPick }: { role: FigureId; onPick: () => void }) {
  const s = useGame((g) => g.s);
  const f = useWorld((g) => g.figures.find((x) => x.id === role));
  const def = FIGURE_BY_ID[role];
  const head = (level: number | null) => (
    <span className="cn-post">
      <Icon name={iconName('fig', role)} />
      {def.name}
      {level !== null && <i className="cn-lvl">{dots(level)}</i>}
    </span>
  );
  const closed = placeBlock(s, role);
  if (closed) {
    return (
      <div className="cn-card vacant ag-card">
        <NoPortrait post={role} />
        <div className="cn-body">
          {head(null)}
          <b className="cn-name muted">Место закрыто</b>
          <small className="ag-why">{closed}</small>
        </div>
        <span className="ag-lock" aria-hidden="true">
          <Icon name="ui-lock" />
        </span>
      </div>
    );
  }
  if (!seated(s, role)) {
    const hiring = s.agents[role].hiring;
    const n = recruitsOf(s, role).length;
    return (
      <div className="cn-card vacant ag-card">
        <NoPortrait post={role} />
        <div className="cn-body">
          {head(null)}
          <b className="cn-name muted">{hiring ? `Придёт ${hiring.name ?? 'новичок'}` : 'Место пустует'}</b>
          <small className="one-line">{ROLE_DUTY[role]}</small>
        </div>
        <div className="cn-acts">
          <Btn
            kind="main"
            onClick={onPick}
            sub={n > 0 ? `кандидатов ${n}` : 'кандидатов нет'}
            why={hiring ? 'Прежний найм ещё идёт.' : n > 0 ? null : 'Новые придут с сезоном'}
          >
            Нанять
          </Btn>
        </div>
      </div>
    );
  }
  const r = recruitOfPlace(s, role);
  const age = ageOf(s, role);
  const away = replaceBlock(s, role, f);
  return (
    <div className="cn-card ag-card">
      <Portrait seed={lookOf(s, role)} age={faceAge(age)} post={role} />
      <div className="cn-body">
        {head(agentLevel(s, role))}
        <b className="cn-name one-line">{personName(s, role)}</b>
        <span className="cn-meta">
          <span className="ag-age">{yearsWord(Math.floor(age))}</span>
          {traitsBorn(s, role).map((t) => (
            <Trait key={t} t={t} />
          ))}
          <Wage wage={r ? recruitWage(r.level, r.traits) : 0} />
        </span>
        <Stats list={statsNow(s, role)} />
      </div>
      <div className="cn-acts">
        <Btn onClick={onPick} why={away}>
          Сменить
        </Btn>
      </div>
    </div>
  );
}

/** Лист кандидатов места поверх окна Ратуши. */
export function RecruitList({ role, onClose }: { role: FigureId; onClose: () => void }) {
  const s = useGame((g) => g.s);
  const list = recruitsOf(s, role);
  const now = statsNow(s, role);
  const name = FIGURE_BY_ID[role].name;
  return (
    <>
      <div className="hall-veil" onClick={onClose} />
      <div className="hall-card cn-sheet" role="dialog" aria-label={`${name}: кандидаты`}>
        <SheetPage icon={iconName('fig', role)} title={`${name}: кандидаты`} sub={`новые через ${waitLeft(asGame(nextRecruitsIn(s)))}`} onClose={onClose}>
          {seated(s, role) && <Current role={role} />}
          {list.length === 0 ? (
            <div className="cn-note">{s.faith?.id ? 'Кандидаты этого сезона уже были в ратуше. Новые придут с сезоном.' : 'Кандидаты ещё в пути.'}</div>
          ) : (
            list.map((c) => <RecruitRow key={c.n} c={c} than={now.length ? now : undefined} onHired={onClose} />)
          )}
        </SheetPage>
      </div>
    </>
  );
}

/** Нынешний на месте — над листом: кто он, что значат числа рядом, и «Уволить» (только дома, с «Точно?»). */
function Current({ role }: { role: FigureId }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const f = useWorld((g) => g.figures.find((x) => x.id === role));
  return (
    <div className="ag-now">
      <span className="cn-note">
        Сейчас — {personName(s, role)}, ур. {agentLevel(s, role)}. Нанятый займёт его место; числа рядом — разница с ним.
      </span>
      <Btn confirm why={dismissBlock(s, role, f)} onClick={() => act((st) => dismissAgent(st, role, f))}>
        Уволить
      </Btn>
    </div>
  );
}

function RecruitRow({ c, than, onHired }: { c: RecruitView; than?: StatValue[]; onHired: () => void }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const f = useWorld((g) => g.figures.find((x) => x.id === c.role));
  const replace = seated(s, c.role);
  return (
    <div className="cn-cand ag-cand">
      <Portrait seed={c.look} age={faceAge(c.age0)} post={c.role} />
      <div className="cn-body">
        <b className="cn-name one-line">{c.name}</b>
        <span className="cn-meta">
          <span className="ag-age">{yearsWord(Math.floor(c.age0))}</span>
          {c.traits.map((t) => (
            <Trait key={t} t={t} />
          ))}
          <Wage wage={c.wage} />
        </span>
        <Stats list={statsOfRecruit(s, c)} than={than} />
      </div>
      <div className="cn-buy">
        <Cost cost={{ gold: c.price }} />
        <Btn kind="main" why={hireBlock(s, c.role, c.n, f)} onClick={() => act((st) => hireRecruit(st, c.role, c.n, f)) && onHired()}>
          {replace ? 'Сменить' : 'Нанять'}
        </Btn>
      </div>
    </div>
  );
}
