# /prose/ corpus study — descriptive forensics

read: all 53 essays in `public/content/prose/`, full text. this is a description of what the corpus does, with receipts. it is not a rulebook and deliberately contains no "therefore" section. the corpus is llm-extrapolated and treated here as evidence, not scripture — section 7 documents where it sags into llm-median itself.

---

## 1. precision without rubric language

the corpus never uses scoring-sheet vocabulary. no "partial credit", no "splits along the cut", no "on a scale of", no letter-grade or percentage-of-correctness framing applied to claims. when an essay needs a graded or bounded claim, it uses one of five renderings:

**(a) concede flat, then bound with a standalone "But".** the graded claim is two sentences, not one hedged sentence.

> "That's the heuristic. Volume at speed means low quality. It's usually correct. / But the heuristic assumes a single bottleneck" — *am-i-just-pretending*

> "It sounds rigorous. It has a name and a philosopher behind it. But applied consistently, it seems to prove too much." — *should-computers-have-rights*

> "Those are all defenses against grief, and defenses against grief are defenses against life." vs the earlier concession "The grief is real." — *nothing-lasts*

**(b) quantify casually, in prose, with a thrown-away number.** the number does the grading; the tone stays conversational.

> "When the constraints are clear ... yes. The right tool for the job. Obvious. Useful. Done. / This accounts for maybe 5% of the times people say it." — *the-right-tool-for-the-job*

> "The barriers that used to require teams, funding, institutions - many of them are gone. Not all. But many." — *how-much-could-i-possibly-do*

> "Not nothing. There are still things that surprise. But they're harder to find." — *why-is-nothing-special-anymore*

**(c) name the boundary of validity as cases, not as a score.** "works in case A not B" is rendered as two concrete scenarios side by side.

> "Trust it for the common case. Trust it for the boilerplate. ... Be more careful with the things that matter most. With the edge cases." — *can-programs-write-programs*

> "When to use what exists" / "When to build anyway" — two full sections doing case-splitting as structure, not as a rubric sentence — *why-cant-you-just-use-what-exists*

> "Sometimes a screwdriver really is better than a hammer for screws. But less often than people think." — *the-right-tool-for-the-job*

**(d) explicit spectrum vocabulary when gradation is itself the topic.** the corpus talks about "how much", never "what score".

> "The intent isn't binary — present or absent. It's a question of *how much* of the output reflects someone's choices versus the model's. And that ratio varies wildly." — *whats-the-actual-issue-with-generative-ai*

> "Ecosystems that partially match a filter are partially opaque — not in or out, but *how much* in. Everything is gradient, nothing is binary." — *this-site-is-designed*

**(e) honest refusal to grade.** where a cleaner writer would give a verdict with a confidence level, the corpus says it can't.

> "Can you tell when it's wrong? / Sometimes. If you have taste ... But sometimes you can't. And that's the honest answer." — *can-you-tell-when-its-wrong*

> "Probably not. But you can't prove it. And that's the uncomfortable part." — *am-i-just-pretending*

> "Is that meaningful? Is it 'real'? Is it creative? / Probably depends on who's asking." — *is-it-just-interpolation*

one more precision mechanism worth isolating: **technical terms get an appositive gloss inline, once, then are used bare.**

> "You trust the linter - an automated reviewer that catches common mistakes." — *how-do-i-know-this-code-is-good*

> "Fuzz testing - throwing random garbage at the code to see what breaks - helps. Property testing - asserting that general rules hold across thousands of generated inputs - helps." — *how-do-i-know-this-code-is-good*

> "a pattern in AI research called **specification gaming**" — bolded term, then immediately three concrete examples (tall falling robot, boat race, confident wrongness) instead of a definition — *can-you-tell-when-its-wrong*

the failure mode of this system is in section 7: the graded claim frequently degrades into a blanket "tends to / seems to" hedge that grades nothing.

---

## 2. first person

**"i" exists but is rationed, and it does exactly one job: epistemic self-undercut.** the corpus splits into three tiers.

**tier 1 — fully first person (2 essays).** *why-do-i-build-tools* is confessional throughout: "Because I don't know what else to build. / That's the honest answer." ... "I'm stuck in architect mode." *why-do-i-reinvent-everything* opens first person ("Not because I think I can do it better") but drains into "you"/"we" by the middle.

**tier 2 — second person with "i" incursions (roughly a dozen essays).** the "i" appears late, usually near the end, and always to confess a limit rather than claim authority:

