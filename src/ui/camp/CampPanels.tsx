// Окна предметов лагеря бродяги (ПН-12л, docs/gdd/path_of_sword.md, 5.2): шатёр — герой и состав; костёр — дух и жалованье, «Погасить
// костры» (скрытый лагерь) и «Развести костры»; обоз — провиант и добыча. Числа — двери игры: дух — `sim/spirit.spiritView` (строки
// «что влияет», среди них «Лагерь» и «Непогода»), жалованье — `roamrules.bandWagesPerDay` и `sim/upkeep.setWageMode`, провиант —
// паёк отряда (`bandRationPerDay`) с тем же множителем снега, что шаг (`campsite.rationWeather`), вместимость — `cargocap`. Лагерь
// меняет одна дверь мира (`WorldApi.roamCamp`). Своей арифметики нет.
import type { ReactNode } from 'react';
import type { ResourceId, TroopId } from '@/game/types';
import type { WageMode } from '@/game/spiritrules';
import { useGame } from '@/game/store';
import { worldApi } from '@/world/api';
import { worldNow } from '@/world/store';
import { openSky, rationWeather } from '@/world/campsite';
import { TROOP_BY_ID, TROOP_IDS } from '@/game/data/troops';
import { EQUIPMENT_BY_ID } from '@/game/data/equipment';
import { RESOURCE_META } from '@/game/constants';
import { seasonMods } from '@/game/derived';
import { troopTotal } from '@/game/battle/kinds';
import { num, signedWhole } from '@/game/num';
import { bandRationPerDay, bandWagesPerDay, cargoLoad, woundedOf } from '@/game/roamrules';
import { cargoCap } from '@/game/cargocap';
import { spiritView, wageMode } from '@/game/sim/spirit';
import { setWageMode, wageModeBlock } from '@/game/sim/upkeep';
import { WAGE_MODES } from '@/game/spiritrules';
import { LINE_WORD, WAGE_WORD } from '@/ui/parts/spiritWords';
import { Icon } from '@/ui/icons/Icon';

/** Окно лагеря — тем же устройством, что окна отряда (`roam-leg`, `nx-am`). */
function Pane({ icon, title, sub, onClose, children, foot }: { icon: Parameters<typeof Icon>[0]['name']; title: string; sub: string; onClose: () => void; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="am-wrap" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel nx-bpanel nx-am">
        <div className="nx-bhead">
          <span className="nx-bico">
            <Icon name={icon} />
          </span>
          <div className="nx-btitle">
            <b className="one-line">{title}</b>
            <span className="nx-blvl">{sub}</span>
          </div>
          <button className="nx-bclose" onClick={onClose} aria-label="Закрыть">
            <Icon name="ui-close" />
          </button>
        </div>
        <div className="nx-am-body er-confirm">{children}</div>
        <div className="nx-am-foot">
          <button className="nx-go nx-go-ghost" onClick={onClose}>
            Назад
          </button>
          {foot}
        </div>
      </div>
    </div>
  );
}

/** Шатёр героя: кто ведёт отряд и кто в нём. */
export function CampTent({ onClose, onBand }: { onClose: () => void; onBand: () => void }) {
  const r = useGame((g) => g.s.roam);
  const prestige = useGame((g) => g.s.prestige ?? 0);
  const time = useGame((g) => g.s.time);
  if (!r) return null;
  const hurt = woundedOf(r);
  const kinds = TROOP_IDS.filter((id) => (r.band[id] ?? 0) + (hurt[id] ?? 0) > 0);
  const wounded = troopTotal(hurt);
  return (
    <Pane
      icon="ui-banner"
      title={`Шатёр · ${r.hero.name}`}
      sub={`Военное дело ${r.hero.war} · престиж ${Math.floor(prestige)}`}
      onClose={onClose}
      foot={
        <button className="nx-go" onClick={onBand}>
          Состав и повышение
        </button>
      }
    >
      {r.hero.hurt !== undefined && r.hero.hurt > time && <p className="nx-bwarn">Герой ранен: в бой не ведёт.</p>}
      <p className="nx-tnote">
        В строю {troopTotal(r.band)}, раненых {wounded}.
      </p>
      <div className="roam-legs">
        {kinds.map((id: TroopId) => (
          <div key={id} className="roam-leg">
            <b>{TROOP_BY_ID[id].name}</b>
            <span>{r.band[id] ?? 0}</span>
            {(hurt[id] ?? 0) > 0 && <small className="muted">раненых {hurt[id]}</small>}
          </div>
        ))}
      </div>
    </Pane>
  );
}

