"use client";

import { useState, useCallback } from "react";
import { apiRequest, useAction, Modal } from "@/components/ui/client";
import { Button, Field, Textarea } from "@/components/ui/primitives";

interface EvidenceFile {
  id: string;
  entity_type: "VIOLATION" | "LEDGER" | "REPORT" | "SESSION";
  entity_id: string;
  file_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  checksum: string;
  uploaded_by: string;
  uploaded_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
}

/** Evidence upload button and modal for attaching files to governance entities */
export function EvidenceUploadButton({
  entityType,
  entityId,
  existingFiles = [],
  onUploadSuccess,
  label = "Attach evidence",
}: {
  entityType: "VIOLATION" | "LEDGER" | "REPORT" | "SESSION";
  entityId: string;
  existingFiles?: EvidenceFile[];
  onUploadSuccess?: () => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [checksum, setChecksum] = useState("");
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const { run, pending } = useAction();
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setError(null);
    setFile(selected);
    setComputing(true);
    // Compute SHA-256 checksum in background
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const arrayBuffer = ev.target?.result as ArrayBuffer;
      const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
      setChecksum(hashHex);
      setComputing(false);
    };
    reader.readAsArrayBuffer(selected);
  }, []);

  const handleUpload = async () => {
    if (!file) {
      setError("Select a file first");
      return;
    }
    if (!checksum) {
      setError("Checksum not ready");
      return;
    }

    // Build FormData for multipart upload
    const formData = new FormData();
    formData.append("file", file);
    formData.append("entityType", entityType);
    formData.append("entityId", entityId);
    // Also send metadata for validation and checksum verification
    const metadata = JSON.stringify({
      entityType,
      entityId,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      checksum,
    });
    formData.append("metadata", metadata);

    const ok = await run(
      async () => {
        // Use fetch directly for FormData
        const res = await fetch("/api/v1/evidence", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || "Upload failed");
        }
        return res.json();
      },
      {
        success: "Evidence file uploaded.",
      }
    );

    if (ok) {
      setFile(null);
      setChecksum("");
      setReason("");
      setOpen(false);
      onUploadSuccess?.();
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getMimeIcon = (mime: string) => {
    if (mime.startsWith("image/")) return "🖼️";
    if (mime === "application/pdf") return "📄";
    if (mime.includes("word") || mime.includes("document")) return "📝";
    if (mime.includes("excel") || mime.includes("spreadsheet")) return "📊";
    return "📎";
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {label}
      </Button>
      {existingFiles.length > 0 && (
        <div className="mt-2 space-y-1">
          {existingFiles.map((f) => (
            <div key={f.id} className="flex items-center gap-2 text-xs text-muted">
              <span>{getMimeIcon(f.mime_type)}</span>
              <span className="truncate max-w-xs">{f.file_name}</span>
              <span>{formatSize(f.size_bytes)}</span>
              <span className="font-mono text-[10px]">{f.checksum.slice(0, 16)}…</span>
            </div>
          ))}
        </div>
      )}
      <Modal
        open={open}
        onOpenChange={(o) => {
          if (!o) {
            setFile(null);
            setChecksum("");
            setError(null);
          }
        }}
        title={`Attach evidence to ${entityType}`}
        description="Upload a supporting document (PDF, image, Word, Excel, text). Maximum 50 MiB. The file is checksummed before upload."
      >
        <div className="space-y-3">
          <div>
            <label htmlFor="evidence-file" className="block text-sm font-medium">
              Select file
            </label>
            <input
              id="evidence-file"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.xls,.xlsx,.txt"
              onChange={handleFileSelect}
              disabled={pending || computing}
            />
            {computing && <p className="text-xs text-muted mt-1">Computing checksum…</p>}
            {file && !computing && (
              <p className="text-xs text-muted mt-1">
                {file.name} · {formatSize(file.size)} · {file.type}
              </p>
            )}
            {checksum && !computing && (
              <p className="text-xs text-muted font-mono">SHA-256: {checksum}</p>
            )}
          </div>
          <Field id="evidence-reason" label="Note (optional)">
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={2000}
              placeholder="Brief description of what this evidence shows"
            />
          </Field>
          {error ? <p role="alert" className="text-[var(--critical-fg)] text-sm">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="primary" disabled={pending || !file || computing} onClick={handleUpload}>
              {pending ? "Uploading…" : "Upload"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/** Display component for existing evidence files with download links */
export function EvidenceFileList({
  files,
}: {
  files: EvidenceFile[];
}) {
  if (files.length === 0) {
    return <p className="text-sm text-muted">No evidence files attached.</p>;
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getMimeIcon = (mime: string) => {
    if (mime.startsWith("image/")) return "🖼️";
    if (mime === "application/pdf") return "📄";
    if (mime.includes("word") || mime.includes("document")) return "📝";
    if (mime.includes("excel") || mime.includes("spreadsheet")) return "📊";
    return "📎";
  };

  const downloadUrl = (filePath: string) => `/api/v1/evidence/download?filePath=${encodeURIComponent(filePath)}`;

  return (
    <ul className="space-y-2">
      {files.map((f) => (
        <li key={f.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm bg-surface rounded-lg border border-line">
          <span className="text-lg">{getMimeIcon(f.mime_type)}</span>
          <div className="flex-1 min-w-0">
            <a
              href={downloadUrl(f.file_path)}
              className="font-medium truncate block hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              {f.file_name}
            </a>
            <p className="text-xs text-muted">
              {formatSize(f.size_bytes)} · {f.mime_type} · Uploaded{" "}
              {new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "short", timeZone: "Africa/Lagos" }).format(new Date(f.uploaded_at))}
            </p>
          </div>
          <span className="font-mono text-[10px] text-muted">{f.checksum.slice(0, 16)}…</span>
        </li>
      ))}
    </ul>
  );
}