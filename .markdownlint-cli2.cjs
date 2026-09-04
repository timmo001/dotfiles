const fs = require("node:fs");
const path = require("node:path");

const skillsDirectory = "agents/.agents/skills";
const importedSkillIgnores = fs
  .readdirSync(skillsDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((entry) => {
    const skillPath = path.join(skillsDirectory, entry.name, "SKILL.md");
    if (!fs.existsSync(skillPath)) {
      return [];
    }

    const content = fs.readFileSync(skillPath, "utf8");
    const frontmatter = content.match(
      /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/,
    )?.[1];
    return frontmatter?.includes("# origin:") &&
      !frontmatter.includes("# local-edits:")
      ? [`${skillsDirectory}/${entry.name}/**`]
      : [];
  });

module.exports = {
  // Structural rules are enforced; noisy stylistic rules are disabled with a
  // reason. Generated docs and unmodified imported skills are excluded.
  config: {
    default: true,
    // Off: long lines are unavoidable in docs, tables, and code samples.
    MD013: false,
    // Off: docs and skills use inline HTML intentionally.
    MD033: false,
    // Off: reference and skill docs legitimately repeat section headings.
    MD024: false,
    // Off: emphasis is used as pseudo-headings in docs and skill callouts.
    MD036: false,
    // Off: Astro content files open with --- frontmatter, not an h1.
    MD041: false,
    // Off: table pipe spacing style is noise across skill and generated tables.
    MD060: false,
  },
  gitignore: true,
  globs: ["**/*.md"],
  ignores: [
    "**/node_modules",
    "**/node_modules/**",
    "docs/dist",
    "docs/dist/**",
    "docs/.astro",
    "docs/.astro/**",
    "dot-migration/**",
    "docs/src/content/docs/dot/commands.md",
    "docs/src/content/docs/agents/opencode/agents.md",
    "docs/src/content/docs/agents/opencode/commands.md",
    "docs/src/content/docs/agents/opencode/plugins.md",
    ...importedSkillIgnores,
  ],
};
