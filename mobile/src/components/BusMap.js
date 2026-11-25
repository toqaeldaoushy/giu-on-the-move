import { useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { radius, useTheme } from '../theme';

// The map is a small web page inside the app that uses Leaflet with OpenStreetMap, as described in the thesis.
// The app draws the route and stops once, then moves the bus marker by calling setBus() in the page.
// Brand guide: gold route with an ink outline, ink bus with a gold ring, the chosen stop in gold.
// At night the same OpenStreetMap tiles are shown darkened with a CSS filter.
function mapHtml(route, c) {
  return `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html, body, #map { margin: 0; height: 100%; background: ${c.bg}; }
  ${c.night ? '.leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) brightness(0.85) contrast(0.9); }' : ''}
  .bus { background: ${c.busFill}; border: 3px solid ${c.gold}; border-radius: 50%;
         width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;
         box-shadow: 0 2px 6px rgba(0,0,0,.45); box-sizing: border-box; }
  .leaflet-tooltip { font: 600 13px -apple-system, sans-serif; }
</style>
</head><body><div id="map"></div>
<script>
  var route = ${JSON.stringify(route)};
  var c = ${JSON.stringify(c)};
  var map = L.map('map', { zoomControl: true, attributionControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  var pts = route.points.map(function (p) { return [p.lat, p.lon]; });
  L.polyline(pts, { color: c.outline, weight: 9, opacity: 0.9 }).addTo(map);
  var line = L.polyline(pts, { color: c.gold, weight: 5, opacity: 1 }).addTo(map);
  map.fitBounds(line.getBounds(), { padding: [24, 24] });
  var stopMarkers = {};
  route.stops.forEach(function (s) {
    stopMarkers[s.id] = L.circleMarker([s.lat, s.lon], { radius: 6, color: c.outline, fillColor: c.stopFill, fillOpacity: 1, weight: 3 })
      .bindTooltip(s.name).addTo(map);
  });
  var busSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="' + c.busIcon + '" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/></svg>';
  var bus = null;
  window.setBus = function (lat, lon) {
    if (lat === null) { if (bus) { map.removeLayer(bus); bus = null; } return; }
    var icon = L.divIcon({ className: '', html: '<div class="bus">' + busSvg + '</div>', iconSize: [34, 34], iconAnchor: [17, 17] });
    if (!bus) bus = L.marker([lat, lon], { icon: icon, zIndexOffset: 1000 }).addTo(map);
    else bus.setLatLng([lat, lon]);
  };
  window.setStop = function (id) {
    Object.keys(stopMarkers).forEach(function (k) {
      var on = String(k) === String(id);
      stopMarkers[k].setStyle({ fillColor: on ? c.gold : c.stopFill, color: c.outline, radius: on ? 10 : 6 });
      if (on) stopMarkers[k].bringToFront();
    });
  };
</script></body></html>`;
}

export default function BusMap({ route, position, stopId, height = 300 }) {
  const { t } = useTheme();
  const ref = useRef(null);
  const night = t.mode === 'night';
  const colors = {
    night,
    bg: t.surface2,
    gold: t.gold,
    outline: night ? '#000000' : '#1A1A1A',
    stopFill: night ? '#F3F0E8' : '#FFFFFF',
    busFill: '#1A1A1A',
    busIcon: '#FFFFFF',
  };
  const html = useMemo(() => mapHtml({ points: route.points, stops: route.stops }, colors), [route, night]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = (js) => ref.current?.injectJavaScript(`${js}; true;`);
  const sync = () => {
    run(position ? `window.setBus(${position.lat}, ${position.lon})` : 'window.setBus(null)');
    if (stopId) run(`window.setStop(${stopId})`);
  };

  useEffect(sync, [position?.lat, position?.lon, stopId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={{ height, borderRadius: radius.card, overflow: 'hidden', borderWidth: 1, borderColor: t.border, backgroundColor: t.surface2 }}>
      <WebView
        key={night ? 'night' : 'light'}
        ref={ref}
        originWhitelist={['*']}
        source={{ html }}
        onLoadEnd={sync}
        javaScriptEnabled
        style={{ flex: 1, backgroundColor: t.surface2 }}
      />
    </View>
  );
}
