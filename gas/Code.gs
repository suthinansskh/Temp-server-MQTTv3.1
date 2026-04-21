/**
 * Sisaket Hospital IoT – Google Sheets Archive & Reporting
 * Receives data from backend via POST, generates daily/monthly reports.
 * Dashboard is served by doGet as an HTML page with live MQTT + Sheets polling.
 */

var SPREADSHEET_ID = "1DnSh2ZQLsLzNGqEMfiIeCDJEEEPrEwQEo0VSeDbB9Bo";
var LOG_BUFFER_KEY = "INGEST_BUFFER";
var LOG_FLUSH_SIZE = 1;

/**
 * Run this ONCE from the GAS editor (Run → setupScriptProperties)
 * to install the ingest API key that the backend uses to authenticate.
 * Key must match IOT_GAS_API_KEY in server/.env
 */
function setupScriptProperties() {
  PropertiesService.getScriptProperties().setProperty("INGEST_API_KEY", "ssk-iot-2026-gas");
  Logger.log("INGEST_API_KEY set successfully.");
}

var THRESHOLDS = {
  default: { min: 2.0, max: 8.0 },
  'CHEMO': { min: 2.0, max: 8.0 },
  'FREEZER': { min: -25.0, max: -15.0 }
};

function checkBreach_(temp, zone) {
  var z = (zone || "").trim().toUpperCase();
  var t = THRESHOLDS[z] || THRESHOLDS['default'];
  return (temp < t.min || temp > t.max);
}

function jsonResponse_(obj, code) {
  if (code && obj && obj.code === undefined) {
    obj.code = code;
  }
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function isAuthorizedIngest_(payload) {
  var expectedKey = PropertiesService.getScriptProperties().getProperty("INGEST_API_KEY") || "";
  if (!expectedKey) {
    // No API key configured — reject all requests (fail-closed)
    return false;
  }
  return payload && payload.api_key && payload.api_key === expectedKey;
}

function getOrCreateDataLogSheet_(ss) {
  var sheet = ss.getSheetByName("DataLog");
  if (!sheet) {
    sheet = ss.insertSheet("DataLog");
    sheet.appendRow(["Timestamp", "DeviceID", "Temperature", "DeviceName", "Zone", "IP"]);
  }
  return sheet;
}

function flushDataLogRows_(rows) {
  if (!rows || rows.length === 0) return;
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = getOrCreateDataLogSheet_(ss);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
}

function enqueueDataLogRow_(row) {
  var lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    var props = PropertiesService.getScriptProperties();
    var raw = props.getProperty(LOG_BUFFER_KEY);
    var rows = raw ? JSON.parse(raw) : [];
    rows.push(row);

    if (rows.length >= LOG_FLUSH_SIZE) {
      for (var i = 0; i < rows.length; i++) {
        rows[i][0] = new Date(rows[i][0]);
      }
      flushDataLogRows_(rows);
      props.deleteProperty(LOG_BUFFER_KEY);
    } else {
      props.setProperty(LOG_BUFFER_KEY, JSON.stringify(rows));
    }
  } finally {
    lock.releaseLock();
  }
}

function flushBufferedDataLog() {
  var lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    var props = PropertiesService.getScriptProperties();
    var raw = props.getProperty(LOG_BUFFER_KEY);
    if (!raw) return;

    var rows = JSON.parse(raw);
    for (var i = 0; i < rows.length; i++) {
      rows[i][0] = new Date(rows[i][0]);
    }
    flushDataLogRows_(rows);
    props.deleteProperty(LOG_BUFFER_KEY);
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  // If query params contain id & temp, log data from ESP device
  if (e && e.parameter && e.parameter.id && e.parameter.temp) {
    var temp = parseFloat(e.parameter.temp);
    if (isNaN(temp) || temp < -50 || temp > 100) {
      return jsonResponse_({ status: "error", message: "Invalid temperature" }, 400);
    }
    enqueueDataLogRow_([
      new Date(),
      e.parameter.id || "unknown",
      temp,
      e.parameter.name || "",
      e.parameter.zone || "",
      e.parameter.ip || ""
    ]);
    return jsonResponse_({ status: "ok" }, 200);
  }
  return HtmlService.createHtmlOutputFromFile('dashboard')
    .setTitle('Sisaket Hospital - Cold Chain Monitoring')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Return latest readings for each device (used by dashboard GAS polling).
 * Returns: { devices: [{ id, t, n, z, ts }], serverTime: epoch }
 */
function fetchLatestReadings() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var log = ss.getSheetByName("DataLog");
  if (!log || log.getLastRow() < 2) return { devices: [], serverTime: Date.now() };

  var data = log.getDataRange().getValues();
  var latest = {}; // { deviceId: { id, t, n, z, ts } }

  for (var i = 1; i < data.length; i++) {
    var id = data[i][1];
    var temp = parseFloat(data[i][2]);
    if (!id || isNaN(temp)) continue;
    var ts = data[i][0] instanceof Date ? data[i][0].getTime() : new Date(data[i][0]).getTime();
    // Keep overwriting — last row per device is the most recent
    latest[id] = { id: id, t: temp, n: data[i][3] || "", z: data[i][4] || "", ts: ts };
  }

  var result = [];
  for (var key in latest) result.push(latest[key]);
  return { devices: result, serverTime: Date.now() };
}

