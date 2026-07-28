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
    /* ↑ 2つとも空 "" のままだと「自動判定モード」で動きます。
       自動判定は「保証人」を含む行＝下の行、同じ組の「様」を含むもう一方＝上の行、
       として推測します。スタイル名が分かっている場合は必ず指定してください。
       スタイルグループに入っている場合は "グループ名:スタイル名" と書きます。 */

    /* 自動判定モードで「保証人の行」を見分けるキーワード */
    AUTO_KEYWORD: "保証人",

    /* 丸カッコ（　）の扱い
         "bottom" … 下の行にだけカッコを付ける（＝現在のデザインを踏襲）
                     上：末吉　康志　様　保証人様 ／ 下：（末吉　遥貴　様）
         "top"    … 上の行にだけカッコを付ける
         "none"   … 両方ともカッコを外す
         "keep"   … 何もしない。カッコごと丸ごと入れ替える
                     上：（末吉　康志　様　保証人様） ／ 下：末吉　遥貴　様      */
    PAREN_POSITION: "bottom",

    /* true = 下見だけ（1文字も書き換えない）／ false = 実際に入れ替える */
    DRY_RUN: true,

    /* ログに残す件数の上限（全件だとファイルが巨大になるため） */
    LOG_LIMIT: 50
};

/* ============================================================ */

var g = { pairs: [], errors: [], warns: [], useAuto: false, stTop: null, stBottom: null };

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
    g = { pairs: [], errors: [], warns: [], useAuto: false, stTop: null, stBottom: null };

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

    collectPairs(doc);

    if (g.pairs.length === 0) {
        if (BATCH) return { pairs: 0, done: 0, error: "対象なし" };
        alert("入れ替え対象が 1 件も見つかりませんでした。\n" +
              "スタイル名の指定を確認してください。\n\n" + g.warns.slice(0, 10).join("\n"));
        return;
    }

    /* --- 置き換え文字列を組み立て --- */
    var i;
    for (i = 0; i < g.pairs.length; i++) {
        var pr = g.pairs[i];
        if (CONFIG.PAREN_POSITION === "keep") {
            /* カッコごと丸ごと入れ替える（文字列を一切加工しない） */
            pr.newTop    = pr.oldBottom;
            pr.newBottom = pr.oldTop;
        } else {
            pr.newTop    = decorate(stripParens(pr.oldBottom), "top");
            pr.newBottom = decorate(stripParens(pr.oldTop),    "bottom");
        }
    }

    /* --- 実行 --- */
    var done = 0;
    if (!CONFIG.DRY_RUN) {
        for (i = 0; i < g.pairs.length; i++) {
            var q = g.pairs[i];
            try {
                setParagraphText(q.story, q.topIdx, q.newTop);
                setParagraphText(q.story2 ? q.story2 : q.story, q.bottomIdx, q.newBottom);
                done++;
            } catch (e) {
                g.errors.push(q.pageName + " ページ: " + e);
            }
        }
    }

    return writeLog(doc, done);
}

/* ------------------------------------------------------------
 * 対象ペアの収集
 *   ① 同じストーリー（同じテキストフレーム）内で上下に並んでいる場合
 *   ② 2 行が別々のテキストフレームに分かれている場合（同一ページで組む）
 * ---------------------------------------------------------- */
