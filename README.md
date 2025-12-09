![GitHub Release](https://img.shields.io/github/v/release/Yuichi-Aragi/Version-Control) [![Obsidian Downloads](https://img.shields.io/badge/dynamic/json?logo=obsidian&color=%23483699&label=downloads&query=%24%5B%22version-control%22%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json)](https://obsidian.md/plugins?id=version-control) ![GitHub stars](https://img.shields.io/github/stars/Yuichi-Aragi/Version-Control) ![GitHub open issues](https://img.shields.io/github/issues/Yuichi-Aragi/Version-Control) ![GitHub closed issues](https://img.shields.io/github/issues-closed/Yuichi-Aragi/Version-Control) ![GitHub last commit](https://img.shields.io/github/last-commit/Yuichi-Aragi/Version-Control) 

***

# Version Control for Obsidian

**Not another Git wrapper. Not automatic backup. This is version control for your *thoughts*.**

If you're a writer, a perfectionist, or someone who iterates through multiple drafts before finding the right words—this plugin was made for you. It's for those moments when you want to save something meaningful, not because a timer went off, but because *you* decided this version is worth keeping.

---

## 🎯 A Different Philosophy

Here's the thing: **Git is amazing, but it wasn't designed for writers.**

Git treats your entire vault (or folder) as a single branch—something like `main` or `dev`. That's perfect for code, but when you're writing, you don't want to version a folder. You want to version *a note*. A single piece of writing. A specific idea.

**This plugin flips that model:**

- **Git versions folders** → **This plugin versions individual files**
- **Git treats a vault as a branch** → **This plugin treats each note as its own repository**
- **Git makes you leave the file to branch** → **This plugin lets you branch *within* the note**

Think of it this way: you're writing a note about a complex idea. You want to explore two different angles—maybe a technical explanation vs. a philosophical one. With Git, you'd need to create separate files or switch branches. With this plugin, you **branch your thoughts right there in the same note**, each with its own independent history.

---

## 💡 The Core Philosophy: Conscious Milestones

At its heart, this plugin is about **intentionality**—saving versions when **you** decide they're worth saving. When you've reached a milestone. When you've captured something meaningful that you might want to return to later.

- **For perfectionists:** Save each iteration as you refine your ideas, without cluttering your vault with "Copy of..." files.
- **For writers:** Mark meaningful drafts ("First complete thought," "After research," "Final before rewrite") instead of generic timestamps.
- **For thinkers:** Branch your ideas to explore different directions, then merge back what works.

This **intentional** approach to version control is the core philosophy of this plugin—it's designed for people who want to be in control of their creative evolution.

**But we also have your back.** Alongside intentional Version History, this plugin offers an optional **Edit History** feature—automatic, passive snapshots that work in the background as a safety net. You get the best of both worlds: conscious milestones when you want them, and invisible protection when you need it.

---

## 🤝 Works *With* Git, Not Against It

Because this plugin operates at the **file level** (not the vault level), it plays perfectly alongside Git:

- **Use Git** to manage your vault structure, sync across devices, and track large-scale changes
- **Use this plugin** to manage the fine-grained evolution of individual notes, with meaningful milestones and experimental branches

No conflicts. No competition. Two complementary tools for different scales of version control.

---

## 📝 What This Plugin Supports

As of now, this plugin provides version control for:

- ✅ **Markdown files (`.md`)** – Your notes, your writing, your ideas
- ✅ **Obsidian Bases (`.base`)** – Yes, these too!
- 🔜 **Canvas files (`.canvas`)** – Planned for future releases

---

## Why Choose This Plugin?

This plugin is designed for writers, thinkers, and perfectionists who want a simple, intuitive, and robust way to manage the evolution of their notes. If you've ever found yourself creating multiple copies of a file just to explore a new idea, or wished you could go back to a previous version of a paragraph, this plugin is for you.

### Key Advantages

*   **Per-File Version Control:** Unlike Git, which versions your entire vault, this plugin focuses on individual notes. This means you can track the history of a single piece of writing without the complexity of commits, branches, or repositories.
*   **Simplicity and Intuition:** If you find Git's learning curve steep or its features excessive for your needs, this plugin offers a straightforward alternative. It's designed to "just work" out of the box, with a clear and accessible interface.
*   **Mobile-Friendly:** Running a full Git client on mobile or tablets can be impractical. This plugin provides a reliable, self-contained versioning system that works seamlessly across all your devices, including mobile.
*   **Best of Both Worlds:** The core Version History is intentional—you control when to save meaningful milestones. But optional Edit History adds automatic protection in the background, so you're covered either way.

---

## The Interface

The plugin is designed to be intuitive and fit seamlessly with your Obsidian theme, whether you prefer light or dark mode.

<table>
  <tr>
    <td align="center"><strong>Card View (Light)</strong></td>
    <td align="center"><strong>Card View (Dark)</strong></td>
  </tr>
  <tr>
    <td><img src="assets/20251111_001800.jpg" alt="Card View in Light Mode"></td>
    <td><img src="assets/20251111_001358.jpg" alt="Card View in Dark Mode"></td>
  </tr>
  <tr>
    <td align="center"><strong>List View (Light)</strong></td>
    <td align="center"><strong>List View (Dark)</strong></td>
  </tr>
  <tr>
    <td><img src="assets/20251111_001725.jpg" alt="List View in Light Mode"></td>
    <td><img src="assets/20251111_001603.jpg" alt="List View in Dark Mode"></td>
  </tr>
</table>

---

## What Can This Plugin Do For You?

Have you ever been editing a note, trying to perfect it, only to realize you've lost a great paragraph from an earlier draft? Or maybe you want to explore a different angle for your writing without creating a dozen "Copy of..." files?

This plugin solves that. It allows you to save "snapshots" of your notes at any point in time. Think of it like a manual save point in a video game, but for your thoughts. You can create as many versions as you need, give them names, write description (to explain the "why" behind any change), and easily jump back to any previous state.

---

## Key Features

*   💾 **Save Snapshots:** At any time, save the current state of your note as a new version. You can give it a custom name (e.g., "First Draft," "Added Research Links") for easy reference custom description to explain the "why" behind any change).

