/** Original synthesized sounds; no proprietary sound recordings are bundled. */
export class GameAudio {
  constructor(settings) { this.settings = settings; this.ctx = null; this.nextMusic = 60; this.voices = new Set(); this.maxVoices = 64; }
  trackVoice(source,nodes){this.voices.add(source);source.onended=()=>{this.voices.delete(source);source.disconnect();for(const node of nodes)node.disconnect();};}
  async unlock() {
    try {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
        const length = this.ctx.sampleRate * 2; this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
        const data = this.noise.getChannelData(0); for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      }
      this.master.gain.value = this.settings.volume ?? .65; await this.ctx.resume();
    } catch (error) { console.warn('Audio unavailable:', error.message); }
  }
  noiseSound(duration, volume, frequency, type = 'lowpass', rate = 1) {
    if (!this.ctx || this.ctx.state !== 'running' || this.voices.size>=this.maxVoices) return;
    const time = this.ctx.currentTime, source = this.ctx.createBufferSource(), filter = this.ctx.createBiquadFilter(), gain = this.ctx.createGain();
    source.buffer = this.noise; source.playbackRate.value = rate; filter.type = type; filter.frequency.value = frequency;
    source.connect(filter); filter.connect(gain); gain.connect(this.master);
    this.trackVoice(source,[filter,gain]);
    gain.gain.setValueAtTime(volume, time); gain.gain.exponentialRampToValueAtTime(.001, time + duration);
    source.start(time, Math.random() * .5); source.stop(time + duration + .02);
  }
  tone(frequency, duration = .1, volume = .08, type = 'sine', end = frequency, delay = 0) {
    if (!this.ctx || this.ctx.state !== 'running' || this.voices.size>=this.maxVoices) return;
    const now = this.ctx.currentTime + delay, osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(frequency, now); osc.frequency.exponentialRampToValueAtTime(Math.max(1, end), now + duration);
    gain.gain.setValueAtTime(.001, now); gain.gain.linearRampToValueAtTime(volume, now + .004); gain.gain.exponentialRampToValueAtTime(.001, now + duration);
    osc.connect(gain); gain.connect(this.master); this.trackVoice(osc,[gain]); osc.start(now); osc.stop(now + duration + .01);
  }
  play(name, material = 'stone', volume = 1) {
    if (!this.ctx) return; this.master.gain.value = this.settings.volume ?? .65;
    const pitch = .87 + Math.random() * .26;
    if (name === 'click') { this.noiseSound(.07, .12 * volume, 1500); this.tone(420, .06, .035 * volume, 'square', 250); }
    else if (name === 'step' || name === 'dig' || name === 'break' || name === 'place') {
      const config = { stone: [420, .13], wood: [950, .11], grass: [3900, .12], gravel: [2800, .13], sand: [2100, .14], cloth: [1300, .1], snow: [4500, .12], glass: [6800, .25] }[material] || [700, .12];
      const gain = (name === 'step' ? .065 : name === 'dig' ? .09 : .18) * volume;
      this.noiseSound(config[1] * (name === 'break' ? 1.8 : 1), gain, config[0] * pitch, 'lowpass', pitch);
      if (material === 'wood') this.tone(130 * pitch, .055, gain * .6, 'triangle', 70);
      if (material === 'glass' && name === 'break') for (let i = 0; i < 4; i++) this.tone(2000 + Math.random() * 3200, .15, .02 * volume, 'sine', 1200, i * .025);
    } else if (name === 'pickup') { this.tone(700 * pitch, .08, .035 * volume, 'sine', 1300); }
    else if (name === 'xp') { this.tone(900, .15, .05 * volume, 'sine', 1400); }
    else if (name === 'level') [440, 554, 659, 880].forEach((f, i) => this.tone(f, .5, .04, 'sine', f, i * .09));
    else if (name === 'hurt') { this.noiseSound(.17, .25 * volume, 1000); this.tone(120, .13, .11 * volume, 'sawtooth', 68); }
    else if (name === 'hit') { this.noiseSound(.13, .18 * volume, 1300); this.tone(95, .10, .055 * volume, 'triangle', 42); }
    else if (name === 'swing') this.noiseSound(.13, .045 * volume, 3000, 'bandpass');
    else if (name === 'splash') this.noiseSound(.55, .12 * volume, 1700, 'lowpass', .8);
    else if (name === 'eat') { this.noiseSound(.1, .13 * volume, 2600); this.tone(160 * pitch, .055, .03, 'square', 85); }
    else if (name === 'burp') this.tone(140, .22, .055 * volume, 'sawtooth', 65);
    else if (name === 'door' || name === 'chest') { this.tone(180, .17, .05 * volume, 'sawtooth', 75); this.noiseSound(.15, .08 * volume, 800); }
    else if (name === 'fuse') this.noiseSound(.65, .12 * volume, 6500, 'highpass');
    else if (name === 'explode') { this.noiseSound(1.1, .65 * volume, 1600, 'lowpass', .6); this.tone(65, .7, .25 * volume, 'sine', 20); }
    else if (name === 'bow') { this.noiseSound(.12, .1 * volume, 2000); this.tone(350, .13, .06 * volume, 'triangle', 85); }
    else if (name === 'pig') { this.tone(130 * pitch, .27, .045 * volume, 'sawtooth', 180); this.tone(170, .13, .02 * volume, 'square', 100, .2); }
    else if (name === 'cow') this.tone(87 * pitch, .65, .07 * volume, 'sawtooth', 66);
    else if (name === 'sheep') { this.tone(180 * pitch, .45, .05 * volume, 'sawtooth', 130); this.tone(220, .2, .02 * volume, 'triangle', 180, .18); }
    else if (name === 'chicken') [0, .14, .3].forEach(d => this.tone(480 * pitch, .09, .025 * volume, 'triangle', 310, d));
    else if (name === 'zombie') this.tone(72 * pitch, .65, .045 * volume, 'sawtooth', 49);
    else if (name === 'skeleton') { this.noiseSound(.08, .06 * volume, 3200); this.tone(450, .08, .02 * volume, 'triangle', 700); }
    else if (name === 'spider') { this.noiseSound(.22,.08*volume,2400,'bandpass',.7); this.tone(390*pitch,.13,.018*volume,'triangle',130); }
    else if (name === 'creeper') { this.noiseSound(.2,.045*volume,500,'bandpass',.7); this.tone(105,.23,.016*volume,'sine',165); }
    else if (name === 'dragon_hurt') { this.noiseSound(.75, .2 * volume, 620, 'bandpass', .55); this.tone(83 * pitch, .6, .09 * volume, 'sawtooth', 32); }
    else if (name === 'dragon_breath') { this.noiseSound(1.25, .2 * volume, 2300, 'bandpass', .7); this.tone(55, 1.1, .07 * volume, 'sawtooth', 91); }
    else if (name === 'dragon_death') { this.noiseSound(2, .3 * volume, 950, 'lowpass', .5); [95, 71, 47].forEach((f, i) => this.tone(f, 1.4, .08 * volume, 'sawtooth', 24, i * .35)); }
    else if (name === 'blaze' || name === 'blaze_charge') { this.noiseSound(name === 'blaze_charge' ? .85 : .35, .09 * volume, 3800, 'bandpass'); this.tone(145, .4, .025 * volume, 'sawtooth', name === 'blaze_charge' ? 410 : 80); }
    else if (name === 'enderman' || name === 'enderman_angry') { this.tone(145 * pitch, .45, .05 * volume, 'sawtooth', 61); if (name === 'enderman_angry') this.noiseSound(.8, .13 * volume, 1800, 'bandpass', .65); }
    else if (name === 'enderman_teleport') { this.tone(190, .28, .06 * volume, 'sine', 1500); this.tone(1300, .23, .04 * volume, 'triangle', 170, .09); }
    else if (name === 'end_eye') { this.tone(480, .2, .04 * volume, 'sine', 970); this.noiseSound(.12, .04 * volume, 2400, 'highpass'); }
    else if (name === 'portal_activate') { [110, 165, 220].forEach((f, i) => this.tone(f, 1.3, .045 * volume, 'triangle', f * 2, i * .13)); this.noiseSound(1.2, .1 * volume, 750, 'lowpass', .5); }
  }
  tick(dt) {
    if (!this.settings.music || !this.ctx) return;
    if ((this.nextMusic -= dt) > 0) return;
    this.nextMusic = 120 + Math.random() * 120;
    const notes = [261.63, 329.63, 392, 523.25, 440, 392, 329.63, 293.66, 349.23, 440, 587.33, 523.25, 392, 329.63, 261.63];
    notes.forEach((f, i) => { this.tone(f, 2.5, .012, 'sine', f, i * 1.2); if (i % 4 === 0) this.tone(f / 2, 4.5, .016, 'sine', f / 2, i * 1.2); });
  }
}
