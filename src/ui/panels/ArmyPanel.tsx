// «Дружина» из строки состояния и низа (ДР-1, docs/siege_v2.md, «Решения ДР-1»): уже имеющееся войско — не найм. Сверху мощь
// обороны и где бойцы, дальше три вкладки (ДР-8, docs/ui_v2.md, «Решения ДР-8»): «Состав» — плитки видов (касание — карточка
// вида поверх меню: дома и в походе, жалованье вида и роспуск, `parts/KindCard`), новобранцы, «Командующие» и двери найма;
// «Дух» — мораль и дисциплина с разбором «что влияет» и черты армии; «Жалованье» — полное или минимальное и ведомость.
// Нанимают в Казармах и Конюшне: здесь к ним кнопки-двери. Раскладки «Гарнизон | Отряд» здесь нет (ДР-6, «Решения ДР-6»):
// состав отряда полководца выбирают в окне дела (`map/ArmySend`), а в городе он ведёт оборону всем гарнизоном. Мощь войска — в
// заголовке, бойцы — ячейками верха, жалованье в день — строкой «Дружине» ведомости (`Upkeep`). Виды, которых в дружине нет, —
// значками под дверями найма: карточка вида одна. Кольца контров нет (слово владельца по 14.35, docs/battle_eu4.md): кто кого
// бьёт, решают показатели.
import { Suspense, lazy, useState } from 'react';
import type { TroopId } from '@/game/types';
import { useGame } from '@/game/store';
import { TROOPS } from '@/game/data/troops';
import { armyPower, armySize, buildingOfType, defense, homeArmy, recruitsQueued, upkeepInfo } from '@/game/derived';
import { useWorld, worldNow } from '@/world/store';
import { restLine } from '../parts/restWords';
import { TroopCardView } from '../parts/TroopCardView';
import { inWallsTip, outWallsTip } from '../parts/Muster';
import { Roster, SpiritCard, WageChoice, rosterTiles } from '../parts/ArmyDesk';
import { KindCard } from '../parts/KindCard';
import { Upkeep } from '../parts/Barracks';
import { Icon } from '@/ui/icons/Icon';
import { Num } from '@/ui/kit/Num';
import { Tabs, type TabDef } from '@/ui/kit';
import { defenseTip, fmtInt, type TipGo } from '@/ui/next/hudTips';
import { goTo } from '@/ui/kit/nav';
import { dec } from '@/game/num';
import { iconName } from '@/ui/icons/registry';
import { CommandLine } from '../parts/CommandLine';
import { ScarList } from '../parts/Scars';

// Меню «Командующие» (ДР-3) — своим куском, по кнопке: первой загрузке оно не нужно.
const CommandDesk = lazy(() => import('@/ui/next/CommandDesk').then((m) => ({ default: m.CommandDesk })));

/** Вкладки окна (ДР-8): состав — первой, на ней окно и открывается. */
export type ArmyTab = 'roster' | 'spirit' | 'wage';

