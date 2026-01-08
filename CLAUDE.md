# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Promptly Learn is an educational platform for learning and testing prompt engineering skills. Students practice writing prompts and receive automated feedback through evaluations.

## Commands

```bash
npm run dev    # Development mode with hot reload (nodemon + ts-node)
npm run build  # Compile TypeScript to dist/
npm start      # Run compiled JavaScript
```

No test framework is currently configured.

## Environment Setup

Copy `.env.example` to `.env` and add your OpenAI API key:
```bash
OPENAI_API_KEY=sk-your-key-here
```

Without an API key, the app falls back to `FakeEvaluator` (rule-based scoring).

## Architecture

The project follows a layered architecture with domain-driven design principles:

```
src/
├── index.ts              # Entry point - loads lessons and runs app
├── domain/               # Core business logic and models
├── cli/                  # Command-line interaction layer
├── loaders/              # Data loading utilities
├── stores/               # Persistence layer (file-based for now)
└── data/
    ├── lessons/          # JSON lesson definitions
    └── sessions/         # Saved session data (gitignored)
```

### Domain Layer (`src/domain/`)

- **Student**: User identity (id, name)
- **Session**: A single attempt at a lesson (links student + lesson + submission + evaluation)
- **Prompt types**: "explain", "generate", "analyze", "refactor"
- **Lesson**: Contains multiple prompts grouped by difficulty (beginner/intermediate/advanced)
- **Submission**: Captures student responses, reflections, and hint usage
- **Evaluation**: Scoring criteria and results
- **Evaluator interface** with two implementations:
  - `LLMEvaluator`: Uses OpenAI GPT to assess understanding, reasoning, and clarity
  - `FakeEvaluator`: Rule-based fallback for testing without API key

### Stores Layer (`src/stores/`)

- **SessionStore**: Saves/loads sessions as JSON files. Methods: `save()`, `load()`, `getByStudentId()`, `getAll()`

### Application Flow

1. CLI asks for student name (creates Student with generated ID)
2. Loads lesson from JSON via `lessonLoader.ts`
3. `runAssignment.ts` presents each prompt using `askQuestion()` helper
4. User can type "hint" for hints (tracked for scoring)
5. Evaluator scores submission:
   - `LLMEvaluator` (if `OPENAI_API_KEY` set): Assesses understanding, reasoning, clarity via GPT
   - `FakeEvaluator` (fallback): Rule-based scoring (30 pts/prompt, -5 hints, +5 reflection)
6. Session is saved to `src/data/sessions/{sessionId}.json`

### Key Interfaces

- `Evaluator` interface in `domain/evaluator.ts` - implement this for real evaluation logic
- `Lesson` interface in `domain/lesson.ts` - structure for lesson JSON files
