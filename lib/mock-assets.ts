// Procedurally-generated SVG data URIs used as mock generation results.
// Original geometry — produces a unique-looking placeholder per prompt by
// hashing the prompt to seed colors and shapes.

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}

function rng(seed: number) {
  let s = seed || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

export function mockImageDataUri(prompt: string, index = 0, w = 1024, h = 1024): string {
  const r = rng(hash(prompt + ":" + index));
  const hue1 = Math.floor(r() * 360);
  const hue2 = (hue1 + 40 + Math.floor(r() * 120)) % 360;
  const hue3 = (hue1 + 220 + Math.floor(r() * 80)) % 360;
  const blobs = Array.from({ length: 6 }, () => ({
    cx: Math.floor(r() * w),
    cy: Math.floor(r() * h),
    rx: Math.floor(w * (0.18 + r() * 0.42)),
    ry: Math.floor(h * (0.18 + r() * 0.42)),
    hue: [hue1, hue2, hue3][Math.floor(r() * 3)],
    sat: 60 + Math.floor(r() * 30),
    light: 45 + Math.floor(r() * 30),
    op: 0.35 + r() * 0.45,
  }));
  const grain = Math.floor(r() * 1000);
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${hue1} 70% 18%)"/>
      <stop offset="55%" stop-color="hsl(${hue2} 60% 28%)"/>
      <stop offset="100%" stop-color="hsl(${hue3} 70% 12%)"/>
    </linearGradient>
    <filter id="b"><feGaussianBlur stdDeviation="80"/></filter>
    <filter id="n"><feTurbulence baseFrequency="0.9" numOctaves="2" seed="${grain}"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.06 0"/></filter>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  <g filter="url(#b)" opacity="0.95">
    ${blobs.map((b) => `<ellipse cx="${b.cx}" cy="${b.cy}" rx="${b.rx}" ry="${b.ry}" fill="hsl(${b.hue} ${b.sat}% ${b.light}%)" opacity="${b.op}"/>`).join("")}
  </g>
  <rect width="${w}" height="${h}" filter="url(#n)"/>
</svg>`.trim();
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function mockVideoPosterDataUri(prompt: string): string {
  return mockImageDataUri(prompt, 0, 1280, 720);
}
