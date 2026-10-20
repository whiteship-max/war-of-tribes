// Меню дел агента у цели (Р-4, docs/AGENTS.md, раздел 16).
//
// Свободной ходьбы по карте нет: агент идёт только к цели, делает там выбранное дело и сам возвращается домой. Путь игрока —
// «Походы» → кого послать → цель на карте → дело → подтверждение. Цель — свой город, двор мира, город игрока или чужой отряд;
// голая земля целью не бывает, и меню говорит об этом словами.
//
// Числа и отказы — мира (`WorldApi.errands`): дорога туда и назад, риск, цена в энергии, шанс. Правило показа одно:
// **недоступное дело показано и объяснено**, а не спрятано. Подтверждение говорит четыре вещи — куда, что сделает,
// сколько идти, чем рискует, — и только потом «Отправить».
//
// Открывается значком кольца над целью (К-2, `Ring.tsx` — главный путь), тапом с агентом в руке, из карточки места и из
// «Походов» (перехват). Правая кнопка мыши — то же. Дело полководца ведёт сразу в окно войска (`ArmySend`).
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { useGame } from '@/game/store';
import { useWorld, worldNow } from '@/world/store';
import { FIGURE_BY_ID, FIGURES } from '@/world/data/figures';
import { FATE_META } from '@/world/data/fates';
import { RIVAL_DEEDS } from '@/world/data/spy';
import { formatCoord, secondsLeft } from '@/world/geo';
import { CAMP_LEAVE } from '@/world/siege';
import { realLeft } from '@/ui/parts/wait';
import { count } from '@/ui/parts/plural';
import { hireWhere } from '@/game/sim/hire';
import { RESOURCE_IDS } from '@/game/constants';
import type { ErrandId, ErrandOption, Loot } from '@/world/types';
import { Icon } from '@/ui/icons/Icon';
import { Cost } from '@/ui/parts/Cost';
import { REST_WHY, restLine } from '@/ui/parts/restWords';
import { EnergyBar, EnergyPrice } from '@/ui/parts/Energy';
import { beyondText, reachable } from './twslot';
import { tipAt } from '@/ui/next/tip';
import type { IconName } from '@/ui/icons/alias';
import { iconName } from '@/ui/icons/registry';
import { roomOf } from '@/world/muster';
import { musterable, startable } from './ring';

// Окно войска полководца (К-2) — своим куском: передача тянет мощь и оборону, а нужна только после выбора дела.
const ArmySend = lazy(() => import('./ArmySend'));

/** Просит ли дело хоть что-нибудь со склада. */
const isPaid = (cost: Loot): boolean => RESOURCE_IDS.some((r) => (cost[r] ?? 0) > 0) || (cost.gold ?? 0) > 0;

const DEALS = new Set<ErrandId>(['truce', 'trade', 'tribute', 'alliance']);
const DIPLO = new Set<ErrandId>(['gift', 'insult', 'pact', 'peace', 'war']);
const SPY = new Set<ErrandId>(['probe', 'revolt']);

/** Значок дела — набором ЗН-1, теми же рисунками, что у прежних кнопок этих дел. */
export function errandIcon(o: Pick<ErrandOption, 'id' | 'agent'>): IconName {
  const rival = RIVAL_DEEDS.find((d) => d.id === o.id);
  if (rival) return rival.icon;
  if (DEALS.has(o.id)) return iconName('deal', o.id);
  if (DIPLO.has(o.id)) return iconName('dip', o.id);
  if (SPY.has(o.id)) return iconName('spy', o.id);
  const own: Partial<Record<ErrandId, IconName>> = {
    home: 'ui-home',
    storm: 'hud-army',
    siege: 'alert-siege',
    intercept: 'ui-target',
    strike: 'stage-camp',
    relief: iconName('deal', 'alliance'),
    recon: 'fig-scout',
    shadow: 'ui-eye',
    watch: 'ui-eye',
    unpact: iconName('dip', 'war'),
    ransom: iconName('deal', 'tribute'),
  };
  return own[o.id] ?? iconName('fig', o.agent);
}

