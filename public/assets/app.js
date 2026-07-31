/* =====================================================================
   FACTORY NETWORK CONTROL — Frontend Application
   Menggantikan window.storage dengan REST API + WebSocket realtime
   ===================================================================== */

/* ── 1. AUTH CHECK (jalankan sebelum apapun) ───────────────────────── */
(function checkAuth() {
  const token = localStorage.getItem('factory_jwt');
  if (!token) { window.location.replace('/login.html'); return; }
  try {
    const p = JSON.parse(atob(token.split('.')[1]));
    if (p.exp * 1000 < Date.now()) {
      localStorage.clear();
      window.location.replace('/login.html');
    }
  } catch (_) {
    localStorage.clear();
    window.location.replace('/login.html');
  }
})();

/* ── 2. API CLIENT ─────────────────────────────────────────────────── */
const api = {
  _getToken() { return localStorage.getItem('factory_jwt'); },
  async request(method, url, body) {
    const token = this._getToken();
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
      if (res.status === 401) {
        localStorage.clear();
        window.location.replace('/login.html');
        return null;
      }
      return res;
    } catch (err) {
      console.error(`[API] ${method} ${url} failed:`, err.message);
      throw err;
    }
  },
  get   : (url)        => api.request('GET',    url),
  post  : (url, body)  => api.request('POST',   url, body),
  put   : (url, body)  => api.request('PUT',    url, body),
  delete: (url)        => api.request('DELETE', url)
};

/* ── 3. KONSTANTA TOPOLOGI (sama seperti versi asli) ───────────────── */
const ZONES = [
  {key:'PRODUKSI', label:'Area Produksi Utama'},
  {key:'A', label:'Zona A'},{key:'B', label:'Zona B'},
  {key:'C', label:'Zona C'},{key:'D', label:'Zona D'},
  {key:'E', label:'Zona E'},{key:'F', label:'Zona F'},
  {key:'G', label:'Zona G'},{key:'H', label:'Zona H'},
  {key:'I', label:'Zona I'},{key:'J', label:'Zona J'},
  {key:'SECURITY', label:'Keamanan'},
  {key:'MESS', label:'Mess Karyawan'},
  {key:'GUDANG_EKS', label:'Gudang Eksternal'},
  {key:'INTI', label:'Inti Jaringan'},
  {key:'GUDANG_IT_AREA', label:'Area Gudang IT'},
  {key:'MULSA', label:'Area Mulsa'}
];

const RAW_LOCATIONS = [
  ['LAB SPRAYER','PRODUKSI'],['RUANG UKK','PRODUKSI'],['RUANG ATK','PRODUKSI'],['RUANG BENIH','PRODUKSI'],
  ['LAB LT. 1','PRODUKSI'],['LAB LT. 2','PRODUKSI'],['KANTOR PRODUKSI LT. 1','PRODUKSI'],['KANTOR PRODUKSI LT. 2','PRODUKSI'],
  ['GEDUNG A1','A'],['GEDUNG A2','A'],['GEDUNG A3','A'],['GEDUNG A3 - OFFICE','A'],
  ['GEDUNG B1 - PROD CF','B'],['GEDUNG B1 - OFFICE GUDANG RMT C12','B'],['GEDUNG B2','B'],['GEDUNG B3 - OFFICE MTC LT. 1','B'],
  ['GEDUNG B3 - MTC LT. 2','B'],['GEDUNG B4 - IF','B'],['GEDUNG B4 - IF OFFICE','B'],['GEDUNG B5 - MP','B'],
  ['GEDUNG C1 - GUDANG RMT MLS','C'],['GEDUNG C2 - PROD MLS','C'],['GEDUNG C2 - OFFICE MLS','C'],
  ['GEDUNG D1 - PROD BOTOL','D'],['GEDUNG D2 - PROD BOTOL','D'],['GEDUNG D2 - OFFICE BOTOL','D'],['GEDUNG D3','D'],
  ['GEDUNG D3 - OFFICE GUDANG RMT BTL','D'],['GEDUNG D4','D'],['GEDUNG D5 - MINI LAB','D'],
  ['GEDUNG E1','E'],['GEDUNG E1 - OFFICE','E'],['GEDUNG E2','E'],['GEDUNG E3','E'],['GEDUNG E3 - OFFICE REAKTOR','E'],
  ['GEDUNG E4','E'],['GEDUNG E5','E'],['GEDUNG E5 - OFFICE PRODUKSI MT','E'],
  ['GEDUNG F1','F'],['GEDUNG F1 - OFFICE GDG RMT','F'],['GEDUNG F2','F'],['GEDUNG F2 - OFFICE GDG RMT','F'],
  ['GEDUNG F3','F'],['GEDUNG F3 - OFFICE GDG RMT','F'],['GEDUNG F4','F'],['GEDUNG F4 - OFFICE PROD FL','F'],
  ['GEDUNG F5','F'],['GEDUNG F5 - OFFICE','F'],
  ['GEDUNG G1','G'],['GEDUNG G2','G'],
  ['GEDUNG H1','H'],['GEDUNG H2','H'],['GEDUNG H2 - OFFICE','H'],['GEDUNG H3','H'],
  ['GEDUNG I1','I'],['GEDUNG I2','I'],['GEDUNG I3','I'],['GEDUNG I3 - OFFICE GDG RMT','I'],['GEDUNG I4','I'],['GEDUNG I5','I'],
  ['GEDUNG J','J'],['GEDUNG J - OFFICE','J'],
  ['POS SECURITY','SECURITY'],
  ['MESS DALAM KABAG','MESS'],['MESS LAES - LAJANG','MESS'],['MESS LAES - KELUARGA','MESS'],
  ['MESS CIKANDE - DEPAN','MESS'],['MESS CIKANDE - BELAKANG','MESS'],
  ['GUDANG RMT LEGOK','GUDANG_EKS'],['GUDANG RMT CEMPLANG','GUDANG_EKS'],
  ['GUDANG IT','INTI'],['KANTOR BARU LT 1','INTI'],['KANTOR BARU LT 2','INTI'],
  ['QC LAB','GUDANG_IT_AREA'],['R&D PES','GUDANG_IT_AREA'],['OFFICE LAB','GUDANG_IT_AREA'],
  ['MUSHOLLA','GUDANG_IT_AREA'],['PRIMAXON','GUDANG_IT_AREA'],['KANTOR R&D PLS','GUDANG_IT_AREA'],
  ['MESIN','E'],['GUDANG BOTOL','D'],['KANTIN ATAS','E'],
  ['KANTOR GUDANG MULSA','MULSA'],['ATAS TANGGAL OFFICE MULSA','MULSA'],
  ['GERBANG PRODUKSI MULSA','MULSA'],['POS SECURITY MULSA','MULSA']
];

const SEED_LOCATIONS = RAW_LOCATIONS.map((r,i)=>({id:'l'+(i+1), nama:r[0], zone:r[1]}));

