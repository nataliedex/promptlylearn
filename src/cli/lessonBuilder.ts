import readline from "readline";
import { Lesson } from "../domain/lesson";
import { Prompt } from "../domain/prompt";
import {
  generateLesson,
  generateSingleQuestion,
  CreationMode,
  LessonParams
} from "../domain/lessonGenerator";
import { saveLesson } from "../stores/lessonStore";
import { askMenu, askYesNo } from "./helpers";

/**
 * Main entry point for the lesson builder
 */
export async function runLessonBuilder(rl: readline.Interface): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("Create New Lesson");
  console.log("=".repeat(60));

  // Check for API key
  if (!process.env.OPENAI_API_KEY) {
    console.log("\nLesson generation requires OPENAI_API_KEY to be set.");
    console.log("Please add it to your .env file and restart.\n");
    return;
  }

  // Step 1: Choose creation mode
  const mode = await chooseCreationMode(rl);
  if (!mode) return;

  // Step 2: Get content based on mode
  const content = await getContentForMode(rl, mode);
  if (!content) return;

  // Step 3: Choose grade level
  const gradeLevel = await chooseGradeLevel(rl);

  // Step 4: Choose difficulty
  const difficulty = await chooseDifficulty(rl);

  // Step 5: Choose number of questions
  const questionCount = await chooseQuestionCount(rl);

  // Step 6: Generate the lesson
  console.log("\nGenerating lesson with AI...\n");

  const params: LessonParams = {
    mode,
    content,
    difficulty,
    questionCount,
    gradeLevel
  };

  const lesson = await generateLesson(params);

  if (!lesson) {
    console.log("\nFailed to generate lesson. Please try again.\n");
    return;
  }

  // Step 6: Review and edit
  const finalLesson = await reviewAndEditLesson(rl, lesson, content);

  if (!finalLesson) {
    console.log("\nLesson creation cancelled.\n");
    return;
  }

  // Step 7: Save
  const filePath = saveLesson(finalLesson);
  console.log("\n" + "=".repeat(60));
  console.log("Lesson saved successfully!");
  console.log("=".repeat(60));
  console.log(`\nTitle: ${finalLesson.title}`);
  console.log(`Questions: ${finalLesson.prompts.length}`);
  console.log(`File: ${filePath}`);
  console.log("\nThe lesson is now available for students!\n");
}

/**
 * Let educator choose how to create the lesson
 */
async function chooseCreationMode(rl: readline.Interface): Promise<CreationMode | null> {
  console.log("\nHow would you like to create your lesson?\n");

  const choice = await askMenu(rl, [
    "From a book (enter title)",
    "From a book (paste excerpt)",
    "From pasted text (article, story, etc.)",
    "From a topic",
    "Guided creation (describe what you want)",
    "Cancel"
  ]);

  switch (choice) {
    case 1: return "book-title";
    case 2: return "book-excerpt";
    case 3: return "pasted-text";
    case 4: return "topic";
    case 5: return "guided";
    default: return null;
  }
}

/**
 * Get the content/input based on the creation mode
 */
async function getContentForMode(
  rl: readline.Interface,
  mode: CreationMode
): Promise<string | null> {
  switch (mode) {
    case "book-title":
      console.log("\nEnter the book title:");
      return await askForText(rl);

    case "book-excerpt":
      console.log("\nPaste the book excerpt (press Enter twice when done):");
      return await askForMultilineText(rl);

    case "pasted-text":
      console.log("\nPaste the text you want to create a lesson from (press Enter twice when done):");
      return await askForMultilineText(rl);

    case "topic":
      console.log("\nWhat topic should the lesson cover?");
      return await askForText(rl);

    case "guided":
      console.log("\nDescribe the lesson you want to create:");
      console.log("(What should students learn? What skills should they practice?)");
      return await askForMultilineText(rl);

    default:
      return null;
  }
}

/**
 * Ask for a single line of text
 */
async function askForText(rl: readline.Interface): Promise<string | null> {
  return new Promise((resolve) => {
    rl.question("> ", (answer) => {
      const trimmed = answer.trim();
      if (trimmed === "") {
        resolve(null);
      } else {
        resolve(trimmed);
      }
    });
  });
}

