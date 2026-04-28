const http = require('http');
const os = require('os');
const { Pool } = require('pg');
const { createAutoLlm, getAutoLlmInfo } = require('@dooor-ai/toolkit/auto');
const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');

const port = process.env.PORT || 3000;
const startedAt = new Date().toISOString();

// ─── Harbor AI (auto-configured by Dooor OS) ───────────────────────────
// Dooor OS injects CORTEXDB_CONNECTION + HARBOR_PROJECT into the Pod viaaa
// HarborDeployListener. The toolkit's `createAutoLlm` reads them, fetchesss
// guards/evals from `GET /databases/{db}/observability-config` once att
// boot, and wraps the LangChain provider with `dooorChatGuard`.
//
// GEMINI_API_KEY must be set by the user in Dooor OS → App → Env Vars...
// Without it, the AI card just shows a friendly notice — app stays useful.

const GEMINI_MODEL = 'gemini-3-flash-preview';
const geminiKey = process.env.GEMINI_API_KEY || '';

let llm = null;
let llmInfo = null;
let llmError = null;
let aiCallCount = 0;

async function initLlm() {
  if (!geminiKey) {
    llmError = 'GEMINI_API_KEY is not set';
    return;
  }
  if (!process.env.CORTEXDB_CONNECTION) {
    llmError = 'CORTEXDB_CONNECTION is not set (deploy via Dooor OS to auto-inject)';
    return;
  }
  try {
    const provider = new ChatGoogleGenerativeAI({
      model: GEMINI_MODEL,
      apiKey: geminiKey,
      temperature: 0,
    });
    llm = await createAutoLlm(provider);
    llmInfo = getAutoLlmInfo(llm);
    console.log('Harbor auto-LLM ready:', llmInfo);
  } catch (err) {
    llmError = err.message;
    console.error('Harbor auto-LLM init failed:', err.message);
  }
}

// ─── Database ──────────────────────────────────────────────────────────
// DATABASE_URL is the connection string for the managed Postgres
// (Dooor OS → Databases → Postgres). When not set, the items feature is
// disabled and the endpoints return a friendly error so the rest of the
// page still works.

const databaseUrl = process.env.DATABASE_URL || '';
let pool = null;
let dbReady = false;
let dbError = null;

