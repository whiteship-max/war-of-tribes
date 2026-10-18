import type { Building, JobId } from '@/game/types';
import { useGame } from '@/game/store';
import { FREE_RANGE_MULT, RESOURCE_IDS, RESOURCE_META } from '@/game/constants';
import { EQUIPMENT } from '@/game/data/equipment';
import { FREE_JOBS, JOB_BY_ID } from '@/game/data/jobs';
import {
  buildingTitle,
  currentSite,
  freeJobCount,
  idleCount,
  jobMultiplier,
  netPerDay,
  storageCap,
} from '@/game/derived';
import { changeFreeJob } from '@/game/sim/actions';
import { Steps } from '../parts/Steps';
import { TownHall } from '../parts/TownHall';
import { Market } from '../parts/Market';
import { Barracks } from '../parts/Barracks';
import { Recruit } from '../parts/Recruit';
import { Tavern } from '../parts/Tavern';
import { Statue } from '../parts/Statue';
import { Watch } from '../parts/Watch';
import { AgentPlaces } from '../parts/AgentPlaces';
import { Temple } from '../parts/Temple';
import { Walls } from '../parts/Walls';
import { TowerEngine } from '../parts/TowerEngine';
import { Masters } from '../parts/Masters';
import { FoodLeft, WinterForecast } from '../parts/Provisions';
import { Icon } from '@/ui/icons/Icon';
import { moodOf } from '@/ui/icons/registry';
import { dec } from '@/game/num';
import { Table, type Col } from '@/ui/kit/Table';
import { Row } from '@/ui/kit/Row';
import { useChambers } from '@/ui/chambers/open';
import { goTo, tipGo } from '@/ui/kit/nav';
import { WINDOW, sourceWord } from '@/ui/kit/sources';
import { BuildingNew } from '@/ui/next/BuildingNew';
import { SmithyNew } from '@/ui/next/SmithyNew';
import { OutputTable } from '@/ui/next/HallBuild';
import { buildingGives } from '@/ui/next/gives';
import { moraleTip } from '@/ui/next/hudTips';
import { yardOutput } from '@/ui/next/output';

const fmt = (n: number): string => (Math.abs(n) >= 100 ? String(Math.round(n)) : dec(n, 1));
const fmtDelta = (n: number): string => `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n))}`;

/**
 * Одинаковая для всех зданий панель: шапка, цена и рабочие — шаблон нового интерфейса (`next/BuildingNew`), данные
 * здания — свои (`BuildingData`). Прежний шаблон удалён вместе с прежним интерфейсом (docs/ui_audit.md, 16). С UI-8 окно
 * едет в куске нового вида (`ui/next/index.ts`, `App` берёт его через `lazy`): «Что даёт городу», выход и разборы стоят
 * на наборе `kit` (docs/ui_v2.md, 5.7).
 */
export function BuildingPanel({ id }: { id: number }) {
  return <BuildingNew id={id} data={(b) => <BuildingData b={b} />} />;
}

// ---------- Данные конкретного здания ----------

