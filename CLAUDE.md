# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Promptly Learn is an educational platform where students practice explaining their thinking and receive AI-powered feedback. Designed for elementary-level learners with curriculum-aligned content.

## Commands

```bash
npm run dev    # Development mode with hot reload (nodemon + ts-node)
npm run build  # Compile TypeScript to dist/
npm start      # Run compiled JavaScript
```

No test framework is currently configured.

## Environment Setup

Create a `.env` file with your OpenAI API key:
```bash
OPENAI_API_KEY=sk-your-key-here
```

Without an API key, the app falls back to `FakeEvaluator` (rule-based scoring).

## Architecture

The project follows a layered architecture with domain-driven design principles:

```
src/
├── cli/                  # Command-line interaction layer
│   ├── runAssignment.ts  # Main app loop with menu
│   ├── helpers.ts        # Input helpers (askQuestion, askMenu, askForStudent)
│   ├── progressSummary.ts# Display student progress report
│   └── sessionReplay.ts  # Review past session answers and feedback
├── domain/               # Core business logic and models
├── loaders/              # Data loading utilities
├── stores/               # Persistence layer (file-based)
│   ├── studentStore.ts   # Save/load students by name
│   └── sessionStore.ts   # Save/load sessions
└── data/                 # JSON lesson definitions

data/                     # Runtime data (gitignored)
├── students/             # Persisted student records
└── sessions/             # Saved session data
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

- **StudentStore**: Persists students, looks up returning students by name
- **SessionStore**: Saves/loads sessions as JSON files

### Application Flow

1. CLI asks for student name
   - Returning students are recognized and linked to previous sessions
   - New students are created and saved
2. Main menu: Start lesson / Review past sessions / View progress / Exit
3. **Start lesson**: Choose from available lessons, then answer prompts
4. **Review past sessions**: Select a past session to see answers and feedback
5. **View progress**: Shows stats, per-lesson breakdown, trend analysis, insights
6. Evaluator scores submission:
   - `LLMEvaluator` (if `OPENAI_API_KEY` set): Assesses understanding, reasoning, clarity via GPT
   - `FakeEvaluator` (fallback): Rule-based scoring

### Available Lessons

Lessons are JSON files in `src/data/lessons/`. Current lessons:
- **2nd Grade Thinking Skills** (beginner) - Math word problems, science reasoning
- **Reading Adventures** (beginner) - Reading comprehension stories
- **Story Writing** (beginner) - Creative writing prompts
- **Animal Facts** (beginner) - Science/nature questions
- **Feelings & Friendship** (beginner) - Social-emotional learning
- **Math Challenge** (intermediate) - Division, multi-step problems
- **Science Explorers** (intermediate) - Plants, states of matter
- **Time & Money** (intermediate) - Clocks and coins

### Key Interfaces

- `Evaluator` interface in `domain/evaluator.ts` - implement this for real evaluation logic
- `Lesson` interface in `domain/lesson.ts` - structure for lesson JSON files