function collectPairs(doc) {
    var leftoverTop = [], leftoverBottom = [];
    var stories = doc.stories;

    for (var s = 0; s < stories.length; s++) {
        var story = stories[s];
        var n = story.paragraphs.length;
        if (n === 0) continue;

        var contents = asArray(story.paragraphs.everyItem().contents, n);
        var styles   = g.useAuto ? null
                                 : asArray(story.paragraphs.everyItem().appliedParagraphStyle, n);

        var tops = [], bottoms = [];
        for (var k = 0; k < n; k++) {
            var txt = trimPara(contents[k]);
            if (txt === "") continue;
            var kind = g.useAuto ? classifyAuto(txt) : classifyByStyle(styles[k]);
            if (kind === "T") tops.push({ idx: k, txt: txt });
            else if (kind === "B") bottoms.push({ idx: k, txt: txt });
        }
        if (tops.length === 0 && bottoms.length === 0) continue;

        /* ① 同一ストーリー内で、出現順に 上→下 で組にする */
        var pairCount = Math.min(tops.length, bottoms.length);
        var used = 0;
        for (var c = 0; c < pairCount; c++) {
            if (bottoms[c].idx <= tops[c].idx) {      // 想定と上下が逆
                g.warns.push("ストーリーID " + story.id + ": 上下の順序が想定と異なるため飛ばしました。");
                continue;
            }
            g.pairs.push({
                story: story,
                topIdx: tops[c].idx, bottomIdx: bottoms[c].idx,
                oldTop: tops[c].txt, oldBottom: bottoms[c].txt,
                pageName: pageNameOf(story, tops[c].idx)
            });
            used++;
        }

        /* ② 余った行はページ単位で組み直す（フレームが別々のレイアウト用） */
        for (var t = pairCount; t < tops.length; t++)
            leftoverTop.push({ story: story, idx: tops[t].idx, txt: tops[t].txt,
                               page: pageNameOf(story, tops[t].idx) });
        for (var b = pairCount; b < bottoms.length; b++)
            leftoverBottom.push({ story: story, idx: bottoms[b].idx, txt: bottoms[b].txt,
                                  page: pageNameOf(story, bottoms[b].idx) });
        if (used === 0 && pairCount > 0) { /* 順序異常のみ。警告済み */ }
    }

    /* 余りをページで突き合わせ */
    if (leftoverTop.length || leftoverBottom.length) {
        var byPage = {}, i;
        for (i = 0; i < leftoverTop.length; i++) {
            var kt = leftoverTop[i].page;
            if (!byPage[kt]) byPage[kt] = { t: [], b: [] };
            byPage[kt].t.push(leftoverTop[i]);
        }
        for (i = 0; i < leftoverBottom.length; i++) {
            var kb = leftoverBottom[i].page;
            if (!byPage[kb]) byPage[kb] = { t: [], b: [] };
            byPage[kb].b.push(leftoverBottom[i]);
        }
        for (var pg in byPage) {
            var box = byPage[pg];
            if (box.t.length !== box.b.length) {
                g.warns.push(pg + " ページ: 上の行 " + box.t.length + " 件／下の行 " +
                             box.b.length + " 件 で数が合わないため飛ばしました。");
                continue;
            }
            for (var m = 0; m < box.t.length; m++) {
                if (box.t[m].story.id !== box.b[m].story.id) {
                    /* 別ストーリーどうし。個別に書き換えるので story を分けて持つ */
                    g.pairs.push({
                        story: box.t[m].story, topIdx: box.t[m].idx,
                        story2: box.b[m].story, bottomIdx: box.b[m].idx,
                        oldTop: box.t[m].txt, oldBottom: box.b[m].txt,
                        pageName: pg
                    });
                } else {
                    g.pairs.push({
                        story: box.t[m].story,
                        topIdx: box.t[m].idx, bottomIdx: box.b[m].idx,
                        oldTop: box.t[m].txt, oldBottom: box.b[m].txt,
                        pageName: pg
                    });
                }
            }
        }
    }
}

function classifyByStyle(style) {
    if (!style) return null;
    if (style.id === g.stTop.id)    return "T";
    if (style.id === g.stBottom.id) return "B";
    return null;
}

function classifyAuto(txt) {
    if (txt.indexOf("様") === -1) return null;
    return (txt.indexOf(CONFIG.AUTO_KEYWORD) !== -1) ? "B" : "T";
}

/* ------------------------------------------------------------
 * 段落の本文だけを差し替える（末尾の改行文字は残す＝段落数を変えない）
 * ---------------------------------------------------------- */
