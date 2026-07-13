"use client";
// components/I18nProvider.jsx
// Wraps the app in a react-i18next context. Receives the active language + resources
// from the server (app/layout.js) so the very first render — server and client — is
// already in the chosen language. Runtime switching happens on the same shared
// instance via i18n.changeLanguage(), so no remount is needed.
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { getI18n } from "@/lib/i18n/instance";

export default function I18nProvider({ lng, resources, children }) {
  const [i18n] = useState(() => getI18n(lng, resources));
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
