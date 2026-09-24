import { useState } from 'react';
import { SPEEDS, dayRealSeconds, speed } from '@/game/pace';
import { hurry, leadAt } from '@/net/clock';
import { useGame } from '@/game/store';
import { markHaste } from '@/game/sim/cheat';
import { HASTE_MARK } from '@/cheats';
import { realMinSec } from './parts/wait';

/**
 * Скорость проверки — как в Europa Universalis IV: справа сверху, видна всегда, одно касание — следующая
 * ступень (`pace.SPEEDS`, по кругу ×1 → ×30 → ×120 → ×1). Что ускоряется и почему не поворот шкалы —
 * `game/pace`, раздел «Скорость проверки».
 *
 * ОДИН КОМПОНЕНТ НА ДВА МЕСТА ПОКАЗА — в ряду кнопок деревни (`TopBar`) и в шапке карты (`WorldMap`):
 * поход проверяют на карте, склад — в деревне, и скорость обязана быть видна там и там. Своего состояния
 * скорости у компонента нет — он читает дверь (`pace.speed`) при появлении и помнит только то, что сам
 * нажал; карта и деревня никогда не стоят на экране разом.
 *
 * ЗАПЕРТ ТЕМ ЖЕ ВЫКЛЮЧАТЕЛЕМ, ЧТО КОДЫ (`src/cheats.ts`): оба места показа рисуют его только под
 * `CHEATS_ON` — с опущенным его нет в сборке вовсе (тест по исходникам, `game/speed.test.ts`). Стилей у
 * него нет своих нарочно: правило в общем файле стилей ехало бы в первую загрузку и при опущенном
 * выключателе. Вид — кнопка того места, где он стоит, плюс цвет режима.
 *
 * АЛМАЗОВ И СЕРВЕРА НЕ КАСАЕТСЯ. Скорость двигает часы партии и больше ничего: ни начисления, ни
 * запроса. Замок алмазов по всему `src` (`gems.test.ts`) стоит и над этим файлом.
 */
export function SpeedButton({ className }: { className: string }) {
  const [shown, setShown] = useState(speed());
  const act = useGame((g) => g.act);
  const save = useGame((g) => g.save);
  const marked = useGame((g) => g.s.lead !== undefined);
  const at = SPEEDS.indexOf(shown as (typeof SPEEDS)[number]);
  const next = SPEEDS[(at + 1) % SPEEDS.length];
  const day = (k: number): string => realMinSec(dayRealSeconds() / k);

  const tap = (): void => {
    act((s) => {
      hurry(next);
      markHaste(s, leadAt());
      return null;
    });
    setShown(next);
    // На диск сразу, как у кодов: метка партии не должна ждать автосохранения.
    save();
  };

  const fast = shown > 1;
  return (
    <button
      className={className}
      onClick={tap}
      title={`Скорость проверки ×${shown}: игровой день — ${day(shown)}. Нажми — ×${next}, день — ${day(next)}.${marked ? ` ${HASTE_MARK}` : ''}`}
      aria-label={`Скорость проверки ×${shown}`}
      style={{
        marginLeft: 'auto',
        padding: '0 8px',
        fontSize: 13,
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
        color: fast ? 'var(--accent)' : undefined,
        borderColor: fast ? 'var(--accent)' : undefined,
        // Партия, которую ускоряли, видна и по кнопке, как у кодов: полоса снизу.
        boxShadow: marked ? 'inset 0 -3px 0 var(--bad)' : undefined,
      }}
    >
      ×{shown}
    </button>
  );
}
