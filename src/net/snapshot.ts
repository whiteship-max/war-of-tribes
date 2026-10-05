/**
 * Слепок партии для сервера: две непрозрачные строки и короткая опись.
 *
 * Опись (`SaveCard`) собирается здесь, а не на сервере, нарочно. Сервер в
 * сохранение не смотрит вовсе — он хранит и раздаёт, — а показать игроку, какие
 * две партии разошлись, кто-то должен: «день 41, 320 человек, мощь 5 900»
 * читается, «две записи с разными хешами» — нет. Считается опись теми же
 * функциями, что и весь остальной интерфейс: своей формулы мощи или населения
 * здесь нет ни одной.
 */
import type { GameState } from '@/game/types';
import type { CastleClaim, SaveCard, SaveRecord, WarSheet } from '../../netlify/lib/contract';
import { serialize } from '@/game/save';
import { armySize, dayOf, population } from '@/game/derived';
import { power } from '@/profile/power';
import { cityName, profileName } from '@/profile/identity';
import { browserStorage } from '@/world/local/state';
import { device } from './session';
import { warSheet } from './war';

export type { CastleClaim, SaveCard, SaveRecord };

export const cardOf = (s: GameState): SaveCard => ({
  name: profileName(s.profile),
  day: dayOf(s.time),
  pop: Math.round(population(s)),
  power: Math.round(power(s)),
  army: armySize(s),
});

/** Что уедет на сервер. Сохранение мира — та же строка, что лежит на диске. */
export function snapshotOf(s: GameState): SaveRecord {
  return {
    v: 1,
    rev: 0,
    updatedAt: 0,
    device: device(),
    game: serialize(s),
    world: browserStorage.read(),
    card: cardOf(s),
    // Слепок обороны для войны между игроками: его читает сервер, когда на город приходит войско (docs/pvp.md).
    ...((): { war?: WarSheet } => {
      const war = warSheet();
      return war ? { war } : {};
    })(),
  };
}

/**
 * Что игрок сообщает о себе общему реестру замков. Три числа из той же описи:
 * своей формулы мощи или населения здесь нет ни одной, и заводить её нельзя —
 * иначе соседи видели бы одну мощь, а профиль показывал другую.
 *
 * Координат тут нет и быть не может: где стоит замок, решает сервер.
 */
export function claimOf(s: GameState): CastleClaim {
  const card = cardOf(s);
  // Имя города едет очищенным, а не названное — пустой строкой: «Безымянный город» соседи
  // подставят сами тем же умолчанием, и в реестре не лягут тысячи одинаковых имён.
  return { name: card.name, city: cityName(s.profile.city) ?? '', power: card.power, pop: card.pop };
}
