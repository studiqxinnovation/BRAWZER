/**
 * Web apps: well-known sites the App Store offers as shortcuts. Each opens in
 * a cloud browser window, like any page; Brawzer holds no account with any of
 * them. The list lives here so the API can fetch each site's own icon for
 * exactly these sites and no other address.
 */
export type WebAppCategory =
  "Mail and chat" | "AI" | "Social" | "Work" | "Study" | "Watch and read";

export interface WebApp {
  id: string;
  name: string;
  url: string;
  description: string;
  category: WebAppCategory;
  colour: string;
  /**
   * The browser it needs, when the site turns others away. Bee says what it
   * is (Chromium, with its own name), and some sites only let Google Chrome
   * in by name; those open in Chrome when the computer has it.
   */
  engine?: "chrome" | "firefox" | "chromium";
}

export const webApps: readonly WebApp[] = [
  {
    id: "telegram",
    name: "Telegram",
    url: "https://web.telegram.org/",
    description: "Telegram’s chats, on the web.",
    category: "Mail and chat",
    colour: "#2aabee",
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    url: "https://chatgpt.com/",
    description: "OpenAI’s assistant.",
    category: "AI",
    colour: "#10a37f",
  },
  {
    id: "claude",
    name: "Claude",
    url: "https://claude.ai/",
    description: "Anthropic’s assistant.",
    category: "AI",
    colour: "#d97757",
  },
  {
    id: "gemini",
    name: "Gemini",
    url: "https://gemini.google.com/",
    description: "Google’s assistant.",
    category: "AI",
    colour: "#4285f4",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    url: "https://www.perplexity.ai/",
    description: "Answers with sources.",
    category: "AI",
    colour: "#20808d",
  },
  {
    id: "slack",
    name: "Slack",
    url: "https://app.slack.com/",
    description: "Team chat and channels.",
    category: "Work",
    colour: "#4a154b",
  },
  {
    id: "discord",
    name: "Discord",
    url: "https://discord.com/app",
    description: "Voice, video and chat communities.",
    category: "Social",
    colour: "#5865f2",
  },
  {
    id: "google-meet",
    name: "Google Meet",
    url: "https://meet.google.com/",
    description: "Google’s video calls.",
    category: "Work",
    colour: "#00897b",
  },
  {
    id: "microsoft-teams",
    name: "Microsoft Teams",
    url: "https://teams.microsoft.com/",
    description: "Microsoft’s meetings and chat.",
    category: "Work",
    colour: "#5059c9",
  },
  {
    id: "x",
    name: "X",
    url: "https://x.com/",
    description: "Posts and news as they happen.",
    category: "Social",
    colour: "#111111",
  },
  {
    id: "instagram",
    name: "Instagram",
    url: "https://www.instagram.com/",
    description: "Photos and reels.",
    category: "Social",
    colour: "#e1306c",
  },
  {
    id: "facebook",
    name: "Facebook",
    url: "https://www.facebook.com/",
    description: "Friends, groups and pages.",
    category: "Social",
    colour: "#1877f2",
  },
  {
    id: "reddit",
    name: "Reddit",
    url: "https://www.reddit.com/",
    description: "Communities for everything.",
    category: "Social",
    colour: "#ff4500",
  },
  {
    id: "spotify",
    name: "Spotify",
    url: "https://open.spotify.com/",
    description: "Music and podcasts (with your own account).",
    category: "Watch and read",
    colour: "#1db954",
  },
  {
    id: "github",
    name: "GitHub",
    url: "https://github.com/",
    description: "Code, issues and pull requests.",
    category: "Work",
    colour: "#24292f",
  },
  {
    id: "figma",
    name: "Figma",
    url: "https://www.figma.com/",
    description: "Design together, in the browser.",
    category: "Work",
    colour: "#a259ff",
  },
  {
    id: "trello",
    name: "Trello",
    url: "https://trello.com/",
    description: "Boards, lists and cards.",
    category: "Work",
    colour: "#0052cc",
  },
  {
    id: "google-drive",
    name: "Google Drive",
    url: "https://drive.google.com/",
    description: "Files kept with Google (Brawzer Drive is separate).",
    category: "Work",
    colour: "#1fa463",
  },
  {
    id: "duolingo",
    name: "Duolingo",
    url: "https://www.duolingo.com/",
    description: "Languages, a lesson a day.",
    category: "Study",
    colour: "#58cc02",
  },
  {
    id: "coursera",
    name: "Coursera",
    url: "https://www.coursera.org/",
    description: "Courses from universities and companies.",
    category: "Study",
    colour: "#0056d2",
  },
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
    engine: "chrome",
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