/**
 * Ask for multiline text (ends with empty line)
 */
async function askForMultilineText(rl: readline.Interface): Promise<string | null> {
  return new Promise((resolve) => {
    const lines: string[] = [];

    const askLine = () => {
      rl.question("", (line) => {
        if (line === "" && lines.length > 0) {
          // Empty line signals end of input
          resolve(lines.join("\n"));
        } else if (line === "" && lines.length === 0) {
          // No input at all
          resolve(null);
        } else {
          lines.push(line);
          askLine();
        }
      });
    };

    console.log(""); // Start on new line
    askLine();
  });
}

/**
 * Choose grade level for the lesson
 */
async function chooseGradeLevel(rl: readline.Interface): Promise<string> {
  console.log("\nWhat grade level is this lesson for?\n");

  const choice = await askMenu(rl, [
    "Kindergarten (K)",
    "1st grade",
    "2nd grade",
    "3rd grade",
    "4th grade",
    "5th grade",
    "Middle school (6th-8th)",
    "High school (9th-12th)"
  ]);

  switch (choice) {
    case 1: return "Kindergarten";
    case 2: return "1st grade";
    case 3: return "2nd grade";
    case 4: return "3rd grade";
    case 5: return "4th grade";
    case 6: return "5th grade";
    case 7: return "middle school";
    case 8: return "high school";
    default: return "2nd grade";
  }
}

/**
 * Choose lesson difficulty
 */
async function chooseDifficulty(
  rl: readline.Interface
): Promise<"beginner" | "intermediate" | "advanced"> {
  console.log("\nSelect difficulty level:\n");

  const choice = await askMenu(rl, [
    "Beginner (simple questions, lots of scaffolding)",
    "Intermediate (more complex, some inference required)",
    "Advanced (challenging, requires deeper thinking)"
  ]);

  switch (choice) {
    case 1: return "beginner";
    case 2: return "intermediate";
    case 3: return "advanced";
    default: return "beginner";
  }
}

/**
 * Choose number of questions
 */
async function chooseQuestionCount(rl: readline.Interface): Promise<number> {
  console.log("\nHow many questions should the lesson have?\n");

  const choice = await askMenu(rl, [
    "2 questions (quick lesson)",
    "3 questions (standard)",
    "4 questions (comprehensive)",
    "5 questions (extended)"
  ]);

  return choice + 1; // Menu is 1-indexed, so choice 1 = 2 questions, etc.
}

/**
 * Review and edit the generated lesson
 */
