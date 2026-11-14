import { describe, expect, it } from "vitest";

import {
  createMapLayer,
  createPageDocument,
  findMapCountryIds,
  getMapLayerGeographyDetail,
  getMapLayerTiles,
  type MapGeographyDetail,
  type MapLayer,
  mapLayerSchema,
  mapStyleIds,
  mapViewSchema,
  panMapLayerView,
  renderPageDocumentSvg,
  resizePageDocument,
  resolveMapLayerView,
  zoomMapLayerView,
} from "./index.js";
import { getMapGeography } from "./map-data.js";
import { getDetailedMapGeography } from "./map-data-detailed.js";
import { searchMapPlaces } from "./map-places.js";

const seattle = { id: "sea", label: "Seattle", latitude: 47.6062, longitude: -122.3321 };
const dubai = { id: "dxb", label: "Dubai", latitude: 25.2048, longitude: 55.2708 };
const tokyo = { id: "tyo", label: "Tokyo", latitude: 35.6762, longitude: 139.6503 };
const honolulu = { id: "hnl", label: "Honolulu", latitude: 21.3069, longitude: -157.8583 };
const johannesburg = {
  id: "jnb",
  label: "Johannesburg",
  latitude: -26.2041,
  longitude: 28.0473,
};

const renderMap = (
  layer: MapLayer,
  options: { detail?: MapGeographyDetail[]; tileHref?: string } = {},
): string =>
  renderPageDocumentSvg(
    createPageDocument({ canvas: { width: 2000, height: 1600 }, layers: [layer] }),
    {
      resolveMapGeography: (detail) =>
        (options.detail ?? ["low"]).includes(detail) ? getMapGeography() : null,
      resolveMapTileHref: (tile) =>
        options.tileHref ? `${options.tileHref}/${tile.z}/${tile.x}/${tile.y}` : null,
    },
  );

const markerCenter = (svg: string, markerId: string): [number, number] => {
  const match = svg.match(
    new RegExp(`data-map-marker-id="${markerId}"><circle cx="([-\\d.]+)" cy="([-\\d.]+)"`),
  );

  if (!match) throw new Error(`Marker ${markerId} was not rendered as a dot.`);

  return [Number(match[1]), Number(match[2])];
};

