/**
 * 制作進行ボード — サーバーサイド
 * 外為印刷 電算編集室
 *
 * 仕様書「制作進行ボード 仕様書」（docs/仕様書.md）に基づく実装。
 *
 * - 生産表（月別シート）と紀要「進行中」シートは読むだけ。絶対に書き込まない。
 * - 書き込み先は `制作進行`・`論文明細`・`担当者メモ` の3シートのみ（生産表と同じスプレッドシート内、左端に作る）。
 * - 印刷進行ボード（shinko-board/）とは別の Apps Script プロジェクト。
 *   生産表の列マッピングは、このファイルの SRC_DEFAULT / STAFF_DEFAULT / OUTPUT_RULES_DEFAULT に1か所にまとめてある。
 */

/** 固定値。運用で変わりうるものはスクリプトプロパティで上書きできる。 */
const CONFIG = {
  DEFAULT_PRODUCTION_SS_ID: '1yW4WyORgmAAzy-Clh6kafRK598pyY-Ee3OScoDXL1-A',
  DEFAULT_KIYO_SS_ID: '1XX7terJgMR8euzSTUT07u9wY-Bht5-ih3j_ae6S_LmY',
  DEFAULT_KIYO_SHEET_NAME: '進行中',
  BOARD_SHEET_NAME: '制作進行',
  PAPER_SHEET_NAME: '論文明細',
  NOTE_SHEET_NAME: '担当者メモ',
  OTHER_BOARD_SHEET_NAME: '進行ボード',   // 印刷進行ボードのデータシート。生産表として読まないための除外用
  TIMEZONE: 'Asia/Tokyo',
  DATE_FORMAT: 'yyyy/MM/dd',
  PRODUCTION_HEADER_ROWS: 3,   // 生産表の見出し行数（1行目=表題 2行目=工程見出し 3行目=項目名）
  DEFAULT_CATEGORY_FILTER: '冊子',   // AI列「大分類」がこれを含む行だけ載せる。「-」で無効
  LOCK_WAIT_MS: 20000,
  IMPORT_TRIGGER_HOUR: 8
};

// ---------------------------------------------------------------------------
// 生産表の列マッピング（ここが唯一の定義。印刷進行ボードと同じ名前・同じ既定値）
// ---------------------------------------------------------------------------

/**
 * 生産表のどの列を読むか。既定値は 2026年9月シートの構成。
 * 列がずれている場合は、スクリプトプロパティ（SRC_PROP の名前）に列名（例 M / AG）を入れれば変更できる。
 * 「-」を入れるとその項目は取り込まない（空欄になる）。
 */
const SRC_DEFAULT = {
  ORDER_NO:  'M',   // 受注番号（主キー。未採番は「？？？」）
  CUSTOMER:  'N',   // 得意先
  ITEM:      'O',   // 品名
  SALES:     'D',   // 営業担当
  DUE:       'W',   // 納期
  OUTPUT:    'S',   // 出力（CTP／オンデマンド／PDF）
  PRINT:     'T',   // 刷り（篠原／小森／オンデ）
  CATEGORY:  'AI',  // 大分類（冊子／端物）
  NYUKO:     'Z',   // 入稿日
  SHOKO_OUT: 'AA',  // 初校提出
  SHOKO_IN:  'AB',  // 初校戻り
  SAIKO_OUT: 'AC',  // 再校提出
  SAIKO_IN:  'AD',  // 再校戻り
  SANKO_OUT: 'AE',  // 三校提出
  SANKO_IN:  'AF',  // 三校戻り
  GEHAN:     'AG'   // 下版日
};
const SRC_PROP = {
  ORDER_NO:  'SRC_COL_ORDER_NO',
  CUSTOMER:  'SRC_COL_CUSTOMER',
  ITEM:      'SRC_COL_ITEM',
  SALES:     'SRC_COL_SALES',
  DUE:       'SRC_COL_DUE',
  OUTPUT:    'SRC_COL_OUTPUT',
  PRINT:     'SRC_COL_PRINT',
  CATEGORY:  'SRC_COL_CATEGORY',
  NYUKO:     'SRC_COL_NYUKO',
  SHOKO_OUT: 'SRC_COL_SHOKO_OUT',
  SHOKO_IN:  'SRC_COL_SHOKO_IN',
  SAIKO_OUT: 'SRC_COL_SAIKO_OUT',
  SAIKO_IN:  'SRC_COL_SAIKO_IN',
  SANKO_OUT: 'SRC_COL_SANKO_OUT',
  SANKO_IN:  'SRC_COL_SANKO_IN',
  GEHAN:     'SRC_COL_GEHAN'
};

/** 工程日付の並び（左→右）。「日付が入っている一番右の工程」で状態を決める。 */
const STAGES = [
  { key: 'NYUKO',     name: '入稿' },
  { key: 'SHOKO_OUT', name: '初校提出' },
  { key: 'SHOKO_IN',  name: '初校戻り' },
  { key: 'SAIKO_OUT', name: '再校提出' },
  { key: 'SAIKO_IN',  name: '再校戻り' },
  { key: 'SANKO_OUT', name: '三校提出' },
  { key: 'SANKO_IN',  name: '三校戻り' },
  { key: 'GEHAN',     name: '下版' }
];

/**
 * 担当者の列。「列=名前:区分」をカンマ区切り。スクリプトプロパティ STAFF_COLUMNS で変更できる。
 * セルに値（分の数値でも ★ でも）が入っていればその人が担当者。背景色では判定しない（条件付き書式のため）。
 */
const STAFF_DEFAULT = 'E=和泉:DTP,F=高橋:DTP,G=野澤:DTP,H=鈴木:DTP,I=派遣:編集,J=磯網:編集,K=橋本:編集,L=菅井:編集';

/**
 * 出力区分の判定表（上から順に最初に当たったもの）。スクリプトプロパティ OUTPUT_RULES にJSONで入れると変更できる。
 * col は SRC_DEFAULT のキー（OUTPUT / PRINT）または列名、match は正規表現（大文字小文字は区別しない）。
 * 仕様書の3行に加え、S列が CTP の行も「オフ」とする行を末尾に足してある（T列が空のときの保険）。
 */
const OUTPUT_RULES_DEFAULT = JSON.stringify([
  { col: 'PRINT',  match: '篠原|小森', label: 'オフ' },
  { col: 'OUTPUT', match: 'オンデ',    label: 'オンデ' },
  { col: 'OUTPUT', match: 'PDF',       label: 'データ' },
  { col: 'OUTPUT', match: 'CTP',       label: 'オフ' }
]);

/**
 * 紀要「進行中」シートの列（2026年9月の実物で確認）。
 * 1行目が見出し：A=論文名 B=著者名 C=ページ数 D=抜刷 E=送付方法 F=入稿日 G=担当者 H=アプリ I=渡した日
 * J=初校希望 K=組上がり L/M=初校（提出/戻り） N/O=再校 P/Q=三校 R/S=念校 T=備考。
 * 案件の見出し行はA列に「芸術学研究 第36号【22776-000】」のように【受注番号】が入る。
 * 校了／責了 は次の校の列にそのまま書かれる（専用列は無い）。列はスクリプトプロパティで変更できる。
 */
const KIYO_DEFAULT = {
  TITLE:  'A',     // 論文名
  AUTHOR: 'B',     // 著者名
  STATUS: '-',     // 校了／責了 が入る専用列があればその列。無ければ「-」（各校の列に書かれている前提）
  STAGES: 'F=入稿,K=組上がり,L=初校提出,M=初校戻り,N=再校提出,O=再校戻り,P=三校提出,Q=三校戻り,R=念校提出,S=念校戻り',
  DONE_WORDS: '校了,責了',   // これが入っている論文は完了扱い
  // 【受注番号】が無い見出し行（例「教養論集588」）を拾うための正規表現。論文名の1行目に対して、
  // 著者も各校の日付も無い行にだけ適用する。空にすると【受注番号】だけで見出しを判定する。
  HEADING_PATTERN: '(号|集|巻|輯|\\d)\\s*$'
};
/** 見出し行の【受注番号】。論文名にも【タテ】【翻訳】のような分類タグが付くため、中身が番号のときだけ見出しとみなす。 */
const ORDER_IN_BRACKETS_RE = /【\s*(\d{4,}(?:-\d+)?)\s*】/;
const KIYO_PROP = {
  TITLE: 'KIYO_COL_TITLE', AUTHOR: 'KIYO_COL_AUTHOR', STATUS: 'KIYO_COL_STATUS',
  STAGES: 'KIYO_STAGE_COLS', DONE_WORDS: 'KIYO_DONE_WORDS', HEADING_PATTERN: 'KIYO_HEADING_PATTERN'
};
const KIYO_EMPTY_LABEL = '未提出';

