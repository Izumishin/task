/**
 * 02_swap_name_lines.jsx
 * ------------------------------------------------------------
 * はがき宛名の 2 行を入れ替えるスクリプト（InDesign / ExtendScript）
 *
 *  【変更前】                       【変更後】
 *   末吉　遥貴　様            →     末吉　康志　様　保証人様   ← 大きい方のスタイルのまま
 *  （末吉　康志　様　保証人様）  →   （末吉　遥貴　様）          ← 小さい方のスタイルのまま
 *
 * 段落そのものを動かすのではなく「文字列だけ」を入れ替えます。
 * 段落スタイルは行の位置に貼りついたままなので、
 * 文字サイズ・行間・字送りなどは自動的にご希望どおりに入れ替わります。
 *
 * 対応レイアウト：
 *   ・2 行が同じテキストフレームに並んでいる
 *   ・2 行が別々のテキストフレームに分かれている
 *   ・2 行が表（テーブル）の別々のセルに入っている
 *   ・片方がセル、もう片方がテキストフレーム
 *
 * 速度について：
 *   段落スタイル名を指定すると InDesign の検索エンジン（findText）で
 *   一気に拾うため、3000 ページでも数十秒で終わります。
 *   スタイル名を空にした「自動判定モード」は 1 件ずつ走査するため
 *   非常に遅くなります。必ずスタイル名を指定してください。
 *
 * 使い方：
 *   1) まず 01_inspect_styles.jsx を実行して段落スタイル名を確認
 *   2) 下の CONFIG に、その 2 つのスタイル名を書き写す
 *   3) DRY_RUN: true のまま実行して、プレビュー（何も書き換わりません）を確認
 *   4) 問題なければ DRY_RUN: false にして本番実行
 *
 * ※ 必ずファイルのコピーで試してください。
 * ------------------------------------------------------------
 */

#target "indesign"

var CONFIG = {

    /* 現在「上」にある行（末吉　遥貴　様）の段落スタイル名 */
    STYLE_TOP: "",

    /* 現在「下」にある行（（末吉　康志　様　保証人様））の段落スタイル名 */
    STYLE_BOTTOM: "",
    /* ↑ スタイルグループに入っている場合は "グループ名:スタイル名" と書きます。
       2つとも空 "" だと「自動判定モード」（非常に低速）になります。 */

    /* 自動判定モードで「保証人の行」を見分けるキーワード */
    AUTO_KEYWORD: "保証人",

    /* 丸カッコ（　）の扱い
         "bottom" … 下の行にだけカッコを付ける（＝現在のデザインを踏襲）
                     上：末吉　康志　様　保証人様 ／ 下：（末吉　遥貴　様）
         "top"    … 上の行にだけカッコを付ける
         "none"   … 両方ともカッコを外す
         "keep"   … 何もしない。カッコごと丸ごと入れ替える                */
    PAREN_POSITION: "bottom",

    /* true = 下見だけ（1文字も書き換えない）／ false = 実際に入れ替える */
    DRY_RUN: true,

    /* マスターページ上のテキストも対象にするか（通常は false のまま） */
    INCLUDE_MASTER_PAGES: false,

    /* 進捗ウィンドウを出すか */
    SHOW_PROGRESS: true,

    /* 自動判定モードのとき、セルの中の入れ子の表まで探すか（遅くなる） */
    SCAN_NESTED_TABLES: false,

    /* ログに残す件数の上限 */
    LOG_LIMIT: 30
};

/* ============================================================ */

var g;

/* 03_batch_folder.jsx から読み込まれたときは自動実行しない */
var BATCH = (typeof BATCH_MODE !== "undefined" && BATCH_MODE === true);

if (!BATCH) {
    if (app.documents.length === 0) {
        alert("先に対象の InDesign ドキュメントを開いてから実行してください。");
    } else if (CONFIG.DRY_RUN) {
        run();                       // 下見は取り消し不要
    } else {
        app.doScript(run, ScriptLanguage.JAVASCRIPT, undefined,
                     UndoModes.ENTIRE_SCRIPT, "宛名2行の入れ替え");
    }
}

/* ============================================================ */

