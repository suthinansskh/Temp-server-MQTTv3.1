// ============================================================
// Application Init, Admin Mode, Device Management, Watchdog
// ============================================================

// --- Keyboard Shortcuts ---
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

// --- Initialization ---
function startMonitoring() {
  document.getElementById('startup-overlay').style.display = 'none';
  isMonitoring = true;
  requestNotificationPermission();
  renderFilterBar();
  initConnection();
}

// --- Alarm Acknowledgement ---
function acknowledgeAlarm() {
  alarmMutedUntil = Date.now() + (15 * 60 * 1000);
  // AlarmTone.stop();

  const btn = document.getElementById('btn-ack');
  btn.innerHTML = '🔇 MUTED (15m)';
  btn.classList.remove('hidden');
  btn.classList.replace('text-red-500', 'text-slate-500');
  btn.classList.replace('bg-red-500/20', 'bg-slate-800');
  btn.classList.replace('border-red-500/50', 'border-slate-700');
  btn.classList.remove('animate-pulse-slow');

  setTimeout(() => {
    alarmMutedUntil = 0;
    const hasCrit = document.getElementById('stat-crit').textContent !== '0';
    if (hasCrit) {
      btn.innerHTML = '🔕 MUTE ALARM (15m)';
      btn.classList.replace('text-slate-500', 'text-red-500');
      btn.classList.replace('bg-slate-800', 'bg-red-500/20');
      btn.classList.replace('border-slate-700', 'border-red-500/50');
      btn.classList.add('animate-pulse-slow');
    } else {
      btn.classList.add('hidden');
    }
  }, 15 * 60 * 1000);
}

// --- Admin Mode ---
function toggleAdminMode() {
  adminMode = !adminMode;
  const btn = document.getElementById('btn-admin');
  if (adminMode) {
    btn.classList.replace('bg-slate-800/50', 'bg-red-500/20');
    btn.classList.replace('text-slate-500', 'text-red-400');
    btn.classList.replace('border-slate-700', 'border-red-500/50');
    btn.innerHTML = '⚙ Admin ON';
  } else {
    btn.classList.replace('bg-red-500/20', 'bg-slate-800/50');
    btn.classList.replace('text-red-400', 'text-slate-500');
    btn.classList.replace('border-red-500/50', 'border-slate-700');
    btn.innerHTML = '⚙ Admin';
  }
  document.querySelectorAll('.el-delete-btn').forEach(b => b.classList.toggle('hidden', !adminMode));
  const modalDel = document.getElementById('modal-delete-btn');
  if (modalDel) modalDel.classList.toggle('hidden', !adminMode);
  const clearBtn = document.getElementById('btn-clear-offline');
  if (clearBtn) clearBtn.classList.toggle('hidden', !adminMode);
}

function clearOfflineDevices() {
  const toDelete = [];
  knownDevices.forEach(id => {
    const lastSeen = deviceStates[id] || 0;
    const isOfflineOrStale = (Date.now() - lastSeen > CONFIG.staleTimeout) || lastSeen === 0;
    if (isOfflineOrStale) toDelete.push(id);
  });

  if (toDelete.length === 0) {
    alert('No offline or stale devices to remove.');
    return;
  }

  const names = toDelete.map(id => deviceNames[id] || id).join('\n  • ');
  if (!confirm(`Remove ${toDelete.length} offline/stale device(s)?\n\n  • ${names}\n\nThis will delete ALL their telemetry history and cannot be undone.`)) return;

  let done = 0;
  let failed = 0;
  const total = toDelete.length;

  toDelete.forEach(id => {
    fetch(`${CONFIG.apiBase}/api/devices/${encodeURIComponent(id)}`, { method: 'DELETE' })
      .then(r => { if (!r.ok) throw new Error('fail'); return r.json(); })
      .then(() => { removeDeviceFromUI(id); })
      .catch(() => { failed++; })
      .finally(() => {
        done++;
        if (done === total) {
          updateStats();
          if (failed > 0) alert(`Done. ${total - failed} removed, ${failed} failed.`);
        }
      });
  });
}

function deleteDevice(id, event) {
  if (event) { event.stopPropagation(); event.preventDefault(); }
  const name = deviceNames[id] || id;
  if (!confirm(`Delete device "${name}" (${id})?\n\nThis will remove ALL telemetry history, alerts, and sync queue for this device. This cannot be undone.`)) return;
  fetch(`${CONFIG.apiBase}/api/devices/${encodeURIComponent(id)}`, { method: 'DELETE' })
    .then(r => { if (!r.ok) throw new Error('Delete failed'); return r.json(); })
    .then(() => {
      if (currentModalDeviceId === id) closeModal();
      removeDeviceFromUI(id);
      updateStats();
    })
    .catch(err => alert('Failed to delete device: ' + err.message));
}

function deleteDeviceFromModal() {
  if (!currentModalDeviceId) return;
  deleteDevice(currentModalDeviceId);
}

