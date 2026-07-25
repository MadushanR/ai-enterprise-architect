"use client";

/**
 * components/AudioPanel.tsx
 * TASKS.md 4.8 — Audio upload widget.
 *
 * Accepts a .mp3 file upload, POSTs to /api/audio, displays the transcript,
 * and exposes an "Update Diagram" button that POSTs to /api/diagram/update.
 *
 * Props:
 *   currentDiagram  — the current Mermaid diagram string (for the update call)
 *   onDiagramUpdate — called with the new diagram string when update succeeds
 *
 * DESIGN.md §10: aria-labels on all interactive elements.
 * DESIGN.md §2: uses design token CSS vars throughout.
 */

import { useRef, useState } from "react";
import type { DiagramUpdateResult } from "@/backend/lib/mermaid/update";

interface AudioPanelProps {
  /** Current Mermaid diagram string — needed to pass to the update endpoint. */
  currentDiagram: string | null;
  /** Called with the new full diagram string when an update succeeds. */
  onDiagramUpdate?: (updatedDiagram: string) => void;
}

interface AudioResponse {
  transcript: string;
  transcription_unavailable?: boolean;
  reason?: string;
}

export default function AudioPanel({ currentDiagram, onDiagramUpdate }: AudioPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [transcriptionUnavailable, setTranscriptionUnavailable] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [updateLoading, setUpdateLoading] = useState(false);
  const [updateResult, setUpdateResult] = useState<DiagramUpdateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Handlers ───────────────────────────────────────────────────────────────

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setTranscript(null);
    setTranscriptionUnavailable(false);
    setError(null);
    setUpdateResult(null);
    setUploadLoading(true);

    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch("/api/audio", {
        method: "POST",
        body: form,
      });

      const data = (await res.json()) as AudioResponse;

      if (data.transcription_unavailable) {
        setTranscriptionUnavailable(true);
      } else {
        setTranscript(data.transcript);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadLoading(false);
      // Reset file input so the same file can be re-uploaded
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleUpdateDiagram() {
    if (!transcript || !currentDiagram) return;
    setUpdateLoading(true);
    setUpdateResult(null);
    setError(null);

    try {
      const res = await fetch("/api/diagram/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, currentDiagram }),
      });

      const result = (await res.json()) as DiagramUpdateResult;
      setUpdateResult(result);

      if (result.valid && !result.noChanges) {
        onDiagramUpdate?.(result.updatedDiagram);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setUpdateLoading(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>

      {/* File input — hidden; triggered by button */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".mp3,audio/mpeg,audio/mp3,audio/wav,audio/ogg"
        onChange={handleFileChange}
        style={{ display: "none" }}
        aria-label="Select audio file for transcription"
        id="audio-file-input"
      />

      {/* Upload button */}
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={uploadLoading}
        className="w-full py-2 text-sm font-medium"
        style={{
          fontFamily: "var(--font-geist-sans)",
          fontSize: "0.875rem",
          backgroundColor: uploadLoading ? "var(--col-rule)" : "var(--col-surface)",
          color: uploadLoading ? "var(--col-muted)" : "var(--col-ink)",
          border: "1px solid var(--col-rule)",
          borderRadius: "4px",
          cursor: uploadLoading ? "not-allowed" : "pointer",
          textAlign: "left",
          paddingLeft: "12px",
        }}
        aria-label="Upload audio file for transcription"
        aria-busy={uploadLoading}
      >
        {uploadLoading
          ? "Transcribing…"
          : fileName
          ? `📎 ${fileName}`
          : "📎 Upload .mp3"}
      </button>

      {/* Transcription unavailable notice */}
      {transcriptionUnavailable && (
        <div
          role="status"
          style={{
            fontFamily: "var(--font-geist-mono)",
            fontSize: "0.6875rem",
            padding: "8px 10px",
            backgroundColor: "rgba(201, 138, 26, 0.08)",
            border: "1px solid var(--col-chaos-strain)",
            borderRadius: "4px",
            color: "var(--col-chaos-strain)",
          }}
        >
          Transcription unavailable — set WATSON_STT_APIKEY + WATSON_STT_URL to enable.
        </div>
      )}

      {/* Transcript preview */}
      {transcript !== null && transcript.length > 0 && (
        <div
          style={{
            fontFamily: "var(--font-geist-mono)",
            fontSize: "0.6875rem",
            backgroundColor: "var(--col-base)",
            border: "1px solid var(--col-rule)",
            borderRadius: "4px",
            padding: "8px 10px",
            color: "var(--col-ink)",
            maxHeight: "100px",
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
          aria-label="Transcription result"
        >
          {transcript}
        </div>
      )}

      {/* Update Diagram button — enabled only when transcript + diagram are present */}
      {transcript && (
        <button
          onClick={handleUpdateDiagram}
          disabled={!currentDiagram || updateLoading}
          className="w-full py-2 text-sm font-medium"
          style={{
            fontFamily: "var(--font-geist-sans)",
            fontSize: "0.875rem",
            backgroundColor:
              !currentDiagram || updateLoading
                ? "var(--col-rule)"
                : "var(--col-cobalt)",
            color:
              !currentDiagram || updateLoading ? "var(--col-muted)" : "var(--col-ink)",
            border: "1px solid var(--col-rule)",
            borderRadius: "4px",
            cursor: !currentDiagram || updateLoading ? "not-allowed" : "pointer",
          }}
          aria-label="Update diagram from transcript"
          aria-busy={updateLoading}
        >
          {updateLoading ? "Updating…" : "⟳ Update Diagram"}
        </button>
      )}

      {/* Update result status */}
      {updateResult && (
        <div
          role="status"
          style={{
            fontFamily: "var(--font-geist-mono)",
            fontSize: "0.6875rem",
            color: updateResult.valid
              ? updateResult.noChanges
                ? "var(--col-muted)"
                : "var(--col-chaos-normal)"
              : "var(--col-chaos-failure)",
          }}
        >
          {updateResult.noChanges
            ? "No architectural changes detected in transcript."
            : updateResult.valid
            ? `✓ Diagram updated (${updateResult.patch.split("\n").filter(Boolean).length} new lines)`
            : `Patch invalid — diagram unchanged: ${updateResult.error ?? ""}`}
        </div>
      )}

      {/* Error */}
      {error && (
        <p
          role="alert"
          style={{
            fontFamily: "var(--font-geist-mono)",
            fontSize: "0.6875rem",
            color: "var(--col-chaos-failure)",
          }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
