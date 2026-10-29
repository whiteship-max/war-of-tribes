// Кусок Пути меча (ПН-5, хвост а): двери пути, которые зовёт главный кусок, — одним объектом. Едет своим куском: его докачивает
// реестр `game/roamlazy` только тому, кому путь открыт (`roamflag.roamOn`), и в первую загрузку игрока он не попадает. Сам кусок
// отдаёт двери реестру при загрузке. Правил здесь нет — только сборка: каждая дверь живёт в своём модуле.
import { provideRoamDoor, type RoamDoor } from './roamlazy';
import { beginRoam, mergeRoam, roamFor, setMove } from './sim/roam';
import { addCargo } from './sim/cargo';
import { bandMailArrive } from './sim/bandasks';
import { healBand } from './sim/bandwounds';
import { bandSpiritIn } from './sim/bandspirit';
import { toBand } from './sim/bandgrant';
import { warriorStart } from './roamorigin';
import { bandSeatOf } from '@/net/bandseat';
import { bandRow, keepRoster } from '@/net/bandroster';
import { flushBook } from '@/net/bandbook';
import { readMove } from '@/world/roammove';
import type { GameState } from './types';
import { profileName } from '@/profile/identity';

/** Новая партия `s` бродягой — Воином (`roamorigin`): имя и лицо — прежней партии `was`, герой носит имя игрока. Отказ — словами. */
function startRoam(s: GameState, was: GameState): string | null {
  s.profile = { ...s.profile, ...was.profile };
  return beginRoam(s, warriorStart(s, profileName(s.profile)));
}

export const ROAM_DOOR: RoamDoor = {
  /** Шаг отряда кусками (`sim/tick.liveStep`, `absence`). */
  roamFor,
  /** Вести отряда на сетке почты — «Просятся в отряд» (ПН-6). */
  roamMail: (s, from, now) => void bandMailArrive(s, from, now),
  /** Фаза и отряд из сохранения (`save.deserialize`). */
  mergeRoam,
  /** Запись хода, которую вывел сервер (`store` → реестр). */
  setMove,
  readMove,
  /** Вход в путь со стартового экрана (`store.beginRoamParty`). */
  startRoam,
  /** Обоз — ключ `cargo` двери склада (`sim/stock.addStock`). */
  addCargo,
  /** Дух отряда — входы отряда двери духа (`sim/spirit.spiritIn`). */
  bandSpiritIn,
  /** Указ админа отряду (`sim/admin.applyGrants`). */
  toBand,
  /** Строка отряда в реестр (`net/roster`, провайдер стора). */
  bandSeatOf,
  /** Ответ реестра: строка отряда и видимость (`net/roster.keep`), встал ли отряд (`roster.seated`). */
  keepRoster,
  bandRow,
  /** Очередь книги отряда — перед отметкой (`net/roster`, ПН-6). */
  flushBook,
  /** Лечение отряда за алмазы (`sim/gems.applyGemDeeds`, ПН-6). */
  healBand,
};

provideRoamDoor(ROAM_DOOR);
