import type { Building } from '@/game/types';
import { useGame } from '@/game/store';
import { DECREES, RATIONS, TAXES } from '@/game/data/policy';
import { buildingHousing, buildingStat, decreeOf, rationOf, taxIncomePerDay, taxOf, townHallBuildMult, wagesDue } from '@/game/derived';
import { setDecree, setRation, setTax } from '@/game/sim/actions';
import { gemsOf } from '@/game/sim/gems';
import { TownBuild } from './TownBuild';
import { Gems } from './Gems';
import { Icon } from '@/ui/icons/Icon';

/**
 * Ратуша — сердце города, и в ней три дела, а не одно, поэтому у неё вкладки:
 *
 * 1. «Стройка» — главная: весь посёлок списком, уровни и очередь. Отдельного
 *    раздела «Здания» внизу нет, чтобы одно и то же не делалось в двух местах.
 * 2. «Управление» — то, чем правит вождь: указ, рацион, налог и казна.
 * 3. «Алмазы» — премиальная валюта: чем она платит за время и почему её пока
 *    нельзя купить.
 *
 * Вкладка живёт в сторе, а не здесь: на «Управление» ведёт ссылка из справки
 * о морали, и вести ей некуда, если память о вкладке умирает вместе с панелью.
 */
export function TownHall({ b }: { b: Building }) {
  const tab = useGame((g) => g.townTab);
  const setTab = useGame((g) => g.setTownTab);
  const gems = useGame((g) => gemsOf(g.s));

  return (
    <>
      <div className="tabs">
        <button
          data-tut="town-build"
          className={tab === 'build' ? 'active' : ''}
          onClick={() => setTab('build')}
        >
          🔨 Стройка
        </button>
        <button className={tab === 'manage' ? 'active' : ''} onClick={() => setTab('manage')}>
          📜 Управление
        </button>
        <button className={tab === 'gems' ? 'active' : ''} onClick={() => setTab('gems')}>
          ♦ Алмазы <i className="tab-count">{gems}</i>
        </button>
      </div>

      {tab === 'build' && <TownBuild />}
      {tab === 'manage' && <Manage b={b} />}
      {tab === 'gems' && <Gems />}
    </>
  );
}

/**
 * Управление городом: чем правит вождь.
 *
 * Указ, рацион и налог переключаются в любой момент и действуют, пока выбраны,
 * поэтому последствия написаны прямо на кнопке — выбор делают, уже зная цену.
 */
function Manage({ b }: { b: Building }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const decree = decreeOf(s);
  const ration = rationOf(s);
  const tax = taxOf(s);
  const housing = buildingHousing(b);
  const morale = buildingStat(b, 'morale');

  return (
    <>
      <h3>Ратуша</h3>
      <div className="mod">
        <span className="ico">🔨</span>
        <span className="name">К скорости всех строек</span>
        <span className="val">×{townHallBuildMult(s).toFixed(2)}</span>
      </div>
      {morale > 0 && (
        <div className="mod">
          <span className="ico">😊</span>
          <span className="name">К морали</span>
          <span className="val">+{morale}</span>
        </div>
      )}
      <div className="mod">
        <span className="ico">🛏️</span>
        <span className="name">Жилых мест</span>
        <span className="val">{housing > 0 ? housing : 'с 6 уровня'}</span>
      </div>

      <h3>Указ вождя</h3>
      <div className="choice">
        {DECREES.map((d) => (
          <button
            key={d.id}
            className={`choice-opt${decree.id === d.id ? ' on' : ''}`}
            onClick={() => act((st) => setDecree(st, d.id))}
          >
            <span className="ico">
              <Icon name={`decree-${d.id}`} glyph={d.icon} />
            </span>
            <b>{d.name}</b>
            <small>{d.effect}</small>
          </button>
        ))}
      </div>

      <h3>Рацион</h3>
      <div className="choice">
        {RATIONS.map((r) => (
          <button
            key={r.id}
            className={`choice-opt${ration.id === r.id ? ' on' : ''}`}
            onClick={() => act((st) => setRation(st, r.id))}
          >
            <span className="ico">
              <Icon name={`ration-${r.id}`} glyph={r.icon} />
            </span>
            <b>{r.name}</b>
            <small>{r.effect}</small>
          </button>
        ))}
      </div>

      <h3>
        Казна <span className="muted">+{taxIncomePerDay(s).toFixed(1)} в день</span>
      </h3>
      <div className="mod total">
        <span className="ico"><Icon name="res-gold" glyph="💰" /></span>
        <span className="name">Золото</span>
        <span className="val pos">{Math.floor(s.gold)}</span>
      </div>
      <div className="mod">
        <span className="ico">⚔️</span>
        <span className="name">Жалованье войску</span>
        <span className={`val${wagesDue(s) > taxIncomePerDay(s) ? ' neg' : ''}`}>−{wagesDue(s).toFixed(1)} в день</span>
      </div>
      <div className="note">
        Сбор идёт с людей: чем больше народу в посёлке, тем полнее казна. Платит за это
        мораль, а низкая мораль режет всю выработку — высокий налог выгоден в короткую,
        а не как уклад. Из казны же платят войску: не хватит — оно начнёт уходить.
      </div>

      <h3>Налог</h3>
      <div className="choice">
        {TAXES.map((t) => (
          <button
            key={t.id}
            className={`choice-opt${tax.id === t.id ? ' on' : ''}`}
            onClick={() => act((st) => setTax(st, t.id))}
          >
            <span className="ico">
              <Icon name={`tax-${t.id}`} glyph={t.icon} />
            </span>
            <b>{t.name}</b>
            <small>{t.effect}</small>
          </button>
        ))}
      </div>
    </>
  );
}