async function reviewAndEditLesson(
  rl: readline.Interface,
  lesson: Lesson,
  originalContent: string
): Promise<Lesson | null> {
  let currentLesson = { ...lesson, prompts: [...lesson.prompts] };
  let questionIndex = 0;

  while (true) {
    // Display current state
    console.log("\n" + "=".repeat(60));
    console.log("Generated Lesson Preview");
    console.log("=".repeat(60));
    console.log(`\nTitle: ${currentLesson.title}`);
    console.log(`Description: ${currentLesson.description}`);
    console.log(`Difficulty: ${currentLesson.difficulty}`);

    if (currentLesson.prompts.length === 0) {
      console.log("\n(No questions yet)");
    } else {
      const prompt = currentLesson.prompts[questionIndex];
      console.log(`\n--- Question ${questionIndex + 1} of ${currentLesson.prompts.length} ---\n`);
      console.log(prompt.input);
      console.log("\nHints:");
      (prompt.hints || []).forEach((hint, i) => {
        console.log(`  ${i + 1}. ${hint}`);
      });
    }

    console.log("");

    // Build menu options
    const options = [
      "Edit this question",
      "Edit hints",
      "Delete this question",
      questionIndex < currentLesson.prompts.length - 1 ? "Next question" : "First question",
      questionIndex > 0 ? "Previous question" : "Last question",
      "Add a question",
      "Edit title/description",
      "Save lesson",
      "Cancel (discard)"
    ];

    const choice = await askMenu(rl, options);

    switch (choice) {
      case 1: // Edit question
        if (currentLesson.prompts.length > 0) {
          const newQuestion = await editQuestion(rl, currentLesson.prompts[questionIndex].input);
          if (newQuestion) {
            currentLesson.prompts[questionIndex].input = newQuestion;
          }
        }
        break;

      case 2: // Edit hints
        if (currentLesson.prompts.length > 0) {
          const newHints = await editHints(rl, currentLesson.prompts[questionIndex].hints || []);
          currentLesson.prompts[questionIndex].hints = newHints;
        }
        break;

      case 3: // Delete question
        if (currentLesson.prompts.length > 1) {
          const confirmDelete = await askYesNo(rl, "Delete this question?");
          if (confirmDelete) {
            currentLesson.prompts.splice(questionIndex, 1);
            // Renumber remaining prompts
            currentLesson.prompts = currentLesson.prompts.map((p, i) => ({
              ...p,
              id: `q${i + 1}`
            }));
            if (questionIndex >= currentLesson.prompts.length) {
              questionIndex = currentLesson.prompts.length - 1;
            }
          }
        } else {
          console.log("\nCannot delete the last question. Add another first or cancel.");
        }
        break;

      case 4: // Next/First question
        if (questionIndex < currentLesson.prompts.length - 1) {
          questionIndex++;
        } else {
          questionIndex = 0;
        }
        break;

      case 5: // Previous/Last question
        if (questionIndex > 0) {
          questionIndex--;
        } else {
          questionIndex = currentLesson.prompts.length - 1;
        }
        break;

      case 6: // Add question
        console.log("\nGenerating a new question...");
        const existingQuestions = currentLesson.prompts.map(p => p.input);
        const newPrompt = await generateSingleQuestion(
          originalContent,
          existingQuestions,
          currentLesson.difficulty
        );
        if (newPrompt) {
          newPrompt.id = `q${currentLesson.prompts.length + 1}`;
          currentLesson.prompts.push(newPrompt);
          questionIndex = currentLesson.prompts.length - 1;
          console.log("\nNew question added!");
        } else {
          console.log("\nFailed to generate question. Try again or add manually.");
        }
        break;

      case 7: // Edit title/description
        currentLesson = await editTitleDescription(rl, currentLesson);
        break;

      case 8: // Save
        return currentLesson;

      case 9: // Cancel
        const confirmCancel = await askYesNo(rl, "Discard this lesson?");
        if (confirmCancel) {
          return null;
        }
        break;
    }
  }
}

/**
 * Edit a question's text
 */
async function editQuestion(rl: readline.Interface, currentText: string): Promise<string | null> {
  console.log("\nCurrent question:");
  console.log(`"${currentText}"`);
  console.log("\nEnter new question (or press Enter to keep current):");

  return new Promise((resolve) => {
    rl.question("> ", (answer) => {
      const trimmed = answer.trim();
      resolve(trimmed || null);
    });
  });
}

/**
 * Edit hints for a question
 */
async function editHints(rl: readline.Interface, currentHints: string[]): Promise<string[]> {
  console.log("\nCurrent hints:");
  currentHints.forEach((hint, i) => {
    console.log(`  ${i + 1}. ${hint}`);
  });

  const newHints: string[] = [];

  for (let i = 0; i < 2; i++) {
    console.log(`\nEnter hint ${i + 1} (or press Enter to keep "${currentHints[i] || ""}"):`);
    const answer = await new Promise<string>((resolve) => {
      rl.question("> ", resolve);
    });

    const trimmed = answer.trim();
    newHints.push(trimmed || currentHints[i] || "");
  }

  return newHints;
}

/**
 * Edit lesson title and description
 */
async function editTitleDescription(rl: readline.Interface, lesson: Lesson): Promise<Lesson> {
  console.log("\nCurrent title:", lesson.title);
  console.log("Enter new title (or press Enter to keep current):");

  const newTitle = await new Promise<string>((resolve) => {
    rl.question("> ", resolve);
  });

  console.log("\nCurrent description:", lesson.description);
  console.log("Enter new description (or press Enter to keep current):");

  const newDescription = await new Promise<string>((resolve) => {
    rl.question("> ", resolve);
  });

  return {
    ...lesson,
    title: newTitle.trim() || lesson.title,
    description: newDescription.trim() || lesson.description
  };
}