export function ArmyPanel({ start = 'roster' }: { start?: ArmyTab }) {
  const s = useGame((g) => g.s);
  const openBuilding = useGame((g) => g.openBuilding);
  const [tab, setTab] = useState<ArmyTab>(start);
  const [open, setOpen] = useState<TroopId | null>(null);
  const [pick, setPick] = useState<TroopId | null>(null);
  const [desk, setDesk] = useState(false);
  const marches = useWorld((g) => g.marches);
  const figures = useWorld((g) => g.figures);
  const barracks = buildingOfType(s, 'barracks');
  const stable = buildingOfType(s, 'stable');
  const home = homeArmy(s);
  const away = armySize(s) - home;
  const training = recruitsQueued(s);
  const general = figures.find((f) => f.id === 'general');

  if (open) return <TroopCardView troop={open} onBack={() => setOpen(null)} />;
  if (desk) {
    return (
      <Suspense fallback={<div className="panel" />}>
        <CommandDesk onBack={() => setDesk(false)} />
      </Suspense>
    );
  }

  const go: TipGo = {
    tab: (t) => goTo({ kind: 'tab', tab: t }),
    building: openBuilding,
    realm: (v) => goTo({ kind: 'realm', view: v }),
    to: goTo,
  };

  // Виды без плитки — значками под дверями найма: вид с одними ранеными уже стоит плиткой, второй двери ему не нужно.
  const tiled = new Set(rosterTiles(s).map((t) => t.id));
  const unhired = TROOPS.filter((d) => !tiled.has(d.id));
  // Ведомость в беде (не плачено или нечем кормить) — отметка на вкладке «Жалованье», как счётчик «ждёт действия».
  const tabs: readonly TabDef<ArmyTab>[] = [
    { id: 'roster', label: 'Состав', icon: 'hud-army' },
    { id: 'spirit', label: 'Дух', icon: 'ui-banner' },
    { id: 'wage', label: 'Жалованье', icon: 'res-gold', badge: upkeepInfo(s).why ? 1 : 0 },
  ];

  return (
    <div className="panel">
      <h2>
        <Icon name="hud-army" /> Дружина <small>мощь {Math.round(armyPower(s))}</small>
      </h2>

      {/* Три числа одной строкой ячеек (docs/ui_v2.md, 2.1): мощь обороны, бойцы в городе и в походе — каждое с подсказкой.
          Единица названа в подписи: прежде «Оборона 1264 | В обороне 127 | Не в обороне 980» ставило мощь в ряд с головами
          (отзыв тестеров 18.10, docs/feedback.md). */}
      <div className="ms-sum">
        {/* Разбор обороны — тот же, что у строки «Оборона» сводки «Жителей» (`hudTips.defenseTip`, UI-5). */}
        <Num label="Мощь обороны" tip={() => defenseTip(s, go)}>
          <small>Мощь обороны</small>
          <b className="good">{dec(defense(s), 0)}</b>
        </Num>
        <Num label="Бойцов в городе" tip={() => inWallsTip(s, marches, figures)}>
          <small>Бойцов в городе</small>
          <b>{fmtInt(home)}</b>
        </Num>
        <Num label="Бойцов в походе" tip={() => outWallsTip(s)}>
          <small>Бойцов в походе</small>
          <b className={away > 0 ? 'bad' : ''}>{fmtInt(away)}</b>
        </Num>
      </div>

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'roster' && (
        <>
          {/* Состав плитками (ДР-8): касание — карточка вида поверх меню, роспуск — в ней. */}
          <Roster onPick={setPick} />
          {training > 0 && (
            <div className="mod">
              <span className="ico">
                <Icon name="ui-target" />
              </span>
              <span className="name">Новобранцы на учениях</span>
              <span className="val">{training}</span>
            </div>
          )}

          {/* Командиры флангов (ДР-3): кто ведёт левый и правый фланг в отряде полководца; найм и смена — меню «Командующие». */}
          <h3>Командующие</h3>
          <CommandLine onOpen={() => setDesk(true)} />

          {/* Найм — в Казармах (пешие) и Конюшне (конница): здесь только двери туда (ДР-1). */}
          <h3>Найм</h3>
          <div className="dr-hire">
            {barracks && (
              <button type="button" className="btn wide" onClick={() => openBuilding(barracks.id)}>
                <Icon name="bld-barracks" /> Казармы <small>пешие</small>
              </button>
            )}
            {stable && (
              <button type="button" className="btn wide" onClick={() => openBuilding(stable.id)}>
                <Icon name="bld-stable" /> Конюшня <small>конница</small>
              </button>
            )}
          </div>
          {unhired.length > 0 && (
            <div className="ms-more" aria-label="Виды, которых в дружине нет">
              {unhired.map((d) => (
                <button type="button" key={d.id} className="ms-more-b" onClick={() => setOpen(d.id)} aria-label={`${d.name}: карточка вида`}>
                  <Icon name={iconName('troop', d.id)} />
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'spirit' && (
        <>
          {/* Дух — мораль и дисциплина (ДР-1): главные множители силы в бою, с разбором «что влияет» строками. */}
          <SpiritCard />
          {general?.rest && <div className="note warn">{restLine(general.rest, 'Отряд дрался', worldNow())}</div>}
          {/* Черты армии (ДР-4): шрамы и привычки по журналу боёв — как получены, что дают, как уходят; разом не больше трёх. */}
          <h3>Черты</h3>
          <ScarList />
        </>
      )}

      {tab === 'wage' && (
        <>
          {/* Жалованье (ДР-1): полное или минимальное; ведомость, доход, долг и терпение — тем же `Upkeep`, что прежде в казармах. */}
          <WageChoice />
          <Upkeep bare />
        </>
      )}

      {/* Карточка вида поверх меню (ДР-8): «Всё о виде» — полная карточка вместо окна, как дверь вида до ДР-8. */}
      <KindCard
        troop={pick}
        onClose={() => setPick(null)}
        onMore={(t) => {
          setPick(null);
          setOpen(t);
        }}
      />
    </div>
  );
}
