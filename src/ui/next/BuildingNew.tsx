// Окно постройки нового интерфейса — общий шаблон для всех построек (docs/ui_audit.md, 3.10 и 6.3).
//
// Шапка — одна строка: значок (тап — описание здания подсказкой), имя, «ур. 3/10» с полоской доли до потолка
// и главное действие справа — «Улучшить» со сроком. Цена улучшения — строкой `Cost` сразу под шапкой, что даст
// уровень — 11 px под ней. Рабочие — одной строкой: значок, «3/12», шаг; сколько свободных рук — подсказкой по
// значку. Дальше — данные и действия своего здания (`data`), те же, что в прежнем окне.
//
// Своих чисел нет: цена, срок, места и что даст уровень — `upgradeInfo`, `buildRate`, `upgradeGains`
// (правило 18). Отмена стройки — двумя касаниями одной кнопки (3.10): первое превращает её в «Точно?».
import { type ReactNode } from 'react';
import type { Building } from '@/game/types';
import { useGame } from '@/game/store';
import { MAX_BUILDING_LEVEL } from '@/game/constants';
import { BUILDING_BY_ID } from '@/game/data/buildings';
import { JOB_BY_ID } from '@/game/data/jobs';
import { ORDER_TEXT } from '@/game/data/order';
import {
  bondedCount,
  bondedIdle,
  bondedTotal,
  buildRate,
  buildingById,
  buildingSlots,
  buildingTitle,
  currentSite,
  idleCount,
  isOutsideWall,
  isSite,
  mastersOn,
  maxLevelFor,
  takesBonded,
  upgradeInfo,
  workerCount,
} from '@/game/derived';
import { assignBonded, assignWorker, cancelUpgrade, startUpgrade, unassignBonded, unassignWorker } from '@/game/sim/actions';
import { asGame } from '@/game/pace';
import { Icon } from '@/ui/icons/Icon';
import { Cost } from '@/ui/parts/Cost';
import { Steps } from '@/ui/parts/Steps';
import { waitSpan } from '@/ui/parts/wait';
import { gainText, spareSlotsHelp, upgradeGains, type UpgradeGain } from '@/ui/parts/upgrade';
import { tipAt } from './tip';
import { workerTip } from './buildingTips';
import { Confirm } from './Confirm';

/** Кнопка «Точно?» живёт своим модулем (`Confirm.tsx`): ею пользуются и держава, и найм. */
export { CONFIRM_MS, Confirm } from './Confirm';

