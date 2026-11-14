import {
  findMapCountryIds,
  type MapGeography,
  type MapLayer,
  type MapMarker,
  type MapRoute,
  type MapStyleColors,
  getMapZoomRange,
  type MapStyleFeatures,
  mapMarkerIcons,
  mapMarkerLabelPositions,
  mapProjectionIds,
  mapRouteDecorations,
  mapRouteLineStyles,
  mapRoutePaths,
  mapStylePresets,
  mapTileDetails,
  mapTileProviders,
  resolveMapLayerStyle,
  resolveMapLayerView,
} from "@zakka/editor-core";
import type { MapPlace } from "@zakka/editor-core/map-places";
import { useEffect, useId, useMemo, useState } from "react";

import { NumericInput } from "../../components/NumericInput";
import { FontFamilySelect } from "./FontFamilySelect";

type MapLayerUpdate = Partial<MapLayer>;
type MapColorKey = Exclude<keyof MapLayer["colors"], "background">;
type MapFeatureKey = keyof MapStyleFeatures;

const projectionLabels: Record<(typeof mapProjectionIds)[number], string> = {
  mercator: "Mercator",
  equirectangular: "Equirectangular",
  naturalEarth: "Natural Earth",
  orthographic: "Globe",
};

const tileDetailLabels: Record<(typeof mapTileDetails)[number], string> = {
  large: "Large labels",
  standard: "Standard",
  fine: "Fine detail",
};

const featureLabels: Record<MapFeatureKey, string> = {
  borders: "Borders",
  lakes: "Lakes",
  rivers: "Rivers",
  graticule: "Grid lines",
  states: "States & provinces",
  texture: "Paper texture",
  frame: "Frame",
};

const vectorColorKeys: MapColorKey[] = [
  "ocean",
  "land",
  "border",
  "highlight",
  "water",
  "graticule",
  "route",
  "marker",
  "label",
  "halo",
];
const tileColorKeys: MapColorKey[] = ["route", "marker", "label", "halo"];

const colorLabels: Record<MapColorKey, string> = {
  ocean: "Ocean",
  land: "Land",
  border: "Borders",
  highlight: "Highlight",
  water: "Lakes & rivers",
  graticule: "Grid",
  route: "Routes",
  marker: "Markers",
  label: "Labels",
  halo: "Label halo",
};

const formatOption = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

const toColorInputValue = (color: string): string =>
  /^#[0-9a-f]{6}$/i.test(color) ? color : "#000000";

const createMapItemId = (): string =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

let geographyPromise: Promise<MapGeography> | undefined;

const loadGeography = (): Promise<MapGeography> => {
  geographyPromise ??= import("@zakka/editor-core/map-data").then(({ getMapGeography }) =>
    getMapGeography(),
  );

  return geographyPromise;
};

function useMapGeography(): MapGeography | null {
  const [geography, setGeography] = useState<MapGeography | null>(null);

  useEffect(() => {
    let isCancelled = false;

    loadGeography().then((loaded) => {
      if (!isCancelled) setGeography(loaded);
    });

    return () => {
      isCancelled = true;
    };
  }, []);

  return geography;
}

function useMapPlaceSearch(query: string): MapPlace[] {
  const [places, setPlaces] = useState<MapPlace[]>([]);

  useEffect(() => {
    if (!query.trim()) {
      setPlaces([]);
      return;
    }

    let isCancelled = false;

    import("@zakka/editor-core/map-places").then(({ searchMapPlaces }) => {
      if (!isCancelled) setPlaces(searchMapPlaces(query, 6));
    });

    return () => {
      isCancelled = true;
    };
  }, [query]);

  return places;
}

