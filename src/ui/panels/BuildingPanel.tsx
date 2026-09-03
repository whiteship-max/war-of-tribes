import { useState } from 'react';
import type { Building, JobId, Villager } from '@/game/types';
import { useGame } from '@/game/store';
import { MAX_BUILDING_LEVEL, RESOURCE_IDS, RESOURCE_META } from '@/game/constants';
import { BUILDING_BY_ID } from '@/game/data/buildings';
import { EQUIPMENT } from '@/game/data/equipment';
import { FREE_JOBS, JOB_BY_ID } from '@/game/data/jobs';
import { TECH_BY_ID } from '@/game/data/techs';
import {
  armyPower,
  buildRate,
  forgeUnlocked,
  buildingById,
  buildingHousing,
  buildingProduction,
  buildingSlots,
  buildingStat,
  currentSite,
  defense,
  freeVillagers,
  hasKnowledgeHouse,
  hasTech,
  housingCapacity,
  isBuilt,
  isSite,
  jobMultiplier,
  levelOutputMult,
  netPerDay,
  storageCap,
  upgradeInfo,
  villagerMultiplier,
  workersIn,
} from '@/game/derived';
import { assignWorker, cancelBuilding, changeFreeJob, chooseTotem, startUpgrade, unassignWorker } from '@/game/sim/actions';
import { Cost } from '../parts/Cost';
import { ChiefHouse } from '../parts/ChiefHouse';
import { Smithy } from '../parts/Smithy';
import { Market } from '../parts/Market';
import { Barracks } from '../parts/Barracks';
import { TechTree } from '../parts/TechTree';
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
            {/* Потолок типа, а не эпохи: предел эпохи показывают пунктирные точки и подсказка. */}
            {b.level > 0 ? `Уровень ${b.level} из ${def.maxLevel ?? MAX_BUILDING_LEVEL}` : 'Стройплощадка'}
            {canLevel && (
              <span className="pips">
                {Array.from({ length: def.maxLevel ?? MAX_BUILDING_LEVEL }, (_, i) => (
                  <i key={i} className={i < b.level ? 'on' : i < up.maxLevel ? '' : 'era'} />
                ))}
              </span>
            )}
          </div>
        </div>
        {!site && canLevel && b.level > 0 && (
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
              {b.level === 0 ? 'Строится' : `Улучшение до ${b.level + 1} уровня`}
              <span className="count">{inQueue ? 'в очереди' : eta !== null ? `~${eta} с` : 'нет строителей'}</span>
            </div>
            {b.level > 0 && (
              <div className="desc">Здание в лесах, но работает: рабочие на местах, выработка идёт.</div>
            )}
            <div className="progress">
              <div style={{ width: `${Math.floor((b.work / Math.max(1, b.workRequired)) * 100)}%` }} />
            </div>
          </div>
          <button className="btn ghost" onClick={() => act((st) => cancelBuilding(st, b.id))} aria-label="Отменить">
            ✕
          </button>
        </div>
      ) : (
        canLevel &&
        b.level > 0 && (
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

function VillagerLine({ v }: { v: Villager }) {
  const job = JOB_BY_ID[v.job];
  return (
    <>
      <span className="ico">{job.icon}</span>
      <span className="who">
        {v.name}, {Math.floor(v.age)}
        {v.talent === v.job && <b className="talent"> ★ талант</b>}
      </span>
    </>
  );
}

function WorkerSlots({ b }: { b: Building }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const [picking, setPicking] = useState(false);
  const def = BUILDING_BY_ID[b.type];
  if (!def.job) return null;
  const job = JOB_BY_ID[def.job];
  const slots = buildingSlots(b);
  const workers = workersIn(s, b.id);
  const free = freeVillagers(s);
  const locked = job.requiresTech && !hasTech(s, job.requiresTech);
  const empty = Math.max(0, slots - workers.length);

  return (
    <>
      <h3>
        {job.icon} {job.name}
        <span className="muted">
          {workers.length}/{slots || '—'}
        </span>
      </h3>
      {!isBuilt(b) && <div className="note">Места появятся, когда стройка закончится.</div>}
      {locked && <div className="note">Нужно изучить: {TECH_BY_ID[job.requiresTech!].name}.</div>}

      {workers.map((v) => (
        <div className="slot filled" key={v.id}>
          <VillagerLine v={v} />
          <button className="mini" onClick={() => act((st) => unassignWorker(st, b.id, v.id))} aria-label="Снять">
            −
          </button>
        </div>
      ))}
      {Array.from({ length: empty }, (_, i) => (
        <div className="slot" key={`e${i}`}>
          <span className="ico">◻️</span>
          <span className="who">Свободное место</span>
          <button
            className="mini"
            data-tut={i === 0 ? 'slot-add' : undefined}
            disabled={free.length === 0 || !!locked}
            onClick={() => act((st) => assignWorker(st, b.id))}
            aria-label="Поставить"
          >
            +
          </button>
        </div>
      ))}
      {slots > 0 && empty === 0 && b.level > 0 && (
        <div className="note">Все места заняты. Следующий уровень добавит ещё одно.</div>
      )}
      {empty > 0 && free.length > 0 && !locked && (
        <>
          <button className="btn ghost wide" onClick={() => setPicking(!picking)}>
            {picking ? 'Свернуть' : `Выбрать из свободных (${free.length})`}
          </button>
          {picking &&
            free.map((v) => (
              <button
                className="slot pick"
                key={v.id}
                onClick={() => {
                  act((st) => assignWorker(st, b.id, v.id));
                  setPicking(false);
                }}
              >
                <span className="ico">{v.talent === def.job ? '⭐' : '🙂'}</span>
                <span className="who">
                  {v.name}, {Math.floor(v.age)}
                  {v.talent && <i className="talent"> ★{JOB_BY_ID[v.talent].name.toLowerCase()}</i>}
                </span>
                <span className="mini">+</span>
              </button>
            ))}
        </>
      )}
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
    case 'knowledge':
      return isBuilt(b) ? <TechTree /> : <div className="note">Пока хранилище строится, исследуют у костра.</div>;
    case 'chief_house':
      return isBuilt(b) ? (
        <ChiefHouse />
      ) : (
        <div className="note">Пока дом строится, править нечем: указы и рацион появятся с ним.</div>
      );
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
          <Barracks b={b} />
        </>
      );
    case 'market':
      return (
        <>
          <GenericData b={b} />
          <Market b={b} />
        </>
      );
    default:
      return <GenericData b={b} />;
  }
}

/** Костёр — сердце племени: отсюда раздают вольный сбор и, пока нет хранилища, исследуют. */
function CampfireData() {
  const s = useGame((g) => g.s);
  const idle = freeVillagers(s).length;
  const site = currentSite(s);

  return (
    <>
      <h3>
        У костра <span className="muted">свободных: {idle}</span>
      </h3>
      <div className="note">
        {site
          ? `Свободные жители строят: ${BUILDING_BY_ID[site.type].name} (${Math.floor((site.work / Math.max(1, site.workRequired)) * 100)}%).`
          : 'Свободные жители отдыхают. Начни стройку, чтобы занять их.'}
      </div>

      <h3>Вольный сбор</h3>
      <div className="note">Работа без профильного здания идёт вполсилы. Построй здание — те же руки дадут вдвое больше.</div>
      {FREE_JOBS.map((jobId) => (
        <FreeJobRow key={jobId} job={jobId} />
      ))}

      {!hasKnowledgeHouse(s) && <TechTree />}

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
  const workers = s.villagers.filter((v) => v.job === job && v.workplace === null);
  const idle = freeVillagers(s).length;
  const locked = def.requiresTech && !hasTech(s, def.requiresTech);
  const mult = jobMultiplier(s, job) * 0.5;
  const yields = RESOURCE_IDS.filter((r) => def.yield[r]).map(
    (r) => `${RESOURCE_META[r].icon}${((def.yield[r] ?? 0) * mult).toFixed(1)}`,
  );

  return (
    <div className={`card ${locked ? 'locked' : ''}`}>
      <div className="ico">{def.icon}</div>
      <div className="body">
        <div className="title">{def.name}</div>
        <div className="desc">{yields.length ? `${yields.join(' ')} в день на человека` : def.description}</div>
      </div>
      <div className="stepper">
        <button disabled={workers.length === 0} onClick={() => act((st) => changeFreeJob(st, job, -1))}>
          −
        </button>
        <span className="n">{workers.length}</span>
        <button disabled={idle === 0 || !!locked} onClick={() => act((st) => changeFreeJob(st, job, 1))}>
          +
        </button>
      </div>
    </div>
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
          <span className="delta">{forgeUnlocked(s, e.id) ? '' : 'не изучено'}</span>
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
  const workers = workersIn(s, b.id);
  const jobDef = def.job ? JOB_BY_ID[def.job] : null;

  const stats: [string, string, string][] = [];
  const housing = buildingHousing(s, b);
  if (housing) stats.push(['🛏️', 'Жилых мест', `${housing}`]);
  const storage = buildingStat(b, 'storage');
  if (storage) stats.push(['🧺', 'К вместимости склада', `+${storage}`]);
  const def_ = buildingStat(b, 'defense');
  if (def_) stats.push(['🛡️', 'К защите поселения', `+${def_}`]);
  const morale = buildingStat(b, 'morale');
  if (morale) stats.push(['😊', 'К морали', `+${morale}`]);
  if (b.type === 'workshop' && isBuilt(b)) stats.push(['💡', 'К скорости исследований', '+0.3/с']);
  if (b.type === 'smithy' && isBuilt(b)) stats.push(['⚔️', 'Мощь армии сейчас', armyPower(s).toFixed(0)]);
  if (housing) stats.push(['👥', 'Всего мест в посёлке', `${housingCapacity(s)} на ${s.villagers.length} чел.`]);
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
              {workers.length === 0
                ? 'Здание стоит без рабочих — поставь кого-нибудь на место.'
                : 'Это здание не даёт ресурсов напрямую.'}
            </div>
          )}
          {workers.map((v) => (
            <div className="mod" key={v.id}>
              <span className="ico">{jobDef.icon}</span>
              <span className="name">{v.name}</span>
              <span className="val">×{villagerMultiplier(s, v).toFixed(2)}</span>
            </div>
          ))}
          {isBuilt(b) && (
            <div className="note">
              Уровень {b.level}: каждый рабочий работает на ×{levelOutputMult(b.level).toFixed(2)} от базы.
            </div>
          )}
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

      {b.type === 'totem' && isBuilt(b) && !s.totem && (
        <>
          <h3>Выбери символ племени</h3>
          <div className="totem-row">
            {[
              { id: 'wolf' as const, icon: '🐺', name: 'Волк', bonus: 'Охота +15%' },
              { id: 'bear' as const, icon: '🐻', name: 'Медведь', bonus: 'Защита +2' },
              { id: 'eagle' as const, icon: '🦅', name: 'Орёл', bonus: 'Фермы +10%' },
            ].map((t) => (
              <button key={t.id} onClick={() => act((st) => chooseTotem(st, t.id))}>
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
