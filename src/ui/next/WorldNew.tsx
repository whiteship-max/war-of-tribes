// Карточка клетки карты нового интерфейса (docs/ui_audit.md, 6.2 и 13). Шапка — значок места (касание — что это),
// имя, ступень и отношение, координата и «закрыть»; под ней ячейки-справки: мощь, жители, добыча, дорога. Главное
// действие — сразу под ними (ударить, осадить, разведать, приказы человеку у ворот), ниже — кого вести сюда (четыре
// человека сеткой) и подробности: осада, бунт, отношения, донесение лазутчика. Объяснения правил — в подсказках.
//
// Своих чисел и правил нет: всё — то же, что у прежней карточки (`panels/WorldPanel`): оценки — `formatEstimate` и
// `formatAge` (`world/intel`), дорога и оборона после отправки — `marchSeconds` и `defense`, сроки — `realLeft`, рогатки —
// `worksWords`, голод — `hungerLeft`; приказы — те же двери мира (`send`, `attack`, `besiege`, `moveFigure`, `shelter`,
// `negotiate`, `openMenu`). За краем региона приказов нет (`twslot.reachable`).
import { useEffect, useState, type ReactNode } from 'react';
import { useGame } from '@/game/store';
import { figuresOn, useWorld, worldNow } from '@/world/store';
import { defense } from '@/game/derived';
import { sendableUnits } from '@/game/sim/expedition';
import { formatCoord, marchSeconds, secondsLeft } from '@/world/geo';
import { formatAge, formatEstimate, PRECISION_NOTE } from '@/world/intel';
import { CAMP_LEAVE } from '@/world/siege';
import { worksWords } from '@/world/works';
import { FATE_DEFAULT } from '@/world/spoils';
import { FATE_META } from '@/world/data/fates';
import { CASTLE_ICON, MISSIONS, RELATION_META, STAGE_BY_ID } from '@/world/data/meta';
import { DEALS, FIGURES, FIGURE_BY_ID } from '@/world/data/figures';
import { STANDING_META, TEMPER_BY_ID } from '@/world/data/diplomacy';
import { KIND_META, UNIT_KINDS } from '@/battle';
import { TERRAIN_META } from '@/world/data/terrain';
import type { Estimate, Fate, FigureId, Mission, UnitStack } from '@/world/types';
import { UNIT_BY_ID, stackSize } from '@/world/data/units';
import { awayOf, ownOf } from '@/world/muster';
import { awayTroops } from '@/world/bridge';
import { troopTotal } from '@/game/battle/kinds';
import { FELL_WORDS } from '@/ui/map/siegemark';
import { beyondText, reachable } from '@/ui/map/twslot';
import { Icon } from '@/ui/icons/Icon';
import { FatePick } from '@/ui/parts/FatePick';
import { hungerLeft } from '@/ui/parts/hunger';
import { count } from '@/ui/parts/plural';
import { EnergyPrice } from '@/ui/parts/Energy';
import { signed } from '@/ui/parts/signed';
import { realLeft, waitLeft, waitShort } from '@/ui/parts/wait';
import { MusterLink } from '@/ui/parts/Muster';
import { tipAt, type TipContent } from './tip';
import { WarCard } from './WarCard';
import { num } from '@/game/num';

const fmt = (n: number): string => (Math.abs(n) >= 100 ? String(Math.round(n)) : num(n, 1));

/** Какие бойцы идут в миссию: набега гонцом нет — армию водит полководец (`LocalWorld.send`). */
const ALLOWED: Record<Mission, ('warrior' | 'scout')[]> = { raid: [], scout: ['scout'], support: ['warrior'] };

/** Оценка в ячейку: неизвестное — «?», вилка — «120–160». */
export const cellEstimate = (e: Estimate): string => (e.precision === 'unknown' ? '?' : formatEstimate(e));