function run() {
    var doc = app.activeDocument;
    g = { pairs: [], errors: [], warns: [], useAuto: false,
          stTop: null, stBottom: null, foundTop: 0, foundBottom: 0, method: "" };

    /* --- 段落スタイルの解決 --- */
    if (CONFIG.STYLE_TOP !== "" || CONFIG.STYLE_BOTTOM !== "") {
        g.stTop    = findStyle(doc, CONFIG.STYLE_TOP);
        g.stBottom = findStyle(doc, CONFIG.STYLE_BOTTOM);
        if (!g.stTop || !g.stBottom) {
            if (BATCH) return { pairs: 0, done: 0, error: "段落スタイルが見つかりません" };
            alert("段落スタイルが見つかりません。\n" +
                  "  STYLE_TOP: "    + CONFIG.STYLE_TOP    + (g.stTop    ? " → OK" : " → 見つかりません") + "\n" +
                  "  STYLE_BOTTOM: " + CONFIG.STYLE_BOTTOM + (g.stBottom ? " → OK" : " → 見つかりません") + "\n\n" +
                  "01_inspect_styles.jsx で正しい名前を確認してください。");
            return;
        }
        if (g.stTop.id === g.stBottom.id) {
            if (BATCH) return { pairs: 0, done: 0, error: "STYLE_TOP と STYLE_BOTTOM が同一" };
            alert("STYLE_TOP と STYLE_BOTTOM に同じスタイルが指定されています。");
            return;
        }
    } else {
        g.useAuto = true;
    }

    var redraw = app.scriptPreferences.enableRedraw;
    app.scriptPreferences.enableRedraw = false;      // 画面更新を止めて高速化
    var prog = null;

    try {
        /* --- 収集 --- */
        if (g.useAuto) {
            g.method = "全走査（低速）";
            prog = openProgress("対象を探しています（自動判定モード・低速）…");
            collectByWalk(doc, prog);
        } else {
            g.method = "findText（高速）";
            prog = openProgress("対象を探しています…");
            collectByFind(doc, prog);
        }
        closeProgress(prog); prog = null;

        if (g.pairs.length === 0) {
            if (BATCH) return { pairs: 0, done: 0, error: "対象なし" };
            alert("入れ替え対象が 1 件も見つかりませんでした。\n\n" +
                  "検出: 上の行 " + g.foundTop + " 件 ／ 下の行 " + g.foundBottom + " 件\n\n" +
                  g.warns.slice(0, 10).join("\n"));
            return;
        }

        /* --- 置き換え文字列を組み立て --- */
        var i;
        for (i = 0; i < g.pairs.length; i++) {
            var pr = g.pairs[i];
            if (CONFIG.PAREN_POSITION === "keep") {
                pr.newTop    = pr.oldBottom;
                pr.newBottom = pr.oldTop;
            } else {
                pr.newTop    = decorate(stripParens(pr.oldBottom), "top");
                pr.newBottom = decorate(stripParens(pr.oldTop),    "bottom");
            }
        }

        /* --- 実行 ---
         * 後ろから処理する。テキストを書き換えると同じストーリー内の
         * 後方の位置指定がずれるため、必ず「後ろ → 前」の順で書き込む。 */
        var done = 0;
        if (!CONFIG.DRY_RUN) {
            prog = openProgress("入れ替えています…", g.pairs.length);
            for (i = g.pairs.length - 1; i >= 0; i--) {
                var q = g.pairs[i];
                try {
                    applyPair(q);
                    done++;
                } catch (e) {
                    g.errors.push(describe(q) + ": " + e);
                }
                if (prog && (i % 25 === 0)) stepProgress(prog, g.pairs.length - i);
            }
            closeProgress(prog); prog = null;
        }

        return writeLog(doc, done);

    } finally {
        closeProgress(prog);
        app.scriptPreferences.enableRedraw = redraw;
        resetFindPrefs();
    }
}

/* ------------------------------------------------------------
 * 高速収集：InDesign の検索エンジンで段落スタイル一致を一括取得
 *
 * doc.findText() はネイティブ処理で、表のセルの中も含めて
 * ドキュメント全体を一度に走査する。ExtendScript から
 * セルを 1 つずつ触るより桁違いに速い。
 * ---------------------------------------------------------- */
