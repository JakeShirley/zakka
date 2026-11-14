import type { ReactNode } from "react";

import type { HorizontalAlign, SpreadMode, VerticalAlign } from "./arrange";

const Icon = ({ children }: { children: ReactNode }) => (
  <svg aria-hidden="true" className="arrange-icon" viewBox="0 0 20 20">
    {children}
  </svg>
);

const Bar = (props: { height: number; width: number; x: number; y: number }) => (
  <rect {...props} fill="currentColor" rx="1" />
);

const Guide = ({ d }: { d: string }) => (
  <path d={d} stroke="currentColor" strokeDasharray="1.5 1" strokeWidth=".8" />
);

export const AlignTabIcon = () => (
  <Icon>
    <path d="M3 2v16" stroke="currentColor" strokeWidth="1.6" />
    <Bar x={5} y={4} width={11} height={4} />
    <Bar x={5} y={11} width={7} height={4} />
  </Icon>
);

export const SpreadTabIcon = () => (
  <Icon>
    <Bar x={2} y={6} width={4} height={8} />
    <Bar x={8} y={6} width={4} height={8} />
    <Bar x={14} y={6} width={4} height={8} />
  </Icon>
);

export const GridTabIcon = () => (
  <Icon>
    <Bar x={3} y={3} width={6} height={6} />
    <Bar x={11} y={3} width={6} height={6} />
    <Bar x={3} y={11} width={6} height={6} />
    <Bar x={11} y={11} width={6} height={6} />
  </Icon>
);

export const horizontalAlignIcons: Record<Exclude<HorizontalAlign, "none">, ReactNode> = {
  left: <AlignTabIcon />,
  center: (
    <Icon>
      <path d="M10 2v16" stroke="currentColor" strokeWidth="1.6" />
      <Bar x={4} y={4} width={12} height={4} />
      <Bar x={6} y={11} width={8} height={4} />
    </Icon>
  ),
  right: (
    <Icon>
      <path d="M17 2v16" stroke="currentColor" strokeWidth="1.6" />
      <Bar x={4} y={4} width={11} height={4} />
      <Bar x={8} y={11} width={7} height={4} />
    </Icon>
  ),
};

export const verticalAlignIcons: Record<Exclude<VerticalAlign, "none">, ReactNode> = {
  top: (
    <Icon>
      <path d="M2 3h16" stroke="currentColor" strokeWidth="1.6" />
      <Bar x={4} y={5} width={4} height={11} />
      <Bar x={11} y={5} width={4} height={7} />
    </Icon>
  ),
  middle: (
    <Icon>
      <path d="M2 10h16" stroke="currentColor" strokeWidth="1.6" />
      <Bar x={4} y={4} width={4} height={12} />
      <Bar x={11} y={6} width={4} height={8} />
    </Icon>
  ),
  bottom: (
    <Icon>
      <path d="M2 17h16" stroke="currentColor" strokeWidth="1.6" />
      <Bar x={4} y={4} width={4} height={11} />
      <Bar x={11} y={8} width={4} height={7} />
    </Icon>
  ),
};

const edgeBars = [
  { width: 3, y: 6, height: 8 },
  { width: 5, y: 4, height: 12 },
  { width: 3, y: 7, height: 6 },
];
const edgeGuides = [3.5, 10, 16.5];

/** Three bars whose left, center or right edges (`edge` 0, 0.5, 1) sit on evenly spaced guides. */
const EdgeIcon = ({ edge, vertical }: { edge: 0 | 0.5 | 1; vertical?: boolean }) => (
  <Icon>
    <g transform={vertical ? "rotate(90 10 10)" : undefined}>
      {edgeBars.map((bar, index) => (
        <Bar
          key={bar.y}
          x={(edgeGuides[index] ?? 0) - bar.width * edge}
          y={bar.y}
          width={bar.width}
          height={bar.height}
        />
      ))}
      <Guide d={edgeGuides.map((x) => `M${x} 2v16`).join("")} />
    </g>
  </Icon>
);

export const spreadModeIcons: Record<SpreadMode, ReactNode> = {
  gapsHorizontal: (
    <Icon>
      <path d="M2 3v14M18 3v14" stroke="currentColor" strokeWidth="1.4" />
      <Bar x={5} y={6} width={3} height={8} />
      <Bar x={12} y={6} width={3} height={8} />
      <path d="M8.5 10h3" stroke="currentColor" strokeDasharray="1 1" />
    </Icon>
  ),
  gapsVertical: (
    <Icon>
      <path d="M3 2h14M3 18h14" stroke="currentColor" strokeWidth="1.4" />
      <Bar x={6} y={5} width={8} height={3} />
      <Bar x={6} y={12} width={8} height={3} />
      <path d="M10 8.5v3" stroke="currentColor" strokeDasharray="1 1" />
    </Icon>
  ),
  left: <EdgeIcon edge={0} />,
  centerX: <EdgeIcon edge={0.5} />,
  right: <EdgeIcon edge={1} />,
  top: <EdgeIcon edge={0} vertical />,
  centerY: <EdgeIcon edge={0.5} vertical />,
  bottom: <EdgeIcon edge={1} vertical />,
};
