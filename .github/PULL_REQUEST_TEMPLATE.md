---

name: Pull request description: Describe changes you want to merge title: '' labels: [] assignee: ''
body:

- type: input id: summary attributes: label: What description: One-line summary of the change
  validations: required: true
- type: textarea id: why attributes: label: What & why description: Context, problem, and
  motivation. validations: required: true
- type: input id: issue attributes: label: Related issue description: 'Closes #123 or N/A'
- type: checkboxes id: checks attributes: label: Definition of Done description: Confirm before
  requesting review. options: - label: Lint + format + typecheck pass - label: Tests added/updated,
  coverage gate met - label: Docs / ADR updated in the same PR (documentation-first) - label: No
  secrets, TODOs, or placeholder code - label: Security review completed if attack surface changed -
  label: Conventional Commit message set by author validations: required: true
- type: textarea id: testing attributes: label: How to test description: Manual verification steps
- type: textarea id: screenshots attributes: label: Screenshots (optional)
- type: textarea id: changelog attributes: label: Changelog description: Entry for CHANGELOG.md
