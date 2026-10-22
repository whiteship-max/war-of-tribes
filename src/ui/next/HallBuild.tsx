// Ратуша «Стройка» одной сеткой (docs/ui_v2.md, раздел 5, UI-2; находки П1, Д4, Ч7): весь город — плитки в три столбца,
// примерно квадрат экрана, а не лента карточек на четыре экрана. Плитка: значок с уровнем, имя, руки на местах, выход за
// день, метка «можно улучшить» и срок стройки. Группы — вкладками (еда, сырьё, война, жильё), порядок — одной кнопкой по
// кругу. Касание плитки открывает нижний лист постройки: рабочие, выход с разбором, улучшение и цена.
//
// Своих чисел нет (правило 18): плитка — `hall.ts`, разбор выхода — `output.ts`, цена и «можно ли» — `upgradeInfo`, что
// даст уровень — `upgradeGains`, срок — `buildRate`. Ряд рабочих — тот же, что в окне постройки (`BuildingNew.WorkerRow`),
// отмена — тот же `Confirm`. Ускорение — одной копией в окне постройки, за дверью «Открыть ›» (`kit/nav.goTo`; Д5,
// docs/ui_v2.md, 5.7). Лист самой ратуши в её окне «Улучшить» второй раз не рисует: кнопка — в шапке окна над ним (Д4).
//
// Очередь стройки (СТ-1, docs/ui_v2.md, «Решения СТ-1»): над сеткой — полоса очереди, места по порядку, у первого — срок;
// касание места — «Выше», «Ниже» и «Отменить» с возвратом словами. На плитке — номер места. Правила — одни с игрой и
// сервером: сдвиг `sim/actions.moveBlock`, возврат `labour.cancelRefund`, длина `BUILD_QUEUE_MAX`.
//
// «Показать в городе» (ОР-1, docs/ui_v2.md, 5.9) — меткой места в шапке листа: ратуша уходит, камера летит к постройке.
//
// Обучение ищет постройку по `data-tut="list-<тип>"` (шаг «Открой казармы»): метка стоит на плитке, а пока открыт её
// лист — на двери «Открыть ›» в нём, чтобы шаг вёл к окну, где нанимают.
import './hall.css';
import { create } from 'zustand';
import { useState } from 'react';
import type { Building } from '@/game/types';
import { useGame } from '@/game/store';
import { BUILDING_BY_ID, jobsOf } from '@/game/data/buildings';
import {
  buildQueue,
  buildRate,
  buildingById,
  buildingSlots,
  buildingTitle,
  isSite,
  maxLevelFor,
  queuePlace,
  storageCap,
  townHallBuildMult,
  upgradeInfo,
} from '@/game/derived';
import { cancelUpgrade, moveBlock, moveUpgrade, startUpgrade } from '@/game/sim/actions';
import { BUILD_QUEUE_MAX, RESOURCE_IDS } from '@/game/constants';
import { cancelRefund, cancelShare } from '@/game/labour';
import { asGame } from '@/game/pace';
import { dec, num } from '@/game/num';
import { Icon } from '@/ui/icons/Icon';
import { iconName } from '@/ui/icons/registry';
import { Cost } from '@/ui/parts/Cost';
import { shortNum } from '@/ui/parts/shortNum';
import { waitLeft, waitSpan } from '@/ui/parts/wait';
import { gainText, upgradeGains } from '@/ui/parts/upgrade';
import { Bar } from '@/ui/kit/Bar';
import { Btn } from '@/ui/kit/Btn';
import { Row } from '@/ui/kit/Row';
import { SheetPage, Tabs } from '@/ui/kit/SheetPage';
import { Table, type Col } from '@/ui/kit/Table';
import { goTo } from '@/ui/kit/nav';
import { showInCity } from './show';
import { toBuilding } from '@/ui/kit/sources';
import { Deeds, WorkerRow } from './BuildingNew';
import { buildingFacts, buildingTip } from './buildingTips';
import { Confirm } from './Confirm';
import { rate } from './hudTips';
import { HALL_GROUPS, HALL_SORTS, hallTiles, nextSort, sortTiles, type HallGroup, type HallSort, type HallTile } from './hall';
import { yardOutput, type YardOutput } from './output';

