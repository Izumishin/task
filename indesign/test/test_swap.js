/* InDesign DOM を最低限モックして 02_swap_name_lines.jsx のロジックを検証する
 * 実行: node indesign/test/test_swap.js
 */
const fs = require('fs');
const path = require('path').join(__dirname, '..', '02_swap_name_lines.jsx');

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
  set contents(v) { this._text = v; }
  get parentTextFrames() { return this._frame ? [this._frame] : []; }
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
function coll(arr) { const c = new Collection(); arr.forEach(x => c.push(x)); return c; }

class Cell {
  constructor(paras, table) { this._paras = paras; this.parent = table; }
  get paragraphs() { return coll(this._paras); }
  get tables() { return coll([]); }
}
class Table {
  constructor(id, cellParas, frame) {
    this.id = id;
    this._cells = cellParas.map(ps => new Cell(ps, this));
    this._frame = frame;
  }
  get cells() { return coll(this._cells); }
  get storyOffset() { const f = this._frame; return { parentTextFrames: f ? [f] : [] }; }
}
class Story {
  constructor(id, paras, tables) { this.id = id; this._paras = paras; this._tables = tables || []; }
  get paragraphs() { return coll(this._paras); }
  get tables() { return coll(this._tables); }
  /* 段落を「ストーリー本文 → 表のセル」の順に平坦化（＝ドキュメント順の近似） */
  flatten() {
    const out = this._paras.slice();
    this._tables.forEach(t => t._cells.forEach(c => c._paras.forEach(p => out.push(p))));
    return out;
  }
}
class TextFrame { constructor(pageName) { this.parentPage = { name: pageName }; } }

/* findText が返すオブジェクト。段落の実体を指し、contents で丸ごと置換できる */
class Found {
  constructor(para, story) { this._p = para; this._story = story; }
  get contents() { return this._p._text; }
  set contents(v) { this._p._text = v; }
  get parentStory() { return this._story; }
  get parentTextFrames() { return this._p.parentTextFrames; }
}

/* ---------- グローバル ---------- */
const alerts = [];
global.alert = m => alerts.push(m);
/* confirm の戻り値をテストごとに差し替える */
let confirmAnswer = false;
const confirms = [];
global.confirm = m => { confirms.push(m); return confirmAnswer; };
global.File = function () { this.open = () => {}; this.write = () => {}; this.close = () => {}; };
global.Folder = { desktop: '/tmp' };
global.ScriptLanguage = { JAVASCRIPT: 1 };
global.UndoModes = { ENTIRE_SCRIPT: 1 };
global.NothingEnum = { NOTHING: null };
global.ParagraphStyleGroup = class ParagraphStyleGroup {};
global.BATCH_MODE = true;   // 自動実行を止める
/* Window は未定義 → openProgress は try/catch で null を返す（ヘッドレス動作の確認も兼ねる） */

let findCalls = 0;
function makeApp(doc) {
  const findPrefs = { appliedParagraphStyle: null };
  const app = {
    documents: { length: 1 },
    activeDocument: doc,
    scriptPreferences: { enableRedraw: true },
    findChangeTextOptions: {},
    /* doScript は関数をそのまま実行するだけ */
    doScript: (fn) => fn(),
    get findTextPreferences() { return findPrefs; },
    set findTextPreferences(v) { findPrefs.appliedParagraphStyle = null; },
    get changeTextPreferences() { return {}; },
    set changeTextPreferences(v) {},
  };
  doc.findText = () => {
    findCalls++;
    const want = findPrefs.appliedParagraphStyle;
    const out = [];
    doc.stories.forEach(s => {
      s.flatten().forEach(p => {
        if (want && p.appliedParagraphStyle === want) out.push(new Found(p, s));
      });
    });
    return out;
  };
  return app;
}

/* ---------- ドキュメント生成 ---------- */
const stBig = new Style('保護者氏名', 1);
const stSmall = new Style('保証人氏名', 2);
const stAddr = new Style('住所', 3);

/**
 * layout:
 *   'frame'         … 1つのテキストフレームに 住所/上/下 の3段落
 *   'twoFrames'     … 上と下が別々のテキストフレーム（別ストーリー）
 *   'tableCells'    … 上と下が同じ表の別セル（今回の実際のレイアウト）
 *   'cellPlusFrame' … 上が表のセル、下が普通のテキストフレーム
 */
