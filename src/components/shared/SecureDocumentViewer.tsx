"use client";

import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
} from "react";
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  X,
  RefreshCcw,
  ShieldCheck,
  FileText,
  Maximize2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from "pdfjs-dist/types/src/display/api";

import { DocumentWatermark, WatermarkContextInfo } from "./DocumentWatermark";
import {
  recordDocumentViewEvent,
  generateViewRef,
} from "@/lib/audit-logger";

/*
 * PDF.js worker configuration
 *
 * The worker is resolved from the installed pdfjs-dist package and bundled
 * by the Next.js application rather than relying on a browser/CDN viewer.
 */
if (typeof window !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
}

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
 * PDF rendering is controlled entirely by TES through PDF.js canvas
 * rendering. No iframe, embed, object, browser PDF viewer, browser
 * toolbar, or browser PDF permissions UI is used.
 *
 * Raster-image rendering remains unchanged.
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const initialPanRef = useRef({ x: 0, y: 0 });

  const auditLoggedRef = useRef(false);
  const renderGenerationRef = useRef(0);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const pdfDocumentRef = useRef<PDFDocumentProxy | null>(null);
  const pdfLoadingTaskRef = useRef<ReturnType<typeof pdfjsLib.getDocument> | null>(
    null,
  );

  const [viewRef] = useState<string>(() => {
    if (propViewRef) return propViewRef;
    if (watermarkContext?.viewRef) return watermarkContext.viewRef;
    if (watermarkContext?.sessionRef?.startsWith("VW-")) {
      return watermarkContext.sessionRef;
    }

    return generateViewRef();
  });

  const [viewportSize, setViewportSize] = useState({
    width: 800,
    height: 600,
  });

  /*
   * Intrinsic document/page dimensions.
   *
   * IMPORTANT:
   * There is intentionally no Letter-size fallback here.
   * PDF.js supplies the actual dimensions of the selected PDF page.
   */
  const [docSize, setDocSize] = useState({
    width: 1,
    height: 1,
  });

  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(
    null,
  );
  const [pdfPage, setPdfPage] = useState<PDFPageProxy | null>(null);
  const [pdfPageNumber, setPdfPageNumber] = useState(1);
  const [pdfPageCount, setPdfPageCount] = useState(0);

  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfRenderError, setPdfRenderError] = useState<string | null>(null);

  const isPdf =
    mimeType === "application/pdf" ||
    dataUrl.includes("application/pdf") ||
    fileName.toLowerCase().endsWith(".pdf");

  /*
   * -------------------------------------------------------------
   * VIEWPORT MEASUREMENT
   * -------------------------------------------------------------
   */

  useEffect(() => {
    if (!viewportRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;

        if (width > 0 && height > 0) {
          setViewportSize({
            width,
            height,
          });
        }
      }
    });

    observer.observe(viewportRef.current);

    return () => observer.disconnect();
  }, []);

  /*
   * -------------------------------------------------------------
   * AUDIT EVENT
   * -------------------------------------------------------------
   */

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
  }, [
    fileName,
    propCompanyId,
    watermarkContext,
    propDesignation,
    propViewerRole,
    viewRef,
    auditEventId,
  ]);

  /*
   * -------------------------------------------------------------
   * PDF LOAD / CLEANUP
   * -------------------------------------------------------------
   */

  useEffect(() => {
    if (!isPdf) return;

    let cancelled = false;
    const generation = ++renderGenerationRef.current;

    setPdfLoading(true);
    setPdfError(null);
    setPdfRenderError(null);
    setPdfDocument(null);
    setPdfPage(null);
    setPdfPageNumber(1);
    setPdfPageCount(0);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
    setDocSize({ width: 1, height: 1 });

    const previousRender = renderTaskRef.current;

    if (previousRender) {
      try {
        previousRender.cancel();
      } catch {}
    }

    renderTaskRef.current = null;

    const previousDocument = pdfDocumentRef.current;

    if (previousDocument) {
      void previousDocument.destroy().catch(() => {});
      pdfDocumentRef.current = null;
    }

    const previousLoadingTask = pdfLoadingTaskRef.current;

    if (previousLoadingTask) {
      try {
        void previousLoadingTask.destroy();
      } catch {}
      pdfLoadingTaskRef.current = null;
    }

    let loadingTask: ReturnType<typeof pdfjsLib.getDocument>;

    try {
      loadingTask = pdfjsLib.getDocument({
        url: dataUrl,
      });

      pdfLoadingTaskRef.current = loadingTask;
    } catch (error) {
      if (!cancelled && generation === renderGenerationRef.current) {
        setPdfLoading(false);
        setPdfError(
          error instanceof Error
            ? error.message
            : "Unable to initialize PDF rendering.",
        );
      }

      return () => {
        cancelled = true;
      };
    }

    void loadingTask.promise
      .then(async (document) => {
        if (cancelled || generation !== renderGenerationRef.current) {
          await document.destroy().catch(() => {});
          return;
        }

        pdfDocumentRef.current = document;

        setPdfDocument(document);
        setPdfPageCount(document.numPages);
        setPdfPageNumber(1);

        const firstPage = await document.getPage(1);

        if (cancelled || generation !== renderGenerationRef.current) {
          return;
        }

        setPdfPage(firstPage);
        setPdfLoading(false);
      })
      .catch((error) => {
        if (cancelled || generation !== renderGenerationRef.current) {
          return;
        }

        setPdfLoading(false);
        setPdfError(
          error instanceof Error
            ? error.message
            : "Unable to load the PDF document.",
        );
      });

    return () => {
      cancelled = true;

      if (generation === renderGenerationRef.current) {
        renderGenerationRef.current += 1;
      }

      const renderTask = renderTaskRef.current;

      if (renderTask) {
        try {
          renderTask.cancel();
        } catch {}
      }

      renderTaskRef.current = null;

      const document = pdfDocumentRef.current;

      if (document) {
        void document.destroy().catch(() => {});
      }

      pdfDocumentRef.current = null;

      const task = pdfLoadingTaskRef.current;

      if (task) {
        try {
          void task.destroy();
        } catch {}
      }

      pdfLoadingTaskRef.current = null;
    };
  }, [dataUrl, isPdf]);

  /*
   * -------------------------------------------------------------
   * PDF PAGE SELECTION
   * -------------------------------------------------------------
   */

  useEffect(() => {
    if (!isPdf || !pdfDocument) return;

    let cancelled = false;
    const generation = renderGenerationRef.current;

    setPdfLoading(true);
    setPdfError(null);
    setPdfRenderError(null);
    setPan({ x: 0, y: 0 });

    void pdfDocument
      .getPage(pdfPageNumber)
      .then((page) => {
        if (cancelled || generation !== renderGenerationRef.current) {
          return;
        }

        setPdfPage(page);
        setZoom(1);
        setPan({ x: 0, y: 0 });
        setRotation(0);
        setPdfLoading(false);
      })
      .catch((error) => {
        if (cancelled || generation !== renderGenerationRef.current) {
          return;
        }

        setPdfLoading(false);
        setPdfError(
          error instanceof Error
            ? error.message
            : "Unable to load the selected PDF page.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [pdfDocument, pdfPageNumber, isPdf]);

  /*
   * -------------------------------------------------------------
   * PDF PAGE INTRINSIC DIMENSIONS
   * -------------------------------------------------------------
   */

  useEffect(() => {
    if (!isPdf || !pdfPage) return;

    const viewport = pdfPage.getViewport({
      scale: 1,
      rotation: 0,
    });

    setDocSize({
      width: Math.max(1, viewport.width),
      height: Math.max(1, viewport.height),
    });

    setPan({ x: 0, y: 0 });
    setZoom(1);
  }, [pdfPage, isPdf]);

  /*
   * -------------------------------------------------------------
   * RASTER IMAGE DIMENSIONS
   *
   * Existing image behavior is intentionally preserved.
   * -------------------------------------------------------------
   */

  const handleImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      if (isPdf) return;

      const img = e.currentTarget;

      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setDocSize({
          width: img.naturalWidth,
          height: img.naturalHeight,
        });

        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
    },
    [isPdf],
  );

  /*
   * -------------------------------------------------------------
   * FIT SCALE
   * -------------------------------------------------------------
   */

  const fitScale = useMemo(() => {
    const rotated90 = rotation === 90 || rotation === 270;

    const effectiveWidth = rotated90 ? docSize.height : docSize.width;
    const effectiveHeight = rotated90 ? docSize.width : docSize.height;

    if (
      effectiveWidth <= 0 ||
      effectiveHeight <= 0 ||
      viewportSize.width <= 0 ||
      viewportSize.height <= 0
    ) {
      return 1;
    }

    const padding = 40;

    const availableWidth = Math.max(
      100,
      viewportSize.width - padding,
    );

    const availableHeight = Math.max(
      100,
      viewportSize.height - padding,
    );

    return Math.min(
      availableWidth / effectiveWidth,
      availableHeight / effectiveHeight,
    );
  }, [viewportSize, docSize, rotation]);

  /*
   * -------------------------------------------------------------
   * PAN BOUNDS
   *
   * Bounds are calculated from the actual rendered page dimensions
   * after Fit/Zoom/Rotation.
   * -------------------------------------------------------------
   */

  const panBounds = useMemo(() => {
    const rotated90 = rotation === 90 || rotation === 270;

    const effectiveWidth = rotated90 ? docSize.height : docSize.width;
    const effectiveHeight = rotated90 ? docSize.width : docSize.height;

    const renderedWidth = effectiveWidth * fitScale * zoom;
    const renderedHeight = effectiveHeight * fitScale * zoom;

    return {
      x: Math.max(0, (renderedWidth - viewportSize.width) / 2),
      y: Math.max(0, (renderedHeight - viewportSize.height) / 2),
    };
  }, [
    docSize,
    fitScale,
    zoom,
    rotation,
    viewportSize,
  ]);

  const clampPan = useCallback(
    (nextPan: { x: number; y: number }) => ({
      x: Math.min(
        panBounds.x,
        Math.max(-panBounds.x, nextPan.x),
      ),
      y: Math.min(
        panBounds.y,
        Math.max(-panBounds.y, nextPan.y),
      ),
    }),
    [panBounds],
  );

  useEffect(() => {
    setPan((current) => clampPan(current));
  }, [clampPan]);

  /*
   * -------------------------------------------------------------
   * PDF CANVAS RENDERING
   * -------------------------------------------------------------
   */

  useEffect(() => {
    if (!isPdf || !pdfPage || !canvasRef.current) return;

    let cancelled = false;
    const generation = renderGenerationRef.current;

    const canvas = canvasRef.current;
    const context = canvas.getContext("2d", {
      alpha: false,
    });

    if (!context) {
      setPdfRenderError("TES could not initialize the PDF canvas.");
      return;
    }

    const devicePixelRatio =
      typeof window !== "undefined"
        ? Math.min(window.devicePixelRatio || 1, 2)
        : 1;

    const baseViewport = pdfPage.getViewport({
      scale: 1,
      rotation: 0,
    });

    const renderViewport = pdfPage.getViewport({
      scale: devicePixelRatio,
      rotation: 0,
    });

    canvas.width = Math.ceil(renderViewport.width);
    canvas.height = Math.ceil(renderViewport.height);

    canvas.style.width = `${baseViewport.width}px`;
    canvas.style.height = `${baseViewport.height}px`;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(
      0,
      0,
      canvas.width,
      canvas.height,
    );

    setPdfRenderError(null);

    const previousTask = renderTaskRef.current;

    if (previousTask) {
      try {
        previousTask.cancel();
      } catch {}
    }

    const renderTask = pdfPage.render({
      canvasContext: context,
      viewport: renderViewport,
    });

    renderTaskRef.current = renderTask;

    void renderTask.promise
      .then(() => {
        if (
          cancelled ||
          generation !== renderGenerationRef.current ||
          renderTaskRef.current !== renderTask
        ) {
          return;
        }

        renderTaskRef.current = null;
      })
      .catch((error: unknown) => {
        if (
          cancelled ||
          generation !== renderGenerationRef.current
        ) {
          return;
        }

        /*
         * PDF.js throws RenderingCancelledException when an older
         * render is intentionally cancelled. That is expected and
         * must not surface as a user-facing error.
         */
        if (
          error &&
          typeof error === "object" &&
          "name" in error &&
          (error as { name?: string }).name ===
            "RenderingCancelledException"
        ) {
          return;
        }

        if (renderTaskRef.current === renderTask) {
          renderTaskRef.current = null;
        }

        setPdfRenderError(
          error instanceof Error
            ? error.message
            : "Unable to render the selected PDF page.",
        );
      });

    return () => {
      cancelled = true;

      try {
        renderTask.cancel();
      } catch {}

      if (renderTaskRef.current === renderTask) {
        renderTaskRef.current = null;
      }
    };
  }, [isPdf, pdfPage]);

  /*
   * -------------------------------------------------------------
   * CONTROLS
   * -------------------------------------------------------------
   */

  const handleResetFit = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
  };

  const handleZoomIn = () => {
    setZoom((current) =>
      Math.min(
        5,
        Math.round((current + 0.25) * 100) / 100,
      ),
    );
  };

  const handleZoomOut = () => {
    setZoom((current) =>
      Math.max(
        0.25,
        Math.round((current - 0.25) * 100) / 100,
      ),
    );
  };

  const handleRotate = () => {
    setRotation((current) => {
      const next =
        (current + 90) % 360;

      return next as 0 | 90 | 180 | 270;
    });

    setPan({ x: 0, y: 0 });
  };

  /*
   * -------------------------------------------------------------
   * PAGE NAVIGATION
   * -------------------------------------------------------------
   */

  const handlePreviousPage = () => {
    if (!isPdf || pdfPageNumber <= 1) return;

    setPdfPageNumber((current) =>
      Math.max(1, current - 1),
    );
  };

  const handleNextPage = () => {
    if (
      !isPdf ||
      pdfPageNumber >= pdfPageCount
    ) {
      return;
    }

    setPdfPageNumber((current) =>
      Math.min(pdfPageCount, current + 1),
    );
  };

  /*
   * -------------------------------------------------------------
   * POINTER PAN
   * -------------------------------------------------------------
   */

  const handlePointerDown = (
    e: React.PointerEvent,
  ) => {
    if (e.button !== 0) return;

    isDraggingRef.current = true;

    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
    };

    initialPanRef.current = {
      ...pan,
    };

    setIsDragging(true);

    e.currentTarget.setPointerCapture(
      e.pointerId,
    );
  };

  const handlePointerMove = (
    e: React.PointerEvent,
  ) => {
    if (!isDraggingRef.current) return;

    const dx =
      e.clientX -
      dragStartRef.current.x;

    const dy =
      e.clientY -
      dragStartRef.current.y;

    setPan(
      clampPan({
        x: initialPanRef.current.x + dx,
        y: initialPanRef.current.y + dy,
      }),
    );
  };

  const handlePointerUp = (
    e: React.PointerEvent,
  ) => {
    if (!isDraggingRef.current) return;

    isDraggingRef.current = false;
    setIsDragging(false);

    try {
      e.currentTarget.releasePointerCapture(
        e.pointerId,
      );
    } catch {}
  };

  /*
   * -------------------------------------------------------------
   * WHEEL ZOOM
   * -------------------------------------------------------------
   */

  const handleWheel = (
    e: React.WheelEvent,
  ) => {
    if (!(e.ctrlKey || e.metaKey)) return;

    e.preventDefault();

    const delta =
      e.deltaY < 0 ? 0.15 : -0.15;

    setZoom((current) =>
      Math.min(
        5,
        Math.max(
          0.25,
          Math.round(
            (current + delta) * 100,
          ) / 100,
        ),
      ),
    );
  };

  /*
   * -------------------------------------------------------------
   * WATERMARK CONTEXT
   * -------------------------------------------------------------
   */

  const mergedWatermarkContext: WatermarkContextInfo =
    useMemo(() => {
      return {
        ...watermarkContext,
        companyName:
          propCompanyName ||
          watermarkContext?.companyName,
        companyId:
          propCompanyId ||
          watermarkContext?.companyId,
        viewerRole:
          propViewerRole ||
          watermarkContext?.viewerRole,
        designation:
          propDesignation ||
          watermarkContext?.designation,
        viewRef,
      };
    }, [
      watermarkContext,
      propCompanyName,
      propCompanyId,
      propViewerRole,
      propDesignation,
      viewRef,
    ]);

  const displayZoomPercentage =
    Math.round(zoom * 100);

  const pdfReady =
    isPdf &&
    !!pdfDocument &&
    !!pdfPage &&
    !pdfError &&
    !pdfRenderError;

  /*
   * -------------------------------------------------------------
   * RENDER
   * -------------------------------------------------------------
   */

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background border border-border rounded-xl shadow-2xl overflow-hidden select-none">
      {/* --------------------------------------------------------- */}
      {/* SECURE VIEWER HEADER                                      */}
      {/* --------------------------------------------------------- */}

      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border bg-card px-4 py-2 shrink-0 z-30">
        <div className="min-w-0 flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
            <FileText className="size-4" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-xs font-bold text-foreground truncate">
                {documentTitle}
              </p>

              <span className="flex items-center gap-1 rounded bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">
                <ShieldCheck className="size-2.5" />
                Audited View
              </span>
            </div>

            <p className="max-w-[460px] truncate text-[10px] text-muted-foreground font-mono">
              {fileName}{" "}
              {documentDate
                ? `• Date: ${documentDate}`
                : ""}{" "}
              • Ref: {viewRef}
            </p>
          </div>
        </div>

        {/* ------------------------------------------------------- */}
        {/* TES CONTROLS                                            */}
        {/* ------------------------------------------------------- */}

        <div className="flex items-center gap-1.5">
          {isPdf && pdfPageCount > 0 && (
            <div className="flex items-center gap-1 rounded border border-border bg-background px-1">
              <button
                type="button"
                className="flex size-6 items-center justify-center rounded hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
                onClick={handlePreviousPage}
                disabled={
                  pdfPageNumber <= 1 ||
                  pdfLoading
                }
                title="Previous page"
              >
                <ChevronLeft className="size-3.5" />
              </button>

              <span className="min-w-[76px] text-center text-[10px] font-mono font-semibold text-foreground tabular-nums">
                Page {pdfPageNumber} of{" "}
                {pdfPageCount}
              </span>

              <button
                type="button"
                className="flex size-6 items-center justify-center rounded hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
                onClick={handleNextPage}
                disabled={
                  pdfPageNumber >=
                    pdfPageCount ||
                  pdfLoading
                }
                title="Next page"
              >
                <ChevronRight className="size-3.5" />
              </button>
            </div>
          )}

          <button
            type="button"
            className="flex items-center gap-1 h-7 rounded border border-border px-2.5 text-xs font-semibold hover:bg-muted text-foreground transition-colors active:scale-95"
            onClick={handleResetFit}
            title="Fit to window"
          >
            <Maximize2 className="size-3" />
            Fit
          </button>

          <button
            type="button"
            className="flex size-7 items-center justify-center rounded border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors active:scale-95"
            onClick={handleZoomOut}
            title="Zoom out"
          >
            <ZoomOut className="size-3.5" />
          </button>

          <span
            className="w-12 text-center text-[10px] font-mono font-bold text-foreground tabular-nums cursor-pointer hover:underline"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            title="Reset to Fit"
          >
            {displayZoomPercentage}%
          </span>

          <button
            type="button"
            className="flex size-7 items-center justify-center rounded border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors active:scale-95"
            onClick={handleZoomIn}
            title="Zoom in"
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

      {/* --------------------------------------------------------- */}
      {/* MAIN SECURE VIEWPORT                                      */}
      {/* --------------------------------------------------------- */}

      <div
        ref={viewportRef}
        className="relative min-h-[350px] flex-1 overflow-hidden bg-muted/30 select-none flex items-center justify-center"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          cursor: isDragging
            ? "grabbing"
            : panBounds.x > 0 ||
                panBounds.y > 0
              ? "grab"
              : "default",
          touchAction: "none",
        }}
      >
        {/* Layer B: Ambient Viewer Canvas Watermark */}
        <DocumentWatermark
          {...mergedWatermarkContext}
          variant="canvas"
        />

        {/* ------------------------------------------------------- */}
        {/* TES DOCUMENT STAGE                                     */}
        {/* ------------------------------------------------------- */}

        <div
          className="relative flex items-center justify-center shadow-2xl rounded-lg bg-white border border-border overflow-hidden select-none"
          style={{
            width: `${docSize.width}px`,
            height: `${docSize.height}px`,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${fitScale * zoom}) rotate(${rotation}deg)`,
            transformOrigin: "center center",
            boxShadow:
              "0 20px 45px -10px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(0, 0, 0, 0.1)",
            transition:
              isDragging
                ? "none"
                : "transform 75ms ease-out",
          }}
        >
          {/* ----------------------------------------------------- */}
          {/* PDF — TES CONTROLLED PDF.JS CANVAS                   */}
          {/* ----------------------------------------------------- */}

          {isPdf ? (
            <div className="relative h-full w-full bg-white overflow-hidden flex items-center justify-center">
              {pdfPage && (
                <canvas
                  ref={canvasRef}
                  aria-label={`${fileName}, page ${pdfPageNumber}`}
                  className="block max-w-none"
                  style={{
                    width: `${docSize.width}px`,
                    height: `${docSize.height}px`,
                  }}
                />
              )}

              {pdfLoading && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/80">
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground shadow-lg">
                    <Loader2 className="size-4 animate-spin" />
                    Rendering document…
                  </div>
                </div>
              )}

              {pdfError && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-white">
                  <div className="mx-6 max-w-md rounded-xl border border-destructive/20 bg-destructive/5 p-5 text-center">
                    <AlertTriangle className="mx-auto mb-3 size-7 text-destructive" />

                    <p className="text-sm font-semibold text-foreground">
                      PDF could not be displayed
                    </p>

                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {pdfError}
                    </p>
                  </div>
                </div>
              )}

              {!pdfError &&
                pdfRenderError && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center bg-white">
                    <div className="mx-6 max-w-md rounded-xl border border-destructive/20 bg-destructive/5 p-5 text-center">
                      <AlertTriangle className="mx-auto mb-3 size-7 text-destructive" />

                      <p className="text-sm font-semibold text-foreground">
                        PDF page could not be rendered
                      </p>

                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {pdfRenderError}
                      </p>
                    </div>
                  </div>
                )}

              {pdfReady && (
                <div
                  className="absolute inset-0 pointer-events-none"
                  aria-hidden="true"
                />
              )}
            </div>
          ) : (
            /* --------------------------------------------------- */
            /* EXISTING RASTER IMAGE PATH — PRESERVED             */
            /* --------------------------------------------------- */

            <img
              src={dataUrl}
              alt={fileName}
              draggable={false}
              onLoad={handleImageLoad}
              className="h-full w-full object-contain select-none pointer-events-none"
            />
          )}

          {/* ----------------------------------------------------- */}
          {/* Layer A: FORENSIC DOCUMENT WATERMARK                 */}
          {/* Anchored to the actual rendered document/page.       */}
          {/* ----------------------------------------------------- */}

          <DocumentWatermark
            {...mergedWatermarkContext}
            variant="document"
          />
        </div>
      </div>

      {/* --------------------------------------------------------- */}
      {/* BOTTOM SECURE STATUS                                      */}
      {/* --------------------------------------------------------- */}

      <div className="flex min-h-11 items-center justify-between gap-3 border-t border-border bg-card px-4 py-2 shrink-0 z-30">
        <div className="flex items-center gap-2 min-w-0">
          <span className="size-2 rounded-full bg-emerald-500 shrink-0 animate-pulse" />

          <p className="min-w-0 truncate text-[11px] text-muted-foreground font-mono">
            {fileName} •{" "}
            {isPdf
              ? `PDF.js Controlled View${
                  pdfPageCount > 0
                    ? ` • Page ${pdfPageNumber}/${pdfPageCount}`
                    : ""
                }`
              : "High-Resolution Image Asset"}{" "}
            • Audited View Ref:{" "}
            <span className="font-bold text-foreground">
              {viewRef}
            </span>
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
