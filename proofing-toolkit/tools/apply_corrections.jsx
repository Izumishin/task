// apply_corrections.jsx — 修正指示リストCSVを読み込み、InDesignドキュメントに一括適用する
//
// 対象: 修正指示リストのうち「自動置換可」列が Y の行だけを処理します。
//
// 誤置換を防ぐ多層の安全設計:
//   [1] 完全一致検索のみ(大小文字・全半角・かなを区別)。あいまい一致はしない。
//   [2] ヒットが「ちょうど1件」のときだけ置換。0件・複数件は触らずに記録のみ。
//   [3] プレビューモードが既定。何がどこで置換されるか(前後の文脈+ページ番号)を
//       CSVに出力するだけで、ドキュメントには一切手を加えない。
//       → プレビューCSVを確認してから、実行モードで流す2段階運用。
//   [4] 「修正前」が4文字未満の行は誤ヒットの危険が高いため自動置換しない。
//   [5] ヒット箇所が書式の境界(斜体・ゴシック等の切り替わり)をまたぐ場合は、
//       置換で書式が失われる恐れがあるため自動置換しない。
//   [6] 実行モードでは「変更を記録」(Track Changes)をONにしてから置換できる。
//       ストーリーエディタ(Cmd/Ctrl+Y)で全変更箇所を後からレビューできる。
//
// 使い方:
//   1. InDesignで対象ドキュメントを開く(初回は必ず複製で試すこと)
//   2. ウィンドウ > ユーティリティ > スクリプト → Userフォルダにこのファイルを入れてダブルクリック
//   3. 修正指示リストCSV(UTF-8)を選択 → まずプレビューを実行
//   4. 「プレビュー_(ファイル名).csv」で置換予定箇所を全行確認
//   5. 問題なければ再実行して「置換を実行」を選ぶ → 「適用結果_(ファイル名).csv」が出力される

/* eslint-disable */
// @target indesign

