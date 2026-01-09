import { Prompt } from "./prompt";

export interface Lesson {
    id: string;
    title: string;
    description: string;
    prompts: Prompt[];
    difficulty: "beginner" | "intermediate" | "advanced";
    gradeLevel?: string; // e.g., "2nd grade", "K-1", "3rd-4th grade"
}