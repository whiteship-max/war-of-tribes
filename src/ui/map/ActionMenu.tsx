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
import { useEffect, useState } from 'react';
import { useGame } from '@/game/store';
import { useWorld, worldNow } from '@/world/store';
import { FIGURE_BY_ID, FIGURES } from '@/world/data/figures';
import { STANDING_META, TEMPER_BY_ID } from '@/world/data/diplomacy';
import { actionsOf } from '@/world/data/spy';
import { SPY_HELD } from '@/world/data/tuning';
import { RELATION_META } from '@/world/data/meta';
import { FATE_META } from '@/world/data/fates';
import { FATE_DEFAULT } from '@/world/spoils';
import { CAMP_LEAVE } from '@/world/siege';
import { worksWords } from '@/world/works';
import { distance, formatCoord, formatLeft, secondsLeft } from '@/world/geo';
import { perilShare, perilText, routPeril } from '@/world/peril';
import { personName } from '@/game/sim/agents';
import { hireWhere } from '@/game/sim/hire';
import { RESOURCE_IDS } from '@/game/constants';
import { troopTotal } from '@/game/battle/kinds';
import type { Fate, Loot, OrderActionId, OrderOption } from '@/world/types';
import { Icon } from '@/ui/icons/Icon';
import { Cost } from '@/ui/parts/Cost';
import { CampStrike } from '@/ui/parts/CampStrike';
import { FatePick } from '@/ui/parts/FatePick';

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
  const openBattle = useGame((g) => g.openBattle);
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
          ? `${def.name} укрылся в городе: на карте его нет, выйдет по твоему слову.`
          : `${def.name} вышел из города и встал у ворот.`),
    );
    if (!err) closeMenu();
  };

  const lead = async (): Promise<void> => {
    // Минута плана, который игрок видел: риск у ворот заморозится ровно по нему.
    const err = await moveFigure(menu.agent, menu.cell, menu.lead?.at);
    showToast(err ?? (leavingCamp ? `Осада снята: ${def.name} ушёл от стен.` : `${def.name} пошёл к ${formatCoord(menu.cell)}.`));
    if (!err) closeMenu();
  };

  /**
   * Гибель полководца — условно: «если дружину перебьют». Безусловный риск выдал бы
   * шанс поражения делением, а его не показывают нигде. Число — та же `routPeril` от
   * дали места боя, по которой мир решает исход.
   */
  const routLine = (spot: { x: number; y: number } | null): string | null =>
    menu.agent === 'general' && info && spot
      ? `Если дружину перебьют до последнего, ${personName(s, 'general')} погибнет с шансом ${perilText(perilShare(routPeril(distance(info.home, spot))))}.`
      : null;
  const vacant = figure?.place === 'vacant';

  const give = async (id: OrderActionId): Promise<void> => {
    const res = await order(id);
    showToast(res.error ?? res.text);
  };

  return (
    <div className="am-wrap" onPointerDown={(e) => e.stopPropagation()}>
      <div className="am">
        <div className="am-head">
          <span className="ico">
            <Icon name={`fig-${def.id}`} glyph={def.icon} />
          </span>
          <div className="body">
            <b>
              {def.name} → {menu.name}
            </b>
            <i>{formatCoord(menu.cell)}</i>
          </div>
          <button className="am-x" onClick={closeMenu} aria-label="Закрыть">
            ✕
          </button>
        </div>

        {vacant && (
          <div className="am-warn">
            Места {def.one} некому занять: {figure?.gone === 'retired' ? 'ушёл на покой' : 'погиб'}. Нанять {hireWhere(s, menu.agent)} —
            приказы появятся, когда встанет новый.
          </div>
        )}

        {/* Отношения с этим двором: состояние, число и характер владельца. */}
        {diplo && standing && temper && card && (
          <div className="am-rel">
            <div className="am-rel-top">
              <span style={{ color: standing.color }}>
                {standing.icon} {standing.name}
              </span>
              <span className="am-att">
                {diplo.attitude > 0 ? `+${diplo.attitude}` : diplo.attitude} · {diplo.mood}
              </span>
            </div>
            <div className="am-temper">
              <Icon name={`temper-${temper.id}`} glyph={temper.icon} /> {temper.name}: {temper.note}
            </div>
            {diplo.standing === 'pact' && diplo.breakAt > 0 && (
              <div className="am-warn">
                Разрыв объявлен: война через {formatLeft(secondsLeft(diplo.breakAt, worldNow()))}.
              </div>
            )}
            {diplo.standing === 'pact' && diplo.breakAt === 0 && diplo.until > 0 && (
              <div className="am-note">Пакт держится ещё {formatLeft(secondsLeft(diplo.until, worldNow()))}.</div>
            )}
            <div className="am-note">
              Владелец — {card.owner ?? 'никто'}, племя{' '}
              <span style={{ color: RELATION_META[card.relation].color }}>{card.tribeName ?? 'нет'}</span>.
            </div>
          </div>
        )}

        {/* Чужой отряд в поле: точка и время встречи видны до подтверждения. */}
        {menu.march && (
          <>
            <div className="am-rel">
              <div className="am-rel-top">
                <span>⚔️ Отряд в поле</span>
                <span className="am-att">{menu.plan?.men ?? '—'} чел.</span>
              </div>
              <div className="am-note">
                Идут от {menu.march.fromName} к {menu.march.toName}; им идти{' '}
                {formatLeft(secondsLeft(menu.march.arriveAt, worldNow()))}.
              </div>
            </div>
            {menu.agent === 'general' ? (
              <button
                className={`am-row${menu.plan?.can ? '' : ' off'}`}
                disabled={!menu.plan?.can}
                onClick={() => {
                  void (async () => {
                    const err = await intercept();
                    showToast(err ?? 'Полководец пошёл на перехват.');
                    if (!err) closeMenu();
                  })();
                }}
              >
                <span className="ico">🏇</span>
                <span className="body">
                  <b>Перехватить в поле</b>
                  <i>
                    {menu.plan
                      ? menu.plan.can
                        ? `Встреча на ${formatCoord(menu.plan.at ?? { x: 0, y: 0 })} через ${formatLeft(menu.plan.seconds)}.`
                        : menu.plan.reason
                      : 'Считаем встречу…'}
                  </i>
                  {menu.plan?.can && (
                    <em>
                      <span className="am-chance">
                        📍 {formatCoord(menu.plan.at ?? { x: 0, y: 0 })}
                      </span>
                      <span className="am-time">⏳ {formatLeft(menu.plan.seconds)}</span>
                      <span className="am-risk">им идти {formatLeft(menu.plan.targetSeconds)}</span>
                    </em>
                  )}
                  {menu.plan?.can && menu.plan.at && <i className="am-risk">{routLine(menu.plan.at)}</i>}
                </span>
              </button>
            ) : (
              <div className="am-plain">
                Отряд в поле встречает полководец: у остальных для этого нет ни войска, ни права.
              </div>
            )}
          </>
        )}

        {/* Бунт виден там же, где приказы: он и есть окно для удара. */}
        {card?.revolt && (
          <div className="am-revolt">
            🔥 В поселении бунт: работы встали, гарнизон слабее на{' '}
            {Math.round(card.revolt.power * 100)}%. Осталось{' '}
            {formatLeft(secondsLeft(card.revolt.until, worldNow()))}.
          </div>
        )}

        {/* Приказы агента. Строка видна всегда: недоступное объяснено. */}
        {menu.target !== null &&
          actionsOf(menu.agent).map((a) => {
            const o = orders.find((x) => x.id === a.id);
            if (!o) return null;
            const chance = chanceText(o, a.chanceLabel);
            return (
              <button
                key={a.id}
                className={`am-row${o.can ? '' : ' off'}`}
                disabled={!o.can}
                onClick={() => void give(a.id)}
              >
                <span className="ico">
                  <Icon name={`${menu.agent === 'spy' ? 'spy' : 'dip'}-${a.id}`} glyph={a.icon} />
                </span>
                <span className="body">
                  <b>{a.name}</b>
                  <i>{o.can ? a.description : o.reason}</i>
                  <em>
                    {chance && <span className="am-chance">{chance}</span>}
                    <span className="am-time">⏳ {formatLeft(o.seconds)}</span>
                    {!isPaid(o.cost) && <span className="am-free">даром</span>}
                    {menu.agent === 'spy' && o.peril !== null && (
                      // Два числа раздельно: удастся ли дело — выше, уцелеет ли лазутчик —
                      // здесь. Шансом владеет Дозор, гибелью — скрытность и обстановка.
                      <span className="am-risk">гибель {perilText(o.peril)}</span>
                    )}
                    {menu.agent === 'spy' && (
                      // Цена лазутчика — не добро, а риск, и она обязана стоять
                      // рядом с шансом, а не прятаться в описании.
                      <span className="am-risk">провал: задержат на {formatLeft(SPY_HELD / 1000)}</span>
                    )}
                  </em>
                  {o.perilWhy.length > 0 && <i className="am-risk">{o.perilWhy.join(' · ')}</i>}
                  {/*
                    Дар и вира — та же плата, что дань в письме, и показывается
                    она так же: значок, сколько просят и сколько этого есть.
                    Прежде здесь стояло одно «🌲 40», и хватает ли — приходилось
                    вспоминать, стоя на карте, где склада не видно вовсе.
                  */}
                  {isPaid(o.cost) && <Cost cost={o.cost} />}
                </span>
              </button>
            );
          })}

        {/*
          Осада своего города — окно осады, а не строка меню: всё, что про неё можно
          знать и сделать, собрано там, и удар полководца с тыла тоже.
        */}
        {menu.agent === 'general' && card?.siege && !card.siege.mine && card.mine && (
          <button
            className="am-row"
            onClick={() => {
              closeMenu();
              openSiege();
            }}
          >
            <span className="ico">⛺</span>
            <span className="body">
              <b>Окно осады</b>
              <i>
                «{card.siege.byName}» у ворот. Объявлено: {FATE_META[card.siege.fate].name.toLowerCase()}. Там же — удар
                полководца с тыла и вылазка.
              </i>
            </span>
          </button>
        )}

        {/*
          Чужой лагерь под чужим городом — цель, а не декорация. Полководец бьёт его из
          поля, с тыла, приказом издалека: бой — в минуту прихода. Кто пробьётся,
          считает мир той же функцией, что и бой, и кнопка гаснет, когда пробиться
          некому, — та же часть, что в окне осады своего города.
        */}
        {menu.agent === 'general' && card?.siege && !card.siege.mine && !card.mine && (
          <>
            <CampStrike target={card.id} onDone={closeMenu} />
            <div className="am-plain">{worksWords(card.siege, worldNow())}</div>
          </>
        )}

        {/* Наш лагерь: он же и всё, чем сейчас занят полководец. Приказы — в окне лагеря. */}
        {menu.agent === 'general' && card?.siege?.mine && (
          <button
            className="am-row"
            onClick={() => {
              closeMenu();
              openCamp();
            }}
          >
            <span className="ico">⛺</span>
            <span className="body">
              <b>Окно осады</b>
              <i>
                Здесь стоит наш лагерь, объявлено: {FATE_META[card.siege.fate].name.toLowerCase()}. Хлеб города,
                стороны лагеря, древесина, штурм и отступление — там.
              </i>
            </span>
          </button>
        )}

        {/* Полководец: удар отсюда же, чтобы не гонять игрока по экранам. */}
        {menu.agent === 'general' && menu.target !== null && card && !card.mine && !card.siege?.mine && (
          <>
            {/* Участь объявляется этим же приказом: и ударом, и осадой. Строки выбора —
                не приказы, и сказано это над ними. */}
            {card.fates.length > 0 && <div className="am-note">Участь города — её объявит удар или осада ниже:</div>}
            <FatePick options={card.fates} value={fate} onChange={setFate} />
            <button
              className={`am-row${card.can.raid ? '' : ' off'}`}
              disabled={!card.can.raid}
              onClick={() => {
                void (async () => {
                  const err = await attack({ setup: null, fate });
                  showToast(err ?? 'Дружина ударила. Отчёт в походах.');
                  if (!err) closeMenu();
                })();
              }}
            >
              <span className="ico">⚔️</span>
              <span className="body">
                <b>Ударить сразу</b>
                <i>
                  {card.can.raid
                    ? `Тем, что при нём: ${troopTotal(figure?.troops ?? {})} бойцов. Расстановку выберет пресет.`
                    : card.note}
                </i>
                {card.can.raid && <i className="am-risk">{routLine(card)}</i>}
              </span>
            </button>
            <button
              className={`am-row${card.can.raid ? '' : ' off'}`}
              disabled={!card.can.raid}
              onClick={() => {
                closeMenu();
                openBattle(card.id);
              }}
            >
              <span className="ico"><Icon name="ui-target" glyph="🎯" /></span>
              <span className="body">
                <b>Настроить бой</b>
                <i>Расставить по секторам, выбрать план и приказы.</i>
              </span>
            </button>
            {/*
              Осада стоит рядом с ударом нарочно: это второй способ взять город,
              и выбирают между ними в один и тот же миг. Приступ — быстро и с
              риском, осада — медленно, но без боя, и всё это время дружины нет
              дома. Цена сказана прямо в строке, а не выясняется потом.
            */}
            <button
              className={`am-row${card.can.besiege ? '' : ' off'}`}
              disabled={!card.can.besiege}
              onClick={() => {
                void (async () => {
                  const err = await besiege(fate);
                  showToast(err ?? `Дружина обложила ${card.name}. ${CAMP_LEAVE}`);
                  if (!err) closeMenu();
                })();
              }}
            >
              <span className="ico">⛺</span>
              <span className="body">
                <b>Осадить</b>
                <i>
                  {card.can.besiege
                    ? `Встать лагерем и ждать, когда кончится хлеб; осаждённый видит участь сразу. ${CAMP_LEAVE}`
                    : card.siege
                      ? 'Под этими стенами уже стоит лагерь.'
                      : figure?.besieging
                        ? 'Полководец уже держит осаду — второй лагерь ему не поставить.'
                        : card.note}
                </i>
                {card.can.besiege && <i className="am-risk">{routLine(card)}</i>}
              </span>
            </button>
          </>
        )}

        {/* Разведчик: своё умение он делает сам, стоя у ворот. */}
        {menu.agent === 'scout' && menu.target !== null && (
          <div className="am-plain">
            {here
              ? '👣 Стоит у ворот и считает войско: данные обновляются, пока он здесь.'
              : 'Доведи разведчика к воротам — он пересчитает войско и будет держать данные свежими.'}
          </div>
        )}

        {menu.agent === 'spy' && menu.target !== null && !here && (
          <div className="am-plain">
            Приказы отдаются у самых ворот: доведи лазутчика — он и сосчитает войско, и найдёт
            недовольных.
          </div>
        )}

        {/*
          Наблюдение. Живой обзор за кругом деревни даёт один лазутчик, и цена
          у этого прямая: пока он смотрит, он не работает. Кнопка стоит и на
          пустой земле — смотреть можно на дорогу, а не только на ворота.
        */}
        {menu.agent === 'spy' && (
          <button
            className={`am-row${figure?.watching ? ' watching' : ''}`}
            onClick={() => {
              void (async () => {
                const on = !figure?.watching;
                const err = await watch(on);
                showToast(
                  err ??
                    (on
                      ? 'Лазутчик залёг и смотрит. Пока смотрит — не работает.'
                      : 'Лазутчик снят с наблюдения и снова готов к делу.'),
                );
              })();
            }}
          >
            <span className="ico">
              {figure?.watching ? <Icon name="ui-eye" glyph="👁️" /> : <Icon name="ui-eye-off" glyph="🫥" />}
            </span>
            <span className="body">
              <b>{figure?.watching ? 'Снять с наблюдения' : 'Стать наблюдателем'}</b>
              <i>
                {figure?.watching
                  ? `Смотрит на ${(figure?.watchSight ?? 0) || FIGURE_BY_ID.spy.sight} клетки вокруг. Приказы при этом не отдаются.`
                  : 'Заляжет и будет держать живой обзор вокруг себя. Выведать войско и поднять бунт при этом нельзя.'}
              </i>
            </span>
          </button>
        )}

        {/*
          Свой город — укрыться в нём или выйти. Входят от своих ворот, и если агент
          не у них, строка это говорит, а не пропадает. Укрывшийся не работает: не
          смотрит, не открывает землю и не стоит ни у чьих ворот.
        */}
        {ownCity && figure && figure.place !== 'down' && (
          <button
            className={`am-row${inCity || here ? '' : ' off'}`}
            disabled={!inCity && !here}
            onClick={() => void hide(!inCity)}
          >
            <span className="ico">🏰</span>
            <span className="body">
              <b>{inCity ? 'Выйти из города' : 'Укрыться в городе'}</b>
              <i>
                {inCity
                  ? 'Встанет у ворот — там же, откуда вошёл, — и снова будет на карте.'
                  : here
                    ? 'Уйдёт за стену и пропадёт с карты: не смотрит и не работает, пока не выйдет.'
                    : figure.phase === 'moving'
                      ? 'Ещё в пути: в город входят от своих ворот.'
                      : `Входят от своих ворот: доведи ${def.one} домой.`}
              </i>
            </span>
          </button>
        )}

        {menu.target === null && menu.march === null && (
          <div className="am-plain">Здесь никто не живёт. Приказывать некому — но пройти можно.</div>
        )}

        {/*
          Увести полководца из лагеря можно — и это снимает осаду. Сказано об
          этом здесь, до нажатия: цена приказа, которая выясняется после него, —
          это не цена, а подвох.
        */}
        <button className="am-row lead" disabled={here || homeInside} onClick={() => void lead()}>
          <span className="ico">
            <Icon name={`fig-${def.id}`} glyph={def.icon} />
          </span>
          <span className="body">
            <b>{here || homeInside ? `${def.name} уже здесь` : `Вести ${def.one} сюда`}</b>
            <i>
              {homeInside
                ? 'Он в городе: выведи его строкой выше.'
                : here
                  ? 'Дальше приказывай отсюда.'
                  : leavingCamp
                    ? CAMP_LEAVE
                    : menu.lead
                      ? `Идти ${formatLeft(menu.lead.seconds)}.`
                      : 'Идти будет столько, сколько велит дорога.'}
            </i>
            {/* Разведчик у ворот с часовыми: схватят ли и погибнет ли — двумя числами, до
                приказа. Риск замораживается в минуту отправки по этому же плану. */}
            {!here && !homeInside && menu.agent === 'scout' && menu.lead && menu.lead.caught > 0 && (
              <em>
                <span className="am-risk">часовые: схватят {Math.round(menu.lead.caught * 100)}%</span>
                <span className="am-risk">гибель {perilText(menu.lead.peril)}</span>
              </em>
            )}
            {!here && !homeInside && menu.agent === 'scout' && menu.lead && menu.lead.perilWhy.length > 0 && (
              <i className="am-risk">{menu.lead.perilWhy.join(' · ')}</i>
            )}
          </span>
        </button>

        {/* Сменить агента, не закрывая меню: цель уже выбрана. */}
        <div className="am-agents">
          {FIGURES.map((d) => (
            <button
              key={d.id}
              className={`am-agent${d.id === menu.agent ? ' active' : ''}`}
              onClick={() => void useWorld.getState().openMenu(d.id, menu.cell)}
            >
              <Icon name={`fig-${d.id}`} glyph={d.icon} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
