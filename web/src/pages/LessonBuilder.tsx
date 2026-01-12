import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  generateLesson,
  generateQuestion,
  saveLesson,
  type Lesson,
  type Prompt,
  type CreationMode,
} from "../services/api";

type Step = "mode" | "content" | "options" | "generating" | "review" | "saving";

const CREATION_MODES = [
  { value: "book-title" as CreationMode, label: "From a book (enter title)", description: "Generate questions about a specific book" },
  { value: "book-excerpt" as CreationMode, label: "From a book excerpt", description: "Paste a passage from a book" },
  { value: "pasted-text" as CreationMode, label: "From pasted text", description: "Paste any article, story, or text" },
  { value: "topic" as CreationMode, label: "From a topic", description: "Create questions about a subject" },
  { value: "guided" as CreationMode, label: "Guided creation", description: "Describe what you want to teach" },
];

const GRADE_LEVELS = [
  "Kindergarten",
  "1st grade",
  "2nd grade",
  "3rd grade",
  "4th grade",
  "5th grade",
  "Middle school",
  "High school",
];

const DIFFICULTIES = [
  { value: "beginner" as const, label: "Beginner", description: "Simple questions, lots of scaffolding" },
  { value: "intermediate" as const, label: "Intermediate", description: "More complex, some inference required" },
  { value: "advanced" as const, label: "Advanced", description: "Challenging, requires deeper thinking" },
];

