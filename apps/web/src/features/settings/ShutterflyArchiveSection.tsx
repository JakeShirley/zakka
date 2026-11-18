import { Button, ProgressBar, Spinner } from "@fluentui/react-components";
import {
  ArchiveRegular,
  ArrowDownloadRegular,
  ArrowClockwiseRegular,
  DeleteRegular,
} from "@fluentui/react-icons";
import {
  type ShutterflyArchivePart,
  type ShutterflyArchiveResponse,
  type ShutterflyArchiveStep,
  shutterflyArchiveParts,
} from "@zakka/api-contract";
import { useCallback, useEffect, useState } from "react";

import { apiClient } from "../../apiClient";
import { getErrorMessage } from "../../lib/errors";
import { formatBytes } from "../../lib/format";

const pollIntervalMs = 3000;

const stepLabels: Record<ShutterflyArchiveStep, string> = {
  starting: "Signing in to Shutterfly",
  orders: "Saving order history",
  projects: "Saving projects",
  albums: "Reading albums",
  photos: "Downloading original photos",
  finishing: "Writing the archive index",
};

const statusLabels: Record<ShutterflyArchiveResponse["status"], string> = {
  running: "In progress",
  completed: "Complete",
  failed: "Stopped",
  interrupted: "Interrupted",
};

const partLabels: Record<ShutterflyArchivePart, string> = {
  photos: "Photo library",
  albums: "Albums",
  books: "Photo books",
  calendars: "Calendars",
  cards: "Cards & stationery",
  prints: "Prints",
  otherProjects: "Other projects",
  orders: "Order history",
};

const projectParts: readonly ShutterflyArchivePart[] = [
  "books",
  "calendars",
  "cards",
  "prints",
  "otherProjects",
];

const includesAllParts = (parts: readonly ShutterflyArchivePart[]) =>
  shutterflyArchiveParts.every((part) => parts.includes(part));

const countLabel = (
  { completed, total }: { completed: number; total: number },
  noun: string,
): string =>
  total > 0 ? `${completed.toLocaleString()} of ${total.toLocaleString()} ${noun}` : `0 ${noun}`;

const stepProgress = ({ progress }: ShutterflyArchiveResponse): number | undefined => {
  const counts =
    progress.step === "photos"
      ? progress.photos
      : progress.step === "projects"
        ? progress.projects
        : progress.step === "albums"
          ? progress.albums
          : null;

  return counts && counts.total > 0 ? (counts.completed + counts.failed) / counts.total : undefined;
};

type ShutterflyArchiveSectionProps = {
  connected: boolean;
};

