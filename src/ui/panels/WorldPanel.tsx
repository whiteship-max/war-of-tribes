// Карточка клетки карты. Открывается тапом по клетке и живёт в той же нижней шторке,
// что и панели зданий: тап — карточка — действие, без отдельных экранов.
//
// Здесь же собраны все действия фигур: довести сюда, ударить, договориться,
// забрать гарнизон. Отдельного экрана «приказы» нет — приказ отдаётся там, где
// игрок и так смотрит, то есть на клетке.
import { useEffect, useState } from 'react';
import { useGame } from '@/game/store';
import { figuresOn, useWorld, worldNow } from '@/world/store';
import { defense } from '@/game/derived';
import { sendableUnits } from '@/game/sim/expedition';
import { formatCoord, marchSeconds, secondsLeft } from '@/world/geo';
import { realLeft, waitLeft, waitShort } from '@/ui/parts/wait';
import { formatAge, formatEstimate, PRECISION_NOTE } from '@/world/intel';
import { CAMP_LEAVE } from '@/world/siege';
import { worksWords } from '@/world/works';
import { FATE_DEFAULT } from '@/world/spoils';
import { FATE_META } from '@/world/data/fates';
import { FELL_WORDS } from '@/ui/map/siegemark';
import { hungerLeft } from '@/ui/parts/hunger';
import { FatePick } from '@/ui/parts/FatePick';
import { GarrisonEditor } from '@/ui/parts/GarrisonEditor';
import { CASTLE_ICON, MISSIONS, RELATION_META, STAGE_BY_ID } from '@/world/data/meta';
import { DEALS, FIGURES, FIGURE_BY_ID } from '@/world/data/figures';
import { STANDING_META, TEMPER_BY_ID } from '@/world/data/diplomacy';
import { KIND_META, UNIT_KINDS } from '@/battle';
import { TERRAIN_META } from '@/world/data/terrain';
import type { Fate, FigureId, Mission, UnitStack } from '@/world/types';
import { UNIT_BY_ID, stackSize } from '@/world/data/units';
import { awayOf, homeOf } from '@/world/muster';
import { awayTroops } from '@/world/bridge';
import { troopTotal } from '@/game/battle/kinds';
import { Icon } from '@/ui/icons/Icon';
import { count } from '@/ui/parts/plural';
import { beyondText, reachable } from '@/ui/map/twslot';

const fmt = (n: number): string => (Math.abs(n) >= 100 ? String(Math.round(n)) : (Math.round(n * 10) / 10).toString().replace('.', ','));

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
 * Редактор состава дружины в карточке своего города — дверь для карточки нового вида (`next/WorldNew`): редактор один
 * и показан в двух местах, карточке замка и Статуе (`GarrisonEditor.test.ts`).
 */
export const OwnGarrison = (): JSX.Element => <GarrisonEditor />;

