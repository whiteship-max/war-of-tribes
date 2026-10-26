// Кузница нового интерфейса (docs/ui_audit.md, 6.3): очередь — строками 52, заказ — строками вещей и одной
// закреплённой полосой внизу. Выбрана последняя заказанная вещь, иначе первая изученная; тап по строке выбирает
// другую. Закрытая вещь стоит замком: почему — подсказкой по замку, «Изучить ›» ведёт в технологии.
//
// Своих чисел нет: цена партии, срок и причина отказа — `forgeCheck`, закрыто ли — `gearBlock` (дверь гейта),
// ход заказа — `forgeInfo` (правило 18). Отмена заказа — двумя касаниями одной кнопки.
import { useState } from 'react';
import type { Building, EquipmentId } from '@/game/types';
import { useGame } from '@/game/store';
import { RESOURCE_IDS } from '@/game/constants';
import { EQUIPMENT, EQUIPMENT_BY_ID } from '@/game/data/equipment';
import { forgeInfo, workerCount } from '@/game/derived';
import { cancelForge, forgeCheck, startForge } from '@/game/sim/actions';
import { gearBlock } from '@/game/sim/tech';
import { asGame } from '@/game/pace';
import { useRealm } from '@/ui/realm/open';
import { Icon } from '@/ui/icons/Icon';
import { waitSpan } from '@/ui/parts/wait';
import { tipAt } from './tip';
import { Confirm } from './Confirm';
import { iconName } from '@/ui/icons/registry';
import { actRoom } from '@/ui/room';

/** Шаг заказа: −10 −1 +1 +10, от одной до девяноста девяти — как прежде. */
export const clampCount = (n: number): number => Math.max(1, Math.min(99, n));

/** Какая вещь выбрана при открытии: последняя заказанная, иначе первая изученная, иначе первая. */
export function firstPick(lastOrdered: EquipmentId | null, open: (id: EquipmentId) => boolean): EquipmentId {
  if (lastOrdered && open(lastOrdered)) return lastOrdered;
  return EQUIPMENT.find((e) => open(e.id))?.id ?? EQUIPMENT[0].id;
}

export function SmithyNew({ b }: { b: Building }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const show = useRealm((r) => r.show);
  const info = forgeInfo(s);
  const smiths = workerCount(s, b.id);
  const open = (id: EquipmentId): boolean => gearBlock(s, id) === null;
  const last = s.forge.length > 0 ? s.forge[s.forge.length - 1].item : null;
  const [pick, setPick] = useState<EquipmentId>(() => firstPick(last, open));
  const [n, setN] = useState(1);
  const check = forgeCheck(s, pick, n);
  const def = EQUIPMENT_BY_ID[pick];

  return (
    <div className="nx-smithy">
      {info.idle && <div className="nx-bwarn bad">Кузнецы сидят без заказа.</div>}
      {!info.idle && smiths === 0 && <div className="nx-bwarn">У горна никого. Поставь кузнецов.</div>}

      {s.forge.length > 0 && (
        <>
          <h3>Очередь</h3>
          {s.forge.map((o, i) => {
            const d = EQUIPMENT_BY_ID[o.item];
            const left = d.work * (o.count - o.done) - o.work;
            const eta = info.rate > 0 ? asGame(Math.ceil(Math.max(0, left) / info.rate)) : null;
            const pct = i === 0 ? Math.floor((o.work / Math.max(1, d.work)) * 100) : 0;
            return (
              <div className="nx-qrow" key={o.id}>
                <button
                  className="nx-wico"
                  onClick={(e) =>
                    tipAt(e.currentTarget, { title: d.name, body: 'Отмена вернёт запасы несделанных вещей и половину за начатую.' })
                  }
                  aria-label={`${d.name}: заказ`}
                >
                  <Icon name={iconName('gear', d.id)} />
                </button>
                <div className="nx-qbody">
                  <span>
                    <b>{d.name}</b> {o.done}/{o.count}
                    <small>{i === 0 ? (eta !== null ? waitSpan(eta) : 'стоит') : 'ждёт'}</small>
                  </span>
                  <i className="nx-bbar wide">
                    <i style={{ width: `${pct}%` }} />
                  </i>
                </div>
                <Confirm label="Отменить" onConfirm={() => actRoom((st) => cancelForge(st, o.id))} />
              </div>
            );
          })}
        </>
      )}

      <h3>Заказ</h3>
      {EQUIPMENT.map((e) => {
        const closed = gearBlock(s, e.id);
        const one = forgeCheck(s, e.id, 1);
        const on = e.id === pick;
        return (
          <div
            key={e.id}
            className={`nx-grow-row${on ? ' on' : ''}${closed ? ' lock' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => !closed && setPick(e.id)}
          >
            <span className="nx-gico">
              <Icon name={iconName('gear', e.id)} />
            </span>
            <span className="nx-gname">
              <b>{e.name}</b>
              <small>на складе {s.equipment[e.id] ?? 0}</small>
            </span>
            {closed ? (
              <span className="nx-glock">
                <button
                  className="nx-wico"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    tipAt(ev.currentTarget, { title: e.name, body: closed });
                  }}
                  aria-label={`${e.name}: почему закрыто`}
                >
                  <Icon name="ui-lock" />
                </button>
                <button
                  className="nx-link"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    show('tech');
                  }}
                >
                  Изучить ›
                </button>
              </span>
            ) : (
              <span className="nx-gcost">
                {RESOURCE_IDS.filter((r) => e.cost[r]).map((r) => (
                  <span key={r}>
                    <Icon name={iconName('res', r)} />
                    {one.cost[r]}
                  </span>
                ))}
                {one.eta !== null && <small>{waitSpan(one.eta)}</small>}
              </span>
            )}
          </div>
        );
      })}

      {/* Закреплённая полоса заказа: цена всей партии, шаг, «Заказать» со сроком. Метка обучения — на кнопке
          выбранной вещи (`forge-spear` в обучении: копьё выбрано первым). */}
      <div className="nx-obar">
        <div className="nx-ocost">
          <b className="one-line">
            {def.name} ×{n}
          </b>
          <span className="cost">
            {RESOURCE_IDS.filter((r) => check.cost[r]).map((r) => (
              <span key={r} className={s.resources[r] >= (check.cost[r] ?? 0) ? '' : 'no'}>
                <Icon name={iconName('res', r)} /> {check.cost[r]}
                <i className="have">из {Math.floor(s.resources[r])}</i>
              </span>
            ))}
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
            data-tut={`forge-${pick}`}
            disabled={check.blocked !== null}
            onClick={() => act((st) => startForge(st, pick, n))}
          >
            Заказать
            {check.eta !== null && <small>{waitSpan(check.eta)}</small>}
          </button>
        </div>
        {check.blocked && <small className="nx-why">{check.blocked}</small>}
      </div>
    </div>
  );
}