function findLocId(name){
  const l = SEED_LOCATIONS.find(x=>x.nama===name);
  return l ? l.id : null;
}

function B(label, locName, children){ return {kind:'building', label, locId: findLocId(locName), children: children||[]}; }
function N(label, children, extra){ return Object.assign({kind:'infra', label, children: children||[]}, extra||{}); }

const MIKROTIK_CBA = N('Mikrotik CBA', [
  N('Fortigate', [
    N('Switch MG HP Aruba', [
      N('Switch VLAN 2 CCTV', []),
      N('Lantai 1 Lab', [ B('QC Lab','QC LAB',[]), B('R&D PES','R&D PES',[]) ]),
      N('Lantai 2 Lab', [ B('Office Lab','OFFICE LAB',[]), B('Musholla','MUSHOLLA',[]) ]),
      N('Link FO Kantor Baru (202m)', [
        N('Convert FO to LAN', [
          N('Switch MG Distribusi', [
            N('Switch MG A', [ B('Kantor Baru LT 2','KANTOR BARU LT 2',[]) ]),
            N('Switch MG B', [ B('Kantor Baru LT 2','KANTOR BARU LT 2',[]) ]),
            N('Switch MG C', [ B('Kantor Baru LT 1','KANTOR BARU LT 1',[]) ]),
            N('Switch MG D', [ B('Kantor Baru LT 1','KANTOR BARU LT 1',[]) ]),
            N('Convert LAN to FO', [
              N('RM Gedung A3', [
                B('Gedung A1','GEDUNG A1',[]), B('Gedung A2','GEDUNG A2',[]),
                B('Gudang RMT C12','GEDUNG B1 - OFFICE GUDANG RMT C12',[]),
                B('Office MTC Lt. 1','GEDUNG B3 - OFFICE MTC LT. 1',[]),
                B('MTC Lt. 2','GEDUNG B3 - MTC LT. 2',[])
              ]),
              N('RM Kantor CF B2', [ B('Kantor CF B2','GEDUNG B1 - PROD CF',[]) ]),
              N('RM MP Baru B4',   [ B('MP Baru B4','GEDUNG B5 - MP',[]) ]),
              N('RM Gudang F5', [
                B('Gedung J','GEDUNG J',[]), B('Gedung F3','GEDUNG F3',[]),
                B('Mess Kabag','MESS DALAM KABAG',[])
              ]),
              N('RM Kantor F1', [ B('Gedung F4','GEDUNG F4',[]) ]),
              N('RM Gedung H2 Assembling', [ B('Gedung I3','GEDUNG I3',[]) ]),
              N('RM Kantor Methyl', [
                B('Kantor Reaktor','GEDUNG E3 - OFFICE REAKTOR',[]),
                B('Mesin','MESIN',[])
              ]),
              N('RM Mini Lab D5', [
                B('Gudang Botol','GUDANG BOTOL',[]),
                B('Officer D2','GEDUNG D2 - OFFICE BOTOL',[]),
                B('Gedung D1','GEDUNG D1 - PROD BOTOL',[])
              ]),
              N('RM Kantor Filling', [
                B('Gedung E3','GEDUNG E3',[]), B('Kantin Atas','KANTIN ATAS',[])
              ]),
              N('RM Kantor Mulsa', [
                B('Kantor Gudang Mulsa','KANTOR GUDANG MULSA',[]),
                B('Atas Tanggal Office Mulsa','ATAS TANGGAL OFFICE MULSA',[]),
                N('SW MG Gerbang Prod Mulsa', [ B('Gerbang Produksi Mulsa','GERBANG PRODUKSI MULSA',[]) ]),
                N('SW MG Pos Security',       [ B('Pos Security Mulsa','POS SECURITY MULSA',[]) ])
              ])
            ])
          ])
        ])
      ]),
      B('Primaxon','PRIMAXON',[]),
      B('Kantor R&D PLS','KANTOR R&D PLS',[])
    ])
  ])
], {id:'mikrotik_cba', extraParents:['mikrotik_maxindo']});

const NETWORK_TREE = B('GUDANG IT', 'GUDANG IT', [
  N('Fiber Optik STP', [
    N('ODP Fiber Optik STP', [ N('Mikrotik STP', [ MIKROTIK_CBA ]) ])
  ]),
  N('Fiber Optik Maxindo', [
    N('ODP Fiber Optik Maxindo', [
      N('Router FO Telkom / Radio Wireless FR BSM', [
        N('Mikrotik Maxindo', [], {id:'mikrotik_maxindo'})
      ])
    ])
  ])
]);

const DEVICE_TYPES = ['Router','Switch','Access Point','Server','CCTV','Modem/ONT','Lainnya'];
const OS_TYPES     = [{v:'mikrotik',l:'MikroTik'},{v:'linux',l:'Linux'},{v:'openwrt',l:'OpenWRT'},{v:'generic',l:'Generic'}];
const STATUS_LIST  = ['Online','Offline','Maintenance'];
const STATUS_COLOR = {Online:'var(--ok)', Offline:'var(--alert)', Maintenance:'var(--warn)', Unknown:'var(--idle)'};

/* ── 4. STATE ──────────────────────────────────────────────────────── */
let state = { locations: SEED_LOCATIONS, devices: {} };
let currentLocId    = null;
let editingDeviceId = null;
let currentUser     = null;

const $  = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}

/* ── 5. TOAST ──────────────────────────────────────────────────────── */
function showToast(msg, type='info') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show toast-'+type;
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2800);
}

/* ── 6. WEBSOCKET ──────────────────────────────────────────────────── */
let wsConn = null;
let wsRetryTimer = null;

function setWsStatus(status) {
  const dot  = $('#ws-dot');
  const lbl  = $('#ws-label');
  if (!dot) return;
  dot.className  = 'ws-dot ' + status;
  lbl.textContent = status === 'connected' ? 'Live' : status === 'reconnecting' ? 'Menghubungkan...' : 'Terputus';
}

function connectWebSocket() {
  if (wsConn && wsConn.readyState <= 1) return; // already connecting/connected
  clearTimeout(wsRetryTimer);
  setWsStatus('reconnecting');

  const token  = localStorage.getItem('factory_jwt');
  const proto  = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url    = `${proto}//${location.host}/ws?token=${encodeURIComponent(token)}`;

  wsConn = new WebSocket(url);

  wsConn.onopen = () => {
    setWsStatus('connected');
    console.log('[WS] Terhubung');
  };

  wsConn.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      if (msg.type === 'ping_update') handlePingUpdate(msg.results);
    } catch (_) {}
  };

  wsConn.onclose = (e) => {
    setWsStatus('disconnected');
    if (e.code === 4001) return; // unauthorized — jangan retry
    console.log('[WS] Putus, retry 5s...');
    wsRetryTimer = setTimeout(connectWebSocket, 5000);
  };

  wsConn.onerror = () => setWsStatus('reconnecting');
}

