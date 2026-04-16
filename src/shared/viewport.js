// Viewport size sync — keep the canvas backing store aligned with the
// window's inner dimensions. Both SP and MP bind the same handler at
// boot time; extracting it removes the first pair of identical-text
// `function resize() { ... }` blocks identified in the bootstrap
// unification doc (docs/BOOTSTRAP-UNIFICATION.md, step 1).
//
// Calling `bindResize(canvas)` wires a window resize listener AND
// performs an initial sync so the canvas is correctly-sized before
// the first frame renders. Returns the resize fn so tests or callers
// that need to force a re-sync (e.g. orientation change on mobile)
// can call it directly.
export function bindResize(canvas) {
  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  window.addEventListener('resize', resize);
  resize();
  return resize;
}
