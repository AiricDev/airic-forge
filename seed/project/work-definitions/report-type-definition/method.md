# Method

1. Read `report-type.context` with the current editor focus.
2. Use `report-type.list-published-standards` only when selecting clause sections.
3. Build a complete, valid definition for the changed fields; keep unrelated fields intact.
   When `style_preset` is present, use its exact framework/version, `classReference`,
   and `guidance`. Keep `html_css` to Report Type overrides. Do not paste the
   framework CSS, add CDN imports, assume Bootstrap JavaScript, or invent classes
   from another framework version.
4. Use `report-type.preview` with `scope.type=master` or `scope.type=section`
   (and that section's `sectionId`) for a short feedback loop on every changed
   Jinja template. Use `scope.type=package` after the focused previews to verify
   final composition.
5. Call `report-type.update-draft` with the digest returned by the read.
6. Tell the user the saved result, remaining diagnostics, and any decision they need to make.
7. Stop the turn without completing the Work. On the next user message, continue
   from this session's conversation and re-read authoritative state only where
   needed to account for changes since the prior turn.
