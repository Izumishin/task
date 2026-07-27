/**
 * はがき自動面付けスクリプト (InDesign ExtendScript)
 *
 *   1ページ = 1レコードの PDF を読み込み、指定したグリッド（既定 4列×2行 = 8面）に
 *   自動で貼り込みます。3000 レコードでも全自動。
 *
 *   - 面付け順は「順並び」と「断裁積み（カット&スタック）」を選択可能
 *   - トンボ（レジストレーション）を自動作画
 *   - 大量ページはドキュメント分割保存に対応
 *
 * 使い方: InDesign を起動 → ファイル → スクリプト → 本ファイルをダブルクリック
 * 対応: InDesign CS6 以降（CS4/CS5 でも動作するはずですが未検証）
 */

#targetengine "session"

(function () {
    "use strict";

    var SCRIPT_NAME = "はがき自動面付け";

    // ---------------------------------------------------------------- 既定値
    var DEFAULTS = {
        cols: 4,
        rows: 2,
        cardW: 100,
        cardH: 148,
        gapX: 0,
        gapY: 0,
        margin: 10,
        useSheet: false,
        sheetW: 545,
        sheetH: 394,
        order: 0,          // 0 = 順並び, 1 = 断裁積み
        marks: true,
        markLen: 5,
        markOffset: 1,
        crop: 0,           // 0 = トリム, 1 = 裁ち落とし, 2 = メディア
        autoFit: true,
        splitEvery: 0      // 0 = 分割しない
    };

    // ---------------------------------------------------------------- 入り口
    if (parseFloat(app.version) < 6) {
        alert("InDesign CS4 以降が必要です。", SCRIPT_NAME);
        return;
    }

    var pdfFile = File.openDialog("面付けする PDF を選択してください", pdfFilter());
    if (!pdfFile) { return; }

    var detectedPages = detectPageCount(pdfFile);
    var detectedSize  = detectTrimSize(pdfFile);

    var cfg = showConfigDialog(detectedPages, detectedSize);
    if (!cfg) { return; }

    var outFolder = null;
    if (cfg.splitEvery > 0) {
        outFolder = Folder.selectDialog("分割したドキュメントの保存先フォルダーを選択してください");
        if (!outFolder) { return; }
    }

    app.doScript(
        function () { build(pdfFile, cfg, outFolder); },
        ScriptLanguage.JAVASCRIPT,
        undefined,
        UndoModes.FAST_ENTIRE_SCRIPT,
        SCRIPT_NAME
    );

    // ================================================================ 本処理
    function build(pdf, c, folder) {
        var perSheet   = c.cols * c.rows;
        var totalSheet = Math.ceil(c.pageCount / perSheet);
        var geo        = layout(c);

        // 大量配置中にリンク／プロファイル関連のダイアログが出ないようにする
        var savedRedraw      = app.scriptPreferences.enableRedraw;
        var savedInteraction = app.scriptPreferences.userInteractionLevel;
        var savedCrop        = app.pdfPlacePreferences.pdfCrop;
        var savedPageNo      = app.pdfPlacePreferences.pageNumber;
        var savedTransparent = app.pdfPlacePreferences.transparentBackground;

        app.scriptPreferences.enableRedraw = false;
        app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
        app.pdfPlacePreferences.pdfCrop = [PDFCrop.CROP_TRIM, PDFCrop.CROP_BLEED, PDFCrop.CROP_MEDIA][c.crop];
        app.pdfPlacePreferences.transparentBackground = true;

        var progress = makeProgress(totalSheet);
        var docs     = [];
        var doc      = null;
        var docIndex = 0;
        var placed   = 0;
        var skipped  = 0;
        var errors   = [];

        try {
            for (var s = 0; s < totalSheet; s++) {
                var isNewDoc = (doc === null) ||
                               (c.splitEvery > 0 && (s % c.splitEvery) === 0);

                if (isNewDoc) {
                    if (doc !== null) { finishDoc(doc, folder, pdf, docIndex, docs); docIndex++; }
                    doc = newDocument(geo, c.splitEvery === 0);
                }

                var page = (doc.pages.length === 1 && doc.pages[0].allGraphics.length === 0 &&
                            doc.pages[0].pageItems.length === 0)
                         ? doc.pages[0]
                         : doc.pages.add(LocationOptions.AT_END);

                page.marginPreferences.properties =
                    { top: 0, left: 0, bottom: 0, right: 0, columnCount: 1, columnGutter: 0 };

                for (var slot = 0; slot < perSheet; slot++) {
                    var pdfPage = mapSlotToPage(s, slot, totalSheet, perSheet, c.order);
                    if (pdfPage < 1 || pdfPage > c.pageCount) { skipped++; continue; }

                    try {
                        placeCard(page, pdf, pdfPage, slot, geo, c);
                        placed++;
                    } catch (e) {
                        if (errors.length < 20) {
                            errors.push("シート " + (s + 1) + " / 面 " + (slot + 1) +
                                        " (PDF " + pdfPage + "ページ): " + e.message);
                        }
                    }
                }

                if (c.marks) { drawMarks(page, geo); }
                progress.step(s + 1);
            }

            if (doc !== null) { finishDoc(doc, folder, pdf, docIndex, docs); }
        } finally {
            progress.close();
            app.pdfPlacePreferences.pdfCrop = savedCrop;
            app.pdfPlacePreferences.transparentBackground = savedTransparent;
            try { app.pdfPlacePreferences.pageNumber = savedPageNo; } catch (e) {}
            app.scriptPreferences.userInteractionLevel = savedInteraction;
            app.scriptPreferences.enableRedraw = savedRedraw;
        }

        report(c, geo, totalSheet, placed, skipped, errors, docs, folder);
    }

    // ------------------------------------------------------- 面付け順マップ
    // 戻り値は 1 始まりの PDF ページ番号。
    //   順並び  : シート1 = 1〜8, シート2 = 9〜16 …
    //   断裁積み: 面1 に 1〜375, 面2 に 376〜750 …（断裁後に重ねると通し順になる）
    function mapSlotToPage(sheet, slot, totalSheet, perSheet, order) {
        if (order === 1) { return slot * totalSheet + sheet + 1; }
        return sheet * perSheet + slot + 1;
    }

    // ----------------------------------------------------------- レイアウト
    function layout(c) {
        var gridW = c.cols * c.cardW + (c.cols - 1) * c.gapX;
        var gridH = c.rows * c.cardH + (c.rows - 1) * c.gapY;

        var sheetW, sheetH, left, top;
        if (c.useSheet) {
            sheetW = c.sheetW;
            sheetH = c.sheetH;
            left = (sheetW - gridW) / 2;
            top  = (sheetH - gridH) / 2;
        } else {
            sheetW = gridW + c.margin * 2;
            sheetH = gridH + c.margin * 2;
            left = c.margin;
            top  = c.margin;
        }

        return {
            sheetW: sheetW, sheetH: sheetH,
            gridW: gridW,  gridH: gridH,
            left: left,    top: top,
            right: left + gridW, bottom: top + gridH,
            cols: c.cols,  rows: c.rows,
            cardW: c.cardW, cardH: c.cardH,
            gapX: c.gapX,  gapY: c.gapY,
            markLen: c.markLen, markOffset: c.markOffset
        };
    }

    function newDocument(geo, showWindow) {
        var doc = app.documents.add(showWindow !== false);

        doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.MILLIMETERS;
        doc.viewPreferences.verticalMeasurementUnits   = MeasurementUnits.MILLIMETERS;
        doc.viewPreferences.rulerOrigin = RulerOrigin.PAGE_ORIGIN;

        doc.documentPreferences.properties = {
            facingPages: false,
            pageWidth:  geo.sheetW + "mm",
            pageHeight: geo.sheetH + "mm",
            pagesPerDocument: 1,
            allowPageShuffle: false
        };
        doc.marginPreferences.properties =
            { top: 0, left: 0, bottom: 0, right: 0, columnCount: 1, columnGutter: 0 };

        // トンボは専用レイヤーへ（印刷前に一括で非表示にできるように）
        try { doc.layers.add({ name: "トンボ" }); } catch (e) {}
        return doc;
    }

    function placeCard(page, pdf, pdfPage, slot, geo, c) {
        var col = slot % geo.cols;
        var row = Math.floor(slot / geo.cols);

        var x1 = geo.left + col * (geo.cardW + geo.gapX);
        var y1 = geo.top  + row * (geo.cardH + geo.gapY);
        var x2 = x1 + geo.cardW;
        var y2 = y1 + geo.cardH;

        var frame = page.rectangles.add({
            geometricBounds: [y1, x1, y2, x2],
            strokeWeight: 0,
            name: "P" + pdfPage
        });
        frame.fillColor = "None";
        frame.strokeColor = "None";

        app.pdfPlacePreferences.pageNumber = pdfPage;
        var g = frame.place(pdf)[0];

        var b  = g.geometricBounds;
        var gw = b[3] - b[1];
        var gh = b[2] - b[0];

        if (c.autoFit && (Math.abs(gw - geo.cardW) > 0.2 || Math.abs(gh - geo.cardH) > 0.2)) {
            frame.fit(FitOptions.PROPORTIONALLY);
            frame.fit(FitOptions.CENTER_CONTENT);
        } else {
            frame.fit(FitOptions.CENTER_CONTENT);
        }
    }

    // --------------------------------------------------------------- トンボ
    function drawMarks(page, geo) {
        var doc   = page.parent.parent;
        var layer = doc.layers.itemByName("トンボ");
        if (!layer.isValid) { layer = doc.layers[0]; }

        var reg = registrationSwatch(doc);
        var off = geo.markOffset;
        var len = geo.markLen;

        var xs = cutPositions(geo.left, geo.cols, geo.cardW, geo.gapX);
        var ys = cutPositions(geo.top,  geo.rows, geo.cardH, geo.gapY);
        var i;

        for (i = 0; i < xs.length; i++) {
            addLine(page, layer, reg, [geo.top - off - len, xs[i], geo.top - off, xs[i]]);
            addLine(page, layer, reg, [geo.bottom + off, xs[i], geo.bottom + off + len, xs[i]]);
        }
        for (i = 0; i < ys.length; i++) {
            addLine(page, layer, reg, [ys[i], geo.left - off - len, ys[i], geo.left - off]);
            addLine(page, layer, reg, [ys[i], geo.right + off, ys[i], geo.right + off + len]);
        }
    }

    function cutPositions(start, count, size, gap) {
        var out = [];
        for (var i = 0; i < count; i++) {
            var a = start + i * (size + gap);
            pushUnique(out, a);
            pushUnique(out, a + size);
        }
        return out;
    }

    function pushUnique(arr, v) {
        for (var i = 0; i < arr.length; i++) {
            if (Math.abs(arr[i] - v) < 0.01) { return; }
        }
        arr.push(v);
    }

    function addLine(page, layer, color, bounds) {
        var ln = page.graphicLines.add(layer, { geometricBounds: bounds });
        ln.strokeColor  = color;
        ln.strokeWeight = "0.1mm";
        ln.strokeTint   = 100;
        ln.overprintStroke = true;
        return ln;
    }

    function registrationSwatch(doc) {
        var sw = doc.swatches;
        for (var i = 0; i < sw.length; i++) {
            try { if (sw[i].model === ColorModel.REGISTRATION) { return sw[i]; } } catch (e) {}
        }
        return doc.swatches.item("Black");
    }

    // --------------------------------------------------------- 保存 / 集計
    function finishDoc(doc, folder, pdf, index, docs) {
        if (!folder) { docs.push(doc.name); return; }

        var base = pdf.name.replace(/\.[Pp][Dd][Ff]$/, "");
        var name = base + "_面付_" + pad(index + 1, 3) + ".indd";
        var file = new File(folder.fsName + "/" + name);
        doc.save(file);
        docs.push(name);
        doc.close(SaveOptions.NO);
    }

    function report(c, geo, totalSheet, placed, skipped, errors, docs, folder) {
        var msg = [];
        msg.push("面付けが完了しました。");
        msg.push("");
        msg.push("　用紙サイズ　: " + round2(geo.sheetW) + " × " + round2(geo.sheetH) + " mm");
        msg.push("　面付け　　　: " + c.cols + "列 × " + c.rows + "行 = " + (c.cols * c.rows) + "面");
        msg.push("　総ページ数　: " + c.pageCount + " ページ");
        msg.push("　シート数　　: " + totalSheet + " 枚");
        msg.push("　配置済み　　: " + placed + " 面");
        if (skipped > 0) { msg.push("　空き　　　　: " + skipped + " 面"); }
        msg.push("　面付け順　　: " + (c.order === 1 ? "断裁積み（カット&スタック）" : "順並び"));
        if (folder) {
            msg.push("");
            msg.push("　保存先: " + folder.fsName);
            msg.push("　ファイル数: " + docs.length);
        }
        if (errors.length > 0) {
            msg.push("");
            msg.push("配置できなかった面があります（最大 20 件表示）:");
            msg.push(errors.join("\n"));
        }
        alert(msg.join("\n"), SCRIPT_NAME);
    }

    // --------------------------------------------------------- PDF 情報取得
    function detectPageCount(f) {
        var n = 0;
        try {
            if (f.length > 120 * 1024 * 1024) { return 0; }   // 巨大ファイルは走査しない
            f.encoding = "BINARY";
            f.open("r");
            var s = f.read();
            f.close();

            var pages = s.match(/\/Type\s*\/Page[^s]/g);
            if (pages) { n = pages.length; }

            var counts = s.match(/\/Count\s+(\d+)/g);
            if (counts) {
                for (var i = 0; i < counts.length; i++) {
                    var v = parseInt(counts[i].replace(/\/Count\s+/, ""), 10);
                    if (v > n) { n = v; }
                }
            }
        } catch (e) {
            try { f.close(); } catch (e2) {}
        }
        return n;
    }

    function detectTrimSize(f) {
        var size = { w: DEFAULTS.cardW, h: DEFAULTS.cardH };
        var tmp = null;
        var savedCrop = app.pdfPlacePreferences.pdfCrop;
        var savedNo   = app.pdfPlacePreferences.pageNumber;
        var savedUI   = app.scriptPreferences.userInteractionLevel;
        try {
            app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
            app.pdfPlacePreferences.pdfCrop = PDFCrop.CROP_TRIM;
            app.pdfPlacePreferences.pageNumber = 1;

            tmp = app.documents.add(false);
            tmp.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.MILLIMETERS;
            tmp.viewPreferences.verticalMeasurementUnits   = MeasurementUnits.MILLIMETERS;

            var g = tmp.pages[0].place(f)[0];
            var b = g.geometricBounds;
            var w = round2(b[3] - b[1]);
            var h = round2(b[2] - b[0]);
            if (w > 0 && h > 0) { size.w = w; size.h = h; }
        } catch (e) {
        } finally {
            if (tmp !== null) { try { tmp.close(SaveOptions.NO); } catch (e3) {} }
            app.pdfPlacePreferences.pdfCrop = savedCrop;
            try { app.pdfPlacePreferences.pageNumber = savedNo; } catch (e4) {}
            app.scriptPreferences.userInteractionLevel = savedUI;
        }
        return size;
    }

    // -------------------------------------------------------------- ダイアログ
    function showConfigDialog(pageCount, cardSize) {
        var d = app.dialogs.add({ name: SCRIPT_NAME, canCancel: true });
        var col = d.dialogColumns.add();

        var pSrc = col.borderPanels.add();
        var r1 = pSrc.dialogRows.add();
        r1.staticTexts.add({ staticLabel: "総ページ数（レコード数）" });
        var ePages = r1.integerEditboxes.add({
            editValue: pageCount > 0 ? pageCount : 1,
            minimumValue: 1, maximumValue: 1000000, minWidth: 80
        });
        var r1b = pSrc.dialogRows.add();
        r1b.staticTexts.add({
            staticLabel: pageCount > 0
                ? "（PDF から " + pageCount + " ページを検出しました）"
                : "（自動検出できませんでした。手入力してください）"
        });
        var r1c = pSrc.dialogRows.add();
        r1c.staticTexts.add({ staticLabel: "配置基準" });
        var dCrop = r1c.dropdowns.add({
            stringList: ["トリムボックス（推奨）", "裁ち落としボックス", "メディアボックス"],
            selectedIndex: DEFAULTS.crop
        });

        var pGrid = col.borderPanels.add();
        var r2 = pGrid.dialogRows.add();
        r2.staticTexts.add({ staticLabel: "面付け　列数" });
        var eCols = r2.integerEditboxes.add({ editValue: DEFAULTS.cols, minimumValue: 1, maximumValue: 50 });
        r2.staticTexts.add({ staticLabel: "行数" });
        var eRows = r2.integerEditboxes.add({ editValue: DEFAULTS.rows, minimumValue: 1, maximumValue: 50 });

        var r3 = pGrid.dialogRows.add();
        r3.staticTexts.add({ staticLabel: "仕上りサイズ　幅" });
        var eW = mmBox(r3, cardSize.w);
        r3.staticTexts.add({ staticLabel: "高さ" });
        var eH = mmBox(r3, cardSize.h);

        var r4 = pGrid.dialogRows.add();
        r4.staticTexts.add({ staticLabel: "面間のアキ（ドブ）　横" });
        var eGx = mmBox(r4, DEFAULTS.gapX, 0);
        r4.staticTexts.add({ staticLabel: "縦" });
        var eGy = mmBox(r4, DEFAULTS.gapY, 0);

        var pSheet = col.borderPanels.add();
        var r5 = pSheet.dialogRows.add();
        var cSheet = r5.checkboxControls.add({
            staticLabel: "用紙サイズを指定する（オフ = 面付けサイズ＋余白で自動）",
            checkedState: DEFAULTS.useSheet
        });
        var r6 = pSheet.dialogRows.add();
        r6.staticTexts.add({ staticLabel: "用紙　幅" });
        var eSw = mmBox(r6, DEFAULTS.sheetW);
        r6.staticTexts.add({ staticLabel: "高さ" });
        var eSh = mmBox(r6, DEFAULTS.sheetH);
        var r7 = pSheet.dialogRows.add();
        r7.staticTexts.add({ staticLabel: "自動時の余白" });
        var eMargin = mmBox(r7, DEFAULTS.margin, 0);

        var pOrder = col.borderPanels.add();
        var r8 = pOrder.dialogRows.add();
        r8.staticTexts.add({ staticLabel: "面付け順" });
        var dOrder = r8.dropdowns.add({
            stringList: ["順並び（1枚目 = 1〜8面）", "断裁積み（カット&スタック）"],
            selectedIndex: DEFAULTS.order
        });

        var pMark = col.borderPanels.add();
        var r9 = pMark.dialogRows.add();
        var cMarks = r9.checkboxControls.add({ staticLabel: "トンボを作成する", checkedState: DEFAULTS.marks });
        var r10 = pMark.dialogRows.add();
        r10.staticTexts.add({ staticLabel: "トンボ長さ" });
        var eMlen = mmBox(r10, DEFAULTS.markLen, 0);
        r10.staticTexts.add({ staticLabel: "オフセット" });
        var eMoff = mmBox(r10, DEFAULTS.markOffset, 0);

        var pMisc = col.borderPanels.add();
        var r11 = pMisc.dialogRows.add();
        var cFit = r11.checkboxControls.add({
            staticLabel: "サイズが違う場合は自動でフィットさせる",
            checkedState: DEFAULTS.autoFit
        });
        var r12 = pMisc.dialogRows.add();
        r12.staticTexts.add({ staticLabel: "分割保存：1ファイルあたりのシート数（0 = 分割しない）" });
        var eSplit = r12.integerEditboxes.add({
            editValue: DEFAULTS.splitEvery, minimumValue: 0, maximumValue: 100000, minWidth: 70
        });

        var ok = d.show();
        if (!ok) { d.destroy(); return null; }

        var c = {
            pageCount:  ePages.editValue,
            crop:       dCrop.selectedIndex,
            cols:       eCols.editValue,
            rows:       eRows.editValue,
            cardW:      eW.editValue,
            cardH:      eH.editValue,
            gapX:       eGx.editValue,
            gapY:       eGy.editValue,
            useSheet:   cSheet.checkedState,
            sheetW:     eSw.editValue,
            sheetH:     eSh.editValue,
            margin:     eMargin.editValue,
            order:      dOrder.selectedIndex,
            marks:      cMarks.checkedState,
            markLen:    eMlen.editValue,
            markOffset: eMoff.editValue,
            autoFit:    cFit.checkedState,
            splitEvery: eSplit.editValue
        };
        d.destroy();

        var err = validate(c);
        if (err) { alert(err, SCRIPT_NAME); return null; }
        return c;
    }

    function validate(c) {
        var gridW = c.cols * c.cardW + (c.cols - 1) * c.gapX;
        var gridH = c.rows * c.cardH + (c.rows - 1) * c.gapY;

        if (c.useSheet) {
            if (gridW > c.sheetW || gridH > c.sheetH) {
                return "面付けサイズ（" + round2(gridW) + " × " + round2(gridH) + " mm）が\n" +
                       "用紙サイズ（" + round2(c.sheetW) + " × " + round2(c.sheetH) + " mm）を超えています。";
            }
            if (c.marks) {
                var need = c.markLen + c.markOffset;
                if ((c.sheetW - gridW) / 2 < need || (c.sheetH - gridH) / 2 < need) {
                    return "トンボを描くための余白が足りません。\n" +
                           "用紙を大きくするか、トンボ長さ／オフセットを小さくしてください。\n" +
                           "（必要な余白: 各辺 " + round2(need) + " mm 以上）";
                }
            }
        } else if (c.marks && c.margin < c.markLen + c.markOffset) {
            return "余白（" + round2(c.margin) + " mm）がトンボ長さ＋オフセット（" +
                   round2(c.markLen + c.markOffset) + " mm）より小さいため、\n" +
                   "トンボが用紙からはみ出します。余白を大きくしてください。";
        }
        return null;
    }

    // ------------------------------------------------------------- 進捗表示
    function makeProgress(total) {
        var win = null, bar = null, txt = null;
        try {
            win = new Window("palette", SCRIPT_NAME, undefined);
            win.orientation = "column";
            win.alignChildren = "fill";
            txt = win.add("statictext", undefined, "面付け中… 0 / " + total + " シート");
            txt.characters = 40;
            bar = win.add("progressbar", undefined, 0, total);
            bar.preferredSize = [360, 12];
            win.show();
        } catch (e) { win = null; }

        return {
            step: function (n) {
                if (!win) { return; }
                try {
                    bar.value = n;
                    txt.text = "面付け中… " + n + " / " + total + " シート";
                    win.update();
                } catch (e) {}
            },
            close: function () { if (win) { try { win.close(); } catch (e) {} } }
        };
    }

    // ------------------------------------------------------------- ユーティリティ
    function mmBox(row, value, min) {
        return row.measurementEditboxes.add({
            editUnits: MeasurementUnits.MILLIMETERS,
            editValue: value,
            minimumValue: (min === undefined ? 1 : min),
            maximumValue: 5000,
            minWidth: 70
        });
    }

    function pdfFilter() {
        if (File.fs === "Windows") { return "PDF ファイル:*.pdf,すべてのファイル:*.*"; }
        return function (f) { return (f instanceof Folder) || /\.pdf$/i.test(f.name); };
    }

    function round2(n) { return Math.round(n * 100) / 100; }

    function pad(n, w) {
        var s = String(n);
        while (s.length < w) { s = "0" + s; }
        return s;
    }
})();
