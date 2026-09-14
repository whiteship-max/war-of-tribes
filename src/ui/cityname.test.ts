// Имя города: одна дверь очистки и ни одной сырой строки.
//
// Имя пишет игрок, а видят его все: карта, панели, отчёты, письма и соседи через реестр.
// Отсюда три свойства, и все три держатся здесь:
//   * очистка — свойство на враждебном вводе, а не список случаев: что бы ни пришло,
//     вышло либо ничего, либо годное имя, и повторная очистка его не меняет;
//   * имя нигде не берётся сырым: всякое чтение поля `city` в исходниках идёт через
//     `cityName`/`cityOr` — тест по исходникам;
//   * имя не ломает подписей: каждое место, где стоит имя поселения, помечено одной
//     строкой с многоточием, и сама эта строка так и описана в стилях.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { seeded } from '@/game/sim/random';
import { CITY_MAX, DEFAULT_CITY, cityName, cityOr, plainName, readClaim, readNotices } from '../../netlify/lib/contract';
import { profileCity } from '@/profile/identity';
import { createInitialState } from '@/game/state';
import { setCity } from '@/profile/stats';

const ROOT = process.cwd();

/** Буквы, из которых собирается враждебное имя: разметка, невидимки, управляющие, суррогаты. */
const ALPHABET = [
  'а', 'Ш', 'ё', 'Z', ' ', ' ', '\t', '\n', '\r', '\u00a0', '\u2003',
  '<', '>', '`', '*', '_', '[', ']', '\\',
  '\u0000', '\u0007', '\u001b', '\u007f',
  '\u200b', '\u200c', '\u200d', '\u200e', '\u200f', '\u202e', '\u2066', '\ufeff', '\u00ad',
  '\u2028', '\u2029',
  '🏰', '🔥', '𝔄',
  '.', '-', '«', '»',
];

function hostileNames(count: number): string[] {
  const rnd = seeded(20260914);
  const out: string[] = ['', ' ', '\u200b\u200e\u2066', '\t\n', '<>`*_[]\\', 'Ш'.repeat(80), '🏰'.repeat(60)];
  for (let i = 0; i < count; i++) {
    const len = Math.floor(rnd() * 90);
    let s = '';
    for (let k = 0; k < len; k++) s += ALPHABET[Math.floor(rnd() * ALPHABET.length)];
    out.push(s);
  }
  return out;
}

const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const MARKUP = /[<>`*_[\]\\]/;

describe('очистка имени города', () => {
  const names = hostileNames(3000);

  it('что бы ни пришло — ничего или годное имя: без разметки, невидимок, пустоты и сверх сорока знаков', () => {
    let kept = 0;
    let dropped = 0;
    for (const raw of names) {
      const c = cityName(raw);
      if (c === null) {
        dropped++;
        // Отказ — только когда видимого в имени не было ничего.
        expect(raw.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>`*_[\]\\\s\p{Zs}]/gu, ''), JSON.stringify(raw)).toBe('');
        continue;
      }
      kept++;
      // Потолок в длине строки — так его меряет и сервер (`readNotices`, `str`).
      expect(c.length).toBeLessThanOrEqual(CITY_MAX);
      expect(c).not.toMatch(INVISIBLE);
      expect(c).not.toMatch(MARKUP);
      expect(c).toBe(c.trim());
      expect(c).not.toMatch(/\s{2}/);
      // Половинки суррогатной пары не остаются: имя режется по знакам.
      expect(c).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
      // Идемпотентно: очищенное второй раз не меняется.
      expect(cityName(c)).toBe(c);
      // И годится туда, где правило имени и было взято: в список уведомлений.
      expect(readNotices([{ key: 'raid:x', kind: 'raid', fireAt: 1, until: 2, p: { from: c, fate: 'plunder', about: 1 } }], 0)).not.toBeNull();
    }
    // Проверка не пустая: генератор даёт и то, и другое.
    expect(kept).toBeGreaterThan(100);
    expect(dropped).toBeGreaterThan(0);
  });

  it('пустое, из пробелов и из одних невидимых знаков — не имя: город безымянный', () => {
    for (const raw of ['', '   ', '\u200b\u200d\ufeff', '\n\t\r', '<>**', undefined, null, 42, {}]) {
      expect(cityName(raw), JSON.stringify(raw)).toBeNull();
      expect(cityOr(raw)).toBe(DEFAULT_CITY);
      expect(profileCity({ city: typeof raw === 'string' ? raw : null })).toBe(DEFAULT_CITY);
    }
  });

  it('правило одно на игрока, сохранение, реестр и уведомления', () => {
    for (const raw of hostileNames(300)) {
      const s = createInitialState();
      setCity(s, raw);
      // Сохранение держит очищенное, показ — очищенное с умолчанием.
      expect(s.profile.city).toBe(cityName(raw));
      expect(profileCity(s.profile)).toBe(cityOr(raw));
      // Сервер чистит присланное тем же правилом.
      expect(readClaim({ name: 'Вождь', city: raw, power: 1, pop: 1 })!.city).toBe(cityName(raw) ?? '');
      // Имя двора в уведомлениях — та же очистка.
      expect(plainName(raw)).toBe(cityName(raw) ?? '—');
    }
  });
});

