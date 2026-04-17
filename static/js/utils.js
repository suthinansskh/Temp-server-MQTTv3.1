// ============================================================
// Utility / Helper Functions
// ============================================================

function normalizedDeviceName(id) {
  return (deviceNames[id] || id || '').trim().toUpperCase();
}

function normalizedDeviceZone(id, card) {
  const zone = deviceZones[id] || card?.querySelector('.el-zone')?.textContent || 'UNASSIGNED';
  return zone.trim().toUpperCase();
}

function physicalDeviceKey(id, card) {
  const ip = (deviceIPs[id] || '').trim();
  if (!ip || ip === '0.0.0.0') return `id:${id}`;
  return `phy:${ip}|${normalizedDeviceName(id)}|${normalizedDeviceZone(id, card)}`;
}

function isGhostDevice(id, card) {
  const zone = normalizedDeviceZone(id, card);
  const ip = (deviceIPs[id] || '').trim();
  const lastSeen = deviceStates[id] || 0;
  return zone === 'UNASSIGNED' && !ip && lastSeen > 0 && (Date.now() - lastSeen >= CONFIG.staleTimeout);
}

function getPhysicalDeviceIds() {
  const seen = new Set();
  const ids = [];
  knownDevices.forEach(id => {
    const card = document.getElementById(`card-${id}`);
    if (!card || isGhostDevice(id, card)) return;
    const key = physicalDeviceKey(id, card);
    if (seen.has(key)) return;
    seen.add(key);
    ids.push(id);
  });
  return ids;
}

function safeFetchTimeout(ms) {
  if (typeof AbortSignal.timeout === 'function') return { signal: AbortSignal.timeout(ms) };
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal };
}

// --- Notifications ---
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function sendNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body, tag: 'cold-chain-alert' }); } catch (e) { }
  }
}

// --- Title flash ---
function startTitleFlash(msg) {
  if (titleFlashInterval) return;
  let show = true;
  titleFlashInterval = setInterval(() => {
    document.title = show ? msg : originalTitle;
    show = !show;
  }, 1000);
}

function stopTitleFlash() {
  if (titleFlashInterval) {
    clearInterval(titleFlashInterval);
    titleFlashInterval = null;
    document.title = originalTitle;
  }
}
