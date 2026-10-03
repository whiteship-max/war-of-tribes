// Выемка всех строк на кириллице из исходников игры (без комментариев) — для описи текстов.
// node extract.cjs <root> <out.json>
const ts = require(process.env.TS_PATH || 'typescript');
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
const out = process.argv[3];
const CYR = /[А-Яа-яЁё]/;

function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const files = walk(path.join(root, 'src'), []);
const rows = [];
const clip = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);
const squash = (s) => s.replace(/\s+/g, ' ').trim();

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  if (!CYR.test(src)) continue;
  const rel = path.relative(root, f).split(path.sep).join('/');
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const line = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  function ctx(n) {
    // ближайшие осмысленные предки: атрибут JSX, имя свойства, вызов, функция
    let attr = '', prop = '', call = '', fn = '', dev = '';
    for (let p = n.parent; p; p = p.parent) {
      if (!attr && ts.isJsxAttribute(p)) attr = p.name.getText(sf);
      if (!prop && ts.isPropertyAssignment(p)) prop = p.name.getText(sf);
      if (!call && ts.isCallExpression(p)) call = clip(p.expression.getText(sf), 40);
      if (ts.isThrowStatement(p) || (ts.isNewExpression(p) && /Error$/.test(p.expression.getText(sf)))) dev = 'throw';
      if (ts.isCallExpression(p) && /^console\./.test(p.expression.getText(sf))) dev = 'console';
      if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) dev = 'import';
      if (!fn && (ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) && p.name) fn = p.name.getText(sf);
      if (!fn && ts.isVariableDeclaration(p) && p.initializer && (ts.isArrowFunction(p.initializer) || ts.isFunctionExpression(p.initializer))) fn = p.name.getText(sf);
    }
    return { attr, prop, call, fn, dev };
  }

  function tmplText(t) {
    let s = t.head.text;
    for (const sp of t.templateSpans) s += '${' + clip(squash(sp.expression.getText(sf)), 50) + '}' + sp.literal.text;
    return s;
  }

  const seenJsx = new Set();
  function visit(n) {
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && CYR.test(n.text)) {
      if (!(n.parent && ts.isPropertyAssignment(n.parent) && n.parent.name === n)) {
        rows.push({ file: rel, line: line(n), kind: 'str', text: n.text, ...ctx(n) });
      }
    } else if (ts.isTemplateExpression(n)) {
      const s = tmplText(n);
      if (CYR.test(s)) rows.push({ file: rel, line: line(n), kind: 'tmpl', text: s, ...ctx(n) });
      // вложенные строки внутри ${…} обойдём ниже как обычно
    } else if ((ts.isJsxElement(n) || ts.isJsxFragment(n)) && !seenJsx.has(n)) {
      const kids = n.children;
      if (kids.some((k) => ts.isJsxText(k) && CYR.test(k.text))) {
        let s = '';
        for (const k of kids) {
          if (ts.isJsxText(k)) s += k.text;
          else if (ts.isJsxExpression(k)) s += k.expression ? '{' + clip(squash(k.expression.getText(sf)), 50) + '}' : '';
          else if (ts.isJsxElement(k)) s += '<' + k.openingElement.tagName.getText(sf) + '>' + clip(squash(k.children.map((c) => c.getText(sf)).join('')), 60) + '</>';
          else if (ts.isJsxSelfClosingElement(k)) s += '<' + k.tagName.getText(sf) + '/>';
        }
        const tag = ts.isJsxElement(n) ? n.openingElement.tagName.getText(sf) : '';
        let cls = '';
        if (ts.isJsxElement(n)) {
          const a = n.openingElement.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(sf) === 'className');
          if (a && a.initializer) cls = clip(a.initializer.getText(sf), 40);
        }
        rows.push({ file: rel, line: line(n), kind: 'jsx', text: squash(s), tag, cls, ...ctx(n) });
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(sf);
}

// index.html: экран загрузки
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').split('\n');
html.forEach((l, i) => {
  if (CYR.test(l) && !/^\s*(<!--|\/\/|\*)/.test(l)) rows.push({ file: 'index.html', line: i + 1, kind: 'html', text: squash(l), attr: '', prop: '', call: '', fn: '', dev: '' });
});

fs.writeFileSync(out, JSON.stringify(rows, null, 0));
const by = {};
for (const r of rows) by[r.file] = (by[r.file] || 0) + 1;
const dev = rows.filter((r) => r.dev).length;
console.log('rows', rows.length, 'dev(throw/console/import)', dev, 'files', Object.keys(by).length);
for (const [k, v] of Object.entries(by).sort((a, b) => b[1] - a[1])) console.log(v, k);
