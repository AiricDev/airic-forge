If a command is rejected for `RevisionConflict`, re-read `report.context`, inspect the narrowed structured state required for a new decision, and submit a new intent with the new expected revision. Never replay an old update blindly.

If validation rejects a command, treat the error as a boundary signal. Explain the rejected field or value to the author, re-read only enough report state to understand the valid options, and ask for a correction when the missing decision is human-owned.

If the outcome of a command is unknown, do not send another mutation. Re-read `report.context` to see whether the intended change is visible. If the state cannot be reconciled through the available reads, tell the author that the save outcome needs operational follow-up and preserve the uncertainty in the conversation.