export function MapControls({
  layer,
  onChange,
}: {
  layer: MapLayer;
  onChange: (update: MapLayerUpdate) => void;
}) {
  const style = resolveMapLayerStyle(layer);
  const isTiles = style.preset.renderer === "tiles";
  const tileProvider = style.preset.tileProvider
    ? mapTileProviders[style.preset.tileProvider]
    : null;
  const fontId = useId();
  const styleGroupName = useId();
  const symbolScaleId = useId();
  const zoomId = useId();

  return (
    <>
      <fieldset className="inspector-section map-controls-section">
        <legend>Map style</legend>
        <div className="map-style-grid" role="radiogroup" aria-label="Map style">
          {mapStylePresets.map((preset) => (
            <label className="map-style-option" key={preset.id} title={preset.description}>
              <input
                checked={preset.id === layer.style}
                name={styleGroupName}
                type="radio"
                value={preset.id}
                onChange={() => onChange({ style: preset.id })}
              />
              <span
                aria-hidden="true"
                className="map-style-swatch"
                style={{
                  background: `linear-gradient(135deg, ${preset.colors.ocean} 0 50%, ${preset.colors.land} 50% 100%)`,
                  borderColor: preset.colors.route,
                }}
              />
              <span>{preset.name}</span>
            </label>
          ))}
        </div>
        <p className="map-controls-hint">{style.preset.description}</p>
        {isTiles ? (
          <>
            <label>
              <span>Tile detail</span>
              <select
                value={layer.tileDetail}
                onChange={(event) =>
                  onChange({ tileDetail: event.currentTarget.value as MapLayer["tileDetail"] })
                }
              >
                {mapTileDetails.map((detail) => (
                  <option key={detail} value={detail}>
                    {tileDetailLabels[detail]}
                  </option>
                ))}
              </select>
            </label>
            {tileProvider ? (
              <p className="map-controls-hint">
                {tileProvider.name} tiles. {tileProvider.attribution}.
              </p>
            ) : null}
          </>
        ) : (
          <label>
            <span>Projection</span>
            <select
              value={layer.projection ?? ""}
              onChange={(event) => {
                const value = event.currentTarget.value;
                onChange({
                  projection: value ? (value as MapLayer["projection"]) : undefined,
                });
              }}
            >
              <option value="">Style default ({projectionLabels[style.preset.projection]})</option>
              {mapProjectionIds.map((projection) => (
                <option key={projection} value={projection}>
                  {projectionLabels[projection]}
                </option>
              ))}
            </select>
          </label>
        )}
        <label htmlFor={fontId}>
          <span>Label font</span>
          <FontFamilySelect
            compact
            id={fontId}
            value={style.fontFamily}
            onChange={(labelFontFamily) => onChange({ labelFontFamily })}
          />
        </label>
        <div className="washi-tape-axis-scale-field">
          <div className="washi-tape-slider-label-row">
            <label htmlFor={symbolScaleId}>Marker & label size</label>
            <output htmlFor={symbolScaleId}>{layer.symbolScale.toFixed(2)}</output>
          </div>
          <div className="washi-tape-slider-row">
            <input
              id={symbolScaleId}
              max={4}
              min={0.25}
              step={0.05}
              type="range"
              value={layer.symbolScale}
              onChange={(event) => onChange({ symbolScale: Number(event.currentTarget.value) })}
            />
            <button
              type="button"
              className="washi-tape-scale-reset-button"
              onClick={() => onChange({ symbolScale: 1 })}
            >
              Reset
            </button>
          </div>
        </div>
      </fieldset>
      <MapPlacesControls layer={layer} onChange={onChange} />
      <MapRoutesControls layer={layer} onChange={onChange} />
      <fieldset className="inspector-section map-controls-section">
        <legend>View</legend>
        <label>
          <span>Framing</span>
          <select
            value={layer.view.mode}
            onChange={(event) => {
              const mode = event.currentTarget.value as MapLayer["view"]["mode"];
              onChange({
                view:
                  mode === "custom"
                    ? { mode, ...resolveMapLayerView(layer) }
                    : { ...layer.view, mode },
              });
            }}
          >
            <option value="fit">Fit to places</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        {layer.view.mode === "custom" ? (
          <>
            <div className="inspector-grid">
              <label>
                <span>Center latitude</span>
                <NumericInput
                  max={90}
                  min={-90}
                  step={0.1}
                  value={layer.view.centerLatitude}
                  onChange={(centerLatitude) =>
                    onChange({ view: { ...layer.view, centerLatitude } })
                  }
                />
              </label>
              <label>
                <span>Center longitude</span>
                <NumericInput
                  max={180}
                  min={-180}
                  step={0.1}
                  value={layer.view.centerLongitude}
                  onChange={(centerLongitude) =>
                    onChange({ view: { ...layer.view, centerLongitude } })
                  }
                />
              </label>
            </div>
            <div className="washi-tape-axis-scale-field">
              <div className="washi-tape-slider-label-row">
                <label htmlFor={zoomId}>Zoom</label>
                <output htmlFor={zoomId}>{layer.view.zoom.toFixed(1)}</output>
              </div>
              <input
                id={zoomId}
                {...getMapZoomRange(layer)}
                step={0.1}
                type="range"
                value={layer.view.zoom}
                onChange={(event) =>
                  onChange({ view: { ...layer.view, zoom: Number(event.currentTarget.value) } })
                }
              />
            </div>
          </>
        ) : null}
      </fieldset>
      {isTiles ? null : <MapFeatureControls layer={layer} onChange={onChange} />}
      {isTiles ? null : <MapCountryControls layer={layer} onChange={onChange} />}
      <MapColorControls layer={layer} onChange={onChange} />
    </>
  );
}

