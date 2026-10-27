import { useGame } from '@/game/store';
import { buildingOfType, maxLevelFor, payGraceDays } from '@/game/derived';
import { STATUE_MORALE_TOP, statueCalm, statueMorale } from '@/game/statuerules';
import { statAt } from '@/game/train';
import { num } from '@/game/num';
import { Table, type Col } from '@/ui/kit/Table';
import { Row } from '@/ui/kit/Row';
import { Icon } from '@/ui/icons/Icon';
import type { IconName } from '@/ui/icons/alias';
import { waitDays } from './wait';

/**
 * Статуя Героя (ДР-7, docs/city_v3.md, «Решения ДР-7») — памятник, а не дом полководца: с ним она не связана. Что даёт — сейчас
 * и на следующем уровне, числами тех же дверей, что считают игру: мораль дружины — строка духа (`statuerules.statueMorale`,
 * `sim/spirit`), лад державы — сдвиг стабильности в день (`statueCalm`, `sim/stability`), терпение дружины без жалованья и еды —
 * дни Статуи (`derived.payGraceDays`, `train.statAt`). Своих чисел нет (правило 18). Всё о полководце — отметки, риск, отряд,
 * режим марша, родословная — в Ратуше, раздел «Агенты»; строка ниже ведёт туда.
 */
const COLS: readonly Col[] = [
  { key: 'what', title: 'Что даёт' },
  { key: 'now', title: 'Сейчас', align: 'right', w: '76px' },
  { key: 'next', title: 'Дальше', align: 'right', w: '76px' },
];

const plus = (n: number, digits: number): string => (n > 0 ? `+${num(n, digits)}` : '—');

export function Statue() {
  const s = useGame((g) => g.s);
  const openHall = useGame((g) => g.openTownHall);
  const level = buildingOfType(s, 'statue')?.level ?? 0;
  const top = level >= maxLevelFor('statue');
  const next = top ? null : level + 1;
  const rows: { key: string; icon: IconName; what: string; now: string; next: string; tip: string }[] = [
    {
      key: 'morale',
      icon: 'hud-army',
      what: 'Мораль дружины',
      now: plus(statueMorale(level), 1),
      next: next === null ? 'вершина' : plus(statueMorale(next), 1),
      tip: `Строка духа в «Дружине»: каждый уровень сверх первого поднимает мораль, на вершине — +${num(STATUE_MORALE_TOP, 1)} из 100, как лучший Воевода. Мораль — стойкость дружины в бою.`,
    },
    {
      key: 'calm',
      icon: 'ui-stability',
      what: 'Лад державы, % в день',
      now: plus(statueCalm(level), 2),
      next: next === null ? 'вершина' : plus(statueCalm(next), 2),
      tip: 'Тихий сдвиг стабильности вверх, вместе с ровной жизнью: раньше доводит до «Лада» и держит против сдвига вниз. Выше «Лада» сама стабильность не поднимается.',
    },
    {
      key: 'grace',
      icon: 'bld-statue',
      what: 'Терпит без жалованья',
      now: waitDays(payGraceDays(s)),
      next: next === null ? 'вершина' : waitDays(statAt('statue', 'loyalty', next)),
      tip: 'Сколько дружина ждёт жалованья и еды, прежде чем бойцы начнут уходить, даже без тебя.',
    },
  ];
  return (
    <>
      <h3>Что даёт Статуя</h3>
      <Table
        label="Что даёт Статуя"
        cols={COLS}
        rows={rows.map((r) => ({
          key: r.key,
          cells: {
            what: (
              <span className="kit-name">
                <Icon name={r.icon} />
                <span className="one-line">{r.what}</span>
              </span>
            ),
            now: <b>{r.now}</b>,
            next: <span className={next === null ? 'muted' : 'good'}>{r.next}</span>,
          },
          tip: () => ({ title: r.what, body: r.tip }),
        }))}
      />
      <p className="nx-tnote">
        {next === null ? 'Статуя на вершине.' : `«Дальше» — на ур. ${next}.`} Памятник растит дух дружины и лад державы; с полководцем он не
        связан.
      </p>
      {/* Полководец жил в Статуе до ДР-7: теперь его карточка — в Ратуше. Строка — дверь тем, кто привык искать его здесь. */}
      <Row icon="fig-general" label="Полководец" sub="Отметки, отряд и режим марша — в Ратуше, «Агенты»" go={() => openHall('agents')} goLabel="В Ратушу" />
    </>
  );
}
