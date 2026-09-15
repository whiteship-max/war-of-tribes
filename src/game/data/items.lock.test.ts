// Замок на владение предметами — по образцу замка алмазов (`sim/gems.test.ts`).
//
// Договор: ячейка хранит только имя, действие предмета берётся только из нашей
// таблицы (`ITEMS`), а список того, чем игрок владеет, отдаёт ровно одна дверь —
// `net/owned.ts`, — и записать его нельзя нигде. Если действие приедет вместе с
// предметом снаружи, подделать предмет будет значить подделать силу.
//
// Замок стоит не от злоумышленника — исходники у того и так в руках, — а от
// следующей правки, написанной не задумываясь: «положу-ка владение в сохранение»,
// «соберу список из ответа кошелька». Закрыты естественные написания, и сам список
// образцов проверяется тестом: правило, которое ничего не ловит, хуже отсутствующего.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ITEMS, itemIn, slotName, type ItemId } from './items';
import { ownedItems } from '@/net/owned';
import { createInitialState } from '../state';
import type { AgentProgress } from '../types';

const ROOT = join(__dirname, '..', '..');

const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const rel = (p: string): string => relative(ROOT, p).split(sep).join('/');

/** Единственный файл, который отдаёт владение. */
const OWNER = 'net/owned.ts';
/** Единственный файл, который делает из строки имя предмета: разбор ячейки из сохранения. */
const NAMER = 'game/data/items.ts';

const ASSIGN = String.raw`(?:\*\*|\?\?|\|\||&&|<<|>>>?|[+\-*/%&|^])?=(?!=|>)`;

