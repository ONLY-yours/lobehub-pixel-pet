'use strict';

// Is a screen point inside a window rectangle? Used by the main process to tell the renderer whether the
// mouse is over the pet. Asking the OS for the cursor position is reliable; DOM mouse/blur events are not:
// on Windows an IME's candidate window triggers blur and mouseleave while the user is still typing.
function pointInBounds(p, b) {
  return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
}

module.exports = { pointInBounds };
