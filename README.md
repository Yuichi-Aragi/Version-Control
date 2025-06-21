# Obsidian Version Control

An advanced, local version control system for your Obsidian notes, built for simplicity, power, and peace of mind.

![Plugin Screenshot/GIF](https://via.placeholder.com/800x450.png?text=Add+a+GIF+or+Screenshot+of+the+Plugin+Here)
*(Suggestion: Replace the placeholder above with a GIF showcasing the UI and features like saving, restoring, and previewing a version.)*

---

## Why Version Control?

While Obsidian has a built-in File Recovery core plugin, this plugin offers a more powerful, interactive, and manageable way to track the history of your notes. It's designed for users who want a Git-like experience without ever leaving Obsidian or touching the command line.

## Key Features

-   **Complete Version History:** Save, view, restore, and delete snapshots of your notes with a single click.
-   **Robust & Safe:** Features a corruption-resistant, local database (`.versiondb`) with atomic saves to protect your history. No external dependencies like Git required.
-   **Smart Note Management:** Automatically tracks note renames and deletions. Intelligently recovers the versioning ID (`vc-id`) if it's accidentally removed from a note's frontmatter.
-   **Create Deviations:** "Branch off" from any version to create a new, separate note, preserving the original history.
-   **Polished & Performant UI:** A dedicated view with:
    -   Loading skeletons for a smooth experience.
    -   Infinite scrolling to handle notes with long histories.
    -   Two display modes: detailed cards or a compact list.
    -   An inline preview panel that can render Markdown.
-   **Automatic Cleanup:** Keep your vault tidy by automatically cleaning up:
    -   Old versions based on age or a maximum count per note.
    -   "Orphaned" version data from notes that have been deleted.
-   **Powerful Export:** Export a note's entire history to Markdown, JSON, NDJSON, or plain text for backup or analysis.
-   **Highly Configurable:** Tailor the plugin to your workflow with extensive in-view settings.

## Installation

### From Obsidian Community Plugins

1.  Open **Settings** > **Community Plugins**.
2.  Make sure "Restricted mode" is **off**.
3.  Click **Browse** community plugins.
4.  Search for "Version Control".
5.  Click **Install**, and then **Enable**.

### Manual Installation

1.  Download the `main.js`, `styles.css`, and `manifest.json` files from the [latest release](https://github.com/YOUR_USERNAME/obsidian-version-control/releases).
2.  Create a new folder named `version-control` inside your vault's `.obsidian/plugins/` directory.
3.  Copy the downloaded files into this new folder.
4.  Reload Obsidian (or disable and re-enable the plugin in settings).

## Contributing

Contributions, issues, and feature requests are welcome! Please feel free to check the [issues page](https://github.com/YOUR_USERNAME/obsidian-version-control/issues).

## License

This project is licensed under the MIT License. See the [LICENSE.md](LICENSE.md) file for details.
