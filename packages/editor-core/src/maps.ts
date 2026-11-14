import {
  type GeoPermissibleObjects,
  type GeoProjection,
  geoCentroid,
  geoContains,
  geoDistance,
  geoEquirectangular,
  geoGraticule10,
  geoInterpolate,
  geoMercator,
  geoNaturalEarth1,
  geoOrthographic,
  geoPath,
} from "d3-geo";
import type { Font } from "opentype.js";

import { getBundledEditorFont } from "./fonts.js";
import type { MapLayer, MapLayerView, MapMarker, MapRoute } from "./index.js";
import type {
  MapGeoBounds,
  MapGeography,
  MapGeographyDetail,
  MapGeographyFeature,
} from "./map-geography.js";
import {
  getMapStylePreset,
  type MapProjection,
  type MapStyleColors,
  type MapStyleFeatures,
  type MapStylePreset,
  type MapTile,
  type MapTileDetail,
  mapTileProviders,
} from "./map-styles.js";
import { escapeXml, pathData } from "./svg-path.js";

export type MapView = { centerLatitude: number; centerLongitude: number; zoom: number };

export type ResolvedMapStyle = {
  colors: MapStyleColors;
  features: MapStyleFeatures;
  fontFamily: string;
  preset: MapStylePreset;
  projection: MapProjection;
};

export type MapRenderContext = {
  geography: MapGeography | null | undefined;
  idBase: string;
  resolveTileHref: (tile: MapTile) => string | null | undefined;
};

type Point = [number, number];
type MapLayerGeometry = Pick<MapLayer, "height" | "width">;

const radiansPerDegree = Math.PI / 180;
const maxMercatorLatitude = 85;
const globeFillRatio = 0.94;
const highDetailScaleThreshold = 1200;
const maxTileCount = 400;
/** Page units (1/300 in) per tile pixel; standard keeps tile labels legible at about 150 DPI. */
const tileUnitsPerPixel: Record<MapTileDetail, number> = { fine: 1, large: 4, standard: 2 };
/**
 * View centers keep about 1 cm of precision so street-level pans move smoothly instead of
 * snapping: at zoom 18 in a 1500-unit frame, 1e-6 degrees is about one page unit. Matches
 * `mapViewSchema`.
 */
const mapCenterDecimals = 7;

