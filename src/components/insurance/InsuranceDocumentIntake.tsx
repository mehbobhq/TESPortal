"use client";

import React from "react";
import { DocumentSourcePicker } from "@/src/components/shared/DocumentSourcePicker";
import { CameraCapture } from "@/src/components/CameraCapture";

interface InsuranceDocumentIntakeProps {
  sourcePickerOpen: boolean;
  cameraOpen: boolean;
  targetDescription: string;
  onCloseSourcePicker: () => void;
  onOpenCamera: () => void;
  onSelectFile: (file: File) => void | Promise<void>;
  onCapture: (file: File) => void | Promise<void>;
  onCloseCamera: () => void;
}

export function InsuranceDocumentIntake({
  sourcePickerOpen,
  cameraOpen,
  targetDescription,
  onCloseSourcePicker,
  onOpenCamera,
  onSelectFile,
  onCapture,
  onCloseCamera,
}: InsuranceDocumentIntakeProps) {
  return (
    <>
      <DocumentSourcePicker
        isOpen={sourcePickerOpen}
        onClose={onCloseSourcePicker}
        title={`Attach Document: ${targetDescription}`}
        onSelectCamera={onOpenCamera}
        onSelectFile={onSelectFile}
      />

      {cameraOpen && (
        <CameraCapture
          onCapture={onCapture}
          onClose={onCloseCamera}
        />
      )}
    </>
  );
}
