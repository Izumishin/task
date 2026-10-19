/*
 * 目次索引ページ自動入力.jsx
 *
 * 本文のInDesignファイル（上巻・下巻）に配置したPDFのファイル名から
 * 各規程の開始ページを調べ、細目次・索引の「○題名……ページ 上/下」の
 * ページ数を自動で書き込みます。
 *
 * 【使い方】
 *   1. 本文のInDesignファイル（上巻・下巻など）をすべて開く
 *   2. 細目次・索引のInDesignファイルを開き、そのウィンドウを前面にする
 *   3. このスクリプトを実行 → 件数を確認して［はい］
 *
 * 【動き】
 *   ・「○」または「〇」で始まる段落だけを対象に、行末のページ数の位置を書き換える
 *     （仮の「●」、空欄、昨年の数字のどれでもOK。「上」「下」の文字や書式はそのまま）
 *   ・題名が長く2行に分かれていても1項目として扱う
 *   ・題名は、PDFのファイル名から先頭の番号と【格付けタグ】を除いたものと照合
 *   ・「学校法人明治大学」「明治大学付属明治」「明治大学」の有無の違いは許容
 *   ・照合できない行は書き換えず、ログに「要確認」として出す
 *   ・Ctrl+Z 1回で元に戻せる
 *   ・デスクトップに次の2つを保存
 *       目次索引ページ入力ログ.txt … 1行ずつの結果
 *       規程開始ページ一覧.txt     … 本文から調べた規程と開始ページ（Excelに貼れるタブ区切り）
 */

// ===== 設定 =====
// 照合時に無視する題名の頭の名称（長いものから順に）
var OMIT_PREFIXES = ["学校法人明治大学", "明治大学付属明治", "明治大学"];
// =================

var log = [];


// ---------- 題名の正規化 ----------
function toHalfWidth(s) {
    return s.replace(/[！-～]/g, function (c) {
        return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    });
}
function normTitle(s) {
    s = String(s);
    s = toHalfWidth(s.replace(/\.pdf$/i, ""));
    s = s.replace(/^[\s\u3000]*[0-9]+[\s\u3000_\-.、)]*/, ""); // ファイル名先頭の番号
    s = s.replace(/【[^】]*】/g, "");                 // 格付けタグ
    // ○、空白、改行（段落・強制・任意改行）、制御文字・特殊文字など見えない文字をすべて除く
    s = s.replace(/[○〇◯\s\u0000-\u001F\u007F\u00A0\u00AD\u2000-\u200F\u2028-\u202F\u205F-\u206F\u3000\uFEFF\uFFFC]/g, "");
    return s;
}
// 括弧書きを除く（例: "健康保険組合規約(令和2年7月改正)" → "健康保険組合規約"）
function noParen(s) {
    return s.replace(/\([^()]*\)/g, "");
}

function stripPrefix(s) {
    for (var i = 0; i < OMIT_PREFIXES.length; i++) {
        var p = OMIT_PREFIXES[i];
        if (s.indexOf(p) === 0) return s.substring(p.length);
    }
    return s;
}

// ---------- 本文から開始ページを集める ----------
// 本文に配置したPDFごとに「開始ページ」と「照合用の名前（ファイル名・柱）」を記録する
function collectStarts(target) {
    var byFile = {}, list = [];
    for (var d = 0; d < app.documents.length; d++) {
        var doc = app.documents[d];
        if (doc.name === target.name) continue;   // 目次・索引ファイル自身は除く
        var pages = doc.pages;
        for (var p = 0; p < pages.length; p++) {
            var page = pages[p];
            var graphics = page.allGraphics;
            for (var g = 0; g < graphics.length; g++) {
                var link = graphics[g].itemLink;
                if (!link || !link.isValid || !/\.pdf$/i.test(link.name)) continue;
                var rec = byFile[link.name];
                if (!rec) {
                    var num = String(page.name).match(/\d+/);
                    rec = { file: link.name, key: normTitle(link.name), doc: doc.name,
                            page: num ? num[0] : page.name, hashira: [], seen: 0, used: false };
                    rec.order = list.length;            // 本文での登場順（小さいほど前）
                    byFile[link.name] = rec;
                    list.push(rec);
                }
                // 柱は各PDFの最初の2ページ分だけ読む（左右で柱が違う場合に備える）
                if (rec.seen < 2 && rec.doc === doc.name) {
                    addHashira(rec, page);
                    rec.seen++;
                }
            }
        }
    }
    return buildIndex(list);
}

