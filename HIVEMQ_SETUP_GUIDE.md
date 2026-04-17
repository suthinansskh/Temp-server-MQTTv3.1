# คู่มือการตั้งค่า HiveMQ Cloud สำหรับระบบ Cold Chain

## ภาพรวมระบบ

ระบบ Cold Chain Monitoring ของโรงพยาบาลศรีสะเกษ ใช้ ESP8266 จำนวน 30 เครื่อง ส่งข้อมูลอุณหภูมิผ่าน MQTT ไปยัง HiveMQ Cloud Broker โดยมี Dashboard บนเว็บเบราว์เซอร์แสดงผลแบบ Real-time

```
┌─────────────────────────────────────────────────────────────────────┐
│                       HiveMQ Cloud Broker                          │
│            4bdec66bf5984176a4d9eba86f41c7e9.s1.eu.hivemq.cloud     │
│                                                                     │
│   Port 8883 (MQTTS/TLS)              Port 8884 (WSS/TLS)          │
│        ▲                                      ▲                     │
│        │                                      │                     │
│   ┌────┴─────────────┐              ┌─────────┴──────────┐         │
│   │  ESP8266 x 30    │              │  Web Dashboard     │         │
│   │  (Publish Only)  │              │  (Subscribe Only)  │         │
│   │  factory/zone-X/ │              │  factory/#          │         │
│   │  temp/DEVICE-ID  │              │                    │         │
│   └──────────────────┘              └────────────────────┘         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 1. การจัดการสิทธิ์การเข้าถึง (Access Management)

> **สำคัญที่สุด:** HiveMQ Cloud **ไม่อนุญาต** การเชื่อมต่อแบบ Anonymous ทุก Client ต้องมี Username/Password

### ขั้นตอนการสร้าง User

1. เข้าสู่ระบบ [HiveMQ Cloud Console](https://console.hivemq.cloud/)
2. เลือก Cluster ของคุณ
3. ไปที่เมนู **"Access Management"**
4. คลิก **"Add Credentials"** หรือ **"Create User"**

### User สำหรับทดสอบ (Development)

| รายการ       | ค่า            |
|-------------|----------------|
| Username    | `admin`        |
| Password    | `Admin10700`   |
| Permission  | Publish & Subscribe |
| Topic Filter | `factory/#`   |

### User สำหรับ Production (แนะนำ)

เพื่อความปลอดภัยสูงสุด ควรแยก User ดังนี้:

| User            | Username         | Permission     | Topic Filter           | ใช้งานโดย           |
|----------------|------------------|---------------|------------------------|---------------------|
| Dashboard      | `dashboard_read` | Subscribe Only | `factory/#`           | Web Dashboard       |
| ESP8266 Devices | `esp_publish`   | Publish Only   | `factory/+/temp/+`    | ESP8266 ทั้ง 30 เครื่อง |
| Admin/Debug    | `admin`          | Publish & Subscribe | `factory/#`     | การทดสอบ / Debug    |

### การตั้งค่า Topic Permissions

```
Topic Pattern:  factory/#
Permissions:    Publish & Subscribe
```

- `factory/#` จะอนุญาตให้เข้าถึง **ทุก Topic** ที่ขึ้นต้นด้วย `factory/` เช่น:
  - `factory/zone-A/temp/ESP-01`
  - `factory/zone-B/temp/ESP-15`
  - `factory/zone-C/temp/ESP-30`

---

## 2. ข้อมูลการเชื่อมต่อ (Connection Details)

### ข้อมูล Cluster

| รายการ               | ค่า                                                              |
|---------------------|------------------------------------------------------------------|
| Cluster URL         | `4bdec66bf5984176a4d9eba86f41c7e9.s1.eu.hivemq.cloud`          |
| MQTT Port (TLS)     | `8883`                                                           |
| WebSocket Port (TLS)| `8884`                                                           |
| WebSocket Path      | `/mqtt`                                                          |
| Protocol            | TLS 1.2+ (บังคับ)                                                |

