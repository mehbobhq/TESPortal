"use client";

import React from "react";
import { AlertTriangle, Inbox, RefreshCcw, Loader2 } from "lucide-react";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
    icon?: React.ReactNode;
  };
}

export function EmptyState({
  icon = <Inbox className="size-10 text-muted-foreground/60" />,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center rounded-2xl border border-dashed border-border bg-card/40 my-4">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-muted/60 mb-4 shadow-xs">
        {icon}
      </div>
      <h4 className="text-sm font-bold text-foreground">{title}</h4>
      {description && (
        <p className="max-w-md text-xs text-muted-foreground mt-1.5 leading-relaxed">
          {description}
        </p>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-5 flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
        >
          {action.icon}
          {action.label}
        </button>
      )}
    </div>
  );
}

export interface LoadingStateProps {
  message?: string;
}

export function LoadingState({ message = "Loading compliance records..." }: LoadingStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-16 text-center space-y-3">
      <Loader2 className="size-8 animate-spin text-primary" />
      <p className="text-xs font-medium text-muted-foreground">{message}</p>
    </div>
  );
}

export interface ErrorAlertProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export function ErrorAlert({
  title = "Compliance Validation Error",
  message,
  onRetry,
}: ErrorAlertProps) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-destructive dark:bg-destructive/20 my-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="size-5 shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-bold">{title}</p>
          <p className="text-xs mt-0.5 opacity-90">{message}</p>
        </div>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="flex items-center gap-1 rounded-lg border border-destructive/40 bg-background px-2.5 py-1 text-[11px] font-semibold hover:bg-destructive/10 transition-colors"
        >
          <RefreshCcw className="size-3" />
          Retry
        </button>
      )}
    </div>
  );
}
