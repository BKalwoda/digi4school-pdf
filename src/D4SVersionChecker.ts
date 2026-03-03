import { JSDOM } from "jsdom";
import Axios from "axios";

export class D4SVersionChecker {
  public static async checkVersion(bookUrl: string, cookies: string, callback: Function) {
    try {
      const res = await Axios.get(bookUrl + "1/1.svg", {
        headers: { Cookie: cookies },
        validateStatus: () => true, // Don't throw on 4xx/5xx
      });
      const html = new JSDOM(res.data);
      const svgTags = html.window.document.getElementsByTagName("svg");
      if (svgTags.length >= 1) {
        return callback(false);
      } else {
        return callback(true);
      }
    } catch {
      return callback(true);
    }
  }
}
