// Главный процесс отчёта с веером для теста жетона (`fan.test.ts`): печатает, когда запущен, когда начал считать сам и
// что вернул веер. Модуль веера берётся динамическим импортом нарочно: «запущен» печатается раньше, чем модуль веера
// станет ждать своего жетона, — иначе тесту не отличить «ждёт жетона» от «медленно поднимается». Бюджет ядер вееру — из
// `FAN_FIXTURE_BUDGET` (ПН-Э2а): тест держит обе ветки на любой машине; переменную читает этот файл, а не библиотека.
console.log('запущен');
const { fan } = await import('./fan');
const { shape } = await import('./fan-fixture');
const budget = Number(process.env.FAN_FIXTURE_BUDGET);
if (!(budget >= 1)) throw new Error('FAN_FIXTURE_BUDGET: бюджет ядер вееру не подставлен');
console.log('считаю');
const got = await fan(shape, new URL('./fan-fixture.ts', import.meta.url).href, [1, 2], budget);
console.log(`веер: ${got.map((x) => x.n).join(',')}`);
