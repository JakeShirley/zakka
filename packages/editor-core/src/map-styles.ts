export const mapStyleIds = [
  "atlas",
  "vintage",
  "pastel",
  "midnight",
  "minimal",
  "globe",
  "osm",
  "esriTopo",
] as const;
export type MapStyleId = (typeof mapStyleIds)[number];

export const mapProjectionIds = [
  "mercator",
  "equirectangular",
  "naturalEarth",
  "orthographic",
] as const;
export type MapProjection = (typeof mapProjectionIds)[number];

export const mapTileProviderIds = ["osm", "esriTopo"] as const;
export type MapTileProvider = (typeof mapTileProviderIds)[number];

export const mapMarkerIcons = ["dot", "pin", "star", "heart", "none"] as const;
export type MapMarkerIcon = (typeof mapMarkerIcons)[number];

export const mapMarkerLabelPositions = ["below", "above", "left", "right", "hidden"] as const;
export const mapRoutePaths = ["arc", "geodesic", "straight"] as const;
export type MapRoutePath = (typeof mapRoutePaths)[number];
export const mapRouteLineStyles = ["solid", "dashed", "dotted"] as const;
export type MapRouteLineStyle = (typeof mapRouteLineStyles)[number];
export const mapRouteDecorations = ["none", "arrow", "plane"] as const;
export type MapRouteDecoration = (typeof mapRouteDecorations)[number];
export const mapTileDetails = ["large", "standard", "fine"] as const;
export type MapTileDetail = (typeof mapTileDetails)[number];

export type MapStyleColors = {
  /** Fill behind everything; `none` lets the page show through (e.g. around a globe). */
  background: string;
  ocean: string;
  land: string;
  border: string;
  highlight: string;
  water: string;
  graticule: string;
  route: string;
  marker: string;
  markerStroke: string;
  pinFill: string;
  label: string;
  halo: string;
};

export type MapStyleFeatures = {
  borders: boolean;
  lakes: boolean;
  rivers: boolean;
  graticule: boolean;
  states: boolean;
  texture: boolean;
  frame: boolean;
};

export type MapStylePreset = {
  id: MapStyleId;
  name: string;
  description: string;
  /** `tiles` styles draw Web Mercator raster tiles from `tileProvider`. */
  renderer: "tiles" | "vector";
  tileProvider: MapTileProvider | null;
  projection: MapProjection;
  colors: MapStyleColors;
  features: MapStyleFeatures;
  borderWidth: number;
  graticuleDash: string | null;
  landShadow: string | null;
  routeGlow: boolean;
  routeWidth: number;
  route: { decoration: MapRouteDecoration; lineStyle: MapRouteLineStyle; path: MapRoutePath };
  markerIcon: MapMarkerIcon;
  cornerRadius: number;
  frameWidth: number;
  fontFamily: string;
  labelSize: number;
};

const vectorDefaults = {
  renderer: "vector",
  tileProvider: null,
  graticuleDash: null,
  landShadow: null,
  routeGlow: false,
  routeWidth: 5,
  cornerRadius: 0,
  frameWidth: 0,
  labelSize: 32,
} as const;

const tileStyleColors = {
  ocean: "#aad3df",
  land: "#f2efe9",
  border: "#9e9e9e",
  highlight: "#f2efe9",
  water: "#aad3df",
  graticule: "#9e9e9e",
  route: "#c1121f",
  marker: "#c1121f",
  markerStroke: "#ffffff",
  pinFill: "#ffffff",
  label: "#1d2b36",
  halo: "#ffffff",
} as const;

const noVectorFeatures: MapStyleFeatures = {
  borders: false,
  lakes: false,
  rivers: false,
  graticule: false,
  states: false,
  texture: false,
  frame: false,
};

