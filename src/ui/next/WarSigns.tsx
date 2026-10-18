import { useGame } from '@/game/store';
import { tutorialActive } from '@/game/data/tutorial';
import { Icon } from '@/ui/icons/Icon';
import { fitSigns, useWarSigns, type WarSign } from '@/ui/warSigns';
import { useRealm } from '@/ui/realm/open';
import { useTrades } from '@/ui/trades';
import { useTreasury } from '@/ui/treasury';
import { tipAt } from './tip';
import { useChambers } from '@/ui/chambers/open';

/**
 * Тревоги войны — столбец квадратных значков справа снизу, над нижней панелью (П-7, docs/polish.md): осада, набеги,
 * свой лагерь. Значок — вход в окно, а не второе окно: знак, слово и срок, касание — к делу. Срочное горит красным и мягко
 * пульсирует, без лишнего текста. Больше трёх — последнее место занимает счётчик «+N», и он раскрывает остальные
 * подсказкой со строками-дверями.
 *
 * Стоит в двух местах одним компонентом: в городе — в корне игры, на карте — внутри её слоя, под меню приказов и
 * листами карты (`where="map"`), чтобы не закрывать их; `lift` — над полосой «человек в руке».
 */
/** Тревоги войны значками; в покоях правителя (docs/city_v3.md, Г-4) их нет — вести ждут на столе, в письмах. */
export function WarSigns({ where, lift = false }: { where: 'city' | 'map'; lift?: boolean }) {
  const inside = useChambers((c) => c.open);
  return inside && where === 'city' ? null : <CitySigns where={where} lift={lift} />;
}

function CitySigns({ where, lift }: { where: 'city' | 'map'; lift: boolean }) {
  const s = useGame((g) => g.s);
  const sheet = useGame((g) => g.sheet);
  const realm = useRealm((r) => r.open);
  const trades = useTrades((t) => t.open);
  const treasury = useTreasury((t) => t.open);
  const signs = useWarSigns();
  // Обучение ведёт новичка своим путём, и лишний слой поверх «дырки» ему мешает. Под открытым окном — шторкой, державой,
  // промыслами, сокровищницей — столбец не стоит: шторка полупрозрачна, и значок проступал бы сквозь её строки; к делу
  // игрок уже пришёл.
  if (signs.length === 0 || tutorialActive(s) || sheet || realm || trades || treasury) return null;
  const { shown, more } = fitSigns(signs);
  return (
    <div className={`nx-signs${where === 'map' ? ' on-map' : ''}${lift ? ' lift' : ''}`} role="group" aria-label="Тревоги войны">
      {shown.map((sg) => (
        <SignButton key={sg.key} sign={sg} />
      ))}
      {more.length > 0 && (
        <button
          className={`nx-sign more${more.some((m) => m.urgent) ? ' urgent' : ''}`}
          aria-label={`Ещё тревоги: ${more.length}`}
          onClick={(e) =>
            tipAt(e.currentTarget, {
              title: 'Ещё тревоги',
              rows: more.map((m) => ({
                label: `${m.label} · ${m.who}`,
                value: m.timer,
                tone: m.urgent ? 'bad' : undefined,
                icon: { name: m.icon, glyph: m.glyph },
                go: m.go,
              })),
            })
          }
        >
          <span className="nx-sign-count">+{more.length}</span>
          <span className="nx-sign-label">ещё</span>
        </button>
      )}
    </div>
  );
}

function SignButton({ sign }: { sign: WarSign }) {
  return (
    <button className={`nx-sign ${sign.kind}${sign.urgent ? ' urgent' : ''}`} onClick={sign.go} aria-label={sign.title}>
      <span className="nx-sign-ic">
        <Icon name={sign.icon} glyph={sign.glyph} />
      </span>
      <span className="nx-sign-label">{sign.label}</span>
      <span className="nx-sign-time">{sign.timer}</span>
    </button>
  );
}