/** Что показано: группа и порядок. Живёт, пока жива партия на экране: вернулся в ратушу — вид тот же. */
export const useHallView = create<{ group: HallGroup | 'all'; sort: HallSort; setGroup: (g: HallGroup | 'all') => void; setSort: (s: HallSort) => void }>(
  (set) => ({
    group: 'all',
    // Как в прежнем списке: что строится, потом что можно заложить сейчас — ратушу открывают ради улучшений.
    sort: 'ready',
    setGroup: (group) => set({ group }),
    setSort: (sort) => set({ sort }),
  }),
);

const GROUP_TABS = [{ id: 'all' as const, label: 'Все' }, ...HALL_GROUPS.map((g) => ({ id: g.id, label: g.label }))];

export function HallBuild() {
  const s = useGame((g) => g.s);
  const group = useHallView((v) => v.group);
  const sort = useHallView((v) => v.sort);
  const setGroup = useHallView((v) => v.setGroup);
  const setSort = useHallView((v) => v.setSort);
  const [pick, setPick] = useState<number | null>(null);

  const rateNow = buildRate(s);
  const tiles = hallTiles(s);
  const shown = sortTiles(group === 'all' ? tiles : tiles.filter((t) => t.group === group), sort);
  // Подписи групп внутри сетки — только когда видны все группы их же порядком; иначе группа одна или порядок другой.
  const heads = group === 'all' && sort === 'group';
  const building = tiles.some((t) => t.state === 'site' || t.state === 'queued');
  const label = HALL_SORTS.find((x) => x.id === sort)?.label ?? '';

  return (
    <div className="hall">
      <div className="hall-top">
        <Row
          icon={'ui-hammer'}
          label="Скорость стройки"
          sub={`ратуша ×${dec(townHallBuildMult(s), 2)}`}
          value={dec(rateNow, 1)}
          tone="good"
          tip={() => ({
            title: `Скорость стройки ${dec(rateNow, 1)}`,
            body: `Строят свободные руки с площади и ремесленники Мастерской. Ратуша множит их труд: ×${dec(townHallBuildMult(s), 2)}.`,
          })}
        />
        <Btn onClick={() => setSort(nextSort(sort))} sub={label.toLowerCase()} label={`Порядок: ${label}`}>
          Порядок
        </Btn>
      </div>
      <HallQueue onOpen={setPick} />
      <Tabs tabs={GROUP_TABS} value={group} onChange={setGroup} />
      <div className="hall-grid">
        {shown.map((t, i) => (
          <HallCell key={t.b.id} t={t} head={heads && (i === 0 || shown[i - 1].group !== t.group)} tut={pick !== t.b.id} onPick={setPick} />
        ))}
      </div>
      {building && rateNow === 0 && <div className="note bad">Свободных рук нет, стройка стоит.</div>}
      {pick !== null && <HallCard id={pick} onClose={() => setPick(null)} />}
    </div>
  );
}

/** Подпись группы над её первой плиткой (во всю ширину сетки) и сама плитка. */
function HallCell({ t, head, tut, onPick }: { t: HallTile; head: boolean; tut: boolean; onPick: (id: number) => void }) {
  const g = HALL_GROUPS.find((x) => x.id === t.group)!;
  return (
    <>
      {head && (
        <div className="hall-head">
          <Icon name={g.icon} />
          {g.label}
        </div>
      )}
      <HallTileView t={t} tut={tut} onPick={onPick} />
    </>
  );
}

/** Выход на плитке — коротко: до сотни с десятой, дальше целым и тысячами (`shortNum`); ровно — в листе. */
const outText = (n: number): string => (n >= 100 ? shortNum(n) : num(n, 1));

