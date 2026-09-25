#!/usr/bin/env node
// kiyo_nagashikomi.jsx の CORE 部分(InDesign 非依存)のテスト。
// 実行: node indesign-automation/test/kiyo_tests.js
// 実際の原稿でも確かめたいとき: KIYO_DOCX=原稿.docx node indesign-automation/test/kiyo_tests.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const src = fs.readFileSync(path.join(__dirname, '..', 'kiyo_nagashikomi.jsx'), 'utf8');
const core = src.split('// ===== CORE BEGIN =====')[1].split('// ===== CORE END =====')[0];
eval(core);

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok  ' + name);
  else { failures++; console.log('  FAIL ' + name + (detail !== undefined ? ' — ' + detail : '')); }
}

// ---- テスト用の架空の Word 原稿を組み立てる (未発表原稿をリポジトリに入れないため) ----
function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xFF;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function makeZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content, store] of files) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const comp = store ? data : zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(store ? 0 : 8, 8); lh.writeUInt32LE(crc32(data), 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(store ? 0 : 8, 10); ch.writeUInt32LE(crc32(data), 16);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="r" xmlns:a="a" xmlns:mc="mc"';
const P = (t, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
const EN = id => `<w:r><w:rPr><w:rStyle w:val="EndnoteReference"/></w:rPr><w:endnoteReference w:id="${id}"/></w:r>`;
const docXml = `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>
<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>サンプル論文の題目</w:t></w:r>${EN(1)}<w:r><w:br/></w:r><w:r><w:t>―副題の例―</w:t></w:r></w:p>
${P('')}${P('山田　　太郎')}${P('サンプル大学　経済学部　教授')}${P('')}${P('要旨')}${P('')}
${P('要旨の本文です。制度と産業の関係を論じる。')}${P('')}${P('キーワード：制度、産業')}${P('')}
${P('１．はじめに', 'Heading1')}
${P('1.1　 小節の見出し', 'Heading2')}
<w:p><w:pPr><w:pStyle w:val="NoSpacing"/></w:pPr><w:r><w:t>本文の最初の段落です</w:t></w:r>${EN(2)}<w:r><w:t>。続きの文です。</w:t></w:r></w:p>
<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="840"/></w:tabs></w:pPr><w:r><w:t>　すでに字下げのある段落</w:t></w:r><w:r><w:tab/><w:t>タブあり</w:t></w:r></w:p>
${P('表1　サンプルの表')}
<w:tbl><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="3000"/></w:tblGrid>
<w:tr><w:tc><w:p><w:r><w:t>年</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>内容</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>2020年</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>一行目</w:t></w:r></w:p><w:p><w:r><w:t>二行目</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>${P('出典：筆者作成')}${P('')}
${P('図1　サンプルの図')}
<w:p><w:r><mc:AlternateContent><mc:Choice><w:drawing><a:blip r:embed="rId9"/></w:drawing></mc:Choice><mc:Fallback><w:pict><w:t>重複</w:t></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>
${P('出典：筆者作成')}
${P('本文の続き。図の後の段落。')}
${P('おわりに', 'Custom1')}
${P('まとめの段落。')}
${P('参考文献', 'Heading1')}${P('（和文文献）')}${P('山田太郎（2020）『サンプルの本』')}${P('https://example.com/a')}${P('')}
${P('（英文文献）')}${P('Smith, J. (2019). Sample.')}
<w:sectPr/></w:body></w:document>`;
const endXml = `<?xml version="1.0"?><w:endnotes ${W}>
<w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote>
<w:endnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:endnote>
<w:endnote w:id="1"><w:p><w:r><w:endnoteRef/></w:r><w:r><w:t xml:space="preserve"> 題目に付けた注。</w:t></w:r></w:p></w:endnote>
<w:endnote w:id="2"><w:p><w:r><w:endnoteRef/></w:r><w:r><w:t xml:space="preserve"> 本文の注。</w:t></w:r></w:p><w:p><w:r><w:t>https://example.org/note</w:t></w:r></w:p></w:endnote>
</w:endnotes>`;
const stylesXml = `<?xml version="1.0"?><w:styles ${W}>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
<w:style w:type="paragraph" w:styleId="NoSpacing"><w:name w:val="No Spacing"/></w:style>
<w:style w:type="paragraph" w:styleId="Custom1"><w:name w:val="論文の見出し"/><w:basedOn w:val="Heading1"/></w:style>
</w:styles>`;
const relsXml = `<?xml version="1.0"?><Relationships xmlns="x"><Relationship Id="rId9" Type="image" Target="media/image1.png"/></Relationships>`;
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001', 'hex');
const docxBuf = makeZip([
  ['word/document.xml', docXml], ['word/endnotes.xml', endXml], ['word/styles.xml', stylesXml],
  ['word/_rels/document.xml.rels', relsXml], ['word/media/image1.png', png, true]
]);
const docxBin = docxBuf.toString('latin1');

// ---- docx の読み取り ----
console.log('readDocxManuscript:');
const ms = readDocxManuscript(docxBin);
const paras = ms.blocks.filter(b => b.type === 'p');
check('表を1つ読み取る', ms.blocks.filter(b => b.type === 'table').length === 1);
const tbl = ms.blocks.find(b => b.type === 'table');
check('表のセル (セル内の改行も保つ)', JSON.stringify(tbl.rows) === JSON.stringify([['年', '内容'], ['2020年', '一行目\r二行目']]), JSON.stringify(tbl.rows));
check('表の列幅', JSON.stringify(tbl.widths) === '[1000,3000]', JSON.stringify(tbl.widths));
check('文末脚注 2件 (区切り線は除く)', Object.keys(ms.endnotes).length === 2, Object.keys(ms.endnotes));
check('題目の注は題目の直後', paras[0].refs.length === 1 && paras[0].refs[0].pos === 'サンプル論文の題目'.length, JSON.stringify(paras[0].refs));
check('見出しレベル (heading 1 / heading 2 / heading 1 を元にした独自スタイル)',
      paras.find(p => p.text === '１．はじめに').level === 1 && paras.find(p => p.text.indexOf('1.1') === 0).level === 2 &&
      paras.find(p => p.text === 'おわりに').level === 1);
check('タブ位置の設定は無視し、本文のタブは残す', paras.some(p => p.text === '　すでに字下げのある段落\tタブあり'));
check('図の画像の参照', paras.some(p => p.image === 'rId9') && ms.rels.rId9 === 'media/image1.png');
check('互換用の重複データ(Fallback)は読まない', !paras.some(p => p.text.indexOf('重複') >= 0));
check('画像を取り出せる (無圧縮)', zipEntryBinary(docxBin, ms.zipIndex, 'word/media/image1.png') === png.toString('latin1'));

// 展開済みのフォルダから読む場合 (パソコンの展開機能を使う経路) も同じ結果になるか
const files = {
  'word/document.xml': docXml, 'word/endnotes.xml': endXml, 'word/styles.xml': stylesXml,
  'word/_rels/document.xml.rels': relsXml
};
const progress = [];
const msFolder = readDocxParts(name => (files[name] !== undefined ? files[name] : null), r => progress.push(r));
check('展開済みフォルダから読んでも同じ結果', JSON.stringify(msFolder.blocks) === JSON.stringify(ms.blocks) &&
      JSON.stringify(msFolder.endnotes) === JSON.stringify(ms.endnotes));
const bigXml = docXml.replace('<w:sectPr/>', new Array(3000).fill(P('進み具合の表示用の段落です。')).join('') + '<w:sectPr/>');
const prog2 = [];
readDocxParts(name => (name === 'word/document.xml' ? bigXml : files[name] !== undefined ? files[name] : null), r => prog2.push(r));
check('解析の進み具合を知らせる', prog2.length > 0 && prog2.every((r, i) => r > 0 && r <= 1 && (i === 0 || r >= prog2[i - 1])), prog2.length);

// ---- 前回号の紙面から体裁を学習する ----
console.log('learnProfile:');
const THIN = ' ';
const oldTexts = [
  ['前回の論文の題目（1）', '【01_タイトル】20pt', [[6, 9, '【注】相互参照（1桁）']]],
  ['―前回の副題―', '【02_副題】10.5pt', [[0, 1, '【全角ダーシ】'], [6, 7, '【全角ダーシ】']]],
  ['鈴木　　花子', '【03_著者名】12pt'], ['サンプル大学　法学部　准教授', '【03_著者名】12pt'],
  ['要　　旨', '【04_要旨タイトル】'], ['　前回の要旨の本文。', '【04_要旨】8pt'], ['', '【00_本文】9pt'],
  ['キーワード：前回、要旨', '【04_要旨】8pt', [[0, 6, '【太ゴB101】']]], ['', '【00_本文】9pt'],
  ['1．はじめに', '【06_大見出し】10.5pt'],
  ['　前回の本文です（2）。', '【00_本文】9pt', [[8, 11, '【注】相互参照（1桁）']]],
  ['　前回の本文の2段落目です。', '【00_本文】9pt'], ['', '【00_本文】9pt'],
  ['2．現状', '【06_大見出し】10.5pt_下中見出し'], ['2.1　概観', '【07_中見出し】9pt'],
  ['　2.1 の本文です。', '【00_本文】9pt'],
  ['表1　前回の表', '図表タイトル'], ['\u0016', '図表', null, true], ['出典：前回の出典', '図表注', [[0, 3, '【太ゴB101】']]],
  ['　表の後の本文。', '【00_本文】9pt_上アキ'], ['　普通の本文。', '【00_本文】9pt'], ['', '【00_本文】9pt'],
  ['3．おわりに', '【06_大見出し】10.5pt'], ['　最後の段落。', '【00_本文】9pt'], ['', '【00_本文】9pt'],
  ['《注》', '【09_注タイトル】8pt'],
  ['（' + THIN + '1' + THIN + '）\t前回の注1。', '【10_注本文】8pt'],
  ['（' + THIN + '2' + THIN + '）\t前回の注2。', '【10_注本文】8pt'],
  ['\t\t注2の続きの行', '【10_注本文】8pt'],
  ['（10）\t前回の注10。', '【10_注本文】8pt'], ['', '【00_本文】9pt'],
  ['参考文献', '【09_注タイトル】8pt'], ['（和文）', '【10_注本文】8pt'], ['前回の文献A', '【10_注本文】8pt'],
  ['\thttps://example.jp/a', '【10_注本文】8pt'], ['', '【10_注本文】8pt'],
  ['（英文）', '【10_注本文】8pt'], ['Old, R. (2000). Title.', '【10_注本文】8pt'], ['\thttps://example.jp/b', '【10_注本文】8pt']
];
const oldParas = oldTexts.map(([t, s, runs, isTable]) => ({
  text: isTable ? '' : t, style: s, level: 0, isTable: !!isTable, isImage: false,
  runs: runs ? runs.map(([a, b, n]) => ({ start: a, end: b, name: n })) : null
}));
const prof = learnProfile(oldParas);
check('本文のスタイル', prof.styles.body === '【00_本文】9pt', prof.styles.body);
check('題目・大見出し・中見出し・注のスタイル',
      prof.styles.title === '【01_タイトル】20pt' && prof.styles.h1 === '【06_大見出し】10.5pt' &&
      prof.styles.h2 === '【07_中見出し】9pt' && prof.styles.note === '【10_注本文】8pt', JSON.stringify(prof.styles));
check('要旨の見出しスタイル', prof.styles.abstractTitle === '【04_要旨タイトル】', prof.styles.abstractTitle);
check('図表のスタイル', prof.styles.figCaption === '図表タイトル' && prof.styles.table === '図表' && prof.styles.figSource === '図表注',
      JSON.stringify([prof.styles.figCaption, prof.styles.table, prof.styles.figSource]));
check('中見出しが続く大見出しの変化形', prof.variants['h1>h2'] === '【06_大見出し】10.5pt_下中見出し', JSON.stringify(prof.variants));
check('表の出典の後の本文の変化形', prof.variants['body<figSource'] === '【00_本文】9pt_上アキ', JSON.stringify(prof.variants));
check('段落頭の全角スペース', prof.bodyIndent === true && prof.abstractIndent === true);
check('見出しの番号は半角・区切りは「．」', prof.headingDigits === 'han' && prof.h1Sep === '．' && prof.h2Sep === '　');
check('注番号の空白は細い空白 (U+2005)', prof.noteNumPad === THIN, JSON.stringify(prof.noteNumPad));
check('注の続きの行は タブ2つ', prof.noteCont === '\t\t', JSON.stringify(prof.noteCont));
check('参考文献のURL行はタブ始まり', prof.refUrlTab === true);
check('見出しの表記', prof.labels.abstractTitle === '要　　旨' && prof.labels.noteTitle === '《注》' &&
      prof.labels.refTitle === '参考文献' && prof.labels.keywords === 'キーワード：', JSON.stringify(prof.labels));
check('文字スタイル (注番号・ダーシ・キーワード・出典)',
      prof.charStyles.noteRef === '【注】相互参照（1桁）' && prof.charStyles.dash === '【全角ダーシ】' &&
      prof.charStyles.keywordsLabel === '【太ゴB101】' && prof.charStyles.figSourceLabel === '【太ゴB101】', JSON.stringify(prof.charStyles));
check('空行の入れ方 (キーワード・大見出し・《注》・参考文献の前)',
      prof.blankBefore.keywords && prof.blankBefore.h1 && prof.blankBefore.noteTitle && prof.blankBefore.refTitle, JSON.stringify(prof.blankBefore));
check('（英文）の前の空行を学習 (見出し直後の（和文）は数えない)', prof.blankBefore.refSub === true);

// ---- 原稿を前回号の体裁で組み立てる ----
console.log('buildItems:');
const built = buildItems(ms, prof);
const its = built.items;
const byRole = r => its.filter(x => x.role === r);
const roleSeq = its.map(x => x.role).join(',');
check('題目と副題に分かれる', its[0].role === 'title' && its[1].role === 'subtitle' && its[1].text === '―副題の例―', roleSeq);
check('題目に注番号 (1)', its[0].text === 'サンプル論文の題目（1）', its[0].text);
check('著者名・所属', its[2].role === 'author' && its[3].role === 'affiliation');
check('要旨の見出しは前回号の表記', byRole('abstractTitle')[0].text === '要　　旨');
check('要旨の本文は字下げ', byRole('abstract')[0].text.charAt(0) === '　');
check('キーワードの前に空行', its[its.indexOf(byRole('keywords')[0]) - 1].role === 'blank');
check('大見出しの番号を半角に', byRole('h1')[0].text === '1．はじめに', byRole('h1')[0].text);
check('中見出しの区切りを「　」1つに', byRole('h2')[0].text === '1.1　小節の見出し', byRole('h2')[0].text);
check('本文に字下げと注番号 (2)', byRole('body')[0].text === '　本文の最初の段落です（2）。続きの文です。', byRole('body')[0].text);
check('もとから字下げのある段落は二重にしない', byRole('body')[1].text === '　すでに字下げのある段落\tタブあり', byRole('body')[1].text);
check('表・図・出典', byRole('table').length === 1 && byRole('figure').length === 1 && byRole('figSource').length === 2 && byRole('figCaption').length === 2);
check('独自の見出しスタイル「おわりに」も大見出し', byRole('h1').some(x => x.text === 'おわりに'));
const noteTitleIdx = its.indexOf(byRole('noteTitle')[0]), refTitleIdx = its.indexOf(byRole('refTitle')[0]);
check('注は参考文献の前にまとめる', noteTitleIdx >= 0 && noteTitleIdx < refTitleIdx);
check('注の番号の書き方', byRole('note')[0].text === '（' + THIN + '1' + THIN + '）\t題目に付けた注。', JSON.stringify(byRole('note')[0].text));
check('注の2段落目は続きの行として', byRole('note')[2].text === '\t\thttps://example.org/note', JSON.stringify(byRole('note')[2].text));
check('参考文献のURL行にタブ', byRole('ref').some(x => x.text === '\thttps://example.com/a'));
check('参考文献の小見出し', byRole('refSub').length === 2);
check('「参考文献」の直後には空行を入れない', its[refTitleIdx + 1].role === 'refSub');
check('（英文文献）の前には空行', its[its.indexOf(byRole('refSub')[1]) - 1].role === 'blank');

// ---- スタイルの決定 ----
console.log('styles:');
const names = ['［基本段落］', '【00_本文】9pt', '【00_本文】9pt_上アキ', '【01_タイトル】20pt', '【02_副題】10.5pt', '【03_著者名】12pt',
  '【04_要旨】8pt', '【04_要旨タイトル】', '【05_脚注】9pt', '【06_大見出し】10.5pt', '【06_大見出し】10.5pt_下中見出し', '【07_中見出し】9pt',
  '【08_小見出し】9pt', '【09_注タイトル】8pt', '【10_注本文】8pt', '図表タイトル', '図表注', '図表', '【00_Abstract_本文】10pt'];
const smap = initialStyleMap(prof, names);
check('学習したスタイルが優先', smap.body === '【00_本文】9pt' && smap.h2 === '【07_中見出し】9pt');
check('前回号になかった種類は名前から推測 (小見出し)', smap.h3 === '【08_小見出し】9pt', smap.h3);
check('図(画像)の段落は図表スタイル', smap.figure === '図表', smap.figure);
const empty = defaultProfile();
const guessMap = initialStyleMap(empty, names);
check('学習なしでも名前から推測', guessMap.title === '【01_タイトル】20pt' && guessMap.h1 === '【06_大見出し】10.5pt' &&
      guessMap.note === '【10_注本文】8pt' && guessMap.body === '【00_本文】9pt' && guessMap.abstract === '【04_要旨】8pt',
      JSON.stringify(guessMap));
const sn = resolveStyleNames(its, prof, smap);
const h1Idx = its.indexOf(byRole('h1')[0]);
check('中見出しが続く大見出しは変化形', sn[h1Idx] === '【06_大見出し】10.5pt_下中見出し', sn[h1Idx]);
const endingH1 = its.findIndex(x => x.text === 'おわりに');
check('本文が続く大見出しは通常のスタイル', sn[endingH1] === '【06_大見出し】10.5pt', sn[endingH1]);
const afterSrc = its.findIndex(x => x.text.indexOf('図の後の段落') >= 0);
check('出典の直後の本文は上アキの変化形', sn[afterSrc] === '【00_本文】9pt_上アキ', sn[afterSrc]);

// ---- 種類の変更 ----
const cp = JSON.parse(JSON.stringify(byRole('body')[0]));
changeRole(cp, 'h2', prof);
check('本文→中見出しで字下げを外す', cp.text.charAt(0) !== '　' && cp.role === 'h2', cp.text);
changeRole(cp, 'body', prof);
check('中見出し→本文で字下げを付ける', cp.text.charAt(0) === '　', cp.text);

// ---- 流し込み用テキスト ----
console.log('buildStoryText:');
const sb = buildStoryText(its);
check('段落数が一致', sb.text.split('\r').length === its.length);
check('注番号の位置が正しい', sb.chars.filter(c => c.kind === 'noteRef').every(c => /^（[0-9]+）$/.test(sb.text.substr(c.start, c.len))));
check('ダーシの位置が正しい', sb.chars.filter(c => c.kind === 'dash').every(c => sb.text.substr(c.start, c.len) === '―'));
check('「キーワード：」の位置が正しい', sb.chars.some(c => c.kind === 'keywordsLabel' && sb.text.substr(c.start, c.len) === 'キーワード：'));
const mapper = makeIndexMapper('a𠮷b（1）');
check('サロゲートペアの文字位置の補正', mapper(0) === 0 && mapper(3) === 2 && mapper(4) === 3);

// ---- 実際の原稿での確認 (任意) ----
if (process.env.KIYO_DOCX) {
  console.log('real manuscript:');
  const real = readDocxManuscript(fs.readFileSync(process.env.KIYO_DOCX).toString('latin1'));
  const rb = buildItems(real, prof), cnt = {};
  rb.items.forEach(x => { cnt[x.role] = (cnt[x.role] || 0) + 1; });
  console.log('   ', JSON.stringify(cnt), 'notes', rb.notes);
  check('実原稿: 注番号の位置', buildStoryText(rb.items).chars.filter(c => c.kind === 'noteRef').length === rb.notes);
}

// ---- 見出しの判定 (前回号のスタイル名・番号の形・段の繰り上げ) ----
console.log('headings:');
const romanOld = [
  { text: '前回の題目', style: '【01_タイトル】20pt' }, { text: '鈴木　花子', style: '【03_著者名】12pt' },
  { text: 'Ⅰ．序論', style: '【06_大見出し】12pt' }, { text: '　本文。', style: '【00_本文】10pt' },
  { text: '1.　問題の所在', style: '【07_中見出し】10pt' }, { text: '　本文。', style: '【00_本文】10pt' },
  { text: 'Ⅱ．分析', style: '【06_大見出し】12pt' }, { text: '　本文。', style: '【00_本文】10pt' }
].map(x => Object.assign({ level: 0, runs: null }, x));
const romanProf = learnProfile(romanOld);
check('前回号の見出しはスタイル名で判定 (大見出し→大見出し)', romanProf.styles.h1 === '【06_大見出し】12pt' && romanProf.styles.h2 === '【07_中見出し】10pt',
      JSON.stringify(romanProf.styles));
check('「Ⅰ．」「第1章」「第2節」「1-1」の形も見出し', headingDepthByText('Ⅰ．序論') === 1 && headingDepthByText('II. Method') === 1 &&
      headingDepthByText('第1章　背景') === 1 && headingDepthByText('第2節　方法') === 2 && headingDepthByText('1-1　対象') === 2);
check('ローマ数字で始まる英文は見出しにしない', headingDepthByText('It is known that.') === 0 && headingDepthByText('In this paper we') === 0);
// Word の「見出し 2」を最上位に使っている原稿
const h2only = [{ text: '題目', level: 0 }, { text: 'はじめにの前の本文ではない長い段落です。'.repeat(5), level: 0 },
  { text: '背景', level: 2 }, { text: '本文です。', level: 0 }, { text: '研究の方法', level: 2 }, { text: '対象', level: 3 }, { text: '本文です。', level: 0 }];
const h2roles = classifySequence(h2only);
check('最上位が「見出し 2」でも大見出しに繰り上げる', h2roles[2] === 'h1' && h2roles[4] === 'h1' && h2roles[5] === 'h2', h2roles.join(','));
check('繰り上げても「1.1」の番号の形は崩さない', _normHeading('1.1　 対象', 'h1', prof) === '1.1　対象', _normHeading('1.1　 対象', 'h1', prof));

// ---- Word の脚注 → InDesign の脚注 ----
console.log('footnotes:');
const FN = id => `<w:r><w:footnoteReference w:id="${id}"/></w:r>`;
const fnDoc = `<?xml version="1.0"?><w:document ${W}><w:body>
${P('脚注のある論文')}${P('１．はじめに', 'Heading1')}
<w:p><w:r><w:t>本文の一文目</w:t></w:r>${FN(2)}<w:r><w:t>。二文目</w:t></w:r>${FN(3)}</w:p>
<w:tbl><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>表の中</w:t></w:r>${FN(4)}</w:p></w:tc></w:tr></w:tbl>
${P('注・参考文献', 'Heading1')}${P('理論・方法・関連研究', 'Heading2')}${P('文献A（2020）')}${P('付録A：分析の手順', 'Heading1')}${P('付録の本文。')}
<w:sectPr/></w:body></w:document>`;
const fnXml = `<?xml version="1.0"?><w:footnotes ${W}>
<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>
<w:footnote w:id="2"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> 一つ目の脚注。</w:t></w:r></w:p></w:footnote>
<w:footnote w:id="3"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> 二つ目の脚注</w:t></w:r></w:p><w:p><w:r><w:t>二段落目</w:t></w:r></w:p></w:footnote>
<w:footnote w:id="4"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> 表の中の脚注</w:t></w:r></w:p></w:footnote>
</w:footnotes>`;
const fnFiles = { 'word/document.xml': fnDoc, 'word/footnotes.xml': fnXml, 'word/styles.xml': stylesXml };
const fnMs = readDocxParts(n => (fnFiles[n] !== undefined ? fnFiles[n] : null));
const fnBuilt = buildItems(fnMs, prof);
const fnBody = fnBuilt.items.find(x => x.role === 'body');
check('脚注は文字にせず位置だけ残す (注の欄も作らない)', fnBody.text === '　本文の一文目。二文目' && !fnBuilt.items.some(x => x.role === 'note' || x.role === 'noteTitle'),
      JSON.stringify(fnBuilt.items.map(x => x.role + ':' + x.text)));
check('脚注の本文 (2段落目も)', fnBuilt.footnotes.length === 2 && fnBuilt.footnotes[0].text === '一つ目の脚注。' && fnBuilt.footnotes[1].text === '二つ目の脚注\r二段落目',
      JSON.stringify(fnBuilt.footnotes));
const fnSb = buildStoryText(fnBuilt.items);
const fnPos = fnSb.chars.filter(c => c.kind === 'footnote');
check('脚注の位置 (字下げの分もずらす)', fnPos.length === 2 && fnSb.text.substring(fnPos[0].start - 6, fnPos[0].start) === '本文の一文目' &&
      fnSb.text.substring(fnPos[1].start - 3, fnPos[1].start) === '二文目' && fnPos[0].footnote === 0 && fnPos[1].footnote === 1,
      JSON.stringify(fnPos));
check('表の中の注は警告に出す', fnBuilt.warnings.some(w => w.indexOf('表の中') >= 0), JSON.stringify(fnBuilt.warnings));
const fnRoles = fnBuilt.items.map(x => x.role);
check('「注・参考文献」は参考文献の見出し、その中の見出しは小見出し、付録は大見出し',
      fnBuilt.items.find(x => x.text === '注・参考文献').role === 'refTitle' &&
      fnBuilt.items.find(x => x.text === '理論・方法・関連研究').role === 'refSub' &&
      fnBuilt.items.find(x => x.text === '文献A（2020）').role === 'ref' &&
      fnBuilt.items.find(x => x.text.indexOf('付録A') === 0).role === 'h1', fnRoles.join(','));

// ---- 段落スタイルの個別指定・大見出しと同じスタイルの防止 ----
const ovItems = JSON.parse(JSON.stringify(its));
ovItems[h1Idx].styleOverride = '【08_小見出し】9pt';
check('段落ごとに個別指定したスタイルを優先', resolveStyleNames(ovItems, prof, smap)[h1Idx] === '【08_小見出し】9pt');
const sameProf = defaultProfile(); sameProf.styles.h1 = '【06_大見出し】10.5pt'; sameProf.styles.h2 = '【06_大見出し】10.5pt';
check('中見出しが大見出しと同じスタイルなら、名前から中見出しのスタイルを探す', initialStyleMap(sameProf, names).h2 === '【07_中見出し】9pt',
      initialStyleMap(sameProf, names).h2);

// ---- 句読点の統一 ----
console.log('punctuation:');
const commaOld = [{ text: '前回の題目', style: 'T' }, { text: '1．はじめに', style: '【06_大見出し】' },
  { text: '　本研究は，制度と産業の関係を，三つの層から論じる．先行研究は，技術の面を，主に扱ってきた．', style: 'B' },
  { text: '　さらに，第2章では，事例を，検討する．M．J．Evans（1981）は，これを示した．', style: 'B' },
  { text: '　最後に，結論を述べる．', style: 'B' }
].map(x => Object.assign({ level: 0, runs: null }, x));
const commaProf = learnProfile(commaOld);
check('前回号は「，」と「．」', commaProf.punct.comma === '，' && commaProf.punct.period === '．', JSON.stringify(commaProf.punct));
const pBuilt = buildItems(readDocxParts(n => (files[n] !== undefined ? files[n] : null)), commaProf);
pBuilt.items.find(x => x.role === 'body').text = '　制度、産業、技術を論じる。1．5倍になった。';
pBuilt.items.find(x => x.role === 'table').table.rows[1][1] = '一、二。';
const mism = punctMismatches(pBuilt, commaProf);
check('原稿の「、」「。」を数える', mism.length === 2 && mism[0].from === '、' && mism[0].to === '，' && mism[1].from === '。' && mism[1].to === '．',
      JSON.stringify(mism));
const beforeRefs = JSON.stringify(buildStoryText(pBuilt.items).chars);
mism.forEach(m => unifyPunct(pBuilt, m));
check('本文・表のセルの句読点を置き換える', pBuilt.items.find(x => x.role === 'body').text === '　制度，産業，技術を論じる．1．5倍になった．' &&
      pBuilt.items.find(x => x.role === 'table').table.rows[1][1] === '一，二．', pBuilt.items.find(x => x.role === 'body').text);
check('置き換えても注番号などの位置はずれない', JSON.stringify(buildStoryText(pBuilt.items).chars) === beforeRefs);
// 逆向き (「．」→「。」) は日本語の文の終わりだけ
const toMaru = { kind: 'period', from: '．', to: '。' };
const bk = { items: [{ role: 'body', text: '1．はじめに。M．J．Evansは示した．数値は3．5である．' }], footnotes: [{ text: '脚注です．' }] };
unifyPunct(bk, toMaru);
check('「．」→「。」は文の終わりだけ (見出し番号・略称・小数はそのまま)', bk.items[0].text === '1．はじめに。M．J．Evansは示した。数値は3．5である。' && bk.footnotes[0].text === '脚注です。',
      bk.items[0].text);
check('前回号がどちらとも言えないときは聞かない', _dominant(10, 5, '、', '，') === null && _dominant(2, 0, '、', '，') === null);

// ---- 表の行数・列数の合わせ方 (端の行・列のセルスタイルを残す) ----
console.log('table resize:');
const resizeSrc = src.match(/function resizeKeepingEnds[\s\S]*?\n}\n/)[0];
const LocationOptions = { AFTER: 'after', BEFORE: 'before' };
eval(resizeSrc);
function mockTable(rowStyles, header, colStyles) {
  const t = { rows: [], columns: [], headerRowCount: header };
  rowStyles.forEach(st => t.rows.push({ style: st }));
  colStyles.forEach(st => t.columns.push({ style: st }));
  const wrap = (arr, key) => {
    arr.add = (loc, ref) => { const i = arr.indexOf(ref); arr.splice(loc === 'after' ? i + 1 : i, 0, { style: ref.style }); };
    arr.forEach(x => { x.remove = () => arr.splice(arr.indexOf(x), 1); });
    const origAdd = arr.add;
    arr.add = (loc, ref) => { origAdd(loc, ref); arr.forEach(x => { x.remove = () => arr.splice(arr.indexOf(x), 1); }); };
  };
  wrap(t.rows); wrap(t.columns);
  Object.defineProperty(t, 'bodyRowCount', {
    get() { return t.rows.length - t.headerRowCount; },
    set(v) { while (t.rows.length - t.headerRowCount < v) { t.rows.push({ style: t.rows[t.rows.length - 1].style }); } while (t.rows.length - t.headerRowCount > v) t.rows.pop(); t.rows.forEach(x => { x.remove = () => t.rows.splice(t.rows.indexOf(x), 1); }); }
  });
  Object.defineProperty(t, 'columnCount', {
    get() { return t.columns.length; },
    set(v) { while (t.columns.length < v) t.columns.push({ style: t.columns[t.columns.length - 1].style }); while (t.columns.length > v) t.columns.pop(); }
  });
  return t;
}
let mt = mockTable(['見出し行', '本文行', '本文行', '最終行'], 1, ['1列目', '列', '最終列']);
resizeKeepingEnds(mt, 6, 5);
check('行・列を増やしても最初と最後は残る', mt.rows.map(r => r.style).join(',') === '見出し行,本文行,本文行,本文行,本文行,本文行,最終行' &&
      mt.columns.map(c => c.style).join(',') === '1列目,列,列,列,最終列', mt.rows.map(r => r.style).join(',') + ' / ' + mt.columns.map(c => c.style).join(','));
mt = mockTable(['見出し行', '本文行', '本文行', '最終行'], 1, ['1列目', '列', '最終列']);
resizeKeepingEnds(mt, 1, 2);
check('行・列を減らしても最後の行・列は残る', mt.rows.map(r => r.style).join(',') === '見出し行,最終行' &&
      mt.columns.map(c => c.style).join(',') === '1列目,最終列', mt.rows.map(r => r.style).join(',') + ' / ' + mt.columns.map(c => c.style).join(','));

// ---- InDesign の古い JavaScript で使えない予約語 ----
console.log('ExtendScript:');
const reservedHits = require('./es3_reserved')(src);
check('予約語 (abstract など) を名前に使っていない', reservedHits.length === 0, reservedHits.join(' / '));

console.log(failures === 0 ? '\nALL TESTS PASSED' : '\n' + failures + ' TEST(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
