import type { Building, GameState } from '@/game/types';
import { useGame } from '@/game/store';
import { MAX_BUILDING_LEVEL } from '@/game/constants';
import { BUILDINGS, BUILDING_BY_ID } from '@/game/data/buildings';
import { ORDER_TEXT } from '@/game/data/order';
import {
  ATTENTION_META,
  bondedCount,
  buildRate,
  buildingAttention,
  buildingHousing,
  buildingSlots,
  buildingStat,
  buildingTitle,
  handsCount,
  isSite,
  townHallBuildMult,
  upgradeInfo,
  workerCount,
} from '@/game/derived';
import { gemsOf, rushPrice, rushUpgrade } from '@/game/sim/gems';
import { startUpgrade } from '@/game/sim/actions';
import { Cost } from './Cost';
import { gainText, readVillage, upgradeGains, type Readings, type UpgradeGain } from './upgrade';
import type { ReactNode } from 'react';
import { Icon } from '@/ui/icons/Icon';
import { iconName } from '@/ui/icons/registry';
import { waitSpan } from './wait';
import { asGame } from '@/game/pace';

const ORDER = new Map(BUILDINGS.map((d, i) => [d.id, i]));
const byOrder = (a: Building, b: Building): number => (ORDER.get(a.type) ?? 99) - (ORDER.get(b.type) ?? 99);

const canLevelUp = (type: Building['type']): boolean =>
  (BUILDING_BY_ID[type].maxLevel ?? MAX_BUILDING_LEVEL) > 1;

/**
 * Чем постройка занята сейчас — вторая строка в ряду. У рабочего здания это
 * люди на местах, у пассивного — то, что оно уже даёт посёлку. Описание из
 * определения здания сюда не годится: в списке из двух десятков строк оно
 * занимает три строки и повторяет то, что и так написано в панели здания.
 */
function rowFacts(s: GameState, b: Building): string {
  const def = BUILDING_BY_ID[b.type];
  const slots = buildingSlots(b);
  if (slots > 0) {
    // Невольники стоят на тех же местах: занятые места — это все руки, а не одни вольные.
    const bonded = bondedCount(s, b.id);
    return bonded > 0
      ? `Рабочих: ${handsCount(s, b.id)}/${slots} · ${ORDER_TEXT.bondedIcon} ${bonded}`
      : `Рабочих: ${workerCount(s, b.id)}/${slots}`;
  }
  const facts: string[] = [];
  if (b.type === 'town_hall') facts.push(`стройка ×${townHallBuildMult(s).toFixed(2)}`);
  const housing = buildingHousing(b);
  if (housing) facts.push(`жильё ${housing}`);
  const storage = buildingStat(b, 'storage');
  if (storage) facts.push(`вместимость +${storage}`);
  const defence = buildingStat(b, 'defense');
  if (defence) facts.push(`оборона +${defence}`);
  const morale = buildingStat(b, 'morale');
  if (morale) facts.push(`мораль +${morale}`);
  if (facts.length === 0) return def.description;
  return facts.join(' · ');
}

/**
 * Цена уровня в людях — третий столбец после ресурсов и времени, как в ратуше
 * городских стратегий. Стоит только там, где новые места и правда просят людей:
 * берётся из того же замера, что строка «что даст уровень». Места, которым нечего
 * дать (служители храма сверх потолка), людей не просят — и столбца у них нет.
 * У жилья величина обратная (места под крышей), и её не дублируем — она уже стоит
 * в строке «что даст уровень».
 */
function peopleCell(gains: UpgradeGain[]): ReactNode {
  const slots = gains.find((g) => g.id === 'slots');
  if (!slots) return null;
  return (
    <>
      <Icon name="ui-person" glyph="👤" /> +{slots.after - slots.before}
    </>
  );
}

/**
 * Вкладка «Стройка» — главная в ратуше и единственное место, откуда ведут
 * улучшения. Отдельного раздела «Здания» внизу больше нет: одно и то же дело
 * не должно делаться в двух местах.
 *
 * Строка постройки устроена как в ратуше городских стратегий: иконка, название,
 * уровень, цена нового уровня по ресурсам, время, спрос на людей и кнопка
 * «Уровень N». Вторая кнопка — достройка за алмазы: она покупает время, ресурсы
 * при этом списываются как обычно.
 */
export function TownBuild() {
  const s = useGame((g) => g.s);
  const rate = buildRate(s);
  const queue = s.buildings.filter(isSite).sort(byOrder);
  const ready = s.buildings
    .filter((b) => !isSite(b) && upgradeInfo(s, b).blocked === null)
    .sort(byOrder);
  const locked = s.buildings
    .filter((b) => !isSite(b) && upgradeInfo(s, b).blocked !== null)
    .sort(byOrder);
  const mult = townHallBuildMult(s);
  // Показания посёлка для строк «что даст уровень»: общие у всех строк, поэтому
  // одни на отрисовку.
  const base = readVillage(s);

  return (
    <>
      <div className="mod total">
        <span className="ico"><Icon name="ui-hammer" glyph="🔨" /></span>
        <span className="name">
          Скорость стройки
          <em className="sub">свободные руки, ремесленники · ратуша ×{mult.toFixed(2)}</em>
        </span>
        <span className="val pos">{rate.toFixed(1)}</span>
      </div>

      {queue.length > 0 && (
        <>
          <h3>
            В работе <span className="muted">{queue.length}</span>
          </h3>
          {queue.map((b, i) => (
            <SiteRow key={b.id} b={b} first={i === 0} rate={rate} />
          ))}
          {rate === 0 && <div className="note bad">Свободных рук нет, стройка стоит.</div>}
        </>
      )}

      <h3>Готовы к улучшению</h3>
      {ready.map((b) => (
        <BuildRow key={b.id} b={b} rate={rate} base={base} />
      ))}

      {locked.length > 0 && (
        <>
          <h3>
            Нельзя улучшить <span className="muted">{locked.length}</span>
          </h3>
          {locked.map((b) => (
            <LockedRow key={b.id} b={b} />
          ))}
        </>
      )}
    </>
  );
}

