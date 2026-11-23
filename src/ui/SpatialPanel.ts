import * as THREE from 'three';
import { InteractiveCallbacks } from '../core/InputManager';
import { canvasFont, theme } from './theme';

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
  private readonly logicalWidth: number;
  private readonly logicalHeight: number;
  private readonly resScale: number;
  private readonly options: Required<Omit<SpatialButtonOptions, 'onSelect'>> & {
    onSelect?: () => void;
  };

  private hovered = false;
  private active = false;
  private pressed = false;
  private gazeProgress = 0;

  constructor(opts: SpatialButtonOptions) {
    this.options = {
      width: opts.width,
      height: opts.height,
      label: opts.label,
      subLabel: opts.subLabel ?? '',
      bgColor: opts.bgColor ?? theme.inkPanelSolid,
      borderColor: opts.borderColor ?? theme.borderSubtle,
      accentColor: opts.accentColor ?? theme.seafoam,
      textColor: opts.textColor ?? theme.text,
      fontSize: opts.fontSize ?? 36,
      gazeEnabled: opts.gazeEnabled ?? true,
      gazeDwellSeconds: opts.gazeDwellSeconds ?? 0.85,
      onSelect: opts.onSelect
    };

    const pxScale = 512;
    this.logicalWidth = Math.round(this.options.width * pxScale);
    this.logicalHeight = Math.round(this.options.height * pxScale);
    this.resScale = Math.max(1, 256 / this.logicalWidth, 128 / this.logicalHeight);
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(this.logicalWidth * this.resScale);
    this.canvas.height = Math.round(this.logicalHeight * this.resScale);

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
        this.mesh.scale.setScalar(1.04);
        this.redraw();
      },
      onBlur: () => {
        this.hovered = false;
        this.pressed = false;
        this.gazeProgress = 0;
        this.mesh.scale.setScalar(1.0);
        this.redraw();
      },
      onGazeProgress: (_obj, progress) => {
        this.gazeProgress = progress;
        this.redraw();
      },
      onSelect: () => {
        this.pressed = true;
        this.mesh.scale.setScalar(0.97);
        this.redraw();
        this.options.onSelect?.();
        window.setTimeout(() => {
          this.pressed = false;
          if (this.hovered) this.mesh.scale.setScalar(1.04);
          else this.mesh.scale.setScalar(1.0);
          this.redraw();
        }, 120);
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
    const w = this.logicalWidth;
    const h = this.logicalHeight;
    const radius = Math.min(w, h) * 0.18;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.scale(this.resScale, this.resScale);
    this.roundRectPath(ctx, 4, 4, w - 8, h - 8, radius);

    let fill = options.bgColor;
    if (this.pressed) fill = theme.inkActive;
    else if (this.active) fill = theme.inkActive;
    else if (this.hovered) fill = theme.inkHover;
    ctx.fillStyle = fill;
    ctx.globalAlpha = 0.9;
    ctx.fill();

    ctx.globalAlpha = 1.0;
    ctx.lineWidth = this.hovered || this.active || this.pressed ? 6 : 3;
    ctx.strokeStyle =
      this.hovered || this.active || this.pressed ? options.accentColor : options.borderColor;
    ctx.stroke();

    if (this.gazeProgress > 0.01) {
      ctx.save();
      this.roundRectPath(ctx, 4, 4, w - 8, h - 8, radius);
      ctx.clip();
      ctx.fillStyle = options.accentColor;
      ctx.globalAlpha = 0.32;
      ctx.fillRect(0, h - 12, w * this.gazeProgress, 12);
      ctx.restore();
    }

    ctx.fillStyle = options.textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (options.subLabel) {
      const titleSize = options.fontSize;
      const subSize = Math.round(options.fontSize * 0.62);
      const lineGap = Math.max(14, Math.round(h * 0.1));
      const block = titleSize + lineGap + subSize;
      const top = Math.max(8, (h - block) / 2);
      ctx.font = `600 ${titleSize}px ${canvasFont}`;
      ctx.fillText(options.label, w / 2, top + titleSize / 2, w - 36);

      ctx.fillStyle = theme.textMuted;
      ctx.font = `500 ${subSize}px ${canvasFont}`;
      ctx.fillText(options.subLabel, w / 2, top + titleSize + lineGap + subSize / 2, w - 36);
    } else {
      ctx.font = `600 ${options.fontSize}px ${canvasFont}`;
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
    bgColor: string = theme.inkPanel,
    borderColor: string = theme.borderSubtle,
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
    ctx.lineWidth = 3.5;
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

export function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = 2
): string[] {
  const words = text.split('');
  const lines: string[] = [];
  let current = '';
  for (const ch of words) {
    const next = current + ch;
    if (ctx.measureText(next).width > maxWidth && current) {
      lines.push(current);
      current = ch;
      if (lines.length >= maxLines) break;
    } else {
      current = next;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    if (ctx.measureText(last).width > maxWidth || text.length > lines.join('').length) {
      let trimmed = last;
      while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
        trimmed = trimmed.slice(0, -1);
      }
      lines[maxLines - 1] = `${trimmed}…`;
    }
  }
  return lines;
}
