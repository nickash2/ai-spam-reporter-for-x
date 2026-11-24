# Privacy

AI Spam Reporter for X helps you identify accounts on Blocked for AI Reply and report an X post. It only sends a report when you choose to.

## Information the extension accesses

- On X pages, the extension reads author usernames and post links from visible post elements to match accounts against its lists and add report controls or badges. It does not read or collect post or reply text.
- When you use the popup on an X tab, it may read that tab's URL to identify the post you selected. The extension validates post links and only accepts supported X or Twitter post URLs.
- On `blockedforaireply.com`, the extension can fill the report form's post-link field with the link you selected. It does not read your account credentials or submit the form.

## Information stored on your device

The extension uses Chrome extension storage on your device:

- **Local storage:** the downloaded public username list; recently removed usernames and their removal dates; list sync timestamps and status; your display and filtering preferences; the optional X username you enter to be credited on the Top reporters board; and cached release-check results.
- **Session storage:** the selected post link while its report tab is open. The extension removes this draft when that tab closes.

The removed-account feed is limited to entries from the last 30 days. Cached lists and preferences remain in extension storage until refreshed, changed, or removed with the extension's data. The extension does not use a remote account or analytics service to store this information.

## Services contacted

The extension makes unauthenticated requests to:

- `blockedforaireply.com` to download its public active-username and removed-account feeds, on installation and approximately hourly while Chrome is running (or when you request a sync).
- The GitHub REST API to check for a newer extension release, approximately hourly and when you request a check.

When you choose **Report**, the extension sends the post link (and your optional username, if set) to `blockedforaireply.com/api/report.php`. If that fails, it falls back to opening `blockedforaireply.com` and placing the selected post link into its report form. As with any website, the services you visit may receive ordinary connection data from your browser, such as your IP address and browser information. See those services' own privacy information for how they handle data they receive.

## Reports are controlled by you

Reports are only sent when you select a report control. The extension sends the post link and, if you saved one, your username; it does not send post content or other X account information. Leave the username blank to report without credit. You can also copy the post link instead.

## Changes and questions

This policy may be updated when the extension's behavior changes. For questions or to report an issue, use the repository's GitHub issue tracker.
