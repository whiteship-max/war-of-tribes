// Вкладки державы нового вида (docs/ui_audit.md, 6.4 и 13): Правитель, Указы, Вера, Задания — тем же видом, что
// технологии. Шапка вкладки — строка чисел-справок, выбор — ряд из трёх ячеек, необратимое — двумя касаниями одной
// кнопки (3.10). Объяснения правил — в подсказках касанием (3.7), на экране — подпись, число, действие.
//
// Своих чисел нет (правило 18): возраст, срок до покоя и очки — `sim/dynasty`, `sim/points`; сбор, жалованье и что
// даст налог — `derived` (`taxIncomePerDay`, `wagesDue`, `taxQuote`); наклон веры и крещение — `faithTilt`,
// `baptismInfo`; задания — их `progress`. Писатели — те же двери, что у прежнего вида (`sim/actions`, `sim/faith`).
import { useState, type ReactNode } from 'react';
import { useGame } from '@/game/store';
import { useWorld } from '@/world/store';
import { CHEATS_ON, CHEAT_MARK, HASTE_MARK } from '@/cheats';
import { RESOURCE_IDS, RESOURCE_META } from '@/game/constants';
import { RETIRE_AGE } from '@/game/data/agents';
import { FAITH_BY_ID, OBSERVANCES } from '@/game/data/faiths';
import { DECREES, RATIONS, TAXES, type TaxDef } from '@/game/data/policy';
import { ACHIEVEMENTS, QUESTS, questsDone } from '@/game/data/quests';
import { REALM_BRANCHES } from '@/game/data/realm';
import {
  bondedTotal,
  decreeOf,
  faithDef,
  faithTilt,
  mastersCount,
  observanceOf,
  orderBreakdown,
  orderState,
  population,
  rationOf,
  taxIncomePerDay,
  taxOf,
  taxQuote,
  templeLevel,
  wagesDue,
} from '@/game/derived';
import { setDecree, setRation, setTax } from '@/game/sim/actions';
import { yearsWord } from '@/game/sim/agents';
import { rulerAge, rulerAging, rulerRestAt, rulerYears } from '@/game/sim/dynasty';
import { baptismInfo, baptize, setObservance } from '@/game/sim/faith';
import { rulerRate } from '@/game/sim/points';
import { asGame } from '@/game/pace';
import type { FaithId, GameState, ObservanceId, RealmBranch } from '@/game/types';
import { Icon } from '@/ui/icons/Icon';
import { iconName } from '@/ui/icons/registry';
import { Confirm } from '@/ui/next/Confirm';
import { fmtInt, perDay } from '@/ui/next/hudTips';
import { decreeLine, rationLine } from '@/ui/parts/policyWords';
import { tipAt, type TipContent } from '@/ui/next/tip';
import { Chronicle } from '@/ui/parts/Chronicle';
import { Cost } from '@/ui/parts/Cost';
import { DailyPage } from '@/ui/parts/daily/DailyPage';
import { SceneDoctor } from '@/ui/parts/SceneDoctor';
import { signed } from '@/ui/parts/signed';
import { SpareSave } from '@/ui/parts/Sync';
import { TouchDoctor } from '@/ui/parts/TouchDoctor';
import { waitSpan } from '@/ui/parts/wait';
import { count } from '@/ui/parts/plural';
import { OrderPanel } from '@/ui/panels/OrderPanel';
import { Bonded } from '@/ui/panels/PeoplePanel';
import { BRANCH_ICON, BRANCH_WORD } from './branches';

/** Строк рода, видных сразу (6.4: «три последних строки рода»); остальные — по «Все». */
export const LINEAGE_SHOWN = 3;

// ---------- Общие части ----------

/** Ставка со знаком без слов — для ячейки, где «в день» стоит подписью: «+19,9», «−3,0»; запятая (4.5). */
export const signedRate = (n: number): string => perDay(n).replace(/ в день$/, '');

