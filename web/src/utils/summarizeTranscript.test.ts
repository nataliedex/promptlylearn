import {
  cleanStudentUtterance,
  summarizeStudentTranscript,
  hasForeignKeyword,
  buildEvidenceSummary,
  formatEvidenceSummary,
  detectMathStrategy,
  buildNumbersSummary,
  buildMathStepSummary,
  extractPlanetMaterialPairs,
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

// ── summarizeStudentTranscript — criteria-based fallback for non-solar-system ─

describe("summarizeStudentTranscript — criteria-based fallback", () => {
  const coachTurn = (msg: string): TranscriptTurn => ({ role: "coach", message: msg });
  const studentTurn = (msg: string): TranscriptTurn => ({ role: "student", message: msg });

  it("uses evidence summary for math subtraction lesson", () => {
    const turns = [
      coachTurn("How would you subtract 8, 3, and 2?"),
      studentTurn("First I subtract 3 from 8 and get 5"),
      coachTurn("What next?"),
      studentTurn("Then I subtract 2 from 5 and get 3"),
    ];
    const criteria = [
      "Describe how to subtract 8, 3, and 2 step by step.",
      "Explain that you start with 8 and subtract the other numbers from it.",
    ];
    const result = summarizeStudentTranscript(turns, "How would you subtract 8, 3, and 2?", criteria);
    // Should NOT be the generic fallback
    expect(result).not.toBe("Some thinking was shared on this topic, making a good start at exploring the key ideas.");
    expect(result).toMatch(/understanding|exploring/i);
  });

  it("uses numbers-only summary when math transcript has numbers but no strategy keywords", () => {
    const turns = [
      coachTurn("How do you subtract 8, 3, and 2?"),
      studentTurn("I would take 3 away from 8 first"),
      coachTurn("Good, then what?"),
      studentTurn("Then take 2 away from 5"),
    ];
    const result = summarizeStudentTranscript(turns, "How do you subtract 8, 3, and 2?");
    // Numbers present but no strategy keyword → numbers-only summary
    expect(result).toMatch(/numbers/i);
  });

  it("still uses topic patterns for solar system content", () => {
    const turns = [
      coachTurn("Why is the sun important?"),
      studentTurn("The sun gives warmth and heat to Earth"),
    ];
    const result = summarizeStudentTranscript(turns, "Why is the sun important?");
    expect(result).toMatch(/warmth/i);
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

// ── detectMathStrategy ───────────────────────────────────────────────────────

describe("detectMathStrategy", () => {
  it("detects break-apart with 'break up' and extracts broken number and answer", () => {
    const result = detectMathStrategy(
      "I would break up that 25 into a 20 and a 5 so I would do 34 + 20 = 54 and then add the 5 to get 59."
    );
    expect(result).not.toBeNull();
    expect(result!.type).toBe("break-apart");
    expect(result!.summary).toMatch(/break-apart/i);
    expect(result!.summary).toMatch(/25/);
    expect(result!.summary).toMatch(/59/);
    expect(result!.verified).toBe(false);
  });

  it("detects break-apart with 'split'", () => {
    const result = detectMathStrategy("I split 15 into 10 and 5 and then added them to 20 to get 35.");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("break-apart");
    expect(result!.summary).toMatch(/15/);
    expect(result!.summary).toMatch(/35/);
  });

  it("detects break-apart with 'tens and ones'", () => {
    const result = detectMathStrategy("I used the tens and ones to add 47 and 38 to get 85.");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("break-apart");
    expect(result!.summary).toMatch(/85/);
  });

  it("detects tens-then-ones strategy", () => {
    const result = detectMathStrategy("I add the tens first, 30 + 40 = 70, then add the ones, 7 + 8 = 15.");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("tens-then-ones");
    expect(result!.summary).toMatch(/tens first/i);
    expect(result!.summary).toMatch(/15/);
  });

  it("detects 'tens first' shorthand", () => {
    const result = detectMathStrategy("I did the tens first. 20 plus 30 is 50 then 4 plus 3 is 7 so 57.");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("tens-then-ones");
  });

  it("detects verification with 'backwards'", () => {
    const result = detectMathStrategy("I break up 25 into 20 and 5. 34 + 20 is 54, add 5 to get 59. I checked it backwards.");
    expect(result).not.toBeNull();
    expect(result!.verified).toBe(true);
    expect(result!.summary).toMatch(/checked.*subtraction/i);
  });

  it("detects verification with 'check my answer'", () => {
    const result = detectMathStrategy("I split 12 into 10 and 2. To check my answer I subtracted.");
    expect(result).not.toBeNull();
    expect(result!.verified).toBe(true);
    expect(result!.summary).toMatch(/checked.*subtraction/i);
  });

  it("returns null when no numbers present", () => {
    expect(detectMathStrategy("I think the answer is a lot")).toBeNull();
  });

  it("returns null when numbers present but no strategy keywords", () => {
    expect(detectMathStrategy("I got 5 and then 3")).toBeNull();
  });
});

// ── buildNumbersSummary ──────────────────────────────────────────────────────

describe("buildNumbersSummary", () => {
  it("produces summary with answer from 'get' keyword", () => {
    const result = buildNumbersSummary("I did 34 plus 25 to get 59");
    expect(result).not.toBeNull();
    expect(result).toMatch(/59/);
    expect(result).toMatch(/numbers/i);
  });

  it("uses last number as answer when no 'get' keyword", () => {
    const result = buildNumbersSummary("34 plus 25 is 59");
    expect(result).not.toBeNull();
    expect(result).toMatch(/59/);
  });

  it("returns null when fewer than 2 numbers", () => {
    expect(buildNumbersSummary("The answer is 5")).toBeNull();
  });

  it("returns null when no numbers", () => {
    expect(buildNumbersSummary("I think the answer is a lot")).toBeNull();
  });
});

// ── summarizeStudentTranscript — math strategy integration ───────────────────

describe("summarizeStudentTranscript — math strategy detection", () => {
  const coachTurn = (msg: string): TranscriptTurn => ({ role: "coach", message: msg });
  const studentTurn = (msg: string): TranscriptTurn => ({ role: "student", message: msg });

  it("produces strategy summary for break-apart transcript", () => {
    const turns = [
      coachTurn("What is 34 + 25?"),
      studentTurn("I would break up that 25 into a 20 and a 5 so I would do 34 + 20 = 54 and then add the 5 to get 59"),
    ];
    const result = summarizeStudentTranscript(turns, "What is 34 + 25?");
    expect(result).toMatch(/break-apart/i);
    expect(result).toMatch(/25/);
    expect(result).toMatch(/59/);
    // Should NOT be the generic fallback
    expect(result).not.toMatch(/some thinking was shared/i);
    expect(result).not.toMatch(/exchanges/i);
  });

  it("produces strategy summary for tens-then-ones transcript", () => {
    const turns = [
      coachTurn("What is 47 + 38?"),
      studentTurn("I add the tens first 40 + 30 = 70 then add the ones 7 + 8 = 15 so 85"),
    ];
    const result = summarizeStudentTranscript(turns, "What is 47 + 38?");
    expect(result).toMatch(/tens first/i);
    expect(result).toMatch(/85/);
  });

  it("includes verification when student checks backwards", () => {
    const turns = [
      coachTurn("What is 34 + 25?"),
      studentTurn("I break up 25 into 20 and 5. 34 + 20 is 54, add 5 to get 59. I checked it backwards with subtraction."),
    ];
    const result = summarizeStudentTranscript(turns, "What is 34 + 25?");
    expect(result).toMatch(/break-apart/i);
    expect(result).toMatch(/checked.*subtraction/i);
  });

  it("produces numbers-only summary when math numbers present but no strategy", () => {
    const turns = [
      coachTurn("What is 12 + 7?"),
      studentTurn("12 and 7 makes 19"),
    ];
    const result = summarizeStudentTranscript(turns, "What is 12 + 7?");
    expect(result).toMatch(/19/);
    expect(result).toMatch(/numbers/i);
  });

  it("strategy detection takes priority over evidence-based", () => {
    const turns = [
      coachTurn("What is 34 + 25?"),
      studentTurn("I would break up that 25 into a 20 and a 5 and get 59"),
    ];
    const criteria = ["Show addition step by step"];
    const result = summarizeStudentTranscript(turns, "What is 34 + 25?", criteria);
    // Strategy should win over evidence-based
    expect(result).toMatch(/break-apart/i);
  });

  it("does NOT detect strategy in non-math solar system transcript", () => {
    const turns = [
      coachTurn("Why is the sun important?"),
      studentTurn("The sun gives warmth and heat to all the planets"),
    ];
    const result = summarizeStudentTranscript(turns, "Why is the sun important?");
    // Should use topic-based summary, not strategy
    expect(result).not.toMatch(/break-apart|tens first|numbers/i);
    expect(result).toMatch(/warmth|heat/i);
  });
});

// ── extractPlanetMaterialPairs ────────────────────────────────────────────────

describe("extractPlanetMaterialPairs", () => {
  it("extracts Earth + rock from 'Earth is made of rock'", () => {
    const pairs = extractPlanetMaterialPairs("Earth is made of rock");
    expect(pairs).toEqual(
      expect.arrayContaining([{ planet: "Earth", material: "rock" }]),
    );
  });

  it("extracts Jupiter + gas from 'Jupiter is a gas giant'", () => {
    const pairs = extractPlanetMaterialPairs("Jupiter is a gas giant");
    expect(pairs).toEqual(
      expect.arrayContaining([{ planet: "Jupiter", material: "gas" }]),
    );
  });

  it("extracts multiple planet-material pairs", () => {
    const pairs = extractPlanetMaterialPairs(
      "Earth is rocky and Jupiter is made of gas",
    );
    expect(pairs.length).toBeGreaterThanOrEqual(2);
    const planets = pairs.map(p => p.planet);
    expect(planets).toContain("Earth");
    expect(planets).toContain("Jupiter");
  });

  it("returns empty for no planet content", () => {
    const pairs = extractPlanetMaterialPairs("I don't know what planets are made of");
    expect(pairs).toHaveLength(0);
  });

  it("normalizes 'rocky' to 'rock'", () => {
    const pairs = extractPlanetMaterialPairs("Mars is rocky");
    expect(pairs).toEqual(
      expect.arrayContaining([{ planet: "Mars", material: "rock" }]),
    );
  });

  it("extracts Neptune + ice", () => {
    const pairs = extractPlanetMaterialPairs("Neptune is icy and cold");
    expect(pairs).toEqual(
      expect.arrayContaining([{ planet: "Neptune", material: "ice" }]),
    );
  });
});

// ── buildEvidenceSummary — planet-material integration ────────────────────────

describe("buildEvidenceSummary — planet-material pairs", () => {
  const coachTurn = (msg: string): TranscriptTurn => ({ role: "coach", message: msg });
  const studentTurn = (msg: string): TranscriptTurn => ({ role: "student", message: msg });

  it("includes planet-material pairs when student names Earth and Jupiter", () => {
    const turns = [
      coachTurn("Choose two planets and explain what they are made of."),
      studentTurn("Earth is made of rock and Jupiter is made of gas"),
    ];
    const criteria = ["Name two different planets and explain what each is made of"];
    const bullets = buildEvidenceSummary(turns, criteria);

    expect(bullets[0].status).toBe("met");
    expect(bullets[0].evidence).toContain("Earth");
    expect(bullets[0].evidence).toContain("Jupiter");
  });

  it("marks partial when only one planet-material pair", () => {
    const turns = [
      coachTurn("Choose two planets and explain what they are made of."),
      studentTurn("Earth is rocky"),
    ];
    const criteria = ["Name two different planets and explain what each is made of"];
    const bullets = buildEvidenceSummary(turns, criteria);

    expect(bullets[0].status).toBe("partial");
    expect(bullets[0].evidence).toContain("Earth");
  });

  it("formats evidence summary with planet names", () => {
    const turns = [
      coachTurn("Choose two planets and explain what they are made of."),
      studentTurn("Earth is made of rock and Jupiter is made of gas"),
    ];
    const criteria = ["Name two different planets and explain what each is made of"];
    const bullets = buildEvidenceSummary(turns, criteria);
    const summary = formatEvidenceSummary(bullets);

    expect(summary).toContain("Earth");
    expect(summary).toContain("Jupiter");
  });
});

// ── buildEvidenceSummary — all meta/confusion ────────────────────────────────

describe("buildEvidenceSummary — all meta/confusion", () => {
  const coachTurn = (msg: string): TranscriptTurn => ({ role: "coach", message: msg });
  const studentTurn = (msg: string): TranscriptTurn => ({ role: "student", message: msg });

  it("returns honest summary when all student speech is meta-confusion", () => {
    const turns = [
      coachTurn("Choose two planets and explain what they are made of."),
      studentTurn("What do you mean?"),
      studentTurn("I'm confused"),
      studentTurn("Can you repeat that?"),
    ];
    const criteria = ["Name two different planets"];
    const bullets = buildEvidenceSummary(turns, criteria);

    expect(bullets[0].status).toBe("not_addressed");
    expect(bullets[0].evidence).toMatch(/confusion/i);

    const summary = formatEvidenceSummary(bullets);
    expect(summary).toMatch(/confusion/i);
  });

  it("does NOT mark as confusion when real content exists", () => {
    const turns = [
      coachTurn("Choose two planets and explain what they are made of."),
      studentTurn("What do you mean?"),
      studentTurn("Earth is made of rock and Jupiter is gas"),
    ];
    const criteria = ["Name two different planets and explain materials"];
    const bullets = buildEvidenceSummary(turns, criteria);

    // Should find evidence, not be marked as all-meta
    expect(bullets[0].status).not.toBe("not_addressed");
  });
});

// ── buildMathStepSummary ──────────────────────────────────────────────────

describe("buildMathStepSummary", () => {
  it("extracts single equation", () => {
    const result = buildMathStepSummary("1 + 4 = 5");
    expect(result).toBeTruthy();
    expect(result).toContain("1 + 4 = 5");
  });

  it("extracts multiple equations with final answer", () => {
    const result = buildMathStepSummary("1 + 4 = 5 and then 10 + 10 = 20 and the answer is 25");
    expect(result).toBeTruthy();
    expect(result).toContain("1 + 4 = 5");
    expect(result).toContain("10 + 10 = 20");
    expect(result).toContain("25");
  });

  it("normalizes number words: 'five' → 5 in equations", () => {
    // "one plus four equals five" should be detected as "1 + 4 = 5" after normalization
    const result = buildMathStepSummary("I got five because one + four = five");
    expect(result).toBeTruthy();
    expect(result).toContain("1 + 4 = 5");
  });

  it("returns null when no equations present", () => {
    expect(buildMathStepSummary("I think it's a big number")).toBeNull();
  });

  it("returns null for pure filler", () => {
    expect(buildMathStepSummary("um well like I guess")).toBeNull();
  });
});

// ── Evidence-based summary for completed math explanation ──────────────────

describe("summarizeStudentTranscript — math step evidence", () => {
  it("produces evidence-based summary instead of generic for 'five'", () => {
    const turns: TranscriptTurn[] = [
      { role: "student", message: "25" },
      { role: "coach", message: "What do you get when you add 1 and 4?" },
      { role: "student", message: "1 + 4 = 5" },
      { role: "coach", message: "What do you get when you add 10 and 10?" },
      { role: "student", message: "10 + 10 = 20 and 20 + 5 = 25" },
    ];
    const result = summarizeStudentTranscript(turns, "Solve 11 + 14. Tell how you got your answer.");
    // Should NOT be generic
    expect(result).not.toContain("initial thinking");
    expect(result).not.toContain("initial thoughts");
    // Should contain concrete evidence
    expect(result).toMatch(/1\s*\+\s*4\s*=\s*5|10\s*\+\s*10\s*=\s*20|25/);
  });

  it("does not produce generic text for partial math explanation", () => {
    const turns: TranscriptTurn[] = [
      { role: "student", message: "25" },
      { role: "coach", message: "How did you get that?" },
      { role: "student", message: "1 + 4 = 5" },
    ];
    const result = summarizeStudentTranscript(turns, "Solve 11 + 14. Tell how you got your answer.");
    expect(result).not.toContain("initial thinking");
    expect(result).toMatch(/1\s*\+\s*4\s*=\s*5|25/);
  });
});

// ── formatEvidenceSummary with math step fallback ────────────────────────────

describe("formatEvidenceSummary — math step fallback", () => {
  const mathCriteria = [
    "States that 1 + 4 = 5",
    "States that 10 + 10 = 20",
    "States that the final answer is 25",
  ];

  it("uses math step evidence when all criteria are not_addressed", () => {
    // Criteria keyword matching fails because extractContentWords strips numbers.
    // But the allStudentText contains equations that buildMathStepSummary can extract.
    const bullets = mathCriteria.map(c => ({
      criterion: c,
      status: "not_addressed" as const,
    }));
    const result = formatEvidenceSummary(bullets, "25 and then 1 + 4 = 5 and 10 + 10 = 20");
    expect(result).not.toContain("initial thinking");
    expect(result).toMatch(/1\s*\+\s*4\s*=\s*5/);
    expect(result).toMatch(/10\s*\+\s*10\s*=\s*20/);
  });

  it("still uses generic fallback when no equations present", () => {
    const bullets = mathCriteria.map(c => ({
      criterion: c,
      status: "not_addressed" as const,
    }));
    const result = formatEvidenceSummary(bullets, "I like pizza");
    expect(result).toContain("initial thinking");
  });

  it("backward compatible: works without allStudentText", () => {
    const bullets = mathCriteria.map(c => ({
      criterion: c,
      status: "not_addressed" as const,
    }));
    const result = formatEvidenceSummary(bullets);
    expect(result).toContain("initial thinking");
  });
});

// ── Completed explanation produces evidence-based summary ────────────────────

describe("completed explanation summary", () => {
  it("ones-then-tens produces concrete evidence", () => {
    const text = "25 1 + 4 = 5 10 + 10 = 20 20 + 5 = 25";
    const result = buildMathStepSummary(text);
    expect(result).toBeTruthy();
    expect(result).toContain("1 + 4 = 5");
    expect(result).toContain("10 + 10 = 20");
    expect(result).toContain("25");
    expect(result).not.toContain("initial thinking");
  });

  it("tens-then-ones produces concrete evidence", () => {
    const text = "25 10 + 10 = 20 1 + 4 = 5 20 + 5 = 25";
    const result = buildMathStepSummary(text);
    expect(result).toBeTruthy();
    expect(result).toContain("10 + 10 = 20");
    expect(result).toContain("1 + 4 = 5");
  });

  it("partial ones-only produces concrete evidence with equation", () => {
    const text = "25 1 + 4 = 5";
    const result = buildMathStepSummary(text);
    expect(result).toBeTruthy();
    expect(result).toContain("1 + 4 = 5");
  });

  it("partial tens-only produces concrete evidence with equation", () => {
    const text = "25 10 + 10 = 20";
    const result = buildMathStepSummary(text);
    expect(result).toBeTruthy();
    expect(result).toContain("10 + 10 = 20");
  });

  it("PART 5: aggregates BOTH ones and tens equations across turns", () => {
    // Student says "1 + 4 = 5" in one turn and "10 + 10 = 20" in another
    const allStudentText = "five 1 + 4 = 5 the ones are 5 10 + 10 = 20 that's 25";
    const result = buildMathStepSummary(allStudentText);
    expect(result).toBeTruthy();
    expect(result).toContain("1 + 4 = 5");
    expect(result).toContain("10 + 10 = 20");
  });

  it("aggregates equations from separate turn concatenation", () => {
    // Simulates joining two turns: "1 + 4 = 5" and "10 + 10 = 20"
    const allStudentText = "1 + 4 = 5 10 + 10 = 20";
    const result = buildMathStepSummary(allStudentText);
    expect(result).toBeTruthy();
    expect(result).toContain("1 + 4 = 5");
    expect(result).toContain("10 + 10 = 20");
  });

  // ========================================================================
  // Summary accuracy regression tests (Request M)
  // ========================================================================

  it("Case A: '25' then '1 + 4 is 5 and 10 + 10 is 20' → summary includes both steps + 25", () => {
    // Student says "25" on turn 1, then explains both steps on turn 2
    const allStudentText = "25 1 + 4 = 5 and 10 + 10 = 20";
    const result = buildMathStepSummary(allStudentText);
    expect(result).toBeTruthy();
    expect(result).toContain("1 + 4 = 5");
    expect(result).toContain("10 + 10 = 20");
    // Should NOT say "to reach 5" — the final answer is 25
    expect(result).not.toMatch(/to reach 5[^0-9]/);
  });

  it("Case B: wrong answer '21' then corrections → summary ends with 25, not 5", () => {
    // Student starts wrong then self-corrects
    const allStudentText = "21 1 + 4 = 5 10 + 10 = 20 the answer should be 25";
    const result = buildMathStepSummary(allStudentText);
    expect(result).toBeTruthy();
    expect(result).toContain("1 + 4 = 5");
    expect(result).toContain("10 + 10 = 20");
    // Must use 25 as final answer, not 5
    expect(result).toContain("25");
    expect(result).not.toMatch(/to reach 5[^0-9]/);
  });

  it("deduplicates repeated '1 + 4 = 5' across turns", () => {
    // Student says the same equation in multiple turns
    const allStudentText = "1 + 4 = 5 and then 1 + 4 = 5 also 10 + 10 = 20";
    const result = buildMathStepSummary(allStudentText);
    expect(result).toBeTruthy();
    // "1 + 4 = 5" should appear exactly once in the summary
    const matches = result!.match(/1 \+ 4 = 5/g);
    expect(matches).toHaveLength(1);
    expect(result).toContain("10 + 10 = 20");
  });

  it("Case C: direct full explanation on first turn → correct summary", () => {
    const allStudentText = "1 + 4 = 5 10 + 10 = 20 the answer is 25";
    const result = buildMathStepSummary(allStudentText);
    expect(result).toBeTruthy();
    expect(result).toContain("1 + 4 = 5");
    expect(result).toContain("10 + 10 = 20");
    expect(result).toContain("25");
  });

  it("final answer comes from explicit 'the answer is' statement, not sub-step result", () => {
    // Make sure "the answer is 36" trumps sub-step result "6"
    const allStudentText = "4 + 2 = 6 20 + 10 = 30 the answer is 36";
    const result = buildMathStepSummary(allStudentText);
    expect(result).toBeTruthy();
    expect(result).toContain("36");
    expect(result).not.toMatch(/to reach 6[^0-9]/);
  });
});
