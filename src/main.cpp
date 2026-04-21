#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <WiFiClientSecure.h>
#include <ESP8266HTTPClient.h>
#include <ArduinoOTA.h>
#include <ESP8266httpUpdate.h>
#include <ESP8266WebServer.h>
#include <LittleFS.h>
#include <PubSubClient.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <WiFiManager.h>

/**
 * Sisaket Hospital IoT Firmware v7.0.0 — HiveMQ Cloud Edition
 * Lightweight Cold Chain Sensor Node
 *
 * - WiFiManager for zero-touch WiFi provisioning
 * - HiveMQ Cloud (TLS 8883) for real-time MQTT
 * - Google Sheets (HTTPS) for long-term database logging
 * - ArduinoOTA for wireless firmware updates
 * - HTTP OTA: auto-check for firmware updates
 * - Web Config: http://<device-ip>/ for settings
 * - Topic: factory/{zone}/temp/{device_name}
 */

// --- PROTOTYPES ---
void reconnect();
void sendToGoogleSheets(float temp);
void setupOTA();
void checkHttpOTA();
int scanSensorPin();
void initSensor(int pin);
void loadConfig();
void saveConfig();
void setupWebServer();
void handleRoot();
void handleSave();
void handleReboot();
void handleApi();
void handleUpdate();
void handleSendIP();

// --- CONFIGURABLE SETTINGS (saved to LittleFS) ---
char cfg_mqtt_server[80] = "4bdec66bf5984176a4d9eba86f41c7e9.s1.eu.hivemq.cloud";
char cfg_mqtt_port[6]    = "8883";
char cfg_mqtt_user[40]   = "admin";
char cfg_mqtt_pass[40]   = "Admin10700";
char cfg_device_name[40] = "MED-FRIDGE-01";
char cfg_device_zone[20] = "zone-A";
char cfg_sheets_id[80]   = "AKfycbywcMpt8qnaSsNrstUir05ZpFrSK7UHMLBwg9qUz8mfwH9S-tYfGoDtPCDLhujPfAGeSQ";
char cfg_ota_url[160]    = "http://14.11.0.85/Drug/AutoPrint/IOT/firmware.bin";

// --- TIMING CONFIG ---
const unsigned long MQTT_INTERVAL   = 10000;    // 10 seconds — Dashboard real-time
const unsigned long SHEETS_INTERVAL = 1200000;  // 20 minutes — Google Sheets database
const unsigned long OTA_CHECK_INTERVAL = 300000; // 5 minutes — HTTP OTA check

// --- HTTP OTA CONFIG ---
const char* FW_VERSION = "7.1.1";

// --- HARDWARE SETUP ---
// Pin mapping: D1=5, D2=4, D3=0, D4=2, D5=14, D6=12, D7=13
const int SCAN_PINS[] = {5, 4, 0, 2, 14, 12, 13};
const char* SCAN_LABELS[] = {"D1", "D2", "D3", "D4", "D5", "D6", "D7"};
const int SCAN_COUNT = 7;

OneWire* oneWire = nullptr;
DallasTemperature* sensors = nullptr;
int activeSensorPin = -1;
float lastTemp = -127.0;
bool sensorOk = false;

// --- NETWORK ---
WiFiClientSecure espClient;
PubSubClient mqttClient(espClient);
ESP8266WebServer webServer(80);

char topic[80];
char clientId[30];
unsigned long lastMqttMsg = 0;
unsigned long lastSheetsMsg = 0;
unsigned long lastOtaCheck = 0;

int scanSensorPin() {
  Serial.println("Scanning D1-D7 for DS18B20 sensor...");
  for (int i = 0; i < SCAN_COUNT; i++) {
    OneWire ow(SCAN_PINS[i]);
    DallasTemperature ds(&ow);
    ds.begin();
    if (ds.getDeviceCount() > 0) {
      Serial.printf("  Found sensor on %s (GPIO%d)\n", SCAN_LABELS[i], SCAN_PINS[i]);
      return SCAN_PINS[i];
    }
  }
  Serial.println("  No sensor found! Defaulting to D2 (GPIO4)");
  return 4;
}

void initSensor(int pin) {
  if (sensors) { delete sensors; sensors = nullptr; }
  if (oneWire) { delete oneWire; oneWire = nullptr; }
  oneWire = new OneWire(pin);
  sensors = new DallasTemperature(oneWire);
  sensors->begin();
  activeSensorPin = pin;
}