export function WorldPanel({ x, y }: { x: number; y: number }) {
  const s = useGame((g) => g.s);
  const closeMap = useGame((g) => g.closeMap);
  const showToast = useGame((g) => g.showToast);
  const card = useWorld((g) => g.card);
  const terrain = useWorld((g) => g.cardTerrain);
  const loading = useWorld((g) => g.cardLoading);
  const send = useWorld((g) => g.send);
  const figures = useWorld((g) => g.figures);
  const marches = useWorld((g) => g.marches);
  const moveFigure = useWorld((g) => g.moveFigure);
  const shelter = useWorld((g) => g.shelter);
  const attack = useWorld((g) => g.attack);
  const besiege = useWorld((g) => g.besiege);
  const negotiate = useWorld((g) => g.negotiate);
  const openMenu = useWorld((g) => g.openMenu);
  const openSiege = useGame((g) => g.openSiege);
  const openCamp = useGame((g) => g.openCamp);
  const [mission, setMission] = useState<Mission | null>(null);
  const [pick, setPick] = useState<UnitStack>({});
  const [busy, setBusy] = useState(false);
  // Участь города объявляется ударом или осадой — этим же выбором.
  const [fate, setFate] = useState<Fate>(FATE_DEFAULT);

  // Новая клетка — новый выбор: состав отряда и участь от прошлой цели тут ни при чём.
  useEffect(() => {
    setMission(null);
    setPick({});
    setFate(FATE_DEFAULT);
  }, [x, y]);

  const here = { x, y };
  const home = useWorld((g) => g.info?.home ?? null);
  const homeDist = home ? Math.hypot(home.x - x, home.y - y) : 0;

  /**
   * Кнопки «вести сюда»: одна на фигуру, кроме тех, что уже здесь. Укрывшийся в
   * своём городе у своих же ворот и так стоит — в карточке своего города у него
   * вместо «вести» выход.
   */
  const lead = (standing: FigureId[]): JSX.Element => (
    <div className="wm-actions">
      {FIGURES.filter((d) => !standing.includes(d.id)).map((d) => {
        const f = figures.find((v) => v.id === d.id);
        const down = f?.phase === 'down';
        if (card?.mine && f?.place === 'city') {
          return (
            <button
              key={d.id}
              className="btn ghost"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  const err = await shelter(d.id, false);
                  setBusy(false);
                  showToast(err ?? `${d.name} вышел из города.`);
                })();
              }}
            >
              <Icon name={`fig-${d.id}`} glyph={d.icon} /> Вывести {d.one}
            </button>
          );
        }
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
            <Icon name={`fig-${d.id}`} glyph={d.icon} />{' '}
            {f?.place === 'vacant'
              ? `Нет ${d.one}`
              : down
                ? `${d.name} ${f?.held ? 'задержан' : 'вне строя'} · ${realLeft(secondsLeft(f?.downUntil ?? 0, worldNow()))}`
                : `Вести ${d.one}`}
          </button>
        );
      })}
    </div>
  );

  // Карта по регионам (docs/map_tw.md, раздел 13.5): за краем региона игрока целей нет — карточка говорит, что это
  // за место, и ни одного приказа не предлагает. Прежняя карта рамки не знает, и для неё всё по-прежнему.
  if (!reachable(here)) {
    return (
      <div className="panel">
        <h2>
          {card?.name ?? 'Чужой край'} <small>{formatCoord(here)}</small>
        </h2>
        <div className="desc">{beyondText()}</div>
      </div>
    );
  }

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
            : `${terrain ? TERRAIN_META[terrain].name : 'Земля'}. Пройти можно.`}
        </div>
        <div className="mod-list">
          <div className="mod">
            <span className="ico"><Icon name="ui-ruler" glyph="📏" /></span>
            <span className="name">От города</span>
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
            <div className="name one-line">{card.name}</div>
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
            <span className="val">{realLeft(card.ruinLeft)}</span>
          </div>
        </div>
        <p className="note">{card.note}</p>
      </div>
    );
  }

  // Отряд уходит из гарнизона: дружина, стоящая у ворот, в обороне, но за ворота
  // гонцом не выходит — мир такой приказ не примет (`LocalWorld.send`).
  const who = awayOf(marches, figures);
  const have = { ...sendableUnits(s), warrior: troopTotal(homeOf(s.army, who)) };
  const def = defense(s);
  const picked = { warrior: pick.warrior ?? 0, scout: pick.scout ?? 0 };
  const eta = marchSeconds(card.distance, card.terrainFactor, picked);
  // Оборона после отправки — та же `defense`, только без ушедших: воины без состава
  // уходят слабыми из гарнизона (`muster.homeOf`), как их снимет мир, разведчики —
  // из жителей. Своей арифметики «минус средний боец» здесь нет.
  const defAfter = defense({
    ...s,
    away: awayTroops(s.army, { ...who, loose: who.loose + picked.warrior }),
    scoutsAway: s.scoutsAway + picked.scout,
  });
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
   * Удар: полководец бьёт тем, что при нём, и встают они по правилу развёртывания. Удар один —
   * «Настроить бой» и «Быструю атаку» больше не различают (docs/battle_eu4.md, 14.5).
   */
  const strike = async (): Promise<void> => {
    setBusy(true);
    const err = await attack({ fate });
    setBusy(false);
    showToast(err ?? 'Отряд ударил. Донесение в походах.');
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
    showToast(`Отряд вышел. В пути ${waitShort(eta)}.`);
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
          <div className="name one-line">{card.name}</div>
          <div className="lvl">
            {card.castle ? 'Город соседа' : stage.name} ·{' '}
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
          <span className="name">Разведчик дойдёт за</span>
          <span className="val">{waitLeft(marchSeconds(card.distance, card.terrainFactor, { scout: 1 }))}</span>
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
            ? 'Видно, что там сейчас.'
            : card.stale && card.seenAt
              ? `Сейчас не видно. Последний взгляд ${formatAge((worldNow() - card.seenAt) / 1000)}.`
              : 'Сюда ещё никто не смотрел.'}
          {!card.visible && card.figuresHere.includes('scout') && (
            <> Числа ниже даёт разведчик у ворот.</>
          )}
          {!card.visible &&
            (card.figuresHere.includes('spy') ? (
              <> Поставь лазутчика наблюдателем, и станет видно.</>
            ) : (
              <> Доведи лазутчика и поставь наблюдателем.</>
            ))}
        </p>
      )}

      <h3>Сведения</h3>
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
          <span className="name">Жители</span>
          <span className="val">{formatEstimate(card.pop)}</span>
        </div>
        {/* Сколько можно взять — такие же разведданные, как численность, и
            стареют они так же. Это **открытая** часть склада: подпол разведчик
            не считает, и числа тайника здесь нет ни у кого, кроме своей
            деревни (см. `LocalWorld.lootOpen`). */}
        <div className="mod">
          <span className="ico"><Icon name="ui-loot" glyph="📦" /></span>
          <span className="name">{card.mine ? 'На складе' : 'Добыча'}</span>
          <span className={`val ${card.loot.precision === 'unknown' ? 'neg' : ''}`}>
            {formatEstimate(card.loot)}
          </span>
        </div>
        {card.visible && card.marching && (
          <div className="mod total">
            <span className="ico"><Icon name="ui-banner" glyph="🚩" /></span>
            <span className="name">Оттуда выходит отряд</span>
            <span className="val neg">видим</span>
          </div>
        )}
      </div>
      {!card.mine && (
        <p className="note">
          Победитель уносит всё сверх тайника, сколько поднимет отряд. Сколько в тайнике, не узнать.
        </p>
      )}
      {/* Только у замка, на который можно идти: у замка живого игрока набега нет вовсе. */}
      {card.castle && card.can.raid && (
        <p className="note">
          Здесь лежит и золото. Гарнизон крепче обычного, слабый отряд вернётся ни с чем.
        </p>
      )}
      {card.mine ? (
        <p className="note">Свои силы видны всегда.</p>
      ) : card.intel ? (
        <p className={`note${card.intel.precision === 'exact' ? '' : ' bad'}`}>
          Сведения получены {formatAge(card.intel.ageSeconds)},{' '}
          {/* «Приблизительно» и «протухло» — разные вещи, и путать их нельзя:
              донесение лазутчика вилкой с самого начала, а не устарело. */}
          {card.intel.hearsay
            ? `числа лазутчика на глаз${card.intel.precision === 'vague' ? ' и устарели' : ''}`
            : PRECISION_NOTE[card.intel.precision]}
          .
        </p>
      ) : (
        <p className="note bad">Сведений нет. Доведи разведчика к воротам.</p>
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
          {card.intel.style && <p className="note">Уклад: {card.intel.style}.</p>}
        </>
      )}

      {/*
        Лагерь под стенами. У своего города и у своего лагеря это вход в окно осады:
        всё, что про осаду знают и что с ней делают, собрано там, — и здесь это не
        повторяется. Чужой лагерь под чужим городом — строкой: сколько стоит и как
        укрепился, той же функцией, что и бой у лагеря.
      */}
      {card.siege && (
        <>
          <h3>Осада</h3>
          <div className="mod-list">
            <div className="mod total">
              <span className="ico">⛺</span>
              <span className="name">
                {card.siege.mine ? 'Наш лагерь стоит' : `Лагерь «${card.siege.byName}» стоит`}
              </span>
              <span className="val">{realLeft(Math.max(0, (worldNow() - card.siege.since) / 1000))}</span>
            </div>
            <div className="mod">
              <span className="ico">{FATE_META[card.siege.fate].icon}</span>
              <span className="name">Объявлено</span>
              <span className="val">{FATE_META[card.siege.fate].name.toLowerCase()}</span>
            </div>
            {/* Часы голода — только участнику осады, и те же, что в окне осады: мир отдаёт
                их одним чтением (`hungerOf`), слова одни (`hungerLeft`). Со стороны
                амбар не виден, и строки нет. */}
            {card.siege.starvesAt !== undefined && (
              <div className="mod">
                <span className="ico">⏳</span>
                <span className="name">{card.mine ? 'Своей еды хватит на' : 'Еды в городе хватит на'}</span>
                <span className={`val ${card.mine ? 'neg' : 'pos'}`}>{hungerLeft(card.siege.starvesAt, worldNow())}</span>
              </div>
            )}
          </div>
          {card.siege.mine || card.mine ? (
            <button className="btn wide" onClick={card.mine ? openSiege : openCamp}>
              Открыть осаду
            </button>
          ) : (
            <>
              <p className="note">У стен чужой лагерь. Разобьёшь его, и осада снята.</p>
              <p className="note">{worksWords(card.siege, worldNow())}</p>
            </>
          )}
        </>
      )}

      {/* Город взят — тот же знак, что под его именем на карте, и сходит он тем же сроком. */}
      {card.fell && (
        <div className="mod-list">
          <div className="mod">
            <span className="ico">{FATE_META[card.fell.fate].icon}</span>
            <span className="name">Город взят: {FELL_WORDS[card.fell.fate]}</span>
            <span className="val">{realLeft(Math.max(0, (worldNow() - card.fell.at) / 1000))} назад</span>
          </div>
        </div>
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
              <span className="name">Работы стоят, гарнизон поредел</span>
              <span className="val">{card.sack.look}</span>
            </div>
          </div>
          <p className="note">Здесь уже побывали. Брать почти нечего, город отстроится сам.</p>
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
              <span className="name">Бунт стихнет через</span>
              <span className="val">{realLeft(secondsLeft(card.revolt.until, worldNow()))}</span>
            </div>
          </div>
          <p className="note">Пока идёт бунт, город не растёт и запасы не копятся. Время для удара.</p>
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
                <span className="val neg">{realLeft(secondsLeft(card.diplomacy.breakAt, worldNow()))}</span>
              </div>
            )}
            {card.diplomacy.standing === 'pact' && card.diplomacy.breakAt === 0 && card.diplomacy.until > 0 && (
              <div className="mod">
                <span className="ico"><Icon name="ui-scroll" glyph="📜" /></span>
                <span className="name">Пакт держится ещё</span>
                <span className="val pos">{realLeft(secondsLeft(card.diplomacy.until, worldNow()))}</span>
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
              Отношение само не выправится. Доведи дипломата к воротам и поднеси дар.
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
                <span className="val pos">{realLeft(secondsLeft(d.until, worldNow()))}</span>
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
              <Icon name={`fig-${id}`} glyph={FIGURE_BY_ID[id].icon} /> Приказы: {FIGURE_BY_ID[id].name.toLowerCase()}
            </button>
          ))}
        {card.can.open && (
          <button className="btn wide" onClick={closeMap}>
            Открыть город
          </button>
        )}
        {/* Участь объявляется ударом или осадой — выбирают её прямо над ними. */}
        {(card.can.raid || card.can.besiege) && !card.siege?.mine && (
          <FatePick options={card.fates} value={fate} onChange={setFate} />
        )}
        {card.can.raid && !card.siege?.mine && (
          <>
            {/* Полководец здесь и войско при нём — только теперь и можно ударить. */}
            <button className="btn wide" disabled={busy} onClick={() => void strike()}>
              Ударить · {count(generalMen, 'боец', 'бойца', 'бойцов')}
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
                const err = await besiege(fate);
                setBusy(false);
                showToast(err ?? `${card.name} в осаде.`);
              })();
            }}
          >
            Осадить
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
            <Icon name={m.id === 'scout' ? 'fig-scout' : 'ui-banner'} glyph={m.icon} /> {m.name}
          </button>
        ))}
      </div>
      {card.can.besiege && <p className="note">{CAMP_LEAVE}</p>}
      {!card.mine && card.note && <p className="note">{card.note}</p>}

      {/* Своя деревня — единственное место, где полководец меняет состав войска. */}
      {card.mine && standing.includes('general') && <GarrisonEditor />}

      {standing.includes('scout') && !card.mine && (
        <p className="note">Пока разведчик у ворот, сведения свежие.</p>
      )}

      {standing.includes('diplomat') && !card.mine && card.tribeId && (
        <>
          <h3>Предложить договор</h3>
          <p className="note">Договор связывает всё племя. Пакт и дар одному городу — в приказах дипломату.</p>
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
              <span className="val">{stackSize(picked) > 0 ? waitLeft(eta) : '—'}</span>
            </div>
            <div className="mod">
              <span className="ico">↩️</span>
              <span className="name">Обратно</span>
              <span className="val">{stackSize(picked) > 0 ? waitLeft(eta) : '—'}</span>
            </div>
            <div className="mod total">
              <span className="ico"><Icon name="ui-home" glyph="🏠" /></span>
              <span className="name">Оборона города</span>
              <span className={`val ${defAfter < def * 0.5 ? 'neg' : ''}`}>
                {fmt(def)} → {fmt(defAfter)}
              </span>
            </div>
          </div>
          <p className={`note${picked.warrior > 0 ? ' bad' : ''}`}>
            {picked.warrior > 0
              ? 'Пока отряд в пути, город он не защищает. Отозвать его можно в походах.'
              : 'Разведчиков берут из свободных рук, стройка замедлится.'}
          </p>

          <button
            className="btn wide"
            data-tut={mission === 'scout' ? 'scout' : undefined}
            disabled={busy || stackSize(picked) === 0}
            onClick={() => void doSend()}
          >
            Отправить · {stackSize(picked)}
          </button>
        </>
      )}
    </div>
  );
}
