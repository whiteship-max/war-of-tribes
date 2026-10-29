// Окно постройки нового интерфейса — общий шаблон для всех построек (docs/ui_audit.md, 3.10 и 6.3).
//
// Шапка — одна строка: значок (тап — описание здания подсказкой), имя, «ур. 3/10» с полоской доли до потолка
// и главное действие справа — «Улучшить» со сроком. Цена улучшения — строкой `Cost` сразу под шапкой, что даст
// уровень — 11 px под ней. Рабочие — одной строкой: значок, «3/12», шаг; сколько свободных рук — подсказкой по
// значку. Дальше — данные и действия своего здания (`data`), те же, что в прежнем окне.
//
// Своих чисел нет: цена, срок, места и что даст уровень — `upgradeInfo`, `buildRate`, `upgradeGains`
// (правило 18). Отмена стройки — двумя касаниями одной кнопки (3.10): первое превращает её в «Точно?». Под стройкой —
// «Ускорить 💎N» (`Rush.tsx`, docs/gems.md) — единственная копия ускорения (Д5, docs/ui_v2.md, 5.7): ярлык у лесов и
// лист ратуши ведут сюда.
import { type ReactNode } from 'react';
import type { Building, JobId } from '@/game/types';
import { useGame } from '@/game/store';
import { MAX_BUILDING_LEVEL, RESOURCE_IDS } from '@/game/constants';
import { dec } from '@/game/num';
import { BUILDING_BY_ID, jobsOf } from '@/game/data/buildings';
import { YARD_BY_JOB } from '@/game/data/yards';
import { JOB_BY_ID } from '@/game/data/jobs';
import { ORDER_TEXT } from '@/game/data/order';
import {
  bondedIdle,
  bondedTotal,
  buildRate,
  buildingById,
  buildingProduction,
  buildingTitle,
  deedBonded,
  deedMasters,
  deedSlots,
  deedTakesBonded,
  deedWorkers,
  queuePlace,
  idleCount,
  isOutsideWall,
  isSite,
  maxLevelFor,
  seasonMods,
  seasonOf,
  upgradeInfo,
} from '@/game/derived';
import { SEASON_META } from '@/game/data/seasons';
import { assignBonded, assignWorker, cancelUpgrade, startUpgrade, unassignBonded, unassignWorker } from '@/game/sim/actions';
import { asGame } from '@/game/pace';
import { Icon } from '@/ui/icons/Icon';
import { Cost } from '@/ui/parts/Cost';
import { Steps } from '@/ui/parts/Steps';
import { waitSpan } from '@/ui/parts/wait';
import { gainText, spareSlotsHelp, upgradeGains, type UpgradeGain } from '@/ui/parts/upgrade';
import { tipAt } from './tip';
import { buildingTip, deedTip, workerTip, workerYield } from './buildingTips';
import { Confirm } from './Confirm';
import { MINIGAMES, MINIGAME_BY_ID, MINIGAME_COST, type MinigameId } from '@/game/data/minigames';
import { Row } from '@/ui/kit/Row';
import { goTo } from '@/ui/kit/nav';
import { WINDOW, sourceWord } from '@/ui/kit/sources';
import { RushButton } from './Rush';
import { HealRows } from './Heal';
import { iconName } from '@/ui/icons/registry';
import { actRoom } from '@/ui/room';

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
  const place = queuePlace(s, b);
  const inQueue = place > 1;
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
          onClick={(e) => tipAt(e.currentTarget, buildingTip(s, b))}
          aria-label={`${buildingTitle(s, b.type)}: что это`}
        >
          <Icon name={iconName('bld', def.id)} />
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
          {/* Двор за стеной — меткой под уровнем; что это значит — в подсказке по значку (`buildingTip`). */}
          {isOutsideWall(b.type) && <small className="nx-bout">за стеной</small>}
        </div>
        {canLevel && !site && !top && (
          <button className="nx-go nx-up" disabled={up.blocked !== null} onClick={() => act((st) => startUpgrade(st, b.id))}>
            Улучшить
            <small>{upEta !== null ? waitSpan(upEta) : 'нет строителей'}</small>
          </button>
        )}
        {/* «Закрыть» — в строке шапки и уезжает вместе с ней: стоя поверх прокрутки, он ложился бы на кнопки. */}
        <button className="nx-bclose" onClick={closeSheet} aria-label="Закрыть">
          <Icon name="ui-close" />
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
          <Icon name="ui-site" />
          <div className="nx-bsite-body">
            <span>
              Стройка до ур. {b.level + 1} · {inQueue ? `ждёт, ${place}-е в очереди` : siteEta !== null ? waitSpan(siteEta) : 'нет строителей'}
            </span>
            <i className="nx-bbar wide">
              <i style={{ width: `${share}%` }} />
            </i>
          </div>
          <Confirm label="Отменить" onConfirm={() => actRoom((st) => cancelUpgrade(st, b.id))} />
        </div>
      )}
      {/* Ускорение за алмазы — от оставшегося времени, последние пять минут даром (docs/gems.md). */}
      {site && (
        <div className="nx-brush">
          <RushButton b={b} />
        </div>
      )}
      {/* Лечение за алмазы (ПН-6, решение В11): раненые лазарета — от оставшегося срока, в осаде тоже. */}
      {b.type === 'infirmary' && <HealRows groups={s.wounded ?? []} />}

      {jobsOf(b.type).length > 1 ? (
        <Deeds b={b} gains={gains} trades />
      ) : (
        <>
          <WorkerRow b={b} gains={gains} />
          {/* Промысел этого двора — строкой-дверью в окно «Промыслы» (Д6, docs/ui_v2.md, 5.7): игра, её добыча и энергия —
              там, одной копией; здесь — что это за игра и куда идти. */}
          {jobsOf(b.type).flatMap((job) => MINIGAMES.filter((g) => g.deed === job)).map((g) => (
            <TradeLink key={g.id} id={g.id} />
          ))}
        </>
      )}
      {data(b)}
    </div>
  );
}