/** Дорога словами: «туда 2:10, назад 2:10». У дела «домой» обратной дороги нет. */
export function roadWords(o: Pick<ErrandOption, 'walkMs' | 'backMs' | 'id'>): string {
  const there = o.walkMs > 0 ? `туда ${realLeft(o.walkMs / 1000)}` : 'уже на месте';
  return o.id === 'home' || o.backMs <= 0 ? there : `${there}, назад ${realLeft(o.backMs / 1000)}`;
}

/** Строка тоста после отправки: кто, что и когда сделает. */
export function sentWords(who: string, o: ErrandOption): string {
  if (o.id === 'home') return `${who} идёт домой.`;
  const when = o.walkMs > 0 ? ` через ${realLeft(o.walkMs / 1000)}` : ' сейчас';
  return `${who}: «${o.name}»${when}. Донесение — в «Походах», домой вернётся сам.`;
}

export function ActionMenu() {
  const menu = useWorld((g) => g.menu);
  const figures = useWorld((g) => g.figures);
  const marches = useWorld((g) => g.marches);
  const s = useGame((g) => g.s);
  const closeMenu = useWorld((g) => g.closeMenu);
  const errand = useWorld((g) => g.errand);
  const watch = useWorld((g) => g.watch);
  const shelter = useWorld((g) => g.shelter);
  const showToast = useGame((g) => g.showToast);
  const openSiege = useGame((g) => g.openSiege);
  const openCamp = useGame((g) => g.openCamp);
  // Выбранное дело — шаг подтверждения.
  const [chosen, setChosen] = useState<ErrandId | null>(null);
  const [busy, setBusy] = useState(false);
  const key = menu ? `${menu.agent}:${menu.cell.x}|${menu.cell.y}` : '';
  // Другой человек или другая цель — выбор сначала.
  useEffect(() => setChosen(null), [key]);

  if (!menu) return null;
  const def = FIGURE_BY_ID[menu.agent];
  const figure = figures.find((f) => f.id === menu.agent);
  const card = menu.card;
  const inCity = figure?.place === 'city';
  const ownCity = Boolean(card?.mine);
  const vacant = figure?.place === 'vacant';
  // Все дела человека у цели, удар и осада тоже (К-2): участь их выбирают в окне войска тем же `FatePick`, что в карточке.
  const list = menu.errands ?? null;
  const pick = chosen ? (list?.find((o) => o.id === chosen) ?? null) : null;
  // Полководец в лагере: увести его к другой цели можно, но это и есть снятие осады — сказано до «Отправить».
  // Пустой отряд полководца — не отказ, пока бойцы в гарнизоне: их даёт окно войска (К-2, `ring.emptyRetinue`).
  const muster = menu.agent === 'general' && musterable(figure, roomOf(s.army, marches ?? []));
  const leavingCamp = menu.agent === 'general' && Boolean(figure?.besieging) && figure?.besieging !== menu.target;

  /** Подсказка по касанию значка строки: что это и что стоит за числами (docs/ui_audit.md, 3.7). */
  const tipOf =
    (title: string, ...lines: (string | null | undefined | false)[]) =>
    (e: { currentTarget: Element }): void =>
      tipAt(e.currentTarget, { title, body: lines.filter(Boolean).join(' ') || undefined });

  const hide = async (on: boolean): Promise<void> => {
    const err = await shelter(menu.agent, on);
    showToast(err ?? (on ? `${def.name} укрылся в городе.` : `${def.name} вышел из города.`));
    if (!err) closeMenu();
  };

  const go = async (o: ErrandOption): Promise<void> => {
    if (!menu.goal) return;
    setBusy(true);
    const err = await errand({ agent: menu.agent, target: menu.goal, deed: o.id, shownAt: o.at });
    setBusy(false);
    showToast(err ?? sentWords(def.name, o));
    if (!err) {
      closeMenu();
      useWorld.getState().pick(null);
    }
  };

  // Шапка нового вида (3.10): значок роли (касание — что он умеет), «кто → куда», координата, «закрыть».
  const head = (
    <div className="nx-bhead">
      <button className="nx-bico" onClick={tipOf(def.name, def.description, def.ability)} aria-label={`${def.name}: что умеет`}>
        <Icon name={iconName('fig', def.id)} />
      </button>
      <div className="nx-btitle">
        <b className="one-line">
          {def.name} → {menu.name}
        </b>
        <span className="nx-blvl">{pick ? 'подтверждение' : formatCoord(menu.cell)}</span>
      </div>
      <button className="nx-bclose" onClick={closeMenu} aria-label="Закрыть">
        <Icon name="ui-close" />
      </button>
    </div>
  );

  // Карта по регионам (docs/map_tw.md, раздел 13.5): цель за краем региона игрока не выбирается.
  if (!reachable(menu.cell)) {
    return (
      <Wrap closeMenu={closeMenu}>
        {head}
        <p className="nx-bwarn">{beyondText()}</p>
      </Wrap>
    );
  }

  // Полководец: после выбора дела — сразу окно войска (К-2): кто уходит, кто остаётся, и подтверждение там же.
  if (pick && menu.agent === 'general' && pick.id !== 'home' && menu.goal) {
    return (
      <Wrap closeMenu={closeMenu}>
        {head}
        <Suspense fallback={<p className="nx-tnote">Считаем отряд…</p>}>
          <ArmySend
            where={`${menu.name} · ${formatCoord(menu.cell)}`}
            goal={menu.goal}
            o={pick}
            fates={card?.fates ?? []}
            warn={leavingCamp ? CAMP_LEAVE : null}
            onBack={() => setChosen(null)}
          />
        </Suspense>
      </Wrap>
    );
  }

  // Подтверждение: куда, что сделает, сколько идти, чем рискует — и только потом «Отправить».
  if (pick) {
    return (
      <Wrap closeMenu={closeMenu}>
        {head}
        <ErrandConfirm
          where={`${menu.name} · ${formatCoord(menu.cell)}`}
          o={pick}
          warn={leavingCamp ? CAMP_LEAVE : null}
          busy={busy}
          onBack={() => setChosen(null)}
          onGo={() => void go(pick)}
        />
      </Wrap>
    );
  }

  return (
    <Wrap closeMenu={closeMenu}>
      {head}

      {/* Сменить человека, не закрывая меню: цель уже выбрана. Четыре роли — вкладками под шапкой (3.10). */}
      <div className="nx-am-tabs" role="tablist">
        {FIGURES.map((d) => (
          <button
            key={d.id}
            role="tab"
            aria-selected={d.id === menu.agent}
            aria-label={d.name}
            className={`nx-am-tab${d.id === menu.agent ? ' on' : ''}`}
            onClick={() => void useWorld.getState().openMenu(d.id, menu.cell)}
          >
            <Icon name={iconName('fig', d.id)} />
          </button>
        ))}
      </div>

      <div className="nx-am-body">
        {vacant && (
          <p className="nx-bwarn">
            {def.name} {figure?.gone === 'retired' ? 'ушёл на покой' : 'погиб'}. Найми нового {hireWhere(s, menu.agent)}.
          </p>
        )}

        {/* Энергия человека (docs/agent_energy.md): сколько есть и что с ней — до приказа, у каждого дела своя цена. */}
        {figure?.energy && <EnergyBar energy={figure.energy} spent={figure.spent} />}

        {/* Мораль отряда между боями (14.31): до приказа, а не после — уставший бежит раньше. */}
        {menu.agent === 'general' && figure?.rest && (
          <p className="nx-bwarn">
            {restLine(figure.rest, 'Отряд дрался', worldNow())} {REST_WHY}
          </p>
        )}

        {/* Чужой отряд в поле: кто, куда и когда дойдёт. Встать на пути мало — бой даёт перехват (отзыв 18.10). */}
        {menu.march && (
          <>
            {menu.across && menu.agent === 'general' && (
              <p className="nx-bwarn">Здесь пройдёт набег. Просто встать на пути мало: пройдут мимо, и боя не будет. Дать бой в поле — «Перехватить».</p>
            )}
            <div className="nx-crow">
              <span className="nx-lico">
                <Icon name="ui-banner" />
              </span>
              <span className="nx-crow-t">
                Отряд врага
                <small>
                  {menu.march.fromName} → {menu.march.toName}, дойдут через {realLeft(secondsLeft(menu.march.arriveAt, worldNow()))}.
                </small>
                {menu.march.rest && <small>{restLine(menu.march.rest, 'Отряд дрался', worldNow())}</small>}
              </span>
              <b>{menu.plan ? count(menu.plan.men, 'боец', 'бойца', 'бойцов') : '—'}</b>
            </div>
          </>
        )}

        {/* Осада своего города — окно осады, а не строка меню: всё, что про неё можно знать и сделать, собрано там. */}
        {menu.agent === 'general' && card?.siege && !card.siege.mine && card.mine && (
          <Row icon="alert-siege" name="Окно осады" note={`${card.siege.byName} у ворот`} onGo={() => (closeMenu(), openSiege())} />
        )}
        {/* Наш лагерь: всё, чем сейчас занят полководец, — приказы в окне лагеря. */}
        {menu.agent === 'general' && card?.siege?.mine && (
          <Row icon="stage-camp" name="Наш лагерь" note={FATE_META[card.siege.fate].name} onGo={() => (closeMenu(), openCamp())} />
        )}

        {/* Дела агента при этой цели. Касание — подтверждение; недоступное объяснено строкой под именем. */}
        {menu.goal && list === null && <p className="nx-tnote">Считаем дела…</p>}
        {menu.goal && list && list.length === 0 && (
          <p className="nx-tnote">
            {menu.agent === 'diplomat' && menu.goal.kind === 'place' && !card?.castle
              ? 'С логовом не договариваются. Дипломат ездит к соседям: союз и его разрыв, а дома — откуп от осады.'
              : `У ${def.one} здесь дел нет. Выбери другого человека вкладкой выше.`}
          </p>
        )}
        {list?.map((o) => (
          <div key={o.id} className={`nx-orow${startable(o, muster) ? '' : ' off'}`}>
            <button className="nx-wico" onClick={tipOf(o.name, o.does, ...o.risk)} aria-label={`${o.name}: что это`}>
              <Icon name={errandIcon(o)} />
            </button>
            <button className="nx-obtn" onClick={() => setChosen(o.id)}>
              <b>{o.name}</b>
              {startable(o, muster) && (
                <span className="nx-ochips">
                  <span>
                    <Icon name="ui-time" /> {roadWords(o)}
                  </span>
                  {o.chance !== null && <span className="good">удастся {Math.round(o.chance * 100)}%</span>}
                  {o.energy && <EnergyPrice price={o.energy.price} />}
                </span>
              )}
              {!startable(o, muster) && o.reason && <small className="nx-why">{o.reason}</small>}
              {isPaid(o.cost) && <Cost cost={o.cost} />}
            </button>
          </div>
        ))}

        {/* Лазутчик залёг — снять наблюдение; домой он пойдёт делом «Домой». */}
        {menu.agent === 'spy' && figure?.watching && (
          <Row
            icon="ui-eye"
            name="Подняться"
            note="перестанет смотреть"
            onGo={() => void watch(false).then((err) => showToast(err ?? 'Лазутчик поднялся и снова готов к делу.'))}
          />
        )}

        {/* Свой город — укрыться в нём или выйти. Входят от своих ворот. Укрывшийся не работает. */}
        {ownCity && figure && figure.place !== 'down' && !vacant && (figure.atHome || inCity) && (
          <Row
            icon="ui-home"
            name={inCity ? 'Выйти к воротам' : 'Укрыться в городе'}
            note={inCity ? 'встанет у ворот' : 'уйдёт за стену и не будет работать'}
            onGo={() => void hide(!inCity)}
          />
        )}

        {/* Прежний путь — полная карточка места: ссылкой, главный путь теперь кольцо (К-2). */}
        {menu.target && (
          <Row
            icon="ui-info"
            name="Карточка места"
            note="мощь, добыча, сведения — целиком"
            onGo={() => {
              closeMenu();
              void useWorld.getState().select(menu.cell);
            }}
          />
        )}

        {!menu.goal && (
          <p className="nx-tnote">Здесь никто не живёт. Люди ходят только к цели: свой город, чужой город, логово или отряд в пути.</p>
        )}
      </div>
    </Wrap>
  );
}

