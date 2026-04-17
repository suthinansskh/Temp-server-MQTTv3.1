// ============================================================
// UI: Device Cards, Sort, Filter, Search, Stats
// ============================================================

// --- Device Card Creation ---
function createDeviceCard(id, skipSetAdd) {
  if (!skipSetAdd) {
    if (knownDevices.has(id)) return;
    knownDevices.add(id);
  }

  if (document.getElementById(`card-${id}`)) return;

  const card = document.createElement('div');
  card.id = `card-${id}`;
  card.dataset.deviceId = id;
  card.onclick = () => openDeviceModal(id);
  card.title = 'Click to view History & Details';
  card.className = 'glass p-4 rounded-3xl transition-all duration-300 hover:scale-[1.03] group border-transparent hover:border-cyan-500/50 cursor-pointer relative overflow-hidden card-enter';

  card.innerHTML = `
    <button class="el-delete-btn hidden absolute top-1 left-1 z-20 bg-red-500/80 hover:bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold shadow-lg transition-all hover:scale-110" title="Delete device">✕</button>
    <div class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-cyan-500/20 p-1 rounded-full">
       <svg class="w-2.5 h-2.5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path></svg>
    </div>
    <div class="flex justify-between items-start mb-2">
      <div class="flex flex-col truncate pr-2">
        <span class="text-[14px] font-bold text-slate-200 uppercase leading-tight el-name truncate w-24 sm:w-32">--</span>
        <span class="text-[9px] text-slate-500 tracking-wider el-id truncate">--</span>
      </div>
      <div class="el-indicator flex-shrink-0 w-2.5 h-2.5 rounded-full bg-slate-600 border border-slate-900 mt-1"></div>
    </div>
    <div class="flex items-center gap-1.5 mb-2">
      <span class="el-zone bg-slate-700/50 text-slate-400 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-widest max-w-full truncate">--</span>
      <span class="el-zone-range text-[8px] text-slate-600 font-mono"></span>
    </div>
    <div class="text-3xl font-light mb-1 mt-3 flex items-baseline leading-none">
        <span class="el-val text-slate-400 tabular-nums">--</span>
        <span class="text-sm ml-1 text-slate-600">°C</span>
    </div>
    <div class="flex gap-3 mt-1 mb-2">
      <span class="text-[9px] text-blue-400/60 font-mono el-min-max"></span>
    </div>
    <div class="w-full bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden relative">
        <div class="absolute inset-y-0 bg-white/10 z-0 el-safezone"></div>
        <div class="el-progress relative z-10 h-full bg-cyan-500 transition-all duration-1000 shadow-[0_0_8px_rgba(6,182,212,0.5)]" style="width: 0%"></div>
    </div>
    <div class="flex justify-between items-end mt-3 border-t border-slate-700/50 pt-2">
      <div class="text-[8px] text-slate-500/70 el-time leading-tight font-mono">Connecting...</div>
      <div class="text-[8px] font-mono text-cyan-600/40 el-ip">0.0.0.0</div>
    </div>`;

  card.querySelector('.el-id').textContent = id;
  card.querySelector('.el-delete-btn').addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); deleteDevice(id, e); });
  grid.appendChild(card);
  sortGrid();
}

// --- Sort ---
function setSortMode(mode) {
  sortMode = mode;
  document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`sort-${mode}`).classList.add('active');
  sortGrid();
}

function getStatusPriority(card) {
  const ind = card.querySelector('.el-indicator');
  if (ind.classList.contains('status-crit')) return 0;
  if (ind.classList.contains('status-warn')) return 1;
  if (ind.classList.contains('status-stale')) return 2;
  if (ind.classList.contains('status-ok')) return 3;
  return 4;
}

function sortGrid() {
  if (_sortDeferred) return;
  const cards = Array.from(grid.children);
  cards.sort((a, b) => {
    if (sortMode === 'name') {
      const nameA = a.querySelector('.el-name').textContent.toUpperCase();
      const nameB = b.querySelector('.el-name').textContent.toUpperCase();
      return nameA.localeCompare(nameB);
    } else if (sortMode === 'temp') {
      const tA = parseFloat(a.querySelector('.el-val').textContent) || -999;
      const tB = parseFloat(b.querySelector('.el-val').textContent) || -999;
      return tB - tA;
    } else if (sortMode === 'status') {
      return getStatusPriority(a) - getStatusPriority(b);
    }
    return 0;
  });
  cards.forEach(card => grid.appendChild(card));
}

