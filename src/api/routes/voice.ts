import { Router } from "express";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import os from "os";
import { Readable } from "stream";

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

// Voice mode configuration
export type CoachVoiceMode = "default_coach_voice" | "teacher_voice";

export interface VoiceSettings {
  coachVoiceMode: CoachVoiceMode;
  teacherVoiceId?: string; // ElevenLabs voice ID
  teacherVoiceName?: string; // Display name
  consentGiven?: boolean;
  consentDate?: string;
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
  console.log("[TTS] Request received, text length:", req.body?.text?.length);

  const client = getClient();
  if (!client) {
    console.log("[TTS] OPENAI_API_KEY not configured");
    return res.status(503).json({ error: "Voice features require OPENAI_API_KEY" });
  }

  try {
    const { text, voice = "nova" } = req.body;

    if (!text) {
      console.log("[TTS] No text provided");
      return res.status(400).json({ error: "Text is required" });
    }

    console.log("[TTS] Calling OpenAI TTS API...");

    const response = await client.audio.speech.create({
      model: "tts-1",
      voice: voice as "nova" | "alloy" | "echo" | "fable" | "onyx" | "shimmer",
      input: text,
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    console.log("[TTS] OpenAI TTS completed, audio size:", buffer.length, "bytes");

    // Return audio as base64
    res.json({
      audio: buffer.toString("base64"),
      format: "mp3",
    });
  } catch (error) {
    console.error("[TTS] Error:", error);
    res.status(500).json({ error: "Failed to generate speech" });
  }
});

// POST /api/voice/speak/stream - Streaming TTS for reduced latency
// Returns raw PCM audio (24kHz, 16-bit, mono) for Web Audio API streaming playback
router.post("/speak/stream", async (req, res) => {
  const requestStart = Date.now();
  console.log(`[TTS-Stream] Request received at ${requestStart}, text length: ${req.body?.text?.length}`);

  const client = getClient();
  if (!client) {
    console.log("[TTS-Stream] OPENAI_API_KEY not configured");
    return res.status(503).json({ error: "Voice features require OPENAI_API_KEY" });
  }

  try {
    const { text, voice = "nova" } = req.body;

    if (!text) {
      console.log("[TTS-Stream] No text provided");
      return res.status(400).json({ error: "Text is required" });
    }

    console.log(`[TTS-Stream] Calling OpenAI TTS API with PCM format...`);
    const apiCallStart = Date.now();

    // Request PCM format for true streaming - 24kHz, 16-bit, mono, little-endian
    const response = await client.audio.speech.create({
      model: "tts-1",
      voice: voice as "nova" | "alloy" | "echo" | "fable" | "onyx" | "shimmer",
      input: text,
      response_format: "pcm",
    });

    const apiCallEnd = Date.now();
    console.log(`[TTS-Stream] OpenAI API responded in ${apiCallEnd - apiCallStart}ms`);

    // Convert the Response body to a Node.js Readable stream
    const webStream = response.body as unknown as ReadableStream<Uint8Array>;
    const nodeStream = Readable.fromWeb(webStream as any);

    let firstChunkSent = false;
    let totalBytes = 0;

    // Handle first chunk specially to set X-Time-To-First-Chunk-Ms header before any data
    nodeStream.once("data", (firstChunk: Buffer) => {
      const timeToFirstChunk = Date.now() - requestStart;
      console.log(`[TTS-Stream] Time-to-first-chunk: ${timeToFirstChunk}ms`);

      // Set all headers BEFORE writing any data
      res.setHeader("Content-Type", "audio/pcm");
      res.setHeader("Transfer-Encoding", "chunked");
      res.setHeader("X-TTS-Api-Time-Ms", String(apiCallEnd - apiCallStart));
      res.setHeader("X-Time-To-First-Chunk-Ms", String(timeToFirstChunk));
      res.setHeader("X-Audio-Sample-Rate", "24000");
      res.setHeader("X-Audio-Channels", "1");
      res.setHeader("X-Audio-Bit-Depth", "16");
      res.setHeader("Access-Control-Expose-Headers", "X-TTS-Api-Time-Ms, X-Time-To-First-Chunk-Ms, X-Audio-Sample-Rate, X-Audio-Channels, X-Audio-Bit-Depth");

      // Write the first chunk
      res.write(firstChunk);
      totalBytes += firstChunk.length;
      firstChunkSent = true;

      // Pipe remaining data directly to response
      nodeStream.on("data", (chunk: Buffer) => {
        totalBytes += chunk.length;
        res.write(chunk);
      });

      nodeStream.on("end", () => {
        const totalTime = Date.now() - requestStart;
        console.log(`[TTS-Stream] Complete: ${totalBytes} bytes in ${totalTime}ms`);
        res.end();
      });
    });

    nodeStream.on("error", (err) => {
      console.error("[TTS-Stream] Stream error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Stream failed" });
      } else {
        res.end();
      }
    });
  } catch (error) {
    console.error("[TTS-Stream] Error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate speech" });
    }
  }
});

// GET /api/voice/status - Check if voice features are available
router.get("/status", (req, res) => {
  const available = !!process.env.OPENAI_API_KEY;
  res.json({ available });
});

// GET /api/voice/settings - Get current voice settings
router.get("/settings", (req, res) => {
  // For now, return default settings
  // TODO: Load from persistent store when educator settings are implemented
  const settings: VoiceSettings = {
    coachVoiceMode: "default_coach_voice",
  };
  res.json(settings);
});

// POST /api/voice/settings - Update voice settings (educator only)
router.post("/settings", async (req, res) => {
  try {
    const { coachVoiceMode, teacherVoiceId, teacherVoiceName, consentGiven } = req.body;

    // Validate coachVoiceMode
    if (coachVoiceMode && !["default_coach_voice", "teacher_voice"].includes(coachVoiceMode)) {
      return res.status(400).json({ error: "Invalid coachVoiceMode" });
    }

    // If switching to teacher_voice, require consent
    if (coachVoiceMode === "teacher_voice" && !consentGiven) {
      return res.status(400).json({ error: "Consent required for teacher voice mode" });
    }

    const settings: VoiceSettings = {
      coachVoiceMode: coachVoiceMode || "default_coach_voice",
      teacherVoiceId,
      teacherVoiceName,
      consentGiven,
      consentDate: consentGiven ? new Date().toISOString() : undefined,
    };

    // TODO: Persist settings when educator settings store is implemented
    console.log("[Voice] Settings updated:", settings);

    res.json(settings);
  } catch (error) {
    console.error("[Voice] Settings update error:", error);
    res.status(500).json({ error: "Failed to update voice settings" });
  }
});

export default router;