describe("map layers", () => {
  it("applies schema defaults for older or minimal map documents", () => {
    const layer = mapLayerSchema.parse({
      id: "map",
      kind: "map",
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      rotation: 0,
      opacity: 1,
      locked: false,
      style: "vintage",
    });

    expect(layer).toMatchObject({
      colors: {},
      features: {},
      highlightedCountries: [],
      markers: [],
      routes: [],
      symbolScale: 1,
      tileDetail: "standard",
      view: { mode: "fit", zoom: 0 },
    });
    expect(() => mapLayerSchema.parse({ ...layer, highlightedCountries: ["usa"] })).toThrow();
  });

  it("fits every marker inside the layer, including routes across the antimeridian", () => {
    const layer = createMapLayer({
      x: 100,
      y: 50,
      width: 1200,
      height: 800,
      style: "midnight",
      markers: [seattle, tokyo, honolulu],
      routes: [{ id: "r", fromMarkerId: "tyo", toMarkerId: "hnl" }],
    });
    const view = resolveMapLayerView(layer);
    const svg = renderMap(layer);

    // A Pacific trip should center on the Pacific, not split across the map edges.
    expect(Math.abs(view.centerLongitude)).toBeGreaterThan(150);
    for (const marker of layer.markers) {
      const [x, y] = markerCenter(svg, marker.id);

      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(layer.width);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(layer.height);
    }
    expect(svg).toContain('data-map-route-id="r"');
  });

  it("keeps enlarged labels inside the map frame", () => {
    const layer = createMapLayer({
      width: 1200,
      height: 800,
      style: "vintage",
      symbolScale: 2.5,
      markers: [seattle, { ...johannesburg, sublabel: "South Africa" }],
    });
    const svg = renderMap(layer);

    for (const marker of layer.markers) {
      const group = svg.match(new RegExp(`data-map-marker-id="${marker.id}">(.*?)</g>`))?.[1];
      const labelPaths = [...(group ?? "").matchAll(/<path d="([^"]+)"/g)];

      expect(labelPaths.length, marker.id).toBeGreaterThan(0);

      for (const [, d] of labelPaths) {
        const numbers = (d?.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

        numbers.forEach((value, index) => {
          const limit = index % 2 === 0 ? layer.width : layer.height;

          expect(value, marker.id).toBeGreaterThanOrEqual(0);
          expect(value, marker.id).toBeLessThanOrEqual(limit);
        });
      }
    }
  });

  it("lets labels leave the frame with markers that are panned out of view", () => {
    const layer = createMapLayer({
      width: 1200,
      height: 800,
      style: "vintage",
      markers: [seattle],
      view: { mode: "custom", centerLongitude: 70, centerLatitude: 40, zoom: 2 },
    });
    const group = renderMap(layer).match(/data-map-marker-id="sea">(.*?)<\/g>/)?.[1] ?? "";
    const xs = [...group.matchAll(/<path d="([^"]+)"/g)].flatMap(([, d]) =>
      (d?.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number).filter((_, index) => index % 2 === 0),
    );

    expect(xs.length).toBeGreaterThan(0);
    expect(xs.every((x) => x < 0 || x > layer.width)).toBe(true);
  });

  it("keeps a custom view instead of fitting markers", () => {
    const layer = createMapLayer({
      markers: [seattle],
      view: { mode: "custom", centerLongitude: 10, centerLatitude: 45, zoom: 2.5 },
    });

    expect(resolveMapLayerView(layer)).toEqual({
      centerLatitude: 45,
      centerLongitude: 10,
      zoom: 2.5,
    });
  });

  it("pans a fitted map so its content follows the drag", () => {
    const layer = createMapLayer({ markers: [seattle, tokyo], style: "atlas" });
    const before = markerCenter(renderMap(layer), "sea");
    const view = panMapLayerView(layer, { x: 120, y: -80 });
    const after = markerCenter(renderMap({ ...layer, view }), "sea");

    expect(view.mode).toBe("custom");
    expect(view.zoom).toBe(resolveMapLayerView(layer).zoom);
    expect(after[0] - before[0]).toBeCloseTo(120, 0);
    expect(after[1] - before[1]).toBeCloseTo(-80, 0);
  });

  it("pans smoothly at street level, including after the view is saved", () => {
    const layer = createMapLayer({
      markers: [{ ...seattle, icon: "dot" }],
      style: "osm",
      view: {
        mode: "custom",
        centerLatitude: seattle.latitude,
        centerLongitude: seattle.longitude,
        zoom: 18,
      },
    });
    const before = markerCenter(renderMap(layer), "sea");
    const view = mapViewSchema.parse(panMapLayerView(layer, { x: 40, y: -25 }));
    const after = markerCenter(renderMap({ ...layer, view }), "sea");

    expect(after[0] - before[0]).toBeCloseTo(40, 0);
    expect(after[1] - before[1]).toBeCloseTo(-25, 0);
  });

  it("spins the globe toward the drag and clamps map zoom to the style range", () => {
    const globe = createMapLayer({
      markers: [tokyo],
      style: "globe",
      view: { mode: "custom", centerLongitude: 0, centerLatitude: 0, zoom: 0 },
    });
    const spun = panMapLayerView(globe, { x: 100, y: 100 });

    expect(spun.centerLongitude).toBeLessThan(0);
    expect(spun.centerLatitude).toBeGreaterThan(0);

    const vector = createMapLayer({ markers: [seattle], style: "atlas" });
    expect(zoomMapLayerView(vector, 40)).toMatchObject({ mode: "custom", zoom: 12 });
    expect(zoomMapLayerView({ ...vector, style: "osm" }, 40).zoom).toBe(18);
    expect(zoomMapLayerView(vector, -3).zoom).toBe(0);
  });

  it("hides globe markers and routes on the far side of the world", () => {
    const paris = { id: "par", label: "Paris", latitude: 48.8566, longitude: 2.3522 };
    const globe = createMapLayer({
      markers: [paris, tokyo],
      routes: [{ id: "r", fromMarkerId: "par", toMarkerId: "tyo", path: "straight" }],
      style: "globe",
      view: { mode: "custom", centerLongitude: 0, centerLatitude: 0, zoom: 0 },
    });
    const svg = renderMap(globe);
    const routeD = svg.match(/data-map-route-id="r"[^>]*>.*?<path d="([^"]+)"/)?.[1] ?? "";

    expect(svg).toContain('data-map-marker-id="par"');
    expect(svg).not.toContain('data-map-marker-id="tyo"');
    expect(routeD).not.toBe("");
    // A straight screen-space segment would end at Tokyo's far-side projection.
    expect(routeD).not.toMatch(/^M[-\d.]+ [-\d.]+L[-\d.]+ [-\d.]+$/);
  });

  it("renders every style with land, markers, and labels", () => {
    for (const style of mapStyleIds) {
      const layer = createMapLayer({
        style,
        markers: [seattle, dubai],
        routes: [{ id: "trip", fromMarkerId: "sea", toMarkerId: "dxb" }],
      });
      const svg = renderMap(layer, { tileHref: "/tiles" });

      expect(svg, style).toContain(`data-map-style="${style}"`);
      expect(svg, style).toContain('data-map-marker-id="sea"');
      expect(svg, style).toContain('data-map-route-id="trip"');

      if (style === "osm" || style === "esriTopo") {
        expect(svg, style).toContain('<image href="/tiles/');
        expect(svg, style).toContain('data-map-attribution="true"');
      } else {
        expect(svg, style).toMatch(/data-map-land="true"[^>]*><path d="M/);
      }
    }
  });

  it("uses detailed geography when zoomed in and falls back to the low detail set", () => {
    const zoomedIn = createMapLayer({
      view: { mode: "custom", centerLongitude: 12, centerLatitude: 43, zoom: 5 },
    });

    expect(getMapLayerGeographyDetail(createMapLayer())).toBe("low");
    expect(getMapLayerGeographyDetail(zoomedIn)).toBe("high");
    expect(getMapLayerGeographyDetail(createMapLayer({ style: "osm" }))).toBeNull();
    expect(renderMap(zoomedIn)).toMatch(/data-map-land="true"[^>]*><path d="M/);
  });

  it("requests a bounded set of tiles that scales with tile detail", () => {
    const base = {
      style: "osm" as const,
      width: 1500,
      height: 1000,
      view: { mode: "custom" as const, centerLongitude: 2.32, centerLatitude: 48.86, zoom: 12 },
    };
    const standard = getMapLayerTiles(createMapLayer(base));
    const fine = getMapLayerTiles(createMapLayer({ ...base, tileDetail: "fine" }));
    const world = getMapLayerTiles(
      createMapLayer({ ...base, view: { ...base.view, centerLongitude: 179, zoom: 0 } }),
    );

    expect(standard.length).toBeGreaterThan(0);
    expect(fine[0]?.z).toBe((standard[0]?.z ?? 0) + 1);
    expect(fine.length).toBeGreaterThan(standard.length);
    for (const tile of [...standard, ...fine, ...world]) {
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.x).toBeLessThan(2 ** tile.z);
      expect(tile.y).toBeGreaterThanOrEqual(0);
      expect(tile.y).toBeLessThan(2 ** tile.z);
    }
    expect(
      getMapLayerTiles(createMapLayer({ ...base, tileDetail: "fine", width: 9000, height: 9000 }))
        .length,
    ).toBeLessThanOrEqual(400);
  });

  it("scales marker and label sizes when the page is resized", () => {
    const document = createPageDocument({
      canvas: { width: 2000, height: 2000 },
      layers: [createMapLayer({ symbolScale: 1 })],
    });
    const resized = resizePageDocument(document, { width: 1000, height: 1000 });
    const layer = resized.layers[0];

    expect(layer?.kind === "map" ? layer.symbolScale : null).toBe(0.5);
  });
});