// ページ上の柱（親ページの文字＋ページ上の文字）を照合用の名前として追加
//   ・親ページは見開き全体、グループの中、元にしている親ページ（親の親）まで読む
function addHashira(rec, page) {
    var items = [];
    function addAll(coll) {
        try { var arr = coll.allPageItems; for (var i = 0; i < arr.length; i++) items.push(arr[i]); } catch (e) {}
    }
    try {
        var master = page.appliedMaster;
        for (var depth = 0; master && master.isValid && depth < 5; depth++) {
            addAll(master);
            master = master.basedOn;
        }
    } catch (e) {}
    addAll(page);
    for (var k = 0; k < items.length; k++) {
        var t;
        try {
            var el = items[k].getElements ? items[k].getElements()[0] : items[k];
            if (el.constructor.name !== "TextFrame") continue;
            t = el.contents;
        } catch (e) { continue; }
        if (typeof t !== "string" || t.length > 100) continue;
        var n = normTitle(t);
        if (n.length < 2 || /^[0-9\-]+$/.test(n)) continue;          // ノンブルなどは除く
        pushUnique(rec.hashira, n);
        pushUnique(rec.hashira, n.replace(/^付録/, ""));
        // 「第９編　人　事（○○（ポスト・ドクター）の処遇に関する規程）」のような柱は、
        // 最初の「（」から最後の「）」までを取り出す（中に括弧があってもよい）
        var m = n.match(/^[^(]*\((.*)\)$/);
        if (m) pushUnique(rec.hashira, m[1]);
    }
}
function pushUnique(arr, v) {
    if (!v) return;
    for (var i = 0; i < arr.length; i++) if (arr[i] === v) return;
    arr.push(v);
}

// 照合用の索引を作る
//   同じ名前が複数のPDFにある場合（1つの規程を本文・別表などに分けて配置しているとき）は
//   ひとまとめにして、いちばん前のPDFの開始ページを使う
function buildIndex(list) {
    var lv = { file: {}, noParen: {}, hashira: {} }, loose = { file: {}, noParen: {}, hashira: {} };
    function put(map, key, rec) {
        if (!key) return;
        if (!map.hasOwnProperty(key)) map[key] = [];
        var arr = map[key];
        for (var i = 0; i < arr.length; i++) if (arr[i] === rec) return;
        arr.push(rec);
    }
    for (var i = 0; i < list.length; i++) {
        var r = list[i];
        put(lv.file, r.key, r);
        put(lv.noParen, noParen(r.key), r);
        for (var h = 0; h < r.hashira.length; h++) put(lv.hashira, r.hashira[h], r);
        // 「学校法人明治大学」「明治大学」などを除いた名前でも引けるようにする
        put(loose.file, stripPrefix(r.key), r);
        put(loose.noParen, stripPrefix(noParen(r.key)), r);
        for (var h2 = 0; h2 < r.hashira.length; h2++) put(loose.hashira, stripPrefix(r.hashira[h2]), r);
    }
    return { list: list, count: list.length, lv: lv, loose: loose };
}
// 同じ名前のPDF群から、いちばん前のものを返す
function earliest(arr) {
    var best = null;
    for (var i = 0; i < arr.length; i++) if (!best || arr[i].order < best.order) best = arr[i];
    return best;
}
// まとめてよいのは、本文で連続して並んでいるPDFどうしだけ（離れていれば別の規程の可能性）
function contiguous(arr) {
    var min = Infinity, max = -Infinity;
    for (var i = 0; i < arr.length; i++) { min = Math.min(min, arr[i].order); max = Math.max(max, arr[i].order); }
    return max - min + 1 === arr.length;
}
function lookup(map, key) {
    if (!key || !map.hasOwnProperty(key)) return null;
    var arr = map[key];
    if (!arr.length || !contiguous(arr)) return null;
    return { rec: earliest(arr), group: arr };
}
// 同じ柱（いちばん長い＝編名と規程名を含む柱）を持つPDFを、同じ規程として使用済みにする
function markUsed(starts, group) {
    for (var g = 0; g < group.length; g++) {
        var r = group[g];
        r.used = true;
        var longest = "";
        for (var h = 0; h < r.hashira.length; h++) if (r.hashira[h].length > longest.length) longest = r.hashira[h];
        if (!longest || !starts.lv.hashira.hasOwnProperty(longest)) continue;
        var same = starts.lv.hashira[longest];
        if (contiguous(same)) for (var k = 0; k < same.length; k++) same[k].used = true;
    }
}

// 目次・索引の題名から本文のPDFを探す
//   戻り値: { rec, how }  見つからなければ rec は null
function findRec(starts, title) {
    var t = normTitle(title);
    var tries = [t, noParen(t)];
    var levels = [["file", "一致"], ["noParen", "ファイル名の括弧書きを除いて一致"], ["hashira", "柱で一致"]];
    for (var l = 0; l < levels.length; l++) {
        var map = starts.lv[levels[l][0]];
        for (var i = 0; i < tries.length; i++) {
            var f = lookup(map, tries[i]);
            if (f) return { rec: f.rec, group: f.group, how: levels[l][1] + note(f.group) };
        }
        // 「学校法人明治大学」「明治大学」などの有無だけの違い
        var lmap = starts.loose[levels[l][0]];
        for (var j = 0; j < tries.length; j++) {
            var f2 = lookup(lmap, stripPrefix(tries[j]));
            if (f2) return { rec: f2.rec, group: f2.group, how: levels[l][1] + "（明治大学等の有無）" + note(f2.group) };
        }
    }
    // 最後の手段：部分一致（題名の一方がもう一方を含む）。
    // 当てはまるPDFがすべて同じ名前（＝同じ規程の本文・別表など）のときだけ採用する
    // （当てはまった名前に、全PDF共通のものが1つでもあれば同じ規程とみなす）
    var b = noParen(t), hits = [], common = null;
    for (var k = 0; k < starts.list.length; k++) {
        var rec = starts.list[k];
        var names = [noParen(rec.key)];
        for (var h = 0; h < rec.hashira.length; h++) names.push(noParen(rec.hashira[h]));
        var matched = {}, any = false;
        for (var n = 0; n < names.length; n++) {
            var a = names[n];
            var shorter = a.length < b.length ? a : b;
            if (shorter.length >= 6 && (a.indexOf(b) >= 0 || b.indexOf(a) >= 0)) { matched[a] = true; any = true; }
        }
        if (!any) continue;
        hits.push(rec);
        if (common === null) { common = matched; continue; }
        var next = {};
        for (var c in common) if (common.hasOwnProperty(c) && matched[c]) next[c] = true;
        common = next;
    }
    var shared = false;
    for (var c2 in common) if (common && common.hasOwnProperty(c2)) { shared = true; break; }
    if (hits.length && shared && contiguous(hits)) return { rec: earliest(hits), group: hits, how: "部分一致（要確認）" + note(hits) };
    return { rec: null, group: [], how: "" };
}
function note(group) {
    return group.length > 1 ? "（PDF " + group.length + " 件をまとめて最初のページ）" : "";
}

// ---------- 段落を解析 ----------
// 例: "○学校法人明治大学寄附行為<右インデントタブ>●<半角スペース>上"
//   ・題名 … 最初の区切り（タブ・右インデントタブ・リーダー文字）より前
//   ・ページ数の位置 … 最後の区切りの直後から「上／下」の前の空白までを丸ごと置き換える
//       "●　上" → "28　上"、"● 28 上" → "28 上"、" 99 上" → "28 上"、" 上" → "28 上"
// 区切り（タブ・右インデントタブ・リーダー文字）
var SEP = /[\t\u0008\u2026\u2025]/;
// 空白（InDesignの特殊スペース＝半角・全角・四分・二分・細いスペース等を含む）
var SP = "[\\s\\u00A0\\u2000-\\u200B\\u202F\\u205F\\u3000]";
var TAIL_RE = new RegExp("^([\\s\\S]*?)(" + SP + "*([上下]?)" + SP + "*)$");

function isEntryStart(text) {
    return typeof text === "string" && /^[\s\u3000]*[○〇◯]/.test(text);
}

function parseLine(text) {
    var body = text.replace(/[\r\n]+$/, "");
    var first = -1, last = -1;
    for (var i = 0; i < body.length; i++) {
        if (SEP.test(body.charAt(i))) {
            if (first < 0) first = i;
            last = i;
        }
    }
    if (first < 0) return null;
    var head = body.substring(0, first).replace(/[・.\s\u3000]+$/, "");
    var tail = body.substring(last + 1);
    var m = tail.match(TAIL_RE);
    if (!m) return null;
    // 前回の誤入力「●<空白>28上」のように、数字と「上／下」の間の空白が数字の前にある場合は後ろへ戻す
    var keep = "";
    var mm = m[1].match(new RegExp("^[^0-9０-９]*?(" + SP + "+)[0-9０-９]+$"));
    if (mm && m[3] && !new RegExp("^" + SP).test(m[2])) keep = mm[1];
    return { title: head, numStart: last + 1, numLen: m[1].length, num: m[1], vol: m[3], tail: tail, keep: keep };
}

// 文字コード表示（ログの確認用）
function codes(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) out.push("U+" + ("0000" + s.charCodeAt(i).toString(16).toUpperCase()).slice(-4));
    return out.join(" ");
}

