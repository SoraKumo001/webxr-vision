import * as THREE from 'three';

export class AudioManager {
  private ctx: AudioContext | null = null;
  private muted = false;

  private compressor: DynamicsCompressorNode | null = null;
  private dryBus: GainNode | null = null;
  private wetBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private campfireSource: AudioBufferSourceNode | null = null;
  private campfireLfoLow: OscillatorNode | null = null;
  private campfireLfoMid: OscillatorNode | null = null;
  private campfireLfoLowGain: GainNode | null = null;
  private campfireLfoMidGain: GainNode | null = null;
  private campfireLowFilter: BiquadFilterNode | null = null;
  private campfireMidFilter: BiquadFilterNode | null = null;
  private campfireMasterGain: GainNode | null = null;
  private campfireDrySend: GainNode | null = null;
  private campfireWetSend: GainNode | null = null;
  private campfireTargetGain = 0.08;
  private campfireStopTimer: number | null = null;

  public unlock(): void {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.campfireMasterGain) {
      const target = muted ? 0.0001 : this.campfireTargetGain;
      this.campfireMasterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.04);
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  private ensureContextRaw(): AudioContext | null {
    if (!this.ctx) {
      this.unlock();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    if (this.ctx && !this.compressor) {
      this.buildMasterGraph(this.ctx);
    }
    return this.ctx;
  }

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    return this.ensureContextRaw();
  }

  private buildMasterGraph(ctx: AudioContext): void {
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -10;
    compressor.knee.value = 12;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.15;
    compressor.connect(ctx.destination);
    this.compressor = compressor;

    const dryBus = ctx.createGain();
    dryBus.gain.value = 0.88;
    dryBus.connect(compressor);
    this.dryBus = dryBus;

    const wetBus = ctx.createGain();
    wetBus.gain.value = 0.34;
    const reverbFilter = ctx.createBiquadFilter();
    reverbFilter.type = 'lowpass';
    reverbFilter.frequency.value = 3400;

    const convolver = ctx.createConvolver();
    convolver.buffer = this.createReverbIR(ctx, 0.8);
    wetBus.connect(reverbFilter);
    reverbFilter.connect(convolver);
    convolver.connect(compressor);
    this.wetBus = wetBus;

    this.noiseBuffer = this.createWhiteNoiseBuffer(ctx, 1.5);
  }

