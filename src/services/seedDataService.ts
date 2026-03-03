/**
 * Seed Data Service (Development Only)
 *
 * Generates realistic demo data for testing educator workflows:
 * - Classes, students, lessons, assignments
 * - Various review states and workflow scenarios
 * - Recommendations, todos, analytics, insights
 */

import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { ClassStore } from "../stores/classStore";
import { Session } from "../domain/session";
import { Submission, PromptResponse, CoachTurn } from "../domain/submission";
import { EvaluationResult } from "../domain/evaluation";
import { Student } from "../domain/student";
import { Lesson } from "../domain/lesson";
import { Prompt } from "../domain/prompt";
import {
  AssignmentAttemptAnalytics,
  QuestionAttemptAnalytics,
  ConversationTurnAnalytics,
  COACH_ANALYTICS_SCHEMA_VERSION,
} from "../domain/coachAnalytics";

// Data directories
const DATA_ROOT = path.join(__dirname, "../../data");
const LESSONS_DIR = path.join(__dirname, "../data/lessons");

// ============================================
// Realistic Names
// ============================================

const FIRST_NAMES = [
  "Emma", "Liam", "Olivia", "Noah", "Ava", "Ethan", "Sophia", "Mason",
  "Isabella", "Lucas", "Mia", "Jackson", "Charlotte", "Aiden", "Amelia",
  "Oliver", "Harper", "Elijah", "Evelyn", "James",
];

const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller",
  "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez",
  "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
];

// ============================================
// Demo Lesson Definitions
// ============================================

const DEMO_LESSONS: Partial<Lesson>[] = [
  {
    id: "demo-reading-main-idea",
    title: "Finding the Main Idea",
    description: "Students learn to identify the main idea and supporting details in a text.",
    subject: "Reading",
    gradeLevel: "2nd Grade",
    difficulty: "beginner",
    prompts: [
      { id: "q1", type: "explain", input: "What is the main idea of the story we just read?", hints: ["Think about what the whole story is mostly about.", "What would you tell a friend this story is about?"] },
      { id: "q2", type: "explain", input: "What are two details that support the main idea?", hints: ["Look for sentences that tell more about the main idea.", "What examples does the author give?"] },
    ],
  },
  {
    id: "demo-math-word-problems",
    title: "Solving Word Problems",
    description: "Practice solving addition and subtraction word problems.",
    subject: "Math",
    gradeLevel: "2nd Grade",
    difficulty: "beginner",
    prompts: [
      { id: "q1", type: "explain", input: "Maria had 8 apples. She gave 3 to her friend. How many does she have now? Explain your thinking.", hints: ["What operation should you use?", "Draw a picture to help you."] },
      { id: "q2", type: "explain", input: "Tom has 5 red cars and 7 blue cars. How many cars does he have in all? Show your work.", hints: ["Are you putting together or taking apart?", "Try counting on your fingers."] },
    ],
  },
  {
    id: "demo-science-plants",
    title: "How Plants Grow",
    description: "Understanding what plants need to grow and stay healthy.",
    subject: "Science",
    gradeLevel: "2nd Grade",
    difficulty: "beginner",
    prompts: [
      { id: "q1", type: "explain", input: "What do plants need to grow? List at least three things.", hints: ["Think about what you give a plant to take care of it.", "What does a plant get from the sun?"] },
      { id: "q2", type: "explain", input: "Why do you think plants are important for people and animals?", hints: ["What do plants make that we breathe?", "What do some animals eat?"] },
    ],
  },
  {
    id: "demo-reading-characters",
    title: "Understanding Characters",
    description: "Analyzing character traits, feelings, and motivations.",
    subject: "Reading",
    gradeLevel: "3rd Grade",
    difficulty: "intermediate",
    prompts: [
      { id: "q1", type: "explain", input: "How did the main character feel at the beginning of the story? What clues tell you this?", hints: ["Look at what the character says and does.", "How would you feel in that situation?"] },
      { id: "q2", type: "explain", input: "How did the character change by the end? What caused this change?", hints: ["Compare the beginning and end.", "What important events happened?"] },
    ],
  },
  {
    id: "demo-math-multiplication",
    title: "Introduction to Multiplication",
    description: "Understanding multiplication as repeated addition and equal groups.",
    subject: "Math",
    gradeLevel: "3rd Grade",
    difficulty: "intermediate",
    prompts: [
      { id: "q1", type: "explain", input: "What does 4 x 3 mean? Explain using groups or repeated addition.", hints: ["Think of 4 groups of 3.", "How would you add 3 four times?"] },
      { id: "q2", type: "explain", input: "There are 5 bags with 6 oranges in each bag. How many oranges are there? Explain how you solved it.", hints: ["What multiplication fact can help?", "Draw the groups."] },
    ],
  },
  {
    id: "demo-science-weather",
    title: "Weather Patterns",
    description: "Learning about different types of weather and how to predict it.",
    subject: "Science",
    gradeLevel: "3rd Grade",
    difficulty: "intermediate",
    prompts: [
      { id: "q1", type: "explain", input: "What are three different types of weather? Describe each one.", hints: ["Think about sunny, rainy, and other conditions.", "What does each type feel like?"] },
      { id: "q2", type: "explain", input: "How can you predict what the weather might be tomorrow?", hints: ["What tools do weather scientists use?", "What clues can you look for in the sky?"] },
    ],
  },
  {
    id: "demo-writing-opinion",
    title: "Writing an Opinion",
    description: "Learning to write opinion pieces with supporting reasons.",
    subject: "Writing",
    gradeLevel: "3rd Grade",
    difficulty: "intermediate",
    prompts: [
      { id: "q1", type: "explain", input: "What is your favorite season and why? Give at least two reasons.", hints: ["Think about what you can do in that season.", "How does that season make you feel?"] },
      { id: "q2", type: "explain", input: "Some people think summer is the best season. Do you agree or disagree? Explain your thinking.", hints: ["State your opinion clearly.", "Give reasons to support your opinion."] },
    ],
  },
  {
    id: "demo-social-studies-community",
    title: "Our Community",
    description: "Understanding community helpers and civic responsibility.",
    subject: "Social Studies",
    gradeLevel: "2nd Grade",
    difficulty: "beginner",
    prompts: [
      { id: "q1", type: "explain", input: "Name three community helpers and explain what each one does.", hints: ["Think about people who help keep us safe.", "Who helps when we are sick?"] },
      { id: "q2", type: "explain", input: "How can kids help make their community a better place?", hints: ["What small things can you do?", "How can you be kind to neighbors?"] },
    ],
  },
];

