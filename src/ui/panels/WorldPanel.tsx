// Карточка клетки карты. Открывается тапом по клетке и живёт в той же нижней шторке,
// что и панели зданий: тап — карточка — действие, без отдельных экранов.
//
// Здесь же собраны все действия фигур: довести сюда, ударить, договориться,
// забрать гарнизон. Отдельного экрана «приказы» нет — приказ отдаётся там, где
// игрок и так смотрит, то есть на клетке.
import { useEffect, useState } from 'react';
import { useGame } from '@/game/store';
import { figuresOn, useWorld, worldNow } from '@/world/store';
import { defense, soldierPower } from '@/game/derived';
import { sendableUnits } from '@/game/sim/expedition';
import { formatCoord, formatLeft, marchSeconds, secondsLeft } from '@/world/geo';
import { formatAge, formatEstimate, PRECISION_NOTE } from '@/world/intel';
import { CAMP_LEAVE } from '@/world/siege';
import { worksWords } from '@/world/works';
import { CASTLE_ICON, MISSIONS, RELATION_META, STAGE_BY_ID } from '@/world/data/meta';
import { DEALS, FIGURES, FIGURE_BY_ID } from '@/world/data/figures';
import { STANDING_META, TEMPER_BY_ID } from '@/world/data/diplomacy';
import { KIND_META, UNIT_KINDS } from '@/battle';
import { TERRAIN_META } from '@/world/data/terrain';
import type { FigureId, Mission, UnitStack } from '@/world/types';
import { UNITS, UNIT_BY_ID, stackSize } from '@/world/data/units';
import { awayOf, homeOf, postureOf, roomOf } from '@/world/muster';
import { troopTotal, type TroopStack } from '@/game/battle/kinds';
import { TROOP_BY_ID, TROOP_IDS } from '@/game/data/troops';
import { Icon } from '@/ui/icons/Icon';

const fmt = (n: number): string => (Math.abs(n) >= 100 ? String(Math.round(n)) : (Math.round(n * 10) / 10).toString());

/**
 * Какие юниты имеют смысл в этой миссии. Набега здесь нет и быть не может: армию
 * водит полководец, а гонцом её больше не отправить (см. `LocalWorld.send`).
 */
const ALLOWED: Record<Mission, ('warrior' | 'scout')[]> = {
  raid: [],
  scout: ['scout'],
  support: ['warrior'],
};

/**
 * Что полководец держит при себе. Правится только вплотную к своей деревне: в
 * поле состав войска не меняется, и это правило игры, а не ограничение панели.
 */