// ---------------------------------------------------------------------------
// データシートの列
// ---------------------------------------------------------------------------

/** `制作進行` シートの列（1始まり）。A〜S は仕様書12章のとおり、T〜W は実装で追加。 */
const COL = {
  KEY: 1,             // A キー（受注番号 or 仮キー）※追記位置の判定はこの列の最終行
  ORDER_NO: 2,        // B 受注番号
  CUSTOMER: 3,        // C 得意先
  ITEM: 4,            // D 品名
  SALES: 5,           // E 営業担当
  DTP: 6,             // F DTP担当（カンマ区切り）
  EDIT: 7,            // G 編集担当（カンマ区切り）
  STATUS: 8,          // H 状態（自動判定）
  STATUS_MANUAL: 9,   // I 状態（手動）
  GEHAN: 10,          // J 下版予定日（生産表AG列）
  GEHAN_MANUAL: 11,   // K 下版予定日（手動）
  OUTPUT: 12,         // L 出力区分（自動判定）
  OUTPUT_MANUAL: 13,  // M 出力区分（手動）
  RECENT: 14,         // N 直近の動き（工程名＋日付）
  MEMO: 15,           // O メモ
  MANUAL_BY: 16,      // P 手動更新者
  MANUAL_AT: 17,      // Q 手動更新日時
  IMPORTED_AT: 18,    // R 取込日時
  DONE_DATE: 19,      // S 完了日（下版日）
  DUE: 20,            // T 納期（生産表W列）
  DTP_MANUAL: 21,     // U DTP担当（手動）
  EDIT_MANUAL: 22,    // V 編集担当（手動）
  MANUAL_FIELDS: 23   // W 手動更新の項目（status,date,output,staff のうち手で直したもの）
};
const LAST_COL = COL.MANUAL_FIELDS;
const HEADERS = [
  'キー', '受注番号', '得意先', '品名', '営業担当', 'DTP担当', '編集担当',
  '状態', '状態（手動）', '下版予定日', '下版予定日（手動）', '出力区分', '出力区分（手動）',
  '直近の動き', 'メモ', '手動更新者', '手動更新日時', '取込日時', '完了日',
  '納期', 'DTP担当（手動）', '編集担当（手動）', '手動更新の項目'
];

/** `論文明細` シートの列。 */
const PCOL = { ORDER_NO: 1, TITLE: 2, AUTHOR: 3, STATUS: 4, DATE: 5, IMPORTED_AT: 6 };
const PAPER_LAST_COL = PCOL.IMPORTED_AT;
const PAPER_HEADERS = ['受注番号', '論文名', '著者名', '状態', '直近の日付', '取込日時'];

/** `担当者メモ` シートの列。 */
const NCOL = { NAME: 1, NOTE: 2 };
const NOTE_HEADERS = ['担当者名', '注記'];

const STATUS = { NOT_YET: '未入稿', WORKING: '作業中', PROOF: '校正中', DONE: '下版済' };
const STATUSES = [STATUS.NOT_YET, STATUS.WORKING, STATUS.PROOF, STATUS.DONE];

/** 手動で直せる項目（項目単位で取込との衝突を制御する）。 */
const MANUAL_FIELD_KEYS = ['status', 'date', 'output', 'staff'];

// ---------------------------------------------------------------------------
// 共通ユーティリティ
// ---------------------------------------------------------------------------

function props_() { return PropertiesService.getScriptProperties(); }

function getProp_(key, fallback) {
  const v = props_().getProperty(key);
  return (v === null || v === '') ? fallback : v;
}

function productionSpreadsheetId_() { return getProp_('PRODUCTION_SS_ID', CONFIG.DEFAULT_PRODUCTION_SS_ID); }
function headerRows_() { return Number(getProp_('PRODUCTION_HEADER_ROWS', CONFIG.PRODUCTION_HEADER_ROWS)) || CONFIG.PRODUCTION_HEADER_ROWS; }
function categoryFilter_() {
  const v = String(getProp_('CATEGORY_FILTER', CONFIG.DEFAULT_CATEGORY_FILTER)).trim();
  return (v === '-' || v === 'なし') ? '' : v;
}

/** 列名（A / M / AG）→ 列番号。空や「-」は 0（取り込まない）。 */
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

/** 現在の生産表の列マッピング（列番号）。 */
function srcCols_() {
  const out = {};
  Object.keys(SRC_DEFAULT).forEach(function (k) {
    out[k] = colToIndex_(getProp_(SRC_PROP[k], SRC_DEFAULT[k]));
  });
  return out;
}

/** 担当者の列設定を配列に。 */
function staffColumns_() {
  const raw = String(getProp_('STAFF_COLUMNS', STAFF_DEFAULT));
  return raw.split(/[,，]/).map(function (s) { return s.trim(); }).filter(function (s) { return !!s; })
    .map(function (s) {
      const m = s.match(/^([A-Za-z]{1,2})\s*[=＝]\s*([^:：]+?)\s*[:：]\s*(DTP|dtp|編集)$/);
      if (!m) throw new Error('STAFF_COLUMNS の書式が正しくありません（例 E=和泉:DTP）：' + s);
      return { col: colToIndex_(m[1]), name: m[2], group: m[3].toUpperCase() === 'DTP' ? 'DTP' : '編集' };
    });
}

/** 出力区分の判定表。 */
function outputRules_() {
  const raw = getProp_('OUTPUT_RULES', OUTPUT_RULES_DEFAULT);
  let arr;
  try { arr = JSON.parse(raw); } catch (e) { throw new Error('OUTPUT_RULES がJSONとして読めません：' + e.message); }
  if (!Array.isArray(arr)) throw new Error('OUTPUT_RULES は配列で指定してください。');
  const cols = srcCols_();
  return arr.map(function (r) {
    const key = String(r.col || '').toUpperCase();
    const col = cols.hasOwnProperty(key) ? cols[key] : colToIndex_(key);
    return { col: col, re: new RegExp(String(r.match || ''), 'i'), label: String(r.label || '') };
  });
}

function outputLabels_() {
  const out = [];
  outputRules_().forEach(function (r) { if (r.label && out.indexOf(r.label) < 0) out.push(r.label); });
  return out;
}

/** 編集時に選ぶ名前の候補。既定は担当者列の8名。 */
function editorNames_() {
  const raw = getProp_('EDITOR_NAMES', '');
  if (raw) return String(raw).split(/[,，、\s]+/).filter(function (s) { return !!s; });
  return staffColumns_().map(function (s) { return s.name; });
}

/** 行データから指定列を取り出す（列が 0 のときは空文字）。 */
function pick_(row, colIndex) { return colIndex ? row[colIndex - 1] : ''; }

