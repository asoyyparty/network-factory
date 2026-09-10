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
          sort_order: z.sort_order
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
  updateSidebarFooterTelemetry();
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
// UID assignment is now handled in loadTopology()
/* Nodes that start collapsed */
const collapsedNodes = new Set();
// Collapsed nodes are initialized in loadTopology() after tree is built

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
  if(!NETWORK_TREE) return '';
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

  const oldScroll = $('.topo-table-scroll', inner);
  const prevLeft = oldScroll ? oldScroll.scrollLeft : 0;
  const prevTop  = oldScroll ? oldScroll.scrollTop  : 0;

  inner.innerHTML =
    `<div class="topo-th-wrap">` +
    `<div class="topo-legend-row">` +
    `<span class="tl-dot s-ok"></span>Online&nbsp;&nbsp;` +
    `<span class="tl-dot s-alert"></span>Offline&nbsp;&nbsp;` +
    `<span class="tl-dot s-warn"></span>Maintenance&nbsp;&nbsp;` +
    `<span class="tl-dot s-idle"></span>Belum Ada Data&nbsp;&nbsp;` +
    `<span style="margin-left:12px;color:var(--text-muted)">▶ = klik expand/collapse | 🖐️ Klik & drag mouse untuk geser peta</span>` +
    `</div>` +
    `<div class="topo-table-scroll">` +
    `<table class="topo-htable"><tbody>${buildTopoTable()}</tbody></table>` +
    `</div></div>`;

  const newScroll = $('.topo-table-scroll', inner);
  if (newScroll) {
    newScroll.scrollLeft = prevLeft;
    newScroll.scrollTop  = prevTop;
    enableTopoDragScroll(newScroll);
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
function switchTab(name){
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
        ${isAdmin ? `<button class="icon-btn danger" title="Putus Sambungan dari Router" onclick="openKickModal('${d.id}','${escapeHtml(d.mac||'')}','${escapeHtml(d.ip||'')}','${escapeHtml(d.nama)}')">🚫</button>` : ''}
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
        ${isAdmin ? `<button class="icon-btn danger" title="Putus Sambungan dari Router" onclick="openKickModal('${d.id}','${escapeHtml(d.mac||'')}','${escapeHtml(d.ip||'')}','${escapeHtml(d.nama)}')">🚫</button>` : ''}
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
    const titleArea = panel.querySelector('.sla-title-area') || panel.querySelector('.sla-header') || panel.querySelector('h2') || panel.firstElementChild;
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

  // Render full spinner ONLY on initial load when no data exists yet
  if (!currentSlaReport || currentSlaReport.length === 0) {
    panel.innerHTML = renderLoadingState('Memuat Laporan Uptime SLA...');
  } else {
    showBgLoadingIndicator(panel);
  }

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
      <div class="sla-header">
        <div class="sla-title-area">
          <h2>📈 Laporan Uptime SLA (7 Hari Terakhir)</h2>
          <p>Rata-rata ketersediaan keseluruhan pabrik: <b class="sla-avg">${avgFactoryUptime.toFixed(2)}%</b></p>
        </div>
        <div class="sla-actions">
          <button class="add-btn sla-btn-secondary" onclick="exportSlaExcel()">📥 Download Excel</button>
          <button class="add-btn sla-btn-primary" onclick="window.print()">🖨️ Cetak / PDF</button>
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
let currentAuditLogs = [];

async function renderAuditView() {
  const panel = $('#audit-panel');
  if (!panel) return;

  if (!currentAuditLogs || currentAuditLogs.length === 0) {
    panel.innerHTML = renderLoadingState('Memuat Log Audit Sistem...');
  } else {
    showBgLoadingIndicator(panel);
  }

  try {
    const res = await api.get('/api/audit?limit=100');
    const data = await res.json();
    currentAuditLogs = data.logs || [];
    
    const rows = currentAuditLogs.map(l => `
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

/* ── 21. USER MANAGEMENT ───────────────────────────────────────────── */
let currentUsersList = [];

async function renderUsersView() {
  const panel = $('#users-panel');
  if (!panel) return;

  if (!currentUsersList || currentUsersList.length === 0) {
    panel.innerHTML = renderLoadingState('Memuat Daftar Pengguna...');
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

    const rows = currentUsersList.map(u => {
      const isSelf = currentUser && currentUser.id === u.id;
      const roleBadge = u.role === 'admin'
        ? '<span class="status-badge" style="color:var(--accent);background:rgba(56,189,248,0.15);border:1px solid var(--accent-dim)">⚡ ADMIN</span>'
        : '<span class="status-badge" style="color:var(--text-muted);background:rgba(156,163,175,0.15);border:1px solid var(--border)">👁️ VIEWER</span>';
      
      const pwdBadge = u.must_change_password
        ? '<span class="status-badge" style="color:var(--warn);background:rgba(251,191,36,0.15)">⚠️ Wajib Ganti</span>'
        : '<span class="status-badge" style="color:var(--ok);background:rgba(52,211,153,0.15)">Normal</span>';

      const lastLoginStr = u.last_login ? new Date(u.last_login).toLocaleString('id-ID') : 'Belum Pernah';
      const createdAtStr = u.created_at ? new Date(u.created_at).toLocaleString('id-ID') : '—';

      return `
        <tr>
          <td style="font-family:var(--mono); font-weight:600; color:var(--accent)">#${u.id}</td>
          <td><b>${escapeHtml(u.username)}</b> ${isSelf ? '<span style="font-size:11px; color:var(--accent); margin-left:6px">(Anda)</span>' : ''}</td>
          <td>${roleBadge}</td>
          <td>${pwdBadge}</td>
          <td style="font-family:var(--mono); font-size:12px; color:var(--text-muted)">${lastLoginStr}</td>
          <td style="font-family:var(--mono); font-size:12px; color:var(--text-muted)">${createdAtStr}</td>
          <td>
            <div class="row-actions">
              <button class="icon-btn" title="Reset Password User" onclick="openResetUserModal(${u.id}, '${escapeHtml(u.username)}')">🔑</button>
              ${!isSelf ? `<button class="icon-btn danger" title="Hapus User" onclick="deleteUser(${u.id}, '${escapeHtml(u.username)}')">✖</button>` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:20px; flex-wrap:wrap; gap:16px">
        <div>
          <h2 style="font-size:22px; margin:0 0 6px; color:#fff; font-weight:600">👥 Kelola Pengguna System</h2>
          <p style="font-size:13px; color:var(--text-muted); margin:0">Total Pengguna Terdaftar: <b>${currentUsersList.length}</b> akun</p>
        </div>
        <button class="btn-primary" onclick="openAddUserModal()">＋ Tambah User Baru</button>
      </div>
      <div class="device-table-wrap">
        <table class="device-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Username</th>
              <th>Role</th>
              <th>Status Password</th>
              <th>Login Terakhir</th>
              <th>Dibuat Pada</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="7" class="no-devices">Belum ada user tambahan.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    console.error('[Users]', err);
    panel.innerHTML = `<div class="empty-state"><p style="color:var(--alert)">⚠️ Gagal memuat pengguna: ${escapeHtml(err.message)}</p></div>`;
  } finally {
    hideBgLoadingIndicator(panel);
  }
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
    showToast(`User "${username}" berhasil ditambahkan!`, 'success');
    renderUsersView();
  } catch (err) {
    errEl.textContent = err.message;
  }
}

/* Modal Helpers Reset User Password */
function openResetUserModal(id, username) {
  $('#ru-user-id').value = id;
  $('#ru-modal-title').textContent = `🔑 Reset Password User (${username})`;
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
    showToast('Password user berhasil direset!', 'success');
    renderUsersView();
  } catch (err) {
    errEl.textContent = err.message;
  }
}

/* Delete User */
async function deleteUser(id, username) {
  if (!confirm(`Apakah Anda yakin ingin menghapus user "${username}"?`)) return;

  try {
    const res = await api.delete(`/api/auth/users/${id}`);
    if (!res || !res.ok) {
      const err = res ? await res.json() : {};
      throw new Error(err.error || 'Gagal menghapus user');
    }
    showToast(`User "${username}" berhasil dihapus`, 'info');
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
    btn.innerHTML = '🙈';
    btn.title = 'Sembunyikan Password';
  } else {
    input.type = 'password';
    btn.innerHTML = '👁️';
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
          sort_order: l.sort_order
        }));
        state.locations = allLocations;
      }
    }
  } catch (err) {
    console.warn('[SubCategories] Gagal memuat lokasi:', err.message);
  }
}