function volOf(docName) {
    if (/上/.test(docName) && !/下/.test(docName)) return "上";
    if (/下/.test(docName) && !/上/.test(docName)) return "下";
    return "";
}

function makePlan(target, starts) {
    var plan = { items: [], ok: 0, ng: 0, fuzzy: 0, partial: 0, volWarn: 0 };
    var stories = target.stories;
    for (var s = 0; s < stories.length; s++) {
        var paras = stories[s].paragraphs;
        for (var i = 0; i < paras.length; i++) {
            var para = paras[i];
            var text = para.contents;
            if (!isEntryStart(text)) continue;
            if (!SEP.test(text)) {
                // 題名が長く、改行で次の段落に続いている場合はつなげる
                var found = false, k = i + 1;
                for (; k < paras.length && k <= i + 2; k++) {
                    var t2 = paras[k].contents;
                    if (typeof t2 !== "string" || isEntryStart(t2) || /^[\s　\r]*$/.test(t2)) break;
                    text = text.replace(/\r$/, "") + t2;
                    if (SEP.test(t2)) { found = true; break; }
                }
                if (!found) continue;   // 区切り（タブ等）がない行は目次項目ではない（例文など）
                para = paras[k];
                i = k;
            }
            var info = parseLine(text);
            if (!info) continue;
            info.numStart -= text.length - para.contents.length;   // 最後の段落内での位置に直す
            if (info.numStart < 0) continue;
            var found2 = findRec(starts, info.title);
            var rec = found2.rec, how = found2.how;
            if (rec && how.indexOf("一致") !== 0) plan.fuzzy++;
            if (rec && how.indexOf("要確認") >= 0) plan.partial++;
            var item = { para: para, info: info, rec: rec, how: how, note: "" };
            if (rec) {
                markUsed(starts, found2.group);
                plan.ok++;
                var v = volOf(rec.doc);
                if (v && info.vol && v !== info.vol) {
                    item.note = "※上下巻の表記が違う（行は「" + info.vol + "」、本文は「" + rec.doc + "」）";
                    plan.volWarn++;
                }
            } else {
                plan.ng++;
            }
            plan.items.push(item);
        }
    }
    return plan;
}