export const mapStylePresets: readonly MapStylePreset[] = [
  {
    ...vectorDefaults,
    id: "atlas",
    name: "Atlas",
    description: "Classic school-atlas colors with rivers, lakes, and highlighted countries.",
    projection: "mercator",
    colors: {
      background: "#a9d3e3",
      ocean: "#a9d3e3",
      land: "#e9ead2",
      border: "#ffffff",
      highlight: "#cfe3b6",
      water: "#a9d3e3",
      graticule: "#93c2d4",
      route: "#9b2226",
      marker: "#c1121f",
      markerStroke: "#ffffff",
      pinFill: "#ffffff",
      label: "#1d2b36",
      halo: "#ffffff",
    },
    features: { ...noVectorFeatures, borders: true, lakes: true, rivers: true, states: true },
    borderWidth: 1.6,
    route: { path: "arc", lineStyle: "dashed", decoration: "none" },
    markerIcon: "dot",
    fontFamily: "Helvetica Neue Bold",
  },
  {
    ...vectorDefaults,
    id: "vintage",
    name: "Vintage",
    description: "Sepia paper, dashed graticule, and an ink frame like an old explorer's chart.",
    projection: "equirectangular",
    colors: {
      background: "#d9c9a3",
      ocean: "#d9c9a3",
      land: "#f3e6c4",
      border: "#8a6d43",
      highlight: "#e8d29f",
      water: "#c4b48e",
      graticule: "#a88f62",
      route: "#6b3e1f",
      marker: "#6b3e1f",
      markerStroke: "#f3e6c4",
      pinFill: "#f3e6c4",
      label: "#4a2f17",
      halo: "#f3e6c4",
    },
    features: {
      ...noVectorFeatures,
      borders: true,
      lakes: true,
      rivers: true,
      graticule: true,
      texture: true,
      frame: true,
    },
    borderWidth: 1.2,
    graticuleDash: "4 6",
    routeWidth: 6,
    route: { path: "arc", lineStyle: "dotted", decoration: "none" },
    markerIcon: "dot",
    frameWidth: 14,
    fontFamily: "Baskerville",
    labelSize: 34,
  },
  {
    ...vectorDefaults,
    id: "pastel",
    name: "Scrapbook pastel",
    description: "Soft pastels, rounded corners, a dotted flight path, and a little plane.",
    projection: "naturalEarth",
    colors: {
      background: "#cfe8ef",
      ocean: "#cfe8ef",
      land: "#fbe3e8",
      border: "#ffffff",
      highlight: "#f6a5b8",
      water: "#cfe8ef",
      graticule: "#b9dbe5",
      route: "#e76f8b",
      marker: "#e76f8b",
      markerStroke: "#ffffff",
      pinFill: "#ffffff",
      label: "#5b3a4a",
      halo: "#fffdf7",
    },
    features: { ...noVectorFeatures, borders: true, lakes: true },
    borderWidth: 2,
    landShadow: "#b07a88",
    routeWidth: 8,
    route: { path: "arc", lineStyle: "dotted", decoration: "plane" },
    markerIcon: "heart",
    cornerRadius: 48,
    fontFamily: "Felt Tip",
    labelSize: 36,
  },
  {
    ...vectorDefaults,
    id: "midnight",
    name: "Midnight",
    description: "Deep navy with a glowing gold route.",
    projection: "mercator",
    colors: {
      background: "#0b1a2e",
      ocean: "#0b1a2e",
      land: "#1f3a5a",
      border: "#3d6189",
      highlight: "#2d5580",
      water: "#0b1a2e",
      graticule: "#16304f",
      route: "#ffc857",
      marker: "#ffc857",
      markerStroke: "#0b1a2e",
      pinFill: "#ffc857",
      label: "#ffe7a8",
      halo: "#0b1a2e",
    },
    features: { ...noVectorFeatures, borders: true, lakes: true, graticule: true },
    borderWidth: 1,
    routeGlow: true,
    route: { path: "arc", lineStyle: "solid", decoration: "none" },
    markerIcon: "dot",
    fontFamily: "Avenir",
  },
  {
    ...vectorDefaults,
    id: "minimal",
    name: "Minimal",
    description: "Quiet grays and white land that let your photos lead.",
    projection: "naturalEarth",
    colors: {
      background: "#f1f1ee",
      ocean: "#f1f1ee",
      land: "#ffffff",
      border: "#c9c9c4",
      highlight: "#e4e4de",
      water: "#f1f1ee",
      graticule: "#e2e2dc",
      route: "#202426",
      marker: "#202426",
      markerStroke: "#ffffff",
      pinFill: "#ffffff",
      label: "#202426",
      halo: "#ffffff",
    },
    features: { ...noVectorFeatures, borders: true, lakes: true },
    borderWidth: 1,
    routeWidth: 3,
    route: { path: "arc", lineStyle: "dashed", decoration: "none" },
    markerIcon: "dot",
    fontFamily: "Helvetica Neue",
    labelSize: 30,
  },
  {
    ...vectorDefaults,
    id: "globe",
    name: "Globe",
    description: "An orthographic globe with great-circle routes, floating on the page.",
    projection: "orthographic",
    colors: {
      background: "none",
      ocean: "#bfdcea",
      land: "#d9e8c4",
      border: "#ffffff",
      highlight: "#b5d39a",
      water: "#bfdcea",
      graticule: "#a7c9da",
      route: "#c8553d",
      marker: "#c8553d",
      markerStroke: "#ffffff",
      pinFill: "#ffffff",
      label: "#2c3e2d",
      halo: "#ffffff",
    },
    features: { ...noVectorFeatures, borders: true, lakes: true, graticule: true },
    borderWidth: 1.4,
    landShadow: "#6b8f5a",
    route: { path: "geodesic", lineStyle: "dashed", decoration: "none" },
    markerIcon: "dot",
    fontFamily: "Avenir Bold",
  },
  {
    ...vectorDefaults,
    id: "osm",
    name: "Street map",
    description: "OpenStreetMap tiles with roads and place names. Best for city-scale maps.",
    renderer: "tiles",
    tileProvider: "osm",
    projection: "mercator",
    colors: { ...tileStyleColors, background: "#aad3df" },
    features: noVectorFeatures,
    borderWidth: 1,
    route: { path: "arc", lineStyle: "dashed", decoration: "none" },
    markerIcon: "pin",
    fontFamily: "Helvetica Neue Bold",
  },
  {
    ...vectorDefaults,
    id: "esriTopo",
    name: "Topographic",
    description: "Esri World Topographic tiles with terrain shading and place names.",
    renderer: "tiles",
    tileProvider: "esriTopo",
    projection: "mercator",
    colors: { ...tileStyleColors, background: "#a6c6e6", route: "#b5179e", marker: "#b5179e" },
    features: noVectorFeatures,
    borderWidth: 1,
    route: { path: "arc", lineStyle: "dashed", decoration: "none" },
    markerIcon: "pin",
    fontFamily: "Helvetica Neue Bold",
  },
];

const mapStylePresetById = new Map(mapStylePresets.map((preset) => [preset.id, preset]));

export const getMapStylePreset = (styleId: MapStyleId): MapStylePreset =>
  mapStylePresetById.get(styleId) ?? (mapStylePresets[0] as MapStylePreset);

export const mapTileProviders: Record<
  MapTileProvider,
  { attribution: string; maxZoom: number; name: string; urlTemplate: string }
> = {
  osm: {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
    name: "OpenStreetMap",
    urlTemplate: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  },
  esriTopo: {
    attribution: "Tiles © Esri and the GIS User Community",
    maxZoom: 19,
    name: "Esri World Topographic Map",
    urlTemplate:
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
  },
};

export const getMapTileUrl = (tile: MapTile): string =>
  mapTileProviders[tile.provider].urlTemplate
    .replace("{z}", String(tile.z))
    .replace("{x}", String(tile.x))
    .replace("{y}", String(tile.y));

export type MapTile = { provider: MapTileProvider; x: number; y: number; z: number };