function handlePingUpdate(results) {
  let changed = false;
  results.forEach(r => {
    Object.values(state.devices).forEach(list => {
      const dev = list.find(d => d.id === r.device_id);
      if (dev) {
        dev.status       = r.status;
        dev.last_ping_ms = r.latency_ms;
        changed = true;
      }
    });
  });
  if (!changed) return;

  renderStats();
  renderSidebar();
  renderTopology();
  renderGridDashboard();
  if (currentLocId) renderDetail();
}

/* ── 7. DATA MANAGEMENT (API-based) ───────────────────────────────── */
async function loadDevices() {
  const res = await api.get('/api/devices');
  if (!res || !res.ok) return;
  const data = await res.json();
  state.devices = data.devices || {};
}

async function apiSaveDevice(locId, payload) {
  let res;
  if (editingDeviceId) {
    res = await api.put(`/api/devices/${editingDeviceId}`, payload);
  } else {
    res = await api.post('/api/devices', { loc_id: locId, ...payload });
  }
  if (!res || !res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Gagal menyimpan');
  }
  return (await res.json()).device;
}

async function apiDeleteDevice(deviceId) {
  const res = await api.delete(`/api/devices/${deviceId}`);
  if (!res || !res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Gagal menghapus');
  }
}

/* ── 8. USER INFO ──────────────────────────────────────────────────── */
function renderUserInfo() {
  const u = currentUser;
  if (!u) return;
  const el = $('#user-badge');
  if (!el) return;
  el.innerHTML = `
    <span class="u-role">${u.role.toUpperCase()}</span>
    <span class="u-name">${escapeHtml(u.username)}</span>
    <span>▾</span>
    <div class="user-menu">
      <button class="user-menu-item" onclick="openChangePwdModal(); closeUserMenu()">🔑 Ganti Password</button>
      <hr>
      <button class="user-menu-item danger" onclick="logout()">↪ Logout</button>
    </div>
  `;
  el.addEventListener('click', e => {
    e.stopPropagation();
    el.classList.toggle('open');
  });
}

function closeUserMenu() { const b = $('#user-badge'); if(b) b.classList.remove('open'); }
document.addEventListener('click', closeUserMenu);

function logout() {
  localStorage.clear();
  window.location.replace('/login.html');
}

/* ── 9. STATS BAR ──────────────────────────────────────────────────── */
function renderStats() {
  const totalLoc = state.locations.length;
  let totalDev=0, online=0, offline=0, maint=0, unknown=0;
  Object.values(state.devices).forEach(list => {
    list.forEach(d => {
      totalDev++;
      if      (d.status==='Online')      online++;
      else if (d.status==='Offline')     offline++;
      else if (d.status==='Maintenance') maint++;
      else                               unknown++;
    });
  });
  const bar = $('#stats-bar');
  if (!bar) return;
  bar.innerHTML = `
    <div class="stat-chip">Lokasi <b>${totalLoc}</b></div>
    <div class="stat-chip">Perangkat <b>${totalDev}</b></div>
    <div class="stat-chip"><span class="dot" style="background:var(--ok)"></span>Online <b>${online}</b></div>
    <div class="stat-chip"><span class="dot" style="background:var(--alert)"></span>Offline <b>${offline}</b></div>
    <div class="stat-chip"><span class="dot" style="background:var(--warn)"></span>Maint. <b>${maint}</b></div>
    <div class="ws-indicator"><span class="ws-dot" id="ws-dot"></span><span id="ws-label">Menghubungkan...</span></div>
  `;
}

/* ── 10. SIDEBAR ───────────────────────────────────────────────────── */
function locationsByZone(z){ return state.locations.filter(l=>l.zone===z); }
function deviceCount(id){ return (state.devices[id]||[]).length; }
function locationAggregateStatus(id){
  const devs = state.devices[id]||[];
  if (!devs.length) return 'idle';
  if (devs.some(d=>d.status==='Offline'))     return 'alert';
  if (devs.some(d=>d.status==='Maintenance')) return 'warn';
  if (devs.some(d=>d.status==='Unknown'))     return 'idle';
  return 'ok';
}
const AGG_COLOR = {ok:'var(--ok)', warn:'var(--warn)', alert:'var(--alert)', idle:'var(--idle)'};

function renderSidebar(){
  const container = $('#zone-list');
  if (!container) return;
  container.innerHTML='';
  ZONES.forEach(zone=>{
    const locs = locationsByZone(zone.key);
    if (!locs.length) return;
    const totalDev = locs.reduce((s,l)=>s+deviceCount(l.id),0);
    const group = document.createElement('div');
    group.className = 'zone-group';
    group.dataset.zone = zone.key;
    group.innerHTML = `
      <div class="zone-head" tabindex="0" role="button">
        <span class="zname"><span class="chevron">▶</span> ${zone.label}</span>
        <span class="zcount">${locs.length} lok · ${totalDev} dev</span>
      </div>
      <div class="zone-items"></div>
    `;
    const wrap = $('.zone-items', group);
    locs.forEach(loc=>{
      const item = document.createElement('div');
      item.className = 'loc-item';
      item.dataset.locId = loc.id;
      const agg = locationAggregateStatus(loc.id);
      item.innerHTML = `<span class="status-dot" style="background:${AGG_COLOR[agg]}"></span><span>${loc.nama}</span>`;
      item.addEventListener('click', ()=>openDetail(loc.id));
      wrap.appendChild(item);
    });
    const head = $('.zone-head', group);
    head.addEventListener('click', ()=>group.classList.toggle('open'));
    head.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); group.classList.toggle('open'); }});
    container.appendChild(group);
  });
  highlightActiveLoc();
}

function highlightActiveLoc(){
  $$('.loc-item').forEach(el=>el.classList.toggle('active', el.dataset.locId===currentLocId));
}

$('#search-input').addEventListener('input', e=>{
  const q = e.target.value.trim().toLowerCase();
  $$('.zone-group').forEach(g=>{
    let any=false;
    $$('.loc-item',g).forEach(item=>{
      const m = item.textContent.toLowerCase().includes(q);
      item.classList.toggle('hidden',!m);
      if(m) any=true;
    });
    g.classList.toggle('hidden',!any);
    if(q&&any) g.classList.add('open');
    if(!q) g.classList.remove('open');
  });
  renderGridDashboard();
});

