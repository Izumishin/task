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
  s = s.replace(/&#x[0-9A-Fa-f]+;/g, function (m0) { return String.fromCharCode(parseInt(m0.substring(3, m0.length - 1), 16)); });
  s = s.replace(/&#[0-9]+;/g, function (m0) { return String.fromCharCode(parseInt(m0.substring(2, m0.length - 1), 10)); });
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
    name = name.replace(/\\/g, "/").replace(/^\//, "");
    idx[name] = { method: method, csize: csize, usize: usize, dataOfs: dataOfs };
    if (!idx["\u0001" + name.toLowerCase()]) idx["\u0001" + name.toLowerCase()] = idx[name];
    ofs += 46 + nameLen + extraLen + cmtLen;
  }
  return idx;
}

// エントリをバイナリ文字列 (1文字=1バイト) で取り出す
function zipEntryBinary(bin, idx, name) {
  var ent = idx[name] || idx["\u0001" + name.toLowerCase()];
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
  var ent = idx[name] || idx["\u0001" + name.toLowerCase()];
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
  var styles = {}, pos = 0, lt, gt, tag, name, cur = null, inRPr = 0;
  if (!xml) return styles;
  while (true) {
    lt = xml.indexOf("<", pos); if (lt < 0) break;
    gt = xml.indexOf(">", lt); if (gt < 0) break;
    tag = xml.substring(lt + 1, gt); pos = gt + 1;
    if (tag.charAt(0) === "/") {
      if (tag === "/w:style") cur = null;
      else if (tag === "/w:rPr" && inRPr > 0) inRPr--;
      continue;
    }
    name = _tagName(tag);
    if (name === "w:style") {
      cur = { id: xmlAttr(tag, "w:styleId") || "", type: xmlAttr(tag, "w:type") || "", name: "", basedOn: null, outline: null, fmt: {},
              numId: null, ilvl: null };
      styles[cur.id] = cur;
    } else if (cur !== null) {
      if (name === "w:name") cur.name = xmlAttr(tag, "w:val") || "";
      else if (name === "w:basedOn") cur.basedOn = xmlAttr(tag, "w:val");
      else if (name === "w:outlineLvl") cur.outline = parseInt(xmlAttr(tag, "w:val"), 10);
      else if (name === "w:numId") cur.numId = xmlAttr(tag, "w:val");
      else if (name === "w:ilvl") cur.ilvl = xmlAttr(tag, "w:val");
      else if (name === "w:rPr" && tag.charAt(tag.length - 1) !== "/") inRPr++;
      else if (inRPr > 0) readRunProp(name, tag, cur.fmt);
    }
  }
  return styles;
}

// ---- Word の自動の箇条書き・段落番号 ----
// Word の「・」や「1.」は本文の文字ではなく、番号の設定 (numbering.xml) から Word が表示している。
// その設定を読んで、Word と同じ記号・番号を文字として段落の頭に入れる。

// numbering.xml → { abs: { 抽象番号ID: { lvls: { 段: 設定 } } }, nums: { 番号ID: { abs, ov: { 段: { start, lvl } } } } }
function parseNumbering(xml) {
  var res = { abs: {}, nums: {} }, pos = 0, lt, gt, tag, name, curAbs = null, curLvl = null, curNum = null, curOv = null, fallback = 0;
  if (!xml) return res;
  while (true) {
    lt = xml.indexOf("<", pos); if (lt < 0) break;
    gt = xml.indexOf(">", lt); if (gt < 0) break;
    tag = xml.substring(lt + 1, gt); pos = gt + 1;
    if (tag.charAt(0) === "/") {
      name = tag.substring(1);
      if (name === "w:abstractNum") curAbs = null;
      else if (name === "w:lvl") curLvl = null;
      else if (name === "w:num") curNum = null;
      else if (name === "w:lvlOverride") curOv = null;
      else if (name === "mc:Fallback") { if (fallback > 0) fallback--; }
      continue;
    }
    if (tag.charAt(0) === "?" || tag.charAt(0) === "!") continue;
    name = _tagName(tag);
    // Word 2010 以降の独自形式 (mc:Choice) と、その代わりの形式 (mc:Fallback) がある場合は、代わりの形式を使う
    if (name === "mc:Fallback") { if (tag.charAt(tag.length - 1) !== "/") fallback++; continue; }
    if (name === "w:abstractNum") { curAbs = { lvls: {} }; res.abs[xmlAttr(tag, "w:abstractNumId")] = curAbs; }
    else if (name === "w:num") { curNum = { abs: null, ov: {} }; res.nums[xmlAttr(tag, "w:numId")] = curNum; }
    else if (name === "w:abstractNumId" && curNum !== null) curNum.abs = xmlAttr(tag, "w:val");
    else if (name === "w:lvlOverride" && curNum !== null) { curOv = { start: null, lvl: null }; curNum.ov[xmlAttr(tag, "w:ilvl")] = curOv; }
    else if (name === "w:startOverride" && curOv !== null) curOv.start = parseInt(xmlAttr(tag, "w:val"), 10);
    else if (name === "w:lvl") {
      curLvl = { start: 1, fmt: "decimal", text: "", suff: "tab", restart: null, isLgl: false };
      if (curOv !== null) curOv.lvl = curLvl;
      else if (curAbs !== null) curAbs.lvls[xmlAttr(tag, "w:ilvl")] = curLvl;
    } else if (curLvl !== null) {
      if (name === "w:start") curLvl.start = parseInt(xmlAttr(tag, "w:val"), 10) || 0;
      else if (name === "w:numFmt") {
        var nf = xmlAttr(tag, "w:val");
        if (nf && (nf !== "custom" || fallback > 0)) curLvl.fmt = nf;
      }
      else if (name === "w:lvlText") curLvl.text = xmlAttr(tag, "w:val") || "";
      else if (name === "w:suff") curLvl.suff = xmlAttr(tag, "w:val") || "tab";
      else if (name === "w:lvlRestart") curLvl.restart = parseInt(xmlAttr(tag, "w:val"), 10);
      else if (name === "w:isLgl") curLvl.isLgl = _isOn(tag);
    }
  }
  return res;
}

var KANA_AIUEO = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン";
var KANA_IROHA = "イロハニホヘトチリヌルヲワカヨタレソツネナラムウヰノオクヤマケフコエテアサキユメミシヱヒモセス";
var KANJI_DIGITS = "〇一二三四五六七八九";

function _roman(n) {
  var vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  var syms = ["M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I"], out = "", i;
  for (i = 0; i < vals.length; i++) while (n >= vals[i]) { out += syms[i]; n -= vals[i]; }
  return out;
}

function _kanjiCount(n) {
  if (n <= 0) return String(n);
  if (n >= 10000) return String(n);
  var units = ["", "十", "百", "千"], out = "", i, d, s = String(n);
  for (i = 0; i < s.length; i++) {
    d = parseInt(s.charAt(i), 10);
    var u = units[s.length - 1 - i];
    if (d === 0) continue;
    out += (d === 1 && u !== "" ? "" : KANJI_DIGITS.charAt(d)) + u;
  }
  return out;
}

// Word の番号の形式 (numFmt) で数を文字にする
function formatListNumber(n, fmt) {
  var s, i;
  if (fmt === "none" || fmt === "bullet") return "";
  if (fmt === "decimalFullWidth" || fmt === "decimalFullWidth2") return toZenDigits(String(n));
  if (fmt === "decimalZero") return n < 10 ? "0" + n : String(n);
  if (fmt === "upperLetter" || fmt === "lowerLetter") {
    var ch = String.fromCharCode(65 + ((n - 1) % 26)), rep2 = Math.floor((n - 1) / 26) + 1;
    s = ""; for (i = 0; i < rep2; i++) s += ch;
    return fmt === "lowerLetter" ? s.toLowerCase() : s;
  }
  if (fmt === "upperRoman") return _roman(n);
  if (fmt === "lowerRoman") return _roman(n).toLowerCase();
  if (fmt === "decimalEnclosedCircle" || fmt === "decimalEnclosedCircleChinese" || fmt === "ideographEnclosedCircle") {
    if (n >= 1 && n <= 20) return String.fromCharCode(0x2460 + n - 1);
    if (n >= 21 && n <= 35) return String.fromCharCode(0x3251 + n - 21);
    if (n >= 36 && n <= 50) return String.fromCharCode(0x32B1 + n - 36);
    return "(" + n + ")";
  }
  if (fmt === "decimalEnclosedParen") return n >= 1 && n <= 20 ? String.fromCharCode(0x2474 + n - 1) : "(" + n + ")";
  if (fmt === "decimalEnclosedFullstop") return n >= 1 && n <= 20 ? String.fromCharCode(0x2488 + n - 1) : n + ".";
  if (fmt === "aiueo" || fmt === "aiueoFullWidth") return KANA_AIUEO.charAt((n - 1) % KANA_AIUEO.length);
  if (fmt === "iroha" || fmt === "irohaFullWidth") return KANA_IROHA.charAt((n - 1) % KANA_IROHA.length);
  if (fmt === "ideographTraditional") return "甲乙丙丁戊己庚辛壬癸".charAt((n - 1) % 10);
  if (fmt === "ideographZodiac") return "子丑寅卯辰巳午未申酉戌亥".charAt((n - 1) % 12);
  if (fmt === "japaneseCounting" || fmt === "chineseCounting" || fmt === "chineseCountingThousand" ||
      fmt === "taiwaneseCounting" || fmt === "taiwaneseCountingThousand" || fmt === "koreanCounting") return _kanjiCount(n);
  if (fmt === "japaneseLegal") return _kanjiCount(n).split("一").join("壱").split("二").join("弐").split("三").join("参").split("十").join("拾");
  if (fmt === "ideographDigital" || fmt === "japaneseDigitalTenThousand" || fmt === "taiwaneseDigital") {
    s = String(n); var out = "";
    for (i = 0; i < s.length; i++) out += KANJI_DIGITS.charAt(parseInt(s.charAt(i), 10));
    return out;
  }
  if (fmt === "ordinal") {
    var t = n % 100, e = n % 10;
    return n + (t >= 11 && t <= 13 ? "th" : e === 1 ? "st" : e === 2 ? "nd" : e === 3 ? "rd" : "th");
  }
  return String(n);
}

// Word の記号の箇条書きは Symbol / Wingdings 書体の特別な文字コードのことが多いので、ふつうの記号にする
var BULLET_MAP = {
  "\uF0B7": "•", "\uF06C": "●", "\uF0A7": "▪", "\uF06E": "■", "\uF0A8": "□", "\uF06F": "□", "\uF071": "❑",
  "\uF076": "◆", "\uF075": "◆", "\uF0D8": "➢", "\uF0FC": "✓", "\uF0E0": "→", "\uF0DC": "▶", "\uF0B2": "◇",
  "\uF09F": "•", "\uF0A1": "○", "\uF0FB": "✗"
};
function _mapBulletChars(t) {
  var out = "", i, ch;
  for (i = 0; i < t.length; i++) {
    ch = t.charAt(i);
    if (BULLET_MAP.hasOwnProperty(ch)) out += BULLET_MAP[ch];
    else if (ch >= "\uF000" && ch <= "\uF0FF") out += "・";
    else out += ch;
  }
  return out;
}

function createNumState(numbering) { return { nb: numbering, counters: {}, used: {} }; }

// 段落の番号・記号を1つ進めて、表示する文字を返す。番号がない段落は null
function nextListLabel(state, numId, ilvl) {
  if (!state || numId === null || numId === undefined || numId === "0") return null;
  var nb = state.nb, num = nb.nums[numId];
  if (!num) return null;
  var abs = nb.abs[num.abs];
  if (!abs) return null;
  function lvlDef(L) {
    var ov = num.ov[String(L)];
    if (ov && ov.lvl) return ov.lvl;
    return abs.lvls[String(L)] || null;
  }
  var L = parseInt(ilvl, 10) || 0, def = lvlDef(L), d;
  if (def === null) return null;
  // 番号は、同じ抽象番号を使う段落どうしで続く (Word の「番号を振り直す」は開始番号の上書きになる)
  var c = state.counters[num.abs];
  if (!c) { c = {}; state.counters[num.abs] = c; }
  var ov = num.ov[String(L)], ukey = numId + ":" + L;
  if (ov && ov.start !== null && !isNaN(ov.start) && !state.used[ukey]) c[L] = ov.start;
  else if (c[L] === undefined) c[L] = def.start;
  else c[L] = c[L] + 1;
  state.used[ukey] = true;
  // 下の段の番号は、上の段が進んだら振り直す (「振り直さない」設定の段は除く)
  for (d = L + 1; d < 9; d++) {
    var dd = lvlDef(d);
    if (dd && dd.restart === 0) continue;
    if (dd && dd.restart !== null && !isNaN(dd.restart) && L > dd.restart - 1) continue;
    c[d] = undefined;
  }
  // 番号の文字 (%1 など) を、各段の番号に置き換える (正規表現を使わずに1文字ずつ)
  var text = def.text, out = "", i, ch, lv, ldef, val;
  if (def.fmt === "bullet") return { label: _mapBulletChars(text), suff: def.suff, bullet: true };
  for (i = 0; i < text.length; i++) {
    ch = text.charAt(i);
    if (ch === "%" && i + 1 < text.length && text.charAt(i + 1) >= "1" && text.charAt(i + 1) <= "9") {
      lv = parseInt(text.charAt(i + 1), 10) - 1;
      ldef = lvlDef(lv) || def;
      val = c[lv] !== undefined ? c[lv] : ldef.start;
      out += formatListNumber(val, def.isLgl ? "decimal" : ldef.fmt);
      i++;
    } else out += ch;
  }
  return { label: out, suff: def.suff, bullet: false };
}

// 番号と本文の間: Word の「タブ」「スペース」は、全角の記号・番号の後なら詰め、半角の後なら半角スペース
function listSeparator(label, suff) {
  if (suff === "nothing" || label === "") return "";
  var last = label.charCodeAt(label.length - 1);
  return last >= 0x2460 ? "" : " ";
}

// ---- 文字の飾り (イタリック・太字・下線・上付き・下付き・圏点・取り消し線・ルビ) ----

var FMT_KINDS = [
  ["italic", "イタリック"], ["bold", "太字"], ["underline", "下線"],
  ["uDouble", "下二重線"], ["uThick", "太い下線"], ["uDotted", "下点線"], ["uDash", "下破線"],
  ["uDotDash", "下一点鎖線"], ["uDotDotDash", "下二点鎖線"], ["uWave", "下波線"], ["uWavyDouble", "下二重波線"],
  ["sup", "上付き"], ["sub", "下付き"],
  ["kenten", "圏点"], ["strike", "取り消し線"], ["dstrike", "二重取り消し線"], ["highlight", "蛍光ペン"], ["ruby", "ルビ"]
];

// 下線の線種 (1つの文字に付く下線は1種類なので、付け替えるときは他の線種を消す)
var UNDERLINE_KINDS = ["underline", "uDouble", "uThick", "uDotted", "uDash", "uDotDash", "uDotDotDash", "uWave", "uWavyDouble"];
var STRIKE_KINDS = ["strike", "dstrike"];

// Word の下線の線種 (w:u の値) → 下線の種類。太さ違いは同じ種類にまとめる
// (「double」などは InDesign の古い JavaScript の予約語なので、名前はすべて引用符で囲む)
var WORD_UNDERLINE = {
  "single": "underline", "words": "underline", "double": "uDouble", "thick": "uThick",
  "dotted": "uDotted", "dottedHeavy": "uDotted",
  "dash": "uDash", "dashedHeavy": "uDash", "dashLong": "uDash", "dashLongHeavy": "uDash",
  "dotDash": "uDotDash", "dashDotHeavy": "uDotDash", "dotDotDash": "uDotDotDash", "dashDotDotHeavy": "uDotDotDash",
  "wave": "uWave", "wavyHeavy": "uWave", "wavyDouble": "uWavyDouble"
};

// その線種の文字スタイルがないときの代わり (線が消えるよりは、ふつうの下線・取り消し線にする)
var FMT_FALLBACK = {
  uDouble: "underline", uThick: "underline", uDotted: "underline", uDash: "underline", uDotDash: "underline",
  uDotDotDash: "uDotDash", uWave: "underline", uWavyDouble: "underline", dstrike: "strike"
};

function _clearKinds(fmt, kinds) { var i; for (i = 0; i < kinds.length; i++) delete fmt[kinds[i]]; }

function fmtLabel(kind) {
  var i;
  for (i = 0; i < FMT_KINDS.length; i++) if (FMT_KINDS[i][0] === kind) return FMT_KINDS[i][1];
  return kind;
}

function _isOn(tag) {
  var v = xmlAttr(tag, "w:val");
  return v === null || !(v === "0" || v === "false" || v === "off" || v === "none");
}

// <w:rPr> の中の1つのタグを読んで fmt に反映する
function readRunProp(name, tag, fmt) {
  var v;
  if (name === "w:i") { if (_isOn(tag)) fmt.italic = true; else delete fmt.italic; }
  else if (name === "w:b") { if (_isOn(tag)) fmt.bold = true; else delete fmt.bold; }
  else if (name === "w:u") {
    // 下線は1種類。「なし」はスタイルから受け継いだ下線も消す (_uOff は受け継ぎ用の目印)
    _clearKinds(fmt, UNDERLINE_KINDS);
    v = xmlAttr(tag, "w:val");
    if (_isOn(tag)) { fmt[WORD_UNDERLINE.hasOwnProperty(v) ? WORD_UNDERLINE[v] : "underline"] = true; delete fmt._uOff; }
    else fmt._uOff = 1;
  }
  else if (name === "w:strike" || name === "w:dstrike") {
    var sk = name === "w:dstrike" ? "dstrike" : "strike";
    if (_isOn(tag)) { _clearKinds(fmt, STRIKE_KINDS); fmt[sk] = true; delete fmt._sOff; }
    else { delete fmt[sk]; fmt._sOff = 1; }
  }
  else if (name === "w:em") { if (_isOn(tag)) fmt.kenten = true; else delete fmt.kenten; }
  else if (name === "w:highlight") { if (_isOn(tag)) fmt.highlight = true; else delete fmt.highlight; }
  else if (name === "w:vertAlign") {
    v = xmlAttr(tag, "w:val");
    delete fmt.sup; delete fmt.sub;
    if (v === "superscript") fmt.sup = true;
    else if (v === "subscript") fmt.sub = true;
  }
}

// 段落スタイルに付いた番号の設定 (基にしたスタイルも含む) → { numId, ilvl } / なければ null
function docxStyleNum(styles, id) {
  var s = styles[id], guard = 0, numId = null, ilvl = null;
  while (s && guard++ < 10) {
    if (numId === null && s.numId !== null) numId = s.numId;
    if (ilvl === null && s.ilvl !== null) ilvl = s.ilvl;
    s = s.basedOn ? styles[s.basedOn] : null;
  }
  return numId === null ? null : { numId: numId, ilvl: ilvl };
}

// Word の文字スタイル (基にしたスタイルも含む) の飾り。リンクや注番号のスタイルは飾りとして扱わない
function docxStyleFmt(styles, id) {
  var chain = [], s = styles[id], guard = 0, out = {}, i, k;
  while (s && guard++ < 10) { chain.unshift(s); s = s.basedOn ? styles[s.basedOn] : null; }
  if (chain.length === 0) return out;
  if (/hyperlink|ハイパーリンク|footnote|endnote|脚注|文末/i.test(chain[chain.length - 1].name)) return out;
  for (i = 0; i < chain.length; i++) {
    var f = chain[i].fmt, hasU = !!f._uOff, hasS = !!f._sOff, q;
    for (q = 0; q < UNDERLINE_KINDS.length; q++) if (f[UNDERLINE_KINDS[q]]) hasU = true;
    for (q = 0; q < STRIKE_KINDS.length; q++) if (f[STRIKE_KINDS[q]]) hasS = true;
    // 基にしたスタイルの線種は、後のスタイルの線種で置き換わる
    if (hasU) _clearKinds(out, UNDERLINE_KINDS);
    if (hasS) _clearKinds(out, STRIKE_KINDS);
    for (k in f) if (f.hasOwnProperty(k) && f[k] === true) out[k] = true;
  }
  return out;
}

function _fmtKey(f) {
  var k, keys = [];
  for (k in f) if (f.hasOwnProperty(k) && f[k] === true) keys.push(k);
  keys.sort();
  return keys.join("+");
}

// 1つの区間に当てる文字スタイル (飾りが重なっているときは、上付き・下付き → 斜体 → 太字 … の順で1つ)
var FMT_PRIORITY = ["sup", "sub", "italic", "bold", "underline", "uDouble", "uThick", "uDotted", "uDash", "uDotDash",
                    "uDotDotDash", "uWave", "uWavyDouble", "kenten", "strike", "dstrike", "highlight"];

// InDesign の線の種類の名前 (日本語版・英語版) と太さから、線種を決める
function strokeKindOf(typeName, weight) {
  var t = String(typeName || "");
  if (/二重波|Double\s*Wav/i.test(t)) return "wavyDouble";
  if (/波|Wav/i.test(t)) return "wave";
  if (/二点鎖線|Dash\s*-?\s*Dot\s*-?\s*Dot|Dot\s*-?\s*Dot\s*-?\s*Dash/i.test(t)) return "dotDotDash";
  if (/鎖線|Dot\s*-?\s*Dash|Dash\s*-?\s*Dot/i.test(t)) return "dotDash";
  if (/点線|Dotted|Dots|ドット/i.test(t)) return "dotted";
  if (/破線|Dash/i.test(t)) return "dash";
  if (/二重|細\s*-\s*細|太\s*-\s*太|太\s*-\s*細|細\s*-\s*太|Thin\s*-\s*Thin|Thick\s*-\s*Thick|Thick\s*-\s*Thin|Thin\s*-\s*Thick|Double/i.test(t)) return "double";
  if (typeof weight === "number" && weight >= 1.5) return "thick";
  return "single";
}

var UNDERLINE_STROKE = { underline: "single", uDouble: "double", uThick: "thick", uDotted: "dotted", uDash: "dash",
                         uDotDash: "dotDash", uDotDotDash: "dotDotDash", uWave: "wave", uWavyDouble: "wavyDouble" };
var UNDERLINE_NAME = { uDouble: /下二重線|二重下線/, uThick: /太い?下線|下太線/, uDotted: /下点線|点線/, uDash: /下破線|破線/,
                       uDotDash: /一点鎖線/, uDotDotDash: /二点鎖線/, uWave: /下波線|波線/, uWavyDouble: /二重波/ };

// 和文の文字 (かな・漢字・全角の記号)
var RE_JA_CHAR = /[\u3000-\u30FF\u3400-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;

// 斜体の区間を、和文の部分と欧文の部分に分ける (和文の部分には ja を付ける)。
// 和文の書体にはイタリックがないので、和文は「和文の斜体」用の文字スタイルを当てるため
function splitJaItalic(spans, text) {
  var out = [], i, j, sp, cur, segStart, ch, cls;
  function push(a, b, c) {
    if (b <= a) return;
    var seg = _copySpan(sp);
    seg.start = a; seg.end = b;
    if (c === "ja") seg.ja = true; else delete seg.ja;
    seg.key = comboKey(seg);
    out.push(seg);
  }
  for (i = 0; i < spans.length; i++) {
    sp = spans[i];
    if (!sp.italic || sp.ruby) { out.push(sp); continue; }
    cur = null; segStart = sp.start;
    for (j = sp.start; j < sp.end; j++) {
      ch = text.charAt(j);
      cls = RE_JA_CHAR.test(ch) && ch !== "\u3000" ? "ja" : (/\s/.test(ch) || ch === "\u3000" ? null : "lat");
      if (cls === null) continue;          // 空白は前の部分に含める
      if (cur === null) cur = cls;
      else if (cls !== cur) { push(segStart, j, cur); segStart = j; cur = cls; }
    }
    push(segStart, sp.end, cur || "lat");
  }
  return out;
}

// 飾りの組み合わせの名前 ("italic+bold" / "italic+ja" / "ruby" など)。対応表の見出しになる
function comboKey(sp) {
  if (sp.ruby) return "ruby";
  var parts = [], i;
  for (i = 0; i < FMT_PRIORITY.length; i++) if (sp[FMT_PRIORITY[i]]) parts.push(FMT_PRIORITY[i]);
  if (sp.ja && sp.italic) parts.push("ja");
  return parts.join("+");
}

function comboLabel(key) {
  if (key === "ruby") return "ルビ";
  var parts = key.split("+"), out = [], i, ja = false;
  for (i = 0; i < parts.length; i++) if (parts[i] === "ja") ja = true;
  for (i = 0; i < parts.length; i++) {
    if (parts[i] === "ja") continue;
    out.push(parts[i] === "italic" && ja ? "和文の斜体" : fmtLabel(parts[i]));
  }
  return out.join("＋");
}

// 表のセルの中の飾り → [行][列] の区間の配列。
// 斜体は和文・欧文に分ける。1行目のセル全体の太字は見出し行の書式なので、表の体裁に任せて外す
// (それ以外のセル全体の下線などは、意味を持つことがあるのでそのまま残す)
function tableCellFmt(tb) {
  var out = [], r, c, list, sp, i, row, text, core;
  if (!tb.fmts) return out;
  for (r = 0; r < tb.rows.length; r++) {
    row = [];
    for (c = 0; c < tb.rows[r].length; c++) {
      text = tb.rows[r][c];
      list = [];
      var src = tb.fmts[r] && tb.fmts[r][c] ? tb.fmts[r][c] : [];
      for (i = 0; i < src.length; i++) list.push(_copySpan(src[i]));
      list = fitSpans(list, text.length);
      if (r === 0) {
        core = text.replace(/[\s　\t\r]/g, "").length;
        var kept = [];
        for (i = 0; i < list.length; i++) {
          sp = list[i];
          if (sp.bold && core > 0 && text.substring(sp.start, sp.end).replace(/[\s　\t\r]/g, "").length / core >= 0.9) {
            delete sp.bold; sp.key = _fmtKey(sp);
            if (sp.key === "") continue;
          }
          kept.push(sp);
        }
        list = kept;
      }
      row.push(splitJaItalic(list, text));
    }
    out.push(row);
  }
  return out;
}

// 原稿に出てくる組み合わせごとの数 (本文・注・脚注・表の中)
function countFmtCombos(built) {
  var cnt = {}, i, j, list = [], k, r, c;
  for (i = 0; i < built.items.length; i++) {
    if (built.items[i].fmt) list = list.concat(built.items[i].fmt);
    var cf = built.items[i].cellFmt;
    if (cf) for (r = 0; r < cf.length; r++) for (c = 0; c < cf[r].length; c++) list = list.concat(cf[r][c]);
  }
  if (built.footnotes) for (i = 0; i < built.footnotes.length; i++) if (built.footnotes[i].fmt) list = list.concat(built.footnotes[i].fmt);
  for (j = 0; j < list.length; j++) { k = comboKey(list[j]); if (k !== "") cnt[k] = (cnt[k] || 0) + 1; }
  return cnt;
}

// 組み合わせに合う文字スタイルを、文字スタイルの設定から選ぶ。
// 組み合わせのすべてを満たすスタイルだけが候補。余分な設定が少ないものを優先する
function guessComboStyleNames(keys, descs) {
  var out = {}, i, j, d, key, parts, ja, ok, sc, best, bestSc;
  function has(dd, part, isJa) {
    if (part === "italic") {
      if (isJa) return (dd.skew ? 2 : 0) + (/斜体/.test(dd.name) && !/イタリック|italic/i.test(dd.name) ? 1 : 0);
      return (/Italic|Oblique/i.test(dd.fontStyle) ? 2 : 0) + (/イタリック|italic/i.test(dd.name) ? 1 : 0);
    }
    if (part === "bold") return (/Bold|Heavy|Black/i.test(dd.fontStyle) ? 2 : 0) + (/太字|ボールド|bold/i.test(dd.name) ? 1 : 0);
    if (UNDERLINE_STROKE.hasOwnProperty(part)) {
      var uk = dd.underline ? strokeKindOf(dd.uTypeName, dd.uWeight) : null;
      if (part === "underline") {
        return (uk === "single" ? 2 : 0) +
               (/下線|アンダー|underline/i.test(dd.name) && !/点線|破線|波線|二重|鎖線|太/.test(dd.name) ? 1 : 0);
      }
      return (uk === UNDERLINE_STROKE[part] ? 2 : 0) + (UNDERLINE_NAME[part].test(dd.name) ? 1 : 0);
    }
    if (part === "dstrike") {
      return (dd.strike && strokeKindOf(dd.sTypeName) === "double" ? 2 : 0) + (/二重取り?消し|二重打ち?消し/.test(dd.name) ? 1 : 0);
    }
    if (part === "sup") return (dd.position === "sup" ? 2 : 0) + (/上付/.test(dd.name) ? 1 : 0);
    if (part === "sub") return (dd.position === "sub" ? 2 : 0) + (/下付/.test(dd.name) ? 1 : 0);
    if (part === "kenten") return (dd.kenten ? 2 : 0) + (/圏点|傍点/.test(dd.name) ? 1 : 0);
    if (part === "strike") {
      return (dd.strike && strokeKindOf(dd.sTypeName) !== "double" ? 2 : 0) +
             (/取り?消し|打ち?消し|strike/i.test(dd.name) && !/二重/.test(dd.name) ? 1 : 0);
    }
    if (part === "ruby") return (dd.ruby ? 2 : 0) + (/ルビ|ruby/i.test(dd.name) ? 1 : 0);
    return 0;
  }
  var ALL = FMT_PRIORITY;
  for (i = 0; i < keys.length; i++) {
    key = keys[i]; parts = key.split("+"); ja = false; best = null; bestSc = 0;
    for (j = 0; j < parts.length; j++) if (parts[j] === "ja") ja = true;
    for (var n = 0; n < descs.length; n++) {
      d = descs[n];
      if (!d.name || d.name.charAt(0) === "[") continue;
      ok = true; sc = 0;
      for (j = 0; j < parts.length; j++) {
        if (parts[j] === "ja") continue;
        var h = has(d, parts[j], ja);
        if (h === 0) { ok = false; break; }
        sc += h;
      }
      if (!ok) continue;
      // 組み合わせにない飾りを持つスタイルは減点 (イタリックに「太字のイタリック」を選ばないように)
      for (j = 0; j < ALL.length; j++) {
        if (("+" + key + "+").indexOf("+" + ALL[j] + "+") >= 0) continue;
        if (has(d, ALL[j], false) >= 2 || (ALL[j] === "italic" && d.skew)) sc -= 2;
      }
      if (sc > bestSc) { bestSc = sc; best = d.name; }
    }
    if (best !== null) out[key] = best;
  }
  return out;
}

// 1つの区間に使う対応表の見出し。組み合わせの指定がなければ、欧文は単独の飾りで代用する
// (和文の斜体は、欧文のイタリックで代用すると字形がなくなることがあるので代用しない)
function pickFmtStyleKey(span, map) {
  var key = comboKey(span), i;
  if (map[key]) return key;
  if (span.ja && span.italic) return map["italic+ja"] ? "italic+ja" : null;
  for (i = 0; i < FMT_PRIORITY.length; i++) {
    var kd = FMT_PRIORITY[i];
    if (!span[kd]) continue;
    if (map[kd]) return kd;
    var fb = FMT_FALLBACK[kd], hop = 0;
    while (fb && hop++ < 4) { if (map[fb]) return fb; fb = FMT_FALLBACK[fb]; }
  }
  return null;
}

// 組み合わせの名前 ("uDotted+italic" など) → 区間の形 (確認画面で、代わりに使うスタイルを示すため)
function spanFromKey(key) {
  var sp = {}, parts = key.split("+"), i;
  if (key === "ruby") { sp.ruby = "x"; return sp; }
  for (i = 0; i < parts.length; i++) sp[parts[i]] = true;
  return sp;
}

// ---- 飾りの区間の位置合わせ (文字の差し込み・削除に合わせてずらす) ----

function _copySpan(sp) { var o = {}, k; for (k in sp) if (sp.hasOwnProperty(k)) o[k] = sp[k]; return o; }

// [from, to) の部分だけを取り出し、offset を引いた位置にする
function clipSpans(list, from, to, offset) {
  var out = [], i, sp;
  if (!list) return out;
  for (i = 0; i < list.length; i++) {
    if (list[i].end <= from || list[i].start >= to) continue;
    sp = _copySpan(list[i]);
    sp.start = Math.max(sp.start, from) - offset;
    sp.end = Math.min(sp.end, to) - offset;
    if (sp.end > sp.start) out.push(sp);
  }
  return out;
}

// 注番号などを差し込んだぶんずらす。marks: [{ pos (差し込む前の位置), len }]
// 区間の始まりと同じ位置に差し込んだ文字は区間の前、終わりと同じ位置なら区間の後ろに来る
function shiftSpansForMarks(list, marks) {
  var i, j, sp, a, b;
  for (i = 0; i < list.length; i++) {
    sp = list[i]; a = 0; b = 0;
    for (j = 0; j < marks.length; j++) {
      if (marks[j].pos <= sp.start) a += marks[j].len;
      if (marks[j].pos < sp.end) b += marks[j].len;
    }
    sp.start += a; sp.end += b;
  }
}

function moveSpans(list, delta) {
  var i;
  if (!list || !delta) return;
  for (i = 0; i < list.length; i++) { list[i].start += delta; list[i].end += delta; }
}

// 文字数の範囲に収め、空になった区間を除く
function fitSpans(list, len) {
  var out = [], i;
  for (i = 0; i < list.length; i++) {
    if (list[i].start < 0) list[i].start = 0;
    if (list[i].end > len) list[i].end = len;
    if (list[i].end > list[i].start) out.push(list[i]);
  }
  return out;
}

// 見出しなどの段落全体にかかった太字・斜体・下線は、段落スタイルの役目なので外す
function dropWholeParaEmphasis(list, text) {
  var out = [], i, sp, core = text.replace(/[\s　\t]/g, "").length;
  for (i = 0; i < list.length; i++) {
    sp = list[i];
    if (!sp.ruby && core > 0) {
      var covered = text.substring(sp.start, sp.end).replace(/[\s　\t]/g, "").length;
      if (covered / core >= 0.9) {
        delete sp.bold; delete sp.italic; _clearKinds(sp, UNDERLINE_KINDS);
        sp.key = _fmtKey(sp);
        if (sp.key === "") continue;
      }
    }
    out.push(sp);
  }
  return out;
}

// 飾りの区間を足す (直前と同じ飾りで続いていればつなげる)
function addFmtSpan(list, start, end, f) {
  if (end <= start) return;
  var key = _fmtKey(f);
  if (key === "") return;
  var last = list.length > 0 ? list[list.length - 1] : null;
  if (last && !last.ruby && last.key === key && last.end === start) { last.end = end; return; }
  var span = { start: start, end: end, key: key }, k;
  for (k in f) if (f.hasOwnProperty(k) && f[k] === true) span[k] = true;
  list.push(span);
}

// Word スタイルから見出しレベル (1〜) を求める。見出しでなければ 0
function docxHeadingLevel(styles, styleId) {
  var guard = 0, s = styles[styleId], m;
  while (s && guard++ < 10) {
    var nm = String(s.name), rest = null;
    if (nm.toLowerCase().indexOf("heading") === 0) rest = nm.substring(7);
    else if (nm.indexOf("見出し") === 0) rest = nm.substring(3);
    if (rest !== null) {
      rest = rest.replace(/^\s+/, "");
      if (/^[0-9]+$/.test(rest)) return parseInt(rest, 10);
    }
    if (s.outline !== null && !isNaN(s.outline) && s.outline < 9) return s.outline + 1;
    s = s.basedOn ? styles[s.basedOn] : null;
  }
  return 0;
}

// 本文 XML をブロック列に変換する。
// 段落: { type:"p", text, styleId, level, refs:[{pos, kind, id}], image:rId|null }
// 表  : { type:"table", rows:[[cellText, ...]], widths:[twips...] }
// 注の本文 XML (endnotes/footnotes) にも使う (collectNotes)
function parseDocxBody(xml, styles, collectNotes, onProgress, numbering) {
  var blocks = [], pos = 0, n = xml.length, lt, gt, tag, name, selfClose, closeIdx;
  var para = null, skip = 0, inTabs = 0, fallback = 0, txbx = 0;
  var inPPr = 0, runFmt = null, inRPr = false, ruby = null, inRt = 0, pprChange = 0;
  var numState = numbering ? createNumState(numbering) : null;

  // 自動の番号・記号を段落の頭に文字として入れ、注番号・飾りの位置をずらす
  function addListLabel(pa) {
    var numId = pa.numId, ilvl = pa.ilvl;
    if (numId === null || numId === undefined) {
      var sn = docxStyleNum(styles, pa.styleId);
      if (sn === null) return;
      numId = sn.numId;
      if (ilvl === null || ilvl === undefined) ilvl = sn.ilvl;
    }
    var lab = nextListLabel(numState, numId, ilvl === null || ilvl === undefined ? "0" : ilvl);
    if (lab === null || lab.label === "") return;
    var pre = lab.label + listSeparator(lab.label, lab.suff), k;
    pa.text = pre + pa.text;
    for (k = 0; k < pa.refs.length; k++) pa.refs[k].pos += pre.length;
    for (k = 0; k < pa.fmt.length; k++) { pa.fmt[k].start += pre.length; pa.fmt[k].end += pre.length; }
    pa.listLabel = lab.label;
    pa.isList = true;
  }
  var tblStack = [], tbl = null, row = null, rowFmt = null, cell = null, grid = null;
  var notes = {}, noteId = null, noteParas = null;

  function flushPara() {
    if (para === null) return;
    if (numState !== null) addListLabel(para);
    if (cell !== null) {
      // セルの中の段落は "\r" でつなぐので、飾りの位置もそのぶんずらして覚える
      var cellOff = 0, cq;
      for (cq = 0; cq < cell.paras.length; cq++) cellOff += cell.paras[cq].length + 1;
      for (cq = 0; cq < para.fmt.length; cq++) {
        var csp = _copySpan(para.fmt[cq]);
        csp.start += cellOff; csp.end += cellOff;
        cell.fmt.push(csp);
      }
      cell.paras.push(para.text);
      if (para.refs.length > 0 && tbl !== null) tbl.lostRefs = (tbl.lostRefs || 0) + para.refs.length;
    } else if (collectNotes) {
      if (noteParas !== null) { noteParas.push(para.text); noteParas.fmt.push(para.fmt); }
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
      else if (name === "w:pPrChange") { if (pprChange > 0) pprChange--; }
      else if (name === "w:pPr") { if (inPPr > 0) inPPr--; }
      else if (name === "w:rPr") { inRPr = false; }
      else if (name === "w:r") { runFmt = null; }
      else if (name === "w:rt") { if (inRt > 0) inRt--; }
      else if (name === "w:rubyBase") { if (ruby !== null && para !== null) ruby.end = para.text.length; }
      else if (name === "w:ruby") {
        if (ruby !== null && para !== null && ruby.start >= 0 && ruby.end > ruby.start && ruby.text !== "") {
          para.fmt.push({ start: ruby.start, end: ruby.end, key: "ruby", ruby: ruby.text });
        }
        ruby = null;
      }
      else if (name === "mc:Fallback") { if (fallback > 0) fallback--; }
      else if (name === "w:txbxContent") { if (txbx > 0) txbx--; }
      else if (fallback > 0 || txbx > 0) continue;
      else if (name === "w:p") flushPara();
      else if (name === "w:tc") {
        if (row !== null && cell !== null) { row.push(cell.paras.join("\r")); if (rowFmt !== null) rowFmt.push(cell.fmt); }
        cell = null;
      }
      else if (name === "w:tr") {
        if (tbl !== null && row !== null) { tbl.rows.push(row); tbl.fmts.push(rowFmt || []); }
        row = null; rowFmt = null;
      }
      else if (name === "w:tbl") {
        var done = tbl;
        tbl = tblStack.length > 0 ? tblStack.pop() : null;
        if (tbl === null) {
          blocks.push({ type: "table", rows: done.rows, fmts: done.fmts, widths: done.widths, lostRefs: done.lostRefs || 0 });
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
      if (noteParas !== null) noteParas.fmt = [];
      continue;
    }
    if (name === "w:tbl") { if (tbl !== null) tblStack.push(tbl); tbl = { rows: [], fmts: [], widths: [] }; grid = tbl.widths; continue; }
    if (name === "w:gridCol") { if (grid !== null) grid.push(parseInt(xmlAttr(tag, "w:w"), 10) || 0); continue; }
    if (name === "w:tr") { row = []; rowFmt = []; continue; }
    if (name === "w:tc") { cell = { paras: [], fmt: [] }; continue; }
    if (name === "w:p") {
      para = { type: "p", text: "", styleId: "", level: 0, refs: [], image: null, fmt: [], numId: null, ilvl: null };
      if (selfClose) flushPara();
      continue;
    }
    if (para === null) continue;
    // 段落記号の書式 (<w:pPr> の中の <w:rPr>) は文字の飾りではない
    if (name === "w:pPr") { if (!selfClose) inPPr++; continue; }
    if (inPPr > 0) {
      // 変更履歴の「変更前の書式」(w:pPrChange) は読まない
      if (name === "w:pPrChange") { if (!selfClose) pprChange++; continue; }
      if (pprChange > 0) continue;
      if (name === "w:pStyle") para.styleId = xmlAttr(tag, "w:val") || "";
      else if (name === "w:numId") para.numId = xmlAttr(tag, "w:val");
      else if (name === "w:ilvl") para.ilvl = xmlAttr(tag, "w:val");
      continue;
    }
    if (name === "w:r") { runFmt = {}; continue; }
    if (name === "w:rPr") { inRPr = !selfClose; continue; }
    if (inRPr && runFmt !== null) {
      if (name === "w:rStyle") {
        var sf = docxStyleFmt(styles, xmlAttr(tag, "w:val")), sk;
        for (sk in sf) if (sf.hasOwnProperty(sk)) runFmt[sk] = true;
      } else {
        readRunProp(name, tag, runFmt);
      }
      continue;
    }
    if (name === "w:ruby") { ruby = { text: "", start: -1, end: -1 }; continue; }
    if (name === "w:rt") { if (!selfClose) inRt++; continue; }
    if (name === "w:rubyBase") { if (ruby !== null) ruby.start = para.text.length; continue; }
    if (name === "w:t" && !selfClose) {
      closeIdx = xml.indexOf("</w:t>", pos);
      if (closeIdx < 0) break;
      if (skip === 0) {
        var tt = decodeXmlEntities(xml.substring(pos, closeIdx));
        if (inRt > 0) { if (ruby !== null) ruby.text += tt; }
        else {
          var t0 = para.text.length;
          para.text += tt;
          if (runFmt !== null) addFmtSpan(para.fmt, t0, para.text.length, runFmt);
        }
      }
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
// docx 内のパスをつなぐ ("word" と "../media/a.png" → "media/a.png")
function joinZipPath(dir, target) {
  if (!target) return "";
  if (target.charAt(0) === "/") return target.substring(1);
  var parts = dir ? dir.split("/") : [], t = target.split("/"), i;
  for (i = 0; i < t.length; i++) {
    if (t[i] === "..") parts.pop();
    else if (t[i] !== "." && t[i] !== "") parts.push(t[i]);
  }
  return parts.join("/");
}

// .rels → [{ id, type, target }]
function parseRelsTyped(xml) {
  var out = [], pos = 0, lt, gt, tag;
  if (!xml) return out;
  while (true) {
    lt = xml.indexOf("<Relationship ", pos); if (lt < 0) break;
    gt = xml.indexOf(">", lt); if (gt < 0) break;
    tag = xml.substring(lt + 1, gt); pos = gt + 1;
    out.push({ id: xmlAttr(tag, "Id"), type: xmlAttr(tag, "Type") || "", target: xmlAttr(tag, "Target") || "" });
  }
  return out;
}

function _relOfType(list, suffix) {
  var i;
  for (i = 0; i < list.length; i++) if (list[i].type.length >= suffix.length &&
      list[i].type.substring(list[i].type.length - suffix.length) === suffix) return list[i];
  return null;
}

function readDocxParts(getText, onProgress) {
  // 本文のファイル名は docx の目次 (_rels/.rels) で決まる。ふつうは word/document.xml だが、
  // 作ったソフトによっては word/document2.xml などになる
  var mainPath = "word/document.xml";
  var office = _relOfType(parseRelsTyped(getText("_rels/.rels")), "/officeDocument");
  if (office) mainPath = joinZipPath("", office.target);
  var docXml = getText(mainPath);
  if (docXml === null && mainPath !== "word/document.xml") { mainPath = "word/document.xml"; docXml = getText(mainPath); }
  if (docXml === null) throw new Error("docx の中に本文 (" + mainPath + ") が見つかりません");
  var cut = mainPath.lastIndexOf("/");
  var dir = cut >= 0 ? mainPath.substring(0, cut) : "";
  var relsPath = (dir ? dir + "/" : "") + "_rels/" + mainPath.substring(cut + 1) + ".rels";
  var relList = parseRelsTyped(getText(relsPath)), rels = {}, r;
  for (r = 0; r < relList.length; r++) rels[relList[r].id] = relList[r].target;
  function partOf(suffix, fallback) {
    var rel = _relOfType(relList, suffix);
    return rel ? joinZipPath(dir, rel.target) : joinZipPath(dir, fallback);
  }
  var styles = parseDocxStyles(getText(partOf("/styles", "styles.xml")));
  var endXml = getText(partOf("/endnotes", "endnotes.xml"));
  var footXml = getText(partOf("/footnotes", "footnotes.xml"));
  var numbering = parseNumbering(getText(partOf("/numbering", "numbering.xml")));
  return {
    blocks: parseDocxBody(docXml, styles, false, onProgress, numbering),
    endnotes: endXml ? parseDocxBody(endXml, styles, true, null, numbering) : {},
    footnotes: footXml ? parseDocxBody(footXml, styles, true, null, numbering) : {},
    rels: rels,
    docDir: dir,
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
  ["h1", "大見出し"], ["h2", "中見出し"], ["h3", "小見出し"], ["body", "本文"], ["list", "箇条書き"],
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
  if (s === null || s === undefined) return "";
  s = String(s);
  for (i = 0; i < s.length; i++) {
    c = s.charCodeAt(i);
    out += (c >= 0xFF10 && c <= 0xFF19) ? String.fromCharCode(c - 0xFF10 + 0x30) : s.charAt(i);
  }
  return out;
}

function toZenDigits(s) {
  var out = "", i, c;
  if (s === null || s === undefined) return "";
  s = String(s);
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
var RE_REF_TITLE = /^([0-9０-９]+[．.\s　]*)?(参考文献|引用文献|参考・引用文献|引用・参考文献|注・参考文献|注および参考文献|注と参考文献|参考文献・注|参考文献および注|文献|文献一覧|文献リスト|References?|Bibliography)$/i;
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
var RE_H_CHAPTER = /^第[0-9０-９一二三四五六七八九十百]+章/;
var RE_H_SECTION = /^第[0-9０-９一二三四五六七八九十]+節/;
var RE_H_ROMAN = /^([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ]+|(?:I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)(?=[.．]))[\s　]*[．.、]?[\s　]*\S/;
var RE_H_HYPHEN = /^[0-9０-９]+[-－‐][0-9０-９]+[\s　]+\S/;

function headingDepthByText(t) {
  if (t.length > 60) return 0;
  // 「。」で終わるものは文 (見出しではない)
  if (/[。．]$/.test(t) && !/^[0-9０-９]+[．.]$/.test(t)) return 0;
  if (RE_H_SUB2.test(t)) return 3;
  if (RE_H_SUB.test(t)) return 2;
  if (RE_H_HYPHEN.test(t)) return 2;
  if (RE_H_SECTION.test(t)) return 2;
  if (RE_H_CHAPTER.test(t)) return 1;
  if (RE_H_ROMAN.test(t) && t.length <= 50) return 1;
  if (RE_H_NUM.test(t) && t.length <= 50) return 1;
  if (RE_H_WORDS.test(t)) return 1;
  return 0;
}

// 前回号の段落スタイル名から見出しの深さを読む (大見出し/中見出し/小見出し)。見出しでなければ 0
function headingDepthByStyle(name) {
  if (!name || /Abstract|注|要旨|表|図/i.test(name)) return 0;
  if (/大見出し|章見出し|見出し\s*[1１]/.test(name)) return 1;
  if (/中見出し|節見出し|見出し\s*[2２]/.test(name)) return 2;
  if (/小見出し|見出し\s*[3３]/.test(name)) return 3;
  return 0;
}

// items: [{ text, level (Word の見出しレベル, 不明なら 0), isTable, isImage }]
// 戻り値: 役割の配列
function classifySequence(items) {
  var roles = [], i, it, t, st = "front", mode = "body", haveTitle = false, depth, lastFig = -10, styleHinted = false;
  for (i = 0; i < items.length; i++) {
    it = items[i];
    t = trimWS(it.text);
    if (it.isTable) { roles.push("table"); lastFig = i; if (st === "front") st = "body"; continue; }
    if (it.isImage && t === "") { roles.push("figure"); lastFig = i; if (st === "front") st = "body"; continue; }
    if (t === "") { roles.push("empty"); continue; }
    depth = headingDepthByText(t);
    // 全角スペースで字下げした長めの段落は本文
    if (depth > 0 && it.text.charAt(0) === "　" && t.length > 15) depth = 0;
    // Word の箇条書き (「1. データの収集」など) は、見出しスタイルでなければ見出しにしない
    if (it.isList && !(it.level > 0)) depth = 0;
    if (it.level > 0 && t.length <= 80) depth = depth > 0 ? depth : Math.min(it.level, 3);
    // 前回号の段落はスタイル名 (大見出し・中見出し…) をいちばん信用する
    var sd = headingDepthByStyle(it.style);
    if (sd > 0 && t.length <= 80) { depth = sd; styleHinted = true; }

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
    if (mode === "ref" && depth > 0 && !/^([0-9０-９]|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]|第|付録|補論|Appendix)/i.test(t) && !RE_H_WORDS.test(t)) {
      roles.push("refSub"); continue;
    }
    if (depth > 0 && !(mode === "note" && RE_NOTE_ITEM.test(t))) {
      // 参考文献の欄の「1 Smith (2000)…」のような数字始まりの行は文献。
      // Word の見出しスタイルが付いているか、付録・章などで始まるときだけ見出しに戻す
      if (mode === "ref" && !(it.level > 0) && !RE_H_WORDS.test(t) && !/^[0-9０-９]+[．.]/.test(t) &&
          !/^(付録|補論|Appendix|第)/i.test(t) && !RE_H_ROMAN.test(t)) { /* 文献 */ }
      else { roles.push(depth === 1 ? "h1" : depth === 2 ? "h2" : "h3"); mode = "body"; continue; }
    }
    if (mode === "ref") { roles.push(RE_REF_SUB.test(t) ? "refSub" : "ref"); continue; }
    if (mode === "note") { roles.push("note"); continue; }
    if (it.isList) { roles.push("list"); continue; }
    if (RE_FIG_CAPTION.test(t) && t.length < 100) { roles.push("figCaption"); lastFig = i; continue; }
    if (RE_FIG_SOURCE.test(t) && (i - lastFig <= 3 || /^(出典|出所)/.test(t))) { roles.push("figSource"); lastFig = i; continue; }
    roles.push("body");
  }
  // 原稿に最上位の見出しがなく、2段目以下だけのときは繰り上げる
  // (Word で「見出し 2」を最上位に使っている場合など)
  if (!styleHinted) {
    var minD = 9, j, dd;
    for (j = 0; j < roles.length; j++) {
      dd = roles[j] === "h1" ? 1 : roles[j] === "h2" ? 2 : roles[j] === "h3" ? 3 : 0;
      if (dd > 0 && dd < minD) minD = dd;
    }
    if (minD > 1 && minD < 9) {
      for (j = 0; j < roles.length; j++) {
        dd = roles[j] === "h1" ? 1 : roles[j] === "h2" ? 2 : roles[j] === "h3" ? 3 : 0;
        if (dd > 0) roles[j] = "h" + Math.max(1, dd - (minD - 1));
      }
    }
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
      var hn1 = readHeadingNumber(t);
      if (hn1 !== null && hn1.nums.length === 1 && hn1.sep !== "") {
        p.headingDigits = /[０-９]/.test(hn1.numText) ? "zen" : "han";
        p.h1Sep = hn1.sep;
      }
    }
    if (r === "h2") {
      var hn2 = readHeadingNumber(t);
      if (hn2 !== null && hn2.nums.length >= 2 && hn2.sep !== "") p.h2Sep = hn2.sep;
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
      var pn = readParenNumber(raw, 0);
      if (pn !== null) {
        // 「（ 1 ）＋タブ」の番号の行: 1桁の番号の空白と、番号の後ろの区切りを覚える
        if (pn.digits.length === 1) _inc(numPad, pn.pad === "" ? "none" : pn.pad);
        if (pn.after !== "") p.noteNumSep = pn.after;
      } else {
        // 番号のない行は、前の注の続きの行 (先頭の字下げを覚える)
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
        if (ncs) {
          _inc(noteRefCs, ncs);
          var rp = readParenNumber(m[0], 0);
          if (rp !== null && rp.digits.length === 1) _inc(refPad, rp.pad === "" ? "none" : rp.pad);
        }
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
  // 句読点 (「、」か「，」か、「。」か「．」か)
  var pc = { "、": 0, "，": 0, "。": 0, "．": 0 }, pk;
  for (i = 0; i < oldParas.length; i++) {
    r = roles[i];
    if (r !== "body" && r !== "abstract" && r !== "note") continue;
    countPunctInto(oldParas[i].text, pc);
  }
  p.punct = { counts: pc, comma: _dominant(pc["、"], pc["，"], "、", "，"), period: _dominant(pc["。"], pc["．"], "。", "．") };
  // 英数字 (全角か半角か)・括弧 (全角か半角か)
  var cc = { zenAlnum: 0, hanAlnum: 0, hanBracket: 0, zenBracket: 0 };
  for (i = 0; i < oldParas.length; i++) {
    r = roles[i];
    if (r !== "body" && r !== "abstract" && r !== "note" && r !== "ref") continue;
    countCharClassesInto(oldParas[i].text, cc);
  }
  p.charPref = {
    alnum: _dominant(cc.hanAlnum, cc.zenAlnum, "han", "zen"),
    bracket: _dominant(cc.zenBracket, cc.hanBracket, "full", "half"),
    counts: cc
  };
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

// 「（ 1 ）」のような括弧付きの番号を pos から読む
// 戻り値: { pad: 括弧と数字の間の空白, digits: "1", after: 括弧の後ろの空白・タブ, end } / なければ null
function readParenNumber(t, pos) {
  var i = pos, n = t.length, pad = "", digits = "", after = "", ch = t.charAt(i);
  if (ch !== "\uFF08" && ch !== "(") return null;
  i++;
  while (i < n && _isSpaceChar(t.charAt(i))) { pad += t.charAt(i); i++; }
  while (i < n && _isDigitChar(t.charAt(i))) { digits += t.charAt(i); i++; }
  if (digits === "") return null;
  while (i < n && _isSpaceChar(t.charAt(i))) i++;
  ch = t.charAt(i);
  if (ch !== "\uFF09" && ch !== ")") return null;
  i++;
  while (i < n && (_isSpaceChar(t.charAt(i)) || t.charAt(i) === "\t")) { after += t.charAt(i); i++; }
  return { pad: pad, digits: digits, after: after, end: i };
}

// ---- 見出しの先頭の番号を1文字ずつ読む ----
// InDesign の JavaScript は、正規表現の「( )」で取り出した部分が空になる不具合があるため、
// 番号の取り出しには正規表現を使わない。
function _isDigitChar(ch) { return (ch >= "0" && ch <= "9") || (ch >= "\uFF10" && ch <= "\uFF19"); }
function _isSpaceChar(ch) { return ch === " " || ch === "\t" || ch === "\u3000" || (ch >= "\u2002" && ch <= "\u200A"); }

// 戻り値: { nums: ["2","1"], numText: "2.1", sep: 番号の後ろの区切り (空白・「．」など), punct: 区切りの記号, end: 本文の始まり }
// 番号で始まらなければ null
function readHeadingNumber(t) {
  var i = 0, n = t.length, nums = [], cur = "", ch;
  while (i < n && _isDigitChar(t.charAt(i))) { cur += t.charAt(i); i++; }
  if (cur === "") return null;
  nums.push(cur);
  while (i + 1 < n && (t.charAt(i) === "." || t.charAt(i) === "\uFF0E") && _isDigitChar(t.charAt(i + 1))) {
    i++; cur = "";
    while (i < n && _isDigitChar(t.charAt(i))) { cur += t.charAt(i); i++; }
    nums.push(cur);
  }
  var numEnd = i, j = i, punct = "";
  while (j < n && _isSpaceChar(t.charAt(j))) j++;
  ch = j < n ? t.charAt(j) : "";
  if (ch === "\uFF0E" || ch === "." || ch === "\u3001") { punct = ch; j++; }
  while (j < n && _isSpaceChar(t.charAt(j))) j++;
  return { nums: nums, numText: t.substring(0, numEnd), sep: t.substring(numEnd, j), punct: punct, end: j };
}

function _normHeading(t, role, p) {
  var h = readHeadingNumber(t), num;
  if (h === null) return t;
  // 番号の形 (「1．」か「1.1」か) で整える。種類 (大見出し/中見出し) とは限らず一致しないため
  if (h.nums.length === 1) {
    // 「1．はじめに」「1 はじめに」の形だけ (「2020年…」のような数字始まりの文は変えない)
    if (h.punct === "" && h.sep === "") return t;
    num = p.headingDigits === "zen" ? toZenDigits(h.numText) : toHanDigits(h.numText);
    return num + p.h1Sep + t.substring(h.end);
  }
  num = h.nums.join(p.headingDigits === "zen" ? "\uFF0E" : ".");
  num = p.headingDigits === "zen" ? toZenDigits(num) : toHanDigits(num);
  return num + p.h2Sep + t.substring(h.end);
}

// 原稿 (readDocxManuscript の結果) を役割付きの段落列にする
// 戻り値: { items:[{role, text, refs:[{start,len}], dash:[], label:{start,len}, table, image}], notes:n, warnings:[] }
function buildItems(ms, p) {
  var blocks = ms.blocks, seq = [], i, b;
  for (i = 0; i < blocks.length; i++) {
    b = blocks[i];
    if (b.type === "table") seq.push({ text: "", level: 0, isTable: true, isImage: false, block: b });
    else seq.push({ text: b.text, level: b.level, isTable: false, isImage: !!b.image, isList: !!b.isList, block: b });
  }
  // 題目の段落に改行があれば、題目と副題に分ける
  var firstIdx = -1;
  for (i = 0; i < seq.length; i++) if (!seq[i].isTable && trimWS(seq[i].text) !== "") { firstIdx = i; break; }
  if (firstIdx >= 0 && seq[firstIdx].text.indexOf("\n") > 0) {
    var tb = seq[firstIdx].block, cut = tb.text.indexOf("\n");
    var head = { type: "p", text: tb.text.substring(0, cut), styleId: tb.styleId, level: 0, refs: [], image: null,
                 fmt: clipSpans(tb.fmt, 0, cut, 0) };
    var tail = { type: "p", text: tb.text.substring(cut + 1).replace(/\n/g, ""), styleId: tb.styleId, level: 0, refs: [], image: null,
                 fmt: clipSpans(tb.fmt, cut + 1, tb.text.length, cut + 1) };
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

  // 注番号は本文中に出てきた順。Word の脚注は InDesign の脚注にするので別に数える
  var noteOrder = [], noteNo = {}, items = [], warnings = [], footnotes = [], fnNo = {};
  for (i = 0; i < seq.length; i++) {
    b = seq[i].block;
    if (!b.refs) continue;
    var q;
    for (q = 0; q < b.refs.length; q++) {
      var key = b.refs[q].kind + ":" + b.refs[q].id;
      if (b.refs[q].kind === "footnote") {
        if (fnNo[key] === undefined) {
          var fpar = ms.footnotes[b.refs[q].id], ftxt = [], fq, ffmt = [], flen = 0;
          if (!fpar) { warnings.push("脚注 " + (footnotes.length + 1) + " の本文が見つかりませんでした"); fpar = [""]; }
          for (fq = 0; fq < fpar.length; fq++) {
            var ft = trimWS(fpar[fq]);
            if (ft === "" && fq !== 0) continue;
            if (ftxt.length > 0) flen += 1;   // 段落の区切り "\r"
            var fl = /^[\s　]*/.exec(fpar[fq])[0].length;
            var fsp = fpar.fmt && fpar.fmt[fq] ? clipSpans(fpar.fmt[fq], fl, fl + ft.length, fl) : [];
            moveSpans(fsp, flen);
            ffmt = ffmt.concat(fsp);
            ftxt.push(ft);
            flen += ft.length;
          }
          fnNo[key] = footnotes.length;
          footnotes.push({ text: ftxt.join("\r"), fmt: splitJaItalic(ffmt, ftxt.join("\r")) });
        }
      } else if (!noteNo[key]) { noteOrder.push(b.refs[q]); noteNo[key] = noteOrder.length; }
    }
  }

  var noteInsertAt = -1;
  for (i = 0; i < seq.length; i++) {
    var role = roles[i];
    b = seq[i].block;
    if (role === "empty") continue;
    if (role === "refTitle" && noteInsertAt < 0) noteInsertAt = items.length;
    if (role === "table") {
      if (b.lostRefs) warnings.push("表の中にある注 " + b.lostRefs + " 件は取り込めませんでした (表の中の注番号を確認してください)");
      items.push({ role: "table", text: "■表■", table: b, cellFmt: tableCellFmt(b) });
      continue;
    }
    if (role === "figure") { items.push({ role: "figure", text: "■図■", image: b.image }); continue; }
    var text = b.text.replace(/\n/g, "\n"), refs = [], k, off = 0, sorted = b.refs.slice(0);
    sorted.sort(function (x, y) { return x.pos - y.pos; });
    // 注番号を差し込む
    var out = "";
    var last = 0, marks = [], fm = [], fi;
    if (b.fmt) for (fi = 0; fi < b.fmt.length; fi++) fm.push(_copySpan(b.fmt[fi]));
    for (k = 0; k < sorted.length; k++) {
      out += text.substring(last, sorted[k].pos);
      last = sorted[k].pos;
      if (sorted[k].kind === "footnote") {
        // 脚注は位置だけ覚えておき、流し込むときに InDesign の脚注を入れる
        refs.push({ start: out.length, len: 0, footnote: fnNo[sorted[k].kind + ":" + sorted[k].id] });
        continue;
      }
      var n = noteNo[sorted[k].kind + ":" + sorted[k].id];
      var mark = _noteRef(n, p);
      refs.push({ start: out.length, len: mark.length });
      marks.push({ pos: sorted[k].pos, len: mark.length });
      out += mark;
    }
    out += text.substring(last);
    shiftSpansForMarks(fm, marks);
    // 体裁の調整
    var lead = /^[ \t]*/.exec(out)[0].length;
    if (lead > 0) { out = out.substring(lead); for (k = 0; k < refs.length; k++) refs[k].start = Math.max(0, refs[k].start - lead); moveSpans(fm, -lead); }
    var tr = /[\s　]+$/.exec(out); if (tr) out = out.substring(0, out.length - tr[0].length);
    for (k = 0; k < refs.length; k++) if (refs[k].start > out.length) refs[k].start = out.length;
    fm = fitSpans(fm, out.length);
    var shift = 0;
    if (role === "h1" || role === "h2" || role === "h3") {
      var before = out;
      out = _normHeading(trimWS(out), role, p);
      if (out.length !== before.length) {
        // 見出しの番号の書き方を変えたぶん、後ろの注番号・飾りの位置をずらす
        for (k = 0; k < refs.length; k++) refs[k].start += out.length - before.length;
        moveSpans(fm, out.length - before.length);
      }
    } else if (role === "body") {
      if (p.bodyIndent && out.charAt(0) !== "　") { out = "　" + out; shift = 1; }
    } else if (role === "abstract") {
      if (p.abstractIndent && out.charAt(0) !== "　") { out = "　" + out; shift = 1; }
    } else if (role === "abstractTitle" && p.labels.abstractTitle) {
      out = p.labels.abstractTitle; fm = [];
    } else if (role === "refTitle" && p.labels.refTitle && !/注/.test(out) && !/注/.test(p.labels.refTitle)) {
      // 「引用文献」「文献」などの言い換えは前回号の表記にそろえる (「注・参考文献」はそのまま)
      out = p.labels.refTitle; fm = [];
    } else if (role === "noteTitle" && p.labels.noteTitle) {
      out = p.labels.noteTitle; fm = [];
    } else if (role === "keywords" && p.labels.keywords) {
      var kb = out.length;
      out = out.replace(RE_KEYWORDS, p.labels.keywords);
      moveSpans(fm, out.length - kb);
    } else if (role === "ref" && p.refUrlTab && /^https?:/.test(out)) {
      out = "\t" + out; shift = 1;
    } else {
      var ob = out.length;
      out = out.replace(/^[　]+/, "");
      moveSpans(fm, out.length - ob);
    }
    if (shift) { for (k = 0; k < refs.length; k++) refs[k].start += shift; moveSpans(fm, shift); }
    fm = fitSpans(fm, out.length);
    if (HEADINGISH[role] || role === "keywords") fm = dropWholeParaEmphasis(fm, out);
    fm = splitJaItalic(fm, out);
    var item = { role: role, text: out, refs: refs, fmt: fm };
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
        var pre = first ? _noteNum(nn + 1, p) + p.noteNumSep : p.noteCont;
        var nl = /^[\s　]*/.exec(paras[pi])[0].length;
        var nfm = paras.fmt && paras.fmt[pi] ? clipSpans(paras.fmt[pi], nl, nl + nt.length, nl) : [];
        moveSpans(nfm, pre.length);
        noteItems.push({ role: "note", text: pre + nt, refs: [], fmt: splitJaItalic(nfm, pre + nt) });
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
  return { items: withBlanks, notes: noteOrder.length, footnotes: footnotes, warnings: warnings };
}

// 段落列 → 1つの文字列と、段落・文字スタイルの位置
function buildStoryText(items) {
  var parts = [], paras = [], chars = [], pos = 0, i, it, k;
  for (i = 0; i < items.length; i++) {
    it = items[i];
    paras.push({ role: it.role, start: pos, len: it.text.length, index: i });
    if (it.refs) for (k = 0; k < it.refs.length; k++) {
      if (it.refs[k].footnote !== undefined) chars.push({ kind: "footnote", start: pos + it.refs[k].start, len: 0, footnote: it.refs[k].footnote });
      else chars.push({ kind: "noteRef", start: pos + it.refs[k].start, len: it.refs[k].len });
    }
    if (it.dash) for (k = 0; k < it.dash.length; k++) chars.push({ kind: "dash", start: pos + it.dash[k].start, len: it.dash[k].len });
    if (it.label) chars.push({ kind: it.role === "keywords" ? "keywordsLabel" : "figSourceLabel", start: pos + it.label.start, len: it.label.len });
    if (it.fmt) for (k = 0; k < it.fmt.length; k++) {
      chars.push({ kind: "fmt", start: pos + it.fmt[k].start, len: it.fmt[k].end - it.fmt[k].start, span: it.fmt[k] });
    }
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
  list: [[/箇条|リスト|list/i], /Abstract/i],
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
  refSub: "ref", ref: "note", noteTitle: "h2", note: "body", figCaption: "body", list: "body"
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
  // 中見出し・小見出しが大見出しと同じスタイルになったら、名前から別のスタイルを探す
  var sub = ["h2", "h3"], g2;
  for (i = 0; i < sub.length; i++) {
    if (map[sub[i]] === map.h1) { g2 = guessStyleName(sub[i], names); if (g2 && g2 !== map.h1) map[sub[i]] = g2; }
  }
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
  if (item.fmt) { moveSpans(item.fmt, t.length - before); item.fmt = fitSpans(item.fmt, t.length); }
  if (item.dash) item.dash = [];
  item.label = null;
  if (role === "keywords") { var km = RE_KEYWORDS.exec(t); if (km) item.label = { start: 0, len: km[0].length }; }
  if (role === "figSource") { var sm = RE_FIG_SOURCE.exec(t); if (sm) item.label = { start: 0, len: sm[0].length }; }
  item.text = t;
  item.role = role;
}

// ---- 句読点の統一 ----

// 日本語の文の終わりの「．」(見出し番号「1．」や「M．J．」などは数えない)
var RE_JP_PERIOD = /([ぁ-んァ-ヶー一-龠々〆〇」』）\)])．/g;

function countPunctInto(text, pc) {
  var m;
  pc["、"] += (text.match(/、/g) || []).length;
  pc["，"] += (text.match(/，/g) || []).length;
  pc["。"] += (text.match(/。/g) || []).length;
  RE_JP_PERIOD.lastIndex = 0;
  while ((m = RE_JP_PERIOD.exec(text)) !== null) pc["．"]++;
}

// どちらかが9割以上 (かつ5回以上) 使われていれば、それが前回号の書き方
function _dominant(a, b, ca, cb) {
  if (a + b < 5) return null;
  if (a / (a + b) >= 0.9) return ca;
  if (b / (a + b) >= 0.9) return cb;
  return null;
}

function _eachBuiltText(built, fn) {
  var i, it, r, c;
  for (i = 0; i < built.items.length; i++) {
    it = built.items[i];
    if (it.role === "table" && it.table) {
      for (r = 0; r < it.table.rows.length; r++) for (c = 0; c < it.table.rows[r].length; c++) {
        it.table.rows[r][c] = fn(it.table.rows[r][c], "table");
      }
    } else if (it.role !== "figure") {
      it.text = fn(it.text, it.role);
    }
  }
  if (built.footnotes) for (i = 0; i < built.footnotes.length; i++) built.footnotes[i].text = fn(built.footnotes[i].text, "footnote");
}

// ---- 全角英数字 → 半角、半角括弧 → 全角 ----

var RE_URLISH = /(https?:\/\/|www\.|doi:)[^\s　、。，．「」『』]+|[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
var HAN_TO_ZEN_BRACKET = { "(": "（", ")": "）", "[": "［", "]": "］", "{": "｛", "}": "｝", "\uFF62": "「", "\uFF63": "」" };

// URL・メールアドレスの部分は変えずに、それ以外に fn を当てる
function _outsideUrls(text, fn) {
  var out = "", last = 0, m;
  RE_URLISH.lastIndex = 0;
  while ((m = RE_URLISH.exec(text)) !== null) {
    out += fn(text.substring(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + fn(text.substring(last));
}

function _zenAlnumToHan(t) {
  return t.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
}
function _hanBracketToZen(t) {
  return t.replace(/[()\[\]{}\uFF62\uFF63]/g, function (c) { return HAN_TO_ZEN_BRACKET[c]; });
}

function countCharClassesInto(text, cc) {
  _outsideUrls(text, function (t) {
    cc.zenAlnum += (t.match(/[Ａ-Ｚａ-ｚ０-９]/g) || []).length;
    cc.hanAlnum += (t.match(/[A-Za-z0-9]/g) || []).length;
    cc.hanBracket += (t.match(/[()\[\]{}\uFF62\uFF63]/g) || []).length;
    cc.zenBracket += (t.match(/[（）［］｛｝]/g) || []).length;
    return t;
  });
}

// 見出し番号を全角で書く紀要 (前回号が「１．」など) では、見出しの番号は変えない
function _convZenAlnum(t, role, p) {
  if ((role === "h1" || role === "h2" || role === "h3") && p.headingDigits === "zen") {
    // 番号の部分は段ごとに決める (大見出し「１．」・中見出し「１．２」・小見出し「１．２．３」)
    var m = (role === "h1" ? /^[０-９]+[．.]/ : role === "h2" ? /^[０-９]+[．.][０-９]+/ : /^[０-９]+[．.][０-９]+[．.][０-９]+/).exec(t);
    if (m) return m[0] + _outsideUrls(t.substring(m[0].length), _zenAlnumToHan);
  }
  return _outsideUrls(t, _zenAlnumToHan);
}

// 流し込むときに聞く文字の統一 (前回号の書き方を初期値にする)
function textConversions(built, p) {
  var cc = { zenAlnum: 0, hanAlnum: 0, hanBracket: 0, zenBracket: 0 }, out = [], pref = p.charPref || {};
  _eachBuiltText(built, function (t) { countCharClassesInto(t, cc); return t; });
  if (cc.zenAlnum > 0) {
    out.push({ kind: "zenAlnum", label: "全角英数字を半角にする", count: cc.zenAlnum, apply: pref.alnum !== "zen" });
  }
  if (cc.hanBracket > 0) {
    out.push({ kind: "hanBracket", label: "半角括弧 ( ) [ ] { } を全角にする (URL の中は変えません)", count: cc.hanBracket, apply: pref.bracket !== "half" });
  }
  return out;
}

// 1文字を1文字に置き換えるので、注番号・飾りの位置はずれない
function applyTextConversion(built, conv, p) {
  if (conv.kind === "zenAlnum") _eachBuiltText(built, function (t, role) { return _convZenAlnum(t, role, p); });
  else if (conv.kind === "hanBracket") _eachBuiltText(built, function (t) { return _outsideUrls(t, _hanBracketToZen); });
}

// 原稿のうち、前回号と違う句読点の数 → [{ kind, from, to, count }]
function punctMismatches(built, p) {
  var pc = { "、": 0, "，": 0, "。": 0, "．": 0 }, out = [];
  if (!p.punct) return out;
  _eachBuiltText(built, function (t) { countPunctInto(t, pc); return t; });
  if (p.punct.comma) {
    var oc = p.punct.comma === "，" ? "、" : "，";
    if (pc[oc] > 0) out.push({ kind: "comma", from: oc, to: p.punct.comma, count: pc[oc] });
  }
  if (p.punct.period) {
    var op = p.punct.period === "．" ? "。" : "．";
    if (pc[op] > 0) out.push({ kind: "period", from: op, to: p.punct.period, count: pc[op] });
  }
  return out;
}

// 句読点を置き換える (1文字を1文字に置き換えるので、注番号などの位置はずれない)
function unifyPunct(built, change) {
  _eachBuiltText(built, function (t) {
    if (change.kind === "comma") return t.split(change.from).join(change.to);
    if (change.to === "．") return t.split("。").join("．");
    RE_JP_PERIOD.lastIndex = 0;
    return t.replace(RE_JP_PERIOD, function (all) { return all.charAt(0) + "。"; });
  });
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
    if (items[i].styleOverride) { out.push(items[i].styleOverride); continue; }
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

// 文字の飾りの対応表をファイルに記録するためのラベル名と、読み書き
var FMT_LABEL = "kiyo_nagashikomi_fmt";
function parseSavedMap(s) {
  var out = {}, lines = String(s || "").split("\n"), i, t;
  for (i = 0; i < lines.length; i++) {
    t = lines[i].split("\t");
    if (t.length === 2 && t[0] !== "") out[t[0]] = t[1];
  }
  return out;
}
function serializeSavedMap(saved, map, counts) {
  var merged = {}, k, lines = [];
  for (k in saved) if (saved.hasOwnProperty(k)) merged[k] = saved[k];
  for (k in counts) if (counts.hasOwnProperty(k)) merged[k] = map[k] || "";
  for (k in merged) if (merged.hasOwnProperty(k)) lines.push(k + "\t" + merged[k]);
  return lines.join("\n");
}

// 文字スタイルの設定を、推測用の単純な値にする
function describeCharStyles(doc) {
  var all = doc.allCharacterStyles, out = [], i, cs, d, v;
  for (i = 0; i < all.length; i++) {
    cs = all[i];
    d = { name: cs.name, fontStyle: "", underline: false, position: "", kenten: false, strike: false, ruby: false, skew: 0,
          uTypeName: "", uWeight: -1, sTypeName: "" };
    // 下線・取り消し線の線の種類 (点線・波線・二重線など) と太さ
    try { v = cs.underlineType; if (v && v.name !== undefined) d.uTypeName = String(v.name); } catch (e7) {}
    try { v = cs.underlineWeight; if (typeof v === "number") d.uWeight = v; } catch (e8) {}
    try { v = cs.strikeThroughType; if (v && v.name !== undefined) d.sTypeName = String(v.name); } catch (e9) {}
    try { v = cs.skew; if (typeof v === "number") d.skew = v; } catch (e0) {}
    try { v = cs.fontStyle; if (typeof v === "string") d.fontStyle = v; } catch (e1) {}
    try { d.underline = cs.underline === true; } catch (e2) {}
    try {
      v = cs.position;
      if (v === Position.SUPERSCRIPT || v === Position.OT_SUPERSCRIPT) d.position = "sup";
      else if (v === Position.SUBSCRIPT || v === Position.OT_SUBSCRIPT) d.position = "sub";
    } catch (e3) {}
    try { v = cs.kentenKind; d.kenten = !!v && v !== KentenCharacter.NONE && v !== NothingEnum.NOTHING; } catch (e4) {}
    try { d.strike = cs.strikeThru === true; } catch (e5) {}
    try { d.ruby = cs.rubyFlag === true; } catch (e6) {}
    out.push(d);
  }
  return out;
}

// 飾りの区間を当てる (文字スタイル + ルビ)。base は区間の位置に足す値、target は文字を持つもの (ストーリーや脚注)
function applyFmtSpans(target, spans, base, mapIdx, fmtStyles, stat) {
  var i, sp, s0, s1, rng, kind;
  for (i = 0; i < spans.length; i++) {
    sp = spans[i];
    s0 = base + mapIdx(sp.start); s1 = base + mapIdx(sp.end) - 1;
    if (s1 < s0) continue;
    try { rng = target.characters.itemByRange(s0, s1).texts[0]; } catch (e0) { continue; }
    if (sp.ruby) {
      try {
        if (fmtStyles.ruby) rng.appliedCharacterStyle = fmtStyles.ruby;
        rng.rubyFlag = true;
        rng.rubyString = sp.ruby;
        try { rng.rubyType = RubyTypes.GROUP_RUBY; } catch (e1) {}
        stat.ruby = (stat.ruby || 0) + 1;
      } catch (e2) { stat.failed = (stat.failed || 0) + 1; }
      continue;
    }
    kind = pickFmtStyleKey(sp, fmtStyles);
    if (kind === null) {
      var sk = "skip_" + comboKey(sp);
      stat[sk] = (stat[sk] || 0) + 1;
      continue;
    }
    try { rng.appliedCharacterStyle = fmtStyles[kind]; stat[comboKey(sp)] = (stat[comboKey(sp)] || 0) + 1; }
    catch (e3) { stat.failed = (stat.failed || 0) + 1; }
  }
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

function countRoles(items) {
  var cnt = {}, i;
  for (i = 0; i < items.length; i++) cnt[items[i].role] = (cnt[items[i].role] || 0) + 1;
  return cnt;
}

function confirmDialog(built, p, styleMap, styleNames, info) {
  var items = built.items, i, w;
  var nFoot = built.footnotes ? built.footnotes.length : 0;
  function summaryText() {
    var cnt = countRoles(items);
    return "原稿: " + info.docxName + "\n" +
      "大見出し " + (cnt.h1 || 0) + " / 中見出し " + (cnt.h2 || 0) + " / 小見出し " + (cnt.h3 || 0) +
      " / 表 " + (cnt.table || 0) + " / 図 " + (cnt.figure || 0) + " / 脚注 " + nFoot + " 件 / 文末脚注 " + built.notes +
      " 件 / 本文 " + (cnt.body || 0) + " 段落";
  }

  w = new Window("dialog", "紀要の流し込み — 内容の確認");
  w.orientation = "column";
  w.alignChildren = "fill";
  var sumText = w.add("statictext", undefined, summaryText(), { multiline: true });
  sumText.preferredSize = [760, 36];
  if (built.warnings && built.warnings.length > 0) {
    w.add("statictext", undefined, "［注意］" + built.warnings.join(" / "), { multiline: true }).preferredSize = [760, 32];
  }
  if (info.notes.length > 0) {
    w.add("statictext", undefined, info.notes.join("\n"), { multiline: true }).preferredSize = [760, 16 * info.notes.length + 4];
  }

  // 文字の統一 (句読点・全角英数字・半角括弧)。初期値は前回号の書き方に合わせてある
  var punctBoxes = [], pq;
  var nPunct = info.punct ? info.punct.length : 0, nConv = info.conv ? info.conv.length : 0;
  if (nPunct + nConv > 0) {
    var pp = w.add("panel", undefined, "文字の統一 (チェックしたものだけ置き換えます)");
    pp.alignChildren = "left";
    for (pq = 0; pq < nPunct; pq++) {
      var pm = info.punct[pq];
      var cb = pp.add("checkbox", undefined, "前回号に合わせて「" + pm.to + "」に統一する (原稿の「" + pm.from + "」" + pm.count + " か所を置き換え)");
      cb.value = true;
      punctBoxes.push({ box: cb, change: pm });
    }
    for (pq = 0; pq < nConv; pq++) {
      var cv = info.conv[pq];
      var cb2 = pp.add("checkbox", undefined, cv.label + " (原稿に " + cv.count + " か所)");
      cb2.value = cv.apply;
      punctBoxes.push({ box: cb2, change: cv });
    }
  }
  // 文字の飾り (イタリック・ルビなど) → 文字スタイル
  var fmtText = null;
  function fmtSummary() {
    var f = info.fmt, parts = [], kd;
    for (kd in f.counts) {
      if (!f.counts.hasOwnProperty(kd)) continue;
      var use = f.map[kd] ? f.map[kd] : null;
      if (use === null && kd !== "ruby") {
        // その組み合わせ用のスタイルがなければ、代わりに使うスタイル (ふつうの下線など) を示す
        var alt = pickFmtStyleKey(spanFromKey(kd), f.map);
        if (alt !== null) use = f.map[alt] + " で代用";
      }
      parts.push(comboLabel(kd) + " " + f.counts[kd] + "か所→" +
                 (use !== null ? use : (kd === "ruby" ? "(ルビだけ付ける)" : "(当てない)")));
    }
    return parts.join(" / ");
  }
  if (info.fmt && fmtSummary() !== "") {
    var fp = w.add("panel", undefined, "文字の飾り (Word のイタリック・ルビなど → InDesign の文字スタイル)");
    fp.alignChildren = "fill";
    fmtText = fp.add("statictext", undefined, fmtSummary(), { multiline: true });
    fmtText.preferredSize = [740, 32];
    var bFmt = fp.add("button", undefined, "文字の飾りに使う文字スタイルを確認・変更…");
    bFmt.alignment = "left";
    bFmt.onClick = function () { if (fmtMapDialog(info.fmt)) fmtText.text = fmtSummary(); };
  }
  var showAll = w.add("checkbox", undefined, "本文・注・参考文献の段落もすべて表示する");
  var lb = w.add("listbox", undefined, undefined, {
    numberOfColumns: 3, showHeaders: true,
    columnTitles: ["種類", "内容", "段落スタイル"], columnWidths: [120, 420, 210], multiselect: true
  });
  lb.preferredSize = [760, 360];

  var rowMap = [];
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
  g.add("statictext", undefined, "選んだ段落 (Shift / Ctrl で複数可) の種類を変更:");
  var labels = [], codes = [], r;
  for (r = 0; r < ROLES.length; r++) {
    if (ROLES[r][0] === "table" || ROLES[r][0] === "figure") continue;
    labels.push(ROLES[r][1]); codes.push(ROLES[r][0]);
  }
  var dd = g.add("dropdownlist", undefined, labels);
  dd.preferredSize = [180, 24];

  // 選んだ段落にだけ、別の段落スタイルを使う
  var g2 = w.add("group");
  g2.add("statictext", undefined, "選んだ段落の段落スタイルを個別に指定:");
  var styleChoices = ["(種類ごとの設定に従う)"].concat(styleNames);
  var ddStyle = g2.add("dropdownlist", undefined, styleChoices);
  ddStyle.preferredSize = [300, 24];
  var bStyles = g2.add("button", undefined, "種類ごとの段落スタイルを確認・変更…");

  function refreshStyles() {
    var names = resolveStyleNames(items, p, styleMap), q;
    for (q = 0; q < rowMap.length; q++) lb.items[q].subItems[1].text = names[rowMap[q]] || "(なし)";
    sumText.text = summaryText();
  }

  // 複数選択のときは配列、1つのときは項目1つが返るので、配列にそろえる
  function selectedRows() {
    var sel = lb.selection, out = [], q;
    if (!sel) return out;
    if (!(sel instanceof Array)) sel = [sel];
    for (q = 0; q < sel.length; q++) out.push(sel[q].index);
    return out;
  }
  var updating = false;
  lb.onChange = function () {
    var rows = selectedRows(), c, role0 = null, same = true, q;
    if (rows.length === 0) return;
    for (q = 0; q < rows.length; q++) {
      var ro = items[rowMap[rows[q]]].role;
      if (role0 === null) role0 = ro; else if (ro !== role0) same = false;
    }
    updating = true;
    dd.selection = null;
    if (same) for (c = 0; c < codes.length; c++) if (codes[c] === role0) { dd.selection = c; break; }
    // 個別に指定したスタイルがあれば表示する
    var ov = items[rowMap[rows[0]]].styleOverride || null, sameOv = true;
    for (q = 1; q < rows.length; q++) if ((items[rowMap[rows[q]]].styleOverride || null) !== ov) sameOv = false;
    ddStyle.selection = null;
    if (sameOv) {
      if (ov === null) ddStyle.selection = 0;
      else for (c = 0; c < styleNames.length; c++) if (styleNames[c] === ov) { ddStyle.selection = c + 1; break; }
    }
    updating = false;
  };
  ddStyle.onChange = function () {
    if (updating || !ddStyle.selection) return;
    var rows = selectedRows(), q, it, sel = ddStyle.selection.index;
    for (q = 0; q < rows.length; q++) {
      it = items[rowMap[rows[q]]];
      if (sel === 0) delete it.styleOverride; else it.styleOverride = styleNames[sel - 1];
    }
    refreshStyles();
  };
  dd.onChange = function () {
    if (updating || !dd.selection) return;
    var rows = selectedRows(), nr = codes[dd.selection.index], q, idx, it;
    for (q = 0; q < rows.length; q++) {
      idx = rows[q]; it = items[rowMap[idx]];
      if (it.role === "table" || it.role === "figure" || it.role === nr) continue;
      changeRole(it, nr, p);
      delete it.styleOverride;
      lb.items[idx].text = roleLabel(nr);
    }
    // 見出しの種類が変わると前後の段落のスタイル(変化形)も変わるので、全行の表示を更新する
    updating = true; ddStyle.selection = 0; updating = false;
    refreshStyles();
  };
  bStyles.onClick = function () {
    if (styleMapDialog(styleMap, styleNames, countRoles(items))) refreshStyles();
  };

  var btns = w.add("group");
  btns.alignment = "right";
  var ok = btns.add("button", undefined, "流し込む", { name: "ok" });
  var cancel = btns.add("button", undefined, "キャンセル", { name: "cancel" });
  ok.onClick = function () {
    var q;
    for (q = 0; q < punctBoxes.length; q++) punctBoxes[q].change.apply = punctBoxes[q].box.value;
    w.close(1);
  };
  cancel.onClick = function () { w.close(2); };
  fill();
  w.center();
  return w.show() === 1;
}

function fmtMapDialog(f) {
  var w = new Window("dialog", "文字の飾りに使う文字スタイル");
  w.orientation = "column";
  w.alignChildren = "fill";
  w.add("statictext", undefined, "文字スタイルの設定 (書体・下線・圏点など) から自動で選んであります。違うものだけ直してください。");
  var pnl = w.add("panel");
  pnl.alignChildren = "left";
  var list = ["(当てない)"].concat(f.names), dds = [], kd, row, dd, k, i;
  for (kd in f.counts) {
    if (!f.counts.hasOwnProperty(kd)) continue;
    row = pnl.add("group");
    row.add("statictext", undefined, comboLabel(kd) + " (" + f.counts[kd] + "か所)").preferredSize = [190, 20];
    dd = row.add("dropdownlist", undefined, list);
    dd.preferredSize = [320, 22];
    dd.selection = 0;
    for (k = 0; k < f.names.length; k++) if (f.names[k] === f.map[kd]) { dd.selection = k + 1; break; }
    dds.push({ kind: kd, dd: dd });
  }
  w.add("statictext", undefined, "※ 組み合わせ (イタリック＋太字 など) は、原稿に出てきたものだけ表示しています。", { multiline: true });
  w.add("statictext", undefined, "※ 和文の斜体は、欧文のイタリックでは代用しません (和文の書体にイタリックがないため)。");
  w.add("statictext", undefined, "※ 下点線・下波線などの線種で「(当てない)」を選んだ場合は、ふつうの下線のスタイルで代用します。");
  if (f.counts.ruby) w.add("statictext", undefined, "※ ルビの文字は、文字スタイルを当てなくても付きます。");
  w.add("statictext", undefined, "※ ここで選んだ内容はこの InDesign ファイルに記録され、次号でも使われます。");
  var btns = w.add("group");
  btns.alignment = "right";
  btns.add("button", undefined, "OK", { name: "ok" });
  btns.add("button", undefined, "キャンセル", { name: "cancel" });
  if (w.show() !== 1) return false;
  for (i = 0; i < dds.length; i++) {
    var sel = dds[i].dd.selection ? dds[i].dd.selection.index : 0;
    f.map[dds[i].kind] = sel === 0 ? null : f.names[sel - 1];
  }
  return true;
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
  var ALWAYS = { h1: 1, h2: 1, h3: 1, body: 1 };
  for (i = 0; i < ROLES.length; i++) {
    r = ROLES[i][0];
    if (!cnt[r] && !ALWAYS[r]) continue;
    row = pnl.add("group");
    row.add("statictext", undefined, ROLES[i][1] + (cnt[r] ? " (" + cnt[r] + ")" : "")).preferredSize = [150, 20];
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
var _loadStep = "";

// 読み込めなかった理由を、原因ごとの対処と一緒に伝える
function explainLoadError(e, docxName) {
  var m = String(e.message || e), hint;
  if (/ZIP|壊れて|docx ファイルではない|Word\(\.docx\)ファイルではない/.test(m)) {
    hint = "ファイルが .docx の形式になっていないようです。\n" +
           "・パスワード (保護) が付いた原稿は読めません。Word で保護を外して保存してください。\n" +
           "・Word で開き、「名前を付けて保存」で「Word 文書 (*.docx)」を選んで保存し直すと直ることがあります。";
  } else if (/開けません|コピー|見つかりません: /.test(m)) {
    hint = "・原稿を Word で開いたままの場合は、Word を閉じてからもう一度実行してください。\n" +
           "・OneDrive などにある原稿は、パソコンにダウンロードされているか確認してください。";
  } else {
    hint = "スクリプトの不具合の可能性があります。お手数ですが、この画面の内容を知らせてください。";
  }
  return "Word 原稿を読み込めませんでした。\n\n" +
         "原稿: " + docxName + "\n" +
         "止まった所: " + (_loadStep || "不明") + "\n" +
         "原因: " + m + (e.line ? " (スクリプトの " + e.line + " 行目)" : "") + "\n\n" + hint;
}

function loadDocx(src0, docxName) {
  var onProgress = function (r) { showProgress("Word 原稿を解析しています… " + Math.round(r * 100) + "%"); };
  // Word で開いたままの原稿でも読めるよう、まず一時フォルダにコピーしてから読む
  _loadStep = "原稿ファイルのコピー";
  var src = new File(Folder.temp + "/kiyo_genko_" + (new Date()).getTime() + ".docx");
  if (!src0.exists) throw new Error("原稿ファイルが見つかりません: " + src0.fsName);
  if (!src0.copy(src)) {
    src = src0;   // コピーできなければ元のファイルを直接読む
  }
  try {
    return loadDocxFrom(src, docxName, onProgress);
  } finally {
    if (src !== src0) { try { src.remove(); } catch (e) {} }
  }
}

function loadDocxFrom(src, docxName, onProgress) {
  _loadStep = "原稿の展開";
  showProgress("Word 原稿を展開しています… (" + docxName + ")");
  var folder = unzipDocxWithOS(src), ms;
  if (folder !== null) {
    _loadStep = "原稿の解析";
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
  if (!src.open("r")) throw new Error("原稿ファイルを開けませんでした");
  var bin = src.read();
  src.close();
  _loadStep = "原稿の解析";
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
    var path = joinZipPath(ms.docDir === undefined ? "word" : ms.docDir, target);
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

// 行数・列数を合わせる。増減は中ほどで行い、最初と最後の行(列)は残す。
// (最後の行だけ下罫線が太いなど、端の行・列のセルスタイルを保つため。
//  最後の行を写して増やすと、太い罫線の行が増えてしまう)
function resizeKeepingEnds(tbl, bodyRows, cols) {
  var guard = 0, n;
  while (tbl.bodyRowCount < bodyRows && guard++ < 1000) {
    n = tbl.rows.length;
    // 最後から2番目の行の後ろに足す = ふつうの行の書式を写す
    if (tbl.bodyRowCount >= 2) tbl.rows.add(LocationOptions.AFTER, tbl.rows[n - 2]);
    else tbl.bodyRowCount = tbl.bodyRowCount + 1;
  }
  while (tbl.bodyRowCount > bodyRows && tbl.bodyRowCount >= 2 && guard++ < 2000) {
    n = tbl.rows.length;
    tbl.rows[n - 2].remove();   // 本文の行が2行以上あるので、最後から2番目は本文の行
  }
  while (tbl.columnCount < cols && guard++ < 3000) {
    n = tbl.columns.length;
    if (n >= 2) tbl.columns.add(LocationOptions.AFTER, tbl.columns[n - 2]);
    else tbl.columnCount = tbl.columnCount + 1;
  }
  while (tbl.columnCount > cols && tbl.columnCount >= 2 && guard++ < 4000) {
    n = tbl.columns.length;
    tbl.columns[n - 2].remove();
  }
  // 念のため、合わなかったときは数で合わせる
  if (tbl.bodyRowCount !== bodyRows) tbl.bodyRowCount = bodyRows;
  if (tbl.columnCount !== cols) tbl.columnCount = cols;
}

function fillTable(tbl, rows, widths, targetWidth) {
  var R = rows.length, C = 0, r, c, flat = [];
  for (r = 0; r < R; r++) if (rows[r].length > C) C = rows[r].length;
  if (R === 0 || C === 0) return;
  var h = tbl.headerRowCount > 0 ? 1 : 0;
  if (R - h < 1) h = 0;
  tbl.headerRowCount = h;
  resizeKeepingEnds(tbl, R - h, C);
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

  // 3) 文字の飾り (イタリック・ルビなど)。注番号などの文字スタイルはこのあとで当てる
  var fmtSpans = [];
  for (i = 0; i < sb.chars.length; i++) {
    if (sb.chars[i].kind !== "fmt") continue;
    var sp0 = _copySpan(sb.chars[i].span);
    sp0.start = sb.chars[i].start; sp0.end = sb.chars[i].start + sb.chars[i].len;
    fmtSpans.push(sp0);
  }
  applyFmtSpans(story, fmtSpans, 0, mapIdx, ctx.fmtStyles, ctx.fmtStat);

  // 3') 文字スタイル (注番号・ダーシ・「キーワード：」「出典：」)
  var cs, c, miss = {};
  for (i = 0; i < sb.chars.length; i++) {
    c = sb.chars[i];
    if (c.kind === "footnote" || c.kind === "fmt") continue;
    cs = ctx.charStyles[c.kind];
    if (!cs) { miss[c.kind] = true; continue; }
    var s0 = mapIdx(c.start), s1 = mapIdx(c.start + c.len) - 1;
    try { story.characters.itemByRange(s0, s1).texts[0].appliedCharacterStyle = cs; } catch (e3) {}
  }

  // 4) Word の脚注を InDesign の脚注として入れる (後ろから入れると、前の位置がずれない)
  //    番号の書式と脚注本文のスタイルは、InDesign の「脚注オプション」の設定に従う
  var fns = [], nFn = 0, fnFail = 0;
  for (i = 0; i < sb.chars.length; i++) if (sb.chars[i].kind === "footnote") fns.push(sb.chars[i]);
  for (i = fns.length - 1; i >= 0; i--) {
    try {
      var fn = story.insertionPoints.item(mapIdx(fns[i].start)).footnotes.add();
      var fobj = built.footnotes && built.footnotes[fns[i].footnote] ? built.footnotes[fns[i].footnote] : null;
      var ftx = fobj ? fobj.text : "";
      if (ftx !== "") {
        var fbase = fn.characters.length;
        fn.insertionPoints.item(-1).contents = ftx;
        if (fobj.fmt && fobj.fmt.length > 0) applyFmtSpans(fn, fobj.fmt, fbase, makeIndexMapper(ftx), ctx.fmtStyles, ctx.fmtStat);
      }
      nFn++;
    } catch (e6) { fnFail++; }
  }
  if (nFn > 0) report.push("脚注 " + nFn + " 件を InDesign の脚注として入れました。");
  if (fnFail > 0) report.push("[注意] 脚注 " + fnFail + " 件を入れられませんでした。");

  // 5) 図と表 (後ろから入れると、前の段落の位置がずれない)
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
        if (it.cellFmt) applyCellFmt(tbl, it.table.rows, it.cellFmt, ctx);
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

// 表のセルの中の飾り (下線の線種・イタリックなど) を当てる
function applyCellFmt(tbl, rows, cellFmt, ctx) {
  var r, c, spans;
  for (r = 0; r < cellFmt.length; r++) {
    for (c = 0; c < cellFmt[r].length; c++) {
      spans = cellFmt[r][c];
      if (!spans || spans.length === 0) continue;
      try {
        applyFmtSpans(tbl.rows[r].cells[c], spans, 0, makeIndexMapper(rows[r][c]), ctx.fmtStyles, ctx.fmtStat);
      } catch (e) {
        ctx.fmtStat.failed = (ctx.fmtStat.failed || 0) + spans.length;
      }
    }
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
  // 文字の飾りに選んだ文字スタイルを、次号のためにファイルに記録する
  try { c.doc.insertLabel(FMT_LABEL, c.fmtSave); } catch (e3) {}
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
    _loadStep = "段落の種類の判定";
    showProgress("段落の種類を判定しています…");
    built = buildItems(ms, profile);
  } catch (e2) {
    hideProgress();
    if (ms && ms.folder) removeFolder(ms.folder);
    alert(explainLoadError(e2, docxName));
    return;
  }
  hideProgress();

  var sty = findStylesByName(doc);
  var styleMap = initialStyleMap(profile, sty.names);
  var notes = [];
  if (profile.learnedFrom === 0) notes.push("※ 前回号の体裁を学習できなかったため、スタイル名から推測しています。");
  if (front) notes.push("※ 題目〜キーワードは、別のテキストボックス(前回号で題目があった所)に入れます。");
  if (tailStart >= 0) notes.push("※ 英文要旨の部分は原稿にないため、前回号のまま残します。");
  var punct = punctMismatches(built, profile);
  var charNames = [], cdescs = describeCharStyles(doc), cd;
  for (cd = 0; cd < cdescs.length; cd++) if (cdescs[cd].name && cdescs[cd].name.charAt(0) !== "[") charNames.push(cdescs[cd].name);
  var fcounts = countFmtCombos(built), fkeys = [], fkk;
  for (fkk in fcounts) if (fcounts.hasOwnProperty(fkk)) fkeys.push(fkk);
  var fmtInfo = { counts: fcounts, map: guessComboStyleNames(fkeys, cdescs), names: charNames };
  // 前回までに選んだ文字スタイルがファイルに記録されていれば、それを優先する
  var saved = parseSavedMap(doc.extractLabel(FMT_LABEL)), sk2, known = {};
  for (cd = 0; cd < charNames.length; cd++) known[charNames[cd]] = true;
  for (sk2 in saved) {
    if (!saved.hasOwnProperty(sk2) || !fcounts[sk2]) continue;
    if (saved[sk2] === "") fmtInfo.map[sk2] = null;
    else if (known[saved[sk2]]) fmtInfo.map[sk2] = saved[sk2];
  }
  var convs = textConversions(built, profile);
  if (!confirmDialog(built, profile, styleMap, sty.names, { docxName: docxName, notes: notes, punct: punct, conv: convs, fmt: fmtInfo })) {
    if (ms.folder) removeFolder(ms.folder);
    return;
  }
  var pu, punctReport = [];
  for (pu = 0; pu < punct.length; pu++) {
    if (!punct[pu].apply) continue;
    unifyPunct(built, punct[pu]);
    punctReport.push("「" + punct[pu].from + "」→「" + punct[pu].to + "」を " + punct[pu].count + " か所置き換えました。");
  }
  for (pu = 0; pu < convs.length; pu++) {
    if (!convs[pu].apply) continue;
    applyTextConversion(built, convs[pu], profile);
    punctReport.push(convs[pu].label.replace(/ \(.*\)$/, "") + ": " + convs[pu].count + " か所を置き換えました。");
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
    frontBuilt = { items: fi, notes: 0, footnotes: built.footnotes };
    built = { items: bi, notes: built.notes, footnotes: built.footnotes, warnings: built.warnings };
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

  var report = punctReport;
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
    fmtStyles: {}, fmtStat: {},
    tableTemplate: null, tableHeadStyle: null, tableBodyStyle: null,
    front: front ? { story: front.story, built: frontBuilt, styleNames: resolveStyleNames(frontBuilt.items, profile, styleMap) } : null
  };
  var fk;
  for (fk in fmtInfo.map) if (fmtInfo.map.hasOwnProperty(fk) && fmtInfo.map[fk]) _ctx.fmtStyles[fk] = findCharStyle(doc, fmtInfo.map[fk]);
  _ctx.fmtSave = serializeSavedMap(saved, fmtInfo.map, fcounts);
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

  // 文字の飾りの結果
  var st = _ctx.fmtStat, fq2, fparts = [], fskip = [];
  for (fq2 in st) {
    if (!st.hasOwnProperty(fq2) || fq2 === "failed") continue;
    if (fq2.indexOf("skip_") === 0) fskip.push(comboLabel(fq2.substring(5)) + " " + st[fq2] + "か所");
    else fparts.push(comboLabel(fq2) + " " + st[fq2] + "か所");
  }
  if (fparts.length > 0) report.push("文字の飾りを当てました: " + fparts.join(" / "));
  if (fskip.length > 0) report.push("[注意] 文字スタイルを選んでいないため当てなかった飾り: " + fskip.join(" / "));
  if (st.failed) report.push("[注意] 文字の飾り " + st.failed + " か所を当てられませんでした。");

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
  report.push("・文字の飾り (表の中のイタリックなどは取り込んでいません)");
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