function buildDoc(layout, pages) {
  const stories = [];
  for (let i = 1; i <= pages; i++) {
    const f = new TextFrame(String(i));
    const top = 'Dewanto Priyanggoro' + i + '　様';
    const bot = '（Alfarisi Abdullah' + i + '　様　保証人様）';

    if (layout === 'frame') {
      stories.push(new Story(100 + i, [
        new Paragraph('東京都板橋区志村 3 丁目 -18-18\r', stAddr, f),
        new Paragraph(top + '\r', stBig, f),
        new Paragraph(bot, stSmall, f),
      ]));
    } else if (layout === 'twoFrames') {
      const f2 = new TextFrame(String(i));
      stories.push(new Story(200000 + i, [new Paragraph(top, stBig, f)]));
      stories.push(new Story(300000 + i, [new Paragraph(bot, stSmall, f2)]));
    } else if (layout === 'tableCells') {
      const tbl = new Table(400000 + i, [
        [new Paragraph('東京都板橋区志村 3 丁目 -18-18\rコーポアスカ 204 号', stAddr, f)],
        [new Paragraph(top, stBig, f)],
        [new Paragraph(bot, stSmall, f)],
      ], f);
      stories.push(new Story(500000 + i, [new Paragraph('\r', stAddr, f)], [tbl]));
    } else if (layout === 'cellPlusFrame') {
      const tbl = new Table(600000 + i, [[new Paragraph(top, stBig, f)]], f);
      stories.push(new Story(700000 + i, [new Paragraph('\r', stAddr, f)], [tbl]));
      stories.push(new Story(800000 + i, [new Paragraph(bot, stSmall, f)]));
    }
  }
  return {
    name: 'test.indd',
    pages: { length: pages },
    stories,
    allParagraphStyles: [stBig, stSmall, stAddr],
  };
}

function allTexts(doc) {
  const out = [];
  doc.stories.forEach(s => s.flatten().forEach(p => out.push(p.contents)));
  return out;
}

