import {
  evaluateSilenceState,
  SILENCE_THRESHOLD,
  SPEECH_START_THRESHOLD,
  SILENCE_DURATION_MS,
  TRAILING_BUFFER_MS,
  MIN_SPEECH_BEFORE_SILENCE_MS,
  MAX_TURN_DURATION_S,
  GRACE_PERIOD_MS,
} from "./useVoiceConversation";

// ── Constants validation ────────────────────────────────────────────────────

describe("useVoiceConversation constants", () => {
  it("SILENCE_THRESHOLD is 0.015", () => {
    expect(SILENCE_THRESHOLD).toBe(0.015);
  });

  it("SPEECH_START_THRESHOLD is 0.025", () => {
    expect(SPEECH_START_THRESHOLD).toBe(0.025);
  });

  it("SILENCE_DURATION_MS is 1200", () => {
    expect(SILENCE_DURATION_MS).toBe(1200);
  });

  it("TRAILING_BUFFER_MS is 400", () => {
    expect(TRAILING_BUFFER_MS).toBe(400);
  });

  it("MIN_SPEECH_BEFORE_SILENCE_MS is 1500", () => {
    expect(MIN_SPEECH_BEFORE_SILENCE_MS).toBe(1500);
  });

  it("MAX_TURN_DURATION_S is 45", () => {
    expect(MAX_TURN_DURATION_S).toBe(45);
  });

  it("GRACE_PERIOD_MS is 800", () => {
    expect(GRACE_PERIOD_MS).toBe(800);
  });

  it("SPEECH_START_THRESHOLD > SILENCE_THRESHOLD (hysteresis)", () => {
    expect(SPEECH_START_THRESHOLD).toBeGreaterThan(SILENCE_THRESHOLD);
  });
});

// ── evaluateSilenceState ────────────────────────────────────────────────────