*   👀 **Preview & Restore:** Quickly glance at the content of any old version without commitment. If you like what you see, restore it with a single click. Don't worry—the plugin automatically saves a backup of your current content before restoring!

*   🔍 **Advanced Comparison (Diff):** See exactly what changed between any two versions. Go beyond standard line-by-line comparison with advanced modes like **Word**, **Character**, and **Smart Diff** to pinpoint every modification.

*   🌿 **Create Deviations (New Note):** Want to turn an old version into a completely separate file? Create a "deviation" to start a brand-new note from any point in your history, perfect for major rewrites or spin-off ideas.

*   🌳 **Explore with Branches (Same Note):** Need to try a different direction within the *same file*? Create a "branch" to work on parallel ideas. Each branch has its own independent history, so you can experiment freely without affecting your main draft.

*   ⚙️ **Smart Cleanup:** Keep your history tidy. Set a maximum number of versions per note, or automatically clean up versions older than a certain number of days.

*   📤 **Export Your History:** Need to back up your work or use it elsewhere? Export the entire version history of a note to various formats, including Markdown, JSON, and plain text.

*   💅 **Flexible Interface:** Choose between a detailed **Card View** that shows all actions at a glance, or a sleek, **Compact List View** for a more minimal look.

---

## How is this different from Obsidian's File Recovery?

You might be thinking, "Doesn't Obsidian already have a File Recovery plugin?" And you're right! The built-in [File Recovery](https://help.obsidian.md/plugins/file-recovery) is excellent and useful for most users. But I wanted more control, more features, and a more comprehensive approach.

Honestly, as a very anxious person, I wanted to see my version history right there in the sidebar, confirming my changes are saved, instead of having to open the file recovery modal via a command. I wanted to save named versions *when I want to*, mark creative milestones, and have powerful features like branching and diffing. This plugin was born from that need for control and visibility.

Here's a quick breakdown:

*   **Intentional Milestones:** This plugin's core feature (Version History) lets you save **manual, intentional snapshots** with meaningful names like "Brainstorming complete" or "Final draft before rewrite." File Recovery only saves automatic snapshots at intervals—no naming, no intentional milestones.

*   **Optional Automatic Protection:** This plugin *also* offers Edit History—automatic snapshots similar to File Recovery, but with smarter diff-based compression and a visible timeline. You get automatic protection *plus* the ability to see and navigate your edit history.

*   **Creative Workflow vs. Disaster Recovery:** This plugin is designed for your **creative workflow**. Features like naming versions, creating new notes from old versions ("deviations"), branching, and easily previewing content are built to help you iterate and explore ideas. File Recovery is purely a **disaster recovery** tool.

*   **Always-On UI vs. On-Demand Modal:** Your note's history is always visible and accessible in the sidebar with this plugin. With File Recovery, you access it through settings or a command when you realize you need to restore something. It's not designed to be part of your constant workflow.

**In simple terms:**
*   **Obsidian File Recovery:** A basic, passive safety net for "oops" moments.
*   **Version Control (This Plugin):** A comprehensive toolkit—intentional milestones for your creative workflow *plus* automatic edit tracking for peace of mind.

---

## Two Types of History: Version History & Edit History

This plugin offers two complementary approaches to tracking your work—each designed for a different purpose.

### 🎯 Version History (Intentional Snapshots)

This is the core philosophy of this plugin. Version History captures **manual, intentional snapshots** that *you* decide to save. These are your creative milestones—moments when you've reached a meaningful point in your writing and want to preserve it.

