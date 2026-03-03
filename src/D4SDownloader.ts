import BeautifulDom from "beautiful-dom";
import PDFDocument from "pdfkit";
import * as fs from "fs";
import * as zlib from "zlib";
import SVGtoPDF from "svg-to-pdfkit";
import { JSDOM } from "jsdom";
import Axios from "axios";
import { D4SLog } from "./D4SLog";
import { D4SDwlHandler } from "./D4SDwlHandler";
import { D4SBookSettings } from "./D4SBookSettings";
import { D4SBookProperties } from "./D4SBookProperties";
import readline from "readline";
import { D4SAuthHelper } from "./D4SAuthHelper";
import { D4SVersionChecker } from "./D4SVersionChecker";

// ── PDFKit dash() patch ───────────────────────────────────────────────────────
// PDFKit throws when any dash length is 0 (e.g. SVG stroke-dasharray:"0 4").
// The throw exits SVGtoPDF mid-group, leaving the 2 PDFKit refs opened by
// docBeginGroup() permanently unclosed → _waiting stays > 0 → doc 'end' never
// fires.  Fix: silently ignore invalid dash patterns instead of throwing.
// A "0-length dash" is visually a no-op, so skipping it is correct behaviour.
{
  const OrigPDFDocument = require("pdfkit");
  const origDash = OrigPDFDocument.prototype.dash;
  OrigPDFDocument.prototype.dash = function(length: any, options: any = {}) {
    const lengths: number[] = Array.isArray(length) ? length : [length, options.space ?? length];
    if (!lengths.every((x: any) => Number.isFinite(x) && x > 0)) {
      return this; // invalid / zero-length dash — skip silently
    }
    return origDash.call(this, length, options);
  };
}
// ─────────────────────────────────────────────────────────────────────────────

// ── png-js patch ─────────────────────────────────────────────────────────────
// png-js's original decodePixels() calls zlib.inflate() (async) and does
// `throw err` inside the callback — an uncaught exception that bypasses every
// try/catch and crashes Node.  Replace with a synchronous implementation so
// errors are caught safely and all PDFKit refs are always properly closed.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PNG = require("png-js");
PNG.prototype.decodePixels = function(fn: (pixels: Buffer) => void): void {
  let data: Buffer;
  try {
    data = zlib.inflateSync(this.imgData as Buffer);
  } catch {
    // Decompression failed — return a blank pixel buffer so PDFKit can still
    // finalize (_refEnd is still called, _waiting still decrements correctly).
    return fn(Buffer.alloc(this.width * this.height * (this.pixelBitlength / 8)));
  }

  const { width, height } = this;
  const pixelBytes: number = this.pixelBitlength / 8;
  const pixels = Buffer.alloc(width * height * pixelBytes);
  const len = data.length;
  let pos = 0;

  const pass = (x0: number, y0: number, dx: number, dy: number, singlePass = false) => {
    const w = Math.ceil((width - x0) / dx);
    const h = Math.ceil((height - y0) / dy);
    const scanlineLength = pixelBytes * w;
    const buffer: Buffer = singlePass ? pixels : Buffer.alloc(scanlineLength * h);
    let row = 0;
    let c = 0;
    while (row < h && pos < len) {
      let byte: number, col: number, i: number, left: number, upper: number;
      switch (data[pos++]) {
        case 0:
          for (i = 0; i < scanlineLength; i++) buffer[c++] = data[pos++];
          break;
        case 1:
          for (i = 0; i < scanlineLength; i++) {
            byte = data[pos++]; left = i < pixelBytes ? 0 : buffer[c - pixelBytes];
            buffer[c++] = (byte + left) % 256;
          }
          break;
        case 2:
          for (i = 0; i < scanlineLength; i++) {
            byte = data[pos++]; col = (i - (i % pixelBytes)) / pixelBytes;
            upper = row ? buffer[(row - 1) * scanlineLength + col * pixelBytes + (i % pixelBytes)] : 0;
            buffer[c++] = (upper + byte) % 256;
          }
          break;
        case 3:
          for (i = 0; i < scanlineLength; i++) {
            byte = data[pos++]; col = (i - (i % pixelBytes)) / pixelBytes;
            left = i < pixelBytes ? 0 : buffer[c - pixelBytes];
            upper = row ? buffer[(row - 1) * scanlineLength + col * pixelBytes + (i % pixelBytes)] : 0;
            buffer[c++] = (byte + Math.floor((left + upper) / 2)) % 256;
          }
          break;
        case 4:
          for (i = 0; i < scanlineLength; i++) {
            byte = data[pos++]; col = (i - (i % pixelBytes)) / pixelBytes;
            left = i < pixelBytes ? 0 : buffer[c - pixelBytes];
            let paeth: number, upperLeft: number;
            if (row === 0) { upper = 0; upperLeft = 0; }
            else {
              upper = buffer[(row - 1) * scanlineLength + col * pixelBytes + (i % pixelBytes)];
              upperLeft = col ? buffer[(row - 1) * scanlineLength + (col - 1) * pixelBytes + (i % pixelBytes)] : 0;
            }
            const p = left + upper - upperLeft;
            const pa = Math.abs(p - left), pb = Math.abs(p - upper), pc = Math.abs(p - upperLeft);
            if (pa <= pb && pa <= pc) paeth = left;
            else if (pb <= pc) paeth = upper;
            else paeth = upperLeft;
            buffer[c++] = (byte + paeth) % 256;
          }
          break;
        default:
          // Unknown filter — fill the row with zeros rather than throwing.
          for (i = 0; i < scanlineLength; i++) buffer[c++] = 0;
      }
      if (!singlePass) {
        let pixelsPos = ((y0 + row * dy) * width + x0) * pixelBytes;
        let bufferPos = row * scanlineLength;
        for (i = 0; i < w; i++) {
          for (let j = 0; j < pixelBytes; j++) pixels[pixelsPos++] = buffer[bufferPos++];
          pixelsPos += (dx - 1) * pixelBytes;
        }
      }
      row++;
    }
  };

  if (this.interlaceMethod === 1) {
    pass(0, 0, 8, 8); pass(4, 0, 8, 8); pass(0, 4, 4, 8);
    pass(2, 0, 4, 4); pass(0, 2, 2, 4); pass(1, 0, 2, 2); pass(0, 1, 1, 2);
  } else {
    pass(0, 0, 1, 1, true);
  }
  fn(pixels);
};
// ─────────────────────────────────────────────────────────────────────────────

