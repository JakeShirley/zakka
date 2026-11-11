import type { WashiTapeDesign } from "@zakka/editor-core";

export type WashiTapePreset = {
  id: string;
  name: string;
  design: WashiTapeDesign;
};

const preset = (
  id: string,
  name: string,
  outline: WashiTapeDesign["outline"],
  kind: WashiTapeDesign["pattern"]["kind"],
  primaryColor: string,
  secondaryColor: string,
  tile: Partial<WashiTapeDesign["tile"]> = {},
): WashiTapePreset => ({
  id: `builtin:${id}`,
  name,
  design: {
    outline,
    pattern: { kind, primaryColor, secondaryColor },
    tile: { scale: 1, scaleX: 1, scaleY: 1, rotation: 0, offsetX: 0, offsetY: 0, ...tile },
  },
});

export const washiTapePresets: WashiTapePreset[] = [
  preset("mint-dots", "Mint dots", "torn", "polkaDot", "#fffdf7", "#79a9a4"),
  preset("blush-gingham", "Blush gingham", "straight", "checker", "#fde8ec", "#f4a7b9", {
    scaleX: 0.4,
    scaleY: 0.4,
  }),
  preset("sunny-stripes", "Sunny stripes", "angled", "stripe", "#fff4cc", "#f2b134", {
    rotation: 45,
    scaleX: 0.6,
    scaleY: 0.6,
  }),
  preset("kraft-grid", "Kraft grid", "notched", "grid", "#e8d5b5", "#8a6a43", {
    scaleX: 0.5,
    scaleY: 0.5,
  }),
  preset("navy-dots", "Navy dots", "scallop", "polkaDot", "#23395b", "#f5f1e6", {
    scaleX: 0.6,
    scaleY: 0.6,
  }),
  preset("lavender-wave", "Lavender wave", "wave", "stripe", "#efe7ff", "#b79ced", {
    scaleX: 0.7,
    scaleY: 0.7,
  }),
  preset("sage", "Sage", "rounded", "solid", "#b7c9a8", "#b7c9a8"),
  preset("coral-checks", "Coral checks", "stamp", "checker", "#ffd8c9", "#ff8a65", {
    scaleX: 0.5,
    scaleY: 0.5,
  }),
  preset("sky-grid", "Sky grid", "bracket", "grid", "#e3f2fd", "#64b5f6", {
    scaleX: 0.6,
    scaleY: 0.6,
  }),
  preset("butter", "Butter", "tapered", "solid", "#fbe7a1", "#fbe7a1"),
  preset("candy-stripe", "Candy stripe", "pinched", "stripe", "#ffffff", "#e84f6b", {
    rotation: -45,
    scaleX: 0.5,
    scaleY: 0.5,
  }),
  preset("ink-dots", "Ink dots", "torn", "polkaDot", "#f7f3ea", "#2f3437", {
    scaleX: 0.45,
    scaleY: 0.45,
  }),
];
