// Режим марша полководца (ДР-2, docs/siege_v2.md, 25.1) — таблицей выбора: срок, убыль налегке, встанет ли лагерь. Числа —
// мира (`GaitRow`: та же дорога в каждом режиме, теми же функциями, что исполнят приказ), слова — дверью `world/gait`.
// Дома режим меняют даром: касание строки и есть выбор (таблица выбора, как паёк и налог). Не дома — строки только для
// сравнения, а сменить режим можно в окне отряда: стоянкой и энергией.
import { GAIT_LIGHT_WASTE, GAIT_META, GAIT_SPEED, GAITS, type Gait } from '@/world/gait';
import type { GaitRow } from '@/world/types';
import { Table, type Col, type TableRow } from '@/ui/kit/Table';
import { Icon } from '@/ui/icons/Icon';
import type { IconName } from '@/ui/icons/alias';
import { realLeft } from './wait';
import { num } from '@/game/num';

/** Значок режима: налегке — перо, обычный — полководец, с обозом — телега. */
export const GAIT_ICON: Record<Gait, IconName> = { light: 'ui-feather', normal: 'fig-general', train: 'ui-wagon' };

const COLS: readonly Col[] = [
  { key: 'gait', title: 'Режим' },
  { key: 'walk', title: 'Срок', align: 'right', w: '76px' },
  { key: 'lost', title: 'Убыль', align: 'right', w: '52px' },
  { key: 'siege', title: 'Осада', align: 'center', w: '52px' },
];

/** Скорость режима словами: «×1,5». */
export const gaitPace = (g: Gait): string => `×${num(GAIT_SPEED[g], 1)}`;

/** Истощение налегке словами — числом двери (`GAIT_LIGHT_WASTE`, правило 18): «~1,1 % отряда в игр. день». */
export const lightWasteWords = (): string => `~${num(GAIT_LIGHT_WASTE * 100, 1)} % отряда в игр. день`;

export function GaitPick({
  rows,
  current,
  free,
  busy,
  onPick,
}: {
  rows: readonly GaitRow[];
  current: Gait;
  /** Полководец дома: режим меняется касанием даром. */
  free: boolean;
  busy?: boolean;
  onPick: (g: Gait) => void;
}) {
  const byGait = new Map(rows.map((r) => [r.gait, r]));
  const list: TableRow[] = GAITS.flatMap((g) => {
    const r = byGait.get(g);
    if (!r) return [];
    return [
      {
        key: g,
        on: g === current,
        dim: !free && g !== current,
        ...(free && !busy ? { pick: () => onPick(g) } : {}),
        cells: {
          gait: (
            <span className="kit-name">
              <span className="ic">
                <Icon name={GAIT_ICON[g]} />
              </span>
              <span className="one-line">
                {GAIT_META[g].name} <span className="muted">{gaitPace(g)}</span>
              </span>
            </span>
          ),
          walk: realLeft(r.walkMs / 1000),
          lost: r.lost > 0 ? <span className="bad">−{r.lost}</span> : '—',
          siege: r.siege ? <span className="bad">нет</span> : <span className="good">да</span>,
        },
      },
    ];
  });
  if (list.length === 0) return null;
  return (
    <div className="gait-pick">
      <Table label="Режим марша" cols={COLS} rows={list} />
      <p className="nx-tnote">
        {GAIT_META[current].about}
        {current === 'light' ? ` Тает ${lightWasteWords()}; убыль в таблице — ожидание к приходу.` : ''}
        {free ? '' : ' Полководец не дома: режим меняют в окне отряда, стоянкой и энергией.'}
      </p>
    </div>
  );
}