export function ShutterflyArchiveSection({ connected }: ShutterflyArchiveSectionProps) {
  const [archives, setArchives] = useState<ShutterflyArchiveResponse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [selectedParts, setSelectedParts] = useState<ShutterflyArchivePart[]>([
    ...shutterflyArchiveParts,
  ]);

  const togglePart = (part: ShutterflyArchivePart, checked: boolean) =>
    setSelectedParts((current) =>
      shutterflyArchiveParts.filter((candidate) =>
        candidate === part ? checked : current.includes(candidate),
      ),
    );

  const replaceArchive = useCallback((archive: ShutterflyArchiveResponse) => {
    setArchives((current) => [
      archive,
      ...(current ?? []).filter((existing) => existing.id !== archive.id),
    ]);
  }, []);

  const isRunning = archives?.some((archive) => archive.status === "running") ?? false;

  const load = useCallback(async () => {
    try {
      setArchives((await apiClient.listShutterflyArchives()).archives);
    } catch (loadError: unknown) {
      setError(getErrorMessage(loadError));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!isRunning) {
      return undefined;
    }

    const timer = window.setInterval(() => void load(), pollIntervalMs);

    return () => window.clearInterval(timer);
  }, [isRunning, load]);

  const run = async (archiveId: string, action: () => Promise<void>) => {
    setBusyId(archiveId);
    setError(null);

    try {
      await action();
    } catch (actionError: unknown) {
      setError(getErrorMessage(actionError));
    } finally {
      setBusyId(null);
    }
  };

  const start = () =>
    run("new", async () => {
      replaceArchive(await apiClient.startShutterflyArchive(selectedParts));
    });

  const resume = (archiveId: string) =>
    run(archiveId, async () => {
      replaceArchive(await apiClient.resumeShutterflyArchive(archiveId));
    });

  const remove = (archiveId: string) =>
    run(archiveId, async () => {
      await apiClient.deleteShutterflyArchive(archiveId);
      setConfirmingDeleteId(null);
      setArchives((current) => (current ?? []).filter((archive) => archive.id !== archiveId));
    });

  return (
    <section className="shutterfly-archive" aria-labelledby="shutterfly-archive-heading">
      <h3 id="shutterfly-archive-heading">Account archive</h3>
      <p className="integration-hint">
        Save a copy of everything in your Shutterfly account: original photos and videos, albums,
        every project, and order history. The archive is built on this server, so it can take hours
        and needs as much free disk space as your photo library. You can leave this page while it
        runs. To try it out first, archive just one part, such as your cards.
      </p>

      {archives === null && !error ? (
        <div className="integration-loading" aria-busy="true">
          <Spinner size="tiny" />
          <span>Loading archives</span>
        </div>
      ) : null}

      {archives?.map((archive) => {
        const running = archive.status === "running";
        const busy = busyId === archive.id;
        const label = new Date(archive.createdAt).toLocaleDateString();
        const progressValue = stepProgress(archive);
        const has = (part: ShutterflyArchivePart) => archive.parts.includes(part);
        const counts = [
          ...(has("photos") || has("albums")
            ? [countLabel(archive.progress.photos, "photos")]
            : []),
          ...(projectParts.some(has) ? [countLabel(archive.progress.projects, "projects")] : []),
          ...(has("albums") ? [countLabel(archive.progress.albums, "albums")] : []),
          ...(has("orders") ? [`${archive.progress.orders.toLocaleString()} orders`] : []),
          formatBytes(archive.progress.bytes),
        ];

        return (
          <article key={archive.id} className="shutterfly-archive-item">
            <div className="shutterfly-archive-header">
              <strong>Archive from {label}</strong>
              <span className={`shutterfly-archive-status is-${archive.status}`}>
                {statusLabels[archive.status]}
              </span>
            </div>

            {running ? (
              <div className="shutterfly-archive-progress">
                <span>{stepLabels[archive.progress.step]}</span>
                <ProgressBar
                  aria-label={`Archive from ${label} progress`}
                  {...(progressValue === undefined ? {} : { value: progressValue })}
                />
              </div>
            ) : null}

            {includesAllParts(archive.parts) ? null : (
              <p className="shutterfly-archive-counts">
                Includes: {archive.parts.map((part) => partLabels[part]).join(", ")}
              </p>
            )}

            <p className="shutterfly-archive-counts">{counts.join(" · ")}</p>

            {archive.progress.errorCount > 0 && !running ? (
              <p className="integration-hint">
                {archive.progress.errorCount.toLocaleString()} items could not be saved. They are
                listed in <code>errors.json</code>. Choose{" "}
                {archive.status === "completed" ? "Update" : "Resume"} to try them again.
              </p>
            ) : null}

            {archive.error && !running ? (
              <p className="panel-alert" role="alert">
                {archive.error.message}
              </p>
            ) : null}

            {confirmingDeleteId === archive.id ? (
              <div className="integration-actions">
                <span className="shutterfly-archive-confirm">
                  {running
                    ? "Stop this archive and delete what it has saved?"
                    : "Delete this archive from the server?"}
                </span>
                <Button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => setConfirmingDeleteId(null)}
                >
                  Keep
                </Button>
                <Button
                  type="button"
                  className="danger-button"
                  disabled={busy}
                  icon={<DeleteRegular />}
                  onClick={() => void remove(archive.id)}
                >
                  Delete archive
                </Button>
              </div>
            ) : (
              <div className="integration-actions">
                <Button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  icon={<DeleteRegular />}
                  aria-label={`${running ? "Cancel" : "Delete"} archive from ${label}`}
                  onClick={() => setConfirmingDeleteId(archive.id)}
                >
                  {running ? "Cancel" : "Delete"}
                </Button>
                {!running && connected ? (
                  <Button
                    type="button"
                    className="secondary-button"
                    disabled={busy || isRunning}
                    icon={<ArrowClockwiseRegular />}
                    title={
                      archive.status === "completed"
                        ? "Download anything added to Shutterfly since this archive was made"
                        : "Continue where this archive left off"
                    }
                    onClick={() => void resume(archive.id)}
                  >
                    {archive.status === "completed" ? "Update" : "Resume"}
                  </Button>
                ) : null}
                {!running ? (
                  <Button
                    as="a"
                    appearance="primary"
                    className="primary-button"
                    href={apiClient.shutterflyArchiveDownloadUrl(archive.id)}
                    download
                    icon={<ArrowDownloadRegular />}
                  >
                    Download ZIP
                  </Button>
                ) : null}
              </div>
            )}
          </article>
        );
      })}

      {connected && archives !== null && !isRunning ? (
        <>
          <fieldset className="shutterfly-archive-parts">
            <legend>What to archive</legend>
            {shutterflyArchiveParts.map((part) => (
              <label key={part} className="checkbox-label compact-checkbox">
                <input
                  type="checkbox"
                  checked={selectedParts.includes(part)}
                  disabled={busyId !== null}
                  onChange={(event) => togglePart(part, event.target.checked)}
                />
                <span>{partLabels[part]}</span>
              </label>
            ))}
          </fieldset>
          <div className="integration-actions">
            <Button
              type="button"
              appearance={archives.length === 0 ? "primary" : "secondary"}
              className={archives.length === 0 ? "primary-button" : "secondary-button"}
              disabled={busyId !== null || selectedParts.length === 0}
              icon={<ArchiveRegular />}
              onClick={() => void start()}
            >
              {busyId === "new"
                ? "Starting"
                : includesAllParts(selectedParts)
                  ? "Archive my Shutterfly account"
                  : "Archive selected parts"}
            </Button>
          </div>
        </>
      ) : null}

      {error ? (
        <p className="panel-alert" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
