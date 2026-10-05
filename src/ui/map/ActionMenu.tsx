// Меню приказов агенту по цели на карте.
//
// Открывается одиночным тапом — по своей фигуре её выбирают, тапом по поселению
// открывают это меню. Двойного тапа здесь нет и быть не может: в браузере это
// масштабирование, и он дерётся с зумом карты. Правая кнопка мыши делает то же
// самое, но это подарок десктопу, а не основа.
//
// Правило показа одно: **недоступное действие показано и объяснено**, а не
// спрятано. Игрок обязан видеть, чего ему не хватает — дойти, дождаться,
// накопить, — а не гадать, куда делась кнопка.
import { useEffect, useState, type ReactNode } from 'react';
import { useGame } from '@/game/store';
import { useWorld, worldNow } from '@/world/store';
import { FIGURE_BY_ID, FIGURES } from '@/world/data/figures';
import { STANDING_META, TEMPER_BY_ID } from '@/world/data/diplomacy';
import { actionsOf } from '@/world/data/spy';
import { RELATION_META } from '@/world/data/meta';
import { FATE_META } from '@/world/data/fates';
import { FATE_DEFAULT } from '@/world/spoils';
import { CAMP_LEAVE } from '@/world/siege';
import { worksWords } from '@/world/works';
import { distance, formatCoord, secondsLeft } from '@/world/geo';
import { realLeft, realSpanText, waitLeft } from '@/ui/parts/wait';
import { count } from '@/ui/parts/plural';
import { signed } from '@/ui/parts/signed';
import { perilShare, perilText, routPeril } from '@/world/peril';
import { personName } from '@/game/sim/agents';
import { hireWhere } from '@/game/sim/hire';
import { RESOURCE_IDS } from '@/game/constants';
import { troopTotal } from '@/game/battle/kinds';
import type { Fate, LeadPlan, Loot, OrderActionId, OrderOption } from '@/world/types';
import { Icon } from '@/ui/icons/Icon';
import { Cost } from '@/ui/parts/Cost';
import { CampStrike } from '@/ui/parts/CampStrike';
import { FatePick } from '@/ui/parts/FatePick';
import { REST_WHY, restLine } from '@/ui/parts/restWords';
import { EnergyBar, EnergyPrice } from '@/ui/parts/Energy';
import { beyondText, reachable } from './twslot';
import { tipAt } from '@/ui/next/tip';

/** Просит ли приказ хоть что-нибудь со склада. */
const isPaid = (cost: Loot): boolean => RESOURCE_IDS.some((r) => (cost[r] ?? 0) > 0) || (cost.gold ?? 0) > 0;

/** Шанс словами и числом: у оскорбления это риск, а не удача. */
function chanceText(o: OrderOption, label: string): string | null {
  if (o.chance === null) return null;
  return `${label} ${Math.round(o.chance * 100)}%`;
}

