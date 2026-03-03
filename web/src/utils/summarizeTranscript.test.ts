import {
  cleanStudentUtterance,
  summarizeStudentTranscript,
  hasForeignKeyword,
  buildEvidenceSummary,
  formatEvidenceSummary,
  TranscriptTurn,
} from "./summarizeTranscript";

// ── cleanStudentUtterance ──────────────────────────────────────────────────

describe("cleanStudentUtterance", () => {
  it("strips inline filler words", () => {
    const result = cleanStudentUtterance("um like the sun basically gives us warmth");
    expect(result).toBe("The sun gives us warmth.");
    expect(result).not.toMatch(/\bum\b/i);
    expect(result).not.toMatch(/\blike\b/i);
    expect(result).not.toMatch(/\bbasically\b/i);
  });

  it("returns empty for filler-only input", () => {
    expect(cleanStudentUtterance("um")).toBe("");
    expect(cleanStudentUtterance("uh yeah ok")).toBe("");
    expect(cleanStudentUtterance("i don't know")).toBe("");
    expect(cleanStudentUtterance("no speech detected")).toBe("");
  });

  it("capitalizes first letter", () => {
    const result = cleanStudentUtterance("the planets orbit the sun");
    expect(result).toMatch(/^T/);
  });

  it("ensures ending punctuation", () => {
    const result = cleanStudentUtterance("the sun is hot");
    expect(result).toMatch(/[.!?]$/);
  });

  it("preserves existing ending punctuation", () => {
    expect(cleanStudentUtterance("Is the sun hot?")).toBe("Is the sun hot?");
    expect(cleanStudentUtterance("The sun is hot!")).toBe("The sun is hot!");
  });

  it("handles empty and whitespace input", () => {
    expect(cleanStudentUtterance("")).toBe("");
    expect(cleanStudentUtterance("   ")).toBe("");
  });

  it("strips leading/trailing punctuation debris", () => {
    const result = cleanStudentUtterance(", — the sun gives heat,");
    expect(result).not.toMatch(/^[,;—–-]/);
    expect(result).not.toMatch(/[,;—–-]$/);
  });

  it("collapses multiple spaces", () => {
    const result = cleanStudentUtterance("the    sun    is    bright");
    expect(result).not.toContain("  ");
  });
});

// ── summarizeStudentTranscript ─────────────────────────────────────────────

