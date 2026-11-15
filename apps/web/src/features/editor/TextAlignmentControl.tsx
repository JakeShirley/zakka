import {
  TextAlignCenterRegular,
  TextAlignLeftRegular,
  TextAlignRightRegular,
  TextboxAlignBottomRegular,
  TextboxAlignMiddleRegular,
  TextboxAlignTopRegular,
} from "@fluentui/react-icons";
import type { PageLayer } from "@zakka/editor-core";
import type { ReactNode } from "react";

type TextAlignment = Extract<PageLayer, { kind: "text" }>["align"];
type TextVerticalAlignment = Extract<PageLayer, { kind: "text" }>["verticalAlign"];

type AlignmentOption<Value> = { icon: ReactNode; label: string; value: Value };

const textAlignmentOptions: AlignmentOption<TextAlignment>[] = [
  { icon: <TextAlignLeftRegular />, label: "Align left", value: "left" },
  { icon: <TextAlignCenterRegular />, label: "Align center", value: "center" },
  { icon: <TextAlignRightRegular />, label: "Align right", value: "right" },
];

const textVerticalAlignmentOptions: AlignmentOption<TextVerticalAlignment>[] = [
  { icon: <TextboxAlignTopRegular />, label: "Align top", value: "top" },
  { icon: <TextboxAlignMiddleRegular />, label: "Align middle", value: "middle" },
  { icon: <TextboxAlignBottomRegular />, label: "Align bottom", value: "bottom" },
];

function AlignmentSelector<Value extends string>({
  className,
  compact,
  legend,
  options,
  value,
  onChange,
}: {
  className?: string | undefined;
  compact: boolean;
  legend: string;
  options: AlignmentOption<Value>[];
  value: Value;
  onChange: (value: Value) => void;
}) {
  return (
    <fieldset
      className={["text-alignment-selector", className].filter(Boolean).join(" ")}
      data-compact={compact}
    >
      <legend className="visually-hidden">{legend}</legend>
      {options.map((option) => (
        <button
          type="button"
          aria-label={option.label}
          aria-pressed={value === option.value}
          key={option.value}
          title={option.label}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
        </button>
      ))}
    </fieldset>
  );
}

export function TextAlignmentControl({
  className,
  compact = false,
  value,
  onChange,
}: {
  className?: string;
  compact?: boolean;
  value: TextAlignment;
  onChange: (value: TextAlignment) => void;
}) {
  return (
    <AlignmentSelector
      className={className}
      compact={compact}
      legend="Text alignment"
      options={textAlignmentOptions}
      value={value}
      onChange={onChange}
    />
  );
}

export function TextVerticalAlignmentControl({
  className,
  compact = false,
  value,
  onChange,
}: {
  className?: string;
  compact?: boolean;
  value: TextVerticalAlignment;
  onChange: (value: TextVerticalAlignment) => void;
}) {
  return (
    <AlignmentSelector
      className={className}
      compact={compact}
      legend="Vertical text alignment"
      options={textVerticalAlignmentOptions}
      value={value}
      onChange={onChange}
    />
  );
}
