// ============================================================
// Chart Modal & Rendering
// ============================================================

function openDeviceModal(id) {
  currentModalDeviceId = id;
  currentChartRange = '1h';
  const modal = document.getElementById('chart-modal');
  const inner = document.getElementById('chart-modal-content');
  const card = document.getElementById(`card-${id}`);
  if (!card) return;

  document.getElementById('modal-title').textContent = card.querySelector('.el-name').textContent;
  document.getElementById('modal-subtitle').textContent = `Device ID: ${id} | IP: ${deviceIPs[id] || 'Unknown'}`;

  // Detail stats
  const temp = deviceLastTemp[id];
  document.getElementById('modal-temp').textContent = temp !== undefined ? temp.toFixed(1) + '°C' : '--°C';
  document.getElementById('modal-min').textContent = '--°C';
  document.getElementById('modal-max').textContent = '--°C';

  const zoneClean = (deviceZones[id] || '').trim().toUpperCase();
  const configKey = THRESHOLDS[zoneClean] ? zoneClean : 'default';
  const threshold = THRESHOLDS[configKey];
  document.getElementById('modal-zone').textContent = zoneClean || 'DEFAULT';
  document.getElementById('modal-range').textContent = `${threshold.min}°C ~ ${threshold.max}°C`;

  // Status badge
  const indicatorColor = card.querySelector('.el-indicator').className;
  const badge = document.getElementById('modal-status-badge');
  badge.className = `px-2 py-0.5 text-[10px] font-bold uppercase rounded-full border ${indicatorColor.includes('status-crit') ? 'bg-red-500/20 text-red-500 border-red-500' :
      indicatorColor.includes('status-warn') ? 'bg-yellow-500/20 text-yellow-500 border-yellow-500' :
        indicatorColor.includes('status-stale') ? 'bg-orange-500/20 text-orange-500 border-orange-500' :
          indicatorColor.includes('bg-slate-700') ? 'bg-slate-500/20 text-slate-400 border-slate-500' :
            'bg-green-500/20 text-green-500 border-green-500'
    }`;
  badge.textContent = indicatorColor.includes('status-crit') ? 'CRITICAL' :
    indicatorColor.includes('status-warn') ? 'WARNING' :
      indicatorColor.includes('status-stale') ? 'STALE' :
        indicatorColor.includes('bg-slate-700') ? 'OFFLINE' : 'ONLINE';

  updateRangeBar('1h');

  modal.classList.remove('hidden');
  setTimeout(() => {
    modal.classList.remove('opacity-0');
    inner.classList.remove('scale-95');
  }, 10);

  fetchChartFromServer(id, '1h');

  // Sync admin delete button visibility
  const modalDel = document.getElementById('modal-delete-btn');
  if (modalDel) modalDel.classList.toggle('hidden', !adminMode);
}

function closeModal() {
  const modal = document.getElementById('chart-modal');
  const inner = document.getElementById('chart-modal-content');

  modal.classList.add('opacity-0');
  inner.classList.add('scale-95');
  currentModalDeviceId = null;

  setTimeout(() => {
    modal.classList.add('hidden');
  }, 300);
}

function openDeviceWindow() {
  if (currentModalDeviceId) {
    window.open(`${CONFIG.apiBase}/device.html?id=${encodeURIComponent(currentModalDeviceId)}`, '_blank', 'noopener,noreferrer');
  }
}

// --- Chart Range ---
function updateRangeBar(active) {
  document.querySelectorAll('.chart-range-btn').forEach(btn => {
    const isActive = btn.textContent.trim().toLowerCase() === active;
    btn.className = `chart-range-btn px-3 py-1 rounded-lg text-xs font-bold border transition-colors ${isActive ? 'bg-cyan-600/20 text-cyan-400 border-cyan-500/30' : 'bg-slate-700/50 text-slate-400 border-transparent hover:bg-slate-700'
      }`;
  });
}

function setChartRange(range) {
  if (!currentModalDeviceId) return;
  currentChartRange = range;
  updateRangeBar(range);
  fetchChartFromServer(currentModalDeviceId, range);
}

function fetchChartFromServer(id, range) {
  const loadingEl = document.getElementById('chart-loading');
  loadingEl.classList.remove('hidden');

  fetch(`${CONFIG.apiBase}/api/devices/${encodeURIComponent(id)}/telemetry?range=${range}`, safeFetchTimeout(8000))
    .then(r => r.json())
    .then(data => {
      loadingEl.classList.add('hidden');
      if (data && data.points) {
        renderChartWithTelemetry(id, data.points);
        // Update min/max from server data
        const temps = data.points.map(p => p.temp_c).filter(t => typeof t === 'number');
        if (temps.length) {
          document.getElementById('modal-min').textContent = Math.min(...temps).toFixed(1) + '°C';
          document.getElementById('modal-max').textContent = Math.max(...temps).toFixed(1) + '°C';
        }
      }
    })
    .catch(() => {
      loadingEl.classList.add('hidden');
    });
}

function renderChartWithTelemetry(id, points) {
  const ctx = document.getElementById('historyChart').getContext('2d');
  const configKey = deviceConfigMap[id] || 'default';
  const threshold = THRESHOLDS[configKey] || THRESHOLDS.default;

  if (historyChartInstance) historyChartInstance.destroy();

  const labels = points.map(point => {
    const timestamp = new Date(point.ts_server);
    return timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  });
  const rawData = points.map(point => point.temp_c);

  historyChartInstance = buildChart(ctx, labels, rawData, threshold);
}

function buildChart(ctx, labels, dataPoints, threshold) {
  const minLine = new Array(labels.length).fill(threshold.min);
  const maxLine = new Array(labels.length).fill(threshold.max);

  let dataMin = dataPoints.length ? Math.min(...dataPoints) : threshold.min;
  let dataMax = dataPoints.length ? Math.max(...dataPoints) : threshold.max;
  const yMin = Math.min(dataMin, threshold.min) - 3;
  const yMax = Math.max(dataMax, threshold.max) + 3;

  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Temperature °C',
          data: dataPoints,
          borderColor: '#06b6d4',
          backgroundColor: 'rgba(6, 182, 212, 0.1)',
          borderWidth: 2,
          pointRadius: dataPoints.length > 30 ? 0 : 3,
          pointBackgroundColor: '#06b6d4',
          fill: true,
          tension: 0.4
        },
        {
          label: `Min Safe (${threshold.min}°C)`,
          data: minLine,
          borderColor: '#ef444480',
          borderWidth: 1,
          borderDash: [5, 5],
          pointRadius: 0,
          fill: false
        },
        {
          label: `Max Safe (${threshold.max}°C)`,
          data: maxLine,
          borderColor: '#ef444480',
          borderWidth: 1,
          borderDash: [5, 5],
          pointRadius: 0,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index',
          intersect: false,
          backgroundColor: 'rgba(15, 23, 42, 0.9)',
          titleColor: '#94a3b8',
          bodyColor: '#fff',
          borderColor: '#334155',
          borderWidth: 1,
          filter: (item) => item.datasetIndex === 0
        }
      },
      scales: {
        y: {
          grid: { color: '#334155', drawBorder: false },
          ticks: { color: '#94a3b8' },
          min: yMin,
          max: yMax
        },
        x: {
          grid: { display: false },
          ticks: { color: '#94a3b8', maxTicksLimit: 8 }
        }
      }
    }
  });
}
