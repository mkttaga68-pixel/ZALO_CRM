# Deployment security remediation — 2026-10-31

Scope: six approved fixes; no production deployment, database access or migration
was performed while implementing them. Existing worktree changes are preserved.

## Behavior changes

- Webhook, Zapier and public image downloads use `safeOutboundFetch`: HTTPS,
  no embedded credentials, public literal/DNS addresses only, pinned IP with
  original TLS hostname, no automatic redirects, time and response-size limits.
  Redirecting destinations now fail and must be configured with their final URL.
- HTTP JWT authentication checks the current user's active status, tenant and
  role. Missing/deactivated users or stale tenant/role claims receive 401;
  account-store failures receive 503. RBAC also rejects inactive users.
- Socket handshakes/events revalidate account state. User deactivation, role
  changes and deletion through the current server's user routes disconnect its
  tracked sockets immediately. The registry is process-local; distributed
  deployments need shared revocation before claiming cluster-wide immediacy.
  Direct database changes are observed at the next HTTP request/socket event or
  handshake, not guaranteed to disconnect an idle socket immediately. No new
  token-version schema or password-reset session invalidation is claimed.
- Block update validates tenant ownership of new folder/account references and
  validates retained content whenever the action type changes.
- Docker startup does not push schema or migrate data. It performs a read-only
  Bot-Auto grants preflight before starting the backend. Missing schema or pending
  grants backfill prevents startup instead of silently changing the database.
- Local Docker deploy rejects legacy schema-writing startup commands, builds
  before copying, checks grants, keeps rollback files, takes an exclusive lock,
  and requires `/health` HTTP success plus `db=connected`. Failed readiness
  restores files and reports a failed deployment even if rollback becomes healthy.
  `--no-restart` explicitly reports activation/readiness as unverified.

## Explicit database operation (not executed by this change)

Use the approved target credentials through the operator's normal secret
injection mechanism; do not paste DSNs into logs or command history. The tools
do not load `.env` automatically or print credentials.

From the repository root on Windows, or `/app` inside the corrected image:

```text
node scripts/bot-auto-backfill.cjs --check
```

This is read-only. A nonzero exit blocks deployment. After reviewing the target,
backup and SQL, the separately authorized data operation is:

```text
node scripts/bot-auto-backfill.cjs --apply --confirm-backup
```

Apply uses a transaction/table lock, limits lock/statement time, preserves explicit
`bot_auto.access=false`, verifies the result and rolls back on failure. Reruns are
idempotent. `--confirm-backup` is operator acknowledgment, not proof a backup
exists. No migration-history records are changed by this targeted operation.

AI-QC schema/migration files retained during removal are still present. Do not
blindly run every pending Prisma migration or restore `db push` to startup.
Review actual database migration history in a separately authorized release.

## Release limits

The local deploy script targets Docker, not native Windows services. Its legacy
image guard requires a separately approved corrected-image rollout first. Image
build, native PostgreSQL server integration, real DNS/HTTPS delivery and browser
end-to-end tests remain unverified. Successful unit/build checks are not evidence
that production has been upgraded. No Cloudflare configuration or AI-QC flags
are changed.
