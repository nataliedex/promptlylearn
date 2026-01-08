import readline from "readline";
import OpenAI from "openai";

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

export interface CoachConversation {
  mode: "help" | "more";
  turns: { role: "student" | "coach"; message: string }[];
}

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

The student will type 'done' when they're ready to answer the question.`;

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt }
  ];

  // Initial coach greeting
  const greeting = await getCoachResponse(client, messages, "The student just asked for help.");
  console.log(`\n🤖 Coach: ${greeting}`);
  console.log("   (Type your question, or 'done' to answer)\n");
  conversation.turns.push({ role: "coach", message: greeting });

  // Conversation loop
  let chatting = true;
  while (chatting) {
    const studentInput = await askLine(rl, "> ");

    if (studentInput.toLowerCase() === "done") {
      console.log("\nOk! Ready for your answer.\n");
      chatting = false;
    } else {
      conversation.turns.push({ role: "student", message: studentInput });
      messages.push({ role: "user", content: studentInput });

      const response = await getCoachResponse(client, messages, studentInput);
      console.log(`\n🤖 Coach: ${response}\n`);
      conversation.turns.push({ role: "coach", message: response });
      messages.push({ role: "assistant", content: response });
    }
  }

  return conversation;
}

/**
 * Start a "more" conversation (deeper exploration after answering)
 */
export async function startMoreConversation(
  rl: readline.Interface,
  questionText: string,
  studentAnswer: string,
  feedback: string
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

The student will type 'done' when they're ready to move on.`;

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt }
  ];

  // Initial coach message
  const greeting = await getCoachResponse(client, messages, "The student wants to learn more about this topic.");
  console.log(`\n🤖 Coach: ${greeting}`);
  console.log("   (Ask questions to explore, or 'done' to continue)\n");
  conversation.turns.push({ role: "coach", message: greeting });

  // Conversation loop
  let chatting = true;
  while (chatting) {
    const studentInput = await askLine(rl, "> ");

    if (studentInput.toLowerCase() === "done") {
      console.log("\n🤖 Coach: Great curiosity! Keep asking questions. Ready for the next challenge!\n");
      chatting = false;
    } else {
      conversation.turns.push({ role: "student", message: studentInput });
      messages.push({ role: "user", content: studentInput });

      const response = await getCoachResponse(client, messages, studentInput);
      console.log(`\n🤖 Coach: ${response}\n`);
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
 * Simple line input helper
 */
function askLine(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}
