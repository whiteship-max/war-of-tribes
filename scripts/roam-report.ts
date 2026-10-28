// Путь меча числами — прибор `npm run roam:report` (пачка ПН-0, ПН-0ч; docs/gdd/path_of_sword.md, 6.5, 7.1 и раздел 11).
//
// Разделы — по ГДД: что уже считается дверями кода (содержание эталонов тира, курс припаса, цены повышения, сроки пути, плата
// договоров) и что меряет автопилот пути трёх стилей (сила НПС неподвижной точкой, темп престижа, медиана до первого замка,
// паритет с НФТ-стартом), пул вольных замков, доля обнаружений по видам лагеря; в конце — реестр всех ориентиров ГДД.
// Режима в коде нет, поэтому у каждого раздела в шапке статус: «выведено» — только двери кода; «формула ГДД» — правило ГДД на
// числах кода, двери нет; «НЕ ИЗМЕРЕНО» — хоть одна заглушка (ориентир или число прибора), с пачкой, которая её заменит. Статус
// выводится из объявленных входов, а не пишется (`roam/run.ts`), и держит это тест (`roam/roam.test.ts`). Ни одно число
// отсюда не идёт в код игры.
//
//   npm run roam:report                  малый прогон — облако и дом
//   ROAM_SIZE=full npm run roam:report   полный — ночь на сервере (deploy/ci/night-inner.sh)
import { TEST_ARMY_FOOD } from '../src/game/constants';
import { TEST_TRAVEL_SPEED } from '../src/world/data/tuning';
import { ORIENTS } from './roam/orients';
import { inputLines, orientLines, render, sizeOf } from './roam/run';
import { SECTIONS } from './roam/sections';

const size = sizeOf(process.env.ROAM_SIZE);
const TRAVEL: number = TEST_TRAVEL_SPEED;
console.log('━━ Путь меча: прибор roam:report (ПН-0) ━━');
console.log(
  `размер: ${size.name} (ROAM_SIZE=${size.name === 'малый' ? 'small' : 'full'}); партий на стиль и происхождение ${size.seeds}, шагов вывода силы НПС до ${size.steps}`,
);
console.log(
  `множители теста: путь ×${TRAVEL}, паёк войска ×${TEST_ARMY_FOOD}${TRAVEL === 1 && TEST_ARMY_FOOD === 1 ? ' — обычные правила' : ' — НЕ 1: сроки пути и паёк недействительны до ПН-01 (ГДД 0.4, С1)'}`,
);
console.log('статус раздела: «выведено» — двери кода; «формула ГДД» — правило ГДД на числах кода; «НЕ ИЗМЕРЕНО» — на заглушках');
console.log('');
console.log('━━ Входы прибора: правила ГДД без кода и заглушки (имя, род, раздел ГДД → пачка, которая заменит дверью) ━━');
for (const l of inputLines()) console.log(l);
await render(SECTIONS, size, (l) => console.log(l));
console.log('');
console.log(`━━ Реестр ориентиров ГДД: ${ORIENTS.length} разделов ━━`);
for (const l of orientLines(ORIENTS, new Map(SECTIONS.map((s) => [s.id, s.title])))) console.log(l);