function today_() { return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, CONFIG.DATE_FORMAT); }
function nowStamp_() { return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy/MM/dd HH:mm'); }

function parseYmd_(s) {
  const m = String(s || '').match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
}

/** 月日だけの日付に、今日から前後半年の範囲で近い方の年を補う。 */
function nearestYearDate_(mo, d, todayStr) {
  const t = parseYmd_(todayStr || today_());
  const y = t.getFullYear();
  let best = null, bestDiff = Infinity;
  [y - 1, y, y + 1].forEach(function (yy) {
    const c = new Date(yy, mo - 1, d, 12, 0, 0);
    if (c.getMonth() !== mo - 1) return;   // 2/30 など存在しない日
    const diff = Math.abs(c.getTime() - t.getTime());
    if (diff < bestDiff) { bestDiff = diff; best = c; }
  });
  return best ? Utilities.formatDate(best, CONFIG.TIMEZONE, CONFIG.DATE_FORMAT) : '';
}

/**
 * セル値を yyyy/MM/dd の文字列に正規化する。
 * Date 型・yyyy-MM-dd・yyyy.MM.dd のほか、年なしの M/d も受け付ける（年は今日に近い方を補う）。
 */
function toDateString_(v, todayStr) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    return Utilities.formatDate(v, CONFIG.TIMEZONE, CONFIG.DATE_FORMAT);
  }
  const s = String(v).trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
    return Utilities.formatDate(new Date(y, mo - 1, d, 12, 0, 0), CONFIG.TIMEZONE, CONFIG.DATE_FORMAT);
  }
  m = s.match(/^(\d{1,2})[\/\-.月](\d{1,2})日?$/);
  if (m) {
    const mo = Number(m[1]), d = Number(m[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
    return nearestYearDate_(mo, d, todayStr);
  }
  return '';
}

/**
 * 紀要「進行中」シートの日付。`731`＝7月31日、`0825`＝8月25日 のように年が無い。
 * 数値・文字列どちらでも受け付け、年は今日から前後半年の範囲で近い方を補う。
 */
function parseKiyoDate_(v, todayStr) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return toDateString_(v, todayStr);
  const s = String(v).trim();
  if (/^\d{3,4}$/.test(s)) {
    const mo = Number(s.length === 3 ? s.slice(0, 1) : s.slice(0, 2));
    const d = Number(s.slice(-2));
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
    return nearestYearDate_(mo, d, todayStr);
  }
  return toDateString_(s, todayStr);
}

function toText_(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return toDateString_(v);
  return String(v).trim();
}

/** yyyy/MM/dd の2値の日数差（a - b）。どちらか空なら null。 */
function diffDays_(a, b) {
  if (!a || !b) return null;
  const pa = a.split('/'), pb = b.split('/');
  const da = Date.UTC(Number(pa[0]), Number(pa[1]) - 1, Number(pa[2]));
  const db = Date.UTC(Number(pb[0]), Number(pb[1]) - 1, Number(pb[2]));
  return Math.round((da - db) / 86400000);
}

/** その週の月曜（yyyy/MM/dd）。 */
function mondayOf_(ymd) {
  const d = parseYmd_(ymd);
  const w = d.getDay();
  d.setDate(d.getDate() + (w === 0 ? -6 : 1 - w));
  return Utilities.formatDate(d, CONFIG.TIMEZONE, CONFIG.DATE_FORMAT);
}

function addDays_(ymd, n) {
  const d = parseYmd_(ymd);
  d.setDate(d.getDate() + n);
  return Utilities.formatDate(d, CONFIG.TIMEZONE, CONFIG.DATE_FORMAT);
}

/** 全角の数字・ハイフンを半角に（受注番号の照合用）。 */
function toHalfWidth_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/[－−‐]/g, '-');
}

/** 受注番号として扱えるか（`22962-000` 形式。未採番の「？？？」や空欄は false）。 */
function isOrderNo_(s) {
  const t = toHalfWidth_(s).replace(/\s/g, '');
  return /^\d{4,}(-\d+)?$/.test(t);
}

function splitList_(s) {
  return String(s || '').split(/[,，、]/).map(function (x) { return x.trim(); }).filter(function (x) { return !!x; });
}
function joinList_(arr) { return (arr || []).join(','); }

/** 得意先＋品名の仮キー（受注番号が無い案件用）。 */
function tempKey_(customer, item) { return '仮:' + toText_(customer) + '|' + toText_(item); }
function nameKey_(customer, item) { return toText_(customer) + '|' + toText_(item); }

// ---------------------------------------------------------------------------
// 権限（印刷進行ボードと同じ合言葉方式）
// ---------------------------------------------------------------------------

function getUserEmail_() {
  let email = '';
  try { email = Session.getActiveUser().getEmail() || ''; } catch (e) { email = ''; }
  if (!email) { try { email = Session.getEffectiveUser().getEmail() || ''; } catch (e) { email = ''; } }
  return email.toLowerCase();
}

function editorEmails_() {
  return String(getProp_('EDITOR_EMAILS', '')).split(/[,\s;]+/)
    .map(function (s) { return s.trim().toLowerCase(); }).filter(function (s) { return !!s; });
}

function editorPin_() { return String(getProp_('EDITOR_PIN', '')).trim(); }

/**
 * 更新権限。合言葉（EDITOR_PIN）が一致すれば編集者。
 * Workspace ではないため Session.getActiveUser().getEmail() は取れないが、
 * 「組織内」公開に変えた場合に備えて EDITOR_EMAILS も見る。どちらも未設定なら所有者のみ。
 */
function canEdit_(auth) {
  const pin = editorPin_();
  if (pin && auth && String(auth.pin || '').trim() === pin) return true;
  const me = getUserEmail_();
  if (!me) return false;
  const list = editorEmails_();
  if (list.length === 0) {
    if (pin) return false;
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
      : '更新権限がありません。スクリプトプロパティ EDITOR_PIN を設定してください。');
  }
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.LOCK_WAIT_MS)) {
    throw new Error('他の処理が実行中です。数秒おいてやり直してください。');
  }
  try { return fn(); } finally { lock.releaseLock(); }
}

// ---------------------------------------------------------------------------
// シート
// ---------------------------------------------------------------------------

function openProductionSpreadsheet_() { return SpreadsheetApp.openById(productionSpreadsheetId_()); }

/** このプロジェクトが作るシート＋印刷進行ボードのシート。生産表として読んではいけない名前。 */
function ownSheetNames_() {
  return [CONFIG.BOARD_SHEET_NAME, CONFIG.PAPER_SHEET_NAME, CONFIG.NOTE_SHEET_NAME, CONFIG.OTHER_BOARD_SHEET_NAME];
}

/**
 * 生産表の最新月シート。
 * 「2026年9月」形式の名前のシートのうち一番右を選ぶ。該当が無ければ、データシート以外で一番右の非表示でないシート。
 */
function latestProductionSheet_(ss) {
  const own = ownSheetNames_();
  const sheets = ss.getSheets().filter(function (sh) { return own.indexOf(sh.getName()) < 0 && !sh.isSheetHidden(); });
  const monthly = sheets.filter(function (sh) { return /^\d{4}年\s*\d{1,2}月/.test(sh.getName()); });
  const pool = monthly.length > 0 ? monthly : sheets;
  if (pool.length === 0) throw new Error('生産表のシートが見つかりません。');
  return pool[pool.length - 1];
}

/** データシートを取得。無ければ左端に作る（右端に作ると印刷進行ボードが生産表と間違えて読むため）。 */
function getOrCreateSheet_(ss, name, headers, textCols) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name, 0);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#e8eef7');
    sh.setFrozenRows(1);
    (textCols || []).forEach(function (c) { sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('@'); });
  }
  if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  const header = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  headers.forEach(function (h, i) {
    if (toText_(header[i]) === '') sh.getRange(1, i + 1).setValue(h).setFontWeight('bold').setBackground('#e8eef7');
  });
  return sh;
}

function getBoardSheet_(ss) {
  ss = ss || openProductionSpreadsheet_();
  const sh = getOrCreateSheet_(ss, CONFIG.BOARD_SHEET_NAME, HEADERS,
    [COL.KEY, COL.ORDER_NO, COL.GEHAN, COL.GEHAN_MANUAL, COL.DONE_DATE, COL.DUE]);
  return sh;
}
function getPaperSheet_(ss) {
  ss = ss || openProductionSpreadsheet_();
  return getOrCreateSheet_(ss, CONFIG.PAPER_SHEET_NAME, PAPER_HEADERS, [PCOL.ORDER_NO, PCOL.DATE]);
}
function getNoteSheet_(ss) {
  ss = ss || openProductionSpreadsheet_();
  return getOrCreateSheet_(ss, CONFIG.NOTE_SHEET_NAME, NOTE_HEADERS, []);
}

/** 状態・出力区分の入力規則（シートを直接編集するときの逃げ道）。値は書き込まない。 */
function applyBoardValidations_(sh) {
  const rows = sh.getMaxRows() - 1;
  if (rows < 1) return;
  const statusRule = SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).build();
  sh.getRange(2, COL.STATUS_MANUAL, rows, 1).setDataValidation(statusRule);
  const labels = outputLabels_();
  if (labels.length > 0) {
    const outRule = SpreadsheetApp.newDataValidation().requireValueInList(labels, true).build();
    sh.getRange(2, COL.OUTPUT_MANUAL, rows, 1).setDataValidation(outRule);
  }
}

