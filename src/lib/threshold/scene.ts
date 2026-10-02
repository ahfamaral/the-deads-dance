/**
 * "Threshold": a dark field split by a vertical light seam.
 *
 * Left of the seam, laminar filaments carry a field of monospace glyphs and
 * converge into the light. Right of it, the same strands re-emerge as a smooth
 * woven ribbon that fans outward. The whole composition breathes between a
 * tight pinch and a broad spread on a slow eased cycle.
 */

const BASE = "#050507";

const SEAM_X = 0.5;

const LEFT_STRANDS = 44;
const RIGHT_STRANDS = 68;
const SAMPLES = 72;

/** Breathing cycle: how wide the fan opens, and how slowly. */
const SPREAD_MIN = 0.3;
const SPREAD_MAX = 0.86;
const BREATH_SPEED = 0.16;
/** Right side lags the left so the two never pulse in lockstep. */
const BREATH_OFFSET = 1.1;

const GLYPH_CELL = 22;
const GLYPH_CHARS = "aa?5$:-=+~<>|/\\_·";
/** Fraction of glyph cells that re-roll their character each second. */
const GLYPH_CHURN = 2.6;

const WARM: [number, number, number] = [255, 176, 92];
const COOL: [number, number, number] = [104, 176, 255];

const SPARKLES = 220;
const MAX_DPR = 2;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (t: number) => t * t * (3 - 2 * t);

