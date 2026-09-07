import type { Building, GameState } from '@/game/types';
import { useGame } from '@/game/store';
import { MAX_BUILDING_LEVEL, SLOTS_PER_LEVEL } from '@/game/constants';
import { BUILDINGS, BUILDING_BY_ID } from '@/game/data/buildings';
import {
  ATTENTION_META,
  buildRate,
  buildingAttention,
  buildingHousing,
  buildingSlots,
  buildingStat,
  isSite,
  townHallBuildMult,
  upgradeInfo,
  workerCount,
} from '@/game/derived';
import { gemsOf, rushPrice, rushUpgrade } from '@/game/sim/gems';
import { startUpgrade } from '@/game/sim/actions';
import { Cost } from './Cost';
import { upgradeGain } from './upgrade';
import type { ReactNode } from 'react';
import { Icon } from '@/ui/icons/Icon';
import { iconName } from '@/ui/icons/registry';

const ORDER = new Map(BUILDINGS.map((d, i) => [d.id, i]));
const byOrder = (a: Building, b: Building): number => (ORDER.get(a.type) ?? 99) - (ORDER.get(b.type) ?? 99);

const canLevelUp = (type: Building['type']): boolean =>
  (BUILDING_BY_ID[type].maxLevel ?? MAX_BUILDING_LEVEL) > 1;

/** Время в секундах словами: на 375 px «~2 м 10 с» читается, «~130 с» — нет. */
export function etaText(sec: number | null): string {
  if (sec === null) return 'нет строителей';
  if (sec < 60) return `~${Math.ceil(sec)} с`;
  const m = Math.floor(sec / 60);
  const r = Math.round(sec % 60);
  return r > 0 ? `~${m} м ${r} с` : `~${m} м`;
}

/**
 * Чем постройка занята сейчас — вторая строка в ряду. У рабочего здания это
 * люди на местах, у пассивного — то, что оно уже даёт посёлку. Описание из
 * определения здания сюда не годится: в списке из двух десятков строк оно
 * занимает три строки и повторяет то, что и так написано в панели здания.
 */
function rowFacts(s: GameState, b: Building): string {
  const def = BUILDING_BY_ID[b.type];
  const slots = buildingSlots(b);
  if (slots > 0) return `Рабочих: ${workerCount(s, b.id)}/${slots}`;
  const facts: string[] = [];
  if (b.type === 'town_hall') facts.push(`стройка ×${townHallBuildMult(s).toFixed(2)}`);
  const housing = buildingHousing(b);
  if (housing) facts.push(`жильё ${housing}`);
  const storage = buildingStat(b, 'storage');
  if (storage) facts.push(`вместимость +${storage}`);
  const defence = buildingStat(b, 'defense');
  if (defence) facts.push(`защита +${defence}`);
  const morale = buildingStat(b, 'morale');
  if (morale) facts.push(`мораль +${morale}`);
  if (facts.length === 0) return def.description;
  return `Сейчас: ${facts.join(' · ')}`;
}

/**
 * Цена уровня в людях — третий столбец после ресурсов и времени, как в ратуше
 * городских стратегий. Считается только для рабочих зданий: там новый уровень
 * и правда просит людей. У жилья величина обратная (места под крышей), и её не
 * дублируем — она уже стоит в строке «что даст уровень».
 */
function peopleCell(b: Building): ReactNode {
  const def = BUILDING_BY_ID[b.type];
  if (!def.job) return null;
  return (
    <>
      <Icon name="ui-person" glyph="👤" /> +{def.slotsPerLevel ?? SLOTS_PER_LEVEL}
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

  return (
    <>
      <div className="mod total">
        <span className="ico"><Icon name="ui-hammer" glyph="🔨" /></span>
        <span className="name">
          Строителей
          <em className="sub">свободные руки и ремесленники, под рукой ратуши ×{mult.toFixed(2)}</em>
        </span>
        <span className="val pos">{rate.toFixed(1)}/с</span>
      </div>

      {queue.length > 0 && (
        <>
          <h3>
            В работе <span className="muted">очередь: {queue.length}</span>
          </h3>
          {queue.map((b, i) => (
            <SiteRow key={b.id} b={b} first={i === 0} rate={rate} />
          ))}
          {rate === 0 && <div className="note bad">Нет свободных жителей — стройка стоит.</div>}
        </>
      )}

      <h3>Постройки</h3>
      {ready.map((b) => (
        <BuildRow key={b.id} b={b} rate={rate} />
      ))}

      {locked.length > 0 && (
        <>
          <h3>
            Пока недоступно <span className="muted">{locked.length}</span>
          </h3>
          <div className="note">
            Строить с нуля в игре нечего — посёлок стоит целиком с первого дня. Здесь то,
            чему прямо сейчас нельзя дать новый уровень, и почему.
          </div>
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
      title="Достроить сейчас — алмазы покупают время, ресурсы списываются как обычно"
    >
      ♦ {price}
    </button>
  );
}

/** Улучшение в общей очереди: прогресс, время до конца и достройка за алмазы. */
function SiteRow({ b, first, rate }: { b: Building; first: boolean; rate: number }) {
  const openBuilding = useGame((g) => g.openBuilding);
  const def = BUILDING_BY_ID[b.type];
  const left = Math.max(0, b.workRequired - b.work);
  const pct = Math.floor((b.work / Math.max(1, b.workRequired)) * 100);
  const eta = rate > 0 ? left / rate : null;

  return (
    <div className="build-row site">
      <button className="grip" onClick={() => openBuilding(b.id)} aria-label={def.name}>
        <span className="ico">
          <Icon name={`bld-${def.id}`} glyph={def.icon} />
        </span>
        <span className="body">
          <span className="title">
            {def.name}
            <i className="lvl-tag">→ {b.level + 1} ур.</i>
            <span className="count">{first ? etaText(eta) : 'в очереди'}</span>
          </span>
          <span className="desc">В лесах, но работает — {pct}%</span>
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
function BuildRow({ b, rate }: { b: Building; rate: number }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const openBuilding = useGame((g) => g.openBuilding);
  const def = BUILDING_BY_ID[b.type];
  const up = upgradeInfo(s, b);
  const top = def.maxLevel ?? MAX_BUILDING_LEVEL;
  const attn = buildingAttention(s, b);
  const people = peopleCell(b);
  const eta = rate > 0 ? up.work / rate : null;

  return (
    <div className="build-row" data-tut={`list-${def.id}`}>
      <button className="grip" onClick={() => openBuilding(b.id)}>
        <span className="ico">
          <Icon name={`bld-${def.id}`} glyph={def.icon} />
        </span>
        <span className="body">
          <span className="title">
            {def.name}
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
          <span className="desc gain">{upgradeGain(s, b, up.level)}</span>
        </span>
      </button>
      <Cost
        cost={up.cost}
        work={up.work}
        eta={eta === null ? null : Math.ceil(eta)}
        extra={people && <span className="people" title="Во что уровень обойдётся в людях">{people}</span>}
      />
      <div className="acts">
        <button
          className="btn"
          data-tut={`upgrade-${def.id}`}
          onClick={() => act((st) => startUpgrade(st, b.id))}
        >
          Уровень {up.level}
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
            {def.name}
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
