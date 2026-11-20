import * as THREE from 'three';
import { Difficulty, TrainingModeId } from '../core/StorageManager';

export interface TrainingHUDState {
  title: string;
  instruction: string;
  score: number;
  accuracy: number;
  remainingSeconds: number;
  metricLabel: string;
}

export interface TrainingResult {
  modeId: TrainingModeId;
  score: number;
  accuracy: number;
  durationSec: number;
  summary: string;
}

export interface ITrainingMode {
  readonly id: TrainingModeId;
  readonly name: string;
  readonly description: string;
  readonly group: THREE.Group;

  start(difficulty: Difficulty, headPos: THREE.Vector3, headQuat: THREE.Quaternion): void;
  stop(): TrainingResult;
  update(dt: number, elapsed: number, headPos: THREE.Vector3, headQuat: THREE.Quaternion): boolean;
  getInteractiveObjects(): THREE.Object3D[];
  onObjectSelected(obj: THREE.Object3D): void;
  getHUDState(): TrainingHUDState;
}
