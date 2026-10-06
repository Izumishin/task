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
check('脚注の本文 (2段落目も・表の中の脚注も)', fnBuilt.footnotes.length === 3 && fnBuilt.footnotes[0].text === '一つ目の脚注。' && fnBuilt.footnotes[1].text === '二つ目の脚注\r二段落目' &&
      fnBuilt.footnotes[2].text === '表の中の脚注',
      JSON.stringify(fnBuilt.footnotes));
const fnSb = buildStoryText(fnBuilt.items);
const fnPos = fnSb.chars.filter(c => c.kind === 'footnote');
check('脚注の位置 (字下げの分もずらす)', fnPos.length === 2 && fnSb.text.substring(fnPos[0].start - 6, fnPos[0].start) === '本文の一文目' &&
      fnSb.text.substring(fnPos[1].start - 3, fnPos[1].start) === '二文目' && fnPos[0].footnote === 0 && fnPos[1].footnote === 1,
      JSON.stringify(fnPos));
const fnTbl = fnBuilt.items.find(x => x.role === 'table');
check('表の中の脚注は、セルの中の位置と脚注の番号を覚える (消さない)', fnTbl && fnTbl.cellRefs && fnTbl.table.rows[0][0] === '表の中' &&
      JSON.stringify(fnTbl.cellRefs[0][0]) === JSON.stringify([{ start: 3, len: 0, footnote: 2 }]) && !fnBuilt.warnings.some(w => w.indexOf('表の中') >= 0),
      JSON.stringify(fnTbl && { refs: fnTbl.cellRefs, rows: fnTbl.table.rows, w: fnBuilt.warnings }));
// 表の中の文末脚注 (《注》にまとめる形) と、本文・表の中の注番号の順番、表の中の表
const tnDoc = `<?xml version="1.0"?><w:document ${W}><w:body>${P('題目')}${P('１．はじめに', 'Heading1')}
<w:p><w:r><w:t>本文</w:t></w:r>${EN(1)}${FN(2)}</w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>セルA</w:t></w:r>${EN(3)}</w:p></w:tc><w:tc><w:p><w:r><w:rPr><w:i/></w:rPr><w:t>斜体</w:t></w:r>${FN(3)}<w:r><w:rPr><w:i/></w:rPr><w:t>続き</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:tbl><w:tr><w:tc><w:p><w:r><w:t>内側</w:t></w:r>${FN(4)}</w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>外の続き</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:t>表の後</w:t></w:r>${FN(5)}</w:p>${P('参考文献', 'Heading1')}${P('文献A')}<w:sectPr/></w:body></w:document>`;
const tnEnd = `<?xml version="1.0"?><w:endnotes ${W}><w:endnote w:id="1"><w:p><w:r><w:t>文末1</w:t></w:r></w:p></w:endnote><w:endnote w:id="3"><w:p><w:r><w:t>文末3</w:t></w:r></w:p></w:endnote></w:endnotes>`;
const tnFoot = `<?xml version="1.0"?><w:footnotes ${W}>${[2, 3, 4, 5].map(i => `<w:footnote w:id="${i}"><w:p><w:r><w:t>脚注${i}</w:t></w:r></w:p></w:footnote>`).join('')}</w:footnotes>`;
const tnBuilt = buildItems(readDocxManuscript(makeZip([['word/document.xml', tnDoc], ['word/endnotes.xml', tnEnd], ['word/footnotes.xml', tnFoot]]).toString('latin1')), prof);
const tnTbl = tnBuilt.items.find(x => x.role === 'table');
check('脚注の番号は本文・表の中を通して出てきた順', tnBuilt.footnotes.map(f => f.text).join(',') === '脚注2,脚注3,脚注5', tnBuilt.footnotes.map(f => f.text).join(','));
check('表の中の文末脚注は、本文と同じ書き方の注番号をセルに入れる', tnTbl && tnTbl.table.rows[0][0] === 'セルA' + _noteRef(2, prof) &&
      tnTbl.cellRefs[0][0][0].len === _noteRef(2, prof).length, JSON.stringify(tnTbl && tnTbl.table.rows));
check('表の中の脚注の位置と番号 (セルの中の飾りの位置はそのまま)', tnTbl && JSON.stringify(tnTbl.cellRefs[0][1]) === JSON.stringify([{ start: 2, len: 0, footnote: 1 }]) &&
      tnTbl.cellFmt[0][1].some(f => f.italic && f.start === 0 && f.end === 4), JSON.stringify(tnTbl && [tnTbl.cellRefs, tnTbl.cellFmt]));
check('表の中の表があっても、外の表の行・セルは崩れない', tnTbl && tnTbl.table.rows.length === 2 && tnTbl.table.rows[1][0] === '内側\r外の続き' && tnTbl.table.rows[1][1] === 'B',
      JSON.stringify(tnTbl && tnTbl.table.rows));
check('表の中の表の注は警告に出す', tnBuilt.warnings.some(w => w.indexOf('表の中の表') >= 0), JSON.stringify(tnBuilt.warnings));
check('表の中の文末脚注も《注》に入る', tnBuilt.items.filter(x => x.role === 'note').map(x => x.text.replace(/^.*?[\t　]/, '')).join(',').indexOf('文末3') >= 0,
      JSON.stringify(tnBuilt.items.filter(x => x.role === 'note').map(x => x.text)));
// 脚注の欄から番号の記号だけがコピーされたもの (w:footnoteRef が本文・表にある) は、番号を聞いて上付きの文字にする
const orDoc = `<?xml version="1.0"?><w:document ${W}><w:body>${P('題目')}${P('１．はじめに', 'Heading1')}
<w:tbl><w:tr><w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>境界年収</w:t></w:r><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/><w:b/><w:highlight w:val="yellow"/></w:rPr><w:footnoteRef/></w:r></w:p><w:p><w:r><w:t>（DM）</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>58,000</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:t>本文の記号</w:t></w:r><w:r><w:footnoteRef/></w:r><w:r><w:t>です。</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`;
const orZip = makeZip([['word/document.xml', orDoc]]).toString('latin1');
const asked = [];
ORPHAN_MARK_HOOK = (ctx, kind) => { asked.push(ctx); return asked.length === 1 ? '12' : null; };
const orMs = readDocxManuscript(orZip);
ORPHAN_MARK_HOOK = null;
const orBuilt = buildItems(orMs, prof);
const orTbl = orBuilt.items.find(x => x.role === 'table');
check('脚注ではない上付きの注番号は、前後の文字を示して番号を聞く', asked.length === 2 && asked[0] === '境界年収' && /本文の記号$/.test(asked[1]), JSON.stringify(asked));
check('聞いた番号を上付きの文字で入れる (表の中)', orTbl && orTbl.table.rows[0][0] === '境界年収12\r（DM）' &&
      orTbl.cellFmt[0][0].some(f => f.sup && f.start === 4 && f.end === 6), JSON.stringify(orTbl && [orTbl.table.rows[0], orTbl.cellFmt[0]]));
const orBody = orBuilt.items.find(x => /本文の記号/.test(x.text));
check('番号が分からないときは「*」を上付きで入れる (本文)', orBody && /本文の記号\*です。$/.test(orBody.text) && orBody.fmt.some(f => f.sup && orBody.text.substring(f.start, f.end) === '*'),
      JSON.stringify(orBody && [orBody.text, orBody.fmt]));
check('注番号の記号は脚注として数えない', orBuilt.footnotes.length === 0 && orMs.orphanMarks.length === 2);
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

