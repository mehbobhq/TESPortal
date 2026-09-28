"use client";
import React from "react";
import { DocumentSourcePicker } from "@/src/components/shared/DocumentSourcePicker";
import { CameraCapture } from "@/src/components/CameraCapture";

interface ContactDocumentIntakeProps {
  isSourcePickerOpen: boolean;
  setIsSourcePickerOpen: (value: boolean) => void;
  isCameraOpen: boolean;
  setIsCameraOpen: (value: boolean) => void;
  handleFileChosen: (file: File, source: "camera" | "device") => void;
}

export function ContactDocumentIntake({
  isSourcePickerOpen,
  setIsSourcePickerOpen,
  isCameraOpen,
  setIsCameraOpen,
  handleFileChosen,
}: ContactDocumentIntakeProps) {
  return (
    <>
      <DocumentSourcePicker
        isOpen={isSourcePickerOpen}
        onClose={() => setIsSourcePickerOpen(false)}
        onSelectCamera={() => setIsCameraOpen(true)}
        onSelectFile={(file) => handleFileChosen(file, "device")}
        title="Ingest Driver Licence / ID Document"
        subtitle="Capture or upload photo ID for automated OCR extraction and evidence creation."
      />
      {isCameraOpen && (
        <CameraCapture
          onClose={() => setIsCameraOpen(false)}
          onCapture={(file) => {
            setIsCameraOpen(false);
            handleFileChosen(file, "camera");
          }}
        />
      )}
    </>
  );
}