// --- CONFIG PERSISTENCE (LittleFS) ---
void loadConfig() {
  if (!LittleFS.exists("/config.txt")) return;
  File f = LittleFS.open("/config.txt", "r");
  if (!f) return;
  auto readLine = [&](char* buf, size_t sz) {
    String line = f.readStringUntil('\n');
    line.trim();
    if (line.length() > 0) strncpy(buf, line.c_str(), sz - 1);
  };
  readLine(cfg_mqtt_server, sizeof(cfg_mqtt_server));
  readLine(cfg_mqtt_port, sizeof(cfg_mqtt_port));
  readLine(cfg_mqtt_user, sizeof(cfg_mqtt_user));
  readLine(cfg_mqtt_pass, sizeof(cfg_mqtt_pass));
  readLine(cfg_device_name, sizeof(cfg_device_name));
  readLine(cfg_device_zone, sizeof(cfg_device_zone));
  readLine(cfg_sheets_id, sizeof(cfg_sheets_id));
  readLine(cfg_ota_url, sizeof(cfg_ota_url));
  f.close();
  Serial.println("Config loaded from LittleFS");
}

void saveConfig() {
  File f = LittleFS.open("/config.txt", "w");
  if (!f) { Serial.println("Failed to save config!"); return; }
  f.println(cfg_mqtt_server);
  f.println(cfg_mqtt_port);
  f.println(cfg_mqtt_user);
  f.println(cfg_mqtt_pass);
  f.println(cfg_device_name);
  f.println(cfg_device_zone);
  f.println(cfg_sheets_id);
  f.println(cfg_ota_url);
  f.close();
  Serial.println("Config saved to LittleFS");
}

void applyConfig() {
  snprintf(topic, 80, "factory/%s/temp/%s", cfg_device_zone, cfg_device_name);
  espClient.setInsecure();
  int port = atoi(cfg_mqtt_port);
  if (port <= 0 || port > 65535) port = 8883;
  mqttClient.setServer(cfg_mqtt_server, port);
  mqttClient.setKeepAlive(60);
}

// --- WEB CONFIG SERVER ---
String htmlEscape(const String& s) {
  String o; o.reserve(s.length() + 8);
  for (unsigned int i = 0; i < s.length(); i++) {
    char c = s[i];
    if (c == '&') o += "&amp;"; else if (c == '<') o += "&lt;";
    else if (c == '>') o += "&gt;"; else if (c == '"') o += "&quot;";
    else o += c;
  }
  return o;
}

