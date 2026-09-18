#target indesign
/*
  紀要論文 自動組版スクリプト
  ------------------------------------------------------------------
  Word原稿を配置したストーリーに対して、見出し・本文・注・図表・参考文献の
  段落スタイルを一括適用し、根拠の弱い箇所を要確認リストで返す。

  第1段階（このファイル）：判定ロジック以外の枠
    - CFG（設定）の構造
    - マッピング表CSVの読み込みとスタイル解決（スタイルグループ対応）
    - 全段落の情報採取
    - 判定結果を受け取ってスタイルを適用する処理
    - 要確認リストの表示とテキスト保存
    - 工程名の管理とエラー処理
  判定条件（見出し・注・図表・参考文献）は classifyParagraphs() 以下に
  関数の枠と入出力だけを置き、中身は TODO。

  実装ルール（仕様書「実装ルール」の章）：
    1. DOM参照を跨いで保持しない。index で指し、毎回取り直す
    2. app.doScript() の中で使う変数は doScript より前で初期化する
    3. スタイル検索は allParagraphStyles / allCharacterStyles を走査する
    4. ページアイテムの走査は allPageItems も見る
    5. 採取はドキュメントを書き換える前に行い、数値として控える
    6. 工程名の変数（STEP）を持ち、例外時に止まった工程を表示する
    7. UndoModes.ENTIRE_SCRIPT で1回のアンドゥで全部戻せるようにする
    8. 個別の項目で失敗しても全体を止めず、失敗リストを出して最後まで走る
    9. 設定は CFG に集約する
   10. 段落の削除・追加は後ろから前に向かって処理する

  言語：ExtendScript（ES3相当）
    let / const / アロー関数 / JSON / テンプレートリテラル / trim / 配列のindexOf は使わない。
*/

// =====================================================================
// CFG（設定）
// 数値や名前はここに集約する。本体コードに直接書かない。
// =====================================================================
var CFG = {
    scriptName: "紀要論文 自動組版",
    version: "0.1.0",

    // マッピング表CSV。スクリプト（.jsx）と同じフォルダに置く。
    // 形式：キー,スタイル名（2列、UTF-8 または Shift_JIS、# で始まる行はコメント）
    csv: {
        fileName: "style_map.csv",
        commentPrefix: "#"
    },

    // CSVのキー
    keys: {
        // 段落スタイル：必ずCSVに存在しなければならないキー
        paraRequired: ["h1", "h2", "h3", "body", "quote",
                       "note_head", "note", "ref_head", "ref", "caption", "ack"],
        // 文字スタイル：必ずCSVに存在しなければならないキー
        charRequired: ["gothic", "sup"],
        // 見出しキーの形（h4, h5 ... は任意。CSVにあれば使う）
        headingPattern: /^h(\d+)$/,
        // CSVに定義が無い見出しレベルが出たときに寄せる先（仕様：小見出し）
        headingFallback: "h3"
    },

    // 段落情報の採取
    collect: {
        // 要確認リストに出す先頭文字数
        headChars: 20,
        // 「太字」とみなすフォントスタイル名（fontStyle）のパターン
        boldFontStyle: /bold|black|heavy|semibold|demibold|extrabold|ultrabold|^W[6-9]$|^W1[0-2]$/i,
        // 「斜体」とみなすフォントスタイル名のパターン
        italicFontStyle: /italic|oblique/i,
        // 行頭・行末の空白（全角スペース・半角スペース・タブ）
        leadingSpace: /^[ 　\t]+/,
        trailingSpace: /[ 　\t]+$/,
        // 句点で終わる（見出し候補の除外に使う）
        sentenceEnd: /[。．\.]$/,
        // 私用領域文字（外字）
        privateUse: /[-]/,
        // 豆腐（□）
        tofu: /□/,
        // InDesign上の特殊文字（contents 内の表記）
        specialChars: {
            forcedLineBreak: "\n",    // 強制改行
            tableAnchor: "",    // 表
            footnoteMarker: "", // 脚注参照
            anchorMarker: "￼"    // アンカー付きオブジェクト
        },
        // 「標準」のまま残ったとみなす段落スタイル名
        plainStyleNames: ["標準", "Normal", "[基本段落]", "[Basic Paragraph]"]
    },

    // 段落の種類（kind）。値は CSV のキーと同じ文字列を使う。
    // 見出しは h1, h2, h3 ... と数字を増やす（headingPattern に一致させる）。
    kinds: {
        heading: "h",          // "h" + レベル数字
        body: "body",
        quote: "quote",
        noteHead: "note_head",
        note: "note",
        refHead: "ref_head",
        ref: "ref",
        caption: "caption",
        ack: "ack"
    },

    // レポート
    report: {
        dialogTitle: "紀要論文 自動組版 - 完了レポート",
        fileSuffix: "_要確認.txt",
        encoding: "UTF-8",
        width: 760,
        height: 480,
        separator: "----------------------------------------------------------------"
    },

    // アンドゥ履歴に出る名前
    undoName: "紀要論文 自動組版"
};

// =====================================================================
// グローバル状態
// app.doScript() の中で使うものはここで初期化しておく（実装ルール2）
// =====================================================================
var STEP = "";           // 現在の工程名（例外時に表示する）

var G = {
    docName: "",         // 対象ドキュメント名
    docPath: null,       // 対象ドキュメントのフォルダ（保存ダイアログの既定に使う）
    storyId: -1,         // 対象ストーリーのID（毎回 itemByID で取り直す）
    csvPath: "",         // 読み込んだCSVのパス
    styleMap: {},        // key -> { name: スタイル名, kind: "para"|"char" }
    paraInfo: [],        // collectParagraphs() の結果（数値と文字列のみ）
    stats: {},           // computeStats() の結果
    results: [],         // classifyParagraphs() の結果（段落indexごと）
    indexMap: [],        // 採取時の段落index -> 実行後の段落index（-1 は削除済み）
    checks: [],          // 要確認 { para, head, reason }
    failures: [],        // 失敗 { para, action, message }
    counts: {            // 処理件数
        paragraphs: 0,
        headings: {},    // "h1" -> 件数
        notes: 0,
        captions: 0,
        refs: 0,
        gothic: 0,
        superscript: 0,
        unclassified: 0,
        appliedTotal: 0
    },
    startedAt: null
};

