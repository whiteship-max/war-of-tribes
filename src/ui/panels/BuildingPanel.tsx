import type { Building, JobId } from '@/game/types';
import { useGame } from '@/game/store';
import { FREE_RANGE_MULT, MAX_BUILDING_LEVEL, RESOURCE_IDS, RESOURCE_META, SLOTS_PER_LEVEL } from '@/game/constants';
import { BUILDING_BY_ID } from '@/game/data/buildings';
import { EQUIPMENT } from '@/game/data/equipment';
import { FREE_JOBS, JOB_BY_ID } from '@/game/data/jobs';
import {
  armyPower,
  buildRate,
  buildingById,
  buildingHousing,
  buildingProduction,
  buildingSlots,
  buildingStat,
  currentSite,
  defense,
  crafterBuildRate,
  freeJobCount,
  housingCapacity,
  idleCount,
  isSite,
  jobMultiplier,
  levelOutputMult,
  netPerDay,
  storageCap,
  upgradeInfo,
  workerCount,
  workerMultiplier,
} from '@/game/derived';
import { assignWorker, cancelUpgrade, changeFreeJob, choosePatron, startUpgrade, unassignWorker } from '@/game/sim/actions';
import { Cost } from '../parts/Cost';
import { ChiefHouse } from '../parts/ChiefHouse';
import { Smithy } from '../parts/Smithy';
import { Market } from '../parts/Market';
import { Barracks } from '../parts/Barracks';
import { upgradeGain } from '../parts/upgrade';

const fmt = (n: number): string => (Math.abs(n) >= 100 ? String(Math.round(n)) : n.toFixed(1));
const fmtDelta = (n: number): string => `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n))}`;

/** Одинаковая для всех зданий панель: шапка, слоты рабочих, свои данные, свои действия. */
export function BuildingPanel({ id }: { id: number }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const b = buildingById(s, id);
  if (!b) {
    return (
      <div className="panel">
        <h2>Здания больше нет</h2>
        <div className="desc">Постройка исчезла — загляни в список посёлка.</div>
      </div>
    );
  }
  const def = BUILDING_BY_ID[b.type];
  const up = upgradeInfo(s, b);
  const site = isSite(b);
  const rate = buildRate(s);
  const first = currentSite(s);
  const inQueue = site && first !== null && first.id !== b.id;
  const eta = rate > 0 ? Math.ceil((b.workRequired - b.work) / rate) : null;
  const canLevel = (def.maxLevel ?? MAX_BUILDING_LEVEL) > 1;
  const upEta = rate > 0 ? Math.ceil(up.work / rate) : null;

  return (
    <div className="panel">
      <div className="bhead">
        <div className="ico">{def.icon}</div>
        <div className="body">
          <div className="name">{def.name}</div>
          <div className="lvl">
            {`Уровень ${b.level} из ${def.maxLevel ?? MAX_BUILDING_LEVEL}`}
            {canLevel && (
              <span className="pips">
                {Array.from({ length: def.maxLevel ?? MAX_BUILDING_LEVEL }, (_, i) => (
                  <i key={i} className={i < b.level ? 'on' : ''} />
                ))}
              </span>
            )}
          </div>
        </div>
        {!site && canLevel && (
          <button className="btn" disabled={up.blocked !== null} onClick={() => act((st) => startUpgrade(st, b.id))}>
            До {up.level} ур.
          </button>
        )}
      </div>

      <div className="desc">{def.description}</div>

      {site ? (
        <div className="card">
          <div className="ico">🏗️</div>
          <div className="body">
            <div className="title">
              Улучшение до {b.level + 1} уровня
              <span className="count">{inQueue ? 'в очереди' : eta !== null ? `~${eta} с` : 'нет строителей'}</span>
            </div>
            <div className="desc">Здание в лесах, но работает: рабочие на местах, выработка идёт.</div>
            <div className="progress">
              <div style={{ width: `${Math.floor((b.work / Math.max(1, b.workRequired)) * 100)}%` }} />
            </div>
          </div>
          <button className="btn ghost" onClick={() => act((st) => cancelUpgrade(st, b.id))} aria-label="Отменить">
            ✕
          </button>
        </div>
      ) : (
        canLevel && (
          <div className="upgrade">
            <Cost cost={up.cost} work={up.work} eta={upEta} />
            <div className="hint">{up.blocked ?? upgradeGain(s, b, up.level)}</div>
          </div>
        )
      )}

      <WorkerSlots b={b} />
      <BuildingData b={b} />
    </div>
  );
}

