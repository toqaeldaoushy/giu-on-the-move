const R_KM = 6371;
const rad = (d) => (d * Math.PI) / 180;

export function haversineKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(h));
}

/**
 * A route as a path. points are listed in the INBOUND direction (pickup -> campus).
 * project(lat, lon) returns how far along the path the nearest point is (km from the pickup point).
 */
export function buildRoute(points) {
  if (points.length < 2) throw new Error('A route needs at least two points');
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + haversineKm(points[i - 1], points[i]));
  const totalKm = cum[cum.length - 1];
  const lat0 = points[0].lat;
  const kx = 111.32 * Math.cos(rad(lat0)); // km per degree of longitude
  const ky = 110.574;                      // km per degree of latitude
  const toXY = (p) => ({ x: (p.lon - points[0].lon) * kx, y: (p.lat - lat0) * ky });

  function project(lat, lon) {
    const P = toXY({ lat, lon });
    let best = { dist: Infinity, s: 0 };
    for (let i = 0; i < points.length - 1; i++) {
      const A = toXY(points[i]);
      const B = toXY(points[i + 1]);
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const len2 = dx * dx + dy * dy || 1e-12;
      const t = Math.max(0, Math.min(1, ((P.x - A.x) * dx + (P.y - A.y) * dy) / len2));
      const cx = A.x + t * dx;
      const cy = A.y + t * dy;
      const dist = Math.hypot(P.x - cx, P.y - cy);
      if (dist < best.dist) best = { dist, s: cum[i] + t * (cum[i + 1] - cum[i]) };
    }
    return { sKm: best.s, offRouteKm: best.dist };
  }
  return { totalKm, project };
}
