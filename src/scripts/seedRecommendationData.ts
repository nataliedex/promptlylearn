/**
 * Seed script to populate dummy data for testing the "What Should I Do Next?" recommendations
 *
 * Run with: npx ts-node src/scripts/seedRecommendationData.ts
 */

import { randomUUID } from "crypto";
import { StudentStore } from "../stores/studentStore";
import { SessionStore } from "../stores/sessionStore";
import { ClassStore } from "../stores/classStore";
import { StudentAssignmentStore } from "../stores/studentAssignmentStore";
import { CoachSessionStore } from "../stores/coachSessionStore";
import { getAllLessons } from "../loaders/lessonLoader";
import { Session } from "../domain/session";
import { Student } from "../domain/student";
import { CoachSession } from "../domain/coachSession";

const studentStore = new StudentStore();
const sessionStore = new SessionStore();
const classStore = new ClassStore();
const studentAssignmentStore = new StudentAssignmentStore();
const coachSessionStore = new CoachSessionStore();

// Dummy student data with different scenarios
const dummyStudents = [
  { name: "Emma Thompson", scenario: "struggling" },
  { name: "Liam Rodriguez", scenario: "struggling" },
  { name: "Sophia Chen", scenario: "excelling" },
  { name: "Noah Williams", scenario: "improved" },
  { name: "Olivia Martinez", scenario: "struggling" },
  { name: "Aiden Johnson", scenario: "excelling" },
  { name: "Isabella Brown", scenario: "average" },
  { name: "Mason Davis", scenario: "improved" },
];

function createStudent(name: string): Student {
  // Check if student already exists
  const existing = studentStore.findByName(name);
  if (existing) {
    console.log(`  Student "${name}" already exists`);
    return existing;
  }

  const student: Student = {
    id: randomUUID(),
    name,
    classes: [],
    assignments: [],
    createdAt: new Date(),
  };
  studentStore.save(student);
  console.log(`  Created student: ${name}`);
  return student;
}

function createSession(
  student: Student,
  lessonId: string,
  lessonTitle: string,
  score: number,
  hintUsageRate: number
): Session {
  const now = new Date();
  const startedAt = new Date(now.getTime() - 30 * 60 * 1000); // 30 mins ago

  // Create responses with hint usage
  const numQuestions = 5;
  const hintsUsed = Math.round(numQuestions * hintUsageRate);
  const responses = Array.from({ length: numQuestions }, (_, i) => ({
    promptId: `prompt-${i + 1}`,
    response: `Sample response for question ${i + 1}`,
    hintUsed: i < hintsUsed,
  }));

  const session: Session = {
    id: randomUUID(),
    studentId: student.id,
    studentName: student.name,
    lessonId,
    lessonTitle,
    submission: {
      assignmentId: lessonId,
      studentId: student.id,
      responses,
      submittedAt: now,
    },
    evaluation: {
      totalScore: score,
      feedback: score >= 70 ? "Good work!" : "Keep practicing!",
      criteriaScores: [
        { criterionId: "understanding", score: score, comment: "Assessment of understanding" },
      ],
    },
    startedAt,
    completedAt: now,
    status: "completed",
  };

  sessionStore.save(session);
  return session;
}

function createCoachSession(
  student: Student,
  topics: string[],
  intentType: "support-seeking" | "enrichment-seeking"
): CoachSession {
  const now = new Date().toISOString();

  // Create messages that match the intent
  const messages =
    intentType === "support-seeking"
      ? [
          { role: "student" as const, message: "I don't understand this problem", timestamp: now },
          { role: "coach" as const, message: "Let's work through it together!", timestamp: now },
          { role: "student" as const, message: "I'm confused about how to start", timestamp: now },
          { role: "coach" as const, message: "Start by identifying what you know.", timestamp: now },
        ]
      : [
          { role: "student" as const, message: "Can you give me another example?", timestamp: now },
          { role: "coach" as const, message: "Here's a more challenging one!", timestamp: now },
          { role: "student" as const, message: "What happens if we try it differently?", timestamp: now },
          { role: "coach" as const, message: "Great question! Let's explore that.", timestamp: now },
        ];

  const coachSession: CoachSession = {
    id: randomUUID(),
    studentId: student.id,
    studentName: student.name,
    topics,
    messages,
    mode: "type",
    startedAt: now,
    endedAt: now,
    supportScore: intentType === "support-seeking" ? 3 : 0,
    enrichmentScore: intentType === "enrichment-seeking" ? 3 : 0,
    intentLabel: intentType,
  };

  coachSessionStore.save(coachSession);
  return coachSession;
}

