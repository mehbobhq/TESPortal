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
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type PDFDocumentLoadingTask,
  type RenderTask,
} from "pdfjs-dist";

import {
  DocumentWatermark,
  WatermarkContextInfo,
} from "./DocumentWatermark";

import {
  recordDocumentViewEvent,
  generateViewRef,
} from "@/lib/audit-logger";

/**
 * PDF.js worker
 *
 * Uses the worker bundled from the installed pdfjs-dist package.
 * No CDN or browser-native PDF viewer is used.
 */
if (typeof window !== "undefined") {
 GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
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
 * Capabilities:
 * - Raster images remain rendered through the existing image path.
 * - PDFs are rendered through TES-controlled PDF.js canvas rendering.
 * - No iframe/embed/object/browser-native PDF viewer.
 * - PDF intrinsic page dimensions determine document geometry.
 * - Multi-page PDF navigation.
 * - Fit / zoom / pan / rotation.
 * - Forensic document-bound watermark.
 * - Ambient viewer watermark.
 * - Dynamic Eastern Time through existing watermark foundation.
 * - VIEW_DOCUMENT audit binding and View Ref preservation.
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
  /*
   * -------------------------------------------------------------
   * REFS
   * -------------------------------------------------------------
   */

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({
    x: 0,
    y: 0,
  });

  const initialPanRef = useRef({
    x: 0,
    y: 0,
  });

  const auditLoggedRef = useRef(false);

  /*
   * PDF lifecycle refs.
   *
   * PDF.js 6 cleanup is owned by PDFDocumentLoadingTask.destroy().
   * PDFDocumentProxy does not expose the cleanup method used by
   * older implementations.
   */
  const pdfLoadingTaskRef =
    useRef<PDFDocumentLoadingTask | null>(null);

  const pdfDocumentRef =
    useRef<PDFDocumentProxy | null>(null);

  const pdfRenderTaskRef =
    useRef<RenderTask | null>(null);

  /*
   * Incremented whenever a PDF load/page render is replaced.
   * Prevents stale async operations from updating the current viewer.
   */
  const renderGenerationRef = useRef(0);

  /*
   * -------------------------------------------------------------
   * STABLE VIEW REFERENCE
   * -------------------------------------------------------------
   */

  const [viewRef] = useState<string>(() => {
    if (propViewRef) {
      return propViewRef;
    }

    if (watermarkContext?.viewRef) {
      return watermarkContext.viewRef;
    }

    if (watermarkContext?.sessionRef?.startsWith("VW-")) {
      return watermarkContext.sessionRef;
    }

    return generateViewRef();
  });

  /*
   * -------------------------------------------------------------
   * VIEWPORT / DOCUMENT GEOMETRY
   * -------------------------------------------------------------
   */

  const [viewportSize, setViewportSize] = useState({
    width: 800,
    height: 600,
  });

  /*
   * IMPORTANT:
   *
   * There is deliberately no artificial Letter-size default.
   * PDF dimensions are populated from the actual PDF page.
   *
   * Raster image dimensions are populated from naturalWidth /
   * naturalHeight exactly as before.
   */
  const [docSize, setDocSize] = useState({
    width: 1,
    height: 1,
  });

  const [zoom, setZoom] = useState(1.0);

  const [rotation, setRotation] =
    useState<0 | 90 | 180 | 270>(0);

  const [pan, setPan] = useState({
    x: 0,
    y: 0,
  });

  const [isDragging, setIsDragging] =
    useState(false);

  /*
   * -------------------------------------------------------------
   * PDF STATE
   * -------------------------------------------------------------
   */

  const isPdf =
    mimeType === "application/pdf" ||
    dataUrl.includes("application/pdf") ||
    fileName.toLowerCase().endsWith(".pdf");

  const [pdfDocument, setPdfDocument] =
    useState<PDFDocumentProxy | null>(null);

  const [pdfPage, setPdfPage] =
    useState<PDFPageProxy | null>(null);

  const [pdfPageNumber, setPdfPageNumber] =
    useState(1);

  const [pdfPageCount, setPdfPageCount] =
    useState(0);

  const [pdfLoading, setPdfLoading] =
    useState(false);

  const [pdfError, setPdfError] =
    useState<string | null>(null);

  const [pdfRenderError, setPdfRenderError] =
    useState<string | null>(null);

  /*
   * -------------------------------------------------------------
   * VIEWPORT MEASUREMENT
   * -------------------------------------------------------------
   */

  useEffect(() => {
    if (!viewportRef.current) {
      return;
    }

    const observer = new ResizeObserver(
      (entries) => {
        for (const entry of entries) {
          const width =
            entry.contentRect.width;

          const height =
            entry.contentRect.height;

          if (width > 0 && height > 0) {
            setViewportSize({
              width,
              height,
            });
          }
        }
      },
    );

    observer.observe(viewportRef.current);

    return () => {
      observer.disconnect();
    };
  }, []);

  /*
   * -------------------------------------------------------------
   * AUDIT EVENT
   * -------------------------------------------------------------
   */

  useEffect(() => {
    if (auditLoggedRef.current) {
      return;
    }

    auditLoggedRef.current = true;

    try {
      const resolvedCompanyId =
        propCompanyId ||
        watermarkContext?.companyId ||
        (typeof window !== "undefined"
          ? window.location.pathname.match(
              /\/companies\/([^/]+)/,
            )?.[1]
          : undefined);

      const resolvedActor = (
        watermarkContext?.viewerName || ""
      ).trim();

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
      console.warn(
        "Could not log document view audit event:",
        err,
      );
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
   * PDF LOAD
   * -------------------------------------------------------------
   *
   * PDFDocumentLoadingTask owns the PDF loading lifecycle.
   *
   * Cleanup is performed through:
   *
   *   loadingTask.destroy()
   *
   * NOT:
   *
   *   pdfDocument.destroy()
   *
   * This is the PDF.js 6 lifecycle correction.
   * -------------------------------------------------------------
   */

  useEffect(() => {
    if (!isPdf) {
      return;
    }

    let cancelled = false;

    const generation =
      ++renderGenerationRef.current;

    /*
     * Cancel an existing render first.
     */
    const existingRenderTask =
      pdfRenderTaskRef.current;

    if (existingRenderTask) {
      try {
        existingRenderTask.cancel();
      } catch {
        // Best-effort cancellation.
      }
    }

    pdfRenderTaskRef.current = null;

    /*
     * Destroy the previous PDF loading task.
     *
     * PDF.js 6 uses PDFDocumentLoadingTask.destroy()
     * for document/worker lifecycle cleanup.
     */
    const existingLoadingTask =
      pdfLoadingTaskRef.current;

    if (existingLoadingTask) {
      try {
        void existingLoadingTask.destroy();
      } catch {
        // Best-effort cleanup during replacement.
      }
    }

    pdfLoadingTaskRef.current = null;
    pdfDocumentRef.current = null;

    setPdfDocument(null);
    setPdfPage(null);
    setPdfPageNumber(1);
    setPdfPageCount(0);

    setPdfLoading(true);
    setPdfError(null);
    setPdfRenderError(null);

    setDocSize({
      width: 1,
      height: 1,
    });

    setZoom(1);
    setPan({
      x: 0,
      y: 0,
    });

    setRotation(0);

    let loadingTask: PDFDocumentLoadingTask;

    try {
      loadingTask = pdfjsLib.getDocument({
        url: ,
      });

      pdfLoadingTaskRef.current =
        loadingTask;
    } catch (error) {
      if (
        !cancelled &&
        generation ===
          renderGenerationRef.current
      ) {
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
        if (
          cancelled ||
          generation !==
            renderGenerationRef.current
        ) {
          /*
           * The loading task itself owns cleanup.
           */
          try {
            await loadingTask.destroy();
          } catch {
            // Best-effort stale-task cleanup.
          }

          return;
        }

        pdfDocumentRef.current =
          document;

        setPdfDocument(document);
        setPdfPageCount(
          document.numPages,
        );
        setPdfPageNumber(1);

        try {
          const firstPage =
            await document.getPage(1);

          if (
            cancelled ||
            generation !==
              renderGenerationRef.current
          ) {
            return;
          }

          setPdfPage(firstPage);
          setPdfLoading(false);
        } catch (error) {
          if (
            cancelled ||
            generation !==
              renderGenerationRef.current
          ) {
            return;
          }

          setPdfLoading(false);

          setPdfError(
            error instanceof Error
              ? error.message
              : "Unable to load the first PDF page.",
          );
        }
      })
      .catch((error) => {
        if (
          cancelled ||
          generation !==
            renderGenerationRef.current
        ) {
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

      /*
       * Invalidate all asynchronous work
       * associated with this PDF instance.
       */
      ++renderGenerationRef.current;

      /*
       * Cancel active page rendering.
       */
      const renderTask =
        pdfRenderTaskRef.current;

      if (renderTask) {
        try {
          renderTask.cancel();
        } catch {
          // Best-effort cancellation.
        }
      }

      pdfRenderTaskRef.current = null;

      /*
       * PDF.js 6 lifecycle cleanup:
       *
       * PDFDocumentProxy does NOT get destroyed directly.
       * The PDFDocumentLoadingTask owns this lifecycle.
       */
      const loadingTask =
        pdfLoadingTaskRef.current;

      if (loadingTask) {
        try {
          void loadingTask.destroy();
        } catch {
          // Best-effort cleanup during React teardown.
        }
      }

      pdfLoadingTaskRef.current = null;
      pdfDocumentRef.current = null;
    };
  }, [dataUrl, isPdf]);

  /*
   * -------------------------------------------------------------
   * PDF PAGE CHANGE
   * -------------------------------------------------------------
   */

  useEffect(() => {
    if (
      !isPdf ||
      !pdfDocument
    ) {
      return;
    }

    let cancelled = false;

    const generation =
      renderGenerationRef.current;

    setPdfLoading(true);
    setPdfError(null);
    setPdfRenderError(null);

    /*
     * Every page change recalculates containment
     * and starts with zero pan.
     */
    setPan({
      x: 0,
      y: 0,
    });

    setZoom(1);

    setRotation(0);

    void pdfDocument
      .getPage(pdfPageNumber)
      .then((page) => {
        if (
          cancelled ||
          generation !==
            renderGenerationRef.current
        ) {
          return;
        }

        setPdfPage(page);
        setPdfLoading(false);
      })
      .catch((error) => {
        if (
          cancelled ||
          generation !==
            renderGenerationRef.current
        ) {
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
  }, [
    pdfDocument,
    pdfPageNumber,
    isPdf,
  ]);

  /*
   * -------------------------------------------------------------
   * PDF INTRINSIC PAGE DIMENSIONS
   * -------------------------------------------------------------
   */

  useEffect(() => {
    if (
      !isPdf ||
      !pdfPage
    ) {
      return;
    }

    /*
     * Scale 1 gives the actual PDF page dimensions.
     */
    const pageViewport =
      pdfPage.getViewport({
        scale: 1,
        rotation: 0,
      });

    setDocSize({
      width: Math.max(
        1,
        pageViewport.width,
      ),
      height: Math.max(
        1,
        pageViewport.height,
      ),
    });

    setZoom(1);

    setPan({
      x: 0,
      y: 0,
    });
  }, [pdfPage, isPdf]);

  /*
   * -------------------------------------------------------------
   * EXISTING RASTER IMAGE GEOMETRY
   * -------------------------------------------------------------
   */

  const handleImageLoad = useCallback(
    (
      e: React.SyntheticEvent<HTMLImageElement>,
    ) => {
      if (isPdf) {
        return;
      }

      const img =
        e.currentTarget;

      if (
        img.naturalWidth > 0 &&
        img.naturalHeight > 0
      ) {
        setDocSize({
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
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
    const rotated90 =
      rotation === 90 ||
      rotation === 270;

    const effectiveWidth =
      rotated90
        ? docSize.height
        : docSize.width;

    const effectiveHeight =
      rotated90
        ? docSize.width
        : docSize.height;

    if (
      effectiveWidth <= 0 ||
      effectiveHeight <= 0 ||
      viewportSize.width <= 0 ||
      viewportSize.height <= 0
    ) {
      return 1;
    }

    /*
     * Existing viewer geometry:
     * 20px on each side = 40px total.
     */
    const padding = 40;

    const availableWidth =
      Math.max(
        100,
        viewportSize.width -
          padding,
      );

    const availableHeight =
      Math.max(
        100,
        viewportSize.height -
          padding,
      );

    const scaleX =
      availableWidth /
      effectiveWidth;

    const scaleY =
      availableHeight /
      effectiveHeight;

    return Math.min(
      scaleX,
      scaleY,
    );
  }, [
    viewportSize,
    docSize,
    rotation,
  ]);

  /*
   * -------------------------------------------------------------
   * PAN BOUNDS
   * -------------------------------------------------------------
   *
   * Bounds are based on the actual rotated document dimensions
   * and current Fit × Zoom scale.
   * -------------------------------------------------------------
   */

  const panBounds = useMemo(() => {
    const rotated90 =
      rotation === 90 ||
      rotation === 270;

    const effectiveWidth =
      rotated90
        ? docSize.height
        : docSize.width;

    const effectiveHeight =
      rotated90
        ? docSize.width
        : docSize.height;

    const renderedWidth =
      effectiveWidth *
      fitScale *
      zoom;

    const renderedHeight =
      effectiveHeight *
      fitScale *
      zoom;

    return {
      x: Math.max(
        0,
        (renderedWidth -
          viewportSize.width) /
          2,
      ),

      y: Math.max(
        0,
        (renderedHeight -
          viewportSize.height) /
          2,
      ),
    };
  }, [
    docSize,
    fitScale,
    zoom,
    rotation,
    viewportSize,
  ]);

  /*
   * -------------------------------------------------------------
   * PAN CLAMP
   * -------------------------------------------------------------
   */

  const clampPan = useCallback(
    (nextPan: {
      x: number;
      y: number;
    }) => {
      return {
        x: Math.min(
          panBounds.x,
          Math.max(
            -panBounds.x,
            nextPan.x,
          ),
        ),

        y: Math.min(
          panBounds.y,
          Math.max(
            -panBounds.y,
            nextPan.y,
          ),
        ),
      };
    },
    [panBounds],
  );

  /*
   * Re-clamp whenever:
   * - viewport changes
   * - zoom changes
   * - rotation changes
   * - page dimensions change
   */
  useEffect(() => {
    setPan((current) =>
      clampPan(current),
    );
  }, [clampPan]);

  /*
   * -------------------------------------------------------------
   * PDF CANVAS RENDERING
   * -------------------------------------------------------------
   */

  useEffect(() => {
    if (
      !isPdf ||
      !pdfPage
    ) {
      return;
    }

    const canvas =
      pdfCanvasRef.current;

    /*
     * The existing viewer canvas is required.
     * No second canvas is created.
     */
    if (!canvas) {
      setPdfRenderError(
        "TES could not initialize the PDF canvas.",
      );

      return;
    }

    const context =
      canvas.getContext("2d", {
        alpha: false,
      });

    if (!context) {
      setPdfRenderError(
        "TES could not initialize the PDF canvas.",
      );

      return;
    }

    let cancelled = false;

    const generation =
      renderGenerationRef.current;

    /*
     * Cancel any previous render before starting
     * a new render operation.
     */
    const previousRenderTask =
      pdfRenderTaskRef.current;

    if (previousRenderTask) {
      try {
        previousRenderTask.cancel();
      } catch {
        // Best-effort cancellation.
      }
    }

    pdfRenderTaskRef.current = null;

    setPdfRenderError(null);

    /*
     * Render at device resolution while keeping the
     * CSS dimensions equal to the PDF's intrinsic
     * dimensions.
     */
    const devicePixelRatio =
      typeof window !== "undefined"
        ? Math.min(
            window.devicePixelRatio ||
              1,
            2,
          )
        : 1;

    const baseViewport =
      pdfPage.getViewport({
        scale: 1,
        rotation: 0,
      });

    const renderViewport =
      pdfPage.getViewport({
        scale: devicePixelRatio,
        rotation: 0,
      });

    /*
     * Actual backing canvas dimensions.
     */
    canvas.width = Math.ceil(
      renderViewport.width,
    );

    canvas.height = Math.ceil(
      renderViewport.height,
    );

    /*
     * CSS dimensions correspond to actual PDF
     * page dimensions.
     */
    canvas.style.width = `${baseViewport.width}px`;
    canvas.style.height = `${baseViewport.height}px`;

    context.setTransform(
      1,
      0,
      0,
      1,
      0,
      0,
    );

    context.clearRect(
      0,
      0,
      canvas.width,
      canvas.height,
    );

    /*
     * PDF.js 6 RenderParameters:
     *
     * canvas
     * canvasContext
     * viewport
     *
     * The canvas is the exact existing canvas
     * referenced above.
     */
    const renderTask =
      pdfPage.render({
        canvas,
        canvasContext: context,
        viewport: renderViewport,
      });

    pdfRenderTaskRef.current =
      renderTask;

    void renderTask.promise
      .then(() => {
        if (
          cancelled ||
          generation !==
            renderGenerationRef.current ||
          pdfRenderTaskRef.current !==
            renderTask
        ) {
          return;
        }

        pdfRenderTaskRef.current =
          null;
      })
      .catch((error: unknown) => {
        if (
          cancelled ||
          generation !==
            renderGenerationRef.current
        ) {
          return;
        }

        /*
         * Expected when an older render is cancelled.
         */
        if (
          error &&
          typeof error === "object" &&
          "name" in error &&
          (
            error as {
              name?: string;
            }
          ).name ===
            "RenderingCancelledException"
        ) {
          return;
        }

        if (
          pdfRenderTaskRef.current ===
          renderTask
        ) {
          pdfRenderTaskRef.current =
            null;
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
      } catch {
        // Best-effort cancellation.
      }

      if (
        pdfRenderTaskRef.current ===
        renderTask
      ) {
        pdfRenderTaskRef.current =
          null;
      }
    };
  }, [pdfPage, isPdf]);

  /*
   * -------------------------------------------------------------
   * CONTROLS
   * -------------------------------------------------------------
   */

  const handleResetFit = () => {
    setZoom(1.0);

    setPan({
      x: 0,
      y: 0,
    });

    setRotation(0);
  };

  const handleZoomIn = () => {
    setZoom((current) =>
      Math.min(
        5.0,
        Math.round(
          (current + 0.25) * 100,
        ) / 100,
      ),
    );
  };

  const handleZoomOut = () => {
    setZoom((current) =>
      Math.max(
        0.25,
        Math.round(
          (current - 0.25) * 100,
        ) / 100,
      ),
    );
  };

  const handleRotate = () => {
    setRotation((current) => {
      const next =
        (current + 90) % 360;

      return next as
        | 0
        | 90
        | 180
        | 270;
    });

    setPan({
      x: 0,
      y: 0,
    });
  };

  /*
   * -------------------------------------------------------------
   * PDF PAGE NAVIGATION
   * -------------------------------------------------------------
   */

  const handlePreviousPage = () => {
    if (
      !isPdf ||
      pdfPageNumber <= 1 ||
      pdfLoading
    ) {
      return;
    }

    setPdfPageNumber(
      (current) =>
        Math.max(
          1,
          current - 1,
        ),
    );
  };

  const handleNextPage = () => {
    if (
      !isPdf ||
      pdfPageNumber >=
        pdfPageCount ||
      pdfLoading
    ) {
      return;
    }

    setPdfPageNumber(
      (current) =>
        Math.min(
          pdfPageCount,
          current + 1,
        ),
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
    if (e.button !== 0) {
      return;
    }

    isDraggingRef.current =
      true;

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
    if (
      !isDraggingRef.current
    ) {
      return;
    }

    const dx =
      e.clientX -
      dragStartRef.current.x;

    const dy =
      e.clientY -
      dragStartRef.current.y;

    setPan(
      clampPan({
        x:
          initialPanRef.current.x +
          dx,

        y:
          initialPanRef.current.y +
          dy,
      }),
    );
  };

  const handlePointerUp = (
    e: React.PointerEvent,
  ) => {
    if (
      !isDraggingRef.current
    ) {
      return;
    }

    isDraggingRef.current =
      false;

    setIsDragging(false);

    try {
      e.currentTarget.releasePointerCapture(
        e.pointerId,
      );
    } catch {
      // Pointer capture may already have been released.
    }
  };

  /*
   * -------------------------------------------------------------
   * WHEEL ZOOM
   * -------------------------------------------------------------
   */

  const handleWheel = (
    e: React.WheelEvent,
  ) => {
    if (
      !e.ctrlKey &&
      !e.metaKey
    ) {
      return;
    }

    e.preventDefault();

    const delta =
      e.deltaY < 0
        ? 0.15
        : -0.15;

    setZoom((current) =>
      Math.min(
        5.0,
        Math.max(
          0.25,
          Math.round(
            (current + delta) *
              100,
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

  /*
   * -------------------------------------------------------------
   * RENDER
   * -------------------------------------------------------------
   */

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background border border-border rounded-xl shadow-2xl overflow-hidden select-none">
      {/* ------------------------------------------------------- */}
      {/* SECURE VIEWER HEADER                                    */}
      {/* ------------------------------------------------------- */}

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

        {/* ----------------------------------------------------- */}
        {/* ACTION CONTROLS                                       */}
        {/* ----------------------------------------------------- */}

        <div className="flex items-center gap-1.5">
          {isPdf &&
            pdfPageCount > 0 && (
              <div className="flex items-center gap-1 rounded border border-border bg-background px-1">
                <button
                  type="button"
                  className="flex size-6 items-center justify-center rounded hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
                  onClick={
                    handlePreviousPage
                  }
                  disabled={
                    pdfPageNumber <=
                      1 ||
                    pdfLoading
                  }
                  title="Previous page"
                >
                  <ChevronLeft className="size-3.5" />
                </button>

                <span className="min-w-[78px] text-center text-[10px] font-mono font-semibold text-foreground tabular-nums">
                  Page{" "}
                  {pdfPageNumber}{" "}
                  of{" "}
                  {pdfPageCount}
                </span>

                <button
                  type="button"
                  className="flex size-6 items-center justify-center rounded hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
                  onClick={
                    handleNextPage
                  }
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
            onClick={
              handleResetFit
            }
            title="Fit to window (Recalculate Scale)"
          >
            <Maximize2 className="size-3" />
            Fit
          </button>

          <button
            type="button"
            className="flex size-7 items-center justify-center rounded border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors active:scale-95"
            onClick={
              handleZoomOut
            }
            title="Zoom out (-25%)"
          >
            <ZoomOut className="size-3.5" />
          </button>

          <span
            className="w-12 text-center text-[10px] font-mono font-bold text-foreground tabular-nums cursor-pointer hover:underline"
            onClick={() => {
              setZoom(1.0);
              setPan({
                x: 0,
                y: 0,
              });
            }}
            title="Click to reset to 100% Fit"
          >
            {displayZoomPercentage}%
          </span>

          <button
            type="button"
            className="flex size-7 items-center justify-center rounded border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors active:scale-95"
            onClick={
              handleZoomIn
            }
            title="Zoom in (+25%)"
          >
            <ZoomIn className="size-3.5" />
          </button>

          <button
            type="button"
            className="flex size-7 items-center justify-center rounded border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors active:scale-95"
            onClick={
              handleRotate
            }
            title="Rotate 90° Clockwise"
          >
            <RotateCcw className="size-3.5" />
          </button>

          {ocrConfidence !==
            undefined && (
            <div className="flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40 px-2 py-0.5 text-[10px] text-emerald-800 dark:text-emerald-300 font-bold">
              OCR:{" "}
              {Math.round(
                ocrConfidence,
              )}
              %
            </div>
          )}

          {onClose && (
            <button
              type="button"
              className="flex size-7 items-center justify-center rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors ml-1"
              onClick={
                onClose
              }
              title="Close secure viewer"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------- */}
      {/* MAIN SECURE VIEWPORT                                    */}
      {/* ------------------------------------------------------- */}

      <div
        ref={viewportRef}
        className="relative min-h-[350px] flex-1 overflow-hidden bg-muted/30 select-none flex items-center justify-center"
        onWheel={
          handleWheel
        }
        onPointerDown={
          handlePointerDown
        }
        onPointerMove={
          handlePointerMove
        }
        onPointerUp={
          handlePointerUp
        }
        onPointerCancel={
          handlePointerUp
        }
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
        {/* ----------------------------------------------------- */}
        {/* AMBIENT CANVAS WATERMARK                              */}
        {/* ----------------------------------------------------- */}

        <DocumentWatermark
          {...mergedWatermarkContext}
          variant="canvas"
        />

        {/* ----------------------------------------------------- */}
        {/* CONTROLLED DOCUMENT STAGE                             */}
        {/* ----------------------------------------------------- */}

        <div
          className="relative flex items-center justify-center shadow-2xl rounded-lg bg-background border border-border overflow-hidden select-none"
          style={{
            width: `${docSize.width}px`,
            height: `${docSize.height}px`,

            transform: `translate(${pan.x}px, ${pan.y}px) scale(${fitScale * zoom}) rotate(${rotation}deg)`,

            transformOrigin:
              "center center",

            boxShadow:
              "0 20px 45px -10px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(0, 0, 0, 0.1)",

            transition:
              isDragging
                ? "none"
                : "transform 75ms ease-out",
          }}
        >
          {/* --------------------------------------------------- */}
          {/* PDF.JS CONTROLLED PDF RENDERING                     */}
          {/* --------------------------------------------------- */}

          {isPdf ? (
            <div className="relative h-full w-full bg-white flex items-center justify-center overflow-hidden">
              {pdfPage && (
                <canvas
                  ref={pdfCanvasRef}
                  aria-label={`${fileName}, page ${pdfPageNumber}`}
                  className="block max-w-none"
                  draggable={false}
                  style={{
                    width: `${docSize.width}px`,
                    height: `${docSize.height}px`,
                  }}
                />
              )}

              {/* PDF loading state */}
              {pdfLoading && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/80">
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground shadow-lg">
                    <Loader2 className="size-4 animate-spin" />
                    Rendering document…
                  </div>
                </div>
              )}

              {/* PDF parsing/loading failure */}
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

              {/* Individual page render failure */}
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
            </div>
          ) : (
            /* ------------------------------------------------- */
            /* EXISTING RASTER IMAGE PATH — UNCHANGED            */
            /* ------------------------------------------------- */

            <img
              src={dataUrl}
              alt={fileName}
              draggable={false}
              onLoad={
                handleImageLoad
              }
              className="h-full w-full object-contain select-none pointer-events-none"
            />
          )}

          {/* --------------------------------------------------- */}
          {/* FORENSIC DOCUMENT WATERMARK                         */}
          {/* --------------------------------------------------- */}

          <DocumentWatermark
            {...mergedWatermarkContext}
            variant="document"
          />
        </div>
      </div>

      {/* ------------------------------------------------------- */}
      {/* BOTTOM SECURE STATUS                                    */}
      {/* ------------------------------------------------------- */}

      <div className="flex min-h-11 items-center justify-between gap-3 border-t border-border bg-card px-4 py-2 shrink-0 z-30">
        <div className="flex items-center gap-2 min-w-0">
          <span className="size-2 rounded-full bg-emerald-500 shrink-0 animate-pulse" />

          <p className="min-w-0 truncate text-[11px] text-muted-foreground font-mono">
            {fileName} •{" "}
            {isPdf
              ? `PDF.js Controlled View${
                  pdfPageCount >
                  0
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
            onClick={
              onReplace
            }
          >
            <RefreshCcw className="size-3" />
            Replace Document
          </button>
        )}
      </div>
    </div>
  );
}
