import { useEffect, useRef, useState } from "react";
import { CAMERA_CONFIG } from "../config/tuning";

// Ported from the Flap project's pose/useWebcam.ts, with an added readout of
// the resolution/frame rate the browser actually granted (the constraints below
// are requests, not guarantees, and 05-TECH-SETUP-AND-RISK-LOG.md warns that
// real hardware behaviour is the thing to verify, not the requested config).

export type WebcamStatus = "idle" | "requesting" | "ready" | "denied" | "error";

export interface CameraInfo {
  width: number;
  height: number;
  frameRate: number;
  label: string;
}

export function useWebcam(enabled: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null);
  /**
   * The live stream, so other views can attach their own <video> to it.
   *
   * Several elements may share one MediaStream, which is what lets the fight
   * show a small self-view without opening the camera twice — a second
   * getUserMedia call on the same device fails or degrades on most phones.
   */
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<WebcamStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<CameraInfo | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let stream: MediaStream | null = null;
    let cancelled = false;

    async function start() {
      setStatus("requesting");
      setError(null);
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: CAMERA_CONFIG.width },
            height: { ideal: CAMERA_CONFIG.height },
            frameRate: { ideal: CAMERA_CONFIG.frameRate },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const track = stream.getVideoTracks()[0];
        const settings = track?.getSettings?.() ?? {};
        setInfo({
          width: settings.width ?? 0,
          height: settings.height ?? 0,
          frameRate: settings.frameRate ?? 0,
          label: track?.label ?? "unknown camera",
        });
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "NotAllowedError") {
          setStatus("denied");
        } else {
          setStatus("error");
        }
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    start();

    return () => {
      cancelled = true;
      streamRef.current = null;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [enabled]);

  return { videoRef, streamRef, status, error, info };
}
