import { useGame } from '@/game/store';
import { armySize, buildingOfType, upkeepInfo } from '@/game/derived';
import { UPKEEP_TEXT } from '@/game/data/upkeep';
import { Icon } from '@/ui/icons/Icon';
import { Row } from '@/ui/kit/Row';
import { Table, type Col } from '@/ui/kit/Table';
import { goTo, tipGo } from '@/ui/kit/nav';
import { WINDOW, sourceWord, toBuilding } from '@/ui/kit/sources';
import { armyTip, fmtInt, goldTip } from '@/ui/next/hudTips';
import { Recruit } from './Recruit';
import { waitDays } from './wait';
import { count } from './plural';
import { dec } from '@/game/num';
import type { IconName } from '@/ui/icons/alias';

/**
 * Казармы: найм пеших (`Recruit`; конницу нанимают в конюшне). Жалованье, мораль и дисциплина и роспуск — в «Дружине» (ДР-1,
 * docs/siege_v2.md, «Решения ДР-1»): там уже имеющееся войско, здесь — найм.
 *
 * Дружина и стены — строками-дверями в свои окна (Д8, docs/ui_v2.md, 5.7): прежде здесь стояли мощь, оборона второй раз
 * (после «К обороне города» выше) и свободные руки второй раз (их число — в полосе найма, «👤 N из M»). Оборона целиком —
 * в подсказке строки «К обороне города» и в «Дружине». Своей арифметики у панели нет: всё считает `derived.upkeepInfo`.
 */
export function Barracks() {
  const s = useGame((g) => g.s);
  const openBuilding = useGame((g) => g.openBuilding);
  const palisade = buildingOfType(s, 'palisade');

  return (
    <>
      {/* Найм — главное дело здания и потому первым (Р-3, docs/ui_v2.md): здесь пеших, конницу — в конюшне (`army.hiredAt`). */}
      <Recruit at="barracks" />

      <h3>Дружина</h3>
      <Row
        icon={'hud-army'}
        label="Дружина"
        sub={armySize(s) > 0 ? `${count(armySize(s), 'боец', 'бойца', 'бойцов')} · жалованье, дух, роспуск` : 'бойцов нет'}
        go={() => goTo(WINDOW.army)}
        goLabel={sourceWord(WINDOW.army)}
      />
      {/* Что стена выводит в поле и кто идёт на деревню — у стены, в разделе «Оборона», и оттуда же дверь к донесению о
          набеге. Второго экрана здесь нет — только дверь туда. */}
      {palisade && (
        <Row
          icon={'bld-palisade'}
          label="Стены"
          sub="кто идёт на город и кто стоит у стен"
          go={() => openBuilding(palisade.id)}
          goLabel="Стены"
        />
      )}

      {/* Жалованье, мораль и дисциплина, роспуск — в «Дружине» (ДР-1): здесь найм, там — уже имеющееся войско. */}
    </>
  );
}

/**
 * Жалованье: цена, которой держится войско, — в день против того, что даёт казна, долг и терпение. Один компонент: в «Дружине»
 * под выбором жалованья (`bare` — без своего заголовка, ДР-1). Таблицей (UI-8, docs/ui_v2.md, 5.7): жалованье — с разбором по
 * видам (подсказка дружины верха), доход — разбором золота и дверью в «Указы», терпение — дверью в Статую: его число
 * делает она (Д8). Своей арифметики нет: всё считает `derived.upkeepInfo`.
 */
export function Upkeep({ bare = false }: { bare?: boolean } = {}) {
  const s = useGame((g) => g.s);
  const up = upkeepInfo(s);
  const statue = buildingOfType(s, 'statue');
  const go = tipGo();
  const named = (icon: IconName, name: string) => (
    <span className="kit-name">
      <span className="ic">
        <Icon name={icon} />
      </span>
      <span className="one-line">{name}</span>
    </span>
  );
  const rows = [
    {
      key: 'army',
      cells: {
        what: named(UPKEEP_TEXT.icon, up.amnestyDays > 0 ? `Дружине · платить через ${waitDays(Math.ceil(up.amnestyDays))}` : 'Дружине'),
        n: <b className={up.masters === 0 && up.wages > up.income ? 'neg' : ''}>{fmtInt(Math.round(up.armyWages))}</b>,
      },
      tip: () => armyTip(s, go),
    },
    ...(up.masters > 0
      ? [
          {
            key: 'masters',
            cells: { what: named('ui-hammer', 'Мастерам'), n: dec(up.mastersWages, 1) },
            tip: () => ({ title: 'Мастерам', body: 'Наёмным мастерам мастерской платят золотом, как дружине.' }),
          },
        ]
      : []),
    {
      key: 'income',
      cells: { what: named('res-gold', 'Доход'), n: fmtInt(Math.round(up.income)) },
      tip: () => goldTip(s, go),
      go: () => goTo(WINDOW.gold),
      goLabel: `Доход: ${sourceWord(WINDOW.gold)}`,
    },
    ...(up.debt > 0
      ? [{ key: 'debt', cells: { what: named('ui-scroll', 'Долг дружине'), n: <b className="neg">{fmtInt(Math.round(up.debt))}</b> }, tip: () => ({ title: 'Долг', body: 'Недоплаченное жалованье дружине.' }) }]
      : []),
    {
      key: 'grace',
      cells: { what: named('bld-statue', 'Терпение'), n: waitDays(up.graceDays) },
      tip: () => ({ title: 'Терпение', body: 'Сколько дружина ждёт жалованья и еды, потом уходит, даже без тебя. Растёт с уровнем Статуи.' }),
      go: statue ? () => goTo(toBuilding('statue')) : undefined,
      goLabel: 'Терпение: Статуя Героя',
    },
  ];
  return (
    <>
      {!bare && <h3>Жалованье</h3>}
      <Table
        label="Жалованье"
        cols={UPKEEP_COLS}
        rows={rows}
        total={up.masters > 0 ? { what: 'Всего жалованья', n: <b className={up.wages > up.income ? 'neg' : ''}>{dec(up.wages, 1)}</b> } : undefined}
      />
      {up.why ? (
        <p className="note bad">
          {UPKEEP_TEXT.whoDat(up.armyWages > 0 || up.masters === 0, up.masters > 0)} {UPKEEP_TEXT.why[up.why]}.{' '}
          {up.leavingPerDay > 0
            ? `Уходят около ${Math.max(1, Math.round(up.leavingPerDay))} в день.`
            : `Уход через ${waitDays(Math.max(1, Math.ceil(up.graceDays - up.lateDays)))}.`}{' '}
          {up.why === 'pay'
            ? 'Подними налог или распусти лишних.'
            : 'Дружина ест после жителей. Уход встанет, когда еды хватит всем.'}
        </p>
      ) : up.treasuryDays !== null ? (
        <p className="note">Жалованье больше дохода. Золота хватит на {waitDays(Math.max(1, Math.ceil(up.treasuryDays)))}.</p>
      ) : null}
    </>
  );
}

const UPKEEP_COLS: readonly Col[] = [
  { key: 'what', title: 'Золото в день' },
  { key: 'n', title: '', align: 'right', w: '72px' },
];