function GarrisonEditor() {
  const s = useGame((g) => g.s);
  const showToast = useGame((g) => g.showToast);
  const marches = useWorld((g) => g.marches);
  const figures = useWorld((g) => g.figures);
  const setGarrison = useWorld((g) => g.setGarrison);
  const general = figures.find((f) => f.id === 'general');
  const held: TroopStack = general?.troops ?? {};
  // Сколько можно держать при себе — всё войско, что не ушло отрядами: дома
  // дружина уже в гарнизоне, и складывать её с ним второй раз нельзя. Тем же
  // правилом отказывает мир (`world/muster.roomOf`).
  const pool = roomOf(s.army, marches);
  const [want, setWant] = useState<TroopStack>(held);
  const [busy, setBusy] = useState(false);

  // Пришёл новый состав из мира — начинаем от него, а не от прошлого выбора.
  const key = TROOP_IDS.map((t) => held[t] ?? 0).join(',');
  useEffect(() => setWant({ ...held }), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!general) return null;
  const rows = TROOP_IDS.filter((t) => (pool[t] ?? 0) + (held[t] ?? 0) > 0);
  const total = troopTotal(want);
  // Вместимость — работа Статуи, и это главное ограничение похода: дома всегда
  // кто-то остаётся, потому что за собой всех не увести.
  const cap = general.capacity;
  const over = Math.max(0, total - cap);
  const gathering = general.readyAt > worldNow();
  const posture = postureOf(general);
  // Три состояния дружины, и за разницу между ними игрок платит: собранная и
  // стоящая у своих ворот — часть гарнизона; пока идёт сбор, эти
  // люди не защищают никого; в поле — не защищают тоже (`world/muster`). Игрок
  // обязан видеть обе цены до того, как отдаст приказ: сколько обороны стоит сам
  // сбор и какой она станет, когда дружина соберётся. Считает та же `defense`,
  // что и всегда, — только для выбранной дружины, а не своей арифметикой рядом.
  const def = defense(s);
  // Не в обороне сверх дружины: отряды в пути. Дружина, стоящая дома, в
  // `warriorsAway` не входит; в сборе и в поле — входит вся.
  const marchesOut = Math.max(0, s.warriorsAway - (posture === 'stands' ? 0 : troopTotal(held)));
  // В сборе числятся все, кого он касается, — те же `max(было, станет)` по видам,
  // что кладёт в дружину сам мир (`setGarrison`). Ничего не меняется — сбора нет.
  let onRoad = 0;
  let moved = 0;
  for (const t of TROOP_IDS) {
    onRoad += Math.max(held[t] ?? 0, want[t] ?? 0);
    moved += Math.abs((held[t] ?? 0) - (want[t] ?? 0));
  }
  const during = defense({ ...s, warriorsAway: marchesOut + onRoad });
  const after = defense({ ...s, warriorsAway: marchesOut });
  const apply = async (next: TroopStack | null): Promise<void> => {
    setBusy(true);
    const err = await setGarrison(next);
    setBusy(false);
    showToast(err ?? (troopTotal(next ?? {}) > 0 ? 'Дружина при полководце.' : 'Дружина вернулась в деревню.'));
  };

  return (
    <>
      <h3>
        Дружина при полководце{' '}
        <small className={over > 0 ? 'bad' : undefined}>
          {total} из {cap}
        </small>
      </h3>
      {gathering ? (
        <p className="note bad">
          Идёт сбор: ещё {formatLeft(secondsLeft(general.readyAt, worldNow()))}. Пока он идёт, все{' '}
          {troopTotal(held)} не защищают деревню ни как гарнизон, ни как дружина — и в бой не годятся.
        </p>
      ) : posture === 'stands' ? (
        <p className="note">
          Собрана и дома: {troopTotal(held)} — часть гарнизона: у частокола, у амбара, на вылазке и под
          рассеянием, если город падёт.
        </p>
      ) : posture === 'engaged' ? (
        <p className="note bad">Дружина занята: пока полководец в пути или в поле, деревню она не защищает.</p>
      ) : null}
      {rows.length === 0 ? (
        <div className="desc">Бойцов нет ни дома, ни при нём. Найми кого-нибудь в казармах.</div>
      ) : (
        rows.map((t) => {
          // Больше вместимости не набрать: шаг вверх упирается в неё, а не в
          // ошибку после нажатия.
          const room = Math.max(0, cap - total + (want[t] ?? 0));
          // «Всего» — про запас племени, а не про место в отряде: подпись не
          // должна врать, что лучников нет, когда их просто некуда взять.
          const all = pool[t] ?? 0;
          const max = Math.min(room, all);
          const n = want[t] ?? 0;
          const set = (v: number): void => setWant((w) => ({ ...w, [t]: Math.max(0, Math.min(max, v)) }));
          return (
            <div className="slot pick" key={t}>
              <span className="ico">
                <Icon name={`troop-${t}`} glyph={TROOP_BY_ID[t].icon} />
              </span>
              <span className="who">
                {TROOP_BY_ID[t].name}
                <i className="talent">
                  всего {all}
                  {room === 0 && (want[t] ?? 0) === 0 ? ' · мест нет' : ''}
                </i>
              </span>
              <div className="stepper">
                <button disabled={n <= 0} onClick={() => set(n - 1)}>
                  −
                </button>
                <span className="n">{n}</span>
                <button disabled={n >= max} onClick={() => set(n + 1)}>
                  +
                </button>
              </div>
              <button className="mini text" disabled={n >= max} onClick={() => set(max)}>
                все
              </button>
            </div>
          );
        })
      )}
      <div className="mod-list">
        <div className="mod">
          <span className="ico">🗿</span>
          <span className="name">Статуя держит</span>
          <span className={`val ${over > 0 ? 'neg' : ''}`}>{cap} бойцов</span>
        </div>
        {moved > 0 && (
          <div className="mod">
            <span className="ico">⏳</span>
            <span className="name">Пока идёт сбор, оборона</span>
            <span className={`val ${during < def * 0.5 ? 'neg' : ''}`}>
              {Math.round(def)} → {Math.round(during)}
            </span>
          </div>
        )}
        <div className="mod total">
          <span className="ico"><Icon name="ui-home" glyph="🏠" /></span>
          <span className="name">Соберётся и встанет дома — оборона</span>
          <span className="val">{Math.round(after)}</span>
        </div>
      </div>
      <div className="wm-actions">
        <button className="btn wide" disabled={busy || gathering || over > 0} onClick={() => void apply(want)}>
          🎖️ Отдать полководцу {total}
        </button>
        <button
          className="btn ghost wide"
          disabled={busy || gathering || troopTotal(held) === 0}
          onClick={() => void apply(null)}
        >
          <Icon name="ui-home" glyph="🏠" /> Вернуть всю дружину домой
        </button>
      </div>
      <p className="note">
        Дружина, собранная и стоящая у своих ворот, — часть гарнизона: держит стену и выходит на вылазку. Пока идёт сбор или
        роспуск, эти люди не защищают никого, а уведёшь полководца в поле — дома останутся частокол, башня,
        жители и те, кого он не взял. Статуя ограничивает не оборону, а то, сколько бойцов можно вывести из
        города.
      </p>
    </>
  );
}