export class D4SDownlodaer {
  bookSettings: D4SBookSettings;
  dwlHandler: D4SDwlHandler = new D4SDwlHandler();

  async startDownload() {
    D4SLog.welcome();

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (prompt: string) => new Promise<string>(resolve => rl.question(prompt, resolve));

    const bookUrl  = await ask("Paste the URL of your book: ");
    const email    = await ask("Username/Email: ");

    // Password: let readline write the "Password: " prompt normally (first call
    // to _writeToOutput), then suppress all subsequent calls so typed characters
    // are not echoed to the terminal.
    const password = await new Promise<string>(resolve => {
      const orig = (rl as any)._writeToOutput.bind(rl);
      let promptWritten = false;
      (rl as any)._writeToOutput = (s: string) => {
        if (!promptWritten) { promptWritten = true; orig(s); } // show prompt once
        // suppress character echoing after that
      };
      rl.question("Password: ", answer => {
        (rl as any)._writeToOutput = orig;
        process.stdout.write("\n");
        resolve(answer);
      });
    });

    const rangeStr = await ask("Pages to download (e.g. 5-20, leave empty for whole book): ");
    rl.close();

    // Parse optional page range.
    let startPage = 1;
    let endPage   = Infinity;
    const m = rangeStr.trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      startPage = Math.max(1, parseInt(m[1]));
      endPage   = Math.max(startPage, parseInt(m[2]));
    }

