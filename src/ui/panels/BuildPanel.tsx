import type { Building } from '@/game/types';
import { useGame } from '@/game/store';
import { MAX_BUILDING_LEVEL } from '@/game/constants';
import { BUILDINGS, BUILDING_BY_ID } from '@/game/data/buildings';
import {
  ATTENTION_META,
  buildRate,
  buildingAttention,
  buildingSlots,
  canAfford,
  countAll,
  isSite,
  upgradeInfo,
  workerCount,
} from '@/game/derived';
import { startBuilding } from '@/game/sim/actions';
import { placeHint, type PlaceSide } from '@/render/plan';
import { Cost } from '../parts/Cost';
import { upgradeGain } from '../parts/upgrade';

const ORDER = new Map(BUILDINGS.map((d, i) => [d.id, i]));
const byOrder = (a: Building, b: Building): number => (ORDER.get(a.type) ?? 99) - (ORDER.get(b.type) ?? 99);

const canLevelUp = (type: Building['type']): boolean =>
  (BUILDING_BY_ID[type].maxLevel ?? MAX_BUILDING_LEVEL) > 1;

/**
 * Раздел «Здания» — и список посёлка, и список того, что ещё можно поставить.
 * Тап по построенному открывает его панель: это основной путь к зданию, потому что
 * целиться пальцем в крышу на 390 px неудобно. Тап по непостроенному начинает стройку.
 */
export function BuildPanel() {
  const s = useGame((g) => g.s);
  const queue = s.buildings.filter(isSite).sort(byOrder);
  const built = s.buildings.filter((b) => b.level > 0 && !isSite(b)).sort(byOrder);
  const available = BUILDINGS.filter((d) => !d.starter && countAll(s, d.id) === 0);
  const rate = buildRate(s);

  return (
    <div className="panel">
      <h2>
        Здания <small>построек: {s.buildings.length} · строителей: {Math.round(rate)}</small>
      </h2>

      {queue.length > 0 && (
        <>
          <h3>В работе</h3>
          {queue.map((b, i) => (
            <SiteCard key={b.id} b={b} first={i === 0} rate={rate} />
          ))}
          {rate === 0 && <div className="note bad">Нет свободных жителей — стройка стоит.</div>}
        </>
      )}

      {built.length > 0 && (
        <>
          <h3>Построено</h3>
          {built.map((b) => (
            <BuiltCard key={b.id} b={b} rate={rate} />
          ))}
        </>
      )}

      {available.length > 0 && <h3>Можно построить</h3>}
      {available.map((def) => (
        <NewCard key={def.id} id={def.id} afford={canAfford(s, def.cost)} eta={rate > 0 ? Math.ceil(def.work / rate) : null} />
      ))}
    </div>
  );
}

/** Стройка или улучшение в общей очереди: прогресс и время до конца. */
function SiteCard({ b, first, rate }: { b: Building; first: boolean; rate: number }) {
  const openBuilding = useGame((g) => g.openBuilding);
  const def = BUILDING_BY_ID[b.type];
  const pct = Math.floor((b.work / Math.max(1, b.workRequired)) * 100);
  const eta = rate > 0 ? Math.ceil((b.workRequired - b.work) / rate) : null;

  return (
    <button className="card as-row" onClick={() => openBuilding(b.id)}>
      <div className="ico">{def.icon}</div>
      <div className="body">
        <div className="title">
          {def.name}
          {b.level > 0 && <i className="lvl-tag"> → {b.level + 1} ур.</i>}
          <span className="count">{first ? (eta !== null ? `~${eta} с` : 'нет строителей') : 'в очереди'}</span>
        </div>
        <div className="desc">
          {b.level === 0 ? 'Строится' : 'Улучшается — здание работает и на лесах'} — {pct}%
        </div>
        <div className="progress">
          <div style={{ width: `${pct}%` }} />
        </div>
      </div>
    </button>
  );
}

/** Построенное здание: уровень, рабочие и то, что даст следующий уровень. */
function BuiltCard({ b, rate }: { b: Building; rate: number }) {
  const s = useGame((g) => g.s);
  const openBuilding = useGame((g) => g.openBuilding);
  const def = BUILDING_BY_ID[b.type];
  const slots = buildingSlots(b);
  const attn = buildingAttention(s, b);
  const up = upgradeInfo(s, b);
  const levels = canLevelUp(b.type);
  const top = def.maxLevel ?? MAX_BUILDING_LEVEL;
  const topped = b.level >= top;
  const eta = rate > 0 ? Math.ceil(up.work / rate) : null;

  return (
    <button className="card as-row" onClick={() => openBuilding(b.id)}>
      <div className="ico">{def.icon}</div>
      <div className="body">
        <div className="title">
          {def.name}
          <span className="count">{levels ? `ур. ${b.level} из ${top}` : 'ур. 1'}</span>
        </div>
        <div className="desc">{slots > 0 ? `Рабочих: ${workerCount(s, b.id)}/${slots}` : def.description}</div>
        {levels &&
          (topped ? (
            <div className="desc">Максимальный уровень.</div>
          ) : (
            <>
              <div className="desc">
                <i className="lvl-tag">До {up.level} ур.:</i> {upgradeGain(s, b, up.level)}
              </div>
              <Cost cost={up.cost} work={up.work} eta={eta} />
            </>
          ))}
      </div>
      {attn && (
        <span className="attn" title={ATTENTION_META[attn].text}>
          {ATTENTION_META[attn].icon}
        </span>
      )}
    </button>
  );
}

const RING_NAME: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: 'на площади, у костра',
  1: 'у самой площади',
  2: 'в среднем кольце',
  3: 'у стены',
  4: 'кольцом вокруг посёлка',
};

const SIDE_NAME: Record<PlaceSide, string> = {
  gate: 'у ворот',
  right: 'справа от ворот',
  left: 'слева от ворот',
  opposite: 'напротив ворот',
};

/**
 * Где встанет постройка — словами. На сцене пустые места больше не размечены
 * (кольцо с колышками обещало дом там, где игрок ничего не начинал), поэтому
 * место называет список: кольцо, сторона от ворот и соседи, по которым его видно
 * в кадре. Стена — исключение: она и есть кольцо, соседей у неё нет.
 */
function Place({ id }: { id: Building['type'] }) {
  const hint = placeHint(id);
  const where = hint.ring === 4 ? RING_NAME[4] : `${RING_NAME[hint.ring]}, ${SIDE_NAME[hint.side]}`;
  const near = hint.neighbours.map((n) => BUILDING_BY_ID[n].name).join(', ');
  return (
    <div className="desc place">
      📍 {where}
      {near && ` · рядом: ${near}`}
    </div>
  );
}

/** Ещё не поставленное здание: тап начинает стройку. Второго такого же не будет. */
function NewCard({ id, afford, eta }: { id: Building['type']; afford: boolean; eta: number | null }) {
  const act = useGame((g) => g.act);
  const def = BUILDING_BY_ID[id];

  return (
    <button
      className="card as-row"
      data-tut={`build-${def.id}`}
      disabled={!afford}
      onClick={() => act((st) => startBuilding(st, def.id))}
    >
      <div className="ico">{def.icon}</div>
      <div className="body">
        <div className="title">
          {def.name}
          <span className="count">{afford ? 'построить' : 'не хватает'}</span>
        </div>
        <div className="desc">{def.description}</div>
        <Place id={id} />
        <Cost cost={def.cost} work={def.work} eta={eta} />
      </div>
      <span className="attn" title="Начать стройку">
        🔨
      </span>
    </button>
  );
}
