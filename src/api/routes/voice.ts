import { Router } from "express";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import os from "os";

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

// POST /api/voice/transcribe - Transcribe audio to text using Whisper
router.post("/transcribe", async (req, res) => {
  const client = getClient();
  if (!client) {
    return res.status(503).json({ error: "Voice features require OPENAI_API_KEY" });
  }

  try {
    // Expect base64 encoded audio in the request body
    const { audio, format = "webm" } = req.body;

    if (!audio) {
      return res.status(400).json({ error: "Audio data is required" });
    }

    // Decode base64 audio and save to temp file
    const audioBuffer = Buffer.from(audio, "base64");
    const tempFile = path.join(os.tmpdir(), `promptly-${Date.now()}.${format}`);
    fs.writeFileSync(tempFile, audioBuffer);

    try {
      const transcription = await client.audio.transcriptions.create({
        file: fs.createReadStream(tempFile),
        model: "whisper-1",
      });

      // Clean up temp file
      fs.unlinkSync(tempFile);

      res.json({ text: transcription.text.trim() });
    } catch (error) {
      // Clean up temp file on error
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      throw error;
    }
  } catch (error) {
    console.error("Transcription error:", error);
    res.status(500).json({ error: "Failed to transcribe audio" });
  }
});

// POST /api/voice/speak - Convert text to speech using OpenAI TTS
router.post("/speak", async (req, res) => {
  const client = getClient();
  if (!client) {
    return res.status(503).json({ error: "Voice features require OPENAI_API_KEY" });
  }

  try {
    const { text, voice = "nova" } = req.body;

    if (!text) {
      return res.status(400).json({ error: "Text is required" });
    }

    const response = await client.audio.speech.create({
      model: "tts-1",
      voice: voice as "nova" | "alloy" | "echo" | "fable" | "onyx" | "shimmer",
      input: text,
    });

    const buffer = Buffer.from(await response.arrayBuffer());

    // Return audio as base64
    res.json({
      audio: buffer.toString("base64"),
      format: "mp3",
    });
  } catch (error) {
    console.error("TTS error:", error);
    res.status(500).json({ error: "Failed to generate speech" });
  }
});

// GET /api/voice/status - Check if voice features are available
router.get("/status", (req, res) => {
  const available = !!process.env.OPENAI_API_KEY;
  res.json({ available });
});

export default router;
