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

/* ── 0. GLOBAL MODAL HELPERS ──────────────────────────────────── */
/* Safe backdrop close: track mousedown origin to prevent
   accidental close when dragging text inside the modal */
(function setupModalBackdrop() {
  const closeFns = {
    'history'  : () => closeHistoryModal(),
    'reboot'   : () => closeRebootModal(),
    'changepwd': () => closeChangePwdModal(),
    'scan'     : () => closeScanModal(),
    'device'   : () => closeDeviceForm()
  };
  let _downTarget = null;
  document.addEventListener('mousedown', e => { _downTarget = e.target; });
  document.addEventListener('click', e => {
    const overlay = e.target.closest('.modal-overlay');
    if (!overlay) return;                          // didn't click an overlay
    const modal   = overlay.querySelector('.modal');
    if (!modal)   return;
    /* Only close if BOTH mousedown AND click originated on the overlay itself */
    if (_downTarget === overlay && e.target === overlay) {
      const key = overlay.dataset.modal;
      if (closeFns[key]) closeFns[key]();
    }
  });
  /* Escape key closes the topmost open modal */
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const open = [...document.querySelectorAll('.modal-overlay.open')];
    if (!open.length) return;
    const top = open[open.length - 1];
    const key = top.dataset.modal;
    if (closeFns[key]) closeFns[key]();
  });
})();

