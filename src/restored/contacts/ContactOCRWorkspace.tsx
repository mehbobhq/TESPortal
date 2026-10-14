"use client";
import React from "react";
import { ShieldAlert, ShieldCheck, Sparkles, X } from "lucide-react";
import { SecureDocumentViewer } from "./viewer/SecureDocumentViewer";
import { ISODateInput } from "@/src/components/shared/ISODateInput";
import { CanonicalUnavailable } from "@/src/components/shared/CanonicalUnavailable";
import type { CompanyRecord, OCRReviewDraft } from "./types";

/** A field typed by the user (no extraction ran) has no confidence; it is never shown as a percentage. */
const confClass = (confidence: number | null) => (confidence === null ? "text-muted-foreground" : confidence >= 85 ? "text-emerald-500" : "text-amber-500");
const confText = (confidence: number | null) => (confidence === null ? "typed" : `${confidence}%`);

interface ContactOCRWorkspaceProps {
  isOCRWorkspaceOpen: boolean;
  ocrDraft: OCRReviewDraft | null;
  setOcrDraft: (value: OCRReviewDraft | null) => void;
  ocrValidationError: string | null;
  company: CompanyRecord;
  STANDARD_ROLES: string[];
  ALL_JURISDICTIONS: string[];
  setIsOCRWorkspaceOpen: (value: boolean) => void;
  handleOCRConfirmedSave: () => void;
}

