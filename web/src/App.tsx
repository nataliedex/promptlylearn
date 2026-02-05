import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Component, type ReactNode } from "react";
import Home from "./pages/Home";
import StudentDashboard from "./pages/StudentDashboard";
import Lesson from "./pages/Lesson";
import Progress from "./pages/Progress";
import EducatorDashboard from "./pages/EducatorDashboard";
import LessonBuilder from "./pages/LessonBuilder";
import LessonEditor from "./pages/LessonEditor";
import StudentDetails from "./pages/StudentDetails";
import AllStudents from "./pages/AllStudents";
import ArchivedLessons from "./pages/ArchivedLessons";
import SessionReview from "./pages/SessionReview";
import AssignmentReview from "./pages/AssignmentReview";
import StudentAssignmentReview from "./pages/StudentAssignmentReview";
import NeedsReviewList from "./pages/NeedsReviewList";
import ClassDetails from "./pages/ClassDetails";
import AssignLesson from "./pages/AssignLesson";
import CoachSession from "./pages/CoachSession";
import TeacherTodosPrint from "./pages/TeacherTodosPrint";
import { ToastProvider } from "./components/Toast";
import "./App.css";

// Error Boundary to catch rendering errors
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "40px", fontFamily: "system-ui, sans-serif" }}>
          <h1 style={{ color: "#d32f2f" }}>Something went wrong</h1>
          <pre style={{
            background: "#f5f5f5",
            padding: "16px",
            borderRadius: "8px",
            overflow: "auto",
            whiteSpace: "pre-wrap"
          }}>
            {this.state.error?.message}
            {"\n\n"}
            {this.state.error?.stack}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: "16px",
              padding: "10px 20px",
              background: "#667eea",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer"
            }}
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <BrowserRouter>
          <div className="app">
            <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/student/:studentId" element={<StudentDashboard />} />
          <Route path="/student/:studentId/lesson/:lessonId" element={<Lesson />} />
          <Route path="/student/:studentId/coach" element={<CoachSession />} />
          <Route path="/student/:studentId/progress" element={<Progress />} />
          <Route path="/educator" element={<EducatorDashboard />} />
          <Route path="/educator/create-lesson" element={<LessonBuilder />} />
          <Route path="/educator/lesson/:lessonId/edit" element={<LessonEditor />} />
          <Route path="/educator/students" element={<AllStudents />} />
          <Route path="/educator/archived" element={<ArchivedLessons />} />
          <Route path="/educator/student/:studentId" element={<StudentDetails />} />
          <Route path="/educator/session/:sessionId" element={<SessionReview />} />
          <Route path="/educator/assignment/:lessonId" element={<AssignmentReview />} />
          <Route path="/educator/assignment/:lessonId/student/:studentId" element={<StudentAssignmentReview />} />
          <Route path="/educator/assignment/:lessonId/needs-review" element={<NeedsReviewList />} />
          <Route path="/educator/class/:classId" element={<ClassDetails />} />
          <Route path="/educator/class/:classId/assign-lesson" element={<AssignLesson />} />
          <Route path="/educator/assign-lesson" element={<AssignLesson />} />
          <Route path="/educator/todos/print" element={<TeacherTodosPrint />} />
            </Routes>
          </div>
        </BrowserRouter>
      </ToastProvider>
    </ErrorBoundary>
  );
}

export default App;