/** Кнопка достройки за алмазы. Цена падает по мере приближения к концу стройки. */
function RushButton({ b }: { b: Building }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const price = rushPrice(b);
  return (
    <button
      className="btn gem"
      data-tut={`rush-${b.type}`}
      disabled={gemsOf(s) < price}
      onClick={() => act((st) => rushUpgrade(st, b.id))}
      aria-label="Достроить"
    >
      <Icon name="res-gem" glyph="♦" /> {price}
    </button>
  );
}

/** Улучшение в общей очереди: прогресс, время до конца и достройка за алмазы. */
function SiteRow({ b, first, rate }: { b: Building; first: boolean; rate: number }) {
  const s = useGame((g) => g.s);
  const openBuilding = useGame((g) => g.openBuilding);
  const def = BUILDING_BY_ID[b.type];
  // Имя здания спрашивается у игры, а не у конфига: у храма оно зависит от веры
  // деревни (`derived.buildingTitle`), и второй правды об этом быть не должно.
  const name = buildingTitle(s, b.type);
  const left = Math.max(0, b.workRequired - b.work);
  const pct = Math.floor((b.work / Math.max(1, b.workRequired)) * 100);
  const eta = rate > 0 ? asGame(left / rate) : null;

  return (
    <div className="build-row site">
      <button className="grip" onClick={() => openBuilding(b.id)} aria-label={name}>
        <span className="ico">
          <Icon name={`bld-${def.id}`} glyph={def.icon} />
        </span>
        <span className="body">
          <span className="title">
            {name}
            <i className="lvl-tag">→ ур. {b.level + 1}</i>
            <span className="count">{first ? (eta !== null ? waitSpan(eta) : 'нет строителей') : 'в очереди'}</span>
          </span>
          <span className="desc">Работает · готово на {pct}%</span>
          <span className="progress">
            <i style={{ width: `${pct}%` }} />
          </span>
        </span>
      </button>
      <div className="acts">
        <RushButton b={b} />
      </div>
    </div>
  );
}

/** Постройка, которой можно дать новый уровень прямо сейчас. */
function BuildRow({ b, rate, base }: { b: Building; rate: number; base: Readings }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const openBuilding = useGame((g) => g.openBuilding);
  const def = BUILDING_BY_ID[b.type];
  const up = upgradeInfo(s, b);
  const top = def.maxLevel ?? MAX_BUILDING_LEVEL;
  const attn = buildingAttention(s, b);
  const gains = upgradeGains(s, b, up.level, base);
  const people = peopleCell(gains);
  const eta = rate > 0 ? up.work / rate : null;

  return (
    <div className="build-row" data-tut={`list-${def.id}`}>
      <button className="grip" onClick={() => openBuilding(b.id)}>
        <span className="ico">
          <Icon name={`bld-${def.id}`} glyph={def.icon} />
        </span>
        <span className="body">
          <span className="title">
            {buildingTitle(s, b.type)}
            <span className="count">
              ур. {b.level} из {top}
              {attn && (
                <i className="attn-dot" title={ATTENTION_META[attn].text}>
                  <Icon name={iconName('attn', attn)} glyph={ATTENTION_META[attn].icon} />
                </i>
              )}
            </span>
          </span>
          <span className="desc">{rowFacts(s, b)}</span>
          <span className="desc gain">{gainText(gains)}</span>
        </span>
      </button>
      <Cost
        cost={up.cost}
        work={up.work}
        eta={eta === null ? null : asGame(Math.ceil(eta))}
        extra={people && <span className="people">{people}</span>}
      />
      <div className="acts">
        <button
          className="btn"
          data-tut={`upgrade-${def.id}`}
          onClick={() => act((st) => startUpgrade(st, b.id))}
        >
          Улучшить
        </button>
        <RushButton b={b} />
      </div>
    </div>
  );
}

/** Постройка, которой уровень сейчас не дать: сказано, чего именно не хватает. */
function LockedRow({ b }: { b: Building }) {
  const s = useGame((g) => g.s);
  const openBuilding = useGame((g) => g.openBuilding);
  const def = BUILDING_BY_ID[b.type];
  const up = upgradeInfo(s, b);
  const top = def.maxLevel ?? MAX_BUILDING_LEVEL;
  const levels = canLevelUp(b.type);

  return (
    <div className="build-row locked" data-tut={`list-${def.id}`}>
      <button className="grip" onClick={() => openBuilding(b.id)}>
        <span className="ico">
          <Icon name={`bld-${def.id}`} glyph={def.icon} />
        </span>
        <span className="body">
          <span className="title">
            {buildingTitle(s, b.type)}
            <span className="count">
              ур. {b.level}
              {levels ? ` из ${top}` : ''}
            </span>
          </span>
          <span className="desc bad">{up.blocked}</span>
        </span>
      </button>
      {levels && b.level < top && <Cost cost={up.cost} />}
    </div>
  );
}
