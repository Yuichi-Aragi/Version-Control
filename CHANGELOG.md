***

**Version: 1.9.41**

#### 🎨 Improvements & UX

* **General Stability:** Implemented stability improvements for a more reliable experience.

***

**Version: 1.9.40**

#### ✨ New Features

* **Permanent Data Cleanup:** Triggering the "clean-up orphaned version data" command now permanently deletes all version control data associated with notes that have already been deleted.
* **Automatic Data Removal:** Deleting any note while the plugin is active will now result in the permanent deletion of all stored version control data for that specific note.

#### 🎨 Improvements & UX

* **General Stability:** Implemented stability improvements for a more reliable experience.

***

**Version: 1.9.39**

#### ✨ New Features

* **Disk Persistence Toggle:** Added a new setting that allows you to enable or disable the disk persistence of your edit history of any branch.

#### 🎨 Improvements & UX

* **Stability Improvements:** Implemented various fixes to enhance the overall stability of the plugin.

***

**Version: 1.9.37**

#### ✨ New Features

* **Side-by-Side Diff View:** Added support for a side-by-side diff layout.
    * All existing diff modes—Smart, Character, Word, and Line—now support both unified and side-by-side views.

#### 🎨 Improvements & UX

* **UI/UX Polish:** Implemented significant enhancements to the timeline and settings panel for a better user experience.

***

**Version: 1.9.36**

#### ✨ New Features

* **Automatic Data Persistence:** Edit history now supports automatic synchronization across devices.
    * Previously, data was restricted to `indexedDB`, but it is now stored in `.vctrl` extension files, allowing for seamless syncing.
    * The process runs automatically in the background without requiring user intervention.
    * Edit history data is located at `.versiondb` (or your custom location) `/vc-id/branches/*`.
    
#### 🔍 Technical Note: Inspecting `.vctrl` Files

If you wish to manually inspect the version control files, you can follow these steps:
1. Change the file extension from `.vctrl` to `.zip` and extract it.
2. Inside, you will find a `manifest.json`, `data.json`, and a `blobs` folder.
3. In the `blobs` folder, change the `.bin` extensions to `.zip` and extract them to reveal extension-less files.
4. Add the `.md` extension to these files to make them readable.    

***

**Version: 1.9.35**

#### ✨ New Features

* **Dashboard Heatmap:** Introducing the new **Dashboard**! It features a heatmap that visualizes the number of versions/edits you've made per day. Access it by clicking the top-left corner button to open the dropdown menu and selecting **Dashboard**.
* **Zip and Gzip Export:** Added support for **zip** and **gzip** formats when exporting versions and edits.

#### 🎨 Improvements & UX

* **Edit History Stability:** The edit history feature has been stabilized and is now as robust and reliable as the version history. (Previously, it was noted as being in an early stage.)

#### ⚠️ Important Notice

* **Potential Data Inconsistency Fix:** This release includes necessary changes for future stability, which might result in **SOME data loss** for a small number of users. We deeply apologize for this inconvenience. This is crucial for addressing and removing existing inconsistencies that could have led to more significant data loss in the future.
* **Ignorable Errors:** You may safely **ignore all file rename errors** you encounter. These are non-critical, false positives caused by concurrent operations and do not affect the functionality or integrity of your data.

***

**Version: 1.9.34**

#### 🎨 Improvements & UX

* **General Stability:** Squashed many bugs for a more reliable experience.

***

**Version: 1.9.33**

#### ✨ New Features

* **Compression Feature:** Added an optional compression feature. When enabled, it ensures all version history files are compressed before being written to disk, which helps limit file size.
* **Manual Decompression Note:** If you want to use the version file without the plugin, you can change the version file's `.md` extension to `.gz`, extract the file, rename the extracted file by adding the `.md` extension, and then open it.

***

**Version: 1.9.32**

#### ✨ New Features

* **Edit History (Per Branch):** Introducing passive, automatic snapshots of every change you make.
    * There are now two types of history: **Version History** (for intentional, milestone saves) and **Edit History** (for granular, automatic changes).
    * Edit History conserves resources by saving only highly compressed diffs (like Git) between changes, while Version History continues to save the full content.
    * Currently, Edit History data is stored solely in IndexedDB (request a feature for disk storage).
    * **Switching Views:** Simply click on the "Version History" header text (at the top left corner of the version control view in the right sidebar) to toggle between "Version History" and "Edit History."

* **Early Stable Release:** This is an early stable release of the Edit History feature. While major problems are unlikely (i hope), minor inconsistencies are possible, please open an issue if you encounter any inconsistencies. Your feedback is highly valued!

***

**Version: 1.9.31**

#### 🐞 Bug Fixes

* Fixed: Failure to save version due to "potential xss attempt" 

***

**Version: 1.9.30**

#### 🐞 Bug Fixes

