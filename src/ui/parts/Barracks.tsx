import { useState } from 'react';
import type { TroopId } from '@/game/types';
import { useGame } from '@/game/store';
import { TROOPS } from '@/game/data/troops';
import { armyPower, armySize, buildingOfType, upkeepInfo } from '@/game/derived';
import { dismissCheck } from '@/game/sim/upkeep';
import { dismissSoldiers } from '@/game/sim/actions';
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

/**
 * Казармы: найм пеших (`Recruit`; конницу нанимают в конюшне), жалованье и роспуск — всех видов, конных тоже:
 * распускают войско, а не здание.
 *
 * Дружина и стены — строками-дверями в свои окна (Д8, docs/ui_v2.md, 5.7): прежде здесь стояли мощь, оборона второй раз
 * (после «К обороне города» выше) и свободные руки второй раз (их число — в полосе найма, «👤 N из M»). Оборона целиком —
 * в подсказке строки «К обороне города» и в «Дружине». Своей арифметики у панели нет: всё считает `derived.upkeepInfo`.
 */
export function Barracks() {
  const s = useGame((g) => g.s);
  const openBuilding = useGame((g) => g.openBuilding);
  const act = useGame((g) => g.act);
  const [release, setRelease] = useState<Partial<Record<TroopId, number>>>({});
  const palisade = buildingOfType(s, 'palisade');

  return (
    <>
      <h3>Дружина</h3>
      <Row
        icon={{ name: 'hud-army', glyph: '⚔️' }}
        label="Дружина"
        sub={armySize(s) > 0 ? `${count(armySize(s), 'боец', 'бойца', 'бойцов')} · мощь ${fmtInt(Math.round(armyPower(s)))}` : 'бойцов нет'}
        go={() => goTo(WINDOW.army)}
        goLabel={sourceWord(WINDOW.army)}
      />
      {/* Что стена выводит в поле и кто идёт на деревню — у стены, в разделе «Оборона», и оттуда же дверь к донесению о
          набеге. Второго экрана здесь нет — только дверь туда. */}
      {palisade && (
        <Row
          icon={{ name: 'bld-palisade', glyph: '🛡️' }}
          label="Стены"
          sub="кто идёт на город и кто стоит у стен"
          go={() => openBuilding(palisade.id)}
          goLabel="Стены"
        />
      )}

      <Upkeep />

      {/* Найм — часть здания: здесь пеших, конницу — в конюшне (`army.hiredAt`). */}
      <Recruit at="barracks" />

      {armySize(s) > 0 && (
        <>
          <h3>Роспуск</h3>
          <p className="note">Бойцы станут жителями, снаряжение вернётся на склад, плата за найм пропадёт.</p>
          {TROOPS.filter((def) => (s.army[def.id] ?? 0) > 0).map((def) => {
            const n = Math.max(1, release[def.id] ?? 1);
            const check = dismissCheck(s, def.id, n);
            const set = (v: number): void =>
              setRelease((c) => ({ ...c, [def.id]: Math.max(1, Math.min(Math.max(1, check.max), v)) }));
            return (
              <div className="slot pick" key={def.id}>
                <span className="ico">
                  <Icon name={`troop-${def.id}`} glyph={def.icon} />
                </span>
                <span className="who">
                  {def.name} <i className="talent">гарнизон {check.max} · −{Math.round(check.saves)} золота в день</i>
                </span>
                <div className="stepper">
                  <button disabled={n <= 1} onClick={() => set(n - 1)}>
                    −
                  </button>
                  <span className="n">{n}</span>
                  <button disabled={n >= check.max} onClick={() => set(n + 1)}>
                    +
                  </button>
                </div>
                <button
                  className="mini text"
                  disabled={check.blocked !== null}
                  onClick={() => act((st) => dismissSoldiers(st, def.id, n))}
                >
                  распустить
                </button>
              </div>
            );
          })}
        </>
      )}
    </>
  );
}

/**
 * Жалованье: цена, которой держится войско, — в день против того, что даёт казна, долг и терпение. Один компонент на два
 * показа: в казармах и во вкладке «Армия» меню державы. Таблицей (UI-8, docs/ui_v2.md, 5.7): жалованье — с разбором по
 * видам (подсказка дружины верха), доход — разбором золота и дверью в «Указы», терпение — дверью в Статую: его число
 * делает она (Д8). Своей арифметики нет: всё считает `derived.upkeepInfo`.
 */
export function Upkeep() {
  const s = useGame((g) => g.s);
  const up = upkeepInfo(s);
  const statue = buildingOfType(s, 'statue');
  const go = tipGo();
  const named = (glyph: string, name: string, icon?: string) => (
    <span className="kit-name">
      {icon ? <Icon name={icon} glyph={glyph} /> : <span className="ic">{glyph}</span>}
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
            cells: { what: named('🔨', 'Мастерам'), n: dec(up.mastersWages, 1) },
            tip: () => ({ title: 'Мастерам', body: 'Наёмным мастерам мастерской платят золотом, как дружине.' }),
          },
        ]
      : []),
    {
      key: 'income',
      cells: { what: named('💰', 'Доход', 'res-gold'), n: fmtInt(Math.round(up.income)) },
      tip: () => goldTip(s, go),
      go: () => goTo(WINDOW.gold),
      goLabel: `Доход: ${sourceWord(WINDOW.gold)}`,
    },
    ...(up.debt > 0
      ? [{ key: 'debt', cells: { what: named('📜', 'Долг дружине'), n: <b className="neg">{fmtInt(Math.round(up.debt))}</b> }, tip: () => ({ title: 'Долг', body: 'Недоплаченное жалованье дружине.' }) }]
      : []),
    {
      key: 'grace',
      cells: { what: named('🗿', 'Терпение'), n: waitDays(up.graceDays) },
      tip: () => ({ title: 'Терпение', body: 'Сколько дружина ждёт жалованья и еды, потом уходит, даже без тебя. Растёт с уровнем Статуи.' }),
      go: statue ? () => goTo(toBuilding('statue')) : undefined,
      goLabel: 'Терпение: Статуя Героя',
    },
  ];
  return (
    <>
      <h3>Жалованье</h3>
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
