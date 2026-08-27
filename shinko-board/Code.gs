/**
 * 印刷進行ボード — サーバーサイド
 * 外為印刷 電算編集室
 *
 * 仕様書「印刷進行ボード 仕様書」に基づく実装。
 * 生産表シートには一切書き込まない。書き込み先は `進行ボード` シートのみ。
 */

/** 固定値。運用で変わりうるものはスクリプトプロパティで上書きできる。 */
const CONFIG = {
  DEFAULT_PRODUCTION_SS_ID: '1yW4WyORgmAAzy-Clh6kafRK598pyY-Ee3OScoDXL1-A',
  BOARD_SHEET_NAME: '進行ボード',
  TIMEZONE: 'Asia/Tokyo',
  DATE_FORMAT: 'yyyy/MM/dd',
  PRODUCTION_HEADER_ROWS: 3,   // 生産表の見出し行数（1行目=表題 2行目=工程見出し 3行目=項目名）
  COMPLETED_VISIBLE_DAYS: 7,   // 納品完了から何日で完了カラムから消すか
  UNDECIDED_STALE_DAYS: 14,    // 「未定」のまま何日で注意表示を出すか
  LOCK_WAIT_MS: 20000,
  IMPORT_TRIGGER_HOUR: 8
};

/** 進行ボードシートの列（1始まり）。 */
const COL = {
  ORDER_NO: 1,          // A 受注NO
  CUSTOMER: 2,          // B 得意先名
  ITEM: 3,              // C 品名
  SALES: 4,             // D 営業担当
  DUE: 5,               // E 納期
  PLAN_GEHAN: 6,        // F 下版予定日
  DONE_GEHAN: 7,        // G 下版完了日
  PLAN_PRINT: 8,        // H 印刷予定日
  DONE_PRINT: 9,        // I 印刷完了日
  PLAN_OUTER: 10,       // J 外注予定日
  DONE_OUTER: 11,       // K 外注完了日
  PLAN_KOMU: 12,        // L 工務予定日
  DONE_KOMU: 13,        // M 工務完了日
  DONE_DELIVERY: 14,    // N 納品完了日
  MEMO: 15,             // O メモ
  SKIP_OUTER: 16,       // P 外注スキップ
  CATEGORY: 17,         // Q 区分
  CATEGORY_FIXED_AT: 18,// R 区分確定日
  UPDATED_AT: 19        // S 最終更新日時
};
const LAST_COL = COL.UPDATED_AT;

const HEADERS = [
  '受注NO', '得意先名', '品名', '営業担当', '納期',
  '下版予定日', '下版完了日', '印刷予定日', '印刷完了日',
  '外注予定日', '外注完了日', '工務予定日', '工務完了日',
  '納品完了日', 'メモ', '外注スキップ', '区分', '区分確定日', '最終更新日時'
];

/**
 * 生産表のどの列を読むか。既定値は 2026年8月シートの構成。
 * 列がずれている場合は、スクリプトプロパティに列名（例 M / AH）を入れれば変更できる。
 * 「-」を入れるとその項目は取り込まない（空欄になる）。
 */
const SRC_DEFAULT = {
  ORDER_NO:   'M',   // 受注番号
  CUSTOMER:   'N',   // 得意先
  ITEM:       'O',   // 品名
  SALES:      'D',   // 営業担当
  DUE:        'W',   // 納期
  GEHAN_PLAN: '-'    // 下版予定日の初期値に使う列（既定は使わない。例：AG＝下版日）
};
const SRC_PROP = {
  ORDER_NO:   'SRC_COL_ORDER_NO',
  CUSTOMER:   'SRC_COL_CUSTOMER',
  ITEM:       'SRC_COL_ITEM',
  SALES:      'SRC_COL_SALES',
  DUE:        'SRC_COL_DUE',
  GEHAN_PLAN: 'SRC_COL_GEHAN_PLAN'
};

/** 列名（A / M / AH）→ 列番号。空や「-」は 0（取り込まない）。 */
function colToIndex_(letter) {
  const s = String(letter === null || letter === undefined ? '' : letter).trim().toUpperCase();
  if (!s || s === '-' || s === 'なし') return 0;
  if (/^\d+$/.test(s)) return Number(s);
  if (!/^[A-Z]{1,2}$/.test(s)) throw new Error('列の指定が正しくありません：' + letter);
  let n = 0;
  for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
  return n;
}

/** 列番号 → 列名（表示用）。 */
function indexToCol_(n) {
  let s = '';
  let v = Number(n);
  while (v > 0) { const m = (v - 1) % 26; s = String.fromCharCode(65 + m) + s; v = Math.floor((v - m) / 26); }
  return s || '(なし)';
}

