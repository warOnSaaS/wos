```json
{
  "id": "B-0002-context-policy",
  "status": "accepted",
  "raisedBy": "context-policy",
  "raisedAt": "2026-09-29T18:07:31Z",
  "affectedContract": "packages/contracts/src/data/agent-policy.v1.json providers[claude_cli].workspaceWriteArgs and verification.unverified; providers[codex_cli].verification.unverified",
  "reason": "(1) claude_cli.workspaceWriteArgs is [\"--permission-mode\", \"acceptEdits\", \"--allowedTools\", \"{allowedCommandRules}\"], and roadmap_author and feature_author are workspace_write roles with no allowedCommands. `claude --help` shows `--allowedTools, --allowed-tools <tools...>`: a variadic option with a required value, so a literal expansion leaves a dangling flag followed by `--effort`, which is a usage error. buildInvocation drops the flag when there are no rules. (2) The same help text says the list is 'Comma or space-separated', while AGENT-POLICY.md renders each command as one element `Bash(npm run test)`. Whether a rule containing spaces (or a comma inside an argument) is kept whole is UNVERIFIED; the help example \"Bash(git *) Edit\" suggests parentheses are respected. (3) codex --output-schema receives the zod-generated JSON Schema (draft 2020-12 with minLength, maxLength, pattern, format uuid, exclusiveMinimum). Whether codex strict structured output accepts those keywords is UNVERIFIED and not on the unverified list.",
  "evidence": "claude 2.1.284 `claude --help`: '--allowedTools, --allowed-tools <tools...>  Comma or space-separated list of tool names to allow (e.g. \"Bash(git *) Edit\")'. codex-cli 0.155.0 `codex exec --help`: '--output-schema <FILE>  Path to a JSON Schema file describing the model's final response shape'. Snapshots: packages/agent-policy/test/__snapshots__/invocation.test.ts.snap (roadmap_author has no --allowedTools). Every other flag in both templates matches its help text.",
  "requestedCapability": "(1) Either a template rule that an empty {allowedCommandRules} drops its flag (as implemented), or an agent-policy.v2 with separate builder args. (2) and (3) added to verification.unverified, and a day-one smoke run (one real builder run with a two-word allowed command; one real codex run with the review-verdict.v1 schema) before Wave 3.",
  "affectedWorkstreams": [
    "context-policy",
    "github-build",
    "verification"
  ],
  "suggestedResolution": "Accept the drop-the-flag rule into AGENT-POLICY.md section 4 (PATCH, docs only). Add the two UNVERIFIED items in agent-policy.v2 at the next policy change. If codex rejects the keywords, outputJsonSchema gets a strict-mode variant that removes unsupported keywords (zod still validates the full schema after the run).",
  "decision": {
    "outcome": "accepted",
    "contractsVersion": "2.0.0",
    "note": "accepted. The drop-empty-list-flag rule is normative (AGENT-POLICY.md section 4 and the ProviderSpec doc comment); codex's '-' moved to trailingArgs. Both unverified behaviours are added to agent-policy.v1 verification.unverified (metadata only, no policyVersion bump) and a smoke run is required before Wave 3 (GAPS G-52); the strict-schema fallback is approved if codex rejects the keywords.",
    "decidedAt": "2026-09-29T19:30:00Z"
  }
}
```

Notes:

- No real model call was made. Flags were checked against local `--help` only (claude 2.1.284, codex-cli 0.155.0, `codex debug models` lists gpt-6-astra levels low..ultra, matching the policy).
- `allowedCommandRule` refuses arguments containing parentheses or control characters so one argument cannot close a rule early or start another.
