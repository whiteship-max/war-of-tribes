// Режим марша полководца в окне дела (ДР-2; ДР-7 — docs/city_v3.md, «Решения ДР-7»): три столбца-плитки — скорость, срок туда
// и назад, убыль налегке, вывоз добычи и встанет ли лагерь. Дорога и отказы — мира (`ErrandOption.gaits`, та же дорога в каждом
// режиме теми же функциями, что исполнят приказ); лагерь — `gait.siegeBlockOf`; убыль и вывоз — по составу, выбранному в этом же
// окне, дверью `gaitview.gaitTake`; слова — дверью `world/gait`.
// Дома режим меняют даром: касание плитки и есть выбор, и он уходит с делом одним приказом (`ErrandOrder.gait`). Не дома плитки
// только для сравнения: режим в пути меняют в окне отряда, стоянкой и энергией (`GaitDesk`).
import './gait.css';
import { GAIT_LIGHT_WASTE, GAIT_META, GAIT_SPEED, GAITS, siegeBlockOf, type Gait } from '@/world/gait';
import { gaitTake } from '@/world/gaitview';
import type { GaitRow } from '@/world/types';
import { GAIT_ABOUT, GAIT_AWAY } from './gaitWords';
import { Icon } from '@/ui/icons/Icon';
import type { IconName } from '@/ui/icons/alias';
import { realLeft } from './wait';
import { num } from '@/game/num';

/** Значок режима: налегке — перо, обычный — полководец, с обозом — телега. */
export const GAIT_ICON: Record<Gait, IconName> = { light: 'ui-feather', normal: 'fig-general', train: 'ui-wagon' };

/** Вывоз добычи словами (ДР-5): до десяти тысяч — числом, дальше — «162,8 тыс.». */
export const haulWords = (n: number): string => (n < 10_000 ? num(n, 0) : `${num(n / 1000, n < 100_000 ? 1 : 0)} тыс.`);

/** Скорость режима словами: «×1,5». */
export const gaitPace = (g: Gait): string => `×${num(GAIT_SPEED[g], 1)}`;

/** Истощение налегке словами — числом двери (`GAIT_LIGHT_WASTE`, правило 18): «~1,1 % отряда в игр. день». */
export const lightWasteWords = (): string => `~${num(GAIT_LIGHT_WASTE * 100, 1)} % отряда в игр. день`;

/** Строки плитки по порядку — подписи слева и значения в каждой плитке стоят на одной высоте. */
const LINES = ['Скорость', 'Туда', 'Назад', 'Убыль', 'Вывоз', 'Осада'] as const;

/** Отказ режима словами: «Налегке: …», если строка мира не начинается с имени режима сама. */
const whyOf = (g: Gait, why: string): string => (why.startsWith(GAIT_META[g].name) ? why : `${GAIT_META[g].name}: ${why[0].toLowerCase()}${why.slice(1)}`);

export function GaitPick({
  rows,
  men,
  haul,
  value,
  free,
  onPick,
}: {
  rows: readonly GaitRow[];
  /** Сколько бойцов уходит — состав этого же окна: по нему убыль и вывоз. */
  men: number;
  /** Множитель поклажи своего отряда (`ErrandOption.haul`); 0 — дело добычи не берёт. */
  haul: number;
  value: Gait;
  /** Полководец дома: режим меняется касанием даром и уходит с делом. */
  free: boolean;
  onPick: (g: Gait) => void;
}) {
  const byGait = new Map(rows.map((r) => [r.gait, r]));
  const list = GAITS.flatMap((g) => {
    const r = byGait.get(g);
    return r ? [r] : [];
  });
  if (list.length === 0) return null;
  const loot = haul > 0;
  const off = free ? list.filter((r) => r.block !== null) : [];
  return (
    <div className="gait-pick">
      <h3>Режим марша</h3>
      <div className="gait-grid" role="radiogroup" aria-label="Режим марша">
        <div className="gait-legend" aria-hidden="true">
          <b>&nbsp;</b>
          {LINES.map((l) => (
            <small key={l}>{l}</small>
          ))}
        </div>
        {list.map((r) => {
          const on = r.gait === value;
          const take = gaitTake(men, r.gait, r.walkMs, haul);
          const camp = siegeBlockOf(r.gait);
          return (
            <button
              key={r.gait}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={GAIT_META[r.gait].name}
              disabled={!on && (!free || r.block !== null)}
              className={`gait-col${on ? ' on' : ''}${r.block ? ' off' : ''}`}
              onClick={() => !on && onPick(r.gait)}
            >
              <b>
                <Icon name={GAIT_ICON[r.gait]} />
                <span className="one-line">{GAIT_META[r.gait].name}</span>
              </b>
              <span>{gaitPace(r.gait)}</span>
              <span>{realLeft(r.walkMs / 1000)}</span>
              <span>{r.backMs > 0 ? realLeft(r.backMs / 1000) : '—'}</span>
              <span className={take.lost > 0 ? 'bad' : ''}>{take.lost > 0 ? `−${take.lost}` : '—'}</span>
              <span>{loot ? haulWords(take.carry) : '—'}</span>
              <span className={camp ? 'bad' : 'good'}>{camp ? 'нет' : 'да'}</span>
            </button>
          );
        })}
      </div>
      {off.map((r) => (
        <p key={r.gait} className="nx-tnote bad">
          {whyOf(r.gait, r.block as string)}
        </p>
      ))}
      <p className="nx-tnote">
        {GAIT_ABOUT[value]}
        {value === 'light' ? ` Тает ${lightWasteWords()}; убыль — ожидание к приходу.` : ''}
        {loot ? ' Вывоз — сколько добра поднимут дошедшие.' : ''}
        {free ? '' : ` ${GAIT_AWAY}`}
      </p>
    </div>
  );
}
