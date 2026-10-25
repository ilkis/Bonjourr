# Local website thumbnails

The **Thumbnail** switch in Quick Links settings controls thumbnail display and local capture on this device.
Click the **?** next to it to expand the capture explanation and **Clear thumbnail cache** button.
The block uses the standard 0.3-second dropdown transition with a measured height that follows text wrapping.
Cache-clear feedback appears beside the button inside the explanation. Other errors appear below the setting and in the link editor. Messages disappear after five seconds with a short fade.
The **Style** selector keeps the existing Large, Medium, Small, Inline and Text choices. Thumbnail cards follow
the selected size; Text remains text-only. Existing links initially show their icons. In the link editor,
use **Icon → Thumbnail → Apply changes** to request a new local screenshot, even if a cached screenshot exists.
Website favicon, URL and Local file retain Bonjourr's original icon loading, file conversion and storage.
They do not use the screenshot cache, image fetch/resize pipeline, upload limits or screenshot error messages.
Their normal icon dimensions are retained while Thumbnail is enabled. Only links whose source is Thumbnail
use preview cards. Choosing an ordinary icon removes the screenshot source for that link. Disabling Thumbnail
returns to the ordinary icon layout without deleting cached thumbnails or changing the selected Style. Enabling
it again displays cached images without capturing websites. The old Thumbnails style migrates to Medium.
File and URL thumbnail sources saved by older local test builds migrate to ordinary icons using their stored
URL or cached image. Migration does not download anything. Existing ordinary icons and capture sources are left intact.

Local screenshot capture is disabled by default. Enable **Thumbnail** in Quick Links settings to
request optional access to all websites. Chrome and Edge declare this through `optional_host_permissions`;
Firefox uses host patterns in `optional_permissions` to retain the existing Firefox 109 manifest minimum.
The declaration of a minimum version does not establish that this feature has been tested on that version.
Rejecting the permission request leaves the switch off. Clicking it again requests permission again from that
new user gesture. Disabling the switch removes active host access. Browsers may silently restore a permission
that the user already granted earlier.

Capture uses a temporary regular browser window. The background script serializes
capture requests and deduplicates requests for the same link and URL. It checks the saved source, permission,
and requesting tab before opening the website in a minimized window. Chrome can ignore the minimized state and
create a normal, focused window instead; the script then minimizes it at once and returns focus to the Bonjourr
window. Without this, the focus check below cancelled every capture in such a browser. After loading settles for
three seconds, it checks the saved link and requesting tab again. If the user selected another tab or left the
original window, capture stops before restoring the temporary window.

When capture stops because the user left, the Bonjourr page waits until its tab is visible and focused again and
then retries. It gives up after three attempts. Other failures show a specific reason when one is known: the website
took too long to load, or the browser did not return a screenshot.

The script restores the window with `focused: false`, preserving the browser-selected size and position. Changing
the viewport during restoration could leave screenshot readback pending on complex pages such as `x.com`.
Native Windows
restoration can briefly activate the temporary window or deactivate both windows. The script returns focus to
the original window immediately if no browser window or only the capture window is focused. It does not replace
another focused browser window. After 500 ms for painting, it allows a reload or redirect triggered by restoration
to settle in the background, then verifies the active capture tab and URL, captures
with `tabs.captureVisibleTab`, and resizes the image. Cleanup closes only the temporary window; if that window
still owns focus, it transfers focus before closing it. The original Bonjourr tab is never replaced by a website.

Chrome on Windows does not paint a window that other windows fully cover, such as a maximized Bonjourr window.
The screenshot then fails with `image readback failed` or never returns. A working screenshot returns within
milliseconds, so the first attempt waits at most two seconds. If it fails and the Bonjourr tab is still selected
and focused, the script brings the capture window in front once, waits 500 ms, and tries again for up to ten
seconds. Focus returns to the Bonjourr window right after that screenshot.

This is an experimental window flow, not an invisible capture API. A temporary window can briefly appear or
activate. The settings warning describes this behavior in all supported languages. A failed or interrupted capture keeps the previous image.