// ============================================
// Sample Transcript Data
// ============================================

const SAMPLE_TRANSCRIPTS: { conversation: CoachTurn[]; response: string }[] = [
  {
    response: "I think the main idea is about a dog who learns to be brave.",
    conversation: [
      { role: "coach", message: "That's a good start! Can you tell me more about how the dog learned to be brave?" },
      { role: "student", message: "Well, the dog was scared of thunderstorms at first." },
      { role: "coach", message: "Yes! And what happened to help the dog overcome that fear?" },
      { role: "student", message: "His friend the cat helped him feel safe and then he wasn't scared anymore." },
      { role: "coach", message: "Excellent thinking! You identified how the dog changed and why." },
    ],
  },
  {
    response: "Plants need water, sunlight, and soil to grow.",
    conversation: [
      { role: "coach", message: "You named three important things! Can you explain why plants need sunlight?" },
      { role: "student", message: "Um, I think they use it to make food?" },
      { role: "coach", message: "That's right! Plants use sunlight to make their own food through photosynthesis. What about water - why do plants need that?" },
      { role: "student", message: "They drink it like we do and it helps them stay strong." },
      { role: "coach", message: "Great connection! Water does help plants stay healthy and carry nutrients." },
    ],
  },
  {
    response: "4 x 3 means 4 groups of 3 which is 3 + 3 + 3 + 3 = 12",
    conversation: [
      { role: "coach", message: "Perfect! You showed multiplication as both groups and repeated addition. Can you think of a real-life example of 4 groups of 3?" },
      { role: "student", message: "Like if there are 4 tables and 3 kids sit at each table?" },
      { role: "coach", message: "That's an excellent real-world example! How many kids would there be altogether?" },
      { role: "student", message: "12 kids!" },
      { role: "coach", message: "You've got it! You really understand what multiplication means." },
    ],
  },
];

// ============================================
// Seed Data Generator
// ============================================

export class SeedDataService {
  private classStore = new ClassStore();

  /**
   * Generate all seed data
   */
  async seedAll(): Promise<{ summary: string; counts: Record<string, number> }> {
    console.log("Starting seed data generation...");

    // Clear existing data first
    await this.clearAllData();

    const counts: Record<string, number> = {};

    // 1. Create demo lessons
    const lessons = this.createLessons();
    counts.lessons = lessons.length;
    console.log(`Created ${lessons.length} lessons`);

    // 2. Create students
    const students = this.createStudents(14);
    counts.students = students.length;
    console.log(`Created ${students.length} students`);

    // 3. Create classes and assign students
    const classes = this.createClasses(students);
    counts.classes = classes.length;
    console.log(`Created ${classes.length} classes`);

    // 4. Create assignments with various states
    const { assignments, sessions, analytics } = this.createAssignmentsAndSessions(
      lessons,
      students,
      classes
    );
    counts.assignments = assignments.length;
    counts.sessions = sessions.length;
    counts.analytics = analytics.length;
    console.log(`Created ${assignments.length} assignments, ${sessions.length} sessions`);

    // 5. Create recommendations
    const recommendations = this.createRecommendations(assignments, students, lessons);
    counts.recommendations = recommendations.length;
    console.log(`Created ${recommendations.length} recommendations`);

    // 6. Create teacher todos
    const todos = this.createTeacherTodos(assignments, students, recommendations);
    counts.todos = todos.length;
    console.log(`Created ${todos.length} teacher todos`);

    const summary = `Seed complete: ${counts.students} students, ${counts.classes} classes, ${counts.lessons} lessons, ${counts.assignments} assignments, ${counts.sessions} sessions, ${counts.recommendations} recommendations, ${counts.todos} todos`;

    return { summary, counts };
  }

