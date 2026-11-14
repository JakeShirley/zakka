import { Button, Spinner } from "@fluentui/react-components";
import { ArrowDownloadRegular, BookOpenRegular, LinkRegular } from "@fluentui/react-icons";
import type {
  ShutterflyConnectionResponse,
  ShutterflyImportJobResponse,
  ShutterflyProjectResponse,
} from "@zakka/api-contract";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { apiClient } from "../../apiClient";
import { AppModal } from "../../components/layout";
import { getErrorMessage } from "../../lib/errors";

type ImportResult = { bookId: string; title: string; warnings: string[] };
type ImportProgress = ShutterflyImportJobResponse["progress"];

const importPollIntervalMs = 500;
const maxConsecutivePollFailures = 5;

const formatUpdatedAt = (updatedAt: string | null): string | null =>
  updatedAt ? `Edited ${new Date(updatedAt).toLocaleDateString()}` : null;

const stepLabels: Record<ImportProgress["step"], string> = {
  preparing: "Reading project from Shutterfly",
  photos: "Downloading photos",
  stickers: "Importing stickers",
  backgrounds: "Importing backgrounds",
  pages: "Building pages",
};

const formatImportProgress = (progress: ImportProgress | null): string => {
  if (!progress) {
    return "Starting import";
  }

  const label = stepLabels[progress.step];

  return progress.total > 0 ? `${label} (${progress.completed} of ${progress.total})` : label;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function ImportProgressIndicator({ progress }: { progress: ImportProgress | null }) {
  const isIndeterminate = !progress || progress.step === "preparing";
  const percent = progress ? Math.round(progress.fraction * 100) : 0;
  const label = formatImportProgress(progress);

  return (
    <div className="shutterfly-import-progress" role="status" aria-live="polite">
      <div className="shutterfly-import-progress-copy">
        <span>{label}</span>
        {isIndeterminate ? null : <span>{percent}%</span>}
      </div>
      <progress
        aria-label={label}
        max={1}
        value={isIndeterminate ? undefined : (progress?.fraction ?? 0)}
      />
    </div>
  );
}

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
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

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
    setImportProgress(null);
    setError(null);

    try {
      let job = await apiClient.startShutterflyImport(project.id);
      let consecutivePollFailures = 0;

      while (job.status === "running") {
        if (!isMountedRef.current) {
          return;
        }

        setImportProgress(job.progress);
        await wait(importPollIntervalMs);

        // The import keeps running on the server, so ride out transient polling errors
        // instead of dropping the job and inviting a duplicate import.
        try {
          job = await apiClient.getShutterflyImport(job.id);
          consecutivePollFailures = 0;
        } catch (pollError: unknown) {
          consecutivePollFailures += 1;

          if (consecutivePollFailures >= maxConsecutivePollFailures) {
            throw pollError;
          }
        }
      }

      if (!isMountedRef.current) {
        return;
      }

      if (job.status === "failed" || !job.result) {
        setError(job.error?.message ?? "Shutterfly import failed");
        return;
      }

      const response = job.result;

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
      if (isMountedRef.current) {
        setError(getErrorMessage(importError));
      }
    } finally {
      if (isMountedRef.current) {
        setImportingProjectId(null);
        setImportProgress(null);
      }
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
                {importingProjectId === project.id ? (
                  <ImportProgressIndicator progress={importProgress} />
                ) : null}
              </li>
            ))}
          </ul>
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