/** Исходники без тестов и без комментариев. */
function sources(dir: string, out: { file: string; text: string }[] = []): { file: string; text: string }[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules') continue;
      sources(p, out);
    } else if (/\.(ts|tsx|mts)$/.test(name) && !/\.test\./.test(name)) {
      const text = readFileSync(p, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
      out.push({ file: p.slice(ROOT.length + 1), text });
    }
  }
  return out;
}

describe('имя нигде не берётся сырым', () => {
  it('всякое чтение поля `city` идёт через `cityName` или `cityOr`', () => {
    const files = [...sources(join(ROOT, 'src')), ...sources(join(ROOT, 'netlify'))];
    const reads: string[] = [];
    const raw: string[] = [];
    for (const { file, text } of files) {
      text.split('\n').forEach((line, i) => {
        if (!/\.city\b/.test(line)) return;
        reads.push(`${file}:${i + 1}`);
        // Каждое `.city` в строке обязано стоять аргументом очистки — или быть записью
        // уже очищенного (`.city = cityName(…)`).
        const bare = line
          .replace(/city(Name|Or)\([^()]*\.city\b[^()]*\)/g, '')
          .replace(/\.city\s*=\s*city(Name|Or)\(/g, '');
        if (/\.city\b/.test(bare)) raw.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(raw, 'сырое чтение имени города').toEqual([]);
    // Проверка не пустая: имя читают — и в игре, и на сервере.
    expect(reads.some((r) => r.startsWith('src'))).toBe(true);
    expect(reads.some((r) => r.startsWith('netlify'))).toBe(true);
  });

  it('дом называется именем города, а не «Нашей деревней», ни в одном месте мира', () => {
    const lw = readFileSync(join(ROOT, 'src/world/local/LocalWorld.ts'), 'utf8');
    expect(lw).not.toContain("'Наша деревня'");
    expect((lw.match(/this\.homeName\(\)/g) ?? []).length).toBeGreaterThan(5);
  });
});

describe('имя не ломает подписей', () => {
  const css = readFileSync(join(ROOT, 'src/ui/styles.css'), 'utf8');

  it('одна строка с многоточием так и описана в стилях', () => {
    const rule = css.match(/\n\.one-line\s*\{([^}]*)\}/);
    expect(rule, '.one-line в стилях').toBeTruthy();
    const body = rule![1];
    expect(body).toMatch(/overflow:\s*hidden/);
    expect(body).toMatch(/text-overflow:\s*ellipsis/);
    expect(body).toMatch(/white-space:\s*nowrap/);
    expect(body).toMatch(/min-width:\s*0/);
  });

  it('каждое место, где в разметке стоит имя поселения или своего города, — одной строкой', () => {
    const NAME = /\{(card\.name|camp\.targetName|report\.target\.name|profileCity\([^)]*\))\}/;
    const files = sources(join(ROOT, 'src/ui')).filter((f) => f.file.endsWith('.tsx'));
    const places: string[] = [];
    const toasts: string[] = [];
    const loose: string[] = [];
    for (const { file, text } of files) {
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        if (!NAME.test(line)) return;
        // Подсказка в пустом поле ввода обрезается самим полем.
        if (/placeholder=/.test(line)) return;
        // Всплывающая строка переносится (`.toast`, ниже), а не режется.
        if (/showToast\(/.test(line)) {
          toasts.push(`${file}:${i + 1}`);
          return;
        }
        // Имя стоит внутри элемента, открытого на этой строке или строкой выше (кнопка).
        places.push(`${file}:${i + 1}`);
        if (!/one-line/.test(`${lines[i - 1] ?? ''}\n${line}`)) loose.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(loose).toEqual([]);
    expect(places.length, 'места нашлись').toBeGreaterThanOrEqual(5);
    expect(toasts.length, 'проверка переноса не пустая').toBeGreaterThan(0);
    const toast = css.match(/\n\.toast\s*\{([^}]*)\}/);
    expect(toast?.[1], 'всплывающая строка переносит длинное слово').toMatch(/overflow-wrap:\s*anywhere/);
  });
});

describe('часы голода в слова превращает один модуль', () => {
  it('в интерфейсе `starvesAt` читается словами только через `hungerLeft`', () => {
    const files = sources(join(ROOT, 'src/ui')).filter((f) => !f.file.endsWith('hunger.ts'));
    const bad: string[] = [];
    let uses = 0;
    for (const { file, text } of files) {
      text.split('\n').forEach((line, i) => {
        if (!/starvesAt/.test(line)) return;
        if (/hungerLeft\(/.test(line)) uses++;
        if (/formatLeft|secondsLeft|\/ ?1000/.test(line)) bad.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(bad).toEqual([]);
    // Окно обороняющегося, окно лагеря, плашка в деревне и карточка города.
    expect(uses).toBeGreaterThanOrEqual(4);
  });
});
