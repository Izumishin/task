const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const DATA_FILE = path.join(__dirname, 'tasks.json');

function load() {
  if (!fs.existsSync(DATA_FILE)) return [];
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function save(tasks) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(tasks, null, 2));
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`サーバー起動: http://localhost:${PORT}`);
});
