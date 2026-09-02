feat(hooks): one-click approvals by default

On hooked assistants an approve command now raises a native allow or
deny prompt for the human, with the evidence attached: the deploy brief,
the proposed message, the PR text. A proposals command shows pending
text and its state without opening files. Prompt is the default;
approvals set to command restores typed approvals. reset and rollback
stay typed in both modes. Tests no longer assume the gh CLI is absent;
an env switch disables the auth fallback in test runs.
