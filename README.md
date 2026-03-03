# digi4school-pdf

Download your digi4school (and compatible) ebooks as PDF files using your own login credentials.

> **Disclaimer:** This project is for personal, educational use only. Downloading and/or redistributing the generated PDF files may violate the terms of service of the respective platform and applicable copyright law.

---

## Requirements

- [Node.js & npm](https://nodejs.org/en/) — verify with `node --version` and `npm --version`

## Installation

1. Clone this repository:
   ```
   git clone https://github.com/YOUR_USERNAME/digi4school-pdf.git
   ```
2. Install dependencies:
   ```
   npm install
   ```

## Usage

Open a terminal in the project root and run:

```
npm start
```

You will be prompted for:

```
Paste the URL of your book: https://digi4school.at/ebook/22s58pqggqdc
Username/Email: mail@example.com
Password: ••••••••
Pages to download (e.g. 5-20, leave empty for whole book):
```

- **Book URL** — see below for how to find it
- **Email / Password** — your digi4school login credentials (password is hidden while typing)
- **Page range** — enter `5-20` to download only pages 5 through 20, or leave empty to download the entire book

The generated PDF is saved in the `book/` subdirectory.

---

## How to find the book URL

1. Log in to [digi4school.at](https://digi4school.at) and open your bookshelf.
2. Click on the book you want to download — it will open in the ebook reader.
3. Copy the URL from your browser's address bar **before** the redirect happens, or simply look it up in your **browser history** right after opening the book. It looks like:
   ```
   https://digi4school.at/ebook/22s58pqggqdc
   ```
4. Paste that URL when the script prompts you.

The script automatically handles the login and redirect flow to find the actual ebook server — you do not need to find the internal `a.digi4school.at/...` URL yourself.

---

## Fork & Changes

This repository is a fork of the original [digi4school-pdf](https://github.com/original-author/digi4school-pdf) project, which had not been maintained since around 2020–2021 and no longer worked with modern Node.js versions or the current digi4school platform.

### What was changed

- **Replaced the deprecated `request` library** with `axios` across all modules (`D4SAuthHelper`, `D4SBookProperties`, `D4SVersionChecker`, `D4SDownloader`)
- **Replaced `easy-pdf-merge`** (broken on modern macOS/Node due to Python 2 dependency) with `pdf-lib` for PDF merging and normalization
- **Fixed a PDFKit ref-leak caused by `doc.dash()` throwing** on zero-length SVG dash patterns (`stroke-dasharray: 0 4`), which left internal PDFKit references permanently open and prevented the PDF from finalizing — this affected books from `a.trauner-digibox.com` and similar providers
- **Replaced async `zlib.inflate` in png-js** with a synchronous implementation so decompression errors are caught safely instead of crashing the process as uncaught exceptions
- **Fixed SVG scaling** (`assumePt: true` passed to svg-to-pdfkit) so SVG content fills the full PDF page instead of rendering at 75% size
- **Added `href` fallback** alongside `xlink:href` for SVG `<image>` elements (SVG 2.0 compatibility)
- **Hardened cookie parsing** in the LTI auth flow (lookup by name instead of fixed index)
- **Added try/catch around page-size parsing** in `D4SBookProperties` with a fallback to A4
- **Replaced deprecated `fs.rmdirSync({recursive})` with `fs.rmSync({recursive, force})`**
- **Upgraded TypeScript** from 4.x to 5.x
- **Added page range selection** — download only a specific range of pages (e.g. `5-20`)
- **Password input is now hidden** while typing

---

## Planned: selectable / searchable text (SVG text layer)

The generated PDFs are not searchable and text cannot be copied. Since every page is already an SVG, the text exists as `<text>`/`<tspan>` elements — no OCR is needed.

**Why text is not selectable today:** svg-to-pdfkit tries to render text via PDFKit's font API, but the embedded fonts are base64 data URIs, not file paths, so font loading fails silently and text is drawn as vector outlines.

**Approach:** extract text nodes from the SVG before rendering, then write an invisible (opacity 0) text layer over each page with pdf-lib during the existing normalization pass.

**What needs to be implemented:**
1. Walk `<text>` and `<tspan>` nodes in JSDOM, collecting `x`, `y`, `font-size`, and text content per page.
2. Accumulate ancestor `<g transform="...">` matrices to convert local coordinates to page coordinates (SVG user units = PDF points because `assumePt: true`).
3. Handle `<tspan dx/dy>` relative offsets (common for multi-line paragraphs).
4. In the pdf-lib pass, call `page.drawText(content, { x, y: pageH - y, size, opacity: 0 })` for each text item — flip Y because PDF origin is bottom-left, SVG is top-left.
5. Skip nodes with `display:none` or `visibility:hidden`.
# digi4school-pdf

Welcome to digi4school-pdf!
This script lets you download your books from digi4school.

## Requirements

1. [Node.JS & NPM](https://nodejs.org/en/) (test with `node --version` and `npm --version`)
2. [Java 8+](https://www.java.com/en/download/) (test with `java --version`)

## Installation

1. Clone this repository using HTTPS or Git.
2. Run `npm install` in the root directory of the project.

## Usage

To download a book, open a new terminal window in the root directory of the project and execute the script by typing `npm start`.
Now, you have to provide the URL of the book to download as well as your login credentials for digi4school.

```
Paste the URL of your book: https://a.digi4school.at/ebook/0000/
Username/Email: mail@example.com
Password: ********
```

You can see the progress of the download in the console and when the PDF-file has been generated, you can use a file explorer to navigate to the subdirectory book/ to find your generated PDF-file.

## Disclaimer

This project is for educational purposes only and it's illegal to download and/or use the generated PDF-files.