void handleRoot() {
  float t = lastTemp;
  bool ok = sensorOk;
  String tempColor = ok ? ((t >= 2.0 && t <= 8.0) ? "#22d3ee" : "#ef4444") : "#ef4444";
  String pinLabel = "?";
  for (int i = 0; i < SCAN_COUNT; i++) {
    if (SCAN_PINS[i] == activeSensorPin) { pinLabel = SCAN_LABELS[i]; break; }
  }

  webServer.setContentLength(CONTENT_LENGTH_UNKNOWN);
  webServer.send(200, "text/html", "");
  webServer.sendContent(F(
    "<!DOCTYPE html><html><head><meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>ESP Config</title><style>"
    "*{box-sizing:border-box;margin:0;padding:0}"
    "body{font-family:system-ui,sans-serif;background:#0f172a;color:#f8fafc;padding:16px}"
    ".c{max-width:480px;margin:0 auto}"
    ".card{background:rgba(30,41,59,.7);border:1px solid rgba(255,255,255,.08);"
    "border-radius:16px;padding:20px;margin-bottom:12px}"
    ".h{font-size:1.2rem;font-weight:700;background:linear-gradient(135deg,#22d3ee,#3b82f6);"
    "-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:12px}"
    ".big{font-size:3rem;font-weight:300;text-align:center;margin:8px 0}"
    ".row{display:flex;justify-content:space-between;padding:4px 0;"
    "border-bottom:1px solid rgba(255,255,255,.04);font-size:.8rem}"
    ".row:last-child{border:none}.lbl{color:#64748b}.val{color:#cbd5e1;font-weight:600;font-family:monospace}"
    "label{display:block;font-size:.65rem;font-weight:600;color:#64748b;"
    "text-transform:uppercase;letter-spacing:.05em;margin:10px 0 4px}"
    "input,select{width:100%;padding:10px;background:#0f172a;border:1px solid #334155;"
    "border-radius:10px;color:#f1f5f9;font-size:.85rem;font-family:inherit}"
    "input:focus{border-color:#22d3ee;outline:none}"
    ".g2{display:grid;grid-template-columns:1fr 1fr;gap:10px}"
    ".btn{display:block;width:100%;padding:12px;border:none;border-radius:12px;"
    "font-size:.85rem;font-weight:700;cursor:pointer;text-align:center;margin-top:10px}"
    ".btn-s{background:linear-gradient(135deg,#22d3ee,#06b6d4);color:#0f172a}"
    ".btn-r{background:#1e293b;color:#f87171;border:1px solid #7f1d1d}"
    ".ok{color:#22c55e}.err{color:#ef4444}"
    "</style></head><body><div class='c'>"));

  // Status card
  webServer.sendContent(F("<div class='card'><div class='h'>"));
  webServer.sendContent(htmlEscape(cfg_device_name));
  webServer.sendContent(F("</div><div class='big' style='color:"));
  webServer.sendContent(tempColor);
  webServer.sendContent(F("'>"));
  if (ok) { webServer.sendContent(String(t, 1)); webServer.sendContent(F("&deg;C")); }
  else webServer.sendContent(F("---"));
  webServer.sendContent(F("</div><div class='row'><span class='lbl'>Zone</span><span class='val'>"));
  webServer.sendContent(htmlEscape(cfg_device_zone));
  webServer.sendContent(F("</span></div><div class='row'><span class='lbl'>Sensor</span><span class='val'>"));
  webServer.sendContent(pinLabel + " (GPIO" + String(activeSensorPin) + ")");
  webServer.sendContent(F("</span></div><div class='row'><span class='lbl'>MQTT</span><span class='val'>"));
  webServer.sendContent(mqttClient.connected() ? F("<span class='ok'>Connected</span>") : F("<span class='err'>Offline</span>"));
  webServer.sendContent(F("</span></div><div class='row'><span class='lbl'>IP</span><span class='val'>"));
  webServer.sendContent(WiFi.localIP().toString());
  webServer.sendContent(F("</span></div><div class='row'><span class='lbl'>RSSI</span><span class='val'>"));
  webServer.sendContent(String(WiFi.RSSI()) + " dBm");
  webServer.sendContent(F("</span></div><div class='row'><span class='lbl'>Client ID</span><span class='val'>"));
  webServer.sendContent(clientId);
  webServer.sendContent(F("</span></div><div class='row'><span class='lbl'>Firmware</span><span class='val'>"));
  webServer.sendContent(FW_VERSION);
  webServer.sendContent(F("</span></div></div>"));

  // Config form
  webServer.sendContent(F("<form method='POST' action='/save'><div class='card'><div class='h'>Device</div>"));
  webServer.sendContent(F("<label>Device Name</label><input name='name' value='")); webServer.sendContent(htmlEscape(cfg_device_name)); webServer.sendContent(F("'>"));
  webServer.sendContent(F("<label>Zone</label><input name='zone' value='")); webServer.sendContent(htmlEscape(cfg_device_zone)); webServer.sendContent(F("'>"));
  webServer.sendContent(F("</div><div class='card'><div class='h'>MQTT Broker</div>"));
  webServer.sendContent(F("<label>Server</label><input name='srv' value='")); webServer.sendContent(htmlEscape(cfg_mqtt_server)); webServer.sendContent(F("'>"));
  webServer.sendContent(F("<div class='g2'><div><label>Port</label><input name='port' value='")); webServer.sendContent(htmlEscape(cfg_mqtt_port)); webServer.sendContent(F("'></div>"));
  webServer.sendContent(F("<div><label>Username</label><input name='user' value='")); webServer.sendContent(htmlEscape(cfg_mqtt_user)); webServer.sendContent(F("'></div></div>"));
  webServer.sendContent(F("<label>Password</label><input type='password' name='pass' placeholder='unchanged'>"));
  webServer.sendContent(F("</div><div class='card'><div class='h'>Google Sheets</div>"));
  webServer.sendContent(F("<label>Script ID</label><input name='sheets' value='")); webServer.sendContent(htmlEscape(cfg_sheets_id)); webServer.sendContent(F("'>"));
  webServer.sendContent(F("</div><div class='card'><div class='h'>Firmware Update</div>"));
  webServer.sendContent(F("<label>Firmware URL (.bin)</label><input name='ota' value='")); webServer.sendContent(htmlEscape(cfg_ota_url)); webServer.sendContent(F("'>"));
  webServer.sendContent(F("<div class='row' style='margin-top:6px'><span class='lbl'>Current Version</span><span class='val'>")); webServer.sendContent(FW_VERSION); webServer.sendContent(F("</span></div>"));
  webServer.sendContent(F("</div><button type='submit' class='btn btn-s'>Save &amp; Apply</button></form>"));
  // Actions card
  webServer.sendContent(F("<div class='card'><div class='h'>Actions</div>"
    "<form method='POST' action='/update'><button type='submit' class='btn btn-s' "
    "onclick=\"return confirm('Flash firmware now?')\">&#128640; Flash Firmware Now</button></form>"
    "<form method='POST' action='/sendip'><button type='submit' class='btn btn-s' "
    "style='background:linear-gradient(135deg,#3b82f6,#8b5cf6);margin-top:8px' "
    "onclick=\"return confirm('Send IP via MQTT?')\">Send IP via MQTT</button></form>"
    "<form method='POST' action='/reboot'><button type='submit' class='btn btn-r' "
    "onclick=\"return confirm('Reboot device?')\">Reboot</button></form>"
    "</div>"));
  webServer.sendContent(F("</div></body></html>"));
  webServer.sendContent("");
}

