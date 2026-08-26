// GAS API を最小限モックして Code.gs のロジックを検証する
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'Code.gs'), 'utf8');

// ---- モック ----
function pad(n){return n<10?'0'+n:''+n;}
const Utilities = {
  formatDate(d, tz, f) {
    const y=d.getFullYear(), m=pad(d.getMonth()+1), da=pad(d.getDate());
    if (f === 'yyyy/MM/dd') return `${y}/${m}/${da}`;
    return `${y}/${m}/${da} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
};
const _props = {};
const PropertiesService = { getScriptProperties: () => ({
  getProperty: k => (k in _props ? _props[k] : null),
  setProperty: (k,v) => { _props[k]=v; }
})};
const Session = {
  getActiveUser: () => ({ getEmail: () => 'komu@example.co.jp' }),
  getEffectiveUser: () => ({ getEmail: () => 'owner@example.co.jp' })
};
const LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock(){} }) };
const console_ = console;

class FakeRange {
  constructor(sheet,r,c,nr,nc){this.sheet=sheet;this.r=r;this.c=c;this.nr=nr;this.nc=nc;}
  getValues(){const out=[];for(let i=0;i<this.nr;i++){const row=[];for(let j=0;j<this.nc;j++){row.push(this.sheet.cell(this.r+i,this.c+j));}out.push(row);}return out;}
  getValue(){return this.sheet.cell(this.r,this.c);}
  setValues(v){for(let i=0;i<v.length;i++)for(let j=0;j<v[i].length;j++)this.sheet.set(this.r+i,this.c+j,v[i][j]);return this;}
  setValue(v){this.sheet.set(this.r,this.c,v);return this;}
  setFontWeight(){return this;} setBackground(){return this;} setNumberFormat(){return this;}
  setDataValidation(){return this;} clearDataValidations(){return this;}
  clearContent(){for(let i=0;i<this.nr;i++)for(let j=0;j<this.nc;j++)this.sheet.set(this.r+i,this.c+j,'');return this;}
  // 本物の insertCheckboxes() は範囲内の全セルを false にする（＝getLastRow が伸びる）
  insertCheckboxes(){for(let i=0;i<this.nr;i++)for(let j=0;j<this.nc;j++)this.sheet.set(this.r+i,this.c+j,false);return this;}
}
class FakeSheet {
  constructor(name){this.name=name;this.data=[];}
  cell(r,c){const row=this.data[r-1];return row&&row[c-1]!==undefined?row[c-1]:'';}
  set(r,c,v){while(this.data.length<r)this.data.push([]);const row=this.data[r-1];while(row.length<c)row.push('');row[c-1]=v;}
  getName(){return this.name;}
  isSheetHidden(){return false;}
  getLastRow(){let last=0;this.data.forEach((row,i)=>{if(row.some(v=>v!==''&&v!==null&&v!==undefined))last=i+1;});return last;}
  getMaxRows(){return Math.max(1000,this.getLastRow());}
  getRange(r,c,nr,nc){return new FakeRange(this,r,c,nr===undefined?1:nr,nc===undefined?1:nc);}
  setFrozenRows(){} setFrozenColumns(){} setColumnWidth(){} insertRowsAfter(){}
  getMaxColumns(){let m=0;this.data.forEach(row=>{if(row.length>m)m=row.length;});return Math.max(m,26);}
  getLastColumn(){let m=0;this.data.forEach(row=>{for(let j=row.length-1;j>=0;j--){if(row[j]!==''&&row[j]!==null&&row[j]!==undefined){if(j+1>m)m=j+1;break;}}});return m;}
}
class FakeSS {
  constructor(){this.sheets=[];}
  getName(){return '2024編集室生産表';}
  getSheets(){return this.sheets;}
  getSheetByName(n){return this.sheets.find(s=>s.getName()===n)||null;}
  insertSheet(n,pos){const s=new FakeSheet(n);this.sheets.splice(pos===undefined?this.sheets.length:pos,0,s);return s;}
}
const ss = new FakeSS();
const SpreadsheetApp = {
  openById: () => ss,
  newDataValidation: () => ({
    requireValueInList: () => ({ build: () => ({}) }),
    requireCheckbox: () => ({ build: () => ({}) })
  })
};
const ScriptApp = { getProjectTriggers: () => [], newTrigger(){}, deleteTrigger(){} };
const HtmlService = {};

// ---- 生産表シートを用意（実物どおり：見出し3行、受注番号M / 得意先N / 品名O / 担当D / 納品日AH）----
const prod = ss.insertSheet('2026年8月');
const C = (letter) => { let n=0; for (const ch of letter) n = n*26 + (ch.charCodeAt(0)-64); return n; };
prod.set(1, C('N'), '2026年8月　編集室生産表');
prod.set(2, C('Z'), '入稿日'); prod.set(2, C('AG'), '下版日'); prod.set(2, C('AH'), '納品日');
[['A','電算'],['B','日付'],['C','品川'],['D','担当'],['E','和泉'],['M','受注番号'],
 ['N','得意先'],['O','品名'],['V','生産金額'],['W','納期'],['X','備考'],['AI','大分類']]
 .forEach(([col, name]) => prod.set(3, C(col), name));

const rows = [
  { 電算:'済', 日付:5,  担当:'中澤', 受注番号:'22670-000', 得意先:'東洋音楽学会',   品名:'東洋音楽研究 第91号', 納期:'2026/08/24', 下版日:'2026/08/04', 納品日:'2026/08/24' },
  { 電算:'済', 日付:7,  担当:'田邉', 受注番号:'22694-000', 得意先:'台東区',         品名:'各会計歳入歳出決算書', 納期:'2026/08/08', 下版日:'2026/08/04', 納品日:'2026/08/08' },
  { 電算:'済', 日付:20, 担当:'中澤', 受注番号:'22795-000', 得意先:'日本テレワーク学会', 品名:'日本テレワーク学会誌', 納期:'2026/08/25', 下版日:'',           納品日:'2026/08/25' },
];
rows.forEach((r, i) => {
  const row = i + 4;                       // データは4行目から
  prod.set(row, C('A'), r.電算);
  prod.set(row, C('B'), r.日付);
  prod.set(row, C('D'), r.担当);
  prod.set(row, C('M'), r.受注番号);
  prod.set(row, C('N'), r.得意先);
  prod.set(row, C('O'), r.品名);
  prod.set(row, C('W'), r.納期);
  prod.set(row, C('AG'), r.下版日);
  prod.set(row, C('AH'), r.納品日);
});

// ---- Code.gs をロード ----
const ctx = { Utilities, PropertiesService, Session, LockService, SpreadsheetApp, ScriptApp, HtmlService, console };
const fn = new Function(...Object.keys(ctx), src + '\nreturn {importFromProductionSheet,getBoardData,setCategory,completeCurrentStage,undoComplete,saveRow,setupBoardSheet,getBoardSheet_,repairBoardSheet,diagnoseImport,boardLastDataRow_,today_,COL};');
const api = fn(...Object.values(ctx));

let fails = 0;
function check(label, cond, extra) {
  if (cond) { console.log('  ok  ' + label); }
  else { fails++; console.log('  NG  ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

console.log('--- 1回目の取込 ---');
let r1 = api.importFromProductionSheet();
console.log(r1);
check('新規3件', r1.added === 3, r1);

const boardSheet = ss.getSheetByName('進行ボード');
check('案件は2行目から入る', boardSheet.cell(2, 1) === '22670-000', {row2: boardSheet.cell(2,1), lastRow: boardSheet.getLastRow()});
check('空行が挟まらない', boardSheet.cell(4, 1) === '22795-000', boardSheet.cell(4,1));

console.log('--- 2回目の取込（重複追加しない） ---');
let r2 = api.importFromProductionSheet();
check('新規0件・更新0件', r2.added === 0 && r2.updated === 0, r2);

console.log('--- 取込直後は全件「未定」 ---');
_props['EDITOR_EMAILS'] = 'komu@example.co.jp';
let data = api.getBoardData({});
check('3件取得', data.rows.length === 3, data.rows.length);
check('全件未定', data.rows.every(r => r.category === '未定'));
check('更新権限あり', data.canEdit === true);

console.log('--- 区分の確定 ---');
api.setCategory('22670-000','社内');
api.setCategory('22694-000','社外');
api.setCategory('22795-000','対象外');
data = api.getBoardData({});
check('対象外は非表示', data.rows.length === 2, data.rows.map(r=>r.orderNo));
const a = data.rows.find(r=>r.orderNo==='22670-000');
const b = data.rows.find(r=>r.orderNo==='22694-000');
check('社内の現在工程は下版', a.currentStageName === '下版', a.currentStageName);
check('社外の現在工程は工務', b.currentStageName === '工務', b.currentStageName);
check('区分確定日が入る', !!a.categoryFixedAt, a.categoryFixedAt);
check('日程未定（予定日なし）', a.placeDate === '', a.placeDate);
check('対象外は編集者+指定時のみ出る', api.getBoardData({includeExcluded:true}).rows.length === 3);

console.log('--- 予定日の入力と配置 ---');
api.saveRow('22670-000', {plans:{gehan:'2026-08-26', print:'2026-08-28', komu:'2026-09-01'}, memo:'用紙 8/25入荷予定'});
data = api.getBoardData({});
let a2 = data.rows.find(r=>r.orderNo==='22670-000');
check('下版予定日に配置', a2.placeDate === '2026/08/26', a2.placeDate);
check('メモ保存', a2.memo === '用紙 8/25入荷予定', a2.memo);

console.log('--- 完了ボタンで次工程へ移動 ---');
const tok = api.completeCurrentStage('22670-000');
check('下版を完了', tok.stageName === '下版', tok);
data = api.getBoardData({});
a2 = data.rows.find(r=>r.orderNo==='22670-000');
check('現在工程が印刷へ', a2.currentStageName === '印刷', a2.currentStageName);
check('配置日が印刷予定日へ', a2.placeDate === '2026/08/28', a2.placeDate);

console.log('--- 取消 ---');
api.undoComplete(tok);
data = api.getBoardData({});
a2 = data.rows.find(r=>r.orderNo==='22670-000');
check('下版へ戻る', a2.currentStageName === '下版', a2.currentStageName);

console.log('--- 外注スキップ ---');
api.saveRow('22670-000', {dones:{gehan:'2026-08-26', print:'2026-08-28'}, skipOuter:true, category:'社内'});
data = api.getBoardData({});
a2 = data.rows.find(r=>r.orderNo==='22670-000');
check('外注を飛ばして工務が現在工程', a2.currentStageName === '工務', a2.currentStageName);

console.log('--- 警告 ---');
api.saveRow('22670-000', {plans:{komu:'2026-09-20'}});   // 納期 2026/09/10 より後
data = api.getBoardData({});
a2 = data.rows.find(r=>r.orderNo==='22670-000');
check('納期超過の警告', a2.warnings.indexOf('納期超過') >= 0, a2.warnings);
api.saveRow('22670-000', {plans:{komu:'2020-01-06'}});   // 過去日で未完了
data = api.getBoardData({});
a2 = data.rows.find(r=>r.orderNo==='22670-000');
check('予定日超過の警告', a2.warnings.indexOf('予定日超過') >= 0, a2.warnings);

console.log('--- 納品完了と7日ルール ---');
api.saveRow('22670-000', {dones:{komu:'2026-09-01', delivery: api.today_()}});
data = api.getBoardData({});
a2 = data.rows.find(r=>r.orderNo==='22670-000');
check('完了扱い', a2 && a2.isCompleted === true);
api.saveRow('22670-000', {dones:{delivery:'2000/01/01'}});
data = api.getBoardData({});
check('7日超の完了は非表示', !data.rows.find(r=>r.orderNo==='22670-000'), data.rows.map(r=>r.orderNo));

console.log('--- 生産表側の納期変更に追随／工務入力は保護 ---');
prod.set(5, C('W'), '2026/09/25');      // 22694-000 の納期を変更
api.saveRow('22694-000', {plans:{komu:'2026-09-15'}});
const r3 = api.importFromProductionSheet();
check('更新1件', r3.updated === 1, r3);
data = api.getBoardData({});
const b2 = data.rows.find(r=>r.orderNo==='22694-000');
check('納期が更新される', b2.due === '2026/09/25', b2.due);
check('工務入力は保持される', b2.plans.komu === '2026/09/15', b2.plans.komu);

console.log('--- 権限のない利用者 ---');
_props['EDITOR_EMAILS'] = 'other@example.co.jp';
check('canEdit false', api.getBoardData({}).canEdit === false);
let threw = false;
try { api.completeCurrentStage('22694-000'); } catch(e) { threw = true; }
check('閲覧専用は書き込み不可', threw);

console.log('--- 列マッピング ---');
check('受注番号はM列から読む', boardSheet.cell(2,1) === '22670-000', boardSheet.cell(2,1));
check('得意先はN列', boardSheet.cell(2,2) === '東洋音楽学会', boardSheet.cell(2,2));
check('品名はO列', boardSheet.cell(2,3) === '東洋音楽研究 第91号', boardSheet.cell(2,3));
check('担当はD列', boardSheet.cell(2,4) === '中澤', boardSheet.cell(2,4));
check('納期はW列', boardSheet.cell(2,5) === '2026/08/24', boardSheet.cell(2,5));
const diag = api.diagnoseImport();
check('診断が3行目の見出しを出す', diag.indexOf('見出し 3行目：') >= 0 && diag.indexOf('M=受注番号') >= 0);
check('診断が2行目の見出しも出す（下版日・納品日はここ）', diag.indexOf('見出し 2行目：') >= 0 && diag.indexOf('AG=下版日') >= 0);
check('診断が読み取り結果を出す', diag.indexOf('受注NO=「22670-000」') >= 0);
check('診断が件数を出す', diag.indexOf('受注NOが入っている行数：3 行') >= 0, diag.split('\n').pop());

console.log('--- 下版予定日の任意取込（既定はオフ）---');
check('既定では下版予定日を取り込まない', boardSheet.cell(3, 6) === '', boardSheet.cell(3,6));
_props['SRC_COL_GEHAN_PLAN'] = 'AG';
// 既存行には入らない（F列以降は取込で触らない）
api.importFromProductionSheet();
check('既存行の下版予定日は変わらない', boardSheet.cell(3, 6) === '', boardSheet.cell(3,6));
// 新規案件では初期値として入る
[['A','済'],['D','深澤'],['M','22903-000'],['N','日本公認会計士協会'],['O','CPDレター 2026年8月号'],
 ['W','2026/08/10'],['AG','2026/08/05']].forEach(([col,v]) => prod.set(7, C(col), v));
const seeded = api.importFromProductionSheet();
check('新規1件', seeded.added === 1, seeded);
const newRow = api.getBoardData({}).rows.find(r => r.orderNo === '22903-000');
check('新規案件は下版予定日が入った状態で入る', newRow.plans.gehan === '2026/08/05', newRow.plans.gehan);
_props['SRC_COL_GEHAN_PLAN'] = '-';

console.log('--- プロパティで列を変更できる ---');
_props['SRC_COL_SALES'] = 'B';        // 担当をD列からB列（日付）に変えてみる
const moved = api.importFromProductionSheet();
check('変更が反映される', boardSheet.cell(2,4) === '5', {value: boardSheet.cell(2,4), moved: moved});
_props['SRC_COL_SALES'] = 'D';
api.importFromProductionSheet();
check('戻せる', boardSheet.cell(2,4) === '中澤', boardSheet.cell(2,4));

console.log('--- 1000行目付近に飛んでしまったシートの復旧 ---');
// 旧バージョンで起きた状態を再現：P2:P1000 が false、案件は1001行目以降
const broken = ss.insertSheet('壊れたボード');
ss.sheets = ss.sheets.filter(s => s.getName() !== '進行ボード');
broken.name = '進行ボード';
['受注NO','得意先名','品名','営業担当','納期','下版予定日','下版完了日','印刷予定日','印刷完了日',
 '外注予定日','外注完了日','工務予定日','工務完了日','納品完了日','メモ','外注スキップ','区分','区分確定日','最終更新日時']
 .forEach((h,i)=>broken.set(1,i+1,h));
for (let r = 2; r <= 1000; r++) broken.set(r, 16, false);          // P列のチェックボックス
broken.set(1001, 1, '22670-000'); broken.set(1001, 2, '東洋音楽学会'); broken.set(1001, 17, '社内');
broken.set(1001, 6, '2026/09/01');                                  // 工務が入れた下版予定日
broken.set(1002, 1, '22694-000'); broken.set(1002, 2, '台東区'); broken.set(1002, 17, '未定');
check('壊れた状態の実データ最終行を正しく見る', api.boardLastDataRow_(broken) === 1002, api.boardLastDataRow_(broken));
const repaired = api.repairBoardSheet();
console.log('  ' + repaired);
check('2行目から並び直る', broken.cell(2,1) === '22670-000' && broken.cell(3,1) === '22694-000',
  [broken.cell(2,1), broken.cell(3,1)]);
check('入力済みの予定日が残る', broken.cell(2,6) === '2026/09/01', broken.cell(2,6));
check('1001行目は空になる', broken.cell(1001,1) === '', broken.cell(1001,1));
_props['EDITOR_EMAILS'] = 'komu@example.co.jp';
const after = api.importFromProductionSheet();
check('復旧後の取込は既存を重複させない', after.added === 2, after);   // 22795-000 と 22903-000 が新規
check('追記も詰めて入る', broken.cell(4,1) === '22795-000', broken.cell(4,1));

console.log(fails === 0 ? '\nすべて成功' : `\n失敗 ${fails} 件`);
process.exit(fails === 0 ? 0 : 1);
