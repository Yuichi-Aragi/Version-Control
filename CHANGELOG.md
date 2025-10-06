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
