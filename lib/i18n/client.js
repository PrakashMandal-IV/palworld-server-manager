"use client";
// lib/i18n/client.js
// Runtime language switching for the shared i18next instance. Unlike the SSR path
// (app/layout.js), this changes language WITHOUT a reload: it lazy-loads the target
// pack over HTTP, swaps live so every migrated component re-renders, updates <html>
// for correctness/RTL, and persists the choice so the next launch SSRs it.
import i18n from "@/lib/i18n/instance";

export async function switchLanguage(code, dir = "ltr") {
  // Lazy-load the pack the first time a language is picked (English is always present).
  if (code !== "en" && !i18n.hasResourceBundle(code, "translation")) {
    const res = await fetch(`/api/i18n/pack/${encodeURIComponent(code)}`).then((r) => r.json());
    if (!res.ok) throw new Error(res.error || "Failed to load language");
    for (const l of Object.keys(res.resources)) {
      i18n.addResourceBundle(l, "translation", res.resources[l].translation, true, true);
    }
  }
  await i18n.changeLanguage(code);
  try {
    document.documentElement.lang = code;
    document.documentElement.dir = dir || "ltr";
  } catch {}
  // Persist server-side so the next launch renders this language from first paint.
  await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language: code }),
  }).catch(() => {});
}
