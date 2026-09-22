import type { Building, JobId } from '@/game/types';
import { useGame } from '@/game/store';
import {
  BONDED_OUTPUT,
  FREE_RANGE_MULT,
  MAX_BUILDING_LEVEL,
  RESOURCE_IDS,
  RESOURCE_META,
} from '@/game/constants';
import { BUILDING_BY_ID } from '@/game/data/buildings';
import { EQUIPMENT } from '@/game/data/equipment';
import { FREE_JOBS, JOB_BY_ID } from '@/game/data/jobs';
import { ORDER_TEXT } from '@/game/data/order';
import {
  armyPower,
  bondedCount,
  bondedIdle,
  bondedTotal,
  buildRate,
  buildingById,
  buildingHousing,
  buildingProduction,
  buildingSlots,
  buildingStat,
  buildingTitle,
  cavalryTrain,
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
  isOutsideWall,
  isSite,
  jobMultiplier,
  levelOutputMult,
  maxLevelFor,
  stalls,
  stallsTaken,
  netPerDay,
  stashAt,
  storageCap,
  surveyRadius,
  takesBonded,
  warningSeconds,
  upgradeInfo,
  workerCount,
  workerMultiplier,
} from '@/game/derived';
import {
  assignBonded,
  assignWorker,
  cancelUpgrade,
  changeFreeJob,
  startUpgrade,
  unassignBonded,
  unassignWorker,
} from '@/game/sim/actions';
import { Cost } from '../parts/Cost';
import { Steps } from '../parts/Steps';
import { TownHall } from '../parts/TownHall';
import { Smithy } from '../parts/Smithy';
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
import { FoodLeft, WinterForecast } from '../parts/Provisions';
import { waitMinSec, waitShort } from '../parts/wait';
import { gainText, levelLiftsHand, spareSlotsHelp, upgradeGains, type UpgradeGain } from '../parts/upgrade';
import { troopBlock, troopOpen } from '@/game/sim/tech';
import { Icon } from '@/ui/icons/Icon';
import { moodOf } from '@/ui/icons/registry';
import { troopTotal } from '@/game/battle/kinds';
import { asGame } from '@/game/pace';

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
  const eta = rate > 0 ? asGame(Math.ceil((b.workRequired - b.work) / rate)) : null;
  const canLevel = (def.maxLevel ?? MAX_BUILDING_LEVEL) > 1;
  const upEta = rate > 0 ? asGame(Math.ceil(up.work / rate)) : null;
  // Что даст следующий уровень — замером (`parts/upgrade.ts`). Нужен и строке под
  // ценой, и рабочим местам: звать людей на места, от которых нет толку, нельзя.
  const gains = b.level < maxLevelFor(b.type) ? upgradeGains(s, b, b.level + 1) : null;

  return (
    <div className="panel">
      <div className="bhead">
        <div className="ico">
          <Icon name={`bld-${def.id}`} glyph={def.icon} />
        </div>
        <div className="body">
          <div className="name">{buildingTitle(s, b.type)}</div>
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

      {isOutsideWall(b.type) && (
        <div className="note">
          ⚠️ Двор стоит за стеной. Прорвавшийся набег разгонит отсюда людей: двор встанет, пока их не
          вернёшь. Внутри стены людей со двора набег не сгоняет.
        </div>
      )}

      {site ? (
        <div className="card">
          <div className="ico">
            <Icon name="ui-site" glyph="🏗️" />
          </div>
          <div className="body">
            <div className="title">
              Улучшение до {b.level + 1} уровня
              <span className="count">{inQueue ? 'в очереди' : eta !== null ? `~${waitShort(eta)}` : 'нет строителей'}</span>
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
            <div className="hint">{up.blocked ?? (gains ? gainText(gains) : null)}</div>
          </div>
        )
      )}

      <WorkerSlots b={b} gains={gains} />
      <BuildingData b={b} />
    </div>
  );
}

// ---------- Слоты рабочих ----------

