import { Router } from "express";
import OpenAI from "openai";
import { getAllLessons } from "../../loaders/lessonLoader";
import { Prompt } from "../../domain/prompt";

const router = Router();

let openaiClient: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
}

interface ConversationMessage {
  role: "student" | "coach";
  message: string;
}

interface CoachRequest {
  lessonId: string;
  promptId: string;
  studentAnswer: string;
  gradeLevel?: string;
  conversationHistory?: ConversationMessage[];
}

interface CoachResponse {
  feedback: string;
  score: number;
  isCorrect: boolean;
  followUpQuestion?: string;
  encouragement: string;
  shouldContinue: boolean;
}

// POST /api/coach/feedback - Get initial feedback and follow-up question
router.post("/feedback", async (req, res) => {
  try {
    const { lessonId, promptId, studentAnswer, gradeLevel = "2nd grade" } = req.body as CoachRequest;

    if (!lessonId || !promptId || !studentAnswer) {
      return res.status(400).json({
        error: "lessonId, promptId, and studentAnswer are required",
      });
    }

    const client = getClient();
    if (!client) {
      return res.json({
        feedback: "Great effort! Keep thinking about this.",
        score: 50,
        isCorrect: true,
        encouragement: "Nice work!",
        shouldContinue: false,
      });
    }

    // Find the lesson and prompt
    const lessons = getAllLessons();
    const lesson = lessons.find((l) => l.id === lessonId);
    if (!lesson) {
      return res.status(404).json({ error: "Lesson not found" });
    }

    const prompt = lesson.prompts.find((p) => p.id === promptId);
    if (!prompt) {
      return res.status(404).json({ error: "Prompt not found" });
    }

    const response = await generateCoachFeedback(
      client,
      prompt,
      studentAnswer,
      gradeLevel,
      lesson.title
    );

    res.json(response);
  } catch (error) {
    console.error("Error generating coach feedback:", error);
    res.status(500).json({ error: "Failed to generate feedback" });
  }
});

// POST /api/coach/continue - Continue the conversation
router.post("/continue", async (req, res) => {
  try {
    const {
      lessonId,
      promptId,
      studentAnswer,
      gradeLevel = "2nd grade",
      conversationHistory = [],
    } = req.body as CoachRequest & { studentResponse: string };

    const { studentResponse } = req.body;

    if (!lessonId || !promptId || !studentResponse) {
      return res.status(400).json({
        error: "lessonId, promptId, and studentResponse are required",
      });
    }

    const client = getClient();
    if (!client) {
      return res.json({
        feedback: "Great thinking!",
        shouldContinue: false,
      });
    }

    // Find the lesson and prompt
    const lessons = getAllLessons();
    const lesson = lessons.find((l) => l.id === lessonId);
    if (!lesson) {
      return res.status(404).json({ error: "Lesson not found" });
    }

    const prompt = lesson.prompts.find((p) => p.id === promptId);
    if (!prompt) {
      return res.status(404).json({ error: "Prompt not found" });
    }

    const response = await continueConversation(
      client,
      prompt,
      studentAnswer,
      studentResponse,
      conversationHistory,
      gradeLevel
    );

    res.json(response);
  } catch (error) {
    console.error("Error continuing conversation:", error);
    res.status(500).json({ error: "Failed to continue conversation" });
  }
});

async function generateCoachFeedback(
  client: OpenAI,
  prompt: Prompt,
  studentAnswer: string,
  gradeLevel: string,
  lessonTitle: string
): Promise<CoachResponse> {
  const systemPrompt = `You are a warm, encouraging learning coach helping a ${gradeLevel} student.

The student is working on a lesson called "${lessonTitle}".

Question: "${prompt.input}"
${prompt.hints?.length ? `Hints available: ${prompt.hints.join("; ")}` : ""}

Your task:
1. Evaluate if the student's answer demonstrates understanding (score 0-100)
2. Provide warm, conversational feedback
3. Based on their performance, ask a follow-up question:
   - If they did WELL (score >= 70): Ask a PROBING question that goes deeper or connects to broader concepts
   - If they struggled (score < 70): Ask a SCAFFOLDING question that breaks down the concept or approaches it from a simpler angle

Rules:
- Use simple, age-appropriate language for ${gradeLevel}
- Be encouraging and positive, even when correcting
- Keep responses short (2-3 sentences for feedback)
- Follow-up questions should be 1 sentence
- Never be discouraging or negative

Respond in JSON format:
{
  "score": <number 0-100>,
  "isCorrect": <boolean - true if score >= 70>,
  "feedback": "<warm feedback about their answer>",
  "followUpQuestion": "<your follow-up question based on their performance>",
  "encouragement": "<short encouraging phrase like 'Great thinking!' or 'You're getting there!'>",
  "shouldContinue": true
}`;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Student's answer: "${studentAnswer}"` },
      ],
      temperature: 0.7,
      max_tokens: 300,
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from AI");
    }

    return JSON.parse(content);
  } catch (error) {
    console.error("AI feedback error:", error);
    return {
      feedback: "That's a thoughtful answer! Let me ask you something to help you think more about this.",
      score: 50,
      isCorrect: true,
      followUpQuestion: "Can you tell me more about why you think that?",
      encouragement: "Keep going!",
      shouldContinue: true,
    };
  }
}

