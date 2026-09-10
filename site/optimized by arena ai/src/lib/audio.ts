export function createAudio() {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let reverb: ConvolverNode | null = null;
  let wet: GainNode | null = null;
  let enabled = false;
  const voices = new Set<{ oscillator: OscillatorNode; gain: GainNode }>();

  function toggle() {
    if (!context) {
      try {
        const Audio = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Audio) return false;
        context = new Audio();
        master = context.createGain();
        master.gain.value = 0.5;
        const length = Math.floor(context.sampleRate * 1.6);
        const impulse = context.createBuffer(2, length, context.sampleRate);
        for (let channel = 0; channel < 2; channel++) {
          const data = impulse.getChannelData(channel);
          for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.6);
        }
        reverb = context.createConvolver();
        reverb.buffer = impulse;
        wet = context.createGain();
        wet.gain.value = 0.35;
        master.connect(context.destination);
        master.connect(reverb);
        reverb.connect(wet);
        wet.connect(context.destination);
      } catch {
        destroy();
        return false;
      }
    }
    enabled = !enabled;
    if (enabled) void context.resume().catch(() => {});
    else void context.suspend().catch(() => {});
    return enabled;
  }

  function isEnabled() { return enabled; }

  function chime(frequency = 392, level = 0.06) {
    if (!enabled || !context || !master || document.hidden || voices.size > 12) return;
    const now = context.currentTime;
    [1, 2.01, 3.02].forEach((multiple, i) => {
      const oscillator = context!.createOscillator();
      const gain = context!.createGain();
      const voice = { oscillator, gain };
      voices.add(voice);
      oscillator.type = i ? 'sine' : 'triangle';
      oscillator.frequency.value = frequency * multiple;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(level / (i + 1.4), now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.4 - i * 0.3);
      oscillator.connect(gain).connect(master!);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
        voices.delete(voice);
      };
      oscillator.start(now);
      oscillator.stop(now + 1.5);
    });
  }

  function visibility() {
    if (!context || context.state === 'closed') return;
    if (document.hidden) void context.suspend().catch(() => {});
    else if (enabled) void context.resume().catch(() => {});
  }

  function destroy() {
    enabled = false;
    document.removeEventListener('visibilitychange', visibility);
    for (const { oscillator, gain } of voices) {
      oscillator.onended = null;
      try { oscillator.stop(); } catch { /* A voice may already have ended. */ }
      oscillator.disconnect();
      gain.disconnect();
    }
    voices.clear();
    master?.disconnect();
    reverb?.disconnect();
    wet?.disconnect();
    if (context && context.state !== 'closed') void context.close().catch(() => {});
    context = null;
    master = null;
    reverb = null;
    wet = null;
  }

  document.addEventListener('visibilitychange', visibility);
  return { toggle, chime, destroy, isEnabled };
}