describe("summarizeStudentTranscript", () => {
  const coachTurn = (msg: string): TranscriptTurn => ({ role: "coach", message: msg });
  const studentTurn = (msg: string): TranscriptTurn => ({ role: "student", message: msg });

  it("returns fallback for empty turns", () => {
    const result = summarizeStudentTranscript([]);
    expect(result).toContain("didn't get to hear");
  });

  it("returns fallback when all student turns are filler", () => {
    const turns = [
      coachTurn("Why is the sun important?"),
      studentTurn("um"),
      studentTurn("uh yeah ok"),
    ];
    const result = summarizeStudentTranscript(turns);
    expect(result).toContain("didn't get to hear");
  });

  it("never contains raw '...'", () => {
    const turns = [
      coachTurn("What do you know about the sun?"),
      studentTurn("um like well I think basically the sun gives off heat and light to all the planets in our solar system and that is important"),
    ];
    const result = summarizeStudentTranscript(turns);
    expect(result).not.toContain("...");
  });

  it("never contains filler words in output", () => {
    const turns = [
      coachTurn("Tell me about the sun."),
      studentTurn("um like basically the sun is really hot and it gives us light"),
    ];
    const result = summarizeStudentTranscript(turns);
    expect(result).not.toMatch(/\bum\b/i);
    expect(result).not.toMatch(/\bbasically\b/i);
  });

  it("produces max 4 sentences", () => {
    const turns = [
      coachTurn("Q1"),
      studentTurn("The sun is a star that gives off heat"),
      coachTurn("Q2"),
      studentTurn("Planets orbit around the sun because of gravity"),
      coachTurn("Q3"),
      studentTurn("Mercury is closest to the sun"),
    ];
    const result = summarizeStudentTranscript(turns);
    const sentences = result.split(/[.!?]/).filter(s => s.trim().length > 0);
    expect(sentences.length).toBeLessThanOrEqual(4);
  });

  it("handles single substantive turn about warmth", () => {
    const turns = [
      coachTurn("What does the sun do?"),
      studentTurn("The sun gives us warmth and heat"),
    ];
    const result = summarizeStudentTranscript(turns);
    expect(result).toMatch(/warmth/i);
    expect(result).toMatch(/heat/i);
    expect(result).toMatch(/[.!?]$/);
  });

  it("handles two substantive turns (warmth + plants)", () => {
    const turns = [
      coachTurn("What does the sun do?"),
      studentTurn("The sun gives us light and heat"),
      coachTurn("What else?"),
      studentTurn("It helps plants grow through photosynthesis"),
    ];
    const result = summarizeStudentTranscript(turns);
    expect(result).toMatch(/light|energy/i);
    expect(result).toMatch(/plant/i);
  });

  it("ignores coach turns completely", () => {
    const turns = [
      coachTurn("um like basically the sun is great"),
      studentTurn("The sun provides energy"),
    ];
    const result = summarizeStudentTranscript(turns);
    expect(result).not.toContain("the sun is great");
  });

  it("handles thin content without crashing", () => {
    const turns = [
      coachTurn("What do you think?"),
      studentTurn("it's hot"),
    ];
    const result = summarizeStudentTranscript(turns);
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toContain("...");
  });

  it("never mentions 'coaching session'", () => {
    const turns = [
      coachTurn("What do you know?"),
      studentTurn("The sun gives warmth and light to earth"),
    ];
    const result = summarizeStudentTranscript(turns);
    expect(result).not.toMatch(/coaching session/i);
  });

  it("produces clean sentences for minimal content", () => {
    const turns = [
      coachTurn("Why is the sun important?"),
      studentTurn("uh it gives heat"),
    ];
    const result = summarizeStudentTranscript(turns);
    expect(result).not.toMatch(/\buh\b/i);
    expect(result).toMatch(/[.!?]$/);
    expect(result.length).toBeGreaterThan(10);
  });

  it("rewrites photosynthesis mention into clean summary", () => {
    const turns = [
      coachTurn("What does the sun do for living things?"),
      studentTurn("um the plants they need um sunlight for photosynthesis so they can grow"),
    ];
    const result = summarizeStudentTranscript(turns);
    expect(result).toMatch(/plant/i);
    expect(result).not.toMatch(/\bum\b/i);
    expect(result).toMatch(/[.!?]$/);
  });

  it("rewrites distance/temperature discussion into clean summary", () => {
    const turns = [
      coachTurn("How does distance from the sun matter?"),
      studentTurn("like mercury is really close so its hot and neptune is far away so its cold"),
    ];
    const result = summarizeStudentTranscript(turns);
    expect(result).toMatch(/distance/i);
    expect(result).not.toMatch(/^like\b/i);
    expect(result).toMatch(/[.!?]$/);
  });

  it("handles orbit and gravity discussion", () => {
    const turns = [
      coachTurn("What keeps planets around the sun?"),
      studentTurn("gravity from the sun pulls on the planets and makes them orbit"),
    ];
    const result = summarizeStudentTranscript(turns);
    expect(result).toMatch(/orbit|gravity/i);
    expect(result).toMatch(/[.!?]$/);
  });

  it("produces 2-4 sentences for multi-topic discussion", () => {
    const turns = [
      coachTurn("Tell me about the sun."),
      studentTurn("The sun gives warmth and heat to Earth"),
      coachTurn("What else does it do?"),
      studentTurn("It also has gravity that keeps planets in orbit"),
      coachTurn("Anything else?"),
      studentTurn("And plants need sunlight to grow"),
    ];
    const result = summarizeStudentTranscript(turns);
    const sentences = result.split(/[.!?]/).filter(s => s.trim().length > 0);
    expect(sentences.length).toBeGreaterThanOrEqual(2);
    expect(sentences.length).toBeLessThanOrEqual(4);
  });

  it("never uses 'You said' phrasing", () => {
    const turns = [
      coachTurn("What does the sun do?"),
      studentTurn("The sun provides warmth and heat to the planets"),
      coachTurn("What else?"),
      studentTurn("It also helps plants grow with photosynthesis"),
    ];
    const result = summarizeStudentTranscript(turns);
    expect(result).not.toMatch(/you said/i);
  });

  it("does not use raw student phrasing — rewrites into clean English", () => {
    const turns = [
      coachTurn("What does the sun do?"),
      studentTurn("um the sun it like gives off um heat and stuff to the planets yeah"),
    ];
    const result = summarizeStudentTranscript(turns);
    expect(result).not.toContain("and stuff");
    expect(result).not.toContain("yeah");
    expect(result).not.toMatch(/\bum\b/i);
    expect(result).toMatch(/[.!?]$/);
  });

  // ── Natural paragraph format tests ──

  it("does not start every sentence with 'You'", () => {
    const turns = [
      coachTurn("Q"),
      studentTurn("The sun gives warmth and heat"),
      coachTurn("Q"),
      studentTurn("Gravity keeps planets in orbit"),
    ];
    const result = summarizeStudentTranscript(turns);
    const sentences = result.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
    const youStarts = sentences.filter(s => /^You\b/i.test(s.trim()));
    expect(youStarts.length).toBeLessThan(sentences.length);
  });

  it("never has three consecutive sentences starting with the same word", () => {
    const turns = [
      coachTurn("Q1"),
      studentTurn("The sun gives warmth and heat to Earth"),
      coachTurn("Q2"),
      studentTurn("Gravity keeps planets in orbit around the sun"),
      coachTurn("Q3"),
      studentTurn("Plants need sunlight to grow food"),
    ];
    const result = summarizeStudentTranscript(turns);
    const sentences = result.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
    for (let i = 0; i < sentences.length - 2; i++) {
      const w1 = sentences[i].split(/\s+/)[0];
      const w2 = sentences[i + 1].split(/\s+/)[0];
      const w3 = sentences[i + 2].split(/\s+/)[0];
      expect(w1 === w2 && w2 === w3).toBe(false);
    }
  });

  it("uses hedged language for weak topic matches (single keyword)", () => {
    const turns = [
      coachTurn("Tell me about the sun"),
      studentTurn("I think it is probably a really big star in space"), // 3+ content words but only 1 topic keyword: "star"
    ];
    const result = summarizeStudentTranscript(turns);
    expect(result).toMatch(/briefly|hinted|mentioned/i);
  });

  it("produces a single paragraph (no line breaks or bullets)", () => {
    const turns = [
      coachTurn("Q"),
      studentTurn("The sun gives warmth and heat"),
      coachTurn("Q"),
      studentTurn("Gravity keeps planets in orbit"),
      coachTurn("Q"),
      studentTurn("Plants need sunlight"),
    ];
    const result = summarizeStudentTranscript(turns);
    expect(result).not.toContain("\n");
    expect(result).not.toContain("- ");
    expect(result).not.toContain("* ");
  });

  it("does not invent facts not in the transcript", () => {
    const turns = [
      coachTurn("What does the sun do?"),
      studentTurn("It gives warmth"),
    ];
    const result = summarizeStudentTranscript(turns);
    // Should only mention warmth/heat, not orbit/gravity/plants
    expect(result).not.toMatch(/orbit|gravity|plant/i);
  });

  it("uses confident language for strong topic matches (2+ keywords)", () => {
    const turns = [
      coachTurn("Q"),
      studentTurn("The sun gives warmth and heat and temperature is important"), // 3 keyword hits
    ];
    const result = summarizeStudentTranscript(turns);
    // Strong match should use "covered" not "briefly mentioned"
    expect(result).toMatch(/covered/i);
    expect(result).not.toMatch(/briefly|hinted/i);
  });
});

