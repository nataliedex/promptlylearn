declare module "node-record-lpcm16" {
  import { Readable } from "stream";

  interface RecordOptions {
    sampleRate?: number;
    channels?: number;
    audioType?: string;
    recorder?: string;
    silence?: string;
    threshold?: number;
    thresholdStart?: number;
    thresholdEnd?: number;
    endOnSilence?: boolean;
    verbose?: boolean;
  }

  interface Recording {
    stream(): Readable;
    stop(): void;
    pause(): void;
    resume(): void;
  }

  export function record(options?: RecordOptions): Recording;
}