### Full Connection URLs

```
# สำหรับ ESP8266 (MQTTS over TLS)
mqtts://4bdec66bf5984176a4d9eba86f41c7e9.s1.eu.hivemq.cloud:8883

# สำหรับ Dashboard (WebSocket Secure)
wss://4bdec66bf5984176a4d9eba86f41c7e9.s1.eu.hivemq.cloud:8884/mqtt
```

### การตั้งค่าใน ESP8266 Firmware (`config.json`)

แก้ไขไฟล์ `data/config.json`:

```json
{
  "mqtt_server": "4bdec66bf5984176a4d9eba86f41c7e9.s1.eu.hivemq.cloud",
  "mqtt_port": "8883",
  "mqtt_user": "admin",
  "mqtt_pass": "Admin10700",
  "device_id": "ESP-01",
  "device_zone": "zone-A"
}
```

### การตั้งค่าใน Firmware (`main.cpp`)

เปลี่ยนจาก `WiFiClient` เป็น `WiFiClientSecure` เพื่อรองรับ TLS:

```cpp
#include <WiFiClientSecure.h>

// เปลี่ยนจาก:
// WiFiClient espClient;

// เป็น:
WiFiClientSecure espClient;

void setup() {
  // ...
  espClient.setInsecure(); // ใช้ TLS โดยไม่ตรวจสอบ Certificate (สำหรับ ESP8266)
  // หรือใช้ Root CA Certificate สำหรับความปลอดภัยเพิ่ม:
  // espClient.setTrustAnchors(&hivemqCA);

  client.setClient(espClient);
  client.setServer(mqtt_server, atoi(mqtt_port)); // Port 8883
  // ...
}
```

### การตั้งค่า Topic Structure ใน Firmware

เปลี่ยน Topic prefix จาก `hospital/` เป็น `factory/`:

```cpp
// เปลี่ยนจาก:
// snprintf(topic, sizeof(topic), "hospital/temp/%s", device_id);

// เป็น:
snprintf(topic, sizeof(topic), "factory/%s/temp/%s", device_zone, device_id);

// ตัวอย่างผลลัพธ์: factory/zone-A/temp/ESP-01
```

### การตั้งค่าใน Dashboard (`dashboard.html`)

```javascript
const CONFIG = {
  brokerUrl: 'wss://4bdec66bf5984176a4d9eba86f41c7e9.s1.eu.hivemq.cloud:8884/mqtt',
  topicRoot: 'factory/#',
  mqttUser: 'admin',       // หรือ 'dashboard_read' สำหรับ Production
  mqttPass: 'Admin10700',
};

// การเชื่อมต่อ
const mqttClient = mqtt.connect(CONFIG.brokerUrl, {
  username: CONFIG.mqttUser,
  password: CONFIG.mqttPass,
  protocol: 'wss',
  path: '/mqtt',
  keepalive: 60,
  reconnectPeriod: 5000,
});
```

---

## 3. โครงสร้าง MQTT Topic

### Topic Hierarchy

```
factory/
├── zone-A/
│   └── temp/
│       ├── ESP-01    → ข้อมูลอุณหภูมิ (เช่น 5.5)
│       ├── ESP-02
│       └── ...
├── zone-B/
│   └── temp/
│       ├── ESP-11
│       └── ...
├── zone-C/
│   └── temp/
│       ├── ESP-21
│       └── ...
└── devices/
    └── {device_id}/
        └── status    → สถานะ online/offline (JSON)
```

### ตัวอย่าง Payload

**Temperature Data:**
```
Topic:   factory/zone-A/temp/ESP-01
Payload: 5.5
```

