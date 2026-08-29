"use client";

import React, { useEffect, useRef, useState } from "react";
import { Camera, X, AlertTriangle } from "lucide-react";

type CameraProps = {
  onCapture: (file: File) => void;
  onClose: () => void;
};

export function CameraCapture({ onCapture, onClose }: CameraProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function startCamera() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError("Camera is not supported on this browser or platform.");
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });

        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setReady(true);
        }
      } catch (err) {
        console.error("Camera access error:", err);
        setError("Camera permission denied or camera device unavailable.");
      }
    }

    startCamera();

    return () => {
      active = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const handleCapture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `vehicle-doc-${Date.now()}.jpg`, {
          type: "image/jpeg",
        });

        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
        }
        onCapture(file);
      },
      "image/jpeg",
      0.95
    );
  };

  return (
    <div className="fixed inset-0 z-[150] flex flex-col bg-black">
      {/* Top bar */}
      <div className="flex min-h-16 items-center justify-between border-b border-white/10 px-5 text-white bg-black/60 backdrop-blur">
        <div>
          <p className="text-sm font-semibold">Capture Vehicle Registration / Cab Card</p>
          <p className="text-[10px] text-white/60">
            Align the document inside the target rectangle. Ensure clear lighting.
          </p>
        </div>
        <button
          type="button"
          className="flex size-8 items-center justify-center rounded-full hover:bg-white/20 text-white"
          onClick={onClose}
        >
          <X className="size-5" />
        </button>
      </div>

      {/* Main Viewport */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-black">
        {error ? (
          <div className="max-w-md rounded-xl border border-red-900 bg-red-950/60 p-6 text-center text-white">
            <AlertTriangle className="mx-auto size-8 text-red-400" />
            <p className="mt-3 text-sm font-semibold">Camera Access Required</p>
            <p className="mt-2 text-xs text-white/70">{error}</p>
            <button
              type="button"
              className="mt-4 rounded bg-white/20 px-4 py-1.5 text-xs hover:bg-white/30"
              onClick={onClose}
            >
              Close & Upload from Device
            </button>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              className="max-h-full max-w-full object-contain"
            />
            {/* Alignment Guide */}
            <div className="pointer-events-none absolute inset-[10%] rounded-xl border-2 border-dashed border-emerald-400/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]">
              <div className="absolute top-2 left-2 rounded bg-black/60 px-2 py-0.5 text-[10px] text-emerald-300 font-mono">
                Document Alignment Target
              </div>
            </div>
          </>
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {/* Capture Button Bar */}
      <div className="flex min-h-24 items-center justify-center border-t border-white/10 bg-black/60 backdrop-blur">
        <button
          type="button"
          className="flex items-center gap-2 rounded-full bg-primary px-8 py-3 font-semibold text-primary-foreground shadow-lg hover:bg-primary/90 disabled:opacity-50"
          disabled={!ready}
          onClick={handleCapture}
        >
          <Camera className="size-5" />
          Capture Document
        </button>
      </div>
    </div>
  );
}
