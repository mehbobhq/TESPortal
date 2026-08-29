"use client";

import React, { useState, useEffect, useRef } from "react";
import { CanonicalEntityReference } from "../../types/entity-references";
import { Search, X, Check, Plus, Loader2 } from "lucide-react";

export interface EntityPickerProps {
  label?: string;
  placeholder?: string;
  selectedEntity?: CanonicalEntityReference | null;
  onSelect: (entity: CanonicalEntityReference | null) => void;
  onSearch: (query: string) => Promise<CanonicalEntityReference[]> | CanonicalEntityReference[];
  onCreateNew?: () => void;
  createNewButtonLabel?: string;
  disabled?: boolean;
  required?: boolean;
}

/**
 * Generic EntityPicker Presentation & Controller Component.
 * Domain-neutral: The consuming module supplies search callbacks and creation triggers.
 * Contains ZERO internal database logic.
 */
export function EntityPicker({
  label,
  placeholder = "Search and select entity...",
  selectedEntity,
  onSelect,
  onSearch,
  onCreateNew,
  createNewButtonLabel = "Create New",
  disabled = false,
  required = false,
}: EntityPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<CanonicalEntityReference[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  // Run search when query changes
  useEffect(() => {
    let isCancelled = false;
    if (!isOpen) return;

    setIsLoading(true);
    const searchPromise = Promise.resolve(onSearch(searchQuery));
    searchPromise
      .then((res) => {
        if (!isCancelled) {
          setResults(res);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setResults([]);
          setIsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [searchQuery, isOpen, onSearch]);

  const handleSelect = (entity: CanonicalEntityReference) => {
    onSelect(entity);
    setIsOpen(false);
    setSearchQuery("");
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(null);
    setSearchQuery("");
  };

  return (
    <div className="relative space-y-1" ref={dropdownRef}>
      {label && (
        <label className="text-xs font-semibold text-foreground flex items-center justify-between">
          <span>
            {label} {required && <span className="text-destructive">*</span>}
          </span>
          {selectedEntity?.entityType && (
            <span className="text-[10px] text-muted-foreground uppercase font-bold">
              {selectedEntity.entityType}
            </span>
          )}
        </label>
      )}

      {/* Input / Selected Entity Pill Display */}
      <div
        onClick={() => !disabled && setIsOpen(true)}
        className={`flex items-center justify-between gap-2 rounded-xl border bg-background px-3 py-2 text-xs transition-colors ${
          disabled ? "opacity-50 cursor-not-allowed border-border" : "cursor-pointer hover:border-primary/50"
        } ${isOpen ? "border-primary ring-1 ring-primary/20" : "border-border"}`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          {selectedEntity ? (
            <div className="flex items-center gap-2 truncate">
              <span className="font-semibold text-foreground truncate">{selectedEntity.label}</span>
              {selectedEntity.secondaryText && (
                <span className="text-[11px] text-muted-foreground truncate">({selectedEntity.secondaryText})</span>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </div>

        {selectedEntity && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground"
            title="Clear selection"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {/* Dropdown Menu */}
      {isOpen && !disabled && (
        <div className="absolute top-full left-0 z-50 mt-1 w-full rounded-2xl border border-border bg-card p-2 shadow-xl animate-in fade-in-50 zoom-in-95 duration-100">
          <div className="mb-2 px-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Type to filter..."
              autoFocus
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs focus:border-primary focus:outline-hidden"
            />
          </div>

          <div className="max-h-56 overflow-y-auto space-y-1 divide-y divide-border/40">
            {isLoading ? (
              <div className="flex items-center justify-center p-4 text-xs text-muted-foreground gap-2">
                <Loader2 className="size-4 animate-spin text-primary" />
                <span>Searching entities...</span>
              </div>
            ) : results.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground space-y-2">
                <p>No matching entities found.</p>
                {onCreateNew && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsOpen(false);
                      onCreateNew();
                    }}
                    className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
                  >
                    <Plus className="size-3" />
                    {createNewButtonLabel}
                  </button>
                )}
              </div>
            ) : (
              results.map((item) => {
                const isSelected = selectedEntity?.id === item.id;
                return (
                  <div
                    key={item.id}
                    onClick={() => handleSelect(item)}
                    className={`flex items-center justify-between gap-3 p-2 rounded-lg cursor-pointer text-xs transition-colors ${
                      isSelected ? "bg-primary/10 text-primary font-bold" : "hover:bg-muted text-foreground"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{item.label}</p>
                      {item.secondaryText && (
                        <p className="text-[10px] text-muted-foreground truncate">{item.secondaryText}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {item.status && (
                        <span className="rounded bg-muted px-1.5 py-0.2 text-[9px] font-medium text-muted-foreground">
                          {item.status}
                        </span>
                      )}
                      {isSelected && <Check className="size-3.5 text-primary" />}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {onCreateNew && results.length > 0 && (
            <div className="pt-2 mt-1 border-t border-border px-1">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onCreateNew();
                }}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs font-bold text-primary hover:bg-primary/5 rounded-lg transition-colors"
              >
                <Plus className="size-3" />
                {createNewButtonLabel}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
