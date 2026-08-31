"use client";

import React, { useState, useRef, useEffect, useMemo, useId } from "react";
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  X,
  RefreshCcw,
  ShieldCheck,
  FileText,
  Maximize2,
} from "lucide-react";
import { DocumentWatermark, WatermarkContextInfo } from "./DocumentWatermark";
import {
  recordDocumentViewEvent,
  generateViewRef,
} from "../../lib/audit-logger";

export interface SecureDocumentViewerProps {
  fileName: string;
  mimeType: string;
  dataUrl: string;
  documentTitle?: string;
  documentDate?: string;
  ocrConfidence?: number;
  companyName?: string;
  companyId?: string;
  viewerRole?: string;
  designation?: string;
  viewRef?: string;
  auditEventId?: string;
  watermarkContext?: WatermarkContextInfo;
  onClose?: () => void;
  onReplace?: () => void;
}

/**
 * SecureDocumentViewer
 * 
 * Shared Foundation Component for TES Compliance Portal.
 * 
 * Capabilities:
 * - Raster & Vector Images (JPEG, PNG, WebP) + PDF Documents with full control parity.
 * - Viewport Geometry Hardening: Contain-style Fit calculation across full responsive range.
 * - Symmetrical pan & zoom engine: No one-sided blank areas, full reachability at 225%+ zoom.
 * - Forensic Dual-Layer Watermarking:
 *     Layer A: High-contrast document overlay rotating, scaling, and panning with document.
 *     Layer B: Ambient viewport canvas overlay covering blank margins.
 * - Dynamic Eastern Time (America/New_York) with automatic EST/EDT indicators.
 * - Viewer Identity: "{Designation} — {Company Name}" (e.g. "Safety Director — ABC Transport Inc.").
 * - Audit Trail Traceability: Unique VIEW REF (e.g. VW-8F42C910) bound to VIEW_DOCUMENT audit event.
 */
