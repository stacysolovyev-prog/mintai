"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Tutor from "./Tutor";
import { CameraIcon, ImageIcon, CloseIcon } from "./Icons";
import { haptic } from "@/lib/haptics";

/** Downscale before upload — vision models are slower and dearer on full-res phone photos. */
async function shrink(src: string, max = 1400): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(src);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
}

export default function ScanTab({ userId }: { userId: string | null }) {
  const [shot, setShot] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // The viewfinder renders through a portal, which needs a DOM to portal into.
  useEffect(() => setMounted(true), []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLive(false);
  }, []);

  useEffect(() => stop, [stop]);

  // Nothing behind the viewfinder should scroll or rubber-band while it is up.
  useEffect(() => {
    if (!live) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [live]);

  // Back gesture and Escape should close the camera, not leave the app.
  useEffect(() => {
    if (!live) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [live, stop]);

  const openCamera = async () => {
    haptic("tap");
    setCamError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
        audio: false,
      });
      streamRef.current = stream;
      setLive(true);
      // The <video> mounts with `live`, so attach on the next frame.
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch (e) {
      const err = e as DOMException;
      setCamError(
        err.name === "NotAllowedError"
          ? "Camera access was blocked. Allow it in your browser settings, or upload a photo instead."
          : err.name === "NotFoundError"
            ? "No camera found on this device. Upload a photo instead."
            : "Couldn't open the camera. Upload a photo instead.",
      );
    }
  };

  const capture = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    haptic("send");
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    stop();
    setShot(await shrink(canvas.toDataURL("image/jpeg", 0.9)));
  };

  const pick = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => setShot(await shrink(String(reader.result)));
    reader.readAsDataURL(file);
  };

  const reset = () => {
    haptic("tap");
    stop();
    setShot(null);
    setCamError(null);
  };

  /**
   * The viewfinder. Portalled to <body> and fixed to the viewport so it covers
   * the whole screen — the tab bar and the header included — the way a camera
   * does in every native app.
   */
  const viewfinder =
    live && mounted
      ? createPortal(
          <div className="viewfinder" role="dialog" aria-label="Camera" aria-modal="true">
            <video ref={videoRef} playsInline muted autoPlay />

            <button className="vf-close" onClick={stop} aria-label="Close camera">
              <CloseIcon />
            </button>

            {/* Corner marks, so it is obvious what will end up in the shot. */}
            <div className="vf-frame" aria-hidden="true">
              <i /><i /><i /><i />
            </div>

            <div className="vf-bar">
              <p className="vf-hint">Fill the frame with the question</p>
              <button className="shutter" onClick={capture} aria-label="Take photo" />
            </div>
          </div>,
          document.body,
        )
      : null;

  if (shot) {
    return (
      <>
        <div className="row-between">
          <h2 style={{ fontSize: 17 }}>Your problem</h2>
          <button className="btn sm ghost" onClick={reset}>
            <CloseIcon /> New photo
          </button>
        </div>
        <div className="mt16">
          <Tutor source="scan" userId={userId} seed={{ image: shot }} />
        </div>
      </>
    );
  }

  return (
    <>
      {viewfinder}

      <div className="fill-center">
        <div className="hero">
          <h2>Scan a problem</h2>
          <p>
            Point at the question. You&apos;ll get the questions that get you there — not the
            answer.
          </p>
        </div>

        {camError && <div className="banner mt12">{camError}</div>}

        <button className="btn block mt16" onClick={openCamera}>
          <CameraIcon /> Open camera
        </button>

        <button
          className="btn secondary block mt12"
          onClick={() => {
            haptic("tap");
            fileRef.current?.click();
          }}
        >
          <ImageIcon /> Upload a photo
        </button>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
    </>
  );
}
