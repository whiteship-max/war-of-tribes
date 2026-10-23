// Окно осады глазами осаждающего: наш лагерь под чужим городом. Открывается по лагерю —
// из карточки города и из меню полководца, — и собирает в одно место то, что было
// разбросано по ним: чей город и чем держится, сколько ему хлеба, как растут стороны
// лагеря, как делить древесину, какую участь объявить и что приказать.
//
// Своей арифметики у окна нет. Хлеб — мировые часы (`starvesAt`), стороны лагеря — та
// же `throughWorks`, что у боя (`works.campSides`), доли древесины — приказом мира
// (`setWood`), строки участи — дверь участи на тех же числах (`CampView.fates`).
import { useEffect, useState } from 'react';
import { useGame } from '@/game/store';
import { useWorld, worldNow } from '@/world/store';
import { realLeft, realMinutes } from '@/ui/parts/wait';
import { REST_WHY, restLine } from '@/ui/parts/restWords';
import { hungerLeft } from '@/ui/parts/hunger';
import { sideReady } from '@/ui/parts/campSide';
import { formatEstimate } from '@/world/intel';
import { CAMP_LEAVE, STORM_HOLDS } from '@/world/siege';
import { MACHINE_SHARES, type MachineId } from '@/world/data/machines';
import { SIEGE_PHASE } from '@/world/data/siegeroll';
import { FATE_META } from '@/world/data/fates';
import { STAGE_BY_ID } from '@/world/data/meta';
import { SIDES, SIDE_NAME, WOOD_SHARES, campSides, machineShare, playerWood, woodShare, worksRipeAt } from '@/world/works';
import type { CampMelt, CampView, Fate } from '@/world/types';
import { cutFood, meltShort, ratioBound } from '@/world/siegewords';
import { FatePick } from '@/ui/parts/FatePick';
import { plural } from '@/ui/parts/plural';
import { SiegePhases } from '@/ui/parts/SiegePhases';
import { SiegeParley } from '@/ui/parts/SiegeParley';
import { EnergyPrice } from '@/ui/parts/Energy';
import { BREACH_MAX } from '@/world/data/siegeroll';
import { Table, type Col } from '@/ui/kit/Table';
import { Tabs, type TabDef } from '@/ui/kit/SheetPage';
import { Btn } from '@/ui/kit/Btn';
import { Toggle } from '@/ui/kit/Toggle';
import './siege.css';
import { Icon } from '@/ui/icons/Icon';
import { num } from '@/game/num';
import { aimShort } from '@/world/shelling';
import { iconName } from '@/ui/icons/registry';

/**
 * Сроки из подсказки к долям — той же функцией, которой считаются стороны: при
 * другой древесине подсказка поменяется сама, а не станет неправдой.
 */
const WOOD_ALL_FRONT = realMinutes(worksRipeAt(0, 'front', playerWood(1)));

/** Как доля фронту называется на кнопке. */
/** Доля древесины машинам словами на кнопке. */
const MACHINE_SHARE_NAME: Record<number, string> = { 0: 'Ничего', 0.25: 'Четверть', 0.5: 'Половину', 0.75: 'Три четверти', 1: 'Всё' };

/** Состояние машины словами: стоит, строится (через сколько), не строится. */
function machineState(e: NonNullable<CampView['machines']>['list'][number], now: number): string {
  if (e.state === 'ready') return 'готова';
  if (e.state === 'none') return 'не заказана';
  if (e.readyAt === undefined || !Number.isFinite(e.readyAt)) return 'не строится: машинам не отдано леса';
  const left = Math.max(0, e.readyAt - now);
  return `готова через ${realLeft(left / 1000)} (${Math.max(1, Math.ceil(left / SIEGE_PHASE))} ${plural(Math.max(1, Math.ceil(left / SIEGE_PHASE)), 'фаза', 'фазы', 'фаз')})`;
}

const SHARE_NAME: Record<number, string> = {
  1: 'Всё к городу',
  0.75: 'Три четверти',
  0.5: 'Поровну',
  0.25: 'Четверть',
  0: 'Всё в тыл',
};

