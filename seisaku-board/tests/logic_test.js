// GAS API を最小限モックして seisaku-board/Code.gs のロジックを検証する
// 実行: node tests/logic_test.js
// モックは本物の副作用を再現する（shinko-board/tests/logic_test.js を土台にしている）。

const { createEnv, C } = require('./gas_mock');
const { api, ss, kss, _props } = createEnv();

let fails = 0;
function check(label, cond, extra) {
  if (cond) { console.log('  ok  ' + label); }
  else { fails++; console.log('  NG  ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}
const today = api.today_();
const D = (n) => api.addDays_(today, n);
const PIN = { pin: 'seisaku-2026', name: '和泉' };
_props['EDITOR_PIN'] = 'seisaku-2026';

// ---- 生産表シート（実物どおり：見出し3行、データ4行目から）----
const prod = ss.insertSheet('2026年9月');
prod.set(1, C('N'), '2026年9月　編集室生産表');
prod.set(2, C('Z'), '入稿日'); prod.set(2, C('AA'), '初校提出'); prod.set(2, C('AG'), '下版日'); prod.set(2, C('AH'), '納品日');
[['A', '電算'], ['B', '日付'], ['D', '担当'], ['E', '和泉'], ['F', '高橋'], ['G', '野澤'], ['H', '鈴木'], ['I', '派遣'], ['J', '磯網'], ['K', '橋本'], ['L', '菅井'],
 ['M', '受注番号'], ['N', '得意先'], ['O', '品名'], ['S', '出力'], ['T', '刷り'], ['W', '納期'], ['AI', '大分類']]
  .forEach(([col, name]) => prod.set(3, C(col), name));

function setRow(row, cells) { Object.keys(cells).forEach(col => prod.set(row, C(col), cells[col])); }
setRow(4, { A: '済', D: '深澤', E: '★', K: 2275, M: '22962-000', N: '学校法人 明治大学', O: '文芸研究 第158号', S: 'CTP', T: '篠原', W: '2026/09/30', Z: '2026/08/20', AA: '2026/08/28', AB: '2026/09/04', AI: '冊子' });
setRow(5, { A: '済', D: '田邉', F: 120, M: '22970-000', N: '台東区', O: '各会計歳入歳出決算書', S: 'オンデマンド', W: D(10), Z: D(-5), AG: D(3), AI: '冊子' });
setRow(6, { A: '済', D: '中澤', G: '★', L: 300, M: '22950-000', N: '東洋音楽学会', O: '東洋音楽研究 第91号', S: 'CTP', T: '小森', Z: D(-20), AA: D(-12), AB: D(-8), AG: today, AI: '冊子' });
setRow(7, { A: '', D: '佐藤', H: '★', M: '？？？', N: '港製作所', O: '暑中見舞 冊子', S: 'PDF', W: D(30), AI: '冊子' });
setRow(8, { A: '済', D: '中澤', E: 50, M: '22999-000', N: '港製作所', O: '名刺', S: 'オンデマンド', W: D(2), Z: D(-1), AI: '端物' });
setRow(9, { A: '済', D: '中澤', I: '★', J: 90, M: '22940-000', N: '古い学会', O: '古い紀要', S: 'CTP', T: '篠原', Z: D(-30), AG: D(-10), AI: '冊子' });
setRow(10, { A: '', D: '深澤', E: '★', M: '22985-000', N: '入稿予定の学会', O: '来月号', S: 'CTP', T: '篠原', W: D(40), Z: D(7), AA: D(14), AI: '冊子' });
setRow(11, { A: '済', D: '深澤', E: '★', M: '22986-000', N: '初校予定の学会', O: '今月号', S: 'CTP', T: '篠原', W: D(30), Z: D(-3), AA: D(4), AI: '冊子' });

console.log('--- 1回目の取込（生産表）---');
let r1 = api.importFromProductionSheet();
console.log(r1);
check('冊子7件が新規、端物1件は対象外', r1.added === 7 && r1.skipped === 1, r1);
const board = ss.getSheetByName('制作進行');
check('制作進行シートは左端に作られる（印刷進行ボードの取込先を奪わない）', ss.getSheets()[0].getName() === '制作進行');
check('案件は2行目から入る', board.cell(2, api.COL.KEY) === '22962-000', board.cell(2, 1));
check('未採番は仮キー', board.cell(5, api.COL.KEY) === '仮:港製作所|暑中見舞 冊子', board.cell(5, 1));
check('担当者：★も数値も担当（E=和泉→DTP, K=橋本→編集）', board.cell(2, api.COL.DTP) === '和泉' && board.cell(2, api.COL.EDIT) === '橋本', [board.cell(2, 6), board.cell(2, 7)]);
check('状態：初校戻りまで入っていれば校正中', board.cell(2, api.COL.STATUS) === '校正中', board.cell(2, 8));
check('直近の動き', board.cell(2, api.COL.RECENT) === '初校戻り 2026/09/04', board.cell(2, 14));
check('出力区分：T列 篠原 → オフ', board.cell(2, api.COL.OUTPUT) === 'オフ', board.cell(2, 12));
check('納期はT列に入る', board.cell(2, api.COL.DUE) === '2026/09/30', board.cell(2, 20));
check('状態：入稿だけなら作業中（AGが未来日でも下版済にしない）', board.cell(3, api.COL.STATUS) === '作業中', board.cell(3, 8));
check('AGの未来日は下版予定日として入る', board.cell(3, api.COL.GEHAN) === D(3), board.cell(3, 10));
check('出力区分：S列 オンデマンド → オンデ', board.cell(3, api.COL.OUTPUT) === 'オンデ', board.cell(3, 12));
check('AGが当日以前なら下版済＋完了日', board.cell(4, api.COL.STATUS) === '下版済' && board.cell(4, api.COL.DONE_DATE) === today, [board.cell(4, 8), board.cell(4, 19)]);
check('入稿日が空なら未入稿', board.cell(5, api.COL.STATUS) === '未入稿', board.cell(5, 8));
check('出力区分：S列 PDF → データ', board.cell(5, api.COL.OUTPUT) === 'データ', board.cell(5, 12));
check('派遣・磯網は編集', board.cell(6, api.COL.EDIT) === '派遣,磯網', board.cell(6, 7));
check('Z列が未来日（入稿予定）なら未入稿', board.cell(7, api.COL.STATUS) === '未入稿', board.cell(7, 8));
check('未入稿の直近の動きは入稿予定', board.cell(7, api.COL.RECENT) === '入稿予定 ' + D(7), board.cell(7, 14));
check('入稿済でAA列が未来日（初校提出予定）なら作業中', board.cell(8, api.COL.STATUS) === '作業中', board.cell(8, 8));
check('実績と予定を並べて出す', board.cell(8, api.COL.RECENT) === '入稿 ' + D(-3) + ' ／ 初校提出予定 ' + D(4), board.cell(8, 14));

console.log('--- 2回目の取込（差分なし）---');
let r2 = api.importFromProductionSheet();
check('新規0件・更新0件', r2.added === 0 && r2.updated === 0, r2);

console.log('--- 画面データ ---');
let data = api.getBoardData({ pin: 'seisaku-2026' });
check('更新権限あり（合言葉）', data.canEdit === true);
check('合言葉なしは閲覧のみ', api.getBoardData({}).canEdit === false);
check('直近の月曜より前に下版済の案件は出ない', !data.rows.find(r => r.key === '22940-000'), data.rows.map(r => r.key));
check('今日下版済の案件は完了として出る', data.rows.find(r => r.key === '22950-000').isDone === true);
check('6件表示（下版済の古い1件は出ない）', data.rows.length === 6, data.rows.length);
check('担当者の一覧と区分', data.staff.length === 8 && data.staff[0].name === '和泉' && data.staff[0].group === 'DTP' && data.staff[7].group === '編集');
check('編集者の名前候補は8名', data.editorNames.length === 8 && data.editorNames.indexOf('菅井') >= 0, data.editorNames);
check('週の範囲は月〜金', api.mondayOf_(today) === data.weekStart && api.addDays_(data.weekStart, 4) === data.weekEnd, [data.weekStart, data.weekEnd]);
const a = data.rows.find(r => r.key === '22962-000');
check('手動項目なし', a.manualFields.length === 0 && a.status === a.statusAuto);

console.log('--- 手動編集 ---');
let threw = '';
try { api.saveCase('22962-000', { status: '作業中' }, { pin: 'seisaku-2026' }); } catch (e) { threw = e.message; }
check('名前なしは保存できない', threw.indexOf('名前') >= 0, threw);
threw = '';
try { api.saveCase('22962-000', { status: '作業中', name: '和泉' }, { pin: 'wrong' }); } catch (e) { threw = e.message; }
check('間違った合言葉では書けない', threw.indexOf('権限') >= 0, threw);

let saved = api.saveCase('22962-000', { status: '作業中', gehanDate: '2026-09-20', output: 'オンデ', dtp: ['和泉', '高橋'], edit: ['橋本'], memo: '著者校待ち' }, PIN);
check('状態・日付・出力・担当が手動になる', saved.manualFields.join(',') === 'status,date,output,staff', saved.manualFields);
check('有効値は手動の値', saved.status === '作業中' && saved.gehan === '2026/09/20' && saved.output === 'オンデ' && saved.dtp.join(',') === '和泉,高橋', saved);
check('自動判定の値は残る（並べて表示できる）', saved.statusAuto === '校正中' && saved.gehanAuto === '' && saved.outputAuto === 'オフ' && saved.dtpAuto.join(',') === '和泉');
check('手動更新者・日時', saved.manualBy === '和泉' && !!saved.manualAt, [saved.manualBy, saved.manualAt]);
check('メモ', saved.memo === '著者校待ち');
check('シートの手動列に入る', board.cell(2, api.COL.STATUS_MANUAL) === '作業中' && board.cell(2, api.COL.GEHAN_MANUAL) === '2026/09/20' && board.cell(2, api.COL.DTP_MANUAL) === '和泉,高橋' && board.cell(2, api.COL.MANUAL_FIELDS) === 'status,date,output,staff');

// 生産表側が進んでも、手で直した項目は上書きされない
setRow(4, { AC: '2026/09/10' });
const r3 = api.importFromProductionSheet();
check('生産表の変更で更新1件', r3.updated === 1, r3);
let a2 = api.getBoardData(PIN).rows.find(r => r.key === '22962-000');
check('自動判定は追随する', a2.statusAuto === '校正中' && a2.recent === '再校提出 2026/09/10', [a2.statusAuto, a2.recent]);
check('手動の状態は残る', a2.status === '作業中' && a2.manualFields.indexOf('status') >= 0);
check('メモも残る', a2.memo === '著者校待ち');

// 自動と同じ値に戻すと手動が外れる
api.saveCase('22962-000', { status: '校正中', name: '橋本' }, PIN);
a2 = api.getBoardData(PIN).rows.find(r => r.key === '22962-000');
check('自動と同じ値にすると手動が解除される', a2.manualFields.indexOf('status') < 0 && a2.manualFields.indexOf('date') >= 0, a2.manualFields);
check('更新者が変わる', a2.manualBy === '橋本');

// 生産表に戻す
api.resetToProduction('22962-000', ['date'], PIN);
a2 = api.getBoardData(PIN).rows.find(r => r.key === '22962-000');
check('項目単位で生産表に戻せる', a2.manualFields.join(',') === 'output,staff' && a2.gehan === '', a2.manualFields);
api.resetToProduction('22962-000', 'all', PIN);
a2 = api.getBoardData(PIN).rows.find(r => r.key === '22962-000');
check('すべて生産表に戻す', a2.manualFields.length === 0 && a2.output === 'オフ' && a2.dtp.join(',') === '和泉', a2);
check('メモは戻しても残る', a2.memo === '著者校待ち');

// 手動で下版済にする → 完了日は今日、完了エリアに出る
api.saveCase('22962-000', { status: '下版済', name: '和泉' }, PIN);
a2 = api.getBoardData(PIN).rows.find(r => r.key === '22962-000');
check('手動で下版済にすると完了日が今日', a2.isDone && a2.doneDate === today, a2.doneDate);
api.importFromProductionSheet();
a2 = api.getBoardData(PIN).rows.find(r => r.key === '22962-000');
check('取込しても手動の下版済と完了日が残る', a2.isDone && a2.doneDate === today, a2);
api.resetToProduction('22962-000', 'all', PIN);
a2 = api.getBoardData(PIN).rows.find(r => r.key === '22962-000');
check('戻すと未完了に戻る', !a2.isDone && a2.doneDate === '', a2);

console.log('--- 受注番号が後から付いた案件の引き継ぎ ---');
api.saveCase('仮:港製作所|暑中見舞 冊子', { memo: '表紙は特色', name: '鈴木' }, PIN);
setRow(7, { M: '23010-000' });
const r4 = api.importFromProductionSheet();
check('得意先＋品名が一致する仮キーの行を引き継ぐ（新規0件）', r4.added === 0 && r4.migrated === 1, r4);
const mig = api.getBoardData(PIN).rows.find(r => r.key === '23010-000');
check('キーと受注番号が書き換わる', !!mig && mig.orderNo === '23010-000' && !mig.isTemp);
check('メモが引き継がれる', mig.memo === '表紙は特色');
check('仮キーの行は残らない', !api.getBoardData(PIN).rows.find(r => r.isTemp));

console.log('--- 手動で「同じ案件」と結びつける ---');
setRow(12, { D: '田邉', E: '★', M: '？？？', N: '新得意先', O: '新しい紀要', S: 'CTP', T: '篠原', W: D(40), AI: '冊子' });
api.importFromProductionSheet();
api.saveCase('仮:新得意先|新しい紀要', { memo: '仮の段階のメモ', output: 'データ', name: '和泉' }, PIN);
setRow(12, { M: '23020-000', N: '新得意先株式会社', O: '新しい紀要 第1号' });   // 名前が変わったので自動では引き継げない
const r5 = api.importFromProductionSheet();
check('名前が変わると自動では引き継がず新規になる', r5.added === 1 && r5.migrated === 0, r5);
const before = api.getBoardData(PIN).rows.length;
api.mergeCases('仮:新得意先|新しい紀要', '23020-000', PIN);
let rowsAfter = api.getBoardData(PIN).rows;
check('統合で1件減る', rowsAfter.length === before - 1, [before, rowsAfter.length]);
const merged = rowsAfter.find(r => r.key === '23020-000');
check('メモと手動修正が引き継がれる', merged.memo === '仮の段階のメモ' && merged.output === 'データ' && merged.manualFields.indexOf('output') >= 0, merged);
check('仮キーの行は消える', !rowsAfter.find(r => r.key === '仮:新得意先|新しい紀要'));
check('他の行が壊れない', rowsAfter.every(r => r.key && r.item) && new Set(rowsAfter.map(r => r.key)).size === rowsAfter.length);
threw = '';
try { api.mergeCases('23020-000', '23020-000', PIN); } catch (e) { threw = e.message; }
check('同じ案件どうしは統合できない', !!threw);

console.log('--- 紀要「進行中」シートの取込 ---');
// 実物の列（2026年9月）：A=論文名 B=著者 F=入稿日 K=組上がり L/M=初校 N/O=再校 P/Q=三校 R/S=念校
const kiyo = kss.insertSheet('進行中');
function kRow(row, cells) { Object.keys(cells).forEach(col => kiyo.set(row, C(col), cells[col])); }
kRow(1, { B: '著者名', F: '入稿日', G: '担当者', K: '組上がり', L: '初校', N: '再校', P: '三校', R: '念校', T: '備考' });
kRow(6, { A: '芸術学研究 第36号\n【22776-000】', G: '野沢' });
kRow(7, { A: '表1・4（和英目次）' });
kRow(9, { A: '戦時下上海で活躍したユダヤ難民の映画人たち（5）', B: 'ドメーニグ・ローランド', F: 710, I: 710, K: 713, L: 722, M: 902, N: 907 });
kRow(26, { A: '文芸研究158号\n【22962-000】', B: '7本' });
kRow(27, { A: '表紙', I: 815, K: 818, L: 818, N: 828, O: '責了' });
kRow(28, { A: '【タテ】武蔵国防人歌再読', B: '山崎健司', C: 100, F: 731, I: 731, K: 806, L: 810, M: 819, N: 818, O: 820, P: 821, Q: '校了' });
kRow(30, { A: 'The Nucleus and Its Placement in Welsh English', B: '新城真里奈', C: 20, F: 817, I: 817, K: 818, L: 818, M: 901, N: 902, O: 908, P: 908, Q: 909, R: '校了' });
kRow(31, { A: '光はそこに', B: '新本史斉', F: 731, I: 731, K: 806, L: 810, M: 818, N: 820 });
kRow(35, { A: '投稿規定', F: '0731' });
kRow(36, { A: '執筆者紹介' });
kRow(40, { A: '教養論集588', B: '10本・ヨコ組み', G: '野沢' });
kRow(41, { A: '表紙', I: 731, K: 803, L: 804, N: 821, O: '校了' });

const k1 = api.importFromKiyoSheet();
console.log(k1);
check('番号のある見出しの論文だけ取り込む（22776:2本 + 22962:6本）', k1.papers === 8 && k1.issues === 2, k1);
check('番号なしの見出しを報告する', k1.unlinked.length === 1 && k1.unlinked[0].indexOf('教養論集588') === 0, k1.unlinked);
const paper = kss.getSheetByName('論文明細') || ss.getSheetByName('論文明細');
check('論文明細は生産表側のスプレッドシートに作られる', !!ss.getSheetByName('論文明細') && !kss.getSheetByName('論文明細'));
data = api.getBoardData(PIN);
const bun = data.rows.find(r => r.key === '22962-000');
check('カードに論文が紐づく', bun.papers.length === 6, bun.papers.length);
const byTitle = {}; bun.papers.forEach(p => { byTitle[p.title] = p; });
check('責了は完了扱い', byTitle['表紙'].status === '責了');
check('校了は完了扱い（校了が念校の列にあっても）', byTitle['The Nucleus and Its Placement in Welsh English'].status === '校了');
check('一番右の日付の工程が状態', byTitle['光はそこに'].status === '再校提出', byTitle['光はそこに']);
check('年なしの日付に年を補う（820 → 8/20）', /^\d{4}\/08\/20$/.test(byTitle['光はそこに'].date), byTitle['光はそこに'].date);
const yr = Number(byTitle['光はそこに'].date.slice(0, 4)), thisYear = Number(today.slice(0, 4));
check('補った年は今日に近い方', Math.abs(yr - thisYear) <= 1, yr);
check('文字列の 0731 も読める', byTitle['投稿規定'].status === '入稿' && /\/07\/31$/.test(byTitle['投稿規定'].date), byTitle['投稿規定']);
check('日付が無い行は未提出', byTitle['執筆者紹介'].status === '未提出');
check('内訳の件数', bun.paperCounts['責了'] === 1 && bun.paperCounts['校了'] === 2 && bun.paperCounts['再校提出'] === 1 && bun.paperCounts['未提出'] === 1, bun.paperCounts);
check('内訳の並び順が返る', data.paperStatusOrder[0] === '未提出' && data.paperStatusOrder.indexOf('校了') > data.paperStatusOrder.indexOf('念校戻り'), data.paperStatusOrder);
const k2 = api.importFromKiyoSheet();
check('変更が無ければ書き換えない', k2.changed === false, k2);
kRow(36, { F: 905 });
const k3 = api.importFromKiyoSheet();
check('変更があれば書き換える', k3.changed === true && api.getBoardData(PIN).rows.find(r => r.key === '22962-000').paperCounts['入稿'] === 2, api.getBoardData(PIN).rows.find(r => r.key === '22962-000').paperCounts);

console.log('--- 紀要が読めなくても生産表の取込は止めない ---');
_props['KIYO_SS_ID'] = 'no-such-id';
const all = api.importAll();
check('生産表は取り込まれる', all.production && all.production.added === 0);
check('紀要のエラーが返る', all.kiyoError.indexOf('not found') >= 0, all.kiyoError);
check('画面にエラーが出せる', api.getBoardData(PIN).kiyoError.indexOf('not found') >= 0);
delete _props['KIYO_SS_ID'];
api.importAll();
check('復旧するとエラーが消える', api.getBoardData(PIN).kiyoError === '');
const imp = api.runImportNow(PIN);
check('画面用の取込メッセージ', imp.message.indexOf('取込完了') === 0 && imp.message.indexOf('紀要') >= 0, imp.message);

console.log('--- 担当者メモ ---');
api.setStaffNote('高橋', '※日本眼科医会（事務局代行業【磯網】）', PIN);
check('注記が返る', api.getBoardData(PIN).notes['高橋'] === '※日本眼科医会（事務局代行業【磯網】）');
api.setStaffNote('高橋', '※日本眼科医会', PIN);
const noteSheet = ss.getSheetByName('担当者メモ');
check('同じ人は上書き（行が増えない）', noteSheet.getLastRow() === 2 && api.getBoardData(PIN).notes['高橋'] === '※日本眼科医会', noteSheet.getLastRow());
api.setStaffNote('高橋', '', PIN);
check('空にすると消える', api.getBoardData(PIN).notes['高橋'] === '');

console.log('--- 最新月シートの判定 ---');
ss.insertSheet('メモ用');                                      // 右端に関係ないシートが増えても
check('「yyyy年M月」の一番右を選ぶ', api.latestProductionSheet_(ss).getName() === '2026年9月');
ss.insertSheet('2026年10月');
check('新しい月が増えたらそちらを読む', api.latestProductionSheet_(ss).getName() === '2026年10月');
ss.sheets = ss.sheets.filter(s => s.getName() !== '2026年10月' && s.getName() !== 'メモ用');

console.log('--- 列マッピング・診断 ---');
const diag = api.diagnoseImport();
check('診断が見出し（2・3行目）を出す', diag.indexOf('見出し 3行目：') >= 0 && diag.indexOf('M=受注番号') >= 0 && diag.indexOf('AG=下版日') >= 0);
check('診断が判定結果を出す', diag.indexOf('キー=「22962-000」') >= 0 && diag.indexOf('DTP=[和泉]') >= 0, diag.split('\n').slice(6, 9));
check('診断が件数を出す', /大分類が「冊子」の行数：\d+ 行/.test(diag));
const kd = api.diagnoseKiyo();
check('紀要の診断が見出し行を出す', kd.indexOf('見出しとして検出した行') >= 0 && kd.indexOf('受注番号 22962-000') >= 0 && kd.indexOf('番号なし') >= 0);
_props['SRC_COL_SALES'] = 'B';
api.importFromProductionSheet();
check('プロパティで列を変えられる', api.getBoardData(PIN).rows.find(r => r.key === '22962-000').sales === '', api.getBoardData(PIN).rows.find(r => r.key === '22962-000').sales);
_props['SRC_COL_SALES'] = 'D';
api.importFromProductionSheet();
check('戻せる', api.getBoardData(PIN).rows.find(r => r.key === '22962-000').sales === '深澤');
_props['STAFF_COLUMNS'] = 'E=和泉:DTP,K=橋本:DTP';
api.importFromProductionSheet();
check('担当者の列と区分もプロパティで変えられる', api.getBoardData(PIN).rows.find(r => r.key === '22962-000').dtp.join(',') === '和泉,橋本');
delete _props['STAFF_COLUMNS'];
api.importFromProductionSheet();
_props['OUTPUT_RULES'] = JSON.stringify([{ col: 'OUTPUT', match: 'CTP', label: 'オフ' }]);
api.importFromProductionSheet();
check('出力区分の判定表もプロパティで変えられる', api.getBoardData(PIN).rows.find(r => r.key === '22970-000').output === '');
delete _props['OUTPUT_RULES'];
api.importFromProductionSheet();

console.log('--- 日付の読み取り ---');
check('Date型', api.toDateString_(new Date(2026, 8, 4)) === '2026/09/04');
check('yyyy-MM-dd', api.toDateString_('2026-09-04') === '2026/09/04');
check('年なし M/d は近い年', /\/09\/04$/.test(api.toDateString_('9/4')));
check('紀要 731', /\/07\/31$/.test(api.parseKiyoDate_(731)));
check('紀要 1105', /\/11\/05$/.test(api.parseKiyoDate_(1105)));
check('紀要 校了 は日付でない', api.parseKiyoDate_('校了') === '');

console.log('--- チェックボックス事故の再発防止 ---');
check('データの最終行はA列で判断する', api.boardLastDataRow_(board) === board.getLastRow());
check('1000行目まで伸びていない', board.getLastRow() < 20, board.getLastRow());

console.log(fails === 0 ? '\nすべて成功' : `\n失敗 ${fails} 件`);
process.exit(fails === 0 ? 0 : 1);
