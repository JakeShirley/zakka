import { Button, Field, Input, Spinner } from "@fluentui/react-components";
import { AddRegular, CheckmarkRegular, CopyRegular, DeleteRegular } from "@fluentui/react-icons";
import {
  type AccessTokenCreateResponse,
  type AccessTokenResponse,
  mcpEndpointPath,
} from "@zakka/api-contract";
import { useEffect, useState } from "react";

import { apiClient } from "../../apiClient";
import { Panel } from "../../components/layout";
import { getErrorMessage } from "../../lib/errors";

const getMcpServerUrl = (): string =>
  `${import.meta.env.VITE_API_BASE_URL || window.location.origin}${mcpEndpointPath}`;

const createClientConfig = (url: string, secret: string): string =>
  JSON.stringify(
    {
      mcpServers: {
        zakka: { type: "http", url, headers: { Authorization: `Bearer ${secret}` } },
      },
    },
    null,
    2,
  );

function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return undefined;
    }

    const timeout = window.setTimeout(() => setCopied(false), 2000);

    return () => window.clearTimeout(timeout);
  }, [copied]);

  return (
    <Button
      type="button"
      className="secondary-button"
      aria-label={label}
      icon={copied ? <CheckmarkRegular /> : <CopyRegular />}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
      }}
    >
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

export function McpIntegrationPanel() {
  const [tokens, setTokens] = useState<AccessTokenResponse[] | null>(null);
  const [tokenName, setTokenName] = useState("");
  const [created, setCreated] = useState<AccessTokenCreateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const serverUrl = getMcpServerUrl();

  useEffect(() => {
    let isMounted = true;

    apiClient
      .listAccessTokens()
      .then((response) => {
        if (isMounted) {
          setTokens(response.tokens);
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

  const createToken = async () => {
    setIsSaving(true);
    setError(null);

    try {
      const response = await apiClient.createAccessToken({ name: tokenName.trim() });
      setCreated(response);
      setTokens((current) => [response.token, ...(current ?? [])]);
      setTokenName("");
    } catch (createError: unknown) {
      setError(getErrorMessage(createError));
    } finally {
      setIsSaving(false);
    }
  };

  const revokeToken = async (token: AccessTokenResponse) => {
    setIsSaving(true);
    setError(null);

    try {
      await apiClient.deleteAccessToken(token.id);
      setTokens((current) => current?.filter((candidate) => candidate.id !== token.id) ?? null);
      setCreated((current) => (current?.token.id === token.id ? null : current));
    } catch (revokeError: unknown) {
      setError(getErrorMessage(revokeError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Panel title="AI assistants (MCP)">
      <div className="integration-panel mcp-integration">
        <p className="integration-intro">
          Connect AI assistants that support the Model Context Protocol, such as Claude, ChatGPT or
          VS Code, so they can browse your photos and books and design pages for you.
        </p>

        <Field label="MCP server URL">
          <div className="mcp-copy-row">
            <Input value={serverUrl} readOnly spellCheck={false} aria-label="MCP server URL" />
            <CopyButton label="Copy MCP server URL" value={serverUrl} />
          </div>
        </Field>

        <form
          className="mcp-token-form"
          onSubmit={(event) => {
            event.preventDefault();
            void createToken();
          }}
        >
          <Field label="New access token">
            <Input
              value={tokenName}
              maxLength={80}
              placeholder="Claude Desktop"
              disabled={isSaving}
              onChange={(event) => setTokenName(event.currentTarget.value)}
            />
          </Field>
          <Button
            appearance="primary"
            type="submit"
            className="primary-button"
            disabled={isSaving || tokenName.trim().length === 0}
            icon={<AddRegular />}
          >
            Create token
          </Button>
        </form>
        <p className="integration-hint">
          Name the token after the app that will use it. Assistants with the token can view your
          library and create and edit pages and books.
        </p>

        {created ? (
          <div className="mcp-new-token" role="status">
            <p>
              <strong>Copy your new token now.</strong> You will not be able to see it again.
            </p>
            <div className="mcp-copy-row">
              <Input
                value={created.secret}
                readOnly
                spellCheck={false}
                aria-label={`Access token for ${created.token.name}`}
              />
              <CopyButton label="Copy access token" value={created.secret} />
            </div>
            <p className="integration-hint">
              Most MCP clients accept a configuration like this one:
            </p>
            <pre className="mcp-config">{createClientConfig(serverUrl, created.secret)}</pre>
            <div className="integration-actions">
              <CopyButton
                label="Copy client configuration"
                value={createClientConfig(serverUrl, created.secret)}
              />
              <Button type="button" className="secondary-button" onClick={() => setCreated(null)}>
                Done
              </Button>
            </div>
          </div>
        ) : null}

        {tokens === null && !error ? (
          <div className="integration-loading" aria-busy="true">
            <Spinner size="tiny" />
            <span>Loading access tokens</span>
          </div>
        ) : null}

        {tokens?.length === 0 ? <p className="empty-state">No access tokens yet.</p> : null}

        {tokens?.length ? (
          <ul className="mcp-token-list" aria-label="Access tokens">
            {tokens.map((token) => (
              <li key={token.id}>
                <div className="mcp-token-details">
                  <strong>{token.name}</strong>
                  <span>
                    <code>{token.tokenPrefix}…</code> · Created{" "}
                    {new Date(token.createdAt).toLocaleDateString()} ·{" "}
                    {token.lastUsedAt
                      ? `Last used ${new Date(token.lastUsedAt).toLocaleString()}`
                      : "Never used"}
                  </span>
                </div>
                <Button
                  type="button"
                  className="secondary-button"
                  disabled={isSaving}
                  icon={<DeleteRegular />}
                  aria-label={`Revoke ${token.name}`}
                  onClick={() => void revokeToken(token)}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        <p className="integration-hint">
          If a page is open in the editor while an assistant changes it, reload the page to see the
          changes.
        </p>

        {error ? (
          <p className="panel-alert" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
