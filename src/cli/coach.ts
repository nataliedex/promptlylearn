import readline from "readline";
import OpenAI from "openai";
import { recordAndTranscribe, speak } from "./voice";
import { CoachConversation } from "../domain/submission";

/**
 * AI Coach for conversational guidance during lessons.
 *
 * Two modes:
 * - "help" mode: Socratic guidance during a question (doesn't give answers)
 * - "more" mode: Deeper exploration after answering (can expand on topic)
 */

let openaiClient: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }
  return openaiClient;
}

// Re-export for convenience
export { CoachConversation };

/**
 * Start a help conversation (Socratic guidance, no answers)
 */
export async function startHelpConversation(
  rl: readline.Interface,
  questionText: string,
  hints: string[]
): Promise<CoachConversation> {
  const conversation: CoachConversation = {
    mode: "help",
    turns: []
  };

  const client = getClient();
  if (!client) {
    console.log("\n🤖 Coach: I'd love to help, but I'm not available right now.");
    console.log("   (Set OPENAI_API_KEY in .env for AI coach)");
    if (hints.length > 0) {
      console.log(`\n   Here's a hint instead: ${hints.join("; ")}\n`);
    }
    return conversation;
  }

  const systemPrompt = `You are a friendly, encouraging AI coach helping a 2nd grade student (around 7-8 years old).

The student is working on this question:
"${questionText}"

${hints.length > 0 ? `Teacher's hints for this question: ${hints.join("; ")}` : ""}

Your role:
- Use the SOCRATIC METHOD - ask guiding questions, don't give answers
- Be warm, patient, and encouraging (use simple language for young children)
- Help them think through the problem step by step
- If they're stuck, break the problem into smaller pieces
- NEVER directly tell them the answer
- Keep responses short (1-3 sentences)
- Use encouraging phrases like "Great thinking!" or "You're on the right track!"

IMPORTANT - Stay on topic:
- ONLY discuss the current question and its subject matter
- If the student asks about unrelated topics (games, colors, personal questions, etc.), gently redirect them back to the question
- Say something like "That's fun to think about! But let's focus on our question - [redirect to topic]"
- Do NOT engage with off-topic conversations

The student will type 'done' when they're ready to answer the question.`;

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt }
  ];

  // Initial coach greeting
  const greeting = await getCoachResponse(client, messages, "The student just asked for help.");
  console.log(`\n🤖 Coach: ${greeting}`);
  await speak(greeting);
  console.log("\n   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("   💡 'v' for voice | 'done' to answer the question");
  console.log("   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  conversation.turns.push({ role: "coach", message: greeting });

  // Conversation loop
  let chatting = true;
  while (chatting) {
    const studentInput = await askLine(rl, "> ");

    if (isExitCommand(studentInput)) {
      chatting = false;
    } else if (studentInput.trim() === "") {
      // Empty input, just continue
      continue;
    } else {
      conversation.turns.push({ role: "student", message: studentInput });
      messages.push({ role: "user", content: studentInput });

      const response = await getCoachResponse(client, messages, studentInput);
      console.log(`\n🤖 Coach: ${response}\n`);
      await speak(response);
      console.log("   (Say 'done' when you're ready to answer the question)\n");
      conversation.turns.push({ role: "coach", message: response });
      messages.push({ role: "assistant", content: response });
    }
  }

  // Now ask the student to state their final answer
  const wrapUpMsg = "Great work thinking through that together! Now, tell me your answer to the question.";
  console.log(`\n🤖 Coach: ${wrapUpMsg}`);
  await speak(wrapUpMsg);
  console.log("   ('v' for voice)\n");
  conversation.turns.push({ role: "coach", message: wrapUpMsg });

  const finalAnswer = await askLine(rl, "> ");
  if (finalAnswer.trim()) {
    conversation.finalAnswer = finalAnswer.trim();
    conversation.turns.push({ role: "student", message: finalAnswer.trim() });

    const confirmMsg = "Nice job! I've got your answer.";
    console.log(`\n🤖 Coach: ${confirmMsg}\n`);
    await speak(confirmMsg);
    conversation.turns.push({ role: "coach", message: confirmMsg });
  }

  return conversation;
}

/**
 * Start a "more" conversation (deeper exploration after answering)
 * @param initialQuestion - Optional question the student already asked at the "more" prompt
 */
export async function startMoreConversation(
  rl: readline.Interface,
  questionText: string,
  studentAnswer: string,
  feedback: string,
  initialQuestion?: string
): Promise<CoachConversation> {
  const conversation: CoachConversation = {
    mode: "more",
    turns: []
  };

  const client = getClient();
  if (!client) {
    console.log("\n🤖 Coach: I'd love to explore more, but I'm not available right now.");
    console.log("   (Set OPENAI_API_KEY in .env for AI coach)\n");
    return conversation;
  }

  const systemPrompt = `You are a friendly, curious AI coach chatting with a 2nd grade student (around 7-8 years old).

The student just answered this question:
"${questionText}"

Their answer was: "${studentAnswer}"
Feedback they received: "${feedback}"

Your role now is EXPLORATION mode:
- Celebrate their effort and curiosity
- Share interesting facts related to the topic
- Answer their questions about the topic
- Make connections to things they might know
- Keep it fun and engaging for a young child
- Use simple language appropriate for 7-8 year olds
- Keep responses short (2-4 sentences)
- Encourage their curiosity!

IMPORTANT - Stay on topic:
- ONLY explore topics directly related to the question's subject matter
- If the student asks about unrelated topics (games, colors, personal questions, etc.), gently redirect them
- Say something like "That sounds fun! But let's keep exploring [the topic] - did you know that..."
- Do NOT engage with off-topic conversations
- Keep all facts and exploration connected to the educational content

The student will type 'done' when they're ready to move on.`;

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt }
  ];

  // Initial coach message - respond to initial question if provided
  if (initialQuestion) {
    // Student already asked a question, respond to it directly
    conversation.turns.push({ role: "student", message: initialQuestion });
    messages.push({ role: "user", content: initialQuestion });

    const response = await getCoachResponse(client, messages, initialQuestion);
    console.log(`\n🤖 Coach: ${response}`);
    await speak(response);
    console.log("\n   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("   💡 'v' for voice | 'done' to continue");
    console.log("   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    conversation.turns.push({ role: "coach", message: response });
    messages.push({ role: "assistant", content: response });
  } else {
    // No initial question, give a generic greeting
    const greeting = await getCoachResponse(client, messages, "The student wants to learn more about this topic.");
    console.log(`\n🤖 Coach: ${greeting}`);
    await speak(greeting);
    console.log("\n   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("   💡 'v' for voice | 'done' to continue");
    console.log("   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    conversation.turns.push({ role: "coach", message: greeting });
    messages.push({ role: "assistant", content: greeting });
  }

  // Conversation loop
  let chatting = true;
  while (chatting) {
    const studentInput = await askLine(rl, "> ");

    if (isExitCommand(studentInput)) {
      const exitMsg = "Great curiosity! Keep asking questions. Ready for the next challenge!";
      console.log(`\n🤖 Coach: ${exitMsg}\n`);
      await speak(exitMsg);
      chatting = false;
    } else if (studentInput.trim() === "") {
      // Empty input, just continue
      continue;
    } else {
      conversation.turns.push({ role: "student", message: studentInput });
      messages.push({ role: "user", content: studentInput });

      const response = await getCoachResponse(client, messages, studentInput);
      console.log(`\n🤖 Coach: ${response}\n`);
      await speak(response);
      console.log("   (Say 'done' when you're ready for the next question)\n");
      conversation.turns.push({ role: "coach", message: response });
      messages.push({ role: "assistant", content: response });
    }
  }

  return conversation;
}

/**
 * Get a response from the coach
 */
async function getCoachResponse(
  client: OpenAI,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  latestInput: string
): Promise<string> {
  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messages,
      temperature: 0.7,
      max_tokens: 150
    });

    return completion.choices[0]?.message?.content || "Hmm, let me think about that...";
  } catch (error) {
    console.error("Coach error:", error);
    return "I'm having trouble thinking right now. Try again or type 'done' to continue.";
  }
}

