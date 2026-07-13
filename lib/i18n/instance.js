"use client";
// lib/i18n/instance.js
// A single shared i18next instance for the whole app.
//
// A module-level singleton is safe HERE specifically because this is a single-user
// desktop app: one Electron window, one server process. There is no cross-request
// language bleed to worry about the way a multi-tenant web server would have.
//
// Init is synchronous with resources SSR'd from the server (app/layout.js), so the
// server-rendered HTML and the first client render are identical — no hydration
// mismatch and no flash of untranslated content.
import i18next from "i18next";
import { initReactI18next } from "react-i18next";

let started = false;

export function getI18n(lng, resources) {
  if (!started) {
    i18next.use(initReactI18next).init({
      lng: lng || "en",
      fallbackLng: "en",
      resources: resources || {},
      // Keys are literal flat strings with dots ("nav.worlds"), not nested paths.
      keySeparator: false,
      nsSeparator: false,
      defaultNS: "translation",
      // React already escapes interpolated values in JSX.
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
      returnNull: false,
    });
    started = true;
    return i18next;
  }
  // Already initialized — a client re-render, or a pack added/switched at runtime.
  if (resources) {
    for (const l of Object.keys(resources)) {
      i18next.addResourceBundle(l, "translation", resources[l].translation, true, true);
    }
  }
  if (lng && i18next.language !== lng) i18next.changeLanguage(lng);
  return i18next;
}

export default i18next;