// ---------- Слоты рабочих ----------

/**
 * Ряд шага: −10 −1 [число] +1 +10. Поимённых жителей нет, люди одинаковы, поэтому
 * назначение — это число, а не список карточек: на потолке уровней в поле стоит
 * сотня человек, и сотню строк по одной на голову никто читать не станет.
 */
function Steps({
  value,
  max,
  spare,
  step,
  addTut,
  onChange,
}: {
  value: number;
  max: number;
  spare: number;
  step: number;
  addTut?: string;
  onChange: (delta: number) => void;
}) {
  const room = Math.max(0, max - value);
  const canAdd = room > 0 && spare > 0;
  return (
    <div className="stepper wide-steps">
      <button disabled={value <= 0} onClick={() => onChange(-step)} aria-label={`Снять ${step}`}>
        −{step}
      </button>
      <button disabled={value <= 0} onClick={() => onChange(-1)} aria-label="Снять">
        −
      </button>
      <span className="n">{value}</span>
      <button data-tut={addTut} disabled={!canAdd} onClick={() => onChange(1)} aria-label="Поставить">
        +
      </button>
      <button disabled={!canAdd} onClick={() => onChange(step)} aria-label={`Поставить ${step}`}>
        +{step}
      </button>
    </div>
  );
}

/**
 * Рабочие здания. Мест столько, сколько даёт уровень; кого именно поставить —
 * вопроса нет: личного навыка у жителя не осталось, его роль взял на себя сам
 * уровень постройки, поднимая выработку каждому рабочему.
 */
function WorkerSlots({ b }: { b: Building }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const def = BUILDING_BY_ID[b.type];
  if (!def.job) return null;
  const job = JOB_BY_ID[def.job];
  const slots = buildingSlots(b);
  const workers = workerCount(s, b.id);
  const free = idleCount(s);

  return (
    <>
      <h3>
        {job.icon} {job.name}
        <span className="muted">
          {workers}/{slots || '—'}
        </span>
      </h3>
      <div className="card">
        <div className="ico">{job.icon}</div>
        <div className="body">
          <div className="title">
            Рабочих в здании
            <span className="count">свободных: {free}</span>
          </div>
          <div className="desc">
            {slots > workers
              ? `Свободных мест: ${slots - workers}. Следующий уровень добавит ещё ${def.slotsPerLevel ?? SLOTS_PER_LEVEL}.`
              : 'Все места заняты — нужен уровень выше.'}
          </div>
        </div>
      </div>
      <Steps
        value={workers}
        max={slots}
        spare={free}
        step={10}
        addTut="slot-add"
        onChange={(d) =>
          act((st) => (d > 0 ? assignWorker(st, b.id, d) : unassignWorker(st, b.id, -d)))
        }
      />
    </>
  );
}

// ---------- Данные конкретного здания ----------

function BuildingData({ b }: { b: Building }) {
  switch (b.type) {
    case 'campfire':
      return <CampfireData />;
    case 'storage':
      return <StorageData />;
    case 'chief_house':
      return <ChiefHouse />;
    case 'smithy':
      return (
        <>
          <GenericData b={b} />
          <Smithy b={b} />
        </>
      );
    case 'barracks':
      return (
        <>
          <GenericData b={b} />
          <Barracks />
        </>
      );
    case 'market':
      return (
        <>
          <GenericData b={b} />
          <Market />
        </>
      );
    default:
      return <GenericData b={b} />;
  }
}

