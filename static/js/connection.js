// ============================================================
// Backend Connection: WebSocket, REST API, Data Sync
// ============================================================

function applyBackendThreshold(zone, thresholds) {
  if (!zone || !thresholds) return;
  THRESHOLDS[zone.trim().toUpperCase()] = {
    min: thresholds.min,
    max: thresholds.max,
    warnMargin: thresholds.warn_margin ?? THRESHOLDS.default.warnMargin,
    label: zone
  };
}

function applyBackendDevice(device) {
  if (!device || !device.id) return;

  const zone = device.zone || device.z || 'UNASSIGNED';
  const name = device.name || device.n || device.id;
  const ip = device.ip || '';
  applyBackendThreshold(zone, device.thresholds);

  if (typeof device.last_temp_c === 'number') {
    updateUI(device.id, device.last_temp_c, ip, name, zone);
  } else {
    // No temp yet — still populate card metadata
    createDeviceCard(device.id);
    if (name) deviceNames[device.id] = name;
    if (zone) deviceZones[device.id] = zone;
    if (ip) deviceIPs[device.id] = ip;

    const card = document.getElementById(`card-${device.id}`);
    if (card) {
      const nameEl = card.querySelector('.el-name');
      const zoneEl = card.querySelector('.el-zone');
      const ipEl = card.querySelector('.el-ip');
      const idEl = card.querySelector('.el-id');
      if (nameEl && name) nameEl.textContent = name;
      if (zoneEl && zone) {
        const zoneClean = zone.trim().toUpperCase();
        zoneEl.textContent = zoneClean;
        if (zoneClean && !knownZones.has(zoneClean)) {
          knownZones.add(zoneClean);
          renderFilterBar();
        }
      }
      if (ipEl) ipEl.textContent = ip || 'No IP';
      if (idEl) idEl.textContent = device.id;
    }
  }

  if (device.last_seen_at) {
    const seenAt = Date.parse(device.last_seen_at);
    if (!Number.isNaN(seenAt)) {
      deviceStates[device.id] = seenAt;
    }
  }

  if (device.status === 'offline') {
    deviceStates[device.id] = Date.now() - CONFIG.offlineTimeout - 1000;
  }

  // Apply backend status to card immediately
  if (device.status) {
    const card = document.getElementById(`card-${device.id}`);
    if (card) {
      const ind = card.querySelector('.el-indicator');
      const timeEl = card.querySelector('.el-time');
      const valEl = card.querySelector('.el-val');
      if (device.status === 'offline') {
        ind.className = 'el-indicator flex-shrink-0 w-2.5 h-2.5 rounded-full bg-slate-700 mt-1';
        if (typeof device.last_temp_c !== 'number') {
          valEl.textContent = 'OFF';
          valEl.className = 'el-val text-slate-600 tabular-nums';
        }
        timeEl.textContent = 'OFFLINE';
        card.querySelector('.el-progress').style.width = '0%';
        card.classList.remove('ring-alert');
      } else if (device.status === 'stale') {
        ind.className = 'el-indicator flex-shrink-0 w-2.5 h-2.5 rounded-full status-stale mt-1';
        timeEl.textContent = 'STALE';
      } else if (typeof device.last_temp_c !== 'number' && device.status === 'online') {
        ind.className = 'el-indicator flex-shrink-0 w-2.5 h-2.5 rounded-full bg-cyan-500 animate-pulse mt-1';
        timeEl.textContent = 'Online (no data)';
      }
    }
  }

  // Update modal temp live if open
  if (currentModalDeviceId === device.id && typeof device.last_temp_c === 'number') {
    document.getElementById('modal-temp').textContent = device.last_temp_c.toFixed(1) + '°C';
  }
}

function loadSnapshot() {
  setConnectionBadge('Loading...', 'text-yellow-500', 'w-2 h-2 rounded-full bg-yellow-500 animate-pulse');
  document.getElementById('data-source').textContent = 'Backend API';
  return fetch(`${CONFIG.apiBase}/api/devices`, safeFetchTimeout(8000))
    .then(r => r.json())
    .then(result => {
      if (!result || !result.devices) return;
      _sortDeferred = true;
      result.devices.forEach(applyBackendDevice);
      _sortDeferred = false;
      sortGrid();
      updateStats();
    });
}

function connectRealtime() {
  const socket = new WebSocket(CONFIG.wsUrl);

  socket.addEventListener('open', () => {
    wsReconnectDelay = 1000;
    setConnectionBadge('Connected Live', 'text-cyan-400', 'w-2 h-2 rounded-full bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.8)]');
  });

  socket.addEventListener('close', () => {
    setConnectionBadge('Reconnecting...', 'text-yellow-500', 'w-2 h-2 rounded-full bg-yellow-500 animate-pulse');
    setTimeout(connectRealtime, wsReconnectDelay);
    wsReconnectDelay = Math.min(wsReconnectDelay * 2, 30000);
  });

  socket.addEventListener('error', () => {
    setConnectionBadge('Backend Error', 'text-red-500', 'w-2 h-2 rounded-full bg-red-500');
  });

  socket.addEventListener('message', event => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'snapshot' && payload.devices) {
        payload.devices.forEach(applyBackendDevice);
      }
      if ((payload.type === 'telemetry' || payload.type === 'status') && payload.device) {
        applyBackendDevice(payload.device);
      }
      if (payload.type === 'device_deleted' && payload.device_id) {
        removeDeviceFromUI(payload.device_id);
      }
      updateStats();
    } catch (error) {
      console.warn('Invalid backend event', error);
    }
  });
}

function initConnection() {
  loadSnapshot()
    .catch(() => {
      setConnectionBadge('API Unreachable', 'text-red-500', 'w-2 h-2 rounded-full bg-red-500');
    })
    .finally(() => {
      connectRealtime();
      setInterval(() => {
        loadSnapshot().catch(() => { });
      }, 30000);
    });
}

function updateUI(id, temp, ip, name, zone) {
  createDeviceCard(id);

  deviceStates[id] = Date.now();
  deviceIPs[id] = ip || '';
  if (name) deviceNames[id] = name;
  if (zone) deviceZones[id] = zone;
  deviceLastTemp[id] = temp;

  updateCardVisuals(id, temp, ip, name, zone);
}
