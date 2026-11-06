# QR-code instrument booking for Google Workspace

A lightweight booking system for shared lab instruments. It runs entirely inside Google Workspace (a Google Sheet plus an Apps Script web app), so no server, database or paid software is needed.

Each instrument gets a QR sticker. Scanning it opens that instrument's schedule on a phone, where anyone can book a time slot with just a name. **No account or registration is needed.**

Originally built for the Photosymbiosis group at HIFMB Oldenburg; this guide explains how to set it up from scratch for any lab or institute.

---

## Contents

1. [Features](#1-features)
2. [What you need](#2-what-you-need)
3. [Files in this repository](#3-files-in-this-repository)
4. [Set up the Sheet and the code](#4-set-up-the-sheet-and-the-code)
5. [Configure your instruments](#5-configure-your-instruments)
6. [Configure the settings](#6-configure-the-settings)
7. [Publish the web app](#7-publish-the-web-app)
8. [Print the QR stickers](#8-print-the-qr-stickers)
9. [Optional: your own short address](#9-optional-your-own-short-address)
10. [Optional: your own logo, colours and tab icon](#10-optional-your-own-logo-colours-and-tab-icon)
11. [Day-to-day administration](#11-day-to-day-administration)
12. [Updating the code later](#12-updating-the-code-later)
13. [Privacy and data protection](#13-privacy-and-data-protection)
14. [Limits and known behaviour](#14-limits-and-known-behaviour)
15. [Troubleshooting](#15-troubleshooting)

---

## 1. Features

**For people booking**

- **Start page:** all instruments grouped by category, each with photo, owner group, location and a live "Free now" / "In use until …" status.
- **Filters:** by owner group and by location (room).
- **Three-day calendar per instrument:** tap a free time to start a booking.
- **Easy times:** start and end can be any time in 15-minute steps. Each instrument has a *suggested* booking length that is pre-filled, but people can choose shorter or longer.
- **Whole-day booking** for instruments such as incubators.
- **Email is optional.** With an email, people get a confirmation with a calendar file (.ics) and a personal link to cancel. While a booking is running, the same link releases the remaining time ("I'm done").
- **Instrument page extras:** a **Read the manual** button and a **Questions?** button that emails the instrument's contact person.
- **Statistics page:** most used instruments, sortable by number of bookings or total time, plus most active users, for the last 30, 90 or 180 days.
- **Works on phones and desktops**, with light and dark mode.

**For administrators**

- **Everything is managed in one Google Sheet:** instruments, settings and all bookings.
- **Adding an instrument** takes one new row plus printing its sticker.
- **Built-in checks:** no double bookings, a maximum booking length, and a limit on how far ahead people can book.
- **Optional safeguards:** restrict to institutional email domains, or require a shared lab PIN.
- **Automatic clean-up:** old bookings are deleted after a set number of days (GDPR).
- **Printable QR sticker sheet** for all instruments.

---

## 2. What you need

- **A Google Workspace account**, e.g. your institute's or lab's. A free personal Gmail account also works, but then emails come from that Gmail address.
- **Permission to publish Apps Script web apps to "Anyone".** Some institutional Workspaces block this; see [step 7](#7-publish-the-web-app). Check this first.
- **Recommended:** a shared lab account (e.g. `lab-booking@your-institute.org`) instead of a personal one. The app runs as, and sends email from, the account that publishes it, so a shared account keeps it running when people leave.

No programming knowledge is needed: the setup is copy, paste and click.

---

## 3. Files in this repository

| File | What it is | Where it goes |
|---|---|---|
| `apps-script/Code.gs` | Server code: booking logic, emails, statistics | Apps Script editor, file `Code.gs` |
| `apps-script/Index.html` | The booking pages people see | Apps Script editor, HTML file named `Index` |
| `apps-script/Qr.html` | The printable QR sticker page | Apps Script editor, HTML file named `Qr` |
| `docs/favicon.png` | Example browser-tab icon | Google Drive or your web space, optional ([step 10](#10-optional-your-own-logo-colours-and-tab-icon)) |
| `docs/index.html` | Forwarding page for a short address | Served by GitHub Pages or your own web space, optional ([step 9](#9-optional-your-own-short-address)) |
| `LICENSE` | MIT licence: free to use, adapt and share | – |
| `README.md` | This guide | – |

---

## 4. Set up the Sheet and the code

*About 10 minutes.*

1. **Create a new Google Sheet** in the account that will own the system, e.g. named "Instrument booking".
2. **Open Apps Script** from the Sheet: **Extensions → Apps Script**. Always open it from the Sheet; a project created separately at script.google.com is not connected to the Sheet and will not work.
3. **Paste the server code.** In the editor, click `Code.gs` in the file list, delete its contents, paste the contents of `Code.gs`, and save (Ctrl/Cmd + S).
4. **Add the two pages.**
   1. Click **+ → HTML** next to "Files" and name the file **`Index`**. The editor adds `.html` itself.
   2. Replace its contents with `Index.html` and save.
   3. Repeat for a file named **`Qr`** with the contents of `Qr.html`.
   4. The names are case-sensitive: `Index` and `Qr`, not `index` or `QR`.
5. **Set the time zone.** Click ⚙ **Project Settings** (left sidebar) and set **Time zone** to your local zone, e.g. *Central European Time – Berlin*.
6. **Run the setup.**
   1. Click `Code.gs` again. The Run button only appears when a `.gs` file is open.
   2. Choose **`setup`** in the function dropdown in the toolbar, then click **▷ Run**.
7. **Authorise the script.** Google asks for permission the first time. Click **Review permissions**, choose your account, then **Advanced → Go to … (unsafe)**, then **Allow**. The "unsafe" warning appears for every self-written script; it only means Google hasn't reviewed it.

When `setup` has run, the Sheet has three new tabs:

- **Instruments:** one row per instrument.
- **Bookings:** all bookings. Leave the column structure alone.
- **Settings:** lab name, safeguards, retention period and so on.

Setup also installs a daily clean-up job (around 03:00). After reloading the Sheet you'll see a **Booking** menu.

> **Instrument list:** the code arrives with a few generic example instruments (plate reader, microscopes, incubators and so on). Delete or edit those rows in the Instruments tab, or, before running `setup`, edit the `DEFAULT_INSTRUMENTS` list near the top of `Code.gs`.

---

## 5. Configure your instruments

Each row in the **Instruments** tab is one instrument. Changes take effect immediately, with no redeploy needed.

| Column | Meaning |
|---|---|
| **A · ID** | Short and unique, no spaces, e.g. `plate-reader`. **It is encoded in the QR code, so don't change it after printing stickers.** |
| **B · Name** | Shown on the page. |
| **C · Category** | Groups the start page, e.g. "Microscopy" or "PCR". Categories appear in the order of the sheet. |
| **D · SlotMinutes** | **Suggested** booking length in minutes, pre-filled when someone picks a start time. People can still book any length in 15-minute steps. **`1440` means whole-day booking:** times are hidden and people pick days. |
| **E · MaxHours** | Longest allowed single booking, in hours. 24 = 1 day, 168 = 1 week, 336 = 2 weeks. |
| **F · MaxDaysAhead** | How far in advance people can book. |
| **G · Active** | Untick to hide an instrument without deleting it or its bookings. |
| **H · Location** | Room, e.g. `214` or `1.08`. Shown on cards and used for the location filter. Write each room the same way in every row. |
| **I · Contact** | Person responsible, e.g. `Anna Müller <anna.mueller@your-institute.org>`. If it contains an email address, the page shows a **Questions?** button. |
| **J · Notes** | Short note on the instrument page, e.g. "Training required" or "Clean after use". |
| **K · Group** | Owner group(s). For shared equipment, list several separated by commas: `Photosymbiosis, Plankton Ecology`. Used for the group filter; spell each group identically everywhere. |
| **L · Photo** | Link to a photo: a Google Drive file shared as *Anyone with the link → Viewer*, or any public `https://` image URL. |
| **M · Manual** | Link to the manual (Drive file, PDF, manufacturer page). Shown as a **Read the manual** button. |

**Adding an instrument later:** add a row, tick *Active*, and print its sticker ([step 8](#8-print-the-qr-stickers)).

---

## 6. Configure the settings

The **Settings** tab holds one setting per row (column A = key, B = value). Changes take effect immediately.

| Key | Meaning |
|---|---|
| `LAB_NAME` | Shown in the header, emails and stickers. |
| `ALLOWED_EMAIL_DOMAINS` | Leave empty to let anyone book, with email optional. If filled, e.g. `your-institute.org, partner-university.de`, an email from those domains is **required** (subdomains accepted). |
| `LAB_PIN` | Optional shared PIN, e.g. posted in the lab. Empty means no PIN. |
| `ADMIN_EMAIL` | Optional address that receives a copy of every booking and cancellation. |
| `SHOW_NAMES` | `TRUE` shows booker names on the schedule and statistics; `FALSE` shows only "Booked" and hides the user ranking. Email addresses are never shown. |
| `RETENTION_DAYS` | Bookings that ended longer ago than this are deleted automatically. Default 180. The statistics page covers up to 180 days. |
| `PUBLIC_URL` | Optional short address ([step 9](#9-optional-your-own-short-address)). Used in QR codes and emails. |
| `LOGO_URL` | Optional header logo ([step 10](#10-optional-your-own-logo-colours-and-tab-icon)). Empty means the header shows text only. |
| `FAVICON_URL` | Optional browser-tab icon ([step 10](#10-optional-your-own-logo-colours-and-tab-icon)). |
| `PRIVACY_NOTE` | Text shown under the booking form. You may want to link your institute's privacy policy here. |

If a key is missing, e.g. after updating the code, run **Booking → Set up / repair**. It adds missing rows and columns without touching existing data.

---

## 7. Publish the web app

1. In the Apps Script editor, open **Deploy → New deployment**.
2. Click ⚙ next to "Select type" and choose **Web app**.
3. Fill in the deployment settings:
   - **Execute as:** *Me*
   - **Who has access:** *Anyone*
4. Click **Deploy** and copy the **Web app URL**. It ends in `/exec`; this is your booking page.
5. **Test it like a booker would:** open the URL in a private/incognito window **without signing in**. You should see the instrument list.

**If "Anyone" is not offered**, your Workspace admin restricts public web apps. Ask them to allow it. The alternative, "Anyone within [your domain]", forces bookers to sign in, so the tool is no longer registration-free.

---

## 8. Print the QR stickers

1. In the Sheet, choose **Booking → Show web app & QR links** and open the QR link. It is your web app URL with `?page=qr` added.
2. Choose a sticker width (45, 60 or 85 mm) and print. Laminated or water-resistant label paper works well next to benches and fume hoods.
3. Cut along the dashed lines and attach each sticker to its instrument.

Each code opens that instrument's page directly, e.g. `…/exec?instrument=plate-reader`.

If you plan to set up a short address ([step 9](#9-optional-your-own-short-address)), do that first: the codes are then shorter and easier to scan, and they keep working if you ever move the web app.

---

## 9. Optional: your own short address

Apps Script URLs are long (`https://script.google.com/macros/s/…/exec`). To use something like `https://book.your-institute.org`, put the forwarding page `docs/index.html` on a web address you control.

The redirect has to pass on the `?instrument=…` part of the address, which plain "URL forwarding" at domain registrars often drops. The page in this package does pass it on.

**Option A: you already have a website.** Ask its administrator to publish `docs/index.html` under the short address, e.g. as a subdomain or a `/book/` folder.

**Option B: free hosting on GitHub Pages**

1. **Get your own copy.** Fork or copy this repository into your GitHub account. It must be **public** for free GitHub Pages.
2. **Fill in the redirect page.** In `docs/index.html`, replace both occurrences of `YOUR-DEPLOYMENT-ID` with the ID from your web app URL (the part between `/s/` and `/exec`).
3. **Turn on Pages.** Go to **Settings → Pages → Source: Deploy from a branch**, choose branch `main` and folder **`/docs`**, and save.
4. **Set the address.** Under **Custom domain** on the same page, enter e.g. `book.your-institute.org`.
5. **Add a DNS record.** At whoever manages your domain's DNS (your registrar or IT department), add this record:
   - **Type:** `CNAME`
   - **Name:** `book`
   - **Value:** `<your-github-username>.github.io`
6. **Turn on HTTPS.** Once GitHub shows the domain as verified, which can take up to an hour, tick **Enforce HTTPS**.

Then, in the Sheet:

1. Set `PUBLIC_URL` to `https://book.your-institute.org`.
2. Test it: `https://book.your-institute.org/?instrument=<an-ID>` should open that instrument.
3. Print (or reprint) the stickers from `https://book.your-institute.org/?page=qr`.

---

## 10. Optional: your own logo, colours and tab icon

**Logo**

1. Upload a logo image (PNG or JPG, ideally on a white or transparent background) to Google Drive.
2. Share it as *Anyone with the link → Viewer*.
3. Paste the link into `LOGO_URL`.

The header shows it at about 52 px height. Any public `https://` image link also works.

**Browser-tab icon**

1. Upload a square image (e.g. 256 × 256 px) to Drive and share it the same way.
2. Paste the link into `FAVICON_URL`.

If your Workspace only allows sharing inside the organisation, external users won't see the icon. In that case host it next to the redirect page and use e.g. `https://book.your-institute.org/favicon.png`.

**Colours**

Colours are set at the very top of `Index.html` in the `:root { … }` block, with a matching dark-mode block below it:

| Variable | Used for |
|---|---|
| `--accent` / `--brand` | Buttons, links, selected filters (HIFMB navy `#1f3966`) |
| `--brand-light` | Header line, calendar highlights, statistics bars (HIFMB light blue `#6ba7d9`) |
| `--blk`, `--blk-line`, `--sel` | Booked blocks and the current selection in the calendar |
| `--free` / `--busy` | Free/in-use badges. Keep these green and red so availability stays obvious. |

After editing, publish a new version ([step 12](#12-updating-the-code-later)).

---

## 11. Day-to-day administration

- **See all bookings** in the **Bookings** tab. You can sort or filter it, but don't delete or reorder columns.
- **Cancel a booking manually** by setting its **Status** to `cancelled`.
- **Add a booking manually** (e.g. one recorded afterwards) by adding a row with an `InstrumentID` from the Instruments tab, `Start`/`End` as date-times, a name, and Status `confirmed`. Give it a unique BookingID and any random Token.
- **Take an instrument out of service** by unticking **Active**; its bookings stay in the record. For short maintenance, add a booking named e.g. "MAINTENANCE".
- **Duplicate people in the statistics:** the user ranking only counts bookings made with an email address and groups them by address. If someone used two different addresses (e.g. a typo), correct the Email column in the Bookings tab.
- **Delete old bookings now** with **Booking → Delete expired bookings now**. It otherwise runs every night.

---

## 12. Updating the code later

When you change `Code.gs`, `Index` or `Qr`:

1. Paste the new contents and save.
2. Go to **Deploy → Manage deployments → ✎ Edit → Version: New version → Deploy**.

This keeps the **same URL**, so printed stickers keep working. Don't use "New deployment" for updates; that creates a new URL.

If an update adds new columns or settings, run **Booking → Set up / repair** once afterwards.

---

## 13. Privacy and data protection

- **What is stored:** name, optional email, optional purpose, and the booking times, all in your own Google Sheet. Nothing is sent to third parties apart from Google, which hosts the Sheet and sends the emails.
- **What is public:** the schedule and statistics are visible to anyone with the link, including booker names if `SHOW_NAMES` is `TRUE`. Email addresses are never shown publicly.
- **Who can cancel:** only through the secret link in each confirmation email, or by an administrator in the Sheet.
- **Retention:** bookings are deleted automatically `RETENTION_DAYS` after they end.
- **Your institute's rules:** check with your data protection officer whether a short notice is enough or whether `PRIVACY_NOTE` should link your institute's privacy policy.

---

## 14. Limits and known behaviour

- **Speed:** Apps Script responds in about 1–3 s per action. That's normal for the platform.
- **Email quota:** Workspace accounts can send roughly 1,500 emails per day, far more than a lab needs. If the quota is ever exceeded, the booking still succeeds and the page shows the cancel link directly.
- **Size:** a Sheet comfortably handles tens of thousands of bookings, and the automatic clean-up keeps it small.
- **Google banner:** people outside your Workspace domain may see a small Google notice above the page ("This application was created by a Google Apps Script user"). It cannot be removed.
- **Booking rules:**
  - Start and end times use 15-minute steps.
  - A booking may start up to about half an hour in the past, so you can book the slot you're already using.
  - Whole-day instruments (`1440`) are booked by date.
- **Statistics:** bookings are counted by start date, including upcoming ones; cancelled bookings are excluded. Whole-day instruments count 24 h per booked day.

---

## 15. Troubleshooting

| Problem | Likely cause and fix |
|---|---|
| Opening `Index.html` directly shows only "Loading…" and `Unexpected token '<'` | The file only works inside Apps Script, not opened directly from disk. Follow steps 4–7. |
| `setup` finishes in a second and the Sheet stays empty | A different function was selected in the toolbar dropdown. Select **`setup`** and run it again. |
| `setup` fails with "not set up" or similar | The Apps Script project isn't attached to the Sheet. Open Apps Script from the Sheet via **Extensions → Apps Script** and paste the files there. |
| "Sorry, unable to open the file at present" | Usually caused by being signed into several Google accounts in one browser. Test in a private window, or use a separate browser profile for the owner account. |
| "You need access" when opening the link | The deployment isn't set to *Anyone*, or you opened the `/dev` test link (owner only). Use the `/exec` URL from **Deploy → Manage deployments**. |
| Links contain `/a/<your-domain>/macros/…` and don't work for outsiders | The code already rewrites these to the public form. If you still see them, set `PUBLIC_URL` to the plain `https://script.google.com/macros/s/…/exec` URL. |
| Photos, logo or tab icon don't show | The Drive file isn't shared as *Anyone with the link*, or your Workspace blocks external sharing. Use a public image URL instead. |
| An error mentions a missing file `Index` or `Qr` | The HTML files are misnamed. They must be exactly `Index` and `Qr`. |
| A new column or setting doesn't appear | Run **Booking → Set up / repair**. |
| Changes to the code don't show up | Publish a new version: **Deploy → Manage deployments → ✎ Edit → New version → Deploy**. |