// --- Sensor Scan ---
function scanDeviceSensors() {
  if (!currentModalDeviceId) return;
  const id = currentModalDeviceId;
  const name = deviceNames[id] || id;
  const modal = document.getElementById('scan-modal');
  const loading = document.getElementById('scan-loading');
  const results = document.getElementById('scan-results');
  const errEl = document.getElementById('scan-error');

  document.getElementById('scan-device-label').textContent = `${name} (${id})`;
  loading.classList.remove('hidden');
  results.classList.add('hidden');
  results.innerHTML = '';
  errEl.classList.add('hidden');

  modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    modal.classList.remove('opacity-0');
    modal.querySelector('#scan-modal-content').classList.remove('scale-95');
  });

  fetch(`${CONFIG.apiBase}/api/devices/${encodeURIComponent(id)}/scan`, { signal: AbortSignal.timeout(20000) })
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(data => {
      loading.classList.add('hidden');
      results.classList.remove('hidden');
      const scan = data.scan || {};
      const pins = scan.pins || [];
      const activePin = scan.active_pin || '';
      if (pins.length === 0) {
        results.innerHTML = '<p class="text-slate-400 text-center">No pin data returned.</p>';
        return;
      }
      let html = '';
      pins.forEach(p => {
        const isActive = activePin === `GPIO${p.gpio}`;
        const found = p.found > 0;
        const borderColor = found ? (p.ok ? 'border-emerald-500/50' : 'border-red-500/50') : 'border-slate-700/50';
        const bgColor = found ? (p.ok ? 'bg-emerald-500/5' : 'bg-red-500/5') : 'bg-slate-800/30';
        const dotColor = found ? (p.ok ? 'bg-emerald-500' : 'bg-red-500') : 'bg-slate-600';
        const statusText = found ? (p.ok ? `${p.temp.toFixed(1)}°C` : 'SENSOR ERR') : 'No sensor';
        const statusColor = found ? (p.ok ? 'text-emerald-400' : 'text-red-400') : 'text-slate-500';
        const activeBadge = isActive ? '<span class="text-[9px] font-bold bg-cyan-500/20 text-cyan-400 px-2 py-0.5 rounded-full ml-2">ACTIVE</span>' : '';
        html += `<div class="flex items-center justify-between ${bgColor} ${borderColor} border rounded-xl px-4 py-3">
          <div class="flex items-center gap-3">
            <div class="w-2.5 h-2.5 rounded-full ${dotColor}"></div>
            <span class="font-bold text-sm text-slate-200">${p.pin}</span>
            <span class="text-[10px] text-slate-500">GPIO${p.gpio}</span>
            ${activeBadge}
          </div>
          <div class="flex items-center gap-3">
            <span class="text-[10px] text-slate-500">${p.found} device${p.found !== 1 ? 's' : ''}</span>
            <span class="font-bold text-sm tabular-nums ${statusColor}">${statusText}</span>
          </div>
        </div>`;
      });
      results.innerHTML = html;
    })
    .catch(err => {
      loading.classList.add('hidden');
      errEl.classList.remove('hidden');
      errEl.textContent = `Scan failed: ${err.message}`;
    });
}

function closeScanModal() {
  const modal = document.getElementById('scan-modal');
  modal.classList.add('opacity-0');
  setTimeout(() => modal.classList.add('hidden'), 300);
}

function removeDeviceFromUI(id) {
  const card = document.getElementById(`card-${id}`);
  if (card) {
    card.style.transition = 'opacity 0.3s, transform 0.3s';
    card.style.opacity = '0';
    card.style.transform = 'scale(0.9)';
    setTimeout(() => card.remove(), 300);
  }
  knownDevices.delete(id);
  delete deviceStates[id];
  delete deviceIPs[id];
  delete deviceNames[id];
  delete deviceZones[id];
  delete deviceConfigMap[id];
  delete deviceLastTemp[id];
  if (currentModalDeviceId === id) closeModal();
  renderFilterBar();
}

// --- Watchdog: check stale/offline every 5 seconds ---
setInterval(() => {
  if (!isMonitoring) return;
  const now = Date.now();
  knownDevices.forEach(id => {
    const card = document.getElementById(`card-${id}`);
    if (!card) return;
    const lastSeen = deviceStates[id] || 0;
    if (lastSeen === 0) return;

    const elapsed = now - lastSeen;
    const ind = card.querySelector('.el-indicator');

    if (elapsed > CONFIG.offlineTimeout) {
      ind.className = 'el-indicator flex-shrink-0 w-2.5 h-2.5 rounded-full bg-slate-700 mt-1';
      card.querySelector('.el-val').textContent = 'OFF';
      card.querySelector('.el-val').className = 'el-val text-slate-600 tabular-nums';
      card.querySelector('.el-time').textContent = 'OFFLINE (' + Math.round(elapsed / 60000) + 'm)';
      card.querySelector('.el-progress').style.width = '0%';
      card.classList.remove('ring-alert');
    } else if (elapsed > CONFIG.staleTimeout) {
      ind.className = 'el-indicator flex-shrink-0 w-2.5 h-2.5 rounded-full status-stale mt-1';
      card.querySelector('.el-time').textContent = 'STALE (' + Math.round(elapsed / 1000) + 's)';
    }
  });
  updateStats();
  renderFilterBar();
}, 5000);

// --- Clock ---
setInterval(() => {
  document.getElementById('clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}, 1000);