const roundNumber = (value: number, digits = 1): number => {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;

  return Object.is(rounded, -0) ? 0 : rounded;
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const definedEntries = <T extends object>(
  value: { [K in keyof T]?: T[K] | undefined } | undefined,
): Partial<T> =>
  Object.fromEntries(
    Object.entries(value ?? {}).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;

const normalizeLongitude = (longitude: number): number => {
  const wrapped = (((longitude + 180) % 360) + 360) % 360;

  return wrapped - 180;
};

export const resolveMapLayerStyle = (layer: MapLayer): ResolvedMapStyle => {
  const preset = getMapStylePreset(layer.style);
  const isTiles = preset.renderer === "tiles";

  return {
    colors: { ...preset.colors, ...definedEntries<MapStyleColors>(layer.colors) },
    features: isTiles
      ? preset.features
      : { ...preset.features, ...definedEntries<MapStyleFeatures>(layer.features) },
    fontFamily: layer.labelFontFamily ?? preset.fontFamily,
    preset,
    projection: isTiles ? "mercator" : (layer.projection ?? preset.projection),
  };
};

/** Projection scale (page units per radian) at zoom 0, where the whole world spans the layer. */
const baseProjectionScale = (projection: MapProjection, layer: MapLayerGeometry): number => {
  switch (projection) {
    case "orthographic":
      return (Math.min(layer.width, layer.height) / 2) * globeFillRatio;
    case "naturalEarth":
      return layer.width / (2 * Math.PI * 0.8707);
    default:
      return layer.width / (2 * Math.PI);
  }
};

const createBaseProjection = (projection: MapProjection): GeoProjection => {
  switch (projection) {
    case "equirectangular":
      return geoEquirectangular();
    case "naturalEarth":
      return geoNaturalEarth1();
    case "orthographic":
      return geoOrthographic();
    default:
      return geoMercator();
  }
};

const createMapProjection = (
  projection: MapProjection,
  layer: MapLayerGeometry,
  view: MapView,
): GeoProjection => {
  const scale = baseProjectionScale(projection, layer) * 2 ** view.zoom;

  if (projection === "orthographic") {
    return geoOrthographic()
      .rotate([-view.centerLongitude, -view.centerLatitude])
      .scale(scale)
      .translate([layer.width / 2, layer.height / 2])
      .clipAngle(90)
      .precision(0.2);
  }

  const latitude =
    projection === "mercator"
      ? clamp(view.centerLatitude, -maxMercatorLatitude, maxMercatorLatitude)
      : view.centerLatitude;
  const mapProjection = createBaseProjection(projection)
    .rotate([-view.centerLongitude, 0])
    .scale(scale)
    .translate([0, 0])
    .precision(0.2);
  const centerY = mapProjection([view.centerLongitude, latitude])?.[1] ?? 0;

  return mapProjection.translate([layer.width / 2, layer.height / 2 - centerY]).clipExtent([
    [0, 0],
    [layer.width, layer.height],
  ]);
};

/** Picks the longitude at the middle of the smallest arc that covers every longitude. */
const centerLongitudeOf = (longitudes: number[]): number => {
  const sorted = [...new Set(longitudes.map(normalizeLongitude))].sort((a, b) => a - b);

  if (sorted.length <= 1) {
    return sorted[0] ?? 0;
  }

  let largestGap = -1;
  let gapEnd = sorted[0] as number;

  for (const [index, longitude] of sorted.entries()) {
    const next =
      index + 1 < sorted.length ? (sorted[index + 1] as number) : (sorted[0] as number) + 360;
    const gap = next - longitude;

    if (gap > largestGap) {
      largestGap = gap;
      gapEnd = next;
    }
  }

  return normalizeLongitude(gapEnd + (360 - largestGap) / 2);
};

const markerLookup = (layer: MapLayer): Map<string, MapMarker> =>
  new Map(layer.markers.map((marker) => [marker.id, marker]));

const routeEndpoints = (
  route: MapRoute,
  markers: Map<string, MapMarker>,
): [MapMarker, MapMarker] | null => {
  const from = markers.get(route.fromMarkerId);
  const to = markers.get(route.toMarkerId);

  return from && to && from !== to ? [from, to] : null;
};

const markerCoordinates = (marker: MapMarker): Point => [marker.longitude, marker.latitude];

const symbolPadding = (layer: MapLayer): number =>
  Math.max(Math.min(layer.width, layer.height) * 0.1, 90 * layer.symbolScale);

export const resolveMapLayerView = (layer: MapLayer): MapView => {
  if (layer.view.mode === "custom") {
    return {
      centerLatitude: layer.view.centerLatitude,
      centerLongitude: layer.view.centerLongitude,
      zoom: layer.view.zoom,
    };
  }

  const style = resolveMapLayerStyle(layer);
  const isTiles = style.preset.renderer === "tiles";
  const markers = markerLookup(layer);
  const points = layer.markers.map(markerCoordinates);

  for (const route of layer.routes) {
    const endpoints = routeEndpoints(route, markers);

    if (endpoints && (route.path ?? style.preset.route.path) === "geodesic") {
      const interpolate = geoInterpolate(...(endpoints.map(markerCoordinates) as [Point, Point]));

      points.push(interpolate(0.25), interpolate(0.5), interpolate(0.75));
    }
  }

  if (points.length === 0) {
    return {
      centerLatitude: style.projection === "orthographic" ? 20 : 0,
      centerLongitude: 0,
      zoom: 0,
    };
  }

  if (style.projection === "orthographic") {
    const [centerLongitude, centerLatitude] = geoCentroid({
      type: "MultiPoint",
      coordinates: points,
    });
    // Keep the whole sphere in frame so the globe style reads as a globe; custom view can zoom in.
    return {
      centerLatitude: roundNumber(centerLatitude, mapCenterDecimals),
      centerLongitude: roundNumber(centerLongitude, mapCenterDecimals),
      zoom: 0,
    };
  }

  const centerLongitude = centerLongitudeOf(points.map(([longitude]) => longitude));
  const unitProjection = createBaseProjection(style.projection)
    .rotate([-centerLongitude, 0])
    .scale(1)
    .translate([0, 0]);
  const projected = points
    .map((point) =>
      unitProjection([
        point[0],
        style.projection === "mercator"
          ? clamp(point[1], -maxMercatorLatitude, maxMercatorLatitude)
          : point[1],
      ]),
    )
    .filter((point): point is Point => point !== null);

  for (const route of layer.routes) {
    const endpoints = routeEndpoints(route, markers);
    const path = route.path ?? style.preset.route.path;

    if (!endpoints || path !== "arc") continue;

    const [from, to] = endpoints.map((marker) => unitProjection(markerCoordinates(marker)));

    const middle = from && to ? quadraticArc(from, to).pointAt(0.5) : null;

    if (middle) projected.push(middle);
  }

  const xs = projected.map(([x]) => x);
  const ys = projected.map(([, y]) => y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  const padding = symbolPadding(layer);
  const availableWidth = Math.max(layer.width * 0.2, layer.width - padding * 2);
  const availableHeight = Math.max(layer.height * 0.2, layer.height - padding * 2);
  const maxZoom = isTiles ? 16 : 6;
  const singlePointZoom = isTiles ? 9 : 3;
  const fittedScale = Math.min(
    spanX > 1e-9 ? availableWidth / spanX : Number.POSITIVE_INFINITY,
    spanY > 1e-9 ? availableHeight / spanY : Number.POSITIVE_INFINITY,
  );
  const zoom = Number.isFinite(fittedScale)
    ? Math.log2(fittedScale / baseProjectionScale(style.projection, layer))
    : singlePointZoom;
  const centerPoint: Point = [
    (Math.max(...xs) + Math.min(...xs)) / 2,
    (Math.max(...ys) + Math.min(...ys)) / 2,
  ];
  const [, centerLatitude] = unitProjection.invert?.(centerPoint) ?? [0, 0];

  return {
    centerLatitude: roundNumber(centerLatitude, mapCenterDecimals),
    centerLongitude: roundNumber(centerLongitude, mapCenterDecimals),
    zoom: roundNumber(clamp(zoom, 0, maxZoom), 2),
  };
};

const mapScale = (layer: MapLayer, style: ResolvedMapStyle, view: MapView): number =>
  baseProjectionScale(style.projection, layer) * 2 ** view.zoom;

/** Zoom range offered by the map zoom controls; tile styles can zoom to street level. */
export const getMapZoomRange = (layer: MapLayer): { max: number; min: number } => ({
  max: resolveMapLayerStyle(layer).preset.renderer === "tiles" ? 18 : 12,
  min: 0,
});

type CustomMapLayerView = MapLayerView & { mode: "custom" };

const customView = (view: MapView): CustomMapLayerView => ({
  centerLatitude: roundNumber(view.centerLatitude, mapCenterDecimals),
  centerLongitude: roundNumber(normalizeLongitude(view.centerLongitude), mapCenterDecimals),
  mode: "custom",
  zoom: roundNumber(view.zoom, 2),
});

/**
 * Moves the map content by a layer-local offset in page units, as if the map were dragged by
 * hand. Fitted maps switch to a custom view that starts from the fitted framing.
 */
export const panMapLayerView = (
  layer: MapLayer,
  delta: { x: number; y: number },
): CustomMapLayerView => {
  const style = resolveMapLayerStyle(layer);
  const view = resolveMapLayerView(layer);

  if (style.projection === "orthographic") {
    // Spin the globe by the arc the pointer travelled over the sphere's surface.
    const degreesPerUnit = 180 / (Math.PI * mapScale(layer, style, view));

    return customView({
      centerLatitude: clamp(view.centerLatitude + delta.y * degreesPerUnit, -90, 90),
      centerLongitude: view.centerLongitude - delta.x * degreesPerUnit,
      zoom: view.zoom,
    });
  }

  const projection = createMapProjection(style.projection, layer, view);
  const target = projection.invert?.([layer.width / 2 - delta.x, layer.height / 2 - delta.y]);

  if (!target || !Number.isFinite(target[0]) || !Number.isFinite(target[1])) {
    return customView(view);
  }

  const latitudeLimit = style.projection === "mercator" ? maxMercatorLatitude : 90;

  return customView({
    centerLatitude: clamp(target[1], -latitudeLimit, latitudeLimit),
    centerLongitude: target[0],
    zoom: view.zoom,
  });
};

/** Sets the map zoom around its current center, switching fitted maps to a custom view. */
export const zoomMapLayerView = (layer: MapLayer, zoom: number): CustomMapLayerView => {
  const { max, min } = getMapZoomRange(layer);

  return customView({ ...resolveMapLayerView(layer), zoom: clamp(zoom, min, max) });
};

/** Which bundled geography a vector map layer needs, or null for raster tile styles. */
export const getMapLayerGeographyDetail = (layer: MapLayer): MapGeographyDetail | null => {
  const style = resolveMapLayerStyle(layer);

  if (style.preset.renderer === "tiles") {
    return null;
  }

  return mapScale(layer, style, resolveMapLayerView(layer)) > highDetailScaleThreshold
    ? "high"
    : "low";
};

type PlacedTile = MapTile & { size: number; left: number; top: number };

const placeMapTiles = (layer: MapLayer): PlacedTile[] => {
  const style = resolveMapLayerStyle(layer);
  const provider = style.preset.tileProvider;

  if (!provider) {
    return [];
  }

  const view = resolveMapLayerView(layer);
  const projection = createMapProjection("mercator", layer, view);
  const scale = projection.scale();
  const [, translateY] = projection.translate();
  const worldSize = 2 * Math.PI * scale;
  const unitsPerPixel = tileUnitsPerPixel[layer.tileDetail];
  let zoom = clamp(
    Math.round(Math.log2(worldSize / (256 * unitsPerPixel))),
    0,
    mapTileProviders[provider].maxZoom,
  );

  for (;;) {
    const tileCount = 2 ** zoom;
    const tileSize = worldSize / tileCount;
    const originX = layer.width / 2 - scale * (Math.PI + view.centerLongitude * radiansPerDegree);
    const originY = translateY - scale * Math.PI;
    const firstColumn = Math.floor(-originX / tileSize);
    const lastColumn = Math.floor((layer.width - originX) / tileSize);
    const firstRow = Math.max(0, Math.floor(-originY / tileSize));
    const lastRow = Math.min(tileCount - 1, Math.floor((layer.height - originY) / tileSize));
    const count = (lastColumn - firstColumn + 1) * Math.max(0, lastRow - firstRow + 1);

    if (count > maxTileCount && zoom > 0) {
      zoom -= 1;
      continue;
    }

    const tiles: PlacedTile[] = [];
    const seen = new Set<string>();

    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const x = ((column % tileCount) + tileCount) % tileCount;
        const key = `${column}/${row}`;

        if (seen.has(key)) continue;
        seen.add(key);
        tiles.push({
          left: originX + column * tileSize,
          provider,
          size: tileSize,
          top: originY + row * tileSize,
          x,
          y: row,
          z: zoom,
        });
      }
    }

    return tiles;
  }
};

/** Distinct raster tiles a tile-style map layer draws, so exports can prefetch them. */
export const getMapLayerTiles = (layer: MapLayer): MapTile[] => {
  const unique = new Map<string, MapTile>();

  for (const { provider, x, y, z } of placeMapTiles(layer)) {
    unique.set(`${provider}/${z}/${x}/${y}`, { provider, x, y, z });
  }

  return [...unique.values()];
};

const boundsContain = (bounds: MapGeoBounds, longitude: number, latitude: number): boolean =>
  latitude >= bounds.south &&
  latitude <= bounds.north &&
  (bounds.west <= bounds.east
    ? longitude >= bounds.west && longitude <= bounds.east
    : longitude >= bounds.west || longitude <= bounds.east);

/** Country codes containing any of the points, in first-seen order (e.g. to highlight visited countries). */
export const findMapCountryIds = (
  geography: MapGeography,
  points: ReadonlyArray<{ latitude: number; longitude: number }>,
): string[] => {
  const ids = new Set<string>();

  for (const { latitude, longitude } of points) {
    const country = geography.countries.find(
      (candidate) =>
        boundsContain(candidate.bounds, longitude, latitude) &&
        geoContains(candidate.feature, [longitude, latitude]),
    );

    if (country) ids.add(country.id);
  }

  return [...ids];
};

const longitudeSpanIntersects = (
  start: number,
  length: number,
  otherStart: number,
  otherLength: number,
): boolean => {
  if (length >= 360 || otherLength >= 360) return true;

  const forward = (((otherStart - start) % 360) + 360) % 360;
  const backward = (((start - otherStart) % 360) + 360) % 360;

  return forward <= length || backward <= otherLength;
};

type ViewFilter = (bounds: MapGeoBounds) => boolean;

const createViewFilter = (
  projection: GeoProjection,
  projectionId: MapProjection,
  layer: MapLayerGeometry,
  view: MapView,
): ViewFilter => {
  if (projectionId === "orthographic") {
    return () => true;
  }

  const marginDegrees = 2;
  // Natural Earth narrows toward the poles, so widen the longitude window conservatively.
  const xScale = projectionId === "naturalEarth" ? 0.5 : 1;
  const halfSpan = layer.width / 2 / (projection.scale() * xScale) / radiansPerDegree;
  const top = projection.invert?.([layer.width / 2, 0]);
  const bottom = projection.invert?.([layer.width / 2, layer.height]);
  const north = top && Number.isFinite(top[1]) ? top[1] + marginDegrees : 90;
  const south = bottom && Number.isFinite(bottom[1]) ? bottom[1] - marginDegrees : -90;
  const viewStart = view.centerLongitude - halfSpan - marginDegrees;
  const viewLength = halfSpan * 2 + marginDegrees * 2;

  return (bounds) => {
    if (bounds.south > north || bounds.north < south) return false;

    const length =
      bounds.east >= bounds.west ? bounds.east - bounds.west : bounds.east - bounds.west + 360;

    return longitudeSpanIntersects(bounds.west, length, viewStart, viewLength);
  };
};

type VectorPaths = {
  graticule: string;
  highlight: string;
  lakes: string;
  land: string;
  rivers: string;
  sphere: string;
  states: string;
};

const vectorPathCache = new Map<string, VectorPaths>();
const vectorPathCacheLimit = 24;

const joinPaths = (
  features: MapGeographyFeature[],
  path: ReturnType<typeof geoPath>,
  isVisible: ViewFilter,
): string =>
  features
    .filter((geographyFeature) => isVisible(geographyFeature.bounds))
    .map((geographyFeature) => path(geographyFeature.feature) ?? "")
    .join("");

const computeVectorPaths = (
  layer: MapLayer,
  style: ResolvedMapStyle,
  view: MapView,
  projection: GeoProjection,
  geography: MapGeography | null | undefined,
): VectorPaths => {
  const highlighted = [...new Set(layer.highlightedCountries)].sort();
  const cacheKey = JSON.stringify([
    geography?.detail ?? "none",
    style.projection,
    layer.width,
    layer.height,
    view,
    highlighted,
    style.features.lakes,
    style.features.rivers,
    style.features.states,
    style.features.graticule,
  ]);
  const cached = vectorPathCache.get(cacheKey);

  if (cached) {
    vectorPathCache.delete(cacheKey);
    vectorPathCache.set(cacheKey, cached);

    return cached;
  }

  const path = geoPath(projection).digits(1);
  const isVisible = createViewFilter(projection, style.projection, layer, view);
  const highlightedIds = new Set(highlighted);
  const countries = geography?.countries ?? [];
  const paths: VectorPaths = {
    graticule: style.features.graticule ? (path(geoGraticule10()) ?? "") : "",
    highlight: joinPaths(
      countries.filter((country) => highlightedIds.has(country.id)),
      path,
      isVisible,
    ),
    lakes: style.features.lakes && geography ? joinPaths(geography.lakes, path, isVisible) : "",
    land: joinPaths(countries, path, isVisible),
    rivers: style.features.rivers && geography ? joinPaths(geography.rivers, path, isVisible) : "",
    sphere: path({ type: "Sphere" }) ?? "",
    states: style.features.states && geography ? joinPaths(geography.states, path, isVisible) : "",
  };

  vectorPathCache.set(cacheKey, paths);

  if (vectorPathCache.size > vectorPathCacheLimit) {
    const oldestKey = vectorPathCache.keys().next().value;

    if (oldestKey !== undefined) vectorPathCache.delete(oldestKey);
  }

  return paths;
};

type Curve = { d: string; pointAt: (t: number) => Point | null };

const quadraticArc = (from: Point, to: Point, bulge = 0.22): Curve & { control: Point } => {
  const midX = (from[0] + to[0]) / 2;
  const midY = (from[1] + to[1]) / 2;
  const deltaX = to[0] - from[0];
  const deltaY = to[1] - from[1];
  const length = Math.hypot(deltaX, deltaY) || 1;
  let normalX = deltaY / length;
  let normalY = -deltaX / length;

  // Always bow toward the top of the map, like a flight path.
  if (normalY > 0) {
    normalX = -normalX;
    normalY = -normalY;
  }

  const control: Point = [
    midX + normalX * length * bulge * 2 * 0.5,
    midY + normalY * length * bulge * 2 * 0.5,
  ];

  return {
    control,
    d: `M${roundNumber(from[0])} ${roundNumber(from[1])}Q${roundNumber(control[0])} ${roundNumber(control[1])} ${roundNumber(to[0])} ${roundNumber(to[1])}`,
    pointAt: (t) => [
      (1 - t) ** 2 * from[0] + 2 * (1 - t) * t * control[0] + t ** 2 * to[0],
      (1 - t) ** 2 * from[1] + 2 * (1 - t) * t * control[1] + t ** 2 * to[1],
    ],
  };
};

/**
 * Whether a point faces the viewer. A globe still projects far-side points to finite
 * coordinates; only geometry streamed through `geoPath` is clipped to its visible hemisphere.
 */
const isOnVisibleFace = (projection: GeoProjection, coordinates: [number, number]): boolean => {
  const clipAngle = projection.clipAngle();

  // d3 reports 0 (not null) for projections without hemisphere clipping.
  if (!clipAngle) return true;

  const [lambda, phi] = projection.rotate();

  return geoDistance(coordinates, [-lambda, -phi]) <= (clipAngle * Math.PI) / 180;
};

const routeCurve = (
  kind: MapRoute["path"],
  from: MapMarker,
  to: MapMarker,
  projection: GeoProjection,
  path: ReturnType<typeof geoPath>,
): Curve | null => {
  const fromCoordinates = markerCoordinates(from);
  const toCoordinates = markerCoordinates(to);
  const bothVisible =
    isOnVisibleFace(projection, fromCoordinates) && isOnVisibleFace(projection, toCoordinates);

  // Straight and arc routes are drawn in screen space, so a route reaching the far side of a
  // globe follows its clipped great circle instead.
  if (kind === "geodesic" || !bothVisible) {
    const interpolate = geoInterpolate(fromCoordinates, toCoordinates);
    const d = path({
      type: "LineString",
      coordinates: [fromCoordinates, toCoordinates],
    } satisfies GeoPermissibleObjects);

    return d
      ? {
          d,
          pointAt: (t) => {
            const point = interpolate(t);

            return isOnVisibleFace(projection, point) ? projection(point) : null;
          },
        }
      : null;
  }

  const start = projection(fromCoordinates);
  const end = projection(toCoordinates);

  if (!start || !end) {
    return null;
  }

  if (kind === "straight") {
    return {
      d: `M${roundNumber(start[0])} ${roundNumber(start[1])}L${roundNumber(end[0])} ${roundNumber(end[1])}`,
      pointAt: (t) => [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t],
    };
  }

  return quadraticArc(start, end);
};

/** Finds the point and heading a given distance along the curve (negative = from the end). */
const curvePlacement = (
  curve: Curve,
  distance: number | "middle",
): { angle: number; point: Point } | null => {
  const samples: Point[] = [];

  for (let index = 0; index <= 64; index += 1) {
    const point = curve.pointAt(index / 64);

    if (point) samples.push(point);
  }

  if (samples.length < 2) return null;

  const cumulative = [0];

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1] as Point;
    const current = samples[index] as Point;

    cumulative.push(
      (cumulative[index - 1] as number) +
        Math.hypot(current[0] - previous[0], current[1] - previous[1]),
    );
  }

  const total = cumulative[cumulative.length - 1] as number;
  const target =
    distance === "middle"
      ? total / 2
      : distance < 0
        ? Math.max(0, total + distance)
        : Math.min(total, distance);
  const index = Math.max(
    1,
    cumulative.findIndex((length) => length >= target),
  );
  const previous = samples[index - 1] as Point;
  const current = samples[index] as Point;
  const segment = (cumulative[index] as number) - (cumulative[index - 1] as number) || 1;
  const ratio = (target - (cumulative[index - 1] as number)) / segment;

  return {
    angle: Math.atan2(current[1] - previous[1], current[0] - previous[0]),
    point: [
      previous[0] + (current[0] - previous[0]) * ratio,
      previous[1] + (current[1] - previous[1]) * ratio,
    ],
  };
};