/** 現在の列マッピング（列番号）。 */
function srcCols_() {
  const out = {};
  Object.keys(SRC_DEFAULT).forEach(function (k) {
    out[k] = colToIndex_(getProp_(SRC_PROP[k], SRC_DEFAULT[k]));
  });
  return out;
}

/** 行データから指定列を取り出す（列が 0 のときは空文字）。 */
function pick_(row, colIndex) {
  return colIndex ? row[colIndex - 1] : '';
}

/** 工程定義。納品は予定日欄を持たないため、配置日は納期を使う。 */
const STAGES = [
  { key: 'gehan',    name: '下版', plan: COL.PLAN_GEHAN, done: COL.DONE_GEHAN },
  { key: 'print',    name: '印刷', plan: COL.PLAN_PRINT, done: COL.DONE_PRINT },
  { key: 'outer',    name: '外注', plan: COL.PLAN_OUTER, done: COL.DONE_OUTER },
  { key: 'komu',     name: '工務', plan: COL.PLAN_KOMU,  done: COL.DONE_KOMU },
  { key: 'delivery', name: '納品', plan: 0,              done: COL.DONE_DELIVERY }
];

const CATEGORY = { UNDECIDED: '未定', INSIDE: '社内', OUTSIDE: '社外', EXCLUDED: '対象外' };
const CATEGORIES = [CATEGORY.UNDECIDED, CATEGORY.INSIDE, CATEGORY.OUTSIDE, CATEGORY.EXCLUDED];

/** 区分ごとに追う工程。 */
function stagesFor_(category, skipOuter) {
  if (category === CATEGORY.INSIDE) {
    return STAGES.filter(function (s) { return !(s.key === 'outer' && skipOuter); });
  }
  if (category === CATEGORY.OUTSIDE) {
    return STAGES.filter(function (s) { return s.key === 'komu' || s.key === 'delivery'; });
  }
  return [];
}

// ---------------------------------------------------------------------------
// 共通ユーティリティ
// ---------------------------------------------------------------------------

function props_() {
  return PropertiesService.getScriptProperties();
}

function getProp_(key, fallback) {
  const v = props_().getProperty(key);
  return (v === null || v === '') ? fallback : v;
}

function productionSpreadsheetId_() {
  return getProp_('PRODUCTION_SS_ID', CONFIG.DEFAULT_PRODUCTION_SS_ID);
}

function staleDays_() {
  return Number(getProp_('UNDECIDED_STALE_DAYS', CONFIG.UNDECIDED_STALE_DAYS)) || CONFIG.UNDECIDED_STALE_DAYS;
}

/** 今日の日付を yyyy/MM/dd で返す。 */
function today_() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, CONFIG.DATE_FORMAT);
}

function nowStamp_() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy/MM/dd HH:mm');
}

/**
 * セル値を yyyy/MM/dd の文字列に正規化する。
 * シートを直接編集された場合（Date 型・yyyy-MM-dd・yyyy.MM.dd 等）も受け付ける。
 */
function toDateString_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    return Utilities.formatDate(v, CONFIG.TIMEZONE, CONFIG.DATE_FORMAT);
  }
  const s = String(v).trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (!m) return '';
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return Utilities.formatDate(new Date(y, mo - 1, d, 12, 0, 0), CONFIG.TIMEZONE, CONFIG.DATE_FORMAT);
}

function toText_(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return toDateString_(v);
  return String(v).trim();
}

function toBool_(v) {
  if (v === true) return true;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === '✓' || s === 'yes';
}

/** yyyy/MM/dd の2値の日数差（a - b）。どちらか空なら null。 */
function diffDays_(a, b) {
  if (!a || !b) return null;
  const pa = a.split('/'), pb = b.split('/');
  const da = Date.UTC(Number(pa[0]), Number(pa[1]) - 1, Number(pa[2]));
  const db = Date.UTC(Number(pb[0]), Number(pb[1]) - 1, Number(pb[2]));
  return Math.round((da - db) / 86400000);
}

// ---------------------------------------------------------------------------
// 権限
// ---------------------------------------------------------------------------

function getUserEmail_() {
  let email = '';
  try { email = Session.getActiveUser().getEmail() || ''; } catch (e) { email = ''; }
  if (!email) {
    try { email = Session.getEffectiveUser().getEmail() || ''; } catch (e) { email = ''; }
  }
  return email.toLowerCase();
}

function editorEmails_() {
  const raw = getProp_('EDITOR_EMAILS', '');
  return String(raw)
    .split(/[,\s;]+/)
    .map(function (s) { return s.trim().toLowerCase(); })
    .filter(function (s) { return !!s; });
}

