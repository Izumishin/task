// apply_corrections.jsx — 修正指示リストCSVを読み込み、InDesignドキュメントに一括適用する
//
// 対象: 修正指示リストのうち「自動置換可」列が Y の行だけを処理します。
// 安全設計:
//   - ヒットが「ちょうど1件」のときだけ置換します。
//   - 0件(見つからない)・2件以上(どこを直すべきか曖昧)は置換せず、結果CSVに記録します。
//   - 実行前に対象件数を表示し、確認してから実行します。
//   - 必ず保存済みのドキュメントで実行し、結果を確認してから保存してください
//     (結果が意図と違えば「編集 > 取り消し」を繰り返すか、保存せずに閉じれば戻せます)。
//
// 使い方:
//   1. InDesignで対象ドキュメントを開く
//   2. ウィンドウ > ユーティリティ > スクリプト → Userフォルダにこのファイルを入れてダブルクリック
//   3. 修正指示リストCSV(UTF-8)を選択
//   4. 完了後、CSVと同じ場所に「適用結果_(元のファイル名).csv」が出力される

/* eslint-disable */
// @target indesign

(function () {
    if (app.documents.length === 0) {
        alert("ドキュメントが開かれていません。対象のInDesignドキュメントを開いてから実行してください。");
        return;
    }
    var doc = app.activeDocument;

    var csvFile = File.openDialog("修正指示リストのCSVを選択してください", "*.csv");
    if (!csvFile) return;

    // ---- CSV読み込み(UTF-8、ダブルクォート囲み・セル内改行に対応) ----
    csvFile.encoding = "UTF-8";
    csvFile.open("r");
    var raw = csvFile.read();
    csvFile.close();
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.substring(1); // BOM除去

    var records = parseCSV(raw);
    if (records.length < 2) {
        alert("CSVにデータ行がありません。");
        return;
    }

    var header = records[0];
    var col = {};
    for (var i = 0; i < header.length; i++) col[trimStr(header[i])] = i;
    var required = ["No", "ページ", "指示種別", "修正前", "修正後", "自動置換可"];
    for (var r = 0; r < required.length; r++) {
        if (col[required[r]] === undefined) {
            alert("CSVに「" + required[r] + "」列が見つかりません。テンプレートの列構成のまま使用してください。");
            return;
        }
    }

    // ---- 対象行の抽出 ----
    var targets = [];
    for (var j = 1; j < records.length; j++) {
        var rec = records[j];
        if (rec.length < 2) continue;
        var auto = trimStr(rec[col["自動置換可"]] || "").toUpperCase();
        var before = rec[col["修正前"]] || "";
        var after = rec[col["修正後"]] || "";
        if ((auto === "Y" || auto === "YES" || auto === "○") && before !== "") {
            targets.push({
                no: trimStr(rec[col["No"]]),
                page: trimStr(rec[col["ページ"]]),
                kind: trimStr(rec[col["指示種別"]]),
                before: before,
                after: after
            });
        }
    }
    if (targets.length === 0) {
        alert("「自動置換可」= Y の行がありません。処理を終了します。");
        return;
    }
    if (!confirm("自動置換の対象は " + targets.length + " 件です。実行しますか?\n" +
                 "(ヒットが1件のものだけ置換し、0件・複数件は記録のみ行います)")) {
        return;
    }

    // ---- 置換処理 ----
    var results = [];
    var done = 0, skipped = 0, notFound = 0;

    app.findTextPreferences = NothingEnum.NOTHING;
    app.changeTextPreferences = NothingEnum.NOTHING;
    // 大文字小文字・全半角を区別した完全一致検索にする
    app.findChangeTextOptions.caseSensitive = true;
    app.findChangeTextOptions.wholeWord = false;
    app.findChangeTextOptions.kanaSensitive = true;
    app.findChangeTextOptions.widthSensitive = true;

    for (var k = 0; k < targets.length; k++) {
        var t = targets[k];
        app.findTextPreferences = NothingEnum.NOTHING;
        app.changeTextPreferences = NothingEnum.NOTHING;
        app.findTextPreferences.findWhat = t.before;

        var found;
        try {
            found = doc.findText();
        } catch (e) {
            results.push([t.no, t.page, "エラー", e.message]);
            skipped++;
            continue;
        }

        if (found.length === 0) {
            results.push([t.no, t.page, "見つからない", "検索文字列がヒットしません(表記ゆれ・改行位置を確認)"]);
            notFound++;
        } else if (found.length > 1) {
            results.push([t.no, t.page, "複数ヒット(" + found.length + "件)", "曖昧なため未置換。修正前に前後の文脈を足して一意にしてください"]);
            skipped++;
        } else {
            try {
                app.changeTextPreferences.changeTo = t.after;
                found[0].changeText();
                results.push([t.no, t.page, "置換済", ""]);
                done++;
            } catch (e2) {
                results.push([t.no, t.page, "エラー", e2.message]);
                skipped++;
            }
        }
    }
    app.findTextPreferences = NothingEnum.NOTHING;
    app.changeTextPreferences = NothingEnum.NOTHING;

    // ---- 結果CSV出力 ----
    var outFile = new File(csvFile.parent + "/適用結果_" + csvFile.displayName);
    outFile.encoding = "UTF-8";
    outFile.open("w");
    outFile.write("﻿"); // Excelで開けるようにBOMを付ける
    outFile.writeln("No,ページ,結果,メモ");
    for (var m = 0; m < results.length; m++) {
        outFile.writeln('"' + results[m].join('","') + '"');
    }
    outFile.close();

    alert("完了しました。\n" +
          "置換済: " + done + "件\n" +
          "見つからない: " + notFound + "件\n" +
          "スキップ/エラー: " + skipped + "件\n\n" +
          "詳細: " + outFile.fsName + "\n" +
          "未置換の項目は手作業で修正してください。");

    // ---------- ユーティリティ ----------
    function trimStr(s) {
        return String(s).replace(/^[\s　]+|[\s　]+$/g, "");
    }

    // RFC4180風のCSVパーサ(" で囲まれたセル内のカンマ・改行・""エスケープに対応)
    function parseCSV(text) {
        var rows = [], row = [], cell = "", inQuotes = false;
        for (var i = 0; i < text.length; i++) {
            var ch = text.charAt(i);
            if (inQuotes) {
                if (ch === '"') {
                    if (text.charAt(i + 1) === '"') { cell += '"'; i++; }
                    else inQuotes = false;
                } else cell += ch;
            } else {
                if (ch === '"') inQuotes = true;
                else if (ch === ",") { row.push(cell); cell = ""; }
                else if (ch === "\n" || ch === "\r") {
                    if (ch === "\r" && text.charAt(i + 1) === "\n") i++;
                    row.push(cell); cell = "";
                    if (row.length > 1 || row[0] !== "") rows.push(row);
                    row = [];
                } else cell += ch;
            }
        }
        row.push(cell);
        if (row.length > 1 || row[0] !== "") rows.push(row);
        return rows;
    }
})();