void handleSave() {
  if (webServer.method() != HTTP_POST) { webServer.send(405, "text/plain", "POST only"); return; }
  if (webServer.hasArg("name"))   strncpy(cfg_device_name, webServer.arg("name").c_str(), sizeof(cfg_device_name) - 1);
  if (webServer.hasArg("zone"))   strncpy(cfg_device_zone, webServer.arg("zone").c_str(), sizeof(cfg_device_zone) - 1);
  if (webServer.hasArg("srv"))    strncpy(cfg_mqtt_server, webServer.arg("srv").c_str(), sizeof(cfg_mqtt_server) - 1);
  if (webServer.hasArg("port"))   strncpy(cfg_mqtt_port, webServer.arg("port").c_str(), sizeof(cfg_mqtt_port) - 1);
  if (webServer.hasArg("user"))   strncpy(cfg_mqtt_user, webServer.arg("user").c_str(), sizeof(cfg_mqtt_user) - 1);
  if (webServer.hasArg("pass") && webServer.arg("pass").length() > 0)
    strncpy(cfg_mqtt_pass, webServer.arg("pass").c_str(), sizeof(cfg_mqtt_pass) - 1);
  if (webServer.hasArg("sheets")) strncpy(cfg_sheets_id, webServer.arg("sheets").c_str(), sizeof(cfg_sheets_id) - 1);
  if (webServer.hasArg("ota") && webServer.arg("ota").length() > 0)
    strncpy(cfg_ota_url, webServer.arg("ota").c_str(), sizeof(cfg_ota_url) - 1);
  saveConfig();
  mqttClient.disconnect();
  applyConfig();
  webServer.sendHeader("Location", "/");
  webServer.send(303);
}

void handleReboot() {
  webServer.send(200, "text/html", "<html><body style='background:#0f172a;color:#f8fafc;font-family:system-ui;text-align:center;padding:60px'>"
    "<h2>Rebooting...</h2><p>Reconnecting in 10s</p><script>setTimeout(()=>location='/',10000)</script></body></html>");
  delay(500);
  ESP.restart();
}

void handleApi() {
  char json[256];
  snprintf(json, sizeof(json),
    "{\"temp\":%.1f,\"ok\":%s,\"mqtt\":%s,\"name\":\"%s\",\"zone\":\"%s\","
    "\"pin\":%d,\"ip\":\"%s\",\"rssi\":%d,\"fw\":\"%s\"}",
    sensorOk ? lastTemp : 0.0, sensorOk ? "true" : "false",
    mqttClient.connected() ? "true" : "false",
    cfg_device_name, cfg_device_zone, activeSensorPin,
    WiFi.localIP().toString().c_str(), WiFi.RSSI(), FW_VERSION);
  webServer.send(200, "application/json", json);
}

