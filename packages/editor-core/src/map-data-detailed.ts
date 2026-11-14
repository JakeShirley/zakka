import { getMapGeography } from "./map-data.js";
import { mapWorld10mTopology } from "./generated/mapWorld10m.js";
import { decodeMapGeography, type MapGeography } from "./map-geography.js";

let cached: MapGeography | undefined;

/**
 * Natural Earth 1:10m countries, lakes, and rivers for zoomed-in maps. Natural Earth's 10m state
 * lines are not vendored, so state and province lines come from the 1:50m dataset.
 */
export const getDetailedMapGeography = (): MapGeography => {
  cached ??= {
    ...decodeMapGeography(mapWorld10mTopology, "high"),
    states: getMapGeography().states,
  };

  return cached;
};
