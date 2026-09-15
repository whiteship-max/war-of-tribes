/**
 * От каких файлов зависит запуск: замыкание по настоящим ссылкам между файлами.
 *
 * Здесь нет ни одного имени отчёта и ни одного имени файла игры. Всё, что знает модуль, —
 * как файлы ссылаются друг на друга, и три свойства инструментов, которыми их запускают.
 * Список «файл → отчёты», написанный руками, разошёлся бы с кодом при первом новом импорте,
 * и никто бы этого не заметил; замыкание расходится с кодом только вместе с кодом.
 *
 * РЁБРА. Из файла в файл ведут:
 *   импорт — статический, динамический `import('…')`, реэкспорт, `require`. Импорт одних
 *     типов (`import type`, `export type`, тип `import('…')`) при запуске стирается и ребром
 *     отчёта не считается — он ребро проверки типов, и держат его тесты (`affected.ts`).
 *     Лишний файл в замыкании стоит лишнего прогона, недостающий — пропуска;
 *   упоминание пути — строка, которая называет существующий файл или папку: `'../dist'`,
 *     `'/assets/music/'`, `'scripts/build-icons.ts'`, куски `path.join(ROOT, 'assets-src', 'icons')`,
 *     `src="/src/main.tsx"` в разметке, `url(…)` в стилях. Так в замыкание попадают данные и
 *     ресурсы, которые читаются не импортом, а по адресу. Упомянутая папка — это всё под ней,
 *     включая файлы, которых ещё нет.
 *
 * ИНСТРУМЕНТЫ. Три правила, и каждое — свойство инструмента, а не отчёта:
 *   vite — кто запускается через vite (`vite-node`, `createServer` из `vite`, `vite build`),
 *     тот читает `vite.config.ts` и каждый `tsconfig.json` дерева; кто поднимает им сервер или сборку, тот
 *     отдаёт странице `index.html` со всем, что из него достижимо, и всю папку `public`;
 *   сборка — кто упоминает папку вывода сборки (`dist`), тот зависит от команды `build`
 *     целиком и от всего, что она собирает;
 *   пакеты — кто запускается вообще, тот зависит от `package.json` и `package-lock.json`.
 *
 * СОМНЕНИЯ. Всё, что подсчёт увидел, но понять не смог, возвращается строкой, а не
 * проглатывается: импорт, который не разрешился, `import()` не строкой, `import.meta.glob`.
 * Что с сомнением делать, решает вызывающий — и решает он в пользу полного прогона.
 *
 * ЧЕГО ПОДСЧЁТ НЕ ВИДИТ — путь, собранный из переменных во время работы. Поэтому он не
 * последний рубеж: каждый прогон отчёта записывает, какие файлы репозитория он на самом деле
 * прочитал (`trace-fs.mjs`), и прочитанное вне замыкания — поломка подсчёта, а не шум.
 */
import ts from 'typescript';
import { TEXT, type Tree } from './tree';

/** Что отдаёт vite: имя конфига, публичная папка и папка вывода сборки. */
export interface ViteFacts {
  config: string;
  tsconfig: string;
  publicDir: string;
  outDir: string;
  html: string;
}

export interface FileScan {
  /** Файлы, которые этот импортирует. */
  imports: string[];
  /** Файлы, из которых этот берёт одни типы: при запуске ребра нет, для проверки типов — есть. */
  types: string[];
  /** Файлы, которые этот называет путём. */
  files: string[];
  /** Папки (с `/` на конце), упомянутые целиком. */
  dirs: string[];
  /** Внешние пакеты по имени. */
  packages: string[];
  /** Поднимает vite сервером или сборкой: `createServer`, `build`, `preview` из `vite`. */
  serves: boolean;
  /** Упомянута папка вывода сборки. */
  build: boolean;
  /** Что не понято. */
  doubts: string[];
}

export interface Closure {
  files: Set<string>;
  dirs: Set<string>;
  /** Читает папку вывода сборки: перед прогоном её надо собрать. */
  built: boolean;
  doubts: string[];
}

const CODE = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/;
const EXTS = ['', '.ts', '.tsx', '.mts', '.js', '.mjs', '.jsx', '.json', '/index.ts', '/index.tsx', '/index.js'];

/** Путь из `a/b/../c` в `a/c`; выход за корень — `null`. */
function norm(p: string): string | null {
  const out: string[] = [];
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join('/');
}

const dirOf = (file: string): string => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '');
const join = (a: string, b: string): string | null => norm(a ? `${a}/${b}` : b);

