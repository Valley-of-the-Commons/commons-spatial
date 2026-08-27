# What is already built, and where your code goes

Written for anyone arriving at the Valley of the Commons who would rather
build on what is here than beside it. It says what runs today, what is a
half-finished idea, and what is only a sentence somebody said once. Those are
three different things and conflating them wastes a week that could have been
spent on the interesting part.

Nothing here is finished and nothing here is defended. If a piece of it is
wrong, the useful response is a better version, not permission to write one.

Status is marked honestly:

- **running** — in use, has real data in it
- **built, empty** — works, nobody has put anything in it yet
- **started** — partly there, known gaps
- **wanted** — nobody has built it

---

## 1. The spatial layer — *running*, and it is this repo

A Leica survey of the Hirschwangerhof: 1.9 million points, **interiors
included**. A horizontal slice through the ground floor is a readable floor
plan, with interior walls, doorways and furniture. That is what makes going
into a room show the actual room instead of a model of one.

| | |
|---|---|
| viewer | `viewer/cloud.js`, 12 KB, WebGL2, no dependencies |
| format | `format/CHPC.md`, uint16 quantised, ~1 mm per step over 68 m |
| levels | 120k in about a second, 650k behind it, one shared frame |
| picking | world coordinate under the cursor, within 0.5 m of the surface |
| flying | eased camera moves, cancelled the moment a hand touches the canvas |
| focus | a radius that fades the building away so a room reads as a room |

**Where your code goes.** The format is the contract. A game engine reads the
uint16 buffer directly with `origin` and `scale` as uniforms. The viewer is a
reference implementation, not a dependency.

Obvious next pieces, none of them started:

- **A walkthrough path.** Flying between anchor points exists; a first-person
  walk with collision does not. The point cloud has no surfaces, so you would
  either mesh the floor or constrain to a height above a sampled ground plane.
- **Tiling.** Both levels load whole. Past a few million points that stops
  being reasonable and you want an octree with view-dependent loading.
- **A mesh lane.** There is a 61 MB mesh of the main building at
  [Jeff-Emmett/commons-hub-3d](https://github.com/Jeff-Emmett/commons-hub-3d).
  Nothing here uses it. Holes in it are where the scanner could not see, under
  eaves and behind furniture, so they are missing data rather than errors.
- **Anchoring the real world to it.** Every device below wants a position in
  this coordinate frame. That is the join nobody has made yet, and it is
  probably the most valuable thing in this document.

---

## 2. The Hub platform — *running*, and kept separate

A private app runs the house: a programme, boards for each track, a repair
queue pinned to the scan, a kitchen rota, an inventory of two workshops, and
a recorder that writes down what a room said.

**It is not in this repo.** It holds people's names, their recordings, and
credentials for whoever is running each part of the house, and the code and
the data are not separable enough to publish safely yet. That is a job someone
could do, and it would be a good one.

The shape is the part worth sharing, so it can be built against, argued with,
or done better:

- **Identity is a person, boards are a list.** Somebody leading two things has
  one passphrase and one passport, not two of each.
- **Everything a lead writes is private until they publish it.** The
  coordinator's dashboard shows *that* a board has three drafts and has not
  published in nine days. It cannot show the drafts. The people who can are
  named on every lead's own screen.
- **Nothing goes live by accident.** A repair, a rota week and a document all
  start invisible and become visible in one deliberate act.
- **The machine proposes, a person commits.** ClaudIA reads a whiteboard
  photograph, a recording, or pasted notes and returns a draft with a
  confidence on every line. Nothing it produces is written until somebody has
  corrected it. Anything it guessed is drawn differently from anything it read.
- **Points are one currency.** Doing a job or a kitchen shift pays embers,
  once, guarded by a unique reference in an append-only ledger.

**Where your code goes.** There is no public read API yet — see §6. Building
one is a well-defined piece of work and the first thing to do if you want the
official site, a kiosk, or a game to show live house data.

---

## 3. Off-grid messaging — *started*

Reticulum and LXMF, so the building can reach people with the router
unplugged. Members can bind an LXMF address to their identity, and the roster
shows who is reachable off-grid.

Three walls, written down so nobody hits them twice:

1. **Reticulum does not run on Cloudflare**, or on any edge function. No raw
   sockets, no long-lived process. A real node is a real machine.
2. **An https page cannot fetch an http node on the LAN.** Mixed content, and
   no header turns it off. A link and a QR code work, because top-level
   navigation is not blocked. An embedded chat does not, until there is a
   tunnel or the node serves a copy of the site from its own origin.
3. **A LoRaWAN gateway is not an RNode** and cannot carry Reticulum. The
   antenna at the Hirschwangerhof is still unidentified.

**Where your code goes.** Standing up a node on real hardware is the unblock
for everything in this section. 868 MHz in Austria.

---

## 4. Rolling Rob — *started*, mostly on paper

A Pi with wheels, a camera and a microphone. It exists, it is logged in the
device bench, and its actual specification is still unknown: model of Pi,
radio, how it is driven.

There is a seven-rung ladder from "a Pi on a shelf" to "reachable with the
router unplugged". A rung lights up because a **recorded attempt** succeeded
over that path, never because somebody ticked a box. Today: **1 of 7**.

**Where your code goes.** Every attempt at reaching a device is logged whether
it worked or not, by path: wifi, lan, lora, rnode, tunnel, serial. Adding a
transport means adding a path and recording attempts over it.

---

## 5. Hardware at the Hub — *wanted*

None of this exists yet. It is here so that two people do not build the same
half of it.

- **A server in the building.** Everything currently depends on an internet
  connection to a Cloudflare edge and a hosted database. A machine in the
  house that keeps working when the valley's uplink does not is the single
  biggest change available.
- **LoRa devices and wearables.** Nothing is deployed. The interesting
  question is not the radio, it is what a device knows about *where* it is in
  §1's coordinate frame.
- **The machines.** A Bambu Lab printer with a four-slot feeder, an xTool
  laser, a paper guillotine, a rackmount server mid-build. All logged from
  photographs and **none of them verified by a human yet**, which is a job
  somebody can finish in an hour with a phone.

---

## 6. The joins nobody has made

These are the pieces where a week of work changes what everything else can do.

1. **A public read API.** Today every table requires membership, so nothing
   outside can show anything. Decide what is public — the programme is the
   obvious first thing — and expose exactly that. Read-only is a morning; a
   site that writes back is a different problem.
2. **Device position in the scan frame.** §1 and §5 do not know about each
   other. Once a device reports where it is, the map stops being a picture of
   a building and starts being a view of a system.
3. **A walkthrough that is not a fly-to.** See §1.
4. **Getting a Reticulum node up.** See §3. Everything off-grid waits on it.

---

## What this place has learned the hard way

Offered rather than imposed. Each of these was learned by getting it wrong,
and each cost more than reading it will.

- **Say what you are unsure of.** Every machine reading in this system carries
  a confidence, and a guess is displayed differently from a fact. A plausible
  wrong name is the one nobody catches.
- **Propose, do not commit.** Anything generated lands as a draft a person
  edits.
- **Empty is honest.** A board with nothing in it says so. Nothing is seeded
  with plausible-looking example content, because somebody then has to work
  out which rows are real.
- **Test by running it, not by reading it.** Several of the worst bugs here
  looked correct: an RPC that ordered by a column its own subquery did not
  select, a `to_jsonb(x)` that returned a column instead of the row and made a
  map silently draw nothing for days.
- **Nothing hidden from the people it concerns.** If a coordinator can read
  your drafts, your screen says so.