function editorPin_() {
  return String(getProp_('EDITOR_PIN', '')).trim();
}

/**
 * 更新権限の判定。次のどちらかを満たせば編集者。
 *  1. 合言葉方式：スクリプトプロパティ EDITOR_PIN と一致する合言葉を画面で入力している
 *     （公開設定が「全員」などで、開いた人のメールアドレスが取得できない場合はこちらを使う）
 *  2. メール方式：Session.getActiveUser().getEmail() が EDITOR_EMAILS のリストにある
 *     （Google Workspace の「組織内」公開で有効。組織外の公開ではメールが空になり判定できない）
 * どちらも未設定のときは、暫定的にスクリプト所有者のみを編集者とする（画面に注意を出す）。
 */
function canEdit_(auth) {
  const pin = editorPin_();
  if (pin && auth && String(auth.pin || '').trim() === pin) return true;

  const me = getUserEmail_();
  if (!me) return false;
  const list = editorEmails_();
  if (list.length === 0) {
    if (pin) return false;   // 合言葉運用中は、合言葉なしの所有者フォールバックはしない
    let owner = '';
    try { owner = (Session.getEffectiveUser().getEmail() || '').toLowerCase(); } catch (e) { owner = ''; }
    return !!owner && owner === me;
  }
  return list.indexOf(me) >= 0;
}

function assertEditor_(auth) {
  if (!canEdit_(auth)) {
    throw new Error(editorPin_()
      ? '更新権限がありません。画面右上の「編集モード」から合言葉を入力してください。'
      : '更新権限がありません。工務担当者のアカウントでアクセスしてください。');
  }
}

// ---------------------------------------------------------------------------
// フェーズ1：シート作成 / 取込
// ---------------------------------------------------------------------------

function openProductionSpreadsheet_() {
  return SpreadsheetApp.openById(productionSpreadsheetId_());
}

/** 生産表の「一番右のシート」＝最新。 */
function latestProductionSheet_(ss) {
  const sheets = ss.getSheets().filter(function (sh) {
    return sh.getName() !== CONFIG.BOARD_SHEET_NAME && !sh.isSheetHidden();
  });
  if (sheets.length === 0) throw new Error('生産表のシートが見つかりません。');
  return sheets[sheets.length - 1];
}

/** `進行ボード` シートを取得。無ければ作成する。 */
function getBoardSheet_() {
  const ss = openProductionSpreadsheet_();
  let sh = ss.getSheetByName(CONFIG.BOARD_SHEET_NAME);
  if (!sh) sh = createBoardSheet_(ss);
  return sh;
}

function createBoardSheet_(ss) {
  const sh = ss.insertSheet(CONFIG.BOARD_SHEET_NAME, 0);
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
    .setFontWeight('bold')
    .setBackground('#e8eef7');
  sh.setFrozenRows(1);
  sh.setFrozenColumns(1);

  // 日付列はタイムゾーンのずれを避けるためプレーンテキストで保持する（すべて yyyy/MM/dd）。
  const dateCols = [COL.DUE, COL.PLAN_GEHAN, COL.DONE_GEHAN, COL.PLAN_PRINT, COL.DONE_PRINT,
    COL.PLAN_OUTER, COL.DONE_OUTER, COL.PLAN_KOMU, COL.DONE_KOMU, COL.DONE_DELIVERY,
    COL.CATEGORY_FIXED_AT];
  dateCols.forEach(function (c) {
    sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('@');
  });
  sh.getRange(1, COL.ORDER_NO, sh.getMaxRows(), 1).setNumberFormat('@');

  applyBoardValidations_(sh);

  sh.setColumnWidth(COL.ORDER_NO, 110);
  sh.setColumnWidth(COL.CUSTOMER, 160);
  sh.setColumnWidth(COL.ITEM, 220);
  sh.setColumnWidth(COL.MEMO, 220);
  return sh;
}

/**
 * 区分・外注スキップの入力規則（シートを直接編集するときの逃げ道）。
 * insertCheckboxes() は範囲内の全セルに FALSE を書き込んでしまい、
 * getLastRow() が最終行まで伸びる（＝追記位置がずれる）ため、入力規則だけを付ける。
 */
function applyBoardValidations_(sh) {
  const rows = sh.getMaxRows() - 1;
  const catRule = SpreadsheetApp.newDataValidation().requireValueInList(CATEGORIES, true).build();
  sh.getRange(2, COL.CATEGORY, rows, 1).setDataValidation(catRule);
  const checkRule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  sh.getRange(2, COL.SKIP_OUTER, rows, 1).setDataValidation(checkRule);
}

/**
 * 受注NO（A列）が入っている最後の行。データが無ければ 1 を返す。
 * チェックボックスや書式だけの空行に引きずられないよう、getLastRow() ではなくA列で判断する。
 */