/** Выручка, идущая на лагерь, словами: кто, сколько и когда ударит. Числа — из мира (`CampView.relief`). */
export function reliefLine(r: NonNullable<CampView['relief']>, now: number): string {
  const left = realLeft(Math.max(0, (r.at - now) / 1000));
  return `На лагерь идёт выручка: «${r.from}», ${r.men} ${plural(r.men, 'боец', 'бойца', 'бойцов')}. Ударит через ${left}${
    r.joint ? ', гарнизон выйдет навстречу' : ''
  }.`;
}

/**
 * Когда штраф к полям города упадёт к среднему (ОС-1б) — словами окна: число фаз — дверью хлеба (`CampMelt.toEven`), срок — до
 * минуты шага, названной миром (`evenAt`).
 */
export function evenLine(m: CampMelt, now: number): string {
  if (m.toEven === null) return 'не упадёт';
  if (m.toEven === 0) return 'уже средний';
  const left = realLeft(Math.max(0, ((m.evenAt ?? now) - now) / 1000));
  return `${m.bound === 'min' ? 'не раньше ' : ''}через ${m.toEven} ${plural(m.toEven, 'фазу', 'фазы', 'фаз')}, ~${left}`;
}

/** Почему лагерь тает и что с этим делать (ОС-1б) — без чисел: числа в строках. */
const MELT_WHY =
  'Каждую фазу из лагеря уходит доля бойцов: дальше от дома — больше, пустой амбар дома — вдвое, мор и попадание требушета со стены — ещё доля. Пополнить лагерь нельзя: дружина стоит тем составом, с которым вышла. Чем слабее лагерь против гарнизона, тем больше хлеба город берёт с полей, и при среднем штрафе голод приходит втрое позже.';

type View = 'camp' | 'machines' | 'ring' | 'phases' | 'storm';

/** Столбцы окна лагеря (UI-7, docs/ui_v2.md, 5.6): строки `.mod` и ряды кнопок `.mini` — таблицами набора. */
const TARGET_COLS: readonly Col[] = [
  { key: 'what', title: 'Цель' },
  { key: 'v', title: 'Сейчас', align: 'right', w: '104px' },
];
const MELT_COLS: readonly Col[] = [
  { key: 'what', title: 'Поля города' },
  { key: 'v', title: 'Сейчас', align: 'right', w: '128px' },
];
const SIDE_COLS: readonly Col[] = [{ key: 'side', title: 'Стороны лагеря' }];
const WOOD_COLS: readonly Col[] = [
  { key: 'share', title: 'Лес на рогатки' },
  { key: 'front', title: 'Город за', align: 'right', w: '72px' },
  { key: 'rear', title: 'Тыл за', align: 'right', w: '72px' },
];
const MSHARE_COLS: readonly Col[] = [{ key: 'share', title: 'Лес машинам' }];
const MACHINE_COLS: readonly Col[] = [
  { key: 'm', title: 'Машина' },
  { key: 'act', title: '', align: 'right', w: '96px' },
];
const AIM_COLS: readonly Col[] = [{ key: 'aim', title: 'Куда бьют машины' }];
const RING_COLS: readonly Col[] = [
  { key: 'what', title: 'Кольцо блокады' },
  { key: 'v', title: 'Сейчас', align: 'right', w: '104px' },
];
const CRAFT_COLS: readonly Col[] = [
  { key: 'c', title: 'Дело' },
  { key: 'done', title: 'Сделано', align: 'right', w: '64px' },
  { key: 'act', title: '', align: 'right', w: '96px' },
];

/** Срок дозревания стороны с нуля при этой доле — та же функция, что считает стороны (`worksRipeAt`); никогда — «—». */
export function ripeWords(share: number, machines: number): { front: string; rear: string } {
  const plan = playerWood(share, machines);
  const at = (side: 'front' | 'rear'): string => {
    const ms = worksRipeAt(0, side, plan);
    return Number.isFinite(ms) ? realMinutes(ms) : '—';
  };
  return { front: at('front'), rear: at('rear') };
}