/** Плитка постройки — кнопка 44+: касание открывает её лист. */
export function HallTileView({ t, tut, onPick }: { t: HallTile; tut: boolean; onPick: (id: number) => void }) {
  const def = BUILDING_BY_ID[t.b.type];
  const site = t.state === 'site' || t.state === 'queued';
  return (
    <button
      type="button"
      className={`hall-tile ${t.state}`}
      onClick={() => onPick(t.b.id)}
      data-tut={tut ? `list-${def.id}` : undefined}
      aria-label={`${t.name}, ур. ${t.level}${t.state === 'ready' ? ', можно улучшить' : ''}${t.place > 0 ? `, ${t.place}-е в очереди` : ''}`}
    >
      <span className="hall-ico">
        <Icon name={iconName('bld', def.id)} />
        <b className="hall-lvl">{t.level}</b>
      </span>
      <span className="hall-name one-line">{t.name}</span>
      {t.place > 0 && (
        <b className="hall-q" aria-label={`${t.place}-е в очереди`}>
          {t.place}
        </b>
      )}
      {t.state === 'ready' && (
        <i className="hall-up" aria-label="Можно улучшить">
          <Icon name={iconName('attn', 'upgrade')} />
        </i>
      )}
      <span className="hall-nums">
        {site ? (
          <span className="hall-eta">
            <Icon name="ui-site" />
            {t.state === 'queued' ? 'ждёт' : t.eta !== null ? waitLeft(t.eta) : 'нет рук'}
          </span>
        ) : (
          <>
            {t.hands !== null && (
              <span>
                <Icon name="ui-person" />
                {t.hands}/{t.slots}
              </span>
            )}
            {t.out && (
              <span className={t.out.perDay > 0 ? 'pos' : ''}>
                <Icon name={iconName('res', t.out.r)} />
                {outText(t.out.perDay)}
              </span>
            )}
          </>
        )}
      </span>
      {t.state === 'site' && (
        <i className="hall-bar">
          <i style={{ width: `${t.share}%` }} />
        </i>
      )}
    </button>
  );
}

// ---------- Нижний лист постройки ----------

/**
 * Лист постройки поверх сетки: рабочие, выход с разбором, улучшение и цена — то, ради чего в ратушу заходят. Остальное
 * (найм, ковка, вера, оборона) — во всём окне постройки, дверью «Открыть ›».
 */
export function HallCard({ id, onClose }: { id: number; onClose: () => void }) {
  const s = useGame((g) => g.s);
  const sheet = useGame((g) => g.sheet);
  const b = buildingById(s, id);
  if (!b) return null;
  const def = BUILDING_BY_ID[b.type];
  const top = b.level >= maxLevelFor(b.type);
  const gains = !top && !isSite(b) ? upgradeGains(s, b, b.level + 1) : null;
  // У двора с двумя делами разбор выхода — по делу, касанием по строке «В день» (`Deeds`): две таблицы листу не по росту.
  const many = jobsOf(b.type).length > 1;
  const out = many ? null : yardOutput(s, b);
  // Окно этой постройки уже открыто под листом (ратуша в ратуше) — двери в него нет.
  const here = sheet?.kind === 'building' && sheet.id === b.id;

  return (
    <>
      <div className="hall-veil" onClick={onClose} />
      <div className="hall-card" role="dialog" aria-label={buildingTitle(s, b.type)}>
        <SheetPage
          icon={iconName('bld', def.id)}
          title={buildingTitle(s, b.type)}
          sub={maxLevelFor(b.type) > 1 ? `ур. ${b.level}/${maxLevelFor(b.type)}` : `ур. ${b.level}`}
          about={() => buildingTip(s, b)}
          onClose={onClose}
          action={
            <>
              {/* «Показать в городе» (ОР-1): ратуша закрывается, камера летит к постройке и подсвечивает её. */}
              <Btn kind="link" onClick={() => showInCity(b.type)} label="Показать в городе">
                <Icon name="ui-pin" />
              </Btn>
              {!here && (
                <Btn kind="link" onClick={() => goTo(toBuilding(b.type))} tut={`list-${def.id}`}>
                  Открыть ›
                </Btn>
              )}
            </>
          }
          foot={here ? <OwnFoot b={b} /> : <UpgradeFoot b={b} />}
        >
          {many ? <Deeds b={b} gains={gains} /> : <WorkerRow b={b} gains={gains} />}
          {out ? <OutputTable out={out} /> : <Facts b={b} />}
          {gains && <div className="hall-gain">{gainText(gains)}</div>}
        </SheetPage>
      </div>
    </>
  );
}

