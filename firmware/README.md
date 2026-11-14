# offhand gesture board firmware

One Arduino sketch: `offhand_gesture/offhand_gesture.ino` (ESP32 + PAJ7620U2).
TO RUN: cd C:\Users\grant\Downloads\hoverscan\offhand; corepack pnpm dev
## Wiring

| PAJ7620U2 breakout | ESP32 DevKit |
| ------------------ | ------------ |
| VIN / VCC          | 3V3 (not 5 V)|
| GND                | GND          |
| SDA                | GPIO21       |
| SCL                | GPIO22       |
| INT                | not used (polled) |

## Flash (Arduino IDE 2.x)

1. Boards Manager: **esp32 by Espressif** 3.x. Board: **ESP32 Dev Module**.
2. Library Manager: **RevEng PAJ7620** (MIT, Aaron S. Crandall). Nothing else.
3. Open `offhand_gesture/offhand_gesture.ino`, Upload.
4. Serial Monitor at **115200**, line ending **Newline**.

Compile-checked on 2026-11-10 with arduino-cli, esp32 core 3.3.12, RevEng PAJ7620 1.5.0:
`esp32:esp32:esp32` 317,768 bytes (24 % flash). `esp32:esp32:esp32s3` also builds.

## What you see in the Serial Monitor

Lines starting `#` are human test output. Lines starting `{` are the JSON the hub reads.

Example (abridged; numbers vary):

```
# [BOOT] offhand-gesture 0.1.0  (offhand gesture board)
# [PASS] ESP32 alive: ESP32-D0WD-V3 rev 3, 2 core(s) @ 240 MHz, flash 4 MB, MAC ...
# [TEST] I2C scan on SDA=GPIO21 SCL=GPIO22 @ 400 kHz ...
# [FAIL] PAJ7620 NOT CONNECTED: no answer at I2C 0x73 (error 2: ...).
#        (wiring help follows)
# [WAIT] PAJ7620 still not connected (attempt 10, I2C error 2: ...)
# [PASS] PAJ7620 CONNECTED: chip ID 0x7620, initialised in 31 ms.
{"t":"g","g":"left","seq":1,"ms":53021}
# [GESTURE] SWIPE LEFT detected
# [GESTURE] SPIN detected: clockwise (cw)
# [GESTURE] SNAP detected (push + pull in 410 ms)
# [FAIL] PAJ7620 CONNECTION LOST: I2C error 2 (...). Gestures paused, retrying every 2 s.
{"t":"hb","fw":"offhand-gesture 0.1.0","ms":54000,"paj":"lost"}
# [PASS] PAJ7620 RECONNECTED after 4.2 s (re-initialised in 31 ms). Gestures resumed.
```

| Test case | How to trigger | Where it shows |
| --- | --- | --- |
| ESP32 alive / brown-out | power on / reset | `[PASS] ESP32 alive`, reset reason |
| No PAJ connected | boot with the sensor unplugged | `[FAIL] PAJ7620 NOT CONNECTED` + `[WAIT]` retries |
| Wrong chip at 0x73 | another device at 0x73 | `[FAIL] WRONG DEVICE` |
| Connection lost | pull SDA or VIN while running | `[FAIL] ... CONNECTION LOST`, then `RECONNECTED` |
| Swipe / push / pull / spin / wave | wave a hand ~5–15 cm over the sensor | `[GESTURE] ...` |
| Snap | push then pull within 600 ms | `[GESTURE] SNAP detected` |
| Hover | hold a hand over the sensor | `[HOVER] hand entered/left view` (`verbose on` for x/y/z) |
| No ESP32 connected | host side: `pnpm gesture:monitor` with no board | `[link:NO_DEVICE] No ESP32 connected` |
| Port busy | Arduino Serial Monitor still open | `[link:ERROR] ... is busy. Close the Arduino Serial Monitor` |
| Board silent / wrong firmware | wrong sketch or baud | `[link:SILENT] ...` |
| USB unplugged | unplug while running | `[link:LOST] Connection lost: COMx disconnected` |

"SNAP" is not a contract gesture: the PAJ7620 sees infrared reflections and cannot hear a finger
snap, so the sketch reports a fast push-then-pull as SNAP on the `#` line only.

Commands (type in the Serial Monitor): `help`, `status`, `selftest`, `scan`, `reinit`,
`verbose on|off`, `hover on|off`, `rotate 0|90|180|270`, `mirror on|off`, `speed normal|game`,
`sim <gesture|snap|lost>`, `factory`. Settings persist in flash.

## Host-side monitor (no browser needed)

Close the Arduino Serial Monitor first (only one program can own the port), then:

```
pnpm gesture:monitor            # auto-detect the ESP32 (CP210x / CH340 / FTDI / Espressif USB)
pnpm gesture:monitor --list     # list serial ports
pnpm gesture:monitor --port COM7
```

It prints link state, the board's `#` test lines, parsed gestures and the viewer commands
each gesture maps to.
