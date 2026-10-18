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
    s = s.replace(/^[\s　]*[0-9]+[\s　_\-.、)]*/, ""); // ファイル名先頭の番号
    s = s.replace(/【[^】]*】/g, "");                 // 格付けタグ
    s = s.replace(/[○〇◯\s\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, "");
    return s;
}
function stripPrefix(s) {
    for (var i = 0; i < OMIT_PREFIXES.length; i++) {
        var p = OMIT_PREFIXES[i];
        if (s.indexOf(p) === 0) return s.substring(p.length);
    }
    return s;
}

// ---------- 本文から開始ページを集める ----------
function collectStarts(target) {
    var map = {}, loose = {}, list = [], count = 0;
    for (var d = 0; d < app.documents.length; d++) {
        var doc = app.documents[d];
        if (doc.name === target.name) continue;   // 目次・索引ファイル自身は除く
        var pages = doc.pages;
        for (var p = 0; p < pages.length; p++) {
            var graphics = pages[p].allGraphics;
            for (var g = 0; g < graphics.length; g++) {
                var link = graphics[g].itemLink;
                if (!link || !link.isValid || !/\.pdf$/i.test(link.name)) continue;
                var key = normTitle(link.name);
                if (!key) continue;
                var num = String(pages[p].name).match(/\d+/);
                if (!map[key]) {
                    var rec = { key: key, file: link.name, doc: doc.name,
                                page: num ? num[0] : pages[p].name, used: false };
                    map[key] = rec;
                    list.push(rec);
                    var lk = stripPrefix(key);
                    loose[lk] = loose[lk] ? "DUP" : rec;
                    count++;
                }
            }
        }
    }
    return { map: map, loose: loose, list: list, count: count };
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
    var plan = { items: [], ok: 0, ng: 0, fuzzy: 0, volWarn: 0 };
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
            var key = normTitle(info.title);
            var rec = starts.map[key], how = "一致";
            if (!rec) {
                var l = starts.loose[stripPrefix(key)];
                if (l && l !== "DUP") { rec = l; how = "表記ゆれで一致"; plan.fuzzy++; }
            }
            var item = { para: para, info: info, rec: rec, how: how, note: "" };
            if (rec) {
                rec.used = true;
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
function writeLog(plan, starts, written) {
    var lines = [written ? "【書き込み済み】" : "【書き込み中止：照合結果のみ】", ""];
    for (var i = 0; i < plan.items.length; i++) {
        var it = plan.items[i];
        if (it.rec) {
            var change = it.info.num === it.rec.page ? "変更なし" : (it.info.num || "空欄") + " → " + it.rec.page;
            lines.push((it.how === "一致" ? "OK" : "OK（表記ゆれ）") + "\t" + it.info.title + "\t" + change +
                       "\t" + it.rec.file + "\t" + it.note + "\t[元の文字: " + codes(it.info.tail) + "]");
        } else {
            lines.push("要確認：本文に該当する規程なし\t" + it.info.title + "\t" + (it.info.num || "空欄") +
                       "\t[元の文字: " + codes(it.info.tail) + "]");
        }
    }
    lines.push("", "■ 本文にあるが、目次・索引のどこにも出てこない規程");
    for (var j = 0; j < starts.list.length; j++) {
        var r = starts.list[j];
        if (!r.used) lines.push("要確認\t" + r.file + "\t" + r.page + "\t" + r.doc);
    }
    save("目次索引ページ入力ログ.txt", lines);

    var list = ["規程名（ファイル名から）\t開始ページ\tファイル\tInDesign"];
    for (var k = 0; k < starts.list.length; k++) {
        var x = starts.list[k];
        list.push(x.key + "\t" + x.page + "\t" + x.file + "\t" + x.doc);
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
              "　ページ数を入力: " + plan.ok + " 行（うち表記ゆれで一致 " + plan.fuzzy + " 行）\n" +
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
