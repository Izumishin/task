/*
 * DoubleNombre.jsx
 * 横本の中の縦組部分に「ダブルノンブル」の横用ノンブル（減っていく数字）を配置する。
 *
 *   左ページ: 150(1)   右ページ: (2)149   ……
 *   ( ) の縦用ノンブル … マスターの「現在のページ番号」で自動表示（スクリプトは触らない）
 *   横用ノンブル       … このスクリプトが各ページにテキストフレームを置く
 *
 * 【準備】
 *   1. マスターの左右ページに、横用ノンブルの見本テキストフレームを置く
 *      （中身は「000」など仮の数字。位置・段落スタイル・文字設定はここで決める）
 *   2. 見本フレームを選択し、スクリプトラベルパネルで LABEL（初期値「横ノンブル」）と入力
 *   ※ 見本フレームはスクリプトが自動で「プリントしない」に設定するので、出力には出ない
 *
 * 【実行】
 *   最初のページの横用ノンブル（例: 150）を入力 → 2ページ目以降は 1 ずつ減って配置される。
 *   再実行すると、前回配置したノンブルを削除してから作り直す（ページ増減時はこれでOK）。
 *   見本フレームのないマスター（または「なし」）が適用されたページはスキップする。
 */

#target indesign

var LABEL = "横ノンブル";          // 見本フレームのスクリプトラベル
var OUT_LABEL = "横ノンブル_生成";  // 生成したフレームに付けるラベル（再実行時の削除用）
var DOC_KEY = "doubleNombreStart";  // 前回入力した開始番号の保存キー

(function () {
    if (app.documents.length === 0) {
        alert("ドキュメントを開いてから実行してください。");
        return;
    }
    var doc = app.activeDocument;

    var last = parseInt(doc.extractLabel(DOC_KEY), 10);
    var start = askStart(isNaN(last) ? 150 : last);
    if (start === null) return;
    doc.insertLabel(DOC_KEY, String(start));

    app.doScript(function () {
        run(doc, start);
    }, ScriptLanguage.JAVASCRIPT, undefined, UndoModes.ENTIRE_SCRIPT, "ダブルノンブル");
})();

function askStart(defaultValue) {
    var dlg = app.dialogs.add({ name: "ダブルノンブル（横用ノンブル）" });
    var field;
    with (dlg.dialogColumns.add()) {
        staticTexts.add({ staticLabel: "1ページ目の横用ノンブル:" });
        field = integerEditboxes.add({ editValue: defaultValue, minimumValue: 1, minWidth: 80 });
        staticTexts.add({ staticLabel: "※ 以降のページは 1 ずつ減ります" });
    }
    var ok = dlg.show();
    var value = field.editValue;
    dlg.destroy();
    return ok ? value : null;
}

function run(doc, start) {
    var oldOrigin = doc.viewPreferences.rulerOrigin;
    doc.viewPreferences.rulerOrigin = RulerOrigin.SPREAD_ORIGIN;
    try {
        removeGenerated(doc);

        var placed = 0, skipped = 0, warnings = [];
        for (var i = 0; i < doc.pages.length; i++) {
            var page = doc.pages[i];
            var number = start - page.documentOffset;
            if (number < 1) {
                warnings.push(page.name + "ページ: 横用ノンブルが " + number + " になるためスキップ");
                continue;
            }
            var sample = findSample(page.appliedMaster, page.side);
            if (!sample) {
                skipped++;
                continue;
            }
            placeNumber(sample, page, String(number));
            placed++;
        }

        var msg = "横用ノンブルを " + placed + " ページに配置しました。";
        if (skipped) msg += "\n見本フレームがないためスキップ: " + skipped + " ページ";
        if (warnings.length) msg += "\n\n" + warnings.join("\n");
        if (placed === 0 && skipped > 0) {
            msg += "\n\nマスターに、スクリプトラベル「" + LABEL + "」の見本フレームがあるか確認してください。";
        }
        alert(msg);
    } finally {
        doc.viewPreferences.rulerOrigin = oldOrigin;
    }
}

// 前回このスクリプトが置いたフレームを削除
function removeGenerated(doc) {
    for (var i = 0; i < doc.pages.length; i++) {
        var items = doc.pages[i].pageItems;
        for (var j = items.length - 1; j >= 0; j--) {
            if (items[j].label === OUT_LABEL) {
                items[j].locked = false;
                items[j].remove();
            }
        }
    }
}

// マスター（親マスターもたどる）から、ページの左右に合う見本フレームを探す
function findSample(master, side) {
    while (master && master.isValid) {
        var frames = master.textFrames;
        for (var i = 0; i < frames.length; i++) {
            var f = frames[i];
            if (f.label === LABEL && f.parentPage && f.parentPage.side === side) {
                return f;
            }
        }
        master = master.appliedMaster;
    }
    return null;
}

function placeNumber(sample, page, text) {
    sample.nonprinting = true;

    var layer = sample.itemLayer;
    var layerLocked = layer.locked;
    layer.locked = false;
    try {
        var frame = sample.duplicate(page);
        frame.label = OUT_LABEL;
        frame.nonprinting = false;
        frame.locked = false;
        frame.parentStory.texts[0].contents = text;

        // 見本のマスターページ上の位置と同じ位置へ合わせる
        var mp = sample.parentPage.bounds;
        var sb = sample.geometricBounds;
        var pb = page.bounds;
        var fb = frame.geometricBounds;
        var dy = (pb[0] + (sb[0] - mp[0])) - fb[0];
        var dx = (pb[1] + (sb[1] - mp[1])) - fb[1];
        frame.move(undefined, [dx, dy]);
    } finally {
        layer.locked = layerLocked;
    }
}
