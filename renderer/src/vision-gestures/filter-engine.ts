import type { FilterId, ScreenPoint } from './types';

interface RenderParams {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  filter: FilterId;
  pointer: ScreenPoint | null;
  timeMs: number;
}

const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function ensureCanvasSize(canvas: HTMLCanvasElement, width: number, height: number): void {
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function getContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!context) {
    throw new Error('Unable to create 2D canvas context.');
  }
  return context;
}

function drawMirroredVideo(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  width: number,
  height: number,
  dx = 0,
  dy = 0,
): void {
  ctx.save();
  ctx.translate(width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, dx, dy, width, height);
  ctx.restore();
}

export class GestureFilterEngine {
  private previousFilter: FilterId = 'none';
  private activeFilter: FilterId = 'none';
  private changedAt = 0;
  private readonly transitionMs = 260;
  private readonly previousCanvas = document.createElement('canvas');
  private readonly activeCanvas = document.createElement('canvas');
  private readonly scratchCanvas = document.createElement('canvas');
  private readonly sampleCanvas = document.createElement('canvas');

  render(params: RenderParams): void {
    const width = Math.max(2, params.video.videoWidth || params.canvas.clientWidth || 1280);
    const height = Math.max(2, params.video.videoHeight || params.canvas.clientHeight || 720);
    ensureCanvasSize(params.canvas, width, height);
    ensureCanvasSize(this.previousCanvas, width, height);
    ensureCanvasSize(this.activeCanvas, width, height);
    ensureCanvasSize(this.scratchCanvas, width, height);

    if (params.filter !== this.activeFilter) {
      this.previousFilter = this.activeFilter;
      this.activeFilter = params.filter;
      this.changedAt = params.timeMs;
    }

    const target = getContext(params.canvas);
    const activeContext = getContext(this.activeCanvas);
    this.renderEffect(activeContext, params.video, width, height, this.activeFilter, params.pointer, params.timeMs);

    const elapsed = params.timeMs - this.changedAt;
    const transition = this.changedAt > 0 ? clamp(elapsed / this.transitionMs) : 1;

    if (transition < 1 && this.previousFilter !== this.activeFilter) {
      const previousContext = getContext(this.previousCanvas);
      this.renderEffect(previousContext, params.video, width, height, this.previousFilter, params.pointer, params.timeMs);
      target.clearRect(0, 0, width, height);
      target.globalAlpha = 1;
      target.drawImage(this.previousCanvas, 0, 0);
      target.globalAlpha = transition;
      target.drawImage(this.activeCanvas, 0, 0);
      target.globalAlpha = 1;
      return;
    }

    target.globalAlpha = 1;
    target.drawImage(this.activeCanvas, 0, 0);
  }

  dispose(): void {
    this.previousCanvas.width = 0;
    this.activeCanvas.width = 0;
    this.scratchCanvas.width = 0;
    this.sampleCanvas.width = 0;
  }

  private renderEffect(
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement,
    width: number,
    height: number,
    filter: FilterId,
    pointer: ScreenPoint | null,
    timeMs: number,
  ): void {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    switch (filter) {
      case 'dither':
        this.renderDither(ctx, video, width, height, timeMs);
        break;
      case 'vhs':
        this.renderVhs(ctx, video, width, height, timeMs);
        break;
      case 'spotlight':
        this.renderSpotlight(ctx, video, width, height, pointer, timeMs);
        break;
      case 'water_ripple':
        this.renderWaterRipple(ctx, video, width, height, pointer, timeMs);
        break;
      case 'none':
      default:
        drawMirroredVideo(ctx, video, width, height);
        break;
    }

    ctx.restore();
  }

