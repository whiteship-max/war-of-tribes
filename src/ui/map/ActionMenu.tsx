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
import { useGame } from '@/game/store';
import { useWorld, worldNow } from '@/world/store';
import { FIGURE_BY_ID, FIGURES } from '@/world/data/figures';
import { STANDING_META, TEMPER_BY_ID } from '@/world/data/diplomacy';
import { actionsOf } from '@/world/data/spy';
import { SPY_HELD } from '@/world/data/tuning';
import { RELATION_META } from '@/world/data/meta';
import { formatCoord, formatLeft, secondsLeft } from '@/world/geo';
import { RESOURCE_IDS, RESOURCE_META } from '@/game/constants';
import { troopTotal } from '@/game/battle/kinds';
import type { ResourceId } from '@/game/types';
import type { Loot, OrderActionId, OrderOption } from '@/world/types';

/** Цена приказа теми же значками, что и всюду в игре. Пусто — бесплатно. */
function Price({ cost }: { cost: Loot }) {
  const items = RESOURCE_IDS.filter((r) => (cost as Partial<Record<ResourceId, number>>)[r]);
  if (items.length === 0) return <span className="am-free">даром</span>;
  return (
    <>
      {items.map((r) => (
        <span key={r} className="am-price">
          {RESOURCE_META[r].icon} {(cost as Partial<Record<ResourceId, number>>)[r]}
        </span>
      ))}
    </>
  );
}

/** Шанс словами и числом: у оскорбления это риск, а не удача. */
function chanceText(o: OrderOption, label: string): string | null {
  if (o.chance === null) return null;
  return `${label} ${Math.round(o.chance * 100)}%`;
}

export function ActionMenu() {
  const menu = useWorld((g) => g.menu);
  const orders = useWorld((g) => g.orders);
  const figures = useWorld((g) => g.figures);
  const closeMenu = useWorld((g) => g.closeMenu);
  const moveFigure = useWorld((g) => g.moveFigure);
  const order = useWorld((g) => g.order);
  const attack = useWorld((g) => g.attack);
  const intercept = useWorld((g) => g.intercept);
  const showToast = useGame((g) => g.showToast);
  const openBattle = useGame((g) => g.openBattle);

  if (!menu) return null;
  const def = FIGURE_BY_ID[menu.agent];
  const figure = figures.find((f) => f.id === menu.agent);
  const card = menu.card;
  const here = card ? card.figuresHere.includes(menu.agent) : false;
  const diplo = card?.diplomacy ?? null;
  const standing = diplo ? STANDING_META[diplo.standing] : null;
  const temper = diplo ? TEMPER_BY_ID[diplo.temper] : null;

  const lead = async (): Promise<void> => {
    const err = await moveFigure(menu.agent, menu.cell);
    showToast(err ?? `${def.name} пошёл к ${formatCoord(menu.cell)}.`);
    if (!err) closeMenu();
  };

  const give = async (id: OrderActionId): Promise<void> => {
    const res = await order(id);
    showToast(res.error ?? res.text);
  };

  return (
    <div className="am-wrap" onPointerDown={(e) => e.stopPropagation()}>
      <div className="am">
        <div className="am-head">
          <span className="ico">{def.icon}</span>
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
              {temper.icon} {temper.name}: {temper.note}
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
                <span className="ico">{a.icon}</span>
                <span className="body">
                  <b>{a.name}</b>
                  <i>{o.can ? a.description : o.reason}</i>
                  <em>
                    {chance && <span className="am-chance">{chance}</span>}
                    <span className="am-time">⏳ {formatLeft(o.seconds)}</span>
                    <Price cost={o.cost} />
                    {menu.agent === 'spy' && (
                      // Цена лазутчика — не добро, а риск, и она обязана стоять
                      // рядом с шансом, а не прятаться в описании.
                      <span className="am-risk">провал: задержат на {formatLeft(SPY_HELD / 1000)}</span>
                    )}
                  </em>
                </span>
              </button>
            );
          })}

        {/* Полководец: удар отсюда же, чтобы не гонять игрока по экранам. */}
        {menu.agent === 'general' && menu.target !== null && card && !card.mine && (
          <>
            <button
              className={`am-row${card.can.raid ? '' : ' off'}`}
              disabled={!card.can.raid}
              onClick={() => {
                void (async () => {
                  const err = await attack({ setup: null });
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
              <span className="ico">🎯</span>
              <span className="body">
                <b>Настроить бой</b>
                <i>Расставить по секторам, выбрать план и приказы.</i>
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

        {menu.target === null && (
          <div className="am-plain">Здесь никто не живёт. Приказывать некому — но пройти можно.</div>
        )}

        <button className="am-row lead" disabled={here} onClick={() => void lead()}>
          <span className="ico">{def.icon}</span>
          <span className="body">
            <b>{here ? `${def.name} уже здесь` : `Вести ${def.one} сюда`}</b>
            <i>{here ? 'Дальше приказывай отсюда.' : 'Идти будет столько, сколько велит дорога.'}</i>
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
              {d.icon}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