function collectByFind(doc, prog) {
    resetFindPrefs();
    app.findChangeTextOptions.includeMasterPages         = CONFIG.INCLUDE_MASTER_PAGES;
    app.findChangeTextOptions.includeHiddenLayers        = false;
    app.findChangeTextOptions.includeLockedLayersForFind = false;
    app.findChangeTextOptions.includeLockedStoriesForFind = false;
    app.findChangeTextOptions.includeFootnotes           = true;

    app.findTextPreferences.appliedParagraphStyle = g.stTop;
    var tops = doc.findText();
    app.findTextPreferences.appliedParagraphStyle = g.stBottom;
    var bots = doc.findText();
    resetFindPrefs();

    g.foundTop = tops.length;
    g.foundBottom = bots.length;
    if (tops.length === 0 || bots.length === 0) {
        g.warns.push("検出: 上の行 " + tops.length + " 件 ／ 下の行 " + bots.length +
                     " 件。スタイル名の指定を確認してください。");
        return;
    }

    var items = [], i, item;
    if (prog) setProgressMax(prog, tops.length + bots.length);

    for (i = 0; i < tops.length; i++) {
        item = wrapFound(tops[i], "T");
        if (item) items.push(item);
        if (prog && (i % 100 === 0)) stepProgress(prog, i);
    }
    for (i = 0; i < bots.length; i++) {
        item = wrapFound(bots[i], "B");
        if (item) items.push(item);
        if (prog && (i % 100 === 0)) stepProgress(prog, tops.length + i);
    }

    /* ① 同じストーリーどうしで組む
          （はがき 1 枚＝1 フレーム＋その中の表、という一般的な構成はここで片付く） */
    var rest = pairItems(items, function (it) { return it.storyId; });
    if (rest.length === 0) return;

    /* ② 余りは同じページどうしで組む（上下が別フレームに分かれている構成） */
    if (prog) { setProgressMax(prog, rest.length); stepProgress(prog, 0); }
    for (i = 0; i < rest.length; i++) {
        rest[i].page = pageOfFound(rest[i].obj);
        if (prog && (i % 50 === 0)) stepProgress(prog, i);
    }
    rest = pairItems(rest, function (it) { return it.page; });
    if (rest.length === 0) return;

    /* ③ それでも余ったら、検索で出てきた順（＝ドキュメント順）で組む */
    var rt = [], rb = [];
    for (i = 0; i < rest.length; i++) (rest[i].kind === "T" ? rt : rb).push(rest[i]);
    var m = Math.min(rt.length, rb.length);
    if (m > 0) {
        g.warns.push("同じストーリー／ページで相手が見つからなかった " + m +
                     " 組は、ドキュメント順で機械的に組みました。" +
                     "DRY RUN のログで対応が正しいか必ず確認してください。");
        for (i = 0; i < m; i++) g.pairs.push(makeRangePair(rt[i], rb[i]));
    }
    if (rt.length !== rb.length) {
        g.warns.push("相手が見つからなかった行: 上の行 " + (rt.length - m) +
                     " 件 ／ 下の行 " + (rb.length - m) + " 件");
        var rem = (rt.length > m) ? rt : rb;
        for (i = m; i < Math.min(m + 10, rem.length); i++) {
            g.warns.push("   ・[" + rem[i].kind + "] 「" + rem[i].txt + "」");
        }
    }
}

/** items を key ごとにまとめて上下を組にし、余りを返す */
function pairItems(items, keyFn) {
    var buckets = {}, order = [], i, key;
    for (i = 0; i < items.length; i++) {
        key = String(keyFn(items[i]));
        if (!buckets[key]) { buckets[key] = { t: [], b: [] }; order.push(key); }
        buckets[key][items[i].kind === "T" ? "t" : "b"].push(items[i]);
    }
    var rest = [];
    for (i = 0; i < order.length; i++) {
        var box = buckets[order[i]];
        var m = Math.min(box.t.length, box.b.length);
        for (var j = 0; j < m; j++) g.pairs.push(makeRangePair(box.t[j], box.b[j]));
        for (j = m; j < box.t.length; j++) rest.push(box.t[j]);
        for (j = m; j < box.b.length; j++) rest.push(box.b[j]);
    }
    return rest;
}

function makeRangePair(t, b) {
    return {
        kind: "range",
        topObj: t.obj, topBreak: t.brk, oldTop: t.txt,
        botObj: b.obj, botBreak: b.brk, oldBottom: b.txt,
        storyId: t.storyId
    };
}

function pageOfFound(found) {
    try {
        var fr = found.parentTextFrames;
        if (fr.length > 0 && fr[0].parentPage) return String(fr[0].parentPage.name);
    } catch (e) {}
    return "?";
}

