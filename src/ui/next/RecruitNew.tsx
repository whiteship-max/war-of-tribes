// Найм нового интерфейса (Р-3, docs/ui_v2.md, «Решения Р-3»): сверху — значки видов сеткой, под ними — карточка выбранного,
// ниже — число и «Нанять» с ценой и сроком, всё в потоке окна; плавающей полосы нет — она ездила при прокрутке и
// закрывала виды (во второй конный было не попасть). Очередь — под «Нанять». Где учат вид, решает одна дверь (`army.hiredAt`); цена, снаряжение, срок и
// причина отказа — `recruitCheck`; закрыт ли вид — `troopBlock` (дверь гейта); мощь — `powerOf`, жалованье —
// `troopWage` — при нынешнем жалованье дружине (правило 18, ДР-1).
import { useEffect, useState } from 'react';
import type { EquipmentId, GameState, TroopId } from '@/game/types';
import { useGame } from '@/game/store';
import { RESOURCE_IDS } from '@/game/constants';
import { TROOPS, TROOP_BY_ID } from '@/game/data/troops';
import { EQUIPMENT_BY_ID } from '@/game/data/equipment';
import { currentStep } from '@/game/data/tutorial';
import { buildingOfType, idleCount, troopWage } from '@/game/derived';
import { powerOf } from '@/game/battle/price';
import { hiredAt, isTraining, orderEta, recruitCheck } from '@/game/sim/army';
import { cancelRecruit, startRecruit } from '@/game/sim/actions';
import { troopBlock } from '@/game/sim/tech';
import { useRealm } from '@/ui/realm/open';
import { Icon } from '@/ui/icons/Icon';
import { waitSpan } from '@/ui/parts/wait';
import { Confirm } from './Confirm';
import { clampCount } from './SmithyNew';
import { dropRecruitAsk, recruitAsked } from './recruitAsk';
import { dec } from '@/game/num';
import { iconName } from '@/ui/icons/registry';
import { actRoom } from '@/ui/room';

/**
 * Какой вид выбран при открытии: тот, к которому ведёт шаг обучения (его метка — на кнопке «Нанять» выбранного
 * вида), иначе тот, чью карточку игрок открыл и нажал «Нанять» (`asked`, `recruitAsk`) — и закрытый, иначе последний
 * нанятый, если открыт, иначе первый открытый, иначе первый.
 */
export function firstTroop(
  here: readonly TroopId[],
  tutorial: TroopId | null,
  last: TroopId | null,
  open: (id: TroopId) => boolean,
  asked: TroopId | null = null,
): TroopId {
  if (tutorial && here.includes(tutorial)) return tutorial;
  // Позванный вид выбран и закрытым: «Нанять» гаснет с причиной (`recruitCheck` — гейт), а не нанимает другой вид молча.
  if (asked && here.includes(asked)) return asked;
  if (last && here.includes(last) && open(last)) return last;
  return here.find(open) ?? here[0];
}

/** Вид, к которому зовёт шаг обучения: метка `recruit-<вид>` у его цели. */
export function tutorialTroop(sel: string | null): TroopId | null {
  const m = sel ? /recruit-(\w+)/.exec(sel) : null;
  return m ? (m[1] as TroopId) : null;
}

export function RecruitNew({ at }: { at: 'barracks' | 'stable' }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const openBuilding = useGame((g) => g.openBuilding);
  const show = useRealm((r) => r.show);
  const here = hereOf(at);
  const queue = (s.recruits ?? []).filter((o) => hiredAt(o.troop) === at);
  const open = (id: TroopId): boolean => troopBlock(s, id) === null;
  const step = currentStep(s);
  const tut = tutorialTroop(step?.target.kind === 'dom' ? step.target.sel : null);
  const last = queue.length > 0 ? queue[queue.length - 1].troop : null;
  const [pick, setPick] = useState<TroopId>(() => firstTroop(here, tut, last, open, recruitAsked()));
  // Просьба карточки вида прочитана — снять, чтобы следующее открытие найма шло прежним правилом.
  useEffect(dropRecruitAsk, []);
  const [n, setN] = useState(1);
  if (here.length === 0) return null;
  return (
    <HireBody
      s={s}
      at={at}
      pick={pick}
      n={n}
      onPick={setPick}
      onCount={setN}
      act={act}
      openBuilding={openBuilding}
      show={() => show('tech')}
    />
  );
}