  private createReverbIR(ctx: AudioContext, durationSec: number): AudioBuffer {
    const length = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        const env = Math.pow(1 - t, 2.8);
        data[i] = (Math.random() * 2 - 1) * env;
      }
    }
    return buffer;
  }

  private createWhiteNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
    const length = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private routeVoice(ctx: AudioContext, sourceOut: AudioNode, wetAmount = 0.25, pan = 0): void {
    const dry = this.dryBus ?? ctx.destination;
    let target: AudioNode = sourceOut;

    if (Math.abs(pan) > 0.02 && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-0.95, Math.min(0.95, pan));
      sourceOut.connect(panner);
      target = panner;
    }

    target.connect(dry);
    if (wetAmount > 0 && this.wetBus) {
      const wetSend = ctx.createGain();
      wetSend.gain.value = wetAmount;
      target.connect(wetSend);
      wetSend.connect(this.wetBus);
    }
  }

  private playNoiseBurst(
    ctx: AudioContext,
    startTime: number,
    duration: number,
    filterType: BiquadFilterType,
    freqStart: number,
    freqEnd: number,
    q: number,
    peakGain: number,
    wetAmount = 0.25,
    pan = 0
  ): void {
    if (!this.noiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const maxOffset = Math.max(0, this.noiseBuffer.duration - duration - 0.02);
    const offset = Math.random() * maxOffset;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freqStart, startTime);
    if (freqEnd !== freqStart) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), startTime + duration);
    }

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + Math.min(0.02, duration * 0.25));
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    src.connect(filter);
    filter.connect(gain);
    this.routeVoice(ctx, gain, wetAmount, pan);
    src.start(startTime, offset, duration + 0.02);
  }

  public playHover(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    [680, 684].forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now);
      osc.frequency.exponentialRampToValueAtTime(f + 160, now + 0.045);

      gain.gain.setValueAtTime(idx === 0 ? 0.024 : 0.016, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);

      osc.connect(gain);
      this.routeVoice(ctx, gain, 0.24);
      osc.start(now);
      osc.stop(now + 0.06);
    });
  }

  public playSelect(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const freqs = [523.25, 659.25];
    freqs.forEach((f, idx) => {
      const t0 = now + idx * 0.045;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, t0);

      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(0.08, t0 + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);

      osc.connect(gain);
      this.routeVoice(ctx, gain, 0.3);
      osc.start(t0);
      osc.stop(t0 + 0.17);
    });
  }

  public playSuccess(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const freqs = [587.33, 739.99, 880.0, 1174.66];
    freqs.forEach((f, idx) => {
      const t0 = now + idx * 0.055;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t0);

      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(idx === 3 ? 0.065 : 0.095, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);

      osc.connect(gain);
      this.routeVoice(ctx, gain, 0.4);
      osc.start(t0);
      osc.stop(t0 + 0.3);
    });
  }

  public playMiss(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(185, now);
    osc.frequency.exponentialRampToValueAtTime(92, now + 0.18);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(420, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.09, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);

    osc.connect(filter);
    filter.connect(gain);
    this.routeVoice(ctx, gain, 0.18);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  public playSliceSwing(intensity = 0.7, pan = 0): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const clamped = Math.max(0.3, Math.min(1.0, intensity));
    this.playNoiseBurst(
      ctx,
      now,
      0.13,
      'bandpass',
      480 + clamped * 260,
      1450 + clamped * 650,
      2.1,
      0.065 * clamped,
      0.22,
      pan
    );
  }

  public playSliceHit(combo: number, isGold = false, pan = 0): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const pentatonic = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51];
    const step = Math.min(pentatonic.length - 1, Math.max(0, combo - 1));
    const baseFreq = pentatonic[step] * (isGold ? 1.25 : 1.0);

    // 1. Sub punch for physical impact
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(155, now);
    sub.frequency.exponentialRampToValueAtTime(52, now + 0.085);
    subGain.gain.setValueAtTime(0.16, now);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.095);
    sub.connect(subGain);
    this.routeVoice(ctx, subGain, 0.1, pan);
    sub.start(now);
    sub.stop(now + 0.1);

    // 2. Crisp crystalline slash tone
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(baseFreq * 1.4, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq, now + 0.08);
    gain.gain.setValueAtTime(0.13, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);
    osc.connect(gain);
    this.routeVoice(ctx, gain, 0.34, pan);
    osc.start(now);
    osc.stop(now + 0.18);

    // 3. High harmonic shimmer
    const overtone = ctx.createOscillator();
    const overGain = ctx.createGain();
    overtone.type = 'sine';
    overtone.frequency.setValueAtTime(baseFreq * 2.0, now);
    overtone.frequency.exponentialRampToValueAtTime(baseFreq * (isGold ? 3.0 : 2.2), now + 0.13);
    overGain.gain.setValueAtTime(isGold ? 0.085 : 0.05, now);
    overGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    overtone.connect(overGain);
    this.routeVoice(ctx, overGain, 0.38, pan);
    overtone.start(now);
    overtone.stop(now + 0.17);

    // 4. Short crystalline shatter spark noise
    this.playNoiseBurst(ctx, now, 0.04, 'highpass', 2400, 3800, 1.0, 0.075, 0.25, pan);
  }

  public playBreathCue(inhale: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const startFreq = inhale ? 220 : 330;
    const endFreq = inhale ? 330 : 196;

    [1.0, 1.5].forEach((mult, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(startFreq * mult, now);
      osc.frequency.exponentialRampToValueAtTime(endFreq * mult, now + 0.95);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(idx === 0 ? 0.045 : 0.024, now + 0.32);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.05);

      osc.connect(gain);
      this.routeVoice(ctx, gain, 0.45);
      osc.start(now);
      osc.stop(now + 1.1);
    });

    // Soft wave-like air sweep
    this.playNoiseBurst(
      ctx,
      now,
      0.95,
      'bandpass',
      inhale ? 280 : 520,
      inhale ? 560 : 240,
      1.6,
      0.016,
      0.45
    );
  }

  public playSpatialPing(
    position: THREE.Vector3,
    listenerPos: THREE.Vector3,
    listenerQuat?: THREE.Quaternion
  ): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(980, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.08);

    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    const rel = position.clone().sub(listenerPos);
    if (listenerQuat) {
      rel.applyQuaternion(listenerQuat.clone().invert());
    }

    if (typeof ctx.createPanner === 'function') {
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 1;
      panner.maxDistance = 20;
      panner.positionX.value = rel.x;
      panner.positionY.value = rel.y;
      panner.positionZ.value = rel.z;

      osc.connect(gain);
      gain.connect(panner);
      panner.connect(this.dryBus ?? ctx.destination);
      if (this.wetBus) {
        const wetSend = ctx.createGain();
        wetSend.gain.value = 0.25;
        panner.connect(wetSend);
        wetSend.connect(this.wetBus);
      }
    } else {
      osc.connect(gain);
      this.routeVoice(ctx, gain, 0.25, Math.max(-1, Math.min(1, rel.x / 2)));
    }

    osc.start(now);
    osc.stop(now + 0.24);
  }

  public playUnderwaterChime(pitchIndex = 0): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const scale = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25];
    const root = scale[Math.abs(pitchIndex) % scale.length];
    const now = ctx.currentTime;

    [root, root * 1.5].forEach((freq, idx) => {
      const t0 = now + idx * 0.08;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t0);

      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(0.06, t0 + 0.14);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.25);

      osc.connect(gain);
      this.routeVoice(ctx, gain, 0.55);
      osc.start(t0);
      osc.stop(t0 + 1.3);
    });
  }

  public playBubbleSound(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const pops = [
      { delay: 0, f0: 270, f1: 600, amp: 0.065 },
      { delay: 0.048, f0: 360, f1: 780, amp: 0.05 },
      { delay: 0.098, f0: 440, f1: 920, amp: 0.04 }
    ];
    for (const p of pops) {
      const t0 = now + p.delay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(p.f0, t0);
      osc.frequency.exponentialRampToValueAtTime(p.f1, t0 + 0.09);

      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(p.amp, t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.11);

      osc.connect(gain);
      this.routeVoice(ctx, gain, 0.42);
      osc.start(t0);
      osc.stop(t0 + 0.12);
    }
  }

  public startCampfireAmbient(intensity = 1.0): void {
    const ctx = this.ensureContextRaw();
    if (!ctx || !this.noiseBuffer) return;

    this.stopCampfireAmbientImmediate();

    const clamped = Math.max(0.4, Math.min(2.0, intensity));
    this.campfireTargetGain = 0.055 + clamped * 0.04;

    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const lowFilter = ctx.createBiquadFilter();
    lowFilter.type = 'lowpass';
    lowFilter.frequency.setValueAtTime(140 + clamped * 45, now);
    lowFilter.Q.value = 0.7;

    const lowGain = ctx.createGain();
    lowGain.gain.value = 0.82;

    const midFilter = ctx.createBiquadFilter();
    midFilter.type = 'bandpass';
    midFilter.frequency.setValueAtTime(580 + clamped * 160, now);
    midFilter.Q.value = 1.2;

    const midGain = ctx.createGain();
    midGain.gain.value = 0.32;

    const lfoLow = ctx.createOscillator();
    lfoLow.type = 'sine';
    lfoLow.frequency.value = 0.23;
    const lfoLowGain = ctx.createGain();
    lfoLowGain.gain.value = 32;
    lfoLow.connect(lfoLowGain);
    lfoLowGain.connect(lowFilter.frequency);

    const lfoMid = ctx.createOscillator();
    lfoMid.type = 'sine';
    lfoMid.frequency.value = 0.57;
    const lfoMidGain = ctx.createGain();
    lfoMidGain.gain.value = 110;
    lfoMid.connect(lfoMidGain);
    lfoMidGain.connect(midFilter.frequency);

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.0001, now);
    const initialTarget = this.muted ? 0.0001 : this.campfireTargetGain;
    masterGain.gain.linearRampToValueAtTime(initialTarget, now + 0.4);

    src.connect(lowFilter);
    lowFilter.connect(lowGain);
    lowGain.connect(masterGain);

    src.connect(midFilter);
    midFilter.connect(midGain);
    midGain.connect(masterGain);

    const drySend = ctx.createGain();
    drySend.gain.value = 0.85;
    masterGain.connect(drySend);
    drySend.connect(this.dryBus ?? ctx.destination);

    let wetSend: GainNode | null = null;
    if (this.wetBus) {
      wetSend = ctx.createGain();
      wetSend.gain.value = 0.18;
      masterGain.connect(wetSend);
      wetSend.connect(this.wetBus);
    }

    src.start(now);
    lfoLow.start(now);
    lfoMid.start(now);

    this.campfireSource = src;
    this.campfireLfoLow = lfoLow;
    this.campfireLfoMid = lfoMid;
    this.campfireLfoLowGain = lfoLowGain;
    this.campfireLfoMidGain = lfoMidGain;
    this.campfireLowFilter = lowFilter;
    this.campfireMidFilter = midFilter;
    this.campfireMasterGain = masterGain;
    this.campfireDrySend = drySend;
    this.campfireWetSend = wetSend;
  }

  public setCampfireIntensity(intensity: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.campfireMasterGain || !this.campfireLowFilter || !this.campfireMidFilter) {
      return;
    }
    const clamped = Math.max(0.4, Math.min(2.0, intensity));
    this.campfireTargetGain = 0.055 + clamped * 0.04;
    const now = ctx.currentTime;
    this.campfireLowFilter.frequency.setTargetAtTime(140 + clamped * 45, now, 0.25);
    this.campfireMidFilter.frequency.setTargetAtTime(580 + clamped * 160, now, 0.25);
    const targetGain = this.muted ? 0.0001 : this.campfireTargetGain;
    this.campfireMasterGain.gain.setTargetAtTime(targetGain, now, 0.2);
  }

  private stopCampfireAmbientImmediate(): void {
    if (this.campfireStopTimer !== null) {
      window.clearTimeout(this.campfireStopTimer);
      this.campfireStopTimer = null;
    }
    const nodes = [
      this.campfireSource,
      this.campfireLfoLow,
      this.campfireLfoMid,
      this.campfireLfoLowGain,
      this.campfireLfoMidGain,
      this.campfireLowFilter,
      this.campfireMidFilter,
      this.campfireMasterGain,
      this.campfireDrySend,
      this.campfireWetSend
    ];
    try {
      this.campfireSource?.stop();
    } catch {
      // Ignore already-stopped nodes
    }
    try {
      this.campfireLfoLow?.stop();
    } catch {
      // Ignore already-stopped nodes
    }
    try {
      this.campfireLfoMid?.stop();
    } catch {
      // Ignore already-stopped nodes
    }
    for (const node of nodes) {
      try {
        node?.disconnect();
      } catch {
        // Ignore disconnect failures
      }
    }
    this.campfireSource = null;
    this.campfireLfoLow = null;
    this.campfireLfoMid = null;
    this.campfireLfoLowGain = null;
    this.campfireLfoMidGain = null;
    this.campfireLowFilter = null;
    this.campfireMidFilter = null;
    this.campfireMasterGain = null;
    this.campfireDrySend = null;
    this.campfireWetSend = null;
  }

  public stopCampfireAmbient(): void {
    const ctx = this.ctx;
    const masterGain = this.campfireMasterGain;
    const src = this.campfireSource;
    const lfoLow = this.campfireLfoLow;
    const lfoMid = this.campfireLfoMid;
    const extraNodes = [
      this.campfireLfoLowGain,
      this.campfireLfoMidGain,
      this.campfireLowFilter,
      this.campfireMidFilter,
      masterGain,
      this.campfireDrySend,
      this.campfireWetSend
    ];

    if (!ctx || !masterGain || !src) {
      this.stopCampfireAmbientImmediate();
      return;
    }

    if (this.campfireStopTimer !== null) {
      window.clearTimeout(this.campfireStopTimer);
      this.campfireStopTimer = null;
    }

    // Clear active references right away so a quick restart does not collide.
    this.campfireSource = null;
    this.campfireLfoLow = null;
    this.campfireLfoMid = null;
    this.campfireLfoLowGain = null;
    this.campfireLfoMidGain = null;
    this.campfireLowFilter = null;
    this.campfireMidFilter = null;
    this.campfireMasterGain = null;
    this.campfireDrySend = null;
    this.campfireWetSend = null;

    const now = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(Math.max(0.0001, masterGain.gain.value), now);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);

    this.campfireStopTimer = window.setTimeout(() => {
      this.campfireStopTimer = null;
      for (const n of [src, lfoLow, lfoMid]) {
        try {
          n?.stop();
        } catch {
          // Ignore already-stopped nodes
        }
      }
      for (const n of [src, lfoLow, lfoMid, ...extraNodes]) {
        try {
          n?.disconnect();
        } catch {
          // Ignore disconnect failures
        }
      }
    }, 280);
  }

  public playCampfireCrackle(intensity = 1.0, pan = 0, isBurst = false): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const clamped = Math.max(0.4, Math.min(2.0, intensity));

    if (isBurst) {
      // Sharp high-frequency transient at the moment wood pops
      const burstGain = (0.08 + Math.random() * 0.04) * Math.min(1.35, 0.75 + clamped * 0.35);
      this.playNoiseBurst(
        ctx,
        now,
        0.01 + Math.random() * 0.012,
        'bandpass',
        3400 + Math.random() * 3200,
        2400 + Math.random() * 1400,
        1.8,
        burstGain,
        0.18,
        pan
      );

      // Dry wood snap body
      this.playNoiseBurst(
        ctx,
        now + 0.004,
        0.025 + Math.random() * 0.015,
        'bandpass',
        1150 + Math.random() * 950,
        780,
        2.2,
        burstGain * 0.85,
        0.2,
        pan
      );
      return;
    }

    const freqStart = 2400 + Math.random() * 2400;
    const freqEnd = Math.max(1200, freqStart * (0.65 + Math.random() * 0.25));
    const duration = 0.015 + Math.random() * 0.03;
    const gain = (0.04 + Math.random() * 0.045) * Math.min(1.35, 0.75 + clamped * 0.35);

    this.playNoiseBurst(
      ctx,
      now,
      duration,
      'bandpass',
      freqStart,
      freqEnd,
      2.5,
      gain,
      0.16,
      pan
    );

    // Occasional drier wood snap
    if (Math.random() < 0.35) {
      const snapStart = now + Math.random() * 0.025;
      this.playNoiseBurst(
        ctx,
        snapStart,
        0.024 + Math.random() * 0.02,
        'bandpass',
        1250 + Math.random() * 650,
        900,
        2.2,
        gain * 0.75,
        0.18,
        pan
      );
    }
  }
}
