// Copies the MediaPipe Tasks wasm runtime and downloads the three models used for badge
// placement (face, pose, hands) into public/mediapipe, so detection runs fully locally.
import { copyFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'mediapipe');
const wasmSrc = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const MODELS = {
  'blaze_face_short_range.tflite':
    'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
  'pose_landmarker_lite.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  'hand_landmarker.task': 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
};

const exists = (p) => stat(p).then(() => true, () => false);

await mkdir(path.join(out, 'wasm'), { recursive: true });
for (const file of await readdir(wasmSrc)) await copyFile(path.join(wasmSrc, file), path.join(out, 'wasm', file));
for (const [file, url] of Object.entries(MODELS)) {
  const dest = path.join(out, file);
  if (await exists(dest)) continue;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`downloaded ${file}`);
}
console.log(`MediaPipe ready in ${path.relative(process.cwd(), out)}`);
