// Ратуша — своё здание со своими разделами (РТ-1, docs/city_v3.md, «Решения РТ-1»): «Советники», «Агенты» (АГ-1, `HallAgents`,
// своим куском) и «Сословия» (РТ-2, `HallEstates`). Стройка ушла в «Здания» низа.
//
// Совет — три должности карточками: портрет (набор персонажа, `Portrait`), должность и уровень, имя и возраст, черта, польза
// числом, очки правителя своего вида и жалованье; «Сменить» и «Уволить» — у сидящего, «Назначить» — у пустого места. Касание
// «Назначить» или «Сменить» — лист просителей поверх: два–четыре человека с теми же числами и ценой найма.
//
// Своих чисел нет (правило 18): польза, жалованье, плата и очки — `councilrules`, просители и найм — дверь `sim/council`, ставка
// очков — `sim/points.branchRate` (совет не обгоняет лучшего правителя, и окно говорит, сколько из очков советника легло).
import './council.css';
import { Suspense, lazy, useState } from 'react';
import type { AdvisorPost, AdvisorTrait } from '@/game/types';
import { useGame } from '@/game/store';
import { ADVISOR_POSTS, MAX_ADVISOR_LEVEL, POST_BRANCH, advisorPoints, advisorWage, giftOf, rateWithCouncil } from '@/game/councilrules';
import { faceAge } from '@/game/data/council';
import { POST_DUTY, POST_GIFT, TRAIT_WORD } from '@/game/data/councilWords';
import { councilSeat } from '@/game/derived';
import { advisorAgeNow, dismissAdvisor, titleOf } from '@/game/sim/council';
import { candidatesOf, hireAdvisor, hireBlock, nextWindowIn, type Candidate } from '@/game/sim/candidates';
import { branchRate, rulerRate } from '@/game/sim/points';
import { yearsWord } from '@/game/sim/agents';
import { asGame } from '@/game/pace';
import { num } from '@/game/num';
import { BRANCH_ICON, BRANCH_WORD } from '@/ui/realm/branches';
import { Icon } from '@/ui/icons/Icon';
import { iconName } from '@/ui/icons/registry';
import { Btn } from '@/ui/kit/Btn';
import { SheetPage, Tabs, type TabDef } from '@/ui/kit/SheetPage';
import { Cost } from '@/ui/parts/Cost';
import { waitLeft } from '@/ui/parts/wait';
import { tipAt } from './tip';
import { NoPortrait, Portrait } from './Portrait';
import { HallEstates } from './HallEstates';

type Part = 'council' | 'agents' | 'estates';
const PARTS: readonly TabDef<Part>[] = [
  { id: 'council', label: 'Советники', icon: 'post-steward' },
  // Агенты (АГ-1): найм, смена и увольнение всех четверых — здесь; раздел едет своим куском, когда его открыли.
  { id: 'agents', label: 'Агенты', icon: 'hall-agents' },
  { id: 'estates', label: 'Сословия', icon: 'ui-scales' },
];

const HallAgents = lazy(() => import('./HallAgents').then((m) => ({ default: m.HallAgents })));

/** Разделы ратуши: вкладка живёт в сторе — к совету ведут и двери других окон (`openTownHall`). */
export function HallCouncil() {
  const tab = useGame((g) => g.townTab);
  const setTab = useGame((g) => g.setTownTab);
  return (
    <section className="cn">
      <Tabs tabs={PARTS} value={tab} onChange={setTab} />
      {tab === 'council' ? (
        <Council />
      ) : tab === 'agents' ? (
        <Suspense fallback={null}>
          <HallAgents />
        </Suspense>
      ) : (
        <HallEstates />
      )}
    </section>
  );
}


/**
 * Три должности. Ступень совета и сколько просителей на место — строкой «Ратуша даёт городу» (`HallGives`), когда придут
 * новые — в листе просителей: карточкам остаётся вся высота свёрнутой шторки.
 */
function Council() {
  const [pick, setPick] = useState<AdvisorPost | null>(null);
  return (
    <>
      {ADVISOR_POSTS.map((p) => (
        <PostCard key={p} post={p} onPick={() => setPick(p)} />
      ))}
      {pick && <CandidateList post={pick} onClose={() => setPick(null)} />}
    </>
  );
}

/** Польза числом: доля — процентом, стойкость — очками. */
export const giftText = (post: AdvisorPost, gift: number): string =>
  post === 'marshal' ? `+${num(gift, 1)}` : `+${Math.round(gift * 100)} %`;

/** Кружки уровня: ●●○. */
const dots = (level: number): string => '●'.repeat(level) + '○'.repeat(Math.max(0, MAX_ADVISOR_LEVEL - level));

