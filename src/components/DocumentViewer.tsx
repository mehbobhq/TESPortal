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
  companyName?: string;
  companyId?: string;
  viewerRole?: string;
  designation?: string;
  viewRef?: string;
  watermarkContext?: SecureDocumentViewerProps["watermarkContext"];
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
  companyName,
  companyId,
  viewerRole,
  designation,
  viewRef,
  watermarkContext,
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
      companyName={companyName}
      companyId={companyId}
      viewerRole={viewerRole}
      designation={designation}
      viewRef={viewRef}
      watermarkContext={watermarkContext}
      onClose={onClose}
      onReplace={onReplace}
    />
  );
}
