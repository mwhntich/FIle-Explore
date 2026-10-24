// Draws the dragged stack in a small click-through window that follows the cursor once a drag leaves the main window,
// using the same swing and squish motion as inside the app.
const ghost = document.getElementById('ghost');
const ANCHOR_X = 120, ANCHOR_Y = 26; // where the stack hangs inside this window
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let body = null, target = null, running = false, lastCursor = 0;

function step() {
  if (!running || !body || !target) { running = false; return; }
  // Safety net: if cursor updates stop arriving, fade out instead of leaving a frozen stack on screen.
  if (performance.now() - lastCursor > 300) { running = false; ghost.style.transition = 'opacity .2s'; ghost.style.opacity = '0'; return; }
  const px = body.x, py = body.y;
  body.x += (target.x - body.x) * 0.38; body.y += (target.y - body.y) * 0.38;
  body.vx = body.x - px; body.vy = body.y - py;
  const speed = Math.hypot(body.vx, body.vy);
  const rotTarget = reduceMotion ? 0 : Math.max(-22, Math.min(22, body.vx * 1.7));
  body.rotV = (body.rotV + (rotTarget - body.rot) * 0.18) * 0.78; body.rot += body.rotV;
  const stretch = reduceMotion ? 0 : Math.min(speed / 55, 0.22);
  const along = speed ? Math.abs(body.vx) / speed : 0, across = speed ? Math.abs(body.vy) / speed : 0;
  body.sx += (1 + stretch * along - stretch * 0.6 * across - body.sx) * 0.3;
  body.sy += (1 + stretch * across - stretch * 0.6 * along - body.sy) * 0.3;
  // The window itself sits on the cursor; the stack trails a little behind it inside the window.
  const lagX = Math.max(-70, Math.min(70, body.x - target.x)), lagY = Math.max(-4, Math.min(50, body.y - target.y));
  ghost.style.transform = `translate(${ANCHOR_X + lagX}px, ${ANCHOR_Y + lagY}px) translateX(-50%) rotate(${body.rot}deg) scale(${body.sx}, ${body.sy})`;
  requestAnimationFrame(step);
}

window.overlay.onGhost((symbols, html) => {
  document.getElementById('symbols').innerHTML = symbols;
  ghost.innerHTML = html;
  ghost.querySelector('.drag-mode')?.remove();
  ghost.classList.remove('landing'); ghost.style.transition = ''; ghost.style.opacity = '1';
  body = null; target = null;
});
window.overlay.onCursor((x, y) => {
  target = { x, y }; lastCursor = performance.now();
  if (!body) body = { x, y, vx: 0, vy: 0, rot: 0, rotV: 0, sx: 1, sy: 1 };
  if (!running) { running = true; requestAnimationFrame(step); }
});
window.overlay.onLand(() => {
  running = false;
  ghost.classList.add('landing');
  ghost.style.transform = `translate(${ANCHOR_X}px, ${ANCHOR_Y + 20}px) translateX(-50%) rotate(0deg) scale(0.3)`;
  ghost.style.opacity = '0';
});
