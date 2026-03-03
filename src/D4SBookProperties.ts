import { JSDOM } from "jsdom";
import Axios from "axios";

export class D4SBookProperties {
  // Fetches book metadata (title, page dimensions) from the ebook reader page.
  // ebookBaseUrl is the direct ebook URL, e.g. https://a.digi4school.at/ebook/3643/
  // Callback receives (bookSize, bookName).
  static async getBookProperties(cookies: string, ebookBaseUrl: string, callback: Function) {
    try {
      const res = await Axios.get(ebookBaseUrl, { headers: { Cookie: cookies } });
      const html = new JSDOM(res.data);

      const metaTags = html.window.document.getElementsByTagName("meta");
      let bookName = "";
      for (let i = 0; i < metaTags.length; i++) {
        if (metaTags.item(i).getAttribute("name") === "title") {
          const unescapedName: string = metaTags.item(i).getAttribute("content");
          const splitName: string[] = unescapedName.split("/");
          if (splitName.length > 1) {
            splitName.forEach((namePart) => {
              bookName += namePart + "-";
            });
          } else {
            bookName = splitName[0];
          }
        }
      }

      // Parse page dimensions from embedded JS; fall back to A4 if the format has changed.
      let bookSize: number[] = [595, 842];
      try {
        const scriptTag = html.window.document.getElementsByTagName("script")[0].innerHTML;
        const splitScript = scriptTag.split("[[")[1];
        const splitScriptToValues = splitScript.split("]")[0];
        const splitToSize = splitScriptToValues.split(",");
        bookSize = [Number(splitToSize[0]), Number(splitToSize[1])];
      } catch {
        console.log("[!] Could not parse page dimensions; using A4 fallback (595x842).");
      }

      return callback(bookSize, bookName);
    } catch (err) {
      return callback([595, 842], "");
    }
  }
}