/** Костёр — сердце племени: отсюда раздают вольный сбор и здесь видно настроение. */
function CampfireData() {
  const s = useGame((g) => g.s);
  const idle = idleCount(s);
  const site = currentSite(s);

  return (
    <>
      <h3>
        У костра <span className="muted">свободных: {idle}</span>
      </h3>
      <div className="note">
        {site
          ? `Свободные жители строят: ${BUILDING_BY_ID[site.type].name} (${Math.floor((site.work / Math.max(1, site.workRequired)) * 100)}%).`
          : 'Свободные жители отдыхают. Начни улучшение, чтобы занять их.'}
      </div>

      <h3>Вольный сбор</h3>
      <div className="note">Работа без места в здании идёт вполсилы. Поставь человека в его двор — те же руки дадут вдвое больше.</div>
      {FREE_JOBS.map((jobId) => (
        <FreeJobRow key={jobId} job={jobId} />
      ))}

      <h3>Настроение</h3>
      <div className="mod">
        <span className="ico">{s.morale >= 70 ? '😊' : s.morale >= 40 ? '😐' : '😟'}</span>
        <span className="name">Мораль племени</span>
        <span className="val">{Math.round(s.morale)}</span>
      </div>
      <div className="mod">
        <span className="ico">🏅</span>
        <span className="name">Престиж</span>
        <span className="val">{Math.round(s.prestige)}</span>
      </div>
    </>
  );
}

function FreeJobRow({ job }: { job: JobId }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const def = JOB_BY_ID[job];
  const workers = freeJobCount(s, job);
  const idle = idleCount(s);
  const mult = jobMultiplier(s, job) * FREE_RANGE_MULT;
  const yields = RESOURCE_IDS.filter((r) => def.yield[r]).map(
    (r) => `${RESOURCE_META[r].icon}${((def.yield[r] ?? 0) * mult).toFixed(1)}`,
  );

  return (
    <>
      <div className="card">
        <div className="ico">{def.icon}</div>
        <div className="body">
          <div className="title">
            {def.name}
            <span className="count">{workers}</span>
          </div>
          <div className="desc">{yields.length ? `${yields.join(' ')} в день на человека` : def.description}</div>
        </div>
      </div>
      <Steps
        value={workers}
        max={workers + idle}
        spare={idle}
        step={10}
        onChange={(d) => act((st) => changeFreeJob(st, job, d))}
      />
    </>
  );
}

/** Склад — единственное место, где виден полный список ресурсов. */
function StorageData() {
  const s = useGame((g) => g.s);
  const cap = storageCap(s);
  const net = netPerDay(s);

  return (
    <>
      <h3>
        Запасы <span className="muted">вместимость {cap}</span>
      </h3>
      {RESOURCE_IDS.map((r) => {
        const v = s.resources[r];
        const pct = Math.min(100, (v / cap) * 100);
        const full = v >= cap - 0.5;
        return (
          <div className="res-line" key={r}>
            <span className="ico">{RESOURCE_META[r].icon}</span>
            <span className="name">{RESOURCE_META[r].name}</span>
            <span className={`val${full ? ' full' : ''}`}>{Math.floor(v)}</span>
            <span className={`delta ${net[r] > 0.05 ? 'pos' : net[r] < -0.05 ? 'neg' : ''}`}>
              {full ? 'полно' : `${fmtDelta(net[r])}/д`}
            </span>
            <span className="bar">
              <i style={{ width: `${pct}%` }} className={full ? 'full' : ''} />
            </span>
          </div>
        );
      })}

      <h3>
        Снаряжение <span className="muted">вместимость не расходует</span>
      </h3>
      <div className="note">
        Снаряжение куют в кузнице, тратят в казармах. Склад его не ограничивает и чужой набег
        его не уносит.
      </div>
      {EQUIPMENT.map((e) => (
        <div className="res-line" key={e.id}>
          <span className="ico">{e.icon}</span>
          <span className="name">{e.name}</span>
          <span className="val">{s.equipment[e.id] ?? 0}</span>
        </div>
      ))}
    </>
  );
}