/* ---------- 実行 ---------- */
const src = fs.readFileSync(path, 'utf8').split('\n').filter(l => !/^\s*#/.test(l)).join('\n');

let failures = 0;
function check(label, cond) {
  console.log((cond ? '  OK   ' : '  NG   ') + label);
  if (!cond) failures++;
}

/* opts.batch = true でバッチモード（確認ダイアログを出さない経路）を検証する */
function runCase(label, layout, cfgPatch, pages, opts) {
  opts = opts || {};
  const doc = buildDoc(layout, pages || 3);
  global.app = makeApp(doc);
  const mod = new Function(
    src + '\n; return { run: run, CONFIG: CONFIG, setBatch: function (v) { BATCH = v; } };')();
  mod.setBatch(!!opts.batch);      // 読み込み時の自動実行だけ BATCH_MODE で抑止している
  Object.assign(mod.CONFIG, cfgPatch);
  const t0 = Date.now();
  const res = mod.run();
  console.log('=== ' + label + ' ===');
  console.log('  ペア数: ' + (res ? res.pairs : 0) + ' / 実行: ' + (res ? res.done : 0) +
              ' / 警告: ' + (res ? res.warns : '-') + ' / エラー: ' + (res ? res.errors : '-') +
              (res && res.error ? ' / ' + res.error : '') + ' / ' + (Date.now() - t0) + 'ms');
  check('画面更新フラグが元に戻っている', global.app.scriptPreferences.enableRedraw === true);
  return { doc, res, texts: allTexts(doc) };
}

const base = { STYLE_TOP: '保護者氏名', STYLE_BOTTOM: '保証人氏名',
               DRY_RUN: false, PAREN_POSITION: 'bottom' };
const N = 3;
let r;

/* --- 1. 同一フレーム --- */
r = runCase('同一フレームの3段落', 'frame', base);
check('3件処理された', r.res.pairs === N && r.res.done === N);
check('上が保証人名（カッコなし）', r.texts.indexOf('Alfarisi Abdullah1　様　保証人様\r') >= 0);
check('下が学生名（カッコ付き）',   r.texts.indexOf('（Dewanto Priyanggoro1　様）') >= 0);
check('段落の区切りが保たれている', r.texts.indexOf('東京都板橋区志村 3 丁目 -18-18\r') >= 0);

/* --- 2. 別フレーム（別ストーリー） --- */
r = runCase('上下が別のテキストフレーム', 'twoFrames', base);
check('3件処理された', r.res.pairs === N && r.res.done === N);
check('上が保証人名', r.texts.indexOf('Alfarisi Abdullah1　様　保証人様') >= 0);
check('下が学生名',   r.texts.indexOf('（Dewanto Priyanggoro1　様）') >= 0);

/* --- 3. 表のセル（今回のレイアウト） --- */
r = runCase('上下が表の別セル', 'tableCells', base);
check('3件処理された', r.res.pairs === N && r.res.done === N);
check('警告なし', r.res.warns === 0);
check('上のセルが保証人名', r.texts.indexOf('Alfarisi Abdullah1　様　保証人様') >= 0);
check('下のセルが学生名',   r.texts.indexOf('（Dewanto Priyanggoro1　様）') >= 0);
check('住所セルは無傷', r.texts.indexOf('東京都板橋区志村 3 丁目 -18-18\rコーポアスカ 204 号') >= 0);

/* --- 4. セル＋フレーム混在 --- */
r = runCase('上が表のセル・下がテキストフレーム', 'cellPlusFrame', base);
check('3件処理された', r.res.pairs === N && r.res.done === N);
check('上が保証人名', r.texts.indexOf('Alfarisi Abdullah1　様　保証人様') >= 0);
check('下が学生名',   r.texts.indexOf('（Dewanto Priyanggoro1　様）') >= 0);

/* --- 5. 自動判定モード（低速な全走査パス） --- */
r = runCase('表 / 自動判定モード（全走査）', 'tableCells',
            { STYLE_TOP: '', STYLE_BOTTOM: '', DRY_RUN: false, PAREN_POSITION: 'bottom' });
check('3件処理された', r.res.pairs === N && r.res.done === N);
check('上が保証人名', r.texts.indexOf('Alfarisi Abdullah1　様　保証人様') >= 0);

/* --- 6. カッコの扱い --- */
r = runCase('表 / カッコ=keep', 'tableCells', Object.assign({}, base, { PAREN_POSITION: 'keep' }));
check('カッコごと入れ替わる', r.texts.indexOf('（Alfarisi Abdullah1　様　保証人様）') >= 0 &&
                              r.texts.indexOf('Dewanto Priyanggoro1　様') >= 0);

r = runCase('表 / カッコ=none', 'tableCells', Object.assign({}, base, { PAREN_POSITION: 'none' }));
check('両方カッコなし', r.texts.indexOf('Alfarisi Abdullah1　様　保証人様') >= 0 &&
                        r.texts.indexOf('Dewanto Priyanggoro1　様') >= 0);

/* --- 7. 下見 → 確認ダイアログで「いいえ」 --- */
confirmAnswer = false;
confirms.length = 0;
r = runCase('下見 → いいえ', 'tableCells', Object.assign({}, base, { DRY_RUN: true }));
check('確認ダイアログが出る', confirms.length === 1);
check('文面に件数が入っている', /対象: 3 組/.test(confirms[0]));
check('文面に変更前後が入っている', /Dewanto Priyanggoro1/.test(confirms[0]) &&
                                    /Alfarisi Abdullah1/.test(confirms[0]));
check('検出はする', r.res.pairs === N);
check('1文字も変わらない', r.res.done === 0 &&
      r.texts.indexOf('Dewanto Priyanggoro1　様') >= 0 &&
      r.texts.indexOf('（Alfarisi Abdullah1　様　保証人様）') >= 0);

/* --- 7b. 下見 → 確認ダイアログで「はい」 --- */
confirmAnswer = true;
confirms.length = 0;
r = runCase('下見 → はい', 'tableCells', Object.assign({}, base, { DRY_RUN: true }));
check('確認ダイアログが出る', confirms.length === 1);
check('その場で3件実行される', r.res.done === N);
check('上が保証人名', r.texts.indexOf('Alfarisi Abdullah1　様　保証人様') >= 0);
check('下が学生名',   r.texts.indexOf('（Dewanto Priyanggoro1　様）') >= 0);
confirmAnswer = false;

/* --- 8. スタイル名が違う（バッチモードで戻り値を確認） --- */
r = runCase('存在しないスタイル名', 'tableCells',
            Object.assign({}, base, { STYLE_TOP: 'ないスタイル' }), 3, { batch: true });
check('エラーを返して中断する', r.res && r.res.error && r.res.pairs === 0);
check('何も書き換わっていない', r.texts.indexOf('Dewanto Priyanggoro1　様') >= 0);

/* --- 9. 3000ページ規模（findText 呼び出しは 2 回で済むこと） --- */
findCalls = 0;
r = runCase('表 / 3000ページ', 'tableCells', base, 3000);
check('3000件処理された', r.res.pairs === 3000 && r.res.done === 3000);
check('警告なし', r.res.warns === 0);
check('findText はドキュメント全体で2回だけ', findCalls === 2);
check('先頭レコードが正しい', r.texts.indexOf('Alfarisi Abdullah1　様　保証人様') >= 0);
check('最終レコードが正しい', r.texts.indexOf('（Dewanto Priyanggoro3000　様）') >= 0);

console.log('');
console.log(failures === 0 ? '全テスト成功' : (failures + ' 件失敗'));
process.exit(failures === 0 ? 0 : 1);
