"use client";

import React from "react";
import { DocumentSourcePicker } from "@/src/components/shared/DocumentSourcePicker";
import { CameraCapture } from "@/src/components/CameraCapture";
import { SecureDocumentViewer } from "@/src/components/shared/SecureDocumentViewer";

type Props = {
  previewDocument: { name: string; url: string; target: string } | null;
  documentTarget: string | null;
  isSourcePickerOpen: boolean;
  isCameraOpen: boolean;
  handleFileSelected: (file: File) => void;
  handleClosePreview: () => void;
  setIsSourcePickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsCameraOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

export function BusinessDocumentModals({ previewDocument, documentTarget, isSourcePickerOpen, isCameraOpen, handleFileSelected, handleClosePreview, setIsSourcePickerOpen, setIsCameraOpen }: Props) {
  return (
    <>
      <DocumentSourcePicker
        title={`Select Document: ${documentTarget || "Corporate Records"}`}
        isOpen={isSourcePickerOpen}
        onClose={() => setIsSourcePickerOpen(false)}
        onSelectCamera={() => {
          setIsSourcePickerOpen(false);
          setIsCameraOpen(true);
        }}
        onSelectFile={(file) => {
          setIsSourcePickerOpen(false);
          handleFileSelected(file);
        }}
      />

      {/* Live Camera Capture Modal */}
      {isCameraOpen && (
        <CameraCapture
          onCapture={(file) => {
            setIsCameraOpen(false);
            handleFileSelected(file);
          }}
          onClose={() => setIsCameraOpen(false)}
        />
      )}

      {/* Secure Document Viewer Preview Modal (Preview Mode — Not Yet Saved) */}
      {previewDocument && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-4xl h-[80vh] rounded-2xl overflow-hidden shadow-2xl flex flex-col bg-card">
            <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                Document Preview — Not Yet Saved
              </span>
              <span className="text-[11px] text-muted-foreground font-medium">
                Target: {previewDocument.target}
              </span>
            </div>
            <div className="flex-1 relative overflow-hidden">
              <SecureDocumentViewer
                fileName={previewDocument.name}
                mimeType={previewDocument.name.endsWith(".pdf") ? "application/pdf" : "image/jpeg"}
                dataUrl={previewDocument.url}
                documentTitle={`Preview: ${previewDocument.target}`}
                onClose={handleClosePreview}
              />
            </div>
          </div>
        </div>
      )}

    </>
  );
}