/** Индекс дерева: файлы и все папки, в которых что-нибудь лежит. */
export class Index {
  readonly files: Set<string>;
  readonly dirs = new Set<string>();
  constructor(readonly tree: Tree) {
    this.files = new Set(tree.files);
    for (const f of tree.files) {
      for (let d = dirOf(f); d !== ''; d = dirOf(d)) {
        if (this.dirs.has(d)) break;
        this.dirs.add(d);
      }
    }
  }
}

/** Встроенный модуль Node или пакет — то, что не лежит в дереве. */
const isBare = (spec: string): boolean => !/^(\.{1,2}\/|\/|@\/)/.test(spec) && spec !== '.' && spec !== '..';
const packageOf = (spec: string): string =>
  spec.startsWith('node:') ? spec : spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];

/**
 * Поднимает ли импорт из `vite` сервер или сборку. `defineConfig` и типы — нет: их берёт
 * сам `vite.config.ts`, и считать его из-за этого страницей значило бы приписать игру
 * целиком каждому отчёту. Импорт всего модуля разом — да: что из него возьмут, не видно.
 */
const VITE_RUNS = new Set(['createServer', 'build', 'preview', 'createBuilder']);
function servesVite(n: ts.ImportDeclaration): boolean {
  const clause = n.importClause;
  if (!clause || clause.isTypeOnly) return false;
  if (clause.name) return true;
  const b = clause.namedBindings;
  if (!b) return false;
  if (ts.isNamespaceImport(b)) return true;
  return b.elements.some((e) => !e.isTypeOnly && VITE_RUNS.has((e.propertyName ?? e.name).text));
}

/**
 * Импорт, от которого при запуске не остаётся ничего: `import type`, `export type` и импорт,
 * где тип — каждое имя. Отчёт гоняет код, а не проверку типов, и файл, из которого взяты
 * одни типы, на вывод отчёта не влияет: `world/types.ts` иначе приписал бы узловому отчёту
 * весь интерфейс. Обычный импорт, взятый только ради типа, остаётся ребром — сборщик его
 * тоже сотрёт, но понять это можно только разбором употребления, а лишний отчёт дешевле
 * догадки.
 */
function typeOnly(n: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isExportDeclaration(n)) {
    if (n.isTypeOnly) return true;
    const c = n.exportClause;
    return !!c && ts.isNamedExports(c) && c.elements.length > 0 && c.elements.every((e) => e.isTypeOnly);
  }
  const clause = n.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  const b = clause.namedBindings;
  return !clause.name && !!b && ts.isNamedImports(b) && b.elements.length > 0 && b.elements.every((e) => e.isTypeOnly);
}

export class Scanner {
  private cache = new Map<string, FileScan>();
  constructor(
    readonly index: Index,
    readonly vite: ViteFacts,
  ) {}

  /**
   * Всё, что vite читает, ещё не открыв ни одного модуля: конфиг и каждый `tsconfig.json`
   * дерева. Каждый, а не корневой: vite ищет их по всем папкам (tsconfck) и берёт ближайший
   * к модулю, так что `netlify/tsconfig.json` правит разбор `netlify/lib/*.ts`. Выяснилось
   * это записью прочитанного, а не догадкой.
   */
  viteReads(): string[] {
    const name = this.vite.tsconfig.split('/').pop()!;
    return [this.vite.config, ...[...this.index.files].filter((f) => f === name || f.endsWith(`/${name}`))];
  }

  /** Спецификатор импорта в файл дерева или `null`. */
  resolveImport(from: string, spec: string): string | null {
    const bare = spec.split('?')[0];
    const base = bare.startsWith('@/') ? join('src', bare.slice(2)) : bare.startsWith('/') ? norm(bare) : join(dirOf(from), bare);
    if (base === null) return null;
    for (const ext of EXTS) {
      if (this.index.files.has(base + ext)) return base + ext;
    }
    // Импорт `./x.js`, за которым лежит `x.ts`.
    const m = /^(.*)\.(m?)js$/.exec(base);
    if (m) for (const ext of m[2] ? ['.mts'] : ['.ts', '.tsx']) if (this.index.files.has(m[1] + ext)) return m[1] + ext;
    return null;
  }