/**
 * Receive temperature data from backend server
 * POST JSON: { "device_id": "...", "temp": 4.5, "name": "...", "zone": "..." }
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse_({ status: "error", message: "Missing request body" }, 400);
    }

    var data = JSON.parse(e.postData.contents);
    if (!isAuthorizedIngest_(data)) {
      return jsonResponse_({ status: "error", message: "Unauthorized" }, 401);
    }

    var temp = parseFloat(data.temp);
    if (isNaN(temp) || temp < -50 || temp > 100) {
      return jsonResponse_({ status: "error", message: "Invalid temperature" }, 400);
    }

    enqueueDataLogRow_([
      new Date(),
      data.device_id || "unknown",
      temp,
      data.name || "",
      data.zone || "",
      data.ip || ""
    ]);
    return jsonResponse_({ status: "ok" }, 200);
  } catch (err) {
    return jsonResponse_({ status: "error", message: err.message }, 500);
  }
}

/**
 * Automated Monthly Clinical Report
 * Runs on the 1st of every month at 8:00 AM
 */

function setupTrigger() {
  // Clear existing triggers
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }
  // Daily summary at 23:55
  ScriptApp.newTrigger("generateDailySummary")
    .timeBased()
    .everyDays(1)
    .atHour(23)
    .nearMinute(55)
    .create();
  // Monthly summary on the 1st at 08:00
  ScriptApp.newTrigger("generateMonthlySummary")
    .timeBased()
    .onMonthDay(1)
    .atHour(8)
    .create();
  // Monthly email report on the 1st at 08:30
  ScriptApp.newTrigger("generateMonthlyReport")
    .timeBased()
    .onMonthDay(1)
    .atHour(8)
    .nearMinute(30)
    .create();
  // Flush queued ingest rows every 5 minutes
  ScriptApp.newTrigger("flushBufferedDataLog")
    .timeBased()
    .everyMinutes(5)
    .create();
}

/**
 * Daily Summary — runs at 23:55 every day
 * Aggregates today's DataLog into "DailySummary" sheet
 * Columns: Date | DeviceID | DeviceName | Zone | Min | Max | Avg | Readings | Breaches | Status
 */
function generateDailySummary() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var log = ss.getSheetByName("DataLog");
  if (!log) return;

  var sheet = ss.getSheetByName("DailySummary");
  if (!sheet) {
    sheet = ss.insertSheet("DailySummary");
    sheet.appendRow(["Date", "DeviceID", "DeviceName", "Zone", "Min", "Max", "Avg", "Readings", "Breaches", "Status"]);
    sheet.getRange("1:1").setFontWeight("bold").setBackground("#1e293b").setFontColor("#22d3ee");
    sheet.setFrozenRows(1);
  }

  var today = new Date();
  var dateStr = Utilities.formatDate(today, Session.getScriptTimeZone(), "yyyy-MM-dd");
  var data = log.getDataRange().getValues();

  var stats = {}; // { deviceId: { name, zone, min, max, sum, count, breaches } }
  for (var i = 1; i < data.length; i++) {
    var ts = new Date(data[i][0]);
    if (Utilities.formatDate(ts, Session.getScriptTimeZone(), "yyyy-MM-dd") !== dateStr) continue;

    var id = data[i][1];
    var temp = parseFloat(data[i][2]);
    var name = data[i][3] || "";
    var zone = data[i][4] || "";
    if (isNaN(temp)) continue;

    if (!stats[id]) stats[id] = { name: name, zone: zone, min: temp, max: temp, sum: 0, count: 0, breaches: 0 };
    if (name) stats[id].name = name;
    if (zone) stats[id].zone = zone;
    stats[id].min = Math.min(stats[id].min, temp);
    stats[id].max = Math.max(stats[id].max, temp);
    stats[id].sum += temp;
    stats[id].count++;
    if (checkBreach_(temp, zone)) stats[id].breaches++;
  }

  for (var id in stats) {
    var s = stats[id];
    var avg = (s.sum / s.count).toFixed(2);
    var status = s.breaches > 0 ? "ALERT" : "OK";
    sheet.appendRow([dateStr, id, s.name, s.zone, s.min, s.max, parseFloat(avg), s.count, s.breaches, status]);
  }
}