/** Обычное здание: что оно производит и что даёт посёлку. */
function GenericData({ b }: { b: Building }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const def = BUILDING_BY_ID[b.type];
  const prod = buildingProduction(s, b);
  const produced = RESOURCE_IDS.filter((r) => prod[r] > 0.01);
  const workers = workerCount(s, b.id);
  const jobDef = def.job ? JOB_BY_ID[def.job] : null;

  const stats: [string, string, string][] = [];
  const housing = buildingHousing(b);
  if (housing) stats.push(['🛏️', 'Жилых мест', `${housing}`]);
  const storage = buildingStat(b, 'storage');
  if (storage) stats.push(['🧺', 'К вместимости склада', `+${storage}`]);
  const def_ = buildingStat(b, 'defense');
  if (def_) stats.push(['🛡️', 'К защите поселения', `+${def_}`]);
  const morale = buildingStat(b, 'morale');
  if (morale) stats.push(['😊', 'К морали', `+${morale}`]);
  if (b.type === 'workshop') stats.push(['🔨', 'К скорости улучшений', `+${crafterBuildRate(s).toFixed(1)}/с`]);
  if (b.type === 'smithy') stats.push(['⚔️', 'Мощь армии сейчас', armyPower(s).toFixed(0)]);
  if (housing) stats.push(['👥', 'Всего мест в посёлке', `${housingCapacity(s)} на ${s.pop} чел.`]);
  if (def_) stats.push(['⚔️', 'Защита посёлка', defense(s).toFixed(0)]);

  return (
    <>
      {jobDef && (
        <>
          <h3>Выработка</h3>
          {produced.length > 0 ? (
            <div className="mod total">
              <span className="ico">📦</span>
              <span className="name">Всего за день</span>
              <span className="val pos">
                {produced.map((r) => `${RESOURCE_META[r].icon}${fmt(prod[r])}`).join('  ')}
              </span>
            </div>
          ) : (
            <div className="note">
              {workers === 0
                ? 'Здание стоит без рабочих — поставь кого-нибудь на место.'
                : 'Это здание не даёт ресурсов напрямую.'}
            </div>
          )}
          {workers > 0 && (
            <div className="mod">
              <span className="ico">{jobDef.icon}</span>
              <span className="name">Рабочих: {workers}</span>
              <span className="val">×{workerMultiplier(s, jobDef.id, b).toFixed(2)} каждый</span>
            </div>
          )}
          <div className="note">
            Уровень {b.level}: каждый рабочий работает на ×{levelOutputMult(b.level).toFixed(2)} от базы.
          </div>
        </>
      )}

      {stats.length > 0 && (
        <>
          <h3>Что даёт посёлку</h3>
          {stats.map(([icon, name, val], i) => (
            <div className="mod" key={i}>
              <span className="ico">{icon}</span>
              <span className="name">{name}</span>
              <span className="val">{val}</span>
            </div>
          ))}
        </>
      )}

      {b.type === 'church' && !s.patron && (
        <>
          <h3>Выбери покровителя племени</h3>
          <div className="note">Выбирают один раз и навсегда: сменить покровителя нельзя ни за какие деньги.</div>
          <div className="totem-row">
            {[
              { id: 'wolf' as const, icon: '🐺', name: 'Волк', bonus: 'Охота +15%' },
              { id: 'bear' as const, icon: '🐻', name: 'Медведь', bonus: 'Защита +2' },
              { id: 'eagle' as const, icon: '🦅', name: 'Орёл', bonus: 'Фермы +10%' },
            ].map((t) => (
              <button key={t.id} onClick={() => act((st) => choosePatron(st, t.id))}>
                <span className="ico">{t.icon}</span>
                <b>{t.name}</b>
                <span style={{ color: 'var(--muted)' }}>{t.bonus}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