  private renderDither(
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement,
    width: number,
    height: number,
    timeMs: number,
  ): void {
    const sampleWidth = Math.max(180, Math.round(width / 4));
    const sampleHeight = Math.max(100, Math.round(height / 4));
    ensureCanvasSize(this.sampleCanvas, sampleWidth, sampleHeight);
    const sampleContext = getContext(this.sampleCanvas);
    sampleContext.clearRect(0, 0, sampleWidth, sampleHeight);
    drawMirroredVideo(sampleContext, video, sampleWidth, sampleHeight);
    const image = sampleContext.getImageData(0, 0, sampleWidth, sampleHeight);
    const data = image.data;
    const cellWidth = width / sampleWidth;
    const cellHeight = height / sampleHeight;
    const phase = Math.sin(timeMs * 0.004) * 7;

    ctx.fillStyle = '#050708';
    ctx.fillRect(0, 0, width, height);

    for (let y = 0; y < sampleHeight; y += 1) {
      for (let x = 0; x < sampleWidth; x += 1) {
        const index = (y * sampleWidth + x) * 4;
        const luma = data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
        const threshold = (BAYER_4[y % 4][x % 4] / 16) * 255 - 30 + phase;
        const on = luma > threshold;
        ctx.fillStyle = on ? '#eef8f1' : '#0b1215';
        ctx.fillRect(x * cellWidth, y * cellHeight, Math.ceil(cellWidth), Math.ceil(cellHeight));
      }
    }

    ctx.strokeStyle = 'rgba(82, 255, 188, 0.24)';
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, width - 4, height - 4);
  }

  private renderVhs(
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement,
    width: number,
    height: number,
    timeMs: number,
  ): void {
    ctx.filter = 'saturate(1.24) contrast(1.08) brightness(0.95)';
    drawMirroredVideo(ctx, video, width, height);
    ctx.filter = 'none';

    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.14;
    ctx.filter = 'sepia(1) hue-rotate(305deg) saturate(4)';
    drawMirroredVideo(ctx, video, width, height, -4, 0);
    ctx.filter = 'sepia(1) hue-rotate(145deg) saturate(4)';
    drawMirroredVideo(ctx, video, width, height, 4, 0);
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    const tearY = ((timeMs * 0.08) % height) | 0;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, tearY, width, 3);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    for (let y = 0; y < height; y += 4) {
      ctx.fillRect(0, y, width, 1);
    }

    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < 36; i += 1) {
      const x = (Math.sin(timeMs * 0.009 + i * 13.7) * 0.5 + 0.5) * width;
      const y = (Math.cos(timeMs * 0.011 + i * 5.1) * 0.5 + 0.5) * height;
      ctx.fillRect(x, y, 1.5, 1.5);
    }
  }

  private renderSpotlight(
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement,
    width: number,
    height: number,
    pointer: ScreenPoint | null,
    timeMs: number,
  ): void {
    drawMirroredVideo(ctx, video, width, height);
    const center = pointer || { x: width / 2, y: height / 2 };
    const pulse = 1 + Math.sin(timeMs * 0.006) * 0.04;
    const radius = Math.max(width, height) * 0.18 * pulse;

    ctx.fillStyle = 'rgba(1, 5, 12, 0.68)';
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'destination-out';
    const cutout = ctx.createRadialGradient(center.x, center.y, radius * 0.1, center.x, center.y, radius);
    cutout.addColorStop(0, 'rgba(0,0,0,0.98)');
    cutout.addColorStop(0.56, 'rgba(0,0,0,0.82)');
    cutout.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cutout;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    const ring = ctx.createRadialGradient(center.x, center.y, radius * 0.74, center.x, center.y, radius * 1.05);
    ring.addColorStop(0, 'rgba(255,255,255,0)');
    ring.addColorStop(0.72, 'rgba(95,210,255,0.42)');
    ring.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = ring;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius * 1.08, 0, Math.PI * 2);
    ctx.fill();
  }

  private renderWaterRipple(
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement,
    width: number,
    height: number,
    pointer: ScreenPoint | null,
    timeMs: number,
  ): void {
    const scratchContext = getContext(this.scratchCanvas);
    scratchContext.clearRect(0, 0, width, height);
    drawMirroredVideo(scratchContext, video, width, height);

    const center = pointer || { x: width / 2, y: height / 2 };
    const sliceHeight = 5;
    ctx.clearRect(0, 0, width, height);

    for (let y = 0; y < height; y += sliceHeight) {
      const dy = y - center.y;
      const proximity = Math.max(0, 1 - Math.abs(dy) / (height * 0.7));
      const shift = Math.sin((y * 0.032) + (timeMs * 0.006)) * (5 + proximity * 18);
      ctx.drawImage(this.scratchCanvas, 0, y, width, sliceHeight, shift, y, width, sliceHeight);
    }

    const gradient = ctx.createRadialGradient(center.x, center.y, 8, center.x, center.y, Math.max(width, height) * 0.42);
    gradient.addColorStop(0, 'rgba(90, 255, 221, 0.26)');
    gradient.addColorStop(0.38, 'rgba(90, 166, 255, 0.11)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(159, 249, 255, 0.32)';
    ctx.lineWidth = 1.5;
    for (let ring = 1; ring <= 3; ring += 1) {
      const radius = ((timeMs * 0.08 + ring * 74) % 240) + 30;
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