// ---- 文字の飾り (イタリック・ルビなど) ----
console.log('character formatting:');
const R = (t, rpr) => `<w:r><w:rPr>${rpr}</w:rPr><w:t xml:space="preserve">${t}</w:t></w:r>`;
const T = t => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`;
const fmtStyles = `<?xml version="1.0"?><w:styles ${W}>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
<w:style w:type="character" w:styleId="Emph"><w:name w:val="Emphasis"/><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="character" w:styleId="MyEmph"><w:name w:val="独自の強調"/><w:basedOn w:val="Emph"/></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="EndnoteReference"><w:name w:val="endnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>
</w:styles>`;
const fmtDoc = `<?xml version="1.0"?><w:document ${W}><w:body>
<w:p><w:pPr><w:rPr><w:b/></w:rPr></w:pPr>${R('飾りの題目', '<w:b/>')}</w:p>
${P('１．はじめに', 'Heading1')}
<w:p>${T('雑誌')}${R('Nature', '<w:i/>')}${R(' Medicine', '<w:i/><w:b w:val="0"/>')}${EN(1)}${T('と')}${R('強調', '<w:rStyle w:val="MyEmph"/>')}${T('、')}${R('https://x.jp', '<w:rStyle w:val="Hyperlink"/>')}${T('、H')}${R('2', '<w:vertAlign w:val="subscript"/>')}${T('O、')}${R('大事', '<w:em w:val="dot"/>')}${T('、')}${R('下線', '<w:u w:val="single"/>')}${T('、')}<w:r><w:ruby><w:rubyPr/><w:rt>${T('けいざい')}</w:rt><w:rubyBase>${T('経済')}</w:rubyBase></w:ruby></w:r>${T('。')}</w:p>
<w:p>${T('本文')}${FN(5)}${T('。')}</w:p>
<w:sectPr/></w:body></w:document>`;
const fmtEnd = `<?xml version="1.0"?><w:endnotes ${W}><w:endnote w:id="1"><w:p><w:r><w:endnoteRef/></w:r>${T(' 注の中の')}${R('Cell', '<w:i/>')}${T('誌。')}</w:p></w:endnote></w:endnotes>`;
const fmtFoot = `<?xml version="1.0"?><w:footnotes ${W}><w:footnote w:id="5"><w:p><w:r><w:footnoteRef/></w:r>${T(' 一段落目')}</w:p><w:p>${R('Science', '<w:i/>')}${T('を参照。')}</w:p></w:footnote></w:footnotes>`;
const fmtFiles = { 'word/document.xml': fmtDoc, 'word/styles.xml': fmtStyles, 'word/endnotes.xml': fmtEnd, 'word/footnotes.xml': fmtFoot };
const fmtMs = readDocxParts(n => (fmtFiles[n] !== undefined ? fmtFiles[n] : null));
const fb = fmtMs.blocks.find(b => b.text.indexOf('雑誌') === 0);
const seg = f => fb.text.substring(f.start, f.end);
const got = fb.fmt.map(f => f.key + ':' + seg(f) + (f.ruby ? '(' + f.ruby + ')' : ''));
check('直接の書式・Word の文字スタイル・ルビを読む',
      JSON.stringify(got) === JSON.stringify(['italic:Nature Medicine', 'italic:強調', 'sub:2', 'kenten:大事', 'underline:下線', 'ruby:経済(けいざい)']),
      JSON.stringify(got));
check('ルビの文字は本文に入れない', fb.text.indexOf('けいざい') < 0 && fb.text.indexOf('経済') > 0, fb.text);
check('リンクの下線・段落記号の書式は飾りにしない', !got.some(g => g.indexOf('https') >= 0) && fmtMs.blocks[0].fmt.length === 1);

const fmtBuilt = buildItems(fmtMs, prof);
const fbody = fmtBuilt.items.find(x => x.role === 'body' && x.text.indexOf('雑誌') >= 0);
const segB = f => fbody.text.substring(f.start, f.end);
check('字下げ・注番号を入れても飾りの位置が合う', segB(fbody.fmt[0]) === 'Nature Medicine' && segB(fbody.fmt[1]) === '強調' &&
      fbody.text.indexOf('Nature Medicine（1）と') > 0 && segB(fbody.fmt[5]) === '経済', fbody.fmt.map(segB).join(','));
check('題目全体の太字は段落スタイルに任せて外す', (fmtBuilt.items.find(x => x.role === 'title').fmt || []).length === 0);
const fnote = fmtBuilt.items.find(x => x.role === 'note');
check('文末脚注の中のイタリックも位置が合う', fnote.text.substring(fnote.fmt[0].start, fnote.fmt[0].end) === 'Cell', JSON.stringify(fnote));
const ff = fmtBuilt.footnotes[0];
check('脚注の中のイタリック (2段落目) も位置が合う', ff.text === '一段落目\rScienceを参照。' && ff.text.substring(ff.fmt[0].start, ff.fmt[0].end) === 'Science',
      JSON.stringify(ff));
const fsb = buildStoryText(fmtBuilt.items);
check('流し込み用テキストでも飾りの位置が合う', fsb.chars.filter(c => c.kind === 'fmt').map(c => fsb.text.substr(c.start, c.len)).join(',') ===
      'Nature Medicine,強調,2,大事,下線,経済,Cell', fsb.chars.filter(c => c.kind === 'fmt').map(c => fsb.text.substr(c.start, c.len)).join(','));
const fcnt = countFmtCombos(fmtBuilt);
check('飾りの数 (本文・注・脚注)', fcnt.italic === 3 && fcnt['italic+ja'] === 1 && fcnt.ruby === 1 && fcnt.sub === 1 && fcnt.kenten === 1 && fcnt.underline === 1,
      JSON.stringify(fcnt));
const descs = [
  { name: '[なし]' }, { name: '【太ゴB101】', fontStyle: 'B101' }, { name: '欧文イタリック', fontStyle: 'Italic' },
  { name: '欧文ボールドイタリック', fontStyle: 'Bold Italic' }, { name: 'イタリック下線', fontStyle: 'Italic', underline: true },
  { name: '和文斜体', skew: 12 }, { name: '上付き', position: 'sup' }, { name: '圏点', kenten: true }, { name: '【ルビ】', ruby: true },
  { name: 'アンダーライン', underline: true }, { name: 'Bold', fontStyle: 'Bold' }
].map(d => Object.assign({ fontStyle: '', underline: false, position: '', kenten: false, strike: false, ruby: false, skew: 0 }, d));
const gm = guessComboStyleNames(['italic', 'italic+bold', 'italic+underline', 'italic+ja', 'sup', 'kenten', 'ruby', 'underline', 'bold', 'sub', 'italic+bold+ja'], descs);
check('組み合わせに合う文字スタイルを選ぶ', gm.italic === '欧文イタリック' && gm['italic+bold'] === '欧文ボールドイタリック' &&
      gm['italic+underline'] === 'イタリック下線' && gm['italic+ja'] === '和文斜体' && gm.sup === '上付き' && gm.kenten === '圏点' &&
      gm.ruby === '【ルビ】' && gm.underline === 'アンダーライン' && gm.bold === 'Bold', JSON.stringify(gm));
check('合うスタイルがない組み合わせは選ばない (和文の斜体＋太字・下付き)', !gm.sub && !gm['italic+bold+ja'], JSON.stringify(gm));
check('組み合わせの指定がなければ単独の飾りで代用 (上付き・下付き → 斜体 → 太字の順)',
      pickFmtStyleKey({ italic: true, bold: true }, { italic: 'x', bold: 'y' }) === 'italic' &&
      pickFmtStyleKey({ italic: true, sup: true }, { italic: 'x', sup: 'z' }) === 'sup' &&
      pickFmtStyleKey({ italic: true }, { bold: 'y' }) === null);
check('組み合わせの指定があればそれを使う', pickFmtStyleKey({ italic: true, bold: true }, { italic: 'x', 'italic+bold': 'xb' }) === 'italic+bold');
check('和文の斜体は欧文のイタリックで代用しない', pickFmtStyleKey({ italic: true, ja: true }, { italic: 'x' }) === null &&
      pickFmtStyleKey({ italic: true, bold: true, ja: true }, { 'italic+ja': 'ja' }) === 'italic+ja');

// ---- 斜体の和文・欧文の分け方 ----
console.log('japanese italic:');
const jt = 'Journal of 日本経済 Studies と';
const js = splitJaItalic([{ start: 0, end: jt.length - 2, italic: true, key: 'italic' }], jt);
check('斜体を欧文と和文に分ける (空白は前の部分に含める)',
      js.map(x => (x.ja ? 'ja:' : 'lat:') + jt.substring(x.start, x.end)).join('|') === 'lat:Journal of |ja:日本経済 |lat:Studies',
      js.map(x => (x.ja ? 'ja:' : 'lat:') + jt.substring(x.start, x.end)).join('|'));
check('和文の斜体の組み合わせ名', comboKey(js[1]) === 'italic+ja' && comboLabel('italic+ja') === '和文の斜体' &&
      comboLabel('italic+bold+ja') === '和文の斜体＋太字' && comboLabel('italic+underline') === 'イタリック＋下線');
check('斜体でない飾りは分けない', splitJaItalic([{ start: 0, end: 5, bold: true, key: 'bold' }], 'ab日本c').length === 1);

// ---- 全角英数字 → 半角、半角括弧 → 全角 ----
console.log('character conversions:');
const cvBuilt = { items: [
  { role: 'body', text: '　ＡＢＣ社の２０２０年(令和2年)[注]の報告 https://x.jp/a(1)b と mail@ex.jp(担当)' },
  { role: 'h1', text: '１．はじめに' },
  { role: 'table', table: { rows: [['Ｈ２Ｏ(水)']] } }
], footnotes: [{ text: '脚注の２件目(参考)' }] };
const hanProf = defaultProfile(); hanProf.charPref = { alnum: 'han', bracket: 'full' };
const convs0 = textConversions(cvBuilt, hanProf);
check('原稿の全角英数字・半角括弧を数える (URL・メールの中は数えない)',
      convs0.length === 2 && convs0[0].kind === 'zenAlnum' && convs0[0].count === 12 && convs0[1].kind === 'hanBracket' && convs0[1].count === 10 &&
      convs0[0].apply === true && convs0[1].apply === true, JSON.stringify(convs0));
convs0.forEach(c => applyTextConversion(cvBuilt, c, hanProf));
check('本文の置き換え (URL・メールアドレスの中はそのまま)',
      cvBuilt.items[0].text === '　ABC社の2020年（令和2年）［注］の報告 https://x.jp/a(1)b と mail@ex.jp（担当）', cvBuilt.items[0].text);
check('表のセル・脚注・見出しも置き換える', cvBuilt.items[2].table.rows[0][0] === 'H2O（水）' && cvBuilt.footnotes[0].text === '脚注の2件目（参考）' &&
      cvBuilt.items[1].text === '1．はじめに', JSON.stringify([cvBuilt.items[2].table.rows[0][0], cvBuilt.footnotes[0].text, cvBuilt.items[1].text]));
const zenProf = defaultProfile(); zenProf.headingDigits = 'zen'; zenProf.charPref = { alnum: 'zen', bracket: 'half' };
const zb = { items: [{ role: 'h1', text: '１．２０２０年の状況' }, { role: 'body', text: '２０２０年(x)' }], footnotes: [] };
const zc = textConversions(zb, zenProf);
check('前回号が全角英数字・半角括弧なら、初期値はチェックなし', zc.every(c => c.apply === false), JSON.stringify(zc));
applyTextConversion(zb, { kind: 'zenAlnum' }, zenProf);
check('見出し番号を全角で書く紀要では、見出しの番号は変えない', zb.items[0].text === '１．2020年の状況', zb.items[0].text);
const learnC = learnProfile([{ text: '題目' }, { text: '1．はじめに' }, { text: '　本文（注）はABCの2020年（x）と［y］である。https://a.jp/(1)' }]
  .map(x => Object.assign({ level: 0, style: 'S', runs: null }, x)));
check('前回号の英数字・括弧の書き方を学習する', learnC.charPref.alnum === 'han' && learnC.charPref.bracket === 'full', JSON.stringify(learnC.charPref));

// ---- 文字の飾りの対応表の記録 (次号のために InDesign ファイルに保存) ----
eval(src.match(/var FMT_LABEL[\s\S]*?\nfunction serializeSavedMap[\s\S]*?\n}\n/)[0]);
const savedStr = serializeSavedMap(parseSavedMap('italic\t欧文イタリック\nbold\t太字'), { italic: 'イタリック2', 'italic+ja': null }, { italic: 3, 'italic+ja': 1 });
const savedBack = parseSavedMap(savedStr);
check('選んだ内容を記録し、今回出なかった組み合わせの記録も残す', savedBack.italic === 'イタリック2' && savedBack['italic+ja'] === '' && savedBack.bold === '太字',
      JSON.stringify(savedBack));

// ---- 本文のファイル名が document.xml でない docx ----
console.log('docx variants:');
const rootRels = `<?xml version="1.0"?><Relationships xmlns="x"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document2.xml"/></Relationships>`;
const doc2Rels = `<?xml version="1.0"?><Relationships xmlns="x"><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles2.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes" Target="endnotes.xml"/><Relationship Id="rId9" Type="image" Target="../media/pic.png"/></Relationships>`;
const v2 = makeZip([
  ['_rels/.rels', rootRels], ['word\\document2.xml', docXml], ['word/_rels/document2.xml.rels', doc2Rels],
  ['word/styles2.xml', stylesXml], ['word/endnotes.xml', endXml], ['media/pic.png', png, true]
]);
let v2ms = null;
try { v2ms = readDocxManuscript(v2.toString('latin1')); } catch (e) { check('本文が document2.xml の docx を読む', false, e.message); }
if (v2ms) {
  check('本文が document2.xml の docx を読む (目次 _rels/.rels から探す)', v2ms.blocks.length === ms.blocks.length && Object.keys(v2ms.endnotes).length === 2);
  check('見出しスタイル (styles2.xml) も読む', v2ms.blocks.find(b => b.text === '１．はじめに').level === 1);
  check('画像の場所を本文からの相対パスで求める', joinZipPath(v2ms.docDir, v2ms.rels.rId9) === 'media/pic.png' &&
        zipEntryBinary(v2.toString('latin1'), v2ms.zipIndex, joinZipPath(v2ms.docDir, v2ms.rels.rId9)) === png.toString('latin1'));
}
check('パスのつなぎ方', joinZipPath('word', 'media/a.png') === 'word/media/a.png' && joinZipPath('word', '/x/y.png') === 'x/y.png' &&
      joinZipPath('', 'word/document.xml') === 'word/document.xml');
