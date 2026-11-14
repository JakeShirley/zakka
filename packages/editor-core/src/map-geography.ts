import { geoBounds } from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { feature, type merge } from "topojson-client";

export type MapGeographyDetail = "low" | "high";

/** Longitude/latitude bounds; `west > east` means the feature crosses the antimeridian. */
export type MapGeoBounds = { east: number; north: number; south: number; west: number };

export type MapGeographyFeature = {
  bounds: MapGeoBounds;
  feature: Feature<Geometry>;
};

export type MapCountry = MapGeographyFeature & { id: string; name: string };

export type MapGeography = {
  countries: MapCountry[];
  detail: MapGeographyDetail;
  lakes: MapGeographyFeature[];
  rivers: MapGeographyFeature[];
  states: MapGeographyFeature[];
};

// Derived from topojson-client so the editor does not depend on topojson-specification directly.
type Topology = Parameters<typeof merge>[0];
type GeometryCollection = Parameters<typeof feature>[1];

type WorldTopology = Topology & {
  objects: {
    countries: GeometryCollection;
    lakes: GeometryCollection;
    rivers: GeometryCollection;
    states?: GeometryCollection;
  };
};

const toBounds = (geographyFeature: Feature<Geometry>): MapGeoBounds => {
  const [[west, south], [east, north]] = geoBounds(geographyFeature);

  return { east, north, south, west };
};

const toFeatures = (
  topology: WorldTopology,
  object: GeometryCollection | undefined,
): MapGeographyFeature[] => {
  if (!object) {
    return [];
  }

  const collection = feature(topology, object) as unknown as FeatureCollection<Geometry>;

  return collection.features
    .filter((geographyFeature) => geographyFeature.geometry)
    .map((geographyFeature) => ({
      bounds: toBounds(geographyFeature),
      feature: geographyFeature,
    }));
};

export const decodeMapGeography = (
  topologyJson: string,
  detail: MapGeographyDetail,
): MapGeography => {
  const topology = JSON.parse(topologyJson) as WorldTopology;
  const countryCollection = feature(
    topology,
    topology.objects.countries,
  ) as unknown as FeatureCollection<Geometry, { id: string; name: string }>;

  return {
    countries: countryCollection.features
      .filter((country) => country.geometry)
      .map((country) => ({
        bounds: toBounds(country),
        feature: country,
        id: country.properties.id,
        name: country.properties.name,
      })),
    detail,
    lakes: toFeatures(topology, topology.objects.lakes),
    rivers: toFeatures(topology, topology.objects.rivers),
    states: toFeatures(topology, topology.objects.states),
  };
};
