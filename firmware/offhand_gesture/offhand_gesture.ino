/*
 * offhand_gesture.ino  -  ESP32 + PAJ7620U2 gesture board for offhand
 * ---------------------------------------------------------------------------------------------
 * What it does
 *   Reads the PAJ7620U2 over I2C and prints one JSON object per line on USB serial (115200 baud),
 *   exactly the GestureEvent contract in packages/contracts/src/gesture.ts:
 *     {"t":"g","g":"left","seq":12,"ms":53021}                       gesture
 *     {"t":"h","x":0.512,"y":0.300,"z":0.420,"seq":881,"ms":53110}   hover (hand position, 0..1)
 *     {"t":"hb","fw":"offhand-gesture 0.1.0","ms":54000,"paj":"ok"}  heartbeat every 2 s
 *     {"t":"err","msg":"..."}                                        error
 *   Every other line starts with "#" and is human-readable test output for the Arduino Serial
 *   Monitor. The hub treats "#" lines as comments, so both can share the one serial port.
 *
 * Serial-monitor test output (all prefixed "# "):
 *   [BOOT]/[PASS] ESP32 alive ......... chip model, cores, flash, reset reason (catches brown-outs)
 *   [TEST] I2C scan ................... every device on the bus, PAJ7620/MPU6050/SSD1306 named
 *   [FAIL] PAJ7620 NOT CONNECTED ...... no ACK at 0x73, with wiring help; retried every 2 s
 *   [FAIL] WRONG DEVICE ............... something answers at 0x73 but the chip ID is not 0x7620
 *   [PASS] PAJ7620 CONNECTED .......... chip ID + init time
 *   [FAIL] PAJ7620 CONNECTION LOST .... sensor stopped answering (wire pulled, power dip)
 *   [PASS] PAJ7620 RECONNECTED ........ came back; re-initialised automatically
 *   [GESTURE] SWIPE / PUSH / PULL / SPIN / WAVE / SNAP detected
 *   [HOVER] hand entered / left view (+ live x/y/z with "verbose on")
 *   "No ESP32 connected" cannot be printed by the ESP32 itself: run `pnpm gesture:monitor` on the
 *   host (or start the hub) and it reports "[link:NO_DEVICE] No ESP32 connected", "busy",
 *   "silent" (wrong firmware/baud) and "Connection lost: COMx disconnected".
 *
 * SNAP: the PAJ7620 sees IR reflections, it cannot hear a finger snap. "SNAP" here is a quick
 *   push-then-pull (forward then backward within SNAP_WINDOW_MS). It is reported on the "#"
 *   test line only, because "snap" is not one of the nine contract gestures. The forward and
 *   backward JSON events are still sent as usual.
 *
 * Commands (Serial Monitor, line ending "Newline" or "Both NL & CR"):
 *   help | status | selftest | scan | reinit
 *   verbose on|off       live hover numbers + I2C retry chatter
 *   hover on|off         send hover (t:"h") events
 *   rotate 0|90|180|270  sensor mounted rotated clockwise (as seen by the user) - remaps directions
 *   mirror on|off        sensor faces the user: swaps left/right and cw/ccw, mirrors hover x
 *   speed normal|game    PAJ gesture speed ~120 fps / ~240 fps
 *   sim <up|down|left|right|forward|backward|cw|ccw|wave|snap|lost>   fake an event (no sensor needed)
 *   factory              reset saved settings
 *   Settings are saved in flash (Preferences/NVS) and survive reboots.
 *
 * Wiring (PAJ7620U2 breakout -> ESP32 DevKit):  VIN/VCC -> 3V3,  GND -> GND,
 *   SDA -> GPIO21,  SCL -> GPIO22,  INT -> not used (polled).  3.3 V only: do not use 5 V.
 *
 * Build: Arduino IDE 2.x, board "ESP32 Dev Module" (esp32 core 3.x),
 *   Library Manager -> "RevEng PAJ7620" (MIT, by Aaron S. Crandall).
 */

#include <Arduino.h>
#include <Preferences.h>
#include <Wire.h>
#include <esp_system.h>
#include <stdarg.h>

#include "RevEng_PAJ7620.h"

// ---------------------------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------------------------
#define FW_NAME "offhand-gesture"
#define FW_VERSION "0.1.1"
#define SERIAL_BAUD 115200