/** Дробь — запятой (4.5): «×1,05», «+0,6». */
export const comma = (text: string): string => text.replace('.', ',');

/** Навык точками: столько полных, сколько навык, из пяти. */
function Dots({ n, max = 5 }: { n: number; max?: number }) {
  return (
    <span className="nx-dots" aria-label={`навык ${n}`}>
      {Array.from({ length: max }, (_, i) => (
        <i key={i} className={i < n ? 'on' : ''} />
      ))}
    </span>
  );
}

export interface PickItem<T extends string> {
  id: T;
  icon: string;
  glyph: string;
  name: string;
  /** Одна строка под именем: что даст этот выбор числом. */
  sub?: string;
  subBad?: boolean;
}

/**
 * Выбор из трёх — ряд ячеек: значок, имя и, если есть, число. Что даёт выбранное — одной строкой под рядом:
 * переключать можно в любой момент и даром, так что посмотреть — значит выбрать.
 */
function Pick<T extends string>({
  title,
  items,
  value,
  onPick,
  note,
}: {
  title: string;
  items: PickItem<T>[];
  value: T;
  onPick: (id: T) => void;
  note: ReactNode;
}) {
  return (
    <section className="nx-pick">
      <h3>{title}</h3>
      <div className="nx-opts" role="radiogroup" aria-label={title}>
        {items.map((it) => (
          <button
            key={it.id}
            role="radio"
            aria-checked={it.id === value}
            className={`nx-opt${it.id === value ? ' on' : ''}`}
            onClick={() => onPick(it.id)}
          >
            <span className="nx-oico">
              <Icon name={it.icon} glyph={it.glyph} />
            </span>
            <b>{it.name}</b>
            {it.sub && <small className={it.subBad ? 'bad' : ''}>{it.sub}</small>}
          </button>
        ))}
      </div>
      <p className="nx-pnote">{note}</p>
    </section>
  );
}

// ---------- Правитель ----------

/** Подсказка навыка: сколько очков он даёт — `sim/points.rulerRate` (правило 18). */
export function skillTip(b: RealmBranch, skill: number, rate: number, heir: number): TipContent {
  return {
    title: `${BRANCH_WORD[b]} · навык ${skill}`,
    body: `${rate > 0 ? `+${count(rate, 'очко', 'очка', 'очков')}` : 'Ноль очков'} в игровой день. У наследника — навык ${heir}.`,
  };
}

