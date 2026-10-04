import type { Building, JobId } from '@/game/types';
import { useGame } from '@/game/store';
import { FREE_RANGE_MULT, RESOURCE_IDS, RESOURCE_META } from '@/game/constants';
import { BUILDING_BY_ID } from '@/game/data/buildings';
import { EQUIPMENT } from '@/game/data/equipment';
import { FREE_JOBS, JOB_BY_ID } from '@/game/data/jobs';
import {
  armyPower,
  buildingHousing,
  buildingProduction,
  buildingStat,
  buildingTitle,
  cavalryTrain,
  handsCount,
  healShare,
  bedsTaken,
  infirmaryBeds,
  woundedStacks,
  intelKeen,
  currentSite,
  defense,
  crafterBuildShare,
  freeJobCount,
  housingCapacity,
  idleCount,
  jobMultiplier,
  maxLevelFor,
  stalls,
  stallsTaken,
  netPerDay,
  stashAt,
  storageCap,
  surveyRadius,
  warningSeconds,
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
import { waitMinSec } from '../parts/wait';
import { count } from '../parts/plural';
import { troopBlock, troopOpen } from '@/game/sim/tech';
import { Icon } from '@/ui/icons/Icon';
import { moodOf } from '@/ui/icons/registry';
import { troopTotal } from '@/game/battle/kinds';
import { asGame } from '@/game/pace';
import { lazy, Suspense } from 'react';

/** Шаблон окна нового интерфейса и заказ кузницы — в куске нового вида (`ui/next/index.ts`). */
const BuildingNew = lazy(() => import('@/ui/next').then((m) => ({ default: m.BuildingNew })));
const SmithyNew = lazy(() => import('@/ui/next').then((m) => ({ default: m.SmithyNew })));

const fmt = (n: number): string => (Math.abs(n) >= 100 ? String(Math.round(n)) : n.toFixed(1));
const fmtDelta = (n: number): string => `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n))}`;

/**
 * Одинаковая для всех зданий панель: шапка, цена и рабочие — шаблон нового интерфейса (`next/BuildingNew`), данные
 * здания — свои (`BuildingData`). Прежний шаблон удалён вместе с прежним интерфейсом (docs/ui_audit.md, 16).
 */
export function BuildingPanel({ id }: { id: number }) {
  return (
    <Suspense fallback={null}>
      <BuildingNew id={id} data={(b) => <BuildingData b={b} />} />
    </Suspense>
  );
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
          <Suspense fallback={null}>
            <SmithyNew b={b} />
          </Suspense>
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
      return (
        <>
          <GenericData b={b} />
          <Statue />
          <AgentPlaces ids={['general']} />
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
        У костра <span className="muted">свободных рук: {idle}</span>
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

      <h3>Мораль и слава</h3>
      <div className="mod">
        <span className="ico">
          <Icon name={moodOf(s.morale).name} glyph={moodOf(s.morale).glyph} />
        </span>
        <span className="name">Мораль</span>
        <span className="val">{Math.round(s.morale)}</span>
      </div>
      <div className="mod">
        <span className="ico">🏅</span>
        <span className="name">Слава</span>
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

/** Частокол и башня: итог обороны у них показывает раздел «Оборона», а не список ниже. */
const WALLS: Building['type'][] = ['palisade', 'tower'];

/** Обычное здание: что оно производит и что даёт городу. */
function GenericData({ b }: { b: Building }) {
  const s = useGame((g) => g.s);
  // Число рабочих стоит в строке рабочих, множитель уровня — в подсказке; здесь — только выработка и что здание
  // даёт городу (docs/ui_audit.md, 6.3: число не повторяется трижды).
  const def = BUILDING_BY_ID[b.type];
  const prod = buildingProduction(s, b);
  const produced = RESOURCE_IDS.filter((r) => prod[r] > 0.01);
  const jobDef = def.job ? JOB_BY_ID[def.job] : null;

  // Строка «что даёт городу»: имя значка, эмодзи на его месте, название, величина.
  // Имя стоит рядом с эмодзи, а не вместо: пока значка нет, показывается эмодзи.
  const stats: [string, string, string, string][] = [];
  const housing = buildingHousing(b);
  if (housing) stats.push(['bld-houses', '🛏️', 'Жилых мест', `${housing}`]);
  const storage = buildingStat(b, 'storage');
  if (storage) stats.push(['bld-storage', '🧺', 'К вместимости склада', `+${storage}`]);
  const def_ = buildingStat(b, 'defense');
  if (def_) stats.push(['gear-shield', '🛡️', 'К обороне города', `+${def_}`]);
  const morale = buildingStat(b, 'morale');
  if (morale) stats.push(['mood-good', '😊', 'К морали', `+${morale}`]);
  // Службы посёлка: у каждой одно число, и лучше показать его словами игрока,
  // а не названием поля. Числа берутся из тех же функций, что и логика.
  // Стрелки башни и итог обороны у частокола и башни — в разделе «Оборона»
  // (`parts/Walls`): там они стоят рядом с ополчением и дверью к донесению о набеге.
  if (b.type === 'infirmary') {
    // Числа — из тех же чтений, что кладут раненых (`sim/infirmary`): доля, места, кто лежит, кто при полководце.
    const { lying, carried } = woundedStacks(s);
    const heads = troopTotal(lying);
    const soon = (s.wounded ?? []).reduce((m, g) => (g.until === null ? m : Math.min(m, g.until)), Infinity);
    stats.push(['ui-bandage', '🩹', 'Раненых среди павших', `${Math.round(healShare(s) * 100)}%`]);
    // Место — боец строя: всадник занимает столько, сколько весит в бою (docs/stable.md).
    stats.push(['ui-bandage', '🛏️', 'Мест занято', `${Math.round(bedsTaken(s))} из ${infirmaryBeds(s)}`]);
    if (heads > 0) stats.push(['ui-bandage', '🩹', 'Лежит раненых', `${heads}`]);
    if (Number.isFinite(soon)) stats.push(['ui-time', '⏳', 'Первые встанут через', waitMinSec(asGame(soon - s.time))]);
    if (troopTotal(carried) > 0) stats.push(['ui-bandage', '🩹', 'Раненых в отряде полководца', `${troopTotal(carried)}`]);
  }
  if (b.type === 'watch') {
    stats.push(['ui-spyglass', '🔭', 'Сведения стареют', `в ${intelKeen(s).toFixed(2)} раза медленнее`]);
    // Минуты с секундами, а не округлённые минуты: округление и было враньём
    // кнопки — девять уровней обещали девять минут, а давали шесть.
    stats.push(['ui-time', '⏳', 'Набег виден дольше на', waitMinSec(warningSeconds(s))]);
    stats.push([
      'hud-map',
      '🗺️',
      'Округа разведана на',
      surveyRadius(s) > 0 ? count(surveyRadius(s), 'клетку', 'клетки', 'клеток') : 'только вокруг города',
    ]);
  }
  if (b.type === 'stable') {
    stats.push(['troop-horse', '🐎', 'Стойла заняты', `${stallsTaken(s)} из ${stalls(s)}`]);
    stats.push(['troop-horse', '🐎', 'Конница учится быстрее', `×${cavalryTrain(s).toFixed(2)}`]);
    // Латных всадников конюшня больше не открывает — их открывает доспех в военной ветви
    // (решение владельца 3). Строка про это стоит там, где игрок нажимает, — в самом найме,
    // и говорит её гейт; второй правды об открытии здесь быть не должно.
    stats.push(['troop-knight', '🏇', 'Латные всадники', troopOpen(s, 'knight') ? 'нанимают здесь' : (troopBlock(s, 'knight') ?? '')]);
  }
  // Тайник. Главный довод его строить — не «сколько прячет сейчас», а «сколько
  // будет», и оба числа стоят рядом, чтобы игроку не считать в уме. Всё, что
  // сверх спрятанного, победитель уносит целиком (`world/spoils.plunder`), и
  // сказано об этом прямо: иначе тайник читается как мелкая прибавка.
  if (b.type === 'cache') {
    const now = stashAt(b.level);
    stats.push(['ui-loot', '🧰', 'Прячет сейчас', `по ${now} каждого запаса`]);
    if (b.level < maxLevelFor(b.type)) {
      const next = stashAt(b.level + 1);
      stats.push(['ui-crate', '📦', `На ур. ${b.level + 1}`, `${next} · +${next - now}`]);
    }
  }
  if (b.type === 'workshop') stats.push(['ui-hammer', '🔨', 'К скорости стройки', `+${crafterBuildShare(s).toFixed(1)}`]);
  if (b.type === 'smithy') stats.push(['hud-army', '⚔️', 'Мощь дружины', armyPower(s).toFixed(0)]);
  if (housing) stats.push(['hud-pop', '👥', 'Жители', `${s.pop} из ${housingCapacity(s)}`]);
  if (def_ && !WALLS.includes(b.type)) stats.push(['hud-army', '⚔️', 'Оборона города', defense(s).toFixed(0)]);

  return (
    <>
      {jobDef && (
        <>
          <h3>Выработка</h3>
          {produced.length > 0 ? (
            <div className="mod total">
              <span className="ico">
                <Icon name="ui-loot" glyph="📦" />
              </span>
              <span className="name">Всего за день</span>
              <span className="val pos">
                {produced.map((r) => `${RESOURCE_META[r].icon}${fmt(prod[r])}`).join('  ')}
              </span>
            </div>
          ) : (
            <div className="note">
              {handsCount(s, b.id) === 0
                ? 'Нет рабочих. Поставь людей на места.'
                : 'Здание не пополняет склад.'}
            </div>
          )}
        </>
      )}

      {stats.length > 0 && (
        <>
          <h3>Что даёт городу</h3>
          {stats.map(([art, glyph, name, val], i) => (
            <div className="mod" key={i}>
              <span className="ico">
                <Icon name={art} glyph={glyph} />
              </span>
              <span className="name">{name}</span>
              <span className="val">{val}</span>
            </div>
          ))}
        </>
      )}
    </>
  );
}