function boardLastDataRow_(sh) {
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return 1;
  const col = sh.getRange(2, COL.ORDER_NO, lastRow - 1, 1).getValues();
  for (let i = col.length - 1; i >= 0; i--) {
    if (toText_(col[i][0]) !== '') return i + 2;
  }
  return 1;
}

/** 手動セットアップ用。シートを作るだけ。 */
function setupBoardSheet() {
  const sh = getBoardSheet_();
  return '「' + sh.getName() + '」シートを用意しました。';
}

/**
 * 生産表 → 進行ボード の取込。
 * - 受注NOが未登録の行を追記（A〜E列のみ）
 * - 既存行は B〜E 列だけ生産表に追随（F列以降は絶対に触らない）
 */
function importFromProductionSheet() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.LOCK_WAIT_MS)) {
    throw new Error('他の処理が実行中です。しばらく待ってからやり直してください。');
  }
  try {
    const ss = openProductionSpreadsheet_();
    const src = latestProductionSheet_(ss);
    const board = ss.getSheetByName(CONFIG.BOARD_SHEET_NAME) || createBoardSheet_(ss);

    const headerRows = Number(getProp_('PRODUCTION_HEADER_ROWS', CONFIG.PRODUCTION_HEADER_ROWS));
    const cols = srcCols_();
    const maxCol = Math.max(cols.ORDER_NO, cols.CUSTOMER, cols.ITEM, cols.SALES, cols.DUE, cols.GEHAN_PLAN);
    if (!cols.ORDER_NO) throw new Error('受注番号の列が設定されていません。');
    const srcLastRow = src.getLastRow();
    const srcRows = srcLastRow > headerRows
      ? src.getRange(headerRows + 1, 1, srcLastRow - headerRows, maxCol).getValues()
      : [];

    const boardDataLastRow = boardLastDataRow_(board);
    const boardRows = boardDataLastRow > 1
      ? board.getRange(2, 1, boardDataLastRow - 1, LAST_COL).getValues()
      : [];

    const indexByOrderNo = {};
    boardRows.forEach(function (r, i) {
      const key = toText_(r[COL.ORDER_NO - 1]);
      if (key && indexByOrderNo[key] === undefined) indexByOrderNo[key] = i; // 先勝ち（重複追加しない）
    });

    const appends = [];
    const updates = [];   // {row, values:[得意先, 品名, 営業, 納期]}
    const seen = {};

    srcRows.forEach(function (r) {
      const orderNo = toText_(pick_(r, cols.ORDER_NO));
      if (!orderNo) return;
      if (seen[orderNo]) return;
      seen[orderNo] = true;

      const customer = toText_(pick_(r, cols.CUSTOMER));
      const item = toText_(pick_(r, cols.ITEM));
      const sales = toText_(pick_(r, cols.SALES));
      const due = toDateString_(pick_(r, cols.DUE));

      const idx = indexByOrderNo[orderNo];
      if (idx === undefined) {
        const row = new Array(LAST_COL).fill('');
        row[COL.ORDER_NO - 1] = orderNo;
        row[COL.CUSTOMER - 1] = customer;
        row[COL.ITEM - 1] = item;
        row[COL.SALES - 1] = sales;
        row[COL.DUE - 1] = due;
        // 生産表側に下版の予定が組まれている場合のみ、新規行の下版予定日に写す。
        // （既存行の F列以降は取込では一切書き換えない）
        if (cols.GEHAN_PLAN) row[COL.PLAN_GEHAN - 1] = toDateString_(pick_(r, cols.GEHAN_PLAN));
        row[COL.SKIP_OUTER - 1] = false;
        row[COL.CATEGORY - 1] = CATEGORY.UNDECIDED;
        row[COL.UPDATED_AT - 1] = nowStamp_();
        appends.push(row);
      } else {
        const cur = boardRows[idx];
        const curCustomer = toText_(cur[COL.CUSTOMER - 1]);
        const curItem = toText_(cur[COL.ITEM - 1]);
        const curSales = toText_(cur[COL.SALES - 1]);
        const curDue = toDateString_(cur[COL.DUE - 1]);
        if (curCustomer !== customer || curItem !== item || curSales !== sales || curDue !== due) {
          updates.push({ row: idx + 2, values: [customer, item, sales, due] });
        }
      }
    });

    // 差分だけ書く（実行時間対策）。
    updates.forEach(function (u) {
      board.getRange(u.row, COL.CUSTOMER, 1, 4).setValues([u.values]);
      board.getRange(u.row, COL.UPDATED_AT).setValue(nowStamp_());
    });
    if (appends.length > 0) {
      const start = boardDataLastRow + 1;
      const needRows = start + appends.length - 1 - board.getMaxRows();
      if (needRows > 0) board.insertRowsAfter(board.getMaxRows(), needRows);
      board.getRange(start, 1, appends.length, LAST_COL).setValues(appends);
    }

    props_().setProperty('LAST_IMPORT_AT', nowStamp_());
    const result = { added: appends.length, updated: updates.length, at: nowStamp_() };
    console.log('取込完了: 新規 %s 件 / 更新 %s 件', result.added, result.updated);
    return result;
  } finally {
    lock.releaseLock();
  }
}

