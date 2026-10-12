"use client";

import type { Box } from "@reel/shared";

/**
 * Face, hand and person boxes for badge placement, from MediaPipe Tasks running in the browser
 * on frames pulled from the API. Models and wasm are served locally from /mediapipe
 * (pnpm --filter @reel/web mediapipe).
 */

type Vision = typeof import("@mediapipe/tasks-vision");
interface Detectors {
  face: import("@mediapipe/tasks-vision").FaceDetector;
  pose: import("@mediapipe/tasks-vision").PoseLandmarker;
  hands: import("@mediapipe/tasks-vision").HandLandmarker;
}

let loading: Promise<Detectors> | null = null;

async function detectors(): Promise<Detectors> {
  if (!loading) {
    loading = (async () => {
      const vision: Vision = await import("@mediapipe/tasks-vision");
      const files = await vision.FilesetResolver.forVisionTasks("/mediapipe/wasm");
      const base = (model: string) => ({ modelAssetPath: `/mediapipe/${model}`, delegate: "CPU" as const });
      const [face, pose, hands] = await Promise.all([
        vision.FaceDetector.createFromOptions(files, { baseOptions: base("blaze_face_short_range.tflite"), runningMode: "IMAGE", minDetectionConfidence: 0.4 }),
        vision.PoseLandmarker.createFromOptions(files, { baseOptions: base("pose_landmarker_lite.task"), runningMode: "IMAGE", numPoses: 1 }),
        vision.HandLandmarker.createFromOptions(files, { baseOptions: base("hand_landmarker.task"), runningMode: "IMAGE", numHands: 2 }),
      ]);
      return { face, pose, hands };
    })().catch((error) => {
      loading = null;
      throw new Error(
        `MediaPipe could not start (${error instanceof Error ? error.message : String(error)}). Run "pnpm --filter @reel/web mediapipe" to download the models.`,
      );
    });
  }
  return loading;
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));

/** Bounding box of landmarks, padded by `pad` of its size. */
function landmarkBox(points: Array<{ x: number; y: number; visibility?: number }>, pad: number): Box | null {
  const visible = points.filter((p) => (p.visibility ?? 1) > 0.3);
  if (visible.length < 3) return null;
  const xs = visible.map((p) => p.x);
  const ys = visible.map((p) => p.y);
  const [x1, x2, y1, y2] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const px = (x2 - x1) * pad;
  const py = (y2 - y1) * pad;
  const box = { x: clamp(x1 - px), y: clamp(y1 - py), w: 0, h: 0 };
  box.w = clamp(x2 + px) - box.x;
  box.h = clamp(y2 + py) - box.y;
  return box.w > 0 && box.h > 0 ? box : null;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load frame ${url}`));
    img.src = url;
  });
}

export interface FrameDetections {
  faces: Box[];
  hands: Box[];
  persons: Box[];
}

/** Detections on several frames of a segment, combined (any box on any frame counts). */
export async function detectFrames(urls: string[]): Promise<FrameDetections> {
  const d = await detectors();
  const out: FrameDetections = { faces: [], hands: [], persons: [] };
  for (const url of urls) {
    const img = await loadImage(url);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    for (const det of d.face.detect(img).detections) {
      const b = det.boundingBox;
      if (!b) continue;
      // The face detector box is tight; pad it so hair and chin count as "face".
      const padX = b.width * 0.25;
      const padY = b.height * 0.35;
      const x = clamp((b.originX - padX) / w);
      const y = clamp((b.originY - padY) / h);
      out.faces.push({ x, y, w: clamp((b.originX + b.width + padX) / w) - x, h: clamp((b.originY + b.height + padY) / h) - y });
    }
    for (const landmarks of d.pose.detect(img).landmarks) {
      const box = landmarkBox(landmarks, 0.08);
      if (box) out.persons.push(box);
    }
    for (const landmarks of d.hands.detect(img).landmarks) {
      const box = landmarkBox(landmarks, 0.25);
      if (box) out.hands.push(box);
    }
  }
  return out;
}
