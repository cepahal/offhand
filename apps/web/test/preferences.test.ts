import { describe, expect, it } from 'vitest';
import { observe, suggestFor } from '../src/viewer/preferences.js';

describe('surgeon view preferences', () => {
  it('suggests the view that surgeon uses most, and stays quiet until there is a habit', () => {
    let history = observe([], { surgeonId: 'ada', mode: 'scrub', plane: 'coronal' });
    history = observe(history, { surgeonId: 'ada', mode: 'scrub', plane: 'coronal' });
    expect(suggestFor(history, 'ada')).toBeNull();
    history = observe(history, { surgeonId: 'ada', mode: 'scrub', plane: 'coronal' });
    history = observe(history, { surgeonId: 'ada', mode: 'orbit', plane: 'axial' });
    const suggestion = suggestFor(history, 'ada');
    expect(suggestion?.mode).toBe('scrub');
    expect(suggestion?.plane).toBe('coronal');
    expect(suggestion?.text).toContain('Apply this view?');
    expect(suggestFor(history, 'bao')).toBeNull();
  });
});
