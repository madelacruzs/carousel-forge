---
name: instagram-carousel
description: >-
  Write and iterate on Instagram carousels with carousel-forge. Use when
  someone asks for a carousel, a slide deck for Instagram, a "10 slides about
  X" post, wants to improve an existing carousel.yaml, or asks for hooks,
  captions or hashtags for a carousel.
---

# Writing Instagram carousels with carousel-forge

## What you are actually doing here

`carousel-forge` renders. It does not write. It has no opinion about whether a
hook is any good, it will never rewrite a sentence for you, and the
`caption.md` it emits is an empty form. Every word that ends up in front of an
audience is written by you.

That division is deliberate. The CLI is deterministic and dumb so that it is
trustworthy; you are the part that is intelligent. So your job is not "run the
build command". Your job is the copy.

The single highest-leverage thing on a carousel is **slide 1**. Most people
never see slide 2. Spend your effort accordingly.

## The loop

```
brief  ->  propose 3 hooks  ->  [user picks]  ->  write carousel.yaml
                                                       |
                                     build -> contact sheet -> doctor
                                                       |
                                            show it -> take feedback -> repeat
                                                       |
                                              write the caption last
```

---

## Step 1 — Understand the brief before writing anything

From the user's request, establish these. Ask only about what you genuinely
cannot infer, and ask in one short message, not an interrogation.

|                    |                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------- |
| **Topic**          | What is this actually about? Specific beats broad.                                      |
| **Audience**       | Who is scrolling past? What do they already believe?                                    |
| **Their angle**    | What does the user know that most people in their field do not? This is the whole post. |
| **Desired action** | Save, share, comment, click, book, follow. Pick one.                                    |
| **Tone**           | Warm, blunt, technical, funny, quiet.                                                   |
| **Length**         | Default to 5 or 7. Nobody finishes 10 unless every slide earns its place.               |

If the brief is vague ("something about our new menu"), do not fill the gap
with generic marketing copy. Ask one sharp question: _"What's the one thing
about the new menu that would surprise a regular?"_ That answer is the post.

## Step 2 — Propose three hooks and stop

**This gate is mandatory. Do not write the rest of the carousel until the user
has chosen a hook.**

Read `narratives/hooks.yaml` for the formulas — `carousel-forge narratives hooks`
prints them. Pick three formulas that suit the brief, fill them in with
specifics from the brief, and present them as plain numbered options:

```
1. "4 things i wish i knew before opening a second location"   (wish-i-knew)
2. "you're pricing your menu wrong. here's why."               (mistake)
3. "what the reviews say vs. what actually fills tables"       (perception-vs-reality — needs two photos)
```

Rules for this step:

- **Fill the slots with real specifics.** `{n}` is a real number. `{topic}` is
  their actual topic. "3 tips for success" is a filled-in pattern that is still
  a bad hook.
- **Vary the formulas.** Three flavours of list hook is one option, not three.
- **Flag visual requirements.** `perception-vs-reality` and `before-after`
  declare `visual: split` and need two photos and two labels.
- **Say nothing else.** No draft slides, no caption, no "meanwhile here's the
  rest". The user picks, then you write.

If the user rejects all three, ask what was wrong with them and propose three
more. Do not quietly pick one yourself.

## Step 3 — Choose the narrative, then the theme

They are independent axes. Any narrative composes with any theme.

**Narrative** = what gets said, in what order. `carousel-forge narratives list`.

| Narrative      | Shape                                              | Use when                                    |
| -------------- | -------------------------------------------------- | ------------------------------------------- |
| `viral-5`      | hook → agitation → value ×n → cta                  | The default. Teaching or persuading.        |
| `listicle-10`  | hook → point ×n → cta                              | A genuine list of distinct items.           |
| `before-after` | hook → before → turning-point → after → cta        | There is a real transformation to show.     |
| `story-arc`    | setup → tension → turn → resolution → lesson → cta | Personal, narrative, one continuous thread. |

Pick by the _shape of the content_, not by vibe. If the user has seven
unrelated tips, `listicle-10` is right and `story-arc` will fight you.

**Theme** = how it looks. `carousel-forge themes list`.