/** Виды, которых учит это здание (`army.hiredAt`), в порядке справочника. */
export const hereOf = (at: 'barracks' | 'stable'): TroopId[] => TROOPS.filter((d) => hiredAt(d.id) === at).map((d) => d.id);

export interface HireProps {
  s: GameState;
  at: 'barracks' | 'stable';
  pick: TroopId;
  n: number;
  onPick: (id: TroopId) => void;
  onCount: (n: number) => void;
  act: (fn: (s: GameState) => string | null) => boolean;
  openBuilding: (id: number) => void;
  show: () => void;
}

/**
 * Тело найма без своего состояния: выбор и число держит `RecruitNew`, тело только показывает и зовёт. Так тест жмёт
 * значок вида и «Нанять» без браузера (`hire.test.ts`).
 */
export function HireBody({ s, at, pick, n, onPick, onCount, act, openBuilding, show }: HireProps) {
  const here = hereOf(at);
  const queue = (s.recruits ?? []).filter((o) => hiredAt(o.troop) === at);
  const open = (id: TroopId): boolean => troopBlock(s, id) === null;
  const setPick = onPick;
  const setN = onCount;
  const check = recruitCheck(s, pick, n);
  const one = recruitCheck(s, pick, 1);
  const def = TROOP_BY_ID[pick];
  const closed = troopBlock(s, pick);
  const smithy = buildingOfType(s, 'smithy');
  const free = idleCount(s);
  const gear = Object.entries(one.gear);

  return (
    <div className="nx-smithy nx-hire">
      <h3>Найм</h3>
      {/* Виды — значками сеткой: выбирается любой, закрытый тоже — карточка скажет, почему он закрыт. */}
      <div className="nx-hgrid" role="radiogroup" aria-label="Вид бойцов">
        {here.map((id) => {
          const d = TROOP_BY_ID[id];
          const lock = !open(id);
          const have = s.army[id] ?? 0;
          return (
            <button
              key={id}
              role="radio"
              aria-checked={id === pick}
              data-troop={id}
              className={`nx-htile${id === pick ? ' on' : ''}${lock ? ' lock' : ''}`}
              onClick={() => setPick(id)}
            >
              <Icon name={iconName('troop', id)} className="nx-hico" />
              <span className="nx-hname">{d.name}</span>
              {lock ? <Icon name="ui-lock" className="nx-hbadge" /> : have > 0 && <b className="nx-hbadge">{have}</b>}
            </button>
          );
        })}
      </div>

      <div className="nx-hcard">
        <div className="nx-hhead">
          <b>{def.name}</b>
          <small>{def.description}</small>
        </div>
        {closed && (
          <div className="nx-hlocked">
            <Icon name="ui-lock" />
            <span>{closed}</span>
            <button className="nx-link" onClick={show}>
              Изучить ›
            </button>
          </div>
        )}
        <dl className="nx-hstats">
          <div>
            <dt>Мощь</dt>
            <dd>{dec(powerOf(pick), 1)}</dd>
          </div>
          <div>
            <dt>Жалованье</dt>
            <dd>
              <Icon name="res-gold" /> {dec(troopWage(s, pick), 2)}
              <small>в день</small>
            </dd>
          </div>
          <div>
            <dt>В дружине</dt>
            <dd>{s.army[pick] ?? 0}</dd>
          </div>
          <div className="wide">
            <dt>Цена</dt>
            <dd>
              {RESOURCE_IDS.filter((r) => one.cost[r]).map((r) => (
                <span key={r}>
                  <Icon name={iconName('res', r)} /> {one.cost[r]}
                </span>
              ))}
              <span>
                <Icon name="hud-pop" /> 1
              </span>
            </dd>
          </div>
          <div>
            <dt>Срок</dt>
            <dd>{one.eta !== null ? waitSpan(one.eta) : '—'}</dd>
          </div>
          {gear.length > 0 && (
            <div className="full">
              <dt>Снаряжение</dt>
              <dd>
                {gear.map(([id, need]) => (
                  <span key={id}>
                    <Icon name={iconName('gear', id)} /> {need} <small>{EQUIPMENT_BY_ID[id as EquipmentId].one}</small>
                  </span>
                ))}
              </dd>
            </div>
          )}
        </dl>
      </div>

      <div className="nx-horder">
        <div className="nx-ocost">
          <b className="one-line">×{n}</b>
          <span className="cost">
            {RESOURCE_IDS.filter((r) => check.cost[r]).map((r) => (
              <span key={r} className={s.resources[r] >= (check.cost[r] ?? 0) ? '' : 'no'}>
                <Icon name={iconName('res', r)} /> {check.cost[r]}
              </span>
            ))}
            {Object.entries(check.gear).map(([id, need]) => (
              <span key={id} className={check.missing.some((m) => m.id === id) ? 'no' : ''}>
                <Icon name={iconName('gear', id)} /> {need}
              </span>
            ))}
            <span className={free >= n ? '' : 'no'}>
              <Icon name="hud-pop" /> {n}
              <i className="have">из {free}</i>
            </span>
          </span>
        </div>
        <div className="nx-ostep">
          <button onClick={() => setN(clampCount(n - 10))} disabled={n <= 1} aria-label="Меньше на 10">
            −10
          </button>
          <button onClick={() => setN(clampCount(n - 1))} disabled={n <= 1} aria-label="Меньше">
            −
          </button>
          <b>{n}</b>
          <button onClick={() => setN(clampCount(n + 1))} disabled={n >= 99} aria-label="Больше">
            +
          </button>
          <button onClick={() => setN(clampCount(n + 10))} disabled={n >= 99} aria-label="Больше на 10">
            +10
          </button>
        </div>
        <button
          className="nx-go"
          data-tut={`recruit-${pick}`}
          disabled={check.blocked !== null}
          onClick={() => act((st) => startRecruit(st, pick, n))}
        >
          Нанять: {def.name.toLowerCase()} ×{n}
          {check.eta !== null && <small>{waitSpan(check.eta)}</small>}
        </button>
        {check.blocked && !closed && <small className="nx-why">{check.blocked}</small>}
        {!closed && check.missing.length > 0 && smithy && (
          <button className="nx-link" onClick={() => openBuilding(smithy.id)}>
            Ковать {check.missing.map((m) => EQUIPMENT_BY_ID[m.id].one).join(', ')} ›
          </button>
        )}
      </div>

      {queue.length > 0 && (
        <>
          <h3>Очередь</h3>
          {queue.map((o) => {
            const d = TROOP_BY_ID[o.troop];
            const now = isTraining(s, o);
            const eta = orderEta(s, o);
            const pct = now ? Math.floor((o.work / d.work) * 100) : 0;
            return (
              <div className="nx-qrow" key={o.id}>
                <span className="nx-wico">
                  <Icon name={iconName('troop', d.id)} />
                </span>
                <div className="nx-qbody">
                  <span>
                    <b>{d.name}</b> {o.done}/{o.count}
                    <small>{now ? (eta !== null ? waitSpan(eta) : 'стоит') : 'ждёт'}</small>
                  </span>
                  <i className="nx-bbar wide">
                    <i style={{ width: `${pct}%` }} />
                  </i>
                </div>
                <Confirm label="Отменить" onConfirm={() => actRoom((st) => cancelRecruit(st, o.id))} />
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
