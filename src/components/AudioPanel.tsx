"use client";

/**
 * components/AudioPanel.tsx
 * TASKS.md 4.8 — Audio upload widget.
 *
 * Accepts a .mp3 file upload, POSTs to /api/audio, displays the transcript,
 * and exposes an "Update Diagram" button that POSTs to /api/diagram/update.
 *
 * When Watson STT is not configured the route returns transcription_unavailable.
 * In that case the panel switches to a TEXT INPUT MODE — type or paste any
 * transcript text directly to test the diagram-update pipeline without audio.
 *
 * DESIGN.md §10: aria-labels on all interactive elements.
 * DESIGN.md §2: uses design token CSS vars throughout.
 */

import { useRef, useState } from "react";
import type { DiagramUpdateResult } from "@/backend/lib/mermaid/update";

interface AudioPanelProps {
  currentDiagram: string | null;
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

  // When STT is unavailable we fall back to a manual text textarea
  const [showTextInput, setShowTextInput] = useState(false);
  const [manualText, setManualText] = useState("");

  const [uploadLoading, setUploadLoading] = useState(false);
  const [updateLoading, setUpdateLoading] = useState(false);
  const [updateResult, setUpdateResult] = useState<DiagramUpdateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Upload handler ─────────────────────────────────────────────────────────

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setTranscript(null);
    setShowTextInput(false);
    setManualText("");
    setError(null);
    setUpdateResult(null);
    setUploadLoading(true);

    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch("/api/audio", { method: "POST", body: form });
      const data = (await res.json()) as AudioResponse;

      if (data.transcription_unavailable) {
        // STT not configured — offer the text input fallback
        setShowTextInput(true);
      } else {
        setTranscript(data.transcript);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // ── Text-inject handler (dev / no-STT path) ───────────────────────────────

  async function handleInjectText() {
    if (!manualText.trim()) return;
    setUploadLoading(true);
    setError(null);
    setUpdateResult(null);
    try {
      // POST JSON to the dev-shortcut endpoint
      const res = await fetch("/api/audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: manualText.trim() }),
      });
      const data = (await res.json()) as AudioResponse;
      setTranscript(data.transcript);
      setShowTextInput(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set transcript");
    } finally {
      setUploadLoading(false);
    }
  }

  // ── Diagram update handler ─────────────────────────────────────────────────

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

  // ── Shared styles ──────────────────────────────────────────────────────────

  const monoSm: React.CSSProperties = {
    fontFamily: "var(--font-geist-mono)",
    fontSize: "0.6875rem",
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".mp3,.wav,.ogg,audio/mpeg,audio/mp3,audio/wav,audio/ogg"
        onChange={handleFileChange}
        style={{ display: "none" }}
        aria-label="Select audio file for transcription"
      />

      {/* Upload button */}
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={uploadLoading}
        style={{
          fontFamily: "var(--font-geist-sans)",
          fontSize: "0.875rem",
          backgroundColor: uploadLoading ? "var(--col-rule)" : "var(--col-surface)",
          color: uploadLoading ? "var(--col-muted)" : "var(--col-ink)",
          border: "1px solid var(--col-rule)",
          borderRadius: "4px",
          padding: "8px 12px",
          cursor: uploadLoading ? "not-allowed" : "pointer",
          textAlign: "left",
          width: "100%",
        }}
        aria-label="Upload audio file for transcription"
        aria-busy={uploadLoading}
      >
        {uploadLoading ? "Processing…" : fileName ? `📎 ${fileName}` : "📎 Upload .mp3 / .wav"}
      </button>

      {/* ── Text-input fallback (STT unavailable) ──────────────────────────── */}
      {showTextInput && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            padding: "10px",
            backgroundColor: "var(--col-base)",
            border: "1px solid var(--col-chaos-strain)",
            borderRadius: "4px",
          }}
        >
          <p style={{ ...monoSm, color: "var(--col-chaos-strain)" }}>
            Watson STT not configured — paste transcript text to test diagram update:
          </p>
          <textarea
            rows={5}
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            placeholder="e.g. We need to add a rate limiter in front of the API gateway and connect the decision database to a data warehouse."
            style={{
              ...monoSm,
              backgroundColor: "var(--col-surface)",
              color: "var(--col-ink)",
              border: "1px solid var(--col-rule)",
              borderRadius: "4px",
              padding: "8px",
              resize: "vertical",
              width: "100%",
            }}
            aria-label="Manual transcript input"
          />
          <button
            onClick={handleInjectText}
            disabled={!manualText.trim() || uploadLoading}
            style={{
              ...monoSm,
              backgroundColor: !manualText.trim() ? "var(--col-rule)" : "var(--col-cobalt)",
              color: !manualText.trim() ? "var(--col-muted)" : "var(--col-ink)",
              border: "1px solid var(--col-rule)",
              borderRadius: "3px",
              padding: "5px 12px",
              cursor: !manualText.trim() ? "not-allowed" : "pointer",
              alignSelf: "flex-start",
            }}
            aria-label="Use this text as the transcript"
          >
            Use as transcript
          </button>
        </div>
      )}

      {/* ── Transcript preview ─────────────────────────────────────────────── */}
      {transcript !== null && transcript.length > 0 && (
        <div
          style={{
            ...monoSm,
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
          {/* Allow re-editing the transcript */}
          <button
            onClick={() => { setShowTextInput(true); setManualText(transcript); setTranscript(null); setUpdateResult(null); }}
            style={{ ...monoSm, background: "none", border: "none", color: "var(--col-cobalt)", cursor: "pointer", marginLeft: "8px" }}
            aria-label="Edit transcript"
          >
            edit
          </button>
        </div>
      )}

      {/* ── Update Diagram button ──────────────────────────────────────────── */}
      {transcript && (
        <button
          onClick={handleUpdateDiagram}
          disabled={!currentDiagram || updateLoading}
          style={{
            fontFamily: "var(--font-geist-sans)",
            fontSize: "0.875rem",
            backgroundColor: !currentDiagram || updateLoading ? "var(--col-rule)" : "var(--col-cobalt)",
            color: !currentDiagram || updateLoading ? "var(--col-muted)" : "var(--col-ink)",
            border: "1px solid var(--col-rule)",
            borderRadius: "4px",
            padding: "8px 12px",
            cursor: !currentDiagram || updateLoading ? "not-allowed" : "pointer",
            width: "100%",
            fontWeight: 500,
          }}
          aria-label="Update diagram from transcript"
          aria-busy={updateLoading}
        >
          {updateLoading ? "Updating…" : "⟳ Update Diagram"}
        </button>
      )}

      {/* ── Update result status ───────────────────────────────────────────── */}
      {updateResult && (
        <div
          role="status"
          style={{
            ...monoSm,
            color: updateResult.valid
              ? updateResult.noChanges ? "var(--col-muted)" : "var(--col-chaos-normal)"
              : "var(--col-chaos-failure)",
          }}
        >
          {updateResult.noChanges
            ? "No architectural changes detected."
            : updateResult.valid
            ? `✓ Diagram updated (${updateResult.patch.split("\n").filter(Boolean).length} new lines)`
            : `Patch invalid — diagram unchanged: ${updateResult.error ?? ""}`}
        </div>
      )}

      {/* ── Error ─────────────────────────────────────────────────────────── */}
      {error && (
        <p role="alert" style={{ ...monoSm, color: "var(--col-chaos-failure)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