// ---------- 書き込み ----------
function apply(plan) {
    for (var i = 0; i < plan.items.length; i++) {
        var it = plan.items[i];
        if (!it.rec) continue;
        var info = it.info, para = it.para;
        var newText = it.rec.page + info.keep;
        if (info.num === newText) continue;
        if (info.numLen > 0) {
            para.characters.itemByRange(info.numStart, info.numStart + info.numLen - 1).contents = newText;
        } else {
            para.insertionPoints[info.numStart].contents = newText;
        }
    }
}

// ---------- ログ ----------
// ---------- 題名が違うときの候補探し ----------
// 2文字ずつの組（バイグラム）がどれだけ共通しているかで似ている度合いを測る（0〜1）
function bigrams(s) {
    var b = {}, n = 0;
    for (var i = 0; i < s.length - 1; i++) { var k = s.substr(i, 2); b[k] = (b[k] || 0) + 1; n++; }
    return { map: b, n: n };
}
function similarity(a, b) {
    var A = bigrams(a), B = bigrams(b), common = 0;
    if (!A.n || !B.n) return 0;
    for (var k in A.map) if (A.map.hasOwnProperty(k) && B.map[k]) common += Math.min(A.map[k], B.map[k]);
    return 2 * common / (A.n + B.n);
}
// いちばん似ている本文の規程を返す（似ている度合い50%未満なら null）
function suggest(starts, title) {
    var t = stripPrefix(noParen(normTitle(title))), best = null, bestScore = 0.5, bestName = "";
    for (var i = 0; i < starts.list.length; i++) {
        var r = starts.list[i];
        var names = [noParen(r.key)].concat(r.hashira);
        for (var n = 0; n < names.length; n++) {
            var sc = similarity(t, stripPrefix(names[n]));
            if (sc > bestScore) { bestScore = sc; best = r; bestName = names[n]; }
        }
    }
    return best ? { rec: best, name: bestName, score: Math.round(bestScore * 100) } : null;
}

