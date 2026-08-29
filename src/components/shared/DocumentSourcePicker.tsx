"use client";

import React, { useRef, useState } from "react";
import { Camera, Upload, X, FileText, AlertCircle } from "lucide-react";

export interface DocumentSourcePickerProps {
  title?: string;
  subtitle?: string;
  isOpen: boolean;
  onClose: () => void;
  onSelectCamera: () => void;
  onSelectFile: (file: File) => void;
  allowedExtensions?: string[];
  maxSizeMB?: number;
}

export function DocumentSourcePicker({
  title = "Ingest Compliance Document",
  subtitle = "Choose document source for live OCR extraction and secure evidence attachment.",
  isOpen,
  onClose,
  onSelectCamera,
  onSelectFile,
  allowedExtensions = [".pdf", ".jpg", ".jpeg", ".png"],
  maxSizeMB = 25,
}: DocumentSourcePickerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const validateAndPass = (file: File) => {
    setError(null);
    const sizeInMB = file.size / (1024 * 1024);
    if (sizeInMB > maxSizeMB) {
      setError(`File size exceeds maximum limit of ${maxSizeMB}MB.`);
      return;
    }

    const ext = `.${file.name.split(".").pop()?.toLowerCase()}`;
    if (!allowedExtensions.includes(ext) && file.type !== "application/pdf" && !file.type.startsWith("image/")) {
      setError(`Unsupported file type (${ext}). Allowed: ${allowedExtensions.join(", ")}`);
      return;
    }

    onSelectFile(file);
    onClose();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndPass(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h3 className="text-base font-bold text-foreground">{title}</h3>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            <AlertCircle className="size-4 shrink-0 text-red-500" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Camera Source Option */}
          <button
            type="button"
            onClick={() => {
              onClose();
              onSelectCamera();
            }}
            className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-background p-6 text-center hover:border-primary hover:bg-primary/5 transition-all group"
          >
            <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary group-hover:scale-110 transition-transform">
              <Camera className="size-6" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground">Live Camera</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Capture using device camera with auto-alignment
              </p>
            </div>
          </button>

          {/* Upload / Drag & Drop Source Option */}
          <div
            onDragEnter={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragActive(false);
            }}
            onDragOver={(e) => {
              e.preventDefault();
            }}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition-all ${
              dragActive
                ? "border-primary bg-primary/10 scale-[1.02]"
                : "border-border bg-background hover:border-primary/50 hover:bg-muted/30"
            }`}
          >
            <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Upload className="size-6" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground">Upload File</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Drag & drop or browse PDF / JPEG / PNG
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  validateAndPass(e.target.files[0]);
                }
              }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-2 border-t border-border">
          <span className="flex items-center gap-1">
            <FileText className="size-3" />
            Max file size: {maxSizeMB}MB
          </span>
          <span>Encrypted Vault Storage</span>
        </div>
      </div>
    </div>
  );
}