// ── hasForeignKeyword ────────────────────────────────────────────────────────

describe("hasForeignKeyword", () => {
  it("detects 'sun' as foreign in a subtraction context", () => {
    expect(hasForeignKeyword(
      "the sun is essential for life on Earth",
      "What is 15 minus 8?"
    )).toBe(true);
  });

  it("does NOT flag 'sun' in a solar system context", () => {
    expect(hasForeignKeyword(
      "the sun is essential for life on Earth",
      "Why is the sun important to the planets?"
    )).toBe(false);
  });

  it("detects 'orbit' as foreign in a reading comprehension context", () => {
    expect(hasForeignKeyword(
      "gravity keeps planets in orbit",
      "What happened to the main character in the story?"
    )).toBe(true);
  });

  it("detects 'subtraction' as foreign in a science context", () => {
    expect(hasForeignKeyword(
      "the student practiced subtraction",
      "How do plants make food from sunlight?"
    )).toBe(true);
  });

  it("returns false when no foreign keywords present", () => {
    expect(hasForeignKeyword(
      "the student shared some ideas about the topic",
      "What do you think about this?"
    )).toBe(false);
  });
});

// ── Foreign keyword filtering in summarizeStudentTranscript ──────────────────

describe("summarizeStudentTranscript — foreign keyword filtering", () => {
  const coachTurn = (msg: string): TranscriptTurn => ({ role: "coach", message: msg });
  const studentTurn = (msg: string): TranscriptTurn => ({ role: "student", message: msg });

  it("REGRESSION: 'sun' must NOT appear in subtraction lesson summary", () => {
    const turns = [
      coachTurn("What is 15 minus 8?"),
      studentTurn("I think the answer is like seven because you take away the life of the number"),
    ];
    const result = summarizeStudentTranscript(turns, "What is 15 minus 8?");
    expect(result).not.toMatch(/\bsun\b/i);
    expect(result).not.toMatch(/\bplanet/i);
    expect(result).not.toMatch(/\borbit/i);
    expect(result).not.toMatch(/\bsolar/i);
  });

  it("REGRESSION: 'sun' must NOT appear when student says 'life' or 'earth' in math", () => {
    const turns = [
      coachTurn("What is 24 divided by 6?"),
      studentTurn("Earth, I don't know, life is hard, let me think... four"),
    ];
    const result = summarizeStudentTranscript(turns, "What is 24 divided by 6?");
    expect(result).not.toMatch(/\bsun\b/i);
    expect(result).not.toMatch(/life on Earth/i);
  });

  it("preserves 'sun' topics when question IS about the sun", () => {
    const turns = [
      coachTurn("Why is the sun important?"),
      studentTurn("The sun gives warmth and light and life to Earth"),
    ];
    const result = summarizeStudentTranscript(turns, "Why is the sun important?");
    // Should mention the sun-related topics since they're on-topic
    expect(result).toMatch(/warmth|heat|light|life/i);
  });

  it("falls back to generic when all topics are foreign", () => {
    const turns = [
      coachTurn("How do you feel about reading?"),
      studentTurn("I like animals and living things and life on earth"),
    ];
    const result = summarizeStudentTranscript(turns, "How do you feel about reading?");
    // "life/living" pattern would fire, but "sun is essential for life on Earth"
    // contains "earth" which IS in student speech but "sun" is foreign.
    // If the template has foreign keywords, it gets filtered.
    expect(result).not.toMatch(/\bsun\b/i);
  });
});

