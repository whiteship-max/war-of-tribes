import { defineConfig, transformWithEsbuild, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { budgetCores } from './scripts/lib/budget';

/**
 * Снимки стенда-витрины. Только dev-сервер: страница `?showcase=…&snap=имя`
 * отправляет PNG кадра на POST /__snap?name=имя, и он ложится в snaps/имя.png.
 * Иначе скриншот графики не сохранить в файл: буфер WebGL снаружи страницы недоступен.
 */
function snapPlugin(): Plugin {
  return {
    name: 'tribe-snap',
    apply: 'serve',
    configureServer(server) {
      const dir = fileURLToPath(new URL('./snaps', import.meta.url));
      // Замеры частоты кадров со стенда (?perf=…): строка JSON на замер, в snaps/perf.jsonl.
      server.middlewares.use('/__perf', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          mkdirSync(dir, { recursive: true });
          appendFileSync(join(dir, 'perf.jsonl'), Buffer.concat(chunks).toString('utf8').replace(/\s+$/, '') + '\n');
          res.setHeader('Content-Type', 'text/plain');
          res.end('ok');
        });
      });
      server.middlewares.use('/__snap', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const raw = new URL(req.url ?? '/', 'http://localhost').searchParams.get('name') ?? 'snap';
        const name = raw.replace(/[^\w.-]+/g, '_');
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          mkdirSync(dir, { recursive: true });
          const file = join(dir, `${name}.png`);
          writeFileSync(file, Buffer.concat(chunks));
          res.setHeader('Content-Type', 'text/plain');
          res.end(file);
        });
      });
    },
  };
}

/**
 * Ужимает встроенный экран загрузки.
 *
 * Экран живёт прямо в `index.html` — иначе он появился бы только после бандла,
 * то есть после того самого ожидания, которое закрывает. Но объяснения, зачем
 * там каждое число, писаны нам, а не телефону игрока: несжатыми они стоили
 * четырёх пятых веса файла. Плагин выбрасывает комментарии и отступы на сборке;
 * в исходнике и на dev-сервере всё остаётся как написано, и тест читает именно
 * исходник.
 *
 * Ничего никуда не переезжает: разметка, стили, картинка и код по-прежнему
 * в одном файле и по-прежнему без единого внешнего запроса.
 */
