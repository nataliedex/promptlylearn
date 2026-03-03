/**
 * VideoRecorder Component
 *
 * A reusable component for recording video responses.
 * Uses browser-native MediaRecorder + getUserMedia APIs.
 *
 * Features:
 * - Start/stop recording with visual timer
 * - Video preview after recording
 * - Retake and submit functionality
 * - Automatic stop at max duration
 * - Permission and error handling
 */

import { useState, useRef, useEffect, useCallback } from "react";

export interface VideoRecorderProps {
  /** Maximum recording duration in seconds (default: 60) */
  maxDuration?: number;
  /** Called when video is submitted with the blob and duration */
  onSubmit: (videoBlob: Blob, durationSec: number) => void;
  /** Called when recording is cancelled */
  onCancel: () => void;
  /** Whether the component is in a submitting state */
  isSubmitting?: boolean;
  /** Error message to display */
  error?: string | null;
  /** Custom label for the cancel button (default: "Cancel") */
  cancelLabel?: string;
  /** Use compact PiP preview instead of full-width (default: false) */
  compactPreview?: boolean;
}

type RecordingState = "idle" | "requesting" | "ready" | "recording" | "preview";

export default function VideoRecorder({
  maxDuration = 60,
  onSubmit,
  onCancel,
  isSubmitting = false,
  error: externalError,
  cancelLabel = "Cancel",
  compactPreview = false,
}: VideoRecorderProps) {
  const [state, setState] = useState<RecordingState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedDuration, setRecordedDuration] = useState(0);
  const [hidePreview, setHidePreview] = useState(false);
  const [activeStream, setActiveStream] = useState<MediaStream | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  // Cleanup function
  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current = null;
    }
    chunksRef.current = [];
    setActiveStream(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  // Attach stream to video element when both exist
  // This is critical for compact mode where video element renders AFTER stream is obtained
  useEffect(() => {
    if (activeStream && videoRef.current && !hidePreview) {
      console.log("[VideoRecorder] Attaching stream to video element", {
        streamExists: !!activeStream,
        videoRefExists: !!videoRef.current,
        state,
        hidePreview,
      });
      videoRef.current.srcObject = activeStream;
      videoRef.current.muted = true;
      videoRef.current.play().catch((err) => {
        console.log("[VideoRecorder] Video play error (usually benign):", err);
      });
    }
  }, [activeStream, state, hidePreview]);

  // Request camera/mic permission and setup stream
  const requestPermission = async () => {
    setState("requesting");
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: true,
      });

      streamRef.current = stream;
      setActiveStream(stream);

      console.log("[VideoRecorder] Stream obtained", {
        streamExists: !!stream,
        videoRefExists: !!videoRef.current,
      });

      // For non-compact mode, video element exists during requesting state
      // so we can attach immediately
      if (videoRef.current) {
        console.log("[VideoRecorder] Attaching stream immediately (non-compact mode)");
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        await videoRef.current.play();
      }
      // For compact mode, the useEffect will handle attachment after state changes to "ready"

      setState("ready");
    } catch (err) {
      console.error("Failed to get media devices:", err);

      if (err instanceof DOMException) {
        if (err.name === "NotAllowedError") {
          setError("Camera and microphone permission denied. Please allow access to record video.");
        } else if (err.name === "NotFoundError") {
          setError("No camera or microphone found. Please connect a device and try again.");
        } else if (err.name === "NotReadableError") {
          setError("Camera or microphone is already in use by another application.");
        } else {
          setError(`Failed to access camera: ${err.message}`);
        }
      } else {
        setError("Failed to access camera and microphone. Please try again.");
      }

      setState("idle");
    }
  };

  // Start recording
  const startRecording = () => {
    if (!streamRef.current) return;

    setError(null);
    chunksRef.current = [];

    try {
      // Try to use webm with VP9/Opus, fallback to other codecs
      // Use full mimeType with codecs for MediaRecorder (better encoding)
      // Use base mimeType for blob (server validation expects simple types)
      const fullMimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
        ? "video/webm;codecs=vp8,opus"
        : MediaRecorder.isTypeSupported("video/webm")
        ? "video/webm"
        : "video/mp4";

      // Extract base type without codec info for the blob (e.g., "video/webm" from "video/webm;codecs=vp9,opus")
      const baseMimeType = fullMimeType.split(";")[0];
      console.log("[VideoRecorder] Using mimeType:", fullMimeType, "base:", baseMimeType);

      const mediaRecorder = new MediaRecorder(streamRef.current, {
        mimeType: fullMimeType,
        videoBitsPerSecond: 2500000, // 2.5 Mbps
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        // Calculate actual duration from ref (not state, which is stale in closure)
        const actualDuration = Math.max(1, Math.floor((Date.now() - startTimeRef.current) / 1000));
        console.log("[VideoRecorder] Recording stopped, duration:", actualDuration);

        // Use base mimeType (without codecs) so server accepts it
        const blob = new Blob(chunksRef.current, { type: baseMimeType });
        setRecordedBlob(blob);
        setRecordedDuration(actualDuration);
        setState("preview");

        // Stop the camera stream
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
        setActiveStream(null);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(1000); // Collect data every second

      startTimeRef.current = Date.now();
      setElapsedTime(0);

      // Start timer
      timerRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setElapsedTime(elapsed);

        // Auto-stop at max duration
        if (elapsed >= maxDuration) {
          stopRecording();
        }
      }, 100);

      setState("recording");
    } catch (err) {
      console.error("Failed to start recording:", err);
      setError("Failed to start recording. Please try again.");
    }
  };

  // Stop recording
  const stopRecording = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  };

  // Retake - go back to ready state
  const handleRetake = async () => {
    setRecordedBlob(null);
    setRecordedDuration(0);
    setElapsedTime(0);
    setError(null);

    // Re-request camera access
    await requestPermission();
  };

  // Submit the recorded video
  const handleSubmit = () => {
    if (recordedBlob && recordedDuration > 0) {
      onSubmit(recordedBlob, recordedDuration);
    }
  };

  // Cancel and cleanup
  const handleCancel = () => {
    cleanup();
    onCancel();
  };

  // Format time as MM:SS
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Calculate progress percentage
  const progressPercent = (elapsedTime / maxDuration) * 100;

  // Display error (external or internal)
  const displayError = externalError || error;

  // Compact PiP layout for conversational video mode
  if (compactPreview) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        padding: "20px",
        background: "#f8f9fa",
        borderRadius: "12px",
      }}>
        {/* Error display with fallback option */}
        {displayError && (
          <div style={{
            padding: "16px",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "8px",
            textAlign: "center",
          }}>
            <p style={{ margin: "0 0 12px 0", color: "#dc2626", fontSize: "0.9rem" }}>
              {displayError}
            </p>
            <button
              onClick={handleCancel}
              style={{
                padding: "10px 20px",
                fontSize: "0.9rem",
                fontWeight: 500,
                background: "white",
                color: "#374151",
                border: "1px solid #d1d5db",
                borderRadius: "8px",
                cursor: "pointer",
              }}
            >
              {cancelLabel}
            </button>
          </div>
        )}

        {/* Main recording interface */}
        {!displayError && (
          <>
            {/* State: Idle - prompt to start */}
            {state === "idle" && (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <div style={{
                  width: "64px",
                  height: "64px",
                  borderRadius: "50%",
                  background: "#3d5a80",
                  margin: "0 auto 16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                    <path d="M23 7l-7 5 7 5V7z" />
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                  </svg>
                </div>
                <p style={{ margin: "0 0 20px 0", color: "var(--text-secondary)", fontSize: "0.95rem" }}>
                  Ready to record your answer?
                </p>
                <button
                  onClick={requestPermission}
                  style={{
                    padding: "14px 32px",
                    fontSize: "1rem",
                    fontWeight: 600,
                    background: "#3d5a80",
                    color: "white",
                    border: "none",
                    borderRadius: "10px",
                    cursor: "pointer",
                  }}
                >
                  Start Camera
                </button>
                <p style={{ margin: "16px 0 0 0", fontSize: "0.8rem", color: "#9ca3af" }}>
                  Max {formatTime(maxDuration)} recording
                </p>
              </div>
            )}

            {/* State: Requesting permission */}
            {state === "requesting" && (
              <div style={{ textAlign: "center", padding: "32px 0" }}>
                <div className="loading-spinner" style={{ margin: "0 auto 16px" }}></div>
                <p style={{ margin: 0, color: "var(--text-secondary)" }}>Requesting camera permission...</p>
              </div>
            )}

            {/* State: Ready to record */}
            {state === "ready" && (
              <div style={{ position: "relative" }}>
                {/* Recording prompt */}
                <div style={{ textAlign: "center", marginBottom: "20px" }}>
                  <p style={{ margin: "0 0 8px 0", fontSize: "1rem", fontWeight: 600, color: "#333" }}>
                    Camera ready!
                  </p>
                  <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                    Click the button below when you're ready to record
                  </p>
                </div>

                {/* Small PiP self-view */}
                {!hidePreview && (
                  <div style={{
                    position: "relative",
                    width: "120px",
                    height: "120px",
                    borderRadius: "50%",
                    overflow: "hidden",
                    margin: "0 auto 16px",
                    border: "3px solid #3d5a80",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                  }}>
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        transform: "scaleX(-1)",
                      }}
                    />
                  </div>
                )}

                {/* Hide/show preview toggle */}
                <div style={{ textAlign: "center", marginBottom: "16px" }}>
                  <button
                    onClick={() => setHidePreview(!hidePreview)}
                    style={{
                      padding: "6px 12px",
                      fontSize: "0.75rem",
                      background: "transparent",
                      border: "none",
                      color: "#6b7280",
                      cursor: "pointer",
                      textDecoration: "underline",
                    }}
                  >
                    {hidePreview ? "Show camera preview" : "Hide camera preview"}
                  </button>
                </div>

                {/* Record button */}
                <div style={{ textAlign: "center" }}>
                  <button
                    onClick={startRecording}
                    style={{
                      padding: "16px 36px",
                      fontSize: "1rem",
                      fontWeight: 600,
                      background: "#dc2626",
                      color: "white",
                      border: "none",
                      borderRadius: "10px",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "10px",
                    }}
                  >
                    <span style={{
                      width: "14px",
                      height: "14px",
                      borderRadius: "50%",
                      background: "white",
                    }} />
                    Start Recording
                  </button>
                </div>
              </div>
            )}

            {/* State: Recording */}
            {state === "recording" && (
              <div style={{ position: "relative" }}>
                {/* Recording status */}
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "12px",
                  marginBottom: "16px",
                }}>
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "8px 16px",
                    background: "#dc2626",
                    borderRadius: "20px",
                    color: "white",
                    fontSize: "0.9rem",
                    fontWeight: 600,
                  }}>
                    <span style={{
                      width: "10px",
                      height: "10px",
                      borderRadius: "50%",
                      background: "white",
                      animation: "pulse 1s infinite",
                    }} />
                    Recording
                  </div>
                  <div style={{
                    padding: "8px 14px",
                    background: "#374151",
                    borderRadius: "8px",
                    color: "white",
                    fontSize: "0.9rem",
                    fontFamily: "monospace",
                  }}>
                    {formatTime(elapsedTime)} / {formatTime(maxDuration)}
                  </div>
                </div>

                {/* Progress bar */}
                <div style={{
                  height: "6px",
                  background: "#e5e7eb",
                  borderRadius: "3px",
                  marginBottom: "20px",
                  overflow: "hidden",
                }}>
                  <div style={{
                    height: "100%",
                    width: `${progressPercent}%`,
                    background: progressPercent > 80 ? "#ef4444" : "#3d5a80",
                    transition: "width 0.1s linear",
                  }} />
                </div>

                {/* Small PiP self-view during recording */}
                {!hidePreview && (
                  <div style={{
                    position: "relative",
                    width: "100px",
                    height: "100px",
                    borderRadius: "50%",
                    overflow: "hidden",
                    margin: "0 auto 16px",
                    border: "3px solid #dc2626",
                  }}>
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        transform: "scaleX(-1)",
                      }}
                    />
                  </div>
                )}

                {/* Hide preview toggle */}
                <div style={{ textAlign: "center", marginBottom: "16px" }}>
                  <button
                    onClick={() => setHidePreview(!hidePreview)}
                    style={{
                      padding: "6px 12px",
                      fontSize: "0.75rem",
                      background: "transparent",
                      border: "none",
                      color: "#6b7280",
                      cursor: "pointer",
                      textDecoration: "underline",
                    }}
                  >
                    {hidePreview ? "Show camera preview" : "Hide camera preview"}
                  </button>
                </div>

                {/* Stop button */}
                <div style={{ textAlign: "center" }}>
                  <button
                    onClick={stopRecording}
                    style={{
                      padding: "14px 32px",
                      fontSize: "1rem",
                      fontWeight: 600,
                      background: "#374151",
                      color: "white",
                      border: "none",
                      borderRadius: "10px",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "10px",
                    }}
                  >
                    <span style={{
                      width: "14px",
                      height: "14px",
                      background: "white",
                      borderRadius: "2px",
                    }} />
                    Stop Recording
                  </button>
                </div>
              </div>
            )}

            {/* State: Preview recorded video */}
            {state === "preview" && recordedBlob && (
              <div>
                <p style={{
                  margin: "0 0 12px 0",
                  fontSize: "0.95rem",
                  fontWeight: 600,
                  color: "#333",
                  textAlign: "center",
                }}>
                  Review your answer
                </p>

                {/* Video preview - larger for review but not full-screen */}
                <div style={{
                  position: "relative",
                  width: "100%",
                  maxWidth: "400px",
                  margin: "0 auto 12px",
                  borderRadius: "12px",
                  overflow: "hidden",
                  background: "#1f2937",
                }}>
                  <video
                    ref={previewVideoRef}
                    src={URL.createObjectURL(recordedBlob)}
                    controls
                    style={{
                      width: "100%",
                      display: "block",
                    }}
                  />
                </div>

                <p style={{
                  margin: "0 0 16px 0",
                  fontSize: "0.85rem",
                  color: "#6b7280",
                  textAlign: "center",
                }}>
                  Duration: {formatTime(recordedDuration)}
                </p>

                {/* Action buttons */}
                <div style={{
                  display: "flex",
                  gap: "12px",
                  justifyContent: "center",
                  flexWrap: "wrap",
                }}>
                  <button
                    onClick={handleRetake}
                    disabled={isSubmitting}
                    style={{
                      padding: "12px 24px",
                      fontSize: "0.9rem",
                      fontWeight: 500,
                      background: "white",
                      color: "#374151",
                      border: "1px solid #d1d5db",
                      borderRadius: "8px",
                      cursor: isSubmitting ? "not-allowed" : "pointer",
                      opacity: isSubmitting ? 0.5 : 1,
                    }}
                  >
                    Re-record
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={isSubmitting}
                    style={{
                      padding: "12px 28px",
                      fontSize: "0.9rem",
                      fontWeight: 600,
                      background: isSubmitting
                        ? "#9ca3af"
                        : "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                      color: "white",
                      border: "none",
                      borderRadius: "8px",
                      cursor: isSubmitting ? "not-allowed" : "pointer",
                    }}
                  >
                    {isSubmitting ? "Uploading..." : "Use this video"}
                  </button>
                </div>
              </div>
            )}

            {/* Switch to typing option - always available except during recording */}
            {state !== "recording" && state !== "preview" && (
              <div style={{ textAlign: "center", marginTop: "8px" }}>
                <button
                  onClick={handleCancel}
                  style={{
                    padding: "8px 16px",
                    fontSize: "0.85rem",
                    background: "transparent",
                    border: "1px solid #d1d5db",
                    borderRadius: "8px",
                    color: "#6b7280",
                    cursor: "pointer",
                  }}
                >
                  {cancelLabel}
                </button>
              </div>
            )}
          </>
        )}

        {/* CSS for pulse animation */}
        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
        `}</style>
      </div>
    );
  }

  // Original full-width layout (for type mode secondary option)
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      gap: "16px",
      padding: "16px",
      background: "var(--surface-elevated)",
      borderRadius: "12px",
      border: "1px solid var(--border-muted)",
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>
          Record Video Response
        </h3>
        <button
          onClick={handleCancel}
          disabled={isSubmitting}
          style={{
            padding: "4px 12px",
            fontSize: "0.85rem",
            background: "transparent",
            border: "1px solid #d1d5db",
            borderRadius: "6px",
            color: "#6b7280",
            cursor: isSubmitting ? "not-allowed" : "pointer",
          }}
        >
          {cancelLabel}
        </button>
      </div>

      {/* Error display */}
      {displayError && (
        <div style={{
          padding: "12px",
          background: "#fef2f2",
          border: "1px solid #fecaca",
          borderRadius: "8px",
          color: "#dc2626",
          fontSize: "0.85rem",
        }}>
          {displayError}
        </div>
      )}

      {/* Video container */}
      <div style={{
        position: "relative",
        width: "100%",
        aspectRatio: "16/9",
        background: "#1f2937",
        borderRadius: "8px",
        overflow: "hidden",
      }}>
        {/* Live preview video (during ready/recording) */}
        {(state === "ready" || state === "recording" || state === "requesting") && (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: "scaleX(-1)", // Mirror the preview
            }}
          />
        )}

        {/* Recorded video preview */}
        {state === "preview" && recordedBlob && (
          <video
            ref={previewVideoRef}
            src={URL.createObjectURL(recordedBlob)}
            controls
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
            }}
          />
        )}

        {/* Idle state placeholder */}
        {state === "idle" && (
          <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            color: "#9ca3af",
          }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 7l-7 5 7 5V7z" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
            <p style={{ marginTop: "12px", fontSize: "0.9rem" }}>Click "Start Camera" to begin</p>
          </div>
        )}

        {/* Requesting permission indicator */}
        {state === "requesting" && (
          <div style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.7)",
            color: "white",
          }}>
            <p>Requesting camera permission...</p>
          </div>
        )}

        {/* Recording indicator */}
        {state === "recording" && (
          <>
            {/* Recording dot */}
            <div style={{
              position: "absolute",
              top: "12px",
              left: "12px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "6px 12px",
              background: "rgba(220, 38, 38, 0.9)",
              borderRadius: "20px",
              color: "white",
              fontSize: "0.85rem",
              fontWeight: 600,
            }}>
              <span style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: "white",
                animation: "pulse 1s infinite",
              }} />
              REC
            </div>

            {/* Timer */}
            <div style={{
              position: "absolute",
              top: "12px",
              right: "12px",
              padding: "6px 12px",
              background: "rgba(0,0,0,0.7)",
              borderRadius: "8px",
              color: "white",
              fontSize: "0.9rem",
              fontFamily: "monospace",
            }}>
              {formatTime(elapsedTime)} / {formatTime(maxDuration)}
            </div>

            {/* Progress bar */}
            <div style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: "4px",
              background: "rgba(0,0,0,0.3)",
            }}>
              <div style={{
                height: "100%",
                width: `${progressPercent}%`,
                background: progressPercent > 80 ? "#ef4444" : "#3d5a80",
                transition: "width 0.1s linear",
              }} />
            </div>
          </>
        )}
      </div>

      {/* Duration info in preview mode */}
      {state === "preview" && recordedDuration > 0 && (
        <div style={{
          fontSize: "0.85rem",
          color: "#6b7280",
          textAlign: "center",
        }}>
          Duration: {formatTime(recordedDuration)}
        </div>
      )}

      {/* Control buttons */}
      <div style={{
        display: "flex",
        gap: "12px",
        justifyContent: "center",
      }}>
        {state === "idle" && (
          <button
            onClick={requestPermission}
            style={{
              padding: "12px 24px",
              fontSize: "0.9rem",
              fontWeight: 600,
              background: "#3d5a80",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            Start Camera
          </button>
        )}

        {state === "ready" && (
          <button
            onClick={startRecording}
            style={{
              padding: "12px 24px",
              fontSize: "0.9rem",
              fontWeight: 600,
              background: "#dc2626",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span style={{
              width: "12px",
              height: "12px",
              borderRadius: "50%",
              background: "white",
            }} />
            Start Recording
          </button>
        )}

        {state === "recording" && (
          <button
            onClick={stopRecording}
            style={{
              padding: "12px 24px",
              fontSize: "0.9rem",
              fontWeight: 600,
              background: "#374151",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span style={{
              width: "12px",
              height: "12px",
              background: "white",
            }} />
            Stop Recording
          </button>
        )}

        {state === "preview" && (
          <>
            <button
              onClick={handleRetake}
              disabled={isSubmitting}
              style={{
                padding: "12px 24px",
                fontSize: "0.9rem",
                fontWeight: 500,
                background: "white",
                color: "#374151",
                border: "1px solid #d1d5db",
                borderRadius: "8px",
                cursor: isSubmitting ? "not-allowed" : "pointer",
                opacity: isSubmitting ? 0.5 : 1,
              }}
            >
              Retake
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              style={{
                padding: "12px 24px",
                fontSize: "0.9rem",
                fontWeight: 600,
                background: isSubmitting
                  ? "#9ca3af"
                  : "#3d5a80",
                color: "white",
                border: "none",
                borderRadius: "8px",
                cursor: isSubmitting ? "not-allowed" : "pointer",
              }}
            >
              {isSubmitting ? "Uploading..." : "Submit Video"}
            </button>
          </>
        )}
      </div>

      {/* Max duration hint */}
      {(state === "ready" || state === "idle") && (
        <p style={{
          margin: 0,
          fontSize: "0.8rem",
          color: "#9ca3af",
          textAlign: "center",
        }}>
          Maximum recording time: {formatTime(maxDuration)}
        </p>
      )}

      {/* CSS for pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
