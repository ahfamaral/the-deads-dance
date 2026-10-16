/**
 * Renders the background ("Threshold") into the looping videos phones play instead of the live
 * canvas (2026-10-16: the canvas made phones warm). One breath, encoded as MP4 (H.264), for
 * portrait and landscape, plus a still poster for each. WebM (VP9) came out larger, so there is none.
 *
 *   npx tsx scripts/render-background-video.ts [portrait|landscape]
 *
 * Needs ffmpeg on the PATH. Rerun it after changing src/lib/threshold/scene.ts.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { createScene, LOOP_SECONDS, STILL_TIME } from "../src/lib/threshold/scene";

/** CSS px at 2×: a typical phone, so the glyphs and strands match what the canvas draws there. */
const ORIENTATIONS = {
  portrait: { width: 414, height: 896 },
  landscape: { width: 896, height: 414 },
} as const;
type Orientation = keyof typeof ORIENTATIONS;
const DPR = 2;
const FPS = 30;
/** H.264 quality: higher is smaller and softer. The flickering glyphs are most of the size. */
const CRF = 30;
const OUT_DIR = path.join(process.cwd(), "public", "background");

function ffmpeg(args: string[]) {
  return spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["pipe", "inherit", "inherit"] });
}

function finished(child: ReturnType<typeof spawn>) {
  return new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
  });
}

async function render(orientation: Orientation) {
  const { width, height } = ORIENTATIONS[orientation];
  const pixelWidth = width * DPR;
  const pixelHeight = height * DPR;
  const canvas = createCanvas(pixelWidth, pixelHeight);
  // The scene only uses the 2D API, which @napi-rs/canvas implements.
  const scene = createScene(canvas as unknown as HTMLCanvasElement, {
    viewport: () => ({ width, height, dpr: DPR }),
    createCanvas: () => createCanvas(1, 1) as unknown as HTMLCanvasElement,
  });
  if (!scene) throw new Error("No 2D context");
  const ctx = canvas.getContext("2d");

  // A whole number of frames spans exactly one breath, so the last frame leads straight into the first.
  // Played at exactly FPS, the breath runs a few milliseconds long: invisible, and players prefer a round rate.
  const frames = Math.round(LOOP_SECONDS * FPS);
  const base = path.join(OUT_DIR, orientation);

  const encoder = ffmpeg([
    "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${pixelWidth}x${pixelHeight}`, "-r", String(FPS), "-i", "-",
    "-c:v", "libx264", "-preset", "slow", "-tune", "animation", "-crf", String(CRF), "-pix_fmt", "yuv420p", "-movflags", "+faststart", `${base}.mp4`,
  ]);
  const done = finished(encoder);

  // The poster is the still frame, where the video starts, so it plays on without a jump.
  scene.render(STILL_TIME);
  const still = Buffer.from(ctx.getImageData(0, 0, pixelWidth, pixelHeight).data.buffer);
  const poster = ffmpeg(["-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${pixelWidth}x${pixelHeight}`, "-i", "-", "-frames:v", "1", "-q:v", "4", `${base}.jpg`]);
  poster.stdin!.end(still);
  await finished(poster);

  for (let i = 0; i < frames; i += 1) {
    scene.render((i / frames) * LOOP_SECONDS);
    const pixels = Buffer.from(ctx.getImageData(0, 0, pixelWidth, pixelHeight).data.buffer);
    if (!encoder.stdin!.write(pixels)) {
      await new Promise((resolve) => encoder.stdin!.once("drain", resolve));
    }
    if (i % FPS === 0) process.stdout.write(`\r${orientation}: ${Math.round((i / frames) * 100)}%`);
  }
  encoder.stdin!.end();
  await done;
  process.stdout.write(`\r${orientation}: done (${frames} frames)\n`);
}

async function main() {
  const only = process.argv[2] as Orientation | undefined;
  if (only && !(only in ORIENTATIONS)) throw new Error(`Unknown orientation: ${only}`);
  mkdirSync(OUT_DIR, { recursive: true });
  for (const orientation of only ? [only] : (Object.keys(ORIENTATIONS) as Orientation[])) {
    await render(orientation);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
