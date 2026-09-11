// GAS API の最小モック。logic_test.js / ui_smoke_test.js で共用する。
// モックは本物の副作用を再現する（insertCheckboxes は範囲内の全セルに false を書く、など）。
const fs = require('fs');
const path = require('path');

function pad(n) { return n < 10 ? '0' + n : '' + n; }
const Utilities = {
  formatDate(d, tz, f) {
    const y = d.getFullYear(), m = pad(d.getMonth() + 1), da = pad(d.getDate());
    if (f === 'yyyy/MM/dd') return `${y}/${m}/${da}`;
    return `${y}/${m}/${da} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
};
const _props = {};
const PropertiesService = { getScriptProperties: () => ({
  getProperty: k => (k in _props ? _props[k] : null),
  setProperty: (k, v) => { _props[k] = v; }
}) };
const Session = {
  getActiveUser: () => ({ getEmail: () => '' }),          // 公開設定「全員」ではメールが取れない
  getEffectiveUser: () => ({ getEmail: () => 'owner@example.co.jp' })
};
const LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) };

class FakeRange {
  constructor(sheet, r, c, nr, nc) { this.sheet = sheet; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
  getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sheet.cell(this.r + i, this.c + j)); out.push(row); } return out; }
  getValue() { return this.sheet.cell(this.r, this.c); }
  getBackgrounds() { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sheet.bg(this.r + i, this.c + j)); out.push(row); } return out; }
  setValues(v) { for (let i = 0; i < v.length; i++) for (let j = 0; j < v[i].length; j++) this.sheet.set(this.r + i, this.c + j, v[i][j]); return this; }
  setValue(v) { this.sheet.set(this.r, this.c, v); return this; }
  setFontWeight() { return this; } setBackground() { return this; } setNumberFormat() { return this; }
  setDataValidation() { return this; } clearDataValidations() { return this; }
  clearContent() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sheet.set(this.r + i, this.c + j, ''); return this; }
  // 本物の insertCheckboxes() は範囲内の全セルを false にする（＝getLastRow が伸びる）
  insertCheckboxes() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sheet.set(this.r + i, this.c + j, false); return this; }
}
class FakeSheet {
  constructor(name) { this.name = name; this.data = []; this.bgs = {}; }
  bg(r, c) { return this.bgs[r + ',' + c] || '#ffffff'; }
  setBg(r, c, v) { this.bgs[r + ',' + c] = v; }
  cell(r, c) { const row = this.data[r - 1]; return row && row[c - 1] !== undefined ? row[c - 1] : ''; }
  set(r, c, v) { while (this.data.length < r) this.data.push([]); const row = this.data[r - 1]; while (row.length < c) row.push(''); row[c - 1] = v; }
  getName() { return this.name; }
  isSheetHidden() { return false; }
  getLastRow() { let last = 0; this.data.forEach((row, i) => { if (row.some(v => v !== '' && v !== null && v !== undefined)) last = i + 1; }); return last; }
  getMaxRows() { return Math.max(1000, this.getLastRow()); }
  getRange(r, c, nr, nc) { return new FakeRange(this, r, c, nr === undefined ? 1 : nr, nc === undefined ? 1 : nc); }
  getDataRange() { return new FakeRange(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  setFrozenRows() {} setFrozenColumns() {} setColumnWidth() {} insertRowsAfter() {} insertColumnsAfter() {}
  deleteRow(r) { this.data.splice(r - 1, 1); }
  getMaxColumns() { let m = 0; this.data.forEach(row => { if (row.length > m) m = row.length; }); return Math.max(m, 26); }
  getLastColumn() { let m = 0; this.data.forEach(row => { for (let j = row.length - 1; j >= 0; j--) { if (row[j] !== '' && row[j] !== null && row[j] !== undefined) { if (j + 1 > m) m = j + 1; break; } } }); return m; }
}
class FakeSS {
  constructor(name) { this.name = name; this.sheets = []; }
  getName() { return this.name; }
  getSheets() { return this.sheets; }
  getSheetByName(n) { return this.sheets.find(s => s.getName() === n) || null; }
  insertSheet(n, pos) { const s = new FakeSheet(n); this.sheets.splice(pos === undefined ? this.sheets.length : pos, 0, s); return s; }
}
const PROD_ID = '1yW4WyORgmAAzy-Clh6kafRK598pyY-Ee3OScoDXL1-A';
const KIYO_ID = '1XX7terJgMR8euzSTUT07u9wY-Bht5-ih3j_ae6S_LmY';
const ss = new FakeSS('編集室生産表');
const kss = new FakeSS('紀要');
const SpreadsheetApp = {
  openById: (id) => { if (id === PROD_ID) return ss; if (id === KIYO_ID) return kss; throw new Error('Requested entity was not found.'); },
  newDataValidation: () => ({
    requireValueInList: () => ({ build: () => ({}) }),
    requireCheckbox: () => ({ build: () => ({}) })
  })
};
const ScriptApp = { getProjectTriggers: () => [], newTrigger() {}, deleteTrigger() {} };
const HtmlService = {};

const C = (letter) => { let n = 0; for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };

// ---- Code.gs をロード ----
const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const ctx = { Utilities, PropertiesService, Session, LockService, SpreadsheetApp, ScriptApp, HtmlService, console };
const fn = new Function(...Object.keys(ctx), src + '\nreturn {importFromProductionSheet,importFromKiyoSheet,importAll,getBoardData,saveCase,resetToProduction,mergeCases,setStaffNote,setupSheets,diagnoseImport,diagnoseKiyo,today_,addDays_,mondayOf_,boardLastDataRow_,latestProductionSheet_,runImportNow,parseKiyoDate_,toDateString_,COL,PCOL};');
const api = fn(...Object.values(ctx));

module.exports = { createEnv: () => ({ api, ss, kss, _props }), C };

