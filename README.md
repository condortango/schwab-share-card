# schwab-share-card

A bookmarklet that turns one row of your Schwab Positions table into a
shareable performance card and puts it on your clipboard as a PNG. It runs
inside the page you already have open, makes no network requests at all, and
shows only the instrument and its total gain or loss.

## Install

The whole program is a single `javascript:` URL, so installing it means
creating one bookmark.

The easy way: open <https://condortango.github.io/schwab-share-card/> and
drag the **Schwab share card** link onto your bookmarks bar.

By hand: copy the one line in `src/schwab-share-card/schwab-screenshotter.bookmarklet.txt`,
create a new bookmark, and paste that line as the bookmark's URL. Name it
whatever you like.

Some bookmark managers silently strip the leading `javascript:` when you paste
a URL, and the bookmark then does nothing at all. If that happens, edit the
bookmark and type `javascript:` back on the front of it.

## Use

1. Open your Schwab Positions page and wait for the table to finish loading.
2. Click the bookmark. A banner appears at the top of the page reading
   `Click a position (Esc to cancel)`.
3. Click the position row you want. It highlights as you move over it, and
   the click never reaches Schwab's own handlers.
4. A small sheet titled `Share card` asks what to put on the card. The
   switches along the top pick which lines it carries — `Quantity`,
   `Day change` and `Overall change` — and the buttons under them pick how
   those numbers are written: `% only`, `$ only` or `both`. Each of those
   three wears a clipboard, because clicking one writes the card to yours.
5. Between the switches and the buttons the sheet shows the card itself, drawn
   small. It starts on `% only`; moving the pointer onto another mode, or
   tabbing onto it, redraws it in that mode, and switching a line on or off
   redraws it too. Nothing is copied until you click. A position the card
   cannot be drawn for shows `No preview` there instead, and the buttons still
   work.
6. Click a mode and the card is copied. Paste it wherever you are posting.

Esc cancels at any stage, and so does clicking off the sheet.

To see what actually landed on your clipboard, open
<https://condortango.github.io/schwab-share-card/paste.html> and press Ctrl-V
(Cmd-V on a Mac) there. It draws the pasted image and prints its pixel size — a
card is 1080 by 1920 — and, like the bookmarklet, it sends the image nowhere.

## The three modes

Every card carries the same frame: the instrument on top, a label under it, and
a timestamp along the bottom. An option adds one line between the instrument
and the label, `buy-to-open` for contracts you bought and `sell-to-open` for
contracts you wrote, read off the sign of the quantity; a share position never
gets it. Behind them is a dark blue field with a faint ring texture and a light
wash through the middle, fading back to plain colour towards the edges. What
the modes change is how every number on it is written.

- `% only` — the total gain or loss as a percentage, and no dollar amount
  anywhere on the card.
- `$ only` — the total gain or loss as a dollar amount, and no percentage.
- `both` — the percentage as the large number, with the dollar amount on a
  second line beneath it.

In all three modes the colour of a number follows the sign of its own dollar
figure, so green and red can never disagree with the position.

## The three lines

The switches pick what the card carries. Whatever is on it is written in the
mode you then choose.

- `Overall change` — the gain or loss on the position since you opened it,
  under the label `Performance`. It is the card's headline, and the only line
  that starts switched on.
- `Day change` — today's gain or loss, on a line of its own under the
  headline. Switch the overall change off and the day change becomes the
  headline instead. A row whose day figures cannot be read drops the line
  rather than putting a blank on the card.
- `Quantity` — the shares or contracts you hold, signed, so a written option
  keeps its minus.

Switch every line off and there is no card to copy: the sheet's title changes
to `Turn on a line to copy`, and the mode buttons wait until you turn a line
back on. Cancel and Esc still close the sheet.

## What it says

One success message and four refusals, quoted here exactly as they appear so
you can search for whichever one you saw:

- `Copied to clipboard` — the card is on your clipboard.
- `Clipboard needs a secure page (https)` — the page is plain http, which
  hides the clipboard from every script on it.
- `This browser cannot copy images` — the browser has no image clipboard
  support to use.
- `Clipboard permission denied` — the browser refused the write.
- `Could not copy the card` — the card could not be drawn or the write broke.

## Privacy

The program is the bookmark. There is no server, no account, no extension and
no build you have to trust: the entire thing is the text sitting in that one
bookmark, and you can read it.

It makes no network requests of any kind. Not to a server of mine, not to an
analytics endpoint, not to a font host. It also loads no image, script,
stylesheet or frame, opens no socket or worker, and writes nothing to cookies,
local storage or any other persistent store. The one browser capability it
uses is the clipboard write.

Nothing leaves the page except what you paste. The card is drawn on a canvas
in your own browser and handed straight to the clipboard.

This is enforced, not just asserted. Two tests in the suite hold the line:
`no-network-static` scans both the readable source and the built URL for every
way a script could reach an endpoint, load a resource, run remote code or
persist data, and fails on any hostname or `scheme://` URL; `no-network-runtime`
replaces those capabilities on the globals with traps that throw, runs the
whole flow through the exact artifact you install, and fails if any trap fired.

## Look at the card before you post it

**Check what is on the card before it goes anywhere public.** The preview in
the sheet is there to be read: it is the same card the clipboard gets, only
smaller. This matters most in `$ only` and `both`, which put a real dollar
amount on the image — the size of your gain or loss is information about the
size of your position, and once posted it is posted. `% only` is the mode to reach for when you want to
share the result without the scale.

The card never shows your account number, your cost basis or your market value,
and nothing in the program reads them. Your quantity is the one holding figure
you can put on a card, and it stays off until you switch it on, so it cannot
reach one by accident.

## Build and test

Node 20 or newer, no dependencies, no install step.

```
node src/schwab-share-card/build.mjs
node --test src/schwab-share-card/schwab-screenshotter.test.mjs
```

The build reads the readable module, strips comments and `export` keywords,
squeezes the whitespace, wraps the result in an IIFE and percent-encodes it,
then writes the bookmarklet URL and the install page. The suite covers parsing,
formatting, the card layout, the painter, the clipboard, the overlays, the
whole flow end to end, and the two privacy tests above.
