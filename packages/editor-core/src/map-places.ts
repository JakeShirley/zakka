import { mapPlacesTsv } from "./generated/mapPlaces.js";

export type MapPlace = {
  country: string;
  latitude: number;
  longitude: number;
  name: string;
  population: number;
  region: string;
};

type IndexedPlace = MapPlace & { key: string };

let places: IndexedPlace[] | undefined;

const normalize = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

const loadPlaces = (): IndexedPlace[] => {
  places ??= mapPlacesTsv
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name = "", region = "", country = "", latitude, longitude, population] =
        line.split("\t");

      return {
        country,
        key: normalize(name),
        latitude: Number(latitude),
        longitude: Number(longitude),
        name,
        population: Number(population) || 0,
        region,
      };
    });

  return places;
};

/**
 * Searches bundled Natural Earth populated places. Name-prefix matches rank before
 * substring matches; ties are broken by population.
 */
export const searchMapPlaces = (query: string, limit = 8): MapPlace[] => {
  const needle = normalize(query);

  if (!needle) {
    return [];
  }

  const ranked: Array<{ place: IndexedPlace; rank: number }> = [];

  for (const place of loadPlaces()) {
    const index = place.key.indexOf(needle);

    if (index >= 0) {
      ranked.push({ place, rank: index === 0 ? (place.key === needle ? 0 : 1) : 2 });
    }
  }

  return ranked
    .sort((a, b) => a.rank - b.rank || b.place.population - a.place.population)
    .slice(0, limit)
    .map(({ place: { key: _key, ...place } }) => place);
};