describe("bundled map data", () => {
  it("decodes Natural Earth countries with stable ids", () => {
    const geography = getMapGeography();
    const ids = new Set(geography.countries.map((country) => country.id));

    expect(geography.countries.length).toBeGreaterThan(200);
    expect(ids).toContain("USA");
    expect(ids).toContain("FRA");
    expect(geography.lakes.length).toBeGreaterThan(0);
  });

  it("keeps state and province lines in the detailed geography", () => {
    const detailed = getDetailedMapGeography();

    expect(detailed.detail).toBe("high");
    expect(detailed.countries.length).toBeGreaterThan(getMapGeography().countries.length);
    expect(detailed.states.length).toBeGreaterThan(0);
  });

  it("searches places by name prefix ignoring accents and ranks larger places first", () => {
    const [paris] = searchMapPlaces("paris", 3);

    expect(paris).toMatchObject({ country: "France", name: "Paris" });
    expect(searchMapPlaces("sao paulo", 1)[0]?.name).toBe("São Paulo");
    expect(searchMapPlaces("", 5)).toEqual([]);
  });

  it("finds the countries that contain markers", () => {
    expect(
      findMapCountryIds(getMapGeography(), [
        tokyo,
        { latitude: 48.8566, longitude: 2.3522 },
        { latitude: 0, longitude: -140 },
        { latitude: 35.0116, longitude: 135.7681 },
      ]),
    ).toEqual(["JPN", "FRA"]);
  });
});
