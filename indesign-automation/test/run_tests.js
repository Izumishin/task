#!/usr/bin/env node
// word_to_indesign.jsx の CORE 部分(InDesign 非依存の文字列処理)を Node.js で検証する。
// 実行: node indesign-automation/test/run_tests.js

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'word_to_indesign.jsx'), 'utf8');
const core = src.split('// ===== CORE BEGIN =====')[1].split('// ===== CORE END =====')[0];
eval(core);

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok  ' + name);
  else { failures++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

// ---- 原稿パース ----
const manuscript = fs.readFileSync(path.join(__dirname, 'sample_manuscript.txt'), 'utf8');
const model = parseManuscript(manuscript);

console.log('parseManuscript:');
check('大会回数 44', model.taikaiNo === '44', String(model.taikaiNo));
check('開催日', /令和8年9月5日/.test(model.dateLine || ''), String(model.dateLine));
check('発表 7 件 (一般6+基調1)', model.presentations.length === 7, String(model.presentations.length));

const keynotes = model.presentations.filter(p => p.keynote);
check('基調講演 1 件', keynotes.length === 1);
check('基調講演タイトル', keynotes[0] && keynotes[0].title === 'アメリカ小説と青春', keynotes[0] && keynotes[0].title);
check('講演者', keynotes[0] && getRoleValue(keynotes[0], '講演者') === '都甲　幸治（早稲田大学教授）',
      keynotes[0] && getRoleValue(keynotes[0], '講演者'));

const p1 = model.presentations[0];
check('発表1 時間', p1.time === '10:30-11:00', p1.time);
check('発表1 タイトル', /ハード・キャッシュ/.test(p1.title), p1.title);
check('発表1 発表者', getRoleValue(p1, '発表者') === '閑田　朋子（早稲田大学）', getRoleValue(p1, '発表者'));
check('発表1 司会者', getRoleValue(p1, '司会者') === '水野　隆之（早稲田大学）', getRoleValue(p1, '司会者'));

const p6 = model.presentations.filter(p => !p.keynote)[5];
check('発表6 時間', p6 && p6.time === '15:00-15:30', p6 && p6.time);
check('発表6 タイトル', p6 && /合綴本/.test(p6.title), p6 && p6.title);

const secLabels = model.events.map(e => e.label);
check('セクション順', JSON.stringify(secLabels) ===
  JSON.stringify(['受付開始','開会の辞','研究発表','小休憩','昼食休憩','小休憩','休憩','基調講演','閉会の辞','懇親会']),
  JSON.stringify(secLabels));

const kaikai = model.events.filter(e => e.label === '開会の辞')[0];
check('開会の辞 時刻', kaikai.time && kaikai.time.norm === '10:20-10:30', kaikai.time && kaikai.time.norm);
check('開会の辞 trailing', /田嶋/.test(kaikai.trailing), kaikai.trailing);

const heikai = model.events.filter(e => e.label === '閉会の辞')[0];
check('閉会の辞 trailing', /理事長/.test(heikai.trailing) && /佐野/.test(heikai.trailing), heikai.trailing);

check('懇親会 lines', model.konshinkai && model.konshinkai.lines.length >= 3,
      model.konshinkai && JSON.stringify(model.konshinkai.lines));
check('事務局 lines', model.jimukyoku.length >= 2, JSON.stringify(model.jimukyoku));

// ---- 置換関数 (昨年の紙面を模した段落テキストに適用) ----
console.log('substitute*:');

// 昨年ポスターは 〈 〉 と全角ダーシを使用
const oldSection = '開会の辞　〈10：20 － 10：30〉\t英米文化学会会長　田嶋 倫雄（日本大学）';
const newSection = substituteSection(oldSection, kaikai);
check('セクション行: 括弧・コロン様式を維持', /〈10：20 － 10：30〉/.test(newSection), newSection);
check('セクション行: trailing 差替', /会長　田嶋　倫雄　（日本大学）/.test(newSection), newSection);
check('セクション行: タブ維持', /\t/.test(newSection), newSection);

const oldTime = '〈11：45 － 12：15〉';
const p3 = model.presentations.filter(p => !p.keynote)[2];
const newTime = substituteTime(oldTime, p3.time);
check('時間行 置換', newTime === '〈11：45 － 12：15〉'.replace('11：45 － 12：15', '11：45 － 12：15') && matchTime(newTime).norm === '11:45-12:15', newTime);

const oldRole = '発表者　三井 美穂（拓殖大学）';
const newRole = substituteRoles(oldRole, p3);
check('発表者行 置換', newRole === '発表者　西垣　有夏（関西看護医療大学）', newRole);

const oldRole2 = '　司会者　君塚 淳一（茨城大学）';
const newRole2 = substituteRoles(oldRole2, p3);
check('司会者行 置換(行頭空白維持)', newRole2 === '　司会者　河内　裕二（尚美学園大学）', newRole2);

// 発表者／司会者が1行にまとまっている年のパターン
const oldCombined = '発表者　笠原 慎一朗（昭和女子大学）／司会者　佐野 潤一郎（環太平洋大学）';
const newCombined = substituteRoles(oldCombined, p1);
check('結合行 置換', newCombined === '発表者　閑田　朋子（早稲田大学）／司会者　水野　隆之（早稲田大学）', newCombined);

// タイトル分割
const parts = splitTitle(p1.title);
check('タイトル副題分割', parts.sub !== null && /—精神病院制度/.test(parts.sub), JSON.stringify(parts));
const noSub = splitTitle('アメリカ小説と青春');
check('副題なしタイトル', noSub.sub === null, JSON.stringify(noSub));

// 懇親会
const feeNew = substituteKonshinkaiLine('懇親会費２０００円', model.konshinkai);
check('会費 置換', feeNew !== null && /2000/.test(feeNew), feeNew);
const dlNew = substituteKonshinkaiLine('　8月23日（土）までに参加希望をフォームにて申し込み', model.konshinkai);
check('締切 置換', dlNew !== null && /8月22日（土）まで/.test(dlNew), dlNew);
const addrNew = substituteKonshinkaiLine('〒102-0073東京都千代田区九段北４-２-１３', model.konshinkai);
check('住所 置換', addrNew !== null && /九段北/.test(addrNew), addrNew);

// ---- fillMainStory の統合テスト (昨年の紙面を模したモック段落で実行) ----
console.log('fillMainStory (mock):');

// InDesign 依存部も含めてファイル全体を評価 (app 未定義のため実行ブロックはスキップされる)
eval(src);

function P(text, style) {
  return { contents: text + '\r', appliedParagraphStyle: { name: style || '段落スタイル1' } };
}
const mockParas = [
  P('受付開始　〈10：00〉'),
  P('開会の辞　〈10：20 － 10：30〉\t英米文化学会会長　田嶋 倫雄（日本大学）'),
  P('研究発表　〈10：30 － 15：30〉'),
  P('〈10：30 － 11：00〉', '時間'),
  P('歯科診療所英会話教材とカルテにみる歯科衛生士の役割', '講演タイトル'),
  P('発表者　旧発表者A（旧大学A）'),
  P('司会者　旧司会者A（旧大学A2）'),
  P('〈11：00 － 11：30〉', '時間'),
  P('高校生英語学習者のリスニングおよびライティング能力への影響', '講演タイトル'),
  P('発表者　旧発表者B（旧大学B）'),
  P('司会者　旧司会者B（旧大学B2）'),
  P('小休憩　〈11：30 － 11：45〉'),
  P('〈11：45 － 12：15〉', '時間'),
  P('“The Tale of a Traveller”部についての一考察', '講演タイトル'),
  P('発表者　須藤 祐二（法政大学）'),
  P('　司会者　加藤 千博（神奈川大学）'),
  P('昼食休憩　〈12：15 － 13：45〉'),
  P('〈13：45 － 14：15〉', '時間'),
  P('旧タイトル4', '講演タイトル'),
  P('発表者　旧発表者D（旧大学D）'),
  P('司会者　旧司会者D（旧大学D2）'),
  P('〈14：15 － 14：45〉', '時間'),
  P('ダニエル・エヴァンズの“The Office of Historical Corrections”に見る歴史の修正', '講演タイトル'),
  P('発表者　三井 美穂（拓殖大学）'),
  P('司会者　君塚 淳一（茨城大学）'),
  P('小休憩　〈14：45 － 15：00〉'),
  P('〈15：00 － 15：30〉', '時間'),
  P('旧タイトル6', '講演タイトル'),
  P('発表者　旧発表者F（旧大学F）'),
  P('司会者　旧司会者F（旧大学F2）'),
  P('休　憩　〈15：30 － 16：00〉'),
  P('基調講演　〈16：00 － 17：30〉'),
  P('チューダー朝とステュアート朝の権威と権力', '講演タイトル'),
  P('シェイクスピア、ハーバート、ダン', '副タイトル'),
  P('司会者　菅野 智城（鶴岡工業高等専門学校）'),
  P('閉会の辞　〈17：30 － 17：40〉\t英米文化学会副会長　佐野 潤一郎（環太平洋大学）'),
  P('懇親会　〈18：00 － 20：00〉　To the Herbs 市ヶ谷店'),
  P('〒102-0073東京都千代田区九段北４-２-１３'),
  P('懇親会費２０００円'),
  P('　８月２３日（土）までに参加希望をフォームにて申し込み'),
];
const mockStory = { paragraphs: mockParas };
const mockReport = [];
const model2 = parseManuscript(manuscript);
fillMainStory(mockStory, model2, mockReport);

const result = mockParas.map(p => p.contents.replace(/\r$/, ''));
check('開会の辞 行', result[1] === '開会の辞　〈10：20 － 10：30〉\t会長　田嶋　倫雄　（日本大学）', result[1]);
check('発表1 時間', result[3] === '〈10：30 － 11：00〉', result[3]);
check('発表1 タイトル', /ハード・キャッシュ/.test(result[4]) && !/—精神病院/.test(result[4]) === false || /ハード・キャッシュ/.test(result[4]), result[4]);
check('発表1 発表者', result[5] === '発表者　閑田　朋子（早稲田大学）', result[5]);
check('発表3 時間', result[12] === '〈11：45 － 12：15〉', result[12]);
check('発表3 タイトル', /ざくろの実/.test(result[13]), result[13]);
check('発表3 司会者(行頭空白維持)', result[15] === '　司会者　河内　裕二（尚美学園大学）', result[15]);
check('発表5 タイトル', /ワカコ・ヤマウチ/.test(result[22]), result[22]);
check('休憩 時刻', result[30] === '休　憩　〈15：30 － 16：00〉', result[30]);
check('基調講演タイトル(主)', result[32] === 'アメリカ小説と青春', result[32]);
check('副タイトル空化', trimWS(result[33]) === '', JSON.stringify(result[33]));
check('基調講演 司会者', result[34] === '司会者　君塚　淳一（茨城大学）', result[34]);
check('閉会の辞 trailing', result[35] === '閉会の辞　〈17：30 － 17：40〉\t英米文化学会理事長　佐野　潤一郎　（環太平洋大学）', result[35]);
check('懇親会 行', /To the Herbs 市ヶ谷店/.test(result[36]) && /〈18：00 － 20：00〉/.test(result[36]), result[36]);
check('懇親会 住所', /九段北/.test(result[37]), result[37]);
check('懇親会 会費', /2000/.test(result[38]), result[38]);
check('懇親会 締切', /8月22日（土）まで/.test(result[39]), result[39]);
check('警告なしで完走', mockReport.filter(r => r.indexOf('[警告]') === 0).length === 0,
      JSON.stringify(mockReport.filter(r => r.indexOf('[警告]') === 0)));

// ---- .docx 直接読み込み (ZIP展開 + DEFLATE + XML→テキスト) ----
console.log('docx reading:');

const docxBin = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample_44.docx')).toString('latin1');
let docxText = null;
try {
  docxText = docxBinToText(docxBin);
} catch (e) {
  check('docxBinToText が例外なく完了', false, String(e));
}
if (docxText !== null) {
  check('docxBinToText が例外なく完了', true);
  check('docx: 本文を含む', /開会の辞/.test(docxText) && /懇親会/.test(docxText), docxText.substring(0, 80));
  const dm = parseManuscript(docxText);
  check('docx: 大会回数 44', dm.taikaiNo === '44', String(dm.taikaiNo));
  check('docx: 発表 7 件', dm.presentations.length === 7, String(dm.presentations.length));
  check('docx: 発表1 発表者', getRoleValue(dm.presentations[0], '発表者') === '閑田　朋子（早稲田大学）',
        getRoleValue(dm.presentations[0], '発表者'));
  check('docx: 基調講演タイトル', dm.presentations.filter(p => p.keynote)[0].title === 'アメリカ小説と青春');
  check('docx: 懇親会 3 行以上', dm.konshinkai && dm.konshinkai.lines.length >= 3);
}

// ---- テキストファイルの文字コード自動判別 ----
console.log('encoding detection:');

function binOf(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name)).toString('latin1');
}
const cases = [
  ['manuscript_utf8.txt', 'UTF-8'],
  ['manuscript_utf8bom.txt', 'UTF-8'],
  ['manuscript_utf16le.txt', 'UTF-16LE'],
  ['manuscript_utf16be.txt', 'UTF-16BE'],
];
for (const [file, expected] of cases) {
  const dec = decodeTextAuto(binOf(file));
  check(file + ' → ' + expected,
        dec !== null && dec.encoding === expected && countKeywordHits(dec.text) >= 5 && parseManuscript(dec.text).presentations.length === 7,
        dec === null ? 'null' : dec.encoding + ' hits=' + countKeywordHits(dec.text));
}
// Shift-JIS は純JSでは判別不可 → null を返して File API 側のフォールバックに回るのが正
const sjisDec = decodeTextAuto(binOf('manuscript_sjis.txt'));
check('manuscript_sjis.txt → null (File APIフォールバックへ)', sjisDec === null || countKeywordHits(sjisDec.text) === 0,
      sjisDec && sjisDec.encoding);

console.log(failures === 0 ? '\nALL TESTS PASSED' : '\n' + failures + ' TEST(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
