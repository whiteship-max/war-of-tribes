// Вид карты мира: прежний или новый, в духе карты кампании (docs/map_tw.md). Новый — за переключателем,
// пока владелец его не одобрил: `?map=tw` включает, `?map=old` возвращает прежний. Выбор запоминается на
// устройстве — в Телеграме адрес игры не поправишь. Читается один раз на запуске; сам новый вид едет
// своим куском (`ground.ts`), в первой загрузке от него только этот флаг.
const KEY = 'tribe.map';

function read(): boolean {
  try {
    const asked = new URLSearchParams(location.search).get('map');
    if (asked === 'tw') localStorage.setItem(KEY, 'tw');
    else if (asked === 'old') localStorage.removeItem(KEY);
    return localStorage.getItem(KEY) === 'tw';
  } catch {
    return false;
  }
}

export const MAP_TW = typeof location !== 'undefined' && read();