*   **When it's saved:** Only when you explicitly choose to save a version.
*   **How it's stored:** As standard Markdown (`.md`) files inside a hidden `.versiondb` folder in your vault.
*   **Full copies:** Each version is saved as a complete, standalone copy of your note.
*   **Portable & Accessible:** Because versions are plain Markdown files, they remain accessible and readable even without the plugin.

This is for **perfectionists, writers, and conscious creators** who want to be in control of their creative evolution.

### ⏱️ Edit History (Automatic Passive Snapshots)

Edit History works differently—it captures **automatic, passive snapshots** in the background as you work. Think of it as an invisible safety net that tracks your progress without interrupting your flow.

*   **When it's saved:** Automatically, based on your settings (e.g., on file save, at intervals, or when minimum changes are detected).
*   **How it's stored:** In your browser's IndexedDB (a local database), **not** in your vault folder.
*   **Delta compression:** Unlike Version History, Edit History uses smart diff-based compression—only the *changes* between edits are stored, making it extremely space-efficient.
*   **Worker-based:** All processing happens in a background Web Worker, ensuring zero impact on your writing performance.

This is for **those "oops" moments**—when you accidentally delete something or want to see how your writing evolved over a session.

### 📊 How They Differ From Each Other

| Feature | Version History | Edit History |
|---------|-----------------|--------------|
| **Trigger** | Manual (you decide) | Automatic (passive) |
| **Purpose** | Creative milestones | Safety net / session recovery |
| **Storage Location** | `.versiondb` folder (in vault) | IndexedDB (browser database) |
| **Storage Format** | Full Markdown copies | Compressed diffs (delta chains) |
| **Portability** | ✅ Files move with your vault | ❌ Browser-specific |
| **Persistence** | ✅ Survives plugin removal | ❌ Browser database |
| **Space Efficiency** | Each version = full copy | Only changes stored |

### 🆚 How Both Differ From Git

**Git is amazing—but it wasn't designed for writers.** Here's why this plugin takes a different approach:

| Aspect | Git | This Plugin |
|--------|-----|-------------|
| **Scope** | Versions entire folders/repositories | Versions individual notes |
| **Mental Model** | Your vault is a branch (`main`, `dev`) | Each note is its own repository |
| **Branching** | Leave the file, switch branches | Branch *within* the same note |
| **Complexity** | Commits, staging, push/pull | Just "Save Version" |
| **Mobile Support** | Impractical on mobile | Works seamlessly across devices |

**The key insight:** When you're writing, you don't want to version a folder—you want to version *a thought*. A single note. A specific idea. This plugin gives you that focused control.

---

## Data Storage and Persistence

### Version History Storage

**Your version data stays with you.** All Version History data is stored locally within your Obsidian vault in a hidden folder (specifically, a folder named `.versiondb`). Inside this folder, the data for each version is saved as standard Markdown (`.md`) files.

This structure ensures data persistence and privacy:
*   **Local Storage:** Your version history never leaves your vault or connects to an external service.
*   **Data Stays:** Your version history and all associated data will remain in your vault even if you uninstall or remove the plugin.
*   **Accessible Format:** Because it is stored as standard Markdown files, your data is always accessible and readable, even without the plugin.

### Edit History Storage

Edit History uses a different approach optimized for efficiency:
*   **IndexedDB:** Stored in your browser's local IndexedDB database (named `VersionControlEditHistoryDB`), not in your vault folder.
*   **Delta Compression:** Uses intelligent diff-based storage—full snapshots are saved periodically, with subsequent edits stored as compressed differences (diffs).
*   **Space Efficient:** This approach dramatically reduces storage overhead while maintaining full reconstruction capability.
*   **Browser-Specific:** Because it uses IndexedDB, Edit History is specific to each browser/device and doesn't sync with your vault.

**Note:** If you clear your browser data or switch devices, Edit History won't transfer. For important milestones, always save an intentional Version.

---

## Platform Support

* ✅ **Mobile** (iOS & Android)
* ✅ **Desktop** (Windows, macOS, Linux)

---

## Download

To jump straight to the Version Control plugin in Obsidian, try this:

* **​Click the URI:** Copy and paste or click this [link](obsidian://show-plugin?id=version-control), which should launch the app: obsidian://show-plugin?id=version-control
* **Alternatively (Search):** If the link doesn't work, go to your Obsidian Settings and search for 'Version-Control' in the Community Plugins list.

---

## Final Thoughts

This plugin was born from my own workflow frustrations. As someone who constantly modifies and perfects the same note, creating many variations until I'm satisfied, I needed a solution that gave me control. Not vault-wide version tracking. Not hidden modals. Just simple, intentional milestones for my ideas—with the option for automatic protection when I want it.

If that resonates with you—if you're someone who wants to consciously manage how your thoughts evolve, while also having a safety net for those inevitable "oops" moments—then this plugin might be exactly what you need.

***

*Made with ❤️ for writers, perfectionists, and conscious creators.*
