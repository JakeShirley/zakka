import type { Path, PathCommand } from "opentype.js";

const pathNumber = (value: number): string | null => {
  if (!Number.isFinite(value)) {
    return null;
  }

  const roundedValue = Math.round(value * 100) / 100;

  return String(Object.is(roundedValue, -0) ? 0 : roundedValue);
};

const pathCommandData = (command: PathCommand): string | null => {
  switch (command.type) {
    case "M":
    case "L": {
      const x = pathNumber(command.x);
      const y = pathNumber(command.y);

      return x && y ? `${command.type}${x} ${y}` : null;
    }
    case "C": {
      const x1 = pathNumber(command.x1);
      const y1 = pathNumber(command.y1);
      const x2 = pathNumber(command.x2);
      const y2 = pathNumber(command.y2);
      const x = pathNumber(command.x);
      const y = pathNumber(command.y);

      return x1 && y1 && x2 && y2 && x && y ? `C${x1} ${y1} ${x2} ${y2} ${x} ${y}` : null;
    }
    case "Q": {
      const x1 = pathNumber(command.x1);
      const y1 = pathNumber(command.y1);
      const x = pathNumber(command.x);
      const y = pathNumber(command.y);

      return x1 && y1 && x && y ? `Q${x1} ${y1} ${x} ${y}` : null;
    }
    case "Z":
      return "Z";
  }
};

export const pathData = (path: Path): string =>
  path.commands
    .map(pathCommandData)
    .filter((commandData): commandData is string => commandData !== null)
    .join("");

export const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