#define PIN_SDA 21
#define PIN_SCL 22
#define I2C_HZ 400000
#define I2C_TIMEOUT_MS 20
#define PAJ_ADDR 0x73

#ifdef LED_BUILTIN
#define STATUS_LED_PIN LED_BUILTIN  // on solid = OK, fast blink = sensor missing, slow = lost
#else
#define STATUS_LED_PIN -1
#endif

#define HEARTBEAT_MS 2000      // contract: heartbeat every 2 s
#define HEALTH_MS 500          // I2C health probe while connected
#define HEALTH_FAILS_LOST 2    // consecutive failed probes before "connection lost"
#define RETRY_MS 2000          // reconnect attempts while missing/lost
#define POLL_MS 8              // gesture register poll (sensor runs ~120 fps)
#define HOVER_MS 50            // hover events at 20 Hz while a hand is in view
#define HOVER_MIN_BRIGHTNESS 8   // lower = a farther / dimmer hand still counts as in view
#define HOVER_LEFT_MS 150      // hand must be gone this long before "left view"
#define SNAP_WINDOW_MS 600     // forward then backward within this = SNAP
#define GESTURE_EXIT_MS 120    // shorter wait before a push/pull is reported
#define OBJ_CENTER_MAX 3712.0f // getObjectCenterX/Y range per RevEng_PAJ7620

// ---------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------
enum PajState { PAJ_UNKNOWN, PAJ_OK, PAJ_MISSING, PAJ_LOST };

RevEng_PAJ7620 paj = RevEng_PAJ7620();
Preferences prefs;

PajState pajState = PAJ_UNKNOWN;
uint32_t lastHeartbeat = 0, lastHealth = 0, lastRetry = 0, lastPoll = 0, lastHover = 0;
uint32_t lostAt = 0, lastForwardAt = 0, lastHandSeen = 0, handEnteredAt = 0, lastVerboseHover = 0;
uint8_t healthFails = 0;
uint16_t retryCount = 0;
uint8_t lastI2cError = 0;
uint32_t gSeq = 0, hSeq = 0;
bool handInView = false;

struct Settings {
  uint16_t rotate = 0;  // 0/90/180/270
  bool mirror = false;
  bool hover = true;
  bool game = true;  // game speed (~240 fps) is the more sensitive gesture mode
  bool verbose = false;
} cfg;

char cmdBuf[64];
uint8_t cmdLen = 0;

// ---------------------------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------------------------
/** Human-readable line for the Serial Monitor: "# " + text. */
void note(const char *fmt, ...) {
  char buf[200];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(buf, sizeof(buf), fmt, ap);
  va_end(ap);
  Serial.print("# ");
  Serial.println(buf);
}

/** Contract JSON line (no "#"). Keep under 120 chars. */
void json(const char *fmt, ...) {
  char buf[160];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(buf, sizeof(buf), fmt, ap);
  va_end(ap);
  Serial.println(buf);
}

/** {"t":"err"} with JSON-safe message (quotes/backslashes stripped). */
void jsonErr(const char *msg) {
  char clean[120];
  size_t j = 0;
  for (size_t i = 0; msg[i] && j < sizeof(clean) - 1; i++)
    if (msg[i] != '"' && msg[i] != '\\') clean[j++] = msg[i];
  clean[j] = 0;
  json("{\"t\":\"err\",\"msg\":\"%s\"}", clean);
}

const char *pajStateJson(PajState s) {
  switch (s) {
    case PAJ_OK: return "ok";
    case PAJ_LOST: return "lost";
    default: return "missing";
  }
}

void heartbeat() {
  lastHeartbeat = millis();
  json("{\"t\":\"hb\",\"fw\":\"" FW_NAME " " FW_VERSION "\",\"ms\":%lu,\"paj\":\"%s\"}",
       (unsigned long)lastHeartbeat, pajStateJson(pajState));
}

const char *i2cErrorName(uint8_t e) {
  switch (e) {
    case 0: return "ok";
    case 1: return "data too long";
    case 2: return "NACK on address (nothing answered)";
    case 3: return "NACK on data";
    case 4: return "bus error";
    case 5: return "timeout (SDA/SCL stuck?)";
    default: return "unknown";
  }
}

