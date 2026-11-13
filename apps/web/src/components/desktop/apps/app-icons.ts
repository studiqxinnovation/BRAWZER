/**
 * The apps' icons, drawn as Apple draws them: solid shapes in white on the
 * app's coloured tile, each app its own symbol, on a 24-unit grid. Static
 * markup, written here, never from data. Secondary parts are a little
 * translucent (`fill-opacity`) so a symbol reads at 16 px and at 64 px.
 */
import type { AppId } from "./registry";

const DIM = 'fill-opacity="0.55"';
const SOFT = 'fill-opacity="0.78"';
const TEXT =
  'font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif" font-weight="800"';

export const appIcons: Readonly<Record<AppId, string>> = {
  files: `<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4.2a2 2 0 0 1 1.6.8L12.6 7.5H18.5A2.5 2.5 0 0 1 21 10v.5H3z" ${SOFT}/><path d="M3 10.5h18V17.5A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"/>`,
  trash: `<rect x="4" y="7" width="16" height="2.4" rx="1.2"/><path d="M9.5 4.5h5a1.5 1.5 0 0 1 1.5 1.5v1H8V6a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M5.5 10.5h13l-.9 9a2 2 0 0 1-2 1.8H8.4a2 2 0 0 1-2-1.8z" ${SOFT}/><path d="M9.4 13v6M12 13v6M14.6 13v6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-opacity="0.9" fill="none"/>`,
  settings: `<path fill-rule="evenodd" d="M12 2.5l1.6 2.3 2.7-.9.5 2.8 2.8.5-.9 2.7 2.3 1.6-2.3 1.6.9 2.7-2.8.5-.5 2.8-2.7-.9L12 21.5l-1.6-2.3-2.7.9-.5-2.8-2.8-.5.9-2.7L2.5 12l2.3-1.6-.9-2.7 2.8-.5.5-2.8 2.7.9zM12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6z"/>`,
  photos: `<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M5 18l4.5-5.5 3 3.5 2.5-3 4 5z" fill="#1c1b19" fill-opacity="0.28"/><circle cx="16.5" cy="8.5" r="2" fill="#1c1b19" fill-opacity="0.28"/>`,
  "pdf-viewer": `<path d="M6 2.5h7.5L19 8v11a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 19V5a2.5 2.5 0 0 1 1-2.5z"/><path d="M13.5 2.5V8H19z" ${DIM}/><text x="12" y="17.2" text-anchor="middle" font-size="5.2" ${TEXT} fill="#1c1b19" fill-opacity="0.7">PDF</text>`,
  music: `<path d="M10 4.6 19 3v11.2a3.2 3.2 0 1 1-2-3V6.3l-5 .9v9.8a3.2 3.2 0 1 1-2-3z"/>`,
  notepad: `<rect x="4.5" y="4" width="15" height="17.5" rx="2.5"/><path d="M8 2.5v3M12 2.5v3M16 2.5v3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/><path d="M7.5 10.5h9M7.5 13.8h9M7.5 17.1h5.5" stroke="#1c1b19" stroke-opacity="0.35" stroke-width="1.5" stroke-linecap="round" fill="none"/>`,
  writer: `<path d="M6 2.5h7.5L19 8v11a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 19V5a2.5 2.5 0 0 1 1-2.5z"/><path d="M13.5 2.5V8H19z" ${DIM}/><path d="M8 11h8M8 14h8M8 17h5" stroke="#1c1b19" stroke-opacity="0.35" stroke-width="1.6" stroke-linecap="round" fill="none"/>`,
  calc: `<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9.2h18M3 14.6h18M9 4v16M15 4v16" stroke="#1c1b19" stroke-opacity="0.32" stroke-width="1.3" fill="none"/><rect x="3" y="4" width="18" height="5.2" rx="2.5" fill="#1c1b19" fill-opacity="0.18"/>`,
  slides: `<rect x="2.5" y="4" width="19" height="13" rx="2.2"/><rect x="5.5" y="7" width="8" height="2" rx="1" fill="#1c1b19" fill-opacity="0.3"/><rect x="5.5" y="10.5" width="11" height="1.6" rx="0.8" fill="#1c1b19" fill-opacity="0.22"/><rect x="5.5" y="13.3" width="9" height="1.6" rx="0.8" fill="#1c1b19" fill-opacity="0.22"/><path d="M12 17v3M8.5 21.5h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>`,
  code: `<text x="12" y="16.6" text-anchor="middle" font-size="12.5" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-weight="700" fill="currentColor">&lt;/&gt;</text>`,
  templates: `<rect x="3" y="3" width="8.2" height="8.2" rx="2"/><rect x="12.8" y="3" width="8.2" height="8.2" rx="2" ${SOFT}/><rect x="3" y="12.8" width="8.2" height="8.2" rx="2" ${SOFT}/><rect x="12.8" y="12.8" width="8.2" height="8.2" rx="2" ${DIM}/>`,
  "app-store": `<path d="M5.5 8h13l1.3 11.2A2.5 2.5 0 0 1 17.3 22H6.7a2.5 2.5 0 0 1-2.5-2.8z"/><path d="M8.5 9V7a3.5 3.5 0 0 1 7 0v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/><text x="12" y="18.2" text-anchor="middle" font-size="7" ${TEXT} fill="#1c1b19" fill-opacity="0.55">A</text>`,
  "web-store": `<circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5c3 3 3 16 0 19M12 2.5c-3 3-3 16 0 19M4.3 7.5h15.4M4.3 16.5h15.4" stroke="#1c1b19" stroke-opacity="0.35" stroke-width="1.3" fill="none"/>`,
  passwords: `<path fill-rule="evenodd" d="M8.5 3a5.5 5.5 0 0 1 5.2 7.3l6.8 6.8v3.4h-3.4l-1-1v-2.2h-2.2l-1-1v-2.2l-1.1-1.1A5.5 5.5 0 1 1 8.5 3zm-1 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>`,
  usage: `<rect x="3" y="12" width="4.5" height="9" rx="1.2" ${DIM}/><rect x="9.75" y="6" width="4.5" height="15" rx="1.2"/><rect x="16.5" y="9" width="4.5" height="12" rx="1.2" ${SOFT}/>`,
  help: `<path fill-rule="evenodd" d="M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19zm0 5.8a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4z"/><path d="M6.6 6.6l2.8 2.8M14.6 14.6l2.8 2.8M17.4 6.6l-2.8 2.8M9.4 14.6l-2.8 2.8" stroke="#1c1b19" stroke-opacity="0.35" stroke-width="2.3" stroke-linecap="round" fill="none"/>`,
  screenshot: `<path d="M3 8.5V5.5A2.5 2.5 0 0 1 5.5 3h3M15.5 3h3A2.5 2.5 0 0 1 21 5.5v3M21 15.5v3a2.5 2.5 0 0 1-2.5 2.5h-3M8.5 21h-3A2.5 2.5 0 0 1 3 18.5v-3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/><circle cx="12" cy="12" r="4.2"/><circle cx="12" cy="12" r="1.8" fill="#1c1b19" fill-opacity="0.35"/>`,
  "send-to-phone": `<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><rect x="8.6" y="5" width="6.8" height="11.5" rx="1" fill="#1c1b19" fill-opacity="0.3"/><path d="M12 7.2v6.2M9.6 11l2.4 2.4 2.4-2.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  terminal: `<text x="12" y="16.8" text-anchor="middle" font-size="12.5" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-weight="700" fill="currentColor">&gt;_</text>`,
  mail: `<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 7.5 12 13.5l9.5-6" stroke="#1c1b19" stroke-opacity="0.35" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  assistant: `<path d="M11 3.5l2.1 5.9 5.9 2.1-5.9 2.1L11 19.5l-2.1-5.9L3 11.5l5.9-2.1z"/><path d="M18.5 2.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z" ${SOFT}/>`,
  "study-notes": `<path d="M3.5 5.5A1.5 1.5 0 0 1 5 4h4.5a3 3 0 0 1 2.5 1.3V20A3.3 3.3 0 0 0 9.5 19H5a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M20.5 5.5A1.5 1.5 0 0 0 19 4h-4.5a3 3 0 0 0-2.5 1.3V20a3.3 3.3 0 0 1 2.5-1H19a1.5 1.5 0 0 0 1.5-1.5z" ${SOFT}/><path d="M15.5 4v6l1.5-1.2L18.5 10V4z" fill="#1c1b19" fill-opacity="0.35"/>`,
  calculator: `<rect x="5" y="2.5" width="14" height="19" rx="2.5"/><rect x="7.2" y="4.8" width="9.6" height="4.2" rx="1" fill="#1c1b19" fill-opacity="0.32"/><g fill="#1c1b19" fill-opacity="0.32"><circle cx="8.6" cy="12.3" r="1.2"/><circle cx="12" cy="12.3" r="1.2"/><circle cx="15.4" cy="12.3" r="1.2"/><circle cx="8.6" cy="15.6" r="1.2"/><circle cx="12" cy="15.6" r="1.2"/><circle cx="15.4" cy="15.6" r="1.2"/><circle cx="8.6" cy="18.9" r="1.2"/><circle cx="12" cy="18.9" r="1.2"/><circle cx="15.4" cy="18.9" r="1.2"/></g>`,
  assignments: `<rect x="4.5" y="4" width="15" height="17.5" rx="2.5"/><rect x="8.5" y="2.5" width="7" height="3.5" rx="1.2" ${SOFT}/><path d="M7.8 11.2l1.6 1.6 3-3M7.8 16.2l1.6 1.6 3-3" stroke="#1c1b19" stroke-opacity="0.45" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M14 11.5h3M14 16.5h3" stroke="#1c1b19" stroke-opacity="0.35" stroke-width="1.6" stroke-linecap="round" fill="none"/>`,
  citations: `<path d="M5 14.5a4.5 4.5 0 0 1 4.5-4.5V6.5A8 8 0 0 0 3 14.5V19h6.5v-4.5zM14.5 14.5a4.5 4.5 0 0 1 4.5-4.5V6.5a8 8 0 0 0-6.5 8V19H19v-4.5z"/>`,
  "focus-timer": `<path d="M9.5 2.5h5v2h-5z"/><path fill-rule="evenodd" d="M12 5.5a8 8 0 1 1 0 16 8 8 0 0 1 0-16zm0 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z"/><path d="M12 9.5v4l2.6 1.6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M18.5 4.5l1.8 1.8" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>`,
  "exam-mode": `<path fill-rule="evenodd" d="M12 2.5l7.5 2.8v6.2c0 4.9-3.2 8.3-7.5 10-4.3-1.7-7.5-5.1-7.5-10V5.3zm-3.6 9.9 2.7 2.7 5-5-1.5-1.5-3.5 3.5-1.2-1.2z"/>`,
  invoices: `<path d="M5.5 2.5h13v18.5l-2.2-1.5-2.1 1.5-2.2-1.5-2.2 1.5-2.1-1.5-2.2 1.5z"/><path d="M8.5 7h7M8.5 10.5h7M8.5 14h4" stroke="#1c1b19" stroke-opacity="0.35" stroke-width="1.6" stroke-linecap="round" fill="none"/>`,
  money: `<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="12" cy="12" r="3.3" fill="#1c1b19" fill-opacity="0.3"/><circle cx="5.8" cy="9.2" r="0.9" fill="#1c1b19" fill-opacity="0.3"/><circle cx="18.2" cy="14.8" r="0.9" fill="#1c1b19" fill-opacity="0.3"/>`,
};