const planePath =
  "M0,-14C2,-14 3,-11 3,-8L3,-3L14,4L14,7L3,3L3,9L7,12L7,14L0,12L-7,14L-7,12L-3,9L-3,3L-14,7L-14,4L-3,-3L-3,-8C-3,-11 -2,-14 0,-14Z";

const dashArray = (lineStyle: MapRoute["lineStyle"], width: number): string | null => {
  switch (lineStyle) {
    case "dashed":
      return `${roundNumber(width * 2.8)} ${roundNumber(width * 2.4)}`;
    case "dotted":
      return `0.01 ${roundNumber(width * 2.2)}`;
    default:
      return null;
  }
};

const renderRoutes = (
  layer: MapLayer,
  style: ResolvedMapStyle,
  projection: GeoProjection,
  glowFilterId: string,
): string => {
  const markers = markerLookup(layer);
  const path = geoPath(projection).digits(1);
  const width = style.preset.routeWidth * layer.symbolScale;

  return layer.routes
    .map((route) => {
      const endpoints = routeEndpoints(route, markers);

      if (!endpoints) return "";

      const curve = routeCurve(
        route.path ?? style.preset.route.path,
        ...endpoints,
        projection,
        path,
      );

      if (!curve) return "";

      const color = escapeXml(route.color ?? style.colors.route);
      const lineStyle = route.lineStyle ?? style.preset.route.lineStyle;
      const dash = dashArray(lineStyle, width);
      const decoration = route.decoration ?? style.preset.route.decoration;
      const glow = style.preset.routeGlow ? ` filter="url(#${glowFilterId})"` : "";
      const line = `<path d="${curve.d}" fill="none" stroke="${color}" stroke-width="${roundNumber(width)}" stroke-linecap="round" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ""}${glow} />`;
      let ornament = "";

      if (decoration === "plane") {
        const placement = curvePlacement(curve, "middle");

        if (placement) {
          ornament = `<g transform="translate(${roundNumber(placement.point[0])} ${roundNumber(placement.point[1])}) rotate(${roundNumber((placement.angle * 180) / Math.PI + 90)}) scale(${roundNumber(1.6 * layer.symbolScale, 3)})"><path d="${planePath}" fill="${color}" stroke="${escapeXml(style.colors.halo)}" stroke-width="1.2" stroke-linejoin="round" /></g>`;
        }
      } else if (decoration === "arrow") {
        const arrowLength = Math.max(width * 3.4, 18 * layer.symbolScale);
        const placement = curvePlacement(curve, -(22 * layer.symbolScale));

        if (placement) {
          ornament = `<g transform="translate(${roundNumber(placement.point[0])} ${roundNumber(placement.point[1])}) rotate(${roundNumber((placement.angle * 180) / Math.PI)})"><path d="M0 0L${roundNumber(-arrowLength)} ${roundNumber(arrowLength * 0.55)}L${roundNumber(-arrowLength * 0.72)} 0L${roundNumber(-arrowLength)} ${roundNumber(-arrowLength * 0.55)}Z" fill="${color}" stroke="${color}" stroke-width="${roundNumber(width * 0.4)}" stroke-linejoin="round" /></g>`;
        }
      }

      return `<g data-map-route-id="${escapeXml(route.id)}">${line}${ornament}</g>`;
    })
    .join("");
};

