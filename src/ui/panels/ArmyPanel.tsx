// «Дружина» из строки состояния и низа: оборона, кто в ней, передача между гарнизоном и отрядом полководца и вид бойцов
// карточкой. Передача стоит здесь же, а не за строкой «Раскладка» (UI-4, docs/ui_v2.md, 5.3): решение о том, кто где, —
// про всё войско, а всё войско видно здесь. Строка вида в передаче — дверь в его карточку; виды, которых в дружине нет,
// — значками под ней: карточка вида одна, и прежде её открывал список «Состав» всех девяти видов. Кольца контров нет
// (слово владельца по 14.35, docs/battle_eu4.md): кто кого бьёт, решают показатели.
import { useState } from 'react';
import type { TroopId } from '@/game/types';
import { useGame } from '@/game/store';
import { TROOPS } from '@/game/data/troops';
import { armyPower, armySize, buildingOfType, defense, homeArmy, recruitsQueued } from '@/game/derived';
import { useWorld, worldNow } from '@/world/store';
import { WOUND_DAYS } from '@/game/constants';
import { REST_WHY, restLine } from '../parts/restWords';
import { waitDays } from '../parts/wait';
import { count } from '../parts/plural';
import { TroopCardView } from '../parts/TroopCardView';
import { Muster, inWallsTip, outWallsTip } from '../parts/Muster';
import { Icon } from '@/ui/icons/Icon';
import { Num } from '@/ui/kit/Num';
import { defenseTip, fmtInt, type TipGo } from '@/ui/next/hudTips';
import { goTo } from '@/ui/kit/nav';
import { dec } from '@/game/num';
import { iconName } from '@/ui/icons/registry';

export function ArmyPanel() {
  const s = useGame((g) => g.s);
  const openBuilding = useGame((g) => g.openBuilding);
  const [open, setOpen] = useState<TroopId | null>(null);
  const marches = useWorld((g) => g.marches);
  const figures = useWorld((g) => g.figures);
  const barracks = buildingOfType(s, 'barracks');
  const home = homeArmy(s);
  const away = armySize(s) - home;
  const training = recruitsQueued(s);
  const general = figures.find((f) => f.id === 'general');

  if (open) return <TroopCardView troop={open} onBack={() => setOpen(null)} />;

  const go: TipGo = {
    tab: (t) => goTo({ kind: 'tab', tab: t }),
    building: openBuilding,
    realm: (v) => goTo({ kind: 'realm', view: v }),
    to: goTo,
  };

  const unhired = TROOPS.filter((d) => (s.army[d.id] ?? 0) <= 0);

  return (
    <div className="panel">
      <h2>
        <Icon name="hud-army" /> Дружина <small>{count(armySize(s), 'боец', 'бойца', 'бойцов')} · мощь {Math.round(armyPower(s))}</small>
      </h2>

      {/* Три числа одной строкой ячеек (docs/ui_v2.md, 2.1): мощь обороны, бойцы в городе и в походе — каждое с подсказкой.
          Единица названа в подписи: прежде «Оборона 1264 | В обороне 127 | Не в обороне 980» ставило мощь в ряд с головами
          (отзыв тестеров 18.10, docs/feedback.md). */}
      <div className="ms-sum">
        {/* Разбор обороны — тот же, что у строки «Оборона» сводки «Жителей» (`hudTips.defenseTip`, UI-5). */}
        <Num label="Мощь обороны" tip={() => defenseTip(s, go)}>
          <small>Мощь обороны</small>
          <b className="good">{dec(defense(s), 0)}</b>
        </Num>
        <Num label="Бойцов в городе" tip={() => inWallsTip(s, marches, figures)}>
          <small>Бойцов в городе</small>
          <b>{fmtInt(home)}</b>
        </Num>
        <Num label="Бойцов в походе" tip={() => outWallsTip(s)}>
          <small>Бойцов в походе</small>
          <b className={away > 0 ? 'bad' : ''}>{fmtInt(away)}</b>
        </Num>
      </div>
      {training > 0 && (
        <div className="mod">
          <span className="ico"><Icon name="ui-target" /></span>
          <span className="name">Новобранцы</span>
          <span className="val">{training}</span>
        </div>
      )}

      {/* Кто в гарнизоне, кто с полководцем — передача здесь, одна на всю игру (docs/retinue.md, docs/ui_v2.md, 5.3). */}
      <h3>Гарнизон и отряд</h3>
      <Muster onCard={setOpen} />

      {unhired.length > 0 && (
        <>
          <h3>Ещё виды</h3>
          <div className="ms-more">
            {unhired.map((d) => (
              <button type="button" key={d.id} className="ms-more-b" onClick={() => setOpen(d.id)} aria-label={`${d.name}: карточка вида`}>
                <Icon name={iconName('troop', d.id)} />
              </button>
            ))}
          </div>
        </>
      )}

      <h3>Мораль между боями</h3>
      <div className="note">
        После боя мораль уцелевших проседает и за {waitDays(WOUND_DAYS)} возвращается к полной. {REST_WHY}
      </div>
      {general?.rest && <div className="note warn">{restLine(general.rest, 'Отряд дрался', worldNow())}</div>}

      {barracks && (
        <button className="btn wide" onClick={() => openBuilding(barracks.id)}>
          <Icon name="bld-barracks" /> Нанять
        </button>
      )}
    </div>
  );
}
