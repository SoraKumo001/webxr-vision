export type TrainingModeId =
  | 'focus-stretch'
  | 'peripheral'
  | 'gabor-patch'
  | 'binocular'
  | 'aquatic-relax';

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface SessionRecord {
  modeId: TrainingModeId;
  score: number;
  accuracy: number;
  durationSec: number;
  difficulty: Difficulty;
  timestamp: number;
}

export interface ModeStats {
  playCount: number;
  highScore: number;
  bestAccuracy: number;
  totalSeconds: number;
  lastPlayedAt: number | null;
}

export interface VisionStats {
  totalSeconds: number;
  modes: Record<TrainingModeId, ModeStats>;
  history: SessionRecord[];
}

const STORAGE_KEY = 'webxr_vision_stats_v1';

function createDefaultModeStats(): ModeStats {
  return {
    playCount: 0,
    highScore: 0,
    bestAccuracy: 0,
    totalSeconds: 0,
    lastPlayedAt: null
  };
}

function createDefaultStats(): VisionStats {
  return {
    totalSeconds: 0,
    modes: {
      'focus-stretch': createDefaultModeStats(),
      peripheral: createDefaultModeStats(),
      'gabor-patch': createDefaultModeStats(),
      binocular: createDefaultModeStats(),
      'aquatic-relax': createDefaultModeStats()
    },
    history: []
  };
}

export class StorageManager {
  private stats: VisionStats;

  constructor() {
    this.stats = this.load();
  }

  private load(): VisionStats {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return createDefaultStats();
      const parsed = JSON.parse(raw) as Partial<VisionStats>;
      const defaults = createDefaultStats();
      return {
        totalSeconds: typeof parsed.totalSeconds === 'number' ? parsed.totalSeconds : 0,
        modes: {
          'focus-stretch': { ...defaults.modes['focus-stretch'], ...parsed.modes?.['focus-stretch'] },
          peripheral: { ...defaults.modes.peripheral, ...parsed.modes?.peripheral },
          'gabor-patch': { ...defaults.modes['gabor-patch'], ...parsed.modes?.['gabor-patch'] },
          binocular: { ...defaults.modes.binocular, ...parsed.modes?.binocular },
          'aquatic-relax': { ...defaults.modes['aquatic-relax'], ...parsed.modes?.['aquatic-relax'] }
        },
        history: Array.isArray(parsed.history) ? parsed.history.slice(0, 50) : []
      };
    } catch {
      return createDefaultStats();
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.stats));
    } catch {
      // Ignore storage quota or private mode failures.
    }
  }

  public recordSession(
    modeId: TrainingModeId,
    score: number,
    accuracy: number,
    durationSec: number,
    difficulty: Difficulty = 'normal'
  ): void {
    const cleanScore = Math.max(0, Math.round(score));
    const cleanAcc = Math.max(0, Math.min(100, Math.round(accuracy)));
    const cleanDur = Math.max(0, Math.round(durationSec));
    const now = Date.now();

    const modeStats = this.stats.modes[modeId];
    modeStats.playCount += 1;
    modeStats.highScore = Math.max(modeStats.highScore, cleanScore);
    modeStats.bestAccuracy = Math.max(modeStats.bestAccuracy, cleanAcc);
    modeStats.totalSeconds += cleanDur;
    modeStats.lastPlayedAt = now;

    this.stats.totalSeconds += cleanDur;
    this.stats.history.unshift({
      modeId,
      score: cleanScore,
      accuracy: cleanAcc,
      durationSec: cleanDur,
      difficulty,
      timestamp: now
    });
    if (this.stats.history.length > 50) {
      this.stats.history.length = 50;
    }

    this.save();
  }

  public getStats(): VisionStats {
    return this.stats;
  }

  public getModeStats(modeId: TrainingModeId): ModeStats {
    return this.stats.modes[modeId];
  }

  public resetStats(): void {
    this.stats = createDefaultStats();
    this.save();
  }
}
