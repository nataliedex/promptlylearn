# Math Coaching Pipeline — Architecture & Contracts

## Pipeline Overview

```
Student utterance
       │
       ▼
┌──────────────────────┐
│  mathAnswerValidator  │  Parse utterance, extract numbers, detect strategies,
│                       │  accumulate step evidence across turns
└──────┬───────────────┘
       │  MathUtteranceInterpretation + ReasoningStepAccumulation
       ▼
┌──────────────────────────┐
│  deterministicRemediation │  Classify student state, select next coach move
│                           │  (pure functions, no LLM)
└──────┬───────────────────┘
       │  RemediationMove (type + text + metadata)
       ▼
┌──────────────────────┐
│  coach.ts (route)    │  Orchestrate: call remediation, decide wrap/continue,
│                       │  build summary, return API response
└──────┬───────────────┘
       │  uses shouldWrapMathSession() for wrap policy
       ▼
┌──────────────────────┐
│  teacherSummary      │  Generate teacher-facing summary from step accumulation
│                       │  and math validation results
└──────────────────────┘
```

## File Responsibilities

### mathAnswerValidator.ts (~1930 lines)

**Role:** Stateless math interpretation and validation. All number extraction, strategy detection, and step accumulation lives here. No remediation logic.

**Key contracts:**
- `interpretMathUtterance()` — Canonical parse of one utterance. Returns `MathUtteranceInterpretation` with extracted numbers, arithmetic chains, and flags (substep, decomposition, alternate strategy).
- `accumulateReasoningStepEvidence()` — Multi-turn accumulator. Walks conversation history + current response against rubric steps. Returns `ReasoningStepAccumulation` (satisfied/missing step IDs, answer correctness, completion ratio).
- `shouldWrapMathSession()` — Centralized wrap/continue decision. Takes accumulation + interpretation + attempt count. Returns `MathWrapDecision` (wrap_mastery, wrap_support, continue_probing, continue_decomposition).
- `validateMathAnswer()` — Single-turn validation against `MathProblem` ground truth.
- `boundMathScore()` — Bounds LLM-generated score using deterministic validation.

**Does NOT:** Classify student state, generate coach text, or decide remediation moves.

### deterministicRemediation.ts (~4330 lines)

**Role:** Pure-function remediation policy. Given reasoning steps, step accumulation, and student response, returns the exact coach text and move type. No LLM calls, no network, no state mutation.

**Key contracts:**
- `classifyStudentState()` — Classify one utterance into a `StudentRemediationState`. Priority: no-speech → AV complaint → hint request → concept confusion → refusal → uncertainty → newly-satisfied steps → repeated addition → multi-decomposition → resistance → wrong/misconception/partial.
- `getDeterministicRemediationMove()` — Main entry point. Returns a `RemediationMove` (type + text + metadata) or null. Priority: wrap success → alternate strategy → attribution repair → computation mistake → classify state → scope guards → concept confusion → misconception redirect → state-specific move.
- `getNextMissingStep()` — Step selection: foundational steps (ones, tens) before combine/final.
- `detectMisconceptionCategory()` — Named misconception detection (operation confusion, place-value confusion, known wrong answers). Returns null for generic wrong answers.
- `shouldUseDeterministicRemediation()` — Gate: returns true when reasoning steps exist on the prompt.

**Does NOT:** Parse utterances, extract numbers, accumulate steps, or decide wrap policy.

### teacherSummary.ts (~1080 lines)

**Role:** Generate teacher-facing summaries from validation results and step accumulation. Purely descriptive — reports what happened, does not drive coaching decisions.

**Key contracts:**
- `buildMathTeacherSummary()` — Main entry point for math problems. Routes to `buildAccumulatedStepSummary()` when step accumulation exists, otherwise falls back to evidence-based or reasoning-step summaries.
- `buildAccumulatedStepSummary()` — Decision tree: alternate strategy → mastery → no evidence → partial with answer status (substep, decomposition part, wrong answer, correct but incomplete).
- `buildAlternateStrategySummary()` — Describes the student's actual arithmetic path when non-canonical (split-addend, multi-decomposition, etc.).

**Does NOT:** Classify student state, generate coach text, or influence wrap decisions.

### coach.ts (video-turn endpoint)

**Role:** Orchestration layer. Calls domain functions in sequence, manages conversation state, returns API response. Not a domain module.

**Integration points:**
- Calls `accumulateReasoningStepEvidence()` once per turn (line ~2823)
- Calls `getDeterministicRemediationMove()` up to 3 times: probeFirst path (early-return), continue path (early-return), wrap-override path (conditional)
- Calls `shouldWrapMathSession()` once when not continuing (line ~3943)
- Calls `buildMathTeacherSummary()` once for summary construction (line ~2905)
- Does NOT call `classifyStudentState()` directly — it's called internally by `getDeterministicRemediationMove()`

**Does NOT:** Duplicate domain logic. Delegates all classification, remediation, validation, and summary generation to domain modules.

---

## Student States