/* ── 10.5 MODEL 1 DASHBOARD GRID VIEW ──────────────────────────────── */
function renderGridDashboard() {
  const panel = $('#grid-view-panel');
  if (!panel) return;

  const searchTerm = ($('#search-input') ? $('#search-input').value : '').toLowerCase().trim();

  let locs = SEED_LOCATIONS;

  if (searchTerm) {
    locs = locs.filter(l => l.nama.toLowerCase().includes(searchTerm) || l.zone.toLowerCase().includes(searchTerm));
  }

  if (locs.length === 0) {
    panel.innerHTML = `
      <div class="empty-state">
        <div class="big-icon">ðŸ”</div>
        <p>Tidak ada gedung atau lokasi yang cocok dengan "<b>${escapeHtml(searchTerm)}</b>"</p>
      </div>
    `;
    return;
  }

  let html = '<div class="grid-layout">';

  locs.forEach(loc => {
    const devs = state.devices[loc.id] || [];
    const total = devs.length;
    const online = devs.filter(d => d.status === 'Online').length;
    const offline = devs.filter(d => d.status === 'Offline').length;
    const maint = devs.filter(d => d.status === 'Maintenance').length;

    let statusClass = 'status-idle';
    let badgeHtml = '<span class="bcard-badge idle">⚪ Belum Ada Data</span>';

    if (total > 0) {
      if (offline > 0) {
        statusClass = 'status-alert';
        badgeHtml = `<span class="bcard-badge alert">⚠️ï¸ ${offline} Down</span>`;
      } else if (maint > 0) {
        statusClass = 'status-warn';
        badgeHtml = `<span class="bcard-badge warn">ðŸ› ï¸ Maintenance</span>`;
      } else if (online === total) {
        statusClass = 'status-ok';
        badgeHtml = `<span class="bcard-badge ok">✓ Semua Online (${online})</span>`;
      } else {
        statusClass = 'status-idle';
        badgeHtml = `<span class="bcard-badge idle">⚪ Partial Online</span>`;
      }
    }

    const previewDevs = devs.slice(0, 3);
    let devListHtml = '';

    if (previewDevs.length > 0) {
      devListHtml = previewDevs.map(d => `
        <div class="bcard-dev-item">
          <div class="bcard-dev-info">
            <span class="bcard-dev-dot ${d.status === 'Online' ? 'online' : 'offline'}"></span>
            <span class="bcard-dev-name">${escapeHtml(d.nama)}</span>
          </div>
          <span class="bcard-dev-ip">${escapeHtml(d.ip || 'No IP')} ${d.last_ping_ms != null ? `(${d.last_ping_ms}ms)` : ''}</span>
        </div>
      `).join('');
    } else {
      devListHtml = '<div style="font-size:12px;color:var(--text-muted);font-style:italic;padding:4px 0">Belum ada perangkat terdaftar</div>';
    }
    const zoneObj = ZONES.find(z => z.key === loc.zone);
    const zoneLabel = zoneObj ? zoneObj.label : loc.zone;

    html += `
      <div class="bcard ${statusClass}">
        <div class="bcard-head">
          <div>
            <span class="bcard-zone">${escapeHtml(zoneLabel)}</span>
            <h3 class="bcard-title">${escapeHtml(loc.nama)}</h3>
          </div>
          ${badgeHtml}
        </div>
        <div class="bcard-stats">
          <div>
            <div class="bstat-val ok">${online}</div>
            <div class="bstat-lbl">Online</div>
          </div>
          <div>
            <div class="bstat-val alert">${offline}</div>
            <div class="bstat-lbl">Offline</div>
          </div>
          <div>
            <div class="bstat-val total">${total}</div>
            <div class="bstat-lbl">Total</div>
          </div>
        </div>
        <div class="bcard-devices">
          ${devListHtml}
        </div>
        <div class="bcard-foot">
          <button class="bcard-btn" onclick="openDetail('${loc.id}')">Lihat Detail Gedung →</button>
        </div>
      </div>
    `;
  });

  html += '</div>';
  panel.innerHTML = html;
}

/* ── 11. TOPOLOGY — Hierarchical Tree Table ──────────────────────────── */

/* Assign stable UIDs to every node in the tree (run once at load) */
let _uidSeq = 0;
(function _uid(n){ n._uid = ++_uidSeq; (n.children||[]).forEach(_uid); })(NETWORK_TREE);

/* Nodes that start collapsed */
const collapsedNodes = new Set();
(function _initColl(n){
  /* Collapse "Link FO Kantor Baru" subtree by default — it's huge */
  if (n.label && n.label.startsWith('Link FO')) collapsedNodes.add(n._uid);
  (n.children||[]).forEach(_initColl);
})(NETWORK_TREE);

/* Get all currently-visible leaf paths (respects collapsed nodes) */
function _leafPaths(node, path){
  path = (path||[]).concat(node);
  const ch = node.children||[];
  if (!ch.length || collapsedNodes.has(node._uid)) return [path];
  return ch.reduce((a,c) => a.concat(_leafPaths(c, path)), []);
}

function escapeSvg(s){ return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;'); }

/* Build the HTML for the hierarchical table */
function buildTopoTable(){
  const paths  = _leafPaths(NETWORK_TREE, []);
  const maxCol = Math.max(...paths.map(p => p.length - 1));

  /* Precompute rowspan: first occurrence row & total span for each node */
  const rsMap = new Map();
  paths.forEach((path, ri) => {
    path.forEach(n => {
      if (!rsMap.has(n)) rsMap.set(n, { rowStart: ri, span: 1 });
      else               rsMap.get(n).span++;
    });
  });

  let h = '';

  paths.forEach((path, ri) => {
    h += '<tr class="topo-row">';
    /* Row number (first column) — only on first row */
    if (ri === 0 || rsMap.get(path[0]).rowStart === ri) {
      // handled inside path loop for root
    }

    for (let ci = 0; ci < path.length; ci++) {
      const node = path[ci];
      const rs   = rsMap.get(node);
      if (rs.rowStart !== ri) continue; /* already rendered via rowspan */

      const isLast   = ci === path.length - 1;
      const colspan  = isLast && ci < maxCol ? maxCol - ci + 1 : 1;
      const hasKids  = (node.children||[]).length > 0;
      const isColl   = collapsedNodes.has(node._uid);
      const isBldg   = node.kind === 'building';
      const locId    = node.locId || '';
      const agg      = isBldg && locId ? locationAggregateStatus(locId) : 'idle';
      const cnt      = isBldg && locId ? deviceCount(locId) : 0;

      let cls = 'tc';
      if (isBldg)       cls += ' tc-bldg';
      else if (hasKids) cls += ' tc-parent';
      else              cls += ' tc-leaf';
      if (isColl)       cls += ' tc-coll';
      if (ci === 0)     cls += ' tc-root';
      cls += ` s-${agg}`;

      const onclick = isBldg && locId
        ? `openDetail('${locId}')`
        : hasKids ? `_tt(${node._uid})` : '';

      h += `<td class="${cls}" rowspan="${rs.span}" colspan="${colspan}"${onclick ? ` onclick="${onclick}"` : ''} title="${escapeSvg(node.label)}">`;
      h += `<div class="tc-in">`;
      if (hasKids) h += `<span class="tc-chev">${isColl ? '▶' : '▼'}</span>`;
      else         h += `<span class="tc-dot"></span>`;
      h += `<span class="tc-lbl">${escapeSvg(node.label)}</span>`;
      if (cnt > 0) h += `<span class="tc-cnt s-${agg}">${cnt}</span>`;
      h += `</div></td>`;
    }
    h += '</tr>';
  });

  return h;
}

/* Toggle collapse state and re-render */
function _tt(uid){
  if (collapsedNodes.has(uid)) collapsedNodes.delete(uid);
  else collapsedNodes.add(uid);
  renderTopology();
}

function renderTopology(){
  const inner = $('#topo-inner');
  if (!inner) return;
  inner.innerHTML =
    `<div class="topo-th-wrap">` +
    `<div class="topo-legend-row">` +
    `<span class="tl-dot s-ok"></span>Online&nbsp;&nbsp;` +
    `<span class="tl-dot s-alert"></span>Offline&nbsp;&nbsp;` +
    `<span class="tl-dot s-warn"></span>Maintenance&nbsp;&nbsp;` +
    `<span class="tl-dot s-idle"></span>Belum Ada Data&nbsp;&nbsp;` +
    `<span style="margin-left:12px;color:var(--text-muted)">▶ = klik untuk expand/collapse</span>` +
    `</div>` +
    `<div class="topo-table-scroll">` +
    `<table class="topo-htable"><tbody>${buildTopoTable()}</tbody></table>` +
    `</div></div>`;
}

function setupPanZoom(){
  /* Table view: no SVG pan/zoom needed — hide old controls */
  const ctrl = document.querySelector('.topo-controls');
  if (ctrl) ctrl.style.display = 'none';
  const hint = document.querySelector('#view-topo .hint');
  if (hint) hint.style.display = 'none';
}


/* ── 12. TABS ──────────────────────────────────────────────────────── */
function switchTab(name){
  $$('.tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
  $('#view-grid').classList.toggle('active', name==='grid');
  $('#view-topo').classList.toggle('active', name==='topo');
  $('#view-detail').classList.toggle('active', name==='detail');
  if(name==='grid') renderGridDashboard();
}
$$('.tab-btn').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));

