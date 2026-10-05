// Procedural sound: everything is synthesised with WebAudio, no asset files.
window.Sound = (() => {
  let ctx = null, master = null, muted = false;
  let amb = null, alarmTimer = null, noiseBuf = null;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.7;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Brown noise, the base of every ambience.
  function noise() {
    if (noiseBuf) return noiseBuf;
    const len = ctx.sampleRate * 4;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    return noiseBuf;
  }

  function tone(freq, start, dur, type = 'square', vol = 0.1) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(vol, start + 0.01);
    g.gain.setValueAtTime(vol, start + Math.max(0.02, dur - 0.03));
    g.gain.linearRampToValueAtTime(0, start + dur);
    o.connect(g).connect(master);
    o.start(start);
    o.stop(start + dur + 0.05);
  }

  function burst(dur, freq, type, vol) {
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noise();
    f.type = type;
    f.frequency.value = freq;
    const t = ctx.currentTime;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.1);
  }

  function alarmStart() {
    if (!ensure()) return;
    alarmStop();
    const ring = () => {
      const t = ctx.currentTime + 0.02;
      for (let i = 0; i < 4; i++) tone(1046, t + i * 0.16, 0.09, 'square', 0.07);
    };
    ring();
    alarmTimer = setInterval(ring, 1100);
  }

  function alarmStop() {
    clearInterval(alarmTimer);
    alarmTimer = null;
  }

  const LEVEL = { city: 0.22, room: 0.07, ocean: 0.4, drone: 0.12, cafe: 0.16, chapel: 0.05 };
  const CUTOFF = { city: 320, room: 160, ocean: 750, cafe: 900, chapel: 120 };

  function ambience(kind) {
    if (!ensure()) return;
    if (amb) {
      const old = amb;
      old.gain.gain.cancelScheduledValues(ctx.currentTime);
      old.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.5);
      setTimeout(() => old.nodes.forEach(n => { try { n.stop(); } catch (e) { /* already stopped */ } }), 3000);
      amb = null;
    }
    if (!kind || kind === 'none') return;

    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(master);
    const nodes = [];

    if (kind === 'drone') {
      [55, 82.4, 110.3, 164.9].forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.value = 0.3 / (i + 1);
        o.connect(g).connect(gain);
        o.start();
        nodes.push(o);
      });
    } else {
      const src = ctx.createBufferSource(), f = ctx.createBiquadFilter();
      src.buffer = noise();
      src.loop = true;
      f.type = 'lowpass';
      f.frequency.value = CUTOFF[kind] || 400;
      src.connect(f);
      if (kind === 'ocean') {
        // Slow swell, like waves breaking.
        const lfo = ctx.createOscillator(), depth = ctx.createGain(), swell = ctx.createGain();
        lfo.frequency.value = 0.1;
        depth.gain.value = 0.5;
        swell.gain.value = 0.6;
        lfo.connect(depth).connect(swell.gain);
        f.connect(swell).connect(gain);
        lfo.start();
        nodes.push(lfo);
      } else {
        f.connect(gain);
      }
      src.start();
      nodes.push(src);
    }
    gain.gain.setTargetAtTime(LEVEL[kind] ?? 0.1, ctx.currentTime, 1.0);
    amb = { gain, nodes };
  }

  function knock() {
    if (!ensure()) return;
    const t = ctx.currentTime + 0.05;
    for (let i = 0; i < 3; i++) tone(95, t + i * 0.24, 0.09, 'sine', 0.6);
  }

  function crash() {
    if (!ensure()) return;
    burst(1.4, 200, 'highpass', 0.6);
    tone(60, ctx.currentTime, 0.5, 'sine', 0.5);
  }

  function chime() {
    if (!ensure()) return;
    const t = ctx.currentTime + 0.02;
    tone(660, t, 0.5, 'sine', 0.08);
    tone(990, t + 0.12, 0.7, 'sine', 0.06);
  }

  function brew() {
    if (!ensure()) return;
    burst(1.6, 500, 'bandpass', 0.35);
  }

  function glitch() {
    if (!ensure()) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 6; i++) tone(200 + Math.random() * 1800, t + i * 0.04, 0.035, 'sawtooth', 0.05);
  }

  function setMuted(m) {
    muted = m;
    if (master) master.gain.value = m ? 0 : 0.7;
  }

  return { ensure, alarmStart, alarmStop, ambience, knock, crash, chime, brew, glitch, setMuted, get muted() { return muted; } };
})();