const upper = makeZip([['WORD/DOCUMENT.XML', docXml], ['word/styles.xml', stylesXml]]);
let upOk = false;
try { upOk = readDocxManuscript(upper.toString('latin1')).blocks.length === ms.blocks.length; } catch (e) {}
check('ファイル名の大文字・小文字の違いにも対応', upOk);
let notZip = '';
try { readDocxManuscript('これは docx ではありません'.repeat(10)); } catch (e) { notZip = e.message; }
check('docx でないファイルは分かるエラーにする', /ZIP|docx/.test(notZip), notZip);

// ---- Word の自動の箇条書き・段落番号 ----
console.log('word lists:');
const LV = (ilvl, fmt, text, extra) => `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/>${extra || ''}</w:lvl>`;
const numXml = `<?xml version="1.0"?><w:numbering ${W} xmlns:mc="mc">
<w:abstractNum w:abstractNumId="0">${LV(0, 'bullet', '\uF0B7')}${LV(1, 'bullet', 'o')}</w:abstractNum>
<w:abstractNum w:abstractNumId="1">${LV(0, 'decimal', '%1.')}${LV(1, 'decimal', '%1.%2', '<w:suff w:val="space"/>')}${LV(2, 'decimalFullWidth', '（%3）')}</w:abstractNum>
<w:abstractNum w:abstractNumId="2">${LV(0, 'aiueoFullWidth', '%1．')}</w:abstractNum>
<w:abstractNum w:abstractNumId="3">${LV(0, 'decimalEnclosedCircle', '%1', '<w:suff w:val="nothing"/>')}</w:abstractNum>
<w:abstractNum w:abstractNumId="4"><w:lvl w:ilvl="0"><w:start w:val="1"/><mc:AlternateContent><mc:Choice Requires="w14"><w:numFmt w:val="custom" w:format="001"/></mc:Choice><mc:Fallback><w:numFmt w:val="decimal"/></mc:Fallback></mc:AlternateContent><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
<w:num w:numId="3"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>
<w:num w:numId="4"><w:abstractNumId w:val="2"/></w:num>
<w:num w:numId="5"><w:abstractNumId w:val="4"/></w:num>
<w:num w:numId="6"><w:abstractNumId w:val="3"/></w:num>
<w:num w:numId="7"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;
const listStyles = `<?xml version="1.0"?><w:styles ${W}>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:numPr><w:numId w:val="5"/></w:numPr></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="ListP"><w:name w:val="List Paragraph"/></w:style>
</w:styles>`;
const LI = (numId, ilvl, body) => `<w:p><w:pPr><w:pStyle w:val="ListP"/><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>${body}</w:p>`;
const listDoc = `<?xml version="1.0"?><w:document ${W}><w:body>
${P('箇条書きのある論文')}${P('はじめに', 'Heading1')}${P('本文です。')}
${LI(1, 0, T('りんご'))}${LI(1, 0, T('みかん'))}${LI(1, 1, T('品種'))}
${LI(2, 0, T('データの収集'))}${LI(2, 0, T('分析') + R('手法', '<w:i/>') + EN(1))}${LI(2, 1, T('前処理'))}${LI(2, 2, T('詳細'))}
${LI(2, 0, T('考察'))}${LI(2, 1, T('要点'))}
${LI(3, 0, T('再開'))}${LI(7, 0, T('続き'))}
${LI(4, 0, T('一つ目'))}${LI(4, 0, T('二つ目'))}
${LI(6, 0, T('項目'))}${LI(6, 0, T('項目'))}
<w:p><w:pPr><w:pPrChange><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="6"/></w:numPr></w:pPr></w:pPrChange></w:pPr>${T('変更履歴の中の番号は付けない段落。')}</w:p>
<w:tbl><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid><w:tr><w:tc>${LI(6, 0, T('セル'))}</w:tc></w:tr></w:tbl>
${P('結論', 'Heading1')}${P('まとめです。')}
<w:sectPr/></w:body></w:document>`;
const listFiles = { 'word/document.xml': listDoc, 'word/styles.xml': listStyles, 'word/numbering.xml': numXml, 'word/endnotes.xml': fmtEnd };
const listMs = readDocxParts(n => (listFiles[n] !== undefined ? listFiles[n] : null));
const lb = listMs.blocks.filter(b => b.type === 'p').map(b => b.text);
const expectLabels = ['• りんご', '• みかん', 'o 品種', '1. データの収集', '2. 分析手法', '2.1 前処理', '（１）詳細', '3. 考察', '3.1 要点',
  '1. 再開', '2. 続き', 'ア．一つ目', 'イ．二つ目', '①項目', '②項目', '変更履歴の中の番号は付けない段落。'];
check('記号・番号を文字として入れる (入れ子・振り直し・続き・カナ・丸数字・記号の置き換え)',
      JSON.stringify(lb.slice(3, 3 + expectLabels.length)) === JSON.stringify(expectLabels), JSON.stringify(lb.slice(3, 3 + expectLabels.length)));
check('見出しスタイルに付いた自動番号も入れる', lb[1] === '1. はじめに' && lb.indexOf('2. 結論') >= 0, JSON.stringify([lb[1], lb[lb.length - 2]]));
check('表の中の番号も続きで入れる', JSON.stringify(listMs.blocks.find(b => b.type === 'table').rows) === JSON.stringify([['③セル']]),
      JSON.stringify(listMs.blocks.find(b => b.type === 'table').rows));
const bunseki = listMs.blocks.find(b => b.text === '2. 分析手法');
check('番号を入れても注番号・飾りの位置が合う', bunseki.refs[0].pos === '2. 分析手法'.length && bunseki.text.substring(bunseki.fmt[0].start, bunseki.fmt[0].end) === '手法',
      JSON.stringify([bunseki.refs, bunseki.fmt]));
const listBuilt = buildItems(listMs, prof);
const lr = x => listBuilt.items.find(it => it.text.indexOf(x) >= 0);
check('箇条書きは「箇条書き」の種類 (番号付きでも見出しにしない)', lr('データの収集').role === 'list' && lr('りんご').role === 'list' && lr('①項目').role === 'list',
      JSON.stringify(listBuilt.items.map(it => it.role + ':' + it.text)));
check('箇条書きには段落頭の全角スペースを付けない', lr('りんご').text === '• りんご' && lr('データの収集').text === '1. データの収集');
check('番号付きの見出しは見出しとして整える', lr('はじめに').role === 'h1' && lr('はじめに').text === '1．はじめに' && lr('結論').text === '2．結論',
      JSON.stringify([lr('はじめに'), lr('結論')].map(x => x.role + ':' + x.text)));
check('箇条書きのスタイルは名前から推測、なければ本文', initialStyleMap(prof, names.concat(['【11_箇条書き】9pt'])).list === '【11_箇条書き】9pt' &&
      initialStyleMap(prof, names).list === initialStyleMap(prof, names).body);
check('番号の形式', formatListNumber(3, 'upperRoman') === 'III' && formatListNumber(28, 'lowerLetter') === 'bb' && formatListNumber(21, 'decimalEnclosedCircle') === '㉑' &&
      formatListNumber(12, 'japaneseCounting') === '十二' && formatListNumber(2, 'iroha') === 'ロ' && formatListNumber(5, 'decimalZero') === '05' &&
      formatListNumber(3, 'ideographTraditional') === '丙' && formatListNumber(102, 'ideographDigital') === '一〇二' && formatListNumber(22, 'ordinal') === '22nd');

// ---- 下線・取り消し線の線種 ----
console.log('underline types:');
const uStyles = `<?xml version="1.0"?><w:styles ${W}>
<w:style w:type="character" w:styleId="U1"><w:name w:val="一重下線"/><w:rPr><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="U2"><w:name w:val="点線に変更"/><w:basedOn w:val="U1"/><w:rPr><w:u w:val="dotted"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="U3"><w:name w:val="下線なしに変更"/><w:basedOn w:val="U1"/><w:rPr><w:u w:val="none"/></w:rPr></w:style>
</w:styles>`;
const uTypes = ['single', 'words', 'double', 'thick', 'dotted', 'dottedHeavy', 'dash', 'dashLongHeavy', 'dotDash', 'dashDotDotHeavy', 'wave', 'wavyHeavy', 'wavyDouble'];
const uDoc = `<?xml version="1.0"?><w:document ${W}><w:body><w:p>` +
  uTypes.map((u, i) => T('＿') + R('線' + i, `<w:u w:val="${u}"/>`)).join('') +
  T('＿') + R('取消', '<w:strike/>') + T('＿') + R('二重取消', '<w:dstrike/>') +
  T('＿') + R('継承', '<w:rStyle w:val="U2"/>') + T('＿') + R('消去', '<w:rStyle w:val="U3"/>') +
  T('＿') + R('直接で消す', '<w:rStyle w:val="U1"/><w:u w:val="none"/>') +
  `</w:p><w:sectPr/></w:body></w:document>`;
const uMs = readDocxParts(n => (n === 'word/document.xml' ? uDoc : n === 'word/styles.xml' ? uStyles : null));
const ub = uMs.blocks[0], ugot = {};
ub.fmt.forEach(f => { ugot[ub.text.substring(f.start, f.end)] = f.key; });
const uWant = { '線0': 'underline', '線1': 'underline', '線2': 'uDouble', '線3': 'uThick', '線4': 'uDotted', '線5': 'uDotted', '線6': 'uDash',
  '線7': 'uDash', '線8': 'uDotDash', '線9': 'uDotDotDash', '線10': 'uWave', '線11': 'uWave', '線12': 'uWavyDouble',
  '取消': 'strike', '二重取消': 'dstrike', '継承': 'uDotted' };
check('Word の下線の線種・取り消し線を読み分ける (太さ違いは同じ種類)', Object.keys(uWant).every(k => ugot[k] === uWant[k]), JSON.stringify(ugot));
check('スタイルの受け継ぎ: 後で指定した線種・「下線なし」で置き換わる', ugot['継承'] === 'uDotted' && ugot['消去'] === undefined && ugot['直接で消す'] === undefined,
      JSON.stringify(ugot));
check('線種の名前', comboLabel('uDotted') === '下点線' && comboLabel('italic+uWave') === 'イタリック＋下波線' && comboKey({ italic: true, uWave: true }) === 'italic+uWave' &&
      comboLabel('dstrike') === '二重取り消し線' && comboLabel('italic+uDouble') === 'イタリック＋下二重線', comboLabel('italic+uDouble'));
check('InDesign の線の種類の名前 (日本語版・英語版) から線種を決める',
      strokeKindOf('点線') === 'dotted' && strokeKindOf('日本式点線') === 'dotted' && strokeKindOf('Dotted') === 'dotted' &&
      strokeKindOf('破線 (3 と 2)') === 'dash' && strokeKindOf('Dashed (4 and 4)') === 'dash' && strokeKindOf('波線') === 'wave' &&
      strokeKindOf('Wavy') === 'wave' && strokeKindOf('細-細') === 'double' && strokeKindOf('Thin - Thin') === 'double' &&
      strokeKindOf('実線', 2) === 'thick' && strokeKindOf('実線', 0.5) === 'single' && strokeKindOf('Solid') === 'single' && strokeKindOf('') === 'single');
const uDescs = [
  { name: '下線', underline: true, uTypeName: '実線', uWeight: 0.5 },
  { name: '下点線', underline: true, uTypeName: '点線' },
  { name: 'アンダーライン波', underline: true, uTypeName: 'Wavy' },
  { name: '二重', underline: true, uTypeName: '細-細' },
  { name: '太線', underline: true, uTypeName: '実線', uWeight: 2 },
  { name: '取り消し', strike: true, sTypeName: '実線' },
  { name: '二重取り消し', strike: true, sTypeName: '細-細' },
  { name: '点線イタリック', underline: true, uTypeName: 'Dotted', fontStyle: 'Italic' }
].map(d => Object.assign({ fontStyle: '', underline: false, position: '', kenten: false, strike: false, ruby: false, skew: 0, uTypeName: '', uWeight: -1, sTypeName: '' }, d));
const ug = guessComboStyleNames(['underline', 'uDotted', 'uWave', 'uDouble', 'uThick', 'strike', 'dstrike', 'italic+uDotted', 'uDash'], uDescs);
check('線種ごとに文字スタイルを選ぶ (ふつうの下線に点線のスタイルを選ばない)',
      ug.underline === '下線' && ug.uDotted === '下点線' && ug.uWave === 'アンダーライン波' && ug.uDouble === '二重' && ug.uThick === '太線' &&
      ug.strike === '取り消し' && ug.dstrike === '二重取り消し' && ug['italic+uDotted'] === '点線イタリック' && !ug.uDash, JSON.stringify(ug));
check('その線種のスタイルがなければ、ふつうの下線・取り消し線のスタイルで代用',
      pickFmtStyleKey({ uDash: true }, { underline: 'x' }) === 'underline' && pickFmtStyleKey({ dstrike: true }, { strike: 's' }) === 'strike' &&
      pickFmtStyleKey({ uDash: true }, { uDash: 'd', underline: 'x' }) === 'uDash' && pickFmtStyleKey(spanFromKey('uWave'), { underline: 'x' }) === 'underline');

// ---- 表の中の飾り・二点鎖線・蛍光ペン ----
console.log('table formatting:');
const TC = body => `<w:tc>${body}</w:tc>`;
const tDoc = `<?xml version="1.0"?><w:document ${W}><w:body>${P('表のある論文')}${P('１．はじめに', 'Heading1')}
<w:tbl><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid>
<w:tr>${TC('<w:p>' + R('場面', '<w:b/>') + '</w:p>')}${TC('<w:p>' + R('子どもの', '<w:b/>') + T('様子') + '</w:p>')}</w:tr>
<w:tr>${TC('<w:p>' + T('ユウキ：') + R('両手を', '<w:u w:val="single"/>') + T('上げる') + '</w:p><w:p>' + R('二段落目の点線', '<w:u w:val="dotted"/>') + '</w:p>')}
${TC('<w:p>' + R('跳びはねる', '<w:u w:val="dotDotDash"/>') + T('と') + R('寝そべる', '<w:u w:val="dotDash"/>') + R('Study 研究', '<w:i/>') + '</w:p>')}</w:tr>
</w:tbl>
<w:p>${T('本文の注')}${R('1)', '<w:vertAlign w:val="superscript"/><w:highlight w:val="yellow"/>')}${T('と')}${R('強調', '<w:highlight w:val="none"/>')}</w:p>
<w:sectPr/></w:body></w:document>`;
const tFiles = { 'word/document.xml': tDoc, 'word/styles.xml': stylesXml };
const tBuilt = buildItems(readDocxParts(n => (tFiles[n] !== undefined ? tFiles[n] : null)), prof);
const tItem = tBuilt.items.find(x => x.role === 'table');
const cellSeg = (r, c) => tItem.cellFmt[r][c].map(sp => comboKey(sp) + ':' + tItem.table.rows[r][c].substring(sp.start, sp.end));
check('表のセルの中の下線の線種 (二点鎖線・一点鎖線も区別)',
      JSON.stringify(cellSeg(1, 1)) === JSON.stringify(['uDotDotDash:跳びはねる', 'uDotDash:寝そべる', 'italic:Study ', 'italic+ja:研究']), JSON.stringify(cellSeg(1, 1)));
check('セルの中の2段落目の飾りも位置が合う', JSON.stringify(cellSeg(1, 0)) === JSON.stringify(['underline:両手を', 'uDotted:二段落目の点線']), JSON.stringify(cellSeg(1, 0)));
check('1行目のセル全体の太字は表の体裁に任せる (一部だけの太字は残す)', cellSeg(0, 0).length === 0 && JSON.stringify(cellSeg(0, 1)) === JSON.stringify(['bold:子どもの']),
      JSON.stringify([cellSeg(0, 0), cellSeg(0, 1)]));
const tCnt = countFmtCombos(tBuilt);
check('表の中の飾りも数に入れる', tCnt.uDotDotDash === 1 && tCnt.uDotDash === 1 && tCnt.uDotted === 1 && tCnt['sup+highlight'] === 1, JSON.stringify(tCnt));
check('蛍光ペン (「なし」は蛍光ペンにしない)', comboLabel('sup+highlight') === '上付き＋蛍光ペン' &&
      !tBuilt.items.find(x => x.role === 'body').fmt.some(f => f.highlight && !f.sup));
check('二点鎖線の線の名前', strokeKindOf('二点鎖線') === 'dotDotDash' && strokeKindOf('Dash Dot Dot') === 'dotDotDash' && strokeKindOf('一点鎖線') === 'dotDash' &&
      strokeKindOf('Dash Dot') === 'dotDash');
check('二点鎖線のスタイルがなければ 一点鎖線 → 下線 の順で代用',
      pickFmtStyleKey({ uDotDotDash: true }, { uDotDash: 'a', underline: 'b' }) === 'uDotDash' &&
      pickFmtStyleKey({ uDotDotDash: true }, { underline: 'b' }) === 'underline' && pickFmtStyleKey({ uDotDotDash: true }, { uDotDotDash: 'c', uDotDash: 'a' }) === 'uDotDotDash');

// ---- InDesign の正規表現の不具合 (「( )」で取り出した部分が空になる) でも動くか ----
console.log('regexp capture bug:');
function runPipeline() {
  const out = {};
  const m1 = readDocxParts(n => (files[n] !== undefined ? files[n] : null));
  const pr = learnProfile(oldParas);
  const b1 = buildItems(m1, pr);
  const fm = buildItems(readDocxParts(n => (fmtFiles[n] !== undefined ? fmtFiles[n] : null)), pr);
  const fnb = buildItems(readDocxParts(n => (fnFiles[n] !== undefined ? fnFiles[n] : null)), pr);
  textConversions(b1, pr).forEach(c => applyTextConversion(b1, c, pr));
  punctMismatches(b1, commaProf).forEach(c => unifyPunct(b1, c));
  out.profile = JSON.stringify([pr.styles, pr.variants, pr.headingDigits, pr.h1Sep, pr.h2Sep, pr.noteNumPad, pr.noteNumSep, pr.noteCont, pr.labels, pr.charPref]);
  out.items = JSON.stringify(b1.items.map(x => [x.role, x.text]));
  out.fmt = JSON.stringify(fm.items.map(x => [x.role, x.text, x.fmt]));
  out.fn = JSON.stringify([fnb.items.map(x => [x.role, x.text]), fnb.footnotes]);
  out.levels = JSON.stringify(m1.blocks.map(b => b.level));
  out.tables = JSON.stringify(buildItems(readDocxParts(n => (tFiles[n] !== undefined ? tFiles[n] : null)), pr).items.filter(x => x.role === 'table').map(x => x.cellFmt));
  out.lists = JSON.stringify(buildItems(readDocxParts(n => (listFiles[n] !== undefined ? listFiles[n] : null)), pr).items.map(x => [x.role, x.text]));
  if (process.env.KIYO_DOCX) out.real = JSON.stringify(buildItems(readDocxManuscript(fs.readFileSync(process.env.KIYO_DOCX).toString('latin1')), pr).items.map(x => [x.role, x.text]));
  return out;
}
const normalRun = runPipeline();
const origExec = RegExp.prototype.exec;
let buggyRun = null, buggyErr = null;
RegExp.prototype.exec = function (str) {
  const m = origExec.call(this, str);
  if (m) for (let q = 1; q < m.length; q++) m[q] = undefined;   // 取り出した部分をわざと空にする
  return m;
};
try { buggyRun = runPipeline(); } catch (e) { buggyErr = e; } finally { RegExp.prototype.exec = origExec; }
check('不具合のある環境でも止まらない', buggyErr === null, buggyErr && (buggyErr.stack || buggyErr.message));
if (buggyRun) {
  Object.keys(normalRun).forEach(k => check('不具合のある環境でも同じ結果: ' + k, buggyRun[k] === normalRun[k],
    k + ' が違う: ' + String(buggyRun[k]).slice(0, 200)));
}
check('見出しの番号の読み取り', JSON.stringify(readHeadingNumber('２．１　概観')) === JSON.stringify({ nums: ['２', '１'], numText: '２．１', sep: '　', punct: '', end: 4 }) &&
      readHeadingNumber('2020年の状況').sep === '' && readHeadingNumber('はじめに') === null && readHeadingNumber('1 . はじめに').end === 4,
      JSON.stringify(readHeadingNumber('２．１　概観')));
check('「2020年…」のような数字始まりの文は見出し番号として変えない', _normHeading('2020年の状況', 'h1', prof) === '2020年の状況');
check('括弧付きの番号の読み取り', JSON.stringify(readParenNumber('（\u20051\u2005）\t注', 0)) === JSON.stringify({ pad: '\u2005', digits: '1', after: '\t', end: 6 }) &&
      readParenNumber('（注）', 0) === null);

// ---- Word の数式 (OMML) ----
console.log('equations:');
const MR = (t, sty) => `<m:r>${sty ? `<m:rPr><m:sty m:val="${sty}"/></m:rPr>` : ''}<w:rPr><w:rFonts w:ascii="Cambria Math"/></w:rPr><m:t>${t}</m:t></m:r>`;
const SSUB = (e, s, sty) => `<m:sSub><m:sSubPr><m:ctrlPr/></m:sSubPr><m:e>${MR(e, sty)}</m:e><m:sub>${MR(s, sty)}</m:sub></m:sSub>`;
const OM = x => `<m:oMath>${x}</m:oMath>`;
const MW = W + ' xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
const mathDoc = `<?xml version="1.0"?><w:document ${MW}><w:body>
${P('数式のある論文')}${P('１．はじめに', 'Heading1')}
<w:p><w:r><w:t xml:space="preserve">Let </w:t></w:r>${OM(SSUB('A', 'i0', 'p'))}<w:r><w:t xml:space="preserve"> be (the) allowances and </w:t></w:r>${OM(MR('λ', 'p') + MR('&gt;0', 'p'))}<w:r><w:t>.</w:t></w:r></w:p>
<w:p><m:oMathPara><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr>${OM(SSUB('A', 'i1', 'p') + MR('=', 'p') + SSUB('A', 'i0', 'p') + MR('-', 'p') + SSUB('E', 'i', 'p'))}</m:oMathPara></w:p>
<w:p><m:oMathPara>${OM(MR('x') + MR('=') + '<m:f><m:num>' + MR('a+b') + '</m:num><m:den>' + MR('c') + '</m:den></m:f>')}</m:oMathPara></w:p>
<w:p><m:oMathPara>${OM('<m:sSubSup><m:e>' + MR('L', 'p') + '</m:e><m:sub>' + MR('i', 'p') + '</m:sub><m:sup>' + MR('N', 'p') + '</m:sup></m:sSubSup>' +
  MR('=', 'p') + SSUB('p', 't', 'p') + MR('max{0,', 'p') + '<m:acc><m:accPr><m:chr m:val="̂"/></m:accPr><m:e>' + MR('E', 'p') + '</m:e></m:acc>' + MR('-', 'p') + MR('1}', 'p'))}</m:oMathPara></w:p>