// =====================================================================
// 小道具（ES3で足りないもの）
// =====================================================================
function setStep(name) {
    STEP = name;
    log("[工程] " + name);
}

function log(msg) {
    $.writeln(msg);
}

// 意図的な停止（工程エラーと区別する）
function stopWith(message) {
    var e = new Error(message);
    e.isStop = true;
    return e;
}

function trim(s) {
    return String(s).replace(/^\s+/, "").replace(/\s+$/, "");
}

function inArray(arr, v) {
    for (var i = 0; i < arr.length; i++) {
        if (arr[i] === v) { return true; }
    }
    return false;
}

function objectKeys(obj) {
    var out = [];
    for (var k in obj) {
        if (obj.hasOwnProperty(k)) { out.push(k); }
    }
    return out;
}

// everyItem() の戻り値は要素が1つのとき配列にならないので揃える
function toArray(v) {
    if (v instanceof Array) { return v; }
    if (v === undefined || v === null) { return []; }
    return [v];
}

function padLeft(n, width) {
    var s = String(n);
    while (s.length < width) { s = " " + s; }
    return s;
}

function headOf(text) {
    var t = String(text).replace(/[\r\n]/g, " ");
    return t.length > CFG.collect.headChars ? t.substr(0, CFG.collect.headChars) + "…" : t;
}

function formatDate(d) {
    function two(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate()) +
           " " + two(d.getHours()) + ":" + two(d.getMinutes());
}

// =====================================================================
// ファイル読み込み（UTF-8 / Shift_JIS 自動判定）
// =====================================================================

// バイナリ文字列（1文字=1バイト）が UTF-8 として正しいか
function isValidUtf8(bin) {
    var i = 0, n = bin.length, c, need, j, cc;
    while (i < n) {
        c = bin.charCodeAt(i);
        if (c < 0x80) { i++; continue; }
        if (c >= 0xC2 && c <= 0xDF) { need = 1; }
        else if (c >= 0xE0 && c <= 0xEF) { need = 2; }
        else if (c >= 0xF0 && c <= 0xF4) { need = 3; }
        else { return false; }
        if (i + need >= n) { return false; }
        for (j = 1; j <= need; j++) {
            cc = bin.charCodeAt(i + j);
            if (cc < 0x80 || cc > 0xBF) { return false; }
        }
        i += need + 1;
    }
    return true;
}

function readTextFile(file) {
    if (!file.exists) {
        throw stopWith("ファイルが見つかりません：\n" + file.fsName);
    }
    // まずバイナリで読んで文字コードを判定する
    file.encoding = "BINARY";
    if (!file.open("r")) {
        throw stopWith("ファイルを開けません：\n" + file.fsName);
    }
    var bin = file.read();
    file.close();

    var enc;
    if (bin.length >= 3 &&
        bin.charCodeAt(0) === 0xEF && bin.charCodeAt(1) === 0xBB && bin.charCodeAt(2) === 0xBF) {
        enc = "UTF-8";
    } else if (isValidUtf8(bin)) {
        enc = "UTF-8";
    } else {
        enc = "Shift_JIS";
    }

    file.encoding = enc;
    if (!file.open("r")) {
        throw stopWith("ファイルを開けません（" + enc + "）：\n" + file.fsName);
    }
    var text = file.read();
    file.close();
    // BOM を落とす
    if (text.length > 0 && text.charCodeAt(0) === 0xFEFF) {
        text = text.substr(1);
    }
    return text;
}

// =====================================================================
// CSV パース（ES3対応。ダブルクォート・CRLF・空行・コメント行に対応）
// 戻り値：[[col, col, ...], ...]
// =====================================================================
function parseCSV(text) {
    var rows = [], row = [], field = "", inQuote = false;
    var i, c, next, n = text.length;

    function pushField() { row.push(field); field = ""; }
    function pushRow() {
        // 空行は捨てる
        var allEmpty = true;
        for (var k = 0; k < row.length; k++) {
            if (trim(row[k]) !== "") { allEmpty = false; break; }
        }
        if (!allEmpty) { rows.push(row); }
        row = [];
    }

    for (i = 0; i < n; i++) {
        c = text.charAt(i);
        if (inQuote) {
            if (c === '"') {
                next = (i + 1 < n) ? text.charAt(i + 1) : "";
                if (next === '"') { field += '"'; i++; }
                else { inQuote = false; }
            } else {
                field += c;
            }
        } else {
            if (c === '"') { inQuote = true; }
            else if (c === ",") { pushField(); }
            else if (c === "\r") {
                next = (i + 1 < n) ? text.charAt(i + 1) : "";
                if (next === "\n") { i++; }
                pushField(); pushRow();
            }
            else if (c === "\n") { pushField(); pushRow(); }
            else { field += c; }
        }
    }
    if (field !== "" || row.length > 0) { pushField(); pushRow(); }

    // コメント行を除く
    var out = [];
    for (i = 0; i < rows.length; i++) {
        var first = trim(rows[i][0]);
        if (first.length > 0 && first.charAt(0) === CFG.csv.commentPrefix) { continue; }
        out.push(rows[i]);
    }
    return out;
}

// =====================================================================
// スタイル検索（スタイルグループ対応）
// =====================================================================

