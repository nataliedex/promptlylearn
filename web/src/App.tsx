import { BrowserRouter, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import StudentDashboard from "./pages/StudentDashboard";
import Lesson from "./pages/Lesson";
import Progress from "./pages/Progress";
import EducatorDashboard from "./pages/EducatorDashboard";
import LessonBuilder from "./pages/LessonBuilder";
import StudentDetails from "./pages/StudentDetails";
import AllStudents from "./pages/AllStudents";
import ArchivedLessons from "./pages/ArchivedLessons";
import SessionReview from "./pages/SessionReview";
import AssignmentReview from "./pages/AssignmentReview";
import StudentAssignmentReview from "./pages/StudentAssignmentReview";
import NeedsReviewList from "./pages/NeedsReviewList";
import ClassManagement from "./pages/ClassManagement";
import ClassDetails from "./pages/ClassDetails";
import AssignLesson from "./pages/AssignLesson";
import CoachSession from "./pages/CoachSession";
import "./App.css";

function App() {
  return (
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
          <Route path="/educator/students" element={<AllStudents />} />
          <Route path="/educator/archived" element={<ArchivedLessons />} />
          <Route path="/educator/student/:studentId" element={<StudentDetails />} />
          <Route path="/educator/session/:sessionId" element={<SessionReview />} />
          <Route path="/educator/assignment/:lessonId" element={<AssignmentReview />} />
          <Route path="/educator/assignment/:lessonId/student/:studentId" element={<StudentAssignmentReview />} />
          <Route path="/educator/assignment/:lessonId/needs-review" element={<NeedsReviewList />} />
          <Route path="/educator/classes" element={<ClassManagement />} />
          <Route path="/educator/class/:classId" element={<ClassDetails />} />
          <Route path="/educator/class/:classId/assign-lesson" element={<AssignLesson />} />
          <Route path="/educator/assign-lesson" element={<AssignLesson />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
