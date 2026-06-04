---
name: workflow
description: Invoke a named saved workflow. Usage:/workflow <name> [args]
args:
  - workflowName
---
Run the saved workflow `{{workflowName}}` with the rest of the input as its arguments.

Note: the workflow runner lands in Track 1 / Prompt B1. Until then, this command will surface an error indicating the runner is not yet available — the prompt template is in place so the palette and autocomplete pick it up.

Arguments passed through: {{args}}
