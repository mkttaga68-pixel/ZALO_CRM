# Local AI QC — OpenAI removed from use

Owner cancelled further OpenAI use. Local source controller now sets `AI_QC_OPENAI_REMOVED=true`; production was not deployed or restarted.

With this local profile, provider environment never reads a key, publishes no models, disables real API/data/consent flags, rejects OpenAI provider selection and direct provider dispatch, and hides the model selector, API connection button and AI dispatch buttons. Local synthetic workspace settings were updated through the existing authenticated API to provider `mock`, model empty. Obsidian registry/retrieval and Mock remain available.

Shared historical OpenAI implementation, SDK dependency, test evidence and encrypted DPAPI credentials were retained. This is removal from local use, not deletion of every OpenAI source/dependency or revocation of the remote Platform key. No further authentication investigation or live API request was performed after cancellation. Existing STOP marker remains closed.

Verification:

- Backend: 168 tests PASS (`aiqc-readiness-closure-20261102/tests-1793592452076/results.json`).
- Frontend: 13 tests PASS (`aiqc-readiness-closure-20261102/tests-1793592772908/frontend-results.json`).
- Authenticated local HTTP check PASS (`aiqc-semantic-session-20261102/local-openai-removal.json`): page 200, provider Mock, model empty, models empty, OpenAI settings PUT rejected 403, connection test rejected 403, zero outbound AI calls.
- Only verified local 5173/3091 processes were refreshed. Synthetic PostgreSQL retained. Browser E2E not run.

Files changed: backend providers/routes and provider regression tests; frontend dashboard/status type; local controller. Prior unrelated working-tree changes preserved.