// --- Filter ---
function renderFilterBar() {
  const bar = document.getElementById('filter-bar');
  bar.innerHTML = '';

  const zoneCounts = {};
  const physicalIds = getPhysicalDeviceIds();
  physicalIds.forEach(id => {
    const z = normalizedDeviceZone(id);
    zoneCounts[z] = (zoneCounts[z] || 0) + 1;
  });

  const zones = ['ALL', ...Array.from(knownZones).sort()];

  zones.forEach(z => {
    const btn = document.createElement('button');
    btn.onclick = () => filterZone(z);
    const count = z === 'ALL' ? physicalIds.length : (zoneCounts[z] || 0);
    btn.innerHTML = `${z} <span class="ml-1 text-[9px] opacity-60">${count}</span>`;
    btn.className = `btn-filter px-4 py-1.5 rounded-xl text-xs font-bold border transition-colors ${activeFilter === z
        ? 'bg-cyan-600/20 text-cyan-400 border-cyan-500/30'
        : 'bg-slate-700/50 text-slate-400 border-transparent hover:bg-slate-700'
      }`;
    bar.appendChild(btn);
  });
}

function filterZone(zone) {
  activeFilter = zone.toUpperCase();
  renderFilterBar();

  knownDevices.forEach(id => {
    const card = document.getElementById(`card-${id}`);
    if (!card) return;
    const cardZone = card.querySelector('.el-zone').textContent.toUpperCase();
    if (activeFilter === 'ALL' || cardZone === activeFilter) {
      card.classList.remove('hidden');
    } else {
      card.classList.add('hidden');
    }
  });
}

// --- Search ---
function handleSearch() {
  const query = document.getElementById('search-box').value.toUpperCase();
  knownDevices.forEach(id => {
    const card = document.getElementById(`card-${id}`);
    if (!card) return;
    const name = card.querySelector('.el-name').textContent.toUpperCase();
    const actualId = id.toUpperCase();
    const zone = card.querySelector('.el-zone').textContent.toUpperCase();
    const isMatch = name.includes(query) || actualId.includes(query) || zone.includes(query);
    const isZoneMatch = activeFilter === 'ALL' || card.querySelector('.el-zone').textContent === activeFilter;

    if (isMatch && isZoneMatch) {
      card.classList.remove('hidden');
    } else {
      card.classList.add('hidden');
    }
  });
}

// --- Card Visuals Update ---
function updateCardVisuals(id, temp, ip, name, zone) {
  const card = document.getElementById(`card-${id}`);
  if (!card) return;

  const zoneClean = zone ? zone.trim().toUpperCase() : '';
  const configKey = THRESHOLDS[zoneClean] ? zoneClean : 'default';
  deviceConfigMap[id] = configKey;
  const threshold = THRESHOLDS[configKey];

  const valEl = card.querySelector('.el-val');
  const ipEl = card.querySelector('.el-ip');
  const nameEl = card.querySelector('.el-name');
  const zoneEl = card.querySelector('.el-zone');
  const zoneRangeEl = card.querySelector('.el-zone-range');
  const timeEl = card.querySelector('.el-time');
  const indEl = card.querySelector('.el-indicator');
  const progEl = card.querySelector('.el-progress');
  const safeZoneEl = card.querySelector('.el-safezone');
  const minMaxEl = card.querySelector('.el-min-max');

  valEl.textContent = temp.toFixed(1);
  valEl.className = 'el-val text-white tabular-nums';
  ipEl.textContent = ip || 'No IP';

  if (name && nameEl.textContent !== name) {
    nameEl.textContent = name;
    sortGrid();
  }
  if (zoneClean && zoneEl.textContent !== zoneClean) {
    zoneEl.textContent = zoneClean;
    zoneRangeEl.textContent = `(${threshold.min}~${threshold.max}°C)`;
  }

  if (zoneClean && !knownZones.has(zoneClean)) {
    knownZones.add(zoneClean);
    renderFilterBar();
  }

  if (activeFilter !== 'ALL' && zoneClean !== activeFilter) {
    card.classList.add('hidden');
  } else {
    card.classList.remove('hidden');
  }

  // Dynamic Cold Chain Scale
  const scaleMin = threshold.min - 5;
  const scaleMax = threshold.max + 5;
  const safeZoneLeft = Math.max(0, ((threshold.min - scaleMin) / (scaleMax - scaleMin)) * 100);
  const safeZoneWidth = Math.min(100, ((threshold.max - threshold.min) / (scaleMax - scaleMin)) * 100);

  safeZoneEl.style.left = `${safeZoneLeft}%`;
  safeZoneEl.style.width = `${safeZoneWidth}%`;

  let percent = ((temp - scaleMin) / (scaleMax - scaleMin)) * 100;
  progEl.style.width = Math.min(Math.max(percent, 0), 100) + '%';

  // Status Color
  let isSafe = (temp >= threshold.min && temp <= threshold.max);

  let newClass = 'el-indicator flex-shrink-0 w-2.5 h-2.5 rounded-full mt-1 ';
  if (isSafe) {
    if ((temp < threshold.min + threshold.warnMargin) || (temp > threshold.max - threshold.warnMargin)) {
      newClass += 'status-warn';
      progEl.className = 'el-progress relative z-10 h-full bg-yellow-400 transition-all duration-1000 shadow-[0_0_8px_rgba(250,204,21,0.5)]';
    } else {
      newClass += 'status-ok';
      progEl.className = 'el-progress relative z-10 h-full bg-green-500 transition-all duration-1000 shadow-[0_0_8px_rgba(34,197,94,0.5)]';
    }
    card.classList.remove('ring-alert');
  } else {
    newClass += 'status-crit';
    progEl.className = 'el-progress relative z-10 h-full bg-red-500 transition-all duration-1000 shadow-[0_0_12px_rgba(239,68,68,0.8)]';
    card.classList.add('ring-alert');
  }

  indEl.className = newClass;
  timeEl.textContent = new Date().toLocaleTimeString();
}

