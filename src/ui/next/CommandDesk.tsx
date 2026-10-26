// Меню «Командующие» в «Дружине» (ДР-3, docs/siege_v2.md, «Решения ДР-3», К12): два места — левый и правый фланг — карточками
// агентов АГ-1; найм, смена и увольнение — только здесь. Едет своим куском (докачкой по кнопке «Командующие»): первой загрузке
// не нужен.
//
// Карточка места: портрет (набор персонажа, сукно по роду), фланг, имя, род, возраст, черты, жалованье, тактика и что скажет
// знать; «Сменить» — у человека на месте (только когда полководец дома), «Нанять» — у пустого. Касание — лист кандидатов фланга:
// нынешний и «Уволить» над ним, кандидаты с теми же числами и разницей с нынешним, чертами, жалованьем и ценой.
//
// Своих чисел нет (правило 18): кандидаты, найм, увольнение и отказы — `sim/commanders`, тактика и милость знати —
// `commandrules`, лояльность рыцарства — `derived.estatesNow`, жалованье — `agentrules.recruitWage`.
import './council.css';
import './agents.css';
import './command.css';
import { useState } from 'react';
import type { Flank, GameState } from '@/game/types';
import { useGame } from '@/game/store';
import { FLANKS, birthLoyalty, type Birth } from '@/game/commandrules';
import { recruitWage, type AgentTrait } from '@/game/agentrules';
import { commandLead, commanderOn, estatesNow } from '@/game/derived';
import { faceAge } from '@/game/data/council';
import { AGENT_TRAIT_WORD } from '@/game/data/agentWords';
import { yearsWord } from '@/game/sim/agents';
import { commandAge, commandSeat } from '@/game/sim/command';
import {
  commandAwayBlock,
  commandDismissBlock,
  commandersOf,
  commandHireBlock,
  dismissCommander,
  hireCommander,
  nextCommandersIn,
  type CommanderView,
} from '@/game/sim/commanders';
import { asGame } from '@/game/pace';
import { num } from '@/game/num';
import { useWorld } from '@/world/store';
import { Icon } from '@/ui/icons/Icon';
import type { IconName } from '@/ui/icons/alias';
import { Btn } from '@/ui/kit/Btn';
import { Cost } from '@/ui/parts/Cost';
import { waitLeft } from '@/ui/parts/wait';
import { tipAt } from './tip';
import { NoPortrait, Portrait } from './Portrait';

/** Имя места. */
export const FLANK_NAME: Readonly<Record<Flank, string>> = { left: 'Левый фланг', right: 'Правый фланг' };

/** Род словами: подпись ярлыка и что он значит. */
const BIRTH_WORD: Readonly<Record<Birth, { name: string; does: string }>> = {
  low: { name: 'Безродный', does: 'тактик из простых: сильнее в бою, но его место оскорбляет знать' },
  noble: { name: 'Знатный', does: 'лорд старого рода: бьётся хуже, зато рыцарство довольно' },
};

/** Сукно портрета по роду (`render/chambers/advisor/looks.ROBES`). */
const robe = (b: Birth): string => (b === 'noble' ? 'lord' : 'tactician');

/** Число со знаком и длинным минусом: «+2», «−7,5». */
const signed = (n: number): string => (n > 0 ? `+${num(n, 1)}` : n < 0 ? `−${num(-n, 1)}` : '0');

/** Характеристика командира: значок, число со знаком, что оно даёт. */
interface Stat {
  key: 'tactics' | 'nobles';
  icon: IconName;
  name: string;
  value: number;
  does: string;
}

/** Тактика и знать — числами из правил (`commandrules`), подсказка называет то же число. */
function statsOf(c: { tactics: number; birth: Birth }): Stat[] {
  const t = c.tactics;
  const k = birthLoyalty(c.birth);
  return [
    {
      key: 'tactics',
      icon: 'ui-target',
      name: 'Тактика',
      value: t,
      does:
        t >= 0
          ? `Его фланг бьёт сильнее: ${signed(t)} отметки к кости в огне и натиске.`
          : `Его фланг бьёт слабее: ${signed(t)} отметки к кости в огне и натиске — потери фланга выше.`,
    },
    {
      key: 'nobles',
      icon: 'est-knights',
      name: 'Знать',
      value: k,
      does: k >= 0 ? `Лояльность рыцарства ${signed(k)}, пока он на месте.` : `Лояльность рыцарства ${signed(k)}, пока он на месте: знать оскорблена.`,
    },
  ];
}

