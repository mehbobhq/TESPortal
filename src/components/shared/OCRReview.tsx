"use client";

import React, { useState } from "react";
import { OCRDocumentResult, OCRFieldResult } from "../../types/ocr";
import { SecureDocumentViewer } from "./SecureDocumentViewer";
import { Check, AlertCircle, RefreshCw, Upload, Camera, Edit2, ShieldAlert } from "lucide-react";

export interface OCRReviewProps<T extends Record<string, unknown>> {
  documentResult: OCRDocumentResult;
  documentDataUrl: string;
  initialValues: T;
  fieldDefinitions: Array<{
    key: keyof T & string;
    label: string;
    type?: "text" | "number" | "date" | "select";
    options?: Array<{ label: string; value: string }>;
    required?: boolean;
    formatHelper?: string;
  }>;
  onConfirm: (values: T, evidenceAttachment: { fileRef: string; fileName: string; ocrConfidence: number }) => void;
  onRecapture?: () => void;
  onReupload?: () => void;
  onRetry?: () => void;
  onCancel: () => void;
  isSubmitting?: boolean;
  confidenceWarningThreshold?: number; // default 75
}

/**
 * Domain-neutral Split-Screen OCR Review & Field Verification Component.
 * Left: Controlled Document Viewer with universal deterrence watermark.
 * Right: Extracted fields with confidence metrics, manual override, and confirmation flow.
 */
export function OCRReview<T extends Record<string, unknown>>({
  documentResult,
  documentDataUrl,
  initialValues,
  fieldDefinitions,
  onConfirm,
  onRecapture,
  onReupload,
  onRetry,
  onCancel,
  isSubmitting = false,
  confidenceWarningThreshold = 75,
}: OCRReviewProps<T>) {
  const [formValues, setFormValues] = useState<T>(initialValues);
  const [correctedFields, setCorrectedFields] = useState<Record<string, boolean>>({});

  const handleFieldChange = (key: string, value: unknown) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
    setCorrectedFields((prev) => ({ ...prev, [key]: true }));
  };

  const getConfidenceLevel = (confidence?: number) => {
    if (confidence === undefined) return null;
    if (confidence >= 85) return { label: "High", color: "text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300" };
    if (confidence >= confidenceWarningThreshold) return { label: "Fair", color: "text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300" };
    return { label: "Low", color: "text-red-700 bg-red-50 dark:bg-red-950/40 dark:text-red-300" };
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm(formValues, {
      fileRef: documentResult.documentId,
      fileName: documentResult.fileName,
      ocrConfidence: documentResult.overallConfidence,
    });
  };

  return (
    <div className="flex h-full min-h-[600px] flex-col lg:flex-row gap-6 p-4 bg-background">
      {/* Left: Document View Pane */}
      <div className="flex-1 min-h-[450px] lg:min-h-0 border border-border rounded-2xl overflow-hidden bg-muted/20 relative flex flex-col">
        <div className="flex items-center justify-between px-4 py-2.5 bg-card border-b border-border text-xs">
          <div className="flex items-center gap-2">
            <span className="font-bold text-foreground truncate max-w-[200px]">{documentResult.fileName}</span>
            <span className="text-muted-foreground text-[11px]">({documentResult.documentType})</span>
          </div>

          <div className="flex items-center gap-1.5">
            {onRecapture && (
              <button
                type="button"
                onClick={onRecapture}
                className="flex items-center gap-1 rounded px-2 py-1 hover:bg-muted text-muted-foreground hover:text-foreground text-[11px]"
                title="Recapture via camera"
              >
                <Camera className="size-3" />
                Recapture
              </button>
            )}
            {onReupload && (
              <button
                type="button"
                onClick={onReupload}
                className="flex items-center gap-1 rounded px-2 py-1 hover:bg-muted text-muted-foreground hover:text-foreground text-[11px]"
                title="Re-upload file"
              >
                <Upload className="size-3" />
                Re-upload
              </button>
            )}
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="flex items-center gap-1 rounded px-2 py-1 hover:bg-muted text-muted-foreground hover:text-foreground text-[11px]"
                title="Rerun OCR extraction"
              >
                <RefreshCw className="size-3" />
                Rerun
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 relative">
          <SecureDocumentViewer
            fileName={documentResult.fileName}
            mimeType={documentResult.mimeType}
            dataUrl={documentDataUrl}
            documentTitle={`OCR Source: ${documentResult.documentType}`}
            ocrConfidence={documentResult.overallConfidence}
          />
        </div>
      </div>

      {/* Right: Field Review & Correction Form */}
      <div className="w-full lg:w-[460px] flex flex-col rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border bg-muted/10 space-y-1">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground">Review Extracted Data</h3>
            {documentResult.overallConfidence > 0 && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${getConfidenceLevel(documentResult.overallConfidence)?.color}`}>
                OCR: {Math.round(documentResult.overallConfidence)}% Confidence
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Verify automated OCR extractions against the source document. Correct any mismatched fields.
          </p>
        </div>

        <form onSubmit={handleFormSubmit} className="flex-1 flex flex-col justify-between overflow-y-auto p-4 space-y-4">
          <div className="space-y-3.5">
            {fieldDefinitions.map((field) => {
              const fieldResult: OCRFieldResult | undefined = documentResult.extractedFields[field.key];
              const confLevel = fieldResult ? getConfidenceLevel(fieldResult.confidence) : null;
              const isCorrected = correctedFields[field.key];
              const currentValue = formValues[field.key] !== undefined && formValues[field.key] !== null ? String(formValues[field.key]) : "";

              return (
                <div key={field.key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <label className="font-semibold text-foreground flex items-center gap-1.5">
                      {field.label}
                      {field.required && <span className="text-destructive">*</span>}
                    </label>

                    <div className="flex items-center gap-1.5">
                      {isCorrected ? (
                        <span className="flex items-center gap-0.5 text-[10px] font-medium text-primary">
                          <Edit2 className="size-2.5" />
                          Manual
                        </span>
                      ) : confLevel ? (
                        <span className={`text-[10px] font-medium px-1.5 py-0.2 rounded ${confLevel.color}`}>
                          {Math.round(fieldResult?.confidence ?? 0)}%
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {field.type === "select" && field.options ? (
                    <select
                      value={currentValue}
                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium focus:border-primary focus:outline-hidden"
                      required={field.required}
                    >
                      <option value="">Select option...</option>
                      {field.options.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
                      value={currentValue}
                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                      placeholder={`Enter ${field.label.toLowerCase()}...`}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium focus:border-primary focus:outline-hidden"
                      required={field.required}
                    />
                  )}

                  {field.formatHelper && (
                    <p className="text-[10px] text-muted-foreground">{field.formatHelper}</p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Action Confirmation Footer */}
          <div className="pt-4 border-t border-border flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={isSubmitting}
              className="px-3.5 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted rounded-xl transition-colors"
            >
              Discard
            </button>

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-primary-foreground bg-primary hover:bg-primary/90 rounded-xl shadow-xs transition-colors disabled:opacity-50"
            >
              <Check className="size-3.5" />
              {isSubmitting ? "Validating & Saving..." : "Confirm & Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