function bootMinifyPlugin(): Plugin {
  return {
    name: 'tribe-boot-minify',
    apply: 'build',
    enforce: 'post',
    async transformIndexHtml(html) {
      let out = html;
      // <style> в шапке — только наш, экрана загрузки: стили игры едут чанком.
      const styles = [...out.matchAll(/<style>([\s\S]*?)<\/style>/g)];
      for (const m of styles) {
        const { code } = await transformWithEsbuild(m[1], 'boot.css', { loader: 'css', minify: true, charset: 'utf8' });
        out = out.replace(m[0], `<style>${code.trim()}</style>`);
      }
      const scripts = [...out.matchAll(/<script>([\s\S]*?)<\/script>/g)];
      for (const m of scripts) {
        const { code } = await transformWithEsbuild(m[1], 'boot.js', { loader: 'js', minify: true, charset: 'utf8' });
        out = out.replace(m[0], `<script>${code.trim()}</script>`);
      }
      // Комментарии разметки и отступы между тегами.
      out = out.replace(/<!--(?!\[if)[\s\S]*?-->/g, '');
      out = out.replace(/\n\s*/g, '\n').replace(/\n{2,}/g, '\n');
      return out;
    },
  };
}

/**
 * Ленивые куски обязаны быть ленивыми — и проверяет это сборка, а не глаз на опись.
 *
 * Режим, в который игрок может не зайти ни разу, не имеет права стоить ему ни байта на
 * старте. Но сломать это можно, не тронув ни одного `import()`: модуль попадает в чанк
 * целиком, и одна функция ролика, положенная рядом с тем, что читает мир, тянет в первую
 * загрузку всю режиссуру за собой. Так и было: `castOfRecord` лежал в `faces.ts` рядом с
 * `troopsOfKinds`, а `@/battle` реэкспортировал `./replay` — и ролик ехал каждому игроку,
 * хотя смотрел его никто.
 *
 * Поэтому правило здесь про модули, а не про имена файлов: у каждой двери перечислено,
 * чем она владеет, и ни один такой модуль не может оказаться в статическом замыкании
 * точки входа. Сама дверь обязана остаться динамической точкой входа. Не сошлось —
 * сборка падает и называет модули.
 */
const LAZY_DOORS: { name: string; door: RegExp; owns: RegExp[] }[] = [
  {
    // Карта мира (РТ-2, docs/stability.md, «РТ-2»: первая загрузка не растёт от сословий) — своим куском по кнопке низа;
    // код подтягивается в фоне, когда замок встал, в простое и не на медленной сети (`boot/warm`, `ui/map/chunks`, РТ-2б).
    name: 'карта мира',
    door: /\/src\/ui\/map\/WorldMap\.tsx$/,
    owns: [/\/src\/ui\/map\/WorldMap\.tsx$/],
  },
  {
    // «Рейтинг» и «Молва края» (РТ-1) — окна кнопок карты; подтягиваются в фоне следом за картой (РТ-2б).
    name: 'рейтинг',
    door: /\/src\/ui\/map\/Rating\.tsx$/,
    owns: [/\/src\/ui\/map\/Rating\.tsx$/],
  },
  {
    name: 'молва края',
    door: /\/src\/ui\/map\/Feed\.tsx$/,
    owns: [/\/src\/ui\/map\/Feed\.tsx$/],
  },
  {
    // Тело окна «Скоро зима» (РТ-2б) — к своему часу или в фоне после замка; страж слоя модалок (`WinterModal`) — в первой.
    name: 'окно зимы',
    door: /\/src\/ui\/WinterBody\.tsx$/,
    owns: [/\/src\/ui\/WinterBody\.tsx$/],
  },
  {
    // Замеры с телефонов (docs/telemetry.md): в первую загрузку едет только счёт кадров (`perf/telemetry`), а сборка пачки
    // и описание устройства — своим куском после старта (бюджет задания Г-1: не больше 2 КБ к первой загрузке).
    name: 'пачка замеров',
    door: /\/src\/perf\/batch\.ts$/,
    owns: [/\/src\/perf\/batch\.ts$/],
  },
  {
    name: 'ролик о бое',
    door: /\/src\/ui\/battle\/BattleReplay\.tsx$/,
    owns: [/\/src\/ui\/battle\/BattleReplay\.tsx$/, /\/src\/battle\/replay\.ts$/, /\/src\/game\/battle\/(cast|ground)\.ts$/],
  },
  {
    // Ролик боя в стиле Total War (docs/battle_tw.md) и его общий модуль (`render/reel`, docs/gfx.md: бойцы, земля, свет,
    // камера, журнал → ролик) — свой кусок по «Смотреть бой» и на стенде `?replay=tw`; в первую загрузку не едет.
    name: 'ролик TW',
    door: /\/src\/render\/tw\/(play|stand)\.ts$/,
    owns: [/\/src\/render\/tw\//, /\/src\/render\/reel\//],
  },
  {
    // Ролик осады (docs/gfx.md, ГФ-2): слой игры и сцена — свои куски по «Смотреть осаду» и ролику фазы в донесении; общее с
    // роликом боя (`render/reel`, кирпичики места `render/tw`) — в общем куске. В первую загрузку не едет.
    name: 'ролик осады',
    door: /\/src\/ui\/battle\/SiegeReplay\.tsx$/,
    owns: [/\/src\/ui\/battle\/SiegeReplay\.tsx$/],
  },
  {
    name: 'сцена осады',
    door: /\/src\/render\/siege\/(play|stand)\.ts$/,
    owns: [/\/src\/render\/siege\//],
  },
  {
    // Звуки боя ролика TW (docs/battle_tw.md, «Звук») — своя докачка: тянет её только ролик TW после первого кадра, в
    // кусок ролика и в первую загрузку она не едет.
    name: 'звук боя TW',
    door: /\/src\/sound\/battlefx\.ts$/,
    owns: [/\/src\/sound\/battlefx\.ts$/],
  },
  {
    // Движок звука (П-3, docs/sound.md): цепочка выхода, музыка боя и её манифест — докачкой после первого касания; в
    // первой загрузке из звука только дверь (`sound/door.ts`: контекст жестом) и настройки громкости.
    name: 'звук: движок',
    door: /\/src\/sound\/web\.ts$/,
    owns: [/\/src\/sound\/(web|music|manifest|chain)\.ts$/],
  },
  {
    // Звук города и карты — фон, музыка эпохи, звуки интерфейса (docs/audio.md): тянет его `sound/city.ts` после первого
    // касания, в первую загрузку он не едет.
    name: 'звук города',
    door: /\/src\/sound\/epoch\/index\.ts$/,
    owns: [/\/src\/sound\/epoch\//],
  },
  {
    // Голоса зданий (docs/city_v3.md, ЗВ-1) — своя докачка из куска звука города по первому касанию здания: ни в первую
    // загрузку, ни в кусок фона они не едут.
    name: 'голоса зданий',
    door: /\/src\/sound\/epoch\/halls\.ts$/,
    owns: [/\/src\/sound\/epoch\/halls\.ts$/],
  },
  {
    // Промыслы — мини-игры от первого лица (docs/minigames.md): свой кусок по кнопке входа; «Охота» внутри него —
    // ещё одна докачка (лук, олени, звук), её тянет только «На охоту».
    name: 'промыслы',
    door: /\/src\/minigames\/Minigame\.tsx$/,
    owns: [/\/src\/minigames\//],
  },
  {
    // Покои правителя (docs/city_v3.md, Г-4): вид от первого лица из главной башни — свой кусок, его тянет верх города,
    // когда покои открыты; в первую загрузку и в кусок интерфейса не едет (в них только рычаг `ui/chambers/open.ts`).
    name: 'покои',
    door: /\/src\/ui\/chambers\/Chambers\.tsx$/,
    owns: [/\/src\/ui\/chambers\/(Chambers\.tsx|doors\.ts|chambers\.css)$/, /\/src\/render\/chambers\//],
  },
  {
    // Супруга правителя (docs/characters.md, ЛЦ-2): фигура, листы кодом и живость — свой кусок внутри покоев, его тянет жизнь
    // покоев при входе; в кусок покоев и в первую загрузку не едет. Набор персонажа (`chambers/kit`, ЛЦ-3) — общий с гонцом.
    name: 'супруга',
    door: /\/src\/render\/chambers\/consort\/index\.ts$/,
    owns: [/\/src\/render\/chambers\/consort\//, /\/src\/render\/chambers\/kit\//],
  },
  {
    // Гонец (docs/characters.md, ЛЦ-3): фигура на том же наборе персонажа — свой кусок внутри покоев, его тянет жизнь
    // покоев при входе; набор — общим куском с супругой. В кусок покоев и в первую загрузку не едет.
    name: 'гонец',
    door: /\/src\/render\/chambers\/herald\/index\.ts$/,
    owns: [/\/src\/render\/chambers\/herald\//, /\/src\/render\/chambers\/kit\//],
  },
  {
    // Советник (docs/characters.md, ЛЦ-5): фигура на том же наборе персонажа — свой кусок внутри покоев, его тянет жизнь
    // покоев при входе; набор — общим куском. В кусок покоев и в первую загрузку не едет.
    name: 'советник',
    door: /\/src\/render\/chambers\/advisor\/index\.ts$/,
    owns: [/\/src\/render\/chambers\/advisor\//, /\/src\/render\/chambers\/kit\//],
  },
  {
    // Служанка (docs/characters.md, ЛЦ-6): фигура на том же наборе персонажа — свой кусок внутри покоев, его тянет жизнь
    // покоев при входе; набор — общим куском. В кусок покоев и в первую загрузку не едет.
    name: 'служанка',
    door: /\/src\/render\/chambers\/maid\/index\.ts$/,
    owns: [/\/src\/render\/chambers\/maid\//, /\/src\/render\/chambers\/kit\//],
  },
  {
    // Кот покоев (docs/characters.md, ЛЦ-4): фигура, лист окраса, живость и клубок на том же наборе персонажа — свой кусок
    // внутри покоев, его тянет жизнь покоев при входе; мозг кота (`chambers/cat.ts`) — в куске покоев. В первую загрузку не едет.
    name: 'кот',
    door: /\/src\/render\/chambers\/pet\/index\.ts$/,
    owns: [/\/src\/render\/chambers\/pet\//, /\/src\/render\/chambers\/kit\//],
  },
  {
    name: 'охота',
    door: /\/src\/minigames\/huntPlay\.ts$/,
    owns: [/\/src\/minigames\/hunt/],
  },
  {
    // «Рыбалка» — третья докачка внутри промыслов (удочка, вода, рыбы, звук): её тянет только «К воде».
    name: 'рыбалка',
    door: /\/src\/minigames\/fishPlay\.ts$/,
    owns: [/\/src\/minigames\/fish/],
  },
  {
    name: 'предыстория',
    door: /\/src\/prologue\/Prologue\.tsx$/,
    owns: [/\/src\/prologue\//, /\/src\/sound\/howl\.ts$/],
  },
  {
    // Сцена игры — город (docs/city.md, «Город — единственный вид»): `main.tsx` везёт его кусок до игры,
    // в первую загрузку он не входит; стенд города — тем же куском. Окружение посёлка (`render/env`) ушло с
    // посёлком; луг ролика взял своё в `render/reel/` — кусок ролика.
    name: 'город: стенд',
    door: /\/src\/render\/city\/stand\.ts$/,
    owns: [/\/src\/render\/city\//],
  },
  {
    name: 'город: сцена игры',
    door: /\/src\/render\/city\/scene\.ts$/,
    owns: [/\/src\/render\/city\//],
  },
  {
    // Вода — одна на игру (docs/polish.md, П-8): шейдер, материал и луна над водой едут с городом, роликами и рыбалкой,
    // каждым их куском; в первую загрузку — только краски (`water/tone.ts`, у карты) и уровень (`water/lod.ts`).
    name: 'вода',
    door: /\/src\/render\/city\/scene\.ts$/,
    owns: [/\/src\/render\/water\/(glsl|material|moon|shape|model)\.ts$/],
  },
  {
    // Огни мест на ночной карте (docs/polish.md, П-9): огоньки едут своим куском при первой ночи; в первой загрузке —
    // только синяя заливка ночи (`tw/night.ts`).
    name: 'огни карты',
    door: /\/src\/ui\/map\/tw\/sparks\.ts$/,
    owns: [/\/src\/ui\/map\/tw\/sparks\.ts$/],
  },
  {
    // Живой город (docs/city.md, 13): телеги, утки, лодки, стяги — своя докачка, сцена и стенд тянут её после первого
    // кадра города; в кусок города и в первую загрузку она не едет.
    name: 'город: суета',
    door: /\/src\/render\/city\/alive\.ts$/,
    owns: [/\/src\/render\/city\/alive\.ts$/],
  },
  {
    // Стража города бойцами роликов (docs/polish.md, П-5): лучники на стене и копейщики у ворот — толпа роликов
    // (`render/reel`); своя докачка вместе с суетой, после первого кадра города. В кусок города и в первую загрузку не едет.
    name: 'город: стража',
    door: /\/src\/render\/city\/garrison\.ts$/,
    owns: [/\/src\/render\/city\/garrison\.ts$/],
  },
  {
    // Сценки жителей вблизи (docs/city_v3.md, ЖГ-2): каталог, режиссёр и меши — своя докачка вместе с суетой, после первого
    // кадра города. В кусок города и в первую загрузку не едет.
    name: 'город: сценки',
    door: /\/src\/render\/city\/skitview\.ts$/,
    owns: [/\/src\/render\/city\/skit(view|s)\.ts$/],
  },
  {
    // Отклик на дела игрока (docs/city.md, 14): леса стройки, праздник готовности, найм строем, слой добычи — своя
    // докачка вместе с суетой, после первого кадра города.
    name: 'город: отклик',
    door: /\/src\/render\/city\/deeds\.ts$/,
    owns: [/\/src\/render\/city\/deeds\.ts$/, /\/src\/render\/city\/deeds\.css$/],
  },
  {
    // Погода (docs/city.md, 15): струи дождя и снегопад — своя докачка вместе с суетой, после первого кадра города; на
    // «Низком» её не тянут вовсе. Тот же кусок тянет промысел, когда у города дождь или снег (`minigames/stage`, П-4).
    name: 'город: погода',
    door: /\/src\/render\/city\/precip\.ts$/,
    owns: [/\/src\/render\/city\/precip\.ts$/],
  },  {
    // Совет Ратуши (РТ-1, docs/city_v3.md): окно совета, просители, найм и слова окна — кусок нового вида (`ui/next`, его тянет
    // ратуша); шагу партии нужен только сидящий (`sim/council`), он в первой загрузке.
    name: 'совет: просители',
    door: /\/src\/ui\/next\/index\.ts$/,
    owns: [/\/src\/ui\/next\/HallCouncil\.tsx$/, /\/src\/game\/sim\/candidates\.ts$/, /\/src\/game\/data\/councilWords\.ts$/],
  },
  {
    // Окно «Настройки» стартового экрана, подсказка обучения, шторка окон и слова хлеба осады (ОС-1, docs/siege_v2.md, 23: первая
    // загрузка не растёт) — куском нового вида: настройки отдаёт `App` по кнопке, как шаг имени; подсказка встаёт с верхом и низом;
    // всё, что показывает шторка, едет тем же куском; слова пишет окно защитника, а правила хлеба (`world/siegefood`) — с миром.
    name: 'настройки старта, подсказка обучения, шторка и слова хлеба',
    door: /\/src\/ui\/next\/index\.ts$/,
    owns: [
      /\/src\/ui\/parts\/Settings\.tsx$/,
      /\/src\/ui\/TutorialOverlay\.tsx$/,
      /\/src\/ui\/Sheet\.tsx$/,
      // Окна-сообщения после входа (ОС-1в): до входа их закрывает стартовый экран.
      /\/src\/ui\/(Offline|Legacy|Pace)Modal\.tsx$/,
      /\/src\/world\/siegewords\.ts$/,
    ],
  },
  {
    // Рейтинг и молва края на карте (РТ-1, в зачёт первой загрузки): окна по кнопке; лента и точка новых (`map/feedState`) — в
    // главном куске.
    name: 'карта: рейтинг и молва',
    door: /\/src\/ui\/map\/(Rating|Feed)\.tsx$/,
    owns: [/\/src\/ui\/map\/(Rating|Feed|feedWords)\.tsx?$/],
  },
];

function lazyDoorsPlugin(): Plugin {
  return {
    name: 'tribe-lazy-doors',
    apply: 'build',
    generateBundle(_, bundle) {
      const norm = (id: string): string => id.replace(/\\/g, '/');
      const entries = Object.values(bundle).filter((c) => c.type === 'chunk' && c.isEntry);
      // Статическое замыкание точки входа — ровно то, что качает первый заход.
      const first = new Set<string>();
      const walk = (id: string): void => {
        if (first.has(id)) return;
        first.add(id);
        for (const next of this.getModuleInfo(id)?.importedIds ?? []) walk(next);
      };
      for (const c of entries) if (c.type === 'chunk' && c.facadeModuleId) walk(c.facadeModuleId);
      const dynamic = [...this.getModuleIds()].filter((id) => this.getModuleInfo(id)?.dynamicImporters.length);
      const bad: string[] = [];
      for (const d of LAZY_DOORS) {
        if (!dynamic.some((id) => d.door.test(norm(id)))) bad.push(`${d.name}: дверь больше не грузится лениво`);
        const leaked = [...first].map(norm).filter((id) => d.owns.some((re) => re.test(id)));
        for (const id of leaked) bad.push(`${d.name}: ${id.slice(id.indexOf('/src/') + 1)} — в первой загрузке`);
      }
      if (bad.length > 0) this.error(`ленивые куски протекли в первую загрузку:\n  ${bad.join('\n  ')}`);
    },
  };
}

export default defineConfig({
  plugins: [react(), snapPlugin(), bootMinifyPlugin(), lazyDoorsPlugin()],
  base: '/',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    host: true,
    // Порт можно задать через PORT: так несколько dev-серверов не дерутся за 5173.
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
    allowedHosts: ['.trycloudflare.com'],
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Атлас мира — отдельным чанком нарочно. В первую загрузку он входит
        // всё равно (мир поднимается на старте), но в описи сборки его вес виден
        // отдельно от кода: сорок пять килобайт запечённой земли и двести
        // семьдесят игры — разные числа, и путать их не надо.
        manualChunks: {
          three: ['three'],
          react: ['react', 'react-dom'],
          atlas: ['./src/world/atlas/data.ts'],
          // Вода и свет ночи — один общий кусок города, роликов и промыслов (docs/polish.md, П-8 и П-9): свой кусок света
          // добавил бы имена в карту предзагрузки первой загрузки.
          moon: ['./src/render/water/glsl.ts', './src/render/water/moon.ts', './src/render/water/shape.ts', './src/render/glow/lamps.ts', './src/render/glow/glsl.ts', './src/render/glow/rig.ts'],
        },
      },
    },
  },
  // Тесты серверных функций живут рядом с ними, а не в src: они про подпись
  // и хранилище, а не про игру. Тесты приёмки отчётами (какие отчёты гнать) —
  // рядом с ней, в scripts/lib. Прогон один — приёмка должна быть одна.
  // Работников у тестов — доля ядер из бюджета (`budgetCores`: треть, 4 из 12; бюджет железа, CLAUDE.md): машина владельца — не сервер. Прогон
  // держит замок машины (`scripts/lib/testlock.ts`): занята чужой тяжёлой работой — тесты ждут.
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'netlify/**/*.test.ts', 'scripts/**/*.test.ts'],
    globalSetup: ['./scripts/lib/testlock.ts'],
    maxWorkers: budgetCores(),
    minWorkers: 1,
  },
});