export function SecureDocumentViewer({
  fileName,
  mimeType,
  dataUrl,
  documentTitle = "Secure Compliance Document",
  documentDate,
  ocrConfidence,
  companyName: propCompanyName,
  companyId: propCompanyId,
  viewerRole: propViewerRole,
  designation: propDesignation,
  viewRef: propViewRef,
  auditEventId,
  watermarkContext,
  onClose,
  onReplace,
}: SecureDocumentViewerProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const initialPanRef = useRef({ x: 0, y: 0 });
  const auditLoggedRef = useRef(false);

  // 1. Stable Unique View Reference (traceable to VIEW_DOCUMENT audit event)
  const [viewRef] = useState<string>(() => {
    if (propViewRef) return propViewRef;
    if (watermarkContext?.viewRef) return watermarkContext.viewRef;
    if (watermarkContext?.sessionRef?.startsWith("VW-")) return watermarkContext.sessionRef;
    return generateViewRef();
  });

  // 2. Viewport and Document Geometry State
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 600 });
  const [docSize, setDocSize] = useState({ width: 850, height: 1100 }); // Default Letter Portrait
  const [zoom, setZoom] = useState(1.0); // 1.0 = 100% of Fit containment
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const isPdf =
    mimeType === "application/pdf" ||
    dataUrl.includes("application/pdf") ||
    fileName.toLowerCase().endsWith(".pdf");

  // 3. Measure Viewport Size dynamically using ResizeObserver
  useEffect(() => {
    if (!viewportRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
          setViewportSize({
            width: entry.contentRect.width,
            height: entry.contentRect.height,
          });
        }
      }
    });

    observer.observe(viewportRef.current);
    return () => observer.disconnect();
  }, []);

  // 4. Traceable Audit Event Binding (Registers/links VIEW_DOCUMENT event on open)
  useEffect(() => {
    if (auditLoggedRef.current) return;
    auditLoggedRef.current = true;

    try {
      const resolvedCompanyId =
        propCompanyId ||
        watermarkContext?.companyId ||
        (typeof window !== "undefined"
          ? window.location.pathname.match(/\/companies\/([^/]+)/)?.[1]
          : undefined);

      const resolvedActor = (watermarkContext?.viewerName || "").trim();
      const resolvedRole = (
        propDesignation ||
        propViewerRole ||
        watermarkContext?.designation ||
        watermarkContext?.viewerRole ||
        ""
      ).trim();

      recordDocumentViewEvent({
        fileName,
        companyId: resolvedCompanyId,
        actor: resolvedActor,
        role: resolvedRole,
        details: `Forensic viewing session opened for "${fileName}" (Ref: ${viewRef})`,
        viewRef,
        entityId: auditEventId || "DOC-VIEW",
      });
    } catch (err) {
      console.warn("Could not log document view audit event:", err);
    }
  }, [fileName, propCompanyId, watermarkContext, propDesignation, propViewerRole, viewRef, auditEventId]);

  // 5. Containment Scale Calculation (Contain-style fit preserving aspect ratio & rotation)
  const fitScale = useMemo(() => {
    const isRotated90 = rotation === 90 || rotation === 270;
    const effectiveWidth = isRotated90 ? docSize.height : docSize.width;
    const effectiveHeight = isRotated90 ? docSize.width : docSize.height;

    const padding = 40; // 20px padding around document
    const availableW = Math.max(100, viewportSize.width - padding);
    const availableH = Math.max(100, viewportSize.height - padding);

    const scaleX = availableW / effectiveWidth;
    const scaleY = availableH / effectiveHeight;
    return Math.min(scaleX, scaleY);
  }, [viewportSize, docSize, rotation]);

  // Reset to Fit
  const handleResetFit = () => {
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
    setRotation(0);
  };

  // Zoom In / Out Handlers
  const handleZoomIn = () => setZoom((z) => Math.min(5.0, Math.round((z + 0.25) * 100) / 100));
  const handleZoomOut = () => setZoom((z) => Math.max(0.25, Math.round((z - 0.25) * 100) / 100));
  const handleRotate = () => setRotation((r) => ((r + 90) % 360) as 0 | 90 | 180 | 270);

  // Pointer Drag Handlers (Smooth pan in all directions)
  const handlePointerDown = (e: React.PointerEvent) => {
    // Only left click or touch
    if (e.button !== 0) return;
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    initialPanRef.current = { ...pan };
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPan({
      x: initialPanRef.current.x + dx,
      y: initialPanRef.current.y + dy,
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      setIsDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  // Wheel zoom handling
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      setZoom((z) => Math.min(5.0, Math.max(0.25, Math.round((z + delta) * 100) / 100)));
    }
  };

  // Combined Watermark Context
  const mergedWatermarkContext: WatermarkContextInfo = useMemo(() => {
    return {
      ...watermarkContext,
      companyName: propCompanyName || watermarkContext?.companyName,
      companyId: propCompanyId || watermarkContext?.companyId,
      viewerRole: propViewerRole || watermarkContext?.viewerRole,
      designation: propDesignation || watermarkContext?.designation,
      viewRef,
    };
  }, [watermarkContext, propCompanyName, propCompanyId, propViewerRole, propDesignation, viewRef]);

  const displayZoomPercentage = Math.round(zoom * 100);

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background border border-border rounded-xl shadow-2xl overflow-hidden select-none">
      {/* ------------------------------------------------------------- */}
      {/* 1. SECURE VIEWER HEADER                                       */}
      {/* ------------------------------------------------------------- */}
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border bg-card px-4 py-2 shrink-0 z-30">
        <div className="min-w-0 flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
            <FileText className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-xs font-bold text-foreground truncate">{documentTitle}</p>
              <span className="flex items-center gap-1 rounded bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">
                <ShieldCheck className="size-2.5" />
                Audited View
              </span>
            </div>
            <p className="max-w-[460px] truncate text-[10px] text-muted-foreground font-mono">
              {fileName} {documentDate ? `• Date: ${documentDate}` : ""} • Ref: {viewRef}
            </p>
          </div>
        </div>

        {/* Action Controls (Fit, Zoom, Rotate, OCR, Close) */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="flex items-center gap-1 h-7 rounded border border-border px-2.5 text-xs font-semibold hover:bg-muted text-foreground transition-colors active:scale-95"
            onClick={handleResetFit}
            title="Fit to window (Recalculate Scale)"
          >
            <Maximize2 className="size-3" />
            Fit
          </button>

          <button
            type="button"
            className="flex size-7 items-center justify-center rounded border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors active:scale-95"
            onClick={handleZoomOut}
            title="Zoom out (-25%)"
          >
            <ZoomOut className="size-3.5" />
          </button>

          <span
            className="w-12 text-center text-[10px] font-mono font-bold text-foreground tabular-nums cursor-pointer hover:underline"
            onClick={() => setZoom(1.0)}
            title="Click to reset to 100% Fit"
          >
            {displayZoomPercentage}%
          </span>

          <button
            type="button"
            className="flex size-7 items-center justify-center rounded border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors active:scale-95"
            onClick={handleZoomIn}
            title="Zoom in (+25%)"
          >
            <ZoomIn className="size-3.5" />
          </button>

          <button
            type="button"
            className="flex size-7 items-center justify-center rounded border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors active:scale-95"
            onClick={handleRotate}
            title="Rotate 90° Clockwise"
          >
            <RotateCcw className="size-3.5" />
          </button>

          {ocrConfidence !== undefined && (
            <div className="flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40 px-2 py-0.5 text-[10px] text-emerald-800 dark:text-emerald-300 font-bold">
              OCR: {Math.round(ocrConfidence)}%
            </div>
          )}

          {onClose && (
            <button
              type="button"
              className="flex size-7 items-center justify-center rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors ml-1"
              onClick={onClose}
              title="Close secure viewer"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* 2. MAIN SECURE VIEWPORT                                       */}
      {/* ------------------------------------------------------------- */}
      <div
        ref={viewportRef}
        className="relative min-h-[350px] flex-1 overflow-hidden bg-muted/30 select-none flex items-center justify-center"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          cursor: isDragging ? "grabbing" : "grab",
          touchAction: "none",
        }}
      >
        {/* Layer B: Ambient Viewer Canvas Watermark Overlay */}
        <DocumentWatermark {...mergedWatermarkContext} variant="canvas" />

        {/* Controlled Centered Document Stage (Transforms, Scales, Pans, and Rotates Symmetrically) */}
        <div
          className="relative flex items-center justify-center shadow-2xl rounded-lg bg-background border border-border overflow-hidden select-none transition-transform duration-75"
          style={{
            width: `${docSize.width}px`,
            height: `${docSize.height}px`,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${fitScale * zoom}) rotate(${rotation}deg)`,
            transformOrigin: "center center",
            boxShadow: "0 20px 45px -10px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(0, 0, 0, 0.1)",
          }}
        >
          {/* Document Content Rendering */}
          {isPdf ? (
            <div className="relative h-full w-full bg-white">
              <iframe
                src={`${dataUrl}#toolbar=0&navpanes=0&scrollbar=0`}
                title={fileName}
                className="h-full w-full border-none pointer-events-none"
              />
              {/* Transparent pointer capture plane ensuring drag/pan works seamlessly across PDF */}
              <div className="absolute inset-0 z-10" />
            </div>
          ) : (
            <img
              src={dataUrl}
              alt={fileName}
              draggable={false}
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                  setDocSize({
                    width: img.naturalWidth,
                    height: img.naturalHeight,
                  });
                }
              }}
              className="h-full w-full object-contain select-none pointer-events-none"
            />
          )}

          {/* Layer A: High-Contrast Forensic Document Watermark Overlay (Anchored to Document) */}
          <DocumentWatermark {...mergedWatermarkContext} variant="document" />
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* 3. BOTTOM SECURE STATUS & CONTROLS                            */}
      {/* ------------------------------------------------------------- */}
      <div className="flex min-h-11 items-center justify-between gap-3 border-t border-border bg-card px-4 py-2 shrink-0 z-30">
        <div className="flex items-center gap-2 min-w-0">
          <span className="size-2 rounded-full bg-emerald-500 shrink-0 animate-pulse" />
          <p className="min-w-0 truncate text-[11px] text-muted-foreground font-mono">
            {fileName} • {isPdf ? "Encrypted PDF Stream" : "High-Resolution Image Asset"} • Audited View Ref: <span className="font-bold text-foreground">{viewRef}</span>
          </p>
        </div>

        {onReplace && (
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1 text-xs font-semibold hover:bg-muted text-foreground transition-colors shadow-xs active:scale-95"
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
