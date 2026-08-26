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
}
class FakeSS {
  constructor(){this.sheets=[];}
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

// ---- 生産表シートを用意 ----
const prod = ss.insertSheet('2026年8月');
prod.set(1,1,'受注NO'); prod.set(1,2,'営業担当'); prod.set(1,3,'得意先名'); prod.set(1,4,'品名');
prod.set(1,5,'仕上寸法'); prod.set(1,6,'金額'); prod.set(1,7,'受注日付'); prod.set(1,8,'納期');
const rows = [
  ['26-0001','山田','A商事','会社案内 8P','A4','120000','2026/08/01','2026/09/10'],
  ['26-0002','鈴木','B工業','伝票 3枚複写','B6','80000','2026/08/03','2026/09/05'],
  ['26-0003','山田','C社','封筒 長3','長3','40000','2026/08/05','2026/08/28'],
];
rows.forEach((r,i)=>r.forEach((v,j)=>prod.set(i+2,j+1,v)));

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
check('案件は2行目から入る', boardSheet.cell(2, 1) === '26-0001', {row2: boardSheet.cell(2,1), lastRow: boardSheet.getLastRow()});
check('空行が挟まらない', boardSheet.cell(4, 1) === '26-0003', boardSheet.cell(4,1));

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
api.setCategory('26-0001','社内');
api.setCategory('26-0002','社外');
api.setCategory('26-0003','対象外');
data = api.getBoardData({});
check('対象外は非表示', data.rows.length === 2, data.rows.map(r=>r.orderNo));
const a = data.rows.find(r=>r.orderNo==='26-0001');
const b = data.rows.find(r=>r.orderNo==='26-0002');
check('社内の現在工程は下版', a.currentStageName === '下版', a.currentStageName);
check('社外の現在工程は工務', b.currentStageName === '工務', b.currentStageName);
check('区分確定日が入る', !!a.categoryFixedAt, a.categoryFixedAt);
check('日程未定（予定日なし）', a.placeDate === '', a.placeDate);
check('対象外は編集者+指定時のみ出る', api.getBoardData({includeExcluded:true}).rows.length === 3);

console.log('--- 予定日の入力と配置 ---');
api.saveRow('26-0001', {plans:{gehan:'2026-08-26', print:'2026-08-28', komu:'2026-09-01'}, memo:'用紙 8/25入荷予定'});
data = api.getBoardData({});
let a2 = data.rows.find(r=>r.orderNo==='26-0001');
check('下版予定日に配置', a2.placeDate === '2026/08/26', a2.placeDate);
check('メモ保存', a2.memo === '用紙 8/25入荷予定', a2.memo);

console.log('--- 完了ボタンで次工程へ移動 ---');
const tok = api.completeCurrentStage('26-0001');
check('下版を完了', tok.stageName === '下版', tok);
data = api.getBoardData({});
a2 = data.rows.find(r=>r.orderNo==='26-0001');
check('現在工程が印刷へ', a2.currentStageName === '印刷', a2.currentStageName);
check('配置日が印刷予定日へ', a2.placeDate === '2026/08/28', a2.placeDate);

console.log('--- 取消 ---');
api.undoComplete(tok);
data = api.getBoardData({});
a2 = data.rows.find(r=>r.orderNo==='26-0001');
check('下版へ戻る', a2.currentStageName === '下版', a2.currentStageName);

console.log('--- 外注スキップ ---');
api.saveRow('26-0001', {dones:{gehan:'2026-08-26', print:'2026-08-28'}, skipOuter:true, category:'社内'});
data = api.getBoardData({});
a2 = data.rows.find(r=>r.orderNo==='26-0001');
check('外注を飛ばして工務が現在工程', a2.currentStageName === '工務', a2.currentStageName);

console.log('--- 警告 ---');
api.saveRow('26-0001', {plans:{komu:'2026-09-20'}});   // 納期 2026/09/10 より後
data = api.getBoardData({});
a2 = data.rows.find(r=>r.orderNo==='26-0001');
check('納期超過の警告', a2.warnings.indexOf('納期超過') >= 0, a2.warnings);
api.saveRow('26-0001', {plans:{komu:'2020-01-06'}});   // 過去日で未完了
data = api.getBoardData({});
a2 = data.rows.find(r=>r.orderNo==='26-0001');
check('予定日超過の警告', a2.warnings.indexOf('予定日超過') >= 0, a2.warnings);

console.log('--- 納品完了と7日ルール ---');
api.saveRow('26-0001', {dones:{komu:'2026-09-01', delivery: api.today_()}});
data = api.getBoardData({});
a2 = data.rows.find(r=>r.orderNo==='26-0001');
check('完了扱い', a2 && a2.isCompleted === true);
api.saveRow('26-0001', {dones:{delivery:'2000/01/01'}});
data = api.getBoardData({});
check('7日超の完了は非表示', !data.rows.find(r=>r.orderNo==='26-0001'), data.rows.map(r=>r.orderNo));

console.log('--- 生産表側の納期変更に追随／工務入力は保護 ---');
prod.set(3,8,'2026/09/25');      // 26-0002 の納期変更
api.saveRow('26-0002', {plans:{komu:'2026-09-15'}});
const r3 = api.importFromProductionSheet();
check('更新1件', r3.updated === 1, r3);
data = api.getBoardData({});
const b2 = data.rows.find(r=>r.orderNo==='26-0002');
check('納期が更新される', b2.due === '2026/09/25', b2.due);
check('工務入力は保持される', b2.plans.komu === '2026/09/15', b2.plans.komu);

console.log('--- 権限のない利用者 ---');
_props['EDITOR_EMAILS'] = 'other@example.co.jp';
check('canEdit false', api.getBoardData({}).canEdit === false);
let threw = false;
try { api.completeCurrentStage('26-0002'); } catch(e) { threw = true; }
check('閲覧専用は書き込み不可', threw);

console.log('--- 1000行目付近に飛んでしまったシートの復旧 ---');
// 旧バージョンで起きた状態を再現：P2:P1000 が false、案件は1001行目以降
const broken = ss.insertSheet('壊れたボード');
ss.sheets = ss.sheets.filter(s => s.getName() !== '進行ボード');
broken.name = '進行ボード';
['受注NO','得意先名','品名','営業担当','納期','下版予定日','下版完了日','印刷予定日','印刷完了日',
 '外注予定日','外注完了日','工務予定日','工務完了日','納品完了日','メモ','外注スキップ','区分','区分確定日','最終更新日時']
 .forEach((h,i)=>broken.set(1,i+1,h));
for (let r = 2; r <= 1000; r++) broken.set(r, 16, false);          // P列のチェックボックス
broken.set(1001, 1, '26-0001'); broken.set(1001, 2, 'A商事'); broken.set(1001, 17, '社内');
broken.set(1001, 6, '2026/09/01');                                  // 工務が入れた下版予定日
broken.set(1002, 1, '26-0002'); broken.set(1002, 2, 'B工業'); broken.set(1002, 17, '未定');
check('壊れた状態の実データ最終行を正しく見る', api.boardLastDataRow_(broken) === 1002, api.boardLastDataRow_(broken));
const repaired = api.repairBoardSheet();
console.log('  ' + repaired);
check('2行目から並び直る', broken.cell(2,1) === '26-0001' && broken.cell(3,1) === '26-0002',
  [broken.cell(2,1), broken.cell(3,1)]);
check('入力済みの予定日が残る', broken.cell(2,6) === '2026/09/01', broken.cell(2,6));
check('1001行目は空になる', broken.cell(1001,1) === '', broken.cell(1001,1));
_props['EDITOR_EMAILS'] = 'komu@example.co.jp';
const after = api.importFromProductionSheet();
check('復旧後の取込は既存を重複させない', after.added === 1, after);   // 26-0003 のみ新規
check('追記も詰めて入る', broken.cell(4,1) === '26-0003', broken.cell(4,1));

console.log(fails === 0 ? '\nすべて成功' : `\n失敗 ${fails} 件`);
process.exit(fails === 0 ? 0 : 1);