/* Ripple effect on buttons */
(function setupRipple() {
  document.addEventListener('click', e => {
    const btn = e.target.closest('button, .bcard-btn, .tab-btn, .loc-item');
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const r = document.createElement('span');
    r.className = 'ripple-wave';
    const size = Math.max(rect.width, rect.height) * 2;
    r.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX-rect.left-size/2}px;top:${e.clientY-rect.top-size/2}px`;
    btn.style.position = btn.style.position || 'relative';
    btn.style.overflow = 'hidden';
    btn.appendChild(r);
    r.addEventListener('animationend', () => r.remove());
  });
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
  {key:'A', label:'Gedung A'},{key:'B', label:'Gedung B'},
  {key:'C', label:'Gedung C'},{key:'D', label:'Gedung D'},
  {key:'E', label:'Gedung E'},{key:'F', label:'Gedung F'},
  {key:'G', label:'Gedung G'},{key:'H', label:'Gedung H'},
  {key:'I', label:'Gedung I'},{key:'J', label:'Gedung J'},
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

let DEVICE_TYPES = [];
let OS_TYPES     = [];
const STATUS_LIST  = ['Online','Offline','Maintenance'];
const STATUS_COLOR = {Online:'var(--ok)', Offline:'var(--alert)', Maintenance:'var(--warn)', Unknown:'var(--idle)'};

/* ── 4. STATE ──────────────────────────────────────────────────────── */
let state = { locations: SEED_LOCATIONS, devices: {}, deviceTypes: [], deviceOs: [] };
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

/* ── 5. TOAST ──────────────────────────────────── */
function showToast(msg, type='info') {
  const t = $('#toast');
  t.innerHTML = `<span class="toast-msg">${msg}</span><div class="toast-progress"></div>`;
  t.className = 'toast show toast-'+type;
  clearTimeout(t._t);
  /* Animate progress bar */
  const bar = t.querySelector('.toast-progress');
  if (bar) {
    bar.style.transition = 'none';
    bar.style.width = '100%';
    requestAnimationFrame(() => {
      bar.style.transition = 'width 2.8s linear';
      bar.style.width = '0%';
    });
  }
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
  refreshActiveView();
}

/* ── 7. DATA MANAGEMENT (API-based) ───────────────────────────────── */
async function loadOptions() {
  try {
    const resTypes = await api.get('/api/devices/types');
    if (resTypes && resTypes.ok) {
      state.deviceTypes = (await resTypes.json()).types;
      DEVICE_TYPES = state.deviceTypes;
    }
    const resOs = await api.get('/api/devices/os');
    if (resOs && resOs.ok) {
      state.deviceOs = (await resOs.json()).os;
      OS_TYPES = state.deviceOs.map(o => ({ v: o.id, l: o.name }));
    }
  } catch (e) {
    console.error('Gagal memuat opsi:', e);
  }
}

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

  const auditTab = $('#tab-audit-btn');
  if (auditTab) {
    auditTab.style.display = u.role === 'admin' ? 'inline-block' : 'none';
  }
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
    <div class="stat-chip" style="cursor:pointer" onclick="switchTab('offline')" title="Klik untuk melihat daftar perangkat offline"><span class="dot" style="background:var(--alert)"></span>Offline <b>${offline}</b></div>
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
        <div class="big-icon">🔍</div>
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
        badgeHtml = `<span class="bcard-badge alert">⚠️ ${offline} Down</span>`;
      } else if (maint > 0) {
        statusClass = 'status-warn';
        badgeHtml = `<span class="bcard-badge warn">🛠️ Maintenance</span>`;
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
      else if (hasKids) cls += ' tc-expanded';
      if (ci === 0)     cls += ' tc-root';
      cls += ` s-${agg} tc-lvl-${ci % 8}`;

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
  localStorage.setItem('activeTab', name);
  $$('.tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
  $('#view-grid').classList.toggle('active', name==='grid');
  $('#view-topo').classList.toggle('active', name==='topo');
  $('#view-detail').classList.toggle('active', name==='detail');
  $('#view-offline').classList.toggle('active', name==='offline');
  $('#view-report').classList.toggle('active', name==='report');
  $('#view-audit').classList.toggle('active', name==='audit');
  if(name==='grid') renderGridDashboard();
  if(name==='offline') renderOfflineDevices();
  if(name==='report') renderReportView();
  if(name==='audit') renderAuditView();
}

function refreshActiveView() {
  const activeTab = $('.tab-btn.active');
  if (!activeTab) return;
  const tab = activeTab.dataset.tab;
  if (tab === 'grid') renderGridDashboard();
  if (tab === 'detail' && currentLocId) renderDetail();
  if (tab === 'offline') renderOfflineDevices();
  if (tab === 'report') renderReportView();
  if (tab === 'audit') renderAuditView();
}

function renderOfflineDevices() {
  const panel = $('#offline-panel');
  if (!panel) return;

  const offlineDevs = [];
  Object.entries(state.devices).forEach(([locId, devs]) => {
    const loc = state.locations.find(l => l.id === locId);
    devs.forEach(d => {
      if (d.status === 'Offline') {
        offlineDevs.push({ ...d, locName: loc ? loc.nama : 'Unknown', locId });
      }
    });
  });

  if (offlineDevs.length === 0) {
    panel.innerHTML = `
      <div class="empty-state">
        <div class="big-icon">✓</div>
        <p style="color:var(--ok); font-weight:600">Semua Perangkat Online</p>
        <p style="font-size:13px; color:var(--text-muted)">Tidak ada perangkat yang terdeteksi offline saat ini.</p>
      </div>
    `;
    return;
  }

  const isAdmin = currentUser && currentUser.role === 'admin';

  const rows = offlineDevs.map(d => `
    <tr>
      <td><b>${escapeHtml(d.nama)}</b></td>
      <td><span class="zone-badge" style="cursor:pointer" onclick="openDetail('${d.locId}')">${escapeHtml(d.locName)}</span></td>
      <td>${escapeHtml(d.tipe)}</td>
      <td>${escapeHtml(d.merk || '—')}</td>
      <td class="ip-cell">${escapeHtml(d.ip || '—')} ${d.ip ? `<button class="icon-btn" title="Ping sekarang" onclick="pingNow('${d.id}','${d.ip}',this)">⟳</button>` : ''}</td>
      <td>${statusBadge(d.status)} ${latencyChip(d.last_ping_ms)}</td>
      <td><div class="row-actions">
        ${isAdmin && d.mac ? `<button class="icon-btn" title="Wake on LAN (WoL)" onclick="wakeDevice('${d.id}')">⚡</button>` : ''}
        ${isAdmin ? `<button class="icon-btn" title="Ubah" onclick="editDevice('${d.id}')">✍</button>` : ''}
        <button class="icon-btn" title="Riwayat Ping" onclick="openHistoryModal('${d.id}')">📊</button>
        ${isAdmin && d.ip ? `<button class="icon-btn" title="Reboot SSH" onclick="openRebootModal('${d.id}')">↺</button>` : ''}
      </div></td>
    </tr>
  `).join('');

  panel.innerHTML = `
    <div class="detail-head" style="margin-bottom: 20px">
      <div>
        <h2 style="font-size:22px; margin:0 0 6px; color:#fff; font-weight:600">⚠️ Perangkat Offline (${offlineDevs.length})</h2>
        <p style="font-size:12px; color:var(--text-muted); margin:0">Daftar semua perangkat di seluruh gedung yang saat ini tidak merespons ping.</p>
      </div>
    </div>
    <div class="device-table-wrap">
      <table class="device-table">
        <thead>
          <tr>
            <th>Nama</th>
            <th>Gedung / Lokasi</th>
            <th>Tipe</th>
            <th>Merk/Model</th>
            <th>IP Address</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}
$$('.tab-btn').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));