/**
 * Monthly Summary — runs on the 1st of every month
 * Aggregates previous month's DailySummary into "MonthlySummary" sheet
 * Columns: Month | DeviceID | DeviceName | Zone | Min | Max | Avg | TotalReadings | TotalBreaches | DaysActive | Status
 */
function generateMonthlySummary() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  var sheet = ss.getSheetByName("MonthlySummary");
  if (!sheet) {
    sheet = ss.insertSheet("MonthlySummary");
    sheet.appendRow(["Month", "DeviceID", "DeviceName", "Zone", "Min", "Max", "Avg", "TotalReadings", "TotalBreaches", "DaysActive", "Status"]);
    sheet.getRange("1:1").setFontWeight("bold").setBackground("#1e293b").setFontColor("#22d3ee");
    sheet.setFrozenRows(1);
  }

  // Calculate previous month
  var now = new Date();
  var lastMonth = now.getMonth() - 1;
  var year = now.getFullYear();
  if (lastMonth < 0) { lastMonth = 11; year -= 1; }
  var monthStr = Utilities.formatDate(new Date(year, lastMonth, 1), Session.getScriptTimeZone(), "yyyy-MM");

  // Try DailySummary first, fallback to DataLog
  var daily = ss.getSheetByName("DailySummary");
  var stats = {}; // { deviceId: { name, zone, min, max, sum, count, breaches, days } }

  if (daily) {
    var data = daily.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var rowDate = String(data[i][0]);
      if (!rowDate.startsWith(monthStr)) continue;

      var id = data[i][1];
      var name = data[i][2] || "";
      var zone = data[i][3] || "";
      var mn = parseFloat(data[i][4]);
      var mx = parseFloat(data[i][5]);
      var avg = parseFloat(data[i][6]);
      var readings = parseInt(data[i][7]) || 0;
      var breaches = parseInt(data[i][8]) || 0;

      if (!stats[id]) stats[id] = { name: name, zone: zone, min: mn, max: mx, sum: 0, count: 0, breaches: 0, days: 0 };
      if (name) stats[id].name = name;
      if (zone) stats[id].zone = zone;
      stats[id].min = Math.min(stats[id].min, mn);
      stats[id].max = Math.max(stats[id].max, mx);
      stats[id].sum += avg * readings;
      stats[id].count += readings;
      stats[id].breaches += breaches;
      stats[id].days++;
    }
  } else {
    // Fallback: read from DataLog directly
    var log = ss.getSheetByName("DataLog");
    if (!log) return;
    var data = log.getDataRange().getValues();
    var daysSeen = {};

    for (var i = 1; i < data.length; i++) {
      var ts = new Date(data[i][0]);
      if (ts.getMonth() !== lastMonth || ts.getFullYear() !== year) continue;

      var id = data[i][1];
      var temp = parseFloat(data[i][2]);
      if (isNaN(temp)) continue;

      if (!stats[id]) stats[id] = { name: data[i][3], zone: data[i][4], min: temp, max: temp, sum: 0, count: 0, breaches: 0, days: 0 };
      if (!daysSeen[id]) daysSeen[id] = {};

      var dayKey = Utilities.formatDate(ts, Session.getScriptTimeZone(), "yyyy-MM-dd");
      if (!daysSeen[id][dayKey]) { daysSeen[id][dayKey] = true; stats[id].days++; }

      stats[id].min = Math.min(stats[id].min, temp);
      stats[id].max = Math.max(stats[id].max, temp);
      stats[id].sum += temp;
      stats[id].count++;
      if (checkBreach_(temp, data[i][4])) stats[id].breaches++;
    }
  }

  for (var id in stats) {
    var s = stats[id];
    var avg = s.count > 0 ? (s.sum / s.count).toFixed(2) : 0;
    var status = s.breaches > 0 ? "ALERT" : "OK";
    sheet.appendRow([monthStr, id, s.name, s.zone, s.min, s.max, parseFloat(avg), s.count, s.breaches, s.days, status]);
  }
}

