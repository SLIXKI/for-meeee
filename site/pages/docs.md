<!-- title: Asheo — Docs
     description: Install, BIN spec format, supported gateways, and troubleshooting. -->

# Docs

Asheo is a developer and QA tool for payment-gateway testing. It generates
algorithmically valid test cards from a BIN spec and swaps them into outbound
payment requests, so you can exercise a real checkout flow without hand-entering
card data.

## Install

Asheo is distributed as a `.zip` and loaded unpacked. It is not on the Chrome Web
Store.

1. Download from [download.asheobypasser.net](https://download.asheobypasser.net/) and verify the SHA-256 listed there.
2. Unzip it into a folder you intend to keep — Chrome runs the extension from that folder, so deleting it uninstalls Asheo.
3. Open `chrome://extensions`
4. Turn on **Developer mode** (top right).
5. Click **Load unpacked** and select the unzipped folder.

Requires Chrome 116 or newer. Works in Chrome, Edge, Brave, Arc and Opera.

**To update:** download the new zip, unzip it over the same folder, then press
**Reload** on the Asheo card in `chrome://extensions`.

## BIN spec format

The BIN field accepts a pattern, optionally pinning the expiry:

```
pattern[|MM[|YYYY]]
```

- `pattern` — 6 to 14 BIN digits, optionally followed by `x` placeholders marking wildcard digit positions
- `MM` — two-digit month, 01 to 12
- `YYYY` — four-digit year

Examples:

| Spec | Meaning |
|---|---|
| `424242` | plain 6-digit BIN |
| `424242xxxxxxxxxx` | BIN plus 10 wildcard positions (a 16-digit card) |
| `424242|12` | BIN with the expiry month pinned to December |
| `424242|12|2028` | BIN with month and year both pinned |

Generated numbers always satisfy the Luhn check and the card-network length rules,
so a card that a gateway rejects was rejected on its own terms, not because the
number was malformed.

## Supported gateways

41 gateway handlers ship in the current build, covering 40 selectable gateways plus
detection-only entries. Among them: **Stripe**, **Adyen**, **Braintree**,
**Worldpay**, **Razorpay**, **Tebex**, **Spreedly**, **Xendit**, **Cashfree**,
**Authorize.Net**, **SafeCharge**, **Gr4vy**, **NMI**, **Paddle**, **VGS**,
**Basis Theory**, **Pipo**, **Zuora** and more, across both hosted and custom
checkout flows.

The **gateway detector** shows a live badge on any page it recognises, driven partly
by real network signals rather than URL guesses — so it tells you when a swap will
actually fire, not just that a gateway is present.

## Troubleshooting

**The badge says a gateway is present but no swap happens.** Check that the
extension is enabled and that a BIN is set — the popup header shows `ACTIVE BIN`.
A blank BIN means nothing to inject.

**"Card not generated" on the first request after a page load.** The card engine
initialises asynchronously; the very first request on a freshly loaded page can
race it. Retry the payment — the second attempt uses a ready engine.

**Premium features are greyed out after entering a key.** Reopen the popup. The
entitlement is fetched and verified against an embedded public key, and the UI
reads the verified token rather than a live guess.

**A build stops working after a new release.** Only the current release is
authorized. Asheo verifies its own signed file manifest at startup and a superseded
build fails that check — download the current version.

**Nothing works at all and the console mentions verification.** That means the
files on disk don't match the signed manifest. Re-download rather than repairing:
a partial unzip over an old folder is the usual cause.

## Privacy

Asheo talks to its own licence and update server and nothing else. Generated cards,
BINs, gateway URLs and intercepted request bodies never leave your machine. The full
disclosure, including exactly which fields are sent, is on the
[network &amp; privacy page](/privacy).

## Help

Keys and support: [@moreash](https://t.me/moreash) — authorize an install:
[@AsheoPremiumBot](https://t.me/AsheoPremiumBot)