type MarkerExtent = { bottom: number; halfWidth: number; top: number };

const markerIconSvg = (
  icon: MapMarker["icon"],
  point: Point,
  color: string,
  style: ResolvedMapStyle,
  scale: number,
): { extent: MarkerExtent; svg: string } => {
  const [x, y] = point.map((value) => roundNumber(value)) as Point;
  const stroke = escapeXml(style.colors.markerStroke);
  const fill = escapeXml(color);

  switch (icon) {
    case "pin": {
      const size = scale * 0.95;

      return {
        extent: { bottom: 2 * scale, halfWidth: 22 * size, top: 62 * size },
        svg: `<g transform="translate(${x} ${y}) scale(${roundNumber(size, 3)})"><path d="M0 0C-6 -14 -22 -24 -22 -40A22 22 0 1 1 22 -40C22 -24 6 -14 0 0Z" fill="${fill}" stroke="${stroke}" stroke-width="4" stroke-linejoin="round" /><circle cx="0" cy="-40" r="8" fill="${stroke}" /></g>`,
      };
    }
    case "star": {
      const outer = 22 * scale;
      const inner = outer * 0.45;
      const points = Array.from({ length: 10 }, (_, index) => {
        const radius = index % 2 === 0 ? outer : inner;
        const angle = -Math.PI / 2 + (index * Math.PI) / 5;

        return `${roundNumber(x + radius * Math.cos(angle))},${roundNumber(y + radius * Math.sin(angle))}`;
      }).join(" ");

      return {
        extent: { bottom: outer * 0.85, halfWidth: outer, top: outer },
        svg: `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${roundNumber(4 * scale)}" stroke-linejoin="round" />`,
      };
    }
    case "heart": {
      const size = scale * 1.1;

      return {
        extent: { bottom: 18 * size, halfWidth: 22 * size, top: 18 * size },
        svg: `<g transform="translate(${x} ${y}) scale(${roundNumber(size, 3)})"><path d="M0 18C-14 8 -22 0 -22 -8C-22 -15 -16 -20 -10 -20C-5 -20 -2 -17 0 -13C2 -17 5 -20 10 -20C16 -20 22 -15 22 -8C22 0 14 8 0 18Z" fill="${fill}" stroke="${stroke}" stroke-width="4" stroke-linejoin="round" /></g>`,
      };
    }
    case "none":
      return { extent: { bottom: 0, halfWidth: 0, top: 0 }, svg: "" };
    default: {
      const radius = 14 * scale;

      return {
        extent: {
          bottom: radius + 3 * scale,
          halfWidth: radius + 3 * scale,
          top: radius + 3 * scale,
        },
        svg: `<circle cx="${x}" cy="${y}" r="${roundNumber(radius)}" fill="${fill}" stroke="${stroke}" stroke-width="${roundNumber(5 * scale)}" />`,
      };
    }
  }
};

