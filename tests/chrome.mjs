// Where Google Chrome (or Chromium) is: $CHROME if set, else the usual
// place on a Mac, else the first of the usual names on the PATH.
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

function find() {
  if (process.env.CHROME) return process.env.CHROME;
  const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (existsSync(mac)) return mac;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    try { return execFileSync("which", [name], { encoding: "utf8" }).trim(); } catch {}
  }
  throw new Error("Google Chrome not found: set CHROME to its path");
}
export const chrome = find();
