// ============================================================
// Configuration, Thresholds & Application State
// ============================================================

const CONFIG = {
  apiBase: window.location.origin,
  wsUrl: `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`,
  devicePageProtocol: window.location.protocol === 'https:' ? 'https://' : 'http://',
  staleTimeout: 120000,    // 2 min
  offlineTimeout: 300000   // 5 min
};

const THRESHOLDS = {
  default: { min: 2.0, max: 8.0, warnMargin: 0.5, label: 'Refrigerator' }
};

// --- Mutable state ---
let activeFilter = 'ALL';
let sortMode = 'name';
let isMonitoring = false;
let alarmMutedUntil = 0;
let currentChartRange = '1h';
let adminMode = false;
let wsReconnectDelay = 1000;

// --- Data stores ---
const knownDevices = new Set();
const knownZones = new Set();
const deviceStates = {};
const deviceIPs = {};
const deviceNames = {};
const deviceZones = {};
const deviceConfigMap = {};
const deviceLastTemp = {};

let historyChartInstance = null;
let currentModalDeviceId = null;
let _sortDeferred = false;

const originalTitle = document.title;
let titleFlashInterval = null;

const grid = document.getElementById('device-grid');

// --- Tailwind custom breakpoints ---
if (typeof tailwind !== 'undefined') {
  tailwind.config = { theme: { screens: { 'xs': '420px', 'sm': '640px', 'md': '768px', 'lg': '1024px', 'xl': '1280px' } } };
}