const fontCanRender = (font: Font, text: string): boolean =>
  [...text].every((character) => /\s/.test(character) || font.charToGlyphIndex(character) > 0);

type TextAnchor = "end" | "middle" | "start";

const measureMapText = (fontFamily: string, text: string, size: number): number => {
  const font = getBundledEditorFont(fontFamily);

  return font && fontCanRender(font, text)
    ? font.getAdvanceWidth(text, size)
    : text.length * size * 0.6;
};

type LabelPosition = "above" | "below" | "left" | "right";

const oppositeLabelPosition: Record<LabelPosition, LabelPosition> = {
  above: "below",
  below: "above",
  left: "right",
  right: "left",
};

/** Draws label text as glyph outlines (falling back to SVG text) with a halo behind it. */
const renderMapText = ({
  anchor,
  color,
  fontFamily,
  halo,
  haloWidth,
  size,
  text,
  x,
  y,
}: {
  anchor: TextAnchor;
  color: string;
  fontFamily: string;
  halo: string | null;
  haloWidth: number;
  size: number;
  text: string;
  x: number;
  y: number;
}): string => {
  if (text.trim().length === 0) return "";

  const font = getBundledEditorFont(fontFamily);
  const haloAttributes = halo
    ? ` stroke="${escapeXml(halo)}" stroke-width="${roundNumber(haloWidth)}" stroke-linejoin="round"`
    : "";

  if (font && fontCanRender(font, text)) {
    const advance = font.getAdvanceWidth(text, size);
    const startX = anchor === "middle" ? x - advance / 2 : anchor === "end" ? x - advance : x;
    const d = pathData(font.getPath(text, startX, y, size));

    return `${halo ? `<path d="${d}" fill="none"${haloAttributes} />` : ""}<path d="${d}" fill="${escapeXml(color)}" />`;
  }

  return `<text x="${roundNumber(x)}" y="${roundNumber(y)}" font-family="${escapeXml(fontFamily)}, sans-serif" font-size="${roundNumber(size)}" text-anchor="${anchor}" fill="${escapeXml(color)}"${halo ? `${haloAttributes} paint-order="stroke"` : ""}>${escapeXml(text)}</text>`;
};