/** 毎朝8時の取込トリガーを作成（重複作成しない）。 */
function createDailyImportTrigger() {
  deleteImportTriggers();
  ScriptApp.newTrigger('importFromProductionSheet')
    .timeBased()
    .atHour(CONFIG.IMPORT_TRIGGER_HOUR)
    .nearMinute(0)
    .everyDays(1)
    .inTimezone(CONFIG.TIMEZONE)
    .create();
  return '毎朝' + CONFIG.IMPORT_TRIGGER_HOUR + '時の取込トリガーを設定しました。';
}

function deleteImportTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'importFromProductionSheet') ScriptApp.deleteTrigger(t);
  });
}

/**
 * 取込がうまくいかないときの調査用。実行ログに状況を書き出す。
 */
function diagnoseImport() {
  const ss = openProductionSpreadsheet_();
  const headerRows = Number(getProp_('PRODUCTION_HEADER_ROWS', CONFIG.PRODUCTION_HEADER_ROWS));
  const cols = srcCols_();
  const lines = [];
  lines.push('スプレッドシート：' + ss.getName());
  lines.push('シート（左から）：' + ss.getSheets().map(function (sh) {
    return sh.getName() + (sh.isSheetHidden() ? '（非表示）' : '');
  }).join('  /  '));

  const src = latestProductionSheet_(ss);
  lines.push('取込対象に選ばれたシート：' + src.getName());
  lines.push('そのシートの最終行：' + src.getLastRow() + '　／　見出し行数の設定：' + headerRows);
  lines.push('読んでいる列：受注NO=' + indexToCol_(cols.ORDER_NO) +
    '　得意先=' + indexToCol_(cols.CUSTOMER) +
    '　品名=' + indexToCol_(cols.ITEM) +
    '　営業担当=' + indexToCol_(cols.SALES) +
    '　納期=' + indexToCol_(cols.DUE) +
    '　下版予定日=' + indexToCol_(cols.GEHAN_PLAN));

  const maxCol = Math.max(cols.ORDER_NO, cols.CUSTOMER, cols.ITEM, cols.SALES, cols.DUE, cols.GEHAN_PLAN, 1);
  const width = Math.min(Math.max(maxCol, 1), src.getMaxColumns());

  // 見出しが複数行に分かれている生産表があるため、見出し行はすべて、シートの右端まで書き出す
  // （どの列を指定すればよいか、このログだけで分かるようにするため）。
  const headerWidth = Math.max(src.getLastColumn(), width);
  for (let hr = 1; hr <= headerRows && hr <= src.getLastRow(); hr++) {
    const header = src.getRange(hr, 1, 1, headerWidth).getValues()[0];
    const named = [];
    header.forEach(function (v, i) {
      const t = toText_(v);
      if (t) named.push(indexToCol_(i + 1) + '=' + t);
    });
    if (named.length > 0) lines.push('見出し ' + hr + '行目：' + named.join('  '));
  }

  const lastRow = src.getLastRow();
  if (lastRow > headerRows) {
    const rows = src.getRange(headerRows + 1, 1, Math.min(3, lastRow - headerRows), width).getValues();
    lines.push('この設定で読み取れる先頭' + rows.length + '行：');
    rows.forEach(function (r, i) {
      lines.push('  ' + (headerRows + 1 + i) + '行目：' +
        ' 受注NO=「' + toText_(pick_(r, cols.ORDER_NO)) + '」' +
        ' 得意先=「' + toText_(pick_(r, cols.CUSTOMER)) + '」' +
        ' 品名=「' + toText_(pick_(r, cols.ITEM)) + '」' +
        ' 営業担当=「' + toText_(pick_(r, cols.SALES)) + '」' +
        ' 納期=「' + toDateString_(pick_(r, cols.DUE)) + '」' +
        (cols.GEHAN_PLAN ? ' 下版予定日=「' + toDateString_(pick_(r, cols.GEHAN_PLAN)) + '」' : ''));
    });
    const all = src.getRange(headerRows + 1, cols.ORDER_NO, lastRow - headerRows, 1).getValues();
    const withNo = all.filter(function (r) { return toText_(r[0]) !== ''; }).length;
    lines.push('受注NOが入っている行数：' + withNo + ' 行');
    if (withNo === 0) {
      lines.push('  → 指定した列に受注NOがありません。スクリプトプロパティ ' +
        SRC_PROP.ORDER_NO + ' に正しい列名を設定してください。');
    }
  } else {
    lines.push('  → 見出し行より下にデータがありません。見出し行数かシートの選択を確認してください。');
  }

  const board = ss.getSheetByName(CONFIG.BOARD_SHEET_NAME);
  if (!board) {
    lines.push('進行ボードシート：まだありません（setupBoardSheet を実行してください）');
  } else {
    lines.push('進行ボードシート：最終行 ' + board.getLastRow() +
      '　／　案件が入っている最終行 ' + boardLastDataRow_(board));
  }

  const msg = lines.join('\n');
  console.log(msg);
  return msg;
}

