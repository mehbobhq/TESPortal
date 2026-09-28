"use client";

import React from "react";
import { FileCheck2, X } from "lucide-react";
import { SecureDocumentViewer } from "@/src/components/shared/SecureDocumentViewer";
import type { InsuranceEvidence } from "@/app/companies/[id]/insurance/page";

interface InsuranceEvidenceViewerProps {
  evidence: InsuranceEvidence | null;
  companyName?: string;
  onClose: () => void;
}

export function InsuranceEvidenceViewer({
  evidence: previewEvidence,
  companyName,
  onClose,
}: InsuranceEvidenceViewerProps) {
  if (!previewEvidence) return null;

  return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4">
          <div className="w-full max-w-4xl h-[90vh] rounded-2xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between border-b border-border px-6 py-3 bg-muted/20">
              <div className="flex items-center gap-2">
                <FileCheck2 className="size-4 text-emerald-600" />
                <span className="text-sm font-bold text-foreground truncate">{previewEvidence.fileName}</span>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden p-3 bg-muted/10">
              <SecureDocumentViewer
                fileName={previewEvidence.fileName}
                mimeType={previewEvidence.fileType}
                dataUrl={previewEvidence.dataUrl}
                documentTitle="Secure Insurance Compliance Evidence"
                documentDate={previewEvidence.uploadedAt}
                watermarkContext={{
                  viewerName: "Compliance Officer",
                  viewerRole: "Compliance Administrator",
                  companyName: companyName || "Carrier Master",
                  timestamp: new Date().toISOString(),
                }}
                onClose={onClose}
              />
            </div>
          </div>
        </div>
  );
}