* Fixed a bug where the plugin was not working because of a Dexie version conflict with another plugin. Make sure to restart obsidian after updating this plugin.

***

**Version: 1.9.29**

#### ✨ New Features

* **Timeline:** You can now view all of the diffs in one panel, allowing you to see and search all of the changes in one place. Forgot in which version you had changed any text? Just search in the timeline.

***

**Version: 1.9.27**

#### 🎨 Improvements & UX

* **UI/UX Polish:** Implemented various UI/UX enhancements for a more better experience.

***

**Version: 1.9.26**

#### ✨ New Features

* **Diff Popup Window:** You can now view or open the diff in a separate popup window.

***

**Version: 1.9.25**

#### ✨ New Features

* **Smart Diff Mode:** Added a new diff mode for users working with very long documents, eliminating unnecessary scrolling to find changes.

#### 🎨 Improvements & UX

* **UI/UX Polish:** Implemented various UI/UX enhancements for a more better experience.

***

**Version: 1.9.24**

#### ✨ New Features

*   **Version Statistics:** You can now see detailed statistics for each version of your note directly on the version card.
    *   Enable Word, Character, and Line counts from the settings panel.
    *   For each statistic, you can choose whether to include or exclude Markdown syntax in the calculation, giving you precise control over the data you see.
    
***

**Version: 1.9.23**

#### ✨ New Features

*   **Descriptions** You can now add descriptions along side names for any version.

***

**Version: 1.9.22**

#### 🎨 Improvements & UX

*   **General Stability:** Squashed many bugs and implemented various UI/UX enhancements for a more reliable experience.

***

**Version: 1.9.21**

#### ✨ New Features

*   **Bases Support:** Added support for bases.

#### 🎨 Improvements & UX

*   **UI/UX Polish:** Improved various UI/UX elements for a better user experience.

***

**Version: 1.9.20**

#### ✨ New Features

*   **Search in Panels:** You can now search preview and diff contents directly in the preview and diff panels.

#### 🎨 Improvements & UX

*   **General Stability:** Squashed some bugs and improved UI/UX for a more reliable experience.

***

**Version: 1.9.18**

#### 🎨 Improvements & UX

*   **General Stability:** Squashed many bugs and implemented various UI/UX enhancements for a more reliable experience.

***

**Version: 1.9.17**

#### 🎨 Improvements & UX

*   **UI Polish:** Implemented various UI/UX enhancements for a smoother, modern, and more reliable experience.

***

**Version: 1.9.16**
#### ✨ New Features

*   **Note Branching:** You can now explore different ideas and writing paths within a single note without creating duplicates.
    *   Create, manage, and switch between different "branches" of a note's history directly from the Version Control view in the right sidebar.
    *   Click the branch name (e.g., `main`) to open a menu where you can select an existing branch or create a new one.
    *   Each branch saves its own content, cursor position, and history, allowing you to experiment freely without fear of messing up your primary version.
    *   This is a power-user feature. For regular use, you can continue working on the default `main` branch with no changes to your workflow.

*   **Customizable Frontmatter Key:** You can now change the frontmatter key used to store the version control ID (previously hardcoded as `vc-id`) via the plugin settings. This provides greater flexibility and avoids conflicts with other plugins.

#### 🎨 Improvements & UX

*   **General Stability and UI Polish:** Squashed numerous bugs and implemented various UI/UX enhancements for a smoother and more reliable experience.

***

**Version: 1.9.15**
#### ✨ New Features

*   **Advanced Diffing Modes:** You can now choose how to visualize the differences between two versions of a note. In addition to the standard line-by-line comparison, you can now select:
    *   **Word Diff:** Highlights individual words that have been added or removed within a line.
    *   **Character Diff:** Provides the most granular view, showing individual character changes.
    *   **JSON Diff:** Intelligently compares changes within JSON-formatted text.

*   **Automatic Update Notifications:** Never miss an update again! When the plugin is updated, a changelog panel will now automatically appear, informing you of all the new features, improvements, and bug fixes.

#### 🎨 Improvements & UX

*   **On-the-Fly Diff Switching:** A new dropdown menu has been added to the header of the diff view (both in the side panel and in a new tab). Click the new icon (`git-commit-horizontal`) to instantly switch between Line, Word, Character, and JSON diff modes.
*   **Unified Diff View:** The new Word, Character, and JSON diff modes are displayed in a unified format, highlighting changes inline for a more intuitive and readable comparison, similar to the style used on platforms like GitHub.
*   **Quick Access to Changelog:** You can now view the latest changelog at any time directly from the plugin's settings panel by clicking the new "View Changelog" button.
*   **Easier Feedback & Bug Reporting:** A new "Report Issue" button has been added to the settings panel. This will take you directly to the plugin's GitHub page, making it faster and easier to report bugs or request new features.

***
