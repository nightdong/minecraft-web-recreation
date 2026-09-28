/** Merge only coplanar unit faces carrying the exact same texture and constant
 * corner lighting. Nonuniform AO/light faces stay untouched in the caller. */
export class FlatFaceCollector {
  constructor() { this.planes = new Map(); this.inputFaces = 0; }
  add(faceIndex, vertices, uv, color, light) {
    const axes = [0, 1, 2], a = vertices[0], b = vertices[1], d = vertices[3];
    const uAxis = axes.find(axis => a[axis] !== b[axis]), vAxis = axes.find(axis => a[axis] !== d[axis]);
    const normalAxis = axes.find(axis => axis !== uAxis && axis !== vAxis);
    const planeKey = faceIndex * 129 + a[normalAxis], u = Math.min(a[uAxis], b[uAxis]), v = Math.min(a[vAxis], d[vAxis]);
    let plane = this.planes.get(planeKey);
    if (!plane) { plane = { faceIndex, cells: new Map(), minU: Infinity, maxU: -Infinity, minV: Infinity, maxV: -Infinity }; this.planes.set(planeKey, plane); }
    const signature = [...uv, ...color, ...light].join(',');
    plane.cells.set(u + v * 1024, { u, v, vertices, uv, color, light, signature });
    plane.minU = Math.min(plane.minU, u); plane.maxU = Math.max(plane.maxU, u);
    plane.minV = Math.min(plane.minV, v); plane.maxV = Math.max(plane.maxV, v); this.inputFaces++;
  }
  flush(emit) {
    let outputFaces = 0;
    for (const plane of this.planes.values()) {
      const { cells } = plane;
      for (const code of [...cells.keys()].sort((a, b) => a - b)) {
        const cell = cells.get(code); if (!cell) continue;
        const { u, v } = cell;
        const matches = (x, y) => x <= plane.maxU && cells.get(x + y * 1024)?.signature === cell.signature;
        let width = 1, height = 1;
        while (matches(u + width, v)) width++;
        outer: while (v + height <= plane.maxV) {
          for (let x = 0; x < width; x++) if (!matches(u + x, v + height)) break outer;
          height++;
        }
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) cells.delete(u + x + (v + y) * 1024);
        const min = [0, 1, 2].map(axis => Math.min(...cell.vertices.map(vertex => vertex[axis])));
        const uAxis = [0, 1, 2].find(axis => cell.vertices[0][axis] !== cell.vertices[1][axis]);
        const vAxis = [0, 1, 2].find(axis => cell.vertices[0][axis] !== cell.vertices[3][axis]);
        const vertices = cell.vertices.map(vertex => vertex.map((value, axis) => min[axis] + (value - min[axis]) * (axis === uAxis ? width : axis === vAxis ? height : 1)));
        emit({ ...cell, vertices, width, height, faceIndex: plane.faceIndex }); outputFaces++;
      }
    }
    this.planes.clear(); return { inputFaces: this.inputFaces, outputFaces };
  }
}
