import { JSDOM } from "jsdom";
import Axios from "axios";

export class D4SAuthHelper {
  static async getCookies(email: string, password: string, bookUrl: string, callback: Function) {
    try {
      // Step 1: Login with credentials
      const loginRes = await Axios.post(
        "https://digi4school.at/br/xhr/login",
        new URLSearchParams({ email, password }),
      );
      if (loginRes.data !== "OK") {
        console.log("[auth] Login failed — check credentials. Server replied:", loginRes.data);
        return callback(null);
      }

      const setCookies: string[] = loginRes.headers["set-cookie"] || [];
      const sessionCookieStr = setCookies.find((c) => c.startsWith("PHPSESSID=")) || setCookies[0] || "";
      const digi4sCookieStr = setCookies.find((c) => c.startsWith("digi4s=")) || setCookies[1] || "";
      const sessionCookie = sessionCookieStr.split(";")[0] + ";";
      const digi4sCookie = digi4sCookieStr.split(";")[0] + ";";
      const authCookies = sessionCookie + " " + digi4sCookie;

      // Step 2: Fetch the book's catalog page to get the LTI launch form
      const bookRes = await Axios.get(bookUrl, { headers: { Cookie: authCookies } });

      // Step 3: POST to kat.digi4school.at/lti (the authentication broker)
      const katFormData = D4SAuthHelper.getFormData(bookRes.data);
      const katRes = await Axios.post(
        "https://kat.digi4school.at/lti",
        new URLSearchParams(katFormData),
        { headers: { Cookie: authCookies } },
      );

      // Step 4: POST to the book provider's LTI endpoint.
      // The form action is dynamic — digi4school books use a.digi4school.at/lti,
      // but third-party publishers (e.g. Trauner) use their own LTI endpoint.
      const aAction = D4SAuthHelper.getFormAction(katRes.data);
      const aFormData = D4SAuthHelper.getFormData(katRes.data);
      console.log("[auth] LTI provider endpoint:", aAction);

      const aRes = await Axios.post(aAction, new URLSearchParams(aFormData), {
        headers: { Cookie: authCookies },
        maxRedirects: 0,   // The 302 response carries the auth cookie — don't follow it
        validateStatus: () => true,
      });

      // The 302 redirect target is the ebook base URL (e.g. https://a.digi4school.at/ebook/3643/)
      const location = (aRes.headers["location"] as string) || "";
      if (!location) {
        console.log("[auth] No redirect location from LTI endpoint — auth flow may have changed");
        console.log("[auth] Response body:", String(aRes.data).substring(0, 400));
        return callback(null);
      }

      // Collect all non-empty cookies from the 302 response (auth cookie for the ebook provider)
      const finalSetCookies: string[] = aRes.headers["set-cookie"] || [];
      const newCookies = finalSetCookies
        .filter((c) => {
          const nameValue = c.split(";")[0];
          const eqIdx = nameValue.indexOf("=");
          const value = eqIdx >= 0 ? nameValue.substring(eqIdx + 1).trim() : "";
          return value !== '""' && value !== "" && value !== "''";
        })
        .map((c) => c.split(";")[0] + ";")
        .join(" ");

      const ebookBaseUrl = location.endsWith("/") ? location : location + "/";
      console.log("[auth] ebook base URL:", ebookBaseUrl);
      callback(authCookies + " " + newCookies, ebookBaseUrl);
    } catch (err) {
      console.log("[auth] Exception:", err.message);
      if (err.response) {
        console.log("[auth]   HTTP status:", err.response.status);
        console.log("[auth]   Response body:", JSON.stringify(err.response.data).substring(0, 300));
      }
      callback(null);
    }
  }

  // Extracts the <form action="..."> URL from an HTML response.
  static getFormAction(html: string): string {
    const dom = new JSDOM(html);
    const formEl = dom.window.document.getElementsByTagName("form")[0];
    return formEl?.getAttribute("action") || "https://a.digi4school.at/lti";
  }

  static getFormData(html: string): Record<string, string> {
    const formData: Record<string, string> = {};
    const dom = new JSDOM(html);
    const inputArray = dom.window.document.getElementsByTagName("input");
    for (let i = 0; i < inputArray.length; i++) {
      const inputField = inputArray.item(i);
      const name = inputField.getAttribute("name");
      const value = inputField.getAttribute("value");
      if (name) formData[name] = value || "";
    }
    return formData;
  }
}
