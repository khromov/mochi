---
name: laws-of-ux
description: Apply the 30 Laws of UX (Jon Yablonski) to web and app interface work — design review, component building, layout decisions, copy, flows, forms, navigation, error states, performance perception, and accessibility. Use whenever the user is building, reviewing, refactoring, or critiquing a website or web/mobile app UI; whenever they ask "how should this look/feel/behave"; whenever they're picking between layout or interaction options; whenever they share a screenshot or component for feedback; and proactively flag relevant laws during any frontend code work involving user-facing surfaces. Scope is digital screens only — not print, not voice, not physical product design.
---

# Laws of UX

A working reference for the 30 Laws of UX (Jon Yablonski) as applied to websites and web/mobile applications. Each law is a research-backed pattern about how people perceive, decide, remember, and act. Use them as lenses, not rules.

## When to apply

Apply this skill whenever the conversation involves a digital UI surface:

- **Building** — designing or coding components, pages, flows, forms, navigation, modals, empty/error states, onboarding.
- **Reviewing** — the user shares a screenshot, mockup, Figma frame, or component code and wants feedback.
- **Deciding** — the user is choosing between two layouts, interactions, copy variants, or IA structures.
- **Diagnosing** — the user reports a UX problem ("users keep dropping off", "this feels slow", "people miss the button").
- **Scoping** — the user is planning what to build and asks what matters most.

Out of scope: print, voice-only, hardware, pure backend with no human surface.

## How to apply

Don't list every law every time. Pick what's relevant. The workflow:

1. **Identify the surface** — form, list, dashboard, landing page, settings panel, marketing site, in-app flow, navigation? Mobile or desktop?
2. **Identify the user task** — what is the person trying to do? Decide, scan, complete, recover, learn, compare?
3. **Pick 2–5 relevant laws** from the task→laws map below. Quality over quantity.
4. **Apply concretely** — translate the principle into a specific change to copy, layout, spacing, timing, or state. Avoid abstract restatements ("you should reduce cognitive load"); say what to do ("collapse the secondary filters into a 'More' menu, keep only the four most-used filters visible").
5. **Note tensions** — laws conflict. Aesthetic-Usability vs. Occam's. Jakob's vs. novelty. Surface the tradeoff and let the user decide.

For each law's deeper takeaways, code patterns, anti-patterns, common misapplications, origins, and references, read `references/laws-detailed.md`. For systematic UI review by surface type (form, dashboard, checkout, etc.), read the "Critique playbooks" section there.

## Task → laws quick map

- **Forms / inputs** → Postel's Law, Fitts's Law, Doherty Threshold, Parkinson's Law, Working Memory, Tesler's Law
- **Navigation / IA** → Jakob's Law, Hick's Law, Law of Proximity, Law of Similarity, Serial Position Effect, Mental Model
- **Lists / search results / cards** → Law of Common Region, Law of Proximity, Law of Uniform Connectedness, Chunking, Miller's Law
- **CTAs / primary actions** → Von Restorff Effect, Fitts's Law, Selective Attention, Goal-Gradient Effect
- **Onboarding / new-user flows** → Paradox of the Active User, Hick's Law, Mental Model, Jakob's Law, Goal-Gradient Effect
- **Loading / progress / latency** → Doherty Threshold, Goal-Gradient Effect, Flow, Zeigarnik Effect
- **Empty / error / success states** → Peak-End Rule, Postel's Law, Aesthetic-Usability Effect
- **Dashboards / data-dense screens** → Cognitive Load, Working Memory, Chunking, Law of Common Region, Selective Attention, Pareto Principle
- **Pricing / decision pages** → Choice Overload, Hick's Law, Von Restorff Effect, Cognitive Bias
- **Visual hierarchy / layout** → Law of Prägnanz, Law of Proximity, Law of Similarity, Von Restorff Effect, Aesthetic-Usability Effect
- **Marketing / landing pages** → Aesthetic-Usability Effect, Serial Position Effect, Peak-End Rule, Selective Attention
- **Settings / preferences** → Tesler's Law, Hick's Law, Mental Model, Chunking
- **Mobile-specific** → Fitts's Law (touch targets), Jakob's Law (platform conventions), Doherty Threshold

## The 30 laws — index

Each entry is the law name, its core claim, and the _single most important_ practical takeaway. For nuance, code patterns, anti-patterns, common misapplications, and origins, see `references/laws-detailed.md`.

### Group 1 — Visual perception & layout (Gestalt)

How the eye organizes what it sees. Use for spacing, grouping, hierarchy.

- **Law of Proximity** — Objects near each other are perceived as grouped. _Use spacing as the primary grouping tool before reaching for borders._
- **Law of Similarity** — Visually similar elements are perceived as related. _Same visual = same kind of thing. Style primary CTAs, secondary CTAs, and text links distinctly and consistently._
- **Law of Common Region** — Elements inside a shared boundary are grouped. _A bordered card or panel beats spacing alone for strong grouping._
- **Law of Uniform Connectedness** — Elements visually connected (lines, frames) are perceived as the most related of all. _Stronger than proximity or similarity. Use for steppers, breadcrumbs, related-action toolbars._
- **Law of Prägnanz** — People interpret ambiguous shapes as the simplest possible form. _Aim for layouts that read at a glance as a small number of clean blocks. Reduce decorative noise._
- **Von Restorff Effect** — The element that differs from peers is best remembered. _One filled primary button per view. Don't over-emphasize — if everything stands out, nothing does._

### Group 2 — Decision-making & cognitive cost

How people choose under load. Use for forms, menus, settings, pricing.

