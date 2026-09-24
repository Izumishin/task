// InDesign の JavaScript (ExtendScript, ES3) では、abstract などの「将来の予約語」を
// 変数名・項目名 (obj.abstract や { abstract: 1 }) に使うとエラーになる。
// 引用符で囲んだ項目名 ("abstract": 1) や文字列の中は問題ない。
const RESERVED = ['abstract', 'boolean', 'byte', 'char', 'class', 'const', 'debugger', 'double', 'enum', 'export',
  'extends', 'final', 'float', 'goto', 'implements', 'import', 'int', 'interface', 'long', 'native', 'package',
  'private', 'protected', 'public', 'short', 'static', 'super', 'synchronized', 'throws', 'transient', 'volatile'];

module.exports = function findReservedWordUse(source) {
  const hits = [];
  const re = new RegExp('(\\.\\s*(' + RESERVED.join('|') + ')\\b)|((?:^|[{,\\s])(' + RESERVED.join('|') + ')\\s*:)|\\b(?:var|function)\\s+(' + RESERVED.join('|') + ')\\b');
  source.split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    const m = re.exec(code);
    if (m) hits.push((i + 1) + ': ' + line.trim());
  });
  return hits;
};
