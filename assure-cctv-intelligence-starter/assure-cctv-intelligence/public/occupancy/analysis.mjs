// Camera numbers increase left-to-right, then top-to-bottom. Round shared edges
// rather than widths so odd-sized screenshots have no omitted or duplicated pixels.
export function tileBounds(index, cols, rows, width, height) {
  const col = index % cols, row = Math.floor(index / cols);
  const x = Math.floor(col * width / cols), y = Math.floor(row * height / rows);
  return { x, y, w: Math.floor((col + 1) * width / cols) - x, h: Math.floor((row + 1) * height / rows) - y };
}

// Ignore the outside edge (often a bright timestamp or a player border). A
// black, nearly uniform or illegibly small feed is not evidence of an empty room.
export function usableView(rgba, width, height) {
  if (Math.min(width, height) < 40) return false;
  const levels = [];
  for (let row = 1; row <= 16; row++) {
    for (let col = 1; col <= 24; col++) {
      const i = 4 * (Math.floor(row * height / 17) * width + Math.floor(col * width / 25));
      levels.push(rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114);
    }
  }
  levels.sort((a, b) => a - b);
  const low = levels[Math.floor(levels.length * 0.05)], high = levels[Math.floor(levels.length * 0.95)];
  return high >= 25 && high - low >= 12;
}

const clamp = n => Math.max(0, Math.min(1, n));
export function classify(detections, width, height) {
  let uncertain = false;
  const boxes = [];
  for (const { categories, boundingBox } of detections) {
    const person = categories.find(c => c.categoryName === 'person');
    if (!person || person.score < 0.25) continue;
    if (person.score < 0.35 || !boundingBox) { uncertain = true; continue; }
    const { originX, originY, width: w, height: h } = boundingBox;
    const x = clamp(originX / width), y = clamp(originY / height);
    boxes.push({ x, y, w: clamp((originX + w) / width) - x, h: clamp((originY + h) / height) - y });
  }
  return { state: boxes.length ? 'occupied' : uncertain ? 'unclear' : 'empty', boxes };
}