/** Костёр: дух отряда, жалованье и огонь лагеря. */
export function CampFire({ onClose }: { onClose: () => void }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const showToast = useGame((g) => g.showToast);
  const r = s.roam;
  if (!r) return null;
  const v = spiritView(s);
  const mode = wageMode(s);
  const lines = v.morale.lines.filter((l) => l.id !== 'base');
  const kind = r.camp?.kind ?? null;
  const fires = async (to: 'open' | 'hidden'): Promise<void> => {
    const err = await worldApi().roamCamp?.(to);
    showToast(err ?? (to === 'hidden' ? 'Костры погашены: лагерь скрытый.' : 'Костры разведены: лагерь открытый.'));
    if (!err) onClose();
  };
  return (
    <Pane
      icon="ui-flame"
      title="Костёр"
      sub={`мораль ${Math.round(v.morale.value)} · дисциплина ${Math.round(v.discipline.value)}`}
      onClose={onClose}
      foot={
        kind === 'open' ? (
          <button className="nx-go" onClick={() => void fires('hidden')}>
            Погасить костры
          </button>
        ) : kind === 'hidden' ? (
          <button className="nx-go" onClick={() => void fires('open')}>
            Развести костры
          </button>
        ) : undefined
      }
    >
      <div className="camp-lines">
        {lines.map((l) => (
          <div key={l.id} className="camp-line">
            <Icon name={LINE_WORD[l.id].icon} />
            <span className="one-line">{LINE_WORD[l.id].name}</span>
            <b>{signedWhole(l.value)}</b>
          </div>
        ))}
      </div>
      <p className="nx-tnote">
        Жалованье отряда: {num(bandWagesPerDay(r.band, mode), 1)} золота в игр. день. {kind === 'open' ? 'Погасить костры — встать скрытым лагерем: без огня и дыма, тише, но без тепла.' : ''}
      </p>
      <div className="roam-legs">
        {WAGE_MODES.map((m: WageMode) => {
          const why = wageModeBlock(s, m);
          return (
            <button key={m} className={`roam-leg${mode === m ? ' on' : ''}`} disabled={why !== null} onClick={() => act((st) => setWageMode(st, m))}>
              <b>{WAGE_WORD[m].name}</b>
              <span>{num(bandWagesPerDay(r.band, m), 1)}</span>
              <small className="muted">{WAGE_WORD[m].sub}</small>
            </button>
          );
        })}
      </div>
    </Pane>
  );
}

/** Обоз: провиант (на сколько хватит — паёк отряда той же дверью, что шаг) и добыча. */
export function CampCargo({ onClose }: { onClose: () => void }) {
  const s = useGame((g) => g.s);
  const r = s.roam;
  if (!r) return null;
  const open = r.way ? openSky(r.way, worldNow(), s.time) : null;
  const ration = bandRationPerDay(r, seasonMods(s).food * (open ? rationWeather(open.sky) : 1));
  const food = r.cargo.food ?? 0;
  const goods = (Object.entries(r.cargo) as [ResourceId, number][]).filter(([k, n]) => k !== 'food' && n >= 1);
  const gear = Object.entries(r.gear).filter(([, n]) => (n ?? 0) > 0);
  return (
    <Pane icon="ui-wagon" title="Обоз" sub={`${Math.floor(cargoLoad(r))} из ${Math.floor(cargoCap(r))} · кошель ${Math.floor(r.purse)}`} onClose={onClose}>
      <div className="camp-lines">
        <div className="camp-line">
          <Icon name="res-food" />
          <span className="one-line">Провиант</span>
          <b>{Math.floor(food)}</b>
        </div>
      </div>
      <p className="nx-tnote">
        Паёк отряда — {num(ration, 1)} в игр. день{ration > 0 ? `: обоза хватит на ${num(food / ration, 1)} игр. дн. без фуража` : ''}.
      </p>
      <p className="nx-tnote">Добыча:</p>
      <div className="camp-lines">
        {goods.length === 0 && gear.length === 0 && <p className="nx-tnote muted">Пусто.</p>}
        {goods.map(([k, n]) => (
          <div key={k} className="camp-line">
            <Icon name="ui-satchel" />
            <span className="one-line">{RESOURCE_META[k]?.name ?? k}</span>
            <b>{Math.floor(n)}</b>
          </div>
        ))}
        {gear.map(([k, n]) => (
          <div key={k} className="camp-line">
            <Icon name="ui-hammer" />
            <span className="one-line">{EQUIPMENT_BY_ID[k as keyof typeof EQUIPMENT_BY_ID].name}</span>
            <b>{n}</b>
          </div>
        ))}
      </div>
    </Pane>
  );
}
