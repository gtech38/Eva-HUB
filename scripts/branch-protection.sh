#!/usr/bin/env bash
# Apply the repo's branch-protection rules to main. Idempotent. Needs `gh auth` with admin rights.
# Run after the CI workflow has reported at least once so the "verify" context exists.
set -euo pipefail
REPO="${1:-gtech38/Eva-HUB}"

gh api -X PUT "repos/$REPO/branches/main/protection" \
  -H "Accept: application/vnd.github+json" \
  --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["verify", "PR standards"] },
  "enforce_admins": true,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": false
}
JSON

# Squash-only merges keep main linear and make PR = one commit = one ticket.
gh api -X PATCH "repos/$REPO" \
  -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY >/dev/null

echo "branch protection applied to $REPO:main (required checks: verify, PR standards; linear history; squash-only; admins included)"
echo "Note: required reviews are off because a solo maintainer cannot approve their own PR; turn on with required_pull_request_reviews when a second reviewer exists."