function setParagraphText(story, idx, newText) {
    var p = story.paragraphs[idx];
    var n = p.characters.length;
    if (n === 0) return;
    var last = p.characters[n - 1].contents;
    var isBreak = (last === "\r" || last === "\n" || last === "\u2029");

    if (isBreak) {
        if (n === 1) {
            p.insertionPoints[0].contents = newText;      // 空段落
        } else {
            p.characters.itemByRange(0, n - 2).contents = newText;
        }
    } else {
        p.texts[0].contents = newText;                    // ストーリー最終段落
    }
}

/* ------------------------------------------------------------ */

function stripParens(s) {
    var t = s.replace(/^[\s　]+/, "").replace(/[\s　]+$/, "");
    if (/^[（(]/.test(t) && /[）)]$/.test(t)) {
        t = t.substr(1, t.length - 2);
        t = t.replace(/^[\s　]+/, "").replace(/[\s　]+$/, "");
    }
    return t;
}

function decorate(text, position) {
    if (CONFIG.PAREN_POSITION === "none")  return text;
    if (CONFIG.PAREN_POSITION === position) return "（" + text + "）";
    return text;
}

function trimPara(s) {
    return String(s).replace(/[\r\n\u2029]+$/, "");
}

function asArray(v, n) {
    if (v instanceof Array) return v;
    var a = [];
    for (var i = 0; i < n; i++) a.push(v);
    return a;
}

function findStyle(doc, name) {
    if (!name) return null;
    var all = doc.allParagraphStyles;
    for (var i = 0; i < all.length; i++) {
        if (all[i].name === name) return all[i];
    }
    /* "グループ名:スタイル名" 形式にも対応 */
    for (i = 0; i < all.length; i++) {
        if (fullStyleName(all[i]) === name) return all[i];
    }
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

function pageNameOf(story, idx) {
    try {
        var frames = story.paragraphs[idx].parentTextFrames;
        if (frames.length > 0 && frames[0].parentPage) return String(frames[0].parentPage.name);
    } catch (e) {}
    return "(不明)";
}

/* ------------------------------------------------------------ */

function writeLog(doc, done) {
    var lines = [];
    lines.push("ドキュメント: " + doc.name);
    lines.push("モード: " + (CONFIG.DRY_RUN ? "下見（DRY RUN・未変更）" : "本番実行"));
    lines.push("判定: " + (g.useAuto ? "自動判定" : "段落スタイル指定（" +
                            CONFIG.STYLE_TOP + " / " + CONFIG.STYLE_BOTTOM + "）"));
    lines.push("カッコ: " + CONFIG.PAREN_POSITION);
    lines.push("対象ペア: " + g.pairs.length + " 件" +
               (CONFIG.DRY_RUN ? "" : "  ／ 書き換え成功: " + done + " 件"));
    lines.push("");

    var lim = Math.min(CONFIG.LOG_LIMIT, g.pairs.length);
    for (var i = 0; i < lim; i++) {
        var p = g.pairs[i];
        lines.push("[" + p.pageName + " ページ]");
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

    var f = new File(Folder.desktop + "/indesign_swap_log.txt");
    f.encoding = "UTF-8";
    f.open("w");
    f.write(report);
    f.close();

    alert((CONFIG.DRY_RUN
            ? "【下見モード】ドキュメントは変更していません。\n内容を確認して問題なければ CONFIG.DRY_RUN を false にして再実行してください。\n\n"
            : "【完了】" + done + " 件を入れ替えました。\n（取り消しは 編集 → 取り消し で一括で戻せます）\n\n")
          + "詳細ログ: デスクトップ / indesign_swap_log.txt\n\n"
          + report.substr(0, 1500));

    return { pairs: g.pairs.length, done: done,
             warns: g.warns.length, errors: g.errors.length, report: report };
}
