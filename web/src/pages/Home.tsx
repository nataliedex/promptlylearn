import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { loginWithCode, createOrFindStudent } from "../services/api";

const API_BASE = "http://localhost:3001/api";

export default function Home() {
  const [studentCode, setStudentCode] = useState("");
  const [demoName, setDemoName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showDemoLogin, setShowDemoLogin] = useState(false);
  const [demoEnabled, setDemoEnabled] = useState(false);
  const navigate = useNavigate();

  // Check if demo mode is enabled
  useEffect(() => {
    fetch(`${API_BASE}/config`)
      .then((res) => res.json())
      .then((data) => setDemoEnabled(data.demoLoginEnabled ?? false))
      .catch(() => setDemoEnabled(false));
  }, []);

  const handleCodeLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = studentCode.trim().toUpperCase();
    if (!code) {
      setError("Please enter your student code");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const { student } = await loginWithCode(code);
      navigate(`/student/${student.id}`);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("404")) {
        setError("Invalid student code. Please check and try again.");
      } else {
        setError("Failed to connect. Make sure the API server is running.");
      }
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!demoName.trim()) {
      setError("Please enter a name for demo mode");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const { student } = await createOrFindStudent(demoName.trim(), true);
      navigate(`/student/${student.id}`);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("403")) {
        setError("Demo mode is not enabled on this server.");
      } else {
        setError("Failed to connect. Make sure the API server is running.");
      }
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

      <div className="card centered-form">
        <h2 style={{ marginBottom: "24px", textAlign: "center" }}>Student Login</h2>

        {/* Primary: Student Code Login */}
        {!showDemoLogin ? (
          <form onSubmit={handleCodeLogin}>
            <div style={{ marginBottom: "16px" }}>
              <label
                htmlFor="studentCode"
                style={{ display: "block", marginBottom: "8px", fontWeight: 500 }}
              >
                Enter your student code
              </label>
              <input
                type="text"
                id="studentCode"
                value={studentCode}
                onChange={(e) => setStudentCode(e.target.value.toUpperCase())}
                placeholder="e.g., ABC123"
                disabled={loading}
                style={{
                  textTransform: "uppercase",
                  letterSpacing: "2px",
                  fontSize: "1.1rem",
                  textAlign: "center",
                }}
                maxLength={10}
                autoComplete="off"
              />
              <p style={{ margin: "8px 0 0 0", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                Ask your teacher for your code
              </p>
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
        ) : (
          /* Demo Login Mode */
          <form onSubmit={handleDemoLogin}>
            <div
              style={{
                background: "var(--status-info-bg)",
                color: "var(--status-info-text)",
                padding: "10px 14px",
                borderRadius: "8px",
                marginBottom: "16px",
                fontSize: "0.85rem",
              }}
            >
              Demo Mode - for testing only
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label
                htmlFor="demoName"
                style={{ display: "block", marginBottom: "8px", fontWeight: 500 }}
              >
                Enter any name
              </label>
              <input
                type="text"
                id="demoName"
                value={demoName}
                onChange={(e) => setDemoName(e.target.value)}
                placeholder="Demo Student"
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
              {loading ? "Loading..." : "Start Demo"}
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setShowDemoLogin(false);
                setError("");
              }}
              style={{ width: "100%" }}
            >
              Back to Code Login
            </button>
          </form>
        )}

        {/* Demo mode toggle (only show if enabled) */}
        {demoEnabled && !showDemoLogin && (
          <div style={{ textAlign: "center", marginTop: "16px" }}>
            <button
              type="button"
              onClick={() => {
                setShowDemoLogin(true);
                setError("");
              }}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                fontSize: "0.85rem",
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              Use demo login instead
            </button>
          </div>
        )}

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