/**
 * Полоса листа постройки, чьё окно открыто под листом (ратуша в ратуше, Д4): «Улучшить», цена, ускорение и отмена стоят в
 * шапке этого окна — здесь только где их искать.
 */
function OwnFoot({ b }: { b: Building }) {
  return <div className="hall-foot note">{isSite(b) ? 'Стройка, ускорение и отмена — выше, в этом окне.' : 'Улучшить — кнопкой выше, в шапке этого окна.'}</div>;
}

/** Полоса листа: цена и «Улучшить»; во время стройки — ход и отмена (ускорение — в окне, «Открыть ›»); на потолке — слово. */
function UpgradeFoot({ b }: { b: Building }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const rateNow = buildRate(s);
  if (isSite(b)) {
    const place = queuePlace(s, b);
    const eta = rateNow > 0 ? asGame(Math.ceil(Math.max(0, b.workRequired - b.work) / rateNow)) : null;
    const share = Math.floor((b.work / Math.max(1, b.workRequired)) * 100);
    return (
      <div className="hall-foot">
        <Bar
          value={share}
          max={100}
          label={`Стройка до ур. ${b.level + 1}`}
          text={place > 1 ? `ждёт, ${place}-е в очереди` : eta !== null ? `${share}% · ${waitSpan(eta)}` : `${share}% · нет строителей`}
        />
        <div className="hall-foot-acts">
          <RefundNote b={b} />
          <Confirm label="Отменить" onConfirm={() => act((st) => cancelUpgrade(st, b.id))} />
        </div>
      </div>
    );
  }
  const up = upgradeInfo(s, b);
  if (b.level >= maxLevelFor(b.type)) return <div className="hall-foot note">{up.blocked ?? 'Высший уровень.'}</div>;
  const eta = rateNow > 0 ? asGame(Math.ceil(up.work / rateNow)) : null;
  return (
    <div className="hall-foot row">
      <Cost cost={up.cost} />
      <Btn
        kind="main"
        onClick={() => act((st) => startUpgrade(st, b.id))}
        sub={eta !== null ? waitSpan(eta) : 'нет строителей'}
        why={up.blocked}
        tut={`upgrade-${b.type}`}
      >
        Улучшить
      </Btn>
    </div>
  );
}

// ---------- Очередь стройки (СТ-1) ----------

/**
 * Полоса очереди стройки над сеткой: места по порядку — номер и постройка; у первого — срок, у ждущих — до какого уровня. Касание места выбирает его: под полосой — «Выше», «Ниже», «Отменить» с возвратом словами и дверь в лист
 * постройки. Очереди нет — полосы нет.
 */
export function HallQueue({ onOpen }: { onOpen: (id: number) => void }) {
  const s = useGame((g) => g.s);
  const [sel, setSel] = useState<number | null>(null);
  const queue = buildQueue(s);
  if (queue.length === 0) return null;
  const rateNow = buildRate(s);
  const picked = queue.find((b) => b.id === sel) ?? null;
  return (
    <div className="hall-queue" role="group" aria-label="Очередь стройки">
      <div className="hall-queue-head">
        <Icon name="ui-site" />
        Очередь стройки
        <span>
          {queue.length}/{BUILD_QUEUE_MAX}
        </span>
      </div>
      <div className="hall-queue-row">
        {queue.map((b, i) => {
          const eta = i === 0 && rateNow > 0 ? asGame(Math.max(0, b.workRequired - b.work) / rateNow) : null;
          return (
            <button
              key={b.id}
              type="button"
              className={`hall-qcell${i === 0 ? ' first' : ''}${picked?.id === b.id ? ' on' : ''}`}
              aria-pressed={picked?.id === b.id}
              aria-label={`${i + 1}. ${buildingTitle(s, b.type)}, до ур. ${b.level + 1}`}
              onClick={() => setSel(picked?.id === b.id ? null : b.id)}
            >
              <b className="hall-qn">{i + 1}</b>
              <Icon name={iconName('bld', b.type)} />
              <span className="hall-qeta">{i > 0 ? `ур. ${b.level + 1}` : eta !== null ? waitLeft(eta) : 'нет рук'}</span>
              {i === 0 && (
                <i className="hall-bar">
                  <i style={{ width: `${Math.floor((b.work / Math.max(1, b.workRequired)) * 100)}%` }} />
                </i>
              )}
            </button>
          );
        })}
      </div>
      {picked && <QueueActs b={picked} onOpen={onOpen} />}
    </div>
  );
}