    this.bookSettings = new D4SBookSettings(bookUrl, email, password);
    this.download(startPage, endPage);
  }

  async download(startPage = 1, endPage = Infinity) {
    if (
      this.bookSettings.bookUrl.length < 30 ||
      this.bookSettings.email.length <= 0 ||
      this.bookSettings.password.length <= 0
    ) {
      return D4SLog.invalidProperties();
    }

    D4SAuthHelper.getCookies(
      this.bookSettings.email,
      this.bookSettings.password,
      this.bookSettings.bookUrl,
      (cookies, ebookBaseUrl) => {
        if (!cookies) return D4SLog.invalidProperties();
        this.dwlHandler.cookies = cookies;
        this.dwlHandler.ebookBaseUrl = ebookBaseUrl;

        D4SBookProperties.getBookProperties(
          this.dwlHandler.cookies,
          ebookBaseUrl,
          (bookSize: number[], bookName: string) => {
            this.dwlHandler.bookSize = bookSize;
            this.dwlHandler.bookName = bookName;

            D4SVersionChecker.checkVersion(ebookBaseUrl, this.dwlHandler.cookies, async (isNewVersion: boolean) => {
              this.dwlHandler.isNewVersion = isNewVersion;

              try {
                if (!fs.existsSync("book/")) fs.mkdirSync("book");

                const pdfFileName = this.dwlHandler.bookName ? this.dwlHandler.bookName + ".pdf" : "book.pdf";
                const pdfFilePath = "book/" + pdfFileName;

                // Download pages in batches of 50; each batch is its own PDF file.
                const batchFiles = await this.dwlPages(startPage, endPage);

                if (batchFiles.length === 0) {
                  console.log("[!] No pages were downloaded.");
                  return;
                }

                // Always copy through pdf-lib: normalizes the output so it opens
                // correctly in Preview and Firefox (SVGtoPDF can produce
                // technically-valid-but-unreadable files without this step).
                const { PDFDocument: PdfLib } = await import("pdf-lib");
                const merged = await PdfLib.create();
                for (const batchFile of batchFiles) {
                  const bytes = fs.readFileSync(batchFile);
                  const batch = await PdfLib.load(bytes);
                  const pages = await merged.copyPages(batch, batch.getPageIndices());
                  pages.forEach(p => merged.addPage(p));
                  fs.rmSync(batchFile, { force: true });
                }
                fs.writeFileSync(pdfFilePath, await merged.save());

                D4SLog.downloadDone(pdfFileName);
              } catch (err) {
                console.log("[!] Fatal error during download:", err.message);
              }
            });
          }
        );
      }
    );
  }

  // Downloads pages (optionally clamped to [startPage, endPage]) in batches of
  // 50, writing each batch to a separate PDF file.
  // Returns the list of finalized batch file paths.
  async dwlPages(startPage = 1, endPage = Infinity): Promise<string[]> {
    this.dwlHandler.page = startPage;
    const batchFiles: string[] = [];
    let batchNum = 0;
    let batchPageCount = 0;
    let doc: InstanceType<typeof PDFDocument>;
    let currentBatchPath: string;
    let batchOpen = false;
    let chunks: Buffer[] = [];

    const openBatch = () => {
      batchNum++;
      currentBatchPath = `book/batch_${batchNum}.pdf`;
      chunks = [];
      doc = new PDFDocument({ size: this.dwlHandler.bookSize });
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      batchPageCount = 0;
      batchOpen = true;
    };

    const closeBatch = (): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`PDFKit 'end' event timed out on batch ${batchNum}`));
        }, 15000);

        doc.on("end", () => {
          clearTimeout(timer);
          try {
            fs.writeFileSync(currentBatchPath, Buffer.concat(chunks));
            batchOpen = false;
            resolve();
          } catch (e) {
            reject(e);
          }
        });
        doc.on("error", (e: Error) => { clearTimeout(timer); reject(e); });
        doc.end();
      });

    while (this.dwlHandler.page <= endPage) {
      D4SLog.downloadPage(this.dwlHandler.page);

      let dwlUrl: string;
      if (this.dwlHandler.isNewVersion) {
        dwlUrl = this.dwlHandler.ebookBaseUrl + this.dwlHandler.page + ".svg";
      } else {
        dwlUrl = this.dwlHandler.ebookBaseUrl + this.dwlHandler.page + "/" + this.dwlHandler.page + ".svg";
      }

      try {
        const res = await Axios.get(dwlUrl, {
          headers: { Cookie: this.dwlHandler.cookies },
          validateStatus: () => true,
        });
        const html = new BeautifulDom(res.data);
        if (html.getElementsByTagName("svg").length <= 0) {
          break; // no more pages
        }

        const svg: JSDOM = await this.dwlImages(html, this.dwlHandler.page);

        D4SLog.generatingPage(this.dwlHandler.page);
        const svgEl = svg.window.document.getElementsByTagName("svg")[0];

        if (!batchOpen) openBatch();
        if (batchPageCount > 0) doc.addPage();
        try {
          // assumePt: true — the ebook SVG coordinate system is already in PDF
          // points, so we skip svg-to-pdfkit's default 0.75× px→pt scale factor.
          // Without this, SVGs with explicit pixel dimensions render at 75% size.
          SVGtoPDF(doc, svgEl.outerHTML, 0, 0, { assumePt: true });
        } catch (e) {
          console.log(`[!] SVGtoPDF error on page ${this.dwlHandler.page}:`, e.message);
        }

        batchPageCount++;
        this.dwlHandler.page++;

        // Finalize this batch after 50 pages.
        if (batchPageCount === 50) {
          await closeBatch();
          batchFiles.push(currentBatchPath);
        }
      } catch {
        D4SLog.error();
        break;
      }
    }

    // Close the last (possibly partial) batch if it has any pages.
    if (batchOpen) {
      await closeBatch();
      batchFiles.push(currentBatchPath);
    }

    return batchFiles;
  }

  // Downloads images referenced in the SVG directly into memory as base64 data URIs.
  async dwlImages(html: BeautifulDom, page: number) {
    const dwlSvg: string = html.getElementsByTagName("svg")[0].outerHTML.toString();
    const svg = new JSDOM(dwlSvg);

    const imageNodes = svg.window.document.getElementsByTagName("image");
    for (let i = 0; i < imageNodes.length; i++) {
      // Support both xlink:href (SVG 1.1) and href (SVG 2.0)
      const ogHref: string =
        imageNodes.item(i).getAttribute("xlink:href") ?? imageNodes.item(i).getAttribute("href");
      if (!ogHref) continue;

      const imageUrl: string = this.dwlHandler.isNewVersion
        ? this.dwlHandler.ebookBaseUrl + ogHref
        : this.dwlHandler.ebookBaseUrl + page + "/" + ogHref;

      try {
        const response = await Axios(imageUrl, {
          method: "GET",
          responseType: "arraybuffer",
          headers: { Cookie: this.dwlHandler.cookies },
        });
        const buf = Buffer.from(response.data);
        const ext = ogHref.split(".").pop()?.toLowerCase() ?? "";
        const mime = ext === "png" ? "image/png" : "image/jpeg";
        imageNodes.item(i).setAttribute("xlink:href", `data:${mime};base64,${buf.toString("base64")}`);
      } catch {
        // Skip image silently — page will render without it
      }
    }

    return svg;
  }
}
