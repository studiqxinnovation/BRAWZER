/**
 * Pricing content. Plans and prices are not decided yet, so this file states
 * only what is true today: what every plan is meant to include and what will
 * differ between plans. Replace it when pricing is final.
 */
export const pricing = {
  status:
    "Brawzer is still in development, so there are no prices yet. Here is what every plan will include, and what will differ between them.",
  included: [
    {
      title: "The Brawzer browser",
      description: "A complete cloud browser that opens inside the page on any computer.",
    },
    {
      title: "Browser profiles",
      description:
        "Separate cookies, history, bookmarks and extensions for each part of your life.",
    },
    {
      title: "Brawzer Drive",
      description: "Downloads saved to the cloud and scanned, never left on the computer.",
    },
    {
      title: "Security controls",
      description: "Passkeys, two-factor authentication, idle locking and remote sign-out.",
    },
    {
      title: "Sessions on any device",
      description: "Pick up where you left off on the next computer you use.",
    },
  ],
  variesBy: [
    "How many profiles you can keep",
    "Brawzer Drive storage",
    "Browsing hours each month",
    "Proxy features",
    "Team accounts and administration",
  ],
} as const;