/** Шапка карточки: значок (касание — что это), имя, строка «ступень · отношение · координата», «закрыть». */
function Head({ icon, glyph, title, sub, tip }: { icon: string; glyph: string; title: ReactNode; sub: ReactNode; tip: TipContent }) {
  const closeSheet = useGame((g) => g.closeSheet);
  return (
    <div className="nx-bhead">
      <button className="nx-bico" onClick={(e) => tipAt(e.currentTarget, tip)} aria-label="Что это за место">
        <Icon name={icon} glyph={glyph} />
      </button>
      <div className="nx-btitle">
        <b className="one-line">{title}</b>
        <span className="nx-blvl nx-csub">{sub}</span>
      </div>
      <button className="nx-bclose" onClick={closeSheet} aria-label="Закрыть">
        <Icon name="ui-close" glyph="✕" />
      </button>
    </div>
  );
}

/** Ячейка-справка: подпись, число; касание — откуда число. */
function Fact({ label, value, bad, tip }: { label: string; value: string; bad?: boolean; tip: TipContent }) {
  return (
    <button className="nx-fact" onClick={(e) => tipAt(e.currentTarget, tip)}>
      <small>{label}</small>
      <b className={bad ? 'bad' : ''}>{value}</b>
    </button>
  );
}

/** Строка подробностей: значок, что и число справа; касание — правило. */
function Row({ icon, glyph, name, value, tone, tip }: { icon: string; glyph: string; name: string; value: string; tone?: 'good' | 'bad'; tip?: TipContent }) {
  const body = (
    <>
      <span className="nx-lico">
        <Icon name={icon} glyph={glyph} />
      </span>
      <span className="nx-crow-t">{name}</span>
      <b className={tone ?? ''}>{value}</b>
    </>
  );
  return tip ? (
    <button className="nx-crow" onClick={(e) => tipAt(e.currentTarget, tip)}>
      {body}
    </button>
  ) : (
    <div className="nx-crow">{body}</div>
  );
}

