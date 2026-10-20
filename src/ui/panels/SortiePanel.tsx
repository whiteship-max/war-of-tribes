// Вылазка: кого выпускаем за ворота.
//
// Состав выбирается — не «всё или ничего». Гарнизон, вышедший весь, оставил бы
// стену пустой, и это была бы не ставка, а ловушка: осада не кончится от одной
// неудачи, а обороняться после неё будет нечем.
//
// Расстановки здесь нет нарочно. Вылазка — это внезапный удар из ворот, и
// шесть секторов с планом и резервом на неё не раскладывают: строй в воротах не
// строят. Пресет выберется по сиду боя — тем же, каким его выбирает быстрая
// атака.
//
// Прогноза исхода нет — как и везде в этой игре. Известно ровно то, что можно
// увидеть со стены: сколько людей в лагере и насколько он укрепился — а значит,
// сколько из выбранных пробьются к рогаткам. Это не исход, а условие боя, и
// считает его та же функция, что и сам бой (`world/works.sortieForecast`).
import { useEffect, useMemo, useState } from 'react';
import { useGame } from '@/game/store';
import type { MachineId } from '@/world/data/machines';
import { plural } from '@/ui/parts/plural';
import { useWorld, worldNow } from '@/world/store';
import { awayOf, homeOf, standingTroops } from '@/world/muster';
import { TROOP_BY_ID, TROOP_IDS } from '@/game/data/troops';
import { troopTotal, type TroopStack } from '@/game/battle/kinds';
import { kindsOf } from '@/game/battle/price';
import { secondsLeft } from '@/world/geo';
import { realLeft } from '@/ui/parts/wait';
import { REST_WHY, restLine, wearLine } from '@/ui/parts/restWords';
import { hungerLeft } from '@/ui/parts/hunger';
import { gateBusyText, refusedAtGate, sortieForecast } from '@/world/works';
import type { TroopId } from '@/game/types';
import { Icon } from '@/ui/icons/Icon';
import { Steps } from '@/ui/parts/Steps';
import { Table, type Col } from '@/ui/kit/Table';
import { Btn } from '@/ui/kit/Btn';
import './siege.css';
import { iconName } from '@/ui/icons/registry';

/**
 * `machine` — вылазка на машину лагеря (docs/siege_v2.md, раздел 5): бой с её охраной у стены, перед рогатками; победа сжигает
 * машину. `ring` — вылазка на пост кольца блокады (Р-5): бой в поле с четвертью лагеря, победа размыкает кольцо. Без них —
 * вылазка на лагерь через рогатки.
 */
const SORTIE_COLS: readonly Col[] = [
  { key: 'kind', title: 'Вид' },
  { key: 'steps', title: 'Выходят', align: 'right', w: '196px' },
];