/* ── 13. DETAIL PANEL ──────────────────────────────────────────────── */
function openDetail(locId){ currentLocId=locId; closeDeviceForm(); switchTab('detail'); renderDetail(); highlightActiveLoc(); }

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

  // Jangan re-render jika modal form tambah/ubah perangkat sedang terbuka
  const form = $('#device-modal');
  if (form && form.classList.contains('open')) {
    return;
  }

  if(!currentLocId){
    panel.innerHTML=`<div class="empty-state"><div class="big-icon">🖱️</div><div>Pilih gedung atau lokasi dari daftar / peta topologi<br>untuk melihat data perangkatnya.</div></div>`;
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
        ${isAdmin && d.mac ? `<button class="icon-btn" title="Wake on LAN (WoL)" onclick="wakeDevice('${d.id}')">⚡</button>` : ''}
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
  `;
}

/* ── 14. DEVICE FORM ───────────────────────────────────────────────── */
function openDeviceForm(deviceId){
  editingDeviceId = deviceId||null;
  const modal = $('#device-modal');
  const body = $('#device-modal-body');
  const title = $('#device-modal-title');
  if(!modal || !body || !title) return;

  const d = deviceId ? (state.devices[currentLocId]||[]).find(x=>x.id===deviceId) : null;
  const osOptions = state.deviceOs.map(o=>`<option value="${o.id}"${d&&d.device_os===o.id?' selected':''}>${o.name}</option>`).join('');
  const isAdmin = currentUser && currentUser.role==='admin';

  title.textContent = deviceId ? '✍ Ubah Perangkat' : '+ Tambah Perangkat';

  body.innerHTML=`
    <div class="form-grid">
      <div class="field"><label>Nama Perangkat</label><input id="f-nama" placeholder="cth. Switch Lantai 1" value="${escapeHtml(d?d.nama:'')}"></div>
      <div class="field">
        <label>Tipe</label>
        <div style="display:flex;gap:6px">
          <select id="f-tipe" style="flex:1">${state.deviceTypes.map(t=>`<option value="${t}"${d&&d.tipe===t?' selected':''}>${t}</option>`).join('')}</select>
          ${isAdmin?`<button class="icon-btn" onclick="openOptionsModal('types')" title="Kelola Tipe" style="flex-shrink:0;height:40px;width:40px;display:flex;align-items:center;justify-content:center">⚙️</button>`:''}
        </div>
      </div>
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
          <div class="field">
            <label>SSH Password</label>
            <div style="display:flex;gap:6px">
              <input type="text" id="f-ssh-pass" placeholder="••••••••" value="${escapeHtml(d?d.ssh_pass||'':'')}" style="flex:1">
              <button type="button" class="icon-btn" onclick="togglePasswordVisibility('f-ssh-pass', this)" title="Sembunyikan Password" style="flex-shrink:0;height:40px;width:40px;display:flex;align-items:center;justify-content:center">🙈</button>
            </div>
          </div>
          <div class="field"><label>SSH Port</label><input id="f-ssh-port" type="number" placeholder="22" value="${d?d.ssh_port||22:22}"></div>
          <div class="field">
            <label>OS Device</label>
            <div style="display:flex;gap:6px">
              <select id="f-device-os" style="flex:1">${osOptions}</select>
              ${isAdmin?`<button class="icon-btn" onclick="openOptionsModal('os')" title="Kelola OS" style="flex-shrink:0;height:40px;width:40px;display:flex;align-items:center;justify-content:center">⚙️</button>`:''}
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="form-actions">
      <button class="btn-secondary" onclick="closeDeviceForm()">Batal</button>
      <button class="btn-primary" onclick="submitDeviceForm()">Simpan</button>
    </div>
  `;
  modal.classList.add('open');
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
  const modal=$('#device-modal');
  const body=$('#device-modal-body');
  if(modal){ modal.classList.remove('open'); }
  if(body){ body.innerHTML=''; }
}

/* ── 14B. MANAGE OPTIONS (TYPES & OS) ──────────────────────────────── */
let activeOptionsMode = null; // 'types' or 'os'
let editingOptionKey = null; // for tracking what we are renaming

async function openOptionsModal(mode) {
  activeOptionsMode = mode;
  editingOptionKey = null;
  const modal = $('#options-modal');
  const title = $('#options-modal-title');
  if (!modal || !title) return;

  title.textContent = mode === 'types' ? '⚙️ Kelola Kategori (Tipe)' : '⚙️ Kelola OS Device';
  
  await renderOptionsList();
  modal.classList.add('open');
}

function closeOptionsModal() {
  const modal = $('#options-modal');
  if (modal) modal.classList.remove('open');
  
  // Refresh the dropdown lists in the device form if it's still open
  if ($('#device-modal').classList.contains('open')) {
    openDeviceForm(editingDeviceId);
  }
}

async function renderOptionsList() {
  const body = $('#options-modal-body');
  if (!body) return;

  await loadOptions(); // reload current lists from API

  let listHtml = '';
  if (activeOptionsMode === 'types') {
    listHtml = state.deviceTypes.map(t => `
      <div class="option-item" style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
        ${editingOptionKey === t ? `
          <input id="f-edit-opt-val" value="${escapeHtml(t)}" style="flex:1;margin-right:8px;padding:6px 10px;height:32px;font-size:13px;background:var(--panel-2);color:var(--text);border:1px solid var(--border);border-radius:4px">
          <div style="display:flex;gap:4px">
            <button class="icon-btn" onclick="saveEditOption('${escapeHtml(t)}')" title="Simpan">✓</button>
            <button class="icon-btn danger" onclick="cancelEditOption()" title="Batal">✕</button>
          </div>
        ` : `
          <span style="font-family:var(--mono);font-size:13px">${escapeHtml(t)}</span>
          <div style="display:flex;gap:4px">
            <button class="icon-btn" onclick="startEditOption('${escapeHtml(t)}')" title="Edit">✍</button>
            <button class="icon-btn danger" onclick="deleteOption('${escapeHtml(t)}')" title="Hapus">✕</button>
          </div>
        `}
      </div>
    `).join('');

    body.innerHTML = `
      <div class="options-list" style="margin-bottom:20px">${listHtml || '<p style="color:var(--text-muted);font-size:12px">Belum ada kategori.</p>'}</div>
      <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">
        <label style="font-size:11px;font-family:var(--mono);color:var(--text-muted);text-transform:uppercase">Tambah Kategori Baru</label>
        <div style="display:flex;gap:8px;margin-top:8px">
          <input id="f-new-opt-name" placeholder="cth. IoT Device" style="flex:1;padding:8px 12px;font-size:13px;height:36px;background:var(--panel-2);color:var(--text);border:1px solid var(--border);border-radius:6px">
          <button class="btn-primary" onclick="addOption()" style="padding:0 16px;height:36px;font-size:12px">Tambah</button>
        </div>
      </div>
    `;
  } else {
    // OS MODE
    listHtml = state.deviceOs.map(o => `
      <div class="option-item" style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
        ${editingOptionKey === o.id ? `
          <div style="flex:1;display:flex;gap:8px;margin-right:8px;align-items:center">
            <span style="font-family:var(--mono);font-size:11px;color:var(--text-muted)">${o.id}</span>
            <input id="f-edit-opt-val" value="${escapeHtml(o.name)}" style="flex:1;padding:6px 10px;height:32px;font-size:13px;background:var(--panel-2);color:var(--text);border:1px solid var(--border);border-radius:4px">
          </div>
          <div style="display:flex;gap:4px">
            <button class="icon-btn" onclick="saveEditOption('${o.id}')" title="Simpan">✓</button>
            <button class="icon-btn danger" onclick="cancelEditOption()" title="Batal">✕</button>
          </div>
        ` : `
          <div style="display:flex;flex-direction:column">
            <span style="font-size:13px;font-weight:500">${escapeHtml(o.name)}</span>
            <span style="font-family:var(--mono);font-size:10px;color:var(--text-muted)">ID: ${o.id}</span>
          </div>
          <div style="display:flex;gap:4px">
            <button class="icon-btn" onclick="startEditOption('${o.id}')" title="Edit">✍</button>
            <button class="icon-btn danger" onclick="deleteOption('${o.id}')" title="Hapus">✕</button>
          </div>
        `}
      </div>
    `).join('');

    body.innerHTML = `
      <div class="options-list" style="margin-bottom:20px">${listHtml || '<p style="color:var(--text-muted);font-size:12px">Belum ada OS.</p>'}</div>
      <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">
        <label style="font-size:11px;font-family:var(--mono);color:var(--text-muted);text-transform:uppercase">Tambah OS Baru</label>
        <div style="display:grid;grid-template-columns:1fr 2fr auto;gap:8px;margin-top:8px;align-items:end">
          <div class="field" style="margin:0"><label style="font-size:9.5px;margin-bottom:4px">ID (cth. debian)</label><input id="f-new-os-id" placeholder="id" style="padding:8px 12px;font-size:13px;height:36px;background:var(--panel-2);color:var(--text);border:1px solid var(--border);border-radius:6px"></div>
          <div class="field" style="margin:0"><label style="font-size:9.5px;margin-bottom:4px">Nama OS (cth. Debian OS)</label><input id="f-new-os-name" placeholder="Nama OS" style="padding:8px 12px;font-size:13px;height:36px;background:var(--panel-2);color:var(--text);border:1px solid var(--border);border-radius:6px"></div>
          <button class="btn-primary" onclick="addOption()" style="padding:0 16px;height:36px;font-size:12px">Tambah</button>
        </div>
      </div>
    `;
  }
}

function startEditOption(key) {
  editingOptionKey = key;
  renderOptionsList();
}

function cancelEditOption() {
  editingOptionKey = null;
  renderOptionsList();
}

async function saveEditOption(key) {
  const newVal = $('#f-edit-opt-val').value.trim();
  if (!newVal) return showToast('Nilai tidak boleh kosong', 'error');

  try {
    const url = activeOptionsMode === 'types' ? `/api/devices/types/${encodeURIComponent(key)}` : `/api/devices/os/${encodeURIComponent(key)}`;
    const res = await api.put(url, { name: newVal });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Gagal mengubah opsi');
    }
    showToast('Opsi berhasil diubah', 'ok');
    editingOptionKey = null;
    await renderOptionsList();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function addOption() {
  try {
    if (activeOptionsMode === 'types') {
      const name = $('#f-new-opt-name').value.trim();
      if (!name) return showToast('Nama kategori wajib diisi', 'error');
      
      const res = await api.post('/api/devices/types', { name });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Gagal menambahkan kategori');
      }
      showToast('Kategori berhasil ditambahkan', 'ok');
    } else {
      const id = $('#f-new-os-id').value.trim().toLowerCase();
      const name = $('#f-new-os-name').value.trim();
      if (!id || !name) return showToast('ID dan Nama OS wajib diisi', 'error');

      const res = await api.post('/api/devices/os', { id, name });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Gagal menambahkan OS');
      }
      showToast('OS berhasil ditambahkan', 'ok');
    }
    await renderOptionsList();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteOption(key) {
  if (!confirm(`Hapus opsi "${key}"? (Perangkat yang menggunakan opsi ini akan disesuaikan)`)) return;

  try {
    const url = activeOptionsMode === 'types' ? `/api/devices/types/${encodeURIComponent(key)}` : `/api/devices/os/${encodeURIComponent(key)}`;
    const res = await api.delete(url);
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Gagal menghapus opsi');
    }
    showToast('Opsi berhasil dihapus', 'ok');
    await renderOptionsList();
  } catch (err) {
    showToast(err.message, 'error');
  }
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
    refreshActiveView();
    renderSidebar(); renderStats(); renderTopology();
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
    refreshActiveView(); renderSidebar(); renderStats(); renderTopology();
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
    renderStats(); renderSidebar(); renderTopology(); refreshActiveView();
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

/* ── 19. WAKE ON LAN (WoL) ─────────────────────────────────────────── */
async function wakeDevice(deviceId) {
  if (!confirm('Kirim Magic Packet (Wake-on-LAN) ke perangkat ini?')) return;
  try {
    showToast('Mengirim Magic Packet...');
    const res = await api.post('/api/control/wake', { device_id: deviceId });
    if (res.success) {
      showToast(res.message);
    } else {
      showToast(res.error || 'Gagal mengirim WoL');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message);
  }
}

/* ── 20. SLA REPORT VIEW ───────────────────────────────────────────── */
let currentSlaReport = [];

async function renderReportView() {
  const panel = $('#report-panel');
  if (!panel) return;
  panel.innerHTML = `<p style="color:var(--text-muted)">Memuat laporan SLA...</p>`;

  try {
    const res = await api.get('/api/ping/sla-report?days=7');
    const data = await res.json();
    currentSlaReport = data.report || [];
    
    let totalDevices = currentSlaReport.length;
    let avgFactoryUptime = totalDevices ? currentSlaReport.reduce((a,b)=>a+b.uptime_percent,0) / totalDevices : 0;
    
    const rows = currentSlaReport.map(r => {
      let color = r.uptime_percent >= 99 ? 'var(--ok)' : (r.uptime_percent >= 95 ? 'var(--warn)' : 'var(--alert)');
      const loc = state.locations.find(l => l.id === r.location);
      const locName = loc ? loc.nama : r.location;
      return `
        <tr>
          <td>${escapeHtml(r.device_name)}</td>
          <td>${escapeHtml(locName)}</td>
          <td>${escapeHtml(r.ip_address)}</td>
          <td><b style="color:${color}">${r.uptime_percent}%</b></td>
          <td>${r.downtime_minutes} menit</td>
          <td>${r.avg_latency || 0} ms</td>
        </tr>
      `;
    }).join('');

    panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:20px;">
        <div>
          <h2 style="font-size:22px; margin:0 0 6px; color:#fff; font-weight:600">📈 Laporan Uptime SLA (7 Hari Terakhir)</h2>
          <p style="font-size:13px; color:var(--text-muted); margin:0">Rata-rata ketersediaan keseluruhan pabrik: <b style="color:var(--ok); font-size:16px">${avgFactoryUptime.toFixed(2)}%</b></p>
        </div>
        <div style="display:flex; gap:10px;">
          <button class="add-btn" style="background:var(--panel-2); border:1px solid var(--border); color:#fff; font-weight:500" onclick="exportSlaExcel()">📥 Download Excel</button>
          <button class="add-btn" style="color:#000; font-weight:600" onclick="window.print()">🖨️ Cetak / PDF</button>
        </div>
      </div>
      <div class="device-table-wrap">
        <table class="device-table">
          <thead>
            <tr>
              <th>Perangkat</th>
              <th>Lokasi</th>
              <th>IP Address</th>
              <th>Uptime (%)</th>
              <th>Est. Downtime</th>
              <th>Rata-rata Latency</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">Data tidak tersedia</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    panel.innerHTML = `<p style="color:var(--alert)">Gagal memuat laporan SLA: ${err.message}</p>`;
  }
}

function exportSlaExcel() {
  if (!currentSlaReport.length) return alert('Tidak ada data SLA untuk di-export.');
  
  // Format data untuk dicerna oleh SheetJS
  const excelData = currentSlaReport.map(r => {
    const loc = state.locations.find(l => l.id === r.location);
    const locName = loc ? loc.nama : r.location;
    return {
      'Nama Perangkat': r.device_name,
      'Lokasi': locName,
      'IP Address': r.ip_address,
      'Uptime (%)': r.uptime_percent + '%',
      'Estimasi Downtime (menit)': r.downtime_minutes,
      'Rata-rata Latency (ms)': r.avg_latency || 0
    };
  });

  try {
    // Membuat sheet baru dari data JSON
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    
    // Set auto-width kolom sederhana biar Excel nya rapi
    const colsWidth = [
      { wch: 30 }, // Nama Perangkat
      { wch: 25 }, // Lokasi
      { wch: 18 }, // IP Address
      { wch: 12 }, // Uptime
      { wch: 25 }, // Est Downtime
      { wch: 22 }  // Latency
    ];
    worksheet['!cols'] = colsWidth;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Laporan SLA Uptime");

    // Unduh file excel native .xlsx
    const filename = `Laporan_Uptime_SLA_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(workbook, filename);
    showToast('Laporan Excel berhasil diunduh', 'ok');
  } catch (err) {
    alert('Gagal mengekspor ke Excel: ' + err.message);
  }
}

