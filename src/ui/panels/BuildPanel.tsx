import type { Building } from '@/game/types';
import { useGame } from '@/game/store';
import { MAX_BUILDING_LEVEL } from '@/game/constants';
import { BUILDINGS, BUILDING_BY_ID } from '@/game/data/buildings';
import {
  ATTENTION_META,
  buildRate,
  buildingAttention,
  buildingSlots,
  isSite,
  upgradeInfo,
  workerCount,
} from '@/game/derived';
import { Cost } from '../parts/Cost';
import { upgradeGain } from '../parts/upgrade';

const ORDER = new Map(BUILDINGS.map((d, i) => [d.id, i]));
const byOrder = (a: Building, b: Building): number => (ORDER.get(a.type) ?? 99) - (ORDER.get(b.type) ?? 99);

const canLevelUp = (type: Building['type']): boolean =>
  (BUILDING_BY_ID[type].maxLevel ?? MAX_BUILDING_LEVEL) > 1;

/**
 * Раздел «Здания» — список посёлка. Всё уже стоит с первого дня, стройки с нуля
 * нет: здесь видно, что улучшается сейчас, и что даст следующий уровень каждому
 * зданию. Тап по карточке открывает панель здания: это основной путь к нему,
 * потому что целиться пальцем в крышу на 390 px неудобно.
 */
export function BuildPanel() {
  const s = useGame((g) => g.s);
  const queue = s.buildings.filter(isSite).sort(byOrder);
  const built = s.buildings.filter((b) => !isSite(b)).sort(byOrder);
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

      <h3>Посёлок</h3>
      {built.map((b) => (
        <BuiltCard key={b.id} b={b} rate={rate} />
      ))}
    </div>
  );
}

/** Улучшение в общей очереди: прогресс и время до конца. */
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
          <i className="lvl-tag"> → {b.level + 1} ур.</i>
          <span className="count">{first ? (eta !== null ? `~${eta} с` : 'нет строителей') : 'в очереди'}</span>
        </div>
        <div className="desc">Улучшается — здание работает и на лесах — {pct}%</div>
        <div className="progress">
          <div style={{ width: `${pct}%` }} />
        </div>
      </div>
    </button>
  );
}

/** Здание посёлка: уровень, рабочие и то, что даст следующий уровень. */
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
    <button className="card as-row" data-tut={`list-${def.id}`} onClick={() => openBuilding(b.id)}>
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