// ドキュメント内の全スタイルを名前で引ける形にする
// 戻り値：{ para: {name: ParagraphStyle}, char: {name: CharacterStyle},
//           dupPara: [name], dupChar: [name] }
function scanStyles(doc) {
    var out = { para: {}, char: {}, dupPara: [], dupChar: [] };
    var i, s, nm;
    var ps = doc.allParagraphStyles;
    for (i = 0; i < ps.length; i++) {
        s = ps[i]; nm = s.name;
        if (out.para.hasOwnProperty(nm)) {
            if (!inArray(out.dupPara, nm)) { out.dupPara.push(nm); }
        } else {
            out.para[nm] = s;
        }
    }
    var cs = doc.allCharacterStyles;
    for (i = 0; i < cs.length; i++) {
        s = cs[i]; nm = s.name;
        if (out.char.hasOwnProperty(nm)) {
            if (!inArray(out.dupChar, nm)) { out.dupChar.push(nm); }
        } else {
            out.char[nm] = s;
        }
    }
    return out;
}

// 名前でスタイルを取得する（itemByName はグループ内を探さないので使わない）
// kind: "para" | "char"。見つからなければ null
function getStyle(doc, name, kind) {
    var list = (kind === "char") ? doc.allCharacterStyles : doc.allParagraphStyles;
    for (var i = 0; i < list.length; i++) {
        if (list[i].name === name) { return list[i]; }
    }
    return null;
}

// =====================================================================
// マッピング表の読み込みとスタイル解決
// =====================================================================

// CSV -> { key: { name, kind } }
function loadStyleMap(csvFile) {
    var text = readTextFile(csvFile);
    var rows = parseCSV(text);
    var map = {};
    var problems = [];
    var i, key, name, kind;

    for (i = 0; i < rows.length; i++) {
        key = trim(rows[i][0]);
        name = rows[i].length > 1 ? trim(rows[i][1]) : "";
        if (key === "") { continue; }
        // ヘッダー行（キー,スタイル名）は読み飛ばす
        if (i === 0 && (key === "キー" || key.toLowerCase() === "key")) { continue; }
        if (name === "") {
            problems.push((i + 1) + "行目：キー「" + key + "」のスタイル名が空です");
            continue;
        }
        if (map.hasOwnProperty(key)) {
            problems.push((i + 1) + "行目：キー「" + key + "」が重複しています");
            continue;
        }
        kind = inArray(CFG.keys.charRequired, key) ? "char" : "para";
        map[key] = { name: name, kind: kind };
    }

    // 必須キーの不足
    var missing = [];
    for (i = 0; i < CFG.keys.paraRequired.length; i++) {
        if (!map.hasOwnProperty(CFG.keys.paraRequired[i])) { missing.push(CFG.keys.paraRequired[i]); }
    }
    for (i = 0; i < CFG.keys.charRequired.length; i++) {
        if (!map.hasOwnProperty(CFG.keys.charRequired[i])) { missing.push(CFG.keys.charRequired[i]); }
    }
    if (missing.length > 0) {
        problems.push("必須キーがありません：" + missing.join(", "));
    }
    if (problems.length > 0) {
        throw stopWith("マッピング表CSVに問題があります：\n" + csvFile.fsName + "\n\n" + problems.join("\n"));
    }
    return map;
}

// CSVにある名前がドキュメントに存在するか確認する
// 戻り値：不足の一覧 [ "段落スタイル「本文」（キー: body）", ... ]
function checkStyles(doc, styleMap) {
    var scanned = scanStyles(doc);
    var missing = [];
    var keys = objectKeys(styleMap);
    for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var ent = styleMap[k];
        var pool = (ent.kind === "char") ? scanned.char : scanned.para;
        if (!pool.hasOwnProperty(ent.name)) {
            missing.push((ent.kind === "char" ? "文字スタイル「" : "段落スタイル「") +
                         ent.name + "」（キー: " + k + "）");
        }
    }
    // 同名スタイルがグループ違いで複数ある場合は先頭のものを使う。要確認に出す
    var j;
    for (j = 0; j < scanned.dupPara.length; j++) {
        addCheck(-1, "", "同名の段落スタイル「" + scanned.dupPara[j] + "」が複数あります。最初に見つかったものを使いました");
    }
    for (j = 0; j < scanned.dupChar.length; j++) {
        addCheck(-1, "", "同名の文字スタイル「" + scanned.dupChar[j] + "」が複数あります。最初に見つかったものを使いました");
    }
    return missing;
}

// kind（h1, body, ...）から段落スタイルの「名前」を決める
// CSVに無い見出しレベルは小見出し（CFG.keys.headingFallback）に寄せて要確認
// 戻り値：{ name, fallback: true/false }。該当なしは null
function resolveParaStyleName(kind) {
    if (kind === null || kind === undefined || kind === "") { return null; }
    if (G.styleMap.hasOwnProperty(kind) && G.styleMap[kind].kind === "para") {
        return { name: G.styleMap[kind].name, fallback: false };
    }
    if (CFG.keys.headingPattern.test(kind) && G.styleMap.hasOwnProperty(CFG.keys.headingFallback)) {
        return { name: G.styleMap[CFG.keys.headingFallback].name, fallback: true };
    }
    return null;
}

// =====================================================================
// 前提チェック
// =====================================================================
function getTargetStory(doc) {
    var sel = app.selection;
    if (sel.length !== 1) {
        throw stopWith("本文のテキストフレームを1つ選択するか、本文の中にカーソルを置いてから実行してください。");
    }
    var obj = sel[0];
    var story = null;
    try {
        story = obj.parentStory;
    } catch (e) {
        story = null;
    }
    if (story === null || story === undefined || !story.isValid ||
        String(story.constructor.name) !== "Story") {
        throw stopWith("選択されているのはテキストではありません。\n本文のテキストフレームか、本文の中にカーソルを置いてから実行してください。");
    }
    return story;
}