export function WorldPanel({ x, y }: { x: number; y: number }) {
  const s = useGame((g) => g.s);
  const closeMap = useGame((g) => g.closeMap);
  const showToast = useGame((g) => g.showToast);
  const openBattle = useGame((g) => g.openBattle);
  const openDefense = useGame((g) => g.openDefense);
  const card = useWorld((g) => g.card);
  const terrain = useWorld((g) => g.cardTerrain);
  const loading = useWorld((g) => g.cardLoading);
  const send = useWorld((g) => g.send);
  const figures = useWorld((g) => g.figures);
  const marches = useWorld((g) => g.marches);
  const moveFigure = useWorld((g) => g.moveFigure);
  const attack = useWorld((g) => g.attack);
  const besiege = useWorld((g) => g.besiege);
  const negotiate = useWorld((g) => g.negotiate);
  const openMenu = useWorld((g) => g.openMenu);
  const [mission, setMission] = useState<Mission | null>(null);
  const [pick, setPick] = useState<UnitStack>({});
  const [busy, setBusy] = useState(false);

  // Новая клетка — новый выбор: состав отряда от прошлой цели тут ни при чём.
  useEffect(() => {
    setMission(null);
    setPick({});
  }, [x, y]);

  const here = { x, y };
  const home = useWorld((g) => g.info?.home ?? null);
  const homeDist = home ? Math.hypot(home.x - x, home.y - y) : 0;

  /** Кнопки «вести сюда»: одна на фигуру, кроме тех, что уже здесь. */
  const lead = (standing: FigureId[]): JSX.Element => (
    <div className="wm-actions">
      {FIGURES.filter((d) => !standing.includes(d.id)).map((d) => {
        const f = figures.find((v) => v.id === d.id);
        const down = f?.phase === 'down';
        return (
          <button
            key={d.id}
            className="btn ghost"
            disabled={down || busy}
            onClick={() => {
              void (async () => {
                setBusy(true);
                const err = await moveFigure(d.id, here);
                setBusy(false);
                showToast(err ?? `${d.name} пошёл к ${formatCoord(here)}.`);
              })();
            }}
          >
            <Icon name={`fig-${d.id}`} glyph={d.icon} /> {down ? `${d.name}: ранен ${formatLeft(secondsLeft(f?.downUntil ?? 0, worldNow()))}` : `Вести ${d.one}`}
          </button>
        );
      })}
    </div>
  );

  if (!card) {
    const standing = figuresOn(x, y, worldNow()).map((f) => f.id);
    return (
      <div className="panel">
        <h2>
          Пустая земля <small>{formatCoord(here)}</small>
        </h2>
        <div className="desc">
          {loading
            ? 'Смотрим, кто здесь…'
            : `${terrain ? TERRAIN_META[terrain].name : 'Земля'}. Здесь никто не живёт — но пройти через это место можно.`}
        </div>
        <div className="mod-list">
          <div className="mod">
            <span className="ico"><Icon name="ui-ruler" glyph="📏" /></span>
            <span className="name">От нашей деревни</span>
            <span className="val">{fmt(homeDist)} кл.</span>
          </div>
        </div>
        {standing.length > 0 && (
          <p className="note">Здесь стоят: {standing.map((id) => FIGURE_BY_ID[id].name).join(', ')}.</p>
        )}
        <h3>Кого вести сюда</h3>
        {lead(standing)}
      </div>
    );
  }

  const stage = STAGE_BY_ID[card.stage];
  const relation = RELATION_META[card.relation];

  // Пепелище: карточка короткая, потому что говорить про него больше нечего.
  // Ни войска, ни владельца, ни договоров — и ни одной погасшей кнопки: занять
  // его нельзя, а показывать выключенный набег значило бы обещать действие,
  // которого нет. Единственное, что тут есть, — что победа была и что след
  // сойдёт сам.
  if (card.ruin) {
    return (
      <div className="panel">
        <div className="bhead">
          <div className="ico">🔥</div>
          <div className="body">
            <div className="name">{card.name}</div>
            <div className="lvl">Пепелище</div>
          </div>
          <span className="wm-coord-tag">{formatCoord(card)}</span>
        </div>
        <div className="mod-list">
          <div className="mod">
            <span className="ico"><Icon name="ui-ruler" glyph="📏" /></span>
            <span className="name">Расстояние</span>
            <span className="val">{fmt(card.distance)} кл.</span>
          </div>
          <div className="mod">
            <span className="ico">⌛</span>
            <span className="name">След сойдёт через</span>
            <span className="val">{formatLeft(card.ruinLeft)}</span>
          </div>
        </div>
        <p className="note">{card.note}</p>
      </div>
    );
  }

  // Отряд уходит из гарнизона: дружина, стоящая у ворот, в обороне, но за ворота
  // гонцом не выходит — мир такой приказ не примет (`LocalWorld.send`).
  const have = { ...sendableUnits(s), warrior: troopTotal(homeOf(s.army, awayOf(marches, figures))) };
  const strength = soldierPower(s);
  const def = defense(s);
  const picked = { warrior: pick.warrior ?? 0, scout: pick.scout ?? 0 };
  const eta = marchSeconds(card.distance, card.terrainFactor, picked);
  const defAfter = Math.max(0, def - picked.warrior * (strength + 0.25) - picked.scout * 0.25);
  const standing = card.figuresHere;
  const general = figures.find((f) => f.id === 'general');
  const generalMen = troopTotal(general?.troops ?? {});

  const setUnit = (id: 'warrior' | 'scout', n: number): void => {
    setPick((p) => ({ ...p, [id]: Math.max(0, Math.min(have[id], n)) }));
  };

  const start = (m: Mission): void => {
    setMission(m);
    // Разведку обычно шлют вдвоём — так один потерянный не срывает всё дело.
    setPick(m === 'scout' ? { scout: Math.min(2, have.scout) } : { warrior: have.warrior });
  };

  /**
   * Быстрая атака: полководец бьёт тем, что при нём, расстановку выберет пресет
   * по сиду. Пресета четыре — противник не знает, какой из них пришёл.
   */
  const quickStrike = async (): Promise<void> => {
    setBusy(true);
    const err = await attack({ setup: null });
    setBusy(false);
    showToast(err ?? 'Дружина ударила. Отчёт в походах.');
  };

  const doSend = async (): Promise<void> => {
    if (!mission) return;
    setBusy(true);
    const err = await send({ target: card.id, mission, units: picked });
    setBusy(false);
    if (err) {
      showToast(err);
      return;
    }
    setMission(null);
    setPick({});
    showToast('Отряд вышел.');
  };

  const doDeal = async (id: (typeof DEALS)[number]['id']): Promise<void> => {
    setBusy(true);
    const err = await negotiate(id);
    setBusy(false);
    showToast(err ?? 'Договор подписан.');
  };

  return (
    <div className="panel">
      <div className="bhead">
        <div className="ico">
          <Icon
            name={card.castle ? 'stage-castle' : `stage-${stage.id}`}
            glyph={card.castle ? CASTLE_ICON : stage.icon}
          />
        </div>
        <div className="body">
          <div className="name">{card.name}</div>
          <div className="lvl">
            {card.castle ? 'Замок' : stage.name} ·{' '}
            <span style={{ color: relation.color }}>{relation.name}</span>
          </div>
        </div>
        <span className="wm-coord-tag">{formatCoord(card)}</span>
      </div>

      <div className="mod-list">
        <div className="mod">
          <span className="ico"><Icon name="ui-person" glyph="👤" /></span>
          <span className="name">Владелец</span>
          <span className="val">{card.owner ?? 'ничей'}</span>
        </div>
        <div className="mod">
          <span className="ico">🏳️</span>
          <span className="name">Племя</span>
          <span className="val" style={{ color: relation.color }}>
            {card.tribeName ?? 'нет'}
          </span>
        </div>
        <div className="mod">
          <span className="ico"><Icon name="ui-ruler" glyph="📏" /></span>
          <span className="name">Расстояние</span>
          <span className="val">{fmt(card.distance)} кл.</span>
        </div>
        <div className="mod">
          <span className="ico">👣</span>
          <span className="name">Ход разведки</span>
          <span className="val">{formatLeft(marchSeconds(card.distance, card.terrainFactor, { scout: 1 }))}</span>
        </div>
      </div>

      {/* Второй слой тумана словами. Здесь легко соврать, и врали: строка
          говорила «что там теперь, неизвестно» ровно над точным числом от
          разведчика, стоящего у ворот. Числа под ней — не наблюдение, а
          донесение: они из снимка (`readIntel` читает только снимок и часы,
          мира она не видит), и у них своя отметка возраста ниже. Поэтому
          говорим прямо, ЧТО именно неизвестно — живые данные, — и не
          распространяем это на разведку.

          Здесь же сказано, чем живой обзор чинится: правило, которое нигде не
          написано словами, игрок читает как поломку. */}
      {!card.mine && (
        <p className={`note${card.visible ? '' : ' bad'}`}>
          {card.visible
            ? 'Место в обзоре: видно, что там сейчас.'
            : card.stale && card.seenAt
              ? `Живьём сюда никто не смотрит: кто там живёт и выходит ли войско — по последнему взгляду, ${formatAge((worldNow() - card.seenAt) / 1000)}.`
              : 'Живьём сюда никто не смотрит, и в последний раз никто не смотрел.'}
          {!card.visible && card.figuresHere.includes('scout') && (
            <> Войско при этом считает разведчик у ворот: числа ниже — его донесение, а не наблюдение.</>
          )}
          {!card.visible &&
            (card.figuresHere.includes('spy') ? (
              <> Лазутчик уже здесь — поставь его наблюдателем, и будет видно живьём.</>
            ) : (
              <> Смотреть живьём может только лазутчик: доведи его и поставь наблюдателем.</>
            ))}
        </p>
      )}

      <h3>Войско</h3>
      <div className="mod-list">
        <div className="mod">
          <span className="ico">⚔️</span>
          <span className="name">Мощь</span>
          <span className={`val ${card.power.precision === 'unknown' ? 'neg' : ''}`}>
            {formatEstimate(card.power)}
          </span>
        </div>
        <div className="mod">
          <span className="ico">👥</span>
          <span className="name">Население</span>
          <span className="val">{formatEstimate(card.pop)}</span>
        </div>
        {/* Сколько можно взять — такие же разведданные, как численность, и
            стареют они так же. Это **открытая** часть склада: подпол разведчик
            не считает, и числа тайника здесь нет ни у кого, кроме своей
            деревни (см. `LocalWorld.lootOpen`). */}
        <div className="mod">
          <span className="ico"><Icon name="ui-loot" glyph="📦" /></span>
          <span className="name">Можно взять</span>
          <span className={`val ${card.loot.precision === 'unknown' ? 'neg' : ''}`}>
            {formatEstimate(card.loot)}
          </span>
        </div>
        {card.visible && card.marching && (
          <div className="mod total">
            <span className="ico"><Icon name="ui-banner" glyph="🚩" /></span>
            <span className="name">Оттуда выходит войско</span>
            <span className="val neg">видим</span>
          </div>
        )}
      </div>
      {!card.mine && (
        <p className="note">
          Победитель забирает со склада всё, кроме того, что помещается в тайник, и не
          больше, чем поднимет отряд. Сколько прячет их тайник — не узнать ни разведкой,
          ни боем: узнаётся только то, что осталось на виду.
        </p>
      )}
      {card.castle && (
        <p className="note">
          В замке казна: удачный набег приносит золото — тем больше, чем сильнее разбит гарнизон.
          Гарнизон здесь крепче обычного, и слабый отряд вернётся ни с чем.
        </p>
      )}
      {card.mine ? (
        <p className="note">Свои силы видны всегда. Чужие — только после разведки.</p>
      ) : card.intel ? (
        <p className={`note${card.intel.precision === 'exact' ? '' : ' bad'}`}>
          Данные получены {formatAge(card.intel.ageSeconds)} —{' '}
          {/* «Приблизительно» и «протухло» — разные вещи, и путать их нельзя:
              донесение лазутчика вилкой с самого начала, а не устарело. */}
          {card.intel.hearsay
            ? `донесение лазутчика: числа приблизительны с самого начала${card.intel.precision === 'vague' ? ', и с возрастом от них остался только порядок величины' : ''}`
            : PRECISION_NOTE[card.intel.precision]}
          .
        </p>
      ) : (
        <p className="note bad">Про войско здесь мы ничего не знаем. Нужен разведчик у самых ворот.</p>
      )}

      {/* Донесение лазутчика: числа вилкой и с датой. Точного числа здесь не
          бывает — и это сказано словами, чтобы игрок не принял вилку за старение. */}
      {card.intel?.kinds && (
        <>
          <h3>
            Донесение <small>{formatAge(card.intel.ageSeconds)}</small>
          </h3>
          <div className="mod-list">
            {UNIT_KINDS.map((k) => {
              const e = card.intel?.kinds?.[k];
              return (
                <div className="mod" key={k}>
                  <span className="ico">{KIND_META[k].icon}</span>
                  <span className="name">{KIND_META[k].name}</span>
                  <span className={`val${e ? '' : ' neg'}`}>{e ? formatEstimate(e) : 'не разглядели'}</span>
                </div>
              );
            })}
          </div>
          {card.intel.style && <p className="note">Уклад войска: {card.intel.style}.</p>}
        </>
      )}

      {/*
        Лагерь под стенами. Часов голода здесь нет и быть не может: сколько
        хлеба у чужого города, игрок не знает — ни глазами, ни разведкой. Он
        видит, что осада идёт, и узнает о её конце вместе с городом. Свою осаду
        он видит с часами, но в другом месте и по своему складу.
      */}
      {card.siege && (
        <>
          <h3>Осада</h3>
          <div className="mod-list">
            <div className="mod total">
              <span className="ico">⛺</span>
              <span className="name">
                {card.siege.mine ? 'Наш лагерь у стен, стоит' : `Лагерь «${card.siege.byName}», стоит`}
              </span>
              {/* Сколько лагерь уже стоит, а не сколько ему осталось: срок знает
                  только тот, чей это склад. */}
              <span className="val">{formatLeft(Math.max(0, (worldNow() - card.siege.since) / 1000))}</span>
            </div>
          </div>
          <p className="note">
            {card.siege.mine
              ? 'Приток в городе срезан, хлеб убывает. Сколько его осталось — не узнать: узнаем вместе с ними. Уведёшь полководца — осада снята.'
              : 'Под этими стенами уже стоит чужой лагерь. Разобьёшь его — осада снята.'}
          </p>
          {/* Укрепления лагеря видны глазами — и нашего, и чужого. Читаются из
              той же отметки `since`, той же функцией, что и бой у лагеря. */}
          <p className="note">{worksWords(card.siege, worldNow())}</p>
        </>
      )}

      {/* Разорение — след нашей же победы. Часов у чужого двора нет и здесь: их
          не показывает мир (см. `CardSack`), а панель их не выдумывает. Что
          видно глазами — то и написано словами. */}
      {card.sack && (
        <>
          <h3>Разорено</h3>
          <div className="mod-list">
            <div className="mod total">
              <span className="ico">🔥</span>
              <span className="name">Хозяйство стоит, гарнизон поредел</span>
              <span className="val">{card.sack.look}</span>
            </div>
          </div>
          <p className="note">
            Здесь уже побывали: двор не растёт, а склад вычищен до тайника — брать сейчас
            почти нечего. Отстроится сам.
          </p>
        </>
      )}

      {/* Бунт — окно для удара, а не пакость сама по себе. */}
      {card.revolt && (
        <>
          <h3>Бунт</h3>
          <div className="mod-list">
            <div className="mod total">
              <span className="ico">🔥</span>
              <span className="name">Работы встали, гарнизон слабее</span>
              <span className="val pos">−{Math.round(card.revolt.power * 100)}%</span>
            </div>
            <div className="mod">
              <span className="ico">⏳</span>
              <span className="name">Окно закроется через</span>
              <span className="val">{formatLeft(secondsLeft(card.revolt.until, worldNow()))}</span>
            </div>
          </div>
          <p className="note">
            Пока идёт бунт, поселение не растёт и запасы в нём не копятся. Это время для удара, а не
            для ожидания.
          </p>
        </>
      )}

      {/* Отношения именно с этим двором: состояние, число и характер владельца.
          Число рядом со словами нарочно: по слову понятно направление, по числу —
          далеко ли до согласия. */}
      {card.diplomacy && (
        <>
          <h3>Отношения</h3>
          <div className="mod-list">
            <div className="mod total">
              <span className="ico">
                <Icon
                  name={`state-${card.diplomacy.standing}`}
                  glyph={STANDING_META[card.diplomacy.standing].icon}
                />
              </span>
              <span className="name">{STANDING_META[card.diplomacy.standing].name}</span>
              <span className="val" style={{ color: STANDING_META[card.diplomacy.standing].color }}>
                {card.diplomacy.attitude > 0 ? `+${card.diplomacy.attitude}` : card.diplomacy.attitude}
              </span>
            </div>
            <div className="mod">
              <span className="ico">🤝</span>
              <span className="name">Как нас встречают</span>
              <span className="val">{card.diplomacy.mood}</span>
            </div>
            <div className="mod">
              <span className="ico">
                <Icon
                  name={`temper-${card.diplomacy.temper}`}
                  glyph={TEMPER_BY_ID[card.diplomacy.temper].icon}
                />
              </span>
              <span className="name">Характер владельца</span>
              <span className="val">{TEMPER_BY_ID[card.diplomacy.temper].name}</span>
            </div>
            {card.diplomacy.standing === 'pact' && card.diplomacy.breakAt > 0 && (
              <div className="mod total">
                <span className="ico">⏳</span>
                <span className="name">Пакт разорван, война через</span>
                <span className="val neg">{formatLeft(secondsLeft(card.diplomacy.breakAt, worldNow()))}</span>
              </div>
            )}
            {card.diplomacy.standing === 'pact' && card.diplomacy.breakAt === 0 && card.diplomacy.until > 0 && (
              <div className="mod">
                <span className="ico"><Icon name="ui-scroll" glyph="📜" /></span>
                <span className="name">Пакт держится ещё</span>
                <span className="val pos">{formatLeft(secondsLeft(card.diplomacy.until, worldNow()))}</span>
              </div>
            )}
          </div>
          <p className="note">{TEMPER_BY_ID[card.diplomacy.temper].note}</p>
          {/* Отношение само собой не выправляется — ни временем, ни окончанием
              войны, и это правило, а не недосмотр (docs/MAP_ACTIONS.md). Раз так,
              игроку надо прямо сказать, чем оно выправляется: минус на шкале без
              этой строки читается как запертая навсегда дверь. Особенно после
              письма, разрешившегося молчанием: там сосед холодеет сам, без
              единого действия игрока, и выход обязан быть виден. */}
          {(card.diplomacy.attitude < 0 || card.diplomacy.standing === 'war') && (
            <p className="note">
              Отношение само не выправляется: ни со временем, ни после войны. Поднимает его
              дар — доведи дипломата к этим воротам и поднеси добра.
              {card.diplomacy.standing === 'war'
                ? ' Мир предлагает он же, и разбитый гарнизон соглашается охотнее.'
                : ''}
            </p>
          )}
        </>
      )}

      {card.deals.length > 0 && (
        <>
          <h3>Договоры с племенем</h3>
          <div className="mod-list">
            {card.deals.map((d) => (
              <div className="mod" key={d.id}>
                <span className="ico">
                  <Icon name={`deal-${d.id}`} glyph={DEALS.find((x) => x.id === d.id)?.icon ?? ''} />
                </span>
                <span className="name">{DEALS.find((x) => x.id === d.id)?.name}</span>
                <span className="val pos">{formatLeft(secondsLeft(d.until, worldNow()))}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <h3>Что делать</h3>
      <div className="wm-actions">
        {!card.mine &&
          standing.map((id) => (
            <button
              key={id}
              className="btn wide"
              onClick={() => void openMenu(id, { x: card.x, y: card.y })}
            >
              {FIGURE_BY_ID[id].icon} Приказы: {FIGURE_BY_ID[id].name.toLowerCase()}
            </button>
          ))}
        {card.can.open && (
          <>
            <button className="btn wide" onClick={closeMap}>
              🏘️ Открыть деревню
            </button>
            <button className="btn ghost wide" onClick={openDefense}>
              🛡️ Оборона деревни
            </button>
          </>
        )}
        {card.can.raid && (
          <>
            {/* Полководец здесь и войско при нём — только теперь и можно ударить. */}
            <button className="btn wide" disabled={busy} onClick={() => void quickStrike()}>
              ⚔️ Ударить сразу · {generalMen} бойцов
            </button>
            <button className="btn ghost wide" onClick={() => openBattle(card.id)}>
              <Icon name="ui-target" glyph="🎯" /> Настроить бой
            </button>
          </>
        )}
        {/* Осада — второй способ взять город, и выбирают между ними здесь же. */}
        {card.can.besiege && (
          <button
            className="btn ghost wide"
            disabled={busy}
            onClick={() => {
              void (async () => {
                setBusy(true);
                const err = await besiege();
                setBusy(false);
                showToast(err ?? `Дружина обложила ${card.name}. ${CAMP_LEAVE}`);
              })();
            }}
          >
            ⛺ Осадить · {CAMP_LEAVE}
          </button>
        )}
        {MISSIONS.filter((m) => m.id !== 'raid' && card.can[m.id]).map((m) => (
          <button
            key={m.id}
            className={`btn${mission === m.id ? '' : ' ghost'}`}
            // Проводка ведёт к разведке: пока миссия не выбрана — к этой кнопке,
            // потом — к кнопке отправки ниже (см. data-tut там).
            data-tut={m.id === 'scout' && mission !== 'scout' ? 'scout' : undefined}
            onClick={() => (mission === m.id ? setMission(null) : start(m.id))}
          >
            {m.icon} {m.name}
          </button>
        ))}
      </div>
      {!card.mine && card.note && <p className="note">{card.note}</p>}

      {/* Своя деревня — единственное место, где полководец меняет состав войска. */}
      {card.mine && standing.includes('general') && <GarrisonEditor />}

      {standing.includes('scout') && !card.mine && (
        <p className="note">👣 Разведчик стоит у ворот и считает войско: данные обновляются, пока он здесь.</p>
      )}

      {standing.includes('diplomat') && !card.mine && card.tribeId && (
        <>
          <h3>Союзы с племенем</h3>
          <p className="note">
            Это договоры со всем племенем. Отношения с самим двором — война, пакт, дар, оскорбление —
            в приказах дипломату выше.
          </p>
          {DEALS.map((d) => (
            <div className="card" key={d.id}>
              <div className="ico">{d.icon}</div>
              <div className="body">
                <div className="title">{d.name}</div>
                <div className="desc">{d.description}</div>
                <div className="cost">
                  <button className="mini text" disabled={busy} onClick={() => void doDeal(d.id)}>
                    Предложить
                  </button>
                  <span className="work">вражда не выше {d.maxHostility}</span>
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      <h3>Кого вести сюда</h3>
      {lead(standing)}

      {mission && (
        <>
          <h3>Отряд</h3>
          {ALLOWED[mission].map((id) => {
            const def0 = UNIT_BY_ID[id];
            const max = have[id];
            const n = picked[id];
            return (
              <div className="slot pick" key={id}>
                <span className="ico">{def0.icon}</span>
                <span className="who">
                  {def0.name}
                  <i className="talent">дома {max}</i>
                </span>
                <div className="stepper">
                  <button disabled={n <= 0} onClick={() => setUnit(id, n - 1)}>
                    −
                  </button>
                  <span className="n">{n}</span>
                  <button disabled={n >= max} onClick={() => setUnit(id, n + 1)}>
                    +
                  </button>
                </div>
                <button className="mini text" disabled={max <= 0 || n >= max} onClick={() => setUnit(id, max)}>
                  все
                </button>
              </div>
            );
          })}

          <div className="mod-list">
            <div className="mod">
              <span className="ico">⏱</span>
              <span className="name">Дорога туда</span>
              <span className="val">{stackSize(picked) > 0 ? formatLeft(eta) : '—'}</span>
            </div>
            <div className="mod">
              <span className="ico">↩️</span>
              <span className="name">И столько же обратно</span>
              <span className="val">{stackSize(picked) > 0 ? formatLeft(eta) : '—'}</span>
            </div>
            <div className="mod total">
              <span className="ico"><Icon name="ui-home" glyph="🏠" /></span>
              <span className="name">Оборона деревни станет</span>
              <span className={`val ${defAfter < def * 0.5 ? 'neg' : ''}`}>
                {fmt(def)} → {fmt(defAfter)}
              </span>
            </div>
          </div>
          <p className={`note${picked.warrior > 0 ? ' bad' : ''}`}>
            {picked.warrior > 0
              ? 'Пока отряд в пути, эти воины деревню не защищают. Отозвать можно в любой момент.'
              : 'Разведчики уходят из строителей: стройка на это время замедлится.'}
          </p>

          <button
            className="btn wide"
            data-tut={mission === 'scout' ? 'scout' : undefined}
            disabled={busy || stackSize(picked) === 0}
            onClick={() => void doSend()}
          >
            {MISSIONS.find((m) => m.id === mission)?.icon} Отправить{' '}
            {UNITS.filter((u) => picked[u.id] > 0)
              .map((u) => `${u.icon}${picked[u.id]}`)
              .join(' ')}
          </button>
        </>
      )}
    </div>
  );
}