/* ── 21. AUDIT TRAIL VIEW ──────────────────────────────────────────── */
async function renderAuditView() {
  const panel = $('#audit-panel');
  if (!panel) return;
  panel.innerHTML = `<p style="color:var(--text-muted)">Memuat audit trail...</p>`;

  try {
    const res = await api.get('/api/audit?limit=100');
    const data = await res.json();
    const logs = data.logs || [];
    
    const rows = logs.map(l => `
      <tr>
        <td style="font-family:var(--mono); font-size:12px; color:var(--text-muted);">${new Date(l.created_at).toLocaleString('id-ID')}</td>
        <td><b>${escapeHtml(l.username)}</b></td>
        <td><span class="zone-badge" style="background:var(--panel-2); color:var(--accent)">${escapeHtml(l.action)}</span></td>
        <td>${escapeHtml(l.target_device || '—')}</td>
        <td style="font-size:12px">${escapeHtml(l.details || '—')}</td>
      </tr>
    `).join('');

    panel.innerHTML = `
      <div style="margin-bottom:20px;">
        <h2 style="font-size:22px; margin:0 0 6px; color:#fff; font-weight:600">📜 Log Audit Sistem</h2>
        <p style="font-size:13px; color:var(--text-muted); margin:0">Menampilkan 100 aktivitas sistem terbaru.</p>
      </div>
      <div class="device-table-wrap">
        <table class="device-table">
          <thead>
            <tr>
              <th>Waktu</th>
              <th>User</th>
              <th>Aksi</th>
              <th>Target</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">Belum ada log aktivitas.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    panel.innerHTML = `<p style="color:var(--alert)">Gagal memuat log audit: ${err.message}</p>`;
  }
}

/* ── 22. INIT ──────────────────────────────────────────────────────── */
async function init(){
  // Paksa kosongkan search input — Chrome/Edge sering abaikan autocomplete="off"
  const si = $('#search-input');
  if (si) { si.value = ''; }

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

    // Muat opsi & data device dari API
    await loadOptions();
    await loadDevices();

    // Render semua komponen UI
    setupPanZoom();
    renderStats();
    renderSidebar();
    renderTopology(); // Pre-render topology canvas
    
    // Pulihkan tab aktif dari localStorage, default ke 'grid'
    const savedTab = localStorage.getItem('activeTab') || 'grid';
    switchTab(savedTab);

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

function togglePasswordVisibility(id, btn) {
  const input = document.getElementById(id);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    btn.innerHTML = '🙈';
    btn.title = 'Sembunyikan Password';
  } else {
    input.type = 'password';
    btn.innerHTML = '👁️';
    btn.title = 'Tampilkan Password';
  }
}

init();
