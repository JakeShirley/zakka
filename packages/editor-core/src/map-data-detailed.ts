import { mapWorld10mTopology } from "./generated/mapWorld10m.js";
import { decodeMapGeography, type MapGeography } from "./map-geography.js";

let cached: MapGeography | undefined;

/** Natural Earth 1:10m countries, states, lakes, and rivers for zoomed-in maps. */
export const getDetailedMapGeography = (): MapGeography => {
  cached ??= decodeMapGeography(mapWorld10mTopology, "high");

  return cached;
};
