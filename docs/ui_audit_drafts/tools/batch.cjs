// Делит strings.json на пачки для переписывания текстов: файлы одной зоны вместе, ~200 строк в пачке.
const fs = require('fs');
const S = __dirname;
const rows = JSON.parse(fs.readFileSync(S + '/strings.json', 'utf8'));

const DEV_FILES = [
  'src/battle/bench.ts', 'src/render/showcase.ts', 'src/gestlog.ts', 'src/scenelog.ts',
  'src/cheats.ts', 'src/ui/CheatPanel.tsx',
];
// зона файла — для заголовков разделов ui_texts.md
function zone(f) {
  if (f === 'index.html' || f.startsWith('src/boot/')) return '01 Загрузка и старт';
  if (f.startsWith('src/prologue/')) return '02 Предыстория';
  if (/src\/ui\/(StartScreen|TutorialOverlay|start)|game\/data\/tutorial/.test(f)) return '03 Первые шаги';
  if (/src\/ui\/(TopBar|ResourceBar|AlertBar|BottomNav|SpeedButton|SiegeBanner|Sheet|GameCanvas)|src\/App\.tsx|src\/render\//.test(f)) return '04 Посёлок: верх, низ, сцена';
  if (/src\/ui\/panels\/BuildingPanel|src\/ui\/parts\/(upgrade|Cost|Steps|Factor|Provisions|TownHall|TownBuild|Gems|Walls|Watch|Statue|GarrisonEditor|Lineage|foodLeft|hunger|wait|plural|signed)|game\/data\/(buildings|yards|engines|jobs|gems)/.test(f)) return '05 Окно постройки и ратуша';
  if (/src\/ui\/parts\/(Smithy|Barracks|Recruit|Market|Temple|Tavern|Masters|TowerEngine|CampStrike|AgentPlaces|AgentCard|agentLines|traitLines|TroopCardView|FatePick|raidWords|restWords|campSide)|game\/data\/(troops|equipment|items|market|hire|upkeep|faiths|traits|names|agents)/.test(f)) return '06 Мастерские, войско, агенты, вера';
  if (/src\/ui\/panels\/(People|Pop|Morale|Season|Order|Army|Camp|Quests|Profile)|src\/ui\/parts\/(daily|Chronicle|Social|AvatarPicker|Settings|Sync|SceneDoctor|TouchDoctor)|game\/data\/(quests|daily|social|seasons|order|survey)/.test(f)) return '07 Племя, задания, профиль, настройки';
  if (/src\/ui\/realm\/|game\/data\/(realm|policy|events)|world\/(data\/letters|letters|data\/diplomacy|diplomacy)/.test(f)) return '08 Держава, почта, события, письма';
  if (/src\/ui\/map\/|src\/ui\/panels\/(World|Marches|Siege|Sortie)|world\/data\/figures/.test(f)) return '09 Карта мира и походы';
  if (/src\/ui\/panels\/Report|src\/ui\/battle\/|src\/battle\/|game\/battle\//.test(f)) return '10 Бой и донесения';
  if (/src\/ui\/(Winter|Pace|Offline|Legacy|Sync|SceneTrouble)Modal|src\/ui\/SceneTrouble/.test(f)) return '11 Окна поверх всего';
  if (f.startsWith('src/world/')) return '12 Мир: вести, сроки, исходы';
  if (f.startsWith('src/game/')) return '13 Племя: симуляция, летопись, сроки';
  return '14 Прочее';
}

const live = [], dev = [];
for (const r of rows) {
  r.zone = zone(r.file);
  if (r.dev || DEV_FILES.includes(r.file)) dev.push(r); else live.push(r);
}
// порядок: по зоне, затем по файлу, затем по строке
live.sort((a, b) => (a.zone + a.file).localeCompare(b.zone + b.file) || a.line - b.line);

const TARGET = 170;
const batches = [];
let cur = [], curZone = '';
const byFile = {};
for (const r of live) (byFile[r.file] = byFile[r.file] || []).push(r);
const filesOrdered = Object.keys(byFile).sort((a, b) => (byFile[a][0].zone + a).localeCompare(byFile[b][0].zone + b));
for (const f of filesOrdered) {
  const fr = byFile[f];
  const z = fr[0].zone;
  if (cur.length && (cur.length + fr.length > TARGET * 1.25 || z !== curZone) && cur.length >= TARGET * 0.5) {
    batches.push(cur); cur = [];
  }
  // крупный файл режем на куски
  if (fr.length > TARGET * 1.3) {
    if (cur.length) { batches.push(cur); cur = []; }
    for (let i = 0; i < fr.length; i += TARGET) batches.push(fr.slice(i, i + TARGET));
    curZone = z;
    continue;
  }
  cur.push(...fr); curZone = z;
}
if (cur.length) batches.push(cur);

fs.mkdirSync(S + '/texts', { recursive: true });
const index = [];
batches.forEach((b, i) => {
  const id = String(i + 1).padStart(2, '0');
  fs.writeFileSync(S + `/texts/in-${id}.json`, JSON.stringify(b, null, 1));
  const zones = [...new Set(b.map((r) => r.zone))];
  const files = [...new Set(b.map((r) => r.file))];
  index.push({ id, n: b.length, zones, files });
});
fs.writeFileSync(S + '/texts/in-dev.json', JSON.stringify(dev, null, 1));
fs.writeFileSync(S + '/texts/index.json', JSON.stringify(index, null, 1));
console.log('live', live.length, 'dev', dev.length, 'batches', batches.length);
for (const x of index) console.log(x.id, x.n, x.zones.join(' | '), '::', x.files.length, 'files', x.files.slice(0, 4).join(', '));