**Device Status (JSON):**
```
Topic:   factory/devices/ESP-01/status
Payload: {
  "status": "online",
  "online": true,
  "ip": "192.168.1.101",
  "name": "ตู้เย็นห้อง A1",
  "zone": "zone-A",
  "rssi": -45,
  "uptime_s": 86400,
  "fw_version": "6.0.0"
}
```

---

## 4. การทดสอบการเชื่อมต่อ (Web Client Test)

### ทดสอบผ่าน HiveMQ Web Client

1. เข้าไปที่เมนู **"Web Client"** ใน HiveMQ Cloud Console
2. ตรวจสอบข้อมูลการเชื่อมต่อ:
   - **Host:** `4bdec66bf5984176a4d9eba86f41c7e9.s1.eu.hivemq.cloud`
   - **Port:** `8884`
   - **Path:** `/mqtt`
3. ใส่ Username & Password ที่สร้างไว้
4. กด **"Connect"**

### ทดสอบ Publish ข้อมูล

| รายการ  | ค่า                              |
|--------|----------------------------------|
| Topic  | `factory/zone-A/temp/TEST-01`   |
| Payload| `5.5`                            |
| QoS    | 0                                |
| Retain | false                            |

### ขั้นตอนการทดสอบ

```
1. เปิด Dashboard ในเบราว์เซอร์
2. ตรวจสอบว่า Dashboard เชื่อมต่อ MQTT สำเร็จ (สถานะ: Connected)
3. ไปที่ HiveMQ Web Client
4. Publish ข้อมูลไปที่ Topic: factory/zone-A/temp/TEST-01
5. ใส่ Payload: 5.5
6. กด Publish
7. ตรวจสอบว่า Dashboard แสดง Card ของ TEST-01 พร้อมอุณหภูมิ 5.5°C
8. ลอง Publish ค่าที่เกินขีดจำกัด เช่น 12.0 เพื่อทดสอบการแจ้งเตือน
```

---

## 5. ข้อควรระวังสำหรับ 30 อุปกรณ์

### ขีดจำกัดของ HiveMQ Cloud (แผน Serverless / Free)

| รายการ                     | ขีดจำกัด       | การใช้งานของเรา         |
|---------------------------|---------------|------------------------|
| Concurrent Connections    | 100           | 30 ESP + 1 Dashboard = **31** ✅ |
| Messages / เดือน           | 10 GB         | ขึ้นกับ Publish Rate     |
| Persistent Sessions       | รองรับ         | ใช้ Clean Session       |

### การตั้งค่า Keep Alive

```cpp
// ใน main.cpp - แนะนำ 60 วินาที
client.setKeepAlive(60);

// หรือใน PubSubClient
#define MQTT_KEEPALIVE 60
```

- **Keep Alive = 60 วินาที** ป้องกัน Broker ตัดการเชื่อมต่อ
- HiveMQ Cloud จะ disconnect หาก Client ไม่ส่ง PING ภายใน 1.5x ของ Keep Alive (90 วินาที)

### การป้องกัน Connection Storm

เมื่อ ESP8266 ทั้ง 30 เครื่องเปิดพร้อมกัน (เช่น หลังไฟดับ) อาจเกิด Connection Storm:

```cpp
// ใน reconnect() - เพิ่ม Random Jitter (มีอยู่แล้วใน Code ปัจจุบัน)
if (now - lastReconnectAttempt > (unsigned long)(5000 + random(0, 2000))) {
  // Reconnect logic...
}
```

### ข้อจำกัดของ ESP8266 กับ TLS

- ESP8266 มี RAM จำกัด (~80KB) การใช้ TLS จะใช้ RAM เพิ่มอีก ~20-30KB
- แนะนำใช้ `espClient.setInsecure()` แทน Full Certificate Validation
- หากพบปัญหา Out of Memory ให้ลด `MQTT_MAX_PACKET_SIZE` ใน `PubSubClient.h`

```cpp
// ใน platformio.ini เพิ่ม:
build_flags =
  -DMQTT_MAX_PACKET_SIZE=512
```

