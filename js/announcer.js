// ============================================================
// AI ANNOUNCER — grade-aware commentary + speech synthesis
// ============================================================
const Announcer = (function () {
  let enabled = true;
  let voice = null;
  let hideTimer = null;

  // Pick the deepest / most broadcast-y English voice available
  function loadVoice() {
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return;
    const prefer = ["Microsoft Guy", "Microsoft David", "Google US English", "Microsoft Mark", "Daniel"];
    for (const name of prefer) {
      const v = voices.find(v => v.name.includes(name));
      if (v) { voice = v; return; }
    }
    voice = voices.find(v => v.lang.startsWith("en")) || voices[0];
  }
  if ('speechSynthesis' in window) {
    loadVoice();
    speechSynthesis.onvoiceschanged = loadVoice;
  }

  const LINES = {
    steal: [
      "ARE YOU KIDDING ME?! {player} was still on the board?! {team} just committed grand larceny in broad daylight!",
      "Somebody call the league office — {team} just STOLE {player} {delta} picks after his A D P. That's a heist!",
      "Touchdown before the season even starts! {player} at pick {pick}? {team}'s war room is COOKING!",
      "The rest of this league fell asleep at the wheel and {team} drove off with {player}. Unbelievable value!"
    ],
    great: [
      "Now THAT is how you draft! {player} brings elite production to {team} and the value is beautiful.",
      "{team} steps to the podium and NAILS it. {player} well below A D P — the analytics department is doing backflips.",
      "Great pick alert! {player} to {team}. Draft capital well spent, my friends.",
      "{team} finds {player} still sitting there at pick {pick} and does NOT overthink it. Textbook."
    ],
    good: [
      "Solid, sensible football right there. {player} fits {team} like a broken-in glove.",
      "{team} takes {player} — right around where the big boards had him. No fireworks, no regrets.",
      "A pro's pick. {player} at pick {pick} is fair market value, and fair value wins leagues.",
      "{team} stays on script and grabs {player}. The draft room nods in quiet approval."
    ],
    reach: [
      "Hmmmm. {player} is a fine player, but {team} reached about {delta} picks early. Somebody got nervous!",
      "{team} really said 'he's MY guy' and sprinted the card up early for {player}. Bold. Slightly reckless. Mostly bold.",
      "The board said wait, the heart said now. {team} takes {player} ahead of schedule at pick {pick}.",
      "Easy there, {team}! {player} would've been sitting there a round later. Patience is a virtue, folks."
    ],
    bad: [
      "OH NO. No no no. {player} at pick {pick}?! The {team} war room just set off every smoke alarm in the building!",
      "That sound you hear is every draft analyst in America spitting out their coffee. {player} went {delta} picks early to {team}!",
      "I've seen some reaches in my day, folks, but {team} just pulled a hamstring stretching for {player}.",
      "Flag on the play! {team} charged with unnecessary reachness — {player}, {delta} picks before his A D P. FIFTEEN YARDS."
    ],
    earlyK: [
      "A KICKER?! In round {round}?! {team}, we need to talk. Privately. With a therapist present.",
      "{team} drafts {player}... a kicker... in round {round}. Ladies and gentlemen, we have our first cry for help."
    ],
    earlyDST: [
      "A defense in round {round}? {team} is playing checkers while everyone else plays chess... backwards.",
      "{team} takes {player} WAY early. Defenses win championships — but not from round {round}, my friend."
    ],
    qbHoard: [
      "That's {count} quarterbacks for {team}! Are we starting a quarterback academy over there?!",
      "{team} takes ANOTHER passer — {player}. One football, folks. There's only one football."
    ],
    needFill: [
      " And it fills a gaping hole at {pos}, which makes it even sweeter.",
      " Smart roster construction too — {team} needed a {pos} badly."
    ],
    wrap: [
      "And that's the draft, folks! The rosters are set, the trash talk is loaded — let's play some football!",
      "The board is FULL and the war rooms are quiet. Championships are won in July, my friends. Let's see the final grades!",
      "That's a wrap on the draft! Some heroes, some heartbreak, and at least one kicker taken WAY too early. Let's tally it up!"
    ]
  };

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function fill(tpl, ctx) {
    return tpl
      .replace(/{player}/g, ctx.player)
      .replace(/{team}/g, ctx.team)
      .replace(/{pick}/g, ctx.pickLabel)
      .replace(/{delta}/g, Math.abs(Math.round(ctx.delta)))
      .replace(/{round}/g, ctx.round)
      .replace(/{pos}/g, ctx.pos)
      .replace(/{count}/g, ctx.qbCount);
  }

  function buildLine(ctx) {
    // Special-case roasts take priority
    if (ctx.pos === "K" && ctx.round <= 11) return fill(pick(LINES.earlyK), ctx);
    if (ctx.pos === "DST" && ctx.round <= 9) return fill(pick(LINES.earlyDST), ctx);
    if (ctx.pos === "QB" && ctx.qbCount >= 3) return fill(pick(LINES.qbHoard), ctx);

    let line;
    if (ctx.score >= 88)      line = fill(pick(LINES.steal), ctx);
    else if (ctx.score >= 72) line = fill(pick(LINES.great), ctx);
    else if (ctx.score >= 50) line = fill(pick(LINES.good), ctx);
    else if (ctx.score >= 32) line = fill(pick(LINES.reach), ctx);
    else                      line = fill(pick(LINES.bad), ctx);

    if (ctx.filledNeed && ctx.score >= 50) line += fill(pick(LINES.needFill), ctx);
    return line;
  }

  function speak(text) {
    if (!enabled || !('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[{}]/g, ''));
    if (voice) u.voice = voice;
    u.rate = 1.06;
    u.pitch = 0.85;
    u.volume = 1;
    u.onstart = () => document.getElementById('announcer').classList.add('talking');
    u.onend = () => document.getElementById('announcer').classList.remove('talking');
    speechSynthesis.speak(u);
  }

  function show(text) {
    const el = document.getElementById('announcer');
    const txt = document.getElementById('ann-text');
    el.classList.remove('hidden');
    // typewriter effect
    txt.textContent = '';
    let i = 0;
    const iv = setInterval(() => {
      txt.textContent = text.slice(0, ++i);
      if (i >= text.length) clearInterval(iv);
    }, 18);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => el.classList.add('hidden'), Math.max(9000, text.length * 60));
  }

  return {
    setEnabled(v) { enabled = v; if (!v) speechSynthesis.cancel(); },
    call(ctx) {
      const line = buildLine(ctx);
      show(line);
      speak(line);
      return line;
    },
    wrap() {
      const line = pick(LINES.wrap);
      show(line);
      speak(line);
      return line;
    },
    stop() { if ('speechSynthesis' in window) speechSynthesis.cancel(); }
  };
})();
