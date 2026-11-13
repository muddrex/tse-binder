#!/usr/bin/env bash
# Promote the approved preview/ copy to the live site at the repo root.
# Live differs from preview only in: save key task-ripper-v1, backup filename, and no PREVIEW labels.
# preview/ itself is never modified. Run from anywhere: tools/promote.sh
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf assets && cp -R preview/assets assets
cp preview/index.html preview/engine.js preview/app.js .
sub() { # file, perl expr, must-match text after
  perl -0pi -e "$2" "$1"
  grep -qF -- "$3" "$1" || { echo "promote: substitution failed in $1: $2" >&2; exit 1; }
}
sub app.js 's{/\* Task Ripper PREVIEW app \(UI\)\. Pure rules live in engine\.js\. \*/}{/* Task Ripper LIVE app (UI), promoted from preview/. Pure rules live in engine.js. Edit preview/ first, then run tools/promote.sh. */}' 'Task Ripper LIVE app'
sub app.js "s{  // PROMOTION: change K to 'task-ripper-v1' when this copy is promoted to live.\n  var K = 'task-ripper-preview';}{  // LIVE copy: the kids' real saves. Preview stays on 'task-ripper-preview'.\n  var K = 'task-ripper-v1';}" "var K = 'task-ripper-v1';"
sub app.js "s{\(D\.title \|\| 'Task Ripper'\) \+ ' PREVIEW'}{(D.title || 'Task Ripper')}" "document.title = (D.title || 'Task Ripper');"
sub app.js "s{Preview sample tasks: change}{Sample tasks: change}" 'Sample tasks: change'
sub app.js "s{Preview defaults: Surging Sparks and Destined Rivals are switched on just so you can try a rip\. This is not a final choice\.}{Starter sets: Surging Sparks and Destined Rivals are switched on so you can try a rip. Change them any time.}" 'Starter sets:'
sub app.js "s{'task-ripper-preview-backup-'}{'task-ripper-backup-'}" "'task-ripper-backup-'"
sub app.js "s{Preview default is 1234\.}{Default is 1234.}" 'Default is 1234.'
sub index.html 's{<title>Task Ripper PREVIEW</title>}{<title>Task Ripper</title>}' '<title>Task Ripper</title>'
sub index.html 's{\n      <span class="badge b-preview">PREVIEW</span>}{}' '<h1 id="title">Task Ripper</h1>'
sub index.html 's{Personal family app, preview copy\.}{Personal family app.}' 'Personal family app. Not'
if grep -n -i 'preview' app.js index.html | grep -v -e 'b-preview{' -e "Preview stays on 'task-ripper-preview'" -e 'promoted from preview/' -e 'Edit preview/'; then echo "promote: leftover preview text above" >&2; exit 1; fi
echo "promoted preview/ -> live root (key task-ripper-v1)"