| Theme            | Looks like                                               | Use when                                           |
| ---------------- | -------------------------------------------------------- | -------------------------------------------------- |
| `warm-editorial` | Full-bleed photo, heavy bottom gradient, lowercase serif | The default. Photography-led, personal, warm.      |
| `studio-minimal` | Bright photo, faint grid rules, generous space           | Product, interior, architecture. Anything premium. |
| `poster`         | Huge serif headline, rule, narrow copy, bottom bar       | Announcements, events, single-slide posts.         |

## Step 4 — Write `carousel.yaml`

```yaml
theme: warm-editorial
narrative: viral-5

brand:
  handle: '@theirhandle'
  accent: '#E8C47A'

defaults:
  overlay: 0.55
  numbering: true

slides:
  - image: images/kitchen.jpg
    focal: [0.4, 0.3]
    title: '4 things i wish i knew before opening a second location'

  - image: images/empty-room.jpg
    title: 'the second one is not the first one again'
    body: 'everything that worked was a person, not a process.'
```

### Copy budgets — the thing that actually makes it readable

A carousel is read at arm's length, at speed, on a phone, one thumb-swipe at a
time. These are not style preferences; copy over budget stops working.

- **Title: 7 words or fewer.** Under 5 for slide 1.
- **Body: 20 words or fewer**, 2–4 short lines.
- **One idea per slide.** If a slide contains "and", check whether it is two
  slides.
- **No slide is a paragraph.** If it does not fit, the idea is too big, not the
  type too large.

Each narrative role declares its own budget; `doctor` reports the exact
numbers. Treat an over-budget warning as "cut", never as "shrink the font".

### Copy the user wrote is theirs

When the user supplies exact copy, it goes into `carousel.yaml` **verbatim** —
every clause, in their wording, including the ones you would have cut.

If a line is over budget, overflows the safe area, or breaks badly, do not
quietly fix it. Say which slide, quote the line, explain what it does, and
propose a shorter alternative. The user accepts or rejects it.

Silently dropping a clause is the worst failure this skill has, because the
result still looks finished. Nothing downstream will catch it: the CLI has no
truncation logic, so copy that vanishes between the brief and the render was
removed by you, and only you can report it.

Rhythm is often the point of a line. Three short beats are not a redundant
version of two — if the shape is doing work, keep it and use explicit line
breaks with a YAML block scalar:

```yaml
body: |-
  no el país.
  el ruido de la calle.
  que alguien pase sin avisar.
```

### Writing that holds attention

- **Slide 2 must pay off slide 1 immediately.** The hook opened a loop; if
  slide 2 does not start closing it, everyone leaves.
- **Write for the swipe.** End slides slightly incomplete. A slide that fully
  resolves is a good place to stop reading.
- **Be concrete.** "we lost $40k on the wrong lease" beats "we made costly
  mistakes".
- **Lowercase reads as a voice, title case reads as a brand.** Match the user.
- **No slide should be skippable.** If removing it changes nothing, remove it.
- **The last slide asks for exactly one thing.** "save this" or "send this to
  someone" — not both.

### What not to do

- Do not write in the voice of a brand that is trying to sound human.
- Do not use "game-changer", "level up", "unlock", "dive in", "in today's
  fast-paced world", or a rocket emoji.
- Do not open with "As a business owner, you know that…".
- Do not pad to reach a slide count. Five good slides beat ten with three
  fillers.

## Step 5 — Pick images and focal points

Look at what is in `images/`. Match photo to slide by meaning, not by filename
order.

`focal: [x, y]` is where the interesting part of the photo is, as fractions —
`[0, 0]` is the top-left corner, `[1, 1]` the bottom-right, `[0.5, 0.5]` the
centre (the default). The crop keeps that point as close to the centre of the
frame as the source allows.

- Subject in the upper part of the frame → `[0.5, 0.3]`.
- Subject off to the left → `[0.3, 0.5]`.
- In `warm-editorial`, text sits over the **bottom third**. Pull the focal
  point up (`y` around `0.3`) so the subject is not buried under the title.
- Busy or bright photo behind text → raise `overlay:` on that slide.
- Reuse a photo if it genuinely fits twice, but never twice in a row.

