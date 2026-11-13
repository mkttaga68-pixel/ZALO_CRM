# Five priority security fixes — source changes, 2026-11-01

Baseline commit: `ba4c821365c25d6e5dbe8af3767922fd4d6ff032`.
This package fixes findings 1–5 from the latest review. Queue throughput and
frontend draft persistence (findings 6–7) remain outside this change.

## 1. Protect the organization owner

Admin cannot reset an owner's password or edit the owner's profile/login fields.
Actor and target must belong to the same organization. The mutation also filters
the target role at write time, so a promotion between lookup and update cannot
bypass the protection. Existing owner management authority is preserved.

## 2. Password-bound sessions, no migration

New setup/login JWTs contain an opaque `credentialVersion`: HMAC-SHA256 using the
JWT signing key, a domain separator, the user ID and the current bcrypt hash.
The bcrypt hash itself is not placed in the token or response.

HTTP and socket authentication check this binding against current persisted
credentials in addition to active status, organization and role. Password reset
changes the hash, invalidating previous tokens even when resetting to the same
plaintext password. Tokens without a binding fail closed.

**Activation effect:** all previously issued JWTs require one new login after this
backend release. Frontend token storage/401 behavior already supports logout.
No database column or schema migration is required.

Password reset immediately disconnects this process's tracked sockets. Other
processes/passive sockets revalidate at a 30-second interval; incoming socket
events always revalidate. Database/authentication failure disconnects the socket.
Internal queued posting jobs use a separate active-actor check, not an invented
JWT. This patch does not automatically cancel already queued business jobs on
password reset; an operator can cancel those explicitly.

## 3. Forward source and destination authorization

Validate all destination IDs (maximum 50), source/destination org, active nick,
account chat rights, privacy PIN/ownership, contact scope and policy before any
send. A mixed permitted/forbidden request fails before SDK invocation. Missing or
unresolvable references return 404 rather than disclose resource existence.

Reference-preserving text forwarding is restricted to the source nick: native
message/recipient identifiers cannot safely be treated as nick-independent.
Media forwarding checks permission on each destination nick before processing.

## 4. Bounded and validated downloads

Inbound media mirroring and forwarding use one shared downloader:

- External URLs: public HTTPS only, all DNS answers validated, pinned address,
  TLS hostname checks, redirects rejected, 30-second timeout, 50 MiB/file cap.
- Objects under configured storage roots: GetObject against the configured S3
  bucket/key; no user-selected internal HTTP host, inherited redirects or proxy.
  Streaming reads enforce both declared and actual size, with timeout cleanup.
- Temp files belong to a newly allocated directory; failed writes clean up.
- Public bankcard parsing retains the CDN hostname allowlist, requires HTTPS/443
  and uses the same DNS/redirect guard, with 8-second and 1 MiB limits.
- Inbound download logs omit URLs and raw exception text.

This introduces a technical 50 MiB limit on mirroring/forwarding. Files larger
than the cap and non-HTTPS external media are rejected rather than read without
bound. Arbitrary web-page/share links are still not direct image files.

## 5. Legacy BOT history authorization

JWT log APIs still require `posting.access`. Group history is limited to current
authorized work nicks. Main/private or archived nicks are excluded by the same
posting account gate; selecting an unauthorized account does not widen scope.

For legacy offer jobs, a recipient is visible only when its Zalo UID maps through
Friend in the job's own nick/org to a contact passing current scope and policy.
No phone-number or external BOT customer-ID guessing is used. A job with any
unmapped/null/out-of-scope recipient is hidden, including its totals and details.
Known-empty jobs expose only metadata on an authorized nick.

List/detail/count queries use the same visibility predicate. Repeatable-read
transactions keep authorization of stored recipients and returned detail on the
same snapshot. The keyed JSON membership predicate avoids large SQL parameter
lists and repeated full friend-list scans for every result.

**Compatibility effect:** existing BOT jobs without reliable UID/contact mapping
may disappear from this UI. Repair the authoritative mapping through the normal
data workflow; do not bypass the gate or guess ownership.

## Verification and release boundary

Static caller/import review used the owner-approved GitNexus exception for this
package. Relevant callers include auth routes/middleware, socket handshake and
events, manual-posting worker actor checks, chat forwarding/mirroring, bankcard
parser and legacy posting history APIs.

Backend TypeScript build completed successfully. Existing auth/socket fixtures
were updated for the new token contract, and reset/new-token/legacy-token cases
were added. These tests have **not been executed**, per the owner's instruction;
they are not PASS evidence. Browser, network-download, S3 and end-to-end behavior
also remain unverified for this package.

No live customer data was used, no messages were sent, no production database was
changed and no production deployment or Git push was performed in this task.
Review the forced re-login, download size limits and stricter history visibility
before activation. Deployment must update the whole backend together, including
the new helpers, rather than copying a single auth or media module.
