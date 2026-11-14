/**
 * Gesture gate for the scanner. The threshold matches the learned classifier.
 * Sample files under data/gesture-samples/ can raise it when the recorded scores are tight.
 *
 * TODO(verify): firmware names are up, down, left, right, forward, backward, cw, ccw, wave.
 * hold is not a firmware gesture.
 */
export const CONFIDENCE_MIN = 0.72;

/** Use the lower quartile of recorded confidences when it is stricter than the default. */
export function thresholdFromSamples(confidences: readonly number[]): number {
  if (confidences.length < 4) return CONFIDENCE_MIN;
  const sorted = [...confidences].sort((a, b) => a - b);
  const quartile = sorted[Math.floor(sorted.length * 0.25)] ?? CONFIDENCE_MIN;
  return Math.max(CONFIDENCE_MIN, Math.min(0.95, quartile));
}

export function gestureAccepted(confidence: number, samples: readonly number[] = []): boolean {
  return confidence >= thresholdFromSamples(samples);
}
