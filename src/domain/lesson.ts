import { Prompt } from "./prompt";

export interface Lesson {
    id: string;
    title: string;
    description: string;
    prompts: Prompt[];
    difficulty: "beginner" | "intermediate" | "advanced";
    gradeLevel?: string; // e.g., "K", "1", "2" (grade number/letter)
    subject?: string; // Subject area for the lesson (e.g., "Reading", "Math", "Science")
    /**
     * System-managed lesson index in format: "{Subject} {Grade}.{Sequence}"
     * Example: "Math 1.3" = Math subject, Grade 1, sequence 3
     * Auto-generated, scoped to Subject + Grade + Skill Level, never reused
     */
    systemIndex?: string;
}