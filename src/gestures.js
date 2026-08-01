export function pinchFrame(points) {
  const [a, b] = [...points.values()];
  if (!a || !b) return null;
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))
  };
}

/* Moving the midpoint pans first; scaling around the new midpoint then keeps
   the world point between the two fingers under that midpoint. */
export function applyPinch(camera, previous, current) {
  if (!previous || !current) return;
  camera.panBy(current.x - previous.x, current.y - previous.y);
  camera.zoomAt(current.x, current.y, current.distance / previous.distance);
}
