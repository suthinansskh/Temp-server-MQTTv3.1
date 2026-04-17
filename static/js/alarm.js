// ============================================================
// Audio Alarm (Web Audio API — no external file needed)
// ============================================================

const AlarmTone = (() => {
  let ctx, oscillator, gain, playing = false, pulseInterval;
  function start() {
    if (playing) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    oscillator = ctx.createOscillator();
    gain = ctx.createGain();
    oscillator.type = 'square';
    oscillator.frequency.value = 880;
    gain.gain.value = 0.3;
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    let on = true;
    pulseInterval = setInterval(() => {
      on = !on;
      try { gain.gain.setValueAtTime(on ? 0.3 : 0, ctx.currentTime); } catch (e) { clearInterval(pulseInterval); }
    }, 250);
    playing = true;
  }
  function stop() {
    if (!playing) return;
    if (pulseInterval) { clearInterval(pulseInterval); pulseInterval = null; }
    try { oscillator.stop(); } catch (e) { }
    try { ctx.close(); } catch (e) { }
    playing = false;
  }
  return { play: start, pause: stop, stop, get paused() { return !playing; } };
})();