export function BuildingNew({ id, data }: { id: number; data: (b: Building) => ReactNode }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const closeSheet = useGame((g) => g.closeSheet);
  const b = buildingById(s, id);
  if (!b) {
    return (
      <div className="panel nx-bpanel">
        <div className="nx-bhead">
          <div className="nx-btitle">
            <b>Здания больше нет</b>
          </div>
        </div>
      </div>
    );
  }
  const def = BUILDING_BY_ID[b.type];
  const max = def.maxLevel ?? MAX_BUILDING_LEVEL;
  const up = upgradeInfo(s, b);
  const site = isSite(b);
  const rate = buildRate(s);
  const first = currentSite(s);
  const inQueue = site && first !== null && first.id !== b.id;
  const canLevel = max > 1;
  const top = b.level >= maxLevelFor(b.type);
  const upEta = rate > 0 ? asGame(Math.ceil(up.work / rate)) : null;
  const siteEta = rate > 0 ? asGame(Math.ceil((b.workRequired - b.work) / rate)) : null;
  const gains = !top ? upgradeGains(s, b, b.level + 1) : null;
  const share = Math.floor((b.work / Math.max(1, b.workRequired)) * 100);

  return (
    <div className="panel nx-bpanel">
      <div className="nx-bhead">
        <button
          className="nx-bico"
          onClick={(e) => tipAt(e.currentTarget, { title: buildingTitle(s, b.type), body: def.description })}
          aria-label={`${buildingTitle(s, b.type)}: что это`}
        >
          <Icon name={`bld-${def.id}`} glyph={def.icon} />
        </button>
        <div className="nx-btitle">
          <b className="one-line">{buildingTitle(s, b.type)}</b>
          {canLevel && (
            <span className="nx-blvl">
              ур. {b.level}/{max}
              <i className="nx-bbar">
                <i style={{ width: `${Math.round((b.level / max) * 100)}%` }} />
              </i>
            </span>
          )}
        </div>
        {canLevel && !site && !top && (
          <button className="nx-go nx-up" disabled={up.blocked !== null} onClick={() => act((st) => startUpgrade(st, b.id))}>
            Улучшить
            <small>{upEta !== null ? waitSpan(upEta) : 'нет строителей'}</small>
          </button>
        )}
        {/* «Закрыть» — в строке шапки и уезжает вместе с ней: стоя поверх прокрутки, он ложился бы на кнопки. */}
        <button className="nx-bclose" onClick={closeSheet} aria-label="Закрыть">
          <Icon name="ui-close" glyph="✕" />
        </button>
      </div>

      {canLevel && !site && !top && (
        <div className="nx-bcost">
          <Cost cost={up.cost} />
          <small className={up.blocked ? 'nx-why' : 'nx-gain'}>{up.blocked ?? (gains ? gainText(gains) : '')}</small>
        </div>
      )}

      {site && (
        <div className="nx-bsite">
          <Icon name="ui-site" glyph="🏗️" />
          <div className="nx-bsite-body">
            <span>
              Стройка до ур. {b.level + 1} · {inQueue ? 'в очереди' : siteEta !== null ? waitSpan(siteEta) : 'нет строителей'}
            </span>
            <i className="nx-bbar wide">
              <i style={{ width: `${share}%` }} />
            </i>
          </div>
          <Confirm label="Отменить" onConfirm={() => act((st) => cancelUpgrade(st, b.id))} />
        </div>
      )}

      {isOutsideWall(b.type) && <div className="nx-bwarn">Двор за стеной: прорвавшийся набег разгонит людей.</div>}

      <WorkerRow b={b} gains={gains} />
      {data(b)}
    </div>
  );
}

/** Рабочие одной строкой: значок (тап — свободные руки и места), «3/12», шаг. Невольники — второй строкой. */
function WorkerRow({ b, gains }: { b: Building; gains: UpgradeGain[] | null }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const def = BUILDING_BY_ID[b.type];
  if (!def.job) return null;
  const job = JOB_BY_ID[def.job];
  const slots = buildingSlots(b);
  const workers = workerCount(s, b.id);
  const bonded = bondedCount(s, b.id);
  const masters = mastersOn(s, b.id);
  const free = idleCount(s);
  const hands = workers + bonded + masters;
  const bondedRow = takesBonded(b) && (bondedTotal(s) > 0 || bonded > 0);
  const tip = workerTip(job.name, hands, slots, free, gains, spareSlotsHelp(s, b, hands));

  return (
    <>
      <div className="nx-wrow">
        <button className="nx-wico" onClick={(e) => tipAt(e.currentTarget, tip)} aria-label={`${job.name}: места`}>
          <Icon name={`job-${job.id}`} glyph={job.icon} />
        </button>
        <span className="nx-wcount">
          <b>{workers}</b>
          {bonded + masters > 0 && <i>+{bonded + masters}</i>}
          <small>/{slots}</small>
        </span>
        <Steps
          value={workers}
          max={slots - bonded - masters}
          spare={free}
          step={10}
          addTut="slot-add"
          onChange={(d) => act((st) => (d > 0 ? assignWorker(st, b.id, d) : unassignWorker(st, b.id, -d)))}
        />
      </div>
      {bondedRow && (
        <div className="nx-wrow">
          <button
            className="nx-wico"
            onClick={(e) => tipAt(e.currentTarget, { title: 'Невольники', body: `Без места: ${bondedIdle(s)}. Места общие с вольными.` })}
            aria-label="Невольники: места"
          >
            {ORDER_TEXT.bondedIcon}
          </button>
          <span className="nx-wcount">
            <b>{bonded}</b>
            <small>/{slots - workers}</small>
          </span>
          <Steps
            value={bonded}
            max={slots - workers}
            spare={bondedIdle(s)}
            step={10}
            onChange={(d) => act((st) => (d > 0 ? assignBonded(st, b.id, d) : unassignBonded(st, b.id, -d)))}
          />
        </div>
      )}
    </>
  );
}
