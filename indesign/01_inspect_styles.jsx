/**
 * 01_inspect_styles.jsx
 * ------------------------------------------------------------
 * 「どの行に、どの段落スタイルが当たっているか」を調べるだけのスクリプト。
 * 何も書き換えません。まずこれを実行して、
 *   ・末吉　遥貴　様          の段落スタイル名
 *   ・（末吉　康志　様　保証人様） の段落スタイル名
 * を控えてから 02_swap_name_lines.jsx の CONFIG に書き写してください。
 *
 * 使い方：対象の InDesign ドキュメントを開いた状態で
 *         [ファイル] → [スクリプト] からダブルクリック実行。
 * ------------------------------------------------------------
 */

#target "indesign"

// 調べるページ数（先頭から）。多すぎると重いので既定は 2 ページ。
var INSPECT_PAGES = 2;

main();

function main() {
    if (app.documents.length === 0) {
        alert("先に対象のドキュメントを開いてください。");
        return;
    }
    var doc = app.activeDocument;
    var out = [];

    out.push("■ ドキュメント: " + doc.name);
    out.push("■ 総ページ数: " + doc.pages.length);
    out.push("");
    out.push("■ ドキュメント内の段落スタイル一覧");
    var all = doc.allParagraphStyles;
    for (var i = 0; i < all.length; i++) {
        var nm = all[i].name;
        if (nm === "[No Paragraph Style]" || nm === "[段落スタイルなし]") continue;
        out.push("   - " + fullStyleName(all[i]));
    }
    out.push("");

    var limit = Math.min(INSPECT_PAGES, doc.pages.length);
    for (var p = 0; p < limit; p++) {
        var page = doc.pages[p];
        out.push("======== " + page.name + " ページ ========");
        var items = page.allPageItems;
        var frameNo = 0;
        for (var k = 0; k < items.length; k++) {
            var it = items[k];
            if (!(it instanceof TextFrame)) continue;
            frameNo++;
            out.push("-- テキストフレーム " + frameNo +
                     " (ストーリーID: " + it.parentStory.id + ")");
            var paras = it.paragraphs;
            for (var j = 0; j < paras.length; j++) {
                var txt = String(paras[j].contents).replace(/[\r\n\u2029]+$/, "");
                out.push("   [" + j + "] スタイル=「" +
                         fullStyleName(paras[j].appliedParagraphStyle) +
                         "」 / 文字サイズ=" + sizeOf(paras[j]) +
                         " / 本文=「" + txt + "」");
            }
        }
        out.push("");
    }

    var report = out.join("\n");
    var f = new File(Folder.desktop + "/indesign_style_report.txt");
    f.encoding = "UTF-8";
    f.open("w");
    f.write(report);
    f.close();

    alert("デスクトップに indesign_style_report.txt を書き出しました。\n\n" +
          report.substr(0, 1800));
}

/** スタイルグループに入っている場合は「グループ名:スタイル名」で返す */
function fullStyleName(style) {
    var name = style.name;
    var parent = style.parent;
    while (parent && parent.constructor.name === "ParagraphStyleGroup") {
        name = parent.name + ":" + name;
        parent = parent.parent;
    }
    return name;
}

function sizeOf(para) {
    try {
        var s = para.pointSize;
        return (s instanceof Array) ? "混在" : (s + "pt");
    } catch (e) {
        return "?";
    }
}
