export type PromptType = "explain" | "generate" | "analyze" | "refactor";

export interface Prompt {
    id: string;
    type: PromptType;
    input: string;
    expectedOutput?: string;
    hints?: string[];
    standards?: string[]; // Ohio Learning Standards codes this question addresses
}