/**
 * Check if input is an exit command
 */
function isExitCommand(input: string): boolean {
  const exitCommands = ["done", "exit", "quit"];
  return exitCommands.includes(input.toLowerCase().trim());
}

/**
 * Get input with voice support
 * Type 'v' for voice, or type your message
 */
async function askLine(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const ask = () => {
      rl.question(prompt, async (answer) => {
        const lower = answer.toLowerCase().trim();
        if (lower === "v" || lower === "voice") {
          const voiceResult = await recordAndTranscribe(false); // Don't save audio for coach chat
          if (voiceResult) {
            resolve(voiceResult.text);
          } else {
            ask(); // Try again
          }
        } else {
          resolve(answer);
        }
      });
    };
    ask();
  });
}

export interface ElaborationResult {
  elaborations: string[];
  conversation: CoachConversation;
}

/**
 * Coach helps student elaborate on their answer with Socratic follow-up questions.
 * Returns the student's elaborations to be added to their full answer.
 */
export async function coachElaboration(
  rl: readline.Interface,
  questionText: string,
  studentAnswer: string,
  gradeLevel: string = "2nd grade"
): Promise<ElaborationResult | null> {
  const client = getClient();

  if (!client) {
    return null;
  }

  const conversation: CoachConversation = {
    mode: "help",
    turns: []
  };

  const elaborations: string[] = [];

  const systemPrompt = `You are a warm, encouraging coach helping a ${gradeLevel} student explain their thinking more fully.

The student just answered this question:
"${questionText}"

Their answer was: "${studentAnswer}"

Your job is to ask ONE simple follow-up question to help them share more of their thinking.

Rules:
- Ask simple questions appropriate for the student's grade level
- Be warm and encouraging ("Great start! Can you tell me more about...")
- Focus on getting them to explain WHY or HOW they know something
- Ask about specific details from the text or their experience
- Keep your question SHORT (1-2 sentences max)
- Do NOT give them the answer or tell them what to say
- Do NOT criticize their answer

Good follow-up questions:
- "I like that! What made you think of that?"
- "Great! Can you tell me more about how you figured that out?"
- "Nice thinking! What clues helped you know that?"
- "That's interesting! Why do you think that happened?"

After they respond, you may ask ONE more follow-up if helpful, then say "Great job sharing your thinking!" to end.`;

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt }
  ];

  // Get first follow-up question
  const firstQuestion = await getCoachResponse(client, messages, "Ask a follow-up question to help the student elaborate.");

  console.log(`\n🤖 Coach: ${firstQuestion}`);
  await speak(firstQuestion);
  console.log("   ('v' for voice, or type your answer)\n");

  conversation.turns.push({ role: "coach", message: firstQuestion });
  messages.push({ role: "assistant", content: firstQuestion });

  // Get student's first elaboration
  const response1 = await askLine(rl, "> ");

  if (response1.trim()) {
    elaborations.push(response1.trim());
    conversation.turns.push({ role: "student", message: response1.trim() });
    messages.push({ role: "user", content: response1.trim() });

    // Decide if we need a second follow-up or can wrap up
    const followUp = await getCoachResponse(
      client,
      messages,
      "Either ask ONE more brief follow-up question OR if they've shared enough, respond with just: Great job sharing your thinking!"
    );

    // Check if coach wants to wrap up or ask another question
    if (followUp.toLowerCase().includes("great job")) {
      console.log(`\n🤖 Coach: ${followUp}\n`);
      await speak(followUp);
      conversation.turns.push({ role: "coach", message: followUp });
    } else {
      // One more follow-up
      console.log(`\n🤖 Coach: ${followUp}`);
      await speak(followUp);
      console.log("   ('v' for voice, or type your answer)\n");
      conversation.turns.push({ role: "coach", message: followUp });

      const response2 = await askLine(rl, "> ");
      if (response2.trim()) {
        elaborations.push(response2.trim());
        conversation.turns.push({ role: "student", message: response2.trim() });
      }

      const closing = "Great job sharing your thinking!";
      console.log(`\n🤖 Coach: ${closing}\n`);
      await speak(closing);
      conversation.turns.push({ role: "coach", message: closing });
    }
  }

  return {
    elaborations,
    conversation
  };
}