// =====================================================================
// 段落情報の採取（ドキュメントを書き換える前に、数値と文字列だけ控える）
// =====================================================================

// 戻り値：[ info, ... ]  info は以下のキーを持つ
//   index          採取時の段落index（0始まり）
//   text           段落の文字列（末尾の改行を除く）
//   head           先頭 CFG.collect.headChars 文字
//   length         前後の空白を除いた文字数
//   isEmpty        空段落（空白のみを含む）
//   styleName      採取時の段落スタイル名
//   sizeMax / sizeMin / sizeMode   文字サイズ（pt）の最大・最小・最頻値
//   charCount      空白・改行を除いた文字数（太字率の分母）
//   boldCount      太字の文字数
//   boldAll        段落全体が太字
//   boldPart       段落の一部だけが太字
//   italicCount    斜体の文字数
//   underlineCount 下線の文字数
//   strikeCount    取り消し線の文字数
//   supCount       上付きの文字数
//   hasSup         上付き文字を含む
//   leadingSpaces  行頭の空白文字数
//   trailingSpaces 行末の空白文字数
//   endsWithPeriod 句点で終わる
//   spaceBefore / spaceAfter   段落前後のアキ
//   hasForcedBreak 強制改行を含む
//   hasTable       表を含む
//   hasFootnote    脚注参照を含む
//   hasAnchor      アンカー付きオブジェクトを含む
//   hasPrivateUse  私用領域文字を含む
//   hasTofu        □ を含む
function collectParagraphs(story) {
    var infos = [];
    var col = CFG.collect;
    // 採取中はドキュメントを書き換えないので、ここでは参照の一括取得を使ってよい
    var paras = story.paragraphs.everyItem().getElements();
    var contentsArr = toArray(story.paragraphs.everyItem().contents);
    var styleArr = toArray(story.paragraphs.everyItem().appliedParagraphStyle);
    var sbArr = toArray(story.paragraphs.everyItem().spaceBefore);
    var saArr = toArray(story.paragraphs.everyItem().spaceAfter);
    var i, n = paras.length;

    for (i = 0; i < n; i++) {
        var info = {
            index: i, text: "", head: "", length: 0, isEmpty: true, styleName: "",
            sizeMax: 0, sizeMin: 0, sizeMode: 0,
            charCount: 0, boldCount: 0, boldAll: false, boldPart: false,
            italicCount: 0, underlineCount: 0, strikeCount: 0,
            supCount: 0, hasSup: false,
            leadingSpaces: 0, trailingSpaces: 0, endsWithPeriod: false,
            spaceBefore: 0, spaceAfter: 0,
            hasForcedBreak: false, hasTable: false, hasFootnote: false, hasAnchor: false,
            hasPrivateUse: false, hasTofu: false
        };
        try {
            var raw = contentsArr[i];
            // 特殊文字だけの段落は contents が文字列でなく列挙値になることがある
            var text = (typeof raw === "string") ? raw : "";
            text = text.replace(/\r$/, "");
            var trimmed = trim(text);

            info.text = text;
            info.head = headOf(trimmed);
            info.length = trimmed.length;
            info.isEmpty = (trimmed.length === 0);
            try { info.styleName = styleArr[i].name; } catch (e1) { info.styleName = ""; }
            info.spaceBefore = Number(sbArr[i]);
            info.spaceAfter = Number(saArr[i]);

            var lead = text.match(col.leadingSpace);
            info.leadingSpaces = lead ? lead[0].length : 0;
            var trail = text.match(col.trailingSpace);
            info.trailingSpaces = trail ? trail[0].length : 0;
            info.endsWithPeriod = col.sentenceEnd.test(trimmed);
            info.hasForcedBreak = text.indexOf(col.specialChars.forcedLineBreak) >= 0;
            info.hasTable = text.indexOf(col.specialChars.tableAnchor) >= 0;
            info.hasFootnote = text.indexOf(col.specialChars.footnoteMarker) >= 0;
            info.hasAnchor = text.indexOf(col.specialChars.anchorMarker) >= 0;
            info.hasPrivateUse = col.privateUse.test(text);
            info.hasTofu = col.tofu.test(text);

            // 文字属性（段落内の文字を一括取得）
            var chars = paras[i].characters.everyItem();
            var sizes = toArray(chars.pointSize);
            var fstyles = toArray(chars.fontStyle);
            var positions = toArray(chars.position);
            var underlines = toArray(chars.underline);
            var strikes = toArray(chars.strikeThru);
            collectCharStats(info, text, sizes, fstyles, positions, underlines, strikes);
        } catch (e) {
            addFailure(i, "情報採取", e.message);
        }
        infos.push(info);
    }
    return infos;
}

