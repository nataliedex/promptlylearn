import readline from "readline";
import fs from "fs";
import path from "path";
import os from "os";
import OpenAI from "openai";

// Dynamic import for node-record-lpcm16 (CommonJS module)
let record: any;

async function getRecorder() {
  if (!record) {
    record = await import("node-record-lpcm16");
  }
  return record;
}

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

/**
 * Get text input - either typed or via voice
 * Type 'v' for voice, or just type your response
 */
export async function getInput(
  rl: readline.Interface,
  prompt: string,
  allowEmpty: boolean = false
): Promise<{ text: string; source: "typed" | "voice" } | null> {
  return new Promise((resolve) => {
    const ask = () => {
      rl.question(prompt, async (answer) => {
        const trimmed = answer.trim();
        const lower = trimmed.toLowerCase();

        if (lower === "v" || lower === "voice") {
          const voiceText = await recordAndTranscribe();
          if (voiceText) {
            resolve({ text: voiceText, source: "voice" });
          } else {
            ask(); // Try again
          }
        } else if (trimmed === "" && !allowEmpty) {
          ask(); // Ask again if empty not allowed
        } else {
          resolve({ text: trimmed, source: "typed" });
        }
      });
    };
    ask();
  });
}

/**
 * Speak text using OpenAI TTS
 */
export async function speak(text: string): Promise<void> {
  const client = getClient();
  if (!client) {
    return; // Silently skip if no API key
  }

  const tempFile = path.join(os.tmpdir(), `promptly-speech-${Date.now()}.mp3`);

  try {
    const response = await client.audio.speech.create({
      model: "tts-1",
      voice: "nova", // Friendly voice good for kids
      input: text
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(tempFile, buffer);

    // Play audio using afplay (macOS) or play (sox)
    const { execSync } = await import("child_process");
    try {
      execSync(`afplay "${tempFile}"`, { stdio: "ignore" });
    } catch {
      // Try sox play as fallback
      try {
        execSync(`play "${tempFile}"`, { stdio: "ignore" });
      } catch {
        // Silently fail if neither works
      }
    }

    // Clean up
    fs.unlinkSync(tempFile);
  } catch (error) {
    // Silently fail - text is still shown
  }
}

/**
 * Record audio and transcribe with Whisper
 * Starts immediately and stops automatically when silence is detected
 */
export async function recordAndTranscribe(): Promise<string | null> {
  const client = getClient();
  if (!client) {
    console.log("\n(Voice input requires OPENAI_API_KEY)");
    return null;
  }

  const recorder = await getRecorder();
  const tempFile = path.join(os.tmpdir(), `promptly-${Date.now()}.wav`);

  console.log("\n🎤 Listening... (speak now, stops when you pause)");

  return new Promise((resolve) => {
    const fileStream = fs.createWriteStream(tempFile, { encoding: "binary" });

    const recording = recorder.record({
      sampleRate: 16000,
      channels: 1,
      audioType: "wav",
      recorder: "sox",
      endOnSilence: true,
      silence: "2.0",  // Stop after 2 seconds of silence
      thresholdStart: 0.5,  // Start threshold
      thresholdEnd: 0.5  // End threshold
    });

    recording.stream().pipe(fileStream);

    recording.stream().on("end", async () => {
      fileStream.end();
      console.log("⏳ Transcribing...");

      try {
        // Small delay to ensure file is fully written
        await new Promise((r) => setTimeout(r, 200));

        // Check if file has content
        const stats = fs.statSync(tempFile);
        if (stats.size < 1000) {
          console.log("No speech detected. Please try again.\n");
          fs.unlinkSync(tempFile);
          resolve(null);
          return;
        }

        const transcription = await client.audio.transcriptions.create({
          file: fs.createReadStream(tempFile),
          model: "whisper-1"
        });

        // Clean up temp file
        fs.unlinkSync(tempFile);

        const text = transcription.text.trim();
        if (text) {
          console.log(`\n💬 You said: "${text}"\n`);
          resolve(text);
        } else {
          console.log("Couldn't understand. Please try again.\n");
          resolve(null);
        }
      } catch (error) {
        console.error("Transcription error:", error);
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
        resolve(null);
      }
    });

    recording.stream().on("error", (err: Error) => {
      console.error("Recording error:", err);
      resolve(null);
    });
  });
}