Images are 512 × 320 JPEGs stored in a separate IndexedDB database. They are not put in synced settings,
exports, or a screenshot service. The cache holds at most 100 images or 8 MiB, evicting the oldest writes.
Each image is tied to its link ID, website URL, and source. Failed refreshes preserve the previous image.
Deleting a link removes its image; **Clear thumbnail cache** and resetting settings remove cached images.
Opening a new tab, changing link styles, or enabling capture loads existing cached images. Clearing the cache
removes images and cancels pending captures. None of these actions starts a new capture or opens websites.
A screenshot is requested only by **Apply changes** in the link editor,
with capture enabled. Failed attempts are not retried on each new tab. A successful capture notifies other open
Bonjourr tabs to reload the locally cached image. There is no periodic refresh or background crawling of saved links.

Quick Links updates that change nothing skip the sync storage write. Applying unchanged link settings still
refreshes the Thumbnail. The icon radius slider saves only the radius, once it stops moving for 400 ms.

Screenshots use the browser's regular session and may contain signed-in information. Private-tab capture is
rejected. The online build retains its ordinary favicon, file and URL icon functionality.
Local screenshot capture is unavailable in the online build.

## Appearance

Thumbnail links keep landscape cards even without a cached screenshot. Their fallback icon retains its native
size. With Toggle link backgrounds enabled, fallback cards use frosted glass inside the Bonjourr frame.
Disabling backgrounds removes the frame and glass. Ordinary links retain their standard dimensions.

## Validation

The current implementation passed 30 tests with 104 test steps, formatting, and type checks. Builds completed
for Chrome, Edge, Firefox, and online. The regression suite includes clearing the cache during a pending refresh;
an obsolete display operation cannot restore the deleted thumbnail or overwrite a newer operation's status.

Linux Docker integration passed in Chrome 156.0.8078.47, Edge 155.0.4283.62, and Firefox 158.0.1. Tests cover
capture and decoded image pixels, refresh through Apply changes, cached reload, cancellation, ordinary favicon,
file and URL compatibility, all five styles, opt-out, and temporary-window cleanup. Focus changed transiently
in each browser and returned to the original window. Fully invisible capture is not established.

Integration used isolated profiles and synthetic loopback pages. Test copies received a mandatory host grant;
shipped manifests retain optional access. Actual permission dialogs were not exercised.

WebKit 26.5 checks passed in a persistent Linux profile using the online build with a private test hook to enable
cached thumbnail display. Checks cover card dimensions, backgrounds, frames, help animation, cache clearing,
status dismissal, and JPEG conversion. An ephemeral profile failed to write Blob images to IndexedDB with
`Error preparing Blob/File data to be stored in object store`; the persistent profile passed. External weather,
quotes, and background requests were deliberately blocked and produced recorded load errors.
These checks do not validate Safari extension APIs, permissions, or native window/focus behavior.

Native Windows testing confirmed that capture can briefly affect focus. In Chrome 155.0.8059.85 on Windows, started
without user interaction, the window was created normal and focused in every request, and the previous flow saved
no screenshot. The current build, with a synthetic page, x.com and fb.com, three requests each, saved 9 of 9
screenshots with Bonjourr in a normal window and 9 of 9 maximized, in 6 to 9 seconds per request. In the maximized
window, 5 of 9 needed the retry in front, which showed the page for about half a second. Screen recordings of the
same flow showed the temporary window for about 0.2 seconds when it was minimized after creation and for about
0.2 seconds when it was restored. Selecting another tab during loading stopped the capture with the expected error. Native macOS behavior, Safari extension
compatibility, and older browser versions remain unverified. The Firefox 109 manifest minimum has not been
validated for this feature. Authenticated sites, CAPTCHA, and continuously navigating pages require separate checks.

[Current measurements](thumbnails/validation.json) include browser results and build hashes. The screenshot uses
synthetic data in an isolated profile.

![Thumbnail setting and Icon selector](thumbnails/interface.png)

Run `deno task format`, `deno task types`, `deno task test`, and `deno task build`.

API references: [captureVisibleTab](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/captureVisibleTab),
[optional host permissions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/optional_host_permissions).