const char *resetReasonName(esp_reset_reason_t r) {
  switch (r) {
    case ESP_RST_POWERON: return "power-on";
    case ESP_RST_SW: return "software restart";
    case ESP_RST_PANIC: return "crash (panic)";
    case ESP_RST_INT_WDT:
    case ESP_RST_TASK_WDT:
    case ESP_RST_WDT: return "watchdog";
    case ESP_RST_BROWNOUT: return "BROWN-OUT (power dip: check USB cable/port)";
    case ESP_RST_DEEPSLEEP: return "deep sleep wake";
    case ESP_RST_EXT: return "reset pin";
    default: return "other";
  }
}

// ---------------------------------------------------------------------------------------------
// I2C helpers (the library hides I2C errors, so health checks talk to the bus directly)
// ---------------------------------------------------------------------------------------------
uint8_t i2cPing(uint8_t addr) {
  Wire.beginTransmission(addr);
  return Wire.endTransmission();
}

/** Read one register; returns I2C error code (0 = ok). */
uint8_t i2cRead8(uint8_t addr, uint8_t reg, uint8_t &out) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  uint8_t e = Wire.endTransmission();
  if (e) return e;
  if (Wire.requestFrom((uint16_t)addr, (uint8_t)1) != 1) return 4;
  out = Wire.read();
  return 0;
}

/** PAJ7620 part ID lives in bank 0, regs 0x00 (LSB, 0x20) and 0x01 (MSB, 0x76). */
uint8_t readPartId(uint16_t &id) {
  uint8_t lo = 0, hi = 0, e;
  Wire.beginTransmission(PAJ_ADDR);  // select bank 0 (library leaves bank 0 selected anyway)
  Wire.write(0xEF);
  Wire.write(0x00);
  if ((e = Wire.endTransmission())) return e;
  if ((e = i2cRead8(PAJ_ADDR, 0x00, lo))) return e;
  if ((e = i2cRead8(PAJ_ADDR, 0x01, hi))) return e;
  id = ((uint16_t)hi << 8) | lo;
  return 0;
}

const char *knownDevice(uint8_t a) {
  switch (a) {
    case 0x73: return "PAJ7620 gesture sensor";
    case 0x68:
    case 0x69: return "MPU6050/MPU9250 IMU?";
    case 0x3C:
    case 0x3D: return "SSD1306 OLED?";
    case 0x76:
    case 0x77: return "BMP/BME280?";
    default: return "unknown";
  }
}