function Stats({ list, than }: { list: Stat[]; than?: Stat[] }) {
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
            aria-label={`${x.name} ${signed(x.value)}`}
            onClick={(e) => tipAt(e.currentTarget, { title: `${x.name} · ${signed(x.value)}`, body: x.does })}
          >
            <Icon name={x.icon} />
            <b>{signed(x.value)}</b>
            {d !== 0 && <i className={d > 0 ? 'pos' : 'neg'}>{signed(d)}</i>}
          </button>
        );
      })}
    </span>
  );
}

function BirthTag({ b }: { b: Birth }) {
  const w = BIRTH_WORD[b];
  return (
    <button type="button" className={`cn-trait cm-birth ${b}`} onClick={(e) => tipAt(e.currentTarget, { title: w.name, body: `Род: ${w.does}.` })}>
      {w.name}
    </button>
  );
}

function Trait({ t }: { t: AgentTrait }) {
  const w = AGENT_TRAIT_WORD[t];
  return (
    <button type="button" className={`cn-trait ${w.good ? 'good' : 'bad'}`} onClick={(e) => tipAt(e.currentTarget, { title: w.name, body: `Черта: ${w.does}.` })}>
      {w.name}
    </button>
  );
}

function Wage({ wage }: { wage: number }) {
  return (
    <span className="ag-wage neg">
      <Icon name="res-gold" />−{num(wage, 1)}
    </span>
  );
}

/** Нынешний на месте фланга — кандидат его найма; места нет — `null`. */
function seatedOf(s: GameState, f: Flank) {
  const seat = commandSeat(s, f);
  const c = commanderOn(s, f);
  return seat && c ? { ...c, name: seat.name, age: commandAge(s, f) } : null;
}

/** Меню «Командующие»: два места; касание «Нанять» или «Сменить» — лист кандидатов фланга. */
export function CommandDesk({ onBack }: { onBack: () => void }) {
  const [pick, setPick] = useState<Flank | null>(null);
  if (pick) return <CandidateList flank={pick} onBack={() => setPick(null)} />;
  return (
    <div className="panel cm-desk">
      <button type="button" className="btn ghost back" onClick={onBack}>
        ← К дружине
      </button>
      <h2>
        <span>
          <Icon name="hud-army" /> Командующие
        </span>
        <small>фланги отряда полководца</small>
      </h2>
      <div className="cn-note">Центр ведёт полководец, фланги — его командиры. Безродные сильнее в бою, но их место оскорбляет знать; лорды бьются хуже, зато знать довольна.</div>
      {FLANKS.map((f) => (
        <FlankCard key={f} flank={f} onPick={() => setPick(f)} />
      ))}
      <Nobles />
    </div>
  );
}

/** Лояльность рыцарства и что в неё кладут командиры — той же мерой, что окно «Сословия». */
function Nobles() {
  const s = useGame((g) => g.s);
  const k = estatesNow(s).knights;
  const lead = commandLead(s);
  return (
    <div className="mod cm-nobles">
      <span className="ico">
        <Icon name="est-knights" />
      </span>
      <span className="name">
        Рыцарство: лояльность <b>{Math.round(k.loyalty)}</b>
      </span>
      <span className={`val ${lead > 0 ? 'good' : lead < 0 ? 'bad' : ''}`}>командиры {signed(lead)}</span>
    </div>
  );
}