/* ── 13. DETAIL PANEL ──────────────────────────────────────────────── */
function openDetail(locId){ currentLocId=locId; editingDeviceId=null; switchTab('detail'); renderDetail(); highlightActiveLoc(); }

function latencyChip(ms){
  if(ms==null) return '';
  const cls = ms<30?'good':ms<100?'warn':'bad';
  return `<span class="latency-chip ${cls}">${ms}ms</span>`;
}

function statusBadge(status){
  const color = STATUS_COLOR[status]||'var(--idle)';
  return `<span class="status-badge" style="background:rgba(255,255,255,.05);color:${color}"><span class="d" style="background:${color}"></span>${status}</span>`;
}

function renderDetail(){
  const panel=$('#detail-panel');
  if(!panel) return;
  if(!currentLocId){
    panel.innerHTML=`<div class="empty-state"><div class="big-icon">âŒ</div><div>Pilih gedung atau lokasi dari daftar / peta topologi<br>untuk melihat data perangkatnya.</div></div>`;
    return;
  }
  const loc  = state.locations.find(l=>l.id===currentLocId);
  const zone = ZONES.find(z=>z.key===loc.zone);
  const devices = state.devices[currentLocId]||[];
  const isAdmin = currentUser && currentUser.role==='admin';

  const rows = devices.map(d=>`
    <tr>
      <td>${escapeHtml(d.nama)}</td>
      <td>${escapeHtml(d.tipe)}</td>
      <td>${escapeHtml(d.merk||'—')}</td>
      <td class="ip-cell">${escapeHtml(d.ip||'—')} ${d.ip?`<button class="icon-btn" title="Ping sekarang" onclick="pingNow('${d.id}','${d.ip}',this)">⟳</button>`:''}</td>
      <td>${statusBadge(d.status)} ${latencyChip(d.last_ping_ms)}</td>
      <td>${escapeHtml(d.catatan||'—')}</td>
      <td><div class="row-actions">
        ${isAdmin?`<button class="icon-btn" title="Ubah" onclick="editDevice('${d.id}')">✍</button>`:''}
        <button class="icon-btn" title="Riwayat Ping" onclick="openHistoryModal('${d.id}')">📊</button>
        ${isAdmin&&d.ip?`<button class="icon-btn" title="Reboot SSH" onclick="openRebootModal('${d.id}')">↺</button>`:''}
        ${isAdmin?`<button class="icon-btn danger" title="Hapus" onclick="deleteDevice('${d.id}')">✖</button>`:''}
      </div></td>
    </tr>
  `).join('');

  panel.innerHTML=`
    <button class="back-link" onclick="switchTab('topo')">← Kembali ke Peta Topologi</button>
    <div class="detail-head">
      <div>
        <h2>${escapeHtml(loc.nama)}</h2>
        <span class="zone-badge">${zone?zone.label:loc.zone}</span>
      </div>
      ${isAdmin?`
        <div style="display:flex;gap:8px">
          <button class="add-btn" style="background:var(--panel-2);border-color:var(--border);color:var(--text)" onclick="scanNetwork()">🔍 Pindai Jaringan</button>
          <button class="add-btn" onclick="openDeviceForm()">+ Tambah Perangkat</button>
        </div>`:''}
    </div>
    ${devices.length===0?'<div class="no-devices">Belum ada perangkat terdata di lokasi ini.</div>':`
    <table class="device-table">
      <thead><tr><th>Nama</th><th>Tipe</th><th>Merk/Model</th><th>IP Address</th><th>Status</th><th>Catatan</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`}
    <div class="device-form" id="device-form"></div>
  `;
}