const renderMarkers = (
  layer: MapLayer,
  style: ResolvedMapStyle,
  projection: GeoProjection,
  inset: number,
): string => {
  const scale = layer.symbolScale;
  const labelSize = style.preset.labelSize * scale;
  const sublabelSize = labelSize * 0.66;
  const gap = 8 * scale;
  const haloWidth = 7 * scale;
  const bounds = {
    bottom: layer.height - inset,
    left: inset,
    right: layer.width - inset,
    top: inset,
  };

  return layer.markers
    .map((marker) => {
      const coordinates = markerCoordinates(marker);
      const point = projection(coordinates);

      if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return "";
      if (!isOnVisibleFace(projection, coordinates)) return "";

      const icon = marker.icon ?? style.preset.markerIcon;
      const color = marker.color ?? style.colors.marker;
      const { extent, svg } = markerIconSvg(icon, point, color, style, scale);
      const position = marker.labelPosition;
      const hasSublabel = marker.sublabel.trim().length > 0;
      let labels = "";

      if (position !== "hidden" && marker.label.trim().length > 0) {
        const blockWidth = Math.max(
          measureMapText(style.fontFamily, marker.label, labelSize),
          hasSublabel ? measureMapText(style.fontFamily, marker.sublabel, sublabelSize) : 0,
        );
        const layout = (side: LabelPosition) => {
          let anchor: TextAnchor = "middle";
          let x = point[0];
          let y: number;

          switch (side) {
            case "above":
              y =
                point[1] -
                extent.top -
                gap -
                (hasSublabel ? sublabelSize * 1.15 : 0) -
                labelSize * 0.22;
              break;
            case "left":
              anchor = "end";
              x = point[0] - extent.halfWidth - gap * 1.5;
              y = point[1] + labelSize * 0.35 - (hasSublabel ? sublabelSize * 0.55 : 0);
              break;
            case "right":
              anchor = "start";
              x = point[0] + extent.halfWidth + gap * 1.5;
              y = point[1] + labelSize * 0.35 - (hasSublabel ? sublabelSize * 0.55 : 0);
              break;
            default:
              y = point[1] + extent.bottom + gap + labelSize * 0.78;
          }

          const left =
            anchor === "middle" ? x - blockWidth / 2 : anchor === "end" ? x - blockWidth : x;
          const box = {
            bottom: y + (hasSublabel ? sublabelSize * 1.45 : labelSize * 0.25) + haloWidth / 2,
            left: left - haloWidth / 2,
            right: left + blockWidth + haloWidth / 2,
            top: y - labelSize * 0.8 - haloWidth / 2,
          };
          const fits =
            box.left >= bounds.left &&
            box.right <= bounds.right &&
            box.top >= bounds.top &&
            box.bottom <= bounds.bottom;

          return { anchor, box, fits, x, y };
        };
        // Markers panned out of view keep their label beside them so it leaves with the marker.
        const markerVisible =
          point[0] >= 0 && point[0] <= layer.width && point[1] >= 0 && point[1] <= layer.height;
        const preferred = layout(position);
        const flipped =
          preferred.fits || !markerVisible ? preferred : layout(oppositeLabelPosition[position]);
        const chosen = flipped.fits ? flipped : preferred;
        // Slide the label back inside the map when neither side fits on its own.
        const shift = (low: number, high: number, min: number, max: number): number =>
          !markerVisible
            ? 0
            : high - low > max - min
              ? min - low
              : Math.max(min - low, Math.min(0, max - high));
        const anchor = chosen.anchor;
        const labelX =
          chosen.x + shift(chosen.box.left, chosen.box.right, bounds.left, bounds.right);
        const labelY =
          chosen.y + shift(chosen.box.top, chosen.box.bottom, bounds.top, bounds.bottom);

        const common = {
          anchor,
          color: style.colors.label,
          fontFamily: style.fontFamily,
          halo: style.colors.halo,
          x: labelX,
        };

        labels =
          renderMapText({ ...common, haloWidth, size: labelSize, text: marker.label, y: labelY }) +
          (hasSublabel
            ? renderMapText({
                ...common,
                haloWidth: haloWidth * 0.8,
                size: sublabelSize,
                text: marker.sublabel,
                y: labelY + sublabelSize * 1.2,
              })
            : "");
      }

      return `<g data-map-marker-id="${escapeXml(marker.id)}">${svg}${labels}</g>`;
    })
    .join("");
};