(function () {
    var MIN_FIND_LENGTH = 4;   // これより短い検索文字列は自動置換しない
    var CONTEXT_CHARS = 20;    // プレビュー/ログに出す前後の文脈の長さ

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

    // ---- モード選択(既定はプレビュー) ----
    var mode = confirm(
        "自動置換の対象は " + targets.length + " 件です。\n\n" +
        "まずプレビュー(ドキュメントを変更せず、置換予定箇所の一覧CSVを出力)を行いますか?\n\n" +
        "[はい] プレビューのみ(推奨。初回は必ずこちら)\n" +
        "[いいえ] 置換を実行する",
        true // 「はい」を既定に
    ) ? "preview" : "execute";

    if (mode === "execute") {
        if (!confirm("置換を実行します。プレビューCSVで置換予定箇所を確認済みですか?\n" +
                     "(未確認の場合は「いいえ」を選び、先にプレビューを実行してください)")) {
            return;
        }
        if (confirm("「変更を記録」(Track Changes)をONにしてから置換しますか?\n" +
                    "ONにすると、ストーリーエディタで全変更箇所を後からレビューできます。(推奨)")) {
            try {
                doc.stories.everyItem().trackChanges = true;
            } catch (eTrack) {
                alert("変更の記録をONにできませんでした: " + eTrack.message + "\nこのまま続行します。");
            }
        }
    }

    // ---- 検索(+置換)処理 ----
    var results = [];   // [No, ページ(指示), 結果, 実際のページ, 置換箇所の文脈, メモ]
    var done = 0, skipped = 0, notFound = 0;

    app.findTextPreferences = NothingEnum.NOTHING;
    app.changeTextPreferences = NothingEnum.NOTHING;
    // 大文字小文字・全半角・かなを区別した完全一致検索にする
    app.findChangeTextOptions.caseSensitive = true;
    app.findChangeTextOptions.wholeWord = false;
    app.findChangeTextOptions.kanaSensitive = true;
    app.findChangeTextOptions.widthSensitive = true;

    for (var k = 0; k < targets.length; k++) {
        var t = targets[k];

        // 安全装置[4]: 短すぎる検索文字列は自動置換しない
        if (t.before.length < MIN_FIND_LENGTH) {
            results.push([t.no, t.page, "スキップ(短文字列)", "", "",
                "検索文字列が" + MIN_FIND_LENGTH + "文字未満で誤ヒットの危険が高いため手動対応。前後の文脈を足せば自動化できます"]);
            skipped++;
            continue;
        }

        app.findTextPreferences = NothingEnum.NOTHING;
        app.changeTextPreferences = NothingEnum.NOTHING;
        app.findTextPreferences.findWhat = t.before;

        var found;
        try {
            found = doc.findText();
        } catch (e) {
            results.push([t.no, t.page, "エラー", "", "", e.message]);
            skipped++;
            continue;
        }

        if (found.length === 0) {
            results.push([t.no, t.page, "見つからない", "", "",
                "検索文字列がヒットしません(表記ゆれ・改行位置を確認して手動対応)"]);
            notFound++;
            continue;
        }

        if (found.length > 1) {
            // 各ヒット箇所の文脈を出力して、リスト側の文脈追加の材料にする(最大3件)
            var shown = Math.min(found.length, 3);
            for (var h = 0; h < shown; h++) {
                results.push([t.no, t.page, "複数ヒット(" + found.length + "件中" + (h + 1) + ")",
                    pageOf(found[h]), contextOf(found[h]),
                    "曖昧なため未置換。「修正前」に前後の文脈を足して一意にしてください"]);
            }
            skipped++;
            continue;
        }

        // ここからヒット1件
        var hit = found[0];
        var hitPage = pageOf(hit);
        var hitContext = contextOf(hit);

        // 参考情報: 指示のページとヒットページのずれを警告として付記
        var pageNote = "";
        if (t.page !== "" && hitPage !== "" && !isNaN(Number(t.page)) && !isNaN(Number(hitPage))) {
            if (Math.abs(Number(t.page) - Number(hitPage)) > 1) {
                pageNote = "★指示のページ(" + t.page + ")とヒットページ(" + hitPage + ")が離れています。意図した箇所か要確認";
            }
        }

        if (mode === "preview") {
            results.push([t.no, t.page, "置換予定", hitPage, hitContext,
                joinNote("→「" + t.after + "」に置換されます", pageNote)]);
            done++;
            continue;
        }

        // 安全装置[5]: 書式境界をまたぐ場合は置換しない(書式が失われるため)
        var styleRanges = 1;
        try { styleRanges = hit.textStyleRanges.length; } catch (eSR) {}
        if (styleRanges > 1) {
            results.push([t.no, t.page, "スキップ(書式境界)", hitPage, hitContext,
                "ヒット箇所の途中で書式(斜体・ゴシック等)が変わっています。置換すると書式が失われるため手動対応"]);
            skipped++;
            continue;
        }
        if (pageNote !== "") {
            results.push([t.no, t.page, "スキップ(ページ不一致)", hitPage, hitContext,
                pageNote + "。プレビューで確認のうえ、問題なければ指示のページを修正して再実行"]);
            skipped++;
            continue;
        }

        try {
            app.changeTextPreferences.changeTo = t.after;
            hit.changeText();
            results.push([t.no, t.page, "置換済", hitPage, hitContext, ""]);
            done++;
        } catch (e2) {
            results.push([t.no, t.page, "エラー", hitPage, hitContext, e2.message]);
            skipped++;
        }
    }
    app.findTextPreferences = NothingEnum.NOTHING;
    app.changeTextPreferences = NothingEnum.NOTHING;

    // ---- 結果CSV出力 ----
    var prefix = (mode === "preview") ? "プレビュー_" : "適用結果_";
    var outFile = new File(csvFile.parent + "/" + prefix + csvFile.displayName);
    outFile.encoding = "UTF-8";
    outFile.lineFeed = "Windows"; // 改行をCRLFにしてExcel/メモ帳互換に
    outFile.open("w");
    outFile.write("\uFEFF"); // Excelで開けるようにBOMを付ける(エスケープ表記で安全に)
    outFile.writeln("No,ページ(指示),結果,ページ(ヒット),置換箇所の文脈,メモ");
    for (var m = 0; m < results.length; m++) {
        var cells = [];
        for (var c = 0; c < results[m].length; c++) cells.push(csvCell(results[m][c]));
        outFile.writeln(cells.join(","));
    }
    outFile.close();

    if (mode === "preview") {
        alert("プレビューを出力しました(ドキュメントは変更していません)。\n" +
              "置換予定: " + done + "件\n" +
              "見つからない: " + notFound + "件\n" +
              "スキップ(複数ヒット・短文字列等): " + skipped + "件\n\n" +
              "出力先: " + outFile.fsName + "\n\n" +
              "CSVの「置換箇所の文脈」列で置換予定箇所がすべて意図した場所か確認してから、\n" +
              "スクリプトを再実行して「置換を実行」を選んでください。");
    } else {
        alert("完了しました。\n" +
              "置換済: " + done + "件\n" +
              "見つからない: " + notFound + "件\n" +
              "スキップ/エラー: " + skipped + "件\n\n" +
              "詳細: " + outFile.fsName + "\n" +
              "未置換の項目は手動で修正してください。結果に問題があれば保存せずに閉じれば元に戻せます。");
    }

    // ---------- ユーティリティ ----------

    // ヒット箇所の前後の文脈(ストーリー内の前後CONTEXT_CHARS文字)を返す
    function contextOf(textObj) {
        try {
            var story = textObj.parentStory;
            var contents = story.contents;
            var start = textObj.index;
            var end = start + textObj.characters.length;
            var from = Math.max(0, start - CONTEXT_CHARS);
            var to = Math.min(contents.length, end + CONTEXT_CHARS);
            return contents.substring(from, start) + "【" +
                   contents.substring(start, end) + "】" +
                   contents.substring(end, to);
        } catch (e) {
            return "(文脈を取得できませんでした)";
        }
    }

    // ヒット箇所のページ番号(ノンブル)を返す
    function pageOf(textObj) {
        try {
            var frames = textObj.parentTextFrames;
            if (frames.length === 0) return "(オーバーセット)";
            var page = frames[0].parentPage;
            if (page === null) return "(ペーストボード)";
            return page.name;
        } catch (e) {
            return "";
        }
    }

    function joinNote(a, b) {
        if (a && b) return a + " / " + b;
        return a || b || "";
    }

    // CSVのセル用エスケープ(改行はスペースに、"は""に)
    function csvCell(s) {
        s = String(s === undefined || s === null ? "" : s);
        s = s.replace(/[\r\n]+/g, " ");
        return '"' + s.replace(/"/g, '""') + '"';
    }

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