function generateMonthlyReport(targetEmail) {
  if (!targetEmail) {
    targetEmail = PropertiesService.getScriptProperties().getProperty("REPORT_EMAIL") || "supervisor@hospital.com";
  }
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var now = new Date();
  var lastMonth = now.getMonth() - 1;
  var year = now.getFullYear();
  if (lastMonth < 0) { lastMonth = 11; year -= 1; }
  var monthStr = Utilities.formatDate(new Date(year, lastMonth, 1), Session.getScriptTimeZone(), "yyyy-MM");
  var monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  var periodLabel = monthNames[lastMonth] + " " + year;

  // Read from MonthlySummary (preferred) or fallback to DataLog
  var devices = [];
  var monthly = ss.getSheetByName("MonthlySummary");
  if (monthly) {
    var data = monthly.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) !== monthStr) continue;
      devices.push({
        id: data[i][1], name: data[i][2] || data[i][1], zone: data[i][3] || "-",
        min: parseFloat(data[i][4]), max: parseFloat(data[i][5]), avg: parseFloat(data[i][6]),
        readings: parseInt(data[i][7]) || 0, breaches: parseInt(data[i][8]) || 0,
        days: parseInt(data[i][9]) || 0, status: data[i][10] || "OK"
      });
    }
  }
  if (devices.length === 0) {
    // Fallback: scan DataLog
    var log = ss.getSheetByName("DataLog");
    if (!log) return "No data found.";
    var data = log.getDataRange().getValues();
    var stats = {};
    var daysSeen = {};
    for (var i = 1; i < data.length; i++) {
      var ts = new Date(data[i][0]);
      if (ts.getMonth() !== lastMonth || ts.getFullYear() !== year) continue;
      var id = data[i][1];
      var temp = parseFloat(data[i][2]);
      if (isNaN(temp)) continue;
      if (!stats[id]) { stats[id] = { name: data[i][3] || id, zone: data[i][4] || "-", min: temp, max: temp, sum: 0, count: 0, breaches: 0, days: 0 }; daysSeen[id] = {}; }
      var dk = Utilities.formatDate(ts, Session.getScriptTimeZone(), "yyyy-MM-dd");
      if (!daysSeen[id][dk]) { daysSeen[id][dk] = true; stats[id].days++; }
      stats[id].min = Math.min(stats[id].min, temp);
      stats[id].max = Math.max(stats[id].max, temp);
      stats[id].sum += temp;
      stats[id].count++;
      if (checkBreach_(temp, data[i][4])) stats[id].breaches++;
    }
    for (var id in stats) {
      var s = stats[id];
      devices.push({ id: id, name: s.name, zone: s.zone, min: s.min, max: s.max, avg: parseFloat((s.sum / s.count).toFixed(2)), readings: s.count, breaches: s.breaches, days: s.days, status: s.breaches > 0 ? "ALERT" : "OK" });
    }
  }
  if (devices.length === 0) return "No data for " + periodLabel;

  // Sort by zone then name
  devices.sort(function(a, b) { return (a.zone + a.name).localeCompare(b.zone + b.name); });

  // Summary stats
  var totalDevices = devices.length;
  var totalBreaches = 0;
  var alertDevices = 0;
  for (var i = 0; i < devices.length; i++) {
    totalBreaches += devices[i].breaches;
    if (devices[i].breaches > 0) alertDevices++;
  }

  // Generate styled HTML for PDF
  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
  html += '<style>';
  html += 'body{font-family:Arial,Helvetica,sans-serif;color:#1e293b;margin:0;padding:40px}';
  html += '.header{text-align:center;margin-bottom:30px;padding-bottom:20px;border-bottom:3px solid #0891b2}';
  html += '.header h1{font-size:22px;color:#0891b2;margin:0 0 4px}';
  html += '.header h2{font-size:14px;color:#475569;font-weight:normal;margin:0 0 2px}';
  html += '.header .period{font-size:16px;color:#0f172a;font-weight:bold;margin-top:8px}';
  html += '.summary{display:flex;margin-bottom:24px}';
  html += '.summary-box{flex:1;text-align:center;padding:12px;border:1px solid #e2e8f0;border-radius:8px;margin:0 6px}';
  html += '.summary-box .num{font-size:28px;font-weight:bold}';
  html += '.summary-box .label{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px}';
  html += '.ok{color:#16a34a} .alert{color:#dc2626}';
  html += 'table{width:100%;border-collapse:collapse;font-size:11px;margin-top:16px}';
  html += 'th{background:#0f172a;color:#22d3ee;padding:10px 8px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px}';
  html += 'td{padding:8px;border-bottom:1px solid #e2e8f0}';
  html += 'tr:nth-child(even){background:#f8fafc}';
  html += '.status-ok{color:#16a34a;font-weight:bold} .status-alert{color:#dc2626;font-weight:bold}';
  html += '.footer{margin-top:30px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:9px;color:#94a3b8;text-align:center}';
  html += '.zone-tag{background:#e0f2fe;color:#0369a1;padding:2px 6px;border-radius:4px;font-size:9px;font-weight:bold}';
  html += '</style></head><body>';

  // Header
  html += '<div class="header">';
  html += '<h1>Sisaket Hospital</h1>';
  html += '<h2>Drug & Vaccine Cold Chain Monitoring</h2>';
  html += '<div class="period">Monthly Report: ' + periodLabel + '</div>';
  html += '</div>';

  // Summary boxes
  html += '<table style="margin-bottom:24px;border:none"><tr>';
  html += '<td style="text-align:center;border:1px solid #e2e8f0;border-radius:8px;padding:14px;width:33%"><div style="font-size:28px;font-weight:bold;color:#0891b2">' + totalDevices + '</div><div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px">Devices</div></td>';
  html += '<td style="text-align:center;border:1px solid #e2e8f0;border-radius:8px;padding:14px;width:33%"><div style="font-size:28px;font-weight:bold;color:' + (alertDevices > 0 ? '#dc2626' : '#16a34a') + '">' + alertDevices + '</div><div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px">Devices with Alerts</div></td>';
  html += '<td style="text-align:center;border:1px solid #e2e8f0;border-radius:8px;padding:14px;width:33%"><div style="font-size:28px;font-weight:bold;color:' + (totalBreaches > 0 ? '#dc2626' : '#16a34a') + '">' + totalBreaches + '</div><div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px">Total Excursions</div></td>';
  html += '</tr></table>';

  // Device table
  html += '<table>';
  html += '<tr><th>Device</th><th>Zone</th><th>Min &deg;C</th><th>Max &deg;C</th><th>Avg &deg;C</th><th>Readings</th><th>Days</th><th>Excursions</th><th>Status</th></tr>';
  for (var i = 0; i < devices.length; i++) {
    var d = devices[i];
    var rowBg = d.breaches > 0 ? ' style="background:#fef2f2"' : '';
    html += '<tr' + rowBg + '>';
    html += '<td><strong>' + d.name + '</strong><br><span style="font-size:9px;color:#94a3b8">' + d.id + '</span></td>';
    html += '<td><span class="zone-tag">' + d.zone + '</span></td>';
    html += '<td>' + d.min.toFixed(1) + '</td>';
    html += '<td>' + d.max.toFixed(1) + '</td>';
    html += '<td><strong>' + d.avg.toFixed(2) + '</strong></td>';
    html += '<td>' + d.readings + '</td>';
    html += '<td>' + d.days + '</td>';
    html += '<td class="' + (d.breaches > 0 ? 'status-alert' : 'status-ok') + '">' + d.breaches + '</td>';
    html += '<td class="' + (d.status === 'ALERT' ? 'status-alert' : 'status-ok') + '">' + d.status + '</td>';
    html += '</tr>';
  }
  html += '</table>';

  // Footer
  html += '<div class="footer">';
  html += 'Generated: ' + Utilities.formatDate(now, Session.getScriptTimeZone(), "dd MMM yyyy HH:mm") + ' &bull; ';
  html += 'Dynamic Cold Chain Zone Mode &bull; ';
  html += 'Sisaket Hospital IoT Monitoring System';
  html += '</div>';

  html += '</body></html>';

  var pdfBlob = Utilities.newBlob(html, "text/html", "Report.html").getAs("application/pdf");
  pdfBlob.setName("ColdChain_" + monthStr + ".pdf");

  GmailApp.sendEmail(targetEmail,
    "Cold Chain Report - " + periodLabel,
    "Monthly temperature monitoring report for " + periodLabel + " is attached.\n\n" +
    "Devices: " + totalDevices + " | Alerts: " + alertDevices + " | Excursions: " + totalBreaches,
    { attachments: [pdfBlob] }
  );

  return "Report sent to " + targetEmail;
}