/** 検索結果 1 件を扱いやすい形にする。段落をまたぐ結果は除外 */
function wrapFound(found, kind) {
    var raw, storyId;
    try {
        raw = String(found.contents);
        storyId = found.parentStory.id;
    } catch (e) { return null; }

    var brk = "";
    var body = raw;
    var last = raw.charAt(raw.length - 1);
    if (last === "\r" || last === "\n" || last === "\u2029") {
        brk = last;
        body = raw.substring(0, raw.length - 1);
    }
    if (/[\r\n\u2029]/.test(body)) {
        /* 同じスタイルの段落が連続している。誤って結合しないよう対象外にする */
        g.warns.push("複数段落が連続しているため対象外: 「" +
                     body.replace(/[\r\n\u2029]/g, " / ").substr(0, 40) + "」");
        return null;
    }
    body = trimEdges(body);
    if (body === "") return null;

    return { obj: found, txt: body, brk: brk, kind: kind, storyId: storyId };
}

/* ------------------------------------------------------------
 * 低速収集（自動判定モード用のフォールバック）
 * ストーリーと表のセルを 1 つずつ走査する。
 * ---------------------------------------------------------- */
function collectByWalk(doc, prog) {
    var containers = collectContainers(doc);
    if (prog) setProgressMax(prog, containers.length);

    var leftovers = [];
    for (var ci = 0; ci < containers.length; ci++) {
        if (prog && (ci % 50 === 0)) stepProgress(prog, ci);

        var ct = containers[ci];
        var paras, n;
        try { paras = ct.obj.paragraphs; n = paras.length; } catch (e) { continue; }
        if (!n) continue;

        var contents = asArray(paras.everyItem().contents, n);
        var tops = [], bottoms = [];
        for (var k = 0; k < n; k++) {
            var txt = trimEdges(String(contents[k]).replace(/[\r\n\u2029]+$/, ""));
            if (txt === "") continue;
            var kind = classifyAuto(txt);
            if (kind === "T")      tops.push({ ct: ct, idx: k, txt: txt, kind: "T" });
            else if (kind === "B") bottoms.push({ ct: ct, idx: k, txt: txt, kind: "B" });
        }
        g.foundTop += tops.length;
        g.foundBottom += bottoms.length;
        if (!tops.length && !bottoms.length) continue;

        var m = Math.min(tops.length, bottoms.length);
        for (var c = 0; c < m; c++) g.pairs.push(makeParaPair(tops[c], bottoms[c]));
        for (var t = m; t < tops.length; t++)    leftovers.push(tops[t]);
        for (var b = m; b < bottoms.length; b++) leftovers.push(bottoms[b]);
    }

    /* 同じ表の中で組む → それでも余ったら同じページで組む */
    leftovers = pairLeftovers(leftovers, function (it) { return it.ct.groupId; });
    for (var i = 0; i < leftovers.length; i++) leftovers[i].page = pageNameOf(leftovers[i].ct, leftovers[i].idx);
    leftovers = pairLeftovers(leftovers, function (it) { return it.page; });

    if (leftovers.length) {
        g.warns.push("相手が見つからなかった行: " + leftovers.length + " 件");
        for (i = 0; i < Math.min(10, leftovers.length); i++) {
            g.warns.push("   ・[" + leftovers[i].kind + "] " + leftovers[i].ct.label +
                         " 「" + leftovers[i].txt + "」");
        }
    }
}

function collectContainers(doc) {
    var list = [];
    var stories = doc.stories;
    for (var s = 0; s < stories.length; s++) {
        var story = stories[s];
        var sid;
        try { sid = story.id; } catch (e) { continue; }
        list.push({ obj: story, kind: "story", groupId: "S" + sid, order: 0, label: "ストーリー" + sid });
        collectTables(story, list);
    }
    return list;
}

function collectTables(textObj, list) {
    var tables;
    try { tables = textObj.tables; } catch (e) { return; }
    if (!tables || !tables.length) return;
    for (var t = 0; t < tables.length; t++) {
        var tbl = tables[t], key, cells;
        try { key = "T" + tbl.id; cells = tbl.cells; } catch (e) { continue; }
        for (var c = 0; c < cells.length; c++) {
            list.push({ obj: cells[c], kind: "cell", groupId: key, order: c,
                        label: "表" + key + " セル" + c });
            if (CONFIG.SCAN_NESTED_TABLES) collectTables(cells[c], list);
        }
    }
}