export function RulerNew() {
  const s = useGame((g) => g.s);
  const [all, setAll] = useState(false);
  const r = s.realm;
  const restIn = Math.max(0, rulerRestAt(s) - s.time);
  const rows = s.lineage?.ruler ?? [];
  const shown = all ? rows : rows.slice(0, LINEAGE_SHOWN);

  return (
    <div className="nx-tab">
      <div className="nx-person">
        <span className="nx-pmed">
          <Icon name="ui-crown" glyph="👑" />
        </span>
        <div className="nx-pname">
          <b className="one-line">{r.ruler.name ?? 'Имени ещё нет'}</b>
          <small className={rulerAging(s) ? 'warn' : ''}>
            {yearsWord(rulerYears(s))} · {rulerAge(s) < RETIRE_AGE ? `на покой через ${waitSpan(asGame(restIn))}` : 'уходит на покой'}
          </small>
        </div>
      </div>
      <div className="nx-skills">
        {REALM_BRANCHES.map((b) => (
          <button
            key={b}
            className="nx-skill"
            aria-label={`${BRANCH_WORD[b]}: навык`}
            onClick={(e) => tipAt(e.currentTarget, skillTip(b, r.ruler.skills[b], rulerRate(s, b), r.heir.skills[b]))}
          >
            <Icon name={BRANCH_ICON[b].name} glyph={BRANCH_ICON[b].glyph} />
            <Dots n={r.ruler.skills[b]} />
            <small>{BRANCH_WORD[b]}</small>
          </button>
        ))}
      </div>

      <h3>Наследник</h3>
      <div className="nx-heir">
        <span className="nx-hico">
          <Icon name="ui-person" glyph="👤" />
        </span>
        <b className="one-line">{r.heir.name ?? 'Имени ещё нет'}</b>
        <span className="nx-hskills">
          {REALM_BRANCHES.map((b) => (
            <span key={b}>
              <Icon name={BRANCH_ICON[b].name} glyph={BRANCH_ICON[b].glyph} />
              {r.heir.skills[b]}
            </span>
          ))}
        </span>
      </div>
      <p className="nx-tnote">При смене правителя меняются только навыки. Очки и изученное остаются.</p>

      <h3>
        Род <span className="muted">{rows.length > 0 ? `${rows.length}` : ''}</span>
      </h3>
      {rows.length === 0 && <p className="nx-tnote">Прежних правителей ещё нет.</p>}
      {shown.map((row, i) => (
        <div className="nx-lrow" key={`${row.name}-${i}`}>
          <span className="nx-lico">
            {row.end === 'fell' ? <Icon name="ui-grave" glyph="⚰️" /> : <Icon name="ui-crown" glyph="👑" />}
          </span>
          <span className="nx-lbody">
            <b className="one-line">{row.name}</b>
            <small className="nx-lskills">
              {row.from}–{yearsWord(row.to)}
              {row.skills &&
                REALM_BRANCHES.map((b) => (
                  <span key={b}>
                    <Icon name={BRANCH_ICON[b].name} glyph={BRANCH_ICON[b].glyph} />
                    {row.skills?.[b]}
                  </span>
                ))}
            </small>
          </span>
          <small className={row.end === 'fell' ? 'bad' : ''}>{row.end === 'fell' ? 'погиб' : 'оставил правление'}</small>
        </div>
      ))}
      {rows.length > LINEAGE_SHOWN && (
        <button className="nx-more" onClick={() => setAll(!all)}>
          {all ? 'Свернуть' : `Все ${rows.length}`}
        </button>
      )}
    </div>
  );
}

// ---------- Указы ----------

/** Подсказки золота — числами `derived` (правило 18). */
export function ledgerTips(gold: number, income: number, wages: number, masters: boolean): Record<'gold' | 'income' | 'wages', TipContent> {
  return {
    gold: { title: `Золото · ${fmtInt(gold)}`, body: 'Из него платят дружине и мастерам. Кончится — бойцы начнут уходить.' },
    income: { title: `Сбор · ${perDay(income)}`, body: 'Чем больше жителей, тем больше сбор. Налог выше — мораль ниже.' },
    wages: { title: `Жалованье · ${perDay(-wages)}`, body: masters ? 'Дружине и наёмным мастерам.' : 'Дружине.' },
  };
}

/** Ячейки налога: сбор каждого — `taxQuote`, тем же числом, что считает игра (правило 18). */
export function taxPicks(s: GameState): PickItem<TaxDef['id']>[] {
  return TAXES.map((t) => {
    const q = taxQuote(s, t.id);
    return { id: t.id, icon: `tax-${t.id}`, glyph: t.icon, name: t.name, sub: perDay(q.gold), subBad: q.gold < 0 };
  });
}

