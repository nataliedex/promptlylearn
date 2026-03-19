# Golden Fixtures

Regression fixtures for the transcript replay audit system.

## Directory structure

```
fixtures/golden/
├── math/           # Math coaching pipeline fixtures
├── explanation/    # Explanation coaching pipeline fixtures
└── README.md
```

## Naming conventions

Use kebab-case with descriptive names:

```
<topic>-<scenario>.json
```

Examples:
- `planets-claim-to-mastery.json`
- `two-digit-addition-smooth.json`
- `fractions-misconception-redirect.json`

## Fixture metadata

Every golden fixture should include optional metadata fields alongside the
standard fixture fields (`mode`, `transcript`, etc.):

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Unique fixture identifier (kebab-case, matches filename) |
| `tags` | `string[]` | Categorization tags (e.g. `["regression", "mastery-path"]`) |
| `expectedVerdict` | `"PASS" \| "WARN" \| "FAIL"` | Expected audit verdict |
| `expectedIssueCodes` | `string[]` | Issue codes expected to appear (subset match) |
| `notes` | `string` | Free-text notes about what this fixture tests |

When `expectedVerdict` or `expectedIssueCodes` are present, the audit tool
compares actual results against expectations and emits `EXPECTATION_MISMATCH`
(high severity) on any divergence.

Fixtures **without** these fields are still valid and audited normally — they
just skip expectation checking (backward compatible).

## Tagging conventions

Common tags:
- `regression` — guards against known-fixed bugs
- `smoke` — basic sanity check
- `mastery-path` — student reaches mastery
- `needs-support` — student needs scaffolding
- `claim-only-stall` — repeated vague claims without evidence
- `uncertainty-escalation` — "I don't know" → simpler probes
- `factual-error` — student states incorrect fact
- `self-correction` — student corrects after coaching feedback
- `meta-question` — student asks about the question itself
- `misconception` — student applies wrong operation or strategy
- `noncanonical-reasoning` — valid reasoning in non-standard order
- `hint-request` — student explicitly asks for a hint
- `error-correction` — wrong answer → coach correction → student recovery
- `edge-case` — unusual input or boundary condition

## Fixture promotion checklist

When promoting a real session or test scenario to a golden fixture:

1. **Identify the pattern** — which category does this transcript represent?
   Pick from the list in the current corpus or add a new tag.
2. **Extract the transcript** — pull coach/student turns from the session or
   test file. Strip timestamps and metadata.
3. **Attach lesson metadata** — add `requiredEvidence`, `referenceFacts`,
   `successCriteria` (explanation) or `mathProblem`, `reasoningSteps` (math).
4. **Run locally first** — `npx ts-node src/domain/transcriptReplay.ts fixture.json`
   to verify the replay produces the expected classification/moves.
5. **Set expectations** — add `expectedVerdict` and `expectedIssueCodes` based
   on what the audit actually produces. If the current behavior is correct,
   `expectedVerdict: "PASS"`. If a known issue exists that you want to track,
   use `"WARN"` or `"FAIL"` with the matching codes.
6. **Add metadata** — `id` (matches filename), `tags`, `notes` explaining what
   the fixture guards against.
7. **Run the full audit** — `npm run audit:golden` to confirm no regressions.
8. **Commit** — the fixture is now a CI-enforced regression gate.

## When to update expectations vs. treat as regression

**Update the fixture** when:
- You intentionally changed coaching behavior (e.g. new move type, adjusted
  word limits, changed wrap thresholds)
- The new behavior is **better** — update `expectedVerdict` / `expectedIssueCodes`
  to match and explain the change in the commit message

**Treat as regression** when:
- A fixture that was PASS starts producing WARN or FAIL after an unrelated change
- A fixture's issue codes change unexpectedly
- The `EXPECTATION_MISMATCH` issue appears in CI

Rule of thumb: if you didn't intend to change the behavior that fixture tests,
it's a regression. Fix the code, don't update the fixture.

## Running locally

```bash
npm run audit:golden                    # CI-friendly, exits non-zero on failures
npx ts-node src/domain/transcriptReplay.ts --audit fixtures/golden --markdown artifacts/golden-audit.md
```

## CI workflow

The GitHub Actions workflow at `.github/workflows/golden-audit.yml` runs
automatically on every pull request and push to `main`. It:

1. Installs dependencies (`npm ci`)
2. Runs the full test suite (`npm test`)
3. Runs `npm run audit:golden`
4. Uploads `artifacts/golden-audit.md` as a downloadable workflow artifact
   (even if the audit fails, so you can inspect the report)

The workflow **fails the build** if any fixture produces:
- A high-severity audit issue (REPEATED_OPENING, PREMATURE_WRAP, SUMMARY_MISMATCH)
- An `EXPECTATION_MISMATCH` — meaning the actual verdict or issue codes
  diverged from what the fixture declared in `expectedVerdict` / `expectedIssueCodes`

This makes golden fixtures a **required regression gate**: if a coaching logic
change causes a previously-PASS fixture to WARN or FAIL (or vice versa), CI
catches it before merge. To intentionally update expectations after a behavior
change, edit the fixture's `expectedVerdict` and `expectedIssueCodes` fields.