export function WorldNew({ x, y }: { x: number; y: number }) {
  const s = useGame((g) => g.s);
  const closeMap = useGame((g) => g.closeMap);
  const showToast = useGame((g) => g.showToast);
  const openSiege = useGame((g) => g.openSiege);
  const openCamp = useGame((g) => g.openCamp);
  const card = useWorld((g) => g.card);
  const terrain = useWorld((g) => g.cardTerrain);
  const loading = useWorld((g) => g.cardLoading);
  const send = useWorld((g) => g.send);
  const figures = useWorld((g) => g.figures);
  const marches = useWorld((g) => g.marches);
  const moveFigure = useWorld((g) => g.moveFigure);
  const shelter = useWorld((g) => g.shelter);
  const attack = useWorld((g) => g.attack);
  const assault = useWorld((g) => g.assault);
  const besiege = useWorld((g) => g.besiege);
  const negotiate = useWorld((g) => g.negotiate);
  const openMenu = useWorld((g) => g.openMenu);
  const home = useWorld((g) => g.info?.home ?? null);
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
  const coord = formatCoord(here);
  const now = worldNow();

  // Карта по регионам (docs/map_tw.md, раздел 13.5): за краем региона приказов нет.
  if (!reachable(here)) {
    return (
      <div className="panel nx-bpanel nx-wcard">
        <Head icon="rel-neutral" glyph="🏳️" title={card?.name ?? 'Чужой край'} sub={coord} tip={{ title: 'Чужой край', body: beyondText() }} />
        <p className="nx-tnote">{beyondText()}</p>
      </div>
    );
  }

  /** Кого вести сюда — четыре человека сеткой: значок, роль, что с ним; касание — ведёт (или выводит из города). */
  const lead = (standing: FigureId[]): JSX.Element => (
    <>
      <h3>Кого вести сюда</h3>
      <div className="nx-lead">
        {FIGURES.map((d) => {
          const f = figures.find((v) => v.id === d.id);
          const here0 = standing.includes(d.id);
          const down = f?.phase === 'down';
          const vacant = f?.place === 'vacant';
          const inside = card?.mine && f?.place === 'city';
          const state = here0 ? 'здесь' : vacant ? 'нет' : down ? (f?.held ? 'задержан' : 'вне строя') : inside ? 'выйти' : 'вести';
          return (
            <button
              key={d.id}
              className={`nx-leadb${here0 ? ' on' : ''}`}
              disabled={busy || here0 || down || vacant}
              aria-label={`${d.name}: ${state}`}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  const err = inside ? await shelter(d.id, false) : await moveFigure(d.id, here);
                  setBusy(false);
                  showToast(err ?? (inside ? `${d.name} вышел из города.` : `${d.name} пошёл к ${coord}.`));
                })();
              }}
            >
              <Icon name={`fig-${d.id}`} glyph={d.icon} />
              <small>{d.name}</small>
              <em>{down && !vacant && f ? realLeft(secondsLeft(f.downUntil, now)) : state}</em>
            </button>
          );
        })}
      </div>
    </>
  );

  if (!card) {
    const standing = figuresOn(x, y, now).map((f) => f.id);
    const dist = home ? Math.hypot(home.x - x, home.y - y) : 0;
    const land = terrain ? TERRAIN_META[terrain].name : 'Земля';
    return (
      <div className="panel nx-bpanel nx-wcard">
        <Head
          icon="ui-pin"
          glyph="📍"
          title="Пустая земля"
          sub={`${land} · ${coord}`}
          tip={{ title: land, body: 'Здесь никто не живёт. Пройти можно.' }}
        />
        <div className="nx-facts two">
          <Fact label="От города" value={`${fmt(dist)} кл.`} tip={{ title: `От города · ${fmt(dist)} кл.`, body: 'Расстояние по прямой.' }} />
          <Fact
            label="Здесь стоят"
            value={standing.length > 0 ? String(standing.length) : 'никого'}
            tip={{ title: 'Здесь стоят', body: standing.length > 0 ? standing.map((id) => FIGURE_BY_ID[id].name).join(', ') : 'Никого из своих.' }}
          />
        </div>
        {loading && <p className="nx-tnote">Смотрим, кто здесь…</p>}
        {lead(standing)}
      </div>
    );
  }

  const stage = STAGE_BY_ID[card.stage];
  const relation = RELATION_META[card.relation];
  const kindWord = card.castle ? 'Город соседа' : stage.name;
  const sub = (
    <>
      {card.ruin ? 'Пепелище' : kindWord}
      {!card.ruin && (
        <>
          {' · '}
          <span style={{ color: relation.color }}>{relation.name}</span>
        </>
      )}
      {' · '}
      {formatCoord(card)}
    </>
  );

  // Пепелище: ни войска, ни владельца, ни погасших кнопок — только что след сойдёт сам.
  if (card.ruin) {
    return (
      <div className="panel nx-bpanel nx-wcard">
        <Head icon="stage-camp" glyph="🔥" title={<span className="one-line">{card.name}</span>} sub={sub} tip={{ title: 'Пепелище', body: card.note ?? 'Логово сожжено. След сойдёт сам.' }} />
        <div className="nx-facts two">
          <Fact label="Расстояние" value={`${fmt(card.distance)} кл.`} tip={{ title: `Расстояние · ${fmt(card.distance)} кл.`, body: 'От своего города по прямой.' }} />
          <Fact label="След сойдёт" value={realLeft(card.ruinLeft)} tip={{ title: 'Пепелище', body: 'Когда след сойдёт, место опустеет.' }} />
        </div>
        {card.note && <p className="nx-tnote">{card.note}</p>}
      </div>
    );
  }

  // Отряд уходит из гарнизона без отряда полководца: тот стоит в обороне и гонцом за ворота не выходит — бойцы
  // полководца его, а не гарнизона (`LocalWorld.send` берёт отряд без состава из них же, docs/retinue.md).
  const who = awayOf(marches, figures);
  const have = { ...sendableUnits(s), warrior: troopTotal(ownOf(s.army, who)) };
  const def = defense(s);
  const picked = { warrior: pick.warrior ?? 0, scout: pick.scout ?? 0 };
  const eta = marchSeconds(card.distance, card.terrainFactor, picked);
  // Оборона после отправки — та же `defense`, только без ушедших (`muster.homeOf`), разведчики — из жителей.
  const defAfter = defense({
    ...s,
    away: awayTroops(s.army, { ...who, loose: who.loose + picked.warrior }),
    scoutsAway: s.scoutsAway + picked.scout,
  });
  const standing = card.figuresHere;
  const general = figures.find((f) => f.id === 'general');
  const generalMen = troopTotal(general?.troops ?? {});
  const scoutWalk = waitLeft(marchSeconds(card.distance, card.terrainFactor, { scout: 1 }));

  const setUnit = (id: 'warrior' | 'scout', n: number): void => setPick((p) => ({ ...p, [id]: Math.max(0, Math.min(have[id], n)) }));
  const start = (m: Mission): void => {
    setMission(m);
    // Разведку обычно шлют вдвоём — так один потерянный не срывает всё дело.
    setPick(m === 'scout' ? { scout: Math.min(2, have.scout) } : { warrior: have.warrior });
  };
  const strike = async (): Promise<void> => {
    setBusy(true);
    const err = await attack({ fate });
    setBusy(false);
    showToast(err ?? 'Отряд ударил. Донесение в походах.');
  };
  // «Дойти и ударить»: полководец не здесь — идёт сюда и бьёт в минуту прихода (`assault`). Город игрока — блок «Война».
  const goStrike = !card.castle && !card.siege?.mine && !standing.includes('general') ? card.assault : undefined;
  const march = async (): Promise<void> => {
    if (!goStrike) return;
    setBusy(true);
    const err = await assault(card.id, fate);
    setBusy(false);
    showToast(err ?? `Отряд вышел. Бой через ${realLeft(goStrike.walkMs / 1000)}, даже если ты не в игре.`);
  };
  const doSend = async (): Promise<void> => {
    if (!mission) return;
    setBusy(true);
    const err = await send({ target: card.id, mission, units: picked });
    setBusy(false);
    if (err) return showToast(err);
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

  // Откуда числа войска: свои — всегда; чужие — донесение разведчика или лазутчика с возрастом, или ничего.
  const intelWord = card.mine
    ? 'Свои силы видны всегда.'
    : card.intel
      ? `Сведения получены ${formatAge(card.intel.ageSeconds)}, ${
          card.intel.hearsay ? `числа лазутчика на глаз${card.intel.precision === 'vague' ? ' и устарели' : ''}` : PRECISION_NOTE[card.intel.precision]
        }.`
      : 'Сведений нет. Доведи разведчика к воротам.';
  const sightWord = card.mine
    ? null
    : card.visible
      ? 'В обзоре'
      : card.stale && card.seenAt
        ? `Последний взгляд ${formatAge((now - card.seenAt) / 1000)}`
        : 'Не видно';
  const sightTip: TipContent = {
    title: card.visible ? 'В обзоре' : 'Живьём не видно',
    body: card.visible
      ? 'Видно, что там сейчас.'
      : card.figuresHere.includes('spy')
        ? 'Лазутчик здесь. Прикажи ему залечь, и станет видно.'
        : 'Живьём видно у своего города и вокруг залёгшего лазутчика. Доведи его сюда.',
  };
  const raidable = (card.can.raid || card.can.besiege || Boolean(goStrike?.can)) && !card.siege?.mine;
  // Строка владельца — словами меню приказов и только то, что есть (docs/ui_audit.md, 14.1, 17). У своего города
  // владелец — заглушка слепка («Наше племя», `bridge.playerProfile`), и строки нет, как в меню приказов.
  const ownerLine = card.mine
    ? ''
    : [card.owner ? `Правитель ${card.owner}` : '', card.tribeName ? `${card.owner ? 'держава' : 'Держава'} ${card.tribeName}` : '']
        .filter(Boolean)
        .join(' · ');

  return (
    <div className="panel nx-bpanel nx-wcard">
      <Head
        icon={card.castle ? 'stage-castle' : `stage-${stage.id}`}
        glyph={card.castle ? CASTLE_ICON : stage.icon}
        title={<span className="one-line">{card.name}</span>}
        sub={sub}
        tip={{ title: kindWord, body: ownerLine || undefined }}
      />

      <div className="nx-facts">
        <Fact label="Мощь" value={cellEstimate(card.power)} bad={card.power.precision === 'unknown'} tip={{ title: `Мощь · ${formatEstimate(card.power)}`, body: intelWord }} />
        <Fact label="Жители" value={cellEstimate(card.pop)} bad={card.pop.precision === 'unknown'} tip={{ title: `Жители · ${formatEstimate(card.pop)}`, body: intelWord }} />
        <Fact
          label={card.mine ? 'На складе' : 'Добыча'}
          value={cellEstimate(card.loot)}
          bad={card.loot.precision === 'unknown'}
          tip={{
            title: `${card.mine ? 'На складе' : 'Добыча'} · ${formatEstimate(card.loot)}`,
            body: card.mine
              ? 'Запасы и золото сверх тайника. Враг уносит из них, сколько поднимет.'
              : card.castle && card.can.raid
                ? 'Победитель уносит запасы и золото сверх тайника, сколько поднимет отряд. Гарнизон здесь крепче обычного.'
                : 'Победитель уносит всё сверх тайника, сколько поднимет отряд. Сколько в тайнике, не узнать.',
          }}
        />
        {card.mine ? (
          <Fact label="Оборона" value={fmt(def)} tip={{ title: `Оборона · ${fmt(def)}`, body: 'Гарнизон, стены, башня, казармы и жители.' }} />
        ) : (
          <Fact
            label="Дорога"
            value={scoutWalk}
            tip={{ title: `Дорога · ${fmt(card.distance)} кл.`, body: `Разведчик дойдёт за ${scoutWalk}. Отряд идёт медленнее.` }}
          />
        )}
      </div>
      {sightWord && (
        <button className={`nx-sight${card.visible ? ' good' : ''}`} onClick={(e) => tipAt(e.currentTarget, sightTip)}>
          <Icon name={card.visible ? 'ui-eye' : 'ui-eye-off'} glyph={card.visible ? '👁️' : '🙈'} />
          <span>{sightWord}</span>
          {card.visible && card.marching && <b className="bad">оттуда выходит отряд</b>}
        </button>
      )}

      {/* Главное действие — сразу под числами: приказ отдаётся там, где игрок смотрит. */}
      <div className="nx-cacts">
        {!card.mine &&
          standing.map((id) => (
            <button key={id} className="nx-cact" onClick={() => void openMenu(id, { x: card.x, y: card.y })}>
              <Icon name={`fig-${id}`} glyph={FIGURE_BY_ID[id].icon} />
              Приказы: {FIGURE_BY_ID[id].name.toLowerCase()}
            </button>
          ))}
        {card.can.open && (
          <button className="nx-go nx-cgo" onClick={closeMap}>
            Открыть город
          </button>
        )}
        {raidable && <FatePick options={card.fates} value={fate} onChange={setFate} />}
        {card.can.raid && !card.siege?.mine && (
          <button className="nx-go nx-cgo" disabled={busy} onClick={() => void strike()}>
            Ударить · {count(generalMen, 'боец', 'бойца', 'бойцов')}
          </button>
        )}
        {goStrike && (
          <button className="nx-go nx-cgo" disabled={busy || !goStrike.can} onClick={() => void march()}>
            Дойти и ударить · {realLeft(goStrike.walkMs / 1000)}
            <EnergyPrice price={goStrike.energy.price} />
          </button>
        )}
        {card.can.besiege && (
          <button
            className="nx-cact"
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
            <Icon name="ui-target" glyph="⛺" />
            Осадить
          </button>
        )}
        {MISSIONS.filter((m) => m.id !== 'raid' && card.can[m.id]).map((m) => (
          <button
            key={m.id}
            className={`nx-cact${mission === m.id ? ' on' : ''}`}
            // Проводка ведёт к разведке: пока миссия не выбрана — к этой кнопке, потом — к «Отправить».
            data-tut={m.id === 'scout' && mission !== 'scout' ? 'scout' : undefined}
            onClick={() => (mission === m.id ? setMission(null) : start(m.id))}
          >
            <Icon name={m.id === 'scout' ? 'fig-scout' : 'ui-banner'} glyph={m.icon} />
            {m.name}
          </button>
        ))}
      </div>
      {goStrike && !goStrike.can && goStrike.reason && <p className="nx-tnote bad">{goStrike.reason}</p>}
      {card.can.besiege && <p className="nx-tnote">{CAMP_LEAVE}</p>}
      {/* Город живого игрока: поход на него и война с ним (docs/pvp.md). */}
      {card.castle && !card.mine && <WarCard card={card} />}

      {mission && (
        <div className="nx-send">
          {ALLOWED[mission].map((id) => {
            const def0 = UNIT_BY_ID[id];
            const max = have[id];
            const n = picked[id];
            return (
              <div className="nx-wrow" key={id}>
                <span className="nx-lico">{def0.icon}</span>
                <span className="nx-wcount">
                  <b>{n}</b>
                  <small>/{max}</small>
                </span>
                <span className="nx-ostep nx-sstep">
                  <button disabled={n <= 0} onClick={() => setUnit(id, n - 1)} aria-label="Меньше">
                    −
                  </button>
                  <button disabled={n >= max} onClick={() => setUnit(id, n + 1)} aria-label="Больше">
                    +
                  </button>
                  <button disabled={max <= 0 || n >= max} onClick={() => setUnit(id, max)}>
                    все
                  </button>
                </span>
              </div>
            );
          })}
          <div className="nx-facts two">
            <Fact
              label="Дорога туда"
              value={stackSize(picked) > 0 ? waitLeft(eta) : '—'}
              tip={{ title: 'Дорога туда', body: stackSize(picked) > 0 ? 'Обратно столько же.' : 'Отряд пуст.' }}
            />
            <Fact
              label="Оборона города"
              value={`${fmt(def)} → ${fmt(defAfter)}`}
              bad={defAfter < def * 0.5}
              tip={{
                title: 'Оборона, пока отряд в пути',
                body: picked.warrior > 0 ? 'Ушедшие бойцы город не защищают. Отозвать отряд можно в походах.' : 'Разведчиков берут из свободных рук, стройка замедлится.',
              }}
            />
          </div>
          <button
            className="nx-go nx-cgo"
            data-tut={mission === 'scout' ? 'scout' : undefined}
            disabled={busy || stackSize(picked) === 0}
            onClick={() => void doSend()}
          >
            Отправить · {stackSize(picked)}
          </button>
        </div>
      )}

      {/* Кто с полководцем — окно раскладки в «Дружине», одно на всю игру (docs/retinue.md). */}
      {card.mine && <MusterLink />}

      {lead(standing)}

      {card.siege && (
        <>
          <h3>Осада</h3>
          <Row
            icon="ui-target"
            glyph="⛺"
            name={card.siege.mine ? 'Наш лагерь стоит' : `Лагерь «${card.siege.byName}» стоит`}
            value={realLeft(Math.max(0, (now - card.siege.since) / 1000))}
          />
          <Row icon={`fate-${card.siege.fate}`} glyph={FATE_META[card.siege.fate].icon} name="Объявлено" value={FATE_META[card.siege.fate].name.toLowerCase()} />
          {card.siege.starvesAt !== undefined && (
            <Row
              icon="ui-time"
              glyph="⏳"
              name={card.mine ? 'Своей еды хватит на' : 'Еды в городе хватит на'}
              value={hungerLeft(card.siege.starvesAt, now)}
              tone={card.mine ? 'bad' : 'good'}
            />
          )}
          {card.siege.mine || card.mine ? (
            <button className="nx-cact" onClick={card.mine ? openSiege : openCamp}>
              <Icon name="ui-target" glyph="⛺" />
              Открыть осаду
            </button>
          ) : (
            <p className="nx-tnote">
              У стен чужой лагерь. Разобьёшь его, и осада снята. {worksWords(card.siege, now)}
            </p>
          )}
        </>
      )}

      {card.fell && (
        <Row
          icon={`fate-${card.fell.fate}`}
          glyph={FATE_META[card.fell.fate].icon}
          name={`Город взят: ${FELL_WORDS[card.fell.fate]}`}
          value={`${realLeft(Math.max(0, (now - card.fell.at) / 1000))} назад`}
        />
      )}

      {card.sack && (
        <Row
          icon="ui-loot"
          glyph="🔥"
          name="Разорено"
          value={card.sack.look}
          tone="bad"
          tip={{ title: 'Разорено', body: 'Здесь уже побывали. Брать почти нечего, город отстроится сам.' }}
        />
      )}

      {card.revolt && (
        <Row
          icon="ui-warning"
          glyph="🔥"
          name={`Бунт ещё ${realLeft(secondsLeft(card.revolt.until, now))}`}
          value={`−${Math.round(card.revolt.power * 100)}%`}
          tone="good"
          tip={{ title: 'Бунт', body: 'Гарнизон слабее, город не растёт и запасы не копятся. Время для удара.' }}
        />
      )}

      {card.diplomacy && (
        <>
          <h3>Отношения</h3>
          <Row
            icon={`state-${card.diplomacy.standing}`}
            glyph={STANDING_META[card.diplomacy.standing].icon}
            name={`${STANDING_META[card.diplomacy.standing].name} · ${card.diplomacy.mood}`}
            value={signed(card.diplomacy.attitude, 0)}
            tone={card.diplomacy.attitude < 0 ? 'bad' : 'good'}
            tip={{
              title: 'Отношение',
              body:
                card.diplomacy.attitude < 0 || card.diplomacy.standing === 'war'
                  ? 'Само не выправится. Доведи дипломата к воротам и поднеси дар.'
                  : 'Чем выше, тем охотнее соглашаются на пакт. Дар поднимает его, оскорбление роняет.',
            }}
          />
          <Row
            icon={`temper-${card.diplomacy.temper}`}
            glyph={TEMPER_BY_ID[card.diplomacy.temper].icon}
            name="Характер владельца"
            value={TEMPER_BY_ID[card.diplomacy.temper].name}
            tip={{ title: TEMPER_BY_ID[card.diplomacy.temper].name, body: TEMPER_BY_ID[card.diplomacy.temper].note }}
          />
          {card.diplomacy.standing === 'pact' && card.diplomacy.breakAt > 0 && (
            <Row icon="ui-time" glyph="⏳" name="Пакт разорван, война через" value={realLeft(secondsLeft(card.diplomacy.breakAt, now))} tone="bad" />
          )}
          {card.diplomacy.standing === 'pact' && card.diplomacy.breakAt === 0 && card.diplomacy.until > 0 && (
            <Row icon="ui-scroll" glyph="📜" name="Пакт держится ещё" value={realLeft(secondsLeft(card.diplomacy.until, now))} tone="good" />
          )}
        </>
      )}

      {card.deals.length > 0 && (
        <>
          <h3>Договоры с державой</h3>
          {card.deals.map((d) => (
            <Row
              key={d.id}
              icon={`deal-${d.id}`}
              glyph={DEALS.find((x) => x.id === d.id)?.icon ?? ''}
              name={DEALS.find((x) => x.id === d.id)?.name ?? ''}
              value={realLeft(secondsLeft(d.until, now))}
              tone="good"
            />
          ))}
        </>
      )}

      {standing.includes('diplomat') && !card.mine && card.tribeId && (
        <>
          <h3>Предложить договор</h3>
          {DEALS.map((d) => (
            <div className="nx-crow" key={d.id}>
              <span className="nx-lico">
                <Icon name={`deal-${d.id}`} glyph={d.icon} />
              </span>
              <span className="nx-crow-t">
                {d.name}
                <small>{d.description}</small>
              </span>
              <button className="nx-act" disabled={busy} onClick={() => void doDeal(d.id)}>
                Предложить
              </button>
            </div>
          ))}
        </>
      )}

      {card.intel?.kinds && (
        <>
          <h3>
            Донесение <span className="muted">{formatAge(card.intel.ageSeconds)}</span>
          </h3>
          <div className="nx-facts">
            {UNIT_KINDS.map((k) => {
              const e = card.intel?.kinds?.[k];
              return (
                <Fact
                  key={k}
                  label={`${KIND_META[k].icon} ${KIND_META[k].name}`}
                  value={e ? formatEstimate(e) : '?'}
                  bad={!e}
                  tip={{ title: KIND_META[k].name, body: e ? intelWord : 'Не разглядели.' }}
                />
              );
            })}
          </div>
          {card.intel.style && <p className="nx-tnote">Уклад: {card.intel.style}.</p>}
        </>
      )}

      {!card.mine && card.note && <p className="nx-tnote">{card.note}</p>}
    </div>
  );
}