/* ── 20C. ZONE & SUB-CATEGORY MANAGEMENT MODAL ───────────────────────── */
let activeCatTab = 'main'; // 'main' or 'sub'
let allLocations = SEED_LOCATIONS;

async function openZonesModal() {
  const modal = $('#zones-modal');
  if (!modal) return;
  
  await loadZones();
  await loadSubCategories();
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
  if (!tbody) return;

  const isAdmin = currentUser && currentUser.role === 'admin';

  const rows = ZONES.map(z => {
    const locs = locationsByZone(z.key);
    return `
      <tr>
        <td style="font-family:var(--mono); font-weight:700; color:var(--accent)">${escapeHtml(z.key)}</td>
        <td style="font-weight:600; color:#fff">${escapeHtml(z.label)}</td>
        <td style="font-family:var(--mono); text-align:center">${z.sort_order || 0}</td>
        <td><span class="zone-badge" style="background:rgba(56,189,248,0.12); color:#38BDF8; border:1px solid rgba(56,189,248,0.25); padding:3px 8px; border-radius:12px; font-size:11.5px">${locs.length} sub-kategori</span></td>
        <td style="text-align:right">
          <div style="display:flex; justify-content:flex-end; gap:6px">
            ${isAdmin ? `<button class="action-btn-pill edit" onclick="editZone(${z.id})">✍ Edit</button>` : ''}
            ${isAdmin ? `<button class="action-btn-pill delete" onclick="deleteZone(${z.id}, '${escapeHtml(z.label)}')">🗑️ Hapus</button>` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tbody.innerHTML = rows || '<tr><td colspan="5" style="text-align:center; padding:24px; color:var(--text-muted)">Belum ada kategori gedung.</td></tr>';
}

function openAddZoneForm() {
  $('#zf-id').value = '';
  $('#zf-key').value = '';
  $('#zf-key').disabled = false;
  $('#zf-label').value = '';
  $('#zf-order').value = ZONES.length + 1;
  $('#zf-err').textContent = '';
  $('#zone-form-title').textContent = '＋ Tambah Kategori Utama';
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
  $('#zone-form-title').textContent = `✍ Edit Kategori Utama (${z.key})`;
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
    renderZonesTable();
    renderSidebar();
  } catch (err) {
    errEl.textContent = err.message;
  }
}

async function deleteZone(id, label) {
  if (!confirm(`Apakah Anda yakin ingin menghapus kategori "${label}"?`)) return;

  try {
    const res = await api.delete(`/api/devices/zones/${id}`);
    if (!res || !res.ok) {
      const err = res ? await res.json() : {};
      throw new Error(err.error || 'Gagal menghapus kategori');
    }

    showToast(`Kategori Utama "${label}" berhasil dihapus`, 'info');
    await loadZones();
    renderZonesTable();
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

  let filterOptions = '<option value="ALL">-- Semua Kategori Utama --</option>';
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
  if (!tbody) return;

  const filterZone = $('#subcat-filter-zone') ? $('#subcat-filter-zone').value : 'ALL';
  const searchQuery = $('#subcat-search-input') ? $('#subcat-search-input').value.trim().toLowerCase() : '';
  const isAdmin = currentUser && currentUser.role === 'admin';

  let list = allLocations;
  if (filterZone && filterZone !== 'ALL') {
    list = list.filter(l => l.zone === filterZone);
  }
  if (searchQuery) {
    list = list.filter(l => l.nama.toLowerCase().includes(searchQuery) || l.id.toLowerCase().includes(searchQuery));
  }

  const rows = list.map((l, idx) => {
    const parentZone = ZONES.find(z => z.key === l.zone);
    const zoneLabel = parentZone ? parentZone.label : l.zone;
    const devCount = deviceCount(l.id);

    return `
      <tr>
        <td style="font-family:var(--mono); font-size:12px; color:var(--text-muted); text-align:center; font-weight:600">${idx + 1}</td>
        <td style="font-weight:600; color:#fff">${escapeHtml(l.nama)}</td>
        <td><span class="zone-badge" style="background:rgba(56,189,248,0.12); color:#38BDF8; border:1px solid rgba(56,189,248,0.25); padding:3px 8px; border-radius:12px; font-size:11.5px">${escapeHtml(zoneLabel)}</span></td>
        <td><span class="zcount" style="background:rgba(255,255,255,0.06); color:var(--text-muted); padding:3px 8px; border-radius:10px; font-size:11px">${devCount} perangkat</span></td>
        <td style="text-align:right">
          <div style="display:flex; justify-content:flex-end; gap:6px">
            ${isAdmin ? `<button class="action-btn-pill edit" onclick="editSubCat('${l.id}')">✍ Edit</button>` : ''}
            ${isAdmin ? `<button class="action-btn-pill delete" onclick="deleteSubCat('${l.id}', '${escapeHtml(l.nama)}')">🗑️ Hapus</button>` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tbody.innerHTML = rows || '<tr><td colspan="5" style="text-align:center; padding:24px; color:var(--text-muted)">Tidak ditemukan sub-kategori yang sesuai.</td></tr>';
}

function openAddSubCatForm() {
  populateSubCatZoneFilters();
  $('#scf-id').value = '';
  $('#scf-name').value = '';
  $('#scf-zone').value = ZONES.length > 0 ? ZONES[0].key : '';
  $('#scf-err').textContent = '';
  $('#subcat-form-title').textContent = '＋ Tambah Sub-Kategori / Ruangan Baru';
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
  $('#subcat-form-title').textContent = `✍ Edit Sub-Kategori (${loc.nama})`;
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
    renderSubCategoriesTable();
    renderSidebar();
    renderTopology();
  } catch (err) {
    errEl.textContent = err.message;
  }
}

async function deleteSubCat(id, name) {
  if (!confirm(`Apakah Anda yakin ingin menghapus sub-kategori "${name}"?`)) return;

  try {
    const res = await api.delete(`/api/devices/locations/${id}`);
    if (!res || !res.ok) {
      const err = res ? await res.json() : {};
      throw new Error(err.error || 'Gagal menghapus sub-kategori');
    }

    showToast(`Sub-kategori "${name}" berhasil dihapus`, 'info');
    await loadSubCategories();
    renderSubCategoriesTable();
    renderSidebar();
    renderTopology();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

init();