/** Промысел двора — строка-дверь в «Промыслы»: имя игры, её цена в энергии и куда идти. */
function TradeLink({ id }: { id: MinigameId }) {
  const def = MINIGAME_BY_ID[id];
  return (
    <Row
      icon={iconName('mini', id)}
      label={`Промысел: ${def.name}`}
      sub={def.goal}
      value={
        <>
          <Icon name="ui-energy" /> {MINIGAME_COST}
        </>
      }
      go={() => goTo(WINDOW.energy)}
      goLabel={`${def.name}: ${sourceWord(WINDOW.energy)}`}
    />
  );
}

/**
 * Дела двора (ЗД-1): у Фермы — поле и загон, у Охотничьего двора — охота и сбор, у Шахты — руда и камень. Каждое — своя
 * плашка рядом с другой: имя дела, рабочие «3/12» с шагом, выработка в день сейчас и с ещё одним, касанием — разбор; под
 * ней — промыслы этого дела кнопками-дверями в «Промыслы». Уровень и улучшение — общие, в шапке окна. Тот же ряд — в
 * листе постройки ратуши (`HallBuild.HallCard`, без промыслов).
 */
export function Deeds({ b, gains, trades = false }: { b: Building; gains: UpgradeGain[] | null; trades?: boolean }) {
  const s = useGame((g) => g.s);
  // Итог двора за день — `buildingProduction`, сумма дел той же дверью, что кладёт добро на склад (правило 18).
  const all = buildingProduction(s, b);
  const sum = RESOURCE_IDS.filter((r) => all[r] > 0.005);
  return (
    <div className="nx-deeds">
      {jobsOf(b.type).map((job) => (
        <div className="nx-deed" key={job}>
          <WorkerRow b={b} gains={gains} job={job} />
          {trades && <DeedTrades job={job} />}
        </div>
      ))}
      {sum.length > 0 && (
        <p className="nx-dsum">
          Двор за день:
          {sum.map((r) => (
            <span key={r}>
              <Icon name={iconName('res', r)} /> {dec(all[r], 1)}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/** Промыслы дела — кнопками в один ряд: имя игры и цена в энергии; дверь — в «Промыслы». */
function DeedTrades({ job }: { job: JobId }) {
  const games = MINIGAMES.filter((g) => g.deed === job);
  if (games.length === 0) return null;
  return (
    <div className="nx-dtrades">
      {games.map((g) => (
        <button key={g.id} className="nx-dtrade" onClick={() => goTo(WINDOW.energy)} aria-label={`Промысел: ${g.name}: ${sourceWord(WINDOW.energy)}`}>
          <Icon name={iconName('mini', g.id)} />
          <span className="one-line">{g.name}</span>
          <small>
            <Icon name="ui-energy" /> {MINIGAME_COST}
          </small>
        </button>
      ))}
    </div>
  );
}

/**
 * Рабочие дела одной строкой: значок (тап — свободные руки и места), «3/12», шаг. Невольники — второй строкой. У двора с
 * двумя делами подпись ряда — имя дела, у остальных — «Рабочие». Дело не названо — первое дело постройки. Тот же ряд — в
 * листе постройки ратуши (`Hall.HallCard`).
 */
export function WorkerRow({ b, gains, job: deed }: { b: Building; gains: UpgradeGain[] | null; job?: JobId }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const jobs = jobsOf(b.type);
  const id = deed ?? jobs[0];
  if (!id || !jobs.includes(id)) return null;
  const job = JOB_BY_ID[id];
  const many = jobs.length > 1;
  const slots = deedSlots(b);
  const workers = deedWorkers(s, id);
  const bonded = deedBonded(s, id);
  const masters = deedMasters(s, id);
  const free = idleCount(s);
  const hands = workers + bonded + masters;
  const bondedRow = deedTakesBonded(id) && (bondedTotal(s) > 0 || bonded > 0);
  const label = many ? (YARD_BY_JOB.get(id)?.deed ?? job.name) : 'Рабочие';
  const tip = workerTip(many ? `${label}: ${job.name.toLowerCase()}` : job.name, hands, slots, free, gains, spareSlotsHelp(s, b, hands, many ? id : undefined));
  // Что даёт шаг (отзыв тестеров 11.10): выработка в день сейчас и с ещё одним — под рядом.
  const yields = workerYield(s, b, id);
  const why = many ? deedTip(s, b, id) : null;
  // Сезон дела — у двора с двумя делами он у каждого свой (поле зимой не родит, загон почти не проседает): множитель
  // сейчас, с вестями поверх (`derived.seasonMods`), если он не единица.
  const season = many ? (seasonMods(s).jobs[id] ?? 1) : 1;

  return (
    <>
      <div className="nx-wrow">
        <button className="nx-wico" onClick={(e) => tipAt(e.currentTarget, tip)} aria-label={`${label}: места`}>
          <Icon name={iconName('job', job.id)} />
        </button>
        <span className="nx-wcount">
          <small className="nx-wlbl">{label}</small>
          <b>{workers}</b>
          {bonded + masters > 0 && <i>+{bonded + masters}</i>}
          <small>/{slots}</small>
        </span>
        <Steps
          value={workers}
          max={slots - bonded - masters}
          spare={free}
          step={10}
          addTut={many ? `slot-add-${id}` : 'slot-add'}
          names={many ? { less: `${label}: снять`, more: `${label}: поставить` } : undefined}
          onChange={(d) => act((st) => (d > 0 ? assignWorker(st, b.id, d, id) : unassignWorker(st, b.id, -d, id)))}
        />
      </div>
      {yields.length > 0 && (
        <p className="nx-wgain" onClick={why ? (e) => tipAt(e.currentTarget, why) : undefined} role={why ? 'button' : undefined}>
          В день:
          {yields.map((y) => (
            <span key={y.id}>
              <Icon name={iconName('res', y.id)} /> {dec(y.now, 1)}
              {y.more !== null && <b> → {dec(y.more, 1)}</b>}
            </span>
          ))}
          {yields.some((y) => y.more !== null) && <small>с ещё одним</small>}
          {Math.abs(season - 1) > 1e-9 && (
            <em className={season > 1 ? 'up' : 'down'}>
              {SEASON_META[seasonOf(s.time)].name.toLowerCase()} ×{dec(season, 2)}
            </em>
          )}
        </p>
      )}
      {bondedRow &&
        (many ? (
          // У двора с двумя делами — тонким рядом в плашке дела: значок, «3/4» и шаг по одному (ЗД-1: окно без прокрутки).
          <div className="nx-wrow nx-brow">
            <button
              className="nx-wico"
              onClick={(e) => tipAt(e.currentTarget, { title: ORDER_TEXT.bondedName, body: `Без места: ${bondedIdle(s)}. Места общие с вольными.` })}
              aria-label={`${label}: невольники`}
            >
              <Icon name={ORDER_TEXT.bondedIcon} />
            </button>
            <span className="nx-wcount">
              <small className="nx-wlbl">{ORDER_TEXT.bondedName}</small>
              <b>{bonded}</b>
              <small>/{slots - workers}</small>
            </span>
            <span className="nx-bsteps">
              <button disabled={bonded <= 0} onClick={() => act((st) => unassignBonded(st, b.id, 1, id))} aria-label={`${label}: снять невольника`}>
                −
              </button>
              <button
                disabled={bonded >= slots - workers || bondedIdle(s) <= 0}
                onClick={() => act((st) => assignBonded(st, b.id, 1, id))}
                aria-label={`${label}: поставить невольника`}
              >
                +
              </button>
            </span>
          </div>
        ) : (
          <div className="nx-wrow">
            <button
              className="nx-wico"
              onClick={(e) => tipAt(e.currentTarget, { title: ORDER_TEXT.bondedName, body: `Без места: ${bondedIdle(s)}. Места общие с вольными.` })}
              aria-label="Невольники: места"
            >
              <Icon name={ORDER_TEXT.bondedIcon} />
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
              onChange={(d) => act((st) => (d > 0 ? assignBonded(st, b.id, d, id) : unassignBonded(st, b.id, -d, id)))}
            />
          </div>
        ))}
    </>
  );
}
