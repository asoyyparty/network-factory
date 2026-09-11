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
    'device'   : () => closeDeviceForm(),
    'adduser'  : () => closeAddUserModal(),
    'resetuser': () => closeResetUserModal()
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
      if (res) {
        const origJson = res.json.bind(res);
        res.json = async () => {
          const contentType = res.headers.get('content-type') || '';
          if (!contentType.includes('application/json')) {
            const text = await res.text();
            if (text.trim().startsWith('<')) {
              throw new Error(`Server mengembalikan respons HTML (Status ${res.status}). Pastikan URL/endpoint API valid.`);
            }
            try {
              return JSON.parse(text);
            } catch (_) {
              throw new Error(`Respons server bukan format JSON yang valid (Status ${res.status})`);
            }
          }
          return await origJson();
        };
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
let ZONES = [
  {id: 1, key:'PRODUKSI', label:'Area Produksi Utama', sort_order: 1},
  {id: 2, key:'A', label:'Gedung A', sort_order: 2},
  {id: 3, key:'B', label:'Gedung B', sort_order: 3},
  {id: 4, key:'C', label:'Gedung C', sort_order: 4},
  {id: 5, key:'D', label:'Gedung D', sort_order: 5},
  {id: 6, key:'E', label:'Gedung E', sort_order: 6},
  {id: 7, key:'F', label:'Gedung F', sort_order: 7},
  {id: 8, key:'G', label:'Gedung G', sort_order: 8},
  {id: 9, key:'H', label:'Gedung H', sort_order: 9},
  {id: 10, key:'I', label:'Gedung I', sort_order: 10},
  {id: 11, key:'J', label:'Gedung J', sort_order: 11},
  {id: 12, key:'SECURITY', label:'Keamanan', sort_order: 12},
  {id: 13, key:'MESS', label:'Mess Karyawan', sort_order: 13},
  {id: 14, key:'GUDANG_EKS', label:'Gudang Eksternal', sort_order: 14},
  {id: 15, key:'INTI', label:'Inti Jaringan', sort_order: 15},
  {id: 16, key:'GUDANG_IT_AREA', label:'Area Gudang IT', sort_order: 16},
  {id: 17, key:'MULSA', label:'Area Mulsa', sort_order: 17}
];

async function loadZones() {
  try {
    const res = await api.get('/api/devices/zones');
    if (res && res.ok) {
      const data = await res.json();
      if (data.zones && data.zones.length > 0) {
        ZONES = data.zones.map(z => ({
          id: z.id,
          key: z.zone_key,
          label: z.label,
          sort_order: z.sort_order,
          location_count: Number(z.location_count) || 0,
          device_count: Number(z.device_count) || 0
        }));
      }
    }
  } catch (err) {
    console.warn('[Zones] Gagal memuat kategori gedung:', err.message);
  }
}

const RAW_LOCATIONS = [
  ['LAB SPRAYER','PRODUKSI'],['RUANG UKK','PRODUKSI'],['RUANG ATK','PRODUKSI'],['RUANG BENIH','PRODUKSI'],
  ['LAB LT. 1','PRODUKSI'],['LAB LT. 2','PRODUKSI'],
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

let NETWORK_TREE = null;
let RAW_TOPOLOGY = [];

async function loadTopology() {
  const res = await api.get('/api/topology');
  if(!res.ok) throw new Error('Gagal load topology');
  RAW_TOPOLOGY = await res.json();
  
  const nodeMap = {};
  RAW_TOPOLOGY.forEach(n => {
    nodeMap[n.id] = {
      id: n.id,
      kind: n.kind,
      label: n.label,
      locId: n.loc_id,
      extraParents: n.extra_parents || [],
      children: []
    };
  });
  
  let rootNode = null;
  RAW_TOPOLOGY.forEach(n => {
    if (n.parent_id && nodeMap[n.parent_id]) {
      nodeMap[n.parent_id].children.push(nodeMap[n.id]);
    } else if (!n.parent_id) {
      rootNode = nodeMap[n.id];
    }
  });
  
  NETWORK_TREE = rootNode;
  
  // Re-assign uids
  let _uidSeq = 0;
  function assignUid(n){ if(!n)return; n._uid = ++_uidSeq; (n.children||[]).forEach(assignUid); }
  assignUid(NETWORK_TREE);

  // Initialize collapsed nodes (only on first load)
  if (collapsedNodes.size === 0) {
    (function _initColl(n){
      if(!n) return;
      if (n.label && n.label.startsWith('Link FO')) collapsedNodes.add(n._uid);
      (n.children||[]).forEach(_initColl);
    })(NETWORK_TREE);
  }
}

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
  lbl.textContent = status === 'connected' ? 'LIVE' : status === 'reconnecting' ? 'SYNC' : 'DISC';
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
  const fullPayload = { loc_id: locId, ...payload };
  if (editingDeviceId) {
    res = await api.put(`/api/devices/${editingDeviceId}`, fullPayload);
  } else {
    res = await api.post('/api/devices', fullPayload);
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
    <div class="u-avatar-wrap">
      <span class="u-role">${u.role.toUpperCase()}</span>
      <span class="u-name">${escapeHtml(u.username)}</span>
      <svg class="u-caret" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
    </div>
    <div class="user-menu" role="menu">
      <div class="user-menu-header">
        <div class="um-user">${escapeHtml(u.username)}</div>
        <div class="um-sub">ROLE // ${u.role.toUpperCase()}</div>
      </div>
      <hr>
      <button class="user-menu-item" onclick="openChangePwdModal(); closeUserMenu()" role="menuitem">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-1.5 1.5L14 9m0 0l-1.5 1.5M14 9l2.5 2.5m-4 1.5l-3 3H5v-3l7-7 2.5 2.5z"/></svg>
        <span>Ganti Password</span>
      </button>
      <hr>
      <button class="user-menu-item danger" onclick="logout()" role="menuitem">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
        <span>Keluar Sistem</span>
      </button>
    </div>
  `;
  el.onclick = (e) => {
    e.stopPropagation();
    el.classList.toggle('open');
  };

  const auditTab = $('#tab-audit-btn');
  if (auditTab) {
    auditTab.style.display = u.role === 'admin' ? 'inline-block' : 'none';
  }
  const usersTab = $('#tab-users-btn');
  if (usersTab) {
    usersTab.style.display = u.role === 'admin' ? 'inline-block' : 'none';
  }
}

function closeUserMenu() { const b = $('#user-badge'); if(b) b.classList.remove('open'); }
document.addEventListener('click', closeUserMenu);

function logout() {
  localStorage.clear();
  window.location.replace('/login.html');
}

/* ── 9. STATS & TELEMETRY (Hallmark Segmented Array) ───────────────── */
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

  const currentWsStatus = (wsConn && wsConn.readyState === 1) ? 'connected' : (wsConn && wsConn.readyState === 0 ? 'reconnecting' : 'disconnected');
  const wsLabelText = currentWsStatus === 'connected' ? 'LIVE' : (currentWsStatus === 'reconnecting' ? 'SYNC' : 'DISC');

  bar.innerHTML = `
    <!-- Inventory Segment -->
    <div class="telemetry-cluster cluster-inv">
      <div class="t-metric" title="Total Area / Ruangan Terdaftar">
        <span class="t-lbl">LOC</span>
        <b class="t-val">${totalLoc}</b>
      </div>
      <span class="t-divider">|</span>
      <div class="t-metric" title="Total Perangkat Terpasang">
        <span class="t-lbl">DEVS</span>
        <b class="t-val">${totalDev}</b>
      </div>
    </div>

    <!-- Health Telemetry Matrix -->
    <div class="telemetry-cluster cluster-health">
      <div class="t-chip ok" title="Perangkat Normal (Online)">
        <span class="t-dot s-ok"></span>
        <span class="t-lbl">OK</span>
        <b class="t-num">${online}</b>
      </div>
      ${offline > 0 ? `
      <div class="t-chip alert" onclick="switchTab('offline')" title="Klik untuk melihat ${offline} perangkat offline" role="button" tabindex="0">
        <span class="t-dot s-alert"></span>
        <span class="t-lbl">ALERT</span>
        <b class="t-num">${offline}</b>
      </div>` : `
      <div class="t-chip alert idle-alert" onclick="switchTab('offline')" title="Tidak ada perangkat offline">
        <span class="t-dot s-alert idle"></span>
        <span class="t-lbl">ALERT</span>
        <b class="t-num">0</b>
      </div>`}
      ${maint > 0 ? `
      <div class="t-chip warn" title="${maint} perangkat dalam masa maintenance">
        <span class="t-dot s-warn"></span>
        <span class="t-lbl">MAINT</span>
        <b class="t-num">${maint}</b>
      </div>` : ''}
    </div>

    <!-- WebSocket Heartbeat Link -->
    <div class="ws-telemetry-pill" title="Status Koneksi Realtime WebSocket" id="ws-pill">
      <span class="ws-dot ${currentWsStatus}" id="ws-dot"></span>
      <span class="ws-label" id="ws-label">${wsLabelText}</span>
    </div>
  `;
  updateSidebarFooterTelemetry();
}

/* ── Realtime Station Clock ── */
function startStationClock() {
  const clockEl = $('#station-clock-time');
  if (!clockEl) return;
  function tick() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    clockEl.textContent = `${h}:${m}:${s}`;
  }
  tick();
  setInterval(tick, 1000);
}

/* ── 10. SIDEBAR (Hallmark Telemetry Index-Rail) ───────────────────── */
let currentSidebarFilter = 'all';

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

  let zoneIdx = 0;
  ZONES.forEach(zone=>{
    const locs = locationsByZone(zone.key);
    if (!locs.length) return;
    zoneIdx++;
    const totalDev = locs.reduce((s,l)=>s+deviceCount(l.id),0);
    const idxTag = String(zoneIdx).padStart(2, '0');

    const group = document.createElement('div');
    group.className = 'zone-group';
    group.dataset.zone = zone.key;
    group.innerHTML = `
      <div class="zone-head" tabindex="0" role="button" aria-expanded="false">
        <span class="zname">
          <span class="chevron">▶</span>
          <span class="zone-idx">[${idxTag}]</span>
          <span>${zone.label}</span>
        </span>
        <span class="zcount">${locs.length} lok · ${totalDev} dev</span>
      </div>
      <div class="zone-items" role="group"></div>
    `;

    const wrap = $('.zone-items', group);
    locs.forEach(loc=>{
      const devs = state.devices[loc.id]||[];
      const agg = locationAggregateStatus(loc.id);
      const offDevs = devs.filter(d=>d.status==='Offline');
      const warnDevs = devs.filter(d=>d.status==='Maintenance');

      let tagHtml = '';
      if (offDevs.length > 0) {
        tagHtml = `<span class="loc-tag t-alert">! ${offDevs.length} OFF</span>`;
      } else if (warnDevs.length > 0) {
        tagHtml = `<span class="loc-tag t-warn">▲ ${warnDevs.length} WARN</span>`;
      }

      const item = document.createElement('div');
      item.className = 'loc-item';
      item.dataset.locId = loc.id;
      item.dataset.status = agg;
      item.setAttribute('role', 'treeitem');
      item.setAttribute('tabindex', '0');

      item.innerHTML = `
        <div class="loc-left">
          <span class="status-dot s-${agg}"></span>
          <span class="loc-nama" title="${escapeHtml(loc.nama)}">${escapeHtml(loc.nama)}</span>
        </div>
        <div class="loc-right">
          ${tagHtml}
          <span class="loc-dev-count">[ ${devs.length} ]</span>
        </div>
      `;

      item.addEventListener('click', ()=>openDetail(loc.id));
      item.addEventListener('keydown', e=>{
        if(e.key==='Enter'||e.key===' '){
          e.preventDefault();
          openDetail(loc.id);
        }
      });
      wrap.appendChild(item);
    });

    const head = $('.zone-head', group);
    head.addEventListener('click', ()=>{
      const isOpen = group.classList.toggle('open');
      head.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
    head.addEventListener('keydown', e=>{
      if(e.key==='Enter'||e.key===' '){
        e.preventDefault();
        const isOpen = group.classList.toggle('open');
        head.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      }
    });

    container.appendChild(group);
  });

  highlightActiveLoc();
  applySidebarFilter();
  updateSidebarFooterTelemetry();
}

function updateSidebarFooterTelemetry(){
  let totalDevs = 0;
  let offlineDevs = 0;
  let warnDevs = 0;

  Object.values(state.devices||{}).forEach(devArr=>{
    (devArr||[]).forEach(d=>{
      totalDevs++;
      if(d.status==='Offline') offlineDevs++;
      else if(d.status==='Maintenance') warnDevs++;
    });
  });

  const onlineDevs = Math.max(0, totalDevs - offlineDevs - warnDevs);
  const healthPct = totalDevs > 0 ? Math.round((onlineDevs / totalDevs) * 100) : 100;

  const pctEl = $('#st-foot-pct');
  const nodesEl = $('#st-foot-nodes');
  const alertsEl = $('#st-foot-alerts');
  const indEl = $('#st-foot-indicator');

  if(pctEl) pctEl.textContent = healthPct + '%';
  if(nodesEl) nodesEl.textContent = totalDevs;
  if(alertsEl) alertsEl.textContent = offlineDevs;

  if(indEl){
    if(offlineDevs > 0){
      indEl.style.background = 'var(--alert)';
      if(pctEl) pctEl.style.color = 'var(--alert)';
    } else if(warnDevs > 0){
      indEl.style.background = 'var(--warn)';
      if(pctEl) pctEl.style.color = 'var(--warn)';
    } else {
      indEl.style.background = 'var(--ok)';
      if(pctEl) pctEl.style.color = 'var(--ok)';
    }
  }
}

function applySidebarFilter(){
  const searchInput = $('#search-input');
  const q = searchInput ? searchInput.value.trim().toLowerCase() : '';

  $$('.zone-group').forEach(g=>{
    let anyVisible = false;
    $$('.loc-item', g).forEach(item=>{
      const name = item.textContent.toLowerCase();
      const status = item.dataset.status || 'idle';

      const matchSearch = !q || name.includes(q);
      let matchFilter = true;
      if(currentSidebarFilter === 'issues'){
        matchFilter = (status === 'alert' || status === 'warn');
      } else if(currentSidebarFilter === 'offline'){
        matchFilter = (status === 'alert');
      }

      const visible = matchSearch && matchFilter;
      item.classList.toggle('hidden', !visible);
      if(visible) anyVisible = true;
    });

    g.classList.toggle('hidden', !anyVisible);
    if((q || currentSidebarFilter !== 'all') && anyVisible){
      g.classList.add('open');
      const h = $('.zone-head', g);
      if(h) h.setAttribute('aria-expanded', 'true');
    }
  });

  renderGridDashboard();
}

function highlightActiveLoc(){
  $$('.loc-item').forEach(el=>el.classList.toggle('active', el.dataset.locId===currentLocId));
}

// Search input and quick filters setup
(function initSidebarEvents(){
  const si = $('#search-input');
  if(si){
    si.addEventListener('input', ()=>applySidebarFilter());
  }

  // Quick filter chips click handler
  $$('.sqf-chip').forEach(chip=>{
    chip.addEventListener('click', ()=>{
      $$('.sqf-chip').forEach(c=>c.classList.remove('active'));
      chip.classList.add('active');
      currentSidebarFilter = chip.dataset.filter || 'all';
      applySidebarFilter();
    });
  });

  // Global hotkey '/' to focus search & 'Escape' to clear
  window.addEventListener('keydown', e=>{
    const activeEl = document.activeElement;
    const isEditing = activeEl && (
      activeEl.tagName === 'INPUT' || 
      activeEl.tagName === 'TEXTAREA' || 
      activeEl.tagName === 'SELECT' || 
      activeEl.isContentEditable
    );

    if(e.key === '/' && !isEditing){
      e.preventDefault();
      const s = $('#search-input');
      if(s){
        s.focus();
        s.select();
      }
    } else if(e.key === 'Escape' && activeEl === $('#search-input')){
      e.preventDefault();
      activeEl.value = '';
      activeEl.blur();
      applySidebarFilter();
    }
  });
})();

/* ── 10.5 DASHBOARD GRID (Hallmark Telemetry Matrix) ───────────────── */
let gridSortMode = 'faults';
let gridViewMode = 'cards';

function setGridSort(val) {
  gridSortMode = val;
  renderGridDashboard();
}

function setGridViewMode(mode) {
  gridViewMode = mode;
  renderGridDashboard();
}

function renderGridDashboard() {
  const panel = $('#grid-view-panel');
  if (!panel) return;

  const searchTerm = ($('#search-input') ? $('#search-input').value : '').toLowerCase().trim();

  let locs = (state.locations && state.locations.length > 0) ? [...state.locations] : [...SEED_LOCATIONS];

  // Quick filter from sidebar if active
  if (currentSidebarFilter === 'issues') {
    locs = locs.filter(l => {
      const agg = locationAggregateStatus(l.id);
      return agg === 'alert' || agg === 'warn';
    });
  } else if (currentSidebarFilter === 'offline') {
    locs = locs.filter(l => locationAggregateStatus(l.id) === 'alert');
  }

  // Search filter
  if (searchTerm) {
    locs = locs.filter(l => l.nama.toLowerCase().includes(searchTerm) || l.zone.toLowerCase().includes(searchTerm));
  }

  // Calculate live summary statistics
  let totalFaultSites = 0;
  let totalMaintSites = 0;
  let totalHealthySites = 0;

  locs.forEach(loc => {
    const agg = locationAggregateStatus(loc.id);
    if (agg === 'alert') totalFaultSites++;
    else if (agg === 'warn') totalMaintSites++;
    else if (agg === 'ok') totalHealthySites++;
  });

  // Sorting
  if (gridSortMode === 'faults') {
    locs.sort((a, b) => {
      const devsA = state.devices[a.id] || [];
      const devsB = state.devices[b.id] || [];
      const offA = devsA.filter(d => d.status === 'Offline').length;
      const offB = devsB.filter(d => d.status === 'Offline').length;
      if (offA !== offB) return offB - offA;

      const warnA = devsA.filter(d => d.status === 'Maintenance').length;
      const warnB = devsB.filter(d => d.status === 'Maintenance').length;
      if (warnA !== warnB) return warnB - warnA;

      return (devsB.length) - (devsA.length);
    });
  } else if (gridSortMode === 'az') {
    locs.sort((a, b) => a.nama.localeCompare(b.nama));
  } else if (gridSortMode === 'zone') {
    locs.sort((a, b) => (a.zone || '').localeCompare(b.zone || '') || a.nama.localeCompare(b.nama));
  } else if (gridSortMode === 'devs') {
    locs.sort((a, b) => ((state.devices[b.id] || []).length) - ((state.devices[a.id] || []).length));
  }

  // Toolbar HTML
  let html = `
    <div class="grid-toolbar">
      <div class="gt-left">
        <span class="gt-tag">GRID // FLEET MONITOR</span>
        <span class="gt-summary">${locs.length} SITES MONITORED</span>
        ${totalFaultSites > 0 ? `<span class="gt-fault-badge">! ${totalFaultSites} FAULT</span>` : (totalMaintSites > 0 ? `<span class="gt-ok-badge" style="color:var(--warn);background:rgba(210,153,34,0.15);border-color:rgba(210,153,34,0.3)">▲ ${totalMaintSites} MAINT</span>` : `<span class="gt-ok-badge">● 100% OPERATIONAL</span>`)}
      </div>
      <div class="gt-right">
        <div class="gt-control-group">
          <label class="gt-lbl" for="gt-sort-select">SORT</label>
          <select id="gt-sort-select" class="gt-select" onchange="setGridSort(this.value)">
            <option value="faults" ${gridSortMode === 'faults' ? 'selected' : ''}>Prioritas Gangguan (Faults First)</option>
            <option value="az" ${gridSortMode === 'az' ? 'selected' : ''}>Nama Ruangan (A - Z)</option>
            <option value="zone" ${gridSortMode === 'zone' ? 'selected' : ''}>Kategori Area (Zone)</option>
            <option value="devs" ${gridSortMode === 'devs' ? 'selected' : ''}>Jumlah Perangkat (Terbanyak)</option>
          </select>
        </div>
        <div class="gt-view-toggle">
          <button class="gt-btn ${gridViewMode === 'cards' ? 'active' : ''}" onclick="setGridViewMode('cards')" title="Tampilan Kartu Lengkap">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
            <span>KARTU</span>
          </button>
          <button class="gt-btn ${gridViewMode === 'matrix' ? 'active' : ''}" onclick="setGridViewMode('matrix')" title="Tampilan Matriks Ringkas">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="4" height="4"></rect><rect x="10" y="3" width="4" height="4"></rect><rect x="17" y="3" width="4" height="4"></rect><rect x="3" y="10" width="4" height="4"></rect><rect x="10" y="10" width="4" height="4"></rect><rect x="17" y="10" width="4" height="4"></rect><rect x="3" y="17" width="4" height="4"></rect><rect x="10" y="17" width="4" height="4"></rect><rect x="17" y="17" width="4" height="4"></rect></svg>
            <span>MATRIKS</span>
          </button>
        </div>
      </div>
    </div>
  `;

  if (locs.length === 0) {
    html += `
      <div class="empty-state" style="padding:40px 20px; text-align:center; background:var(--panel-2); border:1px solid var(--border); border-radius:6px;">
        <div style="font-size:24px; margin-bottom:8px;">🔍</div>
        <p style="color:var(--text); font-weight:600; margin:0 0 4px;">Tidak ada gedung atau lokasi yang cocok</p>
        <p style="color:var(--text-muted); font-size:12px; margin:0;">Coba sesuaikan kata kunci pencarian atau matikan filter.</p>
      </div>
    `;
    panel.innerHTML = html;
    return;
  }

  // Render Compact Matrix View
  if (gridViewMode === 'matrix') {
    html += '<div class="matrix-layout">';
    locs.forEach(loc => {
      const devs = state.devices[loc.id] || [];
      const total = devs.length;
      const online = devs.filter(d => d.status === 'Online').length;
      const offline = devs.filter(d => d.status === 'Offline').length;
      const maint = devs.filter(d => d.status === 'Maintenance').length;

      let tileClass = 'is-idle';
      let tagText = 'STANDBY';
      let tagClass = 'idle';

      if (total > 0) {
        if (offline > 0) {
          tileClass = 'is-alert';
          tagText = `! ${offline} OFF`;
          tagClass = 'alert';
        } else if (maint > 0) {
          tileClass = 'is-warn';
          tagText = `▲ ${maint} MTC`;
          tagClass = 'warn';
        } else if (online === total) {
          tileClass = 'is-ok';
          tagText = '100% OK';
          tagClass = 'ok';
        }
      }

      html += `
        <div class="matrix-tile ${tileClass}" onclick="openDetail('${loc.id}')" title="Klik untuk membuka detail ${escapeHtml(loc.nama)}">
          <span class="mt-code">${loc.id.toUpperCase()} // ${escapeHtml(loc.zone)}</span>
          <span class="mt-name">${escapeHtml(loc.nama)}</span>
          <div class="mt-foot">
            <span class="mt-status-tag ${tagClass}">${tagText}</span>
            <span class="mt-count">[ ${online}/${total} ]</span>
          </div>
        </div>
      `;
    });
    html += '</div>';
    panel.innerHTML = html;
    return;
  }

  // Render Detailed Cards View
  html += '<div class="grid-layout">';
  locs.forEach(loc => {
    const devs = state.devices[loc.id] || [];
    const total = devs.length;
    const online = devs.filter(d => d.status === 'Online').length;
    const offline = devs.filter(d => d.status === 'Offline').length;
    const maint = devs.filter(d => d.status === 'Maintenance').length;

    let statusClass = 'status-idle';
    let badgeHtml = '<span class="bcard-badge idle">STANDBY</span>';
    let gaugeClass = 'is-idle';
    const healthPct = total > 0 ? Math.round((online / total) * 100) : 100;

    if (total > 0) {
      if (offline > 0) {
        statusClass = 'status-alert';
        gaugeClass = 'is-alert';
        badgeHtml = `<span class="bcard-badge alert">! ${offline} CRITICAL</span>`;
      } else if (maint > 0) {
        statusClass = 'status-warn';
        gaugeClass = 'is-warn';
        badgeHtml = `<span class="bcard-badge warn">▲ ${maint} MAINT</span>`;
      } else if (online === total) {
        statusClass = 'status-ok';
        gaugeClass = 'is-ok';
        badgeHtml = `<span class="bcard-badge ok">● 100% OPERATIONAL</span>`;
      } else {
        statusClass = 'status-idle';
        gaugeClass = 'is-idle';
        badgeHtml = `<span class="bcard-badge idle">● PARTIAL</span>`;
      }
    }

    // Ping average calculation
    const pingDevs = devs.filter(d => d.status === 'Online' && d.last_ping_ms != null && !isNaN(d.last_ping_ms));
    const avgPing = pingDevs.length > 0 ? Math.round(pingDevs.reduce((acc, d) => acc + Number(d.last_ping_ms), 0) / pingDevs.length) : null;
    const avgPingText = avgPing != null ? `${avgPing}ms` : '--';

    const previewDevs = devs.slice(0, 3);
    let devListHtml = '';

    if (previewDevs.length > 0) {
      devListHtml = previewDevs.map(d => {
        const isOffline = d.status === 'Offline';
        const isMaint = d.status === 'Maintenance';
        const isOnline = d.status === 'Online';
        const dotStatus = isOffline ? 'offline' : (isMaint ? 'maintenance' : (isOnline ? 'online' : 'unknown'));
        const latText = d.last_ping_ms != null ? `[ ${d.last_ping_ms}ms ]` : '';

        return `
          <div class="tcard-dev-row ${isOffline ? 'alert' : ''}">
            <div class="tcard-dev-lead">
              <span class="tcard-dev-dot s-${dotStatus}"></span>
              <span class="tcard-dev-name" title="${escapeHtml(d.nama)}">${escapeHtml(d.nama)}</span>
            </div>
            <div class="tcard-dev-trail">
              <span class="tcard-dev-ip">${escapeHtml(d.ip || 'NO-IP')}</span>
              ${latText ? `<span class="tcard-dev-lat">${latText}</span>` : ''}
              <span class="tcard-dev-tag s-${dotStatus}">${(d.status || 'UNKNOWN').toUpperCase()}</span>
            </div>
          </div>
        `;
      }).join('');
    } else {
      devListHtml = '<div style="font-size:11px; color:var(--text-muted); font-family:var(--mono); padding:8px 0; text-align:center;">// Belum ada perangkat terpasang</div>';
    }

    const zoneObj = ZONES.find(z => z.key === loc.zone);
    const zoneLabel = zoneObj ? zoneObj.label : loc.zone;

    html += `
      <div class="bcard ${statusClass}">
        <div class="bcard-head">
          <div>
            <div class="bcard-meta">
              <span class="bcard-zone">${escapeHtml(zoneLabel)}</span>
              <span class="bcard-id-tag">LOC // ${loc.id.toUpperCase()}</span>
            </div>
            <h3 class="bcard-title">${escapeHtml(loc.nama)}</h3>
          </div>
          ${badgeHtml}
        </div>

        <div class="tcard-gauge-wrap" title="Kesehatan Sistem: ${healthPct}%">
          <div class="tcard-gauge-bar ${gaugeClass}" style="width:${healthPct}%"></div>
        </div>

        <div class="tcard-metrics">
          <div class="tcm-item"><span class="tcm-k">NODES</span><b class="tcm-v">${total}</b></div>
          <div class="tcm-sep">│</div>
          <div class="tcm-item"><span class="tcm-k">ONLINE</span><b class="tcm-v ok">${online}</b></div>
          <div class="tcm-sep">│</div>
          <div class="tcm-item"><span class="tcm-k">FAULT</span><b class="tcm-v ${offline > 0 ? 'alert' : ''}">${offline}</b></div>
          <div class="tcm-sep">│</div>
          <div class="tcm-item"><span class="tcm-k">AVG LAT</span><b class="tcm-v">${avgPingText}</b></div>
        </div>

        <div class="bcard-devices">
          ${devListHtml}
        </div>

        <div class="bcard-foot">
          <button class="bcard-btn" onclick="openDetail('${loc.id}')">
            <span>BUKA DIAGNOSTIK & KONTROL</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </button>
        </div>
      </div>
    `;
  });

  html += '</div>';
  panel.innerHTML = html;
}

/* ── 11. TOPOLOGY — Hallmark Industrial Signal Flow & Schematic ─────────── */

let _uidSeq = 0;
const collapsedNodes = new Set();

let topoFilterMode = 'all'; // 'all' or 'faults'
let topoViewMode = 'schematic'; // 'schematic' or 'tree'
let topoSearchTerm = '';

/* Helper: Rollup telemetry status from descendants or building locId */
function getNodeAggregateStatus(node) {
  if (!node) return 'idle';
  if (node.kind === 'building' && node.locId) {
    return locationAggregateStatus(node.locId);
  }
  let hasAlert = false;
  let hasWarn = false;
  let hasOk = false;

  function traverse(n) {
    if (!n) return;
    if (n.kind === 'building' && n.locId) {
      const s = locationAggregateStatus(n.locId);
      if (s === 'alert') hasAlert = true;
      else if (s === 'warn') hasWarn = true;
      else if (s === 'ok') hasOk = true;
    }
    (n.children || []).forEach(traverse);
  }
  (node.children || []).forEach(traverse);

  if (hasAlert) return 'alert';
  if (hasWarn) return 'warn';
  if (hasOk) return 'ok';
  return 'idle';
}

/* Helper: Count all descendants of a node */
function countDescendants(node) {
  if (!node) return 0;
  let count = 0;
  function walk(n) {
    (n.children || []).forEach(c => {
      count++;
      walk(c);
    });
  }
  walk(node);
  return count;
}

/* Helper: Retrieve all UIDs for nodes having children */
function getAllExpandableUids(node) {
  const uids = [];
  function walk(n) {
    if (!n) return;
    if (n.children && n.children.length > 0) {
      uids.push(n._uid);
      n.children.forEach(walk);
    }
  }
  walk(node);
  return uids;
}

/* Tree Control Actions */
window.expandAllTopo = function() {
  collapsedNodes.clear();
  renderTopology();
};

window.collapseAllTopo = function() {
  collapsedNodes.clear();
  if (NETWORK_TREE) {
    (NETWORK_TREE.children || []).forEach(child => {
      getAllExpandableUids(child).forEach(uid => collapsedNodes.add(uid));
    });
  }
  renderTopology();
};

window.setTopoFilterMode = function(mode) {
  topoFilterMode = mode;
  renderTopology();
};

window.setTopoViewMode = function(mode) {
  topoViewMode = mode;
  renderTopology();
};

window.onTopoSearch = function(val) {
  topoSearchTerm = (val || '').trim().toLowerCase();
  if (topoSearchTerm && NETWORK_TREE) {
    function revealMatching(n, parentPath) {
      if (!n) return false;
      const isMatch = (n.label || '').toLowerCase().includes(topoSearchTerm);
      let childMatched = false;
      (n.children || []).forEach(c => {
        if (revealMatching(c, parentPath.concat(n))) {
          childMatched = true;
        }
      });
      if (isMatch || childMatched) {
        parentPath.forEach(p => collapsedNodes.delete(p._uid));
        return true;
      }
      return false;
    }
    revealMatching(NETWORK_TREE, []);
  }
  renderTopology();
};

/* Interactive Signal Path Illumination */
window.highlightSignalPath = function(uid) {
  if (!uid) return;
  $$('.tc.is-path-highlight, .tt-node-row.is-path-highlight').forEach(el => el.classList.remove('is-path-highlight'));
  const path = [];
  function findPath(n, currentPath) {
    if (!n) return false;
    currentPath.push(n._uid);
    if (n._uid === uid) {
      path.push(...currentPath);
      return true;
    }
    for (const c of (n.children || [])) {
      if (findPath(c, currentPath)) return true;
    }
    currentPath.pop();
    return false;
  }
  if (NETWORK_TREE) findPath(NETWORK_TREE, []);
  path.forEach(pUid => {
    $$(`[data-uid="${pUid}"]`).forEach(el => el.classList.add('is-path-highlight'));
  });
};

window.clearSignalPath = function() {
  $$('.tc.is-path-highlight, .tt-node-row.is-path-highlight').forEach(el => el.classList.remove('is-path-highlight'));
};

/* Get all currently-visible leaf paths (respects collapsed nodes) */
function _leafPaths(node, path){
  if (!node) return [];
  path = (path||[]).concat(node);
  const ch = node.children||[];
  if (!ch.length || collapsedNodes.has(node._uid)) return [path];
  return ch.reduce((a,c) => a.concat(_leafPaths(c, path)), []);
}

function escapeSvg(s){ return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;'); }

/* Build the HTML for the hierarchical schematic table */
function buildTopoTable(){
  if(!NETWORK_TREE) return '';
  let paths = _leafPaths(NETWORK_TREE, []);
  if (topoFilterMode === 'faults') {
    paths = paths.filter(p => p.some(n => {
      const st = getNodeAggregateStatus(n);
      return st === 'alert' || st === 'warn';
    }));
  }

  if (paths.length === 0) {
    return `
      <tr>
        <td colspan="10" style="border:none; padding:48px 20px; text-align:center;">
          <div style="font-family:var(--mono); color:var(--ok); font-size:14px; font-weight:700; margin-bottom:6px;">
            ● 100% OPERATIONAL // TIDAK ADA GANGGUAN TERDETEKSI
          </div>
          <p style="color:var(--text-muted); font-size:12px; margin:0 0 14px; font-family:var(--sans);">
            Seluruh cabang dan jalur infrastruktur jaringan saat ini berstatus normal.
          </p>
          <button class="tt-btn" onclick="setTopoFilterMode('all')">TAMPILKAN SEMUA RUTE</button>
        </td>
      </tr>
    `;
  }

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

    for (let ci = 0; ci < path.length; ci++) {
      const node = path[ci];
      const rs   = rsMap.get(node);
      if (rs.rowStart !== ri) continue; /* already rendered via rowspan */

      const isRoot   = ci === 0;
      const isLast   = ci === path.length - 1;
      const colspan  = isLast && ci < maxCol ? maxCol - ci + 1 : 1;
      const hasKids  = (node.children||[]).length > 0;
      const isColl   = collapsedNodes.has(node._uid);
      const isBldg   = node.kind === 'building';
      const locId    = node.locId || '';
      const agg      = getNodeAggregateStatus(node);
      const cnt      = isBldg && locId ? deviceCount(locId) : 0;
      const descCount = countDescendants(node);

      let tierTag = 'ACC';
      let tierClass = 'acc';
      if (isRoot) {
        tierTag = 'CORE';
        tierClass = 'core';
      } else if (node.label && (node.label.includes('FO') || node.label.includes('SW-') || ci === 1)) {
        tierTag = node.label.includes('FO') ? 'FO-TRUNK' : 'DIST';
        tierClass = 'dist';
      } else if (isBldg) {
        tierTag = 'LOC';
        tierClass = 'bldg';
      }

      const isSearchMatch = topoSearchTerm && (node.label || '').toLowerCase().includes(topoSearchTerm);

      let cls = 'tc';
      if (isBldg) cls += ' tc-bldg';
      else if (hasKids) cls += ' tc-parent';
      else cls += ' tc-leaf';
      if (isColl) cls += ' tc-coll';
      else if (hasKids) cls += ' tc-expanded';
      if (isRoot) cls += ' tc-root';
      if (isSearchMatch) cls += ' is-search-match';
      cls += ` s-${agg} tier-${tierClass}`;

      const onclick = isBldg && locId
        ? `openDetail('${locId}')`
        : hasKids ? `_tt(${node._uid})` : '';

      h += `<td class="${cls}" data-uid="${node._uid}" rowspan="${rs.span}" colspan="${colspan}"${onclick ? ` onclick="${onclick}"` : ''} onmouseenter="highlightSignalPath(${node._uid})" onmouseleave="clearSignalPath()" title="${escapeSvg(node.label)}">`;
      h += `<div class="tc-in">`;
      if (hasKids) {
        h += `<span class="tc-chev">${isColl ? '▶' : '▼'}</span>`;
      } else {
        h += `<span class="tc-tier-tag ${tierClass}">${tierTag}</span>`;
      }
      h += `<span class="tc-lbl">${escapeSvg(node.label)}</span>`;
      if (isColl && descCount > 0) {
        h += `<span class="tc-coll-pill">[+${descCount}]</span>`;
      }
      if (cnt > 0) {
        h += `<span class="tc-cnt s-${agg}">${cnt}</span>`;
      }
      h += `</div></td>`;
    }
    h += '</tr>';
  });

  return h;
}

/* Build the HTML for the Cascading Tree View (Mobile / Vertical NOC View) */
function buildTopoCascadeTree() {
  if (!NETWORK_TREE) return '';
  let html = '<div class="topo-tree-container">';

  function renderTreeNode(node, depth, isLastChild, guidePrefix) {
    if (!node) return;
    const isRoot = depth === 0;
    const hasKids = (node.children || []).length > 0;
    const isColl = collapsedNodes.has(node._uid);
    const isBldg = node.kind === 'building';
    const locId = node.locId || '';
    const agg = getNodeAggregateStatus(node);
    const cnt = isBldg && locId ? deviceCount(locId) : 0;
    const descCount = countDescendants(node);

    if (topoFilterMode === 'faults' && agg !== 'alert' && agg !== 'warn') {
      return;
    }

    const isSearchMatch = topoSearchTerm && (node.label || '').toLowerCase().includes(topoSearchTerm);

    let tierTag = 'ACC';
    let tierClass = 'acc';
    if (isRoot) { tierTag = 'CORE'; tierClass = 'core'; }
    else if (node.label && (node.label.includes('FO') || node.label.includes('SW-') || depth === 1)) {
      tierTag = node.label.includes('FO') ? 'FO' : 'DIST';
      tierClass = 'dist';
    } else if (isBldg) {
      tierTag = 'LOC';
      tierClass = 'bldg';
    }

    const branchChar = isRoot ? '●' : (isLastChild ? '└──' : '├──');
    const rowClick = isBldg && locId ? `openDetail('${locId}')` : (hasKids ? `_tt(${node._uid})` : '');

    html += `
      <div class="tt-node-row s-${agg} ${isSearchMatch ? 'is-search-match' : ''}" data-uid="${node._uid}" ${rowClick ? `onclick="${rowClick}"` : ''} onmouseenter="highlightSignalPath(${node._uid})" onmouseleave="clearSignalPath()" style="margin-left:${Math.min(depth * 18, 90)}px;">
        <div class="tt-node-lead">
          <span class="tt-guide-line">${isRoot ? '' : branchChar}</span>
          ${hasKids ? `<button class="tc-chev" onclick="event.stopPropagation(); _tt(${node._uid})">${isColl ? '▶' : '▼'}</button>` : `<span class="tc-tier-tag ${tierClass}">${tierTag}</span>`}
          <span class="tt-node-name" title="${escapeHtml(node.label)}">${escapeHtml(node.label)}</span>
        </div>
        <div class="tt-node-trail">
          ${isColl && descCount > 0 ? `<span class="tc-coll-pill">[+${descCount}]</span>` : ''}
          ${cnt > 0 ? `<span class="tc-cnt s-${agg}">${cnt} DEVS</span>` : ''}
          ${isBldg ? `<span class="tc-view-btn" onclick="event.stopPropagation(); openDetail('${locId}')">DETAIL →</span>` : ''}
        </div>
      </div>
    `;

    if (hasKids && !isColl) {
      const children = node.children;
      children.forEach((child, idx) => {
        renderTreeNode(child, depth + 1, idx === children.length - 1, guidePrefix + (isLastChild ? '    ' : '│   '));
      });
    }
  }

  renderTreeNode(NETWORK_TREE, 0, true, '');
  html += '</div>';
  return html;
}

/* Toggle collapse state and re-render */
function _tt(uid){
  if (collapsedNodes.has(uid)) collapsedNodes.delete(uid);
  else collapsedNodes.add(uid);
  renderTopology();
}

let isDraggingTopo = false;
let topoStartX = 0, topoStartY = 0;
let topoScrollLeft = 0, topoScrollTop = 0;
let topoHasMoved = false;

function enableTopoDragScroll(scrollEl) {
  if (!scrollEl || scrollEl._hasDragScroll) return;
  scrollEl._hasDragScroll = true;
  scrollEl.style.cursor = 'grab';

  scrollEl.addEventListener('mousedown', (e) => {
    if (e.target.closest('button, a, input, select')) return;
    isDraggingTopo = true;
    topoHasMoved = false;
    scrollEl.style.cursor = 'grabbing';
    topoStartX = e.clientX;
    topoStartY = e.clientY;
    topoScrollLeft = scrollEl.scrollLeft;
    topoScrollTop  = scrollEl.scrollTop;
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDraggingTopo || !scrollEl) return;
    const dx = e.clientX - topoStartX;
    const dy = e.clientY - topoStartY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      topoHasMoved = true;
    }
    scrollEl.scrollLeft = topoScrollLeft - dx;
    scrollEl.scrollTop  = topoScrollTop - dy;
  });

  document.addEventListener('mouseup', () => {
    if (isDraggingTopo) {
      isDraggingTopo = false;
      if (scrollEl) scrollEl.style.cursor = 'grab';
    }
  });

  scrollEl.addEventListener('click', (e) => {
    if (topoHasMoved) {
      e.stopPropagation();
      e.preventDefault();
      topoHasMoved = false;
    }
  }, true);
}

function renderTopology(){
  const inner = $('#topo-inner');
  if (!inner) return;

  const oldScroll = $('.topo-table-scroll', inner) || $('.topo-tree-scroll', inner);
  const prevLeft = oldScroll ? oldScroll.scrollLeft : 0;
  const prevTop  = oldScroll ? oldScroll.scrollTop  : 0;

  // Calculate live HUD telemetry
  let totalNodes = RAW_TOPOLOGY.length;
  let trunkCount = RAW_TOPOLOGY.filter(n => n.kind === 'infra' && n.label && (n.label.includes('FO') || n.label.includes('SW-'))).length;
  let bldgCount = RAW_TOPOLOGY.filter(n => n.kind === 'building').length;
  let rootAgg = getNodeAggregateStatus(NETWORK_TREE);

  let faultBadge = '';
  if (rootAgg === 'alert') {
    faultBadge = '<span class="tt-fault-badge">! GANGGUAN JALUR</span>';
  } else if (rootAgg === 'warn') {
    faultBadge = '<span class="tt-ok-badge" style="color:var(--warn); background:rgba(210,153,34,0.15); border-color:rgba(210,153,34,0.3)">▲ MAINTENANCE</span>';
  } else {
    faultBadge = '<span class="tt-ok-badge">● 100% OPERATIONAL</span>';
  }

  let contentHtml = '';
  if (topoViewMode === 'tree') {
    contentHtml = `
      <div class="topo-tree-scroll">
        ${buildTopoCascadeTree()}
      </div>
    `;
  } else {
    contentHtml = `
      <div class="topo-table-scroll">
        <table class="topo-htable"><tbody>${buildTopoTable()}</tbody></table>
      </div>
    `;
  }

  inner.innerHTML = `
    <div class="topo-th-wrap">
      <div class="topo-toolbar">
        <div class="tt-left">
          <span class="tt-tag">SIGNAL PATH // CORE BACKBONE</span>
          <div class="tt-hud">
            <span class="tt-hud-item">NODES: <b>${totalNodes}</b></span>
            <span class="tt-hud-sep">│</span>
            <span class="tt-hud-item">TRUNKS: <b>${trunkCount}</b></span>
            <span class="tt-hud-sep">│</span>
            <span class="tt-hud-item">SITES: <b>${bldgCount}</b></span>
          </div>
          ${faultBadge}
        </div>
        <div class="tt-right">
          <div class="tt-search-wrap">
            <svg class="tt-search-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input type="text" class="tt-search-input" placeholder="Cari node / gedung..." value="${escapeHtml(topoSearchTerm)}" oninput="onTopoSearch(this.value)">
            ${topoSearchTerm ? `<button class="tt-clear-search" onclick="onTopoSearch('')" title="Hapus pencarian">×</button>` : ''}
          </div>
          <div class="tt-btn-group">
            <button class="tt-btn" onclick="expandAllTopo()" title="Buka Semua Cabang Topologi">⊞ BUKA SEMUA</button>
            <button class="tt-btn" onclick="collapseAllTopo()" title="Tutup Semua Cabang FO">⊟ TUTUP SEMUA</button>
            <button class="tt-btn tt-filter-fault ${topoFilterMode === 'faults' ? 'active' : ''}" onclick="setTopoFilterMode(topoFilterMode === 'faults' ? 'all' : 'faults')" title="Saring Hanya Jalur yang Mengalami Gangguan">
              ! HANYA GANGGUAN
            </button>
          </div>
          <div class="gt-view-toggle">
            <button class="gt-btn ${topoViewMode === 'schematic' ? 'active' : ''}" onclick="setTopoViewMode('schematic')" title="Tampilan Matriks Skematik (Horizontal)">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
              <span>SKEMATIK</span>
            </button>
            <button class="gt-btn ${topoViewMode === 'tree' ? 'active' : ''}" onclick="setTopoViewMode('tree')" title="Tampilan Pohon Kaskade (Vertikal)">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
              <span>POHON</span>
            </button>
          </div>
        </div>
      </div>
      ${contentHtml}
      <div class="topo-legend-strip">
        <div class="tls-left">
          <div class="tls-item"><span class="tls-dot ok"></span><span>Online / Normal</span></div>
          <div class="tls-item"><span class="tls-dot alert"></span><span>Gangguan / Offline</span></div>
          <div class="tls-item"><span class="tls-dot warn"></span><span>Maintenance</span></div>
          <div class="tls-item"><span class="tls-dot idle"></span><span>Belum Ada Data</span></div>
        </div>
        <div class="tls-hint">
          <span>// Klik ▶/▼ expand · Arahkan kursor untuk menyorot jalur sinyal</span>
        </div>
      </div>
    </div>
  `;

  const newScroll = $('.topo-table-scroll', inner) || $('.topo-tree-scroll', inner);
  if (newScroll) {
    newScroll.scrollLeft = prevLeft;
    newScroll.scrollTop  = prevTop;
    if (newScroll.classList.contains('topo-table-scroll')) {
      enableTopoDragScroll(newScroll);
    }
  }
}

function setupPanZoom(){
  /* Table view: no SVG pan/zoom needed — hide old controls */
  const ctrl = document.querySelector('.topo-controls');
  if (ctrl) ctrl.style.display = 'none';
  const hint = document.querySelector('#view-topo .hint');
  if (hint) hint.style.display = 'none';
}


/* ── 12. TABS ──────────────────────────────────────────────────────── */
let previousActiveTab = 'grid';

function switchTab(name){
  if (name !== 'detail') {
    previousActiveTab = name;
  }
  localStorage.setItem('activeTab', name);
  $$('.tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
  $('#view-grid').classList.toggle('active', name==='grid');
  $('#view-topo').classList.toggle('active', name==='topo');
  $('#view-detail').classList.toggle('active', name==='detail');
  $('#view-offline').classList.toggle('active', name==='offline');
  $('#view-report').classList.toggle('active', name==='report');
  $('#view-audit').classList.toggle('active', name==='audit');
  const vu = $('#view-users');
  if(vu) vu.classList.toggle('active', name==='users');
  const vr = $('#view-routers');
  if(vr) vr.classList.toggle('active', name==='routers');
  const vmt = $('#view-manage-topo');
  if(vmt) vmt.classList.toggle('active', name==='manage-topo');
  if(name==='grid') renderGridDashboard();
  if(name==='offline') renderOfflineDevices();
  if(name==='report') renderReportView();
  if(name==='audit') renderAuditView();
  if(name==='users') renderUsersView();
  if(name==='routers') renderRoutersView();
  if(name==='manage-topo') renderManageTopo();
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
  if (tab === 'users') renderUsersView();
  if (tab === 'routers') renderRoutersView();
}

/* ── 12B. OFFLINE INCIDENT & RECOVERY CONSOLE (Hallmark Industrial Standard) ── */

let offlineFilterType = 'all';
let offlineFilterLoc = 'all';
let offlineSearchTerm = '';
let isBatchOfflinePinging = false;

/* Batch Ping All Offline Devices to Test Recovery */
async function pingAllOfflineDevices(btn) {
  if (isBatchOfflinePinging) return;
  const offlineDevs = [];
  Object.entries(state.devices).forEach(([locId, devs]) => {
    devs.forEach(d => {
      if (d.status === 'Offline' && d.ip) {
        offlineDevs.push(d);
      }
    });
  });

  if (offlineDevs.length === 0) {
    showToast('Tidak ada perangkat offline dengan IP terdaftar', 'info');
    return;
  }

  isBatchOfflinePinging = true;
  btn.disabled = true;
  const origHtml = btn.innerHTML;
  btn.innerHTML = `<span class="bg-spinner" style="border-width:1.5px; width:11px; height:11px;"></span> <span>PROBE (0/${offlineDevs.length})...</span>`;

  let recoveredCount = 0;
  let stillOfflineCount = 0;

  for (let i = 0; i < offlineDevs.length; i++) {
    const d = offlineDevs[i];
    try {
      const res = await api.get(`/api/ping/now/${encodeURIComponent(d.ip)}`);
      const data = await res.json();
      if (data.online) {
        recoveredCount++;
        d.status = 'Online';
        d.last_ping_ms = data.latency_ms;
      } else {
        stillOfflineCount++;
        d.status = 'Offline';
        d.last_ping_ms = null;
      }
    } catch (err) {
      stillOfflineCount++;
    }
    btn.innerHTML = `<span class="bg-spinner" style="border-width:1.5px; width:11px; height:11px;"></span> <span>PROBE (${i + 1}/${offlineDevs.length})...</span>`;
  }

  isBatchOfflinePinging = false;
  btn.disabled = false;
  btn.innerHTML = origHtml;

  if (recoveredCount > 0) {
    showToast(`Pemulihan terdeteksi: ${recoveredCount} perangkat kembali ONLINE!`, 'ok');
  } else {
    showToast(`Pemeriksaan selesai: ${stillOfflineCount} perangkat masih belum merespons probe ICMP`, 'warn');
  }

  renderStats();
  renderSidebar();
  renderTopology();
  renderOfflineDevices();
}

window.setOfflineTypeFilter = function(type) {
  offlineFilterType = type;
  renderOfflineDevices();
};

window.setOfflineLocFilter = function(locId) {
  offlineFilterLoc = locId;
  renderOfflineDevices();
};

window.onOfflineSearch = function(val) {
  offlineSearchTerm = (val || '').trim().toLowerCase();
  renderOfflineDevices();
};

function renderOfflineDevices() {
  const panel = $('#offline-panel');
  if (!panel) return;

  const allOfflineDevs = [];
  Object.entries(state.devices).forEach(([locId, devs]) => {
    const loc = state.locations.find(l => l.id === locId);
    devs.forEach(d => {
      if (d.status === 'Offline') {
        allOfflineDevs.push({
          ...d,
          locName: loc ? loc.nama : locId,
          locZone: loc ? loc.zone : '',
          locId
        });
      }
    });
  });

  // Zero-defect Standby State (No Raw Emojis, Industrial Standard)
  if (allOfflineDevs.length === 0) {
    panel.innerHTML = `
      <div class="empty-state" style="padding: 64px 20px; text-align: center;">
        <div style="display:inline-flex; align-items:center; justify-content:center; width:48px; height:48px; border-radius:8px; background:rgba(63, 185, 80, 0.12); border:1px solid rgba(63, 185, 80, 0.3); margin-bottom:14px; color:var(--ok);">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
        </div>
        <h3 style="font-family:var(--mono); color:var(--text); font-size:14px; font-weight:700; margin:0 0 6px;">INCIDENT CONSOLE // ALL SYSTEMS REACHABLE</h3>
        <p style="color:var(--text-muted); font-size:12px; margin:0 0 16px; max-width:420px;">Seluruh node dan perangkat jaringan di semua gedung saat ini merespons probe ICMP dengan normal. Tidak ada insiden koneksi terputus.</p>
        <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
          <button class="tt-btn" onclick="switchTab('grid')">BUKA DASHBOARD GRID →</button>
          <button class="tt-btn" onclick="switchTab('topo')">BUKA PETA TOPOLOGI →</button>
        </div>
      </div>
    `;
    return;
  }

  const isAdmin = currentUser && currentUser.role === 'admin';
  const totalOffline = allOfflineDevs.length;

  // Telemetry Calculations
  const affectedLocIds = Array.from(new Set(allOfflineDevs.map(d => d.locId)));
  const affectedLocCount = affectedLocIds.length;
  const infraOfflineCount = allOfflineDevs.filter(d => ['switch', 'router', 'gateway'].includes((d.tipe || '').toLowerCase())).length;
  const clientOfflineCount = totalOffline - infraOfflineCount;

  // Filter Options
  const uniqueTypes = Array.from(new Set(allOfflineDevs.map(d => d.tipe).filter(Boolean)));
  const uniqueLocs = affectedLocIds.map(id => {
    const l = state.locations.find(loc => loc.id === id);
    return { id, nama: l ? l.nama : id };
  });

  // Apply Filters
  let filteredDevs = allOfflineDevs;
  if (offlineFilterType !== 'all') {
    filteredDevs = filteredDevs.filter(d => (d.tipe || '').toLowerCase() === offlineFilterType.toLowerCase());
  }
  if (offlineFilterLoc !== 'all') {
    filteredDevs = filteredDevs.filter(d => d.locId === offlineFilterLoc);
  }
  if (offlineSearchTerm) {
    filteredDevs = filteredDevs.filter(d =>
      (d.nama || '').toLowerCase().includes(offlineSearchTerm) ||
      (d.locName || '').toLowerCase().includes(offlineSearchTerm) ||
      (d.ip || '').toLowerCase().includes(offlineSearchTerm) ||
      (d.mac || '').toLowerCase().includes(offlineSearchTerm) ||
      (d.merk || '').toLowerCase().includes(offlineSearchTerm) ||
      (d.catatan || '').toLowerCase().includes(offlineSearchTerm)
    );
  }

  // Desktop Table Rows
  const tableRowsHtml = filteredDevs.map(d => {
    const isInfra = ['switch', 'router', 'gateway'].includes((d.tipe || '').toLowerCase());
    const tierClass = isInfra ? 'dist' : 'acc';

    return `
      <tr class="is-offline-row">
        <td>
          <div class="dt-dev-name-wrap">
            <span class="tcard-dev-dot s-offline"></span>
            <div class="dt-dev-info">
              <b class="dt-dev-name">${escapeHtml(d.nama)}</b>
              <span class="dt-dev-sub">${escapeHtml(d.merk || '—')}</span>
            </div>
          </div>
        </td>
        <td>
          <button class="off-loc-btn" onclick="openDetail('${d.locId}')" title="Buka Detail Gedung ${escapeHtml(d.locName)}">
            <span class="olb-name">${escapeHtml(d.locName)}</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </button>
        </td>
        <td>
          <span class="tc-tier-tag ${tierClass}">${escapeHtml(d.tipe || 'DEVICE')}</span>
        </td>
        <td class="ip-cell">
          <div class="dt-ip-wrap">
            ${d.ip ? `
              <span class="dt-ip-code" onclick="navigator.clipboard.writeText('${d.ip}'); showToast('IP disalin ke clipboard','ok')" title="Klik untuk salin IP">
                ${escapeHtml(d.ip)}
              </span>
              <button class="icon-btn" title="Probe Ping Sekarang" onclick="pingNow('${d.id}','${d.ip}',this)">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
              </button>
            ` : '<span style="color:var(--text-muted)">—</span>'}
          </div>
          ${d.mac ? `<span class="dt-mac-code">${escapeHtml(d.mac)}</span>` : ''}
        </td>
        <td>
          <div class="dt-status-wrap">
            ${statusBadge(d.status)}
            ${latencyChip(d.last_ping_ms)}
          </div>
        </td>
        <td>
          <div class="row-actions">
            ${isAdmin && d.mac ? `
              <button class="icon-btn" title="Wake on LAN (WoL)" onclick="wakeDevice('${d.id}')">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
              </button>` : ''}
            ${isAdmin ? `
              <button class="icon-btn" title="Ubah Perangkat" onclick="editDevice('${d.id}')">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              </button>` : ''}
            <button class="icon-btn" title="Riwayat Latensi" onclick="openHistoryModal('${d.id}')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 3v18h18"></path><path d="M18 9l-5 5-4-4-3 3"></path></svg>
            </button>
            ${isAdmin && d.ip ? `
              <button class="icon-btn" title="Reboot SSH" onclick="openRebootModal('${d.id}')">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
              </button>` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Mobile Fault Cards
  const mobileCardsHtml = filteredDevs.map(d => {
    return `
      <div class="off-card">
        <div class="off-card-head">
          <div>
            <div class="off-card-meta">
              <span class="tc-tier-tag dist">${escapeHtml(d.tipe || 'DEV')}</span>
              <span>${escapeHtml(d.merk || '')}</span>
            </div>
            <h4 class="off-card-title">${escapeHtml(d.nama)}</h4>
          </div>
          <div style="display:flex; flex-direction:column; align-items:flex-end; gap:3px;">
            ${statusBadge(d.status)}
            ${latencyChip(d.last_ping_ms)}
          </div>
        </div>

        <div class="off-card-loc-wrap">
          <button class="off-loc-btn" onclick="openDetail('${d.locId}')">
            <span>SITE: <b>${escapeHtml(d.locName)}</b></span>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </button>
        </div>

        <div class="off-card-net">
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="color:var(--text-muted); font-size:10px;">IP:</span>
            <span class="dt-ip-code" onclick="navigator.clipboard.writeText('${d.ip||''}'); showToast('IP disalin','ok')">${escapeHtml(d.ip || 'NO-IP')}</span>
          </div>
          ${d.mac ? `<span class="dt-mac-code">${escapeHtml(d.mac)}</span>` : ''}
        </div>

        ${d.catatan ? `<div style="font-size:11px; color:var(--text-muted); font-family:var(--sans); font-style:italic;">"${escapeHtml(d.catatan)}"</div>` : ''}

        <div class="off-card-actions">
          ${d.ip ? `
            <button class="icon-btn" title="Probe Ping Sekarang" onclick="pingNow('${d.id}','${d.ip}',this)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
            </button>` : ''}
          ${isAdmin && d.mac ? `
            <button class="icon-btn" title="Wake on LAN" onclick="wakeDevice('${d.id}')">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
            </button>` : ''}
          ${isAdmin && d.ip ? `
            <button class="icon-btn" title="Reboot SSH" onclick="openRebootModal('${d.id}')">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
            </button>` : ''}
          <button class="icon-btn" title="Riwayat Latensi" onclick="openHistoryModal('${d.id}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 3v18h18"></path><path d="M18 9l-5 5-4-4-3 3"></path></svg>
          </button>
          ${isAdmin ? `
            <button class="icon-btn" title="Ubah Data" onclick="editDevice('${d.id}')">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            </button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  panel.innerHTML = `
    <!-- Incident Mission Header -->
    <div class="offline-head">
      <div class="oh-lead">
        <div class="oh-meta">
          <span>INCIDENT LOG // ACTIVE FAULTS // FACTORY NETWORK</span>
          <span class="bcard-id-tag" style="border-color:rgba(248,81,73,0.4); color:var(--alert);">ALERT SEVERITY-1</span>
        </div>
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <h2 class="oh-title">GANGGUAN PERANGKAT TERPUTUS</h2>
          <span class="tcard-dev-tag alert" style="font-size:10px; padding:3px 8px;">
            <span class="tcard-dev-dot s-offline"></span>${totalOffline} PERANGKAT OFFLINE
          </span>
        </div>
      </div>

      <div class="oh-actions">
        <button class="oh-btn" onclick="pingAllOfflineDevices(this)" title="Lakukan probe ping ulang ke seluruh perangkat offline">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
          <span>PROBE ULANG SEMUA</span>
        </button>
        <button class="oh-btn" onclick="switchTab('report')" title="Buka Laporan Uptime SLA">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 3v18h18"></path><path d="M18 9l-5 5-4-4-3 3"></path></svg>
          <span>LAPORAN SLA</span>
        </button>
      </div>
    </div>

    <!-- Incident Telemetry Metrics Strip -->
    <div class="offline-metrics-strip">
      <div class="tcm-item"><span class="tcm-k">TOTAL FAULTS</span><b class="tcm-v alert">${totalOffline}</b></div>
      <div class="tcm-sep">│</div>
      <div class="tcm-item"><span class="tcm-k">SITES AFFECTED</span><b class="tcm-v ${affectedLocCount > 0 ? 'warn' : 'ok'}">${affectedLocCount}</b></div>
      <div class="tcm-sep">│</div>
      <div class="tcm-item"><span class="tcm-k">INFRA DOWN</span><b class="tcm-v ${infraOfflineCount > 0 ? 'alert' : 'ok'}">${infraOfflineCount}</b></div>
      <div class="tcm-sep">│</div>
      <div class="tcm-item"><span class="tcm-k">CLIENT ENDPOINTS</span><b class="tcm-v">${clientOfflineCount}</b></div>
    </div>

    <!-- Incident Triage & Filter Bar -->
    <div class="offline-filter-bar">
      <div class="of-status-group">
        <button class="of-pill ${offlineFilterType === 'all' ? 'active' : ''}" onclick="setOfflineTypeFilter('all')">SEMUA (${totalOffline})</button>
        ${uniqueTypes.map(t => {
          const count = allOfflineDevs.filter(d => (d.tipe || '').toLowerCase() === t.toLowerCase()).length;
          return `<button class="of-pill ${offlineFilterType.toLowerCase() === t.toLowerCase() ? 'active' : ''}" onclick="setOfflineTypeFilter('${escapeHtml(t)}')">${escapeHtml(t).toUpperCase()} (${count})</button>`;
        }).join('')}
      </div>

      <div class="of-right">
        ${uniqueLocs.length > 0 ? `
          <select class="of-select" onchange="setOfflineLocFilter(this.value)">
            <option value="all">Semua Lokasi (${uniqueLocs.length})</option>
            ${uniqueLocs.map(l => `<option value="${escapeHtml(l.id)}" ${offlineFilterLoc === l.id ? 'selected' : ''}>${escapeHtml(l.nama)}</option>`).join('')}
          </select>
        ` : ''}

        <div class="tt-search-wrap">
          <svg class="tt-search-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input type="text" class="of-search" placeholder="Cari nama, lokasi, IP..." value="${escapeHtml(offlineSearchTerm)}" oninput="onOfflineSearch(this.value)">
          ${offlineSearchTerm ? `<button class="tt-clear-search" onclick="onOfflineSearch('')">×</button>` : ''}
        </div>
      </div>
    </div>

    <!-- Content (Desktop Table + Mobile Cards) -->
    ${filteredDevs.length === 0 ? `
      <div class="empty-state" style="padding:40px 20px; text-align:center; background:var(--panel); border:1px solid var(--border); border-radius:6px;">
        <p style="color:var(--text); font-weight:600; margin:0 0 4px; font-family:var(--mono);">// TIDAK ADA PERANGKAT YANG COCOK DENGAN FILTER</p>
        <p style="color:var(--text-muted); font-size:12px; margin:0;">Sesuaikan filter tipe atau kata kunci pencarian.</p>
      </div>
    ` : `
      <!-- Desktop Industrial Incident Table -->
      <div class="device-table-wrap">
        <table class="device-table">
          <thead>
            <tr>
              <th>PERANGKAT & MODEL</th>
              <th>LOKASI / GEDUNG</th>
              <th>TIPE</th>
              <th>ALAMAT IP & MAC</th>
              <th>STATUS KONEKSI</th>
              <th style="text-align:right">AKSI PEMULIHAN</th>
            </tr>
          </thead>
          <tbody>${tableRowsHtml}</tbody>
        </table>
      </div>

      <!-- Mobile Incident Fault Cards -->
      <div class="offline-cards-mobile">
        ${mobileCardsHtml}
      </div>
    `}
  `;
}
$$('.tab-btn').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));

/* ── 13. DETAIL PANEL (Hallmark Site Diagnostic Workbench) ───────────── */

let detailFilterStatus = 'all'; // 'all', 'Online', 'Offline', 'Maintenance'
let detailFilterType = 'all';
let detailSearchTerm = '';
let isBatchPinging = false;

function openDetail(locId){
  currentLocId = locId;
  closeDeviceForm();
  switchTab('detail');
  renderDetail();
  highlightActiveLoc();
}

function latencyChip(ms){
  if(ms == null || isNaN(ms)) return '<span class="tcard-dev-lat">--</span>';
  const cls = ms < 30 ? 'good' : ms < 100 ? 'warn' : 'bad';
  return `<span class="tcard-dev-lat ${cls}">[ ${ms}ms ]</span>`;
}

function statusBadge(status){
  const s = status || 'Unknown';
  let dotClass = 's-unknown';
  let tagClass = 'idle';
  if (s === 'Online') { dotClass = 's-online'; tagClass = 'ok'; }
  else if (s === 'Offline') { dotClass = 's-offline'; tagClass = 'alert'; }
  else if (s === 'Maintenance') { dotClass = 's-maintenance'; tagClass = 'warn'; }

  return `<span class="tcard-dev-tag ${tagClass}"><span class="tcard-dev-dot ${dotClass}"></span>${s.toUpperCase()}</span>`;
}

/* Batch Ping All Devices in Current Location */
async function pingAllLocationDevices(btn) {
  if (!currentLocId || isBatchPinging) return;
  const devs = (state.devices[currentLocId] || []).filter(d => d.ip);
  if (devs.length === 0) {
    showToast('Tidak ada perangkat ber-IP di lokasi ini', 'warn');
    return;
  }
  isBatchPinging = true;
  btn.disabled = true;
  const origHtml = btn.innerHTML;
  btn.innerHTML = `<span class="bg-spinner" style="border-width:1.5px; width:11px; height:11px;"></span> <span>PING (0/${devs.length})...</span>`;

  let okCount = 0;
  let failCount = 0;
  for (let i = 0; i < devs.length; i++) {
    const d = devs[i];
    try {
      const res = await api.get(`/api/ping/now/${encodeURIComponent(d.ip)}`);
      const data = await res.json();
      if (data.online) {
        okCount++;
        d.status = 'Online';
        d.last_ping_ms = data.latency_ms;
      } else {
        failCount++;
        d.status = 'Offline';
        d.last_ping_ms = null;
      }
    } catch (err) {
      failCount++;
    }
    btn.innerHTML = `<span class="bg-spinner" style="border-width:1.5px; width:11px; height:11px;"></span> <span>PING (${i + 1}/${devs.length})...</span>`;
  }
  isBatchPinging = false;
  btn.disabled = false;
  btn.innerHTML = origHtml;
  showToast(`Ping selesai: ${okCount} Online, ${failCount} Offline`, okCount > 0 ? 'ok' : 'error');
  renderStats(); renderSidebar(); renderTopology(); renderDetail();
}

window.setDetailStatusFilter = function(status) {
  detailFilterStatus = status;
  renderDetail();
};

window.setDetailTypeFilter = function(type) {
  detailFilterType = type;
  renderDetail();
};

window.onDetailSearch = function(val) {
  detailSearchTerm = (val || '').trim().toLowerCase();
  renderDetail();
};

function renderDetail(){
  const panel = $('#detail-panel');
  if(!panel) return;

  const form = $('#device-modal');
  if (form && form.classList.contains('open')) {
    return;
  }

  if(!currentLocId){
    panel.innerHTML = `
      <div class="empty-state" style="padding: 64px 20px; text-align: center;">
        <div style="display:inline-flex; align-items:center; justify-content:center; width:48px; height:48px; border-radius:8px; background:var(--panel-2); border:1px solid var(--border); margin-bottom:14px; color:var(--accent);">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
        </div>
        <h3 style="font-family:var(--mono); color:var(--text); font-size:14px; font-weight:700; margin:0 0 6px;">SITE DIAGNOSTIC CONSOLE // STANDBY</h3>
        <p style="color:var(--text-muted); font-size:12px; margin:0 0 16px; max-width:380px;">Pilih gedung atau lokasi dari Dashboard Grid atau Peta Topologi untuk menginspeksi inventaris perangkat dan telemetri koneksi.</p>
        <div style="display:flex; gap:8px; justify-content:center;">
          <button class="tt-btn" onclick="switchTab('grid')">BUKA DASHBOARD GRID →</button>
          <button class="tt-btn" onclick="switchTab('topo')">BUKA PETA TOPOLOGI →</button>
        </div>
      </div>
    `;
    return;
  }

  const loc = state.locations.find(l => l.id === currentLocId);
  if (!loc) {
    panel.innerHTML = `<div class="empty-state"><p>Lokasi tidak ditemukan.</p></div>`;
    return;
  }

  const zoneObj = ZONES.find(z => z.key === loc.zone);
  const zoneLabel = zoneObj ? zoneObj.label : loc.zone;
  const allDevices = state.devices[currentLocId] || [];
  const isAdmin = currentUser && currentUser.role === 'admin';

  // Site Telemetry Metrics
  const totalDevs = allDevices.length;
  const onlineCount = allDevices.filter(d => d.status === 'Online').length;
  const offlineCount = allDevices.filter(d => d.status === 'Offline').length;
  const maintCount = allDevices.filter(d => d.status === 'Maintenance').length;
  const pingDevs = allDevices.filter(d => d.status === 'Online' && d.last_ping_ms != null && !isNaN(d.last_ping_ms));
  const avgPing = pingDevs.length > 0 ? Math.round(pingDevs.reduce((a, b) => a + Number(b.last_ping_ms), 0) / pingDevs.length) : null;
  const healthPct = totalDevs > 0 ? Math.round((onlineCount / totalDevs) * 100) : 100;

  let siteStatusClass = 's-ok';
  let siteBadgeHtml = '<span class="tcard-dev-tag ok">● 100% OPERATIONAL</span>';
  if (totalDevs > 0) {
    if (offlineCount > 0) {
      siteStatusClass = 's-alert';
      siteBadgeHtml = `<span class="tcard-dev-tag alert">! ${offlineCount} CRITICAL FAULT</span>`;
    } else if (maintCount > 0) {
      siteStatusClass = 's-warn';
      siteBadgeHtml = `<span class="tcard-dev-tag warn">▲ ${maintCount} MAINTENANCE</span>`;
    }
  } else {
    siteStatusClass = 's-idle';
    siteBadgeHtml = '<span class="tcard-dev-tag idle">STANDBY</span>';
  }

  // Filter devices
  let filteredDevices = allDevices;
  if (detailFilterStatus !== 'all') {
    filteredDevices = filteredDevices.filter(d => d.status === detailFilterStatus);
  }
  if (detailFilterType !== 'all') {
    filteredDevices = filteredDevices.filter(d => (d.tipe || '').toLowerCase() === detailFilterType.toLowerCase());
  }
  if (detailSearchTerm) {
    filteredDevices = filteredDevices.filter(d => 
      (d.nama || '').toLowerCase().includes(detailSearchTerm) ||
      (d.ip || '').toLowerCase().includes(detailSearchTerm) ||
      (d.mac || '').toLowerCase().includes(detailSearchTerm) ||
      (d.merk || '').toLowerCase().includes(detailSearchTerm) ||
      (d.catatan || '').toLowerCase().includes(detailSearchTerm)
    );
  }

  // Back label
  const backTarget = previousActiveTab === 'grid' ? 'grid' : 'topo';
  const backLabel = previousActiveTab === 'grid' ? '← KEMBALI KE DASHBOARD GRID' : '← KEMBALI KE PETA TOPOLOGI';

  // Desktop Table Rows
  const tableRowsHtml = filteredDevices.map(d => {
    const isOnline = d.status === 'Online';
    const isOffline = d.status === 'Offline';
    const isMaint = d.status === 'Maintenance';
    const dotClass = isOffline ? 's-offline' : (isMaint ? 's-maintenance' : (isOnline ? 's-online' : 's-unknown'));

    return `
      <tr class="${isOffline ? 'is-offline-row' : ''}">
        <td>
          <div class="dt-dev-name-wrap">
            <span class="tcard-dev-dot ${dotClass}"></span>
            <div class="dt-dev-info">
              <b class="dt-dev-name">${escapeHtml(d.nama)}</b>
              <span class="dt-dev-sub">${escapeHtml(d.merk || '—')}</span>
            </div>
          </div>
        </td>
        <td>
          <span class="tc-tier-tag dist">${escapeHtml(d.tipe || 'DEVICE')}</span>
        </td>
        <td class="ip-cell">
          <div class="dt-ip-wrap">
            ${d.ip ? `
              <span class="dt-ip-code" onclick="navigator.clipboard.writeText('${d.ip}'); showToast('IP disalin ke clipboard','ok')" title="Klik untuk salin IP">
                ${escapeHtml(d.ip)}
              </span>
              <button class="icon-btn" title="Ping sekarang" onclick="pingNow('${d.id}','${d.ip}',this)">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
              </button>
            ` : '<span style="color:var(--text-muted)">—</span>'}
          </div>
          ${d.mac ? `<span class="dt-mac-code">${escapeHtml(d.mac)}</span>` : ''}
        </td>
        <td>
          <div class="dt-status-wrap">
            ${statusBadge(d.status)}
            ${latencyChip(d.last_ping_ms)}
          </div>
        </td>
        <td>
          <span class="dt-notes" title="${escapeHtml(d.catatan || '')}">${escapeHtml(d.catatan || '—')}</span>
        </td>
        <td>
          <div class="row-actions">
            ${isAdmin && d.mac ? `
              <button class="icon-btn" title="Wake on LAN (WoL)" onclick="wakeDevice('${d.id}')">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
              </button>` : ''}
            ${isAdmin ? `
              <button class="icon-btn" title="Pindah ke Lokasi Lain" onclick="openMoveModalForDevice('${d.id}')">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
              </button>` : ''}
            ${isAdmin ? `
              <button class="icon-btn" title="Ubah Perangkat" onclick="editDevice('${d.id}')">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              </button>` : ''}
            <button class="icon-btn" title="Riwayat Latensi" onclick="openHistoryModal('${d.id}')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 3v18h18"></path><path d="M18 9l-5 5-4-4-3 3"></path></svg>
            </button>
            ${isAdmin && d.ip ? `
              <button class="icon-btn" title="Reboot SSH" onclick="openRebootModal('${d.id}')">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
              </button>` : ''}
            ${isAdmin ? `
              <button class="icon-btn danger" title="Hapus Perangkat" onclick="deleteDevice('${d.id}')">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Mobile Device Cards
  const mobileCardsHtml = filteredDevices.map(d => {
    const isOnline = d.status === 'Online';
    const isOffline = d.status === 'Offline';
    const isMaint = d.status === 'Maintenance';
    const cardStatusClass = isOffline ? 's-offline' : (isMaint ? 's-maintenance' : (isOnline ? 's-online' : 's-unknown'));

    return `
      <div class="dev-card ${cardStatusClass}">
        <div class="dev-card-head">
          <div>
            <div class="dev-card-meta">
              <span class="tc-tier-tag dist">${escapeHtml(d.tipe || 'DEV')}</span>
              <span>${escapeHtml(d.merk || '')}</span>
            </div>
            <h4 class="dev-card-name">${escapeHtml(d.nama)}</h4>
          </div>
          <div style="display:flex; flex-direction:column; align-items:flex-end; gap:3px;">
            ${statusBadge(d.status)}
            ${latencyChip(d.last_ping_ms)}
          </div>
        </div>

        <div class="dev-card-network">
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="color:var(--text-muted); font-size:10px;">IP:</span>
            <span class="dt-ip-code" onclick="navigator.clipboard.writeText('${d.ip||''}'); showToast('IP disalin','ok')">${escapeHtml(d.ip || 'NO-IP')}</span>
          </div>
          ${d.mac ? `<span class="dt-mac-code">${escapeHtml(d.mac)}</span>` : ''}
        </div>

        ${d.catatan ? `<div style="font-size:11px; color:var(--text-muted); font-family:var(--sans); font-style:italic;">"${escapeHtml(d.catatan)}"</div>` : ''}

        <div class="dev-card-actions">
          ${d.ip ? `
            <button class="icon-btn" title="Ping Sekarang" onclick="pingNow('${d.id}','${d.ip}',this)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
            </button>` : ''}
          ${isAdmin && d.mac ? `
            <button class="icon-btn" title="Wake on LAN" onclick="wakeDevice('${d.id}')">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
            </button>` : ''}
          ${isAdmin && d.ip ? `
            <button class="icon-btn" title="Reboot SSH" onclick="openRebootModal('${d.id}')">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
            </button>` : ''}
          <button class="icon-btn" title="Riwayat Latensi" onclick="openHistoryModal('${d.id}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 3v18h18"></path><path d="M18 9l-5 5-4-4-3 3"></path></svg>
          </button>
          ${isAdmin ? `
            <button class="icon-btn" title="Pindah ke Lokasi Lain" onclick="openMoveModalForDevice('${d.id}')">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
            </button>` : ''}
          ${isAdmin ? `
            <button class="icon-btn" title="Ubah Data" onclick="editDevice('${d.id}')">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            </button>` : ''}
          ${isAdmin ? `
            <button class="icon-btn danger" title="Hapus" onclick="deleteDevice('${d.id}')">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  // Device types for dropdown
  const uniqueTypes = Array.from(new Set(allDevices.map(d => d.tipe).filter(Boolean)));

  panel.innerHTML = `
    <!-- Top Navigation Bar -->
    <div class="detail-nav-bar">
      <button class="detail-back-btn" onclick="switchTab('${backTarget}')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        <span>${backLabel}</span>
      </button>
    </div>

    <!-- Site Mission Header -->
    <div class="detail-head ${siteStatusClass}">
      <div class="dh-lead">
        <div class="dh-meta">
          <span>SITE // ${escapeHtml(zoneLabel).toUpperCase()}</span>
          <span class="bcard-id-tag">LOC // ${loc.id.toUpperCase()}</span>
        </div>
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <h2 class="dh-title">${escapeHtml(loc.nama)}</h2>
          ${siteBadgeHtml}
        </div>
      </div>

      <div class="dh-actions">
        <button class="dh-btn" onclick="pingAllLocationDevices(this)" title="Lakukan uji koneksi ping ke seluruh node perangkat di lokasi ini">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
          <span>PING SEMUA</span>
        </button>
        ${isAdmin ? `
          <button class="dh-btn" onclick="scanNetwork()" title="Pindai range IP subnet">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <span>PINDAI JARINGAN</span>
          </button>
          <button class="dh-btn primary" onclick="openDeviceForm()" title="Tambah perangkat baru ke lokasi ini">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            <span>TAMBAH PERANGKAT</span>
          </button>
        ` : ''}
      </div>
    </div>

    <!-- Site Telemetry Metrics Strip -->
    <div class="detail-metrics-strip">
      <div class="tcm-item"><span class="tcm-k">NODES</span><b class="tcm-v">${totalDevs}</b></div>
      <div class="tcm-sep">│</div>
      <div class="tcm-item"><span class="tcm-k">ONLINE</span><b class="tcm-v ok">${onlineCount}</b></div>
      <div class="tcm-sep">│</div>
      <div class="tcm-item"><span class="tcm-k">FAULT</span><b class="tcm-v ${offlineCount > 0 ? 'alert' : ''}">${offlineCount}</b></div>
      <div class="tcm-sep">│</div>
      <div class="tcm-item"><span class="tcm-k">MAINT</span><b class="tcm-v ${maintCount > 0 ? 'warn' : ''}">${maintCount}</b></div>
      <div class="tcm-sep">│</div>
      <div class="tcm-item"><span class="tcm-k">AVG LAT</span><b class="tcm-v">${avgPing != null ? avgPing + 'ms' : '--'}</b></div>
      <div class="tcm-sep">│</div>
      <div class="tcm-item"><span class="tcm-k">HEALTH</span><b class="tcm-v ${healthPct === 100 ? 'ok' : 'alert'}">${healthPct}%</b></div>
    </div>

    <!-- Device Control & Filter Bar -->
    <div class="detail-filter-bar">
      <div class="df-status-group">
        <button class="df-pill ${detailFilterStatus === 'all' ? 'active' : ''}" onclick="setDetailStatusFilter('all')">SEMUA (${totalDevs})</button>
        <button class="df-pill ${detailFilterStatus === 'Online' ? 'active' : ''}" onclick="setDetailStatusFilter('Online')">ONLINE (${onlineCount})</button>
        <button class="df-pill ${detailFilterStatus === 'Offline' ? 'active' : ''}" onclick="setDetailStatusFilter('Offline')">OFFLINE (${offlineCount})</button>
        ${maintCount > 0 ? `<button class="df-pill ${detailFilterStatus === 'Maintenance' ? 'active' : ''}" onclick="setDetailStatusFilter('Maintenance')">MAINT (${maintCount})</button>` : ''}
      </div>

      <div class="df-right">
        ${uniqueTypes.length > 0 ? `
          <select class="df-select" onchange="setDetailTypeFilter(this.value)">
            <option value="all">Semua Tipe (${uniqueTypes.length})</option>
            ${uniqueTypes.map(t => `<option value="${escapeHtml(t)}" ${detailFilterType.toLowerCase() === t.toLowerCase() ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
          </select>
        ` : ''}

        <div class="tt-search-wrap">
          <svg class="tt-search-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input type="text" class="df-search" placeholder="Cari nama, IP, MAC..." value="${escapeHtml(detailSearchTerm)}" oninput="onDetailSearch(this.value)">
          ${detailSearchTerm ? `<button class="tt-clear-search" onclick="onDetailSearch('')">×</button>` : ''}
        </div>
      </div>
    </div>

    <!-- Device Content (Desktop Table + Mobile Cards) -->
    ${filteredDevices.length === 0 ? `
      <div class="empty-state" style="padding:40px 20px; text-align:center; background:var(--panel); border:1px solid var(--border); border-radius:6px;">
        <p style="color:var(--text); font-weight:600; margin:0 0 4px; font-family:var(--mono);">// TIDAK ADA PERANGKAT YANG COCOK</p>
        <p style="color:var(--text-muted); font-size:12px; margin:0;">Sesuaikan filter status atau kata kunci pencarian.</p>
      </div>
    ` : `
      <!-- Desktop Table -->
      <div class="device-table-wrap">
        <table class="device-table">
          <thead>
            <tr>
              <th>PERANGKAT / MODEL</th>
              <th>TIPE</th>
              <th>ALAMAT IP & MAC</th>
              <th>STATUS / PING</th>
              <th>CATATAN</th>
              <th style="text-align:right">AKSI KONTROL</th>
            </tr>
          </thead>
          <tbody>${tableRowsHtml}</tbody>
        </table>
      </div>

      <!-- Mobile Cards -->
      <div class="dev-cards-mobile">
        ${mobileCardsHtml}
      </div>
    `}
  `;
}

/* ── 13B. LOCATION OPTIONS HELPER ─────────────────────────────────── */
function getLocationOptionsHtml(selectedLocId, excludeLocId = null) {
  const locList = (allLocations && allLocations.length > 0) ? allLocations : (state.locations || []);
  const zones = (ZONES && ZONES.length > 0) ? ZONES : [];

  let html = '';
  const zoneGroups = {};
  locList.forEach(l => {
    if (excludeLocId && String(l.id) === String(excludeLocId)) return;
    const zk = l.zone || 'OTHER';
    if (!zoneGroups[zk]) zoneGroups[zk] = [];
    zoneGroups[zk].push(l);
  });

  zones.forEach(z => {
    const items = zoneGroups[z.key];
    if (items && items.length > 0) {
      html += `<optgroup label="[${z.key}] ${escapeHtml(z.label)}">`;
      items.forEach(l => {
        const isSel = String(l.id) === String(selectedLocId) ? 'selected' : '';
        const devCnt = l.device_count !== undefined ? l.device_count : deviceCount(l.id);
        html += `<option value="${l.id}" ${isSel}>${escapeHtml(l.nama)} (${devCnt} unit)</option>`;
      });
      html += `</optgroup>`;
      delete zoneGroups[z.key];
    }
  });

  for (const [zk, items] of Object.entries(zoneGroups)) {
    if (items && items.length > 0) {
      html += `<optgroup label="[${zk}] Area Lainnya">`;
      items.forEach(l => {
        const isSel = String(l.id) === String(selectedLocId) ? 'selected' : '';
        const devCnt = l.device_count !== undefined ? l.device_count : deviceCount(l.id);
        html += `<option value="${l.id}" ${isSel}>${escapeHtml(l.nama)} (${devCnt} unit)</option>`;
      });
      html += `</optgroup>`;
    }
  }

  return html;
}

/* ── 14. DEVICE FORM ───────────────────────────────────────────────── */
function openDeviceForm(deviceId){
  editingDeviceId = deviceId||null;
  const modal = $('#device-modal');
  const body = $('#device-modal-body');
  const title = $('#device-modal-title');
  if(!modal || !body || !title) return;

  let d = null;
  let devLocId = currentLocId;
  if (deviceId) {
    for (const [lid, list] of Object.entries(state.devices || {})) {
      const found = (list || []).find(x => x.id === deviceId);
      if (found) {
        d = found;
        devLocId = d.loc_id || lid;
        break;
      }
    }
  }

  const osOptions = state.deviceOs.map(o=>`<option value="${o.id}"${d&&d.device_os===o.id?' selected':''}>${o.name}</option>`).join('');
  const isAdmin = currentUser && currentUser.role==='admin';

  title.textContent = deviceId ? '✍ Ubah Perangkat' : '+ Tambah Perangkat';

  body.innerHTML=`
    <div class="form-grid">
      <div class="field"><label>Nama Perangkat</label><input id="f-nama" placeholder="cth. Switch Lantai 1" value="${escapeHtml(d?d.nama:'')}"></div>
      <div class="field">
        <label>Lokasi / Ruangan</label>
        <select id="f-loc-id" class="zh-select" style="width:100%;height:38px">${getLocationOptionsHtml(devLocId)}</select>
      </div>
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
  const targetLocId = ($('#f-loc-id') && $('#f-loc-id').value) || currentLocId;

  const payload = {
    nama,
    loc_id    : targetLocId,
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
    let oldLocId = targetLocId;
    if (editingDeviceId) {
      for (const [lid, list] of Object.entries(state.devices || {})) {
        if ((list || []).some(d => d.id === editingDeviceId)) {
          oldLocId = lid;
          break;
        }
      }
    }

    const device = await apiSaveDevice(targetLocId, payload);

    if (editingDeviceId && oldLocId !== targetLocId) {
      if (state.devices[oldLocId]) {
        state.devices[oldLocId] = state.devices[oldLocId].filter(d => d.id !== editingDeviceId);
      }
      if (!state.devices[targetLocId]) state.devices[targetLocId] = [];
      state.devices[targetLocId].push(device);
    } else {
      if (!state.devices[targetLocId]) state.devices[targetLocId] = [];
      if (editingDeviceId) {
        const idx = state.devices[targetLocId].findIndex(d => d.id === editingDeviceId);
        if (idx > -1) state.devices[targetLocId][idx] = device;
        else state.devices[targetLocId].push(device);
      } else {
        state.devices[targetLocId].push(device);
      }
    }

    const wasMoved = editingDeviceId && (oldLocId !== targetLocId);
    editingDeviceId = null;
    closeDeviceForm();
    await loadDevices();
    await loadSubCategories();
    updateZonesModalStats();
    refreshActiveView();
    renderSidebar(); renderStats(); renderTopology();
    showToast(wasMoved ? `Perangkat dipindahkan ke lokasi baru` : 'Data perangkat tersimpan', 'ok');
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

/* ── 20. SLA REPORT VIEW (Hallmark Reliability Intelligence Workbench) ── */
let currentSlaReport = [];
let slaDays = 7;
let slaComplianceFilter = 'all'; // 'all', 'met', 'warn', 'breach'
let slaLocFilter = 'all';
let slaSearchTerm = '';

window.setSlaPeriod = function(days) {
  slaDays = Number(days);
  currentSlaReport = [];
  renderReportView();
};

window.setSlaComplianceFilter = function(filter) {
  slaComplianceFilter = filter;
  renderReportView();
};

window.setSlaLocFilter = function(locId) {
  slaLocFilter = locId;
  renderReportView();
};

window.onSlaSearch = function(val) {
  slaSearchTerm = (val || '').trim().toLowerCase();
  renderReportView();
};

function renderLoadingState(msg = 'Memuat data...') {
  return `
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <div class="loading-text">${escapeHtml(msg)}</div>
      <div class="loading-subtext">Mohon tunggu sebentar</div>
    </div>
  `;
}

function showBgLoadingIndicator(panel) {
  let badge = panel.querySelector('.bg-loading-badge');
  if (!badge) {
    const titleArea = panel.querySelector('.sla-title-area') || panel.querySelector('.sla-mission-head') || panel.firstElementChild;
    if (titleArea) {
      badge = document.createElement('span');
      badge.className = 'bg-loading-badge';
      badge.innerHTML = `<span class="bg-spinner"></span> Memperbarui...`;
      titleArea.appendChild(badge);
    }
  }
  if (badge) badge.style.opacity = '1';
}

function hideBgLoadingIndicator(panel) {
  const badge = panel.querySelector('.bg-loading-badge');
  if (badge) badge.style.opacity = '0';
}

async function renderReportView() {
  const panel = $('#report-panel');
  if (!panel) return;

  if (!currentSlaReport || currentSlaReport.length === 0) {
    panel.innerHTML = renderLoadingState(`Menghitung Ketersediaan SLA (${slaDays} Hari Terakhir)...`);
  } else {
    showBgLoadingIndicator(panel);
  }

  try {
    const res = await api.get(`/api/ping/sla-report?days=${slaDays}`);
    const data = await res.json();
    currentSlaReport = data.report || [];

    const totalDevices = currentSlaReport.length;
    const avgFactoryUptimeNum = totalDevices ? (currentSlaReport.reduce((a, b) => a + Number(b.uptime_percent || 0), 0) / totalDevices) : 0;
    const avgFactoryUptime = avgFactoryUptimeNum.toFixed(2);

    // KPI breakdown
    const metCount = currentSlaReport.filter(r => r.uptime_percent >= 99).length;
    const warnCount = currentSlaReport.filter(r => r.uptime_percent >= 95 && r.uptime_percent < 99).length;
    const breachCount = currentSlaReport.filter(r => r.uptime_percent < 95).length;
    const totalDowntimeMin = currentSlaReport.reduce((a, b) => a + (Number(b.downtime_minutes) || 0), 0);
    const avgLatNum = totalDevices ? (currentSlaReport.reduce((a, b) => a + (Number(b.avg_latency) || 0), 0) / totalDevices) : 0;
    const avgLat = avgLatNum.toFixed(1);

    // Unique Locations
    const uniqueLocIds = Array.from(new Set(currentSlaReport.map(r => r.location).filter(Boolean)));
    const uniqueLocs = uniqueLocIds.map(id => {
      const l = state.locations.find(loc => loc.id === id);
      return { id, nama: l ? l.nama : id };
    });

    // Filter data
    let filtered = currentSlaReport;
    if (slaComplianceFilter === 'met') {
      filtered = filtered.filter(r => r.uptime_percent >= 99);
    } else if (slaComplianceFilter === 'warn') {
      filtered = filtered.filter(r => r.uptime_percent >= 95 && r.uptime_percent < 99);
    } else if (slaComplianceFilter === 'breach') {
      filtered = filtered.filter(r => r.uptime_percent < 95);
    }

    if (slaLocFilter !== 'all') {
      filtered = filtered.filter(r => r.location === slaLocFilter);
    }

    if (slaSearchTerm) {
      filtered = filtered.filter(r => {
        const loc = state.locations.find(l => l.id === r.location);
        const locName = loc ? loc.nama : r.location;
        return (r.device_name || '').toLowerCase().includes(slaSearchTerm) ||
               (locName || '').toLowerCase().includes(slaSearchTerm) ||
               (r.ip_address || '').toLowerCase().includes(slaSearchTerm);
      });
    }

    // Overall Factory Health Pill
    const isOverallMet = avgFactoryUptimeNum >= 99;
    const overallBadgeClass = isOverallMet ? 'ok' : (avgFactoryUptimeNum >= 95 ? 'warn' : 'alert');
    const overallBadgeText = isOverallMet ? '● SLA FACTORY TERPENUHI (≥99%)' : '▲ SLA BERISIKO (<99%)';

    // Desktop Table Rows
    const tableRowsHtml = filtered.map(r => {
      const loc = state.locations.find(l => l.id === r.location);
      const locName = loc ? loc.nama : r.location;
      const uptime = Number(r.uptime_percent || 0);

      let tierClass = 'ok';
      let tierLabel = 'TERPENUHI';
      if (uptime < 95) {
        tierClass = 'alert';
        tierLabel = 'BREACH';
      } else if (uptime < 99) {
        tierClass = 'warn';
        tierLabel = 'WARNING';
      }

      const color = tierClass === 'ok' ? 'var(--ok)' : (tierClass === 'warn' ? 'var(--warn)' : 'var(--alert)');
      const latClass = r.avg_latency < 30 ? 'good' : (r.avg_latency < 100 ? 'warn' : 'bad');

      return `
        <tr class="${tierClass === 'alert' ? 'is-offline-row' : ''}">
          <td>
            <div class="dt-dev-name-wrap">
              <span class="tcard-dev-dot ${tierClass === 'ok' ? 's-online' : (tierClass === 'warn' ? 's-maintenance' : 's-offline')}"></span>
              <div class="dt-dev-info">
                <b class="dt-dev-name">${escapeHtml(r.device_name)}</b>
              </div>
            </div>
          </td>
          <td>
            <button class="off-loc-btn" onclick="openDetail('${r.location}')" title="Buka Detail Gedung ${escapeHtml(locName)}">
              <span>${escapeHtml(locName)}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </button>
          </td>
          <td class="ip-cell">
            <span class="dt-ip-code" onclick="navigator.clipboard.writeText('${r.ip_address}'); showToast('IP disalin ke clipboard','ok')" title="Klik untuk salin IP">
              ${escapeHtml(r.ip_address)}
            </span>
          </td>
          <td>
            <div class="sla-uptime-cell">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:3px;">
                <b style="color:${color}; font-family:var(--mono); font-size:12px; font-variant-numeric:tabular-nums;">${uptime}%</b>
                <span class="tcard-dev-tag ${tierClass}">${tierLabel}</span>
              </div>
              <div class="tcard-gauge-wrap" style="height:3px;">
                <div class="tcard-gauge-bar is-${tierClass}" style="width:${Math.min(uptime, 100)}%;"></div>
              </div>
            </div>
          </td>
          <td>
            <span style="font-family:var(--mono); font-size:11.5px; color:${r.downtime_minutes > 0 ? 'var(--alert)' : 'var(--text-muted)'}; font-variant-numeric:tabular-nums;">
              ${r.downtime_minutes} mnt
            </span>
          </td>
          <td>
            <span class="tcard-dev-lat ${latClass}">
              [ ${r.avg_latency || 0}ms ]
            </span>
          </td>
          <td style="text-align:right">
            <button class="icon-btn" title="Riwayat Latensi & Uptime Chart" onclick="openHistoryModal('${r.device_id}')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 3v18h18"></path><path d="M18 9l-5 5-4-4-3 3"></path></svg>
            </button>
          </td>
        </tr>
      `;
    }).join('');

    // Mobile SLA Cards
    const mobileCardsHtml = filtered.map(r => {
      const loc = state.locations.find(l => l.id === r.location);
      const locName = loc ? loc.nama : r.location;
      const uptime = Number(r.uptime_percent || 0);

      let tierClass = 'ok';
      let tierLabel = 'TERPENUHI';
      if (uptime < 95) {
        tierClass = 'alert';
        tierLabel = 'BREACH';
      } else if (uptime < 99) {
        tierClass = 'warn';
        tierLabel = 'WARNING';
      }

      const color = tierClass === 'ok' ? 'var(--ok)' : (tierClass === 'warn' ? 'var(--warn)' : 'var(--alert)');
      const latClass = r.avg_latency < 30 ? 'good' : (r.avg_latency < 100 ? 'warn' : 'bad');

      return `
        <div class="sla-card ${tierClass}">
          <div class="sla-card-head">
            <div>
              <h4 class="sla-card-name">${escapeHtml(r.device_name)}</h4>
              <div class="sla-card-loc">
                <button class="off-loc-btn" onclick="openDetail('${r.location}')">
                  <span>SITE: <b>${escapeHtml(locName)}</b></span>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                </button>
              </div>
            </div>
            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:3px;">
              <span class="sla-card-pct" style="color:${color}">${uptime}%</span>
              <span class="tcard-dev-tag ${tierClass}">${tierLabel}</span>
            </div>
          </div>

          <div class="tcard-gauge-wrap" style="height:4px; margin:6px 0;">
            <div class="tcard-gauge-bar is-${tierClass}" style="width:${Math.min(uptime, 100)}%;"></div>
          </div>

          <div class="sla-card-meta-row">
            <div class="sc-meta-item">
              <span class="sc-k">IP ADDR</span>
              <span class="dt-ip-code" onclick="navigator.clipboard.writeText('${r.ip_address}'); showToast('IP disalin','ok')">${escapeHtml(r.ip_address)}</span>
            </div>
            <div class="sc-meta-item">
              <span class="sc-k">EST DOWNTIME</span>
              <span class="sc-v ${r.downtime_minutes > 0 ? 'alert' : ''}">${r.downtime_minutes} mnt</span>
            </div>
            <div class="sc-meta-item">
              <span class="sc-k">AVG LAT</span>
              <span class="tcard-dev-lat ${latClass}">${r.avg_latency || 0}ms</span>
            </div>
          </div>

          <div class="sla-card-foot">
            <button class="sla-card-action-btn" onclick="openHistoryModal('${r.device_id}')">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 3v18h18"></path><path d="M18 9l-5 5-4-4-3 3"></path></svg>
              <span>BUKA GRAFIK ANALISIS LATENSI →</span>
            </button>
          </div>
        </div>
      `;
    }).join('');

    panel.innerHTML = `
      <!-- SLA Mission Header -->
      <div class="sla-mission-head">
        <div class="smh-lead">
          <div class="smh-meta">
            <span>AUDIT // NETWORK RELIABILITY & SLA COMPLIANCE BENCHMARK</span>
            <span class="bcard-id-tag">PERIOD // ${slaDays} DAYS</span>
          </div>
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <h2 class="smh-title">LAPORAN KEANDALAN UPTIME (SLA)</h2>
            <span class="tcard-dev-tag ${overallBadgeClass}" style="font-size:10px; padding:3px 8px;">
              ${overallBadgeText}
            </span>
          </div>
        </div>

        <div class="smh-actions">
          <button class="smh-btn" onclick="exportSlaExcel()" title="Unduh laporan lengkap dalam format Microsoft Excel (.xlsx)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            <span>DOWNLOAD EXCEL</span>
          </button>
          <button class="smh-btn primary" onclick="window.print()" title="Cetak laporan atau simpan sebagai dokumen PDF">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
            <span>CETAK / PDF</span>
          </button>
        </div>
      </div>

      <!-- SLA Period Selector Toolbar -->
      <div class="sla-period-bar">
        <div class="spb-left">
          <span class="spb-lbl">RENTANG WAKTU AUDIT:</span>
          <div class="spb-pills">
            <button class="spb-pill ${slaDays === 1 ? 'active' : ''}" onclick="setSlaPeriod(1)">24 JAM</button>
            <button class="spb-pill ${slaDays === 7 ? 'active' : ''}" onclick="setSlaPeriod(7)">7 HARI</button>
            <button class="spb-pill ${slaDays === 14 ? 'active' : ''}" onclick="setSlaPeriod(14)">14 HARI</button>
            <button class="spb-pill ${slaDays === 30 ? 'active' : ''}" onclick="setSlaPeriod(30)">30 HARI</button>
          </div>
        </div>
        <div class="spb-right">
          <span class="spb-subtext">// Threshold SLA: Normal ≥ 99.0% · Warning 95.0–98.9% · Breach &lt; 95.0%</span>
        </div>
      </div>

      <!-- SLA Telemetry Metrics Strip -->
      <div class="sla-metrics-strip">
        <div class="tcm-item"><span class="tcm-k">AVG UPTIME</span><b class="tcm-v ${isOverallMet ? 'ok' : 'alert'}">${avgFactoryUptime}%</b></div>
        <div class="tcm-sep">│</div>
        <div class="tcm-item"><span class="tcm-k">COMPLIANT (≥99%)</span><b class="tcm-v ok">${metCount}</b></div>
        <div class="tcm-sep">│</div>
        <div class="tcm-item"><span class="tcm-k">WARNING</span><b class="tcm-v ${warnCount > 0 ? 'warn' : ''}">${warnCount}</b></div>
        <div class="tcm-sep">│</div>
        <div class="tcm-item"><span class="tcm-k">BREACH (&lt;95%)</span><b class="tcm-v ${breachCount > 0 ? 'alert' : ''}">${breachCount}</b></div>
        <div class="tcm-sep">│</div>
        <div class="tcm-item"><span class="tcm-k">TOTAL DOWNTIME</span><b class="tcm-v ${totalDowntimeMin > 0 ? 'alert' : ''}">${totalDowntimeMin} mnt</b></div>
        <div class="tcm-sep">│</div>
        <div class="tcm-item"><span class="tcm-k">AVG LATENCY</span><b class="tcm-v">${avgLat}ms</b></div>
      </div>

      <!-- SLA Triage & Filter Bar -->
      <div class="sla-filter-bar">
        <div class="sfb-status-group">
          <button class="sfb-pill ${slaComplianceFilter === 'all' ? 'active' : ''}" onclick="setSlaComplianceFilter('all')">SEMUA (${totalDevices})</button>
          <button class="sfb-pill ${slaComplianceFilter === 'met' ? 'active' : ''}" onclick="setSlaComplianceFilter('met')">TERPENUHI (${metCount})</button>
          ${warnCount > 0 ? `<button class="sfb-pill ${slaComplianceFilter === 'warn' ? 'active' : ''}" onclick="setSlaComplianceFilter('warn')">WARNING (${warnCount})</button>` : ''}
          ${breachCount > 0 ? `<button class="sfb-pill ${slaComplianceFilter === 'breach' ? 'active' : ''}" onclick="setSlaComplianceFilter('breach')">BREACH (${breachCount})</button>` : ''}
        </div>

        <div class="sfb-right">
          ${uniqueLocs.length > 0 ? `
            <select class="sfb-select" onchange="setSlaLocFilter(this.value)">
              <option value="all">Semua Lokasi (${uniqueLocs.length})</option>
              ${uniqueLocs.map(l => `<option value="${escapeHtml(l.id)}" ${slaLocFilter === l.id ? 'selected' : ''}>${escapeHtml(l.nama)}</option>`).join('')}
            </select>
          ` : ''}

          <div class="tt-search-wrap">
            <svg class="tt-search-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input type="text" class="sfb-search" placeholder="Cari nama, lokasi, IP..." value="${escapeHtml(slaSearchTerm)}" oninput="onSlaSearch(this.value)">
            ${slaSearchTerm ? `<button class="tt-clear-search" onclick="onSlaSearch('')">×</button>` : ''}
          </div>
        </div>
      </div>

      <!-- Content (Desktop Table + Mobile Cards) -->
      ${filtered.length === 0 ? `
        <div class="empty-state" style="padding:40px 20px; text-align:center; background:var(--panel); border:1px solid var(--border); border-radius:6px;">
          <p style="color:var(--text); font-weight:600; margin:0 0 4px; font-family:var(--mono);">// TIDAK ADA PERANGKAT YANG COCOK DENGAN FILTER SLA</p>
          <p style="color:var(--text-muted); font-size:12px; margin:0;">Sesuaikan filter kepatuhan SLA atau kata kunci pencarian.</p>
        </div>
      ` : `
        <!-- Desktop SLA Table -->
        <div class="device-table-wrap">
          <table class="device-table">
            <thead>
              <tr>
                <th>PERANGKAT</th>
                <th>LOKASI / GEDUNG</th>
                <th>ALAMAT IP</th>
                <th style="min-width:180px;">KEPATUHAN UPTIME & GAUGE</th>
                <th>EST. DOWNTIME</th>
                <th>RATA-RATA LATENSI</th>
                <th style="text-align:right">DIAGNOSTIK</th>
              </tr>
            </thead>
            <tbody>${tableRowsHtml}</tbody>
          </table>
        </div>

        <!-- Mobile SLA Cards -->
        <div class="sla-cards-mobile">
          ${mobileCardsHtml}
        </div>
      `}
    `;
  } catch (err) {
    panel.innerHTML = `<p style="color:var(--alert); padding:20px; font-family:var(--mono);">Gagal memuat laporan SLA: ${err.message}</p>`;
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
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const colsWidth = [
      { wch: 30 }, // Nama Perangkat
      { wch: 25 }, // Lokasi
      { wch: 18 }, // IP Address
      { wch: 14 }, // Uptime
      { wch: 25 }, // Est Downtime
      { wch: 22 }  // Latency
    ];
    worksheet['!cols'] = colsWidth;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, `SLA_${slaDays}Hari`);

    const filename = `Laporan_Uptime_SLA_${slaDays}Hari_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(workbook, filename);
    showToast(`Laporan Excel (${slaDays} Hari) berhasil diunduh`, 'ok');
  } catch (err) {
    showToast('Gagal mengekspor ke Excel: ' + err.message, 'error');
  }
}

/* ── 21. AUDIT TRAIL VIEW (HALLMARK COMPLIANCE LEDGER WORKBENCH) ── */
let currentAuditLogs = [];
let currentAuditStats = { total: 0, today: 0, critical: 0, users: [] };
let auditFilterState = {
  category: 'ALL',
  user: 'ALL',
  search: '',
  limit: 100
};
let auditDebounceTimer = null;

function getAuditBadgeHtml(action) {
  const act = String(action || '').trim();
  let cls = 'is-sys';
  if (/add|tambah/i.test(act)) {
    cls = 'is-add';
  } else if (/pindah|move/i.test(act)) {
    cls = 'is-move';
  } else if (/delete|hapus|reboot|putus/i.test(act)) {
    cls = 'is-crit';
  } else if (/ssh|wol|wake/i.test(act)) {
    cls = 'is-sys';
  }
  return `<span class="aud-badge ${cls}"><span class="aud-badge-dot"></span>${escapeHtml(act)}</span>`;
}

function formatAuditTime(dateStr) {
  if (!dateStr) return { abs: '—', rel: '' };
  const d = new Date(dateStr);
  const abs = d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  const now = new Date();
  const diffSec = Math.floor((now - d) / 1000);
  let rel = '';
  if (diffSec < 60) {
    rel = 'baru saja';
  } else if (diffSec < 3600) {
    const mins = Math.floor(diffSec / 60);
    rel = `${mins}m lalu`;
  } else if (diffSec < 86400) {
    const hrs = Math.floor(diffSec / 3600);
    rel = `${hrs}j lalu`;
  } else {
    const days = Math.floor(diffSec / 86400);
    rel = `${days}h lalu`;
  }

  return { abs, rel };
}

async function fetchAuditData() {
  const params = new URLSearchParams({
    limit: auditFilterState.limit,
    offset: 0
  });
  if (auditFilterState.search) params.append('search', auditFilterState.search);
  if (auditFilterState.user && auditFilterState.user !== 'ALL') params.append('username', auditFilterState.user);
  if (auditFilterState.category && auditFilterState.category !== 'ALL') params.append('action_category', auditFilterState.category);

  const res = await api.get(`/api/audit?${params.toString()}`);
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  currentAuditLogs = data.logs || [];
  currentAuditStats = data.stats || { total: currentAuditLogs.length, today: 0, critical: 0, users: [] };
}

async function renderAuditView() {
  const panel = $('#audit-panel');
  if (!panel) return;

  if (!currentAuditLogs || currentAuditLogs.length === 0) {
    panel.innerHTML = renderLoadingState('Memuat Log Audit Sistem...');
  } else {
    showBgLoadingIndicator(panel);
  }

  try {
    await fetchAuditData();
    renderAuditDOM();
  } catch (err) {
    panel.innerHTML = `
      <div class="aud-workbench">
        <div class="aud-mission-head">
          <div>
            <div class="aud-callsign"><span class="aud-live-dot" style="background:#ef4444;box-shadow:0 0 8px #ef4444;"></span>AUDIT LEDGER ERROR</div>
            <h2 class="aud-title">Gagal Memuat Log Audit</h2>
            <p class="aud-desc" style="color:var(--alert)">${escapeHtml(err.message)}</p>
          </div>
          <div class="aud-actions">
            <button class="aud-btn aud-btn-refresh" onclick="refreshAuditView()">Coba Lagi</button>
          </div>
        </div>
      </div>
    `;
  }
}

function renderAuditDOM() {
  const panel = $('#audit-panel');
  if (!panel) return;

  const totalCount = currentAuditStats.total ?? currentAuditLogs.length;
  const todayCount = currentAuditStats.today ?? 0;
  const critCount = currentAuditStats.critical ?? 0;
  const userList = currentAuditStats.users || [];
  const activeOpsCount = userList.length || 1;

  // Pills categories
  const categories = [
    { id: 'ALL', label: 'Semua' },
    { id: 'DEVICE', label: 'Perangkat' },
    { id: 'MOVE', label: 'Pemindahan' },
    { id: 'SSH', label: 'Kontrol & SSH' },
    { id: 'SYSTEM', label: 'Sistem' },
    { id: 'CRITICAL', label: 'Kritikal', isCrit: true }
  ];

  const pillsHtml = categories.map(c => {
    const isActive = auditFilterState.category === c.id;
    const critClass = c.isCrit ? 'is-crit' : '';
    const activeClass = isActive ? `active ${critClass}` : '';
    return `<button class="aud-pill ${activeClass}" onclick="setAuditCategory('${c.id}')">${c.label}</button>`;
  }).join('');

  // Operator select options
  const userOptionsHtml = ['<option value="ALL">Semua Operator</option>'].concat(
    userList.map(u => `<option value="${escapeHtml(u)}" ${auditFilterState.user === u ? 'selected' : ''}>${escapeHtml(u)}</option>`)
  ).join('');

  // Limit select options
  const limits = [50, 100, 250, 500];
  const limitOptionsHtml = limits.map(l => 
    `<option value="${l}" ${auditFilterState.limit === l ? 'selected' : ''}>${l} Log</option>`
  ).join('');

  // Desktop Table Rows
  const tableRows = currentAuditLogs.length > 0 ? currentAuditLogs.map(l => {
    const time = formatAuditTime(l.created_at);
    return `
      <tr>
        <td>
          <div class="aud-time-cell">
            ${time.abs}
            <span class="aud-time-rel">${time.rel}</span>
          </div>
        </td>
        <td>
          <span class="aud-user-pill">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            ${escapeHtml(l.username)}
          </span>
        </td>
        <td>${getAuditBadgeHtml(l.action)}</td>
        <td><span class="aud-target-dev">${escapeHtml(l.target_device || '—')}</span></td>
        <td><div class="aud-details-text" title="${escapeHtml(l.details || '')}">${escapeHtml(l.details || '—')}</div></td>
      </tr>
    `;
  }).join('') : `<tr><td colspan="5" style="text-align:center; padding:32px; color:var(--text-muted);">Tidak ada rekaman audit yang sesuai kriteria filter.</td></tr>`;

  // Mobile Feed Cards
  const mobileCards = currentAuditLogs.length > 0 ? currentAuditLogs.map(l => {
    const time = formatAuditTime(l.created_at);
    return `
      <div class="aud-card">
        <div class="aud-card-head">
          ${getAuditBadgeHtml(l.action)}
          <div class="aud-time-cell" style="text-align:right">
            <span>${time.abs}</span>
            <span class="aud-time-rel">${time.rel}</span>
          </div>
        </div>
        <div class="aud-card-meta">
          <span class="aud-user-pill">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            ${escapeHtml(l.username)}
          </span>
          ${l.target_device ? `<span class="aud-card-target">${escapeHtml(l.target_device)}</span>` : ''}
        </div>
        ${l.details ? `<div class="aud-card-details">${escapeHtml(l.details)}</div>` : ''}
      </div>
    `;
  }).join('') : `<div style="text-align:center; padding:32px; color:var(--text-muted); background:rgba(15,23,42,0.8); border:1px dashed var(--border); border-radius:8px;">Tidak ada rekaman audit yang sesuai kriteria filter.</div>`;

  panel.innerHTML = `
    <div class="aud-workbench">
      <!-- Mission Head -->
      <div class="aud-mission-head">
        <div>
          <div class="aud-callsign">
            <span class="aud-live-dot"></span>
            SYS-AUDIT // IMMUTABLE LEDGER
          </div>
          <h2 class="aud-title">Log Audit & Kepatuhan Sistem</h2>
          <p class="aud-desc">Pencatatan real-time jejak forensik seluruh operasi router, kontrol SSH, topologi perangkat, dan otentikasi user.</p>
        </div>
        <div class="aud-actions">
          <button class="aud-btn aud-btn-refresh" id="aud-refresh-btn" onclick="refreshAuditView()" title="Perbarui Log Audit">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
            Refresh
          </button>
          <button class="aud-btn aud-btn-export" onclick="exportAuditCsv()" title="Ekspor ke CSV">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Ekspor CSV
          </button>
        </div>
      </div>

      <!-- Telemetry Quad Strip -->
      <div class="aud-kpi-strip">
        <div class="aud-kpi-cell">
          <span class="aud-kpi-lbl">TOTAL RECORD</span>
          <div class="aud-kpi-val">${totalCount.toLocaleString('id-ID')}</div>
        </div>
        <div class="aud-kpi-cell">
          <span class="aud-kpi-lbl">HARI INI</span>
          <div class="aud-kpi-val is-cyan">${todayCount.toLocaleString('id-ID')}</div>
        </div>
        <div class="aud-kpi-cell">
          <span class="aud-kpi-lbl">AKSI KRITIKAL</span>
          <div class="aud-kpi-val is-crit">${critCount.toLocaleString('id-ID')}</div>
        </div>
        <div class="aud-kpi-cell">
          <span class="aud-kpi-lbl">OPERATOR AKTIF</span>
          <div class="aud-kpi-val is-emerald">${activeOpsCount}</div>
        </div>
      </div>

      <!-- Triage Toolbar -->
      <div class="aud-toolbar">
        <div class="aud-pills-row">
          ${pillsHtml}
        </div>
        <div class="aud-search-row">
          <div class="aud-search-wrap">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" class="aud-search-input" id="aud-search-input" placeholder="Cari aksi, perangkat, detail, atau IP..." value="${escapeHtml(auditFilterState.search)}" oninput="onAuditSearchInput(this.value)">
          </div>
          <select class="aud-select" onchange="onAuditUserChange(this.value)" aria-label="Filter Operator">
            ${userOptionsHtml}
          </select>
          <select class="aud-select" onchange="onAuditLimitChange(this.value)" aria-label="Limit Baris">
            ${limitOptionsHtml}
          </select>
        </div>
      </div>

      <!-- Desktop Table View -->
      <div class="aud-table-wrap">
        <table class="aud-table">
          <thead>
            <tr>
              <th>Waktu (WIB)</th>
              <th>Operator</th>
              <th>Aksi / Kategori</th>
              <th>Target Perangkat</th>
              <th>Deskripsi & Parameter Audit</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </div>

      <!-- Mobile Timeline Feed Cards -->
      <div class="aud-feed-mobile">
        ${mobileCards}
      </div>
    </div>
  `;
}

async function refreshAuditView() {
  const btn = $('#aud-refresh-btn');
  if (btn) btn.classList.add('spinning');
  try {
    await fetchAuditData();
    renderAuditDOM();
    showToast('Log audit berhasil diperbarui', 'ok');
  } catch (err) {
    showToast('Gagal memuat log audit: ' + err.message, 'error');
  } finally {
    if (btn) btn.classList.remove('spinning');
  }
}

function setAuditCategory(cat) {
  if (auditFilterState.category === cat) return;
  auditFilterState.category = cat;
  renderAuditView();
}

function onAuditUserChange(user) {
  auditFilterState.user = user;
  renderAuditView();
}

function onAuditLimitChange(limit) {
  auditFilterState.limit = parseInt(limit) || 100;
  renderAuditView();
}

function onAuditSearchInput(val) {
  auditFilterState.search = val.trim();
  clearTimeout(auditDebounceTimer);
  auditDebounceTimer = setTimeout(() => {
    renderAuditView();
  }, 350);
}

function exportAuditCsv() {
  if (!currentAuditLogs || currentAuditLogs.length === 0) {
    showToast('Tidak ada data audit untuk diekspor', 'warning');
    return;
  }
  const headers = ['ID', 'Waktu', 'Operator', 'Aksi', 'Target Perangkat', 'Detail'];
  const csvRows = [headers.join(',')];
  
  for (const l of currentAuditLogs) {
    const row = [
      l.id,
      `"${String(l.created_at || '').replace(/"/g, '""')}"`,
      `"${String(l.username || '').replace(/"/g, '""')}"`,
      `"${String(l.action || '').replace(/"/g, '""')}"`,
      `"${String(l.target_device || '').replace(/"/g, '""')}"`,
      `"${String(l.details || '').replace(/"/g, '""')}"`
    ];
    csvRows.push(row.join(','));
  }
  
  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `audit_trail_${new Date().toISOString().slice(0,10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showToast(`Berhasil mengekspor ${currentAuditLogs.length} data audit ke CSV`, 'ok');
}

/* ── 21. USER MANAGEMENT (HALLMARK OPERATOR ACCESS & RBAC WORKBENCH) ── */
let currentUsersList = [];
let userFilterRole = 'ALL';
let userSearchTerm = '';
let userSearchDebounceTimer = null;

function formatUserLastLogin(dateStr) {
  if (!dateStr) return { abs: 'Belum Pernah', rel: 'Tidak ada aktivitas' };
  const d = new Date(dateStr);
  const abs = d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  const now = new Date();
  const diffSec = Math.floor((now - d) / 1000);
  let rel = '';
  if (diffSec < 60) rel = 'baru saja';
  else if (diffSec < 3600) rel = `${Math.floor(diffSec / 60)}m lalu`;
  else if (diffSec < 86400) rel = `${Math.floor(diffSec / 3600)}j lalu`;
  else rel = `${Math.floor(diffSec / 86400)}h lalu`;
  return { abs, rel };
}

async function renderUsersView() {
  const panel = $('#users-panel');
  if (!panel) return;

  if (!currentUsersList || currentUsersList.length === 0) {
    panel.innerHTML = renderLoadingState('Memuat Akses Operator Sistem...');
  } else {
    showBgLoadingIndicator(panel);
  }

  try {
    const res = await api.get('/api/auth/users');
    if (!res || !res.ok) {
      const errData = res ? await res.json() : {};
      throw new Error(errData.error || 'Gagal memuat pengguna');
    }
    const data = await res.json();
    currentUsersList = data.users || [];
    renderUsersDOM();
  } catch (err) {
    console.error('[Users]', err);
    panel.innerHTML = `
      <div class="usr-workbench">
        <div class="usr-mission-head">
          <div>
            <div class="usr-callsign"><span class="usr-live-dot" style="background:#ef4444;box-shadow:0 0 8px #ef4444;"></span>IAM // SECURITY ERROR</div>
            <h2 class="usr-title">Gagal Memuat Daftar Operator</h2>
            <p class="usr-desc" style="color:var(--alert)">${escapeHtml(err.message)}</p>
          </div>
          <div class="usr-actions">
            <button class="usr-btn usr-btn-refresh" onclick="refreshUsersView()">Coba Lagi</button>
          </div>
        </div>
      </div>
    `;
  } finally {
    hideBgLoadingIndicator(panel);
  }
}

function renderUsersDOM() {
  const panel = $('#users-panel');
  if (!panel) return;

  const totalUsers = currentUsersList.length;
  const adminCount = currentUsersList.filter(u => u.role === 'admin').length;
  const viewerCount = currentUsersList.filter(u => u.role !== 'admin').length;
  const pendingResetCount = currentUsersList.filter(u => u.must_change_password).length;

  // Filter users based on state
  let filtered = currentUsersList.slice();
  if (userFilterRole === 'admin') {
    filtered = filtered.filter(u => u.role === 'admin');
  } else if (userFilterRole === 'viewer') {
    filtered = filtered.filter(u => u.role !== 'admin');
  } else if (userFilterRole === 'reset') {
    filtered = filtered.filter(u => u.must_change_password);
  }

  if (userSearchTerm) {
    const q = userSearchTerm.toLowerCase();
    filtered = filtered.filter(u => 
      String(u.id).includes(q) || 
      (u.username && u.username.toLowerCase().includes(q)) ||
      (u.role && u.role.toLowerCase().includes(q))
    );
  }

  // Filter pills
  const pills = [
    { id: 'ALL', label: `Semua (${totalUsers})` },
    { id: 'admin', label: `Administrator (${adminCount})` },
    { id: 'viewer', label: `Viewer (${viewerCount})` },
    { id: 'reset', label: `Wajib Ganti Password (${pendingResetCount})`, isWarn: true }
  ];

  const pillsHtml = pills.map(p => {
    const isActive = userFilterRole === p.id;
    const warnClass = p.isWarn ? 'is-amber' : '';
    const activeClass = isActive ? `active ${warnClass}` : '';
    return `<button class="usr-pill ${activeClass}" onclick="setUserRoleFilter('${p.id}')">${p.label}</button>`;
  }).join('');

  // Desktop Table Rows
  const tableRows = filtered.length > 0 ? filtered.map(u => {
    const isSelf = currentUser && currentUser.id === u.id;
    const initial = (u.username || 'U').slice(0, 2).toUpperCase();
    const isAdm = u.role === 'admin';
    const roleBadge = isAdm
      ? `<span class="usr-role-badge is-admin"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>ADMINISTRATOR</span>`
      : `<span class="usr-role-badge is-viewer"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>VIEWER</span>`;

    const pwdBadge = u.must_change_password
      ? `<span class="usr-pwd-badge is-warn"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>Wajib Reset</span>`
      : `<span class="usr-pwd-badge is-normal"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>Normal</span>`;

    const loginTime = formatUserLastLogin(u.last_login);
    const createdStr = u.created_at ? new Date(u.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

    return `
      <tr>
        <td><span class="usr-id-tag">#${u.id}</span></td>
        <td>
          <div class="usr-name-col">
            <div class="usr-avatar-monogram ${isAdm ? '' : 'is-viewer'}">${initial}</div>
            <div>
              <span class="usr-username">${escapeHtml(u.username)}</span>
              ${isSelf ? '<span class="usr-self-badge">Sesi Aktif</span>' : ''}
            </div>
          </div>
        </td>
        <td>${roleBadge}</td>
        <td>${pwdBadge}</td>
        <td>
          <div style="font-family:var(--mono); font-size:11.5px; color:#cbd5e1">${loginTime.abs}</div>
          <div style="font-size:10px; color:var(--text-muted)">${loginTime.rel}</div>
        </td>
        <td style="font-family:var(--mono); font-size:11.5px; color:var(--text-muted)">${createdStr}</td>
        <td>
          <div class="usr-table-actions">
            <button class="usr-action-btn" title="Reset Password Operator" onclick="openResetUserModal(${u.id}, '${escapeHtml(u.username)}')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
              Reset
            </button>
            ${!isSelf ? `
              <button class="usr-action-btn danger" title="Hapus Operator" onclick="deleteUser(${u.id}, '${escapeHtml(u.username)}')">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                Hapus
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('') : `<tr><td colspan="7" style="text-align:center; padding:32px; color:var(--text-muted);">Tidak ada operator yang sesuai filter.</td></tr>`;

  // Mobile Cards
  const mobileCards = filtered.length > 0 ? filtered.map(u => {
    const isSelf = currentUser && currentUser.id === u.id;
    const initial = (u.username || 'U').slice(0, 2).toUpperCase();
    const isAdm = u.role === 'admin';
    const roleBadge = isAdm
      ? `<span class="usr-role-badge is-admin"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>ADMIN</span>`
      : `<span class="usr-role-badge is-viewer"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>VIEWER</span>`;

    const pwdBadge = u.must_change_password
      ? `<span class="usr-pwd-badge is-warn">Wajib Reset</span>`
      : `<span class="usr-pwd-badge is-normal">Normal</span>`;

    const loginTime = formatUserLastLogin(u.last_login);
    const createdStr = u.created_at ? new Date(u.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

    return `
      <div class="usr-card">
        <div class="usr-card-top">
          <div class="usr-card-user">
            <div class="usr-avatar-monogram ${isAdm ? '' : 'is-viewer'}">${initial}</div>
            <div>
              <div style="display:flex; align-items:center; gap:6px;">
                <span class="usr-username">${escapeHtml(u.username)}</span>
                ${isSelf ? '<span class="usr-self-badge">Sesi Aktif</span>' : ''}
              </div>
              <span class="usr-id-tag">ID: #${u.id}</span>
            </div>
          </div>
          <div>${roleBadge}</div>
        </div>
        <div class="usr-card-meta">
          <div class="usr-card-meta-row">
            <span>Status Keamanan:</span>
            ${pwdBadge}
          </div>
          <div class="usr-card-meta-row">
            <span>Login Terakhir:</span>
            <strong>${loginTime.abs} (${loginTime.rel})</strong>
          </div>
          <div class="usr-card-meta-row">
            <span>Dibuat Pada:</span>
            <strong>${createdStr}</strong>
          </div>
        </div>
        <div class="usr-card-actions">
          <button class="usr-action-btn" onclick="openResetUserModal(${u.id}, '${escapeHtml(u.username)}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
            Reset Password
          </button>
          ${!isSelf ? `
            <button class="usr-action-btn danger" onclick="deleteUser(${u.id}, '${escapeHtml(u.username)}')">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              Hapus
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('') : `<div style="text-align:center; padding:32px; color:var(--text-muted); background:rgba(15,23,42,0.8); border:1px dashed var(--border); border-radius:8px;">Tidak ada operator yang sesuai filter.</div>`;

  panel.innerHTML = `
    <div class="usr-workbench">
      <!-- Mission Head -->
      <div class="usr-mission-head">
        <div>
          <div class="usr-callsign">
            <span class="usr-live-dot"></span>
            IAM // OPERATOR ACCESS & RBAC GOVERNANCE
          </div>
          <h2 class="usr-title">Manajemen Akun & Otoritas Operator Sistem</h2>
          <p class="usr-desc">Pengendalian kredensial operator jaringan pabrik, tingkat otoritas (RBAC), serta pemantauan siklus hidup otentikasi.</p>
        </div>
        <div class="usr-actions">
          <button class="usr-btn usr-btn-refresh" id="usr-refresh-btn" onclick="refreshUsersView()" title="Perbarui Daftar Operator">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
            Refresh
          </button>
          <button class="usr-btn usr-btn-add" onclick="openAddUserModal()" title="Tambah Operator Baru">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Tambah Operator
          </button>
        </div>
      </div>

      <!-- Telemetry Quad Strip -->
      <div class="usr-kpi-strip">
        <div class="usr-kpi-cell">
          <span class="usr-kpi-lbl">TOTAL OPERATOR</span>
          <div class="usr-kpi-val">${totalUsers}</div>
        </div>
        <div class="usr-kpi-cell">
          <span class="usr-kpi-lbl">ADMIN RBAC</span>
          <div class="usr-kpi-val is-cyan">${adminCount}</div>
        </div>
        <div class="usr-kpi-cell">
          <span class="usr-kpi-lbl">VIEWER MONITOR</span>
          <div class="usr-kpi-val is-emerald">${viewerCount}</div>
        </div>
        <div class="usr-kpi-cell">
          <span class="usr-kpi-lbl">PERLU RESET</span>
          <div class="usr-kpi-val is-amber">${pendingResetCount}</div>
        </div>
      </div>

      <!-- Triage Toolbar -->
      <div class="usr-toolbar">
        <div class="usr-pills-row">
          ${pillsHtml}
        </div>
        <div class="usr-search-wrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" class="usr-search-input" placeholder="Cari username atau ID operator..." value="${escapeHtml(userSearchTerm)}" oninput="onUserSearchInput(this.value)">
        </div>
      </div>

      <!-- Desktop Table View -->
      <div class="usr-table-wrap">
        <table class="usr-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Operator / Akun</th>
              <th>Otoritas (RBAC)</th>
              <th>Status Keamanan</th>
              <th>Login Terakhir</th>
              <th>Dibuat</th>
              <th>Tindakan</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </div>

      <!-- Mobile Timeline Cards -->
      <div class="usr-feed-mobile">
        ${mobileCards}
      </div>
    </div>
  `;
}

async function refreshUsersView() {
  const btn = $('#usr-refresh-btn');
  if (btn) btn.classList.add('spinning');
  try {
    const res = await api.get('/api/auth/users');
    if (!res || !res.ok) {
      const errData = res ? await res.json() : {};
      throw new Error(errData.error || 'Gagal memuat pengguna');
    }
    const data = await res.json();
    currentUsersList = data.users || [];
    renderUsersDOM();
    showToast('Daftar operator berhasil diperbarui', 'ok');
  } catch (err) {
    showToast('Gagal memuat operator: ' + err.message, 'error');
  } finally {
    if (btn) btn.classList.remove('spinning');
  }
}

function setUserRoleFilter(role) {
  if (userFilterRole === role) return;
  userFilterRole = role;
  renderUsersDOM();
}

function onUserSearchInput(val) {
  userSearchTerm = val.trim();
  clearTimeout(userSearchDebounceTimer);
  userSearchDebounceTimer = setTimeout(() => {
    renderUsersDOM();
  }, 250);
}

/* Modal Helpers Add User */
function openAddUserModal() {
  $('#au-username').value = '';
  $('#au-password').value = '';
  $('#au-role').value = 'viewer';
  $('#au-err').textContent = '';
  $('#add-user-modal').classList.add('open');
}

function closeAddUserModal() {
  $('#add-user-modal').classList.remove('open');
}

async function submitAddUser() {
  const username = $('#au-username').value.trim();
  const password = $('#au-password').value;
  const role = $('#au-role').value;
  const errEl = $('#au-err');

  errEl.textContent = '';
  if (!username) { errEl.textContent = 'Username wajib diisi'; return; }
  if (!password || password.length < 6) { errEl.textContent = 'Password minimal 6 karakter'; return; }

  try {
    const res = await api.post('/api/auth/users', { username, password, role });
    if (!res || !res.ok) {
      const err = res ? await res.json() : {};
      throw new Error(err.error || 'Gagal menambahkan user');
    }
    closeAddUserModal();
    showToast(`Operator "${username}" berhasil ditambahkan!`, 'success');
    renderUsersView();
  } catch (err) {
    errEl.textContent = err.message;
  }
}

/* Modal Helpers Reset User Password */
function openResetUserModal(id, username) {
  $('#ru-user-id').value = id;
  const titleEl = $('#ru-modal-title');
  if (titleEl) titleEl.textContent = `Reset Password Operator (${username})`;
  $('#ru-password').value = '';
  $('#ru-must-change').checked = true;
  $('#ru-err').textContent = '';
  $('#reset-user-modal').classList.add('open');
}

function closeResetUserModal() {
  $('#reset-user-modal').classList.remove('open');
}

async function submitResetUserPwd() {
  const userId = $('#ru-user-id').value;
  const newPassword = $('#ru-password').value;
  const mustChange = $('#ru-must-change').checked;
  const errEl = $('#ru-err');

  errEl.textContent = '';
  if (!newPassword || newPassword.length < 6) { errEl.textContent = 'Password baru minimal 6 karakter'; return; }

  try {
    const res = await api.put(`/api/auth/users/${userId}/reset-password`, {
      new_password: newPassword,
      must_change_password: mustChange
    });
    if (!res || !res.ok) {
      const err = res ? await res.json() : {};
      throw new Error(err.error || 'Gagal mereset password');
    }
    closeResetUserModal();
    showToast('Password operator berhasil direset!', 'success');
    renderUsersView();
  } catch (err) {
    errEl.textContent = err.message;
  }
}

/* Delete User */
async function deleteUser(id, username) {
  if (!confirm(`Apakah Anda yakin ingin menghapus operator "${username}"?`)) return;

  try {
    const res = await api.delete(`/api/auth/users/${id}`);
    if (!res || !res.ok) {
      const err = res ? await res.json() : {};
      throw new Error(err.error || 'Gagal menghapus user');
    }
    showToast(`Operator "${username}" berhasil dihapus`, 'info');
    renderUsersView();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ── 21B. ROUTER & CLIENT MANAGEMENT PANEL ────────────────────────── */
let selectedRouterForClients = null;
let currentInspectedClients = [];

async function renderRoutersView() {
  const panel = $('#routers-view-panel');
  if (!panel) return;

  await loadRouters();

  const isAdmin = currentUser && currentUser.role === 'admin';

  if (!selectedRouterForClients && currentRoutersList.length > 0) {
    selectedRouterForClients = currentRoutersList[0].id;
  }

  const activeRouterObj = currentRoutersList.find(r => r.id === selectedRouterForClients);

  const routerCards = currentRoutersList.map(r => {
    const isSelected = r.id === selectedRouterForClients;
    return `
      <div class="bcard ${isSelected ? 'status-ok' : 'status-idle'}" style="cursor:pointer; ${isSelected ? 'border-color:var(--accent); background:rgba(56,189,248,0.06)' : ''}" onclick="selectRouterForInspection(${r.id})">
        <div class="bcard-head" style="margin-bottom:8px">
          <div>
            <span class="bcard-zone">${escapeHtml(r.router_type || 'mikrotik').toUpperCase()}</span>
            <h3 class="bcard-title" style="font-size:15px">${escapeHtml(r.name)}</h3>
          </div>
          ${isSelected ? '<span class="bcard-badge ok">✓ Terpilih</span>' : '<span class="bcard-badge idle">Klik Pilih</span>'}
        </div>
        <div style="font-family:var(--mono); font-size:12px; color:var(--text-muted); margin-bottom:12px">
          <div>🌐 Host: <b>${escapeHtml(r.host)}:${r.port}</b></div>
          <div>👤 User: <b>${escapeHtml(r.username)}</b></div>
        </div>
        <div class="row-actions" style="justify-content:flex-end">
          <button class="icon-btn" title="Tes Koneksi SSH" onclick="event.stopPropagation(); testRouterConnection(${r.id}, this)">🔌</button>
          ${isAdmin ? `<button class="icon-btn" title="Edit Router" onclick="event.stopPropagation(); openRouterFormModal(${r.id})">✍</button>` : ''}
          ${isAdmin ? `<button class="icon-btn danger" title="Hapus Router" onclick="event.stopPropagation(); deleteRouter(${r.id}, '${escapeHtml(r.name)}')">✖</button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  panel.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:20px; flex-wrap:wrap; gap:16px">
      <div>
        <h2 style="font-size:22px; margin:0 0 6px; color:#fff; font-weight:600">📡 Manajemen Router & Klien Tersambung</h2>
        <p style="font-size:13px; color:var(--text-muted); margin:0">Kelola router/AP dan lihat perangkat yang tersambung secara realtime via SSH.</p>
      </div>
      ${isAdmin ? `<button class="btn-primary" onclick="openRouterFormModal()">＋ Tambah Router / AP Baru</button>` : ''}
    </div>

    <!-- Router Grid Cards -->
    <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:16px; margin-bottom:28px">
      ${routerCards || '<div class="empty-state" style="grid-column:1/-1; padding:20px">Belum ada Router / AP terdaftar. Silakan tambah router baru.</div>'}
    </div>

    <!-- Inspected Router Clients Table -->
    <div style="background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:20px; margin-bottom:28px">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:10px">
        <div>
          <h3 style="font-size:16px; margin:0 0 4px; color:#fff">
            🔎 Klien Tersambung ke: <span style="color:var(--accent)">${activeRouterObj ? escapeHtml(activeRouterObj.name) : 'Belum Ada Router'}</span>
          </h3>
          <p style="font-size:12px; color:var(--text-muted); margin:0">Daftar tabel ARP & perangkat aktif yang terhubung ke router ini.</p>
        </div>
        ${activeRouterObj ? `<button class="btn-secondary" onclick="inspectRouterClients(${activeRouterObj.id})" style="padding:6px 14px; font-size:12px">⟳ Pindai Klien Live</button>` : ''}
      </div>

      <div id="router-clients-container">
        <p style="color:var(--text-muted); font-size:13px">Klik <b>"⟳ Pindai Klien Live"</b> untuk memuat perangkat tersambung.</p>
      </div>
    </div>

    <!-- Blocked Devices Section (Blacklist MAC) -->
    <div style="background:var(--panel); border:1px solid rgba(248,113,113,0.4); border-radius:12px; padding:20px">
      <div style="margin-bottom:16px">
        <h3 style="font-size:16px; margin:0 0 4px; color:var(--alert)">🔒 Daftar Perangkat Ter-Block Permanen (MAC Blacklist)</h3>
        <p style="font-size:12px; color:var(--text-muted); margin:0">Perangkat di bawah ini telah di-blacklist di firewall & MAC filter router sehingga ditolak saat mencoba terhubung.</p>
      </div>
      <div id="blocked-devices-container">
        <div style="text-align:center; padding:10px; color:var(--text-muted)">Memuat daftar block...</div>
      </div>
    </div>
  `;

  loadBlockedDevices();

  if (activeRouterObj) {
    inspectRouterClients(activeRouterObj.id);
  }
}

async function loadBlockedDevices() {
  const container = $('#blocked-devices-container');
  if (!container) return;

  try {
    const res = await api.get('/api/control/blocked');
    const data = await res.json();
    currentBlockedList = data.blocked || [];

    if (currentBlockedList.length === 0) {
      container.innerHTML = '<div style="text-align:center; padding:16px; color:var(--ok); font-size:13px">✓ Tidak ada perangkat yang sedang di-block saat ini.</div>';
      return;
    }

    const isAdmin = currentUser && currentUser.role === 'admin';

    const rows = currentBlockedList.map(b => `
      <tr>
        <td><b>${escapeHtml(b.device_name || 'Perangkat')}</b></td>
        <td style="font-family:var(--mono); font-size:12px; color:var(--alert); font-weight:600">${escapeHtml(b.mac)}</td>
        <td class="ip-cell">${escapeHtml(b.ip || '—')}</td>
        <td><span class="zone-badge" style="background:var(--panel-2); color:var(--text-muted)">${escapeHtml(b.router_name || 'Router')}</span></td>
        <td style="font-family:var(--mono); font-size:12px; color:var(--text-muted)">${new Date(b.blocked_at).toLocaleString('id-ID')}</td>
        <td>
          ${isAdmin ? `<button class="btn-secondary" style="padding:4px 10px; font-size:11px; border-color:var(--ok); color:var(--ok)" onclick="submitUnblockDevice(${b.id})">🔓 Buka Block (Unblock)</button>` : ''}
        </td>
      </tr>
    `).join('');

    container.innerHTML = `
      <div class="device-table-wrap">
        <table class="device-table">
          <thead>
            <tr>
              <th>Perangkat</th>
              <th>MAC Address Blocked</th>
              <th>IP Address</th>
              <th>Router Asal</th>
              <th>Waktu Block</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div style="color:var(--alert)">Gagal memuat data block: ${escapeHtml(err.message)}</div>`;
  }
}

function selectRouterForInspection(routerId) {
  selectedRouterForClients = routerId;
  renderRoutersView();
}

let currentWifiFilterBand = 'ALL';

async function inspectRouterClients(routerId) {
  const container = $('#router-clients-container');
  if (!container) return;

  container.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted)">⏳ Membaca data perangkat tersambung dari frekuensi Wi-Fi 2.4GHz & 5GHz router via SSH...</div>';

  try {
    const res = await api.get(`/api/devices/routers/${routerId}/clients`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Gagal memuat klien');

    currentInspectedClients = data.clients || [];

    if (currentInspectedClients.length === 0) {
      container.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted)">Tidak ada perangkat nirkabel yang tersambung ke jaringan Wi-Fi router ini saat ini.</div>';
      return;
    }

    const count24G = currentInspectedClients.filter(c => c.band === '2.4GHz').length;
    const count5G  = currentInspectedClients.filter(c => c.band === '5GHz').length;
    const countLAN = currentInspectedClients.filter(c => c.band === 'LAN').length;

    renderInspectedClientsTable(container, currentWifiFilterBand, count24G, count5G, countLAN);
  } catch (err) {
    container.innerHTML = `<div style="padding:20px; color:var(--alert); text-align:center">❌ ${escapeHtml(err.message)}</div>`;
  }
}

function setWifiFilterBand(band) {
  currentWifiFilterBand = band;
  const container = $('#router-clients-container');
  if (!container || !currentInspectedClients) return;

  const count24G = currentInspectedClients.filter(c => c.band === '2.4GHz').length;
  const count5G  = currentInspectedClients.filter(c => c.band === '5GHz').length;
  const countLAN = currentInspectedClients.filter(c => c.band === 'LAN').length;

  renderInspectedClientsTable(container, band, count24G, count5G, countLAN);
}

function renderInspectedClientsTable(container, filterBand, count24G, count5G, countLAN) {
  const isAdmin = currentUser && currentUser.role === 'admin';

  let filteredClients = currentInspectedClients;
  if (filterBand === '2.4G') {
    filteredClients = currentInspectedClients.filter(c => c.band === '2.4GHz');
  } else if (filterBand === '5G') {
    filteredClients = currentInspectedClients.filter(c => c.band === '5GHz');
  } else if (filterBand === 'LAN') {
    filteredClients = currentInspectedClients.filter(c => c.band === 'LAN');
  }

  const rows = filteredClients.map((c) => {
    const bandBadge = c.band === '5GHz'
      ? `<span class="zone-badge" style="background:rgba(168,85,247,0.15); color:#c084fc; border:1px solid rgba(168,85,247,0.3)">⚡ 5 GHz</span>`
      : c.band === '2.4GHz'
      ? `<span class="zone-badge" style="background:rgba(56,189,248,0.15); color:#38bdf8; border:1px solid rgba(56,189,248,0.3)">📶 2.4 GHz</span>`
      : `<span class="zone-badge" style="background:rgba(52,211,153,0.15); color:#34d399; border:1px solid rgba(52,211,153,0.3)">🔌 LAN / Kabel</span>`;

    return `
      <tr>
        <td style="font-weight:600">${escapeHtml(c.nama)}</td>
        <td class="ip-cell">${escapeHtml(c.ip)}</td>
        <td style="font-family:var(--mono); font-size:12px">${escapeHtml(c.mac)}</td>
        <td>${bandBadge}</td>
        <td>
          ${c.is_monitored 
            ? `<span class="status-badge" style="color:var(--ok); background:rgba(52,211,153,0.15)">✓ Terdaftar: ${escapeHtml(c.monitored_nama)}</span>` 
            : `<span class="status-badge" style="color:var(--warn); background:rgba(251,191,36,0.15)">⚪ Perangkat Baru</span>`}
        </td>
        <td>
          <div class="row-actions">
            ${isAdmin ? `<button class="icon-btn danger" title="Putus Sambungan (Kick)" onclick="openKickModal(null, '${escapeHtml(c.mac)}', '${escapeHtml(c.ip)}', '${escapeHtml(c.nama)}')">🚫</button>` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div style="display:flex; align-items:center; gap:8px; margin-bottom:14px; flex-wrap:wrap">
      <span style="font-size:12px; color:var(--text-muted); font-weight:600">Filter Jaringan:</span>
      <button class="tab-btn ${filterBand === 'ALL' ? 'active' : ''}" onclick="setWifiFilterBand('ALL')" style="padding:4px 12px; font-size:12px">
        Semua Perangkat (${currentInspectedClients.length})
      </button>
      <button class="tab-btn ${filterBand === '2.4G' ? 'active' : ''}" onclick="setWifiFilterBand('2.4G')" style="padding:4px 12px; font-size:12px; border-color:rgba(56,189,248,0.4)">
        📶 Wi-Fi 2.4 GHz (${count24G})
      </button>
      <button class="tab-btn ${filterBand === '5G' ? 'active' : ''}" onclick="setWifiFilterBand('5G')" style="padding:4px 12px; font-size:12px; border-color:rgba(168,85,247,0.4)">
        ⚡ Wi-Fi 5 GHz (${count5G})
      </button>
      <button class="tab-btn ${filterBand === 'LAN' ? 'active' : ''}" onclick="setWifiFilterBand('LAN')" style="padding:4px 12px; font-size:12px; border-color:rgba(52,211,153,0.4)">
        🔌 LAN / Kabel (${countLAN})
      </button>
    </div>

    <div class="device-table-wrap">
      <table class="device-table">
        <thead>
          <tr>
            <th>Nama / Label</th>
            <th>IP Address</th>
            <th>MAC Address</th>
            <th>Jaringan Wi-Fi</th>
            <th>Status Monitoring</th>
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--text-muted)">Tidak ada perangkat tersambung pada filter ${filterBand === '2.4G' ? '2.4 GHz' : filterBand === '5G' ? '5 GHz' : 'Wi-Fi'}.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

/* ── 22. INIT ──────────────────────────────────────────────────────── */
async function init(){
  // Paksa kosongkan search input — Chrome/Edge sering abaikan autocomplete="off"
  const si = $('#search-input');
  if (si) { si.value = ''; }

  // Mulai jam digital stasiun
  startStationClock();

  // Tampilkan loading state
  const bar = $('#stats-bar');
  if(bar) bar.innerHTML='<div class="telemetry-cluster cluster-inv" style="opacity:.6"><span class="t-lbl">SYS</span> <b class="t-val">SYNC...</b></div>';

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
    try {
      await loadTopology();
    } catch(topoErr) {
      console.warn('[Topology] Gagal memuat topologi dari server, akan ditampilkan kosong:', topoErr.message);
    }
    await loadZones();
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

/* ── 20. AUTO DISCOVERY & MULTI-ROUTER MANAGEMENT ──────────────────── */
let scannedDevicesList = [];
let currentRoutersList = [];
let activeScanTab = 'results'; // 'results' or 'routers'

async function loadRouters() {
  try {
    const res = await api.get('/api/devices/routers');
    if (res && res.ok) {
      const data = await res.json();
      currentRoutersList = data.routers || [];
    }
  } catch (err) {
    console.warn('[Routers] Gagal memuat daftar router:', err.message);
  }
}

async function scanNetwork() {
  const modal = $('#scan-modal');
  const body = $('#scan-body');
  if (!modal || !body) return;
  
  modal.classList.add('open');
  activeScanTab = 'results';
  await loadRouters();

  renderScanModalContent();
  runNetworkScan();
}

function renderScanModalContent() {
  const modal = $('#scan-modal');
  if (!modal) return;

  const titleEl = $('.modal-title', modal);
  if (titleEl) {
    titleEl.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; width:100%; padding-right:30px">
        <span>🔍 Pindai & Kelola Router Jaringan</span>
        <div style="display:flex; gap:6px">
          <button class="btn-secondary" style="padding:6px 12px; font-size:12px; ${activeScanTab==='results'?'border-color:var(--accent);color:var(--accent)':''}" onclick="switchScanTab('results')">🔍 Hasil Pindai</button>
          <button class="btn-secondary" style="padding:6px 12px; font-size:12px; ${activeScanTab==='routers'?'border-color:var(--accent);color:var(--accent)':''}" onclick="switchScanTab('routers')">📡 Kelola Router / AP (${currentRoutersList.length})</button>
        </div>
      </div>
    `;
  }

  if (activeScanTab === 'routers') {
    renderRoutersTab();
  }
}

function switchScanTab(tab) {
  activeScanTab = tab;
  renderScanModalContent();
  if (tab === 'results' && scannedDevicesList.length === 0) {
    runNetworkScan();
  }
}

async function runNetworkScan() {
  const body = $('#scan-body');
  if (!body) return;

  body.innerHTML = `
    <div style="text-align:center; padding:30px 20px;">
      <div class="stat-chip" style="display:inline-flex; opacity:.8; margin-bottom:10px">📡 Memindai dari ${currentRoutersList.length || 1} Router / AP...</div>
      <p style="color:var(--text-muted); font-size:13px; margin:0">Menghubungi SSH router & membaca tabel ARP. Mohon tunggu beberapa detik...</p>
    </div>
  `;

  try {
    const res = await api.get('/api/devices/scan');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Gagal memindai');
    
    scannedDevicesList = data.scanned || [];

    if (activeScanTab === 'results') {
      renderScanResultsTable();
    }
  } catch(e) {
    if (activeScanTab === 'results') {
      body.innerHTML = `<div style="text-align:center; padding: 25px; color: var(--alert)">❌ Error Pemindaian: ${escapeHtml(e.message)}</div>`;
    }
  }
}

function renderScanResultsTable() {
  const body = $('#scan-body');
  if (!body) return;

  if (scannedDevicesList.length === 0) {
    body.innerHTML = `
      <div style="text-align:center; padding: 30px;">
        <p style="color:var(--ok); font-weight:600; margin-bottom:4px">✓ Pemindaian Selesai</p>
        <p style="font-size:13px; color:var(--text-muted)">Tidak ada perangkat baru ditemukan di jaringan.</p>
        <button class="btn-secondary" onclick="runNetworkScan()" style="margin-top:10px">⟳ Pindai Ulang</button>
      </div>
    `;
    return;
  }

  let html = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px">
      <span style="font-size:12px; color:var(--text-muted)">Ditemukan <b>${scannedDevicesList.length}</b> perangkat baru:</span>
      <button class="btn-secondary" onclick="runNetworkScan()" style="padding:4px 10px; font-size:11px">⟳ Pindai Ulang</button>
    </div>
    <table class="device-table">
      <thead>
        <tr>
          <th style="width:40px"><input type="checkbox" onchange="toggleAllScanned(this)" checked></th>
          <th>Nama Perangkat</th>
          <th>IP Address</th>
          <th>MAC Address</th>
          <th>Router Asal</th>
          <th>Tujuan Lokasi</th>
        </tr>
      </thead>
      <tbody>
  `;

  let locOptions = '<option value="">-- Pilih Lokasi --</option>';
  const sortedLocs = [...state.locations].sort((a,b)=>a.nama.localeCompare(b.nama));
  sortedLocs.forEach(l => {
    const sel = l.id === currentLocId ? 'selected' : '';
    locOptions += `<option value="${l.id}" ${sel}>${escapeHtml(l.nama)} (${l.zone})</option>`;
  });

  scannedDevicesList.forEach((d, i) => {
    html += `
      <tr>
        <td><input type="checkbox" class="scan-chk" data-idx="${i}" checked></td>
        <td><input type="text" class="scan-nama" id="scan-nama-${i}" value="${escapeHtml(d.nama)}" style="width:100%; padding:4px"></td>
        <td class="ip-cell">${escapeHtml(d.ip)}</td>
        <td style="font-family:var(--mono); font-size:12px">${escapeHtml(d.mac)}</td>
        <td><span class="zone-badge" style="background:var(--panel-2); color:var(--text-muted)">${escapeHtml(d.router_name || 'Router')}</span></td>
        <td><select class="scan-loc" id="scan-loc-${i}" style="width:100%; padding:4px">${locOptions}</select></td>
      </tr>
    `;
  });
  html += '</tbody></table>';
  body.innerHTML = html;
}

function renderRoutersTab() {
  const body = $('#scan-body');
  if (!body) return;

  const rows = currentRoutersList.map(r => `
    <tr>
      <td><b>${escapeHtml(r.name)}</b></td>
      <td class="ip-cell">${escapeHtml(r.host)}:${r.port}</td>
      <td style="font-family:var(--mono); font-size:12px; color:var(--text-muted)">${escapeHtml(r.username)}</td>
      <td><span class="zone-badge" style="background:var(--panel-2); color:var(--accent)">${escapeHtml(r.router_type || 'mikrotik').toUpperCase()}</span></td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" title="Tes Koneksi SSH" onclick="testRouterConnection(${r.id}, this)">🔌</button>
          <button class="icon-btn" title="Edit Router" onclick="openRouterFormModal(${r.id})">✍</button>
          <button class="icon-btn danger" title="Hapus Router" onclick="deleteRouter(${r.id}, '${escapeHtml(r.name)}')">✖</button>
        </div>
      </td>
    </tr>
  `).join('');

  body.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px">
      <div>
        <h3 style="font-size:15px; margin:0 0 4px; color:#fff">📡 Daftar Router & Access Point Wi-Fi (${currentRoutersList.length})</h3>
        <p style="font-size:12px; color:var(--text-muted); margin:0">Aplikasi akan memindai ARP & memutus koneksi perangkat melalui router-router ini.</p>
      </div>
      <button class="btn-primary" onclick="openRouterFormModal()">＋ Tambah Router / AP</button>
    </div>
    <div class="device-table-wrap">
      <table class="device-table">
        <thead>
          <tr>
            <th>Nama Router / AP</th>
            <th>Host / IP Address</th>
            <th>Username SSH</th>
            <th>Tipe OS</th>
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="5" class="no-devices">Belum ada Router/AP terdaftar. Silakan tambah router baru.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

function openRouterFormModal(routerId) {
  const modal = $('#router-form-modal');
  if (!modal) return;

  $('#rf-err').textContent = '';
  const title = $('#rf-modal-title');
  const d = routerId ? currentRoutersList.find(r => r.id === routerId) : null;

  title.textContent = d ? '✍ Edit Router / AP' : '📡 Tambah Router / AP Baru';
  $('#rf-id').value   = d ? d.id : '';
  $('#rf-name').value = d ? d.name : '';
  $('#rf-host').value = d ? d.host : '';
  $('#rf-port').value = d ? d.port : 22;
  $('#rf-user').value = d ? d.username : 'admin';
  $('#rf-pass').value = '';
  $('#rf-type').value = d ? d.router_type || 'mikrotik' : 'mikrotik';

  modal.classList.add('open');
}

function closeRouterFormModal() {
  const modal = $('#router-form-modal');
  if (modal) modal.classList.remove('open');
}

async function submitRouterForm() {
  const id    = $('#rf-id').value;
  const name  = $('#rf-name').value.trim();
  const host  = $('#rf-host').value.trim();
  const port  = parseInt($('#rf-port').value) || 22;
  const user  = $('#rf-user').value.trim();
  const pass  = $('#rf-pass').value;
  const type  = $('#rf-type').value;
  const errEl = $('#rf-err');

  errEl.textContent = '';
  if (!name || !host || !user) {
    errEl.textContent = 'Nama, Host/IP, dan Username wajib diisi';
    return;
  }

  try {
    let res;
    if (id) {
      res = await api.put(`/api/devices/routers/${id}`, {
        name, host, port, username: user, password: pass || undefined, router_type: type
      });
    } else {
      res = await api.post('/api/devices/routers', {
        name, host, port, username: user, password: pass, router_type: type
      });
    }

    if (!res || !res.ok) {
      const err = res ? await res.json() : {};
      throw new Error(err.error || 'Gagal menyimpan router');
    }

    closeRouterFormModal();
    showToast(`Router "${name}" berhasil disimpan`, 'success');
    await loadRouters();
    renderScanModalContent();
    renderRoutersView();
  } catch (err) {
    errEl.textContent = err.message;
  }
}

async function deleteRouter(id, name) {
  if (!confirm(`Apakah Anda yakin ingin menghapus router "${name}"?`)) return;

  try {
    const res = await api.delete(`/api/devices/routers/${id}`);
    if (!res || !res.ok) {
      const err = res ? await res.json() : {};
      throw new Error(err.error || 'Gagal menghapus router');
    }
    showToast(`Router "${name}" dihapus`, 'info');
    await loadRouters();
    renderScanModalContent();
    renderRoutersView();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function testRouterConnection(id, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  try {
    const res = await api.post(`/api/devices/routers/${id}/test`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Tes SSH gagal');
    showToast(data.message, 'ok');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔌'; }
  }
}

/* ── 20B. DISCONNECT / KICK & BLOCK DEVICE ─────────────────────────── */
let activeKickPayload = null;
let currentBlockedList = [];

async function openKickModal(deviceId, mac, ip, name) {
  const modal = $('#kick-modal');
  const body  = $('#kick-modal-body');
  if (!modal || !body) return;

  activeKickPayload = { deviceId, mac, ip, name };
  await loadRouters();

  const defaultRouterId = selectedRouterForClients || (currentRoutersList.length > 0 ? currentRoutersList[0].id : '');
  let routerOptions = currentRoutersList.map(r => 
    `<option value="${r.id}" ${r.id == defaultRouterId ? 'selected' : ''}>${escapeHtml(r.name)} (${r.host}) - ${r.router_type.toUpperCase()}</option>`
  ).join('');

  if (currentRoutersList.length === 0) {
    routerOptions = '<option value="">-- Belum ada Router Terdaftar --</option>';
  }

  body.innerHTML = `
    <div style="margin-bottom:16px;">
      <p style="font-size:13px; color:var(--text-muted); margin:0 0 10px">
        Pilih tindakan keamanan untuk perangkat <b>"${escapeHtml(name)}"</b>:
      </p>
      <div style="background:var(--panel-2); padding:12px 14px; border-radius:8px; border:1px solid var(--border); font-family:var(--mono); font-size:12.5px; margin-bottom:16px">
        <div>• <b>Nama:</b> ${escapeHtml(name)}</div>
        <div>• <b>IP Address:</b> ${escapeHtml(ip || '—')}</div>
        <div>• <b>MAC Address:</b> ${escapeHtml(mac || '—')}</div>
      </div>
      <div class="field">
        <label>Pilih Router / AP Wi-Fi Tujuan</label>
        <select id="kick-router-id" style="width:100%; padding:10px">${routerOptions}</select>
      </div>
    </div>
    <div style="display:flex; flex-direction:column; gap:10px; margin-top:20px;">
      <button class="btn-primary" style="background:var(--alert); border:none; color:#fff" onclick="submitBlockDevice()">🔒 BLOCK PERMANEN (Blacklist MAC & Firewall)</button>
      <button class="btn-primary" style="background:var(--warn); border:none; color:#000" onclick="submitKickDevice()">⚡ Putus Koneksi Sementara (Deauth/Kick)</button>
      <button class="btn-secondary" onclick="closeKickModal()">Batal</button>
    </div>
  `;

  modal.classList.add('open');
}

function closeKickModal() {
  const modal = $('#kick-modal');
  if (modal) modal.classList.remove('open');
  activeKickPayload = null;
}

async function submitKickDevice() {
  if (!activeKickPayload) return;

  const routerId = $('#kick-router-id').value;
  const { deviceId, mac, ip, name } = activeKickPayload;

  try {
    const res = await api.post('/api/control/kick', {
      device_id: deviceId,
      mac,
      ip,
      router_id: routerId
    });

    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Gagal memutus koneksi');

    closeKickModal();
    showToast(data.message || `Koneksi "${name}" berhasil diputus`, 'ok');
  } catch (err) {
    showToast(`Gagal: ${err.message}`, 'error');
  }
}

async function submitBlockDevice() {
  if (!activeKickPayload) return;

  const routerId = $('#kick-router-id').value;
  const { deviceId, mac, ip, name } = activeKickPayload;

  if (!confirm(`Apakah Anda YAKIN ingin MEM-BLOCK PERMANEN perangkat "${name}" (${mac})? Perangkat TIDAK AKAN BISA terhubung ke Wi-Fi lagi.`)) {
    return;
  }

  try {
    const res = await api.post('/api/control/block', {
      device_id: deviceId,
      mac,
      ip,
      router_id: routerId,
      reason: 'Blocked via Web App'
    });

    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Gagal mem-block perangkat');

    closeKickModal();
    showToast(data.message || `Perangkat "${name}" BERHASIL DI-BLOCK PERMANEN!`, 'ok');
    loadBlockedDevices();
    if (selectedRouterForClients) inspectRouterClients(selectedRouterForClients);
  } catch (err) {
    showToast(`Gagal mem-block: ${err.message}`, 'error');
  }
}

async function submitUnblockDevice(blockId) {
  if (!confirm('Apakah Anda yakin ingin membuka block untuk perangkat ini?')) return;

  try {
    const res = await api.post('/api/control/unblock', { block_id: blockId });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Gagal unblock');

    showToast(data.message, 'ok');
    refreshActiveView();
  } catch (err) {
    showToast(err.message, 'error');
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
          loc_id,
          catatan: base.router_name ? `Tersambung via ${base.router_name}` : 'Auto-discovered'
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
    btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
    btn.title = 'Sembunyikan Password';
  } else {
    input.type = 'password';
    btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
    btn.title = 'Tampilkan Password';
  }
}

/* --- Mobile Menu Interactions --- */
const mobileMenuBtn = $('#mobile-menu-btn');
const mobileOverlay = $('#mobile-overlay');
const sidebar = $('#sidebar');

if (mobileMenuBtn && mobileOverlay && sidebar) {
  mobileMenuBtn.addEventListener('click', () => {
    sidebar.classList.add('mobile-open');
    mobileOverlay.classList.add('show');
  });

  mobileOverlay.addEventListener('click', () => {
    sidebar.classList.remove('mobile-open');
    mobileOverlay.classList.remove('show');
  });

  sidebar.addEventListener('click', (e) => {
    if (e.target.closest('.loc-item, .zone-item') && window.innerWidth <= 768) {
      sidebar.classList.remove('mobile-open');
      mobileOverlay.classList.remove('show');
    }
  });

  const sidebarCloseBtn = $('#sidebar-close-btn');
  if (sidebarCloseBtn) {
    sidebarCloseBtn.addEventListener('click', () => {
      sidebar.classList.remove('mobile-open');
      mobileOverlay.classList.remove('show');
    });
  }
}

/* ── MANAGE TOPOLOGY ── */
let mtCollapsedSet = new Set();

async function renderManageTopo() {
  const rootContainer = $('#mt-tree-root');
  if(!rootContainer) return;
  
  const totalNodes = RAW_TOPOLOGY.length;
  const infraCount = RAW_TOPOLOGY.filter(n => n.kind === 'infra').length;
  const bldgCount  = RAW_TOPOLOGY.filter(n => n.kind === 'building').length;
  
  const countEl = $('#mt-node-count');
  if (countEl) countEl.textContent = `${totalNodes} Total Node (${infraCount} Infra, ${bldgCount} Lokasi)`;
  
  const statsRow = $('#mt-stats-row');
  if (statsRow) {
    statsRow.innerHTML = `
      <div class="mt-stat-card">
        <span class="mt-stat-icon">🌐</span>
        <div class="mt-stat-info">
          <span class="mt-stat-val">${totalNodes}</span>
          <span class="mt-stat-lbl">Total Node</span>
        </div>
      </div>
      <div class="mt-stat-card">
        <span class="mt-stat-icon">⚡</span>
        <div class="mt-stat-info">
          <span class="mt-stat-val" style="color:#fbbf24">${infraCount}</span>
          <span class="mt-stat-lbl">Infrastruktur</span>
        </div>
      </div>
      <div class="mt-stat-card">
        <span class="mt-stat-icon">🏢</span>
        <div class="mt-stat-info">
          <span class="mt-stat-val" style="color:#4ade80">${bldgCount}</span>
          <span class="mt-stat-lbl">Lokasi / Gedung</span>
        </div>
      </div>
    `;
  }
  
  if (totalNodes === 0) {
    rootContainer.innerHTML = `
      <div class="mt-empty">
        <span class="mt-empty-icon">🗺️</span>
        <span class="mt-empty-text">Belum ada node topologi. Silakan tambah node baru.</span>
        <button class="btn ok" onclick="openNodeForm()">+ Tambah Node</button>
      </div>
    `;
    return;
  }
  
  const map = {};
  const roots = [];
  RAW_TOPOLOGY.forEach(n => {
    map[n.id] = { ...n, children: [] };
  });
  RAW_TOPOLOGY.forEach(n => {
    if (n.parent_id && map[n.parent_id]) {
      map[n.parent_id].children.push(map[n.id]);
    } else {
      roots.push(map[n.id]);
    }
  });
  
  function renderTreeNode(node, depth = 0, isLastArray = []) {
    const hasKids = node.children.length > 0;
    const isCollapsed = mtCollapsedSet.has(node.id);
    const icon = node.kind === 'building' ? '🏢' : '⚡';
    
    let indentHtml = '<span class="mt-indent-sp">';
    for (let i = 0; i < depth; i++) {
      const isLastSibling = isLastArray[i];
      indentHtml += `<span class="mt-indent-line ${isLastSibling ? 'last' : ''}"></span>`;
    }
    indentHtml += '</span>';
    
    let html = `
      <div class="mt-node" data-id="${escapeHtml(node.id)}" data-label="${escapeHtml(node.label.toLowerCase())}">
        <div class="mt-node-row" data-depth="${depth}">
          ${indentHtml}
          <span class="mt-toggle ${hasKids ? (isCollapsed ? '' : 'expanded') : 'leaf'}" onclick="toggleMtNode('${escapeHtml(node.id)}', event)">▶</span>
          <span class="mt-node-icon">${icon}</span>
          <span class="mt-kind mt-kind-${node.kind}">${node.kind}</span>
          <span class="mt-label">${escapeHtml(node.label)}</span>
          ${hasKids ? `<span class="mt-child-count">${node.children.length} anak</span>` : ''}
          <div class="mt-node-actions">
            <button class="mt-btn mt-btn-add" title="Tambah Sub-node" onclick="openNodeForm(null, '${escapeHtml(node.id)}')">＋ Anak</button>
            <button class="mt-btn mt-btn-edit" onclick="openNodeForm('${escapeHtml(node.id)}')">Edit</button>
            <button class="mt-btn mt-btn-del" onclick="deleteNode('${escapeHtml(node.id)}')">Hapus</button>
          </div>
        </div>
        ${hasKids ? `
          <div class="mt-children ${isCollapsed ? 'collapsed' : ''}" id="mt-children-${escapeHtml(node.id)}">
            ${node.children.map((child, idx) => renderTreeNode(child, depth + 1, [...isLastArray, idx === node.children.length - 1])).join('')}
          </div>
        ` : ''}
      </div>
    `;
    return html;
  }
  
  rootContainer.innerHTML = roots.map((rootNode, idx) => renderTreeNode(rootNode, 0, [idx === roots.length - 1])).join('');
}

function toggleMtNode(id, evt) {
  if (evt) evt.stopPropagation();
  if (mtCollapsedSet.has(id)) {
    mtCollapsedSet.delete(id);
  } else {
    mtCollapsedSet.add(id);
  }
  const childEl = $(`#mt-children-${id}`);
  const nodeEl = $(`.mt-node[data-id="${id}"]`);
  const toggleEl = nodeEl ? nodeEl.querySelector('.mt-toggle') : null;
  if (childEl) childEl.classList.toggle('collapsed');
  if (toggleEl) toggleEl.classList.toggle('expanded');
}

function filterTopoTree(query) {
  const q = (query || '').toLowerCase().trim();
  const nodes = $$('.mt-node');
  
  if (!q) {
    nodes.forEach(n => n.classList.remove('hidden-node'));
    return;
  }
  
  nodes.forEach(n => {
    const label = n.dataset.label || '';
    if (label.includes(q)) {
      n.classList.remove('hidden-node');
      let parentNode = n.parentElement ? n.parentElement.closest('.mt-node') : null;
      while (parentNode) {
        parentNode.classList.remove('hidden-node');
        const childContainer = parentNode.querySelector('.mt-children');
        if (childContainer) childContainer.classList.remove('collapsed');
        parentNode = parentNode.parentElement ? parentNode.parentElement.closest('.mt-node') : null;
      }
    } else {
      n.classList.add('hidden-node');
    }
  });
}

function onNodeKindChange() {
  const kind = $('#node-kind').value;
  $('#node-loc-field').style.display = kind === 'building' ? 'block' : 'none';
}

function openNodeForm(id = null, parentId = null) {
  const modal = $('#node-modal');
  if(!modal) return;
  
  const parentSelect = $('#node-parent-id');
  parentSelect.innerHTML = '<option value="">-- Root (Tidak Punya Induk) --</option>' + 
    RAW_TOPOLOGY.filter(n => n.id !== id).map(n => `<option value="${escapeHtml(n.id)}">${escapeHtml(n.label)}</option>`).join('');
    
  const locSelect = $('#node-loc-id');
  locSelect.innerHTML = '<option value="">-- Pilih Lokasi --</option>' + 
    state.locations.map(l => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.nama)}</option>`).join('');
    
  if (id) {
    const node = RAW_TOPOLOGY.find(n => n.id === id);
    if(node) {
      $('#node-modal-title').textContent = 'Edit Node: ' + node.label;
      $('#node-id').value = node.id;
      $('#node-id-display').value = node.id;
      $('#node-label').value = node.label;
      $('#node-kind').value = node.kind;
      $('#node-parent-id').value = node.parent_id || '';
      $('#node-loc-id').value = node.loc_id || '';
    }
  } else {
    $('#node-modal-title').textContent = parentId ? 'Tambah Sub-node' : 'Tambah Node Baru';
    $('#node-form').reset();
    $('#node-id').value = '';
    if (parentId) $('#node-parent-id').value = parentId;
  }
  
  onNodeKindChange();
  modal.classList.add('open');
}

function closeNodeForm() {
  const modal = $('#node-modal');
  if(modal) modal.classList.remove('open');
}

async function submitNodeForm() {
  const id = $('#node-id').value;
  const payload = {
    label: $('#node-label').value,
    kind: $('#node-kind').value,
    parent_id: $('#node-parent-id').value || null,
    loc_id: $('#node-kind').value === 'building' ? $('#node-loc-id').value : null,
  };
  
  try {
    const url = id ? '/api/topology/' + id : '/api/topology';
    const method = id ? 'PUT' : 'POST';
    if (!id) payload.id = 'node_' + Date.now();
    
    const res = id 
      ? await api.request('PUT', url, payload)
      : await api.request('POST', url, payload);
    
    if(!res.ok) throw new Error(await res.text());
    
    showToast(id ? 'Node diperbarui' : 'Node ditambahkan', 'ok');
    closeNodeForm();
    await loadTopology();
    renderTopology();
    renderManageTopo();
  } catch(e) {
    showToast(e.message, 'error');
  }
}

async function deleteNode(id) {
  if(!confirm('Yakin ingin menghapus node ini? (Anak-anaknya akan terputus dari parent)')) return;
  try {
    const res = await api.request('DELETE', '/api/topology/' + id);
    if(!res.ok) throw new Error(await res.text());
    showToast('Node dihapus', 'ok');
    await loadTopology();
    renderTopology();
    renderManageTopo();
  } catch(e) {
    showToast(e.message, 'error');
  }
}

async function loadSubCategories() {
  try {
    const res = await api.get('/api/devices/locations');
    if (res && res.ok) {
      const data = await res.json();
      if (data.locations && data.locations.length > 0) {
        allLocations = data.locations.map(l => ({
          id: l.id,
          nama: l.nama,
          zone: l.zone_key,
          zone_label: l.zone_label || l.zone_key,
          sort_order: l.sort_order,
          device_count: Number(l.device_count) || 0
        }));
        state.locations = allLocations;
      }
    }
  } catch (err) {
    console.warn('[SubCategories] Gagal memuat lokasi:', err.message);
  }
}

/* ── 20C. ZONE & SUB-CATEGORY MANAGEMENT MODAL (HALLMARK REDESIGN) ─── */
let activeCatTab = 'main'; // 'main' or 'sub'
let allLocations = SEED_LOCATIONS;

function updateZonesModalStats() {
  const elCountZones = $('#badge-count-zones');
  const elCountSubcat = $('#badge-count-subcat');
  const elStatZones = $('#zh-stat-zones');
  const elStatLocations = $('#zh-stat-locations');
  const elStatDevices = $('#zh-stat-devices');

  const totalZones = ZONES.length;
  const totalLocations = allLocations.length;
  let totalDevs = 0;
  allLocations.forEach(l => {
    totalDevs += (l.device_count !== undefined ? Number(l.device_count) : deviceCount(l.id));
  });

  if (elCountZones) elCountZones.textContent = totalZones;
  if (elCountSubcat) elCountSubcat.textContent = totalLocations;
  if (elStatZones) elStatZones.textContent = totalZones;
  if (elStatLocations) elStatLocations.textContent = totalLocations;
  if (elStatDevices) elStatDevices.textContent = totalDevs;
}

async function openZonesModal() {
  const modal = $('#zones-modal');
  if (!modal) return;
  
  await loadZones();
  await loadSubCategories();
  updateZonesModalStats();
  switchCategoryTab(activeCatTab || 'main');
  closeZoneForm();
  closeSubCatForm();
  modal.classList.add('open');
}

function closeZonesModal() {
  const modal = $('#zones-modal');
  if (modal) modal.classList.remove('open');
}

function switchCategoryTab(tab) {
  activeCatTab = tab;
  const btnMain = $('#btn-tab-main-cat');
  const btnSub = $('#btn-tab-sub-cat');
  const tabMain = $('#cat-tab-main');
  const tabSub = $('#cat-tab-sub');

  if (tab === 'main') {
    if (btnMain) btnMain.classList.add('active');
    if (btnSub) btnSub.classList.remove('active');
    if (tabMain) tabMain.style.display = 'block';
    if (tabSub) tabSub.style.display = 'none';
    renderZonesTable();
  } else {
    if (btnSub) btnSub.classList.add('active');
    if (btnMain) btnMain.classList.remove('active');
    if (tabSub) tabSub.style.display = 'block';
    if (tabMain) tabMain.style.display = 'none';
    populateSubCatZoneFilters();
    renderSubCategoriesTable();
  }
}

function renderZonesTable() {
  const tbody = $('#zones-table-body');
  const cardsContainer = $('#zones-cards-body');
  if (!tbody && !cardsContainer) return;

  const searchQuery = ($('#zone-search-input') ? $('#zone-search-input').value : '').trim().toLowerCase();
  const isAdmin = currentUser && currentUser.role === 'admin';

  let list = ZONES;
  if (searchQuery) {
    list = list.filter(z => 
      (z.key && z.key.toLowerCase().includes(searchQuery)) || 
      (z.label && z.label.toLowerCase().includes(searchQuery))
    );
  }

  // 1. Render Desktop Table
  if (tbody) {
    const rows = list.map(z => {
      const locs = locationsByZone(z.key);
      const locCount = z.location_count !== undefined ? z.location_count : locs.length;
      let devCount = z.device_count !== undefined ? z.device_count : 0;
      if (z.device_count === undefined) {
        locs.forEach(l => devCount += deviceCount(l.id));
      }

      return `
        <tr>
          <td><span class="zh-key-badge">${escapeHtml(z.key)}</span></td>
          <td style="font-weight:600; color:#fff">${escapeHtml(z.label)}</td>
          <td style="font-family:var(--mono); text-align:center">${z.sort_order || 0}</td>
          <td><span class="zh-count-pill ${locCount > 0 ? 'has-items' : ''}">${locCount} ruangan</span></td>
          <td><span class="zh-count-pill ${devCount > 0 ? 'has-items' : ''}">${devCount} unit</span></td>
          <td style="text-align:right">
            <div style="display:flex; justify-content:flex-end; gap:6px">
              ${isAdmin ? `
                <button class="action-btn-pill edit zh-tbl-btn" onclick="editZone(${z.id})">
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  <span>Edit</span>
                </button>
                <button class="action-btn-pill delete zh-tbl-btn" onclick="deleteZone(${z.id})">
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                  <span>Hapus</span>
                </button>
              ` : '<span style="color:var(--text-muted); font-size:11px">Read-only</span>'}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tbody.innerHTML = rows || '<tr><td colspan="6" style="text-align:center; padding:24px; color:var(--text-muted)">Tidak ditemukan kategori gedung yang cocok.</td></tr>';
  }

  // 2. Render Mobile Cards (Hallmark Gate 52 Dual Presentation)
  if (cardsContainer) {
    const cards = list.map(z => {
      const locs = locationsByZone(z.key);
      const locCount = z.location_count !== undefined ? z.location_count : locs.length;
      let devCount = z.device_count !== undefined ? z.device_count : 0;
      if (z.device_count === undefined) {
        locs.forEach(l => devCount += deviceCount(l.id));
      }

      return `
        <div class="zh-card">
          <div class="zh-card-head">
            <span class="zh-card-key">${escapeHtml(z.key)}</span>
            <span class="zh-card-order">Urutan: ${z.sort_order || 0}</span>
          </div>
          <div class="zh-card-title">${escapeHtml(z.label)}</div>
          <div class="zh-card-meta-row">
            <span class="zh-count-pill ${locCount > 0 ? 'has-items' : ''}">${locCount} Ruangan</span>
            <span class="zh-count-pill ${devCount > 0 ? 'has-items' : ''}">${devCount} Perangkat Terhubung</span>
          </div>
          ${isAdmin ? `
            <div class="zh-card-actions">
              <button class="action-btn-pill edit zh-card-btn" onclick="editZone(${z.id})">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                <span>Edit Kategori</span>
              </button>
              <button class="action-btn-pill delete zh-card-btn" onclick="deleteZone(${z.id})">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                <span>Hapus</span>
              </button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    cardsContainer.innerHTML = cards || '<div style="text-align:center; padding:24px; color:var(--text-muted)">Tidak ditemukan kategori gedung.</div>';
  }
}

function openAddZoneForm() {
  $('#zf-id').value = '';
  $('#zf-key').value = '';
  $('#zf-key').disabled = false;
  $('#zf-label').value = '';
  $('#zf-order').value = ZONES.length + 1;
  $('#zf-err').textContent = '';
  $('#zone-form-title').textContent = 'Tambah Kategori Utama';
  $('#zone-form-box').style.display = 'block';
}

function editZone(id) {
  const z = ZONES.find(item => item.id === id);
  if (!z) return;

  $('#zf-id').value = z.id;
  $('#zf-key').value = z.key;
  $('#zf-key').disabled = true;
  $('#zf-label').value = z.label;
  $('#zf-order').value = z.sort_order || 0;
  $('#zf-err').textContent = '';
  $('#zone-form-title').textContent = `Edit Kategori Utama (${z.key})`;
  $('#zone-form-box').style.display = 'block';
}

function closeZoneForm() {
  $('#zone-form-box').style.display = 'none';
  $('#zf-err').textContent = '';
}

async function submitZoneForm() {
  const id = $('#zf-id').value;
  const key = $('#zf-key').value.trim();
  const label = $('#zf-label').value.trim();
  const order = parseInt($('#zf-order').value) || 0;
  const errEl = $('#zf-err');

  errEl.textContent = '';
  if (!label) {
    errEl.textContent = 'Nama / Label kategori wajib diisi';
    return;
  }

  try {
    let res;
    if (id) {
      res = await api.put(`/api/devices/zones/${id}`, { label, sort_order: order });
    } else {
      if (!key) {
        errEl.textContent = 'Kode Unique (Key) wajib diisi';
        return;
      }
      res = await api.post('/api/devices/zones', { zone_key: key, label, sort_order: order });
    }

    if (!res || !res.ok) {
      const err = res ? await res.json() : {};
      throw new Error(err.error || 'Gagal menyimpan kategori');
    }

    showToast(`Kategori Utama "${label}" berhasil disimpan`, 'success');
    closeZoneForm();
    await loadZones();
    updateZonesModalStats();
    renderZonesTable();
    populateSubCatZoneFilters();
    renderSidebar();
  } catch (err) {
    errEl.textContent = err.message;
  }
}

async function deleteZone(id) {
  const z = ZONES.find(item => item.id === id);
  const label = z ? z.label : 'Kategori';
  const locs = z ? locationsByZone(z.key) : [];
  const locCount = z && z.location_count !== undefined ? z.location_count : locs.length;

  if (locCount > 0) {
    showToast(`Tidak dapat menghapus "${label}" karena masih memiliki ${locCount} sub-kategori/ruangan. Pindahkan atau hapus ruangan terlebih dahulu.`, 'warning');
    return;
  }

  if (!confirm(`Apakah Anda yakin ingin menghapus kategori "${label}"?`)) return;

  try {
    const res = await api.delete(`/api/devices/zones/${id}`);
    if (!res || !res.ok) {
      const err = res ? await res.json() : {};
      throw new Error(err.error || 'Gagal menghapus kategori');
    }

    showToast(`Kategori Utama "${label}" berhasil dihapus`, 'info');
    await loadZones();
    updateZonesModalStats();
    renderZonesTable();
    populateSubCatZoneFilters();
    renderSidebar();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ── SUB-CATEGORY MANAGEMENT FUNCTIONS ── */

function populateSubCatZoneFilters() {
  const filterSelect = $('#subcat-filter-zone');
  const formSelect = $('#scf-zone');
  if (!filterSelect || !formSelect) return;

  const prevFilterVal = filterSelect.value || 'ALL';

  let filterOptions = '<option value="ALL">Semua Kategori Utama</option>';
  let formOptions = '<option value="">-- Pilih Kategori Utama --</option>';

  ZONES.forEach(z => {
    filterOptions += `<option value="${z.key}">${escapeHtml(z.label)} (${z.key})</option>`;
    formOptions += `<option value="${z.key}">${escapeHtml(z.label)} (${z.key})</option>`;
  });

  filterSelect.innerHTML = filterOptions;
  filterSelect.value = prevFilterVal;
  formSelect.innerHTML = formOptions;
}

async function renderSubCategoriesTable() {
  const tbody = $('#subcat-table-body');
  const cardsContainer = $('#subcat-cards-body');
  if (!tbody && !cardsContainer) return;

  const filterZone = $('#subcat-filter-zone') ? $('#subcat-filter-zone').value : 'ALL';
  const searchQuery = ($('#subcat-search-input') ? $('#subcat-search-input').value : '').trim().toLowerCase();
  const isAdmin = currentUser && currentUser.role === 'admin';

  let list = allLocations;
  if (filterZone && filterZone !== 'ALL') {
    list = list.filter(l => l.zone === filterZone);
  }
  if (searchQuery) {
    list = list.filter(l => 
      (l.nama && l.nama.toLowerCase().includes(searchQuery)) || 
      (l.id && l.id.toLowerCase().includes(searchQuery)) ||
      (l.zone && l.zone.toLowerCase().includes(searchQuery)) ||
      (l.zone_label && l.zone_label.toLowerCase().includes(searchQuery))
    );
  }

  // 1. Render Desktop Table
  if (tbody) {
    const rows = list.map((l, idx) => {
      const parentZone = ZONES.find(z => z.key === l.zone);
      const zoneLabel = parentZone ? parentZone.label : (l.zone_label || l.zone);
      const devCount = l.device_count !== undefined ? l.device_count : deviceCount(l.id);

      return `
        <tr>
          <td style="font-family:var(--mono); font-size:12px; color:var(--text-muted); text-align:center; font-weight:600">${idx + 1}</td>
          <td style="font-weight:600; color:#fff">${escapeHtml(l.nama)}</td>
          <td><span class="zh-key-badge">${escapeHtml(zoneLabel)} (${escapeHtml(l.zone)})</span></td>
          <td><span class="zh-count-pill ${devCount > 0 ? 'has-items' : ''}">${devCount} unit</span></td>
          <td style="text-align:right">
            <div style="display:flex; justify-content:flex-end; gap:6px">
              ${isAdmin ? `
                ${devCount > 0 ? `
                  <button class="action-btn-pill move zh-tbl-btn" onclick="openMoveModalForLocation('${l.id}')" title="Pindahkan ${devCount} perangkat ke ruangan lain">
                    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
                    <span>Pindah (${devCount})</span>
                  </button>
                ` : ''}
                <button class="action-btn-pill edit zh-tbl-btn" onclick="editSubCat('${l.id}')">
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  <span>Edit</span>
                </button>
                <button class="action-btn-pill delete zh-tbl-btn" onclick="deleteSubCat('${l.id}')">
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                  <span>Hapus</span>
                </button>
              ` : '<span style="color:var(--text-muted); font-size:11px">Read-only</span>'}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tbody.innerHTML = rows || '<tr><td colspan="5" style="text-align:center; padding:24px; color:var(--text-muted)">Tidak ditemukan sub-kategori yang sesuai.</td></tr>';
  }

  // 2. Render Mobile Cards (Hallmark Gate 52 Dual Presentation)
  if (cardsContainer) {
    const cards = list.map(l => {
      const parentZone = ZONES.find(z => z.key === l.zone);
      const zoneLabel = parentZone ? parentZone.label : (l.zone_label || l.zone);
      const devCount = l.device_count !== undefined ? l.device_count : deviceCount(l.id);

      return `
        <div class="zh-card">
          <div class="zh-card-head">
            <span class="zh-key-badge">${escapeHtml(zoneLabel)}</span>
            <span class="zh-count-pill ${devCount > 0 ? 'has-items' : ''}">${devCount} Perangkat</span>
          </div>
          <div class="zh-card-title">${escapeHtml(l.nama)}</div>
          ${isAdmin ? `
            <div class="zh-card-actions">
              ${devCount > 0 ? `
                <button class="action-btn-pill move zh-card-btn" onclick="openMoveModalForLocation('${l.id}')">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
                  <span>Pindahkan (${devCount})</span>
                </button>
              ` : ''}
              <button class="action-btn-pill edit zh-card-btn" onclick="editSubCat('${l.id}')">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                <span>Edit Ruangan</span>
              </button>
              <button class="action-btn-pill delete zh-card-btn" onclick="deleteSubCat('${l.id}')">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                <span>Hapus</span>
              </button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    cardsContainer.innerHTML = cards || '<div style="text-align:center; padding:24px; color:var(--text-muted)">Tidak ditemukan sub-kategori yang sesuai.</div>';
  }
}

function openAddSubCatForm() {
  populateSubCatZoneFilters();
  $('#scf-id').value = '';
  $('#scf-name').value = '';
  $('#scf-zone').value = ZONES.length > 0 ? ZONES[0].key : '';
  $('#scf-err').textContent = '';
  $('#subcat-form-title').textContent = 'Tambah Sub-Kategori / Ruangan Baru';
  $('#subcat-form-box').style.display = 'block';
}

function editSubCat(id) {
  const loc = allLocations.find(l => l.id === id);
  if (!loc) return;

  populateSubCatZoneFilters();
  $('#scf-id').value = loc.id;
  $('#scf-name').value = loc.nama;
  $('#scf-zone').value = loc.zone;
  $('#scf-err').textContent = '';
  $('#subcat-form-title').textContent = `Edit Sub-Kategori (${loc.nama})`;
  $('#subcat-form-box').style.display = 'block';
}

function closeSubCatForm() {
  $('#subcat-form-box').style.display = 'none';
  $('#scf-err').textContent = '';
}

async function submitSubCatForm() {
  const id = $('#scf-id').value;
  const name = $('#scf-name').value.trim();
  const zoneKey = $('#scf-zone').value;
  const errEl = $('#scf-err');

  errEl.textContent = '';
  if (!name || !zoneKey) {
    errEl.textContent = 'Nama sub-kategori dan Kategori Utama wajib diisi';
    return;
  }

  try {
    let res;
    if (id) {
      res = await api.put(`/api/devices/locations/${id}`, { nama: name, zone_key: zoneKey });
    } else {
      res = await api.post('/api/devices/locations', { nama: name, zone_key: zoneKey });
    }

    if (!res || !res.ok) {
      const err = res ? await res.json() : {};
      throw new Error(err.error || 'Gagal menyimpan sub-kategori');
    }

    showToast(`Sub-kategori "${name}" berhasil disimpan`, 'success');
    closeSubCatForm();
    await loadSubCategories();
    updateZonesModalStats();
    renderSubCategoriesTable();
    renderSidebar();
    renderTopology();
  } catch (err) {
    errEl.textContent = err.message;
  }
}

async function deleteSubCat(id) {
  const loc = allLocations.find(l => String(l.id) === String(id));
  const locName = loc ? loc.nama : id;
  const devCount = loc ? (loc.device_count !== undefined ? loc.device_count : deviceCount(loc.id)) : 0;

  if (devCount > 0) {
    const relatedDevs = Array.isArray(allDevices) ? allDevices.filter(d => String(d.loc_id) === String(id)).map(d => d.nama || d.ip) : [];
    const devListStr = relatedDevs.length > 0 ? ` (${relatedDevs.slice(0, 3).join(', ')}${relatedDevs.length > 3 ? '...' : ''})` : '';
    if (confirm(`Ruangan "${locName}" tidak dapat dihapus karena masih digunakan oleh ${devCount} perangkat aktif${devListStr}.\n\nApakah Anda ingin memindahkan perangkat-perangkat ini ke ruangan lain sekarang?`)) {
      openMoveModalForLocation(id);
    }
    return;
  }

  if (!confirm(`Apakah Anda yakin ingin menghapus sub-kategori "${locName}"?`)) return;

  try {
    const res = await api.delete(`/api/devices/locations/${id}`);
    if (!res || !res.ok) {
      const err = res ? await res.json() : {};
      throw new Error(err.error || 'Gagal menghapus sub-kategori');
    }

    showToast(`Sub-kategori "${locName}" berhasil dihapus`, 'info');
    await loadSubCategories();
    updateZonesModalStats();
    renderSubCategoriesTable();
    renderSidebar();
    renderTopology();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ── 20D. MOVE DEVICES WORKBENCH (HALLMARK INDUSTRIAL REASSIGNMENT) ─── */
let moveModalSourceLocId = null;
let moveModalDevices = [];

async function openMoveModalForLocation(sourceLocId) {
  moveModalSourceLocId = sourceLocId;
  const modal = $('#move-devices-modal');
  const body = $('#move-devices-body');
  if (!modal || !body) return;

  const loc = (allLocations || []).find(l => String(l.id) === String(sourceLocId)) || { id: sourceLocId, nama: 'Ruangan' };
  
  body.innerHTML = '<div style="text-align:center; padding:30px; color:var(--text-muted); font-family:var(--mono); font-size:12px">Memuat daftar perangkat...</div>';
  modal.classList.add('open');

  try {
    const res = await api.get(`/api/devices/loc/${sourceLocId}`);
    if (!res || !res.ok) throw new Error('Gagal mengambil daftar perangkat ruangan');
    const data = await res.json();
    moveModalDevices = data.devices || [];

    if (moveModalDevices.length === 0) {
      body.innerHTML = `
        <div class="zh-move-source-banner">
          <span class="zh-move-source-title">Ruangan Asal</span>
          <span class="zh-move-source-val">${escapeHtml(loc.nama)}</span>
        </div>
        <div style="text-align:center; padding:24px; color:var(--text-muted); font-size:13px">
          Tidak ada perangkat yang terdaftar di ruangan ini.
        </div>
        <div class="zh-move-actions">
          <button class="btn-secondary zh-move-btn-cancel" onclick="closeMoveDevicesModal()">Tutup</button>
        </div>
      `;
      return;
    }

    renderMoveDevicesModal(loc, moveModalDevices);
  } catch (err) {
    body.innerHTML = `<div style="color:var(--alert); padding:20px; text-align:center">Error: ${escapeHtml(err.message)}</div>`;
  }
}

function openMoveModalForDevice(deviceId) {
  let foundDevice = null;
  let sourceLocId = currentLocId;

  for (const [lid, list] of Object.entries(state.devices || {})) {
    const d = (list || []).find(x => x.id === deviceId);
    if (d) {
      foundDevice = d;
      sourceLocId = d.loc_id || lid;
      break;
    }
  }

  if (!foundDevice) {
    showToast('Perangkat tidak ditemukan', 'error');
    return;
  }

  moveModalSourceLocId = sourceLocId;
  moveModalDevices = [foundDevice];

  const modal = $('#move-devices-modal');
  if (!modal) return;

  const loc = (allLocations || []).find(l => String(l.id) === String(sourceLocId)) || { id: sourceLocId, nama: 'Ruangan Terkait' };
  renderMoveDevicesModal(loc, [foundDevice], deviceId);
  modal.classList.add('open');
}

function closeMoveDevicesModal() {
  const modal = $('#move-devices-modal');
  if (modal) modal.classList.remove('open');
  moveModalSourceLocId = null;
  moveModalDevices = [];
}

function renderMoveDevicesModal(sourceLoc, devices, preselectedDeviceId = null) {
  const body = $('#move-devices-body');
  if (!body) return;

  const targetOptions = getLocationOptionsHtml(null, sourceLoc.id);

  const deviceItemsHtml = devices.map(d => {
    const checked = (!preselectedDeviceId || d.id === preselectedDeviceId) ? 'checked' : '';
    const statusDotColor = d.status === 'Online' ? '#22c55e' : (d.status === 'Offline' ? '#ef4444' : '#94a3b8');
    return `
      <label class="zh-move-dev-item">
        <input type="checkbox" class="zh-move-chk" value="${d.id}" ${checked} onchange="onMoveDeviceCheckChange()">
        <div class="zh-move-dev-info">
          <span class="zh-move-dev-name">${escapeHtml(d.nama)}</span>
          <div class="zh-move-dev-meta">
            <span class="tc-tier-tag dist">${escapeHtml(d.tipe || 'DEV')}</span>
            <span>${escapeHtml(d.ip || 'No-IP')}</span>
            <span style="width:7px; height:7px; border-radius:50%; background:${statusDotColor}; display:inline-block"></span>
          </div>
        </div>
      </label>
    `;
  }).join('');

  body.innerHTML = `
    <div class="zh-move-source-banner">
      <div>
        <div class="zh-move-source-title">Ruangan Asal (Source)</div>
        <div class="zh-move-source-val">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg>
          <span>${escapeHtml(sourceLoc.nama)}</span>
        </div>
      </div>
      <span class="zh-count-pill has-items">${devices.length} Perangkat</span>
    </div>

    <div class="zh-move-dev-list-wrap">
      <div class="zh-move-dev-header">
        <span>PILIH PERANGKAT (${devices.length})</span>
        <div style="display:flex; gap:10px">
          <button type="button" class="btn-link" onclick="toggleAllMoveDevices(true)" style="font-size:10.5px; color:#c084fc; background:none; border:none; cursor:pointer">Pilih Semua</button>
          <button type="button" class="btn-link" onclick="toggleAllMoveDevices(false)" style="font-size:10.5px; color:var(--text-muted); background:none; border:none; cursor:pointer">Batal Semua</button>
        </div>
      </div>
      <div class="zh-move-dev-scroll">
        ${deviceItemsHtml}
      </div>
    </div>

    <div class="zh-move-target-group">
      <label class="zh-move-target-label" for="move-target-loc">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        <span>Pindahkan ke Ruangan Tujuan (Destination):</span>
      </label>
      <select id="move-target-loc" class="zh-move-select">
        <option value="">-- Pilih Ruangan / Sub-Kategori Tujuan --</option>
        ${targetOptions}
      </select>
    </div>

    <div class="zh-move-actions">
      <button class="btn-secondary zh-move-btn-cancel" onclick="closeMoveDevicesModal()">Batal</button>
      <div style="display:flex; align-items:center; gap:10px">
        <span class="zh-move-count-indicator" id="move-selected-indicator">
          <strong id="move-selected-count">${devices.length}</strong> perangkat terpilih
        </span>
        <button class="zh-move-btn-exec" id="btn-exec-move" onclick="executeMoveDevices()">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
          <span>Pindahkan Sekarang</span>
        </button>
      </div>
    </div>
  `;

  onMoveDeviceCheckChange();
}

function toggleAllMoveDevices(checkAll) {
  const chks = document.querySelectorAll('.zh-move-chk');
  chks.forEach(c => c.checked = checkAll);
  onMoveDeviceCheckChange();
}

function onMoveDeviceCheckChange() {
  const chks = document.querySelectorAll('.zh-move-chk:checked');
  const countEl = $('#move-selected-count');
  const btn = $('#btn-exec-move');
  if (countEl) countEl.textContent = chks.length;
  if (btn) btn.disabled = (chks.length === 0);
}

async function executeMoveDevices() {
  const targetSelect = $('#move-target-loc');
  const targetLocId = targetSelect ? targetSelect.value : '';
  if (!targetLocId) {
    showToast('Harap pilih ruangan tujuan terlebih dahulu', 'warning');
    if (targetSelect) targetSelect.focus();
    return;
  }

  const chks = document.querySelectorAll('.zh-move-chk:checked');
  const deviceIds = Array.from(chks).map(c => c.value);
  if (deviceIds.length === 0) {
    showToast('Pilih minimal 1 perangkat untuk dipindahkan', 'warning');
    return;
  }

  const btn = $('#btn-exec-move');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>Memindahkan...</span>';
  }

  try {
    const res = await api.post('/api/devices/move', {
      device_ids: deviceIds,
      target_loc_id: targetLocId
    });

    if (!res || !res.ok) {
      const err = res ? await res.json() : {};
      throw new Error(err.error || 'Gagal memindahkan perangkat');
    }

    const data = await res.json();
    const targetLocName = data.target_loc ? data.target_loc.nama : 'ruangan tujuan';

    showToast(`Berhasil memindahkan ${data.moved_count} perangkat ke "${targetLocName}"!`, 'success');
    closeMoveDevicesModal();

    await loadDevices();
    await loadSubCategories();
    updateZonesModalStats();
    renderSubCategoriesTable();
    refreshActiveView();
    renderSidebar();
    renderStats();
    renderTopology();
  } catch (err) {
    showToast(err.message, 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
        <span>Pindahkan Sekarang</span>
      `;
    }
  }
}

init();
