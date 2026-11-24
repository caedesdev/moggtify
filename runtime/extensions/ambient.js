/* Ambient – blurred album art glowing behind the whole app.
   Uses the design engine's glass backdrop, so it works with every design. */
Moggtify.extension({
  id: "ambient",
  start(ctx) {
    const { M } = ctx;
    M.design.glass("ambient", true);
    return () => M.design.glass("ambient", false);
  },
});
