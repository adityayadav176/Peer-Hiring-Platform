
import { UAParser } from "ua-parser-js";

export const deviceInfoMiddleware = (req, res, next) => {
  const parser = new UAParser(req.get("user-agent") || "");
  const result = parser.getResult();

  req.deviceInfo = {
    device:
      [result.device.vendor, result.device.model]
        .filter(Boolean)
        .join(" ") || "Unknown device",

    deviceType: result.device.type || "desktop",
    deviceModel: result.device.model || "",
    deviceVendor: result.device.vendor || "",

    browser: result.browser.name || "Unknown",
    browserVersion: result.browser.version || "",

    os: result.os.name || "Unknown",
    osVersion: result.os.version || "",
  };

  next();
};
