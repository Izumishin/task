/**
 * 03_batch_folder.jsx
 * ------------------------------------------------------------
 * .indd ファイルが複数（フォルダ単位）に分かれている場合用のバッチ処理。
 * 1 つのドキュメントに 3000 ページ入っている場合は、この 03 は不要です。
 * 02_swap_name_lines.jsx をそのまま実行してください。
 *
 * 動作：
 *   選んだフォルダ内の .indd を順に開く
 *     → 02 と同じ入れ替え処理
 *     → 同フォルダ内の "_swapped" サブフォルダに別名保存
 *     → 閉じる（元ファイルは書き換えません）
 *
 * ※ CONFIG（スタイル名・カッコの扱い・DRY_RUN）は
 *    02_swap_name_lines.jsx 側の設定がそのまま使われます。
 * ------------------------------------------------------------
 */

#target "indesign"

var BATCH_MODE = true;
#include "02_swap_name_lines.jsx"

batchMain();

function batchMain() {
    var folder = Folder.selectDialog("処理する .indd が入ったフォルダを選んでください");
    if (!folder) return;

    var files = folder.getFiles(function (f) {
        return (f instanceof File) && /\.indd$/i.test(f.name);
    });
    if (files.length === 0) {
        alert(".indd ファイルが見つかりませんでした。");
        return;
    }

    var outFolder = new Folder(folder.fsName + "/_swapped");
    if (!CONFIG.DRY_RUN && !outFolder.exists) outFolder.create();

    var log = [];
    log.push("対象フォルダ: " + folder.fsName);
    log.push("ファイル数: " + files.length);
    log.push("モード: " + (CONFIG.DRY_RUN ? "下見（保存しません）" : "本番（_swapped に別名保存）"));
    log.push("");

    var okFiles = 0, totalPairs = 0, ngFiles = 0;

    var prefs = app.scriptPreferences.userInteractionLevel;
    app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;

    for (var i = 0; i < files.length; i++) {
        var doc = null;
        try {
            doc = app.open(files[i], false);       // 画面に表示せず開く
            var res = run();

            if (!res || res.error) {
                ngFiles++;
                log.push("[NG] " + files[i].name + " : " + (res ? res.error : "不明なエラー"));
            } else {
                okFiles++;
                totalPairs += res.done ? res.done : res.pairs;
                log.push("[OK] " + files[i].name + " : " + res.pairs + " 件" +
                         (res.errors ? "  (エラー " + res.errors + ")" : ""));
                if (!CONFIG.DRY_RUN) {
                    doc.save(new File(outFolder.fsName + "/" + files[i].name));
                }
            }
        } catch (e) {
            ngFiles++;
            log.push("[NG] " + files[i].name + " : " + e);
        } finally {
            if (doc && doc.isValid) doc.close(SaveOptions.NO);
        }
    }

    app.scriptPreferences.userInteractionLevel = prefs;

    log.push("");
    log.push("成功 " + okFiles + " ファイル ／ 失敗 " + ngFiles + " ファイル ／ 合計 " +
             totalPairs + " 件の入れ替え");

    var report = log.join("\n");
    var f = new File(Folder.desktop + "/indesign_batch_log.txt");
    f.encoding = "UTF-8";
    f.open("w");
    f.write(report);
    f.close();

    alert("バッチ処理が終わりました。\n詳細ログ: デスクトップ / indesign_batch_log.txt\n\n" +
          report.substr(0, 1500));
}