<w:p><m:oMathPara>${OM('<m:nary><m:naryPr><m:chr m:val="∑"/><m:limLoc m:val="undOvr"/></m:naryPr><m:sub>' + MR('t=1') + '</m:sub><m:sup>' + MR('T') + '</m:sup><m:e>' + MR('x') + '</m:e></m:nary>' +
  '<m:r><m:rPr><m:scr m:val="double-struck"/><m:sty m:val="p"/></m:rPr><m:t>E</m:t></m:r>' +
  '<m:r><m:rPr><m:nor/></m:rPr><m:t>Expected value</m:t></m:r>')}</m:oMathPara></w:p>
${P('本文の続きです。')}
<w:sectPr/></w:body></w:document>`;
const mathMs = readDocxManuscript(makeZip([['word/document.xml', mathDoc]]).toString('latin1'));
const mathBuilt = buildItems(mathMs, defaultProfile());
const mItems = mathBuilt.items;
const mText = it => unprotectMath(it.text);
const SP = ' ';
const inlineIt = mItems.find(it => /^Let /.test(mText(it)) || /Let /.test(mText(it)));
check('文中の数式が消えない', inlineIt && mText(inlineIt).indexOf('Let Ai0 be (the) allowances and λ' + SP + '>' + SP + '0.') >= 0, inlineIt && JSON.stringify(mText(inlineIt)));
const subSpan = inlineIt && inlineIt.fmt.find(f => f.sub);
const letIdx = inlineIt ? mText(inlineIt).indexOf('Ai0') : -1;
check('添字は下付き', subSpan && subSpan.start === letIdx + 1 && subSpan.end === letIdx + 3, JSON.stringify(inlineIt && inlineIt.fmt));
check('原稿で立体 (sty=p) の記号はイタリックにしない', inlineIt && !inlineIt.fmt.some(f => f.italic));
const mathRoles = mItems.filter(it => it.role === 'math');
check('別の行の数式は「数式 (別行)」', mathRoles.length === 4, mItems.map(i => i.role).join(','));
check('演算子の前後を四分アキにして、ハイフンはマイナスに', mathRoles[0] && mText(mathRoles[0]) === 'Ai1' + SP + '=' + SP + 'Ai0' + SP + '−' + SP + 'Ei', mathRoles[0] && JSON.stringify(mText(mathRoles[0])));
check('指定のない記号は Word と同じくイタリック', mathRoles[1] && mathRoles[1].fmt.some(f => f.italic && mText(mathRoles[1]).substring(f.start, f.end) === 'x'));
check('分数は「(分子)/分母」にして要仕上げ', mathRoles[1] && /\(a \+ b\)\/c$/.test(mText(mathRoles[1])) && mathRoles[1].mathComplex && mathRoles[1].mathComplex.length === 1,
      mathRoles[1] && JSON.stringify(mText(mathRoles[1])));
check('上付きと下付きが両方ある記号・ハット・max の前の空き', mathRoles[2] && mText(mathRoles[2]) === 'LiN' + SP + '=' + SP + 'pt max{0, Ê' + SP + '−' + SP + '1}',
      mathRoles[2] && JSON.stringify(mText(mathRoles[2])));
check('L の添字 i は下付き・N は上付き', mathRoles[2] && mathRoles[2].fmt.some(f => f.sub && f.start === 1 && f.end === 2) && mathRoles[2].fmt.some(f => f.sup && f.start === 2 && f.end === 3));
check('Σ の範囲は下付き・上付きで、別行なら要仕上げ。白抜きの E は 𝔼', mathRoles[3] && mText(mathRoles[3]).indexOf('∑t=1T x') === 0 &&
      mText(mathRoles[3]).indexOf('𝔼Expected value') > 0 && mathRoles[3].mathComplex && mathRoles[3].mathSpecial, mathRoles[3] && JSON.stringify(mText(mathRoles[3])));
const mc = countMath(mathBuilt);
check('数式の数を数える', mc.total === 6 && mc.display === 4 && mc.complex === 2, JSON.stringify(mc));
// 「半角括弧を全角に」でも数式の中の括弧は変えない
const convB = textConversions(mathBuilt, Object.assign(defaultProfile(), { charPref: { bracket: 'full' } })).find(c => c.kind === 'hanBracket');
check('数式の括弧は「半角括弧を全角に」の数に入れない', convB && convB.count === 2, JSON.stringify(convB));
applyTextConversion(mathBuilt, convB, defaultProfile());
check('数式の括弧は全角にならない (本文の括弧は全角になる)', /be （the） allowances/.test(mText(inlineIt)) && /\(a/.test(mText(mathRoles[1])) && /max\{0/.test(mText(mathRoles[2])));
const mSb = buildStoryText(mItems);
check('流し込む文字では数式の括弧が元に戻る', mSb.text.indexOf('') < 0 && mSb.text.indexOf('max{0,') > 0);
// Word で PDF にする式 (縦の分数・Σ のある別行の式) と、Word の数式の番号
check('本文の数式の数を数える (Word の OMaths と照らし合わせる)', mathMs.mathCount === 6, mathMs.mathCount);
check('PDF にする式は、縦の分数・Σ のある別行の式だけ (番号は本文の中の順番)',
      JSON.stringify(mItems.filter(it => it.mathPdfIdx).map(it => it.mathPdfIdx)) === JSON.stringify([[4], [6]]),
      JSON.stringify(mItems.filter(it => it.mathPdfIdx).map(it => it.mathPdfIdx)));
const numDoc = `<?xml version="1.0"?><w:document ${MW}><w:body>${P('題目')}${P('１．はじめに', 'Heading1')}
<w:p><m:oMathPara>${OM('<m:f><m:num>' + MR('a') + '</m:num><m:den>' + MR('b') + '</m:den></m:f>')}</m:oMathPara><w:r><w:tab/><w:t>(1)</w:t></w:r></w:p>
<w:p><w:r><w:t>本文</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`;
const numItems = buildItems(readDocxManuscript(makeZip([['word/document.xml', numDoc]]).toString('latin1')), defaultProfile()).items;
check('式番号などの文字がある段落は PDF にしない (文字の式＋付箋)', !numItems.some(it => it.mathPdfIdx) && numItems.some(it => it.mathComplex));
const enConv = textConversions({ items: [{ role: 'body', text: 'This is an English paper (2020) with brackets [1].', refs: [] }] }, Object.assign(defaultProfile(), { charPref: { bracket: 'full' } }));
check('英文の原稿では「半角括弧を全角に」の初期値はオフ', enConv.find(c => c.kind === 'hanBracket').apply === false);

// ---- 題目などを入れる別の枠の見分け ----
console.log('front box:');
const FP = arr => arr.map(x => Object.assign({ level: 0, runs: null, style: '' }, typeof x === 'string' ? { text: x } : x));
const realFront = FP([{ text: '幼児期の遊びに関する研究', style: '01_タイトル' }, { text: '―保育者の関わりから―', style: '02_副題' },
  { text: '山田　花子', style: '03_著者名' }, { text: '要　　旨', style: '04_要旨見出し' },
  { text: '　本研究は幼児期の遊びについて調べたものである。', style: '05_要旨' }, { text: 'キーワード：遊び，保育者', style: '06_キーワード' }]);
const genericFront = FP(['幼児期の遊びに関する研究', '―保育者の関わりから―', '山田　花子', '○○大学教育学部']);
const captionBox = FP(['図1　調査の流れ', '出典：筆者作成']);
const sideBox = FP(['コラム', '短いメモ書きです', 'もう一行']);
const memoBox = FP(['注意書き']);
const bodyLike = FP(['論文の題目', '1．はじめに', '　本文です。']);
check('題目・要旨・キーワードのある枠は題目の枠', frontScore(realFront) >= FRONT_MIN_SCORE, frontScore(realFront));
check('スタイル名がふつうでも題目・副題・著者・所属がそろえば題目の枠', frontScore(genericFront) >= FRONT_MIN_SCORE, frontScore(genericFront));
check('図の題・出典の枠は題目の枠にしない', frontScore(captionBox) < 0, frontScore(captionBox));
check('短い囲み記事の枠は題目の枠にしない', frontScore(sideBox) < FRONT_MIN_SCORE, frontScore(sideBox));
check('1行だけの枠は題目の枠にしない', frontScore(memoBox) < 0, frontScore(memoBox));
check('見出しのある枠は題目の枠にしない', frontScore(bodyLike) < FRONT_MIN_SCORE, frontScore(bodyLike));
check('柱・キャプションのスタイルの枠は題目の枠にしない', frontScore(FP([{ text: '幼児期の遊び', style: '柱' }, '山田'])) < 0);

// ---- 英文の論文の紙面 (本文の枠が Abstract から始まる) ----
console.log('english layout:');
const enBody = FP([{ text: 'Abstract', style: 'Abstract' }, { text: 'This study reviews the system.', style: 'Abstract' },
  { text: 'Keywords: Emissions, Allowances', style: 'Abstract' }, { text: '1. Introduction', style: '大見出し' },
  { text: 'An emissions trading system places a price on emissions.', style: '本文' }, { text: '2. Method', style: '大見出し' },
  { text: 'Body text.', style: '本文' }, { text: 'References', style: '大見出し' }, { text: 'Smith (2020).', style: '文献本文' }]);
check('最初にある Abstract は「残す部分」にしない', preserveStart(enBody) === -1, preserveStart(enBody));
const jaBody = FP([{ text: '１．はじめに', style: '大見出し' }, { text: '　本文です。', style: '本文' }, { text: '参考文献', style: '文献見出し' },
  { text: '山田（2020）', style: '文献本文' }, { text: 'Abstract', style: '英文要旨タイトル' }, { text: 'This paper...', style: 'Abstract本文' }]);
check('本文の後ろにある英文要旨は、これまでどおり残す', preserveStart(jaBody) === 4, preserveStart(jaBody));
const enRoles = classifySequence(enBody);
check('Abstract から始まるテキストは、要旨の見出し・要旨・キーワード・見出しと判定 (題目にしない)',
      enRoles.slice(0, 4).join(',') === 'abstractTitle,abstract,keywords,h1', enRoles.join(','));
check('ゼロ幅スペース付きの「Abstract」も要旨の見出し', RE_ABS_TITLE.test(trimWS('Abstract​')));
const enFront = FP([{ text: 'Accounting and Disclosure', style: 'タイトル' }, { text: 'Beyond the Net Liability Approach', style: 'サブタイトル' }, { text: 'Haku Ryu', style: '著者名' }]);
const fset = frontRoleSet(enFront);
check('題目の枠に要旨がない紙面では、要旨・キーワードは本文の枠に入れる', fset.title && fset.author && !fset['abstract'] && !fset.keywords && !fset.abstractTitle, JSON.stringify(fset));
const enSplit = splitFrontItems({ items: [{ role: 'title', text: 'T' }, { role: 'author', text: 'A' }, { role: 'blank', forRole: 'abstractTitle', text: '' },
  { role: 'abstractTitle', text: 'Abstract' }, { role: 'abstract', text: 'x' }, { role: 'keywords', text: 'Keywords: y' }, { role: 'h1', text: '1. I' }] }, fset);
check('題目と著者だけ題目の枠へ、Abstract からは本文の枠へ', enSplit.front.items.map(i => i.role).join(',') === 'title,author' &&
      enSplit.body.items.map(i => i.role).join(',') === 'abstractTitle,abstract,keywords,h1',
      enSplit.front.items.map(i => i.role).join(',') + ' / ' + enSplit.body.items.map(i => i.role).join(','));
const jaFrontSet = frontRoleSet(realFront);
check('題目の枠に要旨・キーワードがある紙面では、これまでどおり題目の枠に入れる', jaFrontSet['abstract'] && jaFrontSet.keywords && jaFrontSet.abstractTitle, JSON.stringify(jaFrontSet));
const zwDoc = `<?xml version="1.0"?><w:document ${W}><w:body>${P('An English Title')}${P('Haku Ryu')}${P('Abstract​')}${P('This study reviews the development.')}
${P('Keywords: Emissions, Allowances')}${P('')}${P('1. Introduction')}${P('An emissions trading system places a price.')}<w:sectPr/></w:body></w:document>`;
const zwItems = buildItems(readDocxManuscript(makeZip([['word/document.xml', zwDoc]]).toString('latin1')), defaultProfile()).items.filter(i => i.role !== 'blank');
check('原稿の「Abstract」+ゼロ幅スペースも要旨の見出しと判定し、要旨・キーワードも正しく判定',
      zwItems.map(i => i.role).slice(0, 6).join(',') === 'title,author,abstractTitle,abstract,keywords,h1', zwItems.map(i => i.role).join(','));

// ---- InDesign の古い JavaScript で使えない予約語 ----
console.log('ExtendScript:');
const reservedHits = require('./es3_reserved')(src);
check('予約語 (abstract など) を名前に使っていない', reservedHits.length === 0, reservedHits.join(' / '));

// 開発用: テスト用の原稿を .docx として書き出す (別の JavaScript エンジンでの確認用)
if (process.env.KIYO_DUMP) {
  fs.writeFileSync(path.join(process.env.KIYO_DUMP, 'sample.docx'), docxBuf);
  fs.writeFileSync(path.join(process.env.KIYO_DUMP, 'fmt.docx'), makeZip(Object.keys(fmtFiles).map(n => [n, fmtFiles[n]])));
  fs.writeFileSync(path.join(process.env.KIYO_DUMP, 'footnote.docx'), makeZip(Object.keys(fnFiles).map(n => [n, fnFiles[n]])));
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : '\n' + failures + ' TEST(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