function pairLeftovers(list, keyFn) {
    var buckets = {}, order = [], i, key;
    for (i = 0; i < list.length; i++) {
        key = String(keyFn(list[i]));
        if (!buckets[key]) { buckets[key] = { t: [], b: [] }; order.push(key); }
        buckets[key][list[i].kind === "T" ? "t" : "b"].push(list[i]);
    }
    var rest = [];
    for (i = 0; i < order.length; i++) {
        var box = buckets[order[i]];
        box.t.sort(byPosition);
        box.b.sort(byPosition);
        var m = Math.min(box.t.length, box.b.length);
        for (var j = 0; j < m; j++) g.pairs.push(makeParaPair(box.t[j], box.b[j]));
        for (j = m; j < box.t.length; j++) rest.push(box.t[j]);
        for (j = m; j < box.b.length; j++) rest.push(box.b[j]);
    }
    return rest;
}

function byPosition(a, b) {
    if (a.ct.order !== b.ct.order) return a.ct.order - b.ct.order;
    return a.idx - b.idx;
}

function makeParaPair(top, bottom) {
    return {
        kind: "para",
        topC: top.ct,    topIdx: top.idx,       oldTop: top.txt,
        botC: bottom.ct, bottomIdx: bottom.idx, oldBottom: bottom.txt
    };
}

function classifyAuto(txt) {
    if (txt.indexOf("様") === -1) return null;
    return (txt.indexOf(CONFIG.AUTO_KEYWORD) !== -1) ? "B" : "T";
}

/* ------------------------------------------------------------
 * 書き込み。下の行 → 上の行 の順（後方から）で書く。
 * ---------------------------------------------------------- */
function applyPair(p) {
    if (p.kind === "range") {
        p.botObj.contents = p.newBottom + p.botBreak;
        p.topObj.contents = p.newTop + p.topBreak;
    } else {
        setParagraphText(p.botC.obj, p.bottomIdx, p.newBottom);
        setParagraphText(p.topC.obj, p.topIdx, p.newTop);
    }
}

/** 段落の本文だけを差し替える（末尾の改行文字は残す＝段落数を変えない） */
function setParagraphText(container, idx, newText) {
    var p = container.paragraphs[idx];
    var n = p.characters.length;
    if (n === 0) return;
    var last = p.characters[n - 1].contents;
    var isBreak = (last === "\r" || last === "\n" || last === "\u2029");

    if (isBreak) {
        if (n === 1) p.insertionPoints[0].contents = newText;      // 空段落
        else         p.characters.itemByRange(0, n - 2).contents = newText;
    } else {
        p.texts[0].contents = newText;                             // 最終段落
    }
}

/* ------------------------------------------------------------ */

function resetFindPrefs() {
    try {
        app.findTextPreferences   = NothingEnum.NOTHING;
        app.changeTextPreferences = NothingEnum.NOTHING;
    } catch (e) {}
}

function stripParens(s) {
    var t = trimEdges(s);
    if (/^[（(]/.test(t) && /[）)]$/.test(t)) t = trimEdges(t.substr(1, t.length - 2));
    return t;
}

function decorate(text, position) {
    if (CONFIG.PAREN_POSITION === "none") return text;
    if (CONFIG.PAREN_POSITION === position) return "（" + text + "）";
    return text;
}

function trimEdges(s) {
    return String(s).replace(/^[\s　]+/, "").replace(/[\s　]+$/, "");
}

function asArray(v, n) {
    if (v instanceof Array) return v;
    var a = [];
    for (var i = 0; i < n; i++) a.push(v);
    return a;
}

function findStyle(doc, name) {
    if (!name) return null;
    var all = doc.allParagraphStyles, i;
    for (i = 0; i < all.length; i++) if (all[i].name === name) return all[i];
    for (i = 0; i < all.length; i++) if (fullStyleName(all[i]) === name) return all[i];
    return null;
}

function fullStyleName(style) {
    var name = style.name, parent = style.parent;
    while (parent && parent.constructor.name === "ParagraphStyleGroup") {
        name = parent.name + ":" + name;
        parent = parent.parent;
    }
    return name;
}

function describe(p) {
    if (p.kind === "range") return "ストーリー " + p.storyId;
    return p.topC.label;
}

/** ログ表示用。件数が多いと重いので、記録する数件にだけ使う */
function pageNameOf(container, idx) {
    try {
        var frames = container.obj.paragraphs[idx].parentTextFrames;
        if (frames.length > 0 && frames[0].parentPage) return String(frames[0].parentPage.name);
    } catch (e) {}
    if (container.kind === "cell") {
        try {
            var tbl = container.obj.parent;
            while (tbl && tbl.constructor.name !== "Table") tbl = tbl.parent;
            var fr = tbl.storyOffset.parentTextFrames;
            if (fr.length > 0 && fr[0].parentPage) return String(fr[0].parentPage.name);
        } catch (e2) {}
    }
    return "?";
}