// ── buildEvidenceSummary ─────────────────────────────────────────────────────

describe("buildEvidenceSummary", () => {
  const coachTurn = (msg: string): TranscriptTurn => ({ role: "coach", message: msg });
  const studentTurn = (msg: string): TranscriptTurn => ({ role: "student", message: msg });

  it("marks criteria as met when student speech has strong keyword overlap", () => {
    const turns = [
      coachTurn("Why is the sun important?"),
      studentTurn("The sun provides warmth and heat to all the planets"),
      studentTurn("Plants need sunlight for photosynthesis to grow food"),
    ];
    const criteria = [
      "Explains that the sun provides warmth and heat",
      "Describes how plants use sunlight for photosynthesis",
      "Discusses the water cycle and evaporation",
    ];
    const bullets = buildEvidenceSummary(turns, criteria);

    expect(bullets).toHaveLength(3);
    expect(bullets[0].status).toBe("met");
    expect(bullets[0].evidence).toBeDefined();
    expect(bullets[1].status).toBe("met");
    expect(bullets[1].evidence).toBeDefined();
    expect(bullets[2].status).toBe("not_addressed");
  });

  it("marks criteria as partial when few keywords overlap", () => {
    const turns = [
      coachTurn("What keeps planets around the sun?"),
      studentTurn("I think gravity pulls on stuff around it"),
    ];
    const criteria = [
      "Explains gravity and planets orbiting",
    ];
    const bullets = buildEvidenceSummary(turns, criteria);
    // "gravity" overlaps from criterion words ["explains", "gravity", "planets", "orbiting"]
    // ratio = 1/4 = 0.25, which is >= 0.2 → partial
    expect(["met", "partial"]).toContain(bullets[0].status);
  });

  it("returns all not_addressed when student says nothing relevant", () => {
    const turns = [
      coachTurn("Why is the sun important?"),
      studentTurn("um I don't know"),
    ];
    const criteria = [
      "Explains warmth and heat from the sun",
      "Describes gravity keeping planets in orbit",
    ];
    const bullets = buildEvidenceSummary(turns, criteria);

    expect(bullets.every(b => b.status === "not_addressed")).toBe(true);
  });

  it("returns all not_addressed for empty student turns", () => {
    const turns = [
      coachTurn("What do you think?"),
    ];
    const criteria = ["Explains the concept clearly"];
    const bullets = buildEvidenceSummary(turns, criteria);
    expect(bullets[0].status).toBe("not_addressed");
  });

  it("truncates long evidence to 80 chars", () => {
    const longResponse = "The sun is a really gigantic enormous massive incredible spectacular tremendous star that burns hydrogen fuel and produces heat light warmth and energy for everything";
    const turns = [
      coachTurn("Q"),
      studentTurn(longResponse),
    ];
    const criteria = ["Describes the sun as a star that burns hydrogen fuel"];
    const bullets = buildEvidenceSummary(turns, criteria);
    if (bullets[0].evidence) {
      expect(bullets[0].evidence.length).toBeLessThanOrEqual(80);
    }
  });
});

