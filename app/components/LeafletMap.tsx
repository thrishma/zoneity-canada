"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

interface Marker {
  id: string;
  name: string;
  lat: number;
  lng: number;
  color: string;
  value: string | null;
  metricUnit: string;
}

interface LeafletMapProps {
  markers: Marker[];
  hoveredId: string | null;
  onHover: (id: string | null) => void;
}

export default function LeafletMap({ markers, hoveredId, onHover }: LeafletMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const circlesRef = useRef<Map<string, L.CircleMarker>>(new Map());

  // Initialise map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [44.5, -79.5], // centred on southern Ontario
      zoom: 6,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      circlesRef.current.clear();
    };
  }, []);

  // Sync markers whenever data or selected metric changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove old circles
    circlesRef.current.forEach((c) => c.remove());
    circlesRef.current.clear();

    markers.forEach((m) => {
      const circle = L.circleMarker([m.lat, m.lng], {
        radius: 10,
        fillColor: m.color,
        color: "#fff",
        weight: 2,
        opacity: 1,
        fillOpacity: 0.9,
      })
        .bindTooltip(
          `<strong>${m.name}</strong><br/>${
            m.value ? `${m.value}${m.metricUnit ? " " + m.metricUnit : ""}` : "No data"
          }`,
          { permanent: false, direction: "top", offset: [0, -8] }
        )
        .addTo(map);

      circle.on("mouseover", () => onHover(m.id));
      circle.on("mouseout", () => onHover(null));

      circlesRef.current.set(m.id, circle);
    });
  }, [markers, onHover]);

  // Highlight hovered marker
  useEffect(() => {
    circlesRef.current.forEach((circle, id) => {
      const marker = markers.find((m) => m.id === id);
      if (!marker) return;
      if (id === hoveredId) {
        circle.setStyle({ radius: 14, weight: 3 } as L.CircleMarkerOptions);
        circle.openTooltip();
      } else {
        circle.setStyle({ radius: 10, weight: 2 } as L.CircleMarkerOptions);
        circle.closeTooltip();
      }
    });
  }, [hoveredId, markers]);

  return <div ref={containerRef} className="w-full h-full" />;
}