function BuildingData({ b }: { b: Building }) {
  switch (b.type) {
    case 'campfire':
      return <CampfireData />;
    case 'storage':
      return <StorageData />;
    case 'town_hall':
      return <TownHall b={b} />;
    case 'workshop':
      return (
        <>
          <GenericData b={b} />
          <Masters />
        </>
      );
    case 'smithy':
      return (
        <>
          <GenericData b={b} />
          <SmithyNew b={b} />
        </>
      );
    case 'barracks':
      return (
        <>
          <GenericData b={b} />
          <Barracks />
        </>
      );
    case 'stable':
      return (
        <>
          <GenericData b={b} />
          <Recruit at="stable" />
        </>
      );
    case 'market':
      return (
        <>
          <GenericData b={b} />
          <Market />
        </>
      );
    case 'tavern':
      return (
        <>
          <GenericData b={b} />
          <Tavern />
        </>
      );
    case 'palisade':
      return (
        <>
          <GenericData b={b} />
          <Walls b={b} />
        </>
      );
    case 'tower':
      return (
        <>
          <GenericData b={b} />
          <Walls b={b} />
          <TowerEngine />
        </>
      );
    case 'statue':
      // Полководец на месте — его карточка в `Statue` целиком; строка места — только пока места нет, оно пустует или идёт
      // найм (Д7: прежде на одном экране стояли и карточка, и строка «Люди» с тем же человеком).
      return (
        <>
          <GenericData b={b} />
          <Statue />
          <AgentPlaces ids={['general']} vacantOnly />
        </>
      );
    case 'watch':
      return (
        <>
          <GenericData b={b} />
          <AgentPlaces ids={['scout', 'spy']} />
          <Watch />
        </>
      );
    case 'church':
      return (
        <>
          <GenericData b={b} />
          <Temple />
          <AgentPlaces ids={['diplomat']} />
        </>
      );
    case 'cache':
      // Тайник — подвал донжона; над ним, на верхнем ярусе, — покои правителя (docs/city_v3.md, Г-4).
      return (
        <>
          <Row
            icon={{ name: 'ui-crown', glyph: '👑' }}
            label="Покои правителя"
            sub="Верхний ярус донжона: стол, письма, вид на город"
            go={() => useChambers.getState().show()}
            goLabel="Подняться в покои"
          />
          <GenericData b={b} />
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
        На площади <span className="muted">свободных рук: {idle}</span>
      </h3>
      <div className="note">
        {site
          ? `Свободные руки на стройке: ${buildingTitle(s, site.type)}, ${Math.floor((site.work / Math.max(1, site.workRequired)) * 100)}%.`
          : 'Свободные руки отдыхают. Начни стройку.'}
      </div>

      <h3>Вольный сбор</h3>
      <div className="note">Без своего двора человек даёт {Math.round(FREE_RANGE_MULT * 100)}% выработки.</div>
      {FREE_JOBS.map((jobId) => (
        <FreeJobRow key={jobId} job={jobId} />
      ))}

      {/* Мораль — разбором цели и дверью в «Мораль» (одна копия разбора — там); слава — словами. */}
      <h3>Мораль и слава</h3>
      <Table
        label="Мораль и слава"
        cols={GIVE_COLS}
        rows={[
          {
            key: 'morale',
            cells: {
              what: (
                <span className="kit-name">
                  <Icon name={moodOf(s.morale).name} glyph={moodOf(s.morale).glyph} />
                  <span className="one-line">Мораль</span>
                </span>
              ),
              n: String(Math.round(s.morale)),
            },
            tip: () => moraleTip(s, tipGo()),
            go: () => goTo(WINDOW.morale),
            goLabel: `Мораль: ${sourceWord(WINDOW.morale)}`,
          },
          {
            key: 'prestige',
            cells: {
              what: (
                <span className="kit-name">
                  <span className="ic">🏅</span>
                  <span className="one-line">Слава</span>
                </span>
              ),
              n: String(Math.round(s.prestige)),
            },
            tip: () => ({ title: 'Слава', body: 'Её приносят задания, походы и вести, поражения отнимают. К цели морали — до +10.' }),
          },
        ]}
      />
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
    (r) => `${RESOURCE_META[r].icon}${dec((def.yield[r] ?? 0) * mult, 1)}`,
  );

  return (
    <>
      <div className="card">
        <div className="ico">
          <Icon name={`job-${def.id}`} glyph={def.icon} />
        </div>
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
            <span className="ico">
              <Icon name={`res-${r}`} glyph={RESOURCE_META[r].icon} />
            </span>
            <span className="name">{RESOURCE_META[r].name}</span>
            <span className={`val${full ? ' full' : ''}`}>{Math.floor(v)}</span>
            <span className={`delta ${net[r] > 0.05 ? 'pos' : net[r] < -0.05 ? 'neg' : ''}`}>
              {full ? 'полно' : `${fmtDelta(net[r])} в день`}
            </span>
            <span className="bar">
              <i style={{ width: `${pct}%` }} className={full ? 'full' : ''} />
            </span>
          </div>
        );
      })}

      <FoodLeft />
      <WinterForecast />

      <h3>Снаряжение</h3>
      <div className="note">Места на складе не занимает, набег его не уносит.</div>
      {EQUIPMENT.map((e) => (
        <div className="res-line" key={e.id}>
          <span className="ico">
            <Icon name={`gear-${e.id}`} glyph={e.icon} />
          </span>
          <span className="name">{e.name}</span>
          <span className="val">{s.equipment[e.id] ?? 0}</span>
        </div>
      ))}
    </>
  );
}

/**
 * Обычное здание: выход за день с разбором (двор) и что оно даёт городу — таблицами (UI-8, docs/ui_v2.md, 5.7). Выход —
 * тот же разбор, что в листе ратуши (`HallBuild.OutputTable`, `output.ts`): строки складываются в итог. «Что даёт городу» —
 * вклад постройки строкой с разбором всего числа города в подсказке и дверью «›» к его окну (`next/gives.ts`); итог
 * города вторым числом рядом не стоит (Д8). Число рабочих — в ряду рабочих выше, множитель уровня — в подсказке.
 */
function GenericData({ b }: { b: Building }) {
  const s = useGame((g) => g.s);
  const out = yardOutput(s, b);
  const gives = buildingGives(s, b, tipGo());
  return (
    <>
      {out && (
        <>
          <h3>Выработка</h3>
          <OutputTable out={out} />
        </>
      )}
      {gives.length > 0 && (
        <>
          <h3>Что даёт городу</h3>
          <Table
            label="Что даёт городу"
            cols={GIVE_COLS}
            rows={gives.map((r) => ({
              key: r.key,
              cells: {
                what: (
                  <span className="kit-name">
                    <Icon name={r.icon.name} glyph={r.icon.glyph} />
                    <span className="one-line">{r.label}</span>
                  </span>
                ),
                n: r.value,
              },
              tip: r.tip,
              // Дверь — в окно числа, но не в ту же постройку, что открыта.
              go: r.to && !(r.to.kind === 'building' && r.to.type === b.type) ? () => goTo(r.to!) : undefined,
              goLabel: r.to ? `${r.label}: ${sourceWord(r.to)}` : undefined,
            }))}
          />
        </>
      )}
    </>
  );
}

const GIVE_COLS: readonly Col[] = [
  { key: 'what', title: 'Что даёт' },
  { key: 'n', title: 'Сколько', align: 'right', w: '128px' },
];