- **Hick's Law** — Decision time grows with number and complexity of options. _Cap visible options. Highlight a recommended default. Defer the rest behind progressive disclosure._
- **Choice Overload** — Too many options paralyzes decision-making. _Anchor with a "recommended" tier. Provide filters, search, sensible defaults._
- **Cognitive Load** — Mental resources needed to use the interface. _Cut extraneous load: every decoration, animation, or label that doesn't help the task is tax._
- **Working Memory** — ~4 chunks, decaying in 20–30 seconds. _Recognition over recall. Carry context forward across screens (sticky filters, breadcrumbs, persistent state)._
- **Miller's Law** — ~7 (±2) items in working memory. _Don't use "7" as a UI rule (it's misused this way constantly). The real lesson is to chunk._
- **Chunking** — Grouping individual items into meaningful wholes. _Apply to text, data, and inputs. Visual chunks must match semantic chunks._
- **Tesler's Law** — Every system has irreducible complexity; the system absorbs it or the user does. _Smart defaults, autofill, format detection — push complexity off the user._
- **Occam's Razor** — Prefer the option with fewest assumptions / elements. _Default to subtraction. Question every element: does it earn its place?_
- **Pareto Principle (80/20)** — Most outcomes come from a small fraction of causes. _Identify the 20% of features driving 80% of value. Polish those first; defer the long tail._
- **Selective Attention** — People filter to goal-relevant stimuli. _Beware banner blindness — don't dress real content like ads. One focal point per screen._
- **Cognitive Bias** — Systematic errors in judgment. _Defaults, anchoring, framing, loss aversion shape behavior. Use ethically — dark patterns weaponize bias._

### Group 3 — Memory, motivation & experience over time

How users remember and stay motivated through a flow.

- **Serial Position Effect** — First and last items in a series are best remembered. _Lead with the strongest, end with the next-strongest, bury weak items in the middle._
- **Peak-End Rule** — People judge an experience by its peak and its end, not the average. _Invest in delight at peak moments and the end. Fix the worst moment first — negative peaks dominate memory._
- **Goal-Gradient Effect** — Motivation increases with proximity to the goal. _Show progress (bars, step indicators). Pre-fill some progress to bootstrap motivation._
- **Zeigarnik Effect** — Uncompleted tasks are remembered better than completed ones. _Open loops invite return ("draft saved", "1 unread"). Don't weaponize into anxiety machinery._
- **Flow** — Full immersion when challenge matches skill. _Match tempo to user skill. Remove friction breaks. Provide feedback for every action._
- **Aesthetic-Usability Effect** — Pleasing designs are perceived as more usable. _Polish multiplies. Watch out: aesthetics mask usability problems in testing — track behavior, not just satisfaction._
- **Paradox of the Active User** — Users start using software immediately and don't read manuals. _Inline tooltips and contextual help beat separate docs. Onboard through use._

### Group 4 — Behavior, expectation & robustness

How users _expect_ things to work, and how to be tolerant when they don't.

- **Jakob's Law** — Users spend most of their time on other sites; they expect yours to work the same. _Default to web/platform conventions. Innovate where it earns the cost; conform where it doesn't._
- **Mental Model** — Users hold compressed models of how systems work. _Match your structure to existing models in the user's domain. Test, don't guess._
- **Postel's Law** — Be liberal in what you accept, conservative in what you send. _Accept any input format (phone numbers, dates, names with diacritics, mixed case email); normalize server-side. Inline validation with concrete fix instructions._

### Group 5 — Time, motion & attention

How people experience speed and where they look.

- **Fitts's Law** — Time to acquire a target depends on size and distance. _Touch targets ≥44pt iOS / 48dp Android. Place primary actions where the cursor/thumb already is. Keep destructive actions far from common ones._
- **Doherty Threshold** — Productivity climbs when system response is under ~400ms. _Optimistic UI. Skeleton screens > spinners. Progress bars make waits tolerable even when imprecise._
- **Parkinson's Law** — A task expands until all the available time is spent. _Compress visible task length: autofill, smart defaults, paste-detection. Faster-feeling tasks complete faster._

## Tensions to flag

Laws can conflict. Surface the tradeoff explicitly:

- **Jakob's Law vs. novelty** — Conventions reduce learning cost but blind copying ships a worse experience than the originals. Innovate where it earns its cost.
- **Aesthetic-Usability vs. Occam's Razor** — Decorative touches that delight may also clutter. The test: does removing it change the _feeling_ of the product, or just the surface?
- **Hick's Law vs. Tesler's Law** — Fewer options is faster, but the complexity has to live somewhere. Hiding it in a "smart" default surprises users when the default is wrong.
- **Doherty Threshold vs. Peak-End Rule** — Fast is usually better, but a slightly longer "we found it!" moment can be more memorable than instant resolution.
- **Goal-Gradient / Zeigarnik vs. user wellbeing** — Open loops drive engagement and anxiety. Notification badges and "complete your profile" prompts cross a line. Don't weaponize.

## What this skill does _not_ cover

- Print typography, packaging, signage
- Voice and conversational UI specifics
- Physical product / hardware UX
- Information architecture beyond layout-level grouping
- WCAG / accessibility specifics — these laws are _adjacent_ to a11y but not a substitute. Always pair with explicit accessibility review.

## Reference

For each law's full takeaways, code patterns, anti-patterns, common misapplications, origins, and primary research, see `references/laws-detailed.md`. That file also contains:

- **Critique playbooks** — systematic UI review checklists by surface type (forms, dashboards, checkout, navigation, etc.)
- **Common misapplications** — the most frequent ways these laws get cargo-culted into bad design
- **How the laws relate** — siblings, parents, and meaningful distinctions between similar laws

Source: Laws of UX by Jon Yablonski (https://lawsofux.com/), CC BY-NC-ND 4.0.
