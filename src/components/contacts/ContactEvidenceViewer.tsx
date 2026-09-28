"use client";
import React from "react";
import { SecureDocumentViewer } from "@/src/components/shared/SecureDocumentViewer";
import type { Evidence } from "./types";

interface ContactEvidenceViewerProps {
  previewEvidence: Evidence | null;
  setPreviewEvidence: (evidence: Evidence | null) => void;
  previewEvidenceLoading?: boolean;
}

export function ContactEvidenceViewer({ previewEvidence, setPreviewEvidence, previewEvidenceLoading }: ContactEvidenceViewerProps) {
  return (
    <>
      {/* MODAL 5: EVIDENCE PREVIEW MODAL (Shared Foundation SecureDocumentViewer) */}
      {/* ========================================================================= */}
      {previewEvidence && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-4xl h-[80vh] rounded-2xl overflow-hidden shadow-2xl">
            <SecureDocumentViewer
              fileName={previewEvidence.fileName}
              mimeType={previewEvidence.fileType}
              dataUrl={previewEvidence.dataUrl}
              loading={previewEvidenceLoading}
              documentTitle={previewEvidence.type}
              documentDate={previewEvidence.documentDate || previewEvidence.uploadedAt?.split("T")[0]}
              ocrConfidence={previewEvidence.confidence}
              onClose={() => setPreviewEvidence(null)}
            />
          </div>
        </div>
      )}
    </>
  );
}
