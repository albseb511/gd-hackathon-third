// Captures mic audio at the context's native rate, downsamples to 16kHz
// PCM16 mono, and posts ~128ms Int16 chunks to the main thread.
class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 16000;
    this.ratio = sampleRate / this.targetRate;
    this.readPos = 0; // fractional read cursor into `carry`
    this.carry = new Float32Array(0);
    this.out = new Int16Array(2048); // ~128ms at 16k
    this.outPos = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const chunk = input[0];

    // append to carry
    const merged = new Float32Array(this.carry.length + chunk.length);
    merged.set(this.carry, 0);
    merged.set(chunk, this.carry.length);

    let pos = this.readPos;
    while (pos + 1 < merged.length) {
      const i = Math.floor(pos);
      const frac = pos - i;
      const sample = merged[i] * (1 - frac) + merged[i + 1] * frac;
      const s = Math.max(-1, Math.min(1, sample));
      this.out[this.outPos++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.outPos === this.out.length) {
        this.port.postMessage(this.out.buffer.slice(0));
        this.outPos = 0;
      }
      pos += this.ratio;
    }

    const keepFrom = Math.floor(pos);
    this.carry = merged.slice(keepFrom);
    this.readPos = pos - keepFrom;
    return true;
  }
}

registerProcessor("pcm-processor", PcmProcessor);
