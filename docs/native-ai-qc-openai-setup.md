# OpenAI synthetic activation — Windows

Scope: existing native CRM sandbox at `http://127.0.0.1:5174/ai-quality-control`. This does not authorize production or customer-data outbound. The project owner explicitly requested adding OpenAI and enabling the feature in the current session.

## Result of this activation

The key was entered via a masked local PowerShell prompt, encrypted with Windows CurrentUser DPAPI, and injected into the backend child environment. Key values were not inserted into commands, source, database, frontend responses, Git or diagnostic output. The key pasted in chat was not copied into source or tool command text; the owner was advised to rotate it.

The existing sandbox databases, datasets and frontend were retained. Only the sandbox backend restarted. A new JWT secret invalidates the old sandbox browser session, so log in again with the existing synthetic account. Production and the frontend on port 5173 were not restarted.

Configured model: `gpt-5.6-terra`, with structured Responses output and operator-configured `reasoningEffort=none`, max output 4096. Actual request model comes from configuration, not a hardcoded provider ID. [Official model capabilities](https://developers.openai.com/api/docs/models/gpt-5.6-terra) document Responses, structured outputs and that reasoning setting. API/model access still depends on the project associated with the key.

**The real connection test returned OPENAI_AUTHENTICATION_FAILED (HTTP 401).** This is a failed test, not PASS. Provider remains Mock by default. OpenAI test controls are configured, but usable real analysis remains blocked by a valid accepted key. No successful response, usage or cost was fabricated.

Actual activation evidence: `openai-activation-evidence.json` and `runtime-evidence.json` under `C:\Zalo CRM\native-ai-qc-runtime\mvxj0im3`. Test-process regression suite: 93 PASS. No real customer data was sent.

## Secure replacement and activation

Run in a local PowerShell terminal as the same Windows user that runs this sandbox:

```powershell
cd "C:\Zalo CRM\ZL-CRM"
powershell -NoProfile -File scripts/set-native-ai-qc-openai.ps1 -Model gpt-5.6-terra
node scripts/activate-native-ai-qc-openai.cjs --enable
```

The first command prompts for a new key with characters hidden. It stores only DPAPI ciphertext in `C:\Zalo CRM\native-ai-qc-secrets\openai.dpapi`; directory access is restricted to the current Windows SID and SYSTEM. Model metadata is separate. Do not put the key in command arguments, shell history or chat. DPAPI is tied to this Windows account and is not portable secret backup.

The activation command verifies the recorded disposable PostgreSQL cluster, restarts only its backend, decrypts the key inside a child PowerShell process and passes it through environment memory. The key is never returned over stdout. It performs one explicitly authorized synthetic connection test. On success it changes the default provider to OpenAI; on failure the default remains Mock and the error code is recorded without key or raw provider error content. It does not approve any business documents. Before analysis, explicitly approve appropriate synthetic rules in Obsidian Brain.

To disable real API use while retaining sandbox data:

```powershell
node scripts/activate-native-ai-qc-openai.cjs --disable
```

## Outbound boundary

`AI_QC_REAL_API_ENABLED=true` and `AI_QC_OUTBOUND_TEST_APPROVED=true` require pre-import guard proof and the Windows DPAPI injection source. `AI_QC_REAL_DATA_ENABLED=false` and `AI_QC_REAL_DATA_OUTBOUND_APPROVED=false` remain mandatory.

The guard permits only POST `https://api.openai.com/v1/responses` with an approved model, `store:false`, strict known schema and server-synthetic conversation/manager input. It checks every DNS answer against the existing public-IP validator, pins a public IPv4 address, verifies the TLS hostname/certificate, blocks redirects and rejects other destinations, methods and tool-enabled requests. The only other allowed outgoing TCP is the verified loopback sandbox PostgreSQL port. No host firewall claim is made.

The SDK timeout, bounded retry and tenant rate/token budget remain enforced. Invalid authentication, model permission/not-found and insufficient-quota errors are classified without logging provider error bodies or credentials. The smoke verification helper explicitly skips real connection calls when API mode is enabled, preventing surprise billable requests.

[Official OpenAI authentication guidance](https://developers.openai.com/api/reference/overview) requires keeping API credentials server-side. Local DPAPI/ACL configuration and the current-key validity are separate concerns: successful encrypted storage does not prove OpenAI will accept a key.

Production AI QC, Employee Scoring and Violation Confirmation remain disabled. G1–G10 remain NO-GO. The authentication failure requires a valid replacement credential; this delivery does not close that condition automatically.