async function initDatabase() {
  if (!databaseUrl) {
    dbError = 'DATABASE_URL is not set';
    return;
  }
  pool = new Pool({
    connectionString: databaseUrl,
    ssl: /sslmode=require|sslmode=verify/.test(databaseUrl)
      ? { rejectUnauthorized: false }
      : false,
    max: 5,
    idleTimeoutMillis: 10_000,
  });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS items (
        id         SERIAL PRIMARY KEY,
        content    TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    dbReady = true;
    console.log('Database ready: items table ensured');
  } catch (err) {
    dbError = err.message;
    console.error('Database init failed:', err.message);
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 10_000) {
        reject(new Error('payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// ─── UI ────────────────────────────────────────────────────────────────

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dooor OS Test App</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a;
      color: #fafafa;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .container {
      max-width: 640px;
      width: 100%;
      padding: 2rem;
    }

    .logo {
      font-size: 3rem;
      font-weight: 800;
      background: linear-gradient(135deg, #6366f1, #8b5cf6, #a855f7);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 0.25rem;
    }

    .subtitle {
      color: #737373;
      font-size: 0.95rem;
      margin-bottom: 2.5rem;
    }

    .card {
      background: #171717;
      border: 1px solid #262626;
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1rem;
    }

    .card-title {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #737373;
      margin-bottom: 1rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.5rem 0;
      border-bottom: 1px solid #262626;
    }

    .row:last-child { border-bottom: none; }

    .label { color: #a3a3a3; font-size: 0.875rem; }

    .value {
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 0.8rem;
      color: #e5e5e5;
      background: #262626;
      padding: 0.2rem 0.6rem;
      border-radius: 6px;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.8rem;
      color: #4ade80;
      background: rgba(74, 222, 128, 0.1);
      padding: 0.2rem 0.7rem;
      border-radius: 20px;
      border: 1px solid rgba(74, 222, 128, 0.2);
    }

    .status-badge.error {
      color: #f87171;
      background: rgba(248, 113, 113, 0.1);
      border-color: rgba(248, 113, 113, 0.2);
    }

    .status-dot {
      width: 6px;
      height: 6px;
      background: currentColor;
      border-radius: 50%;
      animation: pulse 2s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    .metrics {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1rem;
    }

    .metric {
      text-align: center;
      padding: 1rem;
      background: #171717;
      border: 1px solid #262626;
      border-radius: 12px;
    }

    .metric-value {
      font-size: 1.5rem;
      font-weight: 700;
      color: #fafafa;
    }

    .metric-label {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #737373;
      margin-top: 0.25rem;
    }

    .footer {
      text-align: center;
      margin-top: 2rem;
      color: #525252;
      font-size: 0.8rem;
    }

    .footer a {
      color: #8b5cf6;
      text-decoration: none;
    }

    .footer a:hover { text-decoration: underline; }

    #uptime { font-variant-numeric: tabular-nums; }

    .form-row {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 0.75rem;
    }

    .input {
      flex: 1;
      background: #0a0a0a;
      border: 1px solid #262626;
      color: #fafafa;
      padding: 0.6rem 0.8rem;
      border-radius: 8px;
      font-size: 0.875rem;
      font-family: inherit;
    }

    .input:focus {
      outline: none;
      border-color: #6366f1;
    }

    .button {
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: white;
      border: none;
      padding: 0.6rem 1.1rem;
      border-radius: 8px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s;
    }

    .button:hover { opacity: 0.88; }
    .button:disabled { opacity: 0.4; cursor: not-allowed; }

    .button.secondary {
      background: #262626;
      color: #e5e5e5;
    }

    .items-list {
      max-height: 240px;
      overflow-y: auto;
      border-top: 1px solid #262626;
      margin-top: 0.5rem;
    }

    .item {
      padding: 0.6rem 0;
      border-bottom: 1px solid #1f1f1f;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.75rem;
    }

    .item:last-child { border-bottom: none; }

    .item-content {
      font-size: 0.88rem;
      color: #e5e5e5;
      word-break: break-word;
    }

    .item-time {
      font-size: 0.7rem;
      color: #737373;
      white-space: nowrap;
    }

    .empty {
      color: #525252;
      font-size: 0.85rem;
      text-align: center;
      padding: 1.5rem 0;
    }

    .error-box {
      background: rgba(248, 113, 113, 0.08);
      border: 1px solid rgba(248, 113, 113, 0.25);
      color: #fca5a5;
      padding: 0.6rem 0.8rem;
      border-radius: 8px;
      font-size: 0.8rem;
      margin-top: 0.5rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">Dooor OS</div>
    <p class="subtitle">Test application deployed on Dooor OS Runtime</p>

    <div class="metrics">
      <div class="metric">
        <div class="metric-value" id="uptime">0s</div>
        <div class="metric-label">Uptime</div>
      </div>
      <div class="metric">
        <div class="metric-value" id="requests">0</div>
        <div class="metric-label">Requests</div>
      </div>
      <div class="metric">
        <div class="metric-value" id="latency">-</div>
        <div class="metric-label">Latency</div>
      </div>
    </div>

    <div class="card" style="margin-top: 1rem;">
      <div class="card-title">
        <span>Database (items)</span>
        <span id="db-status" class="status-badge"><span class="status-dot"></span>checking…</span>
      </div>

      <div class="form-row">
        <input id="item-input" class="input" placeholder="New item content…" maxlength="280" />
        <button id="add-btn" class="button">Add AUTODEPLOYNEWW</button>
      </div>

      <div class="form-row">
        <button id="refresh-btn" class="button secondary" style="flex: 1;">Fetch items</button>
      </div>

      <div id="db-error" class="error-box" style="display:none;"></div>

      <div id="items-wrapper">
        <div id="items-list" class="items-list">
          <div class="empty">No items yet. Click "Fetch items" to load.</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">
        <span>Harbor AI</span>
        <span id="ai-status" class="status-badge"><span class="status-dot"></span>checking…</span>
      </div>

      <div class="form-row">
        <input id="ai-input" class="input" placeholder="Ask the LLM something…" maxlength="1000" />
        <button id="ai-btn" class="button">Send AUTO DEPLOY</button>
      </div>

      <div id="ai-error" class="error-box" style="display:none;"></div>

      <div id="ai-output" class="empty">No call yet. Type a prompt and hit Send.</div>

      <div class="row" style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #262626;">
        <span class="label">Project (App ID)</span>
        <span class="value" id="ai-project">-</span>
      </div>
      <div class="row">
        <span class="label">Config source</span>
        <span class="value" id="ai-config-source">-</span>
      </div>
      <div class="row">
        <span class="label">Active guards</span>
        <span class="value" id="ai-guards">-</span>
      </div>
      <div class="row">
        <span class="label">Active evals</span>
        <span class="value" id="ai-evals">-</span>
      </div>
      <div class="row">
        <span class="label">Last latency</span>
        <span class="value" id="ai-latency">-</span>
      </div>
      <div class="row">
        <span class="label">AI calls</span>
        <span class="value" id="ai-calls">0</span>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Runtime Info</div>
      <div class="row">
        <span class="label">Status</span>
        <span class="status-badge"><span class="status-dot"></span>Running</span>
      </div>
      <div class="row">
        <span class="label">Hostname</span>
        <span class="value" id="hostname">-</span>
      </div>
      <div class="row">
        <span class="label">Platform</span>
        <span class="value" id="platform">-</span>
      </div>
      <div class="row">
        <span class="label">Node.js</span>
        <span class="value" id="node">-</span>
      </div>
      <div class="row">
        <span class="label">Memory</span>
        <span class="value" id="memory">-</span>
      </div>
      <div class="row">
        <span class="label">Started At</span>
        <span class="value" id="started">-</span>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Environment</div>
      <div class="row">
        <span class="label">NODE_ENV</span>
        <span class="value" id="env">-</span>
      </div>
      <div class="row">
        <span class="label">PORT</span>
        <span class="value" id="port">-</span>
      </div>
      <div class="row">
        <span class="label">Deploy Provider</span>
        <span class="value">Kubernetes (K3s)</span>
      </div>
    </div>

    <div class="footer">
      Deployed with <a href="https://github.com/Dooor-AI/dooor-os">Dooor OS</a> &mdash; Open-source PaaS with AI governance
    </div>
  </div>

  <script>
    const start = new Date("STARTED_AT_PLACEHOLDER");

    function formatUptime(ms) {
      const s = Math.floor(ms / 1000);
      const d = Math.floor(s / 86400);
      const h = Math.floor((s % 86400) / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      if (d > 0) return d + 'd ' + h + 'h ' + m + 'm';
      if (h > 0) return h + 'h ' + m + 'm ' + sec + 's';
      if (m > 0) return m + 'm ' + sec + 's';
      return sec + 's';
    }

    function formatTime(iso) {
      try {
        return new Date(iso).toLocaleString();
      } catch { return iso; }
    }

    async function fetchInfo() {
      const t0 = performance.now();
      const res = await fetch('/api/info');
      const latency = Math.round(performance.now() - t0);
      const data = await res.json();

      document.getElementById('hostname').textContent = data.hostname;
      document.getElementById('platform').textContent = data.platform + ' ' + data.arch;
      document.getElementById('node').textContent = data.nodeVersion;
      document.getElementById('memory').textContent = data.memoryMb + ' MB used';
      document.getElementById('started').textContent = new Date(data.startedAt).toLocaleString();
      document.getElementById('env').textContent = data.env;
      document.getElementById('port').textContent = data.port;
      document.getElementById('requests').textContent = data.requests;
      document.getElementById('latency').textContent = latency + 'ms';

      const dbBadge = document.getElementById('db-status');
      if (data.db.ready) {
        dbBadge.className = 'status-badge';
        dbBadge.innerHTML = '<span class="status-dot"></span>connected';
      } else {
        dbBadge.className = 'status-badge error';
        dbBadge.innerHTML = '<span class="status-dot"></span>' + (data.db.error || 'not connected');
      }

      const aiBadge = document.getElementById('ai-status');
      const ai = data.ai || {};
      if (ai.ready) {
        aiBadge.className = 'status-badge';
        aiBadge.innerHTML = '<span class="status-dot"></span>' + ai.model + ' · harbor on';
      } else {
        aiBadge.className = 'status-badge error';
        aiBadge.innerHTML = '<span class="status-dot"></span>' + (ai.error || 'not configured');
      }
      const info = ai.info || {};
      document.getElementById('ai-project').textContent = info.project || '-';
      document.getElementById('ai-config-source').textContent =
        info.configSource ? (info.configError ? info.configSource + ' (err)' : info.configSource) : '-';
      document.getElementById('ai-guards').textContent =
        Array.isArray(info.guards) && info.guards.length ? info.guards.join(', ') : 'none';
      document.getElementById('ai-evals').textContent =
        Array.isArray(info.evals) && info.evals.length ? info.evals.join(', ') : 'none';
      document.getElementById('ai-calls').textContent = ai.calls || 0;
    }

    async function callAi() {
      const errBox = document.getElementById('ai-error');
      const out = document.getElementById('ai-output');
      const btn = document.getElementById('ai-btn');
      const input = document.getElementById('ai-input');
      const prompt = input.value.trim();

      errBox.style.display = 'none';
      if (!prompt) {
        errBox.textContent = 'Type a prompt first.';
        errBox.style.display = 'block';
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Calling…';
      out.className = 'empty';
      out.textContent = 'Waiting for the LLM…';

      try {
        const res = await fetch('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt }),
        });
        const body = await res.json();
        if (!res.ok) {
          if (body.blockedByGuard) {
            throw new Error('Blocked by guard ' + body.guardName + ': ' + body.error);
          }
          throw new Error(body.error || 'AI call failed');
        }
        out.className = 'item-content';
        out.textContent = body.output;
        document.getElementById('ai-latency').textContent = body.latencyMs + 'ms';
        fetchInfo();
      } catch (err) {
        out.className = 'empty';
        out.textContent = '';
        errBox.textContent = err.message;
        errBox.style.display = 'block';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Send';
      }
    }

    document.getElementById('ai-btn').addEventListener('click', callAi);
    document.getElementById('ai-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') callAi();
    });

    function renderItems(items) {
      const wrap = document.getElementById('items-list');
      if (!items.length) {
        wrap.innerHTML = '<div class="empty">No items yet.</div>';
        return;
      }
      wrap.innerHTML = items
        .map((it) => {
          const safe = String(it.content).replace(/[<>&]/g, (c) =>
            c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;',
          );
          return '<div class="item"><span class="item-content">' + safe +
                 '</span><span class="item-time">' + formatTime(it.created_at) + '</span></div>';
        })
        .join('');
    }

    function showError(msg) {
      const box = document.getElementById('db-error');
      if (!msg) { box.style.display = 'none'; return; }
      box.textContent = msg;
      box.style.display = 'block';
    }

    async function fetchItems() {
      showError('');
      const btn = document.getElementById('refresh-btn');
      btn.disabled = true;
      btn.textContent = 'Loading…';
      try {
        const res = await fetch('/api/items');
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'Failed to load items');
        renderItems(body.items || []);
      } catch (err) {
        showError(err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Fetch items';
      }
    }

    async function addItem() {
      showError('');
      const input = document.getElementById('item-input');
      const content = input.value.trim();
      if (!content) return;
      const btn = document.getElementById('add-btn');
      btn.disabled = true;
      try {
        const res = await fetch('/api/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'Failed to add item');
        input.value = '';
        await fetchItems();
      } catch (err) {
        showError(err.message);
      } finally {
        btn.disabled = false;
      }
    }

    document.getElementById('add-btn').addEventListener('click', addItem);
    document.getElementById('refresh-btn').addEventListener('click', fetchItems);
    document.getElementById('item-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addItem();
    });

    setInterval(() => {
      document.getElementById('uptime').textContent = formatUptime(Date.now() - start);
    }, 1000);

    fetchInfo();
    setInterval(fetchInfo, 5000);
  </script>
</body>
</html>`;

// ─── Server ────────────────────────────────────────────────────────────

let requestCount = 0;

const server = http.createServer(async (req, res) => {
  requestCount++;
  const reqStart = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - reqStart;
    console.log(JSON.stringify({
      level: 'info',
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      requestCount,
      timestamp: new Date().toISOString(),
    }));
  });

  try {
    if (req.url === '/api/info' && req.method === 'GET') {
      const mem = process.memoryUsage();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        memoryMb: Math.round(mem.rss / 1024 / 1024),
        startedAt,
        env: process.env.NODE_ENV || 'production',
        port,
        requests: requestCount,
        cpus: os.cpus().length,
        db: { ready: dbReady, error: dbError },
        ai: {
          ready: Boolean(llm),
          model: GEMINI_MODEL,
          calls: aiCallCount,
          error: llmError,
          info: llmInfo,
        },
      }));
    }

    if (req.url === '/api/ai' && req.method === 'POST') {
      if (!llm) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: llmError || 'LLM not ready' }));
      }
      const body = await readJsonBody(req);
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
      if (!prompt) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'prompt is required' }));
      }
      if (prompt.length > 1000) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'prompt is too long (max 1000 chars)' }));
      }

      const startedCallAt = Date.now();
      try {
        const response = await llm.invoke(prompt);
        const output =
          typeof response === 'string'
            ? response
            : response?.content ?? String(response);
        aiCallCount++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          output,
          model: GEMINI_MODEL,
          latencyMs: Date.now() - startedCallAt,
          info: llmInfo,
        }));
      } catch (err) {
        const blocked = err?.name === 'GuardBlockedException';
        console.error('LLM call failed:', err);
        res.writeHead(blocked ? 403 : 502, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          error: err.message || 'LLM call failed',
          blockedByGuard: blocked,
          guardName: blocked ? err.guardName : undefined,
        }));
      }
    }

    if (req.url === '/api/items' && req.method === 'GET') {
      if (!dbReady) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: dbError || 'Database not ready' }));
      }
      const { rows } = await pool.query(
        'SELECT id, content, created_at FROM items ORDER BY created_at DESC LIMIT 100',
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ items: rows }));
    }

    if (req.url === '/api/items' && req.method === 'POST') {
      if (!dbReady) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: dbError || 'Database not ready' }));
      }
      const body = await readJsonBody(req);
      const content = typeof body.content === 'string' ? body.content.trim() : '';
      if (!content) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'content is required' }));
      }
      if (content.length > 280) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'content is too long (max 280 chars)' }));
      }
      const { rows } = await pool.query(
        'INSERT INTO items (content) VALUES ($1) RETURNING id, content, created_at',
        [content],
      );
      res.writeHead(201, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ item: rows[0] }));
    }

    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok', dbReady }));
    }

    const page = html.replace('STARTED_AT_PLACEHOLDER', startedAt);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(page);
  } catch (err) {
    console.error('Request failed:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: err.message || 'Internal error' }));
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Dooor OS Test App running on port ${port}`);
  initDatabase();
  initLlm();
});
