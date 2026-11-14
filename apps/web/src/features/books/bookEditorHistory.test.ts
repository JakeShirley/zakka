import { describe, expect, it } from "vitest";

import { getMapMarkerEditKey } from "./bookEditorHistory";

const paris = { id: "paris", label: "Paris", sublabel: "" };
const rome = { id: "rome", label: "Rome", sublabel: "" };

describe("getMapMarkerEditKey", () => {
  it("keys an edit to one field of one marker", () => {
    expect(getMapMarkerEditKey([paris, rome], [paris, { ...rome, label: "Roma" }])).toBe(
      "rome.label",
    );
  });

  it("keeps edits to different markers and fields apart", () => {
    expect(getMapMarkerEditKey([paris, rome], [{ ...paris, label: "P" }, rome])).not.toBe(
      getMapMarkerEditKey([paris, rome], [paris, { ...rome, label: "R" }]),
    );
    expect(getMapMarkerEditKey([paris], [{ ...paris, sublabel: "France" }])).toBe("paris.sublabel");
  });

  it("does not coalesce adding, removing, or reordering places", () => {
    expect(getMapMarkerEditKey([paris], [paris, rome])).toBeNull();
    expect(getMapMarkerEditKey([paris, rome], [paris])).toBeNull();
    expect(getMapMarkerEditKey([paris, rome], [rome, paris])).toBeNull();
  });

  it("does not coalesce edits that touch several markers or fields", () => {
    expect(
      getMapMarkerEditKey(
        [paris, rome],
        [
          { ...paris, label: "P" },
          { ...rome, label: "R" },
        ],
      ),
    ).toBeNull();
    expect(getMapMarkerEditKey([paris], [{ ...paris, label: "P", sublabel: "F" }])).toBeNull();
  });
});
