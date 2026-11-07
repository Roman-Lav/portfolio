---
name: test-site
description: Test the portfolio site in a real browser and fix what breaks. Spawns the site-tester agent, fixes the bugs from its report, then re-runs it to verify — up to 3 rounds. Use when the user says "test the site", "/test-site", or after a larger HTML/CSS/JS change.
---

# Test and fix loop

Arguments (optional): `report-only` — only test and show the report, change nothing.

1. **Test.** Launch the `site-tester` agent (Agent tool, `subagent_type: "site-tester"`) with:
   "Test the site and return your report." Wait for its report.
2. **Nothing found** → tell the user it is clean and what was covered. Stop.
3. **`report-only`** → show the report and stop.
4. **Fix.** For each finding, P1 first:
   - Read the code at the reported location and confirm the cause yourself — the report is a
     lead, not an order. If a finding is wrong or the test is outdated, skip it and say why.
   - Make the smallest fix that solves it, in the site's existing style.
   - Visual or design judgement calls (colours, spacing the user may have chosen on purpose):
     ask the user instead of changing them.
5. **Verify.** Launch `site-tester` again with: "Re-test the site. Previous round fixed:
   <list>. Confirm those are gone and report anything new." Repeat steps 4–5 at most
   3 rounds in total; if something still fails after that, stop and report it.
6. **Summary to the user:** what was found, what was fixed (with file links), what was
   skipped and why, what still fails. Do not commit unless the user asks.

The check itself is `tests/site_check.py`; if the site gains a page or a feature, add it
there (PAGES list or a new `scenario_*` function) so the tester covers it.