/* ── 14. DEVICE FORM ───────────────────────────────────────────────── */
function openDeviceForm(deviceId){
  editingDeviceId = deviceId||null;
  const form = $('#device-form');
  if(!form) return;

  const d = deviceId ? (state.devices[currentLocId]||[]).find(x=>x.id===deviceId) : null;
  const osOptions = OS_TYPES.map(o=>`<option value="${o.v}"${d&&d.device_os===o.v?' selected':''}>${o.l}</option>`).join('');

  form.innerHTML=`
    <p class="form-title" style="color:var(--accent);font-family:var(--mono);font-size:12px;margin:0 0 14px;text-transform:uppercase;letter-spacing:.5px">
      ${deviceId?'✍ Ubah Perangkat':'+ Tambah Perangkat'}
    </p>
    <div class="form-grid">
      <div class="field"><label>Nama Perangkat</label><input id="f-nama" placeholder="cth. Switch Lantai 1" value="${escapeHtml(d?d.nama:'')}"></div>
      <div class="field"><label>Tipe</label><select id="f-tipe">${DEVICE_TYPES.map(t=>`<option value="${t}"${d&&d.tipe===t?' selected':''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label>Merk / Model</label><input id="f-merk" placeholder="cth. Cisco SG350" value="${escapeHtml(d?d.merk||'':'')}"></div>
      <div class="field"><label>IP Address</label><input id="f-ip" placeholder="cth. 10.10.5.2" value="${escapeHtml(d?d.ip||'':'')}"></div>
      <div class="field"><label>MAC Address</label><input id="f-mac" placeholder="cth. AA:BB:CC:DD:EE:FF" value="${escapeHtml(d?d.mac||'':'')}"></div>
      <div class="field"><label>Status</label><select id="f-status">${STATUS_LIST.map(s=>`<option value="${s}"${d&&d.status===s?' selected':(!d&&s==='Unknown'?' selected':'') }>${s}</option>`).join('')}</select></div>
      <div class="field span-3"><label>Catatan</label><textarea id="f-catatan" rows="2" placeholder="Catatan tambahan (opsional)">${escapeHtml(d?d.catatan||'':'')}</textarea></div>
    </div>
    <div class="ssh-section">
      <button type="button" class="ssh-toggle" id="ssh-toggle" onclick="toggleSshSection()">
        <span class="chevron">▶</span> Pengaturan SSH (Reboot)
      </button>
      <div class="ssh-fields" id="ssh-fields">
        <div class="form-grid">
          <div class="field"><label>SSH Username</label><input id="f-ssh-user" placeholder="admin" value="${escapeHtml(d?d.ssh_user||'':'')}"></div>
          <div class="field"><label>SSH Password</label><input type="password" id="f-ssh-pass" placeholder="••••••••"></div>
          <div class="field"><label>SSH Port</label><input id="f-ssh-port" type="number" placeholder="22" value="${d?d.ssh_port||22:22}"></div>
          <div class="field"><label>OS Device</label><select id="f-device-os">${osOptions}</select></div>
        </div>
      </div>
    </div>
    <div class="form-actions">
      <button class="btn-secondary" onclick="closeDeviceForm()">Batal</button>
      <button class="btn-primary" onclick="submitDeviceForm()">Simpan</button>
    </div>
  `;
  form.classList.add('open');
  form.scrollIntoView({behavior:'smooth', block:'nearest'});
  $('#f-nama').focus();
}

function toggleSshSection(){
  const btn = $('#ssh-toggle'), flds = $('#ssh-fields');
  if(!btn||!flds) return;
  btn.classList.toggle('open');
  flds.style.display = btn.classList.contains('open')?'block':'none';
}

function closeDeviceForm(){
  editingDeviceId=null;
  const f=$('#device-form');
  if(f){ f.classList.remove('open'); f.innerHTML=''; }
}

async function submitDeviceForm(){
  const nama = $('#f-nama').value.trim();
  if(!nama){ showToast('Nama perangkat wajib diisi','error'); $('#f-nama').focus(); return; }
  const payload = {
    nama,
    tipe      : $('#f-tipe').value,
    merk      : $('#f-merk').value.trim(),
    ip        : $('#f-ip').value.trim(),
    mac       : $('#f-mac').value.trim(),
    status    : $('#f-status').value,
    catatan   : $('#f-catatan').value.trim(),
    ssh_user  : ($('#f-ssh-user')||{}).value?.trim()||'',
    ssh_pass  : ($('#f-ssh-pass')||{}).value||'',
    ssh_port  : parseInt(($('#f-ssh-port')||{}).value)||22,
    device_os : ($('#f-device-os')||{}).value||'generic'
  };
  try {
    const device = await apiSaveDevice(currentLocId, payload);
    if(!state.devices[currentLocId]) state.devices[currentLocId]=[];
    if(editingDeviceId){
      const idx=state.devices[currentLocId].findIndex(d=>d.id===editingDeviceId);
      if(idx>-1) state.devices[currentLocId][idx]=device;
    } else {
      state.devices[currentLocId].push(device);
    }
    editingDeviceId=null;
    closeDeviceForm();
    renderDetail(); renderSidebar(); renderStats(); renderTopology();
    showToast('Data perangkat tersimpan','ok');
  } catch(err){
    showToast('Error: '+err.message,'error');
  }
}

function editDevice(id){ openDeviceForm(id); }

async function deleteDevice(id){
  if(!confirm('Hapus perangkat ini dari daftar?')) return;
  try {
    await apiDeleteDevice(id);
    state.devices[currentLocId]=(state.devices[currentLocId]||[]).filter(d=>d.id!==id);
    renderDetail(); renderSidebar(); renderStats(); renderTopology();
    showToast('Perangkat dihapus','info');
  } catch(err){
    showToast('Error: '+err.message,'error');
  }
}

/* ── 15. PING NOW (on-demand) ──────────────────────────────────────── */
async function pingNow(deviceId, ip, btn){
  btn.classList.add('spinning');
  btn.disabled=true;
  try {
    const res  = await api.get(`/api/ping/now/${encodeURIComponent(ip)}`);
    const data = await res.json();
    if(data.online){
      showToast(`${ip} → Online · ${data.latency_ms}ms`,'ok');
      // Update local state
      Object.values(state.devices).forEach(list=>{
        const dev=list.find(d=>d.id===deviceId);
        if(dev){ dev.status='Online'; dev.last_ping_ms=data.latency_ms; }
      });
    } else {
      showToast(`${ip} → Offline (tidak merespons)`,'error');
      Object.values(state.devices).forEach(list=>{
        const dev=list.find(d=>d.id===deviceId);
        if(dev){ dev.status='Offline'; dev.last_ping_ms=null; }
      });
    }
    renderStats(); renderSidebar(); renderTopology(); if(currentLocId) renderDetail();
  } catch(e){ showToast('Ping error: '+e.message,'error'); }
  btn.classList.remove('spinning');
  btn.disabled=false;
}

/* ── 16. PING HISTORY MODAL ────────────────────────────────────────── */
let histChart = null;

function openHistoryModal(deviceId){
  const modal = $('#history-modal');
  if(!modal) return;
  modal.classList.add('open');
  loadPingHistory(deviceId);
}

function closeHistoryModal(){
  const modal = $('#history-modal');
  if(modal) modal.classList.remove('open');
  if(histChart){ histChart.destroy(); histChart=null; }
}

async function loadPingHistory(deviceId, hours=24){
  const body  = $('#hist-body');
  if(body) body.innerHTML='<p style="text-align:center;color:var(--text-muted);font-family:var(--mono);font-size:12px;padding:20px">Memuat data...</p>';

  const res  = await api.get(`/api/ping/history/${deviceId}?hours=${hours}`);
  if(!res||!res.ok){ if(body) body.innerHTML='<p style="color:var(--alert);text-align:center">Gagal memuat history</p>'; return; }
  const data = await res.json();
  const s    = data.stats;

  const modalTitle = $('#hist-title');
  if(modalTitle) modalTitle.textContent = `📊 Riwayat Ping — ${data.device_name} (${data.device_ip||'—'})`;

  if(!body) return;

  // Period selector
  const periodHtml = [6,24,48,168].map(h=>`
    <button class="icon-btn${hours===h?' active':''}" onclick="loadPingHistory('${deviceId}',${h})" style="min-width:44px;font-size:11px;padding:4px 8px">
      ${h<24?h+'j':h/24+'hr'}
    </button>
  `).join('');

  body.innerHTML=`
    <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;align-items:center">
      <span style="font-family:var(--mono);font-size:10px;color:var(--text-muted)">Periode:</span>
      ${periodHtml}
    </div>
    <div class="hist-stats">
      <div class="hist-stat">
        <div class="hs-val" style="color:${s.uptime_pct>=90?'var(--ok)':s.uptime_pct>=70?'var(--warn)':'var(--alert)'}">${s.uptime_pct??'—'}%</div>
        <div class="hs-lbl">Uptime</div>
      </div>
      <div class="hist-stat">
        <div class="hs-val" style="color:var(--accent)">${s.avg_latency_ms??'—'}<span style="font-size:11px">ms</span></div>
        <div class="hs-lbl">Avg Latency</div>
      </div>
      <div class="hist-stat">
        <div class="hs-val">${s.online}<span style="font-size:11px;color:var(--text-muted)">/${s.total}</span></div>
        <div class="hs-lbl">Online / Total Check</div>
      </div>
    </div>
    <div class="chart-wrap"><canvas id="hist-chart"></canvas></div>
    ${s.total===0?'<p style="text-align:center;color:var(--text-muted);font-family:var(--mono);font-size:12px;margin-top:12px">Belum ada data ping untuk periode ini.</p>':''}
  `;

  if(data.history.length>0 && window.Chart){
    if(histChart){ histChart.destroy(); histChart=null; }
    const ctx = $('#hist-chart').getContext('2d');
    const labels   = data.history.map(r=>r.pinged_at.slice(11,16));
    const latency  = data.history.map(r=>r.is_online ? (r.latency_ms||0) : null);
    const offline  = data.history.map(r=>r.is_online ? null : 0);
    histChart = new Chart(ctx,{
      type:'line',
      data:{
        labels,
        datasets:[
          {
            label:'Latency (ms)',
            data:latency,
            borderColor:'rgba(47,184,198,.8)',
            backgroundColor:'rgba(47,184,198,.1)',
            borderWidth:1.5,
            pointRadius:0,
            pointHoverRadius:3,
            fill:true,
            tension:.3,
            spanGaps:false
          }
        ]
      },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false}, tooltip:{
          callbacks:{ label: ctx => ctx.raw!=null?`${ctx.raw}ms`:'Offline' }
        }},
        scales:{
          x:{ ticks:{color:'#5a7a98',font:{family:'IBM Plex Mono',size:9},maxTicksLimit:12}, grid:{color:'rgba(26,45,74,.5)'} },
          y:{ ticks:{color:'#5a7a98',font:{family:'IBM Plex Mono',size:9}}, grid:{color:'rgba(26,45,74,.5)'}, beginAtZero:true }
        }
      }
    });
  }
}

/* ── 17. REBOOT MODAL ──────────────────────────────────────────────── */
let rebootDeviceId = null;

function openRebootModal(deviceId){
  rebootDeviceId = deviceId;
  const device = Object.values(state.devices).flat().find(d=>d.id===deviceId);
  if(!device) return;

  const modal = $('#reboot-modal');
  const body  = $('#reboot-body');
  if(!modal||!body) return;

  body.innerHTML=`
    <div class="reboot-device-info">
      <div class="di-name">⚡ ${escapeHtml(device.nama)}</div>
      <div class="di-ip">${device.ip} · ${device.tipe} · ${device.device_os||'generic'}</div>
    </div>
    <div class="form-grid" style="margin-bottom:12px">
      <div class="field"><label>SSH Username</label><input id="r-ssh-user" value="${escapeHtml(device.ssh_user||'')}" placeholder="admin"></div>
      <div class="field"><label>SSH Password</label><input type="password" id="r-ssh-pass" placeholder="••••••••"></div>
      <div class="field"><label>SSH Port</label><input id="r-ssh-port" type="number" value="${device.ssh_port||22}"></div>
    </div>
    <div style="margin-bottom:14px">
      <button class="btn-test-ssh" onclick="testSSHConn('${deviceId}')">🔌 Test Koneksi SSH</button>
      <span id="ssh-test-result" style="font-family:var(--mono);font-size:11px;margin-left:10px;color:var(--text-muted)"></span>
    </div>
    <div style="margin-bottom:10px">
      <label style="font-family:var(--mono);font-size:10.5px;color:var(--text-muted);display:block;margin-bottom:6px">Ketik <b style="color:var(--alert)">REBOOT</b> untuk konfirmasi:</label>
      <input class="reboot-confirm-input" id="reboot-confirm" placeholder="REBOOT" oninput="checkRebootConfirm()">
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn-secondary" onclick="closeRebootModal()">Batal</button>
      <button class="btn-danger" id="btn-do-reboot" disabled onclick="doReboot()">↺ Reboot Sekarang</button>
    </div>
    <div id="reboot-log" style="margin-top:14px;font-family:var(--mono);font-size:11px;color:var(--text-muted);display:none"></div>
  `;

  modal.classList.add('open');
}

function closeRebootModal(){ const m=$('#reboot-modal'); if(m) m.classList.remove('open'); rebootDeviceId=null; }
function checkRebootConfirm(){
  const v=$('#reboot-confirm').value;
  const btn=$('#btn-do-reboot');
  if(btn) btn.disabled = v!=='REBOOT';
}

async function testSSHConn(deviceId){
  const result = $('#ssh-test-result');
  if(result){ result.textContent='Menguji koneksi...'; result.style.color='var(--text-muted)'; }
  try {
    const res  = await api.post('/api/control/ssh-test',{
      device_id: deviceId,
      ssh_user: $('#r-ssh-user').value,
      ssh_pass: $('#r-ssh-pass').value,
      ssh_port: parseInt($('#r-ssh-port').value)||22
    });
    const data = await res.json();
    if(result){
      result.textContent = data.success ? '✓ '+data.message : '✗ '+data.error;
      result.style.color = data.success ? 'var(--ok)' : 'var(--alert)';
    }
  } catch(e){
    if(result){ result.textContent='✗ '+e.message; result.style.color='var(--alert)'; }
  }
}

async function doReboot(){
  if(!rebootDeviceId) return;
  const btn = $('#btn-do-reboot');
  const log = $('#reboot-log');
  if(btn){ btn.disabled=true; btn.textContent='Mengirim perintah...'; }
  if(log){ log.style.display='block'; log.textContent='Connecting via SSH...'; }
  try {
    const res  = await api.post('/api/control/reboot',{
      device_id: rebootDeviceId,
      ssh_user: $('#r-ssh-user').value,
      ssh_pass: $('#r-ssh-pass').value,
      ssh_port: parseInt($('#r-ssh-port').value)||22
    });
    const data = await res.json();
    if(log){
      log.textContent = data.success ? '✓ '+data.message : '✗ '+data.error;
      log.style.color  = data.success ? 'var(--ok)' : 'var(--alert)';
    }
    if(data.success){
      showToast('Reboot command dikirim!','ok');
      setTimeout(closeRebootModal, 3000);
    }
  } catch(e){
    if(log){ log.textContent='✗ '+e.message; log.style.color='var(--alert)'; }
  }
  if(btn){ btn.textContent='↺ Reboot Sekarang'; }
}

/* ── 18. CHANGE PASSWORD MODAL ─────────────────────────────────────── */
function openChangePwdModal(){
  const m=$('#changepwd-modal');
  if(m) m.classList.add('open');
}
function closeChangePwdModal(){
  const m=$('#changepwd-modal');
  if(m){ m.classList.remove('open'); $('#cp-old').value=''; $('#cp-new').value=''; $('#cp-err').textContent=''; }
}

async function submitChangePassword(){
  const oldPwd=$('#cp-old').value, newPwd=$('#cp-new').value;
  const errEl=$('#cp-err');
  if(!oldPwd||!newPwd){ if(errEl) errEl.textContent='Semua field wajib diisi'; return; }
  if(newPwd.length<6){ if(errEl) errEl.textContent='Password baru minimal 6 karakter'; return; }
  try {
    const res  = await api.post('/api/auth/change-password',{old_password:oldPwd, new_password:newPwd});
    const data = await res.json();
    if(!res.ok){ if(errEl) errEl.textContent=data.error; return; }
    showToast('Password berhasil diubah','ok');
    closeChangePwdModal();
  } catch(e){
    if(errEl) errEl.textContent=e.message;
  }
}

/* ── 19. INIT ──────────────────────────────────────────────────────── */
async function init(){
  // Tampilkan loading state
  const bar = $('#stats-bar');
  if(bar) bar.innerHTML='<div class="stat-chip" style="opacity:.5">Memuat data...</div>';

  try {
    // Ambil info user
    const userRes = await api.get('/api/auth/me');
    if(userRes && userRes.ok){
      currentUser = await userRes.json();
      renderUserInfo();
      if(currentUser.must_change_password){
        showToast('⚠️ Harap ganti password default Anda','error');
        setTimeout(openChangePwdModal, 800);
      }
    }

    // Muat data device dari API
    await loadDevices();

    // Render semua komponen UI
    setupPanZoom();
    renderStats();
    renderSidebar();
    renderGridDashboard();
    renderTopology();
    renderDetail();

    // Mobile Sidebar Setup
    const btnMenu = $('#mobile-menu-btn');
    const overlay = $('#mobile-overlay');
    const sidebar = $('#sidebar');
    
    if(btnMenu && overlay && sidebar) {
      btnMenu.addEventListener('click', () => {
        sidebar.classList.add('mobile-open');
        overlay.classList.add('show');
      });
      overlay.addEventListener('click', () => {
        sidebar.classList.remove('mobile-open');
        overlay.classList.remove('show');
      });
    }

    // Hubungkan WebSocket untuk update realtime
    connectWebSocket();

  } catch(err){
    console.error('[Init]', err);
    showToast('Gagal memuat data: '+err.message,'error');
  }
}

/* ── 20. AUTO DISCOVERY ────────────────────────────────────────────── */
let scannedDevicesList = [];

async function scanNetwork() {
  const modal = $('#scan-modal');
  const body = $('#scan-body');
  if (!modal || !body) return;
  
  modal.classList.add('open');
  body.innerHTML = '<div style="text-align:center; padding: 20px;">Memindai jaringan dari router (Mohon tunggu beberapa detik)...</div>';
  
  try {
    const res = await api.get('/api/devices/scan');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Gagal memindai');
    
    scannedDevicesList = data.scanned || [];
    
    if (scannedDevicesList.length === 0) {
      body.innerHTML = '<div style="text-align:center; padding: 20px;">Tidak ada perangkat baru ditemukan.</div>';
      return;
    }
    
    let html = `
      <table class="device-table">
        <thead>
          <tr>
            <th style="width:40px"><input type="checkbox" onchange="toggleAllScanned(this)" checked></th>
            <th>Nama Perangkat</th>
            <th>IP Address</th>
            <th>MAC Address</th>
            <th>Tujuan Lokasi</th>
          </tr>
        </thead>
        <tbody>
    `;
    
    // Generate location options
    let locOptions = '<option value="">-- Pilih Lokasi --</option>';
    const sortedLocs = [...state.locations].sort((a,b)=>a.nama.localeCompare(b.nama));
    sortedLocs.forEach(l => {
      // pre-select current location if available
      const sel = l.id === currentLocId ? 'selected' : '';
      locOptions += `<option value="${l.id}" ${sel}>${escapeHtml(l.nama)} (${l.zone})</option>`;
    });
    
    scannedDevicesList.forEach((d, i) => {
      html += `
        <tr>
          <td><input type="checkbox" class="scan-chk" data-idx="${i}" checked></td>
          <td><input type="text" class="scan-nama" id="scan-nama-${i}" value="${escapeHtml(d.nama)}" style="width:100%; padding:4px"></td>
          <td>${d.ip}</td>
          <td>${d.mac}</td>
          <td><select class="scan-loc" id="scan-loc-${i}" style="width:100%; padding:4px">${locOptions}</select></td>
        </tr>
      `;
    });
    html += '</tbody></table>';
    body.innerHTML = html;
  } catch(e) {
    body.innerHTML = `<div style="text-align:center; padding: 20px; color: var(--alert)">Error: ${e.message}</div>`;
  }
}

function toggleAllScanned(el) {
  $$('.scan-chk').forEach(c => c.checked = el.checked);
}

function closeScanModal() {
  $('#scan-modal').classList.remove('open');
  scannedDevicesList = [];
}

async function bulkSaveDevices() {
  const checks = $$('.scan-chk');
  const payload = [];
  
  checks.forEach((chk) => {
    if (chk.checked) {
      const idx = chk.dataset.idx;
      const base = scannedDevicesList[idx];
      const nama = $(`#scan-nama-${idx}`).value;
      const loc_id = $(`#scan-loc-${idx}`).value;
      if (loc_id && nama) {
        payload.push({
          ...base,
          nama,
          loc_id
        });
      }
    }
  });
  
  if (payload.length === 0) {
    showToast('Pilih minimal 1 perangkat dan pastikan lokasi terisi', 'error');
    return;
  }
  
  try {
    const btn = $('#scan-modal .btn-primary');
    const oldText = btn.textContent;
    btn.textContent = 'Menyimpan...';
    btn.disabled = true;
    
    const res = await api.post('/api/devices/bulk', { devices: payload });
    const data = await res.json();
    
    btn.textContent = oldText;
    btn.disabled = false;
    
    if (!res.ok) throw new Error(data.error || 'Gagal menyimpan');
    
    showToast(data.message, 'ok');
    closeScanModal();
    
    // Refresh data
    await loadDevices();
    renderStats();
    renderSidebar();
    renderDetail();
    
  } catch(e) {
    showToast(e.message, 'error');
  }
}

init();
