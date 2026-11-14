import { Button, Spinner, Tab, TabList } from "@fluentui/react-components";
import { ArrowClockwiseRegular } from "@fluentui/react-icons";
import type { ServerLogEntryResponse, ServerLogLevel } from "@zakka/api-contract";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import { apiClient } from "../../apiClient";
import { Panel, WorkspaceHeader } from "../../components/layout";
import { getErrorMessage } from "../../lib/errors";
import type { AuthSession } from "../../types";
import { AppearancePanel } from "./AppearancePanel";
import { ShutterflyIntegrationPanel } from "./ShutterflyIntegrationPanel";

const settingsTabs = ["account", "appearance", "integrations", "logs"] as const;

type SettingsTab = (typeof settingsTabs)[number];

const isSettingsTab = (value: string | null): value is SettingsTab =>
  settingsTabs.includes(value as SettingsTab);

const logLevels: ServerLogLevel[] = ["debug", "info", "warn", "error"];
const logLevelLabels: Record<ServerLogLevel, string> = {
  debug: "Debug",
  info: "Info",
  warn: "Warn",
  error: "Error",
};

const formatLogTimestamp = (timestamp: string): string => new Date(timestamp).toLocaleString();

const formatDuration = (durationMs: number | null): string =>
  durationMs === null ? "n/a" : `${durationMs.toFixed(1)}ms`;

const formatRequestSummary = (log: ServerLogEntryResponse): string =>
  [log.method, log.path, log.status === null ? null : String(log.status)].filter(Boolean).join(" ");

export function SettingsView({ session }: { session: AuthSession }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const selectedTab: SettingsTab = isSettingsTab(requestedTab) ? requestedTab : "account";
  const setSelectedTab = (tab: SettingsTab) =>
    setSearchParams(tab === "account" ? {} : { tab }, { replace: true });
  const [logLevel, setLogLevel] = useState<ServerLogLevel>("info");
  const [logs, setLogs] = useState<ServerLogEntryResponse[]>([]);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  const loadLogs = useCallback(async () => {
    setIsLoadingLogs(true);
    setLogsError(null);

    try {
      const response = await apiClient.listServerLogs(logLevel);
      setLogs(response.logs);
    } catch (error: unknown) {
      setLogsError(getErrorMessage(error));
    } finally {
      setIsLoadingLogs(false);
    }
  }, [logLevel]);

  useEffect(() => {
    if (selectedTab === "logs") {
      void loadLogs();
    }
  }, [loadLogs, selectedTab]);

  return (
    <>
      <WorkspaceHeader title="Settings" />
      <TabList
        className="segmented-control settings-tab-list"
        aria-label="Settings section"
        selectedValue={selectedTab}
        onTabSelect={(_, data) => setSelectedTab(data.value as SettingsTab)}
      >
        <Tab value="account">Account</Tab>
        <Tab value="appearance">Appearance</Tab>
        <Tab value="integrations">Integrations</Tab>
        <Tab value="logs">Logs</Tab>
      </TabList>

      {selectedTab === "account" ? (
        <div className="settings-grid">
          <Panel title="Account">
            <dl className="metadata-list">
              <div>
                <dt>Name</dt>
                <dd>{session.account.displayName}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{session.account.primaryEmail}</dd>
              </div>
            </dl>
          </Panel>
          <Panel title="Session">
            <dl className="metadata-list">
              <div>
                <dt>Session</dt>
                <dd>{session.session.id}</dd>
              </div>
              <div>
                <dt>Expires</dt>
                <dd>{new Date(session.session.expiresAt).toLocaleString()}</dd>
              </div>
            </dl>
          </Panel>
        </div>
      ) : selectedTab === "appearance" ? (
        <div className="settings-grid settings-appearance-grid">
          <AppearancePanel />
        </div>
      ) : selectedTab === "integrations" ? (
        <div className="settings-grid settings-integrations-grid">
          <ShutterflyIntegrationPanel />
        </div>
      ) : (
        <div className="settings-log-shell">
          <Panel title="Server Logs" {...(logs.length ? { count: String(logs.length) } : {})}>
            <div className="settings-log-toolbar">
              <label htmlFor="settings-log-level">
                <span>Verbosity</span>
                <select
                  id="settings-log-level"
                  value={logLevel}
                  onChange={(event) => setLogLevel(event.target.value as ServerLogLevel)}
                >
                  {logLevels.map((level) => (
                    <option key={level} value={level}>
                      {logLevelLabels[level]}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                className="secondary-button"
                disabled={isLoadingLogs}
                icon={<ArrowClockwiseRegular />}
                onClick={loadLogs}
              >
                {isLoadingLogs ? "Refreshing" : "Refresh"}
              </Button>
            </div>

            {logsError ? (
              <p className="panel-alert" role="alert">
                {logsError}
              </p>
            ) : null}

            {isLoadingLogs && logs.length === 0 ? (
              <div className="settings-log-loading" aria-busy="true">
                <Spinner size="small" />
                <span>Loading logs</span>
              </div>
            ) : logs.length ? (
              <ol className="server-log-list">
                {logs.map((log) => (
                  <li className="server-log-entry" data-level={log.level} key={log.id}>
                    <div className="server-log-meta">
                      <span className="server-log-level">{logLevelLabels[log.level]}</span>
                      <time dateTime={log.timestamp}>{formatLogTimestamp(log.timestamp)}</time>
                      {formatRequestSummary(log) ? <span>{formatRequestSummary(log)}</span> : null}
                    </div>
                    <p>{log.message}</p>
                    <dl className="server-log-details">
                      <div>
                        <dt>Request</dt>
                        <dd>{log.requestId ?? "n/a"}</dd>
                      </div>
                      <div>
                        <dt>Duration</dt>
                        <dd>{formatDuration(log.durationMs)}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="empty-state">No logs at this verbosity.</p>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}
