/**
 * Coach session intro builder.
 *
 * Produces a warm, kid-friendly greeting for the AI coach to speak/display
 * at the start of a coaching session. Never quotes teacher focus text
 * verbatim — always paraphrases into student-friendly language.
 */

export interface CoachIntroInput {
  /** Student's full name (e.g. "Ethan Park") */
  studentName: string;
  /** Preferred name if set by teacher (e.g. "Ethan") */
  preferredName?: string;
  /** Pronouns if available (e.g. "he/him") — used only when present */
  pronouns?: string;
  /** Assignment/lesson title (e.g. "Exploring the Ocean") */
  assignmentTitle?: string;
  /** Teacher-written or system-generated session focus text */
  sessionFocus?: string;
  /** Session type: "support", "enrichment", or "general" */
  sessionType: "support" | "enrichment" | "general";
}

/**
 * Get the name the coach should use when speaking to the student.
 * Preferred name > first token of full name. Never uses last name.
 */
export function getCoachName(studentName: string, preferredName?: string): string {
  if (preferredName?.trim()) return preferredName.trim();
  // Take only the first word of the full name
  return studentName.trim().split(/\s+/)[0] || studentName.trim();
}

/**
 * Paraphrase the teacher's focus text into casual, student-friendly language.
 * Returns 1–2 short sentences. If empty, returns a generic fallback.
 */
function paraphraseFocus(sessionFocus: string | undefined, assignmentTitle: string | undefined): string {
  if (!sessionFocus?.trim()) {
    if (assignmentTitle) {
      return `We'll review a couple ideas from ${assignmentTitle} and practice explaining your thinking.`;
    }
    return "We'll review a couple ideas from this assignment and practice explaining your thinking.";
  }

  const raw = sessionFocus.trim();

  // Strip leading "Session focus:" label if present (from our save format)
  const cleaned = raw.replace(/^Session focus:\s*/i, "");

  // If it's a multi-line bullet list, combine the first two points
  const lines = cleaned.split(/\n+/).map((l) => l.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);

  if (lines.length > 1) {
    // Take first two points, lowercase the start, join naturally
    const first = lowercaseStart(lines[0].replace(/\.$/, ""));
    const second = lowercaseStart(lines[1].replace(/\.$/, ""));
    return `We'll work on ${first}, and also ${second}.`;
  }

  // Single line — convert to "We'll work on …" framing
  const single = lowercaseStart(cleaned.replace(/\.$/, ""));

  // If it already starts with a verb phrase that fits, use it directly
  if (/^(practice|work on|focus on|try|review)/i.test(single)) {
    return `We'll ${single}.`;
  }

  return `We'll work on ${single}.`;
}

function lowercaseStart(s: string): string {
  if (!s) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/**
 * Build the full coach intro message.
 *
 * Structure:
 * 1. Greeting + name
 * 2. Welcoming line
 * 3. Frame as practice/help
 * 4. Focus summary (paraphrased)
 * 5. Encouragement
 */
export function buildCoachIntro(input: CoachIntroInput): string {
  const name = getCoachName(input.studentName, input.preferredName);
  const focus = paraphraseFocus(input.sessionFocus, input.assignmentTitle);

  // Greeting
  const greeting = `Hey ${name}!`;

  // Welcome line
  const welcome = "Welcome back.";

  // Frame — varies by session type
  let frame: string;
  if (input.sessionType === "support") {
    if (input.assignmentTitle) {
      frame = `Today we're going to practice a little more with ${input.assignmentTitle}.`;
    } else {
      frame = "Today we're going to practice together.";
    }
  } else if (input.sessionType === "enrichment") {
    if (input.assignmentTitle) {
      frame = `Today we're going to dig deeper into ${input.assignmentTitle}.`;
    } else {
      frame = "Today we're going to explore some extra challenges.";
    }
  } else {
    frame = "I'm here to help you learn today.";
  }

  // Encouragement
  const encouragement = "You don't have to be perfect — just try your best and I'll help along the way.";

  return `${greeting} ${welcome} ${frame} ${focus} ${encouragement}`;
}
