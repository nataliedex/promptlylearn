import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createOrFindStudent } from "../services/api";

export default function Home() {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleStudentLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Please enter your name");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const { student, isNew } = await createOrFindStudent(name.trim());
      if (isNew) {
        console.log("Welcome, new student!", student.name);
      } else {
        console.log("Welcome back!", student.name);
      }
      navigate(`/student/${student.id}`);
    } catch (err) {
      setError("Failed to connect. Make sure the API server is running.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleEducatorLogin = () => {
    navigate("/educator");
  };

  return (
    <div className="container">
      <div className="header">
        <h1>Promptly Learn</h1>
        <p>Practice explaining your thinking and grow your understanding</p>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: "24px", textAlign: "center" }}>Welcome!</h2>

        <form onSubmit={handleStudentLogin}>
          <div style={{ marginBottom: "16px" }}>
            <label
              htmlFor="name"
              style={{ display: "block", marginBottom: "8px", fontWeight: 500 }}
            >
              What's your name?
            </label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name"
              disabled={loading}
            />
          </div>

          {error && (
            <p style={{ color: "#c62828", marginBottom: "16px" }}>{error}</p>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ width: "100%", marginBottom: "12px" }}
          >
            {loading ? "Loading..." : "Start Learning"}
          </button>
        </form>

        <div style={{ textAlign: "center", marginTop: "24px" }}>
          <p style={{ color: "#666", marginBottom: "12px" }}>or</p>
          <button
            className="btn btn-secondary"
            onClick={handleEducatorLogin}
            style={{ width: "100%" }}
          >
            I'm an Educator
          </button>
        </div>
      </div>
    </div>
  );
}