function FlankCard({ flank, onPick }: { flank: Flank; onPick: () => void }) {
  const s = useGame((g) => g.s);
  const general = useWorld((g) => g.figures.find((x) => x.id === 'general'));
  const head = (
    <span className="cn-post">
      <Icon name="hud-army" />
      {FLANK_NAME[flank]}
    </span>
  );
  const c = seatedOf(s, flank);
  if (!c) {
    const n = commandersOf(s).length;
    return (
      <div className="cn-card vacant ag-card">
        <NoPortrait post="general" />
        <div className="cn-body">
          {head}
          <b className="cn-name muted">Место пустует</b>
          <small className="one-line">Фланг ведёт сам полководец</small>
        </div>
        <div className="cn-acts">
          <Btn kind="main" onClick={onPick} sub={n > 0 ? `кандидатов ${n}` : 'кандидатов нет'} why={n > 0 ? null : 'Новые придут с сезоном'}>
            Нанять
          </Btn>
        </div>
      </div>
    );
  }
  return (
    <div className="cn-card ag-card">
      <Portrait seed={c.look} age={faceAge(c.age)} post={robe(c.birth)} />
      <div className="cn-body">
        {head}
        <b className="cn-name one-line">{c.name}</b>
        <span className="cn-meta">
          <BirthTag b={c.birth} />
          <span className="ag-age">{yearsWord(Math.floor(c.age))}</span>
          {c.traits.map((t) => (
            <Trait key={t} t={t} />
          ))}
          <Wage wage={recruitWage(c.level, c.traits)} />
        </span>
        <Stats list={statsOf(c)} />
      </div>
      <div className="cn-acts">
        <Btn onClick={onPick} why={commandAwayBlock(s, general)}>
          Сменить
        </Btn>
      </div>
    </div>
  );
}

/** Лист кандидатов фланга: нынешний и «Уволить» над ним, кандидаты окна с разницей против нынешнего. */
export function CandidateList({ flank, onBack }: { flank: Flank; onBack: () => void }) {
  const s = useGame((g) => g.s);
  const list = commandersOf(s);
  const now = seatedOf(s, flank);
  const than = now ? statsOf(now) : undefined;
  return (
    <div className="panel cm-desk">
      <button type="button" className="btn ghost back" onClick={onBack}>
        ← Командующие
      </button>
      <h2>
        <span>
          <Icon name="hud-army" /> {FLANK_NAME[flank]}
        </span>
        <small>новые через {waitLeft(asGame(nextCommandersIn(s)))}</small>
      </h2>
      {now && <Current flank={flank} name={now.name} />}
      {list.length === 0 ? (
        <div className="cn-note">{s.faith?.id ? 'Кандидаты этого сезона уже были в казармах. Новые придут с сезоном.' : 'Кандидаты ещё в пути.'}</div>
      ) : (
        list.map((c) => <CandidateRow key={c.n} c={c} flank={flank} than={than} onHired={onBack} />)
      )}
    </div>
  );
}

/** Нынешний на месте — над листом: кто он, что значат числа рядом, и «Уволить» (только когда полководец дома, с «Точно?»). */
function Current({ flank, name }: { flank: Flank; name: string }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const general = useWorld((g) => g.figures.find((x) => x.id === 'general'));
  return (
    <div className="ag-now">
      <span className="cn-note">Сейчас — {name}. Нанятый займёт его место; числа рядом — разница с ним.</span>
      <Btn confirm why={commandDismissBlock(s, flank, general)} onClick={() => act((st) => dismissCommander(st, flank, general))}>
        Уволить
      </Btn>
    </div>
  );
}

function CandidateRow({ c, flank, than, onHired }: { c: CommanderView; flank: Flank; than?: Stat[]; onHired: () => void }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const general = useWorld((g) => g.figures.find((x) => x.id === 'general'));
  const replace = commandSeat(s, flank) !== null;
  return (
    <div className="cn-cand ag-cand">
      <Portrait seed={c.look} age={faceAge(c.age0)} post={robe(c.birth)} />
      <div className="cn-body">
        <b className="cn-name one-line">{c.name}</b>
        <span className="cn-meta">
          <BirthTag b={c.birth} />
          <span className="ag-age">{yearsWord(Math.floor(c.age0))}</span>
          {c.traits.map((t) => (
            <Trait key={t} t={t} />
          ))}
          <Wage wage={c.wage} />
        </span>
        <Stats list={statsOf(c)} than={than} />
      </div>
      <div className="cn-buy">
        <Cost cost={{ gold: c.price }} />
        <Btn kind="main" why={commandHireBlock(s, flank, c.n, general)} onClick={() => act((st) => hireCommander(st, flank, c.n, general)) && onHired()}>
          {replace ? 'Сменить' : 'Нанять'}
        </Btn>
      </div>
    </div>
  );
}
