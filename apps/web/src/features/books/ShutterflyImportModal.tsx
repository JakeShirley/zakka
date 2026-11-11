import { Button, Spinner } from "@fluentui/react-components";
import { ArrowDownloadRegular, BookOpenRegular, LinkRegular } from "@fluentui/react-icons";
import type { ShutterflyConnectionResponse, ShutterflyProjectResponse } from "@zakka/api-contract";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { apiClient } from "../../apiClient";
import { AppModal } from "../../components/layout";
import { getErrorMessage } from "../../lib/errors";

type ImportResult = { bookId: string; title: string; warnings: string[] };

const formatUpdatedAt = (updatedAt: string | null): string | null =>
  updatedAt ? `Edited ${new Date(updatedAt).toLocaleDateString()}` : null;

export function ShutterflyImportModal({
  onClose,
  onOpenBook,
}: {
  onClose: () => void;
  onOpenBook: (bookId: string) => void;
}) {
  const navigate = useNavigate();
  const [connection, setConnection] = useState<ShutterflyConnectionResponse | null>(null);
  const [projects, setProjects] = useState<ShutterflyProjectResponse[] | null>(null);
  const [importingProjectId, setImportingProjectId] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      const status = await apiClient.getShutterflyConnection();

      if (!isMounted) {
        return;
      }

      setConnection(status);

      if (status.configured && status.connected) {
        const response = await apiClient.listShutterflyProjects();

        if (isMounted) {
          setProjects(response.projects);
        }
      }
    };

    load().catch((loadError: unknown) => {
      if (isMounted) {
        setError(getErrorMessage(loadError));
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const importProject = async (project: ShutterflyProjectResponse) => {
    setImportingProjectId(project.id);
    setError(null);

    try {
      const response = await apiClient.importShutterflyProject(project.id);

      if (response.warnings.length === 0) {
        onOpenBook(response.book.id);
        return;
      }

      setResult({
        bookId: response.book.id,
        title: response.book.title,
        warnings: response.warnings,
      });
    } catch (importError: unknown) {
      setError(getErrorMessage(importError));
    } finally {
      setImportingProjectId(null);
    }
  };

  const isImporting = importingProjectId !== null;
  const isLoading = !error && (connection === null || (connection.connected && projects === null));

  return (
    <AppModal
      title="Import from Shutterfly"
      size="auto"
      closeDisabled={isImporting}
      onClose={onClose}
    >
      <div className="shutterfly-import">
        {isLoading ? (
          <div className="integration-loading" aria-busy="true">
            <Spinner size="tiny" />
            <span>Loading your Shutterfly projects</span>
          </div>
        ) : null}

        {connection && !connection.configured ? (
          <p className="empty-state">
            Shutterfly import is not enabled on this server. Ask your Zakka administrator to set{" "}
            <code>SHUTTERFLY_API_KEY</code>.
          </p>
        ) : null}

        {connection?.configured && !connection.connected ? (
          <div className="books-empty-state">
            <p>Connect your Shutterfly account to see your saved photo books.</p>
            <Button
              appearance="primary"
              className="primary-button"
              icon={<LinkRegular />}
              type="button"
              onClick={() => navigate("/settings?tab=integrations")}
            >
              Connect in Settings
            </Button>
          </div>
        ) : null}

        {result ? (
          <div className="shutterfly-import-result">
            <p>
              Imported <strong>{result.title}</strong>. Some parts could not be brought across:
            </p>
            <ul>
              {result.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
            <div className="integration-actions">
              <Button
                appearance="primary"
                className="primary-button"
                icon={<BookOpenRegular />}
                type="button"
                onClick={() => onOpenBook(result.bookId)}
              >
                Open book
              </Button>
            </div>
          </div>
        ) : null}

        {!result && projects && projects.length === 0 ? (
          <p className="empty-state">No saved Shutterfly photo books were found.</p>
        ) : null}

        {!result && projects && projects.length > 0 ? (
          <ul className="shutterfly-project-list" aria-label="Shutterfly projects">
            {projects.map((project) => (
              <li key={project.id} className="shutterfly-project">
                <span className="shutterfly-project-thumbnail" aria-hidden="true">
                  {project.thumbnailUrl ? (
                    <img
                      src={project.thumbnailUrl}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  ) : null}
                </span>
                <span className="shutterfly-project-copy">
                  <span>{project.name}</span>
                  <span>
                    {[
                      project.productName,
                      project.pageCount ? `${project.pageCount} pages` : null,
                      formatUpdatedAt(project.updatedAt),
                    ]
                      .filter(Boolean)
                      .join(" / ")}
                  </span>
                </span>
                <Button
                  appearance="primary"
                  className="primary-button"
                  disabled={isImporting}
                  icon={
                    importingProjectId === project.id ? (
                      <Spinner size="extra-tiny" />
                    ) : (
                      <ArrowDownloadRegular />
                    )
                  }
                  type="button"
                  aria-label={`Import ${project.name}`}
                  onClick={() => importProject(project)}
                >
                  {importingProjectId === project.id ? "Importing" : "Import"}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        {isImporting ? (
          <p className="integration-hint" role="status">
            Downloading photos and building pages. Large books can take a minute.
          </p>
        ) : null}

        {error ? (
          <p className="panel-alert" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </AppModal>
  );
}