| State | Meaning | Example | Remediation |
|-------|---------|---------|-------------|
| `wrong` | Wrong numeric answer, no named pattern | "99" on 27+36 | STEP_PROBE_SIMPLER |
| `misconception` | Wrong answer matching named pattern | "50" on 27+36 (TENS_ONLY) | STEP_MISCONCEPTION_REDIRECT |
| `uncertain` | "I don't know", refusal, no speech | "I don't know", "move on" | STEP_PROBE_SIMPLER → STEP_HINT (after 2) |
| `hint_request` | Explicitly asked for help | "can you help me" | STEP_HINT |
| `partial` | Some steps satisfied, more remain | "7+6=13" on 27+36 | STEP_PROBE_DIRECT (next step) |
| `correct_incomplete` | Correct answer, missing explanation | "63" alone on 27+36 | STEP_ACKNOWLEDGE_AND_PROBE |
| `concept_confusion` | Asking about a concept | "what does ones mean?" | STEP_CONCEPT_EXPLANATION |
| `alternate_setup` | Setting up non-canonical strategy | "I want to split 36" | Redirect to canonical |
| `valid_inefficient` | True but non-optimal decomposition | "36 could be 18+18" | Acknowledge, redirect |
| `noncanonical_active` | Actively building non-canonical chain | "14=7+7, 11=5+6, 7+6=13" | Continue in student's method |
| `computation_mistake` | Right strategy, wrong arithmetic | "7+6=12" | STEP_COMPUTATION_CORRECTION |
| `av_delivery_complaint` | Audio/video complaint | "your mouth is messed up" | Acknowledge, restate question |

---

## Remediation Move Types

| Move | When Used | Text Pattern |
|------|-----------|-------------|
| `STEP_PROBE_DIRECT` | Partial progress, probe next step | "What do you get when you add X and Y?" |
| `STEP_PROBE_SIMPLER` | Uncertain/wrong, lower friction | "Let's do just the ones. What is X + Y?" |
| `STEP_HINT` | Hint request or uncertain escalation | "Hint: Start with the ones. What is X plus Y?" |
| `STEP_MISCONCEPTION_REDIRECT` | Named misconception detected | "We're adding, not subtracting. What is X plus Y?" |
| `STEP_COMBINE_PROMPT` | All substeps done, need combination | "Now put them together: X plus Y?" |
| `STEP_ACKNOWLEDGE_AND_PROBE` | Correct answer, need explanation | "Right! How did you get that? What is X + Y?" |
| `STEP_MODEL_INSTRUCTION` | Repeated failure (≥3), give answer | "In this problem, X + Y = Z. Now what is...?" |
| `STEP_COMPUTATION_CORRECTION` | Arithmetic error in valid strategy | "Close — X + Y is Z, not W. What do you do next?" |
| `STEP_CONCEPT_EXPLANATION` | Concept confusion | "Split into tens and ones: A+B, C+D. What is...?" |
| `WRAP_SUCCESS` | All steps satisfied + correct answer | (wrap signal, no further probing) |
| `WRAP_NEEDS_SUPPORT` | Max attempts, no progress | (wrap signal with support) |

---

## Wrap Policy Precedence

`shouldWrapMathSession()` rules in priority order:

1. **Mastery** — all steps + correct answer → `wrap_mastery`
2. **Alternate mastery** — alternate strategy + correct → `wrap_mastery`
3. **Decomposition in progress** — setup utterance + time → `continue_decomposition`
4. **Correct but incomplete** — right answer, missing steps + time → `continue_probing`
5. **Partial progress** — some steps done, more remain + time → `continue_probing`
6. **Substep answer** — substep-only + missing steps + time → `continue_probing`
7. **Math evidence** — has evidence + missing steps + early attempt + time → `continue_probing`
8. **Time expired** — < 15 seconds remaining → `wrap_support`
9. **Max attempts** — at limit with no progress → `wrap_support`
10. **Default continue** — missing steps exist → `continue_probing`
11. **Default wrap** — no missing steps, no mastery → `wrap_support`

**Handled outside central wrap policy (in coach.ts):**
- Deterministic remediation early-returns bypass the wrap policy entirely when a step-tied move is available
- Off-topic / out-of-scope detection wraps before math validation runs
- The wrap-override block (line ~3954) re-invokes `getDeterministicRemediationMove()` when wrap policy says continue but the main flow was heading toward wrap

---

## Misconception Categories

| Category | Pattern | Example (on 27+36) |
|----------|---------|---------------------|
| `SUBTRACTION_ON_ADDITION` | Subtraction language or answer = \|a-b\| | "take away", answer=9 |
| `ADDITION_ON_SUBTRACTION` | Addition language or answer = a+b | "plus", answer=70 (on 47-23) |
| `MULTIPLICATION_MISUSE` | "times"/"multiply" on add/sub problem | "27 times 36" |
| `ONES_ONLY_CONFUSION` | Answer = ones-only result | 13 (7+6) |
| `TENS_ONLY_CONFUSION` | Answer = tens-only result | 50 (20+30) |
| `KNOWN_WRONG_ANSWER` | Matches `commonWrongAnswers` on problem | Problem-specific |
| `GENERIC_WRONG` | (never returned — function returns null) | Falls through to `wrong` state |
