import { Prompt } from "./prompt";

export interface Lesson {
    id: string;
    title: string;
    description: string;
    prompts: Prompt[];
    difficulty: "beginner" | "intermediate" | "advanced";
}