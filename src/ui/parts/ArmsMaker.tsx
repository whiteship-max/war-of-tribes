// Конструктор герба державы (docs/polish.md, П-2): форма щита, деление поля, краски, главная фигура, предпросмотр и
// «Случайный». Набор конечный (`heraldry/arms`), своих картинок нет; правило финифти держит `fitArms` — правка одной части
// подстраивает остальное, и неправильного герба на экране не бывает. Сохраняет `profile/stats.setArms`, на сервер герб
// уезжает с заявкой реестра (`net/snapshot.claimOf`) — его видят соседи.
import { useState } from 'react';
import { useGame } from '@/game/store';
import {
  CHARGES,
  CHARGE_NAMES,
  DIVISIONS,
  DIVISION_NAMES,
  METALS,
  SHIELDS,
  SHIELD_NAMES,
  TINCTURES,
  TINCTURE_NAMES,
  armsBone,
  armsCode,
  blazon,
  fitArms,
  isMetal,
  randomArms,
  type Arms,
  type Tincture,
} from '@/heraldry/arms';
import { TINCTURE_HEX } from '@/heraldry/art';
import { profileArms } from '@/profile/identity';
import { setArms } from '@/profile/stats';
import { Btn } from '@/ui/kit/Btn';
import { ArmsArt } from './Arms';

/** Выбор частью: кнопки-образцы одной сеткой. */
function Pick<T extends string>({
  title,
  items,
  on,
  name,
  art,
  onPick,
}: {
  title: string;
  items: readonly T[];
  on: T;
  name: (t: T) => string;
  art: (t: T) => Arms;
  onPick: (t: T) => void;
}) {
  return (
    <section className="am-sec">
      <h3>
        {title} <small>{name(on)}</small>
      </h3>
      <div className="am-grid">
        {items.map((t) => (
          <button
            key={t}
            type="button"
            className={`am-cell${t === on ? ' on' : ''}`}
            onClick={() => onPick(t)}
            aria-label={name(t)}
            aria-pressed={t === on}
          >
            <ArmsArt arms={art(t)} size={40} />
          </button>
        ))}
      </div>
    </section>
  );
}

/** Краски: металлы и цвета двумя группами — правило финифти видно глазом. */
function Tinctures({ title, on, onPick }: { title: string; on: Tincture; onPick: (t: Tincture) => void }) {
  const group = (metal: boolean) => TINCTURES.filter((t) => isMetal(t) === metal);
  return (
    <section className="am-sec">
      <h3>
        {title} <small>{TINCTURE_NAMES[on]}</small>
      </h3>
      <div className="am-tints">
        {[true, false].map((metal) => (
          <div key={String(metal)} className="am-tgroup">
            <i>{metal ? 'Металлы' : 'Цвета'}</i>
            {group(metal).map((t) => (
              <button
                key={t}
                type="button"
                className={`am-tint${t === on ? ' on' : ''}${METALS.includes(t) ? ' metal' : ''}`}
                style={{ background: TINCTURE_HEX[t] }}
                onClick={() => onPick(t)}
                aria-label={TINCTURE_NAMES[t]}
                aria-pressed={t === on}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

export function ArmsMaker({ onBack }: { onBack: () => void }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const save = useGame((g) => g.save);
  const saved = profileArms(s.profile);
  const [arms, setDraft] = useState<Arms>(saved);
  const [note, setNote] = useState<string | null>(null);
  const [rolls, setRolls] = useState(0);

  const put = (next: Arms, keep?: Parameters<typeof fitArms>[1]): void => {
    const fit = fitArms(next, keep);
    setDraft(fit.arms);
    setNote(fit.note);
  };
  const roll = (): void => {
    // Сеяная кость от сида партии и номера нажатия: случайности устройства в игре нет (`sim/random.test.ts`).
    setDraft(randomArms(armsBone(`${s.seed}:${rolls}`)));
    setRolls(rolls + 1);
    setNote(null);
  };
  const keep = (): void => {
    act((st) => setArms(st, armsCode(arms)));
    save();
    onBack();
  };
  const same = armsCode(arms) === armsCode(saved);

  return (
    <div className="panel arms-maker">
      <button className="btn ghost back" onClick={onBack}>
        ← К профилю
      </button>
      <h2>Герб державы</h2>

      <div className="am-head">
        <ArmsArt arms={arms} size={112} label={blazon(arms)} />
        <div className="am-say">
          <p className="am-blazon">{blazon(arms)}</p>
          <p className="am-rule">{note ?? 'Правило гербовника: металл на цвет, цвет на металл.'}</p>
          <Btn onClick={roll} label="Случайный герб">
            🎲 Случайный
          </Btn>
        </div>
      </div>

      <Pick
        title="Щит"
        items={SHIELDS}
        on={arms.shield}
        name={(t) => SHIELD_NAMES[t]}
        art={(t) => ({ ...arms, shield: t })}
        onPick={(t) => put({ ...arms, shield: t })}
      />
      <Pick
        title="Деление"
        items={DIVISIONS}
        on={arms.division}
        name={(t) => DIVISION_NAMES[t]}
        // Образец деления — на красках этого герба; у простого поля вторая краска — металл или цвет против первой.
        art={(t) => fitArms({ ...arms, division: t, field: [arms.field[0], t === 'plain' ? arms.field[0] : arms.field[1]] }, 'field0').arms}
        onPick={(t) => put({ ...arms, division: t, field: [arms.field[0], t === 'plain' ? arms.field[0] : arms.field[1]] }, 'field0')}
      />
      <Tinctures title={arms.division === 'plain' ? 'Поле' : 'Поле: первая краска'} on={arms.field[0]} onPick={(t) => put({ ...arms, field: [t, arms.division === 'plain' ? t : arms.field[1]] }, 'field0')} />
      {arms.division !== 'plain' && (
        <Tinctures title="Поле: вторая краска" on={arms.field[1]} onPick={(t) => put({ ...arms, field: [arms.field[0], t] }, 'field1')} />
      )}
      <Pick
        title="Фигура"
        items={CHARGES}
        on={arms.charge as (typeof CHARGES)[number]}
        name={(t) => CHARGE_NAMES[t]}
        art={(t) => ({ ...arms, charge: t })}
        onPick={(t) => put({ ...arms, charge: t })}
      />
      <Tinctures title="Краска фигуры" on={arms.tint} onPick={(t) => put({ ...arms, tint: t }, 'tint')} />

      <div className="am-foot">
        <Btn kind="main" wide onClick={keep} why={same ? 'Этот герб уже ваш' : null}>
          Сохранить герб
        </Btn>
      </div>
    </div>
  );
}