export function DecreesNew() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const [order, setOrder] = useState(false);
  const decree = decreeOf(s);
  const ration = rationOf(s);
  const tax = taxOf(s);
  const income = taxIncomePerDay(s);
  const wages = wagesDue(s);
  const tips = ledgerTips(s.gold, income, wages, mastersCount(s) > 0);
  const quote = taxQuote(s, tax.id);
  const bonded = bondedTotal(s);
  const o = Math.round(orderBreakdown(s).value);

  return (
    <div className="nx-tab">
      <div className="nx-ledger">
        <button className="nx-lcell" onClick={(e) => tipAt(e.currentTarget, tips.gold)} aria-label="Золото">
          <Icon name="res-gold" glyph="💰" />
          <b>{fmtInt(s.gold)}</b>
        </button>
        <button className="nx-lcell" onClick={(e) => tipAt(e.currentTarget, tips.income)} aria-label="Сбор в день">
          <small>сбор</small>
          <b className={income < 0 ? 'bad' : 'good'}>{signedRate(income)}</b>
        </button>
        <button className="nx-lcell" onClick={(e) => tipAt(e.currentTarget, tips.wages)} aria-label="Жалованье в день">
          <small>жалованье</small>
          <b className={wages > income ? 'bad' : ''}>{signedRate(-wages)}</b>
        </button>
      </div>

      <Pick
        title="Указ"
        value={decree.id}
        onPick={(id) => act((st) => setDecree(st, id))}
        items={DECREES.map((d) => ({ id: d.id, icon: `decree-${d.id}`, glyph: d.icon, name: d.name }))}
        note={decreeLine(decree)}
      />
      <Pick
        title="Паёк"
        value={ration.id}
        onPick={(id) => act((st) => setRation(st, id))}
        items={RATIONS.map((r) => ({ id: r.id, icon: `ration-${r.id}`, glyph: r.icon, name: r.name }))}
        note={rationLine(ration)}
      />
      <Pick
        title="Налог"
        value={tax.id}
        onPick={(id) => act((st) => setTax(st, id))}
        items={taxPicks(s)}
        note={`Мораль станет ${Math.round(quote.morale)}, выработка ${comma(`×${quote.output.toFixed(2)}`)}.`}
      />

      {bonded > 0 && (
        <>
          <h3>Невольники</h3>
          <button className={`nx-orow ${orderState(s)}`} onClick={() => setOrder(!order)} aria-expanded={order}>
            <Icon name="hud-order" glyph="⛓️" />
            <span>Порядок</span>
            <i className="nx-obar-mini">
              <i style={{ width: `${Math.max(0, Math.min(100, o))}%` }} />
            </i>
            <b>{o}</b>
            <span className="nx-chev">{order ? '▾' : '›'}</span>
          </button>
          {order && (
            <div className="nx-old">
              <OrderPanel />
              <div className="panel">
                <Bonded />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------- Вера ----------

interface TiltCell {
  key: string;
  label: string;
  value: string;
  good: boolean;
  hint: string;
}

/** Числа наклона ячейками: только те, что вера трогает (ноль — шум), — `faithTilt` (правило 18). */
export function tiltCells(t: ReturnType<typeof faithTilt>, pop: number): TiltCell[] {
  const out: TiltCell[] = [];
  const near = (a: number, b: number): boolean => Math.abs(a - b) <= 0.001;
  if (!near(t.goldPerPop, 0))
    out.push({
      key: 'gold',
      label: t.goldPerPop > 0 ? 'Десятина' : 'Закят',
      value: perDay(t.goldPerPop * pop),
      good: t.goldPerPop > 0,
      hint: `${comma(Math.abs(t.goldPerPop).toFixed(2))} золота с жителя в день.`,
    });
  if (!near(t.morale, 0)) out.push({ key: 'morale', label: 'Мораль', value: comma(signed(t.morale)), good: t.morale > 0, hint: 'Столько вера даёт морали города.' });
  if (!near(t.output, 1))
    out.push({ key: 'output', label: 'Выработка', value: comma(`×${t.output.toFixed(2)}`), good: t.output > 1, hint: 'Всех ремёсел. Служб и постов в году много.' });
  if (!near(t.steadfast, 0))
    out.push({ key: 'steadfast', label: 'Оборона', value: comma(`×${(1 + t.steadfast).toFixed(2)}`), good: true, hint: 'Община держит тех, кто на стене.' });
  if (!near(t.learning, 1))
    out.push({ key: 'learning', label: 'Разведка округи', value: comma(`×${t.learning.toFixed(2)}`), good: t.learning > 1, hint: 'Дозор быстрее. Медресе учит счёту и письму.' });
  if (!near(t.growth, 0))
    out.push({ key: 'growth', label: 'Прирост', value: comma(`×${(1 + t.growth).toFixed(2)}`), good: true, hint: 'Закят держит бедных на ногах.' });
  if (t.fervour > 0.001)
    out.push({ key: 'fervour', label: 'Стойкость', value: comma(`+${t.fervour.toFixed(1)}`), good: true, hint: 'К морали дружины в начале боя, на время обряда.' });
  return out;
}

export function FaithNew() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const def = faithDef(s);
  if (!def) {
    return (
      <div className="nx-tab">
        <p className="nx-tnote">Вера города — вера земли вокруг. Открой карту, и она станет известна.</p>
      </div>
    );
  }
  const tilt = faithTilt(s);
  const level = templeLevel(s);
  const obs = observanceOf(s);
  const bapt = baptismInfo(s);
  const cells = tiltCells(tilt, population(s));
  const chosen = OBSERVANCES.find((o) => o.id === obs);

  return (
    <div className="nx-tab">
      <div className="nx-person">
        <span className="nx-pmed">
          <Icon name={`faith-${def.id}`} glyph={def.icon} />
        </span>
        <div className="nx-pname">
          <b className="one-line">{def.name}</b>
          <small>
            {def.temple} · ур. {level}
          </small>
        </div>
      </div>
      <p className="nx-tnote">{def.creed}</p>
      {s.faith.converted && <p className="nx-tnote">Город крещён. Обратной дороги нет.</p>}

      <h3>Наклон веры</h3>
      <div className="nx-gift">
        <span className="good">Даёт</span>
        <span>{tilt.boon}</span>
        <span className="bad">Просит</span>
        <span>{tilt.burden}</span>
      </div>
      {cells.length > 0 && (
        <div className="nx-tcells">
          {cells.map((c) => (
            <button key={c.key} className="nx-tgcell" onClick={(e) => tipAt(e.currentTarget, { title: `${c.label} · ${c.value}`, body: c.hint })}>
              <small className="one-line">{c.label}</small>
              <b className={c.good ? 'good' : 'bad'}>{c.value}</b>
            </button>
          ))}
        </div>
      )}
      <p className="nx-tnote">Уровень храма растит и дар, и цену.</p>

      <Pick
        title="Устав"
        value={obs}
        onPick={(id) => act((st) => setObservance(st, id as ObservanceId))}
        items={OBSERVANCES.map((o) => ({ id: o.id, icon: `obs-${o.id}`, glyph: o.icon, name: o.name }))}
        note={chosen?.effect ?? ''}
      />

      {bapt.options.length > 0 && (
        <>
          <h3>Крещение</h3>
          <p className="nx-tnote">Соседи иной веры станут ближе. Цена — дары, старая святыня и надлом веры. Обратной дороги нет.</p>
          <div className="nx-bapt-cost">
            <Cost cost={{ gold: bapt.gold }} />
          </div>
          {bapt.options.map((id) => (
            <div className="nx-brow" key={id}>
              <span className="nx-lico">
                <Icon name={`faith-${id}`} glyph={FAITH_BY_ID[id].icon} />
              </span>
              <span className="nx-lbody">
                <b className="one-line">{FAITH_BY_ID[id].name}</b>
                <small>{FAITH_BY_ID[id].tilt.boon}</small>
              </span>
              {bapt.blocked === null ? (
                <Confirm label="Принять" onConfirm={() => act((st) => baptize(st, id as FaithId))} />
              ) : (
                <button className="nx-confirm" disabled>
                  Принять
                </button>
              )}
            </div>
          ))}
          {bapt.blocked && <p className="nx-why-line">{bapt.blocked}</p>}
        </>
      )}
    </div>
  );
}

// ---------- Задания ----------

export function QuestsNew() {
  const s = useGame((g) => g.s);
  const reset = useGame((g) => g.reset);
  const resetWorld = useWorld((g) => g.resetWorld);
  const replayTutorial = useGame((g) => g.replayTutorial);
  const [page, setPage] = useState<'quests' | 'daily'>('quests');
  const [more, setMore] = useState(false);
  const open = QUESTS.filter((q) => !s.completedQuests.includes(q.id)).slice(0, 3);
  const got = ACHIEVEMENTS.filter((a) => a.check(s)).length;

  return (
    <div className="nx-tab">
      <div className="nx-seg" role="tablist">
        <button role="tab" aria-selected={page === 'quests'} className={page === 'quests' ? 'on' : ''} onClick={() => setPage('quests')}>
          <Icon name="ui-scroll" glyph="📜" /> Задания
        </button>
        <button role="tab" aria-selected={page === 'daily'} className={page === 'daily' ? 'on' : ''} onClick={() => setPage('daily')}>
          <Icon name="ui-target" glyph="🎯" /> Каждый день
        </button>
      </div>

      {page === 'daily' ? (
        <DailyPage />
      ) : (
        <>
          <p className="nx-qsum">
            Выполнено {questsDone(s)} из {QUESTS.length} · слава {s.prestige}
          </p>
          {open.map((q) => {
            const p = q.progress?.(s);
            return (
              <div className="nx-quest" key={q.id}>
                <span className="nx-lico">
                  <Icon name="ui-scroll" glyph="📜" />
                </span>
                <span className="nx-lbody">
                  <b>{q.title}</b>
                  <small>{q.description}</small>
                  {p && (
                    <span className="nx-qbar">
                      <i className="nx-bbar wide">
                        <i style={{ width: `${Math.min(100, (p[0] / Math.max(1, p[1])) * 100)}%` }} />
                      </i>
                      <em>
                        {p[0]}/{p[1]}
                      </em>
                    </span>
                  )}
                </span>
                <span className="nx-reward">
                  {RESOURCE_IDS.filter((r) => q.reward[r]).map((r) => (
                    <span key={r}>
                      <Icon name={`res-${r}`} glyph={RESOURCE_META[r].icon} />
                      {q.reward[r]}
                    </span>
                  ))}
                </span>
              </div>
            );
          })}
          {open.length === 0 && <p className="nx-tnote">Все задания выполнены.</p>}

          <h3>
            Достижения <span className="muted">{got}/{ACHIEVEMENTS.length}</span>
          </h3>
          <div className="nx-ach">
            {ACHIEVEMENTS.map((a) => {
              const ok = a.check(s);
              return (
                <button
                  key={a.id}
                  className={ok ? 'on' : ''}
                  aria-label={a.title}
                  onClick={(e) => tipAt(e.currentTarget, { title: a.title, body: ok ? 'Получено.' : 'Ещё не получено.' })}
                >
                  <Icon name={iconName('ach', a.id)} glyph={a.icon} />
                </button>
              );
            })}
          </div>

          <div className="nx-old">
            <Chronicle />
          </div>

          <button className="nx-more" onClick={() => setMore(!more)} aria-expanded={more}>
            Служебное {more ? '▾' : '›'}
          </button>
          {more && (
            <div className="nx-old nx-service">
              {s.cheated && <div className="desc cheat-mark">{CHEAT_MARK}</div>}
              {CHEATS_ON && s.lead !== undefined && <div className="desc cheat-mark">{HASTE_MARK}</div>}
              <button className="btn ghost wide" onClick={replayTutorial}>
                Пройти обучение заново
              </button>
              <SceneDoctor />
              <TouchDoctor />
              <SpareSave />
              <Confirm
                label="Начать заново"
                className="nx-danger"
                onConfirm={() => {
                  // Новая партия — новый мир: старые соседи и походы к ней отношения не имеют.
                  reset();
                  void resetWorld();
                }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
