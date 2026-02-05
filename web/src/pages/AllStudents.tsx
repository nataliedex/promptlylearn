/**
 * All Students List
 *
 * Simple list of all students with links to their details.
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getStudents, type Student } from "../services/api";
import EducatorHeader from "../components/EducatorHeader";

export default function AllStudents() {
  const navigate = useNavigate();
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const studentsData = await getStudents();
        setStudents(studentsData);
      } catch (err) {
        console.error("Failed to load students:", err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner"></div>
        <p>Loading students...</p>
      </div>
    );
  }

  return (
    <div className="container">
      <EducatorHeader breadcrumbs={[{ label: "All Students" }]} />

      <div className="header">
        <h1>All Students</h1>
        <p>{students.length} student{students.length !== 1 ? "s" : ""}</p>
      </div>

      {students.length === 0 ? (
        <div className="card">
          <p style={{ color: "#666", textAlign: "center", padding: "24px" }}>
            No students yet.
          </p>
        </div>
      ) : (
        <div className="card">
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {students.map((student) => (
              <div
                key={student.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "12px 16px",
                  background: "#f8f9fa",
                  borderRadius: "8px",
                  cursor: "pointer",
                  transition: "background 0.2s",
                }}
                onClick={() => navigate(`/educator/student/${student.id}`)}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#e9ecef")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#f8f9fa")}
              >
                <div>
                  <span style={{ fontWeight: 500, color: "#667eea" }}>{student.name}</span>
                  <span style={{ color: "#666", marginLeft: "16px", fontSize: "0.9rem" }}>
                    Joined {new Date(student.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <span style={{ color: "#667eea" }}>→</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
