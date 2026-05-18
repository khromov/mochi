# Laws of UX — detailed reference

The deep companion to `SKILL.md`. Use this when:

- Applying a law to real code or markup and you need a concrete pattern.
- Spotting a problem and you need to know what the _anti-pattern_ of a given law looks like.
- Reviewing a UI by surface type (forms, dashboards, checkout, etc.) — see "Critique playbooks."
- Recognizing the most common ways these laws get misapplied — see "Common misapplications."
- Explaining a law's origin or primary research provenance.

Sourced from Jon Yablonski's _Laws of UX_ (https://lawsofux.com/), CC BY-NC-ND 4.0.

## Contents

1. [Group 1 — Visual perception & layout (Gestalt)](#group-1--visual-perception--layout-gestalt)
2. [Group 2 — Decision-making & cognitive cost](#group-2--decision-making--cognitive-cost)
3. [Group 3 — Memory, motivation & experience over time](#group-3--memory-motivation--experience-over-time)
4. [Group 4 — Behavior, expectation & robustness](#group-4--behavior-expectation--robustness)
5. [Group 5 — Time, motion & attention](#group-5--time-motion--attention)
6. [Critique playbooks by surface type](#critique-playbooks-by-surface-type)
7. [Common misapplications](#common-misapplications)
8. [How the laws relate](#how-the-laws-relate)
9. [Further reading](#further-reading)

For each law below, expect: **Claim · Origin · Application · Code/markup pattern · Anti-pattern · Watch out for · Related**.

---

## Group 1 — Visual perception & layout (Gestalt)

The Gestalt principles of grouping (Wertheimer, Köhler, Koffka, ~1910s) explain how the mind organizes raw visual stimuli into coherent objects and groups. Five categories: Proximity, Similarity, Continuity, Closure, and Connectedness — plus Prägnanz as the meta-principle.

### Law of Proximity

**Claim.** Objects near each other are perceived as grouped.

**Origin.** Gestalt principle, ~1910s. Spatial nearness is read as semantic relatedness.

**Application.** Form labels close to inputs. Section spacing larger than within-section spacing. Search results separated by visible gaps.

**Code/markup pattern.** Use a consistent gap scale (e.g., 4/8/16/32px tokens) and reserve the larger gaps for between-group separation.

```css
.section {
  padding-block: 32px;
}
.section + .section {
  border-top: 1px solid var(--divider);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
} /* label hugs input */
.field-group {
  display: flex;
  flex-direction: column;
  gap: 16px;
} /* fields breathe */
```

**Anti-pattern.** Equal spacing everywhere. When labels, inputs, helper text, and neighboring fields all sit at the same vertical rhythm, the eye can't tell which label belongs to which input. Forms feel mushy and people read them wrong.

**Watch out for.** Inconsistent spacing creates accidental groupings. A spacing audit (across components, not just within one) is one of the highest-leverage UX fixes.

**Related.** Law of Common Region, Law of Uniform Connectedness, Law of Similarity.

---

### Law of Similarity

**Claim.** Visually similar elements are perceived as belonging to the same group.

**Origin.** Gestalt grouping by visual attribute (color, shape, size, orientation, motion).

**Application.** All links look like links. All primary buttons look identical to each other and _unlike_ secondary buttons. Status pills carry semantic color (success/warn/error) consistently.

**Code/markup pattern.** Define a small set of variants in your design system and resist creating one-off styles.

```css
.btn-primary {
  background: var(--accent);
  color: white;
}
.btn-secondary {
  background: transparent;
  border: 1px solid var(--accent);
  color: var(--accent);
}
.btn-ghost {
  background: transparent;
  color: var(--accent);
}
/* Three variants. That's the budget. */
```

**Anti-pattern.** Style drift across pages — page A has a slightly differently-shaded primary button than page B. Same intent, different visual; users wonder if it's the same action. Also: making a non-interactive label look like a button (tinted background, rounded corners), or making a real button look like static text.

**Watch out for.** Hover/focus/disabled states must follow the same similarity rule. If `:hover` looks dramatically different across components, users can't predict what's interactive.

**Related.** Law of Proximity, Von Restorff Effect (Von Restorff is the _intentional break_ of similarity).

---

### Law of Common Region

**Claim.** Elements sharing a clearly defined region (border, background) are perceived as grouped.

**Origin.** Stephen Palmer (1992) extended Gestalt grouping principles. Common Region is a stronger grouping cue than Proximity or Similarity — a bordered group beats a closely-spaced ungrouped set.

**Application.** Cards. Sidebars. Panels. Modals. Bordered form sections.

**Code/markup pattern.**

```html
<!-- Card pattern: use a wrapping element with clear bounds -->
<article class="card">
  <header>...</header>
  <p>...</p>
  <footer>...</footer>
</article>

<!-- Form section grouping -->
<fieldset>
  <legend>Billing address</legend>
  <!-- inputs -->
</fieldset>
```

`<fieldset>` is genuinely underrated. It's the semantic web's built-in Common Region.

**Anti-pattern.** Bordering _everything_. When every element has its own border or shadow, common region fails — there's no longer a meaningful "this group vs. that group" signal. Also: nesting bordered cards inside bordered cards inside bordered sections.

**Watch out for.** Borders add visual weight. Pick the level of grouping that needs the strongest signal and use Proximity for finer-grained grouping inside it.

**Related.** Law of Proximity, Law of Uniform Connectedness.

---

### Law of Uniform Connectedness

**Claim.** Elements visually connected (lines, frames, color blocks) are perceived as more related than ungrouped elements — even more than proximity or similarity alone.

**Origin.** Gestalt extension. Visual connection via continuous form is the strongest grouping signal.

**Application.** Stepper / progress indicators with connecting lines. Breadcrumbs with `>` separators. Featured search results (Google's "featured snippet" border). Form sections with a colored accent line on the left edge.

**Code/markup pattern.**

```html
<!-- Stepper: line connects steps -->
<ol class="stepper">
  <li class="done">Account</li>
  <li class="current">Plan</li>
  <li>Payment</li>
  <li>Confirm</li>
</ol>
<style>
  .stepper {
    display: flex;
    gap: 0;
  }
  .stepper li {
    flex: 1;
    position: relative;
    padding: 0 16px;
  }
  .stepper li::after {
    content: '';
    position: absolute;
    right: 0;
    top: 50%;
    width: 100%;
    height: 2px;
    background: var(--line);
  }
  .stepper li:last-child::after {
    display: none;
  }
</style>
```

**Anti-pattern.** Implying connection where none exists — e.g., a horizontal line under a paragraph that visually links it to the next heading. Or stepper-style connectors between items that don't have a sequence relationship.

**Watch out for.** Use sparingly. Connecting lines add visual noise at scale.

**Related.** Law of Common Region, Law of Proximity.

---

### Law of Prägnanz

**Claim.** People perceive ambiguous or complex images as the simplest form possible — the interpretation requiring the least cognitive effort.

**Origin.** Max Wertheimer, 1910. Umbrella principle behind all Gestalt grouping — the mind defaults to the simplest organization.

**Application.** Layouts that read as a small number of clean rectangles. Simple iconography (faster to recognize than detailed). Negative space that lets shapes resolve.

**Code/markup pattern.** Composition over decoration. Aim for 3–6 visually distinct regions per screen, each internally simple.

**Anti-pattern.** "Busy" layouts that don't resolve into a clear structure: overlapping cards, gradients on every surface, multiple borders per region, decorative shapes intersecting content. Users can't articulate what's wrong but the page feels exhausting.

**Watch out for.** Decorative complexity can break Prägnanz silently — each decoration looks fine in isolation, but the cumulative cognitive load is real.

**Related.** All other Gestalt laws — Prägnanz is the parent.

---

### Von Restorff Effect (Isolation Effect)

**Claim.** When multiple similar objects are present, the one that differs is best remembered.

**Origin.** Hedwig von Restorff, 1933. List-recall experiments showed isolated items had higher recall than peers.

**Application.** One filled "primary" button per page. A featured pricing tier ("Most popular") that breaks visual rhythm. Notification badges, error states, "new" indicators.

**Code/markup pattern.**

```html
<div class="actions">
  <button class="btn-secondary">Cancel</button>
  <button class="btn-primary">Save changes</button>
  <!-- the only filled button -->
</div>

<!-- Pricing: one tier breaks the pattern -->
<div class="tiers">
  <div class="tier">Free</div>
  <div class="tier featured">
    <!-- elevated, accent-bordered, "Most popular" -->
    <span class="badge">Most popular</span>
    Pro
  </div>
  <div class="tier">Enterprise</div>
</div>
```

**Anti-pattern.** Multiple primary buttons on one page ("Save", "Continue", "Submit" all rendered as solid filled buttons). Or: highlighting _every_ "feature" on a marketing page until none of them stand out. If a designer has used a high-contrast accent color to highlight 8 things on a page, the user remembers 0.

**Watch out for.**

- Don't rely on color alone. Pair with shape, weight, or position. Color-only emphasis fails for users with color vision deficiency.
- Motion-based isolation (pulsing, blinking) needs `prefers-reduced-motion` respect.

**Related.** Selective Attention, Law of Similarity (this law is its inverse — intentional dissimilarity).

---

## Group 2 — Decision-making & cognitive cost

### Hick's Law

**Claim.** Decision time grows logarithmically with the number and complexity of choices.

**Origin.** William Hick & Ray Hyman, 1952. Reaction-time studies. Formula: `RT = a + b · log₂(n + 1)`.

**Application.** Google homepage (one input, one button). Apple TV remote (minimal buttons; complexity in the on-screen UI). Slack onboarding (one feature at a time via Slackbot).

**Code/markup pattern.** Progressive disclosure for advanced options.

```html
<form>
  <!-- Visible: 4 most common fields -->
  <input name="email" />
  <input name="password" />
  <input name="name" />
  <input name="company" />

  <details>
    <summary>Advanced options</summary>
    <!-- 12 more fields hidden until requested -->
  </details>
</form>
```

**Anti-pattern.** "Kitchen sink" navigation menus with 15+ top-level items, no grouping. Settings panels with 40 toggles on one screen. Pricing pages with 7 tiers and a feature comparison matrix that nobody reads.

**Common misapplication.** "Hick's Law says fewer choices is always better, so let's collapse all settings into a single 'Mode' dropdown." Wrong — you've moved the complexity, not removed it. The decision is now harder because each "mode" hides multiple decisions in one opaque label.

**Watch out for.** Don't over-simplify into ambiguity. "Get started" and "Continue" might be fewer choices but more decision time than two clearly-labeled actions.

**Related.** Choice Overload (emotional sibling), Cognitive Load, Tesler's Law.

---

### Choice Overload

**Claim.** People get overwhelmed when presented with a large number of options.

**Origin.** Coined by Alvin Toffler in _Future Shock_ (1970). Empirically supported by Iyengar & Lepper's "jam study" (2000): shoppers were 10× more likely to purchase when offered 6 jams vs. 24 — though later replications have nuanced this; the effect is real but context-dependent.

**Application.** 3-tier pricing pages with a "recommended" anchor. E-commerce filters. "Best for [use case]" recommendations.

**Code/markup pattern.** Surface a default; let the user expand if they need more.

```html
<!-- Show 3 plans by default, more on demand -->
<div class="plans">
  <Plan featured />
  <!-- recommended -->
  <Plan />
  <Plan />
</div>
<button>Compare all 7 plans →</button>
```

**Anti-pattern.** "Choose your plan" pages where all 9 plans are equally weighted. Long select dropdowns with no grouping or search. Onboarding that asks the user to pick from 30 templates before they understand what a template is.

**Distinct from Hick's Law.** Hick's is about decision _time_ (cognitive); Choice Overload is about decision _outcome_ (emotional, behavioral — regret, abandonment, lower satisfaction).

**Watch out for.** "Featured" / "Recommended" labels are powerful but require trust. If users feel manipulated by the recommendation, the anchor backfires.

**Related.** Hick's Law, Cognitive Load, Cognitive Bias (anchoring).

---

### Cognitive Load

**Claim.** The mental resources needed to understand and interact with the interface.

**Origin.** John Sweller, late 1980s, building on Miller's information theory. Three types: _intrinsic_ (task-inherent), _extraneous_ (added by design), _germane_ (effort that builds useful schemas).

**Application.** The interface has zero leverage on intrinsic load (filing taxes is hard). The leverage is all in cutting extraneous load.

**Code/markup pattern.** Inline help in context, not in a separate doc page.

```html
<label>
  Tax ID
  <abbr title="Your business tax identification number, e.g. EIN in the US, VAT number in EU">?</abbr>
</label>
<input name="tax_id" />
<small>Format auto-detected based on country</small>
```

**Anti-pattern.** Making users guess what a field expects. "Reference number" with no example. "Status" with cryptic codes. Modal dialogs that interrupt the task with information the user could have just _seen_ in the layout.

**Common misapplication.** "Reduce cognitive load" used to justify removing labels in favor of placeholder-only inputs. Worse: the placeholder disappears the moment the user starts typing, the label is gone, and the user has to delete what they wrote to remember what the field was for. Always keep persistent labels.

**Watch out for.** Animations can add extraneous load even when "delightful" — if a transition pauses the workflow for 400ms while the user waits to know what happened, it's tax.

**Related.** Working Memory, Miller's Law, Tesler's Law.

---

### Working Memory

**Claim.** A cognitive system that temporarily holds and manipulates information. Limited to ~4–7 chunks, decaying in 20–30 seconds.

**Origin.** Term coined by Miller, Galanter & Pribram in the 1960s. Refined by Atkinson & Shiffrin (1968) and Baddeley & Hitch (1974) into the multi-component model still standard today.

**Application.** Recognition over recall — show options rather than asking users to remember and type. Persistent context across screens. Visited-link styling.

**Code/markup pattern.** Carry context forward.

```html
<!-- Search: query stays visible above results -->
<header>
  Search results for <strong>"vintage typewriters"</strong>
  <span>· 24 results · filtered: under €200</span>
</header>

<!-- Pagination: show current state, not just numbers -->
<nav>Page 3 of 12 · 24 of 287 results</nav>

<!-- Form across steps: show what's been entered -->
<aside>
  <h3>Your selections</h3>
  <dl>
    <dt>Plan</dt>
    <dd>Pro</dd>
    <dt>Billing</dt>
    <dd>Annual</dd>
  </dl>
</aside>
```

**Anti-pattern.** Multi-step forms that "forget" what the user entered when they go back. Dashboards that lose your filter state on navigation. Search results pages where the query box is empty after submission. All of these force the user to hold information the system should be holding.

**Watch out for.** Visited-link styling has been quietly disappearing from modern web design (everything is `var(--link)`). It's an externalization of memory — bring it back.

**Related.** Miller's Law, Chunking, Cognitive Load.

---

### Miller's Law

**Claim.** The average person can hold ~7 (±2) items in working memory.

**Origin.** George Miller, 1956 paper _The Magical Number Seven, Plus or Minus Two_.

**The most-misused law in UX.** Miller's actual point was about _chunking_ and how short-term memory groups information. People comfortably remember a 10-digit phone number because it's chunked (3-3-4), not because their capacity is 10.

**Application.** Chunk content. Format phone/account numbers with separators.

**Code/markup pattern.**

```html
<!-- Phone number: chunk visually -->
<input type="tel" inputmode="tel" pattern="[0-9 ]+" placeholder="+46 70 123 45 67" />
```

**Common misapplication.** "Miller's Law says 7 ± 2, so this navigation can have at most 7 items." This is _not_ what Miller's Law says. Navigation length should be set by the task, not by an arbitrary memory limit. A long navigation that's well-grouped and searchable beats a short, ambiguous one.

**Anti-pattern.** Forcing artificially short menus to "respect Miller's Law" while smashing meaningful categories together under vague labels.

**Watch out for.** Don't cite Miller as a number-of-options rule. Cite Hick's Law if speed matters; cite Choice Overload if abandonment matters.

**Related.** Working Memory, Chunking. (See "Common misapplications" section for the full takedown.)

---

### Chunking

**Claim.** Breaking individual pieces of information into meaningful groups expands functional working-memory capacity.

**Origin.** Same Miller (1956) paper that introduced "7 ± 2." Chunking is _how_ the limit gets effectively bypassed.

**Application.** Long-form text broken into paragraphs with sub-headings. Multi-step forms with section labels. Numbers formatted with separators. Tables with grouped rows.

**Code/markup pattern.**

```html
<!-- Long form: section headers as visual chunks -->
<form>
  <section>
    <h2>Your details</h2>
    <!-- 4 fields -->
  </section>
  <section>
    <h2>Billing address</h2>
    <!-- 5 fields -->
  </section>
  <section>
    <h2>Payment</h2>
    <!-- 3 fields -->
  </section>
</form>

<!-- Card number: chunk on input -->
<input type="text" inputmode="numeric" pattern="[0-9 ]+" autocomplete="cc-number" placeholder="1234 5678 9012 3456" />
```

**Anti-pattern.** Visual chunking that splits a coherent idea. A "section break" mid-paragraph because the column was getting long. Card-number inputs that don't auto-format and force users to count digits to verify they got it right.

**Watch out for.** Visual chunks must match semantic chunks. Don't chunk by aesthetics if it splits a coherent idea.

**Related.** Miller's Law, Working Memory, Cognitive Load, Law of Proximity.

---

### Tesler's Law (Law of Conservation of Complexity)

**Claim.** For any system, there is a certain amount of complexity that cannot be reduced — only moved between the system and the user.

**Origin.** Larry Tesler at Xerox PARC, mid-1980s. "An engineer should spend an extra week reducing complexity rather than make millions of users spend an extra minute working around it."

**Application.** Smart defaults. Format detection (paste any phone format, system normalizes). Inline validation with concrete fixes. OAuth for signup (auth complexity moves to the provider).

**Code/markup pattern.**

```js
// Phone normalization: accept anything, store consistent format
function normalizePhone(input) {
  const digits = input.replace(/\D/g, '');
  // ... apply E.164 formatting on the server
  return digits;
}

// Date input: accept "tomorrow", "next mon", "12/3", ISO, etc.
// Don't make users learn your format.
```

**Anti-pattern.** "Use format MM/DD/YYYY" labels next to date fields that reject everything else. Address forms that demand exactly the format your geocoder wants. Phone fields that won't accept the spaces the user pasted from their contacts.

**The flip side.** Don't oversimplify. Tognazzini's corollary: when an app is simplified, users start attempting more complex tasks — complexity returns from the user side. Removing meaningful options doesn't reduce complexity, it just makes the product fail more cases.

**Common misapplication.** "Smart defaults" that silently make decisions the user can't see or override. The user types a date in a field, the system "helpfully" interprets it differently, and the user can't tell what happened. The complexity hasn't moved to the system — it's been hidden from the user.

**Related.** Occam's Razor, Postel's Law, Cognitive Load.

---

### Occam's Razor

**Claim.** Among competing options that work equally well, prefer the one with fewest assumptions / elements.

**Origin.** William of Ockham (c. 1287–1347). Originally a problem-solving principle, adapted to design as "prefer the simplest solution."

**Application.** Default to subtraction. Question every UI element: does it earn its place? Stop only when removing more breaks function.

**Code/markup pattern.** A workflow, not a snippet.

1. Build the working version.
2. Strip until it breaks.
3. Add back exactly what you removed last.

**Anti-pattern.** "Just one more chart" / "let's also add this filter" / "while we're here, add a tooltip." Feature creep dressed as user-friendliness. Each addition seems neutral; the cumulative cost is real.

**Distinct from Tesler's Law.** Occam: remove the _unnecessary_. Tesler: acknowledge the _irreducible_.

**Watch out for.** Minimalism aesthetics ≠ Occam's Razor. Hiding complexity behind a clean visual surface (cf. Tesler's flip side) is the opposite of what Occam recommends.

**Related.** Tesler's Law, Pareto Principle, Aesthetic-Usability Effect (in tension).

---

### Pareto Principle

**Claim.** ~80% of effects come from ~20% of causes.

**Origin.** Vilfredo Pareto, ~1896. Italian land ownership distribution. The pattern recurs in many distributions.

**Application.** Identify the 20% of features driving 80% of user value. Polish those mercilessly; defer the long tail.

**Code/markup pattern.** Analytics-driven IA decisions.

```js
// Use real usage data to drive what's surfaced
// Top-level nav: features used by >40% of users in last 30 days
// Secondary nav: features used by >5%
// Hidden behind menu/search: long tail
```

**Anti-pattern.** Optimizing the rare flow because it's the one _you_ find interesting. Or showing every feature equally because "users might need any of them" — they won't, you have data, use it.

**Watch out for.** The 20% you optimize for must match the 20% your _users_ care about, not the 20% you find easiest to ship. And: long-tail features still need to exist (they're the long tail, not the missing tail), they just shouldn't dominate.

**Related.** Occam's Razor, Hick's Law.

---

### Selective Attention

**Claim.** People filter their attention to a subset of stimuli, usually those related to their current goal.

**Origin.** Donald Broadbent's Filter Theory (1958). Refined by Treisman (1960) and Deutsch & Deutsch (1963). The "cocktail party effect" (Cherry, 1953) is the canonical demonstration.

**Application.** _Banner blindness_: users learned to ignore ad-shaped elements. Don't style legitimate content like ads. _Change blindness_: significant updates outside the focus area are missed. Anchor attention with motion, contrast, or in-context messaging when something important changes.

**Code/markup pattern.**

```html
<!-- After form submit: tell the user what changed, where they're looking -->
<form on:submit="{save}">
  <!-- fields -->
  <button>Save</button>
  {#if saved}
  <p role="status" aria-live="polite" class="success">✓ Saved. Your changes are live.</p>
  {/if}
</form>
```

The `aria-live="polite"` makes the change perceptible to assistive tech as well — addressing change blindness for screen reader users.

**Anti-pattern.** "Success" message in a faded green strip 200px above where the user is looking, with no anchor to attention. Or: critical errors in a global toast 3 seconds long that disappears before the user reads it.

**Watch out for.** Banner blindness extends beyond ads now. Sticky promotional bars, "newsletter signup" cards in the sidebar, "you might also like" carousels — all get filtered. If the content matters, get it out of the ad-zone visual treatment.

**Related.** Von Restorff Effect, Cognitive Load.

---

### Cognitive Bias

**Claim.** Systematic errors of thinking that influence perception and decision-making — often without our awareness.

**Origin.** Tversky & Kahneman, 1972. Their work catalogued dozens of biases (anchoring, availability, framing, loss aversion, default bias, confirmation bias, etc.) and earned Kahneman a Nobel Prize.

**Application.** Anchoring (first price seen sets reference). Loss aversion ("save $10" feels different from "$90 instead of $100"). Default bias (opt-in vs. opt-out shifts behavior dramatically). Social proof ("10,000 users joined this week").

**Code/markup pattern.**

```html
<!-- Anchor with a high-tier first -->
<div class="plans">
  <Plan name="Pro" price="49" featured />
  <!-- anchor -->
  <Plan name="Standard" price="19" />
  <Plan name="Free" price="0" />
</div>

<!-- Default bias: ethical defaults that protect users -->
<input type="checkbox" id="marketing" />
<!-- opt-in, not opt-out -->
<label for="marketing">Email me product updates (we won't sell your email)</label>
```

**Anti-pattern (and ethical warning).** _Dark patterns_ are biases weaponized against users:

- False scarcity ("only 2 left!" when stock is unlimited)
- Confirmshaming ("No thanks, I don't care about saving money")
- Pre-checked opt-ins for marketing emails
- Hidden costs revealed at checkout step 4
- "Recommended" plans that are recommended for the company's revenue, not the user

These work — that's the problem. Design that treats users with respect costs short-term conversions and pays back in trust, retention, and not getting written about in negative press.

**Watch out for.** Audit your own designs. If you'd be embarrassed to explain a UX decision in a deposition, fix it.

**Related.** Peak-End Rule (a memory bias), Serial Position Effect (a memory bias), Choice Overload (anchoring is the standard counter).

---

## Group 3 — Memory, motivation & experience over time

### Serial Position Effect

**Claim.** People best remember the first (primacy) and last (recency) items in a series.

**Origin.** Hermann Ebbinghaus, late 1800s. Recall accuracy plotted against position produces a U-shaped curve.

**Application.** Place primary brand action / home link first in nav; account / profile last. Lead long lists with the strongest, end with the next-strongest, bury weak items in the middle.

**Code/markup pattern.**

```html
<!-- Primary nav: anchored at start and end -->
<nav>
  <a href="/" class="brand">Acme</a>
  <!-- start: primacy -->
  <a href="/products">Products</a>
  <a href="/pricing">Pricing</a>
  <a href="/docs">Docs</a>
  <a href="/blog">Blog</a>
  <a href="/contact" class="cta">Get started</a>
  <!-- end: recency -->
</nav>
```

**Anti-pattern.** Bullet lists where the strongest selling point is in position 4 of 7. Long onboarding sequences where the most important screen is in the middle.

**Watch out for.** This is about list position, not emotional valence. Don't conflate with Peak-End Rule.

**Related.** Peak-End Rule, Cognitive Bias.

---

### Peak-End Rule

**Claim.** People judge an experience largely by how they felt at its peak and at its end, not the average.

**Origin.** Kahneman, Fredrickson, Schreiber & Redelmeier, 1993. The "cold-water" experiment: participants preferred a longer trial that ended slightly warmer over a shorter trial that ended at the cold peak.

**Application.** Invest in delight at peaks and ends. Fix the worst single moment in the flow first — _negative peaks dominate memory more than positive ones_.

**Code/markup pattern.** Success states deserve real design love.

```html
<!-- Don't: tiny green checkmark and silence -->
<div class="success">✓</div>

<!-- Do: celebrate the moment, anchor next steps -->
<div class="success-state">
  <Confetti />
  <h2>You're live!</h2>
  <p>Your store is at <a href="{url}">{url}</a></p>
  <p>Here's what to do next:</p>
  <ol>
    <li>Add your first product</li>
    <li>Set up shipping</li>
    <li>Share your link</li>
  </ol>
</div>
```

The Mailchimp send-confirmation high-five is the canonical example.

**Anti-pattern.** Ending a multi-step flow on "Submitted." with no acknowledgment, next step, or confirmation of what happens next. Users walk away unsure if anything actually happened, even when it did.

**Watch out for.** Peak doesn't mean "loudest moment." It means most _intense_ — and a frustrating peak (a hung loading state, a confusing error) leaves a stronger memory than any number of small delights.

**Related.** Serial Position Effect, Cognitive Bias, Goal-Gradient Effect.

---

### Goal-Gradient Effect

**Claim.** Motivation to approach a goal increases with proximity to it.

**Origin.** Clark Hull, 1932 (rats running faster as they approach food). Generalized in Kivetz, Urminsky & Zheng (2006), showing customer reward programs drive accelerated purchasing as users near a reward.

**Application.** Progress bars and step indicators. "Endowed progress" — pre-fill some progress to bootstrap motivation.

**Code/markup pattern.**

```html
<!-- Endowed progress: start the user above zero -->
<div class="profile-progress">
  <progress value="2" max="5"></progress>
  <p>2 of 5 complete · You're 40% there</p>
  <ul>
    <li class="done">✓ Email confirmed</li>
    <li class="done">✓ Display name set</li>
    <li>Add a profile photo</li>
    <li>Connect a payment method</li>
    <li>Invite a teammate</li>
  </ul>
</div>
```

The "✓ Email confirmed" is the endowed-progress trick. Without it, the user starts at 0/3 and feels further from done.

**Anti-pattern.** Progress bars that lie or jump erratically. A 5-step form that shows "Step 1 of 5" then jumps to "Step 4 of 5" because step 2 and 3 were "skipped" — users feel deceived.

**Watch out for.** When you fake progress to motivate, eventually the user notices. Be honest about what's progress and what's setup.

**Related.** Zeigarnik Effect, Flow.

---

### Zeigarnik Effect

**Claim.** People remember uncompleted or interrupted tasks better than completed ones.

**Origin.** Bluma Zeigarnik, 1920s. Observed waiters could remember outstanding orders but forgot them once paid.

**Application.** "Draft saved" / "1 unread" / "complete your profile" — open loops invite return. Visual incompleteness (faded edges, "show more," scroll cues) draws the eye.

**Code/markup pattern.**

```html
<!-- "Show more" with hint of additional content -->
<article class="excerpt">
  <p>{first200words}</p>
  <p class="fade">{nextSentence}</p>
  <!-- visually fading -->
  <button>Read more →</button>
</article>
```

**Anti-pattern (and ethical warning).** Manufactured open loops to drive engagement: "You have 3 things to finish!" badges that never go to zero because the app keeps inventing new things. Notification badges that increment for any reason, even ones the user doesn't care about. Read receipts that pressure response. Streak counts that punish breaks.

**Common misapplication.** Conflating "engagement" with "user benefit." High Zeigarnik tension drives session counts but corrodes long-term trust and contributes to anxiety. Apps that survive the "delete-and-not-reinstall" test usually use this effect sparingly.

**Watch out for.** The line between "useful reminder" and "weaponized incompleteness." Apps in the latter category are increasingly resented and called out.

**Related.** Goal-Gradient Effect, Flow, Cognitive Bias.

---

### Flow

**Claim.** A mental state of full immersion, characterized by energized focus and total engagement.

**Origin.** Mihály Csíkszentmihályi, 1975. Flow occurs when challenge matches skill — too easy → boredom; too hard → anxiety.

**Application.** Match interaction tempo to user skill (beginner mode vs. power-user shortcuts). Remove friction that breaks tempo. Provide feedback for every action.

**Code/markup pattern.**

```html
<!-- Power-user shortcuts surfaced inline -->
<header>
  <input placeholder="Search..." />
  <kbd>⌘K</kbd>
</header>

<!-- Action with immediate feedback -->
<button on:click="{save}">{#if saving}<Spinner />{:else if saved}✓ Saved{:else}Save{/if}</button>
```

**Anti-pattern.** Modal dialogs for non-urgent things ("Did you know about our new feature?" interrupting an active task). Layout shifts mid-interaction. Every action requiring a confirmation dialog "just to be safe."

**Watch out for.** Pre-fetch likely next actions so the user doesn't pause for system responses. Silence is a flow killer; spinners are tolerable; layout-shifting jumps are unacceptable.

**Related.** Doherty Threshold, Goal-Gradient Effect, Cognitive Load.

---

### Aesthetic-Usability Effect

**Claim.** Users perceive aesthetically pleasing designs as more usable.

**Origin.** Kurosu & Kashimura at Hitachi, 1995. ATM-UI study showed perceived ease-of-use correlated more strongly with aesthetic appeal than with _actual_ ease-of-use.

**Application.** Polish multiplies. Beautiful UIs get the benefit of the doubt on minor friction.

**Code/markup pattern.** Invest in: typographic hierarchy, consistent spacing, intentional color, smooth (not flashy) micro-interactions, content-aware empty states.

**Anti-pattern.** Using aesthetics as a _substitute_ for usability work. A beautiful but broken checkout flow gets higher satisfaction scores than a plain but functional one — until users actually need to recover from an error, at which point the aesthetics buy nothing.

**Common misapplication.** "We tested it and users love the design" — but they didn't actually try the difficult flows, or they reported satisfaction without completing the task. Aesthetic-Usability _masks_ usability problems in research. Track behavior (task success, time, error rate), not just satisfaction.

**Watch out for.** Don't treat aesthetics as window dressing — but also don't let polish become a justification for shipping problems.

**Related.** Occam's Razor (in tension), Peak-End Rule.

---

### Paradox of the Active User

**Claim.** Users never read manuals; they start using software immediately.

**Origin.** Mary Beth Rosson and John Carroll, 1987. New users would charge into the software, hit errors, and figure it out — manuals went unread.

**Application.** Tooltips, inline hints, contextual help beat a separate docs section. Onboard _through use_: Slack's Slackbot tutorial, Notion's empty-state prompts, Figma's interactive tutorial.

**Code/markup pattern.**

```html
<!-- Empty state: invitation to act, not a wall of text -->
<div class="empty">
  <Illustration />
  <h3>No projects yet</h3>
  <p>Create your first project to get started.</p>
  <button>+ New project</button>
  <a href="/docs">Or read the docs</a>
  <!-- secondary, for the rare manual-reader -->
</div>
```

**Anti-pattern.** Multi-screen onboarding walkthroughs that the user dismisses, then discovers they don't know how anything works. Documentation sites that exist but require finding the right page for a specific question. "Watch this 8-minute video tutorial" before letting users do anything.

**Watch out for.** Provide guidance _where and when_ the user encounters the question, not before. Even better: design so the question doesn't arise.

**Related.** Mental Model, Jakob's Law.

---

## Group 4 — Behavior, expectation & robustness

### Jakob's Law

**Claim.** Users spend most of their time on _other_ sites; they expect yours to work the same.

**Origin.** Jakob Nielsen (NN/g co-founder).

**Application.** Logo top-left links home. Cart icon top-right. Hamburger for mobile nav. Form-control conventions match physical analogs. Mobile: respect platform conventions (iOS swipe-back, Android back button).

**Code/markup pattern.**

```html
<!-- Standard layout users already know -->
<header>
  <a href="/" class="brand">...</a>
  <!-- top-left -->
  <nav>...</nav>
  <button class="cart">🛒 (3)</button>
  <!-- top-right -->
</header>
```

**Anti-pattern.** "Innovative" custom dropdowns that don't behave like native `<select>` (no keyboard nav, no type-to-search, broken accessibility). Reinventing the date picker. Cart in the bottom-left. Logo not linking home.

**Common misapplication.** "Jakob's Law says we should look like everyone else." No — Jakob's Law says _function_ should match expectations. Visual distinctiveness is fine. The argument against custom date pickers isn't that they look weird; it's that they don't work the way users expect (keyboard input, locale formatting, "tomorrow" shortcut).

**When to break the convention.** When you have evidence that users will benefit and you've designed a transition. YouTube's 2017 redesign let users opt in, preview, give feedback, and revert — that's Jakob's Law applied to _changing_ conventions.

**Watch out for.** Mobile platform conventions matter more than web ones for native-feeling apps. iOS users expect swipe-from-left to go back; Android users have a back button. PWAs and mobile web should respect both as much as feasible.

**Related.** Mental Model, Postel's Law.

---

### Mental Model

**Claim.** A compressed model of how a system works, based on what users think they know — applied to new situations where the system seems similar.

**Origin.** Kenneth Craik, _The Nature of Explanation_ (1943).

**Application.** Match your structure to existing models in the user's domain. E-commerce → catalog → cart → checkout works because it matches expectation. When no shared model exists, build one through clear naming, visible structure, consistent feedback.

**Code/markup pattern.** Naming is the entire game.

```html
<!-- Bad: invented terminology -->
<nav>
  <a href="/units">Units</a>
  <!-- what's a "unit"? -->
  <a href="/streams">Streams</a>
  <a href="/clusters">Clusters</a>
</nav>

<!-- Good: domain language users already have -->
<nav>
  <a href="/projects">Projects</a>
  <a href="/messages">Messages</a>
  <a href="/teams">Teams</a>
</nav>
```

**Anti-pattern.** Inventing internal jargon and exposing it to users. Every "Unit," "Object," "Asset," or "Resource" in a nav is a sign that engineers named it and product didn't push back. Users don't have a mental model for "Asset"; they do for "Photo," "Document," "File."

**Methods to bridge the gap.** User interviews, personas, journey maps, empathy maps, card sorting, tree testing. The biggest gap in design is between the designer's mental model and the user's. Test, don't guess.

**Watch out for.** Mental models update slowly. If your domain genuinely needs new terms, introduce them gently, define them in context, and don't punish users who fall back on familiar ones.

**Related.** Jakob's Law, Paradox of the Active User.

---

### Postel's Law (Robustness Principle)

**Claim.** Be liberal in what you accept, conservative in what you send.

**Origin.** Jon Postel, 1980, as a TCP design principle. Applied to UX: accept whatever input the user provides; produce strict, predictable output.

**Application.** Phone numbers, dates, addresses, currencies, names with diacritics, leading/trailing whitespace, mixed-case email — be tolerant. Validation feedback inline, near the field, with concrete fix instructions.

**Code/markup pattern.**

```js
// Accept anything reasonable, normalize on submit
function normalizeEmail(input) {
  return input.trim().toLowerCase();
}

function normalizePhone(input) {
  // Accept "(415) 555-1234", "+1.415.555.1234", "4155551234"
  const digits = input.replace(/\D/g, '');
  return digits;
}

// Validation feedback: specific, actionable
function validatePassword(pw) {
  if (pw.length < 8) return 'Password must be at least 8 characters';
  if (!/[0-9]/.test(pw)) return 'Add a number to your password';
  if (!/[A-Z]/.test(pw)) return 'Add an uppercase letter';
  return null;
}
```

**Anti-pattern.** Rejecting input as "invalid" with no explanation. Date fields that demand exactly MM/DD/YYYY. Email fields that reject `+` aliasing. Name fields that reject diacritics, apostrophes, or hyphens.

**Common misapplication.** "Postel's Law means we should accept everything." No — accept variation, but standardize before storage. Don't store one user's phone as `4155551234` and another's as `(415) 555-1234`. Normalize on the way in; render in the user's preferred format on the way out.

**Watch out for.** Robust UIs anticipate weirdness; brittle ones reject it. Names like "X Æ A-12," addresses without ZIP codes, dates before 1900, phone numbers from countries you didn't anticipate — your form will hit all of these.

**Related.** Tesler's Law (the system absorbing complexity), Mental Model.

---

## Group 5 — Time, motion & attention

### Fitts's Law

**Claim.** The time to acquire a target is a function of the distance to and size of the target.

**Origin.** Paul Fitts, 1954. Mathematical relationship: `T = a + b · log₂(D/W + 1)`. Larger and closer = faster to hit.

**Application.** Touch targets ≥44pt iOS / 48dp Android; desktop ≥24px (generous is better). Place primary actions where the cursor/thumb already is (mobile: bottom of screen for primary; not top). Keep destructive actions far from common-use targets.

**Code/markup pattern.**

```css
/* Hit area can be larger than visual area */
.icon-btn {
  width: 24px; /* visual */
  height: 24px;
  padding: 12px; /* total clickable: 48×48 */
}

/* Mobile: primary action at bottom for thumb reach */
.bottom-bar {
  position: fixed;
  bottom: 0;
  width: 100%;
  /* primary action lives here */
}
```

**Anti-pattern.** "Delete" right next to "Save," same size, same style — the only differentiator is the label. Tiny close buttons (10×10 px) on mobile modals. Primary CTAs at the top of long mobile pages requiring scroll-up.

**Common misapplication.** "Make all buttons huge." Fitts's Law is about _target size relative to importance and proximity to current cursor/thumb position_. Inflating every button reduces hierarchy and makes the page exhausting. Apply Fitts's where it matters (primary action, frequent actions, error-prone ones), not everywhere.

**Watch out for.**

- Edge and corner targets are effectively infinite-size on desktop — useful for OS-level UI, less for in-app.
- Pie/radial menus benefit but are rare on web.
- Mobile thumb reach varies by hand size and device size — bottom-corner targets favor right-handed users with large hands; consider center-bottom for primary.

**Related.** Doherty Threshold, Parkinson's Law.

---

### Doherty Threshold

**Claim.** Productivity climbs sharply when system response is under ~400ms.

**Origin.** Walter Doherty & Ahrvind Thadani, 1982 IBM research paper. Reset the bar from 2 seconds (the prior standard) to 400ms.

**Application.** Optimistic UI. Skeleton screens > spinners. For unavoidable waits, animate purposefully. Progress bars make waits tolerable even when imprecise.

**Code/markup pattern.**

```js
// Optimistic UI: update locally, reconcile with server
async function toggleLike(post) {
  post.liked = !post.liked; // immediate UI update
  post.likeCount += post.liked ? 1 : -1;
  try {
    await api.toggleLike(post.id);
  } catch {
    // roll back on failure
    post.liked = !post.liked;
    post.likeCount += post.liked ? 1 : -1;
    showToast("Couldn't update — try again");
  }
}
```

```html
<!-- Skeleton screen during load -->
{#if loading}
<div class="skeleton">
  <div class="skeleton-line" style="width: 80%"></div>
  <div class="skeleton-line" style="width: 60%"></div>
  <div class="skeleton-line" style="width: 90%"></div>
</div>
{:else}
<!-- real content -->
{/if}
```

**Anti-pattern.** Generic spinners with no indication of what's loading or how long it'll take. Layout that shifts dramatically when content arrives. Loading states that look identical to error states.

**Counterintuitive.** Artificial delay sometimes _increases_ trust ("we found 17 perfect matches for you" with a 2-second pause). Use carefully and only when the work feels real. Gratuitous fake-loading erodes trust the moment users notice.

**Watch out for.** Progress bars don't have to be perfectly accurate (Myers, 1985) — even rough estimates help. But a progress bar that hits 99% and sits there for 30 seconds is worse than one that smoothly underestimates.

**Related.** Flow, Parkinson's Law, Fitts's Law.

---

### Parkinson's Law

**Claim.** Any task expands until all the available time is spent.

**Origin.** C. Northcote Parkinson, _The Economist_, 1955. Originally a humorous observation about bureaucracy.

**Application.** Compress visible task length: autofill, smart defaults, paste-detection, saved addresses, address auto-complete.

**Code/markup pattern.**

```html
<!-- Use HTML autocomplete attributes — they're underused -->
<input autocomplete="given-name" />
<input autocomplete="family-name" />
<input autocomplete="email" />
<input autocomplete="tel" />
<input autocomplete="street-address" />
<input autocomplete="postal-code" />
<input autocomplete="cc-number" />
<input autocomplete="one-time-code" />
<!-- iOS pulls SMS codes -->
```

**Anti-pattern.** "Trust-building" friction: long forms full of optional fields, multi-step processes that could be one step, "are you sure?" confirmations on reversible actions. None of these build trust; they suggest the company doesn't respect the user's time.

**Watch out for.** The _perception_ of speed matters as much as actual speed. A 3-step form that _feels_ fast (smart defaults, instant transitions, persistent context) beats a 1-step form that's confusingly dense.

**Related.** Doherty Threshold, Fitts's Law, Tesler's Law.

---

## Critique playbooks by surface type

These are systematic checklists for reviewing common UI surfaces. Use them when the user shares a screenshot, mockup, or component for review. Walk through the relevant law in order — don't list all of them, but use the playbook to make sure you didn't miss something.

### Form review

For sign-up forms, settings, checkout fields, profile edits, contact forms.

1. **Postel's Law** — Does each field accept the formats users will actually paste in? (Phone with parens, dates as "tomorrow," names with hyphens.)
2. **Fitts's Law** — Is the submit button generous enough? On mobile, is it within thumb reach?
3. **Working Memory** — Does the user have to remember anything they entered earlier? If they navigate away and back, is state preserved?
4. **Hick's Law / Tesler's Law** — Are there optional fields that should default to sensible values? Could "advanced options" be progressively disclosed?
5. **Chunking** — If the form has more than ~6 fields, are they grouped into meaningful sections?
6. **Law of Proximity** — Do labels sit clearly close to their inputs? Is there enough space _between_ groups to differentiate?
7. **Doherty Threshold** — Does validation feel instant? Is there inline feedback as users type?
8. **Parkinson's Law** — Are HTML `autocomplete` attributes set on every relevant field?
9. **Goal-Gradient** — For multi-step forms, is progress visible?
10. **Peak-End Rule** — Does success have a moment? Or does it just say "Submitted."?

### Dashboard review

For analytics, monitoring, admin panels, data overviews.

1. **Pareto Principle** — Do the most-used metrics dominate the screen? Or is everything equally weighted?
2. **Cognitive Load** — How many things compete for attention? Can a user identify "the thing I came here for" in under 2 seconds?
3. **Selective Attention** — Where is the focal point? Is there exactly one?
4. **Law of Common Region** — Are related metrics visually grouped? Are panels clearly bounded?
5. **Working Memory** — When users drill into a panel, is the context (filter, date range) carried forward?
6. **Von Restorff Effect** — Are anomalies / alerts visually distinct from normal-state metrics?
7. **Chunking** — Are dense data tables broken into meaningful row groups?
8. **Aesthetic-Usability** — Does it look like a tool people respect? Or like a debug screen?

### Checkout / multi-step flow review

For payment, signup wizards, onboarding sequences, application forms.

1. **Goal-Gradient Effect** — Is progress visible at every step? Endowed progress at the start?
2. **Working Memory** — Is data the user already entered visible / editable on the review step?
3. **Hick's Law** — At each decision point, is there a sensible default or recommendation?
4. **Postel's Law** — Will the form recover gracefully if the user makes a typo?
5. **Doherty Threshold** — Are step transitions instant? No 3-second loading between steps?
6. **Parkinson's Law** — Autofill on every field that supports it?
7. **Peak-End Rule** — Does the final "you're done!" screen do the celebration justice?
8. **Cognitive Bias** — Are any costs hidden until late in the flow? Be honest.
9. **Trust signals** — Security badges where they aid trust, but not in a way that signals "we're nervous."

### Navigation / IA review

For top nav, sidebars, mobile menus, app structure.

1. **Jakob's Law** — Does it match conventions? Logo top-left links home. Cart top-right. Profile far right.
2. **Mental Model** — Are the labels in the user's vocabulary, or your engineering team's?
3. **Serial Position Effect** — Are the most important items first and last in nav order?
4. **Hick's Law** — Is the top-level nav scoped to genuinely top-level destinations? Or is it bloated with secondary stuff?
5. **Law of Similarity** — Do all nav items look like nav items? Are interactive states (hover, active) consistent?
6. **Mobile** — Is the menu accessible via standard hamburger? Does back-navigation work as platform-natively as feasible?

### Empty/error/success state review

For zero-data screens, validation errors, post-action confirmations.

1. **Peak-End Rule** — Success is a peak-end moment. Treat it like one.
2. **Postel's Law** — Errors with concrete, actionable fixes — not "Invalid input."
3. **Paradox of the Active User** — Empty states are an onboarding opportunity. Invite action; don't lecture.
4. **Selective Attention** — Errors must be visible at the point of failure, not in a global toast that disappears.
5. **Aesthetic-Usability** — These are the most often-ignored screens; investing in them pays disproportionate trust dividends.

### Marketing / landing page review

For homepage, product pages, conversion-focused content.

1. **Aesthetic-Usability Effect** — First impressions disproportionately drive perception. Polish matters.
2. **Selective Attention** — One focal CTA. Above-the-fold has one job: make the user want to keep going.
3. **Serial Position Effect** — Strongest argument first; second-strongest at the bottom; supporting evidence in the middle.
4. **Peak-End Rule** — The bottom of the page is a peak position. Don't just put a footer there — give them one more reason and one clear action.
5. **Cognitive Load** — Don't try to explain everything. Marketing pages exist to win the _next_ click, not the entire deal.
6. **Cognitive Bias** — Social proof, anchoring, framing — all relevant. Use them honestly.

### List / feed / search results review

For e-commerce listings, search results, social feeds, notifications.

1. **Law of Proximity** — Each list item is a clear unit; spacing between items > spacing within.
2. **Law of Similarity** — All items follow the same template; deviations signal something special (sponsored, featured, urgent).
3. **Chunking** — For long lists, group by date / category / relevance.
4. **Working Memory** — Filters and search query stay visible. "Load more" preserves position; pagination preserves filters.
5. **Doherty Threshold** — Pagination/load-more should feel instant. Skeleton loaders, not spinners.
6. **Selective Attention** — Sponsored content clearly distinct from organic; don't dress real content like ads (banner blindness).
7. **Goal-Gradient Effect** — Show "X of Y results" so users know how much further they have.

---

## Common misapplications

Cross-cutting failures where these laws get cargo-culted into bad design.

### "Miller's Law says menus should have ≤7 items"

**It doesn't.** Miller's 1956 paper was about working-memory capacity for _unrelated_ items, and the actual lesson was about chunking, not list length. Navigation, lists, and menus should be the length the task demands. A 30-item menu that's well-grouped, searchable, and has clear labels works fine; a 5-item menu with vague labels is worse.

### "Hick's Law means always reduce options"

**Not exactly.** Hick's Law says decision _time_ grows with options. If decision time is the bottleneck (entry points to the app, primary CTAs), reduce. If users are happy spending time choosing (a restaurant menu, a settings page they enter intentionally), more options can be fine. And: collapsing 5 visible options into 1 dropdown of 5 doesn't reduce options — it just hides them.

### "Jakob's Law means we should look like everyone else"

**Function, not appearance.** Jakob's Law says behavior should match expectation — keyboard nav, click patterns, layout positioning, mental-model conventions. Visual distinctiveness is fine and often desirable. The mistake is breaking _behavioral_ conventions to be visually different (custom dropdowns that lose keyboard nav, custom date pickers that don't accept typed dates).

### "Aesthetic-Usability Effect justifies skipping usability work"

**It does not.** Aesthetic-Usability is a memory effect — beautiful UIs feel more usable, especially in surveys and short tests. It _masks_ problems but doesn't solve them. When users actually need to recover from an error, perform a difficult task, or work under time pressure, the underlying usability is what carries the experience.

### "Doherty Threshold means we need every interaction under 400ms"

**Aim for it, but don't optimize at all costs.** 400ms is the threshold beyond which productivity degrades sharply, but the _perception_ of speed matters as much as actual time. Skeleton screens, optimistic UI, progress indicators, and informative loading messages can make a 1-second wait feel faster than a 400ms blank screen.

### "We applied Tesler's Law by hiding the complexity"

**Hiding ≠ moving.** Tesler's Law says complexity has to live somewhere — and "somewhere" doesn't include "hidden from the user with no escape hatch." Smart defaults are great when the default is obviously right or the user can see and override it. Smart defaults that silently make wrong decisions push complexity onto the user _and_ erode trust.

### "Goal-Gradient and Zeigarnik mean engagement metrics are good"

**Engagement is not user benefit.** These laws describe psychological mechanisms that work — and have been weaponized by streak-and-badge apps that drive engagement at the cost of user wellbeing. The honest test: would the user feel respected if they saw a behind-the-scenes documentation of how these features were designed? Build for users you'd be proud to design for, not for engagement spreadsheets.

### "Cognitive Load is high, so we hid all the options"

**You moved the load to navigation.** A clean-looking page where every action requires three clicks to reach has _higher_ cognitive load than a denser page where everything's visible. The goal isn't visual minimalism; it's task minimalism — make the _most common path_ clean, not the entire UI.

### "We followed all the Gestalt laws and it still feels off"

**Probably Prägnanz.** The individual Gestalt laws compete and reinforce each other. A layout can satisfy Proximity, Similarity, and Common Region individually while the overall composition still doesn't resolve into a clean structure. When in doubt, step back, squint, and ask: what does this read as? If it doesn't resolve into a small number of clear shapes/regions, simplify.

---

## How the laws relate

Several laws are siblings or specializations. The relationships worth knowing:

- **Hick's Law ↔ Choice Overload** — Same direction, different lens. Hick's emphasizes decision _speed_ (cognitive); Choice Overload emphasizes _outcome_ (emotional, behavioral).
- **Miller's Law ↔ Working Memory ↔ Chunking** — Miller is one (often misused) data point; Working Memory is the system; Chunking is the workaround that effectively expands functional capacity.
- **Tesler's Law ↔ Occam's Razor** — Complementary. Occam: "remove the unnecessary." Tesler: "the necessary doesn't disappear, it moves."
- **Goal-Gradient Effect ↔ Zeigarnik Effect** — Both about motivation through progress. Goal-Gradient: "approaching the finish line speeds you up." Zeigarnik: "incompleteness pulls you back."
- **Peak-End Rule ↔ Serial Position Effect** — Both about ends. Serial Position is about list-position memory; Peak-End is about _emotional_ judgment of an experience over time.
- **Von Restorff Effect ↔ Selective Attention** — Both about what gets noticed. Selective Attention is the filter; Von Restorff is the trick to bypass it.
- **All Gestalt laws (Proximity, Similarity, Common Region, Uniform Connectedness)** are children of **Prägnanz** — the meta-principle that the mind organizes scenes into the simplest possible interpretation.
- **Cognitive Bias** is a parent category that includes Peak-End Rule, Serial Position Effect, anchoring (related to Choice Overload), and many of the mechanisms behind Cognitive Load.

The hierarchy roughly:

```
Prägnanz (parent)
├── Proximity
├── Similarity
├── Common Region
└── Uniform Connectedness

Working Memory (parent)
├── Miller's Law (one data point)
└── Chunking (the workaround)

Cognitive Bias (parent)
├── Peak-End Rule
├── Serial Position Effect
├── Anchoring (manifests in pricing, Choice Overload)
└── Default bias, framing, loss aversion (general)

Cognitive Load (parent of practical decision laws)
├── Hick's Law (speed)
├── Choice Overload (emotion)
├── Tesler's Law (irreducibility)
├── Occam's Razor (subtraction)
└── Pareto Principle (focus)
```

---

## Further reading

The original Laws of UX site at https://lawsofux.com/ has further-reading links per law, including primary research, NN/g articles, and Smashing Magazine pieces. Jon Yablonski's book _Laws of UX_ (O'Reilly, expanded edition) is the canonical longer treatment. Don Norman's _The Design of Everyday Things_ is the parent text for much of this thinking — Norman coined "mental model" in the design context and his work pre-dates and underlies Jakob's Law.

Other adjacent resources:

- **Nielsen Norman Group** (nngroup.com) — research-backed UX articles, often the primary source for "Further Reading" links on Laws of UX.
- **Smashing Magazine** — practical front-end and UX articles.
- **Interaction Design Foundation** — long-form articles with academic depth.
- **Cognitive Bias Codex** (Wikipedia / cognitivebiasindex.com) — exhaustive list of biases beyond the few that show up in standard UX writing.
- **WCAG 2.2 / 3.0** — accessibility specifics this skill explicitly does not cover; pair with explicit a11y review.
