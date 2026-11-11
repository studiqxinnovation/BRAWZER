/**
 * Ready-made documents and sheets, opened in Writer or Calc as new, unsaved
 * files. Written plainly, as starting points.
 */

export interface DocumentTemplate {
  id: string;
  name: string;
  description: string;
  category: "Business" | "Study" | "Personal";
  app: "writer" | "calc";
  /** Writer: the document's HTML. */
  html?: string;
  /** Calc: cells by address, values or formulas. */
  cells?: Record<string, string>;
}

const list = (items: string[]) => `<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;

export const templates: readonly DocumentTemplate[] = [
  {
    id: "business-plan",
    name: "Business plan",
    description: "The sections a lender or partner expects, each with what to write.",
    category: "Business",
    app: "writer",
    html: `<h1>Business plan</h1><p><i>Business name · date</i></p>
<h2>1. Summary</h2><p>In a few sentences: what the business does, for whom, and what you’re asking for.</p>
<h2>2. The problem and your answer</h2><p>Who has the problem, how they deal with it today, and why your way is better.</p>
<h2>3. Customers and market</h2>${list(["Who buys, and why", "How many of them there are near you", "What they pay today"])}
<h2>4. Competitors</h2><p>Who else serves these customers, and what you do differently.</p>
<h2>5. How you’ll sell</h2>${list(["Where customers will find you", "Prices", "The first 10 customers: who and how"])}
<h2>6. Operations</h2><p>Premises, suppliers, equipment, and who does what.</p>
<h2>7. Money</h2>${list(["Start-up costs", "Monthly costs", "Sales forecast for 12 months", "When you break even"])}
<h2>8. Risks</h2><p>What could go wrong, and what you’d do about each.</p>`,
  },
  {
    id: "pitch-outline",
    name: "Pitch outline",
    description: "Ten slides’ worth of points for a short investor or competition pitch.",
    category: "Business",
    app: "writer",
    html: `<h1>Pitch outline</h1>
<ol><li><b>Hook</b>: one sentence anyone would remember.</li><li><b>Problem</b>: who has it and what it costs them.</li><li><b>Solution</b>: what you do, shown simply.</li><li><b>Why now</b>: what changed that makes this possible.</li><li><b>Market</b>: how many customers, and what they spend.</li><li><b>Business model</b>: who pays, how much, how often.</li><li><b>Traction</b>: what you’ve proved so far.</li><li><b>Competition</b>: the alternatives, and your edge.</li><li><b>Team</b>: why you are the people to do it.</li><li><b>The ask</b>: how much, and what it pays for.</li></ol>`,
  },
  {
    id: "meeting-notes",
    name: "Meeting notes",
    description: "Who came, what was decided, and who does what next.",
    category: "Business",
    app: "writer",
    html: `<h1>Meeting notes</h1><p><b>Date:</b> </p><p><b>Present:</b> </p>
<h2>Agenda</h2>${list(["", ""])}<h2>Decisions</h2>${list([""])}<h2>Actions</h2>${list(["Who · what · by when"])}`,
  },
  {
    id: "cover-letter",
    name: "Cover letter",
    description: "A one-page letter for a job application.",
    category: "Personal",
    app: "writer",
    html: `<p>Your name<br>Your email · phone</p><p>Date</p><p>Dear [name],</p>
<p>I’m applying for the [role] at [organisation], which I saw on [where].</p>
<p>In my [current role or course], I [one achievement with a number]. That’s why I’m confident I can [what the job needs].</p>
<p>What draws me to [organisation] is [something specific about them].</p>
<p>I’d welcome the chance to talk. Thank you for your time.</p><p>Yours sincerely,<br>Your name</p>`,
  },
  {
    id: "essay-plan",
    name: "Essay plan",
    description: "Question, argument, and a paragraph-by-paragraph outline with sources.",
    category: "Study",
    app: "writer",
    html: `<h1>Essay plan</h1><p><b>Question:</b> </p><p><b>My argument in one sentence:</b> </p>
<h2>Introduction</h2><p>Context, the question in your words, and your argument.</p>
<h2>Paragraph 1</h2>${list(["Point", "Evidence (source)", "Why it supports the argument"])}
<h2>Paragraph 2</h2>${list(["Point", "Evidence (source)", "Why it supports the argument"])}
<h2>Paragraph 3: the other side</h2>${list(["The strongest objection", "Your answer to it"])}
<h2>Conclusion</h2><p>What you showed, and why it matters.</p>`,
  },
  {
    id: "cash-flow",
    name: "Cash-flow forecast",
    description: "Money in and out for six months, with each month’s closing balance.",
    category: "Business",
    app: "calc",
    cells: {
      A1: "Cash-flow forecast",
      A3: "",
      B3: "Month 1",
      C3: "Month 2",
      D3: "Month 3",
      E3: "Month 4",
      F3: "Month 5",
      G3: "Month 6",
      A4: "Opening balance",
      B4: "0",
      C4: "=B12",
      D4: "=C12",
      E4: "=D12",
      F4: "=E12",
      G4: "=F12",
      A5: "Sales",
      A6: "Other income",
      A7: "Total in",
      ...Object.fromEntries(
        ["B", "C", "D", "E", "F", "G"].map((c) => [`${c}7`, `=SUM(${c}5:${c}6)`]),
      ),
      A8: "Stock and materials",
      A9: "Rent and bills",
      A10: "Wages",
      A11: "Total out",
      ...Object.fromEntries(
        ["B", "C", "D", "E", "F", "G"].map((c) => [`${c}11`, `=SUM(${c}8:${c}10)`]),
      ),
      A12: "Closing balance",
      ...Object.fromEntries(
        ["B", "C", "D", "E", "F", "G"].map((c) => [`${c}12`, `=${c}4+${c}7-${c}11`]),
      ),
    },
  },
  {
    id: "weekly-budget",
    name: "Weekly budget",
    description: "Income, spending by category, and what’s left.",
    category: "Personal",
    app: "calc",
    cells: {
      A1: "Weekly budget",
      A3: "Income",
      B3: "0",
      A5: "Rent",
      A6: "Food",
      A7: "Travel",
      A8: "Phone and internet",
      A9: "Other",
      A10: "Total spending",
      B10: "=SUM(B5:B9)",
      A12: "Left over",
      B12: "=B3-B10",
    },
  },
  {
    id: "grade-tracker",
    name: "Grade tracker",
    description: "Marks and weights for each piece of coursework, and the module average.",
    category: "Study",
    app: "calc",
    cells: {
      A1: "Grade tracker",
      A3: "Assessment",
      B3: "Mark %",
      C3: "Weight %",
      D3: "Weighted",
      ...Object.fromEntries(
        [4, 5, 6, 7, 8].map((r) => [`D${String(r)}`, `=B${String(r)}*C${String(r)}/100`]),
      ),
      A10: "Total weight",
      C10: "=SUM(C4:C8)",
      A11: "Average so far",
      D11: "=SUM(D4:D8)/C10*100",
    },
  },
];

export const templateById = (id: string | undefined) => templates.find((entry) => entry.id === id);