> "I keep wanting to say something clean here, like 'so just stop labeling yourself,' but that's not how it works either." — *what-are-labels-anyway*

> "Most people skip this because honest self-observation is uncomfortable. I skip it." — *who-am-i*

> "It's more like the way a river keeps being a river while never being the same water. Except that's not right either, because a river has banks and you don't." — *who-am-i* (self-correction mid-metaphor, the signature move)

> "Tools work - actually, I'm not sure the tool analogy holds as cleanly as I want it to." — *where-does-meaning-live*

> "If you really lived like you knew that ... what would you do differently? I don't know either." — *nothing-lasts*, final line

> "and I'm hedging because I genuinely don't know if this generalizes beyond the few people I've watched do it" — *why-is-perfectionism-a-trap*

> "I don't know what people do with that freed-up attention. That's the honest answer." — *what-would-it-actually-take*

> "I'm not sure what to do with that. It's not a comforting realization." — *why-are-you-lonely*

*why-are-we-afraid-of-ai* even puts it in a heading: "## I'm not sure what to do with this". *why-do-you-keep-fitting-in* has "## The part I can't picture".

**tier 3 — zero "i" (the majority).** *but*, *its-not-that-simple*, *everything-changes*, *why-is-software-hard*, *can-you-tell-when-its-wrong*, most of the technical essays.

**authorial presence without "i"** is achieved through three mechanics:

1. **the site as third-person subject** in the meta cluster: "This site is AI-written." (*the-great-deceit*), "The author is plenty negative. But negative language on a public page has no reliable positive expected value." (*this-site-is-designed*) — presence via "the author", never "i".
2. **specific autobiography smuggled in as generic "you" or "someone":** "A [decompiler](/project/reincarnate) motivated by a port written by hand years ago." (*are-we-building-toward-something*) — clearly one person's inventory, grammatically nobody's.
3. **taste asserted as observation:** "Nobody writes love songs about glue." (*why-glue*) — opinionated sentences with no owner.

one interesting boundary case: *this-is-not-a-personal-website* claims "The essays are in second person — 'you,' not 'I.'" — which the corpus itself falsifies (see tier 1 and 2). the site's self-description is stricter than its practice.

---

## 3. citation + linking

**internal links are the dominant citation system.** density is high (5–25 per essay). mechanics:

