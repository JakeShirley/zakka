import { Button, Spinner } from "@fluentui/react-components";
import { ArrowClockwiseRegular } from "@fluentui/react-icons";
import type { SystemInfoResponse } from "@zakka/api-contract";
import { useCallback, useEffect, useState } from "react";

import { apiClient } from "../../apiClient";
import { Panel } from "../../components/layout";
import { appVersion } from "../../generated/changelog";
import { getErrorMessage } from "../../lib/errors";
import { formatUptime } from "./formatUptime";

const copilotUrl = "https://github.com/features/copilot";

function CopilotMark() {
  // Octicons `copilot-16` (MIT, https://github.com/primer/octicons).
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
      <path d="M7.998 15.035c-4.562 0-7.873-2.914-7.998-3.749V9.338c.085-.628.677-1.686 1.588-2.065.013-.07.024-.143.036-.218.029-.183.06-.384.126-.612-.201-.508-.254-1.084-.254-1.656 0-.87.128-1.769.693-2.484.579-.733 1.494-1.124 2.724-1.261 1.206-.134 2.262.034 2.944.765.05.053.096.108.139.165.044-.057.094-.112.143-.165.682-.731 1.738-.899 2.944-.765 1.23.137 2.145.528 2.724 1.261.566.715.693 1.614.693 2.484 0 .572-.053 1.148-.254 1.656.066.228.098.429.126.612.012.076.024.148.037.218.924.385 1.522 1.471 1.591 2.095v1.872c0 .766-3.351 3.795-8.002 3.795Zm0-1.485c2.28 0 4.584-1.11 5.002-1.433V7.862l-.023-.116c-.49.21-1.075.291-1.727.291-1.146 0-2.059-.327-2.71-.991A3.222 3.222 0 0 1 8 6.303a3.24 3.24 0 0 1-.544.743c-.65.664-1.563.991-2.71.991-.652 0-1.236-.081-1.727-.291l-.023.116v4.255c.419.323 2.722 1.433 5.002 1.433ZM6.762 2.83c-.193-.206-.637-.413-1.682-.297-1.019.113-1.479.404-1.713.7-.247.312-.369.789-.369 1.554 0 .793.129 1.171.308 1.371.162.181.519.379 1.442.379.853 0 1.339-.235 1.638-.54.315-.322.527-.827.617-1.553.117-.935-.037-1.395-.241-1.614Zm4.155-.297c-1.044-.116-1.488.091-1.681.297-.204.219-.359.679-.242 1.614.091.726.303 1.231.618 1.553.299.305.784.54 1.638.54.922 0 1.28-.198 1.442-.379.179-.2.308-.578.308-1.371 0-.765-.123-1.242-.37-1.554-.233-.296-.693-.587-1.713-.7Z" />
      <path d="M6.25 9.037a.75.75 0 0 1 .75.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 .75-.75Zm4.25.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 1.5 0Z" />
    </svg>
  );
}

export function MadeWithCopilotBadge() {
  return (
    <a className="copilot-badge" href={copilotUrl} target="_blank" rel="noreferrer noopener">
      <span className="copilot-badge-label">Made with</span>
      <span className="copilot-badge-value">
        <CopilotMark />
        GitHub Copilot
      </span>
    </a>
  );
}

export function AboutPanel() {
  const [info, setInfo] = useState<SystemInfoResponse | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadInfo = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await apiClient.getSystemInfo();
      const fetchedAt = Date.now();
      setInfo(response);
      setLoadedAt(fetchedAt);
      setNow(fetchedAt);
    } catch (loadError: unknown) {
      setError(getErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInfo();
  }, [loadInfo]);

  useEffect(() => {
    if (!info) {
      return;
    }

    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [info]);

  const uptimeSeconds = info ? info.uptimeSeconds + (now - loadedAt) / 1000 : 0;

  return (
    <div className="settings-grid settings-about-grid">
      <Panel title="About Zakka">
        <div className="settings-about-intro">
          <p>Zakka is a scrapbook and photo book editor.</p>
          <MadeWithCopilotBadge />
        </div>
        <dl className="metadata-list">
          <div>
            <dt>App version</dt>
            <dd>v{appVersion}</dd>
          </div>
        </dl>
      </Panel>
      <Panel title="Server">
        <div className="settings-log-toolbar settings-about-toolbar">
          <span className="settings-about-status">
            {info ? `Running ${info.service}` : isLoading ? "Loading" : "Unavailable"}
          </span>
          <Button
            type="button"
            className="secondary-button"
            disabled={isLoading}
            icon={<ArrowClockwiseRegular />}
            onClick={loadInfo}
          >
            {isLoading ? "Refreshing" : "Refresh"}
          </Button>
        </div>

        {error ? (
          <p className="panel-alert" role="alert">
            {error}
          </p>
        ) : null}

        {info ? (
          <dl className="metadata-list">
            <div>
              <dt>Server version</dt>
              <dd>v{info.version}</dd>
            </div>
            <div>
              <dt>Uptime</dt>
              <dd>{formatUptime(uptimeSeconds)}</dd>
            </div>
            <div>
              <dt>Started</dt>
              <dd>
                <time dateTime={info.startedAt}>{new Date(info.startedAt).toLocaleString()}</time>
              </dd>
            </div>
            <div>
              <dt>Runtime</dt>
              <dd>Node.js {info.nodeVersion}</dd>
            </div>
            <div>
              <dt>Platform</dt>
              <dd>
                {info.platform} ({info.arch})
              </dd>
            </div>
          </dl>
        ) : isLoading ? (
          <div className="settings-log-loading" aria-busy="true">
            <Spinner size="small" />
            <span>Loading server details</span>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