async function continueConversation(
  client: OpenAI,
  prompt: Prompt,
  originalAnswer: string,
  studentResponse: string,
  history: ConversationMessage[],
  gradeLevel: string
): Promise<{ feedback: string; followUpQuestion?: string; shouldContinue: boolean; encouragement: string }> {
  // Determine conversation depth - after 2-3 exchanges, wrap up
  const turnCount = history.filter((h) => h.role === "student").length;
  const shouldWrapUp = turnCount >= 2;

  const historyText = history
    .map((h) => `${h.role === "coach" ? "Coach" : "Student"}: ${h.message}`)
    .join("\n");

  const systemPrompt = `You are a warm, encouraging learning coach helping a ${gradeLevel} student.

Original question: "${prompt.input}"
Student's original answer: "${originalAnswer}"

Conversation so far:
${historyText}

${shouldWrapUp ? "This is the last exchange - wrap up positively." : "Continue the conversation with one more follow-up."}

Your task:
- Respond to what the student just said
- ${shouldWrapUp ? "Give a warm closing that celebrates their learning" : "Ask ONE more brief follow-up question to deepen understanding"}
- Keep it conversational and age-appropriate

Respond in JSON format:
{
  "feedback": "<your response to what they said>",
  ${shouldWrapUp ? "" : '"followUpQuestion": "<one more question if continuing>",'}
  "encouragement": "<short encouraging phrase>",
  "shouldContinue": ${!shouldWrapUp}
}`;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Student says: "${studentResponse}"` },
      ],
      temperature: 0.7,
      max_tokens: 200,
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from AI");
    }

    return JSON.parse(content);
  } catch (error) {
    console.error("AI conversation error:", error);
    return {
      feedback: "Great thinking! You're really exploring this topic well.",
      encouragement: "Wonderful work!",
      shouldContinue: false,
    };
  }
}

// ============================================
// Freeform Coach Chat (Ask Coach feature)
// ============================================

interface ChatRequest {
  studentName: string;
  topics: string[]; // Lesson titles selected by student
  message: string;
  conversationHistory?: ConversationMessage[];
  gradeLevel?: string;
}

interface ChatResponse {
  response: string;
  shouldContinue: boolean;
}

// POST /api/coach/chat - Freeform coach conversation
router.post("/chat", async (req, res) => {
  try {
    const {
      studentName,
      topics,
      message,
      conversationHistory = [],
      gradeLevel = "2nd grade",
    } = req.body as ChatRequest;

    if (!studentName || !message) {
      return res.status(400).json({
        error: "studentName and message are required",
      });
    }

    const client = getClient();
    if (!client) {
      return res.json({
        response: "That's a great question! Keep thinking about it and exploring your ideas.",
        shouldContinue: true,
      });
    }

    // Get context from selected topics (lessons)
    let topicsContext = "";
    if (topics && topics.length > 0) {
      const lessons = getAllLessons();
      const selectedLessons = lessons.filter((l) => topics.includes(l.title));
      if (selectedLessons.length > 0) {
        topicsContext = selectedLessons
          .map((l) => {
            const questions = l.prompts.map((p) => p.input).join("\n  - ");
            return `Lesson: "${l.title}"\n  Questions covered:\n  - ${questions}`;
          })
          .join("\n\n");
      }
    }

    const response = await generateChatResponse(
      client,
      studentName,
      message,
      conversationHistory,
      topicsContext,
      gradeLevel
    );

    res.json(response);
  } catch (error) {
    console.error("Error in coach chat:", error);
    res.status(500).json({ error: "Failed to get coach response" });
  }
});

async function generateChatResponse(
  client: OpenAI,
  studentName: string,
  message: string,
  history: ConversationMessage[],
  topicsContext: string,
  gradeLevel: string
): Promise<ChatResponse> {
  const turnCount = history.filter((h) => h.role === "student").length;
  const shouldWrapUp = turnCount >= 5; // Allow more turns for freeform chat

  const historyText = history
    .map((h) => `${h.role === "coach" ? "Coach" : "Student"}: ${h.message}`)
    .join("\n");

  const systemPrompt = `You are a warm, encouraging learning coach having a friendly conversation with ${studentName}, a ${gradeLevel} student.

${topicsContext ? `The student is learning about these topics:\n${topicsContext}\n` : "The student wants to have a general learning conversation."}

${historyText ? `Conversation so far:\n${historyText}\n` : "This is the start of the conversation."}

Your role:
- Be warm, friendly, and conversational - like a favorite teacher or tutor
- ANSWER their questions directly and helpfully first
- After answering, you may ask a brief follow-up question to keep the conversation going
- Use simple, age-appropriate language for ${gradeLevel}
- Keep responses to 2-4 sentences
- ${shouldWrapUp ? "This conversation is getting long - give a final helpful answer and wrap up warmly." : "Keep the conversation flowing naturally."}

Response structure:
1. Acknowledge what they said or asked
2. Give a clear, helpful answer to their question
3. Optionally add a follow-up question OR an interesting related fact

Rules:
- Always be encouraging and positive
- Give real answers - don't just deflect with questions
- Make learning feel fun and exciting
- If they share something, respond warmly before moving on

Respond in JSON format:
{
  "response": "<your conversational response>",
  "shouldContinue": ${!shouldWrapUp}
}`;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `${studentName} says: "${message}"` },
      ],
      temperature: 0.8,
      max_tokens: 350,
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from AI");
    }

    return JSON.parse(content);
  } catch (error) {
    console.error("AI chat error:", error);
    return {
      response: "That's really interesting! Tell me more about what you're thinking.",
      shouldContinue: true,
    };
  }
}

export default router;
