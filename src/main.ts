import { App } from './core/App';

const canvas = document.getElementById('app-canvas') as HTMLCanvasElement | null;
if (!canvas) {
  throw new Error('Missing #app-canvas element');
}

new App(canvas);