describe("evaluateSilenceState", () => {
  const BASE_TIME = 10000;

  // ── Grace period ──

  it("returns 'in_grace' when now < graceEndTime", () => {
    const result = evaluateSilenceState({
      rms: 0.001,
      speechDetected: false,
      speechStartTime: null,
      silenceStartTime: null,
      graceEndTime: BASE_TIME + 800,
      now: BASE_TIME + 200,
    });
    expect(result).toBe("in_grace");
  });

  it("returns 'in_grace' even with loud audio during grace", () => {
    const result = evaluateSilenceState({
      rms: 0.1,
      speechDetected: true,
      speechStartTime: BASE_TIME,
      silenceStartTime: null,
      graceEndTime: BASE_TIME + 800,
      now: BASE_TIME + 400,
    });
    expect(result).toBe("in_grace");
  });

  // ── Speech active ──

  it("returns 'speech_active' when rms > SPEECH_START_THRESHOLD", () => {
    const result = evaluateSilenceState({
      rms: 0.03,
      speechDetected: false,
      speechStartTime: null,
      silenceStartTime: null,
      graceEndTime: BASE_TIME,
      now: BASE_TIME + 1000,
    });
    expect(result).toBe("speech_active");
  });

  it("returns 'speech_active' regardless of other state when rms is high", () => {
    const result = evaluateSilenceState({
      rms: 0.05,
      speechDetected: true,
      speechStartTime: BASE_TIME,
      silenceStartTime: BASE_TIME + 500,
      graceEndTime: BASE_TIME,
      now: BASE_TIME + 5000,
    });
    expect(result).toBe("speech_active");
  });

  // ── Silence started ──

  it("returns 'silence_started' when first silence after sufficient speech", () => {
    const result = evaluateSilenceState({
      rms: 0.005,
      speechDetected: true,
      speechStartTime: BASE_TIME,
      silenceStartTime: null,
      graceEndTime: BASE_TIME,
      now: BASE_TIME + 2000, // 2s of speech > MIN_SPEECH_BEFORE_SILENCE_MS
    });
    expect(result).toBe("silence_started");
  });

  // ── Silence detected ──

  it("returns 'silence_detected' when silence exceeds SILENCE_DURATION_MS", () => {
    const silenceStart = BASE_TIME + 2000;
    const result = evaluateSilenceState({
      rms: 0.005,
      speechDetected: true,
      speechStartTime: BASE_TIME,
      silenceStartTime: silenceStart,
      graceEndTime: BASE_TIME,
      now: silenceStart + 1200, // exactly SILENCE_DURATION_MS
    });
    expect(result).toBe("silence_detected");
  });

  it("returns 'silence_detected' when silence well past threshold", () => {
    const silenceStart = BASE_TIME + 2000;
    const result = evaluateSilenceState({
      rms: 0.001,
      speechDetected: true,
      speechStartTime: BASE_TIME,
      silenceStartTime: silenceStart,
      graceEndTime: BASE_TIME,
      now: silenceStart + 3000,
    });
    expect(result).toBe("silence_detected");
  });

  // ── Waiting (default) ──

  it("returns 'waiting' when rms in between thresholds and no speech detected", () => {
    const result = evaluateSilenceState({
      rms: 0.02,
      speechDetected: false,
      speechStartTime: null,
      silenceStartTime: null,
      graceEndTime: BASE_TIME,
      now: BASE_TIME + 1000,
    });
    expect(result).toBe("waiting");
  });

  it("returns 'waiting' when silent but not enough speech time yet", () => {
    const result = evaluateSilenceState({
      rms: 0.005,
      speechDetected: true,
      speechStartTime: BASE_TIME + 500,
      silenceStartTime: null,
      graceEndTime: BASE_TIME,
      now: BASE_TIME + 1000, // only 500ms of speech < MIN_SPEECH_BEFORE_SILENCE_MS
    });
    expect(result).toBe("waiting");
  });

  it("returns 'waiting' when silent but speechDetected is false", () => {
    const result = evaluateSilenceState({
      rms: 0.005,
      speechDetected: false,
      speechStartTime: null,
      silenceStartTime: null,
      graceEndTime: BASE_TIME,
      now: BASE_TIME + 5000,
    });
    expect(result).toBe("waiting");
  });

  it("returns 'waiting' when silence ongoing but not yet long enough", () => {
    const silenceStart = BASE_TIME + 2000;
    const result = evaluateSilenceState({
      rms: 0.005,
      speechDetected: true,
      speechStartTime: BASE_TIME,
      silenceStartTime: silenceStart,
      graceEndTime: BASE_TIME,
      now: silenceStart + 500, // only 500ms of silence < SILENCE_DURATION_MS
    });
    expect(result).toBe("waiting");
  });

  // ── Boundary conditions ──

  it("returns 'waiting' at exactly MIN_SPEECH_BEFORE_SILENCE_MS - 1", () => {
    const result = evaluateSilenceState({
      rms: 0.005,
      speechDetected: true,
      speechStartTime: BASE_TIME,
      silenceStartTime: null,
      graceEndTime: BASE_TIME,
      now: BASE_TIME + 1499, // just under 1500ms
    });
    expect(result).toBe("waiting");
  });

  it("returns 'silence_started' at exactly MIN_SPEECH_BEFORE_SILENCE_MS", () => {
    const result = evaluateSilenceState({
      rms: 0.005,
      speechDetected: true,
      speechStartTime: BASE_TIME,
      silenceStartTime: null,
      graceEndTime: BASE_TIME,
      now: BASE_TIME + 1500,
    });
    expect(result).toBe("silence_started");
  });

  it("grace boundary: not in grace when now === graceEndTime", () => {
    const result = evaluateSilenceState({
      rms: 0.03,
      speechDetected: false,
      speechStartTime: null,
      silenceStartTime: null,
      graceEndTime: BASE_TIME + 800,
      now: BASE_TIME + 800,
    });
    // now is NOT < graceEndTime, so grace is over → speech_active
    expect(result).toBe("speech_active");
  });
});
