import { BrowserRouter, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import StudentDashboard from "./pages/StudentDashboard";
import Lesson from "./pages/Lesson";
import Progress from "./pages/Progress";
import EducatorDashboard from "./pages/EducatorDashboard";
import LessonBuilder from "./pages/LessonBuilder";
import "./App.css";

function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/student/:studentId" element={<StudentDashboard />} />
          <Route path="/student/:studentId/lesson/:lessonId" element={<Lesson />} />
          <Route path="/student/:studentId/progress" element={<Progress />} />
          <Route path="/educator" element={<EducatorDashboard />} />
          <Route path="/educator/create-lesson" element={<LessonBuilder />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
