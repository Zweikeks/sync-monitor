# Obsidian plugin sync-monitor

Obsidian plugin that tracks synchronization activity via the status of Obsidian's internal synchronization mechanism.<br>
Distinguishes local changes (edits by the user) from synchronization-related (external) changes.<br>
Displays its own sync status in the status bar - Sync: Active / Sync: Idle with a countdown timer.<br>
Offers the public awaitSyncInactive() that waits for sync to revert to idle or times out.<br>
Adds a test command for awaitSyncInactive().

(If you prefer to track via the vault file events modify, create, delete, see the older version, which, however, does _not_ distinguish between local and external changes.)

How many milliseconds of no file activity must pass before considering the sync to be idle again can be configured in the plugin settings.<br>
The 2-second timeout was sufficient on my desktop systems for files up to 5 MB in size - the largest size allowed by Obsidian Sync in the basic plan.

The public awaitSyncInactive() can be called from outside before doing operations that could interfere with sync operations. For example to avoid accidentally performing operations on a file while it is currently in a syncing state.

In addition, onExternalSettingsChange() of the Obsidian API should be used to be notified when the settings (data.json) of one's own plugin have changed.

## Note:
This is merely a study to test a conceptual idea. An idea how plugins could handle file access with at least some precaution in the Obsidian environment where files are automatically synchronized.<br>
I consider this a workaround to flaws of the environment. Relying on a certain timing is usually not a good idea. The mechanism mimics the behavior that users exhibit when working in this environment.

## Build:
Node.js<br>
npm install<br>
npm run build:dev

## Install manually:
Create .obsidian/plugins/sync-monitor in your local vault.<br>
Copy main.js and manifest.json to it.<br>
Enable the plugin in the Obsidian settings, community plugins.

## Test 1:
Modify or create a file on another device, 'Sync: Active' is displayed in the status bar.<br>
Wait the time configured in the plugin settings (2 seconds by default), the status bar reverts to 'Sync: Idle'.

## Test 2:
Open the command palette -> run 'Sync Monitor: Wait for Sync: Idle'.<br>
Displays a notice when sync reverts to idle.<br>
or<br>
Displays 'Timeout: Sync is still active.' if it didn't revert within the hardcoded timeout of 10 seconds.
