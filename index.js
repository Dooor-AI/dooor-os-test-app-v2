const http = require('http');
const os = require('os');
const port = process.env.PORT || 3000;
const startedAt = new Date().toISOString();

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

    .status-dot {
      width: 6px;
      height: 6px;
      background: #4ade80;
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

    <div class="card">
      <div class="card-title">Custom Env Vars (from Dooor OS)</div>
      <div class="row">
        <span class="label">TESTE</span>
        <span class="value" id="env-teste">-</span>
      </div>
      <div class="row">
        <span class="label">TESTE2</span>
        <span class="value" id="env-teste2">-</span>
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
      document.getElementById('env-teste').textContent = data.teste;
      document.getElementById('env-teste2').textContent = data.teste2;
    }

    setInterval(() => {
      document.getElementById('uptime').textContent = formatUptime(Date.now() - start);
    }, 1000);

    fetchInfo();
    setInterval(fetchInfo, 5000);
  </script>
</body>
</html>`;

let requestCount = 0;

const server = http.createServer((req, res) => {
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

  if (req.url === '/api/info') {
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
      teste: process.env.TESTE || '(not set)',
      teste2: process.env.TESTE2 || '(not set)',
    }));
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok' }));
  }

  const page = html.replace('STARTED_AT_PLACEHOLDER', startedAt);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(page);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Dooor OS Test App running on port ${port}`);
});
