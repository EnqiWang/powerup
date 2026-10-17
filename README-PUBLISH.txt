POWERUP / GITHUB PAGES EDITION

FIX THE 404
1. Extract this ZIP.
2. Open your powerup repository on GitHub and select Code.
3. Choose Add file > Upload files.
4. Upload the FILES INSIDE this extracted folder to the repository root.
   index.html, style.css, static-api.js and all remaining JavaScript files
   must sit together at that top level. Do not upload only the ZIP.
5. Commit the upload.
6. Settings > Pages > Build and deployment:
   Source: Deploy from a branch
   Branch: main
   Folder: / (root)
   Save.
7. Wait for the Pages deployment in Actions to finish successfully, then
   refresh the URL shown by GitHub Pages using Ctrl+F5.

The entry filename must be exactly index.html (lowercase). Downloaded names
such as index(3).html or index(4).html must be renamed before uploading.
Uploading a PoweruP subfolder instead of its contents will not put the entry
file at the repository's publishing root.

HOW THIS EDITION WORKS
GitHub Pages hosts static HTML/CSS/JS; it does not run server.py.
static-api.js runs before the app and sends the app's public data requests
straight to ORNL/SCE, NWS and Census. No credentials or API key are supplied.
MapLibre/OpenFreeMap maps are loaded by the browser. All asset paths work
under the repository's /powerup/ path.

Live requests depend on provider availability and browser cross-origin
permissions. Failures are shown explicitly and never replaced with invented
records. Live deployment could not be checked in the build environment:
GitHub, external requests and the browser download were blocked.

DEMO
Use saved SCE usage for the six real June 2024 ZIP aggregates provided in the
successful earlier API output. This is historical usage, not fresh telemetry.
Internet is still needed for map streets and Census boundary lookup.
Demand changes recalculate previews automatically. Approval remains manual.
Resident email/SMS delivery is simulated; no messages are sent.
The Python raw OPSD converter is available only in the local-server edition;
converted profile JSON imports and saved scenario imports work in this edition.
