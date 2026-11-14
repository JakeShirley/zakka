import { mapWorld50mTopology } from "./generated/mapWorld50m.js";
import { decodeMapGeography, type MapGeography } from "./map-geography.js";

let cached: MapGeography | undefined;

/** Natural Earth 1:50m countries, lakes, and rivers for regional and world maps. */
export const getMapGeography = (): MapGeography => {
  cached ??= decodeMapGeography(mapWorld50mTopology, "low");

  return cached;
};
