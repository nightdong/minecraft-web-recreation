/** Fixed-size rolling CPU samples, distinct from browser-delivered frame
 * intervals. Reading a summary is explicit, not performed on every frame. */
export class FrameMetrics {
  constructor(size = 600) {
    this.size = size; this.index = 0; this.count = 0;
    this.samples = { simulation: new Float32Array(size), streaming: new Float32Array(size), render: new Float32Array(size), frame: new Float32Array(size) };
    this.saves = { count: 0, snapshotMs: 0, maxSnapshotMs: 0, transactionMs: 0, maxTransactionMs: 0 };
  }
  record(simulation, streaming, render, frame) {
    const i = this.index; this.samples.simulation[i] = simulation; this.samples.streaming[i] = streaming; this.samples.render[i] = render; this.samples.frame[i] = frame;
    this.index = (i + 1) % this.size; this.count = Math.min(this.size, this.count + 1);
  }
  summary() {
    const result = { samples: this.count, saves: { ...this.saves } };
    for (const [name, buffer] of Object.entries(this.samples)) {
      const values = Array.from(buffer.subarray(0, this.count)).sort((a,b) => a-b);
      result[name] = { meanMs: values.reduce((a,b) => a+b,0) / Math.max(1,values.length), p95Ms: values[Math.floor(values.length*.95)] || 0, maxMs: values.at(-1) || 0 };
    }
    return result;
  }
}
