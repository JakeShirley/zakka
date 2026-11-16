import { Button, Tab, TabList } from "@fluentui/react-components";
import {
  ChevronLeftRegular,
  ChevronRightRegular,
  FullScreenMaximizeRegular,
  FullScreenMinimizeRegular,
} from "@fluentui/react-icons";

import type { ViewMode } from "./bookEditorTypes";

type BookModeBarProps = {
  canNavigateNext: boolean;
  canNavigatePrevious: boolean;
  isFullscreen: boolean;
  isWorking: boolean;
  leftPageName: string;
  navigationLabel: string;
  rightPageName: string;
  viewMode: ViewMode;
  onNavigate: (direction: -1 | 1) => void;
  onToggleFullscreen: () => void;
  onViewModeChange: (viewMode: ViewMode) => void;
};

export function BookModeBar({
  canNavigateNext,
  canNavigatePrevious,
  isFullscreen,
  isWorking,
  leftPageName,
  navigationLabel,
  rightPageName,
  viewMode,
  onNavigate,
  onToggleFullscreen,
  onViewModeChange,
}: BookModeBarProps) {
  const fullscreenLabel = isFullscreen ? "Exit full screen" : "Full screen";

  return (
    <div className="book-modebar">
      <div className="book-modebar-nav book-modebar-nav-previous">
        <Button
          type="button"
          className="secondary-button compact-icon-button"
          aria-label="Previous"
          title="Previous"
          disabled={!canNavigatePrevious || isWorking}
          icon={<ChevronLeftRegular />}
          onClick={() => onNavigate(-1)}
        />
        <span className="book-modebar-page-name" title={leftPageName}>
          {leftPageName}
        </span>
      </div>
      <div className="book-modebar-view">
        <TabList
          className="book-view-toggle"
          aria-label="Editor view"
          selectedValue={viewMode}
          onTabSelect={(_, data) => onViewModeChange(data.value as ViewMode)}
        >
          <Tab value="page">Page</Tab>
          <Tab value="spread">Spread</Tab>
        </TabList>
        <Button
          type="button"
          appearance="subtle"
          className="compact-icon-button"
          aria-label={fullscreenLabel}
          aria-pressed={isFullscreen}
          title={isFullscreen ? `${fullscreenLabel} (Esc)` : fullscreenLabel}
          icon={isFullscreen ? <FullScreenMinimizeRegular /> : <FullScreenMaximizeRegular />}
          onClick={onToggleFullscreen}
        />
      </div>
      <div className="book-modebar-nav book-modebar-nav-next">
        <span className="book-modebar-page-name" title={rightPageName}>
          {rightPageName}
        </span>
        <Button
          type="button"
          className="secondary-button compact-icon-button"
          aria-label="Next"
          title="Next"
          disabled={!canNavigateNext || isWorking}
          icon={<ChevronRightRegular />}
          onClick={() => onNavigate(1)}
        />
      </div>
      <span className="book-modebar-status">{navigationLabel}</span>
    </div>
  );
}
