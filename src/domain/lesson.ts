import { Prompt } from "./prompt";

export interface Lesson {
    id: string;
    title: string;
    description: string;
    prompts: Prompt[];
    difficulty: "beginner" | "intermediate" | "advanced";
    gradeLevel?: string; // e.g., "2nd grade", "K-1", "3rd-4th grade"
    standards?: string[]; // Ohio Learning Standards codes, e.g., ["RL.2.1", "RL.2.3"]
}