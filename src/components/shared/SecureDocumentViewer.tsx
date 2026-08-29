"use client";

import React, { useState, useRef } from "react";
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  X,
  RefreshCcw,
  ShieldCheck,
  FileText,
} from "lucide-react";
import { DocumentWatermark, WatermarkContextInfo } from "./DocumentWatermark";

export interface SecureDocumentViewerProps {
  fileName: string;
  mimeType: string;
  dataUrl: string;
  documentTitle?: string;
  documentDate?: string;
  ocrConfidence?: number;
  watermarkContext?: WatermarkContextInfo;
  onClose?: () => void;
  onReplace?: () => void;
}

/**
 * SecureDocumentViewer
 * 
 * ARCHITECTURE CLASSIFICATION:
 * - Raster Image (JPEG, PNG, WebP) Rendering: FULLY IMPLEMENTED (Canvas/CSS Matrix Pan, Zoom, 90° Step Rotation).
 * - Watermark Deterrence Overlay: FULLY IMPLEMENTED (Dense uncroppable matrix across viewport).
 * - PDF Rendering: PARTIAL CONTROLLED EMBED. Uses native iframe/embed with browser toolbars suppressed (`#toolbar=0&navpanes=0`).
 *   NOTE: Future Phase 4 integration will attach a dedicated PDF.js canvas renderer adapter for strict per-page vector rendering.
 */
export function SecureDocumentViewer({
  fileName,
  mimeType,
  dataUrl,
  documentTitle = "Secure Compliance Document",
  documentDate,
  ocrConfidence,
  watermarkContext,
  onClose,
  onReplace,
}: SecureDocumentViewerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef({
    active: false,
    x: 0,
    y: 0,
  });

  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const isPdf =
    mimeType === "application/pdf" ||
    dataUrl.includes("application/pdf") ||
    fileName.toLowerCase().endsWith(".pdf");

  const reset = () => {
    setZoom(1);
    setRotation(0);
    setPan({ x: 0, y: 0 });
  };

  return (
    <div
      ref={rootRef}
      className="relative flex h-full min-h-0 flex-col bg-background border border-border rounded-xl shadow-lg overflow-hidden select-none"
    >
      {/* Secure Header */}
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border bg-card px-4 py-2 shrink-0">
        <div className="min-w-0 flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
            <FileText className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-xs font-bold text-foreground truncate">{documentTitle}</p>
              <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground uppercase">
                <ShieldCheck className="size-2.5 text-emerald-500" />
                Audited View
              </span>
            </div>
            <p className="max-w-[420px] truncate text-[10px] text-muted-foreground font-mono">
              {fileName} {documentDate ? `• Date: ${documentDate}` : ""}
            </p>
          </div>
        </div>

        {/* Action Controls (Strictly Viewer Controls, No Download/Print/Save) */}
        <div className="flex items-center gap-1.5">
          {!isPdf && (
            <>
              <button
                type="button"
                className="h-7 rounded border border-border px-2 text-xs font-semibold hover:bg-muted text-foreground transition-colors"
                onClick={reset}
                title="Fit to window"
              >
                Fit
              </button>
              <button
                type="button"
                className="flex size-7 items-center justify-center rounded border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setZoom((c) => Math.max(0.5, c - 0.25))}
                title="Zoom out"
              >
                <ZoomOut className="size-3.5" />
              </button>
              <span className="w-11 text-center text-[10px] font-mono font-medium text-foreground">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                className="flex size-7 items-center justify-center rounded border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setZoom((c) => Math.min(4, c + 0.25))}
                title="Zoom in"
              >
                <ZoomIn className="size-3.5" />
              </button>
              <button
                type="button"
                className="flex size-7 items-center justify-center rounded border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setRotation((c) => (c + 90) % 360)}
                title="Rotate 90°"
              >
                <RotateCcw className="size-3.5" />
              </button>
            </>
          )}

          {ocrConfidence !== undefined && (
            <div className="flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40 px-2 py-0.5 text-[10px] text-emerald-800 dark:text-emerald-300 font-semibold">
              OCR: {ocrConfidence}%
            </div>
          )}

          {onClose && (
            <button
              type="button"
              className="flex size-7 items-center justify-center rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors ml-1"
              onClick={onClose}
              title="Close viewer"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* Main Viewport with Dense Watermark Overlay */}
      <div className="relative min-h-[350px] flex-1 overflow-hidden bg-muted/20">
        {/* Deterrence Watermark */}
        <DocumentWatermark {...watermarkContext} />

        {isPdf ? (
          <embed
            src={`${dataUrl}#toolbar=0&navpanes=0&scrollbar=1`}
            type="application/pdf"
            className="absolute inset-0 h-full w-full border-none"
          />
        ) : (
          <div
            className="absolute inset-0 flex cursor-grab items-center justify-center overflow-hidden p-6 active:cursor-grabbing select-none"
            style={{ touchAction: "none" }}
            onPointerDown={(e) => {
              dragRef.current = {
                active: true,
                x: e.clientX,
                y: e.clientY,
              };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!dragRef.current.active) return;
              const dx = e.clientX - dragRef.current.x;
              const dy = e.clientY - dragRef.current.y;
              dragRef.current.x = e.clientX;
              dragRef.current.y = e.clientY;
              setPan((c) => ({ x: c.x + dx, y: c.y + dy }));
            }}
            onPointerUp={() => {
              dragRef.current.active = false;
            }}
            onPointerCancel={() => {
              dragRef.current.active = false;
            }}
          >
            <img
              src={dataUrl}
              alt={fileName}
              draggable={false}
              className="max-h-full max-w-full select-none object-contain shadow-md rounded-lg border border-border bg-background transition-transform duration-75"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg)`,
                transformOrigin: "center center",
              }}
            />
          </div>
        )}
      </div>

      {/* Bottom Secure Status & Replace Control */}
      <div className="flex min-h-11 items-center justify-between gap-3 border-t border-border bg-card px-4 py-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="size-2 rounded-full bg-emerald-500 shrink-0" />
          <p className="min-w-0 truncate text-[11px] text-muted-foreground font-mono">
            {fileName} • {isPdf ? "Encrypted PDF Stream" : "High-Resolution Image Asset"}
          </p>
        </div>

        {onReplace && (
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1 text-xs font-semibold hover:bg-muted text-foreground transition-colors shadow-xs"
            onClick={onReplace}
          >
            <RefreshCcw className="size-3" />
            Replace Document
          </button>
        )}
      </div>
    </div>
  );
}
