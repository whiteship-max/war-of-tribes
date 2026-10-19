import { useGame } from '@/game/store';
import { JOB_BY_ID } from '@/game/data/jobs';
import { YARDS } from '@/game/data/yards';
import { SEASONS, SEASON_DAYS, SEASON_META, type SeasonModifiers } from '@/game/data/seasons';
import {
  heatingWoodPerDay,
  isFirstWinter,
  seasonAfter,
  seasonDayOf,
  seasonModsFor,
  seasonOf,
  seasonProgress,
  yearOf,
} from '@/game/derived';
import type { GameState, JobId } from '@/game/types';
import { Icon } from '@/ui/icons/Icon';
import { iconName } from '@/ui/icons/registry';
import { WinterForecast } from '@/ui/parts/Provisions';
import { dec } from '@/game/num';
import type { IconName } from '@/ui/icons/alias';

/** Строка списка множителей: что растёт, что падает. */
interface Line {
  icon: IconName;
  label: string;
  /** Множитель; 1 — без изменений. */
  mult?: number;
  /** Готовый текст вместо процента. */
  text?: string;
  /** Хорошо это для племени или плохо. */
  good?: boolean;
}

const pct = (m: number): string => {
  if (m === 0) return 'остановлено';
  const d = Math.round((m - 1) * 100);
  return `${d > 0 ? '+' : ''}${d}%`;
};

/** Профессии дворов в порядке показа: сначала те, что кормят, потом сырьё — порядком таблицы дворов. */
const JOB_ORDER: JobId[] = [...YARDS.filter((y) => y.yield.food), ...YARDS.filter((y) => !y.yield.food)].map((y) => y.job);

/**
 * Дрова на одного человека в день — замером настоящего расчёта отопления, а не множителем
 * сезона: между множителем и поленницей стоят крыша и скидка на весь посёлок
 * (`seasons.HEATING_CAMPFIRE`), и прежняя строка «1.20 на человека» была дороже правды
 * на эту скидку. Под крышей — один житель при нынешних крышах, без крыши — один житель
 * без единой постройки.
 */
function heatPerHead(s: GameState, mods: SeasonModifiers): string {
  const roofed = heatingWoodPerDay({ ...s, pop: 1 }, mods);
  const open = heatingWoodPerDay({ ...s, pop: 1, buildings: [] }, mods);
  return `${dec(roofed, 2)} под крышей, ${dec(open, 2)} без неё`;
}

function linesOf(s: GameState, mods: SeasonModifiers): Line[] {
  const out: Line[] = [];
  for (const job of JOB_ORDER) {
    const m = mods.jobs[job];
    if (m === undefined || m === 1) continue;
    const def = JOB_BY_ID[job];
    out.push({ icon: iconName('job', job), label: def.name, mult: m, good: m > 1 });
  }
  if (mods.build !== 1) out.push({ icon: 'ui-hammer', label: 'Скорость стройки', mult: mods.build, good: mods.build > 1 });
  if (mods.food !== 1)
    out.push({ icon: 'res-food', label: 'Потребление еды', mult: mods.food, good: mods.food < 1 });
  if (mods.morale !== 0)
    out.push({
      icon: mods.morale > 0 ? 'mood-good' : 'mood-bad',
      label: 'Мораль',
      text: `${mods.morale > 0 ? '+' : ''}${Math.round(mods.morale * 10) / 10}`,
      good: mods.morale > 0,
    });
  if (mods.heating > 0)
    out.push({
      icon: 'ui-flame',
      label: 'Дрова на жителя в день',
      text: heatPerHead(s, mods),
      good: false,
    });
  // Пустой список читается хуже, чем явная строчка «всё как обычно».
  if (out.length === 0) out.push({ icon: 'ui-scales', label: 'Обычный ход дел', text: 'без изменений' });
  return out;
}

function ModList({ s, mods }: { s: GameState; mods: SeasonModifiers }) {
  return (
    <div className="mod-list">
      {linesOf(s, mods).map((l) => (
        <div className="mod" key={l.label}>
          <span className="ico"><Icon name={l.icon} /></span>
          <span className="name">{l.label}</span>
          <span className={`val ${l.good === undefined ? '' : l.good ? 'pos' : 'neg'}`}>
            {l.text ?? pct(l.mult ?? 1)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function SeasonPanel() {
  const s = useGame((g) => g.s);
  const season = seasonOf(s.time);
  const year = yearOf(s.time);
  const meta = SEASON_META[season];
  const mods = seasonModsFor(season, year);
  const next = seasonAfter(season);
  const heat = heatingWoodPerDay(s);

  return (
    <div className="panel">
      <h2>
        <Icon name={iconName('season', season)} /> {meta.name} <small>год {year}, день {seasonDayOf(s.time)} из {SEASON_DAYS}</small>
      </h2>

      <div className="progress good" style={{ marginBottom: 10 }}>
        <div style={{ width: `${Math.round(seasonProgress(s.time) * 100)}%` }} />
      </div>

      <p className="season-hint">{meta.hint}</p>

      {season === 'winter' && isFirstWinter(s) && (
        <p className="season-hint soft">Первая зима мягче остальных.</p>
      )}

      <h3>Что меняет сезон</h3>
      <ModList s={s} mods={mods} />

      {heat > 0 && (
        <div className="mod total">
          <span className="ico"><Icon name="res-wood" /></span>
          <span className="name">Дрова на отопление</span>
          <span className={`val ${s.resources.wood > heat ? '' : 'neg'}`}>{dec(heat, 1)} в день</span>
        </div>
      )}

      {/* Прогноз зимы — тот же компонент, что на складе. */}
      {(season === 'autumn' || season === 'winter') && <WinterForecast />}

      <h3>Следом {SEASON_META[next].name.toLowerCase()}</h3>
      <ModList s={s} mods={seasonModsFor(next, next === 'spring' ? year + 1 : year)} />

      <h3>Круг года</h3>
      <div className="season-wheel">
        {SEASONS.map((x) => (
          <div className={`s-cell${x === season ? ' now' : ''}`} key={x}>
            <span className="ico">
              <Icon name={iconName('season', x)} />
            </span>
            <span>{SEASON_META[x].name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