void handleUpdate() {
  webServer.send(200, "text/html",
    "<html><body style='background:#0f172a;color:#f8fafc;font-family:system-ui;text-align:center;padding:60px'>"
    "<h2>Updating Firmware...</h2><p>Please wait. Device will reboot when done.</p>"
    "<p>If update fails, device will return in 30s</p>"
    "<script>setTimeout(()=>location='/',30000)</script></body></html>");
  delay(500);
  checkHttpOTA();
}

void handleSendIP() {
  char ipMsg[128];
  snprintf(ipMsg, sizeof(ipMsg),
    "{\"name\":\"%s\",\"ip\":\"%s\",\"mac\":\"%s\",\"rssi\":%d,\"fw\":\"%s\"}",
    cfg_device_name, WiFi.localIP().toString().c_str(),
    WiFi.macAddress().c_str(), WiFi.RSSI(), FW_VERSION);
  char ipTopic[80];
  snprintf(ipTopic, sizeof(ipTopic), "factory/%s/ip/%s", cfg_device_zone, cfg_device_name);
  bool ok = false;
  if (mqttClient.connected()) {
    ok = mqttClient.publish(ipTopic, ipMsg);
  }
  String html = "<html><body style='background:#0f172a;color:#f8fafc;font-family:system-ui;text-align:center;padding:60px'>";
  if (ok) {
    html += "<h2 style='color:#22c55e'>IP Sent!</h2>";
    html += "<p>Published to: " + String(ipTopic) + "</p>";
    html += "<p>" + String(ipMsg) + "</p>";
  } else {
    html += "<h2 style='color:#ef4444'>Send Failed</h2>";
    html += "<p>MQTT not connected or publish failed</p>";
  }
  html += "<script>setTimeout(()=>location='/',3000)</script></body></html>";
  webServer.send(200, "text/html", html);
}

void setupWebServer() {
  webServer.on("/", HTTP_GET, handleRoot);
  webServer.on("/save", HTTP_POST, handleSave);
  webServer.on("/reboot", HTTP_POST, handleReboot);
  webServer.on("/update", HTTP_POST, handleUpdate);
  webServer.on("/sendip", HTTP_POST, handleSendIP);
  webServer.on("/api/status", HTTP_GET, handleApi);
  webServer.begin();
  Serial.printf("Web Config: http://%s/\n", WiFi.localIP().toString().c_str());
}

void setup() {
  Serial.begin(115200);

  // --- 0. LittleFS + Load Config ---
  if (!LittleFS.begin()) { LittleFS.format(); LittleFS.begin(); }
  loadConfig();

  // Auto-detect sensor pin
  int pin = scanSensorPin();
  initSensor(pin);

  // --- 1. WiFiManager: auto-connect or start config portal ---
  WiFiManager wm;
  // wm.resetSettings();  // Uncomment to clear saved WiFi for testing

  bool res = wm.autoConnect("ESP8266-Config-Portal");
  if (!res) {
    Serial.println("Failed to connect. Restarting...");
    ESP.restart();
  } else {
    Serial.println("Connected to WiFi successfully!");
  }

  // --- 2. Device Identity from MAC address ---
  uint8_t mac[6];
  WiFi.macAddress(mac);
  snprintf(clientId, 30, "ESP-%02X%02X%02X", mac[3], mac[4], mac[5]);

  // --- 3. Apply MQTT config ---
  applyConfig();

  // --- 4. OTA Setup ---
  setupOTA();

  // --- 5. Web Config Server ---
  setupWebServer();

  Serial.printf("Device Name: %s\n", cfg_device_name);
  Serial.printf("Client ID:   %s\n", clientId);
  Serial.printf("MQTT Topic:  %s\n", topic);
  Serial.printf("MQTT Broker: %s:%s\n", cfg_mqtt_server, cfg_mqtt_port);
}

void setupOTA() {
  ArduinoOTA.setHostname(clientId);
  ArduinoOTA.setPassword("admin");
  ArduinoOTA.onStart([]() {
    Serial.println("OTA: Update starting...");
    mqttClient.disconnect();
  });
  ArduinoOTA.onEnd([]() {
    Serial.println("\nOTA: Done. Rebooting...");
  });
  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    Serial.printf("OTA: %u%%\r", progress * 100 / total);
  });
  ArduinoOTA.onError([](ota_error_t error) {
    Serial.printf("OTA Error[%u]: ", error);
    if (error == OTA_AUTH_ERROR) Serial.println("Auth Failed");
    else if (error == OTA_BEGIN_ERROR) Serial.println("Begin Failed");
    else if (error == OTA_CONNECT_ERROR) Serial.println("Connect Failed");
    else if (error == OTA_RECEIVE_ERROR) Serial.println("Receive Failed");
    else if (error == OTA_END_ERROR) Serial.println("End Failed");
  });
  ArduinoOTA.begin();
  Serial.println("OTA ready");
}