---

## 6. Security Best Practices

### ⚠️ สิ่งที่ต้องทำก่อนใช้งานจริง

1. **เปลี่ยน Password** — ห้ามใช้ `Admin10700` หรือ Password ง่ายๆ ใน Production
2. **แยก User** — ใช้ User แยกสำหรับ Dashboard (Subscribe Only) และ ESP8266 (Publish Only)
3. **จำกัด Topic** — ใช้ Topic Filter ที่แคบที่สุดเท่าที่เป็นไปได้
4. **อย่าเก็บ Credentials ใน Source Code** — ใช้ไฟล์ config แยก และอย่า commit ขึ้น Git

### ตัวอย่างการแยก Permissions (Production)

```
User: esp_publish
  Topic: factory/+/temp/+     → Publish Only
  Topic: factory/devices/+/status → Publish Only

User: dashboard_read
  Topic: factory/#             → Subscribe Only
```

### ตัวอย่าง .gitignore

```gitignore
# ห้าม commit ไฟล์ที่มี credentials
data/config.json
```

---

## 7. Checklist ก่อนเปิดใช้งาน

- [ ] สร้าง User ใน HiveMQ Cloud Console
- [ ] ตั้งค่า Topic Permission เป็น `factory/#` (Publish & Subscribe)
- [ ] แก้ไข `config.json` — เปลี่ยน `mqtt_server` และ `mqtt_port`
- [ ] แก้ไข `main.cpp` — เปลี่ยนเป็น `WiFiClientSecure` + Port 8883
- [ ] แก้ไข `main.cpp` — เปลี่ยน Topic prefix เป็น `factory/`
- [ ] แก้ไข Dashboard — เปลี่ยน `brokerUrl` เป็น WSS URL
- [ ] แก้ไข Dashboard — เพิ่ม Username/Password ในการเชื่อมต่อ
- [ ] ทดสอบผ่าน HiveMQ Web Client — Publish ข้อมูลและตรวจสอบ Dashboard
- [ ] ทดสอบด้วย ESP8266 จริง 1 เครื่อง
- [ ] ทดสอบด้วย ESP8266 ทั้ง 30 เครื่องพร้อมกัน
- [ ] เปลี่ยน Password เป็นค่าที่ปลอดภัยสำหรับ Production
- [ ] แยก User สำหรับ Dashboard และ ESP8266

---

## 8. Troubleshooting

| อาการ                          | สาเหตุที่เป็นไปได้                          | วิธีแก้ไข                                   |
|-------------------------------|--------------------------------------------|--------------------------------------------|
| ESP8266 เชื่อมต่อ MQTT ไม่ได้   | ใช้ WiFiClient แทน WiFiClientSecure        | เปลี่ยนเป็น WiFiClientSecure + setInsecure() |
| Dashboard เชื่อมต่อไม่ได้       | URL ไม่ถูกต้อง / ไม่มี `/mqtt` path         | ตรวจสอบ URL: `wss://....:8884/mqtt`        |
| Authentication Failed          | Username/Password ไม่ตรง                   | ตรวจสอบใน Access Management                |
| ไม่เห็นข้อมูลใน Dashboard      | Topic ไม่ตรงกัน (hospital/ vs factory/)     | ตรวจสอบ Topic prefix ทั้ง Firmware และ Dashboard |
| ESP8266 Disconnect บ่อย        | Keep Alive ต่ำเกินไป / RAM ไม่พอ           | เพิ่ม Keep Alive เป็น 60s / ลด Packet Size |
| Connection Refused             | เกิน Connection Limit (100)                | ตรวจสอบจำนวน Client ที่เชื่อมต่ออยู่         |
| ESP8266 Crash / Reboot Loop   | TLS ใช้ RAM มากเกินไป                       | ใช้ setInsecure() + ลด MQTT_MAX_PACKET_SIZE |