export default function LessonBuilder() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("mode");
  const [mode, setMode] = useState<CreationMode | null>(null);
  const [content, setContent] = useState("");
  const [gradeLevel, setGradeLevel] = useState("2nd grade");
  const [difficulty, setDifficulty] = useState<"beginner" | "intermediate" | "advanced">("beginner");
  const [questionCount, setQuestionCount] = useState(3);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [error, setError] = useState("");
  const [editingQuestion, setEditingQuestion] = useState<string | null>(null);
  const [editingHints, setEditingHints] = useState<string[] | null>(null);

  const handleSelectMode = (selectedMode: CreationMode) => {
    setMode(selectedMode);
    setStep("content");
  };

  const handleContentSubmit = () => {
    if (!content.trim()) {
      setError("Please enter some content");
      return;
    }
    setError("");
    setStep("options");
  };

  const handleGenerate = async () => {
    if (!mode || !content) return;

    setStep("generating");
    setError("");

    try {
      const generatedLesson = await generateLesson({
        mode,
        content,
        difficulty,
        questionCount,
        gradeLevel,
      });
      setLesson(generatedLesson);
      setCurrentQuestionIndex(0);
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate lesson");
      setStep("options");
    }
  };

  const handleSaveLesson = async () => {
    if (!lesson) return;

    setStep("saving");
    setError("");

    try {
      await saveLesson(lesson);
      navigate("/educator", { state: { message: "Lesson created successfully!" } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save lesson");
      setStep("review");
    }
  };

  const handleAddQuestion = async () => {
    if (!lesson) return;

    setError("");
    try {
      const existingQuestions = lesson.prompts.map(p => p.input);
      const newPrompt = await generateQuestion(content, existingQuestions, difficulty);
      newPrompt.id = `q${lesson.prompts.length + 1}`;
      setLesson({
        ...lesson,
        prompts: [...lesson.prompts, newPrompt],
      });
      setCurrentQuestionIndex(lesson.prompts.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate question");
    }
  };

  const handleDeleteQuestion = () => {
    if (!lesson || lesson.prompts.length <= 1) return;

    const newPrompts = lesson.prompts.filter((_, i) => i !== currentQuestionIndex);
    setLesson({
      ...lesson,
      prompts: newPrompts.map((p, i) => ({ ...p, id: `q${i + 1}` })),
    });
    if (currentQuestionIndex >= newPrompts.length) {
      setCurrentQuestionIndex(newPrompts.length - 1);
    }
  };

  const handleSaveQuestionEdit = () => {
    if (!lesson || editingQuestion === null) return;

    const newPrompts = [...lesson.prompts];
    newPrompts[currentQuestionIndex] = {
      ...newPrompts[currentQuestionIndex],
      input: editingQuestion,
    };
    setLesson({ ...lesson, prompts: newPrompts });
    setEditingQuestion(null);
  };

  const handleSaveHintsEdit = () => {
    if (!lesson || editingHints === null) return;

    const newPrompts = [...lesson.prompts];
    newPrompts[currentQuestionIndex] = {
      ...newPrompts[currentQuestionIndex],
      hints: editingHints,
    };
    setLesson({ ...lesson, prompts: newPrompts });
    setEditingHints(null);
  };

  const currentPrompt = lesson?.prompts[currentQuestionIndex];

  const getContentPlaceholder = () => {
    switch (mode) {
      case "book-title": return "Enter the book title (e.g., 'Charlotte's Web')";
      case "book-excerpt": return "Paste a passage from the book...";
      case "pasted-text": return "Paste the text you want to create a lesson from...";
      case "topic": return "Enter a topic (e.g., 'Photosynthesis', 'The Solar System')";
      case "guided": return "Describe what you want students to learn...";
      default: return "";
    }
  };

  return (
    <div className="container">
      <Link to="/educator" className="back-btn">
        ← Back to Dashboard
      </Link>

      <div className="header">
        <h1>Create New Lesson</h1>
        <p>Use AI to generate engaging questions for your students</p>
      </div>

      {error && (
        <div className="card" style={{ borderLeft: "4px solid #f44336", marginBottom: "16px" }}>
          <p style={{ color: "#f44336", margin: 0 }}>{error}</p>
        </div>
      )}

      {/* Step 1: Choose Mode */}
      {step === "mode" && (
        <div className="card">
          <h2 style={{ marginBottom: "24px" }}>How would you like to create your lesson?</h2>
          <div className="lesson-grid" style={{ gridTemplateColumns: "1fr" }}>
            {CREATION_MODES.map((m) => (
              <div
                key={m.value}
                className="card lesson-card"
                onClick={() => handleSelectMode(m.value)}
                style={{ margin: 0 }}
              >
                <h3>{m.label}</h3>
                <p>{m.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: Enter Content */}
      {step === "content" && (
        <div className="card">
          <h2 style={{ marginBottom: "16px" }}>
            {mode === "book-title" && "Enter the book title"}
            {mode === "book-excerpt" && "Paste the book excerpt"}
            {mode === "pasted-text" && "Paste your text"}
            {mode === "topic" && "Enter the topic"}
            {mode === "guided" && "Describe your lesson"}
          </h2>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={getContentPlaceholder()}
            style={{ minHeight: mode === "book-title" || mode === "topic" ? "60px" : "200px" }}
          />
          <div className="nav-buttons">
            <button className="btn btn-secondary" onClick={() => setStep("mode")}>
              Back
            </button>
            <button className="btn btn-primary" onClick={handleContentSubmit}>
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Options */}
      {step === "options" && (
        <div className="card">
          <h2 style={{ marginBottom: "24px" }}>Configure your lesson</h2>

          <div style={{ marginBottom: "24px" }}>
            <label style={{ display: "block", marginBottom: "8px", fontWeight: 600 }}>
              Grade Level
            </label>
            <select
              value={gradeLevel}
              onChange={(e) => setGradeLevel(e.target.value)}
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: "8px",
                border: "2px solid #e0e0e0",
                fontSize: "16px",
              }}
            >
              {GRADE_LEVELS.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: "24px" }}>
            <label style={{ display: "block", marginBottom: "8px", fontWeight: 600 }}>
              Difficulty
            </label>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              {DIFFICULTIES.map((d) => (
                <button
                  key={d.value}
                  className={`btn ${difficulty === d.value ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setDifficulty(d.value)}
                  style={{ flex: "1", minWidth: "120px" }}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: "24px" }}>
            <label style={{ display: "block", marginBottom: "8px", fontWeight: 600 }}>
              Number of Questions: {questionCount}
            </label>
            <input
              type="range"
              min="2"
              max="5"
              value={questionCount}
              onChange={(e) => setQuestionCount(Number(e.target.value))}
              style={{ width: "100%" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", color: "#666", fontSize: "0.9rem" }}>
              <span>2 (quick)</span>
              <span>5 (comprehensive)</span>
            </div>
          </div>

          <div className="nav-buttons">
            <button className="btn btn-secondary" onClick={() => setStep("content")}>
              Back
            </button>
            <button className="btn btn-primary" onClick={handleGenerate}>
              Generate Lesson
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Generating */}
      {step === "generating" && (
        <div className="card" style={{ textAlign: "center", padding: "48px" }}>
          <div className="loading-spinner" style={{ borderTopColor: "#667eea", borderColor: "#e0e0e0" }}></div>
          <h2 style={{ marginTop: "16px" }}>Generating your lesson...</h2>
          <p style={{ color: "#666" }}>This may take a few seconds</p>
        </div>
      )}

      {/* Step 5: Review */}
      {step === "review" && lesson && currentPrompt && (
        <>
          <div className="card">
            <h2>{lesson.title}</h2>
            <p style={{ color: "#666" }}>{lesson.description}</p>
            <div style={{ display: "flex", gap: "8px", marginTop: "12px", flexWrap: "wrap", alignItems: "center" }}>
              <span className={`difficulty-badge difficulty-${lesson.difficulty}`}>
                {lesson.difficulty}
              </span>
              <span style={{ color: "#666" }}>{lesson.gradeLevel}</span>
            </div>
            {lesson.standards && lesson.standards.length > 0 && (
              <div style={{ marginTop: "16px", padding: "12px", background: "#e3f2fd", borderRadius: "8px" }}>
                <h4 style={{ margin: "0 0 8px 0", color: "#1565c0", fontSize: "0.9rem" }}>
                  Ohio Learning Standards Covered
                </h4>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {lesson.standards.map((code) => (
                    <span
                      key={code}
                      style={{
                        background: "#1565c0",
                        color: "white",
                        padding: "4px 8px",
                        borderRadius: "4px",
                        fontSize: "0.8rem",
                        fontWeight: 500,
                      }}
                    >
                      {code}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h3>Question {currentQuestionIndex + 1} of {lesson.prompts.length}</h3>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => setCurrentQuestionIndex(Math.max(0, currentQuestionIndex - 1))}
                  disabled={currentQuestionIndex === 0}
                  style={{ padding: "8px 16px" }}
                >
                  ← Prev
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => setCurrentQuestionIndex(Math.min(lesson.prompts.length - 1, currentQuestionIndex + 1))}
                  disabled={currentQuestionIndex === lesson.prompts.length - 1}
                  style={{ padding: "8px 16px" }}
                >
                  Next →
                </button>
              </div>
            </div>

            {editingQuestion !== null ? (
              <div style={{ marginBottom: "16px" }}>
                <textarea
                  value={editingQuestion}
                  onChange={(e) => setEditingQuestion(e.target.value)}
                  style={{ minHeight: "100px", marginBottom: "8px" }}
                />
                <div style={{ display: "flex", gap: "8px" }}>
                  <button className="btn btn-primary" onClick={handleSaveQuestionEdit}>
                    Save
                  </button>
                  <button className="btn btn-secondary" onClick={() => setEditingQuestion(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div
                style={{
                  background: "#f5f5f5",
                  padding: "16px",
                  borderRadius: "8px",
                  marginBottom: "16px",
                  cursor: "pointer",
                }}
                onClick={() => setEditingQuestion(currentPrompt.input)}
              >
                <p style={{ margin: 0 }}>{currentPrompt.input}</p>
                <p style={{ color: "#667eea", fontSize: "0.8rem", margin: "8px 0 0 0" }}>
                  Click to edit
                </p>
              </div>
            )}

            <h4 style={{ marginBottom: "8px" }}>Hints</h4>
            {editingHints !== null ? (
              <div style={{ marginBottom: "16px" }}>
                {editingHints.map((hint, i) => (
                  <input
                    key={i}
                    type="text"
                    value={hint}
                    onChange={(e) => {
                      const newHints = [...editingHints];
                      newHints[i] = e.target.value;
                      setEditingHints(newHints);
                    }}
                    placeholder={`Hint ${i + 1}`}
                    style={{ marginBottom: "8px" }}
                  />
                ))}
                <div style={{ display: "flex", gap: "8px" }}>
                  <button className="btn btn-primary" onClick={handleSaveHintsEdit}>
                    Save
                  </button>
                  <button className="btn btn-secondary" onClick={() => setEditingHints(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div
                style={{
                  background: "#fff8e1",
                  padding: "16px",
                  borderRadius: "8px",
                  cursor: "pointer",
                }}
                onClick={() => setEditingHints([...currentPrompt.hints])}
              >
                {currentPrompt.hints.map((hint, i) => (
                  <p key={i} style={{ margin: i === 0 ? 0 : "8px 0 0 0" }}>
                    {i + 1}. {hint}
                  </p>
                ))}
                <p style={{ color: "#f57c00", fontSize: "0.8rem", margin: "8px 0 0 0" }}>
                  Click to edit hints
                </p>
              </div>
            )}

            {currentPrompt.standards && currentPrompt.standards.length > 0 && (
              <div style={{ marginTop: "16px" }}>
                <h4 style={{ marginBottom: "8px" }}>Standards Addressed</h4>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {currentPrompt.standards.map((code) => (
                    <span
                      key={code}
                      style={{
                        background: "#e8f5e9",
                        color: "#2e7d32",
                        padding: "4px 8px",
                        borderRadius: "4px",
                        fontSize: "0.8rem",
                        fontWeight: 500,
                        border: "1px solid #a5d6a7",
                      }}
                    >
                      {code}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: "8px", marginTop: "16px", flexWrap: "wrap" }}>
              <button className="btn btn-secondary" onClick={handleAddQuestion}>
                + Add Question
              </button>
              <button
                className="btn btn-secondary"
                onClick={handleDeleteQuestion}
                disabled={lesson.prompts.length <= 1}
                style={{ color: lesson.prompts.length <= 1 ? "#999" : "#f44336" }}
              >
                Delete Question
              </button>
            </div>
          </div>

          <div className="nav-buttons">
            <button className="btn btn-secondary" onClick={() => setStep("options")}>
              Start Over
            </button>
            <button className="btn btn-primary" onClick={handleSaveLesson}>
              Save Lesson
            </button>
          </div>
        </>
      )}

      {/* Step 6: Saving */}
      {step === "saving" && (
        <div className="card" style={{ textAlign: "center", padding: "48px" }}>
          <div className="loading-spinner" style={{ borderTopColor: "#667eea", borderColor: "#e0e0e0" }}></div>
          <h2 style={{ marginTop: "16px" }}>Saving your lesson...</h2>
        </div>
      )}
    </div>
  );
}
