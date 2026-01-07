export type PromptType = "explain" | "generate" | "analyze" | "refactor";

export interface Prompt {
    id: string;
    type: PromptType;
    input: string;
    expectedOutput?: string;
    hints?: string[];
}