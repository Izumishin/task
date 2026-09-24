// kiyo_nagashikomi.jsx
// 紀要論文の自動組版スクリプト (Word 原稿 → 前回号の InDesign テンプレート)
//
// 使い方:
//   1. 前回号の InDesign ファイルのコピーを開く
//   2. 本文のテキストボックスを選択ツール(黒矢印)で選ぶ
//   3. このスクリプトを実行し、今回の Word 原稿(.docx)を選ぶ
//   4. 確認画面で見出しなどの判定を確かめて「流し込む」
//
// 前回号の紙面から、段落の種類ごとのスタイル・注番号の書き方・表の体裁などを
// 学習して、同じ体裁で今回の原稿を組みます。詳しくは README.md を参照。
// 対応: InDesign CS6〜2025 (Windows / Mac)

// ===== CORE BEGIN =====
// このセクションは InDesign に依存しない処理。Node.js のテスト (test/kiyo_tests.js) からも読み込む。
// bin: 1文字=1バイトのバイナリ文字列
function bcc(bin, i) { return bin.charCodeAt(i) & 0xFF; }
function u16at(bin, i) { return bcc(bin, i) | (bcc(bin, i + 1) << 8); }
function u32at(bin, i) {
  return (bcc(bin, i) | (bcc(bin, i + 1) << 8) | (bcc(bin, i + 2) << 16)) + bcc(bin, i + 3) * 16777216;
}

// --- DEFLATE 展開 (Mark Adler の puff アルゴリズムの移植) ---
function _infBits(st, n) {
  while (st.bitcnt < n) {
    // データ末尾を超えたら止める (壊れたファイルで無限ループにならないように)
    if (st.pos >= st.data.length) throw new Error("inflate: データが途中で終わっています");
    st.bitbuf |= bcc(st.data, st.pos++) << st.bitcnt;
    st.bitcnt += 8;
  }
  var val = st.bitbuf & ((1 << n) - 1);
  st.bitbuf >>>= n;
  st.bitcnt -= n;
  return val;
}

function _infConstruct(lengths, n) {
  var count = [], offs = [], symbol = [], i, len;
  for (len = 0; len <= 15; len++) count[len] = 0;
  for (i = 0; i < n; i++) count[lengths[i]]++;
  count[0] = 0;
  offs[1] = 0;
  for (len = 1; len < 15; len++) offs[len + 1] = offs[len] + count[len];
  for (i = 0; i < n; i++) if (lengths[i]) symbol[offs[lengths[i]]++] = i;
  // 9ビット以内の符号は表引きで一度に読めるようにする (1ビットずつ読むより大幅に速い)
  // fast[下位9ビット] = 記号 * 16 + 符号の長さ (0 は長い符号なので1ビットずつ読む)
  var fast = [], next = [], code = 0, bits, sym, L, c, r, b, k;
  for (k = 0; k < 512; k++) fast[k] = 0;
  count[0] = 0;
  for (bits = 1; bits <= 15; bits++) { code = (code + count[bits - 1]) << 1; next[bits] = code; }
  for (sym = 0; sym < n; sym++) {
    L = lengths[sym];
    if (!L) continue;
    c = next[L]++;
    if (L > 9) continue;
    r = 0;
    for (b = 0; b < L; b++) { r = (r << 1) | (c & 1); c >>= 1; }
    for (k = r; k < 512; k += (1 << L)) fast[k] = sym * 16 + L;
  }
  return { count: count, symbol: symbol, fast: fast };
}

// 表引きで1記号読む (読めなければ1ビットずつ)
function _infDecodeFast(st, h) {
  var data = st.data, e;
  while (st.bitcnt < 9 && st.pos < data.length) {
    st.bitbuf |= (data.charCodeAt(st.pos++) & 0xFF) << st.bitcnt;
    st.bitcnt += 8;
  }
  if (st.bitcnt >= 9) {
    e = h.fast[st.bitbuf & 511];
    if (e) { st.bitbuf >>>= (e & 15); st.bitcnt -= (e & 15); return e >> 4; }
  }
  return _infDecode(st, h);
}

function _infDecode(st, h) {
  var code = 0, first = 0, index = 0, len, count;
  for (len = 1; len <= 15; len++) {
    code |= _infBits(st, 1);
    count = h.count[len];
    if (code - first < count) return h.symbol[index + (code - first)];
    index += count;
    first += count;
    first <<= 1;
    code <<= 1;
  }
  throw new Error("inflate: 不正な符号");
}

var _LBASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
var _LEXT  = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
var _DBASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
var _DEXT  = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];

function _infCodes(st, lencode, distcode, out) {
  var sym, len, dist, from, k, e, n = out.length, data = st.data, dlen = data.length, lf = lencode.fast;
  for (;;) {
    // 文字/長さの記号 (よく出る短い符号はその場で表引き)
    while (st.bitcnt < 9 && st.pos < dlen) {
      st.bitbuf |= (data.charCodeAt(st.pos++) & 0xFF) << st.bitcnt;
      st.bitcnt += 8;
    }
    e = st.bitcnt >= 9 ? lf[st.bitbuf & 511] : 0;
    if (e) { st.bitbuf >>>= (e & 15); st.bitcnt -= (e & 15); sym = e >> 4; }
    else sym = _infDecode(st, lencode);
    if (sym < 256) { out[n++] = sym; }
    else if (sym === 256) return;
    else {
      sym -= 257;
      len = _LBASE[sym] + (_LEXT[sym] ? _infBits(st, _LEXT[sym]) : 0);
      sym = _infDecodeFast(st, distcode);
      dist = _DBASE[sym] + (_DEXT[sym] ? _infBits(st, _DEXT[sym]) : 0);
      from = n - dist;
      if (from < 0) throw new Error("inflate: 距離が範囲外");
      if (n > 50000000) throw new Error("inflate: 展開サイズが大きすぎます");
      for (k = 0; k < len; k++) out[n++] = out[from + k];
    }
  }
}

var _infFixedCache = null;
function _infFixedTrees() {
  if (_infFixedCache !== null) return _infFixedCache;
  var lengths = [], i;
  for (i = 0; i < 144; i++) lengths[i] = 8;
  for (; i < 256; i++) lengths[i] = 9;
  for (; i < 280; i++) lengths[i] = 7;
  for (; i < 288; i++) lengths[i] = 8;
  var lencode = _infConstruct(lengths, 288);
  lengths = [];
  for (i = 0; i < 30; i++) lengths[i] = 5;
  _infFixedCache = { lencode: lencode, distcode: _infConstruct(lengths, 30) };
  return _infFixedCache;
}

var _CLORDER = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];

function _infDynamicTrees(st) {
  var hlit = _infBits(st, 5) + 257;
  var hdist = _infBits(st, 5) + 1;
  var hclen = _infBits(st, 4) + 4;
  var lengths = [], i, sym, prev, rep;
  for (i = 0; i < 19; i++) lengths[i] = 0;
  for (i = 0; i < hclen; i++) lengths[_CLORDER[i]] = _infBits(st, 3);
  var lencode = _infConstruct(lengths, 19);
  lengths = [];
  while (lengths.length < hlit + hdist) {
    sym = _infDecodeFast(st, lencode);
    if (sym < 16) lengths[lengths.length] = sym;
    else {
      prev = 0; rep = 0;
      if (sym === 16) { prev = lengths[lengths.length - 1]; rep = 3 + _infBits(st, 2); }
      else if (sym === 17) rep = 3 + _infBits(st, 3);
      else rep = 11 + _infBits(st, 7);
      while (rep--) lengths[lengths.length] = prev;
    }
  }
  var lit = lengths.slice(0, hlit);
  var dst = lengths.slice(hlit);
  return { lencode: _infConstruct(lit, hlit), distcode: _infConstruct(dst, hdist) };
}

// DEFLATE ストリーム(バイナリ文字列)を展開してバイト値の配列を返す
function inflateRaw(data) {
  var st = { data: data, pos: 0, bitbuf: 0, bitcnt: 0 };
  var out = [], bfinal, btype, len, i, trees;
  do {
    bfinal = _infBits(st, 1);
    btype = _infBits(st, 2);
    if (btype === 0) {
      // 先読みしたバイトを戻し、途中のビットは捨てる
      st.pos -= Math.floor(st.bitcnt / 8);
      st.bitbuf = 0; st.bitcnt = 0;
      len = u16at(st.data, st.pos); st.pos += 4; // len + nlen
      for (i = 0; i < len; i++) out[out.length] = bcc(st.data, st.pos++);
    } else if (btype === 1) {
      trees = _infFixedTrees();
      _infCodes(st, trees.lencode, trees.distcode, out);
    } else if (btype === 2) {
      trees = _infDynamicTrees(st);
      _infCodes(st, trees.lencode, trees.distcode, out);
    } else {
      throw new Error("inflate: 不正なブロック種別");
    }
  } while (!bfinal);
  return out;
}


// --- 文字コード変換 ---

// バイト配列を UTF-8 として厳密にデコード。不正なら null
function utf8DecodeBytes(bytes) {
  var units = [], i = 0, n = bytes.length, b, cp, extra, k;
  while (i < n) {
    b = bytes[i++];
    if (b < 0x80) { units[units.length] = b; continue; }
    if (b >= 0xC2 && b <= 0xDF) { extra = 1; cp = b & 0x1F; }
    else if (b >= 0xE0 && b <= 0xEF) { extra = 2; cp = b & 0x0F; }
    else if (b >= 0xF0 && b <= 0xF4) { extra = 3; cp = b & 0x07; }
    else return null;
    for (k = 0; k < extra; k++) {
      if (i >= n) return null;
      b = bytes[i++];
      if ((b & 0xC0) !== 0x80) return null;
      cp = (cp << 6) | (b & 0x3F);
    }
    if (cp > 0xFFFF) {
      cp -= 0x10000;
      units[units.length] = 0xD800 + (cp >> 10);
      units[units.length] = 0xDC00 + (cp & 0x3FF);
    } else units[units.length] = cp;
  }
  return unitsToString(units);
}

function unitsToString(units) {
  var parts = [], i, j, chunk = 1024, piece;
  for (i = 0; i < units.length; i += chunk) {
    try {
      parts[parts.length] = String.fromCharCode.apply(null, units.slice(i, i + chunk));
    } catch (e) {
      // apply の引数数に制限がある環境向けに1文字ずつ組み立てる
      piece = [];
      for (j = i; j < units.length && j < i + chunk; j++) piece[piece.length] = String.fromCharCode(units[j]);
      parts[parts.length] = piece.join("");
    }
  }
  return parts.join("");
}