export function ContactOCRWorkspace({
  isOCRWorkspaceOpen, ocrDraft, setOcrDraft, ocrValidationError, company, STANDARD_ROLES, ALL_JURISDICTIONS,
  setIsOCRWorkspaceOpen, handleOCRConfirmedSave,
}: ContactOCRWorkspaceProps) {
  return (
    <>
      {/* MODAL 4: OCR REVIEW WORKSPACE (Contacts Invariant Split-Screen) */}
      {/* ========================================================================= */}
      {isOCRWorkspaceOpen && ocrDraft && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-5xl h-[85vh] rounded-2xl border border-border bg-card flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-border bg-muted/20">
              <div>
                <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                  <Sparkles className="size-4 text-primary" />
                  OCR Identity Extraction Review
                </h3>
                <p className="text-xs text-muted-foreground">
                  Compare the source document with the fields. Automatic OCR extraction is retired, so the fields start empty and nothing is read from the document for you.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsOCRWorkspaceOpen(false);
                  setOcrDraft(null);
                }}
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Split Screen Viewport */}
            <div className="grid grid-cols-1 lg:grid-cols-2 flex-1 min-h-0 divide-y lg:divide-y-0 lg:divide-x divide-border">
              {/* Left Side: Secure Document Viewer */}
              <div className="h-full min-h-[300px] p-3 bg-muted/10">
                <SecureDocumentViewer
                  fileName={ocrDraft.evidence.fileName}
                  mimeType={ocrDraft.evidence.fileType}
                  dataUrl={ocrDraft.evidence.dataUrl}
                  documentTitle="Source Driver Licence Asset"
                  companyName={company.name}
                  companyId={company.id}
                />
              </div>

              {/* Right Side: Extracted Field Review */}
              <div className="p-5 flex flex-col gap-4 overflow-y-auto">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex justify-between">
                      First Name
                      <span
                        className={`text-[9px] font-mono font-bold ${confClass(ocrDraft.firstName.confidence)}`}
                      >
                        {confText(ocrDraft.firstName.confidence)}
                      </span>
                    </label>
                    <input
                      type="text"
                      value={ocrDraft.firstName.value}
                      onChange={(e) =>
                        setOcrDraft({
                          ...ocrDraft,
                          firstName: { ...ocrDraft.firstName, value: e.target.value, confidence: null },
                        })
                      }
                      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold mt-1"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex justify-between">
                      Last Name
                      <span
                        className={`text-[9px] font-mono font-bold ${confClass(ocrDraft.lastName.confidence)}`}
                      >
                        {confText(ocrDraft.lastName.confidence)}
                      </span>
                    </label>
                    <input
                      type="text"
                      value={ocrDraft.lastName.value}
                      onChange={(e) =>
                        setOcrDraft({
                          ...ocrDraft,
                          lastName: { ...ocrDraft.lastName, value: e.target.value, confidence: null },
                        })
                      }
                      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold mt-1"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex justify-between">
                      Date of Birth
                      <span
                        className={`text-[9px] font-mono font-bold ${confClass(ocrDraft.dob.confidence)}`}
                      >
                        {confText(ocrDraft.dob.confidence)}
                      </span>
                    </label>
                    <div className="mt-1">
                      <ISODateInput
                        value={ocrDraft.dob.value}
                        onValueChange={(value) =>
                          setOcrDraft({
                            ...ocrDraft,
                            dob: { ...ocrDraft.dob, value, confidence: null },
                          })
                        }
                        className="text-xs"
                        aria-label="Date of Birth"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex justify-between">
                      Driver Licence #
                      <span
                        className={`text-[9px] font-mono font-bold ${confClass(ocrDraft.dlNumber.confidence)}`}
                      >
                        {confText(ocrDraft.dlNumber.confidence)}
                      </span>
                    </label>
                    <input
                      type="text"
                      value={ocrDraft.dlNumber.value}
                      onChange={(e) =>
                        setOcrDraft({
                          ...ocrDraft,
                          dlNumber: { ...ocrDraft.dlNumber, value: e.target.value, confidence: null },
                        })
                      }
                      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-mono font-bold mt-1"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Jurisdiction
                    </label>
                    <select
                      value={ocrDraft.dlState.value}
                      onChange={(e) =>
                        setOcrDraft({
                          ...ocrDraft,
                          dlState: { ...ocrDraft.dlState, value: e.target.value, confidence: null },
                        })
                      }
                      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs mt-1"
                    >
                      {ALL_JURISDICTIONS.map((j) => (
                        <option key={j} value={j}>
                          {j}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Expiry Date
                    </label>
                    <div className="mt-1">
                      <ISODateInput
                        value={ocrDraft.dlExpiry.value}
                        onValueChange={(value) =>
                          setOcrDraft({
                            ...ocrDraft,
                            dlExpiry: { ...ocrDraft.dlExpiry, value, confidence: null },
                          })
                        }
                        className="text-xs"
                        aria-label="Licence Expiry Date"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Licence Class
                    </label>
                    <input
                      type="text"
                      value={ocrDraft.dlClass.value}
                      onChange={(e) =>
                        setOcrDraft({
                          ...ocrDraft,
                          dlClass: { ...ocrDraft.dlClass, value: e.target.value, confidence: null },
                        })
                      }
                      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs mt-1"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Assigned Role
                    </label>
                    <select
                      value={ocrDraft.role}
                      onChange={(e) => setOcrDraft({ ...ocrDraft, role: e.target.value })}
                      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs mt-1"
                    >
                      {STANDARD_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      placeholder="+1 (555) 000-0000"
                      value={ocrDraft.phone.value}
                      onChange={(e) =>
                        setOcrDraft({
                          ...ocrDraft,
                          phone: { ...ocrDraft.phone, value: e.target.value, confidence: null },
                        })
                      }
                      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs mt-1"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Email Address
                    </label>
                    <input
                      type="email"
                      placeholder="person@company.com"
                      value={ocrDraft.email.value}
                      onChange={(e) =>
                        setOcrDraft({
                          ...ocrDraft,
                          email: { ...ocrDraft.email, value: e.target.value, confidence: null },
                        })
                      }
                      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs mt-1"
                    />
                  </div>
                </div>

                {ocrValidationError && (
                  <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-600 dark:text-amber-400 flex items-start gap-2">
                    <ShieldAlert className="size-4 shrink-0 mt-0.5" />
                    <span>{ocrValidationError}</span>
                  </div>
                )}

                <div className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    id="ocr-primary"
                    checked={ocrDraft.isPrimary}
                    onChange={(e) => setOcrDraft({ ...ocrDraft, isPrimary: e.target.checked })}
                    className="rounded border-border text-primary focus:ring-0 size-4"
                  />
                  <label htmlFor="ocr-primary" className="text-xs font-semibold text-foreground cursor-pointer">
                    Designate as Primary Contact for {company.name}
                  </label>
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between p-4 border-t border-border bg-muted/20">
              <div className="max-w-md">
                <CanonicalUnavailable
                  action="Saving an identity document"
                  reason="OCR extraction is retired, and the contacts record has no field for driver licence details or a link to stored evidence. Confirm & Save Identity is refused and nothing is stored (the document stays in this window only). Use Manual Add to record the person, role, phone and email."
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsOCRWorkspaceOpen(false);
                    setOcrDraft(null);
                  }}
                  className="rounded-lg border border-border px-4 py-2 text-xs font-semibold hover:bg-muted text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleOCRConfirmedSave}
                  className="rounded-lg bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 shadow-xs"
                >
                  Confirm & Save Identity
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
