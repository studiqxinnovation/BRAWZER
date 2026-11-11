/**
 * Web apps: well-known sites the App Store offers as shortcuts. Each opens
 * in a cloud browser window, like any page; Brawzer holds no account with
 * any of them. Tiles show the name's initial on a colour, not the site's
 * logo.
 */
export interface WebApp {
  id: string;
  name: string;
  url: string;
  description: string;
  category: "Mail and chat" | "Work" | "Study" | "Watch and read";
  colour: string;
}

export const webApps: readonly WebApp[] = [
  {
    id: "gmail",
    name: "Gmail",
    url: "https://mail.google.com/",
    description: "Google’s email.",
    category: "Mail and chat",
    colour: "#d93025",
  },
  {
    id: "outlook",
    name: "Outlook",
    url: "https://outlook.live.com/mail/",
    description: "Microsoft’s email and calendar.",
    category: "Mail and chat",
    colour: "#0f6cbd",
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    url: "https://web.whatsapp.com/",
    description: "Messages, linked to your phone.",
    category: "Mail and chat",
    colour: "#128c7e",
  },
  {
    id: "zoom",
    name: "Zoom",
    url: "https://app.zoom.us/wc",
    description: "Video meetings in the browser.",
    category: "Mail and chat",
    colour: "#0b5cff",
  },
  {
    id: "google-docs",
    name: "Google Docs",
    url: "https://docs.google.com/",
    description: "Documents, sheets and slides.",
    category: "Work",
    colour: "#1a73e8",
  },
  {
    id: "microsoft-365",
    name: "Microsoft 365",
    url: "https://www.office.com/",
    description: "Word, Excel and PowerPoint online.",
    category: "Work",
    colour: "#c43e1c",
  },
  {
    id: "canva",
    name: "Canva",
    url: "https://www.canva.com/",
    description: "Designs, posters and presentations.",
    category: "Work",
    colour: "#7d2ae8",
  },
  {
    id: "notion",
    name: "Notion",
    url: "https://www.notion.so/",
    description: "Notes, docs and wikis.",
    category: "Work",
    colour: "#191919",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    url: "https://www.linkedin.com/",
    description: "Jobs and your professional network.",
    category: "Work",
    colour: "#0a66c2",
  },
  {
    id: "google-classroom",
    name: "Google Classroom",
    url: "https://classroom.google.com/",
    description: "Classes, coursework and feedback.",
    category: "Study",
    colour: "#188038",
  },
  {
    id: "khan-academy",
    name: "Khan Academy",
    url: "https://www.khanacademy.org/",
    description: "Free lessons and practice.",
    category: "Study",
    colour: "#14bf96",
  },
  {
    id: "wikipedia",
    name: "Wikipedia",
    url: "https://www.wikipedia.org/",
    description: "The free encyclopedia.",
    category: "Study",
    colour: "#3a3a3a",
  },
  {
    id: "youtube",
    name: "YouTube",
    url: "https://www.youtube.com/",
    description: "Videos.",
    category: "Watch and read",
    colour: "#e62117",
  },
  {
    id: "bbc-news",
    name: "BBC News",
    url: "https://www.bbc.co.uk/news",
    description: "News from the BBC.",
    category: "Watch and read",
    colour: "#b80000",
  },
];

export const webAppById = (id: string) => webApps.find((app) => app.id === id);