function pageOfPair(p) {
    try {
        if (p.kind === "range") {
            var fr = p.topObj.parentTextFrames;
            if (fr.length > 0 && fr[0].parentPage) return String(fr[0].parentPage.name);
            return "?";
        }
        return pageNameOf(p.topC, p.topIdx);
    } catch (e) { return "?"; }
}

/* ---------- 進捗ウィンドウ ---------- */

function openProgress(message, max) {
    if (!CONFIG.SHOW_PROGRESS || BATCH) return null;
    try {
        var w = new Window("palette", "宛名2行の入れ替え");
        w.orientation = "column";
        w.alignChildren = "left";
        w.msg = w.add("statictext", undefined, message);
        w.msg.preferredSize.width = 340;
        w.bar = w.add("progressbar", undefined, 0, max ? max : 100);
        w.bar.preferredSize = [340, 12];
        w.note = w.add("statictext", undefined, "処理中… しばらくお待ちください");
        w.note.preferredSize.width = 340;
        w.show();
        w.update();
        return w;
    } catch (e) { return null; }
}

function setProgressMax(w, max) {
    if (!w) return;
    try { w.bar.maxvalue = max; w.update(); } catch (e) {}
}

function stepProgress(w, value) {
    if (!w) return;
    try {
        w.bar.value = value;
        w.note.text = value + " / " + w.bar.maxvalue;
        w.update();
    } catch (e) {}
}

function closeProgress(w) {
    if (!w) return;
    try { w.close(); } catch (e) {}
}

/* ---------- ログ ---------- */

function writeLog(doc, done) {
    var lines = [];
    lines.push("ドキュメント: " + doc.name);
    lines.push("モード: " + (CONFIG.DRY_RUN ? "下見（DRY RUN・未変更）" : "本番実行"));
    lines.push("方式: " + g.method);
    lines.push("判定: " + (g.useAuto ? "自動判定" : "段落スタイル指定（" +
                            CONFIG.STYLE_TOP + " / " + CONFIG.STYLE_BOTTOM + "）"));
    lines.push("カッコ: " + CONFIG.PAREN_POSITION);
    lines.push("検出: 上の行 " + g.foundTop + " 件 ／ 下の行 " + g.foundBottom + " 件");
    lines.push("対象ペア: " + g.pairs.length + " 件" +
               (CONFIG.DRY_RUN ? "" : "  ／ 書き換え成功: " + done + " 件"));
    lines.push("");

    var lim = Math.min(CONFIG.LOG_LIMIT, g.pairs.length), i;
    for (i = 0; i < lim; i++) {
        var p = g.pairs[i];
        lines.push("[" + pageOfPair(p) + " ページ]");
        lines.push("   上 : " + p.oldTop    + "   →   " + p.newTop);
        lines.push("   下 : " + p.oldBottom + "   →   " + p.newBottom);
    }
    if (g.pairs.length > lim) lines.push("... 他 " + (g.pairs.length - lim) + " 件");

    if (g.warns.length) {
        lines.push("");
        lines.push("■ 警告 (" + g.warns.length + " 件)");
        for (i = 0; i < Math.min(30, g.warns.length); i++) lines.push("   " + g.warns[i]);
    }
    if (g.errors.length) {
        lines.push("");
        lines.push("■ エラー (" + g.errors.length + " 件)");
        for (i = 0; i < Math.min(30, g.errors.length); i++) lines.push("   " + g.errors[i]);
    }

    var report = lines.join("\n");

    if (BATCH) {
        return { pairs: g.pairs.length, done: done,
                 warns: g.warns.length, errors: g.errors.length, report: report };
    }

    try {
        var f = new File(Folder.desktop + "/indesign_swap_log.txt");
        f.encoding = "UTF-8";
        f.open("w");
        f.write(report);
        f.close();
    } catch (e) {}

    alert((CONFIG.DRY_RUN
            ? "【下見モード】ドキュメントは変更していません。\n内容を確認して問題なければ CONFIG.DRY_RUN を false にして再実行してください。\n\n"
            : "【完了】" + done + " 件を入れ替えました。\n（取り消しは 編集 → 取り消し で一括で戻せます）\n\n")
          + "詳細ログ: デスクトップ / indesign_swap_log.txt\n\n"
          + report.substr(0, 1500));

    return { pairs: g.pairs.length, done: done,
             warns: g.warns.length, errors: g.errors.length, report: report };
}
