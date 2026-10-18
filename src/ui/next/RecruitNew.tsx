// Найм нового интерфейса — тем же видом, что заказ кузницы (`SmithyNew`): очередь строками, виды бойцов строками,
// внизу закреплённая полоса «Нанять». Где учат вид, решает одна дверь (`army.hiredAt`); цена, снаряжение, срок и
// причина отказа — `recruitCheck`; закрыт ли вид — `troopBlock` (дверь гейта); мощь — `powerOf`, жалованье —
// `wageOf` (правило 18).
import { useEffect, useState } from 'react';
import type { TroopId } from '@/game/types';
import { useGame } from '@/game/store';
import { RESOURCE_IDS, RESOURCE_META } from '@/game/constants';
import { TROOPS, TROOP_BY_ID } from '@/game/data/troops';
import { EQUIPMENT_BY_ID } from '@/game/data/equipment';
import { currentStep } from '@/game/data/tutorial';
import { buildingOfType, idleCount, wageOf } from '@/game/derived';
import { powerOf } from '@/game/battle/price';
import { hiredAt, isTraining, orderEta, recruitCheck } from '@/game/sim/army';
import { cancelRecruit, startRecruit } from '@/game/sim/actions';
import { troopBlock } from '@/game/sim/tech';
import { useRealm } from '@/ui/realm/open';
import { Icon } from '@/ui/icons/Icon';
import { waitSpan } from '@/ui/parts/wait';
import { tipAt } from './tip';
import { Confirm } from './Confirm';
import { clampCount } from './SmithyNew';
import { dropRecruitAsk, recruitAsked } from './recruitAsk';
import { dec } from '@/game/num';

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
  const here = TROOPS.filter((d) => hiredAt(d.id) === at).map((d) => d.id);
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
  const check = recruitCheck(s, pick, n);
  const def = TROOP_BY_ID[pick];
  const smithy = buildingOfType(s, 'smithy');
  const free = idleCount(s);

  return (
    <div className="nx-smithy">
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
                  <Icon name={`troop-${d.id}`} glyph={d.icon} />
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
                <Confirm label="Отменить" onConfirm={() => act((st) => cancelRecruit(st, o.id))} />
              </div>
            );
          })}
        </>
      )}

      <h3>Найм</h3>
      {here.map((id) => {
        const d = TROOP_BY_ID[id];
        const closed = troopBlock(s, id);
        const on = id === pick;
        return (
          <div
            key={id}
            className={`nx-grow-row${on ? ' on' : ''}${closed ? ' lock' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => !closed && setPick(id)}
          >
            <button
              className="nx-wico"
              onClick={(ev) => {
                ev.stopPropagation();
                tipAt(ev.currentTarget, { title: d.name, body: closed ?? d.description });
              }}
              aria-label={`${d.name}: кто это`}
            >
              <Icon name={`troop-${d.id}`} glyph={d.icon} />
            </button>
            <span className="nx-gname">
              <b>{d.name}</b>
              <small>
                в дружине {s.army[id] ?? 0} · мощь {dec(powerOf(id), 1)} · {dec(wageOf(s, id), 2)} в день
              </small>
            </span>
            {closed ? (
              <button
                className="nx-link"
                onClick={(ev) => {
                  ev.stopPropagation();
                  show('tech');
                }}
              >
                Изучить ›
              </button>
            ) : (
              on && <Icon name="ui-check" glyph="✔️" className="nx-gpick" />
            )}
          </div>
        );
      })}

      <div className="nx-obar">
        <div className="nx-ocost">
          <b className="one-line">
            {def.name} ×{n}
          </b>
          <span className="cost">
            {RESOURCE_IDS.filter((r) => check.cost[r]).map((r) => (
              <span key={r} className={s.resources[r] >= (check.cost[r] ?? 0) ? '' : 'no'}>
                <Icon name={`res-${r}`} glyph={RESOURCE_META[r].icon} /> {check.cost[r]}
              </span>
            ))}
            {Object.entries(check.gear).map(([id, need]) => (
              <span key={id} className={check.missing.some((m) => m.id === id) ? 'no' : ''}>
                <Icon name={`gear-${id}`} glyph={EQUIPMENT_BY_ID[id as keyof typeof EQUIPMENT_BY_ID].icon} /> {need}
              </span>
            ))}
            <span className={free >= n ? '' : 'no'}>
              <Icon name="hud-pop" glyph="👤" /> {n}
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
          <button
            className="nx-go"
            data-tut={`recruit-${pick}`}
            disabled={check.blocked !== null}
            onClick={() => act((st) => startRecruit(st, pick, n))}
          >
            Нанять
            {check.eta !== null && <small>{waitSpan(check.eta)}</small>}
          </button>
        </div>
        {check.blocked && <small className="nx-why">{check.blocked}</small>}
        {!troopBlock(s, pick) && check.missing.length > 0 && smithy && (
          <button className="nx-link" onClick={() => openBuilding(smithy.id)}>
            Ковать {check.missing.map((m) => EQUIPMENT_BY_ID[m.id].one).join(', ')} ›
          </button>
        )}
      </div>
    </div>
  );
}