// 文字単位の配列から段落の統計を作る（DOMに触らない）
function collectCharStats(info, text, sizes, fstyles, positions, underlines, strikes) {
    var col = CFG.collect;
    var n = sizes.length;
    var sizeCount = {};
    var i, ch, sz, isSpace;
    var max = null, min = null;

    for (i = 0; i < n; i++) {
        ch = (i < text.length) ? text.charAt(i) : "";
        isSpace = (ch === " " || ch === "　" || ch === "\t" || ch === "\r" || ch === "\n" || ch === "");
        sz = Number(sizes[i]);
        if (!isNaN(sz)) {
            if (max === null || sz > max) { max = sz; }
            if (min === null || sz < min) { min = sz; }
            if (!isSpace) {
                sizeCount[sz] = (sizeCount[sz] || 0) + 1;
            }
        }
        if (isSpace) { continue; }
        info.charCount++;
        var fs = String(fstyles[i] || "");
        if (col.boldFontStyle.test(fs)) { info.boldCount++; }
        if (col.italicFontStyle.test(fs)) { info.italicCount++; }
        if (positions[i] == Position.SUPERSCRIPT) { info.supCount++; }
        if (underlines[i] === true) { info.underlineCount++; }
        if (strikes[i] === true) { info.strikeCount++; }
    }
    info.sizeMax = (max === null) ? 0 : max;
    info.sizeMin = (min === null) ? 0 : min;

    // 最頻値（同数なら大きい方）
    var mode = 0, modeCount = -1;
    for (var k in sizeCount) {
        if (!sizeCount.hasOwnProperty(k)) { continue; }
        var c = sizeCount[k], v = Number(k);
        if (c > modeCount || (c === modeCount && v > mode)) { mode = v; modeCount = c; }
    }
    info.sizeMode = (modeCount < 0) ? info.sizeMax : mode;

    info.hasSup = info.supCount > 0;
    info.boldAll = (info.charCount > 0 && info.boldCount === info.charCount);
    info.boldPart = (info.boldCount > 0 && !info.boldAll);
}

// 論文全体の統計（判定の相対比較に使う材料）
// 戻り値：{ count, nonEmptyCount, avgLength, medianLength, sizeMode, sizeMax, sizeMin }
function computeStats(infos) {
    var stats = { count: infos.length, nonEmptyCount: 0, avgLength: 0, medianLength: 0,
                  sizeMode: 0, sizeMax: 0, sizeMin: 0 };
    var lengths = [], sizeCount = {}, sum = 0, i;
    for (i = 0; i < infos.length; i++) {
        var f = infos[i];
        if (f.isEmpty) { continue; }
        stats.nonEmptyCount++;
        lengths.push(f.length);
        sum += f.length;
        if (f.sizeMode > 0) { sizeCount[f.sizeMode] = (sizeCount[f.sizeMode] || 0) + f.charCount; }
        if (stats.sizeMax === 0 || f.sizeMax > stats.sizeMax) { stats.sizeMax = f.sizeMax; }
        if (f.sizeMin > 0 && (stats.sizeMin === 0 || f.sizeMin < stats.sizeMin)) { stats.sizeMin = f.sizeMin; }
    }
    if (lengths.length > 0) {
        stats.avgLength = sum / lengths.length;
        lengths.sort(function (a, b) { return a - b; });
        stats.medianLength = lengths[Math.floor(lengths.length / 2)];
    }
    var mode = 0, modeCount = -1;
    for (var k in sizeCount) {
        if (!sizeCount.hasOwnProperty(k)) { continue; }
        if (sizeCount[k] > modeCount) { mode = Number(k); modeCount = sizeCount[k]; }
    }
    stats.sizeMode = mode;
    return stats;
}

// =====================================================================
// 意味づけ（判定）—— 第2段階で実装する。ここは枠と入出力だけ
// =====================================================================

// 判定結果を1件作る
//   kind    : "h1" / "h2" / ... / "body" / "quote" / "note_head" / "note" /
//             "ref_head" / "ref" / "caption" / "ack" / null（未判定）
//   reason  : 判定理由（要確認リストに出す）
//   check   : 要確認に出すか
//   skip    : スタイルを当てない（空段落など）
function makeResult(kind, reason, check, skip) {
    return { kind: kind, reason: reason || "", check: !!check, skip: !!skip };
}

// 入力：infos（collectParagraphs の結果）, stats（computeStats の結果）
// 出力：results[i] = makeResult(...)  ※ infos と同じ長さ・同じ並び
function classifyParagraphs(infos, stats) {
    var results = [];
    var i;
    for (i = 0; i < infos.length; i++) {
        // 空段落はスタイルを当てない（削除はクリーンアップ工程で行う）
        results.push(makeResult(null, "", false, infos[i].isEmpty));
    }

    // TODO（第2段階）：以下を順に呼び、results を埋める。
    //   見出し   : detectHeadingCandidates -> assignHeadingLevels
    //   注       : detectNoteSection
    //   参考文献 : detectRefSection
    //   図表     : detectCaptions
    //   謝辞     : detectAck
    //   残り     : body
    // 判定は同一論文内の相対比較で行い、絶対値はハードコードしない。
    // 推定で処理したもの・判定できなかったものは check = true にする。
    var candidates = detectHeadingCandidates(infos, stats);
    assignHeadingLevels(candidates, infos, stats, results);
    detectNoteSection(infos, stats, results);
    detectRefSection(infos, stats, results);
    detectCaptions(infos, stats, results);
    detectAck(infos, stats, results);

    return results;
}

// 見出し候補を拾う
// 入力：infos, stats
// 出力：候補の段落index配列 [i, ...]
// 条件（仕様）：本文の平均文字数を大きく下回る／句点で終わらない／独立した段落
function detectHeadingCandidates(infos, stats) {
    // TODO（第2段階）
    return [];
}

// 候補を 太字 -> 文字サイズ -> 番号パターン の順で層に分け、上から h1, h2, h3 ... を割り当てる
// 入力：candidates（index配列）, infos, stats
// 出力：results[i] を書き換える（kind = "h1"...、層と番号体系が食い違えば check = true、
//        どの層にも収まらなければ kind = "body" + check = true）
function assignHeadingLevels(candidates, infos, stats, results) {
    // TODO（第2段階）
}

// 注リストの検出：「注」だけの行 -> note_head、その次から終端まで note
// 終端：文書末、または参考文献見出しの直前。番号の無い行は前の項目の折り返し
// 入力：infos, stats
// 出力：results[i] を書き換える
function detectNoteSection(infos, stats, results) {
    // TODO（第2段階）
}