/**
 * A列（キー）が入っている最後の行。データが無ければ 1。
 * 書式や入力規則だけの空行に引きずられないよう getLastRow() ではなくA列で判断する。
 */
function lastDataRow_(sh, keyCol) {
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return 1;
  const col = sh.getRange(2, keyCol || 1, lastRow - 1, 1).getValues();
  for (let i = col.length - 1; i >= 0; i--) {
    if (toText_(col[i][0]) !== '') return i + 2;
  }
  return 1;
}
function boardLastDataRow_(sh) { return lastDataRow_(sh, COL.KEY); }

/** 手動セットアップ用。3シートを作るだけ。 */
function setupSheets() {
  const ss = openProductionSpreadsheet_();
  const b = getBoardSheet_(ss);
  applyBoardValidations_(b);
  getPaperSheet_(ss);
  getNoteSheet_(ss);
  return '「' + CONFIG.BOARD_SHEET_NAME + '」「' + CONFIG.PAPER_SHEET_NAME + '」「' + CONFIG.NOTE_SHEET_NAME + '」を用意しました。';
}

// ---------------------------------------------------------------------------
// 手動項目の管理
// ---------------------------------------------------------------------------

function manualSet_(row) {
  const set = {};
  splitList_(row[COL.MANUAL_FIELDS - 1]).forEach(function (f) { set[f] = true; });
  return set;
}
function manualFieldsString_(set) {
  return MANUAL_FIELD_KEYS.filter(function (k) { return !!set[k]; }).join(',');
}

/** 行の有効値（手動があれば手動、なければ自動）。 */
function effective_(row) {
  const m = manualSet_(row);
  return {
    status: m.status ? toText_(row[COL.STATUS_MANUAL - 1]) : toText_(row[COL.STATUS - 1]),
    gehan: m.date ? toDateString_(row[COL.GEHAN_MANUAL - 1]) : toDateString_(row[COL.GEHAN - 1]),
    output: m.output ? toText_(row[COL.OUTPUT_MANUAL - 1]) : toText_(row[COL.OUTPUT - 1]),
    dtp: m.staff ? splitList_(row[COL.DTP_MANUAL - 1]) : splitList_(row[COL.DTP - 1]),
    edit: m.staff ? splitList_(row[COL.EDIT_MANUAL - 1]) : splitList_(row[COL.EDIT - 1]),
    manual: m
  };
}

/**
 * 完了日（S列）を有効値から決め直す。
 * 状態が下版済のとき：自動判定なら生産表の下版日。手動なら 手動の下版予定日 → 生産表の下版日 → 既存の完了日 → 今日 の順。
 */
function recomputeDone_(row, todayStr) {
  const e = effective_(row);
  if (e.status !== STATUS.DONE) { row[COL.DONE_DATE - 1] = ''; return; }
  const auto = toDateString_(row[COL.GEHAN - 1]);
  if (!e.manual.status) { row[COL.DONE_DATE - 1] = auto; return; }
  const man = e.manual.date ? toDateString_(row[COL.GEHAN_MANUAL - 1]) : '';
  row[COL.DONE_DATE - 1] = man || auto || toDateString_(row[COL.DONE_DATE - 1]) || todayStr || today_();
}

// ---------------------------------------------------------------------------
// 取込① 生産表 → 制作進行
// ---------------------------------------------------------------------------

/** 生産表の1行から自動判定の値を作る。 */
function autoFromRow_(r, cols, staff, rules, todayStr) {
  const orderNoRaw = toText_(pick_(r, cols.ORDER_NO));
  const numbered = isOrderNo_(orderNoRaw);
  const customer = toText_(pick_(r, cols.CUSTOMER));
  const item = toText_(pick_(r, cols.ITEM));

  const dtp = [], edit = [];
  staff.forEach(function (s) {
    if (toText_(pick_(r, s.col)) !== '') (s.group === 'DTP' ? dtp : edit).push(s.name);
  });

  const dates = {};
  STAGES.forEach(function (s) { dates[s.key] = toDateString_(pick_(r, cols[s.key]), todayStr); });
  const gehan = dates.GEHAN;
  let status, recent = '', doneDate = '';
  if (gehan && gehan <= todayStr) {
    status = STATUS.DONE;
    recent = '下版 ' + gehan;
    doneDate = gehan;
  } else {
    let lastIdx = -1;
    for (let i = 0; i < STAGES.length - 1; i++) { if (dates[STAGES[i].key]) lastIdx = i; }
    if (lastIdx < 0) status = STATUS.NOT_YET;
    else if (lastIdx === 0) status = STATUS.WORKING;
    else status = STATUS.PROOF;
    if (lastIdx >= 0) recent = STAGES[lastIdx].name + ' ' + dates[STAGES[lastIdx].key];
  }

  let output = '';
  for (let i = 0; i < rules.length; i++) {
    const v = toText_(pick_(r, rules[i].col));
    if (v && rules[i].re.test(v)) { output = rules[i].label; break; }
  }

  return {
    orderNo: numbered ? orderNoRaw.replace(/\s/g, '') : (orderNoRaw || '？？？'),
    numbered: numbered,
    customer: customer, item: item,
    sales: toText_(pick_(r, cols.SALES)),
    dtp: dtp, edit: edit,
    status: status, gehan: gehan, output: output, recent: recent, doneDate: doneDate,
    due: toDateString_(pick_(r, cols.DUE), todayStr),
    category: toText_(pick_(r, cols.CATEGORY))
  };
}

function keyFor_(auto) { return auto.numbered ? auto.orderNo : tempKey_(auto.customer, auto.item); }

function maxSrcCol_(cols, staff, rules) {
  let m = 1;
  Object.keys(cols).forEach(function (k) { if (cols[k] > m) m = cols[k]; });
  staff.forEach(function (s) { if (s.col > m) m = s.col; });
  rules.forEach(function (r) { if (r.col > m) m = r.col; });
  return m;
}

/**
 * 生産表 → 制作進行 の差分取込。
 * - 大分類が「冊子」の行だけ
 * - キーが未登録なら追記。受注番号が新しく付いた案件は、得意先＋品名が一致する仮キーの行を引き継ぐ
 * - 既存行は自動判定の列だけ書き換える。手動の列（I/K/M/O/P/Q/U/V/W）は絶対に触らない
 * - 生産表から消えた行（月替わりなど）は何もしない（そのまま残る）
 */
function importFromProductionSheet() {
  return withLock_(function () {
    const ss = openProductionSpreadsheet_();
    const src = latestProductionSheet_(ss);
    const board = getBoardSheet_(ss);
    const headerRows = headerRows_();
    const cols = srcCols_();
    const staff = staffColumns_();
    const rules = outputRules_();
    const filter = categoryFilter_();
    const todayStr = today_();
    const stamp = nowStamp_();
    if (!cols.ORDER_NO) throw new Error('受注番号の列が設定されていません。');

    const maxCol = maxSrcCol_(cols, staff, rules);
    const srcLastRow = src.getLastRow();
    const srcRows = srcLastRow > headerRows
      ? src.getRange(headerRows + 1, 1, srcLastRow - headerRows, maxCol).getValues() : [];

    const boardLast = boardLastDataRow_(board);
    const boardRows = boardLast > 1 ? board.getRange(2, 1, boardLast - 1, LAST_COL).getValues() : [];

    const indexByKey = {}, tempIndexByName = {};
    boardRows.forEach(function (r, i) {
      const key = toText_(r[COL.KEY - 1]);
      if (!key) return;
      if (indexByKey[key] === undefined) indexByKey[key] = i;   // 先勝ち
      if (key.indexOf('仮:') === 0) {
        const nk = nameKey_(r[COL.CUSTOMER - 1], r[COL.ITEM - 1]);
        if (tempIndexByName[nk] === undefined) tempIndexByName[nk] = i;
      }
    });

    const appends = [], updates = [], seen = {};
    let skipped = 0, migrated = 0;

    srcRows.forEach(function (r) {
      const auto = autoFromRow_(r, cols, staff, rules, todayStr);
      if (!auto.item && !auto.customer && !auto.numbered) return;          // 空行
      if (filter && auto.category.indexOf(filter) < 0) { skipped++; return; }   // 端物など
      const key = keyFor_(auto);
      if (seen[key]) return;
      seen[key] = true;

      let idx = indexByKey[key];
      if (idx === undefined && auto.numbered) {
        const t = tempIndexByName[nameKey_(auto.customer, auto.item)];
        if (t !== undefined) { idx = t; migrated++; delete tempIndexByName[nameKey_(auto.customer, auto.item)]; }
      }

      if (idx === undefined) {
        const row = new Array(LAST_COL).fill('');
        applyAuto_(row, key, auto);
        row[COL.IMPORTED_AT - 1] = stamp;
        recomputeDone_(row, todayStr);
        appends.push(row);
      } else {
        const cur = boardRows[idx];
        const next = cur.slice();
        applyAuto_(next, key, auto);
        recomputeDone_(next, todayStr);
        if (!sameRow_(cur, next)) {
          next[COL.IMPORTED_AT - 1] = stamp;
          updates.push({ row: idx + 2, values: next });
        }
      }
    });

    updates.forEach(function (u) { board.getRange(u.row, 1, 1, LAST_COL).setValues([u.values]); });
    if (appends.length > 0) {
      const start = boardLast + 1;
      const need = start + appends.length - 1 - board.getMaxRows();
      if (need > 0) board.insertRowsAfter(board.getMaxRows(), need);
      board.getRange(start, 1, appends.length, LAST_COL).setValues(appends);
    }

    props_().setProperty('LAST_IMPORT_AT', stamp);
    const result = { added: appends.length, updated: updates.length, migrated: migrated, skipped: skipped, sheet: src.getName(), at: stamp };
    console.log('生産表の取込: 新規 %s / 更新 %s / 番号引継 %s / 対象外 %s（%s）', result.added, result.updated, migrated, skipped, src.getName());
    return result;
  });
}

