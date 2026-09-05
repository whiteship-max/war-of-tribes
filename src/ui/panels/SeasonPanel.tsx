import { useGame } from '@/game/store';
import { JOB_BY_ID } from '@/game/data/jobs';
import { SEASONS, SEASON_DAYS, SEASON_META, type SeasonModifiers } from '@/game/data/seasons';
import {
  heatingWoodPerDay,
  isFirstWinter,
  seasonAfter,
  seasonDayOf,
  seasonModsFor,
  seasonOf,
  seasonProgress,
  winterForecast,
  yearOf,
} from '@/game/derived';
import type { JobId } from '@/game/types';

/** Строка списка множителей: что растёт, что падает. */
interface Line {
  icon: string;
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

const JOB_ORDER: JobId[] = ['gatherer', 'hunter', 'farmer', 'herder', 'woodcutter', 'stonecutter', 'miner'];

function linesOf(mods: SeasonModifiers): Line[] {
  const out: Line[] = [];
  for (const job of JOB_ORDER) {
    const m = mods.jobs[job];
    if (m === undefined || m === 1) continue;
    const def = JOB_BY_ID[job];
    out.push({ icon: def.icon, label: def.name, mult: m, good: m > 1 });
  }
  if (mods.build !== 1) out.push({ icon: '🔨', label: 'Скорость стройки', mult: mods.build, good: mods.build > 1 });
  if (mods.food !== 1)
    out.push({ icon: '🍖', label: 'Потребление еды', mult: mods.food, good: mods.food < 1 });
  if (mods.morale !== 0)
    out.push({
      icon: mods.morale > 0 ? '😊' : '😟',
      label: 'Мораль',
      text: `${mods.morale > 0 ? '+' : ''}${Math.round(mods.morale * 10) / 10}`,
      good: mods.morale > 0,
    });
  if (mods.heating > 0)
    out.push({
      icon: '🔥',
      label: 'Дрова на очаг',
      text: `${mods.heating.toFixed(2)} на человека в день`,
      good: false,
    });
  // Пустой список читается хуже, чем явная строчка «всё как обычно».
  if (out.length === 0) out.push({ icon: '⚖️', label: 'Обычный ход дел', text: 'без изменений' });
  return out;
}

function ModList({ mods }: { mods: SeasonModifiers }) {
  return (
    <div className="mod-list">
      {linesOf(mods).map((l) => (
        <div className="mod" key={l.label}>
          <span className="ico">{l.icon}</span>
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
  const forecast = winterForecast(s);
  const heat = heatingWoodPerDay(s);

  return (
    <div className="panel">
      <h2>
        {meta.icon} {meta.name} <small>год {year}, день {seasonDayOf(s.time)} из {SEASON_DAYS}</small>
      </h2>

      <div className="progress good" style={{ marginBottom: 10 }}>
        <div style={{ width: `${Math.round(seasonProgress(s.time) * 100)}%` }} />
      </div>

      <p className="season-hint">{meta.hint}</p>

      {season === 'winter' && isFirstWinter(s) && (
        <p className="season-hint soft">Это первая зима племени — она мягче остальных. Дальше будет строже.</p>
      )}

      <h3>Что меняет сезон</h3>
      <ModList mods={mods} />

      {heat > 0 && (
        <div className="mod total">
          <span className="ico">🌲</span>
          <span className="name">Всего на отопление сейчас</span>
          <span className={`val ${s.resources.wood > heat ? '' : 'neg'}`}>{heat.toFixed(1)} в день</span>
        </div>
      )}

      {(season === 'autumn' || season === 'winter') && (
        <>
          <h3>{season === 'autumn' ? 'Хватит ли на зиму' : 'Хватит ли до весны'}</h3>
          <div className="mod-list">
            <div className="mod">
              <span className="ico">🍖</span>
              <span className="name">Еда</span>
              <span className={`val ${forecast.food.ok ? 'pos' : 'neg'}`}>
                {Math.floor(forecast.food.days * 10) / 10} из {forecast.winterDays} дн.
              </span>
            </div>
            <div className="mod">
              <span className="ico">🌲</span>
              <span className="name">Дрова</span>
              <span className={`val ${forecast.wood.ok ? 'pos' : 'neg'}`}>
                {Math.floor(forecast.wood.days * 10) / 10} из {forecast.winterDays} дн.
              </span>
            </div>
          </div>
        </>
      )}

      <h3>Дальше: {SEASON_META[next].name}</h3>
      <ModList mods={seasonModsFor(next, next === 'spring' ? year + 1 : year)} />

      <h3>Круг года</h3>
      <div className="season-wheel">
        {SEASONS.map((x) => (
          <div className={`s-cell${x === season ? ' now' : ''}`} key={x}>
            <span className="ico">{SEASON_META[x].icon}</span>
            <span>{SEASON_META[x].name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