// 参考文献の検出：「参考文献」「引用文献」「文献」「References」だけの行 -> ref_head、以降 ref
// 終端：文書末。別の見出しが現れたらそこで終端にして check = true
// 入力：infos, stats
// 出力：results[i] を書き換える
function detectRefSection(infos, stats, results) {
    // TODO（第2段階）
}

// 図表キャプション：「図1」「表1」「図表1」「Fig.1」「Table 1」で始まる段落 -> caption
// 入力：infos, stats
// 出力：results[i] を書き換える
function detectCaptions(infos, stats, results) {
    // TODO（第2段階）
}

// 謝辞・付記：「謝辞」「付記」だけの行 -> ack、次の見出しまで body
// 参考文献の後ろに現れた場合は check = true
// 入力：infos, stats
// 出力：results[i] を書き換える
function detectAck(infos, stats, results) {
    // TODO（第2段階）
}

// =====================================================================
// 要確認フラグ（判定結果と、判定に依らない機械的なチェック）
// =====================================================================
function addCheck(paraIndex, head, reason) {
    G.checks.push({ para: paraIndex, head: head, reason: reason });
}

function addFailure(paraIndex, action, message) {
    G.failures.push({ para: paraIndex, action: action, message: message });
}

function flagChecks(infos, results) {
    var i, f, r;
    for (i = 0; i < infos.length; i++) {
        f = infos[i];
        r = results[i];
        // 判定側が立てたフラグ
        if (r.check) {
            addCheck(i, f.head, r.reason || "推定で判定");
        }
        if (f.isEmpty) { continue; }
        // 判定に依らないもの（仕様の要確認項目のうち機械的に拾えるもの）
        if (f.hasPrivateUse) { addCheck(i, f.head, "私用領域文字（外字）を含む"); }
        if (f.hasTofu) { addCheck(i, f.head, "□（豆腐）を含む"); }
        if (f.hasForcedBreak) { addCheck(i, f.head, "強制改行を含む（扱いは未確定のため残した）"); }
        if (f.italicCount > 0) { addCheck(i, f.head, "斜体を含む（扱いは未確定のため残した）"); }
        if (f.underlineCount > 0) { addCheck(i, f.head, "下線を含む（扱いは未確定のため残した）"); }
        if (f.strikeCount > 0) { addCheck(i, f.head, "取り消し線を含む（扱いは未確定のため残した）"); }
        if (f.boldAll && (r.kind === null || !CFG.keys.headingPattern.test(r.kind))) {
            addCheck(i, f.head, "段落全体が太字だが見出しにならなかった");
        }
    }
}

// =====================================================================
// ドキュメントの書き換え（app.doScript の中で実行する）
// ここから先で使う変数は G / CFG に控えてある（実装ルール2）
// =====================================================================
function getStoryNow() {
    var doc = app.activeDocument;
    var story = doc.stories.itemByID(G.storyId);
    if (!story.isValid) {
        throw new Error("対象ストーリー（ID " + G.storyId + "）が取得できません");
    }
    return story;
}

// 採取時の段落index -> 実行後のドキュメント上の段落番号（1始まり）。削除済みは null
function docParaNo(origIndex) {
    if (origIndex < 0) { return null; }
    var m = G.indexMap[origIndex];
    if (m === undefined || m === null || m < 0) { return null; }
    return m + 1;
}

function applyAll() {
    setStep("段落スタイルの適用");
    applyParagraphStyles();

    setStep("行頭スペースの削除");
    stripLeadingSpaces();

    setStep("注番号の上付き化");
    applyNoteSuperscript();

    setStep("太字のゴシック化");
    applyGothic();

    setStep("直接書式のリセット");
    clearOverrides();

    setStep("Word由来のクリーンアップ");
    cleanupWordArtifacts();

    setStep("適用後チェック");
    postCheck();
}

// 判定結果（G.results）に従って段落スタイルを当てる
// 段落は index で指し、毎回取り直す（実装ルール1）。ここでは段落数は変わらない
function applyParagraphStyles() {
    var doc = app.activeDocument;
    var story = getStoryNow();
    var styleCache = {};   // name -> ParagraphStyle（この工程内でのみ使う）
    var n = G.results.length;
    var i, r, f, resolved, style, para;

    if (story.paragraphs.length !== n) {
        throw new Error("段落数が採取時（" + n + "）と違います（" + story.paragraphs.length + "）。書き換え前にドキュメントが変更された可能性があります");
    }

    for (i = 0; i < n; i++) {
        r = G.results[i];
        f = G.paraInfo[i];
        if (r.skip) { continue; }
        if (r.kind === null || r.kind === undefined) {
            G.counts.unclassified++;
            continue;
        }
        resolved = resolveParaStyleName(r.kind);
        if (resolved === null) {
            addFailure(i, "スタイル適用", "kind「" + r.kind + "」に対応する段落スタイルがマッピング表にありません");
            continue;
        }
        if (resolved.fallback) {
            addCheck(i, f.head, "見出しレベル「" + r.kind + "」はCSVに無いため「" + CFG.keys.headingFallback + "」に寄せた");
        }
        try {
            if (!styleCache.hasOwnProperty(resolved.name)) {
                style = getStyle(doc, resolved.name, "para");
                if (style === null) { throw new Error("段落スタイル「" + resolved.name + "」が見つかりません"); }
                styleCache[resolved.name] = style;
            }
            para = story.paragraphs.item(i);
            // オーバーライドはここでは消さない（太字・上付きを後の工程で使う）
            para.applyParagraphStyle(styleCache[resolved.name], false);
            countApplied(r.kind);
        } catch (e) {
            addFailure(i, "スタイル適用（" + resolved.name + "）", e.message);
        }
    }
}