// ── formatEvidenceSummary ────────────────────────────────────────────────────

describe("formatEvidenceSummary", () => {
  it("produces summary with met and partial bullets", () => {
    const bullets = [
      { criterion: "Explains warmth from the sun", status: "met" as const, evidence: "The sun gives warmth." },
      { criterion: "Describes plant growth", status: "partial" as const, evidence: "Plants need light." },
      { criterion: "Discusses the water cycle", status: "not_addressed" as const },
    ];
    const result = formatEvidenceSummary(bullets);
    expect(result).toMatch(/demonstrated understanding/i);
    expect(result).toMatch(/began exploring/i);
    expect(result).toMatch(/\.$/);
  });

  it("handles all met criteria", () => {
    const bullets = [
      { criterion: "Explains warmth", status: "met" as const, evidence: "Warmth." },
      { criterion: "Describes light", status: "met" as const, evidence: "Light." },
    ];
    const result = formatEvidenceSummary(bullets);
    expect(result).toMatch(/demonstrated understanding/i);
    expect(result).not.toMatch(/began exploring/i);
  });

  it("returns generic fallback when all not_addressed", () => {
    const bullets = [
      { criterion: "Explains warmth", status: "not_addressed" as const },
      { criterion: "Describes gravity", status: "not_addressed" as const },
    ];
    const result = formatEvidenceSummary(bullets);
    expect(result).toMatch(/initial thinking|foundation/i);
  });

  it("limits to 2 items per category to keep summary concise", () => {
    const bullets = [
      { criterion: "First concept", status: "met" as const, evidence: "A." },
      { criterion: "Second concept", status: "met" as const, evidence: "B." },
      { criterion: "Third concept", status: "met" as const, evidence: "C." },
    ];
    const result = formatEvidenceSummary(bullets);
    // Should mention "Demonstrated understanding of" with at most 2 concepts
    expect(result).toMatch(/demonstrated understanding/i);
    // "third concept" should NOT appear (sliced to 2)
    expect(result).not.toMatch(/third concept/i);
  });
});
