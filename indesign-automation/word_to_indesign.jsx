// word_to_indesign.jsx
// 英米文化学会 大会ポスター 自動流し込みスクリプト
//
// 使い方:
//   1. InDesign で昨年のポスター(.indd)のコピーを開く
//   2. このスクリプトを実行し、今年の Word 原稿(.docx またはテキスト)を選ぶ
//   3. 置き換え結果のレポートを確認し、紙面を目視チェックして別名保存する
//
// 詳細は同フォルダの README.md を参照。
// 対応: InDesign CS6〜2025 (ExtendScript / Mac・Windows)

// ===== CORE BEGIN =====
// このセクションは InDesign に依存しない純粋な文字列処理。
// Node.js のテストハーネス (test/run_tests.js) からも読み込まれる。

var SECTION_LABELS = [
  "受付開始", "開会の辞", "開会の言葉", "研究発表", "小休憩", "昼食休憩",
  "休憩", "基調講演", "特別講演", "シンポジウム",
  "閉会の辞", "閉会の言葉", "懇親会", "総会"
];

function trimWS(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/^[\s　]+/, "").replace(/[\s　]+$/, "");
}

function toHanDigits(s) {
  var out = "", i, c;
  for (i = 0; i < s.length; i++) {
    c = s.charCodeAt(i);
    if (c >= 0xFF10 && c <= 0xFF19) out += String.fromCharCode(c - 0xFF10 + 0x30);
    else out += s.charAt(i);
  }
  return out;
}

// 時間表記のマッチ。＜10:30－11:00＞ / 〈10:20 – 10:30〉 / <10:00> などに対応。
// 戻り値: { raw, open, close, colon, sep, h1,m1,h2,m2, norm } / マッチしなければ null
function matchTime(line) {
  var re = /([＜<〈])\s*([0-9０-９]{1,2})\s*([:：])\s*([0-9０-９]{2})(?:([\s　]*[-－–—ー~〜][\s　]*)([0-9０-９]{1,2})\s*[:：]\s*([0-9０-９]{2}))?\s*([＞>〉])/;
  var m = line.match(re);
  if (!m) return null;
  var t = {
    raw: m[0], open: m[1], colon: m[3], close: m[8],
    h1: toHanDigits(m[2]), m1: toHanDigits(m[4]),
    sep: m[5] || null, // 前後の空白を含むダーシ部分 (旧表記の体裁維持用)
    h2: m[6] ? toHanDigits(m[6]) : null,
    m2: m[7] ? toHanDigits(m[7]) : null
  };
  t.norm = t.h1 + ":" + t.m1 + (t.h2 ? "-" + t.h2 + ":" + t.m2 : "");
  return t;
}

// 新しい時刻(normalized "10:30-11:00")を、旧表記の記号(括弧・コロン・ダーシ)を保って組み立てる
function formatTimeLike(oldT, newNorm) {
  var parts = newNorm.split("-");
  var a = parts[0].split(":"), b = parts.length > 1 ? parts[1].split(":") : null;
  var s = oldT.open + a[0] + oldT.colon + a[1];
  if (b) s += (oldT.sep || "－") + b[0] + oldT.colon + b[1];
  s += oldT.close;
  return s;
}

// ラベルは「休　憩」「懇 親 会」のように字間に空白が入ることがあるため
// 柔軟にマッチする。ただし「懇親会費」のような別語を誤認しないよう、
// ラベルの直後は行末・空白・時間括弧・コロンのみ許す。
function matchSectionLabel(line) {
  var i, lab, re, m, rest, t = trimWS(line);
  for (i = 0; i < SECTION_LABELS.length; i++) {
    lab = SECTION_LABELS[i];
    re = new RegExp("^" + lab.split("").join("[\\s　]*"));
    m = t.match(re);
    if (m) {
      rest = t.substring(m[0].length);
      if (rest === "" || /^[\s　＜<〈：:]/.test(rest)) return lab;
    }
  }
  return null;
}