function countApplied(kind) {
    G.counts.appliedTotal++;
    if (CFG.keys.headingPattern.test(kind)) {
        G.counts.headings[kind] = (G.counts.headings[kind] || 0) + 1;
    } else if (kind === CFG.kinds.note) {
        G.counts.notes++;
    } else if (kind === CFG.kinds.caption) {
        G.counts.captions++;
    } else if (kind === CFG.kinds.ref) {
        G.counts.refs++;
    }
}

// 行頭の全角・半角スペース（連続を含む）を削除する。全段落が対象
// 段落スタイルを当てた後に行う（順序を逆にすると段落番号がずれる）
function stripLeadingSpaces() {
    // TODO（第1段階では枠のみ）
    //   後ろから前へ、story.paragraphs.item(i) を毎回取り直して
    //   CFG.collect.leadingSpace に一致する範囲を削除する。
    //   失敗した段落は addFailure(i, "行頭スペース削除", e.message)
}

// 本文中の注番号に文字スタイル「sup」を当てる（注リスト側の先頭番号には当てない）
//   1. position が上付きの文字を拾い、文字スタイルを当てて直接指定を解除する
//   2. 上付きでないものは形で検索する： (1) （1） 1) 1） ＊1 *1 注1
//   3. 裸の数字は触らず、要確認に出す
function applyNoteSuperscript() {
    // TODO（第1段階では枠のみ）
    //   適用数は G.counts.superscript に加算する
}

// 段落の一部だけが太字 -> 文字スタイル「gothic」
// 段落全体が太字で見出しにならなかったもの -> gothic を当てて要確認（flagChecks で立てている）
function applyGothic() {
    // TODO（第1段階では枠のみ）
    //   適用数は G.counts.gothic に加算する
}

// 文字スタイルを当てたあと、フォント・級数・色・太字などの直接指定を解除する
// 斜体・下線・取り消し線は未確定のため残す（位置は flagChecks で要確認に出している）
function clearOverrides() {
    // TODO（第1段階では枠のみ）
}

// Word由来のクリーンアップ
//   空段落の削除／行末の空白・タブの削除／連続する半角スペースの統合／
//   自動番号の実文字化／半角カナの全角化
//   段落を削除したら G.indexMap を更新する（後ろから前へ処理する）
function cleanupWordArtifacts() {
    // TODO（第1段階では枠のみ）
    //   削除した段落は G.indexMap[i] = -1、以降の段落は番号を詰める
}

// 適用後のチェック：「標準」のまま残った段落など
function postCheck() {
    var story = getStoryNow();
    var names = toArray(story.paragraphs.everyItem().appliedParagraphStyle);
    var contents = toArray(story.paragraphs.everyItem().contents);
    var i, nm, txt;
    for (i = 0; i < names.length; i++) {
        try {
            nm = names[i].name;
            txt = (typeof contents[i] === "string") ? trim(contents[i]) : "";
            if (txt.length === 0) { continue; }
            if (inArray(CFG.collect.plainStyleNames, nm)) {
                addCheckByDocIndex(i, headOf(txt), "段落スタイルが「" + nm + "」のまま残っている");
            }
        } catch (e) {
            addFailure(i, "適用後チェック", e.message);
        }
    }
    // TODO（第2段階）：オーバーセットしているフレームの検出（allPageItems を走査する）
}

// 実行後の段落index（0始まり）で要確認を登録する
function addCheckByDocIndex(docIndex, head, reason) {
    G.checks.push({ para: -1, docIndex: docIndex, head: head, reason: reason });
}

// =====================================================================
// レポート
// =====================================================================
function buildReport() {
    var L = [];
    var sep = CFG.report.separator;
    var i, k;

    L.push(CFG.scriptName + " v" + CFG.version + " 完了レポート");
    L.push("ドキュメント：" + G.docName);
    L.push("マッピング表：" + G.csvPath);
    L.push("実行日時：" + formatDate(G.startedAt));
    L.push(sep);

    L.push("【処理件数】");
    L.push("  段落数：" + G.counts.paragraphs);
    var hk = objectKeys(G.counts.headings).sort();
    if (hk.length === 0) {
        L.push("  見出し：0");
    } else {
        for (i = 0; i < hk.length; i++) {
            L.push("  見出し " + hk[i] + "：" + G.counts.headings[hk[i]]);
        }
    }
    L.push("  注：" + G.counts.notes);
    L.push("  図表キャプション：" + G.counts.captions);
    L.push("  参考文献：" + G.counts.refs);
    L.push("  ゴシック適用箇所：" + G.counts.gothic);
    L.push("  上付き適用箇所：" + G.counts.superscript);
    L.push("  スタイル適用段落：" + G.counts.appliedTotal);
    L.push("  未判定（スタイル未適用）：" + G.counts.unclassified);
    L.push(sep);

    L.push("【要確認】" + G.checks.length + " 件");
    if (G.checks.length === 0) {
        L.push("  なし");
    } else {
        var sorted = G.checks.slice(0);
        sorted.sort(function (a, b) { return checkSortKey(a) - checkSortKey(b); });
        for (i = 0; i < sorted.length; i++) {
            var c = sorted[i];
            var no = (c.docIndex !== undefined) ? (c.docIndex + 1) : docParaNo(c.para);
            var label;
            if (c.para < 0 && c.docIndex === undefined) { label = "  [全体]"; }
            else if (no === null) { label = "  [削除済 元" + (c.para + 1) + "]"; }
            else { label = "  段落 " + padLeft(no, 4); }
            L.push(label + "  " + (c.head ? c.head + "  " : "") + "- " + c.reason);
        }
    }
    L.push(sep);

    L.push("【失敗した処理】" + G.failures.length + " 件");
    if (G.failures.length === 0) {
        L.push("  なし");
    } else {
        for (i = 0; i < G.failures.length; i++) {
            var f = G.failures[i];
            var fno = docParaNo(f.para);
            L.push("  段落 " + (fno === null ? "(元" + (f.para + 1) + ")" : padLeft(fno, 4)) +
                   "  " + f.action + "：" + f.message);
        }
    }
    L.push(sep);
    L.push("※ 段落番号は実行後のドキュメント上の番号。");
    return L.join("\r\n");
}

