/*
 * 柱をファイル名から自動設定.jsx
 *
 * 各ページに配置されたPDFのファイル名（＝Wordのファイル名）を読み取り、
 * 先頭の番号だけ取り除いて（格付けタグ【…】は残す）、
 * 親ページ上の柱テキストフレームをオーバーライドして書き換えます。
 *
 * 【事前準備】
 *   親ページの柱テキストフレームを選択し、
 *   ［ウィンドウ］→［ユーティリティ］→［スクリプトラベル］で「柱」と入力しておく。
 *   （見開きの親ページなら左右両方のフレームに「柱」を付ける）
 *
 * 【動き】
 *   ・PDFが配置されていないページ（目次・扉など）はスキップ
 *   ・何度実行しても上書き更新されるので、差し替え後の再実行もOK
 *   ・Ctrl+Z 1回で実行前に戻せる
 *   ・処理結果をデスクトップにログ（柱設定ログ.txt）として保存
 */

// ===== 設定 =====
var LABEL = "柱";   // 親ページの柱フレームに付けるスクリプトラベル

// ファイル名の先頭から取り除く番号のパターン
//   ・数字＋区切り文字: "01_学則" "1-学則" "０１．学則" → "学則"
//   ・数字のすぐ後が【 : "13【機２総（教職員限り）】職員研修に関する規程"
//                        → "【機２総（教職員限り）】職員研修に関する規程"
//   ※「2024年度方針」のように区切りがないものは削りません
var PREFIX_PATTERN = /^[0-9０-９]+(?:[\s　_\-－.．、,，)）]+|(?=【))/;
// =================

var log = [];
var total = { done: 0, skip: 0, warn: 0 };
var currentDoc = null;

(function () {
    if (app.documents.length === 0) {
        alert("ドキュメントが開かれていません。");
        return;
    }

    var docs = [app.activeDocument];
    if (app.documents.length > 1 &&
        confirm("開いているすべてのドキュメント（" + app.documents.length +
                "件）に適用しますか？\n「いいえ」なら作業中のドキュメントだけに適用します。")) {
        docs = [];
        for (var d = 0; d < app.documents.length; d++) docs.push(app.documents[d]);
    }

    for (var i = 0; i < docs.length; i++) {
        currentDoc = docs[i];
        app.doScript(processDoc, ScriptLanguage.JAVASCRIPT, undefined,
                     UndoModes.ENTIRE_SCRIPT, "柱をファイル名から設定");
    }

    var msg = "完了しました。\n\n" +
              "柱を設定: " + total.done + " ページ\n" +
              "スキップ: " + total.skip + " ページ（PDFなし・柱フレームなし）\n" +
              "要確認: " + total.warn + " ページ";
    var logFile = writeLog(log);
    if (logFile) msg += "\n\n詳細ログ: " + logFile.fsName;
    alert(msg);
})();

function processDoc() {
    var doc = currentDoc;
    log.push("■ " + doc.name);

    var pages = doc.pages;
    for (var p = 0; p < pages.length; p++) {
        var page = pages[p];
        var pageName = page.name;

        // 1. ページ上のPDFを探す
        var pdfNames = getPdfNames(page);
        if (pdfNames.length === 0) {
            log.push("  " + pageName + "\tスキップ（PDFなし）");
            total.skip++;
            continue;
        }

        // 2. ファイル名 → 柱テキスト
        var text = toHashira(pdfNames[0]);

        // 3. 柱フレームを取得（未オーバーライドならオーバーライドする）
        var frames = getHashiraFrames(page);
        if (frames.length === 0) {
            log.push("  " + pageName + "\tスキップ（柱フレームなし）\t" + text);
            total.skip++;
            continue;
        }

        for (var f = 0; f < frames.length; f++) {
            frames[f].contents = text;
        }

        var note = "";
        if (pdfNames.length > 1) {
            note = "\t※要確認：PDFが複数あり（" + pdfNames.join(" / ") + "）";
            total.warn++;
        }
        log.push("  " + pageName + "\t" + text + note);
        total.done++;
    }
}

// ページ上に配置されたPDFのファイル名一覧（重複なし）
function getPdfNames(page) {
    var names = [];
    var graphics = page.allGraphics;
    for (var g = 0; g < graphics.length; g++) {
        var link = graphics[g].itemLink;
        if (!link || !link.isValid) continue;
        if (!/\.pdf$/i.test(link.name)) continue;
        var exists = false;
        for (var n = 0; n < names.length; n++) {
            if (names[n] === link.name) { exists = true; break; }
        }
        if (!exists) names.push(link.name);
    }
    return names;
}

// "01_学則.pdf" → "学則"
function toHashira(fileName) {
    var s = fileName.replace(/\.pdf$/i, "");
    var stripped = s.replace(PREFIX_PATTERN, "");
    return stripped !== "" ? stripped : s;
}

// ページの柱フレーム（ラベル付き）を返す。親ページのままならオーバーライドする
function getHashiraFrames(page) {
    var result = [];

    // すでにオーバーライド済みのもの（2回目以降の実行）
    var items = page.textFrames;
    for (var i = 0; i < items.length; i++) {
        if (items[i].label === LABEL) result.push(items[i]);
    }
    if (result.length > 0) return result;

    // 親ページ上のものをオーバーライド
    var masters = page.masterPageItems;
    for (var m = 0; m < masters.length; m++) {
        var item = masters[m];
        if (item.label === LABEL && item instanceof TextFrame) {
            result.push(item.override(page));
        }
    }
    return result;
}

function writeLog(lines) {
    try {
        var file = new File(Folder.desktop + "/柱設定ログ.txt");
        file.encoding = "UTF-8";
        file.open("w");
        file.write("﻿" + lines.join("\r\n"));
        file.close();
        return file;
    } catch (e) {
        return null;
    }
}
