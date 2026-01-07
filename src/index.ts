import { Lesson } from "./domain/lesson";

const sampleLesson: Lesson = {
    id: "intro-prompts",
    title: "Intro to Prompt Writing",
    description: "Learn how to write clear, effective prompts",
    difficulty: "beginner",
    prompts: [
        {
            id: "p1",
            type: "explain",
            input: "Explain closures in JavaScript like I'm 10 years old.",
            hints: ["Use simple language", "Give a real-world analogy"]
        }
    ]
};

console.log(sampleLesson);

