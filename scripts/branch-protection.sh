#!/usr/bin/env bash
# Apply the repo's branch-protection rules. Idempotent. Needs `gh auth` with admin rights.
# Run after the CI workflow has reported at least once so the "verify" context exists.
#
# Flow: ticket branches --squash--> dev --merge commit--> main
#   dev  : linear history (squash only), one commit per ticket
#   main : merge commits only, so every promotion keeps dev as a parent and dev never diverges
set -euo pipefail
REPO="${1:-gtech38/Eva-HUB}"

protect() { # branch, linear(true|false)
  gh api -X PUT "repos/$REPO/branches/$1/protection" -H "Accept: application/vnd.github+json" --input - >/dev/null <<JSON
{
  "required_status_checks": { "strict": true, "contexts": ["verify", "PR standards"] },
  "enforce_admins": true,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "required_linear_history": $2,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": false
}
JSON
  echo "protected $1 (linear history: $2)"
}

protect dev true
protect main false

# Squash for ticket PRs into dev; merge commits for dev -> main promotions. No rebase merges.
gh api -X PATCH "repos/$REPO" \
  -F allow_squash_merge=true -F allow_merge_commit=true -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY \
  -f merge_commit_title=PR_TITLE -f merge_commit_message=PR_BODY >/dev/null

echo "required checks on both: verify, PR standards; admins included; CI enforces feature->dev->main"
echo "Note: required reviews are off because a solo maintainer cannot approve their own PR; turn on with required_pull_request_reviews when a second reviewer exists."
