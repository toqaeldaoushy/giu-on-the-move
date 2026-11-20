import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

// The map is a small web page inside the app that uses Leaflet with OpenStreetMap, as described in the thesis.
// The app draws the route and stops once, then moves the bus marker by calling setBus() in the page.
function mapHtml(route) {
  return `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html, body, #map { margin: 0; height: 100%; }
  .bus { background: #1F4E79; color: #fff; border: 2px solid #fff; border-radius: 50%;
         width: 30px; height: 30px; line-height: 30px; text-align: center; font: 600 15px sans-serif;
         box-shadow: 0 1px 4px rgba(0,0,0,.4); }
</style>
</head><body><div id="map"></div>
<script>
  var route = ${JSON.stringify(route)};
  var map = L.map('map', { zoomControl: true, attributionControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  var line = L.polyline(route.points.map(function (p) { return [p.lat, p.lon]; }), { color: '#1F4E79', weight: 5, opacity: 0.7 }).addTo(map);
  map.fitBounds(line.getBounds(), { padding: [24, 24] });
  var stopMarkers = {};
  route.stops.forEach(function (s) {
    stopMarkers[s.id] = L.circleMarker([s.lat, s.lon], { radius: 7, color: '#1F4E79', fillColor: '#fff', fillOpacity: 1, weight: 3 })
      .bindTooltip(s.name).addTo(map);
  });
  var bus = null;
  window.setBus = function (lat, lon) {
    if (lat === null) { if (bus) { map.removeLayer(bus); bus = null; } return; }
    var icon = L.divIcon({ className: '', html: '<div class="bus">&#128652;</div>', iconSize: [30, 30], iconAnchor: [15, 15] });
    if (!bus) bus = L.marker([lat, lon], { icon: icon, zIndexOffset: 1000 }).addTo(map);
    else bus.setLatLng([lat, lon]);
  };
  window.setStop = function (id) {
    Object.keys(stopMarkers).forEach(function (k) {
      var on = String(k) === String(id);
      stopMarkers[k].setStyle({ fillColor: on ? '#B45F06' : '#fff', color: on ? '#B45F06' : '#1F4E79', radius: on ? 9 : 7 });
    });
  };
</script></body></html>`;
}

export default function BusMap({ route, position, stopId }) {
  const ref = useRef(null);
  const html = useMemo(() => mapHtml({ points: route.points, stops: route.stops }), [route]);

  const run = (js) => ref.current?.injectJavaScript(`${js}; true;`);
  const sync = () => {
    run(position ? `window.setBus(${position.lat}, ${position.lon})` : 'window.setBus(null)');
    if (stopId) run(`window.setStop(${stopId})`);
  };

  useEffect(sync, [position?.lat, position?.lon, stopId]);

  return (
    <View style={styles.wrap}>
      <WebView
        ref={ref}
        originWhitelist={['*']}
        source={{ html }}
        onLoadEnd={sync}
        javaScriptEnabled
        style={styles.map}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 300, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: '#DDE3E9' },
  map: { flex: 1 },
});