/**
 * 進行ボードシートの並びを整える。
 * 空行をつめて2行目から並べ直し、入力規則を付け直す。
 * （案件が1000行目付近から始まってしまった場合の復旧用。入力済みの日付は保持される）
 */
function repairBoardSheet() {
  return withLock_(function () {
    const ss = openProductionSpreadsheet_();
    const sh = ss.getSheetByName(CONFIG.BOARD_SHEET_NAME);
    if (!sh) throw new Error('進行ボードシートがありません。先に setupBoardSheet を実行してください。');
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return '並べ直す案件がありません。';

    const values = sh.getRange(2, 1, lastRow - 1, LAST_COL).getValues();
    const kept = values.filter(function (r) { return toText_(r[COL.ORDER_NO - 1]) !== ''; });

    sh.getRange(2, 1, lastRow - 1, LAST_COL).clearContent();
    sh.getRange(2, 1, lastRow - 1, LAST_COL).clearDataValidations();
    if (kept.length > 0) sh.getRange(2, 1, kept.length, LAST_COL).setValues(kept);
    applyBoardValidations_(sh);

    const msg = kept.length + ' 件を2行目から並べ直しました。';
    console.log(msg);
    return msg;
  });
}

/** スプレッドシートを開いたときのメニュー（画面が使えないときの逃げ道）。 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('進行ボード')
    .addItem('進行ボードシートを作成', 'setupBoardSheet')
    .addItem('いま取込む', 'importFromProductionSheet')
    .addSeparator()
    .addItem('毎朝の取込トリガーを設定', 'createDailyImportTrigger')
    .addSeparator()
    .addItem('取込を診断する', 'diagnoseImport')
    .addItem('シートの並びを整える', 'repairBoardSheet')
    .addToUi();
}

// ---------------------------------------------------------------------------
// フェーズ2：画面へ渡すデータ
// ---------------------------------------------------------------------------

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('印刷進行ボード')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFile(filename).getContent();
}

/** 1行分のシート値 → 画面用オブジェクト。 */
function buildRecord_(values, rowNumber, todayStr) {
  const category = toText_(values[COL.CATEGORY - 1]) || CATEGORY.UNDECIDED;
  const skipOuter = toBool_(values[COL.SKIP_OUTER - 1]);
  const due = toDateString_(values[COL.DUE - 1]);

  const plans = {};
  const dones = {};
  STAGES.forEach(function (s) {
    plans[s.key] = s.plan ? toDateString_(values[s.plan - 1]) : '';
    dones[s.key] = toDateString_(values[s.done - 1]);
  });

  const stages = stagesFor_(category, skipOuter);
  let currentKey = '';
  let currentName = '';
  for (let i = 0; i < stages.length; i++) {
    if (!dones[stages[i].key]) { currentKey = stages[i].key; currentName = stages[i].name; break; }
  }
  const delivered = dones.delivery;
  const isCompleted = !!delivered;
  // 納品工程には予定日欄が無いため、配置日は納期を使う。
  const placeDate = currentKey ? (currentKey === 'delivery' ? due : plans[currentKey]) : '';

  const warnings = [];
  if (!isCompleted && currentKey) {
    if (placeDate && due && diffDays_(placeDate, due) > 0) warnings.push('納期超過');
    if (placeDate && diffDays_(placeDate, todayStr) < 0) warnings.push('予定日超過');
  }

  const categoryFixedAt = toDateString_(values[COL.CATEGORY_FIXED_AT - 1]);
  let undecidedDays = null;
  if (category === CATEGORY.UNDECIDED) {
    const since = toText_(values[COL.UPDATED_AT - 1]).split(' ')[0];
    undecidedDays = diffDays_(todayStr, toDateString_(since));
  }

  return {
    row: rowNumber,
    orderNo: toText_(values[COL.ORDER_NO - 1]),
    customer: toText_(values[COL.CUSTOMER - 1]),
    item: toText_(values[COL.ITEM - 1]),
    sales: toText_(values[COL.SALES - 1]),
    due: due,
    plans: plans,
    dones: dones,
    memo: toText_(values[COL.MEMO - 1]),
    skipOuter: skipOuter,
    category: category,
    categoryFixedAt: categoryFixedAt,
    updatedAt: toText_(values[COL.UPDATED_AT - 1]),
    currentStage: currentKey,
    currentStageName: currentName || (isCompleted ? '納品済' : ''),
    placeDate: placeDate,
    isCompleted: isCompleted,
    deliveredAt: delivered,
    warnings: warnings,
    undecidedDays: undecidedDays
  };
}