// 役割キーワードの位置を列挙する。行頭か、直前が空白・「／」等の場合のみ
// マーカーとみなす (人名等にキーワードが含まれる場合の誤検出を防ぐ)。
function findRoleHits(line) {
  var re = /(^|[\s　／\/、・(（])(発表者|講演者|司会・発表|司会者|講師)([\s　:：]*)/g;
  var hits = [], m;
  while ((m = re.exec(line)) !== null) {
    hits.push({
      role: m[2],
      start: m.index + m[1].length,
      valStart: m.index + m[0].length
    });
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return hits;
}

// 「発表者　X（A大学）　司会者　Y（B大学）」等を役割ごとに分解
// 戻り値: [{ role: "発表者", value: "X（A大学）" }, ...]
function splitRoles(line) {
  var hits = findRoleHits(line), out = [], i, val, endPos;
  for (i = 0; i < hits.length; i++) {
    endPos = (i + 1 < hits.length) ? hits[i + 1].start : line.length;
    val = trimWS(line.substring(hits[i].valStart, endPos));
    val = val.replace(/[\s　\/／]+$/, "");
    out.push({ role: hits[i].role, value: val });
  }
  return out;
}

// セクション行のうち時間表記より後ろの部分 (例: 開会の辞 行の「会長　田嶋…」)
function sectionTrailing(line, timeM) {
  if (!timeM) return "";
  var idx = line.indexOf(timeM.raw);
  if (idx < 0) return "";
  return trimWS(line.substring(idx + timeM.raw.length));
}

// Word 原稿(プレーンテキスト)を構造化する
function parseManuscript(rawText) {
  var lines = String(rawText).replace(/\r\n?/g, "\n").split("\n");
  var model = {
    headerLines: [], taikaiNo: null, taikaiLine: null, dateLine: null, venueLine: null,
    events: [],          // { kind:"section", label, time, trailing, raw }
    presentations: [],   // { time, title, roles:[{role,value}], keynote }
    konshinkai: null,    // { event, lines:[] }
    jimukyoku: [],
    warnings: []
  };
  var headerDone = false, inKonshinkai = false, inJimukyoku = false;
  var cur = null;
  function closeCur() {
    if (cur) {
      cur.title = trimWS(cur.title);
      model.presentations.push(cur);
      cur = null;
    }
  }
  var i, ln, lab, timeM, roles, m;
  for (i = 0; i < lines.length; i++) {
    ln = trimWS(lines[i]);
    if (!ln) continue;
    lab = matchSectionLabel(ln);
    timeM = matchTime(ln);

    if (!headerDone && !lab) {
      model.headerLines.push(ln);
      m = ln.match(/第\s*([0-9０-９]+)\s*回/);
      if (m && model.taikaiNo === null) { model.taikaiNo = toHanDigits(m[1]); model.taikaiLine = ln; }
      if (!model.dateLine && /(令和|平成|[0-9０-９]{4}年)/.test(ln) && /月/.test(ln) && /日/.test(ln)) model.dateLine = ln;
      else if (!model.venueLine && (/〒/.test(ln) || /会場/.test(ln))) model.venueLine = ln;
      continue;
    }
    headerDone = true;

    if (/^(学会)?事務局/.test(ln)) {
      closeCur(); inJimukyoku = true; inKonshinkai = false;
      model.jimukyoku.push(ln); continue;
    }
    if (inJimukyoku) { model.jimukyoku.push(ln); continue; }

    if (lab) {
      closeCur();
      var ev = { kind: "section", label: lab, time: timeM, trailing: sectionTrailing(ln, timeM), raw: ln };
      model.events.push(ev);
      inKonshinkai = (lab === "懇親会");
      if (inKonshinkai) model.konshinkai = { event: ev, lines: [] };
      if (lab === "基調講演" || lab === "特別講演") {
        cur = { time: timeM ? timeM.norm : null, title: "", roles: [], keynote: true };
      }
      continue;
    }
    if (inKonshinkai) { model.konshinkai.lines.push(ln); continue; }

    // 単独の時間行 → 新しい発表ブロックの開始
    if (timeM && trimWS(ln.replace(timeM.raw, "")) === "") {
      closeCur();
      cur = { time: timeM.norm, title: "", roles: [], keynote: false };
      continue;
    }
    roles = splitRoles(ln);
    if (roles.length > 0 && cur) {
      var r;
      for (r = 0; r < roles.length; r++) cur.roles.push(roles[r]);
      continue;
    }
    if (cur) {
      cur.title += (cur.title ? "　" : "") + ln;
      continue;
    }
    model.warnings.push("原稿の次の行はどこにも分類できませんでした: " + ln);
  }
  closeCur();
  return model;
}

// タイトルを主題と「—副題—」に分割 (副題がなければ sub は null)
function splitTitle(title) {
  var m = title.match(/^(.*?)([—―–\-].*[—―–\-]?)$/);
  if (m && trimWS(m[1]) && m[2].length >= 4) {
    return { main: trimWS(m[1]), sub: trimWS(m[2]) };
  }
  return { main: title, sub: null };
}

// 「講師」と「講演者」のような呼称揺れは同じグループとして扱う
function roleGroup(roleName) {
  if (roleName === "講師" || roleName === "講演者") return "講演者";
  return roleName;
}

function getRoleValue(pres, roleName) {
  var i, g = roleGroup(roleName);
  if (!pres) return null;
  for (i = 0; i < pres.roles.length; i++) {
    if (roleGroup(pres.roles[i].role) === g) return pres.roles[i].value;
  }
  // 司会・発表 は 発表者/司会者 のどちらの問い合わせにも答える
  for (i = 0; i < pres.roles.length; i++) {
    if (pres.roles[i].role === "司会・発表") return pres.roles[i].value;
  }
  return null;
}

// ---- 旧紙面の1段落テキストに新データを適用する置換関数群 ----
// いずれも「置換後テキスト」または null(対象外) を返す

function substituteTime(oldText, newNorm) {
  var t = matchTime(oldText);
  if (!t || !newNorm) return null;
  var i = oldText.indexOf(t.raw);
  return oldText.substring(0, i) + formatTimeLike(t, newNorm) + oldText.substring(i + t.raw.length);
}

function substituteSection(oldText, ev) {
  var t = matchTime(oldText), i, head, tail;
  if (!t || !ev.time) return null;
  i = oldText.indexOf(t.raw);
  head = oldText.substring(0, i) + formatTimeLike(t, ev.time.norm);
  tail = oldText.substring(i + t.raw.length);
  // 時間の後ろに人名などがある場合のみ、区切りの空白(タブ等)を保って差し替える。
  // 旧紙面側に後続テキストがない場合は追加しない (別フレームにある可能性が高いため)。
  if (ev.trailing && trimWS(tail) !== "") {
    tail = tail.match(/^[\s　]*/)[0] + ev.trailing;
  }
  return head + tail;
}

function substituteRoles(oldText, pres) {
  var hits = findRoleHits(oldText);
  if (hits.length === 0) return null;
  var out = "", i, endPos, newVal, valSeg, trailWSM, trailWS, lastEnd = 0, changed = false;
  for (i = 0; i < hits.length; i++) {
    out += oldText.substring(lastEnd, hits[i].valStart);
    endPos = (i + 1 < hits.length) ? hits[i + 1].start : oldText.length;
    valSeg = oldText.substring(hits[i].valStart, endPos);
    trailWSM = valSeg.match(/[\s　\/／]*$/);
    trailWS = trailWSM ? trailWSM[0] : "";
    newVal = getRoleValue(pres, hits[i].role);
    if (newVal !== null) { out += newVal + trailWS; changed = true; }
    else out += valSeg;
    lastEnd = endPos;
  }
  out += oldText.substring(lastEnd);
  return changed ? out : null;
}

// 懇親会ブロックの行(住所・会費・締切)を新データで置換
function substituteKonshinkaiLine(oldText, kon) {
  var i, ln, out = null;
  if (!kon) return null;
  if (/〒/.test(oldText)) {
    for (i = 0; i < kon.lines.length; i++) {
      if (/〒/.test(kon.lines[i])) return replaceKeepingEdges(oldText, kon.lines[i]);
    }
  }
  if (/懇親会費/.test(oldText)) {
    for (i = 0; i < kon.lines.length; i++) {
      ln = kon.lines[i];
      var feeM = ln.match(/懇親会費[\s　]*([0-9０-９,，]+)[\s　]*円/);
      if (feeM) {
        return oldText.replace(/懇親会費([\s　]*)[0-9０-９,，]+([\s　]*)円/, "懇親会費$1" + feeM[1] + "$2円");
      }
    }
  }
  if (/まで/.test(oldText) && /申し込み|申込/.test(oldText)) {
    for (i = 0; i < kon.lines.length; i++) {
      if (/まで/.test(kon.lines[i]) && /申し込み|申込/.test(kon.lines[i])) {
        var dM = kon.lines[i].match(/([0-9０-９]+月[0-9０-９]+日（.）?)/);
        if (dM) {
          out = oldText.replace(/[0-9０-９]+月[0-9０-９]+日（.）?/, dM[1]);
          if (out !== oldText) return out;
        }
        return replaceKeepingEdges(oldText, kon.lines[i]);
      }
    }
  }
  return null;
}

// 前後の空白(インデント等)を保ったまま中身だけ差し替える
function replaceKeepingEdges(oldText, newCore) {
  var head = oldText.match(/^[\s　]*/)[0];
  var tail = oldText.match(/[\s　]*$/)[0];
  return head + trimWS(newCore) + tail;
}

// ------------------------------------------------------------
// .docx 直接読み込み (docx は ZIP。word/document.xml を取り出して
// DEFLATE を自前で展開する。外部ツール不要で Mac/Windows 共通)
// ------------------------------------------------------------

// bin: 1文字=1バイトのバイナリ文字列
function bcc(bin, i) { return bin.charCodeAt(i) & 0xFF; }
function u16at(bin, i) { return bcc(bin, i) | (bcc(bin, i + 1) << 8); }
function u32at(bin, i) {
  return (bcc(bin, i) | (bcc(bin, i + 1) << 8) | (bcc(bin, i + 2) << 16)) + bcc(bin, i + 3) * 16777216;
}

// --- DEFLATE 展開 (Mark Adler の puff アルゴリズムの移植) ---
function _infBits(st, n) {
  while (st.bitcnt < n) {
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
  return { count: count, symbol: symbol };
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
  var sym, len, dist, from, k;
  for (;;) {
    sym = _infDecode(st, lencode);
    if (sym < 256) { out[out.length] = sym; }
    else if (sym === 256) return;
    else {
      sym -= 257;
      len = _LBASE[sym] + _infBits(st, _LEXT[sym]);
      sym = _infDecode(st, distcode);
      dist = _DBASE[sym] + _infBits(st, _DEXT[sym]);
      from = out.length - dist;
      if (from < 0) throw new Error("inflate: 距離が範囲外");
      for (k = 0; k < len; k++) out[out.length] = out[from + k];
    }
  }
}

function _infFixedTrees() {
  var lengths = [], i;
  for (i = 0; i < 144; i++) lengths[i] = 8;
  for (; i < 256; i++) lengths[i] = 9;
  for (; i < 280; i++) lengths[i] = 7;
  for (; i < 288; i++) lengths[i] = 8;
  var lencode = _infConstruct(lengths, 288);
  lengths = [];
  for (i = 0; i < 30; i++) lengths[i] = 5;
  return { lencode: lencode, distcode: _infConstruct(lengths, 30) };
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
    sym = _infDecode(st, lencode);
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

// --- ZIP から指定名のエントリのバイト配列を取り出す ---
function zipExtract(bin, wantName) {
  // End of Central Directory を末尾から探す
  var i = bin.length - 22, eocd = -1;
  var stop = bin.length - 22 - 65558; if (stop < 0) stop = 0;
  for (; i >= stop; i--) {
    if (bcc(bin, i) === 0x50 && bcc(bin, i + 1) === 0x4B && bcc(bin, i + 2) === 0x05 && bcc(bin, i + 3) === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("ZIP形式ではありません");
  var n = u16at(bin, eocd + 10);
  var ofs = u32at(bin, eocd + 16);
  var e, method, csize, nameLen, extraLen, cmtLen, localOfs, name, dataOfs;
  for (e = 0; e < n; e++) {
    if (u32at(bin, ofs) !== 0x02014B50) throw new Error("ZIPセントラルディレクトリが壊れています");
    method = u16at(bin, ofs + 10);
    csize = u32at(bin, ofs + 20);
    nameLen = u16at(bin, ofs + 28);
    extraLen = u16at(bin, ofs + 30);
    cmtLen = u16at(bin, ofs + 32);
    localOfs = u32at(bin, ofs + 42);
    name = bin.substring(ofs + 46, ofs + 46 + nameLen);
    if (name === wantName) {
      dataOfs = localOfs + 30 + u16at(bin, localOfs + 26) + u16at(bin, localOfs + 28);
      var comp = bin.substring(dataOfs, dataOfs + csize);
      if (method === 8) return inflateRaw(comp);
      if (method === 0) { var arr = [], k; for (k = 0; k < comp.length; k++) arr[k] = bcc(comp, k); return arr; }
      throw new Error("未対応の圧縮方式: " + method);
    }
    ofs += 46 + nameLen + extraLen + cmtLen;
  }
  return null;
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
  var s = "", i, chunk = 8192;
  for (i = 0; i < units.length; i += chunk) {
    s += String.fromCharCode.apply(null, units.slice(i, i + chunk));
  }
  return s;
}

function utf8DecodeStr(bin, start) {
  var bytes = [], i;
  for (i = start; i < bin.length; i++) bytes[bytes.length] = bcc(bin, i);
  return utf8DecodeBytes(bytes);
}

function utf16Decode(bin, start, littleEndian) {
  var units = [], i;
  for (i = start; i + 1 < bin.length; i += 2) {
    units[units.length] = littleEndian ? (bcc(bin, i) | (bcc(bin, i + 1) << 8))
                                       : ((bcc(bin, i) << 8) | bcc(bin, i + 1));
  }
  return unitsToString(units);
}

// 原稿らしさの判定 (文字コード自動判別用): 見つかったキーワードの種類数
var _KEYWORDS = ["発表", "大会", "開会", "学会", "講演", "司会", "懇親", "休憩", "研究", "事務局"];
function countKeywordHits(text) {
  var i, hits = 0;
  for (i = 0; i < _KEYWORDS.length; i++) {
    if (text.indexOf(_KEYWORDS[i]) >= 0) hits++;
  }
  return hits;
}

// バイナリ文字列からテキストの文字コードを自動判別してデコード。
// 判別できなければ null (Shift-JIS の可能性 → 呼び出し側で File の変換機能を試す)
function decodeTextAuto(bin) {
  if (bin.length === 0) return null;
  var b0 = bcc(bin, 0), b1 = bin.length > 1 ? bcc(bin, 1) : -1, b2 = bin.length > 2 ? bcc(bin, 2) : -1;
  var text;
  if (b0 === 0xEF && b1 === 0xBB && b2 === 0xBF) {
    text = utf8DecodeStr(bin, 3);
    if (text !== null) return { text: text, encoding: "UTF-8" };
  }
  if (b0 === 0xFF && b1 === 0xFE) return { text: utf16Decode(bin, 2, true), encoding: "UTF-16LE" };
  if (b0 === 0xFE && b1 === 0xFF) return { text: utf16Decode(bin, 2, false), encoding: "UTF-16BE" };
  text = utf8DecodeStr(bin, 0);
  if (text !== null && countKeywordHits(text) > 0) return { text: text, encoding: "UTF-8" };
  var le = utf16Decode(bin, 0, true), be = utf16Decode(bin, 0, false);
  var sl = countKeywordHits(le), sb = countKeywordHits(be);
  if (sl > 0 || sb > 0) {
    return sl >= sb ? { text: le, encoding: "UTF-16LE" } : { text: be, encoding: "UTF-16BE" };
  }
  return null;
}

// --- document.xml → プレーンテキスト ---
function decodeXmlEntities(s) {
  s = s.replace(/&#x([0-9A-Fa-f]+);/g, function (m0, h) { return String.fromCharCode(parseInt(h, 16)); });
  s = s.replace(/&#([0-9]+);/g, function (m0, d) { return String.fromCharCode(parseInt(d, 10)); });
  s = s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  return s;
}

function docxXmlToText(xml) {
  var lines = [], pRe = /<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, pm;
  var tokRe, tm, seg, line;
  while ((pm = pRe.exec(xml)) !== null) {
    seg = pm[0];
    // フィールドコードや削除済みテキストは無視
    seg = seg.replace(/<w:instrText[\s\S]*?<\/w:instrText>/g, "").replace(/<w:delText[\s\S]*?<\/w:delText>/g, "");
    line = "";
    tokRe = /<w:t(?:\s[^>]*)?\/>|<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab(?:\s[^>]*)?\/>|<w:br(?:\s[^>]*)?\/>/g;
    while ((tm = tokRe.exec(seg)) !== null) {
      if (tm[0].indexOf("<w:tab") === 0) line += "\t";
      else if (tm[0].indexOf("<w:br") === 0) line += "\n";
      else if (tm[1]) line += decodeXmlEntities(tm[1]);
    }
    lines[lines.length] = line;
  }
  return lines.join("\n");
}

// .docx のバイナリ文字列 → 原稿プレーンテキスト
function docxBinToText(bin) {
  var bytes = zipExtract(bin, "word/document.xml");
  if (bytes === null) throw new Error("word/document.xml が見つかりません (docx ではない?)");
  var xml = utf8DecodeBytes(bytes);
  if (xml === null) throw new Error("document.xml の文字コードが不正です");
  return docxXmlToText(xml);
}

// ===== CORE END =====

// ============================================================
// ここから InDesign 依存部
// ============================================================

function main() {
  if (app.documents.length === 0) {
    alert("先に昨年のポスター(.indd のコピー)を開いてから実行してください。");
    return;
  }
  var doc = app.activeDocument;

  var src = File.openDialog("今年の Word 原稿を選択してください (.docx または .txt)");
  if (!src) return;

  var text = readManuscript(src);
  if (text === null) return;

  var model = parseManuscript(text);
  if (model.presentations.length === 0 && model.events.length === 0) {
    var preview = trimWS(text).substring(0, 120);
    alert("原稿を解析できませんでした。選んだファイルが大会プログラムの原稿か確認してください。\n\n読み取った内容の先頭:\n" + preview);
    return;
  }

  var report = [];
  report.push("=== 自動流し込みレポート ===");
  report.push("原稿: " + decodeURI(src.name));
  report.push("解析結果: 発表 " + model.presentations.length + " 件 / セクション " + model.events.length + " 件");
  report.push("");

  // 1) 大会回数 (第43回 → 第44回 のように、ドキュメント全体で置換)
  replaceTaikaiNumber(doc, model, report);

  // 2) 開催日 (令和X年X月X日（X） をドキュメント全体で置換)
  replaceDates(doc, model, report);

  // 3) プログラム本文ストーリー
  var story = findMainStory(doc);
  if (story) {
    fillMainStory(story, model, report);
  } else {
    report.push("[警告] プログラム本文のストーリーが見つかりませんでした。");
  }

  // 4) 残りの警告
  var i;
  for (i = 0; i < model.warnings.length; i++) report.push("[原稿] " + model.warnings[i]);
  report.push("");
  report.push("※ 会場・〒・事務局・E-mail などの固定情報は自動置換の対象外です。変更がある年は手動で直してください。");
  report.push("※ タイトル内のイタリック等の文字装飾は失われるため、紙面を目視確認してください。");

  writeReport(doc, report);
  alert("流し込みが完了しました。\n\nレポート:\n" + report.join("\n").substring(0, 1500) + "\n\n(全文はドキュメントと同じ場所の txt に保存されています)");
}

function readBinary(src) {
  var f = new File(src.fsName);
  f.encoding = "BINARY";
  if (!f.open("r")) { alert("ファイルを開けませんでした: " + f.fsName); return null; }
  var bin = f.read();
  f.close();
  return bin;
}

function readWithFileEncoding(src, enc) {
  var f = new File(src.fsName);
  f.encoding = enc;
  var text = null;
  try {
    if (f.open("r")) { text = f.read(); f.close(); }
  } catch (e) { try { f.close(); } catch (e2) {} }
  if (text !== null && text.length > 0 && text.charCodeAt(0) === 0xFEFF) text = text.substring(1);
  return text;
}

function readManuscript(src) {
  var bin = readBinary(src);
  if (bin === null) return null;
  var name = decodeURI(src.name).toLowerCase();

  // .docx は ZIP を直接展開して読む (Mac/Windows 共通・外部ツール不要)
  if (/\.docx$/.test(name) || bin.substring(0, 2) === "PK") {
    try {
      return docxBinToText(bin);
    } catch (e) {
      alert("Word(.docx)の読み取りに失敗しました。\n" + e.message +
            "\n\nWord で「書式なし/テキストのみ(.txt)」保存したファイルでも実行できます。");
      return null;
    }
  }
  if (/\.doc$/.test(name) || (bin.length > 1 && bcc(bin, 0) === 0xD0 && bcc(bin, 1) === 0xCF)) {
    alert("旧形式の .doc は読み込めません。Word で「.docx」または「書式なし(.txt)」で保存し直してください。");
    return null;
  }

  // テキストファイル: UTF-8 / UTF-16 は自動判別
  var dec = decodeTextAuto(bin);
  if (dec !== null && countKeywordHits(dec.text) > 0) return dec.text;

  // Shift-JIS (Windows の Word の「書式なし保存」の既定) は File の変換機能で
  var encs = ["SHIFT_JIS", "CP932", "SJIS", "WINDOWS-31J", "MS932"], i, text;
  for (i = 0; i < encs.length; i++) {
    text = readWithFileEncoding(src, encs[i]);
    if (text !== null && countKeywordHits(text) > 0) return text;
  }
  if (dec !== null) return dec.text; // 文字コードは正しそうだが内容が原稿らしくない → 解析側の診断に回す
  alert("テキストファイルの文字コードを判別できませんでした。\nWord の「名前を付けて保存」で .docx のまま保存したファイルを選ぶのが確実です。");
  return null;
}

function resetFindGrep() {
  app.findGrepPreferences = NothingEnum.NOTHING;
  app.changeGrepPreferences = NothingEnum.NOTHING;
}

function replaceTaikaiNumber(doc, model, report) {
  if (!model.taikaiNo) { report.push("[警告] 原稿から「第◯回」が見つかりませんでした。"); return; }
  resetFindGrep();
  app.findGrepPreferences.findWhat = "第\\s*([0-9０-９]+)\\s*回大会";
  var found = doc.findGrep();
  if (found.length === 0) {
    report.push("[警告] 紙面に「第◯回大会」が見つかりません。大会回数は手動で確認してください。");
    resetFindGrep();
    return;
  }
  var oldNo = toHanDigits(found[0].contents.replace(/[^0-9０-９]/g, ""));
  if (oldNo === model.taikaiNo) {
    report.push("大会回数: 既に 第" + oldNo + "回 のため変更なし");
    resetFindGrep();
    return;
  }
  // 「第43回」をドキュメント全体で新しい回数に (タイトルの大きな数字も対象)
  resetFindGrep();
  app.findGrepPreferences.findWhat = "第\\s*" + oldNo + "\\s*回";
  app.changeGrepPreferences.changeTo = "第" + model.taikaiNo + "回";
  var n = doc.changeGrep().length;
  resetFindGrep();
  // 全角数字パターンも念のため
  var zen = "", i;
  for (i = 0; i < oldNo.length; i++) zen += String.fromCharCode(oldNo.charCodeAt(i) - 0x30 + 0xFF10);
  app.findGrepPreferences.findWhat = "第\\s*" + zen + "\\s*回";
  app.changeGrepPreferences.changeTo = "第" + model.taikaiNo + "回";
  n += doc.changeGrep().length;
  resetFindGrep();
  report.push("大会回数: 第" + oldNo + "回 → 第" + model.taikaiNo + "回 (" + n + " 箇所)");
}

function replaceDates(doc, model, report) {
  if (!model.dateLine) { report.push("[警告] 原稿から開催日が見つかりませんでした。"); return; }
  var dM = model.dateLine.match(/(令和|平成)\s*[0-9０-９]+年\s*[0-9０-９]+月\s*[0-9０-９]+日（.）?/);
  var newDate = dM ? dM[0] : model.dateLine;
  resetFindGrep();
  app.findGrepPreferences.findWhat = "(令和|平成)\\s*[0-9０-９]+年\\s*[0-9０-９]+月\\s*[0-9０-９]+日（.）?";
  app.changeGrepPreferences.changeTo = newDate;
  var n = doc.changeGrep().length;
  resetFindGrep();
  if (n > 0) report.push("開催日: → " + newDate + " (" + n + " 箇所)");
  else report.push("[警告] 紙面に「令和◯年◯月◯日」形式の日付が見つかりません。開催日はタイトル部を手動で確認してください。(年・月・日が別々のフレームの場合があります)");
}

function findMainStory(doc) {
  var i, s, best = null, bestScore = 0, score, txt;
  for (i = 0; i < doc.stories.length; i++) {
    s = doc.stories[i];
    txt = s.contents;
    score = 0;
    if (txt.indexOf("開会の辞") >= 0) score += 2;
    if (txt.indexOf("研究発表") >= 0) score += 2;
    if (txt.indexOf("発表者") >= 0) score += 1;
    if (txt.indexOf("司会者") >= 0) score += 1;
    if (txt.indexOf("閉会の辞") >= 0) score += 1;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return bestScore >= 3 ? best : null;
}

function styleNameOf(para) {
  try { return para.appliedParagraphStyle.name; } catch (e) { return ""; }
}

function setParaText(para, newText) {
  var c = para.contents;
  var hadCR = (c.length > 0 && c.charAt(c.length - 1) === "\r");
  para.contents = newText + (hadCR ? "\r" : "");
}

function fillMainStory(story, model, report) {
  var paras = story.paragraphs;
  var presIdx = -1;          // 現在の発表ブロック
  var titleDone = false;
  var evPtr = 0;             // model.events の消費位置
  var inKonshinkaiZone = false;
  var i, para, text, plain, lab, t, style, newText, pres;

  function nextEvent(label) {
    var j;
    for (j = evPtr; j < model.events.length; j++) {
      if (model.events[j].label === label ||
          (label === "休憩" && /^休/.test(model.events[j].label))) {
        evPtr = j + 1;
        return model.events[j];
      }
    }
    return null;
  }
  function currentPres() {
    return (presIdx >= 0 && presIdx < model.presentations.length) ? model.presentations[presIdx] : null;
  }

  for (i = 0; i < paras.length; i++) {
    para = paras[i];
    text = para.contents.replace(/\r$/, "");
    plain = trimWS(text);
    if (!plain) continue;
    style = styleNameOf(para);
    lab = matchSectionLabel(plain);
    t = matchTime(plain);

    // --- セクション見出し行 ---
    if (lab) {
      inKonshinkaiZone = (lab === "懇親会");
      var ev = nextEvent(lab);
      if (ev) {
        newText = substituteSection(text, ev);
        if (newText !== null && newText !== text) {
          setParaText(para, newText);
          report.push("セクション「" + lab + "」: 時刻等を更新");
        }
        if (lab === "基調講演" || lab === "特別講演") {
          // 基調講演ブロックへ (keynote フラグ付きの発表を探す)
          var k;
          for (k = 0; k < model.presentations.length; k++) {
            if (model.presentations[k].keynote) { presIdx = k; titleDone = false; break; }
          }
        }
      } else {
        report.push("[警告] 紙面のセクション「" + plain.substring(0, 12) + "…」に対応する原稿の行が見つかりません。手動で確認してください。");
      }
      continue;
    }

    if (inKonshinkaiZone) {
      newText = substituteKonshinkaiLine(text, model.konshinkai);
      if (newText !== null && newText !== text) {
        setParaText(para, newText);
        report.push("懇親会情報を更新: " + trimWS(newText).substring(0, 30));
      }
      continue;
    }

    // --- 単独の時間行 → 次の発表ブロックへ ---
    if (t && trimWS(plain.replace(t.raw, "")) === "") {
      // 次の一般発表 (keynote 以外) に進む
      var j = presIdx + 1;
      while (j < model.presentations.length && model.presentations[j].keynote) j++;
      if (j < model.presentations.length) {
        presIdx = j; titleDone = false;
        pres = model.presentations[presIdx];
        if (pres.time) {
          newText = substituteTime(text, pres.time);
          if (newText !== null && newText !== text) setParaText(para, newText);
        }
        report.push("発表" + (presIdx + 1) + ": 時間 " + (pres.time || "(なし)"));
      } else {
        report.push("[警告] 紙面の発表枠が原稿の発表件数より多いようです。＜" + plain + "＞以降は手動で調整してください。");
      }
      continue;
    }

    // --- 発表者・司会者・講演者行 ---
    if (/(発表者|講演者|司会・発表|司会者)/.test(plain)) {
      pres = currentPres();
      newText = substituteRoles(text, pres);
      if (newText !== null && newText !== text) {
        setParaText(para, newText);
        report.push("担当者を更新: " + trimWS(newText).substring(0, 40));
      } else if (pres === null) {
        report.push("[警告] 対応する発表が見つからない担当者行: " + plain.substring(0, 30));
      }
      continue;
    }

    // --- タイトル行 (段落スタイル or 文脈で判定) ---
    pres = currentPres();
    if (pres && !titleDone) {
      var isTitleStyle = /タイトル|講演/.test(style);
      // スタイル名で判定できない場合も、発表ブロック直後の本文行はタイトルとみなす
      var parts = splitTitle(pres.title);
      // 次の段落が副タイトル用スタイルか確認
      var nextStyle = "";
      var ni = i + 1;
      while (ni < paras.length && trimWS(paras[ni].contents.replace(/\r$/, "")) === "") ni++;
      if (ni < paras.length) nextStyle = styleNameOf(paras[ni]);
      var nextIsSub = /副タイトル|サブ/.test(nextStyle);

      if (nextIsSub && parts.sub) {
        setParaText(para, parts.main);
        setParaText(paras[ni], parts.sub);
        report.push("タイトル更新(主+副): " + parts.main.substring(0, 30));
        i = ni; // 副タイトル段落は処理済み
      } else if (nextIsSub && !parts.sub) {
        setParaText(para, pres.title);
        setParaText(paras[ni], "");
        report.push("タイトル更新: " + pres.title.substring(0, 30) + " ([注意] 副題フレームを空にしました)");
        i = ni;
      } else {
        setParaText(para, pres.title);
        report.push("タイトル更新: " + pres.title.substring(0, 30));
      }
      titleDone = true;
      continue;
    }
  }

  // 消費されなかった発表を警告
  var used = presIdx + 1;
  if (model.presentations.length > used) {
    report.push("[警告] 原稿の発表のうち " + (model.presentations.length - used) +
                " 件が紙面に入りきりませんでした。発表枠の数を確認してください。");
  }
}

function writeReport(doc, report) {
  var folder;
  try { folder = doc.filePath; } catch (e) { folder = Folder.desktop; }
  if (!folder) folder = Folder.desktop;
  var f = new File(folder + "/流し込みレポート_" + timestamp() + ".txt");
  f.encoding = "UTF-8";
  if (f.open("w")) {
    f.write(report.join("\n"));
    f.close();
  }
}

function timestamp() {
  var d = new Date();
  function p(n) { return (n < 10 ? "0" : "") + n; }
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "_" + p(d.getHours()) + p(d.getMinutes());
}

if (typeof app !== "undefined" && app.name && /InDesign/i.test(app.name)) {
  app.doScript(main, ScriptLanguage.JAVASCRIPT, [], UndoModes.ENTIRE_SCRIPT, "Word原稿の自動流し込み");
}
