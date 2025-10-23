//Obsidian plugin that tracks synchronization activity via the status of Obsidian's internal
//synchronization mechanism.
//Distinguishes local changes (edits by the user) from synchronization-related (external) changes.
//Displays its own sync status in the status bar - Sync: Active / Sync: Idle with a countdown
//timer.
//Offers the public awaitSyncInactive() that waits for sync to revert to idle or times out.
//Adds a test command for awaitSyncInactive().
//
//(If you prefer to track via the vault file events modify, create, delete, see the older version,
//which, however, does _not_ distinguish between local and external changes.)
//
//How many milliseconds of no file activity must pass before considering the sync to be idle again
//can be configured in the plugin settings.
//The 2-second timeout was sufficient on my desktop systems for files up to 5 MB in size - the
//largest size allowed by Obsidian Sync in the basic plan.
//
//The public awaitSyncInactive() can be called from outside before doing operations that could
//interfere with sync operations. For example to avoid accidentally performing operations on a file
//while it is currently in a syncing state.
//
//In addition, onExternalSettingsChange() of the Obsidian API should be used to be notified when
//the settings (data.json) of one's own plugin have changed.
//
//Note:
//This is merely a study to test a conceptual idea. An idea how plugins could handle file access
//with at least some precaution in the Obsidian environment where files are automatically
//synchronized.
//I consider this a workaround to flaws of the environment. Relying on a certain timing is usually
//not a good idea. The mechanism mimics the behavior that users exhibit when working in this
//environment.
//
//Build:
//Node.js
//npm install
//npm run build:dev
//
//Install manually:
//Create .obsidian/plugins/sync-monitor in your local vault
//Copy main.js and manifest.json to it
//Enable the plugin in the Obsidian settings, community plugins
//
//Test 1:
//Modify or create a file on another device, 'Sync: Active' is displayed in the status bar
//Wait the time configured in the plugin settings (2 seconds by default), the status bar reverts to
//'Sync: Idle'
//
//Test 2:
//Open the command palette -> run 'Sync Monitor: Wait for Sync: Idle'
//Displays a notice when sync reverts to idle
//or
//Displays 'Timeout: Sync is still active.' if it didn't revert within the hardcoded timeout of 10
//seconds.

import {Plugin, Notice, StatusBarItem, PluginSettingTab, Setting, sanitizeHTMLToDom} from 'obsidian';

const WAIT_FOR_IDLE_TIMEOUT = 10000; //milliseconds

export interface SyncMonitorSettings {
    syncInactivityResetMs: number;
}

export const DEFAULT_SETTINGS: SyncMonitorSettings = {
    syncInactivityResetMs: 2000,
};

export default class SyncMonitorPlugin extends Plugin {
    private syncActive: boolean = false;
    private syncResetTimeout: number | null = null;
    private statusBarItem: StatusBarItem | null = null;
    private fileEventHandlers: Array<() => void> = [];
    private syncResetTime: number | null = null;
    private countdownInterval: number | null = null;
    private sync_instance = this.app.internalPlugins.plugins.sync.instance;
    private oldSyncStatus = ''

    settings: SyncMonitorSettings;

    async onload() {
        await this.loadSettings();

        this.statusBarItem = this.addStatusBarItem();
        this.updateStatusBar();

        this.setSyncActive(); //sync probably runs during Obsidian startup, so we default to active

        this.registerSyncStatusEvent();
        this.addCommands();

        this.addSettingTab(new SyncMonitorSettingTab(this.app, this));
    }

    onunload() {
        this.unregisterSyncStatusEvent();

        if (this.syncResetTimeout) {
            clearTimeout(this.syncResetTimeout);
        }

        this.stopCountdownInterval();
        this.statusBarItem?.remove();
    }