const renderTiles = (layer: MapLayer, context: MapRenderContext): string =>
  placeMapTiles(layer)
    .map((tile) => {
      const href = context.resolveTileHref(tile);

      if (!href) return "";

      // A hairline overlap hides antialiasing seams between neighboring tiles.
      const overlap = 0.6;

      return `<image href="${escapeXml(href)}" x="${roundNumber(tile.left, 2)}" y="${roundNumber(tile.top, 2)}" width="${roundNumber(tile.size + overlap, 2)}" height="${roundNumber(tile.size + overlap, 2)}" preserveAspectRatio="none" />`;
    })
    .join("");

const renderAttribution = (layer: MapLayer, style: ResolvedMapStyle): string => {
  const provider = style.preset.tileProvider;

  if (!provider) return "";

  const size = 15 * Math.max(0.8, Math.min(1.4, layer.symbolScale));
  const text = mapTileProviders[provider].attribution;
  const font = getBundledEditorFont("Helvetica Neue");
  const textWidth = font ? font.getAdvanceWidth(text, size) : text.length * size * 0.5;
  const paddingX = size * 0.45;
  const boxWidth = textWidth + paddingX * 2;
  const boxHeight = size * 1.45;
  const boxX = layer.width - boxWidth;
  const boxY = layer.height - boxHeight;

  return `<g data-map-attribution="true"><rect x="${roundNumber(boxX)}" y="${roundNumber(boxY)}" width="${roundNumber(boxWidth)}" height="${roundNumber(boxHeight)}" fill="#ffffff" fill-opacity="0.78" />${renderMapText(
    {
      anchor: "start",
      color: "#333333",
      fontFamily: "Helvetica Neue",
      halo: null,
      haloWidth: 0,
      size,
      text,
      x: boxX + paddingX,
      y: boxY + size * 1.08,
    },
  )}</g>`;
};