/**
 * Рабочие здания. Мест столько, сколько даёт уровень; кого именно поставить —
 * вопроса нет: личного навыка у жителя не осталось, его роль взял на себя сам
 * уровень постройки, поднимая выработку каждому рабочему.
 *
 * Невольники встают на те же места вторым рядом шага — там, где работу дают
 * невольникам. Места общие: сколько занял один ряд, столько не достанется другому.
 *
 * Про места говорится то, что покажет замер, а не их число: у храма, где
 * служители уже упёрлись в потолок, места есть, а толку от них нет, и звать туда
 * людей — или на следующий уровень ради мест — значит врать.
 */
function WorkerSlots({ b, gains }: { b: Building; gains: UpgradeGain[] | null }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const def = BUILDING_BY_ID[b.type];
  if (!def.job) return null;
  const job = JOB_BY_ID[def.job];
  const slots = buildingSlots(b);
  const workers = workerCount(s, b.id);
  const bonded = bondedCount(s, b.id);
  const free = idleCount(s);
  const hands = workers + bonded;
  const nextSlots = gains?.find((g) => g.id === 'slots') ?? null;
  const nextIdle = gains?.some((g) => g.id === 'idleSlots') ?? false;
  const next = nextSlots
    ? `Следующий уровень добавит ещё ${nextSlots.after - nextSlots.before}.`
    : nextIdle
      ? 'Места следующего уровня ничего не прибавят.'
      : '';
  const spare = slots > hands;
  const status = !spare
    ? nextSlots
      ? 'Все места заняты — нужен уровень выше.'
      : `Все места заняты.${next ? ` ${next}` : ''}`
    : spareSlotsHelp(s, b, hands)
      ? `Свободных мест: ${slots - hands}.${next ? ` ${next}` : ''}`
      : `Свободных мест: ${slots - hands}, но занять их незачем — то, что они дают, уже упёрлось в потолок.`;
  // Ряд невольников показывается там, где их ставят, и только когда есть кого
  // ставить или кто-то уже стоит: пустой ряд у посёлка без невольников — шум.
  const bondedRow = takesBonded(b) && (bondedTotal(s) > 0 || bonded > 0);

  return (
    <>
      <h3>
        <Icon name={`job-${job.id}`} glyph={job.icon} /> {job.name}
        <span className="muted">
          {bonded > 0 ? `${workers} + ${bonded}` : workers}/{slots || '—'}
        </span>
      </h3>
      <div className="card">
        <div className="ico">
          <Icon name={`job-${job.id}`} glyph={job.icon} />
        </div>
        <div className="body">
          <div className="title">
            Рабочих в здании
            <span className="count">свободных: {free}</span>
          </div>
          <div className="desc">{status}</div>
        </div>
      </div>
      <Steps
        value={workers}
        max={slots - bonded}
        spare={free}
        step={10}
        addTut="slot-add"
        onChange={(d) =>
          act((st) => (d > 0 ? assignWorker(st, b.id, d) : unassignWorker(st, b.id, -d)))
        }
      />
      {bondedRow && (
        <>
          <div className="card">
            <div className="ico">{ORDER_TEXT.bondedIcon}</div>
            <div className="body">
              <div className="title">
                Невольников на местах
                <span className="count">без места: {bondedIdle(s)}</span>
              </div>
              <div className="desc">
                Места общие с вольными. Невольник даёт {Math.round(BONDED_OUTPUT * 100)}% того, что вольный на том же месте, и
                ест наравне со всеми.
              </div>
            </div>
          </div>
          <Steps
            value={bonded}
            max={slots - workers}
            spare={bondedIdle(s)}
            step={10}
            onChange={(d) =>
              act((st) => (d > 0 ? assignBonded(st, b.id, d) : unassignBonded(st, b.id, -d)))
            }
          />
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
    case 'town_hall':
      return <TownHall b={b} />;
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
        У костра <span className="muted">свободных: {idle}</span>
      </h3>
      <div className="note">
        {site
          ? `Свободные жители строят: ${buildingTitle(s, site.type)} (${Math.floor((site.work / Math.max(1, site.workRequired)) * 100)}%).`
          : 'Свободные жители отдыхают. Начни улучшение, чтобы занять их.'}
      </div>

      <h3>Вольный сбор</h3>
      <div className="note">Работа без места в здании идёт вполсилы. Поставь человека в его двор — те же руки дадут вдвое больше.</div>
      {FREE_JOBS.map((jobId) => (
        <FreeJobRow key={jobId} job={jobId} />
      ))}

      <h3>Настроение</h3>
      <div className="mod">
        <span className="ico">
          <Icon name={moodOf(s.morale).name} glyph={moodOf(s.morale).glyph} />
        </span>
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
              {full ? 'полно' : `${fmtDelta(net[r])}/д`}
            </span>
            <span className="bar">
              <i style={{ width: `${pct}%` }} className={full ? 'full' : ''} />
            </span>
          </div>
        );
      })}

      <FoodLeft />
      <WinterForecast />

      <h3>
        Снаряжение <span className="muted">вместимость не расходует</span>
      </h3>
      <div className="note">
        Снаряжение куют в кузнице, тратят в казармах. Склад его не ограничивает и чужой набег
        его не уносит.
      </div>
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

