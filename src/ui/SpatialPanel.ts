import * as THREE from 'three';
import { InteractiveCallbacks } from '../core/InputManager';

export interface SpatialButtonOptions {
  width: number;
  height: number;
  label: string;
  subLabel?: string;
  bgColor?: string;
  borderColor?: string;
  accentColor?: string;
  textColor?: string;
  fontSize?: number;
  gazeEnabled?: boolean;
  gazeDwellSeconds?: number;
  onSelect?: () => void;
}

export class SpatialButton {
  public readonly mesh: THREE.Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly options: Required<Omit<SpatialButtonOptions, 'onSelect'>> & {
    onSelect?: () => void;
  };

  private hovered = false;
  private active = false;
  private gazeProgress = 0;

  constructor(opts: SpatialButtonOptions) {
    this.options = {
      width: opts.width,
      height: opts.height,
      label: opts.label,
      subLabel: opts.subLabel ?? '',
      bgColor: opts.bgColor ?? '#0f172a',
      borderColor: opts.borderColor ?? '#38bdf8',
      accentColor: opts.accentColor ?? '#38bdf8',
      textColor: opts.textColor ?? '#f8fafc',
      fontSize: opts.fontSize ?? 36,
      gazeEnabled: opts.gazeEnabled ?? true,
      gazeDwellSeconds: opts.gazeDwellSeconds ?? 0.85,
      onSelect: opts.onSelect
    };

    const pxScale = 512;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(256, Math.round(this.options.width * pxScale));
    this.canvas.height = Math.max(128, Math.round(this.options.height * pxScale));

    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not initialize 2D canvas context for SpatialButton');
    }
    this.ctx = ctx;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    const geo = new THREE.PlaneGeometry(this.options.width, this.options.height);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      side: THREE.DoubleSide
    });
    this.mesh = new THREE.Mesh(geo, mat);

    const callbacks: InteractiveCallbacks = {
      gazeEnabled: this.options.gazeEnabled,
      gazeDwellSeconds: this.options.gazeDwellSeconds,
      onHover: () => {
        this.hovered = true;
        this.mesh.scale.setScalar(1.035);
        this.redraw();
      },
      onBlur: () => {
        this.hovered = false;
        this.gazeProgress = 0;
        this.mesh.scale.setScalar(1.0);
        this.redraw();
      },
      onGazeProgress: (_obj, progress) => {
        this.gazeProgress = progress;
        this.redraw();
      },
      onSelect: () => {
        this.options.onSelect?.();
      }
    };
    this.mesh.userData = callbacks;
    this.redraw();
  }

  public setLabel(label: string, subLabel?: string): void {
    this.options.label = label;
    if (subLabel !== undefined) {
      this.options.subLabel = subLabel;
    }
    this.redraw();
  }

  public setActive(active: boolean): void {
    this.active = active;
    this.redraw();
  }

  public setColors(bgColor: string, borderColor: string, accentColor?: string): void {
    this.options.bgColor = bgColor;
    this.options.borderColor = borderColor;
    if (accentColor) this.options.accentColor = accentColor;
    this.redraw();
  }

  public setOnSelect(fn: () => void): void {
    this.options.onSelect = fn;
  }

  public redraw(): void {
    const { ctx, canvas, options } = this;
    const w = canvas.width;
    const h = canvas.height;
    const radius = Math.min(w, h) * 0.14;

    ctx.clearRect(0, 0, w, h);

    ctx.save();
    this.roundRectPath(ctx, 4, 4, w - 8, h - 8, radius);
    ctx.fillStyle = this.hovered
      ? '#1e293b'
      : this.active
        ? '#172554'
        : options.bgColor;
    ctx.globalAlpha = 0.92;
    ctx.fill();

    ctx.globalAlpha = 1.0;
    ctx.lineWidth = this.hovered || this.active ? 7 : 3.5;
    ctx.strokeStyle = this.hovered || this.active ? options.accentColor : options.borderColor;
    ctx.stroke();

    // Gaze dwell fill bar at bottom edge
    if (this.gazeProgress > 0.01) {
      ctx.save();
      this.roundRectPath(ctx, 4, 4, w - 8, h - 8, radius);
      ctx.clip();
      ctx.fillStyle = options.accentColor;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(0, h - 14, w * this.gazeProgress, 14);
      ctx.restore();
    }

    // Text
    ctx.fillStyle = options.textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (options.subLabel) {
      ctx.font = `bold ${options.fontSize}px "Segoe UI", "Hiragino Sans", sans-serif`;
      ctx.fillText(options.label, w / 2, h * 0.39, w - 36);

      ctx.fillStyle = '#94a3b8';
      ctx.font = `${Math.round(options.fontSize * 0.62)}px "Segoe UI", "Hiragino Sans", sans-serif`;
      ctx.fillText(options.subLabel, w / 2, h * 0.68, w - 36);
    } else {
      ctx.font = `bold ${options.fontSize}px "Segoe UI", "Hiragino Sans", sans-serif`;
      ctx.fillText(options.label, w / 2, h / 2, w - 36);
    }

    ctx.restore();
    this.texture.needsUpdate = true;
  }

  private roundRectPath(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.texture.dispose();
  }
}

export class SpatialTextPanel {
  public readonly mesh: THREE.Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;

  constructor(width: number, height: number, pxWidth = 1024, pxHeight = 512) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = pxWidth;
    this.canvas.height = pxHeight;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not initialize 2D canvas context for SpatialTextPanel');
    }
    this.ctx = ctx;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    const geo = new THREE.PlaneGeometry(width, height);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      side: THREE.DoubleSide
    });
    this.mesh = new THREE.Mesh(geo, mat);
  }

  public draw(painter: (ctx: CanvasRenderingContext2D, width: number, height: number) => void): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    painter(this.ctx, this.canvas.width, this.canvas.height);
    this.texture.needsUpdate = true;
  }

  public drawRoundedBg(
    bgColor = 'rgba(15, 23, 42, 0.88)',
    borderColor = 'rgba(56, 189, 248, 0.5)',
    radius = 28
  ): void {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(radius + 4, 4);
    ctx.lineTo(w - radius - 4, 4);
    ctx.quadraticCurveTo(w - 4, 4, w - 4, radius + 4);
    ctx.lineTo(w - 4, h - radius - 4);
    ctx.quadraticCurveTo(w - 4, h - 4, w - radius - 4, h - 4);
    ctx.lineTo(radius + 4, h - 4);
    ctx.quadraticCurveTo(4, h - 4, 4, h - radius - 4);
    ctx.lineTo(4, radius + 4);
    ctx.quadraticCurveTo(4, 4, radius + 4, 4);
    ctx.closePath();

    ctx.fillStyle = bgColor;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = borderColor;
    ctx.stroke();
    ctx.restore();
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.texture.dispose();
  }
}