/**
 * 画面用データ一式。
 * - 対象外：編集者が明示的に要求したときだけ含める
 * - 納品完了から7日を超えた案件：常に除外
 */
function getBoardData(options) {
  const opts = options || {};
  const sh = getBoardSheet_();
  const todayStr = today_();
  const editable = canEdit_(opts);

  const lastRow = boardLastDataRow_(sh);
  const values = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, LAST_COL).getValues() : [];

  const rows = [];
  values.forEach(function (v, i) {
    const orderNo = toText_(v[COL.ORDER_NO - 1]);
    if (!orderNo) return;
    const rec = buildRecord_(v, i + 2, todayStr);
    if (rec.category === CATEGORY.EXCLUDED && !(editable && opts.includeExcluded)) return;
    if (rec.isCompleted) {
      const d = diffDays_(todayStr, rec.deliveredAt);
      if (d === null || d > CONFIG.COMPLETED_VISIBLE_DAYS) return;
    }
    rows.push(rec);
  });

  return {
    rows: rows,
    today: todayStr,
    canEdit: editable,
    userEmail: getUserEmail_(),
    authConfigured: editorEmails_().length > 0 || !!editorPin_(),
    pinConfigured: !!editorPin_(),
    staleDays: staleDays_(),
    completedVisibleDays: CONFIG.COMPLETED_VISIBLE_DAYS,
    lastImportAt: getProp_('LAST_IMPORT_AT', ''),
    fetchedAt: nowStamp_(),
    categories: CATEGORIES,
    stages: STAGES.map(function (s) { return { key: s.key, name: s.name, hasPlan: !!s.plan }; })
  };
}

// ---------------------------------------------------------------------------
// フェーズ3：操作
// ---------------------------------------------------------------------------

/** 受注NO から行番号を引く。 */
function findRow_(sh, orderNo) {
  const lastRow = boardLastDataRow_(sh);
  if (lastRow < 2) return 0;
  const col = sh.getRange(2, COL.ORDER_NO, lastRow - 1, 1).getValues();
  const key = String(orderNo).trim();
  for (let i = 0; i < col.length; i++) {
    if (toText_(col[i][0]) === key) return i + 2;
  }
  return 0;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.LOCK_WAIT_MS)) {
    throw new Error('他の処理が実行中です。数秒おいてやり直してください。');
  }
  try { return fn(); } finally { lock.releaseLock(); }
}

function touch_(sh, row) {
  sh.getRange(row, COL.UPDATED_AT).setValue(nowStamp_());
}

/** 画面上部の手動取込ボタン。 */
function runImportNow(auth) {
  assertEditor_(auth);
  const result = importFromProductionSheet();
  return { message: '取込完了：新規 ' + result.added + ' 件／更新 ' + result.updated + ' 件', result: result };
}

/** 区分の確定・変更。未定から他へ変わったときに区分確定日を入れる。 */
function setCategory(orderNo, category, auth) {
  assertEditor_(auth);
  if (CATEGORIES.indexOf(category) < 0) throw new Error('区分の値が不正です：' + category);
  return withLock_(function () {
    const sh = getBoardSheet_();
    const row = findRow_(sh, orderNo);
    if (!row) throw new Error('受注NO ' + orderNo + ' が見つかりません。');
    const before = toText_(sh.getRange(row, COL.CATEGORY).getValue()) || CATEGORY.UNDECIDED;
    sh.getRange(row, COL.CATEGORY).setValue(category);
    if (before === CATEGORY.UNDECIDED && category !== CATEGORY.UNDECIDED) {
      sh.getRange(row, COL.CATEGORY_FIXED_AT).setValue(today_());
    }
    if (category === CATEGORY.UNDECIDED) {
      sh.getRange(row, COL.CATEGORY_FIXED_AT).setValue('');
    }
    if (category !== CATEGORY.INSIDE) {
      // 外注スキップは社内区分でのみ有効。
      sh.getRange(row, COL.SKIP_OUTER).setValue(false);
    }
    touch_(sh, row);
    return { orderNo: orderNo, category: category };
  });
}

