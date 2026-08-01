/* First-use state is separate from the sheet save. Resetting the paper should
   not make the introduction appear again. */

export const INTRO_KEY = "plica.intro.1";

export function shouldShowIntro(storage) {
  try { return storage?.getItem(INTRO_KEY) !== "seen"; }
  catch { return true; }
}

export function rememberIntro(storage) {
  try { storage?.setItem(INTRO_KEY, "seen"); }
  catch { /* storage is optional */ }
}