void checkHttpOTA() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (strlen(cfg_ota_url) == 0) { Serial.println("HTTP OTA: No URL configured"); return; }

  Serial.printf("HTTP OTA: Checking %s ...\n", cfg_ota_url);
  WiFiClient otaClient;
  ESPhttpUpdate.setLedPin(LED_BUILTIN, LOW);
  ESPhttpUpdate.rebootOnUpdate(true);

  t_httpUpdate_return ret = ESPhttpUpdate.update(otaClient, cfg_ota_url, FW_VERSION);

  switch (ret) {
    case HTTP_UPDATE_FAILED:
      Serial.printf("HTTP OTA: Failed (%d): %s\n",
                    ESPhttpUpdate.getLastError(),
                    ESPhttpUpdate.getLastErrorString().c_str());
      break;
    case HTTP_UPDATE_NO_UPDATES:
      Serial.println("HTTP OTA: No new firmware");
      break;
    case HTTP_UPDATE_OK:
      Serial.println("HTTP OTA: Updated! Rebooting...");
      break;
  }
}

void sendToGoogleSheets(float temp) {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure httpsClient;
  httpsClient.setInsecure();

  HTTPClient http;
  String url = "https://script.google.com/macros/s/" + String(cfg_sheets_id) + "/exec" +
               "?id=" + String(clientId) +
               "&name=" + String(cfg_device_name) +
               "&temp=" + String(temp) +
               "&ip=" + WiFi.localIP().toString();

  Serial.print("Logging to Sheets: ");
  if (http.begin(httpsClient, url)) {
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    int httpCode = http.GET();
    if (httpCode > 0)
      Serial.printf("Done. Code: %d\n", httpCode);
    else
      Serial.printf("Failed. Error: %s\n", http.errorToString(httpCode).c_str());
    http.end();
  }
}

void reconnect() {
  while (!mqttClient.connected()) {
    Serial.print("Connecting to HiveMQ...");

    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("WiFi lost. Waiting for auto-reconnect...");
      return;
    }

    if (mqttClient.connect(clientId, cfg_mqtt_user, cfg_mqtt_pass)) {
      Serial.println("connected!");
      mqttClient.subscribe(topic);
    } else {
      Serial.print("failed, rc=");
      Serial.print(mqttClient.state());
      Serial.println(" — retry in 5s");
      delay(5000);
    }
  }
}

void loop() {
  ArduinoOTA.handle();
  webServer.handleClient();

  if (!mqttClient.connected()) {
    reconnect();
  }
  mqttClient.loop();

  unsigned long now = millis();

  // --- 1. Dashboard Update: publish temp every 10s ---
  if (now - lastMqttMsg > MQTT_INTERVAL) {
    lastMqttMsg = now;
    sensors->requestTemperatures();
    float t = sensors->getTempCByIndex(0);
    sensorOk = (t != DEVICE_DISCONNECTED_C);
    if (sensorOk) {
      lastTemp = t;
      char msg[80];
      snprintf(msg, sizeof(msg), "{\"t\":%.2f,\"ip\":\"%s\"}", t, WiFi.localIP().toString().c_str());
      mqttClient.publish(topic, msg);
      Serial.printf("MQTT Sent: %s → %s\n", msg, topic);
    } else {
      Serial.println("Sensor read error!");
    }
  }

  // --- 2. HTTP OTA Check: every 5 minutes ---
  if (now - lastOtaCheck > OTA_CHECK_INTERVAL || lastOtaCheck == 0) {
    lastOtaCheck = now;
    checkHttpOTA();
  }

  // --- 3. Database Update: log to Google Sheets every 20 min ---
  if (now - lastSheetsMsg > SHEETS_INTERVAL || lastSheetsMsg == 0) {
    lastSheetsMsg = now;
    sensors->requestTemperatures();
    float t = sensors->getTempCByIndex(0);
    if (t != DEVICE_DISCONNECTED_C) {
      sendToGoogleSheets(t);
    }
  }
}