// --- Connection Badge ---
function setConnectionBadge(label, colorClass, indicatorClass) {
  const statusEl = document.getElementById('mqtt-status');
  const indicatorEl = document.getElementById('mqtt-indicator');
  statusEl.textContent = label;
  statusEl.className = `text-xs font-semibold ${colorClass} uppercase`;
  indicatorEl.className = indicatorClass;
}

// --- Statistics & Alarm Logic ---
function updateStats() {
  let online = 0, warn = 0, crit = 0, stale = 0, offline = 0;
  const now = Date.now();
  const physicalIds = getPhysicalDeviceIds();

  physicalIds.forEach(id => {
    const lastSeen = deviceStates[id] || 0;
    const card = document.getElementById(`card-${id}`);
    if (!card) return;
    const ind = card.querySelector('.el-indicator');

    if (lastSeen === 0 || now - lastSeen >= CONFIG.offlineTimeout) {
      offline++;
    } else if (now - lastSeen >= CONFIG.staleTimeout) {
      stale++;
    } else {
      online++;
      if (ind.classList.contains('status-warn')) warn++;
      if (ind.classList.contains('status-crit')) crit++;
    }
  });

  document.getElementById('stat-total').textContent = physicalIds.length;
  document.getElementById('stat-online').textContent = online;
  document.getElementById('stat-warn').textContent = warn;
  document.getElementById('stat-crit').textContent = crit;
  document.getElementById('stat-offline').textContent = stale + offline;

  const critBox = document.getElementById('stat-crit-box');
  if (crit > 0) {
    critBox.classList.add('bg-red-500/10', 'border-red-500');
    critBox.classList.remove('glass');
  } else {
    critBox.classList.remove('bg-red-500/10', 'border-red-500');
    critBox.classList.add('glass');
  }

  // Alarm logic
  const btnAck = document.getElementById('btn-ack');
  const ackDivider = document.getElementById('ack-divider');

  if (crit > 0) {
    startTitleFlash(`🚨 ${crit} CRITICAL - Cold Chain Alert!`);

    if (now > alarmMutedUntil) {
      if (isMonitoring) {
        sendNotification('Cold Chain CRITICAL', `${crit} device(s) out of safe temperature range!`);
      }
      btnAck.classList.remove('hidden');
      btnAck.classList.replace('text-slate-500', 'text-red-500');
      btnAck.classList.replace('bg-slate-800', 'bg-red-500/20');
      btnAck.classList.replace('border-slate-700', 'border-red-500/50');
      btnAck.classList.add('animate-pulse-slow');
      btnAck.innerHTML = '🔕 MUTE ALARM (15m)';
      ackDivider.classList.remove('hidden');
    }
  } else {
    stopTitleFlash();
    if (now > alarmMutedUntil) {
      btnAck.classList.add('hidden');
      ackDivider.classList.add('hidden');
    }
  }
}