function decodeXmlEntities(s) {
  if (s.indexOf("&") < 0) return s;
  s = s.replace(/&#x([0-9A-Fa-f]+);/g, function (m0, h) { return String.fromCharCode(parseInt(h, 16)); });
  s = s.replace(/&#([0-9]+);/g, function (m0, d) { return String.fromCharCode(parseInt(d, 10)); });
  s = s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  return s;
}


// ------------------------------------------------------------
// .docx の読み取り (本文・表・図・文末脚注/脚注・Word の見出しスタイル)
// ------------------------------------------------------------

// ZIP の中央ディレクトリを読んで、名前 → エントリ情報 の表を作る
function zipIndex(bin) {
  var i = bin.length - 22, eocd = -1;
  var stop = bin.length - 22 - 65558; if (stop < 0) stop = 0;
  for (; i >= stop; i--) {
    if (bcc(bin, i) === 0x50 && bcc(bin, i + 1) === 0x4B && bcc(bin, i + 2) === 0x05 && bcc(bin, i + 3) === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Word(.docx)ファイルではないようです (ZIP形式ではありません)");
  var n = u16at(bin, eocd + 10), ofs = u32at(bin, eocd + 16), e, idx = {};
  var method, csize, usize, nameLen, extraLen, cmtLen, localOfs, name, dataOfs;
  for (e = 0; e < n; e++) {
    if (u32at(bin, ofs) !== 0x02014B50) throw new Error("docx の中身が壊れています");
    method = u16at(bin, ofs + 10);
    csize = u32at(bin, ofs + 20);
    usize = u32at(bin, ofs + 24);
    nameLen = u16at(bin, ofs + 28);
    extraLen = u16at(bin, ofs + 30);
    cmtLen = u16at(bin, ofs + 32);
    localOfs = u32at(bin, ofs + 42);
    name = bin.substring(ofs + 46, ofs + 46 + nameLen);
    dataOfs = localOfs + 30 + u16at(bin, localOfs + 26) + u16at(bin, localOfs + 28);
    idx[name] = { method: method, csize: csize, usize: usize, dataOfs: dataOfs };
    ofs += 46 + nameLen + extraLen + cmtLen;
  }
  return idx;
}

// エントリをバイナリ文字列 (1文字=1バイト) で取り出す
function zipEntryBinary(bin, idx, name) {
  var ent = idx[name];
  if (!ent) return null;
  var raw = bin.substring(ent.dataOfs, ent.dataOfs + ent.csize);
  if (ent.method === 0) return raw;
  if (ent.method !== 8) throw new Error("未対応の圧縮方式: " + ent.method);
  var bytes = inflateRaw(raw), parts = [], i, j, piece, chunk = 1024;
  for (i = 0; i < bytes.length; i += chunk) {
    piece = [];
    for (j = i; j < bytes.length && j < i + chunk; j++) piece[piece.length] = String.fromCharCode(bytes[j]);
    parts[parts.length] = piece.join("");
  }
  return parts.join("");
}

// エントリを UTF-8 テキストとして取り出す
function zipEntryText(bin, idx, name) {
  var ent = idx[name];
  if (!ent) return null;
  var raw = bin.substring(ent.dataOfs, ent.dataOfs + ent.csize), bytes, k;
  if (ent.method === 8) bytes = inflateRaw(raw);
  else if (ent.method === 0) { bytes = []; for (k = 0; k < raw.length; k++) bytes[k] = bcc(raw, k); }
  else throw new Error("未対応の圧縮方式: " + ent.method);
  var s = utf8DecodeBytes(bytes);
  if (s === null) throw new Error(name + " の文字コードが不正です");
  return s;
}

function xmlAttr(tag, name) {
  var key = name + "=\"", i = tag.indexOf(key);
  if (i < 0) return null;
  var j = tag.indexOf("\"", i + key.length);
  return j < 0 ? null : decodeXmlEntities(tag.substring(i + key.length, j));
}

function _tagName(tag) {
  var end = tag.length, i = tag.indexOf(" "), j = tag.indexOf("/");
  if (i >= 0) end = i;
  if (j > 0 && j < end) end = j;
  i = tag.indexOf("\n"); if (i >= 0 && i < end) end = i;
  i = tag.indexOf("\r"); if (i >= 0 && i < end) end = i;
  i = tag.indexOf("\t"); if (i >= 0 && i < end) end = i;
  return tag.substring(0, end);
}

function _isTagEnd(ch) {
  return ch === ">" || ch === " " || ch === "/" || ch === "\t" || ch === "\r" || ch === "\n";
}

// styles.xml → { styleId: { name, basedOn, outline } }
function parseDocxStyles(xml) {
  var styles = {}, pos = 0, lt, gt, tag, name, cur = null;
  if (!xml) return styles;
  while (true) {
    lt = xml.indexOf("<", pos); if (lt < 0) break;
    gt = xml.indexOf(">", lt); if (gt < 0) break;
    tag = xml.substring(lt + 1, gt); pos = gt + 1;
    if (tag.charAt(0) === "/") { if (tag === "/w:style") cur = null; continue; }
    name = _tagName(tag);
    if (name === "w:style") {
      cur = { id: xmlAttr(tag, "w:styleId") || "", name: "", basedOn: null, outline: null };
      styles[cur.id] = cur;
    } else if (cur !== null) {
      if (name === "w:name") cur.name = xmlAttr(tag, "w:val") || "";
      else if (name === "w:basedOn") cur.basedOn = xmlAttr(tag, "w:val");
      else if (name === "w:outlineLvl") cur.outline = parseInt(xmlAttr(tag, "w:val"), 10);
    }
  }
  return styles;
}

// Word スタイルから見出しレベル (1〜) を求める。見出しでなければ 0
function docxHeadingLevel(styles, styleId) {
  var guard = 0, s = styles[styleId], m;
  while (s && guard++ < 10) {
    m = /^(heading|見出し)\s*([0-9]+)$/i.exec(s.name);
    if (m) return parseInt(m[2], 10);
    if (s.outline !== null && !isNaN(s.outline) && s.outline < 9) return s.outline + 1;
    s = s.basedOn ? styles[s.basedOn] : null;
  }
  return 0;
}

// document.xml.rels → { rId: target }
function parseRels(xml) {
  var rels = {}, pos = 0, lt, gt, tag;
  if (!xml) return rels;
  while (true) {
    lt = xml.indexOf("<Relationship", pos); if (lt < 0) break;
    gt = xml.indexOf(">", lt); if (gt < 0) break;
    tag = xml.substring(lt + 1, gt); pos = gt + 1;
    rels[xmlAttr(tag, "Id")] = xmlAttr(tag, "Target");
  }
  return rels;
}

// 本文 XML をブロック列に変換する。
// 段落: { type:"p", text, styleId, level, refs:[{pos, kind, id}], image:rId|null }
// 表  : { type:"table", rows:[[cellText, ...]], widths:[twips...] }
// 注の本文 XML (endnotes/footnotes) にも使う (collectNotes)
function parseDocxBody(xml, styles, collectNotes, onProgress) {
  var blocks = [], pos = 0, n = xml.length, lt, gt, tag, name, selfClose, closeIdx;
  var para = null, skip = 0, inTabs = 0, fallback = 0, txbx = 0;
  var tblStack = [], tbl = null, row = null, cell = null, grid = null;
  var notes = {}, noteId = null, noteParas = null;

  function flushPara() {
    if (para === null) return;
    if (cell !== null) {
      cell.paras.push(para.text);
    } else if (collectNotes) {
      if (noteParas !== null) noteParas.push(para.text);
    } else {
      para.level = docxHeadingLevel(styles, para.styleId);
      blocks.push(para);
    }
    para = null;
  }

  var tagCount = 0;
  while (pos < n) {
    lt = xml.indexOf("<", pos); if (lt < 0) break;
    gt = xml.indexOf(">", lt); if (gt < 0) break;
    tag = xml.substring(lt + 1, gt);
    pos = gt + 1;
    if (onProgress && (++tagCount % 5000) === 0) onProgress(pos / n);
    if (tag.charAt(0) === "?" || tag.charAt(0) === "!") continue;
    if (tag.charAt(0) === "/") {
      name = tag.substring(1);
      if (name === "w:instrText" || name === "w:delText") { if (skip > 0) skip--; }
      else if (name === "w:tabs") { if (inTabs > 0) inTabs--; }
      else if (name === "mc:Fallback") { if (fallback > 0) fallback--; }
      else if (name === "w:txbxContent") { if (txbx > 0) txbx--; }
      else if (fallback > 0 || txbx > 0) continue;
      else if (name === "w:p") flushPara();
      else if (name === "w:tc") { if (row !== null && cell !== null) row.push(cell.paras.join("\r")); cell = null; }
      else if (name === "w:tr") { if (tbl !== null && row !== null) tbl.rows.push(row); row = null; }
      else if (name === "w:tbl") {
        var done = tbl;
        tbl = tblStack.length > 0 ? tblStack.pop() : null;
        if (tbl === null) {
          blocks.push({ type: "table", rows: done.rows, widths: done.widths });
        } else if (cell !== null) {
          // 表の中の表は、文字だけ親のセルに入れる
          var k, flat = [];
          for (k = 0; k < done.rows.length; k++) flat.push(done.rows[k].join("　"));
          cell.paras.push(flat.join("\r"));
        }
      }
      else if (name === "w:endnote" || name === "w:footnote") {
        if (collectNotes && noteId !== null && noteParas !== null) notes[noteId] = noteParas;
        noteId = null; noteParas = null;
      }
      continue;
    }
    name = _tagName(tag);
    selfClose = tag.charAt(tag.length - 1) === "/";
    // Word の互換用の重複データ・テキストボックスの中身は読まない
    if (name === "mc:Fallback") { if (!selfClose) fallback++; continue; }
    if (name === "w:txbxContent") { if (!selfClose) txbx++; continue; }
    if (fallback > 0 || txbx > 0) continue;
    if (name === "w:instrText" || name === "w:delText") { if (!selfClose) skip++; continue; }
    if (name === "w:tabs") { if (!selfClose) inTabs++; continue; }

    if (name === "w:endnote" || name === "w:footnote") {
      var tp = xmlAttr(tag, "w:type");
      noteId = xmlAttr(tag, "w:id");
      noteParas = (tp === "separator" || tp === "continuationSeparator" || tp === "continuationNotice") ? null : [];
      continue;
    }
    if (name === "w:tbl") { if (tbl !== null) tblStack.push(tbl); tbl = { rows: [], widths: [] }; grid = tbl.widths; continue; }
    if (name === "w:gridCol") { if (grid !== null) grid.push(parseInt(xmlAttr(tag, "w:w"), 10) || 0); continue; }
    if (name === "w:tr") { row = []; continue; }
    if (name === "w:tc") { cell = { paras: [] }; continue; }
    if (name === "w:p") {
      para = { type: "p", text: "", styleId: "", level: 0, refs: [], image: null };
      if (selfClose) flushPara();
      continue;
    }
    if (para === null) continue;
    if (name === "w:pStyle") { para.styleId = xmlAttr(tag, "w:val") || ""; continue; }
    if (name === "w:t" && !selfClose) {
      closeIdx = xml.indexOf("</w:t>", pos);
      if (closeIdx < 0) break;
      if (skip === 0) para.text += decodeXmlEntities(xml.substring(pos, closeIdx));
      pos = closeIdx + 6;
      continue;
    }
    if (skip > 0) continue;
    if (name === "w:tab" && selfClose) { if (inTabs === 0) para.text += "\t"; continue; }
    if ((name === "w:br" || name === "w:cr") && selfClose) {
      var bt = xmlAttr(tag, "w:type");
      if (bt !== "page" && bt !== "column") para.text += "\n";
      continue;
    }
    if (name === "w:endnoteReference" || name === "w:footnoteReference") {
      para.refs.push({ pos: para.text.length, kind: name === "w:endnoteReference" ? "endnote" : "footnote", id: xmlAttr(tag, "w:id") });
      continue;
    }
    if (name === "a:blip") { para.image = xmlAttr(tag, "r:embed"); continue; }
    if (name === "v:imagedata") { para.image = xmlAttr(tag, "r:id"); continue; }
  }
  flushPara();
  return collectNotes ? notes : blocks;
}

// docx の中身を読む。getText(名前) は docx 内のファイルを文字列で返す関数
// (展開済みのフォルダから読む場合と、スクリプト内蔵の展開で読む場合で共通)
function readDocxParts(getText, onProgress) {
  var docXml = getText("word/document.xml");
  if (docXml === null) throw new Error("word/document.xml が見つかりません");
  var styles = parseDocxStyles(getText("word/styles.xml"));
  var rels = parseRels(getText("word/_rels/document.xml.rels"));
  var endXml = getText("word/endnotes.xml");
  var footXml = getText("word/footnotes.xml");
  return {
    blocks: parseDocxBody(docXml, styles, false, onProgress),
    endnotes: endXml ? parseDocxBody(endXml, styles, true) : {},
    footnotes: footXml ? parseDocxBody(footXml, styles, true) : {},
    rels: rels,
    styles: styles
  };
}

// docx をスクリプト内蔵の展開で読む
function readDocxManuscript(bin, onProgress) {
  var idx = zipIndex(bin);
  var ms = readDocxParts(function (name) { return zipEntryText(bin, idx, name); }, onProgress);
  ms.zipIndex = idx;
  return ms;
}

// ------------------------------------------------------------
// 段落の種類 (役割) の判定
// ------------------------------------------------------------

var ROLES = [
  ["title", "題目"], ["subtitle", "副題"], ["author", "著者名"], ["affiliation", "所属"],
  ["abstractTitle", "要旨の見出し"], ["abstract", "要旨"], ["keywords", "キーワード"],
  ["h1", "大見出し"], ["h2", "中見出し"], ["h3", "小見出し"], ["body", "本文"],
  ["figCaption", "図表のタイトル"], ["table", "表"], ["figure", "図(画像)"], ["figSource", "図表の出典・注"],
  ["noteTitle", "注の見出し"], ["note", "注"],
  ["refTitle", "参考文献の見出し"], ["refSub", "参考文献の小見出し"], ["ref", "参考文献"]
];

// 見出しに近い種類 (この直後には空行を入れない)
var HEADINGISH = { title: 1, subtitle: 1, author: 1, affiliation: 1, h1: 1, h2: 1, h3: 1, noteTitle: 1, refTitle: 1, refSub: 1, abstractTitle: 1, figCaption: 1 };

function roleLabel(role) {
  var i;
  for (i = 0; i < ROLES.length; i++) if (ROLES[i][0] === role) return ROLES[i][1];
  return role;
}

function trimWS(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/^[\s　]+/, "").replace(/[\s　]+$/, "");
}

function toHanDigits(s) {
  var out = "", i, c;
  for (i = 0; i < s.length; i++) {
    c = s.charCodeAt(i);
    out += (c >= 0xFF10 && c <= 0xFF19) ? String.fromCharCode(c - 0xFF10 + 0x30) : s.charAt(i);
  }
  return out;
}

function toZenDigits(s) {
  var out = "", i, c;
  for (i = 0; i < s.length; i++) {
    c = s.charCodeAt(i);
    out += (c >= 0x30 && c <= 0x39) ? String.fromCharCode(c - 0x30 + 0xFF10) : s.charAt(i);
  }
  return out;
}

var RE_H_NUM = /^[0-9０-９]+[\s　]*[．.、][\s　]*\S|^[0-9０-９]+[\s　]+\S/;
var RE_H_SUB = /^[0-9０-９]+[.．][0-9０-９]+(?![.．][0-9０-９])/;
var RE_H_SUB2 = /^[0-9０-９]+[.．][0-9０-９]+[.．][0-9０-９]+/;
var RE_H_WORDS = /^(はじめに|序論|序章|序|おわりに|結論|結語|まとめ|むすび|むすびにかえて|謝辞|付記|補論)$/;
var RE_REF_TITLE = /^(参考文献|引用文献|参考・引用文献|引用・参考文献|文献|文献一覧|文献リスト|References?|Bibliography)$/i;
var RE_NOTE_TITLE = /^[《〈【［\[(（]?[\s　]*(注|註|注釈|脚注|Notes?)[\s　]*[》〉】］\])）]?$/i;
var RE_NOTE_ITEM = /^[（(][\s　\u2002-\u200A]*[0-9０-９]+[\s　\u2002-\u200A]*[）)]/;
var RE_ABS_TITLE = /^(要[\s　]*旨|概[\s　]*要|抄[\s　]*録|Abstract|ABSTRACT|Summary)$/;
var RE_KEYWORDS = /^(キーワード|キー・ワード|Key[\s　]*words?)[\s　]*[：:]/i;
var RE_FIG_CAPTION = /^(表|図|写真|Table|Fig\.?|Figure)[\s　]*[0-9０-９]+/;
var RE_FIG_SOURCE = /^(出典|出所|資料|注|備考|Source|Note)[\s　]*[：:]/;
var RE_REF_SUB = /^[（(〔［【<＜][^）)〕］】>＞]{1,20}[）)〕］】>＞]$/;
var RE_AFFIL = /(大学|大学院|研究科|学部|学科|研究所|研究センター|センター|機構|株式会社|有限会社|教授|准教授|講師|助教|研究員|博士|修士|院生|課程|学会|病院|省|庁|法人|University|College|Institute)/;
var RE_SUBTITLE = /^[―—－‐\-〜～─━].*[―—－‐\-〜～─━]$/;

// 見出しの深さ (番号の付き方から)。見出しらしくなければ 0
function headingDepthByText(t) {
  if (t.length > 60) return 0;
  // 「。」で終わるものは文 (見出しではない)
  if (/[。．]$/.test(t) && !/^[0-9０-９]+[．.]$/.test(t)) return 0;
  if (RE_H_SUB2.test(t)) return 3;
  if (RE_H_SUB.test(t)) return 2;
  if (RE_H_NUM.test(t) && t.length <= 50) return 1;
  if (RE_H_WORDS.test(t)) return 1;
  return 0;
}

// items: [{ text, level (Word の見出しレベル, 不明なら 0), isTable, isImage }]
// 戻り値: 役割の配列
function classifySequence(items) {
  var roles = [], i, it, t, st = "front", mode = "body", haveTitle = false, depth, lastFig = -10;
  for (i = 0; i < items.length; i++) {
    it = items[i];
    t = trimWS(it.text);
    if (it.isTable) { roles.push("table"); lastFig = i; if (st === "front") st = "body"; continue; }
    if (it.isImage && t === "") { roles.push("figure"); lastFig = i; if (st === "front") st = "body"; continue; }
    if (t === "") { roles.push("empty"); continue; }
    depth = headingDepthByText(t);
    // 全角スペースで字下げした長めの段落は本文
    if (depth > 0 && it.text.charAt(0) === "　" && t.length > 15) depth = 0;
    if (it.level > 0 && t.length <= 80) depth = depth > 0 ? depth : Math.min(it.level, 3);

    if (st !== "body" && st !== "done") {
      // 最初の段落が見出しなら、題目などの前付けはこのテキストに含まれていない
      if (!haveTitle && depth > 0) { st = "body"; }
      else if (!haveTitle) { roles.push("title"); haveTitle = true; continue; }
      else if (depth > 0 && !RE_ABS_TITLE.test(t)) { st = "body"; }
      else if (RE_ABS_TITLE.test(t)) { roles.push("abstractTitle"); st = "abstract"; continue; }
      else if (RE_KEYWORDS.test(t)) { roles.push("keywords"); st = "afterKeywords"; continue; }
      else if (st === "abstract") { roles.push("abstract"); continue; }
      else if (st === "afterKeywords") { st = "body"; }
      else if (roles[roles.length - 1] === "title" && RE_SUBTITLE.test(t)) { roles.push("subtitle"); continue; }
      else if (t.length > 80) { st = "body"; }
      else { roles.push(RE_AFFIL.test(t) ? "affiliation" : "author"); continue; }
    }

    // ---- 本文以降 ----
    if (RE_REF_TITLE.test(t)) { roles.push("refTitle"); mode = "ref"; continue; }
    if (RE_NOTE_TITLE.test(t)) { roles.push("noteTitle"); mode = "note"; continue; }
    if (depth > 0 && !(mode === "note" && RE_NOTE_ITEM.test(t))) {
      if (mode === "ref" && depth === 1 && !RE_H_WORDS.test(t) && !/^[0-9０-９]+[．.]/.test(t)) { /* 文献中の数字始まりは文献 */ }
      else { roles.push(depth === 1 ? "h1" : depth === 2 ? "h2" : "h3"); mode = "body"; continue; }
    }
    if (mode === "ref") { roles.push(RE_REF_SUB.test(t) ? "refSub" : "ref"); continue; }
    if (mode === "note") { roles.push("note"); continue; }
    if (RE_FIG_CAPTION.test(t) && t.length < 100) { roles.push("figCaption"); lastFig = i; continue; }
    if (RE_FIG_SOURCE.test(t) && (i - lastFig <= 3 || /^(出典|出所)/.test(t))) { roles.push("figSource"); lastFig = i; continue; }
    roles.push("body");
  }
  return roles;
}

// ------------------------------------------------------------
// 前回号の紙面から体裁を学習する
// ------------------------------------------------------------

function defaultProfile() {
  return {
    styles: {}, variants: {}, ctxSeen: {},
    bodyIndent: true, abstractIndent: true,
    headingDigits: "han",
    h1Sep: "．", h2Sep: "　",
    noteRefOpen: "（", noteRefClose: "）", noteRefPad: "",
    noteNumPad: " ", noteNumSep: "\t", noteCont: "\t",
    refUrlTab: true,
    labels: { abstractTitle: null, noteTitle: "《注》", refTitle: null, keywords: null },
    charStyles: { noteRef: null, dash: null, keywordsLabel: null, figSourceLabel: null },
    blankBefore: {}, blankStyle: {},
    learnedFrom: 0
  };
}

function _mostCommon(counter) {
  var k, best = null, bn = 0, total = 0;
  for (k in counter) {
    if (!counter.hasOwnProperty(k)) continue;
    total += counter[k];
    if (counter[k] > bn) { bn = counter[k]; best = k; }
  }
  return { key: best, count: bn, total: total };
}

function _inc(obj, key) { obj[key] = (obj[key] || 0) + 1; }

// 文字スタイルの区間のうち、[start, end) と重なるものの名前
function _runAt(runs, start, end) {
  var i;
  if (!runs) return null;
  for (i = 0; i < runs.length; i++) {
    if (runs[i].start < end && runs[i].end > start) return runs[i].name;
  }
  return null;
}

// oldParas: [{ text, style, level, isTable, isImage, runs:[{start,end,name}] }]
function learnProfile(oldParas) {
  var p = defaultProfile();
  var roles = classifySequence(oldParas), i, r, t, style, raw;
  var styleCount = {}, ctxCount = {}, bodyN = 0, bodyIndented = 0;
  var noteRefCs = {}, dashCs = {}, kwCs = {}, srcCs = {}, contPrefix = {}, urlTab = 0, urlN = 0;
  var roleN = {}, blankN = {}, blankSt = {}, numPad = {}, refPad = {}, absN = 0, absIndented = 0;
  var m, re;
  for (i = 0; i < oldParas.length; i++) {
    r = roles[i];
    if (r === "empty") continue;
    // この種類の段落の前に空行があるか
    _inc(roleN, r);
    var pj = i - 1; while (pj >= 0 && roles[pj] === "empty") pj--;
    var prevHeadingish = pj >= 0 && HEADINGISH[roles[pj]];
    if (prevHeadingish) { roleN[r]--; }
    else if (i > 0 && roles[i - 1] === "empty") {
      _inc(blankN, r);
      if (!blankSt[r]) blankSt[r] = {};
      if (oldParas[i - 1].style) _inc(blankSt[r], oldParas[i - 1].style);
    }
    raw = oldParas[i].text;
    t = trimWS(raw);
    style = oldParas[i].style;
    if (!styleCount[r]) styleCount[r] = {};
    if (style) _inc(styleCount[r], style);
    // 前後の役割ごとの変化形 (例: 中見出しの直前の大見出し、表の直後の本文)
    var prev = i > 0 ? roles[i - 1] : "", next = i + 1 < roles.length ? roles[i + 1] : "";
    var j = i - 1; while (j >= 0 && roles[j] === "empty") j--; prev = j >= 0 ? roles[j] : "";
    j = i + 1; while (j < roles.length && roles[j] === "empty") j++; next = j < roles.length ? roles[j] : "";
    if (style) {
      if (!ctxCount[r + ">" + next]) ctxCount[r + ">" + next] = {};
      _inc(ctxCount[r + ">" + next], style);
      if (!ctxCount[r + "<" + prev]) ctxCount[r + "<" + prev] = {};
      _inc(ctxCount[r + "<" + prev], style);
    }
    if (r === "body") { bodyN++; if (raw.charAt(0) === "　") bodyIndented++; }
    if (r === "abstract") { absN++; if (raw.charAt(0) === "　") absIndented++; }
    if (r === "h1") {
      m = /^([0-9０-９]+)([\s　]*[．.、][\s　]*|[\s　]+)/.exec(t);
      if (m) { p.headingDigits = /[０-９]/.test(m[1]) ? "zen" : "han"; p.h1Sep = m[2]; }
    }
    if (r === "h2") {
      m = /^[0-9０-９]+[.．][0-9０-９]+([\s　]*)/.exec(t);
      if (m && m[1] !== "") p.h2Sep = m[1];
    }
    if (r === "abstractTitle") p.labels.abstractTitle = t;
    if (r === "noteTitle") p.labels.noteTitle = t;
    if (r === "refTitle") p.labels.refTitle = t;
    if (r === "keywords") {
      m = RE_KEYWORDS.exec(t);
      if (m) {
        p.labels.keywords = m[0];
        var kcs = _runAt(oldParas[i].runs, raw.indexOf(m[0]), raw.indexOf(m[0]) + m[0].length);
        if (kcs) _inc(kwCs, kcs);
      }
    }
    if (r === "figSource") {
      m = RE_FIG_SOURCE.exec(t);
      if (m) { var scs = _runAt(oldParas[i].runs, raw.indexOf(m[0]), raw.indexOf(m[0]) + m[0].length); if (scs) _inc(srcCs, scs); }
    }
    if (r === "note") {
      m = /^[（(]([\s　\u2002-\u200A]*)[0-9０-９]([\s　\u2002-\u200A]*)[）)]([\s\u2002-\u200A]*)/.exec(raw);
      if (m) { _inc(numPad, m[1] === "" ? "none" : m[1]); if (m[3] !== "") p.noteNumSep = m[3]; }
      else if (!/^[（(][\s　\u2002-\u200A]*[0-9０-９]{2,}/.test(raw)) {
        m = /^[\t 　]*/.exec(raw);
        _inc(contPrefix, m[0]);
      }
    }
    if (r === "ref" && /^[\s　]*https?:/.test(raw)) { urlN++; if (raw.charAt(0) === "\t") urlTab++; }
    // 本文中の注番号の書き方と文字スタイル
    if (r === "body" || r === "title" || r === "h1" || r === "h2") {
      re = /[（(]([\s　\u2002-\u200A]*)[0-9０-９]{1,3}([\s　\u2002-\u200A]*)[）)]/g;
      while ((m = re.exec(raw)) !== null) {
        var ncs = _runAt(oldParas[i].runs, m.index, m.index + m[0].length);
        if (ncs) { _inc(noteRefCs, ncs); if (m[0].replace(/[^0-9０-９]/g, "").length === 1) _inc(refPad, m[1] === "" ? "none" : m[1]); }
      }
    }
    if (r === "subtitle" || r === "title") {
      re = /[―—─]+/g;
      while ((m = re.exec(raw)) !== null) {
        var dcs = _runAt(oldParas[i].runs, m.index, m.index + m[0].length);
        if (dcs) _inc(dashCs, dcs);
      }
    }
  }
  var k, mc;
  for (k in styleCount) {
    if (!styleCount.hasOwnProperty(k)) continue;
    mc = _mostCommon(styleCount[k]);
    if (mc.key) p.styles[k] = mc.key;
  }
  for (k in ctxCount) {
    if (!ctxCount.hasOwnProperty(k)) continue;
    p.ctxSeen[k] = true;
    var base = p.styles[k.split(/[<>]/)[0]];
    mc = _mostCommon(ctxCount[k]);
    if (mc.key && mc.key !== base && mc.count / mc.total >= 0.6 && (mc.total === 1 || mc.count >= 2)) p.variants[k] = mc.key;
  }
  if (bodyN > 0) p.bodyIndent = bodyIndented / bodyN >= 0.5;
  p.abstractIndent = absN > 0 ? absIndented / absN >= 0.5 : p.bodyIndent;
  mc = _mostCommon(numPad); if (mc.key !== null) p.noteNumPad = mc.key === "none" ? "" : mc.key;
  mc = _mostCommon(refPad); if (mc.key !== null) p.noteRefPad = mc.key === "none" ? "" : mc.key;
  if (urlN > 0) p.refUrlTab = urlTab / urlN >= 0.5;
  mc = _mostCommon(contPrefix); if (mc.key !== null) p.noteCont = mc.key;
  p.charStyles.noteRef = _mostCommon(noteRefCs).key;
  p.charStyles.dash = _mostCommon(dashCs).key;
  p.charStyles.keywordsLabel = _mostCommon(kwCs).key;
  p.charStyles.figSourceLabel = _mostCommon(srcCs).key;
  for (k in roleN) {
    if (!roleN.hasOwnProperty(k)) continue;
    if (blankN[k] && blankN[k] / roleN[k] >= 0.5) {
      p.blankBefore[k] = true;
      if (blankSt[k]) p.blankStyle[k] = _mostCommon(blankSt[k]).key;
    }
  }
  p.learnedFrom = oldParas.length;
  p.oldRoles = roles;
  return p;
}

// ------------------------------------------------------------
// 原稿 → 流し込み用の段落列
// ------------------------------------------------------------

function _noteNum(n, p) {
  var s = String(n);
  if (p.noteNumPad && s.length === 1) return "（" + p.noteNumPad + s + p.noteNumPad + "）";
  return "（" + s + "）";
}

function _noteRef(n, p) {
  var s = String(n);
  return p.noteRefOpen + (p.noteRefPad && s.length === 1 ? p.noteRefPad + s + p.noteRefPad : s) + p.noteRefClose;
}

function _normHeading(t, role, p) {
  var m, num, rest;
  if (role === "h1") {
    m = /^([0-9０-９]+)(?:[\s　]*[．.、][\s　]*|[\s　]+)/.exec(t);
    if (!m) return t;
    num = p.headingDigits === "zen" ? toZenDigits(m[1]) : toHanDigits(m[1]);
    return num + p.h1Sep + t.substring(m[0].length);
  }
  m = /^([0-9０-９]+(?:[.．][0-9０-９]+)+)[\s　]*/.exec(t);
  if (!m) return t;
  num = m[1];
  if (p.headingDigits === "zen") num = toZenDigits(num).replace(/\./g, "．");
  else num = toHanDigits(num).replace(/．/g, ".");
  rest = t.substring(m[0].length);
  return num + p.h2Sep + rest;
}

// 原稿 (readDocxManuscript の結果) を役割付きの段落列にする
// 戻り値: { items:[{role, text, refs:[{start,len}], dash:[], label:{start,len}, table, image}], notes:n, warnings:[] }
function buildItems(ms, p) {
  var blocks = ms.blocks, seq = [], i, b;
  for (i = 0; i < blocks.length; i++) {
    b = blocks[i];
    if (b.type === "table") seq.push({ text: "", level: 0, isTable: true, isImage: false, block: b });
    else seq.push({ text: b.text, level: b.level, isTable: false, isImage: !!b.image, block: b });
  }
  // 題目の段落に改行があれば、題目と副題に分ける
  var firstIdx = -1;
  for (i = 0; i < seq.length; i++) if (!seq[i].isTable && trimWS(seq[i].text) !== "") { firstIdx = i; break; }
  if (firstIdx >= 0 && seq[firstIdx].text.indexOf("\n") > 0) {
    var tb = seq[firstIdx].block, cut = tb.text.indexOf("\n");
    var head = { type: "p", text: tb.text.substring(0, cut), styleId: tb.styleId, level: 0, refs: [], image: null };
    var tail = { type: "p", text: tb.text.substring(cut + 1).replace(/\n/g, ""), styleId: tb.styleId, level: 0, refs: [], image: null };
    var r;
    for (r = 0; r < tb.refs.length; r++) {
      if (tb.refs[r].pos <= cut) head.refs.push(tb.refs[r]);
      else tail.refs.push({ pos: tb.refs[r].pos - cut - 1, kind: tb.refs[r].kind, id: tb.refs[r].id });
    }
    seq.splice(firstIdx, 1,
      { text: head.text, level: 0, isTable: false, isImage: false, block: head },
      { text: tail.text, level: 0, isTable: false, isImage: false, block: tail, forceRole: "subtitle" });
  }
  var roles = classifySequence(seq);
  for (i = 0; i < seq.length; i++) if (seq[i].forceRole && roles[i] !== "empty") roles[i] = seq[i].forceRole;

  // 注番号は本文中に出てきた順
  var noteOrder = [], noteNo = {}, items = [], warnings = [];
  for (i = 0; i < seq.length; i++) {
    b = seq[i].block;
    if (!b.refs) continue;
    var q;
    for (q = 0; q < b.refs.length; q++) {
      var key = b.refs[q].kind + ":" + b.refs[q].id;
      if (!noteNo[key]) { noteOrder.push(b.refs[q]); noteNo[key] = noteOrder.length; }
    }
  }

  var noteInsertAt = -1;
  for (i = 0; i < seq.length; i++) {
    var role = roles[i];
    b = seq[i].block;
    if (role === "empty") continue;
    if (role === "refTitle" && noteInsertAt < 0) noteInsertAt = items.length;
    if (role === "table") { items.push({ role: "table", text: "■表■", table: b }); continue; }
    if (role === "figure") { items.push({ role: "figure", text: "■図■", image: b.image }); continue; }
    var text = b.text.replace(/\n/g, "\n"), refs = [], k, off = 0, sorted = b.refs.slice(0);
    sorted.sort(function (x, y) { return x.pos - y.pos; });
    // 注番号を差し込む
    var out = "";
    var last = 0;
    for (k = 0; k < sorted.length; k++) {
      var n = noteNo[sorted[k].kind + ":" + sorted[k].id];
      out += text.substring(last, sorted[k].pos);
      var mark = _noteRef(n, p);
      refs.push({ start: out.length, len: mark.length });
      out += mark;
      last = sorted[k].pos;
    }
    out += text.substring(last);
    // 体裁の調整
    var lead = /^[ \t]*/.exec(out)[0].length;
    if (lead > 0) { out = out.substring(lead); for (k = 0; k < refs.length; k++) refs[k].start -= lead; }
    var tr = /[\s　]+$/.exec(out); if (tr) out = out.substring(0, out.length - tr[0].length);
    var shift = 0;
    if (role === "h1" || role === "h2" || role === "h3") {
      var before = out;
      out = _normHeading(trimWS(out), role, p);
      if (refs.length > 0 && out.length !== before.length) {
        // 見出しに注番号がある場合は末尾側の位置を保つ
        for (k = 0; k < refs.length; k++) refs[k].start += out.length - before.length;
      }
    } else if (role === "body") {
      if (p.bodyIndent && out.charAt(0) !== "　") { out = "　" + out; shift = 1; }
    } else if (role === "abstract") {
      if (p.abstractIndent && out.charAt(0) !== "　") { out = "　" + out; shift = 1; }
    } else if (role === "abstractTitle" && p.labels.abstractTitle) {
      out = p.labels.abstractTitle;
    } else if (role === "refTitle" && p.labels.refTitle) {
      out = p.labels.refTitle;
    } else if (role === "noteTitle" && p.labels.noteTitle) {
      out = p.labels.noteTitle;
    } else if (role === "keywords" && p.labels.keywords) {
      out = out.replace(RE_KEYWORDS, p.labels.keywords);
    } else if (role === "ref" && p.refUrlTab && /^https?:/.test(out)) {
      out = "\t" + out; shift = 1;
    } else {
      out = out.replace(/^[　]+/, "");
    }
    if (shift) for (k = 0; k < refs.length; k++) refs[k].start += shift;
    var item = { role: role, text: out, refs: refs };
    if (role === "keywords") { var km = RE_KEYWORDS.exec(out); if (km) item.label = { start: 0, len: km[0].length }; }
    if (role === "figSource") { var sm = RE_FIG_SOURCE.exec(out); if (sm) item.label = { start: 0, len: sm[0].length }; }
    if (role === "title" || role === "subtitle") {
      var dre = /[―—─]+/g, dm; item.dash = [];
      while ((dm = dre.exec(out)) !== null) item.dash.push({ start: dm.index, len: dm[0].length });
    }
    items.push(item);
  }

  // 文末脚注・脚注を「注」としてまとめる (参考文献の前。なければ末尾)
  if (noteOrder.length > 0) {
    var noteItems = [{ role: "noteTitle", text: p.labels.noteTitle || "《注》", refs: [] }], nn;
    for (nn = 0; nn < noteOrder.length; nn++) {
      var src = noteOrder[nn].kind === "endnote" ? ms.endnotes : ms.footnotes;
      var paras = src[noteOrder[nn].id];
      if (!paras) { warnings.push("注" + (nn + 1) + " の本文が見つかりませんでした"); paras = [""]; }
      var first = true, pi;
      for (pi = 0; pi < paras.length; pi++) {
        var nt = trimWS(paras[pi]);
        if (nt === "" && !first) continue;
        noteItems.push({ role: "note", text: first ? _noteNum(nn + 1, p) + p.noteNumSep + nt : p.noteCont + nt, refs: [] });
        first = false;
      }
    }
    if (noteInsertAt < 0) noteInsertAt = items.length;
    items = items.slice(0, noteInsertAt).concat(noteItems, items.slice(noteInsertAt));
  }
  // 前回号で空行が入っていた種類の段落の前に空行を入れる
  var withBlanks = [], w;
  for (w = 0; w < items.length; w++) {
    var prevItem = withBlanks.length > 0 ? withBlanks[withBlanks.length - 1] : null;
    if (p.blankBefore[items[w].role] && prevItem !== null && prevItem.role !== "blank" && !HEADINGISH[prevItem.role]) {
      withBlanks.push({ role: "blank", forRole: items[w].role, text: "", refs: [] });
    }
    withBlanks.push(items[w]);
  }
  return { items: withBlanks, notes: noteOrder.length, warnings: warnings };
}

// 段落列 → 1つの文字列と、段落・文字スタイルの位置
function buildStoryText(items) {
  var parts = [], paras = [], chars = [], pos = 0, i, it, k;
  for (i = 0; i < items.length; i++) {
    it = items[i];
    paras.push({ role: it.role, start: pos, len: it.text.length, index: i });
    if (it.refs) for (k = 0; k < it.refs.length; k++) chars.push({ kind: "noteRef", start: pos + it.refs[k].start, len: it.refs[k].len });
    if (it.dash) for (k = 0; k < it.dash.length; k++) chars.push({ kind: "dash", start: pos + it.dash[k].start, len: it.dash[k].len });
    if (it.label) chars.push({ kind: it.role === "keywords" ? "keywordsLabel" : "figSourceLabel", start: pos + it.label.start, len: it.label.len });
    parts.push(it.text);
    pos += it.text.length + 1;
  }
  return { text: parts.join("\r"), paras: paras, chars: chars };
}

// スタイル名からの推測 (前回号で見つからなかった種類用)
var STYLE_GUESS = {
  title: [[/タイトル|題目|表題/], /要旨|注|Abstract|図|表スタイル|英文|文献/i],
  subtitle: [[/副題|サブタイトル|副タイトル/], /Abstract/i],
  author: [[/著者名|氏名|執筆者/, /著者/], /Abstract/i],
  affiliation: [[/所属/], /Abstract/i],
  abstractTitle: [[/要旨.*(タイトル|見出し)/], /英文|Abstract/i],
  "abstract": [[/要旨|概要|抄録/], /タイトル|見出し|英文|Abstract/i],
  keywords: [[/キーワード/], /英文|Abstract/i],
  h1: [[/大見出し|見出し\s*[1１]/], /Abstract/i],
  h2: [[/中見出し|見出し\s*[2２]/], /Abstract|大見出し|下中見出し/i],
  h3: [[/小見出し|見出し\s*[3３]/], /Abstract|中見出し|大見出し/i],
  body: [[/本文/], /Abstract|注|要旨|表/i],
  figCaption: [[/図表タイトル|表タイトル|図タイトル|キャプション/], /Abstract/i],
  figSource: [[/図表注|出典|図注|表注/], /Abstract/i],
  table: [[/^図表$/, /図表[^タ注]*$/], /Abstract/i],
  figure: [[/^図表$/, /図表[^タ注]*$/], /Abstract/i],
  noteTitle: [[/注タイトル|注見出し|注の見出し/], /Abstract/i],
  note: [[/注本文/, /^注$|後注/, /脚注/], /Abstract|タイトル|見出し/i],
  refTitle: [[/文献.*(タイトル|見出し)/], /Abstract/i],
  refSub: [[/文献.*小見出し/], /Abstract/i],
  ref: [[/文献|参考/], /タイトル|見出し|Abstract/i]
};
var STYLE_FALLBACK = {
  subtitle: "title", affiliation: "author", abstractTitle: "abstract", keywords: "abstract",
  h3: "h2", figSource: "note", table: "figCaption", figure: "table", refTitle: "noteTitle",
  refSub: "ref", ref: "note", noteTitle: "h2", note: "body", figCaption: "body"
};

function guessStyleName(role, names) {
  var g = STYLE_GUESS[role], i, j;
  if (!g) return null;
  for (j = 0; j < g[0].length; j++) {
    for (i = 0; i < names.length; i++) {
      if (g[0][j].test(names[i]) && !g[1].test(names[i])) return names[i];
    }
  }
  return null;
}

// 役割 → 段落スタイル名 の初期値: 前回号で学習したもの → 名前から推測 → 近い役割 → 本文
function initialStyleMap(p, names) {
  var map = {}, i, r, exists = {}, pass;
  for (i = 0; i < names.length; i++) exists[names[i]] = true;
  for (i = 0; i < ROLES.length; i++) {
    r = ROLES[i][0];
    if (p.styles[r] && exists[p.styles[r]]) map[r] = p.styles[r];
    else map[r] = guessStyleName(r, names);
  }
  for (pass = 0; pass < 4; pass++) {
    for (i = 0; i < ROLES.length; i++) {
      r = ROLES[i][0];
      if (!map[r] && STYLE_FALLBACK[r] && map[STYLE_FALLBACK[r]]) map[r] = map[STYLE_FALLBACK[r]];
    }
  }
  for (i = 0; i < ROLES.length; i++) { r = ROLES[i][0]; if (!map[r]) map[r] = map.body || null; }
  return map;
}

// 確認ダイアログで種類を変えたときに、段落頭の字下げなどを付け直す
function changeRole(item, role, p) {
  var old = item.role, t = item.text, k, before = t.length;
  if (old === role || role === "table" || role === "figure" || old === "table" || old === "figure") { item.role = role; return; }
  t = t.replace(/^[\t　]+/, "");
  if ((role === "body" && p.bodyIndent) || (role === "abstract" && p.abstractIndent)) t = "　" + t;
  if (role === "h1" || role === "h2" || role === "h3") t = _normHeading(t, role, p);
  if (item.refs) for (k = 0; k < item.refs.length; k++) item.refs[k].start += t.length - before;
  if (item.dash) item.dash = [];
  item.label = null;
  if (role === "keywords") { var km = RE_KEYWORDS.exec(t); if (km) item.label = { start: 0, len: km[0].length }; }
  if (role === "figSource") { var sm = RE_FIG_SOURCE.exec(t); if (sm) item.label = { start: 0, len: sm[0].length }; }
  item.text = t;
  item.role = role;
}

// 段落ごとのスタイル名を決める (前後の種類による変化形も考慮)
// styleMap: 役割 → スタイル名 (ダイアログで変更後のもの)
function resolveStyleNames(items, p, styleMap) {
  var out = [], i, r, prev, next, j, key, name;
  function nonBlank(k, dir) {
    while (k >= 0 && k < items.length && items[k].role === "blank") k += dir;
    return (k >= 0 && k < items.length) ? items[k].role : "";
  }
  for (i = 0; i < items.length; i++) {
    r = items[i].role;
    if (r === "blank") { out.push(p.blankStyle[items[i].forRole] || styleMap.body || null); continue; }
    name = styleMap[r] || null;
    next = nonBlank(i + 1, 1);
    prev = nonBlank(i - 1, -1);
    // 変化形は、学習した役割のスタイルがそのまま使われているときだけ当てる。
    // 見出しの類は「次の段落」(下のアキ)、本文の類は「前の段落」(上のアキ) で決める
    if (name !== null && name === p.styles[r]) {
      key = HEADINGISH[r] ? r + ">" + next : r + "<" + prev;
      if (p.ctxSeen[key] && p.variants[key]) name = p.variants[key];
    }
    out.push(name);
  }
  return out;
}

// JS の文字位置 → InDesign の文字位置 (サロゲートペアは InDesign では1文字)
function makeIndexMapper(text) {
  var pre = [], i, c = 0, has = false;
  for (i = 0; i < text.length; i++) {
    pre[i] = c;
    var code = text.charCodeAt(i);
    if (code >= 0xDC00 && code <= 0xDFFF && i > 0) { var h = text.charCodeAt(i - 1); if (h >= 0xD800 && h <= 0xDBFF) { c++; has = true; } }
  }
  pre[text.length] = c;
  if (!has) return function (x) { return x; };
  return function (x) { return x - pre[x]; };
}

// ===== CORE END =====

// ============================================================
// ここから InDesign 依存部
// ============================================================

var _prog = null;
function showProgress(msg) {
  try {
    if (_prog === null) {
      _prog = new Window("palette", "紀要の流し込み");
      _prog.msg = _prog.add("statictext", undefined, msg);
      _prog.msg.preferredSize = [420, 24];
      _prog.center();
      _prog.show();
    } else {
      _prog.msg.text = msg;
    }
    _prog.update();
  } catch (e) { _prog = null; }
}
function hideProgress() {
  if (_prog !== null) { try { _prog.close(); } catch (e) {} }
  _prog = null;
}

function isNoneStyleName(n) { return !n || n.charAt(0) === "["; }

function selectedFrame() {
  var i, it;
  try {
    for (i = 0; i < app.selection.length; i++) {
      it = app.selection[i];
      if (it.constructor.name === "TextFrame") return it;
      if (it.hasOwnProperty("parentTextFrames") && it.parentTextFrames.length > 0) return it.parentTextFrames[0];
    }
  } catch (e) {}
  return null;
}

// ストーリーの段落を一括で読む (1段落ずつ読むより速い)
function readStoryParas(story, withRuns) {
  var out = [], i, n, contents, styles, t, pr;
  n = story.paragraphs.length;
  if (n === 0) return out;
  contents = story.paragraphs.everyItem().contents;
  styles = story.paragraphs.everyItem().appliedParagraphStyle;
  if (!(contents instanceof Array)) contents = [contents];
  if (!(styles instanceof Array)) styles = [styles];
  for (i = 0; i < n; i++) {
    t = typeof contents[i] === "string" ? contents[i] : "";
    t = t.replace(/\r$/, "");
    pr = { text: t, style: "", level: 0, isTable: false, isImage: false, runs: null, index: i };
    try { pr.style = styles[i].name; } catch (e) {}
    if (t.indexOf("\u0016") >= 0) { pr.isTable = true; pr.text = t.replace(/\u0016/g, ""); }
    if (t.indexOf("￼") >= 0) { pr.isImage = true; pr.text = t.replace(/￼/g, ""); }
    out.push(pr);
  }
  if (withRuns) {
    // 文字スタイルは、注番号・ダーシ・「キーワード：」「出典：」がある段落だけ調べる
    var re = /[（(][\s　\u2002-\u200A]*[0-9０-９]{1,3}|[―—─]|^(キーワード|出典)/;
    var paras = story.paragraphs.everyItem().getElements();
    for (i = 0; i < out.length; i++) {
      if (!re.test(out[i].text)) continue;
      try {
        var p = paras[i], base = p.insertionPoints[0].index, rs = p.textStyleRanges.everyItem().getElements(), k, runs = [];
        for (k = 0; k < rs.length; k++) {
          var cs = rs[k].appliedCharacterStyle, nm = cs ? cs.name : "";
          if (isNoneStyleName(nm)) continue;
          var st = rs[k].insertionPoints[0].index - base;
          runs.push({ start: st, end: st + rs[k].characters.length, name: nm });
        }
        out[i].runs = runs;
      } catch (e2) {}
    }
  }
  return out;
}

function findStylesByName(doc) {
  var all = doc.allParagraphStyles, map = {}, names = [], i, nm;
  for (i = 0; i < all.length; i++) {
    nm = all[i].name;
    if (map[nm]) continue;
    map[nm] = all[i];
    names.push(nm);
  }
  return { map: map, names: names };
}

function findCharStyle(doc, name) {
  if (!name) return null;
  var all = doc.allCharacterStyles, i;
  for (i = 0; i < all.length; i++) if (all[i].name === name) return all[i];
  return null;
}

// 前付け (題目〜キーワード) が別のテキストに入っている場合に、そのストーリーを探す
function findFrontStory(doc, bodyStory) {
  var i, s, paras, roles, k, hasTitle, hasFront;
  for (i = 0; i < doc.stories.length; i++) {
    s = doc.stories[i];
    if (s.id === bodyStory.id) continue;
    try {
      if (s.paragraphs.length === 0 || s.paragraphs.length > 40) continue;
      if (s.textContainers.length === 0) continue;
      var pg = s.textContainers[0].parentPage;
      if (!pg || pg.parent.constructor.name === "MasterSpread") continue;
      paras = readStoryParas(s, true);
      roles = classifySequence(paras);
      hasTitle = false; hasFront = false;
      for (k = 0; k < roles.length; k++) {
        if (roles[k] === "title") hasTitle = true;
        if (roles[k] === "abstract" || roles[k] === "author" || roles[k] === "keywords") hasFront = true;
      }
      if (hasTitle && hasFront) return { story: s, paras: paras };
    } catch (e) {}
  }
  return null;
}

// 英文要旨など、残しておく部分の開始段落 (なければ -1)
function preserveStart(paras) {
  var i;
  for (i = 0; i < paras.length; i++) {
    if (/Abstract|英文要旨/i.test(paras[i].style)) return i;
  }
  return -1;
}

function oldTitleText(paras, roles) {
  var i;
  for (i = 0; i < paras.length; i++) {
    if (roles[i] === "title") {
      var t = trimWS(paras[i].text.replace(/[（(][\s　\u2002-\u200A]*[0-9０-９]{1,3}[\s　\u2002-\u200A]*[）)]/g, ""));
      return t.length >= 6 ? t : null;
    }
  }
  return null;
}

// ---- 確認ダイアログ (紙面には触れない) ----

var MAIN_ROLES = { body: 0, note: 0, ref: 0, blank: 0 };

function confirmDialog(built, p, styleMap, styleNames, info) {
  var items = built.items, i, w, cnt = {};
  for (i = 0; i < items.length; i++) cnt[items[i].role] = (cnt[items[i].role] || 0) + 1;

  w = new Window("dialog", "紀要の流し込み — 内容の確認");
  w.orientation = "column";
  w.alignChildren = "fill";
  var sum = "原稿: " + info.docxName + "\n" +
    "大見出し " + (cnt.h1 || 0) + " / 中見出し " + (cnt.h2 || 0) + " / 小見出し " + (cnt.h3 || 0) +
    " / 表 " + (cnt.table || 0) + " / 図 " + (cnt.figure || 0) + " / 注 " + built.notes + " 件 / 本文 " + (cnt.body || 0) + " 段落";
  w.add("statictext", undefined, sum, { multiline: true }).preferredSize = [760, 36];
  if (info.notes.length > 0) {
    w.add("statictext", undefined, info.notes.join("\n"), { multiline: true }).preferredSize = [760, 16 * info.notes.length + 4];
  }

  var showAll = w.add("checkbox", undefined, "本文・注・参考文献の段落もすべて表示する");
  var lb = w.add("listbox", undefined, undefined, {
    numberOfColumns: 3, showHeaders: true,
    columnTitles: ["種類", "内容", "段落スタイル"], columnWidths: [120, 420, 210], multiselect: false
  });
  lb.preferredSize = [760, 360];

  var rowMap = [];
  function styleFor(k) {
    var names = resolveStyleNames(items, p, styleMap);
    return names[k] || "(なし)";
  }
  function fill() {
    lb.removeAll();
    rowMap = [];
    var names = resolveStyleNames(items, p, styleMap), k, it, li, txt;
    for (k = 0; k < items.length; k++) {
      it = items[k];
      if (it.role === "blank") continue;
      if (!showAll.value && MAIN_ROLES.hasOwnProperty(it.role)) continue;
      txt = it.role === "table" ? "［表 " + it.table.rows.length + "行×" + (it.table.rows[0] ? it.table.rows[0].length : 0) + "列］" :
            it.role === "figure" ? "［図の画像］" : trimWS(it.text).substring(0, 60);
      li = lb.add("item", roleLabel(it.role));
      li.subItems[0].text = txt;
      li.subItems[1].text = names[k] || "(なし)";
      rowMap.push(k);
    }
  }
  showAll.onClick = fill;

  var g = w.add("group");
  g.add("statictext", undefined, "選んだ段落の種類を変更:");
  var labels = [], codes = [], r;
  for (r = 0; r < ROLES.length; r++) {
    if (ROLES[r][0] === "table" || ROLES[r][0] === "figure") continue;
    labels.push(ROLES[r][1]); codes.push(ROLES[r][0]);
  }
  var dd = g.add("dropdownlist", undefined, labels);
  dd.preferredSize = [180, 24];
  var bStyles = g.add("button", undefined, "種類ごとの段落スタイルを確認・変更…");

  lb.onChange = function () {
    if (!lb.selection) return;
    var it = items[rowMap[lb.selection.index]], c;
    for (c = 0; c < codes.length; c++) if (codes[c] === it.role) { dd.selection = c; return; }
    dd.selection = null;
  };
  dd.onChange = function () {
    if (!lb.selection || !dd.selection) return;
    var idx = lb.selection.index, it = items[rowMap[idx]];
    if (it.role === "table" || it.role === "figure") return;
    var nr = codes[dd.selection.index];
    if (nr === it.role) return;
    changeRole(it, nr, p);
    lb.items[idx].text = roleLabel(nr);
    lb.items[idx].subItems[1].text = styleFor(rowMap[idx]);
  };
  bStyles.onClick = function () {
    if (styleMapDialog(styleMap, styleNames, cnt)) fill();
  };

  var btns = w.add("group");
  btns.alignment = "right";
  var ok = btns.add("button", undefined, "流し込む", { name: "ok" });
  var cancel = btns.add("button", undefined, "キャンセル", { name: "cancel" });
  ok.onClick = function () { w.close(1); };
  cancel.onClick = function () { w.close(2); };
  fill();
  w.center();
  return w.show() === 1;
}

function styleMapDialog(styleMap, styleNames, cnt) {
  var w = new Window("dialog", "種類ごとの段落スタイル");
  w.orientation = "column";
  w.alignChildren = "fill";
  w.add("statictext", undefined, "前回号の紙面から自動で選んであります。違うものだけ直してください。");
  var pnl = w.add("panel");
  pnl.alignChildren = "left";
  var dds = [], i, r, row, dd, k;
  var list = ["(本文と同じ)"].concat(styleNames);
  for (i = 0; i < ROLES.length; i++) {
    r = ROLES[i][0];
    if (!cnt[r]) continue;
    row = pnl.add("group");
    row.add("statictext", undefined, ROLES[i][1]).preferredSize = [140, 20];
    dd = row.add("dropdownlist", undefined, list);
    dd.preferredSize = [320, 22];
    dd.selection = 0;
    for (k = 0; k < styleNames.length; k++) if (styleNames[k] === styleMap[r]) { dd.selection = k + 1; break; }
    dds.push({ role: r, dd: dd });
  }
  var btns = w.add("group");
  btns.alignment = "right";
  btns.add("button", undefined, "OK", { name: "ok" });
  btns.add("button", undefined, "キャンセル", { name: "cancel" });
  if (w.show() !== 1) return false;
  for (i = 0; i < dds.length; i++) {
    var sel = dds[i].dd.selection ? dds[i].dd.selection.index : 0;
    styleMap[dds[i].role] = sel === 0 ? styleMap.body : styleNames[sel - 1];
  }
  return true;
}

// ---- 画像 ----

function writeBinary(file, s) {
  file.encoding = "BINARY";
  if (!file.open("w")) return false;
  file.write(s);
  file.close();
  return true;
}

// ---- docx の展開 (パソコンに入っている展開機能を使うと、内蔵の展開よりずっと速い) ----

function _vbsStr(s) { return String(s).replace(/"/g, '""'); }

// docx を一時フォルダに展開する。展開できなければ null
function unzipDocxWithOS(src) {
  var dest = new Folder(Folder.temp + "/kiyo_docx_" + (new Date()).getTime());
  if (!dest.create()) return null;
  var check = new File(dest.fsName + "/word/document.xml");
  try {
    if (File.fs === "Windows") {
      // 1) PowerShell (Windows 標準) で展開
      var ps = "Add-Type -AssemblyName System.IO.Compression.FileSystem; " +
               "[System.IO.Compression.ZipFile]::ExtractToDirectory('" + src.fsName.replace(/'/g, "''") + "','" +
               dest.fsName.replace(/'/g, "''") + "')";
      var vbs = 'Set sh = CreateObject("WScript.Shell")\r\n' +
                'sh.Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ""' + _vbsStr(ps) + '""", 0, True\r\n';
      try { app.doScript(vbs, ScriptLanguage.VISUAL_BASIC); } catch (e1) {}
      // 2) PowerShell が使えない環境では、エクスプローラーの ZIP 展開を使う
      if (!check.exists) {
        var zipPath = dest.fsName + "\\genko.zip";
        var vbs2 = 'Set fso = CreateObject("Scripting.FileSystemObject")\r\n' +
                   'fso.CopyFile "' + _vbsStr(src.fsName) + '", "' + _vbsStr(zipPath) + '"\r\n' +
                   'Set sa = CreateObject("Shell.Application")\r\n' +
                   'sa.NameSpace("' + _vbsStr(dest.fsName) + '").CopyHere sa.NameSpace("' + _vbsStr(zipPath) + '").Items, 20\r\n';
        try { app.doScript(vbs2, ScriptLanguage.VISUAL_BASIC); } catch (e2) {}
        // この方法は裏で続くことがあるので、ファイルができるまで少し待つ
        var t, lastSize = -1;
        for (t = 0; t < 60; t++) {
          if (check.exists) {
            var sz = check.length;
            if (sz > 0 && sz === lastSize) break;
            lastSize = sz;
          }
          $.sleep(250);
        }
      }
    } else {
      var q = function (x) { return String(x).replace(/\\/g, "\\\\").replace(/"/g, '\\"'); };
      app.doScript('do shell script "/usr/bin/unzip -o -q " & quoted form of "' + q(src.fsName) +
                   '" & " -d " & quoted form of "' + q(dest.fsName) + '"', ScriptLanguage.APPLESCRIPT_LANGUAGE);
    }
  } catch (e) {}
  if (!check.exists) { removeFolder(dest); return null; }
  return dest;
}

function readUtf8File(path) {
  var f = new File(path);
  if (!f.exists) return null;
  f.encoding = "UTF-8";
  if (!f.open("r")) return null;
  var s = f.read();
  f.close();
  if (s.length > 0 && s.charCodeAt(0) === 0xFEFF) s = s.substring(1);
  return s;
}

function removeFolder(folder) {
  try {
    var items = folder.getFiles(), i;
    for (i = 0; i < items.length; i++) {
      if (items[i] instanceof Folder) removeFolder(items[i]);
      else items[i].remove();
    }
    folder.remove();
  } catch (e) {}
}

// Word 原稿を読む。まずパソコンの展開機能、だめなら内蔵の展開
function loadDocx(src, docxName) {
  var onProgress = function (r) { showProgress("Word 原稿を解析しています… " + Math.round(r * 100) + "%"); };
  showProgress("Word 原稿を展開しています… (" + docxName + ")");
  var folder = unzipDocxWithOS(src), ms;
  if (folder !== null) {
    showProgress("Word 原稿を解析しています…");
    try {
      ms = readDocxParts(function (name) { return readUtf8File(folder.fsName + "/" + name); }, onProgress);
      ms.folder = folder;
      return ms;
    } catch (e) {
      removeFolder(folder);
      throw e;
    }
  }
  showProgress("Word 原稿を展開しています… (内蔵の方法のため、数分かかることがあります)");
  src.encoding = "BINARY";
  if (!src.open("r")) throw new Error("ファイルを開けませんでした");
  var bin = src.read();
  src.close();
  ms = readDocxManuscript(bin, onProgress);
  ms.bin = bin;
  return ms;
}

// docx 内の画像を、InDesign ファイルと同じ場所の「Links」フォルダに書き出す
function extractImages(doc, ms, items, docxName) {
  var folder, out = {}, i, rid, target, data, f;
  try { folder = new Folder(doc.filePath + "/Links"); } catch (e) { folder = new Folder(Folder.myDocuments + "/Links"); }
  if (!folder.exists) folder.create();
  var base = docxName.replace(/\.docx$/i, "").replace(/[\\\/:*?"<>|]/g, "_");
  for (i = 0; i < items.length; i++) {
    if (items[i].role !== "figure" || !items[i].image) continue;
    rid = items[i].image;
    if (out[rid]) continue;
    target = ms.rels[rid];
    if (!target) continue;
    var path = target.indexOf("/") === 0 ? target.substring(1) : "word/" + target;
    try {
      f = new File(folder + "/" + base + "_" + target.replace(/^.*\//, ""));
      if (ms.folder) {
        var img = new File(ms.folder.fsName + "/" + path);
        if (img.exists && img.copy(f)) out[rid] = f;
      } else {
        data = zipEntryBinary(ms.bin, ms.zipIndex, path);
        if (data !== null && writeBinary(f, data)) out[rid] = f;
      }
    } catch (e2) {}
  }
  return out;
}

// 画像の枠を段の幅(と枠の高さの6割)に収める
function fitInlineGraphic(rect, ip) {
  try {
    var tf = ip.parentTextFrames[0];
    var fb = tf.geometricBounds, pr = tf.textFramePreferences;
    var cols = pr.textColumnCount || 1, gut = pr.textColumnGutter || 0;
    var ins = pr.insetSpacing, il = 0, ir = 0;
    if (ins instanceof Array) { il = ins[1]; ir = ins[3]; }
    var maxW = ((fb[3] - fb[1]) - il - ir - gut * (cols - 1)) / cols;
    var maxH = (fb[2] - fb[0]) * 0.6;
    var gb = rect.geometricBounds, w = gb[3] - gb[1], h = gb[2] - gb[0];
    var s = Math.min(1, maxW / w, maxH / h);
    if (s < 1) {
      rect.geometricBounds = [gb[0], gb[1], gb[0] + h * s, gb[1] + w * s];
      rect.fit(FitOptions.CONTENT_TO_FRAME);
    }
  } catch (e) {}
}

// ---- 表 ----

// 前回号の最初の表をひな形として、貼り込み作業用の枠(ページの外)に複製しておく
function makeTableTemplate(doc, story) {
  try {
    if (story.tables.length === 0) return null;
    var t = story.tables[0], ix = t.storyOffset.index;
    var pg = doc.pages[0], pb = pg.bounds, W = pb[3] - pb[1], H = pb[2] - pb[0];
    var tf = pg.parent.textFrames.add({ geometricBounds: [pb[0], pb[1] - W - 30, pb[0] + H, pb[1] - 30] });
    story.characters.item(ix).duplicate(LocationOptions.AT_BEGINNING, tf.parentStory);
    var tt = tf.parentStory.tables[0], width = 0, c;
    try { tt.cells.everyItem().unmerge(); } catch (e1) {}
    for (c = 0; c < tt.columns.length; c++) width += tt.columns[c].width;
    return { frame: tf, table: tt, width: width };
  } catch (e) {
    return null;
  }
}

function fillTable(tbl, rows, widths, targetWidth) {
  var R = rows.length, C = 0, r, c, flat = [];
  for (r = 0; r < R; r++) if (rows[r].length > C) C = rows[r].length;
  if (R === 0 || C === 0) return;
  var h = tbl.headerRowCount > 0 ? 1 : 0;
  if (R - h < 1) h = 0;
  tbl.headerRowCount = h;
  tbl.bodyRowCount = R - h;
  tbl.columnCount = C;
  for (r = 0; r < R; r++) for (c = 0; c < C; c++) flat.push(rows[r][c] !== undefined ? rows[r][c] : "");
  try { tbl.contents = flat; }
  catch (e) {
    for (r = 0; r < R; r++) for (c = 0; c < C; c++) { try { tbl.rows[r].cells[c].contents = flat[r * C + c]; } catch (e2) {} }
  }
  // Word の列幅の比率に合わせる (表全体の幅はひな形のまま)
  if (widths && widths.length === C) {
    var total = 0, sum = 0;
    for (c = 0; c < C; c++) { total += tbl.columns[c].width; sum += widths[c]; }
    if (targetWidth) total = targetWidth;
    if (sum > 0) for (c = 0; c < C; c++) { try { tbl.columns[c].width = total * widths[c] / sum; } catch (e3) {} }
  }
}

// ---- ページの追加・削除 ----

function lastContainer(story) {
  var c = story.textContainers;
  return c[c.length - 1];
}

function addPageForOverflow(doc, story) {
  var last = lastContainer(story), page = last.parentPage;
  if (!page) return false;
  var np = doc.pages.add(LocationOptions.AFTER, page);
  try { np.appliedMaster = page.appliedMaster; } catch (e0) {}
  var conts = story.textContainers, ref = null, k;
  for (k = conts.length - 1; k >= 0; k--) {
    var pg = conts[k].parentPage;
    if (pg && pg.side === np.side && pg.id !== np.id) { ref = conts[k]; break; }
  }
  if (ref === null) ref = last;
  var rb = ref.geometricBounds, rpb = ref.parentPage.bounds, npb = np.bounds;
  var nb = [npb[0] + (rb[0] - rpb[0]), npb[1] + (rb[1] - rpb[1]), npb[0] + (rb[2] - rpb[0]), npb[1] + (rb[3] - rpb[1])];
  var nf = null;
  try {
    // 枠の設定(段組・グリッドなど)を引き継ぐため、同じ側のページの枠を複製して使う
    nf = ref.duplicate(np);
    if (nf.parentStory.id === story.id) throw new Error("same story");
    nf.parentStory.contents = "";
    nf.geometricBounds = nb;
  } catch (e1) {
    try { if (nf) nf.remove(); } catch (e2) {}
    nf = np.textFrames.add({ geometricBounds: nb });
    try { nf.appliedObjectStyle = ref.appliedObjectStyle; } catch (e3) {}
    try { nf.textFramePreferences.textColumnCount = ref.textFramePreferences.textColumnCount; } catch (e4) {}
    try { nf.textFramePreferences.textColumnGutter = ref.textFramePreferences.textColumnGutter; } catch (e5) {}
  }
  last.nextTextFrame = nf;
  return true;
}

function flowOverflow(doc, story, report) {
  var added = 0, guard = 0;
  while (lastContainer(story).overflows && guard++ < 300) {
    if (!addPageForOverflow(doc, story)) break;
    added++;
  }
  if (added > 0) report.push("文字があふれたため " + added + " ページ追加しました。");
  if (lastContainer(story).overflows) report.push("[注意] まだ文字があふれています。ページを追加してください。");
}

// 本文が短くなって空いた最後のほうの枠のページ (枠しかないページ) を探す
function emptyTrailingPages(story) {
  var conts = story.textContainers, out = [], k, f, pg;
  for (k = conts.length - 1; k >= 1; k--) {
    f = conts[k];
    if (f.characters.length > 0) break;
    pg = f.parentPage;
    if (pg && pg.pageItems.length === 1) out.push(pg);
    else break;
  }
  return out;
}

// ---- 流し込み本体 ----

function applyToStory(doc, story, tailStart, built, styleNames, styleObjs, ctx, report) {
  var sb = buildStoryText(built.items), text = sb.text, mapIdx = makeIndexMapper(text), i;
  // 1) 文字を入れる
  if (tailStart < 0) {
    story.contents = text;
  } else {
    var tailIdx = story.paragraphs[tailStart].insertionPoints[0].index;
    if (tailIdx > 0) story.characters.itemByRange(0, tailIdx - 1).texts[0].contents = text + "\r";
    else story.insertionPoints[0].contents = text + "\r";
  }
  var total = mapIdx(text.length);
  var none = doc.characterStyles.item(0);
  try { story.characters.itemByRange(0, total - 1).texts[0].appliedCharacterStyle = none; } catch (e0) {}

  // 2) 段落スタイル (同じスタイルが続く所はまとめて当てる)
  var n = sb.paras.length, a = 0;
  while (a < n) {
    var b = a;
    while (b + 1 < n && styleNames[b + 1] === styleNames[a]) b++;
    var st = styleObjs[styleNames[a]] || ctx.defaultStyle;
    if (st) {
      try { story.paragraphs.itemByRange(a, b).applyParagraphStyle(st, true); }
      catch (e1) { var q; for (q = a; q <= b; q++) { try { story.paragraphs[q].applyParagraphStyle(st, true); } catch (e2) {} } }
    }
    a = b + 1;
  }

  // 3) 文字スタイル (注番号・ダーシ・「キーワード：」「出典：」)
  var cs, c, miss = {};
  for (i = 0; i < sb.chars.length; i++) {
    c = sb.chars[i];
    cs = ctx.charStyles[c.kind];
    if (!cs) { miss[c.kind] = true; continue; }
    var s0 = mapIdx(c.start), s1 = mapIdx(c.start + c.len) - 1;
    try { story.characters.itemByRange(s0, s1).texts[0].appliedCharacterStyle = cs; } catch (e3) {}
  }

  // 4) 図と表 (後ろから入れると、前の段落の位置がずれない)
  var nFig = 0, nTbl = 0, it, para;
  for (i = n - 1; i >= 0; i--) {
    it = built.items[i];
    if (it.role !== "figure" && it.role !== "table") continue;
    para = story.paragraphs[i];
    var hadCR = para.contents.charAt(para.contents.length - 1) === "\r";
    para.contents = hadCR ? "\r" : "";
    para = story.paragraphs[i];
    if (it.role === "figure") {
      var f = ctx.images[it.image];
      if (f) {
        try {
          var placed = para.insertionPoints[0].place(f);
          var g = placed instanceof Array ? placed[0] : placed;
          fitInlineGraphic(g.parent, para.insertionPoints[0]);
          nFig++;
        } catch (e4) { para.insertionPoints[0].contents = "［図をここに配置してください］"; report.push("[注意] 図を配置できませんでした: " + e4.message); }
      } else {
        para.insertionPoints[0].contents = "［図をここに配置してください］";
        report.push("[注意] 図の画像を取り出せなかったため、目印の文字を入れました。");
      }
    } else {
      try {
        var tbl;
        if (ctx.tableTemplate) {
          ctx.tableTemplate.frame.parentStory.characters.item(ctx.tableTemplate.table.storyOffset.index)
            .duplicate(LocationOptions.AT_BEGINNING, para);
          tbl = story.paragraphs[i].tables[0];
        } else {
          tbl = para.insertionPoints[0].tables.add({ headerRowCount: 1, bodyRowCount: 1, columnCount: 2 });
        }
        fillTable(tbl, it.table.rows, it.table.widths, ctx.tableTemplate ? ctx.tableTemplate.width : 0);
        if (!ctx.tableTemplate) styleNewTable(tbl, ctx);
        nTbl++;
      } catch (e5) {
        report.push("[注意] 表を作れませんでした (" + e5.message + ")。目印の文字を入れました。");
        story.paragraphs[i].insertionPoints[0].contents = "［表をここに入れてください］";
      }
    }
  }
  if (nTbl > 0) report.push("表 " + nTbl + " 個を作成しました" + (ctx.tableTemplate ? " (前回号の表の体裁を使用)。" : "。"));
  if (nFig > 0) report.push("図 " + nFig + " 個を配置しました (画像は Links フォルダに保存)。");
  var k2;
  for (k2 in miss) if (miss.hasOwnProperty(k2)) {
    report.push("[注意] " + { noteRef: "本文中の注番号", dash: "副題のダーシ", keywordsLabel: "「キーワード：」", figSourceLabel: "「出典：」" }[k2] +
                "の文字スタイルが前回号から見つからなかったため、段落スタイルのままです。");
  }
}

// 前回号に表がなかったときの表の体裁 (名前から推測した段落スタイルを当てる)
function styleNewTable(tbl, ctx) {
  var hs = ctx.tableHeadStyle, bs = ctx.tableBodyStyle, r, c;
  for (r = 0; r < tbl.rows.length; r++) {
    for (c = 0; c < tbl.rows[r].cells.length; c++) {
      var st = (r === 0) ? (hs || bs) : bs;
      if (st) { try { tbl.rows[r].cells[c].texts[0].applyParagraphStyle(st, true); } catch (e) {} }
    }
  }
}

var _ctx = null;
function runApply() {
  var c = _ctx;
  c.tableTemplate = makeTableTemplate(c.doc, c.story);
  if (c.front) {
    applyToStory(c.doc, c.front.story, -1, c.front.built, c.front.styleNames, c.styleObjs, c, c.report);
  }
  applyToStory(c.doc, c.story, c.tailStart, c.built, c.styleNames, c.styleObjs, c, c.report);
  flowOverflow(c.doc, c.story, c.report);
  // 柱などに入っている前回号の題目を新しい題目に置き換える
  if (c.oldTitle && c.newTitle && c.oldTitle !== c.newTitle) {
    try {
      app.findTextPreferences = NothingEnum.NOTHING;
      app.changeTextPreferences = NothingEnum.NOTHING;
      app.findTextPreferences.findWhat = c.oldTitle;
      var found = c.doc.findText(), k, nR = 0;
      for (k = found.length - 1; k >= 0; k--) {
        var ps = found[k].parentStory;
        if (ps.id === c.story.id || (c.front && ps.id === c.front.story.id)) continue;
        found[k].contents = c.newTitle; nR++;
      }
      app.findTextPreferences = NothingEnum.NOTHING;
      if (nR > 0) c.report.push("柱などの題目を " + nR + " か所、新しい題目に置き換えました。");
    } catch (e) {}
  }
  if (c.tableTemplate) { try { c.tableTemplate.frame.remove(); } catch (e2) {} }
}

function main() {
  if (app.documents.length === 0) { alert("先に前回号の InDesign ファイル(のコピー)を開いてください。"); return; }
  var doc = app.activeDocument;
  var frame = selectedFrame();
  if (frame === null) {
    alert("本文のテキストボックスを選択ツール(黒矢印)で選んでから実行してください。\n(本文が流れているボックスならどのページのものでも構いません)");
    return;
  }
  var story = frame.parentStory;

  showProgress("前回号の紙面を調べています…");
  var bodyParas, front = null;
  try {
    bodyParas = readStoryParas(story, true);
  } catch (e) { hideProgress(); alert("選んだテキストを読めませんでした: " + e.message); return; }
  var tailStart = preserveStart(bodyParas);
  var learnParas = tailStart >= 0 ? bodyParas.slice(0, tailStart) : bodyParas;
  var bodyRoles = classifySequence(learnParas), hasTitle = false, hasHeading = false, k;
  for (k = 0; k < bodyRoles.length; k++) {
    if (bodyRoles[k] === "title") hasTitle = true;
    if (bodyRoles[k] === "h1" || bodyRoles[k] === "h2") hasHeading = true;
  }
  if (!hasHeading && learnParas.length < 15) {
    hideProgress();
    if (!confirm("選んだテキストには見出しが見当たりません。本文のテキストボックスを選んでいますか?\n\nこのまま続けますか?")) return;
  }
  if (!hasTitle) {
    showProgress("題目・要旨のテキストを探しています…");
    front = findFrontStory(doc, story);
  }
  var profile = learnProfile(front ? front.paras.concat(learnParas) : learnParas);
  var oldTitle = oldTitleText(front ? front.paras : learnParas, classifySequence(front ? front.paras : learnParas));
  hideProgress();

  var src = File.openDialog("今回の Word 原稿(.docx)を選んでください", "*.docx");
  if (!src) return;
  var docxName = decodeURI(src.name);
  var ms, built;
  try {
    ms = loadDocx(src, docxName);
    showProgress("段落の種類を判定しています…");
    built = buildItems(ms, profile);
  } catch (e2) {
    hideProgress();
    if (ms && ms.folder) removeFolder(ms.folder);
    alert("Word 原稿を読み込めませんでした:\n" + e2.message + "\n\n.docx 形式で保存し直してから選んでください。");
    return;
  }
  hideProgress();

  var sty = findStylesByName(doc);
  var styleMap = initialStyleMap(profile, sty.names);
  var notes = [];
  if (profile.learnedFrom === 0) notes.push("※ 前回号の体裁を学習できなかったため、スタイル名から推測しています。");
  if (front) notes.push("※ 題目〜キーワードは、別のテキストボックス(前回号で題目があった所)に入れます。");
  if (tailStart >= 0) notes.push("※ 英文要旨の部分は原稿にないため、前回号のまま残します。");
  if (!confirmDialog(built, profile, styleMap, sty.names, { docxName: docxName, notes: notes })) {
    if (ms.folder) removeFolder(ms.folder);
    return;
  }

  // 前付けを別ストーリーに分ける
  var FRONT = { title: 1, subtitle: 1, author: 1, affiliation: 1, abstractTitle: 1, "abstract": 1, keywords: 1 };
  var frontBuilt = null;
  if (front) {
    var fi = [], bi = [], x, inFront = true;
    for (x = 0; x < built.items.length; x++) {
      var ro = built.items[x].role === "blank" ? built.items[x].forRole : built.items[x].role;
      if (inFront && !FRONT[ro]) inFront = false;
      (inFront ? fi : bi).push(built.items[x]);
    }
    while (bi.length > 0 && bi[0].role === "blank") bi.shift();
    frontBuilt = { items: fi, notes: 0 };
    built = { items: bi, notes: built.notes, warnings: built.warnings };
  }

  var newTitle = null;
  for (k = 0; k < (frontBuilt ? frontBuilt.items : built.items).length; k++) {
    var itx = (frontBuilt ? frontBuilt.items : built.items)[k];
    if (itx.role === "title") { newTitle = trimWS(itx.text.replace(/[（(][\s　\u2002-\u200A]*[0-9０-９]{1,3}[\s　\u2002-\u200A]*[）)]/g, "")); break; }
  }

  showProgress("図の画像を取り出しています…");
  var images = {};
  try { images = extractImages(doc, ms, built.items, docxName); } catch (e3) {}
  if (ms.folder) removeFolder(ms.folder);
  hideProgress();

  var report = [];
  _ctx = {
    doc: doc, story: story, tailStart: tailStart, built: built,
    styleNames: resolveStyleNames(built.items, profile, styleMap),
    styleObjs: sty.map, defaultStyle: sty.map[styleMap.body] || null, images: images, report: report,
    oldTitle: oldTitle, newTitle: newTitle,
    charStyles: {
      noteRef: findCharStyle(doc, profile.charStyles.noteRef),
      dash: findCharStyle(doc, profile.charStyles.dash),
      keywordsLabel: findCharStyle(doc, profile.charStyles.keywordsLabel),
      figSourceLabel: findCharStyle(doc, profile.charStyles.figSourceLabel)
    },
    tableTemplate: null, tableHeadStyle: null, tableBodyStyle: null,
    front: front ? { story: front.story, built: frontBuilt, styleNames: resolveStyleNames(frontBuilt.items, profile, styleMap) } : null
  };
  var tn;
  for (tn = 0; tn < sty.names.length; tn++) {
    if (!_ctx.tableHeadStyle && /表.*(ゴチ|見出し|ヘッダ)/.test(sty.names[tn])) _ctx.tableHeadStyle = sty.map[sty.names[tn]];
    if (!_ctx.tableBodyStyle && /表.*(明朝|本文)/.test(sty.names[tn])) _ctx.tableBodyStyle = sty.map[sty.names[tn]];
  }

  showProgress("流し込んでいます… (しばらくかかります)");
  var oldUIL = app.scriptPreferences.userInteractionLevel;
  try {
    app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
    app.doScript(runApply, ScriptLanguage.JAVASCRIPT, [], UndoModes.ENTIRE_SCRIPT, "紀要の流し込み");
  } catch (e4) {
    hideProgress();
    app.scriptPreferences.userInteractionLevel = oldUIL;
    alert("流し込みの途中でエラーが発生しました:\n" + e4.message + (e4.line ? " (" + e4.line + " 行目)" : "") +
          "\n\n「編集 > 取り消し」で元に戻せます。");
    return;
  }
  app.scriptPreferences.userInteractionLevel = oldUIL;
  hideProgress();

  // 空いたページの削除 (確認してから)
  var empties = emptyTrailingPages(story), undoCount = 1;
  if (empties.length > 0 && confirm("本文が前回より短くなったため、空のページが " + empties.length + " ページあります。削除しますか?")) {
    _emptyPages = empties;
    app.doScript(removeEmptyPages, ScriptLanguage.JAVASCRIPT, [], UndoModes.ENTIRE_SCRIPT, "空きページの削除");
    report.push("空のページを " + empties.length + " ページ削除しました。");
    undoCount = 2;
  }

  report.push("");
  report.push("仕上げに確認してください:");
  report.push("・見出し・表・図の位置と体裁");
  report.push("・偶数ページの柱 (号数など) と開始ページ番号");
  report.push("・欧文の斜体など、Word 上の文字の飾り (取り込んでいません)");
  report.push("・英文要旨のページ (Word 原稿に含まれていなければ前回号のままです)");
  alert("流し込みが終わりました。\n\n" + report.join("\n") +
        "\n\n元に戻すときは「編集 > 取り消し」を " + undoCount + " 回。");
}

var _emptyPages = null;
function removeEmptyPages() {
  var k;
  for (k = 0; k < _emptyPages.length; k++) { try { _emptyPages[k].remove(); } catch (e) {} }
}

if (typeof app !== "undefined" && app.name && /InDesign/i.test(app.name)) {
  try {
    main();
  } catch (e) {
    hideProgress();
    alert("エラーが発生しました:\n" + e.message + (e.line ? "\n(スクリプトの " + e.line + " 行目)" : ""));
  }
}