/** Всё, чем список владения можно завести или дописать мимо двери. */
const OWN_WRITES: [RegExp, string][] = [
  // Второй источник владения: своя функция или поле с тем же именем.
  [/\bownedItems\s*(?:=|:|\?:)|function\s+ownedItems\b/, 'заводит ownedItems'],
  [/\b(?:owned|ownedItems\(\))\s*(?:\.\s*(?:push|unshift|splice|add|set|fill|copyWithin)\s*\()/, 'дописывает владение'],
  // Присваивание владению чего угодно, кроме ответа двери.
  [new RegExp(String.raw`\bowned(?:\s*:[^=;]*)?\s*${ASSIGN}(?!\s*ownedItems\(\))`), 'кладёт во владение не ответ двери'],
  [new RegExp(String.raw`\bowned\s*\[[^\]]*\]\s*${ASSIGN}`), 'правит владение по индексу'],
  // Поле владения в объекте: в состоянии партии, в слепке, в ответе сервера. Параметр
  // `owned: readonly ItemId[]` законен: такой список можно только получить у двери —
  // имя предмета из строки не делается нигде, кроме разбора ячейки.
  [/(^|[^\w$.])(?:ownedItems|inventory|ownership)\s*\??:(?!:)/, 'заводит поле владения'],
  [/(^|[^\w$.])owned\s*\??:(?!:)(?!\s*readonly\s+ItemId\[\])/, 'заводит поле владения'],
  // Хранилище владения на устройстве.
  [/(?:local|session)Storage\.setItem\([^)]*(?:owned|item|inventory)/i, 'кладёт владение на устройство'],
  [/['"`]tribe\.(?:owned|items?|inventory)/, 'заводит ключ владения'],
  // Имя предмета из строки: без этого список владения не собрать.
  [/\bas\s+(?:readonly\s+)?ItemId\b|<ItemId>/, 'делает имя предмета из строки'],
];

function offences(): string[] {
  const out: string[] = [];
  for (const f of files(ROOT)) {
    const r = rel(f);
    const lines = strip(readFileSync(f, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      for (const [re, why] of OWN_WRITES) {
        if (!re.test(line)) continue;
        // Дверь отдаёт владение; разбор ячейки делает имя из строки — и больше ничего.
        if (r === OWNER && why !== 'делает имя предмета из строки') continue;
        if (r === NAMER && why === 'делает имя предмета из строки') continue;
        out.push(`${r}:${i + 1} ${why}: ${line.trim()}`);
      }
    });
  }
  return out;
}

describe('владение предметами: одна дверь, и записать его нельзя', () => {
  it('образцы замка ловят то, ради чего заведены, и не ловят честное чтение', () => {
    const caught = (line: string): boolean => OWN_WRITES.some(([re]) => re.test(strip(line)));
    const bad = [
      "const owned = ['меч'] as ItemId[];",
      'owned.push(item);',
      'ownedItems().push(sword);',
      "let owned: readonly string[] = JSON.parse(localStorage.getItem('x') ?? '[]');",
      'owned = fromWallet(reply);',
      'owned[0] = sword;',
      'set({ s: { ...s, owned: [sword] } });',
      'export const ownedItems = () => serverList;',
      "localStorage.setItem('tribe.owned.v1', JSON.stringify(list));",
      "sessionStorage.setItem(KEY_ITEMS, raw);",
      'const sword = raw as ItemId;',
      "interface Save { inventory?: string[] }",
    ];
    for (const line of bad) expect(caught(line), line).toBe(true);
    const honest = [
      'const owned = ownedItems();',
      'const st = itemIn(progress.slots[i] ?? null, owned);',
      'if (!owned.includes(item)) return null;',
      'act((g) => regear(g, id, i, null, where, owned));',
    ];
    for (const line of honest) expect(caught(line), line).toBe(false);
  });

  it('во всём src владение пишет ровно одна дверь — net/owned.ts', () => {
    expect(offences()).toEqual([]);
  });

  it('дверь одна: ownedItems определена только в net/owned.ts и больше ничего не экспортирует', () => {
    const defs = files(ROOT).filter((f) => /\bfunction\s+ownedItems\b|\bownedItems\s*=/.test(strip(readFileSync(f, 'utf8'))));
    expect(defs.map(rel)).toEqual([OWNER]);
    const src = strip(readFileSync(join(ROOT, OWNER), 'utf8'));
    expect(src.match(/\bexport\s+(?:function|const|let|var|class)\s+(\w+)/g)).toEqual(['export function ownedItems']);
  });

  it('сегодня владеть нечем и надеть нечего: оба списка пусты, и дописать их нельзя', () => {
    expect(Object.keys(ITEMS)).toEqual([]);
    expect(ownedItems()).toEqual([]);
    expect(Object.isFrozen(ownedItems())).toBe(true);
    expect(Object.isFrozen(ITEMS)).toBe(true);
    expect(() => (ownedItems() as ItemId[]).push('меч' as ItemId)).toThrow();
  });
});

describe('ячейка хранит только имя, действие — только из таблицы', () => {
  it('имя, которого нет в таблице, — неизвестный предмет, даже если «есть во владении»', () => {
    const sword = slotName('меч')!;
    expect(itemIn(sword, [sword])).toEqual({ kind: 'unknown', id: sword });
    // Имена со свойствами объекта не находят «предмет» в прототипе таблицы.
    for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(itemIn(slotName(name), [slotName(name)!]).kind).toBe('unknown');
    }
    expect(itemIn(null, []).kind).toBe('empty');
  });

  it('в ячейку не положить ничего, кроме имени', () => {
    const p: AgentProgress = createInitialState().agents.general;
    // @ts-expect-error — предмет с числом внутри в ячейку не ложится: ячейка знает только имя.
    p.slots[0] = { id: 'меч', onslaught: 12 };
    // @ts-expect-error — и простая строка тоже: имя предмета делает только разбор ячейки.
    p.slots[1] = 'меч';
    expect(() => {
      // @ts-expect-error — список владения только на чтение.
      ownedItems().push('меч' as ItemId);
    }).toThrow();
    expect(slotName({ id: 'меч', onslaught: 12 })).toBeNull();
    expect(slotName(12)).toBeNull();
  });
});
