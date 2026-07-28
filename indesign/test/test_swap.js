/* InDesign DOM を最低限モックして 02_swap_name_lines.jsx のロジックを検証する */
const fs = require('fs');
const path = '/home/user/task/indesign/02_swap_name_lines.jsx';

/* ---------- モック ---------- */
class Style {
  constructor(name, id) { this.name = name; this.id = id; this.parent = null; }
}
class CharRange {
  constructor(para, a, b) { this.para = para; this.a = a; this.b = b; }
  set contents(v) {
    const t = this.para._text;
    this.para._text = t.slice(0, this.a) + v + t.slice(this.b + 1);
  }
  get contents() { return this.para._text.slice(this.a, this.b + 1); }
}
class Paragraph {
  constructor(text, style, frame) {
    this._text = text; this.appliedParagraphStyle = style; this._frame = frame;
  }
  get contents() { return this._text; }
  get parentTextFrames() { return [this._frame]; }
  get texts() {
    const self = this;
    return [{ set contents(v) { self._text = v; }, get contents() { return self._text; } }];
  }
  get insertionPoints() {
    const self = this;
    return [{ set contents(v) { self._text = v + self._text; } }];
  }
  get characters() {
    const self = this;
    const n = self._text.length;
    const o = { length: n, itemByRange: (a, b) => new CharRange(self, a, b) };
    for (let i = 0; i < n; i++) {
      Object.defineProperty(o, i, { get: () => ({ contents: self._text[i] }), configurable: true });
    }
    return o;
  }
}
class Collection extends Array {
  everyItem() {
    if (this.length === 1) {
      return { contents: this[0].contents, appliedParagraphStyle: this[0].appliedParagraphStyle };
    }
    return {
      contents: this.map(p => p.contents),
      appliedParagraphStyle: this.map(p => p.appliedParagraphStyle),
    };
  }
}
class Story {
  constructor(id, paras) { this.id = id; this._paras = paras; }
  get paragraphs() { const c = new Collection(); this._paras.forEach(p => c.push(p)); return c; }
}
class TextFrame { constructor(pageName) { this.parentPage = { name: pageName }; } }

/* ---------- グローバル ---------- */
const alerts = [];
global.alert = m => alerts.push(m);
global.File = function (p) { this.p = p; this.open = () => {}; this.write = () => {}; this.close = () => {}; };
global.Folder = { desktop: '/tmp' };
global.ScriptLanguage = { JAVASCRIPT: 1 };
global.UndoModes = { ENTIRE_SCRIPT: 1 };
global.ParagraphStyleGroup = class ParagraphStyleGroup {};
global.BATCH_MODE = true;   // 自動実行を止める

/* ---------- ドキュメント生成 ---------- */
const stBig = new Style('学生氏名', 1);
const stSmall = new Style('保証人氏名', 2);
const stAddr = new Style('住所', 3);

function buildDoc({ pages = 3, separateFrames = false } = {}) {
  const stories = [];
  for (let i = 1; i <= pages; i++) {
    if (!separateFrames) {
      const f = new TextFrame(String(i));
      stories.push(new Story(100 + i, [
        new Paragraph('沖縄県那覇市壺川 1-22-2-2F\r', stAddr, f),
        new Paragraph(`末吉　遥貴${i}　様\r`, stBig, f),
        new Paragraph(`（末吉　康志${i}　様　保証人様）`, stSmall, f),
      ]));
    } else {
      const f1 = new TextFrame(String(i));
      const f2 = new TextFrame(String(i));
      stories.push(new Story(200 + i, [new Paragraph(`末吉　遥貴${i}　様`, stBig, f1)]));
      stories.push(new Story(300 + i, [new Paragraph(`（末吉　康志${i}　様　保証人様）`, stSmall, f2)]));
    }
  }
  return {
    name: 'test.indd',
    pages: { length: pages },
    stories,
    allParagraphStyles: [stBig, stSmall, stAddr],
  };
}

/* ---------- 実行 ---------- */
let src = fs.readFileSync(path, 'utf8').split('\n').filter(l => !/^\s*#/.test(l)).join('\n');

function runCase(label, docOpts, cfgPatch) {
  const sandbox = { app: { activeDocument: null, documents: { length: 1 } } };
  const doc = buildDoc(docOpts);
  sandbox.app.activeDocument = doc;
  global.app = sandbox.app;
  const fn = new Function(src + '\n; return { run: run, CONFIG: CONFIG, stripParens: stripParens };');
  const mod = fn();
  Object.assign(mod.CONFIG, cfgPatch);
  const res = mod.run();
  console.log('=== ' + label + ' ===');
  console.log('  ペア数:', res ? res.pairs : 0, '/ 実行:', res ? res.done : 0,
              '/ 警告:', res ? res.warns : '-', '/ エラー:', res ? res.errors : '-');
  doc.stories.slice(0, 2).forEach(s => {
    s._paras.forEach(p => console.log('    [' + p.appliedParagraphStyle.name + '] ' +
                                      JSON.stringify(p.contents)));
  });
  console.log('');
  return { doc, res };
}

const base = { STYLE_TOP: '学生氏名', STYLE_BOTTOM: '保証人氏名', DRY_RUN: false };

runCase('同一フレーム / カッコ=bottom', {}, Object.assign({}, base, { PAREN_POSITION: 'bottom' }));
runCase('同一フレーム / カッコ=keep',   {}, Object.assign({}, base, { PAREN_POSITION: 'keep' }));
runCase('同一フレーム / カッコ=none',   {}, Object.assign({}, base, { PAREN_POSITION: 'none' }));
runCase('別フレーム / カッコ=bottom', { separateFrames: true },
        Object.assign({}, base, { PAREN_POSITION: 'bottom' }));
runCase('自動判定モード', {}, { STYLE_TOP: '', STYLE_BOTTOM: '', DRY_RUN: false, PAREN_POSITION: 'bottom' });
runCase('DRY RUN（未変更のはず）', {}, Object.assign({}, base, { DRY_RUN: true, PAREN_POSITION: 'bottom' }));

/* 3000 ページの規模で件数が合うか */
const big = runCase('3000ページ', { pages: 3000 }, Object.assign({}, base, { PAREN_POSITION: 'bottom' }));
console.log('3000ページ判定:', big.res.pairs === 3000 && big.res.done === 3000 ? 'OK' : 'NG');
console.log('alerts:', alerts.length);
