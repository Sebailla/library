/**
 * Backwards-compatible re-export of the downloads repository.
 *
 * The repository contract moved from ``src/repositories/`` to
 * ``src/downloads/`` in PR-2E so it lives next to the HTTP module
 * that owns it. The contract tests under
 * ``test/repositories/downloads.repository.e2e-spec.ts`` and any
 * external consumer that imported from the old path keep working
 * via this re-export.
 *
 * New code MUST import from ``src/downloads/downloads.repository``
 * directly.
 */
export {
  DOWNLOADS_REPOSITORY,
  createDownloadsRepository,
  PgDownloadsRepository,
  type CreateDownloadsRepositoryOptions,
  type Download,
  type DownloadStats,
  type DownloadsRepository,
  type NewDownload,
} from '../downloads/downloads.repository';