async function seedData() {
  console.log("\n=== Seeding Recommendation Test Data ===\n");

  // Get available lessons
  const lessons = getAllLessons();
  if (lessons.length === 0) {
    console.error("No lessons found! Please create some lessons first.");
    return;
  }

  const testLesson = lessons[0];
  console.log(`Using lesson: "${testLesson.title}"\n`);

  // Create or get a test class
  let testClass = classStore.getAll().find((c) => c.name === "Test Class 3A");
  if (!testClass) {
    testClass = classStore.create({
      name: "Test Class 3A",
      teacherId: "test-teacher",
      gradeLevel: "3rd Grade",
      subjects: ["Reading", "Math"],
    });
    console.log(`Created class: ${testClass.name}\n`);
  } else {
    console.log(`Using existing class: ${testClass.name}\n`);
  }

  console.log("Creating students and sessions...\n");

  const createdStudents: Student[] = [];

  for (const { name, scenario } of dummyStudents) {
    const student = createStudent(name);
    createdStudents.push(student);

    // Add student to class if not already
    if (!testClass.students.includes(student.id)) {
      testClass.students.push(student.id);
      testClass.studentIds.push(student.id);
    }

    // Assign lesson to student
    studentAssignmentStore.assignLesson(testLesson.id, testClass.id, [student.id]);

    // Create sessions based on scenario
    switch (scenario) {
      case "struggling":
        // Low score, high hint usage -> triggers check_in
        createSession(student, testLesson.id, testLesson.title, Math.round(35 + Math.random() * 10), 0.8);
        console.log(`    Created struggling session for ${name} (score: ~40%, hints: 80%)`);

        // Add support-seeking coach session
        createCoachSession(student, [testLesson.title], "support-seeking");
        console.log(`    Created support-seeking coach session for ${name}`);
        break;

      case "excelling":
        // High score, low hint usage -> triggers challenge_opportunity
        createSession(student, testLesson.id, testLesson.title, Math.round(90 + Math.random() * 8), 0.1);
        console.log(`    Created excelling session for ${name} (score: ~95%, hints: 10%)`);

        // Add enrichment-seeking coach session
        createCoachSession(student, [testLesson.title], "enrichment-seeking");
        console.log(`    Created enrichment-seeking coach session for ${name}`);
        break;

      case "improved":
        // First attempt: low score
        createSession(student, testLesson.id, testLesson.title, 45, 0.6);
        console.log(`    Created first attempt for ${name} (score: 45%)`);

        // Wait a bit to ensure different timestamps
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Second attempt: higher score -> triggers celebrate_progress
        createSession(student, testLesson.id, testLesson.title, 78, 0.3);
        console.log(`    Created improved retry for ${name} (score: 78%, +33 improvement)`);
        break;

      case "average":
        // Middle-of-the-road performance
        createSession(student, testLesson.id, testLesson.title, Math.round(65 + Math.random() * 10), 0.4);
        console.log(`    Created average session for ${name} (score: ~70%)`);
        break;
    }
  }

  // Update the class with students (classStore doesn't have update, so we work with what we have)
  console.log("\n=== Summary ===");
  console.log(`Students created/updated: ${createdStudents.length}`);
  console.log(`Class: ${testClass.name} (${testClass.students.length} students)`);
  console.log(`\nExpected recommendations after refresh:`);
  console.log(`  - check_in: Emma, Liam, Olivia (struggling students)`);
  console.log(`  - challenge_opportunity: Sophia, Aiden (excelling students)`);
  console.log(`  - celebrate_progress: Noah, Mason (improved students)`);
  console.log(`\nGo to the Educator Dashboard and click "Refresh" to generate recommendations!`);
}

// Run the seed
seedData().catch(console.error);