function writeLog(plan, starts, written) {
    var lines = [written ? "【書き込み済み】" : "【書き込み中止：照合結果のみ】", ""];
    var diffs = [];
    for (var i = 0; i < plan.items.length; i++) {
        var it = plan.items[i];
        if (it.rec) {
            var change = it.info.num === it.rec.page ? "変更なし" : (it.info.num || "空欄") + " → " + it.rec.page;
            lines.push((it.how.indexOf("要確認") >= 0 ? "要確認：" : "OK：") + it.how + "\t" + it.info.title + "\t" + change +
                       "\t" + it.rec.file + "\t" + it.note + "\t[元の文字: " + codes(it.info.tail) + "]");
        } else {
            var sg = suggest(starts, it.info.title);
            var cand = sg ? "候補: " + sg.name + "（" + sg.rec.page + "ページ・" + sg.rec.file + "・似ている度合い" + sg.score + "%）"
                          : "候補なし";
            lines.push("要確認：本文に該当する規程なし\t" + it.info.title + "\t" + (it.info.num || "空欄") + "\t" + cand +
                       "\t[元の文字: " + codes(it.info.tail) + "]");
            if (sg) diffs.push(it.info.title + "\t→ 本文: " + sg.name + "\t" + sg.rec.page + "ページ\t（" + sg.score + "%）");
        }
    }
    // 題名違いの候補を一覧にして先頭へ（先方への確認用）
    if (diffs.length) {
        var head = ["■ 題名が本文と違う可能性がある行（目次・索引の題名 → 本文でいちばん似ている規程）"].concat(diffs, [""]);
        lines = head.concat(lines);
    }
    lines.push("", "■ 本文にあるが、目次・索引のどこにも出てこない規程");
    for (var j = 0; j < starts.list.length; j++) {
        var r = starts.list[j];
        if (!r.used) lines.push("要確認\t" + r.file + "\t" + r.page + "\t" + r.doc + "\t柱: " + (r.hashira.join(" / ") || "（読み取れず）"));
    }
    save("目次索引ページ入力ログ.txt", lines);

    var list = ["規程名（ファイル名から）\t開始ページ\tファイル\tInDesign\t読み取った柱"];
    for (var k = 0; k < starts.list.length; k++) {
        var x = starts.list[k];
        list.push(x.key + "\t" + x.page + "\t" + x.file + "\t" + x.doc + "\t" + x.hashira.join(" / "));
    }
    save("規程開始ページ一覧.txt", list);
}

function save(name, lines) {
    try {
        var f = new File(Folder.desktop + "/" + name);
        f.encoding = "UTF-8";
        f.open("w");
        f.write("﻿" + lines.join("\r\n"));
        f.close();
    } catch (e) {}
}

function main() {
    if (app.documents.length < 2) {
        alert("本文のファイル（上巻・下巻）と、目次・索引のファイルを両方開いてから実行してください。");
        return;
    }
    var target = app.activeDocument;

    // 1. 本文ファイルから規程の開始ページを集める
    var starts = collectStarts(target);
    if (starts.count === 0) {
        alert("本文ファイルに配置されたPDFが見つかりませんでした。");
        return;
    }

    // 2. 目次・索引の段落を照合（まだ書き換えない）
    var plan = makePlan(target, starts);

    var msg = "本文から見つかった規程: " + starts.count + " 件\n\n" +
              "目次・索引の対象行: " + plan.items.length + " 行\n" +
              "　ページ数を入力: " + plan.ok + " 行\n" +
              "　　うちファイル名以外（括弧書き除外・柱など）で一致: " + plan.fuzzy + " 行\n" +
              "　　うち部分一致（要確認）: " + plan.partial + " 行\n" +
              "　照合できず（要確認）: " + plan.ng + " 行\n" +
              "　上下巻の表記が違う（要確認）: " + plan.volWarn + " 行\n\n" +
              "「" + target.name + "」に書き込みますか？";
    var go = confirm(msg);

    if (go) {
        app.doScript(function () { apply(plan); }, ScriptLanguage.JAVASCRIPT, undefined,
                     UndoModes.ENTIRE_SCRIPT, "目次・索引のページ数を入力");
    }
    writeLog(plan, starts, go);
    alert((go ? "書き込みました。" : "書き込みを中止しました。") +
          "\nデスクトップの「目次索引ページ入力ログ.txt」で「要確認」の行を確認してください。");
}

// すべての定義を読み込んだあとで実行する
main();
