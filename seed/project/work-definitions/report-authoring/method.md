## Start every turn from the report

1. Read `report.context` for the bound report. Use its resource revision, deterministic facts, gaps, blockers, permitted next actions, and every `fieldSchema` as the working state for this turn. `fieldSchema` supplies the exact editable field names, types, enum values, current `valuePath`, and command `updatePath`; do not infer them from the UI or from an empty values object.
2. Restate the user's requested outcome in report terms. If it does not identify a safe field or data instance, inspect only the necessary part of `report.read` or ask a focused question.
3. Classify the requested value. If the author directly specifies it, record that instruction through the normal user-message trace and prepare the validated update. If the Work must infer or extract it, use Work-bound evidence and cite only the necessary passages.

## Make a draft change deliberately

Use `report.update-master` for report information such as `project_name` or schema-supported report metadata. Use `report.update-data` only for the current data-instance identifier from the authoritative projection. Send the report identifier bound to this Work and the exact `expectedRevision` from the latest authoritative read.

Make one small, coherent update at a time. Let CertReporter validate the schema and domain rules. Do not try to work around a rejection by changing field names, sending arbitrary JSON, or writing directly to an API or database.

After every committed update, use the returned revision as the basis for the next update. Re-read `report.context` or `report.gaps` when it helps verify the requested outcome or recover from a rejection. Report the saved fields and current revision in plain language.

## Check without overwriting

For a request to check a report, begin with `report.context` and `report.gaps`. Explain missing information or inconsistencies as draft-quality observations. Do not change a field unless the author explicitly asks for a value to be saved.