  /**
   * Clear only demo/seeded data (files with "demo-" prefix)
   * This preserves user-created data.
   */
  async clearDemoData(): Promise<void> {
    // Clear demo students
    const studentsDir = path.join(DATA_ROOT, "students");
    if (fs.existsSync(studentsDir)) {
      const files = fs.readdirSync(studentsDir).filter(f => f.startsWith("student-") && f.endsWith(".json"));
      for (const file of files) {
        // Check if this student was created by seed (has demo class)
        try {
          const content = fs.readFileSync(path.join(studentsDir, file), "utf-8");
          const student = JSON.parse(content);
          if (student.classes?.some((c: string) => c.startsWith("demo-"))) {
            fs.unlinkSync(path.join(studentsDir, file));
          }
        } catch {
          // Skip if can't read
        }
      }
    }

    // Clear demo sessions (linked to demo lessons)
    const sessionsDir = path.join(DATA_ROOT, "sessions");
    if (fs.existsSync(sessionsDir)) {
      const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith(".json"));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(sessionsDir, file), "utf-8");
          const session = JSON.parse(content);
          if (session.lessonId?.startsWith("demo-")) {
            fs.unlinkSync(path.join(sessionsDir, file));
          }
        } catch {
          // Skip if can't read
        }
      }
    }

    // Clear demo classes
    const classesDir = path.join(DATA_ROOT, "classes");
    if (fs.existsSync(classesDir)) {
      const files = fs.readdirSync(classesDir).filter(f => f.startsWith("demo-") && f.endsWith(".json"));
      for (const file of files) {
        fs.unlinkSync(path.join(classesDir, file));
      }
    }

    // Clear demo analytics
    const analyticsDir = path.join(DATA_ROOT, "analytics");
    if (fs.existsSync(analyticsDir)) {
      const files = fs.readdirSync(analyticsDir).filter(f => f.startsWith("demo-") && f.endsWith(".json"));
      for (const file of files) {
        fs.unlinkSync(path.join(analyticsDir, file));
      }
    }

    // Filter demo assignments from consolidated file
    const assignmentsFile = path.join(DATA_ROOT, "student-assignments.json");
    if (fs.existsSync(assignmentsFile)) {
      try {
        const content = fs.readFileSync(assignmentsFile, "utf-8");
        const data = JSON.parse(content);
        data.assignments = (data.assignments || []).filter(
          (a: any) => !a.lessonId?.startsWith("demo-") && !a.classId?.startsWith("demo-")
        );
        fs.writeFileSync(assignmentsFile, JSON.stringify(data, null, 2));
      } catch {
        // Skip if can't process
      }
    }

    // Filter demo recommendations
    const recommendationsFile = path.join(DATA_ROOT, "recommendations.json");
    if (fs.existsSync(recommendationsFile)) {
      try {
        const content = fs.readFileSync(recommendationsFile, "utf-8");
        const data = JSON.parse(content);
        data.recommendations = (data.recommendations || []).filter(
          (r: any) => !r.assignmentId?.startsWith("demo-")
        );
        fs.writeFileSync(recommendationsFile, JSON.stringify(data, null, 2));
      } catch {
        // Skip if can't process
      }
    }

    // Filter demo todos
    const todosFile = path.join(DATA_ROOT, "teacher-todos.json");
    if (fs.existsSync(todosFile)) {
      try {
        const content = fs.readFileSync(todosFile, "utf-8");
        const data = JSON.parse(content);
        data.todos = (data.todos || []).filter(
          (t: any) => !t.assignmentId?.startsWith("demo-") && !t.classId?.startsWith("demo-")
        );
        fs.writeFileSync(todosFile, JSON.stringify(data, null, 2));
      } catch {
        // Skip if can't process
      }
    }

    // Clear demo lessons
    if (fs.existsSync(LESSONS_DIR)) {
      const lessonFiles = fs.readdirSync(LESSONS_DIR).filter(f => f.startsWith("demo-") && f.endsWith(".json"));
      for (const file of lessonFiles) {
        fs.unlinkSync(path.join(LESSONS_DIR, file));
      }
    }

    // Clear demo insight resolutions
    const resolutionsDir = path.join(DATA_ROOT, "insight-resolutions");
    if (fs.existsSync(resolutionsDir)) {
      const files = fs.readdirSync(resolutionsDir).filter(f => f.startsWith("demo-") && f.endsWith(".json"));
      for (const file of files) {
        fs.unlinkSync(path.join(resolutionsDir, file));
      }
    }

    console.log("Cleared demo data only");
  }

  /**
   * Clear ALL data files (destructive - use with caution)
   */
  async clearAllData(): Promise<void> {
    const dirsToClean = [
      path.join(DATA_ROOT, "students"),
      path.join(DATA_ROOT, "sessions"),
      path.join(DATA_ROOT, "classes"),
      path.join(DATA_ROOT, "analytics"),
    ];

    for (const dir of dirsToClean) {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
        for (const file of files) {
          fs.unlinkSync(path.join(dir, file));
        }
      }
    }

    // Clear consolidated JSON files
    const filesToClear = [
      path.join(DATA_ROOT, "student-assignments.json"),
      path.join(DATA_ROOT, "recommendations.json"),
      path.join(DATA_ROOT, "teacher-todos.json"),
      path.join(DATA_ROOT, "badges.json"),
    ];

    for (const file of filesToClear) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }

    // Clear demo lessons (but keep non-demo lessons)
    if (fs.existsSync(LESSONS_DIR)) {
      const lessonFiles = fs.readdirSync(LESSONS_DIR).filter(f => f.startsWith("demo-") && f.endsWith(".json"));
      for (const file of lessonFiles) {
        fs.unlinkSync(path.join(LESSONS_DIR, file));
      }
    }

    // Clear insight resolutions
    const resolutionsDir = path.join(DATA_ROOT, "insight-resolutions");
    if (fs.existsSync(resolutionsDir)) {
      const files = fs.readdirSync(resolutionsDir).filter(f => f.endsWith(".json"));
      for (const file of files) {
        fs.unlinkSync(path.join(resolutionsDir, file));
      }
    }

    console.log("Cleared ALL data");
  }

  // ============================================
  // Create Lessons
  // ============================================

  private createLessons(): Lesson[] {
    if (!fs.existsSync(LESSONS_DIR)) {
      fs.mkdirSync(LESSONS_DIR, { recursive: true });
    }

    const lessons: Lesson[] = [];
    for (const template of DEMO_LESSONS) {
      const lesson: Lesson = {
        id: template.id!,
        title: template.title!,
        description: template.description!,
        subject: template.subject!,
        gradeLevel: template.gradeLevel!,
        difficulty: template.difficulty!,
        prompts: template.prompts as Prompt[],
      };
      lessons.push(lesson);

      const filePath = path.join(LESSONS_DIR, `${lesson.id}.json`);
      fs.writeFileSync(filePath, JSON.stringify(lesson, null, 2));
    }

    return lessons;
  }

  // ============================================
  // Create Students
  // ============================================

  private createStudents(count: number): Student[] {
    const studentsDir = path.join(DATA_ROOT, "students");
    if (!fs.existsSync(studentsDir)) {
      fs.mkdirSync(studentsDir, { recursive: true });
    }

    const students: Student[] = [];
    const usedNames = new Set<string>();

    for (let i = 0; i < count; i++) {
      let firstName: string, lastName: string, fullName: string;
      do {
        firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
        lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
        fullName = `${firstName} ${lastName}`;
      } while (usedNames.has(fullName));
      usedNames.add(fullName);

      const student: Student = {
        id: `student-${randomUUID().substring(0, 8)}`,
        name: fullName,
        studentCode: this.generateStudentCode(),
        classes: [],
        assignments: [],
        createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000), // Random date in last 30 days
      };
      students.push(student);

      const filePath = path.join(studentsDir, `${student.id}.json`);
      fs.writeFileSync(filePath, JSON.stringify(student, null, 2));
    }

    return students;
  }

  private generateStudentCode(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  // ============================================
  // Create Classes
  // ============================================

  private createClasses(students: Student[]): Array<{ id: string; name: string; students: string[] }> {
    const classesDir = path.join(DATA_ROOT, "classes");
    if (!fs.existsSync(classesDir)) {
      fs.mkdirSync(classesDir, { recursive: true });
    }

    // Split students between two classes
    const midpoint = Math.ceil(students.length / 2);
    const class1Students = students.slice(0, midpoint);
    const class2Students = students.slice(midpoint);

    const classes = [
      {
        id: "demo-class-2nd-grade",
        name: "2nd Grade - Mrs. Johnson",
        teacherId: "demo-teacher",
        students: class1Students.map(s => s.id),
        studentIds: class1Students.map(s => s.id),
        subjects: ["Reading", "Math", "Science", "Social Studies"],
        gradeLevel: "2nd Grade",
        schoolYear: "2025-2026",
        createdAt: new Date().toISOString(),
      },
      {
        id: "demo-class-3rd-grade",
        name: "3rd Grade - Mr. Smith",
        teacherId: "demo-teacher",
        students: class2Students.map(s => s.id),
        studentIds: class2Students.map(s => s.id),
        subjects: ["Reading", "Math", "Science", "Writing"],
        gradeLevel: "3rd Grade",
        schoolYear: "2025-2026",
        createdAt: new Date().toISOString(),
      },
    ];

    // Update students with class assignments
    const studentsDir = path.join(DATA_ROOT, "students");
    for (const student of class1Students) {
      student.classes = [classes[0].id];
      fs.writeFileSync(path.join(studentsDir, `${student.id}.json`), JSON.stringify(student, null, 2));
    }
    for (const student of class2Students) {
      student.classes = [classes[1].id];
      fs.writeFileSync(path.join(studentsDir, `${student.id}.json`), JSON.stringify(student, null, 2));
    }

    // Save classes
    for (const classObj of classes) {
      fs.writeFileSync(path.join(classesDir, `${classObj.id}.json`), JSON.stringify(classObj, null, 2));
    }

    return classes;
  }

  // ============================================
  // Create Assignments and Sessions
  // ============================================

  private createAssignmentsAndSessions(
    lessons: Lesson[],
    students: Student[],
    classes: Array<{ id: string; name: string; students: string[] }>
  ): {
    assignments: any[];
    sessions: Session[];
    analytics: AssignmentAttemptAnalytics[];
  } {
    const sessionsDir = path.join(DATA_ROOT, "sessions");
    const analyticsDir = path.join(DATA_ROOT, "analytics");
    if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });
    if (!fs.existsSync(analyticsDir)) fs.mkdirSync(analyticsDir, { recursive: true });

    const assignments: any[] = [];
    const sessions: Session[] = [];
    const analytics: AssignmentAttemptAnalytics[] = [];

    // Map lessons to appropriate classes by grade level
    const class2ndGrade = classes.find(c => c.id === "demo-class-2nd-grade")!;
    const class3rdGrade = classes.find(c => c.id === "demo-class-3rd-grade")!;

    const lessonClassMap: Record<string, typeof class2ndGrade> = {};
    for (const lesson of lessons) {
      if (lesson.gradeLevel?.includes("2nd")) {
        lessonClassMap[lesson.id] = class2ndGrade;
      } else {
        lessonClassMap[lesson.id] = class3rdGrade;
      }
    }

    // Track assignment scenario distribution
    let scenarioIndex = 0;
    const scenarios = [
      "awaiting", "awaiting", // A) Awaiting submissions
      "needs_review", "needs_review", "needs_review", // B) Submitted but needs review
      "reviewed_no_followup", "reviewed_no_followup", // C) Reviewed with no follow-up
      "reviewed_with_followup", "reviewed_with_followup", // D) Reviewed with follow-up scheduled
      "followup_resolved", // E) Follow-up resolved
      "reopened", // F) Reopened for review
      "stagnation_action_required", "stagnation_action_required", // G) Stagnation/move-on (ACTION_REQUIRED)
    ];

    for (const lesson of lessons) {
      const classObj = lessonClassMap[lesson.id];
      const classStudents = students.filter(s => classObj.students.includes(s.id));

      for (const student of classStudents) {
        const scenario = scenarios[scenarioIndex % scenarios.length];
        scenarioIndex++;

        const assignedAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
        const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now

        const assignment: any = {
          id: `${lesson.id}-${student.id}`,
          lessonId: lesson.id,
          classId: classObj.id,
          studentId: student.id,
          assignedAt: assignedAt.toISOString(),
          dueDate: dueDate.toISOString(),
          attempts: 0,
          reviewState: "not_started",
          todoIds: [],
          badgeIds: [],
        };

        // Apply scenario-specific state
        switch (scenario) {
          case "awaiting":
            // No changes - awaiting submission
            break;

          case "needs_review":
            // Create completed session
            const sessionNR = this.createSession(lesson, student, classObj.id, "completed");
            sessions.push(sessionNR);
            this.saveSession(sessionNR);
            assignment.completedAt = sessionNR.completedAt;
            assignment.attempts = 1;
            assignment.reviewState = "pending_review";
            break;

          case "reviewed_no_followup":
            // Create completed session and mark reviewed
            const sessionRNF = this.createSession(lesson, student, classObj.id, "completed");
            sessions.push(sessionRNF);
            this.saveSession(sessionRNF);
            assignment.completedAt = sessionRNF.completedAt;
            assignment.attempts = 1;
            assignment.reviewState = "reviewed";
            assignment.reviewedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
            break;

          case "reviewed_with_followup":
            // Create completed session with follow-up todo
            const sessionRWF = this.createSession(lesson, student, classObj.id, "completed");
            sessions.push(sessionRWF);
            this.saveSession(sessionRWF);
            assignment.completedAt = sessionRWF.completedAt;
            assignment.attempts = 1;
            assignment.reviewState = "followup_scheduled";
            assignment.reviewedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
            assignment.todoIds = [`todo-${assignment.id}`];
            break;

          case "followup_resolved":
            // Create completed session with resolved todo
            const sessionFR = this.createSession(lesson, student, classObj.id, "completed");
            sessions.push(sessionFR);
            this.saveSession(sessionFR);
            assignment.completedAt = sessionFR.completedAt;
            assignment.attempts = 1;
            assignment.reviewState = "resolved";
            assignment.reviewedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
            break;

          case "reopened":
            // Create completed session that was reviewed then reopened
            const sessionRO = this.createSession(lesson, student, classObj.id, "completed");
            sessionRO.educatorNotes = "---\n[System - Feb 5, 2026]\nReviewed by teacher (no follow-up needed).\n---\n[System - Feb 7, 2026]\nReopened for review.";
            sessions.push(sessionRO);
            this.saveSession(sessionRO);
            assignment.completedAt = sessionRO.completedAt;
            assignment.attempts = 1;
            assignment.reviewState = "pending_review";
            break;

          case "stagnation_action_required":
            // Create session with stagnation/move-on event (triggers ACTION_REQUIRED)
            const sessionSAR = this.createSession(lesson, student, classObj.id, "completed", true);
            sessions.push(sessionSAR);
            this.saveSession(sessionSAR);
            assignment.completedAt = sessionSAR.completedAt;
            assignment.attempts = 1;
            assignment.reviewState = "pending_review";
            // Create analytics with move-on event
            const analyticsData = this.createAnalyticsWithMoveOn(lesson, student.id, classObj.id, sessionSAR.id);
            analytics.push(analyticsData);
            this.saveAnalytics(analyticsData);
            break;
        }

        assignments.push(assignment);
      }
    }

    // Save assignments
    this.saveAssignments(assignments);

    return { assignments, sessions, analytics };
  }

  private createSession(
    lesson: Lesson,
    student: Student,
    classId: string,
    status: "completed" | "in_progress",
    hasStagnation: boolean = false
  ): Session {
    const sessionId = `session-${randomUUID().substring(0, 8)}`;
    const startedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const completedAt = status === "completed" ? new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) : undefined;

    const responses: PromptResponse[] = lesson.prompts.map((prompt, idx) => {
      // Use sample transcript for some responses
      const useSampleTranscript = Math.random() > 0.7 && idx < SAMPLE_TRANSCRIPTS.length;
      const sampleData = useSampleTranscript ? SAMPLE_TRANSCRIPTS[idx % SAMPLE_TRANSCRIPTS.length] : null;

      const response: PromptResponse = {
        promptId: prompt.id,
        response: sampleData?.response || this.generateSampleResponse(prompt.input),
        hintUsed: Math.random() > 0.7,
        inputSource: Math.random() > 0.5 ? "voice" : "typed",
      };

      // Add transcript conversation for some
      if (sampleData?.conversation) {
        response.helpConversation = {
          mode: "help",
          turns: sampleData.conversation,
        };
      }

      // Add stagnation metadata for designated sessions
      if (hasStagnation && idx === 0) {
        response.deferredByCoach = true;
        response.deferralMetadata = {
          reason: "stagnation",
          pattern: "repeated-error",
          attemptCount: 4,
          deferredAt: new Date().toISOString(),
        };
      }

      return response;
    });

    const submission: Submission = {
      assignmentId: lesson.id,
      studentId: student.id,
      responses,
      submittedAt: completedAt || new Date(),
    };

    const evaluation: EvaluationResult = {
      totalScore: 70 + Math.floor(Math.random() * 30),
      feedback: "Good effort! You showed understanding of the main concepts.",
      criteriaScores: [
        { criterionId: "understanding", score: 70 + Math.floor(Math.random() * 30), comment: "Good understanding" },
        { criterionId: "reasoning", score: 65 + Math.floor(Math.random() * 35), comment: "Clear reasoning" },
        { criterionId: "clarity", score: 60 + Math.floor(Math.random() * 40), comment: "Nice explanation" },
      ],
    };

    return {
      id: sessionId,
      studentId: student.id,
      studentName: student.name,
      lessonId: lesson.id,
      lessonTitle: lesson.title,
      submission,
      evaluation,
      startedAt,
      completedAt,
      status,
    };
  }

  private generateSampleResponse(question: string): string {
    const genericResponses = [
      "I think the answer is about understanding the main point and explaining it clearly.",
      "The story shows that being kind to others is important because it helps everyone.",
      "I solved it by adding the numbers together and got the answer.",
      "Plants need water and sunlight to grow because they use them to make food.",
      "The character changed because something important happened to them.",
    ];
    return genericResponses[Math.floor(Math.random() * genericResponses.length)];
  }

  private createAnalyticsWithMoveOn(
    lesson: Lesson,
    studentId: string,
    classId: string,
    sessionId: string
  ): AssignmentAttemptAnalytics {
    const now = new Date();
    const startTime = new Date(now.getTime() - 10 * 60 * 1000); // 10 minutes ago

    const questionAnalytics: QuestionAttemptAnalytics[] = lesson.prompts.map((prompt, idx) => {
      const qStartTime = new Date(startTime.getTime() + idx * 5 * 60 * 1000);
      const qEndTime = new Date(qStartTime.getTime() + 4 * 60 * 1000);

      return {
        questionId: prompt.id,
        questionIndex: idx,
        startedAt: qStartTime.toISOString(),
        endedAt: qEndTime.toISOString(),
        timeSpentMs: 120000 + Math.floor(Math.random() * 60000),
        studentTurnCount: idx === 0 ? 6 : 3,
        coachTurnCount: idx === 0 ? 5 : 2,
        hintCount: idx === 0 ? 2 : 0,
        probeCount: idx === 0 ? 3 : 1,
        reframeCount: idx === 0 ? 1 : 0,
        misconceptionDetected: idx === 0,
        misconceptionType: idx === 0 ? "concept_confusion" : null,
        misconceptionConfidence: idx === 0 ? "high" : "unknown",
        stagnationDetected: idx === 0,
        stagnationReason: idx === 0 ? "repeating_same_answer" : null,
        moveOnTriggered: idx === 0,
        moveOnTrigger: idx === 0 ? "stagnation_threshold" : null,
        correctnessEstimate: idx === 0 ? "incorrect" : "partially_correct",
        confidenceEstimate: idx === 0 ? "low" : "medium",
        supportLevelUsed: idx === 0 ? "heavy_support" : "light_probe",
        outcomeTag: idx === 0 ? "moved_on" : "partial_understanding",
        turns: [], // Empty for simplicity
      };
    });

    return {
      assignmentId: lesson.id,
      studentId,
      attemptId: sessionId,
      classId,
      subject: lesson.subject || "General",
      gradeLevel: lesson.gradeLevel,
      difficulty: lesson.difficulty,
      startedAt: startTime.toISOString(),
      submittedAt: now.toISOString(),
      modality: "text",
      questionAnalytics,
      totals: {
        totalTimeMs: questionAnalytics.reduce((sum, q) => sum + q.timeSpentMs, 0),
        totalStudentTurns: questionAnalytics.reduce((sum, q) => sum + q.studentTurnCount, 0),
        totalCoachTurns: questionAnalytics.reduce((sum, q) => sum + q.coachTurnCount, 0),
        totalHints: questionAnalytics.reduce((sum, q) => sum + q.hintCount, 0),
        totalProbes: questionAnalytics.reduce((sum, q) => sum + q.probeCount, 0),
        totalReframes: questionAnalytics.reduce((sum, q) => sum + q.reframeCount, 0),
        misconceptionsCount: 1,
        moveOnsCount: 1,
      },
      overallSupportLevel: "high",
      overallOutcome: "needs_support",
      systemRecommendationCandidates: [
        {
          type: "needs_support",
          reason: "Student struggled with the main concept and coach moved on after stagnation.",
          suggestedActions: ["add_todo", "invite_support_session"],
          confidence: "high",
          sourceSignals: ["move_on_stagnation", "misconception_detected"],
        },
      ],
      version: COACH_ANALYTICS_SCHEMA_VERSION,
    };
  }

  private saveSession(session: Session): void {
    const sessionsDir = path.join(DATA_ROOT, "sessions");
    fs.writeFileSync(path.join(sessionsDir, `${session.id}.json`), JSON.stringify(session, null, 2));
  }

  private saveAnalytics(analytics: AssignmentAttemptAnalytics): void {
    const analyticsDir = path.join(DATA_ROOT, "analytics");
    if (!fs.existsSync(analyticsDir)) fs.mkdirSync(analyticsDir, { recursive: true });
    const filename = `${analytics.assignmentId}_${analytics.studentId}_${analytics.attemptId}.json`;
    fs.writeFileSync(path.join(analyticsDir, filename), JSON.stringify(analytics, null, 2));
  }

  private saveAssignments(assignments: any[]): void {
    const data = { assignments };
    fs.writeFileSync(path.join(DATA_ROOT, "student-assignments.json"), JSON.stringify(data, null, 2));
  }

  // ============================================
  // Create Recommendations
  // ============================================

  private createRecommendations(
    assignments: any[],
    students: Student[],
    lessons: Lesson[]
  ): any[] {
    const recommendations: any[] = [];
    const now = new Date().toISOString();

    // Get assignments that need review
    const pendingReviewAssignments = assignments.filter(
      (a) => a.reviewState === "pending_review"
    );

    // Create recommendations for different types
    const recommendationTypes = [
      {
        insightType: "challenge_opportunity",
        type: "extend_learning",
        summary: "Ready for a challenge",
        reason: "This student answered all questions correctly and showed strong understanding. Consider offering enrichment activities.",
        suggestedActions: ["Award badge", "Assign challenge lesson"],
        priority: 75,
      },
      {
        insightType: "celebrate_progress",
        type: "celebrate_progress",
        summary: "Significant improvement",
        reason: "This student improved their score by 25% compared to their previous attempt. Consider celebrating their progress.",
        suggestedActions: ["Award badge", "Send encouragement"],
        priority: 70,
      },
      {
        insightType: "check_in",
        type: "check_in",
        summary: "Check in recommended",
        reason: "This student took longer than usual and requested multiple hints. A brief check-in may help identify any confusion.",
        suggestedActions: ["Schedule 1:1 check-in", "Add to follow-up list"],
        priority: 65,
      },
      {
        insightType: "check_in",
        type: "needs_support",
        summary: "Needs support",
        reason: "This student struggled with the main concept and the coach moved on after several attempts. Direct support recommended.",
        suggestedActions: ["Schedule support session", "Reassign with scaffolding"],
        priority: 90,
      },
      {
        insightType: "monitor",
        type: "group_support",
        summary: "Common misconception detected",
        reason: "Multiple students showed confusion about the same concept. Consider a whole-class review.",
        suggestedActions: ["Plan mini-lesson", "Create review activity"],
        priority: 85,
        isGroup: true,
      },
    ];

    let recIndex = 0;
    for (const assignment of pendingReviewAssignments.slice(0, 8)) {
      const recTemplate = recommendationTypes[recIndex % recommendationTypes.length];
      recIndex++;

      const student = students.find((s) => s.id === assignment.studentId);
      const lesson = lessons.find((l) => l.id === assignment.lessonId);

      if (!student || !lesson) continue;

      // For group support, include multiple students
      let studentIds = [student.id];
      if (recTemplate.isGroup) {
        const sameClassStudents = students.filter(
          (s) => s.id !== student.id && s.classes[0] === student.classes[0]
        );
        if (sameClassStudents.length > 0) {
          studentIds.push(sameClassStudents[0].id);
          if (sameClassStudents.length > 1) {
            studentIds.push(sameClassStudents[1].id);
          }
        }
      }

      const recommendation = {
        id: `rec-${randomUUID().substring(0, 8)}`,
        insightType: recTemplate.insightType,
        type: recTemplate.type,
        priority: recTemplate.priority,
        summary: recTemplate.summary,
        reason: recTemplate.reason,
        evidence: [
          `Completed ${lesson.title}`,
          student.name,
        ],
        suggestedTeacherActions: recTemplate.suggestedActions,
        studentIds,
        assignmentId: assignment.lessonId,
        triggerData: {
          ruleName: `seed_${recTemplate.type}`,
          signals: { seeded: true },
          generatedAt: now,
        },
        status: "active",
        createdAt: now,
      };

      recommendations.push(recommendation);
    }

    // Save recommendations
    const data = { recommendations, lastUpdated: now };
    fs.writeFileSync(path.join(DATA_ROOT, "recommendations.json"), JSON.stringify(data, null, 2));

    return recommendations;
  }

  // ============================================
  // Create Teacher Todos
  // ============================================

  private createTeacherTodos(
    assignments: any[],
    students: Student[],
    recommendations: any[]
  ): any[] {
    const todos: any[] = [];
    const now = new Date().toISOString();

    // Create todos for followup_scheduled assignments
    const followupAssignments = assignments.filter(
      (a) => a.reviewState === "followup_scheduled" && a.todoIds?.length > 0
    );

    for (const assignment of followupAssignments) {
      const student = students.find((s) => s.id === assignment.studentId);
      if (!student) continue;

      const todo = {
        id: assignment.todoIds[0],
        teacherId: "demo-teacher",
        recommendationId: "",
        actionKey: "check_in_1to1",
        label: `Check in with ${student.name} about their work`,
        classId: assignment.classId,
        assignmentId: assignment.lessonId,
        studentIds: [student.id],
        studentNames: student.name,
        status: "open",
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      };

      todos.push(todo);
    }

    // Create one completed todo for resolved followup
    const resolvedAssignment = assignments.find((a) => a.reviewState === "resolved");
    if (resolvedAssignment) {
      const student = students.find((s) => s.id === resolvedAssignment.studentId);
      if (student) {
        todos.push({
          id: `todo-done-${randomUUID().substring(0, 8)}`,
          teacherId: "demo-teacher",
          recommendationId: "",
          actionKey: "review_responses",
          label: `Review ${student.name}'s responses`,
          classId: resolvedAssignment.classId,
          assignmentId: resolvedAssignment.lessonId,
          studentIds: [student.id],
          studentNames: student.name,
          status: "done",
          createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
          doneAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
        });
      }
    }

    // Create one superseded todo for reopened assignment
    const reopenedAssignment = assignments.find(
      (a) => a.reviewState === "pending_review" &&
        assignments.filter((x) => x.lessonId === a.lessonId && x.studentId === a.studentId).length === 1
    );

    // Save todos
    const data = { todos, lastUpdated: now };
    fs.writeFileSync(path.join(DATA_ROOT, "teacher-todos.json"), JSON.stringify(data, null, 2));

    return todos;
  }
}

// Export singleton
export const seedDataService = new SeedDataService();
