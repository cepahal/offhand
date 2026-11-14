import { describe, expect, it } from 'vitest';
import { linkHealth } from '../src/gesture/module.js';
import { describePorts, pickEsp32Port, type LinkStatus } from '../src/gesture/link.js';

describe('port detection', () => {
  const ports = [
    { path: 'COM1', manufacturer: '(Standard port types)' },
    { path: 'COM7', vendorId: '10C4', productId: 'EA60', manufacturer: 'Silicon Labs' },
  ];
  it('picks the USB-UART bridge an ESP32 dev board uses', () => {
    expect(pickEsp32Port(ports)?.path).toBe('COM7');
    expect(pickEsp32Port([{ path: '/dev/ttyUSB0', vendorId: '1a86', productId: '7523' }])?.path).toBe('/dev/ttyUSB0');
  });
  it('returns nothing when no ESP32 is plugged in', () => {
    expect(pickEsp32Port([ports[0]!])).toBeUndefined();
    expect(pickEsp32Port([])).toBeUndefined();
  });
  it('describes ports for the "no ESP32" message', () => {
    expect(describePorts([])).toBe('none');
    expect(describePorts(ports)).toContain('COM7 [Silicon Labs CP210x 10c4:EA60]');
  });
});

describe('linkHealth', () => {
  const s = (state: LinkStatus['state'], paj: LinkStatus['paj'] = 'unknown'): LinkStatus => ({
    state,
    paj,
    detail: 'd',
    since: 0,
  });
  it('maps no hardware to mock (keyboard)', () => {
    expect(linkHealth(s('no_device')).status).toBe('mock');
    expect(linkHealth(s('off')).status).toBe('mock');
  });
  it('maps a live board with a working sensor to live', () => {
    expect(linkHealth(s('live', 'ok')).status).toBe('live');
  });
  it('maps a live board without its sensor to error', () => {
    expect(linkHealth(s('live', 'missing')).status).toBe('error');
    expect(linkHealth(s('live', 'lost')).status).toBe('error');
  });
  it('maps lost/silent links to error', () => {
    expect(linkHealth(s('lost')).status).toBe('error');
    expect(linkHealth(s('silent')).status).toBe('error');
  });
});