/** Подтверждение дела: куда, что сделает, дорога туда и назад, риск, энергия и плата — потом «Назад» или «Отправить». */
export function ErrandConfirm({
  where,
  o,
  warn,
  busy,
  onBack,
  onGo,
}: {
  where: string;
  o: ErrandOption;
  /** Цена, которая выясняется не делом, а уходом: увод полководца из лагеря снимает осаду. */
  warn?: string | null;
  busy: boolean;
  onBack: () => void;
  onGo: () => void;
}) {
  return (
    <>
      <div className="nx-am-body er-confirm">
        <div className="nx-crow er-what">
          <span className="nx-lico">
            <Icon name={errandIcon(o)} />
          </span>
          <span className="nx-crow-t">
            {o.name}
            <small>{o.does}</small>
          </span>
        </div>
        <Line label="Куда" value={where} />
        <Line label="Дорога" value={roadWords(o)} />
        <Line label="Риск" value={o.risk.length > 0 ? o.risk.join(' ') : 'Риска нет.'} bad={o.risk.length > 0} />
        {o.energy && <Line label="Энергия" value={<EnergyPrice price={o.energy.price} />} />}
        {isPaid(o.cost) && <Cost cost={o.cost} />}
        {warn && <p className="nx-bwarn">{warn}</p>}
        {!o.can && o.reason && <p className="nx-bwarn">{o.reason}</p>}
      </div>
      <div className="nx-am-foot">
        <button className="nx-go nx-go-ghost" onClick={onBack}>
          Назад
        </button>
        <button className="nx-go" disabled={busy || !o.can} onClick={onGo}>
          Отправить
        </button>
      </div>
    </>
  );
}

/** Затемнение вокруг меню: касание мимо окна закрывает его обычным `click`. Одна обёртка на все виды меню. */
function Wrap({ closeMenu, children }: { closeMenu: () => void; children: ReactNode }) {
  return (
    <div className="am-wrap" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.target === e.currentTarget && closeMenu()}>
      <div className="panel nx-bpanel nx-am">{children}</div>
    </div>
  );
}

/** Строка подтверждения: подпись слева, значение справа. */
function Line({ label, value, bad }: { label: string; value: ReactNode; bad?: boolean }) {
  return (
    <div className="er-line">
      <span className="muted">{label}</span>
      <b className={bad ? 'bad' : ''}>{value}</b>
    </div>
  );
}

/** Строка-переход: окно осады, лагерь, город. */
function Row({ icon, name, note, onGo }: { icon: IconName; name: string; note: string; onGo: () => void }) {
  return (
    <div className="nx-orow">
      <span className="nx-wico">
        <Icon name={icon} />
      </span>
      <button className="nx-obtn" onClick={onGo}>
        <b>{name}</b>
        <span className="nx-ochips">
          <span>{note}</span>
        </span>
      </button>
    </div>
  );
}
