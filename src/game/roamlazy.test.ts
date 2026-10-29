// Путь меча докачкой (ПН-5, хвост а; `game/roamlazy`): кусок пути отдаётся только тому, кому путь открыт, и в первую загрузку не
// едет — держит это сборка (`vite.config.ts`, `LAZY_DOORS`, «Путь меча»: модуль куска в статическом замыкании точки входа — ошибка
// сборки). Здесь — правило реестра и то, что сборка сторожит именно эти модули.
//
// Граница области — утверждениями: кусок правда загружен (его двери в реестре есть), и путь правда закрыт или открыт.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { roamOn, setRoamOpen } from './roamflag';
import { ROAM_DOOR } from './roamdoor';
import { loadRoamDoor, roamDoor } from './roamlazy';

afterEach(() => setRoamOpen(false));

describe('реестр куска пути', () => {
  it('путь закрыт — двери нет, даже когда кусок загружен; открыт — та же, что отдал кусок', async () => {
    expect(ROAM_DOOR.roamFor, 'граница: кусок загружен').toBeTypeOf('function');
    expect(roamOn(), 'граница: путь закрыт').toBe(false);
    expect(roamDoor()).toBeNull();
    expect(await loadRoamDoor()).toBeNull();
    setRoamOpen(true);
    expect(roamDoor()).toBe(ROAM_DOOR);
    expect(await loadRoamDoor()).toBe(ROAM_DOOR);
  });

  it('сборка сторожит кусок: дверь `roamdoor` и модули пути — в списке ленивых, их утечка в первую загрузку — ошибка', () => {
    const cfg = readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf8');
    const at = cfg.indexOf("name: 'Путь меча'");
    expect(at, 'запись «Путь меча» в LAZY_DOORS').toBeGreaterThan(0);
    const entry = cfg.slice(at, cfg.indexOf('},\n  },', at) > 0 ? cfg.indexOf('},\n  },', at) : at + 2000);
    expect(entry).toContain('roamdoor');
    for (const m of ['roam|cargo|bandkeep|bandwounds|bandspirit|bandgrant', 'roamorigin|roamrules|roamstubs', 'bandseat', 'bandroster']) {
      expect(entry, m).toContain(m);
    }
  });

  it('главный кусок зовёт двери пути только через реестр: прямого импорта модулей куска нет у дверей главного', () => {
    const MAIN = ['game/sim/tick.ts', 'game/save.ts', 'game/sim/stock.ts', 'game/sim/spirit.ts', 'game/sim/admin.ts', 'game/store.ts', 'net/roster.ts', 'net/snapshot.ts'];
    const LAZY = /from '(?:\.\.?\/|@\/(?:game|net|world)\/)(?:sim\/)?(?:roam|cargo|bandkeep|bandwounds|bandspirit|bandgrant|roamorigin|roamrules|roamstubs|bandseat|bandroster|roamdoor)'/;
    for (const f of MAIN) {
      const src = readFileSync(join(process.cwd(), 'src', f), 'utf8');
      const hit = src.split('\n').find((l) => /^import (?!type)/.test(l) && LAZY.test(l));
      expect(hit, f).toBeUndefined();
    }
  });
});