  /**
   * Строка, которая может быть путём, — во что она упирается в дереве. Путь пробуется от
   * файла, от корня и от публичной папки: так страница просит `/assets/…`, так сборка
   * называет `scripts/…`. Не упёрлась ни во что — это не путь, и молчать тут правильно:
   * путь, собранный из переменных, ловит запись прочитанного, а не догадка.
   */
  mention(from: string, text: string, out: FileScan): void {
    const raw = text.replace(/\\/g, '/').split(/[?#]/)[0];
    // Путём считается только то, что похоже на путь: с косой чертой или с расширением.
    // Одно слово (`'src'`, `'dist'`, `'map'`) — не путь, иначе папкой стало бы любое имя.
    if (raw === '' || /^[a-z][\w+.-]*:/i.test(raw) || !(raw.includes('/') || /\.[a-z]\w{0,4}$/i.test(raw))) return;
    if (norm(raw) === '') return;
    const bases: Array<string | null> = [];
    if (raw.startsWith('./') || raw.startsWith('../')) bases.push(join(dirOf(from), raw));
    else if (raw.startsWith('@/')) bases.push(join('src', raw.slice(2)));
    else {
      bases.push(norm(raw));
      bases.push(join(this.vite.publicDir, raw));
    }
    for (const b of bases) {
      if (b === null || b === '') continue;
      if (b === this.vite.outDir || b.startsWith(`${this.vite.outDir}/`)) out.build = true;
      else if (this.index.files.has(b)) out.files.push(b);
      else if (this.index.dirs.has(b)) out.dirs.push(`${b}/`);
    }
  }

  /**
   * Пути в строке. Строка из одного слова — путь целиком (`'scripts/build-icons.ts'`,
   * `'index.html'`). В строке с пробелами — код щупа, разметка, фраза — путём считается только
   * то, что начинается как путь: `/src/…`, `./x`, `../dist`, `@/…`. Иначе фраза «см. CLAUDE.md»
   * в выводе отчёта сделала бы его зависимым от CLAUDE.md, а он его не читает.
   */
  mentionsIn(from: string, text: string, out: FileScan): void {
    if (!/\s/.test(text)) {
      if (text.length < 200) this.mention(from, text, out);
      return;
    }
    for (const m of text.matchAll(/(?<![\w@.-])(?:\.{1,2}\/|\/|@\/)[\w@.-]+(?:\/[\w@.-]+)*\/?/g)) this.mention(from, m[0], out);
  }

  scan(file: string): FileScan {
    let s = this.cache.get(file);
    if (!s) {
      s = { imports: [], types: [], files: [], dirs: [], packages: [], serves: false, build: false, doubts: [] };
      if (TEXT.test(file) && !file.endsWith('.json')) {
        const text = this.index.tree.read(file);
        if (CODE.test(file)) this.scanCode(file, text, s);
        else this.mentionsIn(file, text, s);
      }
      this.cache.set(file, s);
    }
    return s;
  }

  private scanCode(file: string, text: string, out: FileScan): void {
    const kind = /x$/.test(file) ? ts.ScriptKind.TSX : /\.m?js$|\.cjs$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, kind);
    // Строка спецификатора — уже ребро импорта; упоминанием папки `'@/battle'` она не считается.
    const specs = new Set<ts.Node>();
    // Конфиг vite разбирается только на импорты: пути в нём (`'./src'` псевдонима,
    // `'src/**'` тестов) читает сам vite, и что он из них берёт, уже сказано правилом vite.
    const config = file === this.vite.config;
    const importOf = (spec: string, where: ts.Node, types = false): void => {
      if (isBare(spec)) {
        if (!types) out.packages.push(packageOf(spec));
        return;
      }
      const hit = this.resolveImport(file, spec);
      if (hit) (types ? out.types : out.imports).push(hit);
      else out.doubts.push(`${file}:${line(where)} импорт «${spec}» не разрешился`);
    };
    const line = (n: ts.Node): number => src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1;
    const literal = (n: ts.Node | undefined): string | null =>
      n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null;

    const visit = (n: ts.Node): void => {
      if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier) {
        specs.add(n.moduleSpecifier);
        const spec = literal(n.moduleSpecifier);
        if (spec !== null) importOf(spec, n, typeOnly(n));
        if (spec === 'vite' && ts.isImportDeclaration(n) && servesVite(n)) out.serves = true;
      } else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) {
        specs.add(n.moduleReference.expression);
        const spec = literal(n.moduleReference.expression);
        if (spec !== null) importOf(spec, n);
      } else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument)) {
        // Тип `import('…').X` стирается при запуске целиком.
        specs.add(n.argument.literal);
        const spec = literal(n.argument.literal);
        if (spec !== null) importOf(spec, n, true);
      } else if (ts.isCallExpression(n)) {
        const dynamic = n.expression.kind === ts.SyntaxKind.ImportKeyword;
        const req = ts.isIdentifier(n.expression) && n.expression.text === 'require';
        if (dynamic || req) {
          if (n.arguments[0]) specs.add(n.arguments[0]);
          const spec = literal(n.arguments[0]);
          if (spec !== null) importOf(spec, n);
          else out.doubts.push(`${file}:${line(n)} ${dynamic ? 'import()' : 'require()'} не строкой`);
        }
        // path.join(ROOT, 'assets-src', 'icons') и подобное: подряд идущие куски — путь.
        const callee = ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : ts.isIdentifier(n.expression) ? n.expression.text : '';
        if (!config && (callee === 'join' || callee === 'resolve')) {
          let run: string[] = [];
          // Кусок после переменной — тоже путь от чего-то: `path.join(ROOT, 'dist')`.
          const flush = (): void => {
            if (run.length > 0) this.mention(file, `${run.join('/')}/`, out);
            run = [];
          };
          for (const a of n.arguments) {
            const t = literal(a);
            if (t !== null) run.push(t);
            else flush();
          }
          flush();
        }
      } else if (ts.isPropertyAccessExpression(n) && n.name.text === 'glob' && /^import\.meta$/.test(n.expression.getText(src))) {
        out.doubts.push(`${file}:${line(n)} import.meta.glob`);
      }
      if (config || specs.has(n)) {
        // не упоминание: см. выше
      } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) this.mentionsIn(file, n.text, out);
      else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) this.mentionsIn(file, n.text, out);
      ts.forEachChild(n, visit);
    };
    visit(src);
  }

  /**
   * Замыкание от корней. `vite` в пакетах тянет страницу и публичную папку; упоминание
   * папки вывода сборки тянет корни сборки, которые передаёт вызывающий (`build`).
   *
   * `importsOnly` — только по импортам, без упоминаний и без инструментов. Так считается
   * замыкание самого подсчёта: пути, которые он называет (`index.html`, `dist`, шаблоны
   * тестов), — предмет его разбора, а не его код, и правка игры не делает его «изменённым».
   *
   * `types` — с рёбрами одних типов. Так считаются тесты: их владение включает проверку типов,
   * и файл, из которого только берут типы, принадлежит им, а не «никому».
   */
  closure(roots: string[], build: string[], importsOnly = false, types = false): Closure {
    const files = new Set<string>();
    const dirs = new Set<string>();
    const doubts: string[] = [];
    const queue: string[] = [];
    const add = (f: string): void => {
      if (files.has(f)) return;
      if (!this.index.files.has(f)) {
        doubts.push(`корень «${f}» не найден в дереве`);
        return;
      }
      files.add(f);
      queue.push(f);
    };
    let served = false;
    const serve = (): void => {
      if (served) return;
      served = true;
      dirs.add(`${this.vite.publicDir}/`);
      add(this.vite.html);
      this.viteReads().forEach(add);
    };
    let built = false;
    roots.forEach(add);
    // Упомянутая папка — всё, что в ней лежит, и это тоже надо разобрать: круги идут, пока
    // новая папка не перестанет приносить новые файлы.
    for (let grew = true; grew; ) {
      while (queue.length > 0) {
        const f = queue.pop()!;
        let s: FileScan;
        try {
          s = this.scan(f);
        } catch (e) {
          doubts.push(`${f} не разобран: ${(e as Error).message}`);
          continue;
        }
        s.imports.forEach(add);
        if (types) s.types.forEach(add);
        doubts.push(...s.doubts);
        if (importsOnly) continue;
        s.files.forEach(add);
        s.dirs.forEach((d) => dirs.add(d));
        if (s.serves) serve();
        if (s.build && !built) {
          built = true;
          serve();
          build.forEach(add);
        }
      }
      grew = false;
      for (const f of this.index.tree.files) {
        if (!files.has(f) && [...dirs].some((d) => f.startsWith(d))) {
          add(f);
          grew = true;
        }
      }
    }
    return { files, dirs, built, doubts: [...new Set(doubts)] };
  }
}

/** Лежит ли путь в замыкании: сам файл или под упомянутой папкой (так ловится и удалённый). */
export const covers = (c: Closure, file: string): boolean => c.files.has(file) || [...c.dirs].some((d) => file.startsWith(d));