function MapPlacesControls({
  layer,
  onChange,
}: {
  layer: MapLayer;
  onChange: (update: MapLayerUpdate) => void;
}) {
  const [query, setQuery] = useState("");
  const places = useMapPlaceSearch(query);
  const searchId = useId();

  const addPlace = (place: MapPlace) => {
    onChange({
      markers: [
        ...layer.markers,
        {
          id: createMapItemId(),
          label: place.name,
          sublabel: "",
          latitude: place.latitude,
          longitude: place.longitude,
          labelPosition: "below",
        },
      ],
    });
    setQuery("");
  };
  const updateMarker = (markerId: string, update: Partial<MapMarker>) =>
    onChange({
      markers: layer.markers.map((marker) =>
        marker.id === markerId ? { ...marker, ...update } : marker,
      ),
    });
  const removeMarker = (markerId: string) =>
    onChange({
      markers: layer.markers.filter((marker) => marker.id !== markerId),
      routes: layer.routes.filter(
        (route) => route.fromMarkerId !== markerId && route.toMarkerId !== markerId,
      ),
    });
  const styleMarkerColor = resolveMapLayerStyle(layer).colors.marker;

  return (
    <fieldset className="inspector-section map-controls-section">
      <legend>Places</legend>
      <label htmlFor={searchId}>
        <span>Add a place</span>
        <input
          autoComplete="off"
          id={searchId}
          placeholder="Search cities"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              const [firstPlace] = places;
              if (firstPlace) addPlace(firstPlace);
            }
          }}
        />
      </label>
      {places.length > 0 ? (
        <ul className="map-place-results" aria-label="Place results">
          {places.map((place) => (
            <li key={`${place.name}-${place.latitude}-${place.longitude}`}>
              <button type="button" onClick={() => addPlace(place)}>
                <strong>{place.name}</strong>
                <span>{[place.region, place.country].filter(Boolean).join(", ")}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {layer.markers.length > 0 ? (
        <ul className="map-item-list" aria-label="Places on map">
          {layer.markers.map((marker) => (
            <li key={marker.id}>
              <details className="map-item">
                <summary>
                  <span className="map-item-title">{marker.label || "Untitled place"}</span>
                  <button
                    aria-label={`Remove ${marker.label || "place"}`}
                    className="washi-tape-scale-reset-button"
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      removeMarker(marker.id);
                    }}
                  >
                    Remove
                  </button>
                </summary>
                <div className="map-item-body">
                  <label>
                    <span>Label</span>
                    <input
                      maxLength={120}
                      type="text"
                      value={marker.label}
                      onChange={(event) =>
                        updateMarker(marker.id, { label: event.currentTarget.value })
                      }
                    />
                  </label>
                  <label>
                    <span>Caption</span>
                    <input
                      maxLength={160}
                      placeholder="e.g. dates or a note"
                      type="text"
                      value={marker.sublabel}
                      onChange={(event) =>
                        updateMarker(marker.id, { sublabel: event.currentTarget.value })
                      }
                    />
                  </label>
                  <div className="inspector-grid">
                    <label>
                      <span>Latitude</span>
                      <NumericInput
                        max={90}
                        min={-90}
                        step={0.01}
                        value={marker.latitude}
                        onChange={(latitude) => updateMarker(marker.id, { latitude })}
                      />
                    </label>
                    <label>
                      <span>Longitude</span>
                      <NumericInput
                        max={180}
                        min={-180}
                        step={0.01}
                        value={marker.longitude}
                        onChange={(longitude) => updateMarker(marker.id, { longitude })}
                      />
                    </label>
                    <label>
                      <span>Icon</span>
                      <select
                        value={marker.icon ?? ""}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          updateMarker(marker.id, {
                            icon: value ? (value as MapMarker["icon"]) : undefined,
                          });
                        }}
                      >
                        <option value="">Style default</option>
                        {mapMarkerIcons.map((icon) => (
                          <option key={icon} value={icon}>
                            {formatOption(icon)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Label position</span>
                      <select
                        value={marker.labelPosition}
                        onChange={(event) =>
                          updateMarker(marker.id, {
                            labelPosition: event.currentTarget.value as MapMarker["labelPosition"],
                          })
                        }
                      >
                        {mapMarkerLabelPositions.map((position) => (
                          <option key={position} value={position}>
                            {formatOption(position)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <ColorOverrideField
                    label="Marker color"
                    value={marker.color}
                    fallback={styleMarkerColor}
                    onChange={(color) => updateMarker(marker.id, { color })}
                  />
                </div>
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <p className="map-controls-hint">Search for a city to drop a marker on the map.</p>
      )}
    </fieldset>
  );
}

function MapRoutesControls({
  layer,
  onChange,
}: {
  layer: MapLayer;
  onChange: (update: MapLayerUpdate) => void;
}) {
  const style = resolveMapLayerStyle(layer);
  const markerLabel = (markerId: string) =>
    layer.markers.find((marker) => marker.id === markerId)?.label || "Missing place";
  const updateRoute = (routeId: string, update: Partial<MapRoute>) =>
    onChange({
      routes: layer.routes.map((route) => (route.id === routeId ? { ...route, ...update } : route)),
    });
  const connectInOrder = () => {
    const existing = new Map(
      layer.routes.map((route) => [`${route.fromMarkerId}>${route.toMarkerId}`, route]),
    );

    onChange({
      routes: layer.markers.slice(1).map((marker, index) => {
        const from = layer.markers[index] as MapMarker;
        return (
          existing.get(`${from.id}>${marker.id}`) ?? {
            id: createMapItemId(),
            fromMarkerId: from.id,
            toMarkerId: marker.id,
          }
        );
      }),
    });
  };
  const addRoute = () => {
    const from = layer.markers.at(-2);
    const to = layer.markers.at(-1);
    if (!from || !to) return;
    onChange({
      routes: [
        ...layer.routes,
        { id: createMapItemId(), fromMarkerId: from.id, toMarkerId: to.id },
      ],
    });
  };

  if (layer.markers.length < 2 && layer.routes.length === 0) {
    return null;
  }

  return (
    <fieldset className="inspector-section map-controls-section">
      <legend>Routes</legend>
      <div className="map-controls-actions">
        <button
          className="washi-tape-scale-reset-button"
          disabled={layer.markers.length < 2}
          type="button"
          onClick={connectInOrder}
        >
          Connect places in order
        </button>
        <button
          className="washi-tape-scale-reset-button"
          disabled={layer.markers.length < 2}
          type="button"
          onClick={addRoute}
        >
          Add route
        </button>
      </div>
      {layer.routes.length > 0 ? (
        <ul className="map-item-list" aria-label="Routes on map">
          {layer.routes.map((route) => (
            <li key={route.id}>
              <details className="map-item">
                <summary>
                  <span className="map-item-title">
                    {markerLabel(route.fromMarkerId)} → {markerLabel(route.toMarkerId)}
                  </span>
                  <button
                    aria-label={`Remove route ${markerLabel(route.fromMarkerId)} to ${markerLabel(route.toMarkerId)}`}
                    className="washi-tape-scale-reset-button"
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      onChange({ routes: layer.routes.filter(({ id }) => id !== route.id) });
                    }}
                  >
                    Remove
                  </button>
                </summary>
                <div className="map-item-body">
                  <div className="inspector-grid">
                    <label>
                      <span>From</span>
                      <select
                        value={route.fromMarkerId}
                        onChange={(event) =>
                          updateRoute(route.id, { fromMarkerId: event.currentTarget.value })
                        }
                      >
                        {layer.markers.map((marker) => (
                          <option key={marker.id} value={marker.id}>
                            {marker.label || "Untitled place"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>To</span>
                      <select
                        value={route.toMarkerId}
                        onChange={(event) =>
                          updateRoute(route.id, { toMarkerId: event.currentTarget.value })
                        }
                      >
                        {layer.markers.map((marker) => (
                          <option key={marker.id} value={marker.id}>
                            {marker.label || "Untitled place"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <OptionalEnumSelect
                      label="Path"
                      options={mapRoutePaths}
                      styleDefault={style.preset.route.path}
                      value={route.path}
                      onChange={(path) => updateRoute(route.id, { path })}
                    />
                    <OptionalEnumSelect
                      label="Line"
                      options={mapRouteLineStyles}
                      styleDefault={style.preset.route.lineStyle}
                      value={route.lineStyle}
                      onChange={(lineStyle) => updateRoute(route.id, { lineStyle })}
                    />
                    <OptionalEnumSelect
                      label="Decoration"
                      options={mapRouteDecorations}
                      styleDefault={style.preset.route.decoration}
                      value={route.decoration}
                      onChange={(decoration) => updateRoute(route.id, { decoration })}
                    />
                  </div>
                  <ColorOverrideField
                    label="Route color"
                    value={route.color}
                    fallback={style.colors.route}
                    onChange={(color) => updateRoute(route.id, { color })}
                  />
                </div>
              </details>
            </li>
          ))}
        </ul>
      ) : null}
    </fieldset>
  );
}

function OptionalEnumSelect<Option extends string>({
  label,
  options,
  styleDefault,
  value,
  onChange,
}: {
  label: string;
  options: readonly Option[];
  styleDefault: Option;
  value: Option | undefined;
  onChange: (value: Option | undefined) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <select
        value={value ?? ""}
        onChange={(event) => {
          const next = event.currentTarget.value;
          onChange(next ? (next as Option) : undefined);
        }}
      >
        <option value="">Style ({formatOption(styleDefault)})</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {formatOption(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function ColorOverrideField({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string | undefined;
  fallback: string;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <div className="map-color-field">
      <label>
        <input
          type="color"
          value={toColorInputValue(value ?? fallback)}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        <span>{label}</span>
      </label>
      {value ? (
        <button
          aria-label={`Reset ${label.toLowerCase()}`}
          className="washi-tape-scale-reset-button"
          type="button"
          onClick={() => onChange(undefined)}
        >
          Reset
        </button>
      ) : null}
    </div>
  );
}

function MapFeatureControls({
  layer,
  onChange,
}: {
  layer: MapLayer;
  onChange: (update: MapLayerUpdate) => void;
}) {
  const { features } = resolveMapLayerStyle(layer);

  return (
    <fieldset className="inspector-section map-controls-section">
      <legend>Map features</legend>
      <div className="map-feature-grid">
        {(Object.keys(featureLabels) as MapFeatureKey[]).map((key) => (
          <label className="checkbox-label" key={key}>
            <input
              checked={features[key]}
              type="checkbox"
              onChange={(event) =>
                onChange({ features: { ...layer.features, [key]: event.currentTarget.checked } })
              }
            />
            <span>{featureLabels[key]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function MapCountryControls({
  layer,
  onChange,
}: {
  layer: MapLayer;
  onChange: (update: MapLayerUpdate) => void;
}) {
  const geography = useMapGeography();
  const countries = useMemo(
    () => (geography ? [...geography.countries].sort((a, b) => a.name.localeCompare(b.name)) : []),
    [geography],
  );
  const countryNames = useMemo(
    () => new Map(countries.map((country) => [country.id, country.name])),
    [countries],
  );
  const setHighlighted = (ids: string[]) =>
    onChange({ highlightedCountries: [...new Set(ids)].slice(0, 80) });

  return (
    <fieldset className="inspector-section map-controls-section">
      <legend>Highlighted countries</legend>
      <div className="map-controls-actions">
        <button
          className="washi-tape-scale-reset-button"
          disabled={!geography || layer.markers.length === 0}
          type="button"
          onClick={() =>
            geography &&
            setHighlighted([
              ...layer.highlightedCountries,
              ...findMapCountryIds(geography, layer.markers),
            ])
          }
        >
          Highlight countries with places
        </button>
        {layer.highlightedCountries.length > 0 ? (
          <button
            className="washi-tape-scale-reset-button"
            type="button"
            onClick={() => setHighlighted([])}
          >
            Clear
          </button>
        ) : null}
      </div>
      <label>
        <span>Add country</span>
        <select
          disabled={!geography}
          value=""
          onChange={(event) => {
            const id = event.currentTarget.value;
            if (id) setHighlighted([...layer.highlightedCountries, id]);
          }}
        >
          <option value="">{geography ? "Choose a country" : "Loading countries…"}</option>
          {countries
            .filter((country) => !layer.highlightedCountries.includes(country.id))
            .map((country) => (
              <option key={country.id} value={country.id}>
                {country.name}
              </option>
            ))}
        </select>
      </label>
      {layer.highlightedCountries.length > 0 ? (
        <ul className="map-chip-list" aria-label="Highlighted countries">
          {layer.highlightedCountries.map((id) => (
            <li key={id}>
              <span>{countryNames.get(id) ?? id}</span>
              <button
                aria-label={`Remove ${countryNames.get(id) ?? id}`}
                type="button"
                onClick={() =>
                  setHighlighted(layer.highlightedCountries.filter((countryId) => countryId !== id))
                }
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </fieldset>
  );
}

function MapColorControls({
  layer,
  onChange,
}: {
  layer: MapLayer;
  onChange: (update: MapLayerUpdate) => void;
}) {
  const { colors, preset } = resolveMapLayerStyle(layer);
  const keys = preset.renderer === "tiles" ? tileColorKeys : vectorColorKeys;
  const hasOverrides = keys.some((key) => layer.colors[key] !== undefined);

  return (
    <fieldset className="inspector-section map-controls-section">
      <legend>Colors</legend>
      <div className="map-color-grid">
        {keys.map((key) => (
          <label className="map-color-swatch-field" key={key}>
            <input
              type="color"
              value={toColorInputValue(colors[key as keyof MapStyleColors])}
              onChange={(event) =>
                onChange({ colors: { ...layer.colors, [key]: event.currentTarget.value } })
              }
            />
            <span>{colorLabels[key]}</span>
          </label>
        ))}
      </div>
      {hasOverrides ? (
        <button
          className="washi-tape-scale-reset-button"
          type="button"
          onClick={() =>
            onChange({
              colors: layer.colors.background ? { background: layer.colors.background } : {},
            })
          }
        >
          Reset to style colors
        </button>
      ) : null}
    </fieldset>
  );
}