export function ActionMenu() {
  const menu = useWorld((g) => g.menu);
  const orders = useWorld((g) => g.orders);
  const figures = useWorld((g) => g.figures);
  const info = useWorld((g) => g.info);
  const s = useGame((g) => g.s);
  const closeMenu = useWorld((g) => g.closeMenu);
  const moveFigure = useWorld((g) => g.moveFigure);
  const order = useWorld((g) => g.order);
  const attack = useWorld((g) => g.attack);
  const besiege = useWorld((g) => g.besiege);
  const intercept = useWorld((g) => g.intercept);
  const watch = useWorld((g) => g.watch);
  const shelter = useWorld((g) => g.shelter);
  const showToast = useGame((g) => g.showToast);
  const openSiege = useGame((g) => g.openSiege);
  const openCamp = useGame((g) => g.openCamp);
  // Участь объявляется приказом — ударом или осадой; новая цель — новый выбор.
  const [fate, setFate] = useState<Fate>(FATE_DEFAULT);
  const target = menu?.target ?? null;
  useEffect(() => setFate(FATE_DEFAULT), [target]);

  if (!menu) return null;
  const def = FIGURE_BY_ID[menu.agent];
  const figure = figures.find((f) => f.id === menu.agent);
  const card = menu.card;
  const here = card ? card.figuresHere.includes(menu.agent) : false;
  const diplo = card?.diplomacy ?? null;
  const standing = diplo ? STANDING_META[diplo.standing] : null;
  const temper = diplo ? TEMPER_BY_ID[diplo.temper] : null;

  // Полководец в лагере: увести его можно, но это и есть снятие осады.
  const leavingCamp = menu.agent === 'general' && Boolean(figure?.besieging) && !here;
  // Агент укрылся в своём городе: на карте его нет, и вести его «сюда», к своим же
  // воротам, нечего — отсюда он только выходит.
  const inCity = figure?.place === 'city';
  const ownCity = Boolean(card?.mine);
  const homeInside = inCity && ownCity;

  const hide = async (on: boolean): Promise<void> => {
    const err = await shelter(menu.agent, on);
    showToast(
      err ??
        (on
          ? `${def.name} укрылся в городе.`
          : `${def.name} вышел из города.`),
    );
    if (!err) closeMenu();
  };

  const lead = async (): Promise<void> => {
    // Минута плана, который игрок видел: риск у ворот заморозится ровно по нему.
    const err = await moveFigure(menu.agent, menu.cell, menu.lead?.at);
    showToast(err ?? (leavingCamp ? `${def.name} ушёл от стен, осада снята.` : `${def.name} пошёл к ${formatCoord(menu.cell)}.`));
    if (!err) closeMenu();
  };

  /**
   * Гибель полководца — условно: «если отряд перебьют до последнего». Безусловный риск выдал бы
   * шанс поражения делением, а его не показывают нигде. Число — та же `routPeril` от
   * дали места боя, по которой мир решает исход.
   */
  const routLine = (spot: { x: number; y: number } | null): string | null =>
    menu.agent === 'general' && info && spot
      ? `Если отряд перебьют до последнего, ${personName(s, 'general')} погибнет с шансом ${perilText(perilShare(routPeril(distance(info.home, spot))))}.`
      : null;
  const vacant = figure?.place === 'vacant';

  const give = async (id: OrderActionId): Promise<void> => {
    const res = await order(id);
    showToast(res.error ?? res.text);
  };

  /** Подсказка по касанию значка строки: что это и что стоит за числами (docs/ui_audit.md, 3.7). */
  const tipOf =
    (title: string, ...lines: (string | null | undefined | false)[]) =>
    (e: { currentTarget: Element }): void =>
      tipAt(e.currentTarget, { title, body: lines.filter(Boolean).join(' ') || undefined });

  // Шапка нового вида (3.10): значок роли (касание — что он умеет), «кто → куда», координата, «закрыть».
  const head = (
    <div className="nx-bhead">
      <button className="nx-bico" onClick={tipOf(def.name, def.description, def.ability)} aria-label={`${def.name}: что умеет`}>
        <Icon name={`fig-${def.id}`} glyph={def.icon} />
      </button>
      <div className="nx-btitle">
        <b className="one-line">
          {def.name} → {menu.name}
        </b>
        <span className="nx-blvl">{formatCoord(menu.cell)}</span>
      </div>
      <button className="nx-bclose" onClick={closeMenu} aria-label="Закрыть">
        <Icon name="ui-close" glyph="✕" />
      </button>
    </div>
  );

  // Карта по регионам (docs/map_tw.md, раздел 13.5): цель за краем региона игрока не выбирается ни тапом, ни отсюда —
  // меню, открытое из карточки или списка походов, говорит об этом вместо приказов.
  if (!reachable(menu.cell)) {
    return (
      <div className="am-wrap" onPointerDown={(e) => e.stopPropagation()}>
        <div className="panel nx-bpanel nx-am">
          {head}
          <p className="nx-bwarn">{beyondText()}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="am-wrap" onPointerDown={(e) => e.stopPropagation()}>
      <div className="panel nx-bpanel nx-am">
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
              <Icon name={`fig-${d.id}`} glyph={d.icon} />
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

          {/* Отношения с этим двором: состояние и число; характер владельца — в подсказке. */}
          {diplo && standing && temper && card && (
            <>
              <button className="nx-crow" onClick={tipOf(temper.name, temper.note)}>
                <span className="nx-lico">
                  <Icon name={`temper-${temper.id}`} glyph={temper.icon} />
                </span>
                <span className="nx-crow-t">
                  <span style={{ color: standing.color }}>{standing.name}</span>
                  {/* Чего нет, того строка не называет: у логова ни правителя, ни племени — и строки нет. */}
                  {(card.owner || card.tribeName) && (
                    <small>
                      {card.owner && `Правитель ${card.owner}`}
                      {card.owner && card.tribeName && ' · '}
                      {card.tribeName && (
                        <>
                          {card.owner ? 'племя' : 'Племя'}{' '}
                          <span style={{ color: RELATION_META[card.relation].color }}>{card.tribeName}</span>
                        </>
                      )}
                    </small>
                  )}
                </span>
                <b>
                  {signed(diplo.attitude, 0)} · {diplo.mood}
                </b>
              </button>
              {diplo.standing === 'pact' && diplo.breakAt > 0 && (
                <p className="nx-bwarn bad">Пакт разорван. Война через {realLeft(secondsLeft(diplo.breakAt, worldNow()))}.</p>
              )}
              {diplo.standing === 'pact' && diplo.breakAt === 0 && diplo.until > 0 && (
                <p className="nx-tnote">Пакт держится ещё {realLeft(secondsLeft(diplo.until, worldNow()))}.</p>
              )}
            </>
          )}

          {/* Чужой отряд в поле: точка и время встречи видны до подтверждения. Имена мест не склоняются, между ними — стрелка. */}
          {menu.march && (
            <>
              <div className="nx-crow">
                <span className="nx-lico">
                  <Icon name="ui-banner" glyph="🚩" />
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
              {menu.agent === 'general' ? (
                <Order
                  icon="ui-target"
                  glyph="🏇"
                  name="Перехватить"
                  can={Boolean(menu.plan?.can)}
                  why={menu.plan ? menu.plan.reason : 'Считаем встречу…'}
                  tip={tipOf('Перехват', 'Полководец встретит отряд в поле, до его цели.', menu.plan?.at ? routLine(menu.plan.at) : null)}
                  onGo={() => {
                    void (async () => {
                      const err = await intercept();
                      showToast(err ?? 'Полководец пошёл на перехват.');
                      if (!err) closeMenu();
                    })();
                  }}
                >
                  {menu.plan?.can && (
                    <>
                      <span>
                        <Icon name="ui-pin" glyph="📍" /> {formatCoord(menu.plan.at ?? { x: 0, y: 0 })}
                      </span>
                      <span>
                        <Icon name="ui-time" glyph="⏳" /> {realLeft(menu.plan.seconds)}
                      </span>
                      <span className="bad">им до цели {realLeft(menu.plan.targetSeconds)}</span>
                      {menu.plan.energy && <EnergyPrice price={menu.plan.energy.price} />}
                    </>
                  )}
                </Order>
              ) : (
                <p className="nx-tnote">Перехватывает только полководец.</p>
              )}
            </>
          )}

          {/* Бунт виден там же, где приказы: он и есть окно для удара. */}
          {card?.revolt && (
            <p className="nx-bwarn">
              Бунт ещё {realLeft(secondsLeft(card.revolt.until, worldNow()))}. Работы стоят, гарнизон слабее на{' '}
              {Math.round(card.revolt.power * 100)}%.
            </p>
          )}

          {/* Приказы человека. Строка видна всегда: недоступное объяснено строкой под именем, описание — в подсказке. */}
          {menu.target !== null &&
            actionsOf(menu.agent).map((a) => {
              const o = orders.find((x) => x.id === a.id);
              if (!o) return null;
              const chance = chanceText(o, a.chanceLabel);
              return (
                <Order
                  key={a.id}
                  icon={`${menu.agent === 'spy' ? 'spy' : 'dip'}-${a.id}`}
                  glyph={a.icon}
                  name={a.name}
                  can={o.can}
                  why={o.reason}
                  tip={tipOf(a.name, a.description, o.perilWhy.length > 0 ? `Риск: ${o.perilWhy.join(', ')}.` : null)}
                  onGo={() => void give(a.id)}
                  /*
                    Дар и вира — та же плата, что дань в письме, и показывается
                    она так же: значок, сколько просят и сколько этого есть.
                  */
                  cost={isPaid(o.cost) ? o.cost : null}
                >
                  {chance && <span className="good">{chance}</span>}
                  <span>
                    <Icon name="ui-time" glyph="⏳" /> {realLeft(o.seconds)}
                  </span>
                  <EnergyPrice price={o.energy.price} />
                  {!isPaid(o.cost) && <span>даром</span>}
                  {menu.agent === 'spy' && o.peril !== null && (
                    // Два числа раздельно: удастся ли дело — выше, уцелеет ли лазутчик —
                    // здесь. Шансом владеет Дозор, гибелью — скрытность и обстановка.
                    <span className="bad">гибель {perilText(o.peril)}</span>
                  )}
                  {menu.agent === 'spy' && o.held !== undefined && (
                    // Цена лазутчика — не добро, а риск, и она обязана стоять рядом с шансом.
                    // Срок — тот, каким мир задержит: черта «Неловкий» его удлиняет.
                    <span className="bad">при провале задержат на {realSpanText(o.held)}</span>
                  )}
                </Order>
              );
            })}

          {/*
            Осада своего города — окно осады, а не строка меню: всё, что про неё можно
            знать и сделать, собрано там, и удар полководца с тыла тоже.
          */}
          {menu.agent === 'general' && card?.siege && !card.siege.mine && card.mine && (
            <Order
              icon="ui-target"
              glyph="⛺"
              name="Осада"
              can
              tip={tipOf('Осада', `${card.siege.byName} у ворот, грозят: ${FATE_META[card.siege.fate].name.toLowerCase()}.`)}
              onGo={() => {
                closeMenu();
                openSiege();
              }}
            >
              <span className="bad">{card.siege.byName} у ворот</span>
            </Order>
          )}

          {/*
            Чужой лагерь под чужим городом — цель, а не декорация. Полководец бьёт его из
            поля, с тыла, приказом издалека: бой — в минуту прихода. Кто пробьётся,
            считает мир той же функцией, что и бой, — та же часть, что в окне осады своего города.
          */}
          {menu.agent === 'general' && card?.siege && !card.siege.mine && !card.mine && (
            <>
              <CampStrike target={card.id} onDone={closeMenu} />
              <p className="nx-tnote">{worksWords(card.siege, worldNow())}</p>
            </>
          )}

          {/* Наш лагерь: он же и всё, чем сейчас занят полководец. Приказы — в окне лагеря. */}
          {menu.agent === 'general' && card?.siege?.mine && (
            <Order
              icon="ui-target"
              glyph="⛺"
              name="Наш лагерь"
              can
              tip={tipOf('Наш лагерь', `Решено: ${FATE_META[card.siege.fate].name.toLowerCase()}.`)}
              onGo={() => {
                closeMenu();
                openCamp();
              }}
            >
              <span>{FATE_META[card.siege.fate].name}</span>
            </Order>
          )}

          {/* Полководец: удар отсюда же, чтобы не гонять игрока по экранам. */}
          {menu.agent === 'general' && menu.target !== null && card && !card.mine && !card.siege?.mine && (
            <>
              {/* Участь объявляется этим же приказом: и ударом, и осадой. Строки выбора — не приказы. */}
              {card.fates.length > 0 && <h3>Участь при взятии</h3>}
              <FatePick options={card.fates} value={fate} onChange={setFate} />
              <Order
                icon="hud-army"
                glyph="⚔️"
                name="Ударить"
                can={card.can.raid}
                why={card.note}
                tip={tipOf('Удар', 'Бой у ворот в минуту прихода. Донесение ляжет в походы.', routLine(card))}
                onGo={() => {
                  void (async () => {
                    const err = await attack({ fate });
                    showToast(err ?? 'Отряд ударил. Донесение в походах.');
                    if (!err) closeMenu();
                  })();
                }}
              >
                {card.can.raid && <span>{count(troopTotal(figure?.troops ?? {}), 'боец', 'бойца', 'бойцов')}</span>}
                {card.energy && <EnergyPrice price={card.energy.raid.price} />}
              </Order>
              {/*
                Осада стоит рядом с ударом нарочно: это второй способ взять город, и выбирают
                между ними в один и тот же миг. Цену увода из лагеря — снятую осаду — говорит
                строка «Вести сюда» до нажатия (`CAMP_LEAVE`).
              */}
              <Order
                icon="ui-target"
                glyph="⛺"
                name="Осадить"
                can={card.can.besiege}
                why={
                  card.siege
                    ? 'Здесь уже стоит лагерь'
                    : figure?.besieging
                      ? 'Полководец уже держит осаду'
                      : (card.energy?.besiege.block ?? card.note)
                }
                tip={tipOf('Осада', 'Встать лагерем и ждать, пока кончится хлеб. Пока лагерь стоит, энергия полководца не тратится.', routLine(card))}
                onGo={() => {
                  void (async () => {
                    const err = await besiege(fate);
                    showToast(err ?? 'Отряд встал лагерем у стен.');
                    if (!err) closeMenu();
                  })();
                }}
              >
                {card.energy && <EnergyPrice price={card.energy.besiege.price} />}
              </Order>
            </>
          )}

          {/* Разведчик: своё умение он делает сам, стоя у ворот. */}
          {menu.agent === 'scout' && menu.target !== null && !ownCity && (
            <p className="nx-tnote">
              {here ? 'Стоит у ворот, сведения о гарнизоне свежие.' : 'Доведи разведчика до ворот, он пересчитает гарнизон.'}
            </p>
          )}

          {menu.agent === 'spy' && menu.target !== null && !here && (
            <p className="nx-tnote">Доведи лазутчика до ворот, приказы он берёт там.</p>
          )}

          {/*
            Наблюдение. Живой обзор за кругом города даёт один лазутчик, и цена у этого
            прямая: пока он смотрит, он не работает. Кнопка стоит и на пустой земле.
          */}
          {menu.agent === 'spy' && (
            <Order
              icon={figure?.watching ? 'ui-eye' : 'ui-eye-off'}
              glyph={figure?.watching ? '👁️' : '🙈'}
              name={figure?.watching ? 'Подняться' : 'Залечь'}
              can
              on={Boolean(figure?.watching)}
              tip={tipOf(
                'Наблюдение',
                `Лежит и видит на ${count((figure?.watchSight ?? 0) || FIGURE_BY_ID.spy.sight, 'клетку', 'клетки', 'клеток')} вокруг.`,
                'Пока лежит, приказов не берёт.',
              )}
              onGo={() => {
                void (async () => {
                  const on = !figure?.watching;
                  const err = await watch(on);
                  showToast(err ?? (on ? 'Лазутчик залёг и смотрит.' : 'Лазутчик снова готов к делу.'));
                })();
              }}
            >
              {figure?.watching && <span className="good">смотрит</span>}
            </Order>
          )}

          {/*
            Свой город — укрыться в нём или выйти. Входят от своих ворот, и если человек
            не у них, строка это говорит, а не пропадает. Укрывшийся не работает.
          */}
          {ownCity && figure && figure.place !== 'down' && (
            <Order
              icon="ui-home"
              glyph="🏰"
              name={inCity ? 'Выйти' : 'Укрыться'}
              can={inCity || here}
              why={figure.phase === 'moving' ? 'Ещё в пути' : `Доведи ${def.one} до своих ворот`}
              tip={tipOf(inCity ? 'Выйти' : 'Укрыться', inCity ? 'Встанет у своих ворот.' : 'Уйдёт за стену и не будет работать.')}
              onGo={() => void hide(!inCity)}
            />
          )}

          {menu.target === null && menu.march === null && <p className="nx-tnote">Здесь никто не живёт.</p>}
        </div>

        {/*
          Главное действие — внизу (3.10): вести сюда. Увести полководца из лагеря можно — и это
          снимает осаду; сказано об этом здесь, до нажатия: цена, которая выясняется после приказа, — подвох.
        */}
        <div className="nx-am-foot">
          <div className="nx-am-why">
            <small className={leavingCamp ? 'nx-why' : ''}>
              {homeInside
                ? 'Сначала выведи его из города.'
                : here
                  ? 'Дальше приказывай отсюда.'
                  : leavingCamp
                    ? CAMP_LEAVE
                    : menu.lead
                      ? `Идти ${waitLeft(menu.lead.seconds)}.`
                      : 'Считаем путь…'}
            </small>
            {/* Энергия в пути — тем же планом, что примет приказ: что останется на месте, цена дела у ворот, кончится ли. */}
            {!here && !homeInside && !leavingCamp && menu.lead?.energy && <LeadEnergy energy={menu.lead.energy} />}
            {/* Разведчик у ворот с часовыми: схватят ли и погибнет ли — двумя числами, до приказа.
                Риск замораживается в минуту отправки по этому же плану. */}
            {!here && !homeInside && menu.agent === 'scout' && menu.lead && menu.lead.caught > 0 && (
              <button
                className="nx-am-risk"
                onClick={tipOf('Риск у ворот', menu.lead.perilWhy.length > 0 ? `${menu.lead.perilWhy.join(', ')}.` : null)}
              >
                поимка {Math.round(menu.lead.caught * 100)}% · гибель {perilText(menu.lead.peril)}
              </button>
            )}
          </div>
          <button className="nx-go" disabled={here || homeInside || Boolean(figure?.spent) || Boolean(menu.lead?.energy?.block)} onClick={() => void lead()}>
            {here || homeInside ? 'Уже здесь' : 'Вести сюда'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Энергия в пути под «Вести сюда»: отказ, если не пойдёт; иначе — сколько останется на месте и кончится ли в дороге. */
function LeadEnergy({ energy }: { energy: NonNullable<LeadPlan['energy']> }) {
  if (energy.block) return <small className="nx-why">{energy.block}</small>;
  return (
    <small className={energy.runsOut ? 'nx-why' : ''}>
      {energy.runsOut
        ? 'Энергия кончится в дороге — повернёт домой, не дойдя.'
        : energy.price > 0
          ? `После дороги и разведки у ворот (${energy.price}) энергии останется ${energy.atArrival}.`
          : `После дороги энергии останется ${energy.atArrival}.`}
    </small>
  );
}

/**
 * Строка приказа нового вида: значок — справка (касание — что это и откуда риск), тело — сама кнопка приказа: имя,
 * числа строкой, причина погасшей кнопки — строкой 11 px под именем (3.7, 3.8). Цена — `Cost` под строкой.
 */
function Order({
  icon,
  glyph,
  name,
  can,
  why,
  on,
  tip,
  onGo,
  cost,
  children,
}: {
  icon: string;
  glyph: string;
  name: string;
  can: boolean;
  why?: string | null;
  on?: boolean;
  tip: (e: { currentTarget: Element }) => void;
  onGo: () => void;
  cost?: Loot | null;
  children?: ReactNode;
}) {
  return (
    <div className={`nx-orow${can ? '' : ' off'}${on ? ' on' : ''}`}>
      <button className="nx-wico" onClick={tip} aria-label={`${name}: что это`}>
        <Icon name={icon} glyph={glyph} />
      </button>
      <button className="nx-obtn" disabled={!can} onClick={onGo}>
        <b>{name}</b>
        {can && children && <span className="nx-ochips">{children}</span>}
        {!can && why && <small className="nx-why">{why}</small>}
        {cost && <Cost cost={cost} />}
      </button>
    </div>
  );
}
