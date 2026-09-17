# Project Status

## Current Sprint

**Backend moved to Sprint 3 on 2026-08-20** — `docs/sprints/sprint-03.md`
(Notification / Settings / Release). Sprint 2's backend is code-complete;
sprint 2 itself is **not closed**: 2.1.3–2.1.5 (trang Memories) is unbuilt
and undecided, ten items in 2.2–2.5 are built but never ticked, and 2.6
was dropped (see Important Decisions).

**Sprint 1 — Core Features** (in progress — PRs #1–#9 merged; the
"pending team review before start" note was stale and is removed
2026-08-18). **Backend has moved on to Sprint 2 (2026-08-19)**: sprint 1's
backend side is finished, so `apps/api` work now follows
`docs/sprints/sprint-02.md` while frontend wires the remaining sprint-1
screens.

- **Sprint 2's AI side delivered 2026-08-20** — groups 2.2–2.5
  end-to-end (`apps/ai` FastAPI, NestJS `src/ai` + `src/video`, mobile
  screens 21-33), **merged to `main` in PR #25**; a perf + privacy pass
  follows on `merge/ai-integration` (PR pending). Per-task detail in
  `docs/sprints/sprint-02.md`; contract and measured latency in
  `docs/03-ai/architecture.md`.
- Active sprint docs: `docs/sprints/sprint-01.md` (frontend wiring),
  `docs/sprints/sprint-02.md` (backend + AI team)
- Later: `docs/sprints/sprint-03.md` (Notification / Settings / Release)
- Setup record (completed): `docs/sprints/00-setup.md`

## Current Focus

- **Google button disabled for the demo (2026-09-11).** The sign-in-with-
  Google button stays visible but greyed out and unpressable — the OAuth
  round-trip leaves the demo script. Flow and server route untouched;
  re-enabling is restoring the `onPress`/`loading` wiring in
  `auth/social-buttons.tsx`. Verified: mobile tsc + prettier.

- **Welcome CTA copy: はじめに → はじめる (2026-09-11).** The primary
  button on the Welcome screen read はじめに, which reads as a heading
  ("Introduction"), not an action. Now はじめる (`auth.welcome.start`,
  `ja.json`). Verified: mobile check:i18n (928 keys).

- **Timeline rail fill and dim bands drifted after photos loaded
  (2026-09-04).** Reported by the owner: the coral fill stopped off the
  active dot and some cards dimmed at the wrong scroll positions. Cause:
  the aspect-ratio photo change (below) makes a card grow when its image
  loads, shifting every row under it, while row boxes were recorded only
  by each row's own `onLayout` — which does not fire for a pure position
  shift on web, and races on native. Fix: the content-size trigger that
  already re-measures the list anchor now sweeps a `measureLayout`
  re-measure over every row, and the row's animated translate moved to an
  inner view so the measured wrapper stays untransformed.
  `member/timeline-motion.ts`, `member/timeline-list.tsx`. Verified:
  mobile tsc + prettier; motion needs an on-device pass.

- **Timeline photos draw at their own shape (2026-09-04).** The lone
  photo on a timeline card was a fixed 110px-tall `cover` letterbox that
  cropped most of the picture. It now sizes its frame from the photo's
  measured aspect ratio, clamped to [0.72, 1.9] — the same rule the
  feed's single photo already used (`feed/post-media.tsx`). The square
  "+N" row for multiple photos is unchanged. `member/event-photos.tsx`;
  design-system.md updated. Verified: mobile tsc + prettier.

- **Year-only milestones show no day on the card (2026-09-04).** The
  editor stores a year-only entry as Jan 1 (`parseWhen`); the read card
  used to render that as a literal "1 Jan" beside the place. It now reads
  a 01-01 `eventDate` back as year-only and drops the day/month — the
  year chip already carries the year. Known cost: an entry genuinely
  dated New Year's Day loses its day label (no granularity flag in the
  schema; adding one is the proper fix if this ever matters).
  `member/timeline-list.tsx`; design-system.md updated. Verified: mobile
  tsc + prettier.

- **Timeline edits no longer post to the feed (2026-09-03,
  `feature/demo-account`).** Creating a milestone used to also announce it
  in the family feed as an EVENT post (behind `shareToFeed`, default
  true, own-profile creates fanning out to every family). Removed on the
  owner's call — a timeline edit is record-keeping, not news: the post
  block and the DTO flag are gone from `life-event.service.ts`, the
  "share with the family" checkbox left the timeline editor, and the
  contract note lives in `api-contract.md` § Life Events. Old clients
  still sending the flag are stripped harmlessly by the ValidationPipe;
  EVENT posts created before the change stay in the feed. Verified: api
  build+lint, mobile tsc + check:i18n (928 keys), and against the live
  API — feed count unchanged across a create, test row deleted.

- **Public demo login on the welcome screen (2026-09-03,
  `feature/demo-account`).** The welcome CTA now opens **sign-in** (not
  registration) with the public demo account prefilled
  (`/sign-in?demo=1`, credentials in
  `src/features/auth/demo-account.ts` — deliberately shipped in the
  client, not a secret), so a first visit is one tap from being inside.
  The account (`user.alphaclub@gmail.com`, name "Alpha Club") was
  registered against the shared Neon database, which the deployed Render
  API also uses. It belongs to no family yet — deliberately not joined to
  山田家: it is a write-capable login handed to strangers, and deletes are
  hard deletes, so what it may touch needs an owner's decision. Verified:
  tsc, prettier, check:i18n, and the flow driven in a browser (CTA →
  prefilled form → signed in, input values read from the DOM).

- **The timeline moves with the reader (2026-09-03,
  `feature/timeline-scroll-motion`).** Per the owner's handoff
  (`apps/mobile/src/edit-timeline.html`) — first shipped as motion on the
  old row layout, then redrawn as the handoff's CARDS the same day on the
  owner's call ("tôi muốn làm giống với cái html tôi gửi"): white cards
  down one continuous rail, year as a coral serif chip inside the card
  (the year column is gone). Every effect is driven by scroll POSITION,
  not time. Cards rise 24px and fade in over the bottom 30% of the
  viewport, fade out over the top 22%, and are emphasised (opacity
  0.65→1, scale 0.965→1) by closeness to a reading point at 42% of the
  viewport. One entry is ACTIVE at a time — highest focus still visible;
  its dot swells with a coral ring and a pulsing halo, a triangle points
  at it from the card, a coral band hugs the card's left edge with its
  ends curving around the corner arcs (the handoff's inset box-shadow,
  done as a left-border-only overlay sharing the card's radius), the
  rail's coral fill slides to its dot (380ms, scaleY — height is layout),
  a lone photo drifts in parallax inside its frame, and hitting the end of
  the scroll forces the last entry active since it can never reach the
  reading point. All worklets on the UI thread
  (`components/member/timeline-motion.ts`), only transform/opacity per
  frame; the routes own the `Animated.ScrollView` and hand the motion down
  through `ProfileBody`. Under OS reduced motion — or anywhere without a
  scroll owner — the same cards render static, coral marking the latest
  entry instead of the reading position. Dropped from the handoff
  deliberately: grayscale (no cross-platform `filter` in RN), the momentum
  tail (native scroll already emits through the fling), and the "who added
  this" line (`LifeEvent` carries no author on the wire). First look
  caught one real bug ("lướt đến đâu bị mất hình đến đấy"): the list's
  anchor inside the scroll content was measured once, and when the
  async-loading hero/facts above it grew, every effect shifted up by that
  growth — the top fade band landed mid-screen and hid rows in plain view.
  The anchor now starts "unknown" (effects hold neutral until measured) and
  is re-measured on every content size change. Verified: tsc, prettier,
  check:i18n (930 keys); the fix itself not yet re-checked on a device.

- **The tree draws like the prototype now (2026-08-31,
  `feature/tree-layout-units`).** A day of pulling
  `family-tree-canvas.html` and the app together, with two experiments
  tried and reversed the same day on the owner's calls:
  - **The prototype's replay placement was tried and taken out.**
    `tree-placement.ts` gave each member a spot in join order
    (`findFreeX`/`findPairX`, rows balanced on a centre axis) — perfectly
    stable, and structurally blind: with no notion of a family unit,
    children of different couples interleaved along a row and their
    threads CROSSED on the first real tree ("bị đan chéo… nên gom thành
    cụm rồi sắp xếp"). The family-unit **block layout is restored**
    (`tree-blocks.ts`) — grouping is the cluster idea — and while putting
    it back a latent centring bug got fixed: children now centre under a
    parent pair WIDER than their spread, so the joint lands exactly over
    the descent (26px off with 204 couples; latent since 08-27).
  - **Thread shapes and spacing match the prototype**: couple pitch
    118→204 (258 scaled to 60px nodes), rows 172→212, arc sag 16 with a
    bigger joint dot, descents with both controls near the top, and a lone
    parent's thread is the prototype's S-curve (`singleDescentPath`).
  - **Both families sit symmetric around a couple** ("phải căn chỉnh sao
    cho 2 bên đối xứng"): the spouse's parents used to land as a stray
    root at the tree's right edge, thread slanting across. In-law blocks
    now dock — two lone parent blocks centre side by side over the couple
    (each above their own child, descents mirrored); against a wider
    owning subtree they seat straight above their child, stepped outward
    if the row is taken. Rule in `family-tree-rendering.md` § Horizontal
    placement.
  - **Threads never cross** ("luôn luôn không có đường cắt nhau… tự điều
    chỉnh"): prevented structurally (bounding boxes; children grouped by
    the joint they descend from, so a remarriage cannot cross at birth),
    then DETECTED pairwise on straight-line proxies after placement, and
    adjusted — swap the two subtrees at their divergence point, flip a
    docked in-law, or restack a side branch — keeping only changes that
    reduce the crossing count, so the pass terminates. Runs inside
    `layoutTree`, so add/remove both re-establish the invariant and the
    centring. Non-planar graphs keep their unavoidable crossing. Rule in
    `family-tree-rendering.md` § Horizontal placement.
  - **A partner's whole branch stays on their seat's side** ("nhánh của
    bên trái thì sẽ phải nằm bên trái, nhánh của bên phải thì sẽ nằm bên
    phải"): an in-law family with a subtree of its own (the spouse's
    siblings) used to be appended as a stray root at the right edge,
    thread slanting across the spine. Such branches now stack adjacent to
    the main tree on the side their couple leans toward, and the couple's
    seats turn so each married-in partner faces their own family. One bug
    caught by simulation while building it: the spine root matched its own
    detection (it too has a descent into a couple it owns) and disqualified
    every real side branch. Rule in `family-tree-rendering.md`
    § Horizontal placement.
  - **The opening draw-on was built and removed the same day** (owner's
    call: three-plus seconds of choreography on every open of a navigation
    surface — "thấy mất thời gian quá"; the implementation stays in branch
    history if a first-launch-only variant is ever wanted). The edit-mode
    slot pop was shortened in the same pass (0.75→1, damping 17/420 —
    four slots doing the full new-person bounce at once read as fussy;
    "ngắn hơn nhưng vẫn hay").

  - **Found the same day, looking at it: tiers went stale.** Depths were
    computed once from parent edges, THEN spouses/siblings were levelled —
    and nothing re-derived the depths that depended on the moved people: a
    niece drew a row above the sister who mothers her, an added mother
    landed beside the great-grandparents. `resolveDepths` now settles rows
    as a fixed point of three pull-down rules (child below parents, parent
    one above shallowest child, partners/siblings level) — 3 repro cases
    fixed, detail in `family-tree-rendering.md` § Vertical placement.
    Verified: mobile tsc, prettier, check:i18n (828 keys), and node
    simulations (children grouped per family with no interleave, joints
    landing exactly over their children, couple pitch 204, in-law H
    symmetric to the pixel, remarriage and cross-block-parents cases at
    zero crossings, plus 3 depth repros); not yet watched in a browser,
    and nothing tapped through on a device.

- **The tree adds people by tapping the spot now (2026-08-28,
  `feature/tree-layout-units`).** Per the owner's prototype
  `apps/mobile/src/family-tree-canvas.html`: the canvas's add button became
  an **edit toggle** (pencil ↔ check); in edit mode tapping a person selects
  them and dashed **slots** appear for whatever is still missing around them
  (mother/father judged from the drawn parents and their gender, child
  always, spouse while single), each with a dashed preview of the exact
  thread that will exist. Tapping a slot opens the same invite sheet minus
  the kinship picker — the slot already decided the edge — and the request
  carries the new `anchorMemberId`, so the edge hangs off the selected node,
  **the first flow where the anchor is not the inviter** (this was the gap
  discussed 2026-08-28: uncle/grandparent-shaped relatives were previously
  inexpressible). `POST /invitations` also takes `gender` for the parent
  slots. New nodes spring in. **Second pass the same day: the relayout
  slides.** When an addition re-arranges the rows, existing nodes glide to
  their new places and the threads morph along, with threads born in the
  payload fading in on the slide's tail — react-native-svg cannot tween a
  path's `d`, so `use-animated-tree-layout.ts` tweens the LAYOUT (a ~550ms
  rAF interpolation re-rendering from in-between coordinates; rare and
  sub-second, so the re-render-per-frame the gesture layer avoids is fine
  here). Mechanism in `family-tree-rendering.md` § Edit mode. **Third pass
  the same day: air.** Node spacing loosened (couple 104→118, blocks
  128→152, rows 150→172, edge margins 72→96 — labels sat edge-to-edge) and
  the pan may rest 72px past flush on every side (`PAN_MARGIN`) so a
  viewport-sized tree is draggable at all and border nodes can be pulled
  inward; edit-mode slots spread to match. Follow-up the same day: edit mode
  gives the world a 96px top gutter (rides the slide; refit ignores it, so
  the pencil never resets pan/zoom) — a top-row person's add-mother/father
  slots were clamping onto their face — and the two parent slots spread
  ±95px. And **co-parents draw as a couple** (2026-08-28): two people
  parenting the same child get the arc + joint + one descent even with no
  SPOUSE edge recorded (two placeholders can never be given one), same
  drawing-only contract as the partner auto-join; skipped when either has a
  real partner. Detail in `family-tree-rendering.md` § Threads. Verified: api build+lint, mobile
  tsc, check:i18n (828 keys), prettier on touched files; not yet tapped
  through on a device or browser.

- **Home's IA swapped: tree to the bar's centre, posting to the top of the
  feed (2026-08-26, `feature/motion-system`) — owner's call, deviates from
  the mockups, ratify or revert.** The diagnosis: Home showed two `+`
  buttons meaning different things — the strip's "new group" beside the
  bar's unlabelled "new post" — and the bar's + kept being read as "add
  family". The swap, refined the same day: the tree first took the centre
  as a raised coral disc, then the disc itself went — a slot dressed as a
  button among four destinations reads as an action — so the bar is now
  **five equal slots** with the **family tree an ordinary tab**
  (`app/(tabs)/family.tsx`, `Network` glyph, selected pill like the rest;
  the desktop rail matches with five plain rows and no disc). Posting is a
  **compose bar on Home** ("Share today's moment…" → `/new`) — pinned
  above the feed for a few hours, then moved into the scrolling intro
  right under the swipe cue (it pushed the celebration card below the
  fold when pinned) — and the **group strip left Home** for the family
  tab, where switching lives with the trees. Two recorded costs: posting from another tab is two taps
  now (via Home), and the family SWITCHER is no longer above the feed.
  `/new` keeps its path. Verified: tsc, prettier, check:i18n; not looked
  at on a device.

- **The compose screen presents like a sheet (2026-08-26,
  `feature/motion-system`).** `/new` moved out of `(tabs)` to a root
  Stack screen: it rises from the bottom over a fading scrim and drops
  back down on close. The motion is the screen's own —
  `useScreenSheet()`, a new motion primitive
  (`components/motion/screen-sheet.ts`), with the route a
  `transparentModal` + `animation: 'none'` — because the first cut used
  the stack's native `slide_from_bottom` and native-stack animations
  never run on the web, which is where the team previews: it looked like
  an instant page swap. Its header carries an
  ✕ (`CloseButton`, new in `header-slots.tsx`) instead of a back chevron;
  the stack back gesture is off for this screen, so leaving goes through
  the ✕ — which asks **keep editing or discard?** in a sheet
  (comment-delete anatomy) whenever a caption or media is on the screen,
  and just closes when it is untouched. Posting also pops back down now
  (was `replace('/')`). Verified: tsc, prettier, check:i18n (775 keys);
  not looked at on a device.

- **Backend infrastructure, not screens (2026-08-26).** The database moved out
  from under everyone in PR #51: development runs on **shared Neon Cloud**, so
  the team sees one set of data. Two things follow from that, and they are the
  current line of work:

  - **Demo data.** `pnpm seed` fills the shared database and is safe to
    re-run. Photos are the exception — they come from
    `apps/api/prisma/seed-images/` on each machine, because `Media` rows are
    shared but the files in `apps/api/uploads/` are not.
  - **Media storage.** Files on local disk cannot work for a shared team
    database forever. `StorageService` has been decoupled from filesystem
    paths (branch `refactor/storage-local-path-borrow`), and **Cloudflare R2
    is proposed** in `deployment.md` — bucket and credentials verified, driver
    not written.

  Day-to-day rules for a shared database — never `prisma migrate reset` or
  casual `migrate dev` on it, and `pnpm test:e2e` stays off it — are in
  `docs/04-devops/local-environment.md` § Neon rules.

  Untouched by all of this: `schema.prisma`, models, business logic, and
  everything in `apps/mobile`. Frontend work continues independently.

- **Media storage is the current backend line (2026-08-26).** Frontend layout
  work below is paused — this is infrastructure, and it blocks the team rather
  than any one screen.

  `StorageService` no longer hands out absolute filesystem paths.
  `absolutePathOf()` is gone; callers now ask for bytes (`readAll`), borrow a
  path for a scope (`withLocalCopy`), or hold a borrow across a pipeline
  (`newBorrow`, used by the video render). Behaviour is unchanged — the
  local-disk backend still returns the stored file — but nothing outside
  `StorageService` assumes a filesystem any more.

  **Next: a Cloudflare R2 driver** behind the same interface, selected by
  `STORAGE_DRIVER`. R2 is the proposal in `deployment.md`; the bucket and
  credentials exist and are verified, the driver is not written. Reason for
  R2 over S3: zero egress, which is the bill that matters for an app whose
  users reopen the same photos for years.

  Untouched by any of this: `schema.prisma`, models, business logic, and
  everything in `apps/mobile`.

- **The timeline finally has an editor (2026-08-26,
  `feature/motion-system`).** The Life Event API has been complete since
  1.6.8 (2026-08-19) and nothing in the app ever wrote to it — the
  timeline was read-only and `TimelineList.onAddEvent` sat unconnected
  with a comment saying so. Per the owner's mockup
  (`mockups/edit-timeline-view-edit.html`): your own Timeline tab gains a
  "Your journey · Edit" row opening `app/profile/edit-timeline.tsx` — a
  **staged** editor (Cancel · Edit timeline · Done) whose banner promises
  "changes are only visible to you until Done" and whose code keeps it:
  drafts are local, Done commits the batch (removes → edits → adds,
  sequential; a partial failure reseeds from the server and asks for Done
  again), Cancel discards. Entries auto-sort by date; new ones render
  dimmed as "Draft · not published yet"; the form takes `1998` or a full
  date, and **photos** (added the same day): the moment composer's
  `MediaStrip` + picker on unsaved entries, files kept local until Done
  uploads them via the shared `uploadDrafts` — so cancelling a draft
  leaves no orphan uploads, and a saved entry's form says photos are
  fixed instead of drawing a picker that lies. Photos are also DRAWN now
  (`member/event-photos.tsx`: one wide, several as squares with "+N") — on
  the editor's cards and on the read timeline, which had said "3 photos"
  in words since it was wired. Spec + the one remaining
  limit (own profile only — the wiki/placeholder question stays open) in
  `design-system.md` § Timeline editor. Verified: tsc,
  prettier, check:i18n (765 keys), and the exact requests Done emits
  replayed against the live API (create year-only and full, patch moving a
  date, list re-orders, delete; throwaway account, rows cleaned up). The
  screen itself has not been tapped through in a browser yet.

- **The ghost-member bug: an invitation could not be taken back
  (2026-08-26, `feature/motion-system`).** Sending an invite reserves the
  spot (placeholder + edge + code, one transaction) and the server has had
  the undo since 1.4.4 — cancel deletes an untouched placeholder and the
  node falls back to Empty — but **no screen ever called it**:
  `useCancelInvitation` sat unused. Worst case: invite a PARENT, close the
  sheet without keeping the code, and the spot is a permanent ghost — the
  member sheet's Remove is disabled by its own `hasChildren` rule (the
  viewer hangs below them), and after 7 days the pending ring quietly
  disappears, leaving an ordinary-looking placeholder nobody can explain.
  Fixed in two places: the **member sheet** now swaps Remove for "Cancel the
  invitation" while a stored-PENDING invitation holds the spot (derived
  `EXPIRED` counts — the row is still PENDING, so the lapsed ghost is
  curable too), and outstanding invites moved to a **Sent invitations
  screen** (`app/family/invitations.tsx`, behind a paper-plane + badge at
  the family screen's top right, per-row Resend/Cancel, resolved rows kept
  as dimmed history; tapping a live or lapsed row reveals its code via
  `InviteCodeCard` — the sender who closed the sheet without copying gets
  it back). The floating banner it replaces was first given an ✕
  and then **removed the same day at the owner's call** — a card parked on
  the canvas covered the very tree being looked at.
  `components/family/pending-banner.tsx` is deleted. Verified: tsc,
  prettier, check:i18n (740 keys); the flow itself not yet replayed against
  a live server.

