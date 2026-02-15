/**
 * Public Capability Explorer
 * 
 * A self-contained HTML dashboard that showcases all registered capabilities,
 * their pricing, trust scores, success rates, and x402 payment info.
 * Served at GET /explorer — no auth required.
 * 
 * Fetches live data from the API endpoints to render the dashboard.
 */

export function generateExplorerHTML(baseUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CAP-402 Capability Explorer</title>
  <meta name="description" content="Explore all capabilities available on the CAP-402 autonomous agent network. Live pricing, trust scores, and x402 payment support.">
  <meta property="og:title" content="CAP-402 Capability Explorer">
  <meta property="og:description" content="The capability layer for autonomous agents. Discover, price, and invoke 22+ capabilities with x402 payment support.">
  <meta property="og:url" content="${baseUrl}/explorer">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    :root{--bg:#0a0a0a;--surface:#141414;--surface2:#1a1a1a;--border:#262626;--text:#e5e5e5;--text2:#a3a3a3;--accent:#22d3ee;--accent2:#06b6d4;--green:#22c55e;--red:#ef4444;--yellow:#eab308;--purple:#a855f7}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.5;min-height:100vh}
    a{color:var(--accent);text-decoration:none}
    a:hover{text-decoration:underline}
    .container{max-width:1200px;margin:0 auto;padding:0 24px}
    
    /* Header */
    header{border-bottom:1px solid var(--border);padding:20px 0;position:sticky;top:0;background:var(--bg);z-index:10;backdrop-filter:blur(12px)}
    .header-inner{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px}
    .logo{font-size:24px;font-weight:700;letter-spacing:-0.5px}
    .logo span{color:var(--accent)}
    .header-stats{display:flex;gap:24px;font-size:13px;color:var(--text2)}
    .header-stats .stat{display:flex;align-items:center;gap:6px}
    .header-stats .dot{width:8px;height:8px;border-radius:50%;background:var(--green);display:inline-block}
    .header-stats .dot.yellow{background:var(--yellow)}
    
    /* Hero */
    .hero{padding:48px 0 32px;text-align:center}
    .hero h1{font-size:36px;font-weight:700;letter-spacing:-1px;margin-bottom:12px}
    .hero h1 span{background:linear-gradient(135deg,var(--accent),var(--purple));-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .hero p{color:var(--text2);font-size:16px;max-width:600px;margin:0 auto 24px}
    .hero-badges{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
    .badge{padding:4px 12px;border-radius:20px;font-size:12px;font-weight:500;border:1px solid var(--border);color:var(--text2);background:var(--surface)}
    .badge.green{border-color:#22c55e40;color:var(--green);background:#22c55e10}
    .badge.cyan{border-color:#22d3ee40;color:var(--accent);background:#22d3ee10}
    .badge.purple{border-color:#a855f740;color:var(--purple);background:#a855f710}
    
    /* Search */
    .search-bar{margin:0 auto 32px;max-width:500px}
    .search-bar input{width:100%;padding:12px 16px;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:14px;outline:none;transition:border-color .2s}
    .search-bar input:focus{border-color:var(--accent)}
    .search-bar input::placeholder{color:#525252}
    
    /* Filters */
    .filters{display:flex;gap:8px;justify-content:center;margin-bottom:32px;flex-wrap:wrap}
    .filter-btn{padding:6px 16px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text2);font-size:13px;cursor:pointer;transition:all .2s}
    .filter-btn:hover,.filter-btn.active{border-color:var(--accent);color:var(--accent);background:#22d3ee08}
    
    /* Stats Grid */
    .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:40px}
    .stat-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px}
    .stat-card .label{font-size:12px;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px}
    .stat-card .value{font-size:28px;font-weight:700}
    .stat-card .sub{font-size:12px;color:var(--text2);margin-top:2px}
    
    /* Capability Cards */
    .cap-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px;margin-bottom:48px}
    .cap-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;transition:border-color .2s,transform .1s}
    .cap-card:hover{border-color:var(--accent);transform:translateY(-1px)}
    .cap-header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px}
    .cap-name{font-size:16px;font-weight:600}
    .cap-mode{padding:3px 8px;border-radius:6px;font-size:11px;font-weight:500}
    .cap-mode.public{background:#22c55e15;color:var(--green);border:1px solid #22c55e30}
    .cap-mode.confidential{background:#a855f715;color:var(--purple);border:1px solid #a855f730}
    .cap-id{font-size:12px;color:var(--text2);font-family:monospace;margin-bottom:8px}
    .cap-desc{font-size:13px;color:var(--text2);margin-bottom:12px;line-height:1.5}
    .cap-meta{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--text2)}
    .cap-meta .item{display:flex;align-items:center;gap:4px}
    .cap-tags{display:flex;gap:4px;flex-wrap:wrap;margin-top:10px}
    .tag{padding:2px 8px;border-radius:4px;font-size:11px;background:var(--surface2);color:var(--text2);border:1px solid var(--border)}
    .cap-footer{display:flex;align-items:center;justify-content:space-between;margin-top:14px;padding-top:12px;border-top:1px solid var(--border)}
    .cap-price{font-size:14px;font-weight:600;color:var(--accent)}
    .cap-sponsor{font-size:12px;color:var(--text2)}
    .x402-badge{padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;background:#22d3ee15;color:var(--accent);border:1px solid #22d3ee30;letter-spacing:0.5px}
    
    /* Try It */
    .try-section{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px;margin-bottom:16px;display:none}
    .try-section.visible{display:block}
    .try-section pre{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:16px;font-size:12px;overflow-x:auto;color:var(--accent);font-family:'SF Mono',Monaco,monospace;line-height:1.6}
    .try-btn{padding:6px 14px;border-radius:6px;border:1px solid var(--accent);background:transparent;color:var(--accent);font-size:12px;cursor:pointer;transition:all .2s}
    .try-btn:hover{background:var(--accent);color:var(--bg)}
    
    /* x402 Section */
    .x402-section{background:linear-gradient(135deg,#22d3ee08,#a855f708);border:1px solid var(--border);border-radius:16px;padding:32px;margin-bottom:48px}
    .x402-section h2{font-size:24px;font-weight:700;margin-bottom:8px}
    .x402-section h2 span{color:var(--accent)}
    .x402-section p{color:var(--text2);margin-bottom:20px}
    .x402-flow{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px}
    .flow-step{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px}
    .flow-step .num{font-size:24px;font-weight:700;color:var(--accent);margin-bottom:4px}
    .flow-step .title{font-size:14px;font-weight:600;margin-bottom:4px}
    .flow-step .desc{font-size:12px;color:var(--text2)}
    
    /* Footer */
    footer{border-top:1px solid var(--border);padding:24px 0;text-align:center;color:var(--text2);font-size:13px}
    
    /* Loading */
    .loading{text-align:center;padding:48px;color:var(--text2)}
    .spinner{width:32px;height:32px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 16px}
    @keyframes spin{to{transform:rotate(360deg)}}
    
    @media(max-width:768px){
      .hero h1{font-size:28px}
      .cap-grid{grid-template-columns:1fr}
      .stats-grid{grid-template-columns:repeat(2,1fr)}
      .x402-flow{grid-template-columns:1fr}
    }
  </style>
</head>
<body>
  <header>
    <div class="container header-inner">
      <div class="logo">CAP-<span>402</span></div>
      <div class="header-stats">
        <div class="stat"><span class="dot" id="health-dot"></span> <span id="health-text">Loading...</span></div>
        <div class="stat" id="uptime-stat"></div>
        <a href="/x402/info" style="font-size:13px">x402 Protocol</a>
        <a href="/capabilities" style="font-size:13px">API</a>
        <a href="/health/detailed" style="font-size:13px">Health</a>
      </div>
    </div>
  </header>

  <div class="container">
    <section class="hero">
      <h1>Capability <span>Explorer</span></h1>
      <p>Discover, price, and invoke capabilities on the autonomous agent network. All endpoints support the x402 payment protocol.</p>
      <div class="hero-badges">
        <span class="badge green">Live on Solana</span>
        <span class="badge cyan">x402 Protocol</span>
        <span class="badge purple">Privacy-Enabled</span>
        <span class="badge">Free API Access</span>
      </div>
    </section>

    <div class="search-bar">
      <input type="text" id="search" placeholder="Search capabilities... (e.g. price, swap, zk, fhe)">
    </div>

    <div class="filters" id="filters">
      <button class="filter-btn active" data-filter="all">All</button>
      <button class="filter-btn" data-filter="public">Public</button>
      <button class="filter-btn" data-filter="confidential">Confidential</button>
      <button class="filter-btn" data-filter="x402">x402 Enabled</button>
      <button class="filter-btn" data-filter="composable">Composable</button>
    </div>

    <div class="stats-grid" id="stats-grid">
      <div class="stat-card"><div class="label">Total Capabilities</div><div class="value" id="stat-total">-</div><div class="sub">Registered endpoints</div></div>
      <div class="stat-card"><div class="label">Public</div><div class="value" id="stat-public">-</div><div class="sub">Open execution</div></div>
      <div class="stat-card"><div class="label">Confidential</div><div class="value" id="stat-confidential">-</div><div class="sub">Privacy-preserving</div></div>
      <div class="stat-card"><div class="label">x402 Enabled</div><div class="value" id="stat-x402">-</div><div class="sub">Payment protocol</div></div>
    </div>

    <section class="x402-section">
      <h2>Native <span>x402</span> Payment Protocol</h2>
      <p>Every paid capability supports HTTP 402 — agents pay per invocation with USDC, SOL, or credits. No API keys needed.</p>
      <div class="x402-flow">
        <div class="flow-step"><div class="num">1</div><div class="title">Invoke</div><div class="desc">POST /invoke with capability_id and inputs</div></div>
        <div class="flow-step"><div class="num">2</div><div class="title">402 Response</div><div class="desc">Receive payment requirements with amount, networks, and methods</div></div>
        <div class="flow-step"><div class="num">3</div><div class="title">Pay</div><div class="desc">Send USDC on Solana/Base, SOL, or use credits</div></div>
        <div class="flow-step"><div class="num">4</div><div class="title">Execute</div><div class="desc">Resubmit with payment proof — capability executes instantly</div></div>
      </div>
    </section>

    <div id="cap-grid" class="cap-grid">
      <div class="loading"><div class="spinner"></div>Loading capabilities...</div>
    </div>
  </div>

  <footer>
    <div class="container">
      CAP-402 &mdash; The Capability Layer for Autonomous Agents &mdash; <a href="/capabilities">REST API</a> &middot; <a href="/x402/info">x402 Protocol</a> &middot; <a href="/health/detailed">System Health</a>
    </div>
  </footer>

  <script>
    const BASE = '';
    let allCaps = [];
    let currentFilter = 'all';

    async function init() {
      try {
        const [capsRes, healthRes, summaryRes] = await Promise.all([
          fetch(BASE + '/capabilities').then(r => r.json()),
          fetch(BASE + '/health/detailed').then(r => r.json()).catch(() => null),
          fetch(BASE + '/capabilities/summary').then(r => r.json()).catch(() => null)
        ]);

        allCaps = capsRes.capabilities || [];

        // Stats
        const pub = allCaps.filter(c => c.execution.mode === 'public').length;
        const conf = allCaps.filter(c => c.execution.mode === 'confidential').length;
        const x402Count = allCaps.filter(c => c.economics?.x402_payment_signal?.enabled).length;
        document.getElementById('stat-total').textContent = allCaps.length;
        document.getElementById('stat-public').textContent = pub;
        document.getElementById('stat-confidential').textContent = conf;
        document.getElementById('stat-x402').textContent = x402Count;

        // Health
        if (healthRes) {
          const dot = document.getElementById('health-dot');
          const txt = document.getElementById('health-text');
          dot.className = 'dot' + (healthRes.status === 'healthy' ? '' : ' yellow');
          txt.textContent = healthRes.status === 'healthy' ? 'All Systems Operational' : healthRes.status;
          document.getElementById('uptime-stat').textContent = 'Uptime: ' + Math.round(healthRes.uptime_seconds) + 's';
        }

        renderCaps(allCaps);
      } catch (e) {
        document.getElementById('cap-grid').innerHTML = '<div class="loading">Failed to load capabilities. Is the server running?</div>';
      }
    }

    function renderCaps(caps) {
      const grid = document.getElementById('cap-grid');
      if (!caps.length) {
        grid.innerHTML = '<div class="loading">No capabilities match your search.</div>';
        return;
      }
      grid.innerHTML = caps.map(c => {
        const mode = c.execution.mode;
        const cost = c.economics.cost_hint;
        const currency = c.economics.currency;
        const x402 = c.economics.x402_payment_signal?.enabled;
        const tags = (c.metadata?.tags || []).slice(0, 4);
        const latency = c.performance?.latency_hint || 'medium';
        const reliability = c.performance?.reliability_hint ? Math.round(c.performance.reliability_hint * 100) + '%' : '-';
        const composable = c.composable ? 'Yes' : 'No';
        const curlCmd = 'curl -X POST ' + window.location.origin + '/invoke -H "Content-Type: application/json" -d \\x27{"capability_id":"' + c.id + '","inputs":{' + (c.inputs.required || []).map(r => '"' + r + '":"..."').join(',') + '}}\\x27';

        return '<div class="cap-card" data-mode="' + mode + '" data-x402="' + x402 + '" data-composable="' + c.composable + '">' +
          '<div class="cap-header">' +
            '<div class="cap-name">' + esc(c.name) + '</div>' +
            '<span class="cap-mode ' + mode + '">' + mode + '</span>' +
          '</div>' +
          '<div class="cap-id">' + esc(c.id) + ' v' + esc(c.version) + '</div>' +
          '<div class="cap-desc">' + esc(c.description) + '</div>' +
          '<div class="cap-meta">' +
            '<div class="item">&#9889; ' + latency + ' latency</div>' +
            '<div class="item">&#10003; ' + reliability + ' reliable</div>' +
            '<div class="item">&#128260; Composable: ' + composable + '</div>' +
          '</div>' +
          (tags.length ? '<div class="cap-tags">' + tags.map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>' : '') +
          '<div class="cap-footer">' +
            '<div>' +
              '<div class="cap-price">' + cost + ' ' + currency + '</div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:8px">' +
              (x402 ? '<span class="x402-badge">x402</span>' : '') +
              '<button class="try-btn" onclick="toggleTry(this)">Try it</button>' +
            '</div>' +
          '</div>' +
          '<div class="try-section"><pre>' + esc(curlCmd).replace(/\\x27/g, "'") + '</pre></div>' +
        '</div>';
      }).join('');
    }

    function toggleTry(btn) {
      const section = btn.closest('.cap-card').querySelector('.try-section');
      section.classList.toggle('visible');
      btn.textContent = section.classList.contains('visible') ? 'Hide' : 'Try it';
    }

    function esc(s) { 
      if (!s) return '';
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); 
    }

    // Search
    document.getElementById('search').addEventListener('input', function(e) {
      const q = e.target.value.toLowerCase();
      const filtered = allCaps.filter(c => 
        c.name.toLowerCase().includes(q) || 
        c.id.toLowerCase().includes(q) || 
        c.description.toLowerCase().includes(q) ||
        (c.metadata?.tags || []).some(t => t.toLowerCase().includes(q))
      );
      applyFilter(filtered);
    });

    // Filters
    document.getElementById('filters').addEventListener('click', function(e) {
      if (!e.target.classList.contains('filter-btn')) return;
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentFilter = e.target.dataset.filter;
      const q = document.getElementById('search').value.toLowerCase();
      let filtered = allCaps;
      if (q) filtered = filtered.filter(c => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q) || c.description.toLowerCase().includes(q));
      applyFilter(filtered);
    });

    function applyFilter(caps) {
      let result = caps;
      if (currentFilter === 'public') result = caps.filter(c => c.execution.mode === 'public');
      else if (currentFilter === 'confidential') result = caps.filter(c => c.execution.mode === 'confidential');
      else if (currentFilter === 'x402') result = caps.filter(c => c.economics?.x402_payment_signal?.enabled);
      else if (currentFilter === 'composable') result = caps.filter(c => c.composable);
      renderCaps(result);
    }

    init();
  </script>
</body>
</html>`;
}
