//Obsidian plugin that tracks sync activity via vault file events (modify, create, delete).
//This approach assumes that sync operations manifest as file-level events (which is true for
//Obsidian Sync or services like Dropbox).
//Displays its internal sync status in the status bar - Sync: Active / Sync: Idle with a countdown
//timer.
//Adds a test command that waits for sync to revert to idle or times out.
//
//Does _not_ distinguish between local changes (user edits) and sync-related (external) changes.
//
//How many milliseconds of no file activity must pass before considering the sync to be idle again
//can be configured in the plugin settings.
//
//The public awaitSyncInactive() can be called from outside before doing operations that could
//interfere with sync operations. For example to avoid accidentally performing operations on a file
//while it is currently in a syncing state.
//The large timeouts in the seconds range here are for manual testing. I am assuming the timeouts
//must be much smaller in real-world use, keeping a balance between GUI responsiveness and the
//level of protection.
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
//Modify or create a file, 'Sync: Active' is displayed in the status bar
//Wait the time configured in the plugin settings (5 seconds by default), the status bar reverts to
//'Sync: Idle'
//
//Test 2:
//Open the command palette -> run 'Sync Monitor: Wait for Sync: Idle'
//Displays a notice when sync reverts to idle
//or
//Displays 'Timeout: Sync is still active.' if it didn't revert within the hardcoded timeout of 10
//seconds.

import { Plugin, TAbstractFile, Notice, StatusBarItem, PluginSettingTab, Setting } from "obsidian";

export interface SyncMonitorSettings {
    syncInactivityResetMs: number;
}

export const DEFAULT_SETTINGS: SyncMonitorSettings = {
    syncInactivityResetMs: 5000,
};

export default class SyncMonitorPlugin extends Plugin {
    private syncActive: boolean = false;
    private syncResetTimeout: number | null = null;
    private statusBarItem: StatusBarItem | null = null;
    private fileEventHandlers: Array<() => void> = [];
    private syncResetTime: number | null = null;
    private countdownInterval: number | null = null;

    settings: SyncMonitorSettings;

    async onload() {
        await this.loadSettings();

        this.statusBarItem = this.addStatusBarItem();
        this.updateStatusBar();

        this.registerVaultEvents();
        this.addCommands();

        this.addSettingTab(new SyncMonitorSettingTab(this.app, this));
    }

    onunload() {
        this.unregisterVaultEvents();
        if (this.syncResetTimeout) {
            clearTimeout(this.syncResetTimeout);
        }
        this.stopCountdownInterval();
        this.statusBarItem.remove();
    }

    private async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    private async saveSettings() {
        await this.saveData(this.settings);
    }

    //register vault file change events
    private registerVaultEvents() {
        const handler = (file: TAbstractFile) => this.onFileChanged(file);

        this.fileEventHandlers.push(
            this.app.vault.on("modify", handler),
            this.app.vault.on("create", handler),
            this.app.vault.on("delete", handler)
        );
    }

    private unregisterVaultEvents() {
        this.fileEventHandlers.forEach(off => off());
        this.fileEventHandlers = [];
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

    //called on any file activity
    private onFileChanged(file: TAbstractFile) {
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

    //update the status bar text
    private updateStatusBar() {
        if (!this.statusBarItem) return;

        if (!this.syncActive) {
            this.statusBarItem.setText("Sync: Idle");
        } else {
            let countdown = "";
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
                    reject(new Error("Timeout waiting for sync to become inactive."));
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
            id: "test-wait-sync-finish",
            name: "Wait for Sync: Idle",
            callback: async () => {
                new Notice("Waiting for sync to become inactive (timeout: 10s)...");
                try {
                    await this.awaitSyncInactive(10000);
                    new Notice("Sync is now inactive.");
                } catch (err) {
                    new Notice("Timeout: Sync is still active.");
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

        containerEl.createEl("h2", { text: "Sync Monitor Settings" });

        new Setting(containerEl)
            .setName("Sync inactivity reset timeout")
            .setDesc("Milliseconds of inactivity before sync is considered finished")
            .addText(text => text
                .setPlaceholder("5000")
                .setValue(this.plugin.settings.syncInactivityResetMs.toString())
                .onChange(async (value) => {
                    const parsed = parseInt(value);
                    if (!isNaN(parsed) && parsed > 0) {
                        this.plugin.settings.syncInactivityResetMs = parsed;
                        await this.plugin.saveSettings();
                    }
                }));
    }
}
