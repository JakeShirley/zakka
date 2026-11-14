import opentype, { type Font } from "opentype.js";

import { googleFontBase64ByVendorPath } from "./generated/googleFonts.js";
import { type GoogleFontDefinition, type GoogleFontId, googleFonts } from "./google-fonts.js";

export const defaultTextFontFamily = "Inter, sans-serif";
export const loveYaLikeASisterFontFamily = "Love Ya Like A Sister";

export type EditorFontId = "system" | GoogleFontId;
export type EditorFontCategory = "system" | GoogleFontDefinition["category"];
export type EditorFontMatchKind = GoogleFontDefinition["matchKind"] | "bundled";

export type EditorFontDefinition = {
  category: EditorFontCategory;
  family: string;
  googleFamily?: string;
  id: EditorFontId;
  label: string;
  license: string;
  matchKind: EditorFontMatchKind;
  source: string;
  vendorPath?: string;
};

const googleFontDefinitions: readonly EditorFontDefinition[] = googleFonts.map((font) => ({
  category: font.category,
  family: font.family,
  googleFamily: font.googleFamily,
  id: font.id,
  label: font.label,
  license: font.license,
  matchKind: font.matchKind,
  source: `Google Fonts: ${font.googleFamily}`,
  vendorPath: font.vendorPath,
}));

export const editorFontDefinitions: readonly EditorFontDefinition[] = [
  {
    category: "system",
    family: defaultTextFontFamily,
    id: "system",
    label: "Inter",
    license: "System font stack",
    matchKind: "bundled",
    source: "Bundled app default",
  },
  ...googleFontDefinitions,
];

const cssString = (value: string): string => value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

const fontFaceCss = (family: string, fontBase64: string): string =>
  `@font-face{font-family:'${cssString(family)}';font-style:normal;font-weight:400;font-display:swap;src:url(data:font/woff;base64,${fontBase64}) format('woff');}`;

const googleFontBase64 = (font: GoogleFontDefinition): string => {
  const fontBase64 = googleFontBase64ByVendorPath[font.vendorPath];

  if (!fontBase64) {
    throw new Error(`Missing bundled font file ${font.vendorPath} for ${font.family}`);
  }

  return fontBase64;
};

const googleFontFaceCss = googleFonts
  .map((font) => fontFaceCss(font.family, googleFontBase64(font)))
  .join("");

export const editorFontFaceCss = googleFontFaceCss;

const googleFontByFamily = new Map<string, GoogleFontDefinition>(
  googleFonts.map((font) => [font.family, font]),
);
const parsedFontByVendorPath = new Map<string, Font>();

const primaryFontFamily = (fontFamily: string): string =>
  fontFamily
    .split(",")[0]
    ?.trim()
    .replace(/^['"]|['"]$/g, "") ?? fontFamily;

const decodeBase64Font = (fontBase64: string): ArrayBuffer => {
  const binaryFont = globalThis.atob(fontBase64);
  const fontBytes = new Uint8Array(binaryFont.length);

  for (let byteIndex = 0; byteIndex < binaryFont.length; byteIndex += 1) {
    fontBytes[byteIndex] = binaryFont.charCodeAt(byteIndex);
  }

  return fontBytes.buffer;
};

export const getEditorFontByFamily = (fontFamily: string): EditorFontDefinition | undefined => {
  const family = primaryFontFamily(fontFamily);

  return editorFontDefinitions.find((fontDefinition) => fontDefinition.family === family);
};

export const getBundledEditorFont = (fontFamily: string): Font | null => {
  const googleFont = googleFontByFamily.get(primaryFontFamily(fontFamily));

  if (!googleFont) {
    return null;
  }

  const existingFont = parsedFontByVendorPath.get(googleFont.vendorPath);

  if (existingFont) {
    return existingFont;
  }

  const parsedFont = opentype.parse(decodeBase64Font(googleFontBase64(googleFont)));

  parsedFontByVendorPath.set(googleFont.vendorPath, parsedFont);

  return parsedFont;
};