/** 自動判定の列だけ書き換える（手動の列は触らない）。 */
function applyAuto_(row, key, auto) {
  row[COL.KEY - 1] = key;
  row[COL.ORDER_NO - 1] = auto.orderNo;
  row[COL.CUSTOMER - 1] = auto.customer;
  row[COL.ITEM - 1] = auto.item;
  row[COL.SALES - 1] = auto.sales;
  row[COL.DTP - 1] = joinList_(auto.dtp);
  row[COL.EDIT - 1] = joinList_(auto.edit);
  row[COL.STATUS - 1] = auto.status;
  row[COL.GEHAN - 1] = auto.gehan;
  row[COL.OUTPUT - 1] = auto.output;
  row[COL.RECENT - 1] = auto.recent;
  row[COL.DUE - 1] = auto.due;
}

function sameRow_(a, b) {
  for (let i = 0; i < LAST_COL; i++) {
    if (i === COL.IMPORTED_AT - 1) continue;
    if (toText_(a[i]) !== toText_(b[i])) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 取込② 紀要「進行中」 → 論文明細
// ---------------------------------------------------------------------------

function kiyoConfig_() {
  const stagesRaw = String(getProp_(KIYO_PROP.STAGES, KIYO_DEFAULT.STAGES));
  const stages = stagesRaw.split(/[,，]/).map(function (s) { return s.trim(); }).filter(function (s) { return !!s; })
    .map(function (s) {
      const m = s.match(/^([A-Za-z]{1,2})\s*[=＝]\s*(.+)$/);
      if (!m) throw new Error('KIYO_STAGE_COLS の書式が正しくありません（例 C=初校提出）：' + s);
      return { col: colToIndex_(m[1]), name: m[2].trim() };
    });
  const patternRaw = props_().getProperty(KIYO_PROP.HEADING_PATTERN);
  const pattern = (patternRaw === null ? KIYO_DEFAULT.HEADING_PATTERN : String(patternRaw)).trim();   // 空文字で無効化できる
  return {
    ssId: getProp_('KIYO_SS_ID', CONFIG.DEFAULT_KIYO_SS_ID),
    sheetName: getProp_('KIYO_SHEET_NAME', CONFIG.DEFAULT_KIYO_SHEET_NAME),
    title: colToIndex_(getProp_(KIYO_PROP.TITLE, KIYO_DEFAULT.TITLE)),
    author: colToIndex_(getProp_(KIYO_PROP.AUTHOR, KIYO_DEFAULT.AUTHOR)),
    status: colToIndex_(getProp_(KIYO_PROP.STATUS, KIYO_DEFAULT.STATUS)),
    stages: stages,
    doneWords: splitList_(getProp_(KIYO_PROP.DONE_WORDS, KIYO_DEFAULT.DONE_WORDS)),
    headingRe: pattern ? new RegExp(pattern) : null
  };
}

/** 論文の状態の並び順（内訳の表示順）。 */
function paperStatusOrder_(cfg) {
  return [KIYO_EMPTY_LABEL].concat(cfg.stages.map(function (s) { return s.name; })).concat(cfg.doneWords);
}

/**
 * 「進行中」シートを読み、論文1本1行に展開する。
 * - 【受注番号】を含む行を案件の見出しとみなす。番号が無い見出しの論文は紐づけない（件数だけ報告する）
 * - 各校の列で一番右に日付が入っている工程が状態。校了／責了 が入っていれば完了
 */
function parseKiyoRows_(values, cfg, todayStr) {
  const groups = [];
  const papers = [];
  let current = null;
  values.forEach(function (row, i) {
    const joined = toHalfWidth_(row.map(toText_).join(' '));
    const m = joined.match(ORDER_IN_BRACKETS_RE);
    const title = toText_(pick_(row, cfg.title));
    const author = toText_(pick_(row, cfg.author));
    const anyStage = cfg.stages.some(function (s) { return toText_(pick_(row, s.col)) !== ''; });
    // 見出し行のB列には「7本」「10本・ヨコ組み」のように本数が書かれることがある（著者名ではない）
    const authorLike = author && !/\d+\s*本/.test(toHalfWidth_(author));
    let isHeading = !!m;
    if (!isHeading && cfg.headingRe && title && !authorLike && !anyStage) {
      isHeading = cfg.headingRe.test(toHalfWidth_(title.split(/\r?\n/)[0].trim()));
    }
    if (isHeading) {
      const heading = (title || joined).replace(/\s+/g, ' ').trim();
      current = { row: i + 1, heading: heading, orderNo: m ? m[1] : '', papers: 0 };
      groups.push(current);
      return;
    }
    if (!title) return;
    if (!current) return;   // 見出しより前の行は無視
    current.papers++;

    let doneLabel = '', last = null;
    const check = function (v, stageName) {
      const t = toText_(v);
      if (!t) return;
      for (let k = 0; k < cfg.doneWords.length; k++) {
        if (t.indexOf(cfg.doneWords[k]) >= 0) { doneLabel = cfg.doneWords[k]; return; }
      }
      const d = parseKiyoDate_(v, todayStr);
      if (d && stageName) last = { name: stageName, date: d };
    };
    cfg.stages.forEach(function (s) { check(pick_(row, s.col), s.name); });
    if (cfg.status) check(pick_(row, cfg.status), '');

    if (!current.orderNo) return;
    papers.push({
      orderNo: current.orderNo,
      title: title,
      author: toText_(pick_(row, cfg.author)),
      status: doneLabel || (last ? last.name : KIYO_EMPTY_LABEL),
      date: last ? last.date : ''
    });
  });
  return { groups: groups, papers: papers };
}

function importFromKiyoSheet() {
  return withLock_(function () {
    const cfg = kiyoConfig_();
    const todayStr = today_();
    const stamp = nowStamp_();
    const kss = SpreadsheetApp.openById(cfg.ssId);
    const src = kss.getSheetByName(cfg.sheetName);
    if (!src) throw new Error('紀要のシート「' + cfg.sheetName + '」が見つかりません。');
    const values = src.getDataRange().getValues();
    const parsed = parseKiyoRows_(values, cfg, todayStr);

    const sh = getPaperSheet_();
    const last = lastDataRow_(sh, PCOL.ORDER_NO);
    const cur = last > 1 ? sh.getRange(2, 1, last - 1, PAPER_LAST_COL).getValues() : [];
    const next = parsed.papers.map(function (p) { return [p.orderNo, p.title, p.author, p.status, p.date, stamp]; });

    let same = cur.length === next.length;
    for (let i = 0; same && i < next.length; i++) {
      for (let j = 0; j < PAPER_LAST_COL - 1; j++) {   // 取込日時は比べない
        if (toText_(cur[i][j]) !== toText_(next[i][j])) { same = false; break; }
      }
    }
    if (!same) {
      if (last > 1) sh.getRange(2, 1, last - 1, PAPER_LAST_COL).clearContent();
      if (next.length > 0) {
        const need = next.length + 1 - sh.getMaxRows();
        if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need);
        sh.getRange(2, 1, next.length, PAPER_LAST_COL).setValues(next);
      }
    }

    const unlinked = parsed.groups.filter(function (g) { return !g.orderNo; }).map(function (g) { return g.heading; });
    props_().setProperty('LAST_KIYO_IMPORT_AT', stamp);
    props_().setProperty('LAST_KIYO_ERROR', '');
    props_().setProperty('LAST_KIYO_UNLINKED', unlinked.join(' ／ '));
    const result = { papers: next.length, issues: parsed.groups.length - unlinked.length, unlinked: unlinked, changed: !same, at: stamp };
    console.log('紀要の取込: 論文 %s 本 / 案件 %s 件 / 番号なし見出し %s 件', result.papers, result.issues, unlinked.length);
    return result;
  });
}

/** 生産表と紀要をまとめて取り込む（トリガー・画面のボタン用）。紀要側が失敗しても生産表の取込は成功させる。 */
function importAll() {
  const production = importFromProductionSheet();
  let kiyo = null, kiyoError = '';
  try { kiyo = importFromKiyoSheet(); }
  catch (e) {
    kiyoError = e.message;
    props_().setProperty('LAST_KIYO_ERROR', kiyoError);
    console.log('紀要の取込に失敗: %s', kiyoError);
  }
  return { production: production, kiyo: kiyo, kiyoError: kiyoError };
}

/** 毎朝の取込トリガーを作成（重複作成しない）。 */
function createDailyImportTrigger() {
  deleteImportTriggers();
  ScriptApp.newTrigger('importAll').timeBased()
    .atHour(CONFIG.IMPORT_TRIGGER_HOUR).nearMinute(0).everyDays(1).inTimezone(CONFIG.TIMEZONE).create();
  return '毎朝' + CONFIG.IMPORT_TRIGGER_HOUR + '時の取込トリガーを設定しました。';
}
function deleteImportTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['importAll', 'importFromProductionSheet'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
}

// ---------------------------------------------------------------------------
// 調査用
// ---------------------------------------------------------------------------

/** 生産表の取込がうまくいかないときの調査。実行ログに状況を書き出す。 */
function diagnoseImport() {
  const ss = openProductionSpreadsheet_();
  const headerRows = headerRows_();
  const cols = srcCols_();
  const staff = staffColumns_();
  const rules = outputRules_();
  const lines = [];
  lines.push('スプレッドシート：' + ss.getName());
  lines.push('シート（左から）：' + ss.getSheets().map(function (sh) {
    return sh.getName() + (sh.isSheetHidden() ? '（非表示）' : '');
  }).join('  /  '));
  const src = latestProductionSheet_(ss);
  lines.push('取込対象に選ばれたシート：' + src.getName());
  lines.push('そのシートの最終行：' + src.getLastRow() + '　／　見出し行数の設定：' + headerRows + '　／　大分類の絞り込み：' + (categoryFilter_() || '（なし）'));
  lines.push('読んでいる列：' + Object.keys(cols).map(function (k) { return k + '=' + indexToCol_(cols[k]); }).join('  '));
  lines.push('担当者の列：' + staff.map(function (s) { return indexToCol_(s.col) + '=' + s.name + '(' + s.group + ')'; }).join('  '));
  lines.push('出力区分の判定：' + rules.map(function (r) { return indexToCol_(r.col) + ' が /' + r.re.source + '/ → ' + r.label; }).join('  ／  '));

  const headerWidth = Math.max(src.getLastColumn(), maxSrcCol_(cols, staff, rules));
  for (let hr = 1; hr <= headerRows && hr <= src.getLastRow(); hr++) {
    const header = src.getRange(hr, 1, 1, headerWidth).getValues()[0];
    const named = [];
    header.forEach(function (v, i) { const t = toText_(v); if (t) named.push(indexToCol_(i + 1) + '=' + t); });
    if (named.length > 0) lines.push('見出し ' + hr + '行目：' + named.join('  '));
  }

  const lastRow = src.getLastRow();
  if (lastRow > headerRows) {
    const width = maxSrcCol_(cols, staff, rules);
    const rows = src.getRange(headerRows + 1, 1, Math.min(5, lastRow - headerRows), width).getValues();
    const todayStr = today_();
    lines.push('この設定で読み取れる先頭' + rows.length + '行：');
    rows.forEach(function (r, i) {
      const a = autoFromRow_(r, cols, staff, rules, todayStr);
      lines.push('  ' + (headerRows + 1 + i) + '行目：キー=「' + keyFor_(a) + '」 得意先=「' + a.customer + '」 品名=「' + a.item +
        '」 大分類=「' + a.category + '」 状態=' + a.status + (a.recent ? '（' + a.recent + '）' : '') +
        ' 下版=' + (a.gehan || '—') + ' 納期=' + (a.due || '—') + ' 出力=' + (a.output || '—') +
        ' DTP=[' + a.dtp.join(',') + '] 編集=[' + a.edit.join(',') + '] 営業=' + a.sales);
    });
    const all = src.getRange(headerRows + 1, 1, lastRow - headerRows, width).getValues();
    let booklets = 0, withNo = 0;
    all.forEach(function (r) {
      const a = autoFromRow_(r, cols, staff, rules, todayStr);
      if (a.numbered) withNo++;
      if (!categoryFilter_() || a.category.indexOf(categoryFilter_()) >= 0) booklets++;
    });
    lines.push('受注番号が入っている行数：' + withNo + ' 行　／　大分類が「' + (categoryFilter_() || '＊') + '」の行数：' + booklets + ' 行');
    if (withNo === 0) lines.push('  → 指定した列に受注番号がありません。スクリプトプロパティ ' + SRC_PROP.ORDER_NO + ' を確認してください。');
    if (booklets === 0) lines.push('  → 大分類が一致する行がありません。' + SRC_PROP.CATEGORY + ' か CATEGORY_FILTER を確認してください。');
  } else {
    lines.push('  → 見出し行より下にデータがありません。');
  }

  const board = ss.getSheetByName(CONFIG.BOARD_SHEET_NAME);
  lines.push(board
    ? '制作進行シート：最終行 ' + board.getLastRow() + '　／　案件が入っている最終行 ' + boardLastDataRow_(board)
    : '制作進行シート：まだありません（setupSheets を実行してください）');
  const msg = lines.join('\n');
  console.log(msg);
  return msg;
}

/** 紀要「進行中」シートの調査。列の割り当てを決めるとき、実物の先頭行をそのまま書き出す。 */
function diagnoseKiyo() {
  const cfg = kiyoConfig_();
  const lines = [];
  lines.push('紀要スプレッドシートID：' + cfg.ssId + '　シート：' + cfg.sheetName);
  lines.push('列の設定：論文名=' + indexToCol_(cfg.title) + ' 著者=' + indexToCol_(cfg.author) +
    ' 状態列=' + indexToCol_(cfg.status) + ' 各校=' + cfg.stages.map(function (s) { return indexToCol_(s.col) + '=' + s.name; }).join(',') +
    ' 完了語=' + cfg.doneWords.join(',') + ' 番号なし見出しの判定=' + (cfg.headingRe ? '/' + cfg.headingRe.source + '/' : '（なし）'));
  let kss;
  try { kss = SpreadsheetApp.openById(cfg.ssId); }
  catch (e) { lines.push('→ 開けません：' + e.message + '（閲覧権限を付与してもらってください）'); const m = lines.join('\n'); console.log(m); return m; }
  const sh = kss.getSheetByName(cfg.sheetName);
  if (!sh) { lines.push('→ シート「' + cfg.sheetName + '」がありません。シート一覧：' + kss.getSheets().map(function (s) { return s.getName(); }).join(' / ')); const m = lines.join('\n'); console.log(m); return m; }
  const values = sh.getDataRange().getValues();
  lines.push('行数：' + values.length);
  lines.push('先頭20行（列名=値）：');
  values.slice(0, 20).forEach(function (row, i) {
    const cells = [];
    row.forEach(function (v, j) { const t = toText_(v).replace(/\r?\n/g, '⏎'); if (t) cells.push(indexToCol_(j + 1) + '=' + t); });
    if (cells.length > 0) lines.push('  ' + (i + 1) + '行目：' + cells.join('  '));
  });
  const parsed = parseKiyoRows_(values, cfg, today_());
  lines.push('見出しとして検出した行：');
  parsed.groups.forEach(function (g) {
    lines.push('  ' + g.row + '行目：' + g.heading + ' → ' + (g.orderNo ? '受注番号 ' + g.orderNo : '番号なし（紐づけない）') + '　論文 ' + g.papers + ' 本');
  });
  lines.push('紐づいた論文：' + parsed.papers.length + ' 本');
  parsed.papers.slice(0, 5).forEach(function (p) {
    lines.push('  ' + p.orderNo + '　' + p.title + '／' + p.author + '　' + p.status + ' ' + p.date);
  });
  const msg = lines.join('\n');
  console.log(msg);
  return msg;
}

// ---------------------------------------------------------------------------
// 画面へ渡すデータ
// ---------------------------------------------------------------------------

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('制作進行ボード')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** 1行分のシート値 → 画面用オブジェクト。 */
function buildRecord_(values, rowNumber, papers) {
  const e = effective_(values);
  const due = toDateString_(values[COL.DUE - 1]);
  const doneDate = toDateString_(values[COL.DONE_DATE - 1]);
  const manualFields = MANUAL_FIELD_KEYS.filter(function (k) { return !!e.manual[k]; });
  const list = papers || [];
  const counts = {};
  list.forEach(function (p) { counts[p.status] = (counts[p.status] || 0) + 1; });
  return {
    row: rowNumber,
    key: toText_(values[COL.KEY - 1]),
    orderNo: toText_(values[COL.ORDER_NO - 1]),
    isTemp: toText_(values[COL.KEY - 1]).indexOf('仮:') === 0,
    customer: toText_(values[COL.CUSTOMER - 1]),
    item: toText_(values[COL.ITEM - 1]),
    sales: toText_(values[COL.SALES - 1]),
    status: e.status, statusAuto: toText_(values[COL.STATUS - 1]),
    gehan: e.gehan, gehanAuto: toDateString_(values[COL.GEHAN - 1]),
    output: e.output, outputAuto: toText_(values[COL.OUTPUT - 1]),
    dtp: e.dtp, dtpAuto: splitList_(values[COL.DTP - 1]),
    edit: e.edit, editAuto: splitList_(values[COL.EDIT - 1]),
    due: due,
    recent: toText_(values[COL.RECENT - 1]),
    memo: toText_(values[COL.MEMO - 1]),
    manualFields: manualFields,
    manualBy: toText_(values[COL.MANUAL_BY - 1]),
    manualAt: toText_(values[COL.MANUAL_AT - 1]),
    importedAt: toText_(values[COL.IMPORTED_AT - 1]),
    doneDate: doneDate,
    isDone: e.status === STATUS.DONE,
    papers: list,
    paperCounts: counts
  };
}

function readPapers_(ss) {
  const sh = getPaperSheet_(ss);
  const last = lastDataRow_(sh, PCOL.ORDER_NO);
  const byNo = {};
  if (last < 2) return byNo;
  sh.getRange(2, 1, last - 1, PAPER_LAST_COL).getValues().forEach(function (r) {
    const no = toText_(r[PCOL.ORDER_NO - 1]);
    if (!no) return;
    (byNo[no] = byNo[no] || []).push({
      title: toText_(r[PCOL.TITLE - 1]), author: toText_(r[PCOL.AUTHOR - 1]),
      status: toText_(r[PCOL.STATUS - 1]), date: toDateString_(r[PCOL.DATE - 1])
    });
  });
  return byNo;
}

function readNotes_(ss) {
  const sh = getNoteSheet_(ss);
  const last = lastDataRow_(sh, NCOL.NAME);
  const notes = {};
  if (last < 2) return notes;
  sh.getRange(2, 1, last - 1, 2).getValues().forEach(function (r) {
    const n = toText_(r[NCOL.NAME - 1]);
    if (n) notes[n] = toText_(r[NCOL.NOTE - 1]);
  });
  return notes;
}

/**
 * 画面用データ一式。
 * - 未入稿・作業中・校正中：すべて
 * - 下版済：完了日が「直近の月曜」以降のものだけ（月曜の朝に前週分がまとめて消える）
 */
function getBoardData(options) {
  const opts = options || {};
  const ss = openProductionSpreadsheet_();
  const sh = getBoardSheet_(ss);
  const todayStr = today_();
  const weekStart = mondayOf_(todayStr);
  const editable = canEdit_(opts);
  const papers = readPapers_(ss);
  const cfg = kiyoConfig_();

  const last = boardLastDataRow_(sh);
  const values = last > 1 ? sh.getRange(2, 1, last - 1, LAST_COL).getValues() : [];
  const rows = [];
  values.forEach(function (v, i) {
    if (!toText_(v[COL.KEY - 1])) return;
    const rec = buildRecord_(v, i + 2, papers[toText_(v[COL.ORDER_NO - 1])]);
    if (rec.isDone) {
      if (!rec.doneDate || rec.doneDate < weekStart) return;
    }
    rows.push(rec);
  });

  return {
    rows: rows,
    today: todayStr,
    weekStart: weekStart,
    weekEnd: addDays_(weekStart, 4),
    canEdit: editable,
    pinConfigured: !!editorPin_(),
    authConfigured: editorEmails_().length > 0 || !!editorPin_(),
    editorNames: editorNames_(),
    staff: staffColumns_().map(function (s) { return { name: s.name, group: s.group }; }),
    notes: readNotes_(ss),
    statuses: STATUSES,
    outputs: outputLabels_(),
    paperStatusOrder: paperStatusOrder_(cfg),
    lastImportAt: getProp_('LAST_IMPORT_AT', ''),
    lastKiyoImportAt: getProp_('LAST_KIYO_IMPORT_AT', ''),
    kiyoError: getProp_('LAST_KIYO_ERROR', ''),
    kiyoUnlinked: getProp_('LAST_KIYO_UNLINKED', ''),
    fetchedAt: nowStamp_()
  };
}

// ---------------------------------------------------------------------------
// 操作（手動編集）
// ---------------------------------------------------------------------------

function findRowByKey_(sh, key) {
  const last = boardLastDataRow_(sh);
  if (last < 2) return 0;
  const col = sh.getRange(2, COL.KEY, last - 1, 1).getValues();
  const k = String(key || '').trim();
  for (let i = 0; i < col.length; i++) { if (toText_(col[i][0]) === k) return i + 2; }
  return 0;
}

/** 画面上部の手動取込ボタン。 */
function runImportNow(auth) {
  assertEditor_(auth);
  const r = importAll();
  let msg = '取込完了：新規 ' + r.production.added + ' 件／更新 ' + r.production.updated + ' 件';
  if (r.production.migrated) msg += '／番号引継 ' + r.production.migrated + ' 件';
  if (r.kiyo) msg += '　紀要：論文 ' + r.kiyo.papers + ' 本';
  if (r.kiyoError) msg += '　紀要の取込は失敗：' + r.kiyoError;
  return { message: msg, result: r };
}

/**
 * 編集パネルの保存。
 * patch: { name, status, gehanDate, output, dtp:[], edit:[], memo }
 * 自動判定と違う値が来た項目だけ「手動」になり、同じ値に戻せば手動が解除される（＝生産表に戻る）。
 * 日付は yyyy-MM-dd / yyyy/MM/dd のどちらでも受け付ける。
 */
function saveCase(key, patch, auth) {
  assertEditor_(auth);
  const p = patch || {};
  const name = toText_(p.name) || toText_(auth && auth.name);
  if (!name) throw new Error('だれが直したか分かるよう、名前を選んでください。');
  return withLock_(function () {
    const sh = getBoardSheet_();
    const row = findRowByKey_(sh, key);
    if (!row) throw new Error('案件 ' + key + ' が見つかりません。');
    const before = sh.getRange(row, 1, 1, LAST_COL).getValues()[0];
    const v = before.slice();
    const m = manualSet_(v);

    if (p.hasOwnProperty('status')) {
      const s = toText_(p.status);
      if (s && STATUSES.indexOf(s) < 0) throw new Error('状態の値が不正です：' + s);
      if (!s || s === toText_(v[COL.STATUS - 1])) { m.status = false; v[COL.STATUS_MANUAL - 1] = ''; }
      else { m.status = true; v[COL.STATUS_MANUAL - 1] = s; }
    }
    if (p.hasOwnProperty('gehanDate')) {
      const d = toDateString_(p.gehanDate);
      if (p.gehanDate && !d) throw new Error('下版予定日の形式が正しくありません：' + p.gehanDate);
      if (d === toDateString_(v[COL.GEHAN - 1])) { m.date = false; v[COL.GEHAN_MANUAL - 1] = ''; }
      else { m.date = true; v[COL.GEHAN_MANUAL - 1] = d; }
    }
    if (p.hasOwnProperty('output')) {
      const o = toText_(p.output);
      if (o === toText_(v[COL.OUTPUT - 1])) { m.output = false; v[COL.OUTPUT_MANUAL - 1] = ''; }
      else { m.output = true; v[COL.OUTPUT_MANUAL - 1] = o; }
    }
    if (p.hasOwnProperty('dtp') || p.hasOwnProperty('edit')) {
      const e = effective_(v);
      const dtp = p.hasOwnProperty('dtp') ? normalizeNames_(p.dtp) : e.dtp;
      const edit = p.hasOwnProperty('edit') ? normalizeNames_(p.edit) : e.edit;
      if (joinList_(dtp) === toText_(v[COL.DTP - 1]) && joinList_(edit) === toText_(v[COL.EDIT - 1])) {
        m.staff = false; v[COL.DTP_MANUAL - 1] = ''; v[COL.EDIT_MANUAL - 1] = '';
      } else {
        m.staff = true; v[COL.DTP_MANUAL - 1] = joinList_(dtp); v[COL.EDIT_MANUAL - 1] = joinList_(edit);
      }
    }
    if (p.hasOwnProperty('memo')) {
      v[COL.MEMO - 1] = String(p.memo || '').replace(/[\r\n]+/g, ' ').trim();
    }
    v[COL.MANUAL_FIELDS - 1] = manualFieldsString_(m);
    recomputeDone_(v, today_());

    let changed = false;
    for (let i = 0; i < LAST_COL; i++) { if (toText_(before[i]) !== toText_(v[i])) { changed = true; break; } }
    if (changed) {
      v[COL.MANUAL_BY - 1] = name;
      v[COL.MANUAL_AT - 1] = nowStamp_();
      sh.getRange(row, 1, 1, LAST_COL).setValues([v]);
    }
    return buildRecord_(v, row, readPapers_()[toText_(v[COL.ORDER_NO - 1])]);
  });
}

function normalizeNames_(arr) {
  const list = Array.isArray(arr) ? arr : splitList_(arr);
  const out = [];
  list.forEach(function (n) { const t = toText_(n); if (t && out.indexOf(t) < 0) out.push(t); });
  return out;
}

/**
 * 「生産表に戻す」。fields は ['status','date','output','staff'] の一部、または 'all'。
 */
function resetToProduction(key, fields, auth) {
  assertEditor_(auth);
  const name = toText_(auth && auth.name);
  const targets = (fields === 'all' || !fields) ? MANUAL_FIELD_KEYS.slice()
    : (Array.isArray(fields) ? fields : [fields]).filter(function (f) { return MANUAL_FIELD_KEYS.indexOf(f) >= 0; });
  if (targets.length === 0) throw new Error('戻す項目が指定されていません。');
  return withLock_(function () {
    const sh = getBoardSheet_();
    const row = findRowByKey_(sh, key);
    if (!row) throw new Error('案件 ' + key + ' が見つかりません。');
    const v = sh.getRange(row, 1, 1, LAST_COL).getValues()[0];
    const m = manualSet_(v);
    targets.forEach(function (f) {
      m[f] = false;
      if (f === 'status') v[COL.STATUS_MANUAL - 1] = '';
      if (f === 'date') v[COL.GEHAN_MANUAL - 1] = '';
      if (f === 'output') v[COL.OUTPUT_MANUAL - 1] = '';
      if (f === 'staff') { v[COL.DTP_MANUAL - 1] = ''; v[COL.EDIT_MANUAL - 1] = ''; }
    });
    v[COL.MANUAL_FIELDS - 1] = manualFieldsString_(m);
    recomputeDone_(v, today_());
    if (name) v[COL.MANUAL_BY - 1] = name;
    v[COL.MANUAL_AT - 1] = nowStamp_();
    sh.getRange(row, 1, 1, LAST_COL).setValues([v]);
    return buildRecord_(v, row, readPapers_()[toText_(v[COL.ORDER_NO - 1])]);
  });
}

/**
 * 「この2件は同じ案件」。fromKey の手動修正・メモを toKey に引き継ぎ、fromKey の行を消す。
 * （仮キーの案件に受注番号が付いたのに、得意先＋品名が変わっていて自動で引き継げなかったとき用）
 * 両方に手動修正がある項目は toKey 側を残す。
 */
function mergeCases(fromKey, toKey, auth) {
  assertEditor_(auth);
  const name = toText_(auth && auth.name);
  if (!fromKey || !toKey || fromKey === toKey) throw new Error('統合する2件を正しく選んでください。');
  return withLock_(function () {
    const sh = getBoardSheet_();
    const fromRow = findRowByKey_(sh, fromKey);
    const toRow = findRowByKey_(sh, toKey);
    if (!fromRow) throw new Error('案件 ' + fromKey + ' が見つかりません。');
    if (!toRow) throw new Error('案件 ' + toKey + ' が見つかりません。');
    const from = sh.getRange(fromRow, 1, 1, LAST_COL).getValues()[0];
    const to = sh.getRange(toRow, 1, 1, LAST_COL).getValues()[0];
    const fm = manualSet_(from), tm = manualSet_(to);
    const pairs = { status: [COL.STATUS_MANUAL], date: [COL.GEHAN_MANUAL], output: [COL.OUTPUT_MANUAL], staff: [COL.DTP_MANUAL, COL.EDIT_MANUAL] };
    MANUAL_FIELD_KEYS.forEach(function (f) {
      if (fm[f] && !tm[f]) {
        pairs[f].forEach(function (c) { to[c - 1] = from[c - 1]; });
        tm[f] = true;
      }
    });
    const fromMemo = toText_(from[COL.MEMO - 1]), toMemo = toText_(to[COL.MEMO - 1]);
    if (fromMemo && !toMemo) to[COL.MEMO - 1] = fromMemo;
    else if (fromMemo && toMemo && fromMemo !== toMemo) to[COL.MEMO - 1] = toMemo + ' ／ ' + fromMemo;
    to[COL.MANUAL_FIELDS - 1] = manualFieldsString_(tm);
    to[COL.MANUAL_BY - 1] = name || toText_(from[COL.MANUAL_BY - 1]) || toText_(to[COL.MANUAL_BY - 1]);
    to[COL.MANUAL_AT - 1] = nowStamp_();
    recomputeDone_(to, today_());
    sh.getRange(toRow, 1, 1, LAST_COL).setValues([to]);
    sh.deleteRow(fromRow);
    console.log('案件を統合: %s → %s', fromKey, toKey);
    return { fromKey: fromKey, toKey: toKey };
  });
}

/** 担当者メモ（見出しの注記）の保存。空文字で消す。 */
function setStaffNote(name, note, auth) {
  assertEditor_(auth);
  const n = toText_(name);
  if (!n) throw new Error('担当者名がありません。');
  const text = String(note || '').replace(/[\r\n]+/g, ' ').trim();
  return withLock_(function () {
    const sh = getNoteSheet_();
    const last = lastDataRow_(sh, NCOL.NAME);
    let row = 0;
    if (last > 1) {
      const names = sh.getRange(2, NCOL.NAME, last - 1, 1).getValues();
      for (let i = 0; i < names.length; i++) { if (toText_(names[i][0]) === n) { row = i + 2; break; } }
    }
    if (!row) row = last + 1;
    sh.getRange(row, 1, 1, 2).setValues([[n, text]]);
    return { name: n, note: text };
  });
}