export function SortiePanel({ machine, ring }: { machine?: MachineId; ring?: boolean } = {}) {
  const s = useGame((g) => g.s);
  const showToast = useGame((g) => g.showToast);
  const openReport = useGame((g) => g.openReport);
  const closeSheet = useGame((g) => g.closeSheet);
  const siege = useWorld((g) => g.siege);
  const marches = useWorld((g) => g.marches);
  const figures = useWorld((g) => g.figures);
  const sortie = useWorld((g) => g.sortie);
  const burnMachine = useWorld((g) => g.burnMachine);
  const breakout = useWorld((g) => g.breakout);

  const away = useMemo(() => awayOf(marches, figures), [marches, figures]);
  // Выходят из гарнизона — а в нём и дружина, если полководец в городе: дома она
  // часть гарнизона и за ворота выходит этой же вылазкой (`world/muster`).
  const home = useMemo(() => homeOf(s.army, away), [s, away]);
  const standing = useMemo(() => troopTotal(standingTroops(s.army, away)), [s, away]);
  const [picked, setPicked] = useState<TroopStack>({});
  const [busy, setBusy] = useState(false);
  const [, retick] = useState(0);

  // Рогатки растут, пока игрок выбирает состав: число прохода обязано идти вместе
  // с часами, а не застыть на минуте, в которую открыли панель.
  useEffect(() => {
    if (!siege) return;
    const t = setInterval(() => retick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [siege]);

  const men = troopTotal(picked);
  const stay = troopTotal(home) - men;

  if (!siege) {
    return (
      <div className="panel">
        <div className="bhead">
          <div className="ico"><Icon name="hud-army" /></div>
          <div className="body">
            <div className="name">Вылазки не нужно</div>
            <div className="lvl">под стенами никого</div>
          </div>
        </div>
        <p className="note">Осада снята.</p>
      </div>
    );
  }

  const now = worldNow();
  const fc = sortieForecast(siege, kindsOf(picked), now);
  const pass = fc.now.pass;
  // Проход — поток: занят прошедшими раньше — пропустит меньше, а то и никого.
  // Отказ виден до нажатия и гасит кнопку; мир откажет теми же словами.
  // На машину — мимо рогаток: прохода у этого боя нет (`fights.machineFight`).
  const target = machine ? siege.answers?.burn.find((m) => m.machine === machine) : undefined;
  // На пост кольца — тоже мимо рогаток: бой в поле у ворот (`fights.machineFight`, доля поста — `blockade.BREAKOUT_SHARE`).
  const post = ring ? siege.answers?.breakout : undefined;
  const field = Boolean(machine || ring);
  const refused = !field && men > 0 && refusedAtGate(fc.now);

  const go = async (): Promise<void> => {
    setBusy(true);
    const res = ring ? await breakout(picked) : machine ? await burnMachine(machine, picked) : await sortie(picked);
    setBusy(false);
    if (res.error) {
      showToast(res.error);
      return;
    }
    if (res.reportId) openReport(res.reportId);
    else closeSheet();
  };

  return (
    <div className="panel sg">
      <div className="bhead">
        <div className="ico">
          <Icon name="letter-siege" />
        </div>
        <div className="body">
          <div className="name">{ring ? 'Вылазка: прорвать кольцо' : target ? `Вылазка: ${target.name.toLowerCase()}` : 'Вылазка'}</div>
          <div className="lvl">
            «{siege.byName}» у ворот · до голода {hungerLeft(siege.starvesAt, now)}
          </div>
        </div>
      </div>

      {/*
        Единственное, что игрок знает о бое заранее, — и знать это он обязан:
        лагерь укрепляется, и время работает против города. Спрятать это в отчёт
        значило бы, что решение «выйти сейчас или собраться» принимается вслепую,
        а непонятный проигрыш читается как несправедливый.
      */}
      {machine && (
        <div className="card danger">
          <div className="ico"><Icon name="ui-flame" /></div>
          <div className="body">
            <div className="title">{target ? `${target.name}: ${target.ready ? 'готова' : 'строится'}` : 'Машины у лагеря нет'}</div>
            <div className="desc">
              {target
                ? `Охрана — ${target.guard} ${plural(target.guard, 'боец', 'бойца', 'бойцов')}: сторона лагеря у города. Машина стоит у стены, перед рогатками: проход отряду не нужен. Победа сожжёт её вместе с лесом.`
                : 'Её уже сожгли или пустили на штурм.'}
            </div>
          </div>
        </div>
      )}
      {ring && (
        <div className="card danger">
          <div className="ico"><Icon name="stage-camp" /></div>
          <div className="body">
            <div className="title">{post ? `Пост кольца — ${post.guard} ${plural(post.guard, 'боец', 'бойца', 'бойцов')}` : 'Кольца нет'}</div>
            <div className="desc">
              {post
                ? `Четверть лагеря у ворот. Выходят ${men} ${plural(men, 'боец', 'бойца', 'бойцов')}. ${post.gives}`
                : 'Кольцо уже разомкнуто — прорывать нечего.'}
            </div>
          </div>
        </div>
      )}
      {!field && (
      <div className={`card${fc.now.works > 0 ? ' danger' : ''}`}>
        <div className="ico"><Icon name="stage-camp" /></div>
        <div className="body">
          <div className="title">
            {fc.now.works <= 0 ? 'Рогаток нет' : fc.now.works < 1 ? 'Рогатки растут' : 'Рогатки дозрели'}
          </div>
          <div className="desc">
            {fc.now.works <= 0
              ? `Лагерь только встал. К бою пройдут все.`
              : `Со стороны города рогатки готовы на ${Math.floor(fc.now.works * 100)}%. К бою пробьются не больше ${pass}.`}
            {fc.now.works > 0 &&
              fc.now.free < 1 &&
              ` Проход занят, сейчас пройдут ${fc.now.room}. Освободится через ${realLeft(secondsLeft(fc.clearAt, now))}, тогда пройдут не больше ${fc.clearPass}.`}
            {fc.now.works < 1 &&
              ` Дозреют через ${realLeft(secondsLeft(fc.ripeAt, now))}, тогда пройдут не больше ${fc.ripePass}.`}
            {men > 0 &&
              (fc.now.passed < fc.now.went
                ? ` К бою пробьются ${fc.now.passed} из ${fc.now.went}.`
                : ` Отряд пройдёт весь.`)}
          </div>
        </div>
      </div>
      )}

      {/* Кто выходит — таблицей: вид, сколько из скольких и ряд шага в строке (`parts/Steps` — один на игру; прежде здесь
          была своя копия ряда). Последняя строка — кто останется за стеной (UI-7, docs/ui_v2.md, 5.6). */}
      <h3>
        Кто выходит <small>{men} из {troopTotal(home)}</small>
      </h3>
      {troopTotal(home) === 0 ? (
        <div className="desc">В гарнизоне никого. Найми бойцов в казармах.</div>
      ) : (
        <Table
          label="Кто выходит"
          cols={SORTIE_COLS}
          rows={TROOP_IDS.filter((t) => (home[t] ?? 0) > 0).map((t) => {
            const n = picked[t] ?? 0;
            const max = home[t] ?? 0;
            return {
              key: t,
              cells: {
                kind: (
                  <span className="kit-name">
                    <Icon name={iconName('troop', t)} />
                    <span className="kit-two">
                      <b className="one-line">{TROOP_BY_ID[t].name}</b>
                      <small>из {max}</small>
                    </span>
                  </span>
                ),
                steps: (
                  <span className="sg-steps">
                    <Steps
                      value={n}
                      max={max}
                      spare={max - n}
                      step={10}
                      names={{ less: 'Оставить', more: 'Вывести' }}
                      onChange={(d) => setPicked({ ...picked, [t as TroopId]: Math.max(0, Math.min(max, n + d)) })}
                    />
                  </span>
                ),
              },
            };
          })}
          total={{ kind: 'Останется за стеной', steps: <b className={stay > 0 ? '' : 'bad'}>{stay}</b> }}
        />
      )}
      {standing > 0 && <p className="note">Отряд полководца стоит дома и выходит со всеми.</p>}

      <div className="sg-row-act">
        <Btn kind="link" onClick={() => setPicked({ ...home })}>
          Вывести всех
        </Btn>
        <Btn kind="link" onClick={() => setPicked({})}>
          Никого
        </Btn>
      </div>

      {/* Мораль между боями (14.31): кто и с чем выйдет за ворота и против кого — до нажатия. */}
      {siege.garrisonRest && (
        <p className="note warn">
          {restLine(siege.garrisonRest, 'Гарнизон дрался', now)} {REST_WHY}
        </p>
      )}
      {siege.campRest && <p className="note">{restLine(siege.campRest, 'Лагерь дрался', now)}</p>}
      {/* Износ осады и дела лагеря (укрепления — кость вылазки) — то, что идёт в этот бой, до нажатия (siege_audit, 5 и 11). */}
      {siege.wear !== undefined && <p className="note warn">{wearLine(siege.wear)}</p>}
      {siege.craftNote && <p className="note warn">{siege.craftNote}</p>}
      {refused && <p className="note bad">{gateBusyText(fc.now.waitMs)}</p>}
      <Btn kind="main" wide why={busy ? 'Выходят…' : ring && !post ? 'Кольца нет' : men === 0 ? 'Никого не выбрано' : refused ? 'Проход занят' : null} onClick={() => void go()}>
        Выйти{men > 0 ? ` · ${men}` : ''}
      </Btn>

      <p className="note">
        {ring
          ? 'Победа размыкает кольцо, лагерь стоит. Потери несут обе стороны, а срок голода считается заново по оставшимся.'
          : machine
          ? 'Победа сжигает машину, лагерь стоит. Потери несут обе стороны, а срок голода считается заново по оставшимся.'
          : 'Победа снимает осаду. После поражения потери несёт и лагерь, а срок голода считается заново по оставшимся.'}
      </p>
    </div>
  );
}