/** Под полосой — дела выбранного места: сдвиг выше и ниже (погасшая — с причиной), отмена с возвратом, лист постройки. */
export function QueueActs({ b, onOpen }: { b: Building; onOpen: (id: number) => void }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  return (
    <div className="hall-qacts">
      <Btn kind="link" onClick={() => onOpen(b.id)} label={`${buildingTitle(s, b.type)}: лист постройки`}>
        {buildingTitle(s, b.type)} ›
      </Btn>
      <div className="hall-qbtns">
        <Btn onClick={() => act((st) => moveUpgrade(st, b.id, -1))} why={moveBlock(s, b.id, -1)}>
          Выше
        </Btn>
        <Btn onClick={() => act((st) => moveUpgrade(st, b.id, 1))} why={moveBlock(s, b.id, 1)}>
          Ниже
        </Btn>
        <Btn confirm onClick={() => act((st) => cancelUpgrade(st, b.id))} sub={b.work > 0 ? 'вернёт половину' : 'вернёт всё'}>
          Отменить
        </Btn>
      </div>
      <RefundNote b={b} />
    </div>
  );
}

/**
 * Что вернёт отмена — числами той же функции, что вернёт склад (`labour.cancelRefund`): начатое — половину цены, ждущее —
 * всю. Склад полон — сверх вместимости не ляжет (`sim/pay.refund`), и это сказано.
 */
export function RefundNote({ b }: { b: Building }) {
  const s = useGame((g) => g.s);
  const started = b.work > 0;
  const back = cancelRefund(BUILDING_BY_ID[b.type], b.level + 1, started);
  const parts = RESOURCE_IDS.filter((r) => (back[r] ?? 0) > 0);
  if (parts.length === 0) return null;
  return (
    <div className="hall-refund">
      <span>Отмена вернёт {cancelShare(started) < 1 ? 'половину' : 'всё'}:</span>
      {parts.map((r) => (
        <span key={r} className="pos">
          <Icon name={iconName('res', r)} />+{num(back[r] ?? 0)}
        </span>
      ))}
      {parts.some((r) => (s.resources[r] ?? 0) + (back[r] ?? 0) > storageCap(s)) && <span className="bad">сверх склада не ляжет</span>}
    </div>
  );
}

/** Выход двора за игровой день: строки разбора складываются в итог (`output.ts`). */
export function OutputTable({ out }: { out: YardOutput }) {
  if (out.steps.length === 0) return <div className="note">Нет рабочих. Поставь людей на места.</div>;
  const cols: Col[] = [
    { key: 'name', title: 'Выход в день' },
    { key: 'f', title: '×', align: 'right', w: '44px' },
    ...out.res.map((r) => ({ key: r, title: <Icon name={iconName('res', r)} />, align: 'right' as const })),
  ];
  const rows = out.steps.map((st, i) => ({
    key: `${st.id}-${i}`,
    cells: {
      name: st.label,
      f: st.factor === null ? '' : `×${dec(st.factor, 2)}`,
      ...Object.fromEntries(out.res.map((r) => [r, rate(st.add[r] ?? 0)])),
    },
  }));
  const total = { name: 'Итого', f: '', ...Object.fromEntries(out.res.map((r) => [r, rate(out.total[r] ?? 0)])) };
  return <Table cols={cols} rows={rows} total={total} label="Выход в день" />;
}

/**
 * Не двор и без мест: что постройка даёт городу — одной строкой чисел игры (`buildingFacts`), как в подсказке значка. У
 * постройки с местами эта строка — «Рабочих: N/M», а их уже говорит ряд рабочих над ней.
 */
function Facts({ b }: { b: Building }) {
  const s = useGame((g) => g.s);
  if (buildingSlots(b) > 0) return null;
  const facts = buildingFacts(s, b);
  if (!facts) return null;
  return <div className="hall-facts">{facts}</div>;
}