    private async loadSettings() {
        //load settings after sync has finished
        await this.awaitSyncInactive(WAIT_FOR_IDLE_TIMEOUT);
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    private async saveSettings() {
        await this.saveData(this.settings);
    }

    async onExternalSettingsChange() {
        await this.loadSettings();
    }

    private registerSyncStatusEvent() {
        this.sync_instance.on('status-change', this.onSyncStatusChanged.bind(this));
    }

    private unregisterSyncStatusEvent() {
        this.sync_instance.off('status-change', this.onSyncStatusChanged.bind(this));
    }

    private startCountdownInterval() {
        if (this.countdownInterval !== null) return;

        this.countdownInterval = window.setInterval(() => {
            this.updateStatusBar();
        }, 1000);
    }

    private stopCountdownInterval() {
        if (this.countdownInterval !== null) {
            clearInterval(this.countdownInterval);
            this.countdownInterval = null;
        }
    }

    //sets syncActive, inits timers
    private setSyncActive() {
        const wasInactive = !this.syncActive;
        this.syncActive = true;

        if (wasInactive) this.startCountdownInterval();

        //reset the timeout
        if (this.syncResetTimeout !== null) {
            clearTimeout(this.syncResetTimeout);
        }

        const timeoutMs = this.settings.syncInactivityResetMs;
        this.syncResetTime = Date.now() + timeoutMs;

        this.syncResetTimeout = window.setTimeout(() => {
            this.syncActive = false;
            this.syncResetTimeout = null;
            this.syncResetTime = null;
            this.stopCountdownInterval();
            this.updateStatusBar();
        }, timeoutMs);

        this.updateStatusBar();
    }

    onSyncStatusChanged() {
        //this.sync_instance.syncStatus exists, even with a local vault, without
        //any sync service configured, the string is 'Uninitilized' in this case
        let newSyncStatus = this.sync_instance.syncStatus.toLowerCase();

        //process only if it has actually changed
        if(newSyncStatus !== this.oldSyncStatus) {

            //downloading versus uploading
            //deleting    versus deleting remote
            //renaming is deleting (remote) + down/uploading
            if(    newSyncStatus.includes('downloading')
               || (newSyncStatus.includes('deleting') && !newSyncStatus.includes('remote'))) {
                this.setSyncActive();
            }

            this.oldSyncStatus = newSyncStatus;
        }
    }

    //update the status bar text
    private updateStatusBar() {
        if (!this.statusBarItem) return;

        if (!this.syncActive) {
            this.statusBarItem.setText('Sync: Idle');
        } else {
            let countdown = '';
            if (this.syncResetTime !== null) {
                const remainingMs = this.syncResetTime - Date.now();
                const seconds = Math.ceil(remainingMs / 1000);
                if (seconds > 0) {
                    countdown = ` (${seconds}s)`;
                }
            }
            this.statusBarItem.setText(`Sync: Active${countdown}`);
        }
    }

    //async wait until sync is inactive (idle) or the given time has passed
    public async awaitSyncInactive(timeoutMs: number): Promise<void> {
        const startTime = Date.now();

        return new Promise((resolve, reject) => {
            const interval = 100;

            const check = () => {
                if (!this.syncActive) {
                    resolve();
                } else if (Date.now() - startTime > timeoutMs) {
                    reject(new Error('Timeout waiting for sync to become inactive.'));
                } else {
                    setTimeout(check, interval);
                }
            };

            check();
        });
    }

    //test command to manually trigger sync wait
    private addCommands() {
        this.addCommand({
            id: 'test-wait-sync-finish',
            name: 'Wait for Sync: Idle',
            callback: async () => {
                new Notice('Waiting for sync to become inactive (timeout: 10s)...');
                try {
                    await this.awaitSyncInactive(WAIT_FOR_IDLE_TIMEOUT);
                    new Notice('Sync is now inactive.');
                } catch (err) {
                    new Notice('Timeout: Sync is still active.');
                }
            },
        });
    }
}

class SyncMonitorSettingTab extends PluginSettingTab {
    plugin: SyncMonitorPlugin;

    constructor(app: App, plugin: SyncMonitorPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Sync Monitor Settings' });

        const syncInactivityResetMsDescr: DocumentFragment = sanitizeHTMLToDom(
              'Milliseconds of inactivity before sync is considered finished.'
            + '<br>'
            + `Min. 0, max. ${WAIT_FOR_IDLE_TIMEOUT} milliseconds.` //must be backticks here
        )

        new Setting(containerEl)
            .setName('Sync inactivity reset timeout')
            .setDesc(syncInactivityResetMsDescr)
            .addText(text => text
                .setPlaceholder('2000')
                .setValue(this.plugin.settings.syncInactivityResetMs.toString())
                .onChange(async (value) => {
                    const parsed = parseInt(value);
                    if (!isNaN(parsed) && parsed >= 0 && parsed <= WAIT_FOR_IDLE_TIMEOUT) {
                        this.plugin.settings.syncInactivityResetMs = parsed;
                        await this.plugin.saveSettings();
                    }
                }));
    }
}