function Trait({ t }: { t: AdvisorTrait }) {
  const w = TRAIT_WORD[t];
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

/** Строка чисел: польза, очки своего вида (сколько легло под потолок правителя) и жалованье. */
function Nums({ post, gift, points, wage }: { post: AdvisorPost; gift: number; points: number; wage: number }) {
  const b = POST_BRANCH[post];
  return (
    <span className="cn-nums">
      <span className="pos" title={POST_GIFT[post]}>
        {giftText(post, gift)} <small>{POST_GIFT[post]}</small>
      </span>
      <span className={points > 0 ? 'pos' : 'muted'} title={BRANCH_WORD[b]}>
        <Icon name={BRANCH_ICON[b]} />+{num(points, 0)}
      </span>
      <span className="neg">
        <Icon name="res-gold" />−{num(wage, 1)}
      </span>
    </span>
  );
}

function PostCard({ post, onPick }: { post: AdvisorPost; onPick: () => void }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const a = councilSeat(s, post);
  const title = titleOf(s, post);
  const head = (
    <span className="cn-post">
      <Icon name={iconName('post', post)} />
      {title}
      {a && <i className="cn-lvl">{dots(a.level)}</i>}
    </span>
  );
  if (!a) {
    const n = candidatesOf(s, post).length;
    return (
      <div className="cn-card vacant">
        <NoPortrait post={post} />
        <div className="cn-body">
          {head}
          <b className="cn-name muted">Место пустует</b>
          <small className="one-line">{POST_DUTY[post]}</small>
        </div>
        <div className="cn-acts">
          <Btn kind="main" onClick={onPick} sub={n > 0 ? `просителей ${n}` : 'просителей нет'} why={n > 0 ? null : 'Новые придут с сезоном'}>
            Назначить
          </Btn>
        </div>
      </div>
    );
  }
  const age = advisorAgeNow(s, a);
  const b = POST_BRANCH[post];
  // Очки, что советник прибавляет на деле: ставка вида с ним минус правитель — под потолком лучшего правителя.
  const added = branchRate(s, b) - rulerRate(s, b);
  return (
    <div className="cn-card">
      <Portrait seed={a.look} age={faceAge(age)} post={post} />
      <div className="cn-body">
        {head}
        <b className="cn-name one-line">{a.name}</b>
        <span className="cn-meta">
          {yearsWord(Math.floor(age))} <Trait t={a.trait} />
        </span>
        <Nums post={post} gift={giftOf(post, a.level, a.trait)} points={added} wage={advisorWage(a.level, a.trait)} />
      </div>
      <div className="cn-acts">
        <Btn onClick={onPick}>Сменить</Btn>
        <Btn confirm onClick={() => act((st) => dismissAdvisor(st, post))}>
          Уволить
        </Btn>
      </div>
    </div>
  );
}

/** Лист просителей должности поверх окна ратуши. */
export function CandidateList({ post, onClose }: { post: AdvisorPost; onClose: () => void }) {
  const s = useGame((g) => g.s);
  const list = candidatesOf(s, post);
  const seated = councilSeat(s, post);
  return (
    <>
      <div className="hall-veil" onClick={onClose} />
      <div className="hall-card cn-sheet" role="dialog" aria-label={`${titleOf(s, post)}: просители`}>
        <SheetPage icon={iconName('post', post)} title={`${titleOf(s, post)}: просители`} sub={`новые через ${waitLeft(asGame(nextWindowIn(s)))}`} onClose={onClose}>
          {seated && <div className="cn-note">Сейчас — {seated.name}. Назначенный займёт его место.</div>}
          {list.length === 0 ? (
            <div className="cn-note">{s.faith?.id ? 'Просители этого сезона уже были в ратуше. Новые придут с сезоном.' : 'Просители ещё в пути.'}</div>
          ) : (
            list.map((c) => <CandRow key={c.n} c={c} onHired={onClose} />)
          )}
        </SheetPage>
      </div>
    </>
  );
}

function CandRow({ c, onHired }: { c: Candidate; onHired: () => void }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const b = POST_BRANCH[c.post];
  // Сколько очков он прибавит на деле — под потолком лучшего правителя (`councilrules.rateWithCouncil`), той же формулой,
  // что ставка вида с ним (`sim/points.branchRate`).
  const added = rateWithCouncil(rulerRate(s, b), advisorPoints(c.level, c.trait)) - rulerRate(s, b);
  return (
    <div className="cn-cand">
      <Portrait seed={c.look} age={faceAge(c.age0)} post={c.post} />
      <div className="cn-body">
        <span className="cn-post">
          <b className="cn-name one-line">{c.name}</b>
          <i className="cn-lvl">{dots(c.level)}</i>
        </span>
        <span className="cn-meta">
          {yearsWord(Math.floor(c.age0))} <Trait t={c.trait} />
        </span>
        <Nums post={c.post} gift={c.gift} points={added} wage={c.wage} />
      </div>
      <div className="cn-buy">
        {c.price > 0 ? <Cost cost={{ gold: c.price }} /> : <small className="pos">без платы вперёд</small>}
        <Btn kind="main" why={hireBlock(s, c.post, c.n)} onClick={() => act((st) => hireAdvisor(st, c.post, c.n)) && onHired()}>
          Назначить
        </Btn>
      </div>
    </div>
  );
}