/** 「完了 →」ボタン。現在工程の完了日に今日を入れる。取消用トークンを返す。 */
function completeCurrentStage(orderNo, auth) {
  assertEditor_(auth);
  return withLock_(function () {
    const sh = getBoardSheet_();
    const row = findRow_(sh, orderNo);
    if (!row) throw new Error('受注NO ' + orderNo + ' が見つかりません。');
    const values = sh.getRange(row, 1, 1, LAST_COL).getValues()[0];
    const rec = buildRecord_(values, row, today_());
    if (!rec.currentStage) {
      throw new Error(rec.category === CATEGORY.UNDECIDED
        ? 'この案件はまだ区分が未定です。先に 社内／社外 を選んでください。'
        : 'この案件はすでに納品済です。');
    }
    const stage = STAGES.filter(function (s) { return s.key === rec.currentStage; })[0];
    const prev = toText_(values[stage.done - 1]);
    sh.getRange(row, stage.done).setValue(today_());
    touch_(sh, row);
    return {
      orderNo: orderNo,
      stageKey: stage.key,
      stageName: stage.name,
      column: stage.done,
      previous: prev
    };
  });
}

/** 直前の完了操作の取消（1回だけ）。 */
function undoComplete(token, auth) {
  assertEditor_(auth);
  if (!token || !token.orderNo || !token.column) throw new Error('取消できる操作がありません。');
  const doneCols = STAGES.map(function (s) { return s.done; });
  if (doneCols.indexOf(Number(token.column)) < 0) throw new Error('取消対象が不正です。');
  return withLock_(function () {
    const sh = getBoardSheet_();
    const row = findRow_(sh, token.orderNo);
    if (!row) throw new Error('受注NO ' + token.orderNo + ' が見つかりません。');
    sh.getRange(row, Number(token.column)).setValue(token.previous || '');
    touch_(sh, row);
    return { orderNo: token.orderNo, stageName: token.stageName };
  });
}

/**
 * 編集パネルの保存。
 * patch: { plans:{key:date}, dones:{key:date}, memo, skipOuter, category }
 * 日付は yyyy-MM-dd / yyyy/MM/dd のどちらでも受け付け、yyyy/MM/dd で保存する。
 */
function saveRow(orderNo, patch, auth) {
  assertEditor_(auth);
  const p = patch || {};
  return withLock_(function () {
    const sh = getBoardSheet_();
    const row = findRow_(sh, orderNo);
    if (!row) throw new Error('受注NO ' + orderNo + ' が見つかりません。');

    const before = sh.getRange(row, 1, 1, LAST_COL).getValues()[0];
    const beforeCategory = toText_(before[COL.CATEGORY - 1]) || CATEGORY.UNDECIDED;

    STAGES.forEach(function (s) {
      if (s.plan && p.plans && p.plans.hasOwnProperty(s.key)) {
        sh.getRange(row, s.plan).setValue(normalizeInputDate_(p.plans[s.key]));
      }
      if (p.dones && p.dones.hasOwnProperty(s.key)) {
        sh.getRange(row, s.done).setValue(normalizeInputDate_(p.dones[s.key]));
      }
    });
    if (p.hasOwnProperty('memo')) {
      sh.getRange(row, COL.MEMO).setValue(String(p.memo || '').replace(/[\r\n]+/g, ' ').trim());
    }
    let category = beforeCategory;
    if (p.hasOwnProperty('category') && p.category) {
      if (CATEGORIES.indexOf(p.category) < 0) throw new Error('区分の値が不正です：' + p.category);
      category = p.category;
      sh.getRange(row, COL.CATEGORY).setValue(category);
      if (beforeCategory === CATEGORY.UNDECIDED && category !== CATEGORY.UNDECIDED) {
        sh.getRange(row, COL.CATEGORY_FIXED_AT).setValue(today_());
      }
      if (category === CATEGORY.UNDECIDED) {
        sh.getRange(row, COL.CATEGORY_FIXED_AT).setValue('');
      }
    }
    if (p.hasOwnProperty('skipOuter')) {
      // 外注スキップは社内区分でのみ有効。
      sh.getRange(row, COL.SKIP_OUTER).setValue(category === CATEGORY.INSIDE ? !!p.skipOuter : false);
    }
    touch_(sh, row);

    const after = sh.getRange(row, 1, 1, LAST_COL).getValues()[0];
    return buildRecord_(after, row, today_());
  });
}

function normalizeInputDate_(v) {
  const s = toDateString_(v);
  return s;
}
