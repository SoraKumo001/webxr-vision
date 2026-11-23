import * as THREE from 'three';
import { AudioManager } from '../core/AudioManager';
import { SpatialButton } from '../ui/SpatialPanel';

export interface ModeUiChromeOptions {
  showButtonPosition?: THREE.Vector3;
}

/**
 * Shared UI chrome hide/show for stretch modes.
 * Hide is triggered from DashboardHUD; this only keeps the "UI表示" restore button
 * (visible while chrome is hidden) and toggles registered chrome objects.
 */
export class ModeUiChrome {
  public readonly showBtn: SpatialButton;
  public onChange?: (hidden: boolean) => void;

  private hidden = false;
  private chrome: THREE.Object3D[] = [];
  private readonly audio: AudioManager;

  constructor(arena: THREE.Group, audio: AudioManager, opts: ModeUiChromeOptions = {}) {
    this.audio = audio;

    const showPos = opts.showButtonPosition ?? new THREE.Vector3(0, -0.85, -1.7);

    this.showBtn = new SpatialButton({
      width: 0.28,
      height: 0.1,
      label: 'UI表示',
      fontSize: 26,
      bgColor: '#06121c',
      borderColor: '#38bdf8',
      accentColor: '#38bdf8',
      gazeDwellSeconds: 0.75,
      onSelect: () => {
        this.setHidden(false);
        this.audio.playSelect();
      }
    });
    this.showBtn.mesh.position.copy(showPos);
    this.showBtn.mesh.visible = false;
    arena.add(this.showBtn.mesh);
  }

  public setChrome(objects: THREE.Object3D[]): void {
    this.chrome = objects;
  }

  public isHidden(): boolean {
    return this.hidden;
  }

  public setHidden(hidden: boolean): void {
    this.hidden = hidden;
    for (const obj of this.chrome) {
      obj.visible = !hidden;
    }
    this.showBtn.mesh.visible = hidden;
    this.onChange?.(hidden);
  }

  public appendInteractives(out: THREE.Object3D[]): void {
    if (this.hidden) {
      out.push(this.showBtn.mesh);
    }
  }
}
