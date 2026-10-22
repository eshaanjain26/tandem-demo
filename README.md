# Tandem demo

The public landing page and in-browser demo for [Tandem](https://eshaanjain26.github.io/tandem-demo/), self-hosted scheduling where each person's agent negotiates inside a written mandate and both humans approve before any invitation goes out.

- `index.html`, `styles.css`, `demo.js`: plain static files, no build step.
- The demo runs entirely in the browser with generated calendars. It reproduces the server's rules: one validator for every candidate time, a reason for every rejection, round and reveal limits from each mandate, and an invitation only after both approvals.
- `.github/workflows/pages.yml` deploys `main` to GitHub Pages.

Run Tandem itself from the container image: `ghcr.io/eshaanjain26/tandem:1.1.0`.

Preview locally with `python3 -m http.server` in this folder.
