// Site settings. See SCHEMA.md.
window.ATLAS_SITE = {
  title: "{{TITLE}}",
  tagline: "{{TAGLINE}}",
  storageKey: "{{STORAGE_KEY}}",
  // Views in nav order. Leave out a view to hide it.
  views: ["tldr", "arch", "features"],
  // "tabs" (default) or "knob" (needs the knob part, three views).
  nav: "tabs",
  repoUrl: "",
  // {path}, {line} and {commit} are filled in per reference. Leave empty for plain text refs.
  refUrl: "",
  commit: "{{COMMIT_SHA}}",
  // Date the content was written from the code (YYYY-MM-DD).
  generated: "{{DATE}}"
};
