"use client";

import React, { useState } from "react";
import { EvidenceRecord, EvidenceVerificationState } from "../../types/evidence";
import {
  FileText,
  Eye,
  Plus,
  ShieldCheck,
  Clock,
  Archive,
  Calendar,
  Sparkles,
  Camera,
  Upload,
  Layers,
} from "lucide-react";
import { EmptyState } from "./StateDisplays";

export interface EvidencePanelProps {
  evidenceItems: EvidenceRecord[];
  onOpenDocument: (evidence: EvidenceRecord) => void;
  onAddEvidence?: () => void;
  title?: string;
  allowHistoricalFilter?: boolean;
  retentionWindowYears?: number;
}

export function EvidencePanel({
  evidenceItems,
  onOpenDocument,
  onAddEvidence,
  title = "Compliance Evidence & Source Documents",
  allowHistoricalFilter = true,
  retentionWindowYears = 3,
}: EvidencePanelProps) {
  const [showArchived, setShowArchived] = useState(false);

  const activeEvidence = evidenceItems.filter((e) => !e.archive?.isArchived);
  const archivedEvidence = evidenceItems.filter((e) => e.archive?.isArchived);

  const displayedList = showArchived ? evidenceItems : activeEvidence;

  const getVerificationBadge = (state: EvidenceVerificationState) => {
    switch (state) {
      case "verified":
        return (
          <span className="flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            <ShieldCheck className="size-3" /> Verified
          </span>
        );
      case "pending_review":
        return (
          <span className="flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            <Clock className="size-3" /> Pending Review
          </span>
        );
      case "superseded":
        return (
          <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            <Layers className="size-3" /> Superseded
          </span>
        );
      default:
        return (
          <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            Unverified
          </span>
        );
    }
  };

  const getSourceIcon = (source: string) => {
    if (source === "camera") return <Camera className="size-3 text-muted-foreground" title="Captured via live camera" />;
    if (source === "upload") return <Upload className="size-3 text-muted-foreground" title="Uploaded from device" />;
    return <FileText className="size-3 text-muted-foreground" />;
  };

  return (
    <div className="space-y-4">
      {/* Header with Title and Ingestion Action */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">{title}</h4>
          <p className="text-[11px] text-muted-foreground">
            {activeEvidence.length} active record{activeEvidence.length !== 1 ? "s" : ""}{" "}
            {archivedEvidence.length > 0 && `(${archivedEvidence.length} archived within ${retentionWindowYears}-yr window)`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {allowHistoricalFilter && archivedEvidence.length > 0 && (
            <button
              type="button"
              onClick={() => setShowArchived(!showArchived)}
              className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                showArchived
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:text-foreground"
              }`}
            >
              <Archive className="size-3" />
              {showArchived ? "Hide Archived" : "Show Historical"}
            </button>
          )}

          {onAddEvidence && (
            <button
              type="button"
              onClick={onAddEvidence}
              className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground shadow-xs hover:bg-primary/90 transition-colors"
            >
              <Plus className="size-3.5" />
              Attach Evidence
            </button>
          )}
        </div>
      </div>

      {/* Evidence List / Empty State */}
      {displayedList.length === 0 ? (
        <EmptyState
          icon={<FileText className="size-8 text-muted-foreground/60" />}
          title="No Evidence Attached"
          description="Compliance documents and verified audit attachments will appear here."
          action={
            onAddEvidence
              ? {
                  label: "Attach First Document",
                  onClick: onAddEvidence,
                  icon: <Plus className="size-3.5" />,
                }
              : undefined
          }
        />
      ) : (
        <div className="divide-y divide-border/60 rounded-xl border border-border bg-card overflow-hidden">
          {displayedList.map((item) => (
            <div
              key={item.id}
              className={`flex items-center justify-between gap-4 p-3.5 hover:bg-muted/30 transition-colors ${
                item.archive?.isArchived ? "bg-muted/15 opacity-75" : ""
              }`}
            >
              <div className="flex items-start gap-3 min-w-0">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary mt-0.5">
                  <FileText className="size-4" />
                </div>

                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-foreground truncate">{item.fileName}</span>
                    <span className="rounded bg-muted px-1.5 py-0.2 text-[10px] font-semibold text-muted-foreground">
                      {item.documentType}
                    </span>
                    {getVerificationBadge(item.verificationState)}
                  </div>

                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
                    {item.documentDate && (
                      <span className="flex items-center gap-1">
                        <Calendar className="size-3" />
                        Doc Date: {item.documentDate}
                      </span>
                    )}

                    <span className="flex items-center gap-1">
                      {getSourceIcon(item.source)}
                      Source: {item.source}
                    </span>

                    {item.ocrMetadata?.overallConfidence !== undefined && item.ocrMetadata.overallConfidence > 0 && (
                      <span className="flex items-center gap-1 font-medium text-primary">
                        <Sparkles className="size-3" />
                        OCR: {Math.round(item.ocrMetadata.overallConfidence)}%
                      </span>
                    )}

                    {item.archive?.isArchived && (
                      <span className="text-amber-600 dark:text-amber-400 font-medium">
                        [Archived: {item.archive.archiveReason || "Superseded"}]
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onOpenDocument(item)}
                  className="flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-muted hover:border-primary/40 transition-colors shadow-2xs"
                  title="Open in Secure Document Viewer"
                >
                  <Eye className="size-3.5" />
                  View
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
