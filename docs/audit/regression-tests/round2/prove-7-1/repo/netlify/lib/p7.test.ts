import { flagsBetween } from './watch';
import type { WatchCard } from './contract';
const NOW = 1_700_000_000_000;
const card = (o: Partial<WatchCard>) => ({ build: 'v1', city: '', clock: NOW, time: 1, level: 1, buildings: { town_hall: 1 }, pop: 10, stock: { wood: 100 }, prod: { wood: 1 }, cap: 1e9, troops: {}, queued: 0, away: 0, caravans: 0, wounded: 0, train: 0, deeds: 0, won: 0, lost: 0, lairs: 0, raids: 0, games: 0, haul: 0, haulCap: 0, cheated: false, lead: 0, seen: 0, ...o }) as WatchCard;
const k = (b: Partial<WatchCard>) => flagsBetween(card({}), NOW, card({ time: 3, stock: { wood: 900000 }, ...b }), NOW + 60000).map(f => f.kind);
console.log('quiet:', k({}), ' deeds+1:', k({ deeds: 1 }));
if (!k({ deeds: 1 }).includes('stock')) { console.log('FAIL: no stock flag when deeds bumped'); process.exit(1); }