const svgFill = (color: string): string => (color === "none" ? "none" : escapeXml(color));

/**
 * Renders a map layer in its local coordinate space (0,0 at the layer's top-left corner).
 * Vector styles project bundled Natural Earth geography with d3-geo; tile styles place
 * Web Mercator raster tiles. Markers, routes, and labels are drawn as vectors on top.
 */
export const renderMapLayerContent = (
  layer: MapLayer,
  context: MapRenderContext,
): { body: string; defs: string } => {
  const style = resolveMapLayerStyle(layer);
  const view = resolveMapLayerView(layer);
  const projection = createMapProjection(style.projection, layer, view);
  const { colors, features, preset } = style;
  const ids = {
    clip: `${context.idBase}_clip`,
    glow: `${context.idBase}_glow`,
    paper: `${context.idBase}_paper`,
    shadow: `${context.idBase}_shadow`,
  };
  const width = roundNumber(layer.width);
  const height = roundNumber(layer.height);
  const cornerRadius = roundNumber(
    Math.min(preset.cornerRadius, layer.width / 2, layer.height / 2),
  );
  const defs: string[] = [
    `<clipPath id="${ids.clip}"><rect x="0" y="0" width="${width}" height="${height}" rx="${cornerRadius}" /></clipPath>`,
  ];
  const parts: string[] = [];

  if (colors.background !== "none") {
    parts.push(
      `<rect x="0" y="0" width="${width}" height="${height}" fill="${svgFill(colors.background)}" />`,
    );
  }

  if (preset.renderer === "tiles") {
    parts.push(`<g data-map-tiles="true">${renderTiles(layer, context)}</g>`);
  } else {
    const paths = computeVectorPaths(layer, style, view, projection, context.geography);
    const borderStroke = features.borders
      ? ` stroke="${svgFill(colors.border)}" stroke-width="${roundNumber(preset.borderWidth * Math.max(0.6, layer.symbolScale), 2)}" stroke-linejoin="round"`
      : "";

    parts.push(
      `<path data-map-ocean="true" d="${paths.sphere}" fill="${svgFill(colors.ocean)}" />`,
    );

    if (paths.graticule) {
      parts.push(
        `<path d="${paths.graticule}" fill="none" stroke="${svgFill(colors.graticule)}" stroke-width="1.2"${preset.graticuleDash ? ` stroke-dasharray="${preset.graticuleDash}"` : ""} />`,
      );
    }

    if (paths.land) {
      if (preset.landShadow) {
        defs.push(
          `<filter id="${ids.shadow}" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceAlpha" stdDeviation="3" /><feOffset dy="3" result="blur" /><feFlood flood-color="${escapeXml(preset.landShadow)}" flood-opacity="0.3" /><feComposite in2="blur" operator="in" /><feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge></filter>`,
        );
      }

      parts.push(
        `<g data-map-land="true"${preset.landShadow ? ` filter="url(#${ids.shadow})"` : ""}><path d="${paths.land}" fill="${svgFill(colors.land)}"${borderStroke} />${paths.highlight ? `<path d="${paths.highlight}" fill="${svgFill(colors.highlight)}"${borderStroke} />` : ""}</g>`,
      );
    }

    if (paths.states) {
      parts.push(
        `<path d="${paths.states}" fill="none" stroke="${svgFill(colors.border)}" stroke-width="${roundNumber(preset.borderWidth * 0.6, 2)}" stroke-opacity="0.7" stroke-dasharray="6 4" />`,
      );
    }

    if (paths.lakes) {
      parts.push(`<path d="${paths.lakes}" fill="${svgFill(colors.water)}" />`);
    }

    if (paths.rivers) {
      parts.push(
        `<path d="${paths.rivers}" fill="none" stroke="${svgFill(colors.water)}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />`,
      );
    }

    if (features.texture) {
      defs.push(
        `<filter id="${ids.paper}" filterUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><feTurbulence type="fractalNoise" baseFrequency="0.35" numOctaves="3" seed="3" /><feColorMatrix values="0 0 0 0 0.45 0 0 0 0 0.33 0 0 0 0 0.2 0 0 0 0.14 0" /></filter>`,
      );
      parts.push(
        `<rect x="0" y="0" width="${width}" height="${height}" filter="url(#${ids.paper})" />`,
      );
    }

    if (style.projection === "orthographic") {
      parts.push(
        `<path d="${paths.sphere}" fill="none" stroke="${svgFill(colors.graticule)}" stroke-width="${roundNumber(3 * layer.symbolScale)}" />`,
      );
    }
  }

  if (preset.routeGlow) {
    defs.push(
      `<filter id="${ids.glow}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${roundNumber(6 * layer.symbolScale)}" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>`,
    );
  }

  parts.push(renderRoutes(layer, style, projection, ids.glow));
  const frameWidth =
    features.frame && preset.frameWidth > 0
      ? preset.frameWidth * Math.max(0.5, layer.symbolScale)
      : 0;

  parts.push(renderMarkers(layer, style, projection, frameWidth + 6 * layer.symbolScale));
  parts.push(renderAttribution(layer, style));

  if (frameWidth > 0) {
    parts.push(
      `<rect x="${roundNumber(frameWidth / 2)}" y="${roundNumber(frameWidth / 2)}" width="${roundNumber(layer.width - frameWidth)}" height="${roundNumber(layer.height - frameWidth)}" rx="${cornerRadius}" fill="none" stroke="${escapeXml(colors.route)}" stroke-width="${roundNumber(frameWidth)}" />`,
    );
  }

  return {
    body: `<g clip-path="url(#${ids.clip})" data-map-style="${layer.style}">${parts.join("")}</g>`,
    defs: defs.join(""),
  };
};
