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

### Voice Features (Whisper + TTS)

Requires SoX (Sound eXchange) for audio recording:
```bash
brew install sox  # macOS
```

**Voice Input:** Type `v` at any prompt to speak instead of type. Recording starts immediately and auto-stops after 2 seconds of silence.

**Text-to-Speech:** The coach speaks aloud using OpenAI TTS (nova voice):
- Reads questions before student answers
- Speaks all coach responses and feedback
- Gives spoken greeting at lesson start and closing at lesson end

## Architecture

The project follows a layered architecture with domain-driven design principles:

```
src/
├── cli/                  # Command-line interaction layer
│   ├── runAssignment.ts  # Main app entry point with role selection
│   ├── helpers.ts        # Input helpers (askQuestion, askMenu, askForStudent)
│   ├── voice.ts          # Whisper voice input (recording + transcription)
│   ├── coach.ts          # AI coach for conversational help and exploration
│   ├── progressSummary.ts# Display student progress report
│   ├── sessionReplay.ts  # Review past session answers and feedback
│   └── educatorDashboard.ts # Educator view of all students
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
- **Submission**: Captures student responses, reflections, hint usage, and coach conversations
- **Evaluation**: Scoring criteria and results
- **Evaluator interface** with two implementations:
  - `LLMEvaluator`: Uses OpenAI GPT to assess understanding, reasoning, and clarity
  - `FakeEvaluator`: Rule-based fallback for testing without API key

### Stores Layer (`src/stores/`)

- **StudentStore**: Persists students, looks up returning students by name
- **SessionStore**: Saves/loads sessions as JSON files

### Application Flow

**Role Selection** — App starts by asking "Are you a Student or Educator?"

**Student Mode:**
1. Enter name (returning students are recognized)
2. Main menu: Start lesson / Review past sessions / View progress / Exit
3. During questions:
   - Type answer or `v` for voice input
   - Type `help` → Conversational AI coach (Socratic guidance, no direct answers)
   - Type `hint` → Static hints fallback
4. After each answer: Get immediate feedback, option to type `more` (or ask a question) for deeper exploration
5. Voice input (`v`) works everywhere: answers, reflections, coach conversations
6. Evaluator scores submissions via LLM or rule-based fallback

**Educator Mode:**
1. Dashboard shows class overview (total students, sessions, average score)
2. Student list with session counts, averages, and status flags
3. Options: View student details / View lesson stats / Refresh / Exit
4. Student details: Join date, lessons attempted, recent sessions
5. Lesson stats: Attempts, average scores, difficulty indicators

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
