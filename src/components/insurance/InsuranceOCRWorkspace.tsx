"use client";

import React from "react";
import { Sparkles, X } from "lucide-react";
import { SecureDocumentViewer } from "@/src/components/shared/SecureDocumentViewer";
import type { InsuranceOCRDraft } from "@/app/companies/[id]/insurance/page";

interface InsuranceOCRWorkspaceProps {
  open: boolean;
  draft: InsuranceOCRDraft | null;
  companyName?: string;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void | Promise<void>;
  onClose: () => void;
}

export function InsuranceOCRWorkspace({
  open,
  draft: ocrDraft,
  companyName,
  onSubmit,
  onClose,
}: InsuranceOCRWorkspaceProps) {
  if (!open || !ocrDraft) return null;

  return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-5xl h-[85vh] rounded-2xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between border-b border-border px-6 py-3.5 bg-muted/20">
              <div className="flex items-center gap-2.5">
                <Sparkles className="size-5 text-primary" />
                <div>
                  <h3 className="text-base font-bold text-foreground">Certificate of Insurance (COI) OCR Review</h3>
                  <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                    <span>Confidence: {(ocrDraft.confidence * 100).toFixed(0)}% (Verified Prototype)</span>
                    <span>•</span>
                    <span>Verify extracted fields before committing to Insurance Register</span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 overflow-hidden">
              {/* Left Column: Secure Document Viewer */}
              <div className="border-r border-border h-full overflow-hidden bg-muted/10 p-3">
                <SecureDocumentViewer
                  fileName={ocrDraft.evidence.fileName}
                  mimeType={ocrDraft.evidence.fileType}
                  dataUrl={ocrDraft.evidence.dataUrl}
                  documentTitle="Extracted COI Certificate"
                  documentDate={ocrDraft.effectiveDate}
                  ocrConfidence={ocrDraft.confidence}
                  watermarkContext={{
                    viewerName: "Compliance Officer",
                    viewerRole: "Compliance Administrator",
                    companyName: companyName || "Carrier Master",
                    timestamp: new Date().toISOString(),
                  }}
                />
              </div>

              {/* Right Column: Editable Review Form */}
              <form onSubmit={onSubmit} className="p-6 space-y-4 overflow-y-auto h-full text-xs">
                <div className="rounded-xl bg-primary/10 border border-primary/20 p-3 text-xs text-primary font-medium">
                  Multi-line policy extraction: Committing will automatically create linked records for Auto Liability,
                  Cargo, and CGL sharing a single COI Group.
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-bold text-foreground">Insurer Name</label>
                    <input
                      type="text"
                      name="insurerName"
                      defaultValue={ocrDraft.insurerName}
                      className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                      required
                    />
                  </div>
                  <div>
                    <label className="font-bold text-foreground">Master Policy Number</label>
                    <input
                      type="text"
                      name="policyNumber"
                      defaultValue={ocrDraft.policyNumber}
                      className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 font-mono font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-bold text-foreground">Effective Date</label>
                    <input
                      type="date"
                      name="effectiveDate"
                      defaultValue={ocrDraft.effectiveDate}
                      className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                      required
                    />
                  </div>
                  <div>
                    <label className="font-bold text-foreground">Expiry Date</label>
                    <input
                      type="date"
                      name="expiryDate"
                      defaultValue={ocrDraft.expiryDate}
                      className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2 border-t border-border pt-3">
                  <span className="font-bold text-foreground block">Extracted Coverage Limits ($ CAD)</span>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-muted-foreground font-semibold">Auto Liability Limit</label>
                      <input
                        type="number"
                        name="autoLiabilityLimit"
                        defaultValue={ocrDraft.autoLiabilityLimit}
                        className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                      />
                    </div>
                    <div>
                      <label className="text-muted-foreground font-semibold">Cargo Limit</label>
                      <input
                        type="number"
                        name="cargoLimit"
                        defaultValue={ocrDraft.cargoLimit}
                        className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                      />
                    </div>
                    <div>
                      <label className="text-muted-foreground font-semibold">Commercial General Liability</label>
                      <input
                        type="number"
                        name="generalLiabilityLimit"
                        defaultValue={ocrDraft.generalLiabilityLimit}
                        className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2 border-t border-border pt-3">
                  <span className="font-bold text-foreground block">Broker Information</span>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-muted-foreground font-semibold">Brokerage Firm</label>
                      <input
                        type="text"
                        name="brokerOrgName"
                        defaultValue={ocrDraft.brokerOrgName}
                        className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                      />
                    </div>
                    <div>
                      <label className="text-muted-foreground font-semibold">Broker Agent</label>
                      <input
                        type="text"
                        name="brokerAgentName"
                        defaultValue={ocrDraft.brokerAgentName}
                        className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-muted-foreground font-semibold">Phone</label>
                      <input
                        type="text"
                        name="brokerPhone"
                        defaultValue={ocrDraft.brokerPhone}
                        className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                      />
                    </div>
                    <div>
                      <label className="text-muted-foreground font-semibold">Email</label>
                      <input
                        type="email"
                        name="brokerEmail"
                        defaultValue={ocrDraft.brokerEmail}
                        className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-border flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 font-semibold text-muted-foreground hover:text-foreground"
                  >
                    Discard
                  </button>
                  <button
                    type="submit"
                    className="rounded-xl bg-primary px-5 py-2 font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
                  >
                    Commit Verified Certificate
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
  );
}
