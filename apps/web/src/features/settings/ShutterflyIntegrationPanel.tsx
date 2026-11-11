import { Button, Field, Spinner, Textarea } from "@fluentui/react-components";
import { LinkRegular, PlugDisconnectedRegular } from "@fluentui/react-icons";
import type { ShutterflyConnectionResponse } from "@zakka/api-contract";
import { useEffect, useState } from "react";

import { apiClient } from "../../apiClient";
import { Panel } from "../../components/layout";
import { getErrorMessage } from "../../lib/errors";

export function ShutterflyIntegrationPanel() {
  const [connection, setConnection] = useState<ShutterflyConnectionResponse | null>(null);
  const [refreshToken, setRefreshToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isMounted = true;

    apiClient
      .getShutterflyConnection()
      .then((response) => {
        if (isMounted) {
          setConnection(response);
        }
      })
      .catch((loadError: unknown) => {
        if (isMounted) {
          setError(getErrorMessage(loadError));
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const connect = async () => {
    setIsSaving(true);
    setError(null);

    try {
      setConnection(await apiClient.connectShutterfly(refreshToken.trim()));
      setRefreshToken("");
    } catch (connectError: unknown) {
      setError(getErrorMessage(connectError));
    } finally {
      setIsSaving(false);
    }
  };

  const disconnect = async () => {
    setIsSaving(true);
    setError(null);

    try {
      await apiClient.disconnectShutterfly();
      setConnection((current) =>
        current ? { ...current, connected: false, email: null, connectedAt: null } : current,
      );
    } catch (disconnectError: unknown) {
      setError(getErrorMessage(disconnectError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Panel title="Shutterfly">
      <div className="integration-panel">
        <p className="integration-intro">
          Import your saved Shutterfly photo books as Zakka books, including pages, photos, text,
          and stickers.
        </p>

        {connection === null && !error ? (
          <div className="integration-loading" aria-busy="true">
            <Spinner size="tiny" />
            <span>Checking connection</span>
          </div>
        ) : null}

        {connection && !connection.configured ? (
          <p className="empty-state">
            Shutterfly import is not enabled on this server. Ask your Zakka administrator to set{" "}
            <code>SHUTTERFLY_API_KEY</code>.
          </p>
        ) : null}

        {connection?.configured && connection.connected ? (
          <>
            <dl className="metadata-list">
              <div>
                <dt>Account</dt>
                <dd>{connection.email ?? "Connected"}</dd>
              </div>
              {connection.connectedAt ? (
                <div>
                  <dt>Connected</dt>
                  <dd>{new Date(connection.connectedAt).toLocaleString()}</dd>
                </div>
              ) : null}
            </dl>
            <p className="integration-hint">
              Use <strong>Import from Shutterfly</strong> on the Books page to bring in a project.
            </p>
            <div className="integration-actions">
              <Button
                type="button"
                className="secondary-button"
                disabled={isSaving}
                icon={<PlugDisconnectedRegular />}
                onClick={disconnect}
              >
                Disconnect
              </Button>
            </div>
          </>
        ) : null}

        {connection?.configured && !connection.connected ? (
          <form
            className="integration-connect-form"
            onSubmit={(event) => {
              event.preventDefault();
              void connect();
            }}
          >
            <ol className="integration-steps">
              <li>
                In a desktop browser, sign in at{" "}
                <a href="https://www.shutterfly.com" target="_blank" rel="noreferrer">
                  shutterfly.com
                </a>
                .
              </li>
              <li>
                In the same browser, open{" "}
                <a href="https://accounts.shutterfly.com" target="_blank" rel="noreferrer">
                  accounts.shutterfly.com
                </a>{" "}
                and open the developer tools (F12, or Option+Command+I on a Mac).
              </li>
              <li>
                Go to <strong>Application</strong> (<strong>Storage</strong> in Firefox), then{" "}
                <strong>Cookies</strong>, then <code>https://accounts.shutterfly.com</code>.
              </li>
              <li>
                Find the cookie whose name ends in <code>.refreshToken</code> and copy its value.
              </li>
            </ol>
            <Field
              label="Shutterfly refresh token"
              hint="Zakka stores the token encrypted and only uses it to read your projects. It expires about 30 days after you last signed in to Shutterfly."
            >
              <Textarea
                value={refreshToken}
                resize="vertical"
                rows={3}
                spellCheck={false}
                autoComplete="off"
                disabled={isSaving}
                onChange={(event) => setRefreshToken(event.currentTarget.value)}
              />
            </Field>
            <div className="integration-actions">
              <Button
                appearance="primary"
                type="submit"
                className="primary-button"
                disabled={isSaving || refreshToken.trim().length < 20}
                icon={<LinkRegular />}
              >
                {isSaving ? "Connecting" : "Connect Shutterfly"}
              </Button>
            </div>
          </form>
        ) : null}

        {error ? (
          <p className="panel-alert" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