/** Обычное здание: что оно производит и что даёт посёлку. */
function GenericData({ b }: { b: Building }) {
  const s = useGame((g) => g.s);
  const def = BUILDING_BY_ID[b.type];
  const prod = buildingProduction(s, b);
  const produced = RESOURCE_IDS.filter((r) => prod[r] > 0.01);
  const workers = workerCount(s, b.id);
  const bonded = bondedCount(s, b.id);
  const jobDef = def.job ? JOB_BY_ID[def.job] : null;
  const lifts = jobDef !== null && levelLiftsHand(s, b);

  // Строка «что даёт посёлку»: имя значка, эмодзи на его месте, название, величина.
  // Имя стоит рядом с эмодзи, а не вместо: пока значка нет, показывается эмодзи.
  const stats: [string, string, string, string][] = [];
  const housing = buildingHousing(b);
  if (housing) stats.push(['bld-houses', '🛏️', 'Жилых мест', `${housing}`]);
  const storage = buildingStat(b, 'storage');
  if (storage) stats.push(['bld-storage', '🧺', 'К вместимости склада', `+${storage}`]);
  const def_ = buildingStat(b, 'defense');
  if (def_) stats.push(['gear-shield', '🛡️', 'К защите поселения', `+${def_}`]);
  const morale = buildingStat(b, 'morale');
  if (morale) stats.push(['mood-good', '😊', 'К морали', `+${morale}`]);
  // Службы посёлка: у каждой одно число, и лучше показать его словами игрока,
  // а не названием поля. Числа берутся из тех же функций, что и логика.
  // Стрелки башни и итог обороны у частокола и башни — в разделе «Оборона»
  // (`parts/Walls`): там они стоят рядом с ополчением и дверью к расстановке.
  if (b.type === 'infirmary') {
    // Числа — из тех же чтений, что кладут раненых (`sim/infirmary`): доля, места, кто лежит, кто при полководце.
    const { lying, carried } = woundedStacks(s);
    const heads = troopTotal(lying);
    const soon = (s.wounded ?? []).reduce((m, g) => (g.until === null ? m : Math.min(m, g.until)), Infinity);
    stats.push(['ui-bandage', '🩹', 'Павших ляжет ранеными', `${Math.round(healShare(s) * 100)}%`]);
    // Место — боец строя: всадник занимает столько, сколько весит в бою (docs/stable.md).
    stats.push(['ui-bandage', '🛏️', 'Мест занято (бойцов строя)', `${Math.round(bedsTaken(s))} из ${infirmaryBeds(s)}`]);
    if (heads > 0) stats.push(['ui-bandage', '🩹', 'Лежит раненых', `${heads}`]);
    if (Number.isFinite(soon)) stats.push(['ui-time', '⏳', 'Первые встанут в строй через', waitMinSec(asGame(soon - s.time))]);
    if (troopTotal(carried) > 0) stats.push(['ui-bandage', '🩹', 'Раненых при полководце', `${troopTotal(carried)}`]);
  }
  if (b.type === 'watch') {
    stats.push(['ui-spyglass', '🔭', 'Разведданные стареют', `в ${intelKeen(s).toFixed(2)} раза медленнее`]);
    // Минуты с секундами, а не округлённые минуты: округление и было враньём
    // кнопки — девять уровней обещали девять минут, а давали шесть.
    stats.push(['ui-time', '⏳', 'Набег виден дольше на', waitMinSec(warningSeconds(s))]);
    stats.push([
      'hud-map',
      '🗺️',
      'Округа изучена на',
      surveyRadius(s) > 0 ? `${surveyRadius(s)} клеток` : 'только круг деревни',
    ]);
  }
  if (b.type === 'stable') {
    stats.push(['troop-horse', '🐎', 'Стойла заняты', `${stallsTaken(s)} из ${stalls(s)}`]);
    stats.push(['troop-horse', '🐎', 'Конница учится', `×${cavalryTrain(s).toFixed(2)}`]);
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
    stats.push(['ui-loot', '🧰', 'Прячет сейчас', `${now} каждого припаса`]);
    if (b.level < maxLevelFor(b.type)) {
      const next = stashAt(b.level + 1);
      stats.push(['ui-crate', '📦', `На ${b.level + 1} уровне`, `${next} (+${next - now})`]);
    }
  }
  if (b.type === 'workshop') stats.push(['ui-hammer', '🔨', 'К скорости улучшений', `+${crafterBuildShare(s).toFixed(1)}/с`]);
  if (b.type === 'smithy') stats.push(['hud-army', '⚔️', 'Мощь армии сейчас', armyPower(s).toFixed(0)]);
  if (housing) stats.push(['hud-pop', '👥', 'Всего мест в посёлке', `${housingCapacity(s)} на ${s.pop} чел.`]);
  if (def_ && !WALLS.includes(b.type)) stats.push(['hud-army', '⚔️', 'Защита посёлка', defense(s).toFixed(0)]);

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
              {workers + bonded === 0
                ? 'Здание стоит без рабочих — поставь кого-нибудь на место.'
                : 'Это здание не даёт ресурсов напрямую.'}
            </div>
          )}
          {workers > 0 && (
            <div className="mod">
              <span className="ico">
                <Icon name={`job-${jobDef.id}`} glyph={jobDef.icon} />
              </span>
              <span className="name">Рабочих: {workers}</span>
              {lifts && <span className="val">×{workerMultiplier(s, jobDef.id, b).toFixed(2)} каждый</span>}
            </div>
          )}
          {/* Та же выработка на ту же долю: множитель берётся тот же, а не свой. */}
          {bonded > 0 && (
            <div className="mod">
              <span className="ico">{ORDER_TEXT.bondedIcon}</span>
              <span className="name">Невольников: {bonded}</span>
              {lifts && (
                <span className="val">×{(workerMultiplier(s, jobDef.id, b) * BONDED_OUTPUT).toFixed(2)} каждый</span>
              )}
            </div>
          )}
          {/* Множитель уровня стоит только там, где игра им умножает. Служителя храма
              уровень не усиливает — он держит мораль и набожность головой, до потолка, —
              и «×1.40 от базы» у него было бы враньём (замер — `levelLiftsHand`). */}
          <div className="note">
            {lifts
              ? `Уровень ${b.level}: каждый рабочий работает на ×${levelOutputMult(b.level).toFixed(2)} от базы.`
              : 'Уровень здания рабочих не усиливает: каждый даёт своё по голове, до потолка.'}
          </div>
        </>
      )}

      {stats.length > 0 && (
        <>
          <h3>Что даёт посёлку</h3>
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