- **Joining a second family finally has a door (2026-08-26,
  `feature/motion-system`).** The join-by-code screen existed but only an
  account with NO family could reach it (Home's empty state); somebody in
  family A read a code for family B over the phone had nowhere to type it —
  the code's own alphabet (no I/O/0/1, chosen to survive being read aloud)
  says that path was always intended. Per mockup 7a
  (`docs/01-frontend/mockups/family-tree-screen-7a.html`): the family screen
  carries a "Have an invite code? · Join a group" banner under the group
  strip, opening `/create-family` straight on its Join tab (new `mode`
  param). The strip's + stays "create" on purpose. Verified: tsc, prettier,
  check:i18n (729 keys); not looked at on a device.

- **Motion-kit polish, three small pieces (2026-08-26,
  `feature/motion-system`).** The video setup screen's 9:16 | 16:9 frame
  control now slides ONE white thumb between its options (`useSlidingThumb`,
  same journey as every other segmented control) instead of each half
  painting its own background. The success toast gained `CatPeek` looking
  over its top edge — a "vừa xong" moment per the kit's cat rule; the failure
  toast stays plain on purpose. And the **comment composer was rebuilt as a
  composer**: `TextField` gained a `maxHeight` shape — one line tall at rest
  (~47px, matching the 44px send button it used to tower over at 104px),
  growing with the text to five lines, then scrolling inside. No floating
  label there (scrolled text slides up under where the label sits — it became
  the accessibility label, the placeholder does the talking) and the
  countdown shows only near the limit. One web-only trap worth remembering:
  a textarea's `scrollHeight` never reports less than the height set on it,
  so shrink-on-delete needs the height released for a frame before measuring
  — the reason is written next to the code in `ui/text-field.tsx`. Spec in
  `design-system.md` § Form fields. A `TextField` swap for the video
  story box was tried and reverted the same day at the owner's call — the
  bordered box read wrong inside that card. Verified: mobile tsc, prettier,
  check:i18n; not yet looked at on a device.

  **The birthday theme landed the same day.** `CONFETTI_CANDLES` — the theme
  the widget GET has carried since 1.2.5 with nothing drawing it — now has
  its card (`components/home/birthday-card.tsx`, drafted as
  `docs/01-frontend/motion/birthday-theme-card.html`): swaying garland,
  drifting confetti, a party hat wobbling on the person's avatar, candles
  flickering on a cake, and a tap answering with a firework burst where the
  finger landed (the card navigates nowhere, so it can afford to celebrate;
  no `accessibilityRole`, since a button that does nothing should not be
  announced as one). Every loop animates SVG transform/opacity only, on the
  cats' `rotateAbout` idiom — now exported from `motion/cats.tsx`.
  Illustration colours stay literal per the cats' rule; the corals are the
  tokens' own. `FLORAL_BORDER` still falls back to the bunting card.
  Corrected the same day after a first look: on web every burst landed at the
  card's centre (`locationX` does not exist in react-native-web's
  nativeEvent — page coordinates against `measureInWindow` do), and the
  draft's fixed sizes rattled inside the column's 560px card — the cake and
  presents now scale with the card (capped 1.5×), the volley is five bursts
  offset by fractions of the card, confetti covers the middle band, and the
  card keeps the photo theme's 196px so the slot doesn't jump between
  themes. The burst itself also changed shape: the draft's 8 lines anchored
  at the centre scale into a spiderweb, so a burst is now particle dots
  flying outward, shrinking and fading, the middle opening up behind them —
  three interleaved shells (outer in the burst colour, a half-step-offset
  middle and a late core in a lighter partner colour), so it blooms.
  The background gradient was the third same-day fix: an `<svg>` with no
  width/height attributes defaults to 300×150, so it covered a corner of the
  card — it now takes the measured size, over a `coral.light` base coat.
  **The AI hub's featured occasion IS the same card** when the date is a
  birthday: the hub renders `BirthdayCard` itself (with the person's real
  photo — the hub can resolve `avatarKey`, Home's widget payload cannot),
  and its three prefilled chips (Gift/Message/Video) are gone for that case
  — owner's call, same day, after a dressed-with-buttons version was built
  first: one occasion must look like one occasion on both screens. The cost
  is named here on purpose: those chips carried the person and occasion into
  the makers; for a birthday that entry now goes through the MAKE SOMETHING
  rows, which open the makers empty. Non-birthday occasions keep the
  three-button card unchanged. Verified: tsc, prettier, check:i18n (727 keys); the animations
  themselves have not been watched in a browser yet.

- **The app stopped simply growing (2026-08-25).** Every screen used to be
  `viewport - two gutters` wide at any size, which is right on a phone and
  wrong from about 600px up: at 1440 a post card was 1400px across and a line
  of its text ran ~200 characters. There was no app-shell or container layer
  at all — `_layout.tsx` is providers plus a `Stack`, and each of the 27
  screens rebuilt the same full-bleed `View` → `AppHeader` → padded scroller
  by hand.

  Content now lives in a **600px column, centred**, defined once in
  `components/layout/content-column.tsx` and applied to every page scroller,
  pinned header row, footer bar and floating button. It is **not** a
  breakpoint, which is the point: because the ceiling counts the gutters,
  anything under 600px is laid out exactly as before, so the phone design is
  untouched rather than re-derived, and 600 / 768 / 1024 / 1440 are all fixed
  by one rule. Chrome (the blurred header bar, a footer's surface) and the
  family-tree canvas stay full-bleed on purpose — a map wants the room, and
  chrome that stops short of the edge stops reading as chrome.

  Breakpoints exist as `md` 768 / `lg` 1024 / `xl` 1280, on Tailwind's own
  numbers so a `lg:` class and a JS comparison cannot disagree. **No `sm`** —
  a breakpoint belongs in this app only where the layout stops working, not
  because a popular screen is that wide. Decided against putting responsive
  logic in `md:`/`lg:` class prefixes: 96 files style with inline `style`
  objects against 32 with `className`, and a list's width has to be set on
  `contentContainerStyle`, which cannot take a class.

  **The navigation followed, the same day.** From 1024px the bottom bar
  becomes a **76px bar of glyphs** floating down the left, which **opens to
  240px under the pointer** — over the content, not pushing it. It is the
  bottom bar stood up: same 30-blur glass under 86% white, inset 16 from the
  edge, hugging its contents, with a 38px corner that makes it that bar's pill
  turned vertical. Direction was set by
  the team: it should feel like Threads or Instagram on the web, and those two
  turned out to be the layout already planned — a left rail and one centred
  column, at 630–640px against our 600.

  The first attempt got this wrong and was corrected the same day, which is
  worth recording. It made the labelled 240px sidebar the **resting** state
  from 1280px up. On a 1920px window that spends most of a third of the width
  permanently on four words next to a 600px column, and the first screenshot
  of it read as top-heavy before anybody measured anything. Instagram does not
  do this: its rail rests as glyphs. So `xl` lost its structural meaning
  entirely — the labelled state is a **hover**, not a window size — and `lg`
  is now the only breakpoint the layout branches on. Details, including the
  three things that make opening read as one object rather than two states, in
  `design-system.md` § Side navigation.

  The known cost is named there too: an iPad in landscape is wide enough for
  the rail and has no pointer, so it only ever sees glyphs — and this app's own
  design notes argue at length that these particular glyphs mean nothing on
  their own. Accessibility labels are unaffected. If it matters, the answer is
  a pinned-open state rather than a breakpoint.

  Two things found by looking at it, both small and both real. **The app had no
  background of its own**: `Stack` paints the page colour behind a screen and
  every screen asks for it again, but the frame _around_ them had none, so on
  the web the column reserved for the bar showed the document's white and the
  glass came out as a white shape on a white strip beside a warm page — which
  is what "the sidebar looks detached" turned out to mean. The colour now sits
  on the root view, where it covers everything. And **the bottom bar's selected
  chip is a pill now** rather than radius `2xl`: the bar's own cap is a 34
  radius, so an 18-radius chip cleared it by ~3px on the corner diagonal
  against 6px along the flat, reading as both squarer than the bar around it
  and crowded against its end. `full` makes the clearance an even 6px without
  touching any padding. Nothing else about the bottom bar changed.

  The load-bearing decision is **where the rail is mounted**: in
  `app/_layout.tsx`, beside the whole `Stack`, not in `(tabs)/_layout.tsx`
  where the bottom bar lives. A pushed screen is a `Stack` screen _above_ the
  tab navigator, so a rail mounted inside the tabs would vanish the moment
  somebody opened a Life Profile — which is precisely the thing that makes an
  app feel like a phone app being viewed through a window. It is a plain flex
  row, so no screen knows the rail exists; the content column simply centres
  in a narrower space. `useLayout()` (`src/theme/use-layout.ts`) is the single
  place a width becomes a structural decision, and the five tab screens stop
  reserving 140–160px of bottom room once nothing is floating there.

  **The same safe-back fix got built twice, and that is worth recording.** A
  bare `router.back()` dead-ends whenever a screen is the first entry in the
  history — which on the web is any reload, any deep link, any tap on a
  notification — and on native it throws `GO_BACK` and takes the navigator with
  it. PR #48 fixed it on `main` as `src/lib/back.ts` (`safeBack` /
  `useSafeBack`, plus a `BackButton` that handles it when given no `onPress`).
  This branch, cut before that landed and never re-fetched, built the identical
  helper independently. The merge on 2026-08-25 kept `main`'s — it has
  per-screen fallbacks (`/ai`, `/albums`, `/settings`, `/profile`,
  `/video/setup`) where the branch's had one blanket `/` — and deleted the
  duplicate. The cost was ~30 files of conflict for nothing.

  The lesson is the one `CLAUDE.md` § 8.1 already gives: read what teammates
  landed on `main` **before** writing code, not at merge time. Nothing about
  the duplication was detectable from the branch.

  **The auth screens needed more than the column, and they are the only ones
  that did.** The column kept the sign-in form at a readable 600 — nothing
  stretched — but an auth screen is a full-height column by construction, so at
  1280 it read as a coral band the width of the window with a 58px mark alone
  in it, and a form pinned to the top of an empty page. From `lg` up, Welcome
  and the four password screens are now **two full-height halves of the
  window**: brand on the left, form on the right, which is the shape every web
  sign-in has.

  It was a centred 960px card for an hour first, and that is worth keeping
  written down: a card floating in the middle of a 1920px window is a **dialog**,
  and signing in is not a dialog interrupting something — it is the page. What
  survives from that attempt is the rule underneath it: the panes are full-bleed
  but their contents are not, so each centres a **420** column and a half-window
  pane never means a 960px-wide form.

  The brand pane reuses Welcome's own mark and copy — no new i18n keys — and
  carries `CatHappy` from the motion kit, directly above the family faces so the
  cat reads as being with them. That is a deliberate reading of the kit's rule
  (`motion/README.md`: one-time emotional moments, never chrome, never daily
  actions), on the grounds that this pane is the app introducing itself and is
  neither of those. The header goes, because a full-width bar carrying one back
  arrow above two full-height panes belongs to neither; back sits absolutely at
  the form pane's top-left so it cannot pull the form off centre. The footer is
  **not** pinned — `FormScreen` pins it for the software keyboard, and a
  physical keyboard covers nothing.

  Below `lg` nothing changes, which matters: a centred, shrunken Welcome card
  was tried and reverted on 2026-08-21, and this applies only where there is a
  pointer and 1024px. It is opt-in per screen (`FormScreen variant="auth"`),
  because the same shell around "New family" or "Change password" would be a
  different mistake.

  A **right-hand column** (Instagram has one, Threads does not) was considered
  and **deferred** — it needs a decision about what belongs in it, and moving
  Home's occasion widget and recommendation shelf out of the feed changes the
  phone layout too. Tracked as § 1.8 in the sprint.

  Still open: the content column may want to be 640 rather than 600 (to be
  judged in a browser, not argued), and the three grids whose column count or
  pixel heights are fixed (`recommendation-grid` 212/101, `photos-row` four
  across, `album-grid` two). Also unverified, and worth repeating: **nobody
  has looked at any of this in a browser yet** — typecheck, prettier,
  `check:i18n` and a web export are clean, and a prerender reports a width of
  zero, so the export exercises the phone path only. It proves the bundle
  builds and every module evaluates. It proves nothing about the rail.

- **A pass over the shell, and notifications (2026-08-21).** Four things,
  all of them about the app looking like one app:
  - **Headers are one thing now.** `ScreenTitle` in `header-slots.tsx` is
    used by all 23 headers plus `FormScreen`, and the wordmark carries the
    app mark. The **bell is self-contained** — it reads its own unread count
    and routes itself, so a screen adds it by writing it, not by wiring it —
    and it sits on Home, Omoide, AI and other people's profiles.
  - **Screen 19 (Notifications) is wired**: cursor-paginated list, unread as
    a row tint rather than a dot, tap marks read _then_ navigates. A row with
    nowhere to go is not pressable. Gap reported below: post notifications
    carry `actorUserId` and no name, so they read "somebody commented".
  - **Toasts** (`components/ui/toast.tsx`): one at a time, success and
    failure alike. The app previously completed a save in total silence.
  - **Avatars appear everywhere a person does** — feed, post detail,
    comments, tree nodes, member sheet, Settings — closing sprint 3.4.2 on
    the UI side. Details and the one limit (the active family) in
    `architecture.md` § Avatars.
  - **Google sign-in works again.** The server's OAuth callback now redirects
    with the tokens in the fragment, so the buttons have something to do; web
    only until somebody registers a deep-link scheme for native.
  - **Home's group strip was rebuilt** after three attempts, and the lesson
    was that the problem was never contrast: the only way into the family
    tree was the feed's first row and scrolled away on the first flick. It is
    now pinned and condenses as you read, with the swipe cue fading out
    beneath it. Full write-up in `design-system.md` § Group strip.

  Two designs were tried and reverted the same day, both recorded in the code
  next to what replaced them: the viewer's photograph in the bottom bar's
  last slot (a face among four line drawings stops reading as a fifth
  destination), and a centred, shrunken Welcome card (the coral header is
  meant to _stretch_, not float).

  A third was reverted the same day too, and this one is worth naming:
  **the bottom bar's labels were removed and then put back**. "The icons
  carry it" was borrowed from apps whose icons everybody already knows, and
  was never checked against _these_ icons — a clock for 思い出 and a sparkle
  for the AI tab carry nothing. The `design-system.md` spec had labels all
  along, so dropping them was a silent deviation from it, which is how it
  went unnoticed. The bar also grew from 58 to 68px and floats 20px up
  rather than 10.

- **Frontend state re-verified against the code (2026-08-20).** Everything
  the server offers is now wired: auth including password reset, Home
  (families, feed, and the special-date widget), create-or-join family, the
  family tree with per-spot invitations and pinch/pan, New moment with member
  tagging, post detail, Omoide, the whole Life Profile (identity, timeline,
  gallery, memos), personal albums, and the invitation page. **The only
  fixtures left are the AI screens' seed data** (2026-08-21). Home's
  recommendation shelf still has no endpoint, but it stopped being a fixture
  on 2026-08-20: it is derived from the family's own posts and albums. Per-screen detail:
  `docs/01-frontend/architecture.md` § Wiring status.
- **Sprint 1 is one task from done (2026-08-20).** 1.1.9 (Facebook login) is
  blocked twice over: the OAuth callback cannot return tokens to the app, and
  the Meta tester invite is unaccepted. 1.2.4 (empty/loading states) is ours
  and small — `app/memo/[id].tsx` and `app/memo/edit.tsx` have no error
  state; the AI and video screens' gaps were closed 2026-08-24 (see below).
  "Fix lỗi chính" is the remaining sweep.

- **AI-screens UX pass (2026-08-24).** All five AI surfaces (hub, gift ask,
  gift results, message, card) plus video setup/story got the missing
  error/empty/loading states, driven by a 7-persona audit and an adversarial
  review (21 findings fixed). The through-line: no AI failure is silent any
  more — every mutation surfaces `InlineError` (new shared component) with a
  retry, a 503 `AI_UNAVAILABLE` now reaches screens as `ApiError.code` /
  `.isAiUnavailable` and reads as "AI is off", and a failed regenerate keeps
  the previous results on screen instead of destroying them. Also: message
  source chips resolve real evidence via the existing `/evidence` route,
  cards can be saved to the device and the shared post opened, over-limit
  messages are counted and blocked before the server truncates them, the
  card renderer skips the salutation for empty names (server + preview now
  agree), `budgetLabel(0, n)` no longer halves the price floor server-side,
  and the video storyboard request stops hardcoding `locale: 'ja'`.
  **One recorded decision was overridden**: the selected `Pill` is now
  coral-tint + deep-coral text (4.6:1) per design-system contrast rules,
  replacing solid coral + white (2.4:1, Sơn's 19/08 call) — ratify or revert
  in `src/components/ai/pill.tsx`. Verified: mobile tsc, api tsc/lint/build,
  check:i18n (719 keys), prettier on touched files, Metro web bundle, live
  card render. Left for the backend owner: per-variant labeled evidence refs
  for messages, localized card salutation (PNG still draws English "Dear"),
  toName/fromName DTO cap 40 vs 100-char names (mobile clamps for now),
  thumbnails on `GiftSource`, splitting video create+render (ghost PENDING
  jobs on render failure), and `mock.py` ignoring `locale`.
- **Four bugs found by hand in one sitting (2026-08-20)**, all of a kind the
  app should catch itself: a catalogue key printed raw under somebody's name
  (`family.relation.parent` — the field was called `relation` and documented
  as translated, and was neither), a `<button>` nested in a `<button>` from a
  modal scrim wrapping its own dialog, two `Modal`s presented on the same
  tick and overlapping, and reactions drawn twice in two different shapes.
  All fixed; a static scan for the nested-button case now exists. The lesson
  is that the misleading _name_ hid the first one through several readings.
- **The stack table listed three libraries that are not installed
  (2026-08-19)** — `@gorhom/bottom-sheet`, `d3-hierarchy`, and
  `react-hook-form`+`zod`. Sheets are a plain `Modal`, the tree layout is
  authored by hand in `tree-layout.ts`, and the forms use `useState`; the
  last one was a deliberate decision recorded below. `architecture.md` now
  says so rather than reading as a list of things already present.
- **Frontend platform switched to Expo (2026-08-17)** — see Important
  Decisions. Done: docs realigned, `packages/tokens` rebuilt,
  `apps/mobile` on Expo SDK 57, Inter/Lora, design-system primitives, app
  icons, and **the whole first-pass screen set against mock data**
  (2026-08-18) — all eight items in the `architecture.md` build order:
  **Home** (`app/(tabs)/index.tsx`), **Family tree** (`app/family/index.tsx`),
  **Life Profile** (`app/member/[id].tsx`) and the **Profile tab** sharing
  one body (`components/member/profile-body.tsx`), **New moment**
  (`app/(tabs)/new.tsx`), the **invite sheet** + **pending spot state** on
  the tree, and the **Invitation page** (`app/invite/[code].tsx`).
  Verified: `tsc --noEmit` clean, prettier clean, and a static web export
  prerendering all 16 routes with the expected copy and no nested
  `<button>`.
- **Second mobile pass done (2026-08-18)**: **auth** — Welcome, Sign in,
  Create account, Verify (6-digit code) and a three-step password reset,
  behind a mock in-memory session gate with Sign out in Settings; and
  **AI** — the calendar hub on the AI tab plus Gift ideas
  (`app/ai/gifts.tsx`). Profile hero reworked: "Add memory" removed and
  Edit moved to a badge on the avatar. Verified the same way — typecheck,
  prettier, 27-route static export grepped for content, and no nested or
  interactive-in-`<button>` markup. Those screens have since been wired one
  at a time — see `docs/01-frontend/architecture.md` § Wiring status for
  where that stands.
- **Deferred on the mobile app**: pinch-to-zoom / drag-to-pan on the family
  tree (the zoom buttons cover the same ground for now; needs
  `react-native-gesture-handler`), the web invite-acceptance page for
  someone without the app, which waits on the `apps/web` decision, and the
  remaining AI screens (Memory video, Surprise plan, Occasions list,
  Reminders, Add occasion — mockups 9c–9g).
- **Home is still styled with `StyleSheet`.** NativeWind arrived after it
  was written; converting it is a mechanical follow-up, not a rewrite.
  New screens use NativeWind.
- **API integration foundation landed (2026-08-18)**: real session on
  `expo-secure-store`, refresh-on-401 behind a single-flight gate,
  `QueryClientProvider`, and hooks for families / family tree / family
  feed. **Wired 2026-08-18**: Sign in, Create account, Home, create-or-join
  family, the **family tree** (read plus adding a member), **New moment**
  (pick media → upload → post), and a **moments list + post detail** with
  comments and reactions. Life Profile, Omoide and the AI tab still read
  `src/fixtures/` — per-screen status is in
  `docs/01-frontend/architecture.md` § Wiring status.
- **Client mirror caught up with PRs #7–#9 (2026-08-18)**: `types.ts` and
  `endpoints.ts` had fallen behind the ten routes those PRs added.
  `PostDetail` gained `commentCount` / `reactionCount` / `myReaction`, and
  comments, reactions and profiles now have endpoint groups. Replayed
  against a running server, including the case the optimistic reaction
  update depends on: changing LIKE to LOVE replaces the reaction rather
  than adding one.
- **`expo-image-picker` added (2026-08-18)** — the last thing standing
  between New moment and a working end-to-end post.
- **Sprint 1 stands at 30 of 39 tasks (2026-08-19; was 24/38 on
  2026-08-18 — 1.4.4 was added since).** One more (1.6.7, personal
  albums) lands with the open `feature/album` PR. **The backend side of
  the sprint is finished**: every remaining unticked item is UI wiring
  (1.1.7 reset screens, 1.2.5 widget, 1.6.1–1.6.3 Life Profile — all
  their endpoints exist), finishing 1.2.4's empty states, verifying
  Facebook E2E (1.1.9, needs the Meta tester-role invite accepted), and
  the 1.7 stabilization pass.
- **Two gaps in the sprint plan itself**, both worth a team decision rather
  than a silent fix:
  1. **Apple Sign In has no task.** It was decided on 2026-08-18 and is
     mandatory on iOS once any other third-party login ships, but 1.1.8 and
     1.1.9 cover only Google and Facebook.
  2. **Task 1.5.3 is marked backend-only** ("preview thuộc UI 1.5.1") while
     1.5.1 is described as "nhập nội dung". The media picker fell between
     the two; it was built on 2026-08-18 under 1.5.1, but the WBS should
     say who owns it.
- **Nothing has been run on a physical device yet.** Every ticked frontend
  task was verified by typecheck, prettier, `check:i18n`, a static export,
  and replaying the endpoints against a running server — not by a person
  using the app. The picker, blur, sheets and gestures only tell the truth
  on hardware (`docs/04-devops/mobile-development.md`).
- **Four blocking questions answered 2026-08-18** — see Important
  Decisions: solar-only stands, Apple joins Google and Facebook, Home gets
  a skippable empty state, kinship labels stay at the base relationships.
- **DB design finalized at sprint 0 (2026-08-14)**: full-MVP design — 25
  tables, 2 ER diagrams, decision log — in `docs/02-backend/database.md`;
  domain decisions recorded in `docs/00-shared/domain-model.md`. Team
  should ratify the day's decisions and sanity-check Sprint 1's added
  tasks (1.1.7, 1.2.5, 1.5.6–7, 1.6.7–8; 1.6.6 dropped), then decide when
  Sprint 1 starts. Next code step: `schema.prisma` + first migration.
- Scheduling gaps flagged in `mvp-scope.md` (items IN scope but not in any
  sprint: LINE + X social login (deferred — see Important Decisions), time
  capsule, auto albums, automatic interest analysis) — schedule or defer
  before release. Google + Facebook login scheduled 2026-08-17 as tasks
  1.1.8–1.1.9. Milestone timeline was scheduled 2026-08-14 as task 1.6.8.
- Remaining domain questions (`docs/00-shared/domain-model.md`): leave
  semantics, time-capsule unlock semantics, "plan a surprise" data
  sources (manual context vs availability/address data).
- **Invites are family-wide, but the tree design assumes per-person
  invites** (2026-08-17). `design-system.md` says a tree spot is reserved
  when an invite is sent and falls back to Empty if it is cancelled or
  expires — but `Family.inviteCode` is one permanent code for the whole
  family, with no record of who was invited to which spot. The `Pending`
  node state therefore cannot be told apart from an ordinary placeholder.
  Decided 2026-08-17 that the UI leads and the backend follows.
  **Resolved on the UI side 2026-08-18** — the invite sheet now defines the
  shape the backend has to grow into; see Important Decisions.
  **Backend done 2026-08-19** as task 1.4.4 (branch
  `feature/per-spot-invitations`) — `Invitation` model + endpoints, tree
  nodes carry `pending`; see `api-contract.md` → Invitations.
  **Closed 2026-08-19** — the invite sheet, the pending banner and the
  acceptance page all run on it.

## For the backend owner

Raised by the frontend, neither actionable from `apps/mobile`.

- ~~**Social login cannot finish in the app (2026-08-20).**~~ — **closed
  2026-08-21.** The callback now redirects to an allow-listed app URL with the
  token pair in the fragment (`OAUTH_APP_REDIRECTS`, exact-match), and failure
  redirects too, carrying `email_taken` / `rejected` / `incomplete` /
  `failed`. **Google is back on Sign in and Sign up** behind
  `features/auth/use-social-login.ts` + `app/auth/callback.tsx`. Web only:
  `SocialButtons` renders nothing on native, because the native side needs a
  deep-link scheme nobody has registered yet. Facebook stays blocked on the
  unaccepted Meta tester invite (task 1.1.9), not on us.

- ~~**Avatars have columns and no endpoints (2026-08-19).**~~ — **closed on
  both sides.** The server landed `avatarMediaId` on `UpdateProfileDto`
  2026-08-20, exactly as asked, and widened `MediaService.canView` so an
  avatar is as visible as the person. The app wired it 2026-08-21: a camera
  badge on your own face, and the picture drawn everywhere a person appears
  (`architecture.md` § Avatars).

- **Nobody can moderate a comment (2026-08-21).** `PATCH` and `DELETE` on
  a comment are author-only, so a post's author cannot remove a comment left
  on their own moment, and there is no hide, no report and no block. For a
  family album that is probably the right default — but it means the only
  remedy for something upsetting is asking the person who wrote it. Worth a
  product call before release rather than after. The app now offers edit and
  delete on your own comments and nothing else, because nothing else exists.

- **Removing a member has no admin and no floor (2026-08-21).** Read while
  wiring the delete UI, not a bug report — the rule may well be deliberate,
  but it is not written down anywhere and the app now depends on it.
  `removeMember` lets any member delete a **placeholder** and lets a **linked
  member delete only themselves**; there is no way to remove somebody else who
  has an account. So the product has _leave_, not _kick_. `Family.createdById`
  exists and confers nothing. Two questions:
  1. Is "no kick" intended? If a family ever needs to remove an account
     holder — a wrong invite accepted, somebody who should not be there — the
     only route today is asking them to leave.
  2. **Nothing stops the last member leaving.** `removeMember` does not count
     what remains, so a one-member family can empty itself: the `Family` row
     survives with zero members, `requireMembership` then refuses everyone,
     and its posts and media are unreachable but not deleted. A guard, or a
     documented cascade, would settle it.

  The app mirrors the current rule and adds one of its own on top: it will not
  remove anybody with children below them, because what happens to
  relationships routing through a removed person is still an open domain
  question. See `apps/mobile/src/features/family/member-permissions.ts`.

- **Three gaps found building the Life Profile against mockup 7
  (2026-08-19; status re-checked against the code 2026-08-20).** Written up
  in full in `docs/00-shared/api-contract.md` § Requests from the app.

  1. ~~A member's media can only be found by paging the whole family
     feed~~ — **closed on both sides**: the server landed
     `GET /me/gallery` + `GET …/members/:memberId/gallery` (task 1.6.4,
     PR #19) and `?memberId` on the family feed (task 2.1.2, PR #22), and
     **the app switched to the gallery route on 2026-08-19**, dropping its
     bounded 200-moment scan.
  2. ~~`LifeProfile` has no `occupation` and no `birthPlace`~~ — **done
     2026-08-20**, migration `20260820031808`. Both are on
     `ProfileDetail`; the app has not read them yet.
  3. `PostMediaSummary` has no duration — **still true**, so a video tile
     says "Video" where the mockup shows a running time. Note this is not
     just a column: reading a duration server-side means probing the file
     (an ffmpeg/ffprobe dependency), so the cheaper path is the client
     sending it at upload, consistent with the existing "client-declared
     MIME type is trusted for now" decision. Worth deciding before doing.

  Neither remaining gap blocks a screen — the app ships without them and
  says on screen what it does not know.

- **Profile editing: half of this was already true on the server
  (2026-08-19; corrected 2026-08-20 after reading the code).** The app
  draws the Edit affordance only on your own profile: a life story written
  about someone by someone else is a different object from one they wrote
  themselves, and the screen could not tell the reader which they were
  reading. **The original note here said "the server has not changed" —
  that was wrong.** `ProfileService.resolveForMember({ forEdit: true })`
  already throws `403 Linked members manage their own profile content`, so
  `PATCH /families/:familyId/members/:memberId/profile` on a member **who
  has an account** is owner-only and has been since the route shipped
  (task 1.6.2). The app and the server agree there.

  What is left is **placeholder** profiles, and narrowing those is not a
  fix — it contradicts a recorded decision. A placeholder has no account,
  so "only the owner may edit" would mean **nobody** may ever edit, while
  `domain-model.md` (2026-08-13) says placeholder profiles are
  wiki-editable by any family member with no manager ACL in the MVP. That
  is also the only way a deceased or elderly relative's profile gets
  written at all.

  **So the real question for the team is narrower than it looked**: should
  the app offer Edit on a _placeholder_ profile? The wiki rule says yes;
  the app currently says no, which leaves placeholders un-editable from the
  UI even though the server allows it. Decision recorded in
  `docs/01-frontend/architecture.md` § Life Profile; reversing it on the
  client is one function (`features/member/member-profile.ts` →
  `editability`).

- **Comment moderation is decided for now, but the permission is in the
  wrong place (2026-08-18).** Only a comment's author may edit or delete it;
  the post's author has no moderation power. That is accepted for the MVP —
  this is a family, not a public forum. The problem is that
  `CommentSummary` carries no permission flag, so the app decides what to
  render by comparing `authorUserId` against the signed-in user. The rule
  now exists in two places, and the day the server relaxes it the app will
  keep hiding a button the server would allow — or show one that 403s.
  **Asked for**: `canEdit` / `canDelete` on `CommentSummary` (and the same
  on `PostDetail` while the shape is being touched). The app then draws
  what it is told and never has to change when the rule does.
  — done 2026-08-19 (branch `fix/backend-owner-requests`): both shapes
  carry `canEdit`/`canDelete` (author-only today), see `api-contract.md`;
  verified by live smoke test with two users.
- **CORS is pinned to fixed ports and will break again (2026-08-18).** The
  allowlist in `apps/api/src/main.ts` names `http://localhost:8081` and
  `:19006`. Metro moves to the next free port whenever 8081 is taken, so a
  second dev server puts the app on `:8082` and every request fails
  preflight. It has already happened once. **Asked for**: in development,
  accept any `http://localhost:<port>` / `127.0.0.1` origin via an origin
  callback instead of a fixed list; production stays closed by default,
  since the product client is native and sends no `Origin`. Note also that
  the CORS code itself was written by the frontend session and rode in on
  commit `e895259` on `ui-sprint2` — it has not been reviewed by whoever
  owns `apps/api`.
  — done 2026-08-19 (branch `fix/backend-owner-requests`): dev now matches
  any `http://localhost:<port>` / `127.0.0.1` origin (regex, equivalent to
  the callback asked for); `CORS_ORIGINS` override and closed-by-default
  production kept. Backend review of the frontend-written CORS code done in
  the same pass — no other issues found. Verified by live preflight tests.

- ~~**A saved life event's photos cannot be changed (2026-09-03).**~~ —
  **done the same day, and done in `apps/api` by the frontend session on the
  owner's explicit instruction ("b sửa nốt giúp tôi cái chỉnh sửa ảnh
  timeline đi"), which crosses the standing rule that this list is for things
  the frontend does NOT touch. Flagged loudly for that reason: the API half
  wants a review by whoever owns `apps/api`.** Option 1 below is what
  landed — `mediaIds` accepted on PATCH as a full replacement. Details in
  `api-contract.md` § Life events → Media; the original request is kept
  below because the reasoning still explains the shape.

The endpoint was exercised by the owner on a running stack ("t test thấy
ổn rồi") but is **not covered by an automated test**: `family-edit`,
`special-dates` and `ai-video` all state they need a **LOCAL** Postgres
and never Neon, and `apps/api/.env` points at the shared Neon database,
so running them would write test rows into the team's data. A spec for
the media-replacement path — add, remove, files unlinked, `EditHistory`
carrying `mediaIds` — is what this still owes.

The original request follows.

- **A saved life event's photos cannot be changed (2026-09-03).** Asked for
  by the owner — "chức năng sửa timeline đang không cho sửa ảnh, nên có chức
  năng cho xoá or thêm ảnh" — and **not doable from `apps/mobile`**:
  `UpdateLifeEventDto` is `PartialType(OmitType(CreateLifeEventDto,
['mediaIds']))`, deliberately, with the note "Media is fixed at creation
  (same rule as posts)". There is no attach, no detach, and `MediaController`
  has no `DELETE`, so neither adding nor removing is reachable by any
  sequence of calls the app can make. The edit sheet says so today rather
  than drawing a picker that lies ("photos can't be changed after saving").

  **Asked for**, either one:
  1. `mediaIds` accepted on `PATCH .../life-events/:eventId` as a full
     replacement — an array replaces the set, omitted leaves it alone, the
     same "only an array replaces" rule `taggedMemberIds` already follows on
     that DTO. `attachMediaInTx` and `assertAttachableMedia` already do the
     ownership checks this needs.
  2. Or `POST`/`DELETE .../life-events/:eventId/media` if a replacement is
     the wrong shape for edit history.

  Worth deciding alongside the same restriction on posts, since the rule and
  the reason are shared. The one-parent CHECK on `Media` is not the blocker:
  a photo moving _into_ a life event has no other parent, and detaching means
  deleting the row, not reparenting it. The app side is small once either
  exists — the sheet already stages `DraftMedia` and `uploadDrafts` is shared
  by every media-carrying feature.

- **Creating a family is three sequential round trips (2026-09-03).** Not a
  bug, and not urgent — recorded because the owner asked why it feels slow
  and the answer is mostly geography. Measured from a dev machine: a trivial
  `SELECT 1` against Neon has a **median round trip of 164 ms** (warm pool;
  1 164 ms to open a cold connection). `createFamily` then does
  `requireUser` → `generateInviteCode` (a uniqueness `findUnique`, in a
  retry loop) → `family.create`, each awaiting the last, so the request
  cannot finish in under ~490 ms of pure database wait however fast the
  server is. The client half was worse and **is fixed** (see In Progress:
  the submit button was also waiting on a refetch). If this ever needs to be
  faster: the invite-code check is the cheapest to remove — mint the code and
  let the `@unique` constraint reject a collision on insert, retrying only
  on the P2002, which replaces a guaranteed round trip with one that
  essentially never happens.

## Completed

### Setup Phase

- Monorepo setup (pnpm workspace)
- Next.js + Tailwind CSS bootstrap (`apps/web`)
- NestJS bootstrap + bug fixes (`apps/api`)
- PostgreSQL via Docker Compose — now the **opt-in local** option; the team
  database moved to Neon Cloud on 2026-08-26 (see Important Decisions)
- Prisma ORM (schema, migration, CJS-compatible generated client)
- ESLint + Prettier
- Husky (`pre-commit` + `commit-msg`/commitlint)
- Documentation structure scaffolded (`docs/00-shared`, `01-frontend`,
  `02-backend`, `03-ai`, `04-devops`)
- One-shot machine setup: `pnpm bootstrap` (`scripts/setup.mjs`) — env files,
  Postgres, migrations, Prisma client; since 2026-08-26 it reads
  `DATABASE_URL` first and starts Docker only for a local host
- `pnpm-lock.yaml` now committed (was gitignored); stray nested workspace in
  `apps/web` removed

### Sprint 1

- Full-MVP Prisma schema: 25 models + migration
  `20260814063321_full_mvp_schema` (incl. 3 CHECK constraints) — merged to
  `main` in PR #1 (2026-08-14). Task 1.3.1 done.
- AuthModule: register / login / refresh (single-use rotation) / logout,
  global JWT guard + `@Public`, Swagger at `/api/docs` — merged to `main`
  in PR #2 (2026-08-17). Tasks 1.1.2 / 1.1.3 / 1.1.5 / 1.1.6 done.
- Password reset API (2026-08-18): request/verify/confirm with an
  emailed 6-digit code — 15-minute expiry, 5-guess cap (new `attempts`
  column, migration `20260818073348`), single-use, revokes every
  session on success. Task 1.1.7 done, merged to `main` in PR #12;
  details in `api-contract.md`.
- FamilyModule: create family + invite code, join via code (incl. linking
  an account to a placeholder member), placeholder member CRUD,
  relationships CRUD, membership-based authorization — merged to `main`
  in `107acb1` (2026-08-17). Tasks 1.3.3–1.3.6 done; verified by
  format/lint/build/test + 20-step live smoke test. Assumptions to confirm
  with the team: linked members' info is editable/removable only by
  themselves (placeholders stay wiki-editable); "add member with account"
  happens via invite-code join rather than direct add.
- Family tree API: `GET /api/families/:familyId/tree` — member nodes +
  relationship edges in one payload for the tree screen (2026-08-18).
  Task 1.4.1 done; verified by lint/test/build + live smoke test
  (200 with nodes+edges / 401 unauthenticated / 403 non-member).
  Merged to `main` (2026-08-18) — closes the "no GET for relationships"
  gap flagged by the mobile API-contract pass.
- Post + Media modules (2026-08-18): `POST/GET/PATCH/DELETE /api/posts`
  (author-only edit/delete, EVENT requires title+date — content optional
  for events, visibility via `familyIds` — empty = private, tags must
  stay inside the shared families, private content returns 404 to
  non-viewers on every verb) + StorageService (local disk, `UPLOAD_DIR`,
  swappable for S3 later; uploads stream to a temp file, never buffered
  in memory) + `POST /api/media` and `GET /api/media/:id` (authorized
  streaming with HTTP Range/206 for video/audio playback). Uploads
  accept photo/video/audio per the MVP memory scope
  (jpeg/png/webp/gif/heic; mp4/mov; mp3/m4a/aac/wav) with a single
  100MB limit for every type (decided 2026-08-18). Tasks 1.5.2–1.5.5
  done. Verified by lint/build + manual live smoke tests (authorization
  matrix, Range, date-validation and ex-member cases); **no automated
  tests for these modules yet** — the jest suites are still the NestJS
  scaffold specs. Code-review round 2026-08-18 (9 review agents, 17
  findings): critical fixes applied — PATCH re-checks current
  membership (ex-member loses write access but can still un-share),
  PATCH/DELETE return 404 like GET for non-viewable posts (no existence
  oracle), `eventDate: null` and invalid ISO dates rejected as 400
  (were silent 1970-01-01 / 500), upload cleanup when the DB insert
  fails. Deferred to a follow-up branch before 1.5.6–7: dedupe
  canView/membership helpers, `UpdatePostDto` via PartialType, response
  shape hiding cross-family ids from non-authors. Merged to `main` in
  PR #5 (2026-08-18). Assumption to confirm: media set fixed at post
  creation (edit changes text/visibility/tags, not attachments).
- Life Profile API (2026-08-18): `GET/PATCH /api/me/profile` +
  `GET/PATCH /api/families/:familyId/members/:memberId/profile` — the
  display rule from domain-model.md (linked member → global profile,
  placeholder → family-local wiki profile), wiki editing by any family
  member for placeholders (linked profiles are owner-only), every edit
  logged to `EditHistory` with editor + snapshot, `updatedById`
  stamped. Fields: bio, interests (string list), birthDate/deathDate
  (strict ISO, death ≥ birth) — the single source the 1.2.5 widgets and
  Sprint-3 reminders derive from. Task 1.6.2 API side done; verified by
  lint/build + 11-case live smoke test incl. EditHistory rows in the
  DB. Merged to `main` in PR #9 (2026-08-18).
- Special-dates widget API (2026-08-18):
  `GET /api/families/:familyId/special-dates` — upcoming occasions for
  the family-home widgets (task 1.2.5 API side), soonest first, from
  both sources in `database.md`: birthdays/memorials derived from
  LifeProfile dates (no rows stored; deceased members get a memorial
  only — assumption to confirm) plus stored `SpecialDate` rows (CRUD
  stays in Sprint 3 task 3.2.3). Returns type/month/day/originYear/
  ordinal/theme/nextOccurrence/daysUntil/members; derived items carry
  no display text — the client labels them (i18n). Verified by
  lint/build + live smoke test (today-edge, ordinal, deceased rule,
  custom row, limit validation, 403). On branch
  `feature/special-dates`, uncommitted.
- Comments + Reactions API (2026-08-18): CRUD
  `/api/posts/:postId/comments` (oldest first, cursor-paginated; anyone
  who can view the post comments, only the comment author edits/deletes
  — post-author moderation is an open product call) and
  `PUT/DELETE /api/posts/:postId/reactions/me` (one reaction per user
  per post, upsert to change type, idempotent delete). `PostDetail`
  gained `commentCount` / `reactionCount` / `myReaction`, so feed cards
  and the post-detail screen need no extra calls. Ships with the
  deferred cleanup: FamilyService now exports the membership checks and
  PostService exports `canViewPost`/`assertViewable` — MediaService and
  the new comment/reaction services delegate instead of copying the
  privacy rule; `UpdatePostDto` collapsed to
  `PartialType(OmitType(CreatePostDto, ...))`. Tasks 1.5.6–1.5.7 API
  side done; verified by lint/build + 16-case live smoke test. On
  branch `feature/post-engagement`, uncommitted.
- Family feed API (2026-08-18): `GET /api/families/:familyId/posts` —
  the family's shared posts, newest first, cursor-paginated (`limit`
  1–50 default 20, `nextCursor`), membership-based authorization;
  private posts never appear. Unblocks wiring the Home feed (1.2.3 —
  API side done, UI not wired). Verified by lint/build + live smoke
  test (ordering, pagination, 403 non-member, 401, limit validation,
  new-member visibility). On branch `feature/post-feed`.
- Per-spot invitation API (2026-08-19): `Invitation` model (migration
  `20260819021946`) + `POST/GET /api/families/:familyId/invitations`,
  resend, cancel, **public** `GET /api/invitations/:code` for the invite
  page, and `POST /api/invitations/:code/accept` (joins on the reserved
  spot via the same link operation as join-with-`linkMemberId`). Sending
  reserves the spot in one transaction (placeholder + edge + invitation);
  tree members now carry `pending`. 7-day expiry (derived `EXPIRED`, never
  stored), one live invitation per spot, cancel deletes an untouched
  placeholder so the node falls back to Empty. Task 1.4.4 done; verified
  by lint/build/test + 28-case live smoke test. On branch
  `feature/per-spot-invitations`. Details in `api-contract.md`.
- Life Event API (2026-08-19): Timeline milestones for the Life Profile —
  `GET/POST/PATCH/DELETE /api/me/life-events` +
  `.../families/:familyId/members/:memberId/life-events` (no new tables:
  `LifeEvent` shipped in the sprint-0 schema). Same rules as the profile
  it hangs off: linked → global timeline, placeholder → family-local
  wiki-editable, every PATCH logged to `EditHistory`. Media attach via
  `mediaIds` at creation (fixed after, like posts) and **streaming now
  follows profile visibility** — the MediaService "uploader-only until
  1.6.8" gap is closed by delegating to LifeEventService. Lists oldest
  first; tags replace on PATCH. Task 1.6.8 done — first of the three
  Life Profile tab unlocks (next: Memo 1.6.5, then gallery 1.6.4).
  Verified by lint/build/test + 29-case live smoke test incl. EditHistory
  rows in the DB. On branch `feature/life-events`. Also rides along:
  **main was broken** by a PR #15 conflict resolution leftover
  (`origin: origins` in `main.ts`) — `nest build` failed on main from
  merge `e33e8a8` until this branch's fix. Code-review round 2026-08-19
  (8 review agents): fixes applied — PATCH `title`/`eventDate: null`
  (were a 500 and a silent 1970-01-01), whitespace-only title, `eventDate`
  restricted to date-only `YYYY-MM-DD` (a `+09:00` datetime shifted the
  stored day), no-op PATCH no longer writes EditHistory. **Deferred to the
  Memo branch (1.6.5), which would otherwise copy them a third time**:
  extract shared media-attach + tag-validation + parseDate/normalizeText +
  best-effort file cleanup + a `ProfileService.resolveForMember` for the
  wiki rule; also known: a tag-write FK race returns 500 (same window
  exists in PostService).
- Memo API (2026-08-19): private notes about a member —
  `GET/POST /api/families/:familyId/members/:memberId/memos` +
  `GET/PATCH/DELETE /api/memos/:memoId`. Always author-only (decision
  2026-08-14): everything not yours 404s, memo media streams to the owner
  only. List is `updatedAt` desc (matching the memo UI), so a no-op PATCH
  does not bump it. **Schema: Memo grew `title` + `category`, `content`
  optional** (migration `20260819042417`, UI-led — see `database.md`
  Decision Log). Ships with the deferred dedupe now that a third consumer
  arrived: shared `attach-media` helpers (the one-parent rule's write
  side), `common/input.ts` (`normalizeText`, `parseIsoDate`) and
  `StorageService.removeAllBestEffort` — PostService, LifeEventService,
  ProfileService and MemoService all delegate. Task 1.6.5 done; verified
  by lint/build/test + 16-case memo smoke + 29-case life-event regression
  smoke. On branch `feature/memo-api` (stacked on `feature/life-events`).
  Code-review round 2026-08-19 (8 agents) — fixes applied: life-event
  tags scoped to the family being edited (were leaking cross-family
  member ids), `removeMember` now cleans up cascaded memo/life-event
  media files (were orphaned on disk), no-op PATCHes value-checked
  (retries no longer spam EditHistory / reorder memos), concurrent
  delete races return 404 not 500, profile `birthDate`/`deathDate`
  restricted to date-only (same +09:00 day-shift as eventDate), Media
  gained `memoId`/`lifeEventId` indexes (migration `20260819045211`),
  and the wiki rule + profile-content visibility moved to one home on
  `ProfileService` (`resolveForMember`/`canViewProfileContent`), tag
  boundary to `family/member-tags.ts`, media summary shape to
  `attach-media.ts`. The memo-cascade question was then **decided
  2026-08-19: memos survive member removal** — `aboutMemberId` SetNull +
  `aboutName` snapshot (migration `20260819052340`, backfilled so it
  deploys on non-empty tables), new `GET /me/memos` lists orphaned notes;
  verified by 22-case memo smoke incl. the survival path. Remaining note
  for the team: the earlier `title` migration (`20260819042417`) has no
  backfill — fine while every Memo table predates the API.
- Local DB backup/restore (2026-08-19): `pnpm db:backup` (pg_dump custom
  format into gitignored `backups/`) and `pnpm db:restore <file> --force`
  (mandatory flag — restore replaces the database). Deletes stay hard
  deletes in the MVP; a dump before risky work is the way back. Verified
  by a real backup→restore round-trip (row counts intact, API healthy
  after). See `docs/04-devops/local-environment.md` § Backup & restore.
- Video job API (2026-08-19, sprint 2, task 2.2.2): the backend half of
  video generation — `POST/GET /api/video-jobs` (+ `GET /:id` to poll)
  and the internal completion callback
  `POST /api/internal/video-jobs/:jobId/complete` for the AI team.
  Sources are any images the requester may view
  (`MediaService.assertViewableBatch`, the same gate as streaming, now
  exported and returning selection order — the frame order). A definite
  dispatch refusal rolls the job back and answers 503 `AI_UNAVAILABLE`
  (no orphan rows) while a **timeout leaves the job PENDING** — the AI
  service may have accepted and its callback completes it late.
  Code-review round 2026-08-19 (8 agents) — fixes applied same-day:
  `resultMediaId` FK (unique, migration `20260819090000`) replaces the
  unindexed non-unique storageKey lookup that was an N+1 and could
  resolve to another user's row; every status transition is a
  conditional `updateMany` so a fast callback can't be dragged back to
  PROCESSING and concurrent callbacks settle exactly once; the callback
  validates mimeType against the storage whitelist and **measures size
  from disk** (path escapes and ghost files are 400s); `error` +
  `resultPath` together is a 400; comments got their own
  `PaginationQueryDto` (sharing FeedQueryDto had made Swagger advertise
  Memories filters the comments route ignores); the Memories `?memberId`
  filter now matches any of a linked member's rows (same identity rule
  as the gallery) and reuses `findMemberInFamily` + `parseIsoDate`; and
  the date-only guard became one `IsDateOnly()` decorator (was 4
  copies). Known notes: `?from`/`?to` bucket by **UTC day**, consistent
  with Omoide's grouping but off-by-one for JST evening posts — team
  question; a feed `nextCursor` is filter-bound (reuse it only with the
  same filters). The result is registered as the requester's own
  standalone Media, so it streams privately with Range/206. Verified by
  lint/build/test + 22-case live smoke against a **mock AI service**
  (dispatch payload, failure
  rollback, auth matrix, DONE/FAILED paths, result privacy). On branch
  `feature/video-jobs` (stacked on `feature/memory-list`). Render itself
  is the AI team's — seam in `docs/03-ai/architecture.md`.
- Memory list API (2026-08-19, sprint 2, tasks 2.1.1–2.1.2): Memories
  reuse `Post` as designed — no new model; `GET /families/:id/posts`
  gained optional filters `?memberId` (tagged-in plus authored-by when
  linked; 404 outside the family), `?from`/`?to` (calendar days on the
  posted date, same grouping choice as Omoide) and `?type`. Filters
  combine and pagination is unchanged, so the Home feed path is
  untouched. Verified by lint/build/test + 13-case live smoke (filters,
  combinations, cursor pagination under filter, 400/404 matrix). On
  branch `feature/memory-list`. Details in `api-contract.md`.
- AI insight pipe (2026-08-19, sprint 2): the backend half of the
  two-phase photo pipeline — `MediaInsight` hidden store (migration
  `20260819071710`, table 26) + internal routes
  `GET /api/internal/ai/media/pending` and
  `PUT /api/internal/ai/media/:mediaId/insight` behind
  `X-AI-Service-Token` (timing-safe compare; user JWTs do not open them;
  unset token = 503 `AI_UNAVAILABLE`, core unaffected). Env
  `AI_SERVICE_TOKEN`/`AI_SERVICE_URL` added to `.env.example`. Verified
  by lint/build/test + 13-case live smoke (503 unconfigured, 401 matrix,
  pending→ingest→drop-out, upsert re-analysis, 404/400) + DB-level
  cascade check (delete photo → insight gone). On branch
  `feature/ai-insight-pipe`. Contract: `docs/03-ai/architecture.md`.
- Gallery API (2026-08-19): the Album tab, derived — `GET /api/me/gallery` +
  `GET /api/families/:familyId/members/:memberId/gallery`. No new
  table: media from posts authored by or tagged with the member, plus
  their life-event media, filtered to what the viewer may see (the same
  author/private/shared-family rule `PostService.canViewPost` applies
  elsewhere, batched into one membership query instead of one call per
  post — a code-review finding, fixed same-day). Not paginated, same
  choice as the life-event timeline. Task 1.6.4 done — **closes group
  1.6's Life Profile blocker**: About + all three tabs now have an
  endpoint; wiring is what remains. Verified by lint/build/test + 21-case
  live smoke test (own/tagged/private/life-event sources, cross-family
  isolation, placeholder scoping, stranger 403) + full life-event (29) and
  memo (22) regression smoke. On branch `feature/gallery` (stacked on
  `feature/memo-api`).
- Personal Album API (2026-08-19): `GET/POST/PATCH/DELETE /api/me/albums`
  - `POST .../items` / `DELETE .../items/:mediaId`. No migration — `Album`
  - `AlbumItem` shipped in the sprint-0 schema. Always private (never on a
    profile), items are the owner's own uploads only, an album is a second
    index onto media (not an exclusive parent — already-attached media can
    be added, one media can sit in many albums), add/remove are idempotent,
    cover must be an item and auto-clears when that item is removed,
    deleting an album never touches the media. Task 1.6.7 done — **group
    1.6 backend is now fully closed**. Verified by lint/build/test +
    19-case live smoke test. No UI exists yet (screens.md #11 sketches only
    a "choose album" step in Post a Moment). On branch `feature/album`
    (stacked on `feature/gallery`).

- Locale sent to the AI service is now validated (2026-08-20): `User.locale`
  is a plain nullable string with no column constraint, and
  `VideoJobService` forwarded it as `requester.locale ?? 'en'` — so the day
  a Settings screen writes `"ja-JP"` (or anything else) there, it would
  travel straight to FastAPI, whose contract names only `en`/`ja`/`vi`.
  Latent today because **nothing writes that column yet**; found while
  reviewing the AI proxy, fixed at the source instead. New
  `common/locale.ts` → `resolveLocale(...candidates)`: first supported
  value wins, a region subtag is honoured by its primary language
  (`ja-JP` → `ja`), anything unrecognised falls back to `en`. Verified by
  lint/build + **the repo's first service-level unit test**
  (`common/locale.spec.ts`, 6 cases) — jest already picked up `*.spec.ts`
  under `src/`, so no config change. **Note for whoever merges
  `feature/ai-suggestions`**: its `SuggestionRequestDto` declares its own
  `SUGGESTION_LOCALES` and its service repeats the same unchecked
  fallback — point both at this helper.

- LifeProfile gained `birthPlace` + `occupation` (2026-08-20): the two
  columns mockup 7's fact rows needed — the place after the birth date and
  "Carpenter, retired since 2021". Migration
  `20260820031808_add_profile_birthplace_occupation`, two nullable TEXT
  columns, **no backfill**, so it deploys on a populated table. Free text,
  max 200, cleared by `''`/whitespace/`null` like `bio`; both routes
  (`/me/profile` and the family one) carry them because they share one
  DTO. Deliberately **not structured** — `occupation` is a phrase, so
  nothing can derive "retired since 2021" from it; that would need its own
  field. Verified by lint/build/test + a 20-case live smoke test **plus a
  direct DB check of the `EditHistory` snapshots**, because that is the one
  place a new field can be forgotten with nothing failing. Two operational
  findings, written up in `04-devops/local-environment.md`: `prisma migrate
dev` **did not regenerate the client**, and the stale client survived
  lint, build and tests before 500ing on the first request — because an
  extracted `as const` select object escapes TypeScript's excess-property
  check. FE work remaining: read the two fields
  (`components/member/profile-facts.tsx`). On branch
  `feature/profile-facts` (stacked on `fix/backend-doc-accuracy`).

- Notification API (2026-08-20, sprint 3, WBS 3.1.1): in-app notifications
  for screen 19 — `GET /me/notifications` (cursor-paginated, newest first,
  `?unreadOnly`), `GET /me/notifications/unread-count`,
  `PATCH /me/notifications/:id/read`, `POST /me/notifications/read-all`.
  **No migration** — `Notification` shipped in the sprint-0 schema.
  Two design decisions worth keeping: **no create route** (a notification
  is raised by an event, never requested by a client — other modules call
  the exported `create`/`createMany`, which is how reminders in 3.2/3.3
  will make theirs), and **no display text on the wire** — only `type`
  plus a payload of ids, so the app writes the sentence. That follows the
  rule the special-date widgets already set, and it is what keeps Japanese
  copy out of the server. The list response carries `unreadCount` for the
  whole account, so the badge (3.1.4) and the list cannot disagree.
  Marking read is idempotent (the first `readAt` is kept). Verified by
  format/lint/build/test + a **26-case live smoke test** (paging across 25
  rows, badge vs page counts, per-user isolation with 404 not 403,
  idempotent read, read-all not touching another account).

  **Event triggers wired the same day** — a task the WBS never had, but
  without it screen 19 would have been built over an empty table.
  `NotificationEventsService` holds the rules (kept out of
  `NotificationService`, which stays a dumb store): a new post notifies
  the families it was shared to except the author, a tagged member gets
  `MEMBER_TAG` **instead of** `NEW_POST` rather than both, and a comment
  or a **first** reaction notifies the post's author. Three rules are
  enforced there and verified: a **private post notifies nobody**, you are
  never notified about your own action, and **changing a reaction raises
  nothing** (LIKE → LOVE → HAHA is one notification, not three — that
  needed an extra existence check before the upsert). Triggers are
  fire-and-forget on the same contract as `analyzePostInBackground`: a
  post is published even if writing its notifications fails. Verified by a
  further **13-case live smoke test** across four accounts (three in one
  family, one outside). **Invitations raise nothing** — the invitee has no
  account yet, so who `FAMILY_INVITE` is for is an open product question.
  On branch `feature/notification-api`.

- SpecialDate CRUD (2026-08-20, sprint 3, WBS 3.2.3 API side):
  `POST/PATCH/DELETE /families/:id/special-dates(/:id)` plus
  `GET .../custom` — the stored rows **with their ids**, which the merged
  widget GET (1.2.5) deliberately never carried, so the management side
  of screen 17 finally has something to edit. **No migration** —
  `SpecialDate`/`SpecialDateMember` shipped in sprint 0. Any family
  member creates/edits/deletes (no roles in the MVP; `createdById` is
  provenance, not ownership — same wiki spirit as placeholder profiles,
  noted as an assumption to confirm). Rules: month/day must be a real
  date, validated as the **resulting pair** on PATCH so changing only the
  month cannot leave Feb 31 behind; **Feb 29 stays legal** (display rolls
  it to Mar 1 in non-leap years, same as derived birthdays);
  `memberIds` must belong to the family and replaces on PATCH;
  `originYear: null` clears the ordinal; cross-family ids 404. Verified
  by lint/build/test + a **23-case live smoke test** (create→widget
  round-trip incl. ordinal, wiki edit by another member, date-pair
  validation, family isolation, delete removes it from the widget).
  Remaining in group 3.2: the reminder generator (3.2.2) that turns these
  plus profile dates into Notification rows, and the screen-17 UI. On
  branch `feature/special-date-crud`.
- Avatar API (2026-08-20, sprint 3, WBS 3.4.2 API side): the write the
  frontend asked for on 2026-08-19, in exactly the requested shape —
  `avatarMediaId` on `UpdateProfileDto` (both profile routes, so the wiki
  rule is the authorization), value stored into the existing
  `User.avatarKey` / `FamilyMember.avatarKey` columns as a **Media id**
  the existing `GET /media/:id` already streams. **No migration.** Read
  side: `ProfileDetail.avatarMediaId`, plus `FamilyMemberSummary.avatarKey`
  now **coalesces to the account's avatar for linked members** — one
  person, one avatar, every family, tree included. Two rules enforced:
  the photo must be the _editor's own uploaded image_ (400 otherwise, one
  message, no existence oracle — on a placeholder the editor and the
  subject differ, and pointing at somebody else's photo must not work),
  and **avatar bytes are as visible as the person**: `MediaService.canView`
  gained an avatar fallback, since a standalone upload used to stream
  uploader-only and everyone else's avatar would have 404'd. Clearing the
  avatar withdraws that widened visibility again. Avatar changes land in
  the `EditHistory` snapshot. No index on `avatarKey` — the lookup only
  runs after every parent check says no, on people-sized tables; add one
  if it ever shows up in profiles. Verified by lint/build/test + a
  **21-case live smoke test** (summary coalescing, visibility matrix
  incl. outsider 404 and clear-withdraws-access, steal/audio/ghost 400s,
  linked-profile 403, EditHistory in the DB). FE work remaining: upload
  button + reading the field. On branch `feature/avatar-api`.

- Reminder generator (2026-08-20, sprint 3, WBS 3.2.2): a twice-daily
  in-process job (`ReminderService`, plain `setInterval` + startup run —
  a cron package is not worth "twice a day") that turns LifeProfile
  birth/death dates and SpecialDate rows into Notification rows via the
  `createMany` the notification module exported for exactly this.
  **No migration, no dependency, no new route.** Lead times **7 days and
  day-of** — an assumption to confirm, nothing was written down; per-user
  tuning belongs to 3.4.5. Rules enforced and verified: nobody is
  reminded of **their own** birthday; a deceased member gets memorial
  reminders only; custom occasions notify the whole family including the
  people they are about; one reminder per person per occurrence per lead
  even across shared families. Idempotent by a `dedupeKey` in the payload
  (occasion + occurrence + lead) checked against the last 9 days — the
  same restart-safety contract as everything else, and the reason the
  smoke test could simply restart the API twice. Payloads carry ids +
  data snapshots (name, custom title), never composed sentences. Same
  calendar rules as the widgets (UTC days, Feb 29 → Mar 1) — the JST
  question applies here too. Known limit, same as the video renderer:
  check-then-insert means two instances could double-create; fine
  single-instance, noted for the scale-out day. Verified by
  lint/build/test + a **12-case staged smoke test** (seed → restart →
  assert → restart → assert-no-duplicates), counts exact per recipient.
  Group 3.2 backend is now **fully closed** (3.2.1 widget GET, 3.2.2
  reminders, 3.2.3 CRUD). On branch `feature/reminders`.

- Change password API (2026-08-21, sprint 3, WBS 3.4.3):
  `POST /auth/change-password` — requires the **current password even with
  a valid token** (an unlocked phone must not lock its owner out), applies
  the register password rules, and on success **revokes every refresh
  token then returns a fresh `AuthResult` for this device** — the person
  who changed it stays signed in, every other device is out, same
  session-ending contract as the reset flow. Social-only accounts (empty
  hash) get a clear 400 — "set a password" belongs to a future
  account-linking flow. No migration, no new module — one method in
  AuthService reusing argon2 + `issueTokens`. Verified by
  lint/build/test + a **13-case live smoke test** (two-device revocation
  matrix incl. the caller's own old pair dying, wrong/same/short password,
  social-only via a DB-forced empty hash).

  **WBS 3.3 (care reminder) suspended the same day** — the rule is
  defined nowhere and it is the most culturally sensitive feature in the
  sprint; question + proposal recorded in `domain-model.md` → Open
  Questions, section marked in `sprint-03.md`. The plumbing (3.2.2's
  `ReminderService`) is ready the day the team decides.

- Privacy settings API (2026-08-21, sprint 3, WBS 3.4.4):
  `GET/PATCH /me/settings/privacy` on a new `settings/` module (3.4.5
  will join it). **One flag, fully enforced**: `allowAiPhotoAnalysis`
  (default true, screen 20's "AI permissions") — turning it off removes
  the user's photos from the phase-1 pending feed at the only door photos
  leave through (`InsightService.listPending`), covers photos uploaded
  later, and **deletes every insight already extracted** from their
  photos; opting back in re-queues them, deleted insights stay deleted.
  This gives the recorded customer concern ("family photos leave the
  server for the Claude API — Japanese market, privacy-sensitive",
  `03-ai/architecture.md`) a real per-user answer. Stored as a partial
  object in the sprint-0 `User.privacySettings` Json column — defaults
  applied on read, **unknown keys preserved on write** so future flags
  survive old clients. The other three screen-20 items (sharing scope,
  profile visibility, archive access) are **deliberately not stored**: the
  archive is already private, the scope is chosen per post, visibility has
  no product definition — an unenforced privacy toggle is a lie the UI
  tells; recorded in the contract so nobody "completes" them as dumb
  storage. No migration. Verified by lint/build/test + a **14-case live
  smoke test** (default, opt-out pulls pending + deletes traces incl. a
  pre-existing insight checked in the DB, new uploads stay excluded,
  opt-in re-queues without resurrecting, unknown-key survival, non-boolean
  400). On branch `feature/privacy-settings` (stacked on
  `feature/change-password`).

- Notification settings API (2026-08-21, sprint 3, WBS 3.4.5 — **the last
  backend piece of sprint 3 outside suspended 3.3**):
  `GET/PATCH /me/settings/notifications` on the settings module. Three
  toggles grouped by _why you got it_ — `newPosts` (NEW_POST),
  `aboutMe` (COMMENT/REACTION/MEMBER_TAG), `reminders`
  (BIRTHDAY_/EVENT_/CARE_REMINDER) — all default true, stored in the
  sprint-0 `User.notificationSettings` Json column with the same
  partial-merge/defaults-on-read/unknown-keys-preserved conventions as
  3.4.4. **Enforced at the one funnel every notification passes through**
  (`NotificationService.create/createMany` →
  `SettingsService.filterAllowedNotifications`), so event triggers,
  reminders and any future caller respect the toggles without knowing
  they exist. Semantics chosen: **muting means the row is never created**
  (delivery is in-app only — a muted row would sit in the very list the
  user asked to quiet), so unmuting does not resurrect what was muted;
  FAMILY_INVITE/AI_SUGGESTION stay unmapped and always deliver rather
  than dying behind a switch nobody sees. No migration. Verified by
  lint/build/test + a **12-case live smoke test** (per-group isolation:
  muting newPosts still delivers MEMBER_TAG, muting aboutMe blocks
  comment/reaction/tag while another user still receives everything,
  unmute non-resurrection, privacy column untouched). On branch
  `feature/notification-settings`.

### Sprint 2 — AI team

- AI integration for screens 21-33 (2026-08-20, **merged to `main` in
  PR #25**): `apps/ai` (FastAPI, gpt-5.6-luna, structured outputs strict,
  `AI_MOCK=1` for token-free tests), NestJS `src/ai` (gift / message /
  card / evidence / two-tier profile pipeline: `InterestSignal` →
  versioned `MemberProfile`, rollup after every post) + `src/video`
  (storyboard + 0-token ffmpeg render: 6 intro styles, Ken Burns, music
  ducking under clip voices), and the full mobile flow (AI hub → gift
  ask/results/sources → message → card → video
  setup/photos/music/style/plan/making/done). Provenance is end-to-end:
  every suggestion cites `memo_…`/`sig_…` ids that resolve back to the
  real note or post.
- Perf + privacy pass (2026-08-20, on `merge/ai-integration` after
  PR #25 — PR pending): suggestion context narrowed to **the requester's
  own memos only** (buildFor, counters, past gifts, evidence resolution;
  cache keys carry the requester + a memo fingerprint), message
  suggestions cached like gift, ♡ rolls the profile up in the background,
  reasoning-effort tuned per feature, gift sources' labels built by code
  instead of the model, video segments rendered in parallel. Measured on
  real calls: gift 12.3s→~8-9s cold / 43ms repeat, message 3.6s / 38ms
  repeat, storyboard 11.1s→5.7s, render 49s→~25s — numbers and method in
  `docs/03-ai/architecture.md`. Verified: e2e 10/10 (real render),
  pytest, tsc/eslint/check:i18n clean. Sprint tasks 2.2.1–2.5.2 ticked
  in `sprint-02.md`; 2.6 (Quality Time) dropped 2026-08-20 (PR #28).

### Planning Phase

- MVP scope decided (`docs/00-shared/mvp-scope.md`)
- Screen inventory documented (`docs/01-frontend/screens.md`, 21 screens)
- Core domain decisions recorded (`docs/00-shared/domain-model.md`)
- Database designed for the **full MVP** — 25 tables, sprint-0 revision
  2026-08-14 (`docs/02-backend/database.md`)
- Backend architecture / auth decided (`docs/02-backend/architecture.md`)
- 3-sprint plan documented (`docs/sprints/sprint-01..03.md`)

## In Progress

- **⚠ Pulling someone else's schema change means regenerating the client
  (2026-09-02).** `apps/api/src/generated/prisma` is gitignored, so it is a
  per-machine build artifact that no `git pull` can update. A stale one does
  not warn: it fails as a wall of TypeScript errors claiming fields do not
  exist, which reads like broken code rather than a stale artifact.

  ```powershell
  pnpm --filter api prisma:generate
  ```

  The rule was already written down for the person _authoring_ a migration
  (`local-environment.md` § After changing `schema.prisma`), but not for
  everyone else pulling it — which is the common case, and the one that bit
  us: `c53a529` added five columns to `SpecialDate`, and `pnpm dev:api`
  answered with 14 errors about `ownerUserId`, `isLunar`, `repeatsYearly`,
  `year` and `remindDaysBefore` "not existing". Nothing was wrong with the
  code. If you see errors of that shape after a pull, run this before
  reading a single line of the source.

  The matching migration `20260901062532_extend_special_date_lunar_personal`
  had also never reached shared Neon, so the API compiled and then threw
  `DriverAdapterError: ColumnNotFound` at startup. Applied 2026-09-02 with
  `prisma migrate deploy` (additive only, `SpecialDate` was empty). Two
  separate faults with one symptom — a schema change needs **both** the
  database migrated and every machine regenerated.

- **⚠ Everyone has two scripts to run after pulling (2026-08-28).** Media
  moved into the R2 bucket, and photographs now have thumbnails. Both are
  shared, so what one person uploads serves the team — but only that person's
  machine can supply the originals it holds:

  ```powershell
  pnpm --filter api r2:migrate        # your originals into the bucket
  pnpm --filter api thumbs:backfill   # small copies for whatever that added
  ```

  In that order, and both are safe to re-run. **26 of 41 media rows were
  still unmigrated on 2026-08-28** — those photos are a 404 for everybody
  until the machine that holds them runs the first script. Full runbook:
  `local-environment.md` § Media storage.

- **Photographs are served small now (2026-08-28)**: the grid fetched the
  originals to draw 120pt tiles — PNGs averaging 1.7 MB, some 4.7 — which was
  most of why the app felt slow. Uploads make a 480px JPEG beside the
  original and `GET /media/:id/thumb` serves it, falling back to the original
  where none exists. Measured across the 89 photos stored: 78.0 MB of grid
  traffic became 2.6 MB. What remains is ~0.7s of R2 round-trip per picture,
  fixed whatever the size — presigned URLs or a CDN are what would remove
  that, deliberately deferred (owner's call, 2026-08-28: no real users yet).

- **Faces and cover tiles use the thumbnail too (2026-09-01)**: the switch
  above reached the photo grid but not `Avatar`, which still asked for the
  original — the three avatars stored average 584 KB, the biggest 1.59 MB, to
  draw a circle 38pt across. `imageThumbSource()` in `media-source.ts` is for
  a media the caller already knows is a picture (a face, a cover), so it goes
  straight to `/thumb` without inventing a mime type; it shares
  `thumbnailSource`'s cache key, so a face fetched for a grid tile is not
  fetched twice. Measured: 1 753 KB of avatars became 83 KB. It also picks up
  caching that was never there — `/thumb` sends `Cache-Control: private,
max-age=86400` while `GET /media/:id` sends none, so every screen change
  used to refetch the same face. Family and album covers moved with it; the
  full-size viewer and the AI card preview deliberately did not.

- **Facebook sign-in removed from the app (2026-09-01, owner's call)**: the
  button, its logo and its strings are gone, and three settings sentences no
  longer promise a way in that is not offered. **The server was left alone** —
  its OAuth route and `OAuthProvider` still name Facebook, so an account
  already linked through it would keep working. None is: every OAuth account
  in the database is Google (checked before removing).

- **Five task-completion toasts that were missing (2026-09-01)**: accepting an
  invitation, resetting a password, saving a note, deleting a note from a
  profile, and creating an album all finished in silence. Each had a sibling
  that already spoke — deleting a note toasted while saving one did not — so
  these close inconsistencies rather than add a new convention. Note that a
  toast fired in `onSuccess` must come **before** any navigation, and the
  screen must not unmount first, or React Query drops the callback and the
  toast never appears (`app/memo/[id].tsx` records that bug).

- **Omoide is two levels (2026-08-28)**: the tab lists families, each opening
  its own shelf at `/omoide/[familyId]` with a row of faces that opens one
  person's album — the photos they posted or were tagged in, which the server
  already assembled. It used to show only the active family, so somebody in
  three families saw a third of their pictures. A person's album is **not**
  scoped to the family it was opened from (owner's call): the viewer's own
  permissions are the limit.

- **The Album tab tells shared from private (2026-08-28)**: a post that
  reached no family is private to its author, which the schema already
  believed and nothing exposed — `GalleryMediaItem.shared` now says so. The
  grid filters on it and groups by day, and "add a private photo" opens the
  compose screen with every family unticked rather than a second uploader.

- **A milestone announces itself (2026-08-27)**: adding a life event also
  posts it as an EVENT, in the same transaction. Two owner's calls, since
  neither followed from the code: one added from your own timeline reaches
  **every family you are in**, one added from a member's page goes to that
  family only. The switch defaults on but exists — a death or a separation is
  recorded, not announced. **The photos stay on the timeline**: a Media row
  may have exactly one parent, so they cannot hang off the post as well.
  Duplicating them was considered and dropped (owner's call, 2026-08-28).

- **Refresh without reloading (2026-08-27)**: the app had no refresh gesture
  at all — no pull-to-refresh anywhere, so a browser reload was the only way
  to see new data, and it threw away the bundle, the session read and the
  reader's place. Tapping the logo, or the tab you are already on, now
  refetches in place and returns to the top. `invalidateQueries()` with no
  filter is the whole mechanism: React Query refetches what is mounted and
  marks the rest stale, so the screen in front of you updates now and the
  others when next opened. The feed is trimmed to its first page before the
  refetch — refetching an infinite list whole would re-request every page
  already scrolled through. `features/ui/soft-refresh.ts`.

- **One name per person (2026-08-27)**: renaming your account now writes
  through to every `FamilyMember.displayName` that account holds, in the same
  transaction. The two columns had been drifting since join time — Settings
  read `User.name` while the tree, the feed and every tag read the member
  row's copy, and four people were showing two names each by the time it was
  noticed. Written through rather than resolved at ~50 read sites because the
  rule already existed here: for a **linked** member the account wins, which
  is how avatars already behaved. A placeholder's `displayName` is untouched
  — it is the only name that person has. Existing drift was realigned with
  `pnpm --filter api names:sync` (dry-run first; it prints every old → new
  before applying). Direction confirmed from the data, not assumed: all four
  accounts had been renamed **after** joining, so the account name was the
  newer choice in every case.

- **Invite by email (2026-08-26)**: `POST /families/:id/invitations` now takes
  an `email` and raises a `FAMILY_INVITE` notification for that account;
  `GET /me/invitations` is what it links to. Delivery is **in-app only** — an
  unregistered address is rejected, because there is nowhere for the invite to
  arrive. Named codes stop being bearer tokens: only the invitee can accept.
  Migration `20260826081911_invitation_invitee_user` (nullable column, index,
  FK — additive) **is already applied to shared Neon**, so the column is there
  for everyone. **After pulling, run `pnpm --filter api exec prisma generate`**
  or the stale client throws `Unknown field` at runtime — the trap documented
  in `local-environment.md`. Existing invitations keep `inviteeUserId` null,
  which is exactly "a code handed over by hand", so nothing old changes
  behaviour. Contract in `api-contract.md` → Invitations.

  **Mobile side landed the same day**: an optional email field on the invite
  sheet, `family/my-invitations` for invitations addressed to you, and a Home
  banner that appears only while one is waiting — it has to reach an account
  with no family at all, where Home is otherwise a single "start a family"
  empty state and telling someone to found a household they were just invited
  into is the wrong instruction. Tapping a `FAMILY_INVITE` notification opens
  `/invite/:code`. Both new surfaces use the 600px content column, so the
  phone layout is untouched and the web one does not stretch.

  **Follow-up 2026-08-27 (`feature/invite-method-choice`, Đạt)** — two fixes
  on top of the merged UI:

  - The invite sheet's optional-email field silently chose the delivery
    (filled = notification, blank = hand-over code); it is now an explicit
    two-tab choice — "by email" / "with a code" (SegmentedTabs, same pattern
    as create-vs-join) with a one-line hint saying who each is for. The sent
    state follows the server's answer (`inviteeUserId`): email invites
    confirm the address instead of showing a code that nobody can be handed.
  - **A typed invitation code now works.** The Join tab was the app's only
    box that takes a typed code, and it only asked `POST /families/join`
    (`Family.inviteCode`) — a per-spot invitation code typed there was a flat
    404, which broke the hand-over path end to end (the share message sends a
    bare code, not a link). The tab now tries `GET /invitations/:code`
    (public) first and routes a hit to `/invite/[code]`; only a miss falls
    through to the family-code join. Deterministic order also settles the
    astronomically unlikely code that lives in both tables. Verified: mobile
    tsc, check:i18n (795 keys, en+ja), prettier; not looked at on a device.

- **The tree canvas is navigable on the web (2026-08-27,
  `feature/tree-pan-zoom`)**: pan + pinch always existed (gesture-handler +
  Reanimated, since the canvas shipped), but only for fingers — in the
  browser, where the team previews, a mouse could drag and nothing could
  zoom except the +/- buttons. The canvas now listens to the wheel on web:
  scroll pans, ctrl+wheel (which is also how browsers report a trackpad
  pinch) zooms, with `preventDefault` keeping the browser from zooming the
  page instead. Same shared values as the gestures and buttons, same clamped
  bounds; the React `zoom` mirror syncs on a 120ms trailing edge so wheel
  ticks never re-render mid-zoom. Native untouched. And the drag itself grew
  physics (same day): past-the-edge drags move at a third of finger speed
  instead of stopping dead — the hard clamp also made a tree that fits the
  screen ignore dragging entirely, which read as "pan is broken" — and
  release is a `withDecay` fling that spends the finger's velocity and
  rubber-bands back inside bounds; a pinch that ends out of bounds eases
  back instead of snapping. Then the whole interaction was rebuilt to Đạt's
  HTML prototype (`apps/mobile/src/Family Tree Canvas.dc.html` — the spec
  for feel and numbers): the canvas is now a world plane translated then
  scaled about its top-LEFT corner, which is what makes **focal-point zoom**
  solvable — pinch zooms about the fingers, the wheel zooms at the cursor,
  double-tap toggles fit ↔ 1.7× about the tap, the ± buttons ease toward
  the canvas centre in 0.35 steps, and the range widened to 0.35–2.4×. The
  pinch itself is elastic past both ends of that range. Content smaller
  than the viewport now centres instead of pinning to an edge, and the
  canvas hint carries a live zoom percentage.

  **Then it was actually driven in a browser** (headless Chromium +
  playwright-core, trusted input events, seeded account), which found three
  web-only breaks no typecheck could: (1) the NativeWind-wrapped container
  does not hand its ref the DOM element, so the wheel listener was silently
  never attached — it lives on a plain inner View now; (2) gesture-handler
  swallows wheel events after the first completed pan, so the wheel/dblclick
  listeners moved to the parent element in the CAPTURE phase; (3) the big
  one — **a drag that started on a face ended by opening that face's
  profile**: on web, RNGH's pan activating does not cancel the node
  Pressable's press the way it does on native, so panning read as "broken"
  while it was actually navigating away. A capture-phase click suppressor,
  armed only while a pan is live (and 250ms after), is the web stand-in for
  that cancellation. Browser-verified end to end: drag pans (elastic,
  springs back on a tree that fits), wheel zooms at the cursor to 190%
  after a drag, double-click toggles fit ↔ 1.7×, pan-while-zoomed sticks,
  zero console errors. Native untouched by all three fixes. Also verified:
  tsc, prettier. **The rendering pipeline and layout algorithm are now
  documented** in `docs/01-frontend/family-tree-rendering.md` — read it
  before touching placement.

- **The tree lays itself out by family unit (2026-08-27,
  `feature/tree-pan-zoom`)**: even spacing by API order is gone — it split
  couples, swept arcs behind strangers' faces and let crowded rows overlap.
  `layoutTree` now welds partners into blocks (remarriage chains included),
  hangs child blocks off their parents' block — a parentless block with a
  placed SIBLING adopts that sibling's owner and sits beside them, so the
  composition stays centred instead of leaning — reserves bounding boxes so
  branches cannot collide, and centres parents over their children — and a
  crowded row **widens the world instead of squeezing**: the canvas opens
  and recenters at a fit scale, never cropped. Three decisions taken with
  it (Đạt, 2026-08-27): members no edge mentions draw in a labelled
  **"unplaced" strip** below the tree instead of GEN 1
  (`family.unplacedRow`, en+ja); inviting a **SIBLING now mirrors the
  inviter's plain `PARENT` edges** onto the new member server-side so the
  sibling hangs from the same joint instead of floating (contract updated,
  adopted/step deliberately not mirrored); everything is written down in
  `family-tree-rendering.md`. Verified: mobile tsc, api tsc, check:i18n
  (820 keys), prettier, and the seed family drawn in headless Chromium —
  couples adjacent, descents straight, opens at 75% fit with nothing cut
  off. e2e not run (stays off shared Neon). Same day, three more rules
  (Đạt): **siblings order oldest-left** by Life Profile `birthDate`, now
  carried on tree members (`GET /families/:id/tree`, contract updated) and
  keyed on the block's anchor so a young spouse cannot displace an eldest
  child; **a partner is auto-joined to their spouse's children** in the
  drawing — no "their" vs "our" children, DB edges untouched; and the
  arrangement rules moved to **`tree-blocks.ts`** (welding / hanging /
  ordering / balance, one function per rule) so the next rule is a slot-in,
  with `tree-layout.ts` keeping only pixels. The balance rule
  (`interleaveAdopted`, same day): sibling-adopted blocks alternate left
  and right around the thread-connected core and parents centre over the
  CORE — grandparents were sitting askew of the parents when adopted
  siblings piled up on one side. Browser-verified on the seed family:
  adopted left, couple centre, pending right, descent vertical.

- **One create form, one join form (2026-08-27, `feature/invite-method-choice`)**:
  `create-family.tsx` (the create/join tab combo) put a second create-family
  form in the app next to `family/new.tsx` — two doors marked "create"
  leading to different rooms. It is now `join-family.tsx`, join-only (keeps
  the typed-code dual lookup); creation converged on `family/new`, which
  every no-family empty state now opens, and the two forms cross-link
  (`family.new.joinLink` / `joinFamily.createLink`) so a person who guessed
  wrong is one tap from the other. The fork is also visible from outside:
  `EmptyState` grew an optional secondary (ghost) action, and every
  no-family empty state now shows BOTH buttons — "Start a family" and "Join
  with a code" — instead of landing everyone on create. i18n group
  `createFamily.*` renamed `joinFamily.*` (check-i18n DYNAMIC updated).
  Verified: tsc, check:i18n (791 keys), prettier; not on a device.

- **No-family tabs got the sleeping cat (2026-08-27, same branch)**: Omoide
  and Family rendered a bare header for an account with no family — the
  `familyId === null` case fell into `return null`, which only makes sense
  for the loading tick. Both now distinguish "still loading" from "no family
  at all" (via `useFamilies`) and show the sleeping-cat empty state with
  Home's title and `/create-family` door, each with a body written for its
  own tab (`omoide.noFamilyBody` / `family.noFamilyBody`), so the next step
  is the same one screen everywhere. Verified: tsc, check:i18n (797 keys),
  prettier; not on a device.

- **Object storage for media**: step 1 (2026-08-26) decoupled
  `StorageService` from filesystem paths; **step 2 landed 2026-08-27** — an
  R2 driver behind `STORAGE_DRIVER`, verified against the real bucket across
  upload, head, ranged read, borrow-to-temp and delete. Local disk stays the
  default and the offline path.
  **Switching a machine over is not just a flag**: every `Media` row already
  in Neon names a key that must exist in the bucket, so run
  `pnpm --filter api r2:migrate` first. Each person uploads what their own
  disk holds; the set is complete once everyone has. Steps and caveats in
  `local-environment.md` § Media storage. Still to come: presigned URLs, which
  would take the API out of the delivery path.

- **Timeline photos are editable on a saved entry (2026-09-03)**, both
  halves. **API**: `UpdateLifeEventDto` stopped omitting `mediaIds` and now
  takes the set as a replacement, the same "only an array replaces" rule
  `taggedMemberIds` follows; `updateEvent` splits the incoming set into ids
  new to the entry (checked by `assertAttachableMedia`, attached with
  `attachMediaInTx`) and ids dropped from it (rows deleted, storage keys
  unlinked best-effort **after** the commit, the order `removeEvent` uses).
  A photo-only edit leaves the field write empty, so the "did anything
  change" guard had to learn about media or such an edit would have silently
  no-opped. Nothing is omitted from the create shape any more either:
  `shareToFeed` was the only exclusion, and it left `CreateLifeEventDto`
  entirely in the feed-removal change above, so `UpdateLifeEventDto` is now
  a plain `PartialType(CreateLifeEventDto)`.
  **App**: `DraftEntry` lost `mediaCount` and `serverMedia` — an entry's
  photos are now ONE `DraftMedia[]` where a saved tile carries `mediaId` and
  a fresh pick carries `uri`, which is what lets one `MediaStrip` show, add
  to and remove from both. `MediaStrip` grew a `mediaId` branch drawing the
  authenticated thumbnail through `expo-image` (RN's `Image` cannot carry the
  Authorization header). The commit hook uploads an update's picks and
  splices kept ids + uploaded ids into `mediaIds`, and **always sends the
  field** — an omitted `mediaIds` means "leave the photos alone", so a
  removal has to arrive as the shorter array.
  The `photosFixed` copy is gone, replaced by `photosHint`: "Removing a
  photo deletes it for good when you press Done." Removal really is a
  delete — file and all — so the strip says so before the X is tapped rather
  than after. Whether that deserves a confirmation dialog on top is a
  product call; the hint is the floor, not necessarily the answer.

- **The family switcher was shaved and too small (2026-09-03, owner's
  report: "vòng tròn chỗ chọn nhà ở cây gia đình đang bị lẹm mất… đang bị
  nhỏ")**. One complaint, two unrelated faults. **Clipping**: the rings on
  those faces are `boxShadow`, painted outside the element's own box, and the
  horizontal `ScrollView` added on 2026-09-01 to keep a long row reachable
  clips what leaves its content box — `overflow-y` hidden, and the scroller
  is only as tall as the faces in it. The selected face lost the top and
  bottom of its ring, the first and last face lost their outer edge. Fixed by
  padding the content container by the ring's bleed (`RING_BLEED`), which is
  load-bearing, not breathing room. **Size**: the faces were still 34px, the
  size they were given as a _preview_ on Home; on the tree screen this row is
  the switcher — the only thing naming the tree on screen — and 34 was also
  under the 44pt touch minimum. Now 40px in a 60px tray, cap 44.
  Third fault found while in there and worth its own line: the active ring
  was `rgba(240,112,95,0.35)` at 3px over a 2px gap ring, i.e. **one pixel at
  35% opacity**, so "which family am I looking at" was effectively unmarked.
  Now a solid 2px `coral.brand`.

- **Creating or joining a family kept the button spinning through a second
  request (2026-09-03)**: React Query awaits whatever `onSuccess` returns,
  and both `useCreateFamily` and `useJoinFamily` returned their
  `invalidateQueries` promise — so the form sat there after the server had
  already answered, waiting for the families list to refetch. Both `void` it
  now, as `useCommitMyTimeline` already did. The list still refreshes; the
  button stops claiming the work is unfinished. This is the client half of the
  latency note in § For the backend owner, and the half that was actually
  wrong rather than merely remote.

- **Social login (Google + Facebook)** (2026-08-17): backend merged to
  `main` in PR #3 — `OAuthAccount` table + OAuth authorization-code
  endpoints in the AuthModule. **Google verified end-to-end 2026-08-18**
  (task 1.1.8 done — consent screen switched to External + test users).
  Facebook (1.1.9) stays unticked until its happy path is verified —
  needs the tester-role invite accepted on the Meta app. Frontend
  buttons come with the auth UI (1.1.1/1.1.4).

- **Welcome's second line now carries registration (2026-09-03)**: a
  loose end left by the demo-login change above it. With the button going to
  sign-in, "Already have an account? → Sign in" underneath pointed at the
  same place the button did, and nothing on the screen led to sign-up any
  more except the mode tabs one screen in. That line is now "New here? →
  Create your family" (`auth.welcome.noAccount`; `haveAccount` and the
  now-unreached `auth.welcome.signIn` are gone, `create` is back as the
  link's label beside upstream's `start`).

  This branch reached the same screen independently and by a worse route —
  relabelling the button "Sign in" and pushing `/sign-in` plainly. The demo
  prefill on `main` does more for a first visit, so that side won and only
  the line beneath it survived from here.

- **The faces on Welcome are people again (2026-09-03)**: the avatar stack
  passed `tone` and no name, which dropped `Avatar` to its last tier — the
  striped placeholder — so the row read as four grey hatched circles, which
  proves nothing about a family being there. `AvatarStackItem` takes an
  optional `name` now, and the list moved to `fixtures/welcome-faces.ts`
  because `welcome.tsx` and `auth-shell.tsx` each held their own copy of it.
  Initials on a per-name tint, **not photographs**: shipping a real family's
  private pictures to make this point is not a trade worth making, and the
  four names land on four different theme colours. Real pictures would need
  no new plumbing — give an item a `mediaId` and `Avatar` already prefers it.
  The decorative stacks beside a photo count (`ai/gifts`, `video/setup`) pass
  no name and keep the stripes.
  Verified across this branch: api tsc, mobile tsc, check:i18n (928 keys),
  `expo export` web bundle, prettier. The **photo editing was exercised by
  the owner** on a running stack ("t test thấy ổn rồi"). The e2e suite was
  NOT run: `family-edit`, `special-dates` and `ai-video` all require a
  LOCAL Postgres and `apps/api/.env` points at the shared Neon database, so
  running them would write test rows into the team's data. A test for the
  media-replacement path is the obvious gap.

## Not Started

- ~~`apps/ai` (FastAPI service — not yet created)~~ — created 2026-08-20,
  merged to `main` in PR #25 (see Current Sprint)
- Sprint 3 (notifications / reminders / settings / release).
  Sprint-2 group 2.6 (AI Quality Time) was **dropped** 2026-08-20 —
  see Important Decisions / PR #28.
- **Server-side email is English-only.** The app ships EN/JA
  (`apps/mobile/src/locales/`), but `apps/api/src/mail/mail.service.ts`
  hardcodes its subject and body — a Japanese user asking for a password
  reset gets an English message. Fixing it needs a locale stored on `User`
  (the request arrives unauthenticated, so the app's current language is
  not available to the server) plus templates per language. Noticed
  2026-08-28.

## Important Decisions

- **Development database moved to Neon Cloud, shared by the team
  (2026-08-26)** — `apps/api` now points `DATABASE_URL` at managed Neon
  PostgreSQL (`*.neon.tech`) instead of each machine's own Docker Postgres.
  Everyone develops against the same data, so a family created on one machine
  is there on the next.

  What did **not** change: `schema.prisma`, the migrations, the models, the
  business logic. Neon supplies PostgreSQL and nothing else — **Neon Auth is
  not used or integrated**; `User`, `RefreshToken`, `PasswordResetToken` and
  `OAuthAccount` stay this project's own, served by `AuthModule`, and the
  application still reaches the database only through Prisma. Neon owns the
  server, storage, uptime, plan-level backup/recovery and branching; the
  project keeps owning schema, migrations, queries and the data itself.

  Consequences, recorded so nobody re-derives them:

  - **Local Docker Postgres survives as an opt-in workflow** — offline work,
    destructive experiments, authoring a migration before the team sees it.
    The two databases share a schema and nothing else; no data crosses, in
    either direction.
  - **A migration is now a team-visible act.** `prisma migrate reset` and
    casual `prisma migrate dev` are out on the shared branch: author against a
    database of your own, get the PR reviewed, then `prisma migrate deploy`.
    `pnpm seed` and `pnpm test:e2e` also write real rows through
    `DATABASE_URL` — likewise not on the shared branch.
  - **`pnpm db:backup` / `pnpm db:restore` do not cover Neon.** They
    `docker exec` into the local container; on Neon the equivalents are its own
    backup/recovery and branches taken as restore points.
  - **`apps/api/.env.example` now ships the Neon placeholder** as the default
    with the localhost line commented underneath, so a new machine cannot
    silently land on a private Docker database while believing it is on the
    team's.
  - **`pnpm bootstrap` reads `DATABASE_URL` before doing anything**, prints the
    host, and starts Docker only when that host is local. An unedited
    placeholder stops it with instructions instead of a Prisma connection
    error.
  - **One connection string, direct endpoint.** No `DIRECT_URL`, no
    `shadowDatabaseUrl`; if anyone moves to a pooled (`-pooler`) endpoint,
    migrations will need a direct one added explicitly.
  - Production hosting stays undecided (`docs/04-devops/deployment.md`); this
    decision is about development.

  Both workflows and the full rule list:
  `docs/04-devops/local-environment.md`.

- **Notifications are in-app only for the MVP; push deferred (2026-08-20)**
  — closes the "Notification delivery method" open question in
  `mvp-scope.md`. The app shows a list and an unread badge, refreshed
  while it is open; nothing reaches a closed phone yet.

  Two things worth stating so the decision is not re-argued from scratch:

  - **Sound, vibration and a lock-screen banner are the same mechanism**,
    not three tiers. Choosing "just a sound" does not avoid anything —
    every one of them is a push delivered by Apple or Google.
  - **The Apple Developer account is a project cost, not a push cost.**
    Without it the app cannot go to the App Store at all, and installs on
    a real iPhone expire after seven days — which also blocks the
    "nothing has run on a physical device yet" problem below. An
    **organization** account waits on D-U-N-S verification, days to weeks,
    which money cannot shorten. **It should be started now as a project
    task**, in parallel with the code, not when push is scheduled.

  Two things that do not need it, and are worth doing first: **polling**
  `unread-count` while the app is open (frontend only, the endpoint
  exists), and **local scheduled notifications** for birthday and special
  date reminders (WBS 3.2) — the app already knows those dates from
  `GET /families/:id/special-dates`, so the phone can raise them on its
  own with no server and no Apple credential. Only unpredictable social
  events ("Lan just commented") genuinely require push.

  **Polling cadence settled the same day: 5–10s** on the notifications
  screen and Home, slower elsewhere, stop in background, refetch on
  foreground. SSE/WebSocket considered and rejected for now. Full FE
  guidance in `api-contract.md` → Notifications.

- **AI Quality Time dropped (2026-08-20)** — the whole of WBS 2.6, both
  the suggestion (2.6.1–2.6.3) and saving/sharing the result as a `Plan`
  (2.6.4). Sprint-2 AI is now the two features that actually run end to
  end: **gift ideas (2.4) and message suggestions (2.5)**. Consequences,
  recorded so nobody re-derives them:
  - **Every AI suggestion the product ships is read-once.** Nothing is
    persisted; the "AI output you follow over days" case is gone.
  - ~~**`Plan` and `PlanShare` stay in the schema, unused.**~~ — **no longer
    true for `Plan` (corrected 2026-08-24): the AI team's gift-save reuses
    it.** `ai.service.ts` writes a `Plan` row per ♡-saved gift idea (title
    convention `gift:<name>`, owner-private) and `ai-context.service.ts`
    reads them back as `past_gifts` so a saved gift is never re-suggested.
    Only `PlanShare` is truly unused. Do not drop `Plan` as "empty and
    harmless" — it carries live data. The Quality Time _feature_ stays
    dropped; only the table found a second life.
  - The Plan API was **written and verified** (49-case live smoke test,
    2026-08-20) but deliberately **not merged** — branch `feature/plans`
    if this is revived. Same for `feature/ai-suggestions`, which had the
    quality-time route and was superseded by the AI module already on
    `main`.
  - The **"Plan a surprise" data-source question** in `domain-model.md`
    (availability, distances, a possible `MemberAvailability` table) is
    closed by this decision rather than answered.
  - Worth noting for the next scope review: Quality Time was in the WBS
    but **never in `mvp-scope.md`'s AI table** — the gap between the two
    documents is likely why it went unbuilt while 2.4 and 2.5 shipped.
- PostgreSQL is the primary database.
- Prisma is used for database access, via the `pg` driver adapter (required
  for SQL providers in Prisma 7).
- **Frontend is a native mobile app (2026-08-17)**: `apps/mobile` built with
  Expo + expo-router + NativeWind is the primary client, replacing the
  earlier "Next.js mobile-first web" decision. Reasons: iOS push
  notifications, app-store presence, and scroll/gesture quality — the last
  one matters because the audience includes older family members. All 21
  screens in `screens.md` are designed as native screens (bottom nav,
  bottom sheets, blurred headers, gestures). `apps/web` stays as a bare
  Next.js scaffold with no decided role. See
  `docs/01-frontend/architecture.md`.
- **NativeWind confirmed (2026-08-17)**: `nativewind@4.2.6` +
  `tailwindcss@3.4` verified working on Expo SDK 57 / RN 0.86 / React 19.
  `tailwind.config.js` derives every colour, size, radius and font family
  from `@nha/tokens` — Tailwind is a consumer of the tokens, never a
  second source of truth. Off-scale mockup numbers (353px, 171.5px) are
  _derived_, not intended: they are `393 − 20×2` and `(353 − 10)/2`, so
  they are expressed as `flex-1` + padding + gap, never hardcoded.
  `darkMode: 'class'` — the palette is a fixed warm light one, so dark
  styles must never arrive from the OS setting.
- **State libraries reviewed (2026-08-18)**: `@tanstack/react-query` and
  `expo-secure-store` added because each solves a problem the app has
  today (cursor pagination and cache sharing; tokens surviving a restart).
  **`zustand`, `react-hook-form` and `zod` deliberately not added** — the
  only cross-screen state is the active family, and the six existing forms
  are simple enough for `useState` while the server already validates and
  returns per-field messages. `packages/api-client` and
  `packages/contracts` are dropped from the plan: the client lives fine in
  `apps/mobile`, and a shared zod package would fight the API's
  class-validator DTOs. Revisit each when a second case appears.
- **Invites are per-spot, not per-family (2026-08-18)** — UI-led decision,
  backend to follow. — backend done 2026-08-19 (task 1.4.4, see
  `api-contract.md` → Invitations). The invite sheet sends a specific person to a specific
  tree node: it captures the spot id, a display name and a relationship, and
  only then produces a link. The receiver's page can therefore say who
  invited them, as what, and where they land, which is what makes a cold
  invite trustworthy. What the backend needs to add: an invitation record
  carrying `{ familyId, memberId (the reserved spot), inviterId, name,
relationshipType, status, expiresAt }`. `Family.inviteCode` stays as the
  open "anyone with the link" path; it is not enough on its own, because a
  single permanent family-wide code cannot distinguish a Pending node from
  an ordinary placeholder. Kinship words shown in the sheet ("Sister",
  "Step-parent") stay **derived labels** and must not become
  `RelationshipType` enum values — each option carries the base type it maps
  to (`docs/00-shared/domain-model.md`).
- **A moment's audience is its privacy control (2026-08-18)** — the New
  moment screen models `PostFamily` directly: each selected family circle is
  one row, and selecting none means the post is private to its author, per
  `docs/02-backend/database.md`. Because that rule is invisible in the
  control itself, the screen always states the consequence in words under
  the button rather than relying on the user to infer it.
- **AI suggestions must show their working (2026-08-18)** — every
  suggestion carries `why` and `source`, and the amount of evidence read is
  stated before the first idea, not after. A recommendation nobody can
  trace back to a memo, a photo or the timeline is a guess wearing the
  family's clothes, and the reader has no way to tell the difference. This
  constrains the AI service too: the FastAPI contract has to return the
  provenance alongside the suggestion, not just the suggestion.
- **A button that leads nowhere is not rendered (2026-08-18)** —
  `FeaturedOccasion` draws an action only when given a handler, so Plan a
  surprise and Video are absent until those screens exist. A dead control
  costs more trust than a visibly missing feature.
  **Applied again 2026-08-20**: the six Google/Facebook buttons on Welcome,
  Sign in and Sign up were removed. None had a handler and none could —
  the OAuth callback returns the token pair as JSON, which an app cannot
  read. They come back when the server redirects instead; see § For the
  backend owner.
- **One heart, not five reactions (2026-08-20)** — `ReactionType` has five
  values and the app sends one. `PostDetail` returns `reactionCount`, a
  single total, and `myReaction`, which is only ever your own: there is no
  per-type breakdown on the wire, so five buttons all fed one
  undifferentiated number and a star was indistinguishable from a heart once
  left. Five ways to do the same invisible thing is a puzzle, not a choice.
  Reversing it is one component (`components/feed/like-button.tsx`) the day
  the server returns a breakdown.
- **Personal albums live under Omoide (2026-08-20)** — a product call, made
  because there was none to follow: `screens.md` lists no "my albums" screen
  and mentions albums only as "choose album" on screen 11. Omoide is the tab
  someone already opens to look at pictures, so the way in sits there — as a
  card held visually apart from the shelf below it, because that shelf is the
  family's and this one is private, and they are one tap apart. Moving it is
  a one-line change.
- ~~**Auth session is a stand-in (2026-08-18)**~~ — **superseded the same
  day; corrected here 2026-08-19.** The session is real: tokens live in
  `expo-secure-store`, refresh-on-401 is collapsed onto one promise in
  `src/lib/api/client.ts`, and `status` carries a third `loading` value for
  the keychain read so a returning user is not bounced through Welcome on
  every cold start. What survives from the original decision is where the
  guard sits: on the `(auth)` and `(tabs)` route groups, one gate each way.
- **Solar-only reaffirmed (2026-08-18)**: the Occasions mockups showing
  lunar dates are what changes, not the schema. See `domain-model.md`.
- **Social login is Apple + Google + Facebook (2026-08-18)**: Apple is
  added because App Store guideline 4.8 makes it mandatory on iOS once any
  other third-party login ships. Apple's flow differs from the other two
  (an identity token, not a plain authorization-code redirect), so it is
  its own backend task. The mockups need a third button.
- **No mandatory family step (2026-08-18)**: registration lands on Home,
  which shows an empty state with a way to create or join a family. Every
  screen therefore has to survive `familyId === null` — that is a
  first-class state now, not an edge case.
- **Apple Sign In dropped (2026-08-18)** — reversing the decision taken
  earlier the same day. Social login is **Google + Facebook only**. The
  trade-off is understood and accepted: App Store guideline 4.8 requires
  Sign in with Apple on iOS once any other third-party login ships, so an
  iOS build carrying Google or Facebook risks rejection at review. That is
  acceptable while the MVP is a demo rather than a store submission. Before
  any App Store submission the team must either add Apple or drop the other
  two from the iOS build. `AppleMark` was removed from the code rather than
  left unused, so putting it back is a deliberate act.
- **Omoide is one shelf, not albums, for the MVP (2026-08-18)** — every
  photo and video shared with the family, grouped by the day it was posted
  (mockup 10b). This needs **no new endpoint**:
  `GET /families/:id/posts` already returns each post with its media and
  already excludes private posts, which is exactly the boundary a shared
  memory shelf should have. Grouping is by _posted_ date, not capture date,
  because the server returns no capture metadata. Mockup 10a — albums by
  occasion — waits for an album endpoint and for the still-open question of
  what an album is derived from. **Built and wired the same day**
  (`app/(tabs)/omoide.tsx`, `features/omoide/`); search and the sort menu
  from the mockup are deliberately absent until something is behind them.
- **Home is 3a then 2a (2026-08-18)** — the family strip, the special-date
  widget and the recommendations sit above the fold exactly as in mockup 3a;
  scrolling past the "swipe up for moments" cue continues into the feed of
  mockup 2a. One `FlatList` with the 3a block as its header, because on a
  phone "swipe up" _is_ scrolling — a gesture library would reimplement what
  the list already does. The separate `/moments` screen built earlier the
  same day is deleted: two feeds is one too many.
- **Kinship labels stay basic for the MVP (2026-08-18)**: the app shows the
  base relationship translated from `RelationshipType`, and does **not**
  derive "Grandmother" or "Aunt" from paths through the graph. Consequence
  to accept: a node with no direct edge to the viewer — a grandparent, a
  cousin — shows its name with no role line under it. Revisit once the tree
  has been used by a real family.
- Backend uses NestJS; prefer a modular monolith (see `CLAUDE.md` § 3).
- pnpm workspace monorepo.
- Conventional Commits are enforced via commitlint (husky `commit-msg` hook).
- Documentation may be committed directly to `main`; code changes require a
  branch + PR (team decision, not yet a hard rule in `CLAUDE.md`).
- **MVP scope decided (2026-08-13)**: Foundation + memory storage + AI
  features are IN; On This Day and Memory Map are OUT — see
  `docs/00-shared/mvp-scope.md`.
- **User ↔ Member (2026-08-13)**: Members exist independently of accounts;
  an account can link to an existing Member — see
  `docs/00-shared/domain-model.md`.
- **Multi-family (2026-08-13)**: a user can belong to multiple family
  spaces — see `docs/00-shared/domain-model.md`.
- **Life Profile is global (2026-08-13)**: one profile per person, shown in
  every family they join; on linking, the placeholder bio is replaced but
  attached memories are kept — see `docs/00-shared/domain-model.md`.
- **Placeholder profiles are wiki-editable (2026-08-13)**: any family member
  can edit; no manager ACL in MVP.
- **Relationships (2026-08-13)**: base types + exceptions (adopted, step,
  extended); set by whoever adds the member; node removed when leaving.
- **Privacy (2026-08-13)**: post to chosen families; everything shared is
  family-visible (no per-item ACL); personal archive private by default.
- **Auth (2026-08-13)**: JWT access + refresh tokens (refresh hashed in DB,
  revocable); email/password only for MVP, Google OAuth deferred — see
  `docs/02-backend/architecture.md`.
- **3-sprint plan (2026-08-13)**: Sprint 1 Core Features → Sprint 2
  Memories & AI → Sprint 3 Notification/Settings/Release — see
  `docs/sprints/`.
- **Memories reuse Post (2026-08-13)**: Sprint 2 Memories page reads the
  Sprint 1 `Post` table — no separate Memory model — see
  `docs/02-backend/database.md`.
- **Photo-insight pipeline is a two-phase design (2026-08-19)**: the AI
  team's service analyses photos in the background (vision) and the
  extracted facts live in **`MediaInsight`, a hidden store** no
  user-facing API exposes; suggestion requests then combine those
  insights with the requester's own memos. An insight inherits the
  visibility of its source photo and is filtered per requester at bundle
  time (anti-laundering rule), and it cascade-deletes with the photo.
  **Comments are excluded** from AI context for now. This supersedes the
  "manual context only" scope note **for photos**; consequence to
  confirm with the customer: family photos leave the server for the
  Claude API during analysis. See `docs/03-ai/architecture.md`.
- **AI work is owned by a separate AI team (2026-08-19)**: `apps/ai`
  (FastAPI), provider calls, prompts and the video render are theirs;
  backend supplies the API side — the NestJS proxy, auth, context
  gathering and the `docs/03-ai/architecture.md` contract both teams
  build against (drafted 2026-08-19). Provider direction: **Claude API**
  (AI team makes final model-level calls). Hard lines restated in the
  contract: FastAPI stateless and never touches Postgres, app never
  calls AI directly, core works when AI is down, every suggestion
  carries `why`/`source`, and the context only ever contains the
  requesting user's own private memos.
- **Email infrastructure (2026-08-18)**: SMTP behind the `MailService`
  seam — Gmail SMTP with an app password for the MVP (env
  `SMTP_HOST/PORT/USER/PASS`, `MAIL_FROM`); with SMTP unconfigured
  (local dev) the message is logged to the API console instead of sent.
  Unblocked 1.1.7; the signup email-verification screen remains a
  separate product decision.
- **Social login (2026-08-17)**: customer requires social login for the
  Japanese market. Phase 1 **Google + Facebook**, scheduled into Sprint 1
  as tasks 1.1.8–1.1.9. **LINE deferred** (needs an email-permission
  application; highest-value provider in Japan — re-confirm with the
  customer). Phase 2 candidate: X. Instagram infeasible (Basic Display API
  shut down; no consumer SSO). Policies: no auto-linking (409 if email
  already registered), email required from the provider (reject if absent
  or unverified). Schema impact: add `OAuthAccount` only — see
  `docs/02-backend/architecture.md`.
- **Full-MVP DB design + domain decisions (2026-08-14)**: 25 tables.
  Albums split (family library = derived, rendered as Omoide "books" /
  personal albums private / profile gallery derived); Memo = private
  notes about a member (author-only, always); ~~AI plans are saved
  (`Plan` + `PlanShare` — owner edits, view-only sharing)~~ — **the
  feature was dropped 2026-08-20; `Plan` was then reused by gift-save
  (corrected 2026-08-24, see the Quality Time decision above)**; birth/death
  dates live on LifeProfile; wiki edits logged (`EditHistory`); diverse
  reactions (base LIKE/LOVE/HAHA/WOW/SAD); solar-only dates (product
  targets the Japanese market); special-date widgets (`SpecialDate`).
  Comment/Reaction, password recovery, personal albums, LifeEvent
  timeline, special-date widgets and `SpecialDate` CRUD scheduled into
  sprint sub-tasks — full log in `database.md` → Decision Log.
- **Media uploads (2026-08-18)**: uploads accept photo, video, and audio
  (per the MVP memory scope) with a **single 100MB limit for every
  type**; local-disk storage behind the storage service module for the
  MVP demo, streamed to disk (never buffered in memory). Client-declared
  MIME type is trusted for now (no content sniffing) — revisit before
  release, together with automated tests for the post/media
  authorization matrix.
- **Video render on Render: OOM + ffmpeg 7 xfade (2026-09-17)**: every
  VideoJob since 09-15 sat at PROCESSING 3% forever — the API process was
  OOM-killed (`os.cpus()` in the container reports the host's cores, so the
  engine spawned 5 ffmpeg at ~550MB each) and nothing marked the job
  FAILED. Fixed operationally with four env vars on `nha-api` (see
  `docs/04-devops/deploy.md`). That exposed a second, real bug: the Linux
  build of `ffmpeg-static` is ffmpeg **7.0.2** (Windows is 6.1.1) and 7.x
  rejects `concat` output feeding `xfade` ("inputs needs to be a constant
  frame rate"). `concatMemories` now re-stamps `fps=30,settb=AVTB` after
  each concat; verified by replaying the exact graph on both binaries.
  Third finding (2026-09-18): the final mix alone peaked at **1.8GB** on
  ffmpeg 7.0.2 Linux even with one ffmpeg — all segments start at pts 0,
  so the scheduler decodes every input from t=0 and parks the frames in the
  graph; capping threads only made the queue longer (2.1GB), and
  `-itsoffset` + thread caps bottomed out at ~1.0GB — still OOM on Render
  next to the Node process. Final fix: `concatMemories` is now
  **two-stage** — one ffmpeg per scene body and per transition (1–2 inputs
  each: 308–545MB measured on 7.0.2 Linux), then a concat-demuxer mux with
  `-c:v copy` plus the music/voice graph (29MB). Peak no longer grows with
  the scene count; same encode count, same 980-frame output. x264 threads
  capped at 4 (`VIDEO_FFMPEG_THREADS`). Fourth finding (2026-09-18): the
  video was "boring" on production because it had no text — `findFont` only
  looked in `C:\Windows\Fonts` (nothing on Linux → captions silently
  dropped) and the Linux ffmpeg build has **no `drawtext` filter** at all
  (no libharfbuzz). Fix: Noto Sans JP + Noto Sans bundled under
  `apps/api/assets/fonts` (OFL, ~10MB), captions/cards rendered through
  libass (`subtitles` filter with `fontsdir`, present in both builds),
  intro SVG text pointed at the same fonts via `FONTCONFIG_PATH`, and the
  service now warns when fonts are missing. Verified by replaying the
  generated commands on the 7.0.2 Linux binary. Fifth (2026-09-18): the
  music picker on production only offered the 6 sine-wave synth tracks —
  the real library (`assets/music`, 45 Amacha tracks) was gitignored, its
  fetch script never landed in the repo, and `ASSETS_MUSIC` was cwd-based
  (wrong on Render). Now 15 curated instrumental Amacha tracks (pop /
  ほのぼの / おしゃれ, BPM measured with a new onset-autocorrelation
  estimator, conf ≥ 2.5 else null) live in R2 under `music-library/`
  (Amacha terms forbid redistribution, so not in the public repo);
  `VideoService.onModuleInit` syncs them to `uploads/music-lib` and
  `musiclib` resolves its assets dir from `__dirname`/`MUSIC_ASSETS_DIR`.
  Upload tool: `apps/api/scripts/upload-music-library.mjs`. Still open: safe production
  defaults for render concurrency in code, FAILED-marking of orphaned
  PROCESSING jobs on boot, `ensureTrack` atomic write, mobile "taking too
  long" state.
- **App copy centralised (2026-08-18)**: every user-visible string in
  `apps/mobile` — accessibility labels included — moved to
  `src/locales/en.json` and read through `t()` (`i18next` +
  `react-i18next` + `expo-localization`, language remembered in
  `AsyncStorage` under `nha.locale`). The app is still English-only; this
  is the step that makes Japanese a JSON file rather than a second pass
  over 36 components. Counts go through i18next plurals, and month names
  and date order come from the catalogue, because Japanese has no plural
  form and writes the month before the day.
  `pnpm --filter mobile check:i18n` diffs call sites against catalogues in
  both directions. Boundary held: copy is translated, data is not — a
  memo's text and an occasion's title stay fixture strings. **Open**:
  relation words (`Grandmother`, `Sister`) are English nouns in the
  fixtures today; the API should return a relationship type the app
  labels, which is a domain question — see `architecture.md` § Language.
- **Japanese type faces (2026-08-18)**: Zen Maru Gothic Bold/Black takes
  the Lora slot (emotional headings) and Noto Sans JP 400/500/600/700
  takes the Inter slot (body and UI). Neither Inter nor Lora has Japanese
  glyphs, so this is a swap rather than a fallback. Noto Sans JP for body
  because its statics map one-to-one onto the existing weight scale, and
  because rounded terminals lose definition at 12–14px with dense kanji —
  the app is explicitly read by grandparents. Decided, not yet built —
  see `docs/01-frontend/design-system.md`.
- **Japanese shipped, fonts deferred (2026-08-18)**: `ja.json` translated in
  full (197 keys), language follows the device and is switchable in
  Settings, choice remembered in `AsyncStorage`. Japanese plurals collapse
  to `_other` and dates flip order (`4月12日` vs `12 Apr`) — both verified.
  **Zen Maru Gothic and Noto Sans JP are chosen but not bundled**: ~30–50 MB
  of TTF across six weights is an app-size decision, not a design one. Until
  then `theme/typeface.ts` hands Japanese the device font with a real
  `fontWeight`; verified by prerender that English renders
  `font-family:Inter_600SemiBold` and Japanese renders `font-weight:600`
  with no Latin face applied.
- **API contract written from the server, not invented (2026-08-18)**:
  `apps/mobile/src/lib/api/` (types, endpoints, fetch client, `ApiError`)
  mirrors the 14 routes that actually exist in `apps/api` — auth and
  families. Screens are untouched and still read fixtures; this is the seam
  react-query hooks will sit on. Full map in `docs/00-shared/api-contract.md`.
  **Blocking gap found: there is no `GET` for relationships.** `POST` and
  `DELETE` exist and `FamilyDetail` returns `members` only, so the family
  tree cannot be built from the API as it stands — the tree is drawn from
  edges. Also missing for screens already built: email verification codes,
  password reset (1.1.7, deferred), a public read of an invite code,
  LifeProfile/LifeEvent/Memo, Post, and the whole of `apps/ai`.