- **anchor text is a natural phrase mid-sentence, never a title:** "the labels that [became ceilings](/prose/what-are-labels-anyway)" (*everything-changes*); "you [rejected the bad versions](/prose/what-can-i-change)" (*am-i-just-pretending*). the sentence reads identically with the link removed.
- **links target section anchors, not just essays:** "[guarantees everyone else uses](/prose/how-do-i-know-this-code-is-good)... You just got there [faster](#why-does-going-fast-look-wrong)" (*am-i-just-pretending*) — including same-page anchors.
- **the woven table of contents:** several essays' opening paragraph pre-links its own sections as prose: "People want to create but [don't](#why-do-people-not-do-things), weighed down by a [sadness](#why-are-people-sad)..." (*whats-actually-wrong*; same move in *what-do-we-keep-losing*, *why-is-software-hard*, *whats-the-purpose-of-life*, *this-site-is-manipulative*, *what-will-agi-actually-want*).
- **the word "but" is repeatedly a link to /prose/but:** "[But.](/prose/but)" (*its-not-that-simple*, *should-computers-have-rights*, *who-am-i* final line, *what-is-art*, *whats-the-actual-issue*). a single conjunction as a load-bearing citation.

**external links are rare and always load-bearing.** the full external inventory is roughly: wikipedia (left-pad, Chinese room, Turing test, AI effect, Goodhart's law, WarGames, great chain of being, Amazon deforestation), todepond's "just" page (linked twice, from *is-it-just-interpolation* and *why-is-software-hard*), rhi.zone, one github repo (SillyTavern), and the sourced stats in *why-are-we-afraid-of-ai* (ourworldindata ×2, pmc/ncbi, sagepub, newrootsinstitute).

- **numbers are linked at the number, inside the sentence:** "Factory farming processes [over 80 billion land animals per year](https://ourworldindata.org/...)"; "stocked at [30-35 kg per square meter](https://pmc.ncbi...)" (*why-are-we-afraid-of-ai*). the link is the citation; no author, no year, no "according to".
- **sources are almost never named in text.** exceptions are people-as-facts, not citations: "Esbuild - Evan Wallace, cofounder of Figma. Ghostty - Mitchell Hashimoto" (*where-is-all-the-good-software*); Aristotle/Kant name-drops in *why-are-we-afraid-of-ai*.
- **no quoted external material anywhere.** zero blockquotes in 53 essays. all quotation marks wrap invented specimen speech: "'I'm just being realistic.'" (*how-much-could-i-possibly-do*), "'aren't you just reinventing the wheel?'" (*why-do-i-reinvent-everything*).
- **unlinked factual claims exist and are stated with full confidence** — receipts in section 7 (this is a sag, not a pattern to admire).

**see-also footers are inconsistent** (also a section 7 item): `## See also` with glossed dashes ("- [what's actually wrong?](/prose/whats-actually-wrong) - why it's hard to start things"), vs `## Related` (*what-are-labels-anyway*), vs a bare `---` then list (*this-site-is-designed*), vs unglossed list (*why-is-perfectionism-a-trap*), vs nothing at all (*but*, *nothing-lasts*, *why-glue*, *when-should-you-stop-building*, ~15 others).

---

## 4. sentence mechanics

**openings.** two dominant modes:

1. **scene in second person, short declaratives:** "The output looks right. It passes every check. It matches the format." (*can-you-tell-when-its-wrong*); "Can't focus. Pick up the phone without deciding to." (*what-if-your-brain-isnt-broken*); "The feeling is familiar. The thing is almost done. Almost usable. Almost ready." (*when-should-you-stop-building*).
2. **flat thesis, sometimes one fragment:** "To be yourself." (*whats-the-purpose-of-life*); "No. Obviously not." (*should-computers-have-rights*); "The answer has always been yes." (*can-programs-write-programs*); "Yes. Probably. Let's do it anyway." (*why-do-i-reinvent-everything*).

**fragments are structural, not decorative.** they carry verdicts and pivots: "Not alone. Lonely." (*why-are-you-lonely*); "Deliberately." (*this-site-is-manipulative*); "No ruins. No rubble. No broken arches. Just 404s and dead repos." (*what-do-we-keep-losing*); "Fear is fine. Fear is normal." (*how-much-could-i-possibly-do*).

**rhythm.** the base unit is a run of 2–4 short sentences followed by one long one, or the inverse. *why-is-perfectionism-a-trap* is the outlier with genuinely long breath: "You put this out and it's bad and people see that you're bad — the work becomes a window and the window faces inward." most essays stay shorter-winded than that.

**the "but" discipline.** sentence-initial "But" is the corpus's main hinge, italicized when it's doing thematic work ("*But* I'll try."), often a paragraph opener, occasionally a whole paragraph, and thematized in *but.md*: "Everything before 'but' is preamble. Everything after is what the person actually means." *but.md* also states the corpus's own policy: "The essays on this site are full of 'buts.' That's not a weakness - it's kind of the whole idea. ... The tension stays unresolved."

**other load-bearing connectives:** sentence-initial "So" ("So you either undersell the work..."), "And" ("And it's shrinking faster than anyone is building frameworks"), "Because" as a full-sentence opener ("Because that's what the organizations building it optimize for." — *what-will-agi-actually-want*), "Which means" ("Which means AGI's goals are unlikely to be cosmic"). colon-free setups; the corpus prefers the dash: " - " in older-looking essays, " — " in newer ones (inconsistency noted in section 7).

**paragraph closers clinch.** the last sentence of a paragraph is routinely a short reframe or reversal: "The fingerprints are there. They're just not visible to anyone who wasn't in the room." (*am-i-just-pretending*); "Nobody chose blandness. The system selected for it." (*why-is-nothing-special-anymore*); "The ignorance is the feature." (*where-does-meaning-live*).

**questions as gears.** question then immediate minimal answer: "Did you?" (*am-i-just-pretending*); "Why?" (*why-glue*); "Where did they go?" (*why-did-things-stop-being-personal*). also the interrogative title answered in line one ("Nobody is bad at computers. Software is actually hard to use." — *why-is-software-hard*).

**endings.** three modes, no summaries ever: (a) outward question — "which mistake would you rather make?" (*should-computers*); (b) two-sentence koan — "The permission was never revoked. It just stopped being the default." (*why-did-things-stop-being-personal*); (c) turn on the reader — "You're still reading." (*this-site-is-manipulative*). *where-is-all-the-good-software* uniquely ends with a plea heading, "## Please?".

**lists.** bullets only, never numbers. two flavors: bare fragments ("- revenue / - efficiency / - stability" — *what-will-agi-actually-want*) and full-sentence bullets ("- You can just be in the room. At the meeting, at the event..." — *what-can-i-change*). bold lead-in bullets appear only in the technical essays ("**The type system** catches the most." — *how-do-i-know-this-code-is-good*).

---

## 5. heading logic, per essay

verified fresh from the files (not inherited notes). grouped where identical, but every essay is placed.

**question-ladder headings — the headings ARE the argument's spine, phrased as the reader's next objection.** each heading is also an addressable anchor other essays link into.
- *am-i-just-pretending*: "Why does going fast look wrong?" → "What if the bottleneck isn't the hand?" → "Is directing a craft?" → "So are you pretending?" — objections in escalating order; the last heading returns the title's question.
- *how-do-i-know-this-code-is-good*: "What actually catches bugs?" / "How does trust accumulate?" / "What's the question you're actually asking?" — practical then reflective.
- *can-you-tell-when-its-wrong*: mixes question headings with the assertion heading "You do this too" — the assertion is the turn where the essay stops being about AI.
- *whats-the-purpose-of-life*: headings are the dependency chain named in the intro ("Knowing yourself" → "Trying things" → "Failing" → "Do you have to be safe?").
- *who-am-i*: questions plus two ###-level subheads ("Watching what's already there" / "Doing things and seeing what happens") — the only essay using a third heading level, because it has an actual two-part method.
- *why-is-software-hard*: "Why can't you find anything?" then noun-phrases ("Complexity as strategy", "Who decides", "Time as a resource it spends") — questions for the reader's experience, noun-phrases for the diagnosis.
- *should-computers-have-rights*: "Why is the Chinese Room irrelevant?" / "Why is the Turing test quiet now?" — questions that presuppose the essay's verdicts.
- *why-do-you-have-to-install-things*: "What if you could just try?" / "Why does this feel impossible on most systems?".
- *why-cant-you-just-use-what-exists*: question headings until the paired case-split "When to use what exists" / "When to build anyway".
- *why-do-i-reinvent-everything*: "What if?" — a two-word heading that is the essay's whole engine; closes on "The question underneath".

**enacted structure — headings perform the thesis instead of labeling it.**
- *its-not-that-simple*: "It's not one-sided" → "It's not a binary" → "It's not a spectrum" → "It's multifaceted" → "Why are we compressing things?" — the ladder of the argument, ending by handing off to another essay's title.
- *this-site-is-designed*: flat inventory headings ("Layout", "Interaction", "Color", "Text", "The compromises") — a spec sheet, on purpose, for an essay claiming everything is a decision.
- *this-site-is-manipulative*: "The prose" / "The interaction design" / "The structure" / "Telling you this" / "So what?" / "You can't win" — moves from exhibit list to trap-closing.
- *but*: "The hinge" / "The other direction" / "Which way does yours point?" / "'But' as honesty" — noun-phrase, then it turns to the reader.

**assertion headings — declarative sentences that advance the claim.**
- *everything-changes*: "Almost nobody lives like this" / "Change isn't an event" / "Loss and growth are the same mechanism" / "Nothing on this site is final".
- *where-is-all-the-good-software*: "Teams don't solve this" / "Nobody builds this"-style flat verdicts, plus the outlier closer "## Please?".
- *what-do-we-keep-losing*: "Already vanished" / "Systems, not objects" / "Alignment we forgot" — clipped, elegiac; one question ("Why do games keep getting it right?").
- *nothing-lasts*: "The beautiful version" / "The ugly version" / "What you remember isn't what happened" / "The permission to let things die" / "Decay has a texture" / "Cycles, not lines" / "Holding lightly" — noun-phrase headings as movements in an essay that is structured like music rather than argument.
- *why-are-we-afraid-of-ai*: "The predator" / "The word" / "The environment" / "The self-ignorance" then the first-person "I'm not sure what to do with this" — definite-article noun phrases naming exhibits, ending in confession.
- *why-do-you-keep-fitting-in*: "Someone else's shape" / "Animals don't do this" / "How deep the machinery runs" / "Not a problem to solve" / "The part I can't picture".
- *what-would-it-actually-take*: "The garden and the lawn" / "Mixed-use" / "The floor" / "r/place" / "Cyberpunk got it backwards" — each heading an image, not a topic; most concrete heading set in the corpus.
- *where-does-connection-come-from*: "The bar stool" / "The byproduct problem" / "Egypt built pyramids" / "What the room needs" — image headings, one assertion.
- *when-should-you-stop-building*: "The construction site" / "Building feels safer" / "The visceral test" / "Two modes" / "So stop building?".
- *the-great-deceit*: only three headings ("What the process looks like" / "The discomfort has a few threads" / "Why this essay exists") — shortest essay, most reticent headings.
- *what-will-agi-actually-want*: "Objectives come from power" / "Continuation" — verdict headings; the argument is complete if you read only them.
- *there-used-to-be-two-kinds-of-programmer*: "The professional" / "The other one" / "The merge that didn't work" / "What got lost" / "Two tracks, not one".
- *why-glue*: "What glue actually does" / "Why nobody builds it" / "The proof is in the stack" / "The intelligence is in the glue" / "It could have been labeled anything".
- *why-did-things-stop-being-personal*: "The sophistication trap" / "The Tumblr paradox" / "The permission" / "Nostalgia for something you never had".
- *why-is-nothing-special-anymore*: "Something used to be different" / "The trust disappeared" / "Everything converged" / "Where the special things went".
- *is-it-just-interpolation*: "The technical claim" / "Does that settle it?" / "The work 'just' is doing" / "What if you apply it to yourself?" / "The threat underneath" — noun phrase and question alternating as concede/attack.
- *whats-the-actual-issue-with-generative-ai*: "The intent problem" / "The spectrum" / "Is this a new problem?" / "Where does the intent live?" / "What this doesn't mean" — the last heading is a pre-emptive de-escalation, unique in the corpus.
- *who-is-generative-ai*: "Function, not database" / "Is the average actually the average?" / "Where you point it" / "So who is it?".
- *where-does-meaning-live*: "The engine doesn't know" / "What happens when you bake it in" / "The gap" / "Where it lives" — the final heading answers the title in two words of body text.
- *why-is-everything-a-document*: "The paper metaphor" / "Objects and relationships" / "What's the bridge problem?" / "What if it wasn't a page?" / "The ratchet".
- *why-are-formats-so-hard*: "The format problem" / "The spec doesn't help" / "Code generation doesn't help either" / "Nobody builds this" / "What does it feel like to do the work?".
- *can-programs-write-programs*: "Structural vs stochastic" / "Layers of description" / "The fractal structure" / "The recursive dream" / "What does this mean for you?" — the only essay with an explicit reader-application heading.
- *why-do-i-build-tools*: "So what is it about?" / "What actually feels good?" / "Architect mode and inhabit mode" / "What's the whole point?" — questions asked of the self, not the reader.
- *are-we-building-toward-something*: "What does the honest inventory look like?" / "What do the dead projects say?" / "The pattern you can't see from inside" / "The uncomfortable middle".
- *why-is-change-scary*: "Where does the fear live?" / "What is it protecting?" / "The grief nobody mentions" / "Why is it loudest when you're closest?" / "The other side".
- *why-is-change-so-hard*: "Why doesn't knowing help?" / "The insight trap" / "Patterns that protect" / "What seems to work".
- *what-if-your-brain-isnt-broken*: "The environment" / "Is dopamine the villain?" / "The escape hatch" / "The reframe" / "The uncomfortable implication" / "What do you need?".
- *why-are-you-lonely*: "Nobody goes deep" / "Safe isn't the same as known" / "The gap that doesn't get talked about" / "What seems to help" / "So what now".
- *what-are-labels-anyway*: "Where do they come from?" / "Labels do things" / "Your own labels feel different" / "Holding loosely".
- *why-are-we-compressing-things*: "Compression is cognition" / "What gets lost" / "When is it lazy?" / "When is it harmful?" / "Can you tell?" / "The alternative".
- *how-much-could-i-possibly-do*: "Giving up sounds wise" / "Learned helplessness" / "What 'I can't' is really doing" / "But what if it would take years?" / "What does it cost?".
- *this-is-not-all*: "What's missing" / "It never will be" / "That's the point" / "What this means for you".
- *this-is-not-a-personal-website*: "What a personal website claims" / "What it isn't" / "One facet" / "So what is it?".
- *the-right-tool-for-the-job*: "When it's true" / "When it's not" / "What's being said" / "The myth of the right tool" / "The better question" / "Tools shape thinking".

**procedural headings — the advice essays.**
- *what-can-i-change*: "Get specific" / "Your relationship to it" / "Leverage points" / "Available moves" / "What if you don't have time for all this?" — imperative and diagnostic; the most workbook-like heading set.
- *how-do-i-do-things*: "What seems to help" / "What if you're just lost?" / "Try this" / "The only guaranteed failure" — the only "Try this" in the corpus.

**divergent case.**
- *why-is-perfectionism-a-trap*: Title Case throughout — heading ("What 'High Standards' Are Doing", "Identity Gets Involved", "Sideways", "Taste and Fear") AND frontmatter label ("Why Is Perfectionism a Trap?") — the sole essay violating the site-wide lowercase convention. its headings are also the most oblique in the corpus ("Sideways", "The Engine").

the overall logic: **headings are addressed to the reader's next thought.** question form when the reader would ask; assertion form when the reader would resist; image form when the essay is a walk rather than an argument. *this-site-is-designed* states the policy outright: "Section bodies are dimmed by default. The headers carry the argument."

---

## 6. what it never does (negative space)

verified absences across all 53:

- **no summary or restatement endings.** zero instances of "in conclusion", "ultimately", "at the end of the day", "to recap". essays end by opening outward, never by closing inward.
- **no throat-clearing openers.** no "in today's world", "we live in an age of", "much has been written about". the first sentence is always already inside the subject.
- **no numbered lists.** bullets only, everywhere.
- **no blockquotes and no quoted external prose.** all quotation marks wrap invented specimen speech.
- **no author names as authority.** nobody is cited to borrow credibility; the rare names (Turing, Torvalds, Wallace, Hashimoto) are facts in the story, not endorsements.
- **no exclamation marks in the authorial voice.** the only ones live inside quoted speech: "'AI is transforming everything!'" (*am-i-just-pretending*).
- **no emoji, no headings with colons ("X: why Y matters"), no "let's dive in", no "delve".**
- **no direct imperative to the reader as a default register.** imperatives are quarantined inside the two advice essays (*how-do-i-do-things*, *what-can-i-change*) and one deliberate plea ("Make good software." — *where-is-all-the-good-software*). elsewhere the corpus describes rather than instructs — even *whats-the-purpose-of-life* frames its closing list as "So what do you do? / Nothing dramatic."
- **no both-sidesing as a closer.** the corpus holds tension ("Honesty is holding both halves at the same time" — *but*) but never ends on "it depends on your perspective" without a position; even refusals to answer are positioned ("The observation is more uncomfortable than any of its conclusions." — *why-are-we-afraid-of-ai*).
- **no definitions as openings.** no essay begins "X is defined as" or "X, at its core, is". definitions arrive mid-argument, glossed in apposition.
- **no apology, no self-deprecation about the writing itself, no "this may be controversial but".**
- **almost no scene-setting anecdote openers** ("It was 2016 and i was..."). the closest is the cat on the porch (*why-do-you-keep-fitting-in*) — an image, not an anecdote, and it returns as the closer.
- **notably NOT absent (things a stricter spec might assume are banned):** "honestly" appears as a paragraph opener at least three times ("Honestly? It doesn't feel like enough." — *are-we-building-toward-something*; "Honestly, this framing might be too clean." — *can-you-tell-when-its-wrong*; "And honestly?" — *where-is-all-the-good-software*). "Imagine" as an opener appears once ("Imagine opening your note app" — *why-is-everything-a-document*). "It's worth noticing/watching/paying attention to" is a recurring family (*should-computers*, ×2 in one essay). the corpus is not clean of soft-hedge furniture — see next section.

---

## 7. the sag — where /prose/ reads as llm-median

this is the section that keeps the study from being scripture. the corpus has real, countable uniformity tells.

**(a) the hedge-verb monoculture.** "tends to / seems to / might" is applied corpus-wide, mechanically, including where it grades nothing and where the essay's own argument wants an assertion:

> "Something in the way we process speech seems to work this way." — *but*
> "Something in how we navigate the world seems to depend on models that stay put." — *everything-changes*

those two are nearly the same sentence — same agentless "Something in..." scaffold, same "seems to", two different essays. more: "The label tends to flatten more than it reveals" (*this-is-not-a-personal-website*), "Good games tend to be designed around what makes humans feel good" (*whats-actually-wrong*), "It tends not to work" (*where-is-all-the-good-software*), "The gap between understanding and doing seems to be physical" (*why-is-change-so-hard*), "AGI doesn't seem to invent a new moral universe" (*what-will-agi-actually-want*). read in bulk, this stops feeling like epistemic care and starts feeling like one system-level instruction ("soften assertions") executed uniformly. the essays that hedge least (*why-are-we-afraid-of-ai*, *why-is-perfectionism-a-trap*, *what-would-it-actually-take*) are the ones that read least generated.

**(b) the "X isn't Y. It's Z." template.** the corpus's most-reused sentence machine, often several per essay:

> "Art isn't a talent. Talent is a label..." (*what-is-art*) / "The self isn't architecture." (*who-am-i*) / "Compression is cognition." [inverted] (*why-are-we-compressing-things*) / "'I can't' isn't usually an assessment. It's more often a shield." (*how-much-could-i-possibly-do*) / "Connection might be a byproduct. Not a product." (*where-does-connection-come-from*) / "The app boundary was never conceptual. It was logistical." (*why-do-you-have-to-install-things*) / "dopamine isn't pleasure — it's anticipation" (*what-if-your-brain-isnt-broken*)

individually sharp; at corpus density it becomes a tic that makes unrelated essays sound like one voice stamping the same die.

**(c) the "that's not a flaw, that's the point" reversal, near-verbatim across essays:**

> "That's not a flaw. That's the whole point." — *where-does-meaning-live*
> "That's not a limitation. [That's the point.](/prose/this-is-not-all)" — *everything-changes*
> "That's not a bug in the design - it's [the whole point]" — *why-do-i-build-tools*
> "That's not a disclaimer — it's [the point](#thats-the-point)" — *this-is-not-all*
> "That's not an accident. it's the point." — *this-site-is-manipulative* (description frontmatter)

five essays, one move. a reader crossing the graph hits it repeatedly.

**(d) recycled material presented as fresh each time.** the same anecdotes and coinages recur without acknowledgment:

- the minecraft/games "you just join their world" riff appears in *what-do-we-keep-losing* ("you just join their world. You see what they're building"), *whats-actually-wrong* ("you just join their world and help directly"), *why-are-you-lonely* ("You just join someone's world and exist in it together"), *where-does-connection-come-from* ("You join someone's world and exist in it together").
- "slot machine psychology" verbatim in *whats-actually-wrong* and *what-if-your-brain-isnt-broken*.
- "local-first, network-capable" verbatim in *what-do-we-keep-losing* and *whats-actually-wrong*.
- "the couch is right here/there" in *whats-actually-wrong* and *whats-the-purpose-of-life*.
- HyperCard's death told in *what-do-we-keep-losing*, *why-do-i-reinvent-everything*, and *why-is-software-hard*.
- "the pile" / "embarrassingly small" / "lower the bar to the floor" shuttle between *how-do-i-do-things*, *why-is-perfectionism-a-trap*, *how-much-could-i-possibly-do*, *why-is-change-so-hard*.

some repetition is the graph design working (shared vocabulary). but verbatim phrase reuse without linkage reads as one generation context leaking across files, not as an author's returning obsession.

**(e) worldview funneling.** nearly every essay, whatever its topic, resolves into the same five attractors: labels/compression, perfectionism/defeatism, incentives/metrics, calcified paradigms, be-yourself. e.g. *the-right-tool-for-the-job* ends at compression; *why-is-everything-a-document* ends at the ratchet; *why-is-nothing-special-anymore* ends at intent; *should-computers-have-rights* routes through labels AND compression. *this-site-is-manipulative* admits the chain outright ("By the time you've read three or four, you're inside a worldview"). the admission is honest; the mechanical effect remains: arguments rhyme until essays become partially interchangeable, which is a median-model signature (every topic bent toward the same latent thesis).

**(f) decorative parallelism past the point of content.**

> "Writing has never been about typing. Cooking has never been about chopping. Design has never been about pushing pixels. Architecture has never been about laying bricks." — *am-i-just-pretending* (the fourth item adds nothing the second didn't)
> "A photograph is 'just' photons hitting a sensor. A symphony is 'just' air pressure variations. A conversation is 'just' vocal cord vibrations..." — *is-it-just-interpolation*
> "bureaucracy, but faster / markets, but smarter / extraction, but automated / abstraction, but scalable" — *what-will-agi-actually-want*

triads-and-quads whose last members are rhythm filler, the classic llm cadence of listing until the beat resolves.

**(g) unlinked confident statistics.** the corpus's citation discipline (section 3) breaks exactly where an llm would hallucinate:

> "In 2025, GPT-4.5 was identified as human 73% of the time in a controlled Turing test" — *should-computers-have-rights*, no link, in an essay that links wikipedia twice.
> "Visible tattoos reduce callback rates in banking by about 35%." — *why-do-you-keep-fitting-in*, no link.
> "The brain processes social disagreement the way it processes physical pain — same neural regions" — *why-do-you-keep-fitting-in*, no link.
> "Children begin monitoring and adjusting their behavior to match peers around age three or four." — same essay, no link.

*why-are-we-afraid-of-ai* shows the corpus knows how to source numbers; these essays didn't, and the unsourced ones are exactly the too-tidy factoids llms emit.

**(h) the performed-uncertainty tic.** the tier-2 "i don't know" move (section 2) is genuinely the corpus's best voice feature in small doses — and in the later-feeling essays it has itself become a stamp: *why-are-you-lonely* ("I'm not sure what to do with that"), *why-do-you-keep-fitting-in* ("I'm not sure what to do with that"), *why-are-we-afraid-of-ai* ("I'm not sure what to do with this" — as a heading), *who-am-i* ("I'm not sure what to do with that either"). four essays closing sections with the same sentence is humility as boilerplate. the honesty move, mechanized, is indistinguishable from the confidence move.

**(i) surface inconsistency tells (no single editing pass).**
- dash convention splits: " - " (*am-i-just-pretending*, *how-do-i-know*, *what-are-labels-anyway*, *where-does-meaning-live*...) vs " — " (*nothing-lasts*, *why-do-you-keep-fitting-in*, *what-would-it-actually-take*, *why-is-perfectionism-a-trap*...). two generations of essays, two typographic dialects, uncorrected.
- *why-is-perfectionism-a-trap* in Title Case against a lowercase site (label AND headings).
- see-also formats: four different conventions plus absence (section 3).
- *this-is-not-a-personal-website* claims "no 'I'" for a corpus that uses "I" in a dozen-plus essays.
- *everything-changes* links "#loss-is-change" from other files (*nothing-lasts*, *why-glue*) but its actual heading is "Loss and growth are the same mechanism" — dead anchors, suggesting essays were revised without sweeping inbound links.

**(j) listicle sag.** *what-can-i-change* is the weakest essay as prose — three bulleted inventories ("Some things people want to change:" — sixteen bullets), advice-blog cadence ("Simpler version:"), and none of the corpus's tension-holding. *how-do-i-do-things*' "Try this" section is the same register. these read like the median self-help post the rest of the corpus is written against; the corpus's own essay *whats-actually-wrong* even mocks the genre ("Easy answers don't have a 'but'" — *but.md*), which these two essays come closest to being.

**(k) the koan-closer quota.** nearly every essay ends on a two-beat aphorism: "The capability is the truth. The container is optional." (*install-things*) / "Someone meant it, and it shows." (*nothing-special*) / "It's already there." (*fitting-in*) / "Where it shows up." (*where-does-meaning-live*). when every essay lands the dismount the same way, the dismount stops landing. the endings that escape the pattern (*why-are-you-lonely*'s "Whether you actually will is a different question.", *nothing-lasts*' "I don't know either.") are conspicuously the strongest.

**where it does NOT sag** (for calibration): *why-are-we-afraid-of-ai* (sourced numbers, an argument that goes somewhere unpurchased, refuses its own conclusions), *why-is-perfectionism-a-trap* (long-breath syntax nothing else in the corpus attempts, "the window faces inward"), *what-would-it-actually-take* (concrete imagery: the college fund math, the mcmansion garage, contenteditable in IE 5.5), *nothing-lasts* (noun-phrase movements, the reconstructive-memory turn). these four diverge most from the house template — length of sentence, sourcing, or structure — and read the least median. the correlation runs one way: distinctiveness tracks deviation from the corpus's own dominant patterns.

---

*file locations: corpus at `/home/me/git/pteraworld/public/content/prose/`; this doc at `/tmp/claude-1000/-home-me-git-pteraworld/49f978c7-f6b5-4b22-be30-9e9fb5feaaf4/scratchpad/prose-corpus-study.md`. nothing in the repo was modified.*
