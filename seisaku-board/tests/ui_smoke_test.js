// Index.html のスクリプトを簡易DOMモックで走らせ、描画・パネル・保存が例外なく動くことを確かめる
// 実行: node tests/ui_smoke_test.js
// （見た目の確認はできない。GASでしか動かない画面コードの「動かない」を早めに見つけるためのもの）
const fs = require('fs');
const path = require('path');
const { createEnv, C } = require('./gas_mock');
const { api, ss, kss, _props } = createEnv();

let fails = 0;
function check(label, cond, extra) {
  if (cond) console.log('  ok  ' + label);
  else { fails++; console.log('  NG  ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

// ---- データを用意（生産表＋紀要）----
_props['EDITOR_PIN'] = 'pin';
const today = api.today_();
const D = (n) => api.addDays_(today, n);
const prod = ss.insertSheet('2026年9月');
const setRow = (row, cells) => Object.keys(cells).forEach(col => prod.set(row, C(col), cells[col]));
setRow(3, { M: '受注番号' });
setRow(4, { D: '深澤', E: '★', K: 2275, M: '22962-000', N: '学校法人 明治大学', O: '文芸研究 第158号', S: 'CTP', T: '篠原', W: '2026/09/30', Z: '2026/08/20', AA: '2026/08/28', AB: '2026/09/04', AI: '冊子' });
setRow(5, { D: '田邉', F: 120, M: '22970-000', N: '台東区', O: '決算書', S: 'オンデマンド', W: D(10), Z: D(-5), AG: D(2), AI: '冊子' });
setRow(6, { D: '中澤', G: '★', M: '22950-000', N: '東洋音楽学会', O: '東洋音楽研究', S: 'CTP', T: '小森', Z: D(-20), AG: today, AI: '冊子' });
setRow(7, { D: '佐藤', M: '？？？', N: '港製作所', O: '暑中見舞', S: 'PDF', W: D(30), AI: '冊子' });
const kiyo = kss.insertSheet('進行中');
kiyo.set(2, 1, '文芸研究158号\n【22962-000】');
kiyo.set(3, 1, '表紙'); kiyo.set(3, C('N'), 828); kiyo.set(3, C('O'), '責了');
kiyo.set(4, 1, '論文A'); kiyo.set(4, 2, '著者A'); kiyo.set(4, C('L'), 810); kiyo.set(4, C('M'), 819);
kiyo.set(6, 1, '教養論集588'); kiyo.set(6, 2, '10本');
kiyo.set(7, 1, '表紙'); kiyo.set(7, C('L'), 804);
api.importAll();

// ---- DOM モック ----
const elements = {};
function el(id) {
  if (!elements[id]) {
    elements[id] = {
      id: id, innerHTML: '', textContent: '', value: '', disabled: false, checked: false,
      classes: {}, attrs: {},
      classList: {
        toggle(c, on) { if (on === undefined) on = !elements[id].classes[c]; elements[id].classes[c] = !!on; },
        add(c) { elements[id].classes[c] = true; }, remove(c) { delete elements[id].classes[c]; },
        contains(c) { return !!elements[id].classes[c]; }
      },
      set className(v) { this.classes = {}; v.split(/\s+/).filter(Boolean).forEach(c => { this.classes[c] = true; }); },
      addEventListener() {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
      focus() {}, scrollIntoView() {}
    };
  }
  return elements[id];
}
const preset = {};   // パネル内の入力値（innerHTML から生成される要素の代わり）
const document = {
  getElementById(id) { const e = el(id); if (preset.hasOwnProperty(id)) e.value = preset[id]; return e; },
  querySelectorAll(sel) {
    if (sel === '.chk-DTP') return [{ value: '和泉', checked: true }, { value: '高橋', checked: !!preset.chkTakahashi }];
    if (sel === '.chk-編集') return [{ value: '橋本', checked: true }];
    if (sel === '[data-reset]') return [];
    return [];
  },
  addEventListener() {},
  documentElement: { attrs: {}, getAttribute(k) { return this.attrs[k] || null; }, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } }
};
const timers = [];
const window = { prompt: () => 'pin', confirm: () => true };
const localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const calls = [];
const google = { script: { run: null } };
function makeRunner() {
  let ok = null, ng = null;
  const runner = {
    withSuccessHandler(f) { ok = f; return runner; },
    withFailureHandler(f) { ng = f; return runner; }
  };
  ['getBoardData', 'runImportNow', 'saveCase', 'resetToProduction', 'mergeCases', 'setStaffNote'].forEach(function (name) {
    runner[name] = function () {
      calls.push(name);
      let res;
      try { res = api[name].apply(null, arguments); } catch (e) { if (ng) ng(e); return; }
      if (ok) ok(res);
    };
  });
  return runner;
}
Object.defineProperty(google.script, 'run', { get: makeRunner });

// ---- Index.html のスクリプトをロード ----
const html = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
const ctx = { document, window, localStorage, google, console,
  setInterval: (f, ms) => { timers.push(f); return 1; }, setTimeout: () => 0, clearTimeout: () => {} };
const ui = new Function(...Object.keys(ctx), script +
  '\nreturn { state, render, openPanel, closePanel, savePanel, cardHtml, shortStamp, sortRows };')(...Object.values(ctx));

console.log('--- 初期描画（担当者ビュー） ---');
check('データを読み込んだ', !!ui.state.data && ui.state.data.rows.length === 4, ui.state.data && ui.state.data.rows.length);
const staffHtml = el('viewStaff').innerHTML;
check('DTP と 編集 の見出し', staffHtml.indexOf('＊DTP') >= 0 && staffHtml.indexOf('＊編集') >= 0);
check('担当者見出しと負荷', /【和泉】.*抱え <b>1<\/b>件 ／ 今週下版 <b>0<\/b>件/.test(staffHtml), staffHtml.slice(0, 400));
// 下版予定日は今日＋2日。それが今週（月〜金）に入るかどうかは曜日次第なので期待値を計算する
const gehanInWeek = (D(2) >= ui.state.data.weekStart && D(2) <= ui.state.data.weekEnd) ? 1 : 0;
check('高橋は今週下版' + gehanInWeek + '件', new RegExp('【高橋】.*抱え <b>1</b>件 ／ 今週下版 <b>' + gehanInWeek + '</b>件').test(staffHtml), staffHtml.match(/【高橋】.*?<\/span>/));
const shortOf = (ymd) => ymd.replace(/^\d{4}\/0?(\d+)\/0?(\d+)$/, '$1/$2');
check('予定が無い案件は納期を大きく出す', staffHtml.indexOf('<span class="date">9/30</span><span class="evt">納期</span>') >= 0, staffHtml.match(/dateline[^>]*>.*?<\/div>/g));
check('その場合は状態の横に直近の実績', staffHtml.indexOf('初校戻り <b>9/4</b>') >= 0);
check('次の予定を大きく出す（下版予定）', staffHtml.indexOf('<span class="date">' + shortOf(D(2)) + '</span><span class="evt">下版予定</span>') >= 0);
check('その場合は状態の横に納期', staffHtml.indexOf('納期 <b>' + shortOf(D(10)) + '</b>') >= 0);
check('予定も実績も無い未入稿は納期を大きく出す', staffHtml.indexOf('<span class="date">' + shortOf(D(30)) + '</span><span class="evt">納期</span>') >= 0);
check('下版済は完了日と「下版済」', staffHtml.indexOf('<span class="evt">下版済</span>') >= 0);
check('オフは濃い色', staffHtml.indexOf('out-badge strong">オフ') >= 0);
check('論文の内訳', staffHtml.indexOf('責了 <b>1</b>') >= 0 && staffHtml.indexOf('初校戻り <b>1</b>') >= 0);
check('営業担当', staffHtml.indexOf('【深澤】') >= 0);
check('未採番の印', staffHtml.indexOf('未採番') >= 0);
check('担当者未設定のまとまり', staffHtml.indexOf('＊担当者未設定') >= 0 && staffHtml.indexOf('暑中見舞') >= 0);
check('下版済は完了として薄く出る', staffHtml.indexOf('完了（下版済）') >= 0 && staffHtml.indexOf('card clickable done') >= 0);
check('番号なしの見出しの注意', el('kiyoNotice').textContent.indexOf('教養論集588') >= 0, el('kiyoNotice').textContent);
check('閲覧のみのメタ表示', el('meta').textContent.indexOf('閲覧のみ') === 0, el('meta').textContent);
check('閲覧者に注記ボタンは出ない', staffHtml.indexOf('✎ 注記') < 0);

console.log('--- ステータスビュー ---');
ui.state.view = 'status';
ui.render();
const statusHtml = el('viewStatus').innerHTML;
check('4カラム', ['未入稿', '作業中', '校正中', '完了（下版済）'].every(n => statusHtml.indexOf('name">' + n + '<') >= 0));
check('件数', statusHtml.indexOf('未入稿</span><span class="sub">1件') >= 0 && statusHtml.indexOf('校正中</span><span class="sub">1件') >= 0);

console.log('--- 閲覧者の詳細パネル ---');
ui.openPanel('22962-000');
let panel = el('panel').innerHTML;
check('論文一覧が出る', panel.indexOf('ptable') >= 0 && panel.indexOf('論文A') >= 0);
check('閲覧者には保存ボタンが無い', panel.indexOf('id="panelSave"') < 0);
ui.closePanel();

console.log('--- 編集モード ---');
ui.state.pin = 'pin';
ui.state.view = 'staff';
ui.render();   // getBoardData は再取得しないので canEdit はまだ false
google.script.run.withSuccessHandler(d => { ui.state.data = d; ui.render(); }).getBoardData({ pin: 'pin' });
check('更新可', ui.state.data.canEdit === true && el('meta').textContent.indexOf('更新可') === 0);
check('編集者に注記ボタンが出る', el('viewStaff').innerHTML.indexOf('✎ 注記') >= 0);
ui.openPanel('22962-000');
panel = el('panel').innerHTML;
check('編集フォームが出る', panel.indexOf('id="f_status"') >= 0 && panel.indexOf('id="panelSave"') >= 0 && panel.indexOf('id="mergeTarget"') >= 0);
check('生産表の値が分かる', panel.indexOf('校正中（生産表）') >= 0 && panel.indexOf('オフ（生産表）') >= 0);
check('統合先に自分は出ない', panel.indexOf('22962-000　学校法人') < 0 && panel.indexOf('22970-000　台東区') >= 0);

preset.f_name = '和泉'; preset.f_status = '作業中'; preset.f_gehan = '2026-09-20'; preset.f_output = 'オフ'; preset.f_memo = '著者校待ち'; preset.chkTakahashi = true;
ui.savePanel();
check('saveCase が呼ばれた', calls.indexOf('saveCase') >= 0, calls);
check('保存後に再描画される', calls.filter(c => c === 'getBoardData').length >= 3);
const saved = ui.state.data.rows.find(r => r.key === '22962-000');
check('状態・日付・担当が手動になった', saved.status === '作業中' && saved.gehan === '2026/09/20' && saved.dtp.join(',') === '和泉,高橋' && saved.manualFields.join(',') === 'status,date,staff', saved.manualFields);
check('出力は生産表と同じなので手動にならない', saved.manualFields.indexOf('output') < 0);
const cardAfter = el('viewStaff').innerHTML;
check('カードに手動の印と直した人', cardAfter.indexOf('manual-badge') >= 0 && cardAfter.indexOf('手動 和泉') >= 0);
check('生産表とボードを並べて表示', cardAfter.indexOf('状態 生産表 校正中 ／ ボード 作業中') >= 0, cardAfter.match(/conflict">[^<]*/g));
check('手動の下版予定日が大きい日付になる', cardAfter.indexOf('<span class="date">9/20</span><span class="evt">下版予定</span>') >= 0, cardAfter.match(/dateline[^>]*>.*?<\/div>/g));
check('高橋の抱えが増える', new RegExp('【高橋】.*抱え <b>2</b>件 ／ 今週下版 <b>' + gehanInWeek + '</b>件').test(cardAfter), cardAfter.match(/【高橋】.*?<\/span>/));

console.log('--- 自動更新はパネルを開いている間止まる ---');
ui.openPanel('22970-000');
const before = calls.length;
timers.forEach(f => f());
check('パネル表示中は再取得しない', calls.length === before);
ui.closePanel();
timers.forEach(f => f());
check('閉じると再取得する', calls.length === before + 1);

console.log('--- 表示ユーティリティ ---');
check('shortStamp は途中の日付も複数でも短縮', ui.shortStamp('初校戻り 2026/09/04 ／ 再校提出予定 2026/09/20') === '初校戻り 9/4 ／ 再校提出予定 9/20' && ui.shortStamp('2026/09/11 03:20') === '9/11 03:20');
const sorted = ui.sortRows(ui.state.data.rows).map(r => r.key);
// 22950-000=完了(今日) / 22970-000=下版予定(+2) / 22962-000=下版予定(手動 9/20) / 仮:港製作所=納期(+30)
check('大きい日付の順に並ぶ', sorted[0] === '22950-000' && sorted[1] === '22970-000' && sorted[sorted.length - 1] === '仮:港製作所|暑中見舞', sorted);

console.log(fails === 0 ? '\nすべて成功' : `\n失敗 ${fails} 件`);
process.exit(fails === 0 ? 0 : 1);