export function CampPanel() {
  const showToast = useGame((g) => g.showToast);
  const closeSheet = useGame((g) => g.closeSheet);
  const camp = useWorld((g) => g.camp);
  const loadCamp = useWorld((g) => g.loadCamp);
  const besiege = useWorld((g) => g.besiege);
  const attack = useWorld((g) => g.attack);
  const retreat = useWorld((g) => g.retreat);
  const setWood = useWorld((g) => g.setWood);
  const setMachineWood = useWorld((g) => g.setMachineWood);
  const orderMachine = useWorld((g) => g.orderMachine);
  const aimArtillery = useWorld((g) => g.aimArtillery);
  const blockade = useWorld((g) => g.blockade);
  const [use, setUse] = useState<MachineId[] | null>(null);
  const campCraft = useWorld((g) => g.campCraft);
  const setOrders = useWorld((g) => g.setOrders);
  const [pick, setPick] = useState<Fate | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>('camp');
  const [, retick] = useState(0);

  useEffect(() => {
    void loadCamp();
  }, [loadCamp]);

  useEffect(() => {
    if (!camp) return;
    const t = setInterval(() => retick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [camp]);

  if (!camp) {
    return (
      <div className="panel">
        <div className="bhead">
          <div className="ico"><Icon name="stage-camp" /></div>
          <div className="body">
            <div className="name">Лагеря нет</div>
          </div>
        </div>
        <p className="note">Осаду ставит полководец у чужих стен.</p>
      </div>
    );
  }

  const now = worldNow();
  const sides = campSides(camp, now);
  const share = woodShare(camp.wood);
  const machines = machineShare(camp.wood);
  const chosen = pick ?? camp.fate;
  const option = camp.fates.find((o) => o.id === chosen) ?? null;
  const stage = STAGE_BY_ID[camp.stage];
  const kind = camp.castle ? 'Город соседа' : camp.lair ? 'Логово' : stage.name;
  const walls = camp.castle ? 'держит гарнизон' : 'без стен';

  const order = async (fn: () => Promise<string | null>, done: string, close = false): Promise<void> => {
    setBusy(true);
    const err = await fn();
    setBusy(false);
    showToast(err ?? done);
    if (!err && close) closeSheet();
  };

  const sameFate = chosen === camp.fate;
  const cantFate = option && !option.can ? option.reason : null;
  // Вкладки (П4: окно лагеря было длиннейшим в игре — 2,6 экрана на стенде): лагерь и лес — первой, машины, ход фаз с
  // переговорами и штурм — своими. Предложение, ждущее ответа, — счётчиком на «Ходе».
  const tabs: TabDef<View>[] = [
    { id: 'camp', label: 'Лагерь' },
    ...(camp.machines ? [{ id: 'machines' as const, label: 'Машины' }] : []),
    ...(camp.blockade ? [{ id: 'ring' as const, label: 'Кольцо' }] : []),
    ...(camp.phases || camp.parley ? [{ id: 'phases' as const, label: 'Ход', badge: camp.parley?.incoming ? 1 : 0 }] : []),
    { id: 'storm', label: 'Штурм' },
  ];
  const shown = tabs.some((t) => t.id === view) ? view : 'camp';
  const methods = camp.machines?.methods ?? [];
  const aimWeight = (camp.aim?.artillery ?? []).reduce((n, a) => n + a.weight, 0);
  const using = use ?? methods.map((x) => x.machine);

  return (
    <div className="panel sg">
      <div className="bhead">
        <div className="ico"><Icon name={camp.castle ? 'stage-castle' : iconName('stage', stage.id)} /></div>
        <div className="body">
          <div className="name one-line">{camp.targetName}</div>
          <div className="lvl">
            {kind} · {walls}
          </div>
        </div>
      </div>
      <Tabs tabs={tabs} value={shown} onChange={setView} />

      {shown === 'camp' && (
        <>
          <Table
            label="Цель"
            cols={TARGET_COLS}
            rows={[
              { key: 'power', cells: { what: 'Мощь гарнизона', v: <span className={camp.power.precision === 'unknown' ? 'bad' : ''}>{formatEstimate(camp.power)}</span> } },
              { key: 'food', cells: { what: 'Еды хватит на', v: <b className="good">{hungerLeft(camp.starvesAt, now)}</b> } },
              {
                key: 'garrison',
                // Гарнизон — той же точностью, что мощь: точное число знает только разведка (docs/siege_audit.md, 10).
                tip: () => ({ title: 'Гарнизон ест вместе с городом', body: 'Чем больше гарнизон, тем быстрее кончится хлеб. Точное число — только с разведки.' }),
                cells: { what: 'Гарнизон ест вместе с городом', v: <span className={camp.garrison.precision === 'unknown' ? 'bad' : ''}>{formatEstimate(camp.garrison)}</span> },
              },
              { key: 'since', cells: { what: 'Лагерь стоит', v: realLeft(Math.max(0, (now - camp.since) / 1000)) } },
            ]}
          />
          {/* Лагерь тает (ОС-1б): соотношение, по которому сервер режет поля города, доля за фазу и когда штраф станет средним. */}
          {camp.melt && (
            <Table
              label="Поля города"
              cols={MELT_COLS}
              rows={[
                { key: 'ratio', tip: () => ({ title: 'Лагерь против гарнизона', body: MELT_WHY }), cells: { what: 'Лагерь против гарнизона', v: ratioBound(camp.melt.ratio, camp.melt.bound) } },
                { key: 'cut', cells: { what: 'Добыча хлеба у города', v: <b className="good">{cutFood(camp.melt.cut)}</b> } },
                { key: 'waste', tip: () => ({ title: 'Лагерь тает', body: MELT_WHY }), cells: { what: 'Лагерь тает', v: <span className="bad">{meltShort(camp.melt.waste)}</span> } },
                { key: 'even', tip: () => ({ title: 'Штраф к среднему', body: MELT_WHY }), cells: { what: 'Штраф станет средним', v: evenLine(camp.melt, now) } },
              ]}
            />
          )}
          {/* Выручка, идущая на лагерь (siege_audit, 6): у логова — отряд соседей по донесению, у города игрока — его полководец. */}
          {camp.relief && <p className="note bad">{reliefLine(camp.relief, now)}</p>}
          <Table
            label="Стороны лагеря"
            cols={SIDE_COLS}
            rows={SIDES.map((side) => ({
              key: side,
              cells: {
                side: (
                  <span className="kit-two">
                    <b className="one-line">{SIDE_NAME[side]}</b>
                    <small className="one-line">{sideReady(sides[side], now)}</small>
                  </span>
                ),
              },
            }))}
          />
          {/* Под городом соседа древесину не делят: строк, которые только отказывают, нет — есть строка (siege_audit, 3). */}
          {camp.woodFixed ? (
            <p className="note">
              {camp.woodFixed} Сторона города дозреет за {WOOD_ALL_FRONT}.
            </p>
          ) : (
            <>
              <Table
                label="Лес на рогатки"
                cols={WOOD_COLS}
                rows={WOOD_SHARES.map((sh) => {
                  const r = ripeWords(sh, machines);
                  return {
                    key: String(sh),
                    on: share === sh,
                    pick: () => share !== sh && !busy && void order(() => setWood(sh), `Древесина: ${SHARE_NAME[sh].toLowerCase()}.`),
                    cells: { share: SHARE_NAME[sh], front: r.front, rear: r.rear },
                  };
                })}
              />
              <p className="note">Сроки — с пустого места при этой доле. Вложенное не пропадает.</p>
            </>
          )}
          {/* Мораль между боями (14.31): наш лагерь — дружина; после вылазки штурмовать сразу — уставшими. */}
          {camp.campRest && (
            <p className="note warn">
              {restLine(camp.campRest, 'Лагерь дрался', now)} {REST_WHY}
            </p>
          )}
        </>
      )}

      {/* Осадные машины из древесины лагеря (world/machines, docs/siege_v2.md, 4.3): доля леса, очередь, отказ — из мира. */}
      {shown === 'machines' && camp.machines && (
        <>
          <Table
            label="Лес машинам"
            cols={MSHARE_COLS}
            rows={MACHINE_SHARES.map((sh) => ({
              key: String(sh),
              on: camp.machines?.share === sh,
              pick: () => camp.machines?.share !== sh && !busy && void order(() => setMachineWood(sh), `Машинам: ${MACHINE_SHARE_NAME[sh].toLowerCase()}.`),
              cells: { share: MACHINE_SHARE_NAME[sh] },
            }))}
          />
          <p className="note">Остальное идёт на рогатки.</p>
          <Table
            label="Машины"
            cols={MACHINE_COLS}
            rows={camp.machines.list.map((e) => ({
              key: e.id,
              cells: {
                m: (
                  <span className="kit-two">
                    <b className="one-line">
                      {e.name} · {machineState(e, now)}
                    </b>
                    <small className={e.can || e.state !== 'none' ? '' : 'bad'}>{e.state === 'none' && e.reason ? e.reason : e.use}</small>
                  </span>
                ),
                act:
                  e.state === 'none' ? (
                    <Btn why={!e.can ? 'Нельзя' : busy ? '…' : null} onClick={() => void order(() => orderMachine(e.id), `${e.name}: заказано.`)}>
                      Заказать
                    </Btn>
                  ) : null,
              },
            }))}
          />
          {/* Цена машины — лес лагеря: доля стороны, той же мерой, что очередь (`MACHINE_WOOD`). */}
          <p className="note">Цена — лес лагеря: {camp.machines.list.map((e) => `${e.name.toLowerCase()} ${num(e.wood)} стороны`).join(', ')}.</p>
          {/* Куда бьют камнемёт и требушет (Р-5, world/shelling): что даст каждая цель — до нажатия, словами мира. */}
          {camp.aim && (
            <>
              <Table
                label="Куда бьют машины"
                cols={AIM_COLS}
                rows={camp.aim.options.map((o) => ({
                  key: o.aim,
                  on: camp.aim!.now === o.aim,
                  pick: () => o.can && !busy && void order(() => aimArtillery(o.aim), `Машины бьют: ${o.name.toLowerCase()}.`),
                  cells: {
                    aim: (
                      <span className="kit-two">
                        <b className="one-line">{o.name}</b>
                        <small className={o.can || camp.aim!.now === o.aim ? '' : 'bad'}>{o.can || camp.aim!.now === o.aim ? aimShort(o.aim, aimWeight) : 'нельзя'}</small>
                      </span>
                    ),
                  },
                }))}
              />
              {/* Выбранная цель словами целиком и отказы остальных — под таблицей: в строке выбора им тесно. */}
              <p className="note">{camp.aim.options.find((o) => o.aim === camp.aim!.now)?.gives}</p>
              {camp.aim.options
                .filter((o) => !o.can && o.aim !== camp.aim!.now && o.reason)
                .map((o) => (
                  <p className="note bad" key={o.aim}>
                    {o.name}: {o.reason}
                  </p>
                ))}
              <p className="note">
                {camp.aim.artillery.length
                  ? `Бьют: ${camp.aim.artillery.map((a) => a.name.toLowerCase()).join(', ')}.`
                  : 'Камнемёта и требушета нет: бить нечем, пока не встанут.'}
              </p>
            </>
          )}
        </>
      )}

      {/* Кольцо блокады (Р-5, world/blockade): условие, сейчас, что даёт и чем размыкают — из мира; кнопка гаснет с причиной. */}
      {shown === 'ring' && camp.blockade && (
        <>
          <Table
            label="Кольцо блокады"
            cols={RING_COLS}
            rows={[
              { key: 'need', cells: { what: 'Нужно: лагерь сильнее гарнизона', v: `вчетверо` } },
              { key: 'ratio', cells: { what: 'Лагерь сильнее гарнизона', v: <b className={camp.blockade.can || camp.blockade.on ? 'good' : 'bad'}>{camp.blockade.ratio}</b> } },
              {
                key: 'on',
                cells: {
                  what: 'Кольцо',
                  v: <span className={camp.blockade.on ? 'good' : ''}>{camp.blockade.on ? `замкнуто ${realLeft(Math.max(0, (now - (camp.blockade.since ?? now)) / 1000))}` : 'нет'}</span>,
                },
              },
            ]}
          />
          <p className="note">{camp.blockade.gives}</p>
          <p className="note">{camp.blockade.breaks}</p>
          {!camp.blockade.on && camp.blockade.broke && <p className="note warn">Разомкнуто: {camp.blockade.broke}.</p>}
          {camp.blockade.on ? (
            <Btn wide why={busy ? '…' : null} onClick={() => void order(() => blockade(false), 'Кольцо разомкнуто.')}>
              Разомкнуть кольцо
            </Btn>
          ) : (
            <>
              {camp.blockade.reason && <p className="note bad">{camp.blockade.reason}</p>}
              <Btn kind="main" wide why={busy ? '…' : camp.blockade.reason ? 'Сейчас не замкнуть' : null} onClick={() => void order(() => blockade(true), 'Кольцо замкнуто.')}>
                Замкнуть кольцо
              </Btn>
            </>
          )}
        </>
      )}

      {shown === 'phases' && (
        <>
          {/* Ход осады фазами и наказы на отлучку (world/siegeroll): журнал, поправки и проломы — из мира. */}
          {camp.phases && (
            <SiegePhases phases={camp.phases} now={now} busy={busy} onOrders={(o) => void order(() => setOrders(o), 'Наказы поставлены.')} />
          )}
          {/* Переговоры у стен (docs/siege_v2.md, раздел 7): условия сдачи, дань, наказ брать дань — числа из мира. */}
          {camp.parley && <SiegeParley view={camp.parley} fate={camp.fate} now={now} orders={camp.phases?.orders} busy={busy} />}
        </>
      )}

      {shown === 'storm' && (
        <>
          {/* Дела полководца в лагере (world/siegecraft): за энергию, не больше предела за осаду. Числа и отказ — из мира. */}
          {camp.crafts && camp.crafts.length > 0 && (
            <>
              <Table
                label="Дела в лагере"
                cols={CRAFT_COLS}
                rows={camp.crafts.map((c) => ({
                  key: c.act,
                  cells: {
                    c: (
                      <span className="kit-two">
                        <b className="one-line">{c.name[0].toUpperCase() + c.name.slice(1)}</b>
                        <small className={c.can ? '' : 'bad'}>{c.can ? c.gain : c.reason}</small>
                      </span>
                    ),
                    done: `${c.done} из ${c.max}`,
                    act: (
                      <Btn why={!c.can ? 'Нельзя' : busy ? '…' : null} onClick={() => void order(() => campCraft(c.act), `${c.name[0].toUpperCase()}${c.name.slice(1)}: сделано.`)} sub={<EnergyPrice price={c.energy.price} />}>
                        Сделать
                      </Btn>
                    ),
                  },
                }))}
              />
              {camp.craftNote && <p className="note">{camp.craftNote}</p>}
            </>
          )}

          <h3>Участь</h3>
          <FatePick options={camp.fates} value={chosen} onChange={setPick} />
          <Btn wide why={sameFate ? 'Эта участь уже объявлена' : cantFate ? 'Эту участь не объявить' : busy ? '…' : null} onClick={() => void order(() => besiege(chosen), `Объявлено: ${FATE_META[chosen].name.toLowerCase()}.`)}>
            Объявить
          </Btn>

          <h3>Штурм</h3>
          {/* Способ штурма (docs/siege_v2.md, 4.4): из готовых машин, проёмы складываются; строка — устройство, без прогноза. */}
          {camp.machines?.walls && (
            <>
              <p className="note">
                {camp.machines.breaches > 0 ? `Проломов ${camp.machines.breaches} из ${BREACH_MAX}: столько стены без лестниц.` : 'Проломов нет.'}{' '}
                {methods.length === 0 ? 'Готовых машин нет: лестницы — те, что принесут на себе, на треть стены.' : ''}
              </p>
              {/* Машины на штурм — переключателями 44, а не родными флажками (К5, UI-7). */}
              {methods.map((m) => {
                const on = using.includes(m.machine);
                return (
                  <Toggle
                    key={m.machine}
                    label={m.words}
                    on={on}
                    disabled={busy}
                    onChange={() => setUse(on ? using.filter((x) => x !== m.machine) : [...using, m.machine])}
                  />
                );
              })}
            </>
          )}
          <Btn
            kind="main"
            wide
            why={busy ? '…' : camp.men === 0 ? 'В лагере никого' : cantFate ? 'Эту участь не объявить' : camp.storm?.block ? 'Не хватает энергии' : null}
            sub={camp.storm ? <EnergyPrice price={camp.storm.price} /> : undefined}
            onClick={() => void order(() => attack({ fate: chosen, ...(use ? { machines: use } : {}) }), 'Отряд штурмует. Донесение в походах.', true)}
          >
            Штурмовать · {camp.men}
          </Btn>
          <p className="note">{cantFate ?? camp.storm?.block ?? STORM_HOLDS}</p>
          {/* Отступить — необратимо: осада снята, лагерь сгорает; двумя касаниями одной кнопки (`kit/twotap`, UI-7). */}
          <Btn wide confirm onClick={() => void order(retreat, 'Осада снята.', true)}>
            Отступить
          </Btn>
          <p className="note">{CAMP_LEAVE}</p>
        </>
      )}
    </div>
  );
}