/** Deterministic per-index noise, so the field is stable across frames. */
function hash(n: number) {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Chromatic split across the bundle: amber at the top edge, blue at the
 * bottom, white through the middle.
 */
function strandColor(s: number, alpha: number) {
  const tint = s < 0 ? WARM : COOL;
  const mix = Math.abs(s) ** 1.35;
  const r = Math.round(lerp(255, tint[0], mix));
  const g = Math.round(lerp(255, tint[1], mix));
  const b = Math.round(lerp(255, tint[2], mix));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

type Sparkle = { x: number; y: number; phase: number; size: number };

export type Scene = {
  resize: () => void;
  render: (time: number) => void;
};

export function createScene(canvas: HTMLCanvasElement): Scene | null {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return null;

  let width = 0;
  let height = 0;
  let seamX = 0;
  let midY = 0;

  let glyphCols = 0;
  let glyphRows = 0;
  let glyphs = new Uint8Array(0);
  let sparkles: Sparkle[] = [];

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    width = window.innerWidth;
    height = window.innerHeight;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    seamX = width * SEAM_X;
    midY = height * 0.5;

    glyphCols = Math.ceil(seamX / GLYPH_CELL);
    glyphRows = Math.ceil(height / GLYPH_CELL);
    glyphs = new Uint8Array(glyphCols * glyphRows);
    for (let i = 0; i < glyphs.length; i += 1) {
      glyphs[i] = Math.floor(hash(i) * GLYPH_CHARS.length);
    }

    sparkles = Array.from({ length: SPARKLES }, (_, i) => ({
      x: hash(i * 3.1) * width,
      y: midY + (hash(i * 7.7) - 0.5) * height * 0.72,
      phase: hash(i * 11.3) * Math.PI * 2,
      size: 0.6 + hash(i * 5.2) * 1.1,
    }));
  };

  /** Half-thickness of the bundle at normalised distance d from the seam. */
  const envelope = (d: number, spread: number, exponent: number) =>
    d ** exponent * spread * height * 0.46;

  /** Left side: near-laminar filaments drawn into the seam. */
  const drawStreams = (time: number, spread: number) => {
    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = 1.1;

    for (let i = 0; i < LEFT_STRANDS; i += 1) {
      const s = (i / (LEFT_STRANDS - 1)) * 2 - 1;
      const phase = hash(i * 2.3) * Math.PI * 2;
      const drift = 0.06 + hash(i * 4.9) * 0.05;

      ctx.beginPath();
      for (let j = 0; j <= SAMPLES; j += 1) {
        const d = j / SAMPLES;
        const x = seamX - d * seamX;
        const env = envelope(d, spread, 0.72);
        const wave = Math.sin(d * 3.1 + phase - time * 0.5) * env * drift;
        const y = midY + s * env + wave;
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      const fade = 0.16 + 0.26 * (1 - Math.abs(s));
      ctx.strokeStyle = strandColor(s, fade);
      ctx.stroke();
    }

    ctx.globalCompositeOperation = "source-over";
  };

  /** The data field riding on the left-hand strands. */
  const drawGlyphs = (time: number, spread: number) => {
    // Re-roll a slice of the field each frame for a live, flickering read.
    const churn = Math.max(1, Math.round((glyphs.length * GLYPH_CHURN) / 60));
    for (let i = 0; i < churn; i += 1) {
      const cell = Math.floor(Math.random() * glyphs.length);
      glyphs[cell] = Math.floor(Math.random() * GLYPH_CHARS.length);
    }

    ctx.font = `${GLYPH_CELL - 8}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";

    for (let col = 0; col < glyphCols; col += 1) {
      const x = seamX - col * GLYPH_CELL - GLYPH_CELL * 0.5;
      const d = (seamX - x) / seamX;
      const env = envelope(d, spread, 0.72);
      // Densest against the seam, thinning out toward the left edge.
      const reach = (1 - d) ** 1.25;

      for (let row = 0; row < glyphRows; row += 1) {
        const y = row * GLYPH_CELL + GLYPH_CELL * 0.5;
        const inside = 1 - Math.min(1, Math.abs(y - midY) / Math.max(env, 1));
        if (inside <= 0) continue;

        const cell = col * glyphRows + row;
        const flicker = 0.35 + 0.65 * hash(cell + Math.floor(time * 3));
        const alpha = inside ** 1.6 * reach * flicker * 0.85;
        if (alpha < 0.035) continue;

        const s = (y - midY) / Math.max(env, 1);
        ctx.fillStyle = strandColor(Math.max(-1, Math.min(1, s)), alpha);
        ctx.fillText(GLYPH_CHARS[glyphs[cell]], x, y);
      }
    }
  };

  /** Right side: strands re-woven into a fanning ribbon. */
  const drawRibbon = (time: number, spread: number) => {
    const span = width - seamX;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = 0.85;

    for (let i = 0; i < RIGHT_STRANDS; i += 1) {
      const s = (i / (RIGHT_STRANDS - 1)) * 2 - 1;

      ctx.beginPath();
      for (let j = 0; j <= SAMPLES; j += 1) {
        const d = j / SAMPLES;
        const x = seamX + d * span;
        const env = envelope(d, spread, 0.85);
        // Two out-of-phase families; where they cross, the weave appears.
        const weave =
          Math.sin(d * 4.4 + s * Math.PI * 1.35 - time * 0.42) * 0.42 +
          Math.sin(d * 2.1 - s * Math.PI * 0.6 + time * 0.23) * 0.2;
        const y = midY + env * (s * 0.72 + weave) + Math.sin(time * 0.13) * 6;
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      ctx.strokeStyle = `rgba(255, 255, 255, ${0.1 + 0.14 * (1 - Math.abs(s))})`;
      ctx.stroke();
    }

    ctx.globalCompositeOperation = "source-over";
  };

  const drawSparkles = (time: number) => {
    ctx.globalCompositeOperation = "lighter";
    for (const sparkle of sparkles) {
      const twinkle = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * 1.7 + sparkle.phase));
      ctx.fillStyle = `rgba(255, 255, 255, ${twinkle * 0.5})`;
      ctx.beginPath();
      ctx.arc(sparkle.x, sparkle.y, sparkle.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  };

  /** The seam itself: broad halo, tight bar, and a dark hairline core. */
  const drawSeam = (time: number, spread: number) => {
    const pulse = 0.85 + 0.15 * Math.sin(time * 0.6);
    // A tighter pinch concentrates the same energy into a brighter seam.
    const intensity = pulse * lerp(1.15, 0.8, smoothstep(spread));

    ctx.globalCompositeOperation = "lighter";

    const halo = ctx.createRadialGradient(seamX, midY, 0, seamX, midY, height * 1.15);
    halo.addColorStop(0, `rgba(255, 255, 255, ${0.42 * intensity})`);
    halo.addColorStop(0.32, `rgba(215, 230, 255, ${0.12 * intensity})`);
    halo.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, width, height);

    const barWidth = 26 * intensity;
    const bar = ctx.createLinearGradient(seamX - barWidth, 0, seamX + barWidth, 0);
    bar.addColorStop(0, "rgba(255, 255, 255, 0)");
    bar.addColorStop(0.5, `rgba(255, 255, 255, ${0.9 * intensity})`);
    bar.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = bar;

    // Brightest at the waist, falling away toward the top and bottom edges.
    const falloff = ctx.createLinearGradient(0, 0, 0, height);
    falloff.addColorStop(0, "rgba(0, 0, 0, 0)");
    falloff.addColorStop(0.5, "rgba(0, 0, 0, 1)");
    falloff.addColorStop(1, "rgba(0, 0, 0, 0)");

    ctx.save();
    ctx.beginPath();
    ctx.rect(seamX - barWidth, 0, barWidth * 2, height);
    ctx.clip();
    ctx.fillRect(seamX - barWidth, 0, barWidth * 2, height);
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = falloff;
    ctx.fillRect(seamX - barWidth, 0, barWidth * 2, height);
    ctx.restore();

    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(seamX - 0.75, 0, 1.5, height);
  };

  const drawVignette = () => {
    const vignette = ctx.createRadialGradient(
      seamX, midY, Math.min(width, height) * 0.2,
      seamX, midY, Math.max(width, height) * 0.8,
    );
    vignette.addColorStop(0, "rgba(5, 5, 7, 0)");
    vignette.addColorStop(1, "rgba(5, 5, 7, 0.9)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  };

  const render = (time: number) => {
    const breath = smoothstep(0.5 + 0.5 * Math.sin(time * BREATH_SPEED));
    const spread = lerp(SPREAD_MIN, SPREAD_MAX, breath);

    const breathRight = smoothstep(
      0.5 + 0.5 * Math.sin(time * BREATH_SPEED + BREATH_OFFSET),
    );
    const spreadRight = lerp(SPREAD_MIN, SPREAD_MAX, breathRight);

    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = BASE;
    ctx.fillRect(0, 0, width, height);

    drawStreams(time, spread);
    drawGlyphs(time, spread);
    drawRibbon(time, spreadRight);
    drawSparkles(time);
    drawSeam(time, spread);
    drawVignette();
  };

  resize();
  return { resize, render };
}
