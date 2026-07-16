const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const DATA_FILE = path.join(__dirname, 'tasks.json');
const CARDS_FILE = path.join(__dirname, 'cards.json');
const REQUESTS_FILE = path.join(__dirname, 'requests.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

function loadFile(file) {
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveFile(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const load = () => loadFile(DATA_FILE);
const save = tasks => saveFile(DATA_FILE, tasks);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') return cb(null, true);
    cb(new Error('PDFファイルのみアップロードできます'));
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== 名刺台帳 =====
app.get('/api/cards', (req, res) => {
  res.json(loadFile(CARDS_FILE));
});

app.post('/api/cards', (req, res) => {
  const { name, kana, department, title } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '氏名は必須です' });
  const cards = loadFile(CARDS_FILE);
  const card = {
    id: Date.now(),
    name: name.trim(),
    kana: (kana || '').trim(),
    department: (department || '').trim(),
    title: (title || '').trim(),
    version: 0,
    pdfFile: null,
    updated_at: new Date().toLocaleString('ja-JP')
  };
  cards.unshift(card);
  saveFile(CARDS_FILE, cards);
  res.status(201).json(card);
});

app.patch('/api/cards/:id', (req, res) => {
  const id = Number(req.params.id);
  const cards = loadFile(CARDS_FILE);
  const card = cards.find(c => c.id === id);
  if (!card) return res.status(404).json({ error: '見つかりません' });
  for (const key of ['name', 'kana', 'department', 'title']) {
    if (req.body[key] !== undefined) card[key] = String(req.body[key]).trim();
  }
  if (!card.name) return res.status(400).json({ error: '氏名は必須です' });
  card.updated_at = new Date().toLocaleString('ja-JP');
  saveFile(CARDS_FILE, cards);
  res.json(card);
});

app.delete('/api/cards/:id', (req, res) => {
  const id = Number(req.params.id);
  const cards = loadFile(CARDS_FILE);
  const idx = cards.findIndex(c => c.id === id);
  if (idx === -1) return res.status(404).json({ error: '見つかりません' });
  const [card] = cards.splice(idx, 1);
  if (card.pdfFile) fs.rmSync(path.join(UPLOADS_DIR, card.pdfFile), { force: true });
  saveFile(CARDS_FILE, cards);
  res.status(204).send();
});

// 下版PDFアップロード(差し替え): 版数を+1し、常に最新1ファイルのみ保持
app.post('/api/cards/:id/pdf', upload.single('pdf'), (req, res) => {
  const id = Number(req.params.id);
  const cards = loadFile(CARDS_FILE);
  const card = cards.find(c => c.id === id);
  if (!card) return res.status(404).json({ error: '見つかりません' });
  if (!req.file) return res.status(400).json({ error: 'PDFファイルを指定してください' });
  const oldFile = card.pdfFile;
  card.version += 1;
  card.pdfFile = `${card.id}_v${String(card.version).padStart(2, '0')}.pdf`;
  fs.writeFileSync(path.join(UPLOADS_DIR, card.pdfFile), req.file.buffer);
  if (oldFile && oldFile !== card.pdfFile) {
    fs.rmSync(path.join(UPLOADS_DIR, oldFile), { force: true });
  }
  card.updated_at = new Date().toLocaleString('ja-JP');
  saveFile(CARDS_FILE, cards);
  res.json(card);
});

// 最新下版PDFダウンロード(営業のセルフサービス取得)
app.get('/api/cards/:id/pdf', (req, res) => {
  const id = Number(req.params.id);
  const cards = loadFile(CARDS_FILE);
  const card = cards.find(c => c.id === id);
  if (!card) return res.status(404).json({ error: '見つかりません' });
  if (!card.pdfFile) return res.status(404).json({ error: '下版PDFが未登録です' });
  const filePath = path.join(UPLOADS_DIR, card.pdfFile);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'PDFファイルが見つかりません' });
  res.download(filePath, `${card.name}_v${String(card.version).padStart(2, '0')}_下版.pdf`);
});

// ===== 依頼管理 =====
const REQUEST_TYPES = ['新規', '変更', '増刷'];
const REQUEST_STATUSES = ['受付', '制作中', 'PDF支給済', '完了'];

app.get('/api/requests', (req, res) => {
  res.json(loadFile(REQUESTS_FILE));
});

app.post('/api/requests', (req, res) => {
  const { type, cardId, requester, detail } = req.body;
  if (!REQUEST_TYPES.includes(type)) {
    return res.status(400).json({ error: `種別は ${REQUEST_TYPES.join('/')} のいずれかです` });
  }
  if (!requester || !requester.trim()) return res.status(400).json({ error: '依頼者は必須です' });
  if (type === '新規' && (!detail || !detail.trim())) {
    return res.status(400).json({ error: '新規依頼は必要事項(氏名・部署・役職・連絡先など)の入力が必須です' });
  }
  if (type !== '新規') {
    const cards = loadFile(CARDS_FILE);
    if (!cards.some(c => c.id === Number(cardId))) {
      return res.status(400).json({ error: '対象者を台帳から選択してください' });
    }
  }
  const requests = loadFile(REQUESTS_FILE);
  const request = {
    id: Date.now(),
    type,
    cardId: type === '新規' ? null : Number(cardId),
    requester: requester.trim(),
    detail: (detail || '').trim(),
    status: '受付',
    created_at: new Date().toLocaleString('ja-JP'),
    updated_at: new Date().toLocaleString('ja-JP')
  };
  requests.unshift(request);
  saveFile(REQUESTS_FILE, requests);
  res.status(201).json(request);
});

app.patch('/api/requests/:id', (req, res) => {
  const id = Number(req.params.id);
  const requests = loadFile(REQUESTS_FILE);
  const request = requests.find(r => r.id === id);
  if (!request) return res.status(404).json({ error: '見つかりません' });
  if (req.body.status !== undefined) {
    if (!REQUEST_STATUSES.includes(req.body.status)) {
      return res.status(400).json({ error: `ステータスは ${REQUEST_STATUSES.join('/')} のいずれかです` });
    }
    request.status = req.body.status;
  }
  request.updated_at = new Date().toLocaleString('ja-JP');
  saveFile(REQUESTS_FILE, requests);
  res.json(request);
});

// ===== タスク管理(既存) =====
app.get('/api/tasks', (req, res) => {
  res.json(load());
});

app.post('/api/tasks', (req, res) => {
  const { title } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'タイトルは必須です' });
  const tasks = load();
  const task = {
    id: Date.now(),
    title: title.trim(),
    done: false,
    created_at: new Date().toLocaleString('ja-JP')
  };
  tasks.unshift(task);
  save(tasks);
  res.status(201).json(task);
});

app.patch('/api/tasks/:id', (req, res) => {
  const id = Number(req.params.id);
  const tasks = load();
  const task = tasks.find(t => t.id === id);
  if (!task) return res.status(404).json({ error: '見つかりません' });
  if (req.body.done !== undefined) task.done = req.body.done;
  if (req.body.title !== undefined) task.title = req.body.title.trim();
  save(tasks);
  res.json(task);
});

app.delete('/api/tasks/:id', (req, res) => {
  const id = Number(req.params.id);
  const tasks = load();
  const idx = tasks.findIndex(t => t.id === id);
  if (idx === -1) return res.status(404).json({ error: '見つかりません' });
  tasks.splice(idx, 1);
  save(tasks);
  res.status(204).send();
});

app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message });
  next();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`サーバー起動: http://localhost:${PORT}`);
});
