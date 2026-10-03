import type { Building } from '@/game/types';
import { useGame } from '@/game/store';
import { DECREES, RATIONS, TAXES } from '@/game/data/policy';
import { BUILDING_BY_ID } from '@/game/data/buildings';
import { buildingHousing, buildingStat, decreeOf, mastersCount, rationOf, taxIncomePerDay, taxOf, taxQuote, townHallBuildMult, wagesDue } from '@/game/derived';
import { setDecree, setRation, setTax } from '@/game/sim/actions';
import { gemsOf } from '@/game/sim/gems';
import { TownBuild } from './TownBuild';
import { Gems } from './Gems';
import { Icon } from '@/ui/icons/Icon';
import { signed } from './signed';

/**
 * Ратуша — сердце города, и в ней три дела, а не одно, поэтому у неё вкладки:
 *
 * 1. «Стройка» — главная: весь город списком, уровни и очередь. Отдельного
 *    раздела «Здания» внизу нет, чтобы одно и то же не делалось в двух местах.
 * 2. «Указы» — то, чем правит правитель: указ, паёк, налог и золото. Слова — те же, что у
 *    вкладки «Указы» державы нового вида (`realm/RealmTabs.DecreesNew`; словарь — docs/ui_audit.md, 4.4).
 * 3. «Алмазы» — чем они платят за время.
 *
 * Вкладка живёт в сторе, а не здесь (ключ `manage`): на «Указы» ведёт ссылка из справки
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
          Стройка
        </button>
        <button className={tab === 'manage' ? 'active' : ''} onClick={() => setTab('manage')}>
          Указы
        </button>
        <button className={tab === 'gems' ? 'active' : ''} onClick={() => setTab('gems')}>
          Алмазы <i className="tab-count">{gems}</i>
        </button>
      </div>

      {tab === 'build' && <TownBuild />}
      {tab === 'manage' && <Manage b={b} />}
      {tab === 'gems' && <Gems />}
    </>
  );
}

/**
 * Указы: чем правит правитель.
 *
 * Указ, паёк и налог переключаются в любой момент и действуют, пока выбраны,
 * поэтому последствия написаны прямо на кнопке — выбор делают, уже зная цену.
 */
export function Manage({ b }: { b: Building }) {
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
        <span className="name">К скорости стройки</span>
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
        <span className="val">{housing > 0 ? housing : `с ур. ${BUILDING_BY_ID[b.type].since?.housing ?? 1}`}</span>
      </div>

      <h3>Указ</h3>
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

      <h3>Паёк</h3>
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
        Золото <span className="muted">сбор {signed(taxIncomePerDay(s))} в день</span>
      </h3>
      <div className="mod total">
        <span className="ico"><Icon name="res-gold" glyph="💰" /></span>
        <span className="name">Накоплено</span>
        <span className="val pos">{Math.floor(s.gold)}</span>
      </div>
      <div className="mod">
        <span className="ico">⚔️</span>
        <span className="name">Жалованье дружине{mastersCount(s) > 0 ? ' и мастерам' : ''}</span>
        <span className={`val${wagesDue(s) > taxIncomePerDay(s) ? ' neg' : ''}`}>{signed(-wagesDue(s))} в день</span>
      </div>
      <div className="note">
        Чем больше жителей, тем больше сбор. Не хватит золота на жалованье, и дружина начнёт уходить.
      </div>

      <h3>Налог</h3>
      <div className="choice">
        {TAXES.map((t) => {
          const q = taxQuote(s, t.id);
          return (
            <button
              key={t.id}
              className={`choice-opt${tax.id === t.id ? ' on' : ''}`}
              onClick={() => act((st) => setTax(st, t.id))}
            >
              <span className="ico">
                <Icon name={`tax-${t.id}`} glyph={t.icon} />
              </span>
              <b>{t.name}</b>
              <small>
                {t.effect}
                <br />{signed(q.gold)} золота в день · мораль {Math.round(q.morale)} · выработка ×{q.output.toFixed(2)}
              </small>
            </button>
          );
        })}
      </div>
    </>
  );
}