uint8_t scanBus(bool print) {
  uint8_t found = 0;
  if (print) note("[TEST] I2C scan on SDA=GPIO%d SCL=GPIO%d @ %d kHz ...", PIN_SDA, PIN_SCL, I2C_HZ / 1000);
  for (uint8_t a = 1; a < 127; a++) {
    if (i2cPing(a) == 0) {
      found++;
      if (print) note("[TEST]   found 0x%02X  %s", a, knownDevice(a));
    }
  }
  if (print) {
    if (found) note("[TEST] I2C scan: %d device(s)", found);
    else note("[FAIL] I2C scan: no devices. Wiring or power problem (or pull-ups missing).");
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// Sensor connect / health
// ---------------------------------------------------------------------------------------------
void printWiringHelp() {
  note("        Check: VIN->3V3 (not 5V), GND->GND, SDA->GPIO%d, SCL->GPIO%d.", PIN_SDA, PIN_SCL);
  note("        Loose jumper? Swap SDA/SCL? Breakout powered (LED on)? Retrying every %d s.", RETRY_MS / 1000);
}

void applySensorSettings() {
  paj.setGestureExitTime(GESTURE_EXIT_MS);
  if (cfg.game) paj.setGameSpeed();
  else paj.setNormalSpeed();
}

void setPajState(PajState s) {
  if (s == pajState) return;
  pajState = s;
  heartbeat();  // tell the hub right away instead of waiting up to 2 s
}

/** Try to find + initialise the sensor. Prints the outcome. */
bool connectSensor() {
  retryCount++;
  uint8_t e = i2cPing(PAJ_ADDR);
  if (e) {
    lastI2cError = e;
    if (pajState == PAJ_UNKNOWN) {
      note("[FAIL] PAJ7620 NOT CONNECTED: no answer at I2C 0x%02X (error %d: %s).", PAJ_ADDR, e, i2cErrorName(e));
      printWiringHelp();
      jsonErr("PAJ7620 not connected (no ACK at 0x73)");
      setPajState(PAJ_MISSING);
    } else if (cfg.verbose || retryCount % 10 == 0) {
      note("[WAIT] PAJ7620 still %s (attempt %u, I2C error %d: %s)",
           pajState == PAJ_LOST ? "lost" : "not connected", retryCount, e, i2cErrorName(e));
      if (retryCount % 10 == 0) printWiringHelp();
    }
    return false;
  }

  uint16_t id = 0;
  e = readPartId(id);
  if (e || id != 0x7620) {
    if (pajState != PAJ_MISSING || retryCount % 10 == 1) {
      if (e) note("[FAIL] Something ACKed at 0x73 but reading its ID failed (I2C error %d: %s).", e, i2cErrorName(e));
      else note("[FAIL] WRONG DEVICE at 0x73: chip ID 0x%04X, expected 0x7620 (PAJ7620U2).", id);
      jsonErr("device at 0x73 is not a PAJ7620");
    }
    setPajState(pajState == PAJ_LOST ? PAJ_LOST : PAJ_MISSING);
    return false;
  }

  uint32_t t0 = millis();
  if (!paj.begin(&Wire)) {
    note("[FAIL] PAJ7620 answered (ID 0x7620) but init failed. Will retry.");
    jsonErr("PAJ7620 init failed");
    return false;
  }
  applySensorSettings();
  paj.clearGestureInterrupts();
  uint32_t took = millis() - t0;

  if (pajState == PAJ_LOST) {
    note("[PASS] PAJ7620 RECONNECTED after %.1f s (re-initialised in %lu ms). Gestures resumed.",
         (millis() - lostAt) / 1000.0f, (unsigned long)took);
  } else {
    note("[PASS] PAJ7620 CONNECTED: chip ID 0x7620, initialised in %lu ms.", (unsigned long)took);
  }
  healthFails = 0;
  retryCount = 0;
  handInView = false;
  setPajState(PAJ_OK);
  return true;
}

/** Called every HEALTH_MS while connected. Two failures in a row = connection lost. */
void checkHealth() {
  uint16_t id = 0;
  uint8_t e = i2cPing(PAJ_ADDR);
  if (!e) e = readPartId(id);
  if (!e && id != 0x7620) e = 4;
  if (!e) {
    healthFails = 0;
    return;
  }
  lastI2cError = e;
  if (++healthFails < HEALTH_FAILS_LOST) {
    if (cfg.verbose) note("[WARN] I2C glitch talking to PAJ7620 (error %d: %s)", e, i2cErrorName(e));
    return;
  }
  markLost(e);
}

void markLost(uint8_t e) {
  lostAt = millis();
  retryCount = 0;
  if (handInView) handInView = false;
  note("[FAIL] PAJ7620 CONNECTION LOST: I2C error %d (%s). Gestures paused, retrying every %d s.",
       e, i2cErrorName(e), RETRY_MS / 1000);
  jsonErr("PAJ7620 connection lost");
  setPajState(PAJ_LOST);
}

// ---------------------------------------------------------------------------------------------
// Gestures
// ---------------------------------------------------------------------------------------------
// Clockwise ring used to remap swipe directions for a rotated sensor.
const Gesture RING[4] = {GES_UP, GES_RIGHT, GES_DOWN, GES_LEFT};

Gesture orient(Gesture g) {
  if (cfg.mirror) {
    if (g == GES_LEFT) g = GES_RIGHT;
    else if (g == GES_RIGHT) g = GES_LEFT;
    else if (g == GES_CLOCKWISE) g = GES_ANTICLOCKWISE;
    else if (g == GES_ANTICLOCKWISE) g = GES_CLOCKWISE;
  }
  uint8_t steps = (cfg.rotate / 90) % 4;
  if (!steps) return g;
  for (uint8_t i = 0; i < 4; i++)
    if (RING[i] == g) return RING[(i + steps) % 4];
  return g;
}

const char *contractName(Gesture g) {
  switch (g) {
    case GES_UP: return "up";
    case GES_DOWN: return "down";
    case GES_LEFT: return "left";
    case GES_RIGHT: return "right";
    case GES_FORWARD: return "forward";
    case GES_BACKWARD: return "backward";
    case GES_CLOCKWISE: return "cw";
    case GES_ANTICLOCKWISE: return "ccw";
    case GES_WAVE: return "wave";
    default: return nullptr;
  }
}

void ledPulse();

/** Emit a gesture: JSON contract line + human test line. sim=true when faked from the console. */
void emitGesture(Gesture g, bool sim) {
  const char *name = contractName(g);
  if (!name) return;
  uint32_t now = millis();
  json("{\"t\":\"g\",\"g\":\"%s\",\"seq\":%lu,\"ms\":%lu}", name, (unsigned long)++gSeq, (unsigned long)now);
  ledPulse();

  const char *tag = sim ? "[SIM] " : "";
  switch (g) {
    case GES_UP:
    case GES_DOWN:
    case GES_LEFT:
    case GES_RIGHT: note("%s[GESTURE] SWIPE %s detected", tag, g == GES_UP ? "UP" : g == GES_DOWN ? "DOWN" : g == GES_LEFT ? "LEFT" : "RIGHT"); break;
    case GES_FORWARD: note("%s[GESTURE] PUSH detected (toward sensor = forward)", tag); break;
    case GES_BACKWARD: note("%s[GESTURE] PULL detected (away from sensor = backward)", tag); break;
    case GES_CLOCKWISE: note("%s[GESTURE] SPIN detected: clockwise (cw)", tag); break;
    case GES_ANTICLOCKWISE: note("%s[GESTURE] SPIN detected: counter-clockwise (ccw)", tag); break;
    case GES_WAVE:
      if (sim || pajState != PAJ_OK) note("%s[GESTURE] WAVE detected", tag);
      else note("[GESTURE] WAVE detected (wave count %d)", paj.getWaveCount());
      break;
    default: break;
  }

  // SNAP = quick push then pull. Test line only (not a contract gesture).
  if (g == GES_FORWARD) lastForwardAt = now;
  else if (g == GES_BACKWARD && lastForwardAt && now - lastForwardAt <= SNAP_WINDOW_MS) {
    note("%s[GESTURE] SNAP detected (push + pull in %lu ms)", tag, (unsigned long)(now - lastForwardAt));
    lastForwardAt = 0;
  }
}

void pollGesture() {
  Gesture g = paj.readGesture();  // may block up to GESTURE_EXIT_MS for push/pull
  if (g == GES_NONE) return;
  emitGesture(orient(g), false);
}

// ---------------------------------------------------------------------------------------------
// Hover (hand position) - drives scrub mode in the hub
// ---------------------------------------------------------------------------------------------
void pollHover() {
  uint32_t now = millis();
  if (now - lastHover < HOVER_MS) return;
  lastHover = now;

  int bright = paj.getObjectBrightness();
  bool inView = bright >= HOVER_MIN_BRIGHTNESS && paj.isObjectInView();
  if (!inView) {
    if (handInView && now - lastHandSeen > HOVER_LEFT_MS) {
      handInView = false;
      note("[HOVER] hand left view after %.1f s", (now - handEnteredAt) / 1000.0f);
    }
    return;
  }
  lastHandSeen = now;
  if (!handInView) {
    handInView = true;
    handEnteredAt = now;
    note("[HOVER] hand entered view");
  }
  if (!cfg.hover) return;

  int cx = paj.getObjectCenterX();
  int cy = paj.getObjectCenterY();
  float x = constrain(cx / OBJ_CENTER_MAX, 0.0f, 1.0f);
  float y = constrain(cy / OBJ_CENTER_MAX, 0.0f, 1.0f);
  float z = constrain(bright / 255.0f, 0.0f, 1.0f);  // brighter = closer

  // Same rotation/mirror as the gestures, applied around the centre.
  if (cfg.mirror) x = 1.0f - x;
  for (uint8_t i = 0; i < (cfg.rotate / 90) % 4; i++) {
    float nx = 1.0f - y, ny = x;  // 90 deg clockwise
    x = nx;
    y = ny;
  }

  json("{\"t\":\"h\",\"x\":%.3f,\"y\":%.3f,\"z\":%.3f,\"seq\":%lu,\"ms\":%lu}", x, y, z, (unsigned long)++hSeq,
       (unsigned long)now);
  if (cfg.verbose && now - lastVerboseHover >= 250) {
    lastVerboseHover = now;
    note("[HOVER] x=%.2f y=%.2f z=%.2f  (raw cx=%d cy=%d brightness=%d size=%d)", x, y, z, cx, cy, bright,
         paj.getObjectSize());
  }
}

// ---------------------------------------------------------------------------------------------
// Status LED
// ---------------------------------------------------------------------------------------------
uint32_t pulseUntil = 0;
void ledPulse() { pulseUntil = millis() + 80; }

void updateLed() {
  if (STATUS_LED_PIN < 0) return;
  uint32_t now = millis();
  bool on;
  if (now < pulseUntil) on = false;  // short blink-off on each gesture
  else if (pajState == PAJ_OK) on = true;
  else if (pajState == PAJ_LOST) on = (now / 500) % 2;
  else on = (now / 100) % 2;
  digitalWrite(STATUS_LED_PIN, on ? HIGH : LOW);
}

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------
void loadSettings() {
  prefs.begin("offhand", true);
  cfg.rotate = prefs.getUShort("rotate", 0);
  cfg.mirror = prefs.getBool("mirror", false);
  cfg.hover = prefs.getBool("hover", true);
  cfg.game = prefs.getBool("game", true);
  cfg.verbose = prefs.getBool("verbose", false);
  bool sens = prefs.getBool("sens1", false);
  prefs.end();
  if (cfg.rotate % 90 || cfg.rotate > 270) cfg.rotate = 0;
  // Boards flashed before 0.1.1 saved normal speed. Apply game speed once.
  if (!sens) {
    cfg.game = true;
    saveSettings();
    prefs.begin("offhand", false);
    prefs.putBool("sens1", true);
    prefs.end();
  }
}

void saveSettings() {
  prefs.begin("offhand", false);
  prefs.putUShort("rotate", cfg.rotate);
  prefs.putBool("mirror", cfg.mirror);
  prefs.putBool("hover", cfg.hover);
  prefs.putBool("game", cfg.game);
  prefs.putBool("verbose", cfg.verbose);
  prefs.end();
}

void printSettings() {
  note("[INFO] Settings: rotate %u, mirror %s, hover %s, speed %s, verbose %s, exit time %d ms",
       cfg.rotate, cfg.mirror ? "on" : "off", cfg.hover ? "on" : "off", cfg.game ? "game (~240 fps)" : "normal (~120 fps)",
       cfg.verbose ? "on" : "off", GESTURE_EXIT_MS);
}

// ---------------------------------------------------------------------------------------------
// Self test / status
// ---------------------------------------------------------------------------------------------
void printChip() {
  uint64_t mac = ESP.getEfuseMac();
  note("[PASS] ESP32 alive: %s rev %d, %d core(s) @ %lu MHz, flash %lu MB, MAC %04X%08lX",
       ESP.getChipModel(), ESP.getChipRevision(), ESP.getChipCores(), (unsigned long)ESP.getCpuFreqMHz(),
       (unsigned long)(ESP.getFlashChipSize() / (1024 * 1024)), (uint16_t)(mac >> 32), (unsigned long)(uint32_t)mac);
  esp_reset_reason_t rr = esp_reset_reason();
  if (rr == ESP_RST_BROWNOUT || rr == ESP_RST_PANIC || rr == ESP_RST_INT_WDT || rr == ESP_RST_TASK_WDT || rr == ESP_RST_WDT)
    note("[WARN] Last reset reason: %s", resetReasonName(rr));
  else
    note("[INFO] Last reset reason: %s. SDK %s", resetReasonName(rr), ESP.getSdkVersion());
}

void selfTest() {
  uint8_t pass = 0, fail = 0;
  note("---------------- SELF TEST ----------------");
  printChip();
  pass++;
  note("[PASS] Serial: %d baud, JSON lines + '#' test lines", SERIAL_BAUD);
  pass++;

  if (scanBus(true)) pass++;
  else fail++;

  uint16_t id = 0;
  uint8_t e = i2cPing(PAJ_ADDR);
  if (!e) e = readPartId(id);
  if (e) {
    note("[FAIL] PAJ7620 not reachable (I2C error %d: %s)", e, i2cErrorName(e));
    printWiringHelp();
    fail++;
  } else if (id != 0x7620) {
    note("[FAIL] Chip ID at 0x73 is 0x%04X, expected 0x7620", id);
    fail++;
  } else {
    note("[PASS] PAJ7620 chip ID 0x7620");
    pass++;
    uint32_t t0 = micros();
    uint8_t errs = 0;
    for (uint8_t i = 0; i < 20; i++) {
      uint16_t tmp;
      if (readPartId(tmp)) errs++;
    }
    float avgMs = (micros() - t0) / 20000.0f;
    if (errs) {
      note("[FAIL] I2C read reliability: %u/20 reads failed (loose wire? long cables?)", errs);
      fail++;
    } else {
      note("[PASS] I2C reads: 20/20 OK, %.2f ms per ID read", avgMs);
      pass++;
    }
    if (pajState == PAJ_OK) {
      int b = paj.getObjectBrightness();
      note("[INFO] Object in view: %s (brightness %d, size %d). Hold a hand ~10 cm above to test.",
           b >= HOVER_MIN_BRIGHTNESS ? "YES" : "no", b, paj.getObjectSize());
    } else {
      note("[INFO] Sensor reachable but not initialised yet; it will connect on the next retry.");
    }
  }
  printSettings();
  note("---------------- %u passed, %u failed ----------------", pass, fail);
}

void printStatus() {
  const char *s = pajState == PAJ_OK ? "CONNECTED" : pajState == PAJ_LOST ? "CONNECTION LOST" : "NOT CONNECTED";
  note("[INFO] %s %s | uptime %lu s | PAJ7620 %s | gestures sent %lu, hover sent %lu",
       FW_NAME, FW_VERSION, (unsigned long)(millis() / 1000), s, (unsigned long)gSeq, (unsigned long)hSeq);
  if (pajState != PAJ_OK && lastI2cError)
    note("[INFO] Last I2C error %d: %s", lastI2cError, i2cErrorName(lastI2cError));
  printSettings();
}

void printHelp() {
  note("Commands: help | status | selftest | scan | reinit | factory");
  note("          verbose on|off | hover on|off | rotate 0|90|180|270 | mirror on|off | speed normal|game");
  note("          sim up|down|left|right|forward|backward|cw|ccw|wave|snap|lost");
}

// ---------------------------------------------------------------------------------------------
// Console commands
// ---------------------------------------------------------------------------------------------
bool parseOnOff(const char *arg, bool &out) {
  if (!strcmp(arg, "on") || !strcmp(arg, "1")) return out = true, true;
  if (!strcmp(arg, "off") || !strcmp(arg, "0")) return out = false, true;
  return false;
}

Gesture gestureByName(const char *n) {
  if (!strcmp(n, "up")) return GES_UP;
  if (!strcmp(n, "down")) return GES_DOWN;
  if (!strcmp(n, "left")) return GES_LEFT;
  if (!strcmp(n, "right")) return GES_RIGHT;
  if (!strcmp(n, "forward") || !strcmp(n, "push")) return GES_FORWARD;
  if (!strcmp(n, "backward") || !strcmp(n, "pull")) return GES_BACKWARD;
  if (!strcmp(n, "cw") || !strcmp(n, "spin")) return GES_CLOCKWISE;
  if (!strcmp(n, "ccw")) return GES_ANTICLOCKWISE;
  if (!strcmp(n, "wave")) return GES_WAVE;
  return GES_NONE;
}

void runCommand(char *line) {
  for (char *p = line; *p; p++) *p = tolower(*p);
  char *cmd = strtok(line, " \t");
  char *arg = strtok(nullptr, " \t");
  if (!cmd) return;
  bool b;

  if (!strcmp(cmd, "help") || !strcmp(cmd, "?")) printHelp();
  else if (!strcmp(cmd, "status")) printStatus();
  else if (!strcmp(cmd, "selftest") || !strcmp(cmd, "test")) selfTest();
  else if (!strcmp(cmd, "scan")) scanBus(true);
  else if (!strcmp(cmd, "reinit")) {
    note("[INFO] Re-initialising PAJ7620...");
    connectSensor();
  } else if (!strcmp(cmd, "factory")) {
    cfg = Settings();
    saveSettings();
    if (pajState == PAJ_OK) applySensorSettings();
    note("[INFO] Settings reset to defaults.");
    printSettings();
  } else if (!strcmp(cmd, "verbose") && arg && parseOnOff(arg, b)) {
    cfg.verbose = b;
    saveSettings();
    note("[INFO] verbose %s", b ? "on" : "off");
  } else if (!strcmp(cmd, "hover") && arg && parseOnOff(arg, b)) {
    cfg.hover = b;
    saveSettings();
    note("[INFO] hover events %s", b ? "on" : "off");
  } else if (!strcmp(cmd, "mirror") && arg && parseOnOff(arg, b)) {
    cfg.mirror = b;
    saveSettings();
    note("[INFO] mirror %s (left/right and cw/ccw %s)", b ? "on" : "off", b ? "swapped" : "normal");
  } else if (!strcmp(cmd, "rotate") && arg) {
    int r = atoi(arg);
    if (r == 0 || r == 90 || r == 180 || r == 270) {
      cfg.rotate = r;
      saveSettings();
      note("[INFO] rotate %d: a swipe toward the sensor's top edge now reads as %s", r,
           contractName(orient(GES_UP)));
    } else note("[ERR] rotate takes 0, 90, 180 or 270");
  } else if (!strcmp(cmd, "speed") && arg && (!strcmp(arg, "normal") || !strcmp(arg, "game"))) {
    cfg.game = !strcmp(arg, "game");
    saveSettings();
    if (pajState == PAJ_OK) applySensorSettings();
    note("[INFO] speed %s", cfg.game ? "game (~240 fps)" : "normal (~120 fps)");
  } else if (!strcmp(cmd, "sim") && arg) {
    if (!strcmp(arg, "snap")) {
      emitGesture(GES_FORWARD, true);
      delay(120);
      emitGesture(GES_BACKWARD, true);
    } else if (!strcmp(arg, "lost")) {
      if (pajState == PAJ_OK) {
        note("[SIM] forcing connection-lost path; a real sensor will reconnect in ~%d s", RETRY_MS / 1000);
        markLost(2);
        lastRetry = millis();
      } else note("[SIM] sensor is not connected, nothing to lose");
    } else {
      Gesture g = gestureByName(arg);
      if (g == GES_NONE) note("[ERR] unknown gesture '%s'", arg);
      else emitGesture(g, true);  // simulated gestures are already in user orientation
    }
  } else {
    note("[ERR] unknown command '%s%s%s'. Type 'help'.", cmd, arg ? " " : "", arg ? arg : "");
  }
}

void pollConsole() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (cmdLen) {
        cmdBuf[cmdLen] = 0;
        runCommand(cmdBuf);
        cmdLen = 0;
      }
    } else if (cmdLen < sizeof(cmdBuf) - 1) {
      cmdBuf[cmdLen++] = c;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Arduino entry points
// ---------------------------------------------------------------------------------------------
void setup() {
  Serial.begin(SERIAL_BAUD);
  uint32_t t0 = millis();
  while (!Serial && millis() - t0 < 1500) delay(10);  // native-USB boards (S3/C3) only
  delay(50);
  Serial.println();
  note("==================================================");
  note("[BOOT] %s %s  (offhand gesture board)", FW_NAME, FW_VERSION);
  note("==================================================");
  printChip();
  loadSettings();
  printSettings();

  if (STATUS_LED_PIN >= 0) pinMode(STATUS_LED_PIN, OUTPUT);

  Wire.begin(PIN_SDA, PIN_SCL, I2C_HZ);  // library's own Wire.begin() then keeps these pins
  Wire.setTimeOut(I2C_TIMEOUT_MS);
  scanBus(true);

  connectSensor();
  lastRetry = millis();
  heartbeat();
  note("[READY] Type 'help' + Enter for commands, 'selftest' for a full check.");
}

void loop() {
  uint32_t now = millis();
  pollConsole();

  if (pajState == PAJ_OK) {
    if (now - lastHealth >= HEALTH_MS) {
      lastHealth = now;
      checkHealth();
    }
    if (pajState == PAJ_OK && now - lastPoll >= POLL_MS) {
      lastPoll = now;
      pollGesture();
      pollHover();
    }
  } else if (now - lastRetry >= RETRY_MS) {
    lastRetry = now;
    connectSensor();
  }

  if (millis() - lastHeartbeat >= HEARTBEAT_MS) heartbeat();
  updateLed();
  delay(1);
}
