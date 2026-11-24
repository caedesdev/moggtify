/* Vibe Glow – the accent follows the album art, through the design engine */
Moggtify.extension({
  id: "vibe",
  start(ctx) {
    const { M } = ctx;
    const cache = new Map();

    function pickColor(img) {
      const size = 40;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const g = canvas.getContext("2d", { willReadFrequently: true });
      g.drawImage(img, 0, 0, size, size);
      const data = g.getImageData(0, 0, size, size).data;
      // Hue buckets weighted by saturation and mid-lightness → the vivid dominant color.
      const buckets = Array.from({ length: 36 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], gg = data[i + 1], b = data[i + 2];
        const { h, s, l } = M.Color.rgbToHsl({ r, g: gg, b });
        if (l < 0.12 || l > 0.92 || s < 0.18) continue;
        const w = s * s * (1 - Math.abs(l - 0.55) * 1.4);
        if (w <= 0) continue;
        const bk = buckets[Math.floor(h * 36) % 36];
        bk.w += w; bk.r += r * w; bk.g += gg * w; bk.b += b * w;
      }
      let best = null;
      for (let i = 0; i < 36; i++) {
        // smooth with neighbours so a hue spread over two buckets still wins
        const w = buckets[i].w + 0.5 * (buckets[(i + 35) % 36].w + buckets[(i + 1) % 36].w);
        if (!best || w > best.w) best = { w, i };
      }
      if (!best || best.w < 1.5) return null;
      const bk = buckets[best.i];
      if (!bk.w) return null;
      const hsl = M.Color.rgbToHsl({ r: bk.r / bk.w, g: bk.g / bk.w, b: bk.b / bk.w });
      // Make it pop on a dark UI without going neon.
      hsl.s = Math.min(0.9, Math.max(0.55, hsl.s * 1.15));
      hsl.l = Math.min(0.72, Math.max(0.58, hsl.l));
      return M.Color.hslToHex(hsl);
    }

    function load(url) {
      if (cache.has(url)) return Promise.resolve(cache.get(url));
      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          let c = null;
          try { c = pickColor(img); } catch (_) { c = null; }
          cache.set(url, c);
          if (cache.size > 80) cache.delete(cache.keys().next().value);
          resolve(c);
        };
        img.onerror = () => resolve(null);
        img.src = url;
      });
    }

    let token = 0;
    let lastCover = "";
    async function update(cover) {
      const my = ++token;
      const color = await load(cover);
      if (my !== token) return;
      M.design.setDynamicAccent(color);
    }
    ctx.on("tick", (d) => {
      if (d && d.cover && d.cover !== lastCover) { lastCover = d.cover; update(d.cover); }
    });
    const first = M.Player.data();
    if (first && first.cover) { lastCover = first.cover; update(first.cover); }
    return () => { token++; M.design.setDynamicAccent(null); };
  },
});
