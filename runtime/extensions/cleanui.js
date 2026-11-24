/* Clean UI – hides upgrade and download nags in the interface */
Moggtify.extension({
  id: "cleanui",
  start(ctx) {
    ctx.style(`
      [data-testid="upgrade-button"],
      [data-testid="download-app-button"],
      [data-testid="install-app-button"],
      [data-testid="home-ad-card"],
      [data-testid="hpto-banner"],
      [data-testid="embedded-ad"],
      button[aria-label="Upgrade to Premium"],
      button[aria-label="Explore Premium"],
      button[aria-label="Premium entdecken"],
      a[href*="spotify.com/premium"]{display:none!important}
    `);
  },
});
