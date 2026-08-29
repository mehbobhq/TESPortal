"use client";

import React from "react";
import { SecureDocumentViewer, SecureDocumentViewerProps } from "./shared/SecureDocumentViewer";

type ViewerProps = {
  fileName: string;
  mimeType: string;
  dataUrl: string;
  documentTitle?: string;
  documentDate?: string;
  ocrConfidence?: number;
  onClose?: () => void;
  onReplace?: () => void;
};

/**
 * Standard DocumentViewer wrapper delegating directly to the centralized SecureDocumentViewer.
 * Enforces uncroppable universal watermark and secure deterrent controls.
 */
export function DocumentViewer({
  fileName,
  mimeType,
  dataUrl,
  documentTitle = "Compliance Document View",
  documentDate,
  ocrConfidence,
  onClose,
  onReplace,
}: ViewerProps) {
  return (
    <SecureDocumentViewer
      fileName={fileName}
      mimeType={mimeType}
      dataUrl={dataUrl}
      documentTitle={documentTitle}
      documentDate={documentDate}
      ocrConfidence={ocrConfidence}
      onClose={onClose}
      onReplace={onReplace}
    />
  );
}