function checkSortKey(c) {
    if (c.docIndex !== undefined) { return c.docIndex; }
    if (c.para < 0) { return -1; }
    var m = G.indexMap[c.para];
    return (m === undefined || m === null || m < 0) ? c.para : m;
}

// レポートをダイアログに表示し、テキスト保存できるようにする
function showReport(title, text, defaultFile) {
    var w = new Window("dialog", title);
    w.orientation = "column";
    w.alignChildren = ["fill", "fill"];

    var box = w.add("edittext", undefined, text, { multiline: true, readonly: true, scrolling: true });
    box.preferredSize = [CFG.report.width, CFG.report.height];

    var row = w.add("group");
    row.orientation = "row";
    row.alignment = ["right", "bottom"];
    var saveBtn = row.add("button", undefined, "テキスト保存…");
    var closeBtn = row.add("button", undefined, "閉じる", { name: "ok" });

    saveBtn.onClick = function () {
        try {
            var f = defaultFile ? defaultFile.saveDlg("要確認リストを保存", "テキスト:*.txt")
                                : File.saveDialog("要確認リストを保存", "テキスト:*.txt");
            if (!f) { return; }
            if (!/\.txt$/i.test(f.name)) { f = new File(f.fsName + ".txt"); }
            writeTextFile(f, text);
            alert("保存しました：\n" + f.fsName);
        } catch (e) {
            alert("保存に失敗しました：\n" + e.message);
        }
    };
    closeBtn.onClick = function () { w.close(); };
    w.show();
}

function writeTextFile(file, text) {
    file.encoding = CFG.report.encoding;
    file.lineFeed = "Windows";
    if (!file.open("w")) { throw new Error("ファイルを開けません：" + file.fsName); }
    // Windowsのメモ帳等で文字化けしないよう BOM を付ける
    file.write("﻿" + text);
    file.close();
}

// =====================================================================
// メイン
// =====================================================================
function main() {
    G.startedAt = new Date();
    var doc, story, csvFile, missing, i;

    try {
        // 1. 前提チェック
        setStep("前提チェック");
        if (app.documents.length === 0) {
            throw stopWith("ドキュメントが開かれていません。");
        }
        doc = app.activeDocument;
        G.docName = doc.name;
        try { G.docPath = doc.filePath; } catch (ePath) { G.docPath = null; }

        story = getTargetStory(doc);
        G.storyId = story.id;

        var scriptFile = new File($.fileName);
        csvFile = new File(scriptFile.parent.fsName + "/" + CFG.csv.fileName);
        if (!csvFile.exists) {
            throw stopWith("マッピング表CSVが見つかりません。\nスクリプトと同じフォルダに置いてください：\n" + csvFile.fsName);
        }
        G.csvPath = csvFile.fsName;

        // 2. マッピング表の読み込みとスタイルの存在確認
        setStep("マッピング表の読み込み");
        G.styleMap = loadStyleMap(csvFile);

        setStep("スタイルの存在確認");
        missing = checkStyles(doc, G.styleMap);
        if (missing.length > 0) {
            var msg = "マッピング表にあるスタイルがドキュメントにありません。\n" +
                      "前回号からスタイルを読み込むか、CSVの名前を直してから再実行してください。\n" +
                      "（ドキュメントは書き換えていません）\n\n" + missing.join("\n");
            showReport("スタイルが不足しています", msg, null);
            return;
        }

        // 3. 情報採取（ここまでドキュメントを書き換えない）
        setStep("段落情報の採取");
        story = getStoryNow();
        G.paraInfo = collectParagraphs(story);
        G.counts.paragraphs = G.paraInfo.length;
        G.stats = computeStats(G.paraInfo);
        G.indexMap = [];
        for (i = 0; i < G.paraInfo.length; i++) { G.indexMap.push(i); }

        // 4. 意味づけ
        setStep("意味づけ（判定）");
        G.results = classifyParagraphs(G.paraInfo, G.stats);
        if (G.results.length !== G.paraInfo.length) {
            throw new Error("判定結果の数（" + G.results.length + "）が段落数（" + G.paraInfo.length + "）と一致しません");
        }

        // 5. 要確認フラグ
        setStep("要確認フラグ");
        flagChecks(G.paraInfo, G.results);

        // 7〜12. ドキュメントの書き換え（1回のアンドゥで戻せる）
        setStep("書き換え開始");
        var redraw = app.scriptPreferences.enableRedraw;
        app.scriptPreferences.enableRedraw = false;
        try {
            app.doScript(applyAll, ScriptLanguage.JAVASCRIPT, undefined,
                         UndoModes.ENTIRE_SCRIPT, CFG.undoName);
        } finally {
            app.scriptPreferences.enableRedraw = redraw;
        }

        // 13. レポート
        setStep("レポート");
        var report = buildReport();
        var defaultFile = null;
        if (G.docPath) {
            var base = G.docName.replace(/\.indd$/i, "");
            defaultFile = new File(G.docPath.fsName + "/" + base + CFG.report.fileSuffix);
        }
        showReport(CFG.report.dialogTitle, report, defaultFile);

    } catch (e) {
        if (e.isStop) {
            alert(CFG.scriptName + "\n\n" + e.message);
        } else {
            alert(CFG.scriptName + "\n\n工程「" + STEP + "」でエラーが発生しました。\n" +
                  e.message + "\n（行 " + e.line + "）" +
                  (G.failures.length > 0 ? "\n\n失敗した処理：" + G.failures.length + " 件" : ""));
        }
    }
}

main();