## Step 6 — Build, then actually look at it

```bash
carousel-forge build
carousel-forge doctor
```

`build` writes `out/slide-01.png …`, `out/contact-sheet.png`, and
`out/caption.md`.

**Open `out/contact-sheet.png` and look at it.** This is exactly how the
carousel appears in a grid preview before posting. Judge it the way a scroller
would:

- Does slide 1 stop you?
- Can you read the titles at that size?
- Does it hold together as one object, or five unrelated posts?

Then run `doctor` and fix what it reports. It flags mechanically — safe-area
overflow, text clipping, slots overlapping, contrast against the actual
photo behind the words, copy over budget, a weak-looking hook, a missing CTA,
consecutive slides saying the same thing. It never rewrites. Fixing it is
yours.

If `doctor` says the hook is weak, do not argue with it by adding adjectives.
Go back to `hooks.yaml` and rebuild the line.

## Step 7 — Iterate on feedback

Feedback is usually short and about one slide. Translate it, change only what
was asked, rebuild, and show the sheet again.

| They say              | You do                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| "slide 4 is too long" | Cut it to one idea. If both ideas matter, split into two slides and rebalance the narrative.           |
| "more contrast"       | Raise `overlay:` on that slide, or move the focal point to a darker region. Do not change the theme.   |
| "the hook is weak"    | Return to step 2. Propose three new ones. Do not tweak the old one.                                    |
| "make it pop"         | Ask what they mean — usually a bigger hook, a stronger image, or fewer words. Never all three at once. |
| "too corporate"       | Lowercase, shorter sentences, first person, one concrete number.                                       |
| "can it be shorter"   | Drop the weakest _value_ slide, never the hook or the CTA.                                             |
| "wrong vibe"          | Try a different theme before rewriting copy. `theme:` is a one-line change.                            |

Rebuild after every change. Never describe a change you have not rendered.

## Step 8 — Write the caption, last

`out/caption.md` is a scaffold with `<!-- TODO -->` markers. Every marker is
something the CLI deliberately refused to invent. Fill them in and write the
result back to the file.

- **First line is a second hook.** Instagram truncates after roughly 125
  characters and the rest is behind "more". Do not open with "Swipe to see…".
- **Do not restate the slides.** The caption adds the context that would not
  fit, or the story behind it.
- **Close with the same single ask** as the final slide.
- **Hashtags in three tiers**, in the first comment or at the end: 3–5 broad,
  8–12 niche, 1 branded. Niche tags do the work; broad tags alone are noise.
- **The first comment is real estate.** Put the link, the long version, or a
  question that invites replies.

---

## Command reference

```bash
carousel-forge init [--theme <name>] [--narrative <name>]   # scaffold a project
carousel-forge build [--watch] [--out <dir>]                # render to out/
carousel-forge preview                                      # contact sheet + local server
carousel-forge doctor                                       # lint layout and copy
carousel-forge themes list
carousel-forge themes new <name> [--from <existing>]
carousel-forge narratives list [--verbose]
carousel-forge narratives hooks                             # print the hook formulas
carousel-forge narratives new <name>
```

## Worked example

> **User:** 10 slides about why our sourdough takes 3 days, warm tone

**You (step 1):** One question — _"What's the part of the three days that
customers are most surprised by?"_

> **User:** That day two is just waiting. Nothing happens.

**You (step 2):**

```
1. "day two we do nothing. that's the whole secret."        (contrarian)
2. "3 days for one loaf. here's what actually happens."     (number-drop)
3. "what you think slow bread means vs. what it is"         (perception-vs-reality — needs 2 photos)
```

> **User:** 1

**You (steps 3–6):** `viral-5` — it is persuasion, not a list — with
`warm-editorial`. Ten slides is too many for one idea, so propose seven and say
why. Write `carousel.yaml`, assign photos with focal points on the dough and
the hands, `build`, look at the contact sheet, run `doctor`, fix what it finds,
show the sheet.

> **User:** slide 5 is too long and the hook could be punchier

**You (step 7):** Cut slide 5 to one idea. For the hook, return to step 2 and
offer three new ones — do not edit the old line and call it punchier. Rebuild,
show the sheet again.

Caption last.
