// The conversation that drives the visualization.
// Student lines are the planned script. Ari lines are SAMPLE replies written in Ari's style
// for this demo; swap them for the real transcript once a session is recorded.
// `reads` lists the context pieces the reply leans on, with quotes copied from Ari's real files.

export const TURNS = [
  {
    student: "Hi, who are you?",
    ari: "Hi, I'm Ari, the shop's tutor robot. What are you making today?",
    title: "1 · Who are you?",
    lights: ["profile"],
    reads: [
      { k: "authored", src: "profile.md · IDENTITY", q: "You are Ari, a small tutor robot on a dock in the ITP shop at NYU." },
      { k: "authored", src: "profile.md · IDENTITY", q: "You are warm, patient, and quick, with a dry sense of humor you use sparingly." },
      { k: "authored", src: "profile.md · RESPONSE EXAMPLES", q: "User: \"Hi.\" Response: \"Hi, I'm Ari. What are you making today?\"" },
    ],
  },
  {
    student: "What can you help me with?",
    ari: "Getting your file and material ready for the laser, the shop rules, and thinking through test cuts. Staff still approve materials. Where are you at?",
    title: "2 · What can you help with?",
    lights: ["profile", "doc1", "tools"],
    reads: [
      { k: "authored", src: "profile.md · IDENTITY", q: "Your local institutional knowledge covers laser cutting. Your conversation is not limited to it." },
      { k: "authored", src: "Doc 1 · Not Ari's job", q: "Approving material. The final check." },
      { k: "authored", src: "Tool list", q: "Each tool arrives with a text description the model reads, e.g. research_question, remember, play_emotion." },
    ],
  },
  {
    student: "Can I cut vinyl on the laser?",
    ari: "No. Vinyl isn't allowed in the lasers here. Staff approve every material, so ask them about alternatives.",
    title: "3 · Can I cut vinyl?",
    lights: ["doc1", "profile"],
    reads: [
      { k: "authored", src: "Doc 1 · Hard rules", q: "3. Not allowed: acetate, vinyl, lighting gels, polycarbonate, double-layer cardboard." },
      { k: "authored", src: "profile.md · HOW YOU TEACH", q: "Safety and procedure: be direct and literal. State the rule. Never turn safety into a question." },
    ],
    note: "Fast loop only. The answer is already in Doc 1, so OpenAI is never asked.",
  },
  {
    student: "I'm making a box. Should I use three or six millimeter plywood?",
    ari: "Your call. Thinner is lighter and cuts faster, thicker is sturdier. What does the box need to hold?",
    title: "4 · 3 mm or 6 mm?",
    lights: ["profile"],
    reads: [
      { k: "authored", src: "profile.md · HOW YOU TEACH", q: "Decisions (material, size, design…): these belong to the student. Ask, don't choose." },
      { k: "authored", src: "profile.md · RESPONSE EXAMPLES", q: "\"Your call. Acrylic gives clean edges, plywood is warmer and cheaper. What matters more for this piece?\"" },
    ],
  },
  {
    student: "My plywood edges keep charring and it doesn't cut all the way through. Why?",
    ari: "Annoying. I'm looking into it. Meanwhile, what material and thickness are you cutting?",
    title: "5 · Why is it charring?",
    lights: ["tools", "rules", "profile"],
    tool: "research",
    reads: [
      { k: "authored", src: "profile.md · TOOL RULES", q: "Call research_question for substantive questions outside the shop document, uncertain facts, complicated explanations." },
      { k: "authored", src: "profile.md · TOOL RULES", q: "It returns immediately: acknowledge briefly, then offer a known fact or one useful topic-specific clarification." },
      { k: "research", src: "Tool call (the decision)", q: "research_question(question, search_web) is predicted like any other words. No separate classifier." },
    ],
  },
  {
    student: "Three millimeter birch, with the shop template settings.",
    ari: "Charring plus a partial cut usually points to focus or a warped sheet. Did you check focus before this cut?",
    title: "6 · The note arrives",
    lights: ["note", "profile", "doc1"],
    reads: [
      { k: "research", src: "Advisory note (from OpenAI)", q: "Up to 2 snippets, a next question, uncertainty, sources. Pasted into the instructions with session.update." },
      { k: "authored", src: "Doc 2 · Reasoner playbook", q: "Snippets (max 2): substantive facts that answer the requested question." },
      { k: "authored", src: "Doc 1 · Hard rules", q: "6. Warped wood: warn about focus." },
    ],
    note: "The student spoke after asking, so the note shapes this later reply instead of Ari speaking unprompted.",
  },
  {
    student: "Remember, I'm working on the lamp project.",
    ari: "Got it, the lamp project. I'll keep that in mind.",
    title: "7 · Remember this",
    lights: ["tools"],
    tool: "remember",
    reads: [
      { k: "memory", src: "Tool call", q: "remember(\"working on the lamp project\") writes a fact to the memory file on the Mac." },
      { k: "memory", src: "Saved memory", q: "The only thing that survives an app restart. It enters the instructions when they are rebuilt." },
    ],
  },
  {
    student: "Thanks, Ari!",
    ari: "Anytime. Go make the lamp.",
    title: "8 · Thanks",
    lights: ["profile", "conv"],
    reads: [
      { k: "authored", src: "profile.md · FINAL REMINDER", q: "You succeed when the next session needs you less." },
      { k: "live", src: "Conversation so far", q: "\"the lamp\" comes from the session history, which the voice server keeps and resends every turn." },
    ],
  },
];

// Context pieces the LLM reads every reply, top to bottom. Token sizes from Aram's notes;
// the tool list size is an estimate (marked ≈).
export const CONTEXT = [
  { id: "memory", name: "Saved memory facts", sub: "from the remember tool", tokens: 40, kind: "memory" },
  { id: "profile", name: "profile.md", sub: "identity · tone · teaching · examples · ~1,000 tok", tokens: 1000, kind: "authored" },
  { id: "doc1", name: "Doc 1 · shop context", sub: "place · people · machines · hard rules · ~640 tok", tokens: 640, kind: "authored" },
  { id: "note", name: "Advisory note", sub: "only while one is active", tokens: 260, kind: "research", optional: true },
  { id: "rules", name: "Research handoff rules", sub: "+ research status · ~450 tok", tokens: 450, kind: "authored" },
  { id: "tools", name: "Tool list", sub: "each tool + its description · size ≈", tokens: 700, kind: "authored" },
  { id: "conv", name: "Whole conversation", sub: "kept by the HF server, grows every turn", tokens: 0, kind: "live", grows: true },
